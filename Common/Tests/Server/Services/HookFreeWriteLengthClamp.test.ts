import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import LogDropFilterService from "../../../Server/Services/LogDropFilterService";
import ObjectID from "../../../Types/ObjectID";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Follow-up to issue #3006, one layer below where it was first fixed.
 *
 * The raw write paths — updateColumnsByIdWithoutHooks and
 * atomicAddToColumnsByIdWithoutHooks — deliberately skip the whole hook
 * pipeline, and with it checkMaxLengthOfFields. That made every caller
 * individually responsible for not handing Postgres an over-long string,
 * and eleven telemetry services independently forgot to be. When one
 * oversized OpenTelemetry resource attribute reached Postgres raw, the
 * ENTIRE statement was rejected — including the lastSeenAt /
 * otelCollectorStatus columns riding along with it — and markDisconnected*
 * stranded a healthy resource as "disconnected" 15 minutes later while its
 * telemetry kept arriving.
 *
 * The clamp now lives inside those two methods, so a caller cannot forget
 * it and a service added tomorrow inherits it. This suite pins that:
 *
 *   1. the clamp really runs inside the raw write path (asserted on the
 *      values BOUND to the SQL, not on what the caller passed),
 *   2. it clamps to each column's own declared width, model by model,
 *      for every string column the updateLastSeen paths can write,
 *   3. it touches nothing it should not — text columns, non-strings, and
 *      the caller's own object.
 *
 * The repository is faked, so no Postgres and no Redis; the column
 * metadata, the clamp and the SQL generation are all real.
 */

const ROW_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

/**
 * A stand-in for the TypeORM repository that is just faithful enough for
 * the raw write paths: real column names come from the model itself, and
 * values are captured rather than sent anywhere.
 */
function fakeRepository(
  model: DatabaseBaseModel,
  captured: Array<CapturedQuery>,
): unknown {
  return {
    metadata: {
      tableName: model.tableName || "FakeTable",
      findColumnWithPropertyName: (
        propertyName: string,
      ): { databaseName: string } | undefined => {
        return model.hasColumn(propertyName)
          ? { databaseName: propertyName }
          : undefined;
      },
      updateDateColumn: { databaseName: "updatedAt" },
      primaryColumns: [{ databaseName: "_id" }],
    },
    manager: {
      connection: {
        driver: {
          preparePersistentValue: (value: unknown): unknown => {
            return value;
          },
        },
      },
      query: async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<unknown>> => {
        captured.push({ sql, params });
        return [];
      },
    },
  };
}

/** The width the column declares, or undefined for an unbounded one. */
function declaredMaxLength(
  model: DatabaseBaseModel,
  column: string,
): number | undefined {
  const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);
  return metadata.type
    ? getMaxLengthFromTableColumnType(metadata.type)
    : undefined;
}

/*
 * Every string column the eleven telemetry updateLastSeen paths can write.
 * Widths are NOT hardcoded — each case reads the column's own declaration,
 * so widening a column keeps the suite honest instead of breaking it.
 */
type ClampCase = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: DatabaseService<any>;
  model: DatabaseBaseModel;
  columns: Array<string>;
};

/*
 * `PartialEntity<any>` degenerates to a type that rejects plain strings and
 * dates, so the model-agnostic cases below go through this one cast rather
 * than sprinkling casts across every call.
 */
async function rawWrite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: DatabaseService<any>,
  data: Record<string, unknown>,
): Promise<void> {
  await service.updateColumnsByIdWithoutHooks({
    id: ROW_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
  });
}

const CLAMP_CASES: Array<ClampCase> = [
  {
    name: "HostService",
    service: HostService,
    model: new Host(),
    columns: [
      "osType",
      "osVersion",
      "hostId",
      "hostArch",
      "hostType",
      "containerRuntime",
      "agentVersion",
      "deploymentEnvironment",
      "runtimeName",
      "runtimeVersion",
      "cloudProvider",
      "cloudPlatform",
      "cloudRegion",
      "cloudAccountId",
    ],
  },
  {
    name: "DockerHostService",
    service: DockerHostService,
    model: new DockerHost(),
    columns: ["osType", "osVersion", "agentVersion"],
  },
  {
    name: "PodmanHostService",
    service: PodmanHostService,
    model: new PodmanHost(),
    columns: ["osType", "osVersion", "agentVersion"],
  },
  {
    name: "KubernetesClusterService",
    service: KubernetesClusterService,
    model: new KubernetesCluster(),
    columns: ["agentVersion"],
  },
  {
    name: "ProxmoxClusterService",
    service: ProxmoxClusterService,
    model: new ProxmoxCluster(),
    columns: ["pveVersion", "agentVersion"],
  },
  {
    name: "IoTFleetService",
    service: IoTFleetService,
    model: new IoTFleet(),
    columns: ["agentVersion"],
  },
  {
    name: "DockerSwarmClusterService",
    service: DockerSwarmClusterService,
    model: new DockerSwarmCluster(),
    columns: ["dockerVersion", "swarmId", "agentVersion"],
  },
  {
    name: "CephClusterService",
    service: CephClusterService,
    model: new CephCluster(),
    columns: ["cephVersion", "fsid", "agentVersion"],
  },
  {
    name: "ServerlessFunctionService",
    service: ServerlessFunctionService,
    model: new ServerlessFunction(),
    columns: [
      "agentVersion",
      "cloudPlatform",
      "cloudProvider",
      "cloudRegion",
      "cloudAccountId",
      "functionVersion",
      "runtimeName",
      "runtimeVersion",
    ],
  },
  {
    name: "CloudResourceService",
    service: CloudResourceService,
    model: new CloudResource(),
    columns: [
      "agentVersion",
      "cloudPlatform",
      "cloudProvider",
      "cloudRegion",
      "cloudAccountId",
      "runtimeName",
      "runtimeVersion",
    ],
  },
  {
    name: "RumApplicationService",
    service: RumApplicationService,
    model: new RumApplication(),
    columns: ["agentVersion", "clientType", "sdkLanguage"],
  },
];

describe("updateColumnsByIdWithoutHooks clamps oversized strings", () => {
  let captured: Array<CapturedQuery>;

  beforeEach(() => {
    captured = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The value bound for `column` in the single captured statement. */
  function boundValue(column: string, columns: Array<string>): unknown {
    /*
     * Values are bound in Object.entries order, which for these writes is
     * insertion order — the same order the caller built the payload in.
     */
    return captured[0]!.params[columns.indexOf(column)];
  }

  describe.each(CLAMP_CASES)(
    "$name",
    ({ service, model, columns }: ClampCase) => {
      beforeEach(() => {
        getJestSpyOn(service, "getRepository").mockReturnValue(
          fakeRepository(model, captured),
        );
      });

      test.each(columns)(
        "clamps an oversized %s to the width its column declares",
        async (column: string) => {
          const maxLength: number | undefined = declaredMaxLength(
            model,
            column,
          );

          /*
           * A column with no declared width (text) cannot overflow, so
           * there is nothing to clamp — that case is covered separately.
           */
          expect(maxLength).toBeDefined();

          await rawWrite(service, {
            [column]: "x".repeat(maxLength! + 250),
          });

          expect(boundValue(column, [column])).toHaveLength(maxLength!);
        },
      );

      test("clamping one bad column never costs the liveness columns", async () => {
        const column: string = columns[0]!;
        const lastSeenAt: Date = new Date();

        await rawWrite(service, {
          lastSeenAt: lastSeenAt,
          otelCollectorStatus: "connected",
          [column]: "x".repeat(5000),
        });

        const order: Array<string> = [
          "lastSeenAt",
          "otelCollectorStatus",
          column,
        ];
        expect(boundValue("lastSeenAt", order)).toBe(lastSeenAt);
        expect(boundValue("otelCollectorStatus", order)).toBe("connected");
        expect(captured).toHaveLength(1);
      });

      test("a value that already fits is bound byte-for-byte", async () => {
        const column: string = columns[0]!;

        await rawWrite(service, { [column]: "fits-easily" });

        expect(boundValue(column, [column])).toBe("fits-easily");
      });

      test("the caller's own object is not mutated", async () => {
        const column: string = columns[0]!;
        const original: string = "x".repeat(5000);
        const data: Record<string, unknown> = { [column]: original };

        await rawWrite(service, data);

        expect(data[column]).toBe(original);
      });
    },
  );
});

describe("updateColumnsByIdWithoutHooks clamp boundaries", () => {
  let captured: Array<CapturedQuery>;
  const host: Host = new Host();

  beforeEach(() => {
    captured = [];
    getJestSpyOn(HostService, "getRepository").mockReturnValue(
      fakeRepository(host, captured),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("binds a 55-address host.ip list whole — the column is text now", async () => {
    const hostIpAddresses: string = Array.from(
      { length: 55 },
      (_unused: unknown, i: number) => {
        return `fe80::42:acff:fe11:${(0x1000 + i).toString(16)}`;
      },
    ).join(", ");

    await HostService.updateColumnsByIdWithoutHooks({
      id: ROW_ID,
      data: { hostIpAddresses: hostIpAddresses },
    });

    expect(hostIpAddresses.length).toBeGreaterThan(500);
    expect(captured[0]!.params[0]).toBe(hostIpAddresses);
  });

  test("a value exactly at the limit is left alone", async () => {
    const exact: string = "l".repeat(declaredMaxLength(host, "osType")!);

    await HostService.updateColumnsByIdWithoutHooks({
      id: ROW_ID,
      data: { osType: exact },
    });

    expect(captured[0]!.params[0]).toBe(exact);
  });

  test("a clamped value stays a prefix of the original", async () => {
    const original: string = "abcdefghij".repeat(40);

    await HostService.updateColumnsByIdWithoutHooks({
      id: ROW_ID,
      data: { osType: original },
    });

    expect(original.startsWith(captured[0]!.params[0] as string)).toBe(true);
  });

  test("non-string values pass through untouched", async () => {
    const lastSeenAt: Date = new Date();

    await HostService.updateColumnsByIdWithoutHooks({
      id: ROW_ID,
      data: {
        lastSeenAt: lastSeenAt,
        cpuCores: 64,
        totalMemoryBytes: 274877906944,
      },
    });

    expect(captured[0]!.params.slice(0, 3)).toEqual([
      lastSeenAt,
      64,
      274877906944,
    ]);
  });

  test("an unknown column is still rejected, not silently clamped away", async () => {
    await expect(
      HostService.updateColumnsByIdWithoutHooks({
        id: ROW_ID,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { notAColumn: "z".repeat(5000) } as any,
      }),
    ).rejects.toThrow("unknown column");
  });

  test("the clamp does not disturb the primary-key predicate", async () => {
    await HostService.updateColumnsByIdWithoutHooks({
      id: ROW_ID,
      data: { osType: "l".repeat(5000) },
    });

    expect(captured[0]!.sql).toMatch(/WHERE "_id" = \$\d+$/);
    expect(captured[0]!.params[captured[0]!.params.length - 1]).toBe(
      ROW_ID.toString(),
    );
  });
});

/*
 * The counter-flush primitive is the other raw path, and it has exactly the
 * same exposure: an over-long string in `set` would abort the increments
 * bound into the same statement.
 */
describe("atomicAddToColumnsByIdWithoutHooks clamps its set values", () => {
  let captured: Array<CapturedQuery>;
  const model: LogDropFilter = new LogDropFilter();

  beforeEach(() => {
    captured = [];
    getJestSpyOn(LogDropFilterService, "getRepository").mockReturnValue(
      fakeRepository(model, captured),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("clamps an oversized set value to its declared width", async () => {
    const maxLength: number = declaredMaxLength(model, "name")!;

    await LogDropFilterService.atomicAddToColumnsByIdWithoutHooks({
      id: ROW_ID,
      add: { droppedCount: 5 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: { name: "n".repeat(maxLength + 250) } as any,
    });

    // params: [delta, set value, ...]
    expect(captured[0]!.params[1]).toHaveLength(maxLength);
  });

  test("leaves the numeric delta alone", async () => {
    await LogDropFilterService.atomicAddToColumnsByIdWithoutHooks({
      id: ROW_ID,
      add: { droppedCount: 7 },
    });

    expect(captured[0]!.params[0]).toBe(7);
    expect(captured[0]!.sql).toContain("COALESCE");
  });

  test("does not mutate the caller's set object", async () => {
    const original: string = "n".repeat(5000);
    const set: Record<string, unknown> = { name: original };

    await LogDropFilterService.atomicAddToColumnsByIdWithoutHooks({
      id: ROW_ID,
      add: { droppedCount: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: set as any,
    });

    expect(set["name"]).toBe(original);
  });
});
