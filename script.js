// CONFIGURACIÓN PRINCIPAL
const startDate = new Date(2026, 1, 14, 0, 0, 0);
const texts = [
    'Eres mi lugar seguro y mi casualidad favorita...',
    'Contigo cada segundo es mágico. Te amo infinitamente.'
];

// ÁRBOL DE HOJAS EN FORMA DE CORAZÓN
const canvas = document.getElementById('magicTree');
const ctx = canvas.getContext('2d');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const treePalette = ['#68182b', '#7b2034', '#8f3044', '#b08d57', '#c8aa6e', '#d9c9aa', '#f7f4ee'];

let width = 0;
let height = 0;
let crownX = 0;
let crownY = 0;
let crownScale = 0;
let staticLeaves = [];
let fallingLeaves = [];
let lastWidth = 0;
let lastHeight = 0;
let resizeTimer;
let animationFrame = 0;

function seededRandom(seed) {
    let value = seed % 2147483647;
    return () => {
        value = value * 16807 % 2147483647;
        return (value - 1) / 2147483646;
    };
}

function isInsideHeart(normalizedX, normalizedY) {
    const x = normalizedX;
    const y = -normalizedY;
    const a = x * x + y * y - 1;
    return (a * a * a - x * x * y * y * y) <= 0;
}

function buildOrderedCrown() {
    const random = seededRandom(143);
    const leaves = [];
    const columns = width < 500 ? 34 : 42;
    const rows = width < 500 ? 30 : 37;

    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const nx = -1.25 + ((column + 0.5) / columns) * 2.5;
            const ny = -1.16 + ((row + 0.5) / rows) * 2.42;
            if (!isInsideHeart(nx, ny)) continue;

            const jitterX = (random() - 0.5) * (2.1 / columns);
            const jitterY = (random() - 0.5) * (2 / rows);
            const depth = 0.72 + random() * 0.28;
            leaves.push({
                x: crownX + (nx + jitterX) * crownScale,
                y: crownY + (ny + jitterY) * crownScale,
                size: (2.25 + random() * 1.9) * depth,
                rotation: random() * Math.PI,
                color: treePalette[Math.floor(random() * treePalette.length)],
                delay: random() * 120,
                sway: random() * Math.PI * 2,
                depth
            });
        }
    }

    staticLeaves = leaves.sort((a, b) => a.depth - b.depth);
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (lastWidth === nextWidth && lastHeight === nextHeight) return;

    lastWidth = nextWidth;
    lastHeight = nextHeight;
    width = nextWidth;
    height = nextHeight;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    crownScale = Math.min(width / 2.85, height / 3.35);
    crownX = width / 2;
    crownY = crownScale * 1.22 + Math.max(22, height * 0.045);
    fallingLeaves = [];
    buildOrderedCrown();
}

function drawLeaf(x, y, size, rotation, color, opacity = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalAlpha = opacity;

    ctx.beginPath();
    ctx.moveTo(0, -size * 1.35);
    ctx.bezierCurveTo(size * 1.05, -size * 0.7, size * 1.05, size * 0.75, 0, size * 1.35);
    ctx.bezierCurveTo(-size * 1.05, size * 0.75, -size * 1.05, -size * 0.7, 0, -size * 1.35);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = Math.max(.45, size * .11);
    ctx.stroke();
    ctx.restore();
}

function drawBranch(startX, startY, controlX, controlY, endX, endY, lineWidth, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.strokeStyle = '#4e4140';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
}

function drawTreeStructure() {
    const baseY = height * 0.93;
    const splitY = crownY + crownScale * 0.58;
    const trunkTop = crownY + crownScale * 0.08;

    ctx.save();
    const trunkGradient = ctx.createLinearGradient(crownX, baseY, crownX, trunkTop);
    trunkGradient.addColorStop(0, '#403738');
    trunkGradient.addColorStop(.58, '#564646');
    trunkGradient.addColorStop(1, '#6b5150');
    ctx.fillStyle = trunkGradient;
    ctx.beginPath();
    ctx.moveTo(crownX - crownScale * .13, baseY);
    ctx.bezierCurveTo(crownX - crownScale * .1, splitY, crownX - crownScale * .035, splitY, crownX - crownScale * .025, trunkTop);
    ctx.bezierCurveTo(crownX + crownScale * .035, splitY, crownX + crownScale * .11, splitY, crownX + crownScale * .13, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const branches = [
        [-.02, .52, -.66, .18, -1.02, -.22, 7],
        [.01, .48, .65, .12, 1.02, -.2, 7],
        [-.01, .4, -.38, -.18, -.54, -.7, 5],
        [.02, .38, .38, -.18, .56, -.68, 5],
        [0, .35, -.08, -.38, -.14, -.96, 4],
        [0, .34, .13, -.35, .2, -.9, 4],
        [-.35, .05, -.7, -.36, -.94, -.56, 3],
        [.35, .05, .72, -.34, .94, -.54, 3]
    ];

    for (const branch of branches) {
        drawBranch(
            crownX + branch[0] * crownScale,
            crownY + branch[1] * crownScale,
            crownX + branch[2] * crownScale,
            crownY + branch[3] * crownScale,
            crownX + branch[4] * crownScale,
            crownY + branch[5] * crownScale,
            Math.max(1.5, branch[6] * crownScale / 190),
            .84
        );
    }

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(crownX, baseY + 3, crownScale * .32, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(38,8,15,.12)';
    ctx.filter = 'blur(5px)';
    ctx.fill();
    ctx.restore();
}

function drawCrown() {
    const time = animationFrame * .012;
    for (const leaf of staticLeaves) {
        const entrance = reduceMotion ? 1 : Math.min(1, Math.max(0, (animationFrame - leaf.delay) / 28));
        if (entrance <= 0) continue;
        const sway = reduceMotion ? 0 : Math.sin(time + leaf.sway) * 1.25;
        drawLeaf(
            leaf.x + sway,
            leaf.y,
            leaf.size * entrance,
            leaf.rotation + sway * .025,
            leaf.color,
            .88 + leaf.depth * .12
        );
    }
}

function spawnFallingLeaf() {
    if (reduceMotion || animationFrame < 150 || animationFrame % 13 !== 0 || fallingLeaves.length >= 32) return;
    const random = Math.random;
    const source = staticLeaves[Math.floor(random() * staticLeaves.length)];
    if (!source) return;

    fallingLeaves.push({
        x: source.x,
        y: source.y,
        size: source.size * (.85 + random() * .35),
        color: source.color,
        rotation: source.rotation,
        speed: .48 + random() * .72,
        drift: (random() - .5) * .55,
        phase: random() * Math.PI * 2,
        spin: (random() - .5) * .025,
        opacity: .9
    });
}

function drawFallingLeaves() {
    for (let index = fallingLeaves.length - 1; index >= 0; index--) {
        const leaf = fallingLeaves[index];
        leaf.phase += .035;
        leaf.y += leaf.speed;
        leaf.x += leaf.drift + Math.sin(leaf.phase) * .34;
        leaf.rotation += leaf.spin;
        if (leaf.y > height * .78) leaf.opacity -= .006;

        drawLeaf(leaf.x, leaf.y, leaf.size, leaf.rotation, leaf.color, Math.max(0, leaf.opacity));
        if (leaf.y > height + 30 || leaf.opacity <= 0) fallingLeaves.splice(index, 1);
    }
}

function renderLoop() {
    animationFrame++;
    ctx.clearRect(0, 0, width, height);
    drawTreeStructure();
    drawCrown();
    spawnFallingLeaf();
    drawFallingLeaves();
    requestAnimationFrame(renderLoop);
}

function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 120);
}

window.addEventListener('resize', scheduleResize, { passive: true });
new ResizeObserver(scheduleResize).observe(canvas.parentElement);

// TEXTOS, CONTADOR Y MODAL
function typeWriter(elementId, text, speed, callback) {
    const element = document.getElementById(elementId);
    element.classList.remove('hidden');
    element.style.animation = 'blink-cursor 0.75s step-end infinite';
    let index = 0;

    function type() {
        if (index < text.length) {
            element.textContent += text.charAt(index++);
            setTimeout(type, reduceMotion ? 0 : speed);
        } else {
            element.style.borderRight = 'none';
            callback?.();
        }
    }
    type();
}

function updateCounter() {
    const diff = Math.max(0, Date.now() - startDate.getTime());
    const day = Math.floor(diff / 86400000);
    const hour = Math.floor((diff / 3600000) % 24);
    const minute = Math.floor((diff / 60000) % 60);
    const second = Math.floor((diff / 1000) % 60);
    const format = number => number.toString().padStart(2, '0');

    document.getElementById('days').textContent = day;
    document.getElementById('hours').textContent = format(hour);
    document.getElementById('minutes').textContent = format(minute);
    document.getElementById('seconds').textContent = format(second);
}

// ARCHIVO MENSUAL DE SORPRESAS
const monthsGrid = document.getElementById('months-grid');
const yearFilters = document.getElementById('year-filters');
const archiveCount = document.getElementById('archive-count');
const daysTogether = document.getElementById('days-together');
let monthlyArchive = [];
let selectedArchiveYear = new Date().getFullYear();

function getMonthlyArchive() {
    const now = new Date();
    const archive = [];
    const calendarDifference = (now.getFullYear() - startDate.getFullYear()) * 12
        + (now.getMonth() - startDate.getMonth());
    const availableMonths = Math.max(0, calendarDifference);

    for (let monthNumber = 1; monthNumber <= availableMonths; monthNumber++) {
        const anniversary = new Date(
            startDate.getFullYear(),
            startDate.getMonth() + monthNumber,
            startDate.getDate()
        );
        archive.push({
            number: monthNumber,
            year: anniversary.getFullYear(),
            month: anniversary.getMonth(),
            day: anniversary.getDate(),
            isCurrent: monthNumber === availableMonths
        });
    }
    return archive;
}

function createMonthCard(item) {
    const card = document.createElement('article');
    card.className = `month-card ${item.isCurrent ? 'is-current' : 'is-locked'}`;

    const top = document.createElement('div');
    top.className = 'month-card-top';

    const number = document.createElement('span');
    number.className = 'month-number';
    number.textContent = `Mes ${item.number}`;

    const lock = document.createElement('span');
    lock.className = 'month-lock';
    lock.setAttribute('aria-hidden', 'true');
    lock.textContent = item.isCurrent ? '◇' : '🔒';
    top.append(number, lock);

    const title = document.createElement('h3');
    const formattedMonth = new Intl.DateTimeFormat('es-PE', {
        month: 'long',
        year: 'numeric'
    }).format(new Date(item.year, item.month, 1));
    const monthName = new Intl.DateTimeFormat('es-PE', { month: 'long' })
        .format(new Date(item.year, item.month, 1));
    title.textContent = formattedMonth;

    const description = document.createElement('p');
    description.textContent = item.isCurrent
        ? `La sorpresa de ${monthName} está lista para descubrirse.`
        : `Sorpresa del mes ${item.number}, todavía bloqueada.`;

    card.append(top, title, description);

    if (item.isCurrent) {
        const openLink = document.createElement('a');
        openLink.className = 'month-open';
        openLink.href = '#pregunta';
        openLink.dataset.openSurprise = 'true';
        openLink.textContent = `Abrir sorpresa de ${monthName} →`;
        card.appendChild(openLink);
    }

    return card;
}

function renderMonthlyArchive() {
    monthsGrid.replaceChildren();
    const visibleMonths = (selectedArchiveYear === 'all'
        ? monthlyArchive
        : monthlyArchive.filter(item => item.year === selectedArchiveYear))
        .slice()
        .sort((a, b) => b.number - a.number);

    for (const item of visibleMonths) monthsGrid.appendChild(createMonthCard(item));
}

function renderYearFilters() {
    const years = [...new Set(monthlyArchive.map(item => item.year))].sort((a, b) => b - a);
    const filters = [{ value: 'all', label: 'Todos' }, ...years.map(year => ({ value: year, label: String(year) }))];
    yearFilters.replaceChildren();

    for (const filter of filters) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'year-filter';
        button.textContent = filter.label;
        button.classList.toggle('active', filter.value === selectedArchiveYear);
        button.setAttribute('aria-pressed', String(filter.value === selectedArchiveYear));
        button.addEventListener('click', () => {
            selectedArchiveYear = filter.value;
            yearFilters.querySelectorAll('.year-filter').forEach(item => {
                const active = item === button;
                item.classList.toggle('active', active);
                item.setAttribute('aria-pressed', String(active));
            });
            renderMonthlyArchive();
        });
        yearFilters.appendChild(button);
    }
}

function buildMonthlyArchive() {
    monthlyArchive = getMonthlyArchive();
    selectedArchiveYear = monthlyArchive.at(-1)?.year ?? new Date().getFullYear();
    const elapsedDays = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86400000));
    archiveCount.textContent = monthlyArchive.length;
    daysTogether.textContent = elapsedDays;
    renderYearFilters();
    renderMonthlyArchive();
}

const modal = document.getElementById('modal-overlay');
const btnOpen = document.getElementById('surprise-btn');
const btnClose = document.getElementById('close-btn');
const memoryBtn = document.getElementById('memory-btn');
const graduationPhoto = document.getElementById('graduation-photo');
let previouslyFocused = null;

graduationPhoto.addEventListener('error', () => {
    graduationPhoto.src = graduationPhoto.dataset.fallback;
}, { once: true });

function openModal() {
    previouslyFocused = document.activeElement;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    btnClose.focus();
}

function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    previouslyFocused?.focus();
}

btnOpen.addEventListener('click', openModal);
memoryBtn.addEventListener('click', openModal);
btnClose.addEventListener('click', closeModal);
modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('active')) closeModal();
    if (event.key === 'Tab' && modal.classList.contains('active')) {
        event.preventDefault();
        btnClose.focus();
    }
});

// SEGUNDA SORPRESA INTERACTIVA
const yesBtn = document.getElementById('yes-btn');
const noBtn = document.getElementById('no-btn');
const surpriseSeal = document.getElementById('surprise-seal');
const surpriseContent = document.getElementById('surprise-content');
const unlockSurprise = document.getElementById('unlock-surprise');
const questionState = document.getElementById('question-state');
const answerState = document.getElementById('answer-state');
const playfulMessage = document.getElementById('playful-message');
const noStages = [
    { button: '¿Segura?', message: 'Mmm... creo que ese botón se confundió 😌' },
    { button: '¿Segurísima?', message: 'Mira que el “Sí” se ve más bonito...' },
    { button: 'Última oportunidad', message: 'El “No” se está quedando pequeñito 👀' },
    { button: '🔒 No disponible', message: 'Ups, esta opción fue bloqueada por exceso de amor 💗' }
];
let noAttempts = 0;

function revealCurrentSurprise(withSealAnimation = true) {
    if (!surpriseContent.hidden) return;

    const showSurprise = () => {
        surpriseSeal.hidden = true;
        surpriseSeal.style.display = 'none';
        surpriseContent.hidden = false;
        surpriseContent.style.display = '';
        surpriseContent.classList.add('surprise-content-reveal');
        yesBtn.focus();
    };

    if (!withSealAnimation || reduceMotion) {
        showSurprise();
        return;
    }

    surpriseSeal.classList.add('seal-opening');
    setTimeout(showSurprise, 460);
}

function handleNoAnswer() {
    if (noAttempts >= noStages.length) return;
    const stage = noStages[noAttempts];
    noBtn.textContent = stage.button;
    playfulMessage.textContent = stage.message;

    const noScale = Math.max(.48, 1 - ((noAttempts + 1) * .15));
    const yesScale = 1 + ((noAttempts + 1) * .1);
    noBtn.style.transform = `scale(${noScale}) translateX(${noAttempts % 2 ? -10 : 10}px)`;
    yesBtn.style.transform = `scale(${yesScale})`;
    noAttempts++;

    if (noAttempts === noStages.length) {
        noBtn.classList.add('locked');
        noBtn.disabled = true;
    }
}

function releasePetals() {
    if (reduceMotion) return;
    const colors = ['#68182b', '#7b2034', '#b08d57', '#c8aa6e', '#f7f4ee'];
    for (let i = 0; i < 32; i++) {
        const petal = document.createElement('span');
        petal.className = 'celebration-petal';
        petal.style.left = `${Math.random() * 100}vw`;
        petal.style.setProperty('--petal-color', colors[Math.floor(Math.random() * colors.length)]);
        petal.style.setProperty('--fall-time', `${2.6 + Math.random() * 2.2}s`);
        petal.style.setProperty('--drift', `${-90 + Math.random() * 180}px`);
        petal.style.animationDelay = `${Math.random() * .7}s`;
        document.body.appendChild(petal);
        setTimeout(() => petal.remove(), 5600);
    }
}

function handleYesAnswer() {
    questionState.hidden = true;
    answerState.hidden = false;
    answerState.classList.add('fade-in');
    releasePetals();
}

noBtn.addEventListener('click', handleNoAnswer);
yesBtn.addEventListener('click', handleYesAnswer);
unlockSurprise.addEventListener('click', revealCurrentSurprise);

// LECTOR DE CAPÍTULOS
const readerPages = [...document.querySelectorAll('.reader-page')];
const pagePrev = document.getElementById('page-prev');
const pageNext = document.getElementById('page-next');
const pageTitle = document.getElementById('page-title');
const pageStatus = document.getElementById('page-status');
const pageDots = document.getElementById('page-dots');
let currentPageIndex = 0;
let swipeStartX = null;

function updateReaderControls() {
    const currentPage = readerPages[currentPageIndex];
    pagePrev.disabled = currentPageIndex === 0;
    pageNext.disabled = currentPageIndex === readerPages.length - 1;
    pageTitle.textContent = currentPage.dataset.pageTitle;
    pageStatus.textContent = `Página ${currentPageIndex + 1} de ${readerPages.length}`;
    [...pageDots.children].forEach((dot, index) => dot.classList.toggle('active', index === currentPageIndex));
}

function goToPage(nextIndex, updateHash = true) {
    const safeIndex = Math.max(0, Math.min(readerPages.length - 1, nextIndex));
    currentPageIndex = safeIndex;

    readerPages.forEach((page, index) => {
        const active = index === safeIndex;
        page.classList.toggle('page-active', active);
        page.classList.toggle('page-before', index < safeIndex);
        page.setAttribute('aria-hidden', String(!active));
        if (active) page.scrollTop = 0;
    });

    updateReaderControls();
    if (updateHash) history.replaceState(null, '', `#${readerPages[safeIndex].id}`);
}

function initBookReader() {
    pageDots.replaceChildren();
    readerPages.forEach(() => {
        const dot = document.createElement('span');
        dot.className = 'page-dot';
        pageDots.appendChild(dot);
    });

    const hashIndex = readerPages.findIndex(page => `#${page.id}` === window.location.hash);
    goToPage(hashIndex >= 0 ? hashIndex : 0, false);
}

pagePrev.addEventListener('click', () => goToPage(currentPageIndex - 1));
pageNext.addEventListener('click', () => goToPage(currentPageIndex + 1));

document.querySelector('main').addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const destination = readerPages.findIndex(page => `#${page.id}` === link.getAttribute('href'));
    if (destination < 0) return;
    event.preventDefault();
    if (link.dataset.openSurprise === 'true') revealCurrentSurprise(false);
    goToPage(destination);
});

document.addEventListener('keydown', event => {
    if (modal.classList.contains('active')) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') goToPage(currentPageIndex + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') goToPage(currentPageIndex - 1);
});

document.querySelector('main').addEventListener('pointerdown', event => {
    if (event.target.closest('.months-grid, .year-filters, .letter-page, button, a')) {
        swipeStartX = null;
        return;
    }
    swipeStartX = event.clientX;
}, { passive: true });

document.querySelector('main').addEventListener('pointerup', event => {
    if (swipeStartX === null) return;
    const distance = event.clientX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(distance) < 70) return;
    goToPage(currentPageIndex + (distance < 0 ? 1 : -1));
}, { passive: true });

function revealExperience() {
    const title = document.getElementById('title');
    const counterBox = document.getElementById('counter-box');
    const actionArea = document.getElementById('action-area');
    const initialDelay = reduceMotion ? 0 : 600;

    setTimeout(() => {
        title.classList.remove('hidden');
        title.classList.add('fade-in');
    }, initialDelay);

    setTimeout(() => {
        typeWriter('phrase1', texts[0], 34, () => {
            setTimeout(() => {
                typeWriter('phrase2', texts[1], 34, () => {
                    counterBox.classList.remove('hidden');
                    counterBox.classList.add('fade-in');
                    actionArea.classList.remove('hidden');
                    actionArea.classList.add('fade-in');
                    updateCounter();
                    setInterval(updateCounter, 1000);
                });
            }, reduceMotion ? 0 : 240);
        });
    }, reduceMotion ? 0 : 1300);
}

function startExperience() {
    resizeCanvas();
    renderLoop();
    buildMonthlyArchive();
    initBookReader();
    revealExperience();
}

window.addEventListener('load', startExperience, { once: true });
