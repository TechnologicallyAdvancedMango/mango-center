// player.js
import * as THREE from "three";
import { getVoxelGlobal } from "./main.js";
import { camera, controls } from "./render.js";

// Player physical parameters (tweak these)
export const PLAYER = {
    height: 1.8,
    radius: 0.3,
    eyeHeight: 1.6,
    speed: 6.0, // horizontal move speed (m/s)
    sprintMultiplier: 1.6,
    jumpSpeed: 10.0,
    gravity: -30.0, // m/s^2
    maxFallSpeed: -50.0,
    stepHeight: 0.5 // allow stepping up small ledges
};

// Player state
export const player = {
    pos: new THREE.Vector3(0.5, 100 + PLAYER.eyeHeight, 0.5), // start above ground
    vel: new THREE.Vector3(0, 0, 0),
    onGround: false,
    wantsJump: false,
    wantsSprint: false
};

// Input state (local to player)
const keys = {};
window.addEventListener("keydown", (e) => keys[e.code] = true);
window.addEventListener("keyup", (e) => keys[e.code] = false);

// AABB helper: compute player's AABB in world coords
function getPlayerAABB(pos) {
    const r = PLAYER.radius;
    return {
        min: { x: pos.x - r, y: pos.y - PLAYER.eyeHeight, z: pos.z - r },
        max: { x: pos.x + r, y: pos.y - PLAYER.eyeHeight + PLAYER.height, z: pos.z + r }
    };
}

// Convert world AABB to voxel index ranges (inclusive)
function aabbToVoxelRange(aabb) {
    return {
        minX: Math.floor(aabb.min.x),
        maxX: Math.floor(aabb.max.x),
        minY: Math.floor(aabb.min.y),
        maxY: Math.floor(aabb.max.y),
        minZ: Math.floor(aabb.min.z),
        maxZ: Math.floor(aabb.max.z)
    };
}

// AABB overlap test
function aabbOverlap(aMin, aMax, bMin, bMax) {
    return !(aMax.x <= bMin.x || aMin.x >= bMax.x ||
        aMax.y <= bMin.y || aMin.y >= bMax.y ||
        aMax.z <= bMin.z || aMin.z >= bMax.z);
}

// Resolve collisions axis by axis using simple sweep
function resolveCollisions(pos, vel) {
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
        const proposed = pos.clone();
        proposed[axis] += vel[axis] * deltaForAxis;
        const aabb = getPlayerAABB(proposed);
        const range = aabbToVoxelRange(aabb);

        for (let vx = range.minX; vx <= range.maxX; vx++) {
            for (let vy = Math.max(0, range.minY); vy <= range.maxY; vy++) {
                for (let vz = range.minZ; vz <= range.maxZ; vz++) {
                    const id = getVoxelGlobal(vx, vy, vz);
                    if (!id) continue;
                    const bMin = { x: vx, y: vy, z: vz };
                    const bMax = { x: vx + 1, y: vy + 1, z: vz + 1 };
                    const pMin = { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z };
                    const pMax = { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z };
                    if (aabbOverlap(pMin, pMax, bMin, bMax)) {
                        let depth = 0;
                        if (axis === 'x') {
                            const leftPen = pMax.x - bMin.x;
                            const rightPen = bMax.x - pMin.x;
                            depth = Math.abs(leftPen) < Math.abs(rightPen) ? -leftPen : rightPen;
                        } else if (axis === 'y') {
                            const downPen = pMax.y - bMin.y;
                            const upPen = bMax.y - pMin.y;
                            depth = Math.abs(downPen) < Math.abs(upPen) ? -downPen : upPen;
                        } else {
                            const backPen = pMax.z - bMin.z;
                            const frontPen = bMax.z - pMin.z;
                            depth = Math.abs(backPen) < Math.abs(frontPen) ? -backPen : frontPen;
                        }
                        pos[axis] += depth;
                        vel[axis] = 0;
                        if (axis === 'y' && depth > 0) player.onGround = true;
                        vx = range.maxX + 1; vy = range.maxY + 1; vz = range.maxZ + 1;
                    }
                }
            }
        }
    }
}

let deltaForAxis = 0;

export function updatePlayer(delta) {
    const forwardInput = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    const rightInput = (keys["KeyA"] ? 1 : 0) - (keys["KeyD"] ? 1 : 0);
    player.wantsSprint = !!keys["ShiftLeft"];
    player.wantsJump = !!keys["Space"];

    // Movement tuning
    const accelGround = 60.0;
    const accelAir = 12.0;
    const dragGround = 8.0;
    const dragAir = 1.5;
    const brakeFactor = 0.9;
    const maxSpeed = PLAYER.speed * (player.wantsSprint ? PLAYER.sprintMultiplier : 1);

    const forwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(controls.getObject().quaternion);
    forwardVec.y = 0; forwardVec.normalize();
    const rightVec = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), forwardVec).normalize();

    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(forwardVec, forwardInput);
    moveDir.addScaledVector(rightVec, rightInput);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    const targetVel = new THREE.Vector3(moveDir.x * maxSpeed, 0, moveDir.z * maxSpeed);

    const accel = player.onGround ? accelGround : accelAir;
    const drag = player.onGround ? dragGround : dragAir;

    const velXZ = new THREE.Vector3(player.vel.x, 0, player.vel.z);
    const diff = new THREE.Vector3().subVectors(targetVel, velXZ);

    if (moveDir.lengthSq() > 0) {
        const currentDir = velXZ.clone();
        if (currentDir.lengthSq() > 1e-6) {
            currentDir.normalize();
            const dot = currentDir.dot(moveDir);
            if (dot < 0) diff.multiplyScalar(1 + (1 - dot) * brakeFactor);
        }
    }

    const accelStep = accel * delta;
    const accelChange = diff.clone().clampLength(0, accelStep);
    velXZ.add(accelChange);

    const damping = 1 / (1 + drag * delta);
    velXZ.multiplyScalar(damping);

    player.vel.x = velXZ.x;
    player.vel.z = velXZ.z;

    // vertical
    player.vel.y += PLAYER.gravity * delta;
    if (player.vel.y < PLAYER.maxFallSpeed) player.vel.y = PLAYER.maxFallSpeed;

    if (player.wantsJump && player.onGround) {
        player.vel.y = PLAYER.jumpSpeed;
        player.onGround = false;
    }

    deltaForAxis = delta;

    // X
    player.pos.x += player.vel.x * delta;
    resolveCollisions(player.pos, player.vel);

    // Y
    player.pos.y += player.vel.y * delta;
    player.onGround = false;
    resolveCollisions(player.pos, player.vel);

    // Z
    player.pos.z += player.vel.z * delta;
    resolveCollisions(player.pos, player.vel);

    // ground snap
    if (!player.onGround) {
        const footAABB = getPlayerAABB(player.pos);
        const footRange = aabbToVoxelRange(footAABB);
        const epsilon = 0.05;
        for (let y = footRange.minY - 1; y <= footRange.maxY + 1; y++) {
            for (let x = footRange.minX; x <= footRange.maxX; x++) {
                for (let z = footRange.minZ; z <= footRange.maxZ; z++) {
                    const id = getVoxelGlobal(x, y, z);
                    if (!id) continue;
                    const blockTop = y + 1;
                    const dist = player.pos.y - (blockTop + PLAYER.eyeHeight - PLAYER.height);
                    if (dist < epsilon && dist > -1) {
                        player.pos.y = blockTop + PLAYER.eyeHeight - PLAYER.height;
                        player.vel.y = 0;
                        player.onGround = true;
                    }
                }
            }
        }
    }

    camera.position.set(player.pos.x, player.pos.y, player.pos.z);
    controls.getObject().position.copy(camera.position);
}
