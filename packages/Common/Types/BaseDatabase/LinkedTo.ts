import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import ObjectID from "../ObjectID";
import { refusedValue } from "../../Utils/RefusedValue";
import QueryOperator from "./QueryOperator";

/*
 * THE RECORDS LINKED TO SOME RECORDS, THROUGH ANY OF SEVERAL RELATIONS, AS
 * A FILTER (#11073).
 *
 * An incident touches the resources it names - its monitors, services,
 * hosts, clusters - each through a relation of its own, and a list of
 * incidents can be narrowed to the ones that touch any of some resources:
 *
 *   { linkedTo: new LinkedTo({ relations: { monitors: [...], hosts: [...] } }) }
 *   { "linkedTo": { "_type": "LinkedTo", "match": "AnyOf",
 *                   "relations": { "monitors": [...], "hosts": [...] } } }
 *
 * One filter for every relation at once, OR'd: a query is a list of
 * conditions ANDed by column, so two relations' filters side by side asked
 * for the records that touch both. The page that needed OR read the ids of
 * the records each relation reaches first - the first 10,000 of each - and
 * filtered the list by those ids, so a monitor with more incidents than
 * that showed only some of them, and said nothing.
 *
 * The server answers it inside the one query that lists the records - a
 * subquery on each relation's join table, or a comparison of the column
 * beside the record's id for a relation held in a column of its own
 * (Alert.monitorId) - so a filtered list pages, counts and sorts as any
 * other list, however many records the resources hold (QueryUtil
 * .serializeQuery). Each relation it names is held to the caller's read of
 * that column, as a filter on the column itself is (QueryPermission).
 *
 * NoneOf matches the records linked to none of them - records linked to
 * nothing at all included, as a list's "is not" keeps them.
 */
export enum LinkedToMatch {
  // Linked to at least one of the records named, through any relation.
  AnyOf = "AnyOf",
  // Linked to none of them, through any relation.
  NoneOf = "NoneOf",
}

// The key every query in OneUptime puts the filter under.
export const LINKED_TO_QUERY_KEY: string = "linkedTo";

// The most records one filter names, every relation together.
export const MAX_LINKED_TO_IDS: number = 1000;

// The most relations one filter names.
export const MAX_LINKED_TO_RELATIONS: number = 32;

// A relation is a column of the record, named as its model names it.
const RELATION_NAME: RegExp = /^[A-Za-z][A-Za-z0-9]*$/;

// A uuid that stands for an id in the messages below.
const EXAMPLE_UUID: string = "550e8400-e29b-41d4-a716-446655440000";

export interface LinkedToData {
  // Each relation, by its column, and the records it should reach.
  relations: Record<string, Array<string | ObjectID>>;
  match?: LinkedToMatch | undefined;
}

export default class LinkedTo extends QueryOperator<string> {
  private readonly _relations: Record<string, Array<string>>;
  private readonly _match: LinkedToMatch;

  public constructor(data: LinkedToData) {
    super();

    const match: LinkedToMatch = data.match || LinkedToMatch.AnyOf;

    if (!Object.values(LinkedToMatch).includes(match)) {
      throw new BadDataException(
        `Invalid match for "${LINKED_TO_QUERY_KEY}" in the query: ${JSON.stringify(
          refusedValue(match),
        )}. It is one of ${Object.values(LinkedToMatch).join(", ")}.`,
      );
    }

    if (
      !data.relations ||
      typeof data.relations !== "object" ||
      Array.isArray(data.relations)
    ) {
      throw new BadDataException(
        `"${LINKED_TO_QUERY_KEY}" in the query names its relations, each with the IDs it should reach.`,
      );
    }

    const relations: Record<string, Array<string>> = {};
    let total: number = 0;

    for (const [relation, ids] of Object.entries(data.relations)) {
      if (!RELATION_NAME.test(relation)) {
        throw new BadDataException(
          `Invalid relation for "${LINKED_TO_QUERY_KEY}" in the query: ${JSON.stringify(
            refusedValue(relation),
          )}. A relation is a column of the record, such as "monitors".`,
        );
      }

      const distinct: Array<string> = LinkedTo.toIds(ids, relation);

      if (distinct.length === 0) {
        continue;
      }

      relations[relation] = distinct;
      total += distinct.length;
    }

    const relationCount: number = Object.keys(relations).length;

    if (relationCount === 0) {
      throw new BadDataException(
        `"${LINKED_TO_QUERY_KEY}" in the query names at least one record, through one relation.`,
      );
    }

    if (relationCount > MAX_LINKED_TO_RELATIONS) {
      throw new BadDataException(
        `"${LINKED_TO_QUERY_KEY}" names at most ${MAX_LINKED_TO_RELATIONS} relations.`,
      );
    }

    if (total > MAX_LINKED_TO_IDS) {
      throw new BadDataException(
        `"${LINKED_TO_QUERY_KEY}" names at most ${MAX_LINKED_TO_IDS} records, every relation together.`,
      );
    }

    this._relations = relations;
    this._match = match;
  }

  // Each relation named, by its column, with its records' IDs (each once).
  public get relations(): Record<string, Array<string>> {
    const copy: Record<string, Array<string>> = {};

    for (const [relation, ids] of Object.entries(this._relations)) {
      copy[relation] = [...ids];
    }

    return copy;
  }

  public get match(): LinkedToMatch {
    return this._match;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.LinkedTo,
      match: this._match,
      relations: this.relations,
    };
  }

  public static override fromJSON(json: JSONObject): LinkedTo {
    if (json["_type"] !== ObjectType.LinkedTo) {
      throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    const relations: unknown = json["relations"];

    if (
      !relations ||
      typeof relations !== "object" ||
      Array.isArray(relations)
    ) {
      throw new BadDataException(
        `"${LINKED_TO_QUERY_KEY}" in the query names its relations, each with the IDs it should reach.`,
      );
    }

    const read: Record<string, Array<string | ObjectID>> = {};

    for (const [relation, ids] of Object.entries(
      relations as Record<string, unknown>,
    )) {
      read[relation] = LinkedTo.readIds(ids, relation);
    }

    return new LinkedTo({
      match: (json["match"] as LinkedToMatch | undefined) || undefined,
      relations: read,
    });
  }

  /*
   * The ids a JSON array holds: text, or an ObjectID as it is serialized
   * ({"_type": "ObjectID", "value": "..."}). Anything but an array is refused.
   */
  private static readIds(
    value: unknown,
    relation: string,
  ): Array<string | ObjectID> {
    if (!Array.isArray(value)) {
      throw new BadDataException(
        `"${relation}" of "${LINKED_TO_QUERY_KEY}" in the query is a list of IDs.`,
      );
    }

    return value.map((item: unknown): string | ObjectID => {
      if (
        item &&
        typeof item === "object" &&
        (item as JSONObject)["_type"] === ObjectType.ObjectID
      ) {
        return new ObjectID(item as JSONObject);
      }

      return item as string;
    });
  }

  /*
   * Every id as text Postgres reads as a uuid, lower-cased, each once, or
   * the filter is refused with the words every ID filter uses.
   */
  private static toIds(
    ids: Array<string | ObjectID>,
    relation: string,
  ): Array<string> {
    if (!Array.isArray(ids)) {
      throw new BadDataException(
        `"${relation}" of "${LINKED_TO_QUERY_KEY}" in the query is a list of IDs.`,
      );
    }

    const seen: Set<string> = new Set<string>();
    const result: Array<string> = [];

    for (const id of ids) {
      const text: string | null =
        id instanceof ObjectID
          ? id.toString()
          : typeof id === "string"
            ? id
            : null;

      if (text === null || !ObjectID.isValidUUID(text)) {
        throw new BadDataException(
          `Invalid ID for "${LINKED_TO_QUERY_KEY}.${relation}" in the query: ${JSON.stringify(
            refusedValue(text === null ? JSON.stringify(id) : text),
          )}. An ID is a UUID, such as "${EXAMPLE_UUID}".`,
        );
      }

      const key: string = text.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(key);
    }

    return result;
  }
}
