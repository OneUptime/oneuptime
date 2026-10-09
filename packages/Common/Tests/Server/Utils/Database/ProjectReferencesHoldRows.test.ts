import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  ProjectScopedReference,
} from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { stubRowsCallerMayWrite } from "../../TestingUtils/RowsCallerMayWrite";

/*
 * WHAT A RECORD ALREADY HOLDS IS WORKED OUT FROM THE ROWS THE UPDATE WRITES.
 *
 * An update may write back a reference its records already hold - one from
 * before references were checked, say - without it being checked again
 * (ProjectReferenceCheck.validateUpdate). Which references count as held is
 * worked out from the records the update writes, and the update is held to
 * those records (getHeldRelationIds, DatabaseService
 * .findRowsAndHoldUpdateToThem): a reference held only by rows the update
 * does not write - rows outside its window, or outside a teammate's reach -
 * is checked like any new one, and a row the exemption was not worked out
 * from is not written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const ROW_IN_FIRST_WINDOW: string = "7b000000-0000-4000-8000-000000000001";
const ROW_A: string = "7b000000-0000-4000-8000-00000000000a";
const ROW_B: string = "7b000000-0000-4000-8000-00000000000b";
const FOREIGN_LABEL: string = "7c000000-0000-4000-8000-0000000000ff";

interface Read {
  query: JSONObject;
  select: JSONObject;
  skip: number;
  limit: number;
}

function monitor(id: string, labelIds: Array<string>): Monitor {
  const row: Monitor = new Monitor();
  row._id = id;
  row.projectId = PROJECT_ID;
  row.labels = labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label._id = labelId;
    return label;
  });
  return row;
}

// The ids an `_id` condition names: a plain id, or "any of" several.
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (!value) {
    return [];
  }

  return Object.values(
    (value as { objectLiteralParameters: JSONObject }).objectLiteralParameters,
  ).flat() as Array<string>;
}

/*
 * The monitors as the database answers: the first window of the query holds
 * a row that carries the foreign label; the update's own window (skip
 * 10000) does not.
 */
function stubMonitors(
  service: DatabaseService<Monitor>,
  pool: Array<Monitor>,
  firstWindow: Array<Monitor>,
): jest.SpyInstance {
  return jest.spyOn(service, "findBy").mockImplementation((async (
    findBy: Read,
  ): Promise<Array<Monitor>> => {
    const named: unknown = findBy.query?.["_id"];

    if (named !== undefined) {
      const ids: Array<string> = idsNamedBy(named);

      return [...pool, ...firstWindow].filter((row: Monitor): boolean => {
        return ids.includes(String(row._id));
      });
    }

    return findBy.skip === 0 ? firstWindow : pool;
  }) as never);
}

function update(
  props: JSONObject,
  window: { skip: number; limit: number },
): UpdateBy<Monitor> {
  return {
    query: { projectId: PROJECT_ID },
    data: { labels: [{ _id: FOREIGN_LABEL }] },
    props: props as unknown as DatabaseCommonInteractionProps,
    skip: window.skip,
    limit: window.limit,
  } as unknown as UpdateBy<Monitor>;
}

describe("ProjectScopedReferenceValidator.getHeldRelationIds", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("works out what is held from the rows in the update's own window, and holds the update to them", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    const findBy: jest.SpyInstance = stubMonitors(
      service,
      [monitor(ROW_A, ["7c000000-0000-4000-8000-000000000001"])],
      [monitor(ROW_IN_FIRST_WINDOW, [FOREIGN_LABEL])],
    );

    const updateBy: UpdateBy<Monitor> = update(
      { isRoot: true, tenantId: PROJECT_ID },
      { skip: 10000, limit: 50 },
    );

    const held: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: service,
        updateBy: updateBy,
        columns: ["labels"],
      });

    // The rows: the update's own window, not the first rows its query matches.
    const rowsRead: Read = findBy.mock.calls[0]![0] as Read;

    expect(rowsRead.skip).toBe(10000);
    expect(rowsRead.limit).toBe(50);

    // The column: read for those rows alone, by id.
    const columnRead: Read = findBy.mock.calls[1]![0] as Read;

    expect(idsNamedBy(columnRead.query["_id"])).toEqual([ROW_A]);
    expect(columnRead.select["labels"]).toEqual({ _id: true });

    expect(
      Array.from(held.get(PROJECT_ID.toString())?.["labels"] || []),
    ).toEqual(["7c000000-0000-4000-8000-000000000001"]);

    // The update writes the row the exemption was worked out from, and no other.
    expect((updateBy.query as JSONObject)["_id"]).toBe(ROW_A);
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(1);
  });

  it("holds nothing as held, and reads no column, when the update writes no row", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const findBy: jest.SpyInstance = stubMonitors(service, [], []);

    const held: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: service,
        updateBy: update(
          { isRoot: true, tenantId: PROJECT_ID },
          { skip: 10000, limit: 50 },
        ),
        columns: ["labels"],
      });

    expect(held.size).toBe(0);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  it("works out what a teammate's update holds from the rows they may write alone", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    const rowA: Monitor = monitor(ROW_A, [FOREIGN_LABEL]);
    const rowOutOfReach: Monitor = monitor(ROW_B, []);

    stubRowsCallerMayWrite(service, () => {
      return [rowA];
    });
    stubMonitors(service, [rowA, rowOutOfReach], []);

    const updateBy: UpdateBy<Monitor> = update(
      {
        tenantId: PROJECT_ID,
        userId: new ObjectID("7d000000-0000-4000-8000-000000000001"),
      },
      { skip: 0, limit: 100 },
    );

    const held: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: service,
        updateBy: updateBy,
        columns: ["labels"],
      });

    expect(
      Array.from(held.get(PROJECT_ID.toString())?.["labels"] || []),
    ).toEqual([FOREIGN_LABEL]);
    expect((updateBy.query as JSONObject)["_id"]).toBe(ROW_A);
  });
});

describe("ProjectReferenceCheck.validateUpdate, for an update of many rows", () => {
  beforeEach(() => {
    // The label is not the project's: only what a record already holds may name it.
    jest
      .spyOn(ProjectScopedReferenceValidator, "getUnavailableReferences")
      .mockImplementation((async (data: {
        references: Array<ProjectScopedReference>;
      }): Promise<Array<ProjectScopedReference>> => {
        return data.references;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a reference that only rows outside the update's window hold", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    stubMonitors(
      service,
      [monitor(ROW_A, [])],
      [monitor(ROW_IN_FIRST_WINDOW, [FOREIGN_LABEL])],
    );

    await expect(
      ProjectReferenceCheck.validateUpdate({
        service: service,
        updateBy: update(
          { isRoot: true, tenantId: PROJECT_ID },
          { skip: 10000, limit: 50 },
        ),
      }),
    ).rejects.toThrow();
  });

  it("lets every row the update writes keep a reference they all hold", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    stubMonitors(
      service,
      [monitor(ROW_A, [FOREIGN_LABEL]), monitor(ROW_B, [FOREIGN_LABEL])],
      [],
    );

    const updateBy: UpdateBy<Monitor> = update(
      { isRoot: true, tenantId: PROJECT_ID },
      { skip: 10000, limit: 50 },
    );

    await ProjectReferenceCheck.validateUpdate({
      service: service,
      updateBy: updateBy,
    });

    expect(idsNamedBy((updateBy.query as JSONObject)["_id"]).sort()).toEqual(
      [ROW_A, ROW_B].sort(),
    );
  });

  it("refuses a reference one row the update writes does not hold", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    stubMonitors(
      service,
      [monitor(ROW_A, [FOREIGN_LABEL]), monitor(ROW_B, [])],
      [],
    );

    await expect(
      ProjectReferenceCheck.validateUpdate({
        service: service,
        updateBy: update(
          { isRoot: true, tenantId: PROJECT_ID },
          { skip: 10000, limit: 50 },
        ),
      }),
    ).rejects.toThrow();
  });

  it("lets a teammate keep a reference their rows hold, whatever rows outside their reach hold, and writes only their rows", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    const rowA: Monitor = monitor(ROW_A, [FOREIGN_LABEL]);

    stubRowsCallerMayWrite(service, () => {
      return [rowA];
    });
    stubMonitors(service, [rowA, monitor(ROW_B, [])], []);

    const updateBy: UpdateBy<Monitor> = update(
      {
        tenantId: PROJECT_ID,
        userId: new ObjectID("7d000000-0000-4000-8000-000000000001"),
      },
      { skip: 0, limit: 100 },
    );

    await ProjectReferenceCheck.validateUpdate({
      service: service,
      updateBy: updateBy,
    });

    expect((updateBy.query as JSONObject)["_id"]).toBe(ROW_A);
  });

  it("reads no row, and leaves the update as it is, when every reference is the project's", async () => {
    (
      ProjectScopedReferenceValidator.getUnavailableReferences as unknown as jest.Mock
    ).mockResolvedValue([]);

    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const findBy: jest.SpyInstance = stubMonitors(service, [], []);

    const updateBy: UpdateBy<Monitor> = update(
      { isRoot: true, tenantId: PROJECT_ID },
      { skip: 10000, limit: 50 },
    );

    await ProjectReferenceCheck.validateUpdate({
      service: service,
      updateBy: updateBy,
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(updateBy.query).toEqual({ projectId: PROJECT_ID });
    expect(updateBy.skip).toBe(10000);
  });
});
