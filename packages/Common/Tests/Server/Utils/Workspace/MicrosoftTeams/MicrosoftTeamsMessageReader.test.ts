import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsMessageReader, {
  withoutAttachmentElements,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageReader";
import { JSONObject } from "../../../../../Types/JSON";
import ChatMessageMarkdown, {
  ChatMessageContent,
} from "../../../../../Utils/Markdown/ChatMessageMarkdown";
import { WORD_JOINER } from "../../../../../Utils/Markdown/MarkdownEscape";
import { generatedTexts } from "../../../../Helpers/GeneratedTexts";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../../../Utils/Markdown/DashboardMarkdownRenderer";
import { Token, marked } from "marked";

/*
 * A MICROSOFT TEAMS MESSAGE, READ AS WHAT IT SHOWS (MicrosoftTeamsMessageReader).
 *
 * Somebody pins a message in an incident's Teams channel - or reacts with a
 * note emoji - and it becomes a note. Graph hands the message over as HTML.
 * It used to be saved as its bare words: bold, lists, code and links were
 * lost. Now it reads as Teams showed it, written by ChatMessageMarkdown.
 *
 * And it is still only what it shows: every tag and comment is read with
 * replaceHtmlMarkup, entities once after that, and every piece of text is
 * placed as text - so a broken or hostile tag, or text typed as markup
 * ("&lt;script&gt;", "![x](...)", "<!channel>"), is never a tag, an image,
 * a link or a mention in the note. The messages below are the ones the
 * plain-text reader was held to, with the note each is now.
 */

const MESSAGE_URL: string =
  "https://teams.microsoft.com/l/message/19:incident-42@thread.tacv2/1700000000200?groupId=g&tenantId=t";

const graphMessage: (data: {
  content: string;
  contentType?: string;
  attachments?: Array<JSONObject>;
  webUrl?: string;
  subject?: string;
}) => JSONObject = (data: {
  content: string;
  contentType?: string;
  attachments?: Array<JSONObject>;
  webUrl?: string;
  subject?: string;
}): JSONObject => {
  return {
    id: "1700000000200",
    replyToId: null,
    messageType: "message",
    createdDateTime: "2026-10-08T10:17:00.123Z",
    deletedDateTime: null,
    subject: data.subject || null,
    webUrl: data.webUrl || null,
    from: {
      user: {
        id: "aad-aidil",
        displayName: "Aidil Rahman",
        userIdentityType: "aadUser",
      },
    },
    body: {
      contentType: data.contentType || "html",
      content: data.content,
    },
    attachments: data.attachments || [],
    reactions: [],
  };
};

const noteOf: (
  html: string,
  options?: { webUrl?: string; withoutAttachments?: boolean },
) => string = (
  html: string,
  options?: { webUrl?: string; withoutAttachments?: boolean },
): string => {
  const message: JSONObject = graphMessage({
    content: html,
    ...(options?.webUrl ? { webUrl: options.webUrl } : {}),
  });

  return ChatMessageMarkdown.toMarkdown(
    MicrosoftTeamsMessageReader.read(message),
    {
      withoutAttachments: Boolean(options?.withoutAttachments),
    },
  ).toString();
};

// Every token marked reads in a note, nested ones included.
const markdownTokensOf: (markdown: string) => Array<Token> = (
  markdown: string,
): Array<Token> => {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
};

// Every "<" in a note is text: a backslash before it.
const everyAngleBracketEscaped: (markdown: string) => boolean = (
  markdown: string,
): boolean => {
  return markdown.split("<").length === markdown.split("\\<").length;
};

/*
 * Messages people send in an incident channel, as Graph returns them, and
 * the note each is now.
 */
const ORDINARY_MESSAGES: Array<[string, string, string]> = [
  [
    "a paragraph",
    "<p>Restarted the primary DB</p>",
    "Restarted the primary DB",
  ],
  [
    "Graph's wrapper divs and a mention",
    '<div><div><at id="0">Adele Vance</at>&nbsp;Hello there</div></div>',
    "@Adele Vance Hello there",
  ],
  [
    "two mentions",
    '<p><at id="0">Jane</at>&nbsp;and <at id="1">Ravi Kumar</at>, failover done at 12:03.</p>',
    "@Jane and @Ravi Kumar, failover done at 12:03.",
  ],
  [
    "bold, italic, underline and strikethrough",
    "<p><strong>Root cause:</strong> <em>expired certificate</em> on <u>api-gateway</u> <s>maybe DNS</s></p>",
    "**Root cause:** *expired certificate* on api-gateway ~~maybe DNS~~",
  ],
  [
    "a link",
    '<p>Runbook: <a href="https://wiki.example.com/runbooks/db" rel="noreferrer noopener" target="_blank" title="https://wiki.example.com/runbooks/db">https://wiki.example.com/runbooks/db</a></p>',
    "Runbook: [https://wiki.example.com/runbooks/db](https://wiki.example.com/runbooks/db)",
  ],
  [
    "a link with words",
    '<p>See <a href="https://grafana.example.com/d/abc?from=now-1h&amp;to=now">the <b>dashboard</b></a> now</p>',
    "See [the dashboard](https://grafana.example.com/d/abc?from=now-1h&to=now) now",
  ],
  [
    "bulleted and numbered lists",
    "<ul><li>Drained node-3</li><li>Rolled back <code>v2.4.1</code></li></ul><ol><li>Watch lag</li><li>Close the incident</li></ol>",
    "- Drained node-3\n- Rolled back `v2.4.1`\n1. Watch lag\n2. Close the incident",
  ],
  [
    "a nested list",
    "<ol><li>Fail over<ul><li>check lag</li><li>check writes</li></ul></li><li>Close</li></ol>",
    "1. Fail over\n    - check lag\n    - check writes\n2. Close",
  ],
  [
    "a code block",
    '<pre class="language-bash"><code>kubectl get pods -n prod\nkubectl logs api-7d9 --tail=50</code></pre>',
    "```\nkubectl get pods -n prod\nkubectl logs api-7d9 --tail=50\n```",
  ],
  [
    "a Teams code block",
    '<codeblock class=""><code>SELECT count(*) FROM orders WHERE status = &#39;stuck&#39;;</code></codeblock>',
    "```\nSELECT count(*) FROM orders WHERE status = 'stuck';\n```",
  ],
  [
    "inline code holding an entity",
    "<p>Set <code>max_connections &gt; 200</code> and restart</p>",
    "Set `max_connections > 200` and restart",
  ],
  [
    "an emoji element and emoji typed as text",
    '<p>Fixed <emoji id="1f44d_thumbsup" alt="&#128077;" title="Thumbs up"></emoji> thanks 🔥🚒</p>',
    "Fixed 👍 thanks 🔥🚒",
  ],
  [
    "a reply quoting another message",
    '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1700000000000"><strong itemprop="mri" itemid="8:orgid:abc">Jane Doe</strong><span itemprop="time" itemid="1700000000000"></span><p itemprop="preview">Is the DB back?</p></blockquote><p>Yes, all green.</p>',
    "> **Jane Doe**\n>\n> Is the DB back?\n\nYes, all green.",
  ],
  [
    "a table",
    "<table><tbody><tr><td>p99</td><td>420 ms</td></tr><tr><td>errors</td><td>0.2%</td></tr></tbody></table>",
    "p99 | 420 ms\n\nerrors | 0.2%",
  ],
  [
    "line breaks",
    "<p>Next steps:<br>1. watch lag<br/>2. close incident<br />3. postmortem</p>",
    "Next steps:  \n1\\. watch lag  \n2\\. close incident  \n3\\. postmortem",
  ],
  [
    "entities, a '<' before a space among them",
    "<p>Tom &amp; Jerry said &quot;it&#39;s fixed&quot;, p99 &gt; 2s and a &lt; b</p>",
    'Tom & Jerry said "it\'s fixed", p99 > 2s and a \\< b',
  ],
  [
    "an entity written out in the message",
    "<p>literally &amp;lt;tag&amp;gt; in a log line</p>",
    "literally \\&lt;tag\\&gt; in a log line",
  ],
  [
    "Chinese and Japanese with a mention",
    '<p>数据库已恢复。<at id="0">山田</at>さん、確認お願いします。</p>',
    "数据库已恢复。@山田さん、確認お願いします。",
  ],
  [
    "Korean and Hindi",
    "<p>복구 완료 — डेटाबेस फिर से उपलब्ध है</p>",
    "복구 완료 — डेटाबेस फिर से उपलब्ध है",
  ],
  [
    "right-to-left text",
    '<p dir="rtl">پایگاه داده دوباره در دسترس است</p>',
    "پایگاه داده دوباره در دسترس است",
  ],
  [
    "text and a card attachment",
    '<p>See the card</p><attachment id="74d20c7f34aa4a7fb74e2b30004247c5"></attachment>',
    "See the card",
  ],
  [
    "headings",
    "<h1>Status</h1><h2>Impact</h2><p>None for customers</p>",
    "**Status**\n\n**Impact**\n\nNone for customers",
  ],
  [
    "non-breaking spaces",
    "<p>&nbsp;</p><p>text&nbsp;&nbsp;here&nbsp;</p>",
    "text  here",
  ],
  ["a system event", "<systemEventMessage/>", ""],
  ["empty paragraphs", "<p></p><p>\n</p><p>only this</p><p></p>", "only this"],
  [
    "coloured spans",
    '<p><span style="color:rgb(255, 0, 0)">Sev 1</span> since <span style="font-size:inherit">09:41 UTC</span></p>',
    "Sev 1 since 09:41 UTC",
  ],
  [
    "comparisons written with spaces",
    "<p>latency &lt; 200 ms is fine, &gt; 2 s pages someone</p>",
    "latency \\< 200 ms is fine, > 2 s pages someone",
  ],
  [
    "numeric entities",
    "<p>&#169; 2026 &#x2014; status &#9989;</p>",
    "© 2026 — status ✅",
  ],
  [
    "a mention with punctuation after it",
    '<p>cc <at id="0">On-Call (Platform)</at>: please ack</p>',
    "cc @On-Call (Platform): please ack",
  ],
  [
    "nested divs",
    "<div><div><div>Deploy <b>#4521</b> is out</div></div><div>Monitoring now</div></div>",
    "Deploy **#4521** is out\n\nMonitoring now",
  ],
  [
    "white space as Teams draws it",
    "<p>one\n   two\t\tthree</p>",
    "one two three",
  ],
];

/*
 * Messages whose HTML is broken or hostile, or that hold text typed as
 * markup, and the note each is: the markup read as markup and left out,
 * the text as text.
 */
const MARKUP_MESSAGES: Array<[string, string, string]> = [
  // The rest of a tag that never ends is text, as replaceHtmlMarkup leaves it.
  [
    "an unclosed tag",
    "<p>hi</p><img src=x onerror=alert(1)",
    "hi\n\nimg src=x onerror=alert(1)",
  ],
  [
    "a tag inside a tag's name",
    "<scr<script>ipt>alert(1)</script>",
    "ipt>alert(1)",
  ],
  ["an overlapping comment", "<!<!---->--ok", "\\--ok"],
  [
    "a comment holding a tag and '>'",
    "<p>a<!-- <img src=x> > b -->c</p>",
    "ac",
  ],
  [
    "an attribute value holding '>'",
    '<p><img alt="a > b" src="https://x.example/y.png">after</p>',
    "📎 [a > b](https://x.example/y.png)after",
  ],
  [
    "a tag rebuilt once a tag inside it is out",
    "<p>&lt;scr<b></b>ipt&gt;alert(1)&lt;/script&gt;</p>",
    "\\<script>alert(1)\\</script>",
  ],
  [
    "a typed tag",
    "<p>use &lt;b&gt;bold&lt;/b&gt; in the template</p>",
    "use \\<b>bold\\</b> in the template",
  ],
  [
    "a typed script element",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    "\\<script>alert(1)\\</script>",
  ],
  [
    "a typed tag in numeric entities",
    "<p>&#60;img src=x&#62; and &#x3c;b&#x3e;</p>",
    "\\<img src=x> and \\<b>",
  ],
  [
    "a typed Slack mention",
    "<p>&lt;!channel&gt; heads up</p>",
    `\\<${WORD_JOINER}!channel> heads up`,
  ],
  [
    "a typed autolink",
    "<p>see &lt;https://status.example.com&gt;</p>",
    "see \\<https://status.example.com>",
  ],
  [
    "comparisons written without a space",
    "<p>p99&lt;200ms and x &lt;= y</p>",
    "p99\\<200ms and x \\<= y",
  ],
  [
    "an image typed as Markdown",
    "<p>see ![chart](https://tracker.example/p.png)</p>",
    "see !\\[chart\\](https://tracker.example/p.png)",
  ],
  [
    "a link typed as Markdown",
    "<p>[Reset your password](https://login.example/reset)</p>",
    "\\[Reset your password\\](https://login.example/reset)",
  ],
  [
    "a link definition typed as Markdown",
    "<p>[logo]: https://tracker.example/p.png</p>",
    "\\[logo\\]: https://tracker.example/p.png",
  ],
  [
    "a list item whose attribute holds '>'",
    '<ul><li title="a>b">Drained node-3</li></ul>',
    "- Drained node-3",
  ],
  [
    "a mention whose attribute holds '>'",
    '<p><at id="0" title="x>y">Jane</at> please ack</p>',
    "@Jane please ack",
  ],
  [
    "a line break whose attribute holds '>'",
    '<p>one<br class="x>y">two</p>',
    "one  \ntwo",
  ],
  [
    "an end tag with a space before its '>'",
    "<p>first</p ><p>second</p >",
    "first\n\nsecond",
  ],
  [
    "a link to a script",
    '<p><a href="javascript:alert(1)">click</a> and <a href="data:text/html,x">this</a></p>',
    "click (javascript:alert(1)) and this (data:text/html,x)",
  ],
  [
    "a link whose words are another site",
    '<p><a href="https://evil.example/login">https://login.microsoftonline.com</a></p>',
    "[https://evil.example/login](https://evil.example/login)",
  ],
  [
    "a style element",
    "<style>p { color: red }</style><p>visible</p>",
    "visible",
  ],
];

describe("MicrosoftTeamsMessageReader: a Teams message as its note", () => {
  test.each(ORDINARY_MESSAGES)(
    "%s",
    (_case: string, html: string, note: string) => {
      expect(noteOf(html)).toBe(note);
    },
  );

  test.each(MARKUP_MESSAGES)(
    "%s: the markup is read, the text is text",
    (_case: string, html: string, note: string) => {
      const markdown: string = noteOf(html);

      expect(markdown).toBe(note);
      expect(everyAngleBracketEscaped(markdown)).toBe(true);
    },
  );

  test("no note holds markup marked reads, and its links are the message's own", () => {
    for (const [, html] of [...ORDINARY_MESSAGES, ...MARKUP_MESSAGES]) {
      const tokens: Array<Token> = markdownTokensOf(noteOf(html));

      expect(
        tokens
          .filter((token: Token): boolean => {
            return token.type === "html" || token.type === "image";
          })
          .map((token: Token): string => {
            return token.raw;
          }),
      ).toEqual([]);

      for (const token of tokens) {
        if (token.type === "link" && token.raw.startsWith("[")) {
          // A link written from an <a> or an <img> the message had.
          expect(html).toContain(
            (token as { href: string }).href.split("&")[0],
          );
        }
      }
    }
  });

  test("the dashboard shows each note's links, and nothing typed as one", () => {
    const notes: Array<string> = [...ORDINARY_MESSAGES, ...MARKUP_MESSAGES].map(
      ([, html]: [string, string, string]): string => {
        return noteOf(html);
      },
    );
    const rendered: Array<string> = renderAsDashboard(notes);

    expect(
      rendered.flatMap((html: string): Array<string> => {
        return hrefsOf(html);
      }),
    ).toEqual([
      "https://wiki.example.com/runbooks/db",
      "https://grafana.example.com/d/abc?from=now-1h&to=now",
      "https://x.example/y.png",
      /*
       * A bare web address is a link, wherever somebody types one - to what
       * GitHub's Markdown reads as its end, the ">" after it too.
       */
      "https://status.example.com%3E",
      "https://tracker.example/p.png",
      "https://login.example/reset",
      "https://tracker.example/p.png",
      "https://evil.example/login",
    ]);

    for (const html of rendered) {
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<b>");
    }
  });

  test("as typed, the Markdown in those messages would be read as markup", () => {
    // So the tests above are not passing on text Markdown leaves alone anyway.
    for (const typed of [
      "see ![chart](https://tracker.example/p.png)",
      "[Reset your password](https://login.example/reset)",
      "<b>bold</b>",
    ]) {
      expect(
        markdownTokensOf(typed).some((token: Token): boolean => {
          return ["html", "image", "link"].includes(token.type);
        }),
      ).toBe(true);
    }
  });

  test("leaves none of the HTML's markup in the text, whatever the HTML", () => {
    for (const html of [
      "<scr<script>ipt>alert(1)</script>",
      "<<script>script>alert(1)",
      "<script<script>>alert(1)",
      "<p>x</p><script",
      "<<<<",
      "<!-- <script> -->",
      "<!<!---->--",
      "<p>a<!-- x > y -->b</p>",
      '<img alt="x" src="<script>">',
      "<scr<br>ipt>alert(1)",
      "<<li>script>",
      '<at id="0"><script>x</script></at>',
      '<a href="https://x.example"><img src="<script>"></a>',
    ]) {
      const content: ChatMessageContent = MicrosoftTeamsMessageReader.read(
        graphMessage({ content: html }),
      );

      expect([html, ChatMessageMarkdown.toPlainText(content)]).toEqual([
        html,
        expect.not.stringContaining("<"),
      ]);
    }
  });

  test("an image's alt text is its name, as text", () => {
    expect(noteOf('<img alt="<script>" src=x>')).toBe("(\\<script>)");
  });

  test("a post's subject is its first line, in bold", () => {
    expect(
      ChatMessageMarkdown.toMarkdown(
        MicrosoftTeamsMessageReader.read(
          graphMessage({
            subject: "Failover # 2",
            content: "<p>Done at 12:03</p>",
          }),
        ),
      ).toString(),
    ).toBe("**Failover # 2**\n\nDone at 12:03");
  });

  test("a plain-text body is text", () => {
    expect(
      ChatMessageMarkdown.toMarkdown(
        MicrosoftTeamsMessageReader.read(
          graphMessage({
            contentType: "text",
            content:
              "<img src=x onerror=alert(1)> and <!here>\n# not a heading",
          }),
        ),
      ).toString(),
    ).toBe(
      `\\<img src=x onerror=alert(1)> and \\<${WORD_JOINER}!here>  \n\\# not a heading`,
    );
  });
});

describe("MicrosoftTeamsMessageReader: images and attachments", () => {
  const HOSTED_IMAGE: string =
    '<div><div>\n<div><span><img height="63" src="https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m/hostedContents/aWQ9/$value" width="67" style="vertical-align:bottom; width:67px; height:63px"></span>\n\n</div>\n\n\n</div>\n</div>';

  test("an image Teams keeps in the message links to the message in Teams", () => {
    expect(noteOf(HOSTED_IMAGE, { webUrl: MESSAGE_URL })).toBe(
      `📎 [image](${MESSAGE_URL})`,
    );
  });

  test("an image Graph keeps in a US Government cloud links to the message too, never to Graph", () => {
    for (const graph of [
      "https://graph.microsoft.us",
      "https://dod-graph.microsoft.us",
    ]) {
      expect(
        noteOf(HOSTED_IMAGE.replace("https://graph.microsoft.com", graph), {
          webUrl: MESSAGE_URL,
        }),
      ).toBe(`📎 [image](${MESSAGE_URL})`);
    }
  });

  test("without the message's own link, it is named, and links nowhere", () => {
    expect(noteOf(HOSTED_IMAGE)).toBe("(image)");
    // A link that is not the message's in Teams is not followed.
    expect(
      noteOf(HOSTED_IMAGE, {
        webUrl: "https://teams.microsoft.com.evil.example/l/message/1",
      }),
    ).toBe("(image)");
  });

  test("an image on the web links to it, by its alt text", () => {
    expect(
      noteOf(
        '<p>Graph: <img src="https://grafana.example.com/render/1.png" alt="CPU at 97%"></p>',
      ),
    ).toBe("Graph: 📎 [CPU at 97%](https://grafana.example.com/render/1.png)");
  });

  test("a public note leaves the images and files out", () => {
    expect(
      noteOf(`<p>Graph:</p>${HOSTED_IMAGE}`, {
        webUrl: MESSAGE_URL,
        withoutAttachments: true,
      }),
    ).toBe("Graph:");
  });

  test("files, a quoted message and a card are read from the attachments", () => {
    const message: JSONObject = graphMessage({
      content:
        '<p>Logs attached</p><attachment id="f1"></attachment><attachment id="q1"></attachment><attachment id="c1"></attachment>',
      attachments: [
        {
          id: "f1",
          contentType: "reference",
          contentUrl:
            "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/api.log",
          name: "api.log",
        },
        { id: "f2", contentType: "reference", name: "no-link.txt" },
        {
          id: "q1",
          contentType: "messageReference",
          content: JSON.stringify({
            messageId: "1699999999999",
            messagePreview: "Is the DB back?",
            messageSender: { user: { displayName: "Jane Doe" } },
          }),
        },
        {
          id: "c1",
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify({
            type: "AdaptiveCard",
            body: [
              { type: "TextBlock", text: "Deploy <b>#4521</b>" },
              {
                type: "Container",
                items: [
                  {
                    type: "FactSet",
                    facts: [{ title: "Link:", value: "<@U0123ABC>" }],
                  },
                  {
                    type: "RichTextBlock",
                    inlines: [{ type: "TextRun", text: "# rich" }, " text"],
                  },
                ],
              },
            ],
          }),
        },
        {
          id: "bad",
          contentType: "application/vnd.microsoft.card.adaptive",
          content: "{not json",
        },
      ],
    });

    expect(
      ChatMessageMarkdown.toMarkdown(
        MicrosoftTeamsMessageReader.read(message),
      ).toString(),
    ).toBe(
      [
        "Logs attached",
        "",
        "📎 [api.log](https://contoso.sharepoint.com/sites/ops/Shared%20Documents/api.log)",
        "",
        "📎 no-link.txt",
        "",
        "> **Jane Doe**  ",
        "> Is the DB back?",
        "",
        `Deploy \\<b>#4521\\</b>  `,
        `Link: \\<${WORD_JOINER}@U0123ABC>  `,
        "\\# rich text",
      ].join("\n"),
    );
  });
});

describe("MicrosoftTeamsMessageReader: what the plain-text reader was held to", () => {
  const markdownOfMessage: (message: JSONObject) => string = (
    message: JSONObject,
  ): string => {
    return ChatMessageMarkdown.toMarkdown(
      MicrosoftTeamsMessageReader.read(message),
    ).toString();
  };

  const plainTextOfHtml: (html: string) => string = (html: string): string => {
    return ChatMessageMarkdown.toPlainText({
      blocks: MicrosoftTeamsMessageReader.readHtml(html, null),
    });
  };

  test("paragraphs, line breaks, mentions and a list", () => {
    expect(
      noteOf(
        '<p>Failed over to <at id="0">DB Replica</at>&nbsp;at 12:03</p><p>Next:<br>check lag</p><ul><li>one</li><li>two</li></ul>',
      ),
    ).toBe(
      "Failed over to @DB Replica at 12:03\n\nNext:  \ncheck lag\n\n- one\n- two",
    );
  });

  test("entities are read once: &amp;lt; stays &lt;", () => {
    expect(
      plainTextOfHtml(
        "a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &apos;e&apos; &#128204; &#x1F4E3; &amp;lt;",
      ),
    ).toBe(`a <b> & "c" 'd' 'e' 📌 📣 &lt;`);
  });

  test("blank lines between blocks are one, and the ends are trimmed", () => {
    expect(noteOf("<div>\n\n<p>one</p>   \n\n\n\n<p>two</p></div>")).toBe(
      "one\n\ntwo",
    );
  });

  test("a number that is no character reads as a browser shows it, never thrown", () => {
    // Past the last code point, half a surrogate pair, nothing: "�".
    expect(plainTextOfHtml("x&#9999999;y&#xD800;z&#0;")).toBe("x�y�z�");
    // Longer than any reference is: text, as written.
    expect(plainTextOfHtml("x&#99999999;y")).toBe("x&#99999999;y");
  });

  test("a plain-text body is its text, a '<' in it never a tag", () => {
    expect(
      markdownOfMessage(
        graphMessage({
          contentType: "text",
          content: "  a <b>literal</b> text  ",
        }),
      ),
    ).toBe("a \\<b>literal\\</b> text");
    expect(
      markdownOfMessage(
        graphMessage({ contentType: "text", content: "  plain words only  " }),
      ),
    ).toBe("plain words only");
  });

  test("a card message - OneUptime's own posts - is read from the card", () => {
    const card: JSONObject = {
      type: "AdaptiveCard",
      body: [
        { type: "TextBlock", text: "Incident #42 acknowledged" },
        {
          type: "Container",
          items: [
            {
              type: "ColumnSet",
              columns: [
                {
                  type: "Column",
                  items: [{ type: "TextBlock", text: "  by Jane  " }],
                },
              ],
            },
          ],
        },
        {
          type: "FactSet",
          facts: [
            { title: "Severity:", value: "SEV1" },
            { title: "", value: "Only value" },
            { title: "", value: "" },
          ],
        },
        {
          type: "RichTextBlock",
          inlines: ["Rich ", { type: "TextRun", text: "text" }],
        },
        { type: "Image", url: "https://x/y.png" },
      ],
    };

    expect(
      markdownOfMessage(
        graphMessage({
          content: '<attachment id="card-1"></attachment>',
          attachments: [
            {
              id: "card-1",
              contentType: "application/vnd.microsoft.card.adaptive",
              content: JSON.stringify(card),
            },
          ],
        }),
      ),
    ).toBe(
      "Incident #42 acknowledged  \nby Jane  \nSeverity: SEV1  \nOnly value  \nRich text",
    );
  });

  test("text, a card and a file are all kept", () => {
    expect(
      markdownOfMessage(
        graphMessage({
          content: 'Look at this <attachment id="c"></attachment>',
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                type: "AdaptiveCard",
                body: [{ type: "TextBlock", text: "Card text" }],
              },
            },
            {
              contentType: "reference",
              contentUrl: "https://sharepoint.example/file.docx",
            },
          ],
        }),
      ),
    ).toBe(
      "Look at this\n\nCard text\n\n📎 [file](https://sharepoint.example/file.docx)",
    );
  });

  test("a malformed card is left out; a message with no body is empty", () => {
    expect(
      markdownOfMessage(
        graphMessage({
          content: "",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: "{not json",
            },
          ],
        }),
      ),
    ).toBe("");
    expect(markdownOfMessage({ id: "1" })).toBe("");
    expect(MicrosoftTeamsMessageReader.readHtml("", null)).toEqual([]);
  });
});

describe("MicrosoftTeamsMessageReader: who wrote it, when, and where it is", () => {
  test("a person: their Entra id and name; an app: its name", () => {
    expect(
      MicrosoftTeamsMessageReader.getAuthor(graphMessage({ content: "x" })),
    ).toEqual({ teamsUserId: "aad-aidil", name: "Aidil Rahman" });
    expect(
      MicrosoftTeamsMessageReader.getAuthor({
        from: { application: { id: "app", displayName: "Datadog" } },
      }),
    ).toEqual({ name: "Datadog", isApp: true });
    expect(
      MicrosoftTeamsMessageReader.getAuthor({ from: { application: {} } }),
    ).toEqual({ isApp: true });
    expect(MicrosoftTeamsMessageReader.getAuthor({ from: null })).toEqual({});
    expect(MicrosoftTeamsMessageReader.getAuthor(null)).toEqual({});
  });

  test("posted at its createdDateTime; no time when Graph gave none", () => {
    expect(
      MicrosoftTeamsMessageReader.getPostedAt(
        graphMessage({ content: "x" }),
      )!.toISOString(),
    ).toBe("2026-10-08T10:17:00.123Z");
    expect(MicrosoftTeamsMessageReader.getPostedAt({})).toBeNull();
    expect(
      MicrosoftTeamsMessageReader.getPostedAt({ createdDateTime: "soon" }),
    ).toBeNull();
    expect(MicrosoftTeamsMessageReader.getPostedAt(null)).toBeNull();
  });

  test("its link is its webUrl, only on Teams' own site", () => {
    expect(
      MicrosoftTeamsMessageReader.getMessageUrl({ webUrl: MESSAGE_URL }),
    ).toBe(MESSAGE_URL);

    for (const webUrl of [
      "http://teams.microsoft.com/l/message/1",
      "https://teams.microsoft.com.evil.example/l/message/1",
      "https://evil.example/?teams.microsoft.com",
      "javascript:alert(1)",
      "",
    ]) {
      expect(
        MicrosoftTeamsMessageReader.getMessageUrl({ webUrl: webUrl }),
      ).toBeNull();
    }
  });
});

/*
 * Attachment elements were taken out with
 * /<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, which starts again from
 * every place a match could start: attachment start tags that no end tag
 * follows took time that grew with the square of their length. It is a loop
 * now (withoutAttachmentElements). The old pattern is the oracle here, on
 * short texts of every shape, where it is quick: the loop takes out exactly
 * what it took out.
 */
describe("MicrosoftTeamsMessageReader: in one pass", () => {
  const OLD_ATTACHMENT_ELEMENT: RegExp =
    /<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi;

  test("attachment elements go, exactly as the attachment pattern took them out", () => {
    const texts: Array<string> = [
      '<p>See the card</p><attachment id="74d20c7f"></attachment>',
      '<attachment id="1">card</attachment><p>x</p><attachment id="2"></attachment>',
      '<ATTACHMENT id="1"></Attachment>after',
      "<attachments>not one</attachments>",
      "<attachment-x>not one</attachment>",
      // A start tag ends at its first ">", quoted or not.
      '<attachment id="a>b">x</attachment>y',
      "<attachment </attachment> >x</attachment>y",
      "<attachment>never closed",
      "<attachment with no end",
      "a</attachment>b<attachment>c</attachment>d",
      ...generatedTexts(20000, 2718, [
        "<attachment",
        "<ATTACHMENT",
        "<Attachment ",
        "<attachments",
        "<attachment_",
        "<attachment-x",
        "</attachment>",
        "</ATTACHMENT>",
        "</attachment >",
        "<attachment>",
        ">",
        "<",
        "/",
        "x",
        " ",
        "\n",
        'id="1"',
        '"',
        "<p>",
      ]),
    ];

    expect(new Set(texts).size).toBeGreaterThan(17000);
    expect(
      texts.filter((html: string): boolean => {
        return (
          withoutAttachmentElements(html) !==
          html.replace(OLD_ATTACHMENT_ELEMENT, "")
        );
      }),
    ).toEqual([]);
  });

  // Far more than a Teams message holds, so time that grows with the square shows.
  const SIZE: number = 400 * 1000;
  const LIMIT_IN_MS: number = 2000;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  test.each([
    ["spaces that no line break ends", `<p>${repeatTo(" ")}x</p>`],
    ["tabs and spaces", `<p>${repeatTo("\t ")}x</p>`],
    ["non-breaking spaces", `<p>${repeatTo("&nbsp;")}x</p>`],
    ["spaces before line breaks", repeatTo("  \n")],
    [
      "attachment start tags that no end tag follows",
      repeatTo('<attachment id="1">'),
    ],
    ["attachment start tags with no '>'", repeatTo("<attachment ")],
    ["attachment elements", repeatTo('<attachment id="1"></attachment>')],
    ["ampersands", repeatTo("&")],
    ["entities that never end", repeatTo("&#x1")],
    ["entities", repeatTo("&lt;&amp;&#128077;")],
    ["angle brackets", repeatTo("<")],
    ["tags", repeatTo("<b>x</b>")],
    ["unclosed bold", repeatTo("<b>x")],
    ["links", repeatTo('<a href="https://x.example/a">a</a> ')],
    ["unclosed links", repeatTo('<a href="https://x.example/a">a')],
    ["images", repeatTo('<img src="https://x.example/a.png" alt="a">')],
    ["mentions", repeatTo('<at id="0">Jane</at> ')],
    ["nested lists", repeatTo("<ul><li>a")],
    ["list items", repeatTo("<li>a</li>")],
    ["quotes", repeatTo("<blockquote>a")],
    ["code blocks", repeatTo("<pre>a</pre>")],
    ["line breaks", repeatTo("a<br>")],
    ["table cells", repeatTo("<td>a</td>")],
    ["attribute quotes", `<p title="${repeatTo("'")}">x</p>`],
  ])(
    "a message of %s is read and written at once",
    (_shape: string, html: string) => {
      // The fastest of a few attempts counts: one can stall in a busy run.
      const read: FastestRun<ChatMessageContent> = fastestRun({
        run: (): ChatMessageContent => {
          return MicrosoftTeamsMessageReader.read(
            graphMessage({ content: html, webUrl: MESSAGE_URL }),
          );
        },
        limitInMs: LIMIT_IN_MS,
      });

      const written: FastestRun<string> = fastestRun({
        run: (): string => {
          return ChatMessageMarkdown.toMarkdown(read.result).toString();
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect({
        readInMs: read.inMs < LIMIT_IN_MS,
        writtenInMs: written.inMs < LIMIT_IN_MS,
      }).toEqual({ readInMs: true, writtenInMs: true });
    },
  );

  test("a card nested deeper than the call stack is read, not thrown", () => {
    let card: JSONObject = { type: "TextBlock", text: "deep" };

    for (let depth: number = 0; depth < 20000; depth++) {
      card = { type: "Container", items: [card] };
    }

    expect(MicrosoftTeamsMessageReader.getAdaptiveCardLines(card)).toEqual([
      "deep",
    ]);
  });
});
