import { expect, jest } from "@jest/globals";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import PublicNoteApprovalRequest from "../../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import PublicNoteApprovalStep from "../../../../Models/DatabaseModels/PublicNoteApprovalStep";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspacePublicNoteApprovalMessage from "../../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PublicNoteApprovalRequestService, {
  PublicNoteApprovalRequestRow,
} from "../../../../Server/Services/PublicNoteApprovalRequestService";
import PublicNoteApprovalStepService from "../../../../Server/Services/PublicNoteApprovalStepService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService, {
  UserNotificationChannels,
} from "../../../../Server/Services/UserNotificationSettingService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspacePublicNoteApprovalMessageService from "../../../../Server/Services/WorkspacePublicNoteApprovalMessageService";
import { WorkspaceSentDirectMessage } from "../../../../Server/Services/WorkspaceUserNotificationService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteKind,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import PublicNoteApproverChanges from "../../../../Server/Utils/Notes/PublicNoteApproverChanges";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { WorkspaceMessageLocation } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspacePublicNoteApproval, {
  PublicNoteApprovalButtonValue,
} from "../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PublicNoteApproval, {
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalRound,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { getJestSpyOn } from "../../../Spy";

/*
 * A PROJECT WHOSE APPROVERS CHANGE WHILE ITS PUBLIC NOTES WAIT (#6353), IN
 * MEMORY.
 *
 * The real engine (PublicNoteApprovalEngine: sending a note, deciding,
 * following one up), the real asking (PublicNoteApprovalNotifications,
 * PublicNoteApprovalRequests), the real passes (PublicNoteApproverChanges),
 * the real step service's hooks and the real chat copies
 * (WorkspacePublicNoteApprovalMessages, WorkspacePublicNoteApprovalActions)
 * over notes of every kind held in memory, written only at the version they
 * were read at, as the database writes them. The steps, the teams, who may
 * read a note, the record of who was asked (written once a row, as the
 * unique index writes it) and each chat are the world's; the rules and the
 * words are the product's.
 *
 * Every notification is recorded as it is sent: to whom, about which note,
 * and on which side of the person's channels - their notification settings
 * (email, push and the rest) or their chat accounts. A person's chat
 * accounts get each message that asks, and keep it as the real chats do
 * (onSent).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
export const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);

// Alice sends notes; the others approve, by name or through a team.
export const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
export const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002";
export const CAROL: string = "c3c3c3c3-0000-4000-8000-000000000003";
export const DAVE: string = "d4d4d4d4-0000-4000-8000-000000000004";
export const EVE: string = "e5e5e5e5-0000-4000-8000-000000000005";
export const FRANK: string = "f6f6f6f6-0000-4000-8000-000000000006";
export const GRACE: string = "a7a7a7a7-0000-4000-8000-000000000007";

export const PEOPLE: Array<string> = [
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  FRANK,
  GRACE,
];

export const NAMES: Record<string, string> = {
  [ALICE]: "Alice",
  [BOB]: "Bob",
  [CAROL]: "Carol",
  [DAVE]: "Dave",
  [EVE]: "Eve",
  [FRANK]: "Frank",
  [GRACE]: "Grace",
};

export const PLATFORM: string = "7ea70000-0000-4000-8000-000000000001";
export const LEGAL_TEAM: string = "7ea70000-0000-4000-8000-000000000002";

export const TEAM_NAMES: Record<string, string> = {
  [PLATFORM]: "Platform",
  [LEGAL_TEAM]: "Legal team",
};

export const KINDS: Array<PublicNoteKind> = [
  PublicNoteKind.Incident,
  PublicNoteKind.IncidentEpisode,
  PublicNoteKind.ScheduledMaintenance,
];

export const CHATS: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
  WorkspaceType.Mattermost,
];

export const REQUESTED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION;

// The kind of approval steps that governs each kind of note.
export function eventTypeOf(kind: PublicNoteKind): PublicNoteApprovalEventType {
  return kind === PublicNoteKind.ScheduledMaintenance
    ? PublicNoteApprovalEventType.ScheduledMaintenance
    : PublicNoteApprovalEventType.Incident;
}

const PARENT_COLUMNS: Record<PublicNoteKind, string> = {
  [PublicNoteKind.Incident]: "incidentId",
  [PublicNoteKind.IncidentEpisode]: "incidentEpisodeId",
  [PublicNoteKind.ScheduledMaintenance]: "scheduledMaintenanceId",
};

const NOTE_COLUMNS: Record<PublicNoteKind, string> = {
  [PublicNoteKind.Incident]: "incidentPublicNoteId",
  [PublicNoteKind.IncidentEpisode]: "incidentEpisodePublicNoteId",
  [PublicNoteKind.ScheduledMaintenance]: "scheduledMaintenancePublicNoteId",
};

const RECORD_LABELS: Record<PublicNoteKind, string> = {
  [PublicNoteKind.Incident]: "Incident",
  [PublicNoteKind.IncidentEpisode]: "Episode",
  [PublicNoteKind.ScheduledMaintenance]: "Scheduled maintenance",
};

export interface WorldNote {
  kind: PublicNoteKind;
  _id: string;
  version: number;
  projectId: ObjectID;
  // The record the note is on: each note on a record of its own.
  parentId: ObjectID;
  note: string;
  pendingNote: string | null;
  isPublished: boolean;
  approvalStatus: string | null;
  approval: JSONObject | null;
  createdByUserId: ObjectID;
  updatedAt: Date;
  attachments: Array<unknown>;
}

// One notification of a public note's approval, as it was sent.
export interface Sent {
  userId: string;
  eventType: NotificationSettingEventType;
  noteId: string | null;
  channels: UserNotificationChannels;
  stepLabel: string;
  // The buttons of its chat message: what each copy of it asks.
  buttonTitles: Array<string>;
  value: PublicNoteApprovalButtonValue | null;
}

// One copy of an approval message a chat holds.
export interface ChatCopy {
  userId: string;
  noteId: string;
  workspaceType: WorkspaceType;
  messageId: string;
  value: PublicNoteApprovalButtonValue | null;
  buttonTitles: Array<string>;
}

// A copy the chat took an edit of.
export interface Replaced {
  workspaceType: WorkspaceType;
  messageId: string;
  markdown: string;
  buttonTitles: Array<string>;
}

interface StoredRequest {
  projectId: string;
  noteId: string;
  userId: string;
  submittedAt: string;
  stepId: string;
  kind: string;
  isFinal: boolean;
  isAskedAgain: boolean;
}

export interface World {
  notes: Array<WorldNote>;
  exists: Set<string>;
  // The approval steps of each project and kind, by "<project>|<eventType>".
  steps: Record<string, Array<PublicNoteApprovalStepRule>>;
  // The accepted members of each team.
  teams: Record<string, Array<string>>;
  // The members of the project, and who of them may read its notes.
  members: Set<string>;
  readers: Set<string>;
  // The chat accounts each person turned on for public note approval.
  chatAccounts: Record<string, Array<WorkspaceType>>;
  // Who was asked, as the table of requests holds it.
  requests: Map<string, StoredRequest>;
  // The chat copies kept, as their table holds them.
  kept: Array<WorkspacePublicNoteApprovalMessage>;
  sent: Array<Sent>;
  copies: Array<ChatCopy>;
  replaced: Array<Replaced>;
  feed: Array<string>;
  published: Array<string>;
  // What fails, or never answers: to see that nothing of it reaches a save.
  requestsFail: boolean;
  sendsFail: Set<string>;
  readsHang: boolean;
  releaseHangingReads: Array<() => void>;
  messageCounter: number;
  clock: number;
  // Told after every write of a note, of the steps and of a team: a test's observer.
  onChange?: (() => void) | undefined;
}

export let world: World;

function stepsKey(
  projectId: ObjectID | string,
  eventType: PublicNoteApprovalEventType,
): string {
  return `${projectId.toString().toLowerCase()}|${eventType}`;
}

export function getSteps(
  eventType: PublicNoteApprovalEventType,
  projectId: ObjectID = PROJECT_ID,
): Array<PublicNoteApprovalStepRule> {
  return world.steps[stepsKey(projectId, eventType)] || [];
}

export function setSteps(
  eventType: PublicNoteApprovalEventType,
  steps: Array<PublicNoteApprovalStepRule>,
  projectId: ObjectID = PROJECT_ID,
): void {
  world.steps[stepsKey(projectId, eventType)] = steps.map(
    (step: PublicNoteApprovalStepRule): PublicNoteApprovalStepRule => {
      return {
        ...step,
        userIds: [...step.userIds],
        teamIds: [...step.teamIds],
      };
    },
  );
  world.onChange?.();
}

let stepCounter: number = 0;

export function step(
  data: Partial<PublicNoteApprovalStepRule> & { order: number },
): PublicNoteApprovalStepRule {
  stepCounter++;

  return {
    id:
      data.id ||
      `5e000000-0000-4000-8000-${String(stepCounter).padStart(12, "0")}`,
    order: data.order,
    userIds: data.userIds || [],
    teamIds: data.teamIds || [],
    ...(data.name ? { name: data.name } : {}),
  };
}

let noteCounter: number = 0;

/*
 * A note of `kind`, sent for approval by `sentBy` (Alice) - an edit of a
 * published note when `isEdit` - waiting, with `approvedBy` already on
 * the steps named. Stored only: sendForApproval asks its first step.
 */
export function addNote(
  data: {
    kind?: PublicNoteKind;
    projectId?: ObjectID;
    sentBy?: string | null;
    isEdit?: boolean;
    approvals?: Array<{ stepId: string; userId: string }>;
    updatedAt?: number;
    status?: PublicNoteApprovalStatus | null;
    isPublished?: boolean;
  } = {},
): WorldNote {
  noteCounter++;
  world.clock++;

  const kind: PublicNoteKind = data.kind || PublicNoteKind.Incident;
  const round: PublicNoteApprovalRound = PublicNoteApproval.startRound({
    now: new Date(Date.UTC(2026, 10, 9, 9, 0, noteCounter)),
    submittedByUserId: data.sentBy === null ? undefined : data.sentBy || ALICE,
    isEdit: Boolean(data.isEdit),
  });

  for (const given of data.approvals || []) {
    round.approvals.push({
      stepId: given.stepId,
      userId: given.userId,
      at: new Date(Date.UTC(2026, 10, 9, 9, 30, noteCounter)).toISOString(),
    });
  }

  const note: WorldNote = {
    kind: kind,
    _id: `40000000-0000-4000-8000-${String(noteCounter).padStart(12, "0")}`,
    version: 1,
    projectId: data.projectId || PROJECT_ID,
    parentId: new ObjectID(
      `30000000-0000-4000-8000-${String(noteCounter).padStart(12, "0")}`,
    ),
    note: data.isEdit ? "The note as it was approved." : `Note ${noteCounter}.`,
    pendingNote: data.isEdit ? `The edit of note ${noteCounter}.` : null,
    isPublished:
      data.isPublished !== undefined ? data.isPublished : Boolean(data.isEdit),
    approvalStatus:
      data.status !== undefined
        ? data.status
        : PublicNoteApprovalStatus.WaitingForApproval,
    approval: PublicNoteApproval.toJSON(round),
    createdByUserId: new ObjectID(data.sentBy || ALICE),
    updatedAt: new Date(data.updatedAt || world.clock * 1000),
    attachments: [],
  };

  world.notes.push(note);
  world.exists.add(note._id);

  return note;
}

export function stored(note: WorldNote): WorldNote {
  return world.notes.find((other: WorldNote): boolean => {
    return other._id === note._id;
  })!;
}

export function roundOf(note: WorldNote): PublicNoteApprovalRound {
  return PublicNoteApproval.readRound(stored(note).approval)!;
}

// The note as the engine's read of it hands it over.
function snapshot(note: WorldNote): Record<string, unknown> {
  return {
    _id: note._id,
    version: note.version,
    projectId: note.projectId,
    [PARENT_COLUMNS[note.kind]]: note.parentId,
    note: note.note,
    pendingNote: note.pendingNote,
    isPublished: note.isPublished,
    approvalStatus: note.approvalStatus,
    approval: note.approval,
    createdByUserId: note.createdByUserId,
    updatedAt: note.updatedAt,
    attachments: [],
  };
}

function notesOf(kind: PublicNoteKind): Array<WorldNote> {
  return world.notes.filter((note: WorldNote): boolean => {
    return note.kind === kind && world.exists.has(note._id);
  });
}

function matches(
  note: WorldNote,
  kind: PublicNoteKind,
  query: Record<string, unknown>,
): boolean {
  if (query["_id"] !== undefined && String(query["_id"]) !== note._id) {
    return false;
  }

  if (
    query["projectId"] !== undefined &&
    String(query["projectId"]).toLowerCase() !==
      note.projectId.toString().toLowerCase()
  ) {
    return false;
  }

  const parent: unknown = query[PARENT_COLUMNS[kind]];

  if (parent !== undefined && String(parent) !== note.parentId.toString()) {
    return false;
  }

  if (
    query["approvalStatus"] !== undefined &&
    String(query["approvalStatus"]) !== String(note.approvalStatus)
  ) {
    return false;
  }

  return true;
}

// A read that never answers while the world says so: the save must not wait on it.
async function maybeHang(): Promise<void> {
  if (world.readsHang) {
    await new Promise<void>((release: () => void): void => {
      world.releaseHangingReads.push(release);
    });
  }
}

function fakeService(kind: PublicNoteKind): unknown {
  return {
    getModel: (): unknown => {
      return {
        singularName: `${RECORD_LABELS[kind]} Public Note`,
        tableName: `${RECORD_LABELS[kind]}PublicNote`,
      };
    },
    findOneBy: async (find: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<unknown> => {
      const note: WorldNote | undefined = notesOf(kind).find(
        (candidate: WorldNote): boolean => {
          return matches(candidate, kind, find.query);
        },
      );

      if (!note) {
        return null;
      }

      if (find.props.isRoot) {
        return snapshot(note);
      }

      return world.readers.has(find.props.userId?.toString() || "")
        ? { _id: note._id }
        : null;
    },
    findOneById: async (find: { id: ObjectID }): Promise<unknown> => {
      const note: WorldNote | undefined = notesOf(kind).find(
        (candidate: WorldNote): boolean => {
          return candidate._id === find.id.toString();
        },
      );

      return note ? snapshot(note) : null;
    },
    findBy: async (find: {
      query: Record<string, unknown>;
      sort?: Record<string, string>;
      skip?: number;
      limit?: number;
    }): Promise<Array<unknown>> => {
      await maybeHang();

      const found: Array<WorldNote> = notesOf(kind).filter(
        (note: WorldNote): boolean => {
          return matches(note, kind, find.query);
        },
      );

      if (find.sort?.["updatedAt"]) {
        found.sort((a: WorldNote, b: WorldNote): number => {
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
      } else {
        found.sort((a: WorldNote, b: WorldNote): number => {
          return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
        });
      }

      const skip: number = find.skip || 0;

      return found
        .slice(skip, skip + (find.limit || found.length))
        .map((note: WorldNote): Record<string, unknown> => {
          return { _id: note._id, updatedAt: note.updatedAt };
        });
    },
    updateOneBy: async (update: {
      query: { _id: string; version: number };
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      expect(update.props).toEqual({ isRoot: true, ignoreHooks: true });

      const note: WorldNote | undefined = notesOf(kind).find(
        (candidate: WorldNote): boolean => {
          return candidate._id === update.query._id;
        },
      );

      if (!note || note.version !== update.query.version) {
        return 0;
      }

      world.clock++;
      Object.assign(note, update.data as Partial<WorldNote>, {
        version: note.version + 1,
        updatedAt: new Date(world.clock * 1000),
      });
      world.onChange?.();

      return 1;
    },
    onTriggerWorkflow: async (): Promise<void> => {
      return undefined;
    },
  };
}

const MODEL_TYPES: Record<PublicNoteKind, { new (): BaseModel }> = {
  [PublicNoteKind.Incident]: IncidentPublicNote,
  [PublicNoteKind.IncidentEpisode]: IncidentEpisodePublicNote,
  [PublicNoteKind.ScheduledMaintenance]: ScheduledMaintenancePublicNote,
};

const hosts: Partial<
  Record<PublicNoteKind, PublicNoteApprovalHost<BaseModel>>
> = {};

export function host(kind: PublicNoteKind): PublicNoteApprovalHost<BaseModel> {
  if (!hosts[kind]) {
    hosts[kind] = {
      kind: kind,
      eventType: eventTypeOf(kind),
      modelType: MODEL_TYPES[kind],
      service: fakeService(kind) as never,
      parentIdColumn: PARENT_COLUMNS[kind],
      recordNoun:
        kind === PublicNoteKind.ScheduledMaintenance
          ? "maintenance event"
          : kind === PublicNoteKind.IncidentEpisode
            ? "episode"
            : "incident",
      getRecord: async (data: { parentId: ObjectID }) => {
        const note: WorldNote | undefined = world.notes.find(
          (candidate: WorldNote): boolean => {
            return candidate.parentId.toString() === data.parentId.toString();
          },
        );

        if (!note) {
          return null;
        }

        const number: number = world.notes.indexOf(note) + 1;
        const url: string = `https://oneuptime.example/dashboard/p/${kind}/${note.parentId.toString()}`;

        return {
          label: `${RECORD_LABELS[kind]} ${number}`,
          title: `Record ${number}`,
          url: url,
          notesUrl: `${url}/public-notes`,
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
        world.published.push(data.noteId.toString());
      },
      getMessageIds: (parentId: ObjectID) => {
        switch (kind) {
          case PublicNoteKind.Incident:
            return { incidentId: parentId };
          case PublicNoteKind.IncidentEpisode:
            return { incidentEpisodeId: parentId };
          case PublicNoteKind.ScheduledMaintenance:
            return { scheduledMaintenanceId: parentId };
        }
      },
    };
  }

  return hosts[kind]!;
}

// ---------- what a message is, as a chat holds it ----------

function buttonsOf(
  blocks: Array<WorkspaceMessageBlock> | undefined,
): Array<WorkspaceMessagePayloadButton> {
  return (blocks || [])
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return (block as WorkspacePayloadButtons).buttons;
      },
    );
}

function valueOf(
  blocks: Array<WorkspaceMessageBlock> | undefined,
): PublicNoteApprovalButtonValue | null {
  for (const button of buttonsOf(blocks)) {
    if (button.value) {
      const value: PublicNoteApprovalButtonValue | null =
        WorkspacePublicNoteApproval.readValue(button.value);

      if (value) {
        return value;
      }
    }
  }

  return null;
}

function titlesOf(
  blocks: Array<WorkspaceMessageBlock> | undefined,
): Array<string> {
  return buttonsOf(blocks).map((button: WorkspaceMessagePayloadButton) => {
    return button.title;
  });
}

// Where a copy for `userId` lands in a chat: the same chat, a message of its own.
export function sentTo(
  userId: string,
  workspaceType: WorkspaceType,
): WorkspaceSentDirectMessage {
  world.messageCounter++;
  const short: string = userId.slice(-6);
  const n: string = String(world.messageCounter).padStart(6, "0");

  switch (workspaceType) {
    case WorkspaceType.Slack:
      return {
        workspaceType,
        workspaceProjectId: "T0TEAM",
        channelId: `D0${short.toUpperCase()}`,
        messageId: `1700000000.${short}${n}`,
      };
    case WorkspaceType.MicrosoftTeams:
      return {
        workspaceType,
        workspaceProjectId: "tenant-xyz",
        channelId: `a:1personal-${short}`,
        messageId: `1:activity-${short}-${n}`,
        serviceUrl: "https://smba.trafficmanager.net/teams/",
      };
    default:
      return {
        workspaceType,
        workspaceProjectId: "t".repeat(26),
        channelId: `${short}${"c".repeat(20)}`,
        messageId: `${short}${n}${"p".repeat(14)}`,
      };
  }
}

function noteOfRecord(data: {
  incidentId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
}): string | null {
  const recordId: string =
    (
      data.incidentId ||
      data.incidentEpisodeId ||
      data.scheduledMaintenanceId
    )?.toString() || "";

  return (
    world.notes.find((note: WorldNote): boolean => {
      return note.parentId.toString() === recordId;
    })?._id || null
  );
}

function copyOf(
  row: WorkspacePublicNoteApprovalMessage,
): WorkspacePublicNoteApprovalMessage {
  return Object.assign(new WorkspacePublicNoteApprovalMessage(), row);
}

function requestKey(request: StoredRequest): string {
  return [
    request.noteId.toLowerCase(),
    request.submittedAt,
    request.stepId,
    request.kind,
    request.isFinal,
    request.isAskedAgain,
    request.userId.toLowerCase(),
  ].join("|");
}

// ---------- the world ----------

/*
 * A new world: one project, Alice sending notes; Support (Bob and Dave) then
 * Legal (Carol) approve incident notes, Maintenance (Eve) scheduled
 * maintenance notes; everyone is a member who may read every note; nobody
 * is on a team and nobody uses chat, until a test says so.
 */
export function startWorld(): void {
  stepCounter = 0;
  noteCounter = 0;

  world = {
    notes: [],
    exists: new Set(),
    steps: {},
    teams: { [PLATFORM]: [], [LEGAL_TEAM]: [] },
    members: new Set(PEOPLE),
    readers: new Set(PEOPLE),
    chatAccounts: {},
    requests: new Map(),
    kept: [],
    sent: [],
    copies: [],
    replaced: [],
    feed: [],
    published: [],
    requestsFail: false,
    sendsFail: new Set(),
    readsHang: false,
    releaseHangingReads: [],
    messageCounter: 0,
    clock: 0,
  };

  setSteps(PublicNoteApprovalEventType.Incident, [
    step({
      id: "5e000000-0000-4000-8000-0000000000a1",
      name: "Support",
      order: 1,
      userIds: [BOB, DAVE],
    }),
    step({
      id: "5e000000-0000-4000-8000-0000000000a2",
      name: "Legal",
      order: 2,
      userIds: [CAROL],
    }),
  ]);
  setSteps(PublicNoteApprovalEventType.ScheduledMaintenance, [
    step({
      id: "5e000000-0000-4000-8000-0000000000b1",
      name: "Maintenance",
      order: 1,
      userIds: [EVE],
    }),
  ]);

  for (const kind of KINDS) {
    delete hosts[kind];
  }

  installWorld();
}

export const SUPPORT_ID: string = "5e000000-0000-4000-8000-0000000000a1";
export const LEGAL_ID: string = "5e000000-0000-4000-8000-0000000000a2";
export const MAINTENANCE_ID: string = "5e000000-0000-4000-8000-0000000000b1";

function installWorld(): void {
  getJestSpyOn(PublicNoteApproverChanges, "getHost").mockImplementation(((
    kind: PublicNoteKind,
  ) => {
    return host(kind);
  }) as never);
  getJestSpyOn(
    WorkspacePublicNoteApprovalActions,
    "getHost",
  ).mockImplementation(((kind: PublicNoteKind) => {
    return host(kind);
  }) as never);

  getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockImplementation(
    (async (data: {
      projectId: ObjectID;
      eventType: PublicNoteApprovalEventType;
    }) => {
      await maybeHang();

      return getSteps(data.eventType, data.projectId).map(
        (rule: PublicNoteApprovalStepRule): PublicNoteApprovalStepRule => {
          return {
            ...rule,
            userIds: [...rule.userIds],
            teamIds: [...rule.teamIds],
          };
        },
      );
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockResolvedValue(
    true as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getTeamMemberIds").mockImplementation(
    (async (data: { teamIds: ReadonlyArray<string> }) => {
      const byTeam: Record<string, Array<string>> = {};

      for (const teamId of data.teamIds) {
        if (world.teams[teamId]) {
          byTeam[teamId] = [...world.teams[teamId]!];
        }
      }

      return byTeam;
    }) as never,
  );
  getJestSpyOn(PublicNoteApprovalPolicy, "getUserTeamIds").mockImplementation(
    (async (data: { userId: ObjectID }) => {
      return Object.keys(world.teams).filter((teamId: string): boolean => {
        return world.teams[teamId]!.includes(data.userId.toString());
      });
    }) as never,
  );

  // The steps the step service's update hook reads back, by id.
  getJestSpyOn(PublicNoteApprovalStepService, "findBy").mockImplementation(
    (async (find: { query: { _id: unknown } }) => {
      // QueryHelper.any: a raw IN (...) whose values are its parameters.
      const ids: Array<string> = Object.values(
        (
          find.query._id as {
            objectLiteralParameters?: Record<string, Array<unknown>>;
          }
        ).objectLiteralParameters || {},
      )
        .flat()
        .map((id: unknown): string => {
          return String(id).toLowerCase();
        });
      const found: Array<PublicNoteApprovalStep> = [];

      for (const [key, steps] of Object.entries(world.steps)) {
        const [projectId, eventType] = key.split("|") as [string, string];

        for (const rule of steps) {
          if (ids.includes(rule.id.toLowerCase())) {
            const model: PublicNoteApprovalStep = new PublicNoteApprovalStep();
            model._id = rule.id;
            model.projectId = new ObjectID(projectId);
            model.eventType = eventType as PublicNoteApprovalEventType;
            found.push(model);
          }
        }
      }

      return found;
    }) as never,
  );

  getJestSpyOn(TeamService, "findBy").mockImplementation((async () => {
    return Object.keys(TEAM_NAMES).map((id: string) => {
      return { id: new ObjectID(id), name: TEAM_NAMES[id] };
    });
  }) as never);
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
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue({
    name: "Acme",
  } as never);

  // A member of the project is one the world says is.
  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation((async (data: {
    userId: ObjectID;
    projectId: ObjectID;
  }) => {
    return {
      userId: data.userId,
      tenantId: data.projectId,
      userTenantAccessPermission: world.members.has(data.userId.toString())
        ? { [data.projectId.toString()]: {} }
        : {},
    };
  }) as never);
  getJestSpyOn(
    UserNotificationSettingService,
    "addPublicNoteApprovalNotificationSettings",
  ).mockResolvedValue(undefined as never);

  // Every notification, as it is sent - and each chat message kept as it lands.
  getJestSpyOn(
    UserNotificationSettingService,
    "sendUserNotification",
  ).mockImplementation((async (data: {
    userId: ObjectID;
    eventType: NotificationSettingEventType;
    emailEnvelope: { vars: Record<string, string> };
    channels?: UserNotificationChannels;
    workspaceMessage?: {
      messageBlocks: Array<WorkspaceMessageBlock>;
      onSent?: (sent: WorkspaceSentDirectMessage) => Promise<void>;
    };
    incidentId?: ObjectID;
    incidentEpisodeId?: ObjectID;
    scheduledMaintenanceId?: ObjectID;
  }) => {
    const userId: string = data.userId.toString();

    if (world.sendsFail.has(userId)) {
      throw new Error(`Could not reach ${NAMES[userId] || userId}.`);
    }

    const channels: UserNotificationChannels =
      data.channels || UserNotificationChannels.All;
    const noteId: string | null = noteOfRecord(data);

    world.sent.push({
      userId: userId,
      eventType: data.eventType,
      noteId: noteId,
      channels: channels,
      stepLabel: data.emailEnvelope.vars["stepLabel"] || "",
      buttonTitles: titlesOf(data.workspaceMessage?.messageBlocks),
      value: valueOf(data.workspaceMessage?.messageBlocks),
    });

    if (
      channels === UserNotificationChannels.AllButChat ||
      !data.workspaceMessage
    ) {
      return;
    }

    for (const workspaceType of world.chatAccounts[userId] || []) {
      const landed: WorkspaceSentDirectMessage = sentTo(userId, workspaceType);

      world.copies.push({
        userId: userId,
        noteId: noteId || "",
        workspaceType: workspaceType,
        messageId: landed.messageId,
        value: valueOf(data.workspaceMessage.messageBlocks),
        buttonTitles: titlesOf(data.workspaceMessage.messageBlocks),
      });

      if (data.workspaceMessage.onSent) {
        await data.workspaceMessage.onSent(landed);
      }
    }
  }) as never);

  // Who was asked, as the table holds it: each row written once.
  getJestSpyOn(PublicNoteApprovalRequestService, "claim").mockImplementation(
    (async (data: {
      projectId: ObjectID;
      noteId: ObjectID;
      userId: ObjectID;
      submittedAt: string;
      stepId: string;
      rows: Array<PublicNoteApprovalRequestRow>;
    }) => {
      if (world.requestsFail) {
        throw new Error("The table of requests cannot be written.");
      }

      const written: Array<string> = [];

      for (const row of data.rows) {
        const request: StoredRequest = {
          projectId: data.projectId.toString(),
          noteId: data.noteId.toString(),
          userId: data.userId.toString(),
          submittedAt: data.submittedAt,
          stepId: data.stepId,
          kind: row.kind,
          isFinal: row.isFinal,
          isAskedAgain: row.isAskedAgain,
        };

        if (!world.requests.has(requestKey(request))) {
          world.requests.set(requestKey(request), request);
          written.push(row.kind);
        }
      }

      return written;
    }) as never,
  );
  getJestSpyOn(
    PublicNoteApprovalRequestService,
    "findForStep",
  ).mockImplementation((async (data: {
    projectId: ObjectID;
    noteId: ObjectID;
    submittedAt: string;
    stepId: string;
  }) => {
    if (world.requestsFail) {
      throw new Error("The table of requests cannot be read.");
    }

    return Array.from(world.requests.values())
      .filter((request: StoredRequest): boolean => {
        return (
          request.projectId.toLowerCase() ===
            data.projectId.toString().toLowerCase() &&
          request.noteId.toLowerCase() ===
            data.noteId.toString().toLowerCase() &&
          request.submittedAt === data.submittedAt &&
          request.stepId === data.stepId
        );
      })
      .map((request: StoredRequest): PublicNoteApprovalRequest => {
        const model: PublicNoteApprovalRequest =
          new PublicNoteApprovalRequest();
        model.userId = new ObjectID(request.userId);
        model.kind = request.kind as never;
        model.isFinal = request.isFinal;
        model.isAskedAgain = request.isAskedAgain;
        return model;
      });
  }) as never);
  getJestSpyOn(PublicNoteApprovalRequestService, "release").mockImplementation(
    (async (data: {
      noteId: ObjectID;
      submittedAt: string;
      stepId: string;
      userIds: Array<ObjectID>;
      rows: Array<PublicNoteApprovalRequestRow>;
    }) => {
      let released: number = 0;

      for (const userId of data.userIds) {
        for (const row of data.rows) {
          const key: string = requestKey({
            projectId: "",
            noteId: data.noteId.toString(),
            userId: userId.toString(),
            submittedAt: data.submittedAt,
            stepId: data.stepId,
            kind: row.kind,
            isFinal: row.isFinal,
            isAskedAgain: row.isAskedAgain,
          });

          if (world.requests.delete(key)) {
            released++;
          }
        }
      }

      return released;
    }) as never,
  );

  // The chat copies, as their table holds them.
  getJestSpyOn(
    WorkspacePublicNoteApprovalMessageService,
    "create",
  ).mockImplementation((async (data: {
    data: WorkspacePublicNoteApprovalMessage;
  }) => {
    const row: WorkspacePublicNoteApprovalMessage = copyOf(data.data);
    row.id = ObjectID.generate();
    world.kept.push(row);
    return copyOf(row);
  }) as never);
  getJestSpyOn(
    WorkspacePublicNoteApprovalMessageService,
    "findForNotes",
  ).mockImplementation((async (data: {
    projectId: ObjectID;
    noteColumn: string;
    noteIds: Array<ObjectID>;
  }) => {
    const ids: Array<string> = data.noteIds.map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    });

    return world.kept
      .filter((row: WorkspacePublicNoteApprovalMessage): boolean => {
        const noteId: unknown = (row as unknown as Record<string, unknown>)[
          data.noteColumn
        ];

        return (
          row.projectId?.toString().toLowerCase() ===
            data.projectId.toString().toLowerCase() &&
          Boolean(noteId) &&
          ids.includes(String(noteId).toLowerCase())
        );
      })
      .map(copyOf);
  }) as never);
  getJestSpyOn(
    WorkspacePublicNoteApprovalMessageService,
    "claim",
  ).mockImplementation((async (data: { id: ObjectID }) => {
    const index: number = world.kept.findIndex(
      (row: WorkspacePublicNoteApprovalMessage): boolean => {
        return row.id?.toString() === data.id.toString();
      },
    );

    if (index < 0) {
      return false;
    }

    world.kept.splice(index, 1);
    return true;
  }) as never);
  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "getProjectAuth",
  ).mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
    return {
      authToken: `token-${data.workspaceType}`,
      workspaceProjectId:
        data.workspaceType === WorkspaceType.Slack
          ? "T0TEAM"
          : data.workspaceType === WorkspaceType.MicrosoftTeams
            ? "tenant-xyz"
            : "t".repeat(26),
      workspaceType: data.workspaceType,
      miscData: {},
    } as unknown as WorkspaceProjectAuthToken;
  }) as never);

  installChatEdits(WorkspaceType.Slack, SlackUtil);
  installChatEdits(WorkspaceType.MicrosoftTeams, MicrosoftTeamsUtil);
  installChatEdits(WorkspaceType.Mattermost, MattermostUtil);

  getJestSpyOn(
    WorkspaceNotificationLogService,
    "logButtonPressed",
  ).mockResolvedValue({} as never);
}

// One chat's edit of a message it holds: recorded as the copy's new words.
function installChatEdits(workspaceType: WorkspaceType, util: unknown): void {
  getJestSpyOn(util, "updateMessage").mockImplementation((async (data: {
    location: WorkspaceMessageLocation;
    messageId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }) => {
    world.replaced.push({
      workspaceType: workspaceType,
      messageId: data.messageId,
      markdown: data.messageBlocks
        .filter((block: WorkspaceMessageBlock): boolean => {
          return block._type === "WorkspacePayloadMarkdown";
        })
        .map((block: WorkspaceMessageBlock): string => {
          return (block as WorkspacePayloadMarkdown).text;
        })
        .join("\n\n"),
      buttonTitles: titlesOf(data.messageBlocks),
    });
  }) as never);
}

/*
 * Waits for what runs in the background - the passes, the chat copies
 * replaced - then puts everything back.
 */
export async function restoreWorld(): Promise<void> {
  world.readsHang = false;

  for (const release of world.releaseHangingReads.splice(0)) {
    release();
  }

  await settled();
  jest.restoreAllMocks();
}

export async function settled(): Promise<void> {
  await PublicNoteApproverChanges.settle();
}

// ---------- what happens in the world ----------

/*
 * The note sent for approval - written held, or a published note's edit
 * held - its first step asked, as the engine asks it.
 */
export async function sendForApproval(note: WorldNote): Promise<void> {
  if (stored(note).isPublished) {
    await PublicNoteApprovalEngine.afterUpdate({
      host: host(note.kind),
      update: {
        heldEditNoteIds: [note._id],
        resentNoteIds: [],
        droppedEditNoteIds: [],
        isUpdateNotificationHeld: true,
        projectId: note.projectId.toString(),
      },
      updatedNoteIds: [new ObjectID(note._id)],
      props: { userId: new ObjectID(ALICE), tenantId: note.projectId },
    });
  } else {
    await PublicNoteApprovalEngine.afterCreate({
      host: host(note.kind),
      note: snapshot(stored(note)) as never,
    });
  }

  await settled();
}

// An approver approves, or rejects, as the Dashboard and the chats decide.
export async function decide(
  note: WorldNote,
  userId: string,
  decision: PublicNoteApprovalDecision = PublicNoteApprovalDecision.Approve,
): Promise<void> {
  await PublicNoteApprovalEngine.decide({
    host: host(note.kind),
    noteId: new ObjectID(note._id),
    decision: decision,
    props: { userId: new ObjectID(userId), tenantId: note.projectId },
    text:
      decision === PublicNoteApprovalDecision.Reject ? "Not yet." : undefined,
  });
}

interface StepHooks {
  onCreateSuccess: (
    onCreate: OnCreate<PublicNoteApprovalStep>,
    createdItem: PublicNoteApprovalStep,
  ) => Promise<PublicNoteApprovalStep>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<PublicNoteApprovalStep>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<PublicNoteApprovalStep>>;
  onDeleteSuccess: (
    onDelete: OnDelete<PublicNoteApprovalStep>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<PublicNoteApprovalStep>>;
}

export function stepHooks(): StepHooks {
  const service: StepHooks =
    PublicNoteApprovalStepService as unknown as StepHooks;

  return {
    onCreateSuccess: service.onCreateSuccess.bind(service),
    onUpdateSuccess: service.onUpdateSuccess.bind(service),
    onDeleteSuccess: service.onDeleteSuccess.bind(service),
  };
}

export type StepChange = "create" | "update" | "delete";

/*
 * A step of the kind written - created, updated or deleted - as the step
 * service writes it: `write` changes the world's steps, then the service's
 * success hook runs, as DatabaseService runs it once the write is done.
 * Returns what the hook handed back, at once: nothing waits for the notes.
 */
export async function writeSteps(data: {
  change: StepChange;
  eventType?: PublicNoteApprovalEventType;
  projectId?: ObjectID;
  stepId: string;
  write: (
    steps: Array<PublicNoteApprovalStepRule>,
  ) => Array<PublicNoteApprovalStepRule>;
}): Promise<void> {
  const eventType: PublicNoteApprovalEventType =
    data.eventType || PublicNoteApprovalEventType.Incident;
  const projectId: ObjectID = data.projectId || PROJECT_ID;

  setSteps(eventType, data.write(getSteps(eventType, projectId)), projectId);

  const hooks: StepHooks = stepHooks();

  if (data.change === "create") {
    const created: PublicNoteApprovalStep = new PublicNoteApprovalStep();
    created._id = data.stepId;
    created.projectId = projectId;
    created.eventType = eventType;

    await hooks.onCreateSuccess(
      {
        createBy: {
          data: created,
          props: { isRoot: true },
        } as CreateBy<PublicNoteApprovalStep>,
        carryForward: null,
      },
      created,
    );
    return;
  }

  if (data.change === "update") {
    await hooks.onUpdateSuccess(
      {
        updateBy: {
          query: { _id: data.stepId },
          data: {},
          props: { isRoot: true },
        } as unknown as UpdateBy<PublicNoteApprovalStep>,
        carryForward: null,
      },
      [new ObjectID(data.stepId)],
    );
    return;
  }

  await hooks.onDeleteSuccess(
    {
      deleteBy: {
        query: { _id: data.stepId },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<PublicNoteApprovalStep>,
      carryForward: {
        publicNoteApproverChanges: [{ projectId, eventType }],
      },
    },
    [new ObjectID(data.stepId)],
  );
}

// Somebody joins a team (accepted), or leaves it, as TeamMemberService tells it.
export function joinTeam(userId: string, teamId: string): void {
  world.teams[teamId] = [...(world.teams[teamId] || []), userId];
  world.onChange?.();
  PublicNoteApproverChanges.afterTeamMembersChanged([PROJECT_ID]);
}

export function leaveTeam(userId: string, teamId: string): void {
  world.teams[teamId] = (world.teams[teamId] || []).filter(
    (member: string): boolean => {
      return member !== userId;
    },
  );
  world.onChange?.();
  PublicNoteApproverChanges.afterTeamMembersChanged([PROJECT_ID]);
}

// ---------- what the world saw ----------

// The asks of a note's approval - by their notification settings - by person.
export function notified(note?: WorldNote): Array<string> {
  return world.sent
    .filter((sent: Sent): boolean => {
      return (
        sent.eventType === REQUESTED &&
        sent.channels !== UserNotificationChannels.ChatOnly &&
        (!note || sent.noteId === note._id)
      );
    })
    .map((sent: Sent): string => {
      return NAMES[sent.userId] || sent.userId;
    })
    .sort();
}

// The asks of a note's approval sent to chat accounts, by person.
export function askedInChat(note?: WorldNote): Array<string> {
  return world.sent
    .filter((sent: Sent): boolean => {
      return (
        sent.eventType === REQUESTED &&
        sent.channels !== UserNotificationChannels.AllButChat &&
        (!note || sent.noteId === note._id)
      );
    })
    .map((sent: Sent): string => {
      return NAMES[sent.userId] || sent.userId;
    })
    .sort();
}

// What each ask by chat alone was, by person.
export function askedInChatOnly(note?: WorldNote): Array<string> {
  return world.sent
    .filter((sent: Sent): boolean => {
      return (
        sent.eventType === REQUESTED &&
        sent.channels === UserNotificationChannels.ChatOnly &&
        (!note || sent.noteId === note._id)
      );
    })
    .map((sent: Sent): string => {
      return NAMES[sent.userId] || sent.userId;
    })
    .sort();
}

// The chat copies still kept: those that still ask, by person and chat.
export function keptCopies(note?: WorldNote): Array<string> {
  return world.kept
    .filter((kept: WorkspacePublicNoteApprovalMessage): boolean => {
      return (
        !note ||
        String(
          (kept as unknown as Record<string, unknown>)[
            NOTE_COLUMNS[note.kind]
          ] || "",
        ) === note._id
      );
    })
    .map((kept: WorkspacePublicNoteApprovalMessage): string => {
      return `${NAMES[kept.userId!.toString()] || kept.userId!.toString()}:${kept.workspaceType}`;
    })
    .sort();
}

// The copies replaced, by person and chat, and what each says now.
export function replacedCopies(note?: WorldNote): Array<{
  who: string;
  markdown: string;
  buttonTitles: Array<string>;
}> {
  return world.replaced
    .map((replaced: Replaced) => {
      const copy: ChatCopy | undefined = world.copies.find(
        (candidate: ChatCopy): boolean => {
          return (
            candidate.messageId === replaced.messageId &&
            candidate.workspaceType === replaced.workspaceType
          );
        },
      );

      return {
        copy,
        who: `${copy ? NAMES[copy.userId] || copy.userId : replaced.messageId}:${replaced.workspaceType}`,
        markdown: replaced.markdown,
        buttonTitles: replaced.buttonTitles,
      };
    })
    .filter((entry: { copy: ChatCopy | undefined }): boolean => {
      return !note || entry.copy?.noteId === note._id;
    })
    .map(
      (entry: {
        who: string;
        markdown: string;
        buttonTitles: Array<string>;
      }) => {
        return {
          who: entry.who,
          markdown: entry.markdown,
          buttonTitles: entry.buttonTitles,
        };
      },
    )
    .sort((a: { who: string }, b: { who: string }): number => {
      return a.who < b.who ? -1 : a.who > b.who ? 1 : 0;
    });
}

// Forgets what was sent and replaced so far: what comes next is what a test reads.
export function forgetWhatWasSent(): void {
  world.sent = [];
  world.replaced = [];
}

export function usesChat(
  userIds: Array<string>,
  chats: Array<WorkspaceType> = CHATS,
): void {
  for (const userId of userIds) {
    world.chatAccounts[userId] = [...chats];
  }
}
