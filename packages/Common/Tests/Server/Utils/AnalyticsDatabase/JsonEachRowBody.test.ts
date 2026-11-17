import JsonEachRowBody, {
  JSON_EACH_ROW_CHUNK_CHARS,
} from "../../../../Server/Utils/AnalyticsDatabase/JsonEachRowBody";
import { JSONObject } from "../../../../Types/JSON";
import { NodeValuesEncoder } from "@clickhouse/client/dist/utils/encoder";
import { Readable } from "stream";
import { describe, expect, test } from "@jest/globals";
import { seededRandom } from "../../../Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * THE INSERT BODY IS THE CLIENT'S OWN, BYTE FOR BYTE (#6086).
 *
 * AnalyticsDatabaseService.insertJsonRows used to hand @clickhouse/client
 * the rows and let it write `JSON.stringify(row) + "\n"` for each and join
 * them into one string. It now writes the same bytes in 32 KB pieces
 * (JsonEachRowBody), and sends them through exec() (see
 * AnalyticsExecuteReleasesConnection for the request itself). Here the
 * pieces are held to the client's own NodeValuesEncoder over rows of every
 * kind - unicode, astral characters, lone surrogates, escapes, rows longer
 * than a piece, keys named __proto__ - and the piece boundaries never split
 * a row.
 * ---------------------------------------------------------------------------
 */

const clientEncoder: NodeValuesEncoder = new NodeValuesEncoder();

// The bytes the client sends for `rows` in JSONEachRow.
function clientBody(rows: Array<JSONObject>): Buffer {
  return Buffer.from(
    clientEncoder.encodeValues(rows, "JSONEachRow") as string,
    "utf-8",
  );
}

const TEXTS: Array<string> = [
  "",
  "plain",
  "naïve café",
  "日本語のログ",
  "🚀 launch",
  // The line and paragraph separators (written so: a formatter unescapes them).
  `${String.fromCharCode(0x2028)} and ${String.fromCharCode(0x2029)}`,
  'quotes " and \\ backslashes',
  "line\nbreak\ttab\u0000nul",
  "\ud800 lone high surrogate",
  "lone low \udc00",
  "x".repeat(5000),
];

function randomRow(random: () => number, index: number): JSONObject {
  const text: () => string = (): string => {
    return TEXTS[Math.floor(random() * TEXTS.length)]!;
  };
  const row: JSONObject = {
    _id: `019a1f2e-1b40-7000-8000-${index.toString(16).padStart(12, "0")}`,
    projectId: "6f0d8bb1-6c55-4a39-a0a9-6b0a4a4e5a10",
    time: "2026-10-17 10:11:12.345678901",
    timeUnixNano: "1792231872345678901",
    severityNumber: Math.floor(random() * 24),
    body: text(),
    attributes: {
      "resource.service.name": text(),
      "http.status_code": random() < 0.5 ? 200 : "500",
      ratio: random(),
      list: [text(), 1, true, null],
      nested: { deeper: text() },
    },
    attributeKeys: ["resource.service.name", "http.status_code", "ratio"],
    isRoot: random() < 0.5,
    nothing: null,
  };

  if (random() < 0.1) {
    // A sender's own key, kept as a key (Common/Utils/LookupTable).
    Object.defineProperty(row["attributes"], "__proto__", {
      value: "kept",
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  if (random() < 0.05) {
    // Huge: one row past a whole piece.
    row["body"] = "y".repeat(JSON_EACH_ROW_CHUNK_CHARS * 2);
  }

  return row;
}

describe("JsonEachRowBody.encode writes what the ClickHouse client writes", () => {
  test("2,000 rows of every kind, in pieces that join to the client's body", () => {
    const random: () => number = seededRandom(6086);
    const rows: Array<JSONObject> = [];

    for (let i: number = 0; i < 2000; i++) {
      rows.push(randomRow(random, i));
    }

    const chunks: Array<Buffer> = JsonEachRowBody.encode(rows);

    expect(Buffer.concat(chunks).equals(clientBody(rows))).toBe(true);
    expect(chunks.length).toBeGreaterThan(10);
  });

  test("a piece ends only where a row ends, and is cut once it reaches the size", () => {
    const random: () => number = seededRandom(7);
    const rows: Array<JSONObject> = [];

    for (let i: number = 0; i < 500; i++) {
      rows.push(randomRow(random, i));
    }

    const chunks: Array<Buffer> = JsonEachRowBody.encode(rows, 4096);

    for (const chunk of chunks) {
      expect(chunk[chunk.length - 1]).toBe(0x0a);
      // Every line of a piece is a whole row.
      for (const line of chunk.toString("utf-8").slice(0, -1).split("\n")) {
        expect(() => {
          return JSON.parse(line);
        }).not.toThrow();
      }
    }

    // All but the last reached the size; the last holds what was left.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.toString("utf-8").length).toBeGreaterThanOrEqual(4096);
    }

    expect(Buffer.concat(chunks).equals(clientBody(rows))).toBe(true);
  });

  test("no rows, one row, and rows exactly at the piece size", () => {
    expect(JsonEachRowBody.encode([])).toEqual([]);

    const one: Array<JSONObject> = [{ a: 1 }];
    expect(Buffer.concat(JsonEachRowBody.encode(one)).toString()).toBe(
      '{"a":1}\n',
    );

    // Each row and its line break exactly 8 characters.
    const exact: Array<JSONObject> = [{ a: 1 }, { b: 2 }, { c: 3 }];
    const chunks: Array<Buffer> = JsonEachRowBody.encode(exact, 8);
    expect(
      chunks.map((chunk: Buffer) => {
        return chunk.toString();
      }),
    ).toEqual(['{"a":1}\n', '{"b":2}\n', '{"c":3}\n']);
  });

  test("a row the client could not write fails the same way, before any piece is sent", () => {
    const rows: Array<JSONObject> = [
      { a: 1 },
      { big: BigInt(1) as unknown as number },
    ];

    let clientError: Error | null = null;
    try {
      clientBody(rows);
    } catch (error) {
      clientError = error as Error;
    }

    expect(clientError).toBeInstanceOf(TypeError);
    expect(() => {
      return JsonEachRowBody.encode(rows);
    }).toThrow(clientError!.message);
  });
});

describe("JsonEachRowBody.toStream and drain", () => {
  test("the stream gives the pieces, in order, as bytes", async () => {
    const chunks: Array<Buffer> = [
      Buffer.from('{"a":1}\n'),
      Buffer.from('{"b":"日本"}\n'),
    ];
    const received: Array<Buffer> = [];

    for await (const piece of JsonEachRowBody.toStream(chunks)) {
      received.push(piece as Buffer);
    }

    expect(Buffer.concat(received).toString()).toBe('{"a":1}\n{"b":"日本"}\n');
  });

  test("drain reads a response to its end, and fails with it", async () => {
    let ended: boolean = false;
    const response: Readable = Readable.from(["a", "b"]);
    response.on("end", () => {
      ended = true;
    });

    await JsonEachRowBody.drain(response);
    expect(ended).toBe(true);

    const failing: Readable = new Readable({
      read(): void {
        this.destroy(new Error("socket hang up"));
      },
    });

    await expect(JsonEachRowBody.drain(failing)).rejects.toThrow(
      "socket hang up",
    );
  });
});
