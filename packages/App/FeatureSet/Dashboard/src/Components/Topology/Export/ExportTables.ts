import {
  NetworkTopologyEdge,
  NetworkTopologyLinkProtocol,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  isUnclassifiedNode,
  roleDisplayLabelForNode,
} from "../../NetworkDevice/TopologyNodeShape";
import { portLabelForEdgeEnd } from "../../NetworkDevice/EndpointNodeUtil";
import {
  TopologyNodeKind,
  TopologyViewModel,
  kindOfNode,
} from "../NetworkTopologyViewModel";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
  NetworkLinkState,
  maxUtilizationForEdge,
} from "../NetworkTopologyMeta";
import { resolvePrintColor } from "./ExportColor";
import {
  A4_LONG_SIDE,
  A4_SHORT_SIDE,
  ExportPage,
  PAGE_MARGIN,
  PDF_INK,
  baselineFor,
  textItem,
} from "./ExportItems";
import { PdfStringCollector, TextMeasure, wrapTextToLines } from "./ExportText";

/*
 * The two tables after the map: every device on it, and every connection
 * between them with the port at each end.
 *
 * They are what makes the PDF a document rather than a picture. A network
 * of a few hundred devices cannot be read off a single page, however large;
 * the tables carry every name, status and port in text that can be searched
 * and copied — which is also what an assessment or a change request quotes.
 * They list exactly what the map above them draws: the same filters, the
 * same nodes and links.
 */

export interface ExportTableCell {
  text: string;
  // A status dot drawn before the text.
  dotColor?: string | undefined;
}

export interface ExportTableColumn {
  // Printed in capitals over the column. English: the PDF is not translated.
  name: string;
  // Share of the table's width.
  share: number;
}

export interface ExportTable {
  key: "devices" | "connections";
  // "Devices (16)": the table's title, with its count.
  name: string;
  // One line under the title saying what the table lists.
  intro: string;
  emptyText: string;
  columns: Array<ExportTableColumn>;
  rows: Array<Array<ExportTableCell>>;
}

const NOT_AVAILABLE: string = "-";

const STATUS_LABELS: Record<NetworkTopologyNodeStatus, string> = {
  up: "Up",
  down: "Down",
  unknown: "Unknown",
};

// The legend's own words for the three kinds of node.
const KIND_LABELS: Record<TopologyNodeKind, string> = {
  device: "Managed device",
  unmanaged: "Unmanaged peer",
  endpoint: "Endpoint",
};

const KIND_ORDER: Array<TopologyNodeKind> = ["device", "unmanaged", "endpoint"];

const LINK_STATE_LABELS: Record<NetworkLinkState, string> = {
  healthy: "Healthy",
  saturated: "Busy",
  down: "Down",
  unknown: "No data",
};

const PROTOCOL_LABELS: Record<NetworkTopologyLinkProtocol, string> = {
  lldp: "LLDP",
  cdp: "CDP",
  fdb: "Forwarding table",
  manual: "Drawn by hand",
};

export const DEVICE_TABLE_COLUMNS: Array<ExportTableColumn> = [
  { name: "Device", share: 20 },
  { name: "Type", share: 11 },
  { name: "Kind", share: 11 },
  { name: "Status", share: 8 },
  { name: "Vendor and model", share: 17 },
  { name: "Address", share: 14 },
  { name: "Interfaces", share: 11 },
  { name: "Links", share: 8 },
];

export const CONNECTION_TABLE_COLUMNS: Array<ExportTableColumn> = [
  { name: "From", share: 19 },
  { name: "Port", share: 11 },
  { name: "To", share: 19 },
  { name: "Port", share: 11 },
  { name: "Status", share: 10 },
  { name: "Utilization", share: 9 },
  { name: "Source", share: 21 },
];

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function describeVendor(node: NetworkTopologyNode): string {
  return [node.vendor, node.deviceModel]
    .map((part: string | undefined): string => {
      return (part || "").trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");
}

function describeInterfaces(node: NetworkTopologyNode): string {
  if (node.interfacesUp === undefined && node.interfacesDown === undefined) {
    return NOT_AVAILABLE;
  }
  return `${node.interfacesUp ?? 0} up, ${node.interfacesDown ?? 0} down`;
}

function describeAddress(node: NetworkTopologyNode): string {
  return [node.ipAddress, node.macAddress]
    .filter((part: string | undefined): boolean => {
      return Boolean(part);
    })
    .join(" ");
}

function describeSources(edge: NetworkTopologyEdge): string {
  const labels: Array<string> = [];
  for (const protocol of edge.protocols || []) {
    const label: string | undefined = PROTOCOL_LABELS[protocol];
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels.join(", ") || NOT_AVAILABLE;
}

function describeUtilization(edge: NetworkTopologyEdge): string {
  const utilization: number | undefined = maxUtilizationForEdge(edge);
  return utilization === undefined
    ? NOT_AVAILABLE
    : `${Math.round(utilization)}%`;
}

interface SortableRow {
  first: string;
  second: string;
  rank: number;
  cells: Array<ExportTableCell>;
}

function sortRows(rows: Array<SortableRow>): Array<Array<ExportTableCell>> {
  return rows
    .sort((a: SortableRow, b: SortableRow): number => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      const byFirst: number = compareNames(a.first, b.first);
      return byFirst !== 0 ? byFirst : compareNames(a.second, b.second);
    })
    .map((row: SortableRow): Array<ExportTableCell> => {
      return row.cells;
    });
}

/**
 * The device and connection tables for the nodes and links the map draws.
 * Devices come managed first, then unmanaged peers, then endpoints, each by
 * name; connections by the names at their two ends.
 */
export function buildTopologyTables(
  viewModel: TopologyViewModel,
  nodeById: ReadonlyMap<string, NetworkTopologyNode>,
  edgeByKey: ReadonlyMap<string, NetworkTopologyEdge>,
  strings: PdfStringCollector,
): Array<ExportTable> {
  const linkCount: Map<string, number> = new Map<string, number>();
  for (const edgeView of viewModel.edges) {
    linkCount.set(
      edgeView.fromNodeId,
      (linkCount.get(edgeView.fromNodeId) || 0) + 1,
    );
    linkCount.set(
      edgeView.toNodeId,
      (linkCount.get(edgeView.toNodeId) || 0) + 1,
    );
  }
  const nameOf: (nodeId: string) => string = (nodeId: string): string => {
    return strings.clean(nodeById.get(nodeId)?.name || nodeId);
  };

  const deviceRows: Array<SortableRow> = [];
  for (const nodeView of viewModel.nodes) {
    const node: NetworkTopologyNode | undefined = nodeById.get(nodeView.id);
    if (!node) {
      continue;
    }
    const kind: TopologyNodeKind = kindOfNode(node);
    const name: string = nameOf(node.id);
    const status: NetworkTopologyNodeStatus =
      node.status === "up" || node.status === "down" ? node.status : "unknown";
    const links: number = linkCount.get(node.id) || 0;
    deviceRows.push({
      first: name,
      second: node.id,
      rank: KIND_ORDER.indexOf(kind),
      cells: [
        { text: name },
        {
          text: isUnclassifiedNode(node)
            ? NOT_AVAILABLE
            : strings.clean(roleDisplayLabelForNode(node)),
        },
        { text: KIND_LABELS[kind] },
        {
          text: STATUS_LABELS[status],
          dotColor: resolvePrintColor(NODE_STATUS_COLORS[status]),
        },
        { text: strings.clean(describeVendor(node)) || NOT_AVAILABLE },
        { text: strings.clean(describeAddress(node)) || NOT_AVAILABLE },
        { text: describeInterfaces(node) },
        { text: links > 0 ? formatCount(links) : "None" },
      ],
    });
  }

  const connectionRows: Array<SortableRow> = [];
  for (const edgeView of viewModel.edges) {
    const edge: NetworkTopologyEdge | undefined = edgeByKey.get(edgeView.key);
    if (!edge) {
      continue;
    }
    const from: string = nameOf(edgeView.fromNodeId);
    const to: string = nameOf(edgeView.toNodeId);
    connectionRows.push({
      first: from,
      second: to,
      rank: 0,
      cells: [
        { text: from },
        {
          text:
            strings.clean(
              portLabelForEdgeEnd(edge.fromInterface, edge.fromPort),
            ) || NOT_AVAILABLE,
        },
        { text: to },
        {
          text:
            strings.clean(portLabelForEdgeEnd(edge.toInterface, edge.toPort)) ||
            NOT_AVAILABLE,
        },
        {
          text: LINK_STATE_LABELS[edgeView.state],
          dotColor: resolvePrintColor(LINK_STATE_COLORS[edgeView.state]),
        },
        { text: describeUtilization(edge) },
        { text: describeSources(edge) },
      ],
    });
  }

  return [
    {
      key: "devices",
      name: `Devices (${formatCount(deviceRows.length)})`,
      intro:
        "Every device on the map: managed devices first, then the peers and endpoints they reported.",
      emptyText: "No devices on this map.",
      columns: DEVICE_TABLE_COLUMNS,
      rows: sortRows(deviceRows),
    },
    {
      key: "connections",
      name: `Connections (${formatCount(connectionRows.length)})`,
      intro:
        "Every link on the map, with the port at each end, its state and the utilization of its busier end.",
      emptyText: "No connections on this map.",
      columns: CONNECTION_TABLE_COLUMNS,
      rows: sortRows(connectionRows),
    },
  ];
}

/*
 * ---------------------------------------------------------------------------
 * Pagination
 * ---------------------------------------------------------------------------
 */

export const TABLE_PAGE_WIDTH: number = A4_LONG_SIDE;
export const TABLE_PAGE_HEIGHT: number = A4_SHORT_SIDE;
const TABLE_TITLE_SIZE: number = 12;
const TABLE_DESCRIPTION_SIZE: number = 8;
const TABLE_HEADER_SIZE: number = 6.8;
const TABLE_HEADER_HEIGHT: number = 18;
export const TABLE_CELL_SIZE: number = 8;
const TABLE_CELL_LINE_HEIGHT: number = 10;
const TABLE_CELL_PADDING_X: number = 6;
const TABLE_CELL_PADDING_Y: number = 4.5;
// A long value wraps onto at most this many lines before it is shortened.
const TABLE_CELL_MAX_LINES: number = 6;
const TABLE_DOT_RADIUS: number = 2.4;
const TABLE_DOT_SPACE: number = 9;
const TABLE_GAP: number = 26;
// A table does not start at the foot of a page: its title, header and a few rows.
const TABLE_MIN_START_SPACE: number = 110;
// Room kept at the foot of a table page for the footer.
const TABLE_FOOTER_SPACE: number = 16;

/** The lowest a row may reach on a table page. */
export const TABLE_BOTTOM_LIMIT: number =
  TABLE_PAGE_HEIGHT - PAGE_MARGIN - TABLE_FOOTER_SPACE;

interface TableCursor {
  page: ExportPage;
  y: number;
}

function newTablePage(pages: Array<ExportPage>): TableCursor {
  const page: ExportPage = {
    kind: "table",
    width: TABLE_PAGE_WIDTH,
    height: TABLE_PAGE_HEIGHT,
    items: [],
  };
  pages.push(page);
  return { page: page, y: PAGE_MARGIN };
}

function drawTableHeader(
  cursor: TableCursor,
  table: ExportTable,
  columnLefts: Array<number>,
  tableWidth: number,
): void {
  cursor.page.items.push({
    type: "rect",
    tag: `table-header:${table.key}`,
    x: PAGE_MARGIN,
    y: cursor.y,
    width: tableWidth,
    height: TABLE_HEADER_HEIGHT,
    radius: 3,
    fill: PDF_INK.surface,
  });
  for (let index: number = 0; index < table.columns.length; index++) {
    cursor.page.items.push(
      textItem(
        `table-header-text:${table.key}`,
        table.columns[index]!.name.toUpperCase(),
        (columnLefts[index] || 0) + TABLE_CELL_PADDING_X,
        cursor.y + TABLE_HEADER_HEIGHT / 2 + TABLE_HEADER_SIZE * 0.35,
        TABLE_HEADER_SIZE,
        PDF_INK.muted,
        { isBold: true },
      ),
    );
  }
  cursor.y += TABLE_HEADER_HEIGHT;
}

/**
 * The tables, broken across A4 landscape pages. A row is never split; a
 * page that a table continues onto starts with "<title>, continued" and the
 * column headings again.
 */
export function layoutTables(
  tables: Array<ExportTable>,
  measure: TextMeasure,
): Array<ExportPage> {
  const pages: Array<ExportPage> = [];
  const tableWidth: number = TABLE_PAGE_WIDTH - PAGE_MARGIN * 2;
  let cursor: TableCursor = newTablePage(pages);

  for (let tableIndex: number = 0; tableIndex < tables.length; tableIndex++) {
    const table: ExportTable = tables[tableIndex]!;
    if (tableIndex > 0) {
      cursor.y += TABLE_GAP;
      if (cursor.y + TABLE_MIN_START_SPACE > TABLE_BOTTOM_LIMIT) {
        cursor = newTablePage(pages);
      }
    }

    const totalShare: number = table.columns.reduce(
      (sum: number, column: ExportTableColumn): number => {
        return sum + column.share;
      },
      0,
    );
    const columnWidths: Array<number> = table.columns.map(
      (column: ExportTableColumn): number => {
        return (tableWidth * column.share) / (totalShare || 1);
      },
    );
    const columnLefts: Array<number> = [];
    let left: number = PAGE_MARGIN;
    for (const width of columnWidths) {
      columnLefts.push(left);
      left += width;
    }

    cursor.page.items.push(
      textItem(
        `table-title:${table.key}`,
        table.name,
        PAGE_MARGIN,
        baselineFor(cursor.y, TABLE_TITLE_SIZE),
        TABLE_TITLE_SIZE,
        PDF_INK.heading,
        { isBold: true },
      ),
    );
    cursor.y += 16;
    for (const line of wrapTextToLines(
      table.intro,
      tableWidth,
      2,
      measure,
      TABLE_DESCRIPTION_SIZE,
      false,
    )) {
      cursor.page.items.push(
        textItem(
          `table-description:${table.key}`,
          line,
          PAGE_MARGIN,
          baselineFor(cursor.y, TABLE_DESCRIPTION_SIZE),
          TABLE_DESCRIPTION_SIZE,
          PDF_INK.muted,
        ),
      );
      cursor.y += 10.5;
    }
    cursor.y += 6;
    drawTableHeader(cursor, table, columnLefts, tableWidth);

    if (table.rows.length === 0) {
      cursor.page.items.push(
        textItem(
          `table-empty:${table.key}`,
          table.emptyText,
          PAGE_MARGIN + TABLE_CELL_PADDING_X,
          baselineFor(cursor.y + TABLE_CELL_PADDING_Y, TABLE_CELL_SIZE),
          TABLE_CELL_SIZE,
          PDF_INK.muted,
        ),
      );
      cursor.y += TABLE_CELL_LINE_HEIGHT + TABLE_CELL_PADDING_Y * 2;
      continue;
    }

    for (let rowIndex: number = 0; rowIndex < table.rows.length; rowIndex++) {
      const row: Array<ExportTableCell> = table.rows[rowIndex]!;
      const cellLines: Array<Array<string>> = [];
      let lineCount: number = 1;
      for (let column: number = 0; column < row.length; column++) {
        const cell: ExportTableCell = row[column]!;
        const available: number =
          (columnWidths[column] || 0) -
          TABLE_CELL_PADDING_X * 2 -
          (cell.dotColor ? TABLE_DOT_SPACE : 0);
        const lines: Array<string> = wrapTextToLines(
          cell.text,
          Math.max(available, 8),
          TABLE_CELL_MAX_LINES,
          measure,
          TABLE_CELL_SIZE,
          false,
        );
        cellLines.push(lines.length > 0 ? lines : [NOT_AVAILABLE]);
        lineCount = Math.max(lineCount, lines.length);
      }
      const rowHeight: number =
        lineCount * TABLE_CELL_LINE_HEIGHT + TABLE_CELL_PADDING_Y * 2;

      if (cursor.y + rowHeight > TABLE_BOTTOM_LIMIT) {
        cursor = newTablePage(pages);
        cursor.page.items.push(
          textItem(
            `table-continued:${table.key}`,
            `${table.name}, continued`,
            PAGE_MARGIN,
            baselineFor(cursor.y, 9),
            9,
            PDF_INK.muted,
            { isBold: true },
          ),
        );
        cursor.y += 15;
        drawTableHeader(cursor, table, columnLefts, tableWidth);
      }

      const firstBaseline: number = baselineFor(
        cursor.y + TABLE_CELL_PADDING_Y,
        TABLE_CELL_SIZE,
      );
      for (let column: number = 0; column < row.length; column++) {
        const cell: ExportTableCell = row[column]!;
        let textLeft: number =
          (columnLefts[column] || 0) + TABLE_CELL_PADDING_X;
        if (cell.dotColor) {
          cursor.page.items.push({
            type: "circle",
            tag: `table-dot:${table.key}:${rowIndex}:${column}`,
            cx: textLeft + TABLE_DOT_RADIUS,
            cy: firstBaseline - TABLE_CELL_SIZE * 0.3,
            r: TABLE_DOT_RADIUS,
            fill: cell.dotColor,
          });
          textLeft += TABLE_DOT_SPACE;
        }
        const lines: Array<string> = cellLines[column] || [];
        for (let lineIndex: number = 0; lineIndex < lines.length; lineIndex++) {
          cursor.page.items.push(
            textItem(
              `table-cell:${table.key}:${rowIndex}:${column}`,
              lines[lineIndex]!,
              textLeft,
              firstBaseline + lineIndex * TABLE_CELL_LINE_HEIGHT,
              TABLE_CELL_SIZE,
              PDF_INK.text,
            ),
          );
        }
      }
      cursor.y += rowHeight;
      cursor.page.items.push({
        type: "line",
        tag: `table-rule:${table.key}`,
        x1: PAGE_MARGIN,
        y1: cursor.y,
        x2: PAGE_MARGIN + tableWidth,
        y2: cursor.y,
        stroke: { color: PDF_INK.rule, width: 0.5 },
        roundCaps: false,
      });
    }
  }

  return pages;
}
