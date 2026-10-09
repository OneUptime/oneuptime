import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceService, {
  CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES,
  CLOUD_RESOURCE_DISCONNECTED_MINUTES,
} from "../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import StorageArrayService from "../../../Server/Services/StorageArrayService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import ReceivingCoverage from "../../../Server/Utils/Telemetry/ReceivingCoverage";
import ReceivingGapsUtil, {
  ReceivingGap,
  ReceivingGapReason,
} from "../../../Utils/Telemetry/ReceivingGaps";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Issue #2825: a host, cluster, array, fleet or function turns
 * "disconnected" after a stretch of silence - and that silence is measured
 * in time OneUptime was receiving. A platform restart, an upgrade or a
 * backed-up ingest queue used to flip every resource to "disconnected" the
 * moment OneUptime came back, before any agent had a chance to reconnect.
 *
 * Every sweep asks ReceivingCoverage for its cutoff; with no gaps that is the
 * same instant it always used, so nothing changes while OneUptime is up.
 */

const SENTINEL_CUTOFF: Date = new Date("2026-10-09T11:31:07.000Z");

type Sweep = {
  name: string;
  service: { findBy: (...args: Array<unknown>) => Promise<unknown> };
  run: () => Promise<unknown>;
  silenceInMinutes: number;
};

const FIND_BY_SWEEPS: Array<Sweep> = [
  {
    name: "HostService.markDisconnectedHosts",
    service: HostService as unknown as Sweep["service"],
    run: () => {
      return HostService.markDisconnectedHosts();
    },
    silenceInMinutes: 15,
  },
  {
    name: "DockerHostService.markDisconnectedHosts",
    service: DockerHostService as unknown as Sweep["service"],
    run: () => {
      return DockerHostService.markDisconnectedHosts();
    },
    silenceInMinutes: 15,
  },
  {
    name: "PodmanHostService.markDisconnectedHosts",
    service: PodmanHostService as unknown as Sweep["service"],
    run: () => {
      return PodmanHostService.markDisconnectedHosts();
    },
    silenceInMinutes: 15,
  },
  {
    name: "KubernetesClusterService.markDisconnectedClusters",
    service: KubernetesClusterService as unknown as Sweep["service"],
    run: () => {
      return KubernetesClusterService.markDisconnectedClusters();
    },
    silenceInMinutes: 15,
  },
  {
    name: "DockerSwarmClusterService.markDisconnectedClusters",
    service: DockerSwarmClusterService as unknown as Sweep["service"],
    run: () => {
      return DockerSwarmClusterService.markDisconnectedClusters();
    },
    silenceInMinutes: 15,
  },
  {
    name: "ProxmoxClusterService.markDisconnectedClusters",
    service: ProxmoxClusterService as unknown as Sweep["service"],
    run: () => {
      return ProxmoxClusterService.markDisconnectedClusters();
    },
    silenceInMinutes: 15,
  },
  {
    name: "CephClusterService.markDisconnectedClusters",
    service: CephClusterService as unknown as Sweep["service"],
    run: () => {
      return CephClusterService.markDisconnectedClusters();
    },
    silenceInMinutes: 15,
  },
  {
    name: "VMwareVCenterService.markDisconnectedVCenters",
    service: VMwareVCenterService as unknown as Sweep["service"],
    run: () => {
      return VMwareVCenterService.markDisconnectedVCenters();
    },
    silenceInMinutes: 15,
  },
  {
    name: "StorageArrayService.markDisconnectedArrays",
    service: StorageArrayService as unknown as Sweep["service"],
    run: () => {
      return StorageArrayService.markDisconnectedArrays();
    },
    silenceInMinutes: 15,
  },
  {
    name: "IoTFleetService.markDisconnectedFleets",
    service: IoTFleetService as unknown as Sweep["service"],
    run: () => {
      return IoTFleetService.markDisconnectedFleets();
    },
    silenceInMinutes: 15,
  },
  {
    name: "ServerlessFunctionService.markDisconnectedFunctions",
    service: ServerlessFunctionService as unknown as Sweep["service"],
    run: () => {
      return ServerlessFunctionService.markDisconnectedFunctions();
    },
    silenceInMinutes: 15,
  },
  {
    name: "RumApplicationService.markDisconnectedApplications",
    service: RumApplicationService as unknown as Sweep["service"],
    run: () => {
      return RumApplicationService.markDisconnectedApplications();
    },
    silenceInMinutes: 15,
  },
  {
    name: "CloudResourceService.markDisconnectedResources",
    service: CloudResourceService as unknown as Sweep["service"],
    run: () => {
      return CloudResourceService.markDisconnectedResources();
    },
    silenceInMinutes: CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES,
  },
];

// The value a QueryHelper.lessThan(...) was built with.
function lessThanValue(operator: unknown): unknown {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  return Object.values(parameters)[0];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Every disconnected sweep measures silence in receiving time", () => {
  test.each(FIND_BY_SWEEPS.map((sweep: Sweep) => {
    return [sweep.name, sweep];
  }))("%s asks for its cutoff and queries by it", async (_name: string, sweep: Sweep) => {
    const cutoffSpy: SpyInstance<typeof ReceivingCoverage.getSilenceCutoff> =
      jest
        .spyOn(ReceivingCoverage, "getSilenceCutoff")
        .mockResolvedValue(SENTINEL_CUTOFF);
    const findBy: SpyInstance<(...args: Array<unknown>) => Promise<unknown>> =
      jest.spyOn(sweep.service, "findBy").mockResolvedValue([]);

    await sweep.run();

    expect(cutoffSpy).toHaveBeenCalledWith({
      silenceInMinutes: sweep.silenceInMinutes,
    });
    expect(findBy).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(lessThanValue(query["lastSeenAt"])).toEqual(SENTINEL_CUTOFF);
  });

  test("CloudResourceService.markUnreportedMonitoredResources updates by its receiving-time cutoff", async () => {
    const cutoffSpy: SpyInstance<typeof ReceivingCoverage.getSilenceCutoff> =
      jest
        .spyOn(ReceivingCoverage, "getSilenceCutoff")
        .mockResolvedValue(SENTINEL_CUTOFF);
    const query: Mock<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    > = jest.fn(async () => {
      return [];
    });
    jest.spyOn(CloudResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as unknown as ReturnType<typeof CloudResourceService.getRepository>);

    await CloudResourceService.markUnreportedMonitoredResources();

    expect(cutoffSpy).toHaveBeenCalledWith({
      silenceInMinutes: CLOUD_RESOURCE_DISCONNECTED_MINUTES,
    });
    expect(query.mock.calls[0]![1]).toContain(SENTINEL_CUTOFF);
  });

  test("DatabaseServerService.markDisconnectedDatabaseServers updates by its receiving-time cutoff", async () => {
    const cutoffSpy: SpyInstance<typeof ReceivingCoverage.getSilenceCutoff> =
      jest
        .spyOn(ReceivingCoverage, "getSilenceCutoff")
        .mockResolvedValue(SENTINEL_CUTOFF);
    const query: Mock<
      (sql: string, parameters: Array<unknown>) => Promise<unknown>
    > = jest.fn(async () => {
      return [{ count: 0 }];
    });
    jest.spyOn(DatabaseServerService, "getRepository").mockReturnValue({
      manager: { query },
    } as unknown as ReturnType<typeof DatabaseServerService.getRepository>);

    await DatabaseServerService.markDisconnectedDatabaseServers();

    // The same minutes getCollectorSilenceCutoff always used.
    const now: Date = new Date();
    const plainMinutes: number = Math.round(
      (now.getTime() -
        DatabaseServerService.getCollectorSilenceCutoff(now).getTime()) /
        60_000,
    );
    expect(cutoffSpy).toHaveBeenCalledWith({ silenceInMinutes: plainMinutes });
    expect(query.mock.calls[0]![1]).toEqual([SENTINEL_CUTOFF]);
  });
});

describe("The cutoff the sweeps get", () => {
  const NOW: Date = new Date("2026-10-09T12:00:00.000Z");
  const MINUTE: number = 60_000;

  function at(minutesAgo: number): Date {
    return new Date(NOW.getTime() - minutesAgo * MINUTE);
  }

  test("is exactly N minutes ago while OneUptime was receiving throughout", async () => {
    jest.spyOn(ReceivingCoverage, "getGaps").mockResolvedValue([]);
    expect(
      await ReceivingCoverage.getSilenceCutoff({ silenceInMinutes: 15, now: NOW }),
    ).toEqual(at(15));
  });

  test("reaches back past a restart, so nothing turns disconnected the moment OneUptime returns", async () => {
    // Down for 25 minutes, back 1 minute ago (still reconnecting).
    const gaps: Array<ReceivingGap> = [
      { startsAt: at(26), endsAt: at(1), reason: ReceivingGapReason.NotReceiving },
      { startsAt: at(1), endsAt: NOW, reason: ReceivingGapReason.Reconnecting },
    ];
    jest.spyOn(ReceivingCoverage, "getGaps").mockResolvedValue(gaps);
    const cutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
      now: NOW,
    });
    expect(cutoff).toEqual(at(41));
    // A host last seen just before the outage is still connected.
    expect(at(27).getTime()).toBeGreaterThan(cutoff.getTime());
    expect(ReceivingGapsUtil.getReceivingMs(gaps, cutoff, NOW)).toBe(
      15 * MINUTE,
    );
  });

  test("a backed-up ingest queue does not make a resource disconnected either", async () => {
    jest.spyOn(ReceivingCoverage, "getGaps").mockResolvedValue([
      { startsAt: at(6), endsAt: NOW, reason: ReceivingGapReason.CatchingUp },
    ]);
    expect(
      await ReceivingCoverage.getSilenceCutoff({ silenceInMinutes: 15, now: NOW }),
    ).toEqual(at(21));
  });
});

/*
 * Guard: a new silence sweep follows the same rule. Every service method
 * named mark(Disconnected|Unreported)* that takes no arguments - a sweep over
 * every row, as opposed to the agents' explicit sign-off
 * markDisconnected({ agentId }) - gets its cutoff from
 * ReceivingCoverage.getSilenceCutoff.
 */
describe("Guard: silence sweeps use ReceivingCoverage", () => {
  const servicesDir: string = path.resolve(__dirname, "../../../Server/Services");
  const SWEEP_NAME: RegExp = /^mark(Disconnected|Unreported)/;

  const sweeps: Array<{ file: string; name: string; body: string }> = [];

  for (const file of fs.readdirSync(servicesDir)) {
    if (!file.endsWith(".ts")) {
      continue;
    }
    const source: string = fs.readFileSync(path.join(servicesDir, file), "utf8");
    if (
      !source.includes("markDisconnected") &&
      !source.includes("markUnreported")
    ) {
      continue;
    }
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        SWEEP_NAME.test(node.name.text) &&
        node.parameters.length === 0 &&
        node.body
      ) {
        sweeps.push({
          file,
          name: node.name.text,
          body: node.body.getText(sourceFile),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  test("finds every sweep this suite knows about", () => {
    expect(sweeps.length).toBeGreaterThanOrEqual(FIND_BY_SWEEPS.length + 2);
  });

  test("every sweep asks ReceivingCoverage for its cutoff", () => {
    const offenders: Array<string> = sweeps
      .filter((sweep: { body: string }) => {
        return !sweep.body.includes("ReceivingCoverage.getSilenceCutoff(");
      })
      .map((sweep: { file: string; name: string }) => {
        return `${sweep.file}: ${sweep.name}`;
      });
    expect(offenders).toEqual([]);
  });
});
