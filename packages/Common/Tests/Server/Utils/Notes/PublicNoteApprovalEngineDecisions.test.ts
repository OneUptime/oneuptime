import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import TeamService from "../../../../Server/Services/TeamService";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteApprovalOutcome,
  PublicNoteKind,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalMessages,
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
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
 * DECIDING ON A PUBLIC NOTE (issue #5720).
 *
 * The engine over one note held in memory, written only at the version it
 * was read at, as the database writes it. What a published note always did
 * - its entry on the incident's feed and chat channels, its On Create
 * workflows - happens when the last step approves it, exactly once, and
 * never before: not on an earlier step, not on a rejection, and not for a
 * second approver who decided at the same moment.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001"; // sends notes
const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002"; // support step
const CAROL: string = "c3c3c3c3-0000-4000-8000-000000000003"; // legal step
const DAVE: string = "d5d5d5d5-0000-4000-8000-000000000005"; // approves nothing

const SUPPORT: PublicNoteApprovalStepRule = {
  id: "s1",
  name: "Support",
  order: 1,
  userIds: [BOB],
  teamIds: [],
};
const LEGAL: PublicNoteApprovalStepRule = {
  id: "s2",
  name: "Legal",
  order: 2,
  userIds: [CAROL],
  teamIds: [],
};

interface StoredNote {
  _id: string;
  version: number;
  projectId: ObjectID;
  incidentId: ObjectID;
  note: string;
  pendingNote: string | null;
  isPublished: boolean;
  approvalStatus: string | null;
  approval: JSONObject | null;
  postedAt?: Date | undefined;
  subscriberNotificationStatusOnNoteUpdated?: string | undefined;
  createdByUserId: ObjectID;
  attachments: Array<unknown>;
}

interface World {
  stored: StoredNote;
  // Who may read the note, and who may edit it.
  readers: Set<string>;
  editors: Set<string>;
  writes: Array<Record<string, unknown>>;
  feed: Array<{ markdown: string; userId?: string | undefined }>;
  published: Array<{ noteId: string; approvedByNames: Array<string> }>;
  editsPublished: Array<{ noteId: string; approvedByNames: Array<string> }>;
  workflows: Array<string>;
  asked: Array<Array<string>>;
  told: Array<{
    userId: string | undefined;
    isApproved: boolean;
    reason?: string | undefined;
  }>;
  // The note as the next read finds it: as it was before a write that landed first (a race).
  staleNote: StoredNote | null;
}

let world: World;

function heldNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    _id: NOTE_ID.toString(),
    version: 1,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    note: "We are looking into it.",
    pendingNote: null,
    isPublished: false,
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: PublicNoteApproval.toJSON(
      PublicNoteApproval.startRound({
        now: new Date("2026-11-07T09:00:00.000Z"),
        submittedByUserId: ALICE,
        isEdit: false,
      }),
    ),
    createdByUserId: new ObjectID(ALICE),
    attachments: [],
    ...overrides,
  };
}

function propsOf(userId?: string): DatabaseCommonInteractionProps {
  return {
    ...(userId ? { userId: new ObjectID(userId) } : {}),
    tenantId: PROJECT_ID,
  };
}

function snapshot(): StoredNote {
  return { ...world.stored };
}

function fakeService(): unknown {
  return {
    findOneBy: async (query: {
      query: { _id: string };
      props: DatabaseCommonInteractionProps;
    }): Promise<unknown> => {
      const userId: string = query.props.userId?.toString() || "";
      return world.readers.has(userId) && query.query._id === world.stored._id
        ? { _id: world.stored._id }
        : null;
    },
    findOneUpdatableById: async (query: {
      props: DatabaseCommonInteractionProps;
    }): Promise<unknown> => {
      const userId: string = query.props.userId?.toString() || "";
      return world.editors.has(userId) ? { _id: world.stored._id } : null;
    },
    getUnwrittenByIdError: async (): Promise<Error> => {
      return new NotAuthorizedException("You cannot edit this public note.");
    },
    findOneById: async (): Promise<unknown> => {
      if (world.staleNote) {
        const stale: StoredNote = world.staleNote;
        world.staleNote = null;
        return { ...stale };
      }

      return snapshot();
    },
    updateOneBy: async (update: {
      query: { _id: string; version: number };
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      // Written as OneUptime, with no hooks, at the version it was read at.
      expect(update.props).toEqual({ isRoot: true, ignoreHooks: true });

      if (
        update.query._id !== world.stored._id ||
        update.query.version !== world.stored.version
      ) {
        return 0;
      }

      world.writes.push(update.data);
      world.stored = {
        ...world.stored,
        ...(update.data as Partial<StoredNote>),
        version: world.stored.version + 1,
      };
      return 1;
    },
    onTriggerWorkflow: async (
      id: ObjectID,
      _projectId: ObjectID,
      trigger: string,
    ): Promise<void> => {
      world.workflows.push(`${trigger}:${id.toString()}`);
    },
  };
}

function host(): PublicNoteApprovalHost<IncidentPublicNote> {
  return {
    kind: PublicNoteKind.Incident,
    eventType: PublicNoteApprovalEventType.Incident,
    modelType: IncidentPublicNote,
    service: fakeService() as never,
    parentIdColumn: "incidentId",
    getRecord: async () => {
      return {
        label: "Incident INC-42",
        title: "Checkout is down",
        url: "https://oneuptime.example/incidents/i",
        notesUrl: "https://oneuptime.example/incidents/i/public-notes",
      };
    },
    addFeedItem: async (data: {
      markdown: { toString: () => string };
      userId?: ObjectID | undefined;
    }): Promise<void> => {
      world.feed.push({
        markdown: data.markdown.toString(),
        userId: data.userId?.toString(),
      });
    },
    announcePublished: async (data: {
      noteId: ObjectID;
      approvedByNames: Array<string>;
    }): Promise<void> => {
      world.published.push({
        noteId: data.noteId.toString(),
        approvedByNames: data.approvedByNames,
      });
    },
    announceEditPublished: async (data: {
      noteId: ObjectID;
      approvedByNames: Array<string>;
    }): Promise<void> => {
      world.editsPublished.push({
        noteId: data.noteId.toString(),
        approvedByNames: data.approvedByNames,
      });
    },
    getMessageIds: (parentId: ObjectID) => {
      return { incidentId: parentId };
    },
  };
}

async function decide(
  userId: string | undefined,
  decision: PublicNoteApprovalDecision,
  text?: string,
): Promise<PublicNoteApprovalOutcome> {
  return await PublicNoteApprovalEngine.decide({
    host: host(),
    noteId: NOTE_ID,
    decision,
    props: propsOf(userId),
    text,
  });
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal");
}

function storedRound(): PublicNoteApprovalRound {
  return PublicNoteApproval.readRound(world.stored.approval)!;
}

let steps: Array<PublicNoteApprovalStepRule>;
let isRequired: boolean;
// Each time the engine had the note's chat copies replaced (#6317).
let chatCopiesReplaced: Array<string>;

beforeEach(() => {
  world = {
    stored: heldNote(),
    readers: new Set([ALICE, BOB, CAROL, DAVE]),
    editors: new Set([ALICE, BOB, CAROL, DAVE]),
    writes: [],
    feed: [],
    published: [],
    editsPublished: [],
    workflows: [],
    asked: [],
    told: [],
    staleNote: null,
  };
  steps = [SUPPORT, LEGAL];
  isRequired = true;
  chatCopiesReplaced = [];

  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "replaceChatMessages",
  ).mockImplementation(((data: {
    kind: PublicNoteKind;
    projectId: ObjectID;
    noteId: ObjectID;
  }): void => {
    chatCopiesReplaced.push(
      `${data.kind}:${data.projectId.toString()}:${data.noteId.toString()}`,
    );
  }) as never);

  getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockImplementation(
    (async () => {
      return steps;
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockImplementation(
    (async () => {
      return isRequired;
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getUserTeamIds").mockResolvedValue(
    [],
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getTeamMemberIds").mockResolvedValue(
    {},
  );
  getJestSpyOn(TeamService, "findBy").mockResolvedValue([] as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "getUserNames",
  ).mockImplementation((async (ids: ReadonlyArray<string>) => {
    const names: Record<string, string> = {
      [ALICE]: "Alice",
      [BOB]: "Bob",
      [CAROL]: "Carol",
      [DAVE]: "Dave",
    };
    const found: Record<string, string> = {};
    for (const id of ids) {
      if (names[id]) {
        found[id] = names[id]!;
      }
    }
    return found;
  }) as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "askApprovers",
  ).mockImplementation((async (data: { userIds: ReadonlyArray<string> }) => {
    world.asked.push([...data.userIds]);
    return [];
  }) as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "tellSender",
  ).mockImplementation((async (data: {
    sentByUserId: string | undefined;
    isApproved: boolean;
    reason?: string | undefined;
  }) => {
    world.told.push({
      userId: data.sentByUserId,
      isApproved: data.isApproved,
      reason: data.reason,
    });
    return true;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a note approved step by step", () => {
  test("the first step's approval keeps it waiting, asks the next step, and publishes nothing", async () => {
    const outcome: PublicNoteApprovalOutcome = await decide(
      BOB,
      PublicNoteApprovalDecision.Approve,
    );

    expect(outcome).toEqual({
      noteId: NOTE_ID.toString(),
      state: PublicNoteApprovalState.WaitingForApproval,
      isPublished: false,
    });
    expect(world.stored.isPublished).toBe(false);
    expect(world.stored.approvalStatus).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    expect(
      storedRound().approvals.map(
        (given: { userId: string; stepId: string }) => {
          return [given.stepId, given.userId];
        },
      ),
    ).toEqual([["s1", BOB]]);

    // The incident's feed says so, and Legal is asked.
    expect(world.feed).toHaveLength(1);
    expect(world.feed[0]!.markdown).toContain(
      "approved a **public note** on [Incident INC-42](https://oneuptime.example/incidents/i) for step 1 of 2 (Support).",
    );
    expect(world.feed[0]!.markdown).toContain(
      "It waits for step 2 of 2 (Legal): Carol.",
    );
    expect(world.feed[0]!.userId).toBe(BOB);
    expect(world.asked).toEqual([[CAROL]]);

    // Nothing of a published note yet.
    expect(world.published).toEqual([]);
    expect(world.workflows).toEqual([]);
    expect(world.told).toEqual([]);
  });

  test("the last step's approval publishes it, once: its entry, its workflows, its sender told", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Approve);
    world.feed = [];

    const outcome: PublicNoteApprovalOutcome = await decide(
      CAROL,
      PublicNoteApprovalDecision.Approve,
      "Fine by legal.",
    );

    expect(outcome).toEqual({
      noteId: NOTE_ID.toString(),
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    });
    expect(world.stored.isPublished).toBe(true);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Approved);
    // Filed as posted now: the time it reached status pages.
    expect(world.stored.postedAt).toBeInstanceOf(Date);
    expect(storedRound().publishedAt).toBeDefined();

    expect(
      world.feed.map((entry: { markdown: string }) => {
        return entry.markdown;
      }),
    ).toEqual([
      "✅ approved a **public note** on [Incident INC-42](https://oneuptime.example/incidents/i). It is now published on status pages.",
    ]);
    expect(world.published).toEqual([
      { noteId: NOTE_ID.toString(), approvedByNames: ["Bob", "Carol"] },
    ]);
    expect(world.workflows).toEqual([`on-create:${NOTE_ID.toString()}`]);
    expect(world.told).toEqual([
      { userId: ALICE, isApproved: true, reason: undefined },
    ]);
  });

  test("a second approver deciding at the same moment is told it was decided meanwhile, and nothing happens twice", async () => {
    steps = [{ ...SUPPORT, userIds: [BOB, DAVE] }];
    // Both read the note at version 1; Bob's write lands first.
    const asBothRead: StoredNote = snapshot();

    await decide(BOB, PublicNoteApprovalDecision.Approve);

    // Dave read the note as it was before Bob's write.
    world.staleNote = asBothRead;
    const refusal: Error = await refusalOf(() => {
      return decide(DAVE, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(PublicNoteApprovalMessages.decidedMeanwhile);
    expect(world.writes).toHaveLength(1);
    expect(world.published).toHaveLength(1);
    expect(world.workflows).toHaveLength(1);
    expect(world.told).toHaveLength(1);
  });

  test("an approval of a note already published is refused", async () => {
    steps = [SUPPORT];
    await decide(BOB, PublicNoteApprovalDecision.Approve);

    const refusal: Error = await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.notWaiting);
    expect(world.published).toHaveLength(1);
  });
});

describe("who may decide", () => {
  test("only a signed-in person", async () => {
    const refusal: Error = await refusalOf(() => {
      return decide(undefined, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal.message).toBe(PublicNoteApprovalMessages.notAPerson);
    expect(world.writes).toEqual([]);
  });

  test("not the person who sent it", async () => {
    steps = [{ ...SUPPORT, userIds: [ALICE, BOB] }];

    const refusal: Error = await refusalOf(() => {
      return decide(ALICE, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.sentByYou);
    expect(world.writes).toEqual([]);
  });

  test("not someone the step it waits for does not name", async () => {
    for (const userId of [DAVE, CAROL]) {
      const refusal: Error = await refusalOf(() => {
        return decide(userId, PublicNoteApprovalDecision.Approve);
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toContain("Support");
    }

    expect(world.writes).toEqual([]);
  });

  test("someone on a team the step names, now", async () => {
    const TEAM: string = "e6e6e6e6-0000-4000-8000-000000000006";
    steps = [{ ...SUPPORT, userIds: [], teamIds: [TEAM] }];
    getJestSpyOn(PublicNoteApprovalPolicy, "getUserTeamIds").mockResolvedValue([
      TEAM,
    ]);

    await expect(
      decide(DAVE, PublicNoteApprovalDecision.Approve),
    ).resolves.toMatchObject({ isPublished: true });
  });

  test("not who approved an earlier step of it, for a later one", async () => {
    steps = [SUPPORT, { ...LEGAL, userIds: [BOB, CAROL] }];

    await decide(BOB, PublicNoteApprovalDecision.Approve);

    const refusal: Error = await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal.message).toBe(
      PublicNoteApprovalMessages.approvedEarlierStep,
    );
  });

  test("a person who cannot read the note does not find it", async () => {
    world.readers.delete(BOB);

    const refusal: Error = await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(world.writes).toEqual([]);
  });

  test("a note of another project is not found", async () => {
    world.stored = heldNote({
      projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
    });

    const refusal: Error = await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal).toBeInstanceOf(NotFoundException);
  });

  test("a project with no steps holds its notes, and nobody can approve them", async () => {
    steps = [];

    const refusal: Error = await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Approve);
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.noSteps);
  });
});

describe("a note rejected", () => {
  test("takes a reason", async () => {
    for (const text of [undefined, "", "   "]) {
      const refusal: Error = await refusalOf(() => {
        return decide(BOB, PublicNoteApprovalDecision.Reject, text);
      });

      expect(refusal.message).toBe(PublicNoteApprovalMessages.reasonRequired);
    }

    expect(world.writes).toEqual([]);
  });

  test("is not published; its feed and its sender have the reason", async () => {
    const outcome: PublicNoteApprovalOutcome = await decide(
      BOB,
      PublicNoteApprovalDecision.Reject,
      "Do not name the vendor.",
    );

    expect(outcome).toEqual({
      noteId: NOTE_ID.toString(),
      state: PublicNoteApprovalState.Rejected,
      isPublished: false,
    });
    expect(world.stored.isPublished).toBe(false);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
    expect(storedRound().rejection).toMatchObject({
      userId: BOB,
      stepId: "s1",
      reason: "Do not name the vendor.",
    });
    expect(world.feed[0]!.markdown).toContain(
      "rejected a **public note** on [Incident INC-42](https://oneuptime.example/incidents/i). It is not published.",
    );
    expect(world.feed[0]!.markdown).toContain("Do not name the vendor.");
    expect(world.told).toEqual([
      { userId: ALICE, isApproved: false, reason: "Do not name the vendor." },
    ]);
    expect(world.published).toEqual([]);
    expect(world.workflows).toEqual([]);
  });

  test("sent for approval again, it starts over from the first step", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Approve);
    await decide(CAROL, PublicNoteApprovalDecision.Reject, "Wording.");
    world.feed = [];
    world.asked = [];

    const outcome: PublicNoteApprovalOutcome =
      await PublicNoteApprovalEngine.resubmit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });

    expect(outcome.state).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(world.stored.approvalStatus).toBe(
      PublicNoteApprovalStatus.WaitingForApproval,
    );
    expect(storedRound().approvals).toEqual([]);
    expect(storedRound().rejection).toBeUndefined();
    expect(world.feed[0]!.markdown).toContain("for approval again.");
    expect(world.feed[0]!.markdown).toContain(
      "It waits for step 1 of 2 (Support): Bob.",
    );
    expect(world.asked).toEqual([[BOB]]);
    expect(world.published).toEqual([]);
  });

  test("a note still waiting is not sent again", async () => {
    const refusal: Error = await refusalOf(() => {
      return PublicNoteApprovalEngine.resubmit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.stillWaiting);
  });

  test("only someone who may edit the note sends it again", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Reject, "Wording.");
    world.editors.delete(DAVE);

    const refusal: Error = await refusalOf(() => {
      return PublicNoteApprovalEngine.resubmit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(DAVE),
      });
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Rejected);
  });
});

describe("approval turned off while a note waits", () => {
  test("its editor publishes it, unapproved, and the feed says so; it is announced once", async () => {
    isRequired = false;

    const outcome: PublicNoteApprovalOutcome =
      await PublicNoteApprovalEngine.resubmit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });

    expect(outcome).toEqual({
      noteId: NOTE_ID.toString(),
      state: PublicNoteApprovalState.Published,
      isPublished: true,
    });
    expect(world.stored.isPublished).toBe(true);
    // Nobody approved it: it carries no approval.
    expect(world.stored.approvalStatus).toBeNull();
    expect(world.stored.approval).toBeNull();
    expect(world.feed[0]!.markdown).toContain(
      "Public notes no longer need approval, so it was not approved.",
    );
    expect(world.published).toEqual([
      { noteId: NOTE_ID.toString(), approvedByNames: [] },
    ]);
    expect(world.workflows).toEqual([`on-create:${NOTE_ID.toString()}`]);
  });
});

describe("an edit of a published note", () => {
  function editWaiting(notifySubscribersOfEdit: boolean): StoredNote {
    const approved: PublicNoteApprovalRound = PublicNoteApproval.startRound({
      now: new Date("2026-11-07T08:00:00.000Z"),
      submittedByUserId: ALICE,
      isEdit: false,
    });

    return heldNote({
      isPublished: true,
      note: "We are looking into it.",
      pendingNote: "We found the cause.",
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T09:00:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: true,
          notifySubscribersOfEdit,
          before: {
            status: PublicNoteApprovalStatus.Approved,
            round: approved,
          },
        }),
      ),
    });
  }

  test("approved, it takes the note's place, its update notification queued as asked, announced as an edit", async () => {
    steps = [SUPPORT];
    world.stored = editWaiting(true);

    const outcome: PublicNoteApprovalOutcome = await decide(
      BOB,
      PublicNoteApprovalDecision.Approve,
    );

    expect(outcome.state).toBe(PublicNoteApprovalState.Published);
    expect(world.stored.note).toBe("We found the cause.");
    expect(world.stored.pendingNote).toBeNull();
    expect(world.stored.subscriberNotificationStatusOnNoteUpdated).toBe(
      "Pending",
    );
    expect(world.editsPublished).toEqual([
      { noteId: NOTE_ID.toString(), approvedByNames: ["Bob"] },
    ]);
    // Not a new note: no second "posted", no On Create.
    expect(world.published).toEqual([]);
    expect(world.workflows).toEqual([]);
  });

  test("rejected, status pages keep the note as it was approved", async () => {
    steps = [SUPPORT];
    world.stored = editWaiting(false);

    const outcome: PublicNoteApprovalOutcome = await decide(
      BOB,
      PublicNoteApprovalDecision.Reject,
      "Too early to say.",
    );

    expect(outcome).toEqual({
      noteId: NOTE_ID.toString(),
      state: PublicNoteApprovalState.EditRejected,
      isPublished: true,
    });
    expect(world.stored.note).toBe("We are looking into it.");
    expect(world.stored.pendingNote).toBe("We found the cause.");
    expect(world.stored.isPublished).toBe(true);
    expect(world.editsPublished).toEqual([]);
  });

  test("withdrawn, the note's approval goes back to how it stood", async () => {
    world.stored = editWaiting(false);

    const outcome: PublicNoteApprovalOutcome =
      await PublicNoteApprovalEngine.discardEdit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });

    expect(outcome.state).toBe(PublicNoteApprovalState.Published);
    expect(world.stored.pendingNote).toBeNull();
    expect(world.stored.approvalStatus).toBe(PublicNoteApprovalStatus.Approved);
    expect(world.stored.note).toBe("We are looking into it.");
    expect(world.feed[0]!.markdown).toContain(
      "withdrew the waiting edit of a **public note**",
    );
    expect(world.editsPublished).toEqual([]);
  });

  test("there is nothing to withdraw on a note with no edit waiting", async () => {
    const refusal: Error = await refusalOf(() => {
      return PublicNoteApprovalEngine.discardEdit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.noEditWaiting);
    expect(world.writes).toEqual([]);
  });
});

/*
 * THE CHAT COPIES OF ITS APPROVAL MESSAGE (#6317). Every write that decides
 * on a note, sends it again or withdraws its edit has the chat copies of its
 * approval message replaced - once, for that note of that project - and a
 * decision refused, or lost to one made a moment before, has none replaced:
 * nothing changed.
 */
describe("the chat copies of its approval message", () => {
  const THIS_NOTE: string = `${PublicNoteKind.Incident}:${PROJECT_ID.toString()}:${NOTE_ID.toString()}`;

  test("a step approved: replaced once", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Approve);

    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("approved and published: replaced once for each decision", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Approve);
    await decide(CAROL, PublicNoteApprovalDecision.Approve);

    expect(world.stored.isPublished).toBe(true);
    expect(chatCopiesReplaced).toEqual([THIS_NOTE, THIS_NOTE]);
  });

  test("rejected: replaced once", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Reject, "Not yet.");

    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("rejected and sent again: replaced for each", async () => {
    await decide(BOB, PublicNoteApprovalDecision.Reject, "Not yet.");
    await PublicNoteApprovalEngine.resubmit({
      host: host(),
      noteId: NOTE_ID,
      props: propsOf(ALICE),
    });

    expect(chatCopiesReplaced).toEqual([THIS_NOTE, THIS_NOTE]);
  });

  test("published without approval once approval was turned off: replaced once", async () => {
    isRequired = false;

    await PublicNoteApprovalEngine.resubmit({
      host: host(),
      noteId: NOTE_ID,
      props: propsOf(ALICE),
    });

    expect(world.stored.isPublished).toBe(true);
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("an edit withdrawn: replaced once", async () => {
    const approved: PublicNoteApprovalRound = PublicNoteApproval.startRound({
      now: new Date("2026-11-07T08:00:00.000Z"),
      submittedByUserId: ALICE,
      isEdit: false,
    });

    world.stored = heldNote({
      isPublished: true,
      pendingNote: "We found the cause.",
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: new Date("2026-11-07T09:00:00.000Z"),
          submittedByUserId: ALICE,
          isEdit: true,
          before: {
            status: PublicNoteApprovalStatus.Approved,
            round: approved,
          },
        }),
      ),
    });

    await PublicNoteApprovalEngine.discardEdit({
      host: host(),
      noteId: NOTE_ID,
      props: propsOf(ALICE),
    });

    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("a decision refused - not an approver, the sender, no reason - replaces nothing", async () => {
    await refusalOf(() => {
      return decide(DAVE, PublicNoteApprovalDecision.Approve);
    });
    await refusalOf(() => {
      return decide(ALICE, PublicNoteApprovalDecision.Approve);
    });
    await refusalOf(() => {
      return decide(BOB, PublicNoteApprovalDecision.Reject, " ");
    });

    expect(world.writes).toEqual([]);
    expect(chatCopiesReplaced).toEqual([]);
  });

  test("a decision lost to one made a moment before replaces nothing more", async () => {
    steps = [{ ...SUPPORT, userIds: [BOB, DAVE] }];
    const asBothRead: StoredNote = snapshot();

    await decide(BOB, PublicNoteApprovalDecision.Approve);

    world.staleNote = asBothRead;
    await refusalOf(() => {
      return decide(DAVE, PublicNoteApprovalDecision.Approve);
    });

    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("a note still waiting, sent again, is refused and replaces nothing", async () => {
    await refusalOf(() => {
      return PublicNoteApprovalEngine.resubmit({
        host: host(),
        noteId: NOTE_ID,
        props: propsOf(ALICE),
      });
    });

    expect(chatCopiesReplaced).toEqual([]);
  });

  test("replacing never holds back the decision: it is not awaited, and a failure to start it is never thrown", async () => {
    getJestSpyOn(
      PublicNoteApprovalNotifications,
      "replaceChatMessages",
    ).mockImplementation((() => {
      // A pass that never ends would hold back an awaited decision for good.
      return new Promise<void>((): void => {});
    }) as never);

    const outcome: PublicNoteApprovalOutcome = await decide(
      BOB,
      PublicNoteApprovalDecision.Approve,
    );

    expect(outcome.state).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(storedRound().approvals).toHaveLength(1);
  });
});
