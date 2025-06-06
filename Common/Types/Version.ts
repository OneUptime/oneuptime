import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

export default class Version extends DatabaseProperty {
  private _version: string = "";
  public get version(): string {
    return this._version;
  }
  public set version(v: string) {
    const re: RegExp =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z\d][-a-zA-Z.\d]*)?(\+[a-zA-Z\d][-a-zA-Z.\d]*)?$/i;
    const isValid: boolean = re.test(v);
    if (!isValid) {
      throw new BadDataException("Version is not in valid format.");
    }
    this._version = v;
  }

  public constructor(version: string) {
    super();
    this.version = version;
  }

  public override toString(): string {
    return this.version;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Version,
      value: (this as Version).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Version {
    if (json["_type"] === ObjectType.Version) {
      return new Version((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  protected static override toDatabase(
    value: Version | FindOperator<Version>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Version(value);
      }

      return value.toString();
    }

    return null;
  }

  protected static override fromDatabase(_value: string): Version | null {
    if (_value) {
      return new Version(_value);
    }

    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.Version),
      value: Zod.string().openapi({
        type: "string",
        example: "1.0.0",
      }),
    }).openapi({
      type: "object",
      description: "Version object",
      example: { _type: ObjectType.Version, value: "1.0.0" },
    });
  }
}
