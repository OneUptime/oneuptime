import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import InboxScreen from "./InboxScreen";
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
  initialView?: "incidents" | "alerts";
  initialSegment?: "incidents" | "alerts" | "episodes";
  initialFilter?: "all" | "active" | "resolved";
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

function styleOf(element: RenderedElement): Style {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Style;
}

function tab(category: "incidents" | "alerts"): RenderedElement {
  return screen.getByTestId(`inbox-category-${category}`);
}

function indicator(category: "incidents" | "alerts"): RenderedElement {
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
