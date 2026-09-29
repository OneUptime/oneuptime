/*
 * One supplementary read on an overview page, and what the page knows about
 * it: still loading, loaded, failed, or not permitted.
 *
 * Only the page's main record is required. Every other read (probes, status
 * history, open incidents, owners) is a section, so one failing or forbidden
 * read leaves the rest of the page standing. Two rules follow:
 * - A refresh that fails keeps the last good value and records the failure
 *   next to it, so a transient error does not blank a card.
 * - A forbidden or failed read has no value, so a card can never show an
 *   unknown count as 0 or an unknown list as empty.
 *
 * `loadedFor` stamps the subject (for example the monitor id) a section was
 * loaded for. A page that moves to another subject reads its sections
 * through getSectionForSubject and sees "loading" until the new data lands,
 * never the previous subject's values.
 *
 * Kept free of React, routing and permission imports (structural types
 * only) so it can be unit tested in the App suite.
 */

export type OverviewSectionStatus =
  | "loading"
  | "loaded"
  | "error"
  | "forbidden";

export interface OverviewSection<T> {
  status: OverviewSectionStatus;
  value: T | null;
  // Why the section has no value: the failure, or the permission reason.
  error: string;
  // A later refresh failed; the value is the last one that loaded.
  refreshError: string;
  loadedFor: string;
}

export function getLoadingSection<T>(): OverviewSection<T> {
  return {
    status: "loading",
    value: null,
    error: "",
    refreshError: "",
    loadedFor: "",
  };
}

export function resolveSection<T>(data: {
  value: T;
  subjectId: string;
}): OverviewSection<T> {
  return {
    status: "loaded",
    value: data.value,
    error: "",
    refreshError: "",
    loadedFor: data.subjectId,
  };
}

/*
 * A failed read. When the same subject already has a loaded value, that value
 * stays and the failure becomes a refreshError; otherwise the section is an
 * error with no value.
 */
export function failSection<T>(data: {
  previous: OverviewSection<T>;
  message: string;
  subjectId: string;
}): OverviewSection<T> {
  if (
    data.previous.status === "loaded" &&
    data.previous.loadedFor === data.subjectId
  ) {
    return {
      ...data.previous,
      refreshError: data.message,
    };
  }

  return {
    status: "error",
    value: null,
    error: data.message,
    refreshError: "",
    loadedFor: data.subjectId,
  };
}

// A read that was not attempted because the user may not make it.
export function forbidSection<T>(data: {
  reason: string;
  subjectId: string;
}): OverviewSection<T> {
  return {
    status: "forbidden",
    value: null,
    error: data.reason,
    refreshError: "",
    loadedFor: data.subjectId,
  };
}

// A section loaded for another subject reads as still loading.
export function getSectionForSubject<T>(
  section: OverviewSection<T>,
  subjectId: string,
): OverviewSection<T> {
  if (section.loadedFor !== subjectId) {
    return getLoadingSection<T>();
  }

  return section;
}

/*
 * Whether to send a read, given PermissionGate.check's answer. Skipped only
 * on a definite denial: when the gate cannot decide (an empty permission
 * snapshot, or a model that declares nothing) it says isAllowed false with no
 * reason, and the server is the one to ask.
 */
export function shouldAttemptRead(gate: {
  isAllowed: boolean;
  disabledReason?: string | undefined;
}): boolean {
  return gate.isAllowed || !gate.disabledReason;
}
