/*
 * THE SITE A LINK TO A JIRA ISSUE GOES TO.
 *
 * The Jira templates that bring Jira into OneUptime link the issue in what
 * they write: the description of an incident or alert created from an
 * issue, and the private notes the comment and issue-change templates add.
 * #4676 read the link's site off the event's own REST URL (issue.self),
 * limited to a scheme, a host and a port. That URL comes with the request,
 * so the request, not the workflow, chose the site.
 *
 * Each of those templates now asks for a Jira Site URL when a workflow is
 * created from it, and the link goes to that site whatever the event says.
 * These tests:
 *
 *   - hold the setting's pattern, which the create wizard checks a typed
 *     value with (JIRA_SITE_URL_PATTERN), to what a site's address can be -
 *     Jira Cloud, Data Center on a port or under a one-segment context path,
 *     an IP or IPv6 address, a host in any script - and to nothing else: not
 *     a page of the site, a query, a user name, markup or another scheme;
 *   - check that every Jira script reads the setting with that very pattern,
 *     and that exactly the templates whose scripts link an issue ask for the
 *     setting and hand it to those scripts;
 *   - run issueLink, as each of those scripts carries it, in the workflow
 *     sandbox on a grid of settings and event URLs, generated ones included:
 *     with the setting, the link is on the configured site whatever the
 *     event's URL; a setting that is not a site's address links nothing;
 *     without the setting, the link is exactly what #4676's code wrote,
 *     copied here as the oracle;
 *   - check that every renderer reads such a link as one link to the
 *     configured site, for every shape of site the setting takes.
 */

import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  JIRA_SITE_URL_PATTERN,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { decodeHtmlEntities } from "../../Helpers/HtmlText";
import { renderAsDashboard } from "../../Utils/Markdown/DashboardMarkdownRenderer";
import {
  JIRA_ISSUE_KEY,
  runJiraScript,
  scriptOf,
} from "./JiraTemplateFixtures";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { Token, marked } from "marked";

// The sandbox boots a fresh isolate per run, which is far slower than plain JS.
jest.setTimeout(120000);

const STEP_SECTION: string = "\n// ---- What this step does ----\n";

const DASHBOARD_ANCHOR: RegExp = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
const SLACK_LINK: RegExp = /<([A-Za-z][A-Za-z0-9+.-]*:[^<>|\s]*)\|([^<>]*)>/g;

/* ------------------------------ The scripts ------------------------------ */

interface ScriptStep {
  templateId: string;
  componentId: string;
}

// The scripts that link the issue, for incidents and for alerts.
const LINKING_SCRIPTS: Array<ScriptStep> = [
  {
    templateId: "jira-declare-incident-from-issue",
    componentId: "prepare-incident-1",
  },
  {
    templateId: "jira-comment-to-incident-private-note",
    componentId: "read-comment-1",
  },
  {
    templateId: "jira-issue-changes-to-incident-private-note",
    componentId: "read-changes-1",
  },
  {
    templateId: "jira-create-alert-from-issue",
    componentId: "prepare-alert-1",
  },
  {
    templateId: "jira-comment-to-alert-private-note",
    componentId: "read-comment-1",
  },
  {
    templateId: "jira-issue-changes-to-alert-private-note",
    componentId: "read-changes-1",
  },
];

function nodesOf(templateId: string): Array<JSONObject> {
  return (
    getTemplateGraphSpec(templateId) as unknown as {
      nodes: Array<JSONObject>;
    }
  ).nodes;
}

function jiraTemplates(): Array<WorkflowTemplate> {
  return getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira);
}

// Every script step of every Jira template.
function jiraScripts(): Array<ScriptStep> {
  const steps: Array<ScriptStep> = [];

  for (const template of jiraTemplates()) {
    for (const node of nodesOf(template.id)) {
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

function ownCodeOf(step: ScriptStep): string {
  const code: string = scriptOf(step.templateId, step.componentId);

  return code.slice(code.indexOf(STEP_SECTION));
}

function argumentsOf(step: ScriptStep): JSONObject | string {
  const node: JSONObject | undefined = nodesOf(step.templateId).find(
    (candidate: JSONObject): boolean => {
      return candidate["componentId"] === step.componentId;
    },
  );
  const text: string = String(
    ((node?.["args"] as JSONObject | undefined) || {})["arguments"],
  );

  try {
    return JSON.parse(text) as JSONObject;
  } catch {
    return text;
  }
}

/*
 * issueLink as a script carries it, on every case at once, in one sandbox
 * run: the script's step is swapped for a line that calls it.
 */
const LINK_HARNESS: string =
  "return (Array.isArray(args.cases) ? args.cases : []).map((c) => issueLink(c.self, c.key, c.setting));";

interface LinkCase {
  self?: JSONValue | undefined;
  key: string;
  // Left out of a case: the script was handed no setting at all.
  setting?: JSONValue | undefined;
}

async function linksBy(
  step: ScriptStep,
  cases: Array<LinkCase>,
): Promise<Array<string>> {
  return (await runJiraScript({
    templateId: step.templateId,
    componentId: step.componentId,
    args: { cases: cases as unknown as JSONValue },
    editCode: (code: string): string => {
      return (
        code.slice(0, code.indexOf(STEP_SECTION) + STEP_SECTION.length) +
        LINK_HARNESS
      );
    },
  })) as unknown as Array<string>;
}

function linkTo(site: string, key: string): string {
  return `[${key}](${site}/browse/${key})`;
}

/* ------------------------------ The oracle ------------------------------ */

/*
 * #4676's issueLink, as every Jira script carried it before the setting:
 * the site read off the event's REST URL, a scheme, a host and a port, and
 * no link when the URL holds anything else. A workflow handed no setting
 * links exactly as it did.
 */
const SITE_BEFORE: RegExp =
  /^https?:\/\/(?:[\p{L}\p{M}\p{Nd}._~-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/u;
const LONGEST_SITE_BEFORE: number = 300;

function issueLinkBefore(
  self: JSONValue | undefined,
  issueKey: string,
): string {
  const text: string =
    typeof self === "string"
      ? self
      : typeof self === "number"
        ? String(self)
        : "";
  const hostStart: number = text.indexOf("://");
  let site: string = "";

  if (hostStart !== -1) {
    const pathStart: number = text.indexOf("/", hostStart + 3);
    const candidate: string =
      pathStart === -1 ? text : text.slice(0, pathStart);

    site =
      candidate.length <= LONGEST_SITE_BEFORE && SITE_BEFORE.test(candidate)
        ? candidate
        : "";
  }

  return site ? linkTo(site, issueKey) : issueKey;
}

/* ------------------------------ The settings ------------------------------ */

// What someone can type as their Jira Site URL, and the site links then go to.
const SITES: Array<[string, string, string]> = [
  ["Jira Cloud", "https://acme.atlassian.net", "https://acme.atlassian.net"],
  [
    "Jira Cloud, with the slash a browser's address bar ends it with",
    "https://acme.atlassian.net/",
    "https://acme.atlassian.net",
  ],
  ["Jira Data Center", "https://jira.example.com", "https://jira.example.com"],
  [
    "Jira Data Center on a port",
    "https://jira.example.com:8443",
    "https://jira.example.com:8443",
  ],
  [
    "Jira Data Center under a context path",
    "https://example.com/jira",
    "https://example.com/jira",
  ],
  [
    "Jira Data Center under a context path, with a slash after it",
    "https://example.com/jira/",
    "https://example.com/jira",
  ],
  [
    "Jira Data Center on a port, under a context path",
    "http://intranet.example.com:8080/jira",
    "http://intranet.example.com:8080/jira",
  ],
  [
    "a context path of dots, dashes, underscores and a tilde",
    "https://example.com/~jira_2.0-prod",
    "https://example.com/~jira_2.0-prod",
  ],
  ["an address and a port", "http://10.0.0.5:8080", "http://10.0.0.5:8080"],
  [
    "an internal host name",
    "http://jira_dev.corp:8080",
    "http://jira_dev.corp:8080",
  ],
  ["a host with no dot", "http://jira:8080", "http://jira:8080"],
  ["an IPv6 address", "http://[2001:db8::1]:8443", "http://[2001:db8::1]:8443"],
  [
    "a host written in another script",
    "https://jira.bücher.example",
    "https://jira.bücher.example",
  ],
  [
    "a host whose letters carry marks",
    "https://jira.भारत.example",
    "https://jira.भारत.example",
  ],
  [
    "a host in its punycode form",
    "https://jira.xn--bcher-kva.example",
    "https://jira.xn--bcher-kva.example",
  ],
  [
    "the longest address a site can have",
    `https://${"a".repeat(292)}`,
    `https://${"a".repeat(292)}`,
  ],
  [
    "a scheme in capitals, linked in lower case",
    "HTTPS://Acme.atlassian.net",
    "https://Acme.atlassian.net",
  ],
  ["the IPv6 loopback address", "http://[::1]:8443", "http://[::1]:8443"],
];

// What the wizard refuses, and the scripts never link to.
const NOT_SITES: Array<[string, string]> = [
  ["no scheme", "acme.atlassian.net"],
  ["another scheme", "ftp://acme.atlassian.net"],
  ["a script", "javascript:alert(1)"],
  ["a page of Jira Cloud", "https://acme.atlassian.net/jira/your-work"],
  ["an issue's page", "https://acme.atlassian.net/browse/OPS-17"],
  [
    "a page of Jira Data Center",
    "https://jira.example.com/secure/Dashboard.jspa",
  ],
  [
    "a page of Jira under a context path",
    "https://example.com/jira/browse/OPS-17",
  ],
  [
    "the API gateway's address, which no browser opens",
    "https://api.atlassian.com/ex/jira/7a3c1b2e-cloud-id",
  ],
  ["a query", "https://acme.atlassian.net?next=/browse"],
  ["a query after a slash", "https://acme.atlassian.net/?next=/browse"],
  ["a fragment", "https://acme.atlassian.net/#/browse"],
  ["a user name and a password", "https://user:secret@acme.atlassian.net"],
  ["a space in the host", "https://acme .atlassian.net"],
  ["a line break in the host", "https://acme\n.atlassian.net"],
  ["markup after the host", "https://a.example)<img src=x onerror=alert(1)>"],
  [
    "a Markdown link after the host",
    "https://a.example)[x](https://tracker.example/p.png",
  ],
  ["a mention in the path", "https://a.example/<!channel>"],
  ["two slashes at the end", "https://acme.atlassian.net//"],
  ["a percent-encoded path", "https://example.com/j%69ra"],
  ["a backslash", "https://example.com\\jira"],
  ["a path in another script", "https://example.com/jíra"],
  [
    "a right-to-left override in the host",
    `https://acme${String.fromCharCode(0x202e)}ten.naissalta`,
  ],
  [
    "a no-break space in the host",
    `https://acme${String.fromCharCode(0xa0)}.atlassian.net`,
  ],
  [
    "a numeral a browser reads as digits and a dot",
    `https://acme${String.fromCharCode(0x2488)}example`,
  ],
  ["an unclosed IPv6 address", "http://[2001:db8::1"],
  ["a port that is not a number", "https://acme.atlassian.net:https"],
  ["a port of six digits", "https://acme.atlassian.net:844300"],
  ["no host", "https://"],
  ["no host, then a path", "https:///jira"],
  ["a host of dots alone", "https://.."],
  ["a host of a dash, with a port", "https://-:8443"],
  ["a host of an underscore and a tilde", "https://_~"],
  ["a host of a dot, before a context path", "https://./jira"],
  [
    "a long s in the scheme, which folds to an s",
    `http${String.fromCharCode(0x17f)}://acme.atlassian.net`,
  ],
  [
    "a Kelvin sign in the path, which folds to a k",
    `https://example.com/${String.fromCharCode(0x212a)}ira`,
  ],
  ["an address longer than a site's can be", `https://${"a".repeat(293)}`],
  ["a reference to a variable that is gone", "{{local.variables.jiraSiteUrl}}"],
];

// Event URLs, as #4676's tests pinned them: sites, and URLs that are not one.
const EVENT_URLS: Array<string> = [
  "https://acme.atlassian.net/rest/api/2/issue/10040",
  "https://jira.example.com:8443/rest/api/2/issue/10040",
  "https://example.com/jira/rest/api/2/issue/10040",
  "http://10.0.0.5:8080/rest/api/2/issue/10040",
  "http://jira_dev.corp:8080/rest/api/2/issue/10040",
  "http://[2001:db8::1]:8443/rest/api/2/issue/10040",
  "https://jira.bücher.example/rest/api/2/issue/10040",
  "https://a.example)<img src=x onerror=alert(1)>/rest/api/2/issue/10040",
  "https://a.example)![x](https://tracker.example/p.png)/rest",
  "https://a.example)<!channel>/rest/api/2/issue/10040",
  "https://user:secret@acme.atlassian.net/rest",
  "https://acme.atlassian.net?next=x/rest/api/2/issue/10040",
  "https://acme.atlassian.net /rest/api/2/issue/10040",
  "https://acme.atlassian.net\n/rest/api/2/issue/10040",
  "javascript:alert(1)//acme.atlassian.net/rest",
  "https:///rest/api/2/issue/10040",
  `https://acme${String.fromCharCode(0x202e)}ten.naissalta/rest/api/2/issue/10040`,
  "http://[2001:db8::1/rest/api/2/issue/10040",
  `https://${"a".repeat(300)}.example/rest/api/2/issue/10040`,
  "",
];

/*
 * Pieces of URLs and of what can be written into one, so generated event
 * URLs reach every branch of the old reading: sites, paths, ports, IPv6,
 * markup, spaces, other scripts, look-alike characters.
 */
const URL_ALPHABET: Array<string> = [
  "https://",
  "http://",
  "acme.atlassian.net",
  "jira.example.com",
  "bücher",
  "a",
  "1",
  ".",
  "-",
  "_",
  "~",
  ":",
  ":8443",
  "/",
  "/rest/api/2/issue/10040",
  "[",
  "]",
  "2001:db8::1",
  ")",
  "(",
  "<",
  ">",
  "!",
  "?",
  "#",
  "@",
  "%",
  " ",
  "\n",
  "\\",
  "javascript:",
  String.fromCharCode(0x202e),
  String.fromCharCode(0xa0),
  String.fromCharCode(0x2488),
];

/*
 * Pieces of what someone could type as a site's address, the host's pieces
 * twice so that many of the texts are one: hosts, ports, a context path, an
 * IPv6 address, and what a site's address cannot hold.
 */
const HOST_PIECES: Array<string> = [
  "acme",
  "atlassian",
  "net",
  "jira",
  ".",
  "-",
  "_",
  "~",
  "bücher",
  "1",
  "8",
];

const SITE_ALPHABET: Array<string> = [
  ...HOST_PIECES,
  ...HOST_PIECES,
  ":8443",
  ":",
  "/",
  "/jira",
  "[2001:db8::1]",
  "?",
  "#",
  "@",
  " ",
  "<",
  ")",
  "(",
  "%",
  "\\",
  "!",
  "\n",
  "[",
  "]",
];

/* ------------------------------ The setting ------------------------------ */

// What a browser's URL parser reads in an address, as far as these tests ask.
interface ParsedAddress {
  scheme: boolean;
  user: string;
  query: string;
  fragment: string;
  oneSegmentAtMost: boolean;
}

describe("the Jira Site URL a workflow is created with", () => {
  test.each(SITES)("takes %s", (_case: string, typed: string, site: string) => {
    expect(JIRA_SITE_URL_PATTERN.test(typed)).toBe(true);

    // The site links go to is what was typed, bar a slash at the end, with its scheme in lower case.
    const schemeEnd: number = typed.indexOf("://");
    const asLinked: string =
      typed.slice(0, schemeEnd).toLowerCase() + typed.slice(schemeEnd);

    expect(asLinked === site || asLinked === `${site}/`).toBe(true);
  });

  test.each(NOT_SITES)("refuses %s", (_case: string, typed: string) => {
    expect(JIRA_SITE_URL_PATTERN.test(typed)).toBe(false);
  });

  /*
   * Whatever the pattern takes is a site's address and nothing more: an
   * http or https scheme, a host, perhaps a port, perhaps one path segment,
   * perhaps a slash - so no page, query, fragment, user name, space or
   * markup can be part of a link built on it.
   */
  /*
   * Whatever the pattern takes is a site's address and nothing more: an
   * http or https scheme, a host, perhaps a port, perhaps one path segment,
   * perhaps a slash - so no page, query, fragment, user name, space or
   * markup can be part of a link built on it. Where a browser's URL parser
   * reads it, it reads those parts and no others. A host such as ".1" or a
   * port above 65535 is taken too, as an event's site always was, and no
   * parser reads it as an address: a link to it goes nowhere, and carries
   * nothing.
   */
  test("whatever it takes is a scheme, a host, a port and one path segment at most, with nothing a link could carry", () => {
    const typed: Array<string> = [
      ...generatedTexts(24000, 4676, SITE_ALPHABET, 8).map(
        (text: string): string => {
          return `https://${text}`;
        },
      ),
      ...generatedTexts(6000, 1729, SITE_ALPHABET, 8).map(
        (text: string): string => {
          return `http://${text}`;
        },
      ),
    ];
    const taken: Array<string> = Array.from(
      new Set(
        typed.filter((text: string): boolean => {
          return JIRA_SITE_URL_PATTERN.test(text);
        }),
      ),
    );
    const FORBIDDEN: RegExp = /[\s()<>[\]"'`\\@?#%!{}|^]/;
    let unparsed: number = 0;

    // Enough of them are sites, of every shape, for this to say something.
    expect(taken.length).toBeGreaterThan(1500);
    expect(
      taken.filter((text: string): boolean => {
        return text.includes("/jira");
      }).length,
    ).toBeGreaterThan(100);
    expect(
      taken.filter((text: string): boolean => {
        return text.includes(":8443");
      }).length,
    ).toBeGreaterThan(50);

    for (const text of taken) {
      const rest: string = text.slice(text.indexOf("://") + 3);
      // An IPv6 address is the one place brackets may stand.
      const outsideBrackets: string = rest.startsWith("[")
        ? rest.slice(rest.indexOf("]") + 1)
        : rest;
      let parsed: ParsedAddress | null = null;

      try {
        const url: URL = new URL(text);

        parsed = {
          scheme: ["http:", "https:"].includes(url.protocol),
          user: url.username + url.password,
          query: url.search,
          fragment: url.hash,
          oneSegmentAtMost: url.pathname.split("/").filter(Boolean).length <= 1,
        };
      } catch {
        unparsed++;
      }

      expect({
        text,
        forbidden: FORBIDDEN.test(outsideBrackets),
        slashes: rest.split("/").length - 1 <= 2,
        noEmptySegment: !rest.includes("//"),
        parsed: parsed,
      }).toEqual({
        text,
        forbidden: false,
        slashes: true,
        noEmptySegment: true,
        parsed: parsed && {
          scheme: true,
          user: "",
          query: "",
          fragment: "",
          oneSegmentAtMost: true,
        },
      });
    }

    // Nearly all of them a browser reads as an address.
    expect(unparsed).toBeLessThan(taken.length / 20);
  });

  test("is the first thing each template that links an issue asks for: required, not secret, checked as it is typed", () => {
    for (const template of jiraTemplates()) {
      const site: WorkflowTemplateVariable | undefined =
        template.variables.find((variable: WorkflowTemplateVariable) => {
          return variable.name === "jiraSiteUrl";
        });

      if (!site) {
        continue;
      }

      expect({
        template: template.id,
        first: template.variables[0]?.name,
        title: site.title,
        required: site.required,
        isSecret: site.isSecret,
        pattern: site.format?.pattern,
        placeholderTaken: JIRA_SITE_URL_PATTERN.test(site.placeholder),
      }).toEqual({
        template: template.id,
        first: "jiraSiteUrl",
        title: "Jira Site URL",
        required: true,
        isSecret: false,
        pattern: JIRA_SITE_URL_PATTERN,
        placeholderTaken: true,
      });
    }
  });

  /*
   * The field the API calls go to was titled Jira Site URL too. With a
   * scoped token it holds Atlassian's gateway, which no browser opens, so
   * it is the API's address, and says so: the two fields never read alike.
   */
  test("is told apart from the Jira API URL the requests go to", () => {
    const titles: Map<string, string> = new Map();

    for (const template of jiraTemplates()) {
      for (const variable of template.variables) {
        titles.set(variable.name, variable.title);
      }
    }

    expect(titles.get("jiraSiteUrl")).toBe("Jira Site URL");
    expect(titles.get("jiraBaseUrl")).toBe("Jira API URL");
  });
});

/* ------------------------------ The templates ------------------------------ */

describe("the templates that link a Jira issue", () => {
  test("are exactly the ones whose scripts build the link, and each asks for the site", () => {
    const linking: Array<string> = [];
    const asking: Array<string> = [];

    for (const template of jiraTemplates()) {
      const builds: boolean = jiraScripts().some(
        (step: ScriptStep): boolean => {
          return (
            step.templateId === template.id &&
            ownCodeOf(step).includes("issueLink(")
          );
        },
      );

      if (builds) {
        linking.push(template.id);
      }

      if (
        template.variables.some((variable: WorkflowTemplateVariable) => {
          return variable.name === "jiraSiteUrl";
        })
      ) {
        asking.push(template.id);
      }
    }

    expect(linking.sort()).toEqual(
      LINKING_SCRIPTS.map((step: ScriptStep): string => {
        return step.templateId;
      }).sort(),
    );
    expect(asking.sort()).toEqual(linking.sort());
  });

  test.each(LINKING_SCRIPTS)(
    "$componentId in $templateId is handed the site, and links the issue with it",
    (step: ScriptStep) => {
      const given: JSONObject | string = argumentsOf(step);

      expect(typeof given).toBe("object");
      expect((given as JSONObject)["jiraSiteUrl"]).toBe(
        "{{local.variables.jiraSiteUrl}}",
      );
      // The request body, the text Jira users wrote, still goes last.
      expect(Object.keys(given as JSONObject).pop()).toBe("payload");
      expect(ownCodeOf(step)).toContain(
        "issueLink(issue.self, issueKey, args.jiraSiteUrl)",
      );
    },
  );

  test("every Jira script reads the setting with the very pattern the wizard checks it with", () => {
    const declaration: string = `\nconst SITE_SETTING = /${JIRA_SITE_URL_PATTERN.source}/${JIRA_SITE_URL_PATTERN.flags};\n`;
    const scripts: Array<ScriptStep> = jiraScripts();

    // 17 templates, 23 scripts: every one starts with the same helper block.
    expect(scripts).toHaveLength(23);

    for (const step of scripts) {
      const code: string = scriptOf(step.templateId, step.componentId);

      expect({
        script: `${step.templateId} ${step.componentId}`,
        declares: code
          .slice(0, code.indexOf(STEP_SECTION))
          .includes(declaration),
      }).toEqual({
        script: `${step.templateId} ${step.componentId}`,
        declares: true,
      });
    }

    /*
     * A scheme in capitals is spelled out in the pattern, not taken with the
     * "i" flag, which beside "u" would fold "ſ" to "s" and the Kelvin sign
     * to "k".
     */
    expect(JIRA_SITE_URL_PATTERN.flags).toBe("u");
  });

  /*
   * SITE, which reads a site off an event's REST URL when a script is handed
   * no setting, is built from the same host and port as the setting's
   * pattern, so a change to one is a change to both. It is #4676's, word for
   * word; the setting asks one thing more of a host, a letter or a digit.
   */
  test("the scripts read an event's site with the setting's own host and port", () => {
    const code: string = scriptOf(
      LINKING_SCRIPTS[1]!.templateId,
      LINKING_SCRIPTS[1]!.componentId,
    );
    const prefix: string = "\nconst SITE = /^https?:\\/\\/";
    const start: number = code.indexOf(prefix);
    const end: number = code.indexOf("$/u;\n", start);

    expect(start).toBeGreaterThan(-1);

    const hostAndPort: string = code.slice(start + prefix.length, end);

    expect(hostAndPort).toBe(
      String.raw`(?:[\p{L}\p{M}\p{Nd}._~-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?`,
    );
    expect(JIRA_SITE_URL_PATTERN.source).toContain(hostAndPort);
  });
});

/* ------------------------------ The link ------------------------------ */

describe.each(LINKING_SCRIPTS)(
  "issueLink, as $componentId in $templateId carries it",
  (step: ScriptStep) => {
    // Event URLs of any shape, and ones shaped like a site's, so both of the old answers come up.
    const generatedSelfs: Array<string> = [
      ...generatedTexts(1500, 2026, URL_ALPHABET, 12),
      ...generatedTexts(3000, 2027, SITE_ALPHABET, 7).map(
        (text: string): string => {
          return `https://${text}/rest/api/2/issue/10040`;
        },
      ),
    ];
    const selfs: Array<JSONValue | undefined> = [
      ...EVENT_URLS,
      ...generatedSelfs.slice(0, 200),
      undefined,
      null,
      10040,
      {},
    ];

    const configured: Array<LinkCase> = [];
    const refused: Array<LinkCase> = [];
    const unset: Array<LinkCase> = [];
    const empty: Array<LinkCase> = [];
    // Each site's own event, for the sites a REST URL could name before: no context path.
    const matching: Array<LinkCase> = SITES.filter(
      ([, , site]: [string, string, string]): boolean => {
        return !site.slice(site.indexOf("://") + 3).includes("/");
      },
    ).map(([, typed, site]: [string, string, string]): LinkCase => {
      return {
        self: `${site}/rest/api/2/issue/10040`,
        key: JIRA_ISSUE_KEY,
        setting: typed,
      };
    });

    for (const [, typed] of SITES) {
      for (const self of selfs) {
        configured.push({ self: self, key: JIRA_ISSUE_KEY, setting: typed });
      }
    }

    for (const [, typed] of NOT_SITES) {
      for (const self of EVENT_URLS) {
        refused.push({ self: self, key: JIRA_ISSUE_KEY, setting: typed });
      }
    }

    // Handed no setting at all: the argument left out, or null.
    for (const self of [...selfs, ...generatedSelfs]) {
      unset.push({ self: self, key: JIRA_ISSUE_KEY });
      unset.push({ self: self, key: "ABC_1-2", setting: null });
    }

    // Handed an empty setting - a variable emptied after the workflow was created - or only spaces.
    for (const self of [...EVENT_URLS, ...generatedSelfs.slice(0, 200)]) {
      empty.push({ self: self, key: JIRA_ISSUE_KEY, setting: "" });
      empty.push({ self: self, key: JIRA_ISSUE_KEY, setting: " \t\n" });
    }

    let configuredLinks: Array<string> = [];
    let refusedLinks: Array<string> = [];
    let unsetLinks: Array<string> = [];
    let emptyLinks: Array<string> = [];
    let matchingLinks: Array<string> = [];

    beforeAll(async () => {
      configuredLinks = await linksBy(step, configured);
      refusedLinks = await linksBy(step, refused);
      unsetLinks = await linksBy(step, unset);
      emptyLinks = await linksBy(step, empty);
      matchingLinks = await linksBy(step, matching);
    });

    test("with the setting, links the issue on the configured site, whatever the event's issue URL says", () => {
      expect(configuredLinks).toHaveLength(configured.length);

      const site: Map<string, string> = new Map(
        SITES.map(([, typed, linked]: [string, string, string]) => {
          return [typed, linked];
        }),
      );
      const wrong: Array<[JSONValue | undefined, string, string]> = [];

      configured.forEach((linkCase: LinkCase, index: number): void => {
        const expected: string = linkTo(
          site.get(linkCase.setting as string)!,
          linkCase.key,
        );

        if (configuredLinks[index] !== expected) {
          wrong.push([linkCase.self, configuredLinks[index]!, expected]);
        }
      });

      expect(wrong.slice(0, 5)).toEqual([]);
    });

    test("an event from the configured site links exactly as it did before the setting", () => {
      // Every site but those under a context path, which were linked at their host: see below.
      expect(matching.length).toBe(SITES.length - 4);
      expect(matchingLinks).toEqual(
        matching.map((linkCase: LinkCase): string => {
          return issueLinkBefore(linkCase.self, linkCase.key);
        }),
      );
      expect(
        matchingLinks.every((link: string): boolean => {
          return link.startsWith("[");
        }),
      ).toBe(true);
    });

    test("a setting that is not a site's address names the issue without a link, even when the event names a site", () => {
      expect(refusedLinks).toEqual(
        refused.map((linkCase: LinkCase): string => {
          return linkCase.key;
        }),
      );
    });

    /*
     * A variable's content can be emptied after the workflow is created. An
     * empty setting names no site, so the issue is named without a link: the
     * site does not go back to the event's choosing.
     */
    test("an empty setting names the issue without a link, whatever the event's issue URL says", () => {
      expect(emptyLinks).toEqual(
        empty.map((linkCase: LinkCase): string => {
          return linkCase.key;
        }),
      );
      expect(
        empty.some((linkCase: LinkCase): boolean => {
          return issueLinkBefore(linkCase.self, linkCase.key).startsWith("[");
        }),
      ).toBe(true);
    });

    test("without the setting, links exactly as #4676's code did", () => {
      expect(unsetLinks).toHaveLength(unset.length);

      const differences: Array<[JSONValue | undefined, string, string]> = [];

      unset.forEach((linkCase: LinkCase, index: number): void => {
        const expected: string = issueLinkBefore(linkCase.self, linkCase.key);

        if (unsetLinks[index] !== expected) {
          differences.push([linkCase.self, unsetLinks[index]!, expected]);
        }
      });

      expect(differences.slice(0, 5)).toEqual([]);
      // The generated URLs reach both of the old reading's answers, on hundreds of sites.
      expect(
        new Set(
          unsetLinks.filter((link: string): boolean => {
            return link.startsWith("[");
          }),
        ).size,
      ).toBeGreaterThan(250);
      expect(unsetLinks).toContain(JIRA_ISSUE_KEY);
      expect(new Set(generatedSelfs).size).toBeGreaterThan(3400);
    });
  },
);

/*
 * #4676 linked Jira under a context path at its host, since no event can be
 * trusted to name the path; the link went nowhere. The setting names it.
 */
test("Jira Data Center under a context path is linked under that path, where it was linked at its host before", async () => {
  const self: string = "https://example.com/jira/rest/api/2/issue/10040";
  const links: Array<string> = await linksBy(LINKING_SCRIPTS[2]!, [
    { self: self, key: JIRA_ISSUE_KEY, setting: "https://example.com/jira" },
    { self: self, key: JIRA_ISSUE_KEY },
  ]);

  expect(links).toEqual([
    linkTo("https://example.com/jira", JIRA_ISSUE_KEY),
    issueLinkBefore(self, JIRA_ISSUE_KEY),
  ]);
  expect(links[1]).toBe(linkTo("https://example.com", JIRA_ISSUE_KEY));
});

/*
 * A value the wizard takes is one the scripts link to, and a value it
 * refuses is one they never link to - for every text, not only the tables.
 * The wizard trims what is typed before it checks and stores it, and the
 * scripts trim what they are handed. A blank value is refused by both: the
 * wizard asks for one, and the scripts link nothing.
 */
test("the scripts link to exactly the settings the wizard takes", async () => {
  const typed: Array<string> = [
    ...SITES.map(([, text]: [string, string, string]): string => {
      return text;
    }),
    ...NOT_SITES.map(([, text]: [string, string]): string => {
      return text;
    }),
    ...generatedTexts(4000, 1618, URL_ALPHABET, 9).map(
      (text: string): string => {
        return `https://${text}`;
      },
    ),
    ...generatedTexts(2000, 3141, URL_ALPHABET, 9),
    "",
    "   ",
  ];
  const links: Array<string> = await linksBy(
    LINKING_SCRIPTS[0]!,
    typed.map((setting: string): LinkCase => {
      return {
        self: "https://acme.atlassian.net/rest/api/2/issue/10040",
        key: JIRA_ISSUE_KEY,
        setting: setting,
      };
    }),
  );

  const disagreements: Array<[string, boolean, string]> = [];

  typed.forEach((setting: string, index: number): void => {
    const takes: boolean = JIRA_SITE_URL_PATTERN.test(setting.trim());
    const linked: boolean = links[index] !== JIRA_ISSUE_KEY;

    if (takes !== linked) {
      disagreements.push([setting, takes, links[index]!]);
    }
  });

  expect(disagreements.slice(0, 5)).toEqual([]);
  expect(
    typed.filter((setting: string): boolean => {
      return JIRA_SITE_URL_PATTERN.test(setting.trim());
    }).length,
  ).toBeGreaterThan(100);
});

/* ------------------------------ The renderers ------------------------------ */

/*
 * Each site the setting takes makes one link, read the same by marked (the
 * emails), the dashboard's parser and Slack's conversion: to the issue on
 * that site, under the issue's key. Nothing in the address ends the link
 * early or carries it anywhere else. Slack's conversion makes no link of an
 * address in brackets, IPv6 or not, as it did before the setting, and names
 * the issue as text there.
 */
describe("a link on each site the setting takes", () => {
  const texts: Array<string> = SITES.map(
    ([, , site]: [string, string, string]): string => {
      return `Synced from Jira: Priya Patel updated ${linkTo(site, JIRA_ISSUE_KEY)}.`;
    },
  );
  let pages: Array<string> = [];

  beforeAll(() => {
    pages = renderAsDashboard(texts);
  });

  test.each(
    SITES.map((entry: [string, string, string], index: number) => {
      return [entry[0], entry[2], index] as [string, string, number];
    }),
  )(
    "%s: is one link to the issue on that site, wherever it is read",
    (_case: string, site: string, index: number) => {
      const text: string = texts[index]!;
      const issueUrl: string = `${site}/browse/${JIRA_ISSUE_KEY}`;
      const tokens: Array<Token> = [];

      marked.walkTokens(marked.lexer(text), (token: Token): void => {
        tokens.push(token);
      });

      const markedLinks: Array<[string, string]> = tokens
        .filter((token: Token): boolean => {
          return token.type === "link";
        })
        .map((token: Token): [string, string] => {
          const link: Token & { href: string; text: string } =
            token as Token & {
              href: string;
              text: string;
            };

          return [link.href, link.text];
        });
      const anchors: Array<[string, string]> = Array.from(
        pages[index]!.matchAll(DASHBOARD_ANCHOR),
      ).map((anchor: RegExpMatchArray): [string, string] => {
        return [
          decodeURI(decodeHtmlEntities(anchor[1]!)),
          decodeHtmlEntities(anchor[2]!),
        ];
      });
      const slack: string = SlackUtil.convertMarkdownToSlackRichText(text);
      const slackLinks: Array<[string, string]> = Array.from(
        slack.matchAll(SLACK_LINK),
      ).map((link: RegExpMatchArray): [string, string] => {
        return [link[1]!, link[2]!];
      });
      const isIpv6: boolean = site.includes("[");

      expect({
        marked: markedLinks,
        markedHtml: tokens.filter((token: Token): boolean => {
          return token.type === "html" || token.type === "image";
        }).length,
        dashboard: anchors,
        slack: slackLinks.map(([url, words]: [string, string]) => {
          return [decodeURI(url), words];
        }),
      }).toEqual({
        marked: [[issueUrl, JIRA_ISSUE_KEY]],
        markedHtml: 0,
        dashboard: [[issueUrl, JIRA_ISSUE_KEY]],
        slack: isIpv6 ? [] : [[issueUrl, JIRA_ISSUE_KEY]],
      });

      if (isIpv6) {
        expect(slack).toContain(`updated ${JIRA_ISSUE_KEY}.`);
      }
    },
  );
});
