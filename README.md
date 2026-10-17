# Nosotros — un pequeño universo para dos

Un archivo de pareja en vino, crema y dorado: candado de corazón, fotografías sobre una mesa, una galería 3D, álbumes, meses, favoritos, vídeo y cartas que se abren como sobres. El taller de administración queda separado de la visita romántica.

## Abrir el proyecto

Requiere Node.js 22.19 o posterior compatible con `node:sqlite`. En esta carpeta:

```powershell
npm.cmd install
npm.cmd start
```

Abre **http://127.0.0.1:4173**. La clave del candado ya está configurada con la fecha acordada. Elige los tres pares y pulsa **Abrir nuestro rincón**: girar una rueda no consume intentos.

**No uses Live Server, Python http.server, file:// ni alojamiento estático.** Ahora hacen falta el servidor y su API. Servir toda esta carpeta como archivos públicos puede exponer fotos, respaldos y credenciales.

## Tu taller privado

1. Abre el candado y pulsa **Cuidar lo nuestro**.
2. Obtén la clave inicial de administración en `.private/admin-access.txt`. Es distinta del candado. Guárdala en tu gestor de contraseñas y no compartas ese archivo.
3. En el taller puedes buscar por título, álbum o nombre original; filtrar por mes y álbum; seleccionar varias fotos y cambiarles el mes o álbum de una vez.
4. **Destacar en el universo** escoge los recuerdos del recorrido 3D. **Ocultar** los retira de la visita sin borrarlos: puedes volver a mostrarlos.
5. **Editar detalles** cambia título, texto, fecha y mes. Un mes no obliga a inventar un día. **Dejar sin mes** conserva la fecha original.
6. Puedes añadir hasta 10 JPG, PNG o WebP por carga, crear álbumes escribiendo un nombre y escribir/editar cartas. Las cargas se optimizan, se comprueban en el servidor y se guardan allí, no solo en el navegador.
7. Al final del taller puedes cambiar la clave de administración (mínimo 14 caracteres). Eso invalida las otras sesiones administrativas; el archivo de clave inicial no se actualiza.
8. **Salir de administración** vuelve a la visita. El candado de la cabecera cierra toda la sesión.

Los cambios se comparten entre los navegadores que usan **el mismo servidor**. No hace falta pasar un respaldo a tu pareja para cada cambio.

## Imágenes incorporadas

Se incorporaron **80 fotografías y 1 vídeo**: las tres imágenes iniciales, las dos HEIC nuevas y el contenido del ZIP. Los originales y el ZIP se conservan intactos.

- Fotografías convertidas a JPEG de hasta 1800 px, con miniaturas para navegar con fluidez.
- MOV convertido a MP4 H.264 reproducible desde el visor.
- Meses iniciales: enero, febrero, marzo y abril de 2026, obtenidos de los metadatos disponibles. Dos imágenes quedan sin fecha. La fecha de una cámara puede estar equivocada; puedes corregirla desde el taller.
- Se quitan metadatos como GPS de las copias que entrega la web.
- Ocho imágenes forman la selección inicial del universo. Puedes cambiarla.
- No se eliminan imágenes visualmente parecidas: tú decides qué recuerdos destacar u ocultar.

Las fotos se encuentran en `private-media/`; catálogo, claves, sesiones y archivo están en `.private/`. Ambas carpetas están excluidas de Git. Algunas imágenes originales ya estaban versionadas antes de este cambio: no publiques el repositorio como si estuviera libre de fotografías privadas.

Para repetir la importación local de archivos del proyecto, con el servidor detenido:

```powershell
python -m pip install Pillow pillow-heif imageio-ffmpeg
npm.cmd run import:photos
npm.cmd run import:video
npm.cmd start
```

El arranque agrega IDs nuevos sin sobrescribir recuerdos existentes. La carga normal del taller acepta JPG/PNG/WebP; nuevas HEIC o vídeos se preparan con los importadores locales.

## Protección del acceso

La comprobación ocurre en el servidor. La fecha, su hash y el contenido del archivo no se envían en el HTML ni en el JavaScript público.

- Contraseñas derivadas con **scrypt y sal aleatoria**.
- Cinco intentos por origen de red dentro de la ventana de 15 minutos activan esperas progresivas: 30 s, 2 min, 8 min, 32 min, hasta una hora. Un acceso correcto limpia el contador de esa IP.
- Límite global adicional de 30 intentos por 15 minutos para frenar intentos repartidos. Al alcanzarlo, pausa de 15 minutos; cuenta también los accesos correctos.
- Contadores persistidos en SQLite: recargar, borrar cookies o reiniciar el servidor no elimina el bloqueo. No se confía en una cabecera de IP arbitraria.
- Sesiones aleatorias con cookies **HttpOnly, SameSite=Strict**, expiración y revocación. Visita: 12 horas; administración: 1 hora.
- Comprobación de origen y token CSRF en cambios. El servidor comprueba los permisos, aunque alguien altere la interfaz.
- Cada foto, miniatura y vídeo exige una sesión; los ocultos solo se entregan a administración. Caché desactivada para contenido privado.
- Guardado con revisión: se rechazan sobrescrituras si otra sesión actualizó el archivo. Se recarga la versión nueva y se pide revisar el cambio.
- No hay eliminación permanente de fotos en la interfaz.

**No es invulnerable.** Una fecha de seis dígitos sigue siendo un secreto débil para alguien que conoce vuestra historia. Los límites reducen la fuerza bruta, pero no evitan que alguien conozca o adivine la fecha; un atacante también podría provocar bloqueos temporales. No son protección DDoS. Para fotografías especialmente sensibles conviene una contraseña de entrada larga o autenticación adicional. Las personas que ya tuvieron acceso pueden guardar copias. Los archivos en el disco del servidor no están cifrados por esta aplicación.

Criterios de referencia: [autenticación de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) y [sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Respaldos y versión anterior

En modo administrador, el pie de la página ofrece **Crear respaldo** e **Importar respaldo**. El JSON incluye fotografías, vídeo con miniatura, textos, meses y favoritos. La importación combina por ID y fecha de edición sin borrar entradas existentes; admite hasta 80 MB por respaldo. Ese JSON es privado: no lo publiques ni lo subas a un repositorio.

Para una copia completa del servicio, detén el servidor y copia **`.private/` y `private-media/` juntas** a un lugar seguro. Conserva también los originales y el código. No copies solo `archive.sqlite` con el servidor en marcha: SQLite utiliza archivos WAL.

El botón **Recuperar recuerdos de la versión anterior** lee el IndexedDB anterior, si existe en el mismo navegador y dirección. No lo borra. Si antes abrías desde otro dominio o puerto, usa el respaldo de aquella versión para recuperar las fotos.

## Publicarlo en internet

**Este trabajo está preparado y probado localmente; no se ha desplegado.** Necesita alojamiento con Node, disco persistente y HTTPS. No sirve GitHub Pages ni publicar solo `index.html`.

Configuración de producción:

```text
NODE_ENV=production
APP_ORIGIN=https://tu-dominio.example
HOST=127.0.0.1
PORT=4173
DATA_DIR=/ruta/privada/persistente/datos
MEDIA_DIR=/ruta/privada/persistente/fotos
```

Coloca un proxy HTTPS delante de Node; todas las rutas deben llegar a este servidor, sin exponer ninguna carpeta privada. En producción las cookies tienen `Secure` y se activa HSTS. Si hay un proxy, configura `TRUSTED_PROXY_IP` con su IP exacta y asegúrate de que el proxy sobrescribe/añade correctamente X-Forwarded-For y que Node no acepta tráfico público directo. Sin esa configuración, todos los visitantes tras el proxy comparten el límite de la IP del proxy.

Usa una sola instancia de Node sobre ese disco SQLite; no almacenes fotos en un disco efímero. Programa respaldos, limita el tráfico en el proxy y mantén Node y sus dependencias actualizados. No subas la carpeta de originales como recursos estáticos.

Las claves están configuradas en este proyecto. Para una instalación vacía, `npm.cmd run setup` acepta por entrada estándar un JSON con `entry` (seis dígitos) y `admin` opcional (al menos 14 caracteres). La entrada interactiva está oculta; no pases claves en argumentos de consola. Si omites `admin`, genera una clave aleatoria y la deja en el archivo privado indicado.

## Pruebas

```powershell
npx.cmd playwright install chromium
npm.cmd test
```

Las pruebas arrancan servidores aislados con claves y datos de prueba. No editan vuestro archivo. Cubren acceso directo, permisos, cookies, CSRF, bloqueos concurrentes y persistentes, cambio de clave, galería 3D, meses, cambios por lotes, favoritos, cargas, respaldo/importación, recuperación del archivo anterior, vídeo y tamaños móvil/escritorio. Las capturas locales quedan en `.qa/`, excluida de Git.

## Estructura

- `index.html`, `style.css`, `script.js`: experiencia e interfaz.
- `server.mjs`, `server/security.mjs`: servidor, acceso, límites y persistencia.
- `scripts/`: preparación privada de las fotografías y del acceso.
- `tests/security.mjs`, `tests/browser-secure.cjs`: verificaciones.

No necesita compilación. Google Fonts aporta la tipografía; hay alternativas locales si no carga.

## Dirección visual y referencias

Se mantiene la paleta de la pareja y se añade profundidad mediante transformaciones CSS, sin un bucle 3D pesado ni reproducción automática de vídeos. Las animaciones respetan la preferencia de movimiento reducido.

En la exploración anterior se intentó consultar TikTok, pero bloqueó el acceso automatizado: no se visualizaron ni se copiaron vídeos. Se consultaron descripciones públicas de [Love Lock](https://lovelock.love/), [2Luv](https://www.2-luv.com/es/event/regalo-digital-para-tu-amor) y [Tu Carta Eterna](https://tucartaeterna.com/) para estudiar las interacciones de candado, álbum y cartas. La composición se desarrolló alrededor de vuestras propias fotografías.
