/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import CriteriaInEffect, {
  OpenCriteriaRecord,
} from "../../../../Server/Utils/Monitor/CriteriaInEffect";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../Types/JSON";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4793 end to end through MonitorCriteriaEvaluator.processMonitorStep
 * - the call the telemetry worker's response goes through in MonitorResource
 * - with the shipped Kubernetes templates, checked once a minute.
 *
 * MonitorResource keeps two things between checks that the evaluator reads
 * back through CriteriaInEffect: the monitor's status, and the series each
 * criteria has an open alert or incident for. A small model of it below
 * (afterCheck) does what MonitorResource does with each verdict: the first
 * matching criteria sets the status, the firing criteria opens a record per
 * series it matched and auto-resolves the others, and a check where no
 * criteria matched takes the monitor back to its default (operational)
 * status, resolving everything. Every time is fixed: the windows are the
 * worker's own, built from the check's time.
 */

const MINUTE: number = 60_000;
const START: number = Date.UTC(2026, 9, 16, 12, 0, 0);

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

function stepOf(templateId: string): MonitorStep {
  const template: KubernetesAlertTemplate =
    getKubernetesAlertTemplateById(templateId)!;

  return template.getMonitorStep({
    clusterIdentifier: "prod",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: template.name,
  });
}

function criteriaOf(step: MonitorStep): {
  firing: MonitorCriteriaInstance;
  healthy: MonitorCriteriaInstance;
} {
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return { firing: instances[0]!, healthy: instances[1]! };
}

// The check at `minute` minutes and 30 seconds past 12:00, and its window.
function windowAt(minute: number): InBetween<Date> {
  return RollingTimeUtil.convertToStartAndEndDate(
    RollingTime.Past15Minutes,
    new Date(START + minute * MINUTE + 30_000),
  );
}

// The minute buckets the worker reads at the check of `minute`.
function bucketsAt(minute: number): Array<number> {
  const buckets: Array<number> = [];
  for (let bucket: number = minute - 15; bucket <= minute; bucket++) {
    buckets.push(bucket);
  }
  return buckets;
}

// ---- the replica mismatch monitor: grouped by namespace and deployment

const replicaStep: MonitorStep = stepOf("k8s-deployment-replica-mismatch");
const replicaView: MetricsViewConfig =
  MonitorStep.getMetricsViewConfig(replicaStep)!;

function labelsOf(deployment: string): JSONObject {
  return { [NAMESPACE_KEY]: "payments", [DEPLOYMENT_KEY]: deployment };
}

function fingerprintOf(deployment: string): string {
  return MetricSeriesFingerprint.computeFingerprint(labelsOf(deployment));
}

/*
 * A deployment's replica counts per minute: [desired, available], or null
 * for a minute it did not report.
 */
type Replicas = (minute: number) => [number, number] | null;

function deploymentSeries(
  deployment: string,
  replicas: Replicas,
  minute: number,
): MetricSeriesResult | null {
  const reported: Array<{ bucket: number; counts: [number, number] }> = [];

  for (const bucket of bucketsAt(minute)) {
    const counts: [number, number] | null = replicas(bucket);
    if (counts) {
      reported.push({ bucket, counts });
    }
  }

  if (reported.length === 0) {
    // Gone from the window: the worker hands over no series for it.
    return null;
  }

  const query: (index: 0 | 1) => AggregatedResult = (
    index: 0 | 1,
  ): AggregatedResult => {
    return {
      data: reported.map(
        (point: { bucket: number; counts: [number, number] }) => {
          return {
            timestamp: new Date(START + point.bucket * MINUTE),
            value: point.counts[index],
            attributes: labelsOf(deployment),
          } as AggregateModel;
        },
      ),
    };
  };

  const queries: Array<AggregatedResult> = [query(0), query(1)];

  return {
    fingerprint: fingerprintOf(deployment),
    labels: labelsOf(deployment),
    aggregatedResults: [
      ...queries,
      MetricFormulaEvaluator.evaluateFormula({
        formula: replicaView.formulaConfigs[0]!.metricFormulaData.metricFormula,
        queryConfigs: replicaView.queryConfigs,
        formulaConfigs: [],
        results: queries,
      }),
    ],
  };
}

function replicaResponse(
  minute: number,
  deployments: Record<string, Replicas>,
): MetricMonitorResponse {
  const breakdown: Array<MetricSeriesResult> = [];

  for (const [name, replicas] of Object.entries(deployments)) {
    const series: MetricSeriesResult | null = deploymentSeries(
      name,
      replicas,
      minute,
    );
    if (series) {
      breakdown.push(series);
    }
  }

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: replicaView,
    metricResult: [],
    seriesBreakdown: breakdown,
    startAndEndDate: windowAt(minute),
  };
}

// ---- what MonitorResource keeps between checks

interface Kept {
  status: ObjectID;
  // Fingerprints with an open record of the firing criteria; "" = whole monitor.
  open: Set<string>;
}

function newMonitorKept(): Kept {
  return { status: ONLINE, open: new Set<string>() };
}

function afterCheck(data: {
  kept: Kept;
  result: ProbeApiIngestResponse;
  firing: MonitorCriteriaInstance;
  healthy: MonitorCriteriaInstance;
  grouped: boolean;
}): Kept {
  const metId: string | undefined = data.result.criteriaMetId?.toString();

  if (metId === data.firing.data!.id) {
    return {
      status: OFFLINE,
      open: new Set<string>(
        data.grouped ? firingSeries(data.result, data.firing) : [""],
      ),
    };
  }

  if (metId === data.healthy.data!.id || data.kept.status !== ONLINE) {
    return newMonitorKept();
  }

  return data.kept;
}

function firingSeries(
  result: ProbeApiIngestResponse,
  firing: MonitorCriteriaInstance,
): Array<string> {
  return (
    (result.matchedCriteria || []).find((entry: MatchedCriteriaResult) => {
      return entry.criteriaId === firing.data!.id;
    })?.perSeriesMatches || []
  ).map((match: PerSeriesCriteriaMatch) => {
    return match.fingerprint;
  });
}

function monitorOf(type: MonitorType, kept: Kept): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
  monitor.monitorType = type;
  monitor.currentMonitorStatusId = kept.status;
  return monitor;
}

interface Check {
  minute: number;
  result: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
  kept: Kept;
}

/*
 * Checks the monitor once a minute, `withRecords` deciding whether the
 * evaluator is told what MonitorResource keeps (as it always is in
 * production) or nothing at all.
 */
async function runChecks(data: {
  type: MonitorType;
  step: MonitorStep;
  grouped: boolean;
  fromMinute: number;
  toMinute: number;
  responseAt: (minute: number) => MetricMonitorResponse;
  withRecords?: boolean | undefined;
}): Promise<Array<Check>> {
  const { firing, healthy } = criteriaOf(data.step);
  const checks: Array<Check> = [];
  let kept: Kept = newMonitorKept();

  for (
    let minute: number = data.fromMinute;
    minute <= data.toMinute;
    minute++
  ) {
    const monitor: Monitor = monitorOf(data.type, kept);
    const open: Set<string> = kept.open;
    const summary: MonitorEvaluationSummary = {
      evaluatedAt: new Date(START + minute * MINUTE + 30_000),
      criteriaResults: [],
      events: [],
    };

    const result: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: data.responseAt(minute),
        monitorStep: data.step,
        monitor: monitor,
        probeApiIngestResponse: { monitorId: monitor.id!, rootCause: null },
        evaluationSummary: summary,
        ...(data.withRecords === false
          ? {}
          : {
              criteriaInEffect: new CriteriaInEffect({
                monitor: monitor,
                readOpenRecords: async (): Promise<
                  Array<OpenCriteriaRecord>
                > => {
                  return Array.from(open).map(
                    (series: string): OpenCriteriaRecord => {
                      return {
                        createdCriteriaId: firing.data!.id,
                        seriesFingerprint: series || undefined,
                      };
                    },
                  );
                },
              }),
            }),
      });

    kept = afterCheck({
      kept,
      result,
      firing,
      healthy,
      grouped: data.grouped,
    });
    checks.push({ minute, result, summary, kept });
  }

  return checks;
}

function firingAt(check: Check, step: MonitorStep): Array<string> {
  return firingSeries(check.result, criteriaOf(step).firing).map(
    (fingerprint: string) => {
      return fingerprint === fingerprintOf("api")
        ? "api"
        : fingerprint === fingerprintOf("checkout")
          ? "checkout"
          : fingerprint;
    },
  );
}

function firingFilterMessage(check: Check): string {
  const firingResult: MonitorEvaluationCriteriaResult =
    check.summary.criteriaResults[0]!;
  return firingResult.filters[0]!.message;
}

// checkout: two replicas, both available, reporting all along.
const CHECKOUT: Replicas = (): [number, number] => {
  return [2, 2];
};

describe("MonitorCriteriaEvaluator: All Values waits for a full window (#4793)", () => {
  describe("Deployment Replica Mismatch, grouped by namespace and deployment", () => {
    /*
     * api is created at 12:00 and never gets its one replica: desired 1,
     * available 0 - the customer's test deployment (a nodeSelector nothing
     * matches). checkout beside it is healthy throughout.
     */
    const API_STUCK: Replicas = (minute: number): [number, number] | null => {
      return minute >= 0 ? [1, 0] : null;
    };

    test("a new deployment opens nothing until its data covers the window - then exactly it", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 20,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            checkout: CHECKOUT,
            api: API_STUCK,
          });
        },
      });

      const firstFiring: Check | undefined = checks.find((check: Check) => {
        return firingAt(check, replicaStep).length > 0;
      });

      // 13.5 minutes in: its data reaches back to within 90 s of the window's start.
      expect(firstFiring?.minute).toBe(13);
      for (const check of checks) {
        expect({
          minute: check.minute,
          firing: firingAt(check, replicaStep),
        }).toEqual({
          minute: check.minute,
          firing: check.minute >= 13 ? ["api"] : [],
        });
      }

      /*
       * While it waits, the monitor stays operational - checkout keeps the
       * healthy criteria matched - and the evaluation log says how far api
       * has got.
       */
      for (const check of checks.filter((each: Check) => {
        return each.minute < 13;
      })) {
        expect(check.result.criteriaMetId).toBe(
          criteriaOf(replicaStep).healthy.data!.id,
        );
        expect(firingFilterMessage(check)).toBe(
          `Deployment: api | Namespace: payments - Deployment Replica Shortfall was 1 in all ${check.minute + 1} readings, above the 0 threshold. Waiting for 15 minutes of data: ${check.minute} of 15 minutes so far.`,
        );
      }

      // From then on the monitor is offline, with api's record open.
      expect(firstFiring!.kept).toEqual({
        status: OFFLINE,
        open: new Set<string>([fingerprintOf("api")]),
      });
    });

    test("one reading short - the customer's 73 seconds - opens nothing", async () => {
      const [check] = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 1,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            api: (bucket: number): [number, number] | null => {
              return bucket === 1 ? [1, 0] : null;
            },
          });
        },
      });

      expect(check!.result.perSeriesMatches || []).toEqual([]);
      expect(check!.result.criteriaMetId).toBeUndefined();
      expect(firingFilterMessage(check!)).toBe(
        "Deployment: api | Namespace: payments - Deployment Replica Shortfall was 1 in 1 reading, above the 0 threshold. Waiting for 15 minutes of data: less than a minute of 15 minutes so far.",
      );
    });

    /*
     * The agent restarts while api's alert is open: no data for 5 minutes.
     * api is still short, and nothing in its data says otherwise, so its
     * alert stays open through the gap - judged on its readings, as it
     * always was - instead of resolving and opening again a window later.
     * Then api gets its replica: the first healthy reading resolves it.
     */
    const API_STUCK_WITH_GAP_THEN_FIXED: Replicas = (
      minute: number,
    ): [number, number] | null => {
      if (minute < 0 || (minute >= 20 && minute < 25)) {
        return null;
      }
      return minute >= 35 ? [1, 1] : [1, 0];
    };

    test("an open alert holds through a gap in the data, and resolves on the first healthy reading", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 40,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            checkout: CHECKOUT,
            api: API_STUCK_WITH_GAP_THEN_FIXED,
          });
        },
      });

      for (const check of checks) {
        const expected: Array<string> =
          check.minute >= 13 && check.minute < 35 ? ["api"] : [];

        expect({
          minute: check.minute,
          firing: firingAt(check, replicaStep),
        }).toEqual({ minute: check.minute, firing: expected });
      }

      // The gap: offline throughout, api's record open, never resolved.
      for (const check of checks.filter((each: Check) => {
        return each.minute >= 20 && each.minute < 35;
      })) {
        expect(check.kept.status).toBe(OFFLINE);
        expect(Array.from(check.kept.open)).toEqual([fingerprintOf("api")]);
      }

      // Fixed at 12:35: back to operational, nothing open.
      const fixed: Check = checks.find((check: Check) => {
        return check.minute === 35;
      })!;
      expect(fixed.result.criteriaMetId).toBe(
        criteriaOf(replicaStep).healthy.data!.id,
      );
      expect(fixed.kept).toEqual(newMonitorKept());
    });

    test("told nothing of what is open, the same gap would let the alert go - which is why MonitorResource always tells it", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 30,
        withRecords: false,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            checkout: CHECKOUT,
            api: API_STUCK_WITH_GAP_THEN_FIXED,
          });
        },
      });

      const duringGap: Check = checks.find((check: Check) => {
        return check.minute === 25;
      })!;
      expect(firingAt(duringGap, replicaStep)).toEqual([]);
      expect(firingFilterMessage(duringGap)).toContain(
        "since a 5-minute gap in its data.",
      );
    });

    test("a deployment that goes away still lets its alert go once its data has left the window", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 45,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            checkout: CHECKOUT,
            // Deleted at 12:25 while still short.
            api: (bucket: number): [number, number] | null => {
              return bucket >= 0 && bucket < 25 ? [1, 0] : null;
            },
          });
        },
      });

      // Held while its last readings are in the window...
      for (const check of checks.filter((each: Check) => {
        return each.minute >= 13 && each.minute < 40;
      })) {
        expect({
          minute: check.minute,
          firing: firingAt(check, replicaStep),
        }).toEqual({ minute: check.minute, firing: ["api"] });
      }

      // ...and gone, its record resolved, once they have left it.
      for (const check of checks.filter((each: Check) => {
        return each.minute >= 40;
      })) {
        expect(firingAt(check, replicaStep)).toEqual([]);
        expect(check.kept).toEqual(newMonitorKept());
      }
    });

    test("a deployment recreated under the same name after a while away is new again", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: replicaStep,
        grouped: true,
        fromMinute: 1,
        toMinute: 60,
        responseAt: (minute: number) => {
          return replicaResponse(minute, {
            checkout: CHECKOUT,
            // Short 12:00-12:05, deleted, recreated at 12:30 and short again.
            api: (bucket: number): [number, number] | null => {
              return (bucket >= 0 && bucket <= 5) || bucket >= 30
                ? [1, 0]
                : null;
            },
          });
        },
      });

      const firstFiring: Check | undefined = checks.find((check: Check) => {
        return firingAt(check, replicaStep).length > 0;
      });

      // Never off the first five minutes; 13.5 minutes after it came back.
      expect(firstFiring?.minute).toBe(43);
    });
  });

  describe("Pod Stuck in Pending, ungrouped", () => {
    const pendingStep: MonitorStep = stepOf("k8s-pod-pending");
    const pendingView: MetricsViewConfig =
      MonitorStep.getMetricsViewConfig(pendingStep)!;

    // The cluster's lowest pod phase per minute: 2 (Running), or 1 (Pending).
    function pendingResponse(
      minute: number,
      phase: (bucket: number) => number | null,
    ): MetricMonitorResponse {
      const data: Array<AggregateModel> = [];
      for (const bucket of bucketsAt(minute)) {
        const value: number | null = phase(bucket);
        if (value !== null) {
          data.push({
            timestamp: new Date(START + bucket * MINUTE),
            value: value,
          });
        }
      }

      return {
        projectId: ObjectID.generate(),
        monitorId: ObjectID.generate(),
        metricViewConfig: pendingView,
        metricResult: [{ data }],
        startAndEndDate: windowAt(minute),
      };
    }

    test("the template is the ungrouped Past 15 Minutes, All Values one", () => {
      expect(pendingStep.data!.kubernetesMonitor!.rollingTime).toBe(
        RollingTime.Past15Minutes,
      );
      expect(MonitorStep.getGroupByAttributeKeys(pendingStep)).toEqual([]);
    });

    test("a cluster whose first pod is pending from its first scrape waits a full window before the monitor goes offline", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: pendingStep,
        grouped: false,
        fromMinute: 1,
        toMinute: 16,
        responseAt: (minute: number) => {
          return pendingResponse(minute, (bucket: number) => {
            return bucket >= 0 ? 1 : null;
          });
        },
      });

      for (const check of checks) {
        expect({
          minute: check.minute,
          status: check.kept.status.toString(),
        }).toEqual({
          minute: check.minute,
          status: (check.minute >= 13 ? OFFLINE : ONLINE).toString(),
        });
      }

      expect(firingFilterMessage(checks[0]!)).toBe(
        "min_pod_phase was 1 in all 2 readings, equal to the 1 threshold. Waiting for 15 minutes of data: 1 of 15 minutes so far.",
      );
    });

    test("a pod pending in a cluster that has always reported waits for the whole window to be pending, as before", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: pendingStep,
        grouped: false,
        fromMinute: 0,
        toMinute: 30,
        responseAt: (minute: number) => {
          // Running since long before; a pod pending from 12:10.
          return pendingResponse(minute, (bucket: number) => {
            return bucket >= 10 ? 1 : 2;
          });
        },
      });

      const offline: Array<number> = checks
        .filter((check: Check) => {
          return check.kept.status === OFFLINE;
        })
        .map((check: Check) => {
          return check.minute;
        });

      // Every bucket of the window pending: from 12:25:30 on.
      expect(offline[0]).toBe(25);
      expect(offline).toEqual([25, 26, 27, 28, 29, 30]);
    });

    test("an offline monitor stays offline through a gap in the cluster's data", async () => {
      const checks: Array<Check> = await runChecks({
        type: MonitorType.Kubernetes,
        step: pendingStep,
        grouped: false,
        fromMinute: 1,
        toMinute: 30,
        responseAt: (minute: number) => {
          // Pending from 12:00; the agent away 12:18-12:22.
          return pendingResponse(minute, (bucket: number) => {
            return bucket < 0 || (bucket >= 18 && bucket < 23) ? null : 1;
          });
        },
      });

      for (const check of checks.filter((each: Check) => {
        return each.minute >= 13;
      })) {
        expect({
          minute: check.minute,
          status: check.kept.status.toString(),
          open: Array.from(check.kept.open),
        }).toEqual({
          minute: check.minute,
          status: OFFLINE.toString(),
          open: [""],
        });
      }
    });
  });
});
