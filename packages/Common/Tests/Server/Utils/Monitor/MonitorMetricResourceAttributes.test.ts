import Label from "../../../../Models/DatabaseModels/Label";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function makeLabel(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  return label;
}

function buildResponse(
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: PROBE_ID,
    failureCause: "",
    monitoredAt: new Date("2026-08-10T12:00:00.000Z"),
    responseTimeInMs: 250,
    responseCode: 200,
    ...overrides,
  } as ProbeMonitorResponse;
}

describe("MonitorMetricUtil label and custom field attributes", () => {
  let insertedRows: Array<JSONObject>;

  beforeEach(() => {
    insertedRows = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (_data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          return undefined;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(input: {
    response?: ProbeMonitorResponse;
    monitorLabels?: Array<Label>;
    monitorCustomFields?: JSONObject;
  }): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: input.response || buildResponse(),
      monitorName: "Checkout API",
      probeName: "London Probe",
      monitorLabels: input.monitorLabels,
      monitorCustomFields: input.monitorCustomFields,
    });
  }

  function attributesOf(name: MonitorMetricType): JSONObject {
    const row: JSONObject | undefined = insertedRows.find(
      (candidate: JSONObject) => {
        return candidate["name"] === name;
      },
    );

    return (row?.["attributes"] as JSONObject) || {};
  }

  describe("saveMonitorMetrics", () => {
    test("records a bare label as present and a key:value label as its value", async () => {
      await save({
        monitorLabels: [makeLabel("customer-facing"), makeLabel("product:X")],
      });

      const attributes: JSONObject = attributesOf(
        MonitorMetricType.ResponseTime,
      );

      expect(attributes["oneuptime.label.product"]).toBe("X");
      expect(attributes["oneuptime.label.customer_facing"]).toBe("true");
    });

    test("records custom fields alongside labels", async () => {
      await save({
        monitorLabels: [makeLabel("product:checkout")],
        monitorCustomFields: {
          "Owning Team": "Payments",
          Tier: 1 as never,
          Squads: ["Payments", "Billing"] as never,
        },
      });

      const attributes: JSONObject = attributesOf(
        MonitorMetricType.ResponseTime,
      );

      expect(attributes["oneuptime.label.product"]).toBe("checkout");
      expect(attributes["oneuptime.customField.owning_team"]).toBe("Payments");
      expect(attributes["oneuptime.customField.tier"]).toBe("1");
      expect(attributes["oneuptime.customField.squads"]).toBe(
        "Payments, Billing",
      );
    });

    test("stamps EVERY metric row from one check, not just the first", async () => {
      await save({
        response: buildResponse({
          responseTimeInMs: 250,
          responseCode: 503,
        }),
        monitorLabels: [makeLabel("product:X")],
        monitorCustomFields: { Team: "Payments" },
      });

      /*
       * A dashboard grouped by oneuptime.label.product must not find the
       * dimension on response time but missing from status code.
       */
      expect(insertedRows.length).toBeGreaterThan(1);

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        expect(attributes["oneuptime.label.product"]).toBe("X");
        expect(attributes["oneuptime.customField.team"]).toBe("Payments");
      }
    });

    test("keeps the pre-existing monitor and probe identity attributes", async () => {
      await save({
        monitorLabels: [makeLabel("product:X")],
        monitorCustomFields: { Team: "Payments" },
      });

      const attributes: JSONObject = attributesOf(
        MonitorMetricType.ResponseTime,
      );

      expect(attributes["monitorId"]).toBe(MONITOR_ID.toString());
      expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
      expect(attributes["monitorName"]).toBe("Checkout API");
      expect(attributes["probeName"]).toBe("London Probe");
    });

    test("republishes attributeKeys so the new dimensions are filterable", async () => {
      await save({
        monitorLabels: [makeLabel("product:X")],
        monitorCustomFields: { Team: "Payments" },
      });

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        const attributeKeys: Array<string> = row[
          "attributeKeys"
        ] as Array<string>;

        // attributeKeys is what the filter UI reads; a stale copy hides the dimension.
        expect(attributeKeys).toEqual(Object.keys(attributes).sort());
        expect(attributeKeys).toContain("oneuptime.label.product");
        expect(attributeKeys).toContain("oneuptime.customField.team");
      }
    });

    test("records no oneuptime.* attributes when the monitor has neither", async () => {
      await save({});

      expect(insertedRows.length).toBeGreaterThan(0);

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;

        for (const key of Object.keys(attributes)) {
          expect(key.startsWith("oneuptime.")).toBe(false);
        }
      }
    });

    test("leaves attributeKeys consistent when there is nothing to stamp", async () => {
      await save({ monitorLabels: [], monitorCustomFields: {} });

      for (const row of insertedRows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        expect(row["attributeKeys"]).toEqual(Object.keys(attributes).sort());
      }
    });

    test("a custom code monitor's own attributes cannot shadow the namespace", async () => {
      /*
       * Custom code monitors let the user name their own metric attributes.
       * A user-supplied "oneuptime.label.product" must lose to the monitor's
       * real label, or the namespace stops meaning anything.
       */
      await save({
        response: buildResponse({
          customCodeMonitorResponse: {
            logMessages: [],
            scriptError: undefined,
            result: undefined,
            executionTimeInMS: 10,
            capturedMetrics: [
              {
                name: "checkout.latency",
                value: 42,
                attributes: {
                  "oneuptime.label.product": "spoofed",
                  region: "eu-west",
                },
              },
            ],
          } as never,
        }),
        monitorLabels: [makeLabel("product:real")],
      });

      const customRow: JSONObject | undefined = insertedRows.find(
        (row: JSONObject) => {
          return row["name"] === "custom.monitor.checkout.latency";
        },
      );

      expect(customRow).toBeDefined();

      const attributes: JSONObject = customRow?.["attributes"] as JSONObject;

      expect(attributes["oneuptime.label.product"]).toBe("real");
      // the user's non-colliding attribute is untouched
      expect(attributes["region"]).toBe("eu-west");
    });
  });

  describe("applyResourceAttributesToMetricRows", () => {
    function makeRow(attributes: JSONObject): JSONObject {
      return {
        name: "test.metric",
        attributes: attributes,
        attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
      };
    }

    test("is a no-op when the monitor has no labels or custom fields", () => {
      const row: JSONObject = makeRow({ monitorId: "m1" });
      const originalAttributes: JSONObject = row["attributes"] as JSONObject;

      MonitorMetricUtil.applyResourceAttributesToMetricRows({
        metricRows: [row],
      });

      // Same object identity: nothing was rebuilt, so nothing can drift.
      expect(row["attributes"]).toBe(originalAttributes);
      expect(row["attributeKeys"]).toEqual(["monitorId"]);
    });

    test("tolerates a row with no attributes at all", () => {
      const row: JSONObject = { name: "test.metric" };

      MonitorMetricUtil.applyResourceAttributesToMetricRows({
        metricRows: [row],
        labels: [makeLabel("product:X")],
      });

      expect(row["attributes"]).toEqual({ "oneuptime.label.product": "X" });
      expect(row["attributeKeys"]).toEqual(["oneuptime.label.product"]);
    });

    test("stamps an empty row list without throwing", () => {
      expect(() => {
        MonitorMetricUtil.applyResourceAttributesToMetricRows({
          metricRows: [],
          labels: [makeLabel("product:X")],
        });
      }).not.toThrow();
    });

    test("applies the identical attribute set to every row", () => {
      const rows: Array<JSONObject> = [
        makeRow({ monitorId: "m1" }),
        makeRow({ monitorId: "m1", probeName: "London" }),
      ];

      MonitorMetricUtil.applyResourceAttributesToMetricRows({
        metricRows: rows,
        labels: [makeLabel("product:X"), makeLabel("urgent")],
        customFields: { Team: "Payments" },
      });

      for (const row of rows) {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        expect(attributes["oneuptime.label.product"]).toBe("X");
        expect(attributes["oneuptime.label.urgent"]).toBe("true");
        expect(attributes["oneuptime.customField.team"]).toBe("Payments");
      }

      expect((rows[0]?.["attributes"] as JSONObject)["monitorId"]).toBe("m1");
      expect((rows[1]?.["attributes"] as JSONObject)["probeName"]).toBe(
        "London",
      );
    });
  });
});
