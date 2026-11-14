import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import IoTDeviceService from "../../../../Server/Services/IoTDeviceService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import {
  ErasedInventorySource,
  INVENTORY_SOURCES,
  INVENTORY_SYNC_PAGE_SIZE,
  InventoryRowProjection,
  InventorySourcePage,
  InventorySyncPassResult,
  InventorySyncResult,
  syncAllInventorySources,
  syncInventorySource,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE INVENTORY MIRROR'S PAGES, AND ITS LOCK.
 *
 * The mirror (InventoryEntityRegistry) copies every network device, cloud
 * resource and the rest into the Inventory every fifteen minutes. It paged
 * each table, and the registry rows behind it, by OFFSET in creation order:
 * every page scanned and sorted the whole table to throw away the pages
 * before it, so a pass over 100,000 devices sorted ten million rows, and a
 * row created during the pass moved every later page by one, so a row on a
 * page boundary was mirrored twice or not at all. And a pass that outlived
 * its time limit went on beside the next one.
 *
 * Now each page is a range of the primary key after the last row read, and
 * the pass checks its deadline - its time limit, or its run losing
 * RunCron's lock on the job (CronLock) - before every page, and stops
 * there; the next pass reads past what it wrote. These tests pin both with
 * the services stubbed; the mirror's opt-in Postgres suite runs the pages
 * against a real table.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

type FindByCall = {
  query: JSONObject;
  sort?: JSONObject;
  skip?: number;
  limit?: number;
};

// The cursor a keyset page was read after, from its `_id > :cursor` condition.
function cursorOf(query: JSONObject): string | undefined {
  const condition: unknown = query["_id"];

  if (condition === undefined) {
    return undefined;
  }

  expect(condition).toBeInstanceOf(FindOperator);
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  expect(operator.getSql?.("alias")).toMatch(/^\(alias > :\w+\)$/);

  return Object.values(operator.objectLiteralParameters || {})[0] as string;
}

// Ids in the order a keyset page reads them: the primary key's.
function sortedIds(count: number): Array<ObjectID> {
  return Array.from({ length: count }, () => {
    return ObjectID.generate();
  }).sort((a: ObjectID, b: ObjectID): number => {
    return a.toString().localeCompare(b.toString());
  });
}

function projection(id: ObjectID): InventoryRowProjection {
  return {
    id,
    projectId: PROJECT_ID,
    displayName: `row-${id.toString().slice(0, 8)}`,
    descriptiveAttributes: {},
  };
}

/*
 * An inventory table as a fake source: fetchPage reads the rows after its
 * cursor, as a keyset page of the real table does, from a list a test may
 * change between pages.
 */
function fakeSource(rows: Array<ObjectID>): {
  source: ErasedInventorySource;
  pages: Array<{ afterId: string | undefined; limit: number }>;
  rows: Array<ObjectID>;
} {
  const pages: Array<{ afterId: string | undefined; limit: number }> = [];

  const source: ErasedInventorySource = {
    entityType: EntityType.NetworkDevice,
    resourceType: "NetworkDevice",
    fetchPage: async (data: {
      afterId?: ObjectID | undefined;
      limit: number;
    }): Promise<InventorySourcePage> => {
      pages.push({ afterId: data.afterId?.toString(), limit: data.limit });

      const page: Array<ObjectID> = rows
        .filter((id: ObjectID): boolean => {
          return !data.afterId || id.toString() > data.afterId.toString();
        })
        .sort((a: ObjectID, b: ObjectID): number => {
          return a.toString().localeCompare(b.toString());
        })
        .slice(0, data.limit);

      return {
        rows: page.map(projection),
        lastId: page[page.length - 1],
        readCount: page.length,
      };
    },
    fetchOne: async (): Promise<InventoryRowProjection | null> => {
      return null;
    },
    findLiveIds: async (ids: Array<ObjectID>): Promise<Set<string>> => {
      const live: Set<string> = new Set<string>(
        rows.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
      return new Set<string>(
        ids
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return live.has(id);
          }),
      );
    },
  };

  return { source, pages, rows };
}

function registryRow(id: ObjectID, resourceId: ObjectID): InventoryItem {
  const row: InventoryItem = new InventoryItem(id);
  row.resourceId = resourceId;
  row.isArchived = false;
  return row;
}

describe("the inventory mirror", () => {
  // Every InventoryItemService.findBy, and what each kind of read returned.
  let registryReads: Array<FindByCall>;
  let registryPages: Array<Array<InventoryItem>>;
  let created: Array<string>;
  let events: Array<string>;

  beforeEach(() => {
    registryReads = [];
    registryPages = [];
    created = [];
    events = [];

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }

    jest.spyOn(InventoryItemService, "findBy").mockImplementation((async (
      call: FindByCall,
    ) => {
      registryReads.push(call);

      // The forward pass's lookup of a page's registry rows: none yet.
      if (call.query["entityKey"] !== undefined) {
        return [];
      }

      events.push("read-registry-page");
      return registryPages.shift() || [];
    }) as never);

    jest
      .spyOn(InventoryItemService, "create")
      .mockImplementation((async (data: { data: InventoryItem }) => {
        created.push(data.data.resourceId!.toString());
        return data.data;
      }) as never);

    jest
      .spyOn(InventoryItemService, "hardDeleteBy")
      .mockImplementation((async () => {
        events.push("delete-orphans");
        return 0;
      }) as never);

    jest
      .spyOn(InventoryItemService, "updateBy")
      .mockImplementation((async () => {
        events.push("archive-orphans");
        return 0;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a source's pages", () => {
    const cloudSource: () => ErasedInventorySource =
      (): ErasedInventorySource => {
        return INVENTORY_SOURCES.find(
          (candidate: ErasedInventorySource): boolean => {
            return candidate.resourceType === "CloudResource";
          },
        )!;
      };

    function cloudRow(id: ObjectID, projectId?: ObjectID): CloudResource {
      const row: CloudResource = new CloudResource(id);
      if (projectId) {
        row.projectId = projectId;
      }
      row.name = `resource-${id.toString().slice(0, 4)}`;
      return row;
    }

    test("the first is read from the first row, in primary-key order, never by OFFSET", async () => {
      const calls: Array<FindByCall> = [];
      jest.spyOn(CloudResourceService, "findBy").mockImplementation((async (
        call: FindByCall,
      ) => {
        calls.push(call);
        return [];
      }) as never);

      await cloudSource().fetchPage({ limit: 1000 });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.query).toEqual({ isArchived: false });
      expect(calls[0]!.sort).toEqual({ _id: SortOrder.Ascending });
      expect(calls[0]!.skip).toBe(0);
      expect(calls[0]!.limit).toBe(1000);
    });

    test("a later one is read after the last row of the one before, keeping the source's own filter", async () => {
      const afterId: ObjectID = ObjectID.generate();
      const calls: Array<FindByCall> = [];
      jest.spyOn(CloudResourceService, "findBy").mockImplementation((async (
        call: FindByCall,
      ) => {
        calls.push(call);
        return [];
      }) as never);

      await cloudSource().fetchPage({ afterId, limit: 1000 });

      expect(calls[0]!.query["isArchived"]).toBe(false);
      expect(cursorOf(calls[0]!.query)).toBe(afterId.toString());
      expect(calls[0]!.sort).toEqual({ _id: SortOrder.Ascending });
      expect(calls[0]!.skip).toBe(0);
    });

    test("says where the next page starts, counting a row it reads and does not mirror", async () => {
      const [first, second] = sortedIds(2) as [ObjectID, ObjectID];
      jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([
        cloudRow(first, PROJECT_ID),
        // No project: read, never mirrored.
        cloudRow(second),
      ] as never);

      const page: InventorySourcePage = await cloudSource().fetchPage({
        limit: 2,
      });

      expect(
        page.rows.map((row: InventoryRowProjection): string => {
          return row.id.toString();
        }),
      ).toEqual([first.toString()]);
      expect(page.readCount).toBe(2);
      expect(page.lastId?.toString()).toBe(second.toString());
    });

    test("an empty page has no next page", async () => {
      jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([] as never);

      expect(await cloudSource().fetchPage({ limit: 1000 })).toEqual({
        rows: [],
        lastId: undefined,
        readCount: 0,
      });
    });
  });

  describe("the forward pass", () => {
    test("reads a table of 2,500 rows in three pages, each after the last row of the one before", async () => {
      const ids: Array<ObjectID> = sortedIds(2500);
      const table: ReturnType<typeof fakeSource> = fakeSource(ids);

      const result: InventorySyncResult = await syncInventorySource(
        table.source,
      );

      expect(table.pages).toEqual([
        { afterId: undefined, limit: INVENTORY_SYNC_PAGE_SIZE },
        { afterId: ids[999]!.toString(), limit: INVENTORY_SYNC_PAGE_SIZE },
        { afterId: ids[1999]!.toString(), limit: INVENTORY_SYNC_PAGE_SIZE },
      ]);
      expect(result.created).toBe(2500);
      expect(new Set(created).size).toBe(2500);
    });

    test("a table of exactly one page reads a second, empty page to know it ended", async () => {
      const ids: Array<ObjectID> = sortedIds(INVENTORY_SYNC_PAGE_SIZE);
      const table: ReturnType<typeof fakeSource> = fakeSource(ids);

      await syncInventorySource(table.source);

      expect(table.pages).toHaveLength(2);
      expect(table.pages[1]!.afterId).toBe(ids[999]!.toString());
    });

    /*
     * The OFFSET bug: a row created during the pass, sorted ahead of the
     * page being read, moved every later row back by one - and the row on
     * the boundary was mirrored twice. A keyset page starts after the last
     * row read, wherever new rows land.
     */
    test("rows created during the pass mirror nothing twice: one ahead of the cursor is mirrored once, one behind it waits for the next pass", async () => {
      const ids: Array<ObjectID> = sortedIds(2000);
      const table: ReturnType<typeof fakeSource> = fakeSource(ids);
      const behind: ObjectID = new ObjectID(
        "00000000-0000-4000-8000-000000000000",
      );
      const ahead: ObjectID = new ObjectID(
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
      );

      const fetchPage: ErasedInventorySource["fetchPage"] =
        table.source.fetchPage;
      table.source.fetchPage = async (data: {
        afterId?: ObjectID | undefined;
        limit: number;
      }): Promise<InventorySourcePage> => {
        const page: InventorySourcePage = await fetchPage(data);
        if (!data.afterId) {
          table.rows.push(behind, ahead);
        }
        return page;
      };

      await syncInventorySource(table.source);

      expect(created).toHaveLength(2001);
      expect(new Set(created).size).toBe(2001);
      expect(created).toContain(ahead.toString());
      expect(created).not.toContain(behind.toString());
    });
  });

  describe("the reverse pass", () => {
    test("reads the registry rows in keyset pages, and writes each page's orphans before the next page", async () => {
      const resourceIds: Array<ObjectID> = sortedIds(1500);
      const rowIds: Array<ObjectID> = sortedIds(1500);
      registryPages = [
        rowIds.slice(0, 1000).map((id: ObjectID, index: number) => {
          return registryRow(id, resourceIds[index]!);
        }),
        rowIds.slice(1000).map((id: ObjectID, index: number) => {
          return registryRow(id, resourceIds[1000 + index]!);
        }),
      ];

      // Every owning row is gone: a project deleted by cascade.
      const result: InventorySyncResult = await syncInventorySource(
        fakeSource([]).source,
      );

      expect(result.deleted).toBe(1500);
      expect(events).toEqual([
        "read-registry-page",
        "delete-orphans",
        "read-registry-page",
        "delete-orphans",
      ]);

      const pages: Array<FindByCall> = registryReads.filter(
        (call: FindByCall): boolean => {
          return call.query["entityKey"] === undefined;
        },
      );
      expect(pages).toHaveLength(2);
      expect(pages[0]!.query).toEqual({
        entityType: EntityType.NetworkDevice,
        source: EntitySource.Inventory,
      });
      expect(cursorOf(pages[1]!.query)).toBe(rowIds[999]!.toString());
      for (const page of pages) {
        expect(page.sort).toEqual({ _id: SortOrder.Ascending });
        expect(page.skip).toBe(0);
        expect(page.limit).toBe(INVENTORY_SYNC_PAGE_SIZE);
      }
    });

    test("archives an orphan someone typed values into, page by page too", async () => {
      const kept: InventoryItem = registryRow(
        ObjectID.generate(),
        ObjectID.generate(),
      );
      kept.customFields = { "Serial Number": "FOC1840X0AB" };
      registryPages = [[kept]];

      const result: InventorySyncResult = await syncInventorySource(
        fakeSource([]).source,
      );

      expect(result).toEqual({
        created: 0,
        updated: 0,
        deleted: 0,
        archived: 1,
      });
      expect(events).toEqual(["read-registry-page", "archive-orphans"]);
    });
  });

  describe("the pass's deadline", () => {
    // Every source's own table, read through its service.
    const SOURCE_SERVICES: Array<DatabaseService<never>> = [
      NetworkDeviceService,
      CloudResourceService,
      ServerlessFunctionService,
      RumApplicationService,
      IoTDeviceService,
      DockerHostService,
      PodmanHostService,
    ] as unknown as Array<DatabaseService<never>>;

    let sourceReads: number;

    // A deadline that passes once the pass has read `pages` pages.
    function passingAfter(pages: number): JobDeadline {
      const deadline: JobDeadline = new JobDeadline();
      const end: () => void = (): void => {
        if (
          sourceReads + registryPagesRead() >= pages &&
          !deadline.hasPassed()
        ) {
          deadline.end(new Error("The time limit ran out."));
        }
      };
      ending = end;
      return deadline;
    }

    let ending: () => void = (): void => {};

    function registryPagesRead(): number {
      return registryReads.filter((call: FindByCall): boolean => {
        return call.query["entityKey"] === undefined;
      }).length;
    }

    beforeEach(() => {
      sourceReads = 0;
      ending = (): void => {};

      expect(SOURCE_SERVICES).toHaveLength(INVENTORY_SOURCES.length);

      // Every table empty: each read is counted, and finds nothing.
      const readEmptyTable: () => Promise<Array<never>> = async (): Promise<
        Array<never>
      > => {
        sourceReads++;
        ending();
        return [];
      };

      for (const service of SOURCE_SERVICES) {
        jest
          .spyOn(service, "findBy")
          .mockImplementation(readEmptyTable as never);
      }

      const readRegistry: (call: FindByCall) => Promise<Array<never>> = async (
        call: FindByCall,
      ): Promise<Array<never>> => {
        registryReads.push(call);
        ending();
        return [];
      };

      jest
        .spyOn(InventoryItemService, "findBy")
        .mockImplementation(readRegistry as never);
    });

    test("a pass with time left reads every table and its registry rows, and says it finished", async () => {
      const result: InventorySyncPassResult = await syncAllInventorySources(
        new JobDeadline(),
      );

      // Every table empty: one page of it, one page of its registry rows.
      expect(sourceReads).toBe(INVENTORY_SOURCES.length);
      expect(registryPagesRead()).toBe(INVENTORY_SOURCES.length);
      expect(result).toEqual({
        created: 0,
        updated: 0,
        deleted: 0,
        archived: 0,
        stoppedAtDeadline: false,
      });
    });

    test("a pass run without a deadline (as a test or a script runs it) never stops on one", async () => {
      expect((await syncAllInventorySources()).stoppedAtDeadline).toBe(false);
      expect(sourceReads).toBe(INVENTORY_SOURCES.length);
    });

    test.each([1, 2, 3, 5, 8])(
      "a pass whose deadline passes after %d pages reads no further page, and says it stopped",
      async (pages: number) => {
        const result: InventorySyncPassResult = await syncAllInventorySources(
          passingAfter(pages),
        );

        expect(sourceReads + registryPagesRead()).toBe(pages);
        expect(result.stoppedAtDeadline).toBe(true);
      },
    );

    test("a pass whose deadline has passed before it starts reads nothing", async () => {
      const deadline: JobDeadline = new JobDeadline();
      deadline.end(new Error("The run lost its lock."));

      const result: InventorySyncPassResult =
        await syncAllInventorySources(deadline);

      expect(sourceReads + registryPagesRead()).toBe(0);
      expect(result.stoppedAtDeadline).toBe(true);
    });

    test("a deadline that passes mid-table stops that table's next page", async () => {
      const ids: Array<ObjectID> = sortedIds(2500);
      const table: ReturnType<typeof fakeSource> = fakeSource(ids);
      const deadline: JobDeadline = new JobDeadline();

      const fetchPage: ErasedInventorySource["fetchPage"] =
        table.source.fetchPage;
      table.source.fetchPage = async (data: {
        afterId?: ObjectID | undefined;
        limit: number;
      }): Promise<InventorySourcePage> => {
        const page: InventorySourcePage = await fetchPage(data);
        if (table.pages.length === 2) {
          deadline.end(new Error("The time limit ran out."));
        }
        return page;
      };

      const result: InventorySyncResult = await syncInventorySource(
        table.source,
        deadline,
      );

      // Two pages copied, the third never read, and no registry page read.
      expect(table.pages).toHaveLength(2);
      expect(result.created).toBe(2000);
      expect(registryPagesRead()).toBe(0);
    });

    /*
     * Stopping is safe because a pass keeps what it wrote: the next one reads
     * from the first page again, finds those rows mirrored, writes nothing
     * for them, and carries on.
     */
    test("the pass after one that stopped writes only what the first did not", async () => {
      const ids: Array<ObjectID> = sortedIds(2500);
      const table: ReturnType<typeof fakeSource> = fakeSource(ids);
      const mirrored: Map<string, InventoryItem> = new Map<
        string,
        InventoryItem
      >();

      jest.spyOn(InventoryItemService, "findBy").mockImplementation((async (
        call: FindByCall,
      ) => {
        registryReads.push(call);
        // The forward pass's lookup: `entityKey IN (:...keys)`.
        const condition: FindOperator<unknown> | undefined = call.query[
          "entityKey"
        ] as unknown as FindOperator<unknown> | undefined;
        const keys: Array<string> | undefined = condition
          ? (Object.values(
              condition.objectLiteralParameters || {},
            )[0] as Array<string>)
          : undefined;
        return keys
          ? keys
              .map((key: string): InventoryItem | undefined => {
                return mirrored.get(key);
              })
              .filter((item: InventoryItem | undefined): boolean => {
                return Boolean(item);
              })
          : [];
      }) as never);
      jest
        .spyOn(InventoryItemService, "create")
        .mockImplementation((async (data: { data: InventoryItem }) => {
          created.push(data.data.resourceId!.toString());
          mirrored.set(data.data.entityKey!, data.data);
          return data.data;
        }) as never);

      const stopsAfterAPage: JobDeadline = new JobDeadline();
      const fetchPage: ErasedInventorySource["fetchPage"] =
        table.source.fetchPage;
      table.source.fetchPage = async (data: {
        afterId?: ObjectID | undefined;
        limit: number;
      }): Promise<InventorySourcePage> => {
        const page: InventorySourcePage = await fetchPage(data);
        if (table.pages.length === 1) {
          stopsAfterAPage.end(new Error("The time limit ran out."));
        }
        return page;
      };

      const first: InventorySyncResult = await syncInventorySource(
        table.source,
        stopsAfterAPage,
      );
      table.source.fetchPage = fetchPage;
      const second: InventorySyncResult = await syncInventorySource(
        table.source,
        new JobDeadline(),
      );

      expect(first.created).toBe(1000);
      expect(second.created).toBe(1500);
      expect(new Set(created).size).toBe(2500);
      expect(created).toHaveLength(2500);
    });

    test("a source that fails leaves the others to run", async () => {
      jest
        .spyOn(CloudResourceService, "findBy")
        .mockImplementation((async () => {
          sourceReads++;
          throw new Error("relation does not exist");
        }) as never);

      const result: InventorySyncPassResult = await syncAllInventorySources(
        new JobDeadline(),
      );

      // Six sources read both passes; the failed one only its first page.
      expect(sourceReads + registryPagesRead()).toBe(
        2 * (INVENTORY_SOURCES.length - 1) + 1,
      );
      expect(result.stoppedAtDeadline).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "InventoryEntityRegistry: sync failed for CloudResource:",
      );
    });
  });
});
