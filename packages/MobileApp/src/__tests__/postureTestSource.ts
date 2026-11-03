import type { FoldReport, PostureSource } from "../layout/windowPosture";

/*
 * A stand-in for the platform's posture source (the Android module, a
 * browser's viewport segments): a test says how the window folds, and
 * changes it mid-test the way a phone half closed on a table, or opened flat,
 * does. Not named *.test.ts, so jest does not collect it as a suite.
 */

export interface TestPostureSource extends PostureSource {
  emit: (report: FoldReport | null) => void;
}

export function createTestPostureSource(
  initial: FoldReport | null = null,
): TestPostureSource {
  let current: FoldReport | null = initial;
  const listeners: Set<(report: FoldReport | null) => void> = new Set();

  return {
    getCurrent: (): FoldReport | null => {
      return current;
    },
    subscribe: (
      listener: (report: FoldReport | null) => void,
    ): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    emit: (report: FoldReport | null): void => {
      current = report;
      for (const listener of Array.from(listeners)) {
        listener(report);
      }
    },
  };
}

interface Size {
  width: number;
  height: number;
}

/** Half open on a table: a fold running side to side, `y` points down the window. */
export function tabletopReport(
  size: Size,
  y: number = size.height / 2,
  hingeHeight: number = 0,
): FoldReport {
  return {
    windowWidth: size.width,
    windowHeight: size.height,
    folds: [
      {
        x: 0,
        y,
        width: size.width,
        height: hingeHeight,
        orientation: "horizontal",
        separating: true,
      },
    ],
  };
}

/** Half open like a book: a fold running top to bottom, `x` points across the window. */
export function bookReport(size: Size, x: number = size.width / 2): FoldReport {
  return {
    windowWidth: size.width,
    windowHeight: size.height,
    folds: [
      {
        x,
        y: 0,
        width: 0,
        height: size.height,
        orientation: "vertical",
        separating: true,
      },
    ],
  };
}

/** Lying flat, or a window that does not fold: the platform reports no fold that splits it. */
export function flatReport(size: Size): FoldReport {
  return { windowWidth: size.width, windowHeight: size.height, folds: [] };
}
