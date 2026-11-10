import LineageGraph, { LineageLegend } from "./LineageGraph";
import {
  LineagePlace,
  LineageSummary,
  countPipelineTables,
  summarizeLineage,
} from "./LineageGraphModel";
import {
  DATA_LINEAGE_DEPTH_CHOICES,
  DataTableLineage,
  isLineagePipelineNodeId,
} from "Common/Types/DataObservability/DataTableLineage";
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
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT EVERY LINEAGE DIAGRAM SHARES: a table's (TableLineageDiagram), a
 * pipeline's (PipelineLineageDiagram) and a data alert's
 * (AlertLineageDiagram). The read, stamped with what it was read for, so an
 * answer for something no longer asked for never replaces the one that
 * is; the steps switch; and under the card's header, what lies each way,
 * the drawing, its legend, and notes when it could not hold it all.
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
}

/*
 * What lies each way - for a pipeline, how many tables it reads and writes
 * - and where the problems are; the drawing and its legend; and notes when
 * the drawing could not hold it all.
 */
export const LineageDiagramBody: FunctionComponent<LineageDiagramBodyProps> = (
  props: LineageDiagramBodyProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const lineage: DataTableLineage = props.lineage;
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
      <LineageGraph lineage={lineage} place={props.place} />
      <LineageLegend hasHighlight={Boolean(lineage.highlight)} />
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
