import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
  UseQueryResult,
} from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import {
  createOnCallOverride,
  deleteOnCallOverride,
  endOnCallOverrideNow,
  fetchOnCallOverrides,
  fetchOverlappingOverrides,
  updateOnCallOverride,
  type OnCallOverrideChange,
} from "../api/onCallOverrides";
import { getAuthorizedProjects, projectListKey } from "./authorizedProjects";
import { isOverrideActive, isOverrideExpired } from "../oncall/duty";
import {
  getEndNow,
  pickConflict,
  type OverrideSavedTimes,
  type OverrideScopeTimes,
} from "../oncall/overrideEdit";
import type { OnCallOverrideItem, ProjectItem } from "../api/types";

export interface CreateOverrideInput {
  projectId: string;
  overrideUserId: string;
  routeAlertsToUserId: string;
  startsAt: Date;
  endsAt: Date;

  /*
   * Scope to one escalation policy. Left out for the project-wide override
   * "Cover for me" creates; set only when covering a policy-variant shift,
   * which exists inside that one policy.
   */
  onCallDutyPolicyId?: string;
}

export interface UseOnCallOverridesResult {
  /* In force right now. */
  active: OnCallOverrideItem[];

  /* Booked, not started. */
  upcoming: OnCallOverrideItem[];

  /* Finished. Kept for context, listed last. */
  past: OnCallOverrideItem[];

  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;

  createOverride: (input: CreateOverrideInput) => Promise<void>;
  isCreating: boolean;

  cancelOverride: (override: OnCallOverrideItem) => Promise<void>;
  isCancelling: boolean;

  /*
   * Edits an override (#7897): who covers, and its times as far as they
   * may still change (oncall/overrideEdit).
   */
  updateOverride: (
    override: OnCallOverrideItem,
    change: OnCallOverrideChange,
  ) => Promise<void>;
  isUpdating: boolean;

  // Ends an override under way now, at the server's clock.
  endOverrideNow: (override: OnCallOverrideItem) => Promise<void>;
  isEnding: boolean;
}

/**
 * User overrides for the selected project, split by whether they are in force.
 *
 * The split is the point of the screen. "Who is covering me right now" and
 * "what have I booked for next Tuesday" are different questions, and a single
 * date-sorted list makes the reader do that separation in their head at the
 * exact moment they are least able to.
 */
export function useOnCallOverrides(
  now: number = Date.now(),
): UseOnCallOverridesResult {
  const { projectList } = useActiveProject();
  const queryClient: ReturnType<typeof useQueryClient> = useQueryClient();

  const query: UseQueryResult<OnCallOverrideItem[], Error> = useQuery({
    queryKey: ["oncall", "overrides", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<OnCallOverrideItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

      if (projectList.length > 0 && authorizedProjects.length === 0) {
        throw new Error(
          "Sign in with SSO for the selected project to view coverage.",
        );
      }

      const results: PromiseSettledResult<OnCallOverrideItem[]>[] =
        await Promise.allSettled(
          authorizedProjects.map((project: ProjectItem) => {
            return fetchOnCallOverrides({
              projectId: project._id,
              projectName: project.name,
            });
          }),
        );

      const all: OnCallOverrideItem[] = [];

      if (
        results.length > 0 &&
        results.every((result: PromiseSettledResult<OnCallOverrideItem[]>) => {
          return result.status === "rejected";
        })
      ) {
        throw new Error("Could not load coverage for the selected project.");
      }

      results.forEach((result: PromiseSettledResult<OnCallOverrideItem[]>) => {
        if (result.status === "fulfilled") {
          all.push(...result.value);
        }
      });

      return all;
    },
  });

  const invalidate: () => Promise<void> = async (): Promise<void> => {
    /*
     * An override changes who the roster says is on call, so the schedules and
     * the duty assignments are stale the moment one is created or cancelled -
     * not just the override list itself.
     */
    await queryClient.invalidateQueries({ queryKey: ["oncall"] });
  };

  const createMutation: UseMutationResult<void, Error, CreateOverrideInput> =
    useMutation({
      mutationFn: async (input: CreateOverrideInput): Promise<void> => {
        if (input.projectId !== projectList[0]?._id) {
          throw new Error(
            "The selected project changed. Open coverage again before confirming.",
          );
        }
        await createOnCallOverride(input);
      },
      onSuccess: invalidate,
    });

  const cancelMutation: UseMutationResult<void, Error, OnCallOverrideItem> =
    useMutation({
      mutationFn: async (override: OnCallOverrideItem): Promise<void> => {
        if (override.projectId !== projectList[0]?._id) {
          throw new Error(
            "The selected project changed. Open coverage again before cancelling.",
          );
        }
        await deleteOnCallOverride(override.projectId, override._id);
      },
      onSuccess: invalidate,
    });

  const updateMutation: UseMutationResult<
    void,
    Error,
    { override: OnCallOverrideItem; change: OnCallOverrideChange }
  > = useMutation({
    mutationFn: async (data: {
      override: OnCallOverrideItem;
      change: OnCallOverrideChange;
    }): Promise<void> => {
      if (data.override.projectId !== projectList[0]?._id) {
        throw new Error(
          "The selected project changed. Open coverage again before saving.",
        );
      }
      await updateOnCallOverride(
        data.override.projectId,
        data.override._id,
        data.change,
      );
    },
    onSuccess: invalidate,
  });

  const endNowMutation: UseMutationResult<void, Error, OnCallOverrideItem> =
    useMutation({
      mutationFn: async (override: OnCallOverrideItem): Promise<void> => {
        if (override.projectId !== projectList[0]?._id) {
          throw new Error(
            "The selected project changed. Open coverage again before ending it.",
          );
        }

        const times: OverrideSavedTimes | null = toSavedTimes(override);

        await endOnCallOverrideNow(
          override.projectId,
          override._id,
          times ? getEndNow(times, new Date(Date.now())) : null,
        );
      },
      onSuccess: invalidate,
    });

  const grouped: {
    active: OnCallOverrideItem[];
    upcoming: OnCallOverrideItem[];
    past: OnCallOverrideItem[];
  } = useMemo(() => {
    const overrides: OnCallOverrideItem[] = query.data ?? [];

    const active: OnCallOverrideItem[] = [];
    const upcoming: OnCallOverrideItem[] = [];
    const past: OnCallOverrideItem[] = [];

    overrides.forEach((override: OnCallOverrideItem) => {
      if (isOverrideActive(override, now)) {
        active.push(override);
        return;
      }

      if (isOverrideExpired(override, now)) {
        past.push(override);
        return;
      }

      upcoming.push(override);
    });

    const byStart: (a: OnCallOverrideItem, b: OnCallOverrideItem) => number = (
      a: OnCallOverrideItem,
      b: OnCallOverrideItem,
    ): number => {
      return (
        new Date(a.startsAt ?? 0).getTime() -
        new Date(b.startsAt ?? 0).getTime()
      );
    };

    return {
      active: active.sort(byStart),
      upcoming: upcoming.sort(byStart),
      past: past.sort((a: OnCallOverrideItem, b: OnCallOverrideItem) => {
        return byStart(b, a);
      }),
    };
  }, [query.data, now]);

  return {
    ...grouped,
    isLoading: query.isPending && projectList.length > 0,
    isError: query.isError,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
    createOverride: async (input: CreateOverrideInput): Promise<void> => {
      await createMutation.mutateAsync(input);
    },
    isCreating: createMutation.isPending,
    cancelOverride: async (override: OnCallOverrideItem): Promise<void> => {
      await cancelMutation.mutateAsync(override);
    },
    isCancelling: cancelMutation.isPending,
    updateOverride: async (
      override: OnCallOverrideItem,
      change: OnCallOverrideChange,
    ): Promise<void> => {
      await updateMutation.mutateAsync({ override, change });
    },
    isUpdating: updateMutation.isPending,
    endOverrideNow: async (override: OnCallOverrideItem): Promise<void> => {
      await endNowMutation.mutateAsync(override);
    },
    isEnding: endNowMutation.isPending,
  };
}

// An override's times as saved, or null for one without both.
export function toSavedTimes(
  override: OnCallOverrideItem,
): OverrideSavedTimes | null {
  if (!override.startsAt || !override.endsAt) {
    return null;
  }

  const startsAt: Date = new Date(override.startsAt);
  const endsAt: Date = new Date(override.endsAt);

  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime())
  ) {
    return null;
  }

  return { startsAt, endsAt };
}

/*
 * The override the server named when it refused `candidate` for an
 * overlap (#7897): read again from the server - the list on screen holds
 * fifty at most - and picked as the server picks it (pickConflict). Null
 * when none can be found, or the read fails: the refusal is shown alone.
 */
export async function findOverlapConflict(data: {
  project: { projectId: string; projectName: string };
  candidate: OverrideScopeTimes;
}): Promise<OnCallOverrideItem | null> {
  try {
    const overrides: OnCallOverrideItem[] = await fetchOverlappingOverrides(
      data.project,
      {
        overrideUserId: data.candidate.overrideUserId,
        startsAt: data.candidate.startsAt,
        endsAt: data.candidate.endsAt,
      },
    );

    const weighed: Array<OverrideScopeTimes & { item: OnCallOverrideItem }> =
      [];

    overrides.forEach((override: OnCallOverrideItem) => {
      const times: OverrideSavedTimes | null = toSavedTimes(override);

      if (!times || !override.overrideUser?._id) {
        return;
      }

      weighed.push({
        item: override,
        id: override._id,
        overrideUserId: override.overrideUser._id,
        routeAlertsToUserId: override.routeAlertsToUser?._id || null,
        onCallDutyPolicyId:
          override.onCallDutyPolicyId || override.onCallDutyPolicy?._id || null,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        createdAt: override.createdAt ? new Date(override.createdAt) : null,
      });
    });

    return pickConflict(data.candidate, weighed)?.item || null;
  } catch {
    return null;
  }
}
