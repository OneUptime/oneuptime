/*
 * Issue #5942, as the person building the workflow meets it: Create One
 * Incident's fields, with the project's custom fields among them. The editor,
 * its rows and its controls are the real thing; only what the API answers is
 * stood in for.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: () => {
      return null;
    },
  };
});

jest.mock("../../../../../UI/Components/Workflow/ModelSchema", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../UI/Components/Workflow/ModelSchema",
  );

  return { ...actual, useModelSchema: jest.fn() };
});

jest.mock(
  "../../../../../UI/Components/Workflow/CustomFields/UseCustomFields",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";
import { CustomFieldRowCopy } from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldColumns";
import CustomFieldsArgumentEditor, {
  unwrapCustomFieldsValue,
  wrapCustomFieldsValue,
} from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldsArgumentEditor";
import useCustomFields from "../../../../../UI/Components/Workflow/CustomFields/UseCustomFields";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "../../../../../UI/Components/Workflow/ModelColumnEditor";
import {
  ModelSchemaColumn,
  useModelSchema,
} from "../../../../../UI/Components/Workflow/ModelSchema";
import { WorkflowViewOnlyContext } from "../../../../../UI/Components/Workflow/WorkflowViewOnly";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SCHEMA: Array<ModelSchemaColumn> = [
  {
    id: "title",
    title: "Title",
    type: TableColumnType.ShortText,
    isRelation: false,
    canCreate: true,
    canUpdate: true,
  },
  {
    id: "customFields",
    title: "Custom Fields",
    type: TableColumnType.JSON,
    isRelation: false,
    canCreate: true,
    canUpdate: true,
  },
];

const FIELDS: Array<Record<string, unknown>> = [
  {
    name: "Priority Level",
    customFieldType: CustomFieldType.Dropdown,
    description: "How urgent this is",
    options: [{ value: "P1" }, { value: "P2" }],
  },
  {
    name: "Tags",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    options: [{ value: "blue" }, { value: "green" }],
  },
  { name: "Count", customFieldType: CustomFieldType.Number, options: [] },
  { name: "Reviewed", customFieldType: CustomFieldType.Boolean, options: [] },
  { name: "Due On", customFieldType: CustomFieldType.Date, options: [] },
  { name: "Contract", customFieldType: CustomFieldType.File, options: [] },
];

type EditorFunction = (data: {
  value?: JSONObject | undefined;
  mode?: ModelColumnEditorMode | undefined;
  onChange?: MockFunction | undefined;
}) => ReactElement;

const editor: EditorFunction = (data: {
  value?: JSONObject | undefined;
  mode?: ModelColumnEditorMode | undefined;
  onChange?: MockFunction | undefined;
}): ReactElement => {
  return (
    <ModelColumnEditor
      tableName="Incident"
      mode={data.mode || ModelColumnEditorMode.Record}
      recordIntent={RecordIntent.Update}
      initialValue={data.value ? JSON.stringify(data.value) : ""}
      onChange={(data.onChange || getJestMockFunction()) as never}
    />
  );
};

type LastValueFunction = (onChange: MockFunction) => JSONObject;

const lastValue: LastValueFunction = (onChange: MockFunction): JSONObject => {
  const calls: Array<Array<unknown>> = (onChange as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;

  return JSON.parse(calls[calls.length - 1]?.[0] as string) as JSONObject;
};

beforeEach(() => {
  (useModelSchema as jest.Mock).mockReturnValue({
    columns: SCHEMA,
    isLoading: false,
    error: null,
  });
  (useCustomFields as jest.Mock).mockReturnValue({
    fields: FIELDS,
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the list a field is added from", () => {
  test("names each custom field, under a heading of its own", async () => {
    render(editor({}));

    fireEvent.click(screen.getByTestId("model-column-add"));

    const group: HTMLElement = await screen.findByTestId(
      "model-column-add-group-custom",
    );

    expect(within(group).getByText("Custom fields")).toBeInTheDocument();
    expect(within(group).getByText("Priority Level")).toBeInTheDocument();
    expect(within(group).getByText("How urgent this is")).toBeInTheDocument();
    expect(within(group).getByText("Tags")).toBeInTheDocument();
    expect(within(group).getByText("Count")).toBeInTheDocument();
    expect(within(group).queryByText("Contract")).toBeNull();
  });

  test("picking one gives it a row with its own control", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(editor({ onChange: onChange }));

    fireEvent.click(screen.getByTestId("model-column-add"));
    fireEvent.click(
      await screen.findByTestId("model-column-add-option-customFields.Count"),
    );

    const box: HTMLElement = await screen.findByTestId(
      "model-column-value-customFields.Count",
    );

    expect(box).toHaveAttribute("type", "number");

    fireEvent.change(box, { target: { value: "7" } });

    expect(lastValue(onChange)).toEqual({ customFields: { Count: 7 } });
  });

  test("names what cannot be a row as JSON only, and not Custom Fields itself", () => {
    render(editor({}));

    expect(
      screen.getByText("Contract can only be set with Edit as JSON."),
    ).toBeInTheDocument();
  });

  test("says nothing of them where the project has none", async () => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: [],
      isLoading: false,
    });

    render(editor({}));

    fireEvent.click(screen.getByTestId("model-column-add"));

    await screen.findByTestId("model-column-add-panel");

    expect(screen.queryByTestId("model-column-add-group-custom")).toBeNull();
    expect(screen.queryByText(/can only be set with Edit as JSON/)).toBeNull();
  });
});

describe("a stored bag of custom fields", () => {
  test("is a row for each, by name, not a JSON editor", () => {
    render(
      editor({
        value: {
          customFields: { "Priority Level": "P1", Count: 3, Reviewed: true },
        },
      }),
    );

    expect(screen.queryByText("Editing as JSON, because:")).toBeNull();
    expect(screen.getByText("Priority Level")).toBeInTheDocument();
    expect(
      screen.getByTestId("model-column-value-customFields.Count"),
    ).toHaveValue(3);
    expect(screen.getAllByText(CustomFieldRowCopy.chip)).toHaveLength(3);
    expect(screen.getByText("3 fields set")).toBeInTheDocument();
  });

  test("does not change for being opened", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: { customFields: { Tags: ["blue"], Count: 3 } },
        onChange: onChange,
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  test("keeps a field the project no longer has, saying so", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: { customFields: { "Old Field": "kept", Count: 1 } },
        onChange: onChange,
      }),
    );

    expect(screen.getByText("Old Field")).toBeInTheDocument();
    expect(
      screen.getByTestId("model-column-no-such-custom-field"),
    ).toHaveTextContent(CustomFieldRowCopy.noSuchField);
    // Not the warning for a misspelled column: the row has it covered.
    expect(screen.queryByText(/isn't a known column/)).toBeNull();

    fireEvent.change(
      screen.getByTestId("model-column-value-customFields.Count"),
      { target: { value: "2" } },
    );

    expect(lastValue(onChange)).toEqual({
      customFields: { "Old Field": "kept", Count: 2 },
    });
  });

  test("changing one field leaves the others as they are", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: {
          title: "Down",
          customFields: { Tags: ["blue"], Count: 1, Reviewed: false },
        },
        onChange: onChange,
      }),
    );

    fireEvent.change(
      screen.getByTestId("model-column-value-customFields.Count"),
      { target: { value: "2" } },
    );

    expect(lastValue(onChange)).toEqual({
      title: "Down",
      customFields: { Tags: ["blue"], Count: 2, Reviewed: false },
    });
  });

  test("removing the last one leaves nothing written for the column", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({ value: { customFields: { Count: 1 } }, onChange: onChange }),
    );

    fireEvent.click(
      screen.getByTestId("model-column-remove-customFields.Count"),
    );

    const calls: Array<Array<unknown>> = (onChange as unknown as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls[calls.length - 1]?.[0]).toBe("");
  });

  test("a date is a date box, holding the date", () => {
    render(editor({ value: { customFields: { "Due On": "2026-11-20" } } }));

    const box: HTMLElement = screen.getByTestId(
      "model-column-value-customFields.Due On",
    );

    expect(box).toHaveAttribute("type", "date");
    expect(box).toHaveValue("2026-11-20");
  });

  test("a dropdown shows its value and lists its options", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: { customFields: { "Priority Level": "P1" } },
        onChange: onChange,
      }),
    );

    expect(screen.getByText("P1")).toBeInTheDocument();

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText("P2"));
    });

    expect(lastValue(onChange)).toEqual({
      customFields: { "Priority Level": "P2" },
    });
  });

  test("a multi-select shows its values and adds to them", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: { customFields: { Tags: ["blue"] } },
        onChange: onChange,
      }),
    );

    expect(screen.getByText("blue")).toBeInTheDocument();

    const box: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText("green"));
    });

    expect(lastValue(onChange)).toEqual({
      customFields: { Tags: ["blue", "green"] },
    });
  });

  test("an option since removed is shown as it is", () => {
    render(editor({ value: { customFields: { "Priority Level": "P9" } } }));

    expect(screen.getByText("P9")).toBeInTheDocument();
  });

  test("a file's reference stays JSON, saying which field", () => {
    render(
      editor({
        value: { customFields: { Contract: { fileId: "x" } } },
      }),
    );

    expect(screen.getByText("Editing as JSON, because:")).toBeInTheDocument();
    expect(screen.getByText(/customFields\.Contract/)).toBeInTheDocument();
  });
});

describe("Edit as JSON and back", () => {
  test("shows the column as it is stored, and returns to the rows", async () => {
    render(editor({ value: { customFields: { Count: 3 } } }));

    fireEvent.click(screen.getByTestId("model-column-json-toggle"));

    expect(screen.getByText("Back to fields")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("model-column-json-toggle"));

    expect(
      await screen.findByTestId("model-column-value-customFields.Count"),
    ).toHaveValue(3);
  });
});

describe("a query", () => {
  test("offers custom fields to filter on, and reads their conditions as rows", () => {
    render(
      editor({
        mode: ModelColumnEditorMode.Query,
        value: { customFields: { Count: { _type: "GreaterThan", value: 2 } } },
      }),
    );

    expect(screen.queryByText("Editing as JSON, because:")).toBeNull();
    expect(screen.getByText("1 condition set")).toBeInTheDocument();
    expect(
      screen.getByTestId("model-column-value-customFields.Count"),
    ).toHaveValue(2);
  });

  test("a changed condition stays under the column", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        mode: ModelColumnEditorMode.Query,
        value: { customFields: { Count: 2 } },
        onChange: onChange,
      }),
    );

    fireEvent.change(
      screen.getByTestId("model-column-value-customFields.Count"),
      { target: { value: "5" } },
    );

    expect(lastValue(onChange)).toEqual({ customFields: { Count: 5 } });
  });

  test("a condition on a field the project no longer has says so", () => {
    render(
      editor({
        mode: ModelColumnEditorMode.Query,
        value: { customFields: { "Old Field": "x" } },
      }),
    );

    expect(screen.getByTestId("model-column-unknown-note")).toHaveTextContent(
      CustomFieldRowCopy.noSuchField,
    );
    expect(screen.queryByText(/isn't a known column/)).toBeNull();
  });
});

describe("while they load", () => {
  test("the editor waits, rather than calling every stored field unknown", () => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: [],
      isLoading: true,
    });

    render(editor({ value: { customFields: { Count: 3 } } }));

    expect(
      screen.queryByTestId("model-column-value-customFields.Count"),
    ).toBeNull();
    expect(
      screen.queryByTestId("model-column-no-such-custom-field"),
    ).toBeNull();
  });
});

describe("custom fields that cannot be read", () => {
  test("a stored value still shows, and keeps its bytes", () => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: [],
      isLoading: false,
    });

    const onChange: MockFunction = getJestMockFunction();

    render(
      editor({
        value: { customFields: { Customer: "Acme" } },
        onChange: onChange,
      }),
    );

    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a step opened to be read", () => {
  test("shows them by name, with no way to add or remove one", () => {
    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        {editor({ value: { customFields: { Count: 3 } } })}
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.queryByTestId("model-column-add")).toBeNull();
    expect(
      screen.queryByTestId("model-column-remove-customFields.Count"),
    ).toBeNull();
  });
});

describe("From Another Tool's Custom Fields", () => {
  describe("wrapCustomFieldsValue", () => {
    test("reads the setting as a record's bag", () => {
      expect(wrapCustomFieldsValue('{"caseNumber":"CAS-1"}')).toBe(
        '{"customFields":{"caseNumber":"CAS-1"}}',
      );
      expect(wrapCustomFieldsValue({ caseNumber: "CAS-1" })).toBe(
        '{"customFields":{"caseNumber":"CAS-1"}}',
      );
    });

    test("an empty setting is empty", () => {
      expect(wrapCustomFieldsValue("")).toBe("");
      expect(wrapCustomFieldsValue(null)).toBe("");
      expect(wrapCustomFieldsValue(undefined)).toBe("");
    });

    test("what is no JSON object goes through as it is, for the editor to keep", () => {
      expect(wrapCustomFieldsValue("{{local.variables.bag}}")).toBe(
        "{{local.variables.bag}}",
      );
      expect(wrapCustomFieldsValue("[1,2]")).toBe("[1,2]");
    });
  });

  describe("unwrapCustomFieldsValue", () => {
    test("writes the bag as the setting stores it", () => {
      expect(
        unwrapCustomFieldsValue('{"customFields":{"caseNumber":"CAS-1"}}'),
      ).toBe('{"caseNumber":"CAS-1"}');
    });

    test("an empty editor is an empty setting", () => {
      expect(unwrapCustomFieldsValue("")).toBe("");
    });

    test("anything else is kept as typed", () => {
      expect(unwrapCustomFieldsValue('{"customFields": {"a"')).toBe(
        '{"customFields": {"a"',
      );
      expect(unwrapCustomFieldsValue('{"other":1}')).toBe('{"other":1}');
    });

    test("reads back what wrapping wrote, byte for byte", () => {
      const stored: string = '{"caseNumber":"CAS-1","count":2}';

      expect(
        unwrapCustomFieldsValue(wrapCustomFieldsValue(stored) as string),
      ).toBe(stored);
    });
  });

  test("offers only the custom fields, and stores them with no column around them", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <CustomFieldsArgumentEditor
        tableName="Incident"
        initialValue='{"Count":1}'
        onChange={onChange as never}
      />,
    );

    const box: HTMLElement = screen.getByTestId(
      "model-column-value-customFields.Count",
    );

    fireEvent.change(box, { target: { value: "2" } });

    expect(onChange).toHaveBeenLastCalledWith('{"Count":2}');

    fireEvent.click(screen.getByTestId("model-column-add"));

    await screen.findByTestId("model-column-add-group-custom");

    // No Title among them: this setting holds custom fields and nothing else.
    expect(screen.queryByTestId("model-column-add-option-title")).toBeNull();
    // And no adding a column by name: the list is the project's own.
    expect(screen.queryByTestId("model-column-add-by-name")).toBeNull();
  });

  describe("in a project with no custom fields", () => {
    beforeEach(() => {
      (useCustomFields as jest.Mock).mockReturnValue({
        fields: [],
        isLoading: false,
      });
    });

    test("says so, with nothing to add, and JSON still there", () => {
      render(
        <CustomFieldsArgumentEditor
          tableName="Incident"
          initialValue=""
          onChange={getJestMockFunction() as never}
        />,
      );

      expect(screen.getByText(CustomFieldRowCopy.noneYet)).toBeInTheDocument();
      expect(screen.queryByTestId("model-column-add")).toBeNull();
      expect(screen.queryByTestId("model-column-add-custom")).toBeNull();
      expect(
        screen.getByTestId("model-column-json-toggle"),
      ).toBeInTheDocument();
    });

    test("what a step already holds shows, kept as it was", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <CustomFieldsArgumentEditor
          tableName="Incident"
          initialValue='{"caseNumber":"CAS-1"}'
          onChange={onChange as never}
        />,
      );

      expect(screen.getByText("caseNumber")).toBeInTheDocument();
      expect(screen.queryByText(CustomFieldRowCopy.noneYet)).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    test("a reference for the whole setting stays as JSON", () => {
      render(
        <CustomFieldsArgumentEditor
          tableName="Incident"
          initialValue="{{local.variables.bag}}"
          onChange={getJestMockFunction() as never}
        />,
      );

      expect(screen.queryByText(CustomFieldRowCopy.noneYet)).toBeNull();
      expect(screen.queryByTestId("model-column-add")).toBeNull();
    });
  });

  test("once every custom field has a row, there is nothing left to add", () => {
    (useCustomFields as jest.Mock).mockReturnValue({
      fields: [FIELDS[2]],
      isLoading: false,
    });

    render(
      <CustomFieldsArgumentEditor
        tableName="Incident"
        initialValue='{"Count":1}'
        onChange={getJestMockFunction() as never}
      />,
    );

    expect(screen.queryByTestId("model-column-add")).toBeNull();
    expect(screen.queryByTestId("model-column-add-custom")).toBeNull();
  });

  test("a step opened to be read shows them, and changes nothing", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        <CustomFieldsArgumentEditor
          tableName="Incident"
          initialValue='{"Count":1}'
          onChange={onChange as never}
        />
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.queryByTestId("model-column-add")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
