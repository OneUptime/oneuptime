import { useMemo } from "react";
import { useAllProjectOnCallPolicies } from "./useAllProjectOnCallPolicies";
import { useOnCallSchedules } from "./useOnCallSchedules";
import { useCurrentUserId } from "./useCurrentUserId";
import {
  summarizeDuty,
  toShiftsForUser,
  type OnCallDutySummary,
} from "../oncall/duty";
import type {
  OnCallShift,
  ProjectOnCallAssignments,
  ProjectOnCallScheduleItem,
} from "../api/types";

export interface UseOnCallDutyResult {
  summary: OnCallDutySummary;
  assignmentsByProject: ProjectOnCallAssignments[];
  schedules: ProjectOnCallScheduleItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

const EMPTY_SUMMARY: OnCallDutySummary = {
  isOnCall: false,
  activeShifts: [],
  upcomingShifts: [],
  nextHandoffAt: null,
  nextShiftStartsAt: null,
  standingAssignmentCount: 0,
  scheduleAssignmentCount: 0,
};

/**
 * The whole on-call picture for the signed-in user: shifts derived from the
 * schedule rosters, plus the escalation-rule assignments that have no window.
 *
 * The two halves come from different endpoints on purpose. The assignments
 * endpoint already answers "is this person on duty right now" - it is the
 * server's own opinion and it accounts for overrides - but it says nothing
 * about WHEN the duty ends. The schedules carry the boundaries. Neither one
 * alone can render the status card.
 *
 * A failure in the schedules half is not treated as a failure of the screen:
 * losing the countdown while still knowing you are on call is a degraded
 * screen, whereas hiding the duty state because a timestamp query failed is a
 * wrong one.
 */
export function useOnCallDuty(): UseOnCallDutyResult {
  const assignments: ReturnType<typeof useAllProjectOnCallPolicies> =
    useAllProjectOnCallPolicies();
  const schedules: ReturnType<typeof useOnCallSchedules> = useOnCallSchedules();
  const currentUserId: string | null = useCurrentUserId();

  const summary: OnCallDutySummary = useMemo((): OnCallDutySummary => {
    if (!currentUserId && assignments.projects.length === 0) {
      return EMPTY_SUMMARY;
    }

    const shifts: OnCallShift[] = toShiftsForUser(
      schedules.schedules,
      currentUserId,
    );

    return summarizeDuty({
      shifts,
      assignmentsByProject: assignments.projects,
    });
  }, [assignments.projects, schedules.schedules, currentUserId]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all([assignments.refetch(), schedules.refetch()]);
  };

  return {
    summary,
    assignmentsByProject: assignments.projects,
    schedules: schedules.schedules,
    isLoading: assignments.isLoading || schedules.isLoading,
    isError: assignments.isError,
    refetch,
  };
}
