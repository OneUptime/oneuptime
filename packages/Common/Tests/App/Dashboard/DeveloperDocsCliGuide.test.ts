import { describe, expect, test } from "@jest/globals";
import {
  DEVELOPER_DOCS_GUIDE_COPY,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsSection,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DeveloperDocsChildPage,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsChildPages,
  getDeveloperDocsRelativePath,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import { INSTALL_SCRIPT_READ_FIRST_NOTE } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";
import {
  SetupGuideStepVariant,
  SetupGuideTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Incident from "../../../Models/DatabaseModels/Incident";
import Models from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Team from "../../../Models/DatabaseModels/Team";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import {
  getCliActions,
  getCliDatabaseOperations,
  getCliResourceName,
  CLI_FIELDS_SUBCOMMAND,
} from "../../../Utils/DeveloperDocs/CliCommands";
import {
  CliResource,
  getCliResources,
} from "../../../Utils/DeveloperDocs/CliResources";
import { getApiReadSelect } from "../../../Utils/DeveloperDocs/ExampleBuilder";
import {
  fixtureRecordId,
  getEmptyFixtureLiveData,
  getFixtureLiveData,
} from "../../Utils/DeveloperDocs/DeveloperDocsLiveFixture";

/*
 * Developer > CLI: every product's Developer section has it, beside
 * Terraform, API and AI Assistants. It installs the CLI (the script this
 * OneUptime serves, or npm at its version), connects it with a project API
 * key, and shows the API page's requests as CLI commands filled in from
 * the project - with the dashboard's buttons as the CLI's own commands.
 * packages/CLI/Tests/DeveloperDocsCommands runs the commands through the
 * CLI itself; these hold the page to what it says around them.
 */

const INCIDENT_ID: string = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
const ORIGIN: string = "https://oneuptime.example.com";
const API_KEYS_URL: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/settings/api-keys";
const CRITICAL: string = fixtureRecordId(
  "IncidentSeverity",
  "Critical Incident",
);
const MAJOR: string = fixtureRecordId("IncidentSeverity", "Major Incident");
const ACKNOWLEDGED: string = fixtureRecordId("IncidentState", "Acknowledged");

const FENCE: string = "```";

function context(
  overrides: Partial<DeveloperDocsGuideContext>,
): DeveloperDocsGuideContext {
  return {
    resource: getDeveloperDocsResource(Incident),
    scope: DeveloperDocsScope.List,
    oneuptimeUrl: ORIGIN,
    platformVersion: "14.0.11",
    apiKeysUrl: API_KEYS_URL,
    live: getFixtureLiveData(),
    ...overrides,
  };
}

function incidentJson(): JSONObject {
  return {
    _id: INCIDENT_ID,
    title: "Checkout requests are failing",
    description: "Customers see an error when they pay.",
    incidentSeverityId: { _type: "ObjectID", value: CRITICAL },
    currentIncidentStateId: { _type: "ObjectID", value: ACKNOWLEDGED },
    createdAt: { _type: "DateTime", value: "2026-10-02T09:12:00.000Z" },
  };
}

function incidentView(): DeveloperDocsGuide {
  return getDeveloperDocsGuide(
    DeveloperDocsPageType.Cli,
    context({
      scope: DeveloperDocsScope.View,
      record: {
        id: INCIDENT_ID,
        displayName: "Checkout requests are failing",
        json: incidentJson(),
      },
    }),
  );
}

function incidentList(
  overrides: Partial<DeveloperDocsGuideContext> = {},
): DeveloperDocsGuide {
  return getDeveloperDocsGuide(DeveloperDocsPageType.Cli, context(overrides));
}

function stepTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.steps.map((step: DeveloperDocsStep): string => {
    return step.title;
  });
}

function step(guide: DeveloperDocsGuide, title: string): DeveloperDocsStep {
  return guide.steps.find((candidate: DeveloperDocsStep): boolean => {
    return candidate.title === title;
  }) as DeveloperDocsStep;
}

function section(
  guide: DeveloperDocsGuide,
  title: string,
): DeveloperDocsSection {
  return guide.sections.find((candidate: DeveloperDocsSection): boolean => {
    return candidate.title === title;
  }) as DeveloperDocsSection;
}

function topic(guide: DeveloperDocsGuide, title: string): SetupGuideTopic {
  return guide.topics.find((candidate: SetupGuideTopic): boolean => {
    return candidate.title === title;
  }) as SetupGuideTopic;
}

// Every code block of a guide: steps, tabs, sections and topics.
function codeBlocks(guide: DeveloperDocsGuide): Array<string> {
  const markdown: Array<string> = [];

  for (const item of [...guide.steps, ...guide.sections]) {
    markdown.push(item.markdown || "");

    for (const variant of item.variants || []) {
      markdown.push(variant.markdown);
    }
  }

  for (const item of guide.topics) {
    markdown.push(item.markdown);
  }

  const blocks: Array<string> = [];

  for (const text of markdown) {
    const parts: Array<string> = text.split(FENCE);

    // Odd parts are inside fences: "bash\n<code>\n".
    for (let index: number = 1; index < parts.length; index += 2) {
      const part: string = parts[index] || "";

      blocks.push(part.slice(part.indexOf("\n") + 1));
    }
  }

  return blocks;
}

// The `oneuptime ...` commands of a guide, each as one line.
function cliCommands(guide: DeveloperDocsGuide): Array<string> {
  return codeBlocks(guide)
    .map((block: string): string => {
      return block.split(" \\\n  ").join(" ");
    })
    .flatMap((block: string): Array<string> => {
      return block.split("\n");
    })
    .filter((line: string): boolean => {
      return line.startsWith("oneuptime ");
    });
}

function modelFor(tableName: string): DatabaseBaseModelType {
  return Models.find((modelType: DatabaseBaseModelType): boolean => {
    return new modelType().tableName === tableName;
  }) as DatabaseBaseModelType;
}

describe("the CLI page in every Developer section", () => {
  test("comes after the API page and before AI Assistants, with the terminal icon", () => {
    expect(
      DEVELOPER_DOCS_PAGES.map((page: DeveloperDocsPageDefinition): string => {
        return page.title;
      }),
    ).toEqual(["Terraform", "API", "CLI", "AI Assistants"]);
    expect(
      DEVELOPER_DOCS_PAGES.find((page: DeveloperDocsPageDefinition) => {
        return page.type === DeveloperDocsPageType.Cli;
      })?.icon,
    ).toBe(IconProp.Terminal);
    expect(getDeveloperDocsRelativePath(DeveloperDocsPageType.Cli)).toBe(
      "developer/cli",
    );
  });

  test("hangs under every page that has Developer pages, list and view alike", () => {
    for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
      expect(
        getDeveloperDocsChildPages(parent.pageKey).map(
          (child: DeveloperDocsChildPage): DeveloperDocsPageType => {
            return child.page.type;
          },
        ),
      ).toContain(DeveloperDocsPageType.Cli);
    }
  });

  test("covers every resource those pages are about: each is a CLI resource", () => {
    const names: Array<string> = getCliResources().map(
      (resource: CliResource): string => {
        return resource.name;
      },
    );

    for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
      const modelType: DatabaseBaseModelType = modelFor(parent.tableName);

      expect({
        table: parent.tableName,
        hasCommand: names.includes(getCliResourceName(new modelType())),
      }).toEqual({ table: parent.tableName, hasCommand: true });
    }
  });

  test.each(
    DEVELOPER_DOCS_PARENT_PAGES.map(
      (parent: DeveloperDocsParentPage): [string, DeveloperDocsParentPage] => {
        return [`${parent.tableName} (${parent.scope})`, parent];
      },
    ),
  )(
    "for %s, shows only commands the CLI has",
    (_name: string, parent: DeveloperDocsParentPage) => {
      const modelType: DatabaseBaseModelType = modelFor(parent.tableName);
      const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
        DeveloperDocsPageType.Cli,
        context({
          resource: getDeveloperDocsResource(modelType),
          scope: parent.scope,
          listQuery: parent.query,
          record:
            parent.scope === DeveloperDocsScope.View
              ? {
                  id: "99999999-9999-4999-8999-999999999999",
                  displayName: "Example",
                  json: { _id: "99999999-9999-4999-8999-999999999999" },
                }
              : undefined,
        }),
      );
      const resources: Map<string, CliResource> = new Map(
        getCliResources().map(
          (resource: CliResource): [string, CliResource] => {
            return [resource.name, resource];
          },
        ),
      );
      const commands: Array<string> = cliCommands(guide);

      expect(commands.length).toBeGreaterThan(2);

      for (const command of commands) {
        const [, name, subcommand] = command.split(" ") as [
          string,
          string,
          string,
        ];

        if (["login", "whoami", "resources", "--version"].includes(name)) {
          continue;
        }

        const resource: CliResource | undefined = resources.get(name);

        expect({ command, resource: Boolean(resource) }).toEqual({
          command,
          resource: true,
        });
        expect({
          command,
          subcommand: [
            ...(resource?.operations || []),
            CLI_FIELDS_SUBCOMMAND,
            ...(resource?.actions || []),
            "--help",
          ].includes(subcommand),
        }).toEqual({ command, subcommand: true });
      }
    },
  );
});

describe("installing and connecting the CLI", () => {
  const guide: DeveloperDocsGuide = incidentList();

  test("are the first two steps", () => {
    expect(stepTitles(guide).slice(0, 2)).toEqual([
      "Install the CLI",
      "Connect it to OneUptime",
    ]);
  });

  test("installs with the script this OneUptime serves, which matches its version, or with npm at its version", () => {
    const install: DeveloperDocsStep = step(guide, "Install the CLI");

    expect(
      install.variants?.map((variant: SetupGuideStepVariant): string => {
        return variant.label;
      }),
    ).toEqual(["Install script", "npm"]);
    expect(install.variants?.[0]?.markdown).toContain(
      `curl -fsSL ${ORIGIN}/install/cli -o install.sh\nONEUPTIME_URL=${ORIGIN} bash install.sh`,
    );
    expect(install.variants?.[0]?.markdown).toContain(
      INSTALL_SCRIPT_READ_FIRST_NOTE,
    );
    expect(install.variants?.[1]?.markdown).toContain(
      "npm install -g @oneuptime/cli@14.0.11\noneuptime --version",
    );
    expect(install.description).toContain("Node.js 22 or later");
  });

  test("installs the newest CLI with npm for a development build, which names no release", () => {
    const install: DeveloperDocsStep = step(
      incidentList({ platformVersion: "1.0.0" }),
      "Install the CLI",
    );

    expect(install.variants?.[1]?.markdown).toContain(
      "npm install -g @oneuptime/cli\n",
    );
  });

  test("connects with the key in the environment, and checks OneUptime takes it", () => {
    const connect: DeveloperDocsStep = step(guide, "Connect it to OneUptime");

    expect(connect.markdown).toContain(
      `[Project Settings → Advanced → API Keys](${API_KEYS_URL})`,
    );
    expect(connect.markdown).toContain("permission to manage incidents");
    expect(connect.markdown).toContain(
      `export ONEUPTIME_API_KEY="your-api-key"\nexport ONEUPTIME_URL=${ORIGIN}\noneuptime whoami --check`,
    );
    expect(connect.markdown).toContain(
      `run \`oneuptime login <api-key> ${ORIGIN}\``,
    );
  });

  test("never writes a key into a command", () => {
    for (const block of codeBlocks(guide)) {
      expect(block).not.toContain("--api-key");
    }
  });
});

describe("the Incidents list's CLI page", () => {
  const guide: DeveloperDocsGuide = incidentList({
    sample: {
      records: [
        {
          _id: INCIDENT_ID,
          title: "Checkout requests are failing",
          extra: "left out",
        },
      ],
      count: 7,
    },
  });

  test("lists, finds and declares incidents after installing and connecting", () => {
    expect(stepTitles(guide)).toEqual([
      "Install the CLI",
      "Connect it to OneUptime",
      "List your incidents",
      "Find the ones you need",
      "Declare an incident",
    ]);
  });

  test("lists the newest ten with the fields the API page asks for, and shows the records as the CLI prints them", () => {
    const list: DeveloperDocsStep = step(guide, "List your incidents");
    const fields: string = Object.keys(getApiReadSelect(Incident))
      .filter((name: string): boolean => {
        return name !== "_id";
      })
      .join(",");

    expect(list.markdown).toContain(
      `oneuptime incident list \\\n  --fields ${fields} \\\n  --limit 10 \\\n  --json`,
    );
    // The records, not the API's envelope, and only the fields asked for.
    expect(list.markdown).toContain(
      `[\n  {\n    "_id": "${INCIDENT_ID}",\n    "title": "Checkout requests are failing"\n  }\n]`,
    );
    expect(list.markdown).not.toContain("left out");
    expect(list.markdown).toContain(
      "Shown with the first of your 7 incidents.",
    );
  });

  test("filters with --query, one tab each, filled in from this project", () => {
    const find: DeveloperDocsStep = step(guide, "Find the ones you need");

    expect((find.variants || []).length).toBeGreaterThan(0);

    for (const variant of find.variants || []) {
      expect(variant.markdown).toContain("oneuptime incident list");
      expect(variant.markdown).toContain("--query");
    }
  });

  test("declares an incident with flags, a severity of this project, and says what each flag is for", () => {
    const create: DeveloperDocsStep = step(guide, "Declare an incident");

    expect(create.markdown).toContain("oneuptime incident create");
    expect(create.markdown).toContain(`--incident-severity-id ${CRITICAL}`);
    expect(create.markdown).toContain("--title");
    expect(create.markdown).toContain("What each flag is for:");
    expect(create.markdown).toContain(
      "- `--incident-severity-id` (required): How bad it is: one of your incident severities.",
    );
    expect(create.description).toContain(
      "It prints the new one, with its _id.",
    );
  });

  test("ends with every command for incidents, then paging, counting, agents and scripts folded away", () => {
    expect(
      guide.sections.map((item: DeveloperDocsSection): string => {
        return item.title;
      }),
    ).toEqual(["Commands"]);
    expect(section(guide, "Commands").markdown).toBe(
      [
        "- List incidents: `oneuptime incident list`",
        "- Read one: `oneuptime incident get <id>`",
        "- Create an incident: `oneuptime incident create`",
        "- Change one: `oneuptime incident update <id>`",
        "- Delete one: `oneuptime incident delete <id>`",
        "- Count incidents: `oneuptime incident count`",
        "- Its fields and flags: `oneuptime incident fields`",
        "- Acknowledge one: `oneuptime incident acknowledge <id>`",
        "- Resolve one: `oneuptime incident resolve <id>`",
        "- Add a note: `oneuptime incident add-note <id>`",
      ].join("\n"),
    );
    expect(
      guide.topics.map((item: SetupGuideTopic): string => {
        return item.title;
      }),
    ).toEqual([
      "Page through all of them",
      "Count your incidents",
      "Use it from an AI agent",
      "Use it in a script",
    ]);
    expect(topic(guide, "Page through all of them").markdown).toContain(
      "oneuptime incident list --all --json",
    );
    expect(topic(guide, "Count your incidents").markdown).toContain(
      "oneuptime incident count",
    );
  });

  test("tells an AI agent when to use the CLI, and how to learn what it can do", () => {
    const agents: SetupGuideTopic = topic(guide, "Use it from an AI agent");

    expect(agents.summary).toBe("The CLI or the MCP server");
    expect(agents.markdown).toContain(
      "Use the MCP server for an assistant you chat with",
    );
    expect(agents.markdown).toContain(
      "Use the CLI for an agent that runs commands",
    );
    expect(agents.markdown).toContain("`--json`");
    expect(agents.markdown).toContain(
      "oneuptime resources --json\noneuptime incident fields --json\noneuptime incident --help",
    );
  });

  test("says how a script reads the exit codes", () => {
    const scripts: SetupGuideTopic = topic(guide, "Use it in a script");

    expect(scripts.markdown).toContain(
      "`0` when it worked, `1` when OneUptime refused it, `2` when the API key is missing or refused, and `3` when the record is not there",
    );
  });

  test("links to the CLI's docs, its command reference and the page for AI agents", () => {
    expect(guide.links).toEqual([
      { title: "CLI", url: `${ORIGIN}/docs/cli/index` },
      {
        title: "Command reference",
        url: `${ORIGIN}/docs/cli/command-reference`,
      },
      {
        title: "The CLI for AI agents",
        url: `${ORIGIN}/docs/cli/ai-agents`,
      },
    ]);
  });

  test("shows no answer it does not have, and no made-up names, in a new project", () => {
    const empty: DeveloperDocsGuide = incidentList({
      live: getEmptyFixtureLiveData(),
    });
    const text: string = JSON.stringify(empty);

    expect(step(empty, "List your incidents").markdown).not.toContain(
      "It answers with:",
    );
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("{name}");
  });
});

describe("an incident's own CLI page", () => {
  const guide: DeveloperDocsGuide = incidentView();

  test("reads it, changes it and deletes it, after installing and connecting", () => {
    expect(stepTitles(guide)).toEqual([
      "Install the CLI",
      "Connect it to OneUptime",
      "Read it",
      "Change it",
      "Delete it",
    ]);
  });

  test("reads it with --fields, and shows its real answer", () => {
    const read: DeveloperDocsStep = step(guide, "Read it");

    expect(read.markdown).toContain(`oneuptime incident get ${INCIDENT_ID}`);
    expect(read.markdown).toContain("--fields");
    expect(read.markdown).toContain('"title": "Checkout requests are failing"');
  });

  test("changes its severity to another of this project's, by flag", () => {
    expect(step(guide, "Change it").markdown).toContain(
      `oneuptime incident update ${INCIDENT_ID} \\\n  --incident-severity-id ${MAJOR}`,
    );
  });

  test("deletes it for good", () => {
    expect(step(guide, "Delete it").markdown).toContain(
      `oneuptime incident delete ${INCIDENT_ID}`,
    );
  });

  test("writes the dashboard's buttons as the CLI's own commands", () => {
    const tasks: DeveloperDocsSection = section(guide, "Common tasks");
    const byLabel: Record<string, string> = Object.fromEntries(
      (tasks.variants || []).map(
        (variant: SetupGuideStepVariant): [string, string] => {
          return [variant.label, variant.markdown];
        },
      ),
    );

    expect(byLabel["Acknowledge it"]).toContain(
      `oneuptime incident acknowledge ${INCIDENT_ID}`,
    );
    expect(byLabel["Resolve it"]).toContain(
      `oneuptime incident resolve ${INCIDENT_ID}`,
    );
    // A long command goes a flag a line, as the curl commands do.
    expect(byLabel["Internal note"]).toContain(
      `oneuptime incident add-note ${INCIDENT_ID} \\\n  --note 'Rolled back the 14:05 deploy. Error rates are dropping.'`,
    );
    expect(byLabel["Public update"]).toContain(
      "--note 'We found the cause and are rolling out a fix.' \\\n  --public",
    );
    // Never the state timeline row the API page shows for the same task.
    expect(JSON.stringify(tasks)).not.toContain("incident-state-timeline");
  });

  test("lists this incident's commands with its ID", () => {
    expect(section(guide, "Commands").markdown).toContain(
      `- Acknowledge one: \`oneuptime incident acknowledge ${INCIDENT_ID}\``,
    );
  });

  test("tells agents and scripts how to use it, folded away", () => {
    expect(
      guide.topics.map((item: SetupGuideTopic): string => {
        return item.title;
      }),
    ).toEqual(["Use it from an AI agent", "Use it in a script"]);
  });
});

describe("other resources' CLI pages", () => {
  test("a scheduled maintenance event starts and ends with commands of its own", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Cli,
      context({
        resource: getDeveloperDocsResource(ScheduledMaintenance),
        scope: DeveloperDocsScope.View,
        record: { id: INCIDENT_ID, displayName: "Database upgrade", json: {} },
      }),
    );
    const text: string = JSON.stringify(section(guide, "Common tasks"));

    expect(getCliActions("ScheduledMaintenance")).toEqual([
      "start",
      "end",
      "add-note",
    ]);
    expect(text).toContain(
      `oneuptime scheduled-maintenance-event start ${INCIDENT_ID}`,
    );
    expect(text).toContain(
      `oneuptime scheduled-maintenance-event end ${INCIDENT_ID}`,
    );
  });

  test("a monitor is created with the dashboard's own first monitor, by flags", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Cli,
      context({ resource: getDeveloperDocsResource(Monitor) }),
    );
    const create: string = guide.steps[guide.steps.length - 1]?.markdown || "";

    expect(create).toContain("oneuptime monitor create");
    expect(create).toContain("--monitor-type");
    // Steps are JSON on the command line.
    expect(create).toContain("--monitor-steps '");
  });

  test("a team's members are listed with the team's own query", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Cli,
      context({
        resource: getDeveloperDocsResource(Team),
        scope: DeveloperDocsScope.View,
        record: { id: INCIDENT_ID, displayName: "Platform", json: {} },
      }),
    );

    expect(JSON.stringify(guide.sections)).toContain(
      "oneuptime team-member list",
    );
  });

  test("a resource the CLI does not cover says so, instead of commands that would fail", () => {
    expect(getCliDatabaseOperations(EmailVerificationToken)).toEqual([]);

    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Cli,
      context({ resource: getDeveloperDocsResource(EmailVerificationToken) }),
    );

    expect(guide.notice).toMatch(/^The CLI does not cover /);
    expect(guide.steps).toEqual([]);
  });
});

describe("the CLI card's own words", () => {
  test("say what the page does, for one resource and for a list, and name no resource", () => {
    expect(DEVELOPER_DOCS_GUIDE_COPY[DeveloperDocsPageType.Cli]).toEqual({
      [DeveloperDocsScope.View]: {
        title: "CLI",
        description:
          "Read, change and delete this resource from a terminal, a script or an AI agent with the OneUptime CLI. Every command below runs against this OneUptime.",
      },
      [DeveloperDocsScope.List]: {
        title: "CLI",
        description:
          "List, filter and create these resources from a terminal, a script or an AI agent with the OneUptime CLI. Every command below runs against this OneUptime and is filled in from this project.",
      },
    });
  });
});
