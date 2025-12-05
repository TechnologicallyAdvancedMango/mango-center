const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);

const drawRadius = 1;

const maxRadius = 0.075;
const forceFactor = 10;

const cellSize = maxRadius * 0.5;
const gridWidth  = Math.ceil(1 / cellSize);
const gridHeight = Math.ceil(1 / cellSize);
let grid = new Map;

let dt = 0;

const m = 5;
const matrix = makeRandomMatrix();

function makeRandomMatrix() {
    const rows = [];
    for (let i = 0; i < m; i++) {
        const row = [];
        for (let j = 0; j < m; j++) {
            row.push(Math.random() * 2 - 1);
        }
        rows.push(row);
    }
    return rows;
}

function force(r, a) {
    const beta = 0.3;
    if(r < beta) {
        return r / beta - 1;
    } else if (beta < r && r < 1) {
        return a * (1 - Math.abs(2 * r - 1 - beta) / (1 - beta));
    } else {
        return 0;
    }
}

function hash(x, y) {
    let gx = Math.floor(x / cellSize);
    let gy = Math.floor(y / cellSize);
    gx = ((gx % gridWidth) + gridWidth) % gridWidth;
    gy = ((gy % gridHeight) + gridHeight) % gridHeight;
    return `${gx},${gy}`;
}

function buildGrid() {
    grid.clear();
    for (const p of particles) {
        const key = hash(p.pos.x, p.pos.y); // normalized
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(p);
    }
}

let particles = [];
let colors = [];

class Particle {
    constructor(color, pos, vel = {x:0, y:0}) {
        this.color = color; // hex string
        this.pos = pos;
        this.vel = vel;
        
        if (!colors.find(col => col === this.color)) {
            colors.push(this.color);
        }

        particles.push(this);
    }

    computeForces() {
        const frictionHalfLife = 0.040;
        const frictionFactor = Math.pow(0.5, dt / frictionHalfLife);

        let totalForceX = 0, totalForceY = 0;
        const thisColorIndex = colors.indexOf(this.color);

        const px = this.pos.x, py = this.pos.y;
        const gx = Math.floor((px + 1e-4) / cellSize);
        const gy = Math.floor((py + 1e-4) / cellSize);

        const neighborRadius = 2;

        for (let dx = -neighborRadius; dx <= neighborRadius; dx++) {
            for (let dy = -neighborRadius; dy <= neighborRadius; dy++) {
                const nx = (gx + dx + gridWidth)  % gridWidth;
                const ny = (gy + dy + gridHeight) % gridHeight;
                const neighbors = grid.get(`${nx},${ny}`);
                if (!neighbors) continue;

                for (const other of neighbors) {
                    if (this === other) continue;

                    let rx = other.pos.x - this.pos.x;
                    let ry = other.pos.y - this.pos.y;

                    // shortest path across torus
                    if (rx > 0.5) rx -= 1;
                    if (rx < -0.5) rx += 1;
                    if (ry > 0.5) ry -= 1;
                    if (ry < -0.5) ry += 1;

                    const r2 = rx*rx + ry*ry;
                    if (r2 > 0 && r2 < maxRadius*maxRadius) {
                        const r = Math.sqrt(r2);
                        const a = matrix[thisColorIndex][colors.indexOf(other.color)];
                        const f = force(r / maxRadius, a);
                        totalForceX += rx / r * f;
                        totalForceY += ry / r * f;
                    }
                }
            }
        }
        totalForceX *= maxRadius * forceFactor;
        totalForceY *= maxRadius * forceFactor;

        // mouse attraction/repulsion force
        if (mouse.left.down || mouse.right.down) {
            let rx = mouse.x - this.pos.x;
            let ry = mouse.y - this.pos.y;

            // wrap across torus
            if (rx > 0.5) rx -= 1;
            if (rx < -0.5) rx += 1;
            if (ry > 0.5) ry -= 1;
            if (ry < -0.5) ry += 1;

            const r2 = rx*rx + ry*ry;
            const cursorRadius = 0.15; // attraction radius in normalized units
            if (r2 < cursorRadius*cursorRadius) {
                const r = Math.sqrt(r2);
                let strength = 5.0;
                if (mouse.right.down) strength *= -1; // repulse if right mouse
                const f = (1 - r/cursorRadius) * strength; // stronger near center
                totalForceX += rx / r * f;
                totalForceY += ry / r * f;
            }
        }

        // apply friction and accumulate velocity, position update happens in integrate()
        this.vel.x *= frictionFactor;
        this.vel.y *= frictionFactor;
        this.vel.x += totalForceX * dt;
        this.vel.y += totalForceY * dt;
    }

    integrate() {
        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;

        // avoid exact-boundary positions
        if (this.pos.x < 0) this.pos.x += 1;
        if (this.pos.x >= 1) this.pos.x -= 1;
        if (this.pos.y < 0) this.pos.y += 1;
        if (this.pos.y >= 1) this.pos.y -= 1;
    }
}

function drawParticles() {
    for (col of colors) {
        ctx.fillStyle = col;

        for (const p of particles) {
            if (p.color !== col) continue; // skip particles of other colors

            const screenX = p.pos.x * canvas.width;
            const screenY = p.pos.y * canvas.height;

            if (drawRadius < 3) { // use rectangles if small enough
                ctx.fillRect(screenX - drawRadius / 2, screenY - drawRadius / 2, drawRadius * 2, drawRadius * 2);
            } else {
                ctx.beginPath();
                ctx.arc(screenX, screenY, drawRadius, 0, Math.PI * 2); // expensive
                ctx.fill();
            }
        }
    }
}

function drawPerformance() {
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "12px monospace";
    ctx.fillText(`FPS: ${Math.round(fps)}`, 10, 20);
    ctx.fillText(`TPS: ${Math.round(tps)}`, 10, 36);
}

function drawCellBorders() {
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; // faint white lines
    ctx.lineWidth = 1;

    // Vertical lines
    for (let gx = 0; gx <= gridWidth; gx++) {
        const x = gx * cellSize * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    // Horizontal lines
    for (let gy = 0; gy <= gridHeight; gy++) {
        const y = gy * cellSize * canvas.height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function updateFPS() {
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) { // every 1 second
        fps = frames * 1000 / (now - lastFpsUpdate);
        frames = 0;
        lastFpsUpdate = now;
    }
}
function updateTPS() {
    const now = performance.now();
    if (now - lastTpsUpdate >= 1000) { // every 1 second
        tps = ticks * 1000 / (now - lastTpsUpdate);
        ticks = 0;
        lastTpsUpdate = now;
    }
}

function spawnRandomParticles(count, color) {
    for (let i = 0; i < count; i++) {
        new Particle(color, 
            {
                x: Math.random(),
                y: Math.random()
            }
        );
    }
}

spawnRandomParticles(200, "#ff0000");
spawnRandomParticles(200, "#00ff00");
spawnRandomParticles(200, "#ffff00");
spawnRandomParticles(200, "#00ffff");
spawnRandomParticles(200, "#0000ff");

window.onfocus = function() {
    currentTime = this.performance.now() / 1000;
    lastFrameTime = this.performance.now() / 1000;
    accumulator = 0;
};

window.onblur = function() {
    currentTime = this.performance.now() / 1000;
    lastFrameTime = this.performance.now() / 1000;
    accumulator = 0;
};

let mouse = { x: 0.5, y: 0.5, 
    left: { down: false },
    right: { down: false }
};

canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;   // normalize to [0,1]
    mouse.y = (e.clientY - rect.top) / rect.height;
});

canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
        mouse.left.down = true;
    } else if (e.button === 2) {
        mouse.right.down = true;
    }
});
canvas.addEventListener("mouseup",   (e) => {
    if (e.button === 0) {
        mouse.left.down = false;
    } else if (e.button === 2) {
        mouse.right.down = false;
    }
});

const fixedTimestep = 1 / 60 // 60 hz in seconds
const maxDt = 1 / 60; // fps floor
let currentTime = performance.now() / 1000;
let lastFrameTime = performance.now() / 1000; // seconds
let accumulator = 0;
let fps = 0;
let tps = 0;
let frames = 0;
let ticks = 0;
let lastFpsUpdate = performance.now();
let lastTpsUpdate = performance.now();

buildGrid();

function simulate() {
    currentTime = performance.now() / 1000; // seconds
    dt = Math.min(currentTime - lastFrameTime, maxDt);
    lastFrameTime = currentTime;
    accumulator += dt;
    frames++;

    // Simulate
    while (accumulator >= fixedTimestep) {
        // compute forces using the current grid snapshot
        for (const particle of particles) {
            particle.computeForces();
        }

        // then integrate positions and wrap
        for (const particle of particles) {
            particle.integrate(); // move, apply friction, wrap
        }

        // rebuild grid for the next substep
        buildGrid();

        accumulator -= fixedTimestep;
        updateTPS();
        ticks++;
    }

    // Render
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawParticles();
    // drawCellBorders();

    updateFPS();
    drawPerformance();

    requestAnimationFrame(simulate);
}

simulate();
