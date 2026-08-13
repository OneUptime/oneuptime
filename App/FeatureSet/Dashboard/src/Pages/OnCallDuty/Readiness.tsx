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
 * PHASE 4 - there is no /on-call-readiness/send-setup-reminder endpoint yet.
 *
 * The first cut of this page shipped an enabled button wired to a function that
 * unconditionally threw. An admin ticked responders, confirmed a modal that
 * named them by name, and got an error for their trouble - the control looked
 * like the fix and was a trap. A silent no-op would have been worse still: they
 * would have gone away believing a reminder had reached someone who still
 * cannot be paged, which is the exact failure this whole feature exists to
 * prevent. So the control is honestly off: disabled, saying why, with no
 * selection UI leading to it. When the endpoint lands, bring back the checkbox
 * column and POST the selected user ids to it.
 */
const SETUP_REMINDER_UNAVAILABLE_MESSAGE: string =
  "Setup reminders are not available yet - they arrive in a later release. Until then, ask these responders directly to finish their notification setup in User Settings.";

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
           * The tooltip lives on the wrapper, not on the button: a disabled
           * button swallows pointer events in every browser, so a tooltip
           * attached to it would never open - which is how a control ends up
           * silently dead with an explanation nobody can reach. The wrapper also
           * carries the plain title attribute, and the words next to it say the
           * same thing without any hovering at all.
           */}
          <Tooltip text={SETUP_REMINDER_UNAVAILABLE_MESSAGE}>
            <span
              title={SETUP_REMINDER_UNAVAILABLE_MESSAGE}
              className="inline-flex cursor-not-allowed items-center gap-2 self-start"
            >
              <Button
                title="Send setup reminder"
                icon={IconProp.SendMessage}
                buttonStyle={ButtonStyleType.OUTLINE}
                className="opacity-50"
                disabled={true}
              />
              <span className="whitespace-nowrap text-xs text-gray-500">
                Coming soon
              </span>
            </span>
          </Tooltip>
        </div>

        {filteredRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">
            No responders match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
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
                          <td colSpan={6} className="p-0">
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
    </div>
  );
};

export default OnCallReadinessPage;
