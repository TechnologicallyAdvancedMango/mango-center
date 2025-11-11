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

let lastTime = performance.now();

let gravity = 2000;
let drag = 0.01;

let mouseX = 0;
let mouseY = 0;
let draggingCircle = null;

let circleFill = "white";
let anchoredCircleFill = "red";
let circleStroke = "black";
let circleStrokeWidth = 3;

let rectFill = "white";
let rectStroke = "black";
let rectStrokeWidth = 3;

let springColor = "white";
let rigidSpringColor = "red";
let springWidth = "10";

let circles = [];
let rectangles = [];
let springs = [];

class Circle {
  constructor(x, y, radius, anchored = false, restitution = 1) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.anchored = anchored;
    this.restitution = restitution;
    
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
}

class Spring {
  constructor(a, b, restLength, stiffness, damping, rigid = false, collides = false) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
    this.stiffness = stiffness;
    this.damping = damping;
    this.rigid = rigid;
    this.collides = collides;
    springs.push(this);
  }

  apply(dt) {
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
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

    if (!this.a.anchored) {
      this.a.vx += fx * dt;
      this.a.vy += fy * dt;
    }
    if (!this.b.anchored) {
      this.b.vx -= fx * dt;
      this.b.vy -= fy * dt;
    }

    // Enforce rigid constraint
    if (this.rigid) {
      const correction = this.restLength - dist;

      // Only correct if there's a meaningful deviation
      if (Math.abs(correction) > 0.01) {
        const nx = dx / dist;
        const ny = dy / dist;

        // Optional: clamp correction to avoid jitter
        const maxCorrection = 10;
        const clamped = Math.max(-maxCorrection, Math.min(maxCorrection, correction));

        if (!this.a.anchored && !this.b.anchored) {
          this.a.x -= nx * clamped / 2;
          this.a.y -= ny * clamped / 2;
          this.b.x += nx * clamped / 2;
          this.b.y += ny * clamped / 2;
        } else if (!this.a.anchored) {
          this.a.x -= nx * clamped;
          this.a.y -= ny * clamped;
        } else if (!this.b.anchored) {
          this.b.x += nx * clamped;
          this.b.y += ny * clamped;
        }

        // Dampen velocity along the spring axis to prevent expansion
        const dvx = this.b.vx - this.a.vx;
        const dvy = this.b.vy - this.a.vy;
        const relVel = dvx * nx + dvy * ny;

        if (!this.a.anchored && !this.b.anchored) {
          this.a.vx += nx * relVel / 2;
          this.a.vy += ny * relVel / 2;
          this.b.vx -= nx * relVel / 2;
          this.b.vy -= ny * relVel / 2;
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
}

function simulate(dt) {
  for (const spring of springs) {
    spring.apply(dt);
  }

  for (const circle of circles) {
    if (circle.anchored) continue;
    circle.vy += gravity * dt;

    circle.x += circle.vx * dt;
    circle.y += circle.vy * dt;
  }

  for (const rect of rectangles) {
    if (!rect.anchored) {
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
    ctx.strokeStyle = spring.rigid ? rigidSpringColor : springColor;
    
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

  // Position correction
  if (!a.anchored && !b.anchored) {
    a.x -= nx * overlap / 2;
    a.y -= ny * overlap / 2;
    b.x += nx * overlap / 2;
    b.y += ny * overlap / 2;
  } else if (!a.anchored) {
    a.x -= nx * overlap;
    a.y -= ny * overlap;
  } else if (!b.anchored) {
    b.x += nx * overlap;
    b.y += ny * overlap;
  }

  // Velocity reflection
  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const dot = dvx * nx + dvy * ny;
  if (dot > 0) return;

  const restitution = Math.min(a.restitution, b.restitution);

  // Assume unit mass for simplicity
  const invMassA = a.anchored ? 0 : 1;
  const invMassB = b.anchored ? 0 : 1;
  const impulseMag = -(1 + restitution) * dot / (invMassA + invMassB);

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

canvas.addEventListener("mousedown", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  for (const circle of circles) {
    const dx = mouseX - circle.x;
    const dy = mouseY - circle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < circle.radius) {
      draggingCircle = circle;
      break;
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


function render() {
  drawSprings();
  drawRectangles();
  drawCircles();
}

function clearScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

let circle1 = new Circle(400, 200, 35);
let circle2 = new Circle(500, 500, 35);
let circle3 = new Circle(700, 250, 35);
let circle4 = new Circle(700, 150, 35);

let spring1 = new Spring(circle1, circle2, 150, 200, 5.0, false);
let spring2 = new Spring(circle2, circle3, 150, 200, 5.0, false);
let spring3 = new Spring(circle3, circle4, 150, 200, 5.0, false);
let spring4 = new Spring(circle4, circle1, 150, 200, 5.0, false);

let diagonal1 = new Spring(circle1, circle3, 150 * Math.sqrt(2), 200, 5.0, true);
let diagonal2 = new Spring(circle2, circle4, 150 * Math.sqrt(2), 200, 5.0, true);


let slope = new Rectangle(800, 600, 1000, 20, -Math.PI / 1.1, true);

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
for(let i = 0; i < 300; i++) {
  new Circle(
    Math.random() * canvas.width,
    Math.random() * canvas.height,
    10 + Math.random() * 20
  );
}
*/

function mainLoop() {
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000; // seconds
  const subDelta = deltaTime / frameMultiplier;
  lastTime = now;
  
  for (let i = 0; i < frameMultiplier; i++) {
    simulate(subDelta);
  }

  if (draggingCircle && !draggingCircle.anchored) {
    draggingCircle.x = mouseX;
    draggingCircle.y = mouseY;
    draggingCircle.vx = 0;
    draggingCircle.vy = 0;
  }
  
  clearScreen();
  render();
}

setInterval(mainLoop, 1000 / fps);
