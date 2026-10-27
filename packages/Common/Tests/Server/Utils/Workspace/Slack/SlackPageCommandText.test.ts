import { describe, expect, test } from "@jest/globals";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { SlackAction } from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackCommandParser, {
  SlackCommandRequest,
} from "../../../../../Server/Utils/Workspace/Slack/SlackCommandParser";
import { WorkspaceCommandName } from "../../../../../Server/Utils/Workspace/WorkspaceCommands";
import WorkspacePageTextReader, {
  WorkspacePageText,
  WorkspacePageToken,
} from "../../../../../Server/Utils/Workspace/WorkspacePageText";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * `/oneuptime page @nawaz The checkout API is down`, AS SLACK SENDS IT.
 *
 * With the command's escaping on (the manifest's should_escape), Slack sends
 * a person as <@U0123|nawaz> - or <@U0123> - so who to page is the person
 * behind the id, never a name that may be anybody's. Groups come as
 * <!subteam^S0123|@oncall-db>, @here as <!here>, channels and links as their
 * own tokens, and "&", "<" and ">" escaped. The page reads the text as Slack
 * sent it (rawText), as tokens (getPageTokens).
 */

function read(text: string): SlackCommandRequest {
  return SlackCommandParser.read({ command: "/oneuptime", text: text });
}

function tokensOf(text: string): Array<WorkspacePageToken> {
  return SlackCommandParser.getPageTokens(read(text).rawText);
}

function pageTextOf(text: string): WorkspacePageText {
  return WorkspacePageTextReader.read(tokensOf(text));
}

describe("SlackCommandParser: the page word", () => {
  test("/oneuptime page is the page command, its text as Slack sent it the action's value", () => {
    const request: SlackCommandRequest = read(
      "page <@U0NAWAZ|nawaz> The checkout API is down",
    );

    expect(request.input.command).toBe(WorkspaceCommandName.Page);
    expect(SlackCommandParser.getAction(request)).toEqual({
      actionType: SlackActionType.PageSomeone,
      actionValue: "page <@U0NAWAZ|nawaz> The checkout API is down",
      command: "/oneuptime page",
    } as SlackAction);
  });

  test.each(["page", "PAGE", "Page:", "  page  "])(
    "%j alone is the page command, with nothing after it: the form opens",
    (text: string) => {
      const request: SlackCommandRequest = read(text);

      expect(request.input.command).toBe(WorkspaceCommandName.Page);
      expect(SlackCommandParser.getAction(request).actionType).toBe(
        SlackActionType.PageSomeone,
      );
    },
  );

  test("run again as typed, in a workspace that runs OneUptime with its own command", () => {
    const request: SlackCommandRequest = SlackCommandParser.read({
      command: "/irm",
      text: "page <@U0NAWAZ>",
    });

    expect(SlackCommandParser.getAction(request).command).toBe("/irm page");
  });
});

describe("SlackCommandParser.getPageTokens", () => {
  test("a person, with the name Slack gave, then the message", () => {
    expect(tokensOf("page <@U0NAWAZ|nawaz> The checkout API is down")).toEqual([
      { kind: "text", text: " " },
      {
        kind: "person",
        person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
      },
      { kind: "text", text: " The checkout API is down" },
    ]);
  });

  test("a person with no name - Slack's newer form - is a person still", () => {
    expect(pageTextOf("page <@U0NAWAZ> db down")).toEqual({
      people: [{ workspaceUserId: "U0NAWAZ", name: "" }],
      groups: [],
      unknownNames: [],
      message: "db down",
    });
  });

  test("a name Slack gave with its @ is kept without it", () => {
    expect(pageTextOf("page <@U0NAWAZ|@nawaz> db").people).toEqual([
      { workspaceUserId: "U0NAWAZ", name: "nawaz" },
    ]);
  });

  test("two people, a comma between them, a separator after", () => {
    expect(
      pageTextOf("page <@U0NAWAZ|nawaz>, <@U0SIMON|simon>: replica is behind"),
    ).toEqual({
      people: [
        { workspaceUserId: "U0NAWAZ", name: "nawaz" },
        { workspaceUserId: "U0SIMON", name: "simon" },
      ],
      groups: [],
      unknownNames: [],
      message: "replica is behind",
    });
  });

  test("a user group keeps its id - what OneUptime matches a group that follows on-call schedules by; @here and @channel have none", () => {
    expect(
      pageTextOf(
        "page <!subteam^S0DB|@oncall-db> <!here> <!channel|channel> db down",
      ),
    ).toEqual({
      people: [],
      groups: [
        { name: "oncall-db", workspaceGroupId: "S0DB" },
        { name: "here", workspaceGroupId: "" },
        { name: "channel", workspaceGroupId: "" },
      ],
      unknownNames: [],
      message: "db down",
    });
  });

  test("a user group with no name: its id, for both", () => {
    expect(pageTextOf("page <!subteam^S0DB> db").groups).toEqual([
      { name: "S0DB", workspaceGroupId: "S0DB" },
    ]);
  });

  test("/oneuptime page @payments-oncall: the user group, then the message", () => {
    expect(
      pageTextOf(
        "page <!subteam^S0PAYMENTS|@payments-oncall> The checkout API is throwing 500s",
      ),
    ).toEqual({
      people: [],
      groups: [{ name: "payments-oncall", workspaceGroupId: "S0PAYMENTS" }],
      unknownNames: [],
      message: "The checkout API is throwing 500s",
    });
  });

  test("a channel, a link and a date in the message read as typed", () => {
    expect(
      pageTextOf(
        "page <@U0NAWAZ|nawaz> see <#C0OPS|ops> and <https://status.example.com|the status page> since <!date^1760290080^{time}|17:28 UTC>",
      ).message,
    ).toBe("see #ops and the status page since 17:28 UTC");
  });

  test("a person mentioned in the message is part of it, by name", () => {
    expect(
      pageTextOf("page <@U0NAWAZ|nawaz> db down, ask <@U0SIMON|simon> too"),
    ).toEqual({
      people: [{ workspaceUserId: "U0NAWAZ", name: "nawaz" }],
      groups: [],
      unknownNames: [],
      message: "db down, ask @simon too",
    });
  });

  test("&, < and > as Slack escapes them read as typed", () => {
    expect(
      pageTextOf("page <@U0NAWAZ|nawaz> p99 &gt; 2s &amp; errors &lt; 1%")
        .message,
    ).toBe("p99 > 2s & errors < 1%");
  });

  test("an app created from an older manifest sends people as plain names: names nobody can be told from", () => {
    expect(pageTextOf("page @nawaz db down")).toEqual({
      people: [],
      groups: [],
      unknownNames: ["@nawaz"],
      message: "db down",
    });
  });

  test("the first word is the command's, whatever its case", () => {
    expect(pageTextOf("PAGE <@U0NAWAZ|nawaz> db").people).toHaveLength(1);
    expect(pageTextOf("  Page:   <@U0NAWAZ|nawaz>   db").message).toBe("db");
  });

  test("nothing after the word: no tokens", () => {
    expect(tokensOf("page")).toEqual([]);
    expect(tokensOf("page   ")).toEqual([{ kind: "text", text: "   " }]);
    expect(SlackCommandParser.getPageTokens("")).toEqual([]);
  });

  test("a token that never closes is text", () => {
    expect(pageTextOf("page <@U0NAWAZ db down")).toEqual({
      people: [],
      groups: [],
      unknownNames: [],
      message: "<@U0NAWAZ db down",
    });
  });

  test("text as long as a chat sends, and longer: read in time that grows with it", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        SlackCommandParser.getPageTokens(`page ${"<@U0|a>".repeat(60_000)}`);
        SlackCommandParser.getPageTokens(`page ${"<@".repeat(200_000)}`);
        SlackCommandParser.getPageTokens(
          `page ${"<!subteam^".repeat(40_000)}>`,
        );
        SlackCommandParser.getPageTokens(`${" ".repeat(400_000)}page`);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
