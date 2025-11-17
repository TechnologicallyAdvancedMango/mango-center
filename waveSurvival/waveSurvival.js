const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});



class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.accel = 0.1;
        this.drag = 0.95;

        this.radius = 15;
        this.health = 100;
        this.alive = true;

        this.gun = {
            damage: 10,
            projectileSpeed: 1,
            cooldownTime: 400,
            onCooldown: false
        }
        this.projectiles = [];
        this.angle = 0;

        this.xp = 0;
        this.level = 1;
        this.xpToNext = 50;
    }

    applyInput(input) {
        if (input.up) this.vy -= this.accel;
        if (input.down) this.vy += this.accel;
        if (input.left) this.vx -= this.accel;
        if (input.right) this.vx += this.accel;
    }

    shoot() {
        if(this.gun.onCooldown) return;

        let startX = this.x + Math.cos(this.angle) * this.radius;
        let startY = this.y + Math.sin(this.angle) * this.radius;
        this.projectiles.push(new Projectile(startX, startY, {
            dx: Math.cos(this.angle) * this.gun.projectileSpeed,
            dy: Math.sin(this.angle) * this.gun.projectileSpeed
        }, this.gun.damage
        ));

        this.gun.onCooldown = true;
        setTimeout(() => {this.gun.onCooldown = false}, this.gun.cooldownTime);
    }

    update() {
        this.vx *= this.drag;
        this.vy *= this.drag;
        this.x += this.vx;
        this.y += this.vy;

        this.projectiles = this.projectiles.filter(p => !p.dead);
        this.projectiles.forEach(p => p.update());
    }

    die() {
        this.alive = false;
        console.log("Died!");
    }

    draw(camera) {
        let canvasX = this.x - camera.offsetX;
        let canvasY = this.y - camera.offsetY;

        ctx.fillStyle = "blue";
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, this.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(canvasX, canvasY);
        ctx.rotate(this.angle);
        ctx.fillStyle = "gray";
        ctx.fillRect(this.radius, -4, 20, 8);
        ctx.restore();

        this.projectiles.forEach(p => p.draw(camera));

        ctx.font = '30px Arial';
        ctx.fillStyle = "white";
        ctx.fillText(`HP: ${Math.floor(this.health)}`, 20, canvas.height - 40);
        ctx.fillText(`XP: ${this.xp}/${this.xpToNext}`, 20, 40);
        ctx.fillText(`Level: ${this.level}`, 20, 70);
    }
}

class Projectile {
    constructor(x, y, direction, damage) {
        this.x = x;
        this.y = y;
        this.speed = 6;
        this.direction = direction;
        this.damage = damage;
        this.dead = false;
    }

    update() {
        this.x += this.direction.dx * this.speed;
        this.y += this.direction.dy * this.speed;
    }

    draw(camera) {
        let canvasX = this.x - camera.offsetX;
        let canvasY = this.y - camera.offsetY;
        ctx.fillStyle = "yellow";
        ctx.fillRect(canvasX, canvasY, 5, 5);
    }
}

class Enemy {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;

        this.speed = 0.8;
        this.drag = 0.97;

        this.radius = 15;
        this.health = 50;

        this.damage = 10;
        this.damageCooldown = 1000;
        this.damageOnCooldown = false;
        this.alive = true;
    }

    update(player, enemies) {
        if (!this.alive) return;

        // Movement toward player
        let dx = player.x - this.x;
        let dy = player.y - this.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        this.vx += (dx / dist) * 0.05 * this.speed;
        this.vy += (dy / dist) * 0.05 * this.speed;

        this.vx *= this.drag;
        this.vy *= this.drag;

        this.x += this.vx;
        this.y += this.vy;

        // Projectile collisions
        player.projectiles.forEach(p => {
            if (this.checkProjectileCollision(p)) {
                this.resolveProjectileCollision(player, p);
            }
        });

        // Player collision
        if (this.checkPlayerCollision(player)) {
            this.resolvePlayerCollision(player);
        }

        // Enemy vs Enemy collisions
        enemies.forEach(other => {
            if (other !== this && this.checkEnemyCollision(other)) {
                this.resolveEnemyCollision(other);
            }
        });
    }

    checkPlayerCollision(player) {
        let dx = player.x - this.x;
        let dy = player.y - this.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        return dist < this.radius + player.radius;
    }
    resolvePlayerCollision(player) {
        // subtract health and set cooldown
        if(!this.damageOnCooldown) {
            player.health -= this.damage;

            this.damageOnCooldown = true;
            setTimeout(() => {this.damageOnCooldown = false}, this.damageCooldown);
        }

        // push enemy and player apart
        let dx = player.x - this.x;
        let dy = player.y - this.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist === 0) return; // avoid divide by zero

        let overlap = (this.radius + player.radius - dist) / 2;
        if (overlap > 0) {
            let nx = dx / dist;
            let ny = dy / dist;

            this.x -= nx * overlap;
            this.y -= ny * overlap;
            player.x += nx * overlap;
            player.y += ny * overlap;

            // optional: adjust velocities so they don't slide back together
            this.vx -= nx * overlap * 0.1;
            this.vy -= ny * overlap * 0.1;
            player.vx += nx * overlap * 0.1;
            player.vy += ny * overlap * 0.1;
        }
    }


    checkEnemyCollision(other) {
        let dx = other.x - this.x;
        let dy = other.y - this.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        return dist < this.radius + other.radius;
    }
    resolveEnemyCollision(other) {
        let dx = other.x - this.x;
        let dy = other.y - this.y;
        let dist = Math.sqrt(dx*dx + dy*dy);

        if (dist === 0) return; // avoid divide by zero

        let overlap = (this.radius + other.radius - dist);
        if (overlap > 0) {
            let nx = dx / dist;
            let ny = dy / dist;

            // push both enemies fully apart
            this.x -= nx * overlap / 2;
            this.y -= ny * overlap / 2;
            other.x += nx * overlap / 2;
            other.y += ny * overlap / 2;

            // adjust velocity so they don't slide back together
            this.vx -= nx * 0.1;
            this.vy -= ny * 0.1;
            other.vx += nx * 0.1;
            other.vy += ny * 0.1;
        }
    }


    checkProjectileCollision(p) {
        let dx = p.x - this.x;
        let dy = p.y - this.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        return dist < this.radius + 3;
    }
    resolveProjectileCollision(player, p) {
        this.takeDamage(p.damage, player);
        p.dead = true;
    }

    takeDamage(amount, player) {
        this.health -= amount;
        if (this.health <= 0 && this.alive) {
            this.alive = false;
            player.xp += 20;
            if (player.xp >= player.xpToNext) {
                player.level++;
                player.xp = 0;
                player.xpToNext *= 1.2;
                console.log("Level up!");
            }
        }
    }

    draw(camera) {
        if (!this.alive) return;
        let canvasX = this.x - camera.offsetX;
        let canvasY = this.y - camera.offsetY;

        ctx.fillStyle = "green";
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Camera {
    constructor() {
        this.offsetX = 0;
        this.offsetY = 0;
    }

    follow(target) {
        this.offsetX = target.x - canvas.width / 2;
        this.offsetY = target.y - canvas.height / 2;
    }

    drawBackground() {
        const tileSize = 100;
        const cols = Math.ceil(canvas.width / tileSize) + 2;
        const rows = Math.ceil(canvas.height / tileSize) + 2;

        // offset for smooth scrolling
        const offsetX = -camera.offsetX % tileSize;
        const offsetY = -camera.offsetY % tileSize;

        const startCol = -1;
        const startRow = -1;

        for (let row = startRow; row < rows; row++) {
            for (let col = startCol; col < cols; col++) {
                const x = col * tileSize + offsetX;
                const y = row * tileSize + offsetY;

                // world tile indices: absolute grid position
                const worldCol = Math.floor(camera.offsetX / tileSize) + col;
                const worldRow = Math.floor(camera.offsetY / tileSize) + row;

                // parity based only on world indices
                const isDark = (worldCol + worldRow) % 2 === 0;

                ctx.fillStyle = isDark ? "#222" : "#333";
                ctx.fillRect(x, y, tileSize, tileSize);
            }
        }
    }
}

function drawDeathScreen() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#FF3333";
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("YOU DIED", canvas.width / 2, canvas.height / 2);

    ctx.fillStyle = "#ffff00ff";
    ctx.font = "24px sans-serif";
    ctx.fillText("Level: " + player.level, canvas.width / 2, canvas.height / 2 + 60);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "24px sans-serif";
    ctx.fillText("Press R to Restart", canvas.width / 2, canvas.height / 2 + 100);
}

let player = new Player(100, 100);
let enemies = [];
let camera = new Camera();

let input = {
    up: false,
    down: false,
    left: false,
    right: false
};

document.addEventListener("keydown", e => {
    if (e.key === "w") input.up = true;
    if (e.key === "s") input.down = true;
    if (e.key === "a") input.left = true;
    if (e.key === "d") input.right = true;
    if (e.key === " ") player.shoot();
});

document.addEventListener("keyup", e => {
    if (e.key === "w") input.up = false;
    if (e.key === "s") input.down = false;
    if (e.key === "a") input.left = false;
    if (e.key === "d") input.right = false;
});

canvas.addEventListener("mousemove", e => {
    let dx = (e.offsetX + camera.offsetX) - player.x;
    let dy = (e.offsetY + camera.offsetY) - player.y;
    player.angle = Math.atan2(dy, dx);
});

canvas.addEventListener("mousedown", e => {
    if(e.button === 0) {
        player.shoot();
    }
});


let enemySpawnInterval = 5000;
function enemySpawnLoop() {
    // Spawn random enemy
    enemies.push(new Enemy((Math.random() * canvas.width) + camera.offsetX, (Math.random() * canvas.height) + camera.offsetY));
    
    setTimeout(enemySpawnLoop, enemySpawnInterval);
    enemySpawnInterval *= 0.95;
    enemySpawnInterval = Math.max(enemySpawnInterval, 100000000) // Clamp to one per second
}

function gameLoop() {
    if(player.alive) {
        // only if alive

        player.applyInput(input);
        player.update();
        if(player.health <= 0) player.die();

        enemies.forEach(e => e.update(player, enemies));

        camera.follow(player);

        // Rendering
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        camera.drawBackground();

        player.projectiles.forEach(e => e.draw(camera));
        player.draw(camera);
        enemies.forEach(e => e.draw(camera));
    } else {
        drawDeathScreen();
    }

    requestAnimationFrame(gameLoop);
}

enemySpawnLoop();
gameLoop();