import SyslogStreamFramer, {
  MAX_SYSLOG_FRAME_LENGTH,
} from "../../../Utils/Syslog/SyslogStreamFramer";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * Syslog over TCP is a stream of bytes; the framer says where one message
 * ends and the next begins. RFC 6587 describes the two ways senders do it,
 * and its own examples are the first cases below.
 *
 * What makes a framer wrong is rarely the format: it is the network
 * handing over a message in pieces it did not choose - half a length, a
 * line split in the middle of a character, three messages and the start of
 * a fourth in one read. Every case is therefore also run cut into pieces at
 * every position, and the answer may not depend on where the cuts fall.
 */

function framed(...chunks: Array<string | Buffer>): Array<string> {
  const framer: SyslogStreamFramer = new SyslogStreamFramer();
  const messages: Array<string> = [];

  for (const chunk of chunks) {
    messages.push(
      ...framer.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
    );
  }

  messages.push(...framer.end());

  return messages;
}

// The same stream, handed over as two pieces cut at every possible byte.
function framedAtEveryCut(stream: string | Buffer): Array<Array<string>> {
  const bytes: Buffer =
    typeof stream === "string" ? Buffer.from(stream) : stream;
  const results: Array<Array<string>> = [];

  for (let cut: number = 0; cut <= bytes.length; cut++) {
    results.push(framed(bytes.subarray(0, cut), bytes.subarray(cut)));
  }

  return results;
}

// ...and one byte at a time.
function framedByteByByte(stream: string | Buffer): Array<string> {
  const bytes: Buffer =
    typeof stream === "string" ? Buffer.from(stream) : stream;
  const pieces: Array<Buffer> = [];

  for (let index: number = 0; index < bytes.length; index++) {
    pieces.push(bytes.subarray(index, index + 1));
  }

  return framed(...pieces);
}

function expectHoweverItArrives(
  stream: string | Buffer,
  expected: Array<string>,
): void {
  expect(framed(stream)).toEqual(expected);
  expect(framedByteByByte(stream)).toEqual(expected);

  for (const result of framedAtEveryCut(stream)) {
    expect(result).toEqual(expected);
  }
}

function counted(message: string): string {
  return `${Buffer.byteLength(message)} ${message}`;
}

const LINK_DOWN: string =
  "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";
const LINK_UP: string =
  "<189>Oct 13 10:11:10 core-sw1 46: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up";
const RFC5424: string =
  '<165>1 2026-10-13T10:11:09.003Z host app 4711 ID47 [meta sequenceId="9"] An application event';

describe("messages that end with a line feed (non-transparent framing)", () => {
  test("one line is one message", () => {
    expectHoweverItArrives(`${LINK_DOWN}\n`, [LINK_DOWN]);
  });

  test("several lines are several messages, in order", () => {
    expectHoweverItArrives(`${LINK_DOWN}\n${LINK_UP}\n${RFC5424}\n`, [
      LINK_DOWN,
      LINK_UP,
      RFC5424,
    ]);
  });

  test("CR LF ends a message too: the carriage return stays on it for the reader to trim", () => {
    expectHoweverItArrives(`${LINK_DOWN}\r\n${LINK_UP}\r\n`, [
      `${LINK_DOWN}\r`,
      `${LINK_UP}\r`,
    ]);
  });

  test("a NUL ends a message, as some senders use instead", () => {
    expectHoweverItArrives(`${LINK_DOWN}\0${LINK_UP}\0`, [LINK_DOWN, LINK_UP]);
  });

  test("blank lines between messages are nothing", () => {
    expectHoweverItArrives(`\n\n${LINK_DOWN}\n\r\n\n${LINK_UP}\n\n`, [
      LINK_DOWN,
      LINK_UP,
    ]);
  });

  test("a last line the sender did not end before closing is still a message", () => {
    expectHoweverItArrives(`${LINK_DOWN}\n${LINK_UP}`, [LINK_DOWN, LINK_UP]);
  });

  test("a line with no priority is a message: RouterOS sends CEF over TCP that way", () => {
    const cef: string =
      "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik msg=login failure for user guest";

    expectHoweverItArrives(`${cef}\n${cef}\n`, [cef, cef]);
  });

  test("a line that starts with digits is text unless it is a length, a space and a priority", () => {
    for (const line of [
      "2026 Oct 13 10:11:12 nexus1 %ETHPORT-5-IF_DOWN_LINK_FAILURE: Interface Ethernet1/1 is down",
      "12 angry men",
      "123",
      "99999999 <34>too many digits to be a length",
      "0 <34>a length never starts with zero",
      "12<34>no space",
      "12  <34>two spaces",
    ]) {
      expectHoweverItArrives(`${line}\n`, [line]);
    }
  });

  test("text in any language arrives whole, wherever the network cuts it", () => {
    const line: string =
      "<134>Oct 13 10:11:09 sw1 app: température élevée - 温度が高い - 🔥";

    expectHoweverItArrives(`${line}\n${line}\n`, [line, line]);
  });
});

describe("messages that say how long they are (octet counting)", () => {
  test("RFC 6587's shape: the length in bytes, a space, the message", () => {
    expectHoweverItArrives(counted(RFC5424), [RFC5424]);
  });

  test("several messages, with nothing between them", () => {
    expectHoweverItArrives(
      counted(RFC5424) + counted(LINK_DOWN) + counted(LINK_UP),
      [RFC5424, LINK_DOWN, LINK_UP],
    );
  });

  test("a message may hold line feeds: the length says where it ends, not the line", () => {
    const multiLine: string =
      "<11>1 2026-10-13T10:11:09Z host app - - - Traceback:\n  line 1\n  line 2";

    expectHoweverItArrives(counted(multiLine) + counted(LINK_DOWN), [
      multiLine,
      LINK_DOWN,
    ]);
  });

  test("the length counts bytes, not characters", () => {
    const message: string = "<134>1 - host app - - - température 温度 🔥";

    expect(Buffer.byteLength(message)).toBeGreaterThan(message.length);
    expectHoweverItArrives(counted(message) + counted(message), [
      message,
      message,
    ]);
  });

  test("a line feed after a counted message, which some senders add, is nothing", () => {
    expectHoweverItArrives(`${counted(RFC5424)}\n${counted(LINK_DOWN)}\n`, [
      RFC5424,
      LINK_DOWN,
    ]);
  });

  test("a counted message cut short when the connection closes is not a message", () => {
    const stream: string = counted(RFC5424) + counted(LINK_DOWN);

    for (
      let cut: number = counted(RFC5424).length + 1;
      cut < stream.length;
      cut++
    ) {
      expect(framed(stream.slice(0, cut))).toEqual([RFC5424]);
    }
  });

  test("the longest message there can be is taken", () => {
    const message: string = `<13>${"x".repeat(MAX_SYSLOG_FRAME_LENGTH - 4)}`;

    expect(Buffer.byteLength(message)).toBe(MAX_SYSLOG_FRAME_LENGTH);
    expect(framed(counted(message) + counted(LINK_DOWN))).toEqual([
      message,
      LINK_DOWN,
    ]);
  });
});

describe("a sender that mixes the two", () => {
  test("each message is read by how it starts", () => {
    expectHoweverItArrives(
      `${LINK_DOWN}\n${counted(RFC5424)}${LINK_UP}\n${counted(LINK_DOWN)}`,
      [LINK_DOWN, RFC5424, LINK_UP, LINK_DOWN],
    );
  });
});

describe("a stream that is not syslog", () => {
  test("a length longer than a message can be breaks the stream at once, before any of it is held", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    expect(
      framer.push(Buffer.from(`${MAX_SYSLOG_FRAME_LENGTH + 1} <34>`)),
    ).toEqual([]);
    expect(framer.isBroken).toBe(true);
    expect(framer.pendingLength).toBe(0);
  });

  test("messages before the bad length are still delivered", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    expect(
      framer.push(Buffer.from(`${LINK_DOWN}\n${counted(RFC5424)}99999 <34>x`)),
    ).toEqual([LINK_DOWN, RFC5424]);
    expect(framer.isBroken).toBe(true);
  });

  test("more than a message's worth of bytes with no end of line breaks the stream", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();
    const piece: Buffer = Buffer.alloc(8192, "x");
    let pushed: number = 0;

    while (!framer.isBroken) {
      expect(framer.push(piece)).toEqual([]);
      pushed += piece.length;

      // Never holds more than one message's worth, plus the piece that tipped it.
      expect(framer.pendingLength).toBeLessThanOrEqual(
        MAX_SYSLOG_FRAME_LENGTH + piece.length,
      );
      expect(pushed).toBeLessThanOrEqual(
        MAX_SYSLOG_FRAME_LENGTH + piece.length,
      );
    }

    expect(framer.pendingLength).toBe(0);
  });

  test("a line exactly as long as a message can be is still one", () => {
    const line: string = "y".repeat(MAX_SYSLOG_FRAME_LENGTH);

    expect(framed(`${line}\n${LINK_DOWN}\n`)).toEqual([line, LINK_DOWN]);
  });

  test("once broken, nothing more is read, and closing yields nothing", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    framer.push(Buffer.from("99999 <34>"));

    expect(framer.isBroken).toBe(true);
    expect(framer.push(Buffer.from(`${LINK_DOWN}\n`))).toEqual([]);
    expect(framer.end()).toEqual([]);
    expect(framer.pendingLength).toBe(0);
  });
});

describe("what the framer holds on to", () => {
  test("nothing, once every message so far is complete", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    framer.push(Buffer.from(`${LINK_DOWN}\n${counted(RFC5424)}`));

    expect(framer.pendingLength).toBe(0);
  });

  test("only the unfinished message, not the pieces that came before it", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    expect(
      framer.push(Buffer.from(`${LINK_DOWN}\n${LINK_UP}\n<13>the start of`)),
    ).toEqual([LINK_DOWN, LINK_UP]);
    expect(framer.pendingLength).toBe("<13>the start of".length);

    expect(framer.push(Buffer.from(" a third\n"))).toEqual([
      "<13>the start of a third",
    ]);
    expect(framer.pendingLength).toBe(0);
  });

  test("an empty piece changes nothing", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    expect(framer.push(Buffer.alloc(0))).toEqual([]);
    expect(framer.push(Buffer.from("<13>half"))).toEqual([]);
    expect(framer.push(Buffer.alloc(0))).toEqual([]);
    expect(framer.push(Buffer.from(" a line\n"))).toEqual(["<13>half a line"]);
  });

  test("closing twice yields the last line once", () => {
    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    framer.push(Buffer.from("<13>no line feed"));

    expect(framer.end()).toEqual(["<13>no line feed"]);
    expect(framer.end()).toEqual([]);
  });

  test("a long line arriving a few bytes at a time is not searched again from its start each time", () => {
    const piece: Buffer = Buffer.from("abcdefgh");
    const pieces: number =
      Math.floor(MAX_SYSLOG_FRAME_LENGTH / piece.length) - 1;
    // Each attempt frames a stream of its own.
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const framer: SyslogStreamFramer = new SyslogStreamFramer();

        for (let index: number = 0; index < pieces; index++) {
          framer.push(piece);
        }

        const messages: Array<string> = framer.push(Buffer.from("\n"));

        expect(messages).toHaveLength(1);
        expect(messages[0]).toHaveLength(pieces * piece.length);
      },
      limitInMs: 5000,
    });
    // Generous: quadratic searching would take far longer than this.
    expect(timed.inMs).toBeLessThan(5000);
  });
});
