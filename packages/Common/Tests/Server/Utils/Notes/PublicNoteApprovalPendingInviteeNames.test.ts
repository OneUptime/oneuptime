import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteApprovalNoteSummary,
  PublicNoteApprovalPolicySummary,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { PublicNoteApprovalWaitingFor } from "../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalColumns,
  PublicNoteApprovalEventType,
  PublicNoteApprovalRound,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO A PUBLIC NOTE'S APPROVAL NAMES, AS THE PROJECT KNOWS THEM (#9934).
 *
 * An approval step can name someone invited to the project who has not
 * accepted - the people pickers offer them - and the approval names its
 * people everywhere the project's people read: the Dashboard's approval
 * panel and policy, the record's feed ("It waits for step 1 of 2 (Legal):
 * Carol."), the messages that ask approvers and tell the sender, and the
 * chat answers. Until they accept, the project sees only what it invited
 * (#9823): the name typed for them, else their address - never their
 * account's own name, which would tell whoever set up the step whose the
 * address is. A member is named by their own name.
 *
 * People are read as OneUptime; who of them is only invited is read once,
 * in the note's project (PendingInviteeProfiles.readWithheldProfilesInProject).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99340000-0000-4000-8000-000000000001",
);
const NOTE_ID: string = "99340000-0000-4000-8000-000000000002";

// A member, an invitee with a name typed for them, and one with none.
const MEMBER: string = "99340000-0000-4000-8000-0000000000a1";
const NAMED_INVITEE: string = "99340000-0000-4000-8000-0000000000b2";
const UNNAMED_INVITEE: string = "99340000-0000-4000-8000-0000000000c3";
// A member whose account has no name.
const NAMELESS_MEMBER: string = "99340000-0000-4000-8000-0000000000d4";
const LEGAL_TEAM: string = "99340000-0000-4000-8000-0000000000e5";

const ACCOUNT_NAMES: Record<string, string> = {
  [MEMBER]: "Mia Member",
  [NAMED_INVITEE]: "Nina Account",
  [UNNAMED_INVITEE]: "Uma Account",
};

const EMAILS: Record<string, string> = {
  [MEMBER]: "mia@example.com",
  [NAMED_INVITEE]: "nina@example.com",
  [UNNAMED_INVITEE]: "uma@example.com",
  [NAMELESS_MEMBER]: "noname@example.com",
};

// The invitees' own account names: never in anything the project reads.
const INVITEES_OWN_NAMES: Array<string> = ["Nina Account", "Uma Account"];

const STEP_ONE: PublicNoteApprovalStepRule = {
  id: "s1",
  name: "Support",
  order: 1,
  userIds: [MEMBER, NAMED_INVITEE, UNNAMED_INVITEE],
  teamIds: [LEGAL_TEAM],
};

const STEP_TWO: PublicNoteApprovalStepRule = {
  id: "s2",
  name: "Legal",
  order: 2,
  userIds: [NAMELESS_MEMBER],
  teamIds: [],
};

let findUsers: SpyInstance<typeof UserService.findBy>;
let withheldIn: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;

function account(id: string): User {
  const user: User = new User(new ObjectID(id));

  if (ACCOUNT_NAMES[id]) {
    user.name = new Name(ACCOUNT_NAMES[id]!);
  }

  if (EMAILS[id]) {
    user.email = new Email(EMAILS[id]!);
  }

  return user;
}

// The project's pending people: one with a name typed for them, one with none.
function invitees(): Map<string, WithheldProfile> {
  return new Map<string, WithheldProfile>([
    [NAMED_INVITEE, { inviteeName: "Nina from Legal" }],
    [UNNAMED_INVITEE, { inviteeName: null }],
  ]);
}

function expectNoOwnNameOfAnInvitee(value: unknown): void {
  const text: string = JSON.stringify(value);

  for (const name of INVITEES_OWN_NAMES) {
    expect(text).not.toContain(name);
  }
}

beforeEach(() => {
  findUsers = jest
    .spyOn(UserService, "findBy")
    .mockImplementation((async (args: {
      query: { _id: unknown };
    }): Promise<Array<User>> => {
      const asked: string = JSON.stringify(args.query._id);

      return Object.keys(EMAILS)
        .filter((id: string): boolean => {
          return asked.includes(id);
        })
        .map(account);
    }) as never);

  withheldIn = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async (): Promise<Map<string, WithheldProfile>> => {
      return invitees();
    }) as never);

  jest.spyOn(TeamService, "findBy").mockImplementation((async () => {
    const team: Team = new Team();
    team._id = LEGAL_TEAM;
    team.name = "Legal Team";
    return [team];
  }) as never);

  jest
    .spyOn(PublicNoteApprovalPolicy, "getSteps")
    .mockResolvedValue([STEP_ONE, STEP_TWO] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PublicNoteApprovalNotifications.getUserNames", () => {
  test("someone only invited is named by the name typed for them, never their own", async () => {
    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        [NAMED_INVITEE],
        PROJECT_ID,
      );

    expect(names).toEqual({ [NAMED_INVITEE]: "Nina from Legal" });
    expectNoOwnNameOfAnInvitee(names);
  });

  test("someone only invited with no name typed is named by their address", async () => {
    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        [UNNAMED_INVITEE],
        PROJECT_ID,
      );

    expect(names).toEqual({ [UNNAMED_INVITEE]: "uma@example.com" });
    expectNoOwnNameOfAnInvitee(names);
  });

  test("a member is named by their own name, else their address", async () => {
    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        [MEMBER, NAMELESS_MEMBER],
        PROJECT_ID,
      );

    expect(names).toEqual({
      [MEMBER]: "Mia Member",
      [NAMELESS_MEMBER]: "noname@example.com",
    });
  });

  test("everyone at once: who is only invited is read once, in the note's project", async () => {
    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames(
        [MEMBER, NAMED_INVITEE, UNNAMED_INVITEE, MEMBER],
        PROJECT_ID,
      );

    expect(names).toEqual({
      [MEMBER]: "Mia Member",
      [NAMED_INVITEE]: "Nina from Legal",
      [UNNAMED_INVITEE]: "uma@example.com",
    });
    expect(findUsers).toHaveBeenCalledTimes(1);
    expect(findUsers.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect([...withheldIn.mock.calls[0]![0].userIds].sort()).toEqual(
      [MEMBER, NAMED_INVITEE, UNNAMED_INVITEE].sort(),
    );
  });

  test("an account with neither a name nor an address is a team member", async () => {
    findUsers.mockResolvedValue([new User(new ObjectID(MEMBER))] as never);

    const names: Record<string, string> =
      await PublicNoteApprovalNotifications.getUserNames([MEMBER], PROJECT_ID);

    expect(names).toEqual({ [MEMBER]: "A team member" });
  });

  test("nobody to name: nothing is read", async () => {
    await expect(
      PublicNoteApprovalNotifications.getUserNames([], PROJECT_ID),
    ).resolves.toEqual({});
    expect(findUsers).not.toHaveBeenCalled();
    expect(withheldIn).not.toHaveBeenCalled();
  });
});

type Note = PublicNoteApprovalColumns & {
  projectId?: ObjectID | null | undefined;
};

function round(overrides: Partial<PublicNoteApprovalRound> = {}): JSONObject {
  return PublicNoteApproval.toJSON({
    ...PublicNoteApproval.startRound({
      now: new Date("2026-11-19T09:00:00.000Z"),
      submittedByUserId: MEMBER,
      isEdit: false,
    }),
    ...overrides,
  });
}

function waitingNote(): Note {
  return {
    projectId: PROJECT_ID,
    isPublished: false,
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: round(),
  };
}

describe("who a waiting note waits for (the feed and the chat answers)", () => {
  test("the step's people as the project knows them, then its teams", async () => {
    const found: PublicNoteApprovalWaitingFor | null =
      await PublicNoteApprovalEngine.getWaitingForNote({
        eventType: PublicNoteApprovalEventType.Incident,
        note: waitingNote(),
      });

    expect(found?.approverNames).toEqual([
      "Mia Member",
      "Nina from Legal",
      "uma@example.com",
      "Legal Team",
    ]);
    expectNoOwnNameOfAnInvitee(found);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });
});

// A note kind the Dashboard's reads go through, with one waiting note.
function hostWithNote(note: JSONObject): PublicNoteApprovalHost<BaseModel> {
  return {
    eventType: PublicNoteApprovalEventType.Incident,
    service: {
      findBy: async (): Promise<Array<JSONObject>> => {
        return [note];
      },
    },
  } as unknown as PublicNoteApprovalHost<BaseModel>;
}

describe("what the Dashboard is told", () => {
  test("the approval panel names the step's people as the project knows them", async () => {
    const summaries: Array<PublicNoteApprovalNoteSummary> =
      await PublicNoteApprovalEngine.describeNotes({
        host: hostWithNote({
          _id: NOTE_ID,
          isPublished: false,
          approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
          approval: round(),
        }),
        noteIds: [new ObjectID(NOTE_ID)],
        props: { isRoot: true },
        projectId: PROJECT_ID,
      });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.submittedBy).toBe("Mia Member");
    expect(summaries[0]!.step?.people).toEqual([
      "Mia Member",
      "Nina from Legal",
      "uma@example.com",
    ]);
    expect(summaries[0]!.step?.teams).toEqual(["Legal Team"]);
    expectNoOwnNameOfAnInvitee(summaries);

    // Everybody the summaries name, read in the panel's project at once.
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("the approval policy names each step's people as the project knows them", async () => {
    jest.spyOn(PublicNoteApprovalPolicy, "read").mockResolvedValue({
      isRequired: true,
      steps: [STEP_ONE, STEP_TWO],
    } as never);

    const policy: PublicNoteApprovalPolicySummary =
      await PublicNoteApprovalEngine.describePolicy({
        host: hostWithNote({}),
        projectId: PROJECT_ID,
      });

    expect(
      policy.steps.map(
        (step: PublicNoteApprovalPolicySummary["steps"][number]) => {
          return step.people;
        },
      ),
    ).toEqual([
      ["Mia Member", "Nina from Legal", "uma@example.com"],
      ["noname@example.com"],
    ]);
    expectNoOwnNameOfAnInvitee(policy);
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });
});
