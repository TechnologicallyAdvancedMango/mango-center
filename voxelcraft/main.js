// main.js
import { renderChunk, startRenderLoop, camera, scene, removeChunkBordersFor } from "./render.js";
import { createNoise2D, createNoise3D } from "https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js";
import * as THREE from "three";
import * as Inventory from "./inventory.js";

Inventory.init();

const rand = mulberry32(12345);
const noise2D = createNoise2D(rand);
const noise3D = createNoise3D(rand);

export const BLOCK = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    SAND: 4,
    GLOWSTONE: 5
};

export const BLOCKS = {
    [BLOCK.GRASS]: {
        top: "grass_block_top.png",
        bottom: "dirt.png",
        side: "grass_block_side.png"
    },
    [BLOCK.DIRT]: {
        all: "dirt.png"
    },
    [BLOCK.STONE]: {
        all: "stone.png"
    },
    [BLOCK.SAND]: {
        all: "sand.png"
    },
    [BLOCK.GLOWSTONE]: {
        all: "glowstone.png"
    }
};

export const WORLD_HEIGHT_CHUNKS = 16;
const WORLD_Y_OFFSET = 32;

const viewDistance = 8;

const columnHeightOverrides = new Map(); // key: "cx,cz" → maxY

const meshQueue = [];

class ChunkManager {
    constructor(chunkSize = 16) {
        this.chunkSize = chunkSize;
        this.chunks = new Map();
        this.savedChunks = new Map(); // key => Uint8Array copy
    }

    chunkKey(cx, cy, cz) {
        return `${cx},${cy},${cz}`;
    }

    createChunk(cx, cy, cz) {
        const size = this.chunkSize;
        const voxelCount = size * size * size;

        return {
            cx, cy, cz,
            size,
            id: new Uint8Array(voxelCount),
            meshes: [],
            dirty: false
        };
    }

    generateChunk(cx, cy, cz) {
        const size = this.chunkSize;
        const chunk = this.ensureChunk(cx, cy, cz);
        const id = chunk.id;

        // Fill data silently (don't call setVoxel to avoid queue flooding)
        id.fill(0);

        let hasVoxels = false;

        // Precompute heightmap
        const heightmap = new Array(size * size);

        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const worldX = cx * size + x;
                const worldZ = cz * size + z;
                heightmap[x + z * size] = getHeight(worldX, worldZ);
            }
        }

        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const worldX = cx * size + x;
                const worldZ = cz * size + z;
                const height = heightmap[x + z * size];

                for (let y = 0; y < size; y++) {
                    const worldY = cy * size + y;

                    if (worldY > height) continue;

                    let blockType = BLOCK.STONE;

                    if (worldY === height) blockType = BLOCK.GRASS;
                    else if (worldY >= height - 3) blockType = BLOCK.DIRT;

                    const index = x + y * size + z * size * size;

                    // Cave generation
                    if (worldY < height - 1) {
                        const caveNoise = noise3D(worldX / 60, worldY / 60, worldZ / 60);

                        // Carve caves: threshold controls density
                        if (caveNoise > 0.75) {
                            id[index] = BLOCK.AIR;
                            continue; // skip placing stone/dirt/grass
                        }
                    }

                    id[index] = blockType;

                    hasVoxels = true;
                }
            }
        }

        // Only queue for meshing if it's not empty and not already dirty
        if (hasVoxels && !chunk.dirty) {
            chunk.dirty = true;
            meshQueue.push(chunk);
            markNeighborChunksForRebuild(cx, cy, cz);
        }
    }

    getChunk(cx, cy, cz) {
        const key = this.chunkKey(cx, cy, cz);
        return this.chunks.get(key);
    }

    ensureChunk(cx, cy, cz) {
        const key = this.chunkKey(cx, cy, cz);

        // If chunk already loaded, return it
        let chunk = this.chunks.get(key);
        if (chunk) return chunk;

        // Create a new empty chunk
        chunk = this.createChunk(cx, cy, cz);

        // Restore saved voxel data if it exists
        if (this.savedChunks.has(key)) {
            chunk.id = this.savedChunks.get(key).slice();
            if (!chunk.dirty) {
                chunk.dirty = true;
                meshQueue.push(chunk);
            }
        }

        this.chunks.set(key, chunk);
        markNeighborChunksForRebuild(cx, cy, cz);
        return chunk;
    }

    markChunkDirty(cx, cy, cz) {
        const key = this.chunkKey(cx, cy, cz);
        const chunk = this.chunks.get(key);
        if (!chunk) return;

        if (!chunk.dirty) {
            chunk.dirty = true;
            meshQueue.push(chunk);
        }
    }

    worldToChunk(x, y, z) {
        const s = this.chunkSize;
        return {
            cx: Math.floor(x / s),
            cy: Math.floor(y / s),
            cz: Math.floor(z / s)
        };
    }

    worldToLocal(x, y, z) {
        const s = this.chunkSize;
        return {
            lx: ((x % s) + s) % s,
            ly: ((y % s) + s) % s,
            lz: ((z % s) + s) % s
        };
    }

    worldToVoxelIndex(x, y, z) {
        const s = this.chunkSize;

        const vx = ((x % s) + s) % s;
        const vy = ((y % s) + s) % s;
        const vz = ((z % s) + s) % s;

        return vx + vy * s + vz * s * s;
    }

    setVoxel(x, y, z, id) {
        const { cx, cy, cz } = this.worldToChunk(x, y, z);
        const chunk = this.ensureChunk(cx, cy, cz);

        const index = this.worldToVoxelIndex(x, y, z);
        chunk.id[index] = id;

        // Mark this chunk dirty
        this.markChunkDirty(cx, cy, cz);

        const s = this.chunkSize;
        const { lx, ly, lz } = this.worldToLocal(x, y, z);

        // X borders
        if (lx === 0) this.markChunkDirty(cx - 1, cy, cz);
        if (lx === s - 1) this.markChunkDirty(cx + 1, cy, cz);

        // Y borders
        if (ly === 0) this.markChunkDirty(cx, cy - 1, cz);
        if (ly === s - 1) this.markChunkDirty(cx, cy + 1, cz);

        // Z borders
        if (lz === 0) this.markChunkDirty(cx, cy, cz - 1);
        if (lz === s - 1) this.markChunkDirty(cx, cy, cz + 1);
    }

    getVoxel(x, y, z) {
        const { cx, cy, cz } = this.worldToChunk(x, y, z);
        const chunk = this.getChunk(cx, cy, cz);
        if (!chunk) return 0;

        const index = this.worldToVoxelIndex(x, y, z);
        return chunk.id[index];
    }
}
const chunkManager = new ChunkManager(16);

export function getVoxelGlobal(x, y, z) {
    return chunkManager.getVoxel(x, y, z);
}

export function isChunkLoaded(cx, cy, cz) {
    const key = `${cx},${cy},${cz}`;
    return chunkManager.chunks.has(key);
}

// after chunk is created/loaded, mark neighbors dirty so borders get rebuilt
function markNeighborChunksForRebuild(cx, cy, cz) {
    const deltas = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx,dy,dz] of deltas) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        if (chunkManager.chunks.has(`${nx},${ny},${nz}`)) {
            const neighbor = chunkManager.chunks.get(`${nx},${ny},${nz}`);
            if (!neighbor.dirty) {
                neighbor.dirty = true;
                meshQueue.push(neighbor);
            }
        }
    }
}

const genQueue = [];

function mulberry32(seed) {
    return function() {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function fractalNoise2D(x, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaves; i++) {
        value += noise2D(x * frequency, z * frequency) * amplitude;
        frequency *= lacunarity;
        amplitude *= gain;
    }

    return value;
}

function getHeight(x, z) {
    const n = fractalNoise2D(x / 80, z / 80, 6, 2.0, 0.4);

    // Normalize [-1, 1] → [0, 1]
    let h = (n + 1) * 0.5;

    const amplitude = 40; // how tall hills are
    const baseHeight = 16; // minimum terrain level
    const maxWorldHeight = 256; // hard cutoff

    let height = Math.floor(h * amplitude) + baseHeight + WORLD_Y_OFFSET;

    // Apply cutoff
    return Math.min(height, maxWorldHeight);
}

function getColumnMaxHeightForChunk(cx, cz, chunkSize) {
    // Sample height at the center of the chunk column
    const worldX = cx * chunkSize + chunkSize * 0.5;
    const worldZ = cz * chunkSize + chunkSize * 0.5;
    return getHeight(worldX, worldZ);
}

// World modification functions (authoritative)
export function breakBlock(x, y, z) {
    chunkManager.setVoxel(x, y, z, 0);
}

export function placeBlock(x, y, z, blockId) {
    chunkManager.setVoxel(x, y, z, blockId);

    const { cx, cz } = chunkManager.worldToChunk(x, y, z);
    const key = `${cx},${cz}`;

    const current = columnHeightOverrides.get(key) ?? -Infinity;
    if (y > current) {
        columnHeightOverrides.set(key, y);
    }
}

export function pickBlock(x, y, z) {
    return chunkManager.getVoxel(x, y, z);
}

// Event-driven glue: respond to UI requests and coordinate inventory/world

// Break request -> perform break and notify
window.addEventListener("game:requestBreak", (ev) => {
    const { x, y, z } = ev.detail;
    const brokenId = chunkManager.getVoxel(x, y, z);
    if (!brokenId) return;
    breakBlock(x, y, z);
    // notify others (inventory will auto-pickup)
    window.dispatchEvent(new CustomEvent("game:broken", { detail: { x, y, z, blockId: brokenId } }));
});

// Pick request -> reply with block id at location
window.addEventListener("game:requestPick", (ev) => {
    const { x, y, z } = ev.detail;
    const id = chunkManager.getVoxel(x, y, z);
    window.dispatchEvent(new CustomEvent("game:pickResponse", { detail: { blockId: id } }));
});

// Place request -> validate placement, then allow inventory to consume
window.addEventListener("game:requestPlace", (ev) => {
    const { x, y, z } = ev.detail;
    // simple validation: target must be empty
    const existing = chunkManager.getVoxel(x, y, z);
    if (existing !== 0) {
        window.dispatchEvent(new CustomEvent("game:placeDenied", { detail: { reason: "blocked" } }));
        return;
    }
    // optionally more validation (player overlap) could be added here
    // notify inventory that placement is allowed and it should consume
    window.dispatchEvent(new CustomEvent("game:placeAllowed", { detail: { x, y, z } }));
});

// Inventory consumed and approved placement -> perform authoritative place
window.addEventListener("game:placeApproved", (ev) => {
    const { x, y, z, blockId } = ev.detail;
    placeBlock(x, y, z, blockId);
    window.dispatchEvent(new CustomEvent("game:placed", { detail: { x, y, z, blockId } }));
});

// -------------------------
// updateWorld, queues, and loop integration (unchanged logic)
// -------------------------

export function updateWorld() {
    const size = chunkManager.chunkSize;

    const px = Math.floor(camera.position.x / size);
    const py = Math.floor(camera.position.y / size);
    const pz = Math.floor(camera.position.z / size);

    const unloadDistance = viewDistance + 2;

    // Unload chunks
    const unloadList = [];

    for (const [key, chunk] of chunkManager.chunks.entries()) {
        const dx = chunk.cx - px;
        const dz = chunk.cz - pz;
        const dy = chunk.cy - py;

        if (dx*dx + dy*dy + dz*dz > unloadDistance * unloadDistance) {
            unloadList.push(key);
        }
    }

    for (const key of unloadList) {
        const chunk = chunkManager.chunks.get(key);
        if (!chunk) continue;

        // Save voxel data
        chunkManager.savedChunks.set(key, chunk.id.slice());

        // Remove all meshes for this chunk
        if (chunk.meshes) {
            for (const m of chunk.meshes) {
                scene.remove(m);
                m.geometry.dispose();
                // Don't dispose MATERIALS here; they are shared globals
            }

            // Remove debug chunk border if present
            removeChunkBordersFor(chunk.cx, chunk.cy, chunk.cz);

            chunk.meshes.length = 0;
        }

        chunk.dirty = false;
        chunkManager.chunks.delete(key);

        // Remove from genQueue
        for (let i = genQueue.length - 1; i >= 0; i--) {
            const j = genQueue[i];
            if (j.cx === chunk.cx && j.cy === chunk.cy && j.cz === chunk.cz) {
                genQueue.splice(i, 1);
            }
        }

        // Remove from meshQueue
        for (let i = meshQueue.length - 1; i >= 0; i--) {
            const c = meshQueue[i];
            if (c.cx === chunk.cx && c.cy === chunk.cy && c.cz === chunk.cz) {
                meshQueue.splice(i, 1);
            }
        }
    }

    // Load / Ensure chunks in view
    for (let cx = px - viewDistance; cx <= px + viewDistance; cx++) {
        for (let cy = py - viewDistance; cy <= py + viewDistance; cy++) {
            for (let cz = pz - viewDistance; cz <= pz + viewDistance; cz++) {

                // spherical distance check
                const dx = cx - px;
                const dy = cy - py;
                const dz = cz - pz;

                if (dx*dx + dy*dy + dz*dz > viewDistance * viewDistance) continue;

                // Compute max block height for this column
                const terrainHeight = getColumnMaxHeightForChunk(cx, cz, size);
                const overrideKey = `${cx},${cz}`;
                const overrideHeight = columnHeightOverrides.get(overrideKey) ?? -Infinity;

                const columnMaxHeight = Math.max(terrainHeight, overrideHeight);
                const maxChunkY = Math.floor(columnMaxHeight / size) + 1;

                // Skip chunks above the column's max height
                if (cy > maxChunkY) continue;

                const key = chunkManager.chunkKey(cx, cy, cz);

                // If chunk is already loaded, skip
                if (chunkManager.chunks.has(key)) continue;

                // saved chunk exists, load it immediately
                if (chunkManager.savedChunks.has(key)) {
                    chunkManager.ensureChunk(cx, cy, cz);
                    continue;
                }

                // not saved, queue generation
                if (!genQueue.some(j => j.cx === cx && j.cy === cy && j.cz === cz)) {
                    genQueue.push({ cx, cy, cz });
                }
            }
        }
    }

    // Chunk gen queue
    let gensThisTick = 0;
    const maxGensPerTick = 5;

    while (genQueue.length > 0 && gensThisTick < maxGensPerTick) {
        // Sort by distance to camera (optional but recommended)
        genQueue.sort((a, b) => {
            const ax = a.cx * size + size * 0.5;
            const az = a.cz * size + size * 0.5;
            const bx = b.cx * size + size * 0.5;
            const bz = b.cz * size + size * 0.5;

            const da = (ax - camera.position.x)**2 + (az - camera.position.z)**2;
            const db = (bx - camera.position.x)**2 + (bz - camera.position.z)**2;

            return da - db;
        });

        const job = genQueue.shift();
        chunkManager.generateChunk(job.cx, job.cy, job.cz);
        gensThisTick++;
    }

    // Mesh queue
    let meshesThisTick = 0;
    const maxMeshesPerTick = 2;

    // Sort so closest chunks to the camera are first
    if (meshQueue.length > 1) {
        const size = chunkManager.chunkSize;
        const camX = camera.position.x;
        const camY = camera.position.y;
        const camZ = camera.position.z;

        meshQueue.sort((a, b) => {
            const ax = a.cx * size + size * 0.5;
            const ay = a.cy * size + size * 0.5;
            const az = a.cz * size + size * 0.5;

            const bx = b.cx * size + size * 0.5;
            const by = b.cy * size + size * 0.5;
            const bz = b.cz * size + size * 0.5;

            const da =
                (ax - camX) * (ax - camX) +
                (ay - camY) * (ay - camY) +
                (az - camZ) * (az - camZ);

            const db =
                (bx - camX) * (bx - camX) +
                (by - camY) * (by - camY) +
                (bz - camZ) * (bz - camZ);

            return da - db; // smaller distance first
        });
    }

    while (meshQueue.length > 0 && meshesThisTick < maxMeshesPerTick) {
        const chunk = meshQueue.shift();
        if (!chunk) break;
        renderChunk(chunk, chunk.cx, chunk.cy, chunk.cz);
        chunk.dirty = false;
        meshesThisTick++;
    }
}

startRenderLoop();
