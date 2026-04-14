// ==========================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================
const startDate = new Date(2026, 1, 14, 0, 0, 0); // 14 de Feb de 2023

const texts = [
    "Eres mi lugar seguro y mi casualidad favorita...",
    "Contigo cada segundo es mágico. Te amo infinitamente."
];

const leafColors = ['#ff4d6d', '#ff758f', '#ffb3c1', '#c9184a', '#a4133c', '#ffffff'];

// ==========================================
// 1. LÓGICA DEL CANVAS (ÁRBOL ORGÁNICO)
// ==========================================
const canvas = document.getElementById('magicTree');
const ctx = canvas.getContext('2d');

let width, height;
let heartCenterX, heartCenterY, heartScale;
let branches = [];
let leaves = [];
let particles = [];
const targetLeaves = 2000; 
let lastWidth = 0;

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    if (lastWidth === rect.width && height > 0) return; 
    lastWidth = rect.width;

    width = rect.width;
    height = rect.height;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    initTree();
}

// Verifica si un punto está dentro del corazón matemático
function inHeart(x, y) {
    let mx = (x - heartCenterX) / heartScale;
    let my = -(y - heartCenterY) / heartScale;
    let a = mx * mx + my * my - 1;
    return (a * a * a - mx * mx * my * my * my) <= 0.1; // 0.1 da un poco de flexibilidad
}

// Generador de ramas recursivas
function generateBranches(x, y, len, angle, depth, maxDepth, parent) {
    if (depth === 0) return;

    let endX = x + Math.cos(angle) * len;
    let endY = y + Math.sin(angle) * len;

    // Poda orgánica: Dejamos que las primeras 3 ramas ignoren los bordes para crear un buen esqueleto
    if (depth < maxDepth - 3) {
        if (!inHeart(endX, endY)) {
            len *= 0.6; // Si se sale, reducimos su tamaño suavemente
            endX = x + Math.cos(angle) * len;
            endY = y + Math.sin(angle) * len;
            if (!inHeart(endX, endY)) return; // Si aún se sale, la podamos.
        }
    }

    let branch = {
        x1: x, y1: y, x2: endX, y2: endY,
        progress: 0, depth: depth, maxDepth: maxDepth, parent: parent
    };
    branches.push(branch);

    let numChildren = (depth === maxDepth) ? 3 : (Math.random() > 0.4 ? 2 : 3);
    
    for (let i = 0; i < numChildren; i++) {
        let varAngle;
        if (depth === maxDepth) {
            // Tronco principal: se abre bien ancho para llenar el corazón
            varAngle = (i === 0) ? -0.55 : (i === 1 ? 0.55 : 0);
        } else {
            varAngle = (Math.random() - 0.5) * 1.5;
            // Tendencia a crecer hacia arriba
            if (angle < -Math.PI / 2) varAngle -= 0.15;
            else varAngle += 0.15;
        }
        
        let newLen = len * (0.72 + Math.random() * 0.1); 
        generateBranches(endX, endY, newLen, angle + varAngle, depth - 1, maxDepth, branch);
    }
}

function initTree() {
    branches = []; leaves = []; particles = [];
    
    heartCenterX = width / 2;
    let isMobile = width < 850;
    
    // El tamaño del corazón se adapta al ancho de la pantalla
    heartScale = isMobile ? width / 2.5 : Math.min(width, height) / 2.8; 
    
    // Posición Y del corazón: Nos aseguramos de que haya 30px libres arriba para que no se corte
    heartCenterY = (1.2 * heartScale) + 30; 
    
    // El tronco debe medir exactamente lo necesario para conectar el piso inferior con el corazón
    let distanceToHeart = height - (heartCenterY - 1.2 * heartScale); 
    let trunkLength = distanceToHeart * 0.25; // 25% de la altura total permite que las ramas llenen el 75% restante
    
    generateBranches(width / 2, height, trunkLength, -Math.PI / 2, 10, 10, null);
}

function drawTree() {
    ctx.lineCap = 'round';
    let treeGrown = true;

    for (let b of branches) {
        if (b.parent && b.parent.progress < 0.6) continue; 
        
        if (b.progress < 1) {
            b.progress += 0.04;
            if (b.progress > 1) b.progress = 1;
            treeGrown = false;
        }
        
        let curX = b.x1 + (b.x2 - b.x1) * b.progress;
        let curY = b.y1 + (b.y2 - b.y1) * b.progress;

        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(curX, curY);
        ctx.strokeStyle = '#4a2c20'; 
        ctx.lineWidth = Math.max(1, b.depth * 1.1);
        ctx.stroke();
    }

    if (treeGrown || (branches.length > 0 && branches[Math.floor(branches.length / 2)].progress === 1)) {
        spawnLeaves();
    }
}

function spawnLeaves() {
    if (leaves.length < targetLeaves) {
        for (let i = 0; i < 40; i++) { 
            let rx = (Math.random() * 2.5 - 1.25) * heartScale + heartCenterX;
            let ry = -(Math.random() * 2.5 - 1.25) * heartScale + heartCenterY;
            
            if (inHeart(rx, ry)) {
                leaves.push({
                    x: rx, y: ry, size: 0,
                    targetSize: Math.random() * 2.5 + 2,
                    angle: (Math.random() - 0.5) * Math.PI,
                    color: leafColors[Math.floor(Math.random() * leafColors.length)],
                    sway: Math.random() * 100
                });
            }
        }
    }
}

function drawHeartShape(ctx, x, y, size, color, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-1, -1, -2, -0.5, -2, 0.5);
    ctx.bezierCurveTo(-2, 1.5, 0, 3, 0, 4);
    ctx.bezierCurveTo(0, 3, 2, 1.5, 2, 0.5);
    ctx.bezierCurveTo(2, -0.5, 1, -1, 0, 0);
    ctx.fill();
    ctx.restore();
}

function animateFoliage() {
    const time = Date.now() * 0.001;
    
    for (let l of leaves) {
        if (l.size < l.targetSize) l.size += 0.1;
        let currentAngle = l.angle + Math.sin(time * 2 + l.sway) * 0.1;
        drawHeartShape(ctx, l.x, l.y, l.size, l.color, currentAngle);

        if (Math.random() < 0.0003 && particles.length < 150 && l.size >= l.targetSize) {
            particles.push({
                x: l.x, y: l.y, size: l.size, color: l.color, angle: l.angle,
                vx: Math.random() * 1.5 + 0.5,
                vy: Math.random() * 1 + 0.5,
                spin: (Math.random() - 0.5) * 0.1,
                t: Math.random() * 100
            });
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.t += 0.05;
        p.x += p.vx + Math.sin(p.t) * 1.5;
        p.y += p.vy;
        p.angle += p.spin;
        drawHeartShape(ctx, p.x, p.y, p.size, p.color, p.angle);

        if (p.y > height + 20 || p.x > width + 20) {
            particles.splice(i, 1);
        }
    }
}

function renderLoop() {
    ctx.clearRect(0, 0, width, height);
    drawTree();
    animateFoliage();
    requestAnimationFrame(renderLoop);
}

window.addEventListener('resize', resizeCanvas);

// ==========================================
// 3. LÓGICA DE TEXTOS Y SECUENCIAS
// ==========================================
function typeWriter(elementId, text, speed, callback) {
    const element = document.getElementById(elementId);
    element.classList.remove('hidden');
    element.style.animation = 'blink-cursor 0.75s step-end infinite';
    let i = 0;

    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        } else {
            element.style.borderRight = 'none'; 
            if (callback) callback();
        }
    }
    type();
}

function updateCounter() {
    const now = new Date();
    const diff = now - startDate;

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / 1000 / 60) % 60);
    const s = Math.floor((diff / 1000) % 60);

    const f = n => n.toString().padStart(2, '0');

    document.getElementById('days').innerText = d;
    document.getElementById('hours').innerText = f(h);
    document.getElementById('minutes').innerText = f(m);
    document.getElementById('seconds').innerText = f(s);
}

const modal = document.getElementById('modal-overlay');
const btnOpen = document.getElementById('surprise-btn');
const btnClose = document.getElementById('close-btn');

btnOpen.addEventListener('click', () => modal.classList.add('active'));
btnClose.addEventListener('click', () => modal.classList.remove('active'));

function startExperience() {
    resizeCanvas();
    renderLoop();

    setTimeout(() => {
        document.getElementById('title').classList.remove('hidden');
        document.getElementById('title').classList.add('fade-in');
    }, 1000);

    setTimeout(() => {
        typeWriter('phrase1', texts[0], 40, () => {
            setTimeout(() => {
                typeWriter('phrase2', texts[1], 40, () => {
                    setTimeout(() => {
                        const counterBox = document.getElementById('counter-box');
                        const actionArea = document.getElementById('action-area');
                        counterBox.classList.remove('hidden');
                        counterBox.classList.add('fade-in');
                        
                        setTimeout(() => {
                            actionArea.classList.remove('hidden');
                            actionArea.classList.add('fade-in');
                        }, 500);

                        setInterval(updateCounter, 1000);
                        updateCounter(); 
                    }, 500);
                });
            }, 500); 
        });
    }, 2500); 
}

window.onload = startExperience;