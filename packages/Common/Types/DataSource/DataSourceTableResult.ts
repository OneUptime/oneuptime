import { JSONValue } from "../JSON";

/*
 * Column type hints let table widgets right-align numbers and format dates
 * without sniffing every row. Connectors set these from driver metadata when
 * available and fall back to inspecting the first row.
 */
export enum DataSourceTableColumnType {
  Text = "Text",
  Number = "Number",
  Date = "Date",
  Boolean = "Boolean",
  Json = "Json",
}

export interface DataSourceTableColumn {
  // Row-object key this column reads from.
  key: string;
  // Human-facing header; defaults to the key.
  title: string;
  type: DataSourceTableColumnType;
}

/*
 * Normalized tabular result every connector's queryTable returns. Rows are
 * plain JSON objects keyed by column key so the payload serializes straight
 * through the API to the table widget.
 */
export default interface DataSourceTableResult {
  columns: Array<DataSourceTableColumn>;
  rows: Array<{ [key: string]: JSONValue }>;
  /*
   * True when the connector clamped the result at the row cap — the widget
   * shows a truncation banner so users don't mistake a clamp for the full
   * result set.
   */
  truncated?: boolean | undefined;
}
