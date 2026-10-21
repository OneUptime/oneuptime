import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  AcknowledgeAlertTool,
  ResolveAlertTool,
} from "Common/Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  PageOnCallPolicyTool,
  RunRunbookTool,
} from "Common/Server/Utils/AI/Toolbox/AIActionTools";
import {
  AcknowledgeIncidentTool,
  ResolveIncidentTool,
} from "Common/Server/Utils/AI/Toolbox/IncidentWriteTools";
import { ObservabilityTool } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT ASK AI'S ACTIONS ARE MADE AS.
 *
 * Every action Ask AI takes makes the change the dashboard makes for the
 * same action, with the props of the person who asked. The English docs say
 * so, and the permissions they name are the tools' own: a permission added
 * to or taken from a tool's list fails here until the page says so too. The
 * upgrade notes say what changes, and link to a section that exists.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const ASK_AI_PAGE: string = "ai/ask-ai.md";
const ACTIONS_SECTION: string = "Actions are made as you";

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

// The text under an H2 heading, up to the next H2.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`## ${heading}`);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    return line.startsWith("## ");
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The one bullet of a section that starts with `prefix`.
function bullet(text: string, prefix: string): string {
  const lines: Array<string> = text.split("\n").filter((item: string) => {
    return item.startsWith(`- ${prefix}`);
  });

  expect(lines).toHaveLength(1);

  return lines[0]!;
}

const ALL_PERMISSIONS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

function isRole(permission: Permission): boolean {
  return ALL_PERMISSIONS.some((props: PermissionProps): boolean => {
    return props.permission === permission && Boolean(props.isRolePermission);
  });
}

// The titles of the roles (not single permissions) among `permissions`.
function roleTitles(permissions: Array<Permission>): Array<string> {
  return ALL_PERMISSIONS.filter((props: PermissionProps): boolean => {
    return props.isRolePermission && permissions.includes(props.permission);
  }).map((props: PermissionProps): string => {
    return props.title;
  });
}

// The titles of the single permissions (not roles) among `permissions`.
function permissionTitles(permissions: Array<Permission>): Array<string> {
  return PermissionHelper.getPermissionTitles(
    permissions.filter((permission: Permission): boolean => {
      return !isRole(permission);
    }),
  );
}

// Every bold role title a line names.
function boldRoleTitles(line: string): Array<string> {
  const roles: Set<string> = new Set(
    ALL_PERMISSIONS.filter((props: PermissionProps): boolean => {
      return Boolean(props.isRolePermission);
    }).map((props: PermissionProps): string => {
      return props.title;
    }),
  );

  return [...line.matchAll(/\*\*([^*]+)\*\*/g)]
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .filter((title: string): boolean => {
      return roles.has(title);
    });
}

const actions: string = section(read(ASK_AI_PAGE), ACTIONS_SECTION);

describe("Docs: Ask AI's actions are made as the person who asked", () => {
  test("the section says actions make the dashboard's change, as the person, credited to them", () => {
    expect(actions).toContain(
      "it makes the change the dashboard makes for the same action, with your own permissions in the project, and the change is credited to you",
    );
    expect(actions).toContain(
      "creates the same state change as the incident's state panel",
    );
    expect(actions).toContain("shows you as who triggered it");
  });

  test("names exactly the roles that may change an incident's state", () => {
    const line: string = bullet(actions, "**What each action needs.**");

    // The incident state tools ask what the state panel asks.
    expect([...AcknowledgeIncidentTool.requiredPermissions].sort()).toEqual(
      [...new IncidentStateTimeline().getCreatePermissions()].sort(),
    );
    expect(boldRoleTitles(line).sort()).toEqual(
      roleTitles(AcknowledgeIncidentTool.requiredPermissions).sort(),
    );
  });

  test.each([
    AcknowledgeIncidentTool,
    ResolveIncidentTool,
    AcknowledgeAlertTool,
    ResolveAlertTool,
    PageOnCallPolicyTool,
    RunRunbookTool,
  ])(
    "names the permission $name needs, by the name the role editor shows",
    (tool: ObservabilityTool) => {
      const line: string = bullet(actions, "**What each action needs.**");
      const titles: Array<string> = permissionTitles(tool.requiredPermissions);

      expect(titles.length).toBeGreaterThan(0);

      for (const title of titles) {
        expect(line).toContain(`**${title}**`);
      }
    },
  );

  test("says a refused action is answered with the permission it needs", () => {
    const line: string = bullet(actions, "**What each action needs.**");

    expect(line).toContain(
      "An action you may not take is refused, and the AI tells you which permission it needs.",
    );
    // A held permission a team blocks is answered as blocked, not missing.
    expect(line).toContain(
      "When you hold the permission but a team you belong to blocks it, the AI tells you that instead: a block on some labels refuses that action in Ask AI for every record",
    );
  });

  test("says a granular permission to start runbook executions reaches every runbook", () => {
    const line: string = bullet(actions, "**What each action needs.**");

    expect(line).toContain(
      "**Create Runbook Execution** in a custom role, which reaches every runbook of the project",
    );
  });

  test("says only records the person may change are acted on, and the plan is asked too", () => {
    const line: string = bullet(actions, "**Which records.**");

    expect(line).toContain("with a role limited to some labels");
    expect(line).toContain("or to the records you own");
    expect(line).toContain("changes nothing");
    expect(line).toContain("refused with the plan it needs");
  });

  test("says a refusal changes nothing and is told plainly, not retried", () => {
    const line: string = bullet(actions, "**When an action is refused.**");

    expect(line).toContain("Nothing changes");
    expect(line).toContain("rather than trying it again");
  });

  test("says Slack and Teams answers and AI investigations take no actions, and links to the buttons that do", () => {
    const line: string = bullet(
      actions,
      "**Slack, Microsoft Teams and AI investigations.**",
    );

    expect(line).toContain("only read: they take none of these actions");

    for (const [page, heading] of [
      [
        "workspace-connections/slack",
        "Acting on incidents, alerts and events from Slack",
      ],
      [
        "workspace-connections/microsoft-teams",
        "Acting on incidents, alerts and events from Microsoft Teams",
      ],
    ] as Array<[string, string]>) {
      expect(line).toContain(`(/docs/${page}#${slugify(heading)})`);
      expect(read(`${page}.md`).split("\n")).toContain(`## ${heading}`);
    }
  });
});

describe("Docs: the upgrade note on Ask AI's actions", () => {
  const upgrading: string = read("installation/upgrading.md");
  const note: string = upgrading.replace(/\n\s*/g, " ");

  test("says what changes, naming the new permissions", () => {
    expect(upgrading).toContain(
      "**Ask AI's actions are made as the person who asked.**",
    );
    expect(note).toContain(
      "Acknowledging and resolving used to need permission to edit the incident or alert",
    );

    for (const tool of [
      AcknowledgeIncidentTool,
      AcknowledgeAlertTool,
      PageOnCallPolicyTool,
      RunRunbookTool,
    ]) {
      for (const title of permissionTitles(tool.requiredPermissions)) {
        expect(note).toContain(`**${title}**`);
      }
    }

    expect(note).toContain("A refused action changes nothing");
  });

  test("links to the Ask AI section, a heading that exists", () => {
    const anchor: string = slugify(ACTIONS_SECTION);

    expect(upgrading.replace(/\n\s*/g, "")).toContain(
      `(/docs/ai/ask-ai#${anchor})`,
    );
    expect(
      read(ASK_AI_PAGE)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        })
        .map((line: string): string => {
          return slugify(line.replace(/^#+\s*/, ""));
        }),
    ).toContain(anchor);
  });
});
