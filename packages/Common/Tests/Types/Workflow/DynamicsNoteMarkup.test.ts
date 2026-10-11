/*
 * The Dynamics 365 -> OneUptime note templates copy each note somebody adds
 * to a linked case onto the incident or alert as a private note (step
 * read-note-1). A note written in Dynamics 365's rich-text editor is HTML;
 * the person who wrote it - an agent, or a customer through a portal - saw
 * it as text. The private note is Markdown: the dashboard renders it, and it
 * is posted as a feed item to the project's Slack and Microsoft Teams
 * channels.
 *
 * The script took tags out with one pass of /<[^>]*>/ and read entities
 * after that. So an unclosed tag stayed as it came, a ">" inside a quoted
 * attribute value or a comment ended the tag early and left the rest as
 * text, and text typed as "&lt;img ...&gt;" - which the editor stores
 * encoded - came out as an "<img ...>" tag in the note. Typed Markdown (an
 * image, a link, a chat mention, a diagram) went in as it was.
 *
 * A script runs in the workflow sandbox, which imports nothing, so it
 * carries its own copies of what OneUptime's code reads and places outside
 * text with. These tests run the template's real script in that sandbox and
 * hold the copies to the originals, on the same cases:
 *
 *   - its walk reads markup exactly as replaceHtmlMarkup (Common/Types/
 *     HtmlMarkup) does when it reads "<" as a browser does
 *     (lessThanAsText): a note an integration wrote can hold a "<" that is
 *     text, "latency < 200ms"; and, as a browser does, it reads a script or
 *     a style element whole (rawTextElements). The walk is the section the
 *     create-from-case scripts carry too (DynamicsCaseDescription.test.ts);
 *   - a note with no tag is plain text: only its entities are read;
 *   - entities are read once, after the walk;
 *   - what came from Dynamics 365 is placed with asWritten, which every
 *     Jira and Dynamics 365 script carries in its helper block and
 *     TemplateOutsideText.test.ts holds to FeedMarkdown.reportedValue: it
 *     reads as written, and nothing in it acts;
 *   - ordinary notes - paragraphs, line breaks, lists, tables, headings,
 *     links, quotes, entities, other scripts - are saved exactly as before;
 *   - a long note is read in time that grows with its length alone.
 */

import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { replaceHtmlMarkup } from "../../../Types/HtmlMarkup";
import { JSONObject } from "../../../Types/JSON";
import { ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER } from "../../../Types/Workflow/Templates";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../Utils/Markdown/DashboardMarkdownRenderer";
import {
  SINGLE_PASS_LEFTOVERS,
  WELL_FORMED_MARKUP,
  generatedTexts,
} from "../HtmlMarkupCases";
import {
  CASE_ID,
  CASE_NUMBER,
  DYNAMICS_URL,
  LINK_COLUMN,
  NoteRowProps,
  noteRow,
  runDynamicsScript,
} from "./DynamicsTemplateFixtures";
import {
  ALERT_ID,
  INCIDENT_ID,
  quoted,
  scriptOf,
} from "./JiraTemplateFixtures";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { Token, marked } from "marked";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

interface NoteKind {
  noun: string;
  templateId: string;
  link: string;
  idKey: string;
  id: string;
}

const INCIDENT: NoteKind = {
  noun: "incident",
  templateId: "dynamics-case-note-to-incident-private-note",
  link: `oneuptime-incident-${INCIDENT_ID}`,
  idKey: "incidentId",
  id: INCIDENT_ID,
};

const ALERT: NoteKind = {
  noun: "alert",
  templateId: "dynamics-case-note-to-alert-private-note",
  link: `oneuptime-alert-${ALERT_ID}`,
  idKey: "alertId",
  id: ALERT_ID,
};

const KINDS: Array<[string, NoteKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

const STEP: string = "read-note-1";

// A line break with more space in it than any is written with.
const LONG_LINE_BREAK: string = `a<br${" ".repeat(300)}>b`;
const CASE_URL: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;
const HEADER: string = `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case [${CASE_NUMBER}](${CASE_URL}).`;

// Where the script's sections start.
const READING_SECTION: string = "// ---- Reading rich text ----";
const STEP_SECTION: string = "// ---- Reading the note ----";

// A "<" that starts something: what no placed text may hold.
const TAG_START: RegExp = /<(?![\s\u2060])/;
// A "<" that starts markup, as a browser reads one: what no text read out of HTML may hold.
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;
const LESS_THAN_RUN: RegExp = /<+/g;
const STARTS_MARKUP: RegExp = /[A-Za-z/!?]/;
const AS_A_BROWSER_READS_IT: {
  lessThanAsText: boolean;
  rawTextElements: boolean;
} = {
  lessThanAsText: true,
  rawTextElements: true,
};
// The default reading of "<", with script and style elements read whole.
const SCRIPT_AND_STYLE_WHOLE: { rawTextElements: boolean } = {
  rawTextElements: true,
};
const WORD_JOINER_RUN: RegExp = /\u2060/g;
const SLACK_MENTION: RegExp = /<[!@#][A-Za-z0-9]/;
const DASHBOARD_IMAGE: RegExp = /<img/;
const DASHBOARD_DIAGRAM: RegExp = /language-mermaid/i;
const DASHBOARD_ANCHOR: RegExp = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g;

function withoutJoiners(text: string): string {
  return text.replace(WORD_JOINER_RUN, "");
}

// The text of an attribute value or of an element, as a reader sees it.
function unescapedHtml(text: string): string {
  return text
    .split("&quot;")
    .join('"')
    .split("&#39;")
    .join("'")
    .split("&lt;")
    .join("<")
    .split("&gt;")
    .join(">")
    .split("&amp;")
    .join("&");
}

/*
 * Whether a link the dashboard draws shows where it goes: the link to the
 * case, under the case's number, or an address made a link, under its own
 * words - as every renderer makes one a person types.
 */
function showsWhereItGoes(escapedHref: string, escapedWords: string): boolean {
  const href: string = unescapedHtml(escapedHref);
  const words: string = unescapedHtml(escapedWords);

  if (href === CASE_URL) {
    return words === CASE_NUMBER;
  }

  let address: string = href;

  try {
    address = decodeURI(href);
  } catch {
    // An address that does not decode is compared as it is.
  }

  return words === address;
}

/*
 * The script's helpers run on every case at once, in one sandbox run: the
 * step's own logic is swapped for a few lines that call them.
 */
const HARNESS: string = [
  STEP_SECTION,
  "const cases = Array.isArray(args.cases) ? args.cases : [];",
  "return {",
  "  walked: cases.map((html) => replaceMarkup(html, (markup) => '[' + markup + ']')),",
  "  removed: cases.map((html) => replaceMarkup(html, () => '')),",
  "  text: cases.map((html) => htmlToText(html)),",
  "};",
].join("\n");

interface ScriptReadings {
  walked: Array<string>;
  removed: Array<string>;
  text: Array<string>;
}

async function readWithTheScript(
  cases: Array<string>,
): Promise<ScriptReadings> {
  return (await runDynamicsScript({
    templateId: INCIDENT.templateId,
    componentId: STEP,
    args: { cases: cases },
    editCode: (code: string): string => {
      return code.slice(0, code.indexOf(STEP_SECTION)) + HARNESS;
    },
  })) as unknown as ScriptReadings;
}

// What read-note-1 makes of a note on a case linked to the record.
async function noteFor(
  kind: NoteKind,
  props: NoteRowProps,
): Promise<JSONObject> {
  return await runDynamicsScript({
    templateId: kind.templateId,
    componentId: STEP,
    args: {
      dynamicsUrl: DYNAMICS_URL,
      linkColumn: LINK_COLUMN,
      note: quoted(noteRow({ link: kind.link, ...props })),
    },
  });
}

// The text of the note after its header line and its title.
function textPartOf(result: JSONObject): string {
  return String(result["note"]).split("\n\n").slice(2).join("\n\n");
}

/*
 * Notes as Dynamics 365's rich-text editor stores them, and the text each
 * was saved as before this change. It is still the text.
 */
const CK_STYLE: string =
  "--list-bullet-0:disc;--list-bullet-1:circle;--list-bullet-2:square;--list-multiLevel-0:decimal;--list-multiLevel-1:lower-alpha;--list-multiLevel-2:lower-roman;font-family:Segoe UI;font-size:11pt;";

const richText: (inner: string) => string = (inner: string): string => {
  return `<div class="ck-content" data-wrapper="true" dir="ltr" style="${CK_STYLE}">${inner}</div>`;
};

const ORDINARY_NOTES: Array<[string, string, string]> = [
  [
    "a paragraph",
    richText("<p>Customer called back.</p>"),
    "Customer called back.",
  ],
  [
    "a line break and non-breaking spaces",
    richText("<p>Line one<br>Line two&nbsp;with&nbsp;spaces</p>"),
    "Line one\nLine two with spaces",
  ],
  [
    "lists",
    richText(
      "<ul><li>Restarted the web tier</li><li>Cleared the CDN cache</li></ul><ol><li>First</li><li>Second</li></ol>",
    ),
    "Restarted the web tier\nCleared the CDN cache\nFirst\nSecond",
  ],
  [
    "a table",
    richText(
      '<figure class="table"><table><tbody><tr><td>Region</td><td>Status</td></tr><tr><td>EU</td><td>Degraded</td></tr></tbody></table></figure>',
    ),
    "RegionStatus\nEUDegraded",
  ],
  [
    "entities, and a '<' with a space after it",
    richText(
      "<p>Q&amp;A: is p99 &lt; 200 ms? &quot;Yes&quot; &#39;mostly&#39;</p>",
    ),
    "Q&A: is p99 < 200 ms? \"Yes\" 'mostly'",
  ],
  [
    "a heading, a link and bold text",
    richText(
      '<h2>Summary</h2><p>See <a href="https://status.example.com/incidents/42" target="_blank" rel="noopener noreferrer">the status page</a> for <strong>details</strong>.</p>',
    ),
    "Summary\nSee the status page for details.",
  ],
  [
    "a block quote",
    richText(
      "<blockquote><p>The checkout fails with error 500.</p></blockquote><p>Forwarded from the customer.</p>",
    ),
    "The checkout fails with error 500.\n\nForwarded from the customer.",
  ],
  [
    "the older editor's divs",
    "<div data-wrapper=\"true\" style=\"font-size:9pt;font-family:'Segoe UI','Helvetica Neue',sans-serif;\"><div>Hi team,</div><div>&nbsp;</div><div>The export is failing again.</div></div>",
    "Hi team,\n\nThe export is failing again.",
  ],
  [
    "a plain-text note written through the API",
    "Spoke to the customer.\nThey will retry at 10:30.",
    "Spoke to the customer.\nThey will retry at 10:30.",
  ],
  [
    "text pasted from Outlook, with an Office comment",
    '<p class="MsoNormal">Hello<o:p></o:p></p><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->',
    "Hello",
  ],
  [
    "each way of writing a line break",
    richText(
      "<p>Steps:</p><p>1. Open the app<br/>2. Sign in<br />3. Checkout</p>",
    ),
    "Steps:\n1. Open the app\n2. Sign in\n3. Checkout",
  ],
  [
    "inline formatting",
    richText(
      "<p><i>Italic</i>, <u>underlined</u>, <s>struck</s> and <code>code</code>.</p>",
    ),
    "Italic, underlined, struck and code.",
  ],
  [
    "other scripts and directions",
    richText(
      '<p>数据库已恢复。確認お願いします。</p><p dir="rtl">پایگاه داده دوباره در دسترس است</p>',
    ),
    "数据库已恢复。確認お願いします。\nپایگاه داده دوباره در دسترس است",
  ],
];

/*
 * Notes whose text holds markup - typed, and stored encoded, or malformed -
 * and the text each is saved as now. Without the joiners, each reads
 * exactly as typed.
 */
const MARKUP_NOTES: Array<[string, string, string]> = [
  [
    "a tag typed as text",
    richText("<p>&lt;img src=x onerror=alert(1)&gt;</p>"),
    `<${WORD_JOINER}img src=x onerror=alert(1)>`,
  ],
  [
    "a script typed as text",
    richText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"),
    `<${WORD_JOINER}script>alert(1)<${WORD_JOINER}/script>`,
  ],
  [
    "a tag typed inside a tag's name",
    richText("<p>&lt;scr&lt;script&gt;ipt&gt;</p>"),
    `<${WORD_JOINER}scr<${WORD_JOINER}script>ipt>`,
  ],
  [
    "a comment typed as text",
    richText("<p>&lt;!-- the rest is hidden --&gt; visible</p>"),
    `<${WORD_JOINER}!-- the rest is hidden --> visible`,
  ],
  [
    "a typed Slack mention",
    richText("<p>&lt;!channel&gt; please look</p>"),
    `<${WORD_JOINER}!channel> please look`,
  ],
  [
    "a typed user mention",
    richText("<p>ask &lt;@U0123ABC&gt;</p>"),
    `ask <${WORD_JOINER}@U0123ABC>`,
  ],
  [
    "a typed autolink",
    richText("<p>see &lt;https://status.example.com&gt;</p>"),
    `see <${WORD_JOINER}https://status.example.com>`,
  ],
  [
    "comparisons written without a space",
    richText("<p>p99&lt;200ms and x &lt;= y</p>"),
    `p99<${WORD_JOINER}200ms and x <${WORD_JOINER}= y`,
  ],
  [
    "an image typed as Markdown",
    richText("<p>see ![chart](https://tracker.example/p.png)</p>"),
    `see !${WORD_JOINER}[chart]${WORD_JOINER}(https://tracker.example/p.png)`,
  ],
  [
    "a link typed as Markdown",
    richText("<p>[Reset your password](https://login.example/reset)</p>"),
    `[Reset your password]${WORD_JOINER}(https://login.example/reset)`,
  ],
  [
    "a link definition typed as Markdown",
    richText("<p>[logo]: https://tracker.example/p.png</p>"),
    `[logo]${WORD_JOINER}: https://tracker.example/p.png`,
  ],
  [
    "a mermaid diagram typed as Markdown",
    richText("<p>```mermaid</p><p>graph TD; A--&gt;B</p><p>```</p>"),
    `\`\`\`${WORD_JOINER}mermaid\ngraph TD; A-->B\n\`\`\``,
  ],
  [
    "a mermaid diagram spelled with a character reference",
    richText("<p>~~~&amp;#109;ermaid</p><p>graph TD</p><p>~~~</p>"),
    `~~~${WORD_JOINER}&#109;ermaid\ngraph TD\n~~~`,
  ],
  [
    "an image whose alt text holds '>'",
    richText('<p>a <img alt="x > y" src="https://t.example/p.png">b</p>'),
    "a b",
  ],
  ["a comment holding a tag and '>'", "<p>a<!-- <b>x</b> > -->b</p>", "ab"],
  [
    "an unclosed tag",
    "<p>hello <img src=x onerror=alert(1)",
    "hello img src=x onerror=alert(1)",
  ],
  ["a tag inside a tag's name", "<p>x</p><scr<script>ipt>", "x\nipt>"],
  ["an overlapping comment", "<p>x</p><!<!---->--", "x\n--"],
  [
    "a line break whose attribute holds '>'",
    '<p>one<br class="x>y">two</p>',
    "onetwo",
  ],
];

/*
 * Notes as an integration or an email writes HTML, and the text each is
 * saved as: an element whose content a browser never reads as markup - a
 * script or a style, which it never shows, and a title or a textarea, which
 * hold text - references by number and by name, and source indented with
 * spaces, which a browser never shows either.
 */
const NAMED_ELEMENT_NOTES: Array<[string, string, string]> = [
  [
    "a style element, as Outlook on the web writes one",
    '<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style><div class="elementToProof">Restarted the pods.</div>',
    "Restarted the pods.",
  ],
  [
    "a script element holding a tag",
    "<p>Before</p><script>document.write('<p>never shown</p>');</script><p>After</p>",
    "Before\nAfter",
  ],
  [
    "upper-case names, and an end tag with a space",
    "<P>One</P><SCRIPT type=module>x()</SCRIPT ><STYLE>p{}</style>Two",
    "One\nTwo",
  ],
  [
    "a title, whose text is shown",
    "<title>Re: checkout</title>\n<p>Two customers called.</p>",
    "Re: checkout\nTwo customers called.",
  ],
  [
    "a textarea, read on its own, its tags out",
    "<textarea><b>typed</b> <script>x</textarea> after",
    "typed x after",
  ],
  ["a script that never ends: an ordinary tag", "<p>a</p><script>b", "a\nb"],
  [
    "a script inside a comment or a value starts nothing",
    '<p title="<script>">x</p><!-- <style> -->y',
    "x\ny",
  ],
  [
    "references by number and by name",
    "<p>Don&rsquo;t restart&#160;yet &#8212; see &#x201C;runbook&#x201D;</p>",
    "Don\u2019t restart yet \u2014 see \u201crunbook\u201d",
  ],
  [
    "HTML written through the API with indented lines",
    "<div>\n    <p>Restarted the pods.</p>\n    <p>Watching for errors.</p>\n</div>",
    "Restarted the pods.\n\nWatching for errors.",
  ],
  [
    "a pre element, which keeps its indentation, in HTML indented around it",
    "<div>\n  <p>Log:</p>\n  <pre>step 1\n    step 2</pre>\n</div>",
    "Log:\n\nstep 1\n    step 2",
  ],
  [
    "Windows-1252 numbers and a reference whose number writes '&'",
    "<p>Don&#146;t &#150; &#38;amp;</p>",
    "Don\u2019t \u2013 &amp;",
  ],
  [
    "a frame and what it holds",
    "<p>See</p><iframe src=x>fallback <b>text</b></iframe><noembed>n</noembed>",
    "See",
  ],
];

describe("the note script's own walk", () => {
  const generated: Array<string> = generatedTexts(20000, 2718);
  const shapes: Array<string> = [
    ...SINGLE_PASS_LEFTOVERS,
    ...WELL_FORMED_MARKUP,
    ...ORDINARY_NOTES.map((note: [string, string, string]): string => {
      return note[1];
    }),
    ...MARKUP_NOTES.map((note: [string, string, string]): string => {
      return note[1];
    }),
    "Plain <3 text, a < b",
    "<p>latency < 200ms, p99<=300</p>",
    "<p>1 < 2 <b>bold</b></p>",
    "<div>arrows <- and <-> stay</div>",
    "R&D: latency < 200ms",
    "Q&A - error rate < 1%, p99<threshold",
    "Tom &amp; Jerry <3",
    "a < b > c & d",
    LONG_LINE_BREAK,
    "a<br   >b",
    "<p>a<<!-- x > y -->b</p>",
    "<<!-- a > b -->c<br>",
    "x<<<!-- y > z -->w<br>",
    "a<<br>b",
    "ls -la  \n\n\n\nfoo & bar",
    '<?xml version="1.0"?> AT&amp;T',
    "run <?php phpinfo(); ?> to check",
  ];
  // The leftovers again, each inside a paragraph of a note's HTML.
  const leftoversInParagraphs: Array<string> = SINGLE_PASS_LEFTOVERS.map(
    (html: string): string => {
      return `<p>${html}</p>`;
    },
  );
  const cases: Array<string> = [
    ...leftoversInParagraphs,
    ...shapes,
    ...NAMED_ELEMENT_NOTES.map((note: [string, string, string]): string => {
      return note[1];
    }),
    ...generated,
  ];
  let readings: ScriptReadings;

  beforeAll(async () => {
    readings = await readWithTheScript(cases);
  });

  test("reads every tag and comment exactly where replaceHtmlMarkup does, reading '<' as a browser does", () => {
    expect(readings.walked).toHaveLength(cases.length);

    const differences: Array<string> = cases.filter(
      (html: string, index: number): boolean => {
        return (
          readings.walked[index] !==
          replaceHtmlMarkup(
            html,
            (markup: string): string => {
              return `[${markup}]`;
            },
            AS_A_BROWSER_READS_IT,
          )
        );
      },
    );

    expect(differences.slice(0, 5)).toEqual([]);
  });

  test("takes markup out exactly as replaceHtmlMarkup does, leaving no '<' that starts markup", () => {
    const differences: Array<string> = cases.filter(
      (html: string, index: number): boolean => {
        return (
          readings.removed[index] !==
          replaceHtmlMarkup(
            html,
            (): string => {
              return "";
            },
            AS_A_BROWSER_READS_IT,
          )
        );
      },
    );

    expect(differences.slice(0, 5)).toEqual([]);
    expect(
      readings.removed.filter((text: string): boolean => {
        return MARKUP_START.test(text);
      }),
    ).toEqual([]);
  });

  test("reads markup exactly as the default reading does wherever no '<' is text", () => {
    /*
     * HTML an editor writes has no "<" that is text: it writes "&lt;". On
     * such text - every "<" alone, before what starts markup - both
     * readings agree. (Before a run of "<", the default reading starts
     * markup at the run's first "<", and a browser at its last.) Both read
     * script and style elements whole.
     */
    const htmlOnly: Array<string> = cases.filter((html: string): boolean => {
      return Array.from(html.matchAll(LESS_THAN_RUN)).every(
        (run: RegExpMatchArray): boolean => {
          return (
            run[0].length === 1 &&
            STARTS_MARKUP.test(html.charAt(run.index! + run[0].length))
          );
        },
      );
    });

    expect(htmlOnly.length).toBeGreaterThan(1000);
    expect(
      htmlOnly.filter((html: string): boolean => {
        return (
          readings.removed[cases.indexOf(html)] !==
          replaceHtmlMarkup(
            html,
            (): string => {
              return "";
            },
            SCRIPT_AND_STYLE_WHOLE,
          )
        );
      }),
    ).toEqual([]);
  });

  test("reads nested, overlapping and unclosed markup in a note's HTML into text with no '<' that starts markup", () => {
    /*
     * None of these holds an entity, so a "<" in the text could only be
     * one of the HTML's.
     */
    const inParagraphs: Array<string> = readings.text.slice(
      0,
      leftoversInParagraphs.length,
    );

    expect(inParagraphs).toHaveLength(SINGLE_PASS_LEFTOVERS.length);
    expect(
      inParagraphs.filter((text: string): boolean => {
        return MARKUP_START.test(text);
      }),
    ).toEqual([]);
  });

  test("keeps a '<' in a note's HTML that a browser shows as text", () => {
    for (const [html, text] of [
      ["<p>latency < 200ms, p99<=300</p>", "latency < 200ms, p99<=300\n"],
      ["<p>1 < 2 <b>bold</b></p>", "1 < 2 bold\n"],
      ["<div>arrows <- and <-> stay</div>", "arrows <- and <-> stay\n"],
    ]) {
      expect(readings.text[cases.indexOf(html!)]).toBe(text);
    }
  });

  test("reads a run of '<' before a comment as the comment, from the run's last '<'", () => {
    for (const [html, text] of [
      ["<p>a<<!-- x > y -->b</p>", "ab\n"],
      ["<<!-- a > b -->c<br>", "c\n"],
      ["x<<<!-- y > z -->w<br>", "xw\n"],
      ["a<<br>b", "a\nb"],
    ]) {
      expect(readings.text[cases.indexOf(html!)]).toBe(text);
    }
  });

  test("reads a note whose only '<' starts a PHP or XML snippet as plain text, as before", () => {
    expect(readings.text[cases.indexOf('<?xml version="1.0"?> AT&amp;T')]).toBe(
      '<?xml version="1.0"?> AT&T',
    );
    expect(
      readings.text[cases.indexOf("run <?php phpinfo(); ?> to check")],
    ).toBe("run <?php phpinfo(); ?> to check");
  });

  test("reads a note with no tag as plain text: only its entities are read", () => {
    // Its spaces and blank lines stay as they were written, too.
    expect(readings.text[cases.indexOf("ls -la  \n\n\n\nfoo & bar")]).toBe(
      "ls -la  \n\n\n\nfoo & bar",
    );

    for (const [plain, text] of [
      ["R&D: latency < 200ms", "R&D: latency < 200ms"],
      [
        "Q&A - error rate < 1%, p99<threshold",
        "Q&A - error rate < 1%, p99<threshold",
      ],
      ["Tom &amp; Jerry <3", "Tom & Jerry <3"],
      ["a < b > c & d", "a < b > c & d"],
    ]) {
      expect(readings.text[cases.indexOf(plain!)]).toBe(text);
    }
  });

  test("a line break or the end of a block written longer than any real one is neither", () => {
    expect(readings.text[cases.indexOf(LONG_LINE_BREAK)]).toBe("ab");
    expect(readings.text[cases.indexOf("a<br   >b")]).toBe("a\nb");
  });

  test("leaves a note with no tag and no entity as it is: it is plain text, not HTML", () => {
    for (const plain of [
      "hello <script",
      "<<<<",
      "a < b <c",
      "Plain <3 text, a < b",
    ]) {
      expect(readings.text[cases.indexOf(plain)]).toBe(plain);
    }
  });
});

describe("the script", () => {
  test("is the same in the incident and the alert templates, from its walk to its step", () => {
    const sectionOf: (templateId: string) => string = (
      templateId: string,
    ): string => {
      const code: string = scriptOf(templateId, STEP);

      return code.slice(
        code.indexOf(READING_SECTION),
        code.indexOf(STEP_SECTION),
      );
    };

    expect(sectionOf(INCIDENT.templateId).length).toBeGreaterThan(0);
    expect(sectionOf(ALERT.templateId)).toBe(sectionOf(INCIDENT.templateId));
  });

  test("reads the note through its walk, and places every part that came from Dynamics 365", () => {
    const code: string = scriptOf(INCIDENT.templateId, STEP);
    const step: string = code.slice(code.indexOf(STEP_SECTION));

    expect(code).toContain("replaceMarkup(text, markupAsText)");
    expect(step).toContain("oneLine(htmlToText(note.subject))");
    expect(step).toContain("clean(htmlToText(note.notetext))");

    for (const part of [
      "asWritten(author)",
      "asWritten(caseNumber)",
      "asWritten(subject)",
      "asWritten(text)",
      "asWritten(attachment)",
    ]) {
      expect(step).toContain(part);
    }
  });
});

describe.each(KINDS)(
  "the private note a %s gets",
  (_name: string, kind: NoteKind) => {
    test.each(ORDINARY_NOTES)(
      "%s is saved exactly as before",
      async (_case: string, notetext: string, text: string) => {
        const result: JSONObject = await noteFor(kind, { notetext: notetext });

        expect(result).toEqual({
          proceed: true,
          [kind.idKey]: kind.id,
          caseNumber: CASE_NUMBER,
          note: [HEADER, "", "Called the customer", "", text].join("\n"),
        });
        expect(String(result["note"])).not.toContain(WORD_JOINER);
      },
    );

    test.each(MARKUP_NOTES)(
      "%s is saved as text",
      async (_case: string, notetext: string, text: string) => {
        const result: JSONObject = await noteFor(kind, { notetext: notetext });

        expect(textPartOf(result)).toBe(text);
        expect(textPartOf(result)).not.toMatch(TAG_START);
        expect(String(result["note"]).startsWith(`${HEADER}\n\n`)).toBe(true);
      },
    );

    test.each(NAMED_ELEMENT_NOTES)(
      "%s is saved as the text a browser shows",
      async (_case: string, notetext: string, text: string) => {
        const result: JSONObject = await noteFor(kind, { notetext: notetext });

        expect(textPartOf(result)).toBe(text);
      },
    );

    test("a plain-text title or note holding '&' keeps its '<', exactly as before", async () => {
      const result: JSONObject = await noteFor(kind, {
        subject: "R&D: latency < 200ms",
        notetext: "Q&A - error rate < 1% after the fix",
      });

      expect(result["note"]).toBe(
        [
          HEADER,
          "",
          "R&D: latency < 200ms",
          "",
          "Q&A - error rate < 1% after the fix",
        ].join("\n"),
      );
    });

    test("the author's name, the case number, the title and an attachment's name are placed as text too", async () => {
      const result: JSONObject = await noteFor(kind, {
        author: "![me](https://tracker.example/a.png) <!here>",
        caseNumber: "![c](https://tracker.example/c.png)",
        subject: "Re: <@U0123ABC> [click](https://evil.example)",
        notetext: "<p>Logs attached.</p>",
        isdocument: true,
        filename: "<img src=x>.har",
      });

      expect(String(result["note"])).toBe(
        [
          `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: !${WORD_JOINER}[me]${WORD_JOINER}(https://tracker.example/a.png) <${WORD_JOINER}!here> added a note to case [!${WORD_JOINER}[c]${WORD_JOINER}(https://tracker.example/c.png)](${CASE_URL}).`,
          "",
          `Re: <${WORD_JOINER}@U0123ABC> [click]${WORD_JOINER}(https://evil.example)`,
          "",
          "Logs attached.",
          "",
          `Attachment, left in Dynamics 365: <${WORD_JOINER}img src=x>.har`,
        ].join("\n"),
      );
    });
  },
);

describe("no private note holds markup a renderer acts on", () => {
  let notes: Array<string> = [];

  beforeAll(async () => {
    notes = [];

    for (const [, notetext] of [...ORDINARY_NOTES, ...MARKUP_NOTES]) {
      notes.push(String((await noteFor(INCIDENT, { notetext }))["note"]));
    }
  });

  // Every token marked (the emails) reads in a text, nested ones included.
  const tokensOf: (markdown: string) => Array<Token> = (
    markdown: string,
  ): Array<Token> => {
    const tokens: Array<Token> = [];

    marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
      tokens.push(token);
    });

    return tokens;
  };

  test("marked reads no HTML, no image, and no link but the one to the case", () => {
    for (const note of notes) {
      const tokens: Array<Token> = tokensOf(note);

      expect({
        note: note,
        html: tokens
          .filter((token: Token): boolean => {
            return token.type === "html";
          })
          .map((token: Token): string => {
            return token.raw;
          }),
        images: tokens.filter((token: Token): boolean => {
          return token.type === "image";
        }).length,
        // A bare address is still a link, as it is wherever somebody types one.
        links: tokens
          .filter((token: Token): boolean => {
            return (
              token.type === "link" &&
              (token.raw.startsWith("[") || token.raw.startsWith("<"))
            );
          })
          .map((token: Token): string => {
            return token.raw;
          }),
      }).toEqual({
        note: note,
        html: [],
        images: 0,
        links: [`[${CASE_NUMBER}](${CASE_URL})`],
      });
    }
  });

  test("the dashboard shows no image and no diagram, and links only to the case and to addresses shown as they are", () => {
    const pages: Array<string> = renderAsDashboard(notes);

    pages.forEach((page: string, index: number): void => {
      const anchors: Array<RegExpMatchArray> = Array.from(
        page.matchAll(DASHBOARD_ANCHOR),
      );

      expect({
        note: notes[index],
        image: DASHBOARD_IMAGE.test(page),
        diagram: DASHBOARD_DIAGRAM.test(page),
        // Every link is read below, none with markup in its words.
        anchors: anchors.length,
        hidingLinks: anchors
          .filter((anchor: RegExpMatchArray): boolean => {
            return !showsWhereItGoes(anchor[1]!, anchor[2]!);
          })
          .map((anchor: RegExpMatchArray): string => {
            return anchor[0];
          }),
      }).toEqual({
        note: notes[index],
        image: false,
        diagram: false,
        anchors: hrefsOf(page).length,
        hidingLinks: [],
      });
    });
  });

  test("Slack reads no mention in any of them", () => {
    for (const note of notes) {
      expect(SlackUtil.convertMarkdownToSlackRichText(note)).not.toMatch(
        SLACK_MENTION,
      );
    }
  });

  test("as typed, the Markdown in those notes would be read as markup", () => {
    // So the tests above are not passing on text Markdown leaves alone anyway.
    for (const typed of [
      "<img src=x onerror=alert(1)>",
      "see ![chart](https://tracker.example/p.png)",
      "[Reset your password](https://login.example/reset)",
      "<https://status.example.com>",
    ]) {
      expect(
        tokensOf(typed).some((token: Token): boolean => {
          return ["html", "image", "link"].includes(token.type);
        }),
      ).toBe(true);
    }

    expect(
      DASHBOARD_DIAGRAM.test(
        renderAsDashboard(["```mermaid\ngraph TD; A-->B\n```"])[0]!,
      ),
    ).toBe(true);
    expect(
      SlackUtil.convertMarkdownToSlackRichText("<!channel> please look"),
    ).toMatch(SLACK_MENTION);
  });

  test("text typed as markup reads exactly as typed", () => {
    const savedAs: (name: string) => string = (name: string): string => {
      return withoutJoiners(
        MARKUP_NOTES.find((note: [string, string, string]): boolean => {
          return note[0] === name;
        })![2],
      );
    };

    expect(savedAs("a script typed as text")).toBe("<script>alert(1)</script>");
    expect(savedAs("comparisons written without a space")).toBe(
      "p99<200ms and x <= y",
    );
    expect(savedAs("an image typed as Markdown")).toBe(
      "see ![chart](https://tracker.example/p.png)",
    );
    expect(savedAs("a mermaid diagram typed as Markdown")).toBe(
      "```mermaid\ngraph TD; A-->B\n```",
    );
  });
});

describe("time", () => {
  /*
   * A note can be long: Dataverse keeps up to 100,000 characters of note
   * text. The single pass, the test for a tag and the pass over spaces at
   * the ends of lines each looked ahead again from every place a match
   * could start: seconds for such a note, and the step ran out of time.
   * Each note here is read well inside the sandbox's own limit.
   */
  const LIMIT_IN_MS: number = 3000;
  const SIZE: number = 100000;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  test.each([
    ["tags that never close, and an entity", `${repeatTo("<a")}&amp;`],
    ["values that never close", `${repeatTo('<a b="')}&amp;`],
    ["a run of '<' before an unclosed value", `${repeatTo("<")}=">&amp;`],
    ["spaces before the end of a line", `<p>${repeatTo(" ")}x</p>`],
    ["tabs and spaces", `<p>${repeatTo("\t ")}x</p>`],
    ["comment openings", `<p>${repeatTo("<!--")}x</p>`],
    ["fences and references", `<p>${repeatTo("```&#109;")}</p>`],
    ["line breaks in a row", `<p>a${repeatTo("\n")}b</p>`],
    ["a line of backticks", `<p>${repeatTo("`")}</p>`],
    ["one long line break", `<p>a<br${repeatTo(" ")}>b</p>`],
    ["text '<' runs", `<p>${repeatTo("<< ")}</p>`],
    ["a plain-text note of spaces and entities", `${repeatTo("  &amp; ")}x`],
  ])(
    "reads a note of %s in linear time",
    async (_case: string, notetext: string) => {
      const started: number = Date.now();
      const result: JSONObject = await noteFor(INCIDENT, {
        notetext: notetext,
      });

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      /*
       * The note is cut at MAX_NOTE_LENGTH and ends in "…": a "<" the cut
       * leaves last is followed by that, which starts nothing.
       */
      expect(String(result["note"])).not.toMatch(MARKUP_START);
    },
  );
});
