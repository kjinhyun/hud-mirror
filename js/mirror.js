/**
 * MirrorEngine — 좌우 반전 엔진
 * HUD Mirror PWA의 핵심: 화면 좌우 반전 기능
 */

class MirrorEngine {
  constructor(container) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('MirrorEngine requires a valid DOM container element');
    }
    this.container = container;
    this._enabled = false;
  }

  /** 미러 토글 — 활성화 여부 반환 */
  toggle() {
    this._enabled = !this._enabled;

    if (this._enabled) {
      this.container.classList.add('mirrored');
    } else {
      this.container.classList.remove('mirrored');
    }

    const event = new CustomEvent('mirrortoggle', {
      detail: { enabled: this._enabled }
    });
    this.container.dispatchEvent(event);

    return this._enabled;
  }

  isEnabled() {
    return this._enabled;
  }

  /**
   * 터치 이벤트 좌표를 반전시킨 객체 반환
   * 반전 모드일 때 iframe 내부의 터치 위치를 보정하는 용도
   */
  remapTouchEvent(event) {
    if (!this._enabled || !event) {
      return event;
    }

    const touches = event.touches ? Array.from(event.touches) : [];
    const changedTouches = event.changedTouches ? Array.from(event.changedTouches) : [];
    const screenWidth = window.innerWidth;

    const remapPoint = (point) => {
      if (!point || typeof point.clientX !== 'number') return point;
      const remapped = Object.assign({}, point, {
        clientX: screenWidth - point.clientX
      });
      if (typeof point.pageX === 'number') {
        remapped.pageX = window.pageXOffset + (screenWidth - (point.pageX - window.pageXOffset));
      }
      if (typeof point.screenX === 'number') {
        remapped.screenX = screen.width - point.screenX;
      }
      return remapped;
    };

    const remapped = {
      type: event.type,
      target: event.target,
      currentTarget: event.currentTarget,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      timestamp: event.timestamp,
      touches: touches.map(remapPoint),
      targetTouches: event.targetTouches ? Array.from(event.targetTouches).map(remapPoint) : [],
      changedTouches: changedTouches.map(remapPoint),
      isTrusted: event.isTrusted,
      _originalEvent: event,
    };

    if (event.pointerId !== undefined) {
      remapped.pointerId = event.pointerId;
      remapped.clientX = screenWidth - event.clientX;
      remapped.screenX = screen.width - event.screenX;
    }

    return remapped;
  }

  /** 리소스 정리 */
  destroy() {
    if (this._enabled) {
      this.container.classList.remove('mirrored');
      this._enabled = false;
    }
    this.container = null;
  }
}

window.MirrorEngine = MirrorEngine;
