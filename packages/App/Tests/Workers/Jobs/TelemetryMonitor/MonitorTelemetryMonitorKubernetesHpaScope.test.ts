import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import { getKubernetesAlertTemplateById } from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  KubernetesResourceFilters,
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * HPA Saturated at Max Replicas scoped to one HorizontalPodAutoscaler, from
 * the rows ingest stores to the verdict the worker reaches.
 *
 * The bug: the template has a Workload scope, but no Workload Kind named an
 * HPA, so a Workload Name was read as a Deployment's
 * (`resource.k8s.deployment.name`). No HPA metric carries one: scoped to
 * "web", the monitor read nothing and never fired. The k8s_cluster receiver
 * gives an HPA's metrics `k8s.hpa.name`, `k8s.hpa.uid` and
 * `k8s.namespace.name` (from collector 0.96.0 to 0.161.0, the versions the
 * agent runs); its `k8s.hpa.scaletargetref.*` attributes, which would name
 * what the HPA scales, are off by default and the agent leaves them off. A
 * Workload Kind of HorizontalPodAutoscaler ("hpa") now reads the name as
 * the HPA's own: `resource.k8s.hpa.name`.
 *
 * Driven through the worker's real Kubernetes read and the real criteria
 * evaluator, over rows folded per minute as ClickHouse folds them
 * (SqlGroupedFold).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { monitorKubernetes } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  FoldedReadArgs,
  StoredMetricRow,
  foldRowsAsSqlRead,
} from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;

// The end of every evaluated window: the template reads the 5 minutes before.
const WINDOW_END_MS: number = Date.UTC(2026, 9, 31, 12, 0, 0);

const CURRENT: string = "k8s.hpa.current_replicas";
const MAX: string = "k8s.hpa.max_replicas";
const MIN: string = "k8s.hpa.min_replicas";

const CLUSTER: string = "prod-east";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const HPA_KEY: string = "resource.k8s.hpa.name";
const HPA_UID_KEY: string = "resource.k8s.hpa.uid";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

const TEMPLATE_ID: string = "k8s-hpa-at-max-replicas";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const templateArgs: {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  clusterIdentifier: CLUSTER,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: CLUSTER,
};

// One HPA, its spec and status as k8s_cluster reads them every scrape.
interface Hpa {
  namespace: string;
  name: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  // Seconds past each 30-second scrape the receiver reads it at.
  phaseSeconds?: number | undefined;
}

/*
 * The rows ingest stores for each HPA: its current, max and min replicas
 * every 30 seconds, from a minute before the window to its end, on the
 * resource k8s_cluster gives an HPA - its name, UID and namespace, and the
 * cluster's name the agent adds. Nothing names what the HPA scales.
 */
function hpaRows(hpas: Array<Hpa>): Dictionary<Array<StoredMetricRow>> {
  const rows: Dictionary<Array<StoredMetricRow>> = {
    [CURRENT]: [],
    [MAX]: [],
    [MIN]: [],
  };

  for (const hpa of hpas) {
    const attributes: JSONObject = {
      [CLUSTER_KEY]: CLUSTER,
      [NAMESPACE_KEY]: hpa.namespace,
      [HPA_KEY]: hpa.name,
      [HPA_UID_KEY]: `${hpa.namespace}-${hpa.name}-uid`,
    };

    for (
      let atMs: number =
        WINDOW_END_MS - 6 * MINUTE + (hpa.phaseSeconds || 0) * SECOND;
      atMs <= WINDOW_END_MS;
      atMs += 30 * SECOND
    ) {
      const time: Date = new Date(atMs);
      rows[CURRENT]!.push({ time, value: hpa.currentReplicas, attributes });
      rows[MAX]!.push({ time, value: hpa.maxReplicas, attributes });
      rows[MIN]!.push({ time, value: hpa.minReplicas, attributes });
    }
  }

  return rows;
}

interface AggregateArgs extends FoldedReadArgs {
  query: { name: string; attributes?: Dictionary<string> };
  startTimestamp: Date;
  endTimestamp: Date;
}

interface FindArgs {
  query: { name: string; attributes?: Dictionary<string> };
  limit: number;
}

// The aggregated reads the worker made, so a test can say what it asked for.
let reads: Array<AggregateArgs> = [];

function selects(
  row: StoredMetricRow,
  attributes: Dictionary<string> | undefined,
): boolean {
  return Object.entries(attributes || {}).every(
    ([key, value]: [string, unknown]): boolean => {
      return row.attributes[key] === value;
    },
  );
}

/*
 * Every read of the worker: the rows of the metric it asks for that its
 * attribute filters select, inside its window, folded per minute and per
 * series by the read's own aggregation; and the raw scan of the newest rows
 * the Affected Resources are named from.
 */
function givenStored(
  rowsByMetricName: Dictionary<Array<StoredMetricRow>>,
): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: AggregateArgs = args as AggregateArgs;
    reads.push(read);

    const selected: Array<StoredMetricRow> = (
      rowsByMetricName[read.query.name] || []
    ).filter((row: StoredMetricRow): boolean => {
      return (
        row.time.getTime() >= read.startTimestamp.getTime() &&
        row.time.getTime() <= read.endTimestamp.getTime() &&
        selects(row, read.query.attributes)
      );
    });

    return foldRowsAsSqlRead(selected, read);
  });

  metricFindBy.mockImplementation(async (args: unknown) => {
    const find: FindArgs = args as FindArgs;

    return (rowsByMetricName[find.query.name] || [])
      .filter((row: StoredMetricRow): boolean => {
        return (
          row.time.getTime() <= WINDOW_END_MS &&
          selects(row, find.query.attributes)
        );
      })
      .sort((a: StoredMetricRow, b: StoredMetricRow): number => {
        return b.time.getTime() - a.time.getTime();
      })
      .slice(0, find.limit)
      .map((row: StoredMetricRow): JSONObject => {
        return {
          attributes: row.attributes,
          value: row.value,
          time: row.time,
        } as JSONObject;
      });
  });
}

// The template's step, scoped as the monitor form's Workload scope scopes it.
function scoped(resourceFilters: KubernetesResourceFilters): MonitorStep {
  const step: MonitorStep =
    getKubernetesAlertTemplateById(TEMPLATE_ID)!.getMonitorStep(templateArgs);

  step.setKubernetesMonitor({
    ...step.data!.kubernetesMonitor!,
    resourceScope: KubernetesResourceScope.Workload,
    resourceFilters: resourceFilters,
  });

  return step;
}

interface Verdict {
  fires: boolean;
  recovers: boolean;
}

interface Judged {
  // By the series' namespace and HPA name, joined with "/".
  verdicts: Dictionary<Verdict>;
  response: MetricMonitorResponse;
}

function seriesName(labels: JSONObject, keys: Array<string>): string {
  return keys
    .map((key: string): string => {
      return String(labels[key] ?? "");
    })
    .join("/");
}

/*
 * The worker's read of the stored HPAs, and each series' verdict: whether
 * the firing criteria (the first) and the recovering one (the last)
 * matched it, each with all of its filters, as the monitor's evaluation
 * combines them.
 */
async function judge(input: {
  hpas: Array<Hpa>;
  step: MonitorStep;
}): Promise<Judged> {
  givenStored(hpaRows(input.hpas));

  const response: MetricMonitorResponse = await monitorKubernetes({
    monitorStep: input.step,
    monitorId: monitorId,
    projectId: projectId,
    evaluateUntil: new Date(WINDOW_END_MS),
  });

  const instances: Array<MonitorCriteriaInstance> =
    input.step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const firingId: string = instances[0]!.data!.id!.toString();
  const recoveringId: string =
    instances[instances.length - 1]!.data!.id!.toString();
  const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(input.step);

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.monitorType = MonitorType.Kubernetes;
  monitor.name = CLUSTER;

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: input.step,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  const verdicts: Dictionary<Verdict> = {};

  for (const series of response.seriesBreakdown || []) {
    verdicts[seriesName(series.labels, keys)] = {
      fires: false,
      recovers: false,
    };
  }

  for (const matched of (result.matchedCriteria ||
    []) as Array<MatchedCriteriaResult>) {
    const key: keyof Verdict | null =
      matched.criteriaId === firingId
        ? "fires"
        : matched.criteriaId === recoveringId
          ? "recovers"
          : null;

    if (!key) {
      continue;
    }

    for (const match of matched.perSeriesMatches) {
      const name: string = seriesName(match.labels || {}, keys);
      const verdict: Verdict = verdicts[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = true;
      verdicts[name] = verdict;
    }
  }

  return { verdicts: verdicts, response: response };
}

// The HPA names each of the worker's reads asked for.
function namesRead(): Array<string | undefined> {
  return reads.map((read: AggregateArgs): string | undefined => {
    return read.query.attributes?.[HPA_KEY];
  });
}

// An HPA scaled up to its ceiling, above its floor: saturated.
function saturated(namespace: string, name: string): Hpa {
  return {
    namespace,
    name,
    minReplicas: 2,
    maxReplicas: 10,
    currentReplicas: 10,
  };
}

// An HPA with room to scale.
function withHeadroom(namespace: string, name: string): Hpa {
  return {
    namespace,
    name,
    minReplicas: 2,
    maxReplicas: 10,
    currentReplicas: 3,
  };
}

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  // The unit k8s_cluster declares for every HPA metric.
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: CURRENT, unit: "{pod}" },
    { name: MAX, unit: "{pod}" },
    { name: MIN, unit: "{pod}" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("HPA Saturated at Max Replicas scoped to an HPA", () => {
  test("reads that HPA's series alone, by its own name, and fires on its saturation", async () => {
    const judged: Judged = await judge({
      hpas: [
        saturated("payments", "web"),
        saturated("payments", "api"),
        withHeadroom("shop", "search"),
      ],
      step: scoped({ workloadType: "hpa", workloadName: "web" }),
    });

    expect(judged.verdicts).toEqual({
      "payments/web": { fires: true, recovers: false },
    });

    // Every query (current, max and min replicas) asked for that HPA alone.
    expect(reads.length).toBe(3);
    for (const read of reads) {
      expect(read.query.attributes).toEqual({
        [CLUSTER_KEY]: CLUSTER,
        [HPA_KEY]: "web",
      });
    }
  });

  test("another HPA at its ceiling does not fire a monitor scoped to one with headroom", async () => {
    const judged: Judged = await judge({
      hpas: [withHeadroom("payments", "web"), saturated("payments", "api")],
      step: scoped({ workloadType: "hpa", workloadName: "web" }),
    });

    expect(judged.verdicts).toEqual({
      "payments/web": { fires: false, recovers: true },
    });
  });

  test("the same name in two namespaces: each is its own series, and Namespace picks one", async () => {
    const hpas: Array<Hpa> = [
      saturated("payments", "web"),
      withHeadroom("shop", "web"),
    ];

    expect(
      (
        await judge({
          hpas,
          step: scoped({ workloadType: "hpa", workloadName: "web" }),
        })
      ).verdicts,
    ).toEqual({
      "payments/web": { fires: true, recovers: false },
      "shop/web": { fires: false, recovers: true },
    });

    expect(
      (
        await judge({
          hpas,
          step: scoped({
            namespace: "shop",
            workloadType: "hpa",
            workloadName: "web",
          }),
        })
      ).verdicts,
    ).toEqual({ "shop/web": { fires: false, recovers: true } });
  });

  test("a name no HPA has reads nothing", async () => {
    const judged: Judged = await judge({
      hpas: [saturated("payments", "web"), saturated("payments", "api")],
      step: scoped({ workloadType: "hpa", workloadName: "checkout" }),
    });

    expect(judged.verdicts).toEqual({});
    expect(judged.response.seriesBreakdown || []).toEqual([]);
    expect(namesRead()).toEqual(["checkout", "checkout", "checkout"]);
  });

  test.each([
    {
      saved: "a Deployment's",
      resourceFilters: { workloadType: "deployment", workloadName: "web" },
    },
    {
      saved: "a name with no kind",
      resourceFilters: { workloadName: "web" },
    },
  ])(
    "the trap: $saved, as the form used to save it, reads nothing - an HPA's metrics carry no Deployment name",
    async (input: {
      saved: string;
      resourceFilters: KubernetesResourceFilters;
    }) => {
      const judged: Judged = await judge({
        hpas: [saturated("payments", "web")],
        step: scoped(input.resourceFilters),
      });

      // The worker reads such a monitor as it always did: unchanged.
      expect(judged.verdicts).toEqual({});
      for (const read of reads) {
        expect(read.query.attributes?.[DEPLOYMENT_KEY]).toBe("web");
        expect(read.query.attributes?.[HPA_KEY]).toBeUndefined();
      }
    },
  );

  test("no name: every HPA in the cluster is its own series, as before", async () => {
    const judged: Judged = await judge({
      hpas: [saturated("payments", "web"), withHeadroom("shop", "search")],
      step: scoped({ workloadType: "hpa" }),
    });

    expect(judged.verdicts).toEqual({
      "payments/web": { fires: true, recovers: false },
      "shop/search": { fires: false, recovers: true },
    });
    for (const read of reads) {
      expect(read.query.attributes).toEqual({ [CLUSTER_KEY]: CLUSTER });
    }
  });

  /*
   * HPAs of names and namespaces drawn from a seeded stream, each saturated
   * (at its ceiling, above its floor), with headroom (at most 80% of its
   * ceiling), or pinned (its floor is its ceiling, so it cannot scale),
   * read at their own scrape phase. Scoped to each name in turn (and, half
   * the time, a namespace), the monitor reads exactly the HPAs of that
   * name, each as its own series, and fires for exactly the saturated ones
   * among them; a name no HPA has, or a namespace without it, reads
   * nothing.
   */
  test("whatever the HPAs, a monitor scoped to one reads exactly its series, and a wrong name reads nothing", async () => {
    const random: SeededRandom = seededRandom(5_476);
    const names: Array<string> = ["web", "api", "worker", "checkout", "search"];
    const namespaces: Array<string> = ["payments", "shop"];
    let fired: number = 0;
    let recovered: number = 0;
    let readNothing: number = 0;

    for (let trial: number = 0; trial < 20; trial++) {
      const hpas: Array<Hpa> = [];
      const shapes: Dictionary<"saturated" | "headroom" | "pinned"> = {};

      for (const namespace of namespaces) {
        for (const name of names) {
          if (random() < 0.5) {
            continue;
          }

          const shape: "saturated" | "headroom" | "pinned" = (
            ["saturated", "headroom", "pinned"] as const
          )[random(3)]!;
          const minReplicas: number = 1 + random(3);
          const maxReplicas: number = 10 + random(10);
          const pinned: number = 2 + random(8);

          shapes[`${namespace}/${name}`] = shape;
          hpas.push({
            namespace,
            name,
            minReplicas: shape === "pinned" ? pinned : minReplicas,
            maxReplicas: shape === "pinned" ? pinned : maxReplicas,
            currentReplicas:
              shape === "saturated"
                ? maxReplicas
                : shape === "headroom"
                  ? minReplicas +
                    random(Math.floor(0.8 * maxReplicas) - minReplicas + 1)
                  : pinned,
            phaseSeconds: random(30),
          });
        }
      }

      /*
       * Every name the cluster may have, and one it never has; half the
       * time in a namespace, which may not hold an HPA of that name.
       */
      for (const target of [...names, "no-such-hpa"]) {
        const namespace: string | undefined =
          random() < 0.5 ? namespaces[random(namespaces.length)] : undefined;
        const expected: Dictionary<Verdict> = {};

        for (const hpa of hpas) {
          if (
            hpa.name !== target ||
            (namespace !== undefined && hpa.namespace !== namespace)
          ) {
            continue;
          }

          const fires: boolean =
            shapes[`${hpa.namespace}/${hpa.name}`] === "saturated";
          expected[`${hpa.namespace}/${hpa.name}`] = {
            fires: fires,
            recovers: !fires,
          };
          fired += fires ? 1 : 0;
          recovered += fires ? 0 : 1;
        }
        readNothing += Object.keys(expected).length === 0 ? 1 : 0;

        reads = [];
        const label: string = `trial ${trial}: ${namespace || "any"}/${target}`;
        const judged: Judged = await judge({
          hpas,
          step: scoped({
            ...(namespace ? { namespace } : {}),
            workloadType: "hpa",
            workloadName: target,
          }),
        });

        expect({ label, verdicts: judged.verdicts }).toEqual({
          label,
          verdicts: expected,
        });
        expect(reads.length).toBe(3);
        for (const read of reads) {
          expect({ label, attributes: read.query.attributes }).toEqual({
            label,
            attributes: {
              [CLUSTER_KEY]: CLUSTER,
              ...(namespace ? { [NAMESPACE_KEY]: namespace } : {}),
              [HPA_KEY]: target,
            },
          });
        }
      }
    }

    // The sweep held both verdicts, and scopes that read nothing.
    expect(fired).toBeGreaterThan(10);
    expect(recovered).toBeGreaterThan(10);
    expect(readNothing).toBeGreaterThan(10);
  });
});
