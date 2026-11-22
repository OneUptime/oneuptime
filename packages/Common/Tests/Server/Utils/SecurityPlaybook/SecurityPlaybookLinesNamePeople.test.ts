import DataStore from "../../../../Models/DatabaseModels/DataStore";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import MailService from "../../../../Server/Services/MailService";
import SecurityCaseNoteService from "../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../Server/Services/SecurityCaseTaskService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataSecurityIntegrations from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import {
  FEED_INVITEE_UNNAMED,
  FEED_NOBODY_NAMED,
} from "../../../../Server/Utils/Feed/FeedPersonName";
import logger from "../../../../Server/Utils/Logger";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookNotEmailed, {
  ADDRESS_LEFT_OUT,
  withoutAddresses,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookNotEmailed";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import URL from "../../../../Types/API/URL";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { parseSecurityPlaybookSteps } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  FEED_PERSON_CASES,
  FeedPersonCase,
  expectNoAddressIn,
  feedPersonAccount,
  nameAsEveryChatShowsIt,
  renderInEveryChat,
  stubInvitations,
} from "../../../Helpers/FeedPersonCases";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SECURITY PLAYBOOK'S LINES NAME PEOPLE WITHOUT ANYBODY'S ADDRESS
 * (#10681).
 *
 * A playbook's steps write on the case's timeline, post to its Slack and
 * Microsoft Teams channels and email people, and three of them named a
 * person themselves:
 *
 *   - Add tasks: "Added 2 tasks for **X**." - someone only invited by the
 *     address they were invited at when no name was typed, a member with
 *     no name by their address;
 *   - {{case.assignee}}, which a note, an email, a channel post, the alert
 *     a page opens and a runbook are written with, and the summary a
 *     message without a template of its own sends: the same;
 *   - Email people and Notify data store owners listed whoever an email
 *     failed to reach by their address, under the step's timeline entry
 *     and in its error when nobody was emailed - and the mail service's
 *     reason could hold an address of its own.
 *
 * Now each person is named through FeedPersonName, as every feed entry and
 * channel line is, and a reason's addresses are left out. The steps' real
 * code runs; the database's reads, who is only invited, the mail service
 * and the workspaces' APIs are answered here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10681bbb-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("10681bbb-0000-4000-8000-000000000002");
const TEAM_ID: ObjectID = new ObjectID("10681bbb-0000-4000-8000-000000000003");
// The person each test is about.
const PERSON_ID: ObjectID = new ObjectID(
  "10681bbb-0000-4000-8000-0000000000a1",
);
// Tom, a member whose email always goes.
const TOM_ID: ObjectID = new ObjectID("10681bbb-0000-4000-8000-0000000000a2");

const CARDS_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::cards";

// What a mail server answers of an address it will not take.
function refusedFor(address: string): Error {
  return new Error(`550 5.1.1 <${address}>: Recipient address rejected`);
}

const REFUSAL_LEFT: string = `550 5.1.1 ${ADDRESS_LEFT_OUT} Recipient address rejected`;

let person: FeedPersonCase;
let accounts: Map<string, User>;
let createdTasks: Array<SecurityCaseTask>;
let notes: Array<SecurityCaseNote>;
let posted: Array<WorkspaceMessagePayload>;
let mailed: Array<string>;

function tom(): User {
  const user: User = new User(TOM_ID);
  user.name = new Name("Tom Okafor");
  user.email = "tom@oneuptime.example" as never;
  return user;
}

function setPerson(who: FeedPersonCase): void {
  person = who;
  accounts.set(PERSON_ID.toString(), feedPersonAccount(PERSON_ID, who));

  stubInvitations(
    new Map<string, WithheldProfile>(
      who.invitation
        ? [[PERSON_ID.toString().toLowerCase(), who.invitation]]
        : [],
    ),
  );
}

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
  assignedToUserId?: ObjectID,
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "CASE-7";
  securityCase.title = "Impossible travel";
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );
  securityCase.detectionCount = 1;
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
    { type: SecurityEntityType.DataStore, value: `data-store:${CARDS_KEY}` },
  ] as unknown as JSONArray;

  if (assignedToUserId) {
    securityCase.assignedToUserId = assignedToUserId;
  }

  const [step] = parseSecurityPlaybookSteps([{ id: "s1", action, config }]);

  return {
    projectId: PROJECT_ID,
    runId: ObjectID.generate(),
    playbookName: "Triage",
    stepNumber: 1,
    securityCase,
    step: step!,
  };
}

beforeEach(() => {
  accounts = new Map<string, User>([[TOM_ID.toString(), tom()]]);
  createdTasks = [];
  notes = [];
  posted = [];
  mailed = [];
  setPerson(FEED_PERSON_CASES[0]!);

  stubSecurityCaseValues();

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest.spyOn(SecurityCaseTaskService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SecurityCaseTaskService, "create")
    .mockImplementation((async (args: { data: SecurityCaseTask }) => {
      createdTasks.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(SecurityCaseNoteService, "create")
    .mockImplementation((async (args: { data: SecurityCaseNote }) => {
      notes.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/case") as never,
    );

  // Everyone a step names is the project's.
  jest
    .spyOn(RuleRecordScope, "keepIdsInProject")
    .mockImplementation((async (args: { ids: Array<string> }) => {
      return args.ids;
    }) as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "getLookupService")
    .mockImplementation((() => {
      return {
        findBy: async (args: {
          query: { _id: unknown };
        }): Promise<Array<User>> => {
          const asked: string = JSON.stringify(args.query._id);

          return Array.from(accounts.entries())
            .filter(([id]: [string, User]): boolean => {
              return asked.includes(id);
            })
            .map(([, account]: [string, User]): User => {
              return account;
            });
        },
      };
    }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return accounts.get(args.id.toString()) || null;
  }) as never);
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team(TEAM_ID);
    team.name = "Incident Response";
    return team;
  }) as never);
  jest
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockResolvedValue([] as never);

  // The person's email is refused, in words that name their address; Tom's goes.
  jest.spyOn(MailService, "sendMail").mockImplementation((async (mail: {
    toEmail: { toString: () => string };
  }) => {
    const to: string = mail.toEmail.toString();

    if (to === person.account.email) {
      throw refusedFor(to);
    }

    mailed.push(to);
  }) as never);

  // Every post lands in its channel.
  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      posted.push(...data.messagePayloadsByWorkspace);

      return data.messagePayloadsByWorkspace.map(
        (payload: WorkspaceMessagePayload): WorkspaceSendMessageResponse => {
          return {
            workspaceType: payload.workspaceType,
            threads: [
              {
                channel: {
                  id: "C0SOC",
                  name: "soc",
                  workspaceType: payload.workspaceType,
                },
                threadId: "1700000000.000100",
              },
            ],
            errors: [],
          } as unknown as WorkspaceSendMessageResponse;
        },
      );
    }) as never);

  // The case's data store, and its owners: the person.
  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    const store: DataStore = new DataStore();
    store._id = "10681bbb-0000-4000-8000-0000000000d1";
    store.projectId = PROJECT_ID;
    store.storeKey = CARDS_KEY;
    store.name = "cards";
    store.sensitivity = DataSensitivity.Restricted;
    return [store];
  }) as never);
  jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockImplementation((async () => {
      return [accounts.get(PERSON_ID.toString())!];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(
  action: SecurityPlaybookActionType,
  config: JSONObject,
  assignedToUserId?: ObjectID,
): Promise<PlaybookStepOutcome> {
  return await SecurityPlaybookActions.execute(
    context(action, config, assignedToUserId),
  );
}

// The Markdown of the one message a step posted.
function postedMarkdown(): string {
  expect(posted).toHaveLength(1);

  const blocks: Array<WorkspaceMessageBlock> = posted[0]!.messageBlocks;

  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadMarkdown";
    })
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text;
    })
    .join("\n");
}

// Everything a step said, and wrote, and posted: none of it holds an address.
function expectNoAddressInWhatTheStepSaid(outcome: PlaybookStepOutcome): void {
  expectNoAddressIn(
    JSON.stringify({
      summary: outcome.summary.toString(),
      details: outcome.detailsInMarkdown?.toString() || "",
      error: outcome.error || "",
      notes: notes.map((note: SecurityCaseNote): string => {
        return note.note || "";
      }),
      posted,
    }),
  );
}

describe.each(FEED_PERSON_CASES)("$label", (who: FeedPersonCase) => {
  test("Add tasks: the step's line names whom it handed the tasks to as every line does", async () => {
    setPerson(who);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.AddCaseTasks,
      {
        tasks: "Confirm the sign-in\nReset the password",
        assigneeUserId: PERSON_ID.toString(),
      },
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      `Added 2 tasks for **${who.named}**.`,
    );
    // The tasks are theirs all the same.
    expect(
      createdTasks.map((task: SecurityCaseTask): string => {
        return task.assignedToUserId?.toString() || "";
      }),
    ).toEqual([PERSON_ID.toString(), PERSON_ID.toString()]);
    expectNoAddressInWhatTheStepSaid(outcome);
  });

  test("{{case.assignee}}: the value every message is written with, and a note written with it", async () => {
    setPerson(who);

    const values: Awaited<
      ReturnType<typeof SecurityPlaybookActions.getTemplateValues>
    > = await SecurityPlaybookActions.getTemplateValues(
      context(SecurityPlaybookActionType.AddCaseNote, { note: "x" }, PERSON_ID),
    );

    expect(values.assignee).toBe(who.named);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.AddCaseNote,
      { note: "{{case.number}} is with {{case.assignee}}." },
      PERSON_ID,
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(notes[0]!.note).toBe(`CASE-7 is with ${who.named}.`);
    expectNoAddressInWhatTheStepSaid(outcome);
  });

  test.each([
    [WorkspaceType.Slack, SecurityPlaybookActionType.PostToSlack],
    [
      WorkspaceType.MicrosoftTeams,
      SecurityPlaybookActionType.PostToMicrosoftTeams,
    ],
  ])(
    "a post to a %s channel written with {{case.assignee}} names them so, as the chat shows it",
    async (
      workspaceType: WorkspaceType,
      action: SecurityPlaybookActionType,
    ) => {
      setPerson(who);

      const outcome: PlaybookStepOutcome = await run(
        action,
        {
          channelName: "soc",
          microsoftTeamsTeamId: "team-security",
          message: "{{case.number}} is with **{{case.assignee}}**.",
        },
        PERSON_ID,
      );

      expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
      expect(posted[0]!.workspaceType).toBe(workspaceType);
      expect(postedMarkdown()).toBe(`CASE-7 is with **${who.named}**.`);

      for (const chat of renderInEveryChat(postedMarkdown(), posted[0]!.text)) {
        expect(chat.posted).toContain(nameAsEveryChatShowsIt(who.named));
        expectNoAddressIn(chat.posted);
      }

      expectNoAddressInWhatTheStepSaid(outcome);
    },
  );

  test("a post with no message of its own sends the case's summary, which names them so", async () => {
    setPerson(who);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.PostToSlack,
      { channelName: "soc" },
      PERSON_ID,
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(postedMarkdown()).toContain(`Assigned to **${who.named}**`);

    for (const chat of renderInEveryChat(postedMarkdown(), posted[0]!.text)) {
      expectNoAddressIn(chat.posted);
    }

    expectNoAddressInWhatTheStepSaid(outcome);
  });

  test("Email people, when their email is refused: listed by name, with the reason's address left out", async () => {
    setPerson(who);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.EmailPeople,
      {
        userIds: [PERSON_ID.toString(), TOM_ID.toString()],
        teamIds: [],
        message: "Please look at {{case.number}}.",
      },
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(mailed).toEqual(["tom@oneuptime.example"]);
    expect(outcome.summary.toString()).toBe(
      "Emailed 1 person; 1 could not be emailed.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(`- ${who.named}: `);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "Recipient address rejected",
    );
    expectNoAddressInWhatTheStepSaid(outcome);
  });

  test("Email people, when nobody could be emailed: the step's error names them so", async () => {
    setPerson(who);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.EmailPeople,
      { userIds: [PERSON_ID.toString()], teamIds: [] },
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      `No email was sent. ${who.named}: ${REFUSAL_LEFT}`,
    );
    expectNoAddressInWhatTheStepSaid(outcome);
  });

  test("Notify data store owners, when the owner's email is refused: the step's error names them so", async () => {
    setPerson(who);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.NotifyDataStoreOwners,
      {},
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      `No email was sent. ${who.named}: ${REFUSAL_LEFT}`,
    );
    expectNoAddressInWhatTheStepSaid(outcome);
  });
});

describe("Notify data store owners, when one owner of two could not be emailed", () => {
  test("the step's details name them by name, never by address", async () => {
    setPerson(FEED_PERSON_CASES[5]!);
    jest
      .spyOn(DataSecurityIntegrations, "getOwnerUsers")
      .mockImplementation((async () => {
        return [accounts.get(PERSON_ID.toString())!, tom()];
      }) as never);

    const outcome: PlaybookStepOutcome = await run(
      SecurityPlaybookActionType.NotifyDataStoreOwners,
      {},
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Emailed 1 owner of 1 data store; 1 could not be emailed.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "Not emailed: ana.lee: ",
    );
    expectNoAddressInWhatTheStepSaid(outcome);
  });
});

describe("who could not be emailed, in words", () => {
  test("every word of a reason that holds an @ is left out, and the rest kept as it reads", () => {
    expect(
      withoutAddresses(
        "550 5.1.1 <ana.lee@acme.test>: Recipient address rejected",
      ),
    ).toBe(REFUSAL_LEFT);
    expect(
      withoutAddresses("Email ana@@acme.test is not in valid format."),
    ).toBe(`Email ${ADDRESS_LEFT_OUT} is not in valid format.`);
    expect(
      withoutAddresses("Could not reach smtp://mailer:secret@mail.acme.test"),
    ).toBe(`Could not reach ${ADDRESS_LEFT_OUT}`);
    expect(withoutAddresses("timeout of 20000ms exceeded")).toBe(
      "timeout of 20000ms exceeded",
    );
    // On one line: a reason's line breaks would break the step's list.
    expect(withoutAddresses("first line\nsecond  line ")).toBe(
      "first line second line",
    );
    expect(withoutAddresses("")).toBe("");
  });

  test("each person by name, in the order tried, with one read of who is only invited", async () => {
    const ivy: User = feedPersonAccount(PERSON_ID, FEED_PERSON_CASES[1]!);
    const withheldIn: ReturnType<typeof stubInvitations> = stubInvitations(
      new Map<string, WithheldProfile>([
        [PERSON_ID.toString(), FEED_PERSON_CASES[1]!.invitation!],
      ]),
    );

    const lines: Array<string> = await SecurityPlaybookNotEmailed.describe({
      projectId: PROJECT_ID,
      notEmailed: [
        { user: tom(), reason: "timeout of 20000ms exceeded" },
        { user: ivy, reason: "Email ivy@acme.test is not in valid format." },
      ],
    });

    expect(lines).toEqual([
      "Tom Okafor: timeout of 20000ms exceeded",
      `${FEED_INVITEE_UNNAMED}: Email ${ADDRESS_LEFT_OUT} is not in valid format.`,
    ]);
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("nobody not emailed reads nobody", async () => {
    const withheldIn: ReturnType<typeof stubInvitations> = stubInvitations(
      new Map<string, WithheldProfile>(),
    );

    expect(
      await SecurityPlaybookNotEmailed.describe({
        projectId: PROJECT_ID,
        notEmailed: [],
      }),
    ).toEqual([]);
    expect(withheldIn).not.toHaveBeenCalled();
  });

  test("when who is only invited cannot be read, each is Somebody", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("The database is not answering."));

    expect(
      await SecurityPlaybookNotEmailed.describe({
        projectId: PROJECT_ID,
        notEmailed: [
          {
            user: feedPersonAccount(PERSON_ID, FEED_PERSON_CASES[5]!),
            reason: "mailbox full",
          },
        ],
      }),
    ).toEqual([`${FEED_NOBODY_NAMED}: mailbox full`]);
  });
});
