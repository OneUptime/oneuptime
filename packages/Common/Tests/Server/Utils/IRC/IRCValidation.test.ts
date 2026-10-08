import IRCValidation, {
  IRC_CHANNEL_MAX_BYTES,
  IRC_NICKNAME_MAX_LENGTH,
  IRC_PASSWORD_MAX_BYTES,
} from "../../../../Server/Utils/IRC/IRCValidation";
import { describe, expect, test } from "@jest/globals";

/*
 * What the IRC step will put on a line as a nickname, a channel, a key or a
 * password. A value refused here is refused with what to change; a value
 * let through can never end its line early or start another.
 */

describe("IRCValidation.getNicknameProblem", () => {
  test.each([
    "OneUptime",
    "oneuptime-bot",
    "Bot_42",
    "[ops]",
    "\\backslash",
    "`tick",
    "{brace}|pipe^",
    "a".repeat(IRC_NICKNAME_MAX_LENGTH),
  ])("takes %j", (nickname: string) => {
    expect(IRCValidation.getNicknameProblem(nickname)).toBeNull();
  });

  test.each([
    ["a leading digit", "42bot"],
    ["a leading dash", "-bot"],
    ["a space", "One Uptime"],
    ["a colon", "bot:1"],
    ["an at sign", "bot@host"],
    ["an exclamation mark", "bot!"],
    ["a comma", "a,b"],
    ["a channel prefix", "#ops"],
    ["a letter outside ASCII", "Zoë"],
    ["a line break", "bot\r\nQUIT"],
    ["a NUL", "bot\0"],
  ])("refuses %s", (_label: string, nickname: string) => {
    expect(IRCValidation.getNicknameProblem(nickname)).toMatch(
      /is not a valid IRC nickname\. A nickname starts with a letter/,
    );
  });

  test("refuses one that is too long, or empty", () => {
    expect(
      IRCValidation.getNicknameProblem("a".repeat(IRC_NICKNAME_MAX_LENGTH + 1)),
    ).toBe(
      `Nickname "${"a".repeat(IRC_NICKNAME_MAX_LENGTH + 1)}" is longer than ${IRC_NICKNAME_MAX_LENGTH} characters.`,
    );
    expect(IRCValidation.getNicknameProblem("")).toBe("Nickname is empty.");
  });
});

describe("IRCValidation.getChannelProblem", () => {
  test.each([
    "#ops",
    "##libera-overflow",
    "&local",
    "+modeless",
    "!12345safe",
    "#部署",
    "#with:colon",
    "#with.dots-and_underscores",
  ])("takes %j", (channel: string) => {
    expect(IRCValidation.getChannelProblem(channel)).toBeNull();
  });

  test.each([
    ["a space", "#ops PART"],
    ["a comma", "#ops,#other"],
    ["a BELL", "#ops\u0007"],
    ["a line break", "#ops\r\nQUIT"],
    ["a NUL", "#ops\0"],
    ["a tab", "#ops\tx"],
    ["a DEL", "#ops\u007f"],
  ])("refuses %s", (_label: string, channel: string) => {
    expect(IRCValidation.getChannelProblem(channel)).toMatch(
      /is not a valid IRC channel name\. A channel name cannot hold spaces, commas or control characters\.$/,
    );
  });

  test("refuses a prefix with no name, or no prefix at all", () => {
    expect(IRCValidation.getChannelProblem("#")).toBe(
      'Channel "#" has no name after its # prefix.',
    );
    expect(IRCValidation.getChannelProblem("ops")).toBe(
      '"ops" is not a channel. A channel starts with #.',
    );
  });

  test("measures the length in bytes, as the server does", () => {
    const longest: string = `#${"a".repeat(IRC_CHANNEL_MAX_BYTES - 1)}`;

    expect(IRCValidation.getChannelProblem(longest)).toBeNull();
    expect(IRCValidation.getChannelProblem(`${longest}a`)).toMatch(
      /is longer than 64 bytes\.$/,
    );
    // 1 + 22 x 3 bytes is 67: too long, at 23 characters.
    expect(IRCValidation.getChannelProblem(`#${"部".repeat(22)}`)).toMatch(
      /is longer than 64 bytes\.$/,
    );
  });
});

describe("IRCValidation.getTargetProblem", () => {
  test("a channel or a nickname", () => {
    expect(IRCValidation.getTargetProblem("#ops")).toBeNull();
    expect(IRCValidation.getTargetProblem("alice")).toBeNull();
  });

  test("anything else says what it should be", () => {
    expect(IRCValidation.getTargetProblem("")).toBe("Channel is empty.");
    expect(IRCValidation.getTargetProblem("ops team")).toBe(
      'Channel "ops team" is neither a channel, which starts with #, nor a nickname.',
    );
    expect(IRCValidation.getTargetProblem("#ops team")).toMatch(
      /is not a valid IRC channel name/,
    );
  });

  test("tells channels from nicknames by their prefix", () => {
    for (const channel of ["#a", "&a", "+a", "!a"]) {
      expect(IRCValidation.isChannel(channel)).toBe(true);
    }

    expect(IRCValidation.isChannel("alice")).toBe(false);
    expect(IRCValidation.isChannel("[ops]")).toBe(false);
  });
});

describe("IRCValidation.getChannelKeyProblem", () => {
  test("takes a key, and never quotes one it refuses", () => {
    expect(IRCValidation.getChannelKeyProblem("hunter2")).toBeNull();
    expect(IRCValidation.getChannelKeyProblem("p@ss:w0rd!")).toBeNull();

    for (const key of ["hun ter2", "a,b", "key\r\nQUIT", "key\0", ":key"]) {
      const problem: string | null = IRCValidation.getChannelKeyProblem(key);

      expect(problem).toMatch(/^Channel Key cannot /);
      expect(problem).not.toContain(key);
    }

    expect(IRCValidation.getChannelKeyProblem("k".repeat(65))).toBe(
      "Channel Key is longer than 64 characters.",
    );
  });
});

describe("IRCValidation.getCredentialProblem", () => {
  test("takes spaces and symbols, which a password may have", () => {
    expect(
      IRCValidation.getCredentialProblem(
        "correct horse: battery!",
        "SASL Password",
      ),
    ).toBeNull();
  });

  test.each([
    ["a line feed", "pass\nQUIT"],
    ["a carriage return", "pass\rword"],
    ["a NUL, which would move the SASL fields", "user\0admin"],
  ])("refuses %s, without quoting it", (_label: string, value: string) => {
    const problem: string | null = IRCValidation.getCredentialProblem(
      value,
      "Server Password",
    );

    expect(problem).toBe(
      "Server Password cannot hold a line break or a NUL character.",
    );
  });

  test("refuses one too long to fit on a line", () => {
    expect(
      IRCValidation.getCredentialProblem(
        "é".repeat(IRC_PASSWORD_MAX_BYTES / 2 + 1),
        "SASL Password",
      ),
    ).toBe(`SASL Password is longer than ${IRC_PASSWORD_MAX_BYTES} bytes.`);
  });
});

describe("IRCValidation.quote", () => {
  test("quotes a value, cut to a readable length and with control characters shown as ?", () => {
    expect(IRCValidation.quote("#ops")).toBe('"#ops"');
    expect(IRCValidation.quote("a\r\nb\u0007")).toBe('"a??b?"');
    expect(IRCValidation.quote("x".repeat(100))).toBe(`"${"x".repeat(64)}…"`);
  });
});
