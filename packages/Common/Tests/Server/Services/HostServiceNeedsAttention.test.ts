/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import HostService, {
  HOST_HEALTH_SELECT,
  HOST_NEEDS_ATTENTION_LIMIT_PER_CONDITION,
  HostNeedsAttentionCondition,
  HostsThatMayNeedAttention,
  getHostNeedsAttentionConditions,
} from "../../../Server/Services/HostService";
import Host from "../../../Models/DatabaseModels/Host";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_INODES_NEAR_FULL_PERCENT,
  HOST_LOAD_PER_CORE_HIGH,
  HOST_MEMORY_HIGH_PERCENT,
  HOST_SWAP_HIGH_PERCENT,
  HostHealthRow,
} from "../../../Types/Host/HostHealth";
import { HostCollectorConfigStatus } from "../../../Types/HostCollector/HostCollector";
import { afterEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * HostService.findHostsThatMayNeedAttention: the hosts the Hosts list's Needs
 * attention card reads. One read per line HostHealth draws, each as the
 * caller and never archived hosts, the worst of each first, a host found by
 * two of them once - and the card is told when a read was cut short. The
 * reads' SQL runs on Postgres in HostNeedsAttentionPostgres; here findBy is
 * replaced so what each read asks for can be read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
};

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

type FindByArgument = Parameters<typeof HostService.findBy>[0];

function host(id: string, name: string): Host {
  const row: Host = new Host();
  row._id = id;
  row.name = name;
  return row;
}

function hostId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function conditionNamed(name: string): HostNeedsAttentionCondition {
  const condition: HostNeedsAttentionCondition | undefined =
    getHostNeedsAttentionConditions().find(
      (each: HostNeedsAttentionCondition): boolean => {
        return each.name === name;
      },
    );
  expect(condition).toBeDefined();
  return condition!;
}

function rawOf(value: unknown): RawOperator {
  expect(value).toBeInstanceOf(FindOperator);
  return value as RawOperator;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the conditions a host may need attention under", () => {
  test("are one per line HostHealth draws, in its order", () => {
    expect(
      getHostNeedsAttentionConditions().map(
        (condition: HostNeedsAttentionCondition): string => {
          return condition.name;
        },
      ),
    ).toEqual([
      "not-reporting",
      "no-data",
      "disk",
      "inodes",
      "memory",
      "swap",
      "load",
      "failed-units",
      "collector-config-failed",
      "collector-error",
    ]);
  });

  test("a host that stopped reporting, or never reported", () => {
    expect(conditionNamed("not-reporting").query).toEqual({
      otelCollectorStatus: "disconnected",
    });
    const noData: RawOperator = rawOf(
      (conditionNamed("no-data").query as Record<string, unknown>)[
        "lastSeenAt"
      ],
    );
    expect(noData.getSql("Host.lastSeenAt")).toContain("IS NULL");
  });

  test("each reading past the line HostHealth warns at", () => {
    const lines: Array<[string, string, number]> = [
      ["disk", "latestDiskPercent", HOST_DISK_NEAR_FULL_PERCENT],
      ["inodes", "latestInodesPercent", HOST_INODES_NEAR_FULL_PERCENT],
      ["memory", "latestMemoryPercent", HOST_MEMORY_HIGH_PERCENT],
      ["swap", "latestSwapPercent", HOST_SWAP_HIGH_PERCENT],
    ];
    for (const [name, column, line] of lines) {
      const operator: RawOperator = rawOf(
        (conditionNamed(name).query as Record<string, unknown>)[column],
      );
      const params: Array<unknown> = Object.values(
        operator.objectLiteralParameters,
      );
      expect(params).toEqual([line]);
      expect(operator.getSql(`Host.${column}`)).toContain(">");
      expect(conditionNamed(name).sort).toEqual({
        [column]: SortOrder.Descending,
      });
    }
  });

  test("a load above twice the cores, measured against the row's own cores", () => {
    const operator: RawOperator = rawOf(
      (conditionNamed("load").query as Record<string, unknown>)[
        "latestLoadAverage15m"
      ],
    );
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      HOST_LOAD_PER_CORE_HIGH,
    ]);
    expect(operator.getSql("Host.latestLoadAverage15m")).toContain(
      '"Host"."cpuCores"',
    );
  });

  test("failed systemd units and the collector's two troubles", () => {
    const units: RawOperator = rawOf(
      (conditionNamed("failed-units").query as Record<string, unknown>)[
        "failedSystemdUnitCount"
      ],
    );
    expect(Object.values(units.objectLiteralParameters)).toEqual([0]);
    expect(conditionNamed("collector-config-failed").query).toEqual({
      collectorConfigStatus: HostCollectorConfigStatus.Failed,
    });
    expect(conditionNamed("collector-error").query).toEqual({
      isCollectorHealthy: false,
    });
  });
});

describe("HostService.findHostsThatMayNeedAttention", () => {
  test("reads each condition as the caller, in the project, never archived hosts", async () => {
    const calls: Array<FindByArgument> = [];
    jest
      .spyOn(HostService, "findBy")
      .mockImplementation(async (argument: FindByArgument) => {
        calls.push(argument);
        return [];
      });

    await HostService.findHostsThatMayNeedAttention({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(calls).toHaveLength(getHostNeedsAttentionConditions().length);
    for (const call of calls) {
      const query: Record<string, unknown> = call.query as Record<
        string,
        unknown
      >;
      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
      // As the caller: their permissions and label access apply.
      expect(call.props).toBe(CALLER);
      expect(call.select).toBe(HOST_HEALTH_SELECT);
      expect(call.limit).toBe(HOST_NEEDS_ATTENTION_LIMIT_PER_CONDITION);
      expect(call.skip).toBe(0);
    }
  });

  test("the read selects every column HostHealth reads", () => {
    const row: Required<HostHealthRow> = {
      otelCollectorStatus: null,
      lastSeenAt: null,
      createdAt: null,
      cpuCores: null,
      latestCpuPercent: null,
      latestMemoryPercent: null,
      latestSwapPercent: null,
      latestDiskPercent: null,
      latestDiskMountpoint: null,
      latestInodesPercent: null,
      latestInodesMountpoint: null,
      latestLoadAverage15m: null,
      failedSystemdUnitCount: null,
      failedSystemdUnits: null,
      readingsUpdatedAt: null,
      collectorInstanceUid: null,
      collectorRegisteredAt: null,
      collectorConfigStatus: null,
      isCollectorHealthy: null,
    };
    for (const column of Object.keys(row)) {
      expect((HOST_HEALTH_SELECT as Record<string, unknown>)[column]).toBe(
        true,
      );
    }
    // And what the card shows of each host.
    for (const column of ["_id", "name", "hostIdentifier", "osType"]) {
      expect((HOST_HEALTH_SELECT as Record<string, unknown>)[column]).toBe(
        true,
      );
    }
  });

  test("a host found by two conditions is returned once", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockImplementation(async (argument: FindByArgument) => {
        const query: Record<string, unknown> = argument.query as Record<
          string,
          unknown
        >;
        if (query["latestDiskPercent"] || query["latestMemoryPercent"]) {
          return [host(hostId(1), "db-01")];
        }
        if (query["otelCollectorStatus"] === "disconnected") {
          return [host(hostId(2), "web-03")];
        }
        return [];
      });

    const found: HostsThatMayNeedAttention =
      await HostService.findHostsThatMayNeedAttention({
        projectId: PROJECT_ID,
        props: CALLER,
      });

    expect(
      found.hosts
        .map((each: Host): string => {
          return each.name || "";
        })
        .sort(),
    ).toEqual(["db-01", "web-03"]);
    expect(found.isTruncated).toBe(false);
  });

  test("says the list is cut short when a condition matched as many hosts as it reads", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockImplementation(async (argument: FindByArgument) => {
        const query: Record<string, unknown> = argument.query as Record<
          string,
          unknown
        >;
        if (query["otelCollectorStatus"] === "disconnected") {
          const rows: Array<Host> = [];
          for (
            let index: number = 0;
            index < HOST_NEEDS_ATTENTION_LIMIT_PER_CONDITION;
            index++
          ) {
            rows.push(host(hostId(index), `host-${index}`));
          }
          return rows;
        }
        return [];
      });

    const found: HostsThatMayNeedAttention =
      await HostService.findHostsThatMayNeedAttention({
        projectId: PROJECT_ID,
        props: CALLER,
      });

    expect(found.isTruncated).toBe(true);
    expect(found.hosts).toHaveLength(HOST_NEEDS_ATTENTION_LIMIT_PER_CONDITION);
  });

  test("a read the caller may not make fails the whole answer, never a partial all-clear", async () => {
    jest
      .spyOn(HostService, "findBy")
      .mockRejectedValue(new Error("You do not have permission to read Host"));

    await expect(
      HostService.findHostsThatMayNeedAttention({
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ).rejects.toThrow("You do not have permission to read Host");
  });
});
