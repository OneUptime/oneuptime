import McpSseParser, {
  McpSseEvent,
  McpSseEventTooLargeError,
} from "../../../../../Server/Utils/AI/Mcp/McpSseParser";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * The event-stream reader both MCP HTTP transports carry JSON-RPC messages
 * on. A stream is text from a server outside OneUptime: it is read in one
 * pass whatever its shape, an event too large stops it, and an event split
 * anywhere across chunks reads the same as one sent whole.
 */

function parseAll(
  chunks: Array<string>,
  maxEventChars?: number,
): Array<McpSseEvent> {
  const parser: McpSseParser = new McpSseParser({
    maxEventChars: maxEventChars ?? 1_000_000,
  });
  const events: Array<McpSseEvent> = [];

  for (const chunk of chunks) {
    events.push(...parser.push(chunk));
  }

  events.push(...parser.end());

  return events;
}

describe("McpSseParser", () => {
  test("reads an event with its type, data and id", () => {
    expect(
      parseAll(["event: endpoint\nid: 7\ndata: /messages?sessionId=1\n\n"]),
    ).toEqual([{ event: "endpoint", data: "/messages?sessionId=1", id: "7" }]);
  });

  test("an event without a type is a message", () => {
    expect(parseAll(['data: {"a":1}\n\n'])).toEqual([
      { event: "message", data: '{"a":1}' },
    ]);
  });

  test("joins the data lines of one event with line feeds", () => {
    expect(parseAll(["data: one\ndata: two\ndata:three\n\n"])).toEqual([
      { event: "message", data: "one\ntwo\nthree" },
    ]);
  });

  test("reads lines ending in CRLF, LF and CR alike", () => {
    expect(
      parseAll(["data: a\r\n\r\ndata: b\n\ndata: c\r\rdata: d\r\n\n"]),
    ).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
      { event: "message", data: "c" },
      { event: "message", data: "d" },
    ]);
  });

  test("skips comments, keep-alives and blank events", () => {
    expect(parseAll([": keep-alive\n\n:another\n\n\n\ndata: x\n\n"])).toEqual([
      { event: "message", data: "x" },
    ]);
  });

  test("ignores retry and unknown fields, and a field with no colon", () => {
    expect(parseAll(["retry: 100\nfoo: bar\ndata\n\n"])).toEqual([
      { event: "message", data: "" },
    ]);
  });

  test("keeps a colon after the first one in the value", () => {
    expect(parseAll(["data: a: b: c\n\n"])).toEqual([
      { event: "message", data: "a: b: c" },
    ]);
  });

  test("an event the stream never finished is dropped", () => {
    expect(parseAll(["data: first\n\ndata: unfinished\n"])).toEqual([
      { event: "message", data: "first" },
    ]);
  });

  test("an id holding a NUL is ignored", () => {
    expect(parseAll(["id: a\u0000b\ndata: x\n\n"])).toEqual([
      { event: "message", data: "x" },
    ]);
  });

  test("reads the same events however the stream is split", () => {
    const stream: string =
      'event: endpoint\r\ndata: /messages\r\n\r\n: ping\n\nid: 2\ndata: {"jsonrpc":"2.0"}\r\rdata: tail\n\n';
    const whole: Array<McpSseEvent> = parseAll([stream]);

    expect(whole).toHaveLength(3);

    // Every split point, and every pair of split points.
    for (let first: number = 0; first <= stream.length; first++) {
      expect(parseAll([stream.slice(0, first), stream.slice(first)])).toEqual(
        whole,
      );

      for (let second: number = first; second <= stream.length; second += 3) {
        expect(
          parseAll([
            stream.slice(0, first),
            stream.slice(first, second),
            stream.slice(second),
          ]),
        ).toEqual(whole);
      }
    }
  });

  test("reads a stream sent one character at a time", () => {
    const stream: string = "data: a\r\n\r\nevent: x\rdata: b\r\r";
    expect(parseAll(stream.split(""))).toEqual([
      { event: "message", data: "a" },
      { event: "x", data: "b" },
    ]);
  });

  test("an event larger than the limit stops the stream", () => {
    const parser: McpSseParser = new McpSseParser({ maxEventChars: 20 });

    expect(() => {
      parser.push("data: 0123456789\ndata: 0123456789\n\n");
    }).toThrow(McpSseEventTooLargeError);
  });

  test("a line that never ends past the limit stops the stream", () => {
    const parser: McpSseParser = new McpSseParser({ maxEventChars: 100 });

    parser.push("data: ");

    expect(() => {
      for (let index: number = 0; index < 50; index++) {
        parser.push("xxxxx");
      }
    }).toThrow(McpSseEventTooLargeError);
  });

  test("the limit counts the data of one event, not the whole stream", () => {
    const parser: McpSseParser = new McpSseParser({ maxEventChars: 50 });
    const events: Array<McpSseEvent> = [];

    for (let index: number = 0; index < 100; index++) {
      events.push(...parser.push(`data: event ${index}\n\n`));
    }

    expect(events).toHaveLength(100);
  });

  test("reads 400,000 characters of one unfinished line, ten at a time, in linear time", () => {
    const piece: string = "x".repeat(10);
    // Each attempt reads a stream of its own.
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const parser: McpSseParser = new McpSseParser({
          maxEventChars: 1_000_000,
        });

        parser.push("data: ");

        // A server trickling a long line: each piece must not re-read the rest.
        for (let index: number = 0; index < 40_000; index++) {
          parser.push(piece);
        }

        const events: Array<McpSseEvent> = parser.push("\n\n");

        expect(events).toHaveLength(1);
        expect(events[0]!.data).toHaveLength(400_000);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("reads 2,000,000 characters of one line in one chunk in linear time", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const parser: McpSseParser = new McpSseParser({
          maxEventChars: 4_000_000,
        });
        const events: Array<McpSseEvent> = parser.push(
          `data: ${"y".repeat(2_000_000)}\n\n`,
        );

        expect(events[0]!.data).toHaveLength(2_000_000);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("reads 400,000 characters of carriage returns and lines in linear time", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const parser: McpSseParser = new McpSseParser({
          maxEventChars: 1_000_000,
        });
        let count: number = 0;

        for (let index: number = 0; index < 100; index++) {
          count += parser.push("\r".repeat(2000)).length;
          count += parser.push("data:a\r\n".repeat(250)).length;
        }

        count += parser.push("\n\n").length;

        expect(count).toBeGreaterThan(0);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
