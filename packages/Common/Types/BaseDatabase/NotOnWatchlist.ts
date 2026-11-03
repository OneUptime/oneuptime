import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

/**
 * "the field is not on this watchlist" - the negation of {@link OnWatchlist},
 * as a detection rule's `not` of an `expand` selection reads an allow list:
 * the search bar's `-ip:%admin_addresses%`, a monitor's "is not on". An event
 * whose field is empty is not on any list, as in a rule.
 *
 * Carries only the list's name; the server reads the list before the read
 * is compiled (SecurityWatchlistQueryBinder), and only security events read
 * it.
 */
export default class NotOnWatchlist extends QueryOperator<string> {
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

  // As the search bar writes it, after the minus: %admin_addresses%.
  public override toString(): string {
    return `%${this.value}%`;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.NotOnWatchlist,
      value: this.value,
    };
  }

  public static override fromJSON(json: JSONObject): NotOnWatchlist {
    if (json["_type"] === ObjectType.NotOnWatchlist) {
      return new NotOnWatchlist(
        typeof json["value"] === "string" ? (json["value"] as string) : "",
      );
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
