import {
  fetchDuplicateName,
  getDuplicateNameColumn,
} from "../../../UI/Components/DuplicateModel/DuplicateName";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The name a copy starts with, looked up when Duplicate is pressed
 * (DuplicateModel/DuplicateName): the original's name, read on its own,
 * then the project's names that could clash with a numbered one - one
 * getList searching for the series' first name - and the copy named past
 * them (Forms/Utils/UniqueName getCopyName).
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
    },
  };
});

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function monitorNamed(name: string | undefined): Monitor {
  const monitor: Monitor = new Monitor();

  if (name !== undefined) {
    monitor.name = name;
  }

  return monitor;
}

function listOf(items: Array<BaseModel>): JSONObject {
  return {
    data: items,
    count: items.length,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
  } as unknown as JSONObject;
}

interface ListArgs {
  query: JSONObject;
  select: JSONObject;
  limit: number;
  skip: number;
  sort: JSONObject;
  modelType: unknown;
}

function nameField<T extends BaseModel>(title: string): ModelField<T> {
  return {
    field: { name: true } as ModelField<T>["field"],
    title,
    fieldType: FormFieldSchemaType.Text,
    required: true,
  };
}

describe("the column a copy is named by", () => {
  test.each([
    ["Dashboard", new Dashboard()],
    ["Monitor", new Monitor()],
    ["OnCallDutyPolicySchedule", new OnCallDutyPolicySchedule()],
    ["Workflow", new Workflow()],
  ] as Array<[string, BaseModel]>)(
    "is a %s's name when the dialog asks for it",
    (_label: string, model: BaseModel) => {
      expect(
        getDuplicateNameColumn({
          model,
          fieldsToChange: [nameField<BaseModel>("New Name")],
        }),
      ).toBe("name");
    },
  );

  test("is found wherever the dialog asks for it, beside other fields", () => {
    expect(
      getDuplicateNameColumn<Monitor>({
        model: new Monitor(),
        fieldsToChange: [
          {
            field: { disableActiveMonitoring: true },
            title: "Disable Monitor",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          nameField<Monitor>("New Monitor Name"),
        ],
      }),
    ).toBe("name");
  });

  test("is none when the dialog does not ask for the name: nothing is filled in", () => {
    expect(
      getDuplicateNameColumn<Monitor>({
        model: new Monitor(),
        fieldsToChange: [
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
        ],
      }),
    ).toBeNull();

    expect(
      getDuplicateNameColumn<Monitor>({
        model: new Monitor(),
        fieldsToChange: [],
      }),
    ).toBeNull();
  });

  test("is none for a model without a name column", () => {
    class Nameless extends BaseModel {}

    expect(
      getDuplicateNameColumn<Nameless>({
        model: new Nameless(),
        fieldsToChange: [
          {
            field: { _id: true } as ModelField<Nameless>["field"],
            title: "Id",
            fieldType: FormFieldSchemaType.Text,
            required: false,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("the name a copy starts with", () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetList.mockReset();
  });

  test("reads the original's name alone, then searches the project for the series' first name", async () => {
    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("API Monitor 2");
    });
    mockGetList.mockImplementation(async (): Promise<JSONObject> => {
      return listOf([
        monitorNamed("API Monitor"),
        monitorNamed("API Monitor 2"),
      ]);
    });

    const name: string = await fetchDuplicateName<Monitor>({
      modelType: Monitor,
      modelId: MONITOR_ID,
      nameColumn: "name",
    });

    expect(name).toBe("API Monitor 3");

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Monitor,
        id: MONITOR_ID,
        select: { name: true },
      }),
    );

    expect(mockGetList).toHaveBeenCalledTimes(1);
    const lookup: ListArgs = mockGetList.mock.calls[0]![0] as ListArgs;
    expect(lookup.modelType).toBe(Monitor);
    expect(Object.keys(lookup.query)).toEqual(["name"]);
    expect(lookup.query["name"]).toBeInstanceOf(Search);
    expect((lookup.query["name"] as unknown as Search<string>).value).toBe(
      "API Monitor",
    );
    expect(lookup.select).toEqual({ name: true });
    expect(lookup.limit).toBe(LIMIT_PER_PROJECT);
    expect(lookup.skip).toBe(0);
    expect(lookup.sort).toEqual({});
  });

  test("searches for the whole name when it does not end in a number", async () => {
    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("  Checkout API  ");
    });
    mockGetList.mockImplementation(async (): Promise<JSONObject> => {
      return listOf([monitorNamed("Checkout API")]);
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("Checkout API 2");

    const lookup: ListArgs = mockGetList.mock.calls[0]![0] as ListArgs;
    expect((lookup.query["name"] as unknown as Search<string>).value).toBe(
      "Checkout API",
    );
  });

  test("numbers past every name the lookup found, whatever their case", async () => {
    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("Checkout API");
    });
    mockGetList.mockImplementation(async (): Promise<JSONObject> => {
      return listOf([
        monitorNamed("Checkout API"),
        monitorNamed("CHECKOUT API 2"),
        monitorNamed("checkout api 3 "),
        monitorNamed("Checkout API Old"),
        monitorNamed(undefined),
      ]);
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("Checkout API 4");
  });

  test("names the copy after its original alone when the lookup fails", async () => {
    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("Checkout API");
    });
    mockGetList.mockImplementation(async (): Promise<never> => {
      throw new Error("You do not have permission to list monitors.");
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("Checkout API 2");
  });

  test("names the copy after its original when the lookup answers no list", async () => {
    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("Checkout API");
    });
    mockGetList.mockImplementation(async (): Promise<JSONObject> => {
      return {} as JSONObject;
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("Checkout API 2");
  });

  test("is empty, with no lookup, when the original cannot be read", async () => {
    mockGetItem.mockImplementation(async (): Promise<never> => {
      throw new Error("Network error");
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("");
    expect(mockGetList).not.toHaveBeenCalled();
  });

  test("is empty, with no lookup, when the original is not found or has no name", async () => {
    mockGetItem.mockImplementation(async (): Promise<null> => {
      return null;
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("");

    mockGetItem.mockImplementation(async (): Promise<Monitor> => {
      return monitorNamed("   ");
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "name",
      }),
    ).toBe("");
    expect(mockGetList).not.toHaveBeenCalled();
  });

  test("reads the column it is given", async () => {
    mockGetItem.mockImplementation(async (): Promise<JSONObject> => {
      return { title: "Weekly report" } as unknown as JSONObject;
    });
    mockGetList.mockImplementation(async (): Promise<JSONObject> => {
      return {
        data: [{ title: "Weekly report" }, { title: "Weekly report 2" }],
      } as unknown as JSONObject;
    });

    expect(
      await fetchDuplicateName<Monitor>({
        modelType: Monitor,
        modelId: MONITOR_ID,
        nameColumn: "title",
      }),
    ).toBe("Weekly report 3");

    expect((mockGetItem.mock.calls[0]![0] as ListArgs).select).toEqual({
      title: true,
    });
    const lookup: ListArgs = mockGetList.mock.calls[0]![0] as ListArgs;
    expect(Object.keys(lookup.query)).toEqual(["title"]);
    expect(lookup.select).toEqual({ title: true });
  });
});
