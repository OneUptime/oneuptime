import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import RosterScheduleCard from "./RosterScheduleCard";
import type { ProjectOnCallScheduleItem } from "../api/types";

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
    expect(screen.getByTestId("roster-card-schedule")).toHaveStyle({
      borderLeftWidth: 3,
    });
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
