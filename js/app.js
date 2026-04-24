/**
 * HUD Mirror — 메인 애플리케이션 컨트롤러
 * MirrorEngine, HudWidgetsManager, MapWidget 오케스트레이션
 */

class HudApp {
  constructor() {
    this.mirror = null;
    this.widgets = null;
    this.mapWidget = null;
    this.isHudMode = false;
    this.brightness = 1.0;
    this._autoHudSpeedThreshold = 20; // km/h 이상에서 자동 HUD 모드 진입
    this._autoHudCooldown = false;
  }

  init() {
    // 미러 엔진 초기화 (#app 컨테이너에 적용)
    this.mirror = new MirrorEngine(document.getElementById('app'));

    // 위젯 매니저 초기화
    this.widgets = new HudWidgetsManager();

    // 지도 위젯 초기화
    this.mapWidget = new MapWidget();
    this.mapWidget.init();

    // 이벤트 연결
    this.setupEvents();

    // 설정 복원
    this.loadSettings();

    // 첫 방문 안전 경고
    this.checkFirstVisit();

    // GPS 속도 기반 자동 HUD 모드 감시
    this._watchAutoHud();
  }

  setupEvents() {
    // 반전 토글
    const btnMirror = document.getElementById('btn-mirror');
    if (btnMirror) {
      btnMirror.addEventListener('click', () => this.toggleMirror());
    }

    // HUD 모드 토글
    const btnHud = document.getElementById('btn-hud-mode');
    if (btnHud) {
      btnHud.addEventListener('click', () => this.toggleHudMode());
    }

    // 검색 버튼
    const btnSearch = document.getElementById('btn-search');
    if (btnSearch) {
      btnSearch.addEventListener('click', () => this.mapWidget.toggleSearch());
    }

    // 밝기 슬라이더
    const brightnessSlider = document.getElementById('brightness-slider');
    if (brightnessSlider) {
      brightnessSlider.addEventListener('input', (e) => {
        this.setBrightness(parseFloat(e.target.value));
      });
    }

    // 안전 경고 확인
    const safetyOk = document.getElementById('safety-ok');
    if (safetyOk) {
      safetyOk.addEventListener('click', () => {
        const overlay = document.getElementById('safety-overlay');
        if (overlay) overlay.style.display = 'none';
        try { localStorage.setItem('hud-mirror-visited', 'true'); } catch(e) {}
      });
    }

    // 네비게이션 중지 버튼
    const navStop = document.getElementById('nav-stop');
    if (navStop) {
      navStop.addEventListener('click', () => {
        if (this.mapWidget && this.mapWidget.isNavigating()) {
          this.mapWidget._stopNavigation();
        }
      });
    }
  }

  /** 좌우 반전 토글 */
  toggleMirror() {
    const enabled = this.mirror.toggle();
    const app = document.getElementById('app');
    if (enabled) {
      app.classList.add('mirror-active');
    } else {
      app.classList.remove('mirror-active');
    }
    this.saveSettings();
  }

  /** HUD 모드 토글 — 속도 오버레이, 주행 추적, 자동 반전 활성화 */
  toggleHudMode() {
    this.isHudMode = !this.isHudMode;
    const app = document.getElementById('app');
    const btnHud = document.getElementById('btn-hud-mode');

    if (this.isHudMode) {
      app.classList.add('hud-mode');

      // 위젯 시작 (GPS, 시계, 나침반)
      this.widgets.start();

      // 주행 기록 시작
      this.widgets.trip.start();

      // 속도 오버레이 표시 (CSS .hud-mode가 처리)
      const speedOverlay = document.getElementById('speed-overlay');
      if (speedOverlay) speedOverlay.style.display = '';

      // 주행 정보 표시
      const tripInfo = document.getElementById('trip-info');
      if (tripInfo) tripInfo.style.display = '';

      // 고도 표시
      const altEl = document.getElementById('altitude-value');
      if (altEl) altEl.style.display = '';

      // 자동으로 반전 활성화
      if (!this.mirror.isEnabled()) {
        this.toggleMirror();
      }

      if (btnHud) btnHud.textContent = '🖥️ 일반';

      // 지도 크기 갱신
      this.mapWidget.invalidateSize();
    } else {
      app.classList.remove('hud-mode');

      // 위젯 정지
      this.widgets.stop();

      // 주행 기록 정지 (데이터 유지)
      this.widgets.trip.stop();

      // 속도 오버레이 숨김
      const speedOverlay = document.getElementById('speed-overlay');
      if (speedOverlay) speedOverlay.style.display = 'none';

      // 주행 정보 숨김
      const tripInfo = document.getElementById('trip-info');
      if (tripInfo) tripInfo.style.display = 'none';

      if (btnHud) btnHud.textContent = '🖥️ HUD';
    }

    this.saveSettings();
  }

  /** 밝기 조절 */
  setBrightness(level) {
    this.brightness = level;
    const app = document.getElementById('app');
    if (app) {
      app.style.filter = `brightness(${level})`;
    }
    this.saveSettings();
  }

  /** GPS 속도 기반 자동 HUD 모드 진입 */
  _watchAutoHud() {
    document.addEventListener('gpsposition', (e) => {
      if (this.isHudMode || this._autoHudCooldown) return;

      const speed = e.detail.speed;
      if (speed !== null && speed !== undefined) {
        const kmh = speed * 3.6;
        if (kmh >= this._autoHudSpeedThreshold) {
          console.log(`자동 HUD 모드 진입 (속도: ${Math.round(kmh)} km/h)`);
          this.toggleHudMode();
          // 쿨다운 — 중복 토글 방지
          this._autoHudCooldown = true;
          setTimeout(() => { this._autoHudCooldown = false; }, 30000);
        }
      }
    });
  }

  /** 설정 저장 (localStorage) */
  saveSettings() {
    try {
      const settings = {
        brightness: this.brightness,
        hudMode: this.isHudMode,
        mirrorEnabled: this.mirror.isEnabled()
      };
      localStorage.setItem('hud-mirror-settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('설정 저장 실패:', e);
    }
  }

  /** 설정 복원 */
  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('hud-mirror-settings') || '{}');

      // 밝기 복원
      if (typeof saved.brightness === 'number') {
        this.brightness = saved.brightness;
        const slider = document.getElementById('brightness-slider');
        if (slider) slider.value = saved.brightness;
        this.setBrightness(saved.brightness);
      }

      // HUD 모드 복원
      if (saved.hudMode) {
        this.toggleHudMode();
      } else if (saved.mirrorEnabled) {
        // HUD 모드가 아니면 반전 상태만 복원
        this.toggleMirror();
      }
    } catch (e) {
      console.warn('설정 복원 실패:', e);
    }
  }

  /** 첫 방문 시 안전 경고 표시 */
  checkFirstVisit() {
    if (!localStorage.getItem('hud-mirror-visited')) {
      const overlay = document.getElementById('safety-overlay');
      if (overlay) overlay.style.display = '';
    }
  }
}

// 앱 시작
window.addEventListener('DOMContentLoaded', () => new HudApp().init());
