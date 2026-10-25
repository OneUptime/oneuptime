import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ResponseRow from "./ResponseRow";
import IncidentCard from "./IncidentCard";
import AlertCard from "./AlertCard";
import EpisodeCard from "./EpisodeCard";
import MonitorCard from "./MonitorCard";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { spacing } from "../theme/tokens";
import {
  makeAlert,
  makeIncident,
  makeIncidentEpisode,
  makeMonitor,
} from "../__tests__/testSupport";

/*
 * A row in a list that sits beside its detail pane (a foldable unfolded, a
 * tablet). The row whose record is open on the right is marked the way the
 * project sheet marks the current project - an accent border on a soft
 * accent fill - and says so to a screen reader; rows lose the forward
 * chevron, because they no longer open a new screen. On a phone, nothing
 * about a row changes.
 */

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
  mockColorScheme = "light";
});

type RenderedElement = ReturnType<typeof screen.getByRole>;

function surface(): RenderedElement {
  return screen.getByRole("button");
}

function surfaceStyle(): Record<string, unknown> {
  return (StyleSheet.flatten(surface().props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

function row(props: Partial<React.ComponentProps<typeof ResponseRow>> = {}): React.JSX.Element {
  return (
    <ResponseRow
      title="Checkout is down"
      kind="Incident"
      number="INC-7"
      time="5m ago"
      state="Created"
      stateColor="#ff0000"
      accessibilityLabel="Incident INC-7, Checkout is down."
      accessibilityHint="Open details and response actions"
      onPress={jest.fn()}
      {...props}
    />
  );
}

describe("On a phone a row is drawn exactly as before", () => {
  test("not selected, with its forward chevron and a one-point border", async () => {
    await render(row());

    expect(surface()).not.toBeSelected();
    expect(screen.getByTestId("response-row-chevron")).toBeTruthy();
    expect(surfaceStyle()).toMatchObject({
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: lightColors.borderSubtle,
      backgroundColor: lightColors.backgroundElevated,
    });
  });
});

describe("Beside a detail pane", () => {
  test("the open record's row is selected, outlined in the accent on the accent fill", async () => {
    await render(row({ selected: true }));

    expect(surface()).toBeSelected();
    expect(surfaceStyle()).toMatchObject({
      borderWidth: 2,
      borderColor: lightColors.actionPrimary,
      backgroundColor: lightColors.cardAccent,
    });
  });

  test("the thicker border does not shift the row's content", async () => {
    await render(row({ selected: true }));

    expect(Number(surfaceStyle()["padding"]) + 2).toBe(spacing.lg + 1);
  });

  test("rows lose the chevron, since they open on the right, not on a new screen", async () => {
    await render(row({ showChevron: false }));

    expect(screen.queryByTestId("response-row-chevron")).toBeNull();
  });

  test("in dark mode the selection reads from the dark palette", async () => {
    mockColorScheme = "dark";
    await render(<ThemeProvider>{row({ selected: true })}</ThemeProvider>);

    expect(surfaceStyle()).toMatchObject({
      borderColor: darkColors.actionPrimary,
      backgroundColor: darkColors.cardAccent,
    });
  });
});

describe("Every kind of row passes the selection through", () => {
  test.each([
    [
      "an incident",
      (): React.JSX.Element => {
        return (
          <IncidentCard
            incident={makeIncident()}
            onPress={jest.fn()}
            selected
            showChevron={false}
          />
        );
      },
    ],
    [
      "an alert",
      (): React.JSX.Element => {
        return (
          <AlertCard
            alert={makeAlert()}
            onPress={jest.fn()}
            selected
            showChevron={false}
          />
        );
      },
    ],
    [
      "an episode",
      (): React.JSX.Element => {
        return (
          <EpisodeCard
            episode={makeIncidentEpisode()}
            type="incident"
            onPress={jest.fn()}
            selected
            showChevron={false}
          />
        );
      },
    ],
    [
      "a monitor",
      (): React.JSX.Element => {
        return (
          <MonitorCard
            monitor={makeMonitor()}
            onPress={jest.fn()}
            selected
            showChevron={false}
          />
        );
      },
    ],
  ])("%s", async (_label: string, element: () => React.JSX.Element) => {
    await render(element());

    expect(surface()).toBeSelected();
    expect(screen.queryByTestId("response-row-chevron")).toBeNull();
  });
});
