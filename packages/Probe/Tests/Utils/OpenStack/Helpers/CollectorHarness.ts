import OpenStackCollectorMemory from "../../../../Utils/OpenStack/OpenStackCollectorMemory";
import { OpenStackCollectorDependencies } from "../../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackTransport,
  OpenStackTransportHandle,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import { OpenStackClock } from "../../../../Utils/OpenStack/OpenStackServiceClient";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackCollectionJob,
  OpenStackConnectionTestJob,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { RECORDED_AUTH_URL, RECORDED_REGION } from "./RecordedCloud";

/*
 * What a collector test needs around a transport it scripts: a clock that waits only
 * when told how long, memory of its own, and the jobs a server would hand out. Waiting
 * moves the clock rather than the test, so a test of a half-hour back-off takes no time.
 */

export const SECRET: string = "n0t-in-any-report!";
export const COLLECTED_AT_MS: number = Date.parse("2026-11-04T11:50:00.000Z");

export interface FakeClock extends OpenStackClock {
  advance: (milliseconds: number) => void;
  sleeps: Array<number>;
}

export function createFakeClock(startAt: number = COLLECTED_AT_MS): FakeClock {
  let now: number = startAt;
  const sleeps: Array<number> = [];

  return {
    now: (): number => {
      return now;
    },
    sleep: async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    random: (): number => {
      return 0.5;
    },
    advance: (milliseconds: number): void => {
      now += milliseconds;
    },
    sleeps: sleeps,
  };
}

export interface CollectorHarness {
  dependencies: OpenStackCollectorDependencies;
  clock: FakeClock;
  memory: OpenStackCollectorMemory;
  transportsOpened: () => number;
  transportsClosed: () => number;
}

export function createCollectorHarness(data: {
  transport: OpenStackTransport;
  clock?: FakeClock | undefined;
  memory?: OpenStackCollectorMemory | undefined;
  overrides?: Partial<OpenStackCollectorDependencies> | undefined;
}): CollectorHarness {
  const clock: FakeClock = data.clock || createFakeClock();
  const memory: OpenStackCollectorMemory =
    data.memory || new OpenStackCollectorMemory();

  let opened: number = 0;
  let closed: number = 0;

  return {
    clock: clock,
    memory: memory,
    transportsOpened: (): number => {
      return opened;
    },
    transportsClosed: (): number => {
      return closed;
    },
    dependencies: {
      resolve: async (): Promise<Array<string>> => {
        return ["192.0.2.10"];
      },
      createTransport: (): OpenStackTransportHandle => {
        opened++;

        return {
          transport: data.transport,
          close: (): void => {
            closed++;
          },
        };
      },
      clock: clock,
      memory: memory,
      scopeVersion: "test",
      ...data.overrides,
    },
  };
}

export function collectionJob(
  overrides: Partial<OpenStackCollectionJob> = {},
): OpenStackCollectionJob {
  return {
    openStackCloudId: "cloud-1",
    cloudName: "Lab",
    authUrl: RECORDED_AUTH_URL,
    credential: {
      kind: "applicationCredential",
      id: "monitoring-credential",
      secret: SECRET,
    },
    regions: [RECORDED_REGION],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    collectionIntervalInMinutes: 2,
    settingsVersion: 7,
    ...overrides,
  };
}

export function connectionTestJob(
  overrides: Partial<OpenStackConnectionTestJob> = {},
): OpenStackConnectionTestJob {
  return {
    openStackCloudConnectionTestId: "test-1",
    authUrl: RECORDED_AUTH_URL,
    credential: {
      kind: "applicationCredential",
      id: "monitoring-credential",
      secret: SECRET,
    },
    regions: [],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    ...overrides,
  };
}

// One datapoint of a report's metrics, its attributes as a plain record.
export interface ReportedDatapoint {
  metric: string;
  description: string | undefined;
  unit: string | undefined;
  kinds: Array<string>;
  labels: Record<string, string>;
  value: number;
  timeUnixNano: string;
}

export function datapointsOf(
  resourceMetrics: unknown,
): Array<ReportedDatapoint> {
  const points: Array<ReportedDatapoint> = [];

  for (const resource of (resourceMetrics || []) as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const kinds: Array<string> = [
          "gauge",
          "sum",
          "histogram",
          "summary",
        ].filter((kind: string): boolean => {
          return Boolean(metric[kind]);
        });

        const body: JSONObject = metric[kinds[0] as string] as JSONObject;

        for (const point of body["dataPoints"] as Array<JSONObject>) {
          const labels: Record<string, string> = {};

          for (const attribute of (point["attributes"] ||
            []) as Array<JSONObject>) {
            labels[attribute["key"] as string] = (
              attribute["value"] as JSONObject
            )["stringValue"] as string;
          }

          points.push({
            metric: metric["name"] as string,
            description: metric["description"] as string | undefined,
            unit: metric["unit"] as string | undefined,
            kinds: kinds,
            labels: labels,
            value: point["asDouble"] as number,
            timeUnixNano: point["timeUnixNano"] as string,
          });
        }
      }
    }
  }

  return points;
}
