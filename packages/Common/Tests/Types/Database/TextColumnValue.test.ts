import { describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import User from "../../../Models/DatabaseModels/User";
import {
  coerceTextColumnValue,
  coerceTextColumnsInJSON,
  isTextTableColumnType,
} from "../../../Types/Database/TextColumnValue";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Name from "../../../Types/Name";

/*
 * A name sent as the person's-name object is the text a text column
 * stores. The API's schema asked for {"_type":"Name","value":"..."} for
 * thirty-one things' names before they were text; a client written then
 * still sends it, and the API takes it as the text it holds - on a create
 * (BaseModel.fromJSON) and an update (coerceTextColumnsInJSON) alike - so
 * nothing stores '{"_type":"Name","value":"..."}' as a name. A person's
 * name keeps its Name.
 */

describe("the text column types", () => {
  test("are the types a value is stored as written", () => {
    for (const type of [
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.VeryLongText,
      TableColumnType.Description,
      TableColumnType.Markdown,
    ]) {
      expect({ type, text: isTextTableColumnType(type) }).toEqual({
        type,
        text: true,
      });
    }
  });

  test("leave out a person's name, numbers, dates, switches and ids", () => {
    for (const type of [
      TableColumnType.Name,
      TableColumnType.Number,
      TableColumnType.Date,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
      TableColumnType.Email,
      TableColumnType.JSON,
    ]) {
      expect({ type, text: isTextTableColumnType(type) }).toEqual({
        type,
        text: false,
      });
    }

    expect(isTextTableColumnType(undefined)).toBe(false);
    expect(isTextTableColumnType(null)).toBe(false);
  });
});

describe("coerceTextColumnValue", () => {
  test("a Name is its text", () => {
    expect(coerceTextColumnValue(new Name("web-alb"))).toBe("web-alb");
  });

  test("the object a Name is sent as is its text", () => {
    expect(
      coerceTextColumnValue({ _type: ObjectType.Name, value: "web-alb" }),
    ).toBe("web-alb");
  });

  test("text, null and anything else stay as they are", () => {
    expect(coerceTextColumnValue("web-alb")).toBe("web-alb");
    expect(coerceTextColumnValue("")).toBe("");
    expect(coerceTextColumnValue(null)).toBeNull();
    expect(coerceTextColumnValue(undefined)).toBeUndefined();
    expect(coerceTextColumnValue(5)).toBe(5);

    // Not a Name: another object, or a Name object without its text.
    const other: JSONObject = { _type: ObjectType.Search, value: "x" };
    expect(coerceTextColumnValue(other)).toBe(other);
    const noText: JSONObject = { _type: ObjectType.Name, value: 5 };
    expect(coerceTextColumnValue(noText)).toBe(noText);
    const list: Array<string> = ["web-alb"];
    expect(coerceTextColumnValue(list)).toBe(list);
  });
});

describe("coerceTextColumnsInJSON", () => {
  test("turns a name sent as the object into its text, in place", () => {
    const json: JSONObject = JSONFunctions.deserialize({
      name: { _type: ObjectType.Name, value: "Production AWS" },
    });

    expect(json["name"]).toBeInstanceOf(Name);

    const result: JSONObject = coerceTextColumnsInJSON(
      json,
      new CloudConnection(),
    );

    expect(result).toBe(json);
    expect(json["name"]).toBe("Production AWS");
  });

  test("a probe's description, a long text, takes its text too", () => {
    const json: JSONObject = {
      description: { _type: ObjectType.Name, value: "Watches us-east-1" },
    };

    coerceTextColumnsInJSON(json, new Probe());

    expect(json["description"]).toBe("Watches us-east-1");
  });

  test("leaves text, other columns and names that are not columns alone", () => {
    const json: JSONObject = {
      name: "Production AWS",
      isEnabled: true,
      notAColumn: { _type: ObjectType.Name, value: "x" },
    };

    coerceTextColumnsInJSON(json, new CloudConnection());

    expect(json).toEqual({
      name: "Production AWS",
      isEnabled: true,
      notAColumn: { _type: ObjectType.Name, value: "x" },
    });
  });

  test("a person's name keeps its Name", () => {
    const json: JSONObject = JSONFunctions.deserialize({
      name: { _type: ObjectType.Name, value: "Maya Lopez" },
    });

    coerceTextColumnsInJSON(json, new User());

    expect(json["name"]).toBeInstanceOf(Name);
    expect((json["name"] as unknown as Name).toString()).toBe("Maya Lopez");
  });
});

describe("BaseModel.fromJSON, as a create reads its body", () => {
  test("a thing's name sent as text is that text", () => {
    const connection: CloudConnection = BaseModel.fromJSON<CloudConnection>(
      { name: "Production AWS" },
      CloudConnection,
    ) as CloudConnection;

    expect(connection.name).toBe("Production AWS");
  });

  test("a thing's name sent as the object is its text, not a Name", () => {
    const connection: CloudConnection = BaseModel.fromJSON<CloudConnection>(
      { name: { _type: ObjectType.Name, value: "Production AWS" } },
      CloudConnection,
    ) as CloudConnection;

    expect(connection.name).toBe("Production AWS");
    expect(typeof connection.name).toBe("string");
  });

  test("a person's name sent as the object stays a Name, as before", () => {
    const user: User = BaseModel.fromJSON<User>(
      { name: { _type: ObjectType.Name, value: "Maya Lopez" } },
      User,
    ) as User;

    expect(user.name).toBeInstanceOf(Name);
    expect(user.name?.toString()).toBe("Maya Lopez");
  });
});
