import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationResult,
  UseQueryResult,
} from "@tanstack/react-query";
import { useProject } from "./useProject";
import {
  createOnCallOverride,
  deleteOnCallOverride,
  fetchOnCallOverrides,
} from "../api/onCallOverrides";
import { getAuthorizedProjects, projectListKey } from "./authorizedProjects";
import { isOverrideActive, isOverrideExpired } from "../oncall/duty";
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
}

/**
 * Project-wide user overrides across every readable project, split by whether
 * they are in force.
 *
 * The split is the point of the screen. "Who is covering me right now" and
 * "what have I booked for next Tuesday" are different questions, and a single
 * date-sorted list makes the reader do that separation in their head at the
 * exact moment they are least able to.
 */
export function useOnCallOverrides(
  now: number = Date.now(),
): UseOnCallOverridesResult {
  const { projectList } = useProject();
  const queryClient: ReturnType<typeof useQueryClient> = useQueryClient();

  const query: UseQueryResult<OnCallOverrideItem[], Error> = useQuery({
    queryKey: ["oncall", "overrides", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<OnCallOverrideItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

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
        await createOnCallOverride(input);
      },
      onSuccess: invalidate,
    });

  const cancelMutation: UseMutationResult<void, Error, OnCallOverrideItem> =
    useMutation({
      mutationFn: async (override: OnCallOverrideItem): Promise<void> => {
        await deleteOnCallOverride(override.projectId, override._id);
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
  };
}
