import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from "three/addons/objects/Sky.js";
import { updateWorld, breakBlock, placeBlock, pickBlock, BLOCKS, getVoxelGlobal, selectedBlock, isChunkLoaded } from "./main.js";

// -------------------------
// TEXTURES / MATERIALS
// -------------------------

const loader = new THREE.TextureLoader();

function makeTexture(fileName) {
    const tex = loader.load(`textures/${fileName}`);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// Keys match the strings used in BLOCKS in main.js
const TEXTURES = {
    "dirt.png": makeTexture("dirt.png"),
    "grass_block_side.png": makeTexture("grass_block_side.png"),
    "grass_block_top.png": makeTexture("grass_block_top.png"),
    "sand.png": makeTexture("sand.png"),
    "stone.png": makeTexture("stone.png"),
    "glowstone.png": makeTexture("glowstone.png")
};

export const MATERIALS = {};
for (const name in TEXTURES) {
    MATERIALS[name] = new THREE.MeshStandardMaterial({
        map: TEXTURES[name]
    });
}

// -------------------------
// RAYCASTING
// -------------------------

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
    
        if (debug) {
            // Add borders for all currently loaded chunks
            for (const obj of scene.children) {
                if (obj.userData && obj.userData.chunk) {
                    const chunk = obj.userData.chunk;
                    addChunkBorder(chunk.cx, chunk.cy, chunk.cz, chunk.size);
                }
            }
        } else {
            // Hide all borders
            chunkBorders.forEach(b => b.visible = false);
        }
    
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

// Define the shadow "box"
sun.shadow.camera.left = -100;
sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 500;

// Improve shadow quality
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

// Chunk border wireframe (16×16×16)
const chunkBorderGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(16, 16, 16)
);
const chunkBorderMat = new THREE.LineBasicMaterial({ color: 0xffaa00 });
export const chunkBorders = []; // store all border meshes

export function removeChunkBordersFor(cx, cy, cz) {
    for (let i = chunkBorders.length - 1; i >= 0; i--) {
        const b = chunkBorders[i];
        const u = b.userData;
        if (!u || !u.chunkBorder) continue;

        if (u.cx === cx && u.cy === cy && u.cz === cz) {
            scene.remove(b);
            chunkBorders.splice(i, 1);
        }
    }
}

export function addChunkBorder(cx, cy, cz, size) {
    const border = new THREE.LineSegments(chunkBorderGeo, chunkBorderMat);
    border.position.set(
        cx * size + size / 2,
        cy * size + size / 2,
        cz * size + size / 2
    );

    border.userData = { chunkBorder: true, cx, cy, cz };
    scene.add(border);
    chunkBorders.push(border);
}


export const highlightBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)),
    new THREE.LineBasicMaterial({ color: 0xd0d0d0 })
);

highlightBox.visible = false;
scene.add(highlightBox);

// Procedural gradient sky
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

// Sky uniforms
const uniforms = sky.material.uniforms;

// Controls how blue the top is
uniforms.rayleigh.value = 0.5;

// Controls how white the horizon is
uniforms.turbidity.value = 2;

// Sun position controls gradient direction
uniforms.sunPosition.value.set(1, 2, 1);

camera.position.x = 0;
camera.position.y = 100;
camera.position.z = 0;


// -------------------------
// CHUNK RENDERING
// -------------------------

// This is called by main.js when a chunk is created or updated
export function renderChunk(chunk, cx, cy, cz) {
    if (chunk.meshes) {
        chunk.meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); });
    }
    chunk.meshes = [];

    const size = chunk.size;
    const id = chunk.id;

    const getVoxel = (x, y, z) => {
        const worldX = cx * size + x;
        const worldY = cy * size + y;
        const worldZ = cz * size + z;
        return getVoxelGlobal(worldX, worldY, worldZ);
    };    

    // Group by texture name instead of block type
    const vertexDataByTexture = {};
    const uvDataByTexture = {};

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
                    const aLocalX = x[0];
                    const aLocalY = x[1];
                    const aLocalZ = x[2];

                    const bLocalX = x[0] + q[0];
                    const bLocalY = x[1] + q[1];
                    const bLocalZ = x[2] + q[2];

                    // world coords for neighbor sampling
                    const aWorldX = cx * size + aLocalX;
                    const aWorldY = cy * size + aLocalY;
                    const aWorldZ = cz * size + aLocalZ;

                    const bWorldX = cx * size + bLocalX;
                    const bWorldY = cy * size + bLocalY;
                    const bWorldZ = cz * size + bLocalZ;

                    // compute chunk coords for the neighbor voxel b
                    const bChunkX = Math.floor(bWorldX / size);
                    const bChunkY = Math.floor(bWorldY / size);
                    const bChunkZ = Math.floor(bWorldZ / size);

                    // If neighbor chunk is not loaded, skip emitting a face here (treat as "unknown")
                    // This prevents border quads until neighbor chunk is present.
                    if (!isChunkLoaded(bChunkX, bChunkY, bChunkZ)) {
                        // treat as no face for now
                        mask[n++] = 0;
                    } else {
                        // safe to sample both voxels via getVoxel (which uses world coords)
                        const a = getVoxel(aLocalX, aLocalY, aLocalZ);
                        const b = getVoxel(bLocalX, bLocalY, bLocalZ);

                        if (a !== 0 && b !== 0) mask[n++] = 0;
                        else if (a !== 0)       mask[n++] = a;
                        else if (b !== 0)       mask[n++] = -b;
                        else                    mask[n++] = 0;
                    }
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

                    // Use absolute type for block lookup
                    const matType = Math.abs(type);

                    // Canonical quad (u-right, v-up)
                    let p1 = [x[0], x[1], x[2]];
                    let p2 = [x[0] + du[0], x[1] + du[1], x[2] + du[2]];
                    let p3 = [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]];
                    let p4 = [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]];

                    // adjust quad orientation for +X and -Z faces
                    if (d === 0 && type > 0) {
                        // +X face → rotate 90° CW
                        [p1, p2, p3, p4] = [p4, p1, p2, p3];
                    }
                    
                    if (d === 2 && type < 0) {
                        // -Z face → rotate 90° CW (flipped for some reason but it works so trust)
                        [p1, p2, p3, p4] = [p2, p3, p4, p1];
                    }                    

                    // Flip for negative-facing faces (reverse winding)
                    if (type < 0) {
                        [p2, p4] = [p4, p2];
                    }

                    // Determine texture file name for this face (matches BLOCKS in main.js)
                    const block = BLOCKS[matType];
                    let textureName;

                    // d = axis (0=x, 1=y, 2=z)
                    // type > 0 = +normal, type < 0 = -normal
                    if (d === 1 && type > 0) textureName = block.top ?? block.all;
                    else if (d === 1 && type < 0) textureName = block.bottom ?? block.all;
                    else textureName = block.side ?? block.all;

                    if (!vertexDataByTexture[textureName]) {
                        vertexDataByTexture[textureName] = [];
                        uvDataByTexture[textureName] = [];
                    }

                    // Push triangles
                    vertexDataByTexture[textureName].push(
                        ...p1, ...p2, ...p3,
                        ...p1, ...p3, ...p4
                    );

                    // Determine UV axes based on face direction
                    let uAxis, vAxis;

                    if (d === 0) {          // X faces
                        uAxis = 2;          // Z
                        vAxis = 1;          // Y
                    } else if (d === 1) {   // Y faces
                        uAxis = 0;          // X
                        vAxis = 2;          // Z
                    } else {                // Z faces
                        uAxis = 0;          // X
                        vAxis = 1;          // Y
                    }

                    const tileU = Math.abs(du[uAxis] + dv[uAxis]);
                    const tileV = Math.abs(du[vAxis] + dv[vAxis]);

                    uvDataByTexture[textureName].push(
                        0,     0,
                        tileU, 0,
                        tileU, tileV,
                    
                        0,     0,
                        tileU, tileV,
                        0,     tileV
                    );                    

                    // Zero out processed mask area
                    for (let l = 0; l < h; l++) {
                        for (let k = 0; k < w; k++) mask[n + k + l * size] = 0;
                    }
                    i += w; n += w;
                }
            }
        }
    }

    // Build Meshes (one per texture)
    for (const textureName in vertexDataByTexture) {
        const verts = vertexDataByTexture[textureName];
        if (!verts || verts.length === 0) continue;

        const uvs = uvDataByTexture[textureName];

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.computeVertexNormals();

        const mat = MATERIALS[textureName];
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set(cx * size, cy * size, cz * size);
        mesh.raycast = THREE.Mesh.prototype.raycast;
        mesh.userData = { chunk };
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        scene.add(mesh);
        chunk.meshes.push(mesh);

        if (debug) {
            const border = new THREE.LineSegments(chunkBorderGeo, chunkBorderMat);
            border.position.set(
                cx * size + size / 2,
                cy * size + size / 2,
                cz * size + size / 2
            );
        
            border.userData = {
                chunkBorder: true,
                cx,
                cy,
                cz
            };
        
            scene.add(border);
            chunkBorders.push(border);
        }          
    }
}

// -------------------------
// RESIZE / INPUT / LOOP
// -------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

window.addEventListener("mousedown", (e) => {
    if (!controls.isLocked) return;

    if (e.button === 0) {
        const hit = raycastBlock();
        if (hit) {
            breakBlock(hit.break.x, hit.break.y, hit.break.z);
        }
    }

    if (e.button === 2) {
        const hit = raycastBlock();
        if (hit) {
            placeBlock(hit.place.x, hit.place.y, hit.place.z);
        }
    }

    if (e.button === 1) {
        const hit = raycastBlock();
        if (hit) {
            pickBlock(hit.break.x, hit.break.y, hit.break.z);
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
            const helperPos = offset.applyMatrix4(camera.matrixWorld);
            axesHelper.position.copy(helperPos);
        }

        const hit = raycastBlock();
        if (hit) {
            const { x, y, z } = hit.break;
            highlightBox.position.set(x + 0.5, y + 0.5, z + 0.5);
            highlightBox.visible = true;
        } else {
            highlightBox.visible = false;
        }

        worldTimer += delta;
        if (worldTimer > 1/20) {
            updateWorld();
            worldTimer = 0;
        }

        renderer.render(scene, camera);
    }
    animate();
}
