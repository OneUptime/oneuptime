import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, jest as jestGlobal } from "@jest/globals";
import OverrideCard from "./OverrideCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { OnCallOverrideItem } from "../api/types";

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

/*
 * The direction of an override is the fact that matters, and it is the fact a
 * two-column layout loses: "Priya's pages → you" and "your pages → Priya" look
 * the same at a glance and mean opposite things. Somebody who reads it the
 * wrong way goes to bed believing they are covered when they are the cover.
 *
 * So these tests assert the SENTENCE, in both directions, from both ends.
 */

const ME: string = "user-me";
const TEAMMATE: string = "user-teammate";
const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

function override(
  overrides: Partial<OnCallOverrideItem> = {},
): OnCallOverrideItem {
  return {
    _id: "override-1",
    projectId: "project-1",
    projectName: "Acme",
    overrideUser: { _id: ME, name: "Ada" },
    routeAlertsToUser: { _id: TEAMMATE, name: "Priya" },
    onCallDutyPolicy: null,
    startsAt: new Date(2026, 2, 3, 9, 0).toISOString(),
    endsAt: new Date(2026, 2, 3, 18, 0).toISOString(),
    createdAt: new Date(2026, 2, 3, 8, 0).toISOString(),
    ...overrides,
  };
}

describe("OverrideCard direction", () => {
  test("reads as 'Your pages go to X' when the reader is being covered", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("Your pages go to Priya")).toBeTruthy();
  });

  test('reads as "X\'s pages go to you" when the reader is the cover', async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override({
          overrideUser: { _id: TEAMMATE, name: "Priya" },
          routeAlertsToUser: { _id: ME, name: "Ada" },
        })}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("Priya's pages go to you")).toBeTruthy();
  });

  test("names both people when the reader is neither of them", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override({
          overrideUser: { _id: "user-a", name: "Priya" },
          routeAlertsToUser: { _id: "user-b", name: "Sam" },
        })}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("Priya's pages go to Sam")).toBeTruthy();
  });

  test("falls back to the email, then to a placeholder, for an unnamed user", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override({
          overrideUser: { _id: "user-a", email: "priya@example.com" },
          routeAlertsToUser: null,
        })}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(
      screen.getByText("priya@example.com's pages go to Nobody"),
    ).toBeTruthy();
  });
});

describe("OverrideCard state", () => {
  test("an active override is labelled in effect and counts down to its end", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("In effect")).toBeTruthy();
    expect(screen.getByText(/ends in 6h/)).toBeTruthy();
  });

  test("a scheduled override does not claim to be running", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override()}
        state="upcoming"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.queryByText(/ends in/)).toBeNull();
  });

  test("a project-wide override says so rather than leaving the scope blank", async (): Promise<void> => {
    /*
     * "All on-call policies" is a much stronger statement than an empty scope
     * line, and it is the scope the app actually creates.
     */
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("All on-call policies")).toBeTruthy();
    expect(screen.queryByText(/Acme/)).toBeNull();
  });

  test("a policy-scoped override names the policy", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override({
          onCallDutyPolicy: { _id: "policy-1", name: "Database" },
        })}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.getByText("Database")).toBeTruthy();
  });
});

describe("OverrideCard cancelling", () => {
  test("offers cancel on an override that is still doing something", async (): Promise<void> => {
    const onCancel: (item: OnCallOverrideItem) => void = jestGlobal.fn();

    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
        onCancel={onCancel}
      />,
    );

    await fireEvent.press(screen.getByTestId("override-cancel-override-1"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("does not offer cancel on an override that has already ended", async (): Promise<void> => {
    /*
     * Cancelling something that is already over does nothing but invite the
     * confirmation dialog, and a destructive-looking button that changes
     * nothing teaches people to ignore destructive buttons.
     */
    const onCancel: (item: OnCallOverrideItem) => void = jestGlobal.fn();

    await render(
      <OverrideCard
        override={override()}
        state="past"
        currentUserId={ME}
        now={NOW}
        onCancel={onCancel}
      />,
    );

    expect(screen.queryByTestId("override-cancel-override-1")).toBeNull();
  });

  test("shows no cancel control at all when the screen passes no handler", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId("override-cancel-override-1")).toBeNull();
  });

  test("a cancelling override announces progress and cannot submit the action twice", async (): Promise<void> => {
    const onCancel: jest.Mock = jest.fn();
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
        onCancel={onCancel}
        isCancelling
      />,
    );
    const control: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "override-cancel-override-1",
    );
    expect(control).toHaveStyle({ minHeight: 48 });
    expect(screen.getByRole("button").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByRole("button").props.accessibilityState.busy).toBe(true);
    expect(control.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await fireEvent.press(control);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

type OverrideState = "active" | "upcoming" | "past";
type OverridePillToken =
  | "statusSuccessBg"
  | "statusInfoBg"
  | "backgroundTertiary";

const OVERRIDE_STATE_CASES: Array<[OverrideState, string, OverridePillToken]> =
  [
    ["active", "In effect", "statusSuccessBg"],
    ["upcoming", "Scheduled", "statusInfoBg"],
    ["past", "Ended", "backgroundTertiary"],
  ];

describe("OverrideCard presentation", () => {
  test.each(OVERRIDE_STATE_CASES)(
    "a %s override leads with a '%s' status pill",
    async (
      state: OverrideState,
      label: string,
      token: OverridePillToken,
    ): Promise<void> => {
      await render(
        <OverrideCard
          override={override()}
          state={state}
          currentUserId={ME}
          now={NOW}
        />,
      );

      expect(screen.getByText(label)).toBeTruthy();
      expect(flatStyle("override-status-override-1").backgroundColor).toBe(
        lightColors[token],
      );
    },
  );

  test("live overrides sit on an elevated card; ended ones are outlined", async (): Promise<void> => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
      />,
    );
    const live: Record<string, unknown> = flatStyle("override-card-override-1");
    expect(live.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(live.borderRadius).toBe(radius.lg);
    expect(live.boxShadow).toBeTruthy();

    await view.rerender(
      <OverrideCard
        override={override()}
        state="past"
        currentUserId={ME}
        now={NOW}
      />,
    );
    const ended: Record<string, unknown> = flatStyle(
      "override-card-override-1",
    );
    expect(ended.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(ended.borderRadius).toBe(radius.lg);
    expect(ended.boxShadow).toBeUndefined();
    expect(screen.getByText("Your pages go to Priya")).toHaveStyle({
      color: lightColors.textSecondary,
    });
  });
});

describe("OverrideCard cancel flow", () => {
  test("the cancel control is labelled, destructive and names the arrangement", async (): Promise<void> => {
    const onCancel: jest.Mock = jest.fn();
    const item: OnCallOverrideItem = override({
      onCallDutyPolicy: { _id: "policy-1", name: "Database" },
    });

    await render(
      <OverrideCard
        override={item}
        state="upcoming"
        currentUserId={ME}
        now={NOW}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Cancel override")).toHaveStyle({
      color: lightColors.actionDestructive,
    });
    const control: HostElement = screen.getByRole("button", {
      name: "Cancel override: Your pages go to Priya",
    });
    expect(control.props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });

    await fireEvent.press(control);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]?.[0]).toBe(item);
  });

  test("while cancelling, the label gives way to progress", async (): Promise<void> => {
    await render(
      <OverrideCard
        override={override()}
        state="active"
        currentUserId={ME}
        now={NOW}
        onCancel={jest.fn()}
        isCancelling
      />,
    );

    expect(screen.queryByText("Cancel override")).toBeNull();
    expect(flatStyle("override-cancel-override-1").opacity).toBe(0.5);
  });

  test("dark mode uses the dark status and destructive tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <OverrideCard
            override={override()}
            state="active"
            currentUserId={ME}
            now={NOW}
            onCancel={jest.fn()}
          />
        </ThemeProvider>,
      );

      expect(flatStyle("override-card-override-1").backgroundColor).toBe(
        darkColors.backgroundElevated,
      );
      expect(flatStyle("override-status-override-1").backgroundColor).toBe(
        darkColors.statusSuccessBg,
      );
      expect(screen.getByText("Cancel override")).toHaveStyle({
        color: darkColors.actionDestructive,
      });
      expect(screen.getByText("Your pages go to Priya")).toHaveStyle({
        color: darkColors.textPrimary,
      });
    } finally {
      mockColorScheme = "light";
    }
  });
});

type HostElement = ReturnType<typeof screen.getByTestId>;

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}
