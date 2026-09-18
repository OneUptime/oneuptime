import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import SerializableObjectDictionary from "../../../Types/SerializableObjectDictionary";

describe("IncludesAnyOfGroups", () => {
  test("preserves group boundaries and removes duplicate ids within a group", () => {
    const value: IncludesAnyOfGroups = new IncludesAnyOfGroups([
      ["network", "router", "network"],
      ["0660", "0661"],
    ]);
    expect(value.groups).toEqual([
      ["network", "router"],
      ["0660", "0661"],
    ]);
  });

  test("retains empty groups so they can match nothing", () => {
    expect(new IncludesAnyOfGroups([["network"], []]).groups).toEqual([
      ["network"],
      [],
    ]);
  });

  test("owns its data and does not expose mutable validated groups", () => {
    const groups: Array<Array<string>> = [["network"], ["0660"]];
    const value: IncludesAnyOfGroups = new IncludesAnyOfGroups(groups);
    groups[0]!.push("router");
    value.groups[1]!.push("0661");
    (value.toJSON()["value"] as Array<Array<string>>)[0]!.push("other");
    expect(value.groups).toEqual([["network"], ["0660"]]);
  });

  test("round trips through the API JSON registry with leading zeros intact", () => {
    const value: IncludesAnyOfGroups = new IncludesAnyOfGroups([
      ["network"],
      ["0660", "0661"],
    ]);
    const serialized: JSONObject = JSONFunctions.serialize({ labels: value });
    expect(serialized["labels"]).toEqual({
      _type: ObjectType.IncludesAnyOfGroups,
      value: [["network"], ["0660", "0661"]],
    });
    const result: JSONObject = JSONFunctions.deserialize(
      JSON.parse(JSON.stringify(serialized)),
    ) as JSONObject;
    expect(SerializableObjectDictionary[ObjectType.IncludesAnyOfGroups]).toBe(
      IncludesAnyOfGroups,
    );
    expect(result["labels"]).toBeInstanceOf(IncludesAnyOfGroups);
    expect((result["labels"] as IncludesAnyOfGroups).groups).toEqual(
      value.groups,
    );
  });

  test.each(
    [
      undefined,
      null,
      [],
      "network",
      ["network"],
      [null],
      [[null]],
      [[1]],
      [[{}]],
      [[""]],
      [["a".repeat(257)]],
      Array.from({ length: 33 }, () => {
        return ["id"];
      }),
      [
        Array.from({ length: 1001 }, () => {
          return "id";
        }),
      ],
      Array.from({ length: 11 }, () => {
        return Array.from({ length: 1000 }, () => {
          return "id";
        });
      }),
    ].map((groups: unknown) => {
      return [groups];
    }),
  )("rejects invalid or oversized group data %#", (groups: unknown) => {
    expect(() => {
      return new IncludesAnyOfGroups(groups as Array<Array<string>>);
    }).toThrow(BadDataException);
    expect(() => {
      return IncludesAnyOfGroups.fromJSON({
        _type: ObjectType.IncludesAnyOfGroups,
        value: groups,
      } as JSONObject);
    }).toThrow(BadDataException);
  });

  test("rejects a different operator type", () => {
    expect(() => {
      return IncludesAnyOfGroups.fromJSON({
        _type: ObjectType.Includes,
        value: [["network"]],
      });
    }).toThrow(BadDataException);
  });
});
