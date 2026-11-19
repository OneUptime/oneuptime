import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import SecurityCaseNoteService from "../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../Server/Services/SecurityCaseTaskService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { parseSecurityPlaybookSteps } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityCaseTemplateValues } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";

/*
 * A SECURITY PLAYBOOK NAMES PEOPLE AS THE PROJECT KNOWS THEM (#9934).
 *
 * A step can hand tasks to someone invited to the project who has not
 * accepted, and a case can be assigned to them: the people pickers offer
 * them. Two things a playbook writes then name them where the project's
 * people read:
 *
 *   - Add tasks: "Added 2 tasks for **X**." on the case's timeline;
 *   - {{assignee}}, which a note, an email, a channel post, an incident,
 *     a page, a runbook and a data store owner's message are written with.
 *
 * Until they accept, the project sees only what it invited (#9823): the
 * name typed for them, else their address - never their account's own
 * name, which would tell whoever set up the playbook whose the address is.
 * A member is named by their own name.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99340000-1111-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("99340000-1111-4000-8000-000000000002");

const MEMBER_ID: string = "99340000-1111-4000-8000-0000000000a1";
const INVITEE_ID: string = "99340000-1111-4000-8000-0000000000b2";
const TEAM_ID: string = "99340000-1111-4000-8000-0000000000c3";

// The invitee's account's own name: never in what the project reads.
const INVITEES_OWN_NAME: string = "Ingrid Account-Holder";

let created: Array<SecurityCaseTask>;
let notes: Array<SecurityCaseNote>;
let withheld: Map<string, WithheldProfile>;
let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

function person(id: string): User {
  const user: User = new User(new ObjectID(id));

  if (id === MEMBER_ID) {
    user.name = new Name("Mia Member");
    user.email = new Email("mia@example.com");
  } else {
    user.name = new Name(INVITEES_OWN_NAME);
    user.email = new Email("ingrid@example.com");
  }

  return user;
}

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
  assigned?: { userId?: string; teamId?: string },
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "CASE-7";
  securityCase.title = "Impossible travel";
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );
  securityCase.entities = [
    { type: SecurityEntityType.User, value: "ingrid@example.com" },
  ] as unknown as JSONArray;

  if (assigned?.userId) {
    securityCase.assignedToUserId = new ObjectID(assigned.userId);
  }

  if (assigned?.teamId) {
    securityCase.assignedToTeamId = new ObjectID(assigned.teamId);
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
  created = [];
  notes = [];
  // The invitee has a name typed for them unless a test says otherwise.
  withheld = new Map<string, WithheldProfile>([
    [INVITEE_ID, { inviteeName: "Ingrid from Security" }],
  ]);

  stubSecurityCaseValues();

  jest.spyOn(SecurityCaseTaskService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SecurityCaseTaskService, "create")
    .mockImplementation((async (args: { data: SecurityCaseTask }) => {
      created.push(args.data);
      return args.data;
    }) as never);
  jest
    .spyOn(SecurityCaseNoteService, "create")
    .mockImplementation((async (args: { data: SecurityCaseNote }) => {
      notes.push(args.data);
      return args.data;
    }) as never);

  // Both are the project's: a member, and someone only invited.
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

          return [MEMBER_ID, INVITEE_ID]
            .filter((id: string): boolean => {
              return asked.includes(id);
            })
            .map(person);
        },
      };
    }) as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return person(args.id.toString());
  }) as never);
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team(new ObjectID(TEAM_ID));
    team.name = "Incident Response";
    return team;
  }) as never);
  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.test/dashboard/case") as never,
    );

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (): Promise<Map<string, WithheldProfile>> => {
      return withheld;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function addTasksFor(assigneeUserId: string): Promise<string> {
  const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
    context(SecurityPlaybookActionType.AddCaseTasks, {
      tasks: "Confirm the sign-in\nReset the password",
      assigneeUserId: assigneeUserId,
    }),
  );

  expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);

  return outcome.summary.toString();
}

describe("Add tasks names who it handed them to", () => {
  test("someone only invited, by the name typed for them, never their own", async () => {
    const summary: string = await addTasksFor(INVITEE_ID);

    expect(summary).toBe("Added 2 tasks for **Ingrid from Security**.");
    expect(summary).not.toContain(INVITEES_OWN_NAME);

    // The tasks are theirs all the same, as before.
    expect(
      created.map((task: SecurityCaseTask): string => {
        return task.assignedToUserId?.toString() || "";
      }),
    ).toEqual([INVITEE_ID, INVITEE_ID]);

    // Who is only invited is read in the step's project.
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(withheldIn.mock.calls[0]![0].userIds).toEqual([INVITEE_ID]);
  });

  test("someone only invited with no name typed, by their address", async () => {
    withheld = new Map<string, WithheldProfile>([
      [INVITEE_ID, { inviteeName: null }],
    ]);

    const summary: string = await addTasksFor(INVITEE_ID);

    expect(summary).toBe("Added 2 tasks for **ingrid@example.com**.");
    expect(summary).not.toContain(INVITEES_OWN_NAME);
  });

  test("a member, by their own name", async () => {
    withheld = new Map<string, WithheldProfile>();

    expect(await addTasksFor(MEMBER_ID)).toBe(
      "Added 2 tasks for **Mia Member**.",
    );
  });
});

async function assigneeValue(assigned?: {
  userId?: string;
  teamId?: string;
}): Promise<string> {
  const values: SecurityCaseTemplateValues =
    await SecurityPlaybookActions.getTemplateValues(
      context(SecurityPlaybookActionType.AddCaseNote, { note: "x" }, assigned),
    );

  return values.assignee;
}

describe("{{assignee}}: whom the case is assigned to", () => {
  test("someone only invited, by the name typed for them, never their own", async () => {
    expect(await assigneeValue({ userId: INVITEE_ID })).toBe(
      "Ingrid from Security",
    );
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("someone only invited with no name typed, by their address", async () => {
    withheld = new Map<string, WithheldProfile>([
      [INVITEE_ID, { inviteeName: null }],
    ]);

    expect(await assigneeValue({ userId: INVITEE_ID })).toBe(
      "ingrid@example.com",
    );
  });

  test("a member, by their own name", async () => {
    withheld = new Map<string, WithheldProfile>();

    expect(await assigneeValue({ userId: MEMBER_ID })).toBe("Mia Member");
  });

  test("a team by its name, and nobody as Unassigned, with no person read", async () => {
    expect(await assigneeValue({ teamId: TEAM_ID })).toBe("Incident Response");
    expect(await assigneeValue()).toBe("Unassigned");
    expect(withheldIn).not.toHaveBeenCalled();
  });

  test("a note a step writes with it names someone only invited as the project knows them", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(
        SecurityPlaybookActionType.AddCaseNote,
        { note: "{{case.number}} is with {{case.assignee}}." },
        { userId: INVITEE_ID },
      ),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.note).toBe("CASE-7 is with Ingrid from Security.");
    expect(notes[0]!.note).not.toContain(INVITEES_OWN_NAME);
  });
});
