import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import OnCallOverviewScreen from "./OnCallOverviewScreen";
import type { OnCallDutySummary } from "../oncall/duty";
import type { UseMyShiftsResult } from "../hooks/useMyShifts";
import type {
  MyOnCallShift,
  OnCallOverrideItem,
  OnCallShift,
} from "../api/types";

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

const mockMyShifts: { current: UseMyShiftsResult } = {
  current: emptyMyShifts(),
};

const mockCalendarFeed: {
  current: { isAvailable: boolean; isChecking: boolean };
} = { current: { isAvailable: true, isChecking: false } };

function emptyMyShifts(
  overrides: Partial<UseMyShiftsResult> = {},
): UseMyShiftsResult {
  return {
    shifts: [],
    truncated: false,
    isLoading: false,
    isError: false,
    isUnsupported: false,
    isSuccess: true,
    window: {
      from: new Date(2026, 2, 3, 12, 0),
      to: new Date(2026, 2, 17, 12, 0),
    },
    refetch: async (): Promise<void> => {
      return undefined;
    },
    ...overrides,
  };
}

function myShift(overrides: Partial<MyOnCallShift> = {}): MyOnCallShift {
  return {
    shiftKey: "schedule-1:1",
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

jest.mock("../hooks/useMyShifts", () => {
  return {
    useMyShifts: () => {
      return mockMyShifts.current;
    },
  };
});

jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return mockCalendarFeed.current;
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
    mockMyShifts.current = emptyMyShifts();
    mockCalendarFeed.current = { isAvailable: true, isChecking: false };
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

/*
 * ---------------------------------------------------------------------------
 * "Your shifts" from the server, and the calendar row.
 *
 * The server's materialized list wins when it produced anything; the
 * roster-derived list is the fallback for every way the server can fail to
 * answer - an old version (404), the render cap (503), an outage - AND for an
 * empty answer, because the roster looks further ahead than the fortnight
 * asked for and can still hold a "next up".
 * ---------------------------------------------------------------------------
 */

describe("OnCallOverviewScreen your shifts (server list)", () => {
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
    mockMyShifts.current = emptyMyShifts();
    mockCalendarFeed.current = { isAvailable: true, isChecking: false };
  });

  test("groups the server's shifts by day", async (): Promise<void> => {
    mockMyShifts.current = emptyMyShifts({
      shifts: [
        myShift({
          shiftKey: "later",
          start: new Date(2026, 2, 5, 9, 0).toISOString(),
          end: new Date(2026, 2, 5, 17, 0).toISOString(),
        }),
        myShift({
          shiftKey: "today",
          start: new Date(2026, 2, 3, 13, 0).toISOString(),
          end: new Date(2026, 2, 3, 17, 0).toISOString(),
        }),
        myShift({ shiftKey: "tomorrow" }),
      ],
    });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("my-shifts-list")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Thu 5 Mar")).toBeTruthy();
    expect(screen.getByTestId("my-shift-card-today")).toBeTruthy();
    expect(screen.getByTestId("my-shift-card-tomorrow")).toBeTruthy();
    expect(screen.getByTestId("my-shift-card-later")).toBeTruthy();

    /* Day order, not arrival order. */
    expect(
      screen
        .getAllByTestId(/^shift-day-/)
        .map((node: { props: { testID?: string } }) => {
          return node.props.testID;
        }),
    ).toEqual([
      "shift-day-2026-03-03",
      "shift-day-2026-03-04",
      "shift-day-2026-03-05",
    ]);
  });

  test("the server list replaces the roster-derived cards", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      activeShifts: [shift({ scheduleId: "s-active" })],
    };
    mockMyShifts.current = emptyMyShifts({ shifts: [myShift()] });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("my-shift-card-schedule-1:1")).toBeTruthy();
    expect(screen.queryByTestId("shift-card-s-active-active")).toBeNull();

    /* The status card still comes from the roster; nothing changes above the fold. */
    expect(screen.getByTestId("oncall-status-card")).toBeTruthy();
  });

  test("shows who a shift is covered for", async (): Promise<void> => {
    mockMyShifts.current = emptyMyShifts({
      shifts: [
        myShift({
          override: {
            originalUserId: "user-2",
            originalUserName: "Priya Rao",
            overrideStartsAt: "",
            overrideEndsAt: "",
          },
        }),
      ],
    });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByText("Covering for Priya Rao")).toBeTruthy();
  });

  test("'Get cover' opens the override sheet prefilled with the shift", async (): Promise<void> => {
    const start: string = new Date(2026, 2, 4, 9, 0).toISOString();
    const end: string = new Date(2026, 2, 4, 17, 0).toISOString();

    mockMyShifts.current = emptyMyShifts({
      shifts: [myShift({ start, end })],
    });

    await render(<OnCallOverviewScreen />);

    await fireEvent.press(screen.getByTestId("get-cover-schedule-1:1"));

    expect(mockNavigate.calls).toEqual([
      [
        "CreateOnCallOverride",
        {
          projectId: "project-1",
          scheduleId: "schedule-1",
          scheduleName: "Primary",
          startsAt: start,
          endsAt: end,
        },
      ],
    ]);
  });

  test("'Get cover' on a policy-variant shift carries the policy", async (): Promise<void> => {
    mockMyShifts.current = emptyMyShifts({
      shifts: [
        myShift({
          policyVariantOf: {
            policyId: "policy-1",
            policyName: "Database",
            globalUserId: "user-2",
          },
        }),
      ],
    });

    await render(<OnCallOverviewScreen />);

    await fireEvent.press(screen.getByTestId("get-cover-schedule-1:1"));

    expect((mockNavigate.calls[0]?.[1] as { policyId?: string }).policyId).toBe(
      "policy-1",
    );
  });

  test("falls back to the roster-derived list when the server cannot answer", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      activeShifts: [shift({ scheduleId: "s-active" })],
      upcomingShifts: [shift({ scheduleId: "s-next", status: "upcoming" })],
    };
    mockMyShifts.current = emptyMyShifts({
      shifts: [],
      isError: true,
      isSuccess: false,
    });

    await render(<OnCallOverviewScreen />);

    expect(screen.queryByTestId("my-shifts-list")).toBeNull();
    expect(screen.getByTestId("shift-card-s-active-active")).toBeTruthy();
    expect(screen.getByTestId("shift-card-s-next-upcoming")).toBeTruthy();
  });

  test("falls back to the roster-derived list on an older server", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      activeShifts: [shift({ scheduleId: "s-active" })],
    };
    mockMyShifts.current = emptyMyShifts({
      isError: true,
      isUnsupported: true,
      isSuccess: false,
    });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("shift-card-s-active-active")).toBeTruthy();
  });

  test("falls back to the roster-derived list when the server answers with nothing", async (): Promise<void> => {
    /*
     * The roster's "next" can lie beyond the fortnight the server was asked
     * for; an empty fortnight must not hide it.
     */
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: false,
      upcomingShifts: [
        shift({
          scheduleId: "s-far",
          status: "upcoming",
          startsAt: new Date(2026, 3, 1, 9, 0).toISOString(),
        }),
      ],
    };
    mockMyShifts.current = emptyMyShifts({ shifts: [] });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("shift-card-s-far-upcoming")).toBeTruthy();
  });

  test("keeps the empty-roster message when neither source has anything", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    expect(
      screen.getByText(/not on the roster of any on-call schedule/),
    ).toBeTruthy();
  });

  test("says when the server had to cut the list short", async (): Promise<void> => {
    mockMyShifts.current = emptyMyShifts({
      shifts: [myShift()],
      truncated: true,
    });

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("my-shifts-truncated")).toBeTruthy();
  });

  test("standing assignments keep their own section", async (): Promise<void> => {
    mockDuty.current.summary = {
      ...emptySummary(),
      isOnCall: true,
      standingAssignmentCount: 2,
    };
    mockMyShifts.current = emptyMyShifts({ shifts: [myShift()] });

    await render(<OnCallOverviewScreen />);

    expect(
      screen.getByText(/2 escalation rules page you directly/),
    ).toBeTruthy();
    expect(screen.getByTestId("my-shift-card-schedule-1:1")).toBeTruthy();
  });
});

describe("OnCallOverviewScreen calendar row", () => {
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
    mockMyShifts.current = emptyMyShifts();
    mockCalendarFeed.current = { isAvailable: true, isChecking: false };
  });

  test("offers 'Add shifts to my calendar' and routes to the feed screen", async (): Promise<void> => {
    await render(<OnCallOverviewScreen />);

    await fireEvent.press(screen.getByTestId("row-calendar"));

    expect(mockNavigate.calls).toEqual([["OnCallCalendarFeed", undefined]]);
  });

  test("hides the row when the server predates calendar feeds", async (): Promise<void> => {
    mockCalendarFeed.current = { isAvailable: false, isChecking: false };

    await render(<OnCallOverviewScreen />);

    expect(screen.queryByTestId("row-calendar")).toBeNull();

    /* The rest of the "More" list is untouched. */
    expect(screen.getByTestId("row-policies")).toBeTruthy();
    expect(screen.getByTestId("row-overrides")).toBeTruthy();
    expect(screen.getByTestId("row-pages")).toBeTruthy();
  });

  test("shows the row while availability is still being checked", async (): Promise<void> => {
    mockCalendarFeed.current = { isAvailable: true, isChecking: true };

    await render(<OnCallOverviewScreen />);

    expect(screen.getByTestId("row-calendar")).toBeTruthy();
  });
});
