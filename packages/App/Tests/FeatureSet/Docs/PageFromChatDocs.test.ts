import Alert from "Common/Models/DatabaseModels/Alert";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import {
  ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE,
  OnCallPageRecordType,
} from "Common/Server/Services/OnCallPageService";
import slugify from "Common/Server/Types/MarkdownSlugify";
import MicrosoftTeamsPage from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsPage";
import SlackPageActions from "Common/Server/Utils/Workspace/Slack/Actions/Page";
import SlackCommandParser from "Common/Server/Utils/Workspace/Slack/SlackCommandParser";
import WorkspaceActionAuthorization from "Common/Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandDefinition,
  WorkspaceCommandName,
} from "Common/Server/Utils/Workspace/WorkspaceCommands";
import WorkspacePage, {
  WorkspacePageFormPrefill,
  WorkspacePageTargetKind,
} from "Common/Server/Utils/Workspace/WorkspacePage";
import WorkspacePageAbout, {
  WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
  WorkspacePageSubject,
} from "Common/Server/Utils/Workspace/WorkspacePageAbout";
import { WorkspaceEventType } from "Common/Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePageTextReader, {
  WorkspacePageGroup,
  WorkspacePageText,
} from "Common/Server/Utils/Workspace/WorkspacePageText";
import { isOnCallPersonPage } from "Common/Types/OnCallDutyPolicy/OnCallPersonPage";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PAGING SOMEONE FROM SLACK AND MICROSOFT TEAMS, AS THE ENGLISH DOCS SAY IT.
 *
 * `/oneuptime page @nawaz The checkout API is throwing 500s` in Slack, and
 * "page" typed to the Microsoft Teams bot (customer feedback #4). The pages
 * give an example of each, name the form a page opens, say who may page and
 * what the Slack app needs from Slack for it. Each of those is read here
 * from what the product does: the examples are read by the command's own
 * reader, the form's title is the server's, the roles are the models' own,
 * and the scope and the escaping are the manifest's. A change to any of
 * them fails here until the pages say so too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

const MANIFEST_PATH: string = path.resolve(
  __dirname,
  "../../../../Common/Server/Utils/Workspace/Slack/app-manifest.json",
);

const SLACK_HEADING: string = "Paging someone from Slack";
const TEAMS_HEADING: string = "Paging someone from Microsoft Teams";
const SLACK_GROUPS_HEADING: string = "On-call user groups";
const TEAMS_TAGS_HEADING: string = "On-call tags";

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, page), "utf8");
}

const SLACK_PAGE: string = read("workspace-connections/slack.md");
const TEAMS_PAGE: string = read("workspace-connections/microsoft-teams.md");
const SELF_HOSTED_PAGE: string = read("self-hosted/slack-integration.md");

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

// The one bullet of a section that starts with `lead`.
function bullet(text: string, lead: string): string {
  const line: string | undefined = text.split("\n").find((item: string) => {
    return item.startsWith(`- **${lead}**`);
  });

  expect({ lead, found: Boolean(line) }).toEqual({ lead, found: true });

  return line as string;
}

// The table row of a page whose first cell is `cell`.
function row(markdown: string, cell: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((item: string): boolean => {
      return item.startsWith(`| ${cell} |`);
    });

  expect({ cell, found: Boolean(line) }).toEqual({ cell, found: true });

  return line as string;
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

// Every bold span of a text that is a role's title, in order.
function boldRoleTitles(text: string): Array<string> {
  const roles: Set<string> = new Set(
    ALL_PERMISSIONS.filter((props: PermissionProps): boolean => {
      return props.isRolePermission;
    }).map((props: PermissionProps): string => {
      return props.title;
    }),
  );

  return text
    .split("**")
    .filter((_part: string, index: number): boolean => {
      // The odd parts are inside a pair of "**".
      return index % 2 === 1;
    })
    .filter((title: string): boolean => {
      return roles.has(title);
    });
}

// What a page in an incident's own channel is about: that incident.
const INCIDENT_CHANNEL: WorkspacePageSubject = {
  record: {
    type: OnCallPageRecordType.Incident,
    event: {
      type: WorkspaceEventType.Incident,
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      currentStateId: undefined,
      number: 42,
      numberWithPrefix: "INC-42",
    },
    name: { label: "Incident INC-42", link: null },
    title: "Checkout is down",
  },
};

// A page in the channel of an incident that is resolved: something new.
const RESOLVED_INCIDENT_CHANNEL: WorkspacePageSubject = {
  record: null,
  resolvedRecord: { label: "Incident INC-42", link: null },
};

const SLACK_IN_CHANNEL: string = "In an incident's or an alert's own channel";
const ANYWHERE_ELSE: string = "Anywhere else";

const RUN_ROLES: Array<string> = roleTitles(
  new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
);
const ALERT_ROLES: Array<string> = roleTitles(
  new Alert().getCreatePermissions(),
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the command, in each page's table", () => {
  const page: WorkspaceCommandDefinition = WORKSPACE_COMMANDS.find(
    (definition: WorkspaceCommandDefinition): boolean => {
      return definition.name === WorkspaceCommandName.Page;
    },
  ) as WorkspaceCommandDefinition;

  test("Slack's row is the command as its help writes it, and links to the section that says how it pages", () => {
    const usage: string = `${WorkspaceCommands.getUsage({
      workspaceType: WorkspaceType.Slack,
      command: WorkspaceCommandName.Page,
    })} ${WorkspaceCommands.getArgumentHint(page)}`;

    expect(usage).toBe("/oneuptime page [who] [message]");

    const line: string = row(SLACK_PAGE, `\`${usage}\``);

    expect(line).toContain(`(#${slugify(SLACK_HEADING)})`);
    expect(SLACK_PAGE.split("\n")).toContain(`## ${SLACK_HEADING}`);
  });

  test("Microsoft Teams' row is the same words, typed to the bot, and links to its own section", () => {
    const usage: string = `${page.name} ${WorkspaceCommands.getArgumentHint(page)}`;
    const line: string = row(TEAMS_PAGE, `\`${usage}\``);

    expect(line).toContain(`(#${slugify(TEAMS_HEADING)})`);
    expect(TEAMS_PAGE.split("\n")).toContain(`## ${TEAMS_HEADING}`);
  });
});

describe("the examples, read as the command reads them", () => {
  test("Slack: `/oneuptime page @nawaz The checkout API is throwing 500s` names one person, and the rest is the message", () => {
    const text: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);

    expect(text).toContain(
      "`/oneuptime page @nawaz The checkout API is throwing 500s` pages Nawaz straight away.",
    );

    // As Slack sends it, the person escaped (the manifest's should_escape).
    const read: WorkspacePageText = WorkspacePageTextReader.read(
      SlackCommandParser.getPageTokens(
        "page <@U0123ABCD|nawaz> The checkout API is throwing 500s",
      ),
    );

    expect(read).toEqual({
      people: [{ workspaceUserId: "U0123ABCD", name: "nawaz" }],
      groups: [],
      unknownNames: [],
      message: "The checkout API is throwing 500s",
    });
  });

  test("Slack: `@here`, and a user group that follows no on-call schedule, are nobody to page - the form opens, and says so", () => {
    const text: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);

    expect(bullet(text, "Anything else opens a form.")).toContain(
      "`@here`, a user group that follows no on-call schedule you can see,",
    );

    for (const [sent, group] of [
      [
        "page <!here> The checkout API is down",
        { name: "here", workspaceGroupId: "" },
      ],
      [
        "page <!subteam^S0123|@oncall-db> The replica is behind",
        { name: "oncall-db", workspaceGroupId: "S0123" },
      ],
    ] as Array<[string, WorkspacePageGroup]>) {
      const read: WorkspacePageText = WorkspacePageTextReader.read(
        SlackCommandParser.getPageTokens(sent),
      );

      expect({ sent, people: read.people, groups: read.groups }).toEqual({
        sent,
        people: [],
        groups: [group],
      });

      // Read as no group that follows a schedule: the form says so.
      const prefill: WorkspacePageFormPrefill = WorkspacePage.getPrefill({
        text: read,
        people: { people: [], notTold: [] },
        groups: { paged: [], notPaged: read.groups },
        choices: [],
        workspaceType: WorkspaceType.Slack,
      });

      expect(prefill.notes).toEqual([
        WorkspacePage.getGroupNote({
          group: group,
          workspaceType: WorkspaceType.Slack,
        }),
      ]);
      expect(prefill.notes[0]).toContain(`@${group.name}`);
    }

    // What makes a user group pageable, in the note's own words.
    expect(
      WorkspacePage.getGroupNote({
        group: { name: "oncall-db", workspaceGroupId: "S0123" },
        workspaceType: WorkspaceType.Slack,
      }),
    ).toContain("it isn't connected to an on-call schedule you can see");
  });

  test("Slack: `/oneuptime page @payments-oncall ...` pages whoever is on call in the schedules the user group follows, as the page says", () => {
    const paging: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);
    const groups: string = section(SLACK_PAGE, `## ${SLACK_GROUPS_HEADING}`);

    expect(bullet(paging, "Who is paged at once.")).toContain(
      `and whoever is on call in the schedules a user group you @mention follows (see [${SLACK_GROUPS_HEADING}](#${slugify(SLACK_GROUPS_HEADING)}))`,
    );
    expect(bullet(groups, "Paging it.")).toContain(
      "`/oneuptime page @payments-oncall The checkout API is down` pages whoever is on call in the schedules the group follows.",
    );

    // As Slack sends it: the user group escaped, with its id.
    const read: WorkspacePageText = WorkspacePageTextReader.read(
      SlackCommandParser.getPageTokens(
        "page <!subteam^S0PAYMENTS|@payments-oncall> The checkout API is down",
      ),
    );

    expect(read).toEqual({
      people: [],
      groups: [{ name: "payments-oncall", workspaceGroupId: "S0PAYMENTS" }],
      unknownNames: [],
      message: "The checkout API is down",
    });

    // A group that follows a schedule pages at once, as the schedule.
    const scheduleId: ObjectID = ObjectID.generate();

    expect(
      WorkspacePage.isReadyToPage({
        text: read,
        people: { people: [], notTold: [] },
        groups: {
          paged: [{ name: "payments-oncall", scheduleIds: [scheduleId] }],
          notPaged: [],
        },
      }),
    ).toBe(true);
  });

  test("Microsoft Teams: `@OneUptime page @Payments on-call ...` - a tag Teams mentions is a group, with the id it is mentioned by", () => {
    const paging: string = section(TEAMS_PAGE, `## ${TEAMS_HEADING}`);
    const tags: string = section(TEAMS_PAGE, `## ${TEAMS_TAGS_HEADING}`);

    expect(bullet(paging, "Who is paged at once.")).toContain(
      `and whoever is on call in the schedules a tag you @mention follows (see [${TEAMS_TAGS_HEADING}](#${slugify(TEAMS_TAGS_HEADING)}))`,
    );
    expect(bullet(paging, "Anything else gets a card.")).toContain(
      "a tag that follows no on-call schedule you can see,",
    );
    expect(bullet(tags, "Paging it.")).toContain(
      "`@OneUptime page @Payments on-call The checkout API is down` pages whoever is on call in the schedules the tag follows.",
    );

    const activity: JSONObject = {
      text: "<at>OneUptime</at> page <at>Payments on-call</at> The checkout API is down",
      recipient: { id: "28:oneuptime-bot" },
      entities: [
        {
          type: "mention",
          text: "<at>OneUptime</at>",
          mentioned: { id: "28:oneuptime-bot", name: "OneUptime" },
        },
        {
          type: "mention",
          text: "<at>Payments on-call</at>",
          mentioned: {
            id: "tag-payments",
            name: "Payments on-call",
            type: "tag",
          },
        },
      ],
    };

    expect(
      WorkspacePageTextReader.read(MicrosoftTeamsPage.getPageTokens(activity)),
    ).toEqual({
      people: [],
      groups: [{ name: "Payments on-call", workspaceGroupId: "tag-payments" }],
      unknownNames: [],
      message: "The checkout API is down",
    });
  });

  test("Slack: `/oneuptime page Primary The disk is full` picks the schedule named Primary in the form, and the rest is the message", () => {
    const text: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);

    expect(bullet(text, "Anything else opens a form.")).toContain(
      "A name you type first, as in `/oneuptime page Primary The disk is full`, picks the schedule, team or policy of that name.",
    );

    const scheduleId: ObjectID = ObjectID.generate();
    const prefill: WorkspacePageFormPrefill = WorkspacePage.getPrefill({
      text: WorkspacePageTextReader.read(
        SlackCommandParser.getPageTokens("page Primary The disk is full"),
      ),
      people: { people: [], notTold: [] },
      choices: [
        {
          kind: WorkspacePageTargetKind.Schedule,
          label: "On-call schedules",
          choices: [
            {
              value: WorkspacePage.toValue(
                WorkspacePageTargetKind.Schedule,
                scheduleId,
              ),
              name: "Primary",
              label: "Primary (nobody on call now)",
            },
          ],
        },
      ],
      workspaceType: WorkspaceType.Slack,
    });

    expect(prefill).toEqual({
      values: [`schedule:${scheduleId.toString()}`],
      message: "The disk is full",
      notes: [],
    });
  });

  test("Microsoft Teams: `@OneUptime page @Nawaz Dhandala ...` names one person besides the bot, and the rest is the message", () => {
    const text: string = section(TEAMS_PAGE, `## ${TEAMS_HEADING}`);

    expect(text).toContain(
      "In a channel or a group chat, `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` pages Nawaz straight away.",
    );

    // As Teams sends it: each mention a tag in the text, and an entity.
    const activity: JSONObject = {
      text: "<at>OneUptime</at> page <at>Nawaz Dhandala</at> The checkout API is throwing 500s",
      recipient: { id: "28:oneuptime-bot" },
      entities: [
        {
          type: "mention",
          text: "<at>OneUptime</at>",
          mentioned: { id: "28:oneuptime-bot", name: "OneUptime" },
        },
        {
          type: "mention",
          text: "<at>Nawaz Dhandala</at>",
          mentioned: { id: "29:nawaz", name: "Nawaz Dhandala" },
        },
      ],
    };

    expect(
      WorkspacePageTextReader.read(MicrosoftTeamsPage.getPageTokens(activity)),
    ).toEqual({
      people: [{ workspaceUserId: "29:nawaz", name: "Nawaz Dhandala" }],
      groups: [],
      unknownNames: [],
      message: "The checkout API is throwing 500s",
    });
  });
});

describe("the form a page opens, by the name it is drawn with", () => {
  test("Slack's modal is titled as the page names it, in Slack's 24 characters", () => {
    const text: string = section(SLACK_PAGE, `## ${SLACK_HEADING}`);

    expect(SlackPageActions.FORM_TITLE.length).toBeLessThanOrEqual(24);
    expect(bullet(text, "Anything else opens a form.")).toContain(
      `the **${SlackPageActions.FORM_TITLE}** form opens`,
    );
  });

  test("Microsoft Teams' card is titled the same, and the page names it so", () => {
    const text: string = section(TEAMS_PAGE, `## ${TEAMS_HEADING}`);
    const card: JSONObject = MicrosoftTeamsPage.buildFormCard({
      choices: [
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [
            {
              value: WorkspacePage.toValue(
                WorkspacePageTargetKind.Person,
                ObjectID.generate(),
              ),
              name: "Nawaz Dhandala",
              label: "Nawaz Dhandala",
            },
          ],
        },
      ],
      prefill: { values: [], message: "", notes: [] },
      budgetInBytes: 100000,
    });
    const title: JSONObject = (card["body"] as Array<JSONObject>)[0]!;

    expect(title["text"]).toBe(SlackPageActions.FORM_TITLE);
    expect(bullet(text, "Anything else gets a card.")).toContain(
      `the bot answers with the **${SlackPageActions.FORM_TITLE}** card`,
    );
  });
});

describe("what a page is about, by where it is asked for, as the chats decide it", () => {
  test.each([
    { name: "Slack", markdown: SLACK_PAGE, heading: SLACK_HEADING },
    { name: "Microsoft Teams", markdown: TEAMS_PAGE, heading: TEAMS_HEADING },
  ])(
    "$name: the two places, each a bullet of the section, in the order the rule reads them",
    (page: { markdown: string; heading: string }) => {
      const text: string = section(page.markdown, `## ${page.heading}`);
      const inChannel: string = bullet(text, SLACK_IN_CHANNEL);
      const elsewhere: string = bullet(text, ANYWHERE_ELSE);

      expect(text.indexOf(inChannel)).toBeLessThan(text.indexOf(elsewhere));
      expect(inChannel).toContain(
        "the page is about that incident or alert, and nothing new is created.",
      );
      expect(elsewhere).toContain(
        "the channel of an incident or alert that is resolved, OneUptime creates an alert whose title is your message",
      );
    },
  );

  test("in an incident's own channel nothing new is made and no message is needed: `/oneuptime page @nawaz` pages at once", () => {
    const inChannel: string = bullet(
      section(SLACK_PAGE, `## ${SLACK_HEADING}`),
      SLACK_IN_CHANNEL,
    );

    expect(inChannel).toContain(
      "A message is optional there: `/oneuptime page @nawaz` is enough.",
    );

    const read: WorkspacePageText = WorkspacePageTextReader.read(
      SlackCommandParser.getPageTokens("page <@U0123ABCD|nawaz>"),
    );
    const people: { people: Array<never>; notTold: Array<never> } = {
      people: [
        { userId: ObjectID.generate(), name: "Nawaz" } as never,
      ] as Array<never>,
      notTold: [],
    };

    expect(read.message).toBe("");
    expect(WorkspacePage.isMessageRequired(INCIDENT_CHANNEL)).toBe(false);
    expect(
      WorkspacePage.isReadyToPage({
        text: read,
        people: people,
        groups: { paged: [], notPaged: [] },
        about: INCIDENT_CHANNEL,
      }),
    ).toBe(true);

    // Anywhere else, the message is the new alert's title: the form opens.
    for (const about of [
      WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
      RESOLVED_INCIDENT_CHANNEL,
    ]) {
      expect(WorkspacePage.isMessageRequired(about)).toBe(true);
      expect(
        WorkspacePage.isReadyToPage({
          text: read,
          people: people,
          groups: { paged: [], notPaged: [] },
          about: about,
        }),
      ).toBe(false);
    }
  });

  test("Microsoft Teams: `@OneUptime page @Nawaz Dhandala` names Nawaz, with no message - enough in an incident's own channel", () => {
    expect(
      bullet(section(TEAMS_PAGE, `## ${TEAMS_HEADING}`), SLACK_IN_CHANNEL),
    ).toContain(
      "A message is optional there: `@OneUptime page @Nawaz Dhandala` is enough.",
    );

    const activity: JSONObject = {
      text: "<at>OneUptime</at> page <at>Nawaz Dhandala</at>",
      recipient: { id: "28:oneuptime-bot" },
      entities: [
        {
          type: "mention",
          text: "<at>OneUptime</at>",
          mentioned: { id: "28:oneuptime-bot", name: "OneUptime" },
        },
        {
          type: "mention",
          text: "<at>Nawaz Dhandala</at>",
          mentioned: { id: "29:nawaz", name: "Nawaz Dhandala" },
        },
      ],
    };

    expect(
      WorkspacePageTextReader.read(MicrosoftTeamsPage.getPageTokens(activity)),
    ).toEqual({
      people: [{ workspaceUserId: "29:nawaz", name: "Nawaz Dhandala" }],
      groups: [],
      unknownNames: [],
      message: "",
    });
  });

  test("anywhere else the page says it is about a new alert, in the form and in the answer only you see, before anyone is paged", () => {
    expect(
      bullet(section(SLACK_PAGE, `## ${SLACK_HEADING}`), ANYWHERE_ELSE),
    ).toContain(
      "The form says so, and so does the answer only you see before anyone is paged.",
    );

    expect(
      SlackPageActions.getPagingAnswer(
        ["Nawaz Dhandala"],
        WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
      ).text,
    ).toBe("Paging Nawaz Dhandala about a new alert…");
    expect(WorkspacePage.getMessageHint(WORKSPACE_PAGE_NEW_ALERT_SUBJECT)).toBe(
      "The people you page get this as the title of a new alert.",
    );
    // A resolved incident's channel says why.
    expect(WorkspacePage.getMessageHint(RESOLVED_INCIDENT_CHANNEL)).toBe(
      "Incident INC-42 is resolved, so the people you page get this as the title of a new alert.",
    );

    // In the incident's own channel, the incident instead.
    expect(WorkspacePageAbout.getAboutWords(INCIDENT_CHANNEL)).toBe(
      "about Incident INC-42",
    );
  });

  test("the people paged are paged until one of them answers: a page a person asks for, which somebody else's acknowledgement does not end", () => {
    for (const page of [SLACK_PAGE, TEAMS_PAGE]) {
      const heading: string =
        page === SLACK_PAGE ? SLACK_HEADING : TEAMS_HEADING;

      expect(
        bullet(section(page, `## ${heading}`), SLACK_IN_CHANNEL),
      ).toContain(
        "The people you page are paged until one of them answers, from the page or by acknowledging the incident or alert; somebody else acknowledging it does not stop the page, and resolving it does.",
      );
    }

    // A page asked for from a chat is a person's: no policy, no workflow.
    expect(isOnCallPersonPage({ triggeredByUserId: ObjectID.generate() })).toBe(
      true,
    );
  });
});

describe("who may page, as the models and the page's own check hold it", () => {
  function askedFor(
    about: WorkspacePageSubject | undefined,
  ): Promise<Array<string>> {
    const asked: Array<string> = [];

    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockImplementation(
        async (
          data: Parameters<
            typeof WorkspaceActionAuthorization.assertCanCreate
          >[0],
        ): Promise<void> => {
          asked.push(data.modelType.name);
        },
      );

    return WorkspacePage.assertMayPage(
      {
        userId: ObjectID.generate(),
        tenantId: ObjectID.generate(),
      } as DatabaseCommonInteractionProps,
      about,
    ).then((): Array<string> => {
      return asked;
    });
  }

  test("a page about something new asks to start an on-call run and to create an alert - nothing else, before anything is shown", async () => {
    for (const about of [
      undefined,
      WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
      RESOLVED_INCIDENT_CHANNEL,
    ]) {
      jest.restoreAllMocks();

      expect(await askedFor(about)).toEqual([
        OnCallDutyPolicyExecutionLog.name,
        Alert.name,
      ]);
    }
  });

  test("a page in an incident's own channel creates nothing: it asks to start an on-call run, and nothing else", async () => {
    expect(await askedFor(INCIDENT_CHANNEL)).toEqual([
      OnCallDutyPolicyExecutionLog.name,
    ]);
  });

  test.each([
    { name: "Slack", markdown: SLACK_PAGE, heading: SLACK_HEADING },
    { name: "Microsoft Teams", markdown: TEAMS_PAGE, heading: TEAMS_HEADING },
  ])(
    "$name names exactly the roles that may start a run in a record's own channel, then elsewhere the roles that hold both, and a pair that does together",
    (page: { markdown: string; heading: string }) => {
      const line: string = bullet(
        section(page.markdown, `## ${page.heading}`),
        "Who may page.",
      );
      const elsewhereAt: number = line.indexOf(
        "Anywhere else the page creates an alert, so it also takes permission to create one:",
      );

      expect(elsewhereAt).toBeGreaterThan(0);

      const inChannel: string = line.slice(0, elsewhereAt);
      const elsewhere: string = line.slice(elsewhereAt);

      // In a record's own channel: each role that may start a run.
      expect(inChannel).toContain(
        "In an incident's or an alert's own channel, anyone who may execute an on-call policy (",
      );
      expect(inChannel).toContain("and read that incident or alert.");
      expect(boldRoleTitles(inChannel).sort()).toEqual([...RUN_ROLES].sort());

      for (const title of permissionTitles(
        new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
      )) {
        expect(inChannel).toContain(`**${title}**`);
      }

      const [both, pair] = elsewhere.split(", or ") as [string, string];

      // Each role that may both start a run and create an alert.
      expect(boldRoleTitles(both).sort()).toEqual(
        RUN_ROLES.filter((role: string): boolean => {
          return ALERT_ROLES.includes(role);
        }).sort(),
      );

      // A role that may start a run, with one that may create an alert.
      const [runRole, alertRole] = boldRoleTitles(pair) as [string, string];

      expect(RUN_ROLES).toContain(runRole);
      expect(ALERT_ROLES).not.toContain(runRole);
      expect(ALERT_ROLES).toContain(alertRole);
      expect(RUN_ROLES).not.toContain(alertRole);

      // And the single permissions a custom role holds them by.
      for (const title of [
        ...permissionTitles(
          new OnCallDutyPolicyExecutionLog().getCreatePermissions(),
        ),
        ...permissionTitles(new Alert().getCreatePermissions()),
      ]) {
        expect(elsewhere).toContain(`**${title}**`);
      }

      // A direct page asks more, in the service's own words.
      expect(ON_CALL_DIRECT_PAGE_NOT_ALLOWED_MESSAGE).toContain(
        "takes access to every on-call policy of the project",
      );
      expect(line).toContain(
        "also takes access to every on-call policy of the project",
      );
    },
  );
});

describe("what the Slack app needs from Slack, as its manifest asks for it", () => {
  const manifest: {
    features: {
      slash_commands: Array<{
        command: string;
        usage_hint: string;
        should_escape: boolean;
      }>;
    };
    oauth_config: { scopes: { bot: Array<string> } };
  } = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const command: {
    command: string;
    usage_hint: string;
    should_escape: boolean;
  } = manifest.features.slash_commands[0]!;

  test("people come escaped, and an email address can be read for one whose account is not connected", () => {
    expect(command.should_escape).toBe(true);
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(["users:read", "users:read.email"]),
    );
    expect(command.usage_hint).toContain("page [who] [message]");

    expect(
      bullet(
        section(SLACK_PAGE, `## ${SLACK_HEADING}`),
        "Who is paged at once.",
      ),
    ).toContain("or else by the email address Slack has for them");
  });

  test("the self-hosted guide lists paging among the command's features, and says an older app needs the update and the new scope", () => {
    expect(row(SELF_HOSTED_PAGE, "`/oneuptime`")).toContain("page someone");

    const olderApps: string = section(
      SELF_HOSTED_PAGE,
      "### Apps created from an older manifest",
    );

    expect(olderApps).toContain(
      "An app created before `/oneuptime page` needs the same update",
    );
    expect(olderApps).toContain(
      "so the `users:read.email` scope the manifest adds is granted",
    );
    // The scopes changed: the old promise of no reinstall is gone.
    expect(olderApps).not.toContain("needs no reinstall");
  });
});
