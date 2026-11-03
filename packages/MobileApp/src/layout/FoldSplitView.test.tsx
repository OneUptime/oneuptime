import React, { useContext } from "react";
import { StyleSheet, Text, type ViewStyle } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { HeaderHeightContext } from "@react-navigation/elements";
import { act, render, screen, within } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  FoldPaneScrollView,
  FoldSplitView,
  useFoldSplit,
} from "./FoldSplitView";
import {
  WindowLayoutProvider,
  usePane,
  type ResolvedPaneLayout,
} from "./WindowLayout";
import { TABLETOP_FOLD_GAP } from "./windowLayout";
import type { FoldSplit } from "./foldSplit";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { getScreenBottomPadding } from "../theme/layout";
import { spacing } from "../theme/tokens";
import {
  TEST_WINDOWS,
  resetWindowSize,
  setWindowSize,
} from "../__tests__/windowSize";
import {
  createTestPostureSource,
  flatReport,
  tabletopReport,
  type TestPostureSource,
} from "../__tests__/postureTestSource";

/*
 * A one-pane screen in two halves around a tabletop fold. Each half is a
 * pane of its own, so whatever is drawn in it reads the edges it really
 * has: the half above the fold has no bottom inset and no tab bar over it,
 * the half below no top inset, and the tab bar floats over its end.
 */

const INSETS: EdgeInsets = { top: 24, right: 0, bottom: 16, left: 0 };
const BAR: number = 80;
const SIZE: { width: number; height: number } =
  TEST_WINDOWS.innerScreenOnItsSide;

afterEach(() => {
  resetWindowSize();
});

function flat(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

// What a half tells the screen drawn in it.
function PaneProbe({ name }: { name: string }): React.JSX.Element {
  const pane: ResolvedPaneLayout = usePane();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const padding: number = useScreenPadding();
  return (
    <Text testID={`probe-${name}`}>
      {JSON.stringify({
        arrangement: pane.arrangement,
        height: pane.height,
        width: pane.width,
        reachesBottom: pane.reachesBottom,
        top: insets?.top,
        bottom: insets?.bottom,
        padding,
      })}
    </Text>
  );
}

function probe(name: string): Record<string, unknown> {
  return JSON.parse(
    String(screen.getByTestId(`probe-${name}`).props.children),
  ) as Record<string, unknown>;
}

function SplitScreen(): React.JSX.Element {
  const split: FoldSplit | null = useFoldSplit();
  if (!split) {
    return <Text testID="one-scroll">one scroll</Text>;
  }
  return (
    <FoldSplitView
      split={split}
      testID="screen-fold"
      above={<PaneProbe name="above" />}
      below={<PaneProbe name="below" />}
    />
  );
}

// A bar's height, or null for a screen drawn with no navigator around it.
async function renderWith(
  source: TestPostureSource,
  headerHeight: number | null = BAR,
): Promise<void> {
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <WindowLayoutProvider postureSource={source}>
        {headerHeight === null ? (
          <SplitScreen />
        ) : (
          <HeaderHeightContext.Provider value={headerHeight}>
            <SplitScreen />
          </HeaderHeightContext.Provider>
        )}
      </WindowLayoutProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

describe("useFoldSplit", () => {
  test("half open on a table, the screen splits where the fold's band starts, below its bar", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 442)));

    expect(
      flat(screen.getByTestId("screen-fold-above").props.style).height,
    ).toBe(442 - TABLETOP_FOLD_GAP / 2 - BAR);
  });

  test("flat, or nothing reporting a posture: one scroll", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(flatReport(SIZE)));
    expect(screen.getByTestId("one-scroll")).toBeTruthy();
    expect(screen.queryByTestId("screen-fold")).toBeNull();
  });

  test("a screen with no bar above it splits from the window's top", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 442)), null);

    expect(
      flat(screen.getByTestId("screen-fold-above").props.style).height,
    ).toBe(442 - TABLETOP_FOLD_GAP / 2);
  });

  test("folding and unfolding moves between the two, as the platform reports it", async () => {
    setWindowSize(SIZE);
    const source: TestPostureSource = createTestPostureSource(flatReport(SIZE));
    await renderWith(source);
    expect(screen.getByTestId("one-scroll")).toBeTruthy();

    await act(async () => {
      source.emit(tabletopReport(SIZE, 442));
    });
    expect(screen.getByTestId("screen-fold")).toBeTruthy();

    await act(async () => {
      source.emit(flatReport(SIZE));
    });
    expect(screen.getByTestId("one-scroll")).toBeTruthy();
  });
});

describe("FoldSplitView", () => {
  test("the band sits between the halves, with its line on the crease", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 442)));

    const gap: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("screen-fold-gap");
    expect(flat(gap.props.style).height).toBe(TABLETOP_FOLD_GAP);
    expect(within(gap).getByTestId("screen-fold-fold-line")).toBeTruthy();
    // Its own names: never the list and detail panes' ones, which may be mounted beside it.
    expect(screen.queryByTestId("pane-gap")).toBeNull();
    expect(screen.queryByTestId("pane-fold-line")).toBeNull();
  });

  test("the half above the fold: no bottom inset, no tab bar padding - only room after its last card", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 442)));

    expect(probe("above")).toEqual({
      arrangement: "stacked",
      height: 442 - TABLETOP_FOLD_GAP / 2 - BAR,
      width: SIZE.width,
      reachesBottom: false,
      top: INSETS.top,
      bottom: 0,
      padding: getScreenBottomPadding(0, false),
    });
  });

  test("the half below the fold: no top inset, and room for the tab bar floating over its end", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 442)));

    expect(probe("below")).toEqual({
      arrangement: "stacked",
      height: SIZE.height - (442 + TABLETOP_FOLD_GAP / 2),
      width: SIZE.width,
      top: 0,
      bottom: INSETS.bottom,
      padding: getScreenBottomPadding(INSETS.bottom, true),
    });
  });

  test("a hinge that hides part of the window keeps its own, wider band", async () => {
    setWindowSize(SIZE);
    await renderWith(createTestPostureSource(tabletopReport(SIZE, 422, 40)));

    expect(flat(screen.getByTestId("screen-fold-gap").props.style).height).toBe(
      40,
    );
    expect(
      flat(screen.getByTestId("screen-fold-above").props.style).height,
    ).toBe(422 - BAR);
  });
});

describe("FoldPaneScrollView", () => {
  async function renderScroll(): Promise<void> {
    setWindowSize(SIZE);
    const source: TestPostureSource = createTestPostureSource(
      tabletopReport(SIZE, 442),
    );

    function Screen(): React.JSX.Element {
      const split: FoldSplit | null = useFoldSplit();
      return (
        <FoldSplitView
          split={split!}
          testID="screen-fold"
          above={
            <FoldPaneScrollView testID="above-scroll" gap={spacing.lg}>
              <Text>Above</Text>
            </FoldPaneScrollView>
          }
          below={
            <FoldPaneScrollView testID="below-scroll" readableWidth={1040}>
              <Text>Below</Text>
            </FoldPaneScrollView>
          }
        />
      );
    }

    await render(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <WindowLayoutProvider postureSource={source}>
          <HeaderHeightContext.Provider value={BAR}>
            <Screen />
          </HeaderHeightContext.Provider>
        </WindowLayoutProvider>
      </SafeAreaInsetsContext.Provider>,
    );
  }

  test("each half pads its content for its own edges and its readable width", async () => {
    await renderScroll();

    const above: ViewStyle = flat(
      screen.getByTestId("above-scroll").props.contentContainerStyle,
    );
    const below: ViewStyle = flat(
      screen.getByTestId("below-scroll").props.contentContainerStyle,
    );

    expect(above).toMatchObject({
      padding: spacing.xl,
      paddingBottom: getScreenBottomPadding(0, false),
      gap: spacing.lg,
      // (1104 - 720) / 2: the readable width, centred.
      paddingLeft: (SIZE.width - 720) / 2,
      paddingRight: (SIZE.width - 720) / 2,
    });
    expect(below).toMatchObject({
      paddingBottom: getScreenBottomPadding(INSETS.bottom, true),
      gap: spacing.xxl,
      paddingLeft: (SIZE.width - 1040) / 2,
    });
  });
});
