/**
 * MapWidget — 카카오맵 SDK 기반 지도 위젯
 * GPS 위치 추적, 목적지 검색(카카오 Places), 경로 탐색(카카오 Directions / OSRM 폴백)
 * 진행방향 지도 회전, 턴바이턴 네비게이션
 */

class MapWidget {
  constructor() {
    this.map = null;
    this.userMarker = null;
    this.destMarker = null;
    this.routeLine = null;
    this._userPos = null;
    this._searchVisible = false;
    this._rotateTimeout = null;

    // 카카오 서비스 인스턴스
    this._placesService = null;
    this._geocoderService = null;

    // 지도 회전 관련 상태
    this._mapRotationEnabled = true;   // 자동 회전 활성화 여부
    this._currentHeading = null;       // 현재 나침반 heading (도)
    this._userRotationTimeout = null;  // 사용자 드래그 후 재활성화 타이머

    // 네비게이션 관련 상태
    this._navSteps = null;             // 네비게이션 step 배열 (null = 비활성)
    this._currentStepIndex = 0;        // 현재 네비게이션 단계 인덱스
    this._navTotal = null;             // 전체 경로 정보 { distance, duration }
    this._navStartTime = null;         // 네비게이션 시작 시간
    this._arrivalTimeout = null;       // 도착 후 자동 종료 타이머
    this._routeSource = null;          // 'kakao' 또는 'osrm' (어떤 API로 경로 탐색했는지)

    // 카카오 길안내 type → { icon, text } 매핑
    this._kakaoGuideTypeMap = {
      0:  { icon: '🚗', text: '출발' },
      1:  { icon: '⬆️', text: '직진' },
      2:  { icon: '↖️', text: '좌회전' },
      3:  { icon: '↗️', text: '우회전' },
      4:  { icon: '↖️', text: '좌회전' },
      5:  { icon: '↗️', text: '우회전' },
      6:  { icon: '⬆️', text: '직진' },
      7:  { icon: '⬆️', text: '직진' },
      8:  { icon: '↗️', text: '우회전' },
      9:  { icon: '↖️', text: '좌회전' },
      10: { icon: '🔄', text: '유턴' },
      11: { icon: '🔄', text: '유턴' },
      12: { icon: '↖️', text: '좌회전' },
      13: { icon: '↗️', text: '우회전' },
      14: { icon: '⬆️', text: '직진' },
      15: { icon: '↗️', text: '우회전' },
      16: { icon: '↘️', text: '우회전' },
      17: { icon: '🛣️', text: '고가도로 진입' },
      18: { icon: '🛣️', text: '고가도로 진출' },
      19: { icon: '🛣️', text: '터널 진입' },
      20: { icon: '🛣️', text: '터널 진출' },
      21: { icon: '⬆️', text: '교차로 통과' },
      22: { icon: '🛣️', text: '국도 진입' },
      23: { icon: '🛣️', text: '국도 진출' },
      24: { icon: '🛣️', text: '고속도로 진입' },
      25: { icon: '🛣️', text: '고속도로 진출' },
      26: { icon: '🛣️', text: '도로 진입' },
      27: { icon: '🛣️', text: '도로 진출' },
      28: { icon: '🔄', text: '교차로 회전' },
      29: { icon: '🛤️', text: '철길 건넘' },
      100: { icon: '🏁', text: '도착' }
    };

    // OSRM 방향 지시 매핑 테이블 (modifier → { icon, text })
    this._maneuverMap = {
      'straight':      { icon: '⬆️', text: '직진' },
      'slight right':  { icon: '↗️', text: '약간 우회전' },
      'right':         { icon: '➡️', text: '우회전' },
      'sharp right':   { icon: '🔽', text: '급 우회전' },
      'slight left':   { icon: '↖️', text: '약간 좌회전' },
      'left':          { icon: '⬅️', text: '좌회전' },
      'sharp left':    { icon: '🔼', text: '급 좌회전' },
      'uturn':         { icon: '🔄', text: '유턴' }
    };

    // OSRM 특수 maneuver type 매핑
    this._specialManeuverMap = {
      'arrive':      '목적지 도착',
      'depart':      '출발',
      'roundabout':  '회전교차로',
      'rotary':      '회전교차로',
      'fork':        '분기점',
      'merge':       '합류'
    };
  }

  /** 지도 초기화 */
  init() {
    // 카카오맵 SDK 로드 확인
    if (typeof kakao === 'undefined' || typeof kakao.maps === 'undefined') {
      console.error('카카오맵 SDK가 로드되지 않았습니다');
      return;
    }

    // 기본 위치 (서울)
    const defaultLat = 37.5665;
    const defaultLng = 126.978;

    this.map = new kakao.maps.Map(document.getElementById('map'), {
      center: new kakao.maps.LatLng(defaultLat, defaultLng),
      level: 3  // 줌 레벨 (1=확대, 14=축소)
    });

    // 카카오 서비스 초기화
    this._placesService = new kakao.maps.services.Places();
    this._geocoderService = new kakao.maps.services.Geocoder();

    // GPS 위치 이벤트 수신
    this._onGpsPosition = (e) => this._updateUserPosition(e.detail);
    document.addEventListener('gpsposition', this._onGpsPosition);

    // 검색 폼 이벤트
    this._onSearchSubmit = (e) => this._handleSearch(e);
    this._onSearchClose = () => this.hideSearch();
    this._onSearchResultClick = (e) => this._onResultClick(e);

    const searchForm = document.getElementById('search-form');
    const searchClose = document.getElementById('search-close');
    const searchResults = document.getElementById('search-results');

    if (searchForm) searchForm.addEventListener('submit', this._onSearchSubmit);
    if (searchClose) searchClose.addEventListener('click', this._onSearchClose);
    if (searchResults) searchResults.addEventListener('click', this._onSearchResultClick);

    // 나침반 방향 변경 이벤트로 지도 회전
    this._onCompassUpdate = (e) => this._rotateMapByCompass(e);
    document.addEventListener('deviceorientation', this._onCompassUpdate, true);

    // 사용자 드래그 시 자동 회전 일시 해제
    if (this.map) {
      kakao.maps.event.addListener(this.map, 'dragstart', () => this._onUserDragStart());
    }

    // 맵 레이아웃 강제 갱신 (지연 로딩 대응)
    setTimeout(() => {
      if (this.map) this.map.relayout();
    }, 500);
  }

  /** 검색 패널 표시/숨김 토글 */
  toggleSearch() {
    if (this._searchVisible) {
      this.hideSearch();
    } else {
      this.showSearch();
    }
  }

  showSearch() {
    const searchDiv = document.getElementById('map-search');
    if (searchDiv) {
      searchDiv.style.display = '';
      const input = document.getElementById('search-input');
      if (input) input.focus();
    }
    this._searchVisible = true;
  }

  hideSearch() {
    const searchDiv = document.getElementById('map-search');
    if (searchDiv) {
      searchDiv.style.display = 'none';
    }
    this._searchVisible = false;
  }

  /** 지도 크기 강제 갱신 (레이아웃 변경 후 호출) */
  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.relayout(), 100);
    }
  }

  /** 사용자 GPS 위치 마커 업데이트 */
  _updateUserPosition(detail) {
    if (!this.map || !detail) return;

    const { latitude, longitude, accuracy, heading } = detail;
    if (latitude == null || longitude == null) return;

    this._userPos = [latitude, longitude];

    // GPS heading이 있으면 나침반 대신 사용 (이동 중)
    if (heading !== null && heading !== undefined && !isNaN(heading)) {
      this._currentHeading = heading;
    }

    const userLatLng = new kakao.maps.LatLng(latitude, longitude);

    // 기존 마커 위치 업데이트 또는 신규 생성
    if (this.userMarker) {
      this.userMarker.setPosition(userLatLng);
    } else {
      // 사용자 위치 마커 (커스텀 오버레이)
      const markerContent = document.createElement('div');
      markerContent.className = 'hud-user-marker';

      this.userMarker = new kakao.maps.Marker({
        position: userLatLng,
        map: this.map,
        zIndex: 100
      });

      // 커스텀 HTML로 마커 스타일 적용
      const customOverlay = new kakao.maps.CustomOverlay({
        position: userLatLng,
        content: '<div class="hud-user-marker"></div>',
        map: this.map,
        zIndex: 100
      });
      this._userOverlay = customOverlay;
      // 마커는 오버레이로 대체하므로 기본 마커는 숨김
      this.userMarker.setMap(null);
      this.userMarker = null;

      // 첫 위치 수신 시 지도 중심 이동
      this.map.setLevel(3);
      this.map.panTo(userLatLng);
    }

    if (this._userOverlay) {
      this._userOverlay.setPosition(userLatLng);
    }

    // 네비게이션 활성 상태에서 step 진행 체크
    if (this._navSteps && this._navSteps.length > 0) {
      this._advanceNavStep();
    }
  }

  // ==========================================
  // 나침반 기반 지도 회전
  // ==========================================

  /** 나침반 방향으로 지도 회전 */
  _rotateMapByCompass(e) {
    if (!this._mapRotationEnabled) return;

    let heading = null;
    if (e && e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
      heading = e.webkitCompassHeading; // iOS
    } else if (e && e.alpha !== null && e.alpha !== undefined) {
      heading = e.alpha; // Android
    }

    if (heading === null || isNaN(heading)) return;

    this._currentHeading = heading;
    this._applyMapRotation(heading);
  }

  /** 실제 지도 회전 적용 (CSS transform 사용) */
  _applyMapRotation(heading) {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // 나침반 heading을 지도 회전각으로 변환 (heading 방향이 위로 오도록)
    const rotation = -heading;
    mapEl.style.transition = 'transform 300ms ease';
    mapEl.style.transform = `rotate(${rotation}deg)`;
    mapEl.style.transformOrigin = 'center center';
  }

  /** 사용자가 지도를 드래그하면 자동 회전 일시 해제 */
  _onUserDragStart() {
    if (!this._mapRotationEnabled) return;

    this._mapRotationEnabled = false;
    console.log('사용자 드래그 — 지도 자동 회전 일시 해제');

    // 10초 후 자동 회전 재활성화
    if (this._userRotationTimeout) {
      clearTimeout(this._userRotationTimeout);
    }
    this._userRotationTimeout = setTimeout(() => {
      this._mapRotationEnabled = true;
      console.log('지도 자동 회전 재활성화');
      // 현재 heading으로 즉시 회전
      if (this._currentHeading !== null) {
        this._applyMapRotation(this._currentHeading);
      }
    }, 10000);
  }

  /** 지도 회전 수동 재활성화 */
  enableMapRotation() {
    this._mapRotationEnabled = true;
    if (this._userRotationTimeout) {
      clearTimeout(this._userRotationTimeout);
      this._userRotationTimeout = null;
    }
    if (this._currentHeading !== null) {
      this._applyMapRotation(this._currentHeading);
    }
  }

  // ==========================================
  // 목적지 검색 (카카오 Places)
  // ==========================================

  /** 목적지 검색 */
  _handleSearch(e) {
    e.preventDefault();
    const input = document.getElementById('search-input');
    const resultsDiv = document.getElementById('search-results');
    if (!input || !resultsDiv) return;

    const query = input.value.trim();
    if (!query) return;

    resultsDiv.innerHTML = '<div class="search-result-item" style="color:#888">검색 중...</div>';

    if (!this._placesService) {
      resultsDiv.innerHTML = '<div class="search-result-item" style="color:#ff4444">검색 서비스를 사용할 수 없습니다</div>';
      return;
    }

    this._placesService.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        if (!data || data.length === 0) {
          resultsDiv.innerHTML = '<div class="search-result-item" style="color:#888">검색 결과가 없습니다</div>';
          return;
        }

        resultsDiv.innerHTML = data.map((item, idx) => `
          <div class="search-result-item" data-lat="${item.y}" data-lon="${item.x}" data-idx="${idx}">
            <div class="search-result-name">${this._escapeHtml(item.place_name)}</div>
            <div class="search-result-addr">${this._escapeHtml(item.road_address_name || item.address_name)}</div>
          </div>
        `).join('');
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resultsDiv.innerHTML = '<div class="search-result-item" style="color:#888">검색 결과가 없습니다</div>';
      } else {
        console.error('카카오 Places 검색 오류:', status);
        resultsDiv.innerHTML = '<div class="search-result-item" style="color:#ff4444">검색 실패</div>';
      }
    });
  }

  /** 검색 결과 항목 클릭 처리 */
  _onResultClick(e) {
    const item = e.target.closest('.search-result-item');
    if (!item) return;

    const lat = parseFloat(item.dataset.lat);
    const lon = parseFloat(item.dataset.lon);
    if (isNaN(lat) || isNaN(lon)) return;

    // 지도 이동
    if (this.map) {
      this.map.setLevel(3);
      this.map.panTo(new kakao.maps.LatLng(lat, lon));
    }

    // 기존 목적지 마커/경로 제거
    this._clearDestination();

    // 기존 네비게이션 중지
    this._stopNavigation();

    // 목적지 마커 추가 (커스텀 오버레이)
    const destContent = '<div style="width:12px;height:12px;background:#ff4444;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px rgba(255,68,68,0.8)"></div>';
    this._destOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lon),
      content: destContent,
      map: this.map,
      zIndex: 50
    });

    // 현재 위치에서 경로 탐색
    if (this._userPos) {
      this._fetchRoute(this._userPos[1], this._userPos[0], lon, lat);
    }

    // 검색 패널 닫기
    this.hideSearch();
  }

  // ==========================================
  // 경로 탐색 (카카오 Directions → OSRM 폴백)
  // ==========================================

  /** 경로 탐색 — 카카오 Directions API 우선, 실패 시 OSRM 폴백 */
  async _fetchRoute(fromLon, fromLat, toLon, toLat) {
    try {
      // 1. 카카오 Directions API 시도
      const kakaoSuccess = await this._fetchKakaoRoute(fromLon, fromLat, toLon, toLat);
      if (!kakaoSuccess) {
        // 2. 카카오 실패 시 OSRM 폴백
        console.log('카카오 Directions 실패 — OSRM으로 폴백');
        await this._fetchOsrmRoute(fromLon, fromLat, toLon, toLat);
      }
    } catch (err) {
      console.error('경로 탐색 오류:', err);
    }
  }

  /** 카카오 Directions REST API로 경로 탐색 */
  async _fetchKakaoRoute(fromLon, fromLat, toLon, toLat) {
    try {
      const url = `https://apis-navi.kakao.com/v1/directions?origin=${fromLon},${fromLat}&destination=${toLon},${toLat}&priority=RECOMMEND&car_type=8&alternatives=false`;
      const resp = await fetch(url, {
        headers: { 'Authorization': 'KakaoAK e9562b51a309f295c4407b63c7efd644' }
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          console.warn('카카오 Directions API 403 — 길찾기 권한이 없습니다. OSRM으로 폴백합니다.');
        } else {
          console.warn(`카카오 Directions API 오류: ${resp.status}`);
        }
        return false;
      }

      const data = await resp.json();

      if (!data.routes || data.routes.length === 0) {
        console.warn('카카오: 경로를 찾을 수 없습니다');
        return false;
      }

      const route = data.routes[0];
      const summary = route.summary;

      // 경로선 그리기
      const path = [];
      const allGuides = [];

      for (const section of route.sections) {
        for (const road of section.roads) {
          // vertexes: [lng, lat, lng, lat, ...]
          const vertexes = road.vertexes;
          for (let i = 0; i < vertexes.length; i += 2) {
            path.push(new kakao.maps.LatLng(vertexes[i + 1], vertexes[i]));
          }

          // guides에서 턴바이턴 정보 수집
          if (road.guides) {
            for (const guide of road.guides) {
              allGuides.push(guide);
            }
          }
        }
      }

      if (path.length === 0) {
        console.warn('카카오: 경로 좌표가 없습니다');
        return false;
      }

      // 경로선 표시
      this._drawRouteLine(path);

      // 지도 영역을 경로에 맞게 조정
      const bounds = new kakao.maps.LatLngBounds();
      for (const p of path) {
        bounds.extend(p);
      }
      this.map.setBounds(bounds, 50, 50, 50, 50);

      // 네비게이션 step 정보 설정 (카카오 guides 기반)
      this._navSteps = this._parseKakaoGuides(allGuides);
      this._currentStepIndex = 0;
      this._navTotal = {
        distance: summary.distance,  // 미터
        duration: summary.duration   // 초
      };
      this._navStartTime = Date.now();
      this._routeSource = 'kakao';

      // 네비게이션 시작
      this._startNavigation();

      console.log(`카카오 경로 탐색 성공: ${this._navSteps.length}단계, 총 거리 ${this._formatDistance(this._navTotal.distance)}`);
      return true;

    } catch (err) {
      console.error('카카오 Directions API 오류:', err);
      return false;
    }
  }

  /** 카카오 guides 배열을 네비게이션 step 형식으로 변환 */
  _parseKakaoGuides(guides) {
    // guides 배열을 내부 네비게이션 step 형식으로 변환
    // 각 guide: { type, distance, duration, road_name, guidance, x, y }
    return guides.map((guide, idx) => ({
      type: guide.type,
      icon: this._kakaoGuideTypeMap[guide.type] ? this._kakaoGuideTypeMap[guide.type].icon : '⬆️',
      text: this._kakaoGuideTypeMap[guide.type] ? this._kakaoGuideTypeMap[guide.type].text : guide.guidance || '직진',
      guidance: guide.guidance || '',
      roadName: guide.road_name || '',
      distance: guide.distance || 0,
      duration: guide.duration || 0,
      lat: guide.y ? parseFloat(guide.y) : null,
      lng: guide.x ? parseFloat(guide.x) : null
    }));
  }

  /** OSRM 경로 탐색 (폴백) */
  async _fetchOsrmRoute(fromLon, fromLat, toLon, toLat) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'HudMirrorPWA/2.0' }
      });
      const data = await resp.json();

      if (!data.routes || data.routes.length === 0) {
        console.warn('OSRM: 경로를 찾을 수 없습니다');
        return;
      }

      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(c => new kakao.maps.LatLng(c[1], c[0])); // [lon,lat] → LatLng

      // 경로선 표시
      this._drawRouteLine(coords);

      // 지도 영역 조정
      const bounds = new kakao.maps.LatLngBounds();
      for (const c of coords) {
        bounds.extend(c);
      }
      this.map.setBounds(bounds, 50, 50, 50, 50);

      // 네비게이션 step 정보 추출
      if (route.legs && route.legs.length > 0) {
        const allSteps = [];
        for (const leg of route.legs) {
          if (leg.steps && leg.steps.length > 0) {
            allSteps.push(...leg.steps);
          }
        }

        if (allSteps.length > 0) {
          // OSRM steps를 내부 형식으로 변환
          this._navSteps = this._parseOsrmSteps(allSteps);
          this._currentStepIndex = 0;
          this._navTotal = {
            distance: route.distance,
            duration: route.duration
          };
          this._navStartTime = Date.now();
          this._routeSource = 'osrm';

          this._startNavigation();
        }
      }
    } catch (err) {
      console.error('OSRM 경로 탐색 오류:', err);
    }
  }

  /** OSRM steps를 내부 네비게이션 형식으로 변환 */
  _parseOsrmSteps(steps) {
    return steps.map((step) => {
      const maneuver = step.maneuver;
      let icon = '⬆️';
      let text = '직진';

      // 특수 maneuver type 처리
      if (this._specialManeuverMap[maneuver.type]) {
        text = this._specialManeuverMap[maneuver.type];
        const typeIcons = {
          'arrive': '🏁', 'depart': '🚗',
          'roundabout': '🔄', 'rotary': '🔄',
          'fork': '⑂', 'merge': '⤴️'
        };
        icon = typeIcons[maneuver.type] || '⬆️';
        if (this._maneuverMap[maneuver.modifier]) {
          icon = this._maneuverMap[maneuver.modifier].icon;
        }
      } else if (this._maneuverMap[maneuver.modifier]) {
        icon = this._maneuverMap[maneuver.modifier].icon;
        text = this._maneuverMap[maneuver.modifier].text;
      }

      // step의 마지막 좌표 (목표점)
      let lat = null, lng = null;
      if (step.geometry && step.geometry.coordinates) {
        const lastCoord = step.geometry.coordinates[step.geometry.coordinates.length - 1];
        lng = lastCoord[0];
        lat = lastCoord[1];
      }

      return {
        type: maneuver.type,
        icon: icon,
        text: text,
        guidance: text,
        roadName: step.name || '',
        distance: step.distance || 0,
        duration: step.duration || 0,
        lat: lat,
        lng: lng
      };
    });
  }

  /** 경로선 지도에 표시 */
  _drawRouteLine(path) {
    this.routeLine = new kakao.maps.Polyline({
      path: path,
      map: this.map,
      strokeWeight: 6,
      strokeColor: '#00d4ff',
      strokeOpacity: 0.8,
      strokeStyle: 'solid'
    });
  }

  // ==========================================
  // 턴바이턴 네비게이션
  // ==========================================

  /** 네비게이션 시작 — UI 표시 및 초기 상태 설정 */
  _startNavigation() {
    if (!this._navSteps || this._navSteps.length === 0) return;

    // 네비게이션 배너 표시
    const navBanner = document.getElementById('nav-banner');
    if (navBanner) navBanner.style.display = '';

    // nav-active 클래스 추가
    const app = document.getElementById('app');
    if (app) app.classList.add('nav-active');

    // 지도 회전 활성화
    this.enableMapRotation();

    // 첫 step 표시
    this._currentStepIndex = 0;
    this._updateNavDisplay();

    console.log(`네비게이션 시작: ${this._navSteps.length}단계, 총 거리 ${this._formatDistance(this._navTotal.distance)}`);
  }

  /** 네비게이션 표시 업데이트 */
  _updateNavDisplay() {
    if (!this._navSteps || this._currentStepIndex >= this._navSteps.length) return;

    const step = this._navSteps[this._currentStepIndex];

    // 다음 step이 있고 현재 step이 출발/유지이면 다음 step을 표시
    let displayStep = step;
    if (this._routeSource === 'osrm') {
      if ((step.type === 'depart' || step.type === 'new name') &&
          this._currentStepIndex + 1 < this._navSteps.length) {
        displayStep = this._navSteps[this._currentStepIndex + 1];
      }
    } else {
      // 카카오: type 0(출발) 또는 type 1(유지)이면 다음 step 표시
      if ((step.type === 0 || step.type === 1) &&
          this._currentStepIndex + 1 < this._navSteps.length) {
        displayStep = this._navSteps[this._currentStepIndex + 1];
      }
    }

    // 아이콘과 지시문
    let icon = displayStep.icon || '⬆️';
    let instruction = displayStep.text || displayStep.guidance || '직진';

    // 목적지 도착인지 확인
    const isArrival = (this._routeSource === 'kakao' && displayStep.type === 100) ||
                      (this._routeSource === 'osrm' && displayStep.type === 'arrive');

    // 도로명
    const roadName = displayStep.roadName || '';

    // 다음 방향 전환까지 남은 거리
    let distToNext = step.distance || 0;

    // 남은 전체 거리 및 ETA 계산
    let remainingDist = 0;
    let remainingDuration = 0;

    if (this._navTotal) {
      // 지나온 step들의 거리를 합산
      let coveredDist = 0;
      for (let i = 0; i < this._currentStepIndex; i++) {
        coveredDist += this._navSteps[i].distance || 0;
      }

      remainingDist = Math.max(0, this._navTotal.distance - coveredDist);

      if (this._navStartTime) {
        const elapsed = (Date.now() - this._navStartTime) / 1000;
        remainingDuration = Math.max(0, this._navTotal.duration - elapsed);
      } else {
        remainingDuration = this._navTotal.duration;
      }
    }

    // DOM 업데이트
    const navIconEl = document.getElementById('nav-icon');
    const navInstructionEl = document.getElementById('nav-instruction');
    const navRoadEl = document.getElementById('nav-road');
    const navDistanceEl = document.getElementById('nav-distance');
    const navEtaTimeEl = document.getElementById('nav-eta-time');

    if (navIconEl) navIconEl.textContent = icon;
    if (navInstructionEl) navInstructionEl.textContent = instruction;
    if (navRoadEl) navRoadEl.textContent = roadName || '도로 정보 없음';
    if (navDistanceEl) navDistanceEl.textContent = this._formatDistance(distToNext);
    if (navEtaTimeEl) navEtaTimeEl.textContent = this._formatDuration(remainingDuration);

    // 접근 경고 업데이트
    this._updateApproachWarning(distToNext, instruction, icon);
  }

  /** 접근 경고 표시/숨김 (200m 이내) */
  _updateApproachWarning(distToNext, instruction, icon) {
    const approachEl = document.getElementById('nav-approach');
    const approachDistEl = document.getElementById('nav-approach-distance');
    const approachInstrEl = document.getElementById('nav-approach-instruction');

    if (!approachEl) return;

    if (distToNext < 200 && distToNext > 0 && instruction !== '목적지 도착' && instruction !== '도착') {
      if (approachDistEl) approachDistEl.textContent = this._formatDistance(distToNext);
      if (approachInstrEl) approachInstrEl.textContent = instruction;
      approachEl.classList.add('active');
    } else {
      approachEl.classList.remove('active');
    }
  }

  /** 네비게이션 step 전진 — GPS 위치 기반 */
  _advanceNavStep() {
    if (!this._navSteps || !this._userPos) return;

    const currentStep = this._navSteps[this._currentStepIndex];
    if (!currentStep) return;

    // step의 목표 좌표
    const targetLat = currentStep.lat;
    const targetLng = currentStep.lng;

    if (targetLat == null || targetLng == null) return;

    // Haversine 거리 계산
    const dist = this._haversine(
      this._userPos[0], this._userPos[1],
      targetLat, targetLng
    );

    // 30m 이내에 도달하면 다음 step으로 전진
    if (dist < 30) {
      // 마지막 step (도착)인지 확인
      if (this._currentStepIndex >= this._navSteps.length - 1) {
        this._onArrival();
        return;
      }

      this._currentStepIndex++;
      console.log(`네비게이션 step 전진: ${this._currentStepIndex}/${this._navSteps.length}`);

      // 새 step 표시 업데이트
      this._updateNavDisplay();
    }
  }

  /** 목적지 도착 처리 */
  _onArrival() {
    console.log('목적지 도착!');

    // 도착 표시 업데이트
    const navIconEl = document.getElementById('nav-icon');
    const navInstructionEl = document.getElementById('nav-instruction');
    const navRoadEl = document.getElementById('nav-road');
    const navDistanceEl = document.getElementById('nav-distance');
    const navEtaTimeEl = document.getElementById('nav-eta-time');

    if (navIconEl) navIconEl.textContent = '🏁';
    if (navInstructionEl) navInstructionEl.textContent = '목적지 도착!';
    if (navRoadEl) navRoadEl.textContent = '';
    if (navDistanceEl) navDistanceEl.textContent = '';
    if (navEtaTimeEl) navEtaTimeEl.textContent = '';

    // 접근 경고 숨김
    const approachEl = document.getElementById('nav-approach');
    if (approachEl) approachEl.classList.remove('active');

    // 5초 후 네비게이션 자동 종료
    if (this._arrivalTimeout) clearTimeout(this._arrivalTimeout);
    this._arrivalTimeout = setTimeout(() => {
      this._stopNavigation();
      this._arrivalTimeout = null;
    }, 5000);
  }

  /** 네비게이션 중지 */
  _stopNavigation() {
    // 도착 자동 종료 타이머 정리
    if (this._arrivalTimeout) {
      clearTimeout(this._arrivalTimeout);
      this._arrivalTimeout = null;
    }

    // 네비게이션 배너 숨김
    const navBanner = document.getElementById('nav-banner');
    if (navBanner) navBanner.style.display = 'none';

    // 접근 경고 숨김
    const approachEl = document.getElementById('nav-approach');
    if (approachEl) approachEl.classList.remove('active');

    // nav-active 클래스 제거
    const app = document.getElementById('app');
    if (app) app.classList.remove('nav-active');

    // 네비게이션 상태 초기화
    this._navSteps = null;
    this._currentStepIndex = 0;
    this._navTotal = null;
    this._navStartTime = null;
    this._routeSource = null;

    // 경로선과 목적지 마커는 유지 (사용자가 확인 가능)
    console.log('네비게이션 중지');
  }

  // ==========================================
  // 유틸리티
  // ==========================================

  /** 거리 포맷팅 — "XXXm" (< 1km) 또는 "X.Xkm" (>= 1km) */
  _formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '--';
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)}km`;
    }
    return `${Math.round(meters)}m`;
  }

  /** 시간 포맷팅 — "XX분" 또는 "X시간 XX분" */
  _formatDuration(seconds) {
    if (seconds == null || isNaN(seconds) || seconds <= 0) return '--';
    const totalMinutes = Math.ceil(seconds / 60);
    if (totalMinutes >= 60) {
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }
    return `${totalMinutes}분`;
  }

  /** Haversine 공식 — 두 위경도 간 거리(미터) 계산 */
  _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반지름 (미터)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /** 목적지 마커 및 경로 제거 */
  _clearDestination() {
    if (this._destOverlay) {
      this._destOverlay.setMap(null);
      this._destOverlay = null;
    }
    if (this._userOverlay) {
      this._userOverlay.setMap(null);
      this._userOverlay = null;
    }
    if (this.routeLine) {
      this.routeLine.setMap(null);
      this.routeLine = null;
    }
  }

  /** HTML 이스케이프 (XSS 방지) */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** 사용자 위치 반환 */
  getUserPosition() {
    return this._userPos;
  }

  /** 네비게이션 활성 상태 반환 */
  isNavigating() {
    return this._navSteps !== null && this._navSteps.length > 0;
  }

  /** 이벤트 리스너 정리 */
  destroy() {
    // GPS 이벤트 해제
    if (this._onGpsPosition) {
      document.removeEventListener('gpsposition', this._onGpsPosition);
    }

    // 검색 이벤트 해제
    const searchForm = document.getElementById('search-form');
    const searchClose = document.getElementById('search-close');
    const searchResults = document.getElementById('search-results');

    if (searchForm) searchForm.removeEventListener('submit', this._onSearchSubmit);
    if (searchClose) searchClose.removeEventListener('click', this._onSearchClose);
    if (searchResults) searchResults.removeEventListener('click', this._onSearchResultClick);

    // 나침반 이벤트 해제
    if (this._onCompassUpdate) {
      document.removeEventListener('deviceorientation', this._onCompassUpdate, true);
    }

    // 회전 타이머 정리
    if (this._userRotationTimeout) {
      clearTimeout(this._userRotationTimeout);
      this._userRotationTimeout = null;
    }

    // 도착 타이머 정리
    if (this._arrivalTimeout) {
      clearTimeout(this._arrivalTimeout);
      this._arrivalTimeout = null;
    }

    // 오버레이/경로선 제거
    this._clearDestination();

    // 지도 제거 (카카오맵은 명시적인 destroy 메서드 없음)
    this.map = null;
  }
}

window.MapWidget = MapWidget;
