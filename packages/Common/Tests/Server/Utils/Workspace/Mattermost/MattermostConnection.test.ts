import { describe, expect, test } from "@jest/globals";
import MattermostConnection, {
  MattermostConnectionData,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import BadDataException from "../../../../../Types/Exception/BadDataException";

/*
 * A project's Mattermost connection is kept whole in the server-only
 * authToken column: the server, the team, the bot and the bot's access
 * token (MattermostConnection). Every call OneUptime makes as the bot reads
 * it back, and places ids from it - and from Mattermost's requests - in the
 * paths of calls made with the bot's token. These tests pin what is taken,
 * what is refused, and that a refusal never echoes a token.
 */

const TEAM_ID: string = "a".repeat(26);
const BOT_USER_ID: string = "b".repeat(26);
const ACCESS_TOKEN: string = "abcdefghijklmnopqrstuvwxyz";

function connection(
  overrides: Partial<MattermostConnectionData> = {},
): MattermostConnectionData {
  return {
    serverUrl: "https://chat.example.com",
    accessToken: ACCESS_TOKEN,
    teamId: TEAM_ID,
    botUserId: BOT_USER_ID,
    ...overrides,
  };
}

describe("MattermostConnection.normalizeServerUrl", () => {
  test.each([
    ["chat.example.com", "https://chat.example.com"],
    ["https://chat.example.com", "https://chat.example.com"],
    ["https://chat.example.com/", "https://chat.example.com"],
    ["  https://chat.example.com//  ", "https://chat.example.com"],
    ["http://10.0.0.5:8065", "http://10.0.0.5:8065"],
    ["https://example.com/mattermost/", "https://example.com/mattermost"],
    ["HTTPS://Chat.Example.com", "https://chat.example.com"],
    ["https://chat.example.com/?q=1#top", "https://chat.example.com"],
  ])("%s is called as %s", (typed: string, expected: string) => {
    expect(MattermostConnection.normalizeServerUrl(typed)).toBe(expected);
  });

  test.each([
    ["", "Please enter the address"],
    ["   ", "Please enter the address"],
    ["ftp://chat.example.com", "must start with https:// or http://"],
    ["javascript://alert(1)", "must start with https:// or http://"],
    ["https://user:pass@chat.example.com", "without a user name or password"],
    ["https://", "not a valid web address"],
  ])("%j is refused", (typed: string, message: string) => {
    expect(() => {
      return MattermostConnection.normalizeServerUrl(typed);
    }).toThrow(message);
  });

  test("refuses anything that is not text", () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(() => {
        return MattermostConnection.normalizeServerUrl(value);
      }).toThrow(BadDataException);
    }
  });

  test("refuses an address longer than 2048 characters", () => {
    expect(() => {
      return MattermostConnection.normalizeServerUrl(
        `https://chat.example.com/${"a".repeat(2100)}`,
      );
    }).toThrow("too long");
  });
});

describe("MattermostConnection.normalizeAccessToken", () => {
  test("takes a token as Mattermost makes one, trimmed", () => {
    expect(
      MattermostConnection.normalizeAccessToken(`  ${ACCESS_TOKEN} `),
    ).toBe(ACCESS_TOKEN);
  });

  test("refuses an empty token", () => {
    expect(() => {
      return MattermostConnection.normalizeAccessToken("   ");
    }).toThrow("Please enter the access token");
  });

  test.each([
    "has spaces in it",
    "slash/token",
    "token?query",
    "a".repeat(300),
    "tøken",
  ])("refuses %j without echoing it", (token: string) => {
    let message: string = "";

    try {
      MattermostConnection.normalizeAccessToken(token);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("The Mattermost access token is not valid");
    expect(message).not.toContain(token);
  });
});

describe("MattermostConnection ids and names", () => {
  test("a Mattermost id is 26 lowercase letters and digits", () => {
    expect(
      MattermostConnection.isMattermostId("abc123def456ghi789jkl012mn"),
    ).toBe(true);

    for (const value of [
      "ABC123DEF456GHI789JKL012MN",
      "abc123",
      "a".repeat(27),
      "../../../api/v4/users/me/x",
      "abc123def456ghi789jkl012m/",
      "abc123def456ghi789jkl012m%",
      undefined,
      null,
      26,
    ]) {
      expect(MattermostConnection.isMattermostId(value)).toBe(false);
    }
  });

  test("assertMattermostId names what was wrong, and returns a good id", () => {
    expect(MattermostConnection.assertMattermostId(TEAM_ID, "team")).toBe(
      TEAM_ID,
    );

    expect(() => {
      return MattermostConnection.assertMattermostId("..", "channel");
    }).toThrow("The Mattermost channel id is not valid.");
  });

  test("a channel name is lowercase letters, digits, - and _, at most 64", () => {
    expect(MattermostConnection.isChannelName("inc-42_prod")).toBe(true);
    expect(MattermostConnection.isChannelName("a".repeat(64))).toBe(true);
    expect(MattermostConnection.isChannelName("a".repeat(65))).toBe(false);
    expect(MattermostConnection.isChannelName("Incidents")).toBe(false);
    expect(MattermostConnection.isChannelName("town square")).toBe(false);
    expect(MattermostConnection.isChannelName("../x")).toBe(false);
  });

  test("a username is lowercase letters, digits, . - and _", () => {
    expect(MattermostConnection.isUsername("alice.smith-2_x")).toBe(true);
    expect(MattermostConnection.isUsername("Alice")).toBe(false);
    expect(MattermostConnection.isUsername("alice/../x")).toBe(false);
    expect(MattermostConnection.isUsername("")).toBe(false);
  });
});

describe("MattermostConnection auth token", () => {
  test("round-trips a connection", () => {
    const authToken: string = MattermostConnection.toAuthToken(connection());

    expect(MattermostConnection.fromAuthToken(authToken)).toEqual(connection());
  });

  test("keeps the server as OneUptime calls it", () => {
    const authToken: string = MattermostConnection.toAuthToken(
      connection({ serverUrl: "chat.example.com/" }),
    );

    expect(MattermostConnection.fromAuthToken(authToken).serverUrl).toBe(
      "https://chat.example.com",
    );
  });

  test("refuses to keep a connection with an id Mattermost could not have made", () => {
    expect(() => {
      return MattermostConnection.toAuthToken(connection({ teamId: "team" }));
    }).toThrow("The Mattermost team id is not valid.");

    expect(() => {
      return MattermostConnection.toAuthToken(
        connection({ botUserId: "../me" }),
      );
    }).toThrow("The Mattermost bot user id is not valid.");
  });

  test.each([
    ["a Slack bot token", "xoxb-1234-5678"],
    ["JSON that is not an object", "[1,2]"],
    ["an empty object", "{}"],
    ["an empty string", ""],
    [
      "a connection with a team id that is a path",
      JSON.stringify({
        serverUrl: "https://chat.example.com",
        accessToken: ACCESS_TOKEN,
        teamId: "../../users",
        botUserId: BOT_USER_ID,
      }),
    ],
    [
      "a connection to a server that is not a web address",
      JSON.stringify({
        serverUrl: "file:///etc/passwd",
        accessToken: ACCESS_TOKEN,
        teamId: TEAM_ID,
        botUserId: BOT_USER_ID,
      }),
    ],
  ])(
    "reading %s is refused, saying how to fix it",
    (_what: string, authToken: string) => {
      expect(() => {
        return MattermostConnection.fromAuthToken(authToken);
      }).toThrow(
        "This project's Mattermost connection could not be read. Please disconnect Mattermost in Project Settings and connect it again.",
      );
    },
  );

  test("a refusal to read a connection never echoes its token", () => {
    const authToken: string = JSON.stringify({
      serverUrl: "https://chat.example.com",
      accessToken: "secret-token-with-space ",
      teamId: "bad",
      botUserId: BOT_USER_ID,
    });

    let message: string = "";

    try {
      MattermostConnection.fromAuthToken(authToken);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toContain("secret-token");
  });
});
