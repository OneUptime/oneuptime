import IRCMessageUtil, {
  IRCMessage,
} from "../../../../Server/Utils/IRC/IRCMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * The IRC wire format. Reading: everything a server may send, tags and all,
 * and nothing that is not IRC. Writing: every value stays in its place on
 * the line, whatever it holds.
 */

describe("IRCMessageUtil.parse — what a server sends", () => {
  test.each<[string, string, IRCMessage]>([
    [
      "a numeric reply",
      ":irc.example.com 001 OneUptime :Welcome to the network OneUptime",
      {
        source: "irc.example.com",
        command: "001",
        params: ["OneUptime", "Welcome to the network OneUptime"],
      },
    ],
    [
      "a message from a user",
      ":alice!~alice@example.com PRIVMSG #ops :deploy is done",
      {
        source: "alice!~alice@example.com",
        command: "PRIVMSG",
        params: ["#ops", "deploy is done"],
      },
    ],
    [
      "a command with no source",
      "PING :irc.example.com",
      { source: undefined, command: "PING", params: ["irc.example.com"] },
    ],
    [
      "a command with no parameters",
      "QUIT",
      { source: undefined, command: "QUIT", params: [] },
    ],
    [
      "message tags in front",
      "@time=2026-10-08T10:00:00.000Z;msgid=abc :alice!a@h JOIN #ops",
      { source: "alice!a@h", command: "JOIN", params: ["#ops"] },
    ],
    [
      "a trailing parameter with spaces and colons",
      ":s 474 nick #ops :Cannot join channel (+b) - see: https://example.com",
      {
        source: "s",
        command: "474",
        params: [
          "nick",
          "#ops",
          "Cannot join channel (+b) - see: https://example.com",
        ],
      },
    ],
    [
      "an empty trailing parameter",
      ":s CAP * LS :",
      { source: "s", command: "CAP", params: ["*", "LS", ""] },
    ],
    [
      "a trailing parameter that is only a colon",
      ":s PRIVMSG #ops ::",
      { source: "s", command: "PRIVMSG", params: ["#ops", ":"] },
    ],
    [
      "several spaces between the parts",
      ":s   PRIVMSG   #ops    :hi",
      { source: "s", command: "PRIVMSG", params: ["#ops", "hi"] },
    ],
    [
      "a last parameter without a colon",
      ":s JOIN #ops",
      { source: "s", command: "JOIN", params: ["#ops"] },
    ],
    [
      "a command in lower case",
      "ping :token",
      { source: undefined, command: "PING", params: ["token"] },
    ],
    [
      "a list of capabilities over several lines",
      ":s CAP * LS * :multi-prefix sasl=PLAIN",
      {
        source: "s",
        command: "CAP",
        params: ["*", "LS", "*", "multi-prefix sasl=PLAIN"],
      },
    ],
  ])("reads %s", (_label: string, line: string, expected: IRCMessage) => {
    expect(IRCMessageUtil.parse(line)).toEqual(expected);
  });

  test.each([
    ["a web server's status line", "HTTP/1.1 400 Bad Request"],
    ["an SSH banner", "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13"],
    ["a Redis error", "-ERR unknown command 'NICK'"],
    ["a JSON document", '{"error":"not found"}'],
    ["a four-digit number", "4040 nope"],
    ["a two-digit number", "40 nope"],
    ["a source and nothing else", ":irc.example.com"],
    ["tags and nothing else", "@time=now"],
    ["a source with no command", ":irc.example.com "],
    ["a dotless i that upper-cases to ASCII", "prıvmsg #ops :x"],
    ["only spaces", "   "],
  ])("refuses %s as not IRC", (_label: string, line: string) => {
    expect(IRCMessageUtil.parse(line)).toBeNull();
  });

  test("reads a long line in time linear in its length", () => {
    const line: string = `:s NOTICE * :${"x ".repeat(200_000)}`;
    const startedAt: number = Date.now();

    expect(IRCMessageUtil.parse(line)?.params[1]?.length).toBe(400_000);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("IRCMessageUtil.build — what the client sends", () => {
  test("puts middle parameters and a trailing one in their places", () => {
    expect(
      IRCMessageUtil.build({
        command: "PRIVMSG",
        middle: ["#ops"],
        trailing: "Deploy finished: all green",
      }),
    ).toBe("PRIVMSG #ops :Deploy finished: all green");
    expect(
      IRCMessageUtil.build({ command: "CAP", middle: ["LS", "302"] }),
    ).toBe("CAP LS 302");
    expect(IRCMessageUtil.build({ command: "QUIT" })).toBe("QUIT");
  });

  test("an empty or colon-led trailing parameter is still one parameter", () => {
    expect(IRCMessageUtil.build({ command: "PONG", trailing: "" })).toBe(
      "PONG :",
    );
    expect(
      IRCMessageUtil.build({
        command: "PRIVMSG",
        middle: ["#ops"],
        trailing: ":) all good",
      }),
    ).toBe("PRIVMSG #ops ::) all good");
  });

  test.each([
    ["a carriage return", "fine\rQUIT"],
    ["a line feed", "fine\nQUIT"],
    ["CRLF", "fine\r\nPRIVMSG NickServ :DROP"],
    ["a NUL", "fine\0more"],
  ])(
    "refuses %s in the trailing parameter",
    (_label: string, trailing: string) => {
      expect(() => {
        return IRCMessageUtil.build({
          command: "PRIVMSG",
          middle: ["#ops"],
          trailing: trailing,
        });
      }).toThrow(
        "The last parameter of PRIVMSG would break the IRC line it is in.",
      );
    },
  );

  test.each([
    ["a space", "#ops PART"],
    ["a leading colon", ":#ops"],
    ["nothing", ""],
    ["a line feed", "#ops\nQUIT"],
    ["a carriage return", "#ops\rQUIT"],
    ["a NUL", "#ops\0"],
  ])("refuses %s in a middle parameter", (_label: string, param: string) => {
    expect(() => {
      return IRCMessageUtil.build({ command: "JOIN", middle: [param] });
    }).toThrow("A parameter of JOIN would break the IRC line it is in.");
  });

  test("refuses a command that is not one", () => {
    expect(() => {
      return IRCMessageUtil.build({ command: "PRIVMSG #ops" });
    }).toThrow('"PRIVMSG #ops" is not an IRC command.');
    expect(() => {
      return IRCMessageUtil.build({ command: "" });
    }).toThrow();
  });

  test("what it builds reads back as what was meant", () => {
    const line: string = IRCMessageUtil.build({
      command: "PRIVMSG",
      middle: ["#ops"],
      trailing: "  spaced  :  out  ",
    });

    expect(IRCMessageUtil.parse(line)).toEqual({
      source: undefined,
      command: "PRIVMSG",
      params: ["#ops", "  spaced  :  out  "],
    });
  });
});

describe("IRCMessageUtil — names", () => {
  test.each([
    ["alice!~alice@example.com", "alice"],
    ["alice@example.com", "alice"],
    ["irc.example.com", "irc.example.com"],
    [undefined, ""],
  ])("the nickname of %s is %j", (source: string | undefined, nick: string) => {
    expect(IRCMessageUtil.getNickname(source)).toBe(nick);
  });

  test("compares names as IRC does, folding []\\~ into {}|^", () => {
    expect(IRCMessageUtil.isSameName("OneUptime", "oneuptime")).toBe(true);
    expect(IRCMessageUtil.isSameName("Bot[1]", "bot{1}")).toBe(true);
    expect(IRCMessageUtil.isSameName("a\\b~", "A|B^")).toBe(true);
    expect(IRCMessageUtil.isSameName("#Ops", "#ops")).toBe(true);
    expect(IRCMessageUtil.isSameName("OneUptime", "OneUptime_")).toBe(false);
  });

  test("a middle parameter is safe when it is one word", () => {
    expect(IRCMessageUtil.isSafeMiddleParam("s3cret")).toBe(true);
    expect(IRCMessageUtil.isSafeMiddleParam("pass:word")).toBe(true);
    expect(IRCMessageUtil.isSafeMiddleParam("pass word")).toBe(false);
    expect(IRCMessageUtil.isSafeMiddleParam(":password")).toBe(false);
    expect(IRCMessageUtil.isSafeMiddleParam("")).toBe(false);
  });
});
