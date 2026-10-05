import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import StatusPageHeaderLink from "../../../../Models/DatabaseModels/StatusPageHeaderLink";
import ListOrderMaintainer, {
  ListOrderScope,
} from "../../../../Server/Utils/Database/ListOrderMaintainer";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../../Types/Database/ListOrderColumn";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Which list a row belongs to, read off whatever the caller handed
 * DatabaseService. A payload can name a parent by its foreign key
 * (`statusPageId`) or - the dashboard's spelling - by the relation object
 * (`statusPage: { _id }`), and both have to land the row in the same list,
 * or a link created from the dashboard would be numbered against an empty
 * list. A null parent is a list of its own; a row that does not say is left
 * alone rather than guessed at.
 *
 * A list is its parent's rows in the row's own project: a row that names
 * another project's parent is never numbered against that project's rows,
 * nor steps them aside.
 */

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";
const LIST_KEY: string = `statusPageId=${STATUS_PAGE_ID}&projectId=${PROJECT_ID}`;

const model: StatusPageHeaderLink = new StatusPageHeaderLink();
const settings: ListOrderSettings = model.getListOrder()!;

const scopeOf: (row: Record<string, unknown>) => ListOrderScope<any> | null = (
  row: Record<string, unknown>,
): ListOrderScope<any> | null => {
  return ListOrderMaintainer.getScope({
    model: model,
    settings: settings,
    row: row,
  });
};

describe("ListOrderMaintainer.getSettings", () => {
  test("reads the model's list settings", () => {
    expect(ListOrderMaintainer.getSettings(model)).toEqual({
      column: "order",
      scopeColumns: ["statusPageId"],
      sortOrder: SortOrder.Ascending,
    });
  });
});

describe("ListOrderMaintainer.getScope", () => {
  test("reads the parent from its foreign key", () => {
    const scope: ListOrderScope<any> | null = scopeOf({
      statusPageId: new ObjectID(STATUS_PAGE_ID),
      projectId: new ObjectID(PROJECT_ID),
    });

    expect(scope).not.toBeNull();
    expect((scope!.query as any)["statusPageId"].toString()).toBe(
      STATUS_PAGE_ID,
    );
    expect(scope!.key).toBe(LIST_KEY);
  });

  test("reads the parent from the relation object when the foreign key is not there", () => {
    const scope: ListOrderScope<any> | null = scopeOf({
      statusPage: { _id: STATUS_PAGE_ID },
      projectId: PROJECT_ID,
    });

    expect(scope).not.toBeNull();
    expect((scope!.query as any)["statusPageId"]).toBeInstanceOf(ObjectID);
    expect(scope!.key).toBe(LIST_KEY);
  });

  test("the two spellings put a row in the same list", () => {
    expect(
      scopeOf({ statusPage: { id: STATUS_PAGE_ID }, projectId: PROJECT_ID })!
        .key,
    ).toBe(
      scopeOf({ statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID })!.key,
    );
  });

  test("a parent given as a plain id string is read as that parent", () => {
    expect(
      scopeOf({ statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID })!.key,
    ).toBe(LIST_KEY);
  });

  test("a null parent is a list of its own, queried as IS NULL", () => {
    const scope: ListOrderScope<any> | null = scopeOf({
      statusPageId: null,
      projectId: PROJECT_ID,
    });

    expect(scope).not.toBeNull();
    expect(scope!.key).toBe(`statusPageId=&projectId=${PROJECT_ID}`);
    expect((scope!.query as any)["statusPageId"]).toBeDefined();
    expect((scope!.query as any)["statusPageId"]).not.toBeNull();
  });

  test("a row that does not say which list it is in has no list", () => {
    expect(scopeOf({ title: "Docs", projectId: PROJECT_ID })).toBeNull();
  });

  test("a list is the parent's rows in the row's own project", () => {
    const scope: ListOrderScope<any> | null = scopeOf({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });

    expect((scope!.query as any)["projectId"].toString()).toBe(PROJECT_ID);
  });

  test("the same parent in two projects is two lists", () => {
    expect(
      scopeOf({ statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID })!.key,
    ).not.toBe(
      scopeOf({ statusPageId: STATUS_PAGE_ID, projectId: OTHER_PROJECT_ID })!
        .key,
    );
  });

  test("a row that does not say which project it is in has no list", () => {
    expect(scopeOf({ statusPageId: STATUS_PAGE_ID })).toBeNull();
    expect(
      scopeOf({ statusPageId: STATUS_PAGE_ID, projectId: null }),
    ).toBeNull();
  });

  test("a model ordered by project alone is scoped by it once", () => {
    const projectOrdered: IncidentSeverity = new IncidentSeverity();
    const projectSettings: ListOrderSettings = projectOrdered.getListOrder()!;

    expect(
      ListOrderMaintainer.getScopeColumns({
        model: projectOrdered,
        settings: projectSettings,
      }),
    ).toEqual(["projectId"]);
    expect(
      ListOrderMaintainer.getScopeColumns({ model: model, settings: settings }),
    ).toEqual(["statusPageId", "projectId"]);
  });
});

describe("ListOrderMaintainer.planCreate", () => {
  test("reads the list pinned to the row's project, and appends to it", async () => {
    const reads: Array<Record<string, unknown>> = [];
    const service: any = {
      getModel: (): StatusPageHeaderLink => {
        return model;
      },
      findAllBy: async (input: {
        query: Record<string, unknown>;
      }): Promise<Array<StatusPageHeaderLink>> => {
        reads.push(input.query);
        const sibling: StatusPageHeaderLink = new StatusPageHeaderLink();
        sibling._id = "00000000-0000-4000-8000-0000000000a1";
        sibling.order = 4;
        return [sibling];
      },
    };

    const row: StatusPageHeaderLink = new StatusPageHeaderLink();
    row.statusPageId = new ObjectID(STATUS_PAGE_ID);
    row.projectId = new ObjectID(PROJECT_ID);

    const plan: { value: number } | null = await ListOrderMaintainer.planCreate(
      {
        service: service,
        settings: settings,
        row: row,
      },
    );

    expect(plan?.value).toBe(5);
    expect(reads).toHaveLength(1);
    expect(String(reads[0]!["statusPageId"])).toBe(STATUS_PAGE_ID);
    expect(String(reads[0]!["projectId"])).toBe(PROJECT_ID);
  });

  test("does not read anything for a row that does not say which project it is in", async () => {
    const service: any = {
      getModel: (): StatusPageHeaderLink => {
        return model;
      },
      findAllBy: jest.fn(),
    };

    const row: StatusPageHeaderLink = new StatusPageHeaderLink();
    row.statusPageId = new ObjectID(STATUS_PAGE_ID);

    await expect(
      ListOrderMaintainer.planCreate({
        service: service,
        settings: settings,
        row: row,
      }),
    ).resolves.toBeNull();
    expect(service.findAllBy).not.toHaveBeenCalled();
  });

  test("does not read anything for a row that does not say which list it is in", async () => {
    const service: any = {
      getModel: (): StatusPageHeaderLink => {
        return model;
      },
      findAllBy: jest.fn(),
    };

    const row: StatusPageHeaderLink = new StatusPageHeaderLink();

    await expect(
      ListOrderMaintainer.planCreate({
        service: service,
        settings: settings,
        row: row,
      }),
    ).resolves.toBeNull();
    expect(service.findAllBy).not.toHaveBeenCalled();
  });
});

describe("ListOrderMaintainer.toItem", () => {
  test("carries a row's id, number and age", () => {
    const row: StatusPageHeaderLink = new StatusPageHeaderLink();
    row._id = "00000000-0000-4000-8000-000000000001";
    row.order = 3;
    row.createdAt = new Date("2026-01-01T00:00:00.000Z");

    expect(ListOrderMaintainer.toItem(row, settings)).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      value: 3,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });
});

describe("ListOrderMaintainer.writeChanges", () => {
  test("writes each change to its row's order column, without hooks", async () => {
    const calls: Array<{ id: string; data: Record<string, unknown> }> = [];
    const service: any = {
      updateColumnsByIdWithoutHooks: async (input: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        calls.push({ id: input.id.toString(), data: input.data });
      },
    };

    await ListOrderMaintainer.writeChanges({
      service: service,
      settings: settings,
      changes: [
        { id: "00000000-0000-4000-8000-000000000001", value: 2 },
        { id: "00000000-0000-4000-8000-000000000002", value: 3 },
      ],
    });

    expect(calls).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", data: { order: 2 } },
      { id: "00000000-0000-4000-8000-000000000002", data: { order: 3 } },
    ]);
  });
});
