import ObjectID from "../ObjectID";
import {
  DataLineageSide,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
} from "./DataTableLineage";

/*
 * DRAWING MORE OF A LINEAGE DIAGRAM WHERE IT IS.
 *
 * A diagram draws at most MAX_DATA_LINEAGE_NEIGHBORS tables next to each
 * card each way and counts the rest on the card ("+14"). Pressing the count
 * asks for the next of them (Server/Utils/DataObservability/
 * DataTableLineage: expand): the nearest that are not drawn yet, problems
 * first, as the drawing chose its own, with how many each of them does not
 * draw beyond it, the arrows between them and every card drawn already, the
 * pipelines that load them from outside and the dashboards built on them.
 * The diagram adds them where it is (the Dashboard's mergeLineageExpansion)
 * instead of re-centering on that table, and Reset goes back to the drawing
 * as it was read.
 *
 * The request names what is drawn already, so nothing is drawn twice: each
 * table with its side and steps, and each dashboard. Nothing it names needs
 * trusting: every read is the project's own, a table it names that is not
 * the project's is never drawn, and the open alerts of the tables drawn are
 * counted as the person who asked may see them, as the drawing's own are.
 */

// The most tables one drawing holds: its own, and the most each side.
export const MAX_DATA_LINEAGE_DRAWN_TABLES: number =
  2 * MAX_DATA_LINEAGE_TABLES_PER_SIDE + 1;

// A table drawn already.
export interface DataLineageDrawnTable {
  dataAssetId: string;
  side: DataLineageSide;
  // Its steps from the drawing's own card: negative upstream.
  depth: number;
}

export interface DataLineageExpandRequest {
  // The card the drawing is about: "table:<id>" or "pipeline:<id>".
  focusNodeId: string;
  /*
   * The card whose tables not drawn are asked for: a table's ("table:<id>"),
   * or, on a pipeline's drawing, the pipeline's own.
   */
  nodeId: string;
  /*
   * Which of its ways: Upstream (what a table is built from, what a
   * pipeline reads) or Downstream (what is built from it, what it writes).
   * A table upstream has only its way up counted, and one downstream only
   * its way down; the drawing's own table has both.
   */
  side: DataLineageSide;
  // Every table drawn, the card asked about among them.
  tables: Array<DataLineageDrawnTable>;
  // Every dashboard drawn.
  dataDashboardIds: Array<string>;
  // Each new arrow between two tables with the columns it carries, as the drawing was asked for.
  withColumns?: boolean | undefined;
}

export interface DataLineageExpansion {
  nodeId: string;
  side: DataLineageSide;
  // How many tables that way the card still does not draw.
  hiddenCount: number;
  // The cards drawn now: tables, the pipelines that load them from outside, the dashboards built on them.
  nodes: Array<DataTableLineageNode>;
  /*
   * The arrows drawn now: between the tables drawn now and every card on
   * the drawing, a pipeline's own to the tables it reads and writes, and
   * the dashboards' reads.
   */
  edges: Array<DataTableLineageEdge>;
  /*
   * How many dashboards built on the drawn tables are not drawn, all told,
   * once tables are drawn downstream; null when none are, and the count is
   * as it was.
   */
  hiddenDashboardCount: number | null;
  // As a drawing's: more lineage than was read, so a count is at least what it says.
  isTruncated: boolean;
}

const TABLE_PREFIX: string = "table:";
const PIPELINE_PREFIX: string = "pipeline:";

// A card's id read apart: "table:<uuid>" or "pipeline:<uuid>", anything else null.
export function readLineageCardId(
  value: unknown,
): { kind: "table" | "pipeline"; id: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  for (const [prefix, kind] of [
    [TABLE_PREFIX, "table"],
    [PIPELINE_PREFIX, "pipeline"],
  ] as Array<[string, "table" | "pipeline"]>) {
    if (value.startsWith(prefix)) {
      const id: string = value.slice(prefix.length);

      return ObjectID.isValidUUID(id) ? { kind, id } : null;
    }
  }

  return null;
}

function readSide(value: unknown): DataLineageSide | null {
  return value === DataLineageSide.Upstream ||
    value === DataLineageSide.Focus ||
    value === DataLineageSide.Downstream
    ? value
    : null;
}

function readDrawnTable(value: unknown): DataLineageDrawnTable | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: Record<string, unknown> = value as Record<string, unknown>;
  const side: DataLineageSide | null = readSide(item["side"]);
  const depth: unknown = item["depth"];

  if (
    typeof item["dataAssetId"] !== "string" ||
    !ObjectID.isValidUUID(item["dataAssetId"]) ||
    !side ||
    typeof depth !== "number" ||
    !Number.isInteger(depth) ||
    Math.abs(depth) > MAX_DATA_LINEAGE_DRAWN_TABLES
  ) {
    return null;
  }

  return { dataAssetId: item["dataAssetId"], side, depth };
}

/*
 * A request to draw more, read strictly: the request, or why it is refused,
 * in words to send back. The drawing's own table is in the middle whatever
 * the request says of it, and a table named twice is read once.
 */
export function readDataLineageExpandRequest(
  body: unknown,
): DataLineageExpandRequest | string {
  const data: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const focus: { kind: "table" | "pipeline"; id: string } | null =
    readLineageCardId(data["focusNodeId"]);

  if (!focus) {
    return "Name the card the drawing is about: focusNodeId, as table:<table ID> or pipeline:<pipeline ID>.";
  }

  const node: { kind: "table" | "pipeline"; id: string } | null =
    readLineageCardId(data["nodeId"]);

  if (!node) {
    return "Name the card to draw more of: nodeId, as table:<table ID> or pipeline:<pipeline ID>.";
  }

  const focusNodeId: string = data["focusNodeId"] as string;
  const nodeId: string = data["nodeId"] as string;

  if (node.kind === "pipeline" && nodeId !== focusNodeId) {
    return "A pipeline's card counts the tables it does not draw only on its own drawing: name a table's card, or that pipeline's.";
  }

  const side: DataLineageSide | null = readSide(data["side"]);

  if (side !== DataLineageSide.Upstream && side !== DataLineageSide.Downstream) {
    return "Say which way to draw more: side, Upstream or Downstream.";
  }

  const given: unknown = data["tables"];

  if (!Array.isArray(given)) {
    return "Name the tables drawn: tables, each with its dataAssetId, side and depth.";
  }

  if (given.length > MAX_DATA_LINEAGE_DRAWN_TABLES) {
    return `Name at most ${MAX_DATA_LINEAGE_DRAWN_TABLES} drawn tables: no drawing holds more.`;
  }

  const tables: Map<string, DataLineageDrawnTable> = new Map();

  for (const entry of given) {
    const table: DataLineageDrawnTable | null = readDrawnTable(entry);

    if (!table) {
      return "Name the tables drawn: tables, each with its dataAssetId, side and depth.";
    }

    const isFocus: boolean =
      focus.kind === "table" && table.dataAssetId === focus.id;

    // Only the drawing's own table is in the middle, and it always is.
    if (!isFocus && table.side === DataLineageSide.Focus) {
      return "Only the table the drawing is about is in its middle: give every other table's side as Upstream or Downstream.";
    }

    if (!tables.has(table.dataAssetId)) {
      tables.set(
        table.dataAssetId,
        isFocus
          ? { dataAssetId: table.dataAssetId, side: DataLineageSide.Focus, depth: 0 }
          : table,
      );
    }
  }

  if (focus.kind === "table" && !tables.has(focus.id)) {
    tables.set(focus.id, {
      dataAssetId: focus.id,
      side: DataLineageSide.Focus,
      depth: 0,
    });
  }

  if (node.kind === "table") {
    const drawn: DataLineageDrawnTable | undefined = tables.get(node.id);

    if (!drawn) {
      return "The card to draw more of is not on the drawing: name it among the tables drawn.";
    }

    if (drawn.side !== DataLineageSide.Focus && drawn.side !== side) {
      return "A table upstream has more drawn upstream, and a table downstream downstream.";
    }
  }

  const dashboards: unknown = data["dataDashboardIds"] ?? [];

  if (
    !Array.isArray(dashboards) ||
    dashboards.some((id: unknown): boolean => {
      return typeof id !== "string" || !ObjectID.isValidUUID(id);
    })
  ) {
    return "Name the dashboards drawn by their IDs: dataDashboardIds.";
  }

  const dataDashboardIds: Array<string> = Array.from(
    new Set(dashboards as Array<string>),
  );

  if (dataDashboardIds.length > MAX_DATA_LINEAGE_DASHBOARDS) {
    return `Name at most ${MAX_DATA_LINEAGE_DASHBOARDS} drawn dashboards: no drawing holds more.`;
  }

  return {
    focusNodeId,
    nodeId,
    side,
    tables: Array.from(tables.values()),
    dataDashboardIds,
    withColumns: data["withColumns"] === true,
  };
}
