import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

/**
 * "the field is on this watchlist": a security event's field matched
 * against one of the project's watchlists by the list's name, as a
 * detection rule's `field|expand: '%vip_users%'` matches it. A Security
 * Events monitor's watchlist filters, a hunt's search and the Events search
 * (`user:%vip_users%`) put it in their query.
 *
 * It carries only the name. The server reads the list - its values, its
 * patterns and ranges, or the threat intel feed it follows - as the caller,
 * just before the read is compiled (SecurityWatchlistQueryBinder), so the
 * values never travel with the query, and a list changed between two reads
 * is read as it is now. Only security events read it: any other table
 * refuses it.
 *
 * The negation is a class of its own (NotOnWatchlist), as every compiler in
 * the codebase dispatches on operator identity.
 */
export default class OnWatchlist extends QueryOperator<string> {
  private _value!: string;

  // The list's name, as the query wrote it: lists are found whatever the case.
  public get value(): string {
    return this._value;
  }

  public set value(v: string) {
    this._value = v;
  }

  public constructor(name: string) {
    super();
    this.value = name;
  }

  // As the search bar writes it: %vip_users%.
  public override toString(): string {
    return `%${this.value}%`;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.OnWatchlist,
      value: this.value,
    };
  }

  public static override fromJSON(json: JSONObject): OnWatchlist {
    if (json["_type"] === ObjectType.OnWatchlist) {
      return new OnWatchlist(
        typeof json["value"] === "string" ? (json["value"] as string) : "",
      );
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
