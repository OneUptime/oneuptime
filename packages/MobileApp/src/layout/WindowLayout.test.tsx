import React, { useContext } from "react";
import { Text } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  PaneProvider,
  WindowLayoutProvider,
  useContentGutters,
  usePane,
  useWindowLayout,
  type PaneLayout,
} from "./WindowLayout";
import {
  NAVIGATION_RAIL_WIDTH,
  TWO_COLUMN_READABLE_WIDTH,
  type ContentGutters,
  type WindowLayout,
} from "./windowLayout";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

/*
 * The hooks every screen reads its layout through. They must follow the
 * window as it changes - a fold is a resize in the middle of a screen - and
 * they must agree with each other, wherever in the tree they are read.
 */

function LayoutReport(): React.JSX.Element {
  const layout: WindowLayout = useWindowLayout();
  return (
    <Text testID="layout">
      {`${layout.navigation}/${layout.panes}/${layout.railWidth}/${layout.listPaneWidth}`}
    </Text>
  );
}

function PaneReport(): React.JSX.Element {
  const pane: PaneLayout = usePane();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return (
    <Text testID="pane">
      {`${pane.kind}/${pane.width}/${pane.insetLeft}/${pane.insetRight}|${insets?.top ?? "-"},${insets?.right ?? "-"},${insets?.bottom ?? "-"},${insets?.left ?? "-"}`}
    </Text>
  );
}

function GuttersReport({
  readableWidth,
}: {
  readableWidth?: number;
}): React.JSX.Element {
  const gutters: ContentGutters = useContentGutters(readableWidth);
  return (
    <Text testID="gutters">{`${gutters.paddingLeft}/${gutters.paddingRight}`}</Text>
  );
}

afterEach(() => {
  resetWindowSize();
});

describe("useWindowLayout", () => {
  test("follows the window as a foldable unfolds and folds again", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    await render(<LayoutReport />);
    expect(screen.getByTestId("layout")).toHaveTextContent("bar/1/0/0");

    await resizeWindow(TEST_WINDOWS.innerScreen);
    expect(screen.getByTestId("layout")).toHaveTextContent(
      `rail/2/${NAVIGATION_RAIL_WIDTH}/362`,
    );

    await resizeWindow(TEST_WINDOWS.coverScreen);
    expect(screen.getByTestId("layout")).toHaveTextContent("bar/1/0/0");
  });

  test("inside the provider, it reads the window's real insets even where a pane has trimmed them", async () => {
    /*
     * A pane hands its contents only the insets of the edges it touches. If
     * a hook inside it recomputed the window's layout from those, the rail
     * would come out narrower than the navigator drew it.
     */
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, right: 0, bottom: 0, left: 40 }}
      >
        <WindowLayoutProvider>
          <SafeAreaInsetsContext.Provider
            value={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <LayoutReport />
          </SafeAreaInsetsContext.Provider>
        </WindowLayoutProvider>
      </SafeAreaInsetsContext.Provider>,
    );

    // A 120-point rail (80 + the 40-point inset); the list ends on the centre line.
    expect(screen.getByTestId("layout")).toHaveTextContent(
      `rail/2/${NAVIGATION_RAIL_WIDTH + 40}/${442 - (NAVIGATION_RAIL_WIDTH + 40)}`,
    );
  });

  test("without a provider it works the layout out from what it can see", async () => {
    setWindowSize(TEST_WINDOWS.iPhoneDuoOpen);
    await render(<LayoutReport />);

    expect(screen.getByTestId("layout")).toHaveTextContent("rail/2/80/395.5");
  });
});

describe("Panes", () => {
  test("outside a list and its detail, a screen has the whole content area beside the navigation", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 10, right: 20, bottom: 30, left: 0 }}
      >
        <PaneReport />
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      `full/${1104 - 80}/0/20|10,20,30,0`,
    );
  });

  test("a pane gives its contents only the insets of the window edges it touches", async () => {
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 10, right: 20, bottom: 30, left: 40 }}
      >
        <PaneProvider
          pane={{ kind: "detail", width: 500, insetLeft: 0, insetRight: 20 }}
        >
          <PaneReport />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      "detail/500/0/20|10,20,30,0",
    );
  });

  test("with no safe area provider at all, a pane leaves the insets unknown rather than inventing zeros", async () => {
    await render(
      <PaneProvider
        pane={{ kind: "list", width: 360, insetLeft: 0, insetRight: 0 }}
      >
        <PaneReport />
      </PaneProvider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      "list/360/0/0|-,-,-,-",
    );
  });
});

describe("useContentGutters", () => {
  test("a phone keeps the 20-point gutter on both sides", async () => {
    setWindowSize({ width: 390, height: 844 });
    await render(<GuttersReport />);

    expect(screen.getByTestId("gutters")).toHaveTextContent("20/20");
  });

  test("a wide single pane centres its content at a readable width", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(<GuttersReport />);

    const contentWidth: number = 1104 - 80;
    const gutter: number = (contentWidth - 720) / 2;
    expect(screen.getByTestId("gutters")).toHaveTextContent(
      `${gutter}/${gutter}`,
    );
  });

  test("a page in two columns asks for the wider readable width", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(<GuttersReport readableWidth={TWO_COLUMN_READABLE_WIDTH} />);

    expect(screen.getByTestId("gutters")).toHaveTextContent("20/20");
  });

  test("each side adds its own inset: a camera on one side is never covered", async () => {
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <PaneProvider
          pane={{ kind: "detail", width: 420, insetLeft: 0, insetRight: 44 }}
        >
          <GuttersReport />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("gutters")).toHaveTextContent("20/64");
  });

  test("the gutters follow the window through a fold", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(<GuttersReport />);
    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(screen.getByTestId("gutters")).toHaveTextContent("20/20");
  });
});
