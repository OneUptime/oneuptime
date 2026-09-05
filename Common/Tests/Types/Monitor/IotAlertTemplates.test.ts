import {
  IoTAlertTemplate,
  IoTAlertTemplateArgs,
  IoTAlertTemplateCategory,
  getAllIoTAlertTemplates,
  getIoTAlertTemplateById,
  getIoTAlertTemplatesByCategory,
} from "../../../Types/Monitor/IotAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepIoTMonitor from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * The IoT templates carry two decisions the container templates don't, and
 * both are the point of this suite:
 *
 *   1. INVERTED thresholds. "Bad" for a device is a value that is too LOW —
 *      no heartbeat (iot_device_up < 1), a draining battery (< 20%), a fading
 *      radio (< -100 dBm). So the unhealthy criterion is `<` and the healthy
 *      one is `>=`, the opposite direction from a CPU/memory ceiling. A
 *      copy-paste of a `>`/`<=` pair from the ceiling templates would make the
 *      monitor alert exactly when the device is fine. Temperature and CPU are
 *      genuine ceilings and keep the `>`/`<=` direction — the mix is what makes
 *      pinning each direction per template worthwhile.
 *
 *   2. Per-device grouping. Every template groups by the `device.id` datapoint
 *      label (NOT `resource.`-prefixed — it is a datapoint attribute, not a
 *      resource attribute) so one incident fires per device rather than one
 *      collapsed series for the whole fleet.
 *
 *   3. The Device Offline template — and ONLY it — opts into TreatAsZero so a
 *      registered device that goes completely silent (an empty series) folds
 *      to 0 and trips `Min(iot_device_up) < 1`. Enabling that on a battery or
 *      temperature threshold would false-alarm for any silent device, so the
 *      other templates must NOT carry it.
 */

interface IoTTemplateCase {
  id: string;
  category: IoTAlertTemplateCategory;
  severity: "Critical" | "Warning";
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  offlineFilterType: FilterType;
  onlineFilterType: FilterType;
  threshold: number;
  treatNoDataAsZero: boolean;
}

const IOT_TEMPLATES: Array<IoTTemplateCase> = [
  {
    id: "iot-device-offline",
    category: "Availability",
    severity: "Critical",
    metricName: "iot_device_up",
    metricAlias: "device_up",
    // Min: a single down push in the window must win over healthy pushes.
    aggregation: MetricsAggregationType.Min,
    offlineFilterType: FilterType.LessThan,
    onlineFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 1,
    treatNoDataAsZero: true,
  },
  {
    id: "iot-low-battery",
    category: "Power",
    severity: "Warning",
    metricName: "iot_battery_percent",
    metricAlias: "battery_percent",
    aggregation: MetricsAggregationType.Avg,
    offlineFilterType: FilterType.LessThan,
    onlineFilterType: FilterType.GreaterThanOrEqualTo,
    threshold: 20,
    treatNoDataAsZero: false,
  },
  {
    id: "iot-weak-signal",
    category: "Connectivity",
    severity: "Warning",
    metricName: "iot_signal_strength_dbm",
    metricAlias: "signal_strength",
    aggregation: MetricsAggregationType.Avg,
    offlineFilterType: FilterType.LessThan,
    onlineFilterType: FilterType.GreaterThanOrEqualTo,
    // dBm is negative; -100 is a real threshold, not a placeholder.
    threshold: -100,
    treatNoDataAsZero: false,
  },
  {
    id: "iot-high-temperature",
    category: "Environment",
    severity: "Critical",
    metricName: "iot_temperature_celsius",
    metricAlias: "temperature_celsius",
    // Max: a single hot reading must win over cooler ones in the minute.
    aggregation: MetricsAggregationType.Max,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 70,
    treatNoDataAsZero: false,
  },
  {
    id: "iot-high-cpu",
    category: "System",
    severity: "Warning",
    metricName: "iot_cpu_usage_ratio",
    metricAlias: "cpu_usage",
    aggregation: MetricsAggregationType.Avg,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    // iot_cpu_usage_ratio is a 0-1 ratio, so 0.9 == 90%.
    threshold: 0.9,
    treatNoDataAsZero: false,
  },
];

function buildArgs(): IoTAlertTemplateArgs {
  return {
    fleetIdentifier: "field-fleet-a",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test IoT Monitor",
  };
}

function getIoTMonitor(step: MonitorStep): MonitorStepIoTMonitor {
  const iotMonitor: MonitorStepIoTMonitor | undefined = step.data?.iotMonitor;
  if (!iotMonitor) {
    throw new Error("iotMonitor missing from monitor step");
  }
  return iotMonitor;
}

describe("IotAlertTemplates", () => {
  test("every documented template id is registered and the suite is exhaustive", () => {
    const ids: Array<string> = getAllIoTAlertTemplates().map(
      (t: IoTAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of IOT_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    expect(ids.sort()).toEqual(
      IOT_TEMPLATES.map((t: IoTTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllIoTAlertTemplates().map(
      (t: IoTAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getIoTAlertTemplateById returns undefined for an unknown id", () => {
    expect(getIoTAlertTemplateById("nope")).toBeUndefined();
  });

  test("getIoTAlertTemplatesByCategory returns only that category and covers the catalog", () => {
    const all: Array<IoTAlertTemplate> = getAllIoTAlertTemplates();
    const categories: Array<IoTAlertTemplateCategory> = [
      "Availability",
      "Power",
      "Connectivity",
      "Environment",
      "System",
    ];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<IoTAlertTemplate> =
        getIoTAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    expect(total).toBe(all.length);
  });

  test.each(IOT_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: IoTTemplateCase) => {
      const template: IoTAlertTemplate | undefined = getIoTAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(IOT_TEMPLATES)(
    "$id queries $metricName grouped per device with the intended aggregation",
    (tc: IoTTemplateCase) => {
      const template: IoTAlertTemplate = getIoTAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(step);

      expect(monitor.fleetIdentifier).toBe("field-fleet-a");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(0);

      const queryData: any = queryConfigs[0].metricQueryData;
      expect(queryData.filterData.metricName).toBe(tc.metricName);
      expect(queryData.filterData.aggegationType).toBe(tc.aggregation);

      /*
       * Decision (2): one incident per device — group by the raw datapoint
       * label, which is NOT resource-prefixed.
       */
      expect(queryData.groupByAttributeKeys).toEqual(["device.id"]);
      expect(queryData.groupByAttributeKeys[0].startsWith("resource.")).toBe(
        false,
      );
    },
  );

  test.each(IOT_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: IoTTemplateCase) => {
      const template: IoTAlertTemplate = getIoTAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      expect(instances).toHaveLength(2);
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      expect(offlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(offlineFilter.value).toBe(tc.threshold);
      /*
       * The healthy criteria recovers at a threshold strictly INSIDE the
       * firing one, so a metric hovering at the boundary cannot satisfy
       * both on consecutive evaluations. This assertion used to be
       * `expect(onlineFilter.value).toBe(tc.threshold)` — the two criteria
       * exactly partitioned the range, which is the flapping configuration
       * this suite existed to lock in.
       */
      expect(
        hasRecoveryDeadBand(
          {
            filterType: offlineFilter.filterType,
            value: offlineFilter.value as number,
          },
          {
            filterType: onlineFilter.filterType,
            value: onlineFilter.value as number,
          },
        ),
      ).toBe(true);

      /*
       * Decision (1): pin the exact comparison direction per template — the
       * low-value alerts invert relative to the ceiling alerts.
       */
      expect(offlineFilter.filterType).toBe(tc.offlineFilterType);
      expect(onlineFilter.filterType).toBe(tc.onlineFilterType);

      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
    },
  );

  test.each(IOT_TEMPLATES)(
    "$id applies TreatAsZero only when it is the Device Offline template",
    (tc: IoTTemplateCase) => {
      const template: IoTAlertTemplate = getIoTAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const offline: any = (
        step.data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray as Array<any>
      )[0];
      const online: any = (
        step.data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray as Array<any>
      )[1];

      const offlineNoDataPolicy: NoDataPolicy | undefined =
        offline.data.filters[0].metricMonitorOptions.onNoDataPolicy;

      if (tc.treatNoDataAsZero) {
        // Decision (3): a silent registered device must fold to 0 and alert.
        expect(offlineNoDataPolicy).toBe(NoDataPolicy.TreatAsZero);
      } else {
        // Everything else leaves no-data untouched to avoid false alarms.
        expect(offlineNoDataPolicy).toBeUndefined();
      }

      // The healthy criterion never overrides the no-data policy.
      expect(
        online.data.filters[0].metricMonitorOptions.onNoDataPolicy,
      ).toBeUndefined();
    },
  );

  test("exactly one template opts into TreatAsZero", () => {
    /*
     * Guards decision (3) at the catalog level: if a second template ever
     * enables TreatAsZero, this fails and forces a deliberate review.
     */
    const withTreatAsZero: Array<IoTTemplateCase> = IOT_TEMPLATES.filter(
      (tc: IoTTemplateCase) => {
        return tc.treatNoDataAsZero;
      },
    );
    expect(withTreatAsZero).toHaveLength(1);
    expect(withTreatAsZero[0]!.id).toBe("iot-device-offline");
  });
});
