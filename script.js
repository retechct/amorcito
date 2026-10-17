/* Nosotros — un archivo íntimo. Autenticación y persistencia en el servidor. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let START = null;
  let auth = { authenticated: false, role: null, csrf: null };
  let cooldownUntil = 0, checking = false, adminCooldownUntil = 0;
  let monthFilter = "all", photoLimit = 24, orbitIndex = 0;
  const selected = new Set();
  const albumDescriptions = {
    "Noches de luz":
      "Dos personas, miles de luces y un recuerdo al que siempre volver.",
    "Lo que celebramos":
      "Los logros se vuelven más bonitos cuando podemos compartirlos.",
  };
  let archive = { memories: [], letters: [], favorites: [], revision: 0 };
  let unlocked = false, unlocking = false;
  let filter = "all",
    viewerIds = [],
    viewerIndex = 0,
    activeAlbum = "",
    activeLetter = "";
  let editorMode = "memory",
    editingId = null,
    selectedFiles = [],
    previewURLs = [],
    toastTimer;
  let observer;
  const icon = (name) =>
    '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const pad = (n) => String(n).padStart(2, "0");
  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "entry-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      4200,
    );
  }
  function prettyDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("es-PE", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Lima",
    }).format(new Date(value + "T12:00:00-05:00"));
  }

  async function api(path, method = "GET", data) {
    let response;
    try {
      response = await fetch(path, {
        method, credentials: "same-origin",
        headers: { ...(data === undefined ? {} : {"Content-Type":"application/json"}), ...(auth.csrf ? {"X-CSRF-Token":auth.csrf} : {}) },
        ...(data === undefined ? {} : {body:JSON.stringify(data)}),
      });
    } catch { throw new Error("No se pudo conectar. Comprueba que el servidor esté encendido."); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || (response.status === 404 ? "La API no está desplegada. Revisa la configuración del servidor en Vercel." : "No se pudo completar la operación."));
      error.status = response.status; error.retryAfter = result.retryAfter || 0;
      if (response.status === 401 && !path.endsWith("/login") && path !== "/api/admin/password") {
        location.reload();
      }
      throw error;
    }
    return result;
  }
  async function saveArchive(next) {
    if (auth.role !== "admin") throw new Error("Abre el taller con tu clave de administración.");
    try {
      const revision = archive.revision;
      if (auth.uploadMode === "cloudinary") next = await uploadCloudMemories(next);
      archive = await api("/api/archive", "PUT", {...next, revision});
    } catch (error) {
      if (error.status === 409) {
        archive = await api("/api/archive");
        renderAll();
        error.message = "Otra sesión actualizó el archivo. Ya cargamos sus cambios; revisa y vuelve a guardar.";
      }
      throw error;
    }
  }
  function dataBlob(source) {
    const match = typeof source === "string" && source.match(/^data:(image\/(?:jpeg|png|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || source.length > 28 * 1024 * 1024) throw new Error("Archivo no válido o superior a 20 MB.");
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Cada archivo debe pesar menos de 20 MB.");
    return new Blob([bytes], {type:match[1]});
  }
  async function cloudUpload(source) {
    const file = dataBlob(source);
    const ticket = await api("/api/uploads/sign", "POST", {resourceType:file.type.startsWith("video/")?"video":"image"});
    const form = new FormData();
    for (const [key,value] of Object.entries(ticket.fields)) form.append(key, String(value));
    form.append("file", file);
    let response;
    try { response = await fetch(ticket.url, {method:"POST",body:form,credentials:"omit",signal:AbortSignal.timeout(120000)}); }
    catch { throw new Error("Se interrumpió la carga. Comprueba tu conexión y vuelve a guardar."); }
    if (!response.ok) throw new Error("Cloudinary no pudo guardar el archivo. Revisa su configuración y espacio disponible.");
    // Never trust the browser's upload response as proof of ownership/privacy.
    return (await api("/api/uploads/complete", "POST", {id:ticket.id})).path;
  }
  async function cloudThumbnail(source) {
    const image = new Image(); image.src = source; await image.decode();
    const scale = Math.min(1, 480 / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth*scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight*scale));
    canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/jpeg",0.82);
  }
  async function uploadCloudMemories(next) {
    const memories=[];
    for (const memory of next.memories) {
      if (!memory.src?.startsWith("data:")) { memories.push(memory); continue; }
      const video=memory.src.startsWith("data:video/");
      const thumb=video?memory.thumb:await cloudThumbnail(memory.src);
      if (!thumb?.startsWith("data:image/")) throw new Error("El respaldo del vídeo necesita una miniatura.");
      const src=await cloudUpload(memory.src), thumbnail=await cloudUpload(thumb);
      memories.push({...memory,src,thumb:thumbnail,kind:video?"video":"photo"});
    }
    return {...next,memories};
  }
  function validateArchive(data) {
    if (!data || !Array.isArray(data.memories) || !Array.isArray(data.letters) || data.memories.length > 2000 || data.letters.length > 200)
      throw new Error("El respaldo no tiene un formato válido.");
    return {memories:data.memories,letters:data.letters,favorites:Array.isArray(data.favorites)?data.favorites:[]};
  }
  const visibleMemories = () => archive.memories.filter(m => !m.hidden);
  const monthName = month => month ? new Intl.DateTimeFormat("es-PE",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-15T12:00:00Z")) : "Sin fecha";
  function applyRole() {
    $$("[data-admin-only]").forEach(el => {el.hidden = auth.role !== "admin";});
    $("#open-admin").classList.toggle("is-admin", auth.role === "admin");
    $("#storage-status").textContent = auth.role === "admin" ? "Modo administrador · cambios guardados en el servidor." : "Un rincón protegido. Nuestros recuerdos, a salvo del acceso directo.";
  }

  // Dial edits are local. Only an explicit submit consumes an authentication attempt.
  const dateFields = $$(".dial input");
  function normalizeDial(input) {
    const parent = input.closest(".dial");
    input.value = pad(Math.max(Number(parent.dataset.min),Math.min(Number(parent.dataset.max),Number(input.value.replace(/\D/g,"")))));
  }
  function updateCooldown() {
    const wait = Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));
    $("#unlock-button").disabled = checking || wait > 0;
    if (wait) $("#gate-message").textContent = "El candado está descansando. Podrás probar en "+wait+" s.";
    else if (cooldownUntil) { cooldownUntil = 0; $("#gate-message").textContent = "Ya puedes volver a intentarlo."; }
    const adminWait = Math.max(0,Math.ceil((adminCooldownUntil-Date.now())/1000));
    if(adminCooldownUntil)$("#admin-login-form button[type=submit]").disabled = adminWait > 0;
    if (adminWait) $("#admin-login-error").textContent = "Espera "+adminWait+" s antes de volver a probar.";
  }
  setInterval(updateCooldown,1000);
  async function verifyDate() {
    if (checking || unlocking || unlocked || cooldownUntil > Date.now()) return;
    const candidate = dateFields.map(input => pad(input.value)).join("");
    if (!/^\d{6}$/.test(candidate)) return;
    checking = true; updateCooldown();
    $("#gate-message").textContent = "Escuchando lo que dice el corazón…";
    try {
      auth = await api("/api/login","POST",{password:candidate});
      await openArchive();
    } catch(error) {
      if(error.retryAfter) cooldownUntil = Date.now()+error.retryAfter*1000;
      $("#secret-form").classList.remove("has-error");
      void $("#secret-form").offsetWidth;
      $("#secret-form").classList.add("has-error");
      $("#gate-message").textContent = error.message;
    } finally { checking = false; updateCooldown(); }
  }
  $("#secret-form").addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button || unlocking) return;
    const dial = button.closest(".dial"),
      input = $("input", dial),
      minimum = Number(dial.dataset.min),
      maximum = Number(dial.dataset.max);
    let next = Number(input.value) + Number(button.dataset.step);
    if (next > maximum) next = minimum;
    if (next < minimum) next = maximum;
    input.value = pad(next);
    dial.classList.remove("is-rolling");
    void dial.offsetWidth;
    dial.classList.add("is-rolling");
    setTimeout(() => dial.classList.remove("is-rolling"), 220);
    $("#secret-form").classList.remove("has-error");
    $("#gate-message").textContent = "Gira las flechas o escribe la fecha.";
  });
  dateFields.forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 2);
      $("#secret-form").classList.remove("has-error");

    });
    input.addEventListener("blur", () => {
      normalizeDial(input);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        input
          .closest(".dial")
          .querySelector(
            '[data-step="' + (event.key === "ArrowUp" ? "1" : "-1") + '"]',
          )
          .click();
      }
    });
    input.addEventListener("paste", (event) => {
      const value = event.clipboardData.getData("text").replace(/\D/g, "");
      if (value.length === 6) {
        event.preventDefault();
        dateFields.forEach((field, index) => {
          field.value = value.slice(index * 2, index * 2 + 2);
        });
        $("#gate-message").textContent = "Fecha preparada. Pulsa para abrir.";
      }
    });
  });
  $("#secret-form").addEventListener("submit", (event) => {
    event.preventDefault();
    dateFields.forEach(normalizeDial);
    verifyDate(true);
  });
  async function openArchive(animate = true) {
    if (unlocking) return;
    unlocking = true;
    $("#gate-message").textContent = "Era esa. Siempre fuimos nosotros.";
    $("#secret-form").inert = true;
    if (animate) $("#secret-gate").classList.add("is-opening");
    try {
      archive = await api("/api/archive");
      START = new Date(archive.startDate);
    } catch(error) {
      unlocking = false;
      $("#secret-form").inert = false;
      $("#secret-gate").classList.remove("is-opening");
      throw error;
    }
    if (animate && !reducedMotion.matches)
      await new Promise((resolve) => setTimeout(resolve, 1500));
    $("#secret-gate").hidden = true;
    $("#app").hidden = false;
    $("#app").inert = false;
    document.body.classList.remove("is-locked");
    document.body.classList.add("app-enter");
    unlocked = true;
    unlocking = false;
    renderAll();
    updateCounter();
    startReveals();
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#hero-title").focus({ preventScroll: true });
    setTimeout(() => document.body.classList.remove("app-enter"), 1600);
  }
  $("#lock-again").addEventListener("click", async () => {
    try { await api("/api/logout","POST",{}); location.reload(); }
    catch(error) { toast(error.message); }
  });
  function updateCounter() {
    if (!unlocked || !START || document.hidden) return;
    let elapsed = Math.max(
      0,
      Math.floor((Date.now() - START.getTime()) / 1000),
    );
    $("#days").textContent = Math.floor(elapsed / 86400);
    $("#hours").textContent = pad(Math.floor(elapsed / 3600) % 24);
    $("#minutes").textContent = pad(Math.floor(elapsed / 60) % 60);
    $("#seconds").textContent = pad(elapsed % 60);
  }
  setInterval(updateCounter, 1000);
  document.addEventListener("visibilitychange", updateCounter);

  function startReveals() {
    if (reducedMotion.matches || !("IntersectionObserver" in window)) return;
    document.body.classList.add("motion-ready");
    if (!observer)
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08 },
      );
    $$(".reveal:not(.visible)").forEach((el) => observer.observe(el));
  }
  const sectionObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting)
                $$(".nav-link").forEach((a) =>
                  a.classList.toggle(
                    "active",
                    a.hash === "#" + entry.target.id,
                  ),
                );
            });
          },
          { rootMargin: "-10% 0px -65% 0px", threshold: 0 },
        )
      : null;
  ["inicio", "universo", "albumes", "cartas"].forEach((id) =>
    sectionObserver?.observe(document.getElementById(id)),
  );

  function groupedAlbums() {
    const groups = new Map();
    visibleMemories().forEach((memory) => {
      if (!groups.has(memory.album)) groups.set(memory.album, []);
      groups.get(memory.album).push(memory);
    });
    return [...groups.entries()];
  }
  function makeMemoryCard(memory) {
    const card = node("article", "memory-card");
    const button = node("button");
    button.type = "button";
    button.dataset.memory = memory.id;
    const thumb = node("div", "memory-thumb");
    const img = node("img");
    img.src = memory.thumb || memory.src;
    img.alt = memory.title;
    img.loading = "lazy";
    thumb.append(img);
    if (memory.kind === "video") thumb.append(node("span", "video-badge", "▶ VÍDEO"));
    const caption = node("div", "memory-card-caption");
    caption.append(node("h3", "", memory.title), node("span", "", "↗"));
    button.append(
      thumb,
      caption,
      node("small", "", memory.date ? prettyDate(memory.date) : memory.album),
    );
    card.append(button);
    if (archive.favorites.includes(memory.id)) {
      const mark = node("span");
      mark.innerHTML = icon("heart");
      mark.firstChild.classList.add("favorite-mark");
      card.append(mark);
    }
    return card;
  }
  function renderAll() {
    renderAlbums();
    renderPhotos();
    renderLetters();
    renderTimeline();
    renderOrbit();
    syncDesk();
    applyRole();
    if ($("#admin-dialog").open) renderAdmin();
    startReveals();
  }
  function syncDesk() {
    const choices = visibleMemories().filter(m => m.kind !== "video");
    $$(".polaroid").forEach((card,i) => {
      const memory = choices.find(m=>m.id===card.dataset.memory) || choices[i];
      card.hidden = !memory;
      if (memory) {card.dataset.memory=memory.id; const img=$("img",card);if(img.getAttribute("src")!==memory.src)img.src=memory.src;img.alt=memory.title;card.setAttribute("aria-label","Abrir "+memory.title);}
    });
  }
  function renderAlbums() {
    const grid = $("#album-grid");
    grid.replaceChildren();
    const albums = groupedAlbums();
    albums.forEach(([name, memories], index) => {
      const card = node("button", "album-card reveal");
      card.type = "button";
      card.dataset.album = name;
      card.setAttribute("aria-label", "Abrir álbum " + name);
      card.style.setProperty("--reveal-delay", Math.min(index, 2) * 90 + "ms");
      const cover = node("div", "album-cover");
      const img = node("img");
      img.src = memories[0].thumb || memories[0].src;
      img.alt = "";
      img.loading = "lazy";
      const copy = node("div", "album-cover-text");
      copy.append(
        node("span", "", "EL ARCHIVO DE NOSOTROS"),
        node("h3", "", name),
        node("span", "album-volume", "VOLUMEN " + pad(index + 1)),
      );
      cover.append(img, copy);
      const caption = node("div", "album-caption");
      caption.append(
        node("h3", "", name),
        node(
          "span",
          "",
          memories.length +
            " " +
            (memories.length === 1 ? "recuerdo" : "recuerdos"),
        ),
      );
      card.append(cover, caption);
      grid.append(card);
    });
    const add = node("button", "add-album reveal");
    add.type = "button";
    add.dataset.add = "memory";
    add.innerHTML = icon("plus");
    add.append(
      node("strong", "", "Lo que viene"),
      node("span", "", "Un nuevo álbum empieza con un pequeño instante."),
    );
    grid.append(add);
    $("#album-options").replaceChildren(
      ...albums.map(([name]) => {
        const option = node("option");
        option.value = name;
        return option;
      }),
    );
    $("#collection-count").textContent =
      visibleMemories().length + " instantes para volver";
    if ($("#album-dialog").open) renderAlbumContents();
  }
  function filteredPhotos() {
    return visibleMemories().filter(m => (filter !== "favorites" || archive.favorites.includes(m.id)) && (monthFilter === "all" || (m.month || "undated") === monthFilter));
  }
  function renderPhotos() {
    const memories = filteredPhotos();
    $("#photo-grid").replaceChildren(...memories.slice(0,photoLimit).map(makeMemoryCard));
    $("#more-photos").hidden = memories.length <= photoLimit;
    $("#empty-favorites").hidden = memories.length > 0;
    $("#empty-favorites").textContent = filter === "favorites" ? "Aún no hay favoritos aquí. Abre un recuerdo y toca su corazón." : "Todavía no hay recuerdos en este mes.";
  }
  $("#more-photos").addEventListener("click",()=>{photoLimit+=24;renderPhotos();});
  function renderTimeline() {
    const months = [...new Set(visibleMemories().map(m=>m.month || "undated"))].sort();
    const target=$("#month-timeline");
    target.replaceChildren(...["all",...months].map(month=>{
      const button=node("button",month===monthFilter?"active":"",month==="all"?"Toda nuestra historia":monthName(month==="undated"?"":month));
      button.type="button";button.setAttribute("aria-pressed",String(month===monthFilter));
      if(month!=="all")button.append(node("span","",visibleMemories().filter(m=>(m.month || "undated")===month).length));
      button.addEventListener("click",()=>{monthFilter=month;photoLimit=24;renderTimeline();renderPhotos();});
      return button;
    }));
  }
  function orbitMemories() {
    const all=visibleMemories();
    const featured=all.filter(m=>m.featured);
    return featured.length ? featured : all.slice(0,16);
  }
  function renderOrbit() {
    const memories=orbitMemories(), target=$("#orbit-cards");
    if(!memories.length){target.replaceChildren();$("#orbit-caption").textContent="Nuestro próximo instante está por llegar.";$("#orbit-counter").textContent="";return;}
    orbitIndex=(orbitIndex+memories.length)%memories.length;
    const slots=memories.length>4?[-2,-1,0,1,2]:memories.length>2?[-1,0,1]:memories.length===2?[0,1]:[0];
    const old=new Map([...target.children].map(el=>[el.dataset.orbitId,el]));
    const keep=new Set();
    slots.forEach(slot=>{
      const index=(orbitIndex+slot+memories.length)%memories.length,memory=memories[index];keep.add(memory.id);
      let card=old.get(memory.id);
      if(!card) {
        card=node("button","orbit-card");card.type="button";card.dataset.orbitId=memory.id;
        const image=node("img");image.src=memory.thumb || memory.src;image.alt=memory.title;image.draggable=false;
        card.append(image,node("span","orbit-card-caption",memory.kind==="video"?"▶ Volver a este momento":memory.title));
        card.addEventListener("click",()=>{const delta=Number(card.dataset.slot);if(delta){orbitIndex+=delta;renderOrbit();}else openMemory(memory.id,orbitMemories().map(m=>m.id));});
        target.append(card);
      }
      const orbitImage = $("img",card);
      const orbitSource = memory.thumb || memory.src;
      if(orbitImage.getAttribute("src") !== orbitSource)orbitImage.src = orbitSource;
      orbitImage.alt = memory.title;
      $(".orbit-card-caption",card).textContent = memory.kind === "video" ? "▶ Volver a este momento" : memory.title;
      card.dataset.slot=slot;card.style.setProperty("--slot",slot);card.style.setProperty("--depth",Math.abs(slot));
      card.classList.toggle("is-center",slot===0);card.setAttribute("aria-label",(slot===0?"Abrir recuerdo: ":"Acercar: ")+memory.title);
      card.style.zIndex=String(10-Math.abs(slot));
    });
    [...target.children].forEach(el=>{if(!keep.has(el.dataset.orbitId))el.remove();});
    $("#orbit-counter").textContent=pad(orbitIndex+1)+" / "+pad(memories.length)+" · INSTANTES QUE BRILLAN";
    $("#orbit-caption").textContent=memories[orbitIndex].date?prettyDate(memories[orbitIndex].date):memories[orbitIndex].album;
    $("#orbit-prev").disabled=$("#orbit-next").disabled=memories.length<2;
  }
  $("#orbit-prev").addEventListener("click",()=>{orbitIndex--;renderOrbit();});
  $("#orbit-next").addEventListener("click",()=>{orbitIndex++;renderOrbit();});
  let orbitTouch=null;
  $("#orbit-scene").addEventListener("touchstart",event=>{orbitTouch={x:event.touches[0].clientX,y:event.touches[0].clientY};},{passive:true});
  $("#orbit-scene").addEventListener("touchend",event=>{if(!orbitTouch)return;const dx=event.changedTouches[0].clientX-orbitTouch.x,dy=event.changedTouches[0].clientY-orbitTouch.y;if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.5){orbitIndex+=dx<0?1:-1;renderOrbit();}orbitTouch=null;},{passive:true});

  function renderLetters() {
    const grid = $("#letter-grid");
    grid.replaceChildren();
    archive.letters.forEach((letter, index) => {
      const button = node("button", "envelope-card");
      button.type = "button";
      button.dataset.letter = letter.id;
      button.setAttribute("aria-label", "Abrir carta: " + letter.title);
      const envelope = node("div", "envelope");
      envelope.append(
        node("span", "envelope-flap"),
        node("span", "wax-seal", "n."),
        node("span", "envelope-tag", "CARTA " + pad(index + 1) + " · PARA TI"),
      );
      button.append(envelope, node("span", "", letter.title));
      grid.append(button);
    });
  }
  function showDialog(dialog) {
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("has-dialog");
  }
  $$("dialog").forEach((dialog) => {
    $("[data-close]", dialog).addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (!$$("dialog[open]").length)
        document.body.classList.remove("has-dialog");
      if (dialog.id === "editor-dialog") clearPreviews();
      if (dialog.id === "memory-dialog") $("#viewer-video").pause();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
  });
  function openAlbum(name) {
    activeAlbum = name;
    renderAlbumContents();
    showDialog($("#album-dialog"));
  }
  function renderAlbumContents() {
    const memories = visibleMemories().filter((m) => m.album === activeAlbum);
    $("#album-dialog-title").textContent = activeAlbum;
    $("#album-dialog-description").textContent =
      albumDescriptions[activeAlbum] ||
      "Un lugar para volver a nuestros momentos, uno a uno.";
    $("#album-dialog-photos").replaceChildren(...memories.map(makeMemoryCard));
  }
  $("#add-to-album").addEventListener("click", () =>
    openEditor("memory", null, activeAlbum),
  );
  function openMemory(id, ids) {
    viewerIds = ids || visibleMemories().map((m) => m.id);
    viewerIndex = Math.max(0, viewerIds.indexOf(id));
    renderViewer();
    showDialog($("#memory-dialog"));
  }
  function currentMemory() {
    return archive.memories.find((m) => m.id === viewerIds[viewerIndex]);
  }
  function renderViewer() {
    const memory = currentMemory();
    if (!memory) return;
    const photo = $("#viewer-photo");
    const video = $("#viewer-video");
    video.pause();
    video.hidden = memory.kind !== "video";
    photo.hidden = memory.kind === "video";
    if (memory.kind === "video") {video.src=memory.src;video.poster=memory.thumb || "";}
    else {video.removeAttribute("src");photo.src=memory.src;}
    photo.alt = memory.title;
    photo.style.animation = "none";
    void photo.offsetWidth;
    photo.style.animation = "";
    $("#memory-album").textContent = memory.album;
    $("#memory-title").textContent = memory.title;
    $("#memory-date").textContent = prettyDate(memory.date);
    $("#memory-date").hidden = !memory.date;
    $("#memory-note").textContent =
      memory.note || "Hay instantes que hablan por sí solos.";
    $("#viewer-count").textContent =
      pad(viewerIndex + 1) + " / " + pad(viewerIds.length);
    const favorite = archive.favorites.includes(memory.id);
    $("#favorite-memory").setAttribute("aria-pressed", String(favorite));
    $("#favorite-memory span").textContent = favorite
      ? "Guardado en favoritos"
      : "Guardar favorito";
    $("#prev-memory").disabled = $("#next-memory").disabled =
      viewerIds.length < 2;
  }
  function moveMemory(direction) {
    viewerIndex =
      (viewerIndex + direction + viewerIds.length) % viewerIds.length;
    renderViewer();
  }
  $("#prev-memory").addEventListener("click", () => moveMemory(-1));
  $("#next-memory").addEventListener("click", () => moveMemory(1));
  document.addEventListener("keydown", (event) => {
    if (!$("#memory-dialog").open || $("#editor-dialog").open) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveMemory(1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveMemory(-1);
    }
  });
  let touchStart = null;
  $(".viewer-stage").addEventListener(
    "touchstart",
    (event) => {
      touchStart = {
        x: event.changedTouches[0].clientX,
        y: event.changedTouches[0].clientY,
      };
    },
    { passive: true },
  );
  $(".viewer-stage").addEventListener(
    "touchend",
    (event) => {
      if (!touchStart) return;
      const dx = event.changedTouches[0].clientX - touchStart.x,
        dy = event.changedTouches[0].clientY - touchStart.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
        moveMemory(dx < 0 ? 1 : -1);
      touchStart = null;
    },
    { passive: true },
  );
  $("#favorite-memory").addEventListener("click", async (event) => {
    const memory = currentMemory();
    if (!memory) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const favorites = archive.favorites.includes(memory.id)
        ? archive.favorites.filter((id) => id !== memory.id)
        : [...archive.favorites, memory.id];
      await api("/api/favorite","POST",{id:memory.id,favorite:favorites.includes(memory.id)});
      archive = await api("/api/archive");
      renderViewer();
      renderPhotos();
      if ($("#album-dialog").open) renderAlbumContents();
      if (favorites.includes(memory.id)) burst(button);
    } catch (error) {
      toast(error.message || "No se pudo guardar el favorito.");
    } finally {
      button.disabled = false;
    }
  });
  $("#random-memory").addEventListener("click", () => {
    const memories=visibleMemories();
    if(memories.length)openMemory(memories[Math.floor(Math.random()*memories.length)].id);
  });
  $$(".filter-tabs button").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      photoLimit = 24;
      $$(".filter-tabs button").forEach((other) => {
        const active = other === button;
        other.classList.toggle("active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderPhotos();
    }),
  );
  document.addEventListener("click", (event) => {
    if (!unlocked) return;
    const add = event.target.closest("[data-add]");
    if (add) {
      openEditor(add.dataset.add);
      return;
    }
    const album = event.target.closest("[data-album]");
    if (album) {
      openAlbum(album.dataset.album);
      return;
    }
    const memory = event.target.closest("[data-memory]");
    if (memory) {
      if (memory.dataset.dragged === "true") {
        memory.dataset.dragged = "false";
        return;
      }
      const inAlbum = memory.closest("#album-dialog");
      const ids = inAlbum ? visibleMemories().filter(m=>m.album===activeAlbum).map(m=>m.id)
        : memory.closest("#photo-grid") ? filteredPhotos().map(m=>m.id) : undefined;
      openMemory(memory.dataset.memory, ids);
      return;
    }
    const letter = event.target.closest("[data-letter]");
    if (letter && !letter.classList.contains("opening")) {
      letter.classList.add("opening");
      activeLetter = letter.dataset.letter;
      setTimeout(
        () => {
          showLetter();
          letter.classList.remove("opening");
        },
        reducedMotion.matches ? 0 : 620,
      );
    }
  });
  function showLetter() {
    const letter = archive.letters.find((l) => l.id === activeLetter);
    if (!letter) return;
    $("#letter-title").textContent = letter.title;
    $("#letter-body").textContent = letter.note;
    showDialog($("#letter-dialog"));
  }
  function burst(element) {
    if (reducedMotion.matches) return;
    const rect = element.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      const particle = node("span", "heart-particle", i % 3 ? "♡" : "✧");
      particle.style.left = rect.left + rect.width / 2 + "px";
      particle.style.top = rect.top + rect.height / 2 + "px";
      particle.style.setProperty("--fly-x", (Math.random() - 0.5) * 190 + "px");
      particle.style.setProperty("--fly-y", -35 - Math.random() * 130 + "px");
      particle.style.setProperty(
        "--fly-r",
        (Math.random() - 0.5) * 100 + "deg",
      );
      particle.style.fontSize = 12 + Math.random() * 15 + "px";
      document.body.append(particle);
      setTimeout(() => particle.remove(), 1300);
    }
  }

  // Move photos on the desk with a mouse; touch keeps natural page scrolling.
  let stack = 6;
  $$(".polaroid").forEach((photo) => {
    let drag = null,
      offset = { x: 0, y: 0 };
    photo.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        x: offset.x,
        y: offset.y,
        moved: false,
      };
      photo.dataset.dragged = "false";
    });
    photo.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX,
        dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        photo.setPointerCapture(event.pointerId);
        photo.style.zIndex = String(++stack);
        drag.moved = true;
      }
      event.preventDefault();
      const bounds = $("#memory-desk").getBoundingClientRect();
      offset.x = Math.max(
        -photo.offsetLeft + 10,
        Math.min(
          bounds.width - photo.offsetLeft - photo.offsetWidth - 10,
          drag.x + dx,
        ),
      );
      offset.y = Math.max(
        -photo.offsetTop + 10,
        Math.min(
          bounds.height - photo.offsetTop - photo.offsetHeight - 10,
          drag.y + dy,
        ),
      );
      photo.style.setProperty("--drag-x", offset.x + "px");
      photo.style.setProperty("--drag-y", offset.y + "px");
      photo.classList.add("dragging");
    });
    const end = () => {
      if (!drag) return;
      photo.dataset.dragged = String(drag.moved);
      if (drag.moved) $("#reset-desk").hidden = false;
      photo.classList.remove("dragging");
      drag = null;
    };
    photo.addEventListener("pointerup", end);
    photo.addEventListener("pointercancel", end);
    $("#reset-desk").addEventListener("click", () => {
      offset = { x: 0, y: 0 };
      photo.style.removeProperty("--drag-x");
      photo.style.removeProperty("--drag-y");
      photo.style.removeProperty("z-index");
      photo.dataset.dragged = "false";
      $("#reset-desk").hidden = true;
    });
  });

  function clearPreviews() {
    previewURLs.forEach((url) => URL.revokeObjectURL(url));
    previewURLs = [];
    selectedFiles = [];
    $("#upload-preview").replaceChildren();
    $("#photo-files").value = "";
  }
  function openEditor(mode, id = null, album = "") {
    if(auth.role !== "admin"){openAdmin();return;}
    editorMode = mode;
    editingId = id;
    clearPreviews();
    $("#editor-form").reset();
    $("#editor-error").textContent = "";
    $("#memory-fields").hidden = mode === "letter";
    const existing = id
      ? (mode === "memory" ? archive.memories : archive.letters).find(
          (item) => item.id === id,
        )
      : null;
    $("#editor-title").textContent = id
      ? "Un detalle que merece quedarse."
      : mode === "letter"
        ? "Palabras que abrazan."
        : "Guardemos este instante.";
    $("#entry-title").value = existing?.title || "";
    $("#entry-title").placeholder =
      mode === "letter"
        ? "Por ejemplo: Cuando necesites un abrazo"
        : "¿Cómo llamarías a este recuerdo?";
    $("#entry-note").value = existing?.note || "";
    $("#entry-note").required = mode === "letter";
    $("#entry-note").placeholder =
      mode === "letter"
        ? "Escribe lo que te gustaría que leyera…"
        : "Ese pequeño detalle que no aparece en la foto…";
    $("#entry-album").value = existing?.album || album;
    $("#entry-date").value = existing?.date || "";
    $("#entry-month").value = existing?.month || "";
    $(".upload-zone").hidden = Boolean(id);
    $("#save-entry").disabled = false;
    $("#save-entry").innerHTML = "Guardar con amor " + icon("heart");
    showDialog($("#editor-dialog"));
  }
  $("#edit-memory").addEventListener("click", () =>
    openEditor("memory", currentMemory()?.id),
  );
  $("#edit-letter").addEventListener("click", () =>
    openEditor("letter", activeLetter),
  );
  $("#photo-files").addEventListener("change", (event) => {
    previewURLs.forEach((url) => URL.revokeObjectURL(url));
    previewURLs = [];
    $("#upload-preview").replaceChildren();
    const files = [...event.target.files];
    selectedFiles = [];
    if (files.length > 10) {
      $("#editor-error").textContent = "Elige hasta 10 fotos por recuerdo.";
      event.target.value = "";
      return;
    }
    if (
      files.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 20 * 1024 * 1024,
      )
    ) {
      $("#editor-error").textContent =
        "Usa fotografías JPG, PNG o WebP de hasta 20 MB cada una.";
      event.target.value = "";
      return;
    }
    $("#editor-error").textContent = "";
    selectedFiles = files;
    files.forEach((file) => {
      const img = node("img");
      img.alt = file.name;
      img.src = URL.createObjectURL(file);
      previewURLs.push(img.src);
      $("#upload-preview").append(img);
    });
  });
  async function compressPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const ratio = Math.min(
        1,
        1800 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f5f0e8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.88);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  $("#editor-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#entry-title").value.trim(),
      note = $("#entry-note").value.trim();
    if (!title) {
      $("#entry-title").focus();
      return;
    }
    if (editorMode === "letter" && !note) {
      $("#entry-note").focus();
      return;
    }
    if (editorMode === "memory" && !editingId && !selectedFiles.length) {
      $("#editor-error").textContent =
        "Elige al menos una fotografía para guardar este recuerdo.";
      return;
    }
    const button = $("#save-entry");
    button.disabled = true;
    button.textContent = "Guardando nuestro momento…";
    $("#editor-error").textContent = "";
    try {
      const updated = Date.now();
      let next = { ...archive };
      if (editorMode === "letter") {
        const letter = { id: editingId || uid(), title, note, updated };
        next.letters = editingId
          ? archive.letters.map((l) => (l.id === editingId ? letter : l))
          : [...archive.letters, letter];
      } else {
        const album = $("#entry-album").value.trim() || "Nuestros momentos",
          date = $("#entry-date").value,
          month = $("#entry-month").value || date.slice(0,7);
        if (editingId)
          next.memories = archive.memories.map((m) =>
            m.id === editingId
              ? { ...m, title, note, album, date, month, updated }
              : m,
          );
        else {
          const photos = [];
          for (let i = 0; i < selectedFiles.length; i++) {
            const src = await compressPhoto(selectedFiles[i]);
            photos.push({
              id: uid(),
              title: selectedFiles.length > 1 ? title + " · " + (i + 1) : title,
              note,
              album,
              date,
              month,
              originalName: selectedFiles[i].name,
              src,
              updated,
            });
          }
          next.memories = [...archive.memories, ...photos];
        }
      }
      await saveArchive(next);
      renderAll();
      if ($("#memory-dialog").open) renderViewer();
      if ($("#letter-dialog").open) showLetter();
      $("#editor-dialog").close();
      toast(
        editorMode === "letter"
          ? "Tu carta ya tiene su sobre."
          : "Recuerdo guardado. Un instante más para volver.",
      );
    } catch (error) {
      $("#editor-error").textContent =
        error.name === "QuotaExceededError"
          ? "El navegador se quedó sin espacio. Exporta un respaldo antes de guardar más fotos."
          : error.message ||
            "No se pudo guardar. Tus recuerdos anteriores siguen intactos.";
    } finally {
      button.disabled = false;
      button.innerHTML = "Guardar con amor " + icon("heart");
    }
  });

  async function sourceAsDataURL(src) {
    if (src.startsWith("data:")) return src;
    const response = await fetch(src);
    if (!response.ok)
      throw new Error("No se pudo incluir una de las fotografías originales.");
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  $("#export-archive").addEventListener("click", async (event) => {
    if(auth.role !== "admin"){openAdmin();return;}
    const button = event.currentTarget;
    button.disabled = true;
    toast("Preparando una copia con todas las fotos y cartas…");
    try {
      const memories = [];
      for (const memory of archive.memories)
        memories.push({ ...memory, src: await sourceAsDataURL(memory.src), ...(memory.kind === "video" ? {thumb:await sourceAsDataURL(memory.thumb)} : {}) });
      const backup = {
        format: "nosotros-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        memories,
        letters: archive.letters,
        favorites: archive.favorites,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
      );
      const link = node("a");
      link.href = url;
      link.download =
        "nosotros-respaldo-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("Respaldo preparado. Guárdalo en un lugar de confianza.");
    } catch (error) {
      toast(
        error.message ||
          "No se pudo crear el respaldo. Abre la web mediante un servidor local.",
      );
    } finally {
      button.disabled = false;
    }
  });
  $("#import-archive").addEventListener("click", () =>
    $("#import-file").click(),
  );
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if(auth.role !== "admin")throw new Error("Entra al taller antes de importar.");
      if (file.size > 80 * 1024 * 1024)
        throw new Error("El respaldo supera el límite de 80 MB.");
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== "nosotros-archive" || parsed.version !== 1)
        throw new Error("Elige un respaldo creado desde esta web.");
      const incoming = validateArchive(parsed);
      const merge = (current, items) => {
        const map = new Map(current.map((item) => [item.id, item]));
        items.forEach((item) => {
          if (!map.has(item.id) || item.updated > map.get(item.id).updated)
            map.set(item.id, item);
        });
        return [...map.values()];
      };
      await saveArchive({
        memories: merge(archive.memories, incoming.memories),
        letters: merge(archive.letters, incoming.letters),
        favorites: [...new Set([...archive.favorites, ...incoming.favorites])],
      });
      renderAll();
      toast("Respaldo importado. Tus recuerdos anteriores siguen aquí.");
    } catch (error) {
      toast(error.message || "No se pudo importar el respaldo.");
    } finally {
      event.target.value = "";
    }
  });

  function openAdmin() {
    if(auth.role==="admin"){renderAdmin();showDialog($("#admin-dialog"));}
    else {$("#admin-login-error").textContent="";showDialog($("#admin-login-dialog"));updateCooldown();}
  }
  $("#open-admin").addEventListener("click",openAdmin);
  $("#admin-return").addEventListener("click",()=>$("#admin-dialog").close());
  $("#admin-login-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("button[type=submit]",event.currentTarget);button.disabled=true;
    try{
      auth=await api("/api/admin/login","POST",{password:$("#admin-password").value});
      $("#admin-password").value="";archive=await api("/api/archive");renderAll();
      $("#admin-login-dialog").close();openAdmin();
    }catch(error){$("#admin-login-error").textContent=error.message;if(error.retryAfter)adminCooldownUntil=Date.now()+error.retryAfter*1000;}
    finally{button.disabled=false;updateCooldown();}
  });
  function adminMemories(){
    const query=$("#admin-search").value.toLocaleLowerCase("es").trim(),month=$("#admin-month").value,album=$("#admin-album").value;
    return archive.memories.filter(m=>(month==="all" || (m.month || "undated")===month) && (album==="all" || m.album===album) && (!query || [m.title,m.album,m.originalName,m.note].join(" ").toLocaleLowerCase("es").includes(query)));
  }
  function fillSelect(element,values,label){
    const previous=element.value;
    element.replaceChildren(...[["all",label],...values].map(([value,text])=>{const option=node("option","",text);option.value=value;return option;}));
    element.value=[...element.options].some(o=>o.value===previous)?previous:"all";
  }
  function renderAdmin(){
    fillSelect($("#admin-month"),[...new Set(archive.memories.map(m=>m.month || "undated"))].sort().map(m=>[m,monthName(m==="undated"?"":m)]),"Todos los meses");
    fillSelect($("#admin-album"),[...new Set(archive.memories.map(m=>m.album))].sort().map(m=>[m,m]),"Todos los álbumes");
    $("#admin-stats").replaceChildren(...[
      [archive.memories.filter(m=>m.kind!=="video").length,"fotografías"],
      [archive.memories.filter(m=>m.kind==="video").length,"vídeos"],
      [new Set(archive.memories.map(m=>m.month).filter(Boolean)).size,"meses juntos"],
      [archive.memories.filter(m=>m.hidden).length,"solo en el taller"]
    ].map(([value,label])=>{const el=node("div");el.append(node("strong","",value),node("span","",label));return el;}));
    renderAdminGrid();
  }
  function renderAdminGrid(){
    const memories=adminMemories();
    $("#admin-grid").replaceChildren(...memories.map(memory=>{
      const card=node("article","admin-card"+(memory.hidden?" is-hidden":""));
      const label=node("label","admin-photo");const checkbox=node("input");checkbox.type="checkbox";checkbox.checked=selected.has(memory.id);
      checkbox.setAttribute("aria-label","Seleccionar "+memory.title+" "+(memory.originalName || memory.id));
      checkbox.addEventListener("change",()=>{checkbox.checked?selected.add(memory.id):selected.delete(memory.id);updateSelected();});
      const img=node("img");img.src=memory.thumb || memory.src;img.alt="";img.loading="lazy";
      label.append(img,checkbox);
      const badges=node("div","admin-badges");if(memory.featured)badges.append(node("span","","✧ Destacado"));if(memory.hidden)badges.append(node("span","","Oculto"));if(memory.kind==="video")badges.append(node("span","","▶ Vídeo"));
      label.append(badges);const caption=node("div","admin-card-copy");
      caption.append(node("strong","",memory.title),node("span","",monthName(memory.month)),node("small","",memory.album));
      const edit=node("button","text-button","Editar detalles ↗");edit.type="button";edit.addEventListener("click",()=>openEditor("memory",memory.id));caption.append(edit);
      card.append(label,caption);return card;
    }));
    $("#admin-empty").hidden=memories.length>0;updateSelected();
  }
  function updateSelected(){
    $("#selected-count").textContent=selected.size+" seleccionados";
    ["apply-bulk","feature-selection","unfeature-selection","hide-selection","show-selection","undate-selection"].forEach(id=>$("#"+id).disabled=!selected.size);
  }
  ["admin-search","admin-month","admin-album"].forEach(id=>$("#"+id).addEventListener(id==="admin-search"?"input":"change",renderAdminGrid));
  $("#select-visible").addEventListener("click",()=>{adminMemories().forEach(m=>selected.add(m.id));renderAdminGrid();});
  $("#clear-selection").addEventListener("click",()=>{selected.clear();renderAdminGrid();});
  let bulkBusy=false;
  async function bulkUpdate(patch){
    if(!selected.size || bulkBusy)return;bulkBusy=true;$("#admin-error").textContent="";
    try{await saveArchive({...archive,memories:archive.memories.map(m=>selected.has(m.id)?{...m,...patch,updated:Date.now()}:m)});renderAll();toast("Los recuerdos ya tienen su nuevo lugar.");}
    catch(error){$("#admin-error").textContent=error.message;}
    finally{bulkBusy=false;}
  }
  $("#apply-bulk").addEventListener("click",()=>{
    const month=$("#bulk-month").value,album=$("#bulk-album").value.trim();
    if(!month&&!album){$("#admin-error").textContent="Elige un mes o escribe un álbum para aplicar el cambio.";return;}
    bulkUpdate({...month?{month}:{},...album?{album}:{}});
  });
  $("#feature-selection").addEventListener("click",()=>bulkUpdate({featured:true}));
  $("#unfeature-selection").addEventListener("click",()=>bulkUpdate({featured:false}));
  $("#hide-selection").addEventListener("click",()=>bulkUpdate({hidden:true}));
  $("#show-selection").addEventListener("click",()=>bulkUpdate({hidden:false}));
  $("#undate-selection").addEventListener("click",()=>bulkUpdate({month:""}));
  $("#admin-logout").addEventListener("click",async()=>{
    try{auth=await api("/api/admin/logout","POST",{});archive=await api("/api/archive");selected.clear();$("#admin-dialog").close();renderAll();toast("Taller cerrado. Volvemos a disfrutar lo nuestro.");}
    catch(error){toast(error.message);}
  });
  $("#refresh-archive").addEventListener("click",async()=>{try{archive=await api("/api/archive");renderAll();toast("Archivo actualizado.");}catch(error){toast(error.message);}});
  $("#password-form").addEventListener("submit",async event=>{
    event.preventDefault();const button=$("button",event.currentTarget);button.disabled=true;
    try{
      if($("#new-password").value!==$("#confirm-password").value)throw new Error("Las dos claves nuevas no coinciden.");
      auth=await api("/api/admin/password","POST",{current:$("#current-password").value,next:$("#new-password").value});
      event.target.reset();$("#password-message").textContent="Clave actualizada. Las demás sesiones de administración se cerraron.";
    }catch(error){$("#password-message").textContent=error.message;}
    finally{button.disabled=false;}
  });
  $("#recover-local").addEventListener("click",async()=>{
    try{
      if(!indexedDB.databases)throw new Error("Este navegador no permite localizar archivos anteriores.");
      const databases=await indexedDB.databases();
      if(!databases.some(d=>d.name==="nosotros-archive"))throw new Error("No hay un archivo anterior en este navegador y dirección.");
      const old=await new Promise((resolve,reject)=>{const request=indexedDB.open("nosotros-archive");request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains("data")){db.close();resolve(null);return;}const read=db.transaction("data").objectStore("data").get("archive");read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>{db.close();reject(read.error);};};});
      if(!old)throw new Error("No hay recuerdos anteriores guardados aquí.");
      const incoming=validateArchive(old),map=new Map(archive.memories.map(m=>[m.id,m])),letters=new Map(archive.letters.map(l=>[l.id,l]));
      incoming.memories.forEach(m=>{const existing=map.get(m.id);if(!existing || m.updated>existing.updated){if(existing&&!m.src.startsWith("data:"))map.set(m.id,{...existing,...m,src:existing.src,thumb:existing.thumb});else if(m.src.startsWith("data:"))map.set(m.id,m);}});
      incoming.letters.forEach(l=>{if(!letters.has(l.id)||l.updated>letters.get(l.id).updated)letters.set(l.id,l);});
      await saveArchive({memories:[...map.values()],letters:[...letters.values()],favorites:[...new Set([...archive.favorites,...incoming.favorites])]});
      renderAll();toast("Recuerdos recuperados. La copia anterior sigue intacta en este navegador.");
    }catch(error){$("#admin-error").textContent=error.message;}
  });
  api("/api/session").then(async session=>{
    auth=session;
    if(session.authenticated)await openArchive(false);
    else if(session.retryAfter){cooldownUntil=Date.now()+session.retryAfter*1000;updateCooldown();}
  }).catch(error=>{$("#gate-message").textContent=error.message;});
})();
