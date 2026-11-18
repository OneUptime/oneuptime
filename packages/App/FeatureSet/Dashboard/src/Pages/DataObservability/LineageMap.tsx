import PageComponentProps from "../PageComponentProps";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import {
  LineageRead,
  useLineageRead,
} from "../../Components/DataObservability/LineageDiagram";
import {
  LineageTone,
  getLineageToneColor,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_READS_COLOR,
  LINEAGE_VIEW_DEFINITION_DASH,
} from "../../Components/DataObservability/LineageGraphModel";
import LineageMapDetails from "../../Components/DataObservability/LineageMapDetails";
import LineageMapGraph, {
  LINEAGE_MAP_TRACES_COLOR,
} from "../../Components/DataObservability/LineageMapGraph";
import LineageMapList from "../../Components/DataObservability/LineageMapList";
import {
  LINEAGE_MAP_HIDEABLE_KINDS,
  LineageMapFilter,
  countLineageMapKinds,
  filterLineageMap,
  isLineageMapEmpty,
} from "../../Components/DataObservability/LineageMapModel";
import {
  KIND_COUNTS,
  KIND_SWITCH_LABELS,
} from "../../Components/DataObservability/LineageMapWords";
import URL from "Common/Types/API/URL";
import {
  DataLineageMap,
  DataLineageMapNode,
  DataLineageMapNodeKind,
  DataLineageMapTrace,
  traceDataLineageMap,
} from "Common/Types/DataObservability/DataLineageMap";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { HelpContent } from "Common/UI/Components/Help/HelpContent";
import HelpModal from "Common/UI/Components/Help/HelpModal";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import ViewSwitch, {
  ViewSwitchOption,
} from "Common/UI/Components/ViewSwitch/ViewSwitch";
import { DOCS_URL } from "Common/UI/Config";
import {
  Translator,
  formatInline,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * THE LINEAGE MAP (#9114): every flow of data the project has seen, on one
 * page - which services write and read which tables, what each table is
 * built from, the pipelines that load them and the dashboards built on
 * them - so a person can see who uses what data and where it flows without
 * knowing which table to start from.
 *
 * Every arrow is a fact OneUptime recorded (Types/DataObservability/
 * DataLineageMap says which), drawn as an interactive map on a wide screen
 * and as a list on a phone, either a switch away. A search keeps the cards
 * it matches and everything upstream and downstream of them; the switches
 * leave services, pipelines or dashboards off; selecting a card picks out
 * its whole lineage and says what it is, with its page one click away.
 */

export const LINEAGE_MAP_DOCS_URL: URL = URL.fromString(
  `${DOCS_URL.toString()}/data-observability/lineage-and-pipelines`,
);

enum LineageMapView {
  Map = "map",
  List = "list",
}

const VIEW_OPTIONS: ReadonlyArray<ViewSwitchOption<LineageMapView>> = [
  {
    value: LineageMapView.Map,
    label: translationKey("Map"),
    icon: IconProp.FlowDiagram,
  },
  {
    value: LineageMapView.List,
    label: translationKey("List"),
    icon: IconProp.List,
  },
];

const READ_FAILED: string = translationKey("Could not read the lineage map.");
const NOTHING_MATCHES: string = translationKey(
  "Nothing on the map matches your search.",
);
const TRUNCATED: string = translationKey(
  "Your project has more flows than one map draws, so the most recently seen are drawn. Search to find a table.",
);

// A phone opens on the list: a map needs room to be read.
const PHONE_QUERY: string = "(max-width: 767px)";

function isPhoneWidth(): boolean {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
}

const LineageMapHelp: FunctionComponent<{
  helpContent: HelpContent;
}> = (props: { helpContent: HelpContent }): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      <Button
        title="How It Works"
        icon={IconProp.Help}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        dataTestId="lineage-map-help"
        onClick={(): void => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <HelpModal
          title={props.helpContent.title}
          description={props.helpContent.description}
          markdown={props.helpContent.markdown}
          documentationLink={LINEAGE_MAP_DOCS_URL}
          onClose={(): void => {
            setIsOpen(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

// What the map's lines and card edges mean.
const LineageMapLegend: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const line: (
    key: string,
    color: string,
    text: string,
    dash?: string,
  ) => ReactElement = (
    key: string,
    color: string,
    text: string,
    dash?: string,
  ): ReactElement => {
    return (
      <span key={key} className="inline-flex items-center gap-1.5">
        <svg width="28" height="10" aria-hidden="true" className="shrink-0">
          <line
            x1="1"
            y1="5"
            x2="27"
            y2="5"
            stroke={color}
            strokeWidth={1.75}
            {...(dash ? { strokeDasharray: dash } : {})}
          />
        </svg>
        <span>{translator.translateText(text)}</span>
      </span>
    );
  };
  const swatch: (key: string, color: string, text: string) => ReactElement = (
    key: string,
    color: string,
    text: string,
  ): ReactElement => {
    return (
      <span key={key} className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-4 shrink-0 rounded-sm bg-white"
          style={{
            border: "1px solid #e2e8f0",
            borderTop: `3px solid ${color}`,
          }}
        />
        <span>{translator.translateText(text)}</span>
      </span>
    );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500"
      data-testid="lineage-map-legend"
    >
      {line("pipeline", LINEAGE_NEUTRAL_COLOR, translationKey("Pipeline run"))}
      {line(
        "query",
        LINEAGE_NEUTRAL_COLOR,
        translationKey("Query history"),
        LINEAGE_QUERY_HISTORY_DASH,
      )}
      {line(
        "view",
        LINEAGE_NEUTRAL_COLOR,
        translationKey("View definition"),
        LINEAGE_VIEW_DEFINITION_DASH,
      )}
      {line(
        "traces",
        LINEAGE_MAP_TRACES_COLOR,
        translationKey("Seen in traces"),
      )}
      {line("bi", LINEAGE_READS_COLOR, translationKey("Read by a dashboard"))}
      {line(
        "failed",
        LINEAGE_PROBLEM_COLOR,
        translationKey("Latest run failed"),
      )}
      {swatch(
        "problem",
        getLineageToneColor(LineageTone.Problem),
        translationKey("Late, open alert or failed run"),
      )}
      {swatch(
        "healthy",
        getLineageToneColor(LineageTone.Healthy),
        translationKey("Fresh or last run complete"),
      )}
    </div>
  );
};

// What the map is waiting for: where lineage comes from, and the guide to send it.
const LineageMapEmpty: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const sources: Array<string> = [
    translationKey(
      "Services in your traces: their database spans say which tables they read and write.",
    ),
    translationKey(
      "Pipelines: OpenLineage events, dbt artifacts, Fivetran and Airbyte syncs, and jobs in your traces.",
    ),
    translationKey(
      "Your databases: views, and the query history of Snowflake, BigQuery, Redshift, ClickHouse and Databricks.",
    ),
    translationKey("BI tools: the dashboards built on each table."),
  ];

  return (
    <EmptyState
      id="lineage-map-empty"
      icon={IconProp.FlowDiagram}
      title={translationKey("No lineage yet")}
      description={translationKey(
        "The map draws where your data flows as soon as OneUptime sees it, from any of these:",
      )}
      footer={
        <div className="mx-auto mt-4 max-w-xl text-start">
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-gray-600">
            {sources.map((source: string): ReactElement => {
              return <li key={source}>{translator.translateText(source)}</li>;
            })}
          </ul>
          <div className="mt-5 flex justify-center">
            <Link
              to={LINEAGE_MAP_DOCS_URL}
              openInNewTab={true}
              className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-base font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:text-sm"
              dataTestId="lineage-map-empty-docs"
            >
              <span>
                {translator.translateText("Read How Lineage Is Gathered")}
              </span>
            </Link>
          </div>
        </div>
      }
    />
  );
};

const DataObservabilityLineageMapPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const read: LineageRead<DataLineageMap> = useLineageRead<DataLineageMap>(
    "lineage-map",
    (): Promise<DataLineageMap> => {
      return DataObservabilityApi.getLineageMap();
    },
    READ_FAILED,
  );
  const [view, setView] = useState<LineageMapView>(
    isPhoneWidth() ? LineageMapView.List : LineageMapView.Map,
  );
  const [search, setSearch] = useState<string>("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<DataLineageMapNodeKind>>(
    new Set(),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isShowingOnlyItsLineage, setIsShowingOnlyItsLineage] =
    useState<boolean>(false);

  const filter: LineageMapFilter = useMemo((): LineageMapFilter => {
    return {
      search,
      hiddenKinds,
      focusNodeId: isShowingOnlyItsLineage ? selectedNodeId : null,
    };
  }, [search, hiddenKinds, isShowingOnlyItsLineage, selectedNodeId]);

  const visible: DataLineageMap | null = useMemo(() => {
    return read.answer ? filterLineageMap(read.answer, filter) : null;
  }, [read.answer, filter]);

  const selectedNode: DataLineageMapNode | null =
    (selectedNodeId &&
      visible?.nodes.find((node: DataLineageMapNode): boolean => {
        return node.id === selectedNodeId;
      })) ||
    null;

  // A card a search or a switch took off the map is no longer selected.
  useEffect(() => {
    if (selectedNodeId && visible && !selectedNode) {
      setSelectedNodeId(null);
      setIsShowingOnlyItsLineage(false);
    }
  }, [selectedNodeId, visible, selectedNode]);

  const trace: DataLineageMapTrace | null = useMemo(() => {
    return selectedNode && visible
      ? traceDataLineageMap(visible, selectedNode.id)
      : null;
  }, [selectedNode, visible]);

  const select: (nodeId: string | null) => void = useCallback(
    (nodeId: string | null): void => {
      setSelectedNodeId(nodeId);

      if (!nodeId) {
        setIsShowingOnlyItsLineage(false);
      }
    },
    [],
  );

  let body: ReactElement;

  if (read.isLoading) {
    body = <ChartSkeleton hasLegend={false} />;
  } else if (read.error || !read.answer || !visible) {
    body = (
      <ErrorMessage message={read.error || ""} onRefreshClick={read.retry} />
    );
  } else if (isLineageMapEmpty(read.answer)) {
    body = <LineageMapEmpty />;
  } else {
    const counts: Record<DataLineageMapNodeKind, number> = countLineageMapKinds(
      read.answer,
    );
    const shownCounts: Record<DataLineageMapNodeKind, number> =
      countLineageMapKinds(visible);
    /*
     * The selected card's facts: under the map, so selecting a card never
     * moves the map under the pointer; over the list, where it is read.
     */
    const details: ReactElement =
      selectedNode && trace ? (
        <LineageMapDetails
          node={selectedNode}
          map={visible}
          trace={trace}
          isShowingOnlyItsLineage={isShowingOnlyItsLineage}
          onShowOnlyItsLineage={setIsShowingOnlyItsLineage}
          onSelect={select}
        />
      ) : (
        <></>
      );

    body = (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full md:max-w-sm">
            <Input
              isSearchOrFilter={true}
              value={search}
              onChange={(value: string): void => {
                setSearch(value);
              }}
              placeholder={translationKey(
                "Search tables, services, pipelines and dashboards",
              )}
              ariaLabel={translator.translateText("Search the lineage map")}
              dataTestId="lineage-map-search"
              disableSpellCheck={true}
            />
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={translator.translateText("Show on the map")}
          >
            {LINEAGE_MAP_HIDEABLE_KINDS.filter(
              (kind: DataLineageMapNodeKind): boolean => {
                return counts[kind] > 0;
              },
            ).map((kind: DataLineageMapNodeKind): ReactElement => {
              const isShown: boolean = !hiddenKinds.has(kind);

              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={isShown}
                  data-testid={`lineage-map-kind-${kind}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isShown
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-500 line-through"
                  }`}
                  onClick={(): void => {
                    const next: Set<DataLineageMapNodeKind> = new Set(
                      hiddenKinds,
                    );

                    if (isShown) {
                      next.add(kind);
                    } else {
                      next.delete(kind);
                    }

                    setHiddenKinds(next);
                  }}
                >
                  {translator.translateText(KIND_SWITCH_LABELS[kind] || "")}
                  <span className="tabular-nums">
                    {translator.formatNumber(counts[kind])}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-sm text-gray-500" data-testid="lineage-map-summary">
          {formatInline(
            (
              [
                DataLineageMapNodeKind.Table,
                DataLineageMapNodeKind.Service,
                DataLineageMapNodeKind.Pipeline,
                DataLineageMapNodeKind.Dashboard,
              ] as Array<DataLineageMapNodeKind>
            )
              .filter((kind: DataLineageMapNodeKind): boolean => {
                return shownCounts[kind] > 0;
              })
              .map((kind: DataLineageMapNodeKind): string => {
                return translator.translatePlural(
                  KIND_COUNTS[kind],
                  shownCounts[kind],
                );
              }),
            translator,
          )}
        </p>

        {read.answer.isTruncated ? (
          <p
            className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600"
            data-testid="lineage-map-truncated"
          >
            {translator.translateText(TRUNCATED)}
          </p>
        ) : (
          <></>
        )}

        {view === LineageMapView.List ? details : <></>}

        {visible.nodes.length === 0 ? (
          <p
            className="py-10 text-center text-sm text-gray-500"
            data-testid="lineage-map-no-match"
          >
            {translator.translateText(NOTHING_MATCHES)}
          </p>
        ) : view === LineageMapView.Map ? (
          <div className="space-y-3">
            <LineageMapGraph
              map={visible}
              selectedNodeId={selectedNode?.id || null}
              trace={trace}
              onSelect={select}
            />
            <LineageMapLegend />
            {details}
          </div>
        ) : (
          <LineageMapList
            map={visible}
            selectedNodeId={selectedNode?.id || null}
            onSelect={select}
          />
        )}
      </div>
    );
  }

  const hasMap: boolean = Boolean(
    read.answer && !isLineageMapEmpty(read.answer),
  );

  return (
    <Card
      title="Lineage Map"
      headerLayout="toolbar"
      description="Which services, pipelines, tables and dashboards write and read your data, and where it flows. Select a card to follow its lineage."
      rightElement={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <LineageMapHelp
            helpContent={{
              title: "How the Lineage Map Works",
              description:
                "Who writes and reads your data, and where it flows.",
              markdown: `The Lineage Map draws every flow of data OneUptime has seen in your project: which services write and read which tables, what each table is built from, the pipelines that load them and the dashboards built on them. Every arrow is something OneUptime recorded, never a guess.

## Follow a Table's Lineage

Search for a table, service, pipeline or dashboard: the map keeps what matches and everything upstream and downstream of it. Select a card to pick out its whole lineage, see what feeds it and what reads it, and open its page. **Show Only Its Lineage** leaves only that card's lineage on the map. The switches beside the search leave services, pipelines or dashboards off the map.

## Where Lineage Comes From

- **Services:** the database spans in your traces name the table and the statement, so a service is drawn writing the tables it inserts into or updates and reading the tables it selects from.
- **Pipelines:** OpenLineage events, dbt artifacts, Fivetran and Airbyte syncs, and scheduled jobs in your traces say which tables each run read and wrote.
- **Databases:** a view is built from the tables it is defined on, and the query history of Snowflake, BigQuery, Redshift, ClickHouse and Databricks shows queries that read one table and wrote another.
- **BI tools:** each dashboard is drawn reading the tables it is built on.

## Reading the Map

Cards sit left to right as data flows. A card's top edge is red for a table that is late or has an open alert, or a pipeline whose latest run failed, and green when it is fresh. A solid arrow was seen in a pipeline's run, a dashed one only in query history, a dotted one in a view's definition, and a teal one in a service's traces. An arrow turns red when the pipeline that moves its data failed its latest run.

## Large Projects

One map draws up to 400 cards, the most recently seen flows first. When your project has more, the map says so: search to find the table you are after.`,
            }}
          />
          {hasMap ? (
            <ViewSwitch<LineageMapView>
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
              ariaLabel={translationKey("Show the lineage as")}
              dataTestId="lineage-map-view"
            />
          ) : (
            <></>
          )}
        </div>
      }
    >
      <div data-testid="lineage-map-page">{body}</div>
    </Card>
  );
};

export default DataObservabilityLineageMapPage;
