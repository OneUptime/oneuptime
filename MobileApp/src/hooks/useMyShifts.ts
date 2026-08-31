import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { projectListKey } from "./authorizedProjects";
import { fetchMyShifts, isRouteMissingError } from "../api/onCallCalendar";
import type { MyOnCallShift, MyOnCallShiftsResponse } from "../api/types";

export interface UseMyShiftsOptions {
  /* How far ahead to ask for. Defaults to a fortnight. */
  daysAhead?: number;

  /*
   * The current time, from the caller's clock hook. Rounded down to a
   * five-minute step before it reaches the query key, so a clock that ticks
   * every 30 seconds does not refetch every 30 seconds.
   */
  now?: number;
}

export interface UseMyShiftsResult {
  shifts: MyOnCallShift[];
  truncated: boolean;
  isLoading: boolean;
  isError: boolean;

  /* The server answered 404 to the route: it predates calendar feeds. */
  isUnsupported: boolean;

  /* True once a response has arrived, even an empty one. */
  isSuccess: boolean;

  window: { from: Date; to: Date };
  refetch: () => Promise<void>;
}

const DEFAULT_DAYS_AHEAD: number = 14;
const WINDOW_STEP_MILLISECONDS: number = 5 * 60 * 1000;
const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MILLISECONDS: number = 60 * 1000;

export function computeMyShiftsWindow(
  now: number,
  daysAhead: number,
): { from: Date; to: Date } {
  const from: number =
    Math.floor(now / WINDOW_STEP_MILLISECONDS) * WINDOW_STEP_MILLISECONDS;

  return {
    from: new Date(from),
    to: new Date(from + daysAhead * MILLISECONDS_PER_DAY),
  };
}

/**
 * The signed-in user's shifts for the coming days, from the server's own
 * expansion of every schedule they are on (`/my-shifts`), across projects.
 *
 * This is the upgrade over the roster-derived list: it sees the whole
 * fortnight, it knows about overrides ("covering for X"), and it is what the
 * calendar feed shows. It is NOT the only source: the on-call tab keeps the
 * roster-derived list as its fallback, so a server that cannot answer (an old
 * version, the render cap, an outage) degrades to the screen the tab had
 * before rather than to an empty one.
 */
export function useMyShifts(
  options: UseMyShiftsOptions = {},
): UseMyShiftsResult {
  const { projectList } = useProject();
  const daysAhead: number = options.daysAhead ?? DEFAULT_DAYS_AHEAD;
  const window: { from: Date; to: Date } = computeMyShiftsWindow(
    options.now ?? Date.now(),
    daysAhead,
  );

  const query: UseQueryResult<MyOnCallShiftsResponse, Error> = useQuery({
    queryKey: [
      "oncall",
      "my-shifts",
      projectListKey(projectList),
      window.from.toISOString(),
      daysAhead,
    ],
    enabled: projectList.length > 0,
    staleTime: ONE_MINUTE_MILLISECONDS,
    retry: (failureCount: number, error: Error): boolean => {
      if (isRouteMissingError(error)) {
        return false;
      }

      return failureCount < 1;
    },
    queryFn: async (): Promise<MyOnCallShiftsResponse> => {
      return await fetchMyShifts(window);
    },
  });

  return {
    shifts: query.data?.shifts ?? [],
    truncated: query.data?.truncated ?? false,
    isLoading: query.isPending && projectList.length > 0,
    isError: query.isError,
    isUnsupported: query.isError && isRouteMissingError(query.error),
    isSuccess: query.isSuccess,
    window,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
