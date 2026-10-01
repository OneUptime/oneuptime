/*
 * The "Select Fields" picker on the Find components and the triggers - which
 * fields of a record a step reads back.
 *
 * Unlike a create, a select is exactly where the columns OneUptime fills in
 * belong: "when was this incident created, and by whom" is a question a
 * workflow asks. What it should not list is a column that is empty on every
 * record it can read - records are deleted outright, so Deleted At and Deleted
 * by User never hold anything.
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

import HTTPResponse from "../../../../Types/API/HTTPResponse";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ModelFieldPicker, {
  PickerColumn,
  columnsToList,
} from "../../../../UI/Components/Workflow/ModelFieldPicker";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

type MakeColumnFunction = (
  overrides: Partial<PickerColumn> & { id: string; title: string },
) => PickerColumn;

const makeColumn: MakeColumnFunction = (
  overrides: Partial<PickerColumn> & { id: string; title: string },
): PickerColumn => {
  return {
    type: TableColumnType.ShortText,
    isRelation: false,
    ...overrides,
  };
};

const RELATED_PROJECT_COLUMNS: Array<PickerColumn> = [
  makeColumn({ id: "_id", title: "ID", type: TableColumnType.ObjectID }),
  makeColumn({ id: "name", title: "Name" }),
  makeColumn({
    id: "deletedAt",
    title: "Deleted At",
    type: TableColumnType.Date,
  }),
];

const COLUMNS: Array<PickerColumn> = [
  makeColumn({ id: "_id", title: "ID", type: TableColumnType.ObjectID }),
  makeColumn({
    id: "createdAt",
    title: "Created At",
    type: TableColumnType.Date,
  }),
  makeColumn({
    id: "deletedAt",
    title: "Deleted At",
    type: TableColumnType.Date,
  }),
  makeColumn({
    id: "createdByUserId",
    title: "Created by User ID",
    type: TableColumnType.ObjectID,
  }),
  makeColumn({
    id: "deletedByUserId",
    title: "Deleted by User ID",
    type: TableColumnType.ObjectID,
  }),
  makeColumn({
    id: "deletedByUser",
    title: "Deleted by User",
    type: TableColumnType.Entity,
    isRelation: true,
    relatedColumns: [makeColumn({ id: "name", title: "Name" })],
  }),
  makeColumn({ id: "title", title: "Title" }),
  makeColumn({
    id: "project",
    title: "Project",
    type: TableColumnType.Entity,
    isRelation: true,
    relatedColumns: RELATED_PROJECT_COLUMNS,
  }),
];

type IdsFunction = (columns: Array<PickerColumn>) => Array<string>;

const ids: IdsFunction = (columns: Array<PickerColumn>): Array<string> => {
  return columns.map((column: PickerColumn) => {
    return column.id;
  });
};

describe("columnsToList", () => {
  test("keeps the columns OneUptime fills in - they are worth reading back", () => {
    const listed: Array<string> = ids(columnsToList(COLUMNS, null));

    expect(listed).toContain("_id");
    expect(listed).toContain("createdAt");
    expect(listed).toContain("createdByUserId");
    expect(listed).toContain("title");
  });

  test("leaves out the ones empty on every record", () => {
    const listed: Array<string> = ids(columnsToList(COLUMNS, null));

    expect(listed).not.toContain("deletedAt");
    expect(listed).not.toContain("deletedByUserId");
    expect(listed).not.toContain("deletedByUser");
  });

  test("on a related record too", () => {
    const project: PickerColumn | undefined = columnsToList(COLUMNS, {}).find(
      (column: PickerColumn) => {
        return column.id === "project";
      },
    );

    expect(ids(project?.relatedColumns || [])).toEqual(["_id", "name"]);
  });

  /*
   * A select saved before this change may name one. It stays listed, ticked,
   * so it can be seen and unticked rather than carried along invisibly.
   */
  test("keeps one a stored selection already names", () => {
    const stored: JSONObject = {
      deletedAt: true,
      project: { deletedAt: true },
    };
    const listed: Array<PickerColumn> = columnsToList(COLUMNS, stored);

    expect(ids(listed)).toContain("deletedAt");
    expect(ids(listed)).not.toContain("deletedByUserId");

    const project: PickerColumn | undefined = listed.find(
      (column: PickerColumn) => {
        return column.id === "project";
      },
    );

    expect(ids(project?.relatedColumns || [])).toContain("deletedAt");
  });

  test("leaves the schema it was given untouched", () => {
    columnsToList(COLUMNS, null);

    expect(ids(COLUMNS)).toContain("deletedAt");
    expect(ids(RELATED_PROJECT_COLUMNS)).toContain("deletedAt");
  });
});

type MockApiGetFunction = () => MockFunction;

const apiGet: MockApiGetFunction = (): MockFunction => {
  return API.get as unknown as MockFunction;
};

beforeEach(() => {
  apiGet().mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      { tableName: "Incident", columns: COLUMNS } as unknown as JSONObject,
      {},
    ),
  );
});

afterEach(() => {
  apiGet().mockReset();
});

describe("the Select Fields picker", () => {
  test("lists Created At and leaves Deleted At out", async () => {
    render(<ModelFieldPicker tableName="Incident" onChange={(): void => {}} />);

    expect(await screen.findByText("Created At")).toBeInTheDocument();
    expect(screen.getByText("Created by User ID")).toBeInTheDocument();
    expect(screen.queryByText("Deleted At")).toBeNull();
    expect(screen.queryByText("Deleted by User ID")).toBeNull();
    expect(screen.queryByText("Deleted by User")).toBeNull();
  });

  test("still treats a stored select naming Deleted At as a select, not as broken JSON", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ModelFieldPicker
        tableName="Incident"
        initialValue='{"title":true,"deletedAt":true}'
        onChange={onChange as unknown as (value: string) => void}
      />,
    );

    const label: HTMLElement = (await screen.findByText("Deleted At")).closest(
      "label",
    ) as HTMLElement;
    const checkbox: HTMLInputElement = label.querySelector(
      "input",
    ) as HTMLInputElement;

    // The stored selection is read in an effect after the columns arrive.
    await waitFor(() => {
      expect(checkbox).toBeChecked();
    });

    expect(screen.queryByText(/Keeping your selection as JSON/)).toBeNull();

    // Unticking it drops it from the stored select.
    fireEvent.click(label);

    expect(onChange).toHaveBeenLastCalledWith('{"title":true}');
  });
});
