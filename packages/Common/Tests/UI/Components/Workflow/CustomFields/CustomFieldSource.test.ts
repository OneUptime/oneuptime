/*
 * Issue #5942: where the builder reads a project's custom fields from - the
 * definition table of the record's kind, as the person editing - and what it
 * makes of what comes back. The real models and the real record kinds; only the
 * API is stood in for.
 */

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: { getList: jest.fn() },
  };
});

import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { CUSTOM_FIELD_RECORD_KINDS } from "../../../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import { getModelTypeByName } from "../../../../../Models/DatabaseModels/Index";
import { WorkflowCustomField } from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldColumns";
import {
  hasCustomFields,
  loadCustomFields,
} from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldSource";
import ModelAPI from "../../../../../UI/Utils/ModelAPI/ModelAPI";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const getList: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

interface ListCall {
  modelType: { new (): { tableName?: string } };
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

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
});

describe("hasCustomFields", () => {
  test("is true of every kind of record with custom fields", () => {
    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      expect(hasCustomFields(kind.recordTableName)).toBe(true);
    }
  });

  test("is false of a table with none", () => {
    expect(hasCustomFields("Label")).toBe(false);
    expect(hasCustomFields("")).toBe(false);
  });
});

describe("loadCustomFields", () => {
  test("reads the record kind's definition table, in the project's order", async () => {
    answer([]);

    await loadCustomFields("Incident");

    const call: ListCall = getList.mock.calls[0]?.[0] as ListCall;

    expect(new call.modelType().tableName).toBe("IncidentCustomField");
    expect(call.sort).toEqual({ sortOrder: SortOrder.Ascending });
    expect(call.select).toEqual({
      name: true,
      description: true,
      customFieldType: true,
      dropdownOptions: true,
    });
  });

  test.each(
    CUSTOM_FIELD_RECORD_KINDS.map(
      (kind: { recordTableName: string; definitionTableName: string }) => {
        return [kind.recordTableName, kind.definitionTableName];
      },
    ),
  )("%s reads %s", async (record: string, definition: string) => {
    answer([]);

    await loadCustomFields(record);

    const call: ListCall = getList.mock.calls[0]?.[0] as ListCall;

    expect(new call.modelType().tableName).toBe(definition);
  });

  test("every definition table exists as a model", () => {
    for (const kind of CUSTOM_FIELD_RECORD_KINDS) {
      expect(getModelTypeByName(kind.definitionTableName)).not.toBeNull();
    }
  });

  test("gives each field's name, kind and description", async () => {
    answer([
      {
        name: "Customer",
        description: "Who it affects",
        customFieldType: CustomFieldType.Text,
      },
    ]);

    expect(await loadCustomFields("Incident")).toEqual([
      {
        name: "Customer",
        description: "Who it affects",
        customFieldType: CustomFieldType.Text,
        options: [],
      },
    ]);
  });

  test("reads a dropdown's options, in the old form and the new", async () => {
    answer([
      {
        name: "Old",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "P1\nP2",
      },
      {
        name: "New",
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: JSON.stringify([
          { value: "P1", color: "#ff0000" },
          { value: "P2" },
        ]),
      },
    ]);

    const fields: Array<WorkflowCustomField> =
      await loadCustomFields("Incident");

    expect(fields[0]?.options).toEqual([{ value: "P1" }, { value: "P2" }]);
    expect(fields[1]?.options).toEqual([
      { value: "P1", color: "#ff0000" },
      { value: "P2" },
    ]);
  });

  test("leaves out a field with no name: there is nothing to store it under", async () => {
    answer([{ name: "" }, { name: "   " }, {}, { name: "Kept" }]);

    const fields: Array<WorkflowCustomField> =
      await loadCustomFields("Incident");

    expect(
      fields.map((field: WorkflowCustomField): string => {
        return field.name;
      }),
    ).toEqual(["Kept"]);
  });

  test("a table with no custom fields asks for nothing", async () => {
    expect(await loadCustomFields("Label")).toEqual([]);
    expect(getList).not.toHaveBeenCalled();
  });

  test("rejects when the person may not read them, for the caller to say", async () => {
    (getList as any).mockRejectedValue(new Error("Not allowed"));

    await expect(loadCustomFields("Incident")).rejects.toThrow("Not allowed");
  });
});
