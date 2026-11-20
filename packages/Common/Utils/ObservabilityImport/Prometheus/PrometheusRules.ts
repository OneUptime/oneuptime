import {
  EvaluateOverTimeType,
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
import {
  ImportedComparison,
  convertAlertTemplate,
  readImportSeverity,
  readImportWindow,
  readPrometheusAlertExpression,
  readPrometheusDuration,
} from "../AlertImportCommon";
import { looksLikeLogQL } from "../Grafana/GrafanaLoki";
import { prometheusGroupsOf } from "../ImportSource";
import {
  ImportObject,
  arrayField,
  asObject,
  stringMapField,
  textField,
} from "../ImportValues";
import {
  QUERY_CONVERTED_BY_AI,
  findPromQLImportProblem,
} from "../PromQLImportQuery";

/*
 * A PROMETHEUS RULE FILE, AS METRICS MONITORS (issue #7697).
 *
 * Read from a rule file (`groups:`), a PrometheusRule resource
 * (`spec.groups`) or a List of them. Each alerting rule becomes a Metrics
 * monitor with one PromQL step, which judges each series on its own and
 * opens an alert for each, as Prometheus fires one per series:
 *
 *   expr: rate(errors[5m]) > 0.1      the query rate(errors[5m]), the
 *                                     condition "above 0.1"
 *   for: 5m                           every value of the past 5 minutes
 *   labels.severity: critical         the project's most severe alert
 *   annotations.summary               the alert's title
 *   annotations.description           the alert's description
 *
 * A recording rule records a metric rather than alerting, and a rule over
 * Loki's logs reads LogQL: both are listed, not imported.
 */

// A runbook's address a browser can open.
const WEB_ADDRESS: RegExp = /^https?:\/\//i;

export const RULE_IS_RECORDING: string = translationKey(
  "It is a recording rule, which OneUptime does not import: Prometheus sends the series it records with remote write, as it sends the rest.",
);

export const RULE_READS_LOGS: string = translationKey(
  "It reads logs with LogQL: OneUptime imports alerting rules written in PromQL.",
);

export const RULE_NO_EXPRESSION: string = translationKey(
  "It has no expression.",
);

export const RULE_KEEP_FIRING: string = translationKey(
  "Prometheus keeps it firing for {{duration}} after it recovers; OneUptime resolves its alert at once.",
);

export const RULE_GROUP_INTERVAL: string = translationKey(
  "Prometheus evaluates its group every {{interval}}; OneUptime checks it every minute.",
);

export const RULE_LABELS_NOT_KEPT: string = translationKey(
  "Its labels ({{labels}}) are not kept: route its alerts with on-call policies.",
);

// A rule's key, which an AI-converted query is handed back under.
export const getPrometheusRuleTargetKey: (itemKey: string) => string = (
  itemKey: string,
): string => {
  return `${itemKey}:expr`;
};

export const convertPrometheusRules: (
  documents: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
) => AlertImportPlan = (
  documents: Array<ImportObject>,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
): AlertImportPlan => {
  const overrides: ImportQueryOverrides =
    options?.queryOverrides || NO_QUERY_OVERRIDES;
  const items: Array<AlertImportItem> = [];
  const notes: Array<ImportNote> = [];
  // Each rule's severity label as written, to name repeated rules by.
  const severityLabels: Map<string, string> = new Map<string, string>();
  let index: number = 0;

  for (const document of documents) {
    for (const groupValue of prometheusGroupsOf(document)) {
      const group: ImportObject | undefined = asObject(groupValue);
      const groupName: string = textField(group, "name");
      const interval: string = textField(group, "interval");

      for (const ruleValue of arrayField(group, "rules")) {
        const rule: ImportObject | undefined = asObject(ruleValue);

        if (!rule) {
          continue;
        }

        if (items.length >= IMPORT_MAX_ITEMS) {
          continue;
        }

        const key: string = `rule-${index++}`;
        const alertName: string = textField(rule, "alert");
        const recordName: string = textField(rule, "record");
        const expr: string = textField(rule, "expr");
        const base: Pick<
          AlertImportItem,
          "key" | "name" | "group" | "sourceType" | "isEnabledInSource"
        > = {
          key,
          name: alertName || recordName,
          group: groupName,
          sourceType: alertName ? "alerting rule" : "recording rule",
          isEnabledInSource: true,
        };

        if (!alertName) {
          items.push({
            ...base,
            status: ImportItemStatus.NotConverted,
            notes: [{ kind: ImportNoteKind.Reason, text: RULE_IS_RECORDING }],
          });
          continue;
        }

        if (!expr) {
          items.push({
            ...base,
            status: ImportItemStatus.NotConverted,
            notes: [{ kind: ImportNoteKind.Reason, text: RULE_NO_EXPRESSION }],
          });
          continue;
        }

        const override: string | undefined = overrides.get(
          getPrometheusRuleTargetKey(key),
        );

        if (override === undefined && looksLikeLogQL(expr)) {
          items.push({
            ...base,
            status: ImportItemStatus.NotConverted,
            notes: [{ kind: ImportNoteKind.Reason, text: RULE_READS_LOGS }],
          });
          continue;
        }

        const ruleNotes: Array<ImportNote> = [];

        if (override !== undefined) {
          ruleNotes.push({
            kind: ImportNoteKind.Approximation,
            text: QUERY_CONVERTED_BY_AI,
          });
        }

        const comparison: ImportedComparison = readPrometheusAlertExpression({
          expr: override ?? expr,
          notes: ruleNotes,
        });

        const problem: ImportNote | null = findPromQLImportProblem({
          promQL: comparison.promQL,
        });

        if (problem) {
          items.push({
            ...base,
            status: ImportItemStatus.NotConverted,
            notes: [problem],
            aiCandidate: {
              language: ImportQueryLanguage.PromQL,
              query: override ?? expr,
              variableNames: [],
              targetKey: getPrometheusRuleTargetKey(key),
              isForMonitor: true,
            },
          });
          continue;
        }

        const forText: string = textField(rule, "for");
        const rollingTime: RollingTime = readImportWindow({
          ms: readPrometheusDuration(forText),
          sourceText: forText,
          notes: ruleNotes,
        });

        const keepFiring: string = textField(rule, "keep_firing_for");

        if (keepFiring && readPrometheusDuration(keepFiring) > 0) {
          ruleNotes.push({
            kind: ImportNoteKind.Approximation,
            text: RULE_KEEP_FIRING,
            values: { duration: keepFiring },
          });
        }

        if (interval && readPrometheusDuration(interval) !== 60 * 1000) {
          ruleNotes.push({
            kind: ImportNoteKind.Info,
            text: RULE_GROUP_INTERVAL,
            values: { interval },
          });
        }

        const labels: Map<string, string> = stringMapField(rule, "labels");
        const annotations: Map<string, string> = stringMapField(
          rule,
          "annotations",
        );

        severityLabels.set(key, labels.get("severity") || "");
        const otherLabels: Array<string> = Array.from(labels.keys()).filter(
          (name: string): boolean => {
            return name !== "severity";
          },
        );

        if (otherLabels.length > 0) {
          ruleNotes.push({
            kind: ImportNoteKind.Info,
            text: RULE_LABELS_NOT_KEPT,
            values: { labels: otherLabels.join(", ") },
          });
        }

        const title: string =
          convertAlertTemplate({
            text: annotations.get("summary") || annotations.get("title") || "",
            notes: ruleNotes,
          }) || alertName;

        const descriptionParts: Array<string> = [
          convertAlertTemplate({
            text:
              annotations.get("description") ||
              annotations.get("message") ||
              "",
            notes: ruleNotes,
          }),
        ];
        const runbook: string = (
          annotations.get("runbook_url") ||
          annotations.get("runbook") ||
          ""
        ).trim();

        if (WEB_ADDRESS.test(runbook)) {
          descriptionParts.push(`Runbook: ${runbook}`);
        }

        // One note of each.
        const said: Set<string> = new Set<string>();
        const distinct: Array<ImportNote> = ruleNotes.filter(
          (note: ImportNote): boolean => {
            const noteKey: string = `${note.text}|${JSON.stringify(note.values || {})}`;
            if (said.has(noteKey)) {
              return false;
            }
            said.add(noteKey);
            return true;
          },
        );

        items.push({
          ...base,
          status: ImportStatusUtil.fromNotes(distinct),
          notes: distinct,
          rule: {
            promQL: comparison.promQL,
            filterType: comparison.filterType,
            threshold: comparison.threshold,
            rollingTime,
            aggregation: EvaluateOverTimeType.AllValues,
            onNoData: NoDataPolicy.Ignore,
            severity: readImportSeverity(labels.get("severity")),
            title,
            description: descriptionParts
              .filter((part: string): boolean => {
                return part.length > 0;
              })
              .join("\n\n"),
            monitorDescription: descriptionParts[0] || "",
          },
        });
      }
    }
  }

  return {
    source: ImportSourceKind.PrometheusRules,
    items: nameRepeatedRulesBySeverity({ items, severityLabels }),
    notes,
  };
};

/*
 * A rule file often holds one alert at two severities, under one name
 * (NodeFilesystemSpaceFillingUp, warning and critical): each is named with
 * its severity, as "NodeFilesystemSpaceFillingUp (critical)", so the two
 * monitors are told apart.
 */
const nameRepeatedRulesBySeverity: (data: {
  items: Array<AlertImportItem>;
  severityLabels: Map<string, string>;
}) => Array<AlertImportItem> = (data: {
  items: Array<AlertImportItem>;
  severityLabels: Map<string, string>;
}): Array<AlertImportItem> => {
  const counts: Map<string, number> = new Map<string, number>();

  for (const item of data.items) {
    counts.set(item.name, (counts.get(item.name) || 0) + 1);
  }

  return data.items.map((item: AlertImportItem): AlertImportItem => {
    const severity: string = (data.severityLabels.get(item.key) || "").trim();

    if ((counts.get(item.name) || 0) < 2 || !severity) {
      return item;
    }

    return { ...item, name: `${item.name} (${severity})` };
  });
};
