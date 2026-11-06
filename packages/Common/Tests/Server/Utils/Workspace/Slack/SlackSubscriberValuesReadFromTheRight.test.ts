import { describe, expect, test } from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { getServerTranslator } from "../../../../../Server/Utils/ServerTranslation";
import SubscriberMessageText from "../../../../../Server/Utils/StatusPage/SubscriberMessageText";
import { Translator } from "../../../../../Types/Translator";
import {
  isolated,
  withoutIsolateMarks,
} from "../../../../Helpers/IsolateMarks";

/*
 * A PERSIAN SUBSCRIBER'S SLACK MESSAGE KEEPS ITS VALUES SET APART.
 *
 * A status page's Slack message is Markdown, made Slack's own text by
 * convertMarkdownToSlackRichText. A Persian subscriber's lines read from
 * the right, and each value after its label is isolated
 * (SubscriberMessageText.chatValue), so "API (EU)" keeps its closing
 * bracket at its end: the isolate's marks must reach Slack around the
 * value, and nothing else of the line may change.
 */

const STATUS_PAGE_URL: string = "https://status.acme.example";
const UNSUBSCRIBE_URL: string =
  "https://status.acme.example/update-subscription/s1?token=7f_Ab-9";

describe("a Persian subscriber's Slack message", () => {
  const persian: Translator = getServerTranslator("fa");

  test("each value reaches Slack in its isolate, the labels bold as before", () => {
    const slackText: string = SlackUtil.convertMarkdownToSlackRichText(
      SubscriberMessageText.incidentStateChangeChatMessage(persian, {
        title: "Checkout is down",
        resourcesAffected: "Checkout API (EU)",
        severityName: "Major Incident",
        stateName: "Resolved",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    );

    expect(slackText).toContain(isolated("Checkout API (EU)"));
    expect(slackText).toContain(
      isolated(SubscriberMessageText.nameInLanguage(persian, "Resolved")),
    );
    // Slack's bold, and the label, as they were.
    expect(slackText).toContain("*منابع تحت تأثیر:*");
  });

  test("without the marks, the Persian message reads what it read before", () => {
    const markdown: string =
      SubscriberMessageText.incidentStateChangeChatMessage(persian, {
        title: "Checkout is down",
        resourcesAffected: "Checkout API (EU)",
        severityName: "Major Incident",
        stateName: "Resolved",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      });

    expect(
      withoutIsolateMarks(SlackUtil.convertMarkdownToSlackRichText(markdown)),
    ).toBe(
      SlackUtil.convertMarkdownToSlackRichText(withoutIsolateMarks(markdown)),
    );
  });

  test("an English subscriber's message carries no mark", () => {
    const slackText: string = SlackUtil.convertMarkdownToSlackRichText(
      SubscriberMessageText.incidentStateChangeChatMessage(
        getServerTranslator("en"),
        {
          title: "Checkout is down",
          resourcesAffected: "Checkout API (EU)",
          severityName: "Major Incident",
          stateName: "Resolved",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
        },
      ),
    );

    expect(slackText).toBe(withoutIsolateMarks(slackText));
    // Slack's bold is closed with a zero-width space after it.
    expect(slackText).toContain(
      "*Resources Affected:*\u{200B} Checkout API (EU)",
    );
  });
});
