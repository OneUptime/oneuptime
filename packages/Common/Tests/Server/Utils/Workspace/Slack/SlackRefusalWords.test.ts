import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../../../Server/Utils/Notification/BlockedProjectNotifications";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackRefusal, {
  SlackRefusalException,
} from "../../../../../Server/Utils/Workspace/Slack/SlackRefusal";
import WorkspaceBase, {
  WorkspaceSendMessageResponse,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import API from "../../../../../Utils/API";
import WorkspaceRefusal, {
  SLACK_CHANNEL_ARCHIVED_REFUSAL,
  SLACK_REFUSALS,
  SLACK_UNKNOWN_REFUSAL_REASON,
  WorkspaceRefusalFamily,
} from "../../../../../Utils/Workspace/WorkspaceRefusal";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * #7119: SLACK'S REFUSALS ARE SAID IN WORDS, NOT AS CODES.
 *
 * Every call OneUptime makes of Slack's Web API that Slack refuses -
 * {"ok": false, "error": "<code>"} - was thrown as "Error from Slack
 * <code>", and that was what Notification Logs, Test Rule and Send Test
 * Now said. Here Slack is stood in for at the HTTP layer (API.post), and
 * refuses each kind of call - posting, inviting, creating a channel,
 * joining one, editing a message, answering a button - with a code: what
 * comes back is OneUptime's words for the code, then the code.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "71190000-0000-4000-8000-000000000001",
);
const SLACK_API: string = "https://slack.com/api/";
const BOT_TOKEN: string = "xoxb-acme";
const BOT_USER_ID: string = "U0BOT";

// What Slack answers each method with: ok, or a refusal with the code here.
let refusals: Record<string, string> = {};

// An HTTP error Slack answers a method with instead (status, body).
let httpErrors: Record<string, { status: number; body: JSONObject }> = {};

function connection(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.workspaceProjectId = "T0ACME";
  auth.authToken = BOT_TOKEN;
  auth.miscData = {
    teamId: "T0ACME",
    teamName: "Acme",
    botUserId: BOT_USER_ID,
  } as SlackMiscData;
  return auth;
}

// What SlackUtil.sendMessage answers for a message to #ops.
async function postInOps(): Promise<WorkspaceSendMessageResponse> {
  return SlackUtil.sendMessage({
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
      channelIds: [],
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: "**Incident #12** is acknowledged.",
        } as WorkspacePayloadMarkdown,
      ],
    },
    authToken: BOT_TOKEN,
    userId: BOT_USER_ID,
    projectId: PROJECT_ID,
  });
}

// What a call rejects with, as a person reads it.
async function refusalOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (err) {
    return WorkspaceBase.getSendErrorMessage(err);
  }

  throw new Error("The call was not refused");
}

beforeEach(() => {
  refusals = {};
  httpErrors = {};

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const url: string = request.url.toString();
    const method: string = url.startsWith(SLACK_API)
      ? url.substring(SLACK_API.length)
      : url;

    const httpError: { status: number; body: JSONObject } | undefined =
      httpErrors[method];

    if (httpError) {
      return new HTTPErrorResponse(httpError.status, httpError.body, {});
    }

    if (refusals[method] !== undefined) {
      return new HTTPResponse<JSONObject>(
        200,
        { ok: false, error: refusals[method]! },
        {},
      );
    }

    if (method === "conversations.list") {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          channels: [{ id: "C0OPS", name: "ops", is_archived: false }],
          response_metadata: { next_cursor: "" },
        },
        {},
      );
    }

    if (method === "conversations.members") {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          members: [BOT_USER_ID],
          response_metadata: { next_cursor: "" },
        },
        {},
      );
    }

    if (method === "conversations.create") {
      return new HTTPResponse<JSONObject>(
        200,
        { ok: true, channel: { id: "C0NEW", name: "inc-12" } },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      { ok: true, channel: request.data?.["channel"], ts: "1762851600.000100" },
      {},
    );
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(connection() as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockResolvedValue(undefined as never);

  jest.spyOn(BlockedProjectNotifications, "isBlocked").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a post Slack refuses: its Notification Logs row says what to do", () => {
  const everyCode: Array<[string]> = SLACK_REFUSALS.flatMap(
    (family: WorkspaceRefusalFamily): Array<[string]> => {
      return family.codes
        .filter((code: string): boolean => {
          // OneUptime's own codes for an answer that was no Slack JSON.
          return !["http_429", "no_answer"].includes(code);
        })
        .map((code: string): [string] => {
          return [code];
        });
    },
  );

  test.each(everyCode)(
    "chat.postMessage refused with %s",
    async (code: string) => {
      refusals["chat.postMessage"] = code;

      const response: WorkspaceSendMessageResponse = await postInOps();

      expect(response.threads).toEqual([]);
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0]!.error).toBe(
        WorkspaceRefusal.describeSlackRefusal(code),
      );
      expect(response.errors![0]!.error).not.toContain("Error from Slack");
    },
  );

  test("REGRESSION: is_archived reads as the archived channel, then Slack's code", async () => {
    refusals["chat.postMessage"] = "is_archived";

    const response: WorkspaceSendMessageResponse = await postInOps();

    expect(response.errors![0]!.error).toBe(
      `${SLACK_CHANNEL_ARCHIVED_REFUSAL.reason} Slack said: is_archived.`,
    );
  });

  test("a code OneUptime does not know still says something, and keeps the code", async () => {
    refusals["chat.postMessage"] = "brand_new_refusal";

    const response: WorkspaceSendMessageResponse = await postInOps();

    expect(response.errors![0]!.error).toBe(
      `${SLACK_UNKNOWN_REFUSAL_REASON} Slack said: brand_new_refusal.`,
    );
  });

  test("an HTTP 429 with Slack's code in its body reads as the rate limit", async () => {
    httpErrors["chat.postMessage"] = {
      status: 429,
      body: { ok: false, error: "ratelimited" },
    };

    const response: WorkspaceSendMessageResponse = await postInOps();

    expect(response.errors![0]!.error).toBe(
      WorkspaceRefusal.describeSlackRefusal("ratelimited"),
    );
  });

  test("an HTTP 503 with no Slack answer reads as Slack being unavailable", async () => {
    httpErrors["chat.postMessage"] = { status: 503, body: {} };

    const response: WorkspaceSendMessageResponse = await postInOps();

    expect(response.errors![0]!.error).toBe(
      WorkspaceRefusal.describeSlackRefusal("http_503"),
    );
  });
});

describe("each kind of Slack call says its refusal in words", () => {
  test("inviting somebody (conversations.invite)", async () => {
    refusals["conversations.invite"] = "user_is_restricted";

    expect(
      await refusalOf(() => {
        return SlackUtil.inviteUserToChannelByChannelId({
          authToken: BOT_TOKEN,
          channelId: "C0OPS",
          workspaceUserId: "U0GUEST",
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("user_is_restricted"));
  });

  test("creating a channel (conversations.create)", async () => {
    refusals["conversations.create"] = "invalid_name_specials";

    expect(
      await refusalOf(() => {
        return SlackUtil.createChannel({
          authToken: BOT_TOKEN,
          channelName: "inc-12",
          projectId: PROJECT_ID,
          organization: null,
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("invalid_name_specials"));
  });

  test("joining a channel (conversations.join)", async () => {
    refusals["conversations.join"] = "is_archived";

    expect(
      await refusalOf(() => {
        return SlackUtil.joinChannel({
          authToken: BOT_TOKEN,
          channelId: "C0OPS",
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("is_archived"));
  });

  test("editing a message (chat.update)", async () => {
    refusals["chat.update"] = "cant_update_message";

    expect(
      await refusalOf(() => {
        return SlackUtil.updateMessage({
          authToken: BOT_TOKEN,
          projectId: PROJECT_ID,
          location: { channelId: "C0OPS" },
          messageId: "1762851600.000100",
          messageBlocks: [],
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("cant_update_message"));
  });

  test("archiving a channel (conversations.archive)", async () => {
    refusals["conversations.archive"] = "cant_archive_general";

    expect(
      await refusalOf(() => {
        return SlackUtil.archiveChannels({
          userId: BOT_USER_ID,
          channelIds: ["C0GEN"],
          authToken: BOT_TOKEN,
          sendMessageBeforeArchiving: undefined as never,
          projectId: PROJECT_ID,
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("cant_archive_general"));
  });

  test("a message only one person sees (chat.postEphemeral)", async () => {
    refusals["chat.postEphemeral"] = "user_not_in_channel";

    expect(
      await refusalOf(() => {
        return SlackUtil.sendEphemeralMessageToChannel({
          authToken: BOT_TOKEN,
          channelId: "C0OPS",
          userId: "U0SOMEONE",
          messageBlocks: [],
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("user_not_in_channel"));
  });

  test("a form opened over a button (views.open)", async () => {
    refusals["views.open"] = "expired_trigger_id";

    expect(
      await refusalOf(() => {
        return SlackUtil.showMessageInModal({
          authToken: BOT_TOKEN,
          triggerId: "1337.42",
          title: "Done",
          messageBlocks: [],
        });
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("expired_trigger_id"));
  });
});

describe("what tells one Slack refusal from another reads the code, not the words", () => {
  test("a taken name, in a refusal thrown now and in one with the old words", () => {
    expect(
      SlackUtil.isChannelNameTakenError(
        new SlackRefusalException("name_taken"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isChannelNameTakenError(
        new BadDataException("Error from Slack name_taken"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isChannelNameTakenError(
        new SlackRefusalException("invalid_name"),
      ),
    ).toBe(false);
    expect(SlackUtil.isChannelNameTakenError(new Error("name_taken"))).toBe(
      false,
    );
  });

  test("a workspace OneUptime is not added to", () => {
    expect(
      SlackUtil.isWorkspaceNotAddedError(
        new SlackRefusalException("team_access_not_granted"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isWorkspaceNotAddedError(
        new BadDataException("Error from Slack team_access_not_granted"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isWorkspaceNotAddedError(
        new SlackRefusalException("channel_not_found"),
      ),
    ).toBe(false);
  });

  test("a message that is gone", () => {
    expect(
      SlackUtil.isMessageGoneError(
        new SlackRefusalException("message_not_found"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isMessageGoneError(
        new BadDataException("Error from Slack message_not_found"),
      ),
    ).toBe(true);
    expect(
      SlackUtil.isMessageGoneError(
        new SlackRefusalException("cant_update_message"),
      ),
    ).toBe(false);
  });
});

describe("SlackRefusal", () => {
  test("the code is on the exception, read by its field from another realm too", () => {
    expect(SlackRefusal.getCode(new SlackRefusalException("is_archived"))).toBe(
      "is_archived",
    );
    expect(
      SlackRefusal.getCode({ slackCode: "is_archived", message: "" }),
    ).toBe("is_archived");
  });

  test("an HTTP error's body carries Slack's code", () => {
    expect(
      SlackRefusal.getCode(
        new HTTPErrorResponse(429, { ok: false, error: "ratelimited" }, {}),
      ),
    ).toBe("ratelimited");
    expect(
      SlackRefusal.fromHttpError(new HTTPErrorResponse(502, {}, {})).slackCode,
    ).toBe("http_502");
  });

  test("an answer with no code - or one that says undefined - is the unknown refusal", () => {
    expect(SlackRefusal.fromAnswer({ ok: false }).message).toBe(
      SLACK_UNKNOWN_REFUSAL_REASON,
    );
    expect(
      SlackRefusal.fromAnswer({ ok: false, error: "undefined" }).message,
    ).toBe(SLACK_UNKNOWN_REFUSAL_REASON);
    expect(SlackRefusal.fromAnswer(null).message).toBe(
      SLACK_UNKNOWN_REFUSAL_REASON,
    );
  });

  test("describe words an error that still says the old words, and leaves others alone", () => {
    expect(
      SlackRefusal.describe(new Error("Error from Slack missing_scope")),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("missing_scope"));
    expect(SlackRefusal.describe(new Error("Something else."))).toBe(
      "Something else.",
    );
    expect(
      SlackUtil.describeError(new SlackRefusalException("ratelimited")),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("ratelimited"));
  });

  test("the refusal is a 400 a person reads, not a fault", () => {
    const refusal: SlackRefusalException = new SlackRefusalException(
      "not_in_channel",
    );

    expect(refusal.message).toContain("Invite the bot to the channel in Slack");
    expect(refusal.message).toMatch(/Slack said: not_in_channel\.$/);
  });
});
