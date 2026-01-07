import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { updateWorld, breakBlock, placeBlock, BLOCK, MATERIALS } from "./main.js";

export const raycaster = new THREE.Raycaster();
export const mouse = new THREE.Vector2(0, 0); // always center of screen

export function raycastBlock() {
    raycaster.setFromCamera(mouse, camera);

    // Only raycast chunk meshes
    const hits = raycaster.intersectObjects(
        scene.children.filter(o => o.userData && o.userData.chunk),
        false
    );

    if (hits.length === 0) return null;

    const hit = hits[0];
    const n = hit.face.normal;

    const hx = Math.round(hit.point.x * 1000) / 1000;
    const hy = Math.round(hit.point.y * 1000) / 1000;
    const hz = Math.round(hit.point.z * 1000) / 1000;

    const bx = Math.floor(hx - n.x * 0.5);
    const by = Math.floor(hy - n.y * 0.5);
    const bz = Math.floor(hz - n.z * 0.5);

    const px = Math.floor(hx + n.x * 0.5);
    const py = Math.floor(hy + n.y * 0.5);
    const pz = Math.floor(hz + n.z * 0.5);

    return {
        break: { x: bx, y: by, z: bz },
        place: { x: px, y: py, z: pz },
        normal: n.clone()
    };
}


// -------------------------
// THREE.JS SETUP
// -------------------------
export const scene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 20, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
export const controls = new PointerLockControls(camera, renderer.domElement);

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const speed = 20;

let debug = false;

const keys = {};

document.addEventListener("keydown", (e) => {
    keys[e.code] = true;

    // Toggle Debug Mode
    if (e.code === "KeyK") { 
        debug = !debug;
        axesHelper.visible = debug;
        sunHelper.visible = debug;
        console.log("Debug Mode:", debug ? "ON" : "OFF");
    }
});
document.addEventListener("keyup",   e => keys[e.code] = false);

// Click to lock the mouse
renderer.domElement.addEventListener("click", () => {
    controls.lock();
});

export function updateControls(delta) {
    if (!controls.isLocked) return;

    direction.set(0, 0, 0);

    if (keys["KeyW"]) direction.z += 1;
    if (keys["KeyS"]) direction.z -= 1;
    if (keys["KeyA"]) direction.x -= 1;
    if (keys["KeyD"]) direction.x += 1;
    if (keys["Space"]) direction.y += 1;
    if (keys["ShiftLeft"]) direction.y -= 1;

    direction.normalize();
    velocity.copy(direction).multiplyScalar(speed * delta);

    controls.moveRight(velocity.x);
    controls.moveForward(velocity.z);
    camera.position.y += velocity.y;
}


// Lighting
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(20, 40, 20);
sun.castShadow = true;

// Define the shadow "box" (Left, Right, Top, Bottom, Near, Far)
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 500;

// Improve shadow quality (default is 512)
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;

scene.add(sun);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.FogExp2(0xffffff, 0.01);

const axesHelper = new THREE.AxesHelper(0.1);
scene.add(axesHelper);
axesHelper.visible = debug;
const sunHelper = new THREE.DirectionalLightHelper(sun, 10);
scene.add(sunHelper);
sunHelper.visible = debug;

// -------------------------
// CHUNK RENDERING
// -------------------------

// Simple cube material for testing
const testMat = new THREE.MeshStandardMaterial({ color: 0x88cc88 });

// Pre-calculate rotations/offsets for faces to avoid creating objects in loops
const FACES = [
    { dir: [ 0,  1,  0], pos: [0, 0.5, 0], rot: [-Math.PI/2, 0, 0] }, // Top
    { dir: [ 0, -1,  0], pos: [0, -0.5, 0], rot: [Math.PI/2, 0, 0] },  // Bottom
    { dir: [ 0,  0,  1], pos: [0, 0, 0.5], rot: [0, 0, 0] },           // Front
    { dir: [ 0,  0, -1], pos: [0, 0, -0.5], rot: [0, Math.PI, 0] },    // Back
    { dir: [-1,  0,  0], pos: [-0.5, 0, 0], rot: [0, -Math.PI/2, 0] }, // Left
    { dir: [ 1,  0,  0], pos: [0.5, 0, 0], rot: [0, Math.PI/2, 0] },   // Right
];

// This is called by main.js when a chunk is created or updated
export function renderChunk(chunk, cx, cy, cz) {
    if (chunk.meshes) {
        chunk.meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); });
    }
    chunk.meshes = [];

    const size = chunk.size;
    const id = chunk.id;
    const getVoxel = (x, y, z) => (x < 0 || x >= size || y < 0 || y >= size || z < 0 || z >= size) ? 0 : id[x + y * size + z * size * size];

    const vertexDataByType = { 1: [], 2: [], 3: [], 4: [] };

    // Sweep across each of the 3 axes (0=X, 1=Y, 2=Z)
    for (let d = 0; d < 3; d++) {
        let u = (d + 1) % 3;
        let v = (d + 2) % 3;
        let x = [0, 0, 0];
        let q = [0, 0, 0];
        q[d] = 1;

        const mask = new Array(size * size).fill(0);

        // Iterate through each slice along axis d
        for (x[d] = -1; x[d] < size; ) {
            let n = 0;
            // Build mask for the current slice interface
            for (x[v] = 0; x[v] < size; x[v]++) {
                for (x[u] = 0; x[u] < size; x[u]++) {
                    const a = getVoxel(x[0], x[1], x[2]);
                    const b = getVoxel(x[0] + q[0], x[1] + q[1], x[2] + q[2]);

                    // Determine if we need a face and which way it points
                    // Positive value = face points +d, Negative = face points -d
                    if (a !== 0 && b !== 0) mask[n++] = 0;
                    else if (a !== 0) mask[n++] = a;
                    else if (b !== 0) mask[n++] = -b;
                    else mask[n++] = 0;
                }
            }

            x[d]++;
            n = 0;

            // Greedy mesh the generated mask
            for (let j = 0; j < size; j++) {
                for (let i = 0; i < size; ) {
                    const type = mask[n];
                    if (type === 0) { i++; n++; continue; }

                    let w, h;
                    for (w = 1; i + w < size && mask[n + w] === type; w++);
                    
                    outer: for (h = 1; j + h < size; h++) {
                        for (let k = 0; k < w; k++) {
                            if (mask[n + k + h * size] !== type) break outer;
                        }
                    }

                    // Define vertex positions
                    x[u] = i; x[v] = j;
                    let du = [0, 0, 0]; du[u] = w;
                    let dv = [0, 0, 0]; dv[v] = h;

                    const worldX = cx * size + x[0];
                    const worldY = cy * size + x[1];
                    const worldZ = cz * size + x[2];

                    const v1 = [worldX, worldY, worldZ];
                    const v2 = [worldX + du[0], worldY + du[1], worldZ + du[2]];
                    const v3 = [worldX + du[0] + dv[0], worldY + du[1] + dv[1], worldZ + du[2] + dv[2]];
                    const v4 = [worldX + dv[0], worldY + dv[1], worldZ + dv[2]];

                    // Use absolute type for material; direction determines winding
                    const matType = Math.abs(type);

                    if (type > 0) {
                        // Face pointing +d → CCW winding
                        vertexDataByType[matType].push(
                            ...v1, ...v2, ...v4,
                            ...v4, ...v2, ...v3
                        );
                    } else {
                        // Face pointing -d → CCW winding (reverse quad)
                        vertexDataByType[matType].push(
                            ...v1, ...v4, ...v2,
                            ...v2, ...v4, ...v3
                        );
                    }


                    // Zero out processed mask area
                    for (let l = 0; l < h; l++) {
                        for (let k = 0; k < w; k++) mask[n + k + l * size] = 0;
                    }
                    i += w; n += w;
                }
            }
        }
    }

    // Build Meshes
    for (const type in vertexDataByType) {
        const verts = vertexDataByType[type];
        if (verts.length === 0) continue;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, MATERIALS[type]);
        mesh.raycast = THREE.Mesh.prototype.raycast;
        mesh.userData = { chunk };

        scene.add(mesh);
        chunk.meshes.push(mesh);
    }
}

window.addEventListener('resize', () => {
    // Update camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    // Update the camera's projection matrix
    camera.updateProjectionMatrix();
    // Update renderer size
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Handle High DPI devices (Retina displays)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

window.addEventListener("mousedown", (e) => {
    if (!controls.isLocked) return;

    if (e.button === 0) {
        // left click to break
        const hit = raycastBlock();
        if (hit) {
            breakBlock(hit.break.x, hit.break.y, hit.break.z);
        }
    }

    if (e.button === 2) {
        // right click to place
        const hit = raycastBlock();
        if (hit) {
            const px = hit.x + hit.normal.x;
            const py = hit.y + hit.normal.y;
            const pz = hit.z + hit.normal.z;
            placeBlock(hit.place.x, hit.place.y, hit.place.z);
        }
    }
});

window.addEventListener("contextmenu", e => e.preventDefault());

// -------------------------
// ANIMATION LOOP
// -------------------------
const clock = new THREE.Clock();
let worldTimer = 0;

export function startRenderLoop() {
    function animate() {
        requestAnimationFrame(animate);

        const delta = clock.getDelta();
        updateControls(delta);

        camera.updateMatrixWorld();
        
        sun.position.set(
            camera.position.x + 20,
            camera.position.y + 40,
            camera.position.z + 20
        );
        sun.target.position.set(camera.position.x, camera.position.y, camera.position.z);
        sun.target.updateMatrixWorld();
        
        if (debug) {
            sunHelper.update();

            const offset = new THREE.Vector3(0, 0, -1); 
            
            // Convert that local offset into world coordinates based on camera position/rotation
            const helperPos = offset.applyMatrix4(camera.matrixWorld);

            axesHelper.position.copy(helperPos);
        }

        worldTimer += delta;
        if (worldTimer > 1/20) { // 20hz
            updateWorld();
            worldTimer = 0;
        }

        renderer.render(scene, camera);
    }
    animate();
}
