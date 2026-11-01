import {
  describeUnplacedField,
  fieldNameWords,
  fieldOwnName,
  FREE_TEXT_AVERAGE_LENGTH,
  isBookkeepingField,
  isValueShape,
  MAX_FIELD_NEIGHBOURS,
  MAX_FIELD_SHAPES,
  MAX_SHAPE_LENGTH,
  MAX_SHAPED_VALUES,
  MAX_UNPLACED_FIELDS_PER_SCAN,
  MIN_UNPLACED_VALUES,
  neighbourNames,
  readUnplacedFields,
  UnplacedField,
  unplacedFieldSignature,
  valueShape,
} from "../../../Utils/DataSecurity/UnplacedFields";
import { describe, expect, test } from "@jest/globals";

/*
 * What OneUptime AI is told about a field no detector placed: its name,
 * its neighbours' names and the shapes of its values - never a value.
 */

const COLUMN: string = "Column";

function isKnownKind(kind: string): boolean {
  return kind === COLUMN || kind === "Field";
}

function customerNumbers(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `KD-${String(100000 + index * 7)}`;
  });
}

describe("valueShape", () => {
  test("writes letters as a or A and digits as 9, the rest as it is", () => {
    expect(valueShape("AB-1234")).toBe("AA-9999");
    expect(valueShape("kim@acme.example")).toBe("aaa@aaaa.aaaaaaa");
    expect(valueShape("+49 (30) 1234-5678")).toBe("+99 (99) 9999-9999");
    expect(valueShape("Müller")).toBe("Aaaaaa");
  });

  test("reads letters and digits of every script", () => {
    // A letter with no case is "a"; an Arabic-Indic digit is "9".
    expect(valueShape("東京")).toBe("aa");
    expect(valueShape("١٢٣")).toBe("999");
    expect(valueShape("Straße")).toBe("Aaaaaa");
  });

  test("turns tabs and line breaks into spaces", () => {
    expect(valueShape("a\tb\nc")).toBe("a a a");
  });

  test("cuts a long value at MAX_SHAPE_LENGTH, with an ellipsis", () => {
    const shape: string = valueShape("x".repeat(500));

    expect(Array.from(shape)).toHaveLength(MAX_SHAPE_LENGTH + 1);
    expect(shape.endsWith("…")).toBe(true);
    expect(valueShape("x".repeat(MAX_SHAPE_LENGTH))).toBe(
      "a".repeat(MAX_SHAPE_LENGTH),
    );
  });

  test("never keeps a letter or a digit of the value", () => {
    const value: string = "Jane Doe, 4111 1111 1111 1111, jane@example.com";
    const shape: string = valueShape(value);

    expect(isValueShape(shape)).toBe(true);
    for (const character of "JDejn4e1xmplco") {
      if (character !== "a") {
        expect(shape.includes(character)).toBe(false);
      }
    }
  });
});

describe("isValueShape", () => {
  test("takes what valueShape writes", () => {
    for (const value of [
      "AB-1234",
      "kim@acme.example",
      "東京",
      "١٢٣",
      "x".repeat(200),
      '{"a": 1}',
    ]) {
      expect(isValueShape(valueShape(value))).toBe(true);
    }
  });

  test("refuses a value dressed as a shape", () => {
    expect(isValueShape("Jane")).toBe(false);
    expect(isValueShape("4111-1111")).toBe(false);
    expect(isValueShape("aaa@bbb.com")).toBe(false);
    expect(isValueShape("Aaaa 東")).toBe(false);
    expect(isValueShape("99٣")).toBe(false);
    expect(isValueShape("aa\taa")).toBe(false);
    expect(isValueShape("")).toBe(false);
  });

  test("an ellipsis only where a shape is cut, and nothing longer", () => {
    expect(isValueShape(`${"a".repeat(MAX_SHAPE_LENGTH)}…`)).toBe(true);
    expect(isValueShape("aa…aa")).toBe(false);
    expect(isValueShape("aa…")).toBe(false);
    expect(isValueShape("a".repeat(MAX_SHAPE_LENGTH + 2))).toBe(false);
  });
});

describe("field names", () => {
  test("splits a name into its words", () => {
    expect(fieldNameWords("billing.customerRef")).toEqual([
      "billing",
      "customer",
      "ref",
    ]);
    expect(fieldNameWords("created_at")).toEqual(["created", "at"]);
    expect(fieldNameWords("customerID")).toEqual(["customer", "id"]);
    expect(fieldNameWords("items[0]/sku-code")).toEqual([
      "items",
      "0",
      "sku",
      "code",
    ]);
  });

  test("a field's own name is the last part of its path", () => {
    expect(fieldOwnName("public.users.kundennr")).toBe("kundennr");
    expect(fieldOwnName("kundennr")).toBe("kundennr");
  });

  test("bookkeeping is named by its last word, or as is_something", () => {
    for (const name of [
      "id",
      "order_id",
      "public.users.created_at",
      "updatedAt",
      "row_version",
      "status",
      "is_active",
      "isDeleted",
      "sort_order",
    ]) {
      expect(isBookkeepingField(name)).toBe(true);
    }

    for (const name of [
      "kundennr",
      "customer_ref",
      "patient_mrn",
      "public.status_history.note_ref",
      "island",
    ]) {
      expect(isBookkeepingField(name)).toBe(false);
    }
  });

  test("neighbours are named as the field's own table names them", () => {
    expect(
      neighbourNames("public.users.kundennr", [
        "public.users.kundennr",
        "public.users.email",
        "public.users.name",
        "public.orders.total",
      ]),
    ).toEqual(["email", "name", "public.orders.total"]);

    const many: Array<string> = Array.from(
      { length: 50 },
      (_v: unknown, index: number) => {
        return `t.column_${index}`;
      },
    );

    expect(neighbourNames("t.x", many)).toHaveLength(MAX_FIELD_NEIGHBOURS);
    expect(neighbourNames("t.x", ["t.a", "t.a", "", "t.x"])).toEqual(["a"]);
  });
});

describe("describeUnplacedField", () => {
  test("describes a field by its shapes, the most common first, with their shares", () => {
    const values: Array<string> = [...customerNumbers(9), "KD-99999"];
    const field: UnplacedField | null = describeUnplacedField({
      path: "public.customers.kundennr",
      values,
      neighbours: [
        "public.customers.kundennr",
        "public.customers.email",
        "public.customers.created_at",
      ],
      locationKind: COLUMN,
    });

    expect(field).toEqual({
      location: "public.customers.kundennr",
      locationKind: COLUMN,
      neighbours: ["email", "created_at"],
      shapes: [
        { shape: "AA-999999", share: 0.9 },
        { shape: "AA-99999", share: 0.1 },
      ],
      valueCount: 10,
      averageLength: 8.9,
    });
  });

  test("holds no value of the field", () => {
    const values: Array<string> = customerNumbers(20);
    const field: UnplacedField | null = describeUnplacedField({
      path: "ref",
      values,
      neighbours: [],
      locationKind: COLUMN,
    });
    const text: string = JSON.stringify(field);

    for (const value of values) {
      expect(text.includes(value)).toBe(false);
      expect(text.includes(value.slice(3))).toBe(false);
    }
  });

  test("keeps at most MAX_FIELD_SHAPES shapes", () => {
    const values: Array<string> = Array.from(
      { length: 40 },
      (_v: unknown, index: number) => {
        return `${"A".repeat(1 + (index % 10))}-1`;
      },
    );
    const field: UnplacedField | null = describeUnplacedField({
      path: "code",
      values,
      neighbours: [],
      locationKind: COLUMN,
    });

    expect(field?.shapes).toHaveLength(MAX_FIELD_SHAPES);
  });

  test("reads at most MAX_SHAPED_VALUES values", () => {
    const field: UnplacedField | null = describeUnplacedField({
      path: "code",
      values: customerNumbers(MAX_SHAPED_VALUES + 500),
      neighbours: [],
      locationKind: COLUMN,
    });

    expect(field?.valueCount).toBe(MAX_SHAPED_VALUES);
  });

  test("leaves out what is not worth asking about", () => {
    const ask: (
      path: string,
      values: Array<unknown>,
    ) => UnplacedField | null = (
      path: string,
      values: Array<unknown>,
    ): UnplacedField | null => {
      return describeUnplacedField({
        path,
        values,
        neighbours: [],
        locationKind: COLUMN,
      });
    };

    // Too few values to say anything.
    expect(ask("ref", customerNumbers(MIN_UNPLACED_VALUES - 1))).toBeNull();
    expect(ask("ref", customerNumbers(MIN_UNPLACED_VALUES))).not.toBeNull();
    // Empty values do not count.
    expect(
      ask("ref", [...customerNumbers(3), null, undefined, "", "  "]),
    ).toBeNull();
    // Bookkeeping.
    expect(ask("customer_id", customerNumbers(20))).toBeNull();
    // True or false.
    expect(ask("ref", [true, false, true, false, true, false, "a"])).toBeNull();
    // Counts and small ids.
    expect(ask("ref", ["1", "2", "30", "400", "999999", "12"])).toBeNull();
    // Free text.
    expect(
      ask(
        "notes",
        Array.from({ length: 10 }, () => {
          return "w".repeat(FREE_TEXT_AVERAGE_LENGTH + 1);
        }),
      ),
    ).toBeNull();
    // A location longer than a finding can name.
    expect(ask("x".repeat(501), customerNumbers(20))).toBeNull();
  });

  test("a large number is asked about: it can be an account or a card", () => {
    expect(
      describeUnplacedField({
        path: "acct",
        values: ["12345678", "23456789", "34567890", "45678901", "56789012"],
        neighbours: [],
        locationKind: COLUMN,
      })?.shapes,
    ).toEqual([{ shape: "99999999", share: 1 }]);
  });

  test("the signature changes when the field or its shapes do", () => {
    const field: UnplacedField = describeUnplacedField({
      path: "ref",
      values: customerNumbers(10),
      neighbours: [],
      locationKind: COLUMN,
    })!;

    expect(unplacedFieldSignature(field)).toBe("ref|AA-999999");
    expect(unplacedFieldSignature({ ...field, location: "other" })).not.toBe(
      unplacedFieldSignature(field),
    );
    expect(
      unplacedFieldSignature({
        ...field,
        shapes: [{ shape: "999", share: 1 }],
      }),
    ).not.toBe(unplacedFieldSignature(field));
    // Neighbours and counts do not change what was asked.
    expect(
      unplacedFieldSignature({ ...field, neighbours: ["a"], valueCount: 99 }),
    ).toBe(unplacedFieldSignature(field));
  });
});

describe("readUnplacedFields: a probe's fields, read again", () => {
  const good: Record<string, unknown> = {
    location: "public.customers.kundennr",
    locationKind: COLUMN,
    neighbours: ["email", "name"],
    shapes: [{ shape: "AA-999999", share: 0.9 }],
    valueCount: 50,
    averageLength: 9,
  };

  test("reads what describeUnplacedField writes", () => {
    const written: UnplacedField = describeUnplacedField({
      path: "public.customers.kundennr",
      values: customerNumbers(12),
      neighbours: ["public.customers.email"],
      locationKind: COLUMN,
    })!;

    expect(
      readUnplacedFields(JSON.parse(JSON.stringify([written])), isKnownKind),
    ).toEqual([written]);
  });

  test("drops a shape that holds a value, and a field left with no shape", () => {
    expect(
      readUnplacedFields(
        [
          {
            ...good,
            shapes: [
              { shape: "Jane Doe", share: 0.5 },
              { shape: "Aaaa Aaa", share: 0.5 },
            ],
          },
          { ...good, shapes: [{ shape: "4111 1111", share: 1 }] },
        ],
        isKnownKind,
      ),
    ).toEqual([{ ...good, shapes: [{ shape: "Aaaa Aaa", share: 0.5 }] }]);
  });

  test("drops what is not a field", () => {
    expect(readUnplacedFields("fields", isKnownKind)).toEqual([]);
    expect(readUnplacedFields(null, isKnownKind)).toEqual([]);
    expect(
      readUnplacedFields(
        [
          null,
          [],
          "x",
          { ...good, location: "" },
          { ...good, location: "x".repeat(501) },
          { ...good, locationKind: "Table" },
          { ...good, valueCount: -1 },
          { ...good, valueCount: MAX_SHAPED_VALUES + 1 },
          { ...good, averageLength: FREE_TEXT_AVERAGE_LENGTH + 1 },
          { ...good, shapes: "AA-999999" },
          { ...good, shapes: [{ shape: "AA-999999", share: 2 }] },
        ],
        isKnownKind,
      ),
    ).toEqual([]);
  });

  test("holds each part to its bounds", () => {
    const [field] = readUnplacedFields(
      [
        {
          ...good,
          neighbours: [
            ...Array.from({ length: 40 }, (_v: unknown, index: number) => {
              return `n${index}${"x".repeat(200)}`;
            }),
          ],
          shapes: Array.from({ length: 20 }, () => {
            return { shape: "AA-999999", share: 0.05 };
          }),
          valueCount: 12.7,
        },
      ],
      isKnownKind,
    );

    expect(field!.neighbours).toHaveLength(MAX_FIELD_NEIGHBOURS);
    expect(field!.neighbours[0]!.length).toBe(100);
    expect(field!.shapes).toHaveLength(MAX_FIELD_SHAPES);
    expect(field!.valueCount).toBe(12);
  });

  test("reads at most MAX_UNPLACED_FIELDS_PER_SCAN fields", () => {
    expect(
      readUnplacedFields(
        Array.from({ length: MAX_UNPLACED_FIELDS_PER_SCAN + 50 }, () => {
          return good;
        }),
        isKnownKind,
      ),
    ).toHaveLength(MAX_UNPLACED_FIELDS_PER_SCAN);
  });
});
