import CustomFieldType from "../CustomField/CustomFieldType";
import BadDataException from "../Exception/BadDataException";
import MonitorType from "../Monitor/MonitorType";
import ObjectID from "../ObjectID";
import {
  makeToolImportNote,
  readToolImportNotes,
  ToolImportNote,
} from "./ToolImportNote";
import ToolImportResourceKind, {
  isToolImportResourceKind,
} from "./ToolImportResourceKind";
import ToolImportRunStatus from "./ToolImportRunStatus";
import ToolImportSource from "./ToolImportSource";

/*
 * THE PREVIEW, THE CHOICE AND THE REPORT.
 *
 * The plan is what an import would do with what was read, worked out for
 * the person looking at it - their permissions, the project's plan, what the
 * project already has - one item per thing read. It is computed each time
 * the preview is opened, never stored, so it is never out of date with the
 * project. The person ticks items (the selection) and starts the import; the
 * import works the plan out again, does it, and stores the report.
 */

export enum ToolImportAction {
  // A new OneUptime record.
  Create = "Create",
  // A person who is not in the project yet: they are sent an invitation.
  Invite = "Invite",
  // Something already in OneUptime is used as it is.
  Match = "Match",
  // An earlier import brought it over; it is left as it is.
  AlreadyImported = "AlreadyImported",
  // It is not brought over, for the reason given.
  Skip = "Skip",
}

/*
 * Facts about an item the page words in the reader's language: how many
 * members, layers or levels, which email address.
 */
export interface ToolImportItemSummary {
  email?: string | undefined;
  memberCount?: number | undefined;
  /*
   * OneUptime schedules a schedule of the tool becomes (more than one when
   * people in it are on call at the same time).
   */
  scheduleCount?: number | undefined;
  layerCount?: number | undefined;
  timezone?: string | undefined;
  levelCount?: number | undefined;
  repeatTimes?: number | undefined;
  fieldType?: CustomFieldType | undefined;
  optionCount?: number | undefined;
  // A monitor: what it becomes, what it checks, and how often (seconds).
  monitorType?: MonitorType | undefined;
  destination?: string | undefined;
  intervalSeconds?: number | undefined;
  // A status page: how many monitors it shows, in how many groups.
  resourceCount?: number | undefined;
  groupCount?: number | undefined;
  // A subscriber: the status page whose updates they get.
  statusPageName?: string | undefined;
}

export interface ToolImportPlanItem {
  // getToolImportItemKey(kind, sourceId).
  key: string;
  kind: ToolImportResourceKind;
  sourceId: string;
  name: string;
  action: ToolImportAction;
  // Why it is matched, already imported or skipped.
  reason?: ToolImportNote | undefined;
  // What will not come over exactly as it was.
  notes: Array<ToolImportNote>;
  // The OneUptime record it is matched to, or was imported as.
  existingRecordId?: string | undefined;
  /*
   * Further records an earlier import made of it: the other OneUptime
   * schedules a schedule of the tool became.
   */
  additionalRecordIds?: Array<string> | undefined;
  // Whether a person can tick it: only what would create something.
  isSelectable: boolean;
  isSelectedByDefault: boolean;
  summary: ToolImportItemSummary;
  // Keys of the items it names: a team's members, a policy's schedules.
  references: Array<string>;
}

export interface ToolImportInviteTeam {
  id: string;
  name: string;
}

export interface ToolImportPlan {
  source: ToolImportSource;
  accountName?: string | undefined;
  readAt: string;
  items: Array<ToolImportPlanItem>;
  /*
   * The teams the person may invite new people to (adding someone to a team
   * hands them its permissions, so only teams whose permissions the person
   * could grant), and the one picked to start with: the project's members
   * team, when it is one of them.
   */
  inviteTeams: Array<ToolImportInviteTeam>;
  defaultInviteTeamId: string | null;
  // About the whole import.
  notes: Array<ToolImportNote>;
}

// What the person ticked, sent when they start the import.
export interface ToolImportSelection {
  selectedKeys: Array<string>;
  // The team new people are invited to; null invites nobody.
  inviteTeamId: string | null;
  /*
   * That the person confirmed the status page subscribers they ticked
   * agreed to get updates from them, and that they may move those
   * subscriptions to OneUptime. An import brings no subscriber over
   * without it.
   */
  subscribersConsent?: boolean | undefined;
}

// Whether a ticked key is a status page subscriber's.
export function isToolImportSubscriberKey(key: string): boolean {
  return key.startsWith(`${ToolImportResourceKind.StatusPageSubscriber}:`);
}

export enum ToolImportOutcome {
  Created = "Created",
  Invited = "Invited",
  Matched = "Matched",
  AlreadyImported = "AlreadyImported",
  Skipped = "Skipped",
  Failed = "Failed",
}

export interface ToolImportReportItem {
  key: string;
  kind: ToolImportResourceKind;
  sourceId: string;
  name: string;
  outcome: ToolImportOutcome;
  /*
   * The OneUptime records it became or is matched to (a schedule of the tool
   * can become several).
   */
  recordIds: Array<string>;
  reason?: ToolImportNote | undefined;
  notes: Array<ToolImportNote>;
  // When it failed: what OneUptime answered.
  error?: string | undefined;
}

export interface ToolImportReport {
  items: Array<ToolImportReportItem>;
}

export interface ToolImportProgress {
  done: number;
  total: number;
  // What the worker is on now.
  kind?: ToolImportResourceKind | undefined;
}

export type ToolImportOutcomeCounts = Record<ToolImportOutcome, number>;

// An import as the page lists it.
export interface ToolImportRunView {
  id: string;
  source: ToolImportSource;
  status: ToolImportRunStatus;
  createdAt: string;
  completedAt?: string | undefined;
  accountName?: string | undefined;
  region?: string | undefined;
  createdByUserName?: string | undefined;
  // Whether the person looking at it started it: only they review and start it.
  isMine: boolean;
  progress?: ToolImportProgress | undefined;
  error?: string | undefined;
  counts?: ToolImportOutcomeCounts | undefined;
}

export const MAX_TOOL_IMPORT_SELECTED_KEYS: number = 10000;

const MAX_KEY_LENGTH: number = 600;

/*
 * The selection a start request sends, checked: every key a string of a
 * known kind, no more keys than an import could ever have, and a team id
 * that is an id. Throws a plain message the page can show.
 */
export function readToolImportSelection(value: unknown): ToolImportSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException("Choose what to bring over.");
  }

  const body: Record<string, unknown> = value as Record<string, unknown>;
  const rawKeys: unknown = body["selectedKeys"];

  if (!Array.isArray(rawKeys)) {
    throw new BadDataException("Choose what to bring over.");
  }

  if (rawKeys.length > MAX_TOOL_IMPORT_SELECTED_KEYS) {
    throw new BadDataException("Too many items were chosen.");
  }

  const keys: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const rawKey of rawKeys) {
    if (typeof rawKey !== "string" || rawKey.length > MAX_KEY_LENGTH) {
      throw new BadDataException(
        "An item that was chosen is not one of the import's.",
      );
    }

    const kind: string = rawKey.split(":")[0] || "";

    if (!isToolImportResourceKind(kind) || rawKey.length <= kind.length + 1) {
      throw new BadDataException(
        "An item that was chosen is not one of the import's.",
      );
    }

    if (!seen.has(rawKey)) {
      seen.add(rawKey);
      keys.push(rawKey);
    }
  }

  const rawTeamId: unknown = body["inviteTeamId"];
  let inviteTeamId: string | null = null;

  if (rawTeamId !== undefined && rawTeamId !== null && rawTeamId !== "") {
    if (typeof rawTeamId !== "string" || !ObjectID.isValidUUID(rawTeamId)) {
      throw new BadDataException("Choose a team to invite people to.");
    }

    inviteTeamId = rawTeamId;
  }

  const selection: ToolImportSelection = {
    selectedKeys: keys,
    inviteTeamId: inviteTeamId,
  };

  // Only a plain true is a consent: nothing else a body can carry is one.
  if (body["subscribersConsent"] === true) {
    selection.subscribersConsent = true;
  }

  return selection;
}

/*
 * Status page subscribers come over only with the person's word that they
 * may move them: a selection that ticks any without it is refused, with a
 * message the page can show.
 */
export function assertToolImportSubscribersConsent(
  selection: ToolImportSelection,
): void {
  if (
    selection.subscribersConsent !== true &&
    selection.selectedKeys.some(isToolImportSubscriberKey)
  ) {
    throw new BadDataException(
      "Confirm that you may move the subscribers you ticked, or untick them.",
    );
  }
}

export function getEmptyToolImportOutcomeCounts(): ToolImportOutcomeCounts {
  return {
    [ToolImportOutcome.Created]: 0,
    [ToolImportOutcome.Invited]: 0,
    [ToolImportOutcome.Matched]: 0,
    [ToolImportOutcome.AlreadyImported]: 0,
    [ToolImportOutcome.Skipped]: 0,
    [ToolImportOutcome.Failed]: 0,
  };
}

export function countToolImportOutcomes(
  report: ToolImportReport | null | undefined,
): ToolImportOutcomeCounts {
  const counts: ToolImportOutcomeCounts = getEmptyToolImportOutcomeCounts();

  for (const item of report?.items || []) {
    counts[item.outcome] = (counts[item.outcome] || 0) + 1;
  }

  return counts;
}

function isToolImportOutcome(value: unknown): value is ToolImportOutcome {
  return (
    typeof value === "string" &&
    (Object.values(ToolImportOutcome) as Array<string>).includes(value)
  );
}

/*
 * A stored report, read back defensively: an item that is not one this
 * build understands is dropped rather than shown half-filled.
 */
export function readToolImportReport(value: unknown): ToolImportReport {
  const items: Array<ToolImportReportItem> = [];

  const rawItems: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["items"]
      : undefined;

  if (!Array.isArray(rawItems)) {
    return { items: items };
  }

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const entry: Record<string, unknown> = raw as Record<string, unknown>;

    if (
      typeof entry["key"] !== "string" ||
      !isToolImportResourceKind(entry["kind"]) ||
      typeof entry["sourceId"] !== "string" ||
      typeof entry["name"] !== "string" ||
      !isToolImportOutcome(entry["outcome"])
    ) {
      continue;
    }

    const reasons: Array<ToolImportNote> = readToolImportNotes(
      entry["reason"] ? [entry["reason"]] : [],
    );

    const item: ToolImportReportItem = {
      key: entry["key"],
      kind: entry["kind"],
      sourceId: entry["sourceId"],
      name: entry["name"],
      outcome: entry["outcome"],
      recordIds: Array.isArray(entry["recordIds"])
        ? (entry["recordIds"] as Array<unknown>).filter(
            (id: unknown): id is string => {
              return typeof id === "string" && ObjectID.isValidUUID(id);
            },
          )
        : [],
      notes: readToolImportNotes(entry["notes"]),
    };

    if (reasons[0]) {
      item.reason = makeToolImportNote(reasons[0].code, reasons[0].values);
    }

    if (typeof entry["error"] === "string" && entry["error"]) {
      item.error = entry["error"];
    }

    items.push(item);
  }

  return { items: items };
}
