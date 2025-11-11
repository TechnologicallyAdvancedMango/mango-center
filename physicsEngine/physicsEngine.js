const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});


let fps = 60;
let frameMultiplier = 1;

const gravity = 0;

let circleFill = "white";
let circleStroke = "black";
let circleStrokeWidth = 3;

let rectFill = "white";
let rectStroke = "black";
let rectStrokeWidth = 3;

let springColor = "white";
let springWidth = "10";

let circles = [];
let rectangles = [];
let springs = [];

class Circle {
  constructor(x, y, radius, anchored = false) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.anchored = anchored;
    circles.push(this);
  }
}

class Rectangle {
  constructor(x, y, width, height, angle = 0, anchored = false) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = angle; // in radians
    this.angularVelocity = 0;
    this.width = width;
    this.height = height;
    this.anchored = anchored;
    rectangles.push(this);
  }
}

class Spring {
  constructor(a, b, restLength, stiffness) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
    this.stiffness = stiffness;

    springs.push(this)
  }

  apply() {
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const force = this.stiffness * (dist - this.restLength);
    const angle = Math.atan2(dy, dx);

    const fx = Math.cos(angle) * force;
    const fy = Math.sin(angle) * force;

    if (!this.a.anchored) {
      this.a.vx += fx;
      this.a.vy += fy;
    }
    if (!this.b.anchored) {
      this.b.vx -= fx;
      this.b.vy -= fy;
    }
  }
}


function simulate() {
  for (const spring of springs) {
    spring.apply();
  }

  for (const circle of circles) {
    if (circle.anchored) continue;
    circle.vy += gravity;
    circle.x += circle.vx;
    circle.y += circle.vy;
  }

  for (const rect of rectangles) {
    if (!rect.anchored) {
      rect.vy += gravity;
      rect.x += rect.vx;
      rect.y += rect.vy;
      rect.angle += rect.angularVelocity;
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
  ctx.strokeStyle = springColor;
  ctx.lineWidth = springWidth;
  ctx.lineCap = "round";

  for (const spring of springs) {
    ctx.beginPath();
    ctx.moveTo(spring.a.x, spring.a.y);
    ctx.lineTo(spring.b.x, spring.b.y);
    ctx.stroke();
  }
}

function render() {
  drawSprings();
  drawRectangles();
  drawCircles();
}

function clearScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

let circle1 = new Circle(400, 200, 25);
let circle2 = new Circle(700, 200, 25);
let circle3 = new Circle(700, 400, 25);

let spring1 = new Spring(circle1, circle2, 350, 0.1);
let spring2 = new Spring(circle2, circle3, 350, 0.1);
let spring3 = new Spring(circle3, circle1, 350, 0.1);

function mainLoop() {
  clearScreen();
  
  for(let i = 0; i < frameMultiplier; i++) {
    simulate();
  }
  
  render();
}

setInterval(mainLoop, 1000 / fps);
