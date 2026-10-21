import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import slugify from "Common/Server/Types/MarkdownSlugify";
import MicrosoftTeamsIncidentActions from "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsOnCallDutyActions from "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import SlackIncidentActions from "Common/Server/Utils/Workspace/Slack/Actions/Incident";
import WorkspaceActionAuthorization from "Common/Server/Utils/Workspace/WorkspaceActionAuthorization";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT SLACK'S AND MICROSOFT TEAMS' BUTTONS ACT AS.
 *
 * Acknowledge, Resolve, Change State, Add Note and Execute On-Call Policy
 * on Slack messages and Teams cards make the change the dashboard makes for
 * the same action, as the OneUptime member the chat account is connected to
 * (WorkspaceMemberActions). The English docs say so, the roles they name
 * are the models' own - a role added to or taken from the state timeline's
 * create list fails here until the pages say so too - and the sentences
 * they quote are the ones the chats send. The upgrade notes say what
 * changes, and link to sections that exist.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const SLACK_SECTION: string =
  "Acting on incidents, alerts and events from Slack";
const TEAMS_SECTION: string =
  "Acting on incidents, alerts and events from Microsoft Teams";

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
  return ALL_PERMISSIONS.filter((props: PermissionProps): boolean => {
    return !props.isRolePermission && permissions.includes(props.permission);
  }).map((props: PermissionProps): string => {
    return props.title;
  });
}

// Every bold role title a line names.
function boldRoleTitles(line: string): Array<string> {
  const roles: Set<string> = new Set(
    ALL_PERMISSIONS.filter((props: PermissionProps): boolean => {
      return props.isRolePermission;
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

const PAGES: Array<{ name: string; text: () => string }> = [
  {
    name: "Slack",
    text: (): string => {
      return section(read("workspace-connections/slack.md"), SLACK_SECTION);
    },
  },
  {
    name: "Microsoft Teams",
    text: (): string => {
      return section(
        read("workspace-connections/microsoft-teams.md"),
        TEAMS_SECTION,
      );
    },
  },
];

describe("Docs: Slack's and Microsoft Teams' buttons act as the member", () => {
  test.each(PAGES)(
    "$name names the buttons and says each makes the dashboard's change, credited to the member",
    (page: { text: () => string }) => {
      const text: string = page.text();

      for (const button of [
        "**Acknowledge**",
        "**Resolve**",
        "**Change State**",
        "**Add Note**",
        "**Execute On-Call Policy**",
        "**Mark as Ongoing**",
        "**Mark as Complete**",
      ]) {
        expect(text).toContain(button);
      }

      expect(text).toContain(
        "each make the change the same action makes in OneUptime",
      );
      expect(text).toContain("credited to");
      expect(text).toContain("reaction is posted the same way");
    },
  );

  test.each(PAGES)(
    "$name names exactly the roles that may change an incident's state",
    (page: { text: () => string }) => {
      const line: string = bullet(page.text(), "**Who may use them.**");

      expect(boldRoleTitles(line).sort()).toEqual(
        roleTitles(new IncidentStateTimeline().getCreatePermissions()).sort(),
      );

      for (const title of permissionTitles(
        new IncidentStateTimeline().getCreatePermissions(),
      )) {
        expect(line).toContain(`**${title}**`);
      }

      // The other kinds' own permission, by the name the role editor shows.
      expect(line).toContain(
        `**${
          permissionTitles(new AlertStateTimeline().getCreatePermissions())[0]
        }**`,
      );
      expect(line).toContain("nothing changes");
    },
  );

  test.each(PAGES)(
    "$name says only readable records are acted on, in the words the chat answers with",
    (page: { text: () => string }) => {
      const line: string = bullet(page.text(), "**Which records.**");

      expect(line).toContain("with a role limited to some labels");
      expect(line).toContain("or on one of another project");
      expect(line).toContain(
        WorkspaceActionAuthorization.NOT_FOUND_OR_NOT_READABLE,
      );
      expect(line).toContain("refused with the plan it needs");
    },
  );

  test.each([
    {
      name: "Slack",
      text: PAGES[0]!.text,
      message: (): string => {
        return SlackIncidentActions.NO_STATES_MESSAGE;
      },
    },
    {
      name: "Microsoft Teams",
      text: PAGES[1]!.text,
      message: (): string => {
        return MicrosoftTeamsIncidentActions.NO_STATES_MESSAGE;
      },
    },
  ])(
    "$name says Change State offers the readable states, and quotes what it says when there are none",
    (page: { text: () => string; message: () => string }) => {
      const line: string = bullet(page.text(), "**What Change State offers.**");

      expect(line).toContain("in the project's order");
      expect(line).toContain(page.message());
    },
  );

  test("Microsoft Teams: Escalate pages for the card's record, and quotes the answer to a card without one", () => {
    const line: string = bullet(PAGES[1]!.text(), "**Escalate.**");

    expect(line).toContain("the incident, alert or episode the card is about");
    expect(line).toContain(
      MicrosoftTeamsOnCallDutyActions.ESCALATE_NEEDS_RECORD_MESSAGE,
    );
    expect(line).toContain("nobody is paged");
  });
});

describe("Docs: an archived on-call policy pages no one from a record's Execute On-Call Policy", () => {
  test("the incident feed's Execute On-Call Policy says so", () => {
    const feed: string = read("incidents/notes-owners-and-feed.md");
    const line: string | undefined = feed
      .split("\n")
      .find((item: string): boolean => {
        return item.startsWith("- **Execute On-Call Policy**");
      });

    expect(line).toBeDefined();
    expect(line).toContain("An archived policy pages no one");
  });
});

describe("Docs: the upgrade notes on chat buttons", () => {
  const upgrading: string = read("installation/upgrading.md");

  test("say what changes for the buttons, Teams' state permission and archived policies", () => {
    expect(upgrading).toContain(
      "**Slack and Microsoft Teams buttons act as the OneUptime member who\n  presses them.**",
    );

    const note: string = upgrading.replace(/\n\s*/g, " ");

    expect(note).toContain(
      "Microsoft Teams' **Acknowledge** and **Resolve** used to need permission to edit the incident or alert",
    );
    expect(note).toContain("**Create Incident State Timeline**");
    expect(note).toContain(
      "Executing an archived on-call policy, from a record's **Execute On-Call Policy** or through the API too, pages no one",
    );
  });

  test.each([
    {
      page: "workspace-connections/slack.md",
      heading: SLACK_SECTION,
    },
    {
      page: "workspace-connections/microsoft-teams.md",
      heading: TEAMS_SECTION,
    },
  ])(
    "link to the $heading section, a heading that exists",
    (link: { page: string; heading: string }) => {
      const anchor: string = slugify(link.heading);
      const docsPath: string = `/docs/${link.page.replace(/\.md$/, "")}#${anchor}`;

      expect(upgrading.replace(/\n\s*/g, "")).toContain(`(${docsPath})`);

      const anchors: Array<string> = read(link.page)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        })
        .map((line: string): string => {
          return slugify(line.replace(/^#+\s*/, ""));
        });

      expect(anchors).toContain(anchor);
    },
  );
});
