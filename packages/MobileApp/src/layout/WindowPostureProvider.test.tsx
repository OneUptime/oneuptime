import React, { useContext } from "react";
import { Pressable, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  PaneProvider,
  WindowLayoutProvider,
  useListPaneWidthControl,
  usePane,
  useWindowLayout,
  type ListPaneWidthControl,
  type ResolvedPaneLayout,
} from "./WindowLayout";
import type { WindowLayout } from "./windowLayout";
import type { FoldReport, PostureSource, WindowFold } from "./windowPosture";
import { LIST_PANE_WIDTH_KEY } from "../storage/listPaneWidth";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

/*
 * The provider every screen reads its layout through, with a posture source
 * standing in for the native module: what it does with each report, and -
 * first of all - that without a source (iOS, Expo Go, every jest run) and
 * without a report for the window on screen, nothing changes.
 */

interface FakeSource extends PostureSource {
  emit: (report: FoldReport | null) => void;
  listenerCount: () => number;
}

function fakeSource(initial: FoldReport | null): FakeSource {
  let current: FoldReport | null = initial;
  const listeners: Set<(report: FoldReport | null) => void> = new Set();
  return {
    getCurrent: (): FoldReport | null => {
      return current;
    },
    subscribe: (listener: (report: FoldReport | null) => void) => {
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
    listenerCount: (): number => {
      return listeners.size;
    },
  };
}

function report(
  size: { width: number; height: number },
  folds: Array<WindowFold> = [],
): FoldReport {
  return { windowWidth: size.width, windowHeight: size.height, folds };
}

const BOOK_FOLD: WindowFold = {
  x: 442,
  y: 0,
  width: 0,
  height: 1104,
  orientation: "vertical",
  separating: true,
};

const TABLE_FOLD: WindowFold = {
  x: 0,
  y: 442,
  width: 1104,
  height: 0,
  orientation: "horizontal",
  separating: true,
};

function LayoutReport(): React.JSX.Element {
  const layout: WindowLayout = useWindowLayout();
  const range: string = layout.listPaneWidthRange
    ? `${layout.listPaneWidthRange.min}-${layout.listPaneWidthRange.max}`
    : "fixed";
  return (
    <Text testID="layout">
      {`${layout.posture}/${layout.navigation}/${layout.paneArrangement}/${layout.listPaneWidth}/${range}`}
    </Text>
  );
}

function DividerButtons(): React.JSX.Element {
  const control: ListPaneWidthControl = useListPaneWidthControl();
  return (
    <>
      <Pressable
        testID="widen"
        onPress={(): void => {
          control.setPreferredListPaneWidth(420);
        }}
      />
      <Pressable
        testID="reset"
        onPress={(): void => {
          control.setPreferredListPaneWidth(null);
        }}
      />
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  resetWindowSize();
});

describe("Without a posture source, the layout is today's", () => {
  test("in a build without the native module - this jest run - nothing reports, and the divider is fixed", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "420");
    await render(
      <WindowLayoutProvider>
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("layout")).toHaveTextContent(
        "unknown/rail/row/362/fixed",
      );
    });
  });

  test("an explicit null source is the same: a remembered width waits for a posture", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "420");
    await render(
      <WindowLayoutProvider postureSource={null}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("layout")).toHaveTextContent(
        "unknown/rail/row/362/fixed",
      );
    });
  });

  test("a source that has not reported yet changes nothing either", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <WindowLayoutProvider postureSource={fakeSource(null)}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "unknown/rail/row/362/fixed",
    );
  });
});

describe("What the provider does with the reports", () => {
  test("half open like a book: the panes meet on the fold, and the divider is fixed", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <WindowLayoutProvider
        postureSource={fakeSource(
          report(TEST_WINDOWS.innerScreen, [BOOK_FOLD]),
        )}
      >
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "book/rail/row/362/fixed",
    );
  });

  test("flat, the divider can be dragged, and a remembered width is put back", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "420");
    await render(
      <WindowLayoutProvider
        postureSource={fakeSource(report(TEST_WINDOWS.innerScreen))}
      >
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("layout")).toHaveTextContent(
        "flat/rail/row/420/320-444",
      );
    });
  });

  test("half open on a table: the panes stack, and the bar takes the rail's place", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(
      <WindowLayoutProvider
        postureSource={fakeSource(
          report(TEST_WINDOWS.innerScreenOnItsSide, [TABLE_FOLD]),
        )}
      >
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "tabletop/bar/stacked/1104/fixed",
    );
  });

  test("each new report re-lays the window out: half closed, opened flat, half closed again", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    const source: FakeSource = fakeSource(
      report(TEST_WINDOWS.innerScreenOnItsSide),
    );
    await render(
      <WindowLayoutProvider postureSource={source}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );
    // 38% of the 1024 points beside the rail, and room to drag it to 664.
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/389/320-664",
    );

    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreenOnItsSide, [TABLE_FOLD]));
    });
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "tabletop/bar/stacked/1104/fixed",
    );

    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreenOnItsSide));
    });
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/389/320-664",
    );
  });

  test("a rotation the report has not caught up with lays out by size alone until it does", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const source: FakeSource = fakeSource(
      report(TEST_WINDOWS.innerScreen, [BOOK_FOLD]),
    );
    await render(
      <WindowLayoutProvider postureSource={source}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "book/rail/row/362/fixed",
    );

    // The window turns first; the report for the old window is stale.
    await resizeWindow(TEST_WINDOWS.innerScreenOnItsSide);
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "unknown/rail/row/389/fixed",
    );

    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreenOnItsSide, [TABLE_FOLD]));
    });
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "tabletop/bar/stacked/1104/fixed",
    );
  });

  test("the source goes quiet: back to the layout the window's size gives it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const source: FakeSource = fakeSource(
      report(TEST_WINDOWS.innerScreen, [BOOK_FOLD]),
    );
    await render(
      <WindowLayoutProvider postureSource={source}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );

    await act(async () => {
      source.emit(null);
    });

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "unknown/rail/row/362/fixed",
    );
  });

  test("leaving the screen stops listening to the source", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const source: FakeSource = fakeSource(report(TEST_WINDOWS.innerScreen));
    const view: Awaited<ReturnType<typeof render>> = await render(
      <WindowLayoutProvider postureSource={source}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );
    expect(source.listenerCount()).toBe(1);

    await view.unmount();

    expect(source.listenerCount()).toBe(0);
  });
});

describe("Moving the divider", () => {
  test("the reader's width is used at once and remembered; putting it back forgets it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <WindowLayoutProvider
        postureSource={fakeSource(report(TEST_WINDOWS.innerScreen))}
      >
        <LayoutReport />
        <DividerButtons />
      </WindowLayoutProvider>,
    );

    await fireEvent.press(screen.getByTestId("widen"));
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/420/320-444",
    );
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBe("420");
    });

    await fireEvent.press(screen.getByTestId("reset"));
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/362/320-444",
    );
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBeNull();
    });
  });

  test("a width moved before the stored one is read wins over it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "330");
    await render(
      <WindowLayoutProvider
        postureSource={fakeSource(report(TEST_WINDOWS.innerScreen))}
      >
        <LayoutReport />
        <DividerButtons />
      </WindowLayoutProvider>,
    );

    await fireEvent.press(screen.getByTestId("widen"));
    // Let the stored read finish; it must not drag the divider back.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/420/320-444",
    );
  });

  test("half open, the remembered width waits: the divider stays on the fold until the phone lies flat again", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "420");
    const source: FakeSource = fakeSource(
      report(TEST_WINDOWS.innerScreen, [BOOK_FOLD]),
    );
    await render(
      <WindowLayoutProvider postureSource={source}>
        <LayoutReport />
      </WindowLayoutProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "book/rail/row/362/fixed",
    );

    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreen));
    });
    expect(screen.getByTestId("layout")).toHaveTextContent(
      "flat/rail/row/420/320-444",
    );
  });

  test("outside a provider, moving the divider does nothing and breaks nothing", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <>
        <LayoutReport />
        <DividerButtons />
      </>,
    );

    await fireEvent.press(screen.getByTestId("widen"));

    expect(screen.getByTestId("layout")).toHaveTextContent(
      "unknown/rail/row/362/fixed",
    );
  });
});

describe("Panes above and below a tabletop fold", () => {
  function PaneReport(): React.JSX.Element {
    const pane: ResolvedPaneLayout = usePane();
    const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
    return (
      <Text testID="pane">
        {`${pane.kind}/${pane.arrangement ?? "row"}/${pane.height}/${pane.reachesBottom ?? true}|${insets?.top},${insets?.bottom}`}
      </Text>
    );
  }

  test("the pane above keeps the window's top and not its bottom, the pane below the reverse", async () => {
    setWindowSize(TEST_WINDOWS.innerScreenOnItsSide);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, right: 0, bottom: 16, left: 0 }}
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
          <PaneReport />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      "detail/stacked/430/false|24,0",
    );
  });

  test("a pane without a height of its own is as tall as the window", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, right: 0, bottom: 16, left: 0 }}
      >
        <PaneProvider
          pane={{ kind: "list", width: 362, insetLeft: 0, insetRight: 0 }}
        >
          <PaneReport />
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      "list/row/1104/true|24,16",
    );
  });

  test("outside any pane, the whole window", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 24, right: 0, bottom: 16, left: 0 }}
      >
        <PaneReport />
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId("pane")).toHaveTextContent(
      "full/row/882/true|24,16",
    );
  });
});
