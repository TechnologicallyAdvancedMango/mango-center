const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});


let fps = 60;
let frameMultiplier = 20;

let showStress = true; // or false to disable

let mouseStrength = 5.0;

let isPaused = false;

let lastTime = performance.now();

let gravity = 1000;
let drag = 0.01;

let mouseX = 0;
let mouseY = 0;
let draggingCircle = null;

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
let springWidth = "5";

// Width used for collision detection
let springPhysicalWidth = "5";

let circles = [];
let rectangles = [];
let springs = [];

class Circle {
  constructor(x, y, radius, anchored = false, restitution = 1, mass = null, visible = true) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.anchored = anchored;
    this.restitution = restitution;
    this.visible = visible;

    // If no mass provided, derive it from radius
    this.mass = mass !== null ? mass : Math.PI * radius * radius;
    this.mass *= 0.001; // scale mass down
    
    circles.push(this);
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
  constructor(a, b, restLength, stiffness, damping, rigid = false, collides = false, restitution = 0.8, elasticLimit = null, visible = true) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
    this.stiffness = stiffness;
    this.damping = damping;
    this.rigid = rigid;
    this.collides = collides;
    this.restitution = restitution
    this.elasticLimit = elasticLimit; // or set to a number like 3 for destructible springs
    this.visible = visible;

    springs.push(this);
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

    const totalForce = springForce + dampingForce;

    const fx = nx * totalForce;
    const fy = ny * totalForce;

    const ma = this.a.mass ?? 1;
    const mb = this.b.mass ?? 1;

    const totalMass = ma + mb;

    // Distribute force based on mass ratio
    const faRatio = mb / totalMass;
    const fbRatio = ma / totalMass;

    if (!this.a.anchored) {
      this.a.vx += fx * faRatio * dt / ma;
      this.a.vy += fy * faRatio * dt / ma;
    }
    if (!this.b.anchored) {
      this.b.vx -= fx * fbRatio * dt / mb;
      this.b.vy -= fy * fbRatio * dt / mb;
    }

    // Rigid constraint remains unchanged
    if (this.rigid) {
      const correction = this.restLength - dist;
      if (Math.abs(correction) > 0.01) {
        const maxCorrection = 20; // limit max correction
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
    const length = Math.sqrt(lengthSq);
    if (length === 0) return;

    const nx = dx / length;
    const ny = dy / length;

    // --- Circle collisions ---
    for (let circle of circles) {
      if (circle === this.a || circle === this.b) continue;

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
        const pushX = distX / dist * overlap;
        const pushY = distY / dist * overlap;

        if(!circle.anchored) {
          circle.x += pushX;
          circle.y += pushY;
        }

        const relVel = circle.vx * (distX / dist) + circle.vy * (distY / dist);
        if (relVel < 0) {
          const restitution = this.restitution;
          const nx = distX / dist;
          const ny = distY / dist;

          const ma = this.a.mass ?? 1;
          const mb = this.b.mass ?? 1;
          const mc = circle.mass ?? 1;

          const invMa = this.a.anchored ? 0 : 1 / ma;
          const invMb = this.b.anchored ? 0 : 1 / mb;
          const invMc = circle.anchored ? 0 : 1 / mc;

          const totalInvMass = invMa * (1 - t) ** 2 + invMb * t ** 2 + invMc;
          if (totalInvMass === 0) return;

          const impulseMag = -(1 + restitution) * relVel / totalInvMass;

          const impulseX = impulseMag * nx;
          const impulseY = impulseMag * ny;

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

      // Clamp spring projection to rectangle bounds
      const closestX = Math.max(rect.x - halfW, Math.min(this.a.x, rect.x + halfW));
      const closestY = Math.max(rect.y - halfH, Math.min(this.a.y, rect.y + halfH));

      const t = ((closestX - this.a.x) * dx + (closestY - this.a.y) * dy) / lengthSq;
      if (t < 0 || t > 1) continue;

      const springX = this.a.x + t * dx;
      const springY = this.a.y + t * dy;

      const distX = closestX - springX;
      const distY = closestY - springY;
      const distSq = distX * distX + distY * distY;
      const minDist = springPhysicalWidth; // spring thickness

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const overlap = minDist - dist;
        const nx = distX / dist;
        const ny = distY / dist;

        if (!rect.anchored) {
          rect.x += nx * overlap;
          rect.y += ny * overlap;

          const relVel = rect.vx * nx + rect.vy * ny;
          if (relVel < 0) {
            const bounce = -relVel * this.restitution;
            rect.vx += nx * bounce;
            rect.vy += ny * bounce;

            if (!this.a.anchored) {
              this.a.vx -= nx * bounce * (1 - t);
              this.a.vy -= ny * bounce * (1 - t);
            }
            if (!this.b.anchored) {
              this.b.vx -= nx * bounce * t;
              this.b.vy -= ny * bounce * t;
            }
          }
        }
      }
    }
  }
}

function simulate(dt) {
  for (const spring of springs) {
    spring.apply(dt);
    spring.collide(circles, rectangles);
  }

  for (const circle of circles) {
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

  // Transform to rectangle's local space
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
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

  // Position correction
  if (!circle.anchored) {
    circle.x += worldNX * overlap;
    circle.y += worldNY * overlap;
  }

  // Velocity reflection
  const dot = circle.vx * worldNX + circle.vy * worldNY;
  if (dot > 0) return;

  const restitution = Math.min(circle.restitution, rect.restitution);
  circle.vx -= (1 + restitution) * dot * worldNX;
  circle.vy -= (1 + restitution) * dot * worldNY;
}

function createSoftbodyGrid(rows, cols, spacing, startX, startY, options = {}) {
  const {
    radius = 10,
    anchorEdges = false,
    springConfig = {
      stiffness: 2000, // increase resistance to stretching
      damping: 20.0, // reduce oscillation
      restLength: spacing, // match grid spacing
      visible: false,
      collides: true,
      elasticLimit: null, // indestructible
      restitution: 0.3, // lower bounce to prevent jitter
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

      if (col < cols - 1) {
        const right = nodeMatrix[row][col + 1];
        new Spring(current, right, spacing, springConfig.stiffness, springConfig.damping, springConfig.rigidFrame, springConfig.collides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      if (row < rows - 1) {
        const below = nodeMatrix[row + 1][col];
        new Spring(current, below, spacing, springConfig.stiffness, springConfig.damping, springConfig.rigidFrame, springConfig.collides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      // diagonals
      if (row < rows - 1 && col < cols - 1) {
        new Spring(current, nodeMatrix[row + 1][col + 1], Math.sqrt(2) * spacing, springConfig.stiffness, springConfig.damping, false, springConfig.collides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }

      if (row < rows - 1 && col > 0) {
        new Spring(current, nodeMatrix[row + 1][col - 1], Math.sqrt(2) * spacing, springConfig.stiffness, springConfig.damping, false, springConfig.collides, springConfig.restitution, springConfig.elasticLimit, springConfig.visible);
      }
    }
  }

  return nodeMatrix;
}


// Property menu
let tempProps = {}; // make sure this is accessible globally or in shared scope
function openPropertyMenu(obj, type, x, y) {
  if (!isPaused) return;

  selectedObject = { ref: obj, type };
  propertyMenuOpen = true;
  tempProps = {};

  const menu = document.getElementById("propertyMenu");
  menu.innerHTML = "";

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

  const props = Object.keys(obj).filter(k => typeof obj[k] !== "function");

  props.forEach(key => {
    tempProps[key] = obj[key];

    let input;
    if (typeof obj[key] === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = obj[key];
    } else {
      input = document.createElement("input");
      input.value = obj[key];
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
    label.appendChild(input);
    menu.appendChild(label);
    menu.appendChild(document.createElement("br"));
  });

  justOpenedMenu = true;
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.style.display = "block";

  console.log("Opening menu at", x, y, "for", type);
}

function applyChangesAndClose() {
  const menu = document.getElementById("propertyMenu");
  const inputs = menu.querySelectorAll("input");

  inputs.forEach(input => {
    const key = input.dataset.key;

    // Skip spring endpoints
    if (selectedObject.type === "spring" && (key === "a" || key === "b")) return;

    let val = input.value;
    const original = selectedObject.ref[key];

    if (typeof original === "boolean") {
      val = input.checked;
    }else {
      const num = parseFloat(val);
      val = isNaN(num) ? val : num;
    }

    tempProps[key] = val;
  });

  if (selectedObject && selectedObject.ref) {
    Object.assign(selectedObject.ref, tempProps);
  }

  menu.style.display = "none";
  console.log("closed menu");
  selectedObject = null;
  propertyMenuOpen = false;
}

document.addEventListener("mousedown", (e) => {
  if (justOpenedMenu) {
    justOpenedMenu = false;
    return; // skip the click that opened the menu
  }

  const menu = document.getElementById("propertyMenu");
  if (propertyMenuOpen && !menu.contains(e.target)) {
    applyChangesAndClose();
  }
});


canvas.addEventListener("mousedown", (e) => {
  const x = e.offsetX;
  const y = e.offsetY;

  if (e.button === 0) { // left-click
    if (isPaused) {
      selectedObject = null;

      // Check circles
      for (let circle of circles) {
        const dx = x - circle.x;
        const dy = y - circle.y;
        if (dx * dx + dy * dy < circle.radius * circle.radius) {
          selectedObject = circle;
          openPropertyMenu(circle, "circle", e.offsetX, e.offsetY);
          return;
        }
      }

      // Check rectangles
      for (let rect of rectangles) {
        const halfW = rect.width / 2;
        const halfH = rect.height / 2;
        if (
          x >= rect.x - halfW &&
          x <= rect.x + halfW &&
          y >= rect.y - halfH &&
          y <= rect.y + halfH
        ) {
          selectedObject = rect;
          openPropertyMenu(rect, "rectangle", e.offsetX, e.offsetY);
          return;
        }
      }

      // Check springs
      for (let spring of springs) {
        const dx = spring.b.x - spring.a.x;
        const dy = spring.b.y - spring.a.y;
        const t = ((x - spring.a.x) * dx + (y - spring.a.y) * dy) / (dx * dx + dy * dy);
        if (t >= 0 && t <= 1) {
          const px = spring.a.x + t * dx;
          const py = spring.a.y + t * dy;
          const distSq = (x - px) ** 2 + (y - py) ** 2;
          if (distSq < 100) {
            selectedObject = spring;
            openPropertyMenu(spring, "spring", e.offsetX, e.offsetY);
            return;
          }
        }
      }
    } else {
      // Not paused → begin dragging
      for (let circle of circles) {
        const dx = x - circle.x;
        const dy = y - circle.y;
        if (dx * dx + dy * dy < circle.radius * circle.radius) {
          draggingCircle = circle;
          break;
        }
      }
    }
  }

  if (e.button === 2 && isPaused) { // right-click drag start
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
});

canvas.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

canvas.addEventListener("mouseup", () => {
  draggingCircle = null;
});


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

  if (e.key === "a" && draggingCircle && !isPaused) {
    draggingCircle.anchored = !draggingCircle.anchored;
    console.log("Anchor toggled:", draggingCircle.anchored);
  }

  if ((e.key === "Backspace" || e.key === "Delete") && draggingCircle) { // press Backspace or Delete to delete circle
    e.preventDefault(); // prevent browser from navigating back

    // Remove connected springs
    springs = springs.filter(spring => {
      return spring.a !== draggingCircle && spring.b !== draggingCircle;
    });

    // Remove the circle
    circles = circles.filter(c => c !== draggingCircle);

    // Clear the drag reference
    draggingCircle = null;
  }

  if (e.key === "c") { // press 'c' to create a new circle at mouse position
    new Circle(mouseX, mouseY, 20);
  }
});


canvas.addEventListener("mouseup", (e) => {
  if (e.button === 2 && isRightDragging && springStartCircle && isPaused) {
    for (let circle of circles) {
      const dx = e.offsetX - circle.x;
      const dy = e.offsetY - circle.y;
      if (dx * dx + dy * dy < circle.radius * circle.radius && circle !== springStartCircle) {
        const dist = Math.sqrt((circle.x - springStartCircle.x) ** 2 + (circle.y - springStartCircle.y) ** 2);
        springs.push(new Spring(springStartCircle, circle, dist, 200, 5.0, true, false));
        break;
      }
    }
  }

  springStartCircle = null;
  springEndCircle = null;
  isRightDragging = false;
});

canvas.addEventListener("contextmenu", (e) => {
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


function render() {
  drawSprings();
  drawRectangles();
  drawCircles();

  if (draggingCircle) {
    ctx.beginPath();
    ctx.moveTo(mouseX, mouseY);
    ctx.lineTo(draggingCircle.x, draggingCircle.y);
    ctx.strokeStyle = "rgba(21, 255, 0, 0.36)"; // green line with transparency
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  if (isRightDragging && springStartCircle) {
    ctx.beginPath();
    ctx.moveTo(springStartCircle.x, springStartCircle.y);
    ctx.lineTo(mouseX, mouseY);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.36)"; // white line with transparency
    ctx.lineWidth = 2;
    ctx.stroke();
  }
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


// semi-soft square

let circle1 = new Circle(400, 200, 35);
let circle2 = new Circle(500, 500, 35);
let circle3 = new Circle(700, 250, 35);
let circle4 = new Circle(700, 150, 35);

let spring1 = new Spring(circle1, circle2, 150, 500, 5.0, true, true, 0.8);
let spring2 = new Spring(circle2, circle3, 150, 500, 5.0, true, true, 0.8);
let spring3 = new Spring(circle3, circle4, 150, 500, 5.0, true, true, 0.8);
let spring4 = new Spring(circle4, circle1, 150, 500, 5.0, true, true, 0.8);

let diagonal1 = new Spring(circle1, circle3, 150 * Math.sqrt(2), 500, 5.0, false);
let diagonal2 = new Spring(circle2, circle4, 150 * Math.sqrt(2), 500, 5.0, false);


// soft square grid
createSoftbodyGrid(8, 8, 50, canvas.width/2, 0, {
  radius: 8,
  anchorEdges: false,
  springConfig: { stiffness: 1500, damping: 10.0, restitution: 0.9, visible: true, collides: true, elasticLimit: 5, rigidFrame: true }
});

// rope
/*
let ropeStart = new Circle(50, 200, 10, true);
let ropeEnd = new Circle(canvas.width - 50, 500, 10, true);
createRope(ropeStart, ropeEnd, 15, 50);
*/

//let slope = new Rectangle(900, 600, 1000, 20, -Math.PI / 1.1, true);


// boundaries
let floor = new Rectangle(
  canvas.width / 2,
  canvas.height + 50,
  10000,
  100
);
let leftWall = new Rectangle(
  -50,
  canvas.height / 2,
  100,
  10000
);
let rightWall = new Rectangle(
  canvas.width + 50,
  canvas.height / 2,
  100,
  10000
);
let ceiling = new Rectangle(
  canvas.width / 2,
  -50,
  10000,
  100
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

function mainLoop() {
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000; // seconds
  const subDelta = deltaTime / frameMultiplier;
  lastTime = now;
  
  if(!isPaused) {
    for (let i = 0; i < frameMultiplier; i++) {
      simulate(subDelta);
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
}

setInterval(mainLoop, 1000 / fps);
