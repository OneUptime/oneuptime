import React from "react";
import { Dimensions, StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { getScreenBottomPadding } from "../theme/layout";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
} from "@react-navigation/native";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, test, jest, afterEach } from "@jest/globals";
import MainTabNavigator from "./MainTabNavigator";
import type { MainTabParamList } from "./types";

jest.mock("./ProjectNavigationSync", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});
jest.mock("../components/ProjectSwitcher", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    __esModule: true,
    default: () => {
      return ReactModule.createElement(
        Text,
        { accessibilityRole: "header" },
        "Project Alpha",
      );
    },
  };
});

/*
 * The tab bar is the direct way into the app's five destinations, so
 * the questions worth asking of it are the ones a responder would ask at 3am:
 * can I find Inbox, and does pressing it get me there.
 *
 * Every screen behind a tab is stubbed. What is under test is the navigator's
 * own configuration - which routes exist, what they are called, what the
 * chrome around them looks like on each platform - and mounting the real
 * screens would drag five screens' worth of hooks, queries and network calls
 * into a file that is not about any of them. The stubs are distinguishable so
 * a test can tell WHICH screen a press produced rather than merely that
 * something rendered.
 *
 * The suite runs under both the ios and android Jest projects. babel-preset-
 * expo inlines Platform.OS per project, so the platform-divergent expectations
 * below are branched on Platform.OS in the test too: each project asserts its
 * own half, and neither can pass by accident on the other's values.
 */

jest.mock("../screens/HomeScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function HomeScreenStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-home" },
        "home",
      );
    },
  };
});

jest.mock("./MonitorsStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function MonitorsStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-monitors" },
        "monitors",
      );
    },
  };
});

jest.mock("./InboxStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function InboxStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-inbox" },
        "inbox",
      );
    },
  };
});

jest.mock("./OnCallStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function OnCallStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-oncall" },
        "on call",
      );
    },
  };
});

jest.mock("./SettingsStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function SettingsStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-settings" },
        "settings",
      );
    },
  };
});

interface TabExpectation {
  /** What a screen reader must announce for this tab. */
  accessibleName: string;
  /** The stub that has to be on screen once the tab is selected. */
  testID: string;
}

/*
 * Typed as a Record over the param list on purpose: adding a route to
 * MainTabParamList without adding it here stops compiling, and adding it here
 * without registering a Tab.Screen for it fails the registration test below.
 * That is the whole point - the param list is what push notifications and deep
 * links are written against, so a name that lives in the type and nowhere else
 * is a page that silently goes nowhere. This app has already lost its monitor
 * pages to exactly that.
 */
const EVERY_DECLARED_TAB: Record<keyof MainTabParamList, TabExpectation> = {
  Home: { accessibleName: "Home", testID: "screen-home" },
  Monitors: { accessibleName: "Monitors", testID: "screen-monitors" },
  Inbox: { accessibleName: "Inbox", testID: "screen-inbox" },
  OnCall: { accessibleName: "On-Call", testID: "screen-oncall" },
  Settings: { accessibleName: "Settings", testID: "screen-settings" },
};

const DECLARED_TAB_NAMES: Array<string> = Object.keys(EVERY_DECLARED_TAB);

async function renderTabs(
  bottomInset: number = 0,
): Promise<NavigationContainerRefWithCurrent<MainTabParamList>> {
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    createNavigationContainerRef<MainTabParamList>();

  /*
   * `render` is awaited because React 19's `act` is asynchronous, which makes
   * @testing-library/react-native return a promise; not awaiting leaves the
   * tree half-mounted and the navigation ref unattached.
   */
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 44, bottom: bottomInset, left: 0, right: 0 }}
    >
      <NavigationContainer ref={navigationRef}>
        <MainTabNavigator />
      </NavigationContainer>
    </SafeAreaInsetsContext.Provider>,
  );

  return navigationRef;
}

/**
 * Press a tab the way a screen-reader user does: by the name it announces,
 * with no knowledge of where it sits on the bar or what its icon looks like.
 */
async function pressTab(accessibleName: string): Promise<void> {
  await fireEvent.press(screen.getByLabelText(accessibleName));
}

function currentTabBarStyle(
  navigationRef: NavigationContainerRefWithCurrent<MainTabParamList>,
): ViewStyle {
  const options: BottomTabNavigationOptions =
    (navigationRef.getCurrentOptions() ?? {}) as BottomTabNavigationOptions;

  return StyleSheet.flatten(options.tabBarStyle) as ViewStyle;
}

describe("What the tab bar announces to a screen reader", () => {
  test("every tab has a name of its own", async () => {
    /*
     * The regression this file exists for. `tabBarShowLabel` is false on every
     * phone-width device, so the tabs are bare icons; React Navigation makes up
     * an accessibility label from the route on iOS only, and on Android leaves
     * the button unnamed entirely. TalkBack then reads the whole bar as six
     * identical "tab" controls and there is no way to pick out Incidents.
     *
     * Asserting an EXACT name is what makes this hold on both platforms: the
     * iOS fallback is "Incidents, tab, 3 of 6", so a test that only asked for a
     * substring would pass on iOS while Android had nothing at all.
     */
    await renderTabs();

    for (const tab of Object.values(EVERY_DECLARED_TAB)) {
      expect(screen.getByLabelText(tab.accessibleName)).toBeTruthy();
    }
  });

  test("no two tabs answer to the same name", async () => {
    await renderTabs();

    for (const tab of Object.values(EVERY_DECLARED_TAB)) {
      expect(screen.getAllByLabelText(tab.accessibleName)).toHaveLength(1);
    }
  });

  test("the On-Call tab is spoken the way it is written", async () => {
    /*
     * The route is `OnCall` but the tab is titled "On-Call". A responder hears
     * the title, not the route name, and "oncall" is not a word.
     */
    await renderTabs();

    expect(screen.getByLabelText("On-Call")).toBeTruthy();
    expect(screen.queryByLabelText("OnCall")).toBeNull();
  });

  test("finding Inbox by name opens the combined response workspace", async () => {
    /*
     * The name has to be on the control that actually moves, not on some
     * decorative wrapper next to it - so this presses what the label query
     * returned and checks where the navigator went.
     */
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    await pressTab("Inbox");

    expect(navigationRef.getCurrentRoute()?.name).toBe("Inbox");
    expect(screen.getByTestId("screen-inbox")).toBeTruthy();
  });
});

describe("The routes the navigator registers", () => {
  test("it registers exactly the tabs MainTabParamList declares, in order", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    expect(navigationRef.getRootState()?.routeNames).toEqual(
      DECLARED_TAB_NAMES,
    );
  });

  test("each tab leads to its own screen", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    for (const [routeName, tab] of Object.entries(EVERY_DECLARED_TAB)) {
      await pressTab(tab.accessibleName);

      expect(navigationRef.getCurrentRoute()?.name).toBe(routeName);
      expect(screen.getByTestId(tab.testID)).toBeTruthy();
    }
  });

  test("the app opens on Home", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    expect(navigationRef.getCurrentRoute()?.name).toBe("Home");
    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(screen.queryByTestId("screen-inbox")).toBeNull();
  });
});

describe("The header each tab is given", () => {
  test("Home wears the tab navigator's own header", async () => {
    await renderTabs();

    expect(screen.getByRole("header", { name: "Project Alpha" })).toBeTruthy();
  });

  test("a tab that owns a stack is left to draw its own header", async () => {
    /*
     * The four stack tabs set headerShown: false so their nested native stack
     * can render one header rather than two stacked bars. With the stack
     * stubbed there is nothing left to draw, which is exactly the assertion:
     * the tab navigator contributed no header of its own.
     */
    await renderTabs();

    await pressTab("Monitors");

    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("How wide the device is", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * useWindowDimensions seeds itself from Dimensions.get("window"), so this is
   * where a handset becomes a tablet. The same object is returned every call
   * so the hook's effect does not see a change and re-render forever.
   */
  function pretendTheScreenIs(width: number): void {
    jest.spyOn(Dimensions, "get").mockReturnValue({
      width,
      height: 1000,
      scale: 2,
      fontScale: 2,
    } as never);
  }

  test.each([320, 360, 390, 430])(
    "a %dpt phone shows readable labels for every destination",
    async (width: number) => {
      /*
       * Written labels remain on every phone size. Accessible names and
       * visible text must agree so people do not need to memorize the icons.
       */
      pretendTheScreenIs(width);

      await renderTabs();

      expect(screen.getByText("Monitors")).toBeTruthy();
      expect(screen.getByText("Inbox")).toBeTruthy();
      expect(screen.queryByText("Incidents")).toBeNull();
      expect(screen.queryByText("Alerts")).toBeNull();
      expect(screen.getByText("On-Call")).toBeTruthy();
      expect(screen.getByText("Settings")).toBeTruthy();
      expect(screen.getByLabelText("Monitors")).toBeTruthy();
    },
  );

  test("a tablet has room to write the labels out", async () => {
    pretendTheScreenIs(1024);

    await renderTabs();

    expect(screen.getByText("Monitors")).toBeTruthy();
    expect(screen.getByText("On-Call")).toBeTruthy();
  });
});

describe("The tab bar this platform gets", () => {
  test.each([0, 16, 24, 34, 48])(
    "it clears a %dpt system gesture area and leaves 40pt after the last item",
    async (bottomInset: number) => {
      /*
       * The white bar extends to the bottom edge, while its controls remain
       * above the system gesture area. Scroll content reserves the whole bar
       * plus at least 40 points so the final item is never pinned against it.
       *
       * Platform.OS is inlined by babel-preset-expo per Jest project, so each
       * project checks its own numbers and neither can satisfy the other's.
       */
      const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
        await renderTabs(bottomInset);

      const tabBarStyle: ViewStyle = currentTabBarStyle(navigationRef);

      expect(tabBarStyle.bottom).toBe(0);
      expect(tabBarStyle.height).toBe(72 + bottomInset);
      expect(tabBarStyle.paddingBottom).toBe(8 + bottomInset);
      expect(
        getScreenBottomPadding(bottomInset) -
          Number(tabBarStyle.bottom) -
          Number(tabBarStyle.height),
      ).toBeGreaterThanOrEqual(40);
    },
  );

  test("the full-width bar is anchored to the bottom edge on both platforms", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    const tabBarStyle: ViewStyle = currentTabBarStyle(navigationRef);

    expect(tabBarStyle.position).toBe("absolute");
    expect(tabBarStyle.left).toBe(0);
    expect(tabBarStyle.right).toBe(0);
    expect(tabBarStyle.borderTopWidth).toBe(1);
    expect(tabBarStyle.borderRadius).toBeUndefined();
  });
});
