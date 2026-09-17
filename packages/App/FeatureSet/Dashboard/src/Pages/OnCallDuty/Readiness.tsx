import CoverageMatrix, {
  CoverageModel,
  buildCoverageModel,
} from "../../Components/OnCallPolicy/Readiness/CoverageMatrix";
import {
  ReadinessMethodWire,
  ReadinessStatusValue,
  ReadinessSummaryWire,
  ReadinessTeamWire,
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_PARTIALLY_READY,
  READINESS_STATUS_READY,
  ResponderSourceValue,
  UserReadinessWire,
  getCoverageGaps,
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
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Table, { BulkActionProps } from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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
 * Components/OnCallPolicy/Readiness/ReadinessTypes, and the grid itself from
 * Components/OnCallPolicy/Readiness/CoverageMatrix, so this page, the policy
 * overview card, the escalation-rule dots and the administrator's repair screen
 * cannot disagree about what a payload means or about what a hole in it looks
 * like. Only the project-wide fetch and the presentation around the grid are
 * local.
 *
 * THE TABLE IS THE PRODUCT'S TABLE.
 *
 * The rows used to be a hand-rolled `<table>` with a hand-rolled checkbox
 * column, a hand-rolled "Show more" button and a bespoke pill strip for status
 * filtering. It worked, and it looked like nothing else in OneUptime: no filter
 * modal, no filter chips, no bulk-action bar, no pagination, no CSV export, no
 * sorting, and a selection UI that behaved subtly differently from the one on
 * every other list in the product. All of that is now Common/UI's Table, which
 * means this page inherits those behaviours instead of reimplementing a worse
 * version of each - and the two things that ARE particular to readiness survive
 * as first-class table features rather than as local markup:
 *
 *   - a Ready responder's checkbox is LOCKED, because there is nothing to remind
 *     them of (Table.isItemSelectable);
 *   - the coverage grid opens from a row action rather than expanding the row,
 *     because the shared table has no expandable rows and a modal shows the
 *     whole grid without pushing the rest of the list off screen.
 *
 * Filtering, sorting and paging all run over the rows already in hand. The
 * endpoint is read to exhaustion (see fetchReadiness), so "filtered" here means
 * filtered against the WHOLE project rather than against a page of it - which is
 * the only way the counts on the tiles and the rows under them can agree.
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

const RESPONDER_SOURCE_ORDER: Array<ResponderSourceValue> = [
  "Direct",
  "Team",
  "Schedule",
  "Override",
];

const DEFAULT_ITEMS_ON_PAGE: number = 25;

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
 * This banner is kept rather than folded into the shared bulk-action progress
 * modal, and the reason is the vocabulary. That modal has two buckets, succeeded
 * and FAILED, and three of this endpoint's five outcomes are neither: a
 * responder skipped because they were already reminded in the last 24 hours has
 * not failed at anything, and filing them under "failed" would send an admin
 * chasing a problem that does not exist. Three buckets is the smallest number
 * that can describe this answer honestly.
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

/*
 * One table row.
 *
 * Everything the table sorts, filters or exports on is a FLAT field on this
 * object, even though `readiness` already carries the same fact one level down.
 * That is not redundancy for its own sake: Table sorts and the filter modal
 * both address a column by `keyof T`, so a fact that only exists nested is a
 * fact this page would have to reimplement a private sort and a private filter
 * for - which is precisely the bespoke machinery this rewrite deletes.
 *
 * `_id` is the user id, and it is what matchBulkSelectedItemByField uses. It has
 * to be stable across a refresh, because a refresh reorders the table (the sort
 * is by status, and status is exactly what a refresh is expected to change) and
 * an admin's half-built selection must survive that.
 */
interface ResponderRow {
  _id: string;
  readiness: UserReadinessWire;
  model: CoverageModel;
  gapCount: number;

  /** The display name, and what the free-text filter matches against. */
  responder: string;
  status: ReadinessStatusValue;
  statusLabel: string;
  /** Team ids, for the team filter. */
  teamIds: Array<string>;
  /** Team names, joined - what sorting and the CSV export read. */
  teamNames: string;
  reachedVia: Array<ResponderSourceValue>;
  coveredCount: number;
  coverageCellCount: number;
  verifiedChannelCount: number;
}

const buildResponderRow: (readiness: UserReadinessWire) => ResponderRow = (
  readiness: UserReadinessWire,
): ResponderRow => {
  const gapCount: number = getCoverageGaps(readiness).length;

  const verifiedChannelCount: number = CHANNEL_ORDER.filter(
    (channel: string): boolean => {
      return readiness.methods.some((method: ReadinessMethodWire): boolean => {
        return method.methodType === channel && method.isVerified;
      });
    },
  ).length;

  return {
    _id: readiness.userId,
    readiness: readiness,
    model: buildCoverageModel(readiness.coverage),
    gapCount: gapCount,
    responder: readiness.userName || readiness.userEmail,
    status: readiness.status,
    statusLabel: getStatusShortLabel(readiness),
    teamIds: readiness.teams.map((team: ReadinessTeamWire): string => {
      return team._id;
    }),
    teamNames: readiness.teams
      .map((team: ReadinessTeamWire): string => {
        return team.name;
      })
      .join(", "),
    reachedVia: readiness.reachedVia,
    coveredCount: readiness.coverage.length - gapCount,
    coverageCellCount: readiness.coverage.length,
    verifiedChannelCount: verifiedChannelCount,
  };
};

/*
 * A Ready responder cannot be selected, because there is nothing to remind them
 * of. The server agrees - it answers SkippedNothingMissing for them rather than
 * mailing a claim they could disprove in ten seconds - so locking the checkbox
 * here is not a second rule, it is the same rule made visible before the click
 * instead of explained after it.
 */
const isRemindable: (row: ResponderRow) => boolean = (
  row: ResponderRow,
): boolean => {
  return row.status !== READINESS_STATUS_READY;
};

const NOT_REMINDABLE_REASON: string =
  "Already ready - there is nothing to remind them about";

/*
 * Reads one filter value out of the FilterData the modal produced, as a list of
 * plain strings.
 *
 * The filter controls write four different shapes for what a reader thinks of as
 * one idea - a single dropdown writes a bare value, a multi-select writes an
 * array, and the text control writes a Search wrapper - and the rows here are
 * plain objects rather than database models, so there is no query builder to
 * hand any of it to. Normalising to `Array<string>` at the boundary keeps that
 * variety in one function instead of spreading it across every filtered field.
 */
const readFilterValues: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown): string => {
      return String(entry);
    });
  }

  return [String(value)];
};

/*
 * Turns the free-text filter into a predicate that honours the operator the
 * reader actually chose.
 *
 * The text control is not a search box: it offers contains / does not contain /
 * starts with / ends with / is / is not / is empty / is not empty, and writes a
 * different QueryOperator wrapper for each. Every one of those wrappers
 * stringifies to the same typed text, so a page that read `String(value)` and
 * called it a substring match would answer "does not contain ada" with exactly
 * the rows that DO contain ada - the filter would look like it worked and would
 * be inverted. There is no query builder to hand these to here (the rows are
 * plain objects, already in memory), so the operator is honoured in this
 * function or nowhere.
 *
 * A shape this build does not recognise falls through to a substring match,
 * which is the same thing a bare string means and the least surprising reading
 * of an operator we cannot interpret.
 */
type TextPredicate = (candidates: Array<string>) => boolean;

const buildTextPredicate: (value: unknown) => TextPredicate | null = (
  value: unknown,
): TextPredicate | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const anyOf: (test: (candidate: string) => boolean) => TextPredicate = (
    test: (candidate: string) => boolean,
  ): TextPredicate => {
    return (candidates: Array<string>): boolean => {
      return candidates.some(test);
    };
  };

  if (value instanceof IsNull) {
    return (candidates: Array<string>): boolean => {
      return candidates.every((candidate: string): boolean => {
        return candidate.trim() === "";
      });
    };
  }

  if (value instanceof NotNull) {
    return anyOf((candidate: string): boolean => {
      return candidate.trim() !== "";
    });
  }

  const text: string = String(value).toLowerCase().trim();

  if (!text) {
    return null;
  }

  if (value instanceof NotContains) {
    /*
     * Negation is over the WHOLE row, not per candidate: a responder whose name
     * does not contain the text but whose email does has not been excluded, and
     * "every candidate lacks it" is the only reading of that which does not
     * contradict the positive form.
     */
    return (candidates: Array<string>): boolean => {
      return candidates.every((candidate: string): boolean => {
        return !candidate.toLowerCase().includes(text);
      });
    };
  }

  if (value instanceof NotEqual) {
    return (candidates: Array<string>): boolean => {
      return candidates.every((candidate: string): boolean => {
        return candidate.toLowerCase() !== text;
      });
    };
  }

  if (value instanceof EqualTo) {
    return anyOf((candidate: string): boolean => {
      return candidate.toLowerCase() === text;
    });
  }

  if (value instanceof StartsWith) {
    return anyOf((candidate: string): boolean => {
      return candidate.toLowerCase().startsWith(text);
    });
  }

  if (value instanceof EndsWith) {
    return anyOf((candidate: string): boolean => {
      return candidate.toLowerCase().endsWith(text);
    });
  }

  return anyOf((candidate: string): boolean => {
    return candidate.toLowerCase().includes(text);
  });
};

const OnCallReadinessPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [summary, setSummary] = useState<ReadinessSummaryWire | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [filterData, setFilterData] = useState<FilterData<ResponderRow>>({});
  const [isFilterModalVisible, setIsFilterModalVisible] =
    useState<boolean>(false);

  /*
   * No column sort until the reader asks for one - the default order is the
   * page's editorial position (see allRows), and a column header would override
   * it silently.
   *
   * The order starts DESCENDING even though nothing is sorted yet, because
   * TableHeader flips whatever it is handed on every click: starting ascending
   * makes the very first click on "Responder" sort Z to A, which reads as the
   * control being backwards. Starting descending makes the first click A to Z.
   */
  const [sortBy, setSortBy] = useState<keyof ResponderRow | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);

  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(DEFAULT_ITEMS_ON_PAGE);

  const [coverageRow, setCoverageRow] = useState<ResponderRow | null>(null);

  /*
   * Selection is kept as ids rather than as rows, so it survives a refresh that
   * reorders the table (which every refresh does - the sort is by status, and
   * status is exactly what a refresh is expected to change). Ids that no longer
   * appear in the data are pruned when the selection is used, not when it is
   * stored, so a responder who briefly vanishes from a filtered read does not
   * silently drop off the list an admin is building.
   */
  const [selectedUserIds, setSelectedUserIds] = useState<Array<string>>([]);
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
   * rows rather than trusted from a payload. It is also what makes the table's
   * filtering and paging meaningful: both run over the whole project rather than
   * over whichever slice the server happened to send.
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
   *
   * This is the DEFAULT order, not a fixed one - clicking a column header sorts
   * by that column instead (see sortedRows). It stays the default because the
   * first thing an admin sees should be the thing that needs them.
   */
  const allRows: Array<ResponderRow> = useMemo((): Array<ResponderRow> => {
    return (summary?.users || [])
      .map(buildResponderRow)
      .sort((a: ResponderRow, b: ResponderRow): number => {
        const rankDifference: number =
          STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];

        if (rankDifference !== 0) {
          return rankDifference;
        }

        if (a.gapCount !== b.gapCount) {
          return b.gapCount - a.gapCount;
        }

        return a.responder.localeCompare(b.responder);
      });
  }, [summary]);

  /*
   * The team filter's options come from the rows themselves rather than from the
   * project's team list, and the difference matters. This page only ever lists
   * responders, so a team with no escalation rule attached to it pages nobody
   * and would be an option that always returns an empty table. Offering only the
   * teams that actually appear here means every option has at least one row
   * behind it.
   */
  const teamOptions: Array<DropdownOption> =
    useMemo((): Array<DropdownOption> => {
      const namesById: Map<string, string> = new Map<string, string>();

      for (const row of allRows) {
        for (const team of row.readiness.teams) {
          namesById.set(team._id, team.name);
        }
      }

      return Array.from(namesById.entries())
        .map(([id, name]: [string, string]): DropdownOption => {
          return { value: id, label: name };
        })
        .sort((a: DropdownOption, b: DropdownOption): number => {
          return a.label.localeCompare(b.label);
        });
    }, [allRows]);

  const filters: Array<Filter<ResponderRow>> = useMemo((): Array<
    Filter<ResponderRow>
  > => {
    return [
      {
        title: "Responder",
        key: "responder",
        type: FieldType.Text,
      },
      {
        title: "Status",
        key: "status",
        type: FieldType.MultiSelectDropdown,
        filterDropdownOptions: (
          [
            READINESS_STATUS_NOT_REACHABLE,
            READINESS_STATUS_PARTIALLY_READY,
            READINESS_STATUS_READY,
          ] as Array<ReadinessStatusValue>
        ).map((status: ReadinessStatusValue): DropdownOption => {
          return { value: status, label: STATUS_FILTER_LABELS[status] };
        }),
      },
      {
        title: "Team",
        key: "teamIds",
        type: FieldType.MultiSelectDropdown,
        filterDropdownOptions: teamOptions,
      },
      {
        title: "Reached via",
        key: "reachedVia",
        type: FieldType.MultiSelectDropdown,
        filterDropdownOptions: RESPONDER_SOURCE_ORDER.map(
          (source: ResponderSourceValue): DropdownOption => {
            return { value: source, label: source };
          },
        ),
      },
    ];
  }, [teamOptions]);

  /*
   * Applying the filter, over the rows already in hand.
   *
   * Table hands the filter up rather than applying it (see FilterViewer), which
   * is the right split for a model-backed table where the filter becomes a
   * query. Here there is no query to become: the whole project is already
   * loaded, so this is where a FilterData turns back into a predicate.
   *
   * Every field is compared as a SET INTERSECTION, including the ones that hold
   * a single value, so one code path covers "status is Unreachable", "team is
   * any of Platform, Payments" and "reached via Team" alike. The two array
   * fields - teams and reachedVia - are the reason: a responder on two teams
   * must match a filter that names either of them, and an "equals" comparison
   * cannot express that at all.
   */
  const filteredRows: Array<ResponderRow> = useMemo((): Array<ResponderRow> => {
    let rows: Array<ResponderRow> = allRows;

    const responderPredicate: TextPredicate | null = buildTextPredicate(
      (filterData as Record<string, unknown>)["responder"],
    );

    if (responderPredicate) {
      rows = rows.filter((row: ResponderRow): boolean => {
        /*
         * The email is matched as well as the name, because a name is the one
         * field on this page an admin might not know - two people called
         * "J. Smith" are told apart by their login address and by nothing else.
         */
        return responderPredicate([row.responder, row.readiness.userEmail]);
      });
    }

    type MatchByFieldFunction = (
      key: keyof ResponderRow,
      getRowValues: (row: ResponderRow) => Array<string>,
    ) => void;

    const matchByField: MatchByFieldFunction = (
      key: keyof ResponderRow,
      getRowValues: (row: ResponderRow) => Array<string>,
    ): void => {
      const wanted: Array<string> = readFilterValues(
        (filterData as Record<string, unknown>)[key as string],
      );

      if (wanted.length === 0) {
        return;
      }

      rows = rows.filter((row: ResponderRow): boolean => {
        return getRowValues(row).some((value: string): boolean => {
          return wanted.includes(value);
        });
      });
    };

    matchByField("status", (row: ResponderRow): Array<string> => {
      return [row.status];
    });

    matchByField("teamIds", (row: ResponderRow): Array<string> => {
      return row.teamIds;
    });

    matchByField("reachedVia", (row: ResponderRow): Array<string> => {
      return row.reachedVia;
    });

    return rows;
  }, [allRows, filterData]);

  const sortedRows: Array<ResponderRow> = useMemo((): Array<ResponderRow> => {
    if (!sortBy) {
      // allRows is already in the default order; filtering preserves it.
      return filteredRows;
    }

    const direction: number = sortOrder === SortOrder.Descending ? -1 : 1;

    return [...filteredRows].sort(
      (a: ResponderRow, b: ResponderRow): number => {
        const left: unknown = a[sortBy];
        const right: unknown = b[sortBy];

        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * direction;
        }

        return (
          String(left ?? "").localeCompare(String(right ?? "")) * direction
        );
      },
    );
  }, [filteredRows, sortBy, sortOrder]);

  const rowsOnPage: Array<ResponderRow> = useMemo((): Array<ResponderRow> => {
    const start: number = (currentPageNumber - 1) * itemsOnPage;

    return sortedRows.slice(start, start + itemsOnPage);
  }, [sortedRows, currentPageNumber, itemsOnPage]);

  const countRowsWithStatus: (status: ReadinessStatusValue) => number = (
    status: ReadinessStatusValue,
  ): number => {
    return allRows.filter((row: ResponderRow): boolean => {
      return row.status === status;
    }).length;
  };

  /*
   * The selection, pruned to responders who are still in the data and still
   * remindable. Pruning at the point of USE rather than in the setter is what
   * keeps a refresh from silently shrinking a list the admin is halfway through
   * building: the ids stay in state, and only what is actually actionable right
   * now is acted on or counted.
   *
   * Memoised because Table copies this array into its own state whenever the
   * reference changes; a fresh array on every render would put that effect into
   * a loop with itself.
   */
  const selectedRows: Array<ResponderRow> = useMemo((): Array<ResponderRow> => {
    const selectedIds: Set<string> = new Set<string>(selectedUserIds);

    return allRows.filter((row: ResponderRow): boolean => {
      return selectedIds.has(row._id) && isRemindable(row);
    });
  }, [allRows, selectedUserIds]);

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
  const sendSetupReminders: (
    rows: Array<ResponderRow>,
  ) => Promise<void> = async (rows: Array<ResponderRow>): Promise<void> => {
    const userIds: Array<string> = rows.map((row: ResponderRow): string => {
      return row._id;
    });

    if (userIds.length === 0) {
      return;
    }

    try {
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
    } catch (err) {
      setReminderFailure(readSetupReminderFailure(err));
    }
  };

  const bulkActions: BulkActionProps<ResponderRow> = {
    buttons: [
      {
        title: "Send setup reminder",
        icon: IconProp.SendMessage,
        buttonStyleType: ButtonStyleType.NORMAL,
        /*
         * The confirmation names every recipient, and it is not decoration.
         * Selection survives a filter change and a page change, so the rows an
         * admin ticked are not necessarily the rows on screen when they press
         * the button - and this is the last moment before real email reaches
         * real people. "Send 6 reminders?" would be asking them to confirm a
         * number.
         */
        confirmTitle: (rows: Array<ResponderRow>): string => {
          return `Send a setup reminder to ${rows.length} ${
            rows.length === 1 ? "responder" : "responders"
          }?`;
        },
        confirmMessage: (rows: Array<ResponderRow>): string => {
          const names: string = rows
            .map((row: ResponderRow): string => {
              return row.readiness.userEmail
                ? `${row.responder} (${row.readiness.userEmail})`
                : row.responder;
            })
            .join(", ");

          return `Each of them gets one email naming exactly what is missing from their own notification setup, and a link to the settings page that fixes it. Nobody is emailed more than once in 24 hours, so any of these who were already reminded today will be skipped. Reminding: ${names}.`;
        },
        onClick: async (
          onClickProps: BulkActionOnClickProps<ResponderRow>,
        ): Promise<void> => {
          await sendSetupReminders(onClickProps.items);
        },
      },
    ],
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

  /*
   * The funnel. Table renders the filter MODAL and the chip banner but no button
   * to open either with (FilterViewer draws nothing at all until a filter is
   * applied), so every page that offers filtering puts the trigger in its own
   * card header - which is also why it is the same funnel in the same corner
   * everywhere in the product.
   *
   * `title` on an ICON button is not drawn; it becomes the accessible name. An
   * icon with no name is a control a screen reader announces as "button".
   */
  const filterButton: CardButtonSchema = {
    title: "Filter",
    buttonStyle: ButtonStyleType.ICON,
    className: "py-0 pr-0 pl-1 mt-1",
    icon: IconProp.Filter,
    onClick: () => {
      setIsFilterModalVisible(true);
    },
  };

  /*
   * Filtering by status from a tile.
   *
   * The tiles already carry the three counts an admin triages by, so making them
   * the control that filters to those states puts the number and the action on
   * the same object. It also goes through the ordinary filter, which means the
   * result announces itself in the standard chip banner above the table
   * ("Status is any of: Unreachable") and clears with the standard Clear
   * Filters - rather than through a private pill strip that no other table in
   * the product has.
   */
  const activeStatusFilters: Array<string> = readFilterValues(
    (filterData as Record<string, unknown>)["status"],
  );

  const toggleStatusFilter: (status: ReadinessStatusValue) => void = (
    status: ReadinessStatusValue,
  ): void => {
    setCurrentPageNumber(1);

    setFilterData(
      (current: FilterData<ResponderRow>): FilterData<ResponderRow> => {
        const next: Record<string, unknown> = {
          ...(current as Record<string, unknown>),
        };

        const isAlreadyOnlyThisStatus: boolean =
          activeStatusFilters.length === 1 && activeStatusFilters[0] === status;

        if (isAlreadyOnlyThisStatus) {
          delete next["status"];
        } else {
          next["status"] = [status];
        }

        return next as FilterData<ResponderRow>;
      },
    );
  };

  const columns: Array<Column<ResponderRow>> = [
    {
      title: "Responder",
      key: "responder",
      type: FieldType.Element,
      getElement: (row: ResponderRow): ReactElement => {
        return (
          <UserElement
            user={{
              _id: row.readiness.userId,
              name: row.readiness.userName,
              email: row.readiness.userEmail,
              profilePictureId: row.readiness.userProfilePictureId || "",
            }}
          />
        );
      },
      getExportValue: (row: ResponderRow): string => {
        return row.readiness.userEmail
          ? `${row.responder} <${row.readiness.userEmail}>`
          : row.responder;
      },
    },
    {
      title: "Status",
      key: "status",
      type: FieldType.Element,
      getElement: (row: ResponderRow): ReactElement => {
        return <StatusChip status={row.status} label={row.statusLabel} />;
      },
      getExportValue: (row: ResponderRow): string => {
        return row.statusLabel;
      },
    },
    {
      title: "Teams",
      key: "teamNames",
      type: FieldType.Element,
      getElement: (row: ResponderRow): ReactElement => {
        if (row.readiness.teams.length === 0) {
          /*
           * An em dash rather than a blank cell, and rather than "None". This
           * responder is reached without a team being involved at all - the
           * "Reached via" column next to it says how - so "no teams" is not a
           * gap to be fixed and should not read like one.
           */
          return <span className="text-sm text-gray-400">&mdash;</span>;
        }

        return (
          <span className="flex flex-wrap items-center gap-1">
            {row.readiness.teams.map(
              (team: ReadinessTeamWire): ReactElement => {
                return (
                  <span
                    key={`team-${row._id}-${team._id}`}
                    className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
                  >
                    <Icon
                      icon={IconProp.Team}
                      className="h-3 w-3 text-gray-400"
                    />
                    {team.name}
                  </span>
                );
              },
            )}
          </span>
        );
      },
    },
    {
      title: "Channels",
      key: "verifiedChannelCount",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (row: ResponderRow): ReactElement => {
        return <ChannelMeter methods={row.readiness.methods} />;
      },
      getExportValue: (row: ResponderRow): string => {
        return `${row.verifiedChannelCount} of ${CHANNEL_ORDER.length} verified`;
      },
    },
    {
      title: "Coverage",
      key: "coveredCount",
      type: FieldType.Element,
      hideOnMobile: true,
      getElement: (row: ResponderRow): ReactElement => {
        return (
          <span className="whitespace-nowrap text-sm text-gray-600">
            {row.coverageCellCount > 0
              ? `${row.coveredCount} of ${row.coverageCellCount}`
              : "Not reported"}
          </span>
        );
      },
      getExportValue: (row: ResponderRow): string => {
        return row.coverageCellCount > 0
          ? `${row.coveredCount} of ${row.coverageCellCount}`
          : "Not reported";
      },
    },
    {
      title: "Reached via",
      key: "reachedVia",
      type: FieldType.Element,
      hideOnMobile: true,
      disableSort: true,
      getElement: (row: ResponderRow): ReactElement => {
        return (
          <span className="flex flex-wrap items-center gap-1">
            {row.reachedVia.map(
              (source: ResponderSourceValue): ReactElement => {
                return (
                  <span
                    key={`via-${row._id}-${source}`}
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
        );
      },
      getExportValue: (row: ResponderRow): string => {
        return row.reachedVia.join(", ");
      },
    },
    {
      title: "Actions",
      type: FieldType.Actions,
      disableCsvExport: true,
    },
  ];

  const actionButtons: Array<ActionButtonSchema<ResponderRow>> = [
    {
      title: "Coverage",
      icon: IconProp.Grid,
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (row: ResponderRow, onCompleteAction: () => void): void => {
        setCoverageRow(row);
        onCompleteAction();
      },
    },
  ];

  /*
   * Skeletons rather than a spinner, and rather than a blanked body.
   *
   * A slow request has to keep the page's shape: a card that swaps its whole
   * body for a centred spinner reads as "this feature is broken" rather than
   * "this is still loading", which is exactly the impression a readiness surface
   * cannot afford to give. The shapes below mirror the real layout - four tiles
   * and a run of responder rows - so nothing jumps when the answer arrives. This
   * matches ResponderReadinessCard, which does the same thing on the policy
   * page.
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

  const hasActiveFilters: boolean = Object.keys(filterData).length > 0;

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

        <Table<ResponderRow>
          id="on-call-readiness-table"
          columns={columns}
          actionButtons={actionButtons}
          data={rowsOnPage}
          singularLabel="Responder"
          pluralLabel="Responders"
          isLoading={false}
          error=""
          onRefreshClick={() => {
            fetchReadiness(true).catch(() => {
              // fetchReadiness already routes every failure into the error state.
            });
          }}
          noItemsMessage={
            hasActiveFilters
              ? "No responders match these filters."
              : "No responders are attached to any on-call policy in this project yet."
          }
          currentPageNumber={currentPageNumber}
          totalItemsCount={sortedRows.length}
          itemsOnPage={itemsOnPage}
          onNavigateToPage={(pageNumber: number, onPage: number) => {
            setCurrentPageNumber(pageNumber);
            setItemsOnPage(onPage);
          }}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChanged={(
            newSortBy: keyof ResponderRow | null,
            newSortOrder: SortOrder,
          ) => {
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
            setCurrentPageNumber(1);
          }}
          filters={filters}
          filterData={filterData}
          showFilterModal={isFilterModalVisible}
          onFilterChanged={(newFilterData: FilterData<ResponderRow>) => {
            setFilterData(newFilterData);
            setCurrentPageNumber(1);
          }}
          onFilterModalOpen={() => {
            setIsFilterModalVisible(true);
          }}
          onFilterModalClose={() => {
            setIsFilterModalVisible(false);
          }}
          bulkActions={bulkActions}
          bulkSelectedItems={selectedRows}
          matchBulkSelectedItemByField="_id"
          bulkItemToString={(row: ResponderRow): string => {
            return row.responder;
          }}
          isItemSelectable={isRemindable}
          itemNotSelectableReason={(): string => {
            return NOT_REMINDABLE_REASON;
          }}
          onBulkSelectedItemAdded={(row: ResponderRow) => {
            setSelectedUserIds((current: Array<string>): Array<string> => {
              return current.includes(row._id)
                ? current
                : [...current, row._id];
            });
          }}
          onBulkSelectedItemRemoved={(row: ResponderRow) => {
            setSelectedUserIds((current: Array<string>): Array<string> => {
              return current.filter((userId: string): boolean => {
                return userId !== row._id;
              });
            });
          }}
          /*
           * The page's rows, not every matching row. A control that silently
           * selects people the reader has not seen is how a reminder ends up in
           * the inbox of somebody nobody meant to contact - "Select All
           * Responders" in the bulk bar is the deliberate, separately-labelled
           * way to ask for the rest.
           */
          onBulkSelectItemsOnCurrentPage={() => {
            const idsOnPage: Array<string> = rowsOnPage
              .filter(isRemindable)
              .map((row: ResponderRow): string => {
                return row._id;
              });

            setSelectedUserIds((current: Array<string>): Array<string> => {
              return Array.from(new Set<string>([...current, ...idsOnPage]));
            });
          }}
          onBulkSelectAllItems={(): Promise<boolean> => {
            /*
             * Everything the CURRENT FILTER matches, which is what the bulk bar
             * says on the tin. It resolves true because the rows are already in
             * memory - there is no paged fetch here to fail partway, which is
             * the case this callback's boolean exists for.
             */
            setSelectedUserIds(
              sortedRows
                .filter(isRemindable)
                .map((row: ResponderRow): string => {
                  return row._id;
                }),
            );

            return Promise.resolve(true);
          }}
          onBulkClearAllItems={() => {
            setSelectedUserIds([]);
          }}
          bulkSelectionTotalCount={sortedRows.filter(isRemindable).length}
        />
      </div>
    );
  }

  return (
    <div>
      <Card
        title="On-call readiness"
        description="Every responder any on-call policy in this project can reach - directly, through a team, a schedule or an override - and whether a page would actually arrive."
        buttons={[refreshButton, filterButton]}
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
                value={`${countRowsWithStatus(READINESS_STATUS_READY)}`}
                tone={
                  countRowsWithStatus(READINESS_STATUS_READY) > 0
                    ? "positive"
                    : "neutral"
                }
                ariaLabel="Filter to responders who are ready"
                isActive={activeStatusFilters.includes(READINESS_STATUS_READY)}
                onClick={() => {
                  toggleStatusFilter(READINESS_STATUS_READY);
                }}
              />
              <StatTile
                icon={IconProp.Alert}
                label="Needs setup"
                value={`${countRowsWithStatus(
                  READINESS_STATUS_PARTIALLY_READY,
                )}`}
                tone={
                  countRowsWithStatus(READINESS_STATUS_PARTIALLY_READY) > 0
                    ? "warning"
                    : "neutral"
                }
                ariaLabel="Filter to responders who need setup"
                isActive={activeStatusFilters.includes(
                  READINESS_STATUS_PARTIALLY_READY,
                )}
                onClick={() => {
                  toggleStatusFilter(READINESS_STATUS_PARTIALLY_READY);
                }}
              />
              <StatTile
                icon={IconProp.Error}
                label="Unreachable"
                value={`${countRowsWithStatus(READINESS_STATUS_NOT_REACHABLE)}`}
                tone={
                  countRowsWithStatus(READINESS_STATUS_NOT_REACHABLE) > 0
                    ? "critical"
                    : "neutral"
                }
                ariaLabel="Filter to responders who are unreachable"
                isActive={activeStatusFilters.includes(
                  READINESS_STATUS_NOT_REACHABLE,
                )}
                onClick={() => {
                  toggleStatusFilter(READINESS_STATUS_NOT_REACHABLE);
                }}
              />
            </div>
          )}
          {content}
        </div>
      </Card>

      {/*
       * The coverage grid, in a modal rather than an expanded row.
       *
       * The shared table has no expandable rows, and rebuilding them locally is
       * what this rewrite is undoing. A modal is the better fit anyway: the grid
       * is severities down by rule types across and is wider than a table cell,
       * and opening one in place used to push every row below it off the screen.
       */}
      {coverageRow && (
        <Modal
          title={`Coverage for ${coverageRow.responder}`}
          description="Which severities this responder has a notification rule for, and how a page would reach them."
          modalWidth={ModalWidth.Large}
          submitButtonText="Close"
          onSubmit={() => {
            setCoverageRow(null);
          }}
          onClose={() => {
            setCoverageRow(null);
          }}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Notification methods
              </div>
              {coverageRow.readiness.methods.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  No notification methods at all. Only {coverageRow.responder}{" "}
                  can add these, so the fix here is a reminder, not an edit.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {coverageRow.readiness.methods.map(
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

              {coverageRow.readiness.reasons.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Why this status
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-gray-600">
                    {coverageRow.readiness.reasons.map(
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
              <CoverageMatrix model={coverageRow.model} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default OnCallReadinessPage;
