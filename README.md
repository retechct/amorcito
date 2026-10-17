# Nosotros — un pequeño universo para dos

Un archivo de pareja en vino, crema y dorado: candado de corazón, fotografías sobre una mesa, una galería 3D, álbumes, meses, favoritos, vídeo y cartas que se abren como sobres. El taller de administración queda separado de la visita romántica.

## Vercel: preparar una vez, después `git push`

El proyecto incluye ahora una **API para Vercel**, **Neon/Postgres** para el archivo, claves derivadas, sesiones y bloqueos, y **Cloudinary authenticated** para fotos y vídeos privados. No usa SQLite ni el disco temporal de Vercel para guardar recuerdos.

La configuración inicial no puede aparecer a partir de un `git push`: Git no lleva los secretos. El asistente los lee de `.env.local` y los carga en Vercel mediante su API, una sola vez. Los despliegues posteriores reutilizan esas variables y los datos existentes.

### Primera vez, en este ordenador

1. En `.env.local`, comprueba `DATABASE_URL` de Neon y `CLOUDINARY_URL`. Copia las cadenas completas desde los proveedores, no desde una captura. No subas este archivo a Git. Si compartiste claves en una imagen, rótalas y actualiza este archivo.
2. El proyecto de Vercel debe estar conectado a este mismo repositorio de GitHub, con la rama de producción correcta en **Settings → Git**. No crees otro proyecto para esta migración.
3. Ejecuta desde esta carpeta:

```powershell
npm.cmd install
npm.cmd run vercel:setup
```

El asistente comprueba ambos proveedores antes de modificar nada. Después solicita el nombre/ID de tu proyecto existente, el ID del equipo si corresponde y un [token temporal de Vercel](https://vercel.com/account/settings/tokens). La entrada del token es oculta, no se guarda ni se envía a la web. Usa un token del equipo del proyecto; puedes revocarlo al terminar. También admite esos datos en las variables locales opcionales de `.env.example`.

Antes de continuar muestra el proyecto y el repositorio comprobados y pide escribir `SI`. Entonces:

- Crea únicamente el esquema `nosotros` en Neon.
- Importa el archivo local y sus fotos/miniaturas/vídeo como recursos **authenticated**, no públicos. La fecha del candado y la clave de administración se conservan mediante sus hashes; no se publican en JavaScript.
- Si se interrumpe, puedes repetirlo: reutiliza los archivos ya importados. Si el archivo remoto ya existe, no sobrescribe sus recuerdos ni claves con la copia local.
- Carga `DATABASE_URL` y `CLOUDINARY_URL` como variables **sensibles de Production**. Si definiste `APP_ORIGIN`, también la carga. No toca otras variables ni envía `VERCEL_TOKEN` al servidor.

Cuando termine correctamente:

```powershell
git add .
git commit -m "Preparar archivo privado para Vercel, Neon y Cloudinary"
git push
```

Vercel usa `vercel.json`, ejecuta `npm run build`, publica solo los cuatro archivos permitidos de `dist/` y crea la función que atiende `/api/*` y `/media/*`. Debes hacer el push a la rama configurada como producción. El asistente no hace commits, pushes ni despliegues por su cuenta.

### Después de la primera configuración

Para cambios de código: commit + `git push`. Para añadir fotos o cambiar meses/álbumes: usa el taller en la propia web, sin desplegar otra vez. **El archivo local y el remoto son independientes** después de la importación inicial.

Las claves no se cargan en Preview deliberadamente: una rama de prueba no debe tener acceso automático a las fotos reales. Para habilitar vistas previas, prepara otro proyecto/base/entorno Cloudinary con datos de prueba. Si utilizas un dominio propio y aparece “Origen no permitido”, configura `APP_ORIGIN="https://tu-dominio.example"` sin barra final y vuelve a ejecutar el asistente antes del siguiente despliegue.

### Comprobar o resolver errores

```powershell
npm.cmd run cloud:check
npm.cmd run build
npm.cmd test
```

- **Neon rechazó la conexión**: corrige la cadena en `.env.local`; una contraseña equivocada no se arregla haciendo deploy. El asistente se detiene antes de importar fotos.
- **404 en `/api/session` o `/api/login`**: comprueba que subiste `api/`, `server/` y `vercel.json`, que Vercel construye desde esta carpeta y que ves el despliegue nuevo, no el estático anterior.
- **503 de configuración**: faltan variables, conexión a Neon o preparación inicial. Completa el asistente y haz un nuevo deploy. Cambiar variables no modifica un despliegue ya creado.
- **403 de Vercel durante el asistente**: revisa equipo, proyecto y permisos/caducidad del token.
- **429 del candado**: es el bloqueo temporal. Ni un deploy ni borrar cookies lo reinician.
- **Funciona en Production pero no en Preview**: es intencionado; no se copian secretos de producción a ramas de prueba.

La verificación local de la API cloud utiliza Postgres mediante PGlite y Cloudinary simulado; no sustituye comprobar el despliegue real. Opcionalmente, `npm run test:cloudinary:live` sube una imagen sintética a tu Cloudinary, comprueba su privacidad y retira únicamente ese recurso de prueba.

Referencias de implementación: [variables de Vercel](https://vercel.com/docs/environment-variables), [API de variables](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables), [driver de Neon](https://neon.com/docs/serverless/serverless-driver) y [acceso privado de Cloudinary](https://cloudinary.com/documentation/control_access_to_media).

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
6. Puedes añadir hasta 10 JPG, PNG o WebP por carga, crear álbumes escribiendo un nombre y escribir/editar cartas. Las cargas se optimizan, se comprueban en el servidor y se guardan de forma persistente, no solo en el navegador. En Vercel cada imagen viaja directamente a Cloudinary con una firma temporal autorizada por administración; la API verifica el recurso privado antes de aceptarlo.
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
- Contadores persistidos en SQLite en local y **Neon en Vercel**: recargar, borrar cookies o desplegar de nuevo no elimina el bloqueo. En Neon se reservan intentos de forma atómica, compartidos entre instancias. En Vercel se usa la IP que proporciona la plataforma; en local se ignoran cabeceras de IP arbitrarias.
- Sesiones aleatorias con cookies **HttpOnly, SameSite=Strict**, expiración y revocación. Visita: 12 horas; administración: 1 hora.
- Comprobación de origen y token CSRF en cambios. El servidor comprueba los permisos, aunque alguien altere la interfaz.
- Cada foto, miniatura y vídeo exige una sesión; los ocultos solo se entregan a administración. Caché desactivada para contenido privado.
- En Cloudinary se usa `authenticated` para originales y miniaturas. El servidor descarga mediante un enlace de 60 segundos y entrega el contenido por `/media/`; no devuelve un enlace permanente firmado al navegador. Esas descargas privadas pueden consumir más ancho de banda que la entrega pública por CDN: revisa las cuotas de Vercel, Neon y Cloudinary.
- Guardado con revisión: se rechazan sobrescrituras si otra sesión actualizó el archivo. Se recarga la versión nueva y se pide revisar el cambio.
- No hay eliminación permanente de fotos en la interfaz.

**No es invulnerable.** Una fecha de seis dígitos sigue siendo un secreto débil para alguien que conoce vuestra historia. Los límites reducen la fuerza bruta, pero no evitan que alguien conozca o adivine la fecha; un atacante también podría provocar bloqueos temporales. No son protección DDoS. Para fotografías especialmente sensibles conviene una contraseña de entrada larga o autenticación adicional. Las personas que ya tuvieron acceso pueden guardar copias. Los archivos en el disco del servidor no están cifrados por esta aplicación.

Criterios de referencia: [autenticación de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) y [sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Respaldos y versión anterior

En modo administrador, el pie de la página ofrece **Crear respaldo** e **Importar respaldo**. El JSON incluye fotografías, vídeo con miniatura, textos, meses y favoritos. La importación combina por ID y fecha de edición sin borrar entradas existentes; admite hasta 80 MB por respaldo. Ese JSON es privado: no lo publiques ni lo subas a un repositorio.

Para una copia completa del servicio, detén el servidor y copia **`.private/` y `private-media/` juntas** a un lugar seguro. Conserva también los originales y el código. No copies solo `archive.sqlite` con el servidor en marcha: SQLite utiliza archivos WAL.

En Vercel, la copia local inicial **no es un respaldo actualizado**: exporta desde el taller y configura copias de Neon y de Cloudinary. El JSON de la interfaz no incluye credenciales ni sesiones. Las cargas incompletas pueden dejar recursos privados sin usar; no se eliminan automáticamente para evitar pérdidas. El límite por medio aceptado es 20 MB y el de textos/metadatos por guardado en Vercel es 3,8 MB; las imágenes no viajan dentro de esa petición. Una restauración grande puede tardar y consumir la cuota de API de Cloudinary.

El botón **Recuperar recuerdos de la versión anterior** lee el IndexedDB anterior, si existe en el mismo navegador y dirección. No lo borra. Si antes abrías desde otro dominio o puerto, usa el respaldo de aquella versión para recuperar las fotos.

## Alternativa: servidor Node con disco persistente

Esta sección solo se aplica si no utilizas Vercel. La versión SQLite local puede alojarse en un servidor Node con disco persistente y HTTPS. No sirve GitHub Pages ni publicar solo `index.html`.

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

Las pruebas arrancan servidores aislados con claves y datos de prueba. No editan vuestro archivo. Cubren las versiones SQLite y cloud: SQL de Postgres, importación inicial repetible, sincronización segura de variables, acceso directo, permisos, cookies, CSRF, bloqueos concurrentes y persistentes, cambio de clave, galería 3D, meses, cambios por lotes, favoritos, cargas directas, respaldo/importación, recuperación del archivo anterior, vídeo y tamaños móvil/escritorio. Las capturas locales quedan en `.qa/`, excluida de Git.

## Estructura

- `index.html`, `style.css`, `script.js`: experiencia e interfaz.
- `server.mjs`, `server/security.mjs`: servidor, acceso, límites y persistencia.
- `api/router.mjs`, `server/cloud-*.mjs`: API Vercel, Neon y medios privados.
- `vercel.json`, `scripts/build.mjs`: rutas y compilación pública por lista permitida.
- `scripts/vercel-setup.mjs`, `scripts/cloud-prepare.mjs`: configuración única e importación privada, fuera del build.
- `scripts/`: preparación privada de las fotografías y del acceso.
- `tests/security.mjs`, `tests/browser-secure.cjs`: verificaciones.

La versión local no necesita compilación. El build de Vercel copia únicamente los archivos públicos permitidos; nunca importa fotos ni modifica la base. Google Fonts aporta la tipografía; hay alternativas locales si no carga.

## Dirección visual y referencias

Se mantiene la paleta de la pareja y se añade profundidad mediante transformaciones CSS, sin un bucle 3D pesado ni reproducción automática de vídeos. Las animaciones respetan la preferencia de movimiento reducido.

En la exploración anterior se intentó consultar TikTok, pero bloqueó el acceso automatizado: no se visualizaron ni se copiaron vídeos. Se consultaron descripciones públicas de [Love Lock](https://lovelock.love/), [2Luv](https://www.2-luv.com/es/event/regalo-digital-para-tu-amor) y [Tu Carta Eterna](https://tucartaeterna.com/) para estudiar las interacciones de candado, álbum y cartas. La composición se desarrolló alrededor de vuestras propias fotografías.
