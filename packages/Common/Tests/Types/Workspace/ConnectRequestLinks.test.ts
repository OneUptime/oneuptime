import { describe, expect, test } from "@jest/globals";
import ConnectCallbackUtil, {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
  CONNECT_REQUEST_TOKEN_PATTERN,
  ConnectCallbackError,
  ConnectRequestOutcome,
} from "../../../Types/Workspace/ConnectCallback";

/*
 * What a settings page reads off its address once a Connect button in Slack
 * or Microsoft Teams sent the browser there: the token of the press
 * (`?connect=`), what became of it (`?pressed=`), and the Slack channel to
 * go back to (`?slackChannel=`, `?slackTeam=`) - or the flag of a Slack
 * channel note's Connect Slack account link (`?connectAccount=true`). Each
 * is read for its shape alone, so the address can never put a value of
 * anyone's choosing into a request, a sentence or a link.
 */

describe("ConnectCallbackUtil.readConnectRequestToken", () => {
  test("takes a token shaped as the server issues them", () => {
    const token: string = "aZ09_-".repeat(7) + "q";

    expect(token).toHaveLength(43);
    expect(ConnectCallbackUtil.readConnectRequestToken(token)).toBe(token);
  });

  test.each([
    ["nothing", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["one character short", "a".repeat(42)],
    ["one character long", "a".repeat(44)],
    ["a space", `${"a".repeat(42)} `],
    ["an ampersand that would add a parameter", `${"a".repeat(41)}&x`],
    ["a number", 7],
    ["an array", ["a".repeat(43)]],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(ConnectCallbackUtil.readConnectRequestToken(value)).toBeNull();
  });

  test("the pattern is anchored at both ends", () => {
    expect(CONNECT_REQUEST_TOKEN_PATTERN.test(`x${"a".repeat(43)}`)).toBe(
      false,
    );
    expect(CONNECT_REQUEST_TOKEN_PATTERN.test(`${"a".repeat(43)}x`)).toBe(
      false,
    );
  });
});

describe("ConnectCallbackUtil.readConnectAccount", () => {
  test("the note's link asks for it with ?connectAccount=true", () => {
    expect(CONNECT_ACCOUNT_QUERY_PARAM).toBe("connectAccount");
    expect(CONNECT_ACCOUNT_QUERY_VALUE).toBe("true");
    expect(ConnectCallbackUtil.readConnectAccount("true")).toBe(true);
  });

  test.each([null, undefined, "", "TRUE", "1", "yes", "false", true, ["true"]])(
    "reads %p as not asked",
    (value: unknown) => {
      expect(ConnectCallbackUtil.readConnectAccount(value)).toBe(false);
    },
  );
});

describe("ConnectCallbackUtil.readConnectRequestOutcome", () => {
  test.each(Object.values(ConnectRequestOutcome))(
    "knows %s",
    (outcome: ConnectRequestOutcome) => {
      expect(ConnectCallbackUtil.readConnectRequestOutcome(outcome)).toBe(
        outcome,
      );
    },
  );

  test.each([null, undefined, "", "finished", "ANSWERED", "DONE", 1])(
    "reads %p as no outcome",
    (value: unknown) => {
      expect(ConnectCallbackUtil.readConnectRequestOutcome(value)).toBeNull();
    },
  );

  /*
   * The page says "finished" only for a press that was done: done already
   * by somebody else, refused or failed is answered in the chat, which says
   * why - the page only says where.
   */
  test("done and answered are told apart", () => {
    expect(ConnectRequestOutcome.Done).toBe("done");
    expect(ConnectRequestOutcome.Answered).toBe("answered");
  });

  /*
   * A question to OneUptime AI was asked in a message: no button to press
   * again, so it has an outcome of its own - "ask your question again".
   */
  test("a question to ask again, a command to run again and a button to press again are told apart", () => {
    expect(ConnectRequestOutcome.PressAgain).toBe("again");
    expect(ConnectRequestOutcome.AskAgain).toBe("ask");
    expect(ConnectRequestOutcome.RunAgain).toBe("run");
  });

  test("every outcome has an address of its own", () => {
    const values: Array<string> = Object.values(ConnectRequestOutcome);

    expect(new Set(values).size).toBe(values.length);
  });
});

describe("ConnectCallbackUtil.pointsToChatAnswer", () => {
  test.each([
    [ConnectRequestOutcome.Done, true],
    [ConnectRequestOutcome.Answered, true],
    [ConnectRequestOutcome.PressAgain, false],
    [ConnectRequestOutcome.RunAgain, false],
    [ConnectRequestOutcome.AskAgain, false],
    [ConnectRequestOutcome.Expired, false],
    [ConnectRequestOutcome.NotAnswered, false],
  ])(
    "%s sends the reader to the answer in the chat: %s",
    (outcome: ConnectRequestOutcome, pointsToChat: boolean) => {
      expect(ConnectCallbackUtil.pointsToChatAnswer(outcome)).toBe(
        pointsToChat,
      );
    },
  );

  test("covers every outcome", () => {
    expect(Object.values(ConnectRequestOutcome)).toHaveLength(7);
  });
});

describe("ConnectCallbackUtil.getSlackChannelLink", () => {
  test("opens the channel in Slack, through Slack's own app_redirect", () => {
    expect(
      ConnectCallbackUtil.getSlackChannelLink({
        channel: "C0INC2",
        team: "T0TEAM",
      }),
    ).toBe("https://slack.com/app_redirect?channel=C0INC2&team=T0TEAM");
  });

  test.each([
    ["no channel", undefined, "T0TEAM"],
    ["no workspace", "C0INC2", undefined],
    ["a channel that is not an id", "C0INC2&team=T9EVIL", "T0TEAM"],
    ["a lower-case channel", "c0inc2", "T0TEAM"],
    ["a workspace with a path in it", "C0INC2", "T0/../x"],
    ["a channel that is a whole address", "https://evil.test", "T0TEAM"],
  ])(
    "builds no link from %s",
    (_name: string, channel: unknown, team: unknown) => {
      expect(
        ConnectCallbackUtil.getSlackChannelLink({ channel, team }),
      ).toBeNull();
    },
  );
});

describe("the refusal codes a Connect button's sign-in can come back with", () => {
  test("another Slack or Microsoft account than the one that pressed is its own code", () => {
    expect(ConnectCallbackError.SlackOtherAccount).toBe("slack-other-account");
    expect(ConnectCallbackError.TeamsOtherAccount).toBe("teams-other-account");
    expect(ConnectCallbackUtil.readError("slack-other-account")).toBe(
      ConnectCallbackError.SlackOtherAccount,
    );
    expect(ConnectCallbackUtil.readError("teams-other-account")).toBe(
      ConnectCallbackError.TeamsOtherAccount,
    );
  });
});
