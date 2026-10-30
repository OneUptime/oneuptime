import { describe, expect, test } from "@jest/globals";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  containsWordRun,
  getFieldNameWords,
  getHintedDataTypeIds,
  getNameOnlyDataTypes,
  splitFieldName,
} from "../../../Utils/DataSecurity/FieldNameHints";

/*
 * WHAT A FIELD'S NAME SAYS IT HOLDS.
 *
 * Names are split into words however they are written, only the last path
 * segment is the field's own name (and the one before it when the last is
 * a generic word), and a hint matches when its words sit together, in
 * order, among the name's.
 */

function hinted(fieldPath: string): Array<string> {
  return [...getHintedDataTypeIds(fieldPath)].sort();
}

describe("splitFieldName", () => {
  test.each([
    ["customer_email", ["customer", "email"]],
    ["billing-address", ["billing", "address"]],
    ["dateOfBirth", ["date", "of", "birth"]],
    ["DateOfBirth", ["date", "of", "birth"]],
    ["SSNNumber", ["ssn", "number"]],
    ["HTTPRequestHeader", ["http", "request", "header"]],
    ["IBAN", ["iban"]],
    ["CCNum", ["cc", "num"]],
    ["Address1", ["address", "1"]],
    ["addressLine2", ["address", "line", "2"]],
    ["user2FAToken", ["user", "2", "fa", "token"]],
    ["ipV4Address", ["ip", "v", "4", "address"]],
    ["x-forwarded-for", ["x", "forwarded", "for"]],
    ["card.number", ["card", "number"]],
    ["a__b", ["a", "b"]],
    ["already lower", ["already", "lower"]],
    ["日本email", ["email"]],
    ["", []],
  ])("splits %j", (name: string, words: Array<string>) => {
    expect(splitFieldName(name)).toEqual(words);
  });

  test("reads at most 256 characters and 32 words of a name", () => {
    expect(splitFieldName("a".repeat(300))).toEqual(["a".repeat(256)]);
    expect(
      splitFieldName(new Array<string>(40).fill("word").join("_")),
    ).toHaveLength(32);
  });
});

describe("containsWordRun", () => {
  test("is true only for the hint's words together and in order", () => {
    expect(
      containsWordRun(
        ["customer", "date", "of", "birth"],
        ["date", "of", "birth"],
      ),
    ).toBe(true);
    expect(containsWordRun(["birth", "date"], ["date", "of", "birth"])).toBe(
      false,
    );
    expect(
      containsWordRun(["date", "x", "of", "birth"], ["date", "of", "birth"]),
    ).toBe(false);
    expect(containsWordRun(["a"], [])).toBe(false);
    expect(containsWordRun(["a"], ["a", "b"])).toBe(false);
  });
});

describe("getFieldNameWords", () => {
  test("reads only the last segment of a dotted path", () => {
    expect(getFieldNameWords("customer.address.city")).toEqual(["city"]);
    expect(getFieldNameWords("user/profile/dob")).toEqual(["dob"]);
    expect(getFieldNameWords("http.request.header.authorization")).toEqual([
      "authorization",
    ]);
  });

  test("reads the segment before a generic last one", () => {
    expect(getFieldNameWords("card.number")).toEqual(["card", "number"]);
    expect(getFieldNameWords("payment.card.number")).toEqual([
      "card",
      "number",
    ]);
    expect(getFieldNameWords("patient.id")).toEqual(["patient", "id"]);
    expect(getFieldNameWords("api.key")).toEqual(["api", "key"]);
    // One level only.
    expect(getFieldNameWords("card.number.value")).toEqual(["number", "value"]);
  });

  test("skips array positions and empty segments", () => {
    expect(getFieldNameWords("orders[].email")).toEqual(["email"]);
    expect(getFieldNameWords("orders[3].email")).toEqual(["email"]);
    expect(getFieldNameWords("data.0.ssn")).toEqual(["ssn"]);
    expect(getFieldNameWords("items[2]")).toEqual(["items"]);
    expect(getFieldNameWords("123")).toEqual([]);
    expect(getFieldNameWords("")).toEqual([]);
  });
});

describe("getHintedDataTypeIds", () => {
  test("knows the common field names", () => {
    expect(hinted("customer_email")).toEqual(["email-address"]);
    expect(hinted("dateOfBirth")).toEqual(["date-of-birth"]);
    expect(hinted("card_number")).toEqual(["credit-card-number"]);
    expect(hinted("payment.card.number")).toEqual(["credit-card-number"]);
    expect(hinted("first_name")).toEqual(["person-name"]);
    expect(hinted("orders[].shipping_address")).toEqual(["postal-address"]);
    expect(hinted("http.request.header.authorization")).toEqual([
      "authorization-header",
    ]);
  });

  test("does not read a word out of context", () => {
    expect(hinted("birth_city")).toEqual([]);
    expect(hinted("customer.address.city")).toEqual([]);
    expect(hinted("description")).toEqual([]);
    expect(hinted("")).toEqual([]);
  });

  test("adds a project's own hints, split the same way", () => {
    const extra: Array<{ dataTypeId: string; hints: Array<string> }> = [
      { dataTypeId: "custom:employee-id", hints: ["employee code", "staffId"] },
    ];

    expect([...getHintedDataTypeIds("employee_code", extra)]).toEqual([
      "custom:employee-id",
    ]);
    expect([...getHintedDataTypeIds("hr.staff_id", extra)]).toEqual([
      "custom:employee-id",
    ]);
    expect([...getHintedDataTypeIds("employee", extra)]).toEqual([]);
  });

  test("matches every built-in hint written as its own field name", () => {
    for (const info of DATA_TYPE_CATALOG) {
      for (const hint of info.nameHints) {
        const fieldName: string = hint.split(" ").join("_");

        expect([
          fieldName,
          getHintedDataTypeIds(fieldName).has(info.id),
        ]).toEqual([fieldName, true]);
      }
    }
  });
});

describe("getNameOnlyDataTypes", () => {
  test("are the catalog's types found from names, each with hints to be found by", () => {
    const nameOnly: Array<DataTypeInfo> = getNameOnlyDataTypes();

    expect(
      nameOnly.map((info: DataTypeInfo) => {
        return info.id;
      }),
    ).toEqual(
      expect.arrayContaining([
        "person-name",
        "gender",
        "religious-belief",
        "health-information",
      ]),
    );

    for (const info of nameOnly) {
      expect(info.foundBy).toBe("name");
      expect([info.id, info.nameHints.length > 0]).toEqual([info.id, true]);
    }
  });
});
