import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MetricTelemetrySnapshot from "Common/Utils/Monitor/MetricTelemetrySnapshot";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import KubernetesFinishedPods, {
  POD_UID_ATTRIBUTE,
} from "Common/Server/Utils/Monitor/KubernetesFinishedPods";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE DASHBOARD READS A STEP AS THE WORKER DOES (issue #5759).
 *
 * A monitor's page charts what the monitor evaluates: its queries with the
 * filters the worker reads them with (MonitorStepMetricQueries, in Common,
 * safe in the browser). That is a twin of the attribute building in each of
 * the worker's monitor functions. Here every one of those functions runs on
 * the same steps - settings and resource filters drawn from a seeded stream
 * - with its reads stood in for, and what it says it read each query with
 * (MetricMonitorResponse.queryAttributes) must be exactly what the twin
 * says. A change to either side that the other does not make fails here.
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

// The worker's job queue, and the OTLP decoder behind it, play no part here.
jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return { __esModule: true, default: {} };
  },
);

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
import {
  monitorCeph,
  monitorDocker,
  monitorDockerSwarm,
  monitorHost,
  monitorIoT,
  monitorKubernetes,
  monitorMetric,
  monitorOpenStack,
  monitorPodman,
  monitorProxmox,
  monitorStorageArray,
  monitorVMware,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

type MonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

type SettingsFunction = (random: SeededRandom) => JSONObject;

interface WorkerCase {
  monitorType: MonitorType;
  run: MonitorFunction;
  settings: SettingsFunction;
}

// Values as a step holds them once the worker has read its resource.
const ALPHABET: ReadonlyArray<string> = ["a", "b", "c", "1", "2", "-", "."];

const textOf: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  let text: string = "";
  const length: number = 1 + random(6);
  for (let index: number = 0; index < length; index++) {
    text += ALPHABET[random(ALPHABET.length)];
  }
  return text;
};

// A value, or nothing, about as often.
const maybe: (random: SeededRandom, value: () => unknown) => unknown = (
  random: SeededRandom,
  value: () => unknown,
): unknown => {
  return random(3) === 0 ? undefined : value();
};

const withoutUndefined: (object: JSONObject) => JSONObject = (
  object: JSONObject,
): JSONObject => {
  const result: JSONObject = {};
  for (const key of Object.keys(object)) {
    if (object[key] !== undefined) {
      result[key] = object[key];
    }
  }
  return result;
};

const CASES: Array<WorkerCase> = [
  {
    monitorType: MonitorType.Metrics,
    run: monitorMetric,
    settings: (): JSONObject => {
      return {};
    },
  },
  {
    monitorType: MonitorType.Host,
    run: monitorHost,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        hostIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
      });
    },
  },
  {
    monitorType: MonitorType.Kubernetes,
    run: monitorKubernetes,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        clusterIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          namespace: maybe(random, () => {
            return textOf(random);
          }) as string,
          nodeName: maybe(random, () => {
            return textOf(random);
          }) as string,
          podName: maybe(random, () => {
            return textOf(random);
          }) as string,
          workloadType: maybe(random, () => {
            return ["deployment", "StatefulSet", "daemonset", "job"][random(4)];
          }) as string,
          workloadName: maybe(random, () => {
            return textOf(random);
          }) as string,
        }),
      });
    },
  },
  ...[
    { monitorType: MonitorType.Docker, run: monitorDocker },
    { monitorType: MonitorType.Podman, run: monitorPodman },
  ].map((entry: { monitorType: MonitorType; run: MonitorFunction }) => {
    return {
      ...entry,
      settings: (random: SeededRandom): JSONObject => {
        return withoutUndefined({
          hostIdentifier: maybe(random, () => {
            return textOf(random);
          }) as string,
          containerFilters: withoutUndefined({
            containerName: maybe(random, () => {
              return textOf(random);
            }) as string,
            containerImage: maybe(random, () => {
              return textOf(random);
            }) as string,
          }),
        });
      },
    };
  }),
  {
    monitorType: MonitorType.Proxmox,
    run: monitorProxmox,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        clusterIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          scope: maybe(random, () => {
            return ["cluster", "node", "guest", "storage"][random(4)];
          }) as string,
          pveId: maybe(random, () => {
            return textOf(random);
          }) as string,
          nodeName: maybe(random, () => {
            return textOf(random);
          }) as string,
          guestId: maybe(random, () => {
            return `qemu/${random(500)}`;
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.OpenStack,
    run: monitorOpenStack,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        cloudIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          regionName: maybe(random, () => {
            return textOf(random);
          }) as string,
          availabilityZone: maybe(random, () => {
            return textOf(random);
          }) as string,
          hypervisorName: maybe(random, () => {
            return textOf(random);
          }) as string,
          serviceName: maybe(random, () => {
            return textOf(random);
          }) as string,
          projectId: maybe(random, () => {
            return textOf(random);
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.VMware,
    run: monitorVMware,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        vcenterIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          datacenterName: maybe(random, () => {
            return textOf(random);
          }) as string,
          clusterName: maybe(random, () => {
            return textOf(random);
          }) as string,
          hostName: maybe(random, () => {
            return ` ${textOf(random)} `;
          }) as string,
          vmName: maybe(random, () => {
            return textOf(random);
          }) as string,
          datastoreName: maybe(random, () => {
            return random(2) === 0 ? textOf(random) : random(9);
          }) as string,
          resourcePoolPath: maybe(random, () => {
            return textOf(random);
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.Ceph,
    run: monitorCeph,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        clusterIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          osdId: maybe(random, () => {
            return `osd.${random(9)}`;
          }) as string,
          poolId: maybe(random, () => {
            return String(random(9));
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.StorageArray,
    run: monitorStorageArray,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        arrayIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        storageSystem: maybe(random, () => {
          return [
            StorageSystem.PureStorageFlashArray,
            StorageSystem.PureStorageFlashBlade,
          ][random(2)];
        }) as string,
        resourceFilters: withoutUndefined({
          volumeName: maybe(random, () => {
            return textOf(random);
          }) as string,
          hostName: maybe(random, () => {
            return textOf(random);
          }) as string,
          podName: maybe(random, () => {
            return textOf(random);
          }) as string,
          componentName: maybe(random, () => {
            return textOf(random);
          }) as string,
          fileSystemName: maybe(random, () => {
            return textOf(random);
          }) as string,
          bucketName: maybe(random, () => {
            return textOf(random);
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.IoTDevice,
    run: monitorIoT,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        fleetIdentifier: maybe(random, () => {
          return `${textOf(random)}*`;
        }) as string,
        resourceFilters: withoutUndefined({
          scope: maybe(random, () => {
            return "device";
          }) as string,
          deviceId: maybe(random, () => {
            return textOf(random);
          }) as string,
          deviceType: maybe(random, () => {
            return textOf(random);
          }) as string,
        }),
      });
    },
  },
  {
    monitorType: MonitorType.DockerSwarm,
    run: monitorDockerSwarm,
    settings: (random: SeededRandom): JSONObject => {
      return withoutUndefined({
        clusterIdentifier: maybe(random, () => {
          return textOf(random);
        }) as string,
        resourceFilters: withoutUndefined({
          containerName: maybe(random, () => {
            return textOf(random);
          }) as string,
          containerImage: maybe(random, () => {
            return [
              "nginx",
              "nginx:1.27",
              "registry.io/team/api:2@sha256:abc",
              "@sha256:abc",
              "  ",
            ][random(5)];
          }) as string,
          nodeName: maybe(random, () => {
            return textOf(random);
          }) as string,
          serviceName: maybe(random, () => {
            return textOf(random);
          }) as string,
          tasksOnly: maybe(random, () => {
            return random(2) === 0;
          }) as boolean,
        }),
      });
    },
  },
];

// Series the catalogs know, so per-metric labels are exercised too.
const METRIC_NAMES: ReadonlyArray<string> = [
  "a.metric",
  "openstack_nova_server_status",
  "openstack_nova_up",
  "purefa_volume_space_bytes",
  "purefb_hardware_health",
];

const queryOf: (
  random: SeededRandom,
  index: number,
) => MetricQueryConfigData = (
  random: SeededRandom,
  index: number,
): MetricQueryConfigData => {
  const attributes: JSONObject = {};
  const count: number = random(3);
  for (let attribute: number = 0; attribute < count; attribute++) {
    attributes[`own.${textOf(random)}`] = textOf(random);
  }

  return {
    metricAliasData: {
      metricVariable: String.fromCharCode(97 + index),
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: METRIC_NAMES[random(METRIC_NAMES.length)]!,
        aggegationType: MetricsAggregationType.Avg,
        ...(count > 0 ? { attributes } : {}),
      },
    },
  } as unknown as MetricQueryConfigData;
};

const stepOf: (data: {
  monitorType: MonitorType;
  settings: JSONObject;
  queryConfigs: Array<MetricQueryConfigData>;
}) => MonitorStep = (data: {
  monitorType: MonitorType;
  settings: JSONObject;
  queryConfigs: Array<MetricQueryConfigData>;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined },
    [MonitorStepMetricQueries.getStepKey(data.monitorType)!]: {
      ...data.settings,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: data.queryConfigs,
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  return step;
};

describe("the dashboard reads every metric-backed step as the worker does", () => {
  beforeEach(() => {
    (MetricService.aggregateBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValue({ data: [] } as never);
    (MetricService.findBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValue([] as never);
    (MetricTypeService.findBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValue([] as never);
  });

  test("every metric-backed type has a worker function here", () => {
    expect(
      CASES.map((entry: WorkerCase) => {
        return entry.monitorType;
      }).sort(),
    ).toEqual(MonitorStepMetricQueries.getMonitorTypes().sort());
  });

  test.each(CASES)(
    "$monitorType: what the worker says it read each query with is what the dashboard charts",
    async (entry: WorkerCase) => {
      const random: SeededRandom = seededRandom(
        5759 + CASES.indexOf(entry) * 1000,
      );

      for (let round: number = 0; round < 40; round++) {
        const queryConfigs: Array<MetricQueryConfigData> = [];
        const queryCount: number = 1 + random(3);
        for (let index: number = 0; index < queryCount; index++) {
          queryConfigs.push(queryOf(random, index));
        }

        const step: MonitorStep = stepOf({
          monitorType: entry.monitorType,
          settings: entry.settings(random),
          queryConfigs,
        });

        const response: MetricMonitorResponse = await entry.run({
          monitorStep: step,
          monitorId: ObjectID.generate(),
          projectId: ObjectID.generate(),
        });

        const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads(
          {
            monitorType: entry.monitorType,
            monitorStep: step,
          },
        )!;

        expect(response.queryAttributes).toHaveLength(queryConfigs.length);

        /*
         * What an incident or alert this check opened keeps of it (issue
         * #6265): its card charts the same as the monitor's page.
         */
        const snapshot: TelemetryQuery =
          MetricTelemetrySnapshot.fromResponse(response);
        // Its queries as the step keeps them, each charted with its scope.
        expect(snapshot.metricViewData?.queryConfigs).toBe(
          response.metricViewConfig.queryConfigs,
        );
        const snapshotCharted: Array<MetricQueryConfigData> =
          MetricTelemetrySnapshot.applyScopes({
            queryConfigs: snapshot.metricViewData!.queryConfigs,
            scopes: MetricTelemetrySnapshot.getStoredScopes(snapshot)!,
          });

        for (let index: number = 0; index < queryConfigs.length; index++) {
          expect(
            snapshotCharted[index]!.metricQueryData.filterData.attributes ||
              {},
          ).toEqual(
            reads.queryConfigs[index]!.metricQueryData.filterData.attributes ||
              {},
          );
        }

        for (let index: number = 0; index < queryConfigs.length; index++) {
          const workerRead: Dictionary<unknown> | undefined =
            response.queryAttributes?.[index];

          expect(
            MonitorStepMetricQueries.getReadAttributes({
              monitorType: entry.monitorType,
              settings: MonitorStepMetricQueries.getSettings({
                monitorType: entry.monitorType,
                monitorStep: step,
              })!,
              queryConfig: queryConfigs[index]!,
            }),
          ).toEqual(workerRead);

          // The chart's query carries the same, and nothing when it is empty.
          const charted: unknown =
            reads.queryConfigs[index]!.metricQueryData.filterData.attributes;
          expect(charted || {}).toEqual(workerRead || {});
        }
      }
    },
  );

  /*
   * A Kubernetes check of a request metric leaves out the pods that
   * finished in its window (KubernetesFinishedPods): the list describes that
   * window only, so the worker does not say it read the query with it, and
   * neither the monitor's charts nor an event's snapshot repeat it.
   */
  test("Kubernetes: the finished pods a request read leaves out are not kept in the snapshot", async () => {
    const finishedPods: jest.SpiedFunction<
      typeof KubernetesFinishedPods.readFinishedPodUids
    > = jest
      .spyOn(KubernetesFinishedPods, "readFinishedPodUids")
      .mockResolvedValue(["finished-pod-uid"]);

    try {
      const request: MetricQueryConfigData = {
        metricAliasData: {
          metricVariable: "a",
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.container.cpu_request",
            aggegationType: MetricsAggregationType.Sum,
          },
        },
      } as unknown as MetricQueryConfigData;

      const step: MonitorStep = stepOf({
        monitorType: MonitorType.Kubernetes,
        settings: { clusterIdentifier: "prod" },
        queryConfigs: [request],
      });

      const response: MetricMonitorResponse = await monitorKubernetes({
        monitorStep: step,
        monitorId: ObjectID.generate(),
        projectId: ObjectID.generate(),
      });

      // The read itself left the finished pod out...
      const read: { query: { attributes: Dictionary<unknown> } } = (
        MetricService.aggregateBy as unknown as jest.Mock
      ).mock.calls[0]![0] as never;
      expect(read.query.attributes[POD_UID_ATTRIBUTE]).toBeInstanceOf(
        IncludesNone,
      );

      // ...and what the event keeps names the cluster only.
      const snapshot: TelemetryQuery =
        MetricTelemetrySnapshot.fromResponse(response);
      expect(snapshot.metricQueryScopes).toEqual([
        { "resource.k8s.cluster.name": "prod" },
      ]);
    } finally {
      finishedPods.mockRestore();
    }
  });
});
