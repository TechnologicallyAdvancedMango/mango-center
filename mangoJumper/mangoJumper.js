/*

To do:

Add bottom of block collision
Add more gamemodes

*/

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let gravity = 0.3;
let speed = 5;
let gameSpeed = 1;

const unit = 30;

let objectStrokeWidth = 1.5;
let strokeWidth;

let playerFill = "white";
let playerStroke = "black";

let blockFillTop = "rgba(0,0,0,1)";
let blockFillBottom = "rgba(0,0,0,0)";
let blockStroke = "white";

let spikeFillTop = "rgba(0,0,0,1)";
let spikeFillBottom = "rgba(0,0,0,0)";
let spikeStroke = "white";

const portalTypes = {
    reverseGravity: (player) => { gravity = -Math.abs(gravity) },
    normalGravity: (player) => { gravity = Math.abs(gravity) },

    mini: (player) => { player.mini = true },
    normalSize: (player) => { player.mini = false },

    cube: (player) => { player.gameMode = "cube" },
    ship: (player) => { player.gameMode = "ship" }
}

let blocks = [];
let spikes = [];
let portals = [];

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vy = 0;

        this.gameMode = "cube";
        this.mini = false;

        this.width = this.mini ? unit/2: unit;
        this.height = this.mini ? unit/2: unit;

        this.rotation = 0;

        this.onGround = false;

        
    }

    update(dt) {
        this.scroll(dt);
        this.y += this.vy * dt;
        this.vy += (this.gameMode === "ship") ? 0: gravity; // No gravity as ship

        // Rotate clockwise while in the air if cube
        if (this.gameMode === "cube" && !this.onGround ) {
            this.rotation += 0.1 * dt;
        }

        // Ship movement
        if (this.gameMode === "ship") {
            if(isPressing) {
                this.vy -= 0.3 * dt;
            } else {
                this.vy += 0.3 * dt;
            }
            
        }
    }

    scroll(dt) {
        this.x += speed * dt;
    }
    
    jump() {
        if (this.gameMode === "cube" && this.onGround) {
            this.vy = this.mini ? -8: -11; // upward impulse
            this.onGround = false;
        }
    }

    collide() {
        this.onGround = false;

        // Ground collision
        if (this.x < ground.x + ground.width &&
            this.x + this.width > ground.x &&
            this.y < ground.y + ground.height &&
            this.y + this.height > ground.y) {

            if (this.vy > 0 && this.y + this.height <= ground.y + 10) {
                this.y = ground.y - this.height;
                this.vy = 0;
                this.onGround = true;

                // Snap rotation to nearest 90°
                const ninety = Math.PI / 2;
                this.rotation = Math.round(this.rotation / ninety) * ninety;
            }
        }

        for (let block of blocks) {
            if (this.x < block.x + block.width &&
                this.x + this.width > block.x &&
                this.y < block.y + block.height &&
                this.y + this.height > block.y) {
                
                // Land on top of block
                if (this.vy > 0 && this.y + this.height <= block.y + 10) {
                    this.y = block.y - this.height;
                    this.vy = 0;
                    this.onGround = true;

                    // Snap rotation to nearest 90°
                    const ninety = Math.PI / 2;
                    this.rotation = Math.round(this.rotation / ninety) * ninety;
                }

                // Check collision with left side of block
                if (this.x + this.width > block.x &&      // player’s right edge past block’s left edge
                    this.x < block.x &&                   // player’s left edge still left of block
                    this.y + this.height > block.y &&     // vertical overlap
                    this.y < block.y + block.height) {
                    this.die();
                }

                // Bottom collision (player's head hits underside of block)
                if (this.vy < 0 && this.y >= block.y + block.height - 10 &&
                    this.x + this.width > block.x &&
                    this.x < block.x + block.width) {

                    if (this.gameMode === "cube") {
                        // Cube dies when hitting underside
                        this.die();
                    } else {
                        // Other gamemodes: push player down out of the block
                        this.y = block.y + block.height;
                        this.vy = 0; // cancel upward velocity
                    }
                }
            }
        }

        for (let spike of spikes) {
            const [a, b, c] = spike.getVertices();

            const corners = [
                [this.x, this.y],
                [this.x + this.width, this.y],
                [this.x, this.y + this.height],
                [this.x + this.width, this.y + this.height]
            ];

            for (let [px, py] of corners) {
                if (pointInTriangle(px, py, a[0], a[1], b[0], b[1], c[0], c[1])) {
                    this.die();
                }
            }
        }

        for (let portal of portals) {
            if (this.x < portal.x + portal.width &&
                this.x + this.width > portal.x &&
                this.y < portal.y + portal.height &&
                this.y + this.height > portal.y) {
                
                portal.applyEffect(this);
            }
        }
    }

    die() {
        console.log("Game Over!");
        // Refresh
        window.location.reload();
    }

    draw(camera) {
        if(this.gameMode === "cube") {
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width);
            const screenH = camera.toScreenH(this.height);

            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.rotation);
            ctx.fillStyle = playerFill;
            ctx.fillRect(-screenW / 2, -screenH / 2, screenW, screenH);

            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;
            ctx.strokeRect(-screenW / 2, -screenH / 2, screenW, screenH);
            ctx.restore();
        } else if (this.gameMode === "ship") {
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width);
            const screenH = camera.toScreenH(this.height);

            // Calculate angle of movement
            const angle = Math.atan2(this.vy, speed);

            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(angle);

            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;

            // --- Draw cockpit square first (behind) ---
            const cockpitSize = screenH / 2;
            ctx.fillStyle = "gray";
            ctx.fillRect(-cockpitSize / 2, -screenH / 2 - cockpitSize / 2 + 10,
                        cockpitSize, cockpitSize);
            ctx.strokeRect(-cockpitSize / 2, -screenH / 2 - cockpitSize / 2 + 10,
                        cockpitSize, cockpitSize);

            // --- Draw trapezoid body on top ---
            ctx.fillStyle = playerFill;
            ctx.beginPath();
            ctx.moveTo(screenW / 2, -screenH / 4 + 10);              // nose top
            ctx.lineTo(screenW / 2, screenH / 4 + 10);               // nose bottom
            ctx.lineTo(-screenW / 2, screenH / 3 + 10);              // back bottom
            ctx.lineTo(-screenW / 2, -screenH / 3 + 10);             // back top
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        }
    }
}

class Block {
    constructor(x, y, width = unit, height = unit) {
        this.x = x;
        this.y = y;

        this.width = width;
        this.height = height;

        blocks.push(this);
    }

    draw(camera) {
        const screenX = camera.toScreenX(this.x);
        const screenY = camera.toScreenY(this.y);
        const screenW = camera.toScreenW(this.width);
        const screenH = camera.toScreenH(this.height);

        ctx.save();
        ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
        ctx.rotate(this.rotation || 0);

        // Gradient from top (opaque) to bottom (transparent)
        const grad = ctx.createLinearGradient(0, -screenH / 2, 0, screenH / 2);
        grad.addColorStop(0, blockFillTop);   // top opaque
        grad.addColorStop(1, blockFillBottom);   // bottom transparent

        ctx.fillStyle = grad;
        ctx.fillRect(-screenW / 2, -screenH / 2, screenW, screenH);

        ctx.strokeStyle = spikeStroke;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(-screenW / 2, -screenH / 2, screenW, screenH);

        ctx.restore();
    }
}

class Spike {
    constructor(x, y, width = unit, height = unit, rotation = 0) {
        this.x = x;
        this.y = y;
        this.width = width;   // full base width
        this.height = height; // full height
        this.rotation = rotation; // radians
        spikes.push(this);
    }

    // Get triangle vertices in world space
    getVertices() {
        // Local vertices (centered at spike.x, spike.y)
        const tip = [this.x + this.width/2, this.y];
        const leftBase = [this.x, this.y + this.height];
        const rightBase = [this.x + this.width, this.y + this.height];

        // Center of triangle for rotation
        const cx = this.x + this.width/2;
        const cy = this.y + this.height/2;

        // Rotate each vertex around center
        const rotate = ([vx, vy]) => {
            const dx = vx - cx;
            const dy = vy - cy;
            const cos = Math.cos(this.rotation);
            const sin = Math.sin(this.rotation);
            return [
                cx + dx * cos - dy * sin,
                cy + dx * sin + dy * cos
            ];
        };

        return [rotate(tip), rotate(rightBase), rotate(leftBase)];
    }

    draw(camera) {
        const [a, b, c] = this.getVertices(camera); // rotated vertices

        ctx.save();

        // Compute gradient direction: tip → base
        const tip = a;
        const baseMid = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];

        const grad = ctx.createLinearGradient(
            camera.toScreenX(tip[0]), camera.toScreenY(tip[1]),
            camera.toScreenX(baseMid[0]), camera.toScreenY(baseMid[1])
        );
        grad.addColorStop(0, spikeFillTop); // opaque at tip
        grad.addColorStop(1, spikeFillBottom); // transparent at base

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(camera.toScreenX(a[0]), camera.toScreenY(a[1]));
        ctx.lineTo(camera.toScreenX(b[0]), camera.toScreenY(b[1]));
        ctx.lineTo(camera.toScreenX(c[0]), camera.toScreenY(c[1]));
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = blockStroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();

        ctx.restore();
    }
}

class Portal {
    constructor(x, y, width = unit, height = toBlocks(3), effect) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.effect = effect;
        this.triggered = false;

        portals.push(this);
    }

    applyEffect(player) {
        if(this.triggered) return;
        portalTypes[this.effect](player);

        this.triggered = true
    }

    draw(camera) {
        const screenX = camera.toScreenX(this.x);
        const screenY = camera.toScreenY(this.y);
        const screenW = camera.toScreenW(this.width);
        const screenH = camera.toScreenH(this.height);

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.fillStyle = "rgba(0,255,0,0.3)";
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.restore();
    }
}

class Ground {
    constructor(y = 0, height = unit) {
        this.x = -50000;
        this.y = y;
        this.width = 100000;
        this.height = height;
    }

    draw(camera) {
        const screenX = camera.toScreenX(this.x);
        const screenY = camera.toScreenY(this.y);
        const screenW = camera.toScreenW(this.width);
        const screenH = camera.toScreenH(this.height);

        ctx.save();
        ctx.translate(screenX + screenW / 2, screenY + screenH / 2);

        const grad = ctx.createLinearGradient(0, -screenH / 2, 0, screenH / 2);
        grad.addColorStop(0, "#01073acc"); // top opaque
        grad.addColorStop(1, "#01073a1a"); // bottom transparent

        ctx.fillStyle = grad;
        ctx.fillRect(-screenW / 2, -screenH / 2, screenW, screenH);

        ctx.strokeStyle = spikeStroke;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(-screenW / 2, -screenH / 2, screenW, screenH);

        ctx.restore();
    }
}

class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.xOffset = canvas.width / 3;
        this.yOffset = 0;

        this.zoom = 3; // uniform zoom
        this.smoothFactor = 0.05; // smaller = smoother/slower
    }

    follow(player) {
        // X snaps directly (or you could smooth this too if desired)
        this.x = (player.x + player.width / 2) + this.xOffset;

        // Target Y center
        const targetY = (player.y + player.height / 2) + this.yOffset;

        // Smoothly interpolate current Y toward target
        this.y += (targetY - this.y) * this.smoothFactor;
    }

    toScreenX(worldX) {
        // Shift by camera center, scale, then offset by half canvas width
        return (worldX - this.x) * this.zoom + canvas.width / 2;
    }

    toScreenY(worldY) {
        // Shift by camera center, scale, then offset by half canvas height
        return (worldY - this.y) * this.zoom + canvas.height / 2;
    }

    toScreenW(worldW) {
        return worldW * this.zoom;
    }

    toScreenH(worldH) {
        return worldH * this.zoom;
    }
}

function toBlocks(num) {
    return num * unit;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const area = 0.5 * (-by*cx + ay*(-bx+cx) + ax*(by-cy) + bx*cy);
    const s = (ay*cx - ax*cy + (cy - ay) * px + (ax - cx) * py) / (2 * area);
    const t = (ax*by - ay*bx + (ay - by) * px + (bx - ax) * py) / (2 * area);
    return s >= 0 && t >= 0 && (s + t) <= 1;
}


let player = new Player(0, -unit);
let camera = new Camera(0, 0);
let ground = new Ground(0, 200);


// Level
new Spike(toBlocks(14), -toBlocks(1));
new Spike(toBlocks(15.5), -toBlocks(4), unit, unit, Math.PI);
new Block(toBlocks(15.5), -toBlocks(5))
new Spike(toBlocks(17), -toBlocks(1));

new Block(toBlocks(20), -toBlocks(1), unit, unit)
new Block(toBlocks(24), -toBlocks(3), unit, unit)
new Block(toBlocks(28), -toBlocks(5), unit, unit)
new Block(toBlocks(29), -toBlocks(5), unit, unit)

new Spike(toBlocks(29), -toBlocks(1));

new Block(toBlocks(32), -toBlocks(3), unit, unit)

new Block(toBlocks(33), -toBlocks(7), unit, unit)
new Spike(toBlocks(33), -toBlocks(8));

new Block(toBlocks(35), -toBlocks(1), unit, unit)
new Spike(toBlocks(36), -toBlocks(1));
new Spike(toBlocks(37), -toBlocks(1));
new Spike(toBlocks(38), -toBlocks(1));
new Spike(toBlocks(39), -toBlocks(1));

new Spike(toBlocks(46), -toBlocks(1));
new Spike(toBlocks(47), -toBlocks(1));
new Spike(toBlocks(48), -toBlocks(1));

new Portal(toBlocks(55), -toBlocks(3), unit, toBlocks(3), "ship");


let isPressing = false;

document.addEventListener("mousedown", (e) => {
    if(e.button === 0) isPressing = true;
    console.log(isPressing);
})
document.addEventListener("mouseup", (e) => {
    if(e.button === 0) isPressing = false;
    console.log(isPressing);
})

document.addEventListener("keydown", (e) => {
    if (e.repeat) {
        return; // Ignore repeated keydown events
    }

    if(e.key === " " || e.key === "w"|| e.key === "ArrowUp") isPressing = true;
    console.log(isPressing);

    if (e.key === "+") camera.zoom *= 1.1; // zoom in
    if (e.key === "-") camera.zoom *= 0.9; // zoom out
})
document.addEventListener("keyup", (e) => {
    if(e.key === " " || e.key === "w"|| e.key === "ArrowUp") isPressing = false;
    console.log(isPressing);
})

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Read the CSS size (layout size in CSS pixels)
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;

    // Set the internal drawing buffer to match CSS size * DPR
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    // Scale the context so 1 world pixel maps to 1 CSS pixel
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let lastFrameTime = performance.now();

function gameLoop() {
    const thisFrameTime = performance.now();
    const deltaTime = (thisFrameTime - lastFrameTime) / 16;
    lastFrameTime = performance.now();
    const simDt = deltaTime * gameSpeed;

    if (isPressing) player.jump();
    player.update(simDt);
    player.collide();


    // Rendering
    camera.follow(player);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokeWidth = objectStrokeWidth * camera.zoom; // Consistent look across zoom values

    ground.draw(camera);
    for (let spike of spikes) spike.draw(camera);
    for (let portal of portals) portal.draw(camera);
    for (let block of blocks) block.draw(camera);
    player.draw(camera);

    requestAnimationFrame(gameLoop);
}
gameLoop();