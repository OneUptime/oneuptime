import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataPipelineOwnerTeamService from "../../../../Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "../../../../Server/Services/DataPipelineOwnerUserService";
import DataProductService from "../../../../Server/Services/DataProductService";
import DataObservabilityIssues, {
  isIssueOwnerFilter,
} from "../../../../Server/Utils/DataObservability/DataObservabilityIssues";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityCollector,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssuesRequest,
  DataObservabilityIssuesResponse,
  DataObservabilityStoreSummary,
  DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
  MAX_DATA_OBSERVABILITY_ISSUES_PAGE,
} from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
} from "../../../../Types/DataObservability/DataObservabilityAttention";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";

/*
 * THE ISSUES PAGE: EVERYTHING THAT NEEDS SOMEONE, FILTERED ON THE SERVER
 * (#6549).
 *
 * Every item of Needs Attention, worst first, a page at a time, filtered by
 * kind, database (a check by its table's database), owner - a table's, a
 * pipeline's, a data product's - or No owner, and whether an alert is open.
 * Owners are read with the caller's own permissions: one who may not read
 * owners is offered none, and an owner filter finds nothing for them,
 * rather than every item called ownerless.
 */

function id(suffix: string): string {
  return `77777777-7777-4777-8777-${suffix.padStart(12, "0")}`;
}

const STORE_ORDERS: string = id("1");
const STORE_WAREHOUSE: string = id("2");
const TABLE_ORDERS: string = id("11");
const TABLE_PAYMENTS: string = id("12");
const CHECK_ORDERS: string = id("21");
const PIPELINE_LOAD: string = id("31");
const PRODUCT_REVENUE: string = id("41");
const RECONCILIATION: string = id("51");
const ALICE: string = id("61");
const DATA_TEAM: string = id("71");

const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID(id("99")),
};

function item(
  kind: DataAttentionKind,
  fields: Partial<DataAttentionItem>,
): DataAttentionItem {
  return {
    kind,
    name: kind,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...fields,
  };
}

// Worst first, as the reader hands them.
const ITEMS: Array<DataAttentionItem> = [
  item(DataAttentionKind.CollectionFailed, { dataStoreId: STORE_WAREHOUSE }),
  item(DataAttentionKind.PipelineFailed, {
    dataPipelineId: PIPELINE_LOAD,
    alert: { alertId: id("81"), number: "ALT-1", title: "Run failed" },
  }),
  item(DataAttentionKind.CheckFailing, {
    dataCheckId: CHECK_ORDERS,
    dataAssetId: TABLE_ORDERS,
    alert: { alertId: id("82"), number: "ALT-2", title: "Check failing" },
  }),
  item(DataAttentionKind.ReconciliationDrifted, {
    dataReconciliationId: RECONCILIATION,
  }),
  item(DataAttentionKind.DataProductLate, { dataProductId: PRODUCT_REVENUE }),
  item(DataAttentionKind.TableLate, {
    dataAssetId: TABLE_PAYMENTS,
    dataStoreId: STORE_ORDERS,
  }),
];

const STORE_OF_CHECK: Map<string, string> = new Map([
  [CHECK_ORDERS, STORE_ORDERS],
]);

const STORES: Array<DataObservabilityStoreSummary> = [
  {
    dataStoreId: STORE_ORDERS,
    name: "orders-db",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: null,
    assetCount: 2,
    lateAssetCount: 1,
    alertMonitorCount: 3,
  },
];

let ownerReads: Array<{
  service: string;
  query: Record<string, unknown>;
  props: unknown;
}>;

function stubOwners(options: { refused?: boolean } = {}): void {
  ownerReads = [];

  const respond: (
    service: string,
    rows: Array<Record<string, unknown>>,
  ) => (findBy: {
    query: Record<string, unknown>;
    props: unknown;
  }) => Promise<Array<Record<string, unknown>>> = (
    service: string,
    rows: Array<Record<string, unknown>>,
  ) => {
    return async (findBy: {
      query: Record<string, unknown>;
      props: unknown;
    }): Promise<Array<Record<string, unknown>>> => {
      ownerReads.push({ service, query: findBy.query, props: findBy.props });

      if (options.refused) {
        throw new NotAuthorizedException(
          "You do not have permission to read the owners.",
        );
      }

      return rows;
    };
  };

  jest
    .spyOn(DataAssetOwnerUserService, "findBy")
    .mockImplementation(
      respond("DataAssetOwnerUser", [
        {
          dataAssetId: new ObjectID(TABLE_ORDERS),
          user: { id: new ObjectID(ALICE), name: "Alice" },
        },
      ]) as never,
    );
  jest
    .spyOn(DataAssetOwnerTeamService, "findBy")
    .mockImplementation(respond("DataAssetOwnerTeam", []) as never);
  jest
    .spyOn(DataPipelineOwnerUserService, "findBy")
    .mockImplementation(respond("DataPipelineOwnerUser", []) as never);
  jest
    .spyOn(DataPipelineOwnerTeamService, "findBy")
    .mockImplementation(
      respond("DataPipelineOwnerTeam", [
        {
          dataPipelineId: new ObjectID(PIPELINE_LOAD),
          team: { id: new ObjectID(DATA_TEAM), name: "Data Platform" },
        },
      ]) as never,
    );
  jest
    .spyOn(DataProductService, "findBy")
    .mockImplementation(
      respond("DataProduct", [
        {
          id: new ObjectID(PRODUCT_REVENUE),
          ownerTeam: { id: new ObjectID(DATA_TEAM), name: "Data Platform" },
        },
      ]) as never,
    );
}

async function answer(
  body: JSONObject,
): Promise<DataObservabilityIssuesResponse> {
  return await DataObservabilityIssues.answer({
    request: DataObservabilityIssues.readRequest(body),
    items: ITEMS,
    storeIdByCheckId: STORE_OF_CHECK,
    stores: STORES,
    reader: READER,
  });
}

function kinds(response: DataObservabilityIssuesResponse): Array<string> {
  return response.items.map((found: DataAttentionItem): string => {
    return found.kind;
  });
}

beforeEach(() => {
  stubOwners();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every item, worst first, a page at a time", () => {
  test("with no filter: every item in the reader's order, how many match, how many in all", async () => {
    const response: DataObservabilityIssuesResponse = await answer({});

    expect(kinds(response)).toEqual(
      ITEMS.map((found: DataAttentionItem): string => {
        return found.kind;
      }),
    );
    expect(response.count).toBe(6);
    expect(response.totalCount).toBe(6);
    expect(response.skip).toBe(0);
    expect(response.limit).toBe(DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE);
    expect(response.stores).toEqual(STORES);
  });

  test("a page: the items after skip, as many as limit", async () => {
    const response: DataObservabilityIssuesResponse = await answer({
      skip: 2,
      limit: 2,
    });

    expect(kinds(response)).toEqual([
      DataAttentionKind.CheckFailing,
      DataAttentionKind.ReconciliationDrifted,
    ]);
    expect(response.count).toBe(6);
  });

  test("a page asks for at most the most a page holds", () => {
    expect(
      DataObservabilityIssues.readRequest({ limit: 10_000 }).limit,
    ).toBe(MAX_DATA_OBSERVABILITY_ISSUES_PAGE);
    expect(DataObservabilityIssues.readRequest({ limit: -3 }).limit).toBe(
      DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
    );
    expect(DataObservabilityIssues.readRequest({ skip: 2.5 }).skip).toBe(0);
    expect(
      DataObservabilityIssues.readRequest({ skip: "10" as never }).skip,
    ).toBe(0);
  });
});

describe("the filters", () => {
  test("by kind", async () => {
    const response: DataObservabilityIssuesResponse = await answer({
      kinds: [DataAttentionKind.TableLate, DataAttentionKind.CheckFailing],
    });

    expect(kinds(response)).toEqual([
      DataAttentionKind.CheckFailing,
      DataAttentionKind.TableLate,
    ]);
    expect(response.count).toBe(2);
    expect(response.totalCount).toBe(6);
  });

  test("an empty list of kinds asks for every kind; a kind this server does not know matches nothing", async () => {
    expect((await answer({ kinds: [] })).count).toBe(6);
    expect((await answer({ kinds: ["Table Melted"] })).count).toBe(0);
  });

  test("by database: the database itself, its tables, and a check by its table's database", async () => {
    expect(kinds(await answer({ dataStoreId: STORE_ORDERS }))).toEqual([
      DataAttentionKind.CheckFailing,
      DataAttentionKind.TableLate,
    ]);
    expect(kinds(await answer({ dataStoreId: STORE_WAREHOUSE }))).toEqual([
      DataAttentionKind.CollectionFailed,
    ]);
  });

  test("by whether an alert is open", async () => {
    expect(
      kinds(await answer({ alert: DataObservabilityIssueAlertFilter.Open })),
    ).toEqual([DataAttentionKind.PipelineFailed, DataAttentionKind.CheckFailing]);
    expect(
      (await answer({ alert: DataObservabilityIssueAlertFilter.None })).count,
    ).toBe(4);
  });

  test("by owner: a person who owns a table, and a check through its table", async () => {
    expect(kinds(await answer({ owner: `user:${ALICE}` }))).toEqual([
      DataAttentionKind.CheckFailing,
    ]);
  });

  test("by owner: a team owning a pipeline (#6551) and a data product", async () => {
    expect(kinds(await answer({ owner: `team:${DATA_TEAM}` }))).toEqual([
      DataAttentionKind.PipelineFailed,
      DataAttentionKind.DataProductLate,
    ]);
  });

  test("No owner: what can have owners and has none - never a database or a reconciliation", async () => {
    expect(
      kinds(await answer({ owner: DATA_OBSERVABILITY_NO_OWNER_FILTER })),
    ).toEqual([DataAttentionKind.TableLate]);
  });

  test("filters combine", async () => {
    expect(
      kinds(
        await answer({
          dataStoreId: STORE_ORDERS,
          alert: DataObservabilityIssueAlertFilter.None,
        }),
      ),
    ).toEqual([DataAttentionKind.TableLate]);
  });
});

describe("owners, read as the caller", () => {
  test("each kind's owners in one read, with the caller's own permissions", async () => {
    await answer({});

    for (const read of ownerReads) {
      expect(read.props).toBe(READER);
    }

    const assetRead = ownerReads.find((read) => {
      return read.service === "DataAssetOwnerUser";
    });

    const tables: FindOperator<unknown> = assetRead!.query[
      "dataAssetId"
    ] as FindOperator<unknown>;

    expect(tables).toBeInstanceOf(FindOperator);
    // The tables of the items, each once: one read for every table.
    expect(
      (
        Object.values(
          (tables.objectLiteralParameters as Record<string, unknown>) || {},
        ).flat() as Array<unknown>
      )
        .map(String)
        .sort(),
    ).toEqual([TABLE_ORDERS, TABLE_PAYMENTS].sort());
  });

  test("everyone who owns one of the items, once each, by name", async () => {
    expect((await answer({})).owners).toEqual([
      {
        key: `user:${ALICE}`,
        kind: "user",
        id: ALICE,
        name: "Alice",
      },
      {
        key: `team:${DATA_TEAM}`,
        kind: "team",
        id: DATA_TEAM,
        name: "Data Platform",
      },
    ]);
  });

  test("a caller who may not read owners is offered none, and an owner filter finds nothing", async () => {
    stubOwners({ refused: true });

    const everything: DataObservabilityIssuesResponse = await answer({});

    expect(everything.owners).toEqual([]);
    expect(everything.count).toBe(6);
    expect(
      (await answer({ owner: DATA_OBSERVABILITY_NO_OWNER_FILTER })).count,
    ).toBe(0);
    expect((await answer({ owner: `user:${ALICE}` })).count).toBe(0);
  });

  test("no owner is read when nothing can be owned", async () => {
    await DataObservabilityIssues.answer({
      request: {},
      items: [ITEMS[0]!, ITEMS[3]!],
      storeIdByCheckId: new Map(),
      stores: [],
      reader: READER,
    });

    expect(ownerReads).toEqual([]);
  });
});

describe("a request, checked", () => {
  test.each([
    ["a database that is no id", { dataStoreId: "orders" }],
    ["a database that is no text", { dataStoreId: 4 }],
    ["an owner of no kind", { owner: `group:${ALICE}` }],
    ["an owner whose id is no id", { owner: "user:alice" }],
    ["an owner with more to it", { owner: `user:${ALICE}:x` }],
    ["an alert filter of no meaning", { alert: "maybe" }],
    ["kinds that are no list", { kinds: "Table Late" }],
  ])("refuses %s, rather than reading it as no filter", (_label, body) => {
    expect(() => {
      DataObservabilityIssues.readRequest(body as unknown as JSONObject);
    }).toThrow(BadDataException);
  });

  test("reads every filter given", () => {
    const request: DataObservabilityIssuesRequest =
      DataObservabilityIssues.readRequest({
        kinds: [DataAttentionKind.TableLate],
        dataStoreId: STORE_ORDERS,
        owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
        alert: DataObservabilityIssueAlertFilter.Open,
        skip: 25,
        limit: 25,
      });

    expect(request).toEqual({
      kinds: [DataAttentionKind.TableLate],
      dataStoreId: STORE_ORDERS,
      owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
      alert: DataObservabilityIssueAlertFilter.Open,
      skip: 25,
      limit: 25,
    });
  });

  test("null is no filter", () => {
    expect(
      DataObservabilityIssues.readRequest({
        kinds: null,
        dataStoreId: null,
        owner: null,
        alert: null,
      }),
    ).toEqual({ skip: 0, limit: DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE });
  });

  test("an owner's key is a person's or a team's, or none", () => {
    expect(isIssueOwnerFilter(`user:${ALICE}`)).toBe(true);
    expect(isIssueOwnerFilter(`team:${DATA_TEAM}`)).toBe(true);
    expect(isIssueOwnerFilter(DATA_OBSERVABILITY_NO_OWNER_FILTER)).toBe(true);
    expect(isIssueOwnerFilter("team:")).toBe(false);
    expect(isIssueOwnerFilter("")).toBe(false);
  });

  test("Includes is never how kinds are read: a plain list of the kinds known", () => {
    expect(
      DataObservabilityIssues.readRequest({
        kinds: [DataAttentionKind.TableLate, 3, "Melted"] as never,
      }).kinds,
    ).toEqual([DataAttentionKind.TableLate]);
    expect(new Includes([]).values).toEqual([]);
  });
});
