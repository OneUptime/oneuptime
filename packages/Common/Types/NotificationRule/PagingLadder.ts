import NotificationRuleType from "./NotificationRuleType";
import OnCallRuleKind, {
  ON_CALL_RULE_KINDS,
  getRuleTypeForOnCallRuleKind,
} from "./OnCallRuleKind";
import PushNotificationLevel, {
  DEFAULT_PUSH_NOTIFICATION_LEVEL,
  PUSH_NOTIFICATION_LEVELS,
} from "./PushNotificationLevel";
import {
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "./NotificationRepeat";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  OnCallPageNotificationMethods,
} from "../OnCallDutyPolicy/OnCallPageChannel";

/*
 * HOW TO REACH ME: ONE PAGING LADDER FOR EVERYTHING (#6820).
 *
 * A person's on-call rules are a grid: four kinds of page (incidents,
 * incident episodes, alerts, alert episodes), a card per severity in each,
 * and in each card rules of the form "this method, after this many
 * minutes". What most people want to say is one sentence - "push and SMS
 * at once, then a call after five minutes" - for every card. That sentence
 * is a ladder: a list of steps, each a method and a wait.
 *
 * A ladder is not stored anywhere. It is read from the grid's rows and
 * written back as them: saving one writes one UserNotificationRule per step
 * in every live card, exactly the rows a person would get by adding them to
 * each card by hand. Nothing about how pages are sent changes, and every
 * reader of the rules (UserOnCallLogService, On-Call Readiness, Who is told,
 * Setup health, the setup checklist) keeps reading the same rows.
 *
 *   - getPagingLadderCells: the grid's cards, from the project's severities.
 *   - readPagingLadder: the ladder a person's rules make, and the cards that
 *     differ from it ("Critical incidents: also a call at once").
 *   - planPagingLadderSave: the rows to create, change and delete so every
 *     live card holds the ladder, keeping the rows that already do.
 *   - getPagingLadderRules: the rows a ladder is, for a person with none.
 *
 * Archived severities are left as they are. Nobody picks one again - the
 * server refuses a new rule for one (ArchivedValueCheck) - and the records
 * that keep one still page by its rules, so a ladder neither reads them nor
 * writes them. A severity added later is given the person's rules by the
 * backfill (Workers BackfillNotificationRulesForNewSeverities), which
 * mirrors what the person already has: a ladder, when they have one.
 *
 * The order of a ladder is its waits: steps fire after their wait, and two
 * with the same wait fire together. Steps with the same wait are listed
 * gentlest first (push before SMS before a call), the way people say it.
 *
 * Pure: no models, no database, no React. The Dashboard reads and draws a
 * ladder with it, the server writes one with it (PagingLadderService), and
 * anything else that sets up paging - Ask AI's set_up_paging - can too.
 */

// Where the Dashboard saves a ladder (Server/API/PagingLadderAPI).
export const PAGING_LADDER_API_PATH: string = "/paging-ladder";
export const PAGING_LADDER_APPLY_ROUTE: string = `${PAGING_LADDER_API_PATH}/apply`;

// A rule's notification method column: userEmailId, userSmsId and the rest.
export type PagingMethodColumn = keyof OnCallPageNotificationMethods;

// The rule column that ties a rule to its severity.
export type PagingSeverityColumn = "incidentSeverityId" | "alertSeverityId";

/*
 * Incidents and incident episodes are banded by incident severity, alerts
 * and alert episodes by alert severity.
 */
const SEVERITY_COLUMN_BY_KIND: Readonly<
  Record<OnCallRuleKind, PagingSeverityColumn>
> = {
  [OnCallRuleKind.Incidents]: "incidentSeverityId",
  [OnCallRuleKind.IncidentEpisodes]: "incidentSeverityId",
  [OnCallRuleKind.Alerts]: "alertSeverityId",
  [OnCallRuleKind.AlertEpisodes]: "alertSeverityId",
};

export const getSeverityColumnForOnCallRuleKind: (
  kind: OnCallRuleKind,
) => PagingSeverityColumn = (kind: OnCallRuleKind): PagingSeverityColumn => {
  return SEVERITY_COLUMN_BY_KIND[kind];
};

// The waits the page offers, in minutes; a rule can hold any other.
export const PAGING_LADDER_WAITS_IN_MINUTES: ReadonlyArray<number> = [
  0, 5, 10, 15, 30, 60,
];

// The longest wait a ladder takes: a day.
export const MAX_PAGING_LADDER_WAIT_IN_MINUTES: number = 24 * 60;

/*
 * Steps with the same wait fire together. They are listed gentlest first,
 * so a ladder reads the way people say it: "push, then SMS, then a call".
 */
const GENTLEST_FIRST: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.Push,
  OnCallPageChannel.Email,
  OnCallPageChannel.Slack,
  OnCallPageChannel.MicrosoftTeams,
  OnCallPageChannel.Mattermost,
  OnCallPageChannel.Telegram,
  OnCallPageChannel.WhatsApp,
  OnCallPageChannel.SMS,
  OnCallPageChannel.Call,
  OnCallPageChannel.Webhook,
  OnCallPageChannel.CustomChannel,
];

// Every method column, in the order a rule's columns are read.
export const PAGING_METHOD_COLUMNS: ReadonlyArray<PagingMethodColumn> =
  ON_CALL_PAGE_CHANNELS.map(
    (info: OnCallPageChannelInfo): PagingMethodColumn => {
      return info.field;
    },
  );

export const isPagingMethodColumn: (
  value: unknown,
) => value is PagingMethodColumn = (
  value: unknown,
): value is PagingMethodColumn => {
  return PAGING_METHOD_COLUMNS.includes(value as PagingMethodColumn);
};

// The channel a method column pages by.
export const getChannelForPagingMethodColumn: (
  column: PagingMethodColumn,
) => OnCallPageChannel = (column: PagingMethodColumn): OnCallPageChannel => {
  const info: OnCallPageChannelInfo | undefined = ON_CALL_PAGE_CHANNELS.find(
    (candidate: OnCallPageChannelInfo): boolean => {
      return candidate.field === column;
    },
  );

  return info ? info.channel : OnCallPageChannel.Email;
};

// The method column of a channel.
export const getPagingMethodColumnForChannel: (
  channel: OnCallPageChannel | string,
) => PagingMethodColumn | null = (
  channel: OnCallPageChannel | string,
): PagingMethodColumn | null => {
  const info: OnCallPageChannelInfo | undefined = ON_CALL_PAGE_CHANNELS.find(
    (candidate: OnCallPageChannelInfo): boolean => {
      return candidate.channel === channel;
    },
  );

  return info ? info.field : null;
};

/*
 * One step of a ladder: a method, and how long after being paged to use
 * it. A push step also says how its push sounds and how often it repeats
 * until somebody acknowledges; left out, the rule's own defaults (Critical,
 * no repeat).
 */
export interface PagingLadderStep {
  methodColumn: PagingMethodColumn;
  // The method row's id: a UserSMS, a UserPush, a custom channel.
  methodId: string;
  notifyAfterMinutes: number;
  pushNotificationLevel?: PushNotificationLevel | undefined;
  repeatEveryMinutes?: number | undefined;
}

// A severity as the ladder needs it: a model or a JSON row both fit.
export interface PagingLadderSeverity {
  id?: unknown;
  _id?: unknown;
  name?: string | null | undefined;
  isArchived?: boolean | null | undefined;
}

// One card of the grid: a kind of page and one of its severities.
export interface PagingLadderCell {
  kind: OnCallRuleKind;
  ruleType: NotificationRuleType;
  severityColumn: PagingSeverityColumn;
  severityId: string;
  severityName: string;
  isArchived: boolean;
}

/*
 * A rule as the ladder reads it, read structurally so a model, a model
 * API row or a JSON row all fit. Ids may be strings, ObjectIDs or the
 * `{ _type, value }` an un-hydrated row carries.
 */
export interface PagingLadderRule extends OnCallPageNotificationMethods {
  id?: unknown;
  _id?: unknown;
  ruleType?: unknown;
  incidentSeverityId?: unknown;
  alertSeverityId?: unknown;
  notifyAfterMinutes?: unknown;
  isOptOut?: unknown;
  pushNotificationLevel?: unknown;
  repeatEveryMinutes?: unknown;
}

// An id in any of the shapes a row carries it, as a plain string ("" when none).
export const readPagingId: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    // An un-hydrated ObjectID: { _type: "ObjectID", value: "<uuid>" }.
    if (typeof record["value"] === "string") {
      return (record["value"] as string).trim();
    }

    // A relation object: { _id: "<uuid>" }.
    if (typeof record["_id"] === "string") {
      return (record["_id"] as string).trim();
    }

    const text: string = String(value);

    if (text && text !== "[object Object]") {
      return text.trim();
    }
  }

  return "";
};

const readRuleId: (rule: PagingLadderRule) => string = (
  rule: PagingLadderRule,
): string => {
  return readPagingId(rule.id) || readPagingId(rule._id);
};

const readWait: (value: unknown) => number = (value: unknown): number => {
  const wait: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(wait) || wait < 0) {
    return 0;
  }

  return Math.round(wait);
};

const readPushLevel: (value: unknown) => PushNotificationLevel = (
  value: unknown,
): PushNotificationLevel => {
  if (PUSH_NOTIFICATION_LEVELS.includes(value as PushNotificationLevel)) {
    return value as PushNotificationLevel;
  }

  return DEFAULT_PUSH_NOTIFICATION_LEVEL;
};

const readRepeat: (value: unknown) => number = (value: unknown): number => {
  const repeat: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(repeat) || repeat <= 0) {
    return NO_NOTIFICATION_REPEAT;
  }

  return Math.round(repeat);
};

/*
 * The cards of the grid, in its order: Incidents, Incident Episodes,
 * Alerts, Alert Episodes, and in each the severities in the order given
 * (most severe first, as the project ranks them). Archived ones are
 * included, marked: a ladder leaves them as they are.
 */
export const getPagingLadderCells: (data: {
  incidentSeverities: ReadonlyArray<PagingLadderSeverity>;
  alertSeverities: ReadonlyArray<PagingLadderSeverity>;
}) => Array<PagingLadderCell> = (data: {
  incidentSeverities: ReadonlyArray<PagingLadderSeverity>;
  alertSeverities: ReadonlyArray<PagingLadderSeverity>;
}): Array<PagingLadderCell> => {
  const cells: Array<PagingLadderCell> = [];

  for (const kind of ON_CALL_RULE_KINDS) {
    const severityColumn: PagingSeverityColumn =
      getSeverityColumnForOnCallRuleKind(kind);

    const severities: ReadonlyArray<PagingLadderSeverity> =
      severityColumn === "incidentSeverityId"
        ? data.incidentSeverities
        : data.alertSeverities;

    for (const severity of severities) {
      const severityId: string =
        readPagingId(severity.id) || readPagingId(severity._id);

      if (!severityId) {
        continue;
      }

      cells.push({
        kind: kind,
        ruleType: getRuleTypeForOnCallRuleKind(kind),
        severityColumn: severityColumn,
        severityId: severityId,
        severityName: severity.name || "",
        isArchived: Boolean(severity.isArchived),
      });
    }
  }

  return cells;
};

// The cards a ladder applies to: every card whose severity is not archived.
export const getLivePagingLadderCells: (
  cells: ReadonlyArray<PagingLadderCell>,
) => Array<PagingLadderCell> = (
  cells: ReadonlyArray<PagingLadderCell>,
): Array<PagingLadderCell> => {
  return cells.filter((cell: PagingLadderCell): boolean => {
    return !cell.isArchived;
  });
};

// One card's key: its rule type and severity.
export const getPagingLadderCellKey: (cell: {
  ruleType: NotificationRuleType | string;
  severityId: string;
}) => string = (cell: {
  ruleType: NotificationRuleType | string;
  severityId: string;
}): string => {
  return `${cell.ruleType}|${cell.severityId}`;
};

// The card a rule is on, by its rule type and the severity column of its kind.
const getRuleCellKey: (rule: PagingLadderRule) => string | null = (
  rule: PagingLadderRule,
): string | null => {
  for (const kind of ON_CALL_RULE_KINDS) {
    if (rule.ruleType !== getRuleTypeForOnCallRuleKind(kind)) {
      continue;
    }

    const severityId: string = readPagingId(
      rule[getSeverityColumnForOnCallRuleKind(kind)],
    );

    if (!severityId) {
      return null;
    }

    return getPagingLadderCellKey({
      ruleType: rule.ruleType as NotificationRuleType,
      severityId: severityId,
    });
  }

  return null;
};

/*
 * A step with its push settings made explicit for a push method (the
 * rule's defaults when left out) and left off any other, and its wait a
 * whole number of minutes, so two steps that page the same way compare
 * equal.
 */
export const normalizePagingLadderStep: (
  step: PagingLadderStep,
) => PagingLadderStep = (step: PagingLadderStep): PagingLadderStep => {
  const normalized: PagingLadderStep = {
    methodColumn: step.methodColumn,
    methodId: readPagingId(step.methodId),
    notifyAfterMinutes: readWait(step.notifyAfterMinutes),
  };

  if (step.methodColumn === "userPushId") {
    normalized.pushNotificationLevel = readPushLevel(
      step.pushNotificationLevel,
    );
    normalized.repeatEveryMinutes = readRepeat(step.repeatEveryMinutes);
  }

  return normalized;
};

// Which method a step pages, whatever its wait.
export const getPagingLadderMethodKey: (step: {
  methodColumn: PagingMethodColumn;
  methodId: string;
}) => string = (step: {
  methodColumn: PagingMethodColumn;
  methodId: string;
}): string => {
  return `${step.methodColumn}:${readPagingId(step.methodId)}`;
};

// A method and its wait: two steps with the same key page the same way, at the same time.
const getMethodAndWaitKey: (step: PagingLadderStep) => string = (
  step: PagingLadderStep,
): string => {
  return `${getPagingLadderMethodKey(step)}@${readWait(step.notifyAfterMinutes)}`;
};

// Everything about a step, push settings included.
export const getPagingLadderStepKey: (step: PagingLadderStep) => string = (
  step: PagingLadderStep,
): string => {
  const normalized: PagingLadderStep = normalizePagingLadderStep(step);

  return [
    getMethodAndWaitKey(normalized),
    normalized.pushNotificationLevel || "",
    normalized.repeatEveryMinutes === undefined
      ? ""
      : String(normalized.repeatEveryMinutes),
  ].join("|");
};

const getGentlenessRank: (column: PagingMethodColumn) => number = (
  column: PagingMethodColumn,
): number => {
  const rank: number = GENTLEST_FIRST.indexOf(
    getChannelForPagingMethodColumn(column),
  );

  return rank === -1 ? GENTLEST_FIRST.length : rank;
};

// Steps in the order they page: by wait, then gentlest first, then by method.
export const comparePagingLadderSteps: (
  a: PagingLadderStep,
  b: PagingLadderStep,
) => number = (a: PagingLadderStep, b: PagingLadderStep): number => {
  const byWait: number =
    readWait(a.notifyAfterMinutes) - readWait(b.notifyAfterMinutes);

  if (byWait !== 0) {
    return byWait;
  }

  const byChannel: number =
    getGentlenessRank(a.methodColumn) - getGentlenessRank(b.methodColumn);

  if (byChannel !== 0) {
    return byChannel;
  }

  return readPagingId(a.methodId).localeCompare(readPagingId(b.methodId));
};

/*
 * A ladder as it is kept and compared: every step normalized, a step that
 * pages the same way at the same time as another said once (the first
 * one's push settings win), steps with no method left out, in paging order.
 */
export const normalizePagingLadderSteps: (
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<PagingLadderStep> = (
  steps: ReadonlyArray<PagingLadderStep>,
): Array<PagingLadderStep> => {
  const seen: Set<string> = new Set<string>();
  const normalized: Array<PagingLadderStep> = [];

  for (const step of steps) {
    if (!isPagingMethodColumn(step.methodColumn)) {
      continue;
    }

    const candidate: PagingLadderStep = normalizePagingLadderStep(step);

    if (!candidate.methodId) {
      continue;
    }

    const key: string = getMethodAndWaitKey(candidate);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(candidate);
  }

  return normalized.sort(comparePagingLadderSteps);
};

/*
 * The step a rule is, or null for a rule that pages nothing: an opt-out
 * row ("do not page me here"), or a row that names no method. A row that
 * names two methods (possible through the API) is read by its first.
 */
export const getPagingLadderStepFromRule: (
  rule: PagingLadderRule,
) => PagingLadderStep | null = (
  rule: PagingLadderRule,
): PagingLadderStep | null => {
  if (rule.isOptOut === true) {
    return null;
  }

  for (const column of PAGING_METHOD_COLUMNS) {
    const methodId: string = readPagingId(rule[column]);

    if (!methodId) {
      continue;
    }

    return normalizePagingLadderStep({
      methodColumn: column,
      methodId: methodId,
      notifyAfterMinutes: readWait(rule.notifyAfterMinutes),
      pushNotificationLevel: readPushLevel(rule.pushNotificationLevel),
      repeatEveryMinutes: readRepeat(rule.repeatEveryMinutes),
    });
  }

  return null;
};

// One card, as its rules make it.
export interface PagingLadderCellReading {
  cell: PagingLadderCell;
  // What the card pages, in paging order.
  steps: Array<PagingLadderStep>;
  // An opt-out row and nothing else: "do not page me for this".
  isMuted: boolean;
  ruleCount: number;
}

// A step that pages the same method at the same time, with other push settings.
export interface PagingLadderChangedStep {
  step: PagingLadderStep;
  ladderStep: PagingLadderStep;
}

// A card that differs from the ladder, and how.
export interface PagingLadderDifference {
  cell: PagingLadderCell;
  // What the card pages that the ladder does not: "also a call at once".
  extra: Array<PagingLadderStep>;
  // What the ladder pages that the card does not: "no SMS".
  missing: Array<PagingLadderStep>;
  // The same method at the same time, sounding or repeating differently.
  changed: Array<PagingLadderChangedStep>;
  isMuted: boolean;
}

export interface PagingLadderReading {
  // The ladder: what most live cards page (all of them, when isOneLadder).
  steps: Array<PagingLadderStep>;
  isOneLadder: boolean;
  // The live cards that differ from the ladder, in the grid's order.
  differences: Array<PagingLadderDifference>;
  // Every live card, as its rules make it.
  cells: Array<PagingLadderCellReading>;
}

const getStepsSignature: (steps: ReadonlyArray<PagingLadderStep>) => string = (
  steps: ReadonlyArray<PagingLadderStep>,
): string => {
  return steps.map(getPagingLadderStepKey).join(",");
};

const isSamePushSettings: (
  a: PagingLadderStep,
  b: PagingLadderStep,
) => boolean = (a: PagingLadderStep, b: PagingLadderStep): boolean => {
  return getPagingLadderStepKey(a) === getPagingLadderStepKey(b);
};

// How one card's steps differ from the ladder's.
export const comparePagingLadderCell: (data: {
  cell: PagingLadderCell;
  steps: ReadonlyArray<PagingLadderStep>;
  isMuted: boolean;
  ladder: ReadonlyArray<PagingLadderStep>;
}) => PagingLadderDifference | null = (data: {
  cell: PagingLadderCell;
  steps: ReadonlyArray<PagingLadderStep>;
  isMuted: boolean;
  ladder: ReadonlyArray<PagingLadderStep>;
}): PagingLadderDifference | null => {
  const ladderByMethodAndWait: Map<string, PagingLadderStep> = new Map<
    string,
    PagingLadderStep
  >();

  for (const ladderStep of data.ladder) {
    ladderByMethodAndWait.set(getMethodAndWaitKey(ladderStep), ladderStep);
  }

  const extra: Array<PagingLadderStep> = [];
  const changed: Array<PagingLadderChangedStep> = [];
  const matched: Set<string> = new Set<string>();

  for (const step of data.steps) {
    const key: string = getMethodAndWaitKey(step);
    const ladderStep: PagingLadderStep | undefined =
      ladderByMethodAndWait.get(key);

    if (!ladderStep) {
      extra.push(step);
      continue;
    }

    matched.add(key);

    if (!isSamePushSettings(step, ladderStep)) {
      changed.push({ step: step, ladderStep: ladderStep });
    }
  }

  const missing: Array<PagingLadderStep> = data.ladder.filter(
    (ladderStep: PagingLadderStep): boolean => {
      return !matched.has(getMethodAndWaitKey(ladderStep));
    },
  );

  if (
    extra.length === 0 &&
    missing.length === 0 &&
    changed.length === 0 &&
    !data.isMuted
  ) {
    return null;
  }

  return {
    cell: data.cell,
    extra: extra,
    missing: missing,
    changed: changed,
    isMuted: data.isMuted,
  };
};

// Each live card's steps, from the person's rules.
export const readPagingLadderCells: (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
}) => Array<PagingLadderCellReading> = (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
}): Array<PagingLadderCellReading> => {
  const rulesByCell: Map<string, Array<PagingLadderRule>> = new Map<
    string,
    Array<PagingLadderRule>
  >();

  for (const rule of data.rules) {
    const cellKey: string | null = getRuleCellKey(rule);

    if (!cellKey) {
      continue;
    }

    const list: Array<PagingLadderRule> = rulesByCell.get(cellKey) || [];
    list.push(rule);
    rulesByCell.set(cellKey, list);
  }

  return getLivePagingLadderCells(data.cells).map(
    (cell: PagingLadderCell): PagingLadderCellReading => {
      const rules: Array<PagingLadderRule> =
        rulesByCell.get(getPagingLadderCellKey(cell)) || [];

      const steps: Array<PagingLadderStep> = normalizePagingLadderSteps(
        rules
          .map(getPagingLadderStepFromRule)
          .filter((step: PagingLadderStep | null): step is PagingLadderStep => {
            return step !== null;
          }),
      );

      const hasOptOut: boolean = rules.some(
        (rule: PagingLadderRule): boolean => {
          return rule.isOptOut === true;
        },
      );

      return {
        cell: cell,
        steps: steps,
        isMuted: hasOptOut && steps.length === 0,
        ruleCount: rules.length,
      };
    },
  );
};

/*
 * The ladder a person's rules make: what most live cards page - every
 * one of them for most people, since a verified method starts with a rule
 * in every card - and the cards that differ from it. A tie goes to the
 * card first in the grid's order (the most severe incident). With no card
 * paging anything, the ladder is empty.
 */
export const readPagingLadder: (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
}) => PagingLadderReading = (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
}): PagingLadderReading => {
  const cellReadings: Array<PagingLadderCellReading> =
    readPagingLadderCells(data);

  const counts: Map<string, { count: number; steps: Array<PagingLadderStep> }> =
    new Map<string, { count: number; steps: Array<PagingLadderStep> }>();

  for (const reading of cellReadings) {
    if (reading.steps.length === 0) {
      continue;
    }

    const signature: string = getStepsSignature(reading.steps);
    const known: { count: number; steps: Array<PagingLadderStep> } | undefined =
      counts.get(signature);

    if (known) {
      known.count++;
      continue;
    }

    counts.set(signature, { count: 1, steps: reading.steps });
  }

  let ladder: Array<PagingLadderStep> = [];
  let bestCount: number = 0;

  // Map keeps insertion order, so the first card wins a tie.
  for (const candidate of counts.values()) {
    if (candidate.count > bestCount) {
      bestCount = candidate.count;
      ladder = candidate.steps;
    }
  }

  const differences: Array<PagingLadderDifference> = [];

  for (const reading of cellReadings) {
    const difference: PagingLadderDifference | null = comparePagingLadderCell({
      cell: reading.cell,
      steps: reading.steps,
      isMuted: reading.isMuted,
      ladder: ladder,
    });

    if (difference) {
      differences.push(difference);
    }
  }

  return {
    steps: ladder.map((step: PagingLadderStep): PagingLadderStep => {
      return { ...step };
    }),
    isOneLadder: differences.length === 0,
    differences: differences,
    cells: cellReadings,
  };
};

// A rule a ladder saves, as its columns: what a person would add to a card by hand.
export interface PagingLadderRuleToCreate {
  ruleType: NotificationRuleType;
  severityColumn: PagingSeverityColumn;
  severityId: string;
  methodColumn: PagingMethodColumn;
  methodId: string;
  notifyAfterMinutes: number;
  // A push rule's level. Left out on any other, which keeps the column's default.
  pushNotificationLevel?: PushNotificationLevel | undefined;
  // Repeats only on a push rule; every other rule sends once.
  repeatEveryMinutes: number;
}

// What changes on a rule that already pages the right method.
export interface PagingLadderRuleUpdate {
  id: string;
  notifyAfterMinutes?: number | undefined;
  pushNotificationLevel?: PushNotificationLevel | undefined;
  repeatEveryMinutes?: number | undefined;
}

export interface PagingLadderPlan {
  create: Array<PagingLadderRuleToCreate>;
  update: Array<PagingLadderRuleUpdate>;
  // Rule ids.
  delete: Array<string>;
  // Rows that already hold a step, kept as they are.
  unchangedCount: number;
}

const toRuleToCreate: (data: {
  cell: PagingLadderCell;
  step: PagingLadderStep;
}) => PagingLadderRuleToCreate = (data: {
  cell: PagingLadderCell;
  step: PagingLadderStep;
}): PagingLadderRuleToCreate => {
  const step: PagingLadderStep = normalizePagingLadderStep(data.step);

  const rule: PagingLadderRuleToCreate = {
    ruleType: data.cell.ruleType,
    severityColumn: data.cell.severityColumn,
    severityId: data.cell.severityId,
    methodColumn: step.methodColumn,
    methodId: step.methodId,
    notifyAfterMinutes: step.notifyAfterMinutes,
    repeatEveryMinutes: step.repeatEveryMinutes ?? NO_NOTIFICATION_REPEAT,
  };

  if (step.methodColumn === "userPushId") {
    rule.pushNotificationLevel =
      step.pushNotificationLevel || DEFAULT_PUSH_NOTIFICATION_LEVEL;
  }

  return rule;
};

/*
 * What to write so every live card holds the ladder, and nothing else.
 * Archived cards, rules of no card (the on-call and off-call shift rules)
 * and rules on a severity the project no longer has are left as they are.
 *
 * In each live card:
 *   1. a row that already pages a step exactly is kept;
 *   2. a row that pages a step's method at another wait, or sounding or
 *      repeating otherwise, is changed to the step - the same row, so its
 *      method is never rewritten (only an admin may re-point a method);
 *   3. what is left over is deleted: other methods, an opt-out row, a row
 *      that names no method, a second copy of a step;
 *   4. what is still missing is created.
 */
export const planPagingLadderSave: (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
  steps: ReadonlyArray<PagingLadderStep>;
}) => PagingLadderPlan = (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  rules: ReadonlyArray<PagingLadderRule>;
  steps: ReadonlyArray<PagingLadderStep>;
}): PagingLadderPlan => {
  const ladder: Array<PagingLadderStep> = normalizePagingLadderSteps(
    data.steps,
  );

  const plan: PagingLadderPlan = {
    create: [],
    update: [],
    delete: [],
    unchangedCount: 0,
  };

  const rulesByCell: Map<string, Array<PagingLadderRule>> = new Map<
    string,
    Array<PagingLadderRule>
  >();

  for (const rule of data.rules) {
    const cellKey: string | null = getRuleCellKey(rule);

    if (!cellKey || !readRuleId(rule)) {
      continue;
    }

    const list: Array<PagingLadderRule> = rulesByCell.get(cellKey) || [];
    list.push(rule);
    rulesByCell.set(cellKey, list);
  }

  for (const cell of getLivePagingLadderCells(data.cells)) {
    const remainingRules: Array<PagingLadderRule> = [
      ...(rulesByCell.get(getPagingLadderCellKey(cell)) || []),
    ];
    const remainingSteps: Array<PagingLadderStep> = [...ladder];

    // 1. Exact matches stay.
    for (let i: number = remainingSteps.length - 1; i >= 0; i--) {
      const stepKey: string = getPagingLadderStepKey(remainingSteps[i]!);

      const ruleIndex: number = remainingRules.findIndex(
        (rule: PagingLadderRule): boolean => {
          const ruleStep: PagingLadderStep | null =
            getPagingLadderStepFromRule(rule);

          return Boolean(
            ruleStep && getPagingLadderStepKey(ruleStep) === stepKey,
          );
        },
      );

      if (ruleIndex === -1) {
        continue;
      }

      remainingRules.splice(ruleIndex, 1);
      remainingSteps.splice(i, 1);
      plan.unchangedCount++;
    }

    // 2. The same method at another wait, or with other push settings, is changed.
    for (let i: number = 0; i < remainingSteps.length; ) {
      const step: PagingLadderStep = remainingSteps[i]!;
      const methodKey: string = getPagingLadderMethodKey(step);

      const ruleIndex: number = remainingRules.findIndex(
        (rule: PagingLadderRule): boolean => {
          const ruleStep: PagingLadderStep | null =
            getPagingLadderStepFromRule(rule);

          return Boolean(
            ruleStep && getPagingLadderMethodKey(ruleStep) === methodKey,
          );
        },
      );

      if (ruleIndex === -1) {
        i++;
        continue;
      }

      const rule: PagingLadderRule = remainingRules[ruleIndex]!;
      const ruleStep: PagingLadderStep = getPagingLadderStepFromRule(rule)!;

      const update: PagingLadderRuleUpdate = { id: readRuleId(rule) };

      if (ruleStep.notifyAfterMinutes !== step.notifyAfterMinutes) {
        update.notifyAfterMinutes = step.notifyAfterMinutes;
      }

      if (step.methodColumn === "userPushId") {
        if (ruleStep.pushNotificationLevel !== step.pushNotificationLevel) {
          update.pushNotificationLevel = step.pushNotificationLevel;
        }

        if (ruleStep.repeatEveryMinutes !== step.repeatEveryMinutes) {
          update.repeatEveryMinutes = step.repeatEveryMinutes;
        }
      }

      plan.update.push(update);
      remainingRules.splice(ruleIndex, 1);
      remainingSteps.splice(i, 1);
    }

    // 3. What is left over goes.
    for (const rule of remainingRules) {
      plan.delete.push(readRuleId(rule));
    }

    // 4. What is still missing is added.
    for (const step of remainingSteps) {
      plan.create.push(toRuleToCreate({ cell: cell, step: step }));
    }
  }

  return plan;
};

/*
 * The rows a ladder is, in every live card, for a person with no rules:
 * one rule per step per card, in the grid's order.
 */
export const getPagingLadderRules: (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  steps: ReadonlyArray<PagingLadderStep>;
}) => Array<PagingLadderRuleToCreate> = (data: {
  cells: ReadonlyArray<PagingLadderCell>;
  steps: ReadonlyArray<PagingLadderStep>;
}): Array<PagingLadderRuleToCreate> => {
  return planPagingLadderSave({
    cells: data.cells,
    rules: [],
    steps: data.steps,
  }).create;
};

// Whether a plan writes nothing.
export const isEmptyPagingLadderPlan: (plan: PagingLadderPlan) => boolean = (
  plan: PagingLadderPlan,
): boolean => {
  return (
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.delete.length === 0
  );
};

/*
 * Why a ladder sent to the server cannot be saved, as a sentence that says
 * what to do; null when it can. Checked on the server before anything is
 * written, and by the page before it sends.
 */
export const getPagingLadderStepsProblem: (
  steps: ReadonlyArray<unknown>,
) => string | null = (steps: ReadonlyArray<unknown>): string | null => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "A ladder needs at least one step. Add a way to reach you, then save.";
  }

  for (const value of steps) {
    if (!value || typeof value !== "object") {
      return "Each step of a ladder needs a notification method and a wait. Choose both, then save.";
    }

    const step: Record<string, unknown> = value as Record<string, unknown>;

    if (!isPagingMethodColumn(step["methodColumn"])) {
      return "A step names a kind of notification method OneUptime does not know. Choose one of your notification methods, then save.";
    }

    if (!readPagingId(step["methodId"])) {
      return "A step has no notification method. Choose one of your notification methods, then save.";
    }

    const wait: unknown = step["notifyAfterMinutes"];

    if (
      typeof wait !== "number" ||
      !Number.isInteger(wait) ||
      wait < 0 ||
      wait > MAX_PAGING_LADDER_WAIT_IN_MINUTES
    ) {
      return "A step's wait must be a whole number of minutes from 0 to 1440 (a day). Choose another wait, then save.";
    }

    const level: unknown = step["pushNotificationLevel"];

    if (
      level !== undefined &&
      level !== null &&
      !PUSH_NOTIFICATION_LEVELS.includes(level as PushNotificationLevel)
    ) {
      return "A push step must sound as a Critical alert or a Standard notification. Choose one, then save.";
    }

    const repeat: unknown = step["repeatEveryMinutes"];

    if (
      repeat !== undefined &&
      repeat !== null &&
      repeat !== NO_NOTIFICATION_REPEAT &&
      !REPEAT_EVERY_MINUTES_OPTIONS.includes(repeat as number)
    ) {
      return "A push step repeats every 1, 2, 3, 5, 10, 15 or 30 minutes, or not at all. Choose one, then save.";
    }

    if (
      step["methodColumn"] !== "userPushId" &&
      typeof repeat === "number" &&
      repeat !== NO_NOTIFICATION_REPEAT
    ) {
      return "Only a push step can repeat until acknowledged. Turn repeating off for the other steps, then save.";
    }
  }

  return null;
};

// A ladder sent as JSON, as steps: call getPagingLadderStepsProblem first.
export const readPagingLadderSteps: (
  steps: ReadonlyArray<unknown>,
) => Array<PagingLadderStep> = (
  steps: ReadonlyArray<unknown>,
): Array<PagingLadderStep> => {
  return normalizePagingLadderSteps(
    steps.map((value: unknown): PagingLadderStep => {
      const step: Record<string, unknown> = (value || {}) as Record<
        string,
        unknown
      >;

      return {
        methodColumn: step["methodColumn"] as PagingMethodColumn,
        methodId: readPagingId(step["methodId"]),
        notifyAfterMinutes: step["notifyAfterMinutes"] as number,
        pushNotificationLevel: step["pushNotificationLevel"] as
          | PushNotificationLevel
          | undefined,
        repeatEveryMinutes: step["repeatEveryMinutes"] as number | undefined,
      };
    }),
  );
};
