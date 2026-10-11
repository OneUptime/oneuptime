import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepIoTMonitor from "../../../../Types/Monitor/MonitorStepIoTMonitor";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import ObjectID from "../../../../Types/ObjectID";
import {
  IoTAlertTemplate,
  getAllIoTAlertTemplates,
} from "../../../../Types/Monitor/IotAlertTemplates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An IoT Device monitor is evaluated as metric series, like a Metrics or a
 * Kubernetes monitor: the worker answers it with a MetricMonitorResponse
 * (MonitorTelemetryMonitor.monitorIoT) and MonitorCriteriaEvaluator hands its
 * criteria to MetricMonitorCriteria. Its incident and alert templates read
 * the same variables as theirs: {{metricName}}, and on a monitor grouped by
 * device the series labels ({{device.id}}, {{seriesLabels}}). The template
 * util used to keep its own list of metric types without IoT Device, so an
 * IoT incident title written as "{{metricName}} on {{device.id}}" kept its
 * {{metricName}} as written.
 */

const DEVICE_LABELS: JSONObject = { "device.id": "sensor-001" };

function iotStep(template: IoTAlertTemplate): MonitorStepIoTMonitor {
  const step: MonitorStep = template.getMonitorStep({
    fleetIdentifier: "warehouse-sensors",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Warehouse sensors",
  });

  return step.data!.iotMonitor!;
}

// What monitorIoT answers for a step: its metric view, and no series yet.
function iotResponse(metricViewConfig: MetricsViewConfig): DataToProcess {
  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: metricViewConfig,
  };

  return response as unknown as DataToProcess;
}

function iotMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = "Warehouse sensors";
  monitor.monitorType = MonitorType.IoTDevice;
  return monitor;
}

function storageMapFor(
  template: IoTAlertTemplate,
  seriesLabels?: JSONObject | undefined,
): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.IoTDevice,
    dataToProcess: iotResponse(iotStep(template).metricViewConfig),
    monitor: iotMonitor(),
    seriesLabels,
  });
}

const DEVICE_OFFLINE: IoTAlertTemplate = getAllIoTAlertTemplates().find(
  (template: IoTAlertTemplate): boolean => {
    return template.id === "iot-device-offline";
  },
)!;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateUtil - IoT Device monitors get the metric variables", () => {
  test("the Device Offline template is the one these cases are built on", () => {
    expect(DEVICE_OFFLINE).toBeDefined();
    expect(
      iotStep(DEVICE_OFFLINE).metricViewConfig.queryConfigs[0]!.metricQueryData
        .filterData.metricName,
    ).toBe("iot_device_up");
  });

  test("{{metricName}} is the metric the monitor's first query reads", () => {
    const map: JSONObject = storageMapFor(DEVICE_OFFLINE);

    expect(map["metricName"]).toBe("iot_device_up");
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "[IoT] {{metricName}} is down on {{monitorName}}",
        storageMap: map,
      }),
    ).toBe("[IoT] iot_device_up is down on Warehouse sensors");
  });

  test.each(getAllIoTAlertTemplates().map((template: IoTAlertTemplate) => {
    return [template.id, template];
  }))(
    "every IoT alert template's metric reaches {{metricName}} (%s)",
    (_id: string, template: IoTAlertTemplate) => {
      const expected: unknown =
        iotStep(template).metricViewConfig.queryConfigs[0]!.metricQueryData
          .filterData.metricName;

      expect(typeof expected).toBe("string");
      expect(storageMapFor(template)["metricName"]).toBe(expected);
    },
  );

  test("a device-grouped monitor also gets the device's series labels", () => {
    const map: JSONObject = storageMapFor(DEVICE_OFFLINE, DEVICE_LABELS);

    expect(map["metricName"]).toBe("iot_device_up");
    expect(map["seriesLabels"]).toEqual(DEVICE_LABELS);
    expect((map["device"] as JSONObject)["id"]).toBe("sensor-001");
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{metricName}} on {{device.id}}",
        storageMap: map,
      }),
    ).toBe("iot_device_up on sensor-001");
  });

  test("the title and the description both render every placeholder", () => {
    const map: JSONObject = storageMapFor(DEVICE_OFFLINE, DEVICE_LABELS);
    const title: string = MonitorTemplateUtil.processTemplateString({
      value: "{{metricName}} below 1 on {{device.id}}{{seriesResourceSuffix}}",
      storageMap: MonitorTemplateUtil.buildTitleStorageMap({
        monitorType: MonitorType.IoTDevice,
        storageMap: map,
      }),
    });
    const description: string =
      MonitorTemplateUtil.processMarkdownTemplateString({
        value: "Metric `{{metricName}}` on device {{device.id}}.",
        storageMap: map,
      });

    expect(title).not.toContain("{{");
    expect(title.startsWith("iot_device_up below 1 on sensor-001")).toBe(true);
    expect(description).not.toContain("{{");
    expect(description).toContain("iot_device_up");
    expect(description).toContain("sensor-001");
  });

  test("an ungrouped IoT monitor still has {{metricName}}, and no series labels", () => {
    const map: JSONObject = storageMapFor(DEVICE_OFFLINE);

    expect(map["metricName"]).toBe("iot_device_up");
    expect("seriesLabels" in map).toBe(false);
    expect(map["seriesResourceSuffix"]).toBe("");
  });

  test("a response with no metric view gives an empty name, never the placeholder", () => {
    const map: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.IoTDevice,
      dataToProcess: {} as unknown as DataToProcess,
    });

    expect(map["metricName"]).toBe("");
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "[{{metricName}}]",
        storageMap: map,
      }),
    ).toBe("[]");
  });

  test("an IoT monitor gets exactly the variables a Metrics monitor gets for the same check", () => {
    const view: MetricsViewConfig = iotStep(DEVICE_OFFLINE).metricViewConfig;
    const keysFor: (monitorType: MonitorType) => Array<string> = (
      monitorType: MonitorType,
    ): Array<string> => {
      return Object.keys(
        MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType,
          dataToProcess: iotResponse(view),
          seriesLabels: DEVICE_LABELS,
        }),
      ).sort();
    };

    expect(keysFor(MonitorType.IoTDevice)).toEqual(
      keysFor(MonitorType.Metrics),
    );
  });
});
