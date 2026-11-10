import DataObservabilityApi from "./DataObservabilityApi";
import LineageGraph, { LineageLegend } from "./LineageGraph";
import {
  LineageSummary,
  isLineageEmpty,
  summarizeLineage,
} from "./LineageGraphModel";
import {
  DATA_LINEAGE_DEPTH_CHOICES,
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataTableLineage,
} from "Common/Types/DataObservability/DataTableLineage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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

export interface ComponentProps {
  dataAssetId: ObjectID;
}

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

// The read the card shows, stamped with what it was read for.
interface LoadedLineage {
  key: string;
  lineage: DataTableLineage | null;
  error: string | null;
}

/*
 * A table's lineage as a diagram, at the top of its Lineage tab: what it is
 * built from on the left, what is built from it on the right, three steps
 * each way unless the reader picks another number, with how each table
 * and pipeline is now. The lists under it still say every edge one step
 * away, and where each was seen.
 */
const TableLineageDiagram: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [depth, setDepth] = useState<number>(DEFAULT_DATA_LINEAGE_DEPTH);
  const [readCount, setReadCount] = useState<number>(0);
  const [loaded, setLoaded] = useState<LoadedLineage | null>(null);
  const key: string = `${props.dataAssetId.toString()}:${depth}:${readCount}`;

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getTableLineage(props.dataAssetId, depth)
      .then((lineage: DataTableLineage): void => {
        if (isCurrent) {
          setLoaded({ key, lineage, error: null });
        }
      })
      .catch((error: Error): void => {
        if (isCurrent) {
          setLoaded({
            key,
            lineage: null,
            error:
              error.message ||
              translator.translateText("Could not read this table's lineage."),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [key]);

  // What is on screen: the read for what is asked, else nothing yet.
  const current: LoadedLineage | null =
    loaded && loaded.key === key ? loaded : null;

  const stepSwitch: ReactElement = (
    <ViewSwitch<string>
      options={LINEAGE_DEPTH_OPTIONS}
      value={depth.toString()}
      onChange={(value: string): void => {
        setDepth(Number(value));
      }}
      ariaLabel={translationKey("Steps shown each way")}
      dataTestId="lineage-depth"
    />
  );

  let body: ReactElement;

  if (!current) {
    body = <ComponentLoader />;
  } else if (current.error || !current.lineage) {
    body = (
      <ErrorMessage
        message={current.error || ""}
        onRefreshClick={(): void => {
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (isLineageEmpty(current.lineage)) {
    body = (
      <p className="text-sm text-gray-500" data-testid="lineage-empty">
        {translator.translateText(
          "No lineage has been seen for this table yet. It comes from OpenLineage events, dbt, Fivetran and Airbyte syncs, jobs in your traces, views and each database's query history.",
        )}
      </p>
    );
  } else {
    const lineage: DataTableLineage = current.lineage;
    const summary: LineageSummary = summarizeLineage(lineage);
    const facts: Array<{ key: string; text: string; isProblem: boolean }> = [
      {
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
      {
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

    body = (
      <div className="space-y-3">
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          data-testid="lineage-summary"
        >
          {facts.map(
            (fact: {
              key: string;
              text: string;
              isProblem: boolean;
            }): ReactElement => {
              return (
                <li
                  key={fact.key}
                  className={
                    fact.isProblem
                      ? "font-medium text-red-600"
                      : "text-gray-700"
                  }
                >
                  {fact.text}
                </li>
              );
            },
          )}
        </ul>
        <LineageGraph lineage={lineage} />
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
  }

  return (
    <Card
      title="Lineage"
      description="Where this table's data comes from and where it goes, a few steps each way, with how each table and pipeline is now. Open a table to center the diagram on it."
      rightElement={stepSwitch}
    >
      <div className="px-6 pb-6" data-testid="table-lineage-diagram">
        {body}
      </div>
    </Card>
  );
};

export default TableLineageDiagram;
