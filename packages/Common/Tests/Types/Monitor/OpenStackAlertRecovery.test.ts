/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the native
 * isolated-vm addon. Nothing here uses the sandbox, and the prebuilt binary cannot
 * always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../Models/DatabaseModels/Monitor";
import CriteriaInEffect from "../../../Server/Utils/Monitor/CriteriaInEffect";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../Server/Utils/Monitor/MonitorResource";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplate,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../Types/Probe/ProbeApiIngestResponse";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PATH A GROUPED MONITOR REALLY TAKES WHEN A SERIES GOES AWAY.
 *
 * Criteria compared one filter at a time say a gone series recovered, and #5433's
 * regression tests stop there. But a grouped monitor acts on the series it was
 * handed: MonitorCriteriaEvaluator takes a criteria no series satisfied as not met,
 * and a window with nothing in it is silence, which leaves its incidents open
 * (MonitorResourceUtil.isSilentInfrastructureWindow). So a grouped template whose
 * every series went away - the last instance in ERROR deleted, the only nova-compute
 * of a small cloud disabled - stays open for ever, unless something keeps the window
 * from being silent while the service still reports. That is the service's own `_up`
 * series beside each template's own: these drive the real evaluator, on what the
 * worker hands it, with the labels of a real DevStack recording.
 */

const REGION: string = "RegionOne";
const HOST: string = "runnervm48cm3";
const END_MS: number = Date.UTC(2026, 10, 4, 10, 0, 0);

function windowMinutes(step: MonitorStep): number {
  return step.data!.openstackMonitor!.rollingTime === "Past 1 Hour" ? 60 : 10;
}

// One series as the worker reads it: its labels, and each alias's value.
interface Series {
  labels: JSONObject;
  values: Record<string, number>;
}

function stepOf(id: string): MonitorStep {
  const template: OpenStackAlertTemplate = getOpenStackAlertTemplateById(id)!;

  return template.getMonitorStep({
    cloudIdentifier: "production",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Production",
  });
}

// What the worker's buildSeriesBreakdown hands the evaluator, every two minutes.
function workerResponse(
  step: MonitorStep,
  series: Array<Series>,
): MetricMonitorResponse {
  const minutes: number = windowMinutes(step);
  const queries: Array<MetricQueryConfigData> =
    step.data!.openstackMonitor!.metricViewConfig.queryConfigs;
  const formulas: Array<MetricFormulaConfigData> =
    step.data!.openstackMonitor!.metricViewConfig.formulaConfigs || [];

  const seriesBreakdown: Array<MetricSeriesResult> = series.map(
    (entry: Series): MetricSeriesResult => {
      const results: Array<AggregatedResult> = queries.map(
        (query: MetricQueryConfigData): AggregatedResult => {
          const value: number | undefined =
            entry.values[query.metricAliasData?.metricVariable || ""];

          if (value === undefined) {
            return { data: [] };
          }

          const rows: Array<AggregateModel> = [];

          for (let ago: number = 1; ago <= minutes; ago += 2) {
            rows.unshift({
              timestamp: new Date(END_MS - ago * 60000),
              value: value,
              attributes: entry.labels,
            } as unknown as AggregateModel);
          }

          return { data: rows };
        },
      );

      formulas.forEach((formula: MetricFormulaConfigData, index: number) => {
        results.push(
          MetricFormulaEvaluator.evaluateFormula({
            formula: formula.metricFormulaData.metricFormula,
            queryConfigs: queries,
            formulaConfigs: formulas.slice(0, index),
            results: results,
          }),
        );
      });

      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(entry.labels),
        labels: entry.labels,
        aggregatedResults: results,
      };
    },
  );

  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: step.data!.openstackMonitor!.metricViewConfig,
    startAndEndDate: {
      startValue: new Date(END_MS - minutes * 60000),
      endValue: new Date(END_MS),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: queries
      .map((_query: MetricQueryConfigData, index: number): AggregatedResult => {
        return {
          data: seriesBreakdown.flatMap((entry: MetricSeriesResult) => {
            return entry.aggregatedResults[index]?.data || [];
          }),
        };
      })
      .concat(
        formulas.map(
          (
            _formula: MetricFormulaConfigData,
            index: number,
          ): AggregatedResult => {
            return {
              data: seriesBreakdown.flatMap((entry: MetricSeriesResult) => {
                return (
                  entry.aggregatedResults[queries.length + index]?.data || []
                );
              }),
            };
          },
        ),
      ),
    seriesBreakdown: seriesBreakdown,
  };

  return response;
}

interface Tick {
  response: ProbeApiIngestResponse;
  // The series the firing criteria opened an incident for.
  breaching: Array<JSONObject>;
  // Whether the monitor's status went to the recovery criteria's.
  recovered: boolean;
  isSilent: boolean;
}

async function evaluate(
  step: MonitorStep,
  series: Array<Series>,
): Promise<Tick> {
  const data: MetricMonitorResponse = workerResponse(step, series);
  const monitor: Monitor = new Monitor();
  monitor.id = data.monitorId;
  monitor.projectId = data.projectId;
  monitor.monitorType = MonitorType.OpenStack;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: data,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: data.monitorId,
        rootCause: null,
      },
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
      // No incident is open yet, and nothing here reads the database.
      criteriaInEffect: {
        isInEffect: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
      } as unknown as CriteriaInEffect,
    });

  const [firing, recovery] = step.data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];

  return {
    response: response,
    breaching: (response.matchedCriteria || [])
      .filter((matched: MatchedCriteriaResult): boolean => {
        return matched.criteriaId === firing.data!.id?.toString();
      })
      .flatMap(
        (matched: MatchedCriteriaResult): Array<PerSeriesCriteriaMatch> => {
          return matched.perSeriesMatches;
        },
      )
      .map((match: PerSeriesCriteriaMatch): JSONObject => {
        return match.labels;
      }),
    recovered:
      response.criteriaMetId?.toString() === recovery.data!.id?.toString(),
    isSilent: MonitorResourceUtil.isSilentInfrastructureWindow({
      monitor: monitor,
      dataToProcess: data,
    }),
  };
}

// The series a step's anchor adds: only what the anchor's series carries is set.
function anchorSeries(step: MonitorStep): Series {
  const labels: JSONObject = {};

  for (const key of MonitorStep.getGroupByAttributeKeys(step)) {
    labels[key] = key === OPENSTACK_REGION_ATTRIBUTE ? REGION : "";
  }

  return { labels, values: { [OPENSTACK_ANCHOR_METRIC_ALIAS]: 1 } };
}

describe("An OpenStack monitor when a part goes away", () => {
  test("an infrastructure monitor's silence is not recovery, for this type too", () => {
    expect(
      MonitorTypeHelper.isInfrastructureMonitor(MonitorType.OpenStack),
    ).toBe(true);
  });

  describe("Compute Service Down, on the labels of a real recording", () => {
    const compute: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      hostname: HOST,
      service: "nova-compute",
    };

    test("a stopped nova-compute opens one incident, naming the host", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { compute_service_up: 0 } },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([compute]);
      expect(tick.recovered).toBe(false);
    });

    test("starting it again resolves that incident", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { compute_service_up: 1 } },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
    });

    test("a host in another region is another incident", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");
      const other: JSONObject = {
        ...compute,
        [OPENSTACK_REGION_ATTRIBUTE]: "RegionTwo",
      };

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { compute_service_up: 0 } },
        { labels: other, values: { compute_service_up: 0 } },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([compute, other]);
    });

    test("disabling the only nova-compute on purpose takes it out of the filter, and that recovers", async () => {
      /*
       * The recording's compute-disabled scene: adminState reads disabled, so the
       * query filtered to enabled has nothing left. Without the anchor this window
       * would be silent, and its incident would never close.
       */
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      const tick: Tick = await evaluate(step, [anchorSeries(step)]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
      expect(tick.isSilent).toBe(false);
    });

    test("the agent going quiet leaves the monitor as it was: that is not recovery", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      const tick: Tick = await evaluate(step, []);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(false);
      expect(tick.response.criteriaMetId).toBeFalsy();
      expect(tick.isSilent).toBe(true);
    });
  });

  describe("Instances in Error", () => {
    const failed: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      status: "ERROR",
    };

    test("the recording's failed boot opens one incident for its region", async () => {
      const step: MonitorStep = stepOf("openstack-instances-in-error");

      const tick: Tick = await evaluate(step, [
        { labels: failed, values: { instances_in_error: 1 } },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([failed]);
    });

    test("deleting the last one takes its series away, and that recovers", async () => {
      const step: MonitorStep = stepOf("openstack-instances-in-error");

      const tick: Tick = await evaluate(step, [anchorSeries(step)]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
    });
  });

  describe("Instance Stuck Building", () => {
    const stuck: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      uuid: "da0e3695-97ed-4198-9298-5bb5d8f6c67b",
      name: "ou-failed",
    };

    test("one instance held in BUILD for the hour opens one incident, naming it", async () => {
      const step: MonitorStep = stepOf("openstack-instance-stuck-building");

      const tick: Tick = await evaluate(step, [
        { labels: stuck, values: { in_build: 1 } },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([stuck]);
    });

    test("leaving BUILD takes its series away, and that recovers", async () => {
      const step: MonitorStep = stepOf("openstack-instance-stuck-building");

      const tick: Tick = await evaluate(step, [anchorSeries(step)]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
    });
  });

  describe("an API", () => {
    const compute: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      openstack_service: "compute",
    };

    test("Nova's API stopped: no up series at all, and a collection with nothing in it", async () => {
      const step: MonitorStep = stepOf("openstack-compute-api-down");

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { series_in_collection: 0 } },
      ]);

      expect(tick.breaching).toEqual([compute]);
      expect(tick.recovered).toBe(false);
    });

    test("every call failing: the up series reads 0", async () => {
      const step: MonitorStep = stepOf("openstack-compute-api-down");

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { api_up: 0, series_in_collection: 1 } },
      ]);

      expect(tick.breaching).toEqual([compute]);
    });

    test("back again, as the recording's healthy scene says it", async () => {
      const step: MonitorStep = stepOf("openstack-compute-api-down");

      const tick: Tick = await evaluate(step, [
        { labels: compute, values: { api_up: 1, series_in_collection: 40 } },
      ]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
    });

    test("a region of two still reporting recovers the one that went away", async () => {
      const step: MonitorStep = stepOf("openstack-network-api-down");
      const stillThere: JSONObject = {
        [OPENSTACK_REGION_ATTRIBUTE]: "RegionTwo",
        openstack_service: "network",
      };

      const tick: Tick = await evaluate(step, [
        { labels: stillThere, values: { api_up: 1, collection_answered: 1 } },
      ]);

      expect(tick.breaching).toEqual([]);
      expect(tick.recovered).toBe(true);
    });
  });

  describe("an external network's addresses", () => {
    const publicNetwork: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      network_id: "27b8fbff-20f3-408c-bdcd-b535b0389bf7",
      network_name: "public",
    };
    const tenantNetwork: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      network_id: "717fc539-d828-4e10-8235-89e5a81be10a",
      network_name: "ou-net",
    };

    test("the external one fires, and a tenant's just as full does not", async () => {
      const step: MonitorStep = stepOf(
        "openstack-external-ip-pool-nearly-full",
      );

      const tick: Tick = await evaluate(step, [
        {
          labels: publicNetwork,
          values: {
            addresses_used: 95,
            addresses_total: 100,
            is_external_network: 1,
          },
        },
        {
          labels: tenantNetwork,
          values: { addresses_used: 95, addresses_total: 100 },
        },
        anchorSeries(step),
      ]);

      expect(tick.breaching).toEqual([publicNetwork]);
    });
  });

  describe("a storage pool", () => {
    const pool: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      name: "runnervm48cm3@lvmdriver-1#lvmdriver-1",
      volume_backend_name: "lvmdriver-1",
    };

    test("fires per pool past the line, and the pool going away recovers", async () => {
      const step: MonitorStep = stepOf("openstack-storage-pool-critical");

      expect(
        (
          await evaluate(step, [
            { labels: pool, values: { pool_total: 28.5, pool_free: 0.5 } },
            anchorSeries(step),
          ])
        ).breaching,
      ).toEqual([pool]);

      const gone: Tick = await evaluate(step, [anchorSeries(step)]);

      expect(gone.breaching).toEqual([]);
      expect(gone.recovered).toBe(true);
    });
  });

  describe("what an incident says", () => {
    const worker: JSONObject = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
      hostname: HOST,
      service: "nova-compute",
    };

    test("the cloud, what narrows the monitor, and the part that breached", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      step.data!.openstackMonitor!.resourceFilters = {
        regionName: REGION,
        availabilityZone: "nova",
        hypervisorName: HOST,
        serviceName: "nova-compute",
        projectId: "4f2d",
      };

      const rootCause: string = (
        await evaluate(step, [
          { labels: worker, values: { compute_service_up: 0 } },
          anchorSeries(step),
        ])
      ).response.rootCause as string;

      expect(rootCause).toContain("**OpenStack Cloud Details**");
      expect(rootCause).toContain("- Cloud: production");
      expect(rootCause).toContain(`- Region Filter: ${REGION}`);
      expect(rootCause).toContain("- Availability Zone Filter: nova");
      expect(rootCause).toContain(`- Hypervisor Filter: ${HOST}`);
      expect(rootCause).toContain("- Service Filter: nova-compute");
      expect(rootCause).toContain("- Project Filter: 4f2d");
      expect(rootCause).toContain("**Affected Resources** (1 total)");
      expect(rootCause).toContain(HOST);
      expect(rootCause).toContain("nova-compute");
    });

    test("no row for the series that only says the service reports", async () => {
      const step: MonitorStep = stepOf("openstack-compute-service-down");

      const rootCause: string = (
        await evaluate(step, [
          { labels: worker, values: { compute_service_up: 0 } },
          anchorSeries(step),
        ])
      ).response.rootCause as string;

      expect(rootCause).toContain("**Affected Resources** (1 total)");
      expect(rootCause).not.toContain(OPENSTACK_ANCHOR_METRIC_ALIAS);
    });
  });
});
