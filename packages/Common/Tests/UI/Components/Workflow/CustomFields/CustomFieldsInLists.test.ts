/*
 * Issue #5942, in the two lists that read a record's fields rather than write
 * them: the value picker, which offers each custom field to a later step, and
 * Fields to watch and Fields to pass on, on a trigger.
 */

jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getCommonHeaders: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("../../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      getFriendlyMessage: jest.fn(() => {
        return "Failed";
      }),
    },
  };
});

import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import {
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "../../../../../Types/Workflow/Component";
import { isFieldPassedOn } from "../../../../../Types/Workflow/PassedOnFields";
import { parseTemplateExpressions } from "../../../../../Types/Workflow/TemplateSyntax";
import {
  WorkflowCustomField,
  withCustomFieldColumns,
} from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldColumns";
import {
  ChosenFields,
  FieldGroup,
  FieldGroupId,
  FieldOption,
  FieldPickerMode,
  getFieldGroups,
  getFieldOptions,
  readChosenFields,
  searchFieldOptions,
  writeChosenFields,
} from "../../../../../UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { loadRecordColumns } from "../../../../../UI/Components/Workflow/ValuePicker/DefaultValueSources";
import { recordFieldSuggestions } from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { ValueSuggestion } from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import API from "../../../../../UI/Utils/API/API";
import ModelAPI from "../../../../../UI/Utils/ModelAPI/ModelAPI";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const SCHEMA: Array<ModelSchemaColumn> = [
  {
    id: "title",
    title: "Title",
    type: TableColumnType.ShortText,
    isRelation: false,
  },
  {
    id: "customFields",
    title: "Custom Fields",
    type: TableColumnType.JSON,
    isRelation: false,
  },
];

const FIELDS: Array<WorkflowCustomField> = [
  {
    name: "Priority Level",
    customFieldType: CustomFieldType.Dropdown,
    description: "How urgent this is",
    options: [{ value: "P1" }],
  },
  { name: "Count", customFieldType: CustomFieldType.Number, options: [] },
  { name: "Contract", customFieldType: CustomFieldType.File, options: [] },
];

const RETURN_VALUE: ReturnValue = {
  id: "model",
  name: "Incident",
  description: "",
  type: ComponentInputType.BaseModel,
  required: false,
};

type TriggerFunction = (select: unknown) => NodeDataProp;

const trigger: TriggerFunction = (select: unknown): NodeDataProp => {
  return {
    id: "incident-on-create-1",
    metadataId: "incident-on-create",
    arguments: { select: select },
    metadata: { arguments: [{ id: "select" }] },
  } as unknown as NodeDataProp;
};

type SuggestionsFunction = (select: unknown) => Array<ValueSuggestion>;

const suggestions: SuggestionsFunction = (
  select: unknown,
): Array<ValueSuggestion> => {
  return recordFieldSuggestions({
    component: trigger(select),
    returnValue: RETURN_VALUE,
    columns: withCustomFieldColumns(SCHEMA, FIELDS),
  });
};

type NamedFunction = (
  items: Array<ValueSuggestion>,
  label: string,
) => ValueSuggestion | undefined;

const named: NamedFunction = (
  items: Array<ValueSuggestion>,
  label: string,
): ValueSuggestion | undefined => {
  return items.find((item: ValueSuggestion): boolean => {
    return item.label === label;
  });
};

describe("the value picker", () => {
  test("offers each custom field, under the name of the column they live in", () => {
    const items: Array<ValueSuggestion> = suggestions({ customFields: true });

    expect(named(items, "Custom Fields › Priority Level")).toBeDefined();
    expect(named(items, "Custom Fields › Count")).toBeDefined();
  });

  test("keeps Custom Fields itself, for the whole bag", () => {
    expect(
      named(suggestions({ customFields: true }), "Custom Fields"),
    ).toBeDefined();
  });

  test("a field's reference reads its path, with its name as it was written", () => {
    expect(
      named(
        suggestions({ customFields: true }),
        "Custom Fields › Priority Level",
      )?.reference,
    ).toBe(
      "{{local.components.incident-on-create-1.returnValues.model.customFields.Priority Level}}",
    );
  });

  test("that reference reads as a reference, spaces and all", () => {
    const reference: string = named(
      suggestions({ customFields: true }),
      "Custom Fields › Priority Level",
    )?.reference as string;

    expect(parseTemplateExpressions(reference)).toHaveLength(1);
  });

  test("words a field's kind of value and its description", () => {
    const item: ValueSuggestion | undefined = named(
      suggestions({ customFields: true }),
      "Custom Fields › Priority Level",
    );

    expect(item?.typeLabel).toBe("Choice");
    expect(item?.description).toBe("How urgent this is");
  });

  test("a file field cannot be filled in, but can be read like any other", () => {
    expect(
      named(suggestions({ customFields: true }), "Custom Fields › Contract")
        ?.typeLabel,
    ).toBe("File");
  });

  test("a step that passes them on has them all as values to use", () => {
    expect(
      named(suggestions({ customFields: true }), "Custom Fields › Count")
        ?.isEmptyHere,
    ).toBeUndefined();
  });

  test("a step that does not lists them apart, as empty here", () => {
    expect(
      named(suggestions({ title: true }), "Custom Fields › Count")?.isEmptyHere,
    ).toBe(true);
  });

  test("a step whose list cannot be read offers them alike", () => {
    expect(
      named(suggestions(""), "Custom Fields › Count")?.isEmptyHere,
    ).toBeUndefined();
  });

  test("the checks agree: reading one is reading what the column passes on", () => {
    expect(
      isFieldPassedOn(
        trigger({ customFields: true }),
        "customFields.Priority Level",
      ),
    ).toBe(true);
    expect(
      isFieldPassedOn(trigger({ title: true }), "customFields.Priority Level"),
    ).toBe(false);
  });
});

describe("loadRecordColumns", () => {
  const get: jest.Mock = API.get as unknown as jest.Mock;
  const getList: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

  beforeEach(() => {
    get.mockReset();
    getList.mockReset();

    (get as any).mockResolvedValue(
      new HTTPResponse(200, { columns: SCHEMA }, {}),
    );
  });

  test("gives a record's columns with its custom fields among them", async () => {
    (getList as any).mockResolvedValue({
      data: [{ name: "Count", customFieldType: CustomFieldType.Number }],
      count: 1,
    });

    const columns: Array<ModelSchemaColumn> =
      await loadRecordColumns("Incident");

    expect(
      columns.map((column: ModelSchemaColumn): string => {
        return column.id;
      }),
    ).toEqual(["title", "customFields", "customFields.Count"]);
  });

  test("still gives its columns when the custom fields cannot be read", async () => {
    (getList as any).mockRejectedValue(new Error("Not on this plan"));

    expect(await loadRecordColumns("Incident")).toEqual(SCHEMA);
  });

  test("asks for no custom fields of a record that has none", async () => {
    await loadRecordColumns("Label");

    expect(getList).not.toHaveBeenCalled();
  });
});

describe("Fields to watch", () => {
  const options: Array<FieldOption> = getFieldOptions({
    columns: SCHEMA,
    mode: FieldPickerMode.Watch,
    customFields: FIELDS,
  });

  type OptionFunction = (path: string) => FieldOption | undefined;

  const option: OptionFunction = (path: string): FieldOption | undefined => {
    return options.find((candidate: FieldOption): boolean => {
      return candidate.path === path;
    });
  };

  test("lists each custom field, to watch by itself, by its own name", () => {
    expect(option("customFields.Priority Level")?.title).toBe("Priority Level");
    expect(option("customFields.Priority Level")?.description).toBe(
      "How urgent this is",
    );
    expect(option("customFields.Priority Level")?.typeLabel).toBe("Choice");
  });

  test("and the column as a whole, called what watching it does", () => {
    expect(option("customFields")?.title).toBe("Any custom field");
  });

  test("groups them apart, any custom field first, in the project's order", () => {
    const groups: Array<FieldGroup> = getFieldGroups({ options: options });
    const custom: FieldGroup | undefined = groups.find(
      (group: FieldGroup): boolean => {
        return group.id === FieldGroupId.Custom;
      },
    );

    expect(
      custom?.options.map((candidate: FieldOption): string => {
        return candidate.path;
      }),
    ).toEqual([
      "customFields",
      "customFields.Priority Level",
      "customFields.Count",
      "customFields.Contract",
    ]);
  });

  test("a search finds one by its name", () => {
    expect(searchFieldOptions(options, "priority")[0]?.path).toBe(
      "customFields.Priority Level",
    );
  });

  test("stores it by its path, as the trigger reads it", () => {
    expect(
      writeChosenFields({
        paths: ["customFields.Priority Level", "title"],
        mode: FieldPickerMode.Watch,
      }),
    ).toBe('{"customFields.Priority Level":true,"title":true}');
  });

  test("reads back what it stored, as the fields it names", () => {
    const chosen: ChosenFields = readChosenFields({
      value: '{"customFields.Priority Level":true}',
      options: options,
      mode: FieldPickerMode.Watch,
    });

    expect(chosen.paths).toEqual(["customFields.Priority Level"]);
    expect(chosen.unknownPaths).toEqual([]);
    expect(chosen.problems).toEqual([]);
  });

  test("says of a field the project no longer has that it is not one", () => {
    const chosen: ChosenFields = readChosenFields({
      value: '{"customFields.Gone":true}',
      options: options,
      mode: FieldPickerMode.Watch,
    });

    expect(chosen.unknownPaths).toEqual(["customFields.Gone"]);
  });

  test("with no custom fields, the column is still there to watch", () => {
    const withNone: Array<FieldOption> = getFieldOptions({
      columns: SCHEMA,
      mode: FieldPickerMode.Watch,
    });

    expect(
      withNone.map((candidate: FieldOption): string => {
        return candidate.path;
      }),
    ).toEqual(["title", "customFields"]);
  });
});

describe("Fields to pass on", () => {
  const options: Array<FieldOption> = getFieldOptions({
    columns: SCHEMA,
    mode: FieldPickerMode.PassOn,
    customFields: FIELDS,
  });

  test("lists the column once: they are all passed on together", () => {
    expect(
      options.map((candidate: FieldOption): string => {
        return candidate.path;
      }),
    ).toEqual(["title", "customFields"]);
  });

  test("says which fields that passes on", () => {
    expect(options[1]?.description).toBe(
      "Passes on every custom field: Priority Level, Count, Contract",
    );
  });

  test("a search for one of them finds the column that passes it on", () => {
    expect(searchFieldOptions(options, "priority")[0]?.path).toBe(
      "customFields",
    );
  });

  test("stores it as it always has", () => {
    expect(
      writeChosenFields({
        paths: ["customFields"],
        mode: FieldPickerMode.PassOn,
      }),
    ).toBe('{"customFields":true}');
  });

  test("with no custom fields it reads as the model describes it", () => {
    const withNone: Array<FieldOption> = getFieldOptions({
      columns: [
        { ...SCHEMA[1]!, description: "The incident's custom field values" },
      ],
      mode: FieldPickerMode.PassOn,
    });

    expect(withNone[0]?.description).toBe("The incident's custom field values");
  });
});
