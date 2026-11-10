import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataAlertLineageReader, {
  DataAlertLineageRow,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataTableLineageReader, {
  DataLineageEdgeRow,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataAlertLineageAnswer,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserType from "../../../../Types/UserType";

/*
 * What a data alert's lineage reads of its alerts, and as whom
 * (DataAlertLineageReader's database reader), and what a pipeline's
 * lineage reads of its rows. Every alert is read as OneUptime with the
 * clause of the person who asked - the clause the data alerts' own reads
 * put on them (DataAlertService) - so an alert they may not see, or one
 * caused by an alert they may not see, is never read for them: its table is
 * never picked out, nor counted among what an alert caused. For nobody in
 * particular, or a read as root, the clause of no one: no private alert.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000003");
const ALERT: string = "44444444-4444-4444-8444-000000000001";
const CAUSE: string = "44444444-4444-4444-8444-000000000002";

function id(index: number): string {
  return `00000001-0000-4000-8000-${index.toString().padStart(12, "0")}`;
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

type FindCall = {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  props: DatabaseCommonInteractionProps;
};

function calls(spy: ReturnType<typeof jest.spyOn>): Array<FindCall> {
  return spy.mock.calls.map((call: Array<unknown>): FindCall => {
    return call[0] as FindCall;
  });
}

// A query value's operators: the two halves of an And, or the one.
function partsOf(value: unknown): Array<FindOperator<unknown>> {
  expect(value).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = value as FindOperator<unknown>;

  return operator.type === "and"
    ? (operator.value as unknown as Array<FindOperator<unknown>>)
    : [operator];
}

// A query value that names one id and puts a privacy clause beside it.
function idAndClause(value: unknown): {
  id: string;
  clause: FindOperator<unknown>;
} {
  const parts: Array<FindOperator<unknown>> = partsOf(value);

  expect(parts).toHaveLength(2);
  expect(parts[0]!.type).toBe("equal");
  expect(parts[1]!.type).toBe("raw");

  return { id: String(parts[0]!.value), clause: parts[1]! };
}

function sqlOf(clause: FindOperator<unknown>): string {
  return clause.getSql!("c");
}

// The clause of a person who owns what they may see of the private alerts.
function expectOwnerClause(clause: FindOperator<unknown>): void {
  expect(sqlOf(clause)).toContain('"AlertOwnerUser"');
  expect(sqlOf(clause)).toContain('"AlertOwnerTeam"');
  expect(Object.values(clause.objectLiteralParameters || {})).toEqual([
    MEMBER.toString(),
  ]);
}

// The clause of no one: no private alert at all.
function expectNoOneClause(clause: FindOperator<unknown>): void {
  expect(sqlOf(clause)).toContain(
    'a."isPrivate" IS NULL OR a."isPrivate" = FALSE',
  );
  expect(sqlOf(clause)).not.toContain('"AlertOwnerUser"');
}

function dataAlert(fields: {
  alertId: string;
  dataAssetId?: string;
  dataPipelineId?: string;
  dataStoreId?: string;
  causeAlertId?: string;
}): DataAlert {
  const row: DataAlert = new DataAlert();
  row.alertId = new ObjectID(fields.alertId);

  if (fields.dataAssetId) {
    row.dataAssetId = new ObjectID(fields.dataAssetId);
  }

  if (fields.dataPipelineId) {
    row.dataPipelineId = new ObjectID(fields.dataPipelineId);
  }

  if (fields.dataStoreId) {
    row.dataStoreId = new ObjectID(fields.dataStoreId);
  }

  if (fields.causeAlertId) {
    row.causeAlertId = new ObjectID(fields.causeAlertId);
  }

  return row;
}

const SELECT_ROW: Record<string, boolean> = {
  alertId: true,
  dataAssetId: true,
  dataPipelineId: true,
  dataStoreId: true,
  causeAlertId: true,
};

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the alert's own row", () => {
  test("a project admin: the alert by id, the project's own, read as OneUptime, with no clause", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(
        dataAlert({
          alertId: ALERT,
          dataAssetId: id(1),
          dataStoreId: id(9),
          causeAlertId: CAUSE,
        }) as never,
      );

    const row: DataAlertLineageRow | null =
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectAdmin),
      ).readAlert(ALERT);

    expect(row).toEqual({
      alertId: ALERT,
      dataAssetId: id(1),
      dataPipelineId: null,
      dataStoreId: id(9),
      causeAlertId: CAUSE,
    });

    const call: FindCall = calls(findOne)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(String(call.query["alertId"])).toBe(ALERT);
    expect(call.query["causeAlertId"]).toBeUndefined();
    expect(call.select).toEqual(SELECT_ROW);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("a member: the alert and the alert it is a consequence of, each theirs to see", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(null as never);

    expect(
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readAlert(ALERT),
    ).toBeNull();

    const call: FindCall = calls(findOne)[0]!;
    const own: { id: string; clause: FindOperator<unknown> } = idAndClause(
      call.query["alertId"],
    );

    expect(own.id).toBe(ALERT);
    expectOwnerClause(own.clause);

    // Its cause: none, or one they may see.
    const cause: FindOperator<unknown> = partsOf(
      call.query["causeAlertId"],
    )[0]!;

    expect(sqlOf(cause)).toMatch(/^\(c IS NULL OR c IN /);
    expectOwnerClause(cause);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("someone who may read data, not alerts, is read as OneUptime with their clause", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(null as never);

    await DataAlertLineageReader.getDatabaseAlertReader(
      PROJECT_ID,
      person(MEMBER, Permission.ReadDataAsset),
    ).readAlert(ALERT);

    const call: FindCall = calls(findOne)[0]!;

    expectOwnerClause(idAndClause(call.query["alertId"]).clause);
    expect(call.props.isRoot).toBe(true);
  });

  test("nobody in particular, or a read as root: no private alert, nor one a private alert caused", async () => {
    for (const reader of [null, { isRoot: true, tenantId: PROJECT_ID }]) {
      const findOne: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataAlertService, "findOneBy")
        .mockResolvedValue(null as never);

      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        reader,
      ).readAlert(ALERT);

      const call: FindCall = calls(findOne)[0]!;

      expectNoOneClause(idAndClause(call.query["alertId"]).clause);

      const cause: FindOperator<unknown> = partsOf(
        call.query["causeAlertId"],
      )[0]!;

      expect(sqlOf(cause)).toMatch(/^\(c IS NULL OR c IN /);
      expectNoOneClause(cause);

      jest.restoreAllMocks();
    }
  });
});

describe("what its cause is about", () => {
  test("the cause by id, theirs to see; its own cause is not asked about", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(
        dataAlert({ alertId: CAUSE, dataPipelineId: id(7) }) as never,
      );

    const row: DataAlertLineageRow | null =
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readSubject(CAUSE);

    expect(row).toEqual({
      alertId: CAUSE,
      dataAssetId: null,
      dataPipelineId: id(7),
      dataStoreId: null,
      causeAlertId: null,
    });

    const call: FindCall = calls(findOne)[0]!;
    const subject: { id: string; clause: FindOperator<unknown> } = idAndClause(
      call.query["alertId"],
    );

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(subject.id).toBe(CAUSE);
    expectOwnerClause(subject.clause);
    expect(call.query["causeAlertId"]).toBeUndefined();
    expect(call.select).toEqual(SELECT_ROW);
    expect(call.props).toEqual({ isRoot: true });
  });
});

describe("the alerts it caused", () => {
  test("the ones they may see, the first first, counted no further when fewer than asked for", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue([
        dataAlert({
          alertId: "44444444-4444-4444-8444-000000000010",
          dataAssetId: id(3),
          causeAlertId: ALERT,
        }),
      ] as never);
    const countBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAlertService,
      "countBy",
    );

    const read: { rows: Array<DataAlertLineageRow>; total: number } =
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readConsequences({ alertId: ALERT, limit: 50 });

    expect(read.total).toBe(1);
    expect(
      read.rows.map((row: DataAlertLineageRow): string | null => {
        return row.dataAssetId;
      }),
    ).toEqual([id(3)]);
    expect(countBy).not.toHaveBeenCalled();

    const call: FindCall = calls(findBy)[0]!;
    const cause: { id: string; clause: FindOperator<unknown> } = idAndClause(
      call.query["causeAlertId"],
    );

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(cause.id).toBe(ALERT);
    expectOwnerClause(cause.clause);
    // Each one theirs to see.
    expectOwnerClause(partsOf(call.query["alertId"])[0]!);
    expect(call.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(call.limit).toBe(50);
    expect(call.skip).toBe(0);
    expect(call.select).toEqual(SELECT_ROW);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("as many as asked for: the rest counted, with the same clause", async () => {
    jest.spyOn(DataAlertService, "findBy").mockResolvedValue([
      dataAlert({
        alertId: "44444444-4444-4444-8444-000000000010",
        dataAssetId: id(3),
        causeAlertId: ALERT,
      }),
      dataAlert({
        alertId: "44444444-4444-4444-8444-000000000011",
        dataPipelineId: id(4),
        causeAlertId: ALERT,
      }),
    ] as never);

    const countBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(73) as never);

    const read: { rows: Array<DataAlertLineageRow>; total: number } =
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readConsequences({ alertId: ALERT, limit: 2 });

    expect(read.total).toBe(73);
    expect(read.rows).toHaveLength(2);

    const call: FindCall = calls(countBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(idAndClause(call.query["causeAlertId"]).id).toBe(ALERT);
    expectOwnerClause(idAndClause(call.query["causeAlertId"]).clause);
    expectOwnerClause(partsOf(call.query["alertId"])[0]!);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("a project admin: every one, by the alert it is a consequence of", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue([] as never);

    expect(
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectOwner),
      ).readConsequences({ alertId: ALERT, limit: 50 }),
    ).toEqual({ rows: [], total: 0 });

    const call: FindCall = calls(findBy)[0]!;

    expect(String(call.query["causeAlertId"])).toBe(ALERT);
    expect(call.query["alertId"]).toBeUndefined();
  });

  test("nobody in particular: none that is private, nor any when it is", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findBy")
      .mockResolvedValue([] as never);

    await DataAlertLineageReader.getDatabaseAlertReader(
      PROJECT_ID,
      null,
    ).readConsequences({ alertId: ALERT, limit: 50 });

    const call: FindCall = calls(findBy)[0]!;

    expectNoOneClause(partsOf(call.query["alertId"])[0]!);
    expectNoOneClause(idAndClause(call.query["causeAlertId"]).clause);
  });
});

describe("a pipeline's rows", () => {
  test("every row of the pipeline, the project's own, newest first, as OneUptime", async () => {
    const reads: DataAssetLineage = new DataAssetLineage();
    reads.upstreamDataAssetId = new ObjectID(id(1));
    reads.downstreamDataAssetId = new ObjectID(id(2));
    reads.dataPipelineId = new ObjectID(id(7));
    reads.source = DataAssetLineageSource.Pipeline;
    reads.lastSeenAt = new Date("2026-11-10T10:00:00.000Z");

    const writesRow: DataAssetLineage = new DataAssetLineage();
    writesRow.downstreamDataAssetId = new ObjectID(id(2));
    writesRow.dataPipelineId = new ObjectID(id(7));
    writesRow.lastSeenAt = new Date("2026-11-10T09:00:00.000Z");

    // A row with no table it lands in is no row a drawing can use.
    const broken: DataAssetLineage = new DataAssetLineage();
    broken.dataPipelineId = new ObjectID(id(7));

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([reads, writesRow, broken] as never);

    const rows: Array<DataLineageEdgeRow> =
      await DataTableLineageReader.getDatabaseReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readPipelineEdges({ dataPipelineId: id(7), limit: 5000 });

    expect(rows).toEqual([
      {
        upstreamDataAssetId: id(1),
        downstreamDataAssetId: id(2),
        dataPipelineId: id(7),
        source: DataAssetLineageSource.Pipeline,
        lastSeenAt: new Date("2026-11-10T10:00:00.000Z"),
      },
      {
        upstreamDataAssetId: null,
        downstreamDataAssetId: id(2),
        dataPipelineId: id(7),
        source: null,
        lastSeenAt: new Date("2026-11-10T09:00:00.000Z"),
      },
    ]);

    const call: FindCall = calls(findBy)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(String(call.query["dataPipelineId"])).toBe(id(7));
    expect(Object.keys(call.query).sort()).toEqual([
      "dataPipelineId",
      "projectId",
    ]);
    expect(call.select).toEqual({
      upstreamDataAssetId: true,
      downstreamDataAssetId: true,
      dataPipelineId: true,
      source: true,
      lastSeenAt: true,
    });
    expect(call.sort).toEqual({ lastSeenAt: SortOrder.Descending });
    expect(call.limit).toBe(5000);
    expect(call.skip).toBe(0);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("a pipeline that is not the project's is no lineage, and none of its rows is read", async () => {
    const pipelineRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataPipelineService, "findBy")
      .mockResolvedValue([] as never);
    const edgeRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetLineageService,
      "findBy",
    );

    expect(
      await DataTableLineageReader.readPipeline({
        projectId: PROJECT_ID,
        dataPipelineId: new ObjectID(id(7)),
        depth: 1,
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(MEMBER, Permission.ProjectMember),
      }),
    ).toBeNull();
    expect(calls(pipelineRead)[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(edgeRead).not.toHaveBeenCalled();
  });
});

describe("an alert's lineage, read from the database", () => {
  test("an alert its reader may not see is no answer, and nothing else is read", async () => {
    jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(null as never);

    const consequenceRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAlertService,
      "findBy",
    );
    const edgeRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetLineageService,
      "findBy",
    );
    const tableRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAssetService,
      "findBy",
    );

    expect(
      await DataAlertLineageReader.read({
        projectId: PROJECT_ID,
        alertId: new ObjectID(ALERT),
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(MEMBER, Permission.ProjectMember),
      }),
    ).toBeNull();
    expect(consequenceRead).not.toHaveBeenCalled();
    expect(edgeRead).not.toHaveBeenCalled();
    expect(tableRead).not.toHaveBeenCalled();
  });

  test("reads its alerts, then its table's lineage, and picks out the way to its cause", async () => {
    const reader: DatabaseCommonInteractionProps = person(
      MEMBER,
      Permission.ProjectAdmin,
    );

    jest.spyOn(DataAlertService, "findOneBy").mockImplementation((async (
      findOne: FindCall,
    ): Promise<DataAlert | null> => {
      const asked: string = String(findOne.query["alertId"]);

      if (asked === ALERT) {
        return dataAlert({
          alertId: ALERT,
          dataAssetId: id(1),
          causeAlertId: CAUSE,
        });
      }

      return asked === CAUSE
        ? dataAlert({ alertId: CAUSE, dataAssetId: id(2) })
        : null;
    }) as never);
    jest.spyOn(DataAlertService, "findBy").mockResolvedValue([] as never);

    const tables: Array<DataAsset> = [1, 2].map((index: number): DataAsset => {
      const asset: DataAsset = new DataAsset();
      asset._id = id(index);
      asset.assetKey = `analytics.table_${index}`;
      asset.assetKind = DataAssetKind.Table;

      return asset;
    });

    jest.spyOn(DataAssetService, "findBy").mockImplementation((async (
      findBy: FindCall,
    ): Promise<Array<DataAsset>> => {
      const asked: string = JSON.stringify(findBy.query["_id"]);

      return tables.filter((asset: DataAsset): boolean => {
        return asked.includes(asset._id!);
      });
    }) as never);

    const edgeRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockImplementation((async (
        findBy: FindCall,
      ): Promise<Array<DataAssetLineage>> => {
        const into: string = JSON.stringify(
          findBy.query["downstreamDataAssetId"] || null,
        );

        if (into.includes(id(1))) {
          const row: DataAssetLineage = new DataAssetLineage();
          row.upstreamDataAssetId = new ObjectID(id(2));
          row.downstreamDataAssetId = new ObjectID(id(1));

          return [row];
        }

        return [];
      }) as never);

    jest.spyOn(DataPipelineService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(DataDashboardService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.read({
        projectId: PROJECT_ID,
        alertId: new ObjectID(ALERT),
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader,
      });

    expect(answer).toMatchObject({
      hasCause: true,
      isCauseDrawn: true,
      consequenceCount: 0,
      drawnConsequenceCount: 0,
    });
    expect(answer!.lineage!.focusNodeId).toBe(getLineageTableNodeId(id(1)));
    expect(answer!.lineage!.highlight!.causeNodeIds).toEqual([
      getLineageTableNodeId(id(2)),
    ]);

    // Every read of the lineage named the project.
    expect(edgeRead).toHaveBeenCalled();

    for (const call of calls(edgeRead)) {
      expect(call.query["projectId"]).toBe(PROJECT_ID);
    }
  });
});
