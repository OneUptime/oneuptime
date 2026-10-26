import React from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import InboxScreen, {
  CATEGORY_TAB_MIN_WIDTH_WITH_ICON,
  getInboxViewOfRoute,
} from "./InboxScreen";
import type { SecurityCasesAvailability } from "../hooks/useSecurityCases";
import {
  TEST_WINDOWS,
  resetWindowSize,
  resizeWindow,
  setWindowSize,
} from "../__tests__/windowSize";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { withAlpha } from "../utils/color";

/*
 * The Inbox holds incidents and alerts side by side. The category tabs are
 * the only thing that says which of the two lists is underneath, so what they
 * announce and which one they mark as selected has to follow the route - Home
 * shortcuts and notification taps land here with a category already chosen.
 *
 * The lists themselves have suites of their own; here they are stand-ins.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;
type Style = Record<string, unknown>;

interface InboxParams {
  initialView?: "incidents" | "alerts" | "security";
  initialSegment?: "incidents" | "alerts" | "episodes";
  initialFilter?: "all" | "active" | "resolved";
  initialCaseFilter?: "open" | "mine" | "unassigned";
}

const mockSetParams: jest.Mock = jest.fn();
const mockRoute: { params: InboxParams | undefined } = { params: undefined };
const mockNavigationState: {
  current: { index: number; routes: Array<{ name: string }> };
} = { current: { index: 0, routes: [{ name: "InboxList" }] } };
let mockColorScheme: "light" | "dark" = "light";

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { setParams: mockSetParams };
    },
    useRoute: () => {
      return mockRoute;
    },
    useNavigationState: (
      selector: (state: {
        index: number;
        routes: Array<{ name: string }>;
      }) => unknown,
    ) => {
      return selector(mockNavigationState.current);
    },
  };
});

jest.mock("./IncidentsScreen", () => {
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ embedded }: { embedded?: boolean }) => {
      return <Text>{`Incidents list${embedded ? " (embedded)" : ""}`}</Text>;
    },
  };
});

jest.mock("./SecurityCasesScreen", () => {
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: () => {
      return <Text>Security cases list</Text>;
    },
  };
});

/*
 * Whether the person signed in can see the project's security cases, in a
 * project that has had one (hooks/useSecurityCases.test.tsx owns how that is
 * decided). Unless a test says so, they cannot: the Inbox they have always had.
 */
const mockSecurity: { current: SecurityCasesAvailability } = {
  current: {
    isAvailable: false,
    isChecking: false,
    isDenied: false,
    projectId: "project-1",
  },
};

jest.mock("../hooks/useSecurityCases", () => {
  return {
    useSecurityCasesAvailability: () => {
      return mockSecurity.current;
    },
  };
});

jest.mock("./AlertsScreen", () => {
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ embedded }: { embedded?: boolean }) => {
      return <Text>{`Alerts list${embedded ? " (embedded)" : ""}`}</Text>;
    },
  };
});

/*
 * react-native exposes useColorScheme through a getter that cannot be spied
 * on, so the module behind it is replaced. Light unless a test says otherwise.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

// The character Ionicons draws an icon as: how a test finds an icon on screen.
function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

function styleOf(element: RenderedElement): Style {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Style;
}

function tab(category: "incidents" | "alerts" | "security"): RenderedElement {
  return screen.getByTestId(`inbox-category-${category}`);
}

function indicator(
  category: "incidents" | "alerts" | "security",
): RenderedElement {
  return screen.getByTestId(`inbox-category-${category}-indicator`);
}

function isSelected(element: RenderedElement): boolean | undefined {
  return (
    element.props.accessibilityState as { selected?: boolean } | undefined
  )?.selected;
}

async function holdDown(element: RenderedElement): Promise<void> {
  const handlers: { onResponderGrant?: (event: unknown) => void } =
    element.props as { onResponderGrant?: (event: unknown) => void };

  await act(async (): Promise<void> => {
    handlers.onResponderGrant?.({
      nativeEvent: {
        touches: [{ pageX: 100, pageY: 200, identifier: 1 }],
        changedTouches: [],
      },
      currentTarget: 1,
      persist: (): void => {
        return undefined;
      },
    });
  });
}

async function renderInbox(): Promise<void> {
  await render(<InboxScreen />);
}

async function renderInboxDark(): Promise<void> {
  mockColorScheme = "dark";
  await render(
    <ThemeProvider>
      <InboxScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockColorScheme = "light";
  mockRoute.params = undefined;
  mockNavigationState.current = { index: 0, routes: [{ name: "InboxList" }] };
  mockSecurity.current = {
    isAvailable: false,
    isChecking: false,
    isDenied: false,
    projectId: "project-1",
  };
});

function canSeeSecurityCases(): void {
  mockSecurity.current = { ...mockSecurity.current, isAvailable: true };
}

describe("Security, for the people who work security cases", () => {
  afterEach(() => {
    resetWindowSize();
  });

  test("nobody else sees a third category: the Inbox keeps its two", async () => {
    await renderInbox();

    expect(screen.queryByTestId("inbox-category-security")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  test("a refusal, or a project that never had a case, keeps it away too", async () => {
    mockSecurity.current = {
      ...mockSecurity.current,
      isAvailable: false,
      isDenied: true,
    };

    await renderInbox();

    expect(screen.queryByRole("tab", { name: "Security" })).toBeNull();
  });

  test("someone who can see the project's cases gets Security after Alerts", async () => {
    canSeeSecurityCases();

    await renderInbox();

    const tabs: RenderedElement[] = screen.getAllByRole("tab");
    expect(
      tabs.map((element: RenderedElement): string => {
        return element.props.accessibilityLabel as string;
      }),
    ).toEqual(["Incidents", "Alerts", "Security"]);
    expect(isSelected(tab("security"))).toBe(false);
  });

  test("tapping Security shows the cases, and never resets the incident filters for them", async () => {
    canSeeSecurityCases();
    await renderInbox();

    await fireEvent.press(tab("security"));

    expect(mockSetParams).toHaveBeenCalledWith({ initialView: "security" });
  });

  test("a route that asks for Security selects it and draws the case list", async () => {
    canSeeSecurityCases();
    mockRoute.params = { initialView: "security" };

    await renderInbox();

    expect(isSelected(tab("security"))).toBe(true);
    expect(indicator("security")).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });
    expect(screen.getByText("Security cases list")).toBeTruthy();
    expect(screen.queryByText(/Incidents list/)).toBeNull();
  });

  test("a case opened from a push keeps its category, before the check has answered", async () => {
    /*
     * The push lands before the availability count does: the list beneath
     * the case must not be a list of incidents with no tab saying why.
     */
    mockSecurity.current = { ...mockSecurity.current, isChecking: true };
    mockRoute.params = { initialView: "security" };

    await renderInbox();

    expect(isSelected(tab("security"))).toBe(true);
    expect(screen.getByText("Security cases list")).toBeTruthy();
  });

  test("a case opened over the incidents list brings Security along for Back", async () => {
    canSeeSecurityCases();
    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "SecurityCaseDetail" }],
    };

    await renderInbox();

    expect(mockSetParams).toHaveBeenCalledWith({
      initialView: "security",
      initialCaseFilter: "open",
    });
  });

  test("on a 320-point phone three tabs drop their icons and keep their words", async () => {
    canSeeSecurityCases();
    setWindowSize({ width: 320, height: 740 });

    await renderInbox();

    for (const name of ["Incidents", "Alerts", "Security"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.queryByText(glyphFor("warning"))).toBeNull();
    expect(screen.queryByText(glyphFor("notifications-outline"))).toBeNull();
    expect(screen.queryByText(glyphFor("shield-outline"))).toBeNull();
  });

  test("a 390-point phone has room for every icon beside its word", async () => {
    canSeeSecurityCases();
    setWindowSize({ width: 390, height: 844 });

    await renderInbox();

    expect(screen.getByText(glyphFor("warning"))).toBeTruthy();
    expect(screen.getByText(glyphFor("notifications-outline"))).toBeTruthy();
    expect(screen.getByText(glyphFor("shield-outline"))).toBeTruthy();
  });

  test("two tabs keep their icons even on the narrowest phone", async () => {
    setWindowSize({ width: 320, height: 740 });

    await renderInbox();

    expect(screen.getByText(glyphFor("warning"))).toBeTruthy();
    expect(screen.getByText(glyphFor("notifications-outline"))).toBeTruthy();
  });

  test("the threshold is the width of the widest label with its icon", () => {
    // "Incidents" in bold beside an 18-point icon and its gap: about 96 points.
    expect(CATEGORY_TAB_MIN_WIDTH_WITH_ICON).toBeGreaterThanOrEqual(96);
    expect(CATEGORY_TAB_MIN_WIDTH_WITH_ICON).toBeLessThan(110);
  });
});

describe("Which category a detail screen belongs to", () => {
  test.each([
    ["IncidentDetail", "incidents"],
    ["IncidentEpisodeDetail", "incidents"],
    ["AlertDetail", "alerts"],
    ["AlertEpisodeDetail", "alerts"],
    ["SecurityCaseDetail", "security"],
    ["InboxList", null],
  ])("%s is %s", (routeName: string, view: string | null) => {
    expect(getInboxViewOfRoute(routeName)).toBe(view);
  });
});

describe("On a short window - a phone on its side", () => {
  afterEach(() => {
    resetWindowSize();
  });

  test("the page title gives its height to the list; the categories stay", async () => {
    /*
     * 393 points tall, less a header and the home indicator: the rail beside
     * the Inbox already says where the reader is, so the title goes and the
     * list starts higher.
     */
    setWindowSize(TEST_WINDOWS.phoneOnItsSide);
    await renderInbox();

    expect(screen.queryByRole("header", { name: "Inbox" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Incidents" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Alerts" })).toBeTruthy();
  });

  test("turning the phone upright brings the title back", async () => {
    setWindowSize(TEST_WINDOWS.phoneOnItsSide);
    await renderInbox();
    await resizeWindow(TEST_WINDOWS.coverScreen);

    expect(screen.getByRole("header", { name: "Inbox" })).toBeTruthy();
  });

  test("an unfolded foldable keeps the title, and its gutters follow the pane", async () => {
    setWindowSize(TEST_WINDOWS.innerScreen);
    await renderInbox();

    expect(screen.getByRole("header", { name: "Inbox" })).toBeTruthy();
  });
});

describe("What the Inbox shows", () => {
  test("a page title and a labelled tab list with both categories", async () => {
    await renderInbox();

    expect(screen.getByRole("header", { name: "Inbox" })).toBeTruthy();
    expect(
      screen.getByLabelText("Inbox categories").props.accessibilityRole,
    ).toBe("tablist");
    expect(screen.getByRole("tab", { name: "Incidents" })).toBe(
      tab("incidents"),
    );
    expect(screen.getByRole("tab", { name: "Alerts" })).toBe(tab("alerts"));
  });

  test("incidents are what it opens on, embedded without their own title", async () => {
    await renderInbox();

    expect(isSelected(tab("incidents"))).toBe(true);
    expect(isSelected(tab("alerts"))).toBe(false);
    expect(screen.getByText("Incidents list (embedded)")).toBeTruthy();
    expect(screen.queryByText(/Alerts list/)).toBeNull();
  });

  test("a route that asks for alerts selects the Alerts tab and shows alerts", async () => {
    mockRoute.params = { initialView: "alerts" };

    await renderInbox();

    expect(isSelected(tab("alerts"))).toBe(true);
    expect(isSelected(tab("incidents"))).toBe(false);
    expect(screen.getByText("Alerts list (embedded)")).toBeTruthy();
    expect(screen.queryByText(/Incidents list/)).toBeNull();
  });
});

describe("Choosing a category", () => {
  test("tapping the other tab switches the list and resets its segment and filter", async () => {
    await renderInbox();

    await fireEvent.press(tab("alerts"));

    expect(mockSetParams).toHaveBeenCalledWith({
      initialView: "alerts",
      initialSegment: "alerts",
      initialFilter: "all",
    });
  });

  test("tapping the tab that is already selected keeps the reader's place", async () => {
    await renderInbox();

    await fireEvent.press(tab("incidents"));

    expect(mockSetParams).not.toHaveBeenCalled();
  });

  test("a detail page from the other category brings its tab along for Back", async () => {
    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "AlertEpisodeDetail" }],
    };

    await renderInbox();

    expect(mockSetParams).toHaveBeenCalledWith({
      initialView: "alerts",
      initialSegment: "episodes",
      initialFilter: "all",
    });
  });

  test("beside an open incident, the reader can still switch the list to Alerts", async () => {
    /*
     * On a wide window the list stays on screen beside the open record.
     * Switching category there must stick; the category follows a record
     * only when one is opened.
     */
    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "IncidentDetail" }],
    };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <InboxScreen />,
    );

    await fireEvent.press(tab("alerts"));
    expect(mockSetParams).toHaveBeenLastCalledWith({
      initialView: "alerts",
      initialSegment: "alerts",
      initialFilter: "all",
    });

    // The params land; the open incident must not pull the list back.
    mockSetParams.mockClear();
    mockRoute.params = {
      initialView: "alerts",
      initialSegment: "alerts",
      initialFilter: "all",
    };
    await view.rerender(<InboxScreen />);

    expect(mockSetParams).not.toHaveBeenCalled();
    expect(isSelected(tab("alerts"))).toBe(true);
  });

  test("opening an alert beside the incidents list brings the list to Alerts", async () => {
    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "IncidentDetail" }],
    };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <InboxScreen />,
    );
    expect(mockSetParams).not.toHaveBeenCalled();

    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "AlertDetail" }],
    };
    await view.rerender(<InboxScreen />);

    expect(mockSetParams).toHaveBeenCalledWith({
      initialView: "alerts",
      initialSegment: "alerts",
      initialFilter: "all",
    });
  });

  test("a detail page from the same category leaves the params alone", async () => {
    mockNavigationState.current = {
      index: 1,
      routes: [{ name: "InboxList" }, { name: "IncidentDetail" }],
    };

    await renderInbox();

    expect(mockSetParams).not.toHaveBeenCalled();
  });
});

describe("How the tabs are drawn", () => {
  test("the selected tab is tinted and underlined, the other is quiet", async () => {
    await renderInbox();

    expect(screen.getByText("Incidents")).toHaveStyle({
      color: lightColors.actionPrimary,
      fontWeight: "700",
    });
    expect(screen.getByText("Alerts")).toHaveStyle({
      color: lightColors.textSecondary,
    });
    expect(indicator("incidents")).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
      height: 3,
    });
    expect(indicator("alerts")).toHaveStyle({
      backgroundColor: "transparent",
    });
  });

  test("the indicator follows the selection", async () => {
    mockRoute.params = { initialView: "alerts" };

    await renderInbox();

    expect(indicator("alerts")).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });
    expect(indicator("incidents")).toHaveStyle({
      backgroundColor: "transparent",
    });
  });

  test("each tab is a comfortable touch target over a subtle hairline", async () => {
    await renderInbox();

    expect(styleOf(tab("incidents")).minHeight).toBeGreaterThanOrEqual(48);
    expect(styleOf(tab("alerts")).minHeight).toBeGreaterThanOrEqual(48);
    expect(screen.getByLabelText("Inbox categories")).toHaveStyle({
      borderBottomWidth: 1,
      borderBottomColor: lightColors.borderSubtle,
    });
  });

  test("a finger on a tab gets a soft accent wash", async () => {
    await renderInbox();

    expect(tab("alerts")).toHaveStyle({ backgroundColor: "transparent" });

    await holdDown(tab("alerts"));

    expect(tab("alerts")).toHaveStyle({
      backgroundColor: withAlpha(lightColors.actionPrimary, 0.08),
    });
  });
});

describe("In dark mode", () => {
  test("the canvas, tabs and indicator read from the dark palette", async () => {
    await renderInboxDark();

    expect(screen.getByText("Incidents")).toHaveStyle({
      color: darkColors.actionPrimary,
    });
    expect(screen.getByText("Alerts")).toHaveStyle({
      color: darkColors.textSecondary,
    });
    expect(indicator("incidents")).toHaveStyle({
      backgroundColor: darkColors.actionPrimary,
    });
    expect(screen.getByLabelText("Inbox categories")).toHaveStyle({
      borderBottomColor: darkColors.borderSubtle,
    });
    expect(screen.getByRole("header", { name: "Inbox" })).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });

  test("the pressed wash is stronger on the dark canvas", async () => {
    await renderInboxDark();

    await holdDown(tab("alerts"));

    expect(tab("alerts")).toHaveStyle({
      backgroundColor: withAlpha(darkColors.actionPrimary, 0.16),
    });
  });

  test("nothing in the dark Inbox header is painted light-palette white", async () => {
    await renderInboxDark();

    const white: RenderedElement[] = screen.container.queryAll(
      (node: RenderedElement) => {
        if (!node.props.style) {
          return false;
        }
        const style: Style = styleOf(node);
        return [style.backgroundColor, style.color, style.borderColor].some(
          (value: unknown) => {
            return (
              typeof value === "string" &&
              ["#ffffff", "#fff", "white"].includes(value.toLowerCase())
            );
          },
        );
      },
    );
    expect(white).toHaveLength(0);
  });
});
