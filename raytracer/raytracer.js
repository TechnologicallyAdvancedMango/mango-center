const canvas = document.getElementById("canvas");
const ctx = canvas.getContext('2d');

// Match internal resolution to CSS size
canvas.width  = Math.floor(canvas.clientWidth / 4);
canvas.height = Math.floor(canvas.clientHeight / 4);

const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
const buf = img.data;

class Vec3 {
    constructor(x=0, y=0, z=0) { this.x=x; this.y=y; this.z=z; }
    add(v) { return new Vec3(this.x+v.x, this.y+v.y, this.z+v.z); }
    sub(v) { return new Vec3(this.x-v.x, this.y-v.y, this.z-v.z); }
    mul(k) { return new Vec3(this.x*k, this.y*k, this.z*k); }
    dot(v) { return this.x*v.x + this.y*v.y + this.z*v.z; }
    cross(v) {
        return new Vec3(
        this.y*v.z - this.z*v.y,
        this.z*v.x - this.x*v.z,
        this.x*v.y - this.y*v.x
        );
    }
    length() { return Math.hypot(this.x,this.y,this.z); }
    norm() { const L=this.length(); return L>0? this.mul(1/L):new Vec3(); }
}

class Ray {
    constructor(origin, direction) {
        this.origin = origin;
        this.direction = direction.norm();
    }
    at(t) { return this.origin.add(this.direction.mul(t)); }
}

class Sphere {
    constructor(center, radius, color, emissive={r:0,g:0,b:0}, emissionStrength=1) {
        this.center = center;
        this.radius = radius;
        this.color = color;
        this.emissive = emissive;
        this.emissionStrength = emissionStrength;
    }

    intersect(ray) {
        const oc = ray.origin.sub(this.center);
        const a = ray.direction.dot(ray.direction);
        const b = 2 * oc.dot(ray.direction);
        const c = oc.dot(oc) - this.radius*this.radius;
        const disc = b*b - 4*a*c;
        if (disc < 0) return null;
        const t = (-b - Math.sqrt(disc)) / (2*a);
        if (t < 0) return null;
        const point = ray.at(t);
        const normal = point.sub(this.center).norm();

        return {
            t, point, normal,
            color: this.color,
            emissive: this.emissive,
            emissionStrength: this.emissionStrength
        };
    }
}


class Triangle {
    constructor(v0, v1, v2, color, emissive={r:0,g:0,b:0}) {
        this.v0 = v0;
        this.v1 = v1;
        this.v2 = v2;
        this.color = color;
        this.emissive = emissive;
    }

    intersect(ray) {
        const EPS = 1e-6;
        const edge1 = this.v1.sub(this.v0);
        const edge2 = this.v2.sub(this.v0);

        const h = ray.direction.cross(edge2);
        const a = edge1.dot(h);
        if (Math.abs(a) < EPS) return null;

        const f = 1 / a;
        const s = ray.origin.sub(this.v0);
        const u = f * s.dot(h);
        if (u < 0 || u > 1) return null;

        const q = s.cross(edge1);
        const v = f * ray.direction.dot(q);
        if (v < 0 || u + v > 1) return null;

        const t = f * edge2.dot(q);
        if (t > EPS) {
            const point = ray.at(t);
            const normal = edge1.cross(edge2).norm();
            return { t, point, normal, color: this.color, emissive: this.emissive };
        }
        return null;
    }
}

class Camera {
    constructor(position, yaw=0, pitch=0, roll=0, fov=Math.PI/3, aspect=1) {
        this.position = position; // Vec3
        this.yaw = yaw; // rotation around Y axis
        this.pitch = pitch; // rotation around X axis
        this.roll = roll; // rotation around Z axis
        this.fov = fov;
        this.aspect = aspect;
        this.updateBasis();
    }

    updateBasis() {
        // Forward vector from yaw/pitch
        const fx = Math.cos(this.pitch) * Math.cos(this.yaw);
        const fy = Math.sin(this.pitch); // pitch up/down
        const fz = Math.cos(this.pitch) * Math.sin(this.yaw);
        this.forward = new Vec3(fx, fy, fz).norm();

        // Right vector (perpendicular to forward and world up)
        const worldUp = new Vec3(0,1,0);
        this.right = this.forward.cross(worldUp).norm();

        // Recompute up vector
        this.up = this.right.cross(this.forward).norm();
    }

    getRay(x, y, width, height) {
        const u = (2*(x+0.5)/width - 1) * Math.tan(this.fov/2) * this.aspect;
        const v = (1 - 2*(y+0.5)/height) * Math.tan(this.fov/2);

        const dir = this.forward
            .add(this.right.mul(u))
            .add(this.up.mul(v))
            .norm();

        return new Ray(this.position, dir);
    }
}


class Scene {
        constructor() {
        this.objects = [];
        }
    add(obj) { this.objects.push(obj); }
    trace(ray) {
        let closest = null;
        for (const obj of this.objects) {
        const hit = obj.intersect(ray);
        if (hit && (!closest || hit.t < closest.t)) closest = hit;
        }
        return closest;
    }
}

const camera = new Camera(
    new Vec3(0, 0, 0), // position
    0, // yaw (30°)
    0, // pitch
    0, // roll
    Math.PI/3, // FOV
    canvas.width/canvas.height
);

function randomHemisphere(normal) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2*v - 1);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    const dir = new Vec3(x,y,z);
    return dir.dot(normal) > 0 ? dir : dir.mul(-1);
}

function trace(ray, scene, depth=3) {
    const hit = scene.trace(ray);
    if (!hit) return {r:0,g:0,b:0}; // black background

    // Emissive surfaces glow directly
    if (hit.emissive.r || hit.emissive.g || hit.emissive.b) {
        return {
            r: hit.emissive.r * hit.emissionStrength,
            g: hit.emissive.g * hit.emissionStrength,
            b: hit.emissive.b * hit.emissionStrength
        };
    }


    // Stop if max depth reached
    if (depth <= 0) return {r:0,g:0,b:0};

    // Diffuse bounce: pick random direction in hemisphere
    const bounceDir = randomHemisphere(hit.normal);
    const bounceRay = new Ray(hit.point.add(hit.normal.mul(1e-4)), bounceDir);

    // Recursive call
    const bouncedColor = trace(bounceRay, scene, depth-1);

    // Attenuate by surface color
    return {
        r: hit.color.r/255 * bouncedColor.r,
        g: hit.color.g/255 * bouncedColor.g,
        b: hit.color.b/255 * bouncedColor.b
    };
}

const scene = new Scene();

scene.add(new Sphere(new Vec3(5, -1001, 0), 1000, {r:255, g:255, b:255})); // ground sphere
scene.add(new Sphere(new Vec3(-20, 25, -20), 20, {r:255, g:255, b:255}, {r:255, g:255, b:255}, 1.5)); // sun sphere

scene.add(new Sphere(new Vec3(5, 0, 0), 1, {r:255, g:255, b:255}));

scene.add(new Sphere(new Vec3(5, 0, -3), 1, {r:255, g:0, b:255}, {r:255, g:0, b:255}, 2)); // Emmisive
scene.add(new Sphere(new Vec3(5, 0, 3), 1, {r:255, g:255, b:0}, {r:255, g:255, b:0}, 2)); // Emmisive
scene.add(new Sphere(new Vec3(5, 2, 1), 1, {r:0, g:255, b:255}, {r:0, g:255, b:255}, 2)); // Emmisive
scene.add(new Sphere(new Vec3(3, 0, 5), 0.5, {r:255, g:255, b:255}));
scene.add(new Sphere(new Vec3(0, 0, 6), 1, {r:255, g:0, b:0}, {r:255, g:0, b:0}, 2)); // Emmisive
scene.add(new Sphere(new Vec3(2, 0, 8), 1, {r:0, g:0, b:255}, {r:0, g:0, b:255}, 2)); // Emmisive

scene.add(new Sphere(new Vec3(-10, 2, 3), 3, {r:255, g:255, b:255}));

// Define triangle vertices
const v0 = new Vec3(2, 0, -5);
const v1 = new Vec3(0, 2, -5);
const v2 = new Vec3(-2, 0, -5);

// Add a triangle to the scene
scene.add(new Triangle(v0, v1, v2, {r:255, g:0, b:0}));


const keys = {};
document.addEventListener("keydown", e => keys[e.code] = true);
document.addEventListener("keyup",   e => keys[e.code] = false);

function updateCameraMovement() {
    const speed = 0.1; // movement speed per frame

    if (keys["KeyW"] || keys["KeyS"] || keys["KeyA"] || keys["KeyD"] || keys["Space"] || keys["ShiftLeft"]) {
        resetAccumulation();
    }

    // forward/back
    if (keys["KeyW"]) {
        camera.position = camera.position.add(camera.forward.mul(speed));
    }
    if (keys["KeyS"]) {
        camera.position = camera.position.sub(camera.forward.mul(speed));
    }

    // strafe left/right
    if (keys["KeyA"]) {
        camera.position = camera.position.sub(camera.right.mul(speed));
    }
    if (keys["KeyD"]) {
        camera.position = camera.position.add(camera.right.mul(speed));
    }

    // up/down with space/shift
    if (keys["Space"]) {
        camera.position = camera.position.add(camera.up.mul(speed));
    }
    if (keys["ShiftLeft"]) {
        camera.position = camera.position.sub(camera.up.mul(speed));
    }
}


canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
        document.addEventListener("mousemove", onMouseMove);
    } else {
        document.removeEventListener("mousemove", onMouseMove);
    }
});

function onMouseMove(e) {
    camera.yaw += e.movementX * 0.002;
    camera.pitch -= e.movementY * 0.002;
    camera.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.pitch));
    camera.updateBasis();
    resetAccumulation();
}

function boxBlur(width, height, radius=1) {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sdata = src.data;
    const ddata = dst.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0, count = 0;

            // average over neighbors in a (2*radius+1) box
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const i = (ny * width + nx) * 4;
                        r += sdata[i];
                        g += sdata[i+1];
                        b += sdata[i+2];
                        a += sdata[i+3];
                        count++;
                    }
                }
            }

            const j = (y * width + x) * 4;
            ddata[j]   = r / count;
            ddata[j+1] = g / count;
            ddata[j+2] = b / count;
            ddata[j+3] = a / count;
        }
    }

    ctx.putImageData(dst, 0, 0);
}


// Global accumulation buffers
const accum = new Float32Array(canvas.width * canvas.height * 3);
let sampleCount = 0;

function resetAccumulation() {
    accum.fill(0);
    sampleCount = 0;
}

let frameCounter = 0;

function renderFrame() {
    updateCameraMovement();
    sampleCount++;

    const samplesPerPixel = 1;
    const maxRayBounces = 5;

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 3;
            for (let s = 0; s < samplesPerPixel; s++) {
                const jitterX = Math.random() * 0.5;
                const jitterY = Math.random() * 0.5;
                const ray = camera.getRay(x + jitterX, y + jitterY, canvas.width, canvas.height);
                const col = trace(ray, scene, maxRayBounces);
                accum[i]   += col.r;
                accum[i+1] += col.g;
                accum[i+2] += col.b;
            }
        }
    }

    // Write averaged result to canvas
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i3 = (y * canvas.width + x) * 3;
            const i4 = (y * canvas.width + x) * 4;

            buf[i4]   = Math.min(255, accum[i3]   / (sampleCount * samplesPerPixel));
            buf[i4+1] = Math.min(255, accum[i3+1] / (sampleCount * samplesPerPixel));
            buf[i4+2] = Math.min(255, accum[i3+2] / (sampleCount * samplesPerPixel));
            buf[i4+3] = 255;
        }
    }

    ctx.putImageData(img, 0, 0);
    // boxBlur(canvas.width, canvas.height, 1);

    frameCounter++;
    requestAnimationFrame(renderFrame);
}
renderFrame();