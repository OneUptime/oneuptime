import Markdown, {
  PLAIN_TEXT_MARKUP_READING,
} from "../../../Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";

/*
 * MARKDOWN READ AS PLAIN TEXT TAKES TYPED MARKUP OUT COMPLETELY.
 *
 * Markdown.convertToPlainText is what a status page subscriber's custom SMS
 * and custom email subject are given for an event's Markdown -
 * {{incidentDescription}}, {{note}}, {{postmortemNote}},
 * {{scheduledMaintenanceDescription}}, {{announcementDescription}},
 * {{episodeDescription}}, a Rich text custom field - and what the alert
 * owner email's inbox preview line starts with (the root cause). Text from
 * outside OneUptime reaches all of them: a monitored service's answer in a
 * root cause, an incident an integration opened.
 *
 * It takes out the HTML typed in the Markdown by a narrow rule, so that a
 * "<" a person typed as text stays: a tag is "<", a letter (or "/" and one)
 * and what follows up to the first ">", with no "<" before it; "<!" and "<?"
 * start a comment, a declaration or a processing instruction the same way;
 * no tag holds held-back code or a blank line. It used to apply that rule
 * once, so where taking a tag out joined the text either side of it into
 * another one - "<scr<script>ipt>" - that one reached the message. Now the
 * rule is applied until no markup is left (removeMarkupFromText, one walk).
 * These tests pin that:
 *
 *   - markup one pass left behind comes out, wherever the Markdown puts it;
 *   - a "<" that starts nothing stays, and so does what held-back code,
 *     escapes and blank lines keep from being read as a tag;
 *   - text one pass left no markup in reads exactly as before: 50 real texts
 *     from the notification, SMS, call and monitor test fixtures, each with
 *     what master's convertToPlainText made of it;
 *   - the reading keeps master's limits: no tag holds U+E000 to U+E002, and
 *     nothing runs past 65536 characters;
 *   - Markdown made of tags, words and lines, with no blank line, comes out
 *     holding no markup at all (master's left some in about one in six of
 *     these texts);
 *   - a megabyte of nested markup is read in linear time.
 */

// What the rule reads as markup, on texts with no placeholder in them.
const MARKUP: RegExp = /<(?:\/?[A-Za-z][^<>]*|[!?][^<>]*)>/;

function plainText(markdown: string): string {
  return Markdown.convertToPlainText(markdown);
}

describe("Markdown.convertToPlainText takes typed markup out completely", () => {
  describe("markup one pass of the rule left behind comes out", () => {
    test.each([
      [
        "a script element split by a tag",
        "Checkout down <scr<script>ipt>alert(1)</script>",
        "Checkout down <script>alert(1)",
        "Checkout down alert(1)",
      ],
      [
        "a '<' before a tag",
        "Deploy <<b>script>x</b> done",
        "Deploy <script>x done",
        "Deploy x done",
      ],
      [
        "tags inside a tag's name",
        "<b<i>Sev 1</i>>Database down",
        "<bSev 1>Database down",
        "Database down",
      ],
      [
        "an image whose alt text holds tags",
        "<img src=x alt='a <b>bold</b> shot'>Payments are failing",
        "<img src=x alt='a bold shot'>Payments are failing",
        "Payments are failing",
      ],
      [
        "a comment inside a comment, around code",
        "<!<!-- `kubectl get pods` -->-- `rollback` -->Rolled back",
        "<!-- rollback -->Rolled back",
        "Rolled back",
      ],
      [
        "a comment around code inside a tag",
        "<b<!-- `x` -->>Restarted the pod",
        "<b>Restarted the pod",
        "Restarted the pod",
      ],
      [
        "a tag split across lines",
        "<scr\n<b>\nipt>Resolved",
        "<scr\nipt>Resolved",
        "Resolved",
      ],
      [
        "a split tag inside bold",
        "**<scr<b>ipt>alert(1)** failed",
        "<script>alert(1) failed",
        "alert(1) failed",
      ],
      [
        "a split tag in a list item",
        "- <scr<b>ipt>alert(1)</script> on web-1",
        "<script>alert(1) on web-1",
        "alert(1) on web-1",
      ],
      [
        "a split tag in a heading",
        "## <scr<b>ipt>Outage",
        "<script>Outage",
        "Outage",
      ],
      [
        "a split tag in a quote",
        "> <scr<b>ipt>Rolling back",
        "<script>Rolling back",
        "Rolling back",
      ],
      [
        "markup nested three deep",
        "<a<b<c>>>Recovered",
        "<a<b>>Recovered",
        "Recovered",
      ],
      [
        "end tags inside a tag",
        "Payments <x</b>y</i>>are back",
        "Payments <xy>are back",
        "Payments are back",
      ],
      [
        "a split tag beside a link",
        "[status](https://status.acme.com) <scr<b>ipt>x",
        "status <script>x",
        "status x",
      ],
      [
        "a split processing instruction",
        "<?php <b>echo ?>Done",
        "<?php echo ?>Done",
        "Done",
      ],
    ])(
      "%s",
      (_case: string, markdown: string, onePassLeft: string, text: string) => {
        // What one pass left still held markup...
        expect(MARKUP.test(onePassLeft)).toBe(true);

        // ...and now none is left.
        expect(plainText(markdown)).toBe(text);
        expect(MARKUP.test(text)).toBe(false);
      },
    );
  });

  describe("a '<' that starts nothing stays, as before", () => {
    test.each([
      [
        "a comparison beside a tag",
        "p99 < 200ms <b>but</b> CPU > 90%",
        "p99 < 200ms but CPU > 90%",
      ],
      ["a '<' before a word with no '>'", "x <y and <b>z</b>", "x <y and z"],
      ["a heart", "<3 <b>thanks</b>", "<3 thanks"],
      ["a run of '<'", "a << b <b>c</b>", "a << b c"],
      [
        "a '<' that no '>' follows",
        "if load <limit then page",
        "if load <limit then page",
      ],
      [
        "a '<' before a number",
        "Latency <200ms <i>(p99)</i>",
        "Latency <200ms (p99)",
      ],
      ["a tag that a tag inside never lets end", "<scr<script>ipt", "<script"],
      ["a comment whose end was inside it", "<!<!---->--", "<!--"],
      [
        "a generic around held-back code",
        "Returned Map<String, `k8s.pod_name`> from handler",
        "Returned Map<String, k8s.pod_name> from handler",
      ],
      [
        "a generic around an escaped character",
        "Returned List<Foo\\_Bar> ok",
        "Returned List<Foo_Bar> ok",
      ],
      ["a tag held apart by code", "<scr`x`<b>ipt>", "<scrxipt>"],
      ["a tag held apart by a blank line", "<scr<b>\n\nipt>", "<scr\nipt>"],
      ["a tag that never crosses a blank line", "a <b\n\nc> d", "a <b\nc> d"],
      ["what code holds", "`<scr<b>ipt>` stays", "<scr<b>ipt> stays"],
    ])("%s", (_case: string, markdown: string, text: string) => {
      expect(plainText(markdown)).toBe(text);
    });
  });

  /*
   * Real texts from the notification, SMS, call and monitor fixtures (the
   * subscriber jobs' descriptions and notes, the email, SMS and call tests,
   * the monitor templates), each with what master's convertToPlainText made
   * of it. One pass left no markup in any of them, so the walk reads them
   * exactly the same - tag-shaped words included ("P1 <urgent>").
   */
  describe("text one pass left no markup in reads exactly as before", () => {
    test.each([
      [
        "a maintenance note with HTML",
        "<p>The maintenance now starts on <strong>Sunday</strong>.</p>",
        "The maintenance now starts on Sunday.",
      ],
      [
        "a resource list with a line break",
        "Core: API<br/>Edge: Website",
        "Core: APIEdge: Website",
      ],
      [
        "a location with a bold tag",
        "<b>Site 03</b> & Site 07",
        "Site 03 & Site 07",
      ],
      [
        "a custom field line written as Markdown",
        "- **Affected Location:** \\<b>Site 03\\</b> & Site 07",
        "Affected Location: <b>Site 03</b> & Site 07",
      ],
      [
        "a title holding a script element",
        "<script>alert('title')</script> Checkout <b>down</b>",
        "alert('title') Checkout down",
      ],
      [
        "a resource name holding an image tag",
        '<img src=x onerror="alert(1)"> Payments & Billing',
        "Payments & Billing",
      ],
      [
        "the same name, its tag escaped",
        '\\<img src=x onerror="alert(1)"> Payments & Billing',
        '<img src=x onerror="alert(1)"> Payments & Billing',
      ],
      ["a severity that looks like a tag", "P1 <urgent> & loud", "P1 & loud"],
      [
        "the same severity, its '<' escaped",
        "P1 \\<urgent> & loud",
        "P1 <urgent> & loud",
      ],
      ["a tag cut off at the end", "<script", "<script"],
      [
        "a link cut off at the end",
        '<a href="https://evil.example',
        '<a href="https://evil.example',
      ],
      [
        "an unclosed table tag",
        '<table cellpadding="0" cellspacing="0" border="0" width="100%"',
        '<table cellpadding="0" cellspacing="0" border="0" width="100%"',
      ],
      [
        "placeholders written as tags",
        "a <service>.<namespace> name from pods that report no cluster",
        "a . name from pods that report no cluster",
      ],
      [
        "a project name holding markup",
        'Someone just signed in through the single sign-on of the OneUptime project "<img src=x onerror=alert(1)><a href="https://evil.example">Click</a>".',
        'Someone just signed in through the single sign-on of the OneUptime project "Click".',
      ],
      [
        "an address that ends an attribute",
        'https://acme.example/"><script>x()</script>',
        'https://acme.example/">x()',
      ],
      ["a name with a tag-shaped surname", "Ada <Lovelace>", "Ada"],
      [
        "a sender with an address",
        "OneUptime Notifications <notifications@example.test>",
        "OneUptime Notifications notifications@example.test",
      ],
      [
        "an SMTP command",
        "MAIL FROM:<noreply@example.com>",
        "MAIL FROM:noreply@example.com",
      ],
      [
        "a call's TwiML",
        "<Response><Say>Incident</Say></Response>",
        "Incident",
      ],
      [
        "a call failure note",
        "We tried to make a call to x. <br/> <br/> This call was not made. This project&#39;s balance (0.20 USD) is less than this call costs (0.35 USD).",
        "We tried to make a call to x. This call was not made. This project's balance (0.20 USD) is less than this call costs (0.35 USD).",
      ],
      [
        "a comparison beside a tag",
        "Disk \"sda1\" > 90% & <b>hot</b> at 'eu-west'",
        "Disk \"sda1\" > 90% & hot at 'eu-west'",
      ],
      [
        "entities that read as a tag",
        "Severity: <strong>High &amp; &lt;urgent&gt; &quot;customer&quot;</strong>",
        'Severity: High & <urgent> "customer"',
      ],
      [
        "a message ending in an escaped '<'",
        "with message: <br/> <br/> Incident &lt;a",
        "with message: Incident <a",
      ],
      [
        "a tag-shaped word before a line break",
        "Retry <later>\nor pay by invoice",
        "Retry \nor pay by invoice",
      ],
      [
        "a tag-shaped word before a CRLF",
        "EU <admins>\r\nUS & CA\nAPAC",
        "EU \nUS & CA\nAPAC",
      ],
      [
        "a Rich text value with raw HTML",
        'Impact: **EU** <img src=x onerror="alert(1)"> <script>steal()</script> [Reset password](javascript:alert(1)) [status](https://status.acme.com)',
        "Impact: EU steal() Reset password status",
      ],
      [
        "escaped Markdown and tags",
        "**\\<b>Notes\\</b>:**\nline \\[1\\](https://evil.example)\nline \\<2>",
        "<b>Notes</b>:\nline [1](https://evil.example)\nline <2>",
      ],
      [
        "chat mentions, an image and a tag",
        "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login) <!channel> <@U0123ABC> <b>now</b>",
        "Reset your password <@U0123ABC> now",
      ],
      ["a mention inside bold", "**1073741824 <!here>**", "**1073741824 **"],
      [
        "a mention, an image and a tag on lines",
        "Backup failed <@U0123ABC>\n\n![](https://tracker.example/p.png)\n<img src=x>",
        "Backup failed <@U0123ABC>",
      ],
      [
        "Slack mentions of every kind",
        "<!channel> <@U0123ABC> <#C0123ABC> <!subteam^S0123ABC>",
        "<@U0123ABC> <#C0123ABC>",
      ],
      ["a '<' before a letter, with no '>'", "a<b", "a<b"],
      ["a generic type", "Cache<Key>.load", "Cache.load"],
      [
        "a tag-shaped word beside a backslash",
        "edge <eu> & \\ [primary] (1)",
        "edge & \\ [primary] (1)",
      ],
      [
        "markup inside a code span",
        "x` [Verify](https://evil.example/login) ![](https://tracker.example/p.png) <img src=x> `y",
        "x [Verify](https://evil.example/login) ![](https://tracker.example/p.png) <img src=x> y",
      ],
      [
        "a screenshot after an error",
        '<p>Timeout 30000ms exceeded\n<img src="cid:x" alt="" style="max-width:100%;height:auto;"></p>\n',
        "Timeout 30000ms exceeded",
      ],
      [
        "an SVG with a handler",
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
        "",
      ],
      [
        "an unclosed tag at the end of a line",
        "Line one\nLine _two_ <b>",
        "Line one\nLine two",
      ],
      [
        "list tags named in prose",
        "renders as a styled <ol> with a nested <ul> in each <li>, and no table",
        "renders as a styled with a nested in each , and no table",
      ],
      ["a mail header", "Content-ID: <x>", "Content-ID:"],
      [
        "replacement patterns and an emoji",
        "Cost up $& 50$ on $1 — **prod** <b>now</b> 🔥",
        "Cost up $& 50$ on $1 — prod now 🔥",
      ],
      [
        "a progress note with a list and a table",
        "<p>Current progress:</p><ul><li>Investigating <strong>checkout</strong>.</li></ul><table><tbody><tr><td>eu-west</td><td>12 ms</td></tr></tbody></table>",
        "Current progress:Investigating checkout.eu-west12 ms",
      ],
      [
        "a comparison in a code span",
        "the real ceph-osd-down criteria is a `< 1` comparison on the metric value",
        "the real ceph-osd-down criteria is a < 1 comparison on the metric value",
      ],
      [
        "a tag in a code span",
        "Metric `<img src=x onerror=alert(1)>` breached",
        "Metric <img src=x onerror=alert(1)> breached",
      ],
      [
        "a CLI command with a placeholder",
        "### `oneuptime <resource> list`",
        "oneuptime <resource> list",
      ],
      [
        "a script element in a code span",
        "Run `<script>alert(1)</script>` now.",
        "Run <script>alert(1)</script> now.",
      ],
      [
        "a fenced block after text",
        "web-1\n```\n<!channel> [Verify](https://evil.example/login)\n",
        "web-1\n```\n Verify",
      ],
      [
        "an HTML comment in a note",
        "Rolled back <!-- internal: see ticket 42 --> at 10:42 UTC.",
        "Rolled back at 10:42 UTC.",
      ],
      [
        "a comment holding a code span",
        "Restarted <!-- `kubectl rollout restart` --> the pods.",
        "Restarted the pods.",
      ],
      [
        "a declaration and a processing instruction",
        '<?xml version="1.0"?><!DOCTYPE note><note>Disk full</note>',
        "Disk full",
      ],
    ])("%s", (_case: string, markdown: string, text: string) => {
      expect(plainText(markdown)).toBe(text);
    });
  });

  describe("the reading keeps the rule's limits", () => {
    test("no tag holds held-back text or a blank-line mark, U+E000 to U+E002, and nothing else stops one", () => {
      const cannotHold: Array<number> = [];

      for (let code: number = 0; code <= 0xffff; code++) {
        if (PLAIN_TEXT_MARKUP_READING.tagCannotHold!(code)) {
          cannotHold.push(code);
        }
      }

      expect(cannotHold).toEqual([0xe000, 0xe001, 0xe002]);
    });

    test("no markup holds more than 65536 characters", () => {
      expect(PLAIN_TEXT_MARKUP_READING.maxLength).toBe(65536);

      // Lines of "x", so no line is long enough to be held back.
      const lines: (count: number) => string = (count: number): string => {
        return "x\n".repeat(count);
      };

      // "<a", a line break, 30000 lines of "x" and an "x": 60002 after the "a".
      expect(plainText(`Before <a\n${lines(30000)}x> After`)).toBe(
        "Before After",
      );

      // 66002: text, as it was.
      const tooLong: string = plainText(`Before <a\n${lines(33000)}x> After`);

      expect(tooLong.startsWith("Before <a\nx\nx\n")).toBe(true);
      expect(tooLong.endsWith("x\nx\nx> After")).toBe(true);
    });
  });

  /*
   * Markdown of tags, words, "<", ">" and line breaks - no code, emphasis,
   * links, escapes or entities, which can each make a "<" or ">" of their
   * own, and no blank line, which no tag crosses (a later step joins the
   * lines either side of it). Seeded, so a failure reproduces.
   */
  describe("Markdown of tags, words and lines comes out holding no markup", () => {
    const TOKENS: Array<string> = [
      "<",
      ">",
      "<b>",
      "</b>",
      "<scr",
      "ipt>",
      "<!--",
      "-->",
      "<!",
      "<?",
      "<i",
      "i>",
      "a",
      "b",
      "x y",
      " ",
      "\n",
      "/",
      "!",
      "?",
      "=",
      '"',
      "1",
      "é",
    ];
    const BLANK_LINE: RegExp = /\n[^\S\n]*\n/;

    function makeRandom(seed: number): (limit: number) => number {
      let state: number = seed >>> 0;

      return (limit: number): number => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return Math.floor((state / 4294967296) * limit);
      };
    }

    test("on 20,000 generated texts", () => {
      const random: (limit: number) => number = makeRandom(31337);
      const leftMarkup: Array<[string, string]> = [];
      let read: number = 0;

      while (read < 20000) {
        let markdown: string = "";
        const length: number = 1 + random(20);

        for (let index: number = 0; index < length; index++) {
          markdown += TOKENS[random(TOKENS.length)];
        }

        if (BLANK_LINE.test(markdown)) {
          continue;
        }

        read++;

        const text: string = plainText(markdown);

        if (MARKUP.test(text)) {
          leftMarkup.push([markdown, text]);
        }
      }

      expect(leftMarkup.slice(0, 5)).toEqual([]);
    });
  });

  describe("time", () => {
    // Far above what this takes, so a slow machine does not fail it.
    const LIMIT_IN_MS: number = 3000;

    test("reads a megabyte of markup nested in tags' names in linear time", () => {
      // Lines, so no line is long enough to be held back as text.
      const depth: number = 170000;
      const markdown: string = `Before\n\n${"<a\n".repeat(depth)}${">\n".repeat(depth)}\nAfter`;
      const started: number = Date.now();
      const text: string = plainText(markdown);

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      expect(text).toBe("Before\nAfter");
    });
  });
});
