import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Table, { BulkActionProps } from "../../../UI/Components/Table/Table";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
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
  description?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Description", type: FieldType.Text, key: "description" },
];

const data: Array<Row> = [
  { _id: "1", name: "Alpha", description: "First" },
  { _id: "2", name: "Beta", description: "Second" },
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
  let downloadedCsvFiles: Array<{ csv: string; filename: string }> = [];
  let downloadCsvSpy: jest.SpyInstance;

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

    downloadedCsvFiles = [];
  });

  type SpyOnDownloadFunction = () => void;

  /*
   * Asserting on the CSV text the exporter hands to the browser, rather than
   * on the opaque Blob, is what lets these tests see an export whose rows are
   * all blank - the shape the bug produced.
   */
  const spyOnDownload: SpyOnDownloadFunction = (): void => {
    downloadCsvSpy = jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((...args: Array<unknown>): void => {
        downloadedCsvFiles.push(args[0] as { csv: string; filename: string });
      });
  };

  afterEach(() => {
    clickSpy.mockRestore();
    downloadCsvSpy?.mockRestore();
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

  test("the exported CSV carries the values of every selected row", () => {
    spyOnDownload();

    const { getByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: data,
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    expect(downloadedCsvFiles.length).toBe(1);
    expect(downloadedCsvFiles[0]!.csv.split("\r\n")).toEqual([
      "Name,Description",
      "Alpha,First",
      "Beta,Second",
    ]);
  });

  test("it exports the selection, not the rows on screen", () => {
    spyOnDownload();

    /*
     * The selection outgrows the page as soon as the user selects across
     * pages or picks "Select All", so the export has to follow
     * bulkSelectedItems rather than the rendered data.
     */
    const selection: Array<Row> = [];

    for (let i: number = 0; i < 30; i++) {
      selection.push({
        _id: `${i}`,
        name: `Row ${i}`,
        description: `Desc ${i}`,
      });
    }

    const { getByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: selection,
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    const lines: Array<string> = downloadedCsvFiles[0]!.csv.split("\r\n");

    // Header plus every selected row, even though the table renders two.
    expect(lines.length).toBe(31);
    expect(lines[30]).toBe("Row 29,Desc 29");
  });

  test("rows stripped down to an id export as blank cells", () => {
    spyOnDownload();

    /*
     * Characterisation test. TableColumnsToCsv writes what it is handed, so
     * a selection of id-only models produces a header and nothing else -
     * which is exactly what the "Select All then Export CSV" bug looked
     * like. The fix belongs where the selection is fetched
     * (BaseModelTable.fetchAllBulkItems), not here.
     */
    const { getByText } = renderTable({
      bulkActions: customBulkActions,
      bulkSelectedItems: [{ _id: "1" }, { _id: "2" }],
    });

    fireEvent.click(getByText("Bulk Actions"));
    fireEvent.click(getByText("Export CSV"));

    expect(downloadedCsvFiles[0]!.csv.split("\r\n")).toEqual([
      "Name,Description",
      ",",
      ",",
    ]);
  });
});
