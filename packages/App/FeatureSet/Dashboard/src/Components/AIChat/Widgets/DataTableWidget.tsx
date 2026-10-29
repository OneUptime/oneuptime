import { AIChatWidget, AIChatWidgetColumn } from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
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
  const translator: Translator = useTranslator();
  const columns: Array<AIChatWidgetColumn> = props.widget.data.columns || [];
  const allRows: Array<JSONObject> = props.widget.data.rows || [];
  const rows: Array<JSONObject> = allRows.slice(0, MAX_ROWS);

  /*
   * Its columns as wide as a person makes them (Common's
   * Table/ColumnResize), remembered by each column's key for every answer
   * Ask AI draws a table in: a number or a date is never cut, a text wraps.
   */
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: "ask-ai-data-table",
    columns: columns.map(
      (
        column: AIChatWidgetColumn,
        index: number,
      ): { id: string; cellNumber: number } => {
        return { id: column.key, cellNumber: index + 1 };
      },
    ),
  });

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-gray-400">
        {translator.translateText("No rows.")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      {resizableColumns.styles}
      <table
        className={`${resizableColumns.getTableWidthClassName("w-full")} border-collapse text-left text-xs`}
        {...resizableColumns.tableAttributes}
      >
        <thead>
          <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
            {columns.map((column: AIChatWidgetColumn) => {
              return (
                <ResizableHeaderCell
                  key={column.key}
                  className={`whitespace-nowrap px-2.5 py-2 font-medium ${
                    column.type === "number" ? "text-right" : "text-left"
                  }`}
                  resize={resizableColumns.getResize(
                    column.key,
                    column.title,
                    column.type === "number" || column.type === "date"
                      ? ColumnWidthKind.Whole
                      : ColumnWidthKind.Prose,
                  )}
                >
                  <span>{column.title}</span>
                </ResizableHeaderCell>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: JSONObject, rowIndex: number) => {
            return (
              <tr
                key={rowIndex}
                className="border-b border-gray-100 last:border-0"
              >
                {columns.map((column: AIChatWidgetColumn) => {
                  const text: string = renderCell(row[column.key], column);

                  /*
                   * Every column on screen, at any width: a number keeps
                   * its one line, and text wraps - anywhere, an endpoint
                   * has no spaces to wrap at - up to three lines, the
                   * whole value on hover. Cut at one line 22rem wide, the
                   * first column of a table filled a phone and pushed the
                   * others out of sight, with nothing to say they were
                   * there.
                   */
                  return (
                    <td
                      key={column.key}
                      data-testid="ai-chat-table-cell"
                      className={`px-2.5 py-2 align-top text-gray-700 ${
                        column.type === "number"
                          ? "whitespace-nowrap text-right tabular-nums"
                          : "min-w-[5rem] text-left"
                      }`}
                      title={text}
                    >
                      {column.type === "number" ? (
                        text
                      ) : (
                        <span className="line-clamp-3 [overflow-wrap:anywhere]">
                          {text}
                        </span>
                      )}
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
          {translator.translatePlural(
            {
              one: "Showing {{shown}} of {{count}} row.",
              other: "Showing {{shown}} of {{count}} rows.",
            },
            allRows.length,
            { shown: translator.formatNumber(rows.length) },
          )}
        </div>
      )}
    </div>
  );
};

export default DataTableWidget;
