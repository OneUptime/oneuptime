import DataObservabilityApi from "./DataObservabilityApi";
import LineageGraph, {
  LineageExpanding,
  LineageGrowth,
  LineageHighlightSwatch,
  LineageLegend,
  isLineageFocusLost,
} from "./LineageGraph";
import {
  LineageColumnTrail,
  LineagePlace,
  LineageSummary,
  countPipelineTables,
  followLineageColumn,
  getLineageColumnChoices,
  getLineageExpandRequest,
  mergeLineageExpansion,
  summarizeLineage,
} from "./LineageGraphModel";
import { DataLineageExpansion } from "Common/Types/DataObservability/DataLineageExpansion";
import {
  DATA_LINEAGE_DEPTH_CHOICES,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageNode,
  isLineagePipelineNodeId,
} from "Common/Types/DataObservability/DataTableLineage";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import ViewSwitch, {
  ViewSwitchOption,
} from "Common/UI/Components/ViewSwitch/ViewSwitch";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * WHAT EVERY LINEAGE DIAGRAM SHARES: a table's (TableLineageDiagram), a
 * pipeline's (PipelineLineageDiagram) and a data alert's
 * (AlertLineageDiagram). The read, stamped with what it was read for, so an
 * answer for something no longer asked for never replaces the one that
 * is; the steps switch; and under the card's header, what lies each way,
 * the drawing, its legend, and notes when it could not hold it all.
 *
 * The drawing grows where it is: a card's count of tables not drawn draws
 * the next of them in place (mergeLineageExpansion), one card at a time,
 * and Reset diagram goes back to the drawing as it was read. On a table's
 * Lineage tab, read with its arrows' columns, one of the table's columns
 * can be followed up and down the drawing (followLineageColumn); on the
 * page of an alert from a check on one column, the drawing opens with
 * that column followed, and another can be picked, or none.
 */

// The steps each way, as the switch offers them: "1 step", "2 steps".
const STEP_LABELS: Readonly<Record<number, string>> = {
  1: translationKey("1 step"),
  2: translationKey("2 steps"),
  3: translationKey("3 steps"),
  5: translationKey("5 steps"),
};

export const LINEAGE_DEPTH_OPTIONS: ReadonlyArray<ViewSwitchOption<string>> =
  DATA_LINEAGE_DEPTH_CHOICES.map((depth: number): ViewSwitchOption<string> => {
    return {
      value: depth.toString(),
      label: STEP_LABELS[depth] || depth.toString(),
    };
  });

const UPSTREAM_TABLES: PluralTemplate = {
  one: "{{count}} table upstream",
  other: "{{count}} tables upstream",
};
const DOWNSTREAM_TABLES: PluralTemplate = {
  one: "{{count}} table downstream",
  other: "{{count}} tables downstream",
};
const PIPELINE_READS: PluralTemplate = {
  one: "Reads {{count}} table",
  other: "Reads {{count}} tables",
};
const PIPELINE_WRITES: PluralTemplate = {
  one: "Writes {{count}} table",
  other: "Writes {{count}} tables",
};
const DASHBOARDS: PluralTemplate = {
  one: "{{count}} dashboard",
  other: "{{count}} dashboards",
};
const UPSTREAM_PROBLEMS: PluralTemplate = {
  one: "{{count}} problem upstream",
  other: "{{count}} problems upstream",
};
const DOWNSTREAM_PROBLEMS: PluralTemplate = {
  one: "{{count}} problem downstream",
  other: "{{count}} problems downstream",
};
const HIDDEN_DASHBOARDS: PluralTemplate = {
  one: "{{count}} more dashboard is built on these tables and is not drawn.",
  other:
    "{{count}} more dashboards are built on these tables and are not drawn.",
};

const DRAW_FAILED: string = translationKey(
  "Could not draw more of this lineage.",
);
const COLUMN_FOLLOWED: string = translationKey(
  "{{column}} is highlighted where it comes from and where it goes.",
);
const COLUMN_MAY_GO_FURTHER: string = translationKey(
  "Some arrows on its way do not say which columns they carry, so it may go further than is highlighted.",
);

export interface LineageRead<T> {
  // The answer for what is asked; null while it is read, or when the read failed.
  answer: T | null;
  error: string | null;
  isLoading: boolean;
  // Reads it again: Refresh after a read that failed.
  retry: () => void;
}

/*
 * One read of a drawing, for what `key` names: read again whenever the key
 * changes, and an answer for an older key never shown. A read that fails
 * says why, or `failedText` when the error says nothing.
 */
export function useLineageRead<T>(
  key: string,
  read: () => Promise<T>,
  failedText: string,
): LineageRead<T> {
  const translator: Translator = useTranslator();
  const [readCount, setReadCount] = useState<number>(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    answer: T | null;
    error: string | null;
  } | null>(null);
  const readKey: string = `${key}:${readCount}`;

  useEffect(() => {
    let isCurrent: boolean = true;

    read()
      .then((answer: T): void => {
        if (isCurrent) {
          setLoaded({ key: readKey, answer, error: null });
        }
      })
      .catch((error: Error): void => {
        if (isCurrent) {
          setLoaded({
            key: readKey,
            answer: null,
            error:
              error.message ||
              translator.translateText(failedText) ||
              failedText,
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readKey]);

  // What is on screen: the read for what is asked, else nothing yet.
  const current: { answer: T | null; error: string | null } | null =
    loaded && loaded.key === readKey ? loaded : null;

  return {
    answer: current?.answer ?? null,
    error: current?.error ?? null,
    isLoading: !current,
    retry: (): void => {
      setReadCount((count: number): number => {
        return count + 1;
      });
    },
  };
}

// The steps each way a drawing walks, for the card's header.
export const LineageStepSwitch: FunctionComponent<{
  depth: number;
  onChange: (depth: number) => void;
}> = (props: {
  depth: number;
  onChange: (depth: number) => void;
}): ReactElement => {
  return (
    <ViewSwitch<string>
      options={LINEAGE_DEPTH_OPTIONS}
      value={props.depth.toString()}
      onChange={(value: string): void => {
        props.onChange(Number(value));
      }}
      ariaLabel={translationKey("Steps shown each way")}
      dataTestId="lineage-depth"
    />
  );
};

interface SummaryFact {
  key: string;
  text: string;
  isProblem: boolean;
}

export interface LineageDiagramBodyProps {
  lineage: DataTableLineage;
  place: LineagePlace;
  /*
   * Read with the columns its arrows carry (a table's Lineage tab): the
   * tables drawn here come with theirs, and a column can be followed.
   */
  withColumns?: boolean | undefined;
  // The table's columns in its own order: the order the column picker offers them in.
  columnOrder?: ReadonlyArray<string> | undefined;
  /*
   * The column followed when the drawing opens - on an alert's page, the
   * column its check reads - while an arrow names it. The reader may pick
   * another, or clear it.
   */
  initialColumn?: string | null | undefined;
}

// The column picked, and the opening column it was picked over: another opening column starts again from it.
interface PickedColumn {
  initialColumn: string | null;
  column: string | null;
}

// A drawing grown here: what it grew from, so a new read leaves it behind.
interface GrownLineage {
  base: DataTableLineage;
  lineage: DataTableLineage;
  growth: LineageGrowth;
}

// A sentence above the drawing about what it picks out, after the highlight's own mark when it says so.
const HighlightNote: FunctionComponent<{
  text: string;
  isHighlighted: boolean;
}> = (props: { text: string; isHighlighted: boolean }): ReactElement => {
  return (
    <p className="flex items-start gap-2">
      {props.isHighlighted ? (
        <span
          className="flex h-5 w-7 shrink-0 items-center"
          data-testid="lineage-highlight-mark"
        >
          <LineageHighlightSwatch />
        </span>
      ) : (
        <span aria-hidden="true" className="w-7 shrink-0" />
      )}
      <span>{props.text}</span>
    </p>
  );
};

/*
 * What lies each way - for a pipeline, how many tables it reads and writes
 * - and where the problems are; the drawing and its legend; and notes when
 * the drawing could not hold it all.
 */
export const LineageDiagramBody: FunctionComponent<LineageDiagramBodyProps> = (
  props: LineageDiagramBodyProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const withColumns: boolean = Boolean(props.withColumns);
  const [grown, setGrown] = useState<GrownLineage | null>(null);
  const [resetCount, setResetCount] = useState<number>(0);
  const [expanding, setExpanding] = useState<LineageExpanding | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const initialColumn: string | null = props.initialColumn || null;
  const [picked, setPicked] = useState<PickedColumn>({
    initialColumn,
    column: initialColumn,
  });
  const column: string | null =
    picked.initialColumn === initialColumn ? picked.column : initialColumn;
  // What is drawn: grown here from this read, or the read as it came.
  const lineage: DataTableLineage =
    grown && grown.base === props.lineage ? grown.lineage : props.lineage;
  const baseRef: MutableRefObject<DataTableLineage> = useRef<DataTableLineage>(
    props.lineage,
  );
  const shownRef: MutableRefObject<DataTableLineage> =
    useRef<DataTableLineage>(lineage);
  const isExpandingRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const figureRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  baseRef.current = props.lineage;
  shownRef.current = lineage;

  /*
   * Reset diagram goes once it is pressed, and the browser moves the focus
   * it had to the page itself: the drawing takes it, so the keyboard's
   * place is kept beside what was reset.
   */
  useEffect(() => {
    if (resetCount > 0 && isLineageFocusLost()) {
      figureRef.current?.focus({ preventScroll: true });
    }
  }, [resetCount]);

  // A new read: what was drawn on the old one, and a draw still on its way, are left behind.
  useEffect(() => {
    setGrown(null);
    setExpanding(null);
    setDrawError(null);
    isExpandingRef.current = false;
  }, [props.lineage]);

  const expand: (nodeId: string, side: DataLineageSide) => void = useCallback(
    (nodeId: string, side: DataLineageSide): void => {
      if (isExpandingRef.current) {
        return;
      }

      const base: DataTableLineage = baseRef.current;
      const shown: DataTableLineage = shownRef.current;

      isExpandingRef.current = true;
      setExpanding({ nodeId, side });
      setDrawError(null);

      DataObservabilityApi.expandLineage(
        getLineageExpandRequest({ lineage: shown, nodeId, side, withColumns }),
      )
        .then((expansion: DataLineageExpansion): void => {
          if (baseRef.current !== base) {
            return;
          }

          const merged: DataTableLineage = mergeLineageExpansion(
            shown,
            expansion,
          );
          const before: Set<string> = new Set(
            shown.nodes.map((node: DataTableLineageNode): string => {
              return node.id;
            }),
          );

          setGrown((previous: GrownLineage | null): GrownLineage => {
            return {
              base,
              lineage: merged,
              growth: {
                key: (previous?.growth.key || 0) + 1,
                nodeId,
                newNodeIds: merged.nodes
                  .map((node: DataTableLineageNode): string => {
                    return node.id;
                  })
                  .filter((id: string): boolean => {
                    return !before.has(id);
                  }),
              },
            };
          });
        })
        .catch((error: Error): void => {
          if (baseRef.current === base) {
            setDrawError(
              error?.message || translator.translateText(DRAW_FAILED) || "",
            );
          }
        })
        .finally((): void => {
          if (baseRef.current === base) {
            isExpandingRef.current = false;
            setExpanding(null);
          }
        });
    },
    [withColumns, translator.language],
  );

  const reset: () => void = (): void => {
    setGrown(null);
    setDrawError(null);
    setResetCount((count: number): number => {
      return count + 1;
    });
  };

  // The table's columns its arrows name, and the one followed while it is still one of them.
  const columnChoices: Array<string> = useMemo((): Array<string> => {
    return withColumns
      ? getLineageColumnChoices(lineage, props.columnOrder || [])
      : [];
  }, [withColumns, lineage, props.columnOrder]);
  const followed: string | null =
    column &&
    columnChoices.some((choice: string): boolean => {
      return choice.toLowerCase() === column.toLowerCase();
    })
      ? column
      : null;
  const columnTrail: LineageColumnTrail | null =
    useMemo((): LineageColumnTrail | null => {
      return followed ? followLineageColumn(lineage, followed) : null;
    }, [lineage, followed]);
  const columnOptions: Array<DropdownOption> = columnChoices.map(
    (choice: string): DropdownOption => {
      return { value: choice, label: choice, isUserContent: true };
    },
  );
  const isGrown: boolean = Boolean(grown && grown.base === props.lineage);
  const summary: LineageSummary = summarizeLineage(lineage);
  const pipelineTables: { reads: number; writes: number } | null =
    isLineagePipelineNodeId(lineage.focusNodeId)
      ? countPipelineTables(lineage)
      : null;

  const facts: Array<SummaryFact> = [
    pipelineTables
      ? {
          key: "reads",
          text: translator.translatePlural(
            PIPELINE_READS,
            pipelineTables.reads,
          ),
          isProblem: false,
        }
      : {
          key: "upstream",
          text: translator.translatePlural(
            UPSTREAM_TABLES,
            summary.upstreamTables,
          ),
          isProblem: false,
        },
    ...(summary.upstreamProblems > 0
      ? [
          {
            key: "upstream-problems",
            text: translator.translatePlural(
              UPSTREAM_PROBLEMS,
              summary.upstreamProblems,
            ),
            isProblem: true,
          },
        ]
      : []),
    pipelineTables
      ? {
          key: "writes",
          text: translator.translatePlural(
            PIPELINE_WRITES,
            pipelineTables.writes,
          ),
          isProblem: false,
        }
      : {
          key: "downstream",
          text: translator.translatePlural(
            DOWNSTREAM_TABLES,
            summary.downstreamTables,
          ),
          isProblem: false,
        },
    ...(summary.downstreamProblems > 0
      ? [
          {
            key: "downstream-problems",
            text: translator.translatePlural(
              DOWNSTREAM_PROBLEMS,
              summary.downstreamProblems,
            ),
            isProblem: true,
          },
        ]
      : []),
    ...(summary.dashboards > 0
      ? [
          {
            key: "dashboards",
            text: translator.translatePlural(DASHBOARDS, summary.dashboards),
            isProblem: false,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          data-testid="lineage-summary"
        >
          {facts.map((fact: SummaryFact): ReactElement => {
            return (
              <li
                key={fact.key}
                className={
                  fact.isProblem ? "font-medium text-red-600" : "text-gray-700"
                }
              >
                {fact.text}
              </li>
            );
          })}
        </ul>
        {columnOptions.length > 0 || isGrown ? (
          <div className="flex flex-wrap items-center gap-2">
            {columnOptions.length > 0 ? (
              <div className="w-56 max-w-full" data-testid="lineage-column">
                <Dropdown
                  options={columnOptions}
                  value={columnOptions.find((option: DropdownOption) => {
                    return option.value === followed;
                  })}
                  placeholder={translationKey("Follow a column")}
                  ariaLabel={translationKey("Column to follow")}
                  isClearable={true}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ): void => {
                    setPicked({
                      initialColumn,
                      column: typeof value === "string" && value ? value : null,
                    });
                  }}
                  dataTestId="lineage-column-picker"
                />
              </div>
            ) : (
              <></>
            )}
            {isGrown ? (
              <Button
                title="Reset diagram"
                icon={IconProp.ArrowUturnLeft}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                disabled={Boolean(expanding)}
                onClick={reset}
                dataTestId="lineage-reset"
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
      {columnTrail ? (
        <div
          className="space-y-1 text-sm text-gray-700"
          data-testid="lineage-column-notes"
        >
          <HighlightNote
            text={translator.translateTemplate(
              COLUMN_FOLLOWED,
              { column: columnTrail.column },
              // A column's name in Latin letters keeps its place in a sentence read right to left.
              { setsValuesApart: true },
            )}
            isHighlighted={true}
          />
          {columnTrail.mayGoFurther ? (
            <HighlightNote
              text={
                translator.translateText(COLUMN_MAY_GO_FURTHER) ||
                COLUMN_MAY_GO_FURTHER
              }
              isHighlighted={false}
            />
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {/*
       * Over the drawing, where the count pressed is: under its legend it
       * was below the fold of a tall drawing, out of sight of the press.
       */}
      {drawError ? (
        <div
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          data-testid="lineage-draw-error"
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="min-w-0 break-words">{drawError}</span>
        </div>
      ) : (
        <></>
      )}
      <LineageGraph
        lineage={lineage}
        place={props.place}
        drawingKey={`${props.lineage.focusNodeId}:${props.lineage.depth}:${props.lineage.nodes.length}:${resetCount}`}
        onExpand={expand}
        expanding={expanding}
        growth={isGrown ? grown!.growth : null}
        columnTrail={columnTrail}
        figureRef={figureRef}
      />
      <LineageLegend />
      {lineage.isTruncated || lineage.hiddenDashboardCount > 0 ? (
        <div
          className="space-y-1 text-xs text-gray-500"
          data-testid="lineage-notes"
        >
          {lineage.isTruncated ? (
            <p>
              {translator.translateText(
                "This lineage is larger than one diagram holds: the nearest tables are drawn, problems first. Open a table to center the diagram on it.",
              )}
            </p>
          ) : (
            <></>
          )}
          {lineage.hiddenDashboardCount > 0 ? (
            <p>
              {translator.translatePlural(
                HIDDEN_DASHBOARDS,
                lineage.hiddenDashboardCount,
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};
