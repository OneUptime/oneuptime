import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import OnTriggerBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import logger from "../../../Server/Utils/Logger";
import WorkflowListeners from "../../../Server/Utils/Workflow/WorkflowListeners";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import API from "../../../Utils/API";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A WRITE THAT IS DONE STAYS DONE: ITS WORKFLOW TRIGGER NEVER FAILS IT
 * (#9209).
 *
 * Before a create, an update or a delete posts its workflow trigger,
 * DatabaseService.onTriggerWorkflow reads whether the record is a private
 * incident, alert or episode, or part of one (isAboutPrivateRecord, #8914):
 * the record's own row, then the private record it names (getParentReader).
 * That read comes after the write. When it failed - a dropped connection, a
 * timeout - the write threw though its row was written: the API answered
 * with an error for a change that was made, the realtime event and the
 * audit log entry that follow were skipped, and an update of several rows
 * stopped after the first.
 *
 * Now:
 *
 *   - a record whose read fails is taken as private: no event is posted -
 *     it carries the record's id and what an update changed, and a private
 *     record's must never reach a workflow because a read failed - and the
 *     cause is logged;
 *   - the write returns what it wrote, sends its realtime event and writes
 *     its audit log entry, as it does for a record that is private;
 *   - nothing else of the trigger - a service's own onTriggerWorkflow, a
 *     post that fails - fails the write either;
 *   - the trigger step, at the other end, does not run on a record whose
 *     check fails.
 *
 * It drives DatabaseService's real create, updateBy and deleteBy, with the
 * database left out (a repository that keeps nothing) and the private-record
 * read answered by the test: for an incident, its own row (the record
 * itself); for an internal note, the incident it is part of.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b300",
);
const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b301";
const OTHER_RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b302";
const INCIDENT_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b303";

// What the read failed with, as Postgres says it when the connection drops.
const READ_FAILURE: string = "Connection terminated unexpectedly";

// What the read of whether the record is private does, in a test.
type PrivateRead = "fails" | "private" | "not private";

// A service that keeps which of a write's hooks it reached.
class RecordingService<
  TModel extends BaseModel,
> extends DatabaseService<TModel> {
  // A write that is done reaches no error hook: its caller is told it was done.
  public errorHooks: Array<string> = [];
  public successHooks: Array<string> = [];

  public constructor(modelType: { new (): TModel }) {
    super(modelType);
  }

  protected override async onCreateError(error: Exception): Promise<Exception> {
    this.errorHooks.push(`create: ${error.message}`);
    return error;
  }

  protected override async onUpdateError(error: Exception): Promise<Exception> {
    this.errorHooks.push(`update: ${error.message}`);
    return error;
  }

  protected override async onDeleteError(error: Exception): Promise<Exception> {
    this.errorHooks.push(`delete: ${error.message}`);
    return error;
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<TModel>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TModel>> {
    this.successHooks.push(`update: ${updatedItemIds.length}`);
    return onUpdate;
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<TModel>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<TModel>> {
    this.successHooks.push(`delete: ${itemIdsBeforeDelete.length}`);
    return onDelete;
  }
}

// A kind of record a workflow can start on that can be private, or part of a private record.
interface Kind<TModel extends BaseModel> {
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

const AN_INCIDENT: Kind<Incident> = {
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

const A_NOTE: Kind<IncidentInternalNote> = {
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

const KINDS: Array<Kind<BaseModel>> = [
  AN_INCIDENT as unknown as Kind<BaseModel>,
  A_NOTE as unknown as Kind<BaseModel>,
];

// What a write did, as the test saw it.
interface World {
  service: RecordingService<BaseModel>;
  // What reached the repository.
  written: Array<string>;
  // The realtime events sent: "<event> <id>".
  realtime: Array<string>;
  // The reads of whether a record is private: whose row each read.
  privacyReads: Array<string>;
}

let posted: Array<string> = [];
let audited: Array<string> = [];
let errors: jest.SpiedFunction<typeof logger.error>;

/*
 * A database that keeps nothing: the rows `rowIds` as a write reads them
 * before it writes, and the private-record read doing `privateRead`.
 */
function useDatabase(
  kind: Kind<BaseModel>,
  privateRead: PrivateRead,
  rowIds: Array<string> = [RECORD_ID],
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
    save: async (entity: unknown): Promise<unknown> => {
      world.written.push("insert");
      (entity as BaseModel)._id = RECORD_ID;
      return entity;
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
    // The read before an update or a delete: the rows it writes.
    if (withDeleted !== true) {
      return rowIds.map(kind.row);
    }

    // isAboutPrivateRecord's read of the record's own row, deleted rows included.
    world.privacyReads.push("itself");

    const row: BaseModel = kind.row(String(findBy.query["_id"]));

    if (kind.isPrivateBy === "itself") {
      if (privateRead === "fails") {
        throw new Error(READ_FAILURE);
      }

      row.setValue("isPrivate", privateRead === "private");
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

function rootProps(): { isRoot: true; tenantId: ObjectID } {
  return { isRoot: true, tenantId: PROJECT_ID };
}

// What was logged about a private-record read that failed.
function loggedCauses(): Array<{ message: string; attributes: unknown }> {
  return errors.mock.calls
    .map((call: Array<unknown>): { message: string; attributes: unknown } => {
      return { message: String(call[0]), attributes: call[1] };
    })
    .filter((logged: { message: string }): boolean => {
      return logged.message.includes(READ_FAILURE);
    });
}

function expectCauseLoggedFor(ids: Array<string>): void {
  const causes: Array<{ message: string; attributes: unknown }> =
    loggedCauses();

  expect(causes).toHaveLength(ids.length);

  ids.forEach((id: string, index: number) => {
    // Which record, why nothing was posted, and the read's own words.
    expect(causes[index]!.message).toContain(id);
    expect(causes[index]!.message).toContain("workflow");
    expect(causes[index]!.attributes).toEqual({
      projectId: PROJECT_ID.toString(),
    });
  });
}

beforeEach(() => {
  posted = [];
  audited = [];

  // The logger is a mock of the module's (jest.mock above): each test reads its own calls.
  errors = jest.spyOn(logger, "error");
  errors.mockClear();

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

    posted.push(`${route.slice(-2).join(" ")} ${options.data.data._id}`);

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

  jest.spyOn(AuditLogService, "recordCreate").mockImplementation((async (data: {
    createdItem: BaseModel;
  }) => {
    audited.push(`create ${data.createdItem.id?.toString()}`);
  }) as never);
  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async (data: {
    itemId: ObjectID;
  }) => {
    audited.push(`update ${data.itemId.toString()}`);
  }) as never);
  jest.spyOn(AuditLogService, "recordDelete").mockImplementation((async (data: {
    itemId: ObjectID;
  }) => {
    audited.push(`delete ${data.itemId.toString()}`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the records written here", () => {
  test.each(KINDS)(
    "$name starts workflows, sends live updates and is audited",
    (kind: Kind<BaseModel>) => {
      const model: BaseModel = new kind.modelType();

      expect(model.enableWorkflowOn).toMatchObject({
        create: true,
        update: true,
        delete: true,
      });
      expect(model.enableAuditLogOn).toMatchObject({
        create: true,
        update: true,
        delete: true,
      });
    },
  );
});

describe.each(KINDS)(
  "a write of $name whose private-record read fails",
  (kind: Kind<BaseModel>) => {
    test("create: returns the row it wrote, posts no trigger, logs the cause, and sends its realtime event and audit log entry", async () => {
      const world: World = useDatabase(kind, "fails");

      const created: BaseModel = await world.service.create({
        data: kind.newRecord(),
        props: rootProps(),
      });

      expect(created.id?.toString()).toBe(RECORD_ID);
      expect(world.written).toEqual(["insert"]);
      expect(world.privacyReads).toEqual(
        kind.isPrivateBy === "itself" ? ["itself"] : ["itself", "its incident"],
      );
      expect(posted).toEqual([]);
      expectCauseLoggedFor([RECORD_ID]);
      expect(world.realtime).toEqual([`Create ${RECORD_ID}`]);
      expect(audited).toEqual([`create ${RECORD_ID}`]);
      expect(world.service.errorHooks).toEqual([]);
    });

    test("update: writes every row it names, returns how many, posts no trigger, logs the cause, and sends each row's realtime event and audit log entry", async () => {
      const world: World = useDatabase(kind, "fails", [
        RECORD_ID,
        OTHER_RECORD_ID,
      ]);

      const updated: number = await world.service.updateBy({
        query: { projectId: PROJECT_ID } as never,
        data: kind.change as never,
        limit: 10,
        skip: 0,
        props: rootProps(),
      });

      // The second row is written too: the first row's trigger no longer stops the update.
      expect(updated).toBe(2);
      expect(world.written).toEqual([
        `update ${RECORD_ID}`,
        `update ${OTHER_RECORD_ID}`,
      ]);
      expect(posted).toEqual([]);
      expectCauseLoggedFor([RECORD_ID, OTHER_RECORD_ID]);
      expect(world.realtime).toEqual([
        `Update ${RECORD_ID}`,
        `Update ${OTHER_RECORD_ID}`,
      ]);
      expect(audited).toEqual([
        `update ${RECORD_ID}`,
        `update ${OTHER_RECORD_ID}`,
      ]);
      expect(world.service.successHooks).toEqual(["update: 2"]);
      expect(world.service.errorHooks).toEqual([]);
    });

    test("update of one row by its id: returns that it was written", async () => {
      const world: World = useDatabase(kind, "fails");

      await world.service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: kind.change as never,
        props: rootProps(),
      });

      expect(world.written).toEqual([`update ${RECORD_ID}`]);
      expect(posted).toEqual([]);
      expectCauseLoggedFor([RECORD_ID]);
      expect(world.realtime).toEqual([`Update ${RECORD_ID}`]);
      expect(audited).toEqual([`update ${RECORD_ID}`]);
      expect(world.service.errorHooks).toEqual([]);
    });

    test("delete: returns how many it deleted, posts no trigger, logs the cause, and sends each row's realtime event and audit log entry", async () => {
      const world: World = useDatabase(kind, "fails", [
        RECORD_ID,
        OTHER_RECORD_ID,
      ]);

      const deleted: number = await world.service.deleteBy({
        query: { projectId: PROJECT_ID } as never,
        limit: 10,
        skip: 0,
        props: rootProps(),
      });

      expect(deleted).toBe(2);
      expect(world.written).toEqual(["delete"]);
      expect(posted).toEqual([]);
      expectCauseLoggedFor([RECORD_ID, OTHER_RECORD_ID]);
      expect(world.realtime).toEqual([
        `Delete ${RECORD_ID}`,
        `Delete ${OTHER_RECORD_ID}`,
      ]);
      expect(audited).toEqual([
        `delete ${RECORD_ID}`,
        `delete ${OTHER_RECORD_ID}`,
      ]);
      expect(world.service.successHooks).toEqual(["delete: 2"]);
      expect(world.service.errorHooks).toEqual([]);
    });
  },
);

describe.each(KINDS)(
  "a write of $name that is private",
  (kind: Kind<BaseModel>) => {
    test("create, update and delete post no trigger, and log no failure: the realtime event and audit log entry go as before", async () => {
      const world: World = useDatabase(kind, "private");

      await world.service.create({
        data: kind.newRecord(),
        props: rootProps(),
      });
      await world.service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: kind.change as never,
        props: rootProps(),
      });
      await world.service.deleteOneById({
        id: new ObjectID(RECORD_ID),
        props: rootProps(),
      });

      expect(posted).toEqual([]);
      expect(loggedCauses()).toEqual([]);
      expect(world.privacyReads).toEqual(
        kind.isPrivateBy === "itself"
          ? ["itself", "itself", "itself"]
          : [
              "itself",
              "its incident",
              "itself",
              "its incident",
              "itself",
              "its incident",
            ],
      );
      expect(world.realtime).toEqual([
        `Create ${RECORD_ID}`,
        `Update ${RECORD_ID}`,
        `Delete ${RECORD_ID}`,
      ]);
      expect(audited).toEqual([
        `create ${RECORD_ID}`,
        `update ${RECORD_ID}`,
        `delete ${RECORD_ID}`,
      ]);
      expect(world.service.errorHooks).toEqual([]);
    });
  },
);

describe.each(KINDS)(
  "a write of $name that is not private",
  (kind: Kind<BaseModel>) => {
    test("create, update and delete post their triggers, with the realtime event and audit log entry, as before", async () => {
      const world: World = useDatabase(kind, "not private");
      const table: string = new kind.modelType().tableName!.replace(
        /([a-z])([A-Z])/g,
        "$1-$2",
      );

      await world.service.create({
        data: kind.newRecord(),
        props: rootProps(),
      });
      await world.service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: kind.change as never,
        props: rootProps(),
      });
      await world.service.deleteOneById({
        id: new ObjectID(RECORD_ID),
        props: rootProps(),
      });

      expect(posted).toEqual([
        `${table.toLowerCase()} on-create ${RECORD_ID}`,
        `${table.toLowerCase()} on-update ${RECORD_ID}`,
        `${table.toLowerCase()} on-delete ${RECORD_ID}`,
      ]);
      expect(loggedCauses()).toEqual([]);
      expect(world.realtime).toEqual([
        `Create ${RECORD_ID}`,
        `Update ${RECORD_ID}`,
        `Delete ${RECORD_ID}`,
      ]);
      expect(audited).toEqual([
        `create ${RECORD_ID}`,
        `update ${RECORD_ID}`,
        `delete ${RECORD_ID}`,
      ]);
    });
  },
);

describe("nothing else of the trigger fails a write that is done", () => {
  // A create, an update and a delete of an incident that is not private, each kept.
  async function writeEach(world: World): Promise<void> {
    const created: BaseModel = await world.service.create({
      data: AN_INCIDENT.newRecord(),
      props: rootProps(),
    });

    expect(created.id?.toString()).toBe(RECORD_ID);

    await world.service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: AN_INCIDENT.change as never,
      props: rootProps(),
    });

    await expect(
      world.service.deleteOneById({
        id: new ObjectID(RECORD_ID),
        props: rootProps(),
      }),
    ).resolves.toBe(1);

    expect(world.written).toEqual(["insert", `update ${RECORD_ID}`, "delete"]);
    expect(world.realtime).toEqual([
      `Create ${RECORD_ID}`,
      `Update ${RECORD_ID}`,
      `Delete ${RECORD_ID}`,
    ]);
    expect(audited).toEqual([
      `create ${RECORD_ID}`,
      `update ${RECORD_ID}`,
      `delete ${RECORD_ID}`,
    ]);
    expect(world.service.errorHooks).toEqual([]);
  }

  // What was logged with these words in it.
  function logged(words: string): Array<string> {
    return errors.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((message: string): boolean => {
        return message.includes(words);
      });
  }

  test("a post the workflow service refuses is logged", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );
    jest
      .spyOn(API, "post")
      .mockRejectedValue(
        new Error("The workflow service could not be reached") as never,
      );

    await writeEach(world);

    // It is not awaited: let the refusals reach their handler.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(logged("The workflow service could not be reached")).toHaveLength(3);
  });

  test("a post that fails before it is sent is logged", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );
    jest.spyOn(API, "post").mockImplementation((() => {
      throw new Error("The workflow service's address could not be read");
    }) as never);

    await writeEach(world);

    expect(
      logged("The workflow service's address could not be read"),
    ).toHaveLength(3);
  });

  test("a service's own onTriggerWorkflow that fails is logged, with the record it was about", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );
    jest
      .spyOn(world.service, "onTriggerWorkflow")
      .mockRejectedValue(
        new Error("The service could not tell whether to start them") as never,
      );

    await writeEach(world);

    const messages: Array<string> = logged(
      "The service could not tell whether to start them",
    );

    expect(messages).toHaveLength(3);

    for (const message of messages) {
      expect(message).toContain(RECORD_ID);
    }

    expect(posted).toEqual([]);
  });
});

describe("onTriggerWorkflow called on its own - a note published, a reminder moved on, a subscriber unsubscribed", () => {
  test.each(KINDS)(
    "for $name whose private-record read fails: posts nothing, logs the cause, and does not throw",
    async (kind: Kind<BaseModel>) => {
      const world: World = useDatabase(kind, "fails");

      for (const type of ["on-create", "on-update", "on-delete"] as const) {
        await expect(
          world.service.onTriggerWorkflow(
            new ObjectID(RECORD_ID),
            PROJECT_ID,
            type,
            { updatedFields: { title: "Card data exposed in checkout logs" } },
          ),
        ).resolves.toBeUndefined();
      }

      expect(posted).toEqual([]);
      expectCauseLoggedFor([RECORD_ID, RECORD_ID, RECORD_ID]);

      // What an update changed is never in what is logged.
      for (const cause of loggedCauses()) {
        expect(cause.message).not.toContain("Card data");
      }
    },
  );

  test("isAboutPrivateRecord itself still fails with its read, so whoever asks it can refuse", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "fails",
    );

    await expect(
      world.service.isAboutPrivateRecord(new ObjectID(RECORD_ID)),
    ).rejects.toThrow(READ_FAILURE);
  });
});

describe("the trigger step", () => {
  test("does not run on a record whose check fails: it stops before reading or handing on any of it", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "fails",
    );
    const findOneById: jest.SpiedFunction<typeof world.service.findOneById> =
      jest.spyOn(world.service, "findOneById");

    const trigger: OnTriggerBaseModel<BaseModel> =
      new OnTriggerBaseModel<BaseModel>(world.service, "on-update");

    const options: RunOptions = {
      log: ((): void => {}) as unknown as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      workflowName: "Post incidents to the status channel",
      projectId: PROJECT_ID,
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as unknown as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    };

    let result: RunReturnType | null = null;
    let thrown: unknown = null;

    try {
      result = await trigger.run(
        {
          data: {
            _id: RECORD_ID,
            miscData: { title: "Card data exposed in checkout logs" },
          },
          select: { title: true },
        },
        options,
      );
    } catch (err) {
      thrown = err;
    }

    expect(result).toBeNull();
    expect((thrown as Error).message).toContain(READ_FAILURE);
    expect(findOneById).not.toHaveBeenCalled();
  });
});
