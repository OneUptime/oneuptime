// This is for Object ID for all the things in our database.
import UUID from "../Utils/UUID";
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";
import Zod from "../Utils/Schema/Zod";

// UUID validation regex - matches standard UUID format
const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default class ObjectID extends DatabaseProperty {
  private _id: string = "";
  public get id(): string {
    return this._id;
  }
  public set id(v: string) {
    this._id = v;
  }

  public constructor(id: string | ObjectID | JSONObject) {
    super();

    if (id instanceof ObjectID) {
      this.id = id.toString();
    } else if (typeof id === "string") {
      this.id = id;
    } else if (
      typeof id === "object" &&
      id &&
      id["_type"] === ObjectType.ObjectID &&
      id["value"]
    ) {
      this.id = id["value"]?.toString() || "";
    }
  }

  public get value(): string {
    return this._id.toString();
  }

  public equals(other: ObjectID): boolean {
    return (this.id?.toString() || "") === (other.id?.toString() || "");
  }

  public override toString(): string {
    return this.id;
  }

  public static generate(): ObjectID {
    return new this(UUID.generate());
  }

  public static toJSONArray(ids: Array<ObjectID>): Array<JSONObject> {
    if (!ids || ids.length === 0) {
      return [];
    }

    return ids.map((id: ObjectID) => {
      if (typeof id === "string") {
        id = new ObjectID(id);
      }
      return id.toJSON();
    });
  }

  protected static override toDatabase(
    value: ObjectID | FindOperator<ObjectID>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new ObjectID(value);
      }

      return value.toString();
    }

    return null;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.ObjectID,
      value: (this as ObjectID).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): ObjectID {
    if (json["_type"] === ObjectType.ObjectID) {
      return new ObjectID((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public static fromJSONArray(json: Array<JSONObject>): Array<ObjectID> {
    return json.map((value: JSONObject) => {
      return ObjectID.fromJSON(value);
    });
  }

  protected static override fromDatabase(_value: string): ObjectID | null {
    if (_value) {
      return new ObjectID(_value);
    }

    return null;
  }

  public static getZeroObjectID(): ObjectID {
    return new ObjectID("00000000-0000-0000-0000-000000000000");
  }

  public static fromString(id: string): ObjectID {
    return new ObjectID(id);
  }

  /**
   * Check if a string is a valid UUID format
   */
  public static isValidUUID(id: string): boolean {
    if (!id || typeof id !== "string") {
      return false;
    }
    return UUID_REGEX.test(id);
  }

  /**
   * Validate that a string is a valid UUID, throw BadDataException if not
   */
  public static validateUUID(id: string): void {
    if (!ObjectID.isValidUUID(id.toString())) {
      throw new BadDataException(
        `Invalid ID format: "${id}". Expected a valid UUID (e.g., "550e8400-e29b-41d4-a716-446655440000").`,
      );
    }
  }

  public static override getSchema(): any {
    return Zod.string().openapi({
      type: "string",
      example: "123e4567-e89b-12d3-a456-426614174000",
      format: "uuid",
      description: "A unique identifier for an object, represented as a UUID.",
    });
  }
}
