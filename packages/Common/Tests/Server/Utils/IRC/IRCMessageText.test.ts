import IRCMessageText, {
  IRC_LINE_MAX_BYTES,
  PreparedIRCText,
} from "../../../../Server/Utils/IRC/IRCMessageText";
import { describe, expect, test } from "@jest/globals";

/*
 * A workflow's message, made into lines IRC can carry: one IRC message per
 * line of text, each short enough for the server to pass on with its prefix
 * in front, no character that could end a line early, and no more lines than
 * a server takes without calling it a flood.
 */

const MAX_BYTES: number = 400;

function prepare(text: string, maxLines: number = 15): PreparedIRCText {
  return IRCMessageText.prepare({
    text: text,
    maxBytesPerLine: MAX_BYTES,
    maxLines: maxLines,
  });
}

function bytesOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

describe("IRCMessageText.prepare — lines", () => {
  test("each line of the message is a line of IRC", () => {
    expect(prepare("Incident declared\nSeverity: Critical")).toEqual({
      lines: ["Incident declared", "Severity: Critical"],
      isTruncated: false,
    });
  });

  test("CRLF, a lone CR and a lone LF all end a line", () => {
    expect(prepare("one\r\ntwo\rthree\nfour").lines).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  test("blank lines are left out: IRC has no empty message", () => {
    expect(prepare("\n\none\n   \n\t\ntwo\n\n").lines).toEqual(["one", "two"]);
  });

  test("a message with nothing to send has no lines", () => {
    expect(prepare("")).toEqual({ lines: [], isTruncated: false });
    expect(prepare("\r\n \t \u0001\u0000\r\n").lines).toEqual([]);
  });

  test("keeps spaces inside a line as typed", () => {
    expect(prepare("  indented   text  ").lines).toEqual(["  indented   text  "]);
  });

  test("never lets a CR, LF or NUL into a line", () => {
    const lines: Array<string> = prepare(
      "a\r\nPRIVMSG NickServ :DROP\0x\rb\n\nc",
    ).lines;

    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n\0]/);
    }
  });
});

describe("IRCMessageText.sanitizeLine — characters", () => {
  test("keeps IRC's formatting codes", () => {
    const formatted: string =
      "\u0002bold\u0002 \u000304,01red\u0003 \u001ditalic\u001d \u001funder\u001f \u0011mono\u0011 \u0016rev\u0016 \u001estrike\u001e \u0004ff0000hex\u000f";

    expect(IRCMessageText.sanitizeLine(formatted)).toBe(formatted);
  });

  test("takes out every other control character, CTCP's \\u0001 among them", () => {
    expect(
      IRCMessageText.sanitizeLine(
        "\u0001DCC SEND x\u0001 \u0000\u0007\u0008\u001b[31m\u007fend",
      ),
    ).toBe("DCC SEND x [31mend");
  });

  test("turns a tab into a space", () => {
    expect(IRCMessageText.sanitizeLine("name:\tvalue")).toBe("name: value");
  });

  test("leaves the rest of Unicode alone", () => {
    expect(IRCMessageText.sanitizeLine("Déjà vu — 部署完了 🚀")).toBe(
      "Déjà vu — 部署完了 🚀",
    );
  });
});

describe("IRCMessageText.prepare — long lines", () => {
  test("cuts a long line between words, each piece within the limit", () => {
    const words: string = Array.from({ length: 120 }, (_: unknown, index: number) => {
      return `word${index}`;
    }).join(" ");

    const lines: Array<string> = prepare(words).lines;

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(words);

    for (const line of lines) {
      expect(bytesOf(line)).toBeLessThanOrEqual(MAX_BYTES);
      expect(line.startsWith(" ")).toBe(false);
    }
  });

  test("cuts a line with no spaces at the limit", () => {
    const lines: Array<string> = prepare("x".repeat(1000)).lines;

    expect(lines.map(bytesOf)).toEqual([400, 400, 200]);
  });

  test("does not cut at a space that would leave a piece mostly empty", () => {
    const text: string = `ab ${"x".repeat(600)}`;

    const lines: Array<string> = prepare(text).lines;

    expect(lines[0]).toBe(text.substring(0, MAX_BYTES));
    expect(lines.join("")).toBe(text);
  });

  test.each([
    ["two-byte letters", "é"],
    ["three-byte characters", "部"],
    ["four-byte emoji", "🚀"],
  ])(
    "never cuts inside a character: %s",
    (_label: string, character: string) => {
      const text: string = character.repeat(700);
      const lines: Array<string> = prepare(text).lines;

      expect(lines.join("")).toBe(text);

      for (const line of lines) {
        expect(bytesOf(line)).toBeLessThanOrEqual(MAX_BYTES);
        // A character cut in two would not survive a round trip through UTF-8.
        expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
        expect(line).not.toContain("�");
      }
    },
  );

  test("counts bytes the way the socket will send them", () => {
    for (const text of ["plain", "é", "部署", "🚀", "a🚀b", "\ud800"]) {
      expect(IRCMessageText.getByteLength(text)).toBe(bytesOf(text));
    }
  });

  test("whatever the text, no line is over the limit or has a line break", () => {
    const alphabet: Array<string> = ["a", " ", "é", "部", "🚀", "\n", "\r", "\t", "\u0002"];
    let seed: number = 42;

    const random: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let round: number = 0; round < 200; round++) {
      let text: string = "";
      const length: number = Math.floor(random() * 3000);

      for (let index: number = 0; index < length; index++) {
        text += alphabet[Math.floor(random() * alphabet.length)] as string;
      }

      const prepared: PreparedIRCText = prepare(text);

      expect(prepared.lines.length).toBeLessThanOrEqual(15);

      for (const line of prepared.lines) {
        expect(bytesOf(line)).toBeLessThanOrEqual(MAX_BYTES);
        expect(line).not.toMatch(/[\r\n\0]/);
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("IRCMessageText.prepare — too many lines", () => {
  test("a message of exactly the limit is sent whole", () => {
    const text: string = Array.from({ length: 15 }, (_: unknown, index: number) => {
      return `line ${index + 1}`;
    }).join("\n");

    expect(prepare(text)).toEqual({
      lines: text.split("\n"),
      isTruncated: false,
    });
  });

  test("a longer one keeps the first lines and says it was cut", () => {
    const text: string = Array.from({ length: 40 }, (_: unknown, index: number) => {
      return `line ${index + 1}`;
    }).join("\n");

    const prepared: PreparedIRCText = prepare(text);

    expect(prepared.isTruncated).toBe(true);
    expect(prepared.lines).toHaveLength(15);
    expect(prepared.lines.slice(0, 14)).toEqual(text.split("\n").slice(0, 14));
    expect(prepared.lines[14]).toBe(
      "… (message cut short: it is longer than 15 IRC lines)",
    );
  });

  test("blank lines after the limit do not count as more message", () => {
    const text: string = `${"line\n".repeat(15)}\n\n   \n`;

    expect(prepare(text).isTruncated).toBe(false);
  });

  test("lines a long line was cut into count towards the limit", () => {
    const prepared: PreparedIRCText = prepare("x".repeat(400 * 20), 5);

    expect(prepared.isTruncated).toBe(true);
    expect(prepared.lines).toHaveLength(5);
    expect(prepared.lines[4]).toBe(IRCMessageText.getTruncationNotice(5));
  });

  test("the notice fits on a line of its own", () => {
    expect(bytesOf(IRCMessageText.getTruncationNotice(15))).toBeLessThan(100);
  });
});

describe("IRCMessageText.prepare — megabyte-long values", () => {
  /*
   * A synthetic monitor's screenshot reaches a message as base64 of several
   * megabytes on one line (AGENTS.md, "Megabyte-long values"). Only what the
   * capped lines can hold is ever read past the first scan for a line break.
   */
  test("a several-megabyte line is cut short quickly", () => {
    const screenshot: string = `Screenshot: data:image/png;base64,${"iVBORw0KGgo".repeat(400_000)}`;
    const startedAt: number = Date.now();

    const prepared: PreparedIRCText = prepare(screenshot);

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(prepared.isTruncated).toBe(true);
    expect(prepared.lines).toHaveLength(15);
  });

  test("a megabyte of line breaks is read once", () => {
    const text: string = `start${"\n".repeat(3_000_000)}end`;
    const startedAt: number = Date.now();

    expect(prepare(text).lines).toEqual(["start", "end"]);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("a megabyte of single characters on their own lines is not read in full", () => {
    const text: string = "x\n".repeat(1_500_000);
    const startedAt: number = Date.now();

    const prepared: PreparedIRCText = prepare(text);

    expect(prepared.isTruncated).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("IRCMessageText.getMaxTextBytes", () => {
  test("leaves room for the command, the target and the server's prefix", () => {
    const max: number = IRCMessageText.getMaxTextBytes({
      nickname: "OneUptime",
      target: "#ops",
    });

    /*
     * The longest line a server passes on: ":" + nick + "!" + a 10-byte user
     * + "@" + a 63-byte host + " PRIVMSG #ops :" + the text + CRLF.
     */
    const relayed: number =
      bytesOf(`:OneUptime!${"u".repeat(10)}@${"h".repeat(63)} PRIVMSG #ops :`) +
      max +
      2;

    expect(relayed).toBeLessThanOrEqual(IRC_LINE_MAX_BYTES);
    expect(max).toBeGreaterThan(300);
  });

  test("a longer nickname or channel leaves less room", () => {
    const short: number = IRCMessageText.getMaxTextBytes({
      nickname: "a",
      target: "#a",
    });
    const long: number = IRCMessageText.getMaxTextBytes({
      nickname: "a".repeat(33),
      target: `#${"部".repeat(21)}`,
    });

    expect(short - long).toBe(32 + 62);
  });

  test("refuses limits nothing could be sent within", () => {
    expect(() => {
      return IRCMessageText.prepare({ text: "x", maxBytesPerLine: 8, maxLines: 1 });
    }).toThrow();
    expect(() => {
      return IRCMessageText.prepare({ text: "x", maxBytesPerLine: 400, maxLines: 0 });
    }).toThrow();
  });
});
