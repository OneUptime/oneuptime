import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import OnCallOverviewScreen from "./OnCallOverviewScreen";
import type { OnCallDutySummary } from "../oncall/duty";
import type { OnCallOverrideItem, OnCallShift } from "../api/types";

/*
 * The tab a responder opens when they want to know where they stand.
 *
 * What is asserted here is the ORDER of the answers, not the styling: duty
 * status before anything else, the two actions somebody takes from a handset
 * above the fold, then the shifts. And the loading state must not answer the
 * question before it knows - "you're not on call" rendered optimistically is
 * how somebody goes back to sleep.
 */

const mockDuty: {
  current: {
    summary: OnCallDutySummary;
    assignmentsByProject: [];
    schedules: [];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<void>;
  };
} = {
  current: {
    summary: emptySummary(),
    assignmentsByProject: [],
    schedules: [],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  },
};

const mockOverrides: { current: { active: OnCallOverrideItem[] } } = {
  current: { active: [] },
};

const mockNavigate: { calls: Array<[string, unknown]> } = { calls: [] };

function emptySummary(): OnCallDutySummary {
  return {
    isOnCall: false,
    activeShifts: [],
    upcomingShifts: [],
    nextHandoffAt: null,
    nextShiftStartsAt: null,
    standingAssignmentCount: 0,
    scheduleAssignmentCount: 0,
  };
}

function shift(overrides: Partial<OnCallShift> = {}): OnCallShift {
  return {
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    projectId: "project-1",
    projectName: "Acme",
    status: "active",
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return {
        navigate: (route: string, params: unknown) => {
          mockNavigate.calls.push([route, params]);
        },
      };
    },
  };
});

jest.mock("../hooks/useOnCallDuty", () => {
  return {
    useOnCallDuty: () => {
      return mockDuty.current;
    },
  };
});

jest.mock("../hooks/useOnCallOverrides", () => {
  return {
    useOnCallOverrides: () => {
      return {
        active: mockOverrides.current.active,
        upcoming: [],
        past: [],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        createOverride: jest.fn(),
        isCreating: false,
        cancelOverride: jest.fn(),
        isCancelling: false,
      };
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date(2026, 2, 3, 12, 0, 0, 0).getTime();
    },
  };
});

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

function override(id: string): OnCallOverrideItem {
  return {
    _id: id,
    projectId: "project-1",
    projectName: "Acme",
    overrideUser: { _id: "user-me", name: "Ada" },
    routeAlertsToUser: { _id: "user-2", name: "Priya" },
    onCallDutyPolicy: null,
    startsAt: new Date(2026, 2, 3, 9, 0).toISOString(),
    endsAt: new Date(2026, 2, 3, 18, 0).toISOString(),
    createdAt: new Date(2026, 2, 3, 8, 0).toISOString(),
  };
}

describe("OnCallOverviewScreen", () => {
  beforeEach(() => {
    mockDuty.current = {
      summary: emptySummary(),
      assignmentsByProject: [],
      schedules: [],
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockOverrides.current = { active: [] };
    mockNavigate.calls = [];
  });

  test("leads with the duty status card", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      nextHandoffAt: new Date(2026, 2, 3, 18, 0).toISOString(),
      scheduleAssignmentCount: 1,
    };

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("oncall-status-card")).toBeTruthy();
    expect(screen.getByText("Handoff in 6h")).toBeTruthy();
  });

  test("offers cover and roster as one-tap actions", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    await fireEvent.press(screen.getByTestId("quick-action-cover"));
    expect(mockNavigate.calls[0]?.[0]).toBe("CreateOnCallOverride");

    await fireEvent.press(screen.getByTestId("quick-action-roster"));
    expect(mockNavigate.calls[1]?.[0]).toBe("WhoIsOnCall");
  });

  test("lists active shifts before upcoming ones", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      activeShifts: [
        shift({
          scheduleId: "s-active",
          endsAt: new Date(2026, 2, 3, 18, 0).toISOString(),
        }),
      ],
      upcomingShifts: [
        shift({
          scheduleId: "s-next",
          status: "upcoming",
          startsAt: new Date(2026, 2, 10, 9, 0).toISOString(),
        }),
      ],
    };

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("shift-card-s-active-active")).toBeTruthy();
    expect(screen.getByTestId("shift-card-s-next-upcoming")).toBeTruthy();
  });

  test("says plainly when there are no shifts at all", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    expect(
      screen.getByText(/not on the roster of any on-call schedule/),
    ).toBeTruthy();
  });

  test("explains a standing assignment rather than showing it as a shift", async (): Promise<void> => {
    /*
     * A direct escalation assignment has no window. Rendering it in the shift
     * list would put a card on screen with no times on it and no way to tell
     * why.
     */
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      standingAssignmentCount: 1,
    };

    await render(<OnCallOverviewScreen />);

    expect(
      screen.getByText(/1 escalation rule pages you directly/),
    ).toBeTruthy();
  });

  test("surfaces an override that is in force right now", async (): Promise<void> => {
    /*
     * Someone whose pages are being routed away needs to know that BEFORE they
     * conclude from a quiet phone that nothing is wrong.
     */
    mockOverrides.current = { active: [override("override-1")] };

    await render(<OnCallOverviewScreen />);

    expect(screen.getByText("1 override is in effect right now")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("active-override-banner"));
    expect(mockNavigate.calls[0]?.[0]).toBe("OnCallOverrides");
  });

  test("hides the override banner when nothing is in effect", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    expect(screen.queryByTestId("active-override-banner")).toBeNull();
  });

  test("does not answer the duty question while it is still loading", async (): Promise<void> => {
    mockDuty.current.isLoading = true;

    await render(<OnCallOverviewScreen />);

    expect(screen.queryByText("You're not on call")).toBeNull();
    expect(screen.queryByTestId("oncall-status-card")).toBeNull();
  });

  test("offers a retry when the duty read fails", async (): Promise<void> => {
    mockDuty.current.isError = true;

    await render(<OnCallOverviewScreen />);

    expect(screen.getByText("Could not load your on-call status")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  test("routes to the policy list, overrides and page history", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    await fireEvent.press(screen.getByTestId("row-policies"));
    await fireEvent.press(screen.getByTestId("row-overrides"));
    await fireEvent.press(screen.getByTestId("row-pages"));

    expect(
      mockNavigate.calls.map((call: [string, unknown]) => {
        return call[0];
      }),
    ).toEqual(["OnCallList", "OnCallOverrides", "MyOnCallPages"]);
  });
});
