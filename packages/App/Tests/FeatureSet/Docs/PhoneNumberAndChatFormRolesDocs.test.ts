import Incident from "Common/Models/DatabaseModels/Incident";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE } from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import IncomingCallPhoneNumberAccess, {
  INCOMING_CALL_PHONE_NUMBER_REFUSALS,
  IncomingCallPhoneNumberAction,
  IncomingCallPhoneNumberNeed,
} from "Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHO MAY USE AN INCOMING CALL POLICY'S PHONE NUMBERS, AND WHAT SLACK'S AND
 * MICROSOFT TEAMS' CREATE FORMS ACT AS.
 *
 * The phone-number routes take the incoming call policy's roles, read from
 * the models (Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess), and
 * the chat create forms are filled in and submitted as the OneUptime member
 * a chat account is connected to. The English docs say both, and the role
 * lists they print are the models' own: a role added to or taken from a
 * model's list fails here until the page says so too. The upgrade notes
 * say what changes, and link to sections that exist.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

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
  const line: string | undefined = text.split("\n").find((item: string) => {
    return item.startsWith(`- ${prefix}`);
  });

  expect(line).toBeDefined();

  return line!;
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

// The roles that hold every one of an action's needs.
function rolesFor(action: IncomingCallPhoneNumberAction): Array<string> {
  const perNeed: Array<Array<string>> = IncomingCallPhoneNumberAccess.getNeeds(
    action,
  ).map((need: IncomingCallPhoneNumberNeed): Array<string> => {
    return roleTitles(IncomingCallPhoneNumberAccess.getPermissions(need));
  });

  expect(perNeed.length).toBeGreaterThan(0);

  return perNeed[0]!.filter((title: string): boolean => {
    return perNeed.every((titles: Array<string>): boolean => {
      return titles.includes(title);
    });
  });
}

// The single permission of a need that names its model, e.g. "Read Incoming Call Policy".
function permissionsFor(action: IncomingCallPhoneNumberAction): Array<string> {
  return IncomingCallPhoneNumberAccess.getNeeds(action).flatMap(
    (need: IncomingCallPhoneNumberNeed): Array<string> => {
      return permissionTitles(
        IncomingCallPhoneNumberAccess.getPermissions(need),
      );
    },
  );
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

describe("Docs: who can add and release an incoming call policy's phone numbers", () => {
  const text: string = section(
    read("on-call/incoming-call-policy.md"),
    "Who Can Add and Release Phone Numbers",
  );

  test("looking numbers up names exactly the roles that may read both the policies and the call and SMS configs", () => {
    const line: string = bullet(text, "**Looking numbers up**");

    expect(boldRoleTitles(line).sort()).toEqual(
      rolesFor(IncomingCallPhoneNumberAction.LookUp).sort(),
    );

    for (const title of permissionsFor(IncomingCallPhoneNumberAction.LookUp)) {
      expect(line).toContain(`**${title}**`);
    }
  });

  test("buying, attaching and releasing names exactly the roles that may edit incoming call policies", () => {
    const line: string = bullet(
      text,
      "**Buying a number, using an existing one, and releasing one**",
    );

    expect(boldRoleTitles(line).sort()).toEqual(
      rolesFor(IncomingCallPhoneNumberAction.Change).sort(),
    );

    for (const title of permissionsFor(IncomingCallPhoneNumberAction.Change)) {
      expect(line).toContain(`**${title}**`);
    }

    // A label-limited editor reaches the policies carrying those labels.
    expect(line).toContain("with a role limited to some labels");
  });

  test("the Settings roles are among them, and Viewer only looks numbers up", () => {
    expect(rolesFor(IncomingCallPhoneNumberAction.LookUp)).toEqual(
      expect.arrayContaining(["Viewer", "Settings Viewer"]),
    );
    expect(rolesFor(IncomingCallPhoneNumberAction.Change)).toEqual(
      expect.arrayContaining(["Settings Admin", "Settings Member"]),
    );
    expect(rolesFor(IncomingCallPhoneNumberAction.Change)).not.toContain(
      "Viewer",
    );
  });

  test("it quotes the API's refusals word for word, and says buying needs no billing permission", () => {
    for (const refusal of Object.values(INCOMING_CALL_PHONE_NUMBER_REFUSALS)) {
      expect(text).toContain(`"${refusal}"`);
    }

    expect(text).toContain("A team's block with no labels");
    expect(text).toContain(
      "**Add Phone Number** and **Release** stay on the page, locked",
    );
    expect(text).toContain("so it needs no billing permission");
  });
});

describe("Docs: Slack's and Microsoft Teams' create forms act as the member", () => {
  const slack: string = section(
    read("workspace-connections/slack.md"),
    "Creating incidents and maintenance from Slack",
  );
  const teams: string = section(
    read("workspace-connections/microsoft-teams.md"),
    "Creating incidents and maintenance from Microsoft Teams",
  );

  const incidentRoles: Array<string> = roleTitles(
    new Incident().getCreatePermissions(),
  );
  const maintenanceRoles: Array<string> = roleTitles(
    new ScheduledMaintenance().getCreatePermissions(),
  );

  test.each([
    {
      name: "Slack",
      text: (): string => {
        return slack;
      },
    },
    {
      name: "Microsoft Teams",
      text: (): string => {
        return teams;
      },
    },
  ])(
    "$name names exactly the roles that may declare an incident or create a scheduled maintenance event",
    (row: { text: () => string }) => {
      const line: string = bullet(row.text(), "**Who may use them.**");

      expect([...new Set(boldRoleTitles(line))].sort()).toEqual(
        [...new Set([...incidentRoles, ...maintenanceRoles])].sort(),
      );
      expect(line).toContain("**Create Incident**");
      expect(line).toContain("**Create Scheduled Maintenance**");
    },
  );

  test.each([
    {
      name: "Slack",
      text: (): string => {
        return slack;
      },
    },
    {
      name: "Microsoft Teams",
      text: (): string => {
        return teams;
      },
    },
  ])(
    "$name says the lists hold what the member may read, and a submit names only what they may name",
    (row: { text: () => string }) => {
      const offers: string = bullet(row.text(), "**What a form offers.**");
      expect(offers).toContain("may read");
      expect(offers).toContain("with a role limited to some labels");
      expect(offers).toContain("Archived on-call policies are never offered.");

      const names: string = bullet(row.text(), "**What a form may name.**");
      expect(names).toContain("is refused like one the project does not have");
      expect(names).toContain("nothing is created");

      expect(row.text()).toContain("**Execute On-Call Policy**");
    },
  );

  test.each([
    {
      name: "Slack",
      text: (): string => {
        return slack;
      },
    },
    {
      name: "Microsoft Teams",
      text: (): string => {
        return teams;
      },
    },
  ])(
    "$name names exactly the roles that may execute an on-call policy",
    (row: { text: () => string }) => {
      const paragraph: string | undefined = row
        .text()
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("**Execute On-Call Policy**");
        });

      expect(paragraph).toBeDefined();
      expect(boldRoleTitles(paragraph!).sort()).toEqual(
        roleTitles(
          new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
        ).sort(),
      );

      for (const title of permissionTitles(
        new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
      )) {
        expect(paragraph).toContain(`**${title}**`);
      }
    },
  );

  test("Slack: /incident and /maintenance need a connected account of a current member", () => {
    expect(slack).toContain("`/incident` and `/maintenance`");
    expect(slack).toContain("If your Slack account is not connected");
    expect(slack).toContain("no longer a member of the project");
  });

  test("Microsoft Teams: the form is filled in as whoever asks for it, and submitted as whoever submits it", () => {
    expect(teams).toContain("`create incident` or `create maintenance`");
    expect(teams).toContain("submitted as whoever does");
    // The bot's own words for a refused reference.
    expect(teams).toContain(
      MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE.split("(")[0]!.trim(),
    );
    expect(teams).toContain("Please pick it again.");
  });
});

describe("Docs: the upgrade notes", () => {
  const upgrading: string = read("installation/upgrading.md");

  const LINKS: Array<{ page: string; anchor: string }> = [
    {
      page: "on-call/incoming-call-policy.md",
      anchor: "who-can-add-and-release-phone-numbers",
    },
    {
      page: "workspace-connections/slack.md",
      anchor: "creating-incidents-and-maintenance-from-slack",
    },
    {
      page: "workspace-connections/microsoft-teams.md",
      anchor: "creating-incidents-and-maintenance-from-microsoft-teams",
    },
  ];

  test("say what changes for the phone-number routes and for the chat forms", () => {
    expect(upgrading).toContain(
      "**An incoming call policy's phone numbers follow the policy's roles.**",
    );
    expect(upgrading).toContain("`POST /api/notification/phone-number/search`");
    expect(upgrading).toContain(
      "**Slack and Microsoft Teams forms act as the OneUptime member who uses\n  them.**",
    );
    expect(upgrading).toContain("The REST API and\n  Terraform do not change.");
  });

  test.each(LINKS)(
    "link to $page#$anchor, a heading that exists",
    (link: { page: string; anchor: string }) => {
      const docsPath: string = `/docs/${link.page.replace(/\.md$/, "")}#${link.anchor}`;

      expect(upgrading.replace(/\n\s*/g, "")).toContain(`(${docsPath})`);

      const anchors: Array<string> = read(link.page)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        })
        .map((line: string): string => {
          return slugify(line.replace(/^#+\s*/, ""));
        });

      expect(anchors).toContain(link.anchor);
    },
  );
});
