import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";
import CommonAPI from "../../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataAlertLineageReader, {
  DataAlertLineageRow,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataTableLineageReader, {
  DataLineageEdgeRow,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import {
  COLUMN_CHECK_TYPES,
  DataCheckType,
} from "../../../../Types/DataObservability/DataCheckType";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAlertLineageAnswer,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
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
 *
 * The column an alert's check reads is read only once the alert was found
 * theirs to see: the alert's monitor, then the check on that monitor
 * (DataCheckAlerts keeps DataCheck.monitorId), each the project's own.
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

const MONITOR: string = "66666666-6666-4666-8666-000000000001";

function alertOfMonitor(monitorId: string | null): Alert {
  const alert: Alert = new Alert();

  if (monitorId) {
    alert.monitorId = new ObjectID(monitorId);
  }

  return alert;
}

function check(fields: {
  checkType: DataCheckType;
  columnName?: string;
}): DataCheck {
  const row: DataCheck = new DataCheck();
  row.checkType = fields.checkType;

  if (fields.columnName !== undefined) {
    row.columnName = fields.columnName;
  }

  return row;
}

describe("the column its check reads", () => {
  test("the alert's monitor, then the check on that monitor: each the project's own, read as OneUptime", async () => {
    const monitorRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alertOfMonitor(MONITOR) as never);
    const checkRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataCheckService, "findOneBy")
      .mockResolvedValue(
        check({
          checkType: DataCheckType.NullPercent,
          columnName: "customer_id",
        }) as never,
      );

    expect(
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        person(MEMBER, Permission.ProjectMember),
      ).readCheckColumn(ALERT),
    ).toBe("customer_id");

    const monitorCall: FindCall = calls(monitorRead)[0]!;

    expect(monitorCall.query["projectId"]).toBe(PROJECT_ID);
    expect(String(monitorCall.query["_id"])).toBe(ALERT);
    expect(Object.keys(monitorCall.query).sort()).toEqual(["_id", "projectId"]);
    expect(monitorCall.select).toEqual({ monitorId: true });
    expect(monitorCall.props).toEqual({ isRoot: true });

    const checkCall: FindCall = calls(checkRead)[0]!;

    expect(checkCall.query["projectId"]).toBe(PROJECT_ID);
    expect(String(checkCall.query["monitorId"])).toBe(MONITOR);
    expect(Object.keys(checkCall.query).sort()).toEqual([
      "monitorId",
      "projectId",
    ]);
    expect(checkCall.select).toEqual({ checkType: true, columnName: true });
    expect(checkCall.props).toEqual({ isRoot: true });
  });

  test("every check on one column names it; a check on the whole table does not, whatever column it kept", async () => {
    const reader: ReturnType<
      typeof DataAlertLineageReader.getDatabaseAlertReader
    > = DataAlertLineageReader.getDatabaseAlertReader(PROJECT_ID, null);

    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alertOfMonitor(MONITOR) as never);

    const checkRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataCheckService,
      "findOneBy",
    );

    for (const checkType of Object.values(DataCheckType)) {
      checkRead.mockResolvedValueOnce(
        check({ checkType, columnName: "customer_id" }) as never,
      );

      const expected: string | null =
        COLUMN_CHECK_TYPES.includes(checkType) ||
        checkType === DataCheckType.DbtTest
          ? "customer_id"
          : null;

      expect({
        checkType,
        column: await reader.readCheckColumn(ALERT),
      }).toEqual({ checkType, column: expected });
    }
  });

  test("a dbt test of no one column, and a check that names none: no column", async () => {
    const reader: ReturnType<
      typeof DataAlertLineageReader.getDatabaseAlertReader
    > = DataAlertLineageReader.getDatabaseAlertReader(PROJECT_ID, null);

    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alertOfMonitor(MONITOR) as never);
    jest
      .spyOn(DataCheckService, "findOneBy")
      .mockResolvedValueOnce(
        check({ checkType: DataCheckType.DbtTest }) as never,
      )
      .mockResolvedValueOnce(
        check({ checkType: DataCheckType.Maximum, columnName: "   " }) as never,
      );

    expect(await reader.readCheckColumn(ALERT)).toBeNull();
    expect(await reader.readCheckColumn(ALERT)).toBeNull();
  });

  test("the column as the check names it, without the spaces around it", async () => {
    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alertOfMonitor(MONITOR) as never);
    jest.spyOn(DataCheckService, "findOneBy").mockResolvedValue(
      check({
        checkType: DataCheckType.DistinctCount,
        columnName: "  CUSTOMER_ID ",
      }) as never,
    );

    expect(
      await DataAlertLineageReader.getDatabaseAlertReader(
        PROJECT_ID,
        null,
      ).readCheckColumn(ALERT),
    ).toBe("CUSTOMER_ID");
  });

  test("an alert from no monitor, one not the project's, or a monitor no check is on: no column", async () => {
    const reader: ReturnType<
      typeof DataAlertLineageReader.getDatabaseAlertReader
    > = DataAlertLineageReader.getDatabaseAlertReader(PROJECT_ID, null);
    const monitorRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValueOnce(alertOfMonitor(null) as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(alertOfMonitor(MONITOR) as never);
    const checkRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataCheckService, "findOneBy")
      .mockResolvedValue(null as never);

    expect(await reader.readCheckColumn(ALERT)).toBeNull();
    expect(await reader.readCheckColumn(ALERT)).toBeNull();
    // No check was read for the two with no monitor.
    expect(checkRead).not.toHaveBeenCalled();
    expect(await reader.readCheckColumn(ALERT)).toBeNull();
    expect(checkRead).toHaveBeenCalledTimes(1);
    expect(monitorRead).toHaveBeenCalledTimes(3);
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
    // Nor what its check reads: that is asked only of an alert theirs to see.
    const monitorRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AlertService,
      "findOneBy",
    );
    const checkRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataCheckService,
      "findOneBy",
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
    expect(monitorRead).not.toHaveBeenCalled();
    expect(checkRead).not.toHaveBeenCalled();
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
    // Its alert came from no check: no column, and no column read.
    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(new Alert() as never);

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
      column: null,
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

/*
 * WHETHER THE ALERT ITSELF IS OPEN, SAID WITH ITS DRAWING (#6851). Its own
 * table's card counts the table's open alerts, the alert itself among them
 * while it is open - which the card already says (This alert) - so the
 * answer says whether it is, read with the drawing, by the rule the count
 * goes by: a state the project does not count as resolved. Asked only when
 * that card counts any.
 */
const OPEN_STATE: string = "77777777-7777-4777-8777-000000000001";
const RESOLVED_STATE: string = "77777777-7777-4777-8777-000000000002";

function alertInState(stateId: string | null): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT;

  if (stateId) {
    alert.currentAlertStateId = new ObjectID(stateId);
  }

  return alert;
}

describe("whether the alert is open", () => {
  test("an alert in a state the project does not count as resolved is open: its state read by id, the project's own, as OneUptime", async () => {
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alertInState(OPEN_STATE) as never);
    const states: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([new ObjectID(OPEN_STATE)] as never);

    expect(
      await DataAlertLineageReader.readIsAlertOpen(
        PROJECT_ID,
        new ObjectID(ALERT),
      ),
    ).toBe(true);

    const call: FindCall = calls(findOne)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(String(call.query["_id"])).toBe(ALERT);
    expect(call.select).toEqual({ currentAlertStateId: true });
    expect(call.props).toEqual({ isRoot: true });
    expect(states).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("an alert in a resolved state, or in none, is not open", async () => {
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([new ObjectID(OPEN_STATE)] as never);
    const findOne: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValueOnce(alertInState(RESOLVED_STATE) as never)
      .mockResolvedValueOnce(alertInState(null) as never);

    expect(
      await DataAlertLineageReader.readIsAlertOpen(
        PROJECT_ID,
        new ObjectID(ALERT),
      ),
    ).toBe(false);
    expect(
      await DataAlertLineageReader.readIsAlertOpen(
        PROJECT_ID,
        new ObjectID(ALERT),
      ),
    ).toBe(false);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  test("an alert that is not there says nothing: neither open nor not, and no state is read", async () => {
    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null as never);
    const states: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AlertStateService,
      "getUnresolvedAlertStateIds",
    );

    expect(
      await DataAlertLineageReader.readIsAlertOpen(
        PROJECT_ID,
        new ObjectID(ALERT),
      ),
    ).toBeNull();
    expect(states).not.toHaveBeenCalled();
  });

  /*
   * A WAREHOUSE WITH THE ALERT OPEN ON ITS TABLE: the alert on
   * analytics.table_1, built from analytics.table_2. The table's data
   * alerts are the alert itself, when `counted`; every alert read is in
   * the open state. The alert's own state is `stateId`.
   */
  function storeOpenAlert(data: { counted: boolean; stateId: string | null }): {
    stateRead: ReturnType<typeof jest.spyOn>;
  } {
    jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(
        dataAlert({ alertId: ALERT, dataAssetId: id(1) }) as never,
      );
    jest.spyOn(DataAlertService, "findBy").mockImplementation((async (
      findBy: FindCall,
    ): Promise<Array<DataAlert>> => {
      // The table's data alerts, which its card counts; never what the alert caused.
      if (data.counted && findBy.query["dataAssetId"] !== undefined) {
        return [dataAlert({ alertId: ALERT, dataAssetId: id(1) })];
      }

      return [];
    }) as never);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([new ObjectID(OPEN_STATE)] as never);
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([alertInState(OPEN_STATE)] as never);

    const stateRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation((async (findOne: FindCall): Promise<Alert | null> => {
        // The monitor its check is on: none, so no column is read.
        if (findOne.select?.["monitorId"]) {
          return new Alert();
        }

        return alertInState(data.stateId);
      }) as never);

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
    jest.spyOn(DataAssetLineageService, "findBy").mockImplementation((async (
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

    return { stateRead };
  }

  // The reads of the alert's own state: the ones that select it.
  function stateReads(spy: ReturnType<typeof jest.spyOn>): Array<FindCall> {
    return calls(spy).filter((call: FindCall): boolean => {
      return Boolean(call.select?.["currentAlertStateId"]);
    });
  }

  async function readAnswer(): Promise<DataAlertLineageAnswer> {
    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.read({
        projectId: PROJECT_ID,
        alertId: new ObjectID(ALERT),
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(MEMBER, Permission.ProjectAdmin),
      });

    expect(answer).not.toBeNull();

    return answer!;
  }

  function ownCard(answer: DataAlertLineageAnswer): DataTableLineageNode {
    const own: DataTableLineageNode | undefined = answer.lineage!.nodes.find(
      (node: DataTableLineageNode): boolean => {
        return node.id === answer.lineage!.focusNodeId;
      },
    );

    expect(own).toBeDefined();

    return own!;
  }

  test("the drawing of an open alert says it is open, beside its own table's count of one open alert: the alert itself", async () => {
    const stored: { stateRead: ReturnType<typeof jest.spyOn> } = storeOpenAlert(
      { counted: true, stateId: OPEN_STATE },
    );

    const answer: DataAlertLineageAnswer = await readAnswer();

    expect(ownCard(answer).id).toBe(getLineageTableNodeId(id(1)));
    expect(ownCard(answer).openAlertCount).toBe(1);
    expect(answer.isAlertOpen).toBe(true);
    expect(stateReads(stored.stateRead)).toHaveLength(1);
  });

  test("a resolved alert's drawing says it is not: the open alert its table counts is another", async () => {
    storeOpenAlert({ counted: true, stateId: RESOLVED_STATE });

    const answer: DataAlertLineageAnswer = await readAnswer();

    expect(ownCard(answer).openAlertCount).toBe(1);
    expect(answer.isAlertOpen).toBe(false);
  });

  test("when its table's card counts no open alert, nothing is asked and nothing said", async () => {
    const stored: { stateRead: ReturnType<typeof jest.spyOn> } = storeOpenAlert(
      { counted: false, stateId: OPEN_STATE },
    );

    const answer: DataAlertLineageAnswer = await readAnswer();

    expect(ownCard(answer).openAlertCount || 0).toBe(0);
    expect("isAlertOpen" in answer).toBe(false);
    expect(stateReads(stored.stateRead)).toEqual([]);
  });

  test("an alert gone by the time its state is read: the drawing says nothing of it", async () => {
    storeOpenAlert({ counted: true, stateId: OPEN_STATE });
    jest.spyOn(AlertService, "findOneBy").mockImplementation((async (
      findOne: FindCall,
    ): Promise<Alert | null> => {
      return findOne.select?.["monitorId"] ? new Alert() : null;
    }) as never);

    const answer: DataAlertLineageAnswer = await readAnswer();

    expect(ownCard(answer).openAlertCount).toBe(1);
    expect("isAlertOpen" in answer).toBe(false);
  });
});

/*
 * A WAREHOUSE IN THE DATABASE'S SHAPE: the alert on analytics.table_1, its
 * monitor's check reading customer_id, built from analytics.table_2 whose
 * arrow names cust_id -> customer_id. Every read answers what it was
 * asked; the reads of the lineage rows that name columns are kept apart.
 */
interface StoredWarehouse {
  edgeRead: ReturnType<typeof jest.spyOn>;
  // The reads of the rows that name columns (columnMappings: not null).
  columnQueries: Array<FindCall>;
  checkRead: ReturnType<typeof jest.spyOn>;
}

// The one alert a read asks for, whether or not a privacy clause sits beside it.
function askedAlertId(value: unknown): string {
  return value instanceof FindOperator ? idAndClause(value).id : String(value);
}

function storeWarehouse(check: DataCheck | null): StoredWarehouse {
  jest.spyOn(DataAlertService, "findOneBy").mockImplementation((async (
    findOne: FindCall,
  ): Promise<DataAlert | null> => {
    return askedAlertId(findOne.query["alertId"]) === ALERT
      ? dataAlert({ alertId: ALERT, dataAssetId: id(1) })
      : null;
  }) as never);
  jest.spyOn(DataAlertService, "findBy").mockResolvedValue([] as never);

  const monitored: Alert = new Alert();
  monitored.monitorId = new ObjectID(MONITOR);

  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(monitored as never);

  const checkRead: ReturnType<typeof jest.spyOn> = jest
    .spyOn(DataCheckService, "findOneBy")
    .mockResolvedValue(check as never);

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

  const columnQueries: Array<FindCall> = [];
  const edgeRead: ReturnType<typeof jest.spyOn> = jest
    .spyOn(DataAssetLineageService, "findBy")
    .mockImplementation((async (
      findBy: FindCall,
    ): Promise<Array<DataAssetLineage>> => {
      const row: DataAssetLineage = new DataAssetLineage();
      row.upstreamDataAssetId = new ObjectID(id(2));
      row.downstreamDataAssetId = new ObjectID(id(1));

      if (findBy.query["columnMappings"] !== undefined) {
        columnQueries.push(findBy);
        row.columnMappings = [
          { upstreamColumn: "cust_id", downstreamColumn: "customer_id" },
        ] as never;

        return [row];
      }

      const into: string = JSON.stringify(
        findBy.query["downstreamDataAssetId"] || null,
      );

      return into.includes(id(1)) ? [row] : [];
    }) as never);

  jest.spyOn(DataPipelineService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(DataDashboardService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  return { edgeRead, columnQueries, checkRead };
}

function arrowInto(answer: DataAlertLineageAnswer): DataTableLineageEdge {
  const edge: DataTableLineageEdge | undefined = answer.lineage!.edges.find(
    (candidate: DataTableLineageEdge): boolean => {
      return (
        candidate.source === getLineageTableNodeId(id(2)) &&
        candidate.target === getLineageTableNodeId(id(1))
      );
    },
  );

  expect(edge).toBeDefined();

  return edge!;
}

describe("a column check's alert, read from the database", () => {
  test("its lineage carries the columns of each arrow it draws, read for the project, with the column its check reads", async () => {
    const stored: StoredWarehouse = storeWarehouse(
      check({
        checkType: DataCheckType.NullPercent,
        columnName: "customer_id",
      }),
    );

    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.read({
        projectId: PROJECT_ID,
        alertId: new ObjectID(ALERT),
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(MEMBER, Permission.ProjectAdmin),
      });

    expect(answer?.column).toBe("customer_id");
    expect(arrowInto(answer!).columnMappings).toEqual([
      { upstreamColumn: "cust_id", downstreamColumn: "customer_id" },
    ]);
    expect(stored.columnQueries).toHaveLength(1);

    const query: Record<string, unknown> = stored.columnQueries[0]!.query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(JSON.stringify(query["upstreamDataAssetId"])).toContain(id(2));
    expect(JSON.stringify(query["downstreamDataAssetId"])).toContain(id(1));
    expect(stored.columnQueries[0]!.props).toEqual({ isRoot: true });
  });

  test("a check on the whole table: the lineage as before, and no row's columns read", async () => {
    const stored: StoredWarehouse = storeWarehouse(
      check({ checkType: DataCheckType.RowCount, columnName: "customer_id" }),
    );

    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.read({
        projectId: PROJECT_ID,
        alertId: new ObjectID(ALERT),
        now: new Date("2026-11-10T12:00:00.000Z"),
        reader: person(MEMBER, Permission.ProjectAdmin),
      });

    expect(answer?.column).toBeNull();
    expect(arrowInto(answer!).columnMappings).toBeUndefined();
    expect(stored.columnQueries).toEqual([]);
    expect(stored.edgeRead).toHaveBeenCalled();
  });
});

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

// The alert-lineage route's own handler, past its session middleware, as the API builds it.
function alertLineageHandler(): RouteHandler {
  const path: string = DATA_OBSERVABILITY_API_ROUTES.alertLineage(":id");
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["post"] === true
    );
  });

  expect(layer?.route?.stack).toHaveLength(3);

  return layer!.route!.stack[2]!.handle;
}

// Asks the route as the Dashboard does: what it sent, or the error it passed on.
async function askRoute(props: DatabaseCommonInteractionProps): Promise<{
  sent: JSONObject | null;
  error: Error | null;
}> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await alertLineageHandler()(
    { body: {}, params: { id: ALERT } } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    sent: sent.mock.calls[0] ? (sent.mock.calls[0][2] as JSONObject) : null,
    error: next.mock.calls[0] ? (next.mock.calls[0][0] as Error) : null,
  };
}

describe("POST /data-observability/alerts/:id/lineage, read from the database", () => {
  test("a column check's alert answers with its column and the columns each arrow carries", async () => {
    storeWarehouse(
      check({
        checkType: DataCheckType.DistinctCount,
        columnName: "customer_id",
      }),
    );

    const alertRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAlertService,
      "findOneBy",
    );

    const asked: { sent: JSONObject | null; error: Error | null } =
      await askRoute(person(MEMBER, Permission.ReadDataAsset));

    expect(asked.error).toBeNull();

    const answer: DataAlertLineageAnswer =
      asked.sent as unknown as DataAlertLineageAnswer;

    expect(answer.column).toBe("customer_id");
    expect(arrowInto(answer).columnMappings).toEqual([
      { upstreamColumn: "cust_id", downstreamColumn: "customer_id" },
    ]);
    // Read for the member who asked: their own clause on the alert itself.
    expect(idAndClause(calls(alertRead)[0]!.query["alertId"]).id).toBe(ALERT);
    expectOwnerClause(
      idAndClause(calls(alertRead)[0]!.query["alertId"]).clause,
    );
  });

  test("a check on the whole table: no column, and no arrow carries any", async () => {
    const stored: StoredWarehouse = storeWarehouse(
      check({ checkType: DataCheckType.CustomSql }),
    );

    const asked: { sent: JSONObject | null; error: Error | null } =
      await askRoute(person(MEMBER, Permission.ProjectMember));
    const answer: DataAlertLineageAnswer =
      asked.sent as unknown as DataAlertLineageAnswer;

    expect(answer.column).toBeNull();
    expect(arrowInto(answer).columnMappings).toBeUndefined();
    expect(stored.columnQueries).toEqual([]);
  });

  test("an alert they may not see is not found: its privacy clause asked first, and no check, column or lineage read", async () => {
    const stored: StoredWarehouse = storeWarehouse(
      check({
        checkType: DataCheckType.NullPercent,
        columnName: "customer_id",
      }),
    );
    const alertRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(null as never);
    const monitorRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AlertService,
      "findOneBy",
    );

    const asked: { sent: JSONObject | null; error: Error | null } =
      await askRoute(person(MEMBER, Permission.ProjectMember));

    expect(asked.sent).toBeNull();
    expect(asked.error).toBeInstanceOf(BadDataException);
    expect(asked.error!.message).toBe("Alert not found.");
    // The member's own clause on the alert they asked about.
    expectOwnerClause(
      idAndClause(calls(alertRead)[0]!.query["alertId"]).clause,
    );
    expect(monitorRead).not.toHaveBeenCalled();
    expect(stored.checkRead).not.toHaveBeenCalled();
    expect(stored.edgeRead).not.toHaveBeenCalled();
    expect(stored.columnQueries).toEqual([]);
  });
});
