import yaml from "js-yaml";
import {
  IMPORT_MAX_TEXT_LENGTH,
  ImportSourceKind,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import { translationKey } from "../../Types/Translator";
import {
  ImportObject,
  arrayField,
  asArray,
  asObject,
  field,
  objectField,
  textField,
} from "./ImportValues";

/*
 * WHAT A PASTED OR UPLOADED FILE IS (issue #7697): a Grafana dashboard's
 * JSON, a Datadog dashboard's export, a Prometheus rule file (or a
 * PrometheusRule resource), Grafana's alert rules exported as YAML or JSON,
 * or Datadog monitors exported as JSON - told apart by the shape each tool
 * writes, never by a file name.
 *
 * Parsed strictly: JSON with JSON.parse, YAML with js-yaml's default
 * schema, which runs no code. Something that is none of these is refused
 * with what it is not, and a file of the other screen's kind says where it
 * goes: a rule file pasted on the dashboards' import is sent to Monitors.
 */

export class ImportReadError extends Error {
  public readonly text: string;
  public readonly values: Record<string, string>;

  public constructor(text: string, values: Record<string, string> = {}) {
    super(
      text.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string): string => {
        return values[name] ?? "";
      }),
    );
    this.name = "ImportReadError";
    this.text = text;
    this.values = values;
  }
}

export const IMPORT_TEXT_EMPTY: string = translationKey(
  "Paste the file's text, or upload the file.",
);

export const IMPORT_TEXT_TOO_LARGE: string = translationKey(
  "This file is larger than 10 MB, more than any export holds. Export the dashboard or the rules again, and paste that.",
);

export const IMPORT_TEXT_UNREADABLE: string = translationKey(
  "This is neither JSON nor YAML: {{error}}",
);

export const IMPORT_NOT_A_DASHBOARD: string = translationKey(
  "This is not a Grafana dashboard or a Datadog dashboard export. In Grafana, copy the dashboard's JSON model from its settings; in Datadog, use Export dashboard JSON.",
);

export const IMPORT_NOT_ALERT_RULES: string = translationKey(
  "This is not a Prometheus rule file, Grafana alert rules or Datadog monitors. Paste the rule file, Grafana's export of its alert rules, or Datadog's export of a monitor.",
);

export const IMPORT_DASHBOARD_ON_ALERTS: string = translationKey(
  "This is a dashboard. Import it from Dashboards, with Import from Grafana or Datadog.",
);

export const IMPORT_ALERTS_ON_DASHBOARDS: string = translationKey(
  "These are alert rules. Import them from Monitors, with Import Alerts.",
);

export interface ImportSourceDocument {
  kind: ImportSourceKind;
  // The documents the file holds, each as the tool wrote it.
  documents: Array<ImportObject>;
}

export const DASHBOARD_SOURCE_KINDS: ReadonlyArray<ImportSourceKind> = [
  ImportSourceKind.GrafanaDashboard,
  ImportSourceKind.DatadogDashboard,
];

export const ALERT_SOURCE_KINDS: ReadonlyArray<ImportSourceKind> = [
  ImportSourceKind.PrometheusRules,
  ImportSourceKind.GrafanaAlertRules,
  ImportSourceKind.DatadogMonitors,
];

// Every document the text holds: one JSON value, or each YAML document.
export const parseImportText: (text: string) => Array<unknown> = (
  text: string,
): Array<unknown> => {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    throw new ImportReadError(IMPORT_TEXT_EMPTY);
  }

  if (trimmed.length > IMPORT_MAX_TEXT_LENGTH) {
    throw new ImportReadError(IMPORT_TEXT_TOO_LARGE);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return [JSON.parse(trimmed)];
    } catch {
      // YAML reads what JSON does not (a YAML flow mapping); tried below.
    }
  }

  try {
    return yaml.loadAll(trimmed).filter((document: unknown): boolean => {
      return document !== null && document !== undefined;
    });
  } catch (error) {
    const message: string =
      error instanceof Error ? error.message.split("\n")[0] || "" : "";

    throw new ImportReadError(IMPORT_TEXT_UNREADABLE, {
      error: message,
    });
  }
};

// A Grafana dashboard: its panels (or old rows), maybe in the API's wrapper.
const readGrafanaDashboard: (value: unknown) => ImportObject | undefined = (
  value: unknown,
): ImportObject | undefined => {
  const object: ImportObject | undefined = asObject(value);

  if (!object) {
    return undefined;
  }

  // The API's {"dashboard": {...}, "meta": {...}} and the import payload.
  const inner: ImportObject | undefined = objectField(object, "dashboard");

  if (inner && readGrafanaDashboard(inner)) {
    return inner;
  }

  const hasPanels: boolean = Array.isArray(field(object, "panels"));
  const hasRows: boolean = Array.isArray(field(object, "rows"));
  const looksLikeGrafana: boolean =
    field(object, "schemaVersion") !== undefined ||
    field(object, "templating") !== undefined ||
    field(object, "__inputs") !== undefined ||
    field(object, "uid") !== undefined;

  return (hasPanels || hasRows) && (looksLikeGrafana || hasPanels)
    ? object
    : undefined;
};

// A Datadog dashboard: its widgets, as the export and the API write them.
const readDatadogDashboard: (value: unknown) => ImportObject | undefined = (
  value: unknown,
): ImportObject | undefined => {
  const object: ImportObject | undefined = asObject(value);

  if (!object) {
    return undefined;
  }

  const widgets: Array<unknown> = arrayField(object, "widgets");

  if (widgets.length === 0 && !Array.isArray(field(object, "widgets"))) {
    return undefined;
  }

  const firstWidget: ImportObject | undefined = asObject(widgets[0]);

  return field(object, "layout_type") !== undefined ||
    (firstWidget && objectField(firstWidget, "definition"))
    ? object
    : undefined;
};

// A rule group's rules hold Prometheus' `alert`/`record` and `expr`.
const isPrometheusRuleGroups: (groups: Array<unknown>) => boolean = (
  groups: Array<unknown>,
): boolean => {
  return groups.some((group: unknown): boolean => {
    return arrayField(asObject(group), "rules").some(
      (rule: unknown): boolean => {
        const object: ImportObject | undefined = asObject(rule);
        return Boolean(
          object &&
            field(object, "expr") !== undefined &&
            (field(object, "alert") !== undefined ||
              field(object, "record") !== undefined),
        );
      },
    );
  });
};

// Grafana's rules hold a title, a condition and the queries it reads.
const isGrafanaRule: (rule: unknown) => boolean = (rule: unknown): boolean => {
  const object: ImportObject | undefined = asObject(rule);

  if (!object) {
    return false;
  }

  const alert: ImportObject | undefined =
    objectField(object, "grafana_alert") || object;

  return (
    field(alert, "condition") !== undefined &&
    Array.isArray(field(alert, "data"))
  );
};

const isGrafanaRuleGroups: (
  groups: Array<GrafanaRuleGroupDocument>,
) => boolean = (groups: Array<GrafanaRuleGroupDocument>): boolean => {
  return groups.some((group: GrafanaRuleGroupDocument): boolean => {
    return arrayField(group.group, "rules").some(isGrafanaRule);
  });
};

// A Datadog monitor: its query and type, maybe in an asset's wrapper.
const readDatadogMonitor: (value: unknown) => ImportObject | undefined = (
  value: unknown,
): ImportObject | undefined => {
  const object: ImportObject | undefined = asObject(value);

  if (!object) {
    return undefined;
  }

  const definition: ImportObject | undefined = objectField(
    object,
    "definition",
  );

  if (definition && readDatadogMonitor(definition)) {
    return definition;
  }

  return typeof field(object, "query") === "string" &&
    typeof field(object, "type") === "string"
    ? object
    : undefined;
};

/*
 * The groups of a Prometheus rule document: a rule file's, a
 * PrometheusRule resource's (spec.groups) or each item's of a List.
 */
const prometheusGroupsOf: (document: ImportObject) => Array<unknown> = (
  document: ImportObject,
): Array<unknown> => {
  if (textField(document, "kind") === "List") {
    return arrayField(document, "items").flatMap(
      (item: unknown): Array<unknown> => {
        const object: ImportObject | undefined = asObject(item);
        return object ? prometheusGroupsOf(object) : [];
      },
    );
  }

  const spec: ImportObject | undefined = objectField(document, "spec");

  if (spec && Array.isArray(field(spec, "groups"))) {
    return arrayField(spec, "groups");
  }

  return arrayField(document, "groups");
};

// A Grafana rule group, with the folder the ruler API lists it under.
export interface GrafanaRuleGroupDocument {
  group: ImportObject;
  folder: string;
}

/*
 * The groups of a Grafana alert rule document: a provisioning file's or
 * an export's (groups), or the ruler API's folder -> groups map.
 */
const grafanaGroupsOf: (
  document: ImportObject,
) => Array<GrafanaRuleGroupDocument> = (
  document: ImportObject,
): Array<GrafanaRuleGroupDocument> => {
  const toGroup: (
    value: unknown,
    folder: string,
  ) => GrafanaRuleGroupDocument | undefined = (
    value: unknown,
    folder: string,
  ): GrafanaRuleGroupDocument | undefined => {
    const group: ImportObject | undefined = asObject(value);
    return group
      ? { group, folder: textField(group, "folder") || folder }
      : undefined;
  };

  const isGroup: (
    group: GrafanaRuleGroupDocument | undefined,
  ) => group is GrafanaRuleGroupDocument = (
    group: GrafanaRuleGroupDocument | undefined,
  ): group is GrafanaRuleGroupDocument => {
    return Boolean(group);
  };

  if (Array.isArray(field(document, "groups"))) {
    return arrayField(document, "groups")
      .map((group: unknown): GrafanaRuleGroupDocument | undefined => {
        return toGroup(group, "");
      })
      .filter(isGroup);
  }

  // The ruler API: {"<folder>": [{"name", "rules": [{"grafana_alert"}]}]}.
  return Object.keys(document).flatMap(
    (folder: string): Array<GrafanaRuleGroupDocument> => {
      return asArray(field(document, folder))
        .map((group: unknown): GrafanaRuleGroupDocument | undefined => {
          return toGroup(group, folder);
        })
        .filter(isGroup);
    },
  );
};

export interface ClassifiedDocuments {
  kind: ImportSourceKind;
  documents: Array<ImportObject>;
}

// What the documents are, or undefined when they are none of the kinds.
export const classifyImportDocuments: (
  documents: Array<unknown>,
) => ClassifiedDocuments | undefined = (
  documents: Array<unknown>,
): ClassifiedDocuments | undefined => {
  if (documents.length === 0) {
    return undefined;
  }

  // Datadog's API lists monitors as an array.
  if (documents.length === 1 && Array.isArray(documents[0])) {
    const monitors: Array<ImportObject> = asArray(documents[0])
      .map(readDatadogMonitor)
      .filter((monitor: ImportObject | undefined): boolean => {
        return Boolean(monitor);
      }) as Array<ImportObject>;

    if (monitors.length > 0) {
      return { kind: ImportSourceKind.DatadogMonitors, documents: monitors };
    }

    return undefined;
  }

  const first: unknown = documents[0];

  const grafana: ImportObject | undefined = readGrafanaDashboard(first);

  if (grafana && documents.length === 1) {
    return {
      kind: ImportSourceKind.GrafanaDashboard,
      documents: [grafana],
    };
  }

  const datadog: ImportObject | undefined = readDatadogDashboard(first);

  if (datadog && documents.length === 1) {
    return {
      kind: ImportSourceKind.DatadogDashboard,
      documents: [datadog],
    };
  }

  const objects: Array<ImportObject> = documents
    .map(asObject)
    .filter((object: ImportObject | undefined): boolean => {
      return Boolean(object);
    }) as Array<ImportObject>;

  const prometheusGroups: Array<unknown> = objects.flatMap(prometheusGroupsOf);

  if (isPrometheusRuleGroups(prometheusGroups)) {
    return { kind: ImportSourceKind.PrometheusRules, documents: objects };
  }

  const grafanaGroups: Array<GrafanaRuleGroupDocument> =
    objects.flatMap(grafanaGroupsOf);

  if (isGrafanaRuleGroups(grafanaGroups)) {
    return { kind: ImportSourceKind.GrafanaAlertRules, documents: objects };
  }

  const monitors: Array<ImportObject> = documents
    .map(readDatadogMonitor)
    .filter((monitor: ImportObject | undefined): boolean => {
      return Boolean(monitor);
    }) as Array<ImportObject>;

  if (monitors.length > 0) {
    return { kind: ImportSourceKind.DatadogMonitors, documents: monitors };
  }

  return undefined;
};

/*
 * The file read for one screen: the dashboards' import takes dashboards,
 * the monitors' alert rules. Throws ImportReadError with what to do.
 */
export const readImportSource: (data: {
  text: string;
  accepts: ReadonlyArray<ImportSourceKind>;
}) => ImportSourceDocument = (data: {
  text: string;
  accepts: ReadonlyArray<ImportSourceKind>;
}): ImportSourceDocument => {
  const documents: Array<unknown> = parseImportText(data.text);
  const classified: ClassifiedDocuments | undefined =
    classifyImportDocuments(documents);
  const wantsDashboards: boolean = data.accepts.some(
    (kind: ImportSourceKind): boolean => {
      return DASHBOARD_SOURCE_KINDS.includes(kind);
    },
  );

  if (!classified) {
    throw new ImportReadError(
      wantsDashboards ? IMPORT_NOT_A_DASHBOARD : IMPORT_NOT_ALERT_RULES,
    );
  }

  if (!data.accepts.includes(classified.kind)) {
    throw new ImportReadError(
      wantsDashboards
        ? IMPORT_ALERTS_ON_DASHBOARDS
        : IMPORT_DASHBOARD_ON_ALERTS,
    );
  }

  return { kind: classified.kind, documents: classified.documents };
};

export { prometheusGroupsOf, grafanaGroupsOf };
