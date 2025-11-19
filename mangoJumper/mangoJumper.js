/*

To do:

Fix block y = 0 blocks not killing you
Add orbs and pads
Add more gamemodes/portals

*/

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let gravity = 0.85;
let speed = 5;
let gameSpeed = 1;

let simFrameCount = 0;

const unit = 30;

const spikeHitboxSize = 0.4;

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
    wave: (player) => { player.gameMode = "wave"},
    ball: (player) => { player.gameMode = "ball"}
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
        this.drawRotation = this.rotation;
        this.currentBallRotationSpeed = 0;

        this.onGround = false;
        this.coyoteTime = 0;
        this.maxCoyoteTime = 0; // isnt in gd

        this.alive = true;

        this.waveHitboxScale = 0.4;
        // For wave trail
        this.trail = []; // stores past positions
    }

    update(dt) {
        this.scroll(dt);
        this.y += this.vy * dt;
        this.vy += (this.gameMode === "ship" || this.gameMode === "ufo" || this.gameMode === "ball") ? 0: gravity * dt; // No gravity as ship, ufo, or ball, custom gravity

        if(this.gameMode === "ufo") {
            this.rotation = 0;
        }

        if (!this.gameMode === "wave") this.trail = [];

        if(this.onGround) {
            this.coyoteTime = 0;
        } else {
            this.coyoteTime += dt;
        }

        if (isPressing && !cancelPress) this.jump();

        // Gamemode movements (some are in jump())

        // Rotate clockwise while in the air if cube
        if (this.gameMode === "cube" && !this.onGround ) {
            if(gravity >= 0) {
                this.rotation += 0.12 * dt;
            } else {
                this.rotation -= 0.12 * dt; // Counterclockwise if upside down
            } 
        } else if (this.gameMode === "ship") {
            if(isPressing) {
                this.vy -= gravity * dt * 0.5; // Tweak for good feeling ship
            } else {
                this.vy += gravity * dt * 0.5;
            }
            // Calculate angle of movement
            const angle = Math.atan2(this.vy, speed);
            this.rotation = angle;
            
        } else if (this.gameMode === "wave") {
            let slopeSpeed = this.mini ? speed * 2 : speed;
            if(gravity < 0) slopeSpeed *= -1;

            // Only apply slope movement if not grounded
            if (!this.onGround) {
                this.vy = isPressing ? -slopeSpeed : slopeSpeed;
            } else {
                this.vy = 0; // stay stable on ground
            }

            // Add current position to trail every 10 frames
            if (simFrameCount % 10 === 0) {
                this.trail.push({ x: this.x, y: this.y });
            }
            // Remove points of the trail that are off the left edge of the camera view
            const leftEdge = camera.toWorldX(0); // world coordinate of screen's left edge
            this.trail = this.trail.filter(p => p.x >= leftEdge - 10); // Extra room to the left


            if(!this.onGround) {
                this.rotation = (this.vy < 0) ? -Math.PI / 4 : Math.PI / 4;
            }
        } else if (this.gameMode === "ufo") {
            if (!this.onGround) {
                this.vy += gravity * dt * 0.5; // Tweak for good feeling ufo
            }
        } else if (this.gameMode === "ball") {
            // gravity change is in jump()
            this.vy += gravity * dt * 0.4; // Tweak for good feeling ball

            if(this.onGround && !cancelPress) { // Only change direction when landing
                if(gravity >= 0) {
                    this.currentBallRotationSpeed = 0.2;
                } else {
                    this.currentBallRotationSpeed = -0.2; // Counterclockwise if upside down
                }
            }
            this.rotation += this.currentBallRotationSpeed * dt;
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
        if(this.onGround || this.coyoteTime <= this.maxCoyoteTime) { // Have to be grounded:
            if (this.gameMode === "cube" && this.onGround) {
                this.vy = this.mini ? -jumpingForce * 0.7: -jumpingForce; // upward impulse, smaller for mini
                this.onGround = false;

            } else if (this.gameMode === "ball" && this.onGround) {
                gravity *= -1; // Flip gravity
                this.vy = gravity < 0 ? -1: 1; // 1 velocity away from surface to avoid collision detection killing

                cancelPress = true;
            }
        } else if (this.gameMode === "ufo") { // Dont have to be grounded
            this.vy = this.mini ? -jumpingForce * 0.7: -jumpingForce; // upward impulse, smaller for mini
            this.onGround = false;

            cancelPress = true; // Cancel this press to not keep going up
        }
    }

    getHitbox() {
        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (this.gameMode === "wave") {
            scale = this.waveHitboxScale; // e.g. 0.6
            if (this.mini) scale *= 0.7;
            // fine‑tuning just for wave
            offsetY = (this.width - this.width * scale) / 5;
            offsetX = (this.height - this.height * scale) / 5;
        } else {
            if (this.mini) scale *= 0.7;
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

        // how far ahead/behind to check
        const forwardRange = inBlocks(6);  // pixels ahead
        const backwardRange = inBlocks(3); // pixels behind

        const minX = hb.x - backwardRange;
        const maxX = hb.x + hb.width + forwardRange;


        function snapTo90(player) {
            if (player.gameMode !== "ball") {
                const ninety = Math.PI / 2;
                player.rotation = Math.round(player.rotation / ninety) * ninety;
            }
        }

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
                    snapTo90(this);
                }
            } else {
                // Cube/ship/etc: land on ground
                if (this.vy > 0 && hb.y + hb.height <= ground.y + 10) {
                    this.y = ground.y - this.height;
                    this.vy = 0;
                    this.onGround = true;

                    // snap rotation to 90 degree increments
                    snapTo90(this);
                }
            }
        }


        // --- Block collisions ---
        for (let block of blocks) {
            // recompute hb per block if needed (sprite y may change)
            const hb = this.getHitbox();

            if (block.x + block.width < minX || block.x > maxX) {
                continue; // too far left or right, skip
            }

            if (hb.x < block.x + block.width &&
                hb.x + hb.width > block.x &&
                hb.y < block.y + block.height &&
                hb.y + hb.height > block.y) {

                // Wave dies on any block hit
                if (this.gameMode === "wave") {
                    this.die();
                    return;
                }

                let ceilingBlocked = false;

                if (gravity > 0) {
                    // --- Normal gravity: land on top ---
                    if (this.vy > 0 && hb.y + hb.height <= block.y + 1) {
                        this.y = block.y - this.height;
                        this.vy = 0;
                        this.onGround = true;

                        snapTo90(this);
                        continue; // don't check underside/side this frame
                    }

                    // Head hits underside
                    if (this.vy < 0 && hb.y >= block.y + block.height - 10 &&
                        hb.x + hb.width > block.x &&
                        hb.x < block.x + block.width) {
                        
                        if (this.gameMode === "cube") {
                            this.die(); // cube dies
                            return;
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

                        snapTo90(this);
                        continue;
                    }

                    // Feet hit top
                    if (this.vy > 0 && hb.y + hb.height <= block.y + 10 &&
                        hb.x + hb.width > block.x &&
                        hb.x < block.x + block.width) {
                        if (this.gameMode === "cube") {
                            this.die(); // cube dies
                            return;
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
                    return;
                }
            }
        }

        // --- Spike collisions ---
        const rectEdges = [
            // [x1, y1, x2, y2]
            [hb.x, hb.y, hb.x + hb.width, hb.y],                    // top
            [hb.x + hb.width, hb.y, hb.x + hb.width, hb.y + hb.height], // right
            [hb.x + hb.width, hb.y + hb.height, hb.x, hb.y + hb.height], // bottom
            [hb.x, hb.y + hb.height, hb.x, hb.y]                     // left
        ];

        const pointInRect = (px, py, r) =>
        px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;

        const segmentsIntersect = (x1, y1, x2, y2, x3, y3, x4, y4) => {
            const cross = (ax, ay, bx, by) => ax * by - ay * bx;
            const d1x = x2 - x1, d1y = y2 - y1;
            const d2x = x4 - x3, d2y = y4 - y3;
            const denom = cross(d1x, d1y, d2x, d2y);
            if (denom === 0) return false; // parallel
            const t = cross(x3 - x1, y3 - y1, d2x, d2y) / denom;
            const u = cross(x3 - x1, y3 - y1, d1x, d1y) / denom;
            return t >= 0 && t <= 1 && u >= 0 && u <= 1;
        };

        for (let spike of spikes) {
            if (spike.x + spike.width < minX || spike.x > maxX) {
                continue; // skip spike outside window
            }

            const [a, b, c] = spike.getCollisionVertices(); // already scaled/rotated around center

            // Player corners inside triangle
            const corners = [
                [hb.x, hb.y],
                [hb.x + hb.width, hb.y],
                [hb.x, hb.y + hb.height],
                [hb.x + hb.width, hb.y + hb.height]
            ];
            for (let [px, py] of corners) {
                if (pointInTriangle(px, py, a[0], a[1], b[0], b[1], c[0], c[1])) {
                this.die();
                break;
                }
            }

            // Triangle vertices inside player rect
            if (pointInRect(a[0], a[1], hb) || pointInRect(b[0], b[1], hb) || pointInRect(c[0], c[1], hb)) {
                this.die();
                continue;
            }

            // Edge intersection: triangle edges vs rect edges
            const triEdges = [
                [a[0], a[1], b[0], b[1]],
                [b[0], b[1], c[0], c[1]],
                [c[0], c[1], a[0], a[1]]
            ];

            let hit = false;
            for (const [tx1, ty1, tx2, ty2] of triEdges) {
                for (const [rx1, ry1, rx2, ry2] of rectEdges) {
                if (segmentsIntersect(tx1, ty1, tx2, ty2, rx1, ry1, rx2, ry2)) {
                    hit = true;
                    break;
                }
                }
                if (hit) break;
            }
            if (hit) {
                this.die();
                continue;
            }
        }

        // --- Portal collisions ---
        for (let portal of portals) {
            if (portal.x + portal.width < minX || portal.x > maxX) {
                continue; // skip portal outside window
            }
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
        if (this.god || !this.alive) return;
        this.alive = false;
        console.log("Game Over!");
        // Refresh
        window.location.reload();
    }

    draw(camera) {
        const smoothFactor = 0.15; // smaller = slower smoothing
        this.drawRotation += (this.rotation - this.drawRotation) * smoothFactor;

        if(this.gameMode === "cube") {
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width);
            const screenH = camera.toScreenH(this.height);

            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.rotation); // Use real rotation for cube
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

            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.drawRotation);

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

            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.drawRotation);

            ctx.fillStyle = playerFill;
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;

            // --- Main oval body ---
            ctx.beginPath();
            ctx.ellipse(0, 0, screenW / 2, screenH / 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // --- Dome on top ---
            ctx.beginPath();
            ctx.arc(0, -screenH / 4, screenW / 4, Math.PI * 2, 0, false);
            ctx.fillStyle = "rgba(155, 155, 155, 1)"; // opaque dome
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        } else if (this.gameMode === "wave") {
            const scale = this.waveHitboxScale * 1.6; // scale the drawing with hitbox scale plus some extra
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
            ctx.lineWidth = 30 * (strokeWidth / 4); // scale trail thickness like other strokes
            ctx.strokeStyle = "#2dabffff";
            ctx.stroke();
            ctx.lineWidth = 10 * (strokeWidth / 4);
            ctx.strokeStyle = "#ffffffff";
            ctx.stroke();

            // --- Wave triangle ---
            ctx.save();
            ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
            ctx.rotate(this.drawRotation);

            ctx.fillStyle = playerFill;
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;

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
        } else if (this.gameMode === "ball") {
            const screenX = camera.toScreenX(this.x);
            const screenY = camera.toScreenY(this.y);
            const screenW = camera.toScreenW(this.width);
            const screenH = camera.toScreenH(this.height);

            const cx = screenX + screenW / 2;
            const cy = screenY + screenH / 2;
            const r = screenH / 2;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(this.drawRotation);

            // --- Outer circle ---
            ctx.fillStyle = playerFill;
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // --- Symmetrical design (simplified) ---
            ctx.strokeStyle = playerStroke;
            ctx.lineWidth = strokeWidth / 2;

            // Single inner ring
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
            ctx.stroke();

            // One perpendicular line
            ctx.beginPath();
            ctx.moveTo(0, -r);
            ctx.lineTo(0, r);
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

    getVertices() {
        const tip = [this.x + this.width / 2, this.y];
        const leftBase = [this.x, this.y + this.height];
        const rightBase = [this.x + this.width, this.y + this.height];
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        const rotate = ([vx, vy]) => {
            const dx = vx - cx, dy = vy - cy;
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        };

        return [rotate(tip), rotate(rightBase), rotate(leftBase)];
    }

    getCollisionVertices() {
        // Base triangle vertices (tip + base corners)
        const tip = [this.x + this.width / 2, this.y];
        const leftBase = [this.x, this.y + this.height];
        const rightBase = [this.x + this.width, this.y + this.height];

        // Use rectangle center as anchor
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        // Scale factor: 1 = full size, <1 shrinks inward, >1 grows outward
        const scale = spikeHitboxSize ?? 1;

        // Scale a vertex toward/away from rectangle center
        const scaleVertex = ([vx, vy]) => {
            return [
                cx + (vx - cx) * scale,
                cy + (vy - cy) * scale
            ];
        };

        // Rotate a vertex around rectangle center
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

        // Apply scaling then rotation
        return [
            rotate(scaleVertex(tip)),
            rotate(scaleVertex(rightBase)),
            rotate(scaleVertex(leftBase))
        ];
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
    constructor(x, y, width = unit, height = inBlocks(3), effect) {
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
        player.rotation = 0;
        player.drawRotation = 0;

        portalTypes[this.effect](player);

        this.triggered = true;
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
        const targetY = Math.min((player.y + player.height / 2) + this.yOffset, -100);

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

    toWorldX(screenX) {
    return (screenX - canvas.width / 2) / this.zoom + this.x;
}

    toWorldY(screenY) {
        return (screenY - canvas.height / 2) / this.zoom + this.y;
    }
}

function inBlocks(blocks) {
    return blocks * unit;
}

function toBlocks(blocks) {
    return blocks / unit
}

function fillBlocks(x1, y1, x2, y2) {
    const startX = Math.min(toBlocks(x1), toBlocks(x2));
    const endX   = Math.max(toBlocks(x1), toBlocks(x2));
    const startY = Math.min(toBlocks(y1), toBlocks(y2));
    const endY   = Math.max(toBlocks(y1), toBlocks(y2));

    for (let bx = startX; bx <= endX; bx++) {
        for (let by = startY; by <= endY; by++) {
            new Block(inBlocks(bx), inBlocks(by));
        }
    }
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const area = 0.5 * (-by*cx + ay*(-bx+cx) + ax*(by-cy) + bx*cy);
    const s = (ay*cx - ax*cy + (cy - ay) * px + (ax - cx) * py) / (2 * area);
    const t = (ax*by - ay*bx + (ay - by) * px + (bx - ax) * py) / (2 * area);
    return s >= 0 && t >= 0 && (s + t) <= 1;
}


let player = new Player(inBlocks(0), -unit);
let camera = new Camera(player.x, player.y);
let ground = new Ground(0, 200);

// Level
new Spike(inBlocks(14), -inBlocks(1));
new Spike(inBlocks(15.5), -inBlocks(4), unit, unit, Math.PI);
new Block(inBlocks(15.5), -inBlocks(5))
new Spike(inBlocks(17), -inBlocks(1));

new Block(inBlocks(20), -inBlocks(1), unit, unit)
new Block(inBlocks(21), -inBlocks(1), unit, unit)

new Block(inBlocks(24), -inBlocks(3), unit, unit)
new Block(inBlocks(25), -inBlocks(3), unit, unit)
new Block(inBlocks(28), -inBlocks(5), unit, unit)
new Block(inBlocks(29), -inBlocks(5), unit, unit)

new Spike(inBlocks(29), -inBlocks(1));

new Block(inBlocks(32), -inBlocks(3), unit, unit)

new Block(inBlocks(33), -inBlocks(7), unit, unit)
new Spike(inBlocks(33), -inBlocks(8));

new Block(inBlocks(35), -inBlocks(1), unit, unit)
new Spike(inBlocks(36), -inBlocks(1));
new Spike(inBlocks(37), -inBlocks(1));
new Spike(inBlocks(38), -inBlocks(1));

new Spike(inBlocks(46), -inBlocks(1));
new Spike(inBlocks(47), -inBlocks(1));
new Spike(inBlocks(48), -inBlocks(1));

new Portal(inBlocks(55), -inBlocks(3), unit, inBlocks(3), "reverseGravity");

new Block(inBlocks(55), -inBlocks(6));
new Block(inBlocks(56), -inBlocks(6));
new Block(inBlocks(57), -inBlocks(6));

new Block(inBlocks(60), -inBlocks(7));

new Spike(inBlocks(62), -inBlocks(6), unit, unit, Math.PI);

new Block(inBlocks(64), -inBlocks(7));
new Block(inBlocks(65), -inBlocks(8));
new Block(inBlocks(66), -inBlocks(8));
new Block(inBlocks(67), -inBlocks(8));

new Portal(inBlocks(71), -inBlocks(6), unit, inBlocks(3), "normalGravity");

new Portal(inBlocks(77), -inBlocks(4), unit, inBlocks(3), "ship");

// Straightfly
for(let i = 0; i < 30; i++) {
    new Block(inBlocks(77 + i), -inBlocks(7));
    new Spike(inBlocks(77 + i), -inBlocks(6), unit, unit, Math.PI);

    new Spike(inBlocks(77 + i), -inBlocks(1), unit, unit, 0);
}

new Portal(inBlocks(108), -inBlocks(4), unit, inBlocks(3), "ufo");

// Roof
for(let i = 0; i < 50; i++) {
    new Block(inBlocks(108 + i), -inBlocks(10));
}

// Pillars with gaps
for(let i = 0; i < 9; i++) {
    if(i <= 4 && i >= 1) continue;
    new Block(inBlocks(120), -inBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 8 && i >= 5) continue;
    new Block(inBlocks(130), -inBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 5 && i >= 2) continue;
    new Block(inBlocks(140), -inBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 7 && i >= 4) continue;
    new Block(inBlocks(150), -inBlocks(1 + i));
}

for(let i = 0; i < 9; i++) {
    if(i <= 6 && i >= 3) continue;
    new Block(inBlocks(157), -inBlocks(1 + i));
}

new Portal(inBlocks(157), -inBlocks(6.5), unit, inBlocks(3), "cube");

new Portal(inBlocks(163), -inBlocks(3), unit, inBlocks(3), "ball");

// Roof
for(let i = 0; i < 50; i++) {
    new Block(inBlocks(165 + i), -inBlocks(8));
}

// Walls with gaps
for(let i = 0; i < 7; i++) {
    if(i > 5) continue;
    new Block(inBlocks(175), -inBlocks(1 + i));
}

for(let i = 0; i < 7; i++) {
    if(i < 1) continue;
    new Block(inBlocks(185), -inBlocks(1 + i));
}

fillBlocks(inBlocks(192), -inBlocks(4), inBlocks(199), -inBlocks(4));

new Spike(inBlocks(197), -inBlocks(3), unit, unit, Math.PI);
new Spike(inBlocks(198), -inBlocks(3), unit, unit, Math.PI);
new Spike(inBlocks(199), -inBlocks(3), unit, unit, Math.PI);
new Spike(inBlocks(197), -inBlocks(1));
new Spike(inBlocks(198), -inBlocks(1));
new Spike(inBlocks(199), -inBlocks(1));

new Spike(inBlocks(193), -inBlocks(5));
new Spike(inBlocks(196), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(199), -inBlocks(5));

new Portal(inBlocks(202), -inBlocks(6.5), unit, inBlocks(3), "wave");
new Portal(inBlocks(202), -inBlocks(6.5), unit, inBlocks(3), "normalGravity");

fillBlocks(inBlocks(202), -inBlocks(3), inBlocks(214), -inBlocks(3));

new Spike(inBlocks(204), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(205), -inBlocks(4));
new Spike(inBlocks(206), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(207), -inBlocks(4));
new Spike(inBlocks(208), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(209), -inBlocks(4));
new Spike(inBlocks(210), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(211), -inBlocks(4));
new Spike(inBlocks(212), -inBlocks(7), unit, unit, Math.PI);
new Spike(inBlocks(213), -inBlocks(4));
new Spike(inBlocks(214), -inBlocks(7), unit, unit, Math.PI);

// new Portal(inBlocks(215), -inBlocks(6), unit, inBlocks(3), "cube");


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

function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function evalQuery() {
    const url = new URL(window.location.href);
    const queryString = url.search; // Returns text after site.com/page
    const decodedString = decodeURIComponent(queryString.substring(1));
    eval(decodedString);
}

// Fixed step physics
let accumulator = 0;
let lastFrameTime = performance.now();
function gameLoop() {
    const now = performance.now();
    const frameTime = (now - lastFrameTime) / 1000; // seconds
    lastFrameTime = now;
    accumulator += frameTime * (gameSpeed * 60);

    const fixedDt = 1 / 60; // 60Hz physics
    while (accumulator >= fixedDt) {
        player.collide();
        player.update(fixedDt);
        simFrameCount++;
        accumulator -= fixedDt;
    }

    // Rendering
    clearCanvas();
    camera.follow(player);

    strokeWidth = objectStrokeWidth * camera.zoom; // Consistent look across zoom values

    ground.draw(camera);
    for (let spike of spikes) spike.draw(camera);
    for (let portal of portals) portal.draw(camera);
    for (let block of blocks) block.draw(camera);
    player.draw(camera);

    requestAnimationFrame(gameLoop);
}
gameLoop();
evalQuery();
