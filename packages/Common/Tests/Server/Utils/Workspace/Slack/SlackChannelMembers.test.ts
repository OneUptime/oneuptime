import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";
import logger from "../../../../../Server/Utils/Logger";
import SlackChannelMembers, {
  SlackChannelFacts,
  SlackChannelMembersError,
  SlackPersonFacts,
} from "../../../../../Server/Utils/Workspace/Slack/SlackChannelMembers";

/*
 * THE SLACK WEB API CALLS BEHIND A RECORD'S CHANNEL CARD: what each one
 * sends - method, body, the bot's token - and how each answer is read,
 * Slack's refusals included, so the card can say what happened.
 */

interface SentRequest {
  url: string;
  data: JSONObject;
  headers: JSONObject;
  options: unknown;
}

let sent: Array<SentRequest> = [];
let answers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error> = [];

const ok: (body: JSONObject) => HTTPResponse<JSONObject> = (
  body: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, { ok: true, ...body }, {});
};

const refused: (error: string) => HTTPResponse<JSONObject> = (
  error: string,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, { ok: false, error: error }, {});
};

beforeEach(() => {
  sent = [];
  answers = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: JSONObject;
    headers: JSONObject;
    options?: unknown;
  }) => {
    sent.push({
      url: data.url.toString(),
      data: { ...data.data },
      headers: data.headers,
      options: data.options,
    });

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
      answers.shift() || ok({});

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const errorCodeOf: (promise: Promise<unknown>) => Promise<string | null> =
  async (promise: Promise<unknown>): Promise<string | null> => {
    try {
      await promise;
    } catch (err) {
      return SlackChannelMembersError.getCode(err);
    }

    return null;
  };

describe("every call", () => {
  test("is a form POST to slack.com/api/<method> with the bot's token, tried once", async () => {
    answers.push(ok({ channel: { id: "C1", name: "inc-1" } }));

    await SlackChannelMembers.getChannel({
      authToken: "xoxb-project",
      channelId: "C1",
    });

    expect(sent).toEqual([
      {
        url: "https://slack.com/api/conversations.info",
        data: { channel: "C1" },
        headers: {
          Authorization: "Bearer xoxb-project",
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: undefined,
      },
    ]);
  });

  test("a refusal is thrown with Slack's own code", async () => {
    answers.push(refused("channel_not_found"));

    const code: string | null = await errorCodeOf(
      SlackChannelMembers.getChannel({ authToken: "t", channelId: "C1" }),
    );

    expect(code).toBe("channel_not_found");
  });

  test("an HTTP error carries Slack's code when its body has one, and the status when not", async () => {
    answers.push(
      new HTTPErrorResponse(429, { ok: false, error: "ratelimited" }, {}),
    );

    expect(
      await errorCodeOf(
        SlackChannelMembers.getChannel({ authToken: "t", channelId: "C1" }),
      ),
    ).toBe("ratelimited");

    answers.push(new HTTPErrorResponse(503, {}, {}));

    expect(
      await errorCodeOf(
        SlackChannelMembers.getChannel({ authToken: "t", channelId: "C1" }),
      ),
    ).toBe("http_503");
  });

  test("no answer at all (the network) is no_answer", async () => {
    answers.push(new Error("socket hang up"));

    expect(
      await errorCodeOf(
        SlackChannelMembers.getChannel({ authToken: "t", channelId: "C1" }),
      ),
    ).toBe("no_answer");
  });
});

describe("what each refusal means", () => {
  test.each([
    ["channel_not_found", "gone"],
    ["invalid_auth", "not connected"],
    ["token_revoked", "not connected"],
    ["account_inactive", "not connected"],
    ["missing_scope", "not connected"],
    ["ratelimited", "unavailable"],
    ["http_429", "unavailable"],
    ["http_502", "unavailable"],
    ["fatal_error", "unavailable"],
    ["no_answer", "unavailable"],
    ["cant_invite", "none of these"],
  ] as Array<[string, string]>)("%s is %s", (code: string, meaning: string) => {
    const error: SlackChannelMembersError = new SlackChannelMembersError(code);

    expect({
      gone: SlackChannelMembersError.isChannelGone(error),
      notConnected: SlackChannelMembersError.isNotConnected(error),
      unavailable: SlackChannelMembersError.isUnavailable(error),
    }).toEqual({
      gone: meaning === "gone",
      notConnected: meaning === "not connected",
      unavailable: meaning === "unavailable",
    });
  });

  test("an error from another realm is read by its fields", () => {
    expect(
      SlackChannelMembersError.getCode({
        name: "SlackChannelMembersError",
        code: "is_archived",
      }),
    ).toBe("is_archived");
    expect(SlackChannelMembersError.getCode(new Error("x"))).toBeNull();
    expect(SlackChannelMembersError.getCode(null)).toBeNull();
  });
});

describe("conversations.info", () => {
  test("reads whether the channel is private, archived, and has the app in it", async () => {
    answers.push(
      ok({
        channel: {
          id: "C1",
          name: "inc-1",
          is_private: true,
          is_archived: true,
          is_member: true,
        },
      }),
    );

    const facts: SlackChannelFacts = await SlackChannelMembers.getChannel({
      authToken: "t",
      channelId: "C1",
    });

    expect(facts).toEqual({
      id: "C1",
      name: "inc-1",
      isPrivate: true,
      isArchived: true,
      isAppMember: true,
    });
  });

  test("an older private channel (a group) is private; Slack not saying whether the app is in it is null", async () => {
    answers.push(ok({ channel: { id: "G1", name: "old", is_group: true } }));

    const facts: SlackChannelFacts = await SlackChannelMembers.getChannel({
      authToken: "t",
      channelId: "G1",
    });

    expect(facts.isPrivate).toBe(true);
    expect(facts.isArchived).toBe(false);
    expect(facts.isAppMember).toBeNull();
  });
});

describe("conversations.members", () => {
  test("reads page after page with Slack's cursor, 200 at a time, each member once", async () => {
    answers.push(
      ok({
        members: ["U1", "U2"],
        response_metadata: { next_cursor: "page2" },
      }),
    );
    answers.push(
      ok({ members: ["U2", "U3"], response_metadata: { next_cursor: "" } }),
    );

    const read: { memberIds: Array<string>; isComplete: boolean } =
      await SlackChannelMembers.getMemberIds({
        authToken: "t",
        channelId: "C1",
        max: 1000,
      });

    expect(read).toEqual({ memberIds: ["U1", "U2", "U3"], isComplete: true });
    expect(
      sent.map((request: SentRequest) => {
        return request.data;
      }),
    ).toEqual([
      { channel: "C1", limit: 200 },
      { channel: "C1", limit: 200, cursor: "page2" },
    ]);
  });

  test("stops at the most it was asked for, and says the list is not all of them", async () => {
    answers.push(
      ok({
        members: ["U1", "U2", "U3"],
        response_metadata: { next_cursor: "more" },
      }),
    );

    const read: { memberIds: Array<string>; isComplete: boolean } =
      await SlackChannelMembers.getMemberIds({
        authToken: "t",
        channelId: "C1",
        max: 2,
      });

    expect(read).toEqual({ memberIds: ["U1", "U2"], isComplete: false });
    expect(sent.length).toBe(1);
  });

  test("ignores what is not a member id", async () => {
    answers.push(ok({ members: ["U1", 7, null, "", "U2"] }));

    expect(
      (
        await SlackChannelMembers.getMemberIds({
          authToken: "t",
          channelId: "C1",
          max: 10,
        })
      ).memberIds,
    ).toEqual(["U1", "U2"]);
  });
});

describe("users.info and users.lookupByEmail", () => {
  test("a person: their display name first, then their real names, then their handle", async () => {
    answers.push(
      ok({
        user: {
          id: "U1",
          name: "alice",
          real_name: "Alice Real",
          profile: {
            display_name: " Ali ",
            real_name: "Alice Smith",
            email: " alice@acme.test ",
          },
        },
      }),
    );

    const person: SlackPersonFacts | null = await SlackChannelMembers.getPerson(
      { authToken: "t", slackUserId: "U1" },
    );

    expect(person).toEqual({
      id: "U1",
      name: "Ali",
      email: "alice@acme.test",
      isBot: false,
      isDeactivated: false,
      isGuest: false,
    });
    expect(sent[0]!.url).toBe("https://slack.com/api/users.info");
    expect(sent[0]!.data).toEqual({ user: "U1" });
  });

  test("bots, apps, Slackbot, guests and deactivated accounts say so", async () => {
    answers.push(ok({ user: { id: "U1", name: "bot", is_bot: true } }));
    answers.push(ok({ user: { id: "U2", name: "app", is_app_user: true } }));
    answers.push(ok({ user: { id: "USLACKBOT", name: "slackbot" } }));
    answers.push(
      ok({ user: { id: "U3", name: "guest", is_ultra_restricted: true } }),
    );
    answers.push(ok({ user: { id: "U4", name: "gone", deleted: true } }));

    const people: Array<SlackPersonFacts | null> = [];

    for (const slackUserId of ["U1", "U2", "USLACKBOT", "U3", "U4"]) {
      people.push(
        await SlackChannelMembers.getPerson({
          authToken: "t",
          slackUserId: slackUserId,
        }),
      );
    }

    expect(
      people.map((person: SlackPersonFacts | null) => {
        return [person?.isBot, person?.isGuest, person?.isDeactivated];
      }),
    ).toEqual([
      [true, false, false],
      [true, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
  });

  test("nobody by that id, or by that email, is null; other refusals are thrown", async () => {
    answers.push(refused("user_not_found"));

    expect(
      await SlackChannelMembers.getPerson({
        authToken: "t",
        slackUserId: "U9",
      }),
    ).toBeNull();

    answers.push(refused("users_not_found"));

    expect(
      await SlackChannelMembers.findPersonByEmail({
        authToken: "t",
        email: "nobody@acme.test",
      }),
    ).toBeNull();
    expect(sent[1]!.url).toBe("https://slack.com/api/users.lookupByEmail");
    expect(sent[1]!.data).toEqual({ email: "nobody@acme.test" });

    answers.push(refused("ratelimited"));

    expect(
      await errorCodeOf(
        SlackChannelMembers.getPerson({ authToken: "t", slackUserId: "U9" }),
      ),
    ).toBe("ratelimited");
  });

  test("an app installed before it could read email addresses finds nobody by email, and does not fail", async () => {
    answers.push(refused("missing_scope"));

    expect(
      await SlackChannelMembers.findPersonByEmail({
        authToken: "t",
        email: "alice@acme.test",
      }),
    ).toBeNull();
  });
});

describe("conversations.invite and conversations.join", () => {
  test("invites one person a request", async () => {
    await SlackChannelMembers.invite({
      authToken: "xoxb-project",
      channelId: "C1",
      slackUserId: "U1",
    });

    expect(sent[0]!.url).toBe("https://slack.com/api/conversations.invite");
    expect(sent[0]!.data).toEqual({ channel: "C1", users: "U1" });
  });

  test("throws Slack's refusal of an invitation with its code", async () => {
    answers.push(refused("already_in_channel"));

    expect(
      await errorCodeOf(
        SlackChannelMembers.invite({
          authToken: "t",
          channelId: "C1",
          slackUserId: "U1",
        }),
      ),
    ).toBe("already_in_channel");
  });

  test("joins a channel", async () => {
    await SlackChannelMembers.join({ authToken: "t", channelId: "C1" });

    expect(sent[0]!.url).toBe("https://slack.com/api/conversations.join");
    expect(sent[0]!.data).toEqual({ channel: "C1" });
  });
});
