import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspacePublicNoteApprovalMessage from "../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspacePublicNoteApprovalMessageService from "../../../Server/Services/WorkspacePublicNoteApprovalMessageService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import { PublicNoteKind } from "../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import WorkspacePublicNoteApprovalActions from "../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";
import WorkspacePublicNoteApprovalMessages from "../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalMessages";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * A PUBLIC NOTE DELETED - ON ITS OWN, OR WITH ITS INCIDENT, EPISODE OR
 * SCHEDULED MAINTENANCE EVENT - AND THE CHAT COPIES OF ITS APPROVAL MESSAGE
 * (#6317).
 *
 * The database deletes a note's kept copies with the note (ON DELETE
 * CASCADE), and a record's notes with the record. So each service reads the
 * copies before its delete - of the rows the delete removes, read and held
 * with findRowsAndHoldDeleteToThem - and, once the delete is done, replaces
 * the copies of the notes, or records, it removed: "this public note was
 * deleted". A note, or record, the delete did not remove keeps its copies
 * asking; a delete never fails for its copies.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;
type AnyService = DatabaseService<DatabaseBaseModel>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DELETED_ID: string = "6b000000-0000-4000-8000-00000000000a";
const KEPT_ID: string = "6b000000-0000-4000-8000-00000000000b";

interface NoteServiceCase {
  name: string;
  service: unknown;
  kind: PublicNoteKind;
  noteColumn: string;
}

const NOTE_SERVICES: Array<NoteServiceCase> = [
  {
    name: "IncidentPublicNoteService",
    service: IncidentPublicNoteService,
    kind: PublicNoteKind.Incident,
    noteColumn: "incidentPublicNoteId",
  },
  {
    name: "IncidentEpisodePublicNoteService",
    service: IncidentEpisodePublicNoteService,
    kind: PublicNoteKind.IncidentEpisode,
    noteColumn: "incidentEpisodePublicNoteId",
  },
  {
    name: "ScheduledMaintenancePublicNoteService",
    service: ScheduledMaintenancePublicNoteService,
    kind: PublicNoteKind.ScheduledMaintenance,
    noteColumn: "scheduledMaintenancePublicNoteId",
  },
];

const RECORD_SERVICES: Array<NoteServiceCase> = [
  {
    name: "IncidentService",
    service: IncidentService,
    kind: PublicNoteKind.Incident,
    noteColumn: "incidentPublicNoteId",
  },
  {
    name: "IncidentEpisodeService",
    service: IncidentEpisodeService,
    kind: PublicNoteKind.IncidentEpisode,
    noteColumn: "incidentEpisodePublicNoteId",
  },
  {
    name: "ScheduledMaintenanceService",
    service: ScheduledMaintenanceService,
    kind: PublicNoteKind.ScheduledMaintenance,
    noteColumn: "scheduledMaintenancePublicNoteId",
  },
];

function deleteOf(): DeleteBy<DatabaseBaseModel> {
  return {
    query: {},
    props: { isRoot: true },
    limit: 50,
    skip: 0,
  } as unknown as DeleteBy<DatabaseBaseModel>;
}

function rowOf(id: string): DatabaseBaseModel {
  return {
    id: new ObjectID(id),
    _id: id,
    projectId: PROJECT_ID,
  } as unknown as DatabaseBaseModel;
}

// A copy kept for a note: on the note `noteId`, of the record `recordId`.
function copyOf(data: {
  noteColumn: string;
  noteId: string;
  recordId: string;
  messageId: string;
}): WorkspacePublicNoteApprovalMessage {
  const kept: WorkspacePublicNoteApprovalMessage =
    new WorkspacePublicNoteApprovalMessage();
  kept.id = ObjectID.generate();
  kept.projectId = PROJECT_ID;
  kept.userId = ObjectID.generate();
  (kept as unknown as Record<string, unknown>)[data.noteColumn] = new ObjectID(
    data.noteId,
  );
  kept.recordId = new ObjectID(data.recordId);
  kept.workspaceType = WorkspaceType.Slack;
  kept.workspaceProjectId = "T0TEAM";
  kept.channelId = "D0DIRECT";
  kept.messageId = data.messageId;
  kept.submittedAt = "2026-11-07T09:00:00.000Z";
  kept.stepId = "5e000000-0000-4000-8000-000000000001";
  kept.isFinal = false;
  kept.isEdit = false;
  kept.textDigest = "qoW3AxB_cBzFQiJeGzWS0J";
  return kept;
}

async function beforeDelete(
  service: unknown,
): Promise<OnDelete<DatabaseBaseModel>> {
  return await (
    service as {
      onBeforeDelete: (
        deleteBy: DeleteBy<DatabaseBaseModel>,
      ) => Promise<OnDelete<DatabaseBaseModel>>;
    }
  ).onBeforeDelete(deleteOf());
}

async function afterDelete(
  service: unknown,
  carryForward: unknown,
  deletedIds: Array<string>,
): Promise<void> {
  await (
    service as {
      onDeleteSuccess: (
        onDelete: OnDelete<DatabaseBaseModel>,
        deletedIds: Array<ObjectID>,
      ) => Promise<OnDelete<DatabaseBaseModel>>;
    }
  ).onDeleteSuccess(
    {
      deleteBy: deleteOf(),
      carryForward: carryForward,
    } as OnDelete<DatabaseBaseModel>,
    deletedIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );

  await WorkspacePublicNoteApprovalMessages.settle();
}

let held: AnySpy;
let edited: Array<string>;

function holdRows(service: unknown, rows: Array<DatabaseBaseModel>): AnySpy {
  return jest
    .spyOn(service as AnyService, "findRowsAndHoldDeleteToThem")
    .mockResolvedValue(rows as never) as AnySpy;
}

beforeEach(() => {
  edited = [];
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(WorkspacePublicNoteApprovalActions, "getReplacement")
    .mockResolvedValue({
      answer: {
        markdown: "🗑️ This public note was deleted.",
        text: "This public note was deleted",
      },
    } as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      authToken: "xoxb-project-token",
      workspaceProjectId: "T0TEAM",
    } as unknown as WorkspaceProjectAuthToken as never);
  jest.spyOn(SlackUtil, "updateMessage").mockImplementation((async (data: {
    messageId: string;
  }) => {
    edited.push(data.messageId);
  }) as never);
});

afterEach(async () => {
  await WorkspacePublicNoteApprovalMessages.settle();
  jest.restoreAllMocks();
});

describe.each(NOTE_SERVICES)(
  "$name: a delete of notes",
  (each: NoteServiceCase) => {
    test("reads the copies of the notes it removes - the rows it holds the delete to - before the database takes them", async () => {
      held = holdRows(each.service, [rowOf(DELETED_ID), rowOf(KEPT_ID)]);
      const read: AnySpy = jest
        .spyOn(WorkspacePublicNoteApprovalMessageService, "findForNotes")
        .mockResolvedValue([] as never) as AnySpy;

      const onDelete: OnDelete<DatabaseBaseModel> = await beforeDelete(
        each.service,
      );

      expect(held).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);

      const asked: {
        projectId: ObjectID;
        noteColumn: string;
        noteIds: Array<ObjectID>;
      } = read.mock.calls[0]![0] as never;

      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.noteColumn).toBe(each.noteColumn);
      expect(
        asked.noteIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([DELETED_ID, KEPT_ID]);
      expect(onDelete.carryForward).toEqual({
        publicNoteApproval: { chatMessages: [] },
      });
    });

    test("once done, replaces the copies of the notes it removed - and only those", async () => {
      const copies: Array<WorkspacePublicNoteApprovalMessage> = [
        copyOf({
          noteColumn: each.noteColumn,
          noteId: DELETED_ID,
          recordId: KEPT_ID,
          messageId: "1760000000.deleted",
        }),
        copyOf({
          noteColumn: each.noteColumn,
          noteId: KEPT_ID,
          recordId: KEPT_ID,
          messageId: "1760000000.kept",
        }),
      ];

      await afterDelete(
        each.service,
        { publicNoteApproval: { chatMessages: copies } },
        [DELETED_ID],
      );

      expect(edited).toEqual(["1760000000.deleted"]);
    });

    test("a delete that removed nothing replaces nothing", async () => {
      await afterDelete(
        each.service,
        {
          publicNoteApproval: {
            chatMessages: [
              copyOf({
                noteColumn: each.noteColumn,
                noteId: DELETED_ID,
                recordId: KEPT_ID,
                messageId: "1760000000.deleted",
              }),
            ],
          },
        },
        [],
      );

      expect(edited).toEqual([]);
    });

    test("copies that cannot be read do not stop the delete", async () => {
      holdRows(each.service, [rowOf(DELETED_ID)]);
      jest
        .spyOn(WorkspacePublicNoteApprovalMessageService, "findForNotes")
        .mockRejectedValue(new Error("The table is not there.") as never);

      const onDelete: OnDelete<DatabaseBaseModel> = await beforeDelete(
        each.service,
      );

      expect(onDelete.carryForward).toEqual({
        publicNoteApproval: { chatMessages: [] },
      });
    });
  },
);

describe.each(RECORD_SERVICES)(
  "$name: a delete of records, which takes their public notes with them",
  (each: NoteServiceCase) => {
    test("reads the copies of their notes' approval messages before the database takes them", async () => {
      holdRows(each.service, [rowOf(DELETED_ID), rowOf(KEPT_ID)]);
      const copies: Array<WorkspacePublicNoteApprovalMessage> = [
        copyOf({
          noteColumn: each.noteColumn,
          noteId: "6c000000-0000-4000-8000-000000000001",
          recordId: DELETED_ID,
          messageId: "1760000000.ofdeleted",
        }),
      ];
      const read: AnySpy = jest
        .spyOn(WorkspacePublicNoteApprovalMessageService, "findForRecords")
        .mockResolvedValue(copies as never) as AnySpy;

      const onDelete: OnDelete<DatabaseBaseModel> = await beforeDelete(
        each.service,
      );

      const asked: {
        projectId: ObjectID;
        noteColumn: string;
        recordIds: Array<ObjectID>;
      } = read.mock.calls[0]![0] as never;

      expect(asked.noteColumn).toBe(each.noteColumn);
      expect(
        asked.recordIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([DELETED_ID, KEPT_ID]);
      expect(
        (
          onDelete.carryForward as {
            publicNoteApproval: { chatMessages: Array<unknown> };
          }
        ).publicNoteApproval.chatMessages,
      ).toEqual(copies);
    });

    test("once done, replaces the copies of the records it removed - and only those", async () => {
      await afterDelete(
        each.service,
        {
          publicNoteApproval: {
            chatMessages: [
              copyOf({
                noteColumn: each.noteColumn,
                noteId: "6c000000-0000-4000-8000-000000000001",
                recordId: DELETED_ID,
                messageId: "1760000000.ofdeleted",
              }),
              copyOf({
                noteColumn: each.noteColumn,
                noteId: "6c000000-0000-4000-8000-000000000002",
                recordId: KEPT_ID,
                messageId: "1760000000.ofkept",
              }),
            ],
          },
        },
        [DELETED_ID],
      );

      expect(edited).toEqual(["1760000000.ofdeleted"]);
    });

    test("a delete that carried no copies replaces nothing", async () => {
      await afterDelete(each.service, {}, [DELETED_ID]);
      await afterDelete(each.service, null, [DELETED_ID]);

      expect(edited).toEqual([]);
    });
  },
);
