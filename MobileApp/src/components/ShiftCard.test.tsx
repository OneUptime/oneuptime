import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { describe, test, expect } from "@jest/globals";
import ShiftCard from "./ShiftCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius, spacing } from "../theme/tokens";
import type { OnCallShift } from "../api/types";

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

const NOW: number = new Date("2026-09-10T09:00:00Z").getTime();
function shift(overrides: Partial<OnCallShift> = {}): OnCallShift {
  return {
    scheduleId: "schedule",
    scheduleName: "Primary response",
    projectId: "production",
    projectName: "Production",
    status: "active",
    startsAt: "2026-09-10T08:00:00Z",
    endsAt: "2026-09-10T12:00:00Z",
    ...overrides,
  };
}

describe("Readable shift timing", () => {
  test("an active shift shows remaining duty and schedule without repeating the selected project", async (): Promise<void> => {
    await render(<ShiftCard shift={shift()} now={NOW} />);
    expect(screen.getByText("3h left")).toBeTruthy();
    expect(screen.getByText("Primary response")).toBeTruthy();
    expect(screen.queryByText("Production")).toBeNull();
  });
  test("an upcoming shift shows time until it starts", async (): Promise<void> => {
    await render(
      <ShiftCard
        shift={shift({
          status: "upcoming",
          startsAt: "2026-09-10T14:00:00Z",
          endsAt: "2026-09-10T20:00:00Z",
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("in 5h")).toBeTruthy();
    expect(screen.queryByText(/left$/)).toBeNull();
  });
  test("a roster without a known handoff never fabricates a countdown", async (): Promise<void> => {
    await render(
      <ShiftCard shift={shift({ startsAt: null, endsAt: null })} now={NOW} />,
    );
    expect(screen.getByText("On now")).toBeTruthy();
    expect(screen.queryByText(/left$/)).toBeNull();
  });
  test("an upcoming roster without a start time says scheduled without inventing a date", async (): Promise<void> => {
    await render(
      <ShiftCard
        shift={shift({ status: "upcoming", startsAt: null, endsAt: null })}
        now={NOW}
      />,
    );
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.queryByText(/^in /)).toBeNull();
  });
});

describe("Shift card surface", () => {
  test("sits on the shared card surface", async (): Promise<void> => {
    await render(<ShiftCard shift={shift()} now={NOW} />);

    const style: Record<string, unknown> = flatStyle(
      "shift-card-schedule-active",
    );
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
    expect(style.borderColor).toBe(lightColors.borderSubtle);
    expect(style.padding).toBe(spacing.lg);
  });

  test("timing is a status pill: success while on, info when coming up", async (): Promise<void> => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <ShiftCard shift={shift()} now={NOW} />,
    );
    expect(pillBackground("3h left")).toBe(lightColors.statusSuccessBg);

    await view.rerender(
      <ShiftCard
        shift={shift({
          status: "upcoming",
          startsAt: "2026-09-10T14:00:00Z",
          endsAt: "2026-09-10T20:00:00Z",
        })}
        now={NOW}
      />,
    );
    expect(pillBackground("in 5h")).toBe(lightColors.statusInfoBg);
  });

  test("dark mode uses the dark card and status tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <ShiftCard shift={shift()} now={NOW} />
        </ThemeProvider>,
      );

      expect(flatStyle("shift-card-schedule-active").backgroundColor).toBe(
        darkColors.backgroundElevated,
      );
      expect(pillBackground("3h left")).toBe(darkColors.statusSuccessBg);
      expect(screen.getByText("Primary response")).toHaveStyle({
        color: darkColors.textPrimary,
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

/** The background of the pill a timing label sits in. */
function pillBackground(label: string): unknown {
  const pill: ReturnType<typeof screen.getByText>["parent"] =
    screen.getByText(label).parent;
  return (StyleSheet.flatten(pill?.props.style) as Record<string, unknown>)
    .backgroundColor;
}
