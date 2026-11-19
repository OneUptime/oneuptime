import { describe, expect, test } from "@jest/globals";
import BiRequestError from "../../../../Server/Utils/DataObservability/Bi/BiRequestError";
import {
  BiTableRef,
  getBiTableName,
} from "../../../../Server/Utils/DataObservability/Bi/BiTables";
import {
  DATAFLOW_RETRY_AFTER_IN_MS,
  getDataflowExportRoom,
  getNeededDataflowIds,
  indexPowerBiDataflows,
  isDataflowDefinitionStale,
  MAX_DATAFLOW_EXPORTS_PER_READ,
  POWER_BI_DATAFLOW_EXPORTS_PER_HOUR,
  POWER_BI_DATAFLOW_READER_VERSION,
  PowerBiDataflowDefinition,
  PowerBiDataflowIndex,
  PowerBiDataflowResolution,
  PowerBiDataflowsRead,
  readDataflowDefinitions,
  readPowerBiDataflowExport,
  readPowerBiDataflows,
  resolveDataflowEntities,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiDataflows";
import { PowerQueryDataflowEntity } from "../../../../Server/Utils/DataObservability/Bi/PowerQuery";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The tables a Power BI dataflow's entities read (#9551). A dataset built
 * on a dataflow was read only up to the dataflow, so its reports were
 * never tied to the tables the dataflow loads, even from a database
 * OneUptime watches. The dataflow's definition, as Power BI's admin API
 * exports it (model.json), keeps its queries in one section document; each
 * entity is its query of that name, read with the dataflow's parameters
 * and other queries, and a linked entity reads another dataflow's.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const SALES_STAGING: string = "3b2e7a90-5c1d-4f8e-9a6b-0c1d2e3f4a5b";
const FINANCE_SHARED: string = "7f1c4e55-544b-403f-b132-da0d3a024674";
const SALES_WORKSPACE: string = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

/*
 * A dataflow's export, shaped as Power BI's model.json: its queries in the
 * pbi:mashup document - a parameter, a staging query loaded from SQL
 * Server, an entity computed from it, one from native SQL, and one linked
 * from another dataflow - and its loaded entities.
 */
const SALES_STAGING_EXPORT: JSONObject = {
  name: "Sales Staging",
  description: "",
  version: "1.0",
  culture: "en-US",
  modifiedTime: "2026-11-18T16:12:45.1188371+00:00",
  "pbi:mashup": {
    fastCombine: false,
    allowNativeQueries: false,
    queriesMetadata: {
      ServerName: {
        queryId: "1d6f0a3e-1111-4c2a-9d1e-6f7a8b9c0d1e",
        queryName: "ServerName",
      },
      "Staging Orders": {
        queryId: "1d6f0a3e-2222-4c2a-9d1e-6f7a8b9c0d1e",
        queryName: "Staging Orders",
        loadEnabled: false,
      },
      Orders: {
        queryId: "1d6f0a3e-3333-4c2a-9d1e-6f7a8b9c0d1e",
        queryName: "Orders",
        loadEnabled: true,
      },
      Returns: {
        queryId: "1d6f0a3e-4444-4c2a-9d1e-6f7a8b9c0d1e",
        queryName: "Returns",
        loadEnabled: true,
      },
      "Exchange Rates": {
        queryId: "1d6f0a3e-5555-4c2a-9d1e-6f7a8b9c0d1e",
        queryName: "Exchange Rates",
        loadEnabled: true,
      },
    },
    document: `section Section1;\r\nshared ServerName = "sql01.corp.acme.com" meta [IsParameterQuery = true, IsParameterQueryRequired = true, Type = type text];\r\nshared #"Staging Orders" = let\r\n  Source = Sql.Database(ServerName, "Sales"),\r\n  #"Navigation 1" = Source{[Schema = "dbo", Item = "Orders"]}[Data]\r\nin\r\n  #"Navigation 1";\r\nshared Orders = let\r\n  Source = #"Staging Orders",\r\n  #"Changed column type" = Table.TransformColumnTypes(Source, {{"Total", type number}})\r\nin\r\n  #"Changed column type";\r\nshared Returns = let\r\n  Source = Value.NativeQuery(Sql.Database(ServerName, "Sales"), "SELECT r.* FROM dbo.Returns r JOIN dbo.Orders o ON o.Id = r.OrderId", null, [EnableFolding = true])\r\nin\r\n  Source;\r\nshared #"Exchange Rates" = let\r\n  Source = PowerPlatform.Dataflows(null),\r\n  Workspaces = Source{[Id = "Workspaces"]}[Data],\r\n  ws = Workspaces{[workspaceId = "${SALES_WORKSPACE}"]}[Data],\r\n  df = ws{[dataflowId = "${FINANCE_SHARED}"]}[Data],\r\n  Rates = df{[entity = "Rates", version = ""]}[Data]\r\nin\r\n  Rates;\r\n`,
  },
  annotations: [],
  entities: [
    {
      $type: "LocalEntity",
      name: "Orders",
      description: "",
      attributes: [{ name: "Total", dataType: "double" }],
    },
  ],
};

const FINANCE_SHARED_EXPORT: JSONObject = {
  name: "Finance Shared",
  version: "1.0",
  "pbi:mashup": {
    fastCombine: false,
    allowNativeQueries: false,
    queriesMetadata: { Rates: { queryName: "Rates", loadEnabled: true } },
    document:
      'section Section1;\nshared Rates = let Source = Snowflake.Databases("acme.snowflakecomputing.com", "COMPUTE_WH"), DB = Source{[Name="FINANCE",Kind="Database"]}[Data], S = DB{[Name="PUBLIC",Kind="Schema"]}[Data], T = S{[Name="FX_RATES",Kind="Table"]}[Data] in T;',
  },
};

function names(refs: Array<BiTableRef>): Array<string> {
  return refs.map((ref: BiTableRef): string => {
    return `${getBiTableName(ref)} (${ref.engine}@${ref.host})`;
  });
}

const INDEX: PowerBiDataflowIndex = indexPowerBiDataflows([
  {
    id: SALES_STAGING,
    name: "Sales Staging",
    workspaceId: SALES_WORKSPACE,
    modifiedAt: "2026-11-18T16:12:45.000Z",
  },
  {
    id: FINANCE_SHARED,
    name: "Finance Shared",
    workspaceId: SALES_WORKSPACE,
    modifiedAt: "2026-11-01T09:00:00.000Z",
  },
  // Two dataflows of one name, in two workspaces.
  {
    id: "dup-1",
    name: "Customers",
    workspaceId: "ws-a",
    modifiedAt: null,
  },
  {
    id: "dup-2",
    name: "Customers",
    workspaceId: "ws-b",
    modifiedAt: null,
  },
]);

function definition(
  exported: JSONObject | null,
  fields: Partial<PowerBiDataflowDefinition> = {},
): PowerBiDataflowDefinition {
  return {
    modifiedAt: null,
    readAt: NOW.toISOString(),
    entities: exported ? readPowerBiDataflowExport(exported) : null,
    error: exported ? null : "Power BI answered 403: Forbidden",
    version: POWER_BI_DATAFLOW_READER_VERSION,
    ...fields,
  };
}

function entity(
  data: Partial<PowerQueryDataflowEntity> & { entity: string },
): PowerQueryDataflowEntity {
  return {
    workspaceId: null,
    workspaceName: null,
    dataflowId: null,
    dataflowName: null,
    ...data,
  };
}

describe("a dataflow's exported definition", () => {
  test("each query an entity: a staging query's table through a computed entity, native SQL, a parameter for the server", () => {
    const entities: ReturnType<typeof readPowerBiDataflowExport> =
      readPowerBiDataflowExport(SALES_STAGING_EXPORT)!;

    expect(Object.keys(entities)).toEqual([
      "ServerName",
      "Staging Orders",
      "Orders",
      "Returns",
      "Exchange Rates",
    ]);
    // The entity reads the staging query, which reads SQL Server through the parameter.
    expect(names(entities["Orders"]!.tables)).toEqual([
      "Sales.dbo.Orders (sqlserver@sql01.corp.acme.com)",
    ]);
    expect(entities["Orders"]!.sources).toEqual([
      { engine: "sqlserver", host: "sql01.corp.acme.com", database: "Sales" },
    ]);
    expect(names(entities["Returns"]!.tables)).toEqual([
      "Sales.dbo.Returns (sqlserver@sql01.corp.acme.com)",
      "Sales.dbo.Orders (sqlserver@sql01.corp.acme.com)",
    ]);
    // A linked entity names the other dataflow's entity, not a table.
    expect(entities["Exchange Rates"]).toEqual({
      tables: [],
      sources: [],
      dataflowEntities: [
        {
          workspaceId: SALES_WORKSPACE,
          workspaceName: null,
          dataflowId: FINANCE_SHARED,
          dataflowName: null,
          entity: "Rates",
        },
      ],
    });
  });

  test("an export with no document holds no entities", () => {
    expect(readPowerBiDataflowExport({ name: "x", entities: [] })).toBeNull();
    expect(
      readPowerBiDataflowExport({ "pbi:mashup": { document: "  " } }),
    ).toBeNull();
    expect(readPowerBiDataflowExport("not json")).toBeNull();
  });
});

describe("what a dataset's dataflow entities read", () => {
  const DEFINITIONS: Map<string, PowerBiDataflowDefinition> = new Map([
    [SALES_STAGING, definition(SALES_STAGING_EXPORT)],
    [FINANCE_SHARED, definition(FINANCE_SHARED_EXPORT)],
  ]);

  test("by the dataflow's id: the entity's tables, and the databases they come from", () => {
    const resolution: PowerBiDataflowResolution = resolveDataflowEntities({
      entities: [entity({ dataflowId: SALES_STAGING, entity: "Orders" })],
      definitions: DEFINITIONS,
      index: INDEX,
    });

    expect(names(resolution.tables)).toEqual([
      "Sales.dbo.Orders (sqlserver@sql01.corp.acme.com)",
    ]);
    expect(resolution.sources).toEqual([
      {
        type: "SQL Server",
        engine: "sqlserver",
        server: "sql01.corp.acme.com",
        database: "Sales",
        location: null,
      },
    ]);
    expect(resolution).toMatchObject({ isPending: false, unreadReasons: [] });
  });

  test("by its name, when one dataflow alone has it; an entity's name in any case", () => {
    expect(
      names(
        resolveDataflowEntities({
          entities: [
            entity({ dataflowName: "Sales Staging", entity: "returns" }),
          ],
          definitions: DEFINITIONS,
          index: INDEX,
        }).tables,
      ),
    ).toEqual([
      "Sales.dbo.Returns (sqlserver@sql01.corp.acme.com)",
      "Sales.dbo.Orders (sqlserver@sql01.corp.acme.com)",
    ]);

    const ambiguous: PowerBiDataflowResolution = resolveDataflowEntities({
      entities: [entity({ dataflowName: "Customers", entity: "Customers" })],
      definitions: DEFINITIONS,
      index: INDEX,
    });

    expect(ambiguous.tables).toEqual([]);
    expect(ambiguous.unreadReasons).toEqual([
      "OneUptime found no one dataflow named Customers.",
    ]);
  });

  test("a linked entity reads the other dataflow's entity in turn", () => {
    expect(
      names(
        resolveDataflowEntities({
          entities: [
            entity({ dataflowId: SALES_STAGING, entity: "Exchange Rates" }),
          ],
          definitions: DEFINITIONS,
          index: INDEX,
        }).tables,
      ),
    ).toEqual([
      "FINANCE.PUBLIC.FX_RATES (snowflake@acme.snowflakecomputing.com)",
    ]);
  });

  test("a definition not read yet waits; one Power BI would not give, or with no such entity, says why", () => {
    const pending: PowerBiDataflowResolution = resolveDataflowEntities({
      entities: [entity({ dataflowId: "not-read-yet", entity: "Orders" })],
      definitions: DEFINITIONS,
      index: INDEX,
    });

    expect(pending).toMatchObject({ isPending: true, unreadReasons: [] });

    const refused: PowerBiDataflowResolution = resolveDataflowEntities({
      entities: [entity({ dataflowId: "refused", entity: "Orders" })],
      definitions: new Map([["refused", definition(null)]]),
      index: INDEX,
    });

    expect(refused.unreadReasons).toEqual([
      "Power BI answered 403: Forbidden.",
    ]);

    const missing: PowerBiDataflowResolution = resolveDataflowEntities({
      entities: [entity({ dataflowId: SALES_STAGING, entity: "Invoices" })],
      definitions: DEFINITIONS,
      index: INDEX,
    });

    expect(missing.unreadReasons).toEqual([
      "Its dataflow has no query named Invoices.",
    ]);
  });

  test("a dataflow whose entity links back to itself is read once, not forever", () => {
    const looping: JSONObject = {
      "pbi:mashup": {
        document: `section Section1;\nshared Loop = let S = PowerPlatform.Dataflows(null), d = S{[Id="Workspaces"]}[Data]{[workspaceId="w"]}[Data]{[dataflowId="loop"]}[Data], e = d{[entity="Loop"]}[Data] in e;`,
      },
    };

    expect(
      resolveDataflowEntities({
        entities: [entity({ dataflowId: "loop", entity: "Loop" })],
        definitions: new Map([["loop", definition(looping)]]),
        index: INDEX,
      }),
    ).toEqual({ tables: [], sources: [], isPending: false, unreadReasons: [] });
  });

  test("the dataflows to read: those named, then those their linked entities name", () => {
    expect(
      getNeededDataflowIds({
        entities: [
          entity({ dataflowId: SALES_STAGING, entity: "Exchange Rates" }),
          entity({ dataflowName: "Customers", entity: "Customers" }),
        ],
        definitions: new Map(),
        index: INDEX,
      }),
    ).toEqual([SALES_STAGING]);
    expect(
      getNeededDataflowIds({
        entities: [
          entity({ dataflowId: SALES_STAGING, entity: "Exchange Rates" }),
        ],
        definitions: DEFINITIONS,
        index: INDEX,
      }),
    ).toEqual([SALES_STAGING, FINANCE_SHARED]);
  });
});

describe("when a definition is read again", () => {
  test("never read, its dataflow changed, or read by an older reader; not while it stands", () => {
    const read: PowerBiDataflowDefinition = definition(SALES_STAGING_EXPORT, {
      modifiedAt: "2026-11-18T16:12:45.000Z",
      readAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
    });

    expect(
      isDataflowDefinitionStale({
        definition: undefined,
        modifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isDataflowDefinitionStale({
        definition: read,
        modifiedAt: "2026-11-18T16:12:45.000Z",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isDataflowDefinitionStale({
        definition: read,
        modifiedAt: "2026-11-19T11:00:00.000Z",
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isDataflowDefinitionStale({
        definition: { ...read, version: 0 },
        modifiedAt: "2026-11-18T16:12:45.000Z",
        now: NOW,
      }),
    ).toBe(true);
  });

  test("one Power BI would not give, a day later; one the scan gives no time for, daily", () => {
    const refused: PowerBiDataflowDefinition = definition(null, {
      readAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    });

    expect(
      isDataflowDefinitionStale({
        definition: refused,
        modifiedAt: "2026-11-19T11:00:00.000Z",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isDataflowDefinitionStale({
        definition: refused,
        modifiedAt: null,
        now: new Date(NOW.getTime() + DATAFLOW_RETRY_AFTER_IN_MS),
      }),
    ).toBe(true);
    expect(
      isDataflowDefinitionStale({
        definition: definition(SALES_STAGING_EXPORT, {
          readAt: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
        }),
        modifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("Power BI's limit of 200 exports an hour", () => {
  test("a read spends at most its own share, and what the last hour left", () => {
    expect(getDataflowExportRoom({ exportedAt: [], now: NOW })).toBe(
      MAX_DATAFLOW_EXPORTS_PER_READ,
    );

    const recent: Array<string> = Array.from(
      { length: POWER_BI_DATAFLOW_EXPORTS_PER_HOUR - 10 },
      (): string => {
        return new Date(NOW.getTime() - 30 * 60 * 1000).toISOString();
      },
    );

    expect(getDataflowExportRoom({ exportedAt: recent, now: NOW })).toBe(10);
    // An hour on, they no longer count.
    expect(
      getDataflowExportRoom({
        exportedAt: recent,
        now: new Date(NOW.getTime() + HOUR),
      }),
    ).toBe(MAX_DATAFLOW_EXPORTS_PER_READ);
  });
});

describe("reading the definitions a read needs", () => {
  function exporter(answers: Record<string, JSONObject | Error>): {
    asked: Array<string>;
    export: (id: string) => Promise<unknown>;
  } {
    const asked: Array<string> = [];

    return {
      asked,
      export: async (id: string): Promise<unknown> => {
        asked.push(id);

        const answer: JSONObject | Error | undefined = answers[id];

        if (answer instanceof Error) {
          throw answer;
        }

        return answer || {};
      },
    };
  }

  test("exports the dataflows the charted datasets read, then those their linked entities read", async () => {
    const exporting: ReturnType<typeof exporter> = exporter({
      [SALES_STAGING]: SALES_STAGING_EXPORT,
      [FINANCE_SHARED]: FINANCE_SHARED_EXPORT,
    });
    const read: PowerBiDataflowsRead = await readPowerBiDataflows({
      entities: [
        entity({ dataflowId: SALES_STAGING, entity: "Exchange Rates" }),
      ],
      index: INDEX,
      kept: new Map(),
      exportedAt: [],
      now: NOW,
      exportDefinition: exporting.export,
    });

    expect(exporting.asked).toEqual([SALES_STAGING, FINANCE_SHARED]);
    expect(Array.from(read.kept.keys())).toEqual([
      SALES_STAGING,
      FINANCE_SHARED,
    ]);
    expect(read.kept.get(SALES_STAGING)).toMatchObject({
      modifiedAt: "2026-11-18T16:12:45.000Z",
      readAt: NOW.toISOString(),
      error: null,
    });
    expect(read.exportedAt).toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  test("a definition kept while its dataflow is unchanged is not exported again; a dataflow no dataset reads is let go", async () => {
    const exporting: ReturnType<typeof exporter> = exporter({});
    const read: PowerBiDataflowsRead = await readPowerBiDataflows({
      entities: [entity({ dataflowId: SALES_STAGING, entity: "Orders" })],
      index: INDEX,
      kept: new Map([
        [
          SALES_STAGING,
          definition(SALES_STAGING_EXPORT, {
            modifiedAt: "2026-11-18T16:12:45.000Z",
          }),
        ],
        ["no-longer-read", definition(FINANCE_SHARED_EXPORT)],
      ]),
      exportedAt: [],
      now: NOW,
      exportDefinition: exporting.export,
    });

    expect(exporting.asked).toEqual([]);
    expect(Array.from(read.kept.keys())).toEqual([SALES_STAGING]);
  });

  test("Power BI's refusal is kept as why; a 429 stops the read's exports and keeps what stood", async () => {
    const refusing: ReturnType<typeof exporter> = exporter({
      [SALES_STAGING]: new BiRequestError(
        "Power BI answered 403: The service principal is not allowed to use admin APIs.",
        403,
      ),
    });
    const refused: PowerBiDataflowsRead = await readPowerBiDataflows({
      entities: [entity({ dataflowId: SALES_STAGING, entity: "Orders" })],
      index: INDEX,
      kept: new Map(),
      exportedAt: [],
      now: NOW,
      exportDefinition: refusing.export,
    });

    expect(refused.kept.get(SALES_STAGING)).toMatchObject({
      entities: null,
      error:
        "Power BI answered 403: The service principal is not allowed to use admin APIs.",
    });

    const limiting: ReturnType<typeof exporter> = exporter({
      [SALES_STAGING]: new BiRequestError(
        "Power BI answered 429: Too many requests",
        429,
        HOUR,
      ),
    });
    const limited: PowerBiDataflowsRead = await readPowerBiDataflows({
      entities: [
        entity({ dataflowId: SALES_STAGING, entity: "Orders" }),
        entity({ dataflowId: FINANCE_SHARED, entity: "Rates" }),
      ],
      index: INDEX,
      kept: new Map(),
      exportedAt: [],
      now: NOW,
      exportDefinition: limiting.export,
    });

    expect(limiting.asked).toEqual([SALES_STAGING]);
    expect(limited.kept.size).toBe(0);
  });

  test("no more than a read's share at once, and none past the hour's limit", async () => {
    const many: Array<PowerQueryDataflowEntity> = Array.from(
      { length: 100 },
      (_: unknown, index: number): PowerQueryDataflowEntity => {
        return entity({ dataflowId: `df-${index}`, entity: "Orders" });
      },
    );
    const exporting: ReturnType<typeof exporter> = exporter({});

    await readPowerBiDataflows({
      entities: many,
      index: INDEX,
      kept: new Map(),
      exportedAt: [],
      now: NOW,
      exportDefinition: exporting.export,
    });

    expect(exporting.asked).toHaveLength(MAX_DATAFLOW_EXPORTS_PER_READ);

    const spent: ReturnType<typeof exporter> = exporter({});

    await readPowerBiDataflows({
      entities: many,
      index: INDEX,
      kept: new Map(),
      exportedAt: Array(POWER_BI_DATAFLOW_EXPORTS_PER_HOUR).fill(
        new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
      ),
      now: NOW,
      exportDefinition: spent.export,
    });

    expect(spent.asked).toEqual([]);
  });
});

describe("the definitions a read kept", () => {
  test("read back strictly: one that does not fit is left out, and read again", () => {
    const kept: Map<string, PowerBiDataflowDefinition> =
      readDataflowDefinitions({
        [SALES_STAGING]: JSON.parse(
          JSON.stringify(definition(SALES_STAGING_EXPORT)),
        ),
        refused: JSON.parse(JSON.stringify(definition(null))),
        noDate: { entities: {} },
        broken: "x",
      });

    expect(Array.from(kept.keys())).toEqual([SALES_STAGING, "refused"]);
    expect(names(kept.get(SALES_STAGING)!.entities!["Orders"]!.tables)).toEqual(
      ["Sales.dbo.Orders (sqlserver@sql01.corp.acme.com)"],
    );
    expect(kept.get("refused")).toMatchObject({
      entities: null,
      error: "Power BI answered 403: Forbidden",
    });
  });
});
