import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import {
  StatementContext,
  WriteStep,
} from "../../../Server/Utils/Database/StatementOutcome";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import WorkflowListeners from "../../../Server/Utils/Workflow/WorkflowListeners";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import API from "../../../Utils/API";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, expect, jest } from "@jest/globals";

/*
 * A CREATE, UPDATE OR DELETE DRIVEN THROUGH DATABASESERVICE'S REAL PATHS,
 * WITH THE DATABASE LEFT OUT: what each write did, as a test sees it.
 *
 * A repository that keeps nothing, the rows a write reads before it writes
 * answered by the test, and what follows a write recorded - its workflow
 * event (the post to the workflow service), its realtime event, its audit
 * log entry, and the service hooks it reached. Shared by the suites that pin
 * what follows a write that is done: that its workflow trigger never fails
 * it (WorkflowTriggerNeverFailsTheWrite, #9209), and that a success hook
 * that fails it leaves it recorded and announced
 * (SuccessHookFailureKeepsTheWriteRecorded, #9616).
 *
 * A test file that uses it mocks the logger itself
 * (jest.mock("../../../Server/Utils/Logger")) and calls useWriteRecorders()
 * once, at its top level.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b300",
);
export const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b301";
export const OTHER_RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b302";
export const INCIDENT_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b303";

// What the private-record read failed with, as Postgres says it when the connection drops.
export const READ_FAILURE: string = "Connection terminated unexpectedly";

// What the read back of a row saved failed with.
export const READ_BACK_FAILURE: string = "Query read timeout";

// What the read of whether the record is private does, in a test.
export type PrivateRead = "fails" | "private" | "not private";

// The write a hook belongs to.
export type WriteKind = "create" | "update" | "delete";

// What an error hook was told.
export interface ErrorHookCall {
  write: WriteKind;
  message: string;
  // Whether it was handed what the write's onBefore* hook handed back.
  isHandedBack: boolean;
  // Whether the write itself failed, or a step around it (WriteProgress).
  failedStep: WriteStep | undefined;
}

// A service that keeps which of a write's hooks it reached, and what each was told.
export class RecordingService<
  TModel extends BaseModel,
> extends DatabaseService<TModel> {
  // A write that is done reaches no error hook: its caller is told it was done.
  public errorHooks: Array<ErrorHookCall> = [];
  public successHooks: Array<string> = [];

  /*
   * What a success hook does once it is reached, for a test to set: a write
   * of its own, a throw. None by default.
   */
  public successHookActs: {
    create?: ((createdItem: TModel) => Promise<void>) | undefined;
    update?: (() => Promise<void>) | undefined;
    delete?: (() => Promise<void>) | undefined;
  } = {};

  public constructor(modelType: { new (): TModel }) {
    super(modelType);
  }

  private recordErrorHook(
    write: WriteKind,
    error: Exception,
    handedBack: unknown,
    failedStatement: StatementContext | undefined,
  ): void {
    this.errorHooks.push({
      write: write,
      message: error.message,
      isHandedBack: Boolean(handedBack),
      failedStep: failedStatement?.failedStep,
    });
  }

  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<TModel> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.recordErrorHook("create", error, onCreate, failedStatement);
    return error;
  }

  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<TModel> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.recordErrorHook("update", error, onUpdate, failedStatement);
    return error;
  }

  protected override async onDeleteError(
    error: Exception,
    onDelete?: OnDelete<TModel> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.recordErrorHook("delete", error, onDelete, failedStatement);
    return error;
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<TModel>,
    createdItem: TModel,
  ): Promise<TModel> {
    this.successHooks.push(`create: ${createdItem.id?.toString()}`);
    await this.successHookActs.create?.(createdItem);
    return createdItem;
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<TModel>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TModel>> {
    this.successHooks.push(`update: ${updatedItemIds.length}`);
    await this.successHookActs.update?.();
    return onUpdate;
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<TModel>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<TModel>> {
    this.successHooks.push(`delete: ${itemIdsBeforeDelete.length}`);
    await this.successHookActs.delete?.();
    return onDelete;
  }
}

// A kind of record a workflow can start on that can be private, or part of a private record.
export interface Kind<TModel extends BaseModel> {
  name: string;
  modelType: { new (): TModel };
  // What a create is handed.
  newRecord: () => TModel;
  // The row as a write reads it before it writes it.
  row: (id: string) => TModel;
  // An update that changes the row.
  change: JSONObject;
  // Whose row says it is private: its own (an incident), or its incident's (a note).
  isPrivateBy: "itself" | "its incident";
}

export const AN_INCIDENT: Kind<Incident> = {
  name: "an incident",
  modelType: Incident,
  newRecord: (): Incident => {
    const incident: Incident = new Incident();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is slow";
    return incident;
  },
  row: (id: string): Incident => {
    const incident: Incident = new Incident();
    incident._id = id;
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is slow";
    return incident;
  },
  change: { title: "Checkout is down" },
  isPrivateBy: "itself",
};

export const A_NOTE: Kind<IncidentInternalNote> = {
  name: "an internal note of an incident",
  modelType: IncidentInternalNote,
  newRecord: (): IncidentInternalNote => {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note.projectId = PROJECT_ID;
    note.incidentId = new ObjectID(INCIDENT_ID);
    note.note = "Rolled back the deploy.";
    return note;
  },
  row: (id: string): IncidentInternalNote => {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note._id = id;
    note.projectId = PROJECT_ID;
    note.incidentId = new ObjectID(INCIDENT_ID);
    note.note = "Rolled back the deploy.";
    return note;
  },
  change: { note: "Rolled back the deploy, and flushed the cache." },
  isPrivateBy: "its incident",
};

export const KINDS: Array<Kind<BaseModel>> = [
  AN_INCIDENT as unknown as Kind<BaseModel>,
  A_NOTE as unknown as Kind<BaseModel>,
];

// What a write did, as the test saw it.
export interface World {
  service: RecordingService<BaseModel>;
  // What reached the repository.
  written: Array<string>;
  // The realtime events sent: "<event> <id>".
  realtime: Array<string>;
  // The reads of whether a record is private: whose row each read.
  privacyReads: Array<string>;
}

/*
 * What every write of a test sent beyond its own service, reset before each
 * test (useWriteRecorders): the workflow events posted, "<table> <event>
 * <id>", and the audit log entries, "<create|update|delete> <id>".
 */
export interface WriteRecorders {
  posted: Array<string>;
  audited: Array<string>;
}

/*
 * A database that keeps nothing: the rows `rowIds` as a write reads them
 * before it writes, the private-record read doing `privateRead`, and the
 * read back of each row of `readBackFailsFor` failing once it is saved.
 */
export function useDatabase(
  kind: Kind<BaseModel>,
  privateRead: PrivateRead,
  rowIds: Array<string> = [RECORD_ID],
  readBackFailsFor: Array<string> = [],
): World {
  const service: RecordingService<BaseModel> = new RecordingService<BaseModel>(
    kind.modelType,
  );

  const world: World = {
    service: service,
    written: [],
    realtime: [],
    privacyReads: [],
  };

  getJestSpyOn(service, "getRepository").mockReturnValue({
    // A create's INSERT, or an update written through save() (it writes a list).
    save: async (entity: unknown): Promise<unknown> => {
      const saved: BaseModel = entity as BaseModel;

      if (saved._id) {
        world.written.push(`save ${saved._id.toString()}`);
        return saved;
      }

      world.written.push("insert");
      saved._id = RECORD_ID;
      return saved;
    },
    update: async (criteria: {
      _id?: unknown;
    }): Promise<{
      affected: number;
    }> => {
      world.written.push(`update ${String(criteria._id)}`);
      return { affected: 1 };
    },
    delete: async (): Promise<{ affected: number }> => {
      world.written.push("delete");
      return { affected: rowIds.length };
    },
    find: async (): Promise<Array<BaseModel>> => {
      return [];
    },
  } as never);

  getJestSpyOn(service, "_findBy").mockImplementation((async (
    findBy: { query: JSONObject },
    withDeleted?: boolean,
  ): Promise<Array<BaseModel>> => {
    // The read before an update or a delete - the rows it writes - or the read back of one saved.
    if (withDeleted !== true) {
      const id: string = String(findBy.query["_id"] ?? "");

      if (
        readBackFailsFor.includes(id) &&
        world.written.includes(`save ${id}`)
      ) {
        throw new Error(READ_BACK_FAILURE);
      }

      return rowIds.includes(id) ? [kind.row(id)] : rowIds.map(kind.row);
    }

    // isAboutPrivateRecord's read of the record's own row, deleted rows included.
    world.privacyReads.push("itself");

    const row: BaseModel = kind.row(String(findBy.query["_id"]));

    if (kind.isPrivateBy === "itself") {
      if (privateRead === "fails") {
        throw new Error(READ_FAILURE);
      }

      (row as unknown as { isPrivate: boolean }).isPrivate =
        privateRead === "private";
    }

    return [row];
  }) as never);

  // The private record a part of one names (a note's incident), read by OneUptime.
  getJestSpyOn(DatabaseService, "getParentReader").mockImplementation(
    ((modelType: { new (): BaseModel }) => {
      return {
        findBy: async (findBy: {
          query: JSONObject;
        }): Promise<Array<{ _id: string }>> => {
          if (findBy.query["isPrivate"] !== true) {
            return [];
          }

          expect(modelType).toBe(Incident);
          world.privacyReads.push("its incident");

          if (privateRead === "fails") {
            throw new Error(READ_FAILURE);
          }

          return privateRead === "private"
            ? [{ _id: String(findBy.query["_id"]) }]
            : [];
        },
      };
    }) as never,
  );

  getJestSpyOn(service, "onTriggerRealtime").mockImplementation((async (
    modelId: ObjectID,
    projectId: ObjectID,
    eventType: ModelEventType,
  ): Promise<void> => {
    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    world.realtime.push(`${eventType} ${modelId.toString()}`);
  }) as never);

  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);

  // What a delete reads before it deletes, with nothing to find.
  getJestSpyOn(service, "readRowsDeletedWith").mockResolvedValue([] as never);
  getJestSpyOn(service, "getRealtimeAccessBeforeDelete").mockResolvedValue(
    new Map() as never,
  );
  getJestSpyOn(service, "readAttachedFilesOfRowsDeleted").mockResolvedValue(
    new Map() as never,
  );

  return world;
}

export function rootProps(): { isRoot: true; tenantId: ObjectID } {
  return { isRoot: true, tenantId: PROJECT_ID };
}

/*
 * Before each test: the workflow service's post and the audit log's
 * recorder, recorded (WriteRecorders), a workflow of the project listening
 * to every event, and the file reads a write makes answered. After each:
 * every spy restored. The arrays handed back are the same ones for every
 * test, emptied before each.
 */
export function useWriteRecorders(): WriteRecorders {
  const recorders: WriteRecorders = { posted: [], audited: [] };

  beforeEach(() => {
    recorders.posted.length = 0;
    recorders.audited.length = 0;

    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { route: { toString: () => string } };
      data: { data: { _id: string } };
    }) => {
      const route: Array<string> = options.url.route
        .toString()
        .split("/")
        .filter((segment: string): boolean => {
          return segment.length > 0;
        });

      recorders.posted.push(
        `${route.slice(-2).join(" ")} ${options.data.data._id}`,
      );

      return {};
    }) as never);

    // A workflow of the project listens: the record is asked about.
    jest
      .spyOn(WorkflowListeners, "isAnyListening")
      .mockResolvedValue(true as never);

    jest
      .spyOn(PublishedImages, "setImagesVisibility")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(FileService, "getFileOwners")
      .mockResolvedValue(new Map() as never);

    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockImplementation((async (data: { createdItem: BaseModel }) => {
        recorders.audited.push(`create ${data.createdItem.id?.toString()}`);
      }) as never);
    jest
      .spyOn(AuditLogService, "recordUpdate")
      .mockImplementation((async (data: { itemId: ObjectID }) => {
        recorders.audited.push(`update ${data.itemId.toString()}`);
      }) as never);
    jest
      .spyOn(AuditLogService, "recordDelete")
      .mockImplementation((async (data: { itemId: ObjectID }) => {
        recorders.audited.push(`delete ${data.itemId.toString()}`);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  return recorders;
}
