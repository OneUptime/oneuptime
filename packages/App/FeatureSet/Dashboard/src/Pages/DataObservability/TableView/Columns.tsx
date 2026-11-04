import PageComponentProps from "../../PageComponentProps";
import { useTableViewContext } from "./TableViewContext";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import Card from "Common/UI/Components/Card/Card";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The table's columns as its last collection read them, in their order: each
 * one's name, type and whether it allows empty values. How they changed over
 * time is on the Timeline.
 */
const TableColumnsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAsset } = useTableViewContext();
  const columns: Array<DataAssetColumn> = readDataAssetColumns(
    dataAsset?.columns,
  );

  /*
   * The columns as wide as a person makes them (Common's
   * Table/ColumnResize): a long column name gives way, its type and whether
   * it allows empty values never. The position is a row number, with no
   * edge of its own.
   */
  const tableColumns: ResizableColumns = useResizableColumns({
    tableKey: "data-asset-columns-table",
    columns: [
      { id: "name", cellNumber: 2 },
      { id: "type", cellNumber: 3 },
      { id: "allowsEmpty", cellNumber: 4 },
    ],
  });

  return (
    <Card
      title="Columns"
      description="The table's columns at its last collection. Changes to them are on the Timeline and on Schema Changes."
    >
      <div className="overflow-x-auto px-6 pb-6">
        {columns.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "No columns read yet. They show after the next collection.",
            )}
          </p>
        ) : (
          <>
            {tableColumns.styles}
            <table
              className={`${tableColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
              {...tableColumns.tableAttributes}
            >
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">#</th>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "name",
                      translator.translateText("Name") || "Name",
                      ColumnWidthKind.Name,
                    )}
                  >
                    <span>{translator.translateText("Name")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "type",
                      translator.translateText("Type") || "Type",
                      ColumnWidthKind.Text,
                    )}
                  >
                    <span>{translator.translateText("Type")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "allowsEmpty",
                      translator.translateText("Allows Empty") ||
                        "Allows Empty",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Allows Empty")}</span>
                  </ResizableHeaderCell>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {columns.map((column: DataAssetColumn): ReactElement => {
                  return (
                    <tr key={column.name}>
                      <td className="py-2 pr-4 text-gray-400">
                        {column.position}
                      </td>
                      <td className="py-2 pr-4 font-mono text-gray-900">
                        {column.name}
                      </td>
                      <td className="py-2 pr-4 font-mono text-gray-700">
                        {column.dataType}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">
                        {column.isNullable
                          ? translator.translateText("Yes")
                          : translator.translateText("No")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  );
};

export default TableColumnsPage;
