/*
 * A DYNAMICS 365 CASE'S DESCRIPTION, AS ITS INCIDENT OR ALERT READS IT.
 *
 * The create-from-case templates (dynamics-declare-incident-from-case,
 * dynamics-create-alert-from-case) turn each new case into an incident or an
 * alert, whose description ends with the case's description (step
 * prepare-incident-1 / prepare-alert-1). A case's description is plain text
 * - until an organization puts Dynamics 365's rich-text editor on the case
 * form, or a rule turns incoming email into cases, when it is HTML: the
 * editor's, or the email's. Placed as written (asWritten, #4676), that HTML
 * showed its tags as text in the incident.
 *
 * The script now reads a description that starts with a tag, a comment or
 * a document type - as the editor and an email always write one - the way
 * the case-note script reads a note: the walk OneUptime's own code reads
 * HTML with (replaceHtmlMarkup, reading "<" as a browser does and script and
 * style elements whole), then entities once; and places what it reads with
 * asWritten. Any other description is plain text, written exactly as before.
 * Both scripts carry the reading as one section, byte for byte
 * (DYNAMICS_RICH_TEXT_READING in Templates.ts). These tests:
 *
 *   - check that the create-from-case scripts carry the note scripts'
 *     reading, byte for byte, and read through it;
 *   - run the case script's own copy of the walk in the workflow sandbox and
 *     hold it to replaceHtmlMarkup, on the markup cases the note's copy is
 *     held to, generated HTML and HTML with script, style and text elements;
 *   - turn descriptions as the rich-text editor, Outlook, Outlook on the web,
 *     Gmail and a portal write them into exactly the text they show;
 *   - keep every plain-text description exactly as it was written before,
 *     a "<" in it too - an address in brackets, a mention, a generic type;
 *   - give markup typed in the editor (which keeps it as text) and check
 *     that it reads as typed while nothing in it acts - marked (the emails),
 *     the dashboard's parser and Slack's conversion read no HTML, image,
 *     diagram, mention or link that hides where it goes;
 *   - read long descriptions in time that grows with their length alone.
 */

import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { replaceHtmlMarkup } from "../../../Types/HtmlMarkup";
import { JSONObject } from "../../../Types/JSON";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../Utils/Markdown/DashboardMarkdownRenderer";
import {
  MARKUP_ALPHABET,
  SINGLE_PASS_LEFTOVERS,
  WELL_FORMED_MARKUP,
} from "../HtmlMarkupCases";
import {
  CASE_ID,
  CASE_NUMBER,
  DYNAMICS_URL,
  LINK_COLUMN,
  caseRow,
  runDynamicsScript,
} from "./DynamicsTemplateFixtures";
import {
  ALERT_SEVERITIES,
  INCIDENT_SEVERITIES,
  quoted,
  scriptOf,
} from "./JiraTemplateFixtures";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import { Token, marked } from "marked";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

interface CaseKind {
  noun: string;
  Created: string;
  templateId: string;
  step: string;
  severities: Array<JSONObject>;
  noteTemplateId: string;
}

const INCIDENT: CaseKind = {
  noun: "incident",
  Created: "Declared",
  templateId: "dynamics-declare-incident-from-case",
  step: "prepare-incident-1",
  severities: INCIDENT_SEVERITIES,
  noteTemplateId: "dynamics-case-note-to-incident-private-note",
};

const ALERT: CaseKind = {
  noun: "alert",
  Created: "Created",
  templateId: "dynamics-create-alert-from-case",
  step: "prepare-alert-1",
  severities: ALERT_SEVERITIES,
  noteTemplateId: "dynamics-case-note-to-alert-private-note",
};

const KINDS: Array<[string, CaseKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

const J: string = WORD_JOINER;
const MAILTO: string = "mailto:";
const CASE_URL: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;

// Where the scripts' sections start.
const READING_SECTION: string = "// ---- Reading rich text ----";
const CASE_STEP_SECTION: string = "// ---- Reading the case ----";
const NOTE_STEP_SECTION: string = "// ---- Reading the note ----";

// A "<" that starts something: what no placed text may hold.
const TAG_START: RegExp = /<(?![\s\u2060])/;
// A "<" that starts markup, as a browser reads one.
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;
const WORD_JOINER_RUN: RegExp = /\u2060/g;
const SLACK_MENTION: RegExp = /<[!@#][A-Za-z0-9]/;
const SLACK_LINK: RegExp = /<([A-Za-z][A-Za-z0-9+.-]*:[^<>|\s]*)\|([^<>]*)>/g;
const DASHBOARD_IMAGE: RegExp = /<img/;
const DASHBOARD_DIAGRAM: RegExp = /language-mermaid/i;
const DASHBOARD_ANCHOR: RegExp = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
const AS_A_BROWSER_READS_IT: {
  lessThanAsText: boolean;
  rawTextElements: boolean;
} = { lessThanAsText: true, rawTextElements: true };

/* ------------------------------- Running it ------------------------------- */

// The record a case with this description becomes.
async function recordFor(
  kind: CaseKind,
  description: string | null,
): Promise<JSONObject> {
  return await runDynamicsScript({
    templateId: kind.templateId,
    componentId: kind.step,
    args: {
      severities: quoted(kind.severities),
      dynamicsUrl: DYNAMICS_URL,
      linkColumn: LINK_COLUMN,
      case: quoted(caseRow({ description: description })),
    },
  });
}

// The lines the template writes before the case's description.
function headerOf(kind: CaseKind): string {
  return [
    `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${CASE_URL}).`,
    "Priority: High",
    "Customer: Contoso Pharmaceuticals",
  ].join("\n");
}

// What the record's description says of the case's: what follows the header and a blank line.
function descriptionPartOf(kind: CaseKind, record: JSONObject): string {
  const description: string = String(record["description"]);
  const header: string = headerOf(kind);

  if (description === header) {
    return "";
  }

  if (!description.startsWith(`${header}\n\n`)) {
    throw new Error(
      `The description does not start with its header: ${description.slice(0, 300)}`,
    );
  }

  return description.slice(header.length + 2);
}

/*
 * The case script's reading, on many texts at once in one sandbox run: its
 * step is swapped for a few lines that call the reading's functions.
 */
const HARNESS: string = [
  CASE_STEP_SECTION,
  "const cases = Array.isArray(args.cases) ? args.cases : [];",
  "return {",
  "  walked: cases.map((html) => replaceMarkup(html, (markup) => '[' + markup + ']')),",
  "  removed: cases.map((html) => replaceMarkup(html, () => '')),",
  "};",
].join("\n");

interface Readings {
  walked: Array<string>;
  removed: Array<string>;
}

async function readWithTheCaseScript(
  kind: CaseKind,
  cases: Array<string>,
): Promise<Readings> {
  return (await runDynamicsScript({
    templateId: kind.templateId,
    componentId: kind.step,
    args: { cases: cases },
    editCode: (code: string): string => {
      return code.slice(0, code.indexOf(CASE_STEP_SECTION)) + HARNESS;
    },
  })) as unknown as Readings;
}

// A script's reading section: from its heading to the step that uses it.
function readingSectionOf(
  templateId: string,
  componentId: string,
  stepSection: string,
): string {
  const code: string = scriptOf(templateId, componentId);
  const start: number = code.indexOf(READING_SECTION);
  const end: number = code.indexOf(stepSection);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${templateId} ${componentId} has no reading section.`);
  }

  return code.slice(start, end);
}

/* ---------------------------- What a renderer reads ---------------------------- */

// Every token marked (the emails) reads in a text, nested ones included.
function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
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
 * case under the case's number, or an address under its own words - an
 * email address the dashboard links to mail, too.
 */
function showsWhereItGoes(href: string, words: string): boolean {
  if (href === CASE_URL) {
    return words === CASE_NUMBER;
  }

  if (href.startsWith(MAILTO) && words === href.slice(MAILTO.length)) {
    return true;
  }

  let address: string = href;

  try {
    address = decodeURI(href);
  } catch {
    // An address that does not decode is compared as it is.
  }

  return words === address || words === href;
}

interface Reading {
  description: string;
  html: Array<string>;
  images: number;
  links: Array<string>;
  dashboardImage: boolean;
  dashboardDiagram: boolean;
  dashboardHidingLinks: Array<string>;
  slackMention: boolean;
  slackHidingLinks: Array<string>;
  tagStart: boolean;
}

// How each renderer reads each record's description.
function readingsOf(descriptions: Array<string>): Array<Reading> {
  const pages: Array<string> = renderAsDashboard(descriptions);

  return descriptions.map((description: string, index: number): Reading => {
    const tokens: Array<Token> = tokensOf(description);
    const page: string = pages[index]!;
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(description);

    return {
      description: description,
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
            (token.raw.startsWith("[") || token.raw.startsWith("<")) &&
            (token as Token & { href: string }).href !== CASE_URL
          );
        })
        .map((token: Token): string => {
          return token.raw;
        }),
      dashboardImage: DASHBOARD_IMAGE.test(page),
      dashboardDiagram: DASHBOARD_DIAGRAM.test(page),
      dashboardHidingLinks: Array.from(page.matchAll(DASHBOARD_ANCHOR))
        .filter((anchor: RegExpMatchArray): boolean => {
          return !showsWhereItGoes(
            unescapedHtml(anchor[1]!),
            unescapedHtml(anchor[2]!),
          );
        })
        .map((anchor: RegExpMatchArray): string => {
          return anchor[0];
        }),
      slackMention: SLACK_MENTION.test(slack),
      slackHidingLinks: Array.from(slack.matchAll(SLACK_LINK))
        .filter((link: RegExpMatchArray): boolean => {
          return !showsWhereItGoes(link[1]!, link[2]!);
        })
        .map((link: RegExpMatchArray): string => {
          return link[0];
        }),
      tagStart: TAG_START.test(description),
    };
  });
}

const NOTHING_ACTS: Omit<Reading, "description"> = {
  html: [],
  images: 0,
  links: [],
  dashboardImage: false,
  dashboardDiagram: false,
  dashboardHidingLinks: [],
  slackMention: false,
  slackHidingLinks: [],
  tagStart: false,
};

/* ------------------------------- Descriptions ------------------------------- */

/*
 * The wrapper Dynamics 365's rich-text editor (CKEditor 5) writes around
 * what it holds.
 */
const CK_STYLE: string =
  "--list-bullet-0:disc;--list-bullet-1:circle;--list-bullet-2:square;--list-multiLevel-0:decimal;--list-multiLevel-1:lower-alpha;--list-multiLevel-2:lower-roman;font-family:Segoe UI;font-size:11pt;";

function richText(inner: string): string {
  return `<div class="ck-content" data-wrapper="true" dir="ltr" style="${CK_STYLE}">${inner}</div>`;
}

// The head Outlook (Word) writes into an email's HTML, with its rules in a comment.
const OUTLOOK_HEAD: string = [
  '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">',
  "<head>",
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<meta name="Generator" content="Microsoft Word 15 (filtered medium)">',
  "<style><!--",
  "/* Font Definitions */",
  "@font-face",
  '\t{font-family:"Cambria Math";',
  "\tpanose-1:2 4 5 3 5 4 6 3 2 4;}",
  "p.MsoNormal, li.MsoNormal, div.MsoNormal",
  "\t{margin:0in;",
  "\tfont-size:11.0pt;",
  '\tfont-family:"Aptos",sans-serif;}',
  "--></style><!--[if gte mso 9]><xml>",
  '<o:shapedefaults v:ext="edit" spidmax="1026" />',
  "</xml><![endif]-->",
  "</head>",
].join("\r\n");

// Outlook on the web and the new Outlook write a style with nothing around it.
const OUTLOOK_WEB_DIV: string =
  '<div class="elementToProof" style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">';

/*
 * Descriptions as Dynamics 365 keeps them when they are HTML, and the text
 * each now reads as in the record. Each was written as its markup before.
 */
const RICH_DESCRIPTIONS: Array<[string, string, string]> = [
  [
    "the rich-text editor: paragraphs, a line break, bold, a list and a link",
    richText(
      '<p>Checkout fails for EU customers since <strong>09:40 UTC</strong>.</p><p>Steps:<br>1. Add an item<br>2. Pay with a card</p><ul><li>Seen on web and iOS</li><li>Card payments only</li></ul><p>Status page: <a href="https://status.example.com/incidents/42" target="_blank" rel="noopener noreferrer">incident 42</a></p>',
    ),
    [
      "Checkout fails for EU customers since 09:40 UTC.",
      "Steps:",
      "1. Add an item",
      "2. Pay with a card",
      "Seen on web and iOS",
      "Card payments only",
      "Status page: incident 42",
    ].join("\n"),
  ],
  [
    "the older editor's divs and non-breaking spaces",
    "<div data-wrapper=\"true\" style=\"font-size:9pt;font-family:'Segoe UI','Helvetica Neue',sans-serif;\"><div>Hi team,</div><div>&nbsp;</div><div>The nightly export to the warehouse failed again.</div><div>Error&nbsp;code:&nbsp;E-1042</div></div>",
    "Hi team,\n\nThe nightly export to the warehouse failed again.\nError code: E-1042",
  ],
  [
    "an email from Outlook that a rule made a case",
    [
      OUTLOOK_HEAD,
      '<body lang="EN-US" link="#467886" vlink="#96607D" style="word-wrap:break-word">',
      '<div class="WordSection1">',
      '<p class="MsoNormal">Hi support,<o:p></o:p></p>',
      '<p class="MsoNormal"><o:p>&nbsp;</o:p></p>',
      '<p class="MsoNormal">Since 09:40 UTC our checkout returns error 502 &amp; customers cannot pay.<o:p></o:p></p>',
      '<p class="MsoNormal"><o:p>&nbsp;</o:p></p>',
      '<p class="MsoNormal">Thanks,<o:p></o:p></p>',
      '<p class="MsoNormal">Jane Doe<o:p></o:p></p>',
      "</div>",
      "</body>",
      "</html>",
      "",
    ].join("\r\n"),
    "Hi support,\n\nSince 09:40 UTC our checkout returns error 502 & customers cannot pay.\n\nThanks,\n\nJane Doe",
  ],
  [
    "an email from Outlook on the web, whose style has nothing around it",
    [
      "<html><head>",
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
      '<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style>',
      "</head>",
      '<body dir="ltr">',
      OUTLOOK_WEB_DIV,
      "The VPN drops every few minutes for the Berlin office.</div>",
      OUTLOOK_WEB_DIV,
      "<br>",
      "</div>",
      OUTLOOK_WEB_DIV,
      "Max</div>",
      "</body>",
      "</html>",
      "",
    ].join("\r\n"),
    "The VPN drops every few minutes for the Berlin office.\n\nMax",
  ],
  [
    "an email from Gmail, quoting the message it answers",
    '<div dir="ltr">Hello team,<div><br></div><div>The status page shows the API as up, but every call times out.</div><div><br></div><div>Regards,</div><div>Max</div></div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Oct 6, 2026 at 9:40 AM Jane Doe &lt;<a href="mailto:jane@contoso.com">jane@contoso.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr">Is the API down?</div></blockquote></div>',
    `Hello team,\n\nThe status page shows the API as up, but every call times out.\n\nRegards,\nMax\n\nOn Mon, Oct 6, 2026 at 9:40 AM Jane Doe <${J}jane@contoso.com> wrote:\n\nIs the API down?`,
  ],
  [
    "a portal's description, with a '<' written as an entity",
    "<p>I can&#39;t sign in to the portal since this morning.</p><p>The page says: &quot;Session expired&quot; &lt;401&gt;</p>",
    `I can't sign in to the portal since this morning.\nThe page says: "Session expired" <${J}401>`,
  ],
  [
    "a table, and an image the editor stored",
    richText(
      '<p>Affected regions:</p><figure class="table"><table><tbody><tr><td>Region</td><td>Status</td></tr><tr><td>EU</td><td>Degraded</td></tr></tbody></table></figure><p><img src="/api/data/v9.0/msdyn_richtextfiles(8f9e2b1c-1d2e-4f3a-9b8c-7d6e5f4a3b2c)/msdyn_imageblob/$value?size=full" alt="screenshot of the error" width="600"></p>',
    ),
    "Affected regions:\nRegionStatus\nEUDegraded",
  ],
  [
    "a heading, a quote, and a script no editor writes",
    richText(
      "<h2>Impact</h2><blockquote><p>Customers cannot pay.</p></blockquote><script>alert(1)</script><p>Next update at 11:00.</p>",
    ),
    "Impact\nCustomers cannot pay.\n\nNext update at 11:00.",
  ],
  [
    "a document type and upper-case tags",
    "<!DOCTYPE html>\n<HTML><BODY><P>Disk full on db-2.</P><P>Cleared 20 GB.</P></BODY></HTML>",
    "Disk full on db-2.\nCleared 20 GB.",
  ],
  [
    "a comment first",
    "<!-- Converted from email -->\n<div>Printer on floor 3 is offline.</div>",
    "Printer on floor 3 is offline.",
  ],
  [
    "an XML declaration first",
    '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Backup job failed.</p></body></html>',
    "Backup job failed.",
  ],
  [
    "white space before the first tag",
    "\n\n   <p>Login fails on the mobile app.</p>",
    "Login fails on the mobile app.",
  ],
  [
    "an alert email whose HTML is indented, which would read as code",
    [
      "<html>",
      "  <body>",
      "    <table>",
      "      <tr>",
      "        <td>",
      "          CPU at 98% on db-1",
      "        </td>",
      "      </tr>",
      "      <tr>",
      "        <td>",
      "          Since 09:40 UTC",
      "        </td>",
      "      </tr>",
      "    </table>",
      "  </body>",
      "</html>",
    ].join("\n"),
    "CPU at 98% on db-1\n\nSince 09:40 UTC",
  ],
  [
    "a space the editor wrote as &nbsp; at the start of a line, which stays",
    richText("<p>Steps:<br>&nbsp;&nbsp;1. Restart<br>&nbsp;&nbsp;2. Retry</p>"),
    "Steps:\n  1. Restart\n  2. Retry",
  ],
  [
    "references an email writes, by number and by name",
    "<div>Don&rsquo;t restart&#160;yet &mdash; see &#8220;runbook&#8221; &#x2192; step&nbsp;2 &copy; ACME&trade;</div>",
    "Don\u2019t restart yet \u2014 see \u201crunbook\u201d \u2192 step 2 \u00a9 ACME\u2122",
  ],
  [
    "references that are no character, and a control character",
    "<p>a&#0;b&#xD800;c&#1114112;d&#1;e&unknown;f&amp;rsquo;</p>",
    "a\ufffdb\ufffdc\ufffdde&unknown;f&rsquo;",
  ],
  [
    "Windows-1252 numbers, as Word writes them",
    "<p>Don&#146;t restart &#150; see &#147;runbook&#148; &#128;5 &#129;</p>",
    "Don\u2019t restart \u2013 see \u201crunbook\u201d \u20ac5 \ufffd",
  ],
  [
    "accented letters and quotes by name",
    "<p>Probl&egrave;me r&eacute;solu, Gr&uuml;&szlig;e &laquo;urgent&raquo; &frac12; &Eacute;t&eacute; &Uuml;</p>",
    "Probl\u00e8me r\u00e9solu, Gr\u00fc\u00dfe \u00aburgent\u00bb \u00bd \u00c9t\u00e9 \u00dc",
  ],
  [
    "a reference whose number writes '&' is read once",
    "<p>&#38;rsquo; and &#38;amp;lt; and &#x26;nbsp;</p>",
    "&rsquo; and &amp;lt; and &nbsp;",
  ],
  [
    "a soft hyphen, joiners and direction marks, as a browser keeps them",
    "<p>co&shy;operate &#x1F468;&zwj;&#x1F469; &#1605;&zwnj;&#1740; x&lrm;y&rlm;z&#173;w</p>",
    "co\u00adoperate \u{1F468}\u200d\u{1F469} \u0645\u200c\u06cc x\u200ey\u200fz\u00adw",
  ],
  [
    "a flow's HTML that starts with bold",
    "<b>CRITICAL</b><br>Disk full on db-1",
    "CRITICAL\nDisk full on db-1",
  ],
  [
    "a stack trace in a pre element, which keeps its indentation",
    '<div><p>Error:</p><pre>Traceback (most recent call last):\n  File "app.py", line 3\n    raise ValueError()</pre>\n    <p>Seen twice.</p></div>',
    'Error:\nTraceback (most recent call last):\n  File "app.py", line 3\n    raise ValueError()\nSeen twice.',
  ],
];

/*
 * Markup typed in the rich-text editor, which keeps it as text ("&lt;"),
 * and what each description now reads as: the characters typed, with a
 * joiner where something would start.
 */
const TYPED_MARKUP: Array<[string, string, string]> = [
  [
    "a tag and a mention typed as text",
    richText(
      "<p>&lt;img src=x onerror=alert(1)&gt; showed up on the checkout page.</p><p>&lt;!channel&gt; please look</p>",
    ),
    `<${J}img src=x onerror=alert(1)> showed up on the checkout page.\n<${J}!channel> please look`,
  ],
  [
    "an image and a link typed as Markdown",
    richText(
      "<p>![chart](https://tracker.example/p.png) [Reset your password](https://login.example/reset)</p>",
    ),
    `!${J}[chart]${J}(https://tracker.example/p.png) [Reset your password]${J}(https://login.example/reset)`,
  ],
  [
    "a mermaid diagram typed as Markdown",
    richText("<p>```mermaid</p><p>graph TD; A--&gt;B</p><p>```</p>"),
    `\`\`\`${J}mermaid\ngraph TD; A-->B\n\`\`\``,
  ],
  [
    "a Slack link and a user mention typed as text",
    richText(
      "<p>&lt;https://evil.example|Open the runbook&gt; &lt;@U0123ABC&gt;</p>",
    ),
    `<${J}https://evil.example|Open the runbook> <${J}@U0123ABC>`,
  ],
  [
    "a link definition typed as Markdown",
    richText("<p>[logo]: https://tracker.example/logo.png</p>"),
    `[logo]${J}: https://tracker.example/logo.png`,
  ],
  [
    "entities typed as text",
    richText("<p>&amp;lt;b&amp;gt; stays text</p>"),
    "&lt;b&gt; stays text",
  ],
  [
    "markup written as numeric references",
    richText(
      "<p>&#60;img src=x onerror=alert(1)&#62; and &#x3C;!channel&#x3E;</p>",
    ),
    `<${J}img src=x onerror=alert(1)> and <${J}!channel>`,
  ],
];

/*
 * Plain-text descriptions, and what each is written as: exactly what it was
 * written as before this change - placed as written, with a joiner after a
 * "<" that could start something. None starts with a tag.
 */
const PLAIN_DESCRIPTIONS: Array<[string, string, string]> = [
  [
    "two lines",
    "Three customers called since 09:40 UTC.\nThey see an error after entering card details.",
    "Three customers called since 09:40 UTC.\nThey see an error after entering card details.",
  ],
  [
    "a forwarded email",
    "From: Jane Doe <jane@contoso.com>\nSent: Monday\n\nThe portal is down.",
    `From: Jane Doe <${J}jane@contoso.com>\nSent: Monday\n\nThe portal is down.`,
  ],
  [
    "an address in brackets first",
    "<jane@contoso.com> wrote:\n> The portal is down for everyone.",
    `<${J}jane@contoso.com> wrote:\n> The portal is down for everyone.`,
  ],
  [
    "an autolink first",
    "<https://status.example.com> shows the outage",
    `<${J}https://status.example.com> shows the outage`,
  ],
  [
    "a mention first",
    "<!channel> checkout is down",
    `<${J}!channel> checkout is down`,
  ],
  [
    "a heart first",
    "<3 thanks for the quick fix",
    `<${J}3 thanks for the quick fix`,
  ],
  ["a '<' and a space first", "< 1% of requests fail", "< 1% of requests fail"],
  [
    "entities typed as text",
    "Q&amp;A: the &lt;b&gt; tag stays as typed",
    "Q&amp;A: the &lt;b&gt; tag stays as typed",
  ],
  [
    "a tag in the middle",
    "Steps: open <b>Settings</b>, then retry",
    `Steps: open <${J}b>Settings<${J}/b>, then retry`,
  ],
  [
    "a tag that never ends, first",
    "<b unfinished thought",
    `<${J}b unfinished thought`,
  ],
  [
    "a generic type",
    "List<String> is empty in the order service",
    `List<${J}String> is empty in the order service`,
  ],
  [
    "a prefixed name, which no element has",
    "<o:p> is what Outlook writes",
    `<${J}o:p> is what Outlook writes`,
  ],
  [
    "a name in brackets first",
    "<Jane Doe> cannot log in since 9am",
    `<${J}Jane Doe> cannot log in since 9am`,
  ],
  ["a placeholder", "<none>", `<${J}none>`],
  [
    "a redaction first",
    "<REDACTED> asked for a call back",
    `<${J}REDACTED> asked for a call back`,
  ],
  [
    "words in brackets first",
    "<a lot of errors> since the deploy",
    `<${J}a lot of errors> since the deploy`,
  ],
  [
    "an element's name in brackets, with nothing closed",
    "<header> overlaps the menu on mobile",
    `<${J}header> overlaps the menu on mobile`,
  ],
  [
    "a title in brackets, with nothing closed",
    "<title> is missing on the login page",
    `<${J}title> is missing on the login page`,
  ],
  [
    "an image typed first",
    "<img src=x onerror=alert(1)> showed up on the page",
    `<${J}img src=x onerror=alert(1)> showed up on the page`,
  ],
  [
    "a measurement in brackets",
    "<p99 latency> is above 2 s",
    `<${J}p99 latency> is above 2 s`,
  ],
  [
    "an element's name first, with no tag after it",
    "<div unfinished thought",
    `<${J}div unfinished thought`,
  ],
  [
    "a numeric reference in plain text, which stays as written",
    "Use &#60; for less-than",
    "Use &#60; for less-than",
  ],
  [
    "white space and blank lines around it",
    "\n\n  Login fails.  \n\n",
    "Login fails.",
  ],
  [
    "control characters, which are dropped as before",
    "line one\u0001\nline two\ttabbed\r\nline three",
    "line one\nline two\ttabbed\nline three",
  ],
];

/*
 * How a description starts decides how it is read: with a comment, a
 * document type, an XML declaration, or a tag when it closes an element
 * somewhere, it is HTML. Each of these is followed by "<p>Text</p>".
 */
const RICH_STARTS: Array<string> = [
  "<b>",
  "<strong>",
  '<a href="https://status.example.com">',
  '<img src="logo.png">',
  "<li>",
  "<tbody>",
  "<o:p>",
  "<xml>",
  "<div>",
  '<div class="ck-content" data-wrapper="true">',
  "<p>",
  "<html>",
  '<HTML lang="en">',
  "<head>",
  "<body>",
  '<meta charset="utf-8">',
  "<title>",
  "<style>p{}</style>",
  "<link rel=stylesheet>",
  "<base href=x>",
  "<span>",
  '<font face="Arial">',
  "<center>",
  "<table>",
  "<ul>",
  "<ol>",
  "<dl>",
  "<h1>",
  "<H6>",
  "<br>",
  "<br/>",
  "<hr>",
  "<pre>",
  "<blockquote>",
  "<figure>",
  "<section>",
  "<article>",
  "<header>",
  "<footer>",
  "<main>",
  "<nav>",
  "<address>",
  "<form>",
  "<!DOCTYPE html>",
  "<!doctype html>",
  "<!-- converted -->",
  '<?xml version="1.0"?>',
  "  \n<div>",
];

/*
 * Starts of plain text, which a "<" begins: each is followed by words, with
 * no element closed after it. A tag an editor writes is plain text too then.
 */
const PLAIN_STARTS: Array<string> = [
  "<header>",
  "<title>",
  "<table>",
  "<div>",
  "<p>",
  "<Jane Doe>",
  "<none>",
  "<a lot>",
  "<b>",
  "<i>",
  "<img>",
  "<o:p>",
  "<x-custom>",
  "<divider>",
  "<p99>",
  "<!channel>",
  "<!here>",
  "<@U0123ABC>",
  "<#C0123ABC>",
  "<3",
  "< ",
  "<https://status.example.com>",
  "<jane@contoso.com>",
  "<?php",
];

/* -------------------------------- The scripts -------------------------------- */

describe("the create-from-case scripts", () => {
  test("carry the note scripts' reading, byte for byte", () => {
    const sections: Set<string> = new Set();

    for (const [, kind] of KINDS) {
      sections.add(
        readingSectionOf(kind.templateId, kind.step, CASE_STEP_SECTION),
      );
      sections.add(
        readingSectionOf(kind.noteTemplateId, "read-note-1", NOTE_STEP_SECTION),
      );
    }

    expect(sections.size).toBe(1);
    expect(Array.from(sections)[0]).toContain(
      "const replaceMarkup = (html, replace, isElementText) => {",
    );
  });

  test.each(KINDS)(
    "%s: reads the description through the walk, and places what it reads",
    (_name: string, kind: CaseKind) => {
      const code: string = scriptOf(kind.templateId, kind.step);
      const step: string = code.slice(code.indexOf(CASE_STEP_SECTION));

      expect(step).toContain("htmlToText(writtenDescription)");
      expect(step).toContain("hasTag(writtenDescription)");
      expect(step).toContain("asWritten(description)");
      // Read once, before the record is written.
      expect(step.split("htmlToText(").length - 1).toBe(1);
    },
  );
});

/* ------------------------------- The walk itself ------------------------------- */

// What ends a tag's name, as a browser reads one: ASCII whitespace, "/", ">".
const TAG_NAME_ENDS: string = "\t\n\f\r />";

// Whether markup starts with a script start tag, in any letter case.
function startsWithScriptTag(markup: string): boolean {
  return (
    markup.length > 7 &&
    markup.slice(0, 7).toLowerCase() === "<script" &&
    TAG_NAME_ENDS.includes(markup.charAt(7))
  );
}

// How many tags and comments the walk finds in a text, read with no option.
function tagCountOf(html: string): number {
  let count: number = 0;

  replaceHtmlMarkup(html, (markup: string): string => {
    count++;
    return markup;
  });

  return count;
}

/*
 * Whether a browser reading a text meets a script element. Read as a browser
 * reads it, the walk hands a script element over whole, from its start tag to
 * its end tag, so markup that starts with a script tag and holds more than one
 * tag is one. A "<script>" in a comment or a quoted value, or with no end tag
 * after it, is no element and does not count.
 */
function holdsScriptElement(html: string): boolean {
  let found: boolean = false;

  replaceHtmlMarkup(
    html,
    (markup: string): string => {
      if (startsWithScriptTag(markup) && tagCountOf(markup) > 1) {
        found = true;
      }

      return markup;
    },
    AS_A_BROWSER_READS_IT,
  );

  return found;
}

describe.each(KINDS)(
  "%s: the case script's own walk",
  (_name: string, kind: CaseKind) => {
    const NAMED_ELEMENTS_ALPHABET: Array<string> = [
      ...MARKUP_ALPHABET,
      "<script>",
      "</script>",
      "<STYLE ",
      "</style >",
      "<title>",
      "</TITLE>",
      "<textarea>",
      "</textarea",
      "<xmp>",
      "</xmp>",
      "<iframe>",
      "</iframe>",
      "<!--",
      "-->",
      "<p>",
      "</p>",
      "<br>",
    ];
    const cases: Array<string> = [
      ...SINGLE_PASS_LEFTOVERS,
      ...WELL_FORMED_MARKUP,
      ...RICH_DESCRIPTIONS.map((entry: [string, string, string]): string => {
        return entry[1];
      }),
      ...TYPED_MARKUP.map((entry: [string, string, string]): string => {
        return entry[1];
      }),
      ...generatedTexts(6000, 5309, MARKUP_ALPHABET),
      ...generatedTexts(6000, 6113, NAMED_ELEMENTS_ALPHABET, 16),
    ];
    let readings: Readings;

    beforeAll(async () => {
      readings = await readWithTheCaseScript(kind, cases);
    });

    test("reads every tag, comment and element exactly where replaceHtmlMarkup does, as a browser reads them", () => {
      expect(readings.walked).toHaveLength(cases.length);
      expect(
        cases.filter((html: string, index: number): boolean => {
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
        }),
      ).toEqual([]);
    });

    test("takes markup out leaving no '<' that starts markup", () => {
      expect(readings.removed).toHaveLength(cases.length);
      expect(
        readings.removed.filter((text: string): boolean => {
          return MARKUP_START.test(text);
        }),
      ).toEqual([]);
    });

    test("is held to the cases it should be: many different ones, with script, style and text elements", () => {
      expect(new Set(cases).size).toBeGreaterThan(10000);
      expect(
        cases.filter((html: string): boolean => {
          return holdsScriptElement(html);
        }).length,
      ).toBeGreaterThan(100);
    });
  },
);

/* ------------------------------ Rich descriptions ------------------------------ */

describe.each(KINDS)(
  "%s: a description in rich text",
  (_name: string, kind: CaseKind) => {
    test.each(RICH_DESCRIPTIONS)(
      "%s reads as the text it shows",
      async (_case: string, html: string, text: string) => {
        const record: JSONObject = await recordFor(kind, html);

        expect(descriptionPartOf(kind, record)).toBe(text);
        expect(record["proceed"]).toBe(true);
        expect(record["title"]).toBe(
          "Customers in the EU cannot complete checkout",
        );
      },
    );

    test.each(TYPED_MARKUP)(
      "%s reads as typed, and starts nothing",
      async (_case: string, html: string, text: string) => {
        const record: JSONObject = await recordFor(kind, html);
        const description: string = descriptionPartOf(kind, record);

        expect(description).toBe(text);
        expect(description).not.toMatch(TAG_START);
      },
    );

    test.each(RICH_STARTS)(
      "a description that starts with %s is read as rich text",
      async (start: string) => {
        const record: JSONObject = await recordFor(kind, `${start}<p>Text</p>`);

        expect(descriptionPartOf(kind, record)).toBe("Text");
      },
    );

    test("a description that is nothing but markup adds nothing to the record's description", async () => {
      for (const html of [
        richText(""),
        richText("<p>&nbsp;</p>"),
        "<style>p { color: red; }</style>",
      ]) {
        const record: JSONObject = await recordFor(kind, html);

        expect(record["description"]).toBe(headerOf(kind));
      }
    });
  },
);

/* ------------------------------ Plain descriptions ------------------------------ */

// The control characters the script drops, as it always has: all but tabs and line breaks.
function cleanedAsTheScriptDoes(text: string): string {
  return Array.from(text)
    .filter((character: string): boolean => {
      const code: number = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("");
}

describe.each(KINDS)(
  "%s: a description in plain text",
  (_name: string, kind: CaseKind) => {
    test.each(PLAIN_DESCRIPTIONS)(
      "%s is written exactly as before",
      async (_case: string, description: string, written: string) => {
        const record: JSONObject = await recordFor(kind, description);

        expect(descriptionPartOf(kind, record)).toBe(written);
        // What every description was written as before: the description as written, placed.
        expect(written).toBe(
          FeedMarkdown.reportedValue(
            cleanedAsTheScriptDoes(description).trim(),
          ),
        );
      },
    );

    test.each(PLAIN_STARTS)(
      "a description that starts with %s is plain text, written as before",
      async (start: string) => {
        const description: string = `${start} cannot log in since 9am`;
        const record: JSONObject = await recordFor(kind, description);

        expect(descriptionPartOf(kind, record)).toBe(
          FeedMarkdown.reportedValue(description),
        );
      },
    );

    test("no description is written as no description", async () => {
      for (const description of [null, "", "   \n  "]) {
        const record: JSONObject = await recordFor(kind, description);

        expect(record["description"]).toBe(headerOf(kind));
      }
    });
  },
);

describe("any text that does not start with a tag", () => {
  /*
   * Generated text after what plain text starts with: a word, or a "<" that
   * starts no tag - an address, a mention, a heart, a space. Whatever
   * markup follows, it is written exactly as before.
   */
  const STARTS: Array<string> = [
    "Note: ",
    "<@",
    "<!channel",
    "<#C",
    "<3",
    "< ",
    "<?php",
    "x",
  ];
  const generated: Array<string> = generatedTexts(1500, 8807, [
    ...MARKUP_ALPHABET,
    "<p>",
    "</div>",
    "<br>",
    "&lt;",
    "&amp;",
    "\u0001",
    "\r",
  ]);
  const descriptions: Array<string> = generated.map(
    (text: string, index: number): string => {
      return STARTS[index % STARTS.length] + text;
    },
  );
  let written: Array<string> = [];

  beforeAll(async () => {
    // One sandbox run: the step is swapped for a loop over the descriptions.
    written = (await runDynamicsScript({
      templateId: INCIDENT.templateId,
      componentId: INCIDENT.step,
      args: { descriptions: descriptions },
      editCode: (code: string): string => {
        // The step's own lines that read the description, run on each one.
        const start: number = code.indexOf(
          "// A description written in the rich-text editor",
        );
        const end: number = code.indexOf(
          "if (description) lines.push('', asWritten(description));",
        );

        if (start === -1 || end === -1 || end < start) {
          throw new Error("The step does not read its description here.");
        }

        return (
          code.slice(0, code.indexOf(CASE_STEP_SECTION)) +
          [
            "return (Array.isArray(args.descriptions) ? args.descriptions : []).map((value) => {",
            "const row = { description: value };",
            code.slice(start, end),
            "return asWritten(description);",
            "});",
          ].join("\n")
        );
      },
    })) as unknown as Array<string>;
  });

  test("is written exactly as before: placed as it was written", () => {
    expect(written).toHaveLength(descriptions.length);
    expect(
      descriptions.filter((description: string, index: number): boolean => {
        return (
          written[index] !==
          FeedMarkdown.reportedValue(cleanedAsTheScriptDoes(description).trim())
        );
      }),
    ).toEqual([]);
  });

  test("the generated descriptions are many different ones, many with markup in them", () => {
    expect(new Set(descriptions).size).toBeGreaterThan(1300);
    expect(
      descriptions.filter((description: string): boolean => {
        return description.slice(1).includes("<p>");
      }).length,
    ).toBeGreaterThan(100);
  });
});

/* ------------------------------ Nothing in them acts ------------------------------ */

describe("no description a case becomes holds markup a renderer acts on", () => {
  let readings: Array<Reading> = [];

  beforeAll(async () => {
    const descriptions: Array<string> = [];

    for (const [, html] of [
      ...RICH_DESCRIPTIONS,
      ...TYPED_MARKUP,
      ...PLAIN_DESCRIPTIONS,
    ]) {
      descriptions.push(
        String((await recordFor(INCIDENT, html))["description"]),
      );
    }

    readings = readingsOf(descriptions);
  });

  test("marked, the dashboard and Slack read no HTML, image, diagram, mention or link that hides where it goes", () => {
    for (const reading of readings) {
      expect(reading).toEqual({
        description: reading.description,
        ...NOTHING_ACTS,
      });
    }
  });

  test("the dashboard links each description to its case", () => {
    const pages: Array<string> = renderAsDashboard(
      readings.map((reading: Reading): string => {
        return reading.description;
      }),
    );

    for (const page of pages) {
      expect(hrefsOf(page)).toContain(CASE_URL);
    }
  });

  test("as typed, the markup in those descriptions would be read as markup", () => {
    // So the tests above are not passing on text Markdown leaves alone anyway.
    for (const [, , text] of TYPED_MARKUP.slice(0, 2)) {
      const typed: string = text.replace(WORD_JOINER_RUN, "");

      expect(
        tokensOf(typed).some((token: Token): boolean => {
          return ["html", "image", "link"].includes(token.type);
        }),
      ).toBe(true);
    }

    expect(
      SlackUtil.convertMarkdownToSlackRichText("<!channel> please look"),
    ).toMatch(SLACK_MENTION);
  });
});

/* --------------------------- References, as a browser --------------------------- */

/*
 * The names the reading knows, besides the five every editor writes: the
 * Latin-1 ones, 160 to 255, and the typographic ones an email writes.
 */
const KNOWN_NAMES: Array<string> = [
  ..."nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest".split(
    " ",
  ),
  ..."Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig".split(
    " ",
  ),
  ..."agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " ",
  ),
  ..."OElig oelig Scaron scaron Yuml fnof circ tilde ensp emsp thinsp zwnj zwj lrm rlm ndash mdash lsquo rsquo sbquo ldquo rdquo bdquo dagger Dagger bull hellip permil prime Prime lsaquo rsaquo oline frasl euro trade larr uarr rarr darr harr minus le ge ne asymp infin".split(
    " ",
  ),
  "lt",
  "gt",
  "quot",
  "apos",
  "amp",
];

// What a browser shows of text holding references (JSDOM parses it as HTML).
function asABrowserShows(text: string): string {
  return JSDOM.fragment(`<p>${text}</p>`).textContent || "";
}

/*
 * Where the reading reads a reference other than as a browser shows it, on
 * purpose: a no-break space is a space, as &nbsp; always was, and a number
 * Windows-1252 has no character for is the replacement character, not a
 * control character.
 */
function asTheReadingShows(browserText: string): string {
  return Array.from(browserText)
    .map((character: string): string => {
      const code: number = character.codePointAt(0)!;

      if (code === 0xa0) {
        return " ";
      }

      return code >= 0x80 && code <= 0x9f ? "\ufffd" : character;
    })
    .join("");
}

describe("references, as a browser reads them", () => {
  const NUMBERS: Array<number> = [
    ...Array.from({ length: 0x300 }, (_value: unknown, index: number) => {
      return index;
    }).filter((code: number): boolean => {
      // A browser drops a NUL, and reads CR and the like as white space in a text.
      return code >= 32 && code !== 127;
    }),
    0xd7ff,
    0xd800,
    0xdbff,
    0xdc00,
    0xdfff,
    0xe000,
    0xfeff,
    0xfffd,
    0xfffe,
    0xffff,
    0x10000,
    0x1f600,
    0x10ffff,
    0x110000,
    0x7fffffff,
    0x2013,
    0x2014,
    0x2018,
    0x2019,
    0x201c,
    0x201d,
    0x20ac,
    0x2122,
    0x200b,
    0x200c,
    0x200d,
    0x200e,
    0x200f,
  ];
  const references: Array<string> = [
    ...KNOWN_NAMES.map((name: string): string => {
      return `&${name};`;
    }),
    ...NUMBERS.map((code: number): string => {
      return `&#${code};`;
    }),
    ...NUMBERS.map((code: number): string => {
      return `&#x${code.toString(16)};`;
    }),
    ...NUMBERS.map((code: number): string => {
      return `&#X${code.toString(16).toUpperCase()};`;
    }),
    "&#0000000000000065;",
    "&#x00000041;",
  ];
  let read: Array<string> = [];

  beforeAll(async () => {
    read = (await runDynamicsScript({
      templateId: INCIDENT.templateId,
      componentId: INCIDENT.step,
      args: { texts: references },
      editCode: (code: string): string => {
        return (
          code.slice(0, code.indexOf(CASE_STEP_SECTION)) +
          "return (Array.isArray(args.texts) ? args.texts : []).map((text) => readEntities(text));"
        );
      },
    })) as unknown as Array<string>;
  });

  test("reads every name it knows, and every number, as a browser shows it", () => {
    expect(read).toHaveLength(references.length);
    expect(
      references
        .map((reference: string, index: number): string => {
          return read[index] === asTheReadingShows(asABrowserShows(reference))
            ? ""
            : `${reference} (entry ${index}) -> ${JSON.stringify(read[index])}`;
        })
        .filter((difference: string): boolean => {
          return difference !== "";
        }),
    ).toEqual([]);
  });

  test("reads the five every editor writes in any letter case, as it always has", async () => {
    const texts: Array<string> = [
      "&NBSP;",
      "&Lt;",
      "&GT;",
      "&Quot;",
      "&APOS;",
      "&AMP;",
    ];
    const upper: Array<string> = (await runDynamicsScript({
      templateId: INCIDENT.templateId,
      componentId: INCIDENT.step,
      args: { texts: texts },
      editCode: (code: string): string => {
        return (
          code.slice(0, code.indexOf(CASE_STEP_SECTION)) +
          "return args.texts.map((text) => readEntities(text));"
        );
      },
    })) as unknown as Array<string>;

    expect(upper).toEqual([" ", "<", ">", '"', "'", "&"]);
  });

  test("leaves a name it does not know, and a reference with no ';', as written", async () => {
    const texts: Array<string> = [
      "&bogus;",
      "&foobar;",
      "&Rsquo;",
      "&copy",
      "&#169",
      "&#x;",
      "&#;",
      "AT&T",
      "a & b",
      "&",
    ];
    const kept: Array<string> = (await runDynamicsScript({
      templateId: INCIDENT.templateId,
      componentId: INCIDENT.step,
      args: { texts: texts },
      editCode: (code: string): string => {
        return (
          code.slice(0, code.indexOf(CASE_STEP_SECTION)) +
          "return args.texts.map((text) => readEntities(text));"
        );
      },
    })) as unknown as Array<string>;

    expect(kept).toEqual(texts);
  });

  test("reads each reference once: what one reads as is never read again", async () => {
    const texts: Array<string> = [
      "&#38;lt;",
      "&amp;lt;",
      "&#x26;amp;",
      "&amp;#60;",
      "&#38;#60;",
      "&&lt;",
      "&lt;&amp;gt;",
    ];
    const once: Array<string> = (await runDynamicsScript({
      templateId: INCIDENT.templateId,
      componentId: INCIDENT.step,
      args: { texts: texts },
      editCode: (code: string): string => {
        return (
          code.slice(0, code.indexOf(CASE_STEP_SECTION)) +
          "return args.texts.map((text) => readEntities(text));"
        );
      },
    })) as unknown as Array<string>;

    expect(once).toEqual([
      "&lt;",
      "&lt;",
      "&amp;",
      "&#60;",
      "&#60;",
      "&<",
      "<&gt;",
    ]);
    // As a browser shows them.
    expect(once).toEqual(
      texts.map((text: string): string => {
        return asABrowserShows(text);
      }),
    );
  });
});

/* ---------------------------------- Time ---------------------------------- */

describe("time", () => {
  /*
   * A description can be long: Dataverse keeps up to a megabyte of text in a
   * multiple-lines column. Each one here is read well inside the sandbox's
   * own limit.
   */
  const LIMIT_IN_MS: number = 3000;
  const SIZE: number = 100000;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  test.each([
    ["tags that never close", `<div>${repeatTo("<a")}&amp;`],
    ["values that never close", `<div>${repeatTo('<a b="')}&amp;`],
    ["a run of '<' before an unclosed value", `<div>${repeatTo("<")}=">`],
    ["spaces before the end of a line", `<p>${repeatTo(" ")}x</p>`],
    ["comment openings", `<p>${repeatTo("<!--")}x</p>`],
    ["script start tags that never end", `<p>${repeatTo("<script>")}x</p>`],
    ["style elements", `<p>${repeatTo("<style>a</style>")}x</p>`],
    [
      "title start tags before one end tag",
      `<p>${repeatTo("<title>a")}</title>`,
    ],
    ["textarea end tags with no start", `<p>${repeatTo("</textarea>")}x</p>`],
    ["line breaks in a row", `<p>a${repeatTo("\n")}b</p>`],
    ["fences and references", `<p>${repeatTo("```&#109;")}</p>`],
    ["plain text full of '<'", `Note: ${repeatTo("<a ")}`],
  ])(
    "reads a description of %s in linear time",
    async (_case: string, description: string) => {
      const started: number = Date.now();
      const record: JSONObject = await recordFor(INCIDENT, description);

      expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);
      expect(record["proceed"]).toBe(true);
      // Cut at the record's 20,000 characters, which ends in "…".
      expect(String(record["description"]).length).toBeLessThanOrEqual(20000);
    },
  );
});
