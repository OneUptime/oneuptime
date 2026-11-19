import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE,
  JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE,
  JOURNALD_SYSTEMD_RESULT_ATTRIBUTE,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionEvent,
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionSince,
  ResourceAttentionText,
} from "../../../Components/ResourcePart/ResourceAttention";
import { withRouteQueryParams } from "../../../Utils/TelemetryTabScope";

/*
 * WHY A SYSTEMD UNIT FAILED, FROM ITS OWN JOURNAL (#9748).
 *
 * A host's unit page said "Current State: Failed" and nothing else: the
 * systemd receiver reports a unit's state and no more, and the journal
 * arrived as one JSON map per entry, with no unit to find a line by. The
 * host's collector now sends each journal line as its message, at its
 * level, with the unit it is about (HostCollectorDefaultConfig's journald
 * operators), and systemd's own lines about a unit carry why it failed, as
 * systemd says it:
 *
 *   nginx.service: Main process exited, code=exited, status=1/FAILURE
 *     systemd.unit.exit_code = exited, systemd.unit.exit_status = 1
 *   nginx.service: Failed with result 'exit-code'.
 *     systemd.unit.result = exit-code
 *
 * This reads them back: the result (exit-code, signal, core-dump, timeout,
 * watchdog, start-limit-hit, oom-kill...), how its process ended (its exit
 * code, or the signal that killed it), when, and the unit's own last lines
 * - the error it printed - into the row the shared dialog draws
 * (ResourceAttentionDialog), and the unit's Logs a step away, filtered to
 * it.
 *
 * React-free and free of the route map, so App tests can read it.
 */

// How far back the unit's page reads its journal: a unit failed days ago still says why.
export const SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS: number = 7;

// How many of the unit's newest lines one read takes.
export const SYSTEMD_UNIT_JOURNAL_READ_LIMIT: number = 50;

// How many of them the Recent logs card shows.
export const SYSTEMD_UNIT_RECENT_LINES_SHOWN: number = 10;

/*
 * How long before a failure a process's exit is the one that failed it:
 * systemd writes the two lines together, a stop timeout's kill the longest
 * after (TimeoutStopSec, 90 seconds by default).
 */
export const SYSTEMD_EXIT_BEFORE_FAILURE_MS: number = 10 * 60 * 1000;

// The host's resource attribute every line of it carries.
export const HOST_NAME_LOG_ATTRIBUTE: string = "resource.host.name";

// Who wrote a line: systemd's own lines name it.
export const SYSLOG_IDENTIFIER_ATTRIBUTE: string = "syslog.identifier";
const PROCESS_PID_ATTRIBUTE: string = "process.pid";

export interface SystemdUnitJournalLine {
  time: Date;
  body: string;
  severityText?: string | undefined;
  attributes: Record<string, unknown>;
}

// How a unit's process ended, as systemd wrote it.
export interface SystemdProcessExit {
  // exited, killed or dumped.
  code: string;
  // The exit code, or the signal's number.
  status: string;
  // systemd's name for it: FAILURE, EXEC, KILL, SEGV... ("" when unsaid).
  statusName: string;
  at: Date;
  message: string;
}

export interface SystemdUnitFailure {
  // systemd's result, as it writes it: exit-code, signal, timeout...
  result: string;
  failedAt: Date;
  message: string;
  exit?: SystemdProcessExit | undefined;
}

// "status=1/FAILURE", "status=9/KILL": the name systemd gives a status.
const STATUS_NAME: RegExp = /status=\d{1,5}\/([A-Za-z0-9_+-]{1,40})/;

// A signal's name as systemd writes one: KILL, SEGV, SIGRTMIN+3.
const SIGNAL_NAME: RegExp = /^[A-Z0-9+-]+$/;

function text(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function attribute(line: SystemdUnitJournalLine, key: string): string {
  return text(line.attributes[key]);
}

// Whether systemd itself (PID 1) wrote the line, about the unit.
export function isSystemdOwnLine(line: SystemdUnitJournalLine): boolean {
  return (
    attribute(line, PROCESS_PID_ATTRIBUTE) === "1" ||
    attribute(line, SYSLOG_IDENTIFIER_ATTRIBUTE) === "systemd"
  );
}

function newestFirst(
  lines: ReadonlyArray<SystemdUnitJournalLine>,
): Array<SystemdUnitJournalLine> {
  return [...lines].sort(
    (a: SystemdUnitJournalLine, b: SystemdUnitJournalLine): number => {
      return b.time.getTime() - a.time.getTime();
    },
  );
}

/*
 * The unit's newest failure, as systemd said it: its result (anything but
 * success), when, and how its process ended just before - or null when its
 * journal holds none (it never failed in the window, or the host's
 * collector does not send its unit with each line).
 */
export function readSystemdUnitFailure(
  lines: ReadonlyArray<SystemdUnitJournalLine>,
): SystemdUnitFailure | null {
  const sorted: Array<SystemdUnitJournalLine> = newestFirst(lines);

  const resultLine: SystemdUnitJournalLine | undefined = sorted.find(
    (line: SystemdUnitJournalLine): boolean => {
      const result: string = attribute(line, JOURNALD_SYSTEMD_RESULT_ATTRIBUTE);
      return Boolean(result) && result !== "success";
    },
  );

  if (!resultLine) {
    return null;
  }

  const failedAt: Date = resultLine.time;

  const exitLine: SystemdUnitJournalLine | undefined = sorted.find(
    (line: SystemdUnitJournalLine): boolean => {
      const at: number = line.time.getTime();
      return (
        Boolean(attribute(line, JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE)) &&
        at <= failedAt.getTime() &&
        failedAt.getTime() - at <= SYSTEMD_EXIT_BEFORE_FAILURE_MS
      );
    },
  );

  return {
    result: attribute(resultLine, JOURNALD_SYSTEMD_RESULT_ATTRIBUTE),
    failedAt: failedAt,
    message: resultLine.body,
    exit: exitLine
      ? {
          code: attribute(exitLine, JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE),
          status: attribute(exitLine, JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE),
          statusName: STATUS_NAME.exec(exitLine.body)?.[1] || "",
          at: exitLine.time,
          message: exitLine.body,
        }
      : undefined,
  };
}

/*
 * A signal by the name people know it by: systemd writes KILL, SEGV, TERM;
 * kill and the man pages say SIGKILL. Its number when systemd named none.
 */
export function getSignalName(exit: SystemdProcessExit): string {
  if (exit.statusName && SIGNAL_NAME.test(exit.statusName)) {
    return exit.statusName.startsWith("SIG")
      ? exit.statusName
      : `SIG${exit.statusName}`;
  }

  return exit.status;
}

/*
 * What each result means, in OneUptime's words (each a key): what systemd
 * calls Result= (systemd.service's own list, and the unit types' that
 * fail the same way).
 */
const RESULT_WORDS: Record<string, string> = {
  "exit-code": translationKey("Exited with an error"),
  signal: translationKey("Killed by a signal"),
  "core-dump": translationKey("Crashed and dumped core"),
  timeout: translationKey("Timed out"),
  watchdog: translationKey("Stopped answering its watchdog"),
  "start-limit-hit": translationKey("Restarted too often"),
  "oom-kill": translationKey("Ran out of memory"),
  resources: translationKey("Could not be set up to run"),
  protocol: translationKey("Broke the service protocol"),
};

const EXITED_WITH_CODE: string = translationKey("Exited with code {{code}}");
const KILLED_BY: string = translationKey("Killed by {{signal}}");
const DUMPED_CORE_ON: string = translationKey("Crashed on {{signal}}");
const FAILED_WITH_RESULT: string = translationKey(
  "Failed with result {{result}}",
);

/*
 * Why it failed, in one chip: how its process ended where systemd said so
 * (an exit code, the signal that killed it), else what its result means,
 * else its result as systemd wrote it.
 */
export function getSystemdFailureReason(
  failure: SystemdUnitFailure,
): ResourceAttentionText {
  const exit: SystemdProcessExit | undefined = failure.exit;

  if (exit && exit.status) {
    if (exit.code === "exited" && failure.result === "exit-code") {
      return { text: EXITED_WITH_CODE, values: { code: exit.status } };
    }

    if (exit.code === "killed" && failure.result === "signal") {
      return { text: KILLED_BY, values: { signal: getSignalName(exit) } };
    }

    if (exit.code === "dumped" && failure.result === "core-dump") {
      return { text: DUMPED_CORE_ON, values: { signal: getSignalName(exit) } };
    }
  }

  const words: string | undefined = RESULT_WORDS[failure.result];

  return words
    ? { text: words }
    : { text: FAILED_WITH_RESULT, values: { result: failure.result } };
}

export const SYSTEMD_UNIT_CURRENT: { key: string; label: string } = {
  key: "systemd-unit",
  label: translationKey("This unit"),
};

const KIND_SYSTEMD_UNIT: string = translationKey("Systemd unit");
const FAILED_SINCE: string = translationKey("Failed {{time}}");

// Since when it is failed: "Failed 2 hours ago", in the dialog and the tile alike.
export function getSystemdUnitFailureSince(
  failure: SystemdUnitFailure,
): ResourceAttentionSince {
  return { at: failure.failedAt, template: FAILED_SINCE };
}

/*
 * The unit's own lines - what it printed, not what systemd said about it -
 * newest first, at or before `until`.
 */
export function getSystemdUnitOwnLines(data: {
  lines: ReadonlyArray<SystemdUnitJournalLine>;
  until?: Date | undefined;
}): Array<SystemdUnitJournalLine> {
  return newestFirst(data.lines).filter(
    (line: SystemdUnitJournalLine): boolean => {
      return (
        !isSystemdOwnLine(line) &&
        Boolean(line.body) &&
        (!data.until || line.time.getTime() <= data.until.getTime())
      );
    },
  );
}

/*
 * The unit as the dialog behind its Failed lists it: why in a chip,
 * systemd's result and exit status as written, the last thing it printed
 * before it failed, since when, and its lines before that.
 */
export function getSystemdUnitFailureItem(data: {
  unitName: string;
  failure: SystemdUnitFailure;
  lines: ReadonlyArray<SystemdUnitJournalLine>;
}): ResourceAttentionItem {
  const failure: SystemdUnitFailure = data.failure;
  const facts: Array<ResourceAttentionFact> = [
    { key: "result", label: "Result", value: failure.result },
  ];

  if (failure.exit?.status) {
    facts.push({
      key: "exit-status",
      label: "Exit status",
      value: failure.exit.statusName
        ? `${failure.exit.status}/${failure.exit.statusName}`
        : failure.exit.status,
    });
  }

  const ownLines: Array<SystemdUnitJournalLine> = getSystemdUnitOwnLines({
    lines: data.lines,
    until: failure.failedAt,
  });

  const [lastSaid, ...before] = ownLines;

  return {
    key: SYSTEMD_UNIT_CURRENT.key,
    kind: KIND_SYSTEMD_UNIT,
    icon: IconProp.Cog6Tooth,
    name: data.unitName,
    severity: ResourceAttentionSeverity.Critical,
    reasons: [getSystemdFailureReason(failure)],
    facts: facts,
    // What it printed last, as it wrote it: else systemd's own words.
    message: lastSaid?.body || failure.exit?.message || failure.message,
    since: getSystemdUnitFailureSince(failure),
    events: before.map(
      (line: SystemdUnitJournalLine, index: number): ResourceAttentionEvent => {
        return {
          key: `${line.time.getTime()}-${index}`,
          reason: attribute(line, SYSLOG_IDENTIFIER_ATTRIBUTE) || data.unitName,
          message: line.body,
          count: 1,
          lastSeenAt: line.time,
        };
      },
    ),
  };
}

/*
 * The host's Logs, on this unit's lines of the window: the explorer's own
 * chip for the unit, as someone filtering by hand would set it.
 */
export function getSystemdUnitLogsRoute(data: {
  hostLogsRoute: Route;
  unitName: string;
  startTime: Date;
  endTime: Date;
}): Route {
  const query: CrossSignalQueryParams = toLogsExplorerQueryParams({
    attributes: { [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: data.unitName },
    startTime: data.startTime,
    endTime: data.endTime,
  });

  /*
   * A value Route rejects leaves the Logs unfiltered rather than no link:
   * the reader still lands on the host's logs.
   */
  return (
    withRouteQueryParams(data.hostLogsRoute, query.params) || data.hostLogsRoute
  );
}
