// This is for Object ID for all the things in our database.
import UUID from "../Utils/UUID";
import DatabaseProperty from "./Database/DatabaseProperty";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import { FindOperator } from "typeorm";

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
    return this.id.toString() === other.id.toString();
  }

  public override toString(): string {
    return this.id;
  }

  public static generate(): ObjectID {
    return new this(UUID.generate());
  }

  public static toJSONArray(ids: Array<ObjectID>): Array<JSONObject> {
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
}
