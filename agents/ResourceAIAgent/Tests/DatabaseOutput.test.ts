import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  MAX_CELL_CHARS,
  MAX_LAST_CELL_CHARS,
  OutputSection,
  formatBytes,
  formatCell,
  limitRows,
  mongoCommandShape,
  normalizeQueryText,
  renderSections,
  renderSectionsAsJson,
  renderSectionsAsText,
  safeJson,
  valueToText,
} from "../Executors/Database/DatabaseOutput";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { redactResourceCommandOutput } from "../Common/Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * How a db command's answer prints: aligned tables with query text last
 * and normalized, one line per value, name/value fields, records, text and
 * JSON — and nothing in it that the output redactor would have to guess
 * about.
 */

describe("tables", () => {
  test("uppercase headers, columns aligned three spaces apart, the last column unpadded", () => {
    const text: string = renderSectionsAsText([
      {
        kind: "table",
        columns: [
          { key: "pid" },
          { key: "user_name", header: "user" },
          { key: "query", kind: "query" },
        ],
        rows: [
          { pid: 7, user_name: "app", query: "SELECT 1" },
          { pid: 12345, user_name: null, query: "COMMIT" },
        ],
      },
    ]);

    assert.strictEqual(
      text,
      [
        "PID     USER   QUERY",
        "7       app    SELECT ?",
        "12345   -      COMMIT",
      ].join("\n"),
    );
  });

  test("query text is normalized before it is cut or flattened: literals never survive", () => {
    const text: string = renderSectionsAsText([
      {
        kind: "table",
        columns: [{ key: "pid" }, { key: "query", kind: "query" }],
        rows: [
          {
            pid: 1,
            query:
              "/* app */ UPDATE users\n  SET email = 'jane@example.com', card = 4111111111111111\n  WHERE id = 42",
          },
          { pid: 2, query: "ALTER USER app WITH PASSWORD 'hunter2'" },
        ],
      },
    ]);

    assert.ok(!text.includes("jane@example.com"), text);
    assert.ok(!text.includes("4111111111111111"), text);
    assert.ok(!text.includes("hunter2"), text);
    assert.match(
      text,
      /UPDATE users SET email = '\?', card = \? WHERE id = \?/,
    );
    // One row per line.
    assert.strictEqual(text.split("\n").length, 3);
  });

  test("control characters become spaces, and long cells are cut with ...", () => {
    const long: string = "x".repeat(MAX_CELL_CHARS + 20);
    const lastLong: string = "y".repeat(MAX_LAST_CELL_CHARS + 20);
    const text: string = renderSectionsAsText([
      {
        kind: "table",
        columns: [{ key: "a" }, { key: "b" }],
        rows: [{ a: `left\tand\u0000right\r\n${long}`, b: lastLong }],
      },
    ]);
    const cells: Array<string> = (text.split("\n")[1] || "").split(/ {3,}/);

    assert.ok(!text.includes("\u0000"));
    assert.ok(!text.includes("\t"));
    assert.strictEqual(cells[0]!.length, MAX_CELL_CHARS);
    assert.ok(cells[0]!.startsWith("left and right xxx"));
    assert.ok(cells[0]!.endsWith("..."));
    assert.strictEqual(cells[1]!.length, MAX_LAST_CELL_CHARS);
    assert.ok(cells[1]!.endsWith("..."));
  });

  test("an empty table prints its empty text, a title goes above it", () => {
    assert.strictEqual(
      renderSectionsAsText([
        {
          kind: "table",
          title: "Replicas",
          columns: [{ key: "a" }],
          rows: [],
          emptyText: "No replica is connected.",
        },
      ]),
      "Replicas:\nNo replica is connected.",
    );
    assert.strictEqual(
      renderSectionsAsText([
        { kind: "table", columns: [{ key: "a" }], rows: [] },
      ]),
      "(no rows)",
    );
  });
});

describe("fields, records, text, json and notes", () => {
  test("fields are aligned name: value lines; records are numbered blocks", () => {
    const text: string = renderSectionsAsText([
      {
        kind: "fields",
        fields: [
          { name: "role", value: "primary" },
          { name: "max_connections", value: 100 },
          { name: "query", value: "SELECT 'secret'", kind: "query" },
        ],
      },
      {
        kind: "records",
        title: "Blocked",
        columns: [
          { key: "blocked_pid" },
          { key: "blocked_query", kind: "query" },
        ],
        rows: [
          { blocked_pid: 5, blocked_query: "UPDATE t SET a = 1" },
          { blocked_pid: 6, blocked_query: null },
        ],
      },
      { kind: "note", text: "A note." },
    ]);

    assert.strictEqual(
      text,
      [
        "role:            primary",
        "max_connections: 100",
        "query:           SELECT '?'",
        "",
        "Blocked:",
        "[1]",
        "  blocked_pid:   5",
        "  blocked_query: UPDATE t SET a = ?",
        "",
        "[2]",
        "  blocked_pid:   6",
        "  blocked_query: -",
        "",
        "A note.",
      ].join("\n"),
    );
  });

  test("a text section keeps its lines (\\r\\n folded, control characters dropped); JSON is pretty", () => {
    const text: string = renderSectionsAsText([
      {
        kind: "text",
        title: "INFO",
        text: "# Server\r\nredis_version:7.2\u0007\r\n",
      },
      {
        kind: "json",
        title: "mem",
        value: { resident: 120, big: BigInt(2) ** BigInt(70) },
      },
    ]);

    assert.strictEqual(
      text,
      [
        "INFO:",
        "# Server",
        "redis_version:7.2",
        "",
        "mem:",
        "{",
        '  "resident": 120,',
        '  "big": "1180591620717411303424"',
        "}",
      ].join("\n"),
    );
  });

  test("the JSON format renders the same sections as one document, never keyed data", () => {
    const sections: Array<OutputSection> = [
      {
        kind: "table",
        title: "Sessions",
        columns: [{ key: "pid" }, { key: "query", kind: "query" }],
        rows: [{ pid: 1, query: "SELECT * FROM t WHERE a = 'x'" }],
      },
      { kind: "fields", fields: [{ name: "at", value: new Date(0) }] },
      { kind: "note", text: "n" },
    ];
    const json: string = renderSectionsAsJson({
      operation: "sessions",
      engine: "postgresql",
      sections,
    });
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<
      string,
      unknown
    >;

    assert.deepStrictEqual(parsed, {
      operation: "sessions",
      engine: "postgresql",
      sections: [
        {
          title: "Sessions",
          rows: [{ pid: 1, query: "SELECT * FROM t WHERE a = '?'" }],
        },
        { title: null, fields: { at: "1970-01-01T00:00:00.000Z" } },
        { note: "n" },
      ],
    });
    assert.ok(!("data" in parsed));
    assert.strictEqual(
      renderSections({
        format: "json",
        operation: "sessions",
        engine: "postgresql",
        sections,
      }),
      json,
    );
    assert.strictEqual(
      renderSections({
        format: "table",
        operation: "sessions",
        engine: "postgresql",
        sections,
      }),
      renderSectionsAsText(sections),
    );
  });

  test("the redactor leaves the rendered output's normalized statements as they are", () => {
    const text: string = renderSectionsAsText([
      {
        kind: "table",
        columns: [
          { key: "pid" },
          { key: "state" },
          { key: "query", kind: "query" },
        ],
        rows: [
          {
            pid: 42,
            state: "active",
            query: "SELECT name FROM customers WHERE email = 'a@b.co' LIMIT 10",
          },
        ],
      },
    ]);
    const redacted: string = redactResourceCommandOutput({
      resourceType: AiResourceType.DatabaseServer,
      program: "db",
      text,
    });

    assert.strictEqual(redacted, text);
    assert.match(
      redacted,
      /^42\s+active\s+SELECT name FROM customers WHERE email = '\?' LIMIT \?$/m,
    );
  });
});

describe("values", () => {
  test("valueToText and formatCell for every kind of driver value", () => {
    assert.strictEqual(valueToText(null), "");
    assert.strictEqual(valueToText(undefined), "");
    assert.strictEqual(valueToText(true), "true");
    assert.strictEqual(valueToText(12.5), "12.5");
    assert.strictEqual(valueToText(BigInt(9)), "9");
    assert.strictEqual(
      valueToText(new Date("2026-01-02T03:04:05.000Z")),
      "2026-01-02T03:04:05.000Z",
    );
    assert.strictEqual(valueToText(new Date(NaN)), "");
    assert.strictEqual(valueToText(Buffer.from("abc")), "<3 bytes>");
    assert.strictEqual(valueToText({ a: [1, "b"] }), '{"a":[1,"b"]}');

    assert.strictEqual(formatCell("", "text", 10), "-");
    assert.strictEqual(formatCell("   ", "text", 10), "-");
    assert.strictEqual(formatCell({ k: 1 }, "json", 100), '{"k":1}');
    assert.strictEqual(formatCell("abcdefghijk", "text", 8), "abcde...");
  });

  test("safeJson never throws: cycles and buffers are named", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;

    assert.strictEqual(safeJson(cyclic), '{"a":1,"self":"[circular]"}');
    assert.strictEqual(safeJson({ b: Buffer.alloc(4) }), '{"b":"<4 bytes>"}');
    assert.strictEqual(safeJson(undefined), "");
  });

  test("normalizeQueryText masks literals and keeps names and bind parameters", () => {
    assert.strictEqual(
      normalizeQueryText("SELECT * FROM t1 WHERE a = $1 AND b = 'x' AND c = 3"),
      "SELECT * FROM t1 WHERE a = $1 AND b = '?' AND c = ?",
    );
    assert.strictEqual(normalizeQueryText(null), "");
  });

  test("formatBytes reads bytes as people do", () => {
    assert.strictEqual(formatBytes(0), "0 B");
    assert.strictEqual(formatBytes(1023), "1023 B");
    assert.strictEqual(formatBytes(1536), "1.5 KiB");
    assert.strictEqual(formatBytes("7879703"), "7.5 MiB");
    assert.strictEqual(formatBytes(5 * 1024 ** 4), "5.0 TiB");
    assert.strictEqual(formatBytes(null), "");
    assert.strictEqual(formatBytes("abc"), "");
    assert.strictEqual(formatBytes(-1), "");
  });

  test("limitRows keeps the first rows and says there were more", () => {
    assert.deepStrictEqual(limitRows([1, 2], 2, "hint"), {
      rows: [1, 2],
      note: null,
    });
    assert.deepStrictEqual(limitRows([1, 2, 3], 2, "Raise --limit."), {
      rows: [1, 2],
      note: {
        kind: "note",
        text: "Showing the first 2 rows; there are more. Raise --limit.",
      },
    });
  });

  test("a MongoDB command becomes its shape: keys and the collection kept, values masked", () => {
    assert.deepStrictEqual(
      mongoCommandShape({
        find: "orders",
        filter: { email: "jane@example.com", total: { $gt: 100 } },
        projection: { _id: 0 },
        limit: 5,
        $db: "shop",
        lsid: { id: { $binary: { base64: "AAAA", subType: "04" } } },
        pipeline: [{ $match: { status: "open" } }],
      }),
      {
        find: "orders",
        filter: { email: "?", total: { $gt: "?" } },
        projection: { _id: "?" },
        limit: "?",
        $db: "shop",
        lsid: { id: { $binary: { base64: "?", subType: "?" } } },
        pipeline: [{ $match: { status: "?" } }],
      },
    );
    // The first key's value is kept only when it names something (a string).
    assert.deepStrictEqual(
      mongoCommandShape({ getMore: 123456, collection: "c" }),
      {
        getMore: "?",
        collection: "?",
      },
    );
    assert.strictEqual(mongoCommandShape("x"), "?");
    assert.strictEqual(mongoCommandShape(null), null);
  });
});
