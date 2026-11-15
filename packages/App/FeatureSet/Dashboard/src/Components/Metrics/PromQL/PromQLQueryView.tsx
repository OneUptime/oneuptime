import React, {
  FunctionComponent,
  KeyboardEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { translateCreateAction } from "Common/UI/Components/ModelTable/BaseModelTable";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { DOCS_URL } from "Common/UI/Config";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import { MetricChartType } from "Common/Types/Metrics/MetricQueryConfigData";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import { translationKey } from "Common/Types/Translator";
import { formatPromQLLabels } from "Common/Utils/PromQL/PromQLLabels";
import {
  PrometheusPoint,
  PrometheusResult,
  PrometheusSeries,
} from "Common/Utils/PromQL/PrometheusResponse";
import MetricCharts from "../MetricCharts";
import PromQLQueryUtil from "../../../Utils/PromQLQuery";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";

/*
 * The Metrics page's PromQL tab (issue #6796): write a PromQL query over
 * the project's metrics, run it, and see it as a chart or a table. It asks
 * the same Prometheus-compatible API Grafana reads, and the last card says
 * how to point Grafana at it.
 */

export enum PromQLResultView {
  Graph = "graph",
  Table = "table",
}

export interface PromQLExample {
  title: string;
  query: string;
}

// Queries that show the shape of the language, one click to try.
export const PROMQL_EXAMPLES: ReadonlyArray<PromQLExample> = [
  {
    title: translationKey("Per-second rate of a counter"),
    query: "rate(http_requests_total[5m])",
  },
  {
    title: translationKey("Total by a label"),
    query: "sum by (job) (rate(http_requests_total[5m]))",
  },
  {
    title: translationKey("95th percentile of a histogram"),
    query:
      "histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_bucket[5m])))",
  },
  {
    title: translationKey("Top 5 series"),
    query: "topk(5, system_memory_usage)",
  },
];

export const PROMQL_QUERY_EDITOR_TEST_ID: string = "promql-query-editor";
export const PROMQL_RUN_BUTTON_TEST_ID: string = "promql-run-query";
export const PROMQL_RESULT_TEST_ID: string = "promql-result";
export const PROMQL_ERROR_TEST_ID: string = "promql-error";
export const PROMQL_SERVER_URL_TEST_ID: string = "promql-server-url";

const PROMQL_DOCS_PATH: string = "/telemetry/promql";

/*
 * The editor is a text field set in a code face: the field's own look, with
 * monospace text and a quiet fill until it is focused.
 */
const PROMQL_EDITOR_CLASS_NAME: string =
  "block w-full resize-y rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 font-mono text-sm leading-6 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500";

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      // The query the result is for, as it was run.
      query: string;
      result: PrometheusResult;
      view: PromQLResultView;
      window: InBetween<Date>;
    };

// The series of a result, numbers only: a chart cannot draw NaN or Inf.
const drawableSeries: (result: PrometheusResult) => Array<PrometheusSeries> = (
  result: PrometheusResult,
): Array<PrometheusSeries> => {
  if (result.resultType === "scalar") {
    return [{ labels: {}, points: [result.value] }];
  }

  if (result.resultType === "string") {
    return [];
  }

  return result.series;
};

export interface ComponentProps {
  // The query the tab opens with: a link's ?query=, or none.
  initialQuery?: string | undefined;
}

const PromQLQueryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [query, setQuery] = useState<string>(
    props.initialQuery ?? (Navigation.getQueryStringByName("query") || ""),
  );
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });
  const [view, setView] = useState<PromQLResultView>(PromQLResultView.Graph);
  const [runState, setRunState] = useState<RunState>({ kind: "idle" });
  const [metricNames, setMetricNames] = useState<Array<string>>([]);
  // The query the result on screen is for, so a new window or view reruns it.
  const ranQueryRef: React.MutableRefObject<string | null> = useRef(null);
  const runSequenceRef: React.MutableRefObject<number> = useRef(0);

  useEffect(() => {
    PromQLQueryUtil.getMetricNames()
      .then((names: Array<string>) => {
        setMetricNames(names);
      })
      .catch(() => {
        // The metric picker is a help; the editor works without it.
        setMetricNames([]);
      });
  }, []);

  const run: (data: {
    queryText: string;
    resultView: PromQLResultView;
    range: RangeStartAndEndDateTime;
  }) => Promise<void> = useCallback(
    async (data: {
      queryText: string;
      resultView: PromQLResultView;
      range: RangeStartAndEndDateTime;
    }): Promise<void> => {
      const queryText: string = data.queryText.trim();

      if (!queryText) {
        setRunState({
          kind: "error",
          message:
            translator.translateText(
              "Write a PromQL query first, such as up or rate(http_requests_total[5m]).",
            ) ?? "",
        });
        return;
      }

      const sequence: number = ++runSequenceRef.current;
      const window: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(data.range);
      ranQueryRef.current = queryText;
      setRunState({ kind: "running" });

      try {
        const result: PrometheusResult =
          data.resultView === PromQLResultView.Graph
            ? await PromQLQueryUtil.queryRange({
                query: queryText,
                startDate: window.startValue,
                endDate: window.endValue,
              })
            : await PromQLQueryUtil.queryInstant({
                query: queryText,
                time: window.endValue,
              });

        // A slower, older run never overwrites a newer one.
        if (sequence !== runSequenceRef.current) {
          return;
        }

        setRunState({
          kind: "done",
          query: queryText,
          result,
          view: data.resultView,
          window,
        });
      } catch (error: unknown) {
        if (sequence !== runSequenceRef.current) {
          return;
        }

        setRunState({ kind: "error", message: API.getFriendlyMessage(error) });
      }
    },
    [translator],
  );

  const runCurrent: () => void = (): void => {
    void run({ queryText: query, resultView: view, range: timeRange });
  };

  const onEditorKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runCurrent();
    }
  };

  // A new view or window reruns the query on screen, not the draft.
  const rerun: (
    resultView: PromQLResultView,
    range: RangeStartAndEndDateTime,
  ) => void = (
    resultView: PromQLResultView,
    range: RangeStartAndEndDateTime,
  ): void => {
    if (ranQueryRef.current) {
      void run({ queryText: ranQueryRef.current, resultView, range });
    }
  };

  const metricOptions: Array<DropdownOption> = useMemo(() => {
    return metricNames.map((name: string): DropdownOption => {
      return { value: name, label: name };
    });
  }, [metricNames]);

  const onMetricPicked: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => void = (value: DropdownValue | Array<DropdownValue> | null): void => {
    if (typeof value !== "string" || !value) {
      return;
    }

    setQuery((current: string): string => {
      const trimmed: string = current.trimEnd();
      return trimmed ? `${trimmed} ${value}` : value;
    });
  };

  const prometheusServerUrl: string = PromQLQueryUtil.getPrometheusServerUrl();

  const docsUrl: string = `${DOCS_URL.toString()}${PROMQL_DOCS_PATH}`;

  return (
    <div className="space-y-5">
      <Card
        title={translator.translateText("PromQL Query")}
        description={translator.translateText(
          "Query your project's metrics with PromQL, the query language of Prometheus.",
        )}
        rightElement={
          <TelemetryTimeRangePicker
            value={timeRange}
            onChange={(next: RangeStartAndEndDateTime) => {
              setTimeRange(next);
              rerun(view, next);
            }}
          />
        }
      >
        <div className="space-y-3">
          <div onKeyDown={onEditorKeyDown}>
            <TextArea
              value={query}
              onChange={(value: string) => {
                setQuery(value);
              }}
              placeholder="sum by (job) (rate(http_requests_total[5m]))"
              className={PROMQL_EDITOR_CLASS_NAME}
              autoGrow={true}
              rows={3}
              maxRows={14}
              disableSpellCheck={true}
              readsLeftToRight={true}
              dataTestId={PROMQL_QUERY_EDITOR_TEST_ID}
              ariaLabelledby="promql-query-label"
            />
            <span id="promql-query-label" className="sr-only">
              {translator.translateText("PromQL Query")}
            </span>
          </div>

          {runState.kind === "error" && (
            <div
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
              data-testid={PROMQL_ERROR_TEST_ID}
            >
              <Icon icon={IconProp.Error} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <ErrorSentence
                  template="The query did not run. {{error}}"
                  error={runState.message}
                />
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {metricOptions.length > 0 && (
                <div className="w-64 max-w-full">
                  <Dropdown
                    options={metricOptions}
                    placeholder={translationKey("Add a metric name")}
                    ariaLabel={translationKey("Add a metric name")}
                    onChange={onMetricPicked}
                    value={undefined}
                  />
                </div>
              )}
              <span className="text-xs text-gray-500">
                {translator.translateText(
                  "Press Ctrl+Enter or ⌘+Enter to run the query.",
                )}
              </span>
            </div>
            <Button
              title={translator.translateText("Run Query")}
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.PRIMARY}
              isLoading={runState.kind === "running"}
              onClick={runCurrent}
              dataTestId={PROMQL_RUN_BUTTON_TEST_ID}
            />
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs font-medium text-gray-500">
              {translator.translateText("Examples")}
            </p>
            <div className="flex flex-wrap gap-2">
              {PROMQL_EXAMPLES.map((example: PromQLExample) => {
                return (
                  <button
                    key={example.query}
                    type="button"
                    title={example.query}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    onClick={() => {
                      setQuery(example.query);
                    }}
                  >
                    {translator.translateText(example.title)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={translator.translateText("Result")}
        description={translator.translateText(
          "The graph draws the query over the time range; the table shows its value at the end of it.",
        )}
        rightElement={
          <div
            className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm"
            role="group"
            aria-label={translator.translateText("Result view")}
          >
            {[
              {
                key: PromQLResultView.Graph,
                label: translationKey("Graph"),
                icon: IconProp.ChartBar,
              },
              {
                key: PromQLResultView.Table,
                label: translationKey("Table"),
                icon: IconProp.TableCells,
              },
            ].map(
              (option: {
                key: PromQLResultView;
                label: string;
                icon: IconProp;
              }) => {
                const isActive: boolean = view === option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setView(option.key);
                      rerun(option.key, timeRange);
                    }}
                  >
                    <Icon icon={option.icon} className="h-3.5 w-3.5" />
                    {translator.translateText(option.label)}
                  </button>
                );
              },
            )}
          </div>
        }
      >
        <div data-testid={PROMQL_RESULT_TEST_ID}>
          <PromQLResultBody runState={runState} />
        </div>
      </Card>

      <Card
        title={translator.translateText("Query From Grafana")}
        description={translator.translateText(
          "Add OneUptime as a Prometheus data source in Grafana, or in any tool that reads Prometheus.",
        )}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">
              {translator.translateText("Prometheus Server URL")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                className="rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-800"
                dir="ltr"
                data-testid={PROMQL_SERVER_URL_TEST_ID}
              >
                {prometheusServerUrl}
              </code>
              <CopyTextButton
                textToBeCopied={prometheusServerUrl}
                size="xs"
                variant="soft"
              />
            </div>
          </div>
          <p>
            {translator.translateText(
              "Sign in with a project API key that can read metrics: send it as a bearer token in the Authorization header, or as the basic auth password.",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
              )}
              className="font-medium text-indigo-600 hover:underline"
            >
              {translateCreateAction(translator, {
                verb: "Create",
                itemName: "API Key",
              })}
            </Link>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText("Read the PromQL Guide")}
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
};

interface ResultBodyProps {
  runState: RunState;
}

const EmptyResult: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
        <Icon icon={IconProp.ChartBar} className="h-5 w-5 text-gray-300" />
      </div>
      <p className="max-w-md text-sm text-gray-500">{props.text}</p>
    </div>
  );
};

const PromQLResultBody: FunctionComponent<ResultBodyProps> = (
  props: ResultBodyProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const runState: RunState = props.runState;

  if (runState.kind === "running") {
    return <ComponentLoader />;
  }

  if (runState.kind !== "done") {
    return (
      <EmptyResult
        text={
          translator.translateText(
            "Write a query and press Run Query to see its result here.",
          ) ?? ""
        }
      />
    );
  }

  const result: PrometheusResult = runState.result;

  if (result.resultType === "string") {
    return (
      <p className="font-mono text-sm text-gray-800" dir="ltr">
        {result.text}
      </p>
    );
  }

  const series: Array<PrometheusSeries> = drawableSeries(result);

  if (series.length === 0) {
    return (
      <EmptyResult
        text={
          translator.translateText(
            "No series matched this query in the time range.",
          ) ?? ""
        }
      />
    );
  }

  if (runState.view === PromQLResultView.Graph) {
    return (
      <PromQLGraph
        series={series}
        window={runState.window}
        query={runState.query}
      />
    );
  }

  return (
    <PromQLTable
      series={series}
      isRangeVector={result.resultType === "matrix"}
    />
  );
};

const PromQLGraph: FunctionComponent<{
  series: Array<PrometheusSeries>;
  window: InBetween<Date>;
  query: string;
}> = (props: {
  series: Array<PrometheusSeries>;
  window: InBetween<Date>;
  query: string;
}): ReactElement => {
  /*
   * The chart layer OneUptime's own metric charts use, through a query
   * config of its own: each point carries its series' labels, and the
   * series are named the way Prometheus names them.
   */
  const results: Array<AggregatedResult> = useMemo(() => {
    const data: Array<AggregatedModel> = [];

    for (const item of props.series) {
      const title: string = formatPromQLLabels(item.labels);

      for (const point of item.points) {
        if (!Number.isFinite(point.value)) {
          continue;
        }

        data.push({
          timestamp: new Date(point.timestampMs),
          value: point.value,
          promQLSeries: title,
        } as AggregatedModel);
      }
    }

    return [{ data }];
  }, [props.series]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: [
        {
          id: "promql",
          metricAliasData: {
            metricVariable: undefined,
            title: undefined,
            description: undefined,
            // The chart is named by the query it draws.
            legend: props.query,
            legendUnit: undefined,
          },
          metricQueryData: { filterData: {} },
          chartType: MetricChartType.LINE,
          getSeries: (dataPoint: AggregatedModel) => {
            return {
              title: String(
                (dataPoint as Record<string, unknown>)["promQLSeries"] || "{}",
              ),
            };
          },
        },
      ],
      formulaConfigs: [],
      startAndEndDate: props.window,
    };
  }, [props.window, props.query]);

  return (
    <MetricCharts
      metricResults={results}
      metricTypes={[]}
      metricViewData={metricViewData}
      hideCard={true}
      // The result card grows with the chart: a floor keeps the plot tall.
      minPlotHeight={true}
      topNOverrideScope="promql"
      enableSeriesActions={false}
      enableExemplarActions={false}
    />
  );
};

const lastPoint: (series: PrometheusSeries) => PrometheusPoint | undefined = (
  series: PrometheusSeries,
): PrometheusPoint | undefined => {
  return series.points[series.points.length - 1];
};

const PromQLTable: FunctionComponent<{
  series: Array<PrometheusSeries>;
  isRangeVector: boolean;
}> = (props: {
  series: Array<PrometheusSeries>;
  isRangeVector: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: "promql-result-table",
    columns: [
      { id: "series", cellNumber: 1 },
      { id: "value", cellNumber: 2 },
    ],
  });

  const formatValue: (value: number) => string = (value: number): string => {
    if (Number.isNaN(value)) {
      return "NaN";
    }

    if (!Number.isFinite(value)) {
      return value > 0 ? "+Inf" : "-Inf";
    }

    return translator.formatNumber(value);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200/80">
      {resizableColumns.styles}
      <table
        className={resizableColumns.getTableWidthClassName("min-w-full")}
        {...resizableColumns.tableAttributes}
      >
        <thead>
          <tr className="border-b border-gray-200/80 bg-gray-50/80">
            <ResizableHeaderCell
              className="px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-gray-500"
              resize={resizableColumns.getResize(
                "series",
                translator.translateText("Series") ?? "",
                ColumnWidthKind.Name,
              )}
            >
              <span>{translator.translateText("Series")}</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="px-4 py-2.5 text-end text-[11px] font-semibold uppercase tracking-wider text-gray-500"
              resize={resizableColumns.getResize(
                "value",
                translator.translateText("Value") ?? "",
                ColumnWidthKind.Whole,
              )}
            >
              <span>{translator.translateText("Value")}</span>
            </ResizableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {props.series.map((item: PrometheusSeries) => {
            const point: PrometheusPoint | undefined = lastPoint(item);
            const label: string = formatPromQLLabels(item.labels);

            return (
              <tr
                key={label}
                className="border-b border-gray-100/80 last:border-b-0 hover:bg-gray-50/50"
              >
                <td
                  className="break-all px-4 py-2.5 font-mono text-xs text-gray-800"
                  dir="ltr"
                >
                  {label}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end font-mono text-sm tabular-nums text-gray-900">
                  {point ? formatValue(point.value) : ""}
                  {props.isRangeVector && (
                    <span className="ms-2 text-xs text-gray-400">
                      {translator.translatePlural(
                        {
                          one: "{{count}} sample",
                          other: "{{count}} samples",
                        },
                        item.points.length,
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PromQLQueryView;
