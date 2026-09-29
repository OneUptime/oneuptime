/*
 * The row model, and the one function every edit goes through.
 *
 * changeColumnRow exists because the alternative — a callback per field — is
 * silently broken in React: two of them fired from one event both close over
 * the same render's row, and the second overwrites the first. That is not a
 * theoretical hazard; it made a raw cell impossible to type into while the box
 * on screen showed the new text, which is the worst shape a bug can take.
 */

import { DictionaryFilterOperator } from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  ColumnValueMode,
  ModelColumnRow,
  changeColumnRow,
  makeColumnRow,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { describe, expect, test } from "@jest/globals";

describe("makeColumnRow", () => {
  test("fills in the defaults an untouched row has", () => {
    const row: ModelColumnRow = makeColumnRow({ columnId: "name" });

    expect(row.columnId).toBe("name");
    expect(row.operator).toBe(DictionaryFilterOperator.EqualTo);
    expect(row.valueMode).toBe(ColumnValueMode.Literal);
    expect(row.text).toBe("");
    expect(row.values).toEqual([]);
    expect(row.isSeeded).toBe(false);
  });

  test("gives every row an identity of its own", () => {
    /*
     * React keys rows by this. Keyed by column name instead, a row whose name
     * is being typed would be unmounted and remounted on every keystroke, and
     * the focused input would go with it.
     */
    const first: ModelColumnRow = makeColumnRow({ columnId: "name" });
    const second: ModelColumnRow = makeColumnRow({ columnId: "name" });

    expect(first.key).not.toBe(second.key);
    expect(first.key.length).toBeGreaterThan(0);
  });

  test("keeps a raw value only when it was given one", () => {
    expect(makeColumnRow({ columnId: "a" }).rawValue).toBeUndefined();
    expect(
      makeColumnRow({
        columnId: "a",
        valueMode: ColumnValueMode.Raw,
        rawValue: null,
      }).rawValue,
    ).toBeNull();
  });
});

describe("changeColumnRow", () => {
  const raw: ModelColumnRow = makeColumnRow({
    columnId: "port",
    valueMode: ColumnValueMode.Raw,
    text: "8080",
    rawValue: "8080",
  });

  test("carries several changes at once, which is the whole point", () => {
    const next: ModelColumnRow = changeColumnRow(raw, {
      text: "9090",
      valueMode: ColumnValueMode.Literal,
    });

    expect(next.text).toBe("9090");
    expect(next.valueMode).toBe(ColumnValueMode.Literal);
  });

  test("drops the stored original once the row stops being raw", () => {
    /*
     * Otherwise serialization keeps emitting the value that was read, and the
     * builder's own typing never reaches the workflow.
     */
    const next: ModelColumnRow = changeColumnRow(raw, {
      text: "9090",
      valueMode: ColumnValueMode.Literal,
    });

    expect(next.rawValue).toBeUndefined();
  });

  test("keeps the stored original while the row is still raw", () => {
    const next: ModelColumnRow = changeColumnRow(raw, {
      columnId: "portNumber",
    });

    expect(next.valueMode).toBe(ColumnValueMode.Raw);
    expect(next.rawValue).toBe("8080");
  });

  test("a row that has been edited is no longer a blank the editor opened with", () => {
    const seeded: ModelColumnRow = makeColumnRow({
      columnId: "name",
      isSeeded: true,
    });

    expect(changeColumnRow(seeded, { text: "Acknowledged" }).isSeeded).toBe(
      false,
    );
  });

  test("the row keeps its identity through an edit", () => {
    expect(changeColumnRow(raw, { text: "9090" }).key).toBe(raw.key);
  });

  test("does not mutate the row it was given", () => {
    changeColumnRow(raw, { text: "9090", valueMode: ColumnValueMode.Literal });

    expect(raw.text).toBe("8080");
    expect(raw.valueMode).toBe(ColumnValueMode.Raw);
    expect(raw.rawValue).toBe("8080");
  });
});
