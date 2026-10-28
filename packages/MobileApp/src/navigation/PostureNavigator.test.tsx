import React, { useContext, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
  type NavigationContainerRefWithCurrent,
  type NavigationState,
  type ParamListBase,
  type StackNavigationState,
} from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  createAdaptiveStackNavigator,
  getStackedDescriptors,
} from "./createAdaptiveStackNavigator";
import { useListPane } from "./paneState";
import {
  WindowLayoutProvider,
  usePane,
  type ResolvedPaneLayout,
} from "../layout/WindowLayout";
import {
  NAVIGATION_RAIL_WIDTH,
  TABLETOP_FOLD_GAP,
} from "../layout/windowLayout";
import type {
  FoldReport,
  PostureSource,
  WindowFold,
} from "../layout/windowPosture";
import { LIST_PANE_WIDTH_KEY } from "../storage/listPaneWidth";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

/*
 * The list-and-detail navigator in the postures the platform reports: half
 * open on a table (the detail above the fold, the list below it), half open
 * like a book (the panes meet on the fold, the divider fixed) and lying flat
 * (a divider the reader can drag). Postures change while somebody is in the
 * middle of something, so the detail screen here keeps a half-typed note and
 * an open dialog in plain component state, and counts its mounts: a change of
 * posture must never draw it afresh.
 */

type TestParamList = {
  List: undefined;
  Detail: { id: string };
  Deeper: { id: string };
  Sheet: undefined;
};

type ListNavigation = NativeStackNavigationProp<TestParamList, "List">;

const mounts: { detail: Record<string, number> } = { detail: {} };
// How many times the list screen has been drawn: a drag must not draw it again.
const renders: { list: number } = { list: 0 };

function InsetsReport({ testID }: { testID: string }): React.JSX.Element {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return (
    <Text testID={testID}>
      {`${insets?.top},${insets?.right},${insets?.bottom},${insets?.left}`}
    </Text>
  );
}

function PaneReport({ testID }: { testID: string }): React.JSX.Element {
  const pane: ResolvedPaneLayout = usePane();
  return (
    <Text testID={testID}>
      {`${pane.kind}/${pane.arrangement ?? "row"}/${pane.width}/${pane.height}/${pane.reachesBottom ?? true}`}
    </Text>
  );
}

function ListScreen(): React.JSX.Element {
  renders.list += 1;
  const navigation: ListNavigation = useNavigation<ListNavigation>();
  const listPane: ReturnType<typeof useListPane> = useListPane();
  return (
    <View testID="list-screen">
      <PaneReport testID="list-pane-report" />
      <InsetsReport testID="list-insets" />
      {["a", "b"].map((id: string): React.JSX.Element => {
        return (
          <Pressable
            key={id}
            testID={`open-${id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: listPane.isOpen("Detail", { id }) }}
            onPress={(): void => {
              navigation.navigate("Detail", { id });
            }}
          >
            <Text>{`Row ${id}`}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DetailScreen({
  route,
}: NativeStackScreenProps<TestParamList, "Detail">): React.JSX.Element {
  const [note, setNote] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const id: string = route.params.id;

  useEffect((): void => {
    mounts.detail[id] = (mounts.detail[id] ?? 0) + 1;
  }, [id]);

  return (
    <View testID={`detail-${id}`}>
      <TextInput testID={`note-${id}`} value={note} onChangeText={setNote} />
      <Pressable
        testID={`open-dialog-${id}`}
        onPress={(): void => {
          setDialogOpen(true);
        }}
      >
        <Text>Add note</Text>
      </Pressable>
      {dialogOpen ? <Text testID={`dialog-${id}`}>Dialog open</Text> : null}
      <PaneReport testID={`detail-pane-report-${id}`} />
      <InsetsReport testID={`detail-insets-${id}`} />
    </View>
  );
}

function DeeperScreen(): React.JSX.Element {
  return <Text testID="deeper">Deeper</Text>;
}

function SheetScreen(): React.JSX.Element {
  return <Text testID="sheet">Sheet</Text>;
}

function EmptyDetail(): React.JSX.Element {
  return (
    <View testID="empty-detail">
      <PaneReport testID="empty-pane-report" />
      <InsetsReport testID="empty-insets" />
    </View>
  );
}

const Stack: ReturnType<typeof createAdaptiveStackNavigator<TestParamList>> =
  createAdaptiveStackNavigator<TestParamList>();

const OVERLAYS: ReadonlyArray<string> = ["Sheet"];

function TestStack(): React.JSX.Element {
  return (
    <Stack.Navigator emptyDetail={EmptyDetail} overlayRouteNames={OVERLAYS}>
      <Stack.Screen
        name="List"
        component={ListScreen}
        options={{
          title: "List",
          headerTitle: (): React.JSX.Element => {
            return <Text testID="project-switcher-stub">Project</Text>;
          },
        }}
      />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Deeper" component={DeeperScreen} />
      <Stack.Screen
        name="Sheet"
        component={SheetScreen}
        options={{ presentation: "modal" }}
      />
    </Stack.Navigator>
  );
}

const INSETS: EdgeInsets = { top: 24, right: 12, bottom: 16, left: 8 };

interface FakeSource extends PostureSource {
  emit: (report: FoldReport | null) => void;
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
  };
}

function report(
  size: { width: number; height: number },
  folds: Array<WindowFold> = [],
): FoldReport {
  return { windowWidth: size.width, windowHeight: size.height, folds };
}

function bookFold(x: number, height: number, width: number = 0): WindowFold {
  return { x, y: 0, width, height, orientation: "vertical", separating: true };
}

function tableFold(y: number, width: number): WindowFold {
  return {
    x: 0,
    y,
    width,
    height: 0,
    orientation: "horizontal",
    separating: true,
  };
}

const ON_ITS_SIDE: { width: number; height: number } =
  TEST_WINDOWS.innerScreenOnItsSide;
const TABLETOP: FoldReport = report(ON_ITS_SIDE, [tableFold(442, 1104)]);
const FLAT_ON_ITS_SIDE: FoldReport = report(ON_ITS_SIDE);

async function renderStack(
  source: PostureSource | null,
): Promise<NavigationContainerRefWithCurrent<ParamListBase>> {
  const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
    createNavigationContainerRef<ParamListBase>();
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <WindowLayoutProvider postureSource={source}>
        <NavigationContainer ref={navigationRef}>
          <TestStack />
        </NavigationContainer>
      </WindowLayoutProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  return navigationRef;
}

function routeNames(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
): Array<string> {
  const state: NavigationState | undefined = navigationRef.getRootState();
  return (state?.routes ?? []).map(
    (route: NavigationState["routes"][number]): string => {
      return route.name;
    },
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  resetWindowSize();
  mounts.detail = {};
  renders.list = 0;
});

describe("Half open on a table", () => {
  test("the detail stands above the fold and the list lies below it, a band between them", async () => {
    setWindowSize(ON_ITS_SIDE);
    await renderStack(fakeSource(TABLETOP));

    // Laid out bottom up: the list (first in the tree) at the bottom, the detail on top.
    expect(screen.getByTestId("adaptive-panes")).toHaveStyle({
      flexDirection: "column-reverse",
    });
    const listPane: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("list-pane");
    expect(listPane).toHaveStyle({
      height: 884 - 442 - TABLETOP_FOLD_GAP / 2,
      borderTopWidth: 1,
    });
    expect(screen.getByTestId("pane-gap")).toHaveStyle({
      height: TABLETOP_FOLD_GAP,
    });
    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("empty-detail"),
    ).toBeTruthy();
    expect(screen.getByTestId("list-pane-report")).toHaveTextContent(
      `list/stacked/1104/${884 - 442 - TABLETOP_FOLD_GAP / 2}/true`,
    );
    expect(screen.getByTestId("empty-pane-report")).toHaveTextContent(
      `detail/stacked/1104/${442 - TABLETOP_FOLD_GAP / 2}/false`,
    );
    // Nothing to drag: the fold is the divider.
    expect(screen.queryByTestId("pane-divider")).toBeNull();
  });

  test("the list below the fold has no header of its own: the project switcher heads the window, above", async () => {
    setWindowSize(ON_ITS_SIDE);
    await renderStack(fakeSource(TABLETOP));

    expect(
      within(screen.getByTestId("list-pane")).queryByTestId(
        "project-switcher-stub",
      ),
    ).toBeNull();
  });

  test("the pane above keeps the window's top edge, the pane below its bottom edge and the bar", async () => {
    setWindowSize(ON_ITS_SIDE);
    await renderStack(fakeSource(TABLETOP));

    // top,right,bottom,left
    expect(screen.getByTestId("empty-insets")).toHaveTextContent("24,12,0,8");
    expect(screen.getByTestId("list-insets")).toHaveTextContent("0,12,16,8");
  });

  test("a row below opens its record above, replacing the one open there", async () => {
    setWindowSize(ON_ITS_SIDE);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack(fakeSource(TABLETOP));

    await fireEvent.press(screen.getByTestId("open-a"));
    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("detail-a"),
    ).toBeTruthy();
    expect(screen.getByTestId("open-a")).toBeSelected();

    await fireEvent.press(screen.getByTestId("open-b"));
    expect(routeNames(navigationRef)).toEqual(["List", "Detail"]);
    expect(screen.getByTestId("open-b")).toBeSelected();
    expect(screen.getByTestId("open-a")).not.toBeSelected();
  });

  test("closing the phone flat and half again keeps the record, its half-typed note and its dialog, mounted once", async () => {
    setWindowSize(ON_ITS_SIDE);
    const source: FakeSource = fakeSource(FLAT_ON_ITS_SIDE);
    await renderStack(source);

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.changeText(
      screen.getByTestId("note-a"),
      "Rolled back the deploy",
    );
    await fireEvent.press(screen.getByTestId("open-dialog-a"));

    // Half closed on the table: the panes stack.
    await act(async () => {
      source.emit(TABLETOP);
    });
    expect(screen.getByTestId("list-pane")).toHaveStyle({ borderTopWidth: 1 });
    expect(screen.getByTestId("note-a")).toHaveProp(
      "value",
      "Rolled back the deploy",
    );
    expect(screen.getByTestId("dialog-a")).toBeTruthy();
    expect(screen.getByTestId("detail-pane-report-a")).toHaveTextContent(
      "detail/stacked/",
      { exact: false },
    );

    // Opened flat again: side by side.
    await act(async () => {
      source.emit(FLAT_ON_ITS_SIDE);
    });
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      borderRightWidth: 1,
    });
    expect(screen.getByTestId("note-a")).toHaveProp(
      "value",
      "Rolled back the deploy",
    );
    expect(screen.getByTestId("dialog-a")).toBeTruthy();

    // And folded shut onto the cover screen.
    await resizeWindow(TEST_WINDOWS.coverScreen);
    expect(screen.queryByTestId("list-pane")).toBeNull();
    expect(screen.getByTestId("note-a")).toHaveProp(
      "value",
      "Rolled back the deploy",
    );

    expect(mounts.detail.a).toBe(1);
  });

  test("the record above has no Back button and no push; screens opened further in keep Back", () => {
    const state: StackNavigationState<ParamListBase> = {
      stale: false,
      type: "stack",
      key: "stack",
      index: 2,
      routeNames: ["List", "Detail", "Deeper", "Sheet"],
      routes: [
        { key: "list", name: "List" },
        { key: "detail", name: "Detail", params: { id: "a" } },
        { key: "deeper", name: "Deeper", params: { id: "a" } },
      ],
      preloadedRoutes: [],
    };
    const descriptor: (key: string) => {
      options: Record<string, unknown>;
      render: () => React.JSX.Element;
      route: { key: string; name: string };
      navigation: unknown;
    } = (key: string) => {
      return {
        options: { headerTitle: "switcher", title: key },
        render: (): React.JSX.Element => {
          return <Text>{key}</Text>;
        },
        route: { key, name: key },
        navigation: {},
      };
    };
    const descriptors: Parameters<typeof getStackedDescriptors>[0] = {
      list: descriptor("list"),
      detail: descriptor("detail"),
      deeper: descriptor("deeper"),
    } as unknown as Parameters<typeof getStackedDescriptors>[0];

    const stacked: ReturnType<typeof getStackedDescriptors> =
      getStackedDescriptors(descriptors, state, EmptyDetail, OVERLAYS);

    // The project switcher stays in every bar, as on a phone.
    expect(stacked["list"]!.options.headerTitle).toBe("switcher");
    expect(stacked["detail"]!.options.headerTitle).toBe("switcher");
    expect(stacked["list"]!.options.headerBackVisible).toBe(false);
    expect(stacked["detail"]!.options).toMatchObject({
      headerBackVisible: false,
      gestureEnabled: false,
      animation: "none",
    });
    expect(stacked["deeper"]!.options).toEqual(descriptors["deeper"]!.options);
  });
});

describe("Half open like a book", () => {
  test("the panes meet on the fold and there is no handle to drag", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(
      fakeSource(report(TEST_WINDOWS.innerScreen, [bookFold(442, 1104)])),
    );

    // The rail covers the 8-point inset: 88 points, then the list to the fold.
    expect(screen.getByTestId("adaptive-panes")).toHaveStyle({
      flexDirection: "row",
    });
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: 442 - (NAVIGATION_RAIL_WIDTH + INSETS.left),
    });
    expect(screen.queryByTestId("pane-divider")).toBeNull();
    expect(screen.queryByTestId("pane-gap")).toBeNull();
  });

  test("a hinge between two screens keeps its width between the panes", async () => {
    const size: { width: number; height: number } = {
      width: 1110,
      height: 900,
    };
    setWindowSize(size);
    await renderStack(fakeSource(report(size, [bookFold(534, 900, 42)])));

    expect(screen.getByTestId("pane-gap")).toHaveStyle({ width: 42 });
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: 534 - (NAVIGATION_RAIL_WIDTH + INSETS.left),
    });
  });
});

describe("Lying flat, the reader drags the divider", () => {
  const INNER_FLAT: FoldReport = report(TEST_WINDOWS.innerScreen);
  // 884 points, an 88-point rail: the list on the fold's line is 354 wide.
  const ON_THE_FOLD: number = 442 - (NAVIGATION_RAIL_WIDTH + INSETS.left);

  async function drag(from: number, to: number): Promise<void> {
    const handle: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pane-divider");
    await fireEvent(handle, "responderGrant", { nativeEvent: { pageX: from } });
    await fireEvent(handle, "responderMove", { nativeEvent: { pageX: to } });
  }

  async function letGo(at: number): Promise<void> {
    await fireEvent(screen.getByTestId("pane-divider"), "responderRelease", {
      nativeEvent: { pageX: at },
    });
  }

  test("the handle sits on the divider, which starts on the fold's line", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));

    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD,
    });
    expect(screen.getByTestId("pane-divider")).toHaveStyle({
      left: ON_THE_FOLD - 20,
    });
  });

  test("the list follows the finger, and keeps the width it is let go at", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));

    await drag(442, 512);
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD + 70,
    });

    await letGo(512);
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD + 70,
    });
    expect(screen.getByTestId("list-pane-report")).toHaveTextContent(
      `list/row/${ON_THE_FOLD + 70}/`,
      { exact: false },
    );
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBe(
        String(ON_THE_FOLD + 70),
      );
    });
  });

  test("a drag moves the pane without drawing the list again on every move", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));
    const before: number = renders.list;

    const handle: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pane-divider");
    await fireEvent(handle, "responderGrant", { nativeEvent: { pageX: 442 } });
    for (const pageX of [452, 462, 472, 482]) {
      await fireEvent(handle, "responderMove", { nativeEvent: { pageX } });
    }

    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD + 40,
    });
    expect(renders.list).toBe(before);
  });

  test("while it is dragged, the screens inside keep the width they were laid out for", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));

    await drag(442, 512);

    expect(screen.getByTestId("list-pane-report")).toHaveTextContent(
      `list/row/${ON_THE_FOLD}/`,
      { exact: false },
    );
  });

  test("half closed, the divider goes back onto the fold and the handle goes; flat again, it returns to the reader's width", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const source: FakeSource = fakeSource(INNER_FLAT);
    await renderStack(source);
    await drag(442, 482);
    await letGo(482);

    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreen, [bookFold(442, 1104)]));
    });
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD,
    });
    expect(screen.queryByTestId("pane-divider")).toBeNull();

    await act(async () => {
      source.emit(INNER_FLAT);
    });
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD + 40,
    });
  });

  test("a drag the window takes away is dropped: half closed mid-drag, the divider comes back where it was", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const source: FakeSource = fakeSource(INNER_FLAT);
    await renderStack(source);

    // Half closed while the finger is still on the handle.
    await drag(442, 502);
    await act(async () => {
      source.emit(report(TEST_WINDOWS.innerScreen, [bookFold(442, 1104)]));
    });
    await act(async () => {
      source.emit(INNER_FLAT);
    });

    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD,
    });
    expect(await AsyncStorage.getItem(LIST_PANE_WIDTH_KEY)).toBeNull();
  });

  test("a drag the system cancels leaves the divider where it was", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));

    await drag(442, 512);
    await fireEvent(screen.getByTestId("pane-divider"), "responderTerminate", {
      nativeEvent: { pageX: 512 },
    });

    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: ON_THE_FOLD,
    });
  });

  test("a record open beside the list stays mounted while the divider moves", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack(fakeSource(INNER_FLAT));
    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.changeText(screen.getByTestId("note-a"), "Half a note");

    await drag(442, 482);
    await letGo(482);

    expect(screen.getByTestId("note-a")).toHaveProp("value", "Half a note");
    expect(mounts.detail.a).toBe(1);
  });
});

describe("Where nothing reports the posture", () => {
  test("the divider has no handle, as before", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await AsyncStorage.setItem(LIST_PANE_WIDTH_KEY, "400");
    await renderStack(null);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("pane-divider")).toBeNull();
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: 442 - (NAVIGATION_RAIL_WIDTH + INSETS.left),
    });
  });
});
