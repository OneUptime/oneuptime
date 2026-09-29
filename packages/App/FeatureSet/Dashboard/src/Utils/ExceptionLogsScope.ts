import {
  EXCEPTION_LOG_WINDOW_MS,
  OccurrenceLogWindow,
  getOccurrenceLogWindow,
} from "./ExceptionCorrelation";

/*
 * The scopes the exception Logs page can show the log viewer in. Both are
 * anchored on the latest occurrence: its whole trace, or everything the
 * service logged in the minutes around it (for occurrences with no trace, or
 * when the cause sits in a neighbouring request).
 */

export enum ExceptionLogsViewerScopeKey {
  Trace = "trace",
  Service = "service",
}

export interface ExceptionLogsViewerScope {
  key: ExceptionLogsViewerScopeKey;
  label: string;
  description: string;
  traceId: string | null;
  serviceId: string | null;
  // Pinned time window for the viewer; null leaves the viewer's default.
  window: OccurrenceLogWindow | null;
}

export interface ExceptionLogsViewerScopeArgs {
  traceId?: string | null | undefined;
  primaryEntityId?: string | null | undefined;
  time?: unknown;
  now?: Date | undefined;
}

const WINDOW_MINUTES: number = Math.round(EXCEPTION_LOG_WINDOW_MS / 60000);

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getExceptionLogsViewerScopes(
  args: ExceptionLogsViewerScopeArgs,
): Array<ExceptionLogsViewerScope> {
  const traceId: string = trimmed(args.traceId);
  const serviceId: string = trimmed(args.primaryEntityId);
  const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
    args.time,
    args.now,
  );
  const scopes: Array<ExceptionLogsViewerScope> = [];

  if (traceId) {
    scopes.push({
      key: ExceptionLogsViewerScopeKey.Trace,
      label: "Latest trace",
      description: window
        ? `Every log written during the latest occurrence's trace, within ${WINDOW_MINUTES} minutes either side of it.`
        : "Every log written during the latest occurrence's trace. Its time could not be read, so the viewer's default time range applies.",
      traceId,
      serviceId: null,
      window,
    });
  }

  if (serviceId) {
    scopes.push({
      key: ExceptionLogsViewerScopeKey.Service,
      label: "Service",
      description: window
        ? `Everything this service logged within ${WINDOW_MINUTES} minutes either side of the latest occurrence, across all requests.`
        : "Everything this service logged. The occurrence time could not be read, so the viewer's default time range applies.",
      traceId: null,
      serviceId,
      window,
    });
  }

  return scopes;
}

export function getDefaultExceptionLogsViewerScope(
  scopes: ReadonlyArray<ExceptionLogsViewerScope>,
  preferred?: ExceptionLogsViewerScopeKey | undefined,
): ExceptionLogsViewerScope | null {
  return (
    scopes.find((scope: ExceptionLogsViewerScope): boolean => {
      return scope.key === preferred;
    }) ||
    scopes[0] ||
    null
  );
}
