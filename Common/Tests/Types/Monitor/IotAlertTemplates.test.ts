import {
  IoTAlertTemplate,
  IoTAlertTemplateArgs,
  IoTAlertTemplateCategory,
  buildIoTMonitorConfig,
  getAllIoTAlertTemplates,
  getIoTAlertTemplateById,
  getIoTAlertTemplatesByCategory,
} from "../../../Types/Monitor/IotAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepIoTMonitor from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import { getIoTMetricByMetricName } from "../../../Types/Monitor/IotMetricCatalog";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * The IoT templates carry decisions the container templates don't, and each
 * one is the point of this suite:
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
 *
 *   4. Device Offline is also the only template that is BINARY, the only one
 *      with a window wider than five minutes, and the only one that fires on
 *      AnyValue. Those three are one decision seen from three sides, and each
 *      of them is a bug the moment it appears on a second template — so every
 *      one is pinned per template AND counted at the catalog level below.
 *
 *   5. Every template labels its series with the unit IotMetricCatalog already
 *      declares, because the criteria root cause prints that unit next to both
 *      the sample and the threshold.
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
  /*
   * The metric only ever takes two values, so the fire/recover pair has no
   * "slightly better" state to sit in and must partition the range exactly.
   * A dead band here would be UNREACHABLE — `iot_device_up >= 1.1` can never
   * match — which is the regression this flag pins.
   */
  isBinaryMetric: boolean;
  /*
   * The rolling window. For Device Offline this is the silence grace period a
   * duty-cycled device is allowed, not a detection latency — see the sweep
   * below.
   */
  rollingTime: RollingTime;
  /*
   * The quantifier on the FIRING side. AllValues (sustained) everywhere except
   * Device Offline, whose signal is an explicit event rather than a level.
   */
  fireAggregation: EvaluateOverTimeType;
  // The unit IotMetricCatalog declares for `metricName`, if any.
  legendUnit: string | undefined;
  // The threshold as the incident title states it, in the unit it compares.
  incidentTitleFragment: string;
  /*
   * The complete set of values the metric can take, for the templates whose
   * metric has a finite domain. Set only for Device Offline today; a future
   * binary template must set it too, so the reachability sweep covers it.
   */
  metricValueDomain?: Array<number> | undefined;
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
    isBinaryMetric: true,
    rollingTime: RollingTime.Past30Minutes,
    fireAggregation: EvaluateOverTimeType.AnyValue,
    // iot_device_up carries no unit in the catalog — it is a bare 0/1 gauge.
    legendUnit: undefined,
    incidentTitleFragment: "Device Offline",
    metricValueDomain: [0, 1],
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
    isBinaryMetric: false,
    rollingTime: RollingTime.Past5Minutes,
    fireAggregation: EvaluateOverTimeType.AllValues,
    legendUnit: "%",
    incidentTitleFragment: "Low Battery (<20%)",
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
    isBinaryMetric: false,
    rollingTime: RollingTime.Past5Minutes,
    fireAggregation: EvaluateOverTimeType.AllValues,
    legendUnit: "dBm",
    incidentTitleFragment: "Weak Signal (<-100 dBm)",
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
    isBinaryMetric: false,
    rollingTime: RollingTime.Past5Minutes,
    fireAggregation: EvaluateOverTimeType.AllValues,
    legendUnit: "°C",
    incidentTitleFragment: "High Temperature (>70°C)",
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
    isBinaryMetric: false,
    rollingTime: RollingTime.Past5Minutes,
    fireAggregation: EvaluateOverTimeType.AllValues,
    legendUnit: "ratio",
    /*
     * The title states the ratio, not the percentage, because the criteria
     * compares 0.9 and the root cause prints "ratio".
     */
    incidentTitleFragment: "High CPU Usage (ratio >0.9)",
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

function getCriteriaInstances(id: string): Array<any> {
  const step: MonitorStep =
    getIoTAlertTemplateById(id)!.getMonitorStep(buildArgs());
  return step.data?.monitorCriteria.data
    ?.monitorCriteriaInstanceArray as Array<any>;
}

function getUnhealthyFilter(id: string): any {
  return getCriteriaInstances(id)[0].data.filters[0];
}

function getHealthyFilter(id: string): any {
  return getCriteriaInstances(id)[1].data.filters[0];
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
       * The window each template evaluates over. Left unpinned, Device
       * Offline's silence grace period could be narrowed back to five minutes
       * without a single test noticing.
       */
      expect(monitor.rollingTime).toBe(tc.rollingTime);

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
    "$id unhealthy/healthy criteria partition $threshold, with a dead band wherever one is meaningful",
    (tc: IoTTemplateCase) => {
      const instances: Array<any> = getCriteriaInstances(tc.id);
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

      if (tc.isBinaryMetric) {
        /*
         * iot_device_up is 0 or 1. There is no "slightly better" value to sit
         * in, so the pair partitions the range exactly — and a dead band ABOVE
         * 1 would be unreachable, which is the bug this pins.
         */
        expect(onlineFilter.value).toBe(tc.threshold);
      } else {
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
      }

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

  test("iot-device-offline's healthy threshold is reachable by a 0/1 metric", () => {
    const filter: any = getHealthyFilter("iot-device-offline");

    expect(filter.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    /*
     * A 10% dead band would put this at 1.1. iot_device_up only ever takes 0
     * or 1 (MqttTelemetryMapper emits exactly 1/0; IoTSnapshotScan reads it
     * as `isUp = rawValue >= 1`; the per-minute bucket reducer is Min, so it
     * cannot lift a sample above 1 either). Anything above 1 makes the
     * healthy criteria unmatchable: MonitorResource then takes its "no
     * criteria met" branch every evaluation, the configured Online status is
     * dead code, and a device that comes back up never produces an Online
     * transition.
     */
    expect(filter.value).toBeLessThanOrEqual(1);
    expect(filter.value).toBe(1);
  });

  test.each(
    IOT_TEMPLATES.filter((tc: IoTTemplateCase) => {
      return Boolean(tc.metricValueDomain);
    }),
  )(
    "$id healthy criteria is satisfiable somewhere in its metric's value domain",
    (tc: IoTTemplateCase) => {
      /*
       * Generalises the guard above so the next template over a finite-domain
       * metric cannot ship the same defect: at least one value the metric can
       * actually emit has to satisfy the recovery comparison.
       */
      const filter: any = getHealthyFilter(tc.id);

      const satisfied: Array<number> = tc.metricValueDomain!.filter(
        (v: number) => {
          return filter.filterType === FilterType.GreaterThanOrEqualTo
            ? v >= filter.value
            : v <= filter.value;
        },
      );

      expect(satisfied.length).toBeGreaterThan(0);
    },
  );

  test.each(IOT_TEMPLATES)(
    "$id fires with $fireAggregation and recovers with AllValues",
    (tc: IoTTemplateCase) => {
      expect(
        getUnhealthyFilter(tc.id).metricMonitorOptions.metricAggregationType,
      ).toBe(tc.fireAggregation);

      // Recovery is always strictly the stronger quantifier.
      expect(
        getHealthyFilter(tc.id).metricMonitorOptions.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AllValues);
    },
  );

  test("iot-device-offline tolerates a duty cycle longer than five minutes", () => {
    /*
     * A registered device that is silent for the whole window reaches the
     * comparator as the SCALAR 0 (MetricMonitorCriteria's TreatAsZero path
     * passes `0`, not `[0]`), and CompareCriteria short-circuits a scalar
     * before any quantifier runs — so sustained evaluation gives absence no
     * protection at all and the rolling window is the only silence grace
     * period there is. At five minutes every battery-powered device on a
     * 10/15/30-minute push interval was declared Offline in every window it
     * skipped and resolved in the window it pushed: one incident and one
     * alert per window, forever.
     */
    const step: MonitorStep =
      getIoTAlertTemplateById("iot-device-offline")!.getMonitorStep(
        buildArgs(),
      );
    expect(getIoTMonitor(step).rollingTime).toBe(RollingTime.Past30Minutes);

    /*
     * ...and the MQTT Last Will path must still page on the next evaluation.
     * Under AllValues an explicit `iot_device_up = 0` could not fire until
     * every healthy bucket had aged out, turning a documented next-scrape
     * detection into a 30-minute one.
     */
    expect(
      getUnhealthyFilter("iot-device-offline").metricMonitorOptions
        .metricAggregationType,
    ).toBe(EvaluateOverTimeType.AnyValue);
  });

  test("exactly one template departs from sustained evaluation", () => {
    /*
     * AnyValue is the escape hatch RecommendationCriteriaBuilder sanctions
     * only for a signal that genuinely is an event rather than a level. If a
     * second template ever claims it, this fails and forces a review rather
     * than letting the flapping default creep back in.
     */
    const anyValue: Array<IoTTemplateCase> = IOT_TEMPLATES.filter(
      (tc: IoTTemplateCase) => {
        return tc.fireAggregation === EvaluateOverTimeType.AnyValue;
      },
    );
    expect(anyValue).toHaveLength(1);
    expect(anyValue[0]!.id).toBe("iot-device-offline");
  });

  test("exactly one template widens its window past five minutes", () => {
    /*
     * The counterpart of the TreatAsZero canary: a wide window is only
     * justified for the template that treats absence as a value. Anything
     * else adopting it would just delay real alerts.
     */
    const widened: Array<IoTTemplateCase> = IOT_TEMPLATES.filter(
      (tc: IoTTemplateCase) => {
        return tc.rollingTime !== RollingTime.Past5Minutes;
      },
    );
    expect(widened).toHaveLength(1);
    expect(widened[0]!.id).toBe("iot-device-offline");
    expect(widened[0]!.treatNoDataAsZero).toBe(true);
  });

  test.each(IOT_TEMPLATES)(
    "$id labels its series with the unit the IoT metric catalog declares",
    (tc: IoTTemplateCase) => {
      const monitor: MonitorStepIoTMonitor = getIoTMonitor(
        getIoTAlertTemplateById(tc.id)!.getMonitorStep(buildArgs()),
      );
      const alias: any = (
        monitor.metricViewConfig.queryConfigs as Array<any>
      )[0].metricAliasData;

      expect(alias.legendUnit).toBe(tc.legendUnit);
      /*
       * Pinned against the catalog too, so the two cannot drift: the criteria
       * root cause prints this unit next to both the sample and the threshold
       * (MetricMonitorCriteria defaults thresholdUnit to it), so dropping it
       * silently produces "is -103.2 which is less than -100".
       */
      expect(alias.legendUnit).toBe(
        getIoTMetricByMetricName(tc.metricName)?.unit,
      );
    },
  );

  test("buildIoTMonitorConfig defaults legendUnit from the catalog and lets a caller override it", () => {
    const fromCatalog: MonitorStepIoTMonitor = buildIoTMonitorConfig({
      fleetIdentifier: "f",
      metricName: "iot_temperature_celsius",
      metricAlias: "t",
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
    });
    expect(
      (fromCatalog.metricViewConfig.queryConfigs as Array<any>)[0]
        .metricAliasData.legendUnit,
    ).toBe("°C");

    const overridden: MonitorStepIoTMonitor = buildIoTMonitorConfig({
      fleetIdentifier: "f",
      metricName: "iot_temperature_celsius",
      metricAlias: "t",
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
      legendUnit: "°F",
    });
    expect(
      (overridden.metricViewConfig.queryConfigs as Array<any>)[0]
        .metricAliasData.legendUnit,
    ).toBe("°F");
  });

  test("a metric the catalog does not know stays unitless", () => {
    /*
     * The custom-metric picker path shares this builder, so an unknown metric
     * name must not invent a unit — a wrong unit would be converted against
     * the native one and change the number the threshold compares.
     */
    const cfg: MonitorStepIoTMonitor = buildIoTMonitorConfig({
      fleetIdentifier: "f",
      metricName: "custom_thing",
      metricAlias: "c",
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Avg,
    });
    expect(
      (cfg.metricViewConfig.queryConfigs as Array<any>)[0].metricAliasData
        .legendUnit,
    ).toBeUndefined();
  });

  test.each(IOT_TEMPLATES)(
    "$id states its own threshold in the incident title, in the unit it actually compares",
    (tc: IoTTemplateCase) => {
      const offline: any = getCriteriaInstances(tc.id)[0];

      expect(offline.data.incidents[0].title).toContain(
        tc.incidentTitleFragment,
      );
      expect(offline.data.alerts[0].title).toBe(
        offline.data.incidents[0].title,
      );
    },
  );

  test("iot-high-cpu does not promise a percentage it never prints", () => {
    /*
     * iot_cpu_usage_ratio is stored as a raw 0-1 ratio (IoTSnapshotScan scales
     * it to percent only for the device inventory column), so the criteria
     * compares 0.9 and the root cause prints "0.94 ratio". A title that says
     * ">90%" leaves the reader converting in their head — and the threshold
     * itself must stay 0.9, because rewriting it as 90 would break every MQTT
     * device whose samples have no native unit to convert from.
     */
    const offline: any = getCriteriaInstances("iot-high-cpu")[0];

    expect(offline.data.filters[0].value).toBe(0.9);
    expect(offline.data.incidents[0].title).not.toContain("90%");
    expect(offline.data.alerts[0].title).not.toContain("90%");
  });

  test.each(IOT_TEMPLATES)(
    "$id applies TreatAsZero only when it is the Device Offline template",
    (tc: IoTTemplateCase) => {
      const [offline, online]: Array<any> = getCriteriaInstances(tc.id);

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

  test("exactly one template is a binary metric, and it is the one that opts out of the dead band", () => {
    /*
     * The dead band and the binary carve-out are one decision. If a template
     * is added over another 0/1 gauge and forgets `isBinaryMetric`, its
     * recovery threshold lands at 1.1 and the monitor can never report
     * healthy — the exact regression the flag exists to prevent.
     */
    const binary: Array<IoTTemplateCase> = IOT_TEMPLATES.filter(
      (tc: IoTTemplateCase) => {
        return tc.isBinaryMetric;
      },
    );
    expect(binary).toHaveLength(1);
    expect(binary[0]!.id).toBe("iot-device-offline");

    for (const tc of IOT_TEMPLATES) {
      const healthyValue: number = getHealthyFilter(tc.id).value as number;
      if (tc.isBinaryMetric) {
        expect(healthyValue).toBe(tc.threshold);
      } else {
        expect(healthyValue).not.toBe(tc.threshold);
      }
    }
  });
});
