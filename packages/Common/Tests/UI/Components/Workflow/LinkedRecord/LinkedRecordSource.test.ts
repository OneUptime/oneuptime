/*
 * Issue #5943: what a setting that names the project's records asks the API for
 * - the real models say which column names a record and how they sort; only the
 * API is stood in for.
 */

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: { getList: jest.fn() },
  };
});

jest.mock("../../../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: { getCurrentProjectId: jest.fn() },
  };
});

jest.mock("../../../../../UI/Components/PeoplePicker/PeoplePickerKinds", () => {
  return {
    __esModule: true,
    getPeoplePickerKindDefinition: jest.fn(),
  };
});

import Includes from "../../../../../Types/BaseDatabase/Includes";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../../Types/Color";
import ObjectID from "../../../../../Types/ObjectID";
import { PeoplePickerKind } from "../../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { getPeoplePickerKindDefinition } from "../../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  LINKED_RECORD_LIST_LIMIT,
  LinkedRecordList,
  loadLinkedRecords,
  loadLinkedRecordsById,
} from "../../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource";
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../../../UI/Utils/Project";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

interface ListCall {
  modelType: { new (): { tableName?: string } };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

const getList: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

type LastCallFunction = (index?: number) => ListCall;

const callOf: LastCallFunction = (index: number = 0): ListCall => {
  return getList.mock.calls[index]?.[0] as ListCall;
};

type AnswerFunction = (rows: Array<Record<string, unknown>>) => void;

const answer: AnswerFunction = (rows: Array<Record<string, unknown>>): void => {
  (getList as any).mockResolvedValue({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 100,
  });
};

beforeEach(() => {
  getList.mockReset();
  (ProjectUtil.getCurrentProjectId as jest.Mock).mockReturnValue(PROJECT_ID);
  (getPeoplePickerKindDefinition as jest.Mock).mockReset();
});

describe("a value the project orders itself: an incident severity", () => {
  test("is listed in the project's order, by name, with its colour", async () => {
    answer([
      { _id: "s1", name: "SEV1", color: new Color("#ff0000") },
      { _id: "s2", name: "SEV2", color: "#00ff00" },
    ]);

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "IncidentSeverity",
    });

    expect(new (callOf().modelType)().tableName).toBe("IncidentSeverity");
    expect(callOf().sort).toEqual({ order: SortOrder.Ascending });
    expect(callOf().select).toEqual(
      expect.objectContaining({ _id: true, name: true, color: true }),
    );
    expect(callOf().limit).toBe(LINKED_RECORD_LIST_LIMIT);

    expect(
      list.options.map((option: DropdownOption) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      ["s1", "SEV1"],
      ["s2", "SEV2"],
    ]);
    expect(list.options[0]?.color?.toString()).toBe("#ff0000");
    expect(list.options[1]?.color?.toString()).toBe("#00ff00");
  });

  test("offers no archived one", async () => {
    answer([]);

    await loadLinkedRecords({ tableName: "IncidentSeverity" });

    expect(callOf().query).toEqual({ isArchived: false });
  });

  test("names a record as a person wrote it, never as a word to translate", async () => {
    answer([{ _id: "s1", name: "Password" }]);

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "IncidentSeverity",
    });

    expect(list.options[0]?.isUserContent).toBe(true);
  });

  test("is whole when fewer came back than a page", async () => {
    answer([{ _id: "s1", name: "SEV1" }]);

    expect(
      (await loadLinkedRecords({ tableName: "IncidentSeverity" })).isComplete,
    ).toBe(true);
  });
});

describe("a record with a number: an incident", () => {
  test("is listed newest first, by its number and its title", async () => {
    answer([
      {
        _id: "i1",
        title: "Database is down",
        incidentNumber: 8,
        incidentNumberWithPrefix: "INC-8",
      },
    ]);

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "Incident",
    });

    expect(callOf().sort).toEqual({ createdAt: SortOrder.Descending });
    expect(list.options[0]?.label).toBe("INC-8 · Database is down");
  });

  test("with no title is called by its number, and with neither by its ID", async () => {
    answer([{ _id: "i1", incidentNumberWithPrefix: "INC-8" }, { _id: "i2" }]);

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "Incident",
    });

    expect(list.options[0]?.label).toBe("INC-8");
    expect(list.options[1]?.label).toBe("i2");
  });

  test("a full page may have more behind it", async () => {
    answer(
      Array.from({ length: LINKED_RECORD_LIST_LIMIT }).map(
        (_item: unknown, index: number) => {
          return { _id: `i${index}`, title: `Incident ${index}` };
        },
      ),
    );

    expect(
      (await loadLinkedRecords({ tableName: "Incident" })).isComplete,
    ).toBe(false);
  });

  test("a search asks by title and by number, and lists each record once", async () => {
    (getList as any).mockImplementation(async (args: ListCall) => {
      const rows: Array<Record<string, unknown>> =
        "title" in args.query
          ? [
              { _id: "i1", title: "INC-8 was bad" },
              { _id: "i2", title: "Other INC-8" },
            ]
          : [{ _id: "i2", title: "Other INC-8" }];

      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    });

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "Incident",
      search: "  INC-8 ",
    });

    expect(getList).toHaveBeenCalledTimes(2);

    const queries: Array<Record<string, unknown>> = [
      callOf(0).query,
      callOf(1).query,
    ];

    expect(queries[0]?.["title"]).toBeInstanceOf(Search);
    expect((queries[0]?.["title"] as Search<string>).toString()).toContain(
      "INC-8",
    );
    expect(queries[1]?.["incidentNumberWithPrefix"]).toBeInstanceOf(Search);

    // By number first: what was typed names it outright.
    expect(
      list.options.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual(["i2", "i1"]);
    expect(list.isComplete).toBe(false);
  });
});

describe("a record with only a name: a monitor", () => {
  test("is listed by name", async () => {
    answer([{ _id: "m1", name: "Checkout API" }]);

    await loadLinkedRecords({ tableName: "Monitor" });

    expect(callOf().sort).toEqual({ name: SortOrder.Ascending });
  });

  test("a search asks once, by name", async () => {
    answer([{ _id: "m1", name: "Checkout API" }]);

    await loadLinkedRecords({ tableName: "Monitor", search: "check" });

    expect(getList).toHaveBeenCalledTimes(1);
    expect(callOf().query["name"]).toBeInstanceOf(Search);
  });
});

describe("what a refused read does", () => {
  test("rejects, so the setting goes back to a box to type into", async () => {
    (getList as any).mockRejectedValue(new Error("Not allowed"));

    await expect(
      loadLinkedRecords({ tableName: "IncidentSeverity" }),
    ).rejects.toThrow("Not allowed");
  });
});

describe("a table that does not exist", () => {
  test("lists nothing and asks nothing", async () => {
    expect(await loadLinkedRecords({ tableName: "NoSuchTable" })).toEqual({
      options: [],
      isComplete: true,
    });
    expect(
      await loadLinkedRecordsById({ tableName: "NoSuchTable", ids: ["a"] }),
    ).toEqual([]);
    expect(getList).not.toHaveBeenCalled();
  });
});

describe("the project's people", () => {
  type PeopleDefinition = {
    search: jest.Mock;
    getByIds: jest.Mock;
  };

  type MockPeopleFunction = (
    people: Array<Record<string, unknown>>,
  ) => PeopleDefinition;

  const mockPeople: MockPeopleFunction = (
    people: Array<Record<string, unknown>>,
  ): PeopleDefinition => {
    const definition: PeopleDefinition = {
      search: jest.fn(),
      getByIds: jest.fn(),
    };

    (definition.search as any).mockResolvedValue(people);
    (definition.getByIds as any).mockResolvedValue(people);
    (getPeoplePickerKindDefinition as jest.Mock).mockReturnValue(definition);

    return definition;
  };

  test("are listed the way every people picker lists them", async () => {
    const definition: PeopleDefinition = mockPeople([
      {
        kind: PeoplePickerKind.User,
        id: "u1",
        name: "Ada",
        description: "ada@example.com",
      },
    ]);

    const list: LinkedRecordList = await loadLinkedRecords({
      tableName: "User",
      search: "ad",
    });

    expect(getPeoplePickerKindDefinition).toHaveBeenCalledWith(
      PeoplePickerKind.User,
    );
    expect(definition.search).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      searchText: "ad",
      limit: LINKED_RECORD_LIST_LIMIT,
    });
    expect(list.options).toEqual([
      {
        value: "u1",
        label: "Ada",
        description: "ada@example.com",
        isUserContent: true,
      },
    ]);
    expect(getList).not.toHaveBeenCalled();
  });

  test("a held person is looked up by their ID", async () => {
    const definition: PeopleDefinition = mockPeople([
      { kind: PeoplePickerKind.User, id: "u1", name: "Ada" },
    ]);

    const options: Array<DropdownOption> = await loadLinkedRecordsById({
      tableName: "User",
      ids: ["u1"],
    });

    expect(definition.getByIds).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ids: ["u1"],
    });
    expect(options[0]?.label).toBe("Ada");
  });

  test("with no project open there is nobody to list", async () => {
    (ProjectUtil.getCurrentProjectId as jest.Mock).mockReturnValue(null);

    expect(await loadLinkedRecords({ tableName: "User" })).toEqual({
      options: [],
      isComplete: true,
    });
    expect(
      await loadLinkedRecordsById({ tableName: "User", ids: ["u1"] }),
    ).toEqual([]);
  });
});

describe("the records a step already holds", () => {
  test("are looked up by their IDs, whatever the list shows", async () => {
    answer([{ _id: "s1", name: "SEV1" }]);

    const options: Array<DropdownOption> = await loadLinkedRecordsById({
      tableName: "IncidentSeverity",
      ids: ["s1", "s2"],
    });

    expect(callOf().query["_id"]).toBeInstanceOf(Includes);
    expect(callOf().limit).toBe(2);
    expect(options[0]?.label).toBe("SEV1");
  });

  test("an archived one is named, marked, and never picked again", async () => {
    answer([{ _id: "s1", name: "Old SEV", isArchived: true }]);

    const options: Array<DropdownOption> = await loadLinkedRecordsById({
      tableName: "IncidentSeverity",
      ids: ["s1"],
    });

    expect(options[0]?.isArchived).toBe(true);
    expect(options[0]?.isDisabled).toBe(true);
  });

  test("asks nothing when nothing is held", async () => {
    expect(
      await loadLinkedRecordsById({ tableName: "IncidentSeverity", ids: [] }),
    ).toEqual([]);
    expect(getList).not.toHaveBeenCalled();
  });
});
