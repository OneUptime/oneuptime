import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: { text: jest.fn(), attachment: jest.fn() },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: { getMembers: jest.fn(), getPagedMembers: jest.fn() },
  };
});

import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsReactionNoteSync, {
  MicrosoftTeamsReactionOutcome,
  MicrosoftTeamsWatchedChannel,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import { Token, marked } from "marked";

/*
 * A Microsoft Teams message somebody pins (📌) or megaphones (📣) becomes a
 * note: Markdown that goes to the dashboard, to the status page and
 * subscribers' email when it is public, and as a feed item to the project's
 * Slack and Teams channels. Graph hands the message over as HTML.
 *
 * htmlToText took tags out with one pass of /<[^>]*>/, read entities after
 * that, and the note was saved as it came out. So an unclosed tag ("<img
 * src=x onerror=..." with no ">") was saved as it came in, a ">" inside a
 * quoted attribute value or a comment ended the tag and kept the rest as
 * text, and text that was "&lt;script&gt;" in the HTML - or became so once a
 * tag inside it was taken out - was saved as "<script>".
 *
 * Now every tag and comment is read with replaceHtmlMarkup (one walk that
 * ends a tag only at a ">" outside a quoted value and leaves no "<" of the
 * HTML) - line breaks, list items, mentions and the ends of blocks become
 * text as before - entities are read once after that, and the text is
 * placed in the note as text a stranger typed (FeedMarkdown.reportedValue,
 * as a form's answers are): each "<" that whitespace does not follow, each
 * "![" and each "]" a link goes on from gets an invisible word joiner. The
 * note reads as the message did in Teams, and no renderer reads a tag, a
 * comment, an autolink, a chat mention, an image or a link from it.
 *
 * A message whose text holds none of those is saved exactly as before: the
 * ordinary messages below are each pinned to the note the code before this
 * change saved for them, quirks and all - this change reads markup out
 * completely and changes nothing else.
 */

// A "<" that starts something: what no note may hold.
const TAG_START: RegExp = /<(?![\s⁠])/;

function graphMessage(data: {
  content: string;
  contentType?: string;
  attachments?: Array<JSONObject>;
}): JSONObject {
  return {
    id: "1700000000200",
    replyToId: null,
    messageType: "message",
    deletedDateTime: null,
    body: {
      contentType: data.contentType || "html",
      content: data.content,
    },
    attachments: data.attachments || [],
    reactions: [],
  };
}

function noteTextOf(html: string): string {
  return MicrosoftTeamsReactionNoteSync.getMessageText(
    graphMessage({ content: html }),
  );
}

function withoutWordJoiners(text: string): string {
  return text.split(WORD_JOINER).join("");
}

// Every token marked reads in a note, nested ones included.
function markdownTokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
}

/*
 * Messages people send in an incident channel, as Graph returns them, and
 * the note each was saved as before this change. It is still the note.
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
    "Root cause: expired certificate on api-gateway maybe DNS",
  ],
  [
    "a link",
    '<p>Runbook: <a href="https://wiki.example.com/runbooks/db" rel="noreferrer noopener" target="_blank" title="https://wiki.example.com/runbooks/db">https://wiki.example.com/runbooks/db</a></p>',
    "Runbook: https://wiki.example.com/runbooks/db",
  ],
  [
    "bulleted and numbered lists",
    "<ul><li>Drained node-3</li><li>Rolled back <code>v2.4.1</code></li></ul><ol><li>Watch lag</li><li>Close the incident</li></ol>",
    "- Drained node-3\n- Rolled back v2.4.1\n- Watch lag\n- Close the incident",
  ],
  [
    "a code block",
    '<pre class="language-bash"><code>kubectl get pods -n prod\nkubectl logs api-7d9 --tail=50</code></pre>',
    "kubectl get pods -n prod\nkubectl logs api-7d9 --tail=50",
  ],
  [
    "a Teams code block",
    '<codeblock class=""><code>SELECT count(*) FROM orders WHERE status = &#39;stuck&#39;;</code></codeblock>',
    "SELECT count(*) FROM orders WHERE status = 'stuck';",
  ],
  [
    "inline code holding an entity",
    "<p>Set <code>max_connections &gt; 200</code> and restart</p>",
    "Set max_connections > 200 and restart",
  ],
  [
    "an emoji element (its picture is not text) and emoji typed as text",
    '<p>Fixed <emoji id="1f44d_thumbsup" alt="&#128077;" title="Thumbs up"></emoji> thanks 🔥🚒</p>',
    "Fixed  thanks 🔥🚒",
  ],
  [
    "a pasted image",
    '<div><div>\n<div><span><img height="63" src="https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m/hostedContents/aWQ9/$value" width="67" style="vertical-align:bottom; width:67px; height:63px"></span>\n\n</div>\n\n\n</div>\n</div>',
    "",
  ],
  [
    "a reply quoting another message",
    '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1700000000000"><strong itemprop="mri" itemid="8:orgid:abc">Jane Doe</strong><span itemprop="time" itemid="1700000000000"></span><p itemprop="preview">Is the DB back?</p></blockquote><p>Yes, all green.</p>',
    "Jane DoeIs the DB back?\n\nYes, all green.",
  ],
  [
    "a table",
    "<table><tbody><tr><td>p99</td><td>420 ms</td></tr><tr><td>errors</td><td>0.2%</td></tr></tbody></table>",
    "p99420 ms\nerrors0.2%",
  ],
  [
    "line breaks",
    "<p>Next steps:<br>1. watch lag<br/>2. close incident<br />3. postmortem</p>",
    "Next steps:\n1. watch lag\n2. close incident\n3. postmortem",
  ],
  [
    "entities, a '<' before a space among them",
    "<p>Tom &amp; Jerry said &quot;it&#39;s fixed&quot;, p99 &gt; 2s and a &lt; b</p>",
    'Tom & Jerry said "it\'s fixed", p99 > 2s and a < b',
  ],
  [
    "an entity written out in the message",
    "<p>literally &amp;lt;tag&amp;gt; in a log line</p>",
    "literally &lt;tag&gt; in a log line",
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
    "Status\nImpact\nNone for customers",
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
    "latency < 200 ms is fine, > 2 s pages someone",
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
    "Deploy #4521 is out\n\nMonitoring now",
  ],
];

/*
 * Messages whose HTML a single pass of a tag pattern reads into markup, or
 * that hold markup-shaped text, and the note each is saved as now.
 */
const MARKUP_MESSAGES: Array<[string, string, string]> = [
  [
    "an unclosed tag",
    "<p>hi</p><img src=x onerror=alert(1)",
    "hi\nimg src=x onerror=alert(1)",
  ],
  [
    "a tag inside a tag's name",
    "<scr<script>ipt>alert(1)</script>",
    "ipt>alert(1)",
  ],
  ["an overlapping comment", "<!<!---->--ok", "--ok"],
  [
    "a comment holding a tag and '>'",
    "<p>a<!-- <img src=x> > b -->c</p>",
    "ac",
  ],
  [
    "an attribute value holding '>'",
    '<p><img alt="a > b" src="https://x/y.png">after</p>',
    "after",
  ],
  [
    "a tag rebuilt once a tag inside it is out",
    "<p>&lt;scr<b></b>ipt&gt;alert(1)&lt;/script&gt;</p>",
    `<${WORD_JOINER}script>alert(1)<${WORD_JOINER}/script>`,
  ],
  [
    "a typed tag",
    "<p>use &lt;b&gt;bold&lt;/b&gt; in the template</p>",
    `use <${WORD_JOINER}b>bold<${WORD_JOINER}/b> in the template`,
  ],
  [
    "a typed script element",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    `<${WORD_JOINER}script>alert(1)<${WORD_JOINER}/script>`,
  ],
  [
    "a typed tag in numeric entities",
    "<p>&#60;img src=x&#62; and &#x3c;b&#x3e;</p>",
    `<${WORD_JOINER}img src=x> and <${WORD_JOINER}b>`,
  ],
  [
    "a typed Slack mention",
    "<p>&lt;!channel&gt; heads up</p>",
    `<${WORD_JOINER}!channel> heads up`,
  ],
  [
    "a typed autolink",
    "<p>see &lt;https://status.example.com&gt;</p>",
    `see <${WORD_JOINER}https://status.example.com>`,
  ],
  [
    "comparisons written without a space",
    "<p>p99&lt;200ms and x &lt;= y</p>",
    `p99<${WORD_JOINER}200ms and x <${WORD_JOINER}= y`,
  ],
  [
    "an image typed as Markdown",
    "<p>see ![chart](https://tracker.example/p.png)</p>",
    `see !${WORD_JOINER}[chart]${WORD_JOINER}(https://tracker.example/p.png)`,
  ],
  [
    "a link typed as Markdown",
    "<p>[Reset your password](https://login.example/reset)</p>",
    `[Reset your password]${WORD_JOINER}(https://login.example/reset)`,
  ],
  [
    "a link definition typed as Markdown",
    "<p>[logo]: https://tracker.example/p.png</p>",
    `[logo]${WORD_JOINER}: https://tracker.example/p.png`,
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
    "one\ntwo",
  ],
  [
    "an end tag with a space before its '>'",
    "<p>first</p ><p>second</p >",
    "first\nsecond",
  ],
];

describe("a Teams message saved as a note", () => {
  test.each(ORDINARY_MESSAGES)(
    "%s is saved as before",
    (_case: string, html: string, note: string) => {
      expect(noteTextOf(html)).toBe(note);
      expect(noteTextOf(html)).not.toContain(WORD_JOINER);
    },
  );

  test.each(MARKUP_MESSAGES)(
    "%s is saved as plain text",
    (_case: string, html: string, note: string) => {
      const text: string = noteTextOf(html);

      expect(text).toBe(note);
      expect(text).not.toMatch(TAG_START);
    },
  );

  test("no note holds markup marked reads, whatever the message", () => {
    /*
     * HTML, an image, a link written in brackets or angle brackets. A bare
     * address is still a link, as it is wherever somebody types one.
     */
    for (const [, html] of [...ORDINARY_MESSAGES, ...MARKUP_MESSAGES]) {
      const markup: Array<string> = markdownTokensOf(noteTextOf(html))
        .filter((token: Token): boolean => {
          return (
            token.type === "html" ||
            token.type === "image" ||
            (token.type === "link" &&
              (token.raw.startsWith("<") || token.raw.startsWith("[")))
          );
        })
        .map((token: Token): string => {
          return token.raw;
        });

      expect(markup).toEqual([]);
    }
  });

  test("as typed, the Markdown in those messages would be read as markup", () => {
    // So the test above is not passing on text Markdown leaves alone anyway.
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

  test("text typed as markup reads exactly as typed", () => {
    expect(
      withoutWordJoiners(
        noteTextOf("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"),
      ),
    ).toBe("<script>alert(1)</script>");
    expect(
      withoutWordJoiners(noteTextOf("<p>p99&lt;200ms and x &lt;= y</p>")),
    ).toBe("p99<200ms and x <= y");
  });

  test("a plain-text body and a card are read the same way", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          contentType: "text",
          content: "<img src=x onerror=alert(1)> and <!here>",
        }),
      ),
    ).toBe(
      `<${WORD_JOINER}img src=x onerror=alert(1)> and <${WORD_JOINER}!here>`,
    );

    const card: JSONObject = {
      type: "AdaptiveCard",
      body: [
        { type: "TextBlock", text: "Deploy <b>#4521</b>" },
        { type: "FactSet", facts: [{ title: "Link:", value: "<@U0123ABC>" }] },
      ],
    };

    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          content: '<attachment id="c"></attachment>',
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: JSON.stringify(card),
            },
          ],
        }),
      ),
    ).toBe(
      `Deploy <${WORD_JOINER}b>#4521<${WORD_JOINER}/b>\nLink: <${WORD_JOINER}@U0123ABC>`,
    );
  });
});

describe("MicrosoftTeamsReactionNoteSync.htmlToText", () => {
  test("leaves none of the HTML's markup, whatever the HTML", () => {
    for (const html of [
      "<scr<script>ipt>alert(1)</script>",
      "<<script>script>alert(1)",
      "<script<script>>alert(1)",
      "<p>x</p><script",
      "<<<<",
      "<!-- <script> -->",
      "<!<!---->--",
      '<img alt="<script>" src=x>',
      "<p>a<!-- x > y -->b</p>",
      "<scr<br>ipt>alert(1)",
      "<<li>script>",
      '<at id="0"><script>x</script></at>',
    ]) {
      expect(MicrosoftTeamsReactionNoteSync.htmlToText(html)).not.toContain(
        "<",
      );
    }
  });

  test("keeps the text it always kept: lines, list items and mentions", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.htmlToText(
        '<p>Failed over to <at id="0">DB Replica</at>&nbsp;at 12:03</p><p>Next:<br>check lag</p><ul><li>one</li><li>two</li></ul>',
      ),
    ).toBe(
      "Failed over to @DB Replica at 12:03\nNext:\ncheck lag\n- one\n- two",
    );
  });

  test("reads entities once, after the markup is out", () => {
    // Text that was an entity is text: it is never a tag taken out or kept.
    expect(
      MicrosoftTeamsReactionNoteSync.htmlToText("<p>&lt;b&gt;x&lt;/b&gt;</p>"),
    ).toBe("<b>x</b>");
    expect(
      MicrosoftTeamsReactionNoteSync.htmlToText("<p>&amp;lt;b&amp;gt;</p>"),
    ).toBe("&lt;b&gt;");
  });
});

describe("pinning a Teams message saves plain text", () => {
  const projectId: ObjectID = ObjectID.generate();
  const incidentId: ObjectID = ObjectID.generate();
  const memberProps: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: projectId,
  };
  const NOW: Date = new Date("2026-10-11T12:00:00.000Z");

  const channel: MicrosoftTeamsWatchedChannel = {
    resource: {
      resourceType: WorkspaceNoteResourceType.Incident,
      resourceId: incidentId,
      projectId: projectId,
    },
    channelId: "19:incident-42@thread.tacv2",
    teamId: "team-graph-id",
  };

  let saveSpy: jest.SpyInstance;

  beforeEach((): void => {
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue();
    jest.spyOn(WorkspaceReactionNote, "hasNote").mockResolvedValue(false);

    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.userId = memberProps.userId!;
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockResolvedValue(memberProps);
    saveSpy = jest
      .spyOn(WorkspaceReactionNote, "saveNote")
      .mockResolvedValue(WorkspaceNoteSaveResult.Saved);
    jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
      label: "Incident #42",
      link: URL.fromString("https://oneuptime.test/incidents/42"),
    });
    jest
      .spyOn(MicrosoftTeamsUtil, "sendTextReplyToChannelThread")
      .mockResolvedValue();
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "an unclosed tag",
      "<p>Rolled back</p><img src=x onerror=alert(1)",
      "Rolled back\nimg src=x onerror=alert(1)",
    ],
    [
      "a tag rebuilt once a tag inside it is out",
      "<p>&lt;scr<b></b>ipt&gt;alert(1)&lt;/script&gt;</p>",
      `<${WORD_JOINER}script>alert(1)<${WORD_JOINER}/script>`,
    ],
    [
      "a typed Slack mention",
      "<p>&lt;!channel&gt; DB is back</p>",
      `<${WORD_JOINER}!channel> DB is back`,
    ],
    [
      "an ordinary message",
      '<p><at id="0">Jane</at>&nbsp;restarted the primary DB</p>',
      "@Jane restarted the primary DB",
    ],
  ])(
    "%s is saved as the note's text",
    async (_case: string, html: string, note: string) => {
      const outcome: MicrosoftTeamsReactionOutcome =
        await MicrosoftTeamsReactionNoteSync.processReaction({
          channel: channel,
          reaction: {
            message: graphMessage({ content: html }),
            messageId: "1700000000200",
            threadId: "1700000000100",
            noteType: WorkspaceNoteType.Public,
            reactingUserId: "aad-jane",
            reactingUserName: "Jane Doe",
            reactedAt: new Date(NOW.getTime() - 60 * 1000),
          },
          now: NOW,
        });

      expect(outcome).toBe(MicrosoftTeamsReactionOutcome.Saved);
      expect(saveSpy).toHaveBeenCalledTimes(1);

      const saved: string = saveSpy.mock.calls[0]![0].note as string;

      expect(saved).toBe(note);
      expect(saved).not.toMatch(TAG_START);
    },
  );
});
