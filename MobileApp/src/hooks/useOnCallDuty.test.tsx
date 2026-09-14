import { renderHook } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useOnCallDuty, type UseOnCallDutyResult } from "./useOnCallDuty";
import type {
  ProjectOnCallAssignments,
  ProjectOnCallScheduleItem,
} from "../api/types";

/*
 * The hook that joins the two halves of "on call".
 *
 * The server's assignments endpoint knows WHETHER you are on duty (it accounts
 * for overrides); the schedule rosters know WHEN it ends. Neither alone can
 * render the status card, and the interesting cases are the ones where they
 * disagree - a standing assignment with no schedule behind it, a schedule roster
 * that names somebody else, and a signed-in user the app cannot identify.
 */

const ME: string = "user-me";

const mockAssignments: {
  current: {
    projects: ProjectOnCallAssignments[];
    totalAssignments: number;
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<void>;
  };
} = {
  current: {
    projects: [],
    totalAssignments: 0,
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  },
};

const mockSchedules: {
  current: {
    schedules: ProjectOnCallScheduleItem[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<void>;
  };
} = {
  current: {
    schedules: [],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  },
};

const mockUserId: { current: string | null } = { current: ME };

jest.mock("./useAllProjectOnCallPolicies", () => {
  return {
    useAllProjectOnCallPolicies: () => {
      return mockAssignments.current;
    },
  };
});

jest.mock("./useOnCallSchedules", () => {
  return {
    useOnCallSchedules: () => {
      return mockSchedules.current;
    },
  };
});

jest.mock("./useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return mockUserId.current;
    },
  };
});

function scheduleEntry(
  overrides: Partial<ProjectOnCallScheduleItem["item"]> & { _id: string },
): ProjectOnCallScheduleItem {
  return {
    projectId: "project-1",
    projectName: "Acme",
    item: {
      name: "Primary",
      currentUserOnRoster: null,
      nextUserOnRoster: null,
      rosterStartAt: null,
      rosterHandoffAt: null,
      rosterNextStartAt: null,
      rosterNextHandoffAt: null,
      ...overrides,
    },
  };
}

function standingAssignment(): ProjectOnCallAssignments {
  return {
    projectId: "project-1",
    projectName: "Acme",
    assignments: [
      {
        projectId: "project-1",
        projectName: "Acme",
        policyId: "policy-1",
        policyName: "Database",
        escalationRuleName: "Rule 1",
        assignmentType: "user",
        assignmentDetail: "You are directly assigned",
      },
    ],
  };
}

async function renderDuty(): Promise<{ current: UseOnCallDutyResult }> {
  const rendered: { result: { current: UseOnCallDutyResult } } =
    (await renderHook(() => {
      return useOnCallDuty();
    })) as unknown as { result: { current: UseOnCallDutyResult } };

  return rendered.result;
}

describe("useOnCallDuty", () => {
  beforeEach(() => {
    mockAssignments.current = {
      projects: [],
      totalAssignments: 0,
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockSchedules.current = {
      schedules: [],
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockUserId.current = ME;
  });

  test("derives an active shift and its handoff from the roster", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      scheduleEntry({
        _id: "schedule-1",
        currentUserOnRoster: { _id: ME, name: "Ada" },
        rosterHandoffAt: "2026-03-04T09:00:00.000Z",
      }),
    ];

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.summary.isOnCall).toBe(true);
    expect(result.current.summary.activeShifts).toHaveLength(1);
    expect(result.current.summary.nextHandoffAt).toBe(
      "2026-03-04T09:00:00.000Z",
    );
  });

  test("a standing assignment alone is on call with no handoff", async (): Promise<void> => {
    mockAssignments.current.projects = [standingAssignment()];

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.summary.isOnCall).toBe(true);
    expect(result.current.summary.standingAssignmentCount).toBe(1);
    expect(result.current.summary.nextHandoffAt).toBeNull();
  });

  test("a roster naming somebody else does not put this user on call", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      scheduleEntry({
        _id: "schedule-1",
        currentUserOnRoster: { _id: "user-other", name: "Priya" },
        rosterHandoffAt: "2026-03-04T09:00:00.000Z",
      }),
    ];

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.summary.isOnCall).toBe(false);
    expect(result.current.summary.activeShifts).toEqual([]);
  });

  test("an unidentified user gets no shifts, but keeps a server-side assignment", async (): Promise<void> => {
    /*
     * If the app cannot read the signed-in user id, it must not match rosters
     * by guesswork. The assignments endpoint is still authoritative, though -
     * it scoped itself server-side - so duty state survives even when the
     * countdown cannot be computed.
     */
    mockUserId.current = null;
    mockAssignments.current.projects = [standingAssignment()];
    mockSchedules.current.schedules = [
      scheduleEntry({
        _id: "schedule-1",
        currentUserOnRoster: { _id: ME },
        rosterHandoffAt: "2026-03-04T09:00:00.000Z",
      }),
    ];

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.summary.activeShifts).toEqual([]);
    expect(result.current.summary.isOnCall).toBe(true);
    expect(result.current.summary.nextHandoffAt).toBeNull();
  });

  test("is loading while either half is still loading", async (): Promise<void> => {
    mockSchedules.current.isLoading = true;

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.isLoading).toBe(true);
  });

  test("a failed schedule read does not take the duty state down with it", async (): Promise<void> => {
    /*
     * Losing the countdown is a degraded screen. Hiding "you are on call"
     * because a timestamp query failed is a wrong one.
     */
    mockSchedules.current.isError = true;
    mockAssignments.current.projects = [standingAssignment()];

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.isError).toBe(false);
    expect(result.current.summary.isOnCall).toBe(true);
  });

  test("a failed assignments read is surfaced as an error", async (): Promise<void> => {
    mockAssignments.current.isError = true;

    const result: { current: UseOnCallDutyResult } = await renderDuty();

    expect(result.current.isError).toBe(true);
  });
});
