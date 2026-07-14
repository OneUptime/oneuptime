import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Table, { BulkActionProps } from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

/*
 * react-i18next is not initialized in the test environment. Mock the hook so
 * translate helpers echo their input and the Table renders synchronously.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const data: Array<Row> = [
  { _id: "1", name: "Alpha" },
  { _id: "2", name: "Beta" },
];

interface RenderTableOptions {
  bulkActions?: BulkActionProps<Row> | undefined;
  bulkSelectedItems?: Array<Row> | undefined;
  disableBulkCsvExport?: boolean | undefined;
}

type RenderTableFunction = (options: RenderTableOptions) => RenderResult;

const renderTable: RenderTableFunction = (
  options: RenderTableOptions,
): RenderResult => {
  return render(
    <Table<Row>
      id="test-table"
      data={data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      matchBulkSelectedItemByField="_id"
      bulkActions={options.bulkActions}
      bulkSelectedItems={options.bulkSelectedItems}
      disableBulkCsvExport={options.disableBulkCsvExport}
    />,
  );
};

const customBulkActions: BulkActionProps<Row> = {
  buttons: [
    {
      title: "Archive",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  ],
};

describe("Table bulk CSV export", () => {
  let createObjectURLMock: MockFunction;
  let revokeObjectURLMock: MockFunction;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    createObjectURLMock = getJestMockFunction();
    createObjectURLMock.mockReturnValue("blob:mock-url");
    revokeObjectURLMock = getJestMockFunction();

    (window.URL as unknown as { createObjectURL: unknown }).createObjectURL =
      createObjectURLMock;
    (window.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      revokeObjectURLMock;

    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  test("shows an Export CSV action when the table has bulk actions and rows are selected", () => {
    const { getByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: [data[0]!],
    });

    // The bulk action bar is visible with the selected count.
    expect(getByText("1 Monitors Selected")).toBeTruthy();

    // Open the Bulk Actions menu.
    fireEvent.click(getByText("Bulk Actions"));

    // Both the table's own action and the injected Export CSV are present.
    expect(getByText("Archive")).toBeTruthy();
    expect(getByText("Export CSV")).toBeTruthy();
  });

  test("clicking Export CSV triggers a client-side CSV download of the selection", () => {
    const { getByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: [data[0]!],
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const blobArg: Blob = createObjectURLMock.mock.calls[0]![0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toContain("text/csv");
  });

  test("does not inject Export CSV when disableBulkCsvExport is set", () => {
    const { getByText, queryByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: [data[0]!],
      disableBulkCsvExport: true,
    });

    fireEvent.click(getByText("Bulk Actions"));

    expect(getByText("Archive")).toBeTruthy();
    expect(queryByText("Export CSV")).toBeNull();
  });

  test("does not render the bulk action bar (or Export CSV) when there are no bulk actions", () => {
    const { queryByText } = renderTable({
      bulkActions: undefined,
      bulkSelectedItems: [data[0]!],
    });

    expect(queryByText("Bulk Actions")).toBeNull();
    expect(queryByText("Export CSV")).toBeNull();
  });
});
