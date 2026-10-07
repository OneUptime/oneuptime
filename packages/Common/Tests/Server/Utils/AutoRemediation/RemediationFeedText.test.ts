import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import RunbookExecutionService from "../../../../Server/Services/RunbookExecutionService";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import RemediationVerifier from "../../../../Server/Utils/AutoRemediation/RemediationVerifier";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Lexer, Token, marked } from "marked";

// Where an HTML tag starts.
const HTML_TAG_START_PATTERN: RegExp = /<\/?[A-Za-z]/;

/*
 * TEXT IN AUTO-REMEDIATION FEED ITEMS.
 *
 * An auto-remediation's feed items - on the incident's feed and in its Slack
 * and Teams channels - quote what a command printed when it failed, and name
 * the runbook that ran. Both are text: the output is whatever the resource,
 * the cluster or the command wrote, and the runbook's name is what someone
 * typed. In the feed item's Markdown each reads as written and is no link,
 * image, HTML or Slack mention.
 */

const HOSTILE: string =
  "Error: <!channel>\n[Fix it here](https://evil.example/fix) ![](https://tracker.example/p.png) <b>now</b>";

function kindsOf(markdown: string): Array<string> {
  const kinds: Array<string> = [];

  marked.walkTokens(
    new Lexer({ gfm: true }).lex(markdown),
    (token: Token): void => {
      kinds.push(
        token.type === "html" && !HTML_TAG_START_PATTERN.test(token.raw)
          ? "text"
          : token.type,
      );
    },
  );

  return kinds;
}

function expectText(markdown: string): void {
  const kinds: Array<string> = kindsOf(markdown);

  expect(kinds).not.toContain("image");
  expect(kinds).not.toContain("html");
  expect(
    Array.from(
      markdown.matchAll(/(?<!\\)\[[^\]]*\]\(https:\/\/(?:evil|tracker)/g),
    ),
  ).toEqual([]);
  expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).not.toMatch(
    /<[!@#][A-Za-z0-9]/,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A command's output quoted in a feed item", () => {
  const capForFeed: (text: string) => string = (
    CommandPlanExecutor as unknown as { capForFeed: (text: string) => string }
  ).capForFeed.bind(CommandPlanExecutor);

  test("reads as printed, on one line, and acts on nothing", () => {
    const quoted: string = capForFeed(HOSTILE);

    expect(quoted).toBe(
      "Error: \\<\u2060!channel> \\[Fix it here\\](https://evil.example/fix) !\\[\\](https://tracker.example/p.png) \\<b>now\\</b>",
    );
    expectText(
      `⚠️ **Approved AI command plan failed:** command 1 failed: ${quoted}`,
    );
  });

  test("is cut to a feed line's length, and the cut cannot leave Markdown open", () => {
    const quoted: string = capForFeed(
      `${"x".repeat(2000)} [link](https://evil.example)`,
    );

    expect(quoted.length).toBeLessThan(2000);
    expect(quoted.endsWith("…")).toBe(true);
    expectText(quoted);
  });
});

describe("A runbook's name in the verification feed item", () => {
  test("reads as typed, and acts on nothing", async () => {
    const SUGGESTION_ID: ObjectID = ObjectID.generate();

    jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
      {
        id: SUGGESTION_ID,
        _id: SUGGESTION_ID.toString(),
        projectId: ObjectID.generate(),
        incidentId: ObjectID.generate(),
        runbookExecutionId: ObjectID.generate(),
        verificationDeadlineAt: new Date(Date.now() + 10 * 60 * 1000),
        autoResolveOnRecovery: false,
        ruleNameSnapshot: "Restart API pods",
        runbookNameSnapshot: HOSTILE,
      } as unknown as AutoRemediationSuggestion,
    ]);
    jest.spyOn(RunbookExecutionService, "findOneById").mockResolvedValue({
      status: RunbookExecutionStatus.Failed,
    } as unknown as RunbookExecution);
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptVerificationTransition")
      .mockResolvedValue(1 as never);
    const feed: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem> =
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);

    await RemediationVerifier.verifyPendingRemediations();

    expect(feed).toHaveBeenCalledTimes(1);
    const markdown: string = (feed.mock.calls[0]![0] as unknown as JSONObject)[
      "feedInfoInMarkdown"
    ] as string;

    expectText(markdown);
    expect(
      markdown
        .replace(/\\([!-/:-@[-`{-~])/g, "$1")
        .split("\u2060")
        .join(""),
    ).toContain(`Runbook "${HOSTILE.replace(/\n/g, " ")}" failed`);
  });
});
