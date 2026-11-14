import { AIChatWidget, AIChatWidgetColumn } from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import {
  ChatTableCellPiece,
  ChatTableCellText,
  getChatTableCellPieces,
  getChatTableCellText,
  getChatTableWordParts,
} from "Common/UI/Utils/AIChatExport/ChatWidgetData";
import { AIActionTableWords } from "Common/Types/AI/AIActionWords";
import React, { FunctionComponent, ReactElement } from "react";
import { DrawnActionSentence } from "../ToolActionWords";
import { getDrawnTableCell, getKnownTableWords } from "../TableWords";

export interface ComponentProps {
  widget: AIChatWidget;
}

// Rows are capped so a huge tool result never blows out the chat column.
const MAX_ROWS: number = 25;

// A date's cell and a number's keep their one line; text wraps.
function isOneLineColumn(column: AIChatWidgetColumn): boolean {
  return column.type === "number" || column.type === "date";
}

const DataTableWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const columns: Array<AIChatWidgetColumn> = props.widget.data.columns || [];
  const allRows: Array<JSONObject> = props.widget.data.rows || [];
  const rows: Array<JSONObject> = allRows.slice(0, MAX_ROWS);
  /*
   * A read's table says its cells that are OneUptime's words - a
   * monitor's type, Disabled - in the reader's language, as the card
   * above it does (issue #7394, TableWords); every other cell is data,
   * drawn as stored.
   */
  const words: AIActionTableWords | null = getKnownTableWords(props.widget);

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
              /*
               * A tool names its columns in English, marked as keys
               * (Common/Server/Utils/AI/Toolbox): each is drawn in the
               * reader's language, and a name a tool builds from what it
               * read - an attribute grouped by - as it was written. A
               * conversation saved earlier carries the same English names,
               * so its tables read in the reader's language too.
               */
              const title: string =
                translator.translateText(column.title) || column.title;

              return (
                <ResizableHeaderCell
                  key={column.key}
                  className={`whitespace-nowrap px-2.5 py-2 font-medium ${
                    column.type === "number" ? "text-right" : "text-left"
                  }`}
                  resize={resizableColumns.getResize(
                    column.key,
                    title,
                    isOneLineColumn(column)
                      ? ColumnWidthKind.Whole
                      : ColumnWidthKind.Prose,
                  )}
                >
                  <span>{title}</span>
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
                  const worded: DrawnActionSentence | null = getDrawnTableCell({
                    words,
                    rowIndex,
                    columnKey: column.key,
                    stored: row[column.key],
                    translator,
                  });
                  const cell: ChatTableCellText = getChatTableCellText(
                    worded ? worded.text : row[column.key],
                    column,
                  );

                  /*
                   * Every column on screen, at any width: a number and a
                   * date keep their one line, and text wraps up to three
                   * lines, the whole value on hover. Cut at one line 22rem
                   * wide, the first column of a table filled a phone and
                   * pushed the others out of sight, with nothing to say
                   * they were there. A word wraps whole, broken only when
                   * it is wider than its column; a long one, or a path - an
                   * endpoint has no spaces to wrap at - anywhere, after its
                   * slashes and before its host's dots first (issue
                   * #6969): broken anywhere, every word let a phone's table
                   * split "Operational" into "Operationa" and "l".
                   *
                   * A date is written as every table writes one, "Oct 14,
                   * 11:57 AM" (Table/TableDate), and whole under the
                   * pointer with how long ago it was. Written whole in the
                   * cell - "Oct 14 2026, 11:57 GMT · 3 minutes ago" - it
                   * took a third of the chat panel, and its year and zone
                   * said the same on every row.
                   */
                  return (
                    <td
                      key={column.key}
                      data-testid="ai-chat-table-cell"
                      className={`px-2.5 py-2 align-top text-gray-700 ${
                        column.type === "number"
                          ? "whitespace-nowrap text-right tabular-nums"
                          : column.type === "date" && cell.dateTime
                            ? "whitespace-nowrap"
                            : "min-w-[5rem] text-left"
                      }`}
                      title={cell.fullText}
                    >
                      {column.type === "number" ? (
                        cell.text
                      ) : cell.dateTime ? (
                        <time dateTime={cell.dateTime}>{cell.text}</time>
                      ) : (
                        <span className="line-clamp-3 break-words">
                          {getChatTableCellPieces(cell.text).map(
                            (
                              piece: ChatTableCellPiece,
                              index: number,
                            ): ReactElement => {
                              /*
                               * A path wraps after its slashes first, and a
                               * host before its dots: the browser breaks
                               * anywhere only in a part with no <wbr> left
                               * that fits the line.
                               */
                              return piece.breaksAnywhere ? (
                                <span
                                  key={index}
                                  data-testid="ai-chat-table-cell-long-word"
                                  className="[overflow-wrap:anywhere]"
                                >
                                  {getChatTableWordParts(piece.text).map(
                                    (
                                      part: string,
                                      partIndex: number,
                                    ): ReactElement => {
                                      return (
                                        <React.Fragment key={partIndex}>
                                          {partIndex > 0 ? <wbr /> : null}
                                          {part}
                                        </React.Fragment>
                                      );
                                    },
                                  )}
                                </span>
                              ) : (
                                <React.Fragment key={index}>
                                  {piece.text}
                                </React.Fragment>
                              );
                            },
                          )}
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
