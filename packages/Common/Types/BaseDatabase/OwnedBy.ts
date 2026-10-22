import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import ObjectID from "../ObjectID";
import { refusedValue } from "../../Utils/RefusedValue";
import QueryOperator from "./QueryOperator";

/*
 * WHO OWNS A RECORD, AS A FILTER.
 *
 * Monitors, incidents, on-call schedules and every other kind of record with
 * owners of its own keep them in two tables beside it - the people in
 * <Kind>OwnerUser, the teams in <Kind>OwnerTeam - and a list of the kind can
 * be narrowed to the records some of them own:
 *
 *   { owners: new OwnedBy({ userIds: [...], teamIds: [...] }) }
 *   { "owners": { "_type": "OwnedBy", "userIds": [...], "teamIds": [...] } }
 *
 * The server answers it inside the one query that lists the records - a
 * subquery on the owner tables, through their index on the record's id
 * (QueryUtil.serializeQuery, QueryHelper.ownedBy) - so a list filtered by
 * its owners pages, counts and sorts as any other list does, however many
 * records the owners hold. Filtering by owners reads the owner tables, so it
 * is held to their read permission (QueryPermission).
 *
 * Ownership is direct: a person owns the records they are an owner of, and a
 * team the records the team is an owner of. A team's members are not owners
 * of what the team owns, and a team is not an owner of what one of its
 * members owns - the Owner chip lists people and teams apart for that.
 */
export enum OwnedByMatch {
  // Owned by one or more of the people and teams named.
  AnyOf = "AnyOf",
  // Owned by none of the people and teams named - records without owners too.
  NoneOf = "NoneOf",
  // Owned by someone: at least one person or team.
  AnyOwner = "AnyOwner",
  // Owned by nobody.
  NoOwner = "NoOwner",
}

// The most people and teams one filter names, together.
export const MAX_OWNED_BY_IDS: number = 1000;

// The key every query in OneUptime puts the filter under.
export const OWNED_BY_QUERY_KEY: string = "owners";

// A uuid that stands for an id in the messages below.
const EXAMPLE_UUID: string = "550e8400-e29b-41d4-a716-446655440000";

export interface OwnedByData {
  userIds?: Array<string | ObjectID> | undefined;
  teamIds?: Array<string | ObjectID> | undefined;
  match?: OwnedByMatch | undefined;
}

export default class OwnedBy extends QueryOperator<JSONObject> {
  private readonly _userIds: Array<string>;
  private readonly _teamIds: Array<string>;
  private readonly _match: OwnedByMatch;

  public constructor(data: OwnedByData) {
    super();

    const match: OwnedByMatch = data.match || OwnedByMatch.AnyOf;

    if (!Object.values(OwnedByMatch).includes(match)) {
      throw new BadDataException(
        `Invalid match for "${OWNED_BY_QUERY_KEY}" in the query: ${JSON.stringify(
          refusedValue(match),
        )}. It is one of ${Object.values(OwnedByMatch).join(", ")}.`,
      );
    }

    const userIds: Array<string> = OwnedBy.toIds(data.userIds, "userIds");
    const teamIds: Array<string> = OwnedBy.toIds(data.teamIds, "teamIds");

    const namesOwners: boolean =
      match === OwnedByMatch.AnyOf || match === OwnedByMatch.NoneOf;

    if (namesOwners && userIds.length === 0 && teamIds.length === 0) {
      throw new BadDataException(
        `"${OWNED_BY_QUERY_KEY}" with match ${match} names at least one person (userIds) or team (teamIds).`,
      );
    }

    if (!namesOwners && (userIds.length > 0 || teamIds.length > 0)) {
      throw new BadDataException(
        `"${OWNED_BY_QUERY_KEY}" with match ${match} asks whether a record has owners at all, so it names no people or teams.`,
      );
    }

    if (userIds.length + teamIds.length > MAX_OWNED_BY_IDS) {
      throw new BadDataException(
        `"${OWNED_BY_QUERY_KEY}" names at most ${MAX_OWNED_BY_IDS} people and teams together.`,
      );
    }

    this._userIds = userIds;
    this._teamIds = teamIds;
    this._match = match;
  }

  // The people named, as ids (each once).
  public get userIds(): Array<string> {
    return [...this._userIds];
  }

  // The teams named, as ids (each once).
  public get teamIds(): Array<string> {
    return [...this._teamIds];
  }

  public get match(): OwnedByMatch {
    return this._match;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.OwnedBy,
      match: this._match,
      userIds: [...this._userIds],
      teamIds: [...this._teamIds],
    };
  }

  public static override fromJSON(json: JSONObject): OwnedBy {
    if (json["_type"] !== ObjectType.OwnedBy) {
      throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    return new OwnedBy({
      match: (json["match"] as OwnedByMatch | undefined) || undefined,
      userIds: OwnedBy.readIds(json["userIds"], "userIds"),
      teamIds: OwnedBy.readIds(json["teamIds"], "teamIds"),
    });
  }

  /*
   * The ids a JSON array holds: text, or an ObjectID as it is serialized
   * ({"_type": "ObjectID", "value": "..."}). Anything but an array is refused.
   */
  private static readIds(
    value: unknown,
    field: string,
  ): Array<string | ObjectID> | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(
        `"${field}" of "${OWNED_BY_QUERY_KEY}" in the query is a list of IDs.`,
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
   * Every id as text Postgres reads as a uuid, each once, or the filter is
   * refused with the words every ID filter uses.
   */
  private static toIds(
    ids: Array<string | ObjectID> | undefined,
    field: string,
  ): Array<string> {
    if (ids === undefined || ids === null) {
      return [];
    }

    if (!Array.isArray(ids)) {
      throw new BadDataException(
        `"${field}" of "${OWNED_BY_QUERY_KEY}" in the query is a list of IDs.`,
      );
    }

    const seen: Set<string> = new Set<string>();
    const result: Array<string> = [];

    for (const id of ids) {
      const text: string | null =
        id instanceof ObjectID ? id.toString() : typeof id === "string" ? id : null;

      if (text === null || !ObjectID.isValidUUID(text)) {
        throw new BadDataException(
          `Invalid ID for "${OWNED_BY_QUERY_KEY}.${field}" in the query: ${JSON.stringify(
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
