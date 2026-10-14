import { describe, expect, test } from "@jest/globals";
import SlackMessageReader, {
  SLACK_MESSAGE_MAX_LOOKUPS,
  SlackMessageNames,
  SlackMessageReferences,
} from "../../../../../Server/Utils/Workspace/Slack/SlackMessageReader";
import ChatMessageMarkdown, {
  ChatBlock,
  ChatMessageContent,
} from "../../../../../Utils/Markdown/ChatMessageMarkdown";
import { JSONObject } from "../../../../../Types/JSON";
import { WORD_JOINER } from "../../../../../Utils/Markdown/MarkdownEscape";

/*
 * A SLACK MESSAGE, READ AS WHAT IT SHOWS (SlackMessageReader).
 *
 * The payloads below are the shapes conversations.history returns: a
 * message typed in Slack's composer (rich_text blocks and a mrkdwn `text`
 * beside them), an app's message (sections, headers, context; legacy
 * attachments), a file shared with a comment. Each is read into what a note
 * keeps - and, through ChatMessageMarkdown, into the note's Markdown.
 */

const NAMES: SlackMessageNames = {
  users: new Map<string, string>([
    ["U0AIDIL", "Aidil Rahman"],
    ["U0NITIN", "Nitin Kumar"],
  ]),
  channels: new Map<string, string>([["C0INC8", "inc-inc-8"]]),
  userGroups: new Map<string, string>(),
};

const NO_NAMES: SlackMessageNames = {
  users: new Map<string, string>(),
  channels: new Map<string, string>(),
  userGroups: new Map<string, string>(),
};

const markdownOf: (
  message: JSONObject,
  names?: SlackMessageNames,
  options?: { withoutAttachments?: boolean },
) => string = (
  message: JSONObject,
  names?: SlackMessageNames,
  options?: { withoutAttachments?: boolean },
): string => {
  return ChatMessageMarkdown.toMarkdown(
    SlackMessageReader.read(message, names || NAMES),
    options,
  ).toString();
};

const richText: (...elements: Array<JSONObject>) => JSONObject = (
  ...elements: Array<JSONObject>
): JSONObject => {
  return { type: "rich_text", block_id: "b1", elements: elements };
};

const section: (...elements: Array<JSONObject>) => JSONObject = (
  ...elements: Array<JSONObject>
): JSONObject => {
  return { type: "rich_text_section", elements: elements };
};

// Aidil's message in the customer's screenshot, as Slack hands it over.
const SCREENSHOT_MESSAGE: JSONObject = {
  type: "message",
  user: "U0AIDIL",
  ts: "1791454620.000200",
  client_msg_id: "0c4d6c3f-1d4e-4b52-8c3e-0f1b2d3e4f50",
  text: "Not sure what's happening here, is this triggered by something?",
  team: "T0WORKSPACE",
  blocks: [
    richText(
      section({
        type: "text",
        text: "Not sure what's happening here, is this triggered by something?",
      }),
    ),
  ],
};

describe("SlackMessageReader: a message typed in Slack", () => {
  test("the screenshot's message is its words", () => {
    expect(markdownOf(SCREENSHOT_MESSAGE)).toBe(
      "Not sure what's happening here, is this triggered by something?",
    );
  });

  test("its author is the person who wrote it, and its time is its ts", () => {
    expect(SlackMessageReader.getAuthor(SCREENSHOT_MESSAGE)).toEqual({
      slackUserId: "U0AIDIL",
    });
    expect(
      SlackMessageReader.getPostedAt(SCREENSHOT_MESSAGE)!.toISOString(),
    ).toBe("2026-10-08T10:17:00.000Z");
  });

  test("styles, links, mentions, emoji and dates read as Slack shows them", () => {
    const message: JSONObject = {
      user: "U0NITIN",
      ts: "1791454620.000300",
      text: "Discussion with <@U0AIDIL> + <!subteam^S0ONCALL|@oncall-team> in <#C0OTHER|platform>",
      blocks: [
        richText(
          section(
            { type: "text", text: "Discussion with ", style: { bold: true } },
            { type: "user", user_id: "U0AIDIL", style: { bold: true } },
            { type: "text", text: " + " },
            { type: "usergroup", usergroup_id: "S0ONCALL" },
            { type: "text", text: " in " },
            { type: "channel", channel_id: "C0OTHER" },
            { type: "text", text: " and " },
            { type: "channel", channel_id: "C0INC8" },
            { type: "text", text: ":\n" },
            { type: "broadcast", range: "here" },
            { type: "text", text: " see " },
            {
              type: "link",
              url: "https://grafana.example.com/d/abc",
              text: "the dashboard",
            },
            { type: "text", text: " or " },
            { type: "link", url: "https://status.example.com" },
            { type: "text", text: " " },
            { type: "emoji", name: "wave", unicode: "1f44b" },
            {
              type: "emoji",
              name: "technologist",
              unicode: "1f9d1-200d-1f4bb",
            },
            { type: "emoji", name: "party-parrot" },
            { type: "text", text: " since " },
            {
              type: "date",
              timestamp: 1791454620,
              format: "{time}",
              fallback: "10:17 AM",
            },
            { type: "text", text: " " },
            { type: "text", text: "gone", style: { strike: true } },
            { type: "text", text: " " },
            { type: "text", text: "kubectl", style: { code: true } },
            { type: "text", text: " " },
            { type: "text", text: "now", style: { italic: true } },
          ),
        ),
      ],
    };

    expect(markdownOf(message)).toBe(
      [
        "**Discussion with @Aidil Rahman** + @oncall-team in #platform and #inc-inc-8:  ",
        "@here see [the dashboard](https://grafana.example.com/d/abc) or [https://status.example.com](https://status.example.com) 👋🧑‍💻:party-parrot: since 10:17 AM ~~gone~~ `kubectl` *now*",
      ].join("\n"),
    );
  });

  test("a person, a channel or a group Slack did not name reads as its label, else plainly", () => {
    const message: JSONObject = {
      text: "<@U0GONE> <#C0GONE> <!subteam^S0GONE>",
      blocks: [
        richText(
          section(
            { type: "user", user_id: "U0GONE" },
            { type: "text", text: " " },
            { type: "channel", channel_id: "C0GONE" },
            { type: "text", text: " " },
            { type: "usergroup", usergroup_id: "S0GONE" },
            { type: "text", text: " " },
            { type: "date", timestamp: 1791454620 },
          ),
        ),
      ],
    };

    expect(markdownOf(message, NO_NAMES)).toBe(
      "@someone #channel @group 2026-10-08T10:17:00.000Z",
    );
  });

  test("lists keep their kind, numbers and nesting; quotes and code their lines", () => {
    const message: JSONObject = {
      text: "fallback",
      blocks: [
        richText(
          section({ type: "text", text: "Steps:\n" }),
          {
            type: "rich_text_list",
            style: "ordered",
            indent: 0,
            elements: [
              section({ type: "text", text: "drain node-3" }),
              section({ type: "text", text: "roll back" }),
            ],
          },
          {
            type: "rich_text_list",
            style: "bullet",
            indent: 1,
            elements: [section({ type: "text", text: "check lag" })],
          },
          {
            type: "rich_text_list",
            style: "ordered",
            indent: 0,
            offset: 2,
            elements: [section({ type: "text", text: "close it" })],
          },
          {
            type: "rich_text_quote",
            elements: [{ type: "text", text: "Is the DB back?\nYes." }],
          },
          {
            type: "rich_text_preformatted",
            elements: [
              { type: "text", text: "kubectl logs api --tail=50\n" },
              { type: "link", url: "https://x.example/logs" },
            ],
          },
        ),
      ],
    };

    expect(markdownOf(message)).toBe(
      [
        "Steps:",
        "",
        "1. drain node-3",
        "2. roll back",
        "    - check lag",
        "3. close it",
        "",
        "> Is the DB back?  ",
        "> Yes.",
        "",
        "```",
        "kubectl logs api --tail=50",
        "https://x.example/logs",
        "```",
      ].join("\n"),
    );
  });

  test("text typed in the message is never Markdown or a mention", () => {
    const message: JSONObject = {
      text: "x",
      blocks: [
        richText(
          section({
            type: "text",
            text: "# not a heading\n![x](https://tracker.example/p.png) [a](https://evil.example) <b>bold</b> <!channel> 1. no",
          }),
        ),
      ],
    };

    const markdown: string = markdownOf(message);

    expect(markdown.startsWith("\\# not a heading")).toBe(true);
    expect(markdown).not.toContain("![x](");
    expect(markdown).not.toContain("[a](https://evil.example)");
    // Every "<" is escaped: no HTML tag, and no Slack mention.
    expect(markdown.split("<").length).toBe(4);
    expect(markdown.split("\\<").length).toBe(4);
    expect(markdown).toBe(
      [
        "\\# not a heading  ",
        `!\\[x\\](https://tracker.example/p.png) \\[a\\](https://evil.example) \\<b>bold\\</b> \\<${WORD_JOINER}!channel> 1. no`,
      ].join("\n"),
    );
  });

  test("files shared with the message are links to them; one Slack hid is its name", () => {
    const message: JSONObject = {
      user: "U0AIDIL",
      text: "Graph of the spike",
      blocks: [richText(section({ type: "text", text: "Graph of the spike" }))],
      files: [
        {
          id: "F0GRAPH",
          name: "graph.png",
          title: "graph.png",
          mimetype: "image/png",
          permalink: "https://acme.slack.com/files/U0AIDIL/F0GRAPH/graph.png",
          url_private: "https://files.slack.com/files-pri/T0-F0GRAPH/graph.png",
        },
        { id: "F0HIDDEN", name: "secret.pdf", mode: "hidden_by_limit" },
        { id: "F0GONE", mode: "tombstone" },
      ],
    };

    expect(markdownOf(message)).toBe(
      [
        "Graph of the spike",
        "",
        "📎 [graph.png](https://acme.slack.com/files/U0AIDIL/F0GRAPH/graph.png)",
        "",
        "📎 secret.pdf",
      ].join("\n"),
    );

    // A public note leaves the links into the company's Slack out.
    expect(markdownOf(message, NAMES, { withoutAttachments: true })).toBe(
      "Graph of the spike\n\n📎 secret.pdf",
    );
  });

  test("a message with rich text that shows nothing reads its text instead", () => {
    expect(
      markdownOf({
        text: "*Deploy* finished",
        blocks: [richText(section({ type: "text", text: "   " }))],
      }),
    ).toBe("**Deploy** finished");
  });

  test("a message with no blocks reads its mrkdwn text", () => {
    expect(markdownOf({ text: "Restarted the primary DB" })).toBe(
      "Restarted the primary DB",
    );
    expect(markdownOf({})).toBe("");
    expect(SlackMessageReader.read(null, NAMES)).toEqual({ blocks: [] });
  });
});

describe("SlackMessageReader: mrkdwn, Slack's own markup", () => {
  test.each([
    ["bold", "a *bold* word", "a **bold** word"],
    ["italic", "an _italic_ word", "an *italic* word"],
    ["strikethrough", "a ~gone~ word", "a ~~gone~~ word"],
    ["all three", "*_~all~_*", "~~***all***~~"],
    ["inline code", "run `kubectl get pods` now", "run `kubectl get pods` now"],
    ["no emphasis inside code", "`a *b* c`", "`a *b* c`"],
    ["an underscore inside a word", "snake_case_name", "snake_case_name"],
    ["a star between digits", "2*3*4 = 24", "2\\*3\\*4 = 24"],
    ["a marker with nothing after it", "a * b", "a \\* b"],
    ["an unpaired marker", "*not closed", "\\*not closed"],
    ["emphasis does not span lines", "*one\ntwo*", "\\*one  \ntwo\\*"],
    ["an empty pair is text", "**", "\\*\\*"],
  ])("%s", (_case: string, mrkdwn: string, markdown: string) => {
    expect(markdownOf({ text: mrkdwn })).toBe(markdown);
  });

  test.each([
    ["a person", "<@U0AIDIL> please ack", "@Aidil Rahman please ack"],
    ["a person with a label", "<@U0NEW|newbie> hi", "@newbie hi"],
    ["a channel", "see <#C0INC8>", "see #inc-inc-8"],
    ["a channel with a label", "see <#C0X|ops>", "see #ops"],
    ["here", "<!here> heads up", "@here heads up"],
    [
      "channel with a label",
      "<!channel|channel> heads up",
      "@channel heads up",
    ],
    ["a group", "<!subteam^S0ONCALL|@oncall-team> ack", "@oncall-team ack"],
    ["a group without a label", "<!subteam^S0ONCALL> ack", "@group ack"],
    ["a date", "since <!date^1791454620^{time}|10:17 AM>", "since 10:17 AM"],
    [
      "a link with words",
      "<https://grafana.example.com/d/1|the dashboard>",
      "[the dashboard](https://grafana.example.com/d/1)",
    ],
    [
      "a link",
      "<https://status.example.com>",
      "[https://status.example.com](https://status.example.com)",
    ],
    [
      "an email address",
      "<mailto:oncall@example.com|oncall@example.com>",
      "[oncall@example.com](mailto:oncall@example.com)",
    ],
    ["a bold link", "*<https://x.example|x>*", "**[x](https://x.example)**"],
    ["text that is no token", "a <notatoken> b", "a \\<notatoken> b"],
    ["a lone angle bracket", "1 < 2 and 3 > 2", "1 \\< 2 and 3 > 2"],
  ])("%s", (_case: string, mrkdwn: string, markdown: string) => {
    expect(markdownOf({ text: mrkdwn })).toBe(markdown);
  });

  test("Slack's three entities are read once", () => {
    expect(
      markdownOf({
        text: "Tom &amp; Jerry: 1 &lt; 2 &gt; 0, literally &amp;lt;b&amp;gt;",
      }),
    ).toBe("Tom & Jerry: 1 \\< 2 > 0, literally \\&lt;b\\&gt;");
  });

  test("a quoted line is a quote, and code fences are code", () => {
    expect(
      markdownOf({
        text: "&gt; is the DB back?\n&gt;yes\nThen:\n```\nSELECT 1;\n<@U0AIDIL>\n```\ndone",
      }),
    ).toBe(
      [
        "> is the DB back?  ",
        "> yes",
        "",
        "Then:",
        "",
        "```",
        "SELECT 1;",
        "@Aidil Rahman",
        "```",
        "",
        "done",
      ].join("\n"),
    );
  });
});

describe("SlackMessageReader: an app's message", () => {
  test("sections, headers, context and images read as their text and links", () => {
    const message: JSONObject = {
      bot_id: "B0DD",
      bot_profile: { name: "Datadog" },
      text: "fallback text",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "CPU high on db-1" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Monitor:* <https://dd.example/m/1|CPU>",
          },
          fields: [
            { type: "mrkdwn", text: "*Host*\ndb-1" },
            { type: "plain_text", text: "Value 97%" },
          ],
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "Triggered by <@U0NITIN>" },
            {
              type: "image",
              image_url: "https://dd.example/i.png",
              alt_text: "logo",
            },
          ],
        },
        { type: "divider" },
        {
          type: "image",
          image_url: "https://dd.example/graph.png",
          alt_text: "graph",
          title: { type: "plain_text", text: "CPU graph" },
        },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Mute" } },
          ],
        },
        { type: "markdown", text: "**raw** markdown from an app" },
      ],
    };

    expect(SlackMessageReader.getAuthor(message)).toEqual({
      botName: "Datadog",
    });
    expect(markdownOf(message)).toBe(
      [
        "**CPU high on db-1**",
        "",
        "**Monitor:** [CPU](https://dd.example/m/1)",
        "",
        "**Host**  ",
        "db-1",
        "",
        "Value 97%",
        "",
        "Triggered by @Nitin Kumar",
        "",
        "📎 [logo](https://dd.example/i.png)",
        "",
        "📎 [CPU graph](https://dd.example/graph.png)",
        "",
        "\\*\\*raw\\*\\* markdown from an app",
      ].join("\n"),
    );
  });

  test("a legacy attachment is read; a link's preview is not", () => {
    const message: JSONObject = {
      bot_id: "B0GH",
      username: "GitHub",
      subtype: "bot_message",
      text: "",
      attachments: [
        {
          pretext: "New deploy",
          title: "oneuptime/oneuptime#4791",
          title_link: "https://github.example/oneuptime/pull/4791",
          text: "Merged by *valeria*",
          fields: [{ title: "Branch", value: "`master`" }],
          image_url: "https://github.example/og.png",
        },
        {
          from_url: "https://news.example/story",
          original_url: "https://news.example/story",
          title: "A preview",
          text: "of a link already in the message",
        },
        { fallback: "Only a fallback" },
      ],
    };

    expect(SlackMessageReader.getAuthor(message)).toEqual({
      botName: "GitHub",
    });
    expect(markdownOf(message)).toBe(
      [
        "New deploy",
        "",
        "**[oneuptime/oneuptime#4791](https://github.example/oneuptime/pull/4791)**",
        "",
        "Merged by **valeria**",
        "",
        "**Branch**",
        "",
        "`master`",
        "",
        "📎 [image](https://github.example/og.png)",
        "",
        "Only a fallback",
      ].join("\n"),
    );
  });

  test("a person's message is no app's, whatever name it carries", () => {
    expect(
      SlackMessageReader.getAuthor({ user: "U0AIDIL", username: "aidil" }),
    ).toEqual({ slackUserId: "U0AIDIL" });
    expect(SlackMessageReader.getAuthor({ user: "not an id!" })).toEqual({});
    expect(SlackMessageReader.getAuthor(null)).toEqual({});
  });

  test("a ts Slack did not give reads as no time", () => {
    for (const ts of [undefined, "", "abc", "-1", "0"]) {
      expect(
        SlackMessageReader.getPostedAt({ ts: ts } as JSONObject),
      ).toBeNull();
    }
  });
});

describe("SlackMessageReader.getReferences: the names to look up", () => {
  test("people, channels and groups, from rich text, mrkdwn and attachments, each once", () => {
    const references: SlackMessageReferences = SlackMessageReader.getReferences(
      {
        user: "U0AUTHOR",
        text: "<@U0AIDIL> <@U0NITIN|nitin> <#C0INC8> <!subteam^S0ONCALL|@oncall>",
        blocks: [
          richText(
            section(
              { type: "user", user_id: "U0AIDIL" },
              { type: "user", user_id: "U0RICH" },
              { type: "channel", channel_id: "C0RICH" },
              { type: "usergroup", usergroup_id: "S0RICH" },
            ),
          ),
          {
            type: "section",
            text: { type: "mrkdwn", text: "<@U0SECTION>" },
          },
        ],
        attachments: [
          { text: "<@U0ATTACH>" },
          { from_url: "https://x.example", text: "<@U0PREVIEW>" },
        ],
      },
    );

    expect(references).toEqual({
      userIds: ["U0AIDIL", "U0RICH", "U0NITIN", "U0SECTION", "U0ATTACH"],
      channelIds: ["C0RICH", "C0INC8"],
      userGroupIds: ["S0RICH", "S0ONCALL"],
    });
  });

  test("at most a few dozen of each, and only ids that are ids", () => {
    let text: string = "<@not an id> <#> ";

    for (let index: number = 0; index < 100; index++) {
      text += `<@U${index}A> `;
    }

    const references: SlackMessageReferences = SlackMessageReader.getReferences(
      {
        text: text,
      },
    );

    expect(references.userIds).toHaveLength(SLACK_MESSAGE_MAX_LOOKUPS);
    expect(references.userIds[0]).toBe("U0A");
    expect(references.channelIds).toEqual([]);
  });
});

describe("SlackMessageReader: in time that grows with the message", () => {
  /*
   * A message is whatever anybody typed, or an app sent: read, and written
   * as a note, at once whatever it holds. Reading and writing are timed
   * apart - each within LIMIT_IN_MS for 400,000 characters. A message of
   * a few hundred thousand pieces ("backticks", "fences") also once threw:
   * its blocks were added with push(...blocks), an argument each, more than
   * the call stack holds.
   */
  const LENGTH: number = 400000;
  const LIMIT_IN_MS: number = 2000;

  const expectInTime: (message: JSONObject) => void = (
    message: JSONObject,
  ): void => {
    let started: number = performance.now();
    const content: ChatMessageContent = SlackMessageReader.read(message, NAMES);
    SlackMessageReader.getReferences(message);
    const readInMs: number = performance.now() - started;

    started = performance.now();
    const markdown: string = ChatMessageMarkdown.toMarkdown(content).toString();
    const writtenInMs: number = performance.now() - started;

    expect(markdown.length).toBeGreaterThan(0);
    expect({
      readInMs: readInMs < LIMIT_IN_MS,
      writtenInMs: writtenInMs < LIMIT_IN_MS,
    }).toEqual({
      readInMs: true,
      writtenInMs: true,
    });
  };

  test.each([
    ["angle brackets that never close", "<".repeat(LENGTH)],
    ["one '>' after many '<'", "<".repeat(LENGTH) + ">"],
    ["backticks", "`".repeat(LENGTH)],
    ["backticks a line apart", "`\n".repeat(LENGTH / 2)],
    ["markers", "*_~".repeat(LENGTH / 3)],
    ["emphasis pairs", "*a* ".repeat(LENGTH / 4)],
    ["entities", "&amp;&lt;".repeat(LENGTH / 9)],
    ["tokens", "<@U0AIDIL> ".repeat(LENGTH / 11)],
    ["links", "<https://a.example|a> ".repeat(LENGTH / 22)],
    ["fences", "```".repeat(LENGTH / 3)],
    ["quotes", "&gt; a\n".repeat(LENGTH / 7)],
    ["lines", "a\n".repeat(LENGTH / 2)],
  ])("mrkdwn: %s", (_case: string, mrkdwn: string) => {
    expectInTime({ text: mrkdwn });
  });

  test("rich text of fifty thousand elements", () => {
    const elements: Array<JSONObject> = [];

    for (let index: number = 0; index < 50000; index++) {
      elements.push(
        index % 2 === 0
          ? { type: "text", text: "word ", style: { bold: true } }
          : { type: "user", user_id: "U0AIDIL" },
      );
    }

    expectInTime({
      text: "",
      blocks: [richText({ type: "rich_text_section", elements: elements })],
    });
  });

  test("a list of twenty thousand items", () => {
    const items: Array<JSONObject> = [];

    for (let index: number = 0; index < 20000; index++) {
      items.push(section({ type: "text", text: `item ${index}` }));
    }

    const block: JSONObject = richText({
      type: "rich_text_list",
      style: "bullet",
      indent: 0,
      elements: items,
    });

    const content: ChatMessageContent = SlackMessageReader.read(
      { blocks: [block] },
      NAMES,
    );

    expect((content.blocks[0] as ChatBlock).type).toBe("list");
    expectInTime({ blocks: [block] });
  });
});
