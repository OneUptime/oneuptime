// This is for Object ID for all the things in our database.
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";

export default class Decimal extends DatabaseProperty {
  private _value: number = 0;
  public get value(): number {
    return this._value;
  }
  public set value(v: number) {
    this._value = v;
  }

  public constructor(value: number | Decimal | string) {
    super();

    if (typeof value === "string") {
      value = parseFloat(value);
    }

    if (value instanceof Decimal) {
      value = value.value;
    }

    this.value = value;
  }

  public equals(other: Decimal): boolean {
    return this.value.toString() === other.value.toString();
  }

  public override toString(): string {
    return this.value.toString();
  }

  /*
   * A decimal column is declared `TableColumnType.Number`, so what reaches
   * the transformer may be a Decimal, a string, or a plain number depending
   * on how far the request body got through deserialization.
   *
   * Both raw forms are handled before the truthiness check, because `0` is a
   * perfectly good decimal and the old `if (value)` sent it to `null` — on a
   * NOT NULL column that is a constraint violation for a value the caller
   * supplied.
   */
  protected static override toDatabase(
    value: Decimal | FindOperator<Decimal>,
  ): string | null {
    const rawValue: unknown = value;

    if (typeof rawValue === "string" || typeof rawValue === "number") {
      return new Decimal(rawValue).toString();
    }

    if (value) {
      return value.toString();
    }

    return null;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Decimal,
      value: (this as Decimal).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Decimal {
    if (json["_type"] === ObjectType.Decimal) {
      return new Decimal((json["value"] as number) || 0);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  protected static override fromDatabase(_value: number): Decimal | null {
    if (_value) {
      return new Decimal(_value);
    }

    return null;
  }

  public static fromString(value: string): Decimal {
    return new Decimal(value);
  }
}
