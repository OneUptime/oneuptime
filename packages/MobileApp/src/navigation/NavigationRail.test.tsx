import React from "react";
import { Platform, StyleSheet, type ViewStyle } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
} from "@react-navigation/native";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MainTabNavigator from "./MainTabNavigator";
import type { MainTabParamList } from "./types";
import { NAVIGATION_RAIL_WIDTH } from "../layout/windowLayout";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";

/*
 * Where the five destinations go, by the window.
 *
 * A bar along the bottom on a phone held upright and on a foldable's cover
 * screen; a rail down the left on a window wide enough for two panes, and on
 * a phone on its side, where a bottom bar would take a fifth of the height.
 * Moving from one to the other is a fold or a rotation in the middle of
 * whatever somebody was doing, so a tab's screen must come through it
 * untouched - the Home stub here keeps a typed value to prove it.
 */

jest.mock("./ProjectNavigationSync", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../components/ProjectSwitcher", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

const mockHomeMounts: { current: number } = { current: 0 };

jest.mock("../screens/HomeScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const RN: typeof import("react-native") = jest.requireActual("react-native");
  const SafeArea: typeof import("react-native-safe-area-context") =
    jest.requireActual("react-native-safe-area-context");
  return {
    __esModule: true,
    default: function HomeStub(): React.JSX.Element {
      const [draft, setDraft] = ReactModule.useState<string>("");
      const insets: EdgeInsets | null = ReactModule.useContext(
        SafeArea.SafeAreaInsetsContext,
      );
      ReactModule.useEffect((): void => {
        mockHomeMounts.current += 1;
      }, []);
      return ReactModule.createElement(
        RN.View,
        null,
        ReactModule.createElement(RN.TextInput, {
          testID: "home-draft",
          value: draft,
          onChangeText: setDraft,
        }),
        ReactModule.createElement(
          RN.Text,
          { testID: "home-insets" },
          `${insets?.left ?? "-"},${insets?.right ?? "-"}`,
        ),
      );
    },
  };
});

function mockStub(testID: string): {
  __esModule: true;
  default: () => React.JSX.Element;
} {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };
  return {
    __esModule: true,
    default: function Stub(): React.JSX.Element {
      return ReactModule.createElement(TextComponent, { testID }, testID);
    },
  };
}

jest.mock("./MonitorsStackNavigator", () => {
  return mockStub("screen-monitors");
});
jest.mock("./InboxStackNavigator", () => {
  return mockStub("screen-inbox");
});
jest.mock("./OnCallStackNavigator", () => {
  return mockStub("screen-oncall");
});
jest.mock("./SettingsStackNavigator", () => {
  return mockStub("screen-settings");
});

// An iPhone-like inset set: a camera on the left side when it is on its side.
const INSETS: EdgeInsets = { top: 24, right: 12, bottom: 21, left: 59 };

async function renderTabs(): Promise<
  NavigationContainerRefWithCurrent<MainTabParamList>
> {
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    createNavigationContainerRef<MainTabParamList>();
  await render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <NavigationContainer ref={navigationRef}>
        <MainTabNavigator />
      </NavigationContainer>
    </SafeAreaInsetsContext.Provider>,
  );
  return navigationRef;
}

function options(
  navigationRef: NavigationContainerRefWithCurrent<MainTabParamList>,
): BottomTabNavigationOptions {
  return (navigationRef.getCurrentOptions() ??
    {}) as BottomTabNavigationOptions;
}

function tabBarStyle(
  navigationRef: NavigationContainerRefWithCurrent<MainTabParamList>,
): ViewStyle {
  return StyleSheet.flatten(options(navigationRef).tabBarStyle) as ViewStyle;
}

afterEach(() => {
  resetWindowSize();
  mockHomeMounts.current = 0;
});

describe("A wide window puts the destinations on a rail", () => {
  test.each([
    ["an unfolded Galaxy Z Fold", TEST_WINDOWS.innerScreen],
    [
      "an unfolded Galaxy Z Fold on its side",
      TEST_WINDOWS.innerScreenOnItsSide,
    ],
    ["the iPhone Duo held open", TEST_WINDOWS.iPhoneDuoOpen],
    ["a phone on its side", TEST_WINDOWS.phoneOnItsSide],
  ])("%s", async (_label: string, size: { width: number; height: number }) => {
    setWindowSize(size);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    expect(options(navigationRef).tabBarPosition).toBe("left");
    expect(options(navigationRef).tabBarVariant).toBe("material");
    // TabIcon draws the selection pill; the item must not be tinted as well.
    expect(options(navigationRef).tabBarActiveBackgroundColor).toBe(
      "transparent",
    );
  });

  test("the rail is 80 points plus the inset it covers, with a hairline on its inner edge", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();
    const style: ViewStyle = tabBarStyle(navigationRef);

    expect(style.width).toBe(NAVIGATION_RAIL_WIDTH + INSETS.left);
    expect(style.paddingStart).toBe(INSETS.left);
    expect(style.paddingTop).toBe(INSETS.top + 12);
    expect(style.paddingBottom).toBe(INSETS.bottom + 12);
    expect(style.borderRightWidth).toBe(1);
    expect(style.borderTopWidth).toBe(0);
    // Not floating over the content, as the bottom bar does.
    expect(style.position).toBeUndefined();
  });

  test("Home's header is the regular bar's height on the iPhone Duo held open, and React Navigation's own elsewhere", async () => {
    /*
     * React Navigation would give an iPhone window wider than tall the
     * 32-point header of a phone on its side; the iPhone Duo held open has
     * a regular height, where iOS draws the 44-point bar.
     */
    setWindowSize(TEST_WINDOWS.iPhoneDuoOpen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();
    const headerStyle: () => ViewStyle = (): ViewStyle => {
      return StyleSheet.flatten(
        options(navigationRef).headerStyle,
      ) as ViewStyle;
    };

    expect(headerStyle().height).toBe(
      Platform.OS === "ios" ? 44 + INSETS.top : undefined,
    );

    await resizeWindow(TEST_WINDOWS.phoneOnItsSide);
    expect(headerStyle().height).toBeUndefined();

    await resizeWindow(TEST_WINDOWS.coverScreen);
    expect(headerStyle().height).toBeUndefined();
  });

  test("every destination keeps its written label and its name", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderTabs();

    for (const name of ["Home", "Monitors", "Inbox", "On-Call", "Settings"]) {
      expect(screen.getByText(name)).toBeTruthy();
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect(screen.getByLabelText("Inbox")).toBeTruthy();
  });

  test("and still takes the reader where it says", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    await fireEvent.press(screen.getByLabelText("Inbox"));

    expect(navigationRef.getCurrentRoute()?.name).toBe("Inbox");
    expect(screen.getByTestId("screen-inbox")).toBeTruthy();
  });

  test("five destinations fit a phone's height on its side, below the home indicator", async () => {
    /*
     * 393 points tall, 21 of them the home indicator: each item is at least
     * 56 points with 2 above and below, and the rail pads 12 at each end.
     */
    setWindowSize(TEST_WINDOWS.phoneOnItsSide);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();
    const item: ViewStyle = StyleSheet.flatten(
      options(navigationRef).tabBarItemStyle,
    ) as ViewStyle;
    const style: ViewStyle = tabBarStyle(navigationRef);
    const itemHeight: number =
      Number(item.minHeight) + 2 * Number(item.marginVertical);
    const railContent: number =
      5 * Math.max(itemHeight, 62) +
      Number(style.paddingTop) +
      Number(style.paddingBottom);

    expect(railContent).toBeLessThanOrEqual(TEST_WINDOWS.phoneOnItsSide.height);
    expect(Number(item.minHeight)).toBeGreaterThanOrEqual(48);
  });

  test("the rail stays usable while the keyboard is up; only the bottom bar hides for it", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();
    expect(options(navigationRef).tabBarHideOnKeyboard).toBe(false);

    await resizeWindow(TEST_WINDOWS.coverScreen);
    expect(options(navigationRef).tabBarHideOnKeyboard).toBe(true);
  });

  test("screens beside the rail have no left inset to keep clear: the rail already covers it", async () => {
    setWindowSize(TEST_WINDOWS.phoneOnItsSide);
    await renderTabs();

    expect(screen.getByTestId("home-insets")).toHaveTextContent(
      `0,${INSETS.right}`,
    );
  });
});

describe("A narrow window keeps the bar along the bottom", () => {
  test.each([
    ["a Galaxy Z Fold's cover screen", TEST_WINDOWS.coverScreen],
    ["a tablet held upright", TEST_WINDOWS.tabletUpright],
  ])("%s", async (_label: string, size: { width: number; height: number }) => {
    setWindowSize(size);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();
    const style: ViewStyle = tabBarStyle(navigationRef);

    expect(options(navigationRef).tabBarPosition).toBe("bottom");
    expect(options(navigationRef).tabBarVariant).toBe("uikit");
    expect(style.position).toBe("absolute");
    expect(style.bottom).toBe(0);
    expect(style.height).toBe(72 + INSETS.bottom);
  });

  test("and the screens above it keep both side insets", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    await renderTabs();

    expect(screen.getByTestId("home-insets")).toHaveTextContent(
      `${INSETS.left},${INSETS.right}`,
    );
  });
});

describe("Folding moves the navigation without touching the screens", () => {
  test("unfolding moves the bar to a rail and the screen keeps what was typed into it", async () => {
    setWindowSize(TEST_WINDOWS.coverScreen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    await fireEvent.changeText(screen.getByTestId("home-draft"), "half typed");
    await resizeWindow(TEST_WINDOWS.innerScreen);

    expect(options(navigationRef).tabBarPosition).toBe("left");
    expect(screen.getByTestId("home-draft")).toHaveProp("value", "half typed");
    expect(mockHomeMounts.current).toBe(1);

    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(options(navigationRef).tabBarPosition).toBe("bottom");
    expect(screen.getByTestId("home-draft")).toHaveProp("value", "half typed");
    expect(mockHomeMounts.current).toBe(1);
  });

  test("the selected destination stays selected through the fold", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    await fireEvent.press(screen.getByLabelText("On-Call"));
    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(navigationRef.getCurrentRoute()?.name).toBe("OnCall");
    expect(screen.getByTestId("screen-oncall")).toBeTruthy();
  });
});
