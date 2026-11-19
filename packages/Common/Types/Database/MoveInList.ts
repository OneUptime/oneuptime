import SortOrder from "../BaseDatabase/SortOrder";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * MOVING A ROW OF A NUMBERED LIST TO ANOTHER ROW'S PLACE (issues #9573,
 * #9609).
 *
 * Two kinds of list are numbered by a column, top first:
 *
 *   - five lists numbered by `order` (Server/Utils/Database/ContiguousOrder):
 *     the escalation rules of an on-call policy, the layers of a schedule,
 *     the people of a layer, the groups of a status page and the resources
 *     of a status page (or of one of its groups);
 *   - every list people put in order by dragging its rows, marked
 *     @ListOrderColumn (Types/Database/ListOrderColumn): severities, states,
 *     monitor statuses, custom fields, a status page's links, pipelines and
 *     their processors, filters, rules of every kind. Their column is
 *     `order`, `sortOrder` or `priority`, and for two of them (network site
 *     assignment and device naming rules) the top of the list is the
 *     HIGHEST number.
 *
 * Rows that share a number come in the order of their ids, as the database
 * reads them (DatabaseService breaks every tie of a read by the primary
 * key, ascending, whichever way the list counts).
 *
 * Writing a row's number - creating it at a number, changing its number -
 * places that row and moves no other (Server/Utils/Database/
 * ContiguousOrder, Server/Utils/Database/ListOrderMaintainer). That is what
 * Terraform, and anything else that numbers a whole list, needs: it writes
 * every row's number on its own, all at once, in no set order, and every
 * row must end at the number written.
 *
 * Moving a row is a request of its own, which the Dashboard sends when
 * someone drags a row, or moves it up or down:
 *
 *   POST /<the list's path>/:id/move
 *   { "placeOfId": "<the row whose place it takes>" }
 *   -> { "changedRows": [{ "_id": "<id>", "order": 2 }, ...] }
 *
 * The row takes the place of the row named, and the rows between them step
 * one place towards where it was - so a row moved up lands just above the
 * row named, and a row moved down just below it. The list is then numbered
 * 1..n from the top (n..1 for a list whose top is its highest number),
 * which in a list numbered that way already changes only the rows between
 * the two places; a list with gaps or shared numbers (written through the
 * API) comes out tidy. The server does it in one transaction holding the
 * list's rows, so moves at once run one after another and never leave two
 * rows at one number. `changedRows` are the rows given another number, the
 * moved row among them, each with its new number under `order` whatever
 * the list's column is called; none when it was there already.
 *
 * Read by the server and the Dashboard, so it imports nothing that needs a
 * server or React.
 */

// The route, under the list's own API path, for the row `:id`.
export const MOVE_IN_LIST_ROUTE: string = "/:id/move";

/*
 * The five lists numbered by `order` whose services keep them by hand
 * (Server/Utils/Database/ContiguousOrder), by their tables: their APIs add
 * the move (MoveInListAPI). Every other list with a move is marked
 * @ListOrderColumn.
 */
export const CONTIGUOUS_ORDER_TABLES: ReadonlyArray<string> = [
  "StatusPageGroup",
  "StatusPageResource",
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
];

// The route for one row, as the Dashboard calls it.
export const getMoveInListRoute: (rowId: string) => string = (
  rowId: string,
): string => {
  return `/${rowId}/move`;
};

export interface MoveInListRequest {
  // The row whose place the moved row takes.
  placeOfId: ObjectID;
}

// A row of a numbered list, and its number.
export interface ListPlace {
  id: string;
  order: number | null | undefined;
}

export interface MoveInListResult {
  // The rows given another number, with the number each has now.
  changedRows: Array<{ id: string; order: number }>;
}

/*
 * What a move of a list's rows comes to: the rows given another number, or
 * why it is no move of this list - the moved row is not in it (deleted, or
 * moved to another list, since it was read), or the row whose place it
 * takes is not.
 */
export type MoveInListChanges =
  | { kind: "moved"; changedRows: Array<{ id: string; order: number }> }
  | { kind: "rowNotInList" }
  | { kind: "placeNotInList" };

const normalizeId: (id: string) => string = (id: string): string => {
  return id.trim().toLowerCase();
};

// A row's number, or null when it holds none: those come after the numbered.
const toNumber: (order: unknown) => number | null = (
  order: unknown,
): number | null => {
  const value: number = typeof order === "number" ? order : Number(order);

  return order === null ||
    order === undefined ||
    order === "" ||
    !Number.isFinite(value)
    ? null
    : value;
};

export default class MoveInListUtil {
  /*
   * Whether a model's rows are moved by POST <its path>/:id/move: every
   * drag-ordered list (@ListOrderColumn), and the five numbered lists
   * (CONTIGUOUS_ORDER_TABLES). The API Reference draws the move on their
   * pages.
   */
  public static hasMoveRequest(model: {
    tableName?: string | null | undefined;
    getListOrder?: (() => unknown) | undefined;
  }): boolean {
    if (typeof model.getListOrder === "function" && model.getListOrder()) {
      return true;
    }

    return Boolean(
      model.tableName && CONTIGUOUS_ORDER_TABLES.includes(model.tableName),
    );
  }

  /*
   * The order a list is read in: by number from the top - lowest first, or
   * highest first for a list whose top is its highest number - rows without
   * one last; rows that share a number by id, ascending either way - as the
   * database reads them (DatabaseService breaks every tie by the primary
   * key), so the server, the Dashboard and the status page put twins the
   * same way round.
   */
  public static compare(
    a: ListPlace,
    b: ListPlace,
    sortOrder: SortOrder = SortOrder.Ascending,
  ): number {
    const aOrder: number | null = toNumber(a.order);
    const bOrder: number | null = toNumber(b.order);

    if (aOrder !== null && bOrder === null) {
      return -1;
    }

    if (aOrder === null && bOrder !== null) {
      return 1;
    }

    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
      return sortOrder === SortOrder.Descending
        ? bOrder - aOrder
        : aOrder - bOrder;
    }

    const aId: string = normalizeId(a.id);
    const bId: string = normalizeId(b.id);

    if (aId < bId) {
      return -1;
    }

    return aId > bId ? 1 : 0;
  }

  // A copy of the rows in the order the list is read in.
  public static sort<TPlace extends ListPlace>(
    rows: ReadonlyArray<TPlace>,
    sortOrder: SortOrder = SortOrder.Ascending,
  ): Array<TPlace> {
    return [...rows].sort((a: TPlace, b: TPlace): number => {
      return MoveInListUtil.compare(a, b, sortOrder);
    });
  }

  /*
   * The number of the row at `position` (0 = the top) of a list of `count`
   * rows numbered from scratch: 1..n from the top, or n..1 for a list whose
   * top is its highest number.
   */
  public static getNumberAt(data: {
    position: number;
    count: number;
    sortOrder?: SortOrder | undefined;
  }): number {
    return data.sortOrder === SortOrder.Descending
      ? data.count - data.position
      : data.position + 1;
  }

  /*
   * The rows a move gives another number: the list in the order it is read
   * in, the moved row taken out and put where the row named stands - just
   * above it when it came from below, just below it when it came from
   * above - and the list numbered from scratch (getNumberAt). Only the rows
   * whose number changes are given; a move to the row's own place changes
   * none.
   */
  public static getChanges(data: {
    rows: ReadonlyArray<ListPlace>;
    rowId: string;
    placeOfId: string;
    sortOrder?: SortOrder | undefined;
  }): MoveInListChanges {
    const sortOrder: SortOrder = data.sortOrder || SortOrder.Ascending;
    const list: Array<ListPlace> = MoveInListUtil.sort(data.rows, sortOrder);
    const rowId: string = normalizeId(data.rowId);
    const placeOfId: string = normalizeId(data.placeOfId);

    const from: number = list.findIndex((row: ListPlace): boolean => {
      return normalizeId(row.id) === rowId;
    });

    if (from < 0) {
      return { kind: "rowNotInList" };
    }

    const to: number = list.findIndex((row: ListPlace): boolean => {
      return normalizeId(row.id) === placeOfId;
    });

    if (to < 0) {
      return { kind: "placeNotInList" };
    }

    if (from === to) {
      return { kind: "moved", changedRows: [] };
    }

    const moved: Array<ListPlace> = [...list];
    const [row] = moved.splice(from, 1);
    moved.splice(to, 0, row!);

    const changedRows: Array<{ id: string; order: number }> = [];

    moved.forEach((place: ListPlace, index: number) => {
      const order: number = MoveInListUtil.getNumberAt({
        position: index,
        count: moved.length,
        sortOrder: sortOrder,
      });

      if (toNumber(place.order) !== order) {
        changedRows.push({ id: place.id, order: order });
      }
    });

    return { kind: "moved", changedRows: changedRows };
  }

  // A move as the server reads it: the row whose place the moved row takes.
  public static parseRequest(body: unknown): MoveInListRequest {
    const record: Record<string, unknown> | null =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;

    const placeOfId: unknown = record?.["placeOfId"];

    if (
      typeof placeOfId !== "string" ||
      !ObjectID.isValidUUID(placeOfId.trim())
    ) {
      throw new BadDataException(
        'Send placeOfId: the ID of the row whose place this row takes, as { "placeOfId": "<id>" }.',
      );
    }

    return { placeOfId: new ObjectID(placeOfId.trim()) };
  }

  public static requestToJSON(request: MoveInListRequest): JSONObject {
    return { placeOfId: request.placeOfId.toString() };
  }

  public static resultToJSON(result: MoveInListResult): JSONObject {
    return {
      changedRows: result.changedRows.map(
        (row: { id: string; order: number }): JSONObject => {
          return { _id: row.id, order: row.order };
        },
      ),
    };
  }

  public static resultFromJSON(json: unknown): MoveInListResult {
    const record: Record<string, unknown> | null =
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null;

    const rows: unknown = record?.["changedRows"];

    if (!Array.isArray(rows)) {
      return { changedRows: [] };
    }

    const changedRows: Array<{ id: string; order: number }> = [];

    for (const item of rows as Array<unknown>) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const id: unknown = (item as Record<string, unknown>)["_id"];
      const order: number | null = toNumber(
        (item as Record<string, unknown>)["order"],
      );

      if (typeof id === "string" && order !== null) {
        changedRows.push({ id: id, order: order });
      }
    }

    return { changedRows: changedRows };
  }
}
