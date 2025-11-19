/*

To do:

Fix for chromebooks
Add more gamemodes/portals

*/

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let gravity = 0.85;
let speed = 5;
let gameSpeed = 1;

let frameMultiplier = 10;
let simFrameCount = 0;

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
    ship: (player) => { player.gameMode = "ship" },
    ufo: (player) => { player.gameMode = "ufo"},
    wave: (player) => { player.gameMode = "wave"}
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
        this.god = false;

        this.width = this.mini ? unit/2: unit;
        this.height = this.mini ? unit/2: unit;

        this.rotation = 0;

        this.onGround = false;
        this.coyoteTime = 0;
        this.maxCoyoteTime = 10;
        this.alive = true;

        this.waveHitboxScale = 0.4;
        // For wave trail
        this.trail = []; // stores past positions
        this.maxTrailLength = 200; // tweak for longer/shorter trail
    }

    update(dt) {
        this.scroll(dt);
        this.y += this.vy * dt;
        this.vy += (this.gameMode === "ship" || this.gameMode === "ufo") ? 0: gravity * dt; // No gravity as ship or ufo, custom gravity

        if(this.onGround) {
            this.coyoteTime = 0;
        } else {
            this.coyoteTime += dt;
        }

        if (isPressing && !cancelPress) this.jump();

        // Rotate clockwise while in the air if cube
        if (this.gameMode === "cube" && !this.onGround ) {
            if(gravity >= 0) {
                this.rotation += 0.1 * dt;
            } else {
                this.rotation -= 0.1 * dt; // Counterclockwise if upside down
            } 
        }

        // Ship movement
        if (this.gameMode === "ship") {
            if(isPressing) {
                this.vy -= gravity * dt * 0.5; // Tweak for good feeling ship
            } else {
                this.vy += gravity * dt * 0.5;
            }
            
        } else if (this.gameMode === "wave") {
            let slopeSpeed = this.mini ? speed * 2 : speed;
            if(gravity < 0) slopeSpeed *= -1;

            // Only apply slope movement if not grounded
            if (!this.onGround) {
                this.vy = isPressing ? -slopeSpeed : slopeSpeed;
            } else {
                this.vy = 0; // stay stable on ground
            }

            // Add current position to trail
            this.trail.push({ x: this.x, y: this.y });

            // Limit trail length
            if (this.trail.length > this.maxTrailLength * dt && simFrameCount % 10 === 0) {
                this.trail.shift();
            }

            if(!this.onGround) {
                this.rotation = (this.vy < 0) ? -Math.PI / 4 : Math.PI / 4;
            }
        } else if (this.gameMode === "ufo") {
            if (!this.onGround) {
                this.vy += gravity * dt * 0.5; // Tweak for good feeling ufo
            }
        }
    }

    scroll(dt) {
        this.x += speed * dt;
    }
    
    jump() {
        let jumpingForce = 11;
        if (this.gameMode === "ufo") jumpingForce = 8;
        if(gravity < 0) jumpingForce *= -1; // Reverse direction if gravity flipped

        let canJump = false;
        if(this.onGround || this.coyoteTime <= this.maxCoyoteTime);

        if ((this.gameMode === "cube" && this.onGround) || this.gameMode === "ufo") {
            this.vy = this.mini ? -jumpingForce * 0.7: -jumpingForce; // upward impulse, smaller for mini
            this.onGround = false;

            if (this.gameMode === "ufo") cancelPress = true;
        }
    }

    getHitbox() {
        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (this.gameMode === "wave") {
            scale = this.waveHitboxScale; // e.g. 0.6
            // fine‑tuning just for wave
            offsetY = (this.width - this.width * scale) / 5;
            offsetX = (this.height - this.height * scale) / 5;
        } else if (this.mini) {
            scale = 0.7;
            offsetX = (this.width - this.width * scale) / 2;
            offsetY = (this.height - this.height * scale) / 2;
        } else {
            // default centering
            offsetX = (this.width - this.width * scale) / 2;
            offsetY = (this.height - this.height * scale) / 2;
        }

        const w = this.width * scale;
        const h = this.height * scale;

        return {
            x: this.x + offsetX,
            y: this.y + offsetY,
            width: w,
            height: h
        };
    }

    collide() {
        this.onGround = false;
        const hb = this.getHitbox();

        // Ground collision
        if (hb.x < ground.x + ground.width &&
            hb.x + hb.width > ground.x &&
            hb.y < ground.y + ground.height &&
            hb.y + hb.height >= ground.y - 1) {  // allow equality 

            if (this.gameMode === "wave") {
                // Wave: clamp to ground, keep sliding
                if (this.vy > 0 && hb.y + hb.height >= ground.y) {
                    this.y = ground.y - (hb.height + (hb.y - this.y)); // offset-aware snap
                    this.vy = 0;
                    this.onGround = true;

                    // snap rotation to 90 degree increments
                    const ninety = Math.PI / 2;
                    this.rotation = Math.round(this.rotation / ninety) * ninety;
                }
            } else {
                // Cube/ship/etc: land on ground
                if (this.vy > 0 && hb.y + hb.height <= ground.y + 10) {
                    this.y = ground.y - this.height;
                    this.vy = 0;
                    this.onGround = true;

                    // snap rotation to 90° increments
                    const ninety = Math.PI / 2;
                    this.rotation = Math.round(this.rotation / ninety) * ninety;
                }
            }
        }


        // --- Block collisions ---
        for (let block of blocks) {
        // recompute hb per block if needed (sprite y may change)
        const hb = this.getHitbox();

        if (hb.x < block.x + block.width &&
            hb.x + hb.width > block.x &&
            hb.y < block.y + block.height &&
            hb.y + hb.height > block.y) {

            // Wave dies on any block hit
            if (this.gameMode === "wave") {
                this.die();
                continue;
            }

            let ceilingBlocked = false;

            if (gravity > 0) {
                // --- Normal gravity: land on top ---
                if (this.vy > 0 && hb.y + hb.height <= block.y + 1) {
                    this.y = block.y - this.height;
                    this.vy = 0;
                    this.onGround = true;

                    const ninety = Math.PI / 2;
                    this.rotation = Math.round(this.rotation / ninety) * ninety;
                    continue; // don't check underside/side this frame
                }

                // Head hits underside
                if (this.vy < 0 && hb.y >= block.y + block.height - 10 &&
                    hb.x + hb.width > block.x &&
                    hb.x < block.x + block.width) {
                    
                    if (this.gameMode === "cube") {
                        this.die(); // cube dies
                    } else {
                        // UFO/ship/etc: clamp to underside and zero vy
                        this.y = block.y + block.height;
                        this.vy = 0;
                        ceilingBlocked = true;
                    }
                    // After underside resolution, skip side for this block
                    continue;
                }
            } else {
                // --- Flipped gravity: land on bottom ---
                if (this.vy < 0 && hb.y >= block.y + block.height - 10) {
                    this.y = block.y + block.height;
                    this.vy = 0;
                    this.onGround = true;

                    const ninety = Math.PI / 2;
                    this.rotation = Math.round(this.rotation / ninety) * ninety;
                    continue;
                }

                // Feet hit top
                if (this.vy > 0 && hb.y + hb.height <= block.y + 10 &&
                    hb.x + hb.width > block.x &&
                    hb.x < block.x + block.width) {
                    if (this.gameMode === "cube") {
                        this.die(); // cube dies
                    } else {
                        // ship/other: clamp to top and zero vy
                        this.y = block.y - this.height;
                        this.vy = 0;
                        ceilingBlocked = true;
                    }
                    continue;
                }
            }

            // Side collision → fatal only if not grounded or ceiling-resolved
            if (!this.onGround && !ceilingBlocked &&
                hb.x + hb.width > block.x &&
                hb.x < block.x &&
                hb.y + hb.height > block.y &&
                hb.y < block.y + block.height) {
                this.die();
                continue;
            }
        }
    }

        // --- Spike collisions ---
        for (let spike of spikes) {
            const [a, b, c] = spike.getVertices();
            const corners = [
                [hb.x, hb.y],
                [hb.x + hb.width, hb.y],
                [hb.x, hb.y + hb.height],
                [hb.x + hb.width, hb.y + hb.height]
            ];
            for (let [px, py] of corners) {
                if (pointInTriangle(px, py, a[0], a[1], b[0], b[1], c[0], c[1])) {
                    this.die();
                }
            }
        }

        // --- Portal collisions ---
        for (let portal of portals) {
            if (hb.x < portal.x + portal.width &&
                hb.x + hb.width > portal.x &&
                hb.y < portal.y + portal.height &&
                hb.y + hb.height > portal.y) {
                portal.applyEffect(this);
            }
        }

        if (Math.abs(this.y + this.height - ground.y) < 2 && this.vy > 0 && this.gameMode === "wave") {
            this.onGround = true; this.vy = 0;
        }
    }


    die() {
        if (this.god) return;
        this.alive = false;
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
        } else if (this.gameMode === "ufo") {
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width);
            const screenH = camera.toScreenH(this.height);

            ctx.fillStyle = playerFill;
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;

            ctx.beginPath();
            ctx.arc(
                screenX + screenW / 2,   // center X
                screenY + screenH / 2,   // center Y
                screenH / 2,             // radius
                0,
                Math.PI * 2
            );
            ctx.fill();
            ctx.stroke();
        } else if (this.gameMode === "wave") {
            const scale = this.waveHitboxScale * 1.6; // scale drawing with hitbox scale plus some extra
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width * scale);
            const screenH = camera.toScreenH(this.height * scale);

            // --- Trail ---
            ctx.beginPath();
            for (let i = 0; i < this.trail.length; i++) {
                const t = this.trail[i];
                const tx = camera.toScreenX(t.x) + screenW / 2;
                const ty = camera.toScreenY(t.y) + screenH / 2;

                if (i === 0) ctx.moveTo(tx, ty);
                else ctx.lineTo(tx, ty);
            }
            ctx.lineWidth = 35 * scale;   // scale trail thickness
            ctx.strokeStyle = "#2dabffff";
            ctx.stroke();
            ctx.lineWidth = 15 * scale;
            ctx.strokeStyle = "#ffffffff";
            ctx.stroke();

            // --- Wave triangle ---
            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.rotation);

            ctx.fillStyle = playerFill;
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth * scale;

            ctx.beginPath();
            ctx.moveTo(-screenW / 2, screenH / 2);
            ctx.lineTo(screenW / 2, 0);
            ctx.lineTo(-screenW / 2, -screenH / 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.restore();

            /* hitbox
            const hb = this.getHitbox();
            ctx.strokeStyle = "red";
            ctx.lineWidth = 2;
            ctx.strokeRect(
                camera.toScreenX(hb.x),
                camera.toScreenY(hb.y),
                camera.toScreenW(hb.width),
                camera.toScreenH(hb.height)
            );
            */
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
        player.vy = 0;
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

        this.zoom = 2.5; // uniform zoom
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
new Block(toBlocks(21), -toBlocks(1), unit, unit)

new Block(toBlocks(24), -toBlocks(3), unit, unit)
new Block(toBlocks(25), -toBlocks(3), unit, unit)
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

new Spike(toBlocks(46), -toBlocks(1));
new Spike(toBlocks(47), -toBlocks(1));
new Spike(toBlocks(48), -toBlocks(1));

new Portal(toBlocks(55), -toBlocks(3), unit, toBlocks(3), "reverseGravity");

new Block(toBlocks(55), -toBlocks(6));
new Block(toBlocks(56), -toBlocks(6));
new Block(toBlocks(57), -toBlocks(6));

new Block(toBlocks(60), -toBlocks(7));

new Spike(toBlocks(62), -toBlocks(6), unit, unit, Math.PI);

new Block(toBlocks(64), -toBlocks(7));
new Block(toBlocks(65), -toBlocks(8));
new Block(toBlocks(66), -toBlocks(8));
new Block(toBlocks(67), -toBlocks(8));

new Portal(toBlocks(71), -toBlocks(6), unit, toBlocks(3), "normalGravity");

new Portal(toBlocks(77), -toBlocks(4), unit, toBlocks(3), "ship");

// Straightfly
for(let i = 0; i < 30; i++) {
    new Block(toBlocks(77 + i), -toBlocks(7));
    new Spike(toBlocks(77 + i), -toBlocks(6), unit, unit, Math.PI);

    new Spike(toBlocks(77 + i), -toBlocks(1), unit, unit, 0);
}

new Portal(toBlocks(108), -toBlocks(4), unit, toBlocks(3), "ufo");

// Roof
for(let i = 0; i < 50; i++) {
    new Block(toBlocks(108 + i), -toBlocks(10));
}

// Pillars with gaps
for(let i = 0; i < 9; i++) {
    if(i <= 4 && i >= 1) continue;
    new Block(toBlocks(120), -toBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 8 && i >= 5) continue;
    new Block(toBlocks(130), -toBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 5 && i >= 2) continue;
    new Block(toBlocks(140), -toBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 7 && i >= 4) continue;
    new Block(toBlocks(150), -toBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 6 && i >= 3) continue;
    new Block(toBlocks(157), -toBlocks(1 + i));
}

new Portal(toBlocks(157), -toBlocks(6.5), unit, toBlocks(3), "cube");

new Portal(toBlocks(163), -toBlocks(3), unit, toBlocks(3), "wave");


let isPressing = false;
let cancelPress = false;

document.addEventListener("mousedown", (e) => {
    if(e.button === 0) isPressing = true;
    console.log(isPressing);
})
document.addEventListener("mouseup", (e) => {
    if(e.button === 0) isPressing = false;
    console.log(isPressing);

    cancelPress = false;
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
    const simDt = deltaTime * gameSpeed / frameMultiplier;

    if (player.alive) {
        
        for(let i = 0; i < frameMultiplier; i++) {
            player.collide();
            player.update(simDt);

            simFrameCount++
        }
    }

    // Rendering
    camera.follow(player);

    player.maxTrailLength = 400 / camera.zoom;

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
