import { describe, expect, test } from "@jest/globals";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";

/*
 * A MOMENT IN A SLACK OR MICROSOFT TEAMS MESSAGE, IN EACH READER'S OWN TIME.
 *
 * The on-call run's message says when its next step comes ("if nobody
 * acknowledges by 5:28 PM"). The server knows no reader's time zone, so the
 * moment is written in the form each workspace shows in its reader's own
 * zone and clock: Teams' card text function {{TIME(...)}}, which a message's
 * Markdown carries as it is, and Slack's <!date^...> - which Slack's text
 * gets once its Markdown is converted, since the conversion escapes "<".
 */

// 5:28 PM UTC on Thursday 8 October 2026.
const AT_17_28: Date = new Date("2026-10-08T17:28:00.000Z");
const AT_17_28_UNIX: number = AT_17_28.getTime() / 1000;

describe("WorkspaceMessageTime.time", () => {
  test("is Markdown that Microsoft Teams shows in its reader's own time: whole seconds, in UTC", () => {
    expect(WorkspaceMessageTime.time(AT_17_28).toString()).toBe(
      "{{TIME(2026-10-08T17:28:00Z)}}",
    );
    expect(
      WorkspaceMessageTime.time(
        new Date("2026-10-08T17:28:09.999Z"),
      ).toString(),
    ).toBe("{{TIME(2026-10-08T17:28:09Z)}}");
  });
});

describe("WorkspaceMessageTime.endOfWait", () => {
  test("a wait that started on the minute ends on its last minute", () => {
    expect(
      WorkspaceMessageTime.endOfWait(new Date("2026-10-08T17:21:00.000Z"), 7),
    ).toEqual(AT_17_28);
  });

  test("a wait that started inside a minute ends on the next minute: when the run's once-a-minute tick moves on", () => {
    expect(
      WorkspaceMessageTime.endOfWait(new Date("2026-10-08T17:21:00.001Z"), 7),
    ).toEqual(new Date("2026-10-08T17:29:00.000Z"));
    expect(
      WorkspaceMessageTime.endOfWait(new Date("2026-10-08T17:21:37.250Z"), 7),
    ).toEqual(new Date("2026-10-08T17:29:00.000Z"));
  });

  test("a long wait crosses hours and days", () => {
    expect(
      WorkspaceMessageTime.endOfWait(
        new Date("2026-10-08T23:50:00.000Z"),
        24 * 60,
      ),
    ).toEqual(new Date("2026-10-09T23:50:00.000Z"));
  });
});

describe("WorkspaceMessageTime.toSlack", () => {
  test("each moment becomes a Slack date in the reader's own time, its fallback the time in UTC", () => {
    expect(
      WorkspaceMessageTime.toSlack(
        "If nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, rule 3 is next.",
      ),
    ).toBe(
      `If nobody acknowledges by <!date^${AT_17_28_UNIX}^{time}|17:28 UTC>, rule 3 is next.`,
    );
  });

  test("every moment in the text, each its own", () => {
    expect(
      WorkspaceMessageTime.toSlack(
        "{{TIME(2026-10-08T17:28:00Z)}} then {{TIME(2026-10-08T09:05:00Z)}}",
      ),
    ).toBe(
      `<!date^${AT_17_28_UNIX}^{time}|17:28 UTC> then <!date^${new Date("2026-10-08T09:05:00Z").getTime() / 1000}^{time}|09:05 UTC>`,
    );
  });

  test("text without a moment is returned as it is", () => {
    for (const text of [
      "",
      "plain text",
      "{{TIME()}}",
      "{{DATE(2026-10-08T17:28:00Z)}}",
      "{{TIME(2026-10-08T17:28:00+02:00)}}",
      "{{TIME(2026-10-08 17:28)}}",
    ]) {
      expect(WorkspaceMessageTime.toSlack(text)).toBe(text);
    }
  });

  test("a moment that is no date is left as written", () => {
    expect(
      WorkspaceMessageTime.toSlack("by {{TIME(2026-13-45T99:99:99Z)}}"),
    ).toBe("by {{TIME(2026-13-45T99:99:99Z)}}");
  });
});

describe("WorkspaceMessageTime.toPlainText", () => {
  test("each moment reads as its time in UTC: for a notification log, which shows no workspace's formatting", () => {
    expect(
      WorkspaceMessageTime.toPlainText(
        "If nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, rule 3 is next.",
      ),
    ).toBe("If nobody acknowledges by 17:28 UTC, rule 3 is next.");
    expect(WorkspaceMessageTime.toPlainText("plain text")).toBe("plain text");
    expect(WorkspaceMessageTime.toPlainText("")).toBe("");
  });
});

describe("a moment through Slack's Markdown conversion", () => {
  test("the conversion leaves the Teams form as it is, so Slack's text can be given its own after", () => {
    expect(
      SlackUtil.slackify(
        "**Escalation rule 2 of 3**: if nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, rule 3 is next.",
      ),
    ).toContain(
      "if nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, rule 3 is next.",
    );
  });

  test("a message's section text has the Slack date, next to Slack's own bold", () => {
    const blocks: Array<{ text: { text: string } }> =
      SlackUtil.getMarkdownBlocks({
        payloadMarkdownBlock: {
          _type: "WorkspacePayloadMarkdown",
          text: "**Escalation rule 2 of 3 (second)**: if nobody acknowledges by {{TIME(2026-10-08T17:28:00Z)}}, escalation rule 3 (third) is next.",
        },
      }) as unknown as Array<{ text: { text: string } }>;

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text.text).toBe(
      `\u200b*Escalation rule 2 of 3 (second)*\u200b: if nobody acknowledges by <!date^${AT_17_28_UNIX}^{time}|17:28 UTC>, escalation rule 3 (third) is next.\n`,
    );
  });

  test("a message without a moment converts exactly as before", () => {
    const markdown: string =
      "📟 **PolicyX** is paging for [Incident INC-8](https://oneuptime.test/i/8)\n\n- **Nitin**: paged once";

    expect(
      (
        SlackUtil.getMarkdownBlocks({
          payloadMarkdownBlock: {
            _type: "WorkspacePayloadMarkdown",
            text: markdown,
          },
        })[0] as unknown as { text: { text: string } }
      ).text.text,
    ).toBe(SlackUtil.slackify(markdown));
  });
});

describe("WorkspaceMessageTime.dateAndTime - a moment days away, with its day", () => {
  // 12:00 UTC on Friday 6 March 2026: when somebody who is away is back.
  const BACK: Date = new Date("2026-03-06T12:00:00.000Z");
  const BACK_UNIX: number = BACK.getTime() / 1000;

  test("is Markdown Teams shows as the reader's own day and time", () => {
    expect(WorkspaceMessageTime.dateAndTime(BACK).toString()).toBe(
      "{{DATE(2026-03-06T12:00:00Z, SHORT)}} {{TIME(2026-03-06T12:00:00Z)}}",
    );
  });

  test("Slack gets its own dates: the day (today, tomorrow or the date) and the time", () => {
    expect(
      WorkspaceMessageTime.toSlack(
        `away until ${WorkspaceMessageTime.dateAndTime(BACK).toString()}`,
      ),
    ).toBe(
      `away until <!date^${BACK_UNIX}^{date_short_pretty}|2026-03-06> <!date^${BACK_UNIX}^{time}|12:00 UTC>`,
    );
  });

  test("a notification log reads the day and the time in UTC", () => {
    expect(
      WorkspaceMessageTime.toPlainText(
        `away until ${WorkspaceMessageTime.dateAndTime(BACK).toString()}`,
      ),
    ).toBe("away until 2026-03-06 12:00 UTC");
  });

  test("a day alone, in text that has no time, is still converted", () => {
    expect(
      WorkspaceMessageTime.toSlack("{{DATE(2026-03-06T12:00:00Z, SHORT)}}"),
    ).toBe(`<!date^${BACK_UNIX}^{date_short_pretty}|2026-03-06>`);
    expect(
      WorkspaceMessageTime.toPlainText("{{DATE(2026-03-06T12:00:00Z, SHORT)}}"),
    ).toBe("2026-03-06");
  });

  test("a day that is no date, or not in the short form, is left as written", () => {
    for (const text of [
      "{{DATE(2026-13-45T99:99:99Z, SHORT)}}",
      "{{DATE(2026-03-06T12:00:00Z, LONG)}}",
      "{{DATE(2026-03-06T12:00:00Z)}}",
    ]) {
      expect(WorkspaceMessageTime.toSlack(text)).toBe(text);
      expect(WorkspaceMessageTime.toPlainText(text)).toBe(text);
    }
  });
});
