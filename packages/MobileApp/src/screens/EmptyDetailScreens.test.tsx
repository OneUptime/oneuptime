import React from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  InboxEmptyDetail,
  MonitorsEmptyDetail,
  OnCallEmptyDetail,
} from "./EmptyDetailScreens";
import EmptyDetailPane from "../components/EmptyDetailPane";
import { ThemeProvider, darkColors, lightColors } from "../theme";

/*
 * What the detail pane beside a list says before anything is opened in it.
 * One line on what will appear and how, in the list's own words; for the
 * on-call overview, which is as much a menu as a list, the three places
 * people go from it most.
 */

const mockNavigate: jest.Mock = jest.fn();
const mockRoute: { params: { initialView?: string } | undefined } = {
  params: undefined,
};

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
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
  mockNavigate.mockReset();
  mockRoute.params = undefined;
  mockColorScheme = "light";
});

describe("Beside the Inbox", () => {
  test("it asks for an incident while the Incidents tab is showing", async () => {
    await render(<InboxEmptyDetail />);

    expect(screen.getByRole("header", { name: "Choose an incident" })).toBeTruthy();
    expect(
      screen.getByText(
        "Open an incident or an episode from the list to respond to it here.",
      ),
    ).toBeTruthy();
  });

  test("and for an alert while the Alerts tab is", async () => {
    mockRoute.params = { initialView: "alerts" };
    await render(<InboxEmptyDetail />);

    expect(screen.getByRole("header", { name: "Choose an alert" })).toBeTruthy();
    expect(
      screen.getByText(
        "Open an alert or an episode from the list to respond to it here.",
      ),
    ).toBeTruthy();
  });
});

describe("Beside the monitors", () => {
  test("it asks for a monitor", async () => {
    await render(<MonitorsEmptyDetail />);

    expect(screen.getByRole("header", { name: "Choose a monitor" })).toBeTruthy();
    expect(
      screen.getByText(
        "Open a monitor from the list to see its status and history here.",
      ),
    ).toBeTruthy();
  });
});

describe("Beside the on-call overview", () => {
  test.each([
    ["Who's on call", "WhoIsOnCall"],
    ["Pages sent to me", "MyOnCallPages"],
    ["Coverage & overrides", "OnCallOverrides"],
  ])(
    "%s opens on the right",
    async (label: string, routeName: string) => {
      await render(<OnCallEmptyDetail />);

      await fireEvent.press(screen.getByRole("button", { name: label }));

      expect(mockNavigate).toHaveBeenCalledWith(routeName);
    },
  );

  test("it names the three places in the order people need them", async () => {
    await render(<OnCallEmptyDetail />);

    expect(
      screen.getAllByRole("button").map((button: ReturnType<typeof screen.getByRole>) => {
        return button.props.accessibilityLabel;
      }),
    ).toEqual(["Who's on call", "Pages sent to me", "Coverage & overrides"]);
  });
});

describe("The pane itself", () => {
  test("keeps clear of the status bar, since it has no header of its own", async () => {
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
      paddingTop: 32 + 24,
      paddingBottom: 20 + 24,
      paddingRight: 12 + 24,
      justifyContent: "center",
    });
  });

  test("sits on the canvas in both themes", async () => {
    await render(<EmptyDetailPane icon="pulse-outline" title="T" message="M" />);
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

  test("offers no buttons when it has nothing to offer", async () => {
    await render(<EmptyDetailPane icon="pulse-outline" title="T" message="M" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
