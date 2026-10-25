import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchSecurityCaseById,
  fetchSecurityCaseFeed,
  fetchSecurityCaseNotes,
  fetchWaitingPlaybookRuns,
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
