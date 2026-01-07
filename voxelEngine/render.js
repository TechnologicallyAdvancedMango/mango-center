import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

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
sun.castShadow = true;
scene.add(sun);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.FogExp2(0xffffff, 0.01);

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
    // Clean up existing mesh/geometry if it exists
    if (chunk.mesh) {
        scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
    }
    const size = 16;
    const geometries = [];
    const faceGeo = new THREE.PlaneGeometry(1, 1);

    // Helper to check if a block exists at local coordinates
    const getBlock = (x, y, z) => {
        if (x < 0 || x >= size || y < 0 || y >= size || z < 0 || z >= size) {
            return 0; // For now, treat out-of-bounds as empty (or check neighboring chunks)
        }
        return chunk.id[x + y * size + z * size * size];
    };

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            for (let z = 0; z < size; z++) {
                const blockId = getBlock(x, y, z);
                if (blockId === 0) continue;

                // Check all 6 neighbors
                for (const face of FACES) {
                    const nx = x + face.dir[0];
                    const ny = y + face.dir[1];
                    const nz = z + face.dir[2];

                    // If neighbor is transparent/empty, render this face
                    if (getBlock(nx, ny, nz) === 0) {
                        const clonedFace = faceGeo.clone();
                        
                        // Rotate face to point in correct direction
                        clonedFace.rotateX(face.rot[0]);
                        clonedFace.rotateY(face.rot[1]);
                        clonedFace.rotateZ(face.rot[2]);

                        // Move face to block position + half-unit offset
                        clonedFace.translate(
                            cx * size + x + face.pos[0],
                            cy * size + y + face.pos[1],
                            cz * size + z + face.pos[2]
                        );

                        geometries.push(clonedFace);
                    }
                }
            }
        }
    }

    faceGeo.dispose();

    if (geometries.length > 0) {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
        const chunkMesh = new THREE.Mesh(mergedGeometry, testMat);
        chunkMesh.castShadow = true;
        chunkMesh.receiveShadow = true;
        
        geometries.forEach(g => g.dispose());
        chunk.mesh = chunkMesh;
        scene.add(chunkMesh);
    }
}

const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

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
