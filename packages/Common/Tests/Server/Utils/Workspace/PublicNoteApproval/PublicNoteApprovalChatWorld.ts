import { expect, jest } from "@jest/globals";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import TeamService from "../../../../../Server/Services/TeamService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteKind,
} from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications from "../../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspacePublicNoteApproval, {
  PublicNoteApprovalButtonValue,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalEventType,
  PublicNoteApprovalPosition,
  PublicNoteApprovalRound,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../../Types/StatusPage/PublicNoteApproval";
import { getJestSpyOn } from "../../../../Spy";

/*
 * A PUBLIC NOTE DECIDED FROM CHAT (#6289), IN MEMORY.
 *
 * The real engine (PublicNoteApprovalEngine.decide) and the real press
 * logic (WorkspacePublicNoteApprovalActions) over one incident public note
 * held in memory, written only at the version it was read at - as the
 * database writes it - so two approvers pressing at once decide once. Who
 * may read the note, the steps, the teams and the names are the world's;
 * the rules and the words are the product's.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
export const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
export const NOTE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// Alice sends notes; Bob and Dave approve for Support, Carol for Legal; Eve approves nothing.
export const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
export const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002";
export const CAROL: string = "c3c3c3c3-0000-4000-8000-000000000003";
export const DAVE: string = "d4d4d4d4-0000-4000-8000-000000000004";
export const EVE: string = "e5e5e5e5-0000-4000-8000-000000000005";

export const NAMES: Record<string, string> = {
  [ALICE]: "Alice",
  [BOB]: "Bob",
  [CAROL]: "Carol",
  [DAVE]: "Dave",
  [EVE]: "Eve",
};

export const SUPPORT: PublicNoteApprovalStepRule = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Support",
  order: 1,
  userIds: [BOB, DAVE],
  teamIds: [],
};

export const LEGAL: PublicNoteApprovalStepRule = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Legal",
  order: 2,
  userIds: [CAROL],
  teamIds: [],
};

export const NOTES_URL: string =
  "https://oneuptime.example/dashboard/p/incidents/i/public-notes";

export const SUBMITTED_AT: string = "2026-11-07T09:00:00.000Z";

export const NOTE_TEXT: string = "We are looking into the checkout errors.";

export interface StoredNote {
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
  attachments: Array<unknown>;
}

export interface ChatWorld {
  stored: StoredNote;
  // The note is there at all (deleted: false).
  exists: boolean;
  // Who may read the note with their own permissions.
  readers: Set<string>;
  // Whose read of notes is refused outright: a role that may not read them.
  forbidden: Set<string>;
  steps: Array<PublicNoteApprovalStepRule>;
  isRequired: boolean;
  teams: Record<string, Array<string>>;
  writes: Array<Record<string, unknown>>;
  feed: Array<string>;
  published: Array<{ noteId: string; approvedByNames: Array<string> }>;
  workflows: Array<string>;
  asked: Array<Array<string>>;
  // What each ask handed the chat message: the note, round, step and finality.
  askedChat: Array<unknown>;
  told: Array<{ userId: string | undefined; isApproved: boolean }>;
  logged: Array<string>;
  /*
   * While set, every read of the note as OneUptime finds it as it was then:
   * a press that read it before somebody else's write landed. The next
   * write clears it, and is held to the version actually stored.
   */
  readsAsOf: StoredNote | null;
}

export let world: ChatWorld;

// A note sent for approval by Alice, waiting for its first step.
export function heldNote(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    _id: NOTE_ID.toString(),
    version: 1,
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    note: NOTE_TEXT,
    pendingNote: null,
    isPublished: false,
    approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
    approval: PublicNoteApproval.toJSON(
      PublicNoteApproval.startRound({
        now: new Date(SUBMITTED_AT),
        submittedByUserId: ALICE,
        isEdit: false,
      }),
    ),
    createdByUserId: new ObjectID(ALICE),
    attachments: [],
    ...overrides,
  };
}

export function storedRound(): PublicNoteApprovalRound {
  return PublicNoteApproval.readRound(world.stored.approval)!;
}

function snapshot(): StoredNote {
  return { ...(world.readsAsOf || world.stored) };
}

function matchesNote(query: Record<string, unknown>): boolean {
  if (!world.exists) {
    return false;
  }

  if (String(query["_id"] || "") !== world.stored._id) {
    return false;
  }

  if (
    query["projectId"] !== undefined &&
    String(query["projectId"]) !== world.stored.projectId.toString()
  ) {
    return false;
  }

  if (
    query["incidentId"] !== undefined &&
    String(query["incidentId"]) !== world.stored.incidentId.toString()
  ) {
    return false;
  }

  return true;
}

function fakeService(): unknown {
  return {
    getModel: (): unknown => {
      return {
        singularName: "Incident Public Note",
        tableName: "IncidentPublicNote",
      };
    },
    findOneBy: async (find: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<unknown> => {
      if (find.props.isRoot) {
        return matchesNote(find.query) ? snapshot() : null;
      }

      const userId: string = find.props.userId?.toString() || "";

      if (world.forbidden.has(userId)) {
        throw new NotAuthorizedException(
          "You do not have Read Incident Public Note permission.",
        );
      }

      return matchesNote(find.query) && world.readers.has(userId)
        ? { _id: world.stored._id }
        : null;
    },
    findOneById: async (find: { id: ObjectID }): Promise<unknown> => {
      return world.exists && find.id.toString() === world.stored._id
        ? snapshot()
        : null;
    },
    updateOneBy: async (update: {
      query: { _id: string; version: number };
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      // Written as OneUptime, with no hooks, at the version it was read at.
      expect(update.props).toEqual({ isRoot: true, ignoreHooks: true });
      world.readsAsOf = null;

      if (
        !world.exists ||
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

export function host(): PublicNoteApprovalHost<IncidentPublicNote> {
  return {
    kind: PublicNoteKind.Incident,
    eventType: PublicNoteApprovalEventType.Incident,
    modelType: IncidentPublicNote,
    service: fakeService() as never,
    parentIdColumn: "incidentId",
    recordNoun: "incident",
    getRecord: async () => {
      return {
        label: "Incident INC-42",
        title: "Checkout is down",
        url: "https://oneuptime.example/dashboard/p/incidents/i",
        notesUrl: NOTES_URL,
      };
    },
    addFeedItem: async (data: {
      markdown: { toString: () => string };
    }): Promise<void> => {
      world.feed.push(data.markdown.toString());
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
    announceEditPublished: async (): Promise<void> => {
      return undefined;
    },
    getMessageIds: (parentId: ObjectID) => {
      return { incidentId: parentId };
    },
  };
}

// The member a chat account is connected to, with their props in the project.
export function memberProps(userId: string): DatabaseCommonInteractionProps {
  return { userId: new ObjectID(userId), tenantId: PROJECT_ID };
}

/*
 * What a message asking for `position`'s step carries on its buttons, for
 * the note as it is now - or with `overrides`, a message sent another time.
 */
export function buttonValue(
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): PublicNoteApprovalButtonValue {
  const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
    PublicNoteApproval.readRound(world.stored.approval),
    world.steps,
  );

  return {
    kind: PublicNoteKind.Incident,
    projectId: PROJECT_ID,
    recordId: INCIDENT_ID,
    noteId: NOTE_ID,
    submittedAt:
      PublicNoteApproval.readRound(world.stored.approval)?.submittedAt ||
      SUBMITTED_AT,
    stepId: position.step?.id || SUPPORT.id,
    isFinal: position.isFinal,
    isEdit:
      PublicNoteApproval.readRound(world.stored.approval)?.isEdit ??
      world.stored.isPublished !== false,
    textDigest: WorkspacePublicNoteApproval.getTextDigest(
      PublicNoteApprovalEngine.getTextToApprove(world.stored),
    ),
    ...overrides,
  };
}

export function encodedValue(
  overrides: Partial<PublicNoteApprovalButtonValue> = {},
): string {
  return WorkspacePublicNoteApproval.encodeValue(buttonValue(overrides));
}

/*
 * A new world: Alice's note waiting for Support, then Legal; everyone may
 * read it; nobody is on a team. Every outside call the engine makes is the
 * world's, so each test sees what was written, announced and asked.
 */
export function startWorld(): void {
  world = {
    stored: heldNote(),
    exists: true,
    readers: new Set([ALICE, BOB, CAROL, DAVE, EVE]),
    forbidden: new Set(),
    steps: [SUPPORT, LEGAL],
    isRequired: true,
    teams: {},
    writes: [],
    feed: [],
    published: [],
    workflows: [],
    asked: [],
    askedChat: [],
    told: [],
    logged: [],
    readsAsOf: null,
  };

  getJestSpyOn(
    WorkspacePublicNoteApprovalActions,
    "getHost",
  ).mockImplementation((() => {
    return host();
  }) as never);
  getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockImplementation(
    (async () => {
      return world.steps.map((step: PublicNoteApprovalStepRule) => {
        return { ...step };
      });
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockImplementation(
    (async () => {
      return world.isRequired;
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getUserTeamIds").mockImplementation(
    (async (data: { userId: ObjectID }) => {
      return Object.keys(world.teams).filter((teamId: string) => {
        return world.teams[teamId]!.includes(data.userId.toString());
      });
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getTeamMemberIds").mockImplementation(
    (async () => {
      return { ...world.teams };
    }) as never,
  );
  getJestSpyOn(TeamService, "findBy").mockResolvedValue([] as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "getUserNames",
  ).mockImplementation((async (ids: ReadonlyArray<string>) => {
    const found: Record<string, string> = {};

    for (const id of ids) {
      if (NAMES[id]) {
        found[id] = NAMES[id]!;
      }
    }

    return found;
  }) as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "askApprovers",
  ).mockImplementation((async (data: {
    userIds: ReadonlyArray<string>;
    chat?: unknown;
  }) => {
    world.asked.push([...data.userIds]);
    world.askedChat.push(data.chat);
    return [];
  }) as never);
  getJestSpyOn(
    PublicNoteApprovalNotifications,
    "tellSender",
  ).mockImplementation((async (data: {
    sentByUserId: string | undefined;
    isApproved: boolean;
  }) => {
    world.told.push({
      userId: data.sentByUserId,
      isApproved: data.isApproved,
    });
    return true;
  }) as never);
  getJestSpyOn(
    WorkspaceActionAuthorization,
    "getProjectMemberProps",
  ).mockImplementation((async (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }) => {
    return {
      userId: data.userId,
      tenantId: data.projectId,
    };
  }) as never);
  getJestSpyOn(
    WorkspaceNotificationLogService,
    "logButtonPressed",
  ).mockImplementation((async (data: { buttonAction: string }) => {
    world.logged.push(data.buttonAction);
    return {};
  }) as never);
}

export function restoreWorld(): void {
  jest.restoreAllMocks();
}
