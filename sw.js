importScripts('./db-helper.js');
const CACHE_STATIC = "cache-static-v2"; // AppShell (archivos del sitio)
const CACHE_DYNAMIC = "cache-dynamic-v1"; // Datos de la API
const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
    './',
    './index.html',
    './styles.css',
    './db-helper.js',
    './app.js',
    './manifest.json'
];
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

function notificarClientesActualizacion() {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientes) => {
            clientes.forEach((cliente) => {
                cliente.postMessage({
                    tipo: 'OUTBOX_SINCRONIZADO',
                    timestamp: Date.now()
                });
            });
        });
}

function sincronizarPendientesSW() {
    console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

    return obtenerTodosLosRegistros()
        .then((registros) => {
            const pendientes = registros.filter((item) => item.estado === 'pendiente');

            if (pendientes.length === 0) {
                console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
                return;
            }

            const promesasDeEnvio = pendientes.map((item) => {
                return fetch('<https://jsonplaceholder.typicode.com/posts>', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: item.titulo,
                        body: item.descripcion
                    })
                })
                    .then((respuesta) => {
                        if (!respuesta.ok) {
                            throw new Error(`Error HTTP ${respuesta.status} al sincronizar ID ${item.id}`);
                        }
                        return actualizarEstadoRegistro(item.id, 'sincronizado');
                    });
            });

            return Promise.all(promesasDeEnvio)
                .then(() => notificarClientesActualizacion());
        });
}

self.addEventListener('sync', (event) => {
    console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

    if (event.tag === 'sync-reportes') {
        event.waitUntil(
            sincronizarPendientesSW()
                .catch((error) => {
                    console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
                    // Relanzar el error indica al navegador que debe programar un reintento automático
                    throw error;
                })
        );
    }
});

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
                "./manifest.json",
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
        }).then(() => self.clients.claim())
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
