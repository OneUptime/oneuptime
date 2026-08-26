import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import ProfileMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/ProfileMonitorCriteria";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricAliasData from "../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ProfileMonitorResponse from "../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * Nine monitor types used to fall through both default-criteria builders.
 * `getDefaultOfflineMonitorCriteriaInstance` returned the bare
 * `new MonitorCriteriaInstance()` the constructor hands back - no name, no
 * description, and a single placeholder `Is Online / True` filter -  while
 * `getDefaultOnlineMonitorCriteriaInstance` returned null outright. So a
 * freshly created Docker, Host, Podman, Docker Swarm, Proxmox, Ceph, IoT
 * Device or Profiles monitor shipped with one criteria that was broken three
 * ways over:
 *
 *   1. It could never fire. MonitorCriteriaEvaluator routes the first eight
 *      of those types to MetricMonitorCriteria, which reads only
 *      `CheckOn.MetricValue`, and Profiles to ProfileMonitorCriteria, which
 *      reads only `CheckOn.ProfileCount`. Neither has any branch for
 *      `Is Online`, so the seeded rule was inert whatever the monitor did.
 *   2. It could never be saved. `MonitorCriteriaInstance.getValidationError`
 *      rejects a criteria with no name and a criteria with no description,
 *      and the blank instance had neither.
 *   3. It could not be drawn honestly. The criteria form narrows these types
 *      to the one check their evaluator reads, so the seeded `Is Online` was
 *      not even on the "check on" dropdown it was supposed to be showing.
 *
 * They now seed real defaults on that one check. This file pins what those
 * defaults are, that they survive the round trip a monitor's criteria takes
 * through JSON, that validation accepts them, and - the part that actually
 * answers (1) - that feeding them to the real evaluators produces a match.
 *
 * The renderability half of the story (every seeded check is on the monitor
 * type's dropdown, every seeded condition is on its check's dropdown) is
 * swept for every monitor type in
 * Common/Tests/App/Dashboard/CriteriaFilterDefaults.test.ts.
 */

const ONLINE_STATUS_ID: ObjectID = new ObjectID("a1a1a1a1a1a1a1a1a1a1a1a1");
const OFFLINE_STATUS_ID: ObjectID = new ObjectID("b2b2b2b2b2b2b2b2b2b2b2b2");
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID("c3c3c3c3c3c3c3c3c3c3c3c3");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID("d4d4d4d4d4d4d4d4d4d4d4d4");

const MONITOR_NAME: string = "Acme Prod";

/*
 * The exact list MonitorCriteriaEvaluator hands to MetricMonitorCriteria.
 * Written out rather than derived from `isMetricBackedMonitorType` so this
 * file disagrees loudly if that helper is edited without the evaluator.
 */
const METRIC_BACKED_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Metrics,
  MonitorType.Kubernetes,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.Ceph,
  MonitorType.IoTDevice,
];

/*
 * The eight that had no defaults before this change. Metrics and Kubernetes
 * already had a pair each and are excluded here so the "this used to be
 * broken" assertions stay honest about which types they are describing.
 */
const NEWLY_SEEDED_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.Ceph,
  MonitorType.IoTDevice,
  MonitorType.Profiles,
];

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

function offlineFor(
  monitorType: MonitorType,
  metricAliases?: Array<string>,
): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
    monitorType: monitorType,
    monitorStatusId: OFFLINE_STATUS_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
    monitorName: MONITOR_NAME,
    ...(metricAliases ? { metricOptions: { metricAliases } } : {}),
  });
}

function onlineFor(
  monitorType: MonitorType,
  metricAliases?: Array<string>,
): MonitorCriteriaInstance | null {
  return MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
    monitorType: monitorType,
    monitorStatusId: ONLINE_STATUS_ID,
    monitorName: MONITOR_NAME,
    ...(metricAliases ? { metricOptions: { metricAliases } } : {}),
  });
}

function onlyFilterOf(instance: MonitorCriteriaInstance): CriteriaFilter {
  expect(instance.data?.filters).toHaveLength(1);
  return instance.data!.filters[0]!;
}

/*
 * A MonitorStep + MetricMonitorResponse pair carrying a single metric alias
 * with the supplied samples, so a seeded criteria filter can be run through
 * the real MetricMonitorCriteria rather than merely inspected.
 */
function buildMetricInputs(input: {
  metricAlias: string;
  sampleValues: Array<number>;
}): {
  monitorStep: MonitorStep;
  dataToProcess: MetricMonitorResponse;
} {
  const aliasData: MetricAliasData = {
    metricVariable: input.metricAlias,
    title: "CPU Utilization",
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  };

  const queryConfig: MetricQueryConfigData = {
    metricAliasData: aliasData,
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
      },
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined } as never,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past1Minute,
  };

  const aggregated: AggregatedResult = {
    data: input.sampleValues.map((value: number) => {
      return {
        timestamp: new Date(),
        value: value,
      } as AggregateModel;
    }),
  };

  return {
    monitorStep,
    dataToProcess: {
      projectId: ObjectID.generate(),
      metricResult: [aggregated],
      metricViewConfig,
      monitorId: ObjectID.generate(),
    },
  };
}

function evaluateMetric(input: {
  criteriaFilter: CriteriaFilter;
  sampleValues: Array<number>;
}): Promise<string | null> {
  const inputs: ReturnType<typeof buildMetricInputs> = buildMetricInputs({
    metricAlias:
      input.criteriaFilter.metricMonitorOptions?.metricAlias || "cpu",
    sampleValues: input.sampleValues,
  });

  return MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: inputs.dataToProcess,
    criteriaFilter: input.criteriaFilter,
    monitorStep: inputs.monitorStep,
  });
}

function evaluateProfile(input: {
  criteriaFilter: CriteriaFilter;
  profileCount: number;
}): Promise<string | null> {
  const response: Partial<ProfileMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    profileCount: input.profileCount,
    profileQuery: {},
  };

  return ProfileMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response as DataToProcess,
    criteriaFilter: input.criteriaFilter,
  });
}

describe("Default criteria for metric-backed and profile monitors", () => {
  describe("isMetricBackedMonitorType", () => {
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s is routed to MetricMonitorCriteria, so it is metric-backed",
      (monitorType: MonitorType) => {
        expect(
          MonitorCriteriaInstance.isMetricBackedMonitorType(monitorType),
        ).toBe(true);
      },
    );

    test("no other monitor type claims to be metric-backed", () => {
      const claimed: Array<MonitorType> = ALL_MONITOR_TYPES.filter(
        (monitorType: MonitorType) => {
          return MonitorCriteriaInstance.isMetricBackedMonitorType(monitorType);
        },
      );

      expect(claimed.sort()).toEqual([...METRIC_BACKED_MONITOR_TYPES].sort());
    });

    /*
     * Profiles is the odd one out of the nine types this change covers: it
     * is telemetry, but ProfileMonitorCriteria - not MetricMonitorCriteria -
     * decides on it, so it gets a count filter rather than a metric one.
     */
    test("Profiles is not metric-backed - it has its own evaluator", () => {
      expect(
        MonitorCriteriaInstance.isMetricBackedMonitorType(MonitorType.Profiles),
      ).toBe(false);
    });
  });

  describe("the gap these defaults close", () => {
    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s no longer falls through to the blank starting criteria",
      (monitorType: MonitorType) => {
        const blank: MonitorCriteriaInstance = new MonitorCriteriaInstance();
        const offline: MonitorCriteriaInstance = offlineFor(monitorType);

        expect(blank.data!.name).toBe("");
        expect(offline.data!.name).not.toBe("");
        expect(offline.data!.filters).not.toEqual(blank.data!.filters);
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s no longer seeds the placeholder Is Online filter no evaluator reads",
      (monitorType: MonitorType) => {
        for (const instance of [
          offlineFor(monitorType),
          onlineFor(monitorType),
        ]) {
          expect(instance).not.toBeNull();

          for (const filter of instance!.data!.filters) {
            expect(filter.checkOn).not.toBe(CheckOn.IsOnline);
          }
        }
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s now gets an online criteria instead of null",
      (monitorType: MonitorType) => {
        expect(onlineFor(monitorType)).not.toBeNull();
      },
    );

    /*
     * The blank instance failed getValidationError on both the name and the
     * description, which is what made it unsaveable. Sweeping every monitor
     * type - not just the newly seeded ones - keeps a future type from
     * quietly reintroducing the same fall-through.
     */
    test.each(
      ALL_MONITOR_TYPES.filter((monitorType: MonitorType) => {
        return MonitorTypeHelper.doesMonitorTypeHaveCriteria(monitorType);
      }),
    )(
      "%s: every seeded criteria passes getValidationError",
      (monitorType: MonitorType) => {
        const instances: Array<MonitorCriteriaInstance> = [
          offlineFor(monitorType, ["cpu"]),
          onlineFor(monitorType, ["cpu"]),
        ].filter(Boolean) as Array<MonitorCriteriaInstance>;

        for (const instance of instances) {
          expect(
            MonitorCriteriaInstance.getValidationError(instance, monitorType),
          ).toBeNull();
        }
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s: MonitorCriteria.getDefaultMonitorCriteria yields both criteria",
      (monitorType: MonitorType) => {
        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            monitorType: monitorType,
            monitorName: MONITOR_NAME,
            onlineMonitorStatusId: ONLINE_STATUS_ID,
            offlineMonitorStatusId: OFFLINE_STATUS_ID,
            defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
            defaultAlertSeverityId: ALERT_SEVERITY_ID,
          });

        expect(criteria.data?.monitorCriteriaInstanceArray).toHaveLength(2);
        expect(
          MonitorCriteria.getValidationError(criteria, monitorType),
        ).toBeNull();
      },
    );
  });

  describe("metric-backed monitor types", () => {
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s offline: metric value equal to zero",
      (monitorType: MonitorType) => {
        const filter: CriteriaFilter = onlyFilterOf(offlineFor(monitorType));

        expect(filter.checkOn).toBe(CheckOn.MetricValue);
        expect(filter.filterType).toBe(FilterType.EqualTo);
        expect(filter.value).toBe(0);
        expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
          EvaluateOverTimeType.AnyValue,
        );
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s online: metric value greater than zero",
      (monitorType: MonitorType) => {
        const filter: CriteriaFilter = onlyFilterOf(onlineFor(monitorType)!);

        expect(filter.checkOn).toBe(CheckOn.MetricValue);
        expect(filter.filterType).toBe(FilterType.GreaterThan);
        expect(filter.value).toBe(0);
        expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
          EvaluateOverTimeType.AnyValue,
        );
      },
    );

    /*
     * Absence is deliberately not what the offline rule fires on. With no
     * samples in the window MetricMonitorCriteria consults
     * metricMonitorOptions.onNoDataPolicy, which defaults to Ignore, so a
     * brand new monitor whose step has no metric query configured yet does
     * not immediately open an incident. Pinned because setting the policy
     * here would be a quiet, incident-generating behaviour change.
     */
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s does not opt into a no-data policy on either criteria",
      (monitorType: MonitorType) => {
        expect(
          onlyFilterOf(offlineFor(monitorType)).metricMonitorOptions
            ?.onNoDataPolicy,
        ).toBeUndefined();
        expect(
          onlyFilterOf(onlineFor(monitorType)!).metricMonitorOptions
            ?.onNoDataPolicy,
        ).toBeUndefined();
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s threads the first metric alias into both criteria",
      (monitorType: MonitorType) => {
        expect(
          onlyFilterOf(offlineFor(monitorType, ["cpu", "memory"]))
            .metricMonitorOptions?.metricAlias,
        ).toBe("cpu");
        expect(
          onlyFilterOf(onlineFor(monitorType, ["cpu", "memory"])!)
            .metricMonitorOptions?.metricAlias,
        ).toBe("cpu");
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s leaves the alias undefined when no metric options are supplied",
      (monitorType: MonitorType) => {
        expect(
          onlyFilterOf(offlineFor(monitorType)).metricMonitorOptions
            ?.metricAlias,
        ).toBeUndefined();
        expect(
          onlyFilterOf(onlineFor(monitorType)!).metricMonitorOptions
            ?.metricAlias,
        ).toBeUndefined();
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s leaves the alias undefined when the alias list is empty",
      (monitorType: MonitorType) => {
        expect(
          onlyFilterOf(offlineFor(monitorType, [])).metricMonitorOptions
            ?.metricAlias,
        ).toBeUndefined();
        expect(
          onlyFilterOf(onlineFor(monitorType, [])!).metricMonitorOptions
            ?.metricAlias,
        ).toBeUndefined();
      },
    );

    /*
     * Metrics and Kubernetes had this exact pair before the change. The rest
     * were given the same one rather than a per-type invention, so assert
     * they are actually identical apart from the generated ids.
     */
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s seeds the same filters Metrics does",
      (monitorType: MonitorType) => {
        expect(onlyFilterOf(offlineFor(monitorType, ["cpu"]))).toEqual(
          onlyFilterOf(offlineFor(MonitorType.Metrics, ["cpu"])),
        );
        expect(onlyFilterOf(onlineFor(monitorType, ["cpu"])!)).toEqual(
          onlyFilterOf(onlineFor(MonitorType.Metrics, ["cpu"])!),
        );
      },
    );
  });

  describe("Profiles monitors", () => {
    /*
     * Profiles takes its count shape from Exceptions but its polarity from
     * Logs and Traces, and the difference matters. An exception is a fault,
     * so Exceptions treats "count is zero" as healthy. A profile is
     * telemetry: profiles arriving is the sign of life, and their absence is
     * what says the profiled process has stopped reporting.
     */
    test("offline: no profiles arrived in the window", () => {
      const filter: CriteriaFilter = onlyFilterOf(
        offlineFor(MonitorType.Profiles),
      );

      expect(filter.checkOn).toBe(CheckOn.ProfileCount);
      expect(filter.filterType).toBe(FilterType.EqualTo);
      expect(filter.value).toBe(0);
    });

    test("online: at least one profile arrived in the window", () => {
      const filter: CriteriaFilter = onlyFilterOf(
        onlineFor(MonitorType.Profiles)!,
      );

      expect(filter.checkOn).toBe(CheckOn.ProfileCount);
      expect(filter.filterType).toBe(FilterType.GreaterThan);
      expect(filter.value).toBe(0);
    });

    test("takes the Logs polarity, not the inverted Exceptions one", () => {
      expect(onlyFilterOf(offlineFor(MonitorType.Profiles)).filterType).toBe(
        onlyFilterOf(offlineFor(MonitorType.Logs)).filterType,
      );
      expect(onlyFilterOf(onlineFor(MonitorType.Profiles)!).filterType).toBe(
        onlyFilterOf(onlineFor(MonitorType.Logs)!).filterType,
      );

      // Exceptions is the inverse of both, on purpose.
      expect(onlyFilterOf(offlineFor(MonitorType.Exceptions)).filterType).toBe(
        FilterType.GreaterThan,
      );
      expect(onlyFilterOf(onlineFor(MonitorType.Exceptions)!).filterType).toBe(
        FilterType.EqualTo,
      );
    });

    test("carries no metric options - it is not evaluated as a metric", () => {
      expect(
        onlyFilterOf(offlineFor(MonitorType.Profiles, ["cpu"]))
          .metricMonitorOptions,
      ).toBeUndefined();
      expect(
        onlyFilterOf(onlineFor(MonitorType.Profiles, ["cpu"])!)
          .metricMonitorOptions,
      ).toBeUndefined();
    });
  });

  describe("criteria wiring shared by every newly seeded type", () => {
    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s offline: carries the offline status, an incident and an alert",
      (monitorType: MonitorType) => {
        const instance: MonitorCriteriaInstance = offlineFor(monitorType);

        expect(instance.data!.monitorStatusId).toBe(OFFLINE_STATUS_ID);
        expect(instance.data!.filterCondition).toBe(FilterCondition.Any);
        expect(instance.data!.changeMonitorStatus).toBe(true);
        expect(instance.data!.createIncidents).toBe(true);
        expect(instance.data!.createAlerts).toBe(false);

        expect(instance.data!.incidents).toHaveLength(1);
        const incident: CriteriaIncident = instance.data!.incidents[0]!;
        expect(incident.title).toBe(`${MONITOR_NAME} is offline`);
        expect(incident.description).toBe(
          `${MONITOR_NAME} is currently offline.`,
        );
        expect(incident.incidentSeverityId).toBe(INCIDENT_SEVERITY_ID);
        expect(incident.autoResolveIncident).toBe(true);
        expect(incident.onCallPolicyIds).toEqual([]);

        expect(instance.data!.alerts).toHaveLength(1);
        const alert: CriteriaAlert = instance.data!.alerts[0]!;
        expect(alert.title).toBe(`${MONITOR_NAME} is offline`);
        expect(alert.description).toBe(`${MONITOR_NAME} is currently offline.`);
        expect(alert.alertSeverityId).toBe(ALERT_SEVERITY_ID);
        expect(alert.autoResolveAlert).toBe(true);
        expect(alert.onCallPolicyIds).toEqual([]);
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s online: carries the online status and opens nothing",
      (monitorType: MonitorType) => {
        const instance: MonitorCriteriaInstance = onlineFor(monitorType)!;

        expect(instance.data!.monitorStatusId).toBe(ONLINE_STATUS_ID);
        expect(instance.data!.filterCondition).toBe(FilterCondition.Any);
        expect(instance.data!.changeMonitorStatus).toBe(true);
        expect(instance.data!.createIncidents).toBe(false);
        expect(instance.data!.createAlerts).toBe(false);
        expect(instance.data!.incidents).toEqual([]);
        expect(instance.data!.alerts).toEqual([]);
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s names both criteria after the monitor",
      (monitorType: MonitorType) => {
        const offline: MonitorCriteriaInstance = offlineFor(monitorType);
        const online: MonitorCriteriaInstance = onlineFor(monitorType)!;

        expect(offline.data!.name).toBe(`Check if ${MONITOR_NAME} is offline`);
        expect(offline.data!.description).toBe(
          `This criteria checks if the ${MONITOR_NAME} is offline`,
        );
        expect(online.data!.name).toBe(`Check if ${MONITOR_NAME} is online`);
        expect(online.data!.description).toBe(
          `This criteria checks if the ${MONITOR_NAME} is online`,
        );
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s: each call mints fresh ids rather than sharing one",
      (monitorType: MonitorType) => {
        const first: MonitorCriteriaInstance = offlineFor(monitorType);
        const second: MonitorCriteriaInstance = offlineFor(monitorType);
        const online: MonitorCriteriaInstance = onlineFor(monitorType)!;

        expect(first.data!.id).not.toBe(second.data!.id);
        expect(first.data!.id).not.toBe(online.data!.id);
        expect(first.data!.incidents[0]!.id).not.toBe(
          second.data!.incidents[0]!.id,
        );
        expect(first.data!.alerts[0]!.id).not.toBe(second.data!.alerts[0]!.id);
      },
    );

    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s: mutating one seeded criteria does not touch the next",
      (monitorType: MonitorType) => {
        const first: MonitorCriteriaInstance = offlineFor(monitorType);
        first.data!.filters[0]!.value = 999;

        expect(offlineFor(monitorType).data!.filters[0]!.value).toBe(0);
      },
    );

    /*
     * These criteria are persisted on the monitor and read back through
     * MonitorCriteriaInstance.fromJSON, so a filter that survives inspection
     * but not the round trip would still reach the user broken.
     */
    test.each(NEWLY_SEEDED_MONITOR_TYPES)(
      "%s: both criteria survive a JSON round trip intact",
      (monitorType: MonitorType) => {
        for (const instance of [
          offlineFor(monitorType, ["cpu"]),
          onlineFor(monitorType, ["cpu"])!,
        ]) {
          const restored: MonitorCriteriaInstance =
            MonitorCriteriaInstance.fromJSON(instance.toJSON());

          expect(restored.data!.name).toBe(instance.data!.name);
          expect(restored.data!.description).toBe(instance.data!.description);
          expect(restored.data!.filters).toEqual(instance.data!.filters);
          expect(
            MonitorCriteriaInstance.getValidationError(restored, monitorType),
          ).toBeNull();
        }
      },
    );
  });

  /*
   * The point of the whole change. "Is Online" against MetricMonitorCriteria
   * or ProfileMonitorCriteria returns null forever; these assertions run the
   * seeded filters through those same evaluators and show them deciding.
   */
  describe("the seeded filters actually fire in the evaluator that reads them", () => {
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s online criteria matches a metric reporting above zero",
      async (monitorType: MonitorType) => {
        const result: string | null = await evaluateMetric({
          criteriaFilter: onlyFilterOf(onlineFor(monitorType, ["cpu"])!),
          sampleValues: [42],
        });

        expect(result).toBeTruthy();
        expect(result).toContain("greater than");
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s online criteria does not match a metric sitting at zero",
      async (monitorType: MonitorType) => {
        expect(
          await evaluateMetric({
            criteriaFilter: onlyFilterOf(onlineFor(monitorType, ["cpu"])!),
            sampleValues: [0],
          }),
        ).toBeNull();
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s offline criteria matches a metric sitting at zero",
      async (monitorType: MonitorType) => {
        const result: string | null = await evaluateMetric({
          criteriaFilter: onlyFilterOf(offlineFor(monitorType, ["cpu"])),
          sampleValues: [0],
        });

        expect(result).toBeTruthy();
        expect(result).toContain("equal to 0");
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s offline criteria does not match a metric reporting above zero",
      async (monitorType: MonitorType) => {
        expect(
          await evaluateMetric({
            criteriaFilter: onlyFilterOf(offlineFor(monitorType, ["cpu"])),
            sampleValues: [42],
          }),
        ).toBeNull();
      },
    );

    /*
     * The seeded aggregation is AnyValue, so one zero sample in an otherwise
     * healthy window is enough to trip the offline rule. Spelled out because
     * every other EvaluateOverTimeType collapses to "all samples must
     * breach" in this evaluator, and the two read very differently.
     */
    test("AnyValue means a single zero sample trips the offline rule", async () => {
      const result: string | null = await evaluateMetric({
        criteriaFilter: onlyFilterOf(offlineFor(MonitorType.Docker, ["cpu"])),
        sampleValues: [12, 0, 30],
      });

      expect(result).toBeTruthy();
    });

    test("the placeholder Is Online filter these types used to seed never fires", async () => {
      const blank: MonitorCriteriaInstance = new MonitorCriteriaInstance();

      expect(
        await evaluateMetric({
          criteriaFilter: onlyFilterOf(blank),
          sampleValues: [42],
        }),
      ).toBeNull();
      expect(
        await evaluateMetric({
          criteriaFilter: onlyFilterOf(blank),
          sampleValues: [0],
        }),
      ).toBeNull();
      expect(
        await evaluateProfile({
          criteriaFilter: onlyFilterOf(blank),
          profileCount: 7,
        }),
      ).toBeNull();
      expect(
        await evaluateProfile({
          criteriaFilter: onlyFilterOf(blank),
          profileCount: 0,
        }),
      ).toBeNull();
    });

    test("Profiles online criteria matches when profiles arrived", async () => {
      const result: string | null = await evaluateProfile({
        criteriaFilter: onlyFilterOf(onlineFor(MonitorType.Profiles)!),
        profileCount: 7,
      });

      expect(result).toBeTruthy();
      expect(result).toContain("Profile Count");
      expect(result).toContain("greater than");
    });

    test("Profiles online criteria does not match when none arrived", async () => {
      expect(
        await evaluateProfile({
          criteriaFilter: onlyFilterOf(onlineFor(MonitorType.Profiles)!),
          profileCount: 0,
        }),
      ).toBeNull();
    });

    test("Profiles offline criteria matches when none arrived", async () => {
      const result: string | null = await evaluateProfile({
        criteriaFilter: onlyFilterOf(offlineFor(MonitorType.Profiles)),
        profileCount: 0,
      });

      expect(result).toBeTruthy();
      expect(result).toContain("Profile Count");
      expect(result).toContain("equal to 0");
    });

    test("Profiles offline criteria does not match when profiles arrived", async () => {
      expect(
        await evaluateProfile({
          criteriaFilter: onlyFilterOf(offlineFor(MonitorType.Profiles)),
          profileCount: 7,
        }),
      ).toBeNull();
    });

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s: exactly one criteria matches a window that is all zero or all non-zero",
      async (monitorType: MonitorType) => {
        for (const sampleValues of [[0], [42], [0, 0], [42, 42]]) {
          const online: string | null = await evaluateMetric({
            criteriaFilter: onlyFilterOf(onlineFor(monitorType, ["cpu"])!),
            sampleValues,
          });
          const offline: string | null = await evaluateMetric({
            criteriaFilter: onlyFilterOf(offlineFor(monitorType, ["cpu"])),
            sampleValues,
          });

          expect(Boolean(online)).toBe(!Boolean(offline));
        }
      },
    );

    /*
     * On a MIXED window the two are not mutually exclusive, and pretending
     * otherwise would be the easy mistake to make here. The seeded
     * aggregation is AnyValue, which CompareCriteria implements as
     * `.some(...)`, so "some sample is above zero" and "some sample is zero"
     * are both true of [12, 0, 30] at once. Nothing about the pair can make
     * that go away - it is the rule Metrics and Kubernetes have always
     * shipped, now shared by the seven infrastructure types and IoT Device.
     *
     * What decides the monitor's status is therefore ordering, not
     * exclusivity: MonitorCriteriaEvaluator.processMonitorStep walks
     * monitorCriteriaInstanceArray and breaks on the first criteria that
     * matches. So the two assertions below are a pair - the overlap is real,
     * and offline is stored first, which is what makes a container that dips
     * to zero for one sample read as offline rather than online.
     */
    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s: a mixed window matches both criteria, so ordering decides",
      async (monitorType: MonitorType) => {
        const sampleValues: Array<number> = [12, 0, 30];

        const online: string | null = await evaluateMetric({
          criteriaFilter: onlyFilterOf(onlineFor(monitorType, ["cpu"])!),
          sampleValues,
        });
        const offline: string | null = await evaluateMetric({
          criteriaFilter: onlyFilterOf(offlineFor(monitorType, ["cpu"])),
          sampleValues,
        });

        expect(online).toBeTruthy();
        expect(offline).toBeTruthy();
      },
    );

    test.each(METRIC_BACKED_MONITOR_TYPES)(
      "%s: the offline criteria is stored first, so it wins the overlap",
      (monitorType: MonitorType) => {
        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            monitorType: monitorType,
            monitorName: MONITOR_NAME,
            onlineMonitorStatusId: ONLINE_STATUS_ID,
            offlineMonitorStatusId: OFFLINE_STATUS_ID,
            defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
            defaultAlertSeverityId: ALERT_SEVERITY_ID,
          });

        const instances: Array<MonitorCriteriaInstance> =
          criteria.data!.monitorCriteriaInstanceArray;

        expect(instances).toHaveLength(2);
        expect(instances[0]!.data!.monitorStatusId).toBe(OFFLINE_STATUS_ID);
        expect(instances[1]!.data!.monitorStatusId).toBe(ONLINE_STATUS_ID);
      },
    );

    /*
     * Profiles has no such overlap: profileCount is one scalar, not a window
     * of samples, so it cannot be both zero and above zero. This is the
     * assertion the metric pair cannot make.
     */
    test.each([0, 1, 7, 1000])(
      "Profiles: online and offline never both match a count of %s",
      async (profileCount: number) => {
        const online: string | null = await evaluateProfile({
          criteriaFilter: onlyFilterOf(onlineFor(MonitorType.Profiles)!),
          profileCount,
        });
        const offline: string | null = await evaluateProfile({
          criteriaFilter: onlyFilterOf(offlineFor(MonitorType.Profiles)),
          profileCount,
        });

        expect(Boolean(online) && Boolean(offline)).toBe(false);
        expect(Boolean(online) || Boolean(offline)).toBe(true);
      },
    );
  });

  describe("monitor types this change deliberately left alone", () => {
    /*
     * Manual monitors are the one type with no criteria at all: nothing polls
     * them, MonitorCriteriaEvaluator has no branch for them, and the Criteria
     * page draws an empty state in place of the form. They are the only
     * remaining fall-through, and that is correct.
     */
    test("Manual monitors still seed nothing but the blank starting criteria", () => {
      const offline: MonitorCriteriaInstance = offlineFor(MonitorType.Manual);

      expect(
        MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Manual),
      ).toBe(false);
      expect(offline.data!.name).toBe("");
      expect(offline.data!.filters).toEqual([
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      ]);
      expect(onlineFor(MonitorType.Manual)).toBeNull();
    });

    test("Manual is now the only monitor type without a named offline criteria", () => {
      const unnamed: Array<MonitorType> = ALL_MONITOR_TYPES.filter(
        (monitorType: MonitorType) => {
          return !offlineFor(monitorType, ["cpu"]).data!.name;
        },
      );

      expect(unnamed).toEqual([MonitorType.Manual]);
    });

    test.each([MonitorType.Metrics, MonitorType.Kubernetes])(
      "%s keeps the exact defaults it already shipped",
      (monitorType: MonitorType) => {
        expect(onlyFilterOf(offlineFor(monitorType, ["cpu"]))).toEqual({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.EqualTo,
          metricMonitorOptions: {
            metricAggregationType: EvaluateOverTimeType.AnyValue,
            metricAlias: "cpu",
          },
          value: 0,
        });
        expect(onlyFilterOf(onlineFor(monitorType, ["cpu"])!)).toEqual({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          metricMonitorOptions: {
            metricAggregationType: EvaluateOverTimeType.AnyValue,
            metricAlias: "cpu",
          },
          value: 0,
        });
      },
    );

    /*
     * Guarding the merge that folded the per-type Metrics and Kubernetes
     * branches into one metric-backed branch: nothing outside that family
     * should have picked up a metric filter along the way.
     */
    test("no non-metric-backed type seeds a metric value filter", () => {
      for (const monitorType of ALL_MONITOR_TYPES) {
        if (MonitorCriteriaInstance.isMetricBackedMonitorType(monitorType)) {
          continue;
        }

        const instances: Array<MonitorCriteriaInstance> = [
          offlineFor(monitorType, ["cpu"]),
          onlineFor(monitorType, ["cpu"]),
        ].filter(Boolean) as Array<MonitorCriteriaInstance>;

        for (const instance of instances) {
          for (const filter of instance.data!.filters) {
            expect(filter.checkOn).not.toBe(CheckOn.MetricValue);
          }
        }
      }
    });
  });
});
