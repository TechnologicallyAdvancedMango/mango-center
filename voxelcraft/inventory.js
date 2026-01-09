// inventory.js
// No direct imports from main.js; inventory communicates via events

// Config
const HOTBAR_SIZE = 9;
const INV_ROWS = 3;
const INV_COLS = 9;
const INV_SIZE = INV_ROWS * INV_COLS; // 27
const SAVE_KEY = "voxelcraft_inventory_v1";

// Inventory data structure: array of slots { id: number, count: number } or null for empty
const state = {
    hotbar: new Array(HOTBAR_SIZE).fill(null),
    inventory: new Array(INV_SIZE).fill(null),
    selectedHotbarIndex: 0,
    open: false
};

// Utility
function makeSlot(id = 0, count = 0) {
    return { id, count };
}

function save() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Inventory save failed", e);
    }
}

function load() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.hotbar) state.hotbar = parsed.hotbar;
        if (parsed.inventory) state.inventory = parsed.inventory;
        if (typeof parsed.selectedHotbarIndex === "number") state.selectedHotbarIndex = parsed.selectedHotbarIndex;
    } catch (e) {
        console.warn("Inventory load failed", e);
    }
}

// Public API
export function init() {
    load();
    createUI();
    updateHotbarUI();
    updateInventoryUI();
    syncSelectedToGlobal();
    attachInputHandlers();
}

export function getSelectedSlotIndex() {
    return state.selectedHotbarIndex;
}

export function getSelectedItem() {
    return state.hotbar[state.selectedHotbarIndex];
}

export function setSelectedHotbarIndex(i) {
    state.selectedHotbarIndex = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    updateHotbarUI();
    syncSelectedToGlobal();
    save();
}

export function addItem(blockId, count = 1) {
    if (!blockId) return false;

    // Try to stack into existing hotbar first
    for (let i = 0; i < HOTBAR_SIZE; i++) {
        const s = state.hotbar[i];
        if (s && s.id === blockId) { s.count += count; updateHotbarUI(); save(); return true; }
    }
    // Then inventory stack
    for (let i = 0; i < INV_SIZE; i++) {
        const s = state.inventory[i];
        if (s && s.id === blockId) { s.count += count; updateInventoryUI(); save(); return true; }
    }
    // Then empty hotbar slot
    for (let i = 0; i < HOTBAR_SIZE; i++) {
        if (!state.hotbar[i]) { state.hotbar[i] = makeSlot(blockId, count); updateHotbarUI(); save(); return true; }
    }
    // Then empty inventory slot
    for (let i = 0; i < INV_SIZE; i++) {
        if (!state.inventory[i]) { state.inventory[i] = makeSlot(blockId, count); updateInventoryUI(); save(); return true; }
    }
    // Inventory full
    return false;
}

export function removeFromSelected(count = 1) {
    const slot = state.hotbar[state.selectedHotbarIndex];
    if (!slot) return false;
    slot.count -= count;
    if (slot.count <= 0) state.hotbar[state.selectedHotbarIndex] = null;
    updateHotbarUI();
    save();
    syncSelectedToGlobal();
    return true;
}

export function removeItemFromSlot(slotIndex, count = 1) {
    if (slotIndex < HOTBAR_SIZE) {
        const s = state.hotbar[slotIndex];
        if (!s) return false;
        s.count -= count;
        if (s.count <= 0) state.hotbar[slotIndex] = null;
        updateHotbarUI();
        save();
        syncSelectedToGlobal();
        return true;
    } else {
        const idx = slotIndex - HOTBAR_SIZE;
        const s = state.inventory[idx];
        if (!s) return false;
        s.count -= count;
        if (s.count <= 0) state.inventory[idx] = null;
        updateInventoryUI();
        save();
        return true;
    }
}

export function toggleOpen() {
    state.open = !state.open;
    const el = document.getElementById("vc-inventory");
    if (!el) return;
    el.style.display = state.open ? "grid" : "none";
    if (state.open) {
        document.exitPointerLock?.();
    }
    save();
}

export function isOpen() {
    return state.open;
}

// Keep the global selectedBlock variable in main.js in sync with hotbar
function syncSelectedToGlobal() {
    const slot = state.hotbar[state.selectedHotbarIndex];
    const id = slot ? slot.id : 0;
    window.dispatchEvent(new CustomEvent("inventory:selected", { detail: { id, slotIndex: state.selectedHotbarIndex } }));
}

// UI creation
function createUI() {
    if (!document.getElementById("vc-hotbar")) {
        const hotbar = document.createElement("div");
        hotbar.id = "vc-hotbar";
        hotbar.className = "vc-hotbar";
        document.body.appendChild(hotbar);
        for (let i = 0; i < HOTBAR_SIZE; i++) {
            const slot = document.createElement("div");
            slot.className = "vc-slot";
            slot.dataset.index = i;
            slot.innerHTML = `<div class="vc-slot-index">${i+1}</div><div class="vc-slot-count"></div>`;
            slot.addEventListener("click", () => setSelectedHotbarIndex(i));
            hotbar.appendChild(slot);
        }
    }

    if (!document.getElementById("vc-inventory")) {
        const inv = document.createElement("div");
        inv.id = "vc-inventory";
        inv.className = "vc-inventory";
        inv.style.display = state.open ? "grid" : "none";

        const hotbarPreview = document.createElement("div");
        hotbarPreview.className = "vc-inv-hotbar-preview";
        for (let i = 0; i < HOTBAR_SIZE; i++) {
            const s = document.createElement("div");
            s.className = "vc-slot";
            s.dataset.index = i;
            s.addEventListener("click", () => setSelectedHotbarIndex(i));
            hotbarPreview.appendChild(s);
        }
        inv.appendChild(hotbarPreview);

        const grid = document.createElement("div");
        grid.className = "vc-inv-grid";
        grid.style.gridTemplateColumns = `repeat(${INV_COLS}, 48px)`;
        for (let i = 0; i < INV_SIZE; i++) {
            const s = document.createElement("div");
            s.className = "vc-slot";
            s.dataset.index = HOTBAR_SIZE + i;
            s.addEventListener("click", () => {
                const invIdx = HOTBAR_SIZE + i;
                const invSlot = state.inventory[i];
                const hotSlot = state.hotbar[state.selectedHotbarIndex];
                if (!invSlot) return;
                state.hotbar[state.selectedHotbarIndex] = invSlot;
                state.inventory[i] = hotSlot || null;
                updateHotbarUI();
                updateInventoryUI();
                save();
                syncSelectedToGlobal();
            });
            grid.appendChild(s);
        }
        inv.appendChild(grid);

        const hint = document.createElement("div");
        hint.className = "vc-inv-hint";
        hint.textContent = "Press E to close";
        inv.appendChild(hint);

        document.body.appendChild(inv);
    }
}

// UI updates
function updateHotbarUI() {
    const hotbar = document.getElementById("vc-hotbar");
    if (!hotbar) return;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
        const el = hotbar.children[i];
        const slot = state.hotbar[i];
        el.classList.toggle("vc-selected", i === state.selectedHotbarIndex);
        const countEl = el.querySelector(".vc-slot-count");
        if (slot) {
            el.style.backgroundImage = `url('textures/${slot.id}.png')`;
            countEl.textContent = slot.count > 1 ? slot.count : "";
        } else {
            el.style.backgroundImage = "";
            countEl.textContent = "";
        }
    }
    const inv = document.getElementById("vc-inventory");
    if (inv) {
        const preview = inv.querySelector(".vc-inv-hotbar-preview");
        if (preview) {
            for (let i = 0; i < HOTBAR_SIZE; i++) {
                const el = preview.children[i];
                const slot = state.hotbar[i];
                el.classList.toggle("vc-selected", i === state.selectedHotbarIndex);
                if (slot) {
                    el.style.backgroundImage = `url('textures/${slot.id}.png')`;
                    el.textContent = slot.count > 1 ? slot.count : "";
                } else {
                    el.style.backgroundImage = "";
                    el.textContent = "";
                }
            }
        }
    }
}

function updateInventoryUI() {
    const inv = document.getElementById("vc-inventory");
    if (!inv) return;
    const grid = inv.querySelector(".vc-inv-grid");
    for (let i = 0; i < INV_SIZE; i++) {
        const el = grid.children[i];
        const slot = state.inventory[i];
        if (slot) {
            el.style.backgroundImage = `url('textures/${slot.id}.png')`;
            el.textContent = slot.count > 1 ? slot.count : "";
        } else {
            el.style.backgroundImage = "";
            el.textContent = "";
        }
    }
    updateHotbarUI();
}

// Input handlers
function attachInputHandlers() {
    window.addEventListener("keydown", (e) => {
        if (e.code.startsWith("Digit")) {
            const n = parseInt(e.code.replace("Digit", ""), 10);
            if (!isNaN(n) && n >= 1 && n <= HOTBAR_SIZE) {
                setSelectedHotbarIndex(n - 1);
            }
        } else if (e.code === "KeyE") {
            toggleOpen();
        }
    });

    window.addEventListener("wheel", (e) => {
        if (state.open) return;
        if (e.deltaY > 0) setSelectedHotbarIndex(state.selectedHotbarIndex + 1);
        else setSelectedHotbarIndex(state.selectedHotbarIndex - 1);
    });

    window.addEventListener("inventory:selectIndex", (ev) => {
        const idx = ev.detail?.index;
        if (typeof idx === "number") setSelectedHotbarIndex(idx);
    });
}

// Event-driven integration

// Auto-pickup when main.js notifies of a broken block
window.addEventListener("game:broken", (ev) => {
    const { blockId } = ev.detail;
    if (!blockId) return;
    addItem(blockId, 1);
});

// When main.js says placement is allowed, consume selected and approve
window.addEventListener("game:placeAllowed", (ev) => {
    const { x, y, z } = ev.detail;
    const slot = state.hotbar[state.selectedHotbarIndex];
    if (!slot || !slot.id) {
        window.dispatchEvent(new CustomEvent("game:placeDenied", { detail: { reason: "no_item" } }));
        return;
    }
    // consume one
    removeFromSelected(1);
    // notify main.js to place
    window.dispatchEvent(new CustomEvent("game:placeApproved", { detail: { x, y, z, blockId: slot.id } }));
});

// When main.js responds to a pick request, set hotbar slot to that block
window.addEventListener("game:pickResponse", (ev) => {
    const { blockId } = ev.detail;
    if (!blockId) return;
    state.hotbar[state.selectedHotbarIndex] = makeSlot(blockId, 1);
    updateHotbarUI();
    save();
    syncSelectedToGlobal();
});

// Expose state for debugging or UI
export function getState() {
    return state;
}
