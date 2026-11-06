/*
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import AIToolbox from "Common/Server/Utils/AI/Toolbox/Index";
import {
  AcknowledgeAlertTool,
  CreateAlertTool,
} from "Common/Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  AcknowledgeIncidentTool,
  CreateIncidentTool,
} from "Common/Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  INITIAL_STATE_ARGUMENT_NAME,
  NEW_RECORD_STARTS,
  NewRecordStart,
  describeStartForPerson,
} from "Common/Server/Utils/AI/Toolbox/NewRecords";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import {
  ObservabilityChatApp,
  ObservabilityChatSurface,
  buildObservabilityChatSystemPrompt,
} from "Common/Server/Utils/AI/Chat/ObservabilityChatPrompt";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "Common/Server/Utils/Workspace/WorkspaceCommands";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describeAIActionSentence } from "Common/Types/AI/AIActionWords";
import AIChatPageContextType from "Common/Types/AI/AIChatPageContext";
import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
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
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * #5315'S FOLLOW-UPS, AS THE DOCS SAY THEM.
 *
 * Ask AI raises alerts and declares incidents (#5301), and now:
 *
 *   - one it creates can start acknowledged or resolved, to write up a
 *     problem someone is already handling or that is over, and then pages
 *     nobody (create_incident's and create_alert's initialState, NewRecords);
 *     the approval card says which, and the start takes the permission to
 *     change the record's state as well as to create it;
 *   - a refused action's step says the action was not done, and why
 *     (ChatActivityFeed's REFUSED_TOOL_CALL_DETAILS);
 *   - asked for a change in Slack or Microsoft Teams, the AI says how to
 *     make it there - the incident and page commands, the buttons, or Ask
 *     AI by its link - and asked in an incident's or an alert's own channel,
 *     it takes that record as the one meant (ObservabilityChatPrompt).
 *
 * The Alerts and Incidents overviews list Ask AI among where records come
 * from. Every sentence below is tied to the code that makes it true, and
 * every language says it on the English page's lines.
 */

const REPO_PACKAGES: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_PACKAGES, relativePath), "utf8");
}

const ALERTS_OVERVIEW: string = "alerts/index";
const INCIDENTS_OVERVIEW: string = "incidents/index";
const DECLARING: string = "incidents/declaring-incidents";
const SLACK: string = "workspace-connections/slack";
const TEAMS: string = "workspace-connections/microsoft-teams";

const DECLARED_LATER: string = "Declared already acknowledged or resolved";
const CREATED_LATER: string = "Created already acknowledged or resolved";

const OTHER_LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function lines(language: string, page: string): Array<string> {
  return readPage(language, page).split("\n");
}

// The index of the one English line that starts with `start`.
function englishLine(page: string, start: string): number {
  const found: Array<number> = lines("en", page)
    .map((line: string, index: number): number => {
      return line.startsWith(start) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect({ page, start, found: found.length }).toEqual({
    page,
    start,
    found: 1,
  });

  return found[0]!;
}

// The pages and anchors one line of a page links to, in order.
function linksOn(
  language: string,
  page: string,
  index: number,
): Array<DocsPageLink> {
  return scanPage(language, page)
    .links.filter((link: DocsLink): boolean => {
      return link.line === index + 1;
    })
    .map((link: DocsLink): DocsPageLink => {
      return (
        parseDocsLink(link.target) || {
          // An in-page link: "#created-already-acknowledged-or-resolved".
          page: page,
          anchor: decodeURIComponent(link.target.replace(/^#/, "")),
        }
      );
    });
}

// The anchor of a page's heading, in this language, by the English heading's place.
function headingAnchor(
  language: string,
  page: string,
  english: string,
): string {
  const index: number = scanPage("en", page).headings.findIndex(
    (heading: DocsHeading): boolean => {
      return heading.text === english;
    },
  );

  expect({ page, english, found: index >= 0 }).toEqual({
    page,
    english,
    found: true,
  });

  return scanPage(language, page).headings[index]!.slug;
}

function toolNamed(name: string): ObservabilityTool {
  const tool: ObservabilityTool | undefined = AIToolbox.getTools().find(
    (candidate: ObservabilityTool): boolean => {
      return candidate.name === name;
    },
  );

  expect({ name, found: Boolean(tool) }).toEqual({ name, found: true });

  return tool!;
}

function sorted(permissions: Array<Permission>): Array<Permission> {
  return [...permissions].sort();
}

// The new lines, by the English line they follow or are.
const ASK_AI_WRITE_UP: number = englishLine(ASK_AI, "- Write up a problem");
const ALERTS_ASK_AI: number = englishLine(ALERTS_OVERVIEW, "- **Ask AI.**");
const INCIDENTS_ASK_AI: number = englishLine(
  INCIDENTS_OVERVIEW,
  "  - **From Ask AI**",
);
const DECLARING_LATER: number = englishLine(
  DECLARING,
  "Picking a later **Initial State**",
);
const NEEDS: number = englishLine(ASK_AI, "- **What each action needs.**");
const REFUSED: number = englishLine(ASK_AI, "- **When an action is refused.**");
const CHAT_APPS: number = englishLine(
  ASK_AI,
  "- **Slack, Microsoft Teams and AI investigations.**",
);
const SLACK_ASKING: number = englishLine(
  SLACK,
  "Ask about your logs, traces, metrics, incidents and monitors in plain language.",
);
const TEAMS_ASK_ROW: number = englishLine(TEAMS, "| `ask [question]`");

const english: (page: string, index: number) => string = (
  page: string,
  index: number,
): string => {
  return lines("en", page)[index] || "";
};

describe("a record Ask AI creates can start acknowledged or resolved", () => {
  test.each([
    ["create_incident", CreateIncidentTool],
    ["create_alert", CreateAlertTool],
  ])(
    "%s takes an initialState of acknowledged or resolved, and nothing else",
    (name: string, tool: ObservabilityTool) => {
      const properties: JSONObject = tool.inputSchema[
        "properties"
      ] as JSONObject;
      const start: JSONObject = properties[
        INITIAL_STATE_ARGUMENT_NAME
      ] as JSONObject;

      expect(toolNamed(name)).toBe(tool);
      expect(start["enum"]).toEqual([...NEW_RECORD_STARTS]);
      expect(NEW_RECORD_STARTS).toEqual(["acknowledged", "resolved"]);
      // Left out, a new record starts where every new one does.
      expect(tool.inputSchema["required"]).not.toContain(
        INITIAL_STATE_ARGUMENT_NAME,
      );
      expect(start["description"]).toContain(
        "Never use it to keep people from being paged about a live problem.",
      );
    },
  );

  test("the Ask AI page lists it among the actions, after linking, and links to what a later start does", () => {
    const line: string = english(ASK_AI, ASK_AI_WRITE_UP);

    expect(english(ASK_AI, ASK_AI_WRITE_UP - 1)).toMatch(
      /^- Link an incident or an alert to the infrastructure/,
    );
    expect(english(ASK_AI, ASK_AI_WRITE_UP + 1)).toMatch(
      /^- Post an internal note/,
    );
    expect(line).toBe(
      `- Write up a problem that someone is already handling, or that is already over: an incident or an alert it creates can start acknowledged or resolved, and then pages nobody. The approval card says which. See [${DECLARED_LATER}](/docs/${DECLARING}#${slugify(DECLARED_LATER)}).`,
    );
    expect(linksOn("en", ASK_AI, ASK_AI_WRITE_UP)).toEqual([
      {
        page: DECLARING,
        anchor: headingAnchor("en", DECLARING, DECLARED_LATER),
      },
    ]);
  });

  test("the approval card says which, and that it pages nobody", () => {
    expect(
      describeAIActionSentence(
        describeStartForPerson(NewRecordStart.Acknowledged)!,
      ),
    ).toBe("Starts acknowledged, so it pages nobody.");
    expect(
      describeAIActionSentence(
        describeStartForPerson(NewRecordStart.Resolved)!,
      ),
    ).toBe("Starts resolved, so it pages nobody.");
    // A new record says nothing about where it starts.
    expect(describeStartForPerson(null)).toBeNull();
  });

  test.each([
    ["incident", CreateIncidentTool, AcknowledgeIncidentTool],
    ["alert", CreateAlertTool, AcknowledgeAlertTool],
  ])(
    "a new %s that starts later needs permission to create it and to change its state, as the page says",
    (
      _record: string,
      create: ObservabilityTool,
      acknowledge: ObservabilityTool,
    ) => {
      for (const start of NEW_RECORD_STARTS) {
        const groups: Array<Array<Permission>> =
          create.getRequiredPermissionGroups!({
            title: "Checkout was down",
            [INITIAL_STATE_ARGUMENT_NAME]: start,
          });

        expect(groups.map(sorted)).toEqual([
          sorted(create.requiredPermissions),
          sorted(acknowledge.requiredPermissions),
        ]);
      }

      // Left out, creating one takes the permission to create it alone.
      expect(
        create.getRequiredPermissionGroups!({ title: "Checkout is down" }).map(
          sorted,
        ),
      ).toEqual([sorted(create.requiredPermissions)]);
    },
  );

  test("What each action needs says so, after the state change's permission", () => {
    const line: string = english(ASK_AI, NEEDS);
    const stateChange: number = line.indexOf(
      "(**Create Alert State Timeline**).",
    );
    const both: number = line.indexOf(
      "Creating an incident or an alert that starts acknowledged or resolved needs both: permission to create it, and permission to change its state.",
    );

    expect(stateChange).toBeGreaterThan(-1);
    expect(both).toBeGreaterThan(stateChange);
  });

  test("the Alerts Overview lists Ask AI where alerts come from, after By hand, linking to what a later start does", () => {
    const line: string = english(ALERTS_OVERVIEW, ALERTS_ASK_AI);
    const overview: string = readPage("en", ALERTS_OVERVIEW);

    expect(english(ALERTS_OVERVIEW, ALERTS_ASK_AI - 1)).toMatch(
      /^- \*\*By hand\.\*\*/,
    );
    expect(english(ALERTS_OVERVIEW, ALERTS_ASK_AI + 1)).toMatch(
      /^- \*\*An SLO's burn rate\.\*\*/,
    );
    expect(line).toContain(
      "In [Ask AI](/docs/ai/ask-ai), ask for an alert: it raises one as you, linked to the resource whose page you asked on",
    );
    expect(line).toContain(
      "ask for it acknowledged or resolved: it starts in that state and pages nobody.",
    );
    expect(linksOn("en", ALERTS_OVERVIEW, ALERTS_ASK_AI)).toEqual([
      { page: "ai/ask-ai", anchor: null },
      {
        page: ALERTS_OVERVIEW,
        anchor: headingAnchor("en", ALERTS_OVERVIEW, CREATED_LATER),
      },
    ]);
    // Its cards and its first step name it too.
    expect(overview).toContain(
      "- [Where alerts come from](#where-alerts-come-from): Monitors, SLOs, chat, Ask AI, the API, or by hand.",
    );
    expect(overview).toContain(
      "a page sent from Slack or Microsoft Teams, Ask AI, or a person.",
    );
    expect(overview).toContain(
      "The alert starts in your created state unless the form, the API, a workflow or Ask AI picked another.",
    );
  });

  test("an alert or incident Ask AI creates on a resource's page is linked to it, as the overviews say", () => {
    for (const file of ["IncidentWriteTools.ts", "AlertWriteTools.ts"]) {
      expect(readSource(`Common/Server/Utils/AI/Toolbox/${file}`)).toContain(
        "AffectedResourceLinks.withPageResourceWrittenOut({ args, ctx })",
      );
    }
  });

  test("the Incidents Overview lists Ask AI under By hand, after From alerts", () => {
    const line: string = english(INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI);

    expect(english(INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI - 1)).toMatch(
      /^ {2}- \*\*From alerts\*\*/,
    );
    expect(english(INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI + 1)).toMatch(
      /^- \*\*From a template\*\*/,
    );
    expect(line).toContain(
      "in [Ask AI](/docs/ai/ask-ai), ask for an incident: it declares one as you",
    );
    expect(linksOn("en", INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI)).toEqual([
      { page: "ai/ask-ai", anchor: null },
      {
        page: DECLARING,
        anchor: headingAnchor("en", DECLARING, DECLARED_LATER),
      },
    ]);
  });

  test("Declaring an Incident names Ask AI among the ways to start one later", () => {
    expect(english(DECLARING, DECLARING_LATER)).toContain(
      "or by asking [Ask AI](/docs/ai/ask-ai) for an incident already acknowledged or resolved — records an incident",
    );
    // The section the line opens, whose heading the other pages link to.
    expect(english(DECLARING, DECLARING_LATER - 2)).toBe(
      `### ${DECLARED_LATER}`,
    );
  });
});

describe("a refused action's step says it was not done, and why", () => {
  const feed: string = readSource(
    "App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed.tsx",
  );

  test.each([
    "your role does not allow it",
    "a team you belong to blocks it",
    "the project's plan does not include it",
  ])("the step says '%s', and the page names it", (reason: string) => {
    expect(feed).toContain(`"not done — ${reason}"`);
    expect(english(ASK_AI, REFUSED)).toContain(reason);
  });

  test("the page says so under When an action is refused, after what the AI says", () => {
    const line: string = english(ASK_AI, REFUSED);

    expect(line).toContain(
      "the AI tells you plainly that the action was not taken, and why, rather than trying it again. Among the answer's steps, the action's own says it was not done, and why: your role does not allow it, a team you belong to blocks it, or the project's plan does not include it.",
    );
    // Each reason is the step's own, picked by the refusal the toolbox reports.
    expect(feed).toContain("REFUSED_TOOL_CALL_DETAILS[refusal]");
  });
});

describe("asked for a change in Slack or Microsoft Teams, the AI says how to make it there", () => {
  const slack: ObservabilityChatApp = {
    name: "Slack",
    incidentCommand: WorkspaceCommands.getUsage({
      workspaceType: WorkspaceType.Slack,
      command: WorkspaceCommandName.Incident,
    }),
    pageCommand: WorkspaceCommands.getUsage({
      workspaceType: WorkspaceType.Slack,
      command: WorkspaceCommandName.Page,
    }),
    askAiUrl: "https://oneuptime.example/dashboard/project/ai/chat",
  };
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-11-03T10:00:00Z"),
    permissionMode: AIChatPermissionMode.ReadOnly,
    surface: ObservabilityChatSurface.ChatApp,
    chatApp: slack,
    pageContext: {
      type: AIChatPageContextType.Incident,
      entityId: "40000000-0000-4000-8000-000000000042",
      entityTitle: "INC-42 Checkout is down",
    },
  });

  test("the commands the page names are the ones the chat apps run, and the ones the model is told", () => {
    expect(slack.incidentCommand).toBe("/oneuptime incident");
    expect(slack.pageCommand).toBe("/oneuptime page");
    // Microsoft Teams: the same words, typed to the bot.
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        command: WorkspaceCommandName.Incident,
      }),
    ).toBe("incident");
    expect(prompt).toContain(
      "declare an incident with `/oneuptime incident <title>`",
    );
    expect(prompt).toContain(
      "with `/oneuptime incident <number>`, which shows its buttons",
    );
    expect(prompt).toContain("page a person or a team with `/oneuptime page`");
    expect(prompt).toContain(
      "Ask AI in the OneUptime Dashboard, which proposes the change for them to approve: https://oneuptime.example/dashboard/project/ai/chat",
    );
    expect(prompt).toContain(
      "Slack has no modes: never tell them to switch modes.",
    );

    const line: string = english(ASK_AI, CHAT_APPS);

    expect(line).toContain("only read: they take none of these actions.");
    expect(line).toContain(
      "`/oneuptime incident` declares an incident, `/oneuptime incident 42` shows incident 42 with its buttons, `/oneuptime page` pages someone (in Microsoft Teams, the same words typed to the OneUptime bot)",
    );
    expect(line).toContain(
      "For any other change, it links to Ask AI, which proposes the change for you to approve.",
    );
  });

  test("asked in an incident's own channel, the question is about that incident, as the pages say", () => {
    expect(prompt).toContain("## Current channel context");
    expect(prompt).toContain("assume they mean this channel's incident.");
    expect(english(ASK_AI, CHAT_APPS)).toContain(
      "Asked in an incident's or an alert's own channel, it takes that incident or alert as the one you mean.",
    );
    expect(english(SLACK, SLACK_ASKING)).toContain(
      "Asked in an incident's or an alert's own channel, it answers about that incident or alert.",
    );
    expect(english(TEAMS, TEAMS_ASK_ROW)).toContain(
      "In an incident's or an alert's own channel, it answers about that incident or alert.",
    );
  });

  test("the chat apps' pages say how a change is made there, in their own commands", () => {
    expect(english(SLACK, SLACK_ASKING)).toContain(
      "Answers in Slack only read: asked for a change, OneUptime AI says how to make it from Slack, such as with `/oneuptime incident` or the buttons on OneUptime's messages, or links to Ask AI for anything else.",
    );
    expect(english(TEAMS, TEAMS_ASK_ROW)).toContain(
      "Answers only read: asked for a change, it says how to make it here, such as with `incident` or the buttons on OneUptime's cards, or links to Ask AI for anything else.",
    );
  });
});

describe("every language says it on the English page's lines", () => {
  test.each(OTHER_LANGUAGES)("%s", (language: string) => {
    const askAi: Array<string> = lines(language, ASK_AI);
    const alerts: Array<string> = lines(language, ALERTS_OVERVIEW);
    const incidents: Array<string> = lines(language, INCIDENTS_OVERVIEW);

    // The new list items, where the English ones are, each its own.
    expect(askAi[ASK_AI_WRITE_UP]).toMatch(/^- /);
    expect(alerts[ALERTS_ASK_AI]).toMatch(/^- \*\*/);
    expect(incidents[INCIDENTS_ASK_AI]).toMatch(/^ {2}- \*\*/);
    expect(askAi[ASK_AI_WRITE_UP]).not.toBe(english(ASK_AI, ASK_AI_WRITE_UP));
    expect(alerts[ALERTS_ASK_AI]).not.toBe(
      english(ALERTS_OVERVIEW, ALERTS_ASK_AI),
    );
    expect(incidents[INCIDENTS_ASK_AI]).not.toBe(
      english(INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI),
    );

    // Linking where the English lines link, under this language's headings.
    expect(linksOn(language, ASK_AI, ASK_AI_WRITE_UP)).toEqual([
      {
        page: DECLARING,
        anchor: headingAnchor(language, DECLARING, DECLARED_LATER),
      },
    ]);
    expect(linksOn(language, ALERTS_OVERVIEW, ALERTS_ASK_AI)).toEqual([
      { page: "ai/ask-ai", anchor: null },
      {
        page: ALERTS_OVERVIEW,
        anchor: headingAnchor(language, ALERTS_OVERVIEW, CREATED_LATER),
      },
    ]);
    expect(linksOn(language, INCIDENTS_OVERVIEW, INCIDENTS_ASK_AI)).toEqual([
      { page: "ai/ask-ai", anchor: null },
      {
        page: DECLARING,
        anchor: headingAnchor(language, DECLARING, DECLARED_LATER),
      },
    ]);
    expect(
      linksOn(language, DECLARING, DECLARING_LATER).map(
        (link: DocsPageLink): string => {
          return link.page;
        },
      ),
    ).toEqual(["ai/ask-ai"]);

    // The commands, as typed, on the lines that name them.
    expect(askAi[CHAT_APPS]).toContain("`/oneuptime incident`");
    expect(askAi[CHAT_APPS]).toContain("`/oneuptime incident 42`");
    expect(askAi[CHAT_APPS]).toContain("`/oneuptime page`");
    expect(lines(language, SLACK)[SLACK_ASKING]).toContain(
      "`/oneuptime incident`",
    );
    expect(lines(language, TEAMS)[TEAMS_ASK_ROW]).toContain("`incident`");

    // The permissions bullet and the refusal bullet stay where they were.
    expect(askAi[NEEDS]).toMatch(/^- \*\*/);
    expect(askAi[NEEDS]).toContain("**Create Alert State Timeline**");
    expect(askAi[REFUSED]).toMatch(/^- \*\*/);
  });
});
