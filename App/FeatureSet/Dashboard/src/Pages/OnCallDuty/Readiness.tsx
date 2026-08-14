import {
  ReadinessCoverageCellWire,
  ReadinessMethodWire,
  ReadinessStatusValue,
  ReadinessSummaryWire,
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_PARTIALLY_READY,
  READINESS_STATUS_READY,
  ResponderSourceValue,
  UserReadinessWire,
  getCoverageGaps,
  getRuleTypeLabel,
  getStatusShortLabel,
  countByStatus,
  parseReadinessPage,
  ReadinessPageWire,
} from "../../Components/OnCallPolicy/Readiness/ReadinessTypes";
import StatTile from "../../Components/OnCallPolicy/Readiness/StatTile";
import UserElement from "../../Components/User/User";
import PageComponentProps from "../PageComponentProps";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * On-Call > Readiness.
 *
 * The question this page exists to answer is "if an incident fired right now,
 * who on this project would actually get paged?". The compliance report it
 * supersedes answered a much weaker question: it was team-scoped, opt-in, off
 * by default, counted four of the seven channels, and delivered its verdict as
 * prose ("Missing notification rules for incident severities: Sev1, Sev2").
 * Prose is the wrong shape for this. A reader has to rebuild a grid in their
 * head before they can find the hole, and every responder makes them do it
 * again. So the centrepiece here is the grid itself - severities down, rule
 * types across - where a gap is a literal hole you can see without reading. One
 * grid per severity KIND, because incident severities and alert severities are
 * disjoint sets and a single shared axis fills half the picture with cells that
 * can never exist (see buildCoverageModel).
 *
 * Wire types, parsing and the status vocabulary all come from
 * Components/OnCallPolicy/Readiness/ReadinessTypes so this page, the policy
 * overview card and the escalation-rule dots cannot disagree about what a
 * payload means. Only the project-wide fetch and the presentation are local.
 */

/*
 * The project-wide readiness endpoint. The project comes from the tenant header
 * ModelAPI.getCommonHeaders() already attaches, so the route carries no id.
 * (useOnCallReadiness covers the per-policy route; it takes a policy id and has
 * nothing to fetch without one, which is why this page does not use it.)
 */
const READINESS_PROJECT_API_PATH: string = "/on-call-readiness/project";

/*
 * One request per 500 responders (the endpoint's maximum page), and at most
 * MAX_READINESS_PAGES of them. 100 pages is 50,000 responders - far past any
 * real project, so the ceiling only ever trips on something pathological, and
 * when it does the page says so rather than quietly showing a prefix.
 */
const READINESS_PAGE_SIZE: number = 500;
const MAX_READINESS_PAGES: number = 100;

/*
 * Setup reminders.
 *
 * The one control on this page that leaves the product and lands in somebody's
 * inbox, and the reason it exists at all is that the gaps this page reports are
 * not gaps the reader can close: a notification method lives on the responder's
 * own account and only they can verify it. Asking them IS the fix.
 *
 * This control has a history worth keeping in view. Its first cut was an enabled
 * button wired to a function that unconditionally threw - an admin ticked
 * responders, confirmed a modal that named them, and got an error. Its second
 * was honestly disabled, saying why, because a silent no-op would have been
 * worse still: they would have left believing a reminder had reached somebody
 * who still cannot be paged. Now that the endpoint is real, the same standard
 * applies to its ANSWER. The server returns one outcome per user - sent,
 * skipped, or failed - and this page renders those outcomes rather than a tick,
 * because "5 sent, 2 already reminded today, 1 failed" is the only summary that
 * does not quietly overstate what happened.
 */
const SETUP_REMINDER_API_PATH: string =
  "/on-call-readiness/send-setup-reminder";

/*
 * WHAT A FAILED REQUEST IS ALLOWED TO CLAIM.
 *
 * This banner used to say "No reminders were sent." on every failure, and that
 * sentence is not knowable from a failure. The endpoint performs up to
 * SETUP_REMINDER_MAX_RECIPIENTS (250) SEQUENTIAL sends inside one HTTP request:
 * a gateway that gives up at 60s, or a pod that is rolled mid-fan-out, produces
 * a client-side failure on a request during which mail HAS already left. Telling
 * an admin nothing was sent, and watching them press the button again, is how
 * 250 people get reminded twice - and it is the same class of mistake this
 * control was disabled for two phases to avoid.
 *
 * So the failure is split in two, on ONE question: did the API application
 * itself answer?
 *
 * Every path that refuses this route - the body validation on the route, the
 * permission gate, and the service's own pre-flight checks (empty list, over the
 * ceiling, project not found) - runs BEFORE the fan-out begins.
 * OnCallSetupReminderService.remindOneUser never throws; each recipient's
 * failure is an outcome inside a 200. So a status code that this application
 * produces is proof the fan-out never started, and only those codes earn the
 * definite sentence.
 *
 * The list is deliberately short and deliberately does not include:
 *
 *   - 500, 502, 503, 504: any of these can come from a proxy, a load balancer or
 *     a restart, at any point - including after 200 of the 250 sends.
 *   - 408 and a transport failure (statusCode -1, e.g. the browser dropping the
 *     connection): the request may well have completed at the server.
 *   - 429: an edge rate limiter and the application are indistinguishable from
 *     here, and being wrong in this direction is the expensive one.
 */
const DEFINITELY_NOT_SENT_STATUS_CODES: Array<number> = [
  400, // BadDataException - the body, or the service's pre-flight checks.
  401, // NotAuthenticatedException - no session.
  403, // ForbiddenException.
  422, // NotAuthorizedException - not a member, or not allowed to send.
];

interface SetupReminderFailure {
  /** The friendly message, rendered verbatim. */
  message: string;
  /**
   * TRUE only when the server answered in a way that proves the fan-out never
   * started. FALSE means the outcome is genuinely unknown, and the banner must
   * not claim otherwise in either direction.
   */
  isNothingSentCertain: boolean;
}

/*
 * Reads a caught failure into "we know nothing went" or "we do not know".
 *
 * API.post RESOLVES with an HTTPErrorResponse for a non-2xx rather than
 * throwing, and the caller re-throws it, so both shapes arrive here. Anything
 * that is not an HTTPErrorResponse at all - a thrown TypeError, a dropped
 * connection - carries no status code and is therefore unknown by definition.
 */
const readSetupReminderFailure: (err: unknown) => SetupReminderFailure = (
  err: unknown,
): SetupReminderFailure => {
  const message: string = API.getFriendlyMessage(err);

  /*
   * HTTPErrorResponse extends HTTPResponse, and the caller re-throws a plain
   * HTTPResponse whose isFailure() is true as well, so the base class is what is
   * tested for. A response object of either shape carries the status code; a
   * thrown Error does not.
   */
  if (err instanceof HTTPResponse) {
    return {
      message: message,
      isNothingSentCertain: DEFINITELY_NOT_SENT_STATUS_CODES.includes(
        err.statusCode,
      ),
    };
  }

  return {
    message: message,
    isNothingSentCertain: false,
  };
};

/*
 * The five outcomes the endpoint reports, mirroring SetupReminderOutcome on the
 * server. Kept as a union of literals rather than an enum for the same reason
 * ReadinessTypes keeps its status vocabulary that way: this is a wire value and
 * a value the server sends that this build has never heard of has to survive
 * being displayed, not crash a render.
 */
type SetupReminderOutcomeValue =
  | "Sent"
  | "SkippedThrottled"
  | "SkippedNotAMember"
  | "SkippedNothingMissing"
  | "Failed";

interface SetupReminderUserOutcome {
  userId: string;
  outcome: SetupReminderOutcomeValue;
  /** The server's own sentence about this user. Rendered verbatim as text. */
  message: string;
}

/*
 * The counts here are DERIVED from `results` rather than read from the payload's
 * own sentCount / skippedCount / failedCount, even though the server sends both
 * and they agree.
 *
 * The reason is that this banner shows a headline and a detail list at the same
 * time, and those two must never be able to disagree on screen - a headline
 * reading "3 sent" above a list naming four failures is worse than either half
 * on its own, because the reader cannot tell which to believe. Deriving both
 * from one array makes the contradiction unrepresentable.
 */
interface SetupReminderReport {
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  results: Array<SetupReminderUserOutcome>;
}

/*
 * Parse defensively, and count what actually arrived.
 *
 * An entry without a user id is dropped rather than rendered against nobody,
 * and an entry with an outcome this build does not recognise is kept and counted
 * as SKIPPED rather than as sent. That asymmetry is deliberate: a future outcome
 * value miscounted as "sent" would be this page telling somebody a reminder went
 * out when it may not have, which is the one mistake this control is not allowed
 * to make twice. Miscounting it as skipped merely understates the good news, and
 * the server's own sentence is shown next to it either way.
 */
const parseSetupReminderReport: (data: JSONObject) => SetupReminderReport = (
  data: JSONObject,
): SetupReminderReport => {
  const rawResults: Array<JSONObject> = Array.isArray(data["results"])
    ? (data["results"] as Array<JSONObject>)
    : [];

  const results: Array<SetupReminderUserOutcome> = [];

  for (const raw of rawResults) {
    const userId: string = (raw["userId"] as string) || "";

    if (!userId) {
      continue;
    }

    results.push({
      userId: userId,
      outcome: (raw["outcome"] as SetupReminderOutcomeValue) || "Failed",
      message: (raw["message"] as string) || "",
    });
  }

  let sentCount: number = 0;
  let failedCount: number = 0;
  let skippedCount: number = 0;

  for (const result of results) {
    if (result.outcome === "Sent") {
      sentCount++;
    } else if (result.outcome === "Failed") {
      failedCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    sentCount: sentCount,
    skippedCount: skippedCount,
    failedCount: failedCount,
    results: results,
  };
};

/*
 * The headline. Only non-zero terms appear, so a clean run reads "3 sent." and
 * not "3 sent, 0 skipped, 0 failed" - a sentence with zeroes in it invites the
 * reader to skim past the number that is not zero.
 */
const describeSetupReminderReport: (report: SetupReminderReport) => string = (
  report: SetupReminderReport,
): string => {
  const parts: Array<string> = [];

  if (report.sentCount > 0) {
    parts.push(`${report.sentCount} sent`);
  }

  if (report.skippedCount > 0) {
    parts.push(`${report.skippedCount} skipped`);
  }

  if (report.failedCount > 0) {
    parts.push(`${report.failedCount} failed`);
  }

  if (parts.length === 0) {
    /*
     * A 200 with nothing in it. Unreachable today, but stating it plainly beats
     * an empty banner that reads as success.
     */
    return "No reminders were sent.";
  }

  return `${parts.join(", ")}.`;
};

/*
 * All seven channels, in a fixed order, so the meter is positional: the third
 * segment is always Call whether or not this responder has one. The compliance
 * report counted only the first four, which reported a Telegram-only responder
 * as non-compliant when they were perfectly reachable.
 */
const CHANNEL_ORDER: Array<string> = [
  "Email",
  "SMS",
  "Call",
  "Push",
  "WhatsApp",
  "Telegram",
  "Webhook",
];

const CHANNEL_ICONS: Dictionary<IconProp> = {
  Email: IconProp.Email,
  SMS: IconProp.SMS,
  Call: IconProp.Call,
  Push: IconProp.Bell,
  WhatsApp: IconProp.WhatsApp,
  Telegram: IconProp.Telegram,
  Webhook: IconProp.Webhook,
};

/*
 * Severity KIND is a real dimension of this data, and the first cut of this
 * model had no notion of it. Rows were keyed on severity id alone while the
 * columns were all four severity-scoped rule types, so incident severities and
 * alert severities shared one row axis. Those are disjoint sets of ids - an
 * incident severity is never an alert severity - so half of that grid was cells
 * that can never exist, and a reader had no way to tell an impossible cell from
 * a genuine hole. On a project with 8 incident and 8 alert severities that is 32
 * real cells drawn among 64, which is worse than useless on a surface whose
 * entire job is making a hole visible.
 *
 * So the grid splits by kind: incident severities against the two incident rule
 * types, alert severities against the two alert ones. The impossible half is
 * removed rather than styled away, and each matrix stays narrow enough to read.
 */
type SeverityKindValue = "Incident" | "Alert" | "Other";

interface CoverageSectionDefinition {
  kind: SeverityKindValue;
  title: string;
  ruleTypes: Array<NotificationRuleType>;
}

/*
 * Fixing the column order here rather than deriving it from the payload matters:
 * a matrix whose columns reshuffle between responders cannot be compared down
 * the page, which is most of what this view is for. The two lifecycle rule types
 * carry no severity at all and get their own short list under the grids.
 */
const COVERAGE_SECTION_DEFINITIONS: Array<CoverageSectionDefinition> = [
  {
    kind: "Incident",
    title: "Incident severities",
    ruleTypes: [
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ],
  },
  {
    kind: "Alert",
    title: "Alert severities",
    ruleTypes: [
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ],
  },
];

/*
 * Where a severity-scoped rule type this build has never heard of goes. It
 * cannot be filed under either kind without guessing, and a guess would put a
 * severity under a column it may have nothing to do with - reintroducing the
 * impossible cell this split exists to remove. It gets a section of its own,
 * whose columns are exactly the rule types the payload used. An unknown column
 * is a question for the reader; a wrongly-placed one is a lie.
 */
const OTHER_COVERAGE_SECTION: CoverageSectionDefinition = {
  kind: "Other",
  title: "Other rule types",
  ruleTypes: [],
};

const getSeverityKindForRuleType: (
  ruleType: NotificationRuleType,
) => SeverityKindValue = (
  ruleType: NotificationRuleType,
): SeverityKindValue => {
  switch (ruleType) {
    case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
    case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
      return "Incident";
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
      return "Alert";
    default:
      return "Other";
  }
};

const STATUS_FILTER_LABELS: Record<ReadinessStatusValue, string> = {
  Ready: "Ready",
  PartiallyReady: "Needs setup",
  NotReachable: "Unreachable",
};

// Non-ready first. Nobody opens this page to admire the responders who are fine.
const STATUS_SORT_RANK: Record<ReadinessStatusValue, number> = {
  NotReachable: 0,
  PartiallyReady: 1,
  Ready: 2,
};

const RESPONDER_SOURCE_ICONS: Record<ResponderSourceValue, IconProp> = {
  Direct: IconProp.User,
  Team: IconProp.Team,
  Schedule: IconProp.Calendar,
  Override: IconProp.Bolt,
};

const ALL_STATUSES_FILTER_VALUE: string = "All";

const INITIAL_VISIBLE_RESPONDERS: number = 25;

const VISIBLE_RESPONDERS_INCREMENT: number = 25;

type CoverageCellState = "Covered" | "Muted" | "Gap" | "Unknown";

interface SeverityRow {
  severityId: string;
  severityName: string;
}

interface CoverageSection {
  kind: SeverityKindValue;
  title: string;
  ruleTypes: Array<NotificationRuleType>;
  severities: Array<SeverityRow>;
  cellsByKey: Dictionary<ReadinessCoverageCellWire>;
}

interface CoverageModel {
  sections: Array<CoverageSection>;
  lifecycleCells: Array<ReadinessCoverageCellWire>;
}

const getCoverageCellKey: (
  ruleType: NotificationRuleType,
  severityId: string,
) => string = (ruleType: NotificationRuleType, severityId: string): string => {
  return `${ruleType}|${severityId}`;
};

/*
 * Pivot the flat cell list the service returns into the grids the page draws.
 *
 * A severity only becomes a row in the section its own cells arrived under, so
 * the row axis of each grid is derived rather than assumed: an alert severity
 * can never appear under an incident column because it was never observed with
 * an incident rule type. That is a structural guarantee, not a filter that could
 * be forgotten later. Within a section a missing (rule type, severity) pair is
 * still drawn - as "not reported", not as a gap - because the service emits both
 * incident columns for every incident severity, so an absence there is a real
 * fact about the payload rather than an impossible combination.
 *
 * Rows keep the order the severities arrived in, which is the project's own
 * severity ordering.
 */
const buildCoverageModel: (
  coverage: Array<ReadinessCoverageCellWire>,
) => CoverageModel = (
  coverage: Array<ReadinessCoverageCellWire>,
): CoverageModel => {
  const sectionsByKind: Dictionary<CoverageSection> = {};
  const lifecycleCells: Array<ReadinessCoverageCellWire> = [];
  const seenSeverityKeys: Set<string> = new Set<string>();

  const getSection: (kind: SeverityKindValue) => CoverageSection = (
    kind: SeverityKindValue,
  ): CoverageSection => {
    const existing: CoverageSection | undefined = sectionsByKind[kind];

    if (existing) {
      return existing;
    }

    const definition: CoverageSectionDefinition =
      COVERAGE_SECTION_DEFINITIONS.find(
        (candidate: CoverageSectionDefinition): boolean => {
          return candidate.kind === kind;
        },
      ) || OTHER_COVERAGE_SECTION;

    const created: CoverageSection = {
      kind: kind,
      title: definition.title,
      // Copied, so a payload-discovered column never mutates the definition.
      ruleTypes: [...definition.ruleTypes],
      severities: [],
      cellsByKey: {},
    };

    sectionsByKind[kind] = created;

    return created;
  };

  for (const cell of coverage) {
    if (!cell.severityId) {
      lifecycleCells.push(cell);
      continue;
    }

    const kind: SeverityKindValue = getSeverityKindForRuleType(cell.ruleType);
    const section: CoverageSection = getSection(kind);

    section.cellsByKey[getCoverageCellKey(cell.ruleType, cell.severityId)] =
      cell;

    if (!section.ruleTypes.includes(cell.ruleType)) {
      section.ruleTypes.push(cell.ruleType);
    }

    /*
     * Keyed by kind as well as by id. Two severities from different kinds can
     * legitimately share a name ("Sev1" for both), and a project could in
     * principle reuse an id shape across the two tables, so the row identity has
     * to be the pair.
     */
    const severityKey: string = `${kind}|${cell.severityId}`;

    if (!seenSeverityKeys.has(severityKey)) {
      seenSeverityKeys.add(severityKey);
      section.severities.push({
        severityId: cell.severityId,
        severityName: cell.severityName || "Unnamed severity",
      });
    }
  }

  const sections: Array<CoverageSection> = [
    ...COVERAGE_SECTION_DEFINITIONS,
    OTHER_COVERAGE_SECTION,
  ]
    .map(
      (definition: CoverageSectionDefinition): CoverageSection | undefined => {
        return sectionsByKind[definition.kind];
      },
    )
    .filter(
      (section: CoverageSection | undefined): section is CoverageSection => {
        return Boolean(section);
      },
    );

  return {
    sections: sections,
    lifecycleCells: lifecycleCells,
  };
};

const getCoverageCellState: (
  cell: ReadinessCoverageCellWire | undefined,
) => CoverageCellState = (
  cell: ReadinessCoverageCellWire | undefined,
): CoverageCellState => {
  if (!cell) {
    /*
     * The service did not report this pair at all, which is not the same claim
     * as "no rule" - it may simply not apply here. It renders neutral rather
     * than as an accusation the reader would waste time chasing.
     */
    return "Unknown";
  }

  /*
   * Opt-out is checked first, deliberately. isOptOut is nullable and the
   * service excludes opt-out rows from hasRule, so a muted cell arrives as
   * hasRule: false. Reading hasRule first would paint every deliberate mute as
   * a gap and bury the real ones under them.
   */
  if (cell.isOptOut) {
    return "Muted";
  }

  if (cell.hasRule) {
    return "Covered";
  }

  return "Gap";
};

const COVERAGE_CELL_TITLES: Record<CoverageCellState, string> = {
  Covered: "Covered - a notification rule exists",
  Muted: "Muted - notifications intentionally turned off",
  Gap: "No rule - pages here fall back to a verified method",
  Unknown: "Not reported",
};

const getCoverageCellVisual: (state: CoverageCellState) => ReactElement = (
  state: CoverageCellState,
): ReactElement => {
  const title: string = COVERAGE_CELL_TITLES[state];

  if (state === "Covered") {
    return (
      <span
        title={title}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 ring-1 ring-inset ring-emerald-200"
      >
        <Icon
          icon={IconProp.Check}
          className="h-3.5 w-3.5 text-emerald-600"
          ariaLabel={title}
        />
      </span>
    );
  }

  if (state === "Muted") {
    return (
      <span
        title={title}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 ring-1 ring-inset ring-gray-200"
      >
        <Icon
          icon={IconProp.BellSlash}
          className="h-3.5 w-3.5 text-gray-500"
          ariaLabel={title}
        />
      </span>
    );
  }

  if (state === "Gap") {
    return (
      <span
        title={title}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 ring-1 ring-inset ring-amber-200"
      >
        <Icon
          icon={IconProp.Minus}
          className="h-3.5 w-3.5 text-amber-600"
          ariaLabel={title}
        />
      </span>
    );
  }

  return (
    <span
      title={title}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs text-gray-300 ring-1 ring-inset ring-gray-100"
    >
      &mdash;
    </span>
  );
};

export interface StatusChipProps {
  status: ReadinessStatusValue;
  label: string;
}

/*
 * Three states, not two. The old Compliant / Non-Compliant binary made a
 * responder missing one severity look exactly as broken as a responder with no
 * phone, no email and no push, so admins learned to ignore both. Red is
 * reserved for the state that actually loses pages; amber says degraded,
 * because Phase 1's fallback does still page these people.
 */
const StatusChip: FunctionComponent<StatusChipProps> = (
  props: StatusChipProps,
): ReactElement => {
  if (props.status === READINESS_STATUS_NOT_REACHABLE) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
        <Icon icon={IconProp.Alert} className="h-3 w-3 text-red-500" />
        {props.label}
      </span>
    );
  }

  if (props.status === READINESS_STATUS_PARTIALLY_READY) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
        <Icon icon={IconProp.Alert} className="h-3 w-3 text-amber-500" />
        {props.label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <Icon icon={IconProp.CheckCircle} className="h-3 w-3 text-emerald-500" />
      {props.label}
    </span>
  );
};

export interface ChannelMeterProps {
  methods: Array<ReadinessMethodWire>;
}

/*
 * Seven segments, one per channel, always all seven drawn and always in the
 * same order. Filled means a verified method; the hollow amber segment means
 * the method exists but was never verified, which is the state that surprises
 * people most often. Because the positions are fixed, a row of grey reads as
 * "nothing will reach this person" at a glance, and a reader stops needing the
 * tooltip after the second row.
 */
const ChannelMeter: FunctionComponent<ChannelMeterProps> = (
  props: ChannelMeterProps,
): ReactElement => {
  const methodsByChannel: Dictionary<ReadinessMethodWire> = {};

  for (const method of props.methods) {
    const existing: ReadinessMethodWire | undefined =
      methodsByChannel[method.methodType];

    // A verified method always wins the segment over an unverified one.
    if (!existing || (!existing.isVerified && method.isVerified)) {
      methodsByChannel[method.methodType] = method;
    }
  }

  const verifiedCount: number = CHANNEL_ORDER.filter(
    (channel: string): boolean => {
      return Boolean(methodsByChannel[channel]?.isVerified);
    },
  ).length;

  const tooltipContent: ReactElement = (
    <div className="min-w-40 text-xs">
      <div className="mb-1 font-semibold text-gray-900">
        {verifiedCount} of {CHANNEL_ORDER.length} channels verified
      </div>
      <ul className="space-y-0.5">
        {CHANNEL_ORDER.map((channel: string): ReactElement => {
          const method: ReadinessMethodWire | undefined =
            methodsByChannel[channel];

          return (
            <li
              key={`tooltip-${channel}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-1 text-gray-600">
                <Icon
                  icon={CHANNEL_ICONS[channel] || IconProp.Bell}
                  className="h-3 w-3 text-gray-400"
                />
                {channel}
              </span>
              <span className="text-gray-500">
                {method
                  ? `${method.maskedIdentifier}${
                      method.isVerified ? "" : " (unverified)"
                    }`
                  : "Not set up"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Tooltip richContent={tooltipContent}>
      <span
        className="inline-flex items-center gap-0.5"
        aria-label={`${verifiedCount} of ${CHANNEL_ORDER.length} notification channels verified`}
      >
        {CHANNEL_ORDER.map((channel: string): ReactElement => {
          const method: ReadinessMethodWire | undefined =
            methodsByChannel[channel];

          let segmentClassName: string = "bg-gray-200";

          if (method?.isVerified) {
            segmentClassName = "bg-emerald-500";
          } else if (method) {
            segmentClassName = "bg-white ring-1 ring-inset ring-amber-400";
          }

          return (
            <span
              key={`segment-${channel}`}
              className={`h-4 w-1.5 rounded-sm ${segmentClassName}`}
            />
          );
        })}
      </span>
    </Tooltip>
  );
};

export interface CoverageSectionViewProps {
  section: CoverageSection;
}

/*
 * One kind's grid, and its narrow-viewport twin.
 *
 * Both render from the same section so they cannot disagree, and the swap is
 * pure CSS rather than a resize listener - which keeps it correct on first paint
 * and inside tests, where no resize event ever fires. A matrix squeezed onto a
 * phone stops being readable well before it stops fitting, so below md it
 * becomes one collapsible row per severity, each carrying its own gap count so
 * the phone reader can find the bad row without opening all of them.
 *
 * The open row is state per SECTION rather than one id shared across the page:
 * opening Sev1 under incidents must not close whatever the reader had open
 * under alerts, and the two kinds routinely carry identically-named severities.
 */
const CoverageSectionView: FunctionComponent<CoverageSectionViewProps> = (
  props: CoverageSectionViewProps,
): ReactElement => {
  const [openSeverityId, setOpenSeverityId] = useState<string>("");

  const section: CoverageSection = props.section;

  const getSeverityGapCount: (severity: SeverityRow) => number = (
    severity: SeverityRow,
  ): number => {
    return section.ruleTypes.filter(
      (ruleType: NotificationRuleType): boolean => {
        return (
          getCoverageCellState(
            section.cellsByKey[
              getCoverageCellKey(ruleType, severity.severityId)
            ],
          ) === "Gap"
        );
      },
    ).length;
  };

  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {section.title}
      </div>

      {/* Wide viewports: the matrix itself. */}
      <div className="hidden overflow-x-auto md:block">
        <table
          aria-label={`${section.title} coverage`}
          className="min-w-full border-separate border-spacing-0"
        >
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 pb-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                Severity
              </th>
              {section.ruleTypes.map(
                (ruleType: NotificationRuleType): ReactElement => {
                  return (
                    <th
                      key={`head-${section.kind}-${ruleType}`}
                      className="px-3 pb-2 text-center text-xs font-medium uppercase tracking-wide text-gray-400"
                    >
                      {getRuleTypeLabel(ruleType)}
                    </th>
                  );
                },
              )}
            </tr>
          </thead>
          <tbody>
            {section.severities.map((severity: SeverityRow): ReactElement => {
              return (
                <tr key={`row-${section.kind}-${severity.severityId}`}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-t border-gray-200 bg-gray-50 py-2 pr-4 text-sm text-gray-900">
                    {severity.severityName}
                  </td>
                  {section.ruleTypes.map(
                    (ruleType: NotificationRuleType): ReactElement => {
                      const state: CoverageCellState = getCoverageCellState(
                        section.cellsByKey[
                          getCoverageCellKey(ruleType, severity.severityId)
                        ],
                      );

                      return (
                        <td
                          key={`cell-${section.kind}-${severity.severityId}-${ruleType}`}
                          className="border-t border-gray-200 px-3 py-2 text-center"
                        >
                          {getCoverageCellVisual(state)}
                        </td>
                      );
                    },
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Narrow viewports: one collapsible row per severity. */}
      <div className="md:hidden">
        {section.severities.map((severity: SeverityRow): ReactElement => {
          const isOpen: boolean = openSeverityId === severity.severityId;
          const severityGapCount: number = getSeverityGapCount(severity);

          return (
            <div
              key={`accordion-${section.kind}-${severity.severityId}`}
              className="border-b border-gray-200 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => {
                  setOpenSeverityId(isOpen ? "" : severity.severityId);
                }}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="text-sm font-medium text-gray-900">
                  {severity.severityName}
                </span>
                <span className="flex items-center gap-2">
                  {severityGapCount > 0 ? (
                    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                      {severityGapCount}{" "}
                      {severityGapCount === 1 ? "gap" : "gaps"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Covered
                    </span>
                  )}
                  <Icon
                    icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
                    className="h-4 w-4 text-gray-400"
                  />
                </span>
              </button>
              {isOpen && (
                <ul className="pb-3">
                  {section.ruleTypes.map(
                    (ruleType: NotificationRuleType): ReactElement => {
                      const state: CoverageCellState = getCoverageCellState(
                        section.cellsByKey[
                          getCoverageCellKey(ruleType, severity.severityId)
                        ],
                      );

                      return (
                        <li
                          key={`accordion-cell-${section.kind}-${severity.severityId}-${ruleType}`}
                          className="flex items-center justify-between py-1.5"
                        >
                          <span className="text-sm text-gray-600">
                            {getRuleTypeLabel(ruleType)}
                          </span>
                          {getCoverageCellVisual(state)}
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface CoverageMatrixProps {
  model: CoverageModel;
}

/*
 * One grid per severity kind, stacked, plus the severity-less rule types
 * underneath. Stacking rather than interleaving is what keeps each grid narrow
 * enough to read on a laptop and honest about what its columns mean.
 */
const CoverageMatrix: FunctionComponent<CoverageMatrixProps> = (
  props: CoverageMatrixProps,
): ReactElement => {
  const model: CoverageModel = props.model;

  if (model.sections.length === 0 && model.lifecycleCells.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No coverage was reported for this responder.
      </div>
    );
  }

  return (
    <div>
      {model.sections.map((section: CoverageSection): ReactElement => {
        return (
          <CoverageSectionView
            key={`section-${section.kind}`}
            section={section}
          />
        );
      })}

      {model.lifecycleCells.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Shift changes
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {model.lifecycleCells.map(
              (cell: ReadinessCoverageCellWire): ReactElement => {
                return (
                  <li
                    key={`lifecycle-${cell.ruleType}`}
                    className="flex items-center gap-2"
                  >
                    {getCoverageCellVisual(getCoverageCellState(cell))}
                    <span className="text-sm text-gray-600">
                      {getRuleTypeLabel(cell.ruleType)}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

interface SetupReminderReportBannerProps {
  report: SetupReminderReport;
  /** Every responder on the page, so an outcome can be shown against a name. */
  rows: Array<ResponderRow>;
  onDismiss: () => void;
}

/*
 * What actually happened, per user.
 *
 * The headline is the count sentence; underneath it, every user who was NOT
 * sent a reminder is named with the server's own explanation. Successes are
 * deliberately not enumerated - a list of eight names under "8 sent" is noise,
 * and burying the one line that needs attention in it is exactly how a report
 * stops being read.
 *
 * Tone follows the worst thing in the report rather than the best: any failure
 * makes the whole banner red, because a green banner with a red line inside it
 * is read as green. That is the same rule the tiles above follow, and it is the
 * rule that keeps the colours on this page meaning something.
 */
const SetupReminderReportBanner: FunctionComponent<
  SetupReminderReportBannerProps
> = (props: SetupReminderReportBannerProps): ReactElement => {
  const namesByUserId: Dictionary<string> = {};

  for (const row of props.rows) {
    namesByUserId[row.readiness.userId] =
      row.readiness.userName || row.readiness.userEmail;
  }

  const notSent: Array<SetupReminderUserOutcome> = props.report.results.filter(
    (result: SetupReminderUserOutcome): boolean => {
      return result.outcome !== "Sent";
    },
  );

  let toneClassName: string =
    "border-emerald-200 bg-emerald-50 text-emerald-800";

  if (props.report.failedCount > 0) {
    toneClassName = "border-red-200 bg-red-50 text-red-800";
  } else if (props.report.sentCount === 0 || props.report.skippedCount > 0) {
    toneClassName = "border-amber-200 bg-amber-50 text-amber-900";
  }

  return (
    <div
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${toneClassName}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-medium">Setup reminders:&nbsp;</span>
          {describeSetupReminderReport(props.report)}
        </div>
        <button
          type="button"
          className="whitespace-nowrap text-xs underline opacity-80 hover:opacity-100"
          onClick={props.onDismiss}
        >
          Dismiss
        </button>
      </div>

      {notSent.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {notSent.map((result: SetupReminderUserOutcome): ReactElement => {
            return (
              <li key={`reminder-outcome-${result.userId}`}>
                <span className="font-medium">
                  {namesByUserId[result.userId] || "This responder"}
                </span>
                {result.message ? ` - ${result.message}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

interface ResponderRow {
  readiness: UserReadinessWire;
  model: CoverageModel;
  gapCount: number;
}

const OnCallReadinessPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [summary, setSummary] = useState<ReadinessSummaryWire | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>(
    ALL_STATUSES_FILTER_VALUE,
  );
  const [expandedUserId, setExpandedUserId] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(
    INITIAL_VISIBLE_RESPONDERS,
  );

  /*
   * Selection is kept as ids rather than as rows, so it survives a refresh that
   * reorders the table (which every refresh does - the sort is by status, and
   * status is exactly what a refresh is expected to change). Ids that no longer
   * appear in the data are pruned when the selection is used, not when it is
   * stored, so a responder who briefly vanishes from a filtered read does not
   * silently drop off the list an admin is building.
   */
  const [selectedUserIds, setSelectedUserIds] = useState<Array<string>>([]);
  const [isReminderModalVisible, setIsReminderModalVisible] =
    useState<boolean>(false);
  const [isSendingReminders, setIsSendingReminders] = useState<boolean>(false);
  const [reminderFailure, setReminderFailure] =
    useState<SetupReminderFailure | null>(null);
  const [reminderReport, setReminderReport] =
    useState<SetupReminderReport | null>(null);

  /*
   * Read EVERY page, not the first one.
   *
   * The endpoint is paged and defaults to 100 responders. A single unpaged GET
   * therefore answers "who on this project would actually get paged?" using
   * whichever hundred responders sorted first, and because the tiles are
   * recomputed from the rows in hand they would agree with the list while both
   * understated the project. A responder who cannot be paged, sitting on page
   * two, would appear in no tile, no filter and no list - which is precisely the
   * silent omission this page exists to eliminate, reproduced by the page
   * itself.
   *
   * Reading to exhaustion keeps the tiles honest AND keeps them consistent with
   * the list beneath them, which is why the counts are still derived from the
   * rows rather than trusted from a payload.
   *
   * MAX_READINESS_PAGES bounds a pathological project rather than expressing a
   * product limit; hitting it is surfaced instead of swallowed, because a
   * truncated answer that looks complete is the one outcome worse than an error.
   */
  const fetchReadiness: (isRefresh?: boolean) => Promise<void> = async (
    isRefresh: boolean = false,
  ): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const collectedUsers: Array<UserReadinessWire> = [];
      let page: ReadinessPageWire | null = null;
      let skip: number = 0;
      let pagesRead: number = 0;

      do {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString())
              .addRoute(READINESS_PROJECT_API_PATH)
              .addQueryParams({
                limit: String(READINESS_PAGE_SIZE),
                skip: String(skip),
                /*
                 * Only the FIRST page asks the server to drop its cache. Asking
                 * on every page would recompute the whole project between pages
                 * and could interleave two different snapshots into one list.
                 */
                ...(skip === 0 && isRefresh ? { refresh: "true" } : {}),
              }),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        page = parseReadinessPage(response.data);
        collectedUsers.push(...page.summary.users);
        skip += READINESS_PAGE_SIZE;
        pagesRead++;
      } while (page.hasMore && pagesRead < MAX_READINESS_PAGES);

      const isIncomplete: boolean =
        page.summary.isTruncated ||
        (page.hasMore && pagesRead >= MAX_READINESS_PAGES);

      setSummary({
        ...page.summary,
        isTruncated: isIncomplete,
        readyCount: countByStatus(collectedUsers, READINESS_STATUS_READY),
        partiallyReadyCount: countByStatus(
          collectedUsers,
          READINESS_STATUS_PARTIALLY_READY,
        ),
        notReachableCount: countByStatus(
          collectedUsers,
          READINESS_STATUS_NOT_REACHABLE,
        ),
        users: collectedUsers,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReadiness().catch(() => {
      // fetchReadiness already routes every failure into the error state.
    });
  }, []);

  /*
   * Ordering is the whole editorial position of this page: unreachable first,
   * then the most incomplete, then alphabetical so the list is stable between
   * refreshes. An admin who opens this and sees green at the top learns nothing.
   */
  const allRows: Array<ResponderRow> = (summary?.users || [])
    .map((readiness: UserReadinessWire): ResponderRow => {
      return {
        readiness: readiness,
        model: buildCoverageModel(readiness.coverage),
        gapCount: getCoverageGaps(readiness).length,
      };
    })
    .sort((a: ResponderRow, b: ResponderRow): number => {
      const rankDifference: number =
        STATUS_SORT_RANK[a.readiness.status] -
        STATUS_SORT_RANK[b.readiness.status];

      if (rankDifference !== 0) {
        return rankDifference;
      }

      if (a.gapCount !== b.gapCount) {
        return b.gapCount - a.gapCount;
      }

      return a.readiness.userName.localeCompare(b.readiness.userName);
    });

  const countRowsWithStatus: (status: ReadinessStatusValue) => number = (
    status: ReadinessStatusValue,
  ): number => {
    return allRows.filter((row: ResponderRow): boolean => {
      return row.readiness.status === status;
    }).length;
  };

  const filteredRows: Array<ResponderRow> = allRows.filter(
    (row: ResponderRow): boolean => {
      if (statusFilter === ALL_STATUSES_FILTER_VALUE) {
        return true;
      }

      return row.readiness.status === statusFilter;
    },
  );

  const visibleRows: Array<ResponderRow> = filteredRows.slice(0, visibleCount);

  /*
   * A Ready responder cannot be selected, because there is nothing to remind
   * them of. The server agrees - it answers SkippedNothingMissing for them
   * rather than mailing a claim they could disprove in ten seconds - so
   * disabling the checkbox here is not a second rule, it is the same rule made
   * visible before the click instead of explained after it.
   */
  const isRemindable: (row: ResponderRow) => boolean = (
    row: ResponderRow,
  ): boolean => {
    return row.readiness.status !== READINESS_STATUS_READY;
  };

  const selectedUserIdSet: Set<string> = new Set<string>(selectedUserIds);

  /*
   * The selection, pruned to responders who are still in the data and still
   * remindable. Pruning at the point of USE rather than in the setter is what
   * keeps a refresh from silently shrinking a list the admin is halfway through
   * building: the ids stay in state, and only what is actually actionable right
   * now is acted on or counted.
   */
  const selectedRows: Array<ResponderRow> = allRows.filter(
    (row: ResponderRow): boolean => {
      return selectedUserIdSet.has(row.readiness.userId) && isRemindable(row);
    },
  );

  const selectableVisibleRows: Array<ResponderRow> =
    visibleRows.filter(isRemindable);

  const selectedVisibleCount: number = selectableVisibleRows.filter(
    (row: ResponderRow): boolean => {
      return selectedUserIdSet.has(row.readiness.userId);
    },
  ).length;

  const toggleUserSelection: (userId: string, isSelected: boolean) => void = (
    userId: string,
    isSelected: boolean,
  ): void => {
    setSelectedUserIds((current: Array<string>): Array<string> => {
      const withoutUser: Array<string> = current.filter(
        (candidate: string): boolean => {
          return candidate !== userId;
        },
      );

      return isSelected ? [...withoutUser, userId] : withoutUser;
    });
  };

  /*
   * The header checkbox covers the rows ON SCREEN, not every row behind "Show
   * more". A control that silently selects people the reader has not seen is
   * how a reminder ends up in the inbox of somebody nobody meant to contact -
   * and this page deliberately renders 25 rows at a time precisely because
   * nobody reads a list of five thousand.
   */
  const toggleVisibleSelection: (isSelected: boolean) => void = (
    isSelected: boolean,
  ): void => {
    const visibleIds: Set<string> = new Set<string>(
      selectableVisibleRows.map((row: ResponderRow): string => {
        return row.readiness.userId;
      }),
    );

    setSelectedUserIds((current: Array<string>): Array<string> => {
      const withoutVisible: Array<string> = current.filter(
        (candidate: string): boolean => {
          return !visibleIds.has(candidate);
        },
      );

      return isSelected
        ? [...withoutVisible, ...Array.from(visibleIds)]
        : withoutVisible;
    });
  };

  /*
   * Send, then tell the truth about what happened.
   *
   * Three outcomes have to be distinguishable on screen and they are handled in
   * three different places here:
   *
   *   - the REQUEST failed. Split again by whether the outcome is KNOWABLE: a
   *     400 or a 403 is the application refusing before the fan-out, so nothing
   *     went; a timeout or a 502 is a request that may have mailed 200 people
   *     before the connection died. See readSetupReminderFailure - the banner
   *     claims one or the other, never both.
   *   - the request succeeded and every user was sent. A plain confirmation.
   *   - the request succeeded and some users were not. This is the common case
   *     the moment a throttle exists, and it is the reason the report is a
   *     per-user list rather than a boolean: "5 sent, 2 skipped" with the two
   *     named underneath is actionable, and a green tick over the same run is a
   *     lie by omission.
   *
   * The selection is cleared only on a request that actually reached the server,
   * so a failed attempt leaves the admin's list intact to retry with.
   */
  const sendSetupReminders: () => Promise<void> = async (): Promise<void> => {
    const userIds: Array<string> = selectedRows.map(
      (row: ResponderRow): string => {
        return row.readiness.userId;
      },
    );

    if (userIds.length === 0) {
      return;
    }

    try {
      setIsSendingReminders(true);
      setReminderFailure(null);
      setReminderReport(null);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            SETUP_REMINDER_API_PATH,
          ),
          data: {
            userIds: userIds,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        throw response;
      }

      setReminderReport(parseSetupReminderReport(response.data));
      setSelectedUserIds([]);
      setIsReminderModalVisible(false);
    } catch (err) {
      setReminderFailure(readSetupReminderFailure(err));
      setIsReminderModalVisible(false);
    } finally {
      setIsSendingReminders(false);
    }
  };

  const refreshButton: CardButtonSchema = getRefreshButton();
  refreshButton.title = "Refresh";
  refreshButton.onClick = () => {
    /*
     * A user pressing Refresh has almost always just changed something and
     * wants to see whether it worked. Answering that from a cache redraws the
     * identical screen and reads as "the fix did not take", so this asks the
     * server to recompute rather than merely re-fetching.
     */
    fetchReadiness(true).catch(() => {
      // fetchReadiness already routes every failure into the error state.
    });
  };

  const filterOptions: Array<FilterButtonOption> = [
    {
      label: "All",
      value: ALL_STATUSES_FILTER_VALUE,
      badge: allRows.length,
    },
    {
      label: STATUS_FILTER_LABELS[READINESS_STATUS_NOT_REACHABLE],
      value: READINESS_STATUS_NOT_REACHABLE,
      badge: countRowsWithStatus(READINESS_STATUS_NOT_REACHABLE),
    },
    {
      label: STATUS_FILTER_LABELS[READINESS_STATUS_PARTIALLY_READY],
      value: READINESS_STATUS_PARTIALLY_READY,
      badge: countRowsWithStatus(READINESS_STATUS_PARTIALLY_READY),
    },
    {
      label: STATUS_FILTER_LABELS[READINESS_STATUS_READY],
      value: READINESS_STATUS_READY,
      badge: countRowsWithStatus(READINESS_STATUS_READY),
    },
  ];

  const getExpandedPanel: (row: ResponderRow) => ReactElement = (
    row: ResponderRow,
  ): ReactElement => {
    return (
      <div className="bg-gray-50 px-4 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Notification methods
            </div>
            {row.readiness.methods.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                No notification methods at all. Only{" "}
                {row.readiness.userName || row.readiness.userEmail} can add
                these, so the fix here is a reminder, not an edit.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {row.readiness.methods.map(
                  (
                    method: ReadinessMethodWire,
                    methodIndex: number,
                  ): ReactElement => {
                    return (
                      <li
                        key={`method-${methodIndex}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Icon
                          icon={
                            CHANNEL_ICONS[method.methodType] || IconProp.Bell
                          }
                          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                        />
                        <span className="text-gray-900">
                          {method.maskedIdentifier}
                        </span>
                        {method.isVerified ? (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                            Unverified
                          </span>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            )}

            {row.readiness.reasons.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Why this status
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-gray-600">
                  {row.readiness.reasons.map(
                    (reason: string, reasonIndex: number): ReactElement => {
                      return <li key={`reason-${reasonIndex}`}>{reason}</li>;
                    },
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Coverage
            </div>
            <CoverageMatrix model={row.model} />
          </div>
        </div>
      </div>
    );
  };

  /*
   * Skeletons rather than a spinner, and rather than a blanked body.
   *
   * A slow request has to keep the page's shape: a card that swaps its whole
   * body for a centred spinner reads as "this feature is broken" rather than
   * "this is still loading", which is exactly the impression a readiness surface
   * cannot afford to give. The shapes below mirror the real layout - four tiles,
   * a filter strip, a run of responder rows - so nothing jumps when the answer
   * arrives. This matches ResponderReadinessCard, which does the same thing on
   * the policy page.
   */
  const getSkeleton: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index: number): ReactElement => {
            return (
              <div
                key={`tile-skeleton-${index}`}
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            );
          })}
        </div>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="h-8 w-72 animate-pulse rounded-md bg-gray-100" />
          <div className="h-8 w-44 animate-pulse rounded-md bg-gray-100" />
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          {[0, 1, 2, 3, 4].map((index: number): ReactElement => {
            return (
              <div
                key={`row-skeleton-${index}`}
                className="flex items-center gap-4 border-b border-gray-100 px-3 py-4 last:border-b-0"
              >
                <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-gray-100" />
                <div className="h-3.5 w-44 animate-pulse rounded bg-gray-100" />
                <div className="ml-auto h-3.5 w-24 animate-pulse rounded bg-gray-100" />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  let content: ReactElement;

  if (isLoading && !summary) {
    content = getSkeleton();
  } else if (error) {
    content = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          fetchReadiness().catch(() => {
            // fetchReadiness already routes every failure into the error state.
          });
        }}
      />
    );
  } else if (allRows.length === 0) {
    content = (
      <div className="py-10 text-center text-sm text-gray-500">
        No responders are attached to any on-call policy in this project yet.
      </div>
    );
  } else {
    content = (
      <div>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterButtons
            options={filterOptions}
            selectedValue={statusFilter}
            onSelect={(value: string) => {
              setStatusFilter(value);
              setVisibleCount(INITIAL_VISIBLE_RESPONDERS);
              setExpandedUserId("");
            }}
          />
          {/*
           * The button's own label carries the count, so the number of people
           * about to be emailed is legible without reading anything else on the
           * page. With nothing selected it is disabled and says what to do - a
           * bare disabled "Send setup reminder" leaves the reader hunting for
           * the control they have not found yet, which is the checkbox column.
           */}
          <div className="flex items-center gap-3 self-start">
            {selectedRows.length > 0 && (
              <button
                type="button"
                className="whitespace-nowrap text-xs text-gray-500 underline hover:text-gray-700"
                onClick={() => {
                  setSelectedUserIds([]);
                }}
              >
                Clear selection
              </button>
            )}
            <Button
              title={
                selectedRows.length > 0
                  ? `Send setup reminder (${selectedRows.length})`
                  : "Send setup reminder"
              }
              icon={IconProp.SendMessage}
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={selectedRows.length === 0 || isSendingReminders}
              onClick={() => {
                setReminderFailure(null);
                setReminderReport(null);
                setIsReminderModalVisible(true);
              }}
            />
          </div>
        </div>

        {selectedRows.length === 0 && (
          <div className="mb-4 text-xs text-gray-500">
            Tick the responders you want to remind. Responders who are already
            ready cannot be selected - there is nothing to remind them about.
          </div>
        )}

        {/*
         * A failed REQUEST and a partially successful one are two different
         * banners on purpose. The second means some mail went and some did not,
         * and collapsing them into one "something went wrong" would leave an
         * admin unsure whether to try again - and trying again is exactly what
         * they should not do when five of eight reminders already left.
         *
         * The failed-request banner then splits again, on whether the outcome is
         * knowable at all. The definite sentence is kept for the failures that
         * prove it - the application refusing before it started sending - and the
         * uncertain one says what it does not know and what to do about it.
         * Retrying is not forbidden here (the 24h throttle makes a duplicate run
         * mostly harmless), but the reader is told the state they are actually in
         * rather than a comforting version of it.
         */}
        {reminderFailure &&
          (reminderFailure.isNothingSentCertain ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="font-medium">No reminders were sent.&nbsp;</span>
              {reminderFailure.message}
            </div>
          ) : (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="font-medium">
                We could not confirm which reminders were sent.&nbsp;
              </span>
              {reminderFailure.message}
              <p className="mt-1.5">
                Some of them may already have gone out. Check with the
                responders before sending again - a reminder sent in the last 24
                hours is skipped rather than repeated, so a retry will not mail
                anybody twice.
              </p>
            </div>
          ))}

        {reminderReport && (
          <SetupReminderReportBanner
            report={reminderReport}
            rows={allRows}
            onDismiss={() => {
              setReminderReport(null);
            }}
          />
        )}

        {filteredRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">
            No responders match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="w-10 px-3 py-3">
                    {/*
                     * Selects the rows ON SCREEN - see toggleVisibleSelection.
                     * The indeterminate state is what makes that honest: a
                     * half-filled box after "Show more" tells the reader that
                     * some of what they are now looking at is not selected,
                     * where an empty box would suggest they had lost the
                     * selection they made a moment ago.
                     */}
                    <input
                      type="checkbox"
                      aria-label="Select the responders shown"
                      title="Select the responders shown"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={selectableVisibleRows.length === 0}
                      checked={
                        selectableVisibleRows.length > 0 &&
                        selectedVisibleCount === selectableVisibleRows.length
                      }
                      ref={(element: HTMLInputElement | null): void => {
                        if (element) {
                          element.indeterminate =
                            selectedVisibleCount > 0 &&
                            selectedVisibleCount < selectableVisibleRows.length;
                        }
                      }}
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>,
                      ) => {
                        toggleVisibleSelection(event.target.checked);
                      }}
                    />
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Responder
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 md:table-cell"
                  >
                    Channels
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 lg:table-cell"
                  >
                    Coverage
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 xl:table-cell"
                  >
                    Reached via
                  </th>
                  <th scope="col" className="w-10 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {visibleRows.map((row: ResponderRow): ReactElement => {
                  const isExpanded: boolean =
                    expandedUserId === row.readiness.userId;
                  const coveredCount: number =
                    row.readiness.coverage.length - row.gapCount;

                  return (
                    <React.Fragment key={`responder-${row.readiness.userId}`}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => {
                          setExpandedUserId(
                            isExpanded ? "" : row.readiness.userId,
                          );
                        }}
                      >
                        {/*
                         * stopPropagation on the CELL, not only on the input.
                         * The whole row toggles the coverage panel, and a click
                         * that lands on the padding around a checkbox is a click
                         * on the cell - so without this, ticking a box near its
                         * edge expands the row instead, which reads as the
                         * checkbox being broken.
                         */}
                        <td
                          className="px-3 py-3"
                          onClick={(event: React.MouseEvent) => {
                            event.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.readiness.userName}`}
                            title={
                              isRemindable(row)
                                ? `Select ${row.readiness.userName}`
                                : "Already ready - there is nothing to remind them about"
                            }
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!isRemindable(row)}
                            checked={selectedUserIdSet.has(
                              row.readiness.userId,
                            )}
                            onChange={(
                              event: React.ChangeEvent<HTMLInputElement>,
                            ) => {
                              toggleUserSelection(
                                row.readiness.userId,
                                event.target.checked,
                              );
                            }}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <UserElement
                            user={{
                              _id: row.readiness.userId,
                              name: row.readiness.userName,
                              email: row.readiness.userEmail,
                              profilePictureId:
                                row.readiness.userProfilePictureId || "",
                            }}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <StatusChip
                            status={row.readiness.status}
                            label={getStatusShortLabel(row.readiness)}
                          />
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <ChannelMeter methods={row.readiness.methods} />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-sm text-gray-600 lg:table-cell">
                          {row.readiness.coverage.length > 0
                            ? `${coveredCount} of ${row.readiness.coverage.length}`
                            : "Not reported"}
                        </td>
                        <td className="hidden px-3 py-3 xl:table-cell">
                          <span className="flex flex-wrap items-center gap-1">
                            {row.readiness.reachedVia.map(
                              (source: ResponderSourceValue): ReactElement => {
                                return (
                                  <span
                                    key={`via-${row.readiness.userId}-${source}`}
                                    className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
                                  >
                                    <Icon
                                      icon={RESPONDER_SOURCE_ICONS[source]}
                                      className="h-3 w-3 text-gray-400"
                                    />
                                    {source}
                                  </span>
                                );
                              },
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Icon
                            icon={
                              isExpanded
                                ? IconProp.ChevronUp
                                : IconProp.ChevronDown
                            }
                            className="h-4 w-4 text-gray-400"
                            ariaLabel={
                              isExpanded ? "Hide coverage" : "Show coverage"
                            }
                          />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            {getExpandedPanel(row)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredRows.length > visibleRows.length && (
          <div className="mt-4 flex justify-center">
            <Button
              title={`Show more (${
                filteredRows.length - visibleRows.length
              } remaining)`}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setVisibleCount((current: number): number => {
                  return current + VISIBLE_RESPONDERS_INCREMENT;
                });
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Card
        title="On-call readiness"
        description="Every responder any on-call policy in this project can reach - directly, through a team, a schedule or an override - and whether a page would actually arrive."
        buttons={[refreshButton]}
      >
        <div>
          {/*
           * Tone follows the value. A tile hardcoded to "warning" paints an
           * amber 0 and a red 0 on a project where every single responder is
           * reachable, which teaches the reader that the colours on this page do
           * not mean anything - and the day one of them does mean something,
           * they have already stopped looking.
           */}
          {summary && (
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                icon={IconProp.User}
                label={allRows.length === 1 ? "Responder" : "Responders"}
                value={`${allRows.length}`}
              />
              <StatTile
                icon={IconProp.CheckCircle}
                label="Ready"
                value={`${summary.readyCount}`}
                tone={summary.readyCount > 0 ? "positive" : "neutral"}
              />
              <StatTile
                icon={IconProp.Alert}
                label="Needs setup"
                value={`${summary.partiallyReadyCount}`}
                tone={summary.partiallyReadyCount > 0 ? "warning" : "neutral"}
              />
              <StatTile
                icon={IconProp.Error}
                label="Unreachable"
                value={`${summary.notReachableCount}`}
                tone={summary.notReachableCount > 0 ? "critical" : "neutral"}
              />
            </div>
          )}
          {content}
        </div>
      </Card>

      {/*
       * The confirmation names every recipient, and it is not decoration.
       * Selection survives a filter change, so the rows an admin ticked are not
       * necessarily the rows on screen when they press the button - and this is
       * the last moment before real email reaches real people. A modal that
       * said "Send 6 reminders?" would be asking them to confirm a number.
       */}
      {isReminderModalVisible && (
        <ConfirmModal
          title={`Send a setup reminder to ${selectedRows.length} ${
            selectedRows.length === 1 ? "responder" : "responders"
          }?`}
          description={
            <div>
              <p>
                Each of them gets one email naming exactly what is missing from
                their own notification setup, and a link to the settings page
                that fixes it. Nobody is emailed more than once in 24 hours, so
                any of these who were already reminded today will be skipped.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {selectedRows.map((row: ResponderRow): ReactElement => {
                  return (
                    <li key={`confirm-${row.readiness.userId}`}>
                      {row.readiness.userName}
                      {row.readiness.userEmail
                        ? ` (${row.readiness.userEmail})`
                        : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          }
          submitButtonText="Send reminders"
          isLoading={isSendingReminders}
          onSubmit={() => {
            sendSetupReminders().catch(() => {
              // sendSetupReminders routes every failure into the error state.
            });
          }}
          onClose={() => {
            setIsReminderModalVisible(false);
          }}
        />
      )}
    </div>
  );
};

export default OnCallReadinessPage;
