import { useEffect, useRef } from 'react';

import chickenStanding from '../../../../stupid_chicken/photos/chicken_standing_still-removebg-preview.png';
import chickenHalfStep from '../../../../stupid_chicken/photos/chicken_half_step-removebg-preview.png';
import chickenFullStep from '../../../../stupid_chicken/photos/chicken_full_stepp-removebg-preview.png';
import chickenScratch from '../../../../stupid_chicken/photos/chicken_scratch-removebg-preview.png';

const STANDING = 0;
const HALF_STEP = 1;
const FULL_STEP = 2;
const SCRATCH = 3;

const FRAMES = [
  chickenStanding,
  chickenHalfStep,
  chickenFullStep,
  chickenScratch
];

const randomBetween = (min, max) => Math.random() * (max - min) + min;
const randomInt = (min, max) => Math.floor(randomBetween(min, max + 1));

const shouldReduceMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function AdminChickenEasterEgg() {
  const chickenRef = useRef(null);

  useEffect(() => {
    const chicken = chickenRef.current;
    if (!chicken || shouldReduceMotion()) return undefined;

    let timer = null;
    let cancelled = false;
    const state = {
      x: 0,
      facing: Math.random() < 0.5 ? -1 : 1,
      frame: STANDING,
      walkStepsRemaining: 0,
      pecksRemaining: 0,
      started: false
    };

    const preloadFrames = () =>
      Promise.all(
        FRAMES.map((src) =>
          new Promise((resolve) => {
            const image = new Image();
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
            image.src = src;
          })
        )
      );

    const chickenWidth = () => chicken.getBoundingClientRect().width || 110;
    const maxX = () => Math.max(0, window.innerWidth - chickenWidth());

    const clampPosition = () => {
      state.x = Math.min(Math.max(0, state.x), maxX());
    };

    const setFrame = (index) => {
      state.frame = index;
      chicken.src = FRAMES[index];
    };

    const placeChicken = () => {
      const peckY = state.frame === SCRATCH ? '5px' : '0';
      chicken.style.left = `${Math.round(state.x)}px`;
      chicken.style.transform = `translateY(${peckY}) scaleX(${state.facing})`;
    };

    const schedule = (callback, minDelay, maxDelay) => {
      timer = window.setTimeout(() => {
        if (!cancelled) callback();
      }, randomBetween(minDelay, maxDelay));
    };

    const turnAroundAtEdges = () => {
      if (state.x <= 0) {
        state.facing = 1;
      } else if (state.x >= maxX()) {
        state.facing = -1;
      }
    };

    const maybeTurnRandomly = (chance) => {
      if (Math.random() < chance) {
        state.facing *= -1;
      }
    };

    const stepForward = (scale = 1) => {
      turnAroundAtEdges();

      const shuffle = randomBetween(5, 14);
      const stride = Math.random() < 0.2 ? randomBetween(16, 30) : shuffle;

      state.x += state.facing * stride * scale;
      clampPosition();
      turnAroundAtEdges();
    };

    const chooseWalkBurst = () => {
      state.walkStepsRemaining = randomInt(4, 9);
      maybeTurnRandomly(0.28);
      turnAroundAtEdges();
    };

    const startWalkStep = () => {
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
    };

    const peckDown = () => {
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
    };

    const peckUp = () => {
      state.pecksRemaining -= 1;
      setFrame(STANDING);
      placeChicken();
      schedule(peckDown, 200, 420);
    };

    const startPeckBurst = () => {
      state.pecksRemaining = randomInt(2, 3);
      setFrame(STANDING);
      placeChicken();
      schedule(peckDown, 240, 520);
    };

    const finishWalkStep = () => {
      setFrame(FULL_STEP);
      stepForward(0.8);
      state.walkStepsRemaining -= 1;
      placeChicken();
      schedule(settleWalkStep, 85, 155);
    };

    const settleWalkStep = () => {
      setFrame(STANDING);

      if (Math.random() < 0.09) {
        maybeTurnRandomly(1);
      }

      placeChicken();
      schedule(startWalkStep, 100, 360);
    };

    const start = async () => {
      if (state.started) return;

      state.started = true;
      await preloadFrames();
      if (cancelled) return;

      state.x = randomBetween(0, maxX());
      chooseWalkBurst();
      setFrame(STANDING);
      placeChicken();
      schedule(startWalkStep, 120, 420);
    };

    const handleResize = () => {
      clampPosition();
      placeChicken();
    };

    window.addEventListener('resize', handleResize);

    if (chicken.complete) {
      start();
    } else {
      chicken.addEventListener('load', start, { once: true });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      chicken.removeEventListener('load', start);
    };
  }, []);

  return (
    <div className="admin-chicken-easter-egg" aria-hidden="true">
      <img
        ref={chickenRef}
        className="admin-chicken-easter-egg-bird"
        src={chickenStanding}
        alt=""
        draggable="false"
      />
    </div>
  );
}
