import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataTableLineageReader, {
  DataLineageDirection,
  DataLineageEdgeRow,
  DataLineageReader,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { DataTableLineage } from "../../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserType from "../../../../Types/UserType";

/*
 * What a table's lineage reads, and as whom (DataTableLineageReader's
 * database reader). Every read names the project, so no table, pipeline or
 * dashboard of another project is ever drawn; the lineage of many tables is
 * read in a few reads, a chunk of ids each; and a table's open alerts are
 * counted with the privacy clause of the person who asked, so a private
 * alert its reader may not see is never counted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_USER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-000000000003",
);

function id(index: number): string {
  return `00000001-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function idsOf(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return (value as Includes).values.map((entry: unknown): string => {
    return String(entry);
  });
}

// A person of the project with one permission, as a signed-in request makes them.
function person(
  userId: ObjectID,
  permission: Permission,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

type FindByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
};

function calls(spy: ReturnType<typeof jest.spyOn>): Array<FindByCall> {
  return spy.mock.calls.map((call: Array<unknown>): FindByCall => {
    return call[0] as FindByCall;
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lineage edges", () => {
  test("upstream: the edges into the tables, the project's own, newest first, as OneUptime", async () => {
    const row: DataAssetLineage = new DataAssetLineage();
    row.upstreamDataAssetId = new ObjectID(id(2));
    row.downstreamDataAssetId = new ObjectID(id(1));
    row.dataPipelineId = new ObjectID(id(9));
    row.source = DataAssetLineageSource.QueryHistory;
    row.lastSeenAt = new Date("2026-11-10T10:00:00.000Z");

    const writesRow: DataAssetLineage = new DataAssetLineage();
    writesRow.downstreamDataAssetId = new ObjectID(id(1));
    writesRow.dataPipelineId = new ObjectID(id(9));
    // As Postgres hands a date back through some drivers: a string.
    writesRow.lastSeenAt = "2026-11-10T09:00:00.000Z" as unknown as Date;

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([row, writesRow] as never);

    const rows: Array<DataLineageEdgeRow> =
      await DataTableLineageReader.getDatabaseReader(PROJECT_ID, null).readEdges(
        {
          direction: DataLineageDirection.Upstream,
          dataAssetIds: [id(1)],
          limit: 100,
        },
      );

    expect(rows).toEqual([
      {
        upstreamDataAssetId: id(2),
        downstreamDataAssetId: id(1),
        dataPipelineId: id(9),
        source: DataAssetLineageSource.QueryHistory,
        lastSeenAt: new Date("2026-11-10T10:00:00.000Z"),
      },
      {
        upstreamDataAssetId: null,
        downstreamDataAssetId: id(1),
        dataPipelineId: id(9),
        source: null,
        lastSeenAt: new Date("2026-11-10T09:00:00.000Z"),
      },
    ]);

    const call: FindByCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(idsOf(call.query["downstreamDataAssetId"])).toEqual([id(1)]);
    expect(call.query["upstreamDataAssetId"]).toBeUndefined();
    expect(call.select).toEqual({
      upstreamDataAssetId: true,
      downstreamDataAssetId: true,
      dataPipelineId: true,
      source: true,
      lastSeenAt: true,
    });
    expect(call.sort).toEqual({ lastSeenAt: SortOrder.Descending });
    expect(call.limit).toBe(100);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("downstream: the edges out of the tables", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([] as never);

    await DataTableLineageReader.getDatabaseReader(PROJECT_ID, null).readEdges({
      direction: DataLineageDirection.Downstream,
      dataAssetIds: [id(1), id(2)],
      limit: 100,
    });

    const call: FindByCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(idsOf(call.query["upstreamDataAssetId"])).toEqual([id(1), id(2)]);
    expect(call.query["downstreamDataAssetId"]).toBeUndefined();
  });

  test("a source the column does not know is read as a pipeline's run", async () => {
    const row: DataAssetLineage = new DataAssetLineage();
    row.upstreamDataAssetId = new ObjectID(id(2));
    row.downstreamDataAssetId = new ObjectID(id(1));
    row.source = "Gossip" as DataAssetLineageSource;

    jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([row] as never);

    const rows: Array<DataLineageEdgeRow> =
      await DataTableLineageReader.getDatabaseReader(PROJECT_ID, null).readEdges(
        {
          direction: DataLineageDirection.Upstream,
          dataAssetIds: [id(1)],
          limit: 10,
        },
      );

    expect(rows[0]!.source).toBeNull();
    expect(rows[0]!.lastSeenAt).toBeNull();
  });

  test("many tables are read a chunk at a time, and no more rows than the limit", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockImplementation((async (findBy: FindByCall) => {
        // Each chunk of tables has 300 edges, or as many as it may answer.
        return Array.from({ length: Math.min(300, findBy.limit) }, () => {
          const row: DataAssetLineage = new DataAssetLineage();
          row.upstreamDataAssetId = new ObjectID(id(1));
          row.downstreamDataAssetId = new ObjectID(id(2));

          return row;
        });
      }) as never);

    const ids: Array<string> = Array.from(
      { length: 1700 },
      (_: unknown, index: number): string => {
        return id(index);
      },
    );
    const rows: Array<DataLineageEdgeRow> =
      await DataTableLineageReader.getDatabaseReader(PROJECT_ID, null).readEdges(
        {
          direction: DataLineageDirection.Downstream,
          dataAssetIds: ids,
          limit: 700,
        },
      );

    expect(rows).toHaveLength(700);

    const chunks: Array<FindByCall> = calls(findBy);

    // 500 ids a read, each asking only for the rows still wanted; the fourth chunk is never read.
    expect(
      chunks.map((chunk: FindByCall): [number, number] => {
        return [idsOf(chunk.query["upstreamDataAssetId"]).length, chunk.limit];
      }),
    ).toEqual([
      [500, 700],
      [500, 400],
      [500, 100],
    ]);
  });
});

describe("the tables and pipelines", () => {
  test("tables are the project's own, by id, as the drawing reads them", async () => {
    const asset: DataAsset = new DataAsset();
    asset._id = id(1);
    asset.assetKey = "public.orders";
    asset.name = "orders";
    asset.dataStoreName = "Orders DB";
    asset.assetKind = DataAssetKind.MaterializedView;
    asset.lastChangedAt = new Date("2026-11-10T11:00:00.000Z");
    asset.updateIntervalInSeconds = 900;
    asset.isDropped = false;

    const odd: DataAsset = new DataAsset();
    odd._id = id(2);
    odd.assetKind = "Spreadsheet" as DataAssetKind;

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetService, "findBy")
      .mockResolvedValue([asset, odd] as never);

    const tables: Awaited<ReturnType<DataLineageReader["readTables"]>> =
      await DataTableLineageReader.getDatabaseReader(PROJECT_ID, null).readTables(
        [id(1), id(2)],
      );

    expect(tables).toEqual([
      {
        dataAssetId: id(1),
        assetKey: "public.orders",
        name: "orders",
        database: "Orders DB",
        assetKind: DataAssetKind.MaterializedView,
        lastChangedAt: new Date("2026-11-10T11:00:00.000Z"),
        updateIntervalInSeconds: 900,
        isDropped: false,
      },
      {
        dataAssetId: id(2),
        assetKey: "",
        name: null,
        database: null,
        assetKind: null,
        lastChangedAt: null,
        updateIntervalInSeconds: null,
        isDropped: false,
      },
    ]);

    const call: FindByCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(idsOf(call.query["_id"])).toEqual([id(1), id(2)]);
    expect(call.props).toEqual({ isRoot: true });
    // Never a column the drawing does not show: no columns, no collection state.
    expect(Object.keys(call.select).sort()).toEqual(
      [
        "_id",
        "assetKey",
        "assetKind",
        "dataStoreName",
        "isDropped",
        "lastChangedAt",
        "name",
        "updateIntervalInSeconds",
      ].sort(),
    );
  });

  test("pipelines are the project's own, by id, with how their latest run went", async () => {
    const row: DataPipeline = new DataPipeline();
    row._id = id(9);
    row.jobName = "orders_etl";
    row.jobNamespace = "airflow";
    row.lastRunState = "FAIL";
    row.lastRunStartedAt = new Date("2026-11-10T10:00:00.000Z");
    row.lastErrorMessage = "relation does not exist";

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataPipelineService, "findBy")
      .mockResolvedValue([row] as never);

    expect(
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        null,
      ).readPipelines([id(9)]),
    ).toEqual([
      {
        dataPipelineId: id(9),
        jobName: "orders_etl",
        jobNamespace: "airflow",
        lastRunState: "FAIL",
        lastRunStartedAt: new Date("2026-11-10T10:00:00.000Z"),
        lastErrorMessage: "relation does not exist",
      },
    ]);

    const call: FindByCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(idsOf(call.query["_id"])).toEqual([id(9)]);
    expect(call.props).toEqual({ isRoot: true });
  });
});

describe("the open alerts of the drawn tables", () => {
  const OPEN_STATE: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-000000000001",
  );
  const PUBLIC_ALERT: string = "44444444-4444-4444-8444-000000000001";
  const PRIVATE_ALERT: string = "44444444-4444-4444-8444-000000000002";
  const RESOLVED_ALERT: string = "44444444-4444-4444-8444-000000000003";

  let alertReads: Array<FindByCall>;

  function stubAlerts(): ReturnType<typeof jest.spyOn> {
    const dataAlerts: Array<DataAlert> = [
      [PUBLIC_ALERT, id(1)],
      [PRIVATE_ALERT, id(1)],
      [RESOLVED_ALERT, id(2)],
    ].map(([alertId, assetId]: Array<string>): DataAlert => {
      const row: DataAlert = new DataAlert();
      row.alertId = new ObjectID(alertId!);
      row.dataAssetId = new ObjectID(assetId!);

      return row;
    });

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([OPEN_STATE] as never);

    alertReads = [];

    jest.spyOn(AlertService, "findBy").mockImplementation((async (
      findBy: FindByCall,
    ): Promise<Array<Alert>> => {
      alertReads.push(findBy);

      // The two open ones; the private one only when no clause keeps it out.
      const clause: unknown = findBy.query["isPrivate"];
      const open: Array<string> = [PUBLIC_ALERT];

      if (clause === undefined) {
        open.push(PRIVATE_ALERT);
      } else {
        expect(clause).toBeInstanceOf(FindOperator);
      }

      return open.map((alertId: string): Alert => {
        const alert: Alert = new Alert();
        alert._id = alertId;

        return alert;
      });
    }) as never);

    return jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue(dataAlerts as never);
  }

  test("each table's open alerts are counted, read with the project and its unresolved states", async () => {
    const dataAlertRead: ReturnType<typeof jest.spyOn> = stubAlerts();

    const counts: Map<string, number> =
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        person(OTHER_USER, Permission.ProjectAdmin),
      ).readOpenAlertCounts([id(1), id(2)]);

    expect(Array.from(counts.entries())).toEqual([[id(1), 2]]);

    const dataAlertCall: FindByCall = calls(dataAlertRead)[0]!;

    expect(dataAlertCall.query["projectId"]).toBe(PROJECT_ID);
    expect(idsOf(dataAlertCall.query["dataAssetId"])).toEqual([id(1), id(2)]);
    expect(dataAlertCall.props).toEqual({ isRoot: true });
    expect(alertReads).toHaveLength(1);
    expect(alertReads[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(alertReads[0]!.query["_id"]).toBeInstanceOf(FindOperator);
    expect(alertReads[0]!.query["currentAlertStateId"]).toBeInstanceOf(
      FindOperator,
    );
    // A project admin sees every private alert: no clause.
    expect(alertReads[0]!.query["isPrivate"]).toBeUndefined();
  });

  test("a member who does not own a private alert does not have it counted", async () => {
    stubAlerts();

    const counts: Map<string, number> =
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        person(OTHER_USER, Permission.ProjectMember),
      ).readOpenAlertCounts([id(1), id(2)]);

    expect(counts.get(id(1))).toBe(1);

    const clause: FindOperator<unknown> = alertReads[0]!.query[
      "isPrivate"
    ] as FindOperator<unknown>;

    // Their own clause: the alerts that are not private, or that they own.
    expect(clause.getSql!("c")).toContain('"AlertOwnerUser"');
    expect(Object.values(clause.objectLiteralParameters || {})).toEqual([
      OTHER_USER.toString(),
    ]);
  });

  test("someone who may read data assets, not alerts, is read as OneUptime with their clause", async () => {
    stubAlerts();

    await DataTableLineageReader.getDatabaseReader(
      PROJECT_ID,
      person(OTHER_USER, Permission.ReadDataAsset),
    ).readOpenAlertCounts([id(1)]);

    expect(alertReads[0]!.props.isRoot).toBe(true);
    expect(alertReads[0]!.query["isPrivate"]).toBeInstanceOf(FindOperator);
  });

  test("nobody in particular, or a read as root, counts no private alert", async () => {
    for (const reader of [null, { isRoot: true, tenantId: PROJECT_ID }]) {
      stubAlerts();

      const counts: Map<string, number> =
        await DataTableLineageReader.getDatabaseReader(
          PROJECT_ID,
          reader,
        ).readOpenAlertCounts([id(1)]);

      expect(counts.get(id(1))).toBe(1);
      expect(
        (alertReads[0]!.query["isPrivate"] as FindOperator<unknown>).getSql!(
          "c",
        ),
      ).toBe("(c IS NULL OR c = FALSE)");

      jest.restoreAllMocks();
    }
  });

  test("no tables, no data alerts, or no open state: nothing more is read", async () => {
    const dataAlertRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue([] as never);
    const alertRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([] as never);
    const states: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([] as never);
    const reader: DataLineageReader = DataTableLineageReader.getDatabaseReader(
      PROJECT_ID,
      null,
    );

    expect((await reader.readOpenAlertCounts([])).size).toBe(0);
    expect(dataAlertRead).not.toHaveBeenCalled();

    expect((await reader.readOpenAlertCounts([id(1)])).size).toBe(0);
    expect(dataAlertRead).toHaveBeenCalledTimes(1);
    expect(states).not.toHaveBeenCalled();
    expect(alertRead).not.toHaveBeenCalled();

    const row: DataAlert = new DataAlert();
    row.alertId = new ObjectID(PUBLIC_ALERT);
    row.dataAssetId = new ObjectID(id(1));
    dataAlertRead.mockResolvedValue([row] as never);

    expect((await reader.readOpenAlertCounts([id(1)])).size).toBe(0);
    expect(alertRead).not.toHaveBeenCalled();
  });
});

describe("the dashboards", () => {
  test("built on the tables, the project's own, by name, with how many there are in all", async () => {
    const dashboard: DataDashboard = new DataDashboard();
    dashboard._id = id(50);
    dashboard.name = "Revenue";
    dashboard.tool = "Metabase" as DataDashboard["tool"];
    dashboard.url = "https://metabase.example.com/dashboard/1";
    dashboard.dataAssets = [id(1), id(77)].map((assetId: string): DataAsset => {
      const asset: DataAsset = new DataAsset();
      asset._id = assetId;

      return asset;
    });

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([dashboard] as never);
    const countBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataDashboardService, "countBy")
      .mockResolvedValue(new PositiveNumber(31) as never);

    const found: Awaited<ReturnType<DataLineageReader["readDashboards"]>> =
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        null,
      ).readDashboards({ dataAssetIds: [id(1), id(2)], limit: 25 });

    expect(found).toEqual({
      dashboards: [
        {
          dataDashboardId: id(50),
          name: "Revenue",
          tool: "Metabase",
          url: "https://metabase.example.com/dashboard/1",
          // Only the tables it was asked about.
          dataAssetIds: [id(1)],
        },
      ],
      total: 31,
    });

    const call: FindByCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.query["_id"]).toBeInstanceOf(FindOperator);
    expect(call.sort).toEqual({ name: SortOrder.Ascending });
    expect(call.limit).toBe(25);
    expect(call.props).toEqual({ isRoot: true });
    expect(
      (countBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
        "projectId"
      ],
    ).toBe(PROJECT_ID);
  });

  test("no tables to ask about: nothing is read", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataDashboardService,
      "findBy",
    );

    expect(
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        null,
      ).readDashboards({ dataAssetIds: [], limit: 25 }),
    ).toEqual({ dashboards: [], total: 0 });
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("a table's lineage, read from the database", () => {
  test("a table that is not the project's is no lineage, and nothing else is read", async () => {
    const tableRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetService, "findBy")
      .mockResolvedValue([] as never);
    const edgeRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetLineageService,
      "findBy",
    );

    expect(
      await DataTableLineageReader.read({
        projectId: PROJECT_ID,
        dataAssetId: new ObjectID(id(1)),
        depth: 3,
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(OTHER_USER, Permission.ProjectMember),
      }),
    ).toBeNull();
    expect(calls(tableRead)[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(edgeRead).not.toHaveBeenCalled();
  });

  test("walks the project's lineage both ways and draws what it found", async () => {
    const focus: DataAsset = new DataAsset();
    focus._id = id(1);
    focus.assetKey = "analytics.orders";
    focus.assetKind = DataAssetKind.Table;

    const source: DataAsset = new DataAsset();
    source._id = id(2);
    source.assetKey = "raw.orders";
    source.assetKind = DataAssetKind.Table;

    jest
      .spyOn(DataAssetService, "findBy")
      .mockImplementation((async (findBy: FindByCall) => {
        const asked: Array<string> = idsOf(findBy.query["_id"]);

        return [focus, source].filter((asset: DataAsset): boolean => {
          return asked.includes(asset._id!);
        });
      }) as never);

    const edgeRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockImplementation((async (findBy: FindByCall) => {
        const into: unknown = findBy.query["downstreamDataAssetId"];

        if (into && idsOf(into).includes(id(1))) {
          const row: DataAssetLineage = new DataAssetLineage();
          row.upstreamDataAssetId = new ObjectID(id(2));
          row.downstreamDataAssetId = new ObjectID(id(1));

          return [row];
        }

        return [];
      }) as never);

    jest.spyOn(DataPipelineService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(DataAlertService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(DataDashboardService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const lineage: DataTableLineage | null = await DataTableLineageReader.read({
      projectId: PROJECT_ID,
      dataAssetId: new ObjectID(id(1)),
      depth: 2,
      now: new Date("2026-11-10T12:00:00.000Z"),
      reader: person(OTHER_USER, Permission.ProjectMember),
    });

    expect(
      lineage?.nodes.map((node) => {
        return node.name;
      }),
    ).toEqual(["analytics.orders", "raw.orders"]);
    expect(lineage?.edges).toHaveLength(1);

    // Every read of the edges named the project.
    for (const call of calls(edgeRead)) {
      expect(call.query["projectId"]).toBe(PROJECT_ID);
    }
  });
});
