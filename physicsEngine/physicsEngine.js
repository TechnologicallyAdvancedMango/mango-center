const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth - 150; // leave space for sidebar
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth - 150; // leave space for sidebar
  canvas.height = window.innerHeight;

  lastTime = performance.now();
});

let frameMultiplier = 20; // is changed automatically if adaptiveFrameMultiplier is true
let adaptiveFrameMultiplier = true;
let targetFPS = 60;
let fps = 0;

let speed = 1.0;

let showStress = true; // or false to disable

let mouseStrength = 5.0;

let isPaused = false;
let windowFocused = true;

let lastTime = performance.now();

let gravity = 1000;
let drag = 0.01;

let mouseX = 0;
let mouseY = 0;
let draggingCircle = null;

let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

let selectFilter = "any";
document.getElementById("selectFilter").addEventListener("change", e => {
  selectFilter = e.target.value;
});

let springStart = null;

let isDraggingSelection = false;
let dragStartX = 0;
let dragStartY = 0;

let pastePreview = [];
let pasteOffsetX = 0;
let pasteOffsetY = 0;

let clipboard = null;

let circlePreview = null;

let softbodyPreview = null;
let softbodyConfig = {
  rows: 10,
  cols: 10,
  spacing: 40,
  radius: 8
};

let springPreviewStart = null;
let springPreviewEnd = null;

let springStartCircle = null;
let springEndCircle = null;
let isRightDragging = false;

let selectedObject = null;
let propertyMenuOpen = false;
let justOpenedMenu = false;

let circleFill = "#ffffff";
let anchoredCircleFill = "#b10000";
let circleStroke = "#000000";
let circleStrokeWidth = 3;

let rectFill = "#ffffff";
let rectStroke = "#000000";
let rectStrokeWidth = 3;

let springColor = "#ffffff";
let rigidSpringColor = "#b10000";
let springWidth = "3";

// Width used for collision detection
let springPhysicalWidth = "5";

// Get environment settings from localStorage
targetFPS = localStorage.getItem("targetFPS") ?? 60;
gravity = localStorage.getItem("gravity") ?? 1000;
speed = localStorage.getItem("speed") ?? 1.0;
drag = localStorage.getItem("drag") ?? 0.01;
adaptiveFrameMultiplier = localStorage.getItem("adaptiveFrameMultiplier") ?? true;


let circles = [];
let rectangles = [];
let springs = [];

class Circle {
  constructor(x, y, radius, anchored = false, restitution = 1, mass = null, visible = true, ghost = false) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.anchored = anchored;
    this.restitution = restitution;
    this.visible = visible;
    this.ghost = ghost;

    // If no mass provided, derive it from radius
    if (mass !== null) {
      this.mass = mass; // use provided mass directly
    } else {
      this.mass = Math.PI * radius * radius * 0.001; // derive and scale
    }
    
    if(!ghost) circles.push(this);
    if (!ghost) console.log("Circle created:", this, "ghost =", ghost);
  }
}

class Rectangle {
  constructor(x, y, width, height, angle = 0, anchored = true, restitution = 0.8) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = angle;
    this.angularVelocity = 0;
    this.width = width;
    this.height = height;
    this.anchored = anchored;
    this.restitution = restitution;
    
    rectangles.push(this);
  }
  getCenter() {
    return { x: this.x + this.width / 2, y: this.y + this.height / 2 };
  }
}

class Spring {
  constructor(a, b, restLength, stiffness, damping, rigid = false, collides = false, restitution = 0.8, elasticLimit = null, visible = true, ghost = false) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
    this.stiffness = stiffness;
    this.damping = damping;
    this.rigid = rigid;
    this.collides = collides;
    this.restitution = restitution
    this.elasticLimit = elasticLimit; // or set to a number like 2 for destructible springs
    this.visible = visible;
    this.ghost = ghost;

    if(!ghost) springs.push(this);
    if (!ghost) console.log("Spring created:", this, "ghost =", ghost);
  }

  apply(dt) {
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (this.elasticLimit !== null) {
      const maxStretch = this.restLength * this.elasticLimit;
      const minCompress = this.restLength / this.elasticLimit;

      if (dist > maxStretch || dist < minCompress) {
        // Remove the spring
        springs.splice(springs.indexOf(this), 1);
        return;
      }
    }

    if (dist === 0) return;

    const nx = dx / dist;
    const ny = dy / dist;

    const springForce = this.stiffness * (dist - this.restLength);

    const dvx = this.b.vx - this.a.vx;
    const dvy = this.b.vy - this.a.vy;
    const relativeVel = dvx * nx + dvy * ny;

    const dampingForce = this.damping * relativeVel;

    const totalForce = (springForce + dampingForce) * dt;

    const fx = nx * totalForce;
    const fy = ny * totalForce;

    const ma = this.a.mass ?? 1;
    const mb = this.b.mass ?? 1;

    const totalMass = ma + mb;

    // Distribute force based on mass ratio
    const faRatio = mb / totalMass;
    const fbRatio = ma / totalMass;

    if (!this.a.anchored) {
      this.a.vx += fx * faRatio / ma;
      this.a.vy += fy * faRatio / ma;
    }
    if (!this.b.anchored) {
      this.b.vx -= fx * fbRatio / mb;
      this.b.vy -= fy * fbRatio / mb;
    }

    // Rigid constraint remains unchanged
    if (this.rigid) {
      const correction = this.restLength - dist;
      if (Math.abs(correction) > 0.01) {
        const maxCorrection = 20 * (dt / (1 / targetFPS)); // limit max correction relative to time
        const clamped = Math.max(-maxCorrection, Math.min(maxCorrection, correction));

        if (!this.a.anchored && !this.b.anchored) {
          this.a.x -= nx * clamped * fbRatio;
          this.a.y -= ny * clamped * fbRatio;
          this.b.x += nx * clamped * faRatio;
          this.b.y += ny * clamped * faRatio;
        } else if (!this.a.anchored) {
          this.a.x -= nx * clamped;
          this.a.y -= ny * clamped;
        } else if (!this.b.anchored) {
          this.b.x += nx * clamped;
          this.b.y += ny * clamped;
        }

        const dvx = this.b.vx - this.a.vx;
        const dvy = this.b.vy - this.a.vy;
        const relVel = dvx * nx + dvy * ny;

        if (!this.a.anchored && !this.b.anchored) {
          this.a.vx += nx * relVel * fbRatio;
          this.a.vy += ny * relVel * fbRatio;
          this.b.vx -= nx * relVel * faRatio;
          this.b.vy -= ny * relVel * faRatio;
        } else if (!this.a.anchored) {
          this.a.vx += nx * relVel;
          this.a.vy += ny * relVel;
        } else if (!this.b.anchored) {
          this.b.vx -= nx * relVel;
          this.b.vy -= ny * relVel;
        }
      }
    }
  }


  collide(circles, rectangles) {
    if (!this.collides) return;

    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 0.0001) return;

    const length = Math.sqrt(lengthSq);
    const nx = dx / length;
    const ny = dy / length;

    // --- Circle collisions ---
    for (let circle of circles) {
      if (circle === this.a || circle === this.b) continue;

      // Project circle center onto spring segment
      const t = ((circle.x - this.a.x) * dx + (circle.y - this.a.y) * dy) / lengthSq;
      if (t < 0 || t > 1) continue;

      const closestX = this.a.x + t * dx;
      const closestY = this.a.y + t * dy;

      const distX = circle.x - closestX;
      const distY = circle.y - closestY;
      const distSq = distX * distX + distY * distY;
      const minDist = circle.radius;

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const overlap = minDist - dist;
        const nxC = distX / dist;
        const nyC = distY / dist;

        // Position correction
        if (!circle.anchored) {
          circle.x += nxC * overlap;
          circle.y += nyC * overlap;
        }

        // Velocity impulse
        const relVel = circle.vx * nxC + circle.vy * nyC;
        if (relVel < 0) {
          const restitution = this.restitution;

          const ma = this.a.mass ?? 1;
          const mb = this.b.mass ?? 1;
          const mc = circle.mass ?? 1;

          const invMa = this.a.anchored ? 0 : 1 / ma;
          const invMb = this.b.anchored ? 0 : 1 / mb;
          const invMc = circle.anchored ? 0 : 1 / mc;

          // Linear weights for endpoints
          const totalInvMass = invMa * (1 - t) + invMb * t + invMc;
          if (totalInvMass === 0) continue;

          const impulseMag = -(1 + restitution) * relVel / totalInvMass;
          const impulseX = impulseMag * nxC;
          const impulseY = impulseMag * nyC;

          if (!circle.anchored) {
            circle.vx += impulseX * invMc;
            circle.vy += impulseY * invMc;
          }
          if (!this.a.anchored) {
            this.a.vx -= impulseX * invMa * (1 - t);
            this.a.vy -= impulseY * invMa * (1 - t);
          }
          if (!this.b.anchored) {
            this.b.vx -= impulseX * invMb * t;
            this.b.vy -= impulseY * invMb * t;
          }
        }
      }
    }

    // --- Rectangle collisions ---
    for (let rect of rectangles) {
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;

      // Find closest point on spring segment to rectangle center
      const t = ((rect.x - this.a.x) * dx + (rect.y - this.a.y) * dy) / lengthSq;
      const clampedT = Math.max(0, Math.min(1, t));
      const springX = this.a.x + clampedT * dx;
      const springY = this.a.y + clampedT * dy;

      // Clamp that point to rectangle bounds
      const closestX = Math.max(rect.x - halfW, Math.min(springX, rect.x + halfW));
      const closestY = Math.max(rect.y - halfH, Math.min(springY, rect.y + halfH));

      const distX = closestX - springX;
      const distY = closestY - springY;
      const distSq = distX * distX + distY * distY;
      const minDist = springPhysicalWidth; // spring thickness

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const overlap = minDist - dist;
        const nxR = distX / dist;
        const nyR = distY / dist;

        // Position correction distributed
        if (!rect.anchored) {
          rect.x += nxR * overlap * 0.5;
          rect.y += nyR * overlap * 0.5;
        }
        if (!this.a.anchored) {
          this.a.x -= nxR * overlap * (1 - clampedT) * 0.5;
          this.a.y -= nyR * overlap * (1 - clampedT) * 0.5;
        }
        if (!this.b.anchored) {
          this.b.x -= nxR * overlap * clampedT * 0.5;
          this.b.y -= nyR * overlap * clampedT * 0.5;
        }

        // Velocity impulse
        const relVel = rect.vx * nxR + rect.vy * nyR;
        if (relVel < 0) {
          const bounce = -relVel * this.restitution;
          if (!rect.anchored) {
            rect.vx += nxR * bounce;
            rect.vy += nyR * bounce;
          }
          if (!this.a.anchored) {
            this.a.vx -= nxR * bounce * (1 - clampedT);
            this.a.vy -= nyR * bounce * (1 - clampedT);
          }
          if (!this.b.anchored) {
            this.b.vx -= nxR * bounce * clampedT;
            this.b.vy -= nyR * bounce * clampedT;
          }
        }
      }
    }
  }
}

function simulate(dt) {
  for (const spring of springs) {
    if (spring.ghost) continue; // skip ghosts

    spring.apply(dt);
    spring.collide(circles, rectangles);
  }

  for (const circle of circles) {
    if (circle.ghost) continue; // skip ghosts

    if (!circle.anchored) {
      circle.vy += gravity * dt;

      circle.x += circle.vx * dt;
      circle.y += circle.vy * dt;
    } else {
      circle.vx = 0;
      circle.vy = 0;
    }
  }


  for (const rect of rectangles) {
    if (rect.anchored) {
      rect.vx = 0;
      rect.vy = 0;
    } else {
      rect.vy += gravity * dt;

      rect.x += rect.vx * dt;
      rect.y += rect.vy * dt;

      rect.angle += rect.angularVelocity * dt;
    }
  }

  // Collision
  // Circle–Circle
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      if (checkCircleCircle(circles[i], circles[j])) {
        resolveCircleCircle(circles[i], circles[j]);
      }
    }
  }
  
  // Circle–Rectangle
  for (const circle of circles) {
    for (const rect of rectangles) {
      if (checkCircleRectangle(circle, rect)) {
        resolveCircleRectangle(circle, rect);
      }
    }
  }

  // Apply drag
  for (const circle of circles) {
    if (!circle.anchored) {
      circle.vx *= Math.pow(1 - drag, dt * 60);
      circle.vy *= Math.pow(1 - drag, dt * 60);
    }
  }

  for (const rect of rectangles) {
    if (!rect.anchored) {
      rect.vx *= Math.pow(1 - drag, dt * 60);
      rect.vy *= Math.pow(1 - drag, dt * 60);
      rect.angularVelocity *= Math.pow(1 - drag, dt * 60);
    }
  }
}


function drawCircles() {
  ctx.strokeStyle = circleStroke;
  ctx.lineWidth = circleStrokeWidth;
  
  for(const circle of circles) {
    if (!circle.visible && !isPaused) continue;

    if (circle.anchored) ctx.fillStyle = anchoredCircleFill;
    else ctx.fillStyle = circleFill;

    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

function drawRectangles() {
  ctx.fillStyle = rectFill;
  ctx.strokeStyle = rectStroke
  ctx.lineWidth = rectStrokeWidth;

  for (const rect of rectangles) {
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.rotate(rect.angle);
    ctx.beginPath();
    ctx.rect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawSprings() {
  ctx.lineWidth = springWidth;
  ctx.lineCap = "round";

  for (const spring of springs) {
    if (!spring.visible && !isPaused) continue;

    let color = springColor;

    if (showStress && !spring.rigid) {
      const dx = spring.b.x - spring.a.x;
      const dy = spring.b.y - spring.a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const stretch = dist - spring.restLength;

      const maxStretch = spring.restLength * 0.5; // tweak sensitivity
      const normalized = Math.max(-1, Math.min(1, stretch / maxStretch));

      // Gradient: red (compressed) → white → blue (stretched)
      const r = normalized < 0 ? 255 : Math.round(255 * (1 - normalized));
      const g = Math.round(255 * (1 - Math.abs(normalized)));
      const b = normalized > 0 ? 255 : Math.round(255 * (1 + normalized));

      color = `rgb(${r},${g},${b})`;
    }

    ctx.strokeStyle = spring.rigid ? rigidSpringColor : color;

    ctx.beginPath();
    ctx.moveTo(spring.a.x, spring.a.y);
    ctx.lineTo(spring.b.x, spring.b.y);
    ctx.stroke();
  }
}

function checkCircleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < a.radius + b.radius;
}

function resolveCircleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.0001) return;

  const overlap = a.radius + b.radius - dist;
  if (overlap <= 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  const ma = a.mass ?? 1;
  const mb = b.mass ?? 1;
  const invMassA = a.anchored ? 0 : 1 / ma;
  const invMassB = b.anchored ? 0 : 1 / mb;
  const totalInvMass = invMassA + invMassB;

  // Position correction
  if (totalInvMass > 0) {
    const correction = overlap / totalInvMass;
    if (!a.anchored) {
      a.x -= nx * correction * invMassA;
      a.y -= ny * correction * invMassA;
    }
    if (!b.anchored) {
      b.x += nx * correction * invMassB;
      b.y += ny * correction * invMassB;
    }
  }

  // Velocity reflection
  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const dot = dvx * nx + dvy * ny;
  if (dot > 0) return;

  const restitution = Math.min(a.restitution, b.restitution);
  const impulseMag = -(1 + restitution) * dot / totalInvMass;

  const impulseX = impulseMag * nx;
  const impulseY = impulseMag * ny;

  if (!a.anchored) {
    a.vx -= impulseX * invMassA;
    a.vy -= impulseY * invMassA;
  }
  if (!b.anchored) {
    b.vx += impulseX * invMassB;
    b.vy += impulseY * invMassB;
  }
}


function checkCircleRectangle(circle, rect) {
  const cos = Math.cos(-rect.angle);
  const sin = Math.sin(-rect.angle);
  const dx = circle.x - rect.x;
  const dy = circle.y - rect.y;

  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestY = Math.max(-halfH, Math.min(localY, halfH));

  const distX = localX - closestX;
  const distY = localY - closestY;
  const distSq = distX * distX + distY * distY;

  return distSq < circle.radius * circle.radius;
}

function resolveCircleRectangle(circle, rect) {
  const cos = Math.cos(-rect.angle);
  const sin = Math.sin(-rect.angle);
  const dx = circle.x - rect.x;
  const dy = circle.y - rect.y;

  // Transform circle center into rectangle's local space
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  // --- Containment check: circle center inside rectangle ---
  const inside =
    localX > -halfW && localX < halfW &&
    localY > -halfH && localY < halfH;

  if (inside) {
    // Distances to each side
    const distLeft   = localX + halfW;
    const distRight  = halfW - localX;
    const distTop    = localY + halfH;
    const distBottom = halfH - localY;

    // Find nearest side
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    let nx = 0, ny = 0;
    if (minDist === distLeft)   { nx = -1; ny = 0; }
    else if (minDist === distRight) { nx = 1; ny = 0; }
    else if (minDist === distTop)   { nx = 0; ny = -1; }
    else if (minDist === distBottom){ nx = 0; ny = 1; }

    // Transform normal back to world space
    const worldNX = nx * cos + ny * sin;
    const worldNY = -nx * sin + ny * cos;

    // Push circle out by the amount of overlap
    if (!circle.anchored) {
      circle.x += worldNX * minDist;
      circle.y += worldNY * minDist;
    }

    // Reflect velocity
    const dot = circle.vx * worldNX + circle.vy * worldNY;
    if (dot < 0) {
      const restitution = Math.min(circle.restitution, rect.restitution);
      circle.vx -= (1 + restitution) * dot * worldNX;
      circle.vy -= (1 + restitution) * dot * worldNY;
    }

    return; // containment handled
  }

  // --- Closest point test (standard circle vs rectangle edge) ---
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestY = Math.max(-halfH, Math.min(localY, halfH));

  const distX = localX - closestX;
  const distY = localY - closestY;
  const distSq = distX * distX + distY * distY;
  if (distSq >= circle.radius * circle.radius || distSq < 0.0001) return;

  const dist = Math.sqrt(distSq);
  const overlap = circle.radius - dist;
  if (overlap <= 0) return;

  const nx = distX / dist;
  const ny = distY / dist;

  // Transform normal back to world space
  const worldNX = nx * cos + ny * sin;
  const worldNY = -nx * sin + ny * cos;

  // Reflect velocity
  const dot = circle.vx * worldNX + circle.vy * worldNY;
  if (dot > 0) return;

  const restitution = Math.min(circle.restitution, rect.restitution);
  circle.vx -= (1 + restitution) * dot * worldNX;
  circle.vy -= (1 + restitution) * dot * worldNY;

  // Position correction
  if (!circle.anchored) {
    circle.x += worldNX * overlap;
    circle.y += worldNY * overlap;
  }
}


function createSoftbodyGrid(rows, cols, spacing, startX, startY, options = {}) {
  const {
    radius = 10,
    anchorEdges = false,
    springConfig = {
      stiffness: 2000,
      damping: 20.0, // reduce oscillation
      restLength: spacing, // match grid spacing
      visible: false,
      collides: false,
      sidesCollides: true,
      elasticLimit: null, // indestructible
      restitution: 0.9,
      rigidFrame: true
    }

  } = options;

  const nodeMatrix = [];

  for (let row = 0; row < rows; row++) {
    nodeMatrix[row] = [];
    for (let col = 0; col < cols; col++) {
      const x = startX + col * spacing;
      const y = startY + row * spacing;
      const anchored = false; // force unanchored

      const circle = new Circle(x, y, radius, anchored);
      circles.push(circle);
      nodeMatrix[row][col] = circle;
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const current = nodeMatrix[row][col];
      
      const horizontalCollides = (row === 0 || row === rows - 1) ? springConfig.sidesCollides : springConfig.collides;
      const verticalCollides = (col === 0 || col === cols - 1) ? springConfig.sidesCollides : springConfig.collides;
      const diagonalCollides = springConfig.collides;

      if (col < cols - 1) {
        const right = nodeMatrix[row][col + 1];
        new Spring(current, right, spacing, springConfig.stiffness, springConfig.damping, springConfig.rigidFrame, horizontalCollides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      if (row < rows - 1) {
        const below = nodeMatrix[row + 1][col];
        new Spring(current, below, spacing, springConfig.stiffness, springConfig.damping, springConfig.rigidFrame, verticalCollides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      // diagonals
      if (row < rows - 1 && col < cols - 1) {
        new Spring(current, nodeMatrix[row + 1][col + 1], Math.sqrt(2) * spacing, springConfig.stiffness, springConfig.damping, false, diagonalCollides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      if (row < rows - 1 && col > 0) {
        new Spring(current, nodeMatrix[row + 1][col - 1], Math.sqrt(2) * spacing, springConfig.stiffness, springConfig.damping, false, diagonalCollides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }
    }
  }

  return nodeMatrix;
}

// Tools
let currentTool = "none";
let selectedObjects = []; // circles and springs

function setTool(toolName) {
  currentTool = toolName;

  const selectOptions = document.getElementById("selectToolOptions");
  if (selectOptions) {
    selectOptions.style.display = toolName === "select" ? "block" : "none";
  }

  if (toolName !== "paste") pastePreview = [];
  if (toolName === "select" || toolName === "none" || toolName === "spring" || toolName === "circle") clearSelection();
}

function selectObject(obj) {
  if (!selectedObjects.includes(obj)) {
    selectedObjects.push(obj);
    obj.selected = true;
  }
}

function clearSelection() {
  selectedObjects.forEach(obj => obj.selected = false);
  selectedObjects = [];
}

function findObjectAt(x, y) {
  // Adjusts for pan offset
  const worldX = x - panX;
  const worldY = y - panY;

  // Check circles
  for (const c of circles) {
    const dx = worldX - c.x;
    const dy = worldY - c.y;
    if (dx * dx + dy * dy < c.radius * c.radius) {
      return c;
    }
  }

  // Check rectangles (if you use them)
  for (const r of rectangles ?? []) {
    const halfW = r.width / 2;
    const halfH = r.height / 2;
    if (
      worldX >= r.x - halfW &&
      worldX <= r.x + halfW &&
      worldY >= r.y - halfH &&
      worldY <= r.y + halfH
    ) {
      return r;
    }
  }

  // Check springs (click near midpoint)
  for (const s of springs) {
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    if (Math.hypot(mx - worldX, my - worldY) < 10) {
      return s;
    }
  }

  return null;
}


// Select box
let dragSelectStart = null;
let dragSelectEnd = null;

function handlePointerDown(e) {
  const x = e.offsetX;
  const y = e.offsetY;
  const clicked = findObjectAt(x, y);

  if (justOpenedMenu) {
    justOpenedMenu = false;
    return; // skip the click that opened the menu
  }

  const menu = document.getElementById("propertyMenu");
  if (propertyMenuOpen && !menu.contains(e.target)) {
    applyChangesAndClose();
  }

  // left click
  if (e.button === 0) {
    if (currentTool === "none") {
      if (clicked instanceof Circle) {
        draggingCircle = clicked;
        dragStartX = draggingCircle.x;
        dragStartY = draggingCircle.y;
      }
      return;
    }
    

    // Tool logic for other modes
    if (currentTool === "select" && !clicked) {
      dragSelectStart = { x, y };
      return;
    }

    if (currentTool === "pan") {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      return;
    }

    if (currentTool === "circle") {
      const worldX = e.offsetX - panX;
      const worldY = e.offsetY - panY;
      circles.push(new Circle(worldX, worldY, 20, false, 1, null, true, false));
    }

    if (currentTool === "softbody") {
      const worldX = e.offsetX - panX;
      const worldY = e.offsetY - panY;

      createSoftbodyGrid(
        softbodyConfig.rows,
        softbodyConfig.cols,
        softbodyConfig.spacing,
        worldX,
        worldY,
        {
          radius: softbodyConfig.radius,
          springConfig: { stiffness: 2500, damping: 20.0, restitution: 1, visible: true, collides: true, elasticLimit: 9999, rigidFrame: true }
        }
      );
    }


    switch (currentTool) {
      case "select":
        if (clicked) {
          const matchesFilter =
            selectFilter === "any" ||
            (selectFilter === "circle" && clicked instanceof Circle) ||
            (selectFilter === "spring" && clicked instanceof Spring);

          if (matchesFilter) {
            if (!e.shiftKey && !e.ctrlKey) clearSelection();
            selectObject(clicked);
          }
        } else {
          clearSelection();
        }
        break;

      case "move":
        if (selectedObjects.length > 0) {
          isDraggingSelection = true;
          dragStartX = x;
          dragStartY = y;
        }
        break;

      case "paste":
        if (clipboard.length > 0) {
          pasteClipboardAt(x, y);
        }
        break;

      case "spring":
        clearSelection();
        springStart = findObjectAt(x, y);
        break;
    }
  }

  // right click
  if (e.button === 2 && isPaused && currentTool === "none") {
    for (let circle of circles) {
      const dx = x - circle.x;
      const dy = y - circle.y;
      if (dx * dx + dy * dy < circle.radius * circle.radius) {
        springStartCircle = circle;
        isRightDragging = true;
        break;
      }
    }
  }
}
function handlePointerMove(e) {
  mouseX = e.offsetX;
  mouseY = e.offsetY;

  const worldX = e.offsetX - panX;
  const worldY = e.offsetY - panY;

  // Dragging a circle with the none tool
  if (currentTool === "none" && draggingCircle && !isPaused) {
    // update drag target, no position change
    dragStartX = worldX;
    dragStartY = worldY;
  }

  // Panning the canvas
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panX += dx;
    panY += dy;
    panStartX = e.clientX;
    panStartY = e.clientY;
  }


  // Paste preview offset
  if (currentTool === "paste" && clipboard && clipboard.length > 0) {
    const circlesOnly = clipboard.filter(obj => obj instanceof Circle);
    const minX = Math.min(...circlesOnly.map(c => c.x));
    const minY = Math.min(...circlesOnly.map(c => c.y));
    pasteOffsetX = worldX - minX;
    pasteOffsetY = worldY - minY;
  }

  // Box select preview
  if (currentTool === "select" && dragSelectStart) {
    dragSelectEnd = { x: worldX, y: worldY };
  }

  // Spring preview line
  if (currentTool === "spring" && springStart) {
    springPreviewEnd = { x: worldX, y: worldY };
  }

  // Circle preview
  if (currentTool === "circle") {
    const worldX = e.offsetX - panX;
    const worldY = e.offsetY - panY;
    circlePreview = { x: worldX, y: worldY, radius: 20 };
  }

  // Softbody preview:
  if (currentTool === "softbody") {
    const worldX = e.offsetX - panX;
    const worldY = e.offsetY - panY;
    softbodyPreview = [];

    for (let row = 0; row < softbodyConfig.rows; row++) {
      for (let col = 0; col < softbodyConfig.cols; col++) {
        const x = worldX + col * softbodyConfig.spacing;
        const y = worldY + row * softbodyConfig.spacing;
        softbodyPreview.push({ x, y });
      }
    }
  }


  // Dragging selected objects
  if (isDraggingSelection) {
    const dx = worldX - dragStartX;
    const dy = worldY - dragStartY;
    selectedObjects.forEach(obj => {
      if (obj instanceof Circle) {
        obj.x += dx;
        obj.y += dy;
      }
    });
    dragStartX = worldX;
    dragStartY = worldY;
  }
}
function handlePointerUp(e) {
  const mouseX = e.offsetX;
  const mouseY = e.offsetY;

  const worldX = mouseX - panX;
  const worldY = mouseY - panY;

  draggingCircle = null;

  if (currentTool === "move") {
    isDraggingSelection = false;
  }

  if (currentTool === "pan") {
    isPanning = false;

  }

  if (currentTool === "spring" && springStart) {
    const springEnd = findObjectAt(worldX, worldY);

    if (
      springEnd &&
      springEnd !== springStart &&
      springStart instanceof Circle &&
      springEnd instanceof Circle
    ) {
      const dx = springEnd.x - springStart.x;
      const dy = springEnd.y - springStart.y;
      const dist = Math.hypot(dx, dy);

      console.assert(springStart instanceof Circle, "springStart is not a Circle:", springStart);
      console.assert(springEnd instanceof Circle, "springEnd is not a Circle:", springEnd);

      const newSpring = new Spring(
        springStart,
        springEnd,
        1,       // restitution
        500,     // stiffness
        5.0,     // damping
        false,   // rigid
        false,   // collides
        1,       // thickness
        10000,   // elasticLimit
        true,    // visible
        false    // ghost
      );

      newSpring.restLength = dist;

      springs.push(newSpring);
      clearSelection();
      selectObject(newSpring);

      const cx = (springStart.x + springEnd.x) / 2;
      const cy = (springStart.y + springEnd.y) / 2;
      openPropertyMenu(newSpring, "spring", cx, cy);
    }

    springStart = null;
  }



  if (dragSelectStart) {
    const x1 = Math.min(dragSelectStart.x, worldX);
    const y1 = Math.min(dragSelectStart.y, worldY);
    const x2 = Math.max(dragSelectStart.x, worldX);
    const y2 = Math.max(dragSelectStart.y, worldY);

    clearSelection();

    if (selectFilter === "any" || selectFilter === "circle") {
      circles.forEach(c => {
        if (c.x > x1 && c.x < x2 && c.y > y1 && c.y < y2) selectObject(c);
      });
    }

    if (selectFilter === "any" || selectFilter === "spring") {
      springs.forEach(s => {
        const mx = (s.a.x + s.b.x) / 2;
        const my = (s.a.y + s.b.y) / 2;
        if (mx > x1 && mx < x2 && my > y1 && my < y2) selectObject(s);
      });
    }

    dragSelectStart = null;
    dragSelectEnd = null;
    isDraggingSelection = false;
  }
}


function deleteSelected() {
  selectedObjects.forEach(obj => {
    if (obj instanceof Circle) {
      circles = circles.filter(c => c !== obj);
      springs = springs.filter(s => s.a !== obj && s.b !== obj);
    } else if (obj instanceof Spring) {
      springs = springs.filter(s => s !== obj);
    }
  });
  clearSelection();
}

function copySelected() {
  if (selectedObjects.length > 0) {
    clipboard = [...selectedObjects];
    console.log("Copied", clipboard.length, "objects");
  }
}

function pasteClipboardAt(x, y) {
  const circleMap = new Map();
  const pasted = [];

  const circlesOnly = clipboard.filter(obj => obj instanceof Circle);
  const minX = Math.min(...circlesOnly.map(c => c.x));
  const minY = Math.min(...circlesOnly.map(c => c.y));
  const offsetX = x - minX;
  const offsetY = y - minY;

  clipboard.forEach(obj => {
    const clone = cloneObject(obj, offsetX, offsetY, circleMap, false); // ghost = false
    console.log("Cloned", clone, "ghost =", clone.ghost);
    pasted.push(clone);
  });

  clearSelection();
  pasted.forEach(selectObject);
}

function cloneObject(obj, offsetX = 0, offsetY = 0, circleMap = new Map(), ghost = true) {
  if (obj instanceof Circle) {
    if (circleMap.has(obj)) return circleMap.get(obj);
    const clone = new Circle(
      obj.x + offsetX,
      obj.y + offsetY,
      obj.radius,
      obj.anchored,
      obj.restitution,
      obj.mass,
      obj.visible,
      ghost
    );
    circleMap.set(obj, clone);
    return clone;
  }

  if (obj instanceof Spring) {
    const a = cloneObject(obj.a, offsetX, offsetY, circleMap, ghost);
    const b = cloneObject(obj.b, offsetX, offsetY, circleMap, ghost);

    if (!a || !b) {
      console.warn("Skipping spring with missing endpoints:", obj);
      return null;
    }

    const springClone = new Spring(
      a,
      b,
      obj.restLength,
      obj.stiffness,
      obj.damping,
      obj.rigid,
      obj.collides,
      obj.restitution,
      obj.elasticLimit,
      obj.visible,
      ghost
    );
    return springClone;
  }
}

function showProperties() {
  if (selectedObjects.length === 0) return;

  const first = selectedObjects[0];
  const type = first instanceof Circle ? "circle" :
               first instanceof Spring ? "spring" :
               first instanceof Rectangle ? "rectangle" : null;

  if (!type) return;

  const allSameType = selectedObjects.every(obj =>
    (type === "circle" && obj instanceof Circle) ||
    (type === "spring" && obj instanceof Spring) ||
    (type === "rectangle" && obj instanceof Rectangle)
  );

  const x = canvas.width / 2;
  const y = canvas.height / 2;

  if (allSameType) {
    openPropertyMenu(null, type, x, y); // batch edit
  } else {
    alert("Cannot edit properties of objects of different types");
    //openPropertyMenu(first, type, x, y); // fallback to single edit
  }
}


// Property menu
let tempProps = {}; // make sure this is accessible globally or in shared scope
function openPropertyMenu(obj, type, x, y) {
  if(!isPaused) {
    isPaused = true;
    document.getElementById("pauseIcon").style.display = isPaused ? "block" : "none";
    console.log("Simulation paused:", isPaused);
  }

  selectedObject = { ref: obj, type };
  propertyMenuOpen = true;
  tempProps = {};

  const menu = document.getElementById("propertyMenu");
  menu.innerHTML = "";
  menu.style.position = "absolute";
  menu.style.background = "rgba(0, 0, 0, 0.9)";
  menu.style.border = "1px solid #666";
  menu.style.padding = "10px";
  menu.style.color = "#fff";
  menu.style.zIndex = "20";

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "4px";
  closeBtn.style.right = "4px";
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.fontSize = "16px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.color = "#fff";
  closeBtn.addEventListener("click", applyChangesAndClose);
  menu.appendChild(closeBtn);

  // Use sample object to infer fields
  const sample = obj ?? selectedObjects[0];
  const props = Object.keys(sample).filter(k => typeof sample[k] !== "function");

  props.forEach(key => {
    // detect shared values
    let sharedValue = null;
    let allMatch = true;

    for (let i = 1; i < selectedObjects.length; i++) {
      const a = selectedObjects[0][key];
      const b = selectedObjects[i][key];
      if (a !== b) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      sharedValue = selectedObjects[0][key];
    }
    tempProps[key] = obj ? obj[key] : (sharedValue ?? "");

    let input;
    if (typeof sample[key] === "boolean") {
      input = document.createElement("select");
      input.id = `prop-${key}`;
      input.name = key;

      const optSkip = document.createElement("option");
      optSkip.value = "";
      optSkip.textContent = "(skip)";
      input.appendChild(optSkip);

      const optTrue = document.createElement("option");
      optTrue.value = "true";
      optTrue.textContent = "true";
      input.appendChild(optTrue);

      const optFalse = document.createElement("option");
      optFalse.value = "false";
      optFalse.textContent = "false";
      input.appendChild(optFalse);

      input.value = obj ? (obj[key] ? "true" : "false") :
                  sharedValue === true ? "true" :
                  sharedValue === false ? "false" : "";
    } else {
      input = document.createElement("input");
      input.value = obj ? obj[key] : (sharedValue ?? "");
      input.placeholder = obj ? "" : "(leave blank to skip)";
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") applyChangesAndClose();
      });
    }


    input.dataset.key = key;
    input.id = `prop-${key}`;
    input.name = key;

    const label = document.createElement("label");
    label.textContent = key + ": ";
    label.htmlFor = input.id;
    label.style.display = "block";
    label.appendChild(input);
    menu.appendChild(label);
  });

  justOpenedMenu = true;
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.style.display = "block";
}


function applyChangesAndClose() {
  const menu = document.getElementById("propertyMenu");
  if (!menu || selectedObjects.length === 0) return;

  const type = selectedObject?.type;
  const isBatch = selectedObject?.ref === null;

  selectedObjects.forEach(obj => {
    if ((type === "circle" && !(obj instanceof Circle)) ||
        (type === "spring" && !(obj instanceof Spring)) ||
        (type === "rectangle" && !(obj instanceof Rectangle))) return;

    const keys = Object.keys(obj).filter(k =>
      typeof obj[k] !== "function" &&
      k !== "a" &&
      k !== "b"
    );

    keys.forEach(key => {
      const input = document.getElementById(`prop-${key}`);
      if (!input) return;

      let val = input.value;

      if (typeof obj[key] === "boolean") {
        // if using a <select> for booleans
        if (input.tagName === "SELECT") {
          if (input.value === "") return; // skip if "(skip)" selected
          val = input.value === "true";
        } else {
          // fallback for checkbox (single-object edit)
          val = input.checked;
        }
      } else {
        if (val === "") return; // skip empty fields
        const num = parseFloat(val);
        if (!isNaN(num)) val = num;
      }

      obj[key] = val;
    });
  });

  menu.style.display = "none";
  selectedObject = null;
  propertyMenuOpen = false;
}


// Actions
document.addEventListener("keydown", (e) => {
  if (isPaused) {
    draggingCircle = null; // prevent accidental toggling
  }
  if (propertyMenuOpen) return; // don't trigger shortcuts while menu is open

  if (e.key === "Escape") {
    isPaused = !isPaused;
    document.getElementById("pauseIcon").style.display = isPaused ? "block" : "none";

    console.log("Simulation paused:", isPaused);

    if (!isPaused && propertyMenuOpen) {
      applyChangesAndClose();
    }
  }

  if (e.key === "a" && draggingCircle) {
    draggingCircle.anchored = !draggingCircle.anchored;
    console.log("Anchor toggled:", draggingCircle.anchored);
  }

  if ((e.key === "Backspace" || e.key === "Delete") && selectedObjects.length > 0) {
    e.preventDefault();
    deleteSelected();
  }

  // ctrl C and ctrl V
  if (e.ctrlKey && e.key === "c") {
    e.preventDefault(); // prevent browser copy
    copySelected();
  }

  if (e.ctrlKey && e.key === "v") {
    e.preventDefault(); // prevent browser paste
    setTool("paste");
  }

  // press 's' to set tool to spring
  if (e.key === "s") {
    setTool("spring");
  }
});


window.addEventListener("contextmenu", e => {
  e.preventDefault();
});


document.addEventListener("wheel", (e) => {
  const delta = Math.sign(e.deltaY); // -1 = up, 1 = down

  // Scroll up → increase strength, down → decrease
  mouseStrength = mouseStrength * (1 - (0.1 * delta));

  // Clamp to reasonable range
  mouseStrength = Math.max(0.1, Math.min(25, mouseStrength));

  console.log("Mouse strength:", mouseStrength.toFixed(2));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    windowFocused = false;
  } else {
    windowFocused = true;
    lastTime = performance.now(); // reset clock
  }
});

function renderSelection() {
  selectedObjects.forEach(obj => {
    if (obj instanceof Circle) {
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj instanceof Spring) {
      ctx.strokeStyle = "orange";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(obj.a.x, obj.a.y);
      ctx.lineTo(obj.b.x, obj.b.y);
      ctx.stroke();
    }
  });
}

function renderBoxSelect() {
  if (currentTool === "select" && dragSelectStart && dragSelectEnd) {
    const x = Math.min(dragSelectStart.x, dragSelectEnd.x);
    const y = Math.min(dragSelectStart.y, dragSelectEnd.y);
    const w = Math.abs(dragSelectEnd.x - dragSelectStart.x);
    const h = Math.abs(dragSelectEnd.y - dragSelectStart.y);

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

function renderToolOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(canvas.width - 200, 10, 150, 30);
  ctx.fillStyle = "white";
  ctx.font = "16px sans-serif";
  ctx.fillText("Tool: " + currentTool, canvas.width - 190, 30);
}

function renderPastePreview() {
  if (!clipboard) return;
  if (currentTool === "paste" && clipboard.length > 0) {
    const circleMap = new Map();
    const circlesOnly = clipboard.filter(obj => obj instanceof Circle);
    const minX = Math.min(...circlesOnly.map(c => c.x));
    const minY = Math.min(...circlesOnly.map(c => c.y));

    const offsetX = pasteOffsetX;
    const offsetY = pasteOffsetY;

    // Clone circles for preview
    circlesOnly.forEach(obj => {
      const ghost = new Circle(
        obj.x + offsetX,
        obj.y + offsetY,
        obj.radius,
        obj.anchored,
        obj.restitution,
        obj.mass,
        obj.visible,
        true // ghost flag
      );
      circleMap.set(obj, ghost);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "cyan";
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, ghost.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });

    // Clone springs for preview
    clipboard.forEach(obj => {
      if (obj instanceof Spring) {
        const a = circleMap.get(obj.a);
        const b = circleMap.get(obj.b);
        if (a && b) {
          const springGhost = new Spring(
            a,
            b,
            obj.length,
            obj.stiffness,
            obj.damping,
            obj.rigid,
            obj.collides,
            obj.restitution,
            obj.elasticLimit,
            obj.visible,
            true // ghost flag
          );
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = "cyan";
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }
      }
    });
  }
}

function renderCirclePreview() {
  if (currentTool === "circle" && circlePreview) {
    ctx.save();
    ctx.translate(panX, panY);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(circlePreview.x, circlePreview.y, circlePreview.radius, 0, Math.PI * 2);
    ctx.fillStyle = "cyan";
    ctx.fill();
    ctx.restore();
  }
}

function renderSoftbodyPreview() {
  if (currentTool === "softbody" && softbodyPreview) {
    ctx.save();
    ctx.translate(panX, panY);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "cyan";
    for (const node of softbodyPreview) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, softbodyConfig.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function showFPS() {
  ctx.font = "20px Arial";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText("FPS: " + Math.round(fps), 25, 25);
}

function render() {
  ctx.save();
  ctx.translate(panX, panY);

  drawSprings();
  drawRectangles();
  drawCircles();
  renderSelection();

  // Dragging lines
  if (draggingCircle) {
    ctx.beginPath();
    ctx.moveTo(mouseX, mouseY);
    ctx.lineTo(draggingCircle.x, draggingCircle.y);
    ctx.strokeStyle = "rgba(21, 255, 0, 0.36)"; // green line with transparency
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  if (currentTool === "spring" && springStart && springPreviewEnd) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(springStart.x, springStart.y);
    ctx.lineTo(springPreviewEnd.x, springPreviewEnd.y);
    ctx.stroke();
  }

  renderSoftbodyPreview();
  renderCirclePreview();
  renderPastePreview();
  renderBoxSelect();

  ctx.restore();
  // out of world UI
  renderToolOverlay();
  showFPS();
}

function clearScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}


function createRope(start, end, segmentCount, slack = 0) {
  const nodes = [start];
  const dx = (end.x - start.x) / segmentCount;
  const dy = (end.y - start.y) / segmentCount;

  for (let i = 1; i < segmentCount; i++) {
    const t = i / segmentCount;
    const x = start.x + dx * i;
    const y = start.y + dy * i + Math.sin(t * Math.PI) * slack;

    const node = new Circle(x, y, 5);
    nodes.push(node);
  }

  nodes.push(end);

  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);

    springs.push(new Spring(
      a,
      b,
      dist,
      1000,        // stiffness (rigid)
      50,          // damping (rigid)
      true,        // rigid
      true,        // collides
      0.1,         // restitution
      null,        // elasticLimit (indestructible)
      true         // visible
    ));
  }
}

function saveGameState() {
  // Filter out ghost or unintended circles if needed
  const savedCircles = circles.filter(c => !c.ghost);

  // Create a stable ID map
  const circleIdMap = new Map();
  savedCircles.forEach((c, i) => circleIdMap.set(c, i));

  const data = {
    circles: savedCircles.map(c => ({
      x: c.x,
      y: c.y,
      radius: c.radius,
      anchored: c.anchored,
      restitution: c.restitution,
      mass: c.mass,
      visible: c.visible,
      ghost: false
    })),
    springs: springs
      .filter(s => circleIdMap.has(s.a) && circleIdMap.has(s.b)) // only save springs with valid endpoints
      .map(s => ({
        aIndex: circleIdMap.get(s.a),
        bIndex: circleIdMap.get(s.b),
        restLength: s.restLength,
        stiffness: s.stiffness,
        damping: s.damping,
        rigid: s.rigid,
        collides: s.collides,
        restitution: s.restitution,
        elasticLimit: s.elasticLimit,
        visible: s.visible,
        ghost: false
      })),
    rectangles: rectangles.map(r => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      angle: r.angle,
      anchored: r.anchored ?? true,
      restitution: r.restitution
    })),
    settings: { panX, panY, currentTool }
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sandbox-save.json";
  a.click();
  URL.revokeObjectURL(url);
}

function loadGameState(file) {
  const reader = new FileReader();
  reader.onload = () => {
    circles = [];
    springs = [];
    rectangles = [];

    const data = JSON.parse(reader.result);

    // Rebuild circles first
    circles = data.circles.map(c => new Circle(
      c.x, c.y, c.radius,
      c.anchored, c.restitution,
      c.mass, c.visible,
      c.ghost
    ));

    // Rebuild springs using valid indices
    springs = data.springs.map(s => {
      const a = circles[s.aIndex];
      const b = circles[s.bIndex];
      if (!a || !b) {
        console.warn("Invalid spring endpoints:", s.aIndex, s.bIndex);
        return null;
      }
      return new Spring(
        a, b,
        s.restLength,
        s.stiffness,
        s.damping,
        s.rigid,
        s.collides,
        s.restitution,
        s.elasticLimit,
        s.visible,
        s.ghost
      );
    }).filter(s => s !== null);

    // Rebuild rectangles
    rectangles = data.rectangles.map(r => new Rectangle(
      r.x, r.y, r.width, r.height,
      r.angle, r.anchored, r.restitution
    ));

    panX = data.settings.panX;
    panY = data.settings.panY;
    currentTool = data.settings.currentTool;
  };
  reader.readAsText(file);
}

function openEnvSettings() {
  // Get references to inputs
  const fpsInput = document.getElementById("targetFPSInput");
  const gravityInput = document.getElementById("gravityInput");
  const speedInput = document.getElementById("speedInput");
  const airInput = document.getElementById("airInput");
  const frameMultiplierCheckbox = document.getElementById("frameMultiplierCheckbox");

  // Populate with current engine values
  fpsInput.value = targetFPS;
  gravityInput.value = gravity;
  speedInput.value = speed;
  airInput.value = drag;
  frameMultiplierCheckbox.checked = adaptiveFrameMultiplier;

  // Show the menu
  document.getElementById("envSettings").style.display = "block";
}

function closeEnvSettings() {
  document.getElementById("envSettings").style.display = "none";
}

function applyEnvSettings() {
  // Read values from inputs
  targetFPS = parseInt(document.getElementById("targetFPSInput").value, 10);
  gravity = parseFloat(document.getElementById("gravityInput").value);
  speed = parseFloat(document.getElementById("speedInput").value);
  drag = parseFloat(document.getElementById("airInput").value);
  adaptiveFrameMultiplier = document.getElementById("frameMultiplierCheckbox").checked;

  // Save values to localStorage
  localStorage.setItem("targetFPS", targetFPS);
  localStorage.setItem("gravity", gravity);
  localStorage.setItem("speed", speed);
  localStorage.setItem("drag", drag);
  localStorage.setItem("adaptiveFrameMultiplier", adaptiveFrameMultiplier);

  closeEnvSettings();
}



// semi-elastic square
let circle1 = new Circle(100, 200, 35, false, 1);
let circle2 = new Circle(200, 500, 35, false, 1);
let circle3 = new Circle(400, 250, 35, false, 1);
let circle4 = new Circle(400, 150, 35, false, 1);

let spring1 = new Spring(circle1, circle2, 150, 3000, 30.0, true, true, 0.9);
let spring2 = new Spring(circle2, circle3, 150, 3000, 30.0, true, true, 0.9);
let spring3 = new Spring(circle3, circle4, 150, 3000, 30.0, true, true, 0.9);
let spring4 = new Spring(circle4, circle1, 150, 3000, 30.0, true, true, 0.9);

let diagonal1 = new Spring(circle1, circle3, 150 * Math.sqrt(2), 500, 5.0, false);
let diagonal2 = new Spring(circle2, circle4, 150 * Math.sqrt(2), 500, 5.0, false);


// soft square grid
createSoftbodyGrid(8, 8, 50, canvas.width/2, 0, {
  radius: 8,
  anchorEdges: false,
  springConfig: { stiffness: 2000, damping: 30.0, restitution: 1, visible: true, collides: true, sidesCollides: true, elasticLimit: 5, rigidFrame: false }
});

// rope
/*
let ropeStart = new Circle(50, 200, 10, true);
let ropeEnd = new Circle(canvas.width - 50, 500, 10, true);
createRope(ropeStart, ropeEnd, 15, 50);
*/

// slope
// let slope = new Rectangle(900, 600, 1000, 20, -Math.PI / 1.1, true);


// boundaries
let floor = new Rectangle(
  canvas.width / 2,
  canvas.height + 500,
  10000,
  1000
);
let leftWall = new Rectangle(
  -500,
  canvas.height / 2,
  1000,
  10000
);
let rightWall = new Rectangle(
  canvas.width + 500,
  canvas.height / 2,
  1000,
  10000
);
let ceiling = new Rectangle(
  canvas.width / 2,
  -500,
  10000,
  1000
);

/*
for(let i = 0; i < 10; i++) {
  new Circle(
    Math.random() * canvas.width,
    Math.random() * canvas.height,
    10
  );
}
*/

canvas.addEventListener("mousedown", handlePointerDown);
canvas.addEventListener("mousemove", handlePointerMove);
canvas.addEventListener("mouseup", handlePointerUp);

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  handlePointerDown(e);
});
canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  handlePointerMove(e);
});
canvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  handlePointerUp(e);
});



function mainLoop() {
  const maxFrameTime = 0.05; // 20 FPS floor
  
  const now = performance.now();
  let deltaTime = (now - lastTime) / 1000; // seconds
  deltaTime = Math.max(0.0001, Math.min(deltaTime, maxFrameTime)); // to prevent division by 0
  lastTime = now;
  deltaTime = Math.min(deltaTime, maxFrameTime); // clamp to avoid large jumps and when resuming from tab switch

  const alpha = 0.2; // fps smoothing factor
  fps = fps * (1 - alpha) + (1 / deltaTime) * alpha;


  if(adaptiveFrameMultiplier) {
    if (fps > targetFPS) {
      // Running faster than target -> add physics steps
      frameMultiplier += Math.round(Math.abs(targetFPS - fps));
    } else if (fps < targetFPS) {
      // Running slower than target -> remove physics steps
      frameMultiplier -= Math.round(Math.abs(targetFPS - fps));
    }
    frameMultiplier = Math.min(Math.max(frameMultiplier, 1), 100); // Max of 100, min of 1
  }

  // Simulation deltaTime is scaled by speed
  const simDelta = (deltaTime * speed) / frameMultiplier;
  
  if(!isPaused && windowFocused) {
    for (let i = 0; i < frameMultiplier; i++) {
      simulate(simDelta);
    }

    if (draggingCircle && !draggingCircle.anchored) {
      const dx = mouseX - draggingCircle.x;
      const dy = mouseY - draggingCircle.y;

      const mass = draggingCircle.mass ?? 1;

      // Apply force scaled by mouseStrength, then convert to acceleration
      draggingCircle.vx += (dx * mouseStrength) / mass;
      draggingCircle.vy += (dy * mouseStrength) / mass;
    }
  }

  clearScreen();
  render();

  requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);