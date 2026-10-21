import WorkspaceUserGroup from "Common/Models/DatabaseModels/WorkspaceUserGroup";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES } from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  CONNECT_FORM_TEXT,
  USER_GROUP_STATUS_LABELS,
  USER_GROUPS_COPY,
  UserGroupStatusKind,
} from "../../../FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/UserGroupsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * CUSTOMER FEEDBACK #3, AS THE ENGLISH DOCS SAY IT: "We have a number of
 * @teamname-oncall user group in Slack that is always updated with the
 * on-call person(s)... How can we achieve this?"
 *
 * The Slack page's On-call user groups section and the Microsoft Teams
 * page's On-call tags section, and what the self-hosted guides say the apps
 * need for them, each read from what the product does: the card and its
 * buttons by the schedule page's own copy, who may connect one by the
 * model's permissions and plan, how often a group is checked by the
 * worker's constant, and the scopes by the Slack manifest. A change to any
 * of them fails here until the pages say so too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const MANIFEST_PATH: string = path.resolve(
  __dirname,
  "../../../../Common/Server/Utils/Workspace/Slack/app-manifest.json",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

const SLACK_PAGE: string = read("workspace-connections/slack.md");
const TEAMS_PAGE: string = read("workspace-connections/microsoft-teams.md");
const SLACK_GUIDE: string = read("self-hosted/slack-integration.md");
const TEAMS_GUIDE: string = read("self-hosted/microsoft-teams-integration.md");

const SLACK_HEADING: string = "On-call user groups";
const TEAMS_HEADING: string = "On-call tags";

// The text under a heading, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.indexOf(" ");
  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    const hashes: number = line.indexOf(" ");

    return line.startsWith("#") && hashes > 0 && hashes <= level;
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// The one bullet of a text that starts with `lead`.
function bullet(text: string, lead: string): string {
  const line: string | undefined = text.split("\n").find((item: string) => {
    return item.startsWith(`- **${lead}**`);
  });

  expect({ lead, found: Boolean(line) }).toEqual({ lead, found: true });

  return line as string;
}

// Every bold span of a text, in order.
function boldSpans(text: string): Array<string> {
  return text.split("**").filter((_part: string, index: number): boolean => {
    return index % 2 === 1;
  });
}

const ALL_PERMISSIONS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

function titleOf(permission: Permission): string {
  return (
    ALL_PERMISSIONS.find((props: PermissionProps): boolean => {
      return props.permission === permission;
    })?.title || ""
  );
}

const PAGES: Array<{
  name: string;
  markdown: string;
  heading: string;
  workspaceType: WorkspaceType;
}> = [
  {
    name: "Slack",
    markdown: SLACK_PAGE,
    heading: SLACK_HEADING,
    workspaceType: WorkspaceType.Slack,
  },
  {
    name: "Microsoft Teams",
    markdown: TEAMS_PAGE,
    heading: TEAMS_HEADING,
    workspaceType: WorkspaceType.MicrosoftTeams,
  },
];

describe("each page's section, against the schedule page's card", () => {
  test.each(PAGES)(
    "$name: a card links to the section, which opens the schedule page's card by its title and button",
    (page: {
      markdown: string;
      heading: string;
      workspaceType: WorkspaceType;
    }) => {
      const anchor: string = `#${slugify(page.heading)}`;
      const text: string = section(page.markdown, `## ${page.heading}`);
      const copy: (typeof USER_GROUPS_COPY)[WorkspaceType] =
        USER_GROUPS_COPY[page.workspaceType];

      // Linked from the page's cards.
      expect(page.markdown).toContain(`- [${page.heading}](${anchor}): `);

      // Found where the card is: a schedule, under On-Call Duty.
      expect(text).toContain(
        "Open the schedule under **On-Call Duty** > **On-Call Schedules**.",
      );
      expect(text).toContain(
        `**${copy.title}** card, click **${copy.connectButton}**`,
      );

      // The card's status pill, by the label it draws.
      expect(bullet(text, "What the card shows.")).toContain(
        `**${USER_GROUP_STATUS_LABELS[UserGroupStatusKind.InStep]}**`,
      );
    },
  );

  test("Slack: a new user group is made from the list's first choice, with a name and a handle", () => {
    const text: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);

    expect(text).toContain(
      `or **${CONNECT_FORM_TEXT.newUserGroup}** with a name and a handle.`,
    );
  });

  test.each(PAGES)(
    "$name: checked as often as the worker looks at a group",
    (page: { markdown: string; heading: string }) => {
      expect(WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES).toBe(15);
      expect(section(page.markdown, `## ${page.heading}`)).toContain(
        `checks it every ${WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES} minutes.`,
      );
    },
  );

  test.each(PAGES)(
    "$name: who may connect one is who may create the record, on the plan it needs",
    (page: { markdown: string; heading: string }) => {
      const line: string = bullet(
        section(page.markdown, `## ${page.heading}`),
        "Who may connect one.",
      );
      const model: WorkspaceUserGroup = new WorkspaceUserGroup();
      const named: Array<string> = boldSpans(line).slice(1);

      // Every role and permission that may create one, and nothing else.
      expect(
        named
          .filter((title: string): boolean => {
            return title !== "Growth";
          })
          .sort(),
      ).toEqual(model.getCreatePermissions().map(titleOf).sort());
      expect(titleOf(Permission.EditProjectOnCallDutyPolicySchedule)).toBe(
        "Edit On-Call Duty Policy Schedule",
      );

      // And the plan.
      expect(model.createBillingPlan).toBe(PlanType.Growth);
      expect(line).toContain(
        "On OneUptime Cloud, connecting one needs the **Growth** plan.",
      );
    },
  );
});

describe("what the apps need, as the manifest and the guides say it", () => {
  const manifest: { oauth_config: { scopes: { bot: Array<string> } } } =
    JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  test("Slack: the manifest asks for the user group scopes, and the guide names them, and what to do with an older app", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(["usergroups:read", "usergroups:write"]),
    );

    const guide: string = section(SLACK_GUIDE, `### ${SLACK_HEADING}`);

    expect(guide).toContain(
      "needs the `usergroups:read` and `usergroups:write` bot scopes. The generated manifest includes them.",
    );
    expect(guide).toContain(
      `(see [${SLACK_HEADING}](/docs/workspace-connections/slack#${slugify(SLACK_HEADING)}))`,
    );
    expect(guide).toContain(
      "Then select **Connect with Slack** again in **Project Settings > Workspace > Slack**, so the new scopes are granted.",
    );
  });

  test("Slack: the page says a connection made before user groups is made again once", () => {
    expect(
      bullet(section(SLACK_PAGE, `## ${SLACK_HEADING}`), "What Slack needs."),
    ).toContain(
      "connect it again once under **Project Settings** > **Workspace** > **Slack**.",
    );
  });

  test("Microsoft Teams: the guide lists the tag permission among the application permissions, and the page says how it is granted", () => {
    // The list under "Add Application Permissions", up to the note after it.
    const applicationPermissions: string = TEAMS_GUIDE.split(
      "**Add Application Permissions**",
    )[1]!.split("`ChannelMessage.Send` is a delegated permission only")[0]!;

    expect(applicationPermissions).toContain(
      "- **TeamworkTag.ReadWrite.All** - Optional. Lets OneUptime keep a team's tag equal to whoever is on call",
    );
    expect(applicationPermissions).toContain(
      `(see [${TEAMS_HEADING}](/docs/workspace-connections/microsoft-teams#${slugify(TEAMS_HEADING)}))`,
    );
    expect(
      bullet(
        section(TEAMS_PAGE, `## ${TEAMS_HEADING}`),
        "What Microsoft 365 needs.",
      ),
    ).toContain(
      "`TeamworkTag.ReadWrite.All` permission, which a Microsoft 365 administrator grants with **Grant Admin Consent**",
    );
  });
});
