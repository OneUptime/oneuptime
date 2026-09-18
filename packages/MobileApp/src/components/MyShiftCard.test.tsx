import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import MyShiftCard from "./MyShiftCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { MyOnCallShift } from "../api/types";

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
 * The card for a server-materialized shift. What it adds over ShiftCard is
 * what only the server knows - that a shift is held for somebody else, that
 * it applies to one policy only - and the one action a shift invites: handing
 * it to a teammate. The "Get cover" rules are the part worth pinning: offered
 * for my own future or running shift, never for one I am covering, never for
 * one that has ended.
 */

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

/* Tue 3 Mar 2026, noon, local time. */
const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

function shift(overrides: Partial<MyOnCallShift> = {}): MyOnCallShift {
  return {
    shiftKey: "schedule-1:100",
    contentHash: "h",
    projectId: "project-1",
    projectName: "Acme",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: null,
    userId: "user-me",
    userName: "Ada",
    start: new Date(2026, 2, 4, 9, 0).toISOString(),
    end: new Date(2026, 2, 4, 17, 0).toISOString(),
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: new Date(2026, 2, 1).toISOString(),
    shiftConfigVersion: 1,
    ...overrides,
  };
}

describe("MyShiftCard", () => {
  test("names the schedule and exact window without repeating the selected project", async (): Promise<void> => {
    await render(<MyShiftCard shift={shift()} now={NOW} />);

    expect(screen.getByTestId("my-shift-card-schedule-1:100")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.queryByText("Acme")).toBeNull();
    expect(
      screen.getByText("Tomorrow 9:00 AM → Tomorrow 5:00 PM"),
    ).toBeTruthy();
    expect(screen.getByText("in 21h")).toBeTruthy();
  });

  test("shows the useful schedule layer when the server named one", async (): Promise<void> => {
    await render(
      <MyShiftCard shift={shift({ layerName: "Weekdays" })} now={NOW} />,
    );

    expect(screen.getByText("Weekdays")).toBeTruthy();
  });

  test("an active shift counts down what is left", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          start: new Date(2026, 2, 3, 9, 0).toISOString(),
          end: new Date(2026, 2, 3, 17, 30).toISOString(),
        })}
        now={NOW}
      />,
    );

    expect(screen.getByText("5h 30m left")).toBeTruthy();
  });

  test("an ended shift says so and offers no cover", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          start: new Date(2026, 2, 2, 9, 0).toISOString(),
          end: new Date(2026, 2, 2, 17, 0).toISOString(),
        })}
        now={NOW}
        onRequestCover={jest.fn()}
      />,
    );

    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.queryByTestId("get-cover-schedule-1:100")).toBeNull();
  });

  test("shows who the shift is covered for", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          override: {
            originalUserId: "user-2",
            originalUserName: "Priya Rao",
            overrideStartsAt: "",
            overrideEndsAt: "",
          },
        })}
        now={NOW}
        onRequestCover={jest.fn()}
      />,
    );

    expect(screen.getByTestId("covering-badge-schedule-1:100")).toBeTruthy();
    expect(screen.getByText("Covering for Priya Rao")).toBeTruthy();

    /* Cover on top of cover is not a thing the server resolves. */
    expect(screen.queryByTestId("get-cover-schedule-1:100")).toBeNull();
  });

  test("marks a policy-variant shift", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          policyVariantOf: {
            policyId: "policy-1",
            policyName: "Database",
            globalUserId: "user-2",
          },
        })}
        now={NOW}
      />,
    );

    expect(
      screen.getByTestId("policy-variant-badge-schedule-1:100"),
    ).toBeTruthy();
    expect(screen.getByText("Only for Database")).toBeTruthy();
  });

  test("'Get cover' hands the shift back to the caller", async (): Promise<void> => {
    const onRequestCover: jest.Mock = jest.fn();
    const mine: MyOnCallShift = shift();

    await render(
      <MyShiftCard shift={mine} now={NOW} onRequestCover={onRequestCover} />,
    );

    expect(screen.getByTestId("get-cover-schedule-1:100")).toHaveStyle({
      minHeight: 48,
    });

    await fireEvent.press(screen.getByTestId("get-cover-schedule-1:100"));

    expect(onRequestCover).toHaveBeenCalledTimes(1);
    expect(onRequestCover.mock.calls[0]?.[0]).toBe(mine);
  });

  test("offers no cover action when no handler is given", async (): Promise<void> => {
    await render(<MyShiftCard shift={shift()} now={NOW} />);

    expect(screen.queryByTestId("get-cover-schedule-1:100")).toBeNull();
  });

  test("long schedule names and exact dates are allowed to wrap instead of being clipped", async (): Promise<void> => {
    const name: string =
      "Global infrastructure secondary response for customer-facing services";
    await render(
      <MyShiftCard shift={shift({ scheduleName: name })} now={NOW} />,
    );
    expect(screen.getByText(name).props.numberOfLines).toBeUndefined();
    expect(
      screen.getByText("Tomorrow 9:00 AM → Tomorrow 5:00 PM").props
        .numberOfLines,
    ).toBeUndefined();
  });

  test("still shows a project-less shift, but without the cover action", async (): Promise<void> => {
    /*
     * Only a server that dropped a required field sends one. The shift is
     * worth showing - the user IS on call - but the override sheet would fill
     * the project in from it, find nothing, and silently write the override
     * into the first project in the list.
     */
    await render(
      <MyShiftCard
        shift={shift({ projectId: "" })}
        now={NOW}
        onRequestCover={jest.fn()}
      />,
    );

    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.queryByTestId("get-cover-schedule-1:100")).toBeNull();
  });
});

describe("MyShiftCard surface", () => {
  test("an upcoming shift is an elevated card with an info timing pill", async (): Promise<void> => {
    await render(<MyShiftCard shift={shift()} now={NOW} />);

    const style: Record<string, unknown> = flatStyle(
      "my-shift-card-schedule-1:100",
    );
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
    expect(style.boxShadow).toBeTruthy();
    expect(pillBackground("in 21h")).toBe(lightColors.statusInfoBg);
  });

  test("a running shift has a success pill", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          start: new Date(2026, 2, 3, 9, 0).toISOString(),
          end: new Date(2026, 2, 3, 17, 30).toISOString(),
        })}
        now={NOW}
      />,
    );

    expect(pillBackground("5h 30m left")).toBe(lightColors.statusSuccessBg);
  });

  test("an ended shift steps back to an outlined card with a neutral pill", async (): Promise<void> => {
    await render(
      <MyShiftCard
        shift={shift({
          start: new Date(2026, 2, 2, 9, 0).toISOString(),
          end: new Date(2026, 2, 2, 17, 0).toISOString(),
        })}
        now={NOW}
      />,
    );

    const style: Record<string, unknown> = flatStyle(
      "my-shift-card-schedule-1:100",
    );
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
    expect(style.boxShadow).toBeUndefined();
    expect(pillBackground("Ended")).toBe(lightColors.backgroundTertiary);
  });

  test("'Get cover' is a soft accent button with an accent label", async (): Promise<void> => {
    await render(
      <MyShiftCard shift={shift()} now={NOW} onRequestCover={jest.fn()} />,
    );

    const button: Record<string, unknown> = flatStyle(
      "get-cover-schedule-1:100",
    );
    expect(button.backgroundColor).toBe(lightColors.cardAccent);
    expect(button.borderRadius).toBe(radius.md);
    expect(screen.getByText("Get cover")).toHaveStyle({
      color: lightColors.actionPrimary,
    });
    expect(
      screen.getByRole("button", { name: "Get cover for Primary" }),
    ).toBeTruthy();
  });

  test("dark mode uses the dark card, pill and accent tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <MyShiftCard shift={shift()} now={NOW} onRequestCover={jest.fn()} />
        </ThemeProvider>,
      );

      expect(flatStyle("my-shift-card-schedule-1:100").backgroundColor).toBe(
        darkColors.backgroundElevated,
      );
      expect(pillBackground("in 21h")).toBe(darkColors.statusInfoBg);
      expect(flatStyle("get-cover-schedule-1:100").backgroundColor).toBe(
        darkColors.cardAccent,
      );
      expect(screen.getByText("Get cover")).toHaveStyle({
        color: darkColors.actionPrimary,
      });
    } finally {
      mockColorScheme = "light";
    }
  });
});

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

function pillBackground(label: string): unknown {
  const pill: ReturnType<typeof screen.getByText>["parent"] =
    screen.getByText(label).parent;
  return (StyleSheet.flatten(pill?.props.style) as Record<string, unknown>)
    .backgroundColor;
}
