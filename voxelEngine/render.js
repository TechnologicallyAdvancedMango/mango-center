import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

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
camera.position.set(20, 20, 20);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
export const controls = new PointerLockControls(camera, renderer.domElement);

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const speed = 20;

const keys = {};

document.addEventListener("keydown", e => keys[e.code] = true);
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
scene.add(sun);

scene.add(new THREE.AmbientLight(0xffffff, 0.3));

// -------------------------
// CHUNK RENDERING
// -------------------------

// Simple cube material for testing
const testMat = new THREE.MeshStandardMaterial({ color: 0x88cc88 });

// This is called by main.js when a chunk is created or updated
export function renderChunk(chunk, cx, cy, cz) {
    const group = new THREE.Group();

    const size = 16; // chunk size
    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            for (let z = 0; z < size; z++) {
                const i = x + y * size + z * size * size;

                if (chunk.id[i] !== 0) {
                    const cube = new THREE.Mesh(cubeGeo, testMat);
                    cube.position.set(
                        cx * size + x,
                        cy * size + y,
                        cz * size + z
                    );
                    group.add(cube);
                }
            }
        }
    }

    // Save the mesh so main.js can remove/update it later
    chunk.mesh = group;
    scene.add(group);
}

const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

// -------------------------
// ANIMATION LOOP
// -------------------------
const clock = new THREE.Clock();

export function startRenderLoop() {
    function animate() {
        requestAnimationFrame(animate);

        const delta = clock.getDelta();
        updateControls(delta);

        renderer.render(scene, camera);
    }
    animate();
}
