import { AIChatWidget, AIChatWidgetColumn } from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

// Rows are capped so a huge tool result never blows out the chat column.
const MAX_ROWS: number = 25;

function renderCell(value: unknown, column: AIChatWidgetColumn): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (column.type === "date") {
    try {
      const date: Date = OneUptimeDate.fromString(value as string);
      return `${OneUptimeDate.getDateAsLocalFormattedString(
        date,
      )} · ${OneUptimeDate.fromNow(date)}`;
    } catch {
      return String(value);
    }
  }
  if (column.type === "number" && typeof value === "number") {
    return value.toLocaleString();
  }
  return String(value);
}

const DataTableWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: Array<AIChatWidgetColumn> = props.widget.data.columns || [];
  const allRows: Array<JSONObject> = props.widget.data.rows || [];
  const rows: Array<JSONObject> = allRows.slice(0, MAX_ROWS);

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-gray-400">No rows.</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {columns.map((column: AIChatWidgetColumn) => {
              return (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-2.5 py-2 font-semibold ${
                    column.type === "number" ? "text-right" : "text-left"
                  }`}
                >
                  {column.title}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: JSONObject, rowIndex: number) => {
            return (
              <tr
                key={rowIndex}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800"
              >
                {columns.map((column: AIChatWidgetColumn) => {
                  return (
                    <td
                      key={column.key}
                      className={`max-w-[22rem] truncate px-2.5 py-1.5 text-gray-700 dark:text-gray-300 ${
                        column.type === "number"
                          ? "text-right tabular-nums"
                          : "text-left"
                      }`}
                      title={renderCell(row[column.key], column)}
                    >
                      {renderCell(row[column.key], column)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {allRows.length > rows.length && (
        <div className="px-2.5 py-1.5 text-[11px] text-gray-400">
          Showing {rows.length} of {allRows.length} rows.
        </div>
      )}
    </div>
  );
};

export default DataTableWidget;
