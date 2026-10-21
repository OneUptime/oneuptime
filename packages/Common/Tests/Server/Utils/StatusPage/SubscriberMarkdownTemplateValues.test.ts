import SubscriberMarkdownTemplateValues, {
  SUBSCRIBER_MARKDOWN_ADDRESS_VARIABLES,
} from "../../../../Server/Utils/StatusPage/SubscriberMarkdownTemplateValues";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";

/*
 * The values a custom Slack or Teams subscriber message is filled with: every
 * plain value escaped for Markdown, whatever its name - so a value a job adds
 * later is escaped without anyone listing it - and only the addresses
 * OneUptime builds left as they are.
 */
describe("SubscriberMarkdownTemplateValues.fromPlainValues", () => {
  const HOSTILE: string =
    "![](https://tracker.example/p.png) [Open](https://evil.example) <!channel> <b>x</b>";
  const ESCAPED: string = `!\\[\\](https://tracker.example/p.png) \\[Open\\](https://evil.example) \\<${WORD_JOINER}!channel> \\<b>x\\</b>`;

  test("escapes every plain value, a name it has never heard of included", () => {
    expect(
      SubscriberMarkdownTemplateValues.fromPlainValues({
        incidentTitle: HOSTILE,
        statusPageName: HOSTILE,
        aValueAddedLater: HOSTILE,
      }),
    ).toEqual({
      incidentTitle: ESCAPED,
      statusPageName: ESCAPED,
      aValueAddedLater: ESCAPED,
    });
  });

  test("leaves the addresses OneUptime builds as they are", () => {
    expect([...SUBSCRIBER_MARKDOWN_ADDRESS_VARIABLES].sort()).toEqual([
      "detailsUrl",
      "statusPageUrl",
      "unsubscribeUrl",
    ]);

    const values: Record<string, string> = {
      statusPageUrl: "https://status.example.com/?a=[1]",
      detailsUrl: "https://status.example.com/incidents/1",
      unsubscribeUrl: "https://status.example.com/unsubscribe/1-x",
    };

    expect(SubscriberMarkdownTemplateValues.fromPlainValues(values)).toEqual(
      values,
    );
  });

  test("puts every value on one line", () => {
    expect(
      SubscriberMarkdownTemplateValues.fromPlainValues({
        resourcesAffected: "API\n# OUTAGE\r\n- now",
      }),
    ).toEqual({ resourcesAffected: "API # OUTAGE - now" });
  });

  test("leaves an ordinary value exactly as typed", () => {
    const ordinary: string = "Site 03 - payments (EU) #42 & **now**";

    expect(
      SubscriberMarkdownTemplateValues.fromPlainValues({
        incidentTitle: ordinary,
      }),
    ).toEqual({ incidentTitle: ordinary });
  });

  test("returns a new object and leaves the one it was given alone", () => {
    const values: Record<string, string> = { incidentTitle: HOSTILE };

    const markdown: Record<string, string> =
      SubscriberMarkdownTemplateValues.fromPlainValues(values);

    expect(markdown).not.toBe(values);
    expect(values).toEqual({ incidentTitle: HOSTILE });
  });
});
