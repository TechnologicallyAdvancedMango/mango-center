import { renderChunk, startRenderLoop } from "./render.js";

const chunks = new Map();

class ChunkManager {
    constructor(chunkSize = 16) {
        this.chunkSize = chunkSize;
        this.chunks = new Map();
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
            mesh: null,
            dirty: true
        };
    }

    getChunk(cx, cy, cz) {
        const key = this.chunkKey(cx, cy, cz);
        return this.chunks.get(key);
    }

    ensureChunk(cx, cy, cz) {
        const key = this.chunkKey(cx, cy, cz);
        let chunk = this.chunks.get(key);

        if (!chunk) {
            chunk = this.createChunk(cx, cy, cz);
            this.chunks.set(key, chunk);
        }

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
        chunk.dirty = true;
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


function generateFlatWorld(size) {
    for (let x = -size; x < size; x++) {
        for (let z = -size; z < size; z++) {
            chunkManager.setVoxel(x, 0, z, 1);
        }
    }
}

function generateNoiseWorld(size) {
    for (let x = -size; x < size; x++) {
        for (let z = -size; z < size; z++) {
            const height = Math.floor(Math.random() * 5 + 1);
            for (let y = 0; y < height; y++) {
                chunkManager.setVoxel(x, y, z, 1);
            }
        }
    }
}

generateNoiseWorld(32);

// After generating voxels, build all chunk meshes
for (const chunk of chunkManager.chunks.values()) {
    if (chunk.dirty) {
        renderChunk(chunk, chunk.cx, chunk.cy, chunk.cz);
        chunk.dirty = false;
    }
}

startRenderLoop(8);
