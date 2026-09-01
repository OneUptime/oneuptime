import Label from "../../../../Models/DatabaseModels/Label";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import ServiceService from "../../../../Server/Services/ServiceService";
import { getJestSpyOn } from "../../../Spy";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import logger from "../../../../Server/Utils/Logger";
import { MaxCapturedMetricAttributes } from "../../../../Server/Utils/Monitor/CapturedMetricAttributeUtil";
import { AllResourceIdentityLabelKeys } from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import CapturedMetric from "../../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Regression suite for GitHub issue #3514
 * ---------------------------------------------------------------------------
 *
 * The report was that a Custom JavaScript Code Monitor calling only
 * `oneuptime.captureMetric()` auto-created a phantom Service row. It does not,
 * and the first block below pins that down end to end: everything this path
 * writes is a ClickHouse Metric row owned by the MONITOR
 * (primaryEntityType = ServiceType.Monitor, primaryEntityId = the monitor id),
 * and the MetricType it catalogues is never associated with any Service.
 *
 * What the investigation DID find in that path is the inverse problem, and it
 * is the reason the rest of this file exists. Script-supplied attribute keys
 * were copied into the metric row with only five names reserved, so a script
 * could stamp `service.name` / `oneuptime.host.id` / `k8s.cluster.name` on its
 * own datapoints. Those are not decoration — SeriesResourceLabels treats them
 * as the series' resource identity. A stamped `resource.service.name` files
 * the monitor's datapoints straight onto an unrelated Service's Metrics tab,
 * which pins that raw attribute rather than the owning entity id; and any
 * metric monitor grouped by one of these keys turns it into a series label,
 * from where SeriesResourceLinker attaches the named resource to the alerts
 * and incidents that series opens, AlertOwnerRuleEngineService pages that
 * resource's owners, and MonitorMaintenanceSuppression silences the series
 * during a maintenance window on it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const CUSTOM_METRIC_NAME: string = "cursor.usage.lines_accepted";
const CUSTOM_ROW_NAME: string = `custom.monitor.${CUSTOM_METRIC_NAME}`;

function makeLabel(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  return label;
}

describe("MonitorMetricUtil custom metric attributes (issue #3514)", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMetricNames: Dictionary<MetricType>;

  beforeEach(() => {
    insertedRows = [];
    indexedMetricNames = {};

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
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          Object.assign(indexedMetricNames, data.metricNameServiceNameMap);
          return undefined;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function captureMetrics(
    capturedMetrics: Array<CapturedMetric>,
    options: {
      monitorLabels?: Array<Label>;
      monitorCustomFields?: JSONObject;
    } = {},
  ): Promise<void> {
    const response: ProbeMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: ObjectID.generate(),
      probeId: PROBE_ID,
      failureCause: "",
      monitoredAt: new Date("2026-08-10T12:00:00.000Z"),
      customCodeMonitorResponse: {
        logMessages: [],
        scriptError: undefined,
        result: undefined,
        executionTimeInMS: 10,
        capturedMetrics: capturedMetrics,
      },
    } as unknown as ProbeMonitorResponse;

    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: response,
      monitorName: "Cursor usage ingest — daily",
      probeName: "London Probe",
      monitorLabels: options.monitorLabels,
      monitorCustomFields: options.monitorCustomFields,
    });
  }

  function customMetricRow(): JSONObject {
    const row: JSONObject | undefined = insertedRows.find(
      (candidate: JSONObject) => {
        return candidate["name"] === CUSTOM_ROW_NAME;
      },
    );

    expect(row).toBeDefined();

    return row as JSONObject;
  }

  function customMetricAttributes(): JSONObject {
    return customMetricRow()["attributes"] as JSONObject;
  }

  describe("the reported behaviour: captureMetric and Service rows", () => {
    test("owns its metric rows by MONITOR, never by a Service", async () => {
      await captureMetrics([
        { name: CUSTOM_METRIC_NAME, value: 1234, attributes: {} },
      ]);

      const row: JSONObject = customMetricRow();

      expect(row["primaryEntityType"]).toBe(ServiceType.Monitor);
      expect(row["primaryEntityId"]).toBe(MONITOR_ID.toString());

      /*
       * The columns ingest fills in for an OTLP resource. A monitor metric has
       * no OTel resource, so leaving them unset is what keeps this row out of
       * the entity registry — and out of the Services list.
       */
      expect(row["entityKeys"]).toBeUndefined();
      expect(row["serviceEntityKey"]).toBeUndefined();
    });

    test("catalogues the metric name without associating any Service", async () => {
      await captureMetrics([
        { name: CUSTOM_METRIC_NAME, value: 1234, attributes: {} },
      ]);

      const metricType: MetricType | undefined =
        indexedMetricNames[CUSTOM_ROW_NAME];

      expect(metricType).toBeDefined();
      expect(metricType?.name).toBe(CUSTOM_ROW_NAME);

      /*
       * `services` left unset is what makes TelemetryUtil's junction insert a
       * no-op. A Service attached here would be the closest this path could
       * ever come to the reported phantom service.
       */
      expect(metricType?.services).toBeUndefined();
    });

    test("stamps no attribute that names a Service, even when the script tries", async () => {
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1234,
          attributes: {
            "service.name": "Cursor",
            "resource.service.name": "Cursor",
            "oneuptime.service.name": "Cursor",
            "oneuptime.service.id": "44444444-4444-4444-8444-444444444444",
            "ai.tool": "cursor",
          },
        },
      ]);

      const attributes: JSONObject = customMetricAttributes();

      expect(attributes["service.name"]).toBeUndefined();
      expect(attributes["resource.service.name"]).toBeUndefined();
      expect(attributes["oneuptime.service.name"]).toBeUndefined();
      expect(attributes["oneuptime.service.id"]).toBeUndefined();

      // The script's own dimension is untouched.
      expect(attributes["ai.tool"]).toBe("cursor");
    });

    test("creates no Service row — the literal claim in the issue", async () => {
      /*
       * The narrowest possible statement of what was reported. Postgres has
       * exactly one automatic Service creator
       * (OpenTelemetryIngestService.findOrCreateTelemetryService, itself the
       * only production caller of ServiceService.create), so a spy on that
       * one method is a complete assertion for this path.
       */
      const create: jest.SpyInstance<any, any> = getJestSpyOn(
        ServiceService,
        "create",
      );

      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1234,
          attributes: { "service.name": "Cursor", "ai.tool": "cursor" },
        },
      ]);

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("resource identity cannot be claimed by a script", () => {
    test("drops every key the series-label resolver reads as resource identity", async () => {
      const attributes: JSONObject = {};
      for (const key of AllResourceIdentityLabelKeys) {
        attributes[key] = "borrowed";
      }
      attributes["region"] = "us-east-1";

      await captureMetrics([
        { name: CUSTOM_METRIC_NAME, value: 1, attributes: attributes },
      ]);

      const recorded: JSONObject = customMetricAttributes();

      for (const key of AllResourceIdentityLabelKeys) {
        expect(recorded[key]).toBeUndefined();
      }

      expect(recorded["region"]).toBe("us-east-1");
    });

    test("drops the monitor's own identity attributes so a script cannot re-file its data", async () => {
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: {
            monitorId: "99999999-9999-4999-8999-999999999999",
            projectId: "88888888-8888-4888-8888-888888888888",
            monitorName: "Some Other Monitor",
            probeName: "Some Other Probe",
            probeId: "77777777-7777-4777-8777-777777777777",
            isCustomMetric: "false",
          },
        },
      ]);

      const attributes: JSONObject = customMetricAttributes();

      expect(attributes["monitorId"]).toBe(MONITOR_ID.toString());
      expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
      expect(attributes["monitorName"]).toBe("Cursor usage ingest — daily");
      expect(attributes["probeName"]).toBe("London Probe");
      expect(attributes["probeId"]).toBe(PROBE_ID.toString());
      expect(attributes["isCustomMetric"]).toBe("true");
    });

    test("drops a spoofed oneuptime.label.* even when the monitor has NO labels of its own", async () => {
      /*
       * The old guarantee came from merging the monitor's real labels last,
       * which does nothing at all for a monitor that has none — so this case
       * used to record the spoofed value verbatim.
       */
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: { "oneuptime.label.product": "spoofed" },
        },
      ]);

      expect(
        customMetricAttributes()["oneuptime.label.product"],
      ).toBeUndefined();
    });

    test("still lets the monitor's real labels through", async () => {
      await captureMetrics(
        [{ name: CUSTOM_METRIC_NAME, value: 1, attributes: { q: "1" } }],
        { monitorLabels: [makeLabel("product:checkout")] },
      );

      const attributes: JSONObject = customMetricAttributes();

      expect(attributes["oneuptime.label.product"]).toBe("checkout");
      expect(attributes["q"]).toBe("1");
    });

    test("names every dropped key in ONE log line for the whole check", async () => {
      /*
       * The diagnostic is the whole reason a user can tell a refused
       * attribute from a bug in their script. One line per check, not one per
       * datapoint, or a script emitting 100 metrics floods the log.
       */
      const warn: jest.SpyInstance<any, any> = getJestSpyOn(
        logger,
        "warn",
      ).mockImplementation((): void => {
        return undefined;
      });

      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: { "service.name": "Cursor", region: "us-east-1" },
        },
        {
          name: CUSTOM_METRIC_NAME,
          value: 2,
          attributes: { "service.name": "Cursor", "host.name": "web-01" },
        },
      ]);

      expect(warn).toHaveBeenCalledTimes(1);

      const message: string = String(warn.mock.calls[0]?.[0]);

      expect(message).toContain(MONITOR_ID.toString());
      // Deduped across the two metrics, and sorted so the line is stable.
      expect(message).toContain("host.name, service.name");
      expect(message).not.toContain("region");
    });

    test("says nothing when the script writes only attributes it owns", async () => {
      const warn: jest.SpyInstance<any, any> = getJestSpyOn(
        logger,
        "warn",
      ).mockImplementation((): void => {
        return undefined;
      });

      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: { region: "us-east-1", "ai.tool": "cursor" },
        },
      ]);

      expect(warn).not.toHaveBeenCalled();
    });

    test("republishes attributeKeys so a dropped key is not left behind in the filter list", async () => {
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: { "service.name": "Cursor", region: "us-east-1" },
        },
      ]);

      const row: JSONObject = customMetricRow();
      const attributes: JSONObject = row["attributes"] as JSONObject;
      const attributeKeys: Array<string> = row[
        "attributeKeys"
      ] as Array<string>;

      expect(attributeKeys).toEqual(Object.keys(attributes).sort());
      expect(attributeKeys).not.toContain("service.name");
      expect(attributeKeys).toContain("region");
    });
  });

  describe("values and limits", () => {
    test("records numbers and booleans instead of silently dropping them", async () => {
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: {
            seats: 42,
            active: true,
            suspended: false,
            tool: "cursor",
          },
        },
      ]);

      const attributes: JSONObject = customMetricAttributes();

      expect(attributes["seats"]).toBe("42");
      expect(attributes["active"]).toBe("true");
      expect(attributes["suspended"]).toBe("false");
      expect(attributes["tool"]).toBe("cursor");
    });

    test("caps the number of script-supplied attributes on one metric", async () => {
      const attributes: JSONObject = {};
      for (let i: number = 0; i < MaxCapturedMetricAttributes + 30; i++) {
        attributes[`dimension${i}`] = "value";
      }

      await captureMetrics([
        { name: CUSTOM_METRIC_NAME, value: 1, attributes: attributes },
      ]);

      const recorded: JSONObject = customMetricAttributes();
      const scriptKeys: Array<string> = Object.keys(recorded).filter(
        (key: string) => {
          return key.startsWith("dimension");
        },
      );

      expect(scriptKeys).toHaveLength(MaxCapturedMetricAttributes);
    });

    test("does not pollute Object.prototype through a dotted __proto__ key", async () => {
      await captureMetrics([
        {
          name: CUSTOM_METRIC_NAME,
          value: 1,
          attributes: {
            "__proto__.polluted": "pwned",
            region: "us-east-1",
          },
        },
      ]);

      expect(({} as JSONObject)["polluted"]).toBeUndefined();
      expect(customMetricAttributes()["region"]).toBe("us-east-1");
    });

    test("the guard applies to synthetic monitor captured metrics too", async () => {
      /*
       * Probes are separately deployed processes. The synthetic runtime caps
       * and coerces in-sandbox, but the server must not take a probe's word
       * for what a script was allowed to write.
       */
      const response: ProbeMonitorResponse = {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: ObjectID.generate(),
        probeId: PROBE_ID,
        failureCause: "",
        monitoredAt: new Date("2026-08-10T12:00:00.000Z"),
        syntheticMonitorResponse: [
          {
            logMessages: [],
            scriptError: undefined,
            result: undefined,
            executionTimeInMS: 10,
            browserType: "Chromium",
            screenSizeType: "Desktop",
            capturedMetrics: [
              {
                name: CUSTOM_METRIC_NAME,
                value: 5,
                attributes: { "host.name": "web-01", page: "checkout" },
              },
            ],
          },
        ],
      } as unknown as ProbeMonitorResponse;

      await MonitorMetricUtil.saveMonitorMetrics({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        dataToProcess: response,
        monitorName: "Checkout journey",
        probeName: "London Probe",
      });

      const attributes: JSONObject = customMetricAttributes();

      expect(attributes["host.name"]).toBeUndefined();
      expect(attributes["page"]).toBe("checkout");
    });
  });
});
