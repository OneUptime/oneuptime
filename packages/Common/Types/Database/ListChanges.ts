import BadDataException from "../Exception/BadDataException";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * AN UPDATE THAT ADDS OR TAKES OFF SINGLE ENTRIES OF A LIST OF RELATED
 * RECORDS (#10135).
 *
 * A record's labels, an incident's on-call policies, an SLO's monitors and
 * every other list of related records (TableColumnType.EntityArray) are
 * written whole by an update's `data`: the list it sends is the list the
 * record keeps. OneUptime adds to some of these lists on its own - a label
 * rule adds its labels, an on-call rule its policies - so a client that
 * reads a record, works out the list it wants and sends it whole drops an
 * entry OneUptime added between the read and the update. So do two people
 * who change the same list at the same moment.
 *
 * An update can name the entries instead, beside or in place of `data`:
 *
 *   PUT /api/monitor/:id
 *   {
 *     "data": { "name": "Checkout API" },
 *     "addToList": { "labels": ["<label id>"] },
 *     "removeFromList": { "labels": ["<label id>"] }
 *   }
 *
 * OneUptime adds each entry the record does not have and takes off each it
 * has, and leaves every other entry as it is, one added at the same moment
 * included. An entry is the related record's ID, or an object with its
 * `_id`, as `data` lists them. Adding an entry the record has, or taking
 * off one it does not have, changes nothing. A list is named by its field,
 * as in `data`, and an update names it in `data` or in these, not both.
 * The update is asked for what a write of the whole list would be asked
 * for: the caller's permission to change the list, and each record it adds
 * being one of the project's they may read.
 *
 * The Terraform and Crossplane providers send their lists' changes this
 * way (Scripts/TerraformProvider/StaticFiles/entries.go), and so can the
 * Dashboard (ModelAPI.updateById's listChanges).
 *
 * Read by the server, the Dashboard and the CLI, so it imports nothing that
 * needs a server or React.
 */

// The request body's keys, beside `data`.
export const ADD_TO_LIST_KEY: string = "addToList";
export const REMOVE_FROM_LIST_KEY: string = "removeFromList";

// What an update does to one list: the IDs it adds, and the IDs it takes off.
export interface ListChange {
  add: Array<string>;
  remove: Array<string>;
}

// What an update does to each list it changes this way, by the list's field.
export type ListChanges = Record<string, ListChange>;

export default class ListChangesUtil {
  /*
   * The list changes a request body names (ADD_TO_LIST_KEY,
   * REMOVE_FROM_LIST_KEY), each list's entries once, or null when it names
   * none. `listColumns` are the fields of the model's lists of related
   * records, the only fields these may name; `modelName` names the model in
   * a refusal ("Monitor"). A body that names something else in them is
   * refused, with what to send instead.
   */
  public static fromRequestBody(data: {
    body: JSONObject | null | undefined;
    listColumns: ReadonlyArray<string>;
    modelName: string;
  }): ListChanges | null {
    const body: JSONObject = data.body || {};
    const changes: ListChanges = {};

    const lists: Array<[string, "add" | "remove"]> = [
      [ADD_TO_LIST_KEY, "add"],
      [REMOVE_FROM_LIST_KEY, "remove"],
    ];

    for (const [key, side] of lists) {
      const value: JSONValue | undefined = body[key];

      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value !== "object" || Array.isArray(value)) {
        throw new BadDataException(
          `${key} lists the entries of each list by its field, such as { "labels": ["<label id>"] }. Send an object.`,
        );
      }

      for (const [column, entries] of Object.entries(value as JSONObject)) {
        if (!data.listColumns.includes(column)) {
          throw new BadDataException(
            ListChangesUtil.getUnknownListMessage({
              key,
              column,
              listColumns: data.listColumns,
              modelName: data.modelName,
            }),
          );
        }

        if (!Array.isArray(entries)) {
          throw new BadDataException(
            `${key}.${column} lists the IDs of the records to ${side === "add" ? "add" : "take off"}, such as ["<id>"]. Send a list.`,
          );
        }

        const change: ListChange = changes[column] || { add: [], remove: [] };

        for (const entry of entries) {
          const id: string | null = ListChangesUtil.getEntryId(entry);

          if (!id) {
            throw new BadDataException(
              `${key}.${column} has an entry that is not the ID of a record: ${JSON.stringify(entry)}. Send the record's ID, or an object with its _id.`,
            );
          }

          if (!ListChangesUtil.includes(change[side], id)) {
            change[side].push(id);
          }
        }

        changes[column] = change;
      }
    }

    for (const [column, change] of Object.entries(changes)) {
      const both: string | undefined = change.add.find(
        (id: string): boolean => {
          return ListChangesUtil.includes(change.remove, id);
        },
      );

      if (both) {
        throw new BadDataException(
          `${both} is both added to ${column} and taken off it. Send it in ${ADD_TO_LIST_KEY} or in ${REMOVE_FROM_LIST_KEY}, not both.`,
        );
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  // The request body's keys for `changes`, for a client to send beside `data`.
  public static toRequestBody(changes: ListChanges): JSONObject {
    const addToList: JSONObject = {};
    const removeFromList: JSONObject = {};

    for (const [column, change] of Object.entries(changes)) {
      if (change.add.length > 0) {
        addToList[column] = [...change.add];
      }

      if (change.remove.length > 0) {
        removeFromList[column] = [...change.remove];
      }
    }

    const body: JSONObject = {};

    if (Object.keys(addToList).length > 0) {
      body[ADD_TO_LIST_KEY] = addToList;
    }

    if (Object.keys(removeFromList).length > 0) {
      body[REMOVE_FROM_LIST_KEY] = removeFromList;
    }

    return body;
  }

  /*
   * A list after the change: the IDs it has, without the ones taken off, in
   * their order, then each added one it did not have. IDs compare as IDs do,
   * whatever their case.
   */
  public static apply(
    current: Array<string>,
    change: ListChange,
  ): Array<string> {
    const kept: Array<string> = current.filter((id: string): boolean => {
      return !ListChangesUtil.includes(change.remove, id);
    });

    for (const id of change.add) {
      if (!ListChangesUtil.includes(kept, id)) {
        kept.push(id);
      }
    }

    return kept;
  }

  // Whether a list has an ID, whatever its case.
  public static includes(ids: ReadonlyArray<string>, id: string): boolean {
    const key: string = id.trim().toLowerCase();

    return ids.some((item: string): boolean => {
      return item.trim().toLowerCase() === key;
    });
  }

  /*
   * An entry's ID: the ID itself, an object with its `_id` or `id` (as
   * `data` lists a related record), or an ObjectID as the Dashboard writes
   * one in JSON ({ "_type": "ObjectID", "value": "<id>" }). Null for
   * anything that is not a record's ID.
   */
  public static getEntryId(entry: unknown): string | null {
    if (typeof entry === "string") {
      const id: string = entry.trim();

      return ObjectID.isValidUUID(id) ? id : null;
    }

    if (entry instanceof ObjectID) {
      return ListChangesUtil.getEntryId(entry.toString());
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record: JSONObject = entry as JSONObject;

    if (record["_type"] === "ObjectID") {
      return ListChangesUtil.getEntryId(record["value"]);
    }

    if (record["_id"] !== undefined) {
      return ListChangesUtil.getEntryId(record["_id"]);
    }

    if (record["id"] !== undefined) {
      return ListChangesUtil.getEntryId(record["id"]);
    }

    return null;
  }

  private static getUnknownListMessage(data: {
    key: string;
    column: string;
    listColumns: ReadonlyArray<string>;
    modelName: string;
  }): string {
    if (data.listColumns.length === 0) {
      return `${data.modelName} has no list of related records, so ${data.key} cannot name ${data.column}. Send the field in data instead.`;
    }

    return `${data.modelName} has no list of related records called ${data.column}. ${data.key} can name: ${data.listColumns.join(", ")}.`;
  }
}
