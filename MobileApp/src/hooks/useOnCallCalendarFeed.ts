import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchPersonalCalendarFeed,
  isRouteMissingError,
  rotatePersonalCalendarFeed,
  setPersonalCalendarFeedEnabled,
} from "../api/onCallCalendar";
import type { OnCallCalendarFeedStatus } from "../api/types";

export interface UseOnCallCalendarFeedResult {
  status: OnCallCalendarFeedStatus | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;

  /*
   * The server answered 404 to the route itself: it predates calendar feeds.
   * Distinct from `isError` because the screen says something different for
   * "your server cannot do this yet" than for "the request failed".
   */
  isUnsupported: boolean;

  refetch: () => Promise<void>;

  /* Generate a first link, or replace the current one. Returns the new status. */
  rotate: () => Promise<OnCallCalendarFeedStatus>;
  isRotating: boolean;

  setEnabled: (isEnabled: boolean) => Promise<void>;
  isUpdating: boolean;
}

export function calendarFeedQueryKey(projectId: string | null): Array<string> {
  return ["oncall", "calendar-feed", projectId ?? "none"];
}

/**
 * The signed-in user's personal calendar feed in ONE project. Feeds are per
 * project, so the screen calls this with whichever project is selected and
 * gets a separate cache entry for each.
 *
 * A 404 is not retried: it is the server saying the route does not exist,
 * and asking again three times with backoff only delays the "not supported"
 * message by several seconds.
 */
export function useOnCallCalendarFeed(
  projectId: string | null,
): UseOnCallCalendarFeedResult {
  const queryClient: ReturnType<typeof useQueryClient> = useQueryClient();
  const queryKey: Array<string> = calendarFeedQueryKey(projectId);

  const query: UseQueryResult<OnCallCalendarFeedStatus, Error> = useQuery({
    queryKey,
    enabled: Boolean(projectId),
    retry: (failureCount: number, error: Error): boolean => {
      if (isRouteMissingError(error)) {
        return false;
      }

      return failureCount < 1;
    },
    queryFn: async (): Promise<OnCallCalendarFeedStatus> => {
      return await fetchPersonalCalendarFeed(projectId as string);
    },
  });

  const rotateMutation: UseMutationResult<
    OnCallCalendarFeedStatus,
    Error,
    void
  > = useMutation({
    mutationFn: async (): Promise<OnCallCalendarFeedStatus> => {
      return await rotatePersonalCalendarFeed(projectId as string);
    },
    onSuccess: (status: OnCallCalendarFeedStatus): void => {
      /*
       * The rotate response IS the new status; writing it straight into the
       * cache means the new link is on screen before a refetch could race a
       * stale copy back over it.
       */
      queryClient.setQueryData(queryKey, status);
    },
  });

  const enableMutation: UseMutationResult<void, Error, boolean> = useMutation({
    mutationFn: async (isEnabled: boolean): Promise<void> => {
      const feedId: string | null = query.data?.feedId ?? null;

      if (!feedId) {
        throw new Error("There is no calendar link to update yet.");
      }

      await setPersonalCalendarFeedEnabled(
        projectId as string,
        feedId,
        isEnabled,
      );
    },
    onSuccess: async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    status: query.data ?? null,
    isLoading: query.isPending && Boolean(projectId),
    isError: query.isError,
    error: query.error,
    isUnsupported: query.isError && isRouteMissingError(query.error),
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
    rotate: async (): Promise<OnCallCalendarFeedStatus> => {
      return await rotateMutation.mutateAsync();
    },
    isRotating: rotateMutation.isPending,
    setEnabled: async (isEnabled: boolean): Promise<void> => {
      await enableMutation.mutateAsync(isEnabled);
    },
    isUpdating: enableMutation.isPending,
  };
}
