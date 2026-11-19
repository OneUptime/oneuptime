import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { ListOrderSettings } from "./ListOrderColumn";

/*
 * MOVING A ROW OF AN ORDERED LIST TO ANOTHER ROW'S PLACE (issues #9573,
 * #9609).
 *
 * Two kinds of list are numbered by a column of their own, lower numbers
 * first:
 *
 *   - five lists numbered by `order` (NUMBERED_LIST_TABLES): the escalation
 *     rules of an on-call policy, the layers of a schedule, the people of a
 *     layer, the groups of a status page and the resources of a status page
 *     (or of one of its groups). Rows that share a number come in the order
 *     of their ids, as the database reads them (Server/Utils/Database/
 *     ContiguousOrder);
 *   - every list people put in order by dragging its rows, which a model
 *     marks with @ListOrderColumn and names the column of: severities,
 *     states and monitor statuses (`priority`), custom fields, pipelines and
 *     filters (`sortOrder`), rules, status page links and the rest. Rows that
 *     share a number come the older first (Common/Utils/ListOrder), and a
 *     list may count down (site assignment rules: the highest number is the
 *     top).
 *
 * Writing a row's number - creating it at a number, changing its number -
 * places that row and moves no other. That is what Terraform, and anything
 * else that numbers a whole list, needs: it writes every row's number on its
 * own, all at once, in no set order, and every row must end at the number
 * written.
 *
 * Moving a row is a request of its own, which the Dashboard sends when
 * someone drags a row, or moves it up or down:
 *
 *   POST /<the list's path>/:id/move
 *   { "placeOfId": "<the row whose place it takes>" }
 *   -> { "changedRows": [{ "_id": "<id>", "<its number column>": 2 }, ...] }
 *
 * The row takes the place of the row named, and the rows between them step
 * one place towards where it was - so a row moved up lands just above the
 * row named, and a row moved down just below it. The list is then numbered
 * 1..n in its new order (n..1 for a list that counts down), which in a list
 * numbered 1..n changes only the rows between the two places; a list with
 * gaps or shared numbers (written through the API) comes out tidy. The
 * server does it in one transaction holding the list's rows, so moves at
 * once run one after another and never leave two rows at one number.
 * `changedRows` are the rows given another number, the moved row among
 * them, each with its new number under the list's own column (`order`,
 * `priority`, `sortOrder`); none when it was there already.
 *
 * Read by the server and the Dashboard, so it imports nothing that needs a
 * server or React.
 */

// The route, under the list's own API path, for the row `:id`.
export const MOVE_IN_LIST_ROUTE: string = "/:id/move";

// The route for one row, as the Dashboard calls it.
export const getMoveInListRoute: (rowId: string) => string = (
  rowId: string,
): string => {
  return `/${rowId}/move`;
};

/*
 * The tables of the five lists numbered by `order` that ContiguousOrder keeps
 * (issue #9573). Their services move a row in their own way - the on-call
 * policies' cache, the schedule's roster - so each overrides moveInList.
 */
export const NUMBERED_LIST_TABLES: ReadonlyArray<string> = [
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
  "StatusPageGroup",
  "StatusPageResource",
];

// The column the five lists are numbered by.
export const NUMBERED_LIST_COLUMN: string = "order";

// What MoveInListUtil reads of a model: its table, and its list order if any.
export interface MovableModel {
  tableName?: string | null | undefined;
  getListOrder(): ListOrderSettings | null;
}

export interface MoveInListRequest {
  // The row whose place the moved row takes.
  placeOfId: ObjectID;
}

// A row of a numbered list, and its number.
export interface ListPlace {
  id: string;
  order: number | null | undefined;
  /*
   * When the row was created: of two rows at one number, a drag-ordered
   * list shows the older first (Common/Utils/ListOrder). The five numbered
   * lists go by id instead, and need not say.
   */
  createdAt?: Date | string | null | undefined;
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
   * The column a model's rows are numbered by in a list whose rows can be
   * moved - its @ListOrderColumn's, or `order` for the five numbered lists -
   * or null when its rows make up no such list. Every such model's API
   * answers the move (BaseAPI), and its API Reference page describes it.
   */
  public static getListColumn(model: MovableModel): string | null {
    const listOrder: ListOrderSettings | null = model.getListOrder();

    if (listOrder?.column) {
      return listOrder.column;
    }

    if (model.tableName && NUMBERED_LIST_TABLES.includes(model.tableName)) {
      return NUMBERED_LIST_COLUMN;
    }

    return null;
  }

  /*
   * The order a list is read in: by number, lowest first, rows without one
   * last; rows that share a number by id - as the database reads them
   * (DatabaseService breaks every tie by the primary key), so the server,
   * the Dashboard and the status page put twins the same way round.
   */
  public static compare(a: ListPlace, b: ListPlace): number {
    const aOrder: number | null = toNumber(a.order);
    const bOrder: number | null = toNumber(b.order);

    if (aOrder !== null && bOrder === null) {
      return -1;
    }

    if (aOrder === null && bOrder !== null) {
      return 1;
    }

    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
      return aOrder - bOrder;
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
  ): Array<TPlace> {
    return [...rows].sort((a: TPlace, b: TPlace): number => {
      return MoveInListUtil.compare(a, b);
    });
  }

  /*
   * The rows a move gives another number: the list in the order it is read
   * in, the moved row taken out and put where the row named stands - just
   * above it when it came from below, just below it when it came from
   * above - and the list numbered 1..n. Only the rows whose number changes
   * are given; a move to the row's own place changes none.
   */
  public static getChanges(data: {
    rows: ReadonlyArray<ListPlace>;
    rowId: string;
    placeOfId: string;
  }): MoveInListChanges {
    const list: Array<ListPlace> = MoveInListUtil.sort(data.rows);
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
      if (toNumber(place.order) !== index + 1) {
        changedRows.push({ id: place.id, order: index + 1 });
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

  /*
   * A move's answer as the API writes it: each row given another number by
   * its id, and its new number under the list's own column (`column`: the
   * five numbered lists' `order`, a drag-ordered list's own), as the row's
   * own JSON names it.
   */
  public static resultToJSON(
    result: MoveInListResult,
    column: string = NUMBERED_LIST_COLUMN,
  ): JSONObject {
    return {
      changedRows: result.changedRows.map(
        (row: { id: string; order: number }): JSONObject => {
          return { _id: row.id, [column]: row.order };
        },
      ),
    };
  }

  // A move's answer as the API wrote it, its numbers under `column`.
  public static resultFromJSON(
    json: unknown,
    column: string = NUMBERED_LIST_COLUMN,
  ): MoveInListResult {
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
        (item as Record<string, unknown>)[column],
      );

      if (typeof id === "string" && order !== null) {
        changedRows.push({ id: id, order: order });
      }
    }

    return { changedRows: changedRows };
  }
}
