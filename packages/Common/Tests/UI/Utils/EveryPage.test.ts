import CappedListServer, {
  CappedListCall,
} from "../../App/Dashboard/CappedListServer";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import EveryPage, { EVERY_PAGE_CONCURRENCY } from "../../../UI/Utils/EveryPage";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * EVERY RECORD A QUERY MATCHES, A PAGE AT A TIME (#11210).
 *
 * One read with `limit: LIMIT_PER_PROJECT` holds the first 10,000 records,
 * and a page that weighs every record (a cloud account's recommendations
 * across its resources) weighed only those. EveryPage reads them all, in
 * pages, each record once. Answered by CappedListServer, which pages and
 * counts the way the list route does.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ACCOUNT: string = "123456789012";

// `count` resources of the account, named to sort in the order made.
const resourcesOf: (
  count: number,
  data?: { prefix?: string; account?: string },
) => Array<Record<string, unknown>> = (
  count: number,
  data?: { prefix?: string; account?: string },
): Array<Record<string, unknown>> => {
  // Another account's ids start apart from the account's own.
  const idPrefix: string = data?.prefix === "other" ? "11210001" : "11210000";

  return Array.from(
    { length: count },
    (_: unknown, index: number): Record<string, unknown> => {
      const n: string = String(index + 1);

      return {
        _id: `${idPrefix}-0000-4000-8000-${n.padStart(12, "0")}`,
        name: `${data?.prefix || "vm"} ${n.padStart(5, "0")}`,
        projectId: PROJECT_ID,
        cloudAccountId: data?.account || ACCOUNT,
      };
    },
  );
};

const idsOf: (records: Array<BaseModel>) => Array<string> = (
  records: Array<BaseModel>,
): Array<string> => {
  return records.map((record: BaseModel): string => {
    return record._id!.toString();
  });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("EveryPage.read", () => {
  test("fewer than a page: one read, as one read with the old limit took", async () => {
    const server: CappedListServer = new CappedListServer().install();
    server.add(CloudResource, resourcesOf(40));

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    });

    expect(records).toHaveLength(40);
    expect(server.callsFor(CloudResource)).toHaveLength(1);
    expect(server.callsFor(CloudResource)[0]).toMatchObject({
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });
  });

  test("past 10,000: every record, where one read with the old limit stopped at the first 10,000", async () => {
    const server: CappedListServer = new CappedListServer().install();
    const rows: Array<Record<string, unknown>> = resourcesOf(10_050);
    server.add(CloudResource, rows);

    // The old read: one page, as large as the list route allows.
    const oldRead: ListResult<CloudResource> = await ModelAPI.getList({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    expect(oldRead.data).toHaveLength(LIMIT_PER_PROJECT);
    expect(oldRead.count).toBe(10_050);

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    });

    expect(records).toHaveLength(10_050);
    expect(idsOf(records)).toEqual(
      rows.map((row: Record<string, unknown>): string => {
        return row["_id"] as string;
      }),
    );
    // The last resources, past the old cap, among them.
    expect(records[10_049]!.name).toBe("vm 10050");
  });

  test("pages by skip, in the order asked for with the id after it, every page the same size", async () => {
    const server: CappedListServer = new CappedListServer().install();
    server.add(CloudResource, resourcesOf(10_050));

    await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      sort: { name: SortOrder.Ascending },
      pageSize: 2500,
    });

    const calls: Array<CappedListCall> = server.callsFor(CloudResource);

    expect(
      calls.map((call: CappedListCall): number => {
        return call.skip;
      }),
    ).toEqual([0, 2500, 5000, 7500, 10_000]);

    for (const call of calls) {
      expect(call.limit).toBe(2500);
      expect(call.sort).toEqual({
        name: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      });
      // The id is always read: it is what keeps each record once.
      expect(call.select).toEqual({ _id: true, name: true });
    }
  });

  test("no page larger than the list route allows, whatever is asked", async () => {
    const server: CappedListServer = new CappedListServer().install();
    server.add(CloudResource, resourcesOf(12));

    await EveryPage.read({
      modelType: CloudResource,
      query: {},
      select: {},
      pageSize: 50_000,
    });

    expect(server.callsFor(CloudResource)[0]!.limit).toBe(LIMIT_PER_PROJECT);
  });

  test("only the query's own records: another account's are never among them", async () => {
    const server: CappedListServer = new CappedListServer().install();
    server.add(CloudResource, resourcesOf(30));
    server.add(
      CloudResource,
      resourcesOf(30, { prefix: "other", account: "999999999999" }),
    );

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      pageSize: 7,
    });

    expect(records).toHaveLength(30);
    expect(
      records.every((record: CloudResource): boolean => {
        return String(record.name).startsWith("vm ");
      }),
    ).toBe(true);
  });

  test(`after the first page, at most ${EVERY_PAGE_CONCURRENCY} pages are read at once`, async () => {
    const server: CappedListServer = new CappedListServer();
    server.add(CloudResource, resourcesOf(100));

    let inFlight: number = 0;
    let mostInFlight: number = 0;

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: Parameters<typeof ModelAPI.getList<BaseModel>>[0],
    ): Promise<ListResult<BaseModel>> => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      // The other reads asked for at once are asked for before this answers.
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;

      return server.list(options);
    }) as never);

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      pageSize: 10,
    });

    expect(records).toHaveLength(100);
    expect(mostInFlight).toBe(EVERY_PAGE_CONCURRENCY);

    // Asked for one at a time, one at a time it is.
    mostInFlight = 0;

    await EveryPage.read({
      modelType: CloudResource,
      query: { cloudAccountId: ACCOUNT },
      select: { name: true },
      pageSize: 10,
      concurrency: 1,
    });

    expect(mostInFlight).toBe(1);
  });

  test("a record that moves onto the next page while they are read is kept once", async () => {
    const rows: Array<Record<string, unknown>> = resourcesOf(6);
    const answers: Array<Array<Record<string, unknown>>> = [
      rows.slice(0, 3),
      // The third moved: it is on the second page too.
      rows.slice(2, 5),
      rows.slice(5, 6),
    ];
    let call: number = 0;

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (): Promise<
      ListResult<BaseModel>
    > => {
      const page: Array<Record<string, unknown>> = answers[call++] || [];

      return {
        data: page.map((values: Record<string, unknown>): BaseModel => {
          return Object.assign(new CloudResource(), values);
        }),
        // Three pages, as the first page counted them.
        count: 9,
        skip: 0,
        limit: 3,
      };
    }) as never);

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: {},
      select: {},
      pageSize: 3,
      concurrency: 1,
    });

    expect(idsOf(records)).toEqual(
      rows.slice(0, 6).map((row: Record<string, unknown>): string => {
        return row["_id"] as string;
      }),
    );
  });

  test("with no count to go by, pages are read until one comes back short", async () => {
    const rows: Array<Record<string, unknown>> = resourcesOf(7);
    const skips: Array<number> = [];

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
      skip: number;
      limit: number;
    }): Promise<ListResult<BaseModel>> => {
      skips.push(options.skip);

      return {
        data: rows
          .slice(options.skip, options.skip + options.limit)
          .map((values: Record<string, unknown>): BaseModel => {
            return Object.assign(new CloudResource(), values);
          }),
        count: undefined as unknown as number,
        skip: options.skip,
        limit: options.limit,
      };
    }) as never);

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: {},
      select: {},
      pageSize: 3,
    });

    expect(records).toHaveLength(7);
    expect(skips).toEqual([0, 3, 6]);
  });

  test("an exact multiple of the page: the read stops at the count, never asking for a page past it", async () => {
    const server: CappedListServer = new CappedListServer().install();
    server.add(CloudResource, resourcesOf(20));

    const records: Array<CloudResource> = await EveryPage.read({
      modelType: CloudResource,
      query: {},
      select: {},
      pageSize: 10,
    });

    expect(records).toHaveLength(20);
    expect(
      server.callsFor(CloudResource).map((call: CappedListCall): number => {
        return call.skip;
      }),
    ).toEqual([0, 10]);
  });

  test("a page that fails fails the read: a part of the records is never handed back as all of them", async () => {
    let call: number = 0;

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
      limit: number;
    }): Promise<ListResult<BaseModel>> => {
      call++;

      if (call === 3) {
        throw new Error("The connection was reset.");
      }

      return {
        data: resourcesOf(options.limit).map(
          (values: Record<string, unknown>): BaseModel => {
            return Object.assign(new CloudResource(), values);
          },
        ),
        count: 50,
        skip: 0,
        limit: options.limit,
      };
    }) as never);

    await expect(
      EveryPage.read({
        modelType: CloudResource,
        query: {},
        select: {},
        pageSize: 10,
      }),
    ).rejects.toThrow("The connection was reset.");
  });

  test("goes through the API it is handed", async () => {
    const server: CappedListServer = new CappedListServer();
    server.add(CloudResource, resourcesOf(3));

    const modelAPI: typeof ModelAPI = {
      getList: (options: Parameters<typeof ModelAPI.getList<BaseModel>>[0]) => {
        return Promise.resolve(server.list(options));
      },
    } as unknown as typeof ModelAPI;

    const shared: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "getList",
    );

    expect(
      await EveryPage.read({
        modelType: CloudResource,
        query: {},
        select: {},
        modelAPI: modelAPI,
      }),
    ).toHaveLength(3);
    expect(shared).not.toHaveBeenCalled();
  });
});
