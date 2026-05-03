const chicken = document.querySelector(".chicken");

const STANDING = 0;
const HALF_STEP = 1;
const FULL_STEP = 2;
const SCRATCH = 3;

const frames = [
  "photos/chicken_standing_still-removebg-preview.png",
  "photos/chicken_half_step-removebg-preview.png",
  "photos/chicken_full_stepp-removebg-preview.png",
  "photos/chicken_scratch-removebg-preview.png",
];

const state = {
  x: 0,
  facing: Math.random() < 0.5 ? -1 : 1,
  frame: STANDING,
  walkStepsRemaining: 0,
  pecksRemaining: 0,
  started: false,
  timer: null,
};

function preloadFrames() {
  return Promise.all(
    frames.map(
      (src) =>
        new Promise((resolve) => {
          const image = new Image();
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
          image.src = src;
        }),
    ),
  );
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

function chickenWidth() {
  return chicken.getBoundingClientRect().width || 110;
}

function maxX() {
  return Math.max(0, window.innerWidth - chickenWidth());
}

function clampPosition() {
  state.x = Math.min(Math.max(0, state.x), maxX());
}

function setFrame(index) {
  state.frame = index;
  chicken.src = frames[index];
  chicken.style.setProperty("--peck-y", index === SCRATCH ? "5px" : "0");
}

function placeChicken() {
  chicken.style.left = `${Math.round(state.x)}px`;
  chicken.style.setProperty("--facing", state.facing);
  chicken.style.transform = `translateY(${state.frame === SCRATCH ? "5px" : "0"}) scaleX(${state.facing})`;
}

function schedule(callback, minDelay, maxDelay) {
  state.timer = window.setTimeout(callback, randomBetween(minDelay, maxDelay));
}

function turnAroundAtEdges() {
  if (state.x <= 0) {
    state.facing = 1;
  } else if (state.x >= maxX()) {
    state.facing = -1;
  }
}

function maybeTurnRandomly(chance) {
  if (Math.random() < chance) {
    state.facing *= -1;
  }
}

function stepForward(scale = 1) {
  turnAroundAtEdges();

  const shuffle = randomBetween(5, 14);
  const stride = Math.random() < 0.2 ? randomBetween(16, 30) : shuffle;

  state.x += state.facing * stride * scale;
  clampPosition();
  turnAroundAtEdges();
}

function chooseWalkBurst() {
  state.walkStepsRemaining = randomInt(4, 9);
  maybeTurnRandomly(0.28);
  turnAroundAtEdges();
}

function startPeckBurst() {
  state.pecksRemaining = randomInt(2, 3);
  setFrame(STANDING);
  placeChicken();
  schedule(peckDown, 240, 520);
}

function peckDown() {
  if (state.pecksRemaining <= 0) {
    setFrame(STANDING);
    maybeTurnRandomly(0.22);
    chooseWalkBurst();
    placeChicken();
    schedule(startWalkStep, 360, 1100);
    return;
  }

  setFrame(SCRATCH);
  placeChicken();
  schedule(peckUp, 440, 720);
}

function peckUp() {
  state.pecksRemaining -= 1;
  setFrame(STANDING);
  placeChicken();
  schedule(peckDown, 200, 420);
}

function startWalkStep() {
  if (state.walkStepsRemaining <= 0) {
    if (Math.random() < 0.72) {
      startPeckBurst();
      return;
    }

    setFrame(STANDING);
    maybeTurnRandomly(0.3);
    chooseWalkBurst();
    placeChicken();
    schedule(startWalkStep, 180, 650);
    return;
  }

  if (Math.random() < 0.08) {
    setFrame(STANDING);
    maybeTurnRandomly(0.2);
    placeChicken();
    schedule(startWalkStep, 140, 420);
    return;
  }

  setFrame(HALF_STEP);
  stepForward(0.55);
  placeChicken();
  schedule(finishWalkStep, 85, 145);
}

function finishWalkStep() {
  setFrame(FULL_STEP);
  stepForward(0.8);
  state.walkStepsRemaining -= 1;
  placeChicken();
  schedule(settleWalkStep, 85, 155);
}

function settleWalkStep() {
  setFrame(STANDING);

  if (Math.random() < 0.09) {
    maybeTurnRandomly(1);
  }

  placeChicken();
  schedule(startWalkStep, 100, 360);
}

async function start() {
  if (state.started) {
    return;
  }

  state.started = true;
  await preloadFrames();
  state.x = randomBetween(0, maxX());
  chooseWalkBurst();
  setFrame(STANDING);
  placeChicken();
  schedule(startWalkStep, 120, 420);
}

window.addEventListener("resize", () => {
  clampPosition();
  placeChicken();
});

if (chicken.complete) {
  start();
} else {
  chicken.addEventListener("load", start, { once: true });
}
