import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { getAuthorizedProjects, projectListKey } from "./authorizedProjects";
import {
  fetchPersonalCalendarFeed,
  isRouteMissingError,
} from "../api/onCallCalendar";
import type { ProjectItem } from "../api/types";

export interface UseOnCallCalendarFeedAvailabilityResult {
  /*
   * Whether the server has the calendar-feed routes at all. Optimistic while
   * unknown: the rows show, and vanish only on a definite "route not found".
   */
  isAvailable: boolean;
  isChecking: boolean;
}

const ONE_HOUR_MILLISECONDS: number = 60 * 60 * 1000;

/**
 * Does the server this app is signed into offer calendar feeds?
 *
 * Probed once with the first project the app may query (an SSO-locked
 * project is skipped, exactly as the fan-out hooks skip it, so the probe
 * cannot record a spurious SSO refusal against it). Only a 404 - the route
 * does not exist - counts as "no": a 403, a 500 or a lost connection means
 * the feature is there and something else is wrong, which the feed screen is
 * the right place to explain.
 *
 * During a rolling upgrade old pods still answer 404 for a while; the result
 * is cached for an hour and re-checked on the next launch after that.
 */
export function useOnCallCalendarFeedAvailability(): UseOnCallCalendarFeedAvailabilityResult {
  const { projectList } = useProject();

  const query: UseQueryResult<boolean, Error> = useQuery({
    queryKey: [
      "oncall",
      "calendar-feed-availability",
      projectListKey(projectList),
    ],
    enabled: projectList.length > 0,
    staleTime: ONE_HOUR_MILLISECONDS,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);
      const probeProject: ProjectItem | undefined = authorizedProjects[0];

      if (!probeProject) {
        return true;
      }

      try {
        await fetchPersonalCalendarFeed(probeProject._id);
        return true;
      } catch (err: unknown) {
        return !isRouteMissingError(err);
      }
    },
  });

  return {
    isAvailable: query.data ?? true,
    isChecking: query.isPending && projectList.length > 0,
  };
}
