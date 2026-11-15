import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import TeamService from "../../../../Server/Services/TeamService";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteApprovalUpdate,
  PublicNoteKind,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
import SubscriberUpdateNotification from "../../../../Types/StatusPage/SubscriberUpdateNotification";
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
 * EDITING A PUBLIC NOTE WHILE APPROVAL GOVERNS IT (issue #5720).
 *
 * PublicNoteApprovalEngine.beforeUpdate works out what an edit writes to a
 * note's approval from the note as it reads it: a waiting note is sent for
 * approval again, a published note's edit waits in pendingNote, an edit
 * back to the published text drops the one waiting. A decision can land
 * between that read and the edit's write - the last approval publishing
 * the note, a rejection - and an edit written over it would put the edit
 * on status pages unapproved, reading as an edit that waits with no text.
 * So the edit reads the very notes it writes (findRowsAndHoldUpdateToThem),
 * is written only while each is at the version it was read at, and an edit
 * that wrote nothing tells its author the note changed meanwhile.
 *
 * The notes are held in memory; the edit is written as DatabaseService
 * writes an update whose query names a version (a compare-and-set), and a
 * decision as the engine writes one (writeOnce, at the version it read).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOTE_ID: string = "44444444-4444-4444-8444-444444444444";
const SECOND_NOTE_ID: string = "55555555-5555-4555-8555-555555555555";
const THIRD_NOTE_ID: string = "66666666-6666-4666-8666-666666666666";
const FILE_ID: string = "77777777-7777-4777-8777-777777777777";
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001"; // writes notes
const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002"; // approves them

const APPROVED_TEXT: string = "We are looking into it.";
const NEW_TEXT: string = "We found the cause: a database failover.";

const SUPPORT: PublicNoteApprovalStepRule = {
  id: "s1",
  name: "Support",
  order: 1,
  userIds: [BOB],
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
  createdByUserId: ObjectID;
  attachments: Array<{ _id: string }>;
}

interface World {
  notes: Array<StoredNote>;
  // The query of each update whose rows approval read and held it to.
  holds: Array<JSONObject>;
  feed: Array<string>;
  asked: Array<Array<string>>;
  published: Array<string>;
  // Whether each project asks for approval, by project id.
  isRequired: Record<string, boolean>;
  isRequiredAsked: Array<string>;
  // The note as the next read finds it: as it was before a write that landed first.
  staleRead: StoredNote | null;
}

let world: World;

// Each time an edit had a note's chat copies replaced (#6317).
let chatCopiesReplaced: Array<string>;

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

// A note waiting for its first approval.
function waitingNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    _id: NOTE_ID,
    version: 4,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    note: APPROVED_TEXT,
    pendingNote: null,
    isPublished: false,
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: round(),
    createdByUserId: new ObjectID(ALICE),
    attachments: [],
    ...overrides,
  };
}

// A note on status pages, published before approval existed.
function publishedNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return waitingNote({
    isPublished: true,
    approvalStatus: null,
    approval: null,
    ...overrides,
  });
}

// A published note with an edit of it waiting for approval.
function publishedWithWaitingEdit(): StoredNote {
  return publishedNote({
    pendingNote: "We are rolling back the deploy.",
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: round({
      isEdit: true,
      before: { status: null, round: null },
    }),
  });
}

function stored(id: string = NOTE_ID): StoredNote {
  return world.notes.find((note: StoredNote): boolean => {
    return note._id === id;
  })!;
}

function copyOf(note: StoredNote): StoredNote {
  return { ...note, attachments: [...note.attachments] };
}

// The notes an update's query names: by its _id, or every note.
function namedBy(query: Record<string, unknown>): Array<StoredNote> {
  const id: unknown = query["_id"];

  return world.notes.filter((note: StoredNote): boolean => {
    return id === undefined || note._id === String(id);
  });
}

function propsOf(userId: string): DatabaseCommonInteractionProps {
  return { userId: new ObjectID(userId), tenantId: PROJECT_ID };
}

function fakeService(): unknown {
  return {
    // The rows the update writes, read as the update path reads them.
    findRowsAndHoldUpdateToThem: async (
      updateBy: UpdateBy<IncidentPublicNote>,
    ): Promise<Array<StoredNote>> => {
      world.holds.push({ ...(updateBy.query as JSONObject) });
      return namedBy(updateBy.query as Record<string, unknown>).map(copyOf);
    },
    findBy: async (): Promise<never> => {
      throw new Error(
        "An update's notes are read with findRowsAndHoldUpdateToThem, never by its query.",
      );
    },
    findOneById: async (read: { id: ObjectID }): Promise<unknown> => {
      if (world.staleRead) {
        const stale: StoredNote = world.staleRead;
        world.staleRead = null;
        return copyOf(stale);
      }

      const note: StoredNote | undefined = world.notes.find(
        (candidate: StoredNote): boolean => {
          return candidate._id === read.id.toString();
        },
      );
      return note ? copyOf(note) : null;
    },
    findOneBy: async (read: { query: { _id: string } }): Promise<unknown> => {
      return namedBy(read.query).length > 0 ? { _id: read.query._id } : null;
    },
    // A decision's write: as OneUptime, only at the version it was read at.
    updateOneBy: async (update: {
      query: { _id: string; version: number };
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      expect(update.props).toEqual({ isRoot: true, ignoreHooks: true });

      const note: StoredNote | undefined = namedBy(update.query)[0];

      if (!note || note.version !== update.query.version) {
        return 0;
      }

      Object.assign(note, update.data, { version: note.version + 1 });
      return 1;
    },
    onTriggerWorkflow: async (): Promise<void> => {},
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
    }): Promise<void> => {
      world.feed.push(data.markdown.toString());
    },
    announcePublished: async (data: { noteId: ObjectID }): Promise<void> => {
      world.published.push(data.noteId.toString());
    },
    announceEditPublished: async (data: {
      noteId: ObjectID;
    }): Promise<void> => {
      world.published.push(`edit:${data.noteId.toString()}`);
    },
    getMessageIds: (parentId: ObjectID) => {
      return { incidentId: parentId };
    },
  };
}

function editOf(
  data: Record<string, unknown>,
  options: {
    by?: string;
    query?: JSONObject;
    notifySubscribers?: boolean;
  } = {},
): UpdateBy<IncidentPublicNote> {
  return {
    query: (options.query || { _id: NOTE_ID }) as never,
    data: { ...data } as never,
    props: propsOf(options.by || ALICE),
    miscDataProps: options.notifySubscribers
      ? SubscriberUpdateNotification.getMiscDataProps()
      : {},
    limit: 1,
    skip: 0,
  };
}

/*
 * The edit's write, as DatabaseService makes it once the hooks have run:
 * every note its query still names - at the version the query names, when
 * it names one, asked again in the UPDATE itself. The ids written, as
 * onUpdateSuccess is handed them.
 */
function writeEdit(updateBy: UpdateBy<IncidentPublicNote>): Array<ObjectID> {
  const query: Record<string, unknown> = updateBy.query as Record<
    string,
    unknown
  >;
  const version: unknown = query["version"];
  const written: Array<ObjectID> = [];

  for (const note of namedBy(query)) {
    if (typeof version === "number" && note.version !== version) {
      continue;
    }

    Object.assign(note, updateBy.data, { version: note.version + 1 });
    written.push(new ObjectID(note._id));
  }

  return written;
}

interface EditRun {
  update: PublicNoteApprovalUpdate;
  written: Array<ObjectID>;
  handled: boolean;
}

/*
 * An edit from its note service's hooks to its write: beforeUpdate, then
 * whatever lands in between (`meanwhile`), the write, and afterUpdate.
 */
async function runEdit(
  updateBy: UpdateBy<IncidentPublicNote>,
  meanwhile?: () => Promise<void>,
): Promise<EditRun> {
  const update: PublicNoteApprovalUpdate =
    await PublicNoteApprovalEngine.beforeUpdate({
      host: host(),
      updateBy: updateBy,
    });

  if (meanwhile) {
    await meanwhile();
  }

  const written: Array<ObjectID> = writeEdit(updateBy);

  const handled: boolean = await PublicNoteApprovalEngine.afterUpdate({
    host: host(),
    update:
      PublicNoteApprovalEngine.getCarryForward(update)?.publicNoteApproval,
    updatedNoteIds: written,
    props: updateBy.props,
  });

  return { update, written, handled };
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal");
}

async function decide(
  decision: PublicNoteApprovalDecision,
  text?: string,
): Promise<void> {
  await PublicNoteApprovalEngine.decide({
    host: host(),
    noteId: new ObjectID(NOTE_ID),
    decision,
    props: propsOf(BOB),
    text,
  });
}

function stateOf(note: StoredNote): PublicNoteApprovalState {
  return PublicNoteApproval.getState(note);
}

function queryOf(updateBy: UpdateBy<IncidentPublicNote>): JSONObject {
  return updateBy.query as JSONObject;
}

beforeEach(() => {
  world = {
    notes: [waitingNote()],
    holds: [],
    feed: [],
    asked: [],
    published: [],
    isRequired: { [PROJECT_ID.toString()]: true },
    isRequiredAsked: [],
    staleRead: null,
  };

  getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockResolvedValue([
    SUPPORT,
  ]);
  getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockImplementation(
    (async (data: { projectId: ObjectID }) => {
      world.isRequiredAsked.push(data.projectId.toString());
      return world.isRequired[data.projectId.toString()] === true;
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
  ).mockResolvedValue({ [ALICE]: "Alice", [BOB]: "Bob" });
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "askApprovers",
  ).mockImplementation((async (data: { userIds: ReadonlyArray<string> }) => {
    world.asked.push([...data.userIds]);
    return [];
  }) as never);
  getJestSpyOn(PublicNoteApprovalNotifications, "tellSender").mockResolvedValue(
    true as never,
  );
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the notes an edit writes", () => {
  test("are read as the update writes them, with the update held to them - never by its query", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({ note: NEW_TEXT });

    await runEdit(updateBy);

    expect(world.holds).toEqual([{ _id: NOTE_ID }]);
  });

  test("are judged every one: an update of three notes that names a waiting one third is refused", async () => {
    // Approval is off, and the two notes read first are published.
    world.isRequired = {};
    world.notes = [
      publishedNote({ _id: NOTE_ID }),
      publishedNote({ _id: SECOND_NOTE_ID }),
      waitingNote({ _id: THIRD_NOTE_ID }),
    ];

    const updateBy: UpdateBy<IncidentPublicNote> = editOf(
      { note: NEW_TEXT },
      { query: {} },
    );
    const refusal: Error = await refusalOf(() => {
      return runEdit(updateBy);
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(PublicNoteApprovalMessages.oneNoteAtATime);
    // Nothing written: the waiting note keeps its words.
    expect(stored(THIRD_NOTE_ID).note).toBe(APPROVED_TEXT);
  });

  test("are governed when any one's project asks for approval, each project asked once", async () => {
    world.isRequired = { [OTHER_PROJECT_ID.toString()]: true };
    world.notes = [
      publishedNote({ _id: NOTE_ID }),
      publishedNote({ _id: SECOND_NOTE_ID }),
      publishedNote({ _id: THIRD_NOTE_ID, projectId: OTHER_PROJECT_ID }),
    ];

    const refusal: Error = await refusalOf(() => {
      return runEdit(editOf({ note: NEW_TEXT }, { query: {} }));
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.oneNoteAtATime);
    expect(world.isRequiredAsked).toEqual([
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ]);
  });

  test("approval leaves alone, and holds to no version, when it governs none of them", async () => {
    world.isRequired = {};
    world.notes = [
      publishedNote({ _id: NOTE_ID }),
      publishedNote({ _id: SECOND_NOTE_ID }),
    ];

    const updateBy: UpdateBy<IncidentPublicNote> = editOf(
      { note: NEW_TEXT },
      { query: {} },
    );
    const run: EditRun = await runEdit(updateBy);

    expect(queryOf(updateBy)["version"]).toBeUndefined();
    expect(run.written).toHaveLength(2);
    expect(run.handled).toBe(false);
    expect(PublicNoteApprovalEngine.getCarryForward(run.update)).toBeNull();
    expect(stored(NOTE_ID).note).toBe(NEW_TEXT);
    expect(stored(SECOND_NOTE_ID).note).toBe(NEW_TEXT);
  });

  test("an approval column sent by the caller is refused before anything is read", async () => {
    for (const column of [
      "isPublished",
      "approvalStatus",
      "approval",
      "pendingNote",
    ]) {
      const refusal: Error = await refusalOf(() => {
        return runEdit(editOf({ note: NEW_TEXT, [column]: null }));
      });

      expect(refusal.message).toBe(
        PublicNoteApprovalMessages.writtenByOneUptime(column),
      );
    }

    expect(world.holds).toEqual([]);
  });
});

describe("an edit of a note waiting for approval", () => {
  test("sends it for approval again, held to the version it was read at", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({ note: NEW_TEXT });

    const run: EditRun = await runEdit(updateBy);

    expect(run.update.resentNoteIds).toEqual([NOTE_ID]);
    expect(queryOf(updateBy)).toEqual({ _id: NOTE_ID, version: 4 });
    expect(run.written.map(String)).toEqual([NOTE_ID]);
    expect(run.handled).toBe(true);

    const note: StoredNote = stored();
    expect(note.note).toBe(NEW_TEXT);
    expect(note.isPublished).toBe(false);
    expect(stateOf(note)).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(PublicNoteApproval.readRound(note.approval)).toMatchObject({
      submittedByUserId: ALICE,
      isEdit: false,
      approvals: [],
    });

    // Its feed says it was sent again, and its approver is asked.
    expect(world.feed).toHaveLength(1);
    expect(world.asked).toEqual([[BOB]]);
  });

  test("its files changed send it again too, held the same way", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({
      attachments: [{ _id: FILE_ID }],
    });

    const run: EditRun = await runEdit(updateBy);

    expect(run.update.resentNoteIds).toEqual([NOTE_ID]);
    expect(queryOf(updateBy)["version"]).toBe(4);
    expect(stored().attachments).toEqual([{ _id: FILE_ID }]);
  });

  test("written back as it is, it is neither sent again nor held to a version", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf(
      { note: APPROVED_TEXT },
      { notifySubscribers: true },
    );

    const run: EditRun = await runEdit(updateBy);

    expect(run.update).toEqual({
      heldEditNoteIds: [],
      resentNoteIds: [],
      droppedEditNoteIds: [],
      // It tells subscribers nothing: it is not published.
      isUpdateNotificationHeld: true,
    });
    expect(queryOf(updateBy)["version"]).toBeUndefined();
    expect(run.handled).toBe(false);
    expect(world.feed).toEqual([]);
  });

  test("the last approval landing first stands: the edit writes nothing, and its author is told to look again", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({ note: NEW_TEXT });

    const refusal: Error = await refusalOf(() => {
      return runEdit(updateBy, async (): Promise<void> => {
        // Bob approves the note while Alice's edit is on its way.
        await decide(PublicNoteApprovalDecision.Approve);
      });
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(PublicNoteApprovalMessages.changedMeanwhile);

    // The note is published as Bob approved it, and stays so.
    const note: StoredNote = stored();
    expect(note.isPublished).toBe(true);
    expect(note.note).toBe(APPROVED_TEXT);
    expect(note.pendingNote).toBeNull();
    expect(note.approvalStatus).toBe(PublicNoteApprovalStatus.Approved);
    expect(stateOf(note)).toBe(PublicNoteApprovalState.Published);

    // Announced once, by the approval; the edit asked nobody and said nothing.
    expect(world.published).toEqual([NOTE_ID]);
    expect(world.asked).toEqual([]);
  });

  test("a rejection landing first stands too", async () => {
    const refusal: Error = await refusalOf(() => {
      return runEdit(editOf({ note: NEW_TEXT }), async (): Promise<void> => {
        await decide(
          PublicNoteApprovalDecision.Reject,
          "Do not name the vendor.",
        );
      });
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.changedMeanwhile);

    const note: StoredNote = stored();
    expect(stateOf(note)).toBe(PublicNoteApprovalState.Rejected);
    expect(note.note).toBe(APPROVED_TEXT);
    expect(PublicNoteApproval.readRound(note.approval)?.rejection?.reason).toBe(
      "Do not name the vendor.",
    );
  });

  test("an edit that lands first stands, and an approval of the note as it was before is told it was decided meanwhile", async () => {
    const beforeTheEdit: StoredNote = copyOf(stored());

    await runEdit(editOf({ note: NEW_TEXT }));

    // Bob read the note before Alice's edit was written, and approves that.
    world.staleRead = beforeTheEdit;
    const refusal: Error = await refusalOf(() => {
      return decide(PublicNoteApprovalDecision.Approve);
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.decidedMeanwhile);

    // Alice's words wait for approval; nothing was published.
    const note: StoredNote = stored();
    expect(note.note).toBe(NEW_TEXT);
    expect(note.isPublished).toBe(false);
    expect(stateOf(note)).toBe(PublicNoteApprovalState.WaitingForApproval);
    expect(world.published).toEqual([]);
  });
});

describe("an edit of a published note, while public notes need approval", () => {
  beforeEach(() => {
    world.notes = [publishedNote()];
  });

  test("waits in pendingNote, held to the version it was read at; status pages keep the approved text", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({ note: NEW_TEXT });

    const run: EditRun = await runEdit(updateBy);

    expect(run.update.heldEditNoteIds).toEqual([NOTE_ID]);
    expect(queryOf(updateBy)["version"]).toBe(4);
    expect((updateBy.data as Record<string, unknown>)["note"]).toBeUndefined();
    expect(run.handled).toBe(true);

    const note: StoredNote = stored();
    expect(note.note).toBe(APPROVED_TEXT);
    expect(note.pendingNote).toBe(NEW_TEXT);
    expect(stateOf(note)).toBe(PublicNoteApprovalState.EditWaitingForApproval);
    expect(world.asked).toEqual([[BOB]]);
  });

  test("an approval of the edit already waiting, landing first, stands: the new edit writes nothing", async () => {
    world.notes = [publishedWithWaitingEdit()];

    const refusal: Error = await refusalOf(() => {
      return runEdit(editOf({ note: NEW_TEXT }), async (): Promise<void> => {
        await decide(PublicNoteApprovalDecision.Approve);
      });
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.changedMeanwhile);

    // The edit Bob approved is on status pages, and nothing waits.
    const note: StoredNote = stored();
    expect(note.note).toBe("We are rolling back the deploy.");
    expect(note.pendingNote).toBeNull();
    expect(stateOf(note)).toBe(PublicNoteApprovalState.Published);
    expect(world.published).toEqual([`edit:${NOTE_ID}`]);
  });

  test("written back to the published text, it drops the edit waiting, held the same way", async () => {
    world.notes = [publishedWithWaitingEdit()];

    const updateBy: UpdateBy<IncidentPublicNote> = editOf({
      note: APPROVED_TEXT,
    });

    const run: EditRun = await runEdit(updateBy);

    expect(run.update.droppedEditNoteIds).toEqual([NOTE_ID]);
    expect(queryOf(updateBy)["version"]).toBe(4);
    expect(run.handled).toBe(true);

    const note: StoredNote = stored();
    expect(note.pendingNote).toBeNull();
    expect(stateOf(note)).toBe(PublicNoteApprovalState.Published);
    // The incident's feed says the edit was withdrawn.
    expect(world.feed).toHaveLength(1);
  });

  test("its files cannot change, and nothing is held or written", async () => {
    const updateBy: UpdateBy<IncidentPublicNote> = editOf({
      attachments: [{ _id: FILE_ID }],
    });

    const refusal: Error = await refusalOf(() => {
      return runEdit(updateBy);
    });

    expect(refusal.message).toBe(
      PublicNoteApprovalMessages.attachmentsOfPublishedNote,
    );
    expect(queryOf(updateBy)["version"]).toBeUndefined();
    expect(stored().attachments).toEqual([]);
  });
});

describe("an edit of a published note once approval is off", () => {
  test("applies as it always has, held to no version", async () => {
    world.isRequired = {};
    world.notes = [publishedNote()];

    const updateBy: UpdateBy<IncidentPublicNote> = editOf({ note: NEW_TEXT });
    const run: EditRun = await runEdit(updateBy);

    expect(queryOf(updateBy)["version"]).toBeUndefined();
    expect(run.handled).toBe(false);
    expect(stored().note).toBe(NEW_TEXT);
  });
});

describe("PublicNoteApprovalEngine.afterUpdate", () => {
  function update(
    overrides: Partial<PublicNoteApprovalUpdate> = {},
  ): PublicNoteApprovalUpdate {
    return {
      heldEditNoteIds: [],
      resentNoteIds: [],
      droppedEditNoteIds: [],
      isUpdateNotificationHeld: false,
      ...overrides,
    };
  }

  test("an update approval did not touch says nothing", async () => {
    for (const nothing of [null, undefined]) {
      await expect(
        PublicNoteApprovalEngine.afterUpdate({
          host: host(),
          update: nothing,
          updatedNoteIds: [],
          props: propsOf(ALICE),
        }),
      ).resolves.toBe(false);
    }

    expect(PublicNoteApprovalEngine.getCarryForward(update())).toBeNull();
  });

  test("a note approval held the edit to, left unwritten, is reported and not announced", async () => {
    for (const held of [
      update({ heldEditNoteIds: [NOTE_ID] }),
      update({ resentNoteIds: [NOTE_ID] }),
      update({ droppedEditNoteIds: [NOTE_ID] }),
    ]) {
      const refusal: Error = await refusalOf(() => {
        return PublicNoteApprovalEngine.afterUpdate({
          host: host(),
          update: held,
          updatedNoteIds: [],
          props: propsOf(ALICE),
        });
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe(PublicNoteApprovalMessages.changedMeanwhile);
    }

    expect(world.feed).toEqual([]);
    expect(world.asked).toEqual([]);
  });

  test("a note written is known by its id, however its letters are cased", async () => {
    await expect(
      PublicNoteApprovalEngine.afterUpdate({
        host: host(),
        update: update({ resentNoteIds: [NOTE_ID.toUpperCase()] }),
        updatedNoteIds: [new ObjectID(NOTE_ID)],
        props: propsOf(ALICE),
      }),
    ).resolves.toBe(true);
  });
});

/*
 * THE CHAT COPIES OF ITS APPROVAL MESSAGE (#6317). An edit that ends the
 * round a note's approval messages asked about - sends it for approval
 * again, holds a new edit in place of one that waited, drops a waiting edit,
 * or lets an edit apply as it is over one that waited once approval is off
 * - has the chat copies replaced, once, for that note of its project. One
 * that ends nothing, or that a decision overtook, has none replaced.
 */
describe("an edit and the chat copies of its note's approval message", () => {
  const THIS_NOTE: string = `${PublicNoteKind.Incident}:${PROJECT_ID.toString()}:${new ObjectID(NOTE_ID).toString()}`;

  test("a waiting note edited, and sent for approval again: replaced once", async () => {
    const run: EditRun = await runEdit(editOf({ note: NEW_TEXT }));

    expect(run.update.resentNoteIds).toEqual([NOTE_ID]);
    expect(run.update.projectId).toBe(PROJECT_ID.toString());
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("a published note's waiting edit edited again: replaced once", async () => {
    world.notes = [publishedWithWaitingEdit()];

    const run: EditRun = await runEdit(editOf({ note: NEW_TEXT }));

    expect(run.update.heldEditNoteIds).toEqual([NOTE_ID]);
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("an edit back to the published text drops the waiting one: replaced once", async () => {
    world.notes = [publishedWithWaitingEdit()];

    const run: EditRun = await runEdit(editOf({ note: APPROVED_TEXT }));

    expect(run.update.droppedEditNoteIds).toEqual([NOTE_ID]);
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("approval off, an edit applies as it is over one that waited: the waiting edit's copies are replaced, and the edit is announced as any edit", async () => {
    world.isRequired = {};
    world.notes = [publishedWithWaitingEdit()];

    const run: EditRun = await runEdit(editOf({ note: NEW_TEXT }));

    expect(run.update.withdrawnEditNoteIds).toEqual([NOTE_ID]);
    expect(run.update.projectId).toBe(PROJECT_ID.toString());
    expect(run.handled).toBe(false);
    expect(stored().note).toBe(NEW_TEXT);
    expect(stored().pendingNote).toBeNull();
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });

  test("approval off, an edit of a published note with nothing waiting: nothing to replace, and nothing carried", async () => {
    world.isRequired = {};
    world.notes = [publishedNote()];

    const run: EditRun = await runEdit(editOf({ note: NEW_TEXT }));

    expect(PublicNoteApprovalEngine.getCarryForward(run.update)).toBeNull();
    expect(chatCopiesReplaced).toEqual([]);
  });

  test("written back as it is: nothing ends, and nothing is replaced", async () => {
    await runEdit(editOf({ note: APPROVED_TEXT }));

    expect(chatCopiesReplaced).toEqual([]);
  });

  test("an edit a decision overtook writes nothing, and replaces nothing", async () => {
    const refusal: Error = await refusalOf(() => {
      return runEdit(editOf({ note: NEW_TEXT }), async () => {
        await decide(PublicNoteApprovalDecision.Reject, "Not yet.");
      });
    });

    expect(refusal.message).toBe(PublicNoteApprovalMessages.changedMeanwhile);
    // The rejection's own, and not the edit's.
    expect(chatCopiesReplaced).toEqual([THIS_NOTE]);
  });
});
