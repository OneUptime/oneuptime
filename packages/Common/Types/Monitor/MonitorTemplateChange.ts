import { LIMIT_PER_PROJECT } from "../Database/LimitMax";
import BadDataException from "../Exception/BadDataException";
import { translationKey } from "../Translator";

/*
 * ONE CHANGE OF MANY MONITORS' TEMPLATE, ON THE SERVER (OneUptime issues
 * #11260, #11266).
 *
 * A fleet a template made - 851 switches, 10,000 devices - moves to a better
 * template, or off its template, as one job: the person picks the monitors
 * (a template's Linked Monitors, or any list of monitors) and what to do with
 * them, the server records the change, and a worker changes each monitor as
 * that person, writing what happened as it goes. The dialog - or the same
 * one reopened later, or a colleague's - reads that record to draw progress,
 * what was left out and why, and the finished summary, and asks for the
 * monitors that failed to be tried again. It used to be one request per
 * monitor from the browser, which stopped when the tab closed and refused
 * every monitor an import had made (#11260).
 *
 * These are the shapes the server, the worker and the Dashboard share, and
 * the rules all three apply to them. React-free and database-free.
 */

/*
 * The most monitors one change takes: a project's list ceiling, which is
 * also how many monitors a list's Select All selects (BulkSelectAll).
 */
export const MAX_MONITORS_PER_TEMPLATE_CHANGE: number = LIMIT_PER_PROJECT;

/*
 * What the change does to each monitor.
 *
 *  - Link: links it to the change's template, moving it off any other one.
 *    With applyTemplateSettings, it takes the template's criteria and step
 *    settings, interval and probe agreement in the same write.
 *  - Unlink: unlinks it from its template - the change's, when the change
 *    names one, so a stale list never unlinks a monitor someone has moved
 *    since. With clearTemplateSettings, the template's criteria are taken
 *    off it.
 *
 * History, labels, owners and incident links stay, whatever the change.
 */
export enum MonitorTemplateChangeKind {
  Link = "link",
  Unlink = "unlink",
}

export interface MonitorTemplateChangeSettings {
  kind: MonitorTemplateChangeKind;
  // Link: the template's criteria, interval and probe agreement come with it.
  applyTemplateSettings: boolean;
  // Unlink: the template's criteria are cleared from the monitor.
  clearTemplateSettings: boolean;
  /*
   * Unlink every monitor linked to the template, then delete it: the
   * template's Delete, for a template with monitors whose criteria are
   * cleared first.
   */
  deleteTemplateWhenDone: boolean;
}

/*
 * Where a change is: Queued, waiting for the project's change before it;
 * Running; Completed, every monitor dealt with (some may have been left
 * out, each with why); Stopped by someone, what changed kept; Failed as a
 * whole, its error says why.
 */
export enum MonitorTemplateChangeStatus {
  Queued = "Queued",
  Running = "Running",
  Completed = "Completed",
  Stopped = "Stopped",
  Failed = "Failed",
}

export const ALL_MONITOR_TEMPLATE_CHANGE_STATUSES: ReadonlyArray<MonitorTemplateChangeStatus> =
  [
    MonitorTemplateChangeStatus.Queued,
    MonitorTemplateChangeStatus.Running,
    MonitorTemplateChangeStatus.Completed,
    MonitorTemplateChangeStatus.Stopped,
    MonitorTemplateChangeStatus.Failed,
  ];

export const ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES: ReadonlyArray<MonitorTemplateChangeStatus> =
  [MonitorTemplateChangeStatus.Queued, MonitorTemplateChangeStatus.Running];

export function isMonitorTemplateChangeActive(
  status: MonitorTemplateChangeStatus | string | null | undefined,
): boolean {
  return Boolean(
    status &&
      (
        ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES as ReadonlyArray<string>
      ).includes(status),
  );
}

/*
 * What happened to one monitor.
 *
 *  - Changed: linked, unlinked, its settings brought or cleared.
 *  - Unchanged: it was as asked already - linked to the template, or linked
 *    to none.
 *  - Skipped: left out, for a reason a retry would not change: another type
 *    than the template's, gone or not the person's to change, its device
 *    has the template's monitor already. Its reason says what to do.
 *  - Failed: it could not be changed this time; Retry tries it again.
 *  - NotReached: the change stopped, or failed, before it got to it; Retry
 *    tries it again.
 *  - Pending: not dealt with yet.
 */
export enum MonitorTemplateChangeOutcome {
  Pending = "pending",
  Changed = "changed",
  Unchanged = "unchanged",
  Skipped = "skipped",
  Failed = "failed",
  NotReached = "notReached",
}

/*
 * Why a monitor was not reached, when the change stopped or failed first:
 * the change's own reasons, keys of the Dashboard's locales, so its list of
 * what was not done reads in the reader's language. Each is said once for
 * every monitor of its group ("491 monitors were not reached"), so none
 * speaks of "this monitor", as the discovery import's do not.
 */
export const MONITOR_NOT_REACHED_STOPPED: string = translationKey(
  "The change was stopped.",
);

export const MONITOR_NOT_REACHED_FAILED: string = translationKey(
  "The change stopped before it finished.",
);

/*
 * A network alert policy's change (#11452): a monitor someone moved to
 * another template, or unlinked, since the policy was pointed at its new
 * template is no longer the policy's, and is left as they chose. Said once
 * under a heading for one monitor or for hundreds, so it names none.
 */
export const MONITOR_NO_LONGER_THE_POLICYS: string = translationKey(
  "Moved to another template or unlinked by someone since, so no longer the policy's.",
);

// Every reason the change writes itself, for the Dashboard to word them all.
export const MONITOR_TEMPLATE_CHANGE_OWN_REASONS: ReadonlyArray<string> = [
  MONITOR_NOT_REACHED_STOPPED,
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NO_LONGER_THE_POLICYS,
];

// What one link or unlink did (MonitorTemplateService).
export interface MonitorTemplateLinkResult {
  outcome:
    | MonitorTemplateChangeOutcome.Changed
    | MonitorTemplateChangeOutcome.Unchanged;
  // The open incidents and alerts the monitor's old criteria left, resolved.
  resolvedIncidentCount: number;
  resolvedAlertCount: number;
}

/*
 * A monitor worth a line of its own: one left out, failed or not reached,
 * with why. A monitor changed, or as asked already, is counted only, so a
 * change of 10,000 monitors keeps a short record.
 */
export interface MonitorTemplateChangeLine {
  monitorId: string;
  monitorName?: string | undefined;
  outcome:
    | MonitorTemplateChangeOutcome.Skipped
    | MonitorTemplateChangeOutcome.Failed
    | MonitorTemplateChangeOutcome.NotReached;
  reason: string;
}

// What a change's results hold: how far it got, and the lines.
export interface MonitorTemplateChangeResults {
  // How many of `monitorIds` were dealt with, in order.
  processedCount: number;
  lines: Array<MonitorTemplateChangeLine>;
  // deleteTemplateWhenDone: the template was deleted at the end.
  isTemplateDeleted?: boolean | undefined;
  /*
   * deleteTemplateWhenDone, when the template was kept: how many monitors
   * were still linked to it (ones the person may not read or change, or
   * linked meanwhile), or why its delete was refused.
   */
  templateStillLinkedCount?: number | undefined;
  templateDeleteError?: string | undefined;
  /*
   * An auto import rule's change (#11451): the rule was pointed at the
   * template once every one of its devices' monitors was on it; or how many
   * were still on its old template, so it was kept on it; or why pointing it
   * was refused.
   */
  isAutoImportRulePointed?: boolean | undefined;
  autoImportRuleMonitorsLeftCount?: number | undefined;
  autoImportRuleError?: string | undefined;
}

// The counts the progress bar and the summary are drawn from.
export interface MonitorTemplateChangeProgress {
  total: number;
  processed: number;
  changed: number;
  unchanged: number;
  skipped: number;
  failed: number;
  notReached: number;
  resolvedIncidents: number;
  resolvedAlerts: number;
}

// The most lines a change's view carries: the rest are counted.
export const MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT: number = 200;

// A change as the Dashboard draws it.
export interface MonitorTemplateChangeView {
  id: string;
  status: MonitorTemplateChangeStatus;
  settings: MonitorTemplateChangeSettings;
  monitorTemplateId?: string | undefined;
  monitorTemplateName?: string | undefined;
  progress: MonitorTemplateChangeProgress;
  lines: Array<MonitorTemplateChangeLine>;
  // More lines than the view carries.
  isLinesTruncated: boolean;
  error?: string | undefined;
  isStopRequested: boolean;
  // The monitors Retry would try again: failed and not reached.
  retryableCount: number;
  // The template was deleted at the end (deleteTemplateWhenDone).
  isTemplateDeleted: boolean;
  // deleteTemplateWhenDone, when the template was kept: why (see the results).
  templateStillLinkedCount?: number | undefined;
  templateDeleteError?: string | undefined;
  /*
   * A network alert policy's change (#11452): the policy whose monitors move
   * to the template it now names, as OneUptime, staying the policy's.
   */
  networkAlertPolicyId?: string | undefined;
  networkAlertPolicyName?: string | undefined;
  /*
   * An auto import rule's change (#11451): the rule whose devices' monitors
   * move, pointed at the template once they all are on it (see the results).
   */
  autoImportRuleId?: string | undefined;
  autoImportRuleName?: string | undefined;
  isAutoImportRulePointed: boolean;
  autoImportRuleMonitorsLeftCount?: number | undefined;
  autoImportRuleError?: string | undefined;
  createdAt?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
}

export function emptyMonitorTemplateChangeProgress(
  total: number,
): MonitorTemplateChangeProgress {
  return {
    total: total,
    processed: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    notReached: 0,
    resolvedIncidents: 0,
    resolvedAlerts: 0,
  };
}

const LINE_OUTCOMES: ReadonlyArray<string> = [
  MonitorTemplateChangeOutcome.Skipped,
  MonitorTemplateChangeOutcome.Failed,
  MonitorTemplateChangeOutcome.NotReached,
];

const toCount: (value: unknown) => number = (value: unknown): number => {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

// A change's settings as stored, read back whatever they hold.
export function readMonitorTemplateChangeSettings(
  value: unknown,
): MonitorTemplateChangeSettings {
  const settings: Record<string, unknown> =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    kind:
      settings["kind"] === MonitorTemplateChangeKind.Unlink
        ? MonitorTemplateChangeKind.Unlink
        : MonitorTemplateChangeKind.Link,
    applyTemplateSettings: settings["applyTemplateSettings"] === true,
    clearTemplateSettings: settings["clearTemplateSettings"] === true,
    deleteTemplateWhenDone: settings["deleteTemplateWhenDone"] === true,
  };
}

// A change's results as stored, read back whatever they hold.
export function readMonitorTemplateChangeResults(
  value: unknown,
): MonitorTemplateChangeResults {
  const results: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const lines: Array<MonitorTemplateChangeLine> = [];

  for (const item of Array.isArray(results["lines"])
    ? (results["lines"] as Array<unknown>)
    : []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const line: Record<string, unknown> = item as Record<string, unknown>;
    const monitorId: unknown = line["monitorId"];
    const outcome: unknown = line["outcome"];

    if (
      typeof monitorId !== "string" ||
      !monitorId ||
      typeof outcome !== "string" ||
      !LINE_OUTCOMES.includes(outcome)
    ) {
      continue;
    }

    lines.push({
      monitorId: monitorId,
      ...(typeof line["monitorName"] === "string" && line["monitorName"]
        ? { monitorName: line["monitorName"] as string }
        : {}),
      outcome: outcome as MonitorTemplateChangeLine["outcome"],
      reason: typeof line["reason"] === "string" ? line["reason"] : "",
    });
  }

  return {
    processedCount: toCount(results["processedCount"]),
    lines: lines,
    ...(results["isTemplateDeleted"] === true
      ? { isTemplateDeleted: true }
      : {}),
    ...(toCount(results["templateStillLinkedCount"]) > 0
      ? {
          templateStillLinkedCount: toCount(
            results["templateStillLinkedCount"],
          ),
        }
      : {}),
    ...(typeof results["templateDeleteError"] === "string" &&
    results["templateDeleteError"]
      ? { templateDeleteError: results["templateDeleteError"] as string }
      : {}),
    ...(results["isAutoImportRulePointed"] === true
      ? { isAutoImportRulePointed: true }
      : {}),
    ...(toCount(results["autoImportRuleMonitorsLeftCount"]) > 0
      ? {
          autoImportRuleMonitorsLeftCount: toCount(
            results["autoImportRuleMonitorsLeftCount"],
          ),
        }
      : {}),
    ...(typeof results["autoImportRuleError"] === "string" &&
    results["autoImportRuleError"]
      ? { autoImportRuleError: results["autoImportRuleError"] as string }
      : {}),
  };
}

// A change's progress as stored, read back whatever it holds.
export function readMonitorTemplateChangeProgress(
  value: unknown,
): MonitorTemplateChangeProgress {
  const progress: Record<string, unknown> =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    total: toCount(progress["total"]),
    processed: toCount(progress["processed"]),
    changed: toCount(progress["changed"]),
    unchanged: toCount(progress["unchanged"]),
    skipped: toCount(progress["skipped"]),
    failed: toCount(progress["failed"]),
    notReached: toCount(progress["notReached"]),
    resolvedIncidents: toCount(progress["resolvedIncidents"]),
    resolvedAlerts: toCount(progress["resolvedAlerts"]),
  };
}

// The monitor ids a change was asked for, read back whatever they hold.
export function readMonitorTemplateChangeMonitorIds(
  value: unknown,
): Array<string> {
  return (Array.isArray(value) ? value : []).filter(
    (id: unknown): id is string => {
      return typeof id === "string" && Boolean(id);
    },
  );
}

/*
 * The monitors a Retry tries again: those that failed, and those the change
 * did not reach - each once, in the order they were asked for.
 */
export function getRetryableMonitorIds(
  results: MonitorTemplateChangeResults,
): Array<string> {
  const ids: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const line of results.lines) {
    if (
      line.outcome !== MonitorTemplateChangeOutcome.Failed &&
      line.outcome !== MonitorTemplateChangeOutcome.NotReached
    ) {
      continue;
    }

    const key: string = line.monitorId.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      ids.push(line.monitorId);
    }
  }

  return ids;
}

/*
 * Whether a change of this kind may be asked for: a link names its
 * template, a delete at the end is an unlink's of the template's monitors.
 */
export function assertMonitorTemplateChangeSettings(data: {
  settings: MonitorTemplateChangeSettings;
  hasTemplate: boolean;
}): void {
  if (
    data.settings.kind === MonitorTemplateChangeKind.Link &&
    !data.hasTemplate
  ) {
    throw new BadDataException(
      "Pick the template to link the monitors to, then try again.",
    );
  }

  if (
    data.settings.deleteTemplateWhenDone &&
    (data.settings.kind !== MonitorTemplateChangeKind.Unlink ||
      !data.hasTemplate)
  ) {
    throw new BadDataException(
      "Only a change that unlinks a template's monitors can delete the template when it is done.",
    );
  }
}

/*
 * A change's view as the API answers it (MonitorTemplateChangeRunner.toView),
 * read back by the Dashboard; null when the answer holds no change.
 */
export function readMonitorTemplateChangeView(
  value: unknown,
): MonitorTemplateChangeView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const view: Record<string, unknown> = value as Record<string, unknown>;
  const id: unknown = view["id"];
  const status: unknown = view["status"];

  if (
    typeof id !== "string" ||
    !id ||
    typeof status !== "string" ||
    !(ALL_MONITOR_TEMPLATE_CHANGE_STATUSES as ReadonlyArray<string>).includes(
      status,
    )
  ) {
    return null;
  }

  const results: MonitorTemplateChangeResults =
    readMonitorTemplateChangeResults({
      processedCount: 0,
      lines: view["lines"],
    });

  const readText: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const text: unknown = view[key];
    return typeof text === "string" && text ? text : undefined;
  };

  return {
    id: id,
    status: status as MonitorTemplateChangeStatus,
    settings: readMonitorTemplateChangeSettings(view["settings"]),
    monitorTemplateId: readText("monitorTemplateId"),
    monitorTemplateName: readText("monitorTemplateName"),
    progress: readMonitorTemplateChangeProgress(view["progress"]),
    lines: results.lines,
    isLinesTruncated: view["isLinesTruncated"] === true,
    error: readText("error"),
    isStopRequested: view["isStopRequested"] === true,
    retryableCount: toCount(view["retryableCount"]),
    isTemplateDeleted: view["isTemplateDeleted"] === true,
    ...(toCount(view["templateStillLinkedCount"]) > 0
      ? { templateStillLinkedCount: toCount(view["templateStillLinkedCount"]) }
      : {}),
    templateDeleteError: readText("templateDeleteError"),
    networkAlertPolicyId: readText("networkAlertPolicyId"),
    networkAlertPolicyName: readText("networkAlertPolicyName"),
    autoImportRuleId: readText("autoImportRuleId"),
    autoImportRuleName: readText("autoImportRuleName"),
    isAutoImportRulePointed: view["isAutoImportRulePointed"] === true,
    ...(toCount(view["autoImportRuleMonitorsLeftCount"]) > 0
      ? {
          autoImportRuleMonitorsLeftCount: toCount(
            view["autoImportRuleMonitorsLeftCount"],
          ),
        }
      : {}),
    autoImportRuleError: readText("autoImportRuleError"),
    createdAt: readText("createdAt"),
    startedAt: readText("startedAt"),
    completedAt: readText("completedAt"),
  };
}

/*
 * Whether a change is one the Monitors list shows (#11454): still running,
 * or finished in the last `recentMs` with monitors left out, failed or not
 * reached, or failed as a whole - what someone who closed its dialog would
 * want to come back to. A change that went well is done with once it is.
 */
export const MONITOR_TEMPLATE_CHANGE_RECENT_MS: number = 60 * 60 * 1000;

export function isMonitorTemplateChangeWorthShowing(data: {
  view: MonitorTemplateChangeView;
  now: number;
  recentMs?: number | undefined;
}): boolean {
  if (isMonitorTemplateChangeActive(data.view.status)) {
    return true;
  }

  const completedAt: number = new Date(data.view.completedAt || "").getTime();

  if (
    !Number.isFinite(completedAt) ||
    data.now - completedAt >
      (data.recentMs ?? MONITOR_TEMPLATE_CHANGE_RECENT_MS)
  ) {
    return false;
  }

  const progress: MonitorTemplateChangeProgress = data.view.progress;

  return (
    data.view.status === MonitorTemplateChangeStatus.Failed ||
    progress.skipped + progress.failed + progress.notReached > 0
  );
}
