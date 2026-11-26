import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchCasePlaybookRuns,
  fetchPlaybookApproval,
  fetchSecurityCaseById,
  fetchSecurityCaseFeed,
  fetchSecurityCaseNotes,
  fetchWaitingPlaybookRuns,
  type PlaybookApprovalReadout,
} from "../api/securityCases";
import { isAccessDenied } from "./useSecurityCases";
import type {
  NoteItem,
  SecurityCaseFeedItem,
  SecurityCaseItem,
  SecurityPlaybookRunItem,
} from "../api/types";

/*
 * One case and what its screen draws beside it. `SecurityCaseItem | null`,
 * because fetchSecurityCaseById resolves null for a case that is not there:
 * that miss is settled data, so `isError` means only that the request
 * failed (or was refused, which isAccessDenied tells apart).
 */

function retryUnlessDenied(failureCount: number, error: Error): boolean {
  return !isAccessDenied(error) && failureCount < 1;
}

export function useSecurityCaseDetail(
  projectId: string,
  caseId: string,
): UseQueryResult<SecurityCaseItem | null, Error> {
  return useQuery({
    queryKey: ["security-case", projectId, caseId],
    queryFn: () => {
      return fetchSecurityCaseById(projectId, caseId);
    },
    enabled: Boolean(projectId) && Boolean(caseId),
    retry: retryUnlessDenied,
  });
}

export function useSecurityCaseFeed(
  projectId: string,
  caseId: string,
  enabled: boolean = true,
): UseQueryResult<SecurityCaseFeedItem[], Error> {
  return useQuery({
    queryKey: ["security-case-feed", projectId, caseId],
    queryFn: () => {
      return fetchSecurityCaseFeed(projectId, caseId);
    },
    enabled: Boolean(projectId) && Boolean(caseId) && enabled,
    retry: retryUnlessDenied,
  });
}

export function useSecurityCaseNotes(
  projectId: string,
  caseId: string,
  enabled: boolean = true,
): UseQueryResult<NoteItem[], Error> {
  return useQuery({
    queryKey: ["security-case-notes", projectId, caseId],
    queryFn: () => {
      return fetchSecurityCaseNotes(projectId, caseId);
    },
    enabled: Boolean(projectId) && Boolean(caseId) && enabled,
    retry: retryUnlessDenied,
  });
}

// The case's playbook runs, the latest first: what their steps contained.
export function useCasePlaybookRuns(
  projectId: string,
  caseId: string,
  enabled: boolean = true,
): UseQueryResult<SecurityPlaybookRunItem[], Error> {
  return useQuery({
    queryKey: ["security-playbook-runs", projectId, caseId],
    queryFn: () => {
      return fetchCasePlaybookRuns(projectId, caseId);
    },
    enabled: Boolean(projectId) && Boolean(caseId) && enabled,
    retry: retryUnlessDenied,
  });
}

/*
 * A step's approval, as its chat messages say it: the evidence on the
 * approval card, or what became of an approval a push named.
 */
export function usePlaybookApproval(
  projectId: string,
  runId: string | null,
  enabled: boolean = true,
): UseQueryResult<PlaybookApprovalReadout, Error> {
  return useQuery({
    queryKey: ["security-playbook-approval", projectId, runId],
    queryFn: () => {
      return fetchPlaybookApproval(projectId, runId as string);
    },
    enabled: Boolean(projectId) && Boolean(runId) && enabled,
    retry: retryUnlessDenied,
  });
}

// The case's runs held for a decision, oldest first.
export function useCaseWaitingPlaybookRuns(
  projectId: string,
  caseId: string,
  enabled: boolean = true,
): UseQueryResult<SecurityPlaybookRunItem[], Error> {
  return useQuery({
    queryKey: ["security-playbook-runs-waiting", projectId, caseId],
    queryFn: () => {
      return fetchWaitingPlaybookRuns(projectId, caseId);
    },
    enabled: Boolean(projectId) && Boolean(caseId) && enabled,
    retry: retryUnlessDenied,
  });
}
