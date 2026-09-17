import BadDataException from "./Exception/BadDataException";
import { JSONObject, JSONValue, ObjectType } from "./JSON";
import Typeof from "./Typeof";

export default class PositiveNumber {
  private _positiveNumber: number = 0;
  public get positiveNumber(): number {
    return this._positiveNumber;
  }
  public set positiveNumber(v: number) {
    this._positiveNumber = v;
  }

  public constructor(positiveNumber: number | string) {
    if (typeof positiveNumber === Typeof.String) {
      positiveNumber = Number.parseInt(positiveNumber.toString().trim(), 10);
      if (isNaN(positiveNumber)) {
        throw new BadDataException(`Invalid number: ${positiveNumber}`);
      }
    }

    if ((positiveNumber as number) < 0) {
      throw new BadDataException("positiveNumber cannot be less than 0");
    }

    this.positiveNumber = positiveNumber as number;
  }

  public toString(): string {
    return this.positiveNumber.toString();
  }

  public isZero(): boolean {
    return this.positiveNumber === 0;
  }

  public isOne(): boolean {
    return this.positiveNumber === 1;
  }

  public toNumber(): number {
    return this.positiveNumber;
  }

  public toJSON(): JSONObject {
    return {
      _type: ObjectType.PositiveNumber,
      value: (this as PositiveNumber).toNumber(),
    };
  }

  public static fromJSON(json: JSONValue): PositiveNumber {
    if (json instanceof PositiveNumber) {
      return json;
    }

    if (typeof json === Typeof.Number) {
      return new PositiveNumber(json as number);
    }

    if (typeof json === Typeof.String) {
      return new PositiveNumber(json as string);
    }

    if (!json || (json as JSONObject)["_type"] !== ObjectType.PositiveNumber) {
      throw new BadDataException("Invalid PositiveNumber");
    }

    return new PositiveNumber((json as JSONObject)["value"] as number | string);
  }
}
