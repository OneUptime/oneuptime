import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import RosterScheduleCard, { getInitials } from "./RosterScheduleCard";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius, spacing } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import type { ProjectOnCallScheduleItem } from "../api/types";

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
function roster(covered: boolean): ProjectOnCallScheduleItem {
  return {
    projectId: "production",
    projectName: "Production",
    item: {
      _id: "schedule",
      name: "Primary response",
      currentUserOnRoster: covered ? { _id: "me", name: "Sam" } : null,
      nextUserOnRoster: { _id: "priya", name: "Priya" },
      rosterStartAt: "2026-09-10T08:00:00Z",
      rosterHandoffAt: covered ? "2026-09-10T16:00:00Z" : null,
      rosterNextStartAt: "2026-09-10T16:00:00Z",
      rosterNextHandoffAt: null,
    },
  };
}

describe("Roster coverage cards", () => {
  test("keeps the current responder distinct from the next responder", async (): Promise<void> => {
    await render(
      <RosterScheduleCard entry={roster(true)} currentUserId="me" now={NOW} />,
    );
    expect(screen.getByText("Sam")).toBeTruthy();
    expect(screen.getByText(/Next: Priya/)).toBeTruthy();
    expect(screen.getByText("YOU")).toBeTruthy();
    expect(screen.getByText("Handoff")).toBeTruthy();
    expect(screen.queryByText("Production")).toBeNull();
  });

  test("does not count a future responder as current coverage", async (): Promise<void> => {
    await render(
      <RosterScheduleCard entry={roster(false)} currentUserId="me" now={NOW} />,
    );
    expect(screen.getByText("Nobody on call")).toBeTruthy();
    expect(screen.getByText(/Next: Priya/)).toBeTruthy();
    expect(screen.queryByText("YOU")).toBeNull();
    expect(screen.queryByText("Handoff")).toBeNull();
    /*
     * A gap is marked by more than its words: the coverage panel turns the
     * warning tint and the card border picks up the warning colour.
     */
    expect(screen.getByText("Coverage gap")).toBeTruthy();
    expect(screen.getByTestId("roster-coverage-schedule")).toHaveStyle({
      backgroundColor: lightColors.statusWarningBg,
    });
    expect(screen.getByTestId("roster-card-schedule")).toHaveStyle({
      borderColor: withAlpha(lightColors.statusWarning, 0.45),
    });
  });

  test("a covered schedule shows who is on call now on a neutral panel", async (): Promise<void> => {
    await render(
      <RosterScheduleCard entry={roster(true)} currentUserId="me" now={NOW} />,
    );
    expect(screen.getByText("On call now")).toBeTruthy();
    expect(screen.queryByText("Coverage gap")).toBeNull();
    expect(screen.getByText("S")).toBeTruthy();
    expect(screen.getByTestId("roster-coverage-schedule")).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
    });
    expect(screen.getByTestId("roster-card-schedule")).toHaveStyle({
      borderColor: lightColors.borderSubtle,
    });
  });

  test("the card keeps its elevated surface and radius", async (): Promise<void> => {
    await render(
      <RosterScheduleCard entry={roster(true)} currentUserId="me" now={NOW} />,
    );
    const style: Record<string, unknown> = StyleSheet.flatten(
      screen.getByTestId("roster-card-schedule").props.style,
    ) as Record<string, unknown>;
    expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
    expect(style.borderRadius).toBe(radius.lg);
    expect(style.padding).toBe(spacing.lg);
  });

  test("shares the specific schedule through a labelled 48-point control", async (): Promise<void> => {
    const onShare: jest.Mock = jest.fn();
    const entry: ProjectOnCallScheduleItem = roster(true);
    await render(
      <RosterScheduleCard
        entry={entry}
        currentUserId="me"
        now={NOW}
        onShareCalendar={onShare}
      />,
    );
    expect(screen.getByTestId("roster-share-schedule")).toHaveStyle({
      width: 48,
      height: 48,
    });
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Share team calendar link for Primary response",
      }),
    );
    expect(onShare).toHaveBeenCalledWith(entry);
  });

  test("announces an in-progress share and prevents duplicate requests", async (): Promise<void> => {
    const onShare: jest.Mock = jest.fn();
    await render(
      <RosterScheduleCard
        entry={roster(true)}
        currentUserId="me"
        now={NOW}
        onShareCalendar={onShare}
        isSharingCalendar
      />,
    );
    expect(screen.getByTestId("roster-share-schedule")).toBeDisabled();
    expect(screen.getByRole("button").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByRole("button").props.accessibilityState.busy).toBe(true);
    expect(
      screen.getByTestId("roster-share-schedule").props.accessibilityState.busy,
    ).toBe(true);
    await fireEvent.press(screen.getByTestId("roster-share-schedule"));
    expect(onShare).not.toHaveBeenCalled();
  });
});

describe("getInitials", () => {
  test("uses the first letters of the first two words of a name", () => {
    expect(getInitials("Priya Rao")).toBe("PR");
    expect(getInitials("ada lovelace byron")).toBe("AL");
    expect(getInitials("Sam")).toBe("S");
  });

  test("uses the first character of an email address", () => {
    expect(getInitials("sam@example.com")).toBe("S");
  });

  test("never renders an empty avatar", () => {
    expect(getInitials("   ")).toBe("?");
  });
});

describe("Roster coverage cards in dark mode", () => {
  test("a coverage gap uses the dark warning tokens", async (): Promise<void> => {
    mockColorScheme = "dark";
    try {
      await render(
        <ThemeProvider>
          <RosterScheduleCard
            entry={roster(false)}
            currentUserId="me"
            now={NOW}
          />
        </ThemeProvider>,
      );
      expect(screen.getByTestId("roster-card-schedule")).toHaveStyle({
        backgroundColor: darkColors.backgroundElevated,
        borderColor: withAlpha(darkColors.statusWarning, 0.45),
      });
      expect(screen.getByTestId("roster-coverage-schedule")).toHaveStyle({
        backgroundColor: darkColors.statusWarningBg,
      });
      expect(screen.getByText("Nobody on call")).toHaveStyle({
        color: darkColors.statusWarning,
      });
    } finally {
      mockColorScheme = "light";
    }
  });
});
