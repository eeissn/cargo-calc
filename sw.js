const scope = self.registration.scope;
const prefix = "cargo-calc:" + scope + ":";
const cacheName = prefix + "v1";
const indexUrl = new URL("index.html", scope).href;
const iconUrl = new URL("favicon-32.png", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([new Request(indexUrl, { cache: "reload" }), iconUrl]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.search = "";
  if (request.mode === "navigate" && (url.href === scope || url.href === indexUrl)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          try {
            const cache = await caches.open(cacheName);
            await cache.put(indexUrl, response.clone());
          } catch (error) {
            // Онлайн-страница доступна даже при заполненном кэше.
          }
          return response;
        }
        if (response.status < 500) return response;
      } catch (error) {
        // После успешной установки в кэше есть рабочая страница.
      }
      return (await caches.match(indexUrl, { cacheName })) || Response.error();
    })());
  } else if (url.href === iconUrl) {
    event.respondWith((async () => (await caches.match(iconUrl, { cacheName })) || fetch(request))());
  }
});
