import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  SECURITY_CASE_STORY_FILTER_OF_KIND,
  SECURITY_CASE_STORY_MAX_TEXT_LENGTH,
  SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES,
  SecurityCaseStoryFilter,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
} from "../../Types/SecurityCase/SecurityCaseContext";
import { getRequestOutcomeRank } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";

/*
 * THE STORY OF A CASE, AS ITEMS: the pure half of SecurityCaseStory
 * (Server/Utils/SecurityCase/Context/SecurityCaseStory.ts), which reads the
 * rows and hands them here to be told.
 *
 *   - Security events are told in runs: alike events - the same kind of
 *     event, from the same address or user, about the same attack - that
 *     follow each other within SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES are
 *     one item, with how many there were and how far their requests got. A
 *     run is headed by its most telling event: the one whose request got
 *     furthest, then the most severe, then the first.
 *   - Every exception the events' requests threw is an item of its own, at
 *     the first time it was thrown.
 *   - The items are merged on one time axis, oldest first. A story holding
 *     more than its bound keeps what tells it best - how the case opened and
 *     where it stands, its detections, incidents and exceptions - and leaves
 *     out the least telling events first.
 *
 * Pure and React-free, so the order, the runs and the bound are pinned in a
 * plain test.
 */

// One security event as the story reads it.
export interface StoryEventRow {
  time: Date;
  eventUid: string;
  className: string;
  message: string;
  severityName: string;
  severityId: number;
  principalUser: string;
  principalHost: string;
  principalIp: string;
  targetResource: string;
  requestOutcome: string;
  traceId: string;
  spanId: string;
  sessionId: string;
  // The attack a request carried (web.attack.kind), when it carried one.
  attackKind: string;
  // What its request threw, when it was followed into its trace.
  exceptionFingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
}

// The attributes the story reads off an event, beside its columns.
export const STORY_EVENT_ATTRIBUTE_KEYS: {
  attackKind: string;
  exceptionFingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
} = {
  attackKind: "web.attack.kind",
  exceptionFingerprint: "oneuptime.exception.fingerprint",
  exceptionType: "oneuptime.exception.type",
  exceptionMessage: "oneuptime.exception.message",
};

export function cutStoryText(
  value: string | null | undefined,
  limit: number = SECURITY_CASE_STORY_MAX_TEXT_LENGTH,
): string {
  const text: string = (value || "").trim();

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// The first line of a text a person wrote, for a note's item.
export function firstLine(value: string | null | undefined): string {
  const text: string = (value || "").trim();
  const end: number = text.indexOf("\n");

  return cutStoryText(end === -1 ? text : text.slice(0, end));
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return (typeof value === "string" ? value : String(value)).trim();
}

/*
 * A ClickHouse time as JavaScript reads it: DateTime64 is written
 * "2026-10-27 06:45:00.123456789", in UTC, with no zone.
 */
export function readClickhouseTime(value: JSONValue | undefined): Date | null {
  const text: string = readText(value);

  if (!text) {
    return null;
  }

  const date: Date = new Date(
    text.includes("T") || text.endsWith("Z")
      ? text
      : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

// A row of the events read, or null when it has no usable time.
export function readStoryEventRow(row: JSONObject): StoryEventRow | null {
  const time: Date | null = readClickhouseTime(row["time"]);

  if (!time) {
    return null;
  }

  const attributes: JSONObject =
    row["attributes"] &&
    typeof row["attributes"] === "object" &&
    !Array.isArray(row["attributes"])
      ? (row["attributes"] as JSONObject)
      : {};
  const severityId: number = Number(row["severityId"]);

  return {
    time,
    eventUid: readText(row["eventUid"]),
    className: readText(row["className"]),
    message: readText(row["message"]),
    severityName: readText(row["severityName"]),
    severityId: Number.isFinite(severityId) ? severityId : 0,
    principalUser: readText(row["principalUser"]),
    principalHost: readText(row["principalHost"]),
    principalIp: readText(row["principalIp"]),
    targetResource: readText(row["targetResource"]),
    requestOutcome: readText(row["requestOutcome"]),
    traceId: readText(row["traceId"]),
    spanId: readText(row["spanId"]),
    sessionId: readText(row["sessionId"]),
    attackKind: readText(attributes[STORY_EVENT_ATTRIBUTE_KEYS.attackKind]),
    exceptionFingerprint: readText(
      attributes[STORY_EVENT_ATTRIBUTE_KEYS.exceptionFingerprint],
    ),
    exceptionType: readText(
      attributes[STORY_EVENT_ATTRIBUTE_KEYS.exceptionType],
    ),
    exceptionMessage: readText(
      attributes[STORY_EVENT_ATTRIBUTE_KEYS.exceptionMessage],
    ),
  };
}

/*
 * Who acted, as a run is told by: the address the event came from, else the
 * user, else the host. '' when the event names none.
 */
export function getStoryEventPrincipal(row: StoryEventRow): string {
  return row.principalIp || row.principalUser || row.principalHost || "";
}

// Events that are told together share this.
export function getStoryEventRunKey(row: StoryEventRow): string {
  return [
    row.className.toLowerCase(),
    getStoryEventPrincipal(row).toLowerCase(),
    row.attackKind.toLowerCase(),
  ].join("\u0000");
}

/*
 * Whether one event tells a run better than another: its request got
 * further, then it is more severe, then it came first.
 */
export function isMoreTelling(
  candidate: StoryEventRow,
  current: StoryEventRow,
): boolean {
  const candidateRank: number = getRequestOutcomeRank(candidate.requestOutcome);
  const currentRank: number = getRequestOutcomeRank(current.requestOutcome);

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }

  if (candidate.severityId !== current.severityId) {
    return candidate.severityId > current.severityId;
  }

  return candidate.time.getTime() < current.time.getTime();
}

function byTime(first: StoryEventRow, second: StoryEventRow): number {
  return first.time.getTime() - second.time.getTime();
}

interface EventRun {
  key: string;
  rows: Array<StoryEventRow>;
  lead: StoryEventRow;
}

/*
 * The events as runs, each one item: in time order, an event joins the run
 * of its kind that its predecessor ended no more than `gapInMinutes` before,
 * and starts a new one otherwise.
 */
export function runStoryEvents(
  rows: ReadonlyArray<StoryEventRow>,
  gapInMinutes: number = SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES,
): Array<SecurityCaseStoryItemJson> {
  const gapInMs: number = Math.max(0, gapInMinutes) * 60 * 1000;
  const runs: Array<EventRun> = [];
  const openRuns: Map<string, EventRun> = new Map();

  for (const row of [...rows].sort(byTime)) {
    const key: string = getStoryEventRunKey(row);
    const open: EventRun | undefined = openRuns.get(key);
    const last: StoryEventRow | undefined = open
      ? open.rows[open.rows.length - 1]
      : undefined;

    if (open && last && row.time.getTime() - last.time.getTime() <= gapInMs) {
      open.rows.push(row);

      if (isMoreTelling(row, open.lead)) {
        open.lead = row;
      }

      continue;
    }

    const run: EventRun = { key, rows: [row], lead: row };

    runs.push(run);
    openRuns.set(key, run);
  }

  return runs.map((run: EventRun, index: number): SecurityCaseStoryItemJson => {
    return toEventsItem(run, index);
  });
}

function toEventsItem(run: EventRun, index: number): SecurityCaseStoryItemJson {
  const first: StoryEventRow = run.rows[0]!;
  const last: StoryEventRow = run.rows[run.rows.length - 1]!;
  const lead: StoryEventRow = run.lead;
  const isRun: boolean = run.rows.length > 1;

  const item: SecurityCaseStoryItemJson = {
    key: `events:${first.eventUid || first.time.toISOString()}:${index}`,
    kind: SecurityCaseStoryItemKind.Events,
    time: first.time.toISOString(),
    title: cutStoryText(lead.message || lead.className || "Security event"),
    count: run.rows.length,
    links: {
      ...(lead.eventUid ? { eventUid: lead.eventUid } : {}),
      ...(lead.traceId ? { traceId: lead.traceId } : {}),
      ...(lead.spanId ? { spanId: lead.spanId } : {}),
      ...(lead.sessionId ? { sessionId: lead.sessionId } : {}),
      ...(getStoryEventPrincipal(lead)
        ? { observable: getStoryEventPrincipal(lead) }
        : {}),
    },
  };

  if (isRun) {
    item.endTime = last.time.toISOString();
  }

  if (lead.className) {
    item.className = lead.className;
  }

  if (lead.severityName) {
    item.severityName = lead.severityName;
  }

  if (lead.requestOutcome) {
    item.requestOutcome = lead.requestOutcome;
  }

  if (lead.targetResource && lead.targetResource !== item.title) {
    item.detail = cutStoryText(lead.targetResource);
  }

  if (isRun) {
    const outcomes: Record<string, number> = {};

    for (const row of run.rows) {
      outcomes[row.requestOutcome] = (outcomes[row.requestOutcome] || 0) + 1;
    }

    item.outcomes = outcomes;
  }

  return item;
}

/*
 * One item for each exception the events' requests threw, at the first
 * time it was thrown, counting the events whose request threw it.
 */
export function buildStoryExceptionItems(
  rows: ReadonlyArray<StoryEventRow>,
): Array<SecurityCaseStoryItemJson> {
  const byFingerprint: Map<string, { first: StoryEventRow; count: number }> =
    new Map();

  for (const row of [...rows].sort(byTime)) {
    if (!row.exceptionFingerprint) {
      continue;
    }

    const seen: { first: StoryEventRow; count: number } | undefined =
      byFingerprint.get(row.exceptionFingerprint);

    if (seen) {
      seen.count += 1;
      continue;
    }

    byFingerprint.set(row.exceptionFingerprint, { first: row, count: 1 });
  }

  return Array.from(byFingerprint.entries()).map(
    ([fingerprint, seen]: [
      string,
      { first: StoryEventRow; count: number },
    ]): SecurityCaseStoryItemJson => {
      const item: SecurityCaseStoryItemJson = {
        key: `exception:${fingerprint}`,
        kind: SecurityCaseStoryItemKind.Exception,
        time: seen.first.time.toISOString(),
        title: cutStoryText(seen.first.exceptionType || "Exception"),
        count: seen.count,
        links: {
          exceptionFingerprint: fingerprint,
          ...(seen.first.traceId ? { traceId: seen.first.traceId } : {}),
          ...(seen.first.spanId ? { spanId: seen.first.spanId } : {}),
          ...(seen.first.sessionId ? { sessionId: seen.first.sessionId } : {}),
        },
      };

      if (seen.first.exceptionMessage) {
        item.detail = cutStoryText(seen.first.exceptionMessage);
      }

      return item;
    },
  );
}

/*
 * What a story keeps when it holds too much, most telling first: how the
 * case opened and where it stands, then its detections, the incidents it set
 * off and the exceptions its requests threw, then the runs of events (the
 * furthest-reaching first), then alerts, changes, playbook runs and notes.
 */
export const SECURITY_CASE_STORY_KEEP_ORDER: ReadonlyArray<SecurityCaseStoryItemKind> =
  [
    SecurityCaseStoryItemKind.CaseOpened,
    SecurityCaseStoryItemKind.Milestone,
    SecurityCaseStoryItemKind.Detection,
    SecurityCaseStoryItemKind.Incident,
    SecurityCaseStoryItemKind.Exception,
    SecurityCaseStoryItemKind.Events,
    SecurityCaseStoryItemKind.Alert,
    SecurityCaseStoryItemKind.Change,
    SecurityCaseStoryItemKind.PlaybookRun,
    SecurityCaseStoryItemKind.Note,
  ];

/*
 * Items at the same moment, in the order they are read: what changed, then
 * what fired, then what it set off, then the response.
 */
export const SECURITY_CASE_STORY_SAME_TIME_ORDER: ReadonlyArray<SecurityCaseStoryItemKind> =
  [
    SecurityCaseStoryItemKind.Change,
    SecurityCaseStoryItemKind.Events,
    SecurityCaseStoryItemKind.Exception,
    SecurityCaseStoryItemKind.Detection,
    SecurityCaseStoryItemKind.CaseOpened,
    SecurityCaseStoryItemKind.Incident,
    SecurityCaseStoryItemKind.Alert,
    SecurityCaseStoryItemKind.PlaybookRun,
    SecurityCaseStoryItemKind.Note,
    SecurityCaseStoryItemKind.Milestone,
  ];

function timeOf(item: SecurityCaseStoryItemJson): number {
  const time: number = new Date(item.time).getTime();

  return Number.isNaN(time) ? 0 : time;
}

// How telling an item is among those of its own kind: the higher, the more.
function weightOf(item: SecurityCaseStoryItemJson): number {
  return getRequestOutcomeRank(item.requestOutcome) * 1000 + (item.count || 1);
}

export function compareStoryItems(
  first: SecurityCaseStoryItemJson,
  second: SecurityCaseStoryItemJson,
): number {
  const byTimeDifference: number = timeOf(first) - timeOf(second);

  if (byTimeDifference !== 0) {
    return byTimeDifference;
  }

  const byKind: number =
    SECURITY_CASE_STORY_SAME_TIME_ORDER.indexOf(first.kind) -
    SECURITY_CASE_STORY_SAME_TIME_ORDER.indexOf(second.kind);

  if (byKind !== 0) {
    return byKind;
  }

  return first.key < second.key ? -1 : first.key > second.key ? 1 : 0;
}

/*
 * The story's items, each once (by key), oldest first, at most `max` of
 * them - and whether any were left out.
 */
export function mergeStoryItems(
  items: ReadonlyArray<SecurityCaseStoryItemJson>,
  max: number,
): { items: Array<SecurityCaseStoryItemJson>; isTruncated: boolean } {
  const unique: Map<string, SecurityCaseStoryItemJson> = new Map();

  for (const item of items) {
    if (!unique.has(item.key)) {
      unique.set(item.key, item);
    }
  }

  let kept: Array<SecurityCaseStoryItemJson> = Array.from(unique.values());
  const isTruncated: boolean = kept.length > Math.max(0, max);

  if (isTruncated) {
    kept = [...kept]
      .sort(
        (
          first: SecurityCaseStoryItemJson,
          second: SecurityCaseStoryItemJson,
        ): number => {
          const byKind: number =
            SECURITY_CASE_STORY_KEEP_ORDER.indexOf(first.kind) -
            SECURITY_CASE_STORY_KEEP_ORDER.indexOf(second.kind);

          if (byKind !== 0) {
            return byKind;
          }

          const byWeight: number = weightOf(second) - weightOf(first);

          return byWeight !== 0 ? byWeight : compareStoryItems(first, second);
        },
      )
      .slice(0, Math.max(0, max));
  }

  return { items: kept.sort(compareStoryItems), isTruncated };
}

// The items a filter shows: all of them, or those of one group.
export function filterStoryItems(
  items: ReadonlyArray<SecurityCaseStoryItemJson>,
  filter: SecurityCaseStoryFilter,
): Array<SecurityCaseStoryItemJson> {
  if (filter === SecurityCaseStoryFilter.All) {
    return [...items];
  }

  return items.filter((item: SecurityCaseStoryItemJson): boolean => {
    return SECURITY_CASE_STORY_FILTER_OF_KIND[item.kind] === filter;
  });
}

// How many items each filter shows, for the counts beside them.
export function countStoryItemsByFilter(
  items: ReadonlyArray<SecurityCaseStoryItemJson>,
): Record<SecurityCaseStoryFilter, number> {
  const counts: Record<SecurityCaseStoryFilter, number> = {
    [SecurityCaseStoryFilter.All]: items.length,
    [SecurityCaseStoryFilter.Attack]: 0,
    [SecurityCaseStoryFilter.Changes]: 0,
    [SecurityCaseStoryFilter.IncidentsAndAlerts]: 0,
    [SecurityCaseStoryFilter.Response]: 0,
  };

  for (const item of items) {
    counts[SECURITY_CASE_STORY_FILTER_OF_KIND[item.kind]] += 1;
  }

  return counts;
}
