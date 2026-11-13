/*
 * Waiting for a history step in jsdom, and for what the leave guard
 * (UI/Utils/LeaveGuard) does after it, to land.
 *
 * jsdom takes a step (Back, Forward, history.go) two tasks after it is
 * asked for, as browsers take it after the current task. A step the guard
 * keeps from the router is taken back in the next animation frame, once
 * the browser has put back the scroll position of the entry the step
 * reached (issue #7404), and a step back lands two tasks after that. So:
 * a handful of tasks, a frame, and the same again - by which time a step,
 * the guard's step back, and a step taken again after the reader's answer
 * have all landed.
 */

const TASKS_PER_ROUND: number = 8;
const ROUNDS: number = 2;

const nextTask: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

/*
 * The next animation frame: jsdom draws none unless it pretends to be
 * visual, as Jest's jsdom environment does; without one, a wait as long as
 * a frame stands in.
 */
const nextFrame: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        resolve();
      });
      return;
    }

    setTimeout(resolve, 20);
  });
};

export const afterHistorySteps: () => Promise<void> =
  async (): Promise<void> => {
    for (let round: number = 0; round < ROUNDS; round++) {
      for (let task: number = 0; task < TASKS_PER_ROUND; task++) {
        await nextTask();
      }

      await nextFrame();
    }

    for (let task: number = 0; task < TASKS_PER_ROUND; task++) {
      await nextTask();
    }
  };

export default afterHistorySteps;
