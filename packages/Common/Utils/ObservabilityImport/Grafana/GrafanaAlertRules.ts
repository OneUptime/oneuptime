import {
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  AlertImportItem,
  AlertImportPlan,
  IMPORT_MAX_ITEMS,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
  ImportQueryOverrides,
  ImportSourceKind,
  ImportStatusUtil,
  NO_QUERY_OVERRIDES,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { translationKey } from "../../../Types/Translator";
import { fillGrafanaIntervalMacros } from "../../PromQL/PromQLGrafanaMacros";
import {
  ImportedComparison,
  convertAlertTemplate,
  readImportSeverity,
  readImportWindow,
  readPrometheusAlertExpression,
  readPrometheusDuration,
} from "../AlertImportCommon";
import { GrafanaRuleGroupDocument, grafanaGroupsOf } from "../ImportSource";
import {
  ImportObject,
  arrayField,
  asObject,
  booleanField,
  numberField,
  objectField,
  stringMapField,
  textField,
} from "../ImportValues";
import {
  QUERY_CONVERTED_BY_AI,
  findPromQLImportProblem,
} from "../PromQLImportQuery";
import { looksLikeLogQL } from "./GrafanaLoki";

/*
 * GRAFANA'S ALERT RULES, AS METRICS MONITORS (issue #7697).
 *
 * Read from Grafana's export of its alert rules (Alerting > Alert rules >
 * Export, as YAML or JSON), a provisioning file, or the ruler API's
 * answer. A Grafana rule is queries and expressions: a Prometheus query
 * (A), reduced to one value per series (B: last, mean, max...), compared
 * with a threshold (C), the rule's condition. It becomes one PromQL step:
 *
 *   A an instant query, or reduced with last    the query; the window is
 *                                                the rule's pending period,
 *                                                every value in it breaching
 *   A over the last 10 minutes, reduced         a 10-minute window, read as
 *   with mean, max, min or sum                  its average, highest, lowest
 *                                                or total
 *   C: B above 80                                the condition "above 80"
 *
 * Grafana fills $__interval, $__rate_interval and $__range in a rule's
 * query from its own interval (15 seconds by default) and range: they are
 * written in the same way. Classic conditions with one condition read the
 * same. A rule over Loki, SQL or any other data source, one whose
 * condition joins several, or one comparing within a range, is listed,
 * not imported.
 */

export const GRAFANA_RULE_CONDITION_NOT_READ: string = translationKey(
  "Its condition is not a threshold on one Prometheus query, which is what OneUptime imports.",
);

export const GRAFANA_RULE_RANGE_THRESHOLD: string = translationKey(
  "Its threshold is a range ({{type}}), which a monitor's condition is not.",
);

export const GRAFANA_RULE_NOT_PROMETHEUS: string = translationKey(
  "Its query reads a data source other than Prometheus.",
);

export const GRAFANA_RULE_READS_LOGS: string = translationKey(
  "Its query reads logs with LogQL: OneUptime imports rules written in PromQL.",
);

export const GRAFANA_RULE_REDUCER_NOT_KEPT: string = translationKey(
  "Grafana reduces the values to their {{reducer}}; OneUptime reads every value in the window.",
);

export const GRAFANA_RULE_PENDING_AND_RANGE: string = translationKey(
  "Grafana also waits {{pending}} before it fires; OneUptime reads one window.",
);

export const GRAFANA_RULE_KEEP_LAST: string = translationKey(
  "Grafana keeps the last state when there is no data; OneUptime does not open an alert for no data.",
);

export const GRAFANA_RULE_PAUSED: string = translationKey(
  "It is paused in Grafana, so it starts unticked.",
);

// Grafana's threshold types and the condition each is.
const EVALUATORS: ReadonlyMap<string, FilterType> = new Map<string, FilterType>([
  ["gt", FilterType.GreaterThan],
  ["lt", FilterType.LessThan],
  ["gte", FilterType.GreaterThanOrEqualTo],
  ["lte", FilterType.LessThanOrEqualTo],
  ["eq", FilterType.EqualTo],
  ["ne", FilterType.NotEqualTo],
]);

// Grafana's reducers and how a window of values is read for each.
const REDUCERS: ReadonlyMap<string, EvaluateOverTimeType> = new Map<
  string,
  EvaluateOverTimeType
>([
  ["mean", EvaluateOverTimeType.Average],
  ["avg", EvaluateOverTimeType.Average],
  ["max", EvaluateOverTimeType.MaximumValue],
  ["min", EvaluateOverTimeType.MunimumValue],
  ["sum", EvaluateOverTimeType.Sum],
]);

interface GrafanaQueryNode {
  refId: string;
  isExpression: boolean;
  model: ImportObject;
  // relativeTimeRange.from, in seconds.
  fromSeconds: number;
}

interface ReadCondition {
  query: GrafanaQueryNode;
  filterType: FilterType;
  threshold: number;
  reducer: string | undefined;
}

const readNodes: (alert: ImportObject) => Map<string, GrafanaQueryNode> = (
  alert: ImportObject,
): Map<string, GrafanaQueryNode> => {
  const nodes: Map<string, GrafanaQueryNode> = new Map<
    string,
    GrafanaQueryNode
  >();

  for (const item of arrayField(alert, "data")) {
    const node: ImportObject | undefined = asObject(item);
    const refId: string = textField(node, "refId");
    const model: ImportObject = objectField(node, "model") || {};

    if (!refId) {
      continue;
    }

    const datasourceUid: string =
      textField(node, "datasourceUid") ||
      textField(objectField(model, "datasource"), "uid");

    nodes.set(refId, {
      refId,
      isExpression:
        datasourceUid === "__expr__" ||
        datasourceUid === "-100" ||
        textField(objectField(model, "datasource"), "type") === "__expr__",
      model,
      fromSeconds:
        numberField(objectField(node, "relativeTimeRange"), "from") ?? 600,
    });
  }

  return nodes;
};

// The threshold a node's evaluator holds: gt 80, lt 5.
const readEvaluator: (
  evaluator: ImportObject | undefined,
) => { filterType: FilterType; threshold: number } | { rangeType: string } | undefined =
  (
    evaluator: ImportObject | undefined,
  ):
    | { filterType: FilterType; threshold: number }
    | { rangeType: string }
    | undefined => {
    const type: string = textField(evaluator, "type");
    const params: Array<unknown> = arrayField(evaluator, "params");
    const threshold: unknown = params[0];

    if (type.includes("range")) {
      return { rangeType: type };
    }

    const filterType: FilterType | undefined = EVALUATORS.get(type);

    if (!filterType || typeof threshold !== "number" || !Number.isFinite(threshold)) {
      return undefined;
    }

    return { filterType, threshold };
  };

/*
 * The rule's condition, as one query compared with a number, or the
 * reason it is not one.
 */
const readCondition: (data: {
  alert: ImportObject;
  nodes: Map<string, GrafanaQueryNode>;
}) => ReadCondition | ImportNote = (data: {
  alert: ImportObject;
  nodes: Map<string, GrafanaQueryNode>;
}): ReadCondition | ImportNote => {
  const notRead: ImportNote = {
    kind: ImportNoteKind.Reason,
    text: GRAFANA_RULE_CONDITION_NOT_READ,
  };
  const condition: GrafanaQueryNode | undefined = data.nodes.get(
    textField(data.alert, "condition"),
  );

  if (!condition) {
    return notRead;
  }

  // The condition is the query itself: as a Prometheus rule reads.
  if (!condition.isExpression) {
    return {
      query: condition,
      filterType: FilterType.GreaterThan,
      threshold: Number.NaN,
      reducer: undefined,
    };
  }

  const type: string = textField(condition.model, "type");

  // A query reduced, then a threshold on it: C -> B -> A.
  const followToQuery: (refId: string) => {
    query: GrafanaQueryNode;
    reducer: string | undefined;
  } | undefined = (refId: string) => {
    const node: GrafanaQueryNode | undefined = data.nodes.get(
      refId.replace(/^\$/, ""),
    );

    if (!node) {
      return undefined;
    }

    if (!node.isExpression) {
      return { query: node, reducer: undefined };
    }

    if (textField(node.model, "type") === "reduce") {
      const input: GrafanaQueryNode | undefined = data.nodes.get(
        textField(node.model, "expression").replace(/^\$/, ""),
      );

      return input && !input.isExpression
        ? { query: input, reducer: textField(node.model, "reducer") || "last" }
        : undefined;
    }

    return undefined;
  };

  if (type === "threshold") {
    const source: { query: GrafanaQueryNode; reducer: string | undefined } | undefined =
      followToQuery(textField(condition.model, "expression"));
    const conditions: Array<unknown> = arrayField(condition.model, "conditions");
    const evaluator: ReturnType<typeof readEvaluator> = readEvaluator(
      objectField(asObject(conditions[0]), "evaluator"),
    );

    if (!source || !evaluator || conditions.length !== 1) {
      return notRead;
    }

    if ("rangeType" in evaluator) {
      return {
        kind: ImportNoteKind.Reason,
        text: GRAFANA_RULE_RANGE_THRESHOLD,
        values: { type: evaluator.rangeType },
      };
    }

    return { ...source, ...evaluator };
  }

  if (type === "classic_conditions") {
    const conditions: Array<unknown> = arrayField(condition.model, "conditions");
    const first: ImportObject | undefined = asObject(conditions[0]);
    const evaluator: ReturnType<typeof readEvaluator> = readEvaluator(
      objectField(first, "evaluator"),
    );
    const queryRef: string = textField(
      objectField(first, "query"),
      "params",
    ) || String(arrayField(objectField(first, "query"), "params")[0] || "");
    const query: GrafanaQueryNode | undefined = data.nodes.get(queryRef);

    if (!query || query.isExpression || !evaluator || conditions.length !== 1) {
      return notRead;
    }

    if ("rangeType" in evaluator) {
      return {
        kind: ImportNoteKind.Reason,
        text: GRAFANA_RULE_RANGE_THRESHOLD,
        values: { type: evaluator.rangeType },
      };
    }

    return {
      query,
      ...evaluator,
      reducer: textField(objectField(first, "reducer"), "type") || "last",
    };
  }

  // A math expression comparing one result with a number: $B > 80.
  if (type === "math") {
    const match: RegExpMatchArray | null = textField(
      condition.model,
      "expression",
    ).match(
      /^\s*\$\{?([A-Za-z0-9_]+)\}?\s*(>=|<=|==|!=|>|<)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/,
    );

    if (!match) {
      return notRead;
    }

    const source: { query: GrafanaQueryNode; reducer: string | undefined } | undefined =
      followToQuery(match[1] || "");
    const operators: Record<string, FilterType> = {
      ">": FilterType.GreaterThan,
      ">=": FilterType.GreaterThanOrEqualTo,
      "<": FilterType.LessThan,
      "<=": FilterType.LessThanOrEqualTo,
      "==": FilterType.EqualTo,
      "!=": FilterType.NotEqualTo,
    };

    if (!source) {
      return notRead;
    }

    return {
      ...source,
      filterType: operators[match[2] || ">"] || FilterType.GreaterThan,
      threshold: Number(match[3]),
    };
  }

  return notRead;
};

export const getGrafanaRuleTargetKey: (itemKey: string) => string = (
  itemKey: string,
): string => {
  return `${itemKey}:query`;
};

const convertRule: (data: {
  ruleValue: unknown;
  group: GrafanaRuleGroupDocument;
  key: string;
  overrides: ImportQueryOverrides;
}) => AlertImportItem | undefined = (data: {
  ruleValue: unknown;
  group: GrafanaRuleGroupDocument;
  key: string;
  overrides: ImportQueryOverrides;
}): AlertImportItem | undefined => {
  const rule: ImportObject | undefined = asObject(data.ruleValue);

  if (!rule) {
    return undefined;
  }

  // The ruler API keeps the rule in grafana_alert, beside its labels.
  const alert: ImportObject = objectField(rule, "grafana_alert") || rule;
  const title: string = textField(alert, "title") || textField(rule, "title");
  const paused: boolean =
    booleanField(alert, "isPaused") === true ||
    booleanField(alert, "is_paused") === true;
  const base: Pick<
    AlertImportItem,
    "key" | "name" | "group" | "sourceType" | "isEnabledInSource"
  > = {
    key: data.key,
    name: title,
    group: [data.group.folder, textField(data.group.group, "name")]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" / "),
    sourceType: "Grafana alert rule",
    isEnabledInSource: !paused,
  };

  const nodes: Map<string, GrafanaQueryNode> = readNodes(alert);
  const condition: ReadCondition | ImportNote = readCondition({ alert, nodes });

  if ("kind" in condition) {
    return { ...base, status: ImportItemStatus.NotConverted, notes: [condition] };
  }

  const model: ImportObject = condition.query.model;
  const expr: string = textField(model, "expr");
  const dataSourceType: string = textField(objectField(model, "datasource"), "type");
  const override: string | undefined = data.overrides.get(
    getGrafanaRuleTargetKey(data.key),
  );

  if (override === undefined) {
    if (!expr || (dataSourceType && dataSourceType !== "prometheus")) {
      return {
        ...base,
        status: ImportItemStatus.NotConverted,
        notes: [
          {
            kind: ImportNoteKind.Reason,
            text:
              dataSourceType === "loki" || looksLikeLogQL(expr)
                ? GRAFANA_RULE_READS_LOGS
                : GRAFANA_RULE_NOT_PROMETHEUS,
          },
        ],
      };
    }

    if (looksLikeLogQL(expr)) {
      return {
        ...base,
        status: ImportItemStatus.NotConverted,
        notes: [{ kind: ImportNoteKind.Reason, text: GRAFANA_RULE_READS_LOGS }],
      };
    }
  }

  const notes: Array<ImportNote> = [];

  if (paused) {
    notes.push({ kind: ImportNoteKind.Info, text: GRAFANA_RULE_PAUSED });
  }

  if (override !== undefined) {
    notes.push({ kind: ImportNoteKind.Approximation, text: QUERY_CONVERTED_BY_AI });
  }

  // Grafana's macros in a rule: its 15-second interval and its range.
  const promQLText: string = fillGrafanaIntervalMacros(override ?? expr, {
    intervalInSeconds: 15,
    rateIntervalInSeconds: 60,
    rangeInSeconds: condition.query.fromSeconds,
  });

  let comparison: ImportedComparison;

  if (Number.isNaN(condition.threshold)) {
    comparison = readPrometheusAlertExpression({ expr: promQLText, notes });
  } else {
    comparison = {
      promQL: promQLText,
      filterType: condition.filterType,
      threshold: condition.threshold,
    };
  }

  const problem: ImportNote | null = findPromQLImportProblem({
    promQL: comparison.promQL,
  });

  if (problem) {
    return {
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [problem],
      aiCandidate: {
        language: ImportQueryLanguage.PromQL,
        query: override ?? expr,
        variableNames: [],
        targetKey: getGrafanaRuleTargetKey(data.key),
        isForMonitor: true,
      },
    };
  }

  // How the window is read: the pending period, or the reduced range.
  const pendingText: string = textField(rule, "for") || textField(alert, "for");
  const pendingMs: number = readPrometheusDuration(pendingText);
  const isInstant: boolean =
    booleanField(model, "instant") === true ||
    booleanField(model, "range") === false;
  const reducer: string = condition.reducer || "last";
  let rollingTime: RollingTime;
  let aggregation: EvaluateOverTimeType = EvaluateOverTimeType.AllValues;

  if (isInstant || reducer === "last") {
    rollingTime = readImportWindow({
      ms: pendingMs,
      sourceText: pendingText,
      notes,
    });
  } else {
    const windowAggregation: EvaluateOverTimeType | undefined =
      REDUCERS.get(reducer);

    if (windowAggregation) {
      aggregation = windowAggregation;
    } else {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: GRAFANA_RULE_REDUCER_NOT_KEPT,
        values: { reducer },
      });
    }

    rollingTime = readImportWindow({
      ms: condition.query.fromSeconds * 1000,
      sourceText: `${Math.round(condition.query.fromSeconds / 60)}m`,
      notes,
    });

    if (pendingMs > 0) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: GRAFANA_RULE_PENDING_AND_RANGE,
        values: { pending: pendingText },
      });
    }
  }

  const noDataState: string =
    textField(alert, "noDataState") || textField(alert, "no_data_state");
  let onNoData: NoDataPolicy = NoDataPolicy.Ignore;

  if (noDataState === "Alerting") {
    onNoData = NoDataPolicy.Trigger;
  } else if (noDataState === "KeepLast") {
    notes.push({ kind: ImportNoteKind.Approximation, text: GRAFANA_RULE_KEEP_LAST });
  }

  const labels: Map<string, string> = stringMapField(rule, "labels");
  const annotations: Map<string, string> = stringMapField(rule, "annotations");
  const alertTitle: string =
    convertAlertTemplate({ text: annotations.get("summary") || "", notes }) ||
    title;
  const description: string = convertAlertTemplate({
    text: annotations.get("description") || "",
    notes,
  });
  const runbook: string = (annotations.get("runbook_url") || "").trim();

  const said: Set<string> = new Set<string>();
  const distinct: Array<ImportNote> = notes.filter((note: ImportNote): boolean => {
    const noteKey: string = `${note.text}|${JSON.stringify(note.values || {})}`;
    if (said.has(noteKey)) {
      return false;
    }
    said.add(noteKey);
    return true;
  });

  return {
    ...base,
    status: ImportStatusUtil.fromNotes(distinct),
    notes: distinct,
    rule: {
      promQL: comparison.promQL,
      filterType: comparison.filterType,
      threshold: comparison.threshold,
      rollingTime,
      aggregation,
      onNoData,
      severity: readImportSeverity(labels.get("severity")),
      title: alertTitle,
      description: [
        description,
        /^https?:\/\//i.test(runbook) ? `Runbook: ${runbook}` : "",
      ]
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join("\n\n"),
      monitorDescription: description,
    },
  };
};

export const convertGrafanaAlertRules: (
  documents: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
) => AlertImportPlan = (
  documents: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
): AlertImportPlan => {
  const overrides: ImportQueryOverrides =
    options?.queryOverrides || NO_QUERY_OVERRIDES;
  const items: Array<AlertImportItem> = [];
  let index: number = 0;

  for (const document of documents) {
    for (const group of grafanaGroupsOf(document)) {
      for (const ruleValue of arrayField(group.group, "rules")) {
        if (items.length >= IMPORT_MAX_ITEMS) {
          break;
        }

        const item: AlertImportItem | undefined = convertRule({
          ruleValue,
          group,
          key: `rule-${index++}`,
          overrides,
        });

        if (item) {
          items.push(item);
        }
      }
    }
  }

  return { source: ImportSourceKind.GrafanaAlertRules, items, notes: [] };
};
