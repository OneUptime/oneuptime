/*
 * What the builder actually sees.
 *
 * The complaint this editor exists to answer was that it asked for things the
 * model schema had already said: the column's name, typed as free text into a
 * box labelled "Key", and the value's type, picked from a dropdown offering
 * Text / Number / Boolean. The first two suites below are about those two
 * questions being gone.
 *
 * The third is about the invariant that guards every saved workflow: this
 * component is mounted every time someone opens a step's settings, so it must
 * not report a change until a change is actually made.
 */

import React from "react";

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return String(error);
      }),
    },
  };
});

/*
 * Monaco cannot run in jsdom. A textarea that echoes the value is enough to
 * assert what the JSON view was handed and to type into it.
 */
jest.mock("@monaco-editor/react", () => {
  return {
    __esModule: true,
    loader: { config: jest.fn() },
    default: (editorProps: {
      value?: string | undefined;
      onChange?: ((value: string | undefined) => void) | undefined;
    }) => {
      return (
        <textarea
          data-testid="monaco"
          value={editorProps.value || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            editorProps.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../UI/Components/Workflow/ModelSchema";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";

type MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
) => ModelSchemaColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<ModelSchemaColumn> & { id: string },
): ModelSchemaColumn => {
  return {
    title: overrides.id,
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

const COLUMNS: Array<ModelSchemaColumn> = [
  makeColumn({
    id: "_id",
    title: "ID",
    type: TableColumnType.ObjectID,
    description: "The unique ID of this Incident State.",
  }),
  makeColumn({
    id: "name",
    title: "Name",
    type: TableColumnType.Name,
    required: true,
    description: "The name of this Incident State.",
  }),
  makeColumn({
    id: "color",
    title: "Color",
    type: TableColumnType.Color,
    required: true,
    description: "The color shown against this state.",
  }),
  makeColumn({
    id: "order",
    title: "Order",
    type: TableColumnType.Number,
    description: "Where this state sits in the list.",
  }),
  makeColumn({
    id: "isResolvedState",
    title: "Is Resolved State",
    type: TableColumnType.Boolean,
    description: "Whether reaching this state resolves the incident.",
  }),
  makeColumn({
    id: "createdAt",
    title: "Created At",
    type: TableColumnType.Date,
    description: "When this row was created.",
  }),
  makeColumn({
    id: "projectId",
    title: "Project ID",
    type: TableColumnType.ObjectID,
    isTenantColumn: true,
  }),
  makeColumn({
    id: "monitorSteps",
    title: "Monitor Steps",
    type: TableColumnType.MonitorSteps,
  }),
];

type MockApiGetFunction = () => MockFunction;

const apiGet: MockApiGetFunction = (): MockFunction => {
  return API.get as unknown as MockFunction;
};

type ResolveSchemaFunction = (columns?: Array<ModelSchemaColumn>) => void;

const resolveSchemaWith: ResolveSchemaFunction = (
  columns?: Array<ModelSchemaColumn>,
): void => {
  apiGet().mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      { columns: columns || COLUMNS } as unknown as JSONObject,
      {},
    ),
  );
};

type RenderEditorProps = {
  mode?: ModelColumnEditorMode | undefined;
  initialValue?: string | undefined;
  recordIntent?: RecordIntent | undefined;
  onChange?: MockFunction | undefined;
  valueSuggestions?: Array<string> | undefined;
};

type RenderEditorFunction = (props?: RenderEditorProps) => RenderResult;

const renderEditor: RenderEditorFunction = (
  props?: RenderEditorProps,
): RenderResult => {
  return render(
    <ModelColumnEditor
      tableName="IncidentState"
      mode={props?.mode || ModelColumnEditorMode.Record}
      initialValue={props?.initialValue}
      recordIntent={props?.recordIntent}
      valueSuggestions={props?.valueSuggestions}
      onChange={
        (props?.onChange as unknown as (value: string) => void) ||
        ((): void => {})
      }
    />,
  );
};

beforeEach(() => {
  resolveSchemaWith();
});

afterEach(() => {
  apiGet().mockReset();
});

describe("the schema is used instead of being asked for", () => {
  test("fields are labelled with the model's own titles and descriptions", async () => {
    const { findByText, getByText }: RenderResult = renderEditor();

    expect(await findByText("Name")).toBeInTheDocument();
    expect(getByText("Color")).toBeInTheDocument();
    expect(getByText("The name of this Incident State.")).toBeInTheDocument();
    expect(
      getByText("The color shown against this state."),
    ).toBeInTheDocument();
  });

  test("the column name is shown, not asked for", async () => {
    const { findByText, queryByPlaceholderText }: RenderResult = renderEditor();

    await findByText("Name");

    /*
     * "Column" was the placeholder of the free-text key box. Its absence is the
     * complaint being answered.
     */
    expect(queryByPlaceholderText("Column")).toBeNull();
    expect(queryByPlaceholderText("Key")).toBeNull();
  });

  test("nothing anywhere asks what type the value is", async () => {
    const { findByText, queryByText }: RenderResult = renderEditor();

    await findByText("Name");

    /*
     * The old Type dropdown offered these three against every column, next to a
     * schema that already knew. If any of them is on screen it is back.
     */
    expect(queryByText("Type")).toBeNull();
    expect(queryByText("Number")).toBeNull();
    expect(queryByText("Boolean")).toBeNull();
  });

  test("each field says what kind of value it wants, from the schema", async () => {
    const { findByText, getByText }: RenderResult = renderEditor({
      initialValue: '{"order":1,"isResolvedState":true,"createdAt":null}',
      recordIntent: RecordIntent.Update,
    });

    expect(await findByText("Order")).toBeInTheDocument();
    expect(getByText("Number")).toBeInTheDocument();
    expect(getByText("True or false")).toBeInTheDocument();
    expect(getByText("Date and time")).toBeInTheDocument();
  });
});

describe("the control comes from the column type", () => {
  test("a number column gets a number input", async () => {
    const { findByTestId }: RenderResult = renderEditor({
      initialValue: '{"order":3}',
      recordIntent: RecordIntent.Update,
    });

    const input: HTMLElement = await findByTestId("model-column-value-order");

    expect(input).toHaveAttribute("type", "number");

    /*
     * The shared Input writes its value into the DOM from an effect rather than
     * from a value prop, so this settles a render after the element appears.
     */
    await waitFor(() => {
      expect(input).toHaveValue(3);
    });
  });

  test("a date column gets a date-and-time input", async () => {
    const { findByTestId }: RenderResult = renderEditor({
      initialValue: '{"createdAt":"2026-08-15T09:30:00.000Z"}',
      recordIntent: RecordIntent.Update,
    });

    expect(await findByTestId("model-column-value-createdAt")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  test('a boolean column gets three states, so "not set" can be said', async () => {
    const { findByText, getByText }: RenderResult = renderEditor({
      initialValue: '{"isResolvedState":true}',
      recordIntent: RecordIntent.Update,
    });

    expect(await findByText("True")).toBeInTheDocument();
    expect(getByText("False")).toBeInTheDocument();
    expect(getByText("Not set")).toBeInTheDocument();
  });

  test("a column no row can hold is named rather than silently missing", async () => {
    const { findByText }: RenderResult = renderEditor();

    expect(
      await findByText(/Monitor Steps.*can only be set with Edit as JSON/),
    ).toBeInTheDocument();
  });
});

describe("opening a step does not rewrite what it does", () => {
  test("nothing is reported while the schema is still loading", async () => {
    const onChange: MockFunction = getJestMockFunction();

    renderEditor({ onChange: onChange });

    await waitFor(() => {
      expect(apiGet()).toHaveBeenCalled();
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("nothing is reported after the schema resolves and rows are seeded", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByText }: RenderResult = renderEditor({ onChange: onChange });

    await findByText("Name");

    expect(onChange).not.toHaveBeenCalled();
  });

  test("nothing is reported when a stored value is loaded", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByText }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged","color":"#ffffff"}',
      onChange: onChange,
    });

    await findByText("Name");

    expect(onChange).not.toHaveBeenCalled();
  });

  test("nothing is reported by switching to JSON and back", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByTestId, getByTestId }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged"}',
      onChange: onChange,
    });

    fireEvent.click(await findByTestId("model-column-json-toggle"));
    fireEvent.click(getByTestId("model-column-json-toggle"));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("editing a value is reported, with the exact JSON that will be stored", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByTestId }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged"}',
      recordIntent: RecordIntent.Update,
      onChange: onChange,
    });

    fireEvent.change(await findByTestId("model-column-value-name"), {
      target: { value: "Resolved" },
    });

    expect(onChange).toHaveBeenCalledWith('{"name":"Resolved"}');
  });

  test("a number is stored as a number, not as the text that was typed", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByTestId }: RenderResult = renderEditor({
      initialValue: '{"order":1}',
      recordIntent: RecordIntent.Update,
      onChange: onChange,
    });

    fireEvent.change(await findByTestId("model-column-value-order"), {
      target: { value: "7" },
    });

    expect(onChange).toHaveBeenCalledWith('{"order":7}');
  });

  test("a boolean is stored as a boolean", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { findByText }: RenderResult = renderEditor({
      initialValue: '{"isResolvedState":true}',
      recordIntent: RecordIntent.Update,
      onChange: onChange,
    });

    fireEvent.click(await findByText("False"));

    expect(onChange).toHaveBeenCalledWith('{"isResolvedState":false}');
  });
});

describe("a create opens on the fields it needs; an update does not", () => {
  test("a create opens with a row for every column it must be given", async () => {
    const { findByText, getByText }: RenderResult = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    expect(await findByText("Name")).toBeInTheDocument();
    expect(getByText("Color")).toBeInTheDocument();
  });

  test("and says how many of them are still empty", async () => {
    const { findByText }: RenderResult = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    expect(
      await findByText(/2 required fields still empty/),
    ).toBeInTheDocument();
  });

  test("an update opens on nothing, because it legitimately writes one column", async () => {
    const { findByText, queryByText }: RenderResult = renderEditor({
      recordIntent: RecordIntent.Update,
    });

    expect(await findByText("No fields set yet")).toBeInTheDocument();
    expect(queryByText("Color")).toBeNull();
  });

  test("the project column is never seeded — the workflow stamps it itself", async () => {
    const { findByText, queryByText }: RenderResult = renderEditor({
      recordIntent: RecordIntent.Create,
    });

    await findByText("Name");

    expect(queryByText("Project ID")).toBeNull();
  });
});

describe("editing as JSON", () => {
  test("the JSON view is offered and shows what is stored", async () => {
    const { findByTestId, getByTestId }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged"}',
      recordIntent: RecordIntent.Update,
    });

    fireEvent.click(await findByTestId("model-column-json-toggle"));

    expect(getByTestId("monaco")).toHaveValue('{"name":"Acknowledged"}');
  });

  test("a key added in the JSON view is there as a field on the way back", async () => {
    /*
     * The rows used to be seeded once and never re-read, so this edit was
     * silently discarded and the next keystroke in any row wrote the pre-edit
     * content back over it.
     */
    const { findByTestId, getByTestId, getByText }: RenderResult = renderEditor(
      {
        initialValue: '{"name":"Acknowledged"}',
        recordIntent: RecordIntent.Update,
      },
    );

    fireEvent.click(await findByTestId("model-column-json-toggle"));
    fireEvent.change(getByTestId("monaco"), {
      target: { value: '{"name":"Acknowledged","color":"#ffffff"}' },
    });
    fireEvent.click(getByTestId("model-column-json-toggle"));

    expect(getByText("Color")).toBeInTheDocument();
    await waitFor(() => {
      expect(getByTestId("model-column-value-color")).toHaveValue("#ffffff");
    });
  });

  test("an edit rows cannot show refuses the trip back rather than losing it", async () => {
    const { findByTestId, getByTestId, getByText }: RenderResult = renderEditor(
      {
        initialValue: '{"name":"Acknowledged"}',
        recordIntent: RecordIntent.Update,
      },
    );

    fireEvent.click(await findByTestId("model-column-json-toggle"));
    fireEvent.change(getByTestId("monaco"), {
      target: { value: '{"name":{"nested":"value"}}' },
    });
    fireEvent.click(getByTestId("model-column-json-toggle"));

    // Still on JSON, with the edit intact and a reason given.
    expect(getByTestId("monaco")).toHaveValue('{"name":{"nested":"value"}}');
    expect(getByText(/can't go back to fields/)).toBeInTheDocument();
  });

  test("a value rows cannot show at all opens on JSON with the reason on screen", async () => {
    const { findByText, queryByTestId }: RenderResult = renderEditor({
      initialValue: '{"labels":["a","b"]}',
      recordIntent: RecordIntent.Update,
    });

    expect(await findByText(/Editing as JSON, because/)).toBeInTheDocument();
    expect(queryByTestId("model-column-json-toggle")).toBeNull();
  });
});

describe("values the rows keep faithfully", () => {
  test("a column this model does not describe keeps its row and is flagged", async () => {
    const { findByText, getByDisplayValue }: RenderResult = renderEditor({
      initialValue: '{"id":"00000000-0000-0000-0000-000000000000"}',
      recordIntent: RecordIntent.Update,
    });

    // The "id" versus "_id" mistake has to stay visible, and fixable.
    expect(await findByText("Not a column on this model")).toBeInTheDocument();
    expect(getByDisplayValue("id")).toBeInTheDocument();
  });

  test("a stored value whose type disagrees with the column is left alone", async () => {
    const { findByText }: RenderResult = renderEditor({
      initialValue: '{"order":"3"}',
      recordIntent: RecordIntent.Update,
    });

    expect(
      await findByText(/Kept exactly as it was saved/),
    ).toBeInTheDocument();
  });

  test("a reference is shown as a reference on a numeric column", async () => {
    const { findByDisplayValue }: RenderResult = renderEditor({
      initialValue: '{"order":"{{local.variables.position}}"}',
      recordIntent: RecordIntent.Update,
      valueSuggestions: ["{{local.variables.position}}"],
    });

    expect(
      await findByDisplayValue("{{local.variables.position}}"),
    ).toBeInTheDocument();
  });
});

describe("query mode", () => {
  test("conditions get a real column picker and a comparison, not a type", async () => {
    const { findByText, queryByText }: RenderResult = renderEditor({
      mode: ModelColumnEditorMode.Query,
      initialValue: '{"name":"Acknowledged"}',
    });

    expect(await findByText("Column")).toBeInTheDocument();
    expect(await findByText("Comparison")).toBeInTheDocument();
    expect(queryByText("Type")).toBeNull();
  });

  test("an empty query says what that means, which on a delete matters", async () => {
    const { findByText, getByText }: RenderResult = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    expect(await findByText("No conditions yet")).toBeInTheDocument();
    expect(
      getByText("With no conditions this matches every record in the project."),
    ).toBeInTheDocument();
  });

  test("a query is never seeded with required fields — it is not a record", async () => {
    const { findByText }: RenderResult = renderEditor({
      mode: ModelColumnEditorMode.Query,
    });

    expect(await findByText("No conditions yet")).toBeInTheDocument();
  });
});

describe("when the schema cannot be loaded", () => {
  test("the failure is shown and the value stays editable", async () => {
    apiGet().mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}),
    );

    const { findByText, getByTestId }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged"}',
      recordIntent: RecordIntent.Update,
    });

    expect(
      await findByText(/Couldn't load this model's columns/),
    ).toBeInTheDocument();

    // The escape hatch is still there, which is the whole point of keeping it.
    expect(getByTestId("model-column-json-toggle")).toBeInTheDocument();
  });

  test("a stored field still gets a row, with its key editable", async () => {
    apiGet().mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}),
    );

    const { findByDisplayValue }: RenderResult = renderEditor({
      initialValue: '{"name":"Acknowledged"}',
      recordIntent: RecordIntent.Update,
    });

    expect(await findByDisplayValue("name")).toBeInTheDocument();
  });
});
