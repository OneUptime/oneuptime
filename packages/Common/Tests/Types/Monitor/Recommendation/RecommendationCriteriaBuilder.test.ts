import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DefaultRecoveryMarginFraction,
  SustainedEvaluation,
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
  getRecoveryThreshold,
} from "../../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";

/*
 * Regression tests for the flapping defect behind
 * https://github.com/OneUptime/oneuptime — a single Kubernetes monitor
 * created from a recommendation produced 39 alert emails (19 open, 20
 * resolve) in under two hours, one open/resolve pair roughly every five
 * minutes, on a pod whose CPU was hovering either side of its limit.
 *
 * The two causes, both encoded as defaults in nine copy-pasted builders:
 *   - `AnyValue` on the FIRE side, so one sample anywhere in the rolling
 *     window opened an alert.
 *   - The identical threshold on both sides, so the metric could satisfy
 *     "> 90" and "<= 90" on consecutive evaluations forever.
 */

const OFFLINE_STATUS_ID: ObjectID = new ObjectID("offline-status");
const ONLINE_STATUS_ID: ObjectID = new ObjectID("online-status");
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID("incident-severity");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID("alert-severity");

// The exact window from the customer's ALT-113, in percent of CPU limit.
const PRODUCTION_WINDOW: Array<number> = [72.35, 81.54, 79.95, 91.53, 87.73];

function buildUnhealthy(
  overrides?: Partial<Parameters<typeof buildUnhealthyCriteriaInstance>[0]>,
): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
    monitorName: "prod-cluster - Pod CPU Saturating Container Limit",
    metricAlias: "pod_cpu_limit_saturation",
    filterType: FilterType.GreaterThan,
    value: 90,
    ...overrides,
  });
}

function buildHealthy(
  overrides?: Partial<Parameters<typeof buildHealthyCriteriaInstance>[0]>,
): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance({
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    metricAlias: "pod_cpu_limit_saturation",
    filterType: FilterType.LessThanOrEqualTo,
    value: 90,
    ...overrides,
  });
}

function firstFilter(instance: MonitorCriteriaInstance): CriteriaFilter {
  return (instance.data?.filters as Array<CriteriaFilter>)[0]!;
}

describe("RecommendationCriteriaBuilder", () => {
  describe("sustained evaluation replaces AnyValue on both sides", () => {
    test("the firing criteria requires the condition to hold for the whole window", () => {
      expect(
        firstFilter(buildUnhealthy()).metricMonitorOptions
          ?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AllValues);
    });

    test("the healthy criteria is sustained too", () => {
      expect(
        firstFilter(buildHealthy()).metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.AllValues);
    });

    test("neither side ships AnyValue, which is what made rollingTime meaningless", () => {
      for (const instance of [buildUnhealthy(), buildHealthy()]) {
        for (const filter of instance.data?.filters as Array<CriteriaFilter>) {
          expect(filter.metricMonitorOptions?.metricAggregationType).not.toBe(
            EvaluateOverTimeType.AnyValue,
          );
        }
      }
    });

    test("SustainedEvaluation is AllValues", () => {
      expect(SustainedEvaluation).toBe(EvaluateOverTimeType.AllValues);
    });

    test("a template may opt out explicitly for genuinely event-shaped signals", () => {
      expect(
        firstFilter(
          buildUnhealthy({
            metricAggregationType: EvaluateOverTimeType.MaximumValue,
          }),
        ).metricMonitorOptions?.metricAggregationType,
      ).toBe(EvaluateOverTimeType.MaximumValue);
    });
  });

  describe("hysteresis: the recovery threshold sits inside the firing one", () => {
    test("a ceiling recovers strictly below where it fires", () => {
      const recoveryValue: number = firstFilter(buildHealthy()).value as number;

      expect(recoveryValue).toBe(90 - 90 * DefaultRecoveryMarginFraction);
      expect(recoveryValue).toBeLessThan(90);
    });

    test("a floor recovers strictly above where it fires", () => {
      // Low battery: fire at "< 20", recover at "> 20 + margin".
      const recoveryValue: number = firstFilter(
        buildHealthy({
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 20,
        }),
      ).value as number;

      expect(recoveryValue).toBe(20 + 20 * DefaultRecoveryMarginFraction);
      expect(recoveryValue).toBeGreaterThan(20);
    });

    test("a negative threshold widens away from zero, not toward it", () => {
      // Weak signal: fire at "< -100 dBm", recover at "-90 dBm".
      const recoveryValue: number = firstFilter(
        buildHealthy({
          filterType: FilterType.GreaterThanOrEqualTo,
          value: -100,
        }),
      ).value as number;

      expect(recoveryValue).toBe(-90);
      expect(recoveryValue).toBeGreaterThan(-100);
    });

    /*
     * A regression the dead band itself introduced, caught after it shipped.
     *
     * A boolean signal is conventionally written as a threshold of ONE —
     * "up < 1" fires, "up >= 1" recovers — so the `value === 0` carve-out
     * below does not catch it. Widening by 10% put recovery at ">= 1.1",
     * which a gauge that only ever emits 0 or 1 can never satisfy: the
     * healthy criteria never matched, and a device that came back up never
     * produced an Online transition. It affected iot-device-offline,
     * pve-node-offline and pve-guest-down.
     */
    test("a binary metric gets no dead band, so 0/1 gauges can recover at 1", () => {
      expect(
        firstFilter(
          buildHealthy({
            filterType: FilterType.GreaterThanOrEqualTo,
            value: 1,
            isBinaryMetric: true,
          }),
        ).value,
      ).toBe(1);
    });

    test("without the flag, a threshold of 1 is widened to an unreachable 1.1", () => {
      // Pins the mechanism, so the carve-out cannot be quietly removed.
      expect(
        firstFilter(
          buildHealthy({
            filterType: FilterType.GreaterThanOrEqualTo,
            value: 1,
          }),
        ).value,
      ).toBe(1.1);
    });

    test("the binary flag reaches additional filters too", () => {
      const instance: MonitorCriteriaInstance = buildHealthy({
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        isBinaryMetric: true,
        additionalFilters: [
          {
            metricAlias: "other_up",
            filterType: FilterType.GreaterThanOrEqualTo,
            value: 1,
          },
        ],
      });

      for (const filter of instance.data?.filters as Array<CriteriaFilter>) {
        expect(filter.value).toBe(1);
      }
    });

    test("getRecoveryThreshold reports no band for a binary metric", () => {
      expect(
        getRecoveryThreshold({
          filterType: FilterType.LessThan,
          value: 1,
          isBinaryMetric: true,
        }),
      ).toBeUndefined();
    });

    test("a zero threshold gets no dead band, so count criteria still recover at zero", () => {
      expect(
        firstFilter(buildHealthy({ filterType: FilterType.EqualTo, value: 0 }))
          .value,
      ).toBe(0);
    });

    test("an explicit recoveryValue overrides the derived dead band", () => {
      expect(firstFilter(buildHealthy({ recoveryValue: 75 })).value).toBe(75);
    });

    test("marginFraction widens the band", () => {
      expect(firstFilter(buildHealthy({ marginFraction: 0.25 })).value).toBe(
        67.5,
      );
    });

    test("the fire and recover bands do not overlap", () => {
      const fire: CriteriaFilter = firstFilter(buildUnhealthy());
      const recover: CriteriaFilter = firstFilter(buildHealthy());

      // Fire above 90, recover at or below 81 — 81 < x <= 90 is neither.
      expect(fire.value).toBe(90);
      expect(recover.value).toBe(81);
      expect(recover.value as number).toBeLessThan(fire.value as number);
    });
  });

  describe("getRecoveryThreshold", () => {
    test.each([
      [FilterType.GreaterThan, 90, 81],
      [FilterType.GreaterThanOrEqualTo, 90, 81],
      [FilterType.LessThan, 20, 22],
      [FilterType.LessThanOrEqualTo, 20, 22],
    ])(
      "%s at %s recovers at %s",
      (filterType: FilterType, value: number, expected: number) => {
        expect(
          getRecoveryThreshold({ filterType: filterType, value: value }),
        ).toBe(expected);
      },
    );

    test.each([
      [FilterType.EqualTo, 5],
      [FilterType.NotEqualTo, 5],
      [FilterType.GreaterThan, 0],
      [FilterType.LessThan, 0],
    ])(
      "%s at %s has no meaningful dead band",
      (filterType: FilterType, value: number) => {
        expect(
          getRecoveryThreshold({ filterType: filterType, value: value }),
        ).toBeUndefined();
      },
    );

    test("a non-finite threshold is left alone rather than producing NaN", () => {
      expect(
        getRecoveryThreshold({
          filterType: FilterType.GreaterThan,
          value: Number.POSITIVE_INFINITY,
        }),
      ).toBeUndefined();
    });
  });

  describe("getRecoveryFilterType", () => {
    test.each([
      [FilterType.GreaterThan, FilterType.LessThanOrEqualTo],
      [FilterType.GreaterThanOrEqualTo, FilterType.LessThan],
      [FilterType.LessThan, FilterType.GreaterThanOrEqualTo],
      [FilterType.LessThanOrEqualTo, FilterType.GreaterThan],
      [FilterType.EqualTo, FilterType.NotEqualTo],
      [FilterType.NotEqualTo, FilterType.EqualTo],
    ])("%s complements to %s", (input: FilterType, expected: FilterType) => {
      expect(getRecoveryFilterType(input)).toBe(expected);
    });

    test("complementing twice is the identity for ordered comparisons", () => {
      for (const filterType of [
        FilterType.GreaterThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThan,
        FilterType.LessThanOrEqualTo,
      ]) {
        expect(getRecoveryFilterType(getRecoveryFilterType(filterType))).toBe(
          filterType,
        );
      }
    });

    test("a filter type with no complement is returned unchanged", () => {
      expect(getRecoveryFilterType(FilterType.Contains)).toBe(
        FilterType.Contains,
      );
    });
  });

  describe("additional filters inherit the same defaults", () => {
    test("an OR'd firing filter is sustained too", () => {
      const instance: MonitorCriteriaInstance = buildUnhealthy({
        additionalFilters: [
          {
            metricAlias: "osd_scrub_errors",
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
      });

      const filters: Array<CriteriaFilter> = instance.data
        ?.filters as Array<CriteriaFilter>;

      expect(filters).toHaveLength(2);
      for (const filter of filters) {
        expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
          EvaluateOverTimeType.AllValues,
        );
      }
    });

    test("an additional recovery filter gets its own dead band", () => {
      const instance: MonitorCriteriaInstance = buildHealthy({
        value: 90,
        additionalFilters: [
          {
            metricAlias: "pool_near_full",
            filterType: FilterType.LessThanOrEqualTo,
            value: 80,
          },
        ],
      });

      const filters: Array<CriteriaFilter> = instance.data
        ?.filters as Array<CriteriaFilter>;

      expect(filters[0]!.value).toBe(81);
      expect(filters[1]!.value).toBe(72);
    });

    test("treatNoDataAsZero reaches every filter, primary and additional", () => {
      const instance: MonitorCriteriaInstance = buildHealthy({
        treatNoDataAsZero: true,
        additionalFilters: [
          {
            metricAlias: "osd_scrub_errors",
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
      });

      for (const filter of instance.data?.filters as Array<CriteriaFilter>) {
        expect(filter.metricMonitorOptions?.onNoDataPolicy).toBe(
          NoDataPolicy.TreatAsZero,
        );
      }
    });

    test("no no-data policy is set unless asked for", () => {
      expect(
        firstFilter(buildHealthy()).metricMonitorOptions?.onNoDataPolicy,
      ).toBeUndefined();
    });

    test("filterCondition is overridable so multi-alias recovery can require ALL", () => {
      expect(
        buildHealthy({ filterCondition: FilterCondition.All }).data
          ?.filterCondition,
      ).toBe(FilterCondition.All);
    });

    test("filterCondition defaults to Any", () => {
      expect(buildUnhealthy().data?.filterCondition).toBe(FilterCondition.Any);
    });
  });

  describe("the production window that produced 39 emails", () => {
    /*
     * The whole point. Under the old AnyValue default this window opened an
     * alert; under sustained evaluation it does not, because the pod was
     * only over its limit for one of five samples.
     */
    test("sustained evaluation does not fire on a single breaching sample", () => {
      const allAbove: boolean = PRODUCTION_WINDOW.every((value: number) => {
        return value > 90;
      });
      const anyAbove: boolean = PRODUCTION_WINDOW.some((value: number) => {
        return value > 90;
      });

      expect(anyAbove).toBe(true);
      expect(allAbove).toBe(false);
    });

    test("and the window does not satisfy the recovery band either, so it cannot flap", () => {
      const recoveryValue: number = firstFilter(buildHealthy()).value as number;

      // Under the old config every sample <= 90 satisfied "healthy".
      expect(
        PRODUCTION_WINDOW.every((value: number) => {
          return value <= 90;
        }),
      ).toBe(false);

      // Under the dead band it is even further from satisfying it.
      expect(
        PRODUCTION_WINDOW.every((value: number) => {
          return value <= recoveryValue;
        }),
      ).toBe(false);
    });
  });

  describe("criteria instances stay well-formed", () => {
    test("the unhealthy instance creates both an incident and an alert", () => {
      const instance: MonitorCriteriaInstance = buildUnhealthy();

      expect(instance.data?.createIncidents).toBe(true);
      expect(instance.data?.createAlerts).toBe(true);
      expect(instance.data?.incidents).toHaveLength(1);
      expect(instance.data?.alerts).toHaveLength(1);
      expect(instance.data?.incidents?.[0]?.incidentSeverityId).toBe(
        INCIDENT_SEVERITY_ID,
      );
      expect(instance.data?.alerts?.[0]?.alertSeverityId).toBe(
        ALERT_SEVERITY_ID,
      );
    });

    test("the healthy instance creates neither", () => {
      const instance: MonitorCriteriaInstance = buildHealthy();

      expect(instance.data?.createIncidents).toBe(false);
      expect(instance.data?.createAlerts).toBe(false);
      expect(instance.data?.incidents).toHaveLength(0);
      expect(instance.data?.alerts).toHaveLength(0);
    });

    test("resourceNoun only changes the fallback description", () => {
      const instance: MonitorCriteriaInstance = buildUnhealthy({
        incidentDescription: undefined,
        resourceNoun: "Ceph cluster",
      });

      expect(instance.data?.incidents?.[0]?.description).toContain(
        "detailed Ceph cluster information",
      );
    });

    test("an explicit incidentDescription wins over the fallback", () => {
      const instance: MonitorCriteriaInstance = buildUnhealthy({
        incidentDescription: "Specific description.",
        resourceNoun: "Ceph cluster",
      });

      expect(instance.data?.incidents?.[0]?.description).toBe(
        "Specific description.",
      );
    });

    test("each build produces fresh ids", () => {
      expect(buildUnhealthy().data?.id).not.toBe(buildUnhealthy().data?.id);
    });
  });
});
