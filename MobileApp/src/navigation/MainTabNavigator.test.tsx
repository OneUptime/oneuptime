import React from "react";
import { Dimensions, Platform, StyleSheet, type ViewStyle } from "react-native";
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

/*
 * The tab bar is the only way into five of the six things this app does, so
 * the questions worth asking of it are the ones a responder would ask at 3am:
 * can I find Incidents, and does pressing it get me there.
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

jest.mock("./IncidentsStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function IncidentsStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-incidents" },
        "incidents",
      );
    },
  };
});

jest.mock("./AlertsStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function AlertsStackStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "screen-alerts" },
        "alerts",
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
  Incidents: { accessibleName: "Incidents", testID: "screen-incidents" },
  Alerts: { accessibleName: "Alerts", testID: "screen-alerts" },
  OnCall: { accessibleName: "On-Call", testID: "screen-oncall" },
  Settings: { accessibleName: "Settings", testID: "screen-settings" },
};

const DECLARED_TAB_NAMES: Array<string> = Object.keys(EVERY_DECLARED_TAB);

async function renderTabs(): Promise<
  NavigationContainerRefWithCurrent<MainTabParamList>
> {
  const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
    createNavigationContainerRef<MainTabParamList>();

  /*
   * `render` is awaited because React 19's `act` is asynchronous, which makes
   * @testing-library/react-native return a promise; not awaiting leaves the
   * tree half-mounted and the navigation ref unattached.
   */
  await render(
    <NavigationContainer ref={navigationRef}>
      <MainTabNavigator />
    </NavigationContainer>,
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

  test("finding Incidents by name and pressing it opens Incidents", async () => {
    /*
     * The name has to be on the control that actually moves, not on some
     * decorative wrapper next to it - so this presses what the label query
     * returned and checks where the navigator went.
     */
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    await pressTab("Incidents");

    expect(navigationRef.getCurrentRoute()?.name).toBe("Incidents");
    expect(screen.getByTestId("screen-incidents")).toBeTruthy();
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
    expect(screen.queryByTestId("screen-incidents")).toBeNull();
  });
});

describe("The header each tab is given", () => {
  test("Home wears the tab navigator's own header", async () => {
    await renderTabs();

    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
  });

  test("a tab that owns a stack is left to draw its own header", async () => {
    /*
     * The five stack tabs set headerShown: false so their nested native stack
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

  test("a phone shows icons only, and still names them", async () => {
    /*
     * Under 768pt the written labels are dropped for room. That is a
     * deliberate choice and it is fine - as long as the name survives for the
     * people who cannot see the icon, which is the pair of assertions here.
     */
    pretendTheScreenIs(390);

    await renderTabs();

    expect(screen.queryByText("Monitors")).toBeNull();
    expect(screen.getByLabelText("Monitors")).toBeTruthy();
  });

  test("a tablet has room to write the labels out", async () => {
    pretendTheScreenIs(1024);

    await renderTabs();

    expect(screen.getByText("Monitors")).toBeTruthy();
    expect(screen.getByText("On-Call")).toBeTruthy();
  });
});

describe("The tab bar this platform gets", () => {
  test("it stands clear of the system gesture area by this platform's amount", async () => {
    /*
     * The bar floats above the content rather than sitting on the bottom edge,
     * so it has to be lifted past whatever the OS puts down there: the home
     * indicator on iOS, the shorter navigation area on Android. Collapsing the
     * two to one number puts the bar under the system's own control on one of
     * them, and this is the assertion that says which is which.
     *
     * Platform.OS is inlined by babel-preset-expo per Jest project, so each
     * project checks its own numbers and neither can satisfy the other's.
     */
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    const tabBarStyle: ViewStyle = currentTabBarStyle(navigationRef);

    if (Platform.OS === "ios") {
      expect(tabBarStyle.bottom).toBe(14);
      expect(tabBarStyle.height).toBe(78);
      expect(tabBarStyle.paddingBottom).toBe(18);
    } else {
      expect(tabBarStyle.bottom).toBe(10);
      expect(tabBarStyle.height).toBe(68);
      expect(tabBarStyle.paddingBottom).toBe(10);
    }
  });

  test("it floats, on both platforms", async () => {
    const navigationRef: NavigationContainerRefWithCurrent<MainTabParamList> =
      await renderTabs();

    const tabBarStyle: ViewStyle = currentTabBarStyle(navigationRef);

    expect(tabBarStyle.position).toBe("absolute");
    expect(tabBarStyle.left).toBe(14);
    expect(tabBarStyle.right).toBe(14);
  });
});
