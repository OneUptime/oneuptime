import PageComponentProps from "../../PageComponentProps";
import { useTableViewContext } from "./TableViewContext";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import Card from "Common/UI/Components/Card/Card";
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
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">
                  {translator.translateText("Name")}
                </th>
                <th className="py-2 pr-4">
                  {translator.translateText("Type")}
                </th>
                <th className="py-2 pr-4">
                  {translator.translateText("Allows Empty")}
                </th>
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
        )}
      </div>
    </Card>
  );
};

export default TableColumnsPage;
