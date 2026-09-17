import { ReadinessCoverageCellWire, getRuleTypeLabel } from "./ReadinessTypes";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The coverage grid: severities down, rule types across, one grid per severity
 * KIND.
 *
 * This is the centrepiece of the readiness story and it now has two readers -
 * On-Call > Readiness, which draws one per expanded responder, and
 * Users > View > Notification Rules, where an administrator repairs the holes it
 * shows. It started module-private inside the readiness page; the admin page
 * needed exactly this grid, over exactly the same wire payload, and a second
 * copy would have been a second opinion about what a hole means. The two
 * surfaces sit next to each other in a workflow - see the gap on one, fix it on
 * the other - so a disagreement between them would be visible to the same person
 * within the same minute.
 *
 * The prose it replaces ("Missing notification rules for incident severities:
 * Sev1, Sev2") made a reader rebuild a grid in their head before they could find
 * the hole, and made them do it again for every responder. Here a gap is a
 * literal hole you can see without reading.
 */

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
export type SeverityKindValue = "Incident" | "Alert" | "Other";

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

export type CoverageCellState = "Covered" | "Muted" | "Gap" | "Unknown";

export interface SeverityRow {
  severityId: string;
  severityName: string;
}

export interface CoverageSection {
  kind: SeverityKindValue;
  title: string;
  ruleTypes: Array<NotificationRuleType>;
  severities: Array<SeverityRow>;
  cellsByKey: Dictionary<ReadinessCoverageCellWire>;
}

export interface CoverageModel {
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
export const buildCoverageModel: (
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

export const getCoverageCellState: (
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

export default CoverageMatrix;
