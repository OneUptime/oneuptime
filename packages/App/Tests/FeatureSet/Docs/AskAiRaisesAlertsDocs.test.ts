/*
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import AIToolbox from "Common/Server/Utils/AI/Toolbox/Index";
import { CreateAlertTool } from "Common/Server/Utils/AI/Toolbox/AlertWriteTools";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import { INCIDENTS_ALERTS_AND_MONITORS_SECTION } from "Common/Server/Utils/AI/Chat/ObservabilityChatPrompt";
import {
  HostAlertTemplate,
  getHostAlertTemplateById,
} from "Common/Types/Monitor/HostAlertTemplates";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { ASK_AI } from "./AiDocsPages";
import {
  DocsHeading,
  DocsLink,
  DocsPageLink,
  parseDocsLink,
  readPage,
  scanPage,
} from "./DocsContentSupport";
import { toLatinDigits } from "./DocsTranslationChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #5301: "Create alert on high ram 75%", asked on a host's page, was
 * answered with "I don't have a tool available to create new alerts".
 * Ask AI raises alerts now, as it declares incidents, and its page says,
 * after the actions it can take:
 *
 *   - which one to ask for: an incident when users are affected, an alert
 *     when something needs the team's attention first - the split the chat
 *     prompt and create_alert give the model, and the Alerts Overview
 *     gives the reader;
 *   - that either is created once and watches nothing, so being alerted
 *     every time memory goes over 75% is a Host monitor, built from its
 *     memory template - one that exists, with a threshold the page says
 *     is a starting point;
 *   - that Ask AI cannot create monitors, and asked for one, says so,
 *     checks the value now and offers an alert - what the prompt tells it,
 *     and true of the toolbox, which writes no monitor.
 *
 * Every language says it on the English paragraph's line, linking the Host
 * monitor's templates under that language's own heading.
 */

const PARAGRAPH_START: string = "Ask for an incident when users are affected";
const HOST_MONITOR: string = "monitor/host-monitor";
const TEMPLATES_HEADING: string = "Pre-built Alert Templates";

const ENGLISH_LINES: Array<string> = readPage("en", ASK_AI).split("\n");
const PARAGRAPH_LINE: number = ENGLISH_LINES.findIndex(
  (line: string): boolean => {
    return line.startsWith(PARAGRAPH_START);
  },
);
const PARAGRAPH: string = ENGLISH_LINES[PARAGRAPH_LINE] || "";

const OTHER_LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// The place of the templates' heading among the Host monitor page's headings.
const TEMPLATES_HEADING_INDEX: number = scanPage(
  "en",
  HOST_MONITOR,
).headings.findIndex((heading: DocsHeading): boolean => {
  return heading.text === TEMPLATES_HEADING;
});

// The links of one line of a page to the Host monitor page.
function hostMonitorLinks(language: string, line: number): Array<DocsPageLink> {
  return scanPage(language, ASK_AI)
    .links.filter((link: DocsLink): boolean => {
      return link.line === line + 1;
    })
    .map((link: DocsLink): DocsPageLink | null => {
      return parseDocsLink(link.target);
    })
    .filter((link: DocsPageLink | null): link is DocsPageLink => {
      return link?.page === HOST_MONITOR;
    });
}

describe("the Ask AI page says which to ask for, and what an alert rule is", () => {
  test("the paragraph follows the actions Ask AI can take, before the section on whose actions they are", () => {
    expect(PARAGRAPH_LINE).toBeGreaterThan(-1);
    expect(ENGLISH_LINES[PARAGRAPH_LINE - 1]).toBe("");
    expect(ENGLISH_LINES[PARAGRAPH_LINE - 2]).toMatch(
      /^- Propose a code change:/,
    );
    expect(ENGLISH_LINES[PARAGRAPH_LINE + 1]).toBe("");
    expect(ENGLISH_LINES[PARAGRAPH_LINE + 2]).toBe(
      "## Actions are made as you",
    );
  });

  test("an incident when users are affected, an alert for a first look: as the model is told, and as Alerts Overview tells the reader", () => {
    expect(PARAGRAPH).toContain(
      "Ask for an incident when users are affected, and for an alert when something needs your team's attention first, such as a host's memory running high.",
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "Declare an incident (create_incident) for an outage or a problem users feel",
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "Raise an alert (create_alert) for something the team should look into that is not, or not yet, an outage: a host's memory running high",
    );
    expect(CreateAlertTool.description).toContain(
      "For an outage or a problem users feel, declare an incident with create_incident instead",
    );
    expect(readPage("en", "alerts/index")).toContain(
      "Raise an alert when your team should look before anyone outside notices, and declare an incident when users are affected.",
    );
  });

  test("either one is created once and watches nothing, as the model is told", () => {
    expect(PARAGRAPH).toContain(
      "Either one is created once and watches nothing",
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "An incident or an alert is created once, now, and watches nothing.",
    );
    expect(CreateAlertTool.description).toContain(
      "An alert is raised once, now: it is not a rule and watches nothing.",
    );
  });

  test("Ask AI cannot create monitors: no tool of its toolbox writes one", () => {
    const monitorWriters: Array<string> = AIToolbox.getTools()
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation) && tool.name.includes("monitor");
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      });

    expect(PARAGRAPH).toContain("Ask AI cannot create monitors.");
    expect(monitorWriters).toEqual([]);
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "asks for a monitor, and no tool here creates one",
    );
  });

  test("asked for one, it says so, checks the value now and offers an alert: what the prompt tells it to do", () => {
    expect(PARAGRAPH).toContain(
      "Asked for one, it says so, checks the value now, and offers to raise an alert if it is already over.",
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "say so plainly, read the condition now with the metric tools, and if it holds now, offer to raise an alert about it",
    );
  });

  test("a 75% memory alert is a Host monitor from its memory template, whose threshold is a starting point", () => {
    const memory: HostAlertTemplate | undefined =
      getHostAlertTemplateById("host-high-memory");
    const hostMonitorPage: string = readPage("en", HOST_MONITOR);

    expect(memory?.name).toBe("High Memory Utilization");
    expect(hostMonitorPage).toContain(`## ${TEMPLATES_HEADING}`);
    expect(hostMonitorPage).toContain(
      "Thresholds are starting points you can edit.",
    );
    expect(hostMonitorPage).toContain(`| ${memory?.name} |`);
    expect(PARAGRAPH).toContain(
      "to be alerted every time a host's memory goes over 75%, create a [Host monitor](/docs/monitor/host-monitor#pre-built-alert-templates) from its memory template, with 75% as its threshold.",
    );

    // The link names the templates' heading.
    expect(TEMPLATES_HEADING_INDEX).toBeGreaterThan(-1);
    expect(hostMonitorLinks("en", PARAGRAPH_LINE)).toEqual([
      {
        page: HOST_MONITOR,
        anchor: scanPage("en", HOST_MONITOR).headings[TEMPLATES_HEADING_INDEX]!
          .slug,
      },
    ]);
  });
});

describe("every language says it on the English paragraph's line", () => {
  test.each(OTHER_LANGUAGES)("%s", (language: string) => {
    const line: string =
      readPage(language, ASK_AI).split("\n")[PARAGRAPH_LINE] || "";
    const lines: Array<string> = readPage(language, ASK_AI).split("\n");

    // A paragraph of its own, between the list and the next section.
    expect(line.length).toBeGreaterThan(0);
    expect(line).not.toBe(PARAGRAPH);
    expect(line).not.toMatch(/^[-#>|]/);
    expect(lines[PARAGRAPH_LINE - 1]).toBe("");
    expect(lines[PARAGRAPH_LINE - 2]).toMatch(/^- /);
    expect(lines[PARAGRAPH_LINE + 2]).toMatch(/^## /);

    // The threshold, twice, in this language's digits (Persian's own).
    expect(toLatinDigits(line).split("75")).toHaveLength(3);

    // The Host monitor's templates, under this language's own heading.
    const templatesHeading: DocsHeading | undefined = scanPage(
      language,
      HOST_MONITOR,
    ).headings[TEMPLATES_HEADING_INDEX];

    expect(templatesHeading).toBeDefined();
    expect(hostMonitorLinks(language, PARAGRAPH_LINE)).toEqual([
      { page: HOST_MONITOR, anchor: templatesHeading!.slug },
    ]);
  });
});
