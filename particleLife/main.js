const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth);
canvas.height = Math.floor(canvas.clientHeight);


const maxRadius = 0.1;
const forceFactor = 25;

const cellSize = maxRadius; // cell size ~ interaction radius
let grid = new Map

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
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    return `${gx},${gy}`;
}

function buildGrid() {
    grid.clear();
    for (const p of particles) {
        const px = p.pos.x * canvas.width;
        const py = p.pos.y * canvas.height;
        const key = hash(px, py);
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

    update() {
        const frictionHalfLife = 0.040;
        const frictionFactor = Math.pow(0.5, dt / frictionHalfLife);

        // update velocity
        let totalForceX = 0;
        let totalForceY = 0;

        const px = this.pos.x * canvas.width;
        const py = this.pos.y * canvas.height;
        const gx = Math.floor(px / cellSize);
        const gy = Math.floor(py / cellSize);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const neighborKey = `${gx+dx},${gy+dy}`;
                const neighbors = grid.get(neighborKey);
                if (!neighbors) continue;

                for (const other of particles) {
                    if (this === other) continue;

                    // wrapped displacement
                    let rx = other.pos.x - this.pos.x;
                    let ry = other.pos.y - this.pos.y;

                    // choose shortest path across torus
                    if (rx > 0.5) rx -= 1;
                    if (rx < -0.5) rx += 1;
                    if (ry > 0.5) ry -= 1;
                    if (ry < -0.5) ry += 1;

                    const r = Math.hypot(rx, ry);

                    if (r > 0 && r < maxRadius) {
                        const f = force(r / maxRadius, matrix[colors.indexOf(this.color)][colors.indexOf(other.color)]);
                        totalForceX += rx / r * f;
                        totalForceY += ry / r * f;
                    }
                }
            }
        }

        totalForceX *= maxRadius * forceFactor;
        totalForceY *= maxRadius * forceFactor;

        this.vel.x *= frictionFactor;
        this.vel.y *= frictionFactor;

        this.vel.x += totalForceX * dt;
        this.vel.y += totalForceY * dt;

        // update position
        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;

        // wrap around [0,1]
        if (this.pos.x < 0) this.pos.x += 1;
        if (this.pos.x > 1) this.pos.x -= 1;
        if (this.pos.y < 0) this.pos.y += 1;
        if (this.pos.y > 1) this.pos.y -= 1;
    }

    draw() {
        const radius = 1;

        ctx.beginPath();
        const screenX = this.pos.x * canvas.width;
        const screenY = this.pos.y * canvas.height;
        ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);

        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

function drawFPS() {
    ctx.fillStyle = "white";
    ctx.font = "16px monospace";
    ctx.fillText(`FPS: ${Math.round(fps)}`, 10, 20);
}

function updateFPS() {
    frames++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) { // every 1 second
        fps = frames * 1000 / (now - lastFpsUpdate);
        frames = 0;
        lastFpsUpdate = now;
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

spawnRandomParticles(75, "#ff0000");
spawnRandomParticles(75, "#00ff00");
spawnRandomParticles(75, "#ffff00");
spawnRandomParticles(75, "#00ffff");
spawnRandomParticles(75, "#0000ff");

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

const fixedTimestep = 1 / 60 // 60 hz in seconds'
let currentTime = performance.now() / 1000;
let lastFrameTime = performance.now() / 1000; // seconds
let accumulator = 0;
let simFrames = 0;
let fps = 0;
let frames = 0;
let lastFpsUpdate = performance.now();

function simulate() {
    currentTime = performance.now() / 1000; // seconds
    dt = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
    accumulator += dt;

    // Simulate
    while (accumulator >= fixedTimestep) {
        if (simFrames % 4 == 0) { // every 4 simulation frames
            buildGrid(); // refresh grid with current positions
        }
        for (const particle of particles) {
            particle.update();
        }
        accumulator -= fixedTimestep;
        simFrames++;
    }

    // Render
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const particle of particles) {
        particle.draw();
    }

    updateFPS();
    drawFPS();

    requestAnimationFrame(simulate);
}

simulate();
