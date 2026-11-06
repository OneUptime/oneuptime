import { describe, expect, test } from "@jest/globals";
import {
  DefaultTableColumns,
  DefaultTableColumnsUtil,
  MAX_DEFAULT_TABLE_COLUMNS_TABLES,
  MAX_TABLE_COLUMN_ID_LENGTH,
  MAX_TABLE_KEY_LENGTH,
  MAX_TABLE_LAYOUT_COLUMN_IDS,
} from "../../../Types/Table/DefaultTableColumns";

/*
 * "Default columns per project" (#5485's follow-ups): a Project Owner or
 * Admin makes a list's columns the project's own, and everyone who has not
 * chosen columns of their own for that list sees them
 * (Project.defaultTableColumns).
 *
 * The value is kept as one object - a list's key to its layout, the column
 * ids in order and those switched off - and read as untrusted: the server
 * refuses what does not read as layouts (getProblem) and stores the rest
 * tidied (parse), and a list reads only its own (getLayout).
 */

const INCIDENTS: DefaultTableColumns = {
  "incidents-table": {
    order: ["incidentNumber", "title", "currentIncidentState", "labels"],
    hidden: ["labels"],
  },
};

describe("what may be stored as a project's default columns", () => {
  test("nothing - null or nothing at all - which hands every list back its own columns", () => {
    expect(DefaultTableColumnsUtil.getProblem(null)).toBeNull();
    expect(DefaultTableColumnsUtil.getProblem(undefined)).toBeNull();
  });

  test("lists' keys to layouts of column ids", () => {
    expect(DefaultTableColumnsUtil.getProblem(INCIDENTS)).toBeNull();
    expect(
      DefaultTableColumnsUtil.getProblem({
        "incidents-table": { order: ["title"] },
        "alerts-table": { hidden: ["labels"] },
      }),
    ).toBeNull();
  });

  test("not text, a number or a list: an object of lists", () => {
    for (const value of ["incidents-table", 3, ["title"], true]) {
      expect(DefaultTableColumnsUtil.getProblem(value)).toBe(
        "Default table columns must be an object of lists to their columns.",
      );
    }
  });

  test("a list's layout is an object with order and hidden", () => {
    expect(
      DefaultTableColumnsUtil.getProblem({ "incidents-table": ["title"] }),
    ).toBe(
      "The default columns of incidents-table must be an object with order and hidden.",
    );
    expect(
      DefaultTableColumnsUtil.getProblem({
        "incidents-table": { order: "title" },
      }),
    ).toBe(
      "The order of incidents-table's default columns must be a list of column ids.",
    );
    expect(
      DefaultTableColumnsUtil.getProblem({
        "incidents-table": { hidden: [1] },
      }),
    ).toBe(
      `Each column id in incidents-table's default columns must be text of 1 to ${MAX_TABLE_COLUMN_ID_LENGTH} characters.`,
    );
  });

  test("within its limits: lists, a list's key, a layout's ids and an id's length", () => {
    const tooManyLists: Record<string, unknown> = {};

    for (
      let index: number = 0;
      index <= MAX_DEFAULT_TABLE_COLUMNS_TABLES;
      index++
    ) {
      tooManyLists[`list-${index}`] = { order: ["title"] };
    }

    expect(DefaultTableColumnsUtil.getProblem(tooManyLists)).toBe(
      `Default table columns can be kept for at most ${MAX_DEFAULT_TABLE_COLUMNS_TABLES} lists.`,
    );
    expect(
      DefaultTableColumnsUtil.getProblem({
        ["k".repeat(MAX_TABLE_KEY_LENGTH + 1)]: { order: ["title"] },
      }),
    ).toBe(
      `A list's key must be 1 to ${MAX_TABLE_KEY_LENGTH} characters long.`,
    );
    expect(
      DefaultTableColumnsUtil.getProblem({ " ": { order: ["title"] } }),
    ).toBe(
      `A list's key must be 1 to ${MAX_TABLE_KEY_LENGTH} characters long.`,
    );
    expect(
      DefaultTableColumnsUtil.getProblem({
        "incidents-table": {
          order: Array.from(Array(MAX_TABLE_LAYOUT_COLUMN_IDS + 1).keys()).map(
            (index: number): string => {
              return `column-${index}`;
            },
          ),
        },
      }),
    ).toBe(
      `The order of incidents-table's default columns can name at most ${MAX_TABLE_LAYOUT_COLUMN_IDS} columns.`,
    );
    expect(
      DefaultTableColumnsUtil.getProblem({
        "incidents-table": {
          order: ["x".repeat(MAX_TABLE_COLUMN_ID_LENGTH + 1)],
        },
      }),
    ).toBe(
      `Each column id in incidents-table's default columns must be text of 1 to ${MAX_TABLE_COLUMN_ID_LENGTH} characters.`,
    );
  });
});

describe("a stored value read back", () => {
  test("every list's layout, each id once", () => {
    expect(
      DefaultTableColumnsUtil.parse({
        "incidents-table": {
          order: ["title", "title", "labels"],
          hidden: ["labels", "labels"],
        },
      }),
    ).toEqual({
      "incidents-table": { order: ["title", "labels"], hidden: ["labels"] },
    });
  });

  test("a layout that names nothing changes nothing: it is left out, and a value of none is none", () => {
    expect(
      DefaultTableColumnsUtil.parse({
        "incidents-table": { order: [], hidden: [] },
      }),
    ).toBeNull();
    expect(
      DefaultTableColumnsUtil.parse({
        "incidents-table": { order: [], hidden: [] },
        ...INCIDENTS,
      }),
    ).toEqual(INCIDENTS);
    expect(DefaultTableColumnsUtil.parse({})).toBeNull();
  });

  test("anything that is no layout - written by hand, by an older version - is left out, never refused on reading", () => {
    expect(
      DefaultTableColumnsUtil.parse({
        "incidents-table": "title",
        "alerts-table": { order: [3, "", "title"], hidden: "labels" },
        ...{ "": { order: ["title"] } },
      }),
    ).toEqual({ "alerts-table": { order: ["title"], hidden: [] } });
    expect(DefaultTableColumnsUtil.parse("incidents-table")).toBeNull();
    expect(DefaultTableColumnsUtil.parse(null)).toBeNull();
    expect(DefaultTableColumnsUtil.parse(["title"])).toBeNull();
  });

  test("one list's own layout, or none", () => {
    expect(
      DefaultTableColumnsUtil.getLayout(INCIDENTS, "incidents-table"),
    ).toEqual(INCIDENTS["incidents-table"]);
    expect(
      DefaultTableColumnsUtil.getLayout(INCIDENTS, "alerts-table"),
    ).toBeNull();
    expect(DefaultTableColumnsUtil.getLayout(undefined, "x")).toBeNull();
    expect(DefaultTableColumnsUtil.getLayout(INCIDENTS, "")).toBeNull();
  });
});

describe("one list's default set or taken away", () => {
  test("set: every other list's as it was", () => {
    expect(
      DefaultTableColumnsUtil.withLayout({
        value: INCIDENTS,
        tableKey: "alerts-table",
        layout: { order: ["title", "monitor"], hidden: ["monitor"] },
      }),
    ).toEqual({
      ...INCIDENTS,
      "alerts-table": { order: ["title", "monitor"], hidden: ["monitor"] },
    });
  });

  test("set again: replaced", () => {
    expect(
      DefaultTableColumnsUtil.withLayout({
        value: INCIDENTS,
        tableKey: "incidents-table",
        layout: { order: ["title"], hidden: [] },
      }),
    ).toEqual({ "incidents-table": { order: ["title"], hidden: [] } });
  });

  test("taken away: the others stay, and with none left the value is none", () => {
    expect(
      DefaultTableColumnsUtil.withLayout({
        value: {
          ...INCIDENTS,
          "alerts-table": { order: ["title"], hidden: [] },
        },
        tableKey: "incidents-table",
        layout: null,
      }),
    ).toEqual({ "alerts-table": { order: ["title"], hidden: [] } });
    expect(
      DefaultTableColumnsUtil.withLayout({
        value: INCIDENTS,
        tableKey: "incidents-table",
        layout: null,
      }),
    ).toBeNull();
  });

  test("a layout that names nothing takes the list's default away", () => {
    expect(
      DefaultTableColumnsUtil.withLayout({
        value: INCIDENTS,
        tableKey: "incidents-table",
        layout: { order: [], hidden: [] },
      }),
    ).toBeNull();
  });

  test("past the limit it is not dropped unseen: the server says so", () => {
    const full: Record<string, unknown> = {};

    for (
      let index: number = 0;
      index < MAX_DEFAULT_TABLE_COLUMNS_TABLES;
      index++
    ) {
      full[`list-${index}`] = { order: ["title"], hidden: [] };
    }

    const next: DefaultTableColumns | null = DefaultTableColumnsUtil.withLayout(
      {
        value: full,
        tableKey: "one-more-table",
        layout: { order: ["title"], hidden: [] },
      },
    );

    expect(Object.keys(next || {})).toHaveLength(
      MAX_DEFAULT_TABLE_COLUMNS_TABLES + 1,
    );
    expect(DefaultTableColumnsUtil.getProblem(next)).not.toBeNull();
  });

  test("as the column stores it: a copy, never the layouts it was handed", () => {
    const json: unknown = DefaultTableColumnsUtil.toJSON(INCIDENTS);

    expect(json).toEqual(INCIDENTS);
    expect((json as DefaultTableColumns)["incidents-table"]?.order).not.toBe(
      INCIDENTS["incidents-table"]?.order,
    );
    expect(DefaultTableColumnsUtil.toJSON(null)).toBeNull();
  });
});
