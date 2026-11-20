import { describe, expect, jest, test } from "@jest/globals";
import {
  RequestBodyMaxBytes,
  RequestBodyMaxJsonValues,
} from "../../../Server/EnvironmentConfig";
import {
  DASHBOARD_VIEW_CONFIG_COLUMN,
  assertDashboardWriteValues,
} from "../../../Server/Services/DashboardService";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  DashboardImportPlan,
  DashboardImportVariable,
  ImportItemStatus,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import JsonElementCounter, {
  JsonElementTallyCount,
} from "../../../Utils/JsonElementCount";
import {
  DASHBOARD_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  buildImportedDashboardViewConfig,
  getCreatedDashboardItems,
  planDashboardImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import { readFixture } from "./ImportFixtures";

jest.mock("../../../Server/Utils/Logger");

/*
 * The dashboard an import creates (issue #7697): the board the plan lays
 * out, sent through the same create the dashboard form uses - so it must
 * pass the server's checks of a dashboard's config, and fit the ordinary
 * request body limits (RequestBodyLimit): the import adds no route of its
 * own that takes more. Grafana's Node Exporter Full, 137 panels, is the
 * largest dashboard here.
 */

const plan: (name: string) => DashboardImportPlan = (
  name: string,
): DashboardImportPlan => {
  return planDashboardImport(
    readImportSource({
      text: readFixture(name),
      accepts: DASHBOARD_SOURCE_KINDS,
    }),
  );
};

// The create's body, as ModelAPI sends the dashboard the import makes.
const createBody: (config: DashboardViewConfig) => {
  text: string;
  viewConfig: JSONValue;
} = (config: DashboardViewConfig): { text: string; viewConfig: JSONValue } => {
  const viewConfig: JSONValue = JSONFunctions.serializeValue(
    config as unknown as JSONValue,
  );

  return {
    viewConfig,
    text: JSON.stringify({
      data: {
        name: "Node Exporter Full",
        description: "Imported from Grafana.",
        dashboardViewConfig: viewConfig,
      },
    }),
  };
};

describe("each dashboard an import creates", () => {
  test.each([
    "grafana-node-exporter-full.json.gz",
    "grafana-node-exporter-full-old.json.gz",
    "grafana-k8s-views-namespaces.json.gz",
    "grafana-k8s-views-pods.json.gz",
    "grafana-mixed-loki-prometheus.json",
    "datadog-dashboard-nginx-overview.json",
    "datadog-dashboard-redis-overview.json",
    "datadog-dashboard-postgresql.json",
  ])(
    "%s passes the server's checks, fits the ordinary body limits, and reads back as built",
    (name: string) => {
      const imported: DashboardImportPlan = plan(name);
      const config: DashboardViewConfig = buildImportedDashboardViewConfig({
        plan: imported,
      });
      const body: { text: string; viewConfig: JSONValue } = createBody(config);

      expect(() => {
        assertDashboardWriteValues({
          [DASHBOARD_VIEW_CONFIG_COLUMN]: body.viewConfig,
        });
      }).not.toThrow();

      expect(Buffer.byteLength(body.text, "utf8")).toBeLessThan(
        RequestBodyMaxBytes,
      );

      const count: JsonElementTallyCount = JsonElementCounter.countText(
        body.text,
        {
          values: RequestBodyMaxJsonValues,
          objectsArraysAndStrings: RequestBodyMaxJsonValues,
        },
      );

      expect(count.passed).toBeNull();
      expect(count.values).toBeLessThan(RequestBodyMaxJsonValues);

      // Read back as every reader reads a stored config.
      expect(
        StoredDashboardViewConfig.read(body.viewConfig).components,
      ).toHaveLength(getCreatedDashboardItems(imported).length);
    },
  );

  test("Node Exporter Full, the largest, uses well under half of either limit", () => {
    const body: { text: string; viewConfig: JSONValue } = createBody(
      buildImportedDashboardViewConfig({
        plan: plan("grafana-node-exporter-full.json.gz"),
      }),
    );

    expect(Buffer.byteLength(body.text, "utf8")).toBeLessThan(
      RequestBodyMaxBytes / 2,
    );
    expect(
      JsonElementCounter.countText(body.text, {
        values: RequestBodyMaxJsonValues,
        objectsArraysAndStrings: RequestBodyMaxJsonValues,
      }).values,
    ).toBeLessThan(RequestBodyMaxJsonValues / 2);
  });
});

describe("the board built from a plan", () => {
  const nef: DashboardImportPlan = plan("grafana-node-exporter-full.json.gz");

  test("every converted item's widget, where the plan placed it, on a board tall enough for all of them", () => {
    const config: DashboardViewConfig = buildImportedDashboardViewConfig({
      plan: nef,
    });

    expect(config.components).toHaveLength(
      nef.items.filter(
        (item: DashboardImportPlan["items"][number]): boolean => {
          return item.status !== ImportItemStatus.NotConverted;
        },
      ).length,
    );

    const bottom: number = Math.max(
      ...config.components.map((component: DashboardBaseComponent): number => {
        return component.topInDashboardUnits + component.heightInDashboardUnits;
      }),
    );

    expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(bottom);
    expect(config.timeRange).toBe(nef.viewConfigDefaults.timeRange);
    expect(config.refreshInterval).toBe(nef.viewConfigDefaults.refreshInterval);
  });

  test("a variable the source starts on its first value starts on the value looked up; others as they were", () => {
    const node: DashboardImportVariable | undefined = nef.variables.find(
      (variable: DashboardImportVariable): boolean => {
        return variable.sourceName === "node";
      },
    );

    const config: DashboardViewConfig = buildImportedDashboardViewConfig({
      plan: nef,
      startingValues: new Map<string, string>([
        [node?.key || "", "10.0.0.1:9100"],
      ]),
    });
    const variables: Array<DashboardVariable> = config.variables || [];

    expect(
      variables.find((variable: DashboardVariable): boolean => {
        return variable.name === "node";
      })?.defaultValue,
    ).toBe("10.0.0.1:9100");

    // The data source variable is not one of the board's.
    expect(
      variables.some((variable: DashboardVariable): boolean => {
        return variable.name === "ds_prometheus";
      }),
    ).toBe(false);
  });

  test("a multi-value variable keeps All, whatever was looked up", () => {
    const namespaces: DashboardImportPlan = plan(
      "grafana-k8s-views-namespaces.json.gz",
    );
    const namespace: DashboardImportVariable | undefined =
      namespaces.variables.find(
        (variable: DashboardImportVariable): boolean => {
          return variable.sourceName === "namespace";
        },
      );

    const config: DashboardViewConfig = buildImportedDashboardViewConfig({
      plan: namespaces,
      startingValues: new Map<string, string>([
        [namespace?.key || "", "kube-system"],
      ]),
    });

    expect(
      (config.variables || []).find((variable: DashboardVariable): boolean => {
        return variable.name === "namespace";
      })?.defaultValue,
    ).toBeUndefined();
  });
});
