import { act } from "@testing-library/react-native";
import { Dimensions } from "react-native";

/*
 * Window sizes for tests, and the way to change the window mid-test the way
 * a fold, an unfold or a rotation does: React Native's own Dimensions.set,
 * which is what the native side calls, so useWindowDimensions (and
 * everything laid out from it) re-renders exactly as it would on a device.
 */

interface WindowMetrics {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

/** What React Native's jest setup reports before anything changes it. */
export const DEFAULT_TEST_WINDOW: WindowMetrics = {
  width: 750,
  height: 1334,
  scale: 2,
  fontScale: 2,
};

export interface WindowSizeForTest {
  width: number;
  height: number;
}

/** The windows the foldable work is about, in points. */
export const TEST_WINDOWS: Readonly<{
  coverScreen: WindowSizeForTest;
  innerScreen: WindowSizeForTest;
  innerScreenOnItsSide: WindowSizeForTest;
  iPhoneDuoOpen: WindowSizeForTest;
  phoneOnItsSide: WindowSizeForTest;
  tabletUpright: WindowSizeForTest;
}> = {
  // A Galaxy Z Fold folded: narrower than most phones.
  coverScreen: { width: 344, height: 882 },
  // The same phone unfolded and held like a book.
  innerScreen: { width: 884, height: 1104 },
  innerScreenOnItsSide: { width: 1104, height: 884 },
  // The iPhone Duo held open (2853 x 2007 pixels at 3x).
  iPhoneDuoOpen: { width: 951, height: 669 },
  phoneOnItsSide: { width: 852, height: 393 },
  tabletUpright: { width: 768, height: 1024 },
};

function metricsFor(size: WindowSizeForTest): WindowMetrics {
  return { ...DEFAULT_TEST_WINDOW, width: size.width, height: size.height };
}

/** Sets the window before anything renders. */
export function setWindowSize(size: WindowSizeForTest): void {
  const metrics: WindowMetrics = metricsFor(size);
  Dimensions.set({ window: metrics, screen: metrics });
}

/** Changes the window while the app is on screen - a fold or an unfold. */
export async function resizeWindow(size: WindowSizeForTest): Promise<void> {
  await act(async (): Promise<void> => {
    setWindowSize(size);
  });
}

/** Puts React Native's default test window back. Call it after each test. */
export function resetWindowSize(): void {
  Dimensions.set({ window: DEFAULT_TEST_WINDOW, screen: DEFAULT_TEST_WINDOW });
}
