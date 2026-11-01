import DataSecurityTracedAccess, {
  MAX_TRACED_ACCESS_ENTRIES,
  TRACED_ACCESS_VIA,
  TracedUse,
  tracedAccessEntry,
} from "../../../../Server/Utils/DataSecurity/DataSecurityTracedAccess";
import DataStoreAccessService from "../../../../Server/Services/DataStoreAccessService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../../Types/DataSecurity/DataStoreAccess";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The services seen using a store, as who can reach it
 * (DataSecurityTracedAccess): each one an access entry of the store - the
 * service by its id, Read, seen in traces, last used when the service map
 * last saw the call - made, brought up to date, and taken away once the
 * service stops calling the store.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_STORE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const SEEN: Date = new Date("2026-10-27T10:00:00.000Z");

let table: Array<DataStoreAccess>;
let findSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  table = [];
  findSpy = jest
    .spyOn(DataStoreAccessService, "findBy")
    .mockImplementation((async () => {
      return table.filter((row: DataStoreAccess) => {
        return row.isSeenInTraces;
      });
    }) as never);
  createSpy = jest
    .spyOn(DataStoreAccessService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataStoreAccess>,
    ): Promise<DataStoreAccess> => {
      createBy.data.id = ObjectID.generate();
      table.push(createBy.data);
      return createBy.data;
    }) as never);
  updateSpy = jest
    .spyOn(DataStoreAccessService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: DataStoreAccess | undefined = table.find(
        (entry: DataStoreAccess) => {
          return entry.id?.toString() === data.id.toString();
        },
      );

      for (const [column, value] of Object.entries(data.data)) {
        row?.setColumnValue(column, value as never);
      }
    }) as never);
  deleteSpy = jest
    .spyOn(DataStoreAccessService, "deleteOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      table = table.filter((entry: DataStoreAccess) => {
        return entry.id?.toString() !== data.id.toString();
      });
    }) as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function use(extra: Partial<TracedUse> = {}): TracedUse {
  return {
    dataStoreId: STORE_ID,
    serviceId: SERVICE_ID,
    serviceName: "checkout",
    seenAt: SEEN,
    ...extra,
  };
}

function sync(uses: Array<TracedUse>, now: Date = NOW): Promise<void> {
  return DataSecurityTracedAccess.sync({ projectId: PROJECT_ID, uses, now });
}

describe("a service as an access entry", () => {
  test("by its id, reading the store, seen in traces, when the map last saw it", () => {
    expect(tracedAccessEntry(use())).toEqual({
      principal: SERVICE_ID.toString(),
      principalName: "checkout",
      principalType: DataStorePrincipalType.Service,
      accessLevel: DataStoreAccessLevel.Read,
      grantedVia: TRACED_ACCESS_VIA,
      isExternal: false,
      isPublic: false,
      isSeenInTraces: true,
      lastUsedAt: SEEN,
    });
    expect(TRACED_ACCESS_VIA).toBe("Seen in traces");
  });

  test("a service OneUptime holds no record of goes by its name", () => {
    const entry: DataStoreAccessEntry = tracedAccessEntry(
      use({ serviceId: undefined, serviceName: "  legacy-batch  " }),
    );

    expect(entry.principal).toBe("service:legacy-batch");
    expect(entry.principalName).toBe("legacy-batch");
  });
});

describe("DataSecurityTracedAccess.sync", () => {
  test("a service seen calling a store is made one of its entries, as root, keyed as the cloud's are", async () => {
    await sync([use()]);

    expect(createSpy).toHaveBeenCalledTimes(1);

    const created: DataStoreAccess = table[0]!;

    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.dataStoreId?.toString()).toBe(STORE_ID.toString());
    expect(created.accessKey).toBe(
      getDataStoreAccessKey(tracedAccessEntry(use())),
    );
    expect(created.principal).toBe(SERVICE_ID.toString());
    expect(created.principalName).toBe("checkout");
    expect(created.isSeenInTraces).toBe(true);
    expect(created.lastUsedAt).toEqual(SEEN);
    expect(created.firstSeenAt).toEqual(NOW);
    expect(created.lastSeenAt).toEqual(NOW);
    expect(
      (createSpy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
    expect((findSpy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual({
      projectId: PROJECT_ID,
      isSeenInTraces: true,
    });
    expect((findSpy.mock.calls[0]![0] as { limit: number }).limit).toBe(
      MAX_TRACED_ACCESS_ENTRIES,
    );
  });

  test("seen again, its entry is brought up to date, never made twice", async () => {
    const later: Date = new Date("2026-10-28T09:00:00.000Z");

    await sync([use()]);
    await sync([use({ seenAt: later, serviceName: "checkout-v2" })], later);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(table).toHaveLength(1);
    expect(table[0]!.lastUsedAt).toEqual(later);
    expect(table[0]!.lastSeenAt).toEqual(later);
    expect(table[0]!.principalName).toBe("checkout-v2");
  });

  test("one service on two stores is an entry on each; the same use twice is one", async () => {
    await sync([use(), use(), use({ dataStoreId: OTHER_STORE_ID })]);

    expect(
      table
        .map((row: DataStoreAccess): string => {
          return row.dataStoreId!.toString();
        })
        .sort(),
    ).toEqual([STORE_ID.toString(), OTHER_STORE_ID.toString()].sort());
  });

  test("a service that stops calling a store is taken away; the cloud's own entries are never read here", async () => {
    const cloud: DataStoreAccess = new DataStoreAccess(ObjectID.generate());
    cloud.dataStoreId = STORE_ID;
    cloud.accessKey = "arn:aws:iam::1:role/app|Read|Bucket policy";
    cloud.isSeenInTraces = false;
    table.push(cloud);

    await sync([use(), use({ dataStoreId: OTHER_STORE_ID })]);
    await sync([use({ dataStoreId: OTHER_STORE_ID })]);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(
      table
        .filter((row: DataStoreAccess) => {
          return row.isSeenInTraces;
        })
        .map((row: DataStoreAccess): string => {
          return row.dataStoreId!.toString();
        }),
    ).toEqual([OTHER_STORE_ID.toString()]);
    expect(table).toContain(cloud);
  });

  test("an entry that cannot be written is logged, and the others are", async () => {
    createSpy.mockImplementationOnce((async () => {
      throw new Error("conflict");
    }) as never);

    await sync([use(), use({ dataStoreId: OTHER_STORE_ID })]);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not record checkout using store ${STORE_ID.toString()}:`,
    );
    expect(table).toHaveLength(1);
  });

  test("every column an entry writes is a column of DataStoreAccess", async () => {
    const columns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStoreAccess())),
    );

    await sync([use()]);

    for (const column of Object.keys(
      (updateSpy.mock.calls[0]?.[0] as { data: JSONObject } | undefined)
        ?.data || {},
    )) {
      expect([column, columns.has(column)]).toEqual([column, true]);
    }

    for (const column of [
      "principal",
      "principalName",
      "principalType",
      "accessLevel",
      "grantedVia",
      "isExternal",
      "isPublic",
      "isSeenInTraces",
      "lastUsedAt",
      "lastSeenAt",
      "firstSeenAt",
      "accessKey",
    ]) {
      expect([column, columns.has(column)]).toEqual([column, true]);
    }
  });
});
