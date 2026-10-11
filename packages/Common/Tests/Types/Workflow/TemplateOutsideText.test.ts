/*
 * TEXT FROM JIRA AND DYNAMICS 365, PLACED IN ONEUPTIME AS IT WAS WRITTEN.
 *
 * The Jira and Dynamics 365 templates that bring the other system into
 * OneUptime write what people wrote there into Markdown: an incident's or an
 * alert's title and description (the create templates), a private note (the
 * comment, issue-change and case-note templates) and the cause of a state
 * change (the status templates). The dashboard renders that Markdown, the
 * emails render it, and it is posted as feed items to the project's Slack
 * and Microsoft Teams channels.
 *
 * The scripts placed the other system's text as it came - the case-note
 * script aside, which #4671 moved first. So an image in a Jira comment was
 * fetched by every responder's browser that showed the note, a link's words
 * could hide where it went, raw HTML was read where Teams reads HTML, a
 * mermaid fence was drawn as a diagram, and "<!channel>" in a case's title
 * reached a whole Slack channel as a mention. Now every part that came from
 * outside goes in through asWritten, the copy of FeedMarkdown.reportedValue
 * that every Jira and Dynamics 365 script carries in its helper block (the
 * workflow sandbox can import nothing). These tests:
 *
 *   - hold asWritten to reportedValue, on the cases DynamicsNoteMarkup.test.ts
 *     held the note script's copy to (they moved here with the copy);
 *   - check that every Jira and Dynamics 365 script carries the same copy,
 *     and that every script output a template writes into a record is one
 *     of the outputs these tests check, or data that is checked before it is
 *     returned;
 *   - run each script that writes OneUptime text in the real sandbox on
 *     payloads as Jira Cloud's webhooks and the Dataverse Web API send them,
 *     and pin what each writes: exactly what it wrote before this change;
 *   - give each one text holding an image, a link, a link definition, raw
 *     HTML, a comment, a mermaid diagram and chat mentions in every part that
 *     came from outside, and check that what it writes reads exactly as
 *     typed while marked (the emails), the dashboard's parser and Slack's
 *     conversion find nothing in it to act on, and no "<" in it starts
 *     anything (Teams reads HTML);
 *   - check that a link to a Jira issue can only ever go to a site;
 *   - read long values in time that grows with their length alone.
 */

import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../Types/Workflow/Templates";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { decodeHtmlEntities } from "../../Helpers/HtmlText";
import { renderAsDashboard } from "../../Utils/Markdown/DashboardMarkdownRenderer";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  CASE_ID,
  CASE_NUMBER,
  DYNAMICS_URL,
  LINK_COLUMN,
  NoteRowProps,
  caseRow,
  formattedKey,
  noteRow,
  runDynamicsScript,
} from "./DynamicsTemplateFixtures";
import {
  ALERT_ID,
  ALERT_SEVERITIES,
  ALERT_STATES,
  INCIDENT_ID,
  INCIDENT_SEVERITIES,
  INCIDENT_STATES,
  JIRA_ISSUE_KEY,
  JIRA_SITE,
  alertLabel,
  alertModel,
  changelogItem,
  incidentLabel,
  incidentModel,
  jiraCommentEvent,
  jiraIssueCreatedEvent,
  jiraIssueUpdatedEvent,
  jiraLinkingEventArgs,
  jiraUser,
  quoted,
  runJiraScript,
  scriptOf,
} from "./JiraTemplateFixtures";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { Token, marked } from "marked";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

const J: string = WORD_JOINER;
const WORD_JOINER_RUN: RegExp = new RegExp(WORD_JOINER, "g");

// A "<" that starts something - a tag, a comment, an address, a mention: placed text holds none.
const TAG_START: RegExp = new RegExp(`<(?![\\s${WORD_JOINER}])`);

// A "<" that starts markup as a browser reads it. A value cut short can end in a "<" and the "…".
const MARKUP_START: RegExp = /<[A-Za-z/!?]/;

// A mention, and a link labelled with words, as Slack reads them: right after a "<".
const SLACK_MENTION: RegExp = /<[!@#][A-Za-z0-9]/;
const SLACK_LINK: RegExp = /<([A-Za-z][A-Za-z0-9+.-]*:[^<>|\s]*)\|([^<>]*)>/g;
const DASHBOARD_IMAGE: RegExp = /<img/;
const DASHBOARD_DIAGRAM: RegExp = /language-mermaid/i;
const DASHBOARD_ANCHOR: RegExp = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g;

const HELPER_SECTION: string =
  "// ---- Placing text written outside OneUptime ----\n";
const STEP_SECTION: string = "\n// ---- What this step does ----\n";

const ISSUE_URL: string = `${JIRA_SITE}/browse/${JIRA_ISSUE_KEY}`;
const ISSUE_LINK: string = `[${JIRA_ISSUE_KEY}](${ISSUE_URL})`;
const CASE_URL: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;

function withoutJoiners(text: string): string {
  return text.replace(WORD_JOINER_RUN, "");
}

function textOf(result: JSONObject, key: string): string {
  const value: JSONValue | undefined = result[key];

  if (typeof value !== "string") {
    throw new Error(
      `${key} is not text: ${JSON.stringify(result).slice(0, 300)}`,
    );
  }

  return value;
}

/* ------------------------------ The two kinds ------------------------------ */

interface RecordKind {
  noun: string;
  Created: string;
  id: string;
  idKey: string;
  // The label a linked issue carries, and the value a linked case's link column holds.
  link: string;
  severities: Array<JSONObject>;
  states: Array<JSONObject>;
  record: JSONObject;
  jira: {
    createRecord: string;
    prepare: string;
    statusToState: string;
    commentToNote: string;
    changesToNote: string;
  };
  dynamics: {
    createRecord: string;
    prepare: string;
    statusToState: string;
    noteToRecord: string;
  };
}

const INCIDENT: RecordKind = {
  noun: "incident",
  Created: "Declared",
  id: INCIDENT_ID,
  idKey: "incidentId",
  link: incidentLabel(),
  severities: INCIDENT_SEVERITIES,
  states: INCIDENT_STATES,
  record: incidentModel(),
  jira: {
    createRecord: "jira-declare-incident-from-issue",
    prepare: "prepare-incident-1",
    statusToState: "jira-status-to-incident-state",
    commentToNote: "jira-comment-to-incident-private-note",
    changesToNote: "jira-issue-changes-to-incident-private-note",
  },
  dynamics: {
    createRecord: "dynamics-declare-incident-from-case",
    prepare: "prepare-incident-1",
    statusToState: "dynamics-case-status-to-incident-state",
    noteToRecord: "dynamics-case-note-to-incident-private-note",
  },
};

const ALERT: RecordKind = {
  noun: "alert",
  Created: "Created",
  id: ALERT_ID,
  idKey: "alertId",
  link: alertLabel(),
  severities: ALERT_SEVERITIES,
  states: ALERT_STATES,
  record: alertModel(),
  jira: {
    createRecord: "jira-create-alert-from-issue",
    prepare: "prepare-alert-1",
    statusToState: "jira-status-to-alert-state",
    commentToNote: "jira-comment-to-alert-private-note",
    changesToNote: "jira-issue-changes-to-alert-private-note",
  },
  dynamics: {
    createRecord: "dynamics-create-alert-from-case",
    prepare: "prepare-alert-1",
    statusToState: "dynamics-case-status-to-alert-state",
    noteToRecord: "dynamics-case-note-to-alert-private-note",
  },
};

const KINDS: Array<[string, RecordKind]> = [
  ["incident", INCIDENT],
  ["alert", ALERT],
];

/* ------------------------------ The scripts ------------------------------ */

/*
 * The Jira scripts that link to the issue get the workflow's Jira Site URL
 * beside the event. JIRA_SITE unless a test says otherwise, as the create
 * wizard stores it; null leaves the setting out (a workflow whose arguments
 * no longer name it).
 */

// create-*-from-issue: a Jira issue_created webhook, as the request body.
async function recordFromIssue(
  kind: RecordKind,
  event: JSONObject,
  site: string | null = JIRA_SITE,
): Promise<JSONObject> {
  return await runJiraScript({
    templateId: kind.jira.createRecord,
    componentId: kind.jira.prepare,
    args: {
      severities: quoted(kind.severities),
      ...jiraLinkingEventArgs(event, site),
    },
  });
}

interface JiraStatusChange {
  jiraStatus: string;
  changedBy: string;
  jiraStatusCategory?: string | undefined;
}

// status-to-*-state: read-event-1's output for a linked issue that moved.
async function causeFromIssue(
  kind: RecordKind,
  change: JiraStatusChange,
): Promise<JSONObject> {
  return await runJiraScript({
    templateId: kind.jira.statusToState,
    componentId: "decide-state-1",
    args: {
      [kind.noun]: quoted(kind.record),
      states: quoted(kind.states),
      event: quoted({
        proceed: true,
        [kind.idKey]: kind.id,
        issueKey: JIRA_ISSUE_KEY,
        jiraStatus: change.jiraStatus,
        jiraStatusCategory: change.jiraStatusCategory || "done",
        changedBy: change.changedBy,
      }),
    },
  });
}

// comment-to-*-private-note: a Jira comment_created webhook.
async function noteFromComment(
  kind: RecordKind,
  event: JSONObject,
  site: string | null = JIRA_SITE,
): Promise<JSONObject> {
  return await runJiraScript({
    templateId: kind.jira.commentToNote,
    componentId: "read-comment-1",
    args: jiraLinkingEventArgs(event, site),
  });
}

// issue-changes-to-*-private-note: a jira:issue_updated webhook for a linked issue.
async function noteFromChanges(
  kind: RecordKind,
  items: Array<JSONObject>,
  props?: {
    user?: JSONObject | undefined;
    self?: string | undefined;
    site?: string | null | undefined;
  },
): Promise<JSONObject> {
  return await runJiraScript({
    templateId: kind.jira.changesToNote,
    componentId: "read-changes-1",
    args: jiraLinkingEventArgs(
      jiraIssueUpdatedEvent({
        labels: [kind.link],
        items: items,
        user: props?.user,
        self: props?.self,
      }),
      props?.site === undefined ? JIRA_SITE : props.site,
    ),
  });
}

// create-*-from-case: the case as the Web API returned it.
async function recordFromCase(
  kind: RecordKind,
  row: JSONObject,
): Promise<JSONObject> {
  return await runDynamicsScript({
    templateId: kind.dynamics.createRecord,
    componentId: kind.dynamics.prepare,
    args: {
      severities: quoted(kind.severities),
      dynamicsUrl: DYNAMICS_URL,
      linkColumn: LINK_COLUMN,
      case: quoted(row),
    },
  });
}

interface CaseStatusChange {
  caseNumber: string;
  caseStatusText: string;
  changedBy: string;
}

// case-status-to-*-state: find-link-1's output for a resolved case.
async function causeFromCase(
  kind: RecordKind,
  change: CaseStatusChange,
): Promise<JSONObject> {
  return await runDynamicsScript({
    templateId: kind.dynamics.statusToState,
    componentId: "decide-state-1",
    args: {
      [kind.noun]: quoted(kind.record),
      states: quoted(kind.states),
      link: quoted({
        proceed: true,
        [kind.idKey]: kind.id,
        caseId: CASE_ID,
        caseNumber: change.caseNumber,
        caseState: 1,
        caseStateName: "Resolved",
        caseStatus: 5,
        caseStatusName: change.caseStatusText,
        caseStatusText: change.caseStatusText,
        changedBy: change.changedBy,
      }),
    },
  });
}

// case-note-to-*-private-note: the note as the Web API returned it.
async function noteFromCase(
  kind: RecordKind,
  props: NoteRowProps,
): Promise<JSONObject> {
  return await runDynamicsScript({
    templateId: kind.dynamics.noteToRecord,
    componentId: "read-note-1",
    args: {
      dynamicsUrl: DYNAMICS_URL,
      linkColumn: LINK_COLUMN,
      note: quoted(noteRow({ link: kind.link, ...props })),
    },
  });
}

// A case row with the priority's display text Dataverse sends set to the given words.
function withPriorityName(row: JSONObject, name: string): JSONObject {
  return { ...row, [formattedKey("prioritycode")]: name };
}

/* -------------------------- What a renderer reads -------------------------- */

// Every token marked (the emails) reads in a text, nested ones included.
function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
    tokens.push(token);
  });

  return tokens;
}

/*
 * Whether a link shows where it goes: one of the template's own links, or
 * an address made a link under its own words - as every renderer makes one
 * of an address somebody types.
 */
function showsWhereItGoes(
  href: string,
  words: string,
  ownLinks: Array<string>,
): boolean {
  if (ownLinks.includes(href)) {
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
  text: string;
  // What marked reads as raw HTML, as an image, or as a link a person wrote.
  html: Array<string>;
  images: number;
  links: Array<string>;
  // What the dashboard's parser draws.
  dashboardImage: boolean;
  dashboardDiagram: boolean;
  dashboardHidingLinks: Array<string>;
  // What Slack is sent.
  slackMention: boolean;
  slackHidingLinks: Array<string>;
  // A "<" that starts something, for Teams.
  tagStart: boolean;
}

const NOTHING_ACTS: Omit<Reading, "text"> = {
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

/*
 * How each renderer reads each text: the dashboard's parser runs in a child
 * process (DashboardMarkdownRenderer), so every text is read in one call.
 */
function readingsOf(
  texts: Array<string>,
  ownLinks: Array<string>,
): Array<Reading> {
  const pages: Array<string> = renderAsDashboard(texts);

  return texts.map((text: string, index: number): Reading => {
    const tokens: Array<Token> = tokensOf(text);
    const page: string = pages[index]!;
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(text);

    return {
      text: text,
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
            !ownLinks.includes((token as Token & { href: string }).href)
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
            decodeHtmlEntities(anchor[1]!),
            decodeHtmlEntities(anchor[2]!),
            ownLinks,
          );
        })
        .map((anchor: RegExpMatchArray): string => {
          return anchor[0];
        }),
      slackMention: SLACK_MENTION.test(slack),
      slackHidingLinks: Array.from(slack.matchAll(SLACK_LINK))
        .filter((link: RegExpMatchArray): boolean => {
          return !showsWhereItGoes(link[1]!, link[2]!, ownLinks);
        })
        .map((link: RegExpMatchArray): string => {
          return link[0];
        }),
      tagStart: TAG_START.test(text),
    };
  });
}

/* ------------------------------ Outside text ------------------------------ */

/*
 * What somebody can write in Jira or Dynamics 365 that a renderer acts on:
 * an image (fetched by every reader's browser), a link whose words hide
 * where it goes, a link definition another value's image could use, raw
 * HTML and a comment (Teams reads HTML), chat mentions and a Slack link, an
 * address in brackets, and a mermaid diagram.
 */
const HOSTILE_LINE: string =
  '![chart](https://tracker.example/p.png) [Reset your password](https://login.example/reset) <img src=x onerror=alert(1)> <a href="https://evil.example">click</a> <!-- hidden --> <!channel> <!here> <@U0123ABC> <#C0123ABC> <https://evil.example|Open the runbook> <https://evil.example> ```mermaid [logo]';

const HOSTILE_TEXT: string = [
  "![chart](https://tracker.example/p.png)",
  "",
  "[Reset your password](https://login.example/reset)",
  "",
  "[logo]: https://tracker.example/logo.png",
  "",
  '<img src=x onerror=alert(1)> <a href="https://evil.example">click</a> <!-- the rest is hidden -->',
  "",
  "<!channel> <!here> <@U0123ABC> <#C0123ABC> <https://evil.example|Open the runbook> <https://evil.example>",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
].join("\n");

/* ------------------------------ The helpers ------------------------------ */

interface ScriptStep {
  templateId: string;
  componentId: string;
}

// Every script step of every Jira and Dynamics 365 template.
function integrationScripts(): Array<ScriptStep> {
  const steps: Array<ScriptStep> = [];

  for (const template of getWorkflowTemplates()) {
    if (
      !template.id.startsWith("jira-") &&
      !template.id.startsWith("dynamics-")
    ) {
      continue;
    }

    const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
      template.id,
    ) as unknown as { nodes: Array<JSONObject> } | null;

    for (const node of spec?.nodes || []) {
      if (node["metadataId"] === ComponentID.JavaScriptCode) {
        steps.push({
          templateId: template.id,
          componentId: String(node["componentId"]),
        });
      }
    }
  }

  return steps;
}

// The placing helpers a script carries: from their heading to where the step's own code starts.
function placingHelpersOf(code: string): string {
  const start: number = code.indexOf(HELPER_SECTION);
  const end: number = code.indexOf(STEP_SECTION);

  if (start === -1 || end === -1 || end < start) {
    return "";
  }

  return code.slice(start, end);
}

describe("the helpers every Jira and Dynamics 365 script starts with", () => {
  const scripts: Array<ScriptStep> = integrationScripts();

  test("finds the Jira and the Dynamics 365 scripts", () => {
    const templates: Set<string> = new Set(
      scripts.map((script: ScriptStep): string => {
        return script.templateId;
      }),
    );

    // 17 Jira templates and 13 Dynamics 365 ones, each with one script or more.
    expect(templates.size).toBe(30);
    expect(scripts).toHaveLength(44);
  });

  test("every script carries the very same placing helpers, in its helper block", () => {
    const first: string = placingHelpersOf(
      scriptOf(INCIDENT.jira.commentToNote, "read-comment-1"),
    );

    expect(first).toContain("const asWritten = (value) => {");

    const different: Array<string> = scripts
      .filter((script: ScriptStep): boolean => {
        return (
          placingHelpersOf(scriptOf(script.templateId, script.componentId)) !==
          first
        );
      })
      .map((script: ScriptStep): string => {
        return `${script.templateId} ${script.componentId}`;
      });

    expect(different).toEqual([]);
  });

  test("they are generic: neither system and neither kind of record is named in them", () => {
    const helpers: string = placingHelpersOf(
      scriptOf(INCIDENT.jira.commentToNote, "read-comment-1"),
    );

    for (const name of ["Jira", "Dynamics", "incident", "alert", "declar"]) {
      expect({ name, named: helpers.includes(name) }).toEqual({
        name,
        named: false,
      });
    }
  });

  test("nothing else in a script defines asWritten again", () => {
    for (const script of scripts) {
      const code: string = scriptOf(script.templateId, script.componentId);

      expect({
        script: `${script.templateId} ${script.componentId}`,
        definitions: code.split("const asWritten = ").length - 1,
      }).toEqual({
        script: `${script.templateId} ${script.componentId}`,
        definitions: 1,
      });
    }
  });
});

/* --------------------------- Held to reportedValue --------------------------- */

/*
 * The helpers run on every case at once, in one sandbox run of a script: its
 * step is swapped for a line that calls asWritten. Once with a Jira script
 * and once with a Dynamics 365 one, as each carries its own copy.
 */
const PLACING_HARNESS: string =
  "return (Array.isArray(args.cases) ? args.cases : []).map((value) => asWritten(value));";

async function placedByScript(
  run: typeof runJiraScript,
  step: ScriptStep,
  cases: Array<string>,
): Promise<Array<string>> {
  return (await run({
    templateId: step.templateId,
    componentId: step.componentId,
    args: { cases: cases },
    editCode: (code: string): string => {
      return (
        code.slice(0, code.indexOf(STEP_SECTION) + STEP_SECTION.length) +
        PLACING_HARNESS
      );
    },
  })) as unknown as Array<string>;
}

/*
 * Text made of what Markdown, HTML and chat tools act on - fences, the word
 * "mermaid" and references that spell it, brackets, mentions - so every rule
 * of FeedMarkdown.reportedValue is reached.
 */
const MARKDOWN_ALPHABET: Array<string> = [
  "<",
  ">",
  "!",
  "[",
  "]",
  "(",
  ")",
  ":",
  "```",
  "~~~",
  "`",
  "~",
  "mermaid",
  "MerMaid",
  "&#109;",
  "&#x6D;",
  "ermaid",
  "&",
  "#",
  ";",
  "x",
  "1",
  " ",
  "\t",
  "\n",
  "\r",
  "@",
  "!channel",
  "-",
  "/",
  "|",
  "{",
  "}",
  WORD_JOINER,
  "\u00a0",
  "é",
  "😀",
];

// Every shape a fence and its language can take, with and without "mermaid" in it.
function fenceShapes(): Array<string> {
  const shapes: Array<string> = [];

  for (const before of ["", " ", "> ", "- ", "text "]) {
    for (const fence of ["```", "~~~", "````", "``", "~~"]) {
      for (const gap of ["", " ", "\t", "  "]) {
        for (const language of [
          "mermaid",
          "MERMAID",
          "&#109;ermaid",
          "&#x6D;ermaid",
          "&#X6d;ERMAID",
          "mer&#109;aid",
          "&#0109;ermaid",
          "&#109ermaid",
          `${WORD_JOINER}mermaid`,
          "mermaid-js",
          "text mermaid",
          "&#1;mermaid",
          "&#xD800;mermaid",
          "&#99999999999;mermaid",
        ]) {
          shapes.push(`${before}${fence}${gap}${language}\ngraph TD`);
        }
      }
    }
  }

  return shapes;
}

/*
 * Text as people write it in an issue, a comment or a case, with nothing in
 * it a renderer acts on: words, numbers, lists, emphasis, code, quotes,
 * ampersands, entities, braces, a "<" with a space after it, other scripts.
 */
const PLAIN_ALPHABET: Array<string> = [
  "word",
  " ",
  "\n",
  "\t",
  "- ",
  "* ",
  "1. ",
  "*",
  "_",
  "&",
  "&amp;",
  "< ",
  ">",
  "`",
  "#",
  "(",
  ")",
  ":",
  ".",
  ",",
  "'",
  '"',
  "%",
  "$",
  "{",
  "}",
  "|",
  "=",
  "/",
  "\\",
  "数据",
  "é",
];

const REPORTED: Array<string> = [
  '<html><body><a href="https://evil.example">Reset your password</a></body></html>',
  "[Verify your account](https://evil.example/login)",
  "![](https://tracker.example/p.png)",
  "<!channel> checkout is down <@U0123ABC>",
  "x` [link](https://evil.example) `y",
  "line one\n```\n[Open](https://evil.example)\n```",
  '```mermaid\nflowchart TD\n  A@{ img: "https://tracker.example/m.png" }',
  "[a]: https://tracker.example/p.png",
  "<https://evil.example>",
  "<![CDATA[x]]> <!DOCTYPE html> <!-- c --> <# ps #>",
  "x < y and y > z",
  "Reset]",
  "",
  HOSTILE_LINE,
  HOSTILE_TEXT,
];

describe.each([
  [
    "a Jira script",
    runJiraScript,
    { templateId: INCIDENT.jira.commentToNote, componentId: "read-comment-1" },
  ],
  [
    "a Dynamics 365 script",
    runDynamicsScript,
    {
      templateId: ALERT.dynamics.createRecord,
      componentId: ALERT.dynamics.prepare,
    },
  ],
])(
  "asWritten, as %s carries it",
  (_name: string, run: typeof runJiraScript, step: ScriptStep) => {
    const generated: Array<string> = generatedTexts(
      20000,
      1618,
      MARKDOWN_ALPHABET,
    );
    const reported: Array<string> = [
      ...REPORTED,
      ...fenceShapes(),
      ...generated,
    ];
    const plain: Array<string> = generatedTexts(2000, 4242, PLAIN_ALPHABET);
    const cases: Array<string> = [...reported, ...plain];
    let placed: Array<string> = [];
    let placedTwice: Array<string> = [];

    beforeAll(async () => {
      placed = await placedByScript(run, step, cases);
      placedTwice = await placedByScript(run, step, placed);
    });

    test("is held to that many different texts", () => {
      // Only the shortest texts repeat: there are only 37 texts of one piece, for one.
      expect(new Set(generated).size).toBeGreaterThan(18000);
      expect(new Set(plain).size).toBeGreaterThan(1800);
    });

    test("places text exactly as FeedMarkdown.reportedValue does", () => {
      expect(placed).toHaveLength(cases.length);

      const differences: Array<[string, string, string]> = [];

      cases.forEach((text: string, index: number): void => {
        const expected: string = FeedMarkdown.reportedValue(text);

        if (placed[index] !== expected) {
          differences.push([text, placed[index]!, expected]);
        }
      });

      expect(differences.slice(0, 5)).toEqual([]);
    });

    test("keeps every character, adding only invisible joiners", () => {
      expect(
        cases.filter((text: string, index: number): boolean => {
          return withoutJoiners(placed[index]!) !== withoutJoiners(text);
        }),
      ).toEqual([]);
    });

    test("leaves no '<' that starts anything", () => {
      expect(
        placed.filter((text: string): boolean => {
          return TAG_START.test(text);
        }),
      ).toEqual([]);
    });

    test("places text already placed exactly as it is", () => {
      expect(
        placed.filter((text: string, index: number): boolean => {
          return placedTwice[index] !== text;
        }),
      ).toEqual([]);
    });

    test("leaves text with nothing in it to act on exactly as it was written", () => {
      // Words, lists, emphasis, code, quotes, "&", "&amp;", a "<" with a space after it, "{" and "}".
      expect(
        plain.filter((text: string, index: number): boolean => {
          return placed[reported.length + index] !== text;
        }),
      ).toEqual([]);
    });
  },
);

/*
 * Every output a template writes into a record that came from one of its
 * scripts. Text is placed with asWritten and checked below; everything else
 * is data that each script checks before it returns it.
 */
const PLACED_OUTPUTS: Array<string> = [
  "jira-declare-incident-from-issue prepare-incident-1 title -> title",
  "jira-declare-incident-from-issue prepare-incident-1 description -> description",
  "jira-create-alert-from-issue prepare-alert-1 title -> title",
  "jira-create-alert-from-issue prepare-alert-1 description -> description",
  "jira-status-to-incident-state decide-state-1 rootCause -> rootCause",
  "jira-status-to-alert-state decide-state-1 rootCause -> rootCause",
  "jira-comment-to-incident-private-note read-comment-1 note -> note",
  "jira-comment-to-alert-private-note read-comment-1 note -> note",
  "jira-issue-changes-to-incident-private-note read-changes-1 note -> note",
  "jira-issue-changes-to-alert-private-note read-changes-1 note -> note",
  "dynamics-declare-incident-from-case prepare-incident-1 title -> title",
  "dynamics-declare-incident-from-case prepare-incident-1 description -> description",
  "dynamics-create-alert-from-case prepare-alert-1 title -> title",
  "dynamics-create-alert-from-case prepare-alert-1 description -> description",
  "dynamics-case-status-to-incident-state decide-state-1 rootCause -> rootCause",
  "dynamics-case-status-to-alert-state decide-state-1 rootCause -> rootCause",
  "dynamics-case-note-to-incident-private-note read-note-1 note -> note",
  "dynamics-case-note-to-alert-private-note read-note-1 note -> note",
];

const DATA_OUTPUTS: Record<string, string> = {
  "incidentSeverityId -> incidentSeverityId":
    "the id of one of the project's own severities",
  "alertSeverityId -> alertSeverityId":
    "the id of one of the project's own severities",
  "issueKey -> customFields.jiraIssueKey": "a key that matched ISSUE_KEY",
  "caseId -> customFields.dynamicsCaseId": "a Dataverse id, read by guidOf",
  "caseNumber -> customFields.dynamicsCaseNumber":
    "the case number, kept as it is as the custom field's value",
  "incidentId -> incidentId": "an id read off a label or a link column",
  "alertId -> alertId": "an id read off a label or a link column",
  "stateId -> incidentStateId": "the id of one of the project's own states",
  "stateId -> alertStateId": "the id of one of the project's own states",
};

// A reference to another step's output: its component and the path of the value.
const STEP_OUTPUT_REFERENCE: RegExp =
  /\{\{local\.components\.([A-Za-z0-9-]+)\.returnValues\.([A-Za-z0-9_.-]+)\}\}/g;
const DATABASE_WRITE: RegExp = /-(create|update)-(one|many)$/;

interface WrittenOutput {
  templateId: string;
  component: string;
  output: string;
  column: string;
}

function outputsWrittenInto(
  value: JSONValue,
  column: string,
  into: Array<[string, string, string]>,
): void {
  if (typeof value === "string") {
    for (const reference of value.matchAll(STEP_OUTPUT_REFERENCE)) {
      into.push([reference[1]!, reference[2]!, column]);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      outputsWrittenInto(entry, column, into);
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      outputsWrittenInto(
        entry as JSONValue,
        column ? `${column}.${key}` : key,
        into,
      );
    }
  }
}

// Every value of every template's database write that another step's output fills in.
function writtenOutputs(): Array<WrittenOutput> {
  const written: Array<WrittenOutput> = [];

  for (const template of getWorkflowTemplates()) {
    const spec: { nodes: Array<JSONObject> } | null = getTemplateGraphSpec(
      template.id,
    ) as unknown as { nodes: Array<JSONObject> } | null;

    for (const node of spec?.nodes || []) {
      if (!DATABASE_WRITE.test(String(node["metadataId"]))) {
        continue;
      }

      const references: Array<[string, string, string]> = [];

      for (const [key, argument] of Object.entries(
        (node["args"] as JSONObject | undefined) || {},
      )) {
        let value: JSONValue = argument as JSONValue;

        if (typeof argument === "string") {
          try {
            value = JSON.parse(argument) as JSONValue;
          } catch {
            value = argument;
          }
        }

        // The json argument holds the row; its keys are the columns.
        outputsWrittenInto(value, key === "json" ? "" : key, references);
      }

      for (const [component, output, column] of references) {
        written.push({
          templateId: template.id,
          component: component,
          output: output,
          column: column,
        });
      }
    }
  }

  return written;
}

describe("every output a template writes into a record", () => {
  const written: Array<WrittenOutput> = writtenOutputs();

  test("is text these tests place, or data a script checks, or a record's own id", () => {
    const unknown: Array<string> = written
      .filter((entry: WrittenOutput): boolean => {
        if (entry.output.startsWith("returnValue.")) {
          const field: string = entry.output.slice("returnValue.".length);

          return (
            !PLACED_OUTPUTS.includes(
              `${entry.templateId} ${entry.component} ${field} -> ${entry.column}`,
            ) && DATA_OUTPUTS[`${field} -> ${entry.column}`] === undefined
          );
        }

        // A record a find step read back from OneUptime.
        return entry.output !== "model._id";
      })
      .map((entry: WrittenOutput): string => {
        return `${entry.templateId}: ${entry.component}.${entry.output} -> ${entry.column}`;
      });

    expect(unknown).toEqual([]);
  });

  test("every text output these tests place is written by its template", () => {
    const writtenText: Array<string> = written.map(
      (entry: WrittenOutput): string => {
        return `${entry.templateId} ${entry.component} ${entry.output.slice("returnValue.".length)} -> ${entry.column}`;
      },
    );

    expect(
      PLACED_OUTPUTS.filter((output: string): boolean => {
        return !writtenText.includes(output);
      }),
    ).toEqual([]);
  });

  test("the scripts that write them place what they write with asWritten", () => {
    const steps: Set<string> = new Set(
      PLACED_OUTPUTS.map((output: string): string => {
        const [templateId, componentId] = output.split(" ");
        return `${templateId} ${componentId}`;
      }),
    );

    for (const step of steps) {
      const [templateId, componentId] = step.split(" ");
      const code: string = scriptOf(templateId!, componentId!);
      const own: string = code.slice(code.indexOf(STEP_SECTION));

      expect({ step, places: own.includes("asWritten(") }).toEqual({
        step,
        places: true,
      });
    }
  });
});

/* ------------------------------- Jira -> OneUptime ------------------------------- */

/*
 * Issues as Jira Cloud's webhooks carry them: the description is a string
 * of wiki markup, or a document in Atlassian Document Format from a REST v3
 * client. Each is written exactly as it was before this change: nothing in
 * it is a thing a renderer acts on.
 */
interface IssueCase {
  name: string;
  summary: string;
  description: JSONValue;
  priority: string;
  reporter: string;
  // The description as the record's description ends with it.
  descriptionText: string;
}

const ORDINARY_ISSUES: Array<IssueCase> = [
  {
    name: "an issue as Jira's webhook sends it",
    summary: "Checkout API returns 502 for EU customers",
    description:
      "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
    priority: "High",
    reporter: "Priya Patel",
    descriptionText:
      "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
  },
  {
    name: "a bug report in wiki markup: headings, a numbered list, a wiki link, monospace and code",
    summary: "Login page times out for SSO users",
    description: [
      "h3. Steps to reproduce",
      "# Open https://app.example.com/login",
      "# Choose *Sign in with SSO*",
      "",
      "h3. Actual",
      "A timeout after 30 s - see the [runbook|https://wiki.example.com/runbooks/sso] and {{/var/log/sso.log}}:",
      "{code:bash}",
      'grep -c "timed out" /var/log/sso.log | tee -a report.txt',
      "{code}",
    ].join("\n"),
    priority: "Highest",
    reporter: "José Álvarez",
    // Double braces were always defused, so a later step reads no reference in them.
    descriptionText: [
      "h3. Steps to reproduce",
      "# Open https://app.example.com/login",
      "# Choose *Sign in with SSO*",
      "",
      "h3. Actual",
      "A timeout after 30 s - see the [runbook|https://wiki.example.com/runbooks/sso] and { {/var/log/sso.log} }:",
      "{code:bash}",
      'grep -c "timed out" /var/log/sso.log | tee -a report.txt',
      "{code}",
    ].join("\n"),
  },
  {
    name: "comparisons, ampersands, emphasis and a list",
    summary: "Error rate above 5% & p99 > 2 s on payments",
    description:
      "Error rate > 5% & p99 < 2 s for *all* regions since 10:02 UTC.\n- Card payments: failing\n- PayPal: OK\n\nLast deploy: v4.2.1 (rolled out 09:58).",
    priority: "P1 - Critical",
    reporter: "Marco Rossi",
    descriptionText:
      "Error rate > 5% & p99 < 2 s for *all* regions since 10:02 UTC.\n- Card payments: failing\n- PayPal: OK\n\nLast deploy: v4.2.1 (rolled out 09:58).",
  },
  {
    name: "other scripts and directions",
    summary: "数据库连接失败 / データベース接続エラー",
    description:
      "数据库已恢复。確認お願いします。\nپایگاه داده دوباره در دسترس است\n복구 완료 — डेटाबेस फिर से उपलब्ध है",
    priority: "Low",
    reporter: "山田 太郎",
    descriptionText:
      "数据库已恢复。確認お願いします。\nپایگاه داده دوباره در دسترس است\n복구 완료 — डेटाबेस फिर से उपलब्ध है",
  },
  {
    name: "a description in Atlassian Document Format",
    summary: "Checkout API returns 502 for EU customers",
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Customers in eu-west-1 see 502s." },
            { type: "hardBreak" },
            { type: "text", text: "Started around 09:40 UTC." },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Rolled back at 10:05.",
              marks: [{ type: "strong" }],
            },
          ],
        },
      ],
    },
    priority: "Medium",
    reporter: "Priya Patel",
    descriptionText:
      "Customers in eu-west-1 see 502s.\nStarted around 09:40 UTC.\nRolled back at 10:05.",
  },
];

interface CommentCase {
  name: string;
  body: string;
  author: string;
  // The comment as the note ends with it.
  bodyText: string;
}

const ORDINARY_COMMENTS: Array<CommentCase> = [
  {
    name: "a comment as Jira's webhook sends it",
    body: "Rolled back the *eu-west-1* deploy. Watching the error rate.",
    author: "Marco Rossi",
    bodyText: "Rolled back the *eu-west-1* deploy. Watching the error rate.",
  },
  {
    name: "monospace, a noformat block and a wiki link",
    body: "Rolled back to {{v4.1.9}}.\n{noformat}\nERROR 502 upstream timed out (110: Connection timed out)\n{noformat}\nSee [the dashboard|https://grafana.example.com/d/abc] for details.",
    author: "Priya Patel",
    bodyText:
      "Rolled back to { {v4.1.9} }.\n{noformat}\nERROR 502 upstream timed out (110: Connection timed out)\n{noformat}\nSee [the dashboard|https://grafana.example.com/d/abc] for details.",
  },
  {
    name: "a mention of a Jira user, an emoticon and a bulleted list",
    body: "Thanks [~accountid:5c5f880629be9642ba529340], that fixed it (/)\n\n* restarted the pods\n* cleared the CDN cache",
    author: "José Álvarez",
    bodyText:
      "Thanks [~accountid:5c5f880629be9642ba529340], that fixed it (/)\n\n* restarted the pods\n* cleared the CDN cache",
  },
  {
    name: "other scripts",
    body: "数据库已恢复。確認お願いします。",
    author: "山田 太郎",
    bodyText: "数据库已恢复。確認お願いします。",
  },
];

// An issue's edits, as Jira Cloud's changelog lists them.
const ORDINARY_CHANGES: Array<JSONObject> = [
  changelogItem({
    field: "summary",
    fromString: "Checkout slow",
    toString: "Checkout API returns 502 for EU customers",
  }),
  changelogItem({
    field: "assignee",
    fromString: null,
    toString: "Priya Patel",
  }),
  changelogItem({ field: "priority", fromString: "Medium", toString: "High" }),
  changelogItem({
    field: "labels",
    fromString: "backend",
    toString: "backend customer-impact",
  }),
  changelogItem({
    field: "Fix Version",
    fieldId: "fixVersions",
    fromString: null,
    toString: "2026.10",
  }),
  changelogItem({
    field: "Story Points",
    fieldId: "customfield_10016",
    fromString: "3",
    toString: "5",
  }),
  changelogItem({
    field: "description",
    fromString: "Customers see 502s & time-outs.",
    toString:
      "Customers in *eu-west-1* see 502s at checkout.\nStarted around 09:40 UTC.",
  }),
];

const ORDINARY_CHANGE_LINES: string = [
  "- summary: Checkout slow → Checkout API returns 502 for EU customers",
  "- assignee: (empty) → Priya Patel",
  "- priority: Medium → High",
  "- labels: backend → backend customer-impact",
  "- Fix Version: (empty) → 2026.10",
  "- Story Points: 3 → 5",
  "- description: Customers see 502s & time-outs. → Customers in *eu-west-1* see 502s at checkout. Started around 09:40 UTC.",
].join("\n");

const ORDINARY_STATUS_CHANGES: Array<[string, JiraStatusChange, string]> = [
  [
    "Done",
    { jiraStatus: "Done", changedBy: "Priya Patel" },
    "issue OPS-17 moved to Done by Priya Patel.",
  ],
  [
    "a status named with an apostrophe",
    { jiraStatus: "Won't Do", changedBy: "José Álvarez" },
    "issue OPS-17 moved to Won't Do by José Álvarez.",
  ],
  [
    "In Progress",
    {
      jiraStatus: "In Progress",
      changedBy: "Priya Patel",
      jiraStatusCategory: "indeterminate",
    },
    "issue OPS-17 moved to In Progress by Priya Patel.",
  ],
  [
    "a change Jira names nobody for",
    { jiraStatus: "Resolved", changedBy: "" },
    "issue OPS-17 moved to Resolved.",
  ],
];

describe.each(KINDS)(
  "Jira text an %s gets",
  (_name: string, kind: RecordKind) => {
    test.each(ORDINARY_ISSUES)(
      "$name: the title and description are written exactly as before",
      async (issue: IssueCase) => {
        const result: JSONObject = await recordFromIssue(
          kind,
          jiraIssueCreatedEvent({
            summary: issue.summary,
            description: issue.description,
            priority: issue.priority,
            reporter: jiraUser(issue.reporter),
          }),
        );

        expect({
          title: result["title"],
          description: result["description"],
        }).toEqual({
          title: issue.summary,
          description: [
            `${kind.Created} from Jira issue ${ISSUE_LINK}.`,
            `Priority: ${issue.priority}`,
            `Reported by: ${issue.reporter}`,
            "",
            issue.descriptionText,
          ].join("\n"),
        });
        expect(JSON.stringify(result)).not.toContain(J);
      },
    );

    test.each(ORDINARY_COMMENTS)(
      "$name: the note is written exactly as before",
      async (comment: CommentCase) => {
        const result: JSONObject = await noteFromComment(
          kind,
          jiraCommentEvent({
            body: comment.body,
            author: jiraUser(comment.author),
          }),
        );

        expect(result["note"]).toBe(
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: ${comment.author} commented on ${ISSUE_LINK}.\n\n${comment.bodyText}`,
        );
        expect(textOf(result, "note")).not.toContain(J);
      },
    );

    test("an issue's edits are noted exactly as before", async () => {
      const result: JSONObject = await noteFromChanges(kind, ORDINARY_CHANGES);

      expect(result["note"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Priya Patel updated ${ISSUE_LINK}.\n\n${ORDINARY_CHANGE_LINES}`,
      );
      expect(textOf(result, "note")).not.toContain(J);
    });

    test.each(ORDINARY_STATUS_CHANGES)(
      "%s: the cause of the state change is written exactly as before",
      async (_case: string, change: JiraStatusChange, cause: string) => {
        const result: JSONObject = await causeFromIssue(kind, change);

        expect(result["rootCause"]).toBe(
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: ${cause}`,
        );
      },
    );

    test("text holding a '<' before a letter, or ending in ']', reads the same, with a joiner where markup would start", async () => {
      const record: JSONObject = await recordFromIssue(
        kind,
        jiraIssueCreatedEvent({
          summary: "Cache misses for List<String> keys",
          description:
            "Use List<String> for the cache; p99<200ms is the target.\nMail Jane <jane@contoso.com>, and a < b stays.",
        }),
      );
      const comment: JSONObject = await noteFromComment(
        kind,
        jiraCommentEvent({
          body: "Thanks [~accountid:5c5f880629be9642ba529340]",
        }),
      );

      expect(record["title"]).toBe(`Cache misses for List<${J}String> keys`);
      expect(
        textOf(record, "description").endsWith(
          `\n\nUse List<${J}String> for the cache; p99<${J}200ms is the target.\nMail Jane <${J}jane@contoso.com>, and a < b stays.`,
        ),
      ).toBe(true);
      expect(
        textOf(comment, "note").endsWith(
          `\n\nThanks [~accountid:5c5f880629be9642ba529340]${J}`,
        ),
      ).toBe(true);
    });

    test("markup typed in an issue's summary and description is written as text", async () => {
      const result: JSONObject = await recordFromIssue(
        kind,
        jiraIssueCreatedEvent({
          summary: "<img src=x onerror=alert(1)> Checkout down <!channel>",
          description:
            "See ![chart](https://tracker.example/p.png) and [the runbook](https://evil.example/runbook).\n```mermaid\ngraph TD; A-->B\n```",
          priority: "<@U0123ABC>",
          reporter: jiraUser("[Support](https://evil.example)"),
        }),
      );

      expect(result["title"]).toBe(
        `<${J}img src=x onerror=alert(1)> Checkout down <${J}!channel>`,
      );
      expect(result["description"]).toBe(
        [
          `${kind.Created} from Jira issue ${ISSUE_LINK}.`,
          `Priority: <${J}@U0123ABC>`,
          `Reported by: [Support]${J}(https://evil.example)`,
          "",
          `See !${J}[chart]${J}(https://tracker.example/p.png) and [the runbook]${J}(https://evil.example/runbook).`,
          `\`\`\`${J}mermaid`,
          "graph TD; A-->B",
          "```",
        ].join("\n"),
      );
    });

    test("markup typed in a comment, and in its author's name, is written as text", async () => {
      const result: JSONObject = await noteFromComment(
        kind,
        jiraCommentEvent({
          body: "<!here> ![x](https://tracker.example/p.png) <https://evil.example|Open the runbook>",
          author: jiraUser("<img src=x>"),
        }),
      );

      expect(result["note"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: <${J}img src=x> commented on ${ISSUE_LINK}.\n\n<${J}!here> !${J}[x]${J}(https://tracker.example/p.png) <${J}https://evil.example|Open the runbook>`,
      );
    });

    test("markup typed in a field's name, its values and the editor's name is written as text", async () => {
      const result: JSONObject = await noteFromChanges(
        kind,
        [
          changelogItem({
            field: "![f](https://tracker.example/f.png)",
            fieldId: "customfield_10050",
            fromString: "<b>old</b>",
            toString: "[new](https://evil.example)",
          }),
        ],
        { user: jiraUser("<@U0123ABC>") },
      );

      expect(result["note"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: <${J}@U0123ABC> updated ${ISSUE_LINK}.\n\n- !${J}[f]${J}(https://tracker.example/f.png): <${J}b>old<${J}/b> → [new]${J}(https://evil.example)`,
      );
    });

    test("markup typed in a status's name and the mover's name is written as text", async () => {
      const result: JSONObject = await causeFromIssue(kind, {
        jiraStatus: "[Done](https://evil.example)",
        changedBy: "<!channel>",
      });

      expect(result["rootCause"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue OPS-17 moved to [Done]${J}(https://evil.example) by <${J}!channel>.`,
      );
    });
  },
);

/* --------------------------- Dynamics 365 -> OneUptime --------------------------- */

/*
 * Cases as the Dataverse Web API returns them: a plain-text description,
 * and the display text of the priority and the customer beside their
 * values. Each is written exactly as it was before this change.
 */
interface CaseCase {
  name: string;
  title: string;
  description: string;
  prioritycode: number;
  priorityName: string;
  customer: string;
}

const ORDINARY_CASES: Array<CaseCase> = [
  {
    name: "a case as the Web API returns it",
    title: "Customers in the EU cannot complete checkout",
    description:
      "Three customers called since 09:40 UTC.\nThey see an error after entering card details.",
    prioritycode: 1,
    priorityName: "High",
    customer: "Contoso Pharmaceuticals",
  },
  {
    name: "ampersands, order numbers, prices and a list",
    title: "Billing & invoicing: duplicate charges",
    description:
      "Two customers were charged twice.\nRefunds requested for orders #10442 & #10443.\n\n- Card: Visa\n- Amount: $49.99",
    prioritycode: 2,
    priorityName: "Normal",
    customer: "Fabrikam, Inc.",
  },
  {
    name: "a forwarded email's quoted lines and an error code",
    title: "Portal sign-in fails (error 0x80040217)",
    description:
      "> On Monday, Jane wrote:\n> The portal is down for everyone in Sales.\n\nForwarded by the front desk.",
    prioritycode: 3,
    priorityName: "Low",
    customer: "Adventure Works Cycles",
  },
  {
    name: "other scripts",
    title: "数据库连接失败",
    description: "数据库已恢复。確認お願いします。",
    prioritycode: 1,
    priorityName: "High",
    customer: "株式会社サンプル",
  },
];

const ORDINARY_CASE_CHANGES: Array<[string, CaseStatusChange, string]> = [
  [
    "a solved case",
    {
      caseNumber: CASE_NUMBER,
      caseStatusText: "Problem Solved",
      changedBy: "Priya Patel",
    },
    `case ${CASE_NUMBER} is Problem Solved, changed by Priya Patel.`,
  ],
  [
    "a case an application user resolved",
    {
      caseNumber: CASE_NUMBER,
      caseStatusText: "Information Provided",
      changedBy: "# Dynamics 365 Service",
    },
    `case ${CASE_NUMBER} is Information Provided, changed by # Dynamics 365 Service.`,
  ],
  [
    "a change Dataverse names nobody for",
    {
      caseNumber: CASE_NUMBER,
      caseStatusText: "Problem Solved",
      changedBy: "",
    },
    `case ${CASE_NUMBER} is Problem Solved.`,
  ],
];

describe.each(KINDS)(
  "Dynamics 365 text an %s gets",
  (_name: string, kind: RecordKind) => {
    test.each(ORDINARY_CASES)(
      "$name: the title and description are written exactly as before",
      async (row: CaseCase) => {
        const result: JSONObject = await recordFromCase(
          kind,
          caseRow({
            title: row.title,
            description: row.description,
            prioritycode: row.prioritycode,
            customerName: row.customer,
          }),
        );

        expect({
          title: result["title"],
          description: result["description"],
        }).toEqual({
          title: row.title,
          description: [
            `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${CASE_URL}).`,
            `Priority: ${row.priorityName}`,
            `Customer: ${row.customer}`,
            "",
            row.description,
          ].join("\n"),
        });
        expect(JSON.stringify(result)).not.toContain(J);
      },
    );

    test.each(ORDINARY_CASE_CHANGES)(
      "%s: the cause of the state change is written exactly as before",
      async (_case: string, change: CaseStatusChange, cause: string) => {
        const result: JSONObject = await causeFromCase(kind, change);

        expect(result["rootCause"]).toBe(
          `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: ${cause}`,
        );
      },
    );

    test("an address in angle brackets reads the same, with a joiner where an autolink would start", async () => {
      const result: JSONObject = await recordFromCase(
        kind,
        caseRow({
          description:
            "From: Jane Doe <jane@contoso.com>\nSent: Monday\n\nThe portal is down.",
        }),
      );

      expect(
        textOf(result, "description").endsWith(
          `\n\nFrom: Jane Doe <${J}jane@contoso.com>\nSent: Monday\n\nThe portal is down.`,
        ),
      ).toBe(true);
    });

    test("markup typed in a case's title, description, number, priority and customer is written as text", async () => {
      const result: JSONObject = await recordFromCase(
        kind,
        withPriorityName(
          caseRow({
            title:
              "<!channel> Checkout down ![x](https://tracker.example/x.png)",
            description:
              "<img src=x onerror=alert(1)>\n```mermaid\ngraph TD; A-->B\n```\n[logo]: https://tracker.example/logo.png",
            ticketnumber: "CAS-1](https://evil.example)",
            customerName: "<a href=https://evil.example>Contoso</a>",
          }),
          "[High](https://evil.example)",
        ),
      );

      expect(result["title"]).toBe(
        `<${J}!channel> Checkout down !${J}[x]${J}(https://tracker.example/x.png)`,
      );
      expect(result["description"]).toBe(
        [
          `${kind.Created} from Dynamics 365 case [CAS-1]${J}(https://evil.example)](${CASE_URL}).`,
          `Priority: [High]${J}(https://evil.example)`,
          `Customer: <${J}a href=https://evil.example>Contoso<${J}/a>`,
          "",
          `<${J}img src=x onerror=alert(1)>`,
          `\`\`\`${J}mermaid`,
          "graph TD; A-->B",
          "```",
          `[logo]${J}: https://tracker.example/logo.png`,
        ].join("\n"),
      );
    });

    test("an untitled case is named by its number, placed as text too", async () => {
      const result: JSONObject = await recordFromCase(
        kind,
        caseRow({ title: "", ticketnumber: "<@U0123ABC>" }),
      );

      expect(result["title"]).toBe(`Dynamics 365 case <${J}@U0123ABC>`);
    });

    test("markup typed in a case's number, status and the changer's name is written as text", async () => {
      const result: JSONObject = await causeFromCase(kind, {
        caseNumber: "![c](https://tracker.example/c.png)",
        caseStatusText: "<b>Problem Solved</b>",
        changedBy: "<@U0123ABC>",
      });

      expect(result["rootCause"]).toBe(
        `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: case !${J}[c]${J}(https://tracker.example/c.png) is <${J}b>Problem Solved<${J}/b>, changed by <${J}@U0123ABC>.`,
      );
    });
  },
);

/* --------------------------- Nothing in them acts --------------------------- */

const WHITESPACE_RUN: RegExp = /\s+/g;

// A value as the issue-changes note shows it: on one line, cut at 300 characters.
function shown(value: string): string {
  const text: string = value.replace(WHITESPACE_RUN, " ").trim();

  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

interface Written {
  name: string;
  text: string;
  // The text as written before this change: the outside parts as they came.
  asTyped: string;
  ownLinks: Array<string>;
}

/*
 * Every script that writes OneUptime text, given the outside text above in
 * every part that came from outside, for both kinds of record.
 */
async function writtenWithOutsideMarkup(): Promise<Array<Written>> {
  const written: Array<Written> = [];
  const typedLine: string = HOSTILE_LINE;

  for (const [, kind] of KINDS) {
    const issue: JSONObject = await recordFromIssue(
      kind,
      jiraIssueCreatedEvent({
        summary: HOSTILE_LINE,
        description: HOSTILE_TEXT,
        priority: HOSTILE_LINE,
        reporter: jiraUser(HOSTILE_LINE),
      }),
    );

    written.push({
      name: `${kind.noun} from a Jira issue: title`,
      text: textOf(issue, "title"),
      asTyped: typedLine,
      ownLinks: [],
    });
    written.push({
      name: `${kind.noun} from a Jira issue: description`,
      text: textOf(issue, "description"),
      asTyped: [
        `${kind.Created} from Jira issue ${ISSUE_LINK}.`,
        `Priority: ${typedLine}`,
        `Reported by: ${typedLine}`,
        "",
        HOSTILE_TEXT,
      ].join("\n"),
      ownLinks: [ISSUE_URL],
    });

    const comment: JSONObject = await noteFromComment(
      kind,
      jiraCommentEvent({
        body: HOSTILE_TEXT,
        author: jiraUser(HOSTILE_LINE),
      }),
    );

    written.push({
      name: `${kind.noun} note from a Jira comment`,
      text: textOf(comment, "note"),
      asTyped: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: ${typedLine} commented on ${ISSUE_LINK}.\n\n${HOSTILE_TEXT}`,
      ownLinks: [ISSUE_URL],
    });

    const changes: JSONObject = await noteFromChanges(
      kind,
      [
        changelogItem({
          field: HOSTILE_LINE,
          fieldId: "customfield_10050",
          fromString: HOSTILE_LINE,
          toString: HOSTILE_TEXT,
        }),
      ],
      { user: jiraUser(HOSTILE_LINE) },
    );

    written.push({
      name: `${kind.noun} note from a Jira issue's changes`,
      text: textOf(changes, "note"),
      asTyped: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: ${typedLine} updated ${ISSUE_LINK}.\n\n- ${typedLine}: ${shown(HOSTILE_LINE)} → ${shown(HOSTILE_TEXT)}`,
      ownLinks: [ISSUE_URL],
    });

    const cause: JSONObject = await causeFromIssue(kind, {
      jiraStatus: HOSTILE_LINE,
      changedBy: HOSTILE_LINE,
    });

    written.push({
      name: `${kind.noun} state change from a Jira status`,
      text: textOf(cause, "rootCause"),
      asTyped: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue OPS-17 moved to ${typedLine} by ${typedLine}.`,
      ownLinks: [],
    });

    const record: JSONObject = await recordFromCase(
      kind,
      withPriorityName(
        caseRow({
          title: HOSTILE_LINE,
          description: HOSTILE_TEXT,
          customerName: HOSTILE_LINE,
        }),
        HOSTILE_LINE,
      ),
    );

    written.push({
      name: `${kind.noun} from a Dynamics 365 case: title`,
      text: textOf(record, "title"),
      asTyped: typedLine,
      ownLinks: [],
    });
    written.push({
      name: `${kind.noun} from a Dynamics 365 case: description`,
      text: textOf(record, "description"),
      asTyped: [
        `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${CASE_URL}).`,
        `Priority: ${typedLine}`,
        `Customer: ${typedLine}`,
        "",
        HOSTILE_TEXT,
      ].join("\n"),
      ownLinks: [CASE_URL],
    });

    const caseCause: JSONObject = await causeFromCase(kind, {
      caseNumber: HOSTILE_LINE,
      caseStatusText: HOSTILE_LINE,
      changedBy: HOSTILE_LINE,
    });

    written.push({
      name: `${kind.noun} state change from a Dynamics 365 case`,
      text: textOf(caseCause, "rootCause"),
      asTyped: `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: case ${typedLine} is ${typedLine}, changed by ${typedLine}.`,
      ownLinks: [],
    });

    /*
     * A note's title and text are HTML, whose tags are read as markup
     * (DynamicsNoteMarkup.test.ts); its author and its file's name are text.
     */
    const note: JSONObject = await noteFromCase(kind, {
      subject: "Called the customer",
      notetext: "Called the customer back.",
      author: HOSTILE_LINE,
      isdocument: true,
      filename: HOSTILE_LINE,
    });

    written.push({
      name: `${kind.noun} note from a Dynamics 365 note`,
      text: textOf(note, "note"),
      asTyped: [
        `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: ${typedLine} added a note to case [${CASE_NUMBER}](${CASE_URL}).`,
        "",
        "Called the customer",
        "",
        "Called the customer back.",
        "",
        `Attachment, left in Dynamics 365: ${typedLine}`,
      ].join("\n"),
      ownLinks: [CASE_URL],
    });
  }

  return written;
}

describe("no text written from outside holds anything a renderer acts on", () => {
  let written: Array<Written> = [];
  let readings: Array<Reading> = [];

  beforeAll(async () => {
    written = await writtenWithOutsideMarkup();
    readings = written.map((entry: Written): Reading => {
      return readingsOf([entry.text], entry.ownLinks)[0]!;
    });
  });

  test("every script that writes OneUptime text is given markup in every part that came from outside", () => {
    // Nine texts for each kind: two titles, two descriptions, three notes and two causes.
    expect(written).toHaveLength(18);
  });

  test("each reads exactly as it was typed", () => {
    expect(
      written
        .filter((entry: Written): boolean => {
          return withoutJoiners(entry.text) !== entry.asTyped;
        })
        .map((entry: Written): [string, string, string] => {
          return [entry.name, withoutJoiners(entry.text), entry.asTyped];
        }),
    ).toEqual([]);
  });

  test("marked, the dashboard and Slack read no HTML, image, diagram, mention or link that hides where it goes, and no '<' starts anything", () => {
    readings.forEach((reading: Reading, index: number): void => {
      expect({ name: written[index]!.name, ...reading }).toEqual({
        name: written[index]!.name,
        text: reading.text,
        ...NOTHING_ACTS,
      });
    });
  });

  test("as typed, the same Markdown would be read as markup by every renderer", () => {
    // So the tests above are not passing on text the renderers leave alone anyway.
    const typed: Array<Reading> = readingsOf(
      written.map((entry: Written): string => {
        return entry.asTyped;
      }),
      [ISSUE_URL, CASE_URL],
    );

    for (const reading of typed) {
      expect(reading.tagStart).toBe(true);
      expect(reading.slackMention).toBe(true);
      expect(
        reading.html.length + reading.images + reading.links.length,
      ).toBeGreaterThan(0);
    }

    // Each multi-line text is drawn with its image and its diagram.
    expect(
      typed.filter((reading: Reading): boolean => {
        return reading.dashboardImage && reading.dashboardDiagram;
      }).length,
    ).toBeGreaterThanOrEqual(6);
  });
});

/* --------------------------- The link to a Jira issue --------------------------- */

/*
 * The link a note or a description gives to the issue is the template's
 * own: the issue's key, which matched ISSUE_KEY, on the site the workflow's
 * Jira Site URL names. The event cannot move it: its REST URL comes with the
 * request, not from the workflow, so with the setting the issue is linked on
 * the configured site whatever that URL says.
 *
 * Without the setting (a workflow whose arguments were edited to leave it
 * out), the site is read off the event's REST URL exactly as it was before:
 * only a scheme, a host and a port, and an issue whose URL holds anything
 * else is named without a link. JiraIssueLinkSite.test.ts holds that
 * fallback to the old code on generated URLs too.
 */
const EVENT_SITES: Array<[string, string, string]> = [
  [
    "Jira Cloud",
    "https://acme.atlassian.net/rest/api/2/issue/10040",
    "https://acme.atlassian.net",
  ],
  [
    "Jira Data Center on a port",
    "https://jira.example.com:8443/rest/api/2/issue/10040",
    "https://jira.example.com:8443",
  ],
  [
    "Jira under a path, linked at its host as before",
    "https://example.com/jira/rest/api/2/issue/10040",
    "https://example.com",
  ],
  [
    "an address and a port",
    "http://10.0.0.5:8080/rest/api/2/issue/10040",
    "http://10.0.0.5:8080",
  ],
  [
    "an internal host name",
    "http://jira_dev.corp:8080/rest/api/2/issue/10040",
    "http://jira_dev.corp:8080",
  ],
  [
    "an IPv6 address",
    "http://[2001:db8::1]:8443/rest/api/2/issue/10040",
    "http://[2001:db8::1]:8443",
  ],
  [
    "a host written in another script",
    "https://jira.bücher.example/rest/api/2/issue/10040",
    "https://jira.bücher.example",
  ],
  [
    "a host whose letters carry marks",
    "https://jira.भारत.example/rest/api/2/issue/10040",
    "https://jira.भारत.example",
  ],
];

const EVENT_URLS_THAT_ARE_NOT_SITES: Array<[string, string]> = [
  [
    "markup after the host",
    "https://a.example)<img src=x onerror=alert(1)>/rest/api/2/issue/10040",
  ],
  [
    "an image after the host",
    "https://a.example)![x](https://tracker.example/p.png)/rest",
  ],
  [
    "a mention after the host",
    "https://a.example)<!channel>/rest/api/2/issue/10040",
  ],
  ["a user and a password", "https://user:secret@acme.atlassian.net/rest"],
  ["a query", "https://acme.atlassian.net?next=x/rest/api/2/issue/10040"],
  ["a space", "https://acme.atlassian.net /rest/api/2/issue/10040"],
  ["a line break", "https://acme.atlassian.net\n/rest/api/2/issue/10040"],
  ["another scheme", "javascript:alert(1)//acme.atlassian.net/rest"],
  ["no host", "https:///rest/api/2/issue/10040"],
  [
    "a right-to-left override in the host",
    `https://acme${String.fromCharCode(0x202e)}ten.naissalta/rest/api/2/issue/10040`,
  ],
  [
    "a no-break space in the host",
    `https://acme${String.fromCharCode(0xa0)}.atlassian.net/rest/api/2/issue/10040`,
  ],
  ["an unclosed IPv6 address", "http://[2001:db8::1/rest/api/2/issue/10040"],
  [
    "a numeral a browser reads as digits and a dot",
    `https://acme${String.fromCharCode(0x2488)}com/rest/api/2/issue/10040`,
  ],
  [
    "a host longer than a site's address can be",
    `https://${"a".repeat(300)}.example/rest/api/2/issue/10040`,
  ],
];

interface LinkedTexts {
  description: string;
  commentNote: string;
  changesNote: string;
}

// The description and the two notes one kind's scripts write for an issue at this REST URL.
async function linkedTexts(
  kind: RecordKind,
  self: string,
  site: string | null,
): Promise<LinkedTexts> {
  const comment: JSONObject = jiraCommentEvent();

  (comment["issue"] as JSONObject)["self"] = self;

  const record: JSONObject = await recordFromIssue(
    kind,
    jiraIssueCreatedEvent({ self: self }),
    site,
  );
  const note: JSONObject = await noteFromComment(kind, comment, site);
  const changes: JSONObject = await noteFromChanges(kind, ORDINARY_CHANGES, {
    self: self,
    site: site,
  });

  return {
    description: textOf(record, "description"),
    commentNote: textOf(note, "note"),
    changesNote: textOf(changes, "note"),
  };
}

// How each of the three texts starts, with the issue named as given.
function openings(kind: RecordKind, issue: string): LinkedTexts {
  return {
    description: `${kind.Created} from Jira issue ${issue}.\n`,
    commentNote: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on ${issue}.\n\n`,
    changesNote: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Priya Patel updated ${issue}.\n\n`,
  };
}

function expectOpenings(texts: LinkedTexts, expected: LinkedTexts): void {
  expect({
    description: texts.description.startsWith(expected.description),
    commentNote: texts.commentNote.startsWith(expected.commentNote),
    changesNote: texts.changesNote.startsWith(expected.changesNote),
    texts: texts,
  }).toEqual({
    description: true,
    commentNote: true,
    changesNote: true,
    texts: texts,
  });
}

describe("the link to a Jira issue, with the workflow's Jira Site URL", () => {
  test.each([...EVENT_SITES, ...EVENT_URLS_THAT_ARE_NOT_SITES])(
    "an event whose issue URL is %s: the issue is linked on the configured site, and nothing else acts",
    async (_case: string, self: string) => {
      for (const [, kind] of KINDS) {
        const texts: LinkedTexts = await linkedTexts(kind, self, JIRA_SITE);

        expectOpenings(texts, openings(kind, ISSUE_LINK));

        for (const reading of readingsOf(
          [texts.description, texts.commentNote, texts.changesNote],
          [ISSUE_URL],
        )) {
          expect({ ...reading, text: "" }).toEqual({
            text: "",
            ...NOTHING_ACTS,
          });
        }

        // The configured site is the only one any of them links to.
        for (const page of renderAsDashboard([
          texts.description,
          texts.commentNote,
          texts.changesNote,
        ])) {
          expect(
            Array.from(page.matchAll(DASHBOARD_ANCHOR)).map(
              (anchor: RegExpMatchArray): string => {
                return anchor[1]!;
              },
            ),
          ).toEqual([ISSUE_URL]);
        }
      }
    },
  );
});

describe("the link to a Jira issue, without the workflow's Jira Site URL", () => {
  test.each(EVENT_SITES)(
    "%s: links the issue at the site the event's issue URL names, as before",
    async (_case: string, self: string, site: string) => {
      for (const [, kind] of KINDS) {
        const texts: LinkedTexts = await linkedTexts(kind, self, null);

        expectOpenings(
          texts,
          openings(
            kind,
            `[${JIRA_ISSUE_KEY}](${site}/browse/${JIRA_ISSUE_KEY})`,
          ),
        );
      }
    },
  );

  test.each(EVENT_URLS_THAT_ARE_NOT_SITES)(
    "%s: names the issue without a link, as before",
    async (_case: string, self: string) => {
      for (const [, kind] of KINDS) {
        const texts: LinkedTexts = await linkedTexts(kind, self, null);

        expectOpenings(texts, openings(kind, JIRA_ISSUE_KEY));

        for (const reading of readingsOf(
          [texts.description, texts.commentNote, texts.changesNote],
          [],
        )) {
          expect({ ...reading, text: "" }).toEqual({
            text: "",
            ...NOTHING_ACTS,
          });
        }
      }
    },
  );
});

/* ------------------------------------ Time ------------------------------------ */

/*
 * A webhook's body is whatever its sender writes, and a case's description
 * can be long. Every pass the placing makes is a loop, indexOf or a pattern
 * that never looks back, so each script reads a long value well inside the
 * sandbox's own limit. Titles stay within the record's 500 characters
 * whatever the joiners add.
 */
describe("time", () => {
  const LIMIT_IN_MS: number = 3000;
  const SIZE: number = 100000;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  const SHAPES: Array<[string, string]> = [
    ["'<' before letters", repeatTo("<a")],
    ["images", repeatTo("![")],
    ["link tails", repeatTo("](")],
    ["fences and references", repeatTo("```&#109;")],
    ["mermaid after a fence", `\`\`\`${repeatTo("mermaid")}`],
    ["fence lines", repeatTo("```mermaid\n")],
    ["spaces", `${repeatTo(" ")}x`],
    ["line breaks", `a${repeatTo("\n")}b`],
  ];

  test.each(SHAPES)(
    "every script places a long value of %s in linear time",
    async (_case: string, value: string) => {
      const started: number = Date.now();

      const issue: JSONObject = await recordFromIssue(
        INCIDENT,
        jiraIssueCreatedEvent({ summary: value, description: value }),
      );
      const comment: JSONObject = await noteFromComment(
        ALERT,
        jiraCommentEvent({ body: value }),
      );
      const changes: JSONObject = await noteFromChanges(INCIDENT, [
        changelogItem({ field: "summary", fromString: value, toString: value }),
      ]);
      const cause: JSONObject = await causeFromIssue(ALERT, {
        jiraStatus: value,
        changedBy: value,
      });
      const record: JSONObject = await recordFromCase(
        INCIDENT,
        caseRow({ title: value, description: value }),
      );
      const caseCause: JSONObject = await causeFromCase(ALERT, {
        caseNumber: value,
        caseStatusText: value,
        changedBy: value,
      });

      // Six sandbox runs, each well inside the limit.
      expect(Date.now() - started).toBeLessThan(6 * LIMIT_IN_MS);

      for (const text of [
        textOf(issue, "title"),
        textOf(issue, "description"),
        textOf(comment, "note"),
        textOf(changes, "note"),
        textOf(cause, "rootCause"),
        textOf(record, "title"),
        textOf(record, "description"),
        textOf(caseCause, "rootCause"),
      ]) {
        // A value cut short ends in "…", which a "<" before it starts nothing with.
        expect(text).not.toMatch(MARKUP_START);
      }

      expect(textOf(issue, "title").length).toBeLessThanOrEqual(500);
      expect(textOf(record, "title").length).toBeLessThanOrEqual(500);
    },
  );

  test("a title full of what gets a joiner still fits the record's 500 characters", async () => {
    const summary: string = "<!".repeat(200);
    const issue: JSONObject = await recordFromIssue(
      INCIDENT,
      jiraIssueCreatedEvent({ summary: summary }),
    );
    const record: JSONObject = await recordFromCase(
      ALERT,
      caseRow({ title: "![".repeat(200) }),
    );

    for (const title of [textOf(issue, "title"), textOf(record, "title")]) {
      expect(title).toHaveLength(500);
      expect(title.endsWith("…")).toBe(true);
      expect(title).not.toMatch(MARKUP_START);
    }
  });
});
