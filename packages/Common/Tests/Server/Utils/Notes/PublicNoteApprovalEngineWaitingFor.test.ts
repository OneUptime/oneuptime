import Team from "../../../../Models/DatabaseModels/Team";
import TeamService from "../../../../Server/Services/TeamService";
import PublicNoteApprovalEngine from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import { PublicNoteApprovalWaitingFor } from "../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalColumns,
  PublicNoteApprovalEventType,
  PublicNoteApprovalRound,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO A PUBLIC NOTE WAITS FOR (#6254).
 *
 * The answer a note sent from chat gets while it waits names who it waits
 * for: the step it waits for among the steps as they are now, and the
 * people and teams that step names, as the record's feed names them
 * (PublicNoteApprovalEngine.getWaitingForNote). A note nobody is asked
 * about - published with no edit waiting, or rejected - waits for nobody.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const ALICE: string = "7b000000-0000-4000-8000-0000000000a1";
const BOB: string = "7b000000-0000-4000-8000-0000000000b2";
const CAROL: string = "7b000000-0000-4000-8000-0000000000c3";
const SUPPORT_TEAM: string = "7b000000-0000-4000-8000-0000000000d4";

const SUPPORT: PublicNoteApprovalStepRule = {
  id: "s1",
  name: "Support",
  order: 1,
  userIds: [BOB],
  teamIds: [SUPPORT_TEAM],
};
const LEGAL: PublicNoteApprovalStepRule = {
  id: "s2",
  name: "Legal",
  order: 2,
  userIds: [CAROL],
  teamIds: [],
};

type Note = PublicNoteApprovalColumns & {
  projectId?: ObjectID | null | undefined;
};

let steps: Array<PublicNoteApprovalStepRule>;

function round(overrides: Partial<PublicNoteApprovalRound> = {}): JSONObject {
  return PublicNoteApproval.toJSON({
    ...PublicNoteApproval.startRound({
      now: new Date("2026-11-07T09:00:00.000Z"),
      submittedByUserId: ALICE,
      isEdit: false,
    }),
    ...overrides,
  });
}

function waitingNote(overrides: Partial<Note> = {}): Note {
  return {
    projectId: PROJECT_ID,
    isPublished: false,
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: round(),
    ...overrides,
  };
}

async function waitingFor(
  note: Note,
): Promise<PublicNoteApprovalWaitingFor | null> {
  return await PublicNoteApprovalEngine.getWaitingForNote({
    eventType: PublicNoteApprovalEventType.Incident,
    note: note,
  });
}

beforeEach(() => {
  steps = [SUPPORT, LEGAL];

  getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockImplementation(
    (async () => {
      return steps;
    }) as never,
  );
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "getUserNames",
  ).mockImplementation((async (ids: ReadonlyArray<string>) => {
    const names: Record<string, string> = { [BOB]: "Bob", [CAROL]: "Carol" };
    const found: Record<string, string> = {};

    for (const id of ids) {
      if (names[id]) {
        found[id] = names[id]!;
      }
    }

    return found;
  }) as never);
  getJestSpyOn(TeamService, "findBy").mockImplementation((async () => {
    const team: Team = new Team();
    team._id = SUPPORT_TEAM;
    team.name = "Support Team";
    return [team];
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PublicNoteApprovalEngine.getWaitingForNote", () => {
  test("a note just sent waits for the first step: its people, then its teams", async () => {
    const found: PublicNoteApprovalWaitingFor | null =
      await waitingFor(waitingNote());

    expect(found?.position).toMatchObject({ number: 1, count: 2 });
    expect(found?.position.step?.id).toBe("s1");
    expect(found?.approverNames).toEqual(["Bob", "Support Team"]);
  });

  test("approved for the first step, it waits for the next", async () => {
    const found: PublicNoteApprovalWaitingFor | null = await waitingFor(
      waitingNote({
        approval: round({
          approvals: [
            { stepId: "s1", userId: BOB, at: "2026-11-07T09:05:00.000Z" },
          ],
        }),
      }),
    );

    expect(found?.position).toMatchObject({ number: 2, count: 2 });
    expect(found?.position.step?.name).toBe("Legal");
    expect(found?.approverNames).toEqual(["Carol"]);
  });

  test("the steps are read as they are now, for the note's project and kind", async () => {
    const getSteps: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    ).mockResolvedValue([LEGAL]);

    const found: PublicNoteApprovalWaitingFor | null =
      await waitingFor(waitingNote());

    expect(getSteps).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      eventType: PublicNoteApprovalEventType.Incident,
    });
    expect(found?.position).toMatchObject({ number: 1, count: 1 });
    expect(found?.approverNames).toEqual(["Carol"]);
  });

  test("an edit of a published note that waits is asked about too", async () => {
    const found: PublicNoteApprovalWaitingFor | null = await waitingFor({
      projectId: PROJECT_ID,
      isPublished: true,
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      pendingNote: "We are rolling back the deploy.",
      approval: round({ isEdit: true }),
    });

    expect(found?.position.step?.id).toBe("s1");
  });

  test("no step names anyone: it waits for nobody who can approve it yet", async () => {
    steps = [];

    const found: PublicNoteApprovalWaitingFor | null =
      await waitingFor(waitingNote());

    expect(found).toEqual({
      position: expect.objectContaining({ step: null, count: 0 }),
      approverNames: [],
    });
  });

  test("a note nobody is asked about waits for nobody, and nothing is read", async () => {
    const getSteps: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    );

    for (const note of [
      // Published as every note was before approval existed.
      { projectId: PROJECT_ID, isPublished: true },
      // Approved and published.
      {
        projectId: PROJECT_ID,
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.Approved,
      },
      // Rejected: its author sends it again, or not.
      waitingNote({ approvalStatus: PublicNoteApprovalStatus.Rejected }),
      // A published note whose edit was rejected.
      {
        projectId: PROJECT_ID,
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.Rejected,
      },
    ] as Array<Note>) {
      await expect(waitingFor(note)).resolves.toBeNull();
    }

    expect(getSteps).not.toHaveBeenCalled();
  });

  test("a note with no project to ask about waits for nobody", async () => {
    await expect(
      waitingFor(waitingNote({ projectId: undefined })),
    ).resolves.toBeNull();
    await expect(
      waitingFor(waitingNote({ projectId: null })),
    ).resolves.toBeNull();
  });
});
