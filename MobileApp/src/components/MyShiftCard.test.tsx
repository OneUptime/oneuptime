import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import MyShiftCard from "./MyShiftCard";
import type { MyOnCallShift } from "../api/types";

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
  test("names the schedule and project and shows the window", async (): Promise<void> => {
    await render(<MyShiftCard shift={shift()} now={NOW} />);

    expect(screen.getByTestId("my-shift-card-schedule-1:100")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(
      screen.getByText("Tomorrow 9:00 AM → Tomorrow 5:00 PM"),
    ).toBeTruthy();
    expect(screen.getByText("in 21h")).toBeTruthy();
  });

  test("shows the layer next to the project when the server named one", async (): Promise<void> => {
    await render(
      <MyShiftCard shift={shift({ layerName: "Weekdays" })} now={NOW} />,
    );

    expect(screen.getByText("Acme · Weekdays")).toBeTruthy();
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

    await fireEvent.press(screen.getByTestId("get-cover-schedule-1:100"));

    expect(onRequestCover).toHaveBeenCalledTimes(1);
    expect(onRequestCover.mock.calls[0]?.[0]).toBe(mine);
  });

  test("offers no cover action when no handler is given", async (): Promise<void> => {
    await render(<MyShiftCard shift={shift()} now={NOW} />);

    expect(screen.queryByTestId("get-cover-schedule-1:100")).toBeNull();
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
