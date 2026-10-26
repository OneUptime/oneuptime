import React from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { InboxEmptyDetail, MonitorsEmptyDetail } from "./EmptyDetailScreens";
import EmptyDetailPane from "../components/EmptyDetailPane";
import { ThemeProvider, darkColors, lightColors } from "../theme";

/*
 * What the detail pane beside a list says before anything is opened in it.
 *
 * The title says what the pane holds - nothing selected - rather than giving
 * an order: it has to stay true beside an empty list, where the old "Choose
 * an incident" asked for something the list said did not exist. One short
 * line says how to fill it. On-Call has no placeholder at all: its pane
 * shows the roster (StackNavigators.test.tsx).
 */

const mockRoute: { params: { initialView?: string } | undefined } = {
  params: undefined,
};

jest.mock("@react-navigation/native", () => {
  return {
    useRoute: () => {
      return mockRoute;
    },
  };
});

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

beforeEach(() => {
  mockRoute.params = undefined;
  mockColorScheme = "light";
});

// The old titles, which asked for a record whether or not the list had one.
const AN_ORDER: RegExp = /^Choose an? /;

describe("Beside the Inbox", () => {
  test("it says no incident is selected while the Incidents tab is showing", async () => {
    await render(<InboxEmptyDetail />);

    expect(
      screen.getByRole("header", { name: "No incident selected" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Choose one from the list to see it here."),
    ).toBeTruthy();
  });

  test("and no alert while the Alerts tab is", async () => {
    mockRoute.params = { initialView: "alerts" };
    await render(<InboxEmptyDetail />);

    expect(
      screen.getByRole("header", { name: "No alert selected" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Choose one from the list to see it here."),
    ).toBeTruthy();
  });

  test("and no case while Security is", async () => {
    mockRoute.params = { initialView: "security" };
    await render(<InboxEmptyDetail />);

    expect(
      screen.getByRole("header", { name: "No case selected" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Choose one from the list to see it here."),
    ).toBeTruthy();
    expect(screen.queryByText(AN_ORDER)).toBeNull();
  });

  test("it never gives an order the list beside it cannot meet", async () => {
    // Beside an empty or filtered-out list, "Choose an incident" was a dead end.
    await render(<InboxEmptyDetail />);
    expect(screen.queryByText(AN_ORDER)).toBeNull();

    mockRoute.params = { initialView: "alerts" };
    await render(<InboxEmptyDetail />);
    expect(screen.queryByText(AN_ORDER)).toBeNull();
  });
});

describe("Beside the monitors", () => {
  test("it says no monitor is selected, and what opens here", async () => {
    await render(<MonitorsEmptyDetail />);

    expect(
      screen.getByRole("header", { name: "No monitor selected" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Choose one from the list to see its status and history here.",
      ),
    ).toBeTruthy();
  });
});

describe("The pane itself", () => {
  test("sits under the pane's bar, and keeps clear of the window's other edges", async () => {
    await render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 32, right: 12, bottom: 20, left: 0 }}
      >
        <EmptyDetailPane icon="pulse-outline" title="T" message="M" />
      </SafeAreaInsetsContext.Provider>,
    );

    expect(
      screen.getByTestId("detail-pane-empty").props.contentContainerStyle,
    ).toMatchObject({
      // The bar above it already keeps it clear of the status bar.
      paddingTop: 24,
      paddingBottom: 20 + 24,
      paddingLeft: 24,
      paddingRight: 12 + 24,
      justifyContent: "center",
    });
  });

  test("sits on the canvas in both themes", async () => {
    await render(
      <EmptyDetailPane icon="pulse-outline" title="T" message="M" />,
    );
    expect(screen.getByTestId("detail-pane-empty")).toHaveStyle({
      backgroundColor: lightColors.backgroundPrimary,
    });

    mockColorScheme = "dark";
    await render(
      <ThemeProvider>
        <EmptyDetailPane icon="pulse-outline" title="T" message="M" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("detail-pane-empty")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });

  test("offers no buttons: the list beside it is the next step", async () => {
    await render(
      <EmptyDetailPane icon="pulse-outline" title="T" message="M" />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
