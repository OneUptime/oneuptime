import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

export default class Name extends DatabaseProperty {
  private _title: string = "";
  public get title(): string {
    return this._title;
  }
  public set title(v: string) {
    this._title = v;
  }

  private _name: string = "";
  public get name(): string {
    return this._name;
  }
  public set name(v: string) {
    this._name = v;
  }

  public constructor(name: string) {
    super();
    this.name = name;
  }

  public getFirstName(): string {
    return this.name.split(" ")[0] || "";
  }

  public getLastName(): string {
    if (this.name.split(" ").length > 1) {
      return this.name.split(" ")[this.name.split(" ").length - 1] || "";
    }
    return "";
  }

  public getMiddleName(): string {
    if (this.name.split(" ").length > 2) {
      return this.name.split(" ")[1] || "";
    }
    return "";
  }

  public override toString(): string {
    return this.name;
  }

  public static override toDatabase(
    value: Name | FindOperator<Name>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Name(value);
      }

      return value.toString();
    }

    return null;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Name,
      value: (this as Name).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Name {
    if (json["_type"] === ObjectType.Name) {
      return new Name((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public static override fromDatabase(_value: string): Name | null {
    if (_value) {
      return new Name(_value);
    }

    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.Name),
      value: Zod.string().openapi({
        type: "string",
        example: "John Doe",
      }),
    }).openapi({
      type: "object",
      description: "Name object",
      example: { _type: ObjectType.Name, value: "John Doe" },
    });
  }
}
