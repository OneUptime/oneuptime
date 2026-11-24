import { describe, expect, test } from "@jest/globals";
import { ImportSourceKind } from "../../../Types/ObservabilityImport/ObservabilityImport";
import {
  ALERT_SOURCE_KINDS,
  DASHBOARD_SOURCE_KINDS,
  IMPORT_ALERTS_ON_DASHBOARDS,
  IMPORT_DASHBOARD_ON_ALERTS,
  IMPORT_NOT_ALERT_RULES,
  IMPORT_NOT_A_DASHBOARD,
  IMPORT_TEXT_EMPTY,
  IMPORT_TEXT_TOO_LARGE,
  IMPORT_TEXT_UNREADABLE,
  ImportReadError,
  ImportSourceDocument,
  classifyImportDocuments,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import { readFixture } from "./ImportFixtures";

/*
 * What a pasted file is (issue #7697): told apart by the shape each tool
 * writes, parsed strictly, and refused with what to do when it is none of
 * them - or the other screen's.
 */

const readError: (run: () => unknown) => ImportReadError = (
  run: () => unknown,
): ImportReadError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ImportReadError) {
      return error;
    }

    throw error;
  }

  throw new Error("expected an ImportReadError");
};

describe("each tool's file, by its shape", () => {
  test.each([
    ["grafana-node-exporter-full.json.gz", ImportSourceKind.GrafanaDashboard],
    [
      "grafana-node-exporter-full-old.json.gz",
      ImportSourceKind.GrafanaDashboard,
    ],
    ["grafana-k8s-views-pods.json.gz", ImportSourceKind.GrafanaDashboard],
    ["grafana-mixed-loki-prometheus.json", ImportSourceKind.GrafanaDashboard],
    [
      "datadog-dashboard-nginx-overview.json",
      ImportSourceKind.DatadogDashboard,
    ],
    [
      "datadog-dashboard-redis-overview.json",
      ImportSourceKind.DatadogDashboard,
    ],
  ])("%s is a %s", (name: string, kind: ImportSourceKind) => {
    expect(
      readImportSource({
        text: readFixture(name),
        accepts: DASHBOARD_SOURCE_KINDS,
      }).kind,
    ).toBe(kind);
  });

  test.each([
    ["prometheus-rule-node-exporter.yaml", ImportSourceKind.PrometheusRules],
    ["prometheus-rules.yaml", ImportSourceKind.PrometheusRules],
    ["grafana-alert-rules-export.yaml", ImportSourceKind.GrafanaAlertRules],
    [
      "datadog-monitor-redis-high-memory.json",
      ImportSourceKind.DatadogMonitors,
    ],
  ])("%s is %s", (name: string, kind: ImportSourceKind) => {
    expect(
      readImportSource({ text: readFixture(name), accepts: ALERT_SOURCE_KINDS })
        .kind,
    ).toBe(kind);
  });

  test("Grafana's API answer is read inside its wrapper", () => {
    const source: ImportSourceDocument = readImportSource({
      text: JSON.stringify({
        dashboard: { title: "API", schemaVersion: 39, panels: [] },
        meta: { slug: "api" },
      }),
      accepts: DASHBOARD_SOURCE_KINDS,
    });

    expect(source.kind).toBe(ImportSourceKind.GrafanaDashboard);
    expect(source.documents[0]?.["title"]).toBe("API");
  });

  test("Datadog's monitor list, one monitor, and an integration's asset are all monitors", () => {
    const monitor: Record<string, unknown> = {
      name: "CPU",
      type: "metric alert",
      query: "avg(last_5m):avg:system.cpu.user{*} > 90",
    };

    expect(
      classifyImportDocuments([[monitor, { ...monitor, name: "CPU 2" }]])
        ?.documents,
    ).toHaveLength(2);
    expect(classifyImportDocuments([monitor])?.kind).toBe(
      ImportSourceKind.DatadogMonitors,
    );
    expect(
      classifyImportDocuments([{ version: 2, definition: monitor }])
        ?.documents[0]?.["name"],
    ).toBe("CPU");
  });

  test("a PrometheusRule, a List of them and several YAML documents are rule files", () => {
    const group: string =
      "groups:\n  - name: a\n    rules:\n      - alert: Up\n        expr: up == 0\n";

    expect(
      readImportSource({
        text: `apiVersion: v1\nkind: List\nitems:\n  - kind: PrometheusRule\n    spec:\n      ${group
          .split("\n")
          .join("\n      ")}`,
        accepts: ALERT_SOURCE_KINDS,
      }).kind,
    ).toBe(ImportSourceKind.PrometheusRules);

    expect(
      readImportSource({
        text: `${group}---\n${group}`,
        accepts: ALERT_SOURCE_KINDS,
      }).documents,
    ).toHaveLength(2);
  });

  test("the ruler API's folders of Grafana rules are Grafana's alert rules", () => {
    expect(
      readImportSource({
        text: JSON.stringify({
          Services: [
            {
              name: "checkout",
              rules: [
                {
                  grafana_alert: { title: "A", condition: "B", data: [] },
                },
              ],
            },
          ],
        }),
        accepts: ALERT_SOURCE_KINDS,
      }).kind,
    ).toBe(ImportSourceKind.GrafanaAlertRules);
  });
});

describe("what is refused, and how it is said", () => {
  test("nothing pasted", () => {
    expect(
      readError(() => {
        return readImportSource({
          text: "  \n ",
          accepts: DASHBOARD_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_TEXT_EMPTY);
  });

  test("text that is neither JSON nor YAML says the parser's words", () => {
    const error: ImportReadError = readError(() => {
      return readImportSource({
        text: "{ not: [json",
        accepts: DASHBOARD_SOURCE_KINDS,
      });
    });

    expect(error.text).toBe(IMPORT_TEXT_UNREADABLE);
    expect(error.values["error"]).toBeTruthy();
  });

  test("a file larger than any export", () => {
    expect(
      readError(() => {
        return readImportSource({
          text: `{"a":"${"x".repeat(10 * 1024 * 1024)}"}`,
          accepts: DASHBOARD_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_TEXT_TOO_LARGE);
  });

  test("JSON of some other shape is no dashboard, and no rule file", () => {
    expect(
      readError(() => {
        return readImportSource({
          text: '{"hello": "world"}',
          accepts: DASHBOARD_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_NOT_A_DASHBOARD);
    expect(
      readError(() => {
        return readImportSource({
          text: '{"hello": "world"}',
          accepts: ALERT_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_NOT_ALERT_RULES);
  });

  test("a file of the other screen's kind says where it goes", () => {
    expect(
      readError(() => {
        return readImportSource({
          text: readFixture("prometheus-rules.yaml"),
          accepts: DASHBOARD_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_ALERTS_ON_DASHBOARDS);
    expect(
      readError(() => {
        return readImportSource({
          text: readFixture("datadog-dashboard-postgresql.json"),
          accepts: ALERT_SOURCE_KINDS,
        });
      }).text,
    ).toBe(IMPORT_DASHBOARD_ON_ALERTS);
  });

  test("YAML that would build objects of code is read as data, or refused", () => {
    // js-yaml's default schema has no tag that runs code.
    expect(() => {
      return readImportSource({
        text: "groups: !!js/function 'function () { return 1 }'",
        accepts: ALERT_SOURCE_KINDS,
      });
    }).toThrow(ImportReadError);
  });

  test("a key named __proto__ is read as no field", () => {
    const source: ImportSourceDocument = readImportSource({
      text: '{"__proto__": {"panels": []}, "title": "x", "schemaVersion": 39, "panels": []}',
      accepts: DASHBOARD_SOURCE_KINDS,
    });

    expect(source.kind).toBe(ImportSourceKind.GrafanaDashboard);
    expect(({} as Record<string, unknown>)["panels"]).toBeUndefined();
  });
});
