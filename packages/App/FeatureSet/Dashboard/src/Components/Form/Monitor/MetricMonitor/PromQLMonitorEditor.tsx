import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import { PROMQL_MONITOR_MAX_SERIES } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import {
  PROMQL_MONITOR_EXAMPLE,
  PromQLMonitorComparison,
  PromQLMonitorExpressionProblem,
  PromQLMonitorExpressionProblemKind,
  findPromQLMonitorExpressionProblem,
  splitPromQLMonitorComparison,
} from "Common/Utils/PromQL/PromQLMonitorExpression";
import {
  PrometheusResult,
  PrometheusSeries,
} from "Common/Utils/PromQL/PrometheusResponse";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { PromQLGraph } from "../../../Metrics/PromQL/PromQLQueryView";
import PromQLQueryUtil from "../../../../Utils/PromQLQuery";

/*
 * A Metrics monitor's PromQL expression (issue #7712): the editor the
 * Metrics page's PromQL tab uses, and the expression charted over the
 * hours before the rule's window, with the rule's value as its red line.
 *
 * Every series the expression returns is judged on its own and opens its
 * own incident, so the chart's series are the monitor's. An expression
 * that ends in a comparison (`> 0.05`) keeps only the series in breach;
 * the editor offers to move that comparison to When to alert, where the
 * monitor compares every value, and the chart draws the whole metric.
 */

export const PROMQL_MONITOR_EDITOR_TEST_ID: string = "promql-monitor-editor";
export const PROMQL_MONITOR_PREVIEW_TEST_ID: string = "promql-monitor-preview";
export const PROMQL_MONITOR_TOO_MANY_SERIES_TEST_ID: string =
  "promql-monitor-too-many-series";
export const PROMQL_MONITOR_COMPARISON_TEST_ID: string =
  "promql-monitor-comparison";

// How long the editor waits after the last key before charting it.
export const PROMQL_MONITOR_PREVIEW_DELAY_MS: number = 800;

const PROMQL_EDITOR_CLASS_NAME: string =
  "block w-full resize-y rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5 font-mono text-sm leading-6 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500";

const MOVE_COMPARISON_TEXT: string = translationKey(
  "This expression keeps only the series it compares as true. Move the comparison to When to alert to chart every series and judge each one there.",
);

/*
 * Why an expression cannot be the monitor's, in the reader's words: the
 * sentences PromQLMonitorExpression says in English, a parser's own words
 * kept as they are.
 */
export const PROMQL_MONITOR_PARSE_ERROR_TEXT: string = translationKey(
  "The PromQL expression does not parse: {{error}}",
);

export const PROMQL_MONITOR_PROBLEM_TEXT: Readonly<
  Record<
    Exclude<
      PromQLMonitorExpressionProblemKind,
      PromQLMonitorExpressionProblemKind.DoesNotParse
    >,
    string
  >
> = {
  [PromQLMonitorExpressionProblemKind.Empty]: translationKey(
    "Write the PromQL expression this monitor evaluates, such as sum(rate(http_requests_total[5m])).",
  ),
  [PromQLMonitorExpressionProblemKind.RangeVector]: translationKey(
    "The PromQL expression is a range vector, which a monitor cannot compare. Wrap it in a function such as rate(...[5m]) or avg_over_time(...[5m]).",
  ),
  [PromQLMonitorExpressionProblemKind.Text]: translationKey(
    "The PromQL expression is a string, which a monitor cannot compare. Write an expression that returns numbers.",
  ),
};

type PreviewState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "done"; query: string; series: Array<PrometheusSeries> };

// A result's series a chart can draw: a number is one series of its own.
const seriesOf: (result: PrometheusResult) => Array<PrometheusSeries> = (
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
  query: string;
  onChange: (query: string) => void;
  // The hours the chart draws: those before the rule's window.
  previewWindow: InBetween<Date>;
  // The rule's value, drawn as the chart's red line.
  threshold?: number | undefined;
  /*
   * Moves the comparison the expression ends in to When to alert. Absent
   * where the form cannot change the rule (its criteria are not one rule).
   */
  onMoveComparisonToRule?:
    | ((comparison: PromQLMonitorComparison) => void)
    | undefined;
}

const PromQLMonitorEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [metricNames, setMetricNames] = useState<Array<string>>([]);
  const runSequenceRef: React.MutableRefObject<number> = useRef(0);

  const query: string = props.query || "";
  const trimmed: string = query.trim();
  // An empty editor is no mistake yet: the placeholder shows what to write.
  const problem: PromQLMonitorExpressionProblem | null = trimmed
    ? findPromQLMonitorExpressionProblem(trimmed)
    : null;
  const hasProblem: boolean = problem !== null;
  const comparison: PromQLMonitorComparison | null = useMemo(() => {
    return splitPromQLMonitorComparison(trimmed);
  }, [trimmed]);

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

  const startMs: number = props.previewWindow.startValue.getTime();
  const endMs: number = props.previewWindow.endValue.getTime();

  // Charted once typing stops, and again when the rule's window changes.
  useEffect(() => {
    if (!trimmed || hasProblem) {
      runSequenceRef.current++;
      setPreview({ kind: "idle" });
      return;
    }

    const sequence: number = ++runSequenceRef.current;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setPreview({ kind: "running" });

      PromQLQueryUtil.queryRange({
        query: trimmed,
        startDate: new Date(startMs),
        endDate: new Date(endMs),
      })
        .then((result: PrometheusResult) => {
          // A slower, older run never overwrites a newer one.
          if (sequence === runSequenceRef.current) {
            setPreview({
              kind: "done",
              query: trimmed,
              series: seriesOf(result),
            });
          }
        })
        .catch((error: unknown) => {
          if (sequence === runSequenceRef.current) {
            setPreview({
              kind: "error",
              message: API.getFriendlyMessage(error),
            });
          }
        });
    }, PROMQL_MONITOR_PREVIEW_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [trimmed, hasProblem, startMs, endMs]);

  const metricOptions: Array<DropdownOption> = useMemo(() => {
    return metricNames.map((name: string): DropdownOption => {
      return { value: name, label: name, isUserContent: true };
    });
  }, [metricNames]);

  const onMetricPicked: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => void = (value: DropdownValue | Array<DropdownValue> | null): void => {
    if (typeof value !== "string" || !value) {
      return;
    }

    const current: string = query.trimEnd();
    props.onChange(current ? `${current} ${value}` : value);
  };

  return (
    <div className="space-y-3" data-testid={PROMQL_MONITOR_EDITOR_TEST_ID}>
      <div>
        <TextArea
          value={query}
          onChange={(value: string) => {
            props.onChange(value);
          }}
          placeholder={PROMQL_MONITOR_EXAMPLE}
          className={PROMQL_EDITOR_CLASS_NAME}
          autoGrow={true}
          rows={3}
          maxRows={14}
          disableSpellCheck={true}
          readsLeftToRight={true}
          ariaLabelledby="promql-monitor-query-label"
        />
        <span id="promql-monitor-query-label" className="sr-only">
          {translator.translateText("PromQL Query")}
        </span>
        {problem && (
          <FieldError
            message={
              problem.kind === PromQLMonitorExpressionProblemKind.DoesNotParse
                ? translator.translateTemplate(
                    PROMQL_MONITOR_PARSE_ERROR_TEXT,
                    {
                      error: errorInSentence(problem.detail),
                    },
                  )
                : translator.translateText(
                    PROMQL_MONITOR_PROBLEM_TEXT[problem.kind],
                  ) || PROMQL_MONITOR_PROBLEM_TEXT[problem.kind]
            }
          />
        )}
        <p className="mt-1 text-xs text-gray-500">
          {translator.translateTemplate(
            "Each series the expression returns is judged on its own and opens its own incident, up to {{count}} series.",
            { count: translator.formatNumber(PROMQL_MONITOR_MAX_SERIES) },
          )}
        </p>
      </div>

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

      {comparison && props.onMoveComparisonToRule && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-gray-700"
          data-testid={PROMQL_MONITOR_COMPARISON_TEST_ID}
        >
          <span className="min-w-0 flex-1">
            {translator.translateText(MOVE_COMPARISON_TEXT)}
          </span>
          <Button
            title="Move to When to alert"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.ArrowCircleDown}
            onClick={() => {
              props.onMoveComparisonToRule?.(comparison);
            }}
          />
        </div>
      )}

      <div data-testid={PROMQL_MONITOR_PREVIEW_TEST_ID}>
        {preview.kind === "running" && <ComponentLoader />}

        {preview.kind === "error" && (
          <p className="text-sm text-red-700" role="alert">
            <ErrorSentence
              template="The query did not run. {{error}}"
              error={preview.message}
            />
          </p>
        )}

        {preview.kind === "done" &&
          preview.series.length > PROMQL_MONITOR_MAX_SERIES && (
            <div data-testid={PROMQL_MONITOR_TOO_MANY_SERIES_TEST_ID}>
              <Alert
                type={AlertType.WARNING}
                title={translator.translateTemplate(
                  "This expression returns {{count}} series. A monitor judges at most {{max}} of them on each check: aggregate it with sum by (...) or add label matchers.",
                  {
                    count: translator.formatNumber(preview.series.length),
                    max: translator.formatNumber(PROMQL_MONITOR_MAX_SERIES),
                  },
                )}
              />
            </div>
          )}

        {preview.kind === "done" && preview.series.length === 0 && (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "No series matched this query in the time range.",
            )}
          </p>
        )}

        {preview.kind === "done" && preview.series.length > 0 && (
          <div className="rounded-lg border border-gray-200 p-2 shadow-sm">
            <PromQLGraph
              series={preview.series}
              window={props.previewWindow}
              query={preview.query}
              criticalThreshold={props.threshold}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PromQLMonitorEditor;
