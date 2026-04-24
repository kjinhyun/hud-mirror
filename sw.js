// HUD Mirror PWA — Service Worker v3
// 카카오맵 SDK 기반 캐시 업데이트

const CACHE = 'hud-mirror-v4';

// 오프라인 캐싱 대상 에셋
const ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/mirror.js',
  '/js/hud-widgets.js',
  '/js/map-widget.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/favicon.svg',
  // 카카오맵 SDK
  'https://dapi.kakao.com/v2/maps/sdk.js?appkey=e9562b51a309f295c4407b63c7efd644&libraries=services'
];

// 설치: 에셋 사전 캐싱
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 활성화: 이전 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 요청 가로채기: 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', (e) => {
  // API 요청은 캐시하지 않음 (실시간 데이터)
  const url = new URL(e.request.url);
  if (url.hostname.includes('osrm') ||
      url.hostname.includes('apis-navi.kakao.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((response) => {
        // 성공적인 응답만 동적 캐싱
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // 오프라인 폴백
      if (e.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});
