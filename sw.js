const CACHE_STATIC = "cache-static-v1"; // AppShell (archivos del sitio)
const CACHE_DYNAMIC = "cache-dynamic-v1"; // Datos de la API

// 1. Estrategia: Primero Caché, luego Red (para archivos del sitio)
function cacheFirst(request) {
    return caches.match(request, { ignoreSearch: true })
        .then((respCache) => {
            // Si el archivo ya está en caché, lo entrega de inmediato
            if (respCache) {
                return respCache;
            }
            // Si no está en caché, intenta descargarlo de internet
            return fetch(request)
                .then((respNetwork) => {
                    return caches.open(CACHE_STATIC).then((cache) => {
                        cache.put(request, respNetwork.clone());
                        return respNetwork;
                    });
                })
                .catch((error) => {
                    console.warn("Sin conexión y recurso no encontrado:", request.url);
                    return caches.match("./index.html");
                });
        });
}

// 2. Estrategia: Primero Red, luego Caché (para la API de JsonPlaceholder)
function networkFirst(request) {
    return fetch(request)
        .then((respNetwork) => {
            return caches.open(CACHE_DYNAMIC).then((cache) => {
                cache.put(request, respNetwork.clone());
                return respNetwork;
            });
        })
        .catch(() => {
            return caches.match(request).then((respCache) => {
                if (respCache) {
                    return respCache;
                }
                return new Response(
                    JSON.stringify({ error: "No hay red ni caché disponible" }),
                    { status: 503, headers: { "Content-Type": "application/json" } }
                );
            });
        });
}

// Instalación: Guardamos los archivos esenciales (AppShell)
self.addEventListener("install", (event) => {
    console.log("SW instalado");
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_STATIC).then((cache) => {
            return cache.addAll([
                "./",
                "./index.html",
                "./styles.css",
                "./db-helper.js",
                "./app.js"
            ]);
        })
    );
});

// Activación: Limpiamos cachés viejas
self.addEventListener("activate", (event) => {
    console.log("SW activado");
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

// Interceptor de peticiones
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        event.request.url.includes("jsonplaceholder.typicode.com")
            ? networkFirst(event.request)
            : cacheFirst(event.request)
    );
});
