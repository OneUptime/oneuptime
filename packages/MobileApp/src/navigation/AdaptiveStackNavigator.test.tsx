import React, { useContext, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
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
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { getDefaultHeaderHeight } from "@react-navigation/elements";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  createAdaptiveStackNavigator,
  getDetailSelection,
  getSplitDescriptors,
} from "./createAdaptiveStackNavigator";
import { useListPane, usePaneState } from "./paneState";
import { usePane } from "../layout/WindowLayout";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

/*
 * The navigator behind the Inbox, Monitors and On-Call tabs, with screens
 * small enough to see what it does: a list that keeps a search in its pane
 * state, and a detail that keeps a half-typed note and an open dialog in
 * plain component state - exactly what a fold must not throw away.
 *
 * Folding and unfolding are done the way the device does them, by changing
 * React Native's window size while the screens are on screen.
 */

type TestParamList = {
  List: undefined;
  Detail: { id: string };
  Deeper: { id: string };
  Sheet: undefined;
};

type ListNavigation = NativeStackNavigationProp<TestParamList, "List">;

const mounts: { list: number; detail: Record<string, number> } = {
  list: 0,
  detail: {},
};

function InsetsReport({ testID }: { testID: string }): React.JSX.Element {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return (
    <Text
      testID={testID}
    >{`${insets?.left ?? "-"},${insets?.right ?? "-"}`}</Text>
  );
}

function ListScreen(): React.JSX.Element {
  const navigation: ListNavigation = useNavigation<ListNavigation>();
  const [search, setSearch] = usePaneState<string>("test.search", "");
  const listPane: ReturnType<typeof useListPane> = useListPane();
  const pane: ReturnType<typeof usePane> = usePane();

  useEffect((): void => {
    mounts.list += 1;
  }, []);

  return (
    <View testID="list-screen">
      <TextInput testID="list-search" value={search} onChangeText={setSearch} />
      <Text testID="list-pane-kind">{pane.kind}</Text>
      <Text testID="list-beside-detail">{String(listPane.besideDetail)}</Text>
      <InsetsReport testID="list-insets" />
      {["a", "b"].map((id: string): React.JSX.Element => {
        return (
          <Pressable
            key={id}
            testID={`open-${id}`}
            accessibilityRole="button"
            accessibilityState={{
              selected: listPane.isOpen("Detail", { id }),
            }}
            onPress={(): void => {
              navigation.navigate("Detail", { id });
            }}
          >
            <Text>{`Row ${id}`}</Text>
          </Pressable>
        );
      })}
      <Pressable
        testID="open-sheet"
        onPress={(): void => {
          navigation.navigate("Sheet");
        }}
      >
        <Text>Sheet</Text>
      </Pressable>
    </View>
  );
}

function DetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<TestParamList, "Detail">): React.JSX.Element {
  const [note, setNote] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const pane: ReturnType<typeof usePane> = usePane();
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
      <Text testID={`detail-pane-kind-${id}`}>{pane.kind}</Text>
      <InsetsReport testID={`detail-insets-${id}`} />
      <Pressable
        testID={`open-deeper-${id}`}
        onPress={(): void => {
          navigation.navigate("Deeper", { id: `${id}-deeper` });
        }}
      >
        <Text>Deeper</Text>
      </Pressable>
    </View>
  );
}

function DeeperScreen({
  route,
}: NativeStackScreenProps<TestParamList, "Deeper">): React.JSX.Element {
  return <Text testID={`deeper-${route.params.id}`}>Deeper</Text>;
}

function SheetScreen(): React.JSX.Element {
  return <Text testID="sheet">Sheet</Text>;
}

function EmptyDetail(): React.JSX.Element {
  return <Text testID="empty-detail">Choose a row</Text>;
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
      <Stack.Screen
        name="Detail"
        component={DetailScreen}
        options={{ title: "Incident" }}
      />
      <Stack.Screen
        name="Deeper"
        component={DeeperScreen}
        options={{ title: "Deeper" }}
      />
      <Stack.Screen
        name="Sheet"
        component={SheetScreen}
        options={{ presentation: "modal" }}
      />
    </Stack.Navigator>
  );
}

const INSETS: EdgeInsets = { top: 24, right: 40, bottom: 16, left: 30 };

async function renderStack(): Promise<
  NavigationContainerRefWithCurrent<ParamListBase>
> {
  const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
    createNavigationContainerRef<ParamListBase>();
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <NavigationContainer ref={navigationRef}>
        <TestStack />
      </NavigationContainer>
    </SafeAreaInsetsContext.Provider>,
  );
  return navigationRef;
}

function stackRouteNames(
  navigationRef: NavigationContainerRefWithCurrent<ParamListBase>,
): Array<string> {
  const state: NavigationState | undefined = navigationRef.getRootState();
  return (state?.routes ?? []).map(
    (route: NavigationState["routes"][number]): string => {
      return route.name;
    },
  );
}

afterEach(() => {
  resetWindowSize();
  mounts.list = 0;
  mounts.detail = {};
});

describe("On a phone it is the native stack it replaced", () => {
  test("the list is the first screen and a row pushes its record over it", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    expect(screen.queryByTestId("list-pane")).toBeNull();
    expect(screen.getByTestId("list-pane-kind")).toHaveTextContent("full");
    expect(screen.getByTestId("list-beside-detail")).toHaveTextContent("false");

    await fireEvent.press(screen.getByTestId("open-a"));

    expect(navigationRef.getCurrentRoute()?.name).toBe("Detail");
    expect(navigationRef.canGoBack()).toBe(true);
    expect(screen.getByTestId("detail-pane-kind-a")).toHaveTextContent("full");
  });

  test("a screen that touches both window edges keeps both insets", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    await renderStack();

    expect(screen.getByTestId("list-insets")).toHaveTextContent("30,40");
  });
});

describe("On an unfolded foldable the list and its detail sit side by side", () => {
  test("the list has a pane of its own, headed by the project switcher, beside an empty detail", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();

    const listPane: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("list-pane");
    expect(within(listPane).getByTestId("list-screen")).toBeTruthy();
    expect(within(listPane).getByTestId("project-switcher-stub")).toBeTruthy();
    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("empty-detail"),
    ).toBeTruthy();
    expect(screen.getByTestId("list-pane-kind")).toHaveTextContent("list");
    expect(screen.getByTestId("list-beside-detail")).toHaveTextContent("true");
  });

  test("the list pane is as wide as the layout rules say, divided from the detail by a hairline", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();

    // 884 points with a 30-point left inset: the rail is 110 wide, the list 332.
    expect(screen.getByTestId("list-pane")).toHaveStyle({
      width: 442 - 110,
      borderRightWidth: 1,
    });
  });

  test("each pane keeps only the safe area of the window edge it touches", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();
    await fireEvent.press(screen.getByTestId("open-a"));

    expect(screen.getByTestId("list-insets")).toHaveTextContent("30,0");
    expect(screen.getByTestId("detail-insets-a")).toHaveTextContent("0,40");
    expect(screen.getByTestId("detail-pane-kind-a")).toHaveTextContent(
      "detail",
    );
  });

  test("a row opens its record on the right, and the row is marked", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));

    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("detail-a"),
    ).toBeTruthy();
    expect(stackRouteNames(navigationRef)).toEqual(["List", "Detail"]);
    expect(screen.getByTestId("open-a")).toBeSelected();
    expect(screen.getByTestId("open-b")).not.toBeSelected();
  });

  test("the next row replaces the open record instead of stacking on it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.press(screen.getByTestId("open-b"));

    expect(stackRouteNames(navigationRef)).toEqual(["List", "Detail"]);
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ id: "b" });
    expect(screen.getByTestId("open-b")).toBeSelected();
    expect(screen.getByTestId("open-a")).not.toBeSelected();
  });

  test("a screen opened inside the detail pane pushes there, and the row stays marked", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.press(screen.getByTestId("open-deeper-a"));

    expect(stackRouteNames(navigationRef)).toEqual([
      "List",
      "Detail",
      "Deeper",
    ]);
    expect(screen.getByTestId("open-a")).toBeSelected();
  });

  test("a sheet opens over the detail pane without replacing what is in it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.press(screen.getByTestId("open-sheet"));

    expect(stackRouteNames(navigationRef)).toEqual(["List", "Detail", "Sheet"]);
    expect(screen.getByTestId("open-a")).toBeSelected();
  });

  test("Back closes the detail pane and leaves the list where it was", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await act(async (): Promise<void> => {
      navigationRef.goBack();
    });

    expect(stackRouteNames(navigationRef)).toEqual(["List"]);
    expect(screen.getByTestId("empty-detail")).toBeTruthy();
    expect(mounts.list).toBe(1);
  });
});

describe("The list pane's header", () => {
  /*
   * The list's header is drawn in JavaScript beside the detail pane's native
   * bar, and React Navigation sizes it by the frame the navigator is laid
   * out in. On the iPhone Duo held open that frame is wider than tall, and
   * React Navigation would draw an iPhone on its side's 32-point header; the
   * list gets the regular bar's height there instead, and keeps React
   * Navigation's own everywhere else.
   *
   * A test renderer never lays anything out, so each test reports the
   * window's frame to the navigator the way a device's first layout does.
   */
  async function layOutAs(size: {
    width: number;
    height: number;
  }): Promise<void> {
    let node: unknown = screen.getByTestId("list-pane");
    while (
      node &&
      !(node as { props: { onLayout?: unknown } }).props.onLayout
    ) {
      node = (node as { parent: unknown }).parent;
    }
    if (!node) {
      throw new Error("nothing above the list pane measures its frame");
    }
    await fireEvent(node as Parameters<typeof fireEvent>[0], "layout", {
      nativeEvent: { layout: { x: 0, y: 0, ...size } },
    });
  }

  function listHeaderHeight(): unknown {
    const header: unknown = screen.getByTestId("list-pane").children[0];
    if (!header || typeof header === "string") {
      throw new Error("the list pane has no header");
    }
    const style: ViewStyle = StyleSheet.flatten(
      (header as { props: { style: unknown } }).props.style as ViewStyle,
    );
    return style.height;
  }

  test("on the iPhone Duo held open it is as tall as the regular bar, not an iPhone on its side's", async () => {
    setWindowSize(TEST_WINDOWS.iPhoneDuoOpen);
    await renderStack();
    await layOutAs(TEST_WINDOWS.iPhoneDuoOpen);

    // What React Navigation gives the same window held upright.
    expect(listHeaderHeight()).toBe(
      getDefaultHeaderHeight({ width: 669, height: 951 }, false, INSETS.top),
    );
    expect(listHeaderHeight()).toBe(
      Platform.OS === "ios" ? 44 + INSETS.top : 64 + INSETS.top,
    );
  });

  test("on an unfolded foldable it keeps React Navigation's own height", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();
    await layOutAs(TEST_WINDOWS.innerScreen);

    expect(listHeaderHeight()).toBe(
      getDefaultHeaderHeight(TEST_WINDOWS.innerScreen, false, INSETS.top),
    );
  });
});

describe("Nothing is lost when the phone folds or unfolds", () => {
  test("folding keeps the open record, its half-written note and its open dialog", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.changeText(
      screen.getByTestId("note-a"),
      "Rolled back the deploy; watching",
    );
    await fireEvent.press(screen.getByTestId("open-dialog-a"));

    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(screen.queryByTestId("list-pane")).toBeNull();
    expect(navigationRef.getCurrentRoute()?.name).toBe("Detail");
    expect(screen.getByTestId("note-a")).toHaveProp(
      "value",
      "Rolled back the deploy; watching",
    );
    expect(screen.getByTestId("dialog-a")).toBeTruthy();
    // Kept, not rebuilt: the record's screen was never drawn a second time.
    expect(mounts.detail.a).toBe(1);
    expect(screen.getByTestId("detail-pane-kind-a")).toHaveTextContent("full");
  });

  test("and on the folded phone Back leads to the list, as it always has", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await resizeWindow(TEST_WINDOWS.coverScreen);
    await act(async (): Promise<void> => {
      navigationRef.goBack();
    });

    expect(navigationRef.getCurrentRoute()?.name).toBe("List");
  });

  test("unfolding puts the record that was open on the phone beside the list, still as it was", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-b"));
    await fireEvent.changeText(screen.getByTestId("note-b"), "Paging DB team");
    await fireEvent.press(screen.getByTestId("open-dialog-b"));

    await resizeWindow(TEST_WINDOWS.innerScreen);

    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("detail-b"),
    ).toBeTruthy();
    expect(screen.getByTestId("note-b")).toHaveProp("value", "Paging DB team");
    expect(screen.getByTestId("dialog-b")).toBeTruthy();
    expect(mounts.detail.b).toBe(1);
    expect(stackRouteNames(navigationRef)).toEqual(["List", "Detail"]);
    expect(screen.getByTestId("open-b")).toBeSelected();
  });

  test("a fold and an unfold in a row change nothing at all", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderStack();

    await fireEvent.press(screen.getByTestId("open-a"));
    await fireEvent.changeText(screen.getByTestId("note-a"), "Draft");
    const before: NavigationState | undefined = navigationRef.getRootState();

    await resizeWindow(TEST_WINDOWS.coverScreen);
    await resizeWindow(TEST_WINDOWS.innerScreen);
    await resizeWindow(TEST_WINDOWS.innerScreenOnItsSide);

    expect(navigationRef.getRootState()).toEqual(before);
    expect(screen.getByTestId("note-a")).toHaveProp("value", "Draft");
    expect(mounts.detail.a).toBe(1);
  });

  test("the list is drawn afresh in its new place, and comes back with the search typed into it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();

    await fireEvent.changeText(screen.getByTestId("list-search"), "checkout");
    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(mounts.list).toBe(2);
    expect(screen.getByTestId("list-search")).toHaveProp("value", "checkout");

    await resizeWindow(TEST_WINDOWS.innerScreen);

    expect(mounts.list).toBe(3);
    expect(
      within(screen.getByTestId("list-pane")).getByTestId("list-search"),
    ).toHaveProp("value", "checkout");
  });

  test("a resize that keeps the same layout redraws nothing", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderStack();
    await fireEvent.press(screen.getByTestId("open-a"));

    await resizeWindow(TEST_WINDOWS.iPhoneDuoOpen);

    expect(mounts.list).toBe(1);
    expect(mounts.detail.a).toBe(1);
  });
});

/*
 * On-Call's shape: the first screen is a menu as much as a list, and the
 * pane beside it shows one of the stack's own screens (the roster) until
 * something else is opened, rather than a placeholder that repeats the menu.
 */
type MenuParamList = {
  Menu: undefined;
  Roster: undefined;
  Pages: undefined;
  Cover: undefined;
};

type MenuNavigation = NativeStackNavigationProp<MenuParamList, "Menu">;

const rosterMounts: { count: number } = { count: 0 };

function MenuScreen(): React.JSX.Element {
  const navigation: MenuNavigation = useNavigation<MenuNavigation>();
  const listPane: ReturnType<typeof useListPane> = useListPane();

  return (
    <View testID="menu-screen">
      {(["Roster", "Pages"] as const).map(
        (name: "Roster" | "Pages"): React.JSX.Element => {
          return (
            <Pressable
              key={name}
              testID={`menu-${name}`}
              accessibilityRole="button"
              accessibilityState={{ selected: listPane.isOpen(name) }}
              onPress={(): void => {
                navigation.navigate(name);
              }}
            >
              <Text>{name}</Text>
            </Pressable>
          );
        },
      )}
      <Pressable
        testID="menu-cover"
        onPress={(): void => {
          navigation.navigate("Cover");
        }}
      >
        <Text>Cover</Text>
      </Pressable>
    </View>
  );
}

function RosterScreen(): React.JSX.Element {
  useEffect((): void => {
    rosterMounts.count += 1;
  }, []);
  return <Text testID="roster">Who is on call</Text>;
}

function PagesScreen(): React.JSX.Element {
  return <Text testID="pages">Pages sent to me</Text>;
}

function CoverScreen(): React.JSX.Element {
  return <Text testID="cover">Arrange coverage</Text>;
}

const MenuStack: ReturnType<
  typeof createAdaptiveStackNavigator<MenuParamList>
> = createAdaptiveStackNavigator<MenuParamList>();

const MENU_OVERLAYS: ReadonlyArray<string> = ["Cover"];

function TestMenuStack(): React.JSX.Element {
  return (
    <MenuStack.Navigator
      emptyDetail={RosterScreen}
      emptyDetailRouteName="Roster"
      overlayRouteNames={MENU_OVERLAYS}
    >
      <MenuStack.Screen name="Menu" component={MenuScreen} />
      <MenuStack.Screen name="Roster" component={RosterScreen} />
      <MenuStack.Screen name="Pages" component={PagesScreen} />
      <MenuStack.Screen
        name="Cover"
        component={CoverScreen}
        options={{ presentation: "modal" }}
      />
    </MenuStack.Navigator>
  );
}

async function renderMenuStack(): Promise<
  NavigationContainerRefWithCurrent<ParamListBase>
> {
  const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
    createNavigationContainerRef<ParamListBase>();
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <NavigationContainer ref={navigationRef}>
        <TestMenuStack />
      </NavigationContainer>
    </SafeAreaInsetsContext.Provider>,
  );
  return navigationRef;
}

describe("A pane that shows one of the stack's own screens until something is opened", () => {
  afterEach(() => {
    rosterMounts.count = 0;
  });

  test("beside the menu it shows that screen, and the menu marks its row as the one showing", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("roster"),
    ).toBeTruthy();
    expect(screen.getByTestId("menu-Roster")).toBeSelected();
    expect(screen.getByTestId("menu-Pages")).not.toBeSelected();
    // Drawn, not opened: nothing was put on the stack.
    expect(stackRouteNames(navigationRef)).toEqual(["Menu"]);
  });

  test("opening another row moves the mark to it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    await fireEvent.press(screen.getByTestId("menu-Pages"));

    expect(
      within(screen.getByTestId("detail-pane")).getByTestId("pages"),
    ).toBeTruthy();
    expect(screen.getByTestId("menu-Pages")).toBeSelected();
    expect(screen.getByTestId("menu-Roster")).not.toBeSelected();
    expect(stackRouteNames(navigationRef)).toEqual(["Menu", "Pages"]);
  });

  test("its own row opens it for real, so a fold keeps it on screen", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    await fireEvent.press(screen.getByTestId("menu-Roster"));

    expect(stackRouteNames(navigationRef)).toEqual(["Menu", "Roster"]);
    expect(screen.getByTestId("menu-Roster")).toBeSelected();

    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(navigationRef.getCurrentRoute()?.name).toBe("Roster");
  });

  test("a sheet opened from the menu covers the screen without taking its mark", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    await fireEvent.press(screen.getByTestId("menu-cover"));

    expect(stackRouteNames(navigationRef)).toEqual(["Menu", "Cover"]);
    expect(screen.getByTestId("cover")).toBeTruthy();
    expect(screen.getByTestId("menu-Roster")).toBeSelected();
  });

  test("on a phone the menu is the screen, nothing is marked and the stand-in is never drawn", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    expect(screen.getByTestId("menu-screen")).toBeTruthy();
    expect(screen.queryByTestId("roster")).toBeNull();
    expect(rosterMounts.count).toBe(0);
    expect(screen.getByTestId("menu-Roster")).not.toBeSelected();
    expect(stackRouteNames(navigationRef)).toEqual(["Menu"]);
  });

  test("folding with nothing opened returns to the menu, not to the screen that stood in", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      await renderMenuStack();

    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(screen.getByTestId("menu-screen")).toBeTruthy();
    expect(screen.queryByTestId("roster")).toBeNull();
    expect(stackRouteNames(navigationRef)).toEqual(["Menu"]);
  });
});

describe("Re-tapping the tab", () => {
  test("returns the stack to its list, closing the detail pane", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const Tabs: ReturnType<typeof createBottomTabNavigator> =
      createBottomTabNavigator();
    const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
      createNavigationContainerRef<ParamListBase>();
    jest.useFakeTimers();
    try {
      await render(
        <SafeAreaInsetsContext.Provider value={INSETS}>
          <NavigationContainer ref={navigationRef}>
            <Tabs.Navigator>
              <Tabs.Screen
                name="Inbox"
                component={TestStack}
                options={{
                  headerShown: false,
                  tabBarAccessibilityLabel: "Inbox",
                }}
              />
            </Tabs.Navigator>
          </NavigationContainer>
        </SafeAreaInsetsContext.Provider>,
      );

      await fireEvent.press(screen.getByTestId("open-a"));
      await fireEvent.press(screen.getByLabelText("Inbox"));
      await act(async (): Promise<void> => {
        jest.runOnlyPendingTimers();
      });

      const tabState: NavigationState | undefined =
        navigationRef.getRootState();
      const stackState: StackNavigationState<ParamListBase> = tabState
        ?.routes[0]?.state as StackNavigationState<ParamListBase>;
      expect(
        stackState.routes.map(
          (route: StackNavigationState<ParamListBase>["routes"][number]) => {
            return route.name;
          },
        ),
      ).toEqual(["List"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("What the detail pane draws from", () => {
  type Descriptors = Parameters<typeof getSplitDescriptors>[0];
  type Descriptor = Descriptors[string];

  function descriptor(
    name: string,
    options: Record<string, unknown>,
    render: () => React.JSX.Element,
  ): Descriptor {
    return {
      route: { key: `${name}-key`, name },
      navigation: {},
      options,
      render,
    } as unknown as Descriptor;
  }

  function state(
    routes: Array<{
      key: string;
      name: string;
      params?: Record<string, unknown>;
    }>,
  ): StackNavigationState<ParamListBase> {
    return {
      stale: false,
      type: "stack",
      key: "stack",
      index: routes.length - 1,
      routeNames: ["List", "Detail", "Deeper", "Sheet"],
      preloadedRoutes: [],
      routes: routes as StackNavigationState<ParamListBase>["routes"],
    };
  }

  const LIST_RENDER: () => React.JSX.Element = (): React.JSX.Element => {
    return <Text>list</Text>;
  };
  const DETAIL_RENDER: () => React.JSX.Element = (): React.JSX.Element => {
    return <Text>detail</Text>;
  };

  const descriptors: Descriptors = {
    "List-key": descriptor(
      "List",
      {
        title: "Inbox",
        headerTitle: () => {
          return null;
        },
      },
      LIST_RENDER,
    ),
    "Detail-key": descriptor(
      "Detail",
      {
        title: "Incident",
        headerTitle: () => {
          return null;
        },
      },
      DETAIL_RENDER,
    ),
    "Deeper-key": descriptor("Deeper", { title: "Deeper" }, DETAIL_RENDER),
    "Sheet-key": descriptor("Sheet", { presentation: "modal" }, DETAIL_RENDER),
  };

  test("its first screen shows the empty detail, under the same empty bar as the record the list opens", () => {
    const result: Descriptors = getSplitDescriptors(
      descriptors,
      state([{ key: "List-key", name: "List" }]),
      EmptyDetail,
      OVERLAYS,
    );
    const options: Record<string, unknown> = result["List-key"]
      ?.options as Record<string, unknown>;

    /*
     * The same bar as the opened record's, so the pane's content sits level
     * with the list's and does not jump when the first record opens: no
     * title (the project switcher heads the list now), no Back.
     */
    expect(options["headerShown"]).not.toBe(false);
    expect(options["headerTitle"]).toBe("");
    expect(options["headerBackVisible"]).toBe(false);
    expect((options["headerLeft"] as () => unknown)()).toBeNull();
    const element: React.ReactElement<{
      route: unknown;
      navigation: unknown;
      children: React.ReactElement;
    }> = result["List-key"]?.render() as React.ReactElement<{
      route: unknown;
      navigation: unknown;
      children: React.ReactElement;
    }>;
    // Drawn with the list route's own navigation, so what it opens fills the pane.
    expect(element.props.route).toBe(descriptors["List-key"]?.route);
    expect(element.props.navigation).toBe(descriptors["List-key"]?.navigation);
    expect(element.props.children.type).toBe(EmptyDetail);
  });

  test("the record opened from the list has an empty bar - no title, no Back, no back swipe - and appears without a push", () => {
    const result: Descriptors = getSplitDescriptors(
      descriptors,
      state([
        { key: "List-key", name: "List" },
        { key: "Detail-key", name: "Detail" },
      ]),
      EmptyDetail,
      OVERLAYS,
    );
    const options: Record<string, unknown> = result["Detail-key"]
      ?.options as Record<string, unknown>;

    // The screen opens on its own title; the bar only keeps the panes level.
    expect(options["headerTitle"]).toBe("");
    expect(options["headerBackVisible"]).toBe(false);
    expect((options["headerLeft"] as () => unknown)()).toBeNull();
    expect(options["gestureEnabled"]).toBe(false);
    expect(options["animation"]).toBe("none");
    // The screen itself is untouched: the same render, so it is never redrawn.
    expect(result["Detail-key"]?.render).toBe(DETAIL_RENDER);
  });

  test("a screen opened inside the pane keeps its Back button and its push", () => {
    const result: Descriptors = getSplitDescriptors(
      descriptors,
      state([
        { key: "List-key", name: "List" },
        { key: "Detail-key", name: "Detail" },
        { key: "Deeper-key", name: "Deeper" },
      ]),
      EmptyDetail,
      OVERLAYS,
    );
    const options: Record<string, unknown> = result["Deeper-key"]
      ?.options as Record<string, unknown>;

    // No title: the screen opens on its own, and the switcher heads the list.
    expect(options["headerTitle"]).toBe("");
    expect(options["headerBackVisible"]).toBeUndefined();
    expect(options["headerLeft"]).toBeUndefined();
    expect(options["animation"]).toBeUndefined();
  });

  test("a sheet opened straight from the list is not treated as the pane's record", () => {
    const result: Descriptors = getSplitDescriptors(
      descriptors,
      state([
        { key: "List-key", name: "List" },
        { key: "Sheet-key", name: "Sheet" },
      ]),
      EmptyDetail,
      OVERLAYS,
    );

    expect(
      (result["Sheet-key"]?.options as Record<string, unknown>)[
        "headerBackVisible"
      ],
    ).toBeUndefined();
    expect(
      getDetailSelection(
        state([
          { key: "List-key", name: "List" },
          { key: "Sheet-key", name: "Sheet" },
        ]),
        OVERLAYS,
      ),
    ).toBeNull();
  });

  test("the selection is the screen opened from the list, however deep the pane goes", () => {
    expect(
      getDetailSelection(
        state([
          { key: "List-key", name: "List" },
          { key: "Detail-key", name: "Detail", params: { id: "a" } },
          { key: "Deeper-key", name: "Deeper", params: { id: "x" } },
        ]),
        OVERLAYS,
      ),
    ).toEqual({ name: "Detail", params: { id: "a" } });
    expect(
      getDetailSelection(state([{ key: "List-key", name: "List" }]), OVERLAYS),
    ).toBeNull();
  });

  test("while nothing is open, an empty pane that is one of the stack's screens is the selection", () => {
    // On-Call's pane shows the roster until something else is opened.
    expect(
      getDetailSelection(
        state([{ key: "List-key", name: "List" }]),
        OVERLAYS,
        "Roster",
      ),
    ).toEqual({ name: "Roster" });
    // A sheet opened from the list sits over the empty pane, not in its place.
    expect(
      getDetailSelection(
        state([
          { key: "List-key", name: "List" },
          { key: "Sheet-key", name: "Sheet" },
        ]),
        OVERLAYS,
        "Roster",
      ),
    ).toEqual({ name: "Roster" });
    // Anything opened from the list takes the selection over.
    expect(
      getDetailSelection(
        state([
          { key: "List-key", name: "List" },
          { key: "Detail-key", name: "Detail", params: { id: "a" } },
        ]),
        OVERLAYS,
        "Roster",
      ),
    ).toEqual({ name: "Detail", params: { id: "a" } });
  });
});
