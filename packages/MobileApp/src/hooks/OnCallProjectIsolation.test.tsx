import { cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, test } from "@jest/globals";
import { useAllProjectOnCallPolicies } from "./useAllProjectOnCallPolicies";
import { useOnCallSchedules } from "./useOnCallSchedules";
import { useOnCallOverrides } from "./useOnCallOverrides";
import { useMyOnCallPages } from "./useMyOnCallPages";
import { useMyShifts } from "./useMyShifts";
import { useOnCallCalendarFeedAvailability } from "./useOnCallCalendarFeedAvailability";
import { fetchCurrentOnDutyEscalationPolicies } from "../api/onCallPolicies";
import { fetchOnCallSchedules } from "../api/onCallSchedules";
import { fetchOnCallOverrides } from "../api/onCallOverrides";
import { fetchMyOnCallPages } from "../api/onCallPages";
import {
  fetchMyShifts,
  fetchPersonalCalendarFeed,
} from "../api/onCallCalendar";
import { createQueryWrapper, makeProject } from "../__tests__/testSupport";
import type {
  MyOnCallShift,
  OnCallOverrideItem,
  OnCallPageItem,
  OnCallScheduleItem,
  ProjectItem,
  ProjectOnCallAssignments,
  ProjectOnCallScheduleItem,
} from "../api/types";

const PROJECT_A: ProjectItem = makeProject({
  _id: "project-a",
  name: "Production",
});
const PROJECT_B: ProjectItem = makeProject({
  _id: "project-b",
  name: "Staging",
});
const mockSelection: { current: ProjectItem | null } = { current: PROJECT_A };
const mockMemberships: ProjectItem[] = [PROJECT_A, PROJECT_B];

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return {
        projectList: mockMemberships,
        isLoadingProjects: false,
      };
    },
    useActiveProject: () => {
      return {
        projectList: mockSelection.current ? [mockSelection.current] : [],
        isLoadingProjects: false,
      };
    },
  };
});
jest.mock("./useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return "me";
    },
  };
});
jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: async () => {
      return {};
    },
    getGlobalSsoToken: async () => {
      return null;
    },
  };
});
jest.mock("../api/onCallPolicies", () => {
  return { fetchCurrentOnDutyEscalationPolicies: jest.fn() };
});
jest.mock("../api/onCallSchedules", () => {
  return { fetchOnCallSchedules: jest.fn() };
});
jest.mock("../api/onCallOverrides", () => {
  return {
    fetchOnCallOverrides: jest.fn(),
    createOnCallOverride: jest.fn(),
    deleteOnCallOverride: jest.fn(),
  };
});
jest.mock("../api/onCallPages", () => {
  return { fetchMyOnCallPages: jest.fn() };
});
jest.mock("../api/onCallCalendar", () => {
  return {
    ...jest.requireActual("../api/onCallCalendar"),
    fetchMyShifts: jest.fn(),
    fetchPersonalCalendarFeed: jest.fn(),
  };
});

const calls: jest.Mock[] = [
  fetchCurrentOnDutyEscalationPolicies,
  fetchOnCallSchedules,
  fetchOnCallOverrides,
  fetchMyOnCallPages,
  fetchMyShifts,
  fetchPersonalCalendarFeed,
] as jest.Mock[];
const NOW: number = new Date("2026-09-10T09:00:00Z").getTime();

function makeShift(projectId: string): MyOnCallShift {
  return {
    shiftKey: projectId,
    contentHash: "test",
    projectId,
    scheduleId: "schedule",
    scheduleName: projectId,
    scheduleTimezone: null,
    userId: "me",
    userName: "Sam",
    start: "2026-09-10T08:00:00Z",
    end: "2026-09-10T16:00:00Z",
    coverageSeconds: 28800,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-09-10T07:00:00Z",
    shiftConfigVersion: 1,
  };
}

function useOnCallViews(): {
  duty: ReturnType<typeof useAllProjectOnCallPolicies>;
  schedules: ReturnType<typeof useOnCallSchedules>;
  coverage: ReturnType<typeof useOnCallOverrides>;
  pages: ReturnType<typeof useMyOnCallPages>;
  shifts: ReturnType<typeof useMyShifts>;
  calendar: ReturnType<typeof useOnCallCalendarFeedAvailability>;
} {
  return {
    duty: useAllProjectOnCallPolicies(),
    schedules: useOnCallSchedules(),
    coverage: useOnCallOverrides(NOW),
    pages: useMyOnCallPages(),
    shifts: useMyShifts({ now: NOW }),
    calendar: useOnCallCalendarFeedAvailability(),
  };
}

describe("On-call follows one global project", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
          staleTime: Infinity,
          gcTime: Infinity,
        },
        mutations: { gcTime: 0 },
      },
    });
    mockSelection.current = PROJECT_A;
    calls.forEach((mock: jest.Mock) => {
      mock.mockReset();
    });
    (fetchCurrentOnDutyEscalationPolicies as jest.Mock).mockImplementation(
      async (projectId: string) => {
        return {
          escalationRulesByUser: [
            {
              onCallDutyPolicy: { _id: projectId, name: projectId },
              onCallDutyPolicyEscalationRule: {
                _id: "rule",
                name: "Responder",
              },
            },
          ],
          escalationRulesByTeam: [],
          escalationRulesBySchedule: [],
        };
      },
    );
    (fetchOnCallSchedules as jest.Mock).mockImplementation(
      async (projectId: string): Promise<OnCallScheduleItem[]> => {
        return [
          {
            _id: projectId,
            name: projectId,
            currentUserOnRoster: { _id: "me", name: "Sam" },
            nextUserOnRoster: null,
            rosterStartAt: null,
            rosterHandoffAt: null,
            rosterNextStartAt: null,
            rosterNextHandoffAt: null,
          },
        ];
      },
    );
    (fetchOnCallOverrides as jest.Mock).mockImplementation(
      async ({
        projectId,
      }: {
        projectId: string;
      }): Promise<OnCallOverrideItem[]> => {
        return [
          {
            _id: projectId,
            projectId,
            projectName: projectId,
            overrideUser: { _id: "me" },
            routeAlertsToUser: { _id: "priya" },
            onCallDutyPolicy: null,
            startsAt: "2026-09-10T08:00:00Z",
            endsAt: "2026-09-10T16:00:00Z",
            createdAt: "2026-09-10T07:00:00Z",
          },
        ];
      },
    );
    (fetchMyOnCallPages as jest.Mock).mockImplementation(
      async ({
        projectId,
      }: {
        projectId: string;
      }): Promise<OnCallPageItem[]> => {
        return [
          {
            _id: projectId,
            projectId,
            projectName: projectId,
            createdAt: "2026-09-10T08:00:00Z",
            acknowledgedAt: null,
            triggeredByIncident: null,
            triggeredByAlert: null,
            triggeredByIncidentEpisode: null,
            triggeredByAlertEpisode: null,
          },
        ];
      },
    );
    (fetchMyShifts as jest.Mock).mockImplementation(
      async (_window: unknown, projectId: string) => {
        return {
          shifts: [makeShift(projectId)],
          truncated: false,
          generatedAt: "2026-09-10T09:00:00Z",
        };
      },
    );
    (fetchPersonalCalendarFeed as jest.Mock).mockResolvedValue({
      exists: false,
    });
  });
  afterEach(async (): Promise<void> => {
    await cleanup();
    client.clear();
  });

  test("requests every on-call resource using only the active tenant", async (): Promise<void> => {
    const { result } = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => {
      expect(result.current.shifts.isSuccess).toBe(true);
      expect(result.current.calendar.isChecking).toBe(false);
    });
    expect(fetchCurrentOnDutyEscalationPolicies).toHaveBeenCalledWith(
      "project-a",
    );
    expect(fetchOnCallSchedules).toHaveBeenCalledWith("project-a");
    expect(fetchOnCallOverrides).toHaveBeenCalledWith({
      projectId: "project-a",
      projectName: "Production",
    });
    expect(fetchMyOnCallPages).toHaveBeenCalledWith({
      projectId: "project-a",
      projectName: "Production",
    });
    expect(fetchMyShifts).toHaveBeenCalledWith(expect.any(Object), "project-a");
    expect(fetchPersonalCalendarFeed).toHaveBeenCalledWith("project-a");
    calls.forEach((mock: jest.Mock) => {
      expect(mock).toHaveBeenCalledTimes(1);
    });
  });

  test("switching projects uses separate query data without showing the previous tenant", async (): Promise<void> => {
    const rendered: Awaited<
      ReturnType<typeof renderHook<ReturnType<typeof useOnCallViews>, unknown>>
    > = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => {
      expect(rendered.result.current.shifts.shifts[0]?.projectId).toBe(
        "project-a",
      );
    });
    mockSelection.current = PROJECT_B;
    await rendered.rerender(undefined);
    expect(
      rendered.result.current.duty.projects.every(
        (project: ProjectOnCallAssignments) => {
          return project.projectId === "project-b";
        },
      ),
    ).toBe(true);
    expect(
      rendered.result.current.schedules.schedules.every(
        (schedule: ProjectOnCallScheduleItem) => {
          return schedule.projectId === "project-b";
        },
      ),
    ).toBe(true);
    expect(
      rendered.result.current.coverage.active.every(
        (coverage: OnCallOverrideItem) => {
          return coverage.projectId === "project-b";
        },
      ),
    ).toBe(true);
    expect(
      rendered.result.current.pages.pages.every((page: OnCallPageItem) => {
        return page.projectId === "project-b";
      }),
    ).toBe(true);
    expect(
      rendered.result.current.shifts.shifts.every((shift: MyOnCallShift) => {
        return shift.projectId === "project-b";
      }),
    ).toBe(true);
    await waitFor(() => {
      expect(rendered.result.current.shifts.shifts[0]?.projectId).toBe(
        "project-b",
      );
      expect(rendered.result.current.duty.projects[0]?.projectId).toBe(
        "project-b",
      );
    });
    mockSelection.current = PROJECT_A;
    await rendered.rerender(undefined);
    expect(rendered.result.current.shifts.shifts[0]?.projectId).toBe(
      "project-a",
    );
    expect(rendered.result.current.pages.pages[0]?.projectId).toBe("project-a");
    expect(fetchMyShifts).toHaveBeenCalledTimes(2);
  });

  test("SSO-locked selection is an inaccessible state for every duty and coverage read", async (): Promise<void> => {
    mockSelection.current = { ...PROJECT_A, requireSsoForLogin: true };
    const { result } = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => {
      expect(result.current.duty.isError).toBe(true);
      expect(result.current.schedules.isError).toBe(true);
      expect(result.current.coverage.isError).toBe(true);
      expect(result.current.pages.isError).toBe(true);
      expect(result.current.shifts.isError).toBe(true);
    });
    calls.forEach((mock: jest.Mock) => {
      expect(mock).not.toHaveBeenCalled();
    });
  });

  test("a failed selected project read never becomes empty successful coverage", async (): Promise<void> => {
    calls.forEach((mock: jest.Mock) => {
      mock.mockRejectedValue(new Error("Network unavailable"));
    });
    const { result } = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => {
      expect(result.current.duty.isError).toBe(true);
      expect(result.current.schedules.isError).toBe(true);
      expect(result.current.coverage.isError).toBe(true);
      expect(result.current.pages.isError).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.shifts.isError).toBe(true);
    });
  });

  test("ignores any foreign-project shift in a server response", async (): Promise<void> => {
    (fetchMyShifts as jest.Mock).mockResolvedValue({
      shifts: [makeShift("project-a"), makeShift("project-b")],
      truncated: false,
    });
    const { result } = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => {
      expect(result.current.shifts.isSuccess).toBe(true);
    });
    expect(
      result.current.shifts.shifts.map((shift: MyOnCallShift) => {
        return shift.projectId;
      }),
    ).toEqual(["project-a"]);
  });

  test("no selected project does not issue tenantless requests", async (): Promise<void> => {
    mockSelection.current = null;
    const { result } = await renderHook(useOnCallViews, {
      wrapper: createQueryWrapper(client),
    });
    expect(result.current.duty.isLoading).toBe(false);
    expect(result.current.shifts.isLoading).toBe(false);
    calls.forEach((mock: jest.Mock) => {
      expect(mock).not.toHaveBeenCalled();
    });
  });
});
