import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, test, expect } from "@jest/globals";
import ShiftCard from "./ShiftCard";
import type { OnCallShift } from "../api/types";

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
