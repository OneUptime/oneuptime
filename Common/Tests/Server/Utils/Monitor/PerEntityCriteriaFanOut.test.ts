jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import PerEntityCriteriaFanOut, {
  FanOutEntity,
} from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import ServerMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/ServerMonitorCriteria";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { BasicDiskMetrics } from "../../../../Types/Infrastructure/BasicMetrics";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import { describe, expect, it } from "@jest/globals";

/*
 * Server and SNMP monitors see several independent entities per check —
 * every mounted filesystem, every port on a switch — but their criteria
 * name one at a time. Two full mountpoints therefore produced ONE alert,
 * and the second one to fill up was silenced for as long as the first
 * one's alert stayed open: exactly the reported bug, on a monitor type
 * with no Group By to turn on.
 *
 * "*" is how those criteria opt in. Anything else keeps today's
 * behaviour byte for byte.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function diskFilter(input: {
  diskPath: string;
  greaterThan: number;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.DiskUsagePercent,
    filterType: FilterType.GreaterThan,
    value: String(input.greaterThan),
    serverMonitorOptions: { diskPath: input.diskPath },
  };
}

function cpuFilter(greaterThan: number): CriteriaFilter {
  return {
    checkOn: CheckOn.CPUUsagePercent,
    filterType: FilterType.GreaterThan,
    value: String(greaterThan),
  };
}

function criteriaWith(input: {
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "criteria-1",
    name: "Disk is filling up",
    description: "",
    monitorStatusId: undefined,
    filterCondition: input.filterCondition || FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function serverResponse(
  disks: Array<{ diskPath: string; percentUsed: number }>,
  cpuPercent: number = 5,
): DataToProcess {
  const diskMetrics: Array<BasicDiskMetrics> = disks.map(
    (disk: { diskPath: string; percentUsed: number }): BasicDiskMetrics => {
      return {
        total: 100,
        free: 100 - disk.percentUsed,
        used: disk.percentUsed,
        diskPath: disk.diskPath,
        percentUsed: disk.percentUsed,
        percentFree: 100 - disk.percentUsed,
      };
    },
  );

  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: MONITOR_ID,
    requestReceivedAt: new Date("2026-08-27T00:00:00.000Z"),
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: cpuPercent, cores: 4 },
      memoryMetrics: {
        total: 100,
        free: 90,
        used: 10,
        percentFree: 90,
        percentUsed: 10,
      },
      diskMetrics,
    },
  } as unknown as DataToProcess;
}

function serverMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
  monitor.monitorType = MonitorType.Server;
  monitor.name = "prod-db-01";
  return monitor;
}

type CollectPerSeriesMatches = (input: {
  dataToProcess: DataToProcess;
  monitor: Monitor;
  monitorStep: MonitorStep;
  criteriaInstance: MonitorCriteriaInstance;
}) => Promise<Array<PerSeriesCriteriaMatch>>;

const collectPerSeriesMatches: CollectPerSeriesMatches = (
  MonitorCriteriaEvaluator as unknown as {
    collectPerSeriesMatches: CollectPerSeriesMatches;
  }
).collectPerSeriesMatches.bind(MonitorCriteriaEvaluator);

async function collectForServer(input: {
  criteriaInstance: MonitorCriteriaInstance;
  dataToProcess: DataToProcess;
}): Promise<Array<PerSeriesCriteriaMatch>> {
  return collectPerSeriesMatches({
    dataToProcess: input.dataToProcess,
    monitor: serverMonitor(),
    monitorStep: new MonitorStep(),
    criteriaInstance: input.criteriaInstance,
  });
}

function labelsOf(matches: Array<PerSeriesCriteriaMatch>): Array<unknown> {
  return matches.map((match: PerSeriesCriteriaMatch) => {
    return match.labels["diskPath"];
  });
}

describe("PerEntityCriteriaFanOut — Server disks", () => {
  describe("the wildcard opts a criteria into per-disk alerting", () => {
    it("produces one match per breaching disk and skips the healthy ones", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filters: [diskFilter({ diskPath: "*", greaterThan: 90 })],
        }),
        dataToProcess: serverResponse([
          { diskPath: "/", percentUsed: 95 },
          { diskPath: "/var", percentUsed: 97 },
          { diskPath: "/home", percentUsed: 20 },
        ]),
      });

      expect(labelsOf(matches)).toEqual(["/", "/var"]);
    });

    it("gives each disk a distinct fingerprint so they dedupe independently", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filters: [diskFilter({ diskPath: "*", greaterThan: 90 })],
        }),
        dataToProcess: serverResponse([
          { diskPath: "/", percentUsed: 95 },
          { diskPath: "/var", percentUsed: 97 },
        ]),
      });

      expect(matches[0]!.fingerprint).not.toBe(matches[1]!.fingerprint);
      expect(matches[0]!.fingerprint).toBeTruthy();
    });

    it("names the disk in the root cause so the alert says which one", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filters: [diskFilter({ diskPath: "*", greaterThan: 90 })],
        }),
        dataToProcess: serverResponse([{ diskPath: "/var", percentUsed: 97 }]),
      });

      expect(matches[0]!.rootCause).toContain("/var");
    });

    it("returns nothing when no disk breaches", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filters: [diskFilter({ diskPath: "*", greaterThan: 90 })],
        }),
        dataToProcess: serverResponse([
          { diskPath: "/", percentUsed: 10 },
          { diskPath: "/var", percentUsed: 20 },
        ]),
      });

      expect(matches).toEqual([]);
    });
  });

  describe("filters that do not address a disk still apply per disk", () => {
    it("under All, a failing host-wide filter suppresses every disk", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filterCondition: FilterCondition.All,
          filters: [
            diskFilter({ diskPath: "*", greaterThan: 90 }),
            // CPU is quiet, so "disk full AND cpu busy" holds for nobody.
            cpuFilter(90),
          ],
        }),
        dataToProcess: serverResponse(
          [
            { diskPath: "/", percentUsed: 95 },
            { diskPath: "/var", percentUsed: 97 },
          ],
          5,
        ),
      });

      expect(matches).toEqual([]);
    });

    it("under All, a passing host-wide filter lets each breaching disk through", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filterCondition: FilterCondition.All,
          filters: [
            diskFilter({ diskPath: "*", greaterThan: 90 }),
            cpuFilter(50),
          ],
        }),
        dataToProcess: serverResponse(
          [
            { diskPath: "/", percentUsed: 95 },
            { diskPath: "/home", percentUsed: 20 },
          ],
          80,
        ),
      });

      expect(labelsOf(matches)).toEqual(["/"]);
    });
  });

  describe("existing configurations are untouched", () => {
    it("a criteria pinned to one disk does not fan out", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({
          filters: [diskFilter({ diskPath: "/var", greaterThan: 90 })],
        }),
        dataToProcess: serverResponse([
          { diskPath: "/", percentUsed: 95 },
          { diskPath: "/var", percentUsed: 97 },
        ]),
      });

      // No per-entity matches -> the whole-monitor path, exactly as before.
      expect(matches).toEqual([]);
    });

    it("a criteria with no disk filter at all does not fan out", async () => {
      const matches: Array<PerSeriesCriteriaMatch> = await collectForServer({
        criteriaInstance: criteriaWith({ filters: [cpuFilter(50)] }),
        dataToProcess: serverResponse([{ diskPath: "/", percentUsed: 95 }], 80),
      });

      expect(matches).toEqual([]);
    });
  });

  describe("the scalar verdict agrees with the fan-out", () => {
    /*
     * collectPerSeriesMatches only runs once the whole-criteria
     * evaluation has already said "met". If the scalar path did not
     * understand the wildcard it would resolve "*" to no disk at all,
     * score 0%, and the criteria would never fire — so the fan-out
     * would never be reached either.
     */
    it("a wildcard disk filter is met when any disk breaches", async () => {
      const rootCause: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: serverResponse([
            { diskPath: "/", percentUsed: 10 },
            { diskPath: "/var", percentUsed: 97 },
          ]),
          criteriaFilter: diskFilter({ diskPath: "*", greaterThan: 90 }),
        });

      expect(rootCause).toBeTruthy();
      expect(rootCause).toContain("/var");
    });

    it("a wildcard disk filter is not met when every disk is healthy", async () => {
      const rootCause: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: serverResponse([
            { diskPath: "/", percentUsed: 10 },
            { diskPath: "/var", percentUsed: 20 },
          ]),
          criteriaFilter: diskFilter({ diskPath: "*", greaterThan: 90 }),
        });

      expect(rootCause).toBeNull();
    });

    it("an unset disk path still means the root filesystem", async () => {
      const rootCause: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: serverResponse([
            { diskPath: "/", percentUsed: 10 },
            { diskPath: "/var", percentUsed: 97 },
          ]),
          criteriaFilter: {
            checkOn: CheckOn.DiskUsagePercent,
            filterType: FilterType.GreaterThan,
            value: "90",
          },
        });

      expect(rootCause).toBeNull();
    });
  });
});

describe("PerEntityCriteriaFanOut — configuration detection", () => {
  it("recognises the wildcard, and only the wildcard", () => {
    expect(PerEntityCriteriaFanOut.isWildcard("*")).toBe(true);
    expect(PerEntityCriteriaFanOut.isWildcard(" * ")).toBe(true);
    expect(PerEntityCriteriaFanOut.isWildcard("")).toBe(false);
    expect(PerEntityCriteriaFanOut.isWildcard(undefined)).toBe(false);
    expect(PerEntityCriteriaFanOut.isWildcard("/var")).toBe(false);
    expect(PerEntityCriteriaFanOut.isWildcard("*.log")).toBe(false);
  });

  it("an SNMP criteria with a blank interface name does not fan out", () => {
    /*
     * Blank has always meant "every interface, one combined alert".
     * Treating it as opt-in would turn a single "3 interfaces down"
     * alert into three on every existing SNMP monitor at upgrade time.
     */
    const instance: MonitorCriteriaInstance = criteriaWith({
      filters: [
        {
          checkOn: CheckOn.SnmpInterfaceIsDown,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { interfaceName: "" },
        },
      ],
    });

    expect(
      PerEntityCriteriaFanOut.isSnmpInterfaceFanOutConfigured(instance),
    ).toBe(false);
  });

  it("an SNMP criteria with the wildcard fans out over named interfaces", () => {
    const instance: MonitorCriteriaInstance = criteriaWith({
      filters: [
        {
          checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
          filterType: FilterType.GreaterThan,
          value: "80",
          snmpMonitorOptions: { interfaceName: "*" },
        },
      ],
    });

    expect(
      PerEntityCriteriaFanOut.isSnmpInterfaceFanOutConfigured(instance),
    ).toBe(true);

    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: instance,
        dataToProcess: {
          monitorId: MONITOR_ID,
          interfaces: [
            { name: "Gi0/1", alias: "Uplink" },
            { name: "Gi0/2" },
            // No name: cannot be addressed individually, so it is skipped.
            { alias: "unnamed" },
            // Duplicate name: counted once.
            { name: "Gi0/1" },
          ],
        } as unknown as DataToProcess,
      });

    expect(
      entities.map((entity: FanOutEntity) => {
        return entity.labels["interfaceName"];
      }),
    ).toEqual(["Gi0/1", "Gi0/2"]);
    expect(entities[0]!.labels["interfaceAlias"]).toBe("Uplink");
  });

  it("narrowing rewrites only the wildcard filter, leaving the others alone", () => {
    const instance: MonitorCriteriaInstance = criteriaWith({
      filters: [
        diskFilter({ diskPath: "*", greaterThan: 90 }),
        diskFilter({ diskPath: "/boot", greaterThan: 50 }),
        cpuFilter(80),
      ],
    });

    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getServerDiskEntities({
        criteriaInstance: instance,
        dataToProcess: serverResponse([{ diskPath: "/var", percentUsed: 97 }]),
      });

    const narrowed: Array<CriteriaFilter> = (
      instance.data!.filters as Array<CriteriaFilter>
    ).map((filter: CriteriaFilter) => {
      return entities[0]!.narrowFilter(filter);
    });

    expect(narrowed[0]!.serverMonitorOptions?.diskPath).toBe("/var");
    // A criteria that explicitly names another disk keeps naming it.
    expect(narrowed[1]!.serverMonitorOptions?.diskPath).toBe("/boot");
    expect(narrowed[2]!.checkOn).toBe(CheckOn.CPUUsagePercent);

    // The monitor's stored criteria is not mutated.
    expect(
      (instance.data!.filters as Array<CriteriaFilter>)[0]!.serverMonitorOptions
        ?.diskPath,
    ).toBe("*");
  });
});
