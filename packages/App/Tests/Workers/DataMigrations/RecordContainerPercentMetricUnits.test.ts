import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RecordContainerPercentMetricUnits, {
  CONTAINER_PERCENT_ROW_QUERIES,
  DOCKER_STATS_CPU_UTILIZATION_DESCRIPTION,
} from "../../../FeatureSet/Workers/DataMigrations/RecordContainerPercentMetricUnits";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RecordContainerPercentMetricUnits records "%" as the catalog unit of the
 * container stats receivers' percents in every project at once: the
 * docker_stats receiver (Docker, Podman and Swarm agents) and podman_stats
 * send them as 0-100 but declare "1", which every chart read 100 times too
 * high (4.36% of a memory limit drew as 436.64%). Ingest records "%" from now
 * on; this corrects the rows already written, including those of projects
 * whose hosts no longer report.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts once, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it selects container.memory.percent and container.cpu.percent rows
 *      that say "1", and container.cpu.utilization rows only with
 *      docker_stats' own description - the Kubernetes agent's
 *      container.cpu.utilization is CPU cores, where "1" is right;
 *   3. every id is collected before the first write (a corrected row drops
 *      out of the match), across pages;
 *   4. each write is a compare-and-set of "%" over "1", counted when it
 *      happened, and one failed write costs no other row its correction;
 *   5. a failure to read stops the chain rather than being swallowed;
 *   6. a second run finds nothing to do, and rollback changes nothing.
 */

const MIGRATION_NAME: string = "RecordContainerPercentMetricUnits";

const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

type FindByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
};

type CompareAndSetArgs = {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
};

function rowWithId(id: ObjectID): MetricType {
  const row: MetricType = new MetricType();
  row.id = id;
  return row;
}

describe("RecordContainerPercentMetricUnits", () => {
  let findCalls: Array<FindByArgs>;
  let writes: Array<CompareAndSetArgs>;
  let events: Array<string>;
  let infoLogs: Array<string>;
  let errorLogs: Array<string>;
  // Rows by name, as findBy pages them.
  let rowsByName: Map<string, Array<ObjectID>>;
  let failingIds: Set<string>;
  let lostRaceIds: Set<string>;

  beforeEach(() => {
    findCalls = [];
    writes = [];
    events = [];
    infoLogs = [];
    errorLogs = [];
    rowsByName = new Map<string, Array<ObjectID>>();
    failingIds = new Set<string>();
    lostRaceIds = new Set<string>();

    jest
      .spyOn(MetricTypeService, "findBy")
      .mockImplementation(async (input: unknown) => {
        const args: FindByArgs = input as FindByArgs;
        findCalls.push(args);
        events.push(`find ${String(args.query["name"])} ${args.skip}`);
        const ids: Array<ObjectID> =
          rowsByName.get(String(args.query["name"])) || [];
        return ids
          .slice(args.skip, args.skip + args.limit)
          .map((id: ObjectID): MetricType => {
            return rowWithId(id);
          });
      });

    jest
      .spyOn(MetricTypeService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation(async (input: unknown) => {
        const args: CompareAndSetArgs = input as CompareAndSetArgs;
        events.push(`write ${args.id.toString()}`);
        if (failingIds.has(args.id.toString())) {
          throw new Error("row locked");
        }
        writes.push(args);
        return !lostRaceIds.has(args.id.toString());
      });

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(new RecordContainerPercentMetricUnits().name).toBe(MIGRATION_NAME);
  });

  test("selects the container percents that say '1' - container.cpu.utilization only as docker_stats describes it", async () => {
    await new RecordContainerPercentMetricUnits().migrate();

    expect(
      findCalls.map((call: FindByArgs) => {
        return call.query;
      }),
    ).toEqual([
      { name: "container.memory.percent", unit: "1" },
      { name: "container.cpu.percent", unit: "1" },
      {
        name: "container.cpu.utilization",
        unit: "1",
        description: "Percent of CPU used by the container.",
      },
    ]);
    for (const call of findCalls) {
      expect(call.props).toEqual({ isRoot: true });
      expect(call.select).toEqual({ _id: true });
      expect(call.sort).toEqual({ _id: SortOrder.Ascending });
    }
    expect(DOCKER_STATS_CPU_UTILIZATION_DESCRIPTION).toBe(
      "Percent of CPU used by the container.",
    );
    expect(
      CONTAINER_PERCENT_ROW_QUERIES.map((query: { name: string }) => {
        return query.name;
      }),
    ).not.toContain("k8s.pod.cpu.utilization");
  });

  test("writes '%' over '1' as a compare-and-set, for every row found, and says how many it recorded", async () => {
    const memory: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
    const cpu: Array<ObjectID> = [ObjectID.generate()];
    rowsByName.set("container.memory.percent", memory);
    rowsByName.set("container.cpu.utilization", cpu);

    await new RecordContainerPercentMetricUnits().migrate();

    expect(
      writes.map((write: CompareAndSetArgs) => {
        return write.id.toString();
      }),
    ).toEqual(
      [...memory, ...cpu].map((id: ObjectID) => {
        return id.toString();
      }),
    );
    for (const write of writes) {
      expect(write.data).toEqual({ unit: "%" });
      expect(write.expectedData).toEqual({ unit: "1" });
    }
    expect(infoLogs.join("\n")).toContain(
      'recorded "%" as the unit of 3 container percent metric type(s)',
    );
  });

  test("a row a batch changed meanwhile keeps that write, and is not counted", async () => {
    const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
    rowsByName.set("container.memory.percent", ids);
    lostRaceIds.add(ids[0]!.toString());

    await new RecordContainerPercentMetricUnits().migrate();

    expect(infoLogs.join("\n")).toContain(
      "unit of 1 container percent metric type(s)",
    );
  });

  test("collects every id across pages before the first write", async () => {
    const ids: Array<ObjectID> = [];
    for (let index: number = 0; index < LIMIT_MAX + 3; index++) {
      ids.push(ObjectID.generate());
    }
    rowsByName.set("container.memory.percent", ids);

    await new RecordContainerPercentMetricUnits().migrate();

    const memoryEvents: Array<string> = events.filter((event: string) => {
      return (
        event.startsWith("find container.memory.percent") ||
        event.startsWith("write")
      );
    });
    expect(memoryEvents[0]).toBe("find container.memory.percent 0");
    expect(memoryEvents[1]).toBe(`find container.memory.percent ${LIMIT_MAX}`);
    expect(memoryEvents[2]!.startsWith("write")).toBe(true);
    expect(writes).toHaveLength(LIMIT_MAX + 3);
  });

  test("one row that cannot be written costs no other row its correction", async () => {
    const ids: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];
    rowsByName.set("container.memory.percent", ids);
    failingIds.add(ids[1]!.toString());

    await new RecordContainerPercentMetricUnits().migrate();

    expect(
      writes.map((write: CompareAndSetArgs) => {
        return write.id.toString();
      }),
    ).toEqual([ids[0]!.toString(), ids[2]!.toString()]);
    expect(errorLogs.join("\n")).toContain(ids[1]!.toString());
  });

  test("a failure to read stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(MetricTypeService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new RecordContainerPercentMetricUnits().migrate(),
    ).rejects.toThrow("db down");
  });

  test("a second run finds nothing and writes nothing; rollback changes nothing", async () => {
    await new RecordContainerPercentMetricUnits().migrate();
    await new RecordContainerPercentMetricUnits().rollback();

    expect(writes).toHaveLength(0);
    expect(infoLogs).toHaveLength(0);
  });
});
