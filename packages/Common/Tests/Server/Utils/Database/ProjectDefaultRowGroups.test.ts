import type DatabaseService from "../../../../Server/Services/DatabaseService";
import ProjectDefaultRow from "../../../../Server/Utils/Database/ProjectDefaultRow";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogSavedView from "../../../../Models/DatabaseModels/LogSavedView";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * ProjectDefaultRow's groups: a kind of row whose default belongs to a group
 * of a project's rows rather than to the whole project. A saved log view is
 * the default of the page it was saved on (its `scope`, issue #5549), so
 * making one the default takes the default from the views of the same page
 * only. Rows whose column is empty are one group, as the whole project
 * always was; kinds that name no group keep one default per project, with
 * the very query they always sent.
 *
 * Driven against a stand-in service that records what it is asked, so the
 * sweep's query is what is pinned; LogSavedViewService's whole create and
 * update over these hooks is driven in ProjectDefaultRowWrites.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5549a000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5549a000-0000-4000-8000-000000000002",
);
const VIEW_ID: ObjectID = new ObjectID("5549a000-0000-4000-8000-0000000000a1");
const SECOND_VIEW_ID: ObjectID = new ObjectID(
  "5549a000-0000-4000-8000-0000000000a2",
);
const THIRD_VIEW_ID: ObjectID = new ObjectID(
  "5549a000-0000-4000-8000-0000000000a3",
);

// What a stand-in service's write and read are called with.
type UpdateByStandIn = (updateBy: unknown) => Promise<number>;
type FindByStandIn = (findBy: unknown) => Promise<Array<BaseModel>>;

interface StandInService {
  service: DatabaseService<BaseModel>;
  updateBy: Mock<UpdateByStandIn>;
  findBy: Mock<FindByStandIn>;
}

function standInService(rows: Array<BaseModel> = []): StandInService {
  const updateBy: Mock<UpdateByStandIn> = jest.fn<UpdateByStandIn>(
    async (): Promise<number> => {
      return 0;
    },
  );
  const findBy: Mock<FindByStandIn> = jest.fn<FindByStandIn>(
    async (): Promise<Array<BaseModel>> => {
      return rows;
    },
  );

  return {
    service: { updateBy, findBy } as unknown as DatabaseService<BaseModel>,
    updateBy,
    findBy,
  };
}

function view(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  scope?: string | undefined;
  isDefault?: boolean | undefined;
}): LogSavedView {
  const item: LogSavedView = new LogSavedView();
  item._id = data.id.toString();

  if (data.projectId) {
    item.projectId = data.projectId;
  }

  if (data.scope !== undefined) {
    item.scope = data.scope;
  }

  if (data.isDefault !== undefined) {
    item.isDefault = data.isDefault;
  }

  return item;
}

function sweepQuery(
  updateBy: Mock<UpdateByStandIn>,
  call: number = 0,
): Record<string, unknown> {
  return (updateBy.mock.calls[call]?.[0] as Record<string, unknown>)[
    "query"
  ] as Record<string, unknown>;
}

function sqlOf(condition: unknown): string {
  expect(condition).toBeInstanceOf(FindOperator);

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return operator.getSql ? operator.getSql("c") : "";
}

describe("ProjectDefaultRow.afterCreate with groups", () => {
  test("sweeps only the rows of the created row's group", async () => {
    const { service, updateBy } = standInService();

    await ProjectDefaultRow.afterCreate({
      service,
      defaultColumn: "isDefault",
      createdItem: view({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        scope: "kubernetes-cluster:prod",
        isDefault: true,
      }),
      groupByColumns: ["scope"],
    });

    expect(updateBy).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = sweepQuery(updateBy);
    expect(query["scope"]).toBe("kubernetes-cluster:prod");
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["isDefault"]).toBe(true);
    expect(JSON.stringify(query["_id"])).toContain(VIEW_ID.toString());
    expect(
      (updateBy.mock.calls[0]?.[0] as Record<string, unknown>)["data"],
    ).toEqual({ isDefault: false });
    expect(
      (updateBy.mock.calls[0]?.[0] as Record<string, unknown>)["props"],
    ).toEqual({ isRoot: true });
  });

  test("a row whose group column is empty sweeps the rows where it is empty: IS NULL", async () => {
    const { service, updateBy } = standInService();

    await ProjectDefaultRow.afterCreate({
      service,
      defaultColumn: "isDefault",
      createdItem: view({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        isDefault: true,
      }),
      groupByColumns: ["scope"],
    });

    expect(sqlOf(sweepQuery(updateBy)["scope"])).toBe("(c IS NULL)");
  });

  test("an empty string in the group column is the empty group too", async () => {
    const { service, updateBy } = standInService();

    await ProjectDefaultRow.afterCreate({
      service,
      defaultColumn: "isDefault",
      createdItem: view({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        scope: "",
        isDefault: true,
      }),
      groupByColumns: ["scope"],
    });

    expect(sqlOf(sweepQuery(updateBy)["scope"])).toBe("(c IS NULL)");
  });

  test("a kind with no groups sweeps the whole project, with the query it always sent", async () => {
    const { service, updateBy } = standInService();

    await ProjectDefaultRow.afterCreate({
      service,
      defaultColumn: "isDefault",
      createdItem: view({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        scope: "kubernetes-cluster:prod",
        isDefault: true,
      }),
    });

    expect(Object.keys(sweepQuery(updateBy)).sort()).toEqual([
      "_id",
      "isDefault",
      "projectId",
    ]);
  });

  test("a row that is not the default sweeps nothing, group or not", async () => {
    const { service, updateBy } = standInService();

    await ProjectDefaultRow.afterCreate({
      service,
      defaultColumn: "isDefault",
      createdItem: view({
        id: VIEW_ID,
        projectId: PROJECT_ID,
        scope: "kubernetes-cluster:prod",
        isDefault: false,
      }),
      groupByColumns: ["scope"],
    });

    expect(updateBy).not.toHaveBeenCalled();
  });
});

describe("ProjectDefaultRow.afterUpdate with groups", () => {
  test("reads the updated rows' group columns with their projects, as root", async () => {
    const { service, findBy } = standInService([
      view({ id: VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
    ]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { isDefault: true } as never,
      updatedItemIds: [VIEW_ID],
      groupByColumns: ["scope"],
    });

    const findArgs: Record<string, unknown> = findBy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(findArgs["select"]).toEqual({
      _id: true,
      projectId: true,
      scope: true,
    });
    expect(findArgs["props"]).toEqual({ isRoot: true });
    expect(findArgs["limit"]).toBe(1);
  });

  test("sweeps each group of each project once, keeping the rows the update made the default", async () => {
    const { service, updateBy } = standInService([
      view({ id: VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
      view({ id: SECOND_VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
      view({ id: THIRD_VIEW_ID, projectId: PROJECT_ID }),
    ]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { isDefault: true } as never,
      updatedItemIds: [VIEW_ID, SECOND_VIEW_ID, THIRD_VIEW_ID],
      groupByColumns: ["scope"],
    });

    expect(updateBy).toHaveBeenCalledTimes(2);

    const hostSweep: Record<string, unknown> = sweepQuery(updateBy, 0);
    expect(hostSweep["scope"]).toBe("host:web-01");
    expect(JSON.stringify(hostSweep["_id"])).toContain(VIEW_ID.toString());
    expect(JSON.stringify(hostSweep["_id"])).toContain(
      SECOND_VIEW_ID.toString(),
    );
    expect(JSON.stringify(hostSweep["_id"])).not.toContain(
      THIRD_VIEW_ID.toString(),
    );

    const logsPageSweep: Record<string, unknown> = sweepQuery(updateBy, 1);
    expect(sqlOf(logsPageSweep["scope"])).toBe("(c IS NULL)");
    expect(JSON.stringify(logsPageSweep["_id"])).toContain(
      THIRD_VIEW_ID.toString(),
    );
  });

  test("the same group in two projects is two sweeps", async () => {
    const { service, updateBy } = standInService([
      view({ id: VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
      view({
        id: SECOND_VIEW_ID,
        projectId: OTHER_PROJECT_ID,
        scope: "host:web-01",
      }),
    ]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { isDefault: true } as never,
      updatedItemIds: [VIEW_ID, SECOND_VIEW_ID],
      groupByColumns: ["scope"],
    });

    expect(updateBy).toHaveBeenCalledTimes(2);
    expect((sweepQuery(updateBy, 0)["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((sweepQuery(updateBy, 1)["projectId"] as ObjectID).toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("a kind with no groups reads only ids and projects, and sweeps each project once", async () => {
    const { service, updateBy, findBy } = standInService([
      view({ id: VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
      view({ id: SECOND_VIEW_ID, projectId: PROJECT_ID }),
    ]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { isDefault: true } as never,
      updatedItemIds: [VIEW_ID, SECOND_VIEW_ID],
    });

    expect(
      (findBy.mock.calls[0]?.[0] as Record<string, unknown>)["select"],
    ).toEqual({ _id: true, projectId: true });
    expect(updateBy).toHaveBeenCalledTimes(1);
    expect(Object.keys(sweepQuery(updateBy)).sort()).toEqual([
      "_id",
      "isDefault",
      "projectId",
    ]);
  });

  test("an update that does not make rows the default reads and sweeps nothing", async () => {
    const { service, updateBy, findBy } = standInService([
      view({ id: VIEW_ID, projectId: PROJECT_ID, scope: "host:web-01" }),
    ]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { name: "Renamed" } as never,
      updatedItemIds: [VIEW_ID],
      groupByColumns: ["scope"],
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(updateBy).not.toHaveBeenCalled();
  });

  test("two group columns: rows are one group only when both match", async () => {
    const first: LogSavedView = view({
      id: VIEW_ID,
      projectId: PROJECT_ID,
      scope: "host:web-01",
    });
    const second: LogSavedView = view({
      id: SECOND_VIEW_ID,
      projectId: PROJECT_ID,
      scope: "host:web-01",
    });
    first.name = "a";
    second.name = "b";

    const { service, updateBy } = standInService([first, second]);

    await ProjectDefaultRow.afterUpdate({
      service,
      defaultColumn: "isDefault",
      updatedData: { isDefault: true } as never,
      updatedItemIds: [VIEW_ID, SECOND_VIEW_ID],
      groupByColumns: ["scope", "name"],
    });

    expect(updateBy).toHaveBeenCalledTimes(2);
    expect(sweepQuery(updateBy, 0)["name"]).toBe("a");
    expect(sweepQuery(updateBy, 1)["name"]).toBe("b");
    expect(sweepQuery(updateBy, 0)["scope"]).toBe("host:web-01");
    expect(sweepQuery(updateBy, 1)["scope"]).toBe("host:web-01");
  });
});
