import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import OnTriggerBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import logger from "../../../Server/Utils/Logger";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import {
  AN_INCIDENT,
  KINDS,
  Kind,
  OTHER_RECORD_ID,
  PROJECT_ID,
  READ_BACK_FAILURE,
  READ_FAILURE,
  RECORD_ID,
  World,
  WriteRecorders,
  rootProps,
  useDatabase,
  useWriteRecorders,
} from "./WriteWorld";
import type { SpyInstance } from "jest-mock";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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
 *     check fails;
 *   - nor does the other read an update made after its write: the read back
 *     of a row written through save(), for the images it shows. A row that
 *     cannot be read back keeps its images as they were.
 *
 * It drives DatabaseService's real create, updateBy and deleteBy, with the
 * database left out (a repository that keeps nothing, WriteWorld) and the
 * private-record read answered by the test: for an incident, its own row
 * (the record itself); for an internal note, the incident it is part of.
 */

// The workflow events posted and the audit log entries, of each test.
const { posted, audited }: WriteRecorders = useWriteRecorders();

let errors: SpyInstance<typeof logger.error>;

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
  // The logger is a mock of the module's (jest.mock above): each test reads its own calls.
  errors = jest.spyOn(logger, "error");
  errors.mockClear();
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

/*
 * An update that writes a list - an incident's labels, monitors - goes
 * through save(), which hands nothing back: the row is read back once saved,
 * for what it shows to everyone (PublishedImages). That read, too, came
 * after the write with nothing around it.
 */
describe("an update written through save() whose row cannot be read back once saved", () => {
  // A list, so save(); and the description, which the incident shows on status pages.
  const CHANGE: JSONObject = {
    description: "Rolled back the deploy.",
    labels: [],
  };

  async function updateBoth(world: World): Promise<number> {
    return await world.service.updateBy({
      query: { projectId: PROJECT_ID } as never,
      data: CHANGE as never,
      limit: 10,
      skip: 0,
      props: rootProps(),
    });
  }

  test("is kept: every row it names is written, with each row's workflow event, realtime event and audit log entry", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
      [RECORD_ID, OTHER_RECORD_ID],
    );

    await expect(updateBoth(world)).resolves.toBe(2);

    expect(world.written).toEqual([
      `save ${RECORD_ID}`,
      `save ${OTHER_RECORD_ID}`,
    ]);
    expect(posted).toEqual([
      `incident on-update ${RECORD_ID}`,
      `incident on-update ${OTHER_RECORD_ID}`,
    ]);
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

    const messages: Array<string> = logged(READ_BACK_FAILURE);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain(RECORD_ID);
    expect(messages[1]).toContain(OTHER_RECORD_ID);
  });

  test("leaves the images of a row it could not read back as they were, and decides the other rows' as before", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
      [RECORD_ID],
    );
    const imagesDecided: SpyInstance<typeof PublishedImages.afterUpdate> =
      jest.spyOn(PublishedImages, "afterUpdate");

    await expect(updateBoth(world)).resolves.toBe(2);

    expect(imagesDecided).toHaveBeenCalledTimes(1);

    const decided: Parameters<typeof PublishedImages.afterUpdate>[0] =
      imagesDecided.mock.calls[0]![0];

    // Never made public, nor private, on a guess: only the row read back is decided.
    expect(
      decided.rowsBefore.map((row: unknown): string => {
        return String((row as BaseModel)._id);
      }),
    ).toEqual([OTHER_RECORD_ID]);
    expect(decided.rowsAfter).toHaveLength(1);
    expect(logged(READ_BACK_FAILURE)).toHaveLength(1);
  });

  test("a row read back decides its images as before", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
    );
    const imagesDecided: SpyInstance<typeof PublishedImages.afterUpdate> =
      jest.spyOn(PublishedImages, "afterUpdate");

    await expect(updateBoth(world)).resolves.toBe(2);

    const decided: Parameters<typeof PublishedImages.afterUpdate>[0] =
      imagesDecided.mock.calls[0]![0];

    expect(
      decided.rowsBefore.map((row: unknown): string => {
        return String((row as BaseModel)._id);
      }),
    ).toEqual([RECORD_ID, OTHER_RECORD_ID]);
    expect(decided.rowsAfter).toHaveLength(2);
    expect(logged(READ_BACK_FAILURE)).toEqual([]);
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
    const findOneById: SpyInstance<typeof world.service.findOneById> =
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
