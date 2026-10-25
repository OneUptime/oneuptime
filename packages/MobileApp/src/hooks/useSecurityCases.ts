import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useActiveProject } from "./useProject";
import {
  countSecurityCases,
  fetchOpenSecurityCases,
  fetchSecurityCasePriorities,
  fetchSecurityCaseStatuses,
  fetchWaitingPlaybookRuns,
  toStatusIdsQuery,
} from "../api/securityCases";
import { getOpenCaseStatusIds } from "../security/caseValues";
import type {
  ListResponse,
  ProjectItem,
  ProjectSecurityCaseItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
  SecurityPlaybookRunItem,
} from "../api/types";

/*
 * SECURITY CASES IN THE SELECTED PROJECT.
 *
 * Security Events is not for everybody on call. A case is the investigation
 * trail of a possible breach, read only by Project Owners, Project Admins and
 * the Security roles, and most projects never open one. So the app asks the
 * server whether the person signed in can see any of the project's cases -
 * the same read every case goes through - and shows Security only to those
 * who can and whose project has had one: everybody else's Inbox stays as it
 * was. A refusal is not an error to report; it is the answer.
 */

/*
 * Whether a request was refused for who is asking: the server answers a
 * read the person's role does not allow with 422 (NotAuthorizedException)
 * or 403.
 */
export function isAccessDenied(error: unknown): boolean {
  const status: number | undefined = (error as AxiosError | null)?.response
    ?.status;

  return status === 403 || status === 422;
}

/*
 * React Query's default is three retries with back-off. A refusal will not
 * change on a retry, and a person without access would otherwise send four
 * requests on every Inbox visit; anything else is tried once more.
 */
function retryUnlessDenied(failureCount: number, error: Error): boolean {
  return !isAccessDenied(error) && failureCount < 1;
}

export function useSecurityCaseStatuses(
  projectId: string,
  enabled: boolean = true,
): UseQueryResult<SecurityCaseStatusItem[], Error> {
  return useQuery({
    queryKey: ["security-case-statuses", projectId],
    queryFn: () => {
      return fetchSecurityCaseStatuses(projectId);
    },
    enabled: Boolean(projectId) && enabled,
    retry: retryUnlessDenied,
  });
}

export function useSecurityCasePriorities(
  projectId: string,
): UseQueryResult<SecurityCasePriorityItem[], Error> {
  return useQuery({
    queryKey: ["security-case-priorities", projectId],
    queryFn: () => {
      return fetchSecurityCasePriorities(projectId);
    },
    enabled: Boolean(projectId),
    retry: retryUnlessDenied,
  });
}

export interface SecurityCasesAvailability {
  // The person can see the project's cases, and the project has at least one.
  isAvailable: boolean;
  // The answer is on its way.
  isChecking: boolean;
  // The server refused: the person's role does not include cases.
  isDenied: boolean;
  projectId: string | null;
}

/*
 * Whether the selected project's Security cases are something to show:
 * readable by the person signed in, and not an empty product. Kept for a
 * minute, so moving between tabs does not ask again each time.
 */
export function useSecurityCasesAvailability(): SecurityCasesAvailability {
  const { activeProject, isLoadingProjects } = useActiveProject();
  const projectId: string | null = activeProject?._id ?? null;
  const query: UseQueryResult<number, Error> = useQuery({
    queryKey: ["security-cases-available", projectId],
    queryFn: () => {
      return countSecurityCases(projectId as string);
    },
    enabled: Boolean(projectId) && !isLoadingProjects,
    staleTime: 60 * 1000,
    retry: retryUnlessDenied,
  });

  return {
    isAvailable: Boolean(projectId) && (query.data ?? 0) > 0,
    isChecking: Boolean(projectId) && query.isLoading,
    isDenied: query.isError && isAccessDenied(query.error),
    projectId,
  };
}

/*
 * The project's runs waiting for somebody to approve a step, read as the set
 * of cases they are on: what the case list marks "Approval needed" and pulls
 * to the top.
 */
export function useCasesAwaitingApproval(
  projectId: string | null,
  enabled: boolean = true,
): { caseIds: Set<string>; isError: boolean; refetch: () => Promise<void> } {
  const query: UseQueryResult<SecurityPlaybookRunItem[], Error> = useQuery({
    queryKey: ["security-playbook-runs-waiting", projectId],
    queryFn: () => {
      return fetchWaitingPlaybookRuns(projectId as string);
    },
    enabled: Boolean(projectId) && enabled,
    retry: retryUnlessDenied,
  });

  const caseIds: Set<string> = useMemo((): Set<string> => {
    const ids: Set<string> = new Set();

    for (const run of query.data ?? []) {
      if (typeof run.securityCaseId === "string" && run.securityCaseId) {
        ids.add(run.securityCaseId.toLowerCase());
      }
    }

    return ids;
  }, [query.data]);

  return {
    caseIds,
    isError: query.isError,
    refetch: async (): Promise<void> => {
      if (projectId && enabled) {
        await query.refetch();
      }
    },
  };
}

export interface OpenSecurityCases {
  items: ProjectSecurityCaseItem[];
  statuses: SecurityCaseStatusItem[];
  priorities: SecurityCasePriorityItem[];
  awaitingApprovalCaseIds: Set<string>;
  // The server reported more open cases than the list holds.
  isTruncated: boolean;
  isLoading: boolean;
  isError: boolean;
  isDenied: boolean;
  refetch: () => Promise<void>;
}

/*
 * The selected project's open cases: the project's statuses first - which of
 * them count as open is the project's own list (security/caseValues) - then
 * the cases in them, and the runs waiting for an approval on any of them.
 */
export function useOpenSecurityCases(): OpenSecurityCases {
  const { activeProject, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | null = activeProject;
  const projectId: string = project?._id ?? "";
  const statuses: UseQueryResult<SecurityCaseStatusItem[], Error> =
    useSecurityCaseStatuses(projectId);
  const priorities: UseQueryResult<SecurityCasePriorityItem[], Error> =
    useSecurityCasePriorities(projectId);
  const openStatusIds: Array<string> = useMemo((): Array<string> => {
    return getOpenCaseStatusIds(statuses.data ?? []);
  }, [statuses.data]);
  const cases: UseQueryResult<ListResponse<SecurityCaseItem>, Error> = useQuery(
    {
      queryKey: ["security-cases", projectId, "open", openStatusIds.join(",")],
      queryFn: () => {
        return fetchOpenSecurityCases(projectId, openStatusIds);
      },
      enabled:
        Boolean(projectId) && !isLoadingProjects && Boolean(statuses.data),
      retry: retryUnlessDenied,
    },
  );
  const awaiting: ReturnType<typeof useCasesAwaitingApproval> =
    useCasesAwaitingApproval(projectId || null, !isLoadingProjects);

  const items: ProjectSecurityCaseItem[] = useMemo(() => {
    const rows: SecurityCaseItem[] | undefined = cases.data?.data;

    if (!project || !Array.isArray(rows)) {
      return [];
    }

    return rows.map((item: SecurityCaseItem): ProjectSecurityCaseItem => {
      return { item, projectId: project._id, projectName: project.name };
    });
  }, [cases.data, project]);

  const isDenied: boolean =
    (statuses.isError && isAccessDenied(statuses.error)) ||
    (cases.isError && isAccessDenied(cases.error));

  return {
    items,
    statuses: statuses.data ?? [],
    priorities: priorities.data ?? [],
    awaitingApprovalCaseIds: awaiting.caseIds,
    isTruncated: (cases.data?.count ?? 0) > items.length,
    isLoading:
      isLoadingProjects ||
      statuses.isLoading ||
      (Boolean(statuses.data) && cases.isLoading),
    isError: statuses.isError || cases.isError,
    isDenied,
    refetch: async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      await Promise.allSettled([
        statuses.refetch(),
        priorities.refetch(),
        cases.refetch(),
        awaiting.refetch(),
      ]);
    },
  };
}

export interface SecurityCaseCounts {
  isAvailable: boolean;
  openCount: number | undefined;
  awaitingApprovalCount: number | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/*
 * What Home says about Security: how many cases are open and how many wait
 * for an approval - only for the people the Inbox shows Security to.
 */
export function useSecurityCaseCounts(): SecurityCaseCounts {
  const availability: SecurityCasesAvailability =
    useSecurityCasesAvailability();
  const projectId: string = availability.projectId ?? "";
  const statuses: UseQueryResult<SecurityCaseStatusItem[], Error> =
    useSecurityCaseStatuses(projectId, availability.isAvailable);
  const openStatusIds: Array<string> = useMemo((): Array<string> => {
    return getOpenCaseStatusIds(statuses.data ?? []);
  }, [statuses.data]);
  const open: UseQueryResult<number, Error> = useQuery({
    queryKey: [
      "security-cases-open-count",
      projectId,
      openStatusIds.join(","),
    ],
    queryFn: () => {
      return countSecurityCases(projectId, {
        securityCaseStatusId: toStatusIdsQuery(openStatusIds),
      });
    },
    enabled: availability.isAvailable && Boolean(statuses.data),
    retry: retryUnlessDenied,
  });
  const awaiting: ReturnType<typeof useCasesAwaitingApproval> =
    useCasesAwaitingApproval(projectId || null, availability.isAvailable);

  return {
    isAvailable: availability.isAvailable,
    openCount: open.data,
    awaitingApprovalCount: awaiting.isError
      ? undefined
      : awaiting.caseIds.size,
    isLoading: statuses.isLoading || open.isLoading,
    isError: statuses.isError || open.isError,
    refetch: async (): Promise<void> => {
      if (!availability.isAvailable) {
        return;
      }

      await Promise.allSettled([
        statuses.refetch(),
        open.refetch(),
        awaiting.refetch(),
      ]);
    },
  };
}
