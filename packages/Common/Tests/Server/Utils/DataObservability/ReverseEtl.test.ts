import { describe, expect, test } from "@jest/globals";
import DataBiTool, {
  needsBaseUrl,
} from "../../../../Types/DataObservability/DataBiTool";
import { JSONObject } from "../../../../Types/JSON";
import {
  BiDashboardRead,
  BiTransport,
  readBiDashboards,
  readCensusSync,
  readHightouchModelTables,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * A reverse ETL sync copies a table into another tool, so it depends on that
 * table as a dashboard does, and its alerts name it the same way.
 */

function transportOf(pages: Record<string, unknown>): {
  transport: BiTransport;
  asked: Array<DataSourceHttpRequest>;
} {
  const asked: Array<DataSourceHttpRequest> = [];

  return {
    asked,
    transport: (async (request: DataSourceHttpRequest) => {
      asked.push(request);

      const found: string | undefined = Object.keys(pages).find(
        (key: string) => {
          return request.url.includes(key);
        },
      );

      return {
        statusCode: 200,
        bodyJson: found ? pages[found] : { data: [] },
        bodyText: "",
      };
    }) as unknown as BiTransport,
  };
}

describe("Hightouch", () => {
  test("a sync names its model and destination, and the table behind it", async () => {
    const { transport, asked } = transportOf({
      "/syncs": {
        data: [
          {
            id: 7,
            slug: "orders-to-salesforce",
            modelId: 1,
            destinationId: 2,
            lastRunAt: "2026-11-04T11:00:00Z",
          },
        ],
        hasMore: false,
      },
      "/models": {
        data: [{ id: 1, name: "Orders", table: { name: "public.orders" } }],
        hasMore: false,
      },
      "/destinations": {
        data: [{ id: 2, name: "Salesforce", type: "salesforce" }],
        hasMore: false,
      },
    });
    const [sync]: Array<BiDashboardRead> = await readBiDashboards(
      DataBiTool.Hightouch,
      { baseUrl: "", credentials: { apiKey: "key" }, transport },
    );

    expect(sync?.externalId).toBe("7");
    expect(sync?.name).toBe("Orders to Salesforce");
    expect(sync?.folder).toBe("Reverse ETL");
    expect(sync?.tables[0]?.schema).toBe("public");
    expect(sync?.tables[0]?.table).toBe("orders");
    expect(sync?.changedAt).toEqual(new Date("2026-11-04T11:00:00Z"));
    expect(asked[0]?.headers?.["Authorization"]).toBe("Bearer key");
  });

  test("a SQL model names the tables it reads", () => {
    expect(
      readHightouchModelTables({
        raw: { sql: "SELECT * FROM public.orders JOIN customers ON 1 = 1" },
      } as unknown as JSONObject).map((ref: { table: string }) => {
        return ref.table;
      }),
    ).toEqual(["orders", "customers"]);
  });

  test("a model that names neither has none", () => {
    expect(
      readHightouchModelTables({
        queryType: "visual",
      } as unknown as JSONObject),
    ).toEqual([]);
  });

  test("it needs an API key", async () => {
    await expect(
      readBiDashboards(DataBiTool.Hightouch, { baseUrl: "", credentials: {} }),
    ).rejects.toThrow("apiKey");
  });

  test("it pages until there is no more", async () => {
    let calls: number = 0;
    const transport: BiTransport = (async () => {
      calls++;

      return {
        statusCode: 200,
        bodyJson: { data: [{ id: calls }], hasMore: calls === 1 },
        bodyText: "",
      };
    }) as unknown as BiTransport;

    await readBiDashboards(DataBiTool.Hightouch, {
      baseUrl: "",
      credentials: { apiKey: "key" },
      transport,
    });

    // Two pages of syncs, then one each of models and destinations.
    expect(calls).toBe(4);
  });
});

describe("Census", () => {
  test("a sync's source is a table", () => {
    const sync: BiDashboardRead = readCensusSync({
      id: 15135,
      label: "New Signups to Leads",
      updated_at: "2026-11-04T11:00:00Z",
      source_attributes: {
        connection_id: 1,
        object: {
          type: "table",
          table_name: "events",
          table_schema: "publish",
          table_catalog: "data_mart",
        },
      },
      destination_attributes: { connection_id: 2, object: "lead" },
    } as unknown as JSONObject);

    expect(sync.externalId).toBe("15135");
    expect(sync.name).toBe("New Signups to Leads");
    expect(sync.tables).toEqual([
      {
        database: "data_mart",
        schema: "publish",
        table: "events",
        engine: null,
        host: null,
      },
    ]);
  });

  test("with no label, it says where the rows go", () => {
    expect(
      readCensusSync({
        id: 1,
        source_attributes: { object: { type: "table", table_name: "events" } },
        destination_attributes: { object: "lead" },
      } as unknown as JSONObject).name,
    ).toBe("events to lead");
  });

  test("a source that is not a table names none", () => {
    expect(
      readCensusSync({
        id: 1,
        label: "A model",
        source_attributes: { object: { type: "model", name: "signups" } },
      } as unknown as JSONObject).tables,
    ).toEqual([]);
  });

  test("it pages by next_page, in the region it is told", async () => {
    const { transport, asked } = transportOf({
      "?page=1&": {
        data: [{ id: 1 }],
        pagination: { next_page: 2 },
      },
      "?page=2&": { data: [{ id: 2 }], pagination: { next_page: null } },
    });
    const syncs: Array<BiDashboardRead> = await readBiDashboards(
      DataBiTool.Census,
      {
        baseUrl: "",
        credentials: { apiKey: "key", region: "eu" },
        transport,
      },
    );

    expect(syncs).toHaveLength(2);
    expect(asked[0]?.url).toContain("app-eu.getcensus.com");
  });
});

describe("where these tools are", () => {
  test("their makers' own APIs need no address", () => {
    expect(needsBaseUrl(DataBiTool.Hightouch)).toBe(false);
    expect(needsBaseUrl(DataBiTool.Census)).toBe(false);
    expect(needsBaseUrl(DataBiTool.Metabase)).toBe(true);
  });
});
