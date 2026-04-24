/**
 * HUD Widgets — 헤드업 디스플레이 위젯 모음
 * 시계, 나침반, 속도, 고도, 주행거리 위젯 관리
 */

// ===== 시계 위젯: HH:MM 표시 (운전 중 가독성 위해 초 제외) =====
class ClockWidget {
  constructor(el) {
    this.el = el;
    this._interval = null;
  }

  start() {
    this._update();
    this._interval = setInterval(() => this._update(), 10000); // 10초마다 갱신
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _update() {
    if (!this.el) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    this.el.textContent = `${hh}:${mm}`;
  }
}

// ===== 나침반 위젯: 방위각 표시 (iOS 13+ 권한 요청 포함) =====
class CompassWidget {
  constructor(el) {
    this.el = el;
    this._heading = null;
    this._onOrientation = null;
    this._started = false;
  }

  async start() {
    if (this._started) return;
    this._started = true;

    // iOS 13+에서는 명시적 권한 요청 필요
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          console.warn('나침반 권한 거부됨');
          return;
        }
      } catch (e) {
        console.warn('DeviceOrientationEvent 권한 요청 실패:', e);
        return;
      }
    }

    this._onOrientation = (e) => {
      // webkitCompassHeading (iOS) 또는 alpha (Android) 사용
      let heading = null;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        // Android alpha는 0~360 (북쪽 기준 시계방향)
        heading = e.alpha;
      }

      // 유효한 방위각만 업데이트 (jitter 방지)
      if (heading !== null && !isNaN(heading)) {
        this._heading = Math.round(heading);
        this._render();
      }
    };

    window.addEventListener('deviceorientation', this._onOrientation, true);
  }

  stop() {
    if (this._onOrientation) {
      window.removeEventListener('deviceorientation', this._onOrientation, true);
      this._onOrientation = null;
    }
    this._started = false;
  }

  getHeading() {
    return this._heading;
  }

  _render() {
    if (!this.el) return;
    this.el.textContent = `${this._heading}°`;
  }
}

// ===== 속도 위젯: km/h 표시 (정지 시 -- 표시로 jitter 방지) =====
class SpeedWidget {
  constructor(el) {
    this.el = el;
    this._speed = 0;
    this._threshold = 3; // km/h 미만은 -- 표시
  }

  update(coords) {
    if (!this.el) return;
    if (coords && coords.speed !== null && coords.speed !== undefined) {
      this._speed = coords.speed * 3.6; // m/s → km/h
    }
    this._render();
  }

  /** 외부에서 속도값 직접 설정 (GPS speed가 없을 때 대비) */
  setSpeed(kmh) {
    this._speed = kmh;
    this._render();
  }

  getSpeed() {
    return this._speed;
  }

  _render() {
    if (!this.el) return;
    if (this._speed < this._threshold) {
      this.el.textContent = '--';
    } else {
      this.el.textContent = Math.round(this._speed);
    }
  }
}

// ===== 고도 위젯: GPS 고도 표시 (m) =====
class AltitudeWidget {
  constructor(el) {
    this.el = el;
    this._altitude = null;
  }

  update(coords) {
    if (!this.el) return;
    if (coords && coords.altitude !== null && coords.altitude !== undefined && !isNaN(coords.altitude)) {
      this._altitude = coords.altitude;
      this.el.textContent = `${Math.round(this._altitude)}m`;
      this.el.style.display = '';
    } else {
      this._altitude = null;
      this.el.textContent = '--m';
      // 고도 정보 없으면 숨김
      this.el.style.display = 'none';
    }
  }

  getAltitude() {
    return this._altitude;
  }
}

// ===== 주행 정보 위젯: 누적 거리 + 경과 시간 =====
class TripWidget {
  constructor(distanceEl, timeEl, infoEl) {
    this.distanceEl = distanceEl;
    this.timeEl = timeEl;
    this.infoEl = infoEl; // #trip-info 컨테이너
    this._active = false;
    this._distance = 0; // 미터 단위
    this._startTime = null;
    this._timerInterval = null;
    this._lastPos = null;
  }

  start() {
    this._active = true;
    this._distance = 0;
    this._startTime = Date.now();
    this._lastPos = null;
    this._renderDistance();
    this._renderTime();
    if (this.infoEl) this.infoEl.style.display = '';
    this._timerInterval = setInterval(() => this._renderTime(), 1000);
  }

  stop() {
    this._active = false;
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  reset() {
    this.stop();
    this._distance = 0;
    this._startTime = null;
    this._lastPos = null;
    this._renderDistance();
    this._renderTime();
    if (this.infoEl) this.infoEl.style.display = 'none';
  }

  isActive() {
    return this._active;
  }

  /** GPS 위치 업데이트 시 호출 — Haversine 공식으로 거리 누적 */
  updatePosition(coords) {
    if (!this._active || !coords) return;

    const lat = coords.latitude;
    const lon = coords.longitude;
    if (lat === null || lon === null) return;

    if (this._lastPos) {
      const d = this._haversine(this._lastPos.lat, this._lastPos.lon, lat, lon);
      // GPS 오차로 인한 비정상적 점프 필터링 (한 번에 500m 이상 이동 무시)
      if (d < 500) {
        this._distance += d;
      }
    }

    this._lastPos = { lat, lon };
    this._renderDistance();
  }

  getDistance() {
    return this._distance;
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

  _renderDistance() {
    if (!this.distanceEl) return;
    if (this._distance >= 1000) {
      this.distanceEl.textContent = `${(this._distance / 1000).toFixed(1)} km`;
    } else {
      this.distanceEl.textContent = `${Math.round(this._distance)} m`;
    }
  }

  _renderTime() {
    if (!this.timeEl) return;
    if (!this._startTime) {
      this.timeEl.textContent = '00:00';
      return;
    }
    const elapsed = Math.floor((Date.now() - this._startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    if (h > 0) {
      this.timeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
      this.timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }
}

// ===== HUD 위젯 관리자 — 모든 위젯 오케스트레이션 =====
class HudWidgetsManager {
  constructor() {
    // DOM 요소 참조
    this.clockEl = document.getElementById('clock-value');
    this.compassEl = document.getElementById('compass-value');
    this.speedEl = document.getElementById('speed-value');
    this.altitudeEl = document.getElementById('altitude-value');
    this.tripDistEl = document.getElementById('trip-distance');
    this.tripTimeEl = document.getElementById('trip-time');
    this.tripInfoEl = document.getElementById('trip-info');

    // 위젯 인스턴스 생성
    this.clock = new ClockWidget(this.clockEl);
    this.compass = new CompassWidget(this.compassEl);
    this.speed = new SpeedWidget(this.speedEl);
    this.altitude = new AltitudeWidget(this.altitudeEl);
    this.trip = new TripWidget(this.tripDistEl, this.tripTimeEl, this.tripInfoEl);

    // GPS 위치 추적 ID
    this._watchId = null;
    this._running = false;
  }

  /** GPS 감시 시작 + 시계/나침반 활성화 */
  start() {
    if (this._running) return;
    this._running = true;

    this.clock.start();
    this.compass.start();

    // GPS 위치 감시
    if ('geolocation' in navigator) {
      this._watchId = navigator.geolocation.watchPosition(
        (pos) => this._onPosition(pos),
        (err) => console.warn('GPS 오류:', err.message),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }
  }

  /** 모든 위젯 정지 + GPS 해제 */
  stop() {
    this._running = false;

    this.clock.stop();
    this.compass.stop();

    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  /** 주행 기록 시작/정지 토글 */
  toggleTrip() {
    if (this.trip.isActive()) {
      this.trip.stop();
    } else {
      this.trip.start();
      // GPS가 아직 시작되지 않았다면 함께 시작
      if (!this._running) this.start();
    }
    return this.trip.isActive();
  }

  isRunning() {
    return this._running;
  }

  /** GPS 위치 콜백 */
  _onPosition(pos) {
    const coords = pos.coords;

    // 속도 위젯 업데이트
    this.speed.update(coords);

    // 고도 위젯 업데이트
    this.altitude.update(coords);

    // 주행 거리 업데이트
    this.trip.updatePosition(coords);

    // 외부로 위치 이벤트 전달 (맵 위젯 등에서 활용)
    const event = new CustomEvent('gpsposition', {
      detail: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        altitude: coords.altitude,
        speed: coords.speed,
        heading: coords.heading
      }
    });
    document.dispatchEvent(event);
  }

  /** 현재 속도(km/h) 반환 */
  getSpeed() {
    return this.speed.getSpeed();
  }

  /** 현재 나침반 방위각 반환 */
  getHeading() {
    return this.compass.getHeading();
  }

  /** 리소스 정리 */
  destroy() {
    this.stop();
    this.trip.reset();
  }
}

window.ClockWidget = ClockWidget;
window.CompassWidget = CompassWidget;
window.SpeedWidget = SpeedWidget;
window.AltitudeWidget = AltitudeWidget;
window.TripWidget = TripWidget;
window.HudWidgetsManager = HudWidgetsManager;
