import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { describe, expect, it } from "@jest/globals";

/*
 * NOTEQUALORNULL (#10399): anything but this value, an empty column
 * included - what Link Existing Monitors asks for as "not linked to this
 * template", which keeps the monitors linked to no template at all.
 *
 * These pin the class and its wire form: what the browser sends
 * (JSONFunctions.serialize, then JSON over HTTP) and what the server reads
 * back (JSONFunctions.deserialize, through SerializableObjectDictionary).
 * How the server writes it for Postgres is pinned in
 * Tests/Server/Types/Database/NotEqualOrNullQuery.test.ts, and what Postgres
 * answers in Tests/Server/API/MonitorTemplateLinkableMonitorsPostgres.test.ts.
 */

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";

// What happens between ModelAPI.getList and BaseAPI: JSON over HTTP.
const overTheWire: (query: JSONObject) => JSONObject = (
  query: JSONObject,
): JSONObject => {
  return JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(JSONFunctions.serialize(query))) as JSONObject,
  ) as JSONObject;
};

describe("NotEqualOrNull", () => {
  it("holds its value, and says it as text", () => {
    const operator: NotEqualOrNull<string> = new NotEqualOrNull(TEMPLATE_ID);

    expect(operator.value).toBe(TEMPLATE_ID);
    expect(operator.toString()).toBe(TEMPLATE_ID);
  });

  it("is a query operator, and never a NotEqual: the server writes the two apart", () => {
    const operator: NotEqualOrNull<string> = new NotEqualOrNull(TEMPLATE_ID);

    expect(operator).toBeInstanceOf(QueryOperator);
    expect(operator).not.toBeInstanceOf(NotEqual);
    expect(new NotEqual(TEMPLATE_ID)).not.toBeInstanceOf(NotEqualOrNull);
  });

  it("is sent as its own type, with its value raw", () => {
    expect(new NotEqualOrNull(TEMPLATE_ID).toJSON()).toEqual({
      _type: ObjectType.NotEqualOrNull,
      value: TEMPLATE_ID,
    });
    expect(ObjectType.NotEqualOrNull).toBe("NotEqualOrNull");

    // A number stays a number, as NotEqual's does.
    expect(new NotEqualOrNull(42).toJSON()).toEqual({
      _type: "NotEqualOrNull",
      value: 42,
    });
  });

  it("is read back from its JSON", () => {
    const read: NotEqualOrNull<string> = NotEqualOrNull.fromJSON<string>({
      _type: "NotEqualOrNull",
      value: TEMPLATE_ID,
    });

    expect(read).toBeInstanceOf(NotEqualOrNull);
    expect(read.value).toBe(TEMPLATE_ID);
  });

  it("refuses the JSON of another operator", () => {
    expect(() => {
      NotEqualOrNull.fromJSON({ _type: "NotEqual", value: TEMPLATE_ID });
    }).toThrow(BadDataException);
  });

  it("reaches the server as itself, inside a query, beside the rest of it", () => {
    const query: JSONObject = overTheWire({
      monitorType: "Ping",
      monitorTemplateId: new NotEqualOrNull<string>(TEMPLATE_ID),
      isArchived: false,
    } as unknown as JSONObject);

    expect(query["monitorTemplateId"]).toBeInstanceOf(NotEqualOrNull);
    expect((query["monitorTemplateId"] as NotEqualOrNull<string>).value).toBe(
      TEMPLATE_ID,
    );
    expect(query["monitorType"]).toBe("Ping");
    expect(query["isArchived"]).toBe(false);
  });

  it("keeps a Date bound to the millisecond across the wire", () => {
    const at: Date = new Date("2026-11-20T15:55:38.123Z");
    const query: JSONObject = overTheWire({
      resolvedAt: new NotEqualOrNull<Date>(at),
    } as unknown as JSONObject);

    expect(query["resolvedAt"]).toBeInstanceOf(NotEqualOrNull);
    expect(String((query["resolvedAt"] as NotEqualOrNull<string>).value)).toBe(
      "2026-11-20T15:55:38.123Z",
    );
  });
});
