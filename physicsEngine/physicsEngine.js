const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});


let fps = 60;
let frameMultiplier = 10;

let lastTime = performance.now();

let gravity = 1000;
let drag = 0.04;

let mouseX = 0;
let mouseY = 0;
let draggingCircle = null;

let circleFill = "white";
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
  constructor(x, y, radius, anchored = false, restitution = 0.8) {
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
  constructor(a, b, restLength, stiffness, damping = 0.1, rigid = false) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
    this.stiffness = stiffness;
    this.rigid = rigid;
    this.damping = damping;

    springs.push(this);
  }

  apply(dt) {
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
  
    const nx = dx / dist;
    const ny = dy / dist;
  
    const force = this.stiffness * (dist - this.restLength);
    
    const dvx = this.b.vx - this.a.vx;
    const dvy = this.b.vy - this.a.vy;
    const relativeSpeed = dvx * nx + dvy * ny;
    
    const dampingForce = -this.damping * relativeSpeed;
    const totalForce = force + dampingForce;
    
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
      const correction = (dist - this.restLength);
      if (!this.a.anchored && !this.b.anchored) {
        this.a.x -= nx * correction / 2;
        this.a.y -= ny * correction / 2;
        this.b.x += nx * correction / 2;
        this.b.y += ny * correction / 2;
      } else if (!this.a.anchored) {
        this.a.x -= nx * correction;
        this.a.y -= ny * correction;
      } else if (!this.b.anchored) {
        this.b.x += nx * correction;
        this.b.y += ny * correction;
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
  ctx.fillStyle = circleFill;
  ctx.strokeStyle = circleStroke;
  ctx.lineWidth = circleStrokeWidth;
  
  for(const circle of circles) {
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
  const impulse = (1 + restitution) * dot;

  if (!a.anchored) {
    a.vx += impulse * nx;
    a.vy += impulse * ny;
  }
  if (!b.anchored) {
    b.vx -= impulse * nx;
    b.vy -= impulse * ny;
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

  if (draggingCircle && !draggingCircle.anchored) {
    draggingCircle.x = mouseX;
    draggingCircle.y = mouseY;
    draggingCircle.vx = 0;
    draggingCircle.vy = 0;
  }
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

let circle1 = new Circle(400, 200, 25);
let circle2 = new Circle(680, 200, 25);
let circle3 = new Circle(700, 250, 25);

let spring1 = new Spring(circle1, circle2, 400, 50, 0);
let spring2 = new Spring(circle2, circle3, 400, 50, 0);
let spring3 = new Spring(circle3, circle1, 400, 50, 0);

let groundHeight = canvas.height * 0.2;
let ground = new Rectangle(
  canvas.width / 2,                  // center X
  canvas.height - groundHeight / 2, // center Y
  10000,
  groundHeight
);

function mainLoop() {
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000; // seconds
  const subDelta = deltaTime / frameMultiplier;
  lastTime = now;
  
  for (let i = 0; i < frameMultiplier; i++) {
    simulate(subDelta);
  }
  
  clearScreen();
  render();
}

setInterval(mainLoop, 1000 / fps);
