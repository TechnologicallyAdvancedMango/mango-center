import { renderChunk, startRenderLoop, camera, scene } from "./render.js";
import { createNoise2D, createNoise3D } from "https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js";
import * as THREE from "three";

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

export let selectedBlock = 1;

export const WORLD_HEIGHT_CHUNKS = 16;
const WORLD_Y_OFFSET = 32;

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
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const worldX = cx * size + x;
                const worldZ = cz * size + z;
                const height = getHeight(worldX, worldZ);

                for (let y = 0; y < size; y++) {
                    const worldY = cy * size + y;

                    if (worldY > height) continue;

                    let blockType = BLOCK.STONE;

                    if (worldY === height) blockType = BLOCK.GRASS;
                    else if (worldY >= height - 3) blockType = BLOCK.DIRT;

                    const index = x + y * size + z * size * size;

                    // Cave generation
                    const caveNoise = noise3D(worldX / 40, worldY / 40, worldZ / 40);

                    // Carve caves: threshold controls density
                    if (caveNoise > 0.75) {
                        id[index] = BLOCK.AIR;
                        continue; // skip placing stone/dirt/grass
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
        return chunk;
    }

    worldToChunk(x, y, z) {
        const s = this.chunkSize;
        return {
            cx: Math.floor(x / s),
            cy: Math.floor(y / s),
            cz: Math.floor(z / s)
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
        
        if (!chunk.dirty) {
            chunk.dirty = true;
            meshQueue.push(chunk);
        }
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
    const n = fractalNoise2D(x / 80, z / 80, 8, 2.0, 0.4);

    // Normalize [-1, 1] → [0, 1]
    let h = (n + 1) * 0.5;

    const amplitude = 40; // how tall hills are
    const baseHeight = 16; // minimum terrain level
    const maxWorldHeight = 256; // hard cutoff

    let height = Math.floor(h * amplitude) + baseHeight + WORLD_Y_OFFSET;

    // Apply cutoff
    return Math.min(height, maxWorldHeight);
}

export function breakBlock(x, y, z) {
    chunkManager.setVoxel(x, y, z, 0);
}

export function placeBlock(x, y, z) {
    chunkManager.setVoxel(x, y, z, selectedBlock);
}

export function pickBlock(x, y, z) {
    selectedBlock = chunkManager.getVoxel(x, y, z);
}

export function updateWorld() {
    const size = chunkManager.chunkSize;

    const px = Math.floor(camera.position.x / size);
    const pz = Math.floor(camera.position.z / size);

    const viewDistance = 6;
    const unloadDistance = viewDistance + 2;

    // Unload chunks
    const unloadList = [];

    for (const [key, chunk] of chunkManager.chunks.entries()) {
        const dx = chunk.cx - px;
        const dz = chunk.cz - pz;

        if (dx * dx + dz * dz > unloadDistance * unloadDistance) {
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
            chunk.meshes.length = 0;
        }
    
        chunkManager.chunks.delete(key);
    }    

    // Load / Ensure chunks in view
    for (let cy = 0; cy < WORLD_HEIGHT_CHUNKS; cy++) {
        for (let cx = px - viewDistance; cx <= px + viewDistance; cx++) {
            for (let cz = pz - viewDistance; cz <= pz + viewDistance; cz++) {
                const key = chunkManager.chunkKey(cx, cy, cz);
                if (!chunkManager.chunks.has(key)) {
                    const chunk = chunkManager.ensureChunk(cx, cy, cz);
                    if (!chunkManager.savedChunks.has(key)) {
                        chunkManager.generateChunk(cx, cy, cz);
                    }
                }
            }
        }
    }

    // Mesh Queue
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
