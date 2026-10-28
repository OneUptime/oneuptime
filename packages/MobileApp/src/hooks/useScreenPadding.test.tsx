import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useScreenPadding } from "./useScreenPadding";
import { PaneProvider } from "../layout/WindowLayout";
import { getScreenBottomPadding } from "../theme/layout";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

function Content({ tabBar = true }: { tabBar?: boolean }): React.JSX.Element {
  const padding: number = useScreenPadding({ tabBar });
  return <Text testID="padding">{padding}</Text>;
}

test.each([0, 16, 24, 34, 48, 80])(
  "%dpt inset leaves the final item 40pt above navigation",
  (inset: number) => {
    expect(getScreenBottomPadding(inset)).toBe(72 + Math.max(inset, 12) + 40);
    expect(getScreenBottomPadding(inset, false)).toBe(inset + 40);
  },
);

test("padding updates when system safe area changes", async () => {
  const tree: (bottom: number) => React.JSX.Element = (bottom: number) => {
    return (
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, left: 0, right: 0, bottom }}
      >
        <Content />
      </SafeAreaInsetsContext.Provider>
    );
  };
  const view: Awaited<ReturnType<typeof render>> = await render(tree(0));
  expect(screen.getByTestId("padding")).toHaveTextContent("124");
  await view.rerender(tree(34));
  expect(screen.getByTestId("padding")).toHaveTextContent("146");
});

test("standalone content uses conservative clearance without a provider", async () => {
  await render(<Content />);
  expect(screen.getByTestId("padding")).toHaveTextContent("124");
});

test("auth and modal content reserves safe area without a tab bar", async () => {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 44, bottom: 34, left: 0, right: 0 }}
    >
      <Content tabBar={false} />
    </SafeAreaInsetsContext.Provider>,
  );
  expect(screen.getByTestId("padding")).toHaveTextContent("74");
});

describe("Beside a navigation rail", () => {
  afterEach(() => {
    resetWindowSize();
  });

  test("an unfolded foldable has no bar along the bottom to clear, only the safe area", async () => {
    /*
     * The rail sits down the side, so nothing floats over the bottom of the
     * page: 72 points of empty space there would only push the last card
     * further from the reader's thumb.
     */
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, bottom: 16, left: 0, right: 0 }}
      >
        <Content />
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.getByTestId("padding")).toHaveTextContent(String(16 + 40));
  });

  test("a phone on its side gets the rail, and the same clearance", async () => {
    setWindowSize(TEST_WINDOWS.phoneOnItsSide);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, bottom: 21, left: 59, right: 59 }}
      >
        <Content />
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.getByTestId("padding")).toHaveTextContent(String(21 + 40));
  });

  test("folding back to the cover screen brings the bar's clearance back at once", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, bottom: 16, left: 0, right: 0 }}
      >
        <Content />
      </SafeAreaInsetsContext.Provider>,
    );
    await resizeWindow(TEST_WINDOWS.coverScreen);
    expect(screen.getByTestId("padding")).toHaveTextContent(
      String(72 + 16 + 40),
    );
  });

  test("a tablet held upright keeps its bottom bar and its clearance", async () => {
    setWindowSize(TEST_WINDOWS.tabletUpright);
    await render(<Content />);
    expect(screen.getByTestId("padding")).toHaveTextContent("124");
  });
});

describe("Above and below a tabletop fold", () => {
  afterEach(() => {
    resetWindowSize();
  });

  /*
   * Half open on a table, the bar runs along the bottom of the window - under
   * the list below the fold, not under the detail above it. The detail stops
   * at the fold, so its last card needs only the breathing room after it.
   */
  test("the pane above the fold has no bar to clear, and no bottom inset", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, bottom: 16, left: 0, right: 0 }}
      >
        <PaneProvider
          pane={{
            kind: "detail",
            arrangement: "stacked",
            width: 1104,
            height: 430,
            insetLeft: 0,
            insetRight: 0,
            insetBottom: 0,
            reachesBottom: false,
          }}
        >
          <Content />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.getByTestId("padding")).toHaveTextContent("40");
  });

  test("the pane below the fold clears the bar floating over it", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, bottom: 16, left: 0, right: 0 }}
      >
        <PaneProvider
          pane={{
            kind: "list",
            arrangement: "stacked",
            width: 344,
            height: 420,
            insetLeft: 0,
            insetRight: 0,
            insetTop: 0,
          }}
        >
          <Content />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(screen.getByTestId("padding")).toHaveTextContent(
      String(72 + 16 + 40),
    );
  });
});
