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
 */

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

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
    });

    expect(scope).not.toBeNull();
    expect((scope!.query as any)["statusPageId"].toString()).toBe(
      STATUS_PAGE_ID,
    );
    expect(scope!.key).toBe(`statusPageId=${STATUS_PAGE_ID}`);
  });

  test("reads the parent from the relation object when the foreign key is not there", () => {
    const scope: ListOrderScope<any> | null = scopeOf({
      statusPage: { _id: STATUS_PAGE_ID },
    });

    expect(scope).not.toBeNull();
    expect((scope!.query as any)["statusPageId"]).toBeInstanceOf(ObjectID);
    expect(scope!.key).toBe(`statusPageId=${STATUS_PAGE_ID}`);
  });

  test("the two spellings put a row in the same list", () => {
    expect(scopeOf({ statusPage: { id: STATUS_PAGE_ID } })!.key).toBe(
      scopeOf({ statusPageId: STATUS_PAGE_ID })!.key,
    );
  });

  test("a parent given as a plain id string is read as that parent", () => {
    expect(scopeOf({ statusPageId: STATUS_PAGE_ID })!.key).toBe(
      `statusPageId=${STATUS_PAGE_ID}`,
    );
  });

  test("a null parent is a list of its own, queried as IS NULL", () => {
    const scope: ListOrderScope<any> | null = scopeOf({ statusPageId: null });

    expect(scope).not.toBeNull();
    expect(scope!.key).toBe("statusPageId=");
    expect((scope!.query as any)["statusPageId"]).toBeDefined();
    expect((scope!.query as any)["statusPageId"]).not.toBeNull();
  });

  test("a row that does not say which list it is in has no list", () => {
    expect(scopeOf({ title: "Docs" })).toBeNull();
  });
});

describe("ListOrderMaintainer.planCreate", () => {
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
