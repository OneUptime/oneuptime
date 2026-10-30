import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceUserGroup from "../../../../Models/DatabaseModels/WorkspaceUserGroup";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageRequest,
  OnCallPageResult,
} from "../../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceUserGroupService from "../../../../Server/Services/WorkspaceUserGroupService";
import logger from "../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallPolicyRunMessage from "../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspacePage, {
  WORKSPACE_PAGE_ACTION,
  WORKSPACE_PAGE_FORM_TEXT,
  WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH,
  WORKSPACE_PAGE_MAX_CHOICES_PER_KIND,
  WORKSPACE_PAGE_MAX_TITLE_LENGTH,
  WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageGroups,
  WorkspacePageOutcome,
  WorkspacePagePeople,
  WorkspacePageTargetKind,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import {
  WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
  WorkspacePageSubject,
} from "../../../../Server/Utils/Workspace/WorkspacePageAbout";
import { WorkspaceEventType } from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePageTextReader, {
  WorkspacePageGroup,
  WorkspacePageText,
} from "../../../../Server/Utils/Workspace/WorkspacePageText";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessagePageRecordType,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * PAGING SOMEBODY FROM A CHAT (WorkspacePage), WHAT SLACK AND TEAMS SHARE.
 *
 * Who may page; who a chat's @mention is in OneUptime; what the Page
 * someone form offers, and opens with; how its picks read; and the page
 * itself - the one call to OnCallPageService, the place it was asked from
 * kept for its alert, its run shown there at once - and what the person who
 * paged is told. The services under it are stubbed: OnCallPageService and
 * the run's live message have suites of their own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
const SIMON: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000a2");
const ANA: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000a3");
const OUTSIDER: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000a9");
const ALERT_ID: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000b1");
const RUN_ID: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000c1");
const PRIMARY: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000d1");
const SECONDARY: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-0000000000d2",
);
const PLATFORM: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000e1");
const DB_ESCALATION: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-0000000000f1",
);

const ALERT_URL: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;
const INCIDENT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-0000000000b2",
);
const INCIDENT_URL: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

const PROPS: DatabaseCommonInteractionProps = {
  userId: SIMON,
  tenantId: PROJECT_ID,
};

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
  [ANA.toString()]: "Ana Ruiz",
  [OUTSIDER.toString()]: "Olga Outside",
};

function userOf(id: ObjectID, email?: string): User {
  const user: User = new User();
  user.id = id;
  user.name = (NAMES[id.toString()] || "") as never;
  user.email = new Email(
    email ||
      `${(NAMES[id.toString()] || "x").split(" ")[0]!.toLowerCase()}@example.com`,
  );
  return user;
}

function result(data?: Partial<OnCallPageResult>): OnCallPageResult {
  return {
    record: {
      type: OnCallPageRecordType.Alert,
      id: ALERT_ID,
      label: "Alert AL-12",
      title: "The checkout API is down",
      url: URL.fromString(ALERT_URL),
      isNew: true,
    },
    paged: [
      {
        userId: NAWAZ,
        name: "Nawaz Dhandala",
        email: "nawaz@example.com",
        teamName: null,
        scheduleName: null,
        coveringForName: null,
      },
    ],
    startedPolicies: [],
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: RUN_ID,
    summary: "Paged Nawaz Dhandala about Alert AL-12.",
    ...(data || {}),
  };
}

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspacePage.assertMayPage: who may page", () => {
  test("a member who may start an on-call run and create an alert", async () => {
    const asked: Array<unknown> = [];

    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockImplementation(
        async (data: { modelType: unknown; action: string }) => {
          asked.push([data.modelType, data.action]);
        },
      );

    await expect(WorkspacePage.assertMayPage(PROPS)).resolves.toBeUndefined();

    // Both, as the page will be held to: the run, and the alert it is about.
    expect(asked).toEqual([
      [OnCallDutyPolicyExecutionLog, WORKSPACE_PAGE_ACTION],
      [Alert, WORKSPACE_PAGE_ACTION],
    ]);
    expect(WORKSPACE_PAGE_ACTION).toBe("page people");
  });

  test.each([
    ["start an on-call run", OnCallDutyPolicyExecutionLog],
    ["create an alert", Alert],
  ])(
    "somebody who may not %s is refused, with the check's own sentence",
    async (_what: string, refusedModel: unknown) => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockImplementation(async (data: { modelType: unknown }) => {
          if (data.modelType === refusedModel) {
            throw new NotAuthorizedException(
              "You do not have permission to page people. You need one of these permissions: Project Member.",
            );
          }
        });

      await expect(WorkspacePage.assertMayPage(PROPS)).rejects.toThrow(
        "You do not have permission to page people. You need one of these permissions: Project Member.",
      );
    },
  );
});

describe("WorkspacePage.resolvePeople: who a chat's @mention is in OneUptime", () => {
  let members: Set<string>;
  let users: Array<User>;
  let emailsAsked: Array<unknown>;

  beforeEach(() => {
    members = new Set<string>(
      [SIMON, NAWAZ, ANA].map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );
    users = [
      userOf(SIMON),
      userOf(NAWAZ, "Nawaz@Example.com"),
      userOf(ANA),
      userOf(OUTSIDER),
    ];
    emailsAsked = [];

    jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
      query: { email?: unknown; _id?: unknown };
    }): Promise<Array<User>> => {
      if (data.query.email) {
        emailsAsked.push(data.query.email);
        return users.filter((user: User): boolean => {
          return JSON.stringify(data.query.email)
            .toLowerCase()
            .includes(`"${user.email!.toString().toLowerCase()}"`);
        });
      }

      return users;
    }) as never);
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(async () => {
        return members;
      });
  });

  async function resolve(
    ...candidates: Parameters<
      typeof WorkspacePage.resolvePeople
    >[0]["candidates"]
  ): Promise<WorkspacePagePeople> {
    return await WorkspacePage.resolvePeople({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      candidates: candidates,
    });
  }

  test("the OneUptime account a Slack account is connected to - named as OneUptime names them", async () => {
    expect(
      await resolve({
        person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
        connectedUserId: NAWAZ,
      }),
    ).toEqual({
      people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }],
      notTold: [],
    });
    // A connected account needs no email address.
    expect(emailsAsked).toEqual([]);
  });

  test("an account that is not connected: the member with the email address the chat has for them, in any case", async () => {
    expect(
      await resolve({
        person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
        email: "  NAWAZ@example.COM ",
        chatName: "Nawaz D",
      }),
    ).toEqual({
      people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }],
      notTold: [],
    });
  });

  test("nobody to tell them by: said by name, never guessed", async () => {
    expect(
      await resolve({
        person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
      }),
    ).toEqual({
      people: [],
      notTold: [
        "OneUptime can't tell who @nawaz is: their Slack account isn't connected to OneUptime. Pick them below.",
      ],
    });
  });

  test("an email address no OneUptime account has is nobody to page", async () => {
    expect(
      (
        await resolve({
          person: { workspaceUserId: "U0X", name: "" },
          email: "stranger@example.com",
          chatName: "Stranger Danger",
        })
      ).notTold,
    ).toEqual([
      "OneUptime can't tell who @Stranger Danger is: their Slack account isn't connected to OneUptime. Pick them below.",
    ]);
  });

  test("a mention with no name at all is said as such", async () => {
    expect(
      (await resolve({ person: { workspaceUserId: "U0X", name: "" } })).notTold,
    ).toEqual([
      "OneUptime can't tell who a person you mentioned is: their Slack account isn't connected to OneUptime. Pick them below.",
    ]);
  });

  test("somebody who is not a member of the project is not paged on its behalf", async () => {
    expect(
      await resolve({
        person: { workspaceUserId: "U0OLGA", name: "olga" },
        connectedUserId: OUTSIDER,
      }),
    ).toEqual({
      people: [],
      notTold: [
        "@olga isn't a member of this project, so OneUptime can't page them.",
      ],
    });
  });

  test("Microsoft Teams is named as such", async () => {
    expect(
      (
        await WorkspacePage.resolvePeople({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.MicrosoftTeams,
          candidates: [{ person: { workspaceUserId: "29:1", name: "Nawaz" } }],
        })
      ).notTold,
    ).toEqual([
      "OneUptime can't tell who @Nawaz is: their Microsoft Teams account isn't connected to OneUptime. Pick them below.",
    ]);
  });

  test("one person twice - by two of their mentions - is paged once", async () => {
    expect(
      (
        await resolve(
          {
            person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
            connectedUserId: NAWAZ,
          },
          {
            person: { workspaceUserId: "U0NAWAZ2", name: "nawaz2" },
            email: "nawaz@example.com",
          },
        )
      ).people,
    ).toEqual([{ userId: NAWAZ, name: "Nawaz Dhandala" }]);
  });

  test("the product's name is the one the installation goes by", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(
      (await resolve({ person: { workspaceUserId: "U0X", name: "x" } }))
        .notTold,
    ).toEqual([
      "Acme Ops can't tell who @x is: their Slack account isn't connected to Acme Ops. Pick them below.",
    ]);
  });

  test("nobody mentioned: nothing is read", async () => {
    const memberships: SpyInstance<typeof ProjectMembership.getMemberUserIds> =
      jest.spyOn(ProjectMembership, "getMemberUserIds");

    expect(await resolve()).toEqual({ people: [], notTold: [] });
    expect(memberships).not.toHaveBeenCalled();
    expect(UserService.findBy).not.toHaveBeenCalled();
  });
});

describe("WorkspacePage.getChoices: what the Page someone form offers", () => {
  let schedules: Array<OnCallDutyPolicySchedule>;
  let teamMembers: Array<TeamMember>;
  let teams: Array<Team>;
  let policies: Array<OnCallDutyPolicy>;
  let readsAs: Array<DatabaseCommonInteractionProps>;
  let policyQuery: unknown;

  function schedule(
    id: ObjectID,
    name: string,
    onCall?: User | undefined,
  ): OnCallDutyPolicySchedule {
    const row: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    row.id = id;
    row.name = name;

    if (onCall) {
      row.currentUserOnRoster = onCall;
    }

    return row;
  }

  function member(user: User): TeamMember {
    const row: TeamMember = new TeamMember();
    row.userId = user.id!;
    row.user = user;
    return row;
  }

  beforeEach(() => {
    schedules = [
      schedule(PRIMARY, "Primary", userOf(NAWAZ)),
      schedule(SECONDARY, "Secondary"),
    ];
    teamMembers = [
      member(userOf(SIMON)),
      member(userOf(NAWAZ)),
      member(userOf(ANA)),
      member(userOf(NAWAZ)),
    ];
    const team: Team = new Team();
    team.id = PLATFORM;
    team.name = "Platform";
    teams = [team];
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = DB_ESCALATION;
    policy.name = "DB Escalation";
    policies = [policy];
    readsAs = [];
    policyQuery = undefined;

    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: {
        service: unknown;
        props: DatabaseCommonInteractionProps;
        query: unknown;
      }): Promise<Array<unknown>> => {
        readsAs.push(data.props);

        switch (data.service) {
          case OnCallDutyPolicyScheduleService:
            return schedules;
          case TeamMemberService:
            return teamMembers;
          case TeamService:
            return teams;
          case OnCallDutyPolicyService:
            policyQuery = data.query;
            return policies;
          default:
            return [];
        }
      }) as never);
  });

  async function choices(): Promise<Array<WorkspacePageChoiceGroup>> {
    return await WorkspacePage.getChoices({
      projectId: PROJECT_ID,
      props: PROPS,
    });
  }

  test("on-call schedules with who is on call now, then people, teams and on-call policies - each under its heading", async () => {
    expect(await choices()).toEqual([
      {
        kind: WorkspacePageTargetKind.Schedule,
        label: "On-call schedules",
        choices: [
          {
            value: `schedule:${PRIMARY.toString()}`,
            name: "Primary",
            label: "Primary (Nawaz Dhandala on call now)",
          },
          {
            value: `schedule:${SECONDARY.toString()}`,
            name: "Secondary",
            label: "Secondary (nobody on call now)",
          },
        ],
      },
      {
        kind: WorkspacePageTargetKind.Person,
        label: "People",
        choices: [
          {
            value: `user:${ANA.toString()}`,
            name: "Ana Ruiz",
            label: "Ana Ruiz",
          },
          {
            value: `user:${NAWAZ.toString()}`,
            name: "Nawaz Dhandala",
            label: "Nawaz Dhandala",
          },
          {
            value: `user:${SIMON.toString()}`,
            name: "Simon Lee",
            label: "Simon Lee (you)",
          },
        ],
      },
      {
        kind: WorkspacePageTargetKind.Team,
        label: "Teams",
        choices: [
          {
            value: `team:${PLATFORM.toString()}`,
            name: "Platform",
            label: "Platform",
          },
        ],
      },
      {
        kind: WorkspacePageTargetKind.Policy,
        label: "On-call policies",
        choices: [
          {
            value: `policy:${DB_ESCALATION.toString()}`,
            name: "DB Escalation",
            label: "DB Escalation",
          },
        ],
      },
    ]);
  });

  test("everything is read as the member: the form offers what they may pick in OneUptime", async () => {
    await choices();

    expect(readsAs).toHaveLength(4);
    for (const props of readsAs) {
      expect(props).toBe(PROPS);
    }
  });

  test("archived policies page no one, so they are never offered", async () => {
    await choices();

    expect(policyQuery).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
  });

  test("a project with more people than a list holds: the first hundred, and how many more there are", async () => {
    teamMembers = Array.from({ length: 152 }, (_: unknown, index: number) => {
      const user: User = new User();
      user.id = ObjectID.generate();
      user.name = `Person ${String(index).padStart(3, "0")}` as never;
      user.email = new Email(`person${index}@example.com`);
      return member(user);
    });

    const people: WorkspacePageChoiceGroup = (await choices()).find(
      (group: WorkspacePageChoiceGroup): boolean => {
        return group.kind === WorkspacePageTargetKind.Person;
      },
    )!;

    expect(people.choices).toHaveLength(WORKSPACE_PAGE_MAX_CHOICES_PER_KIND);
    expect(people.choices[0]!.name).toBe("Person 000");
    expect(people.notShownCount).toBe(52);
    // The form says so, and how to page the others.
    expect(WorkspacePage.getNotShownNote(await choices())).toBe(
      "52 more people aren't listed. @mention anyone to page them at once.",
    );
  });

  test("a list that holds everybody says nothing of who is not in it", async () => {
    const groups: Array<WorkspacePageChoiceGroup> = await choices();

    for (const group of groups) {
      expect(group.notShownCount).toBeUndefined();
    }
    expect(WorkspacePage.getNotShownNote(groups)).toBe("");
  });

  test("one more person: said as one", () => {
    expect(
      WorkspacePage.getNotShownNote([
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [],
          notShownCount: 1,
        },
      ]),
    ).toBe("1 more person isn't listed. @mention anyone to page them at once.");
  });

  test("a kind the member may read none of is left out", async () => {
    schedules = [];
    teams = [];
    policies = [];

    expect(
      (await choices()).map((group: WorkspacePageChoiceGroup) => {
        return group.kind;
      }),
    ).toEqual([WorkspacePageTargetKind.Person]);
  });

  test("a label is cut to what Slack shows of an option - a long schedule name before who is on call", async () => {
    schedules = [schedule(PRIMARY, "P".repeat(120), userOf(NAWAZ))];
    const team: Team = new Team();
    team.id = PLATFORM;
    team.name = "T".repeat(120);
    teams = [team];

    const groups: Array<WorkspacePageChoiceGroup> = await choices();
    const scheduleLabel: string = groups[0]!.choices[0]!.label;
    const teamLabel: string = groups[2]!.choices[0]!.label;

    expect(scheduleLabel.length).toBe(WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH);
    expect(scheduleLabel.endsWith("… (Nawaz Dhandala on call now)")).toBe(true);
    expect(teamLabel.length).toBe(WORKSPACE_PAGE_MAX_CHOICE_LABEL_LENGTH);
    expect(teamLabel.endsWith("…")).toBe(true);
    // The name a message is matched with is the whole name.
    expect(groups[0]!.choices[0]!.name).toBe("P".repeat(120));
  });

  test("a person with no name is listed by email address", async () => {
    const nameless: User = userOf(ANA, "ana@example.com");
    nameless.name = undefined as never;
    teamMembers = [member(nameless)];

    expect((await choices())[1]!.choices[0]!.label).toBe("ana@example.com");
  });
});

describe("WorkspacePage.getPrefill: the form opens with what was typed", () => {
  const CHOICES: Array<WorkspacePageChoiceGroup> = [
    {
      kind: WorkspacePageTargetKind.Schedule,
      label: "On-call schedules",
      choices: [
        {
          value: `schedule:${PRIMARY.toString()}`,
          name: "Primary",
          label: "Primary (Nawaz Dhandala on call now)",
        },
        {
          value: `schedule:${SECONDARY.toString()}`,
          name: "Primary Database",
          label: "Primary Database (nobody on call now)",
        },
      ],
    },
    {
      kind: WorkspacePageTargetKind.Person,
      label: "People",
      choices: [
        {
          value: `user:${NAWAZ.toString()}`,
          name: "Nawaz Dhandala",
          label: "Nawaz Dhandala",
        },
      ],
    },
    {
      kind: WorkspacePageTargetKind.Team,
      label: "Teams",
      choices: [
        {
          value: `team:${PLATFORM.toString()}`,
          name: "Platform",
          label: "Platform",
        },
      ],
    },
  ];

  function prefill(
    text: WorkspacePageText,
    people?: WorkspacePagePeople | undefined,
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): WorkspacePageFormPrefill {
    return WorkspacePage.getPrefill({
      text: text,
      people: people || { people: [], notTold: [] },
      choices: CHOICES,
      workspaceType: workspaceType,
    });
  }

  test("nothing typed: an empty form", () => {
    expect(prefill(WorkspacePageTextReader.readText(""))).toEqual({
      values: [],
      message: "",
      notes: [],
    });
  });

  test("a message alone: the message, and who to page left to pick", () => {
    expect(prefill(WorkspacePageTextReader.readText("the DB is down"))).toEqual(
      {
        values: [],
        message: "the DB is down",
        notes: [],
      },
    );
  });

  test("people @mentioned with no message: picked, the message left to write", () => {
    expect(
      prefill(
        WorkspacePageTextReader.read([
          {
            kind: "person",
            person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
          },
        ]),
        { people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }], notTold: [] },
      ),
    ).toEqual({
      values: [`user:${NAWAZ.toString()}`],
      message: "",
      notes: [],
    });
  });

  test("a schedule's name typed first: picked, and the rest is the message - the longest name wins", () => {
    expect(
      prefill(
        WorkspacePageTextReader.readText("primary database: replica lag"),
      ),
    ).toEqual({
      values: [`schedule:${SECONDARY.toString()}`],
      message: "replica lag",
      notes: [],
    });
    expect(
      prefill(WorkspacePageTextReader.readText("Platform the deploy is stuck")),
    ).toEqual({
      values: [`team:${PLATFORM.toString()}`],
      message: "the deploy is stuck",
      notes: [],
    });
  });

  test("a person's name typed first is no pick: a person is @mentioned", () => {
    expect(
      prefill(
        WorkspacePageTextReader.readText("Nawaz Dhandala the DB is down"),
      ),
    ).toEqual({
      values: [],
      message: "Nawaz Dhandala the DB is down",
      notes: [],
    });
  });

  test("after an @mention, a name is the message's own: nothing more is picked", () => {
    expect(
      prefill(
        WorkspacePageTextReader.read([
          {
            kind: "person",
            person: { workspaceUserId: "U0NAWAZ", name: "nawaz" },
          },
          { kind: "text", text: " Platform is down" },
        ]),
        { people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }], notTold: [] },
      ),
    ).toEqual({
      values: [`user:${NAWAZ.toString()}`],
      message: "Platform is down",
      notes: [],
    });
  });

  test("a note for everybody named that the form cannot pick: not told, a group, a name sent as text", () => {
    expect(
      prefill(
        WorkspacePageTextReader.read([
          {
            kind: "person",
            person: { workspaceUserId: "U0X", name: "x" },
          },
          { kind: "text", text: " " },
          { kind: "group", name: "oncall-db" },
          { kind: "text", text: " @ana db down" },
        ]),
        {
          people: [],
          notTold: [
            "OneUptime can't tell who @x is: their Slack account isn't connected to OneUptime.",
          ],
        },
      ),
    ).toEqual({
      values: [],
      message: "db down",
      notes: [
        "OneUptime can't tell who @x is: their Slack account isn't connected to OneUptime.",
        "OneUptime can't page @oncall-db. Pick the on-call schedule, the team or the people below.",
        "OneUptime can't tell who @ana is. Pick them below.",
      ],
    });
  });

  test("a member past the form's list is said by name: a form cannot pick what it does not offer", () => {
    expect(
      prefill(
        WorkspacePageTextReader.read([
          {
            kind: "person",
            person: { workspaceUserId: "U0ANA", name: "ana" },
          },
        ]),
        { people: [{ userId: ANA, name: "Ana Ruiz" }], notTold: [] },
      ).notes,
    ).toEqual([
      "Ana Ruiz isn't in the list below. To page them, run /oneuptime page again with them @mentioned and a message.",
    ]);
  });

  test("in Microsoft Teams, the same note says to type page to the bot", () => {
    expect(
      prefill(
        WorkspacePageTextReader.read([
          {
            kind: "person",
            person: { workspaceUserId: "29:1ana", name: "Ana Ruiz" },
          },
        ]),
        { people: [{ userId: ANA, name: "Ana Ruiz" }], notTold: [] },
        WorkspaceType.MicrosoftTeams,
      ).notes,
    ).toEqual([
      "Ana Ruiz isn't in the list below. To page them, type page again with them @mentioned and a message.",
    ]);
  });
});

/*
 * CUSTOMER FEEDBACK #3 MEETS #4: "/oneuptime page @payments-oncall ..." - a
 * Slack user group (a Microsoft Teams tag) OneUptime keeps equal to whoever
 * is on call pages the on-call schedules it follows.
 */
describe("WorkspacePage.resolveGroups: a group that follows on-call schedules is paged as them", () => {
  const PAYMENTS: WorkspacePageGroup = {
    name: "payments-oncall",
    workspaceGroupId: "S0PAYMENTS",
  };
  const DATABASE: WorkspacePageGroup = {
    name: "db-oncall",
    workspaceGroupId: "S0DATABASE",
  };
  const HERE: WorkspacePageGroup = { name: "here", workspaceGroupId: "" };

  let rows: Array<WorkspaceUserGroup>;
  let readableScheduleIds: Array<ObjectID>;
  let asked: Array<{ service: unknown; props: unknown; query: unknown }>;

  function rowOf(data: {
    workspaceGroupId: string;
    name: string;
    scheduleIds: Array<ObjectID>;
  }): WorkspaceUserGroup {
    const row: WorkspaceUserGroup = new WorkspaceUserGroup();
    row.id = ObjectID.generate();
    row.workspaceGroupId = data.workspaceGroupId;
    row.name = data.name;
    row.onCallDutyPolicySchedules = data.scheduleIds.map(
      (id: ObjectID): OnCallDutyPolicySchedule => {
        const schedule: OnCallDutyPolicySchedule =
          new OnCallDutyPolicySchedule();
        schedule.id = id;
        return schedule;
      },
    );
    return row;
  }

  beforeEach(() => {
    rows = [
      rowOf({
        workspaceGroupId: "S0PAYMENTS",
        name: "Payments on-call",
        scheduleIds: [PRIMARY, SECONDARY],
      }),
    ];
    readableScheduleIds = [PRIMARY, SECONDARY];
    asked = [];

    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: {
        service: unknown;
        props: unknown;
        query: { _id?: unknown };
      }) => {
        asked.push({
          service: data.service,
          props: data.props,
          query: data.query,
        });

        if (data.service === WorkspaceUserGroupService) {
          return rows;
        }

        if (data.service === OnCallDutyPolicyScheduleService) {
          return readableScheduleIds
            .filter((id: ObjectID): boolean => {
              return JSON.stringify(data.query._id).includes(id.toString());
            })
            .map((id: ObjectID): OnCallDutyPolicySchedule => {
              const schedule: OnCallDutyPolicySchedule =
                new OnCallDutyPolicySchedule();
              schedule.id = id;
              return schedule;
            });
        }

        return [];
      }) as never);
  });

  async function resolve(
    groups: Array<WorkspacePageGroup>,
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): Promise<WorkspacePageGroups> {
    return await WorkspacePage.resolveGroups({
      projectId: PROJECT_ID,
      workspaceType: workspaceType,
      groups: groups,
      props: PROPS,
    });
  }

  test("@payments-oncall, which follows Primary and Secondary: paged as both", async () => {
    expect(await resolve([PAYMENTS])).toEqual({
      paged: [{ name: "payments-oncall", scheduleIds: [PRIMARY, SECONDARY] }],
      notPaged: [],
    });
  });

  test("read as the member who asked: the project's groups of this chat, then the schedules they follow", async () => {
    await resolve([PAYMENTS]);

    expect(asked).toEqual([
      {
        service: WorkspaceUserGroupService,
        props: PROPS,
        query: { projectId: PROJECT_ID, workspaceType: WorkspaceType.Slack },
      },
      {
        service: OnCallDutyPolicyScheduleService,
        props: PROPS,
        query: expect.objectContaining({ projectId: PROJECT_ID }),
      },
    ]);
  });

  test("a schedule the member may not read is not paged through a group - and a group with none they may read pages nobody", async () => {
    rows.push(
      rowOf({
        workspaceGroupId: "S0DATABASE",
        name: "Database on-call",
        scheduleIds: [SECONDARY],
      }),
    );
    readableScheduleIds = [PRIMARY];

    expect(await resolve([PAYMENTS, DATABASE])).toEqual({
      paged: [{ name: "payments-oncall", scheduleIds: [PRIMARY] }],
      notPaged: [DATABASE],
    });
  });

  test("a group OneUptime does not keep, and @here: not paged, kept to be said", async () => {
    expect(await resolve([DATABASE, HERE])).toEqual({
      paged: [],
      notPaged: [DATABASE, HERE],
    });
  });

  test("@here alone: nothing is read", async () => {
    expect(await resolve([HERE])).toEqual({ paged: [], notPaged: [HERE] });
    expect(asked).toEqual([]);
  });

  test("the groups the member may not read at all: nobody paged through them", async () => {
    rows = [];

    expect(await resolve([PAYMENTS])).toEqual({
      paged: [],
      notPaged: [PAYMENTS],
    });
  });

  test("a group that follows no schedule any more pages nobody", async () => {
    rows[0]!.onCallDutyPolicySchedules = [];

    expect(await resolve([PAYMENTS])).toEqual({
      paged: [],
      notPaged: [PAYMENTS],
    });
  });

  test("Slack: a group is the user group of its id - another of the same name is not it", async () => {
    expect(
      await resolve([
        { name: "Payments on-call", workspaceGroupId: "S0SOMEOTHER" },
      ]),
    ).toEqual({
      paged: [],
      notPaged: [{ name: "Payments on-call", workspaceGroupId: "S0SOMEOTHER" }],
    });
  });

  test("one group mentioned twice - under two names - is paged once", async () => {
    rows[0]!.workspaceType = WorkspaceType.MicrosoftTeams;

    expect(
      await resolve(
        [
          { name: "Payments on-call", workspaceGroupId: "S0PAYMENTS" },
          { name: "payments on-call", workspaceGroupId: "tag-by-another-id" },
        ],
        WorkspaceType.MicrosoftTeams,
      ),
    ).toEqual({
      paged: [{ name: "Payments on-call", scheduleIds: [PRIMARY, SECONDARY] }],
      notPaged: [],
    });
  });

  test("Microsoft Teams: a tag by the id Teams mentioned it with, or else by its name - in any case - when one tag of that name follows schedules", async () => {
    rows = [
      rowOf({
        workspaceGroupId: "tag-payments",
        name: "Payments on-call",
        scheduleIds: [PRIMARY],
      }),
    ];

    expect(
      await resolve(
        [{ name: "payments ON-CALL", workspaceGroupId: "19:mention-id" }],
        WorkspaceType.MicrosoftTeams,
      ),
    ).toEqual({
      paged: [{ name: "payments ON-CALL", scheduleIds: [PRIMARY] }],
      notPaged: [],
    });
    expect(asked[0]!.query).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("Microsoft Teams: two tags of that name in two teams - neither is guessed at", async () => {
    rows = [
      rowOf({
        workspaceGroupId: "tag-payments-1",
        name: "On-call",
        scheduleIds: [PRIMARY],
      }),
      rowOf({
        workspaceGroupId: "tag-payments-2",
        name: "On-call",
        scheduleIds: [SECONDARY],
      }),
    ];

    const onCall: WorkspacePageGroup = {
      name: "On-call",
      workspaceGroupId: "19:mention-id",
    };

    expect(await resolve([onCall], WorkspaceType.MicrosoftTeams)).toEqual({
      paged: [],
      notPaged: [onCall],
    });
  });
});

describe("WorkspacePage.isReadyToPage, getTargets and getPagedNames: a group pages at once, like a person", () => {
  const NOBODY: WorkspacePagePeople = { people: [], notTold: [] };
  const NAWAZ_PERSON: WorkspacePagePeople = {
    people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }],
    notTold: [],
  };
  const PAYMENTS_PAGED: WorkspacePageGroups = {
    paged: [{ name: "payments-oncall", scheduleIds: [PRIMARY, SECONDARY] }],
    notPaged: [],
  };
  const NO_GROUPS: WorkspacePageGroups = { paged: [], notPaged: [] };

  function textOf(message: string): WorkspacePageText {
    return {
      people: [],
      groups: [],
      unknownNames: [],
      message: message,
    };
  }

  test("a group that follows schedules, and a message: paged at once", () => {
    expect(
      WorkspacePage.isReadyToPage({
        text: textOf("db down"),
        people: NOBODY,
        groups: PAYMENTS_PAGED,
      }),
    ).toBe(true);
  });

  test("no message, nobody to page, or anybody named it cannot page: the form opens", () => {
    for (const [text, people, groups] of [
      [textOf(""), NOBODY, PAYMENTS_PAGED],
      [textOf("db down"), NOBODY, NO_GROUPS],
      [
        textOf("db down"),
        NOBODY,
        {
          paged: PAYMENTS_PAGED.paged,
          notPaged: [{ name: "here", workspaceGroupId: "" }],
        },
      ],
      [
        textOf("db down"),
        { people: [], notTold: ["OneUptime can't tell who @x is."] },
        PAYMENTS_PAGED,
      ],
      [
        { ...textOf("db down"), unknownNames: ["@ana"] },
        NOBODY,
        PAYMENTS_PAGED,
      ],
    ] as Array<[WorkspacePageText, WorkspacePagePeople, WorkspacePageGroups]>) {
      expect(
        WorkspacePage.isReadyToPage({
          text: text,
          people: people,
          groups: groups,
        }),
      ).toBe(false);
    }
  });

  test("people alone page as they always did: no schedules named", () => {
    expect(
      WorkspacePage.isReadyToPage({
        text: textOf("db down"),
        people: NAWAZ_PERSON,
        groups: NO_GROUPS,
      }),
    ).toBe(true);
    expect(
      WorkspacePage.getTargets({ people: NAWAZ_PERSON, groups: NO_GROUPS }),
    ).toEqual({ userIds: [NAWAZ] });
  });

  test("the people, and each schedule the groups follow once", () => {
    expect(
      WorkspacePage.getTargets({
        people: NAWAZ_PERSON,
        groups: {
          paged: [
            ...PAYMENTS_PAGED.paged,
            { name: "primary-oncall", scheduleIds: [PRIMARY] },
          ],
          notPaged: [],
        },
      }),
    ).toEqual({
      userIds: [NAWAZ],
      onCallScheduleIds: [PRIMARY, SECONDARY],
    });
  });

  test("who the person who paged is told is paged: the people by name, a group as they @mentioned it", () => {
    expect(
      WorkspacePage.getPagedNames({
        people: NAWAZ_PERSON,
        groups: PAYMENTS_PAGED,
      }),
    ).toEqual(["Nawaz Dhandala", "@payments-oncall"]);
  });
});

describe("WorkspacePage.getPrefill: groups @mentioned", () => {
  const CHOICES: Array<WorkspacePageChoiceGroup> = [
    {
      kind: WorkspacePageTargetKind.Schedule,
      label: "On-call schedules",
      choices: [
        {
          value: `schedule:${PRIMARY.toString()}`,
          name: "Primary",
          label: "Primary (Nawaz Dhandala on call now)",
        },
      ],
    },
  ];

  function prefillOf(
    groups: WorkspacePageGroups,
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): WorkspacePageFormPrefill {
    return WorkspacePage.getPrefill({
      text: {
        people: [],
        groups: [...groups.notPaged],
        unknownNames: [],
        message: "",
      },
      people: { people: [], notTold: [] },
      groups: groups,
      choices: CHOICES,
      workspaceType: workspaceType,
    });
  }

  test("a group that follows schedules, with no message: its schedules picked, nothing to say", () => {
    expect(
      prefillOf({
        paged: [{ name: "payments-oncall", scheduleIds: [PRIMARY] }],
        notPaged: [],
      }),
    ).toEqual({
      values: [`schedule:${PRIMARY.toString()}`],
      message: "",
      notes: [],
    });
  });

  test("its schedules past the form's list: said, with how to page it anyway", () => {
    expect(
      prefillOf({
        paged: [{ name: "payments-oncall", scheduleIds: [SECONDARY] }],
        notPaged: [],
      }).notes,
    ).toEqual([
      "The on-call schedules @payments-oncall follows aren't in the list below. To page them, run /oneuptime page again with @payments-oncall and a message.",
    ]);
  });

  test("a user group that follows no schedule the member can see: not paged, why - in the card's own verb - and to pick who it means", () => {
    expect(
      prefillOf({
        paged: [],
        notPaged: [{ name: "oncall-db", workspaceGroupId: "S0DB" }],
      }).notes,
    ).toEqual([
      "OneUptime can't page @oncall-db: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.",
    ]);
  });

  test("in Microsoft Teams, a tag: the same words", () => {
    expect(
      prefillOf(
        {
          paged: [],
          notPaged: [{ name: "On-call DBAs", workspaceGroupId: "tag-1" }],
        },
        WorkspaceType.MicrosoftTeams,
      ).notes,
    ).toEqual([
      "OneUptime can't page @On-call DBAs: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.",
    ]);
  });

  test("@here is no group anybody keeps: OneUptime can't page it", () => {
    expect(
      WorkspacePage.getGroupNote({
        group: { name: "here", workspaceGroupId: "" },
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(
      "OneUptime can't page @here. Pick the on-call schedule, the team or the people below.",
    );
  });

  test("the product's name is the one the installation goes by", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Pager");

    expect(
      WorkspacePage.getGroupNote({
        group: { name: "oncall-db", workspaceGroupId: "S0DB" },
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(
      "Acme Pager can't page @oncall-db: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.",
    );
  });
});

describe("WorkspacePage.readTargets and getFormProblems: the form's picks", () => {
  test("each pick as what it names", () => {
    expect(
      WorkspacePage.readTargets([
        `user:${NAWAZ.toString()}`,
        `team:${PLATFORM.toString()}`,
        `schedule:${PRIMARY.toString()}`,
        `policy:${DB_ESCALATION.toString()}`,
      ]),
    ).toEqual({
      userIds: [NAWAZ],
      teamIds: [PLATFORM],
      onCallScheduleIds: [PRIMARY],
      onCallDutyPolicyIds: [DB_ESCALATION],
    });
  });

  test("a value no form of OneUptime writes is left out", () => {
    expect(
      WorkspacePage.readTargets([
        "user:not-an-id",
        `monitor:${NAWAZ.toString()}`,
        NAWAZ.toString(),
        "",
        `user:${NAWAZ.toString()}`,
      ]),
    ).toEqual({
      userIds: [NAWAZ],
      teamIds: [],
      onCallScheduleIds: [],
      onCallDutyPolicyIds: [],
    });
  });

  test("nobody picked, and no message: both said, where each field is", () => {
    expect(
      WorkspacePage.getFormProblems({ values: [], message: "  \n " }),
    ).toEqual({
      who: "Pick who to page.",
      // Short: the hint under the field says what the message is for.
      message: "Write what the page is about.",
    });
    expect(WORKSPACE_PAGE_FORM_TEXT.messageHint).toBe(
      "The people you page get this as the title of a new alert.",
    );
  });

  test("more than a page may name", () => {
    expect(
      WorkspacePage.getFormProblems({
        values: Array.from({ length: 101 }, (): string => {
          return `user:${ObjectID.generate().toString()}`;
        }),
        message: "db down",
      }),
    ).toEqual({ who: "Pick 100 at most." });
  });

  test("somebody picked, and a message: nothing to say", () => {
    expect(
      WorkspacePage.getFormProblems({
        values: [`user:${NAWAZ.toString()}`],
        message: "db down",
      }),
    ).toBeNull();
  });
});

describe("WorkspacePage.getTitle: the alert's title, from the message", () => {
  test("on one line", () => {
    expect(WorkspacePage.getTitle("  the DB\n\nis   down \n")).toBe(
      "the DB is down",
    );
  });

  test("cut to what an alert's title holds", () => {
    const title: string = WorkspacePage.getTitle("x".repeat(900));

    expect(title).toHaveLength(WORKSPACE_PAGE_MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });

  test("a message as long as a chat sends, and longer, of white space and words: read in time that grows with it", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (const message of [
          " \t\n".repeat(400_000 / 3),
          "a \u{a0}".repeat(400_000 / 3),
          `${" ".repeat(400_000)}x${"\n".repeat(400_000)}`,
        ]) {
          expect(WorkspacePage.getTitle(message).length).toBeLessThanOrEqual(
            WORKSPACE_PAGE_MAX_TITLE_LENGTH,
          );
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("WorkspacePage.page: the page itself", () => {
  let pageRequests: Array<OnCallPageRequest>;
  let liveRows: Array<WorkspaceLiveMessage>;
  let synced: Array<string>;
  let pageResult: OnCallPageResult;
  // Whether the run's sync posts at the place.
  let isPostedAtPlace: boolean;

  beforeEach(() => {
    pageRequests = [];
    liveRows = [];
    synced = [];
    pageResult = result();
    isPostedAtPlace = true;

    jest
      .spyOn(OnCallPageService, "page")
      .mockImplementation(async (request: OnCallPageRequest) => {
        pageRequests.push(request);
        return pageResult;
      });
    jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([userOf(SIMON)] as never);
    jest
      .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
      .mockImplementation((async (data: {
        messageKey: string;
        channelId?: string | undefined;
      }): Promise<Array<WorkspaceLiveMessage>> => {
        return liveRows.filter((row: WorkspaceLiveMessage): boolean => {
          return (
            row.messageKey === data.messageKey &&
            (!data.channelId || row.channelId === data.channelId)
          );
        });
      }) as never);
    jest
      .spyOn(WorkspaceLiveMessageService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceLiveMessage;
      }): Promise<WorkspaceLiveMessage> => {
        liveRows.push(data.data);
        return data.data;
      }) as never);
    jest
      .spyOn(OnCallPolicyRunMessage, "syncRun")
      .mockImplementation(async (executionLogId: ObjectID) => {
        synced.push(executionLogId.toString());

        if (isPostedAtPlace) {
          const posted: WorkspaceLiveMessage = new WorkspaceLiveMessage();
          posted.messageKey =
            WorkspaceLiveMessageKey.forOnCallPolicyRun(executionLogId);
          posted.channelId = "C0OPS";
          liveRows.push(posted);
        }
      });
  });

  async function page(
    data?: Partial<Parameters<typeof WorkspacePage.page>[0]>,
  ): Promise<WorkspacePageOutcome> {
    return await WorkspacePage.page({
      projectId: PROJECT_ID,
      props: PROPS,
      workspaceType: WorkspaceType.Slack,
      targets: { userIds: [NAWAZ] },
      message: "The checkout API is down",
      place: {
        workspaceType: WorkspaceType.Slack,
        destinationType: WorkspaceLiveMessageDestinationType.Channel,
        channelId: "C0OPS",
        channelName: "ops",
      },
      ...(data || {}),
    });
  }

  test("one call to OnCallPageService: the targets, a new alert titled by the message, as the member, waiting briefly for its channels", async () => {
    await page();

    expect(pageRequests).toEqual([
      {
        projectId: PROJECT_ID,
        targets: { userIds: [NAWAZ] },
        about: {
          newAlert: {
            title: "The checkout API is down",
            rootCause: "Created by **Simon Lee** from Slack to page people.",
          },
        },
        props: PROPS,
        maxWaitForRecordInMs: WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
      },
    ]);
    expect(WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS).toBe(5000);
  });

  test("a message over several lines: the title is its one line, the description all of it", async () => {
    await page({ message: "DB is down\n\nreplica lag 10m\nsee runbook" });

    expect(pageRequests[0]!.about.newAlert).toEqual({
      title: "DB is down replica lag 10m see runbook",
      description: "DB is down\n\nreplica lag 10m\nsee runbook",
      rootCause: "Created by **Simon Lee** from Slack to page people.",
    });
  });

  test("Microsoft Teams says so; the pager's name is text, whatever it holds", async () => {
    jest.spyOn(UserService, "findBy").mockImplementation((async () => {
      const user: User = userOf(SIMON);
      user.name = "[Simon](https://evil.example)" as never;
      return [user];
    }) as never);

    await page({ workspaceType: WorkspaceType.MicrosoftTeams });

    expect(pageRequests[0]!.about.newAlert!.rootCause).toBe(
      "Created by **\\[Simon\\](https://evil.example)** from Microsoft Teams to page people.",
    );
  });

  test("a pager OneUptime cannot name: where it came from, still", async () => {
    jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);

    await page();

    expect(pageRequests[0]!.about.newAlert!.rootCause).toBe(
      "Created from Slack to page people.",
    );
  });

  test("the place it was asked from is kept for its alert - a place, not a message - and the run is shown there at once", async () => {
    const outcome: WorkspacePageOutcome = await page();

    const placeKey: string = WorkspaceLiveMessageKey.forOnCallPageRequest(
      WorkspaceLiveMessagePageRecordType.Alert,
      ALERT_ID,
    );
    const place: WorkspaceLiveMessage | undefined = liveRows.find(
      (row: WorkspaceLiveMessage): boolean => {
        return row.messageKey === placeKey;
      },
    );

    expect(place).toBeDefined();
    expect({
      projectId: place!.projectId,
      workspaceType: place!.workspaceType,
      destinationType: place!.destinationType,
      channelId: place!.channelId,
      channelName: place!.channelName,
      messageId: place!.messageId,
      messageData: place!.messageData,
    }).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      destinationType: WorkspaceLiveMessageDestinationType.Channel,
      channelId: "C0OPS",
      channelName: "ops",
      messageId: "",
      messageData: { pagedByUserId: SIMON.toString() },
    });

    // Kept before the run is brought up to date, so the run finds it.
    expect(synced).toEqual([RUN_ID.toString()]);
    expect(outcome.isShownAtPlace).toBe(true);
    // Shown there, the page needs no other answer.
    expect(outcome.answer).toBeNull();
  });

  test("a place kept already for the alert is not kept twice", async () => {
    await page();
    await page();

    expect(
      liveRows.filter((row: WorkspaceLiveMessage): boolean => {
        return Boolean(row.messageKey?.startsWith("OnCallPageRequest:"));
      }),
    ).toHaveLength(1);
  });

  test("a run that could not be shown at the place: the person is told what came of it, and why it is not shown", async () => {
    isPostedAtPlace = false;

    const outcome: WorkspacePageOutcome = await page();

    expect(outcome.isShownAtPlace).toBe(false);
    expect(outcome.answer).toEqual({
      markdown: [
        `📟 Paged **Nawaz Dhandala** about **[Alert AL-12](${ALERT_URL})**: “The checkout API is down”`,
        "OneUptime can't post in this conversation, so the page's progress isn't shown here. Follow it on the alert.",
      ].join("\n\n"),
      text: "Paged Nawaz Dhandala about Alert AL-12",
    });
  });

  test("a page asked from nowhere it can be shown - a form with no channel - is answered with what came of it", async () => {
    const outcome: WorkspacePageOutcome = await page({ place: undefined });

    expect(synced).toEqual([]);
    expect(liveRows).toEqual([]);
    expect(outcome.answer!.markdown).toBe(
      `📟 Paged **Nawaz Dhandala** about **[Alert AL-12](${ALERT_URL})**: “The checkout API is down”`,
    );
  });

  test("a policy it started: shown at the place once its run starts - until then the person is told it did", async () => {
    pageResult = result({
      startedPolicies: [
        { onCallDutyPolicyId: DB_ESCALATION, name: "DB Escalation" },
      ],
    });

    const outcome: WorkspacePageOutcome = await page();

    expect(outcome.isShownAtPlace).toBe(true);
    expect(outcome.answer).toEqual({
      markdown: [
        `📟 Started on-call policy **DB Escalation** for **[Alert AL-12](${ALERT_URL})**: “The checkout API is down”`,
        "The policy's progress follows here as it pages.",
      ].join("\n\n"),
      text: "Started on-call policy DB Escalation for Alert AL-12",
    });
  });

  test("policies only: nothing to sync yet, and the person is told which started", async () => {
    pageResult = result({
      paged: [],
      directPageExecutionLogId: null,
      startedPolicies: [
        { onCallDutyPolicyId: DB_ESCALATION, name: "DB Escalation" },
        { onCallDutyPolicyId: PRIMARY, name: "Primary Escalation" },
      ],
    });

    const outcome: WorkspacePageOutcome = await page({
      targets: { onCallDutyPolicyIds: [DB_ESCALATION, PRIMARY] },
    });

    expect(synced).toEqual([]);
    expect(outcome.isShownAtPlace).toBe(false);
    expect(outcome.answer).toEqual({
      markdown: [
        `📟 Started on-call policies **DB Escalation** and **Primary Escalation** for **[Alert AL-12](${ALERT_URL})**: “The checkout API is down”`,
        "Each policy's progress follows here as it pages.",
      ].join("\n\n"),
      text: "Started on-call policies DB Escalation and Primary Escalation for Alert AL-12",
    });
  });

  test("who was not paged, and why, in the service's own sentences", async () => {
    isPostedAtPlace = false;
    pageResult = result({
      notPaged: ["Nobody is on call in schedule Secondary right now."],
    });

    const outcome: WorkspacePageOutcome = await page({ place: undefined });

    expect(outcome.answer!.markdown.split("\n\n")[1]).toBe(
      "- Nobody is on call in schedule Secondary right now.",
    );
  });

  test("nobody paged and no policy: said as such, and what to do next", () => {
    expect(
      WorkspacePage.getPagedAnswer({
        result: result({
          paged: [],
          isAnyonePaged: false,
          notPaged: ["Team Platform has no members."],
        }),
        message: "db down",
        isShownAtPlace: false,
        canBeShownAtPlace: false,
      }),
    ).toEqual({
      markdown: [
        `⚠️ Nobody was paged about **[Alert AL-12](${ALERT_URL})**: “db down”`,
        "- Team Platform has no members.",
        "Check who is on call, or page someone yourself.",
      ].join("\n\n"),
      text: "Nobody was paged about Alert AL-12",
    });
  });

  test("nobody paged where the page cannot be shown: there is no progress to follow, so it says what to do instead", () => {
    const answer: string = WorkspacePage.getPagedAnswer({
      result: result({
        paged: [],
        isAnyonePaged: false,
        notPaged: ["Nobody is on call in schedule Secondary right now."],
      }),
      message: "db down",
      isShownAtPlace: false,
      canBeShownAtPlace: true,
    }).markdown;

    expect(answer).not.toContain("can't post in this conversation");
    expect(answer).not.toContain("Follow it on the alert");
    expect(
      answer.endsWith("Check who is on call, or page someone yourself."),
    ).toBe(true);
  });

  test("names in an answer are text: none can be a link, a mention or formatting", () => {
    const answer: string = WorkspacePage.getPagedAnswer({
      result: result({
        paged: [
          {
            userId: NAWAZ,
            name: "[click](https://evil.example) <!channel>",
            email: null,
            teamName: null,
            scheduleName: null,
            coveringForName: null,
          },
        ],
      }),
      message: "**bold** _it_",
      isShownAtPlace: false,
      canBeShownAtPlace: false,
    }).markdown;

    expect(answer).not.toContain("[click](https://evil.example)");
    expect(answer).toContain("\\[click\\](https://evil.example)");
    expect(answer).toContain("\\*\\*bold\\*\\*");
  });

  test("what the service refuses is thrown for the chat to answer: nothing is kept, nothing synced", async () => {
    jest
      .spyOn(OnCallPageService, "page")
      .mockRejectedValue(new BadDataException("Nobody was paged. ..."));

    await expect(page()).rejects.toThrow("Nobody was paged. ...");
    expect(liveRows).toEqual([]);
    expect(synced).toEqual([]);
  });

  test("a place that cannot be kept, or a run that cannot be shown, never undoes the page: logged, and answered", async () => {
    const errors: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    jest
      .spyOn(WorkspaceLiveMessageService, "create")
      .mockRejectedValue(new Error("database is down"));
    jest
      .spyOn(OnCallPolicyRunMessage, "syncRun")
      .mockRejectedValue(new Error("Slack is down"));

    const outcome: WorkspacePageOutcome = await page();

    expect(outcome.result).toBe(pageResult);
    expect(outcome.isShownAtPlace).toBe(false);
    expect(outcome.answer!.text).toBe("Paged Nawaz Dhandala about Alert AL-12");
    expect(errors).toHaveBeenCalledWith(
      "Could not keep where a page from a chat was asked for; its progress is not shown there.",
      { projectId: PROJECT_ID.toString() },
    );
    expect(errors).toHaveBeenCalledWith(
      "A page from a chat went out, but its message could not be shown where it was asked for.",
      { projectId: PROJECT_ID.toString() },
    );
  });

  /*
   * In an incident's own channel (WorkspacePageAbout): the page is about
   * the incident - no alert - and the message is the page's own.
   */
  describe("about the incident of the channel it was asked in", () => {
    function incidentSubject(): WorkspacePageSubject {
      return {
        record: {
          type: OnCallPageRecordType.Incident,
          event: {
            type: WorkspaceEventType.Incident,
            id: INCIDENT_ID,
            projectId: PROJECT_ID,
            currentStateId: undefined,
            number: 42,
            numberWithPrefix: "INC-42",
          },
          name: { label: "Incident INC-42", link: INCIDENT_URL },
          title: "Checkout is down",
        },
      };
    }

    function incidentResult(): OnCallPageResult {
      return result({
        record: {
          type: OnCallPageRecordType.Incident,
          id: INCIDENT_ID,
          label: "Incident INC-42",
          title: "Checkout is down",
          url: URL.fromString(INCIDENT_URL),
          isNew: false,
        },
      });
    }

    test("one call to OnCallPageService about the incident - no new alert - with the message as the page's own, on one line", async () => {
      pageResult = incidentResult();

      await page({
        message: "  Can you check\nthe database? ",
        about: incidentSubject(),
      });

      expect(pageRequests).toEqual([
        {
          projectId: PROJECT_ID,
          targets: { userIds: [NAWAZ] },
          about: {
            incidentId: INCIDENT_ID,
            message: "Can you check the database?",
          },
          props: PROPS,
          maxWaitForRecordInMs: WORKSPACE_PAGE_MAX_WAIT_FOR_RECORD_IN_MS,
        },
      ]);
      expect(pageRequests[0]!.about.newAlert).toBeUndefined();
    });

    test("with no message: about the incident, and no message at all", async () => {
      pageResult = incidentResult();

      await page({ message: "", about: incidentSubject() });

      expect(pageRequests[0]!.about).toEqual({ incidentId: INCIDENT_ID });
    });

    test("about an alert, its alert's id", async () => {
      const subject: WorkspacePageSubject = incidentSubject();
      subject.record!.type = OnCallPageRecordType.Alert;
      subject.record!.event = {
        ...subject.record!.event,
        type: WorkspaceEventType.Alert,
        id: ALERT_ID,
      };

      await page({ message: "", about: subject });

      expect(pageRequests[0]!.about).toEqual({ alertId: ALERT_ID });
    });

    test("the place is kept for the incident, so the run is shown where it was asked", async () => {
      pageResult = incidentResult();

      await page({ message: "", about: incidentSubject() });

      expect(
        liveRows.some((row: WorkspaceLiveMessage): boolean => {
          return (
            row.messageKey ===
            WorkspaceLiveMessageKey.forOnCallPageRequest(
              WorkspaceLiveMessagePageRecordType.Incident,
              INCIDENT_ID,
            )
          );
        }),
      ).toBe(true);
    });

    test("shown where it was asked, nothing else is said; not shown, the answer quotes the message and points to the incident", async () => {
      pageResult = incidentResult();

      const shown: WorkspacePageOutcome = await page({
        message: "Can you check the database?",
        about: incidentSubject(),
      });
      expect(shown.answer).toBeNull();

      isPostedAtPlace = false;
      liveRows = [];

      const notShown: WorkspacePageOutcome = await page({
        message: "Can you check the database?",
        about: incidentSubject(),
      });

      expect(notShown.answer!.markdown).toBe(
        [
          `📟 Paged **Nawaz Dhandala** about **[Incident INC-42](${INCIDENT_URL})**: “Can you check the database?”`,
          "OneUptime can't post in this conversation, so the page's progress isn't shown here. Follow it on the incident.",
        ].join("\n\n"),
      );
    });

    test("a page about something new still says its progress is followed on the alert", async () => {
      isPostedAtPlace = false;

      const outcome: WorkspacePageOutcome = await page();

      expect(outcome.answer!.markdown).toContain("Follow it on the alert.");
    });
  });
});

describe("WorkspacePage: what a page needs, and what its form says, by what it is about", () => {
  const incident: WorkspacePageSubject = {
    record: {
      type: OnCallPageRecordType.Incident,
      event: {
        type: WorkspaceEventType.Incident,
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
        currentStateId: undefined,
        number: 42,
        numberWithPrefix: "INC-42",
      },
      name: { label: "Incident INC-42", link: INCIDENT_URL },
      title: "Checkout is down",
    },
  };
  const resolved: WorkspacePageSubject = {
    record: null,
    resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
  };

  function textOf(message: string): WorkspacePageText {
    return {
      people: [{ workspaceUserId: "U0NAWAZ", name: "nawaz" }],
      groups: [],
      unknownNames: [],
      message: message,
    };
  }

  const people: WorkspacePagePeople = {
    people: [{ userId: NAWAZ, name: "Nawaz Dhandala" }],
    notTold: [],
  };
  const groups: WorkspacePageGroups = { paged: [], notPaged: [] };

  test("a message is needed only for something new: it is its alert's title", () => {
    expect(WorkspacePage.isMessageRequired(undefined)).toBe(true);
    expect(
      WorkspacePage.isMessageRequired(WORKSPACE_PAGE_NEW_ALERT_SUBJECT),
    ).toBe(true);
    expect(WorkspacePage.isMessageRequired(resolved)).toBe(true);
    expect(WorkspacePage.isMessageRequired(incident)).toBe(false);
  });

  test("@nawaz with no message pages at once in an incident's channel - and opens the form anywhere else", () => {
    expect(
      WorkspacePage.isReadyToPage({
        text: textOf(""),
        people: people,
        groups: groups,
        about: incident,
      }),
    ).toBe(true);

    for (const about of [
      undefined,
      WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
      resolved,
    ]) {
      expect(
        WorkspacePage.isReadyToPage({
          text: textOf(""),
          people: people,
          groups: groups,
          about: about,
        }),
      ).toBe(false);
    }
  });

  test("in an incident's channel, somebody it cannot tell still opens the form: never guessed", () => {
    expect(
      WorkspacePage.isReadyToPage({
        text: textOf(""),
        people: { people: [], notTold: ["OneUptime can't tell who @x is."] },
        groups: groups,
        about: incident,
      }),
    ).toBe(false);
  });

  test("the form's message hint says where the message goes, and why when the channel's incident is resolved", () => {
    expect(WorkspacePage.getMessageHint(incident)).toBe(
      "Optional. The people you page see it with Incident INC-42.",
    );
    expect(WorkspacePage.getMessageHint(undefined)).toBe(
      "The people you page get this as the title of a new alert.",
    );
    expect(WorkspacePage.getMessageHint(WORKSPACE_PAGE_NEW_ALERT_SUBJECT)).toBe(
      WORKSPACE_PAGE_FORM_TEXT.messageHint,
    );
    expect(WorkspacePage.getMessageHint(resolved)).toBe(
      "Incident INC-42 is resolved, so the people you page get this as the title of a new alert.",
    );
  });

  test("a form about an incident resolved after it opened: nobody was paged, and why", () => {
    expect(WorkspacePage.getResolvedSinceMessage(resolved)).toBe(
      "Incident INC-42 was resolved after the form opened, so nobody was paged.",
    );
    expect(WorkspacePage.getResolvedSinceMessage(undefined)).toBe(
      "It was resolved after the form opened, so nobody was paged.",
    );
  });

  test("a form's message is asked for only when needed", () => {
    expect(
      WorkspacePage.getFormProblems({
        values: [`user:${NAWAZ.toString()}`],
        message: "  ",
        isMessageRequired: false,
      }),
    ).toBeNull();
    expect(
      WorkspacePage.getFormProblems({
        values: [`user:${NAWAZ.toString()}`],
        message: "  ",
      }),
    ).toEqual({ message: WORKSPACE_PAGE_FORM_TEXT.writeMessage });
    // Who to page is always needed.
    expect(
      WorkspacePage.getFormProblems({
        values: [],
        message: "",
        isMessageRequired: false,
      }),
    ).toEqual({ who: WORKSPACE_PAGE_FORM_TEXT.pickWho });
  });

  describe("who may page, by what the page is about", () => {
    let asked: Array<unknown>;

    beforeEach(() => {
      asked = [];
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockImplementation(
          async (data: { modelType: unknown; action: string }) => {
            asked.push(data.modelType);

            // A member who may page, but not create alerts.
            if (data.modelType === Alert) {
              throw new NotAuthorizedException(
                "You do not have permission to page people. You need one of these permissions: Alert Member.",
              );
            }
          },
        );
    });

    test("about the incident of its own channel: an on-call run is all it asks - it creates no alert", async () => {
      await expect(
        WorkspacePage.assertMayPage(PROPS, incident),
      ).resolves.toBeUndefined();
      expect(asked).toEqual([OnCallDutyPolicyExecutionLog]);
    });

    test("about something new - in another channel, or a resolved incident's: the alert it creates, too", async () => {
      for (const about of [
        undefined,
        WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
        resolved,
      ]) {
        asked = [];

        await expect(WorkspacePage.assertMayPage(PROPS, about)).rejects.toThrow(
          "You need one of these permissions: Alert Member.",
        );
        expect(asked).toEqual([OnCallDutyPolicyExecutionLog, Alert]);
      }
    });

    test("somebody who may not start an on-call run may page about nothing, the incident of its channel included", async () => {
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockImplementation(async () => {
          throw new NotAuthorizedException(
            "You do not have permission to page people. You need one of these permissions: Project Member.",
          );
        });

      await expect(
        WorkspacePage.assertMayPage(PROPS, incident),
      ).rejects.toThrow("You need one of these permissions: Project Member.");
    });
  });
});

describe("WorkspacePage.getPagedWho and getPagedAnswer: a paged team by its name first, then its people", () => {
  function person(
    name: string,
    teamName: string | null,
  ): OnCallPageResult["paged"][number] {
    return {
      userId: ObjectID.generate(),
      name: name,
      email: null,
      teamName: teamName,
      scheduleName: null,
      coveringForName: null,
    };
  }

  test("one team: its name, then its people in brackets", () => {
    const who: { markdown: { toString: () => string }; text: string } =
      WorkspacePage.getPagedWho([
        person("Test User 4", "Team X"),
        person("Test User 3", "Team X"),
      ]);

    expect(who.markdown.toString()).toBe(
      "**Team X** (Test User 4 and Test User 3)",
    );
    expect(who.text).toBe("Team X (Test User 4 and Test User 3)");
  });

  test("a team and somebody named on their own, in the order paged", () => {
    const who: { markdown: { toString: () => string }; text: string } =
      WorkspacePage.getPagedWho([
        person("Ana Ruiz", "Platform"),
        person("Nawaz Dhandala", null),
        person("Sam Lee", "Platform"),
        person("Alex Kim", "Database"),
      ]);

    expect(who.markdown.toString()).toBe(
      "**Platform** (Ana Ruiz and Sam Lee), **Nawaz Dhandala** and **Database** (Alex Kim)",
    );
    expect(who.text).toBe(
      "Platform (Ana Ruiz and Sam Lee), Nawaz Dhandala and Database (Alex Kim)",
    );
  });

  test("people named on their own, as before: each in bold", () => {
    expect(
      WorkspacePage.getPagedWho([
        person("Nawaz Dhandala", null),
        person("Ana Ruiz", null),
      ]).markdown.toString(),
    ).toBe("**Nawaz Dhandala** and **Ana Ruiz**");
  });

  test("names are text: a team's name never becomes formatting", () => {
    expect(
      WorkspacePage.getPagedWho([
        person("Nawaz", "*Ops* [team](https://evil.example)"),
      ]).markdown.toString(),
    ).toBe("**\\*Ops\\* \\[team\\](https://evil.example)** (Nawaz)");
  });

  test("the answer only the person who paged sees: 📟 Paged Team X (its people) about the record", () => {
    const answer: { markdown: string; text: string } =
      WorkspacePage.getPagedAnswer({
        result: result({
          paged: [
            person("Test User 4", "Team X"),
            person("Test User 3", "Team X"),
          ],
        }),
        message: "Paging team X.",
        isShownAtPlace: false,
        canBeShownAtPlace: false,
      });

    expect(answer.markdown).toBe(
      `📟 Paged **Team X** (Test User 4 and Test User 3) about **[Alert AL-12](${ALERT_URL})**: “Paging team X.”`,
    );
    expect(answer.text).toBe(
      "Paged Team X (Test User 4 and Test User 3) about Alert AL-12",
    );
  });
});
