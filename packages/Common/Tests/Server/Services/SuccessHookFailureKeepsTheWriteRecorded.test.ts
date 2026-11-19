import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import AuditLogService from "../../../Server/Services/AuditLogService";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import { WriteStep } from "../../../Server/Utils/Database/StatementOutcome";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import ProjectUsageCache from "../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import RuleOwningTeams from "../../../Server/Utils/Rules/RuleOwningTeams";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  AN_INCIDENT,
  ErrorHookCall,
  KINDS,
  Kind,
  OTHER_RECORD_ID,
  PROJECT_ID,
  RECORD_ID,
  World,
  WriteKind,
  WriteRecorders,
  rootProps,
  useDatabase,
  useWriteRecorders,
} from "./WriteWorld";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A WRITE A SUCCESS HOOK FAILS IS STILL RECORDED (#9616).
 *
 * A service's success hook runs once the row is committed, and a hook that
 * throws fails the request on purpose: create() hands the error to
 * onCreateError, _deleteBy to onDeleteError, each told the step around the
 * write failed (WriteStep.AroundWrite). The row stays written. What came
 * after the hook was skipped:
 *
 *   - a delete whose onDeleteSuccess threw left its rows deleted with no
 *     audit log entry - for an audit log, a deletion it never recorded is
 *     the worst gap;
 *   - a create whose onCreateSuccess threw - or a step after the INSERT -
 *     left a record no open page heard about and the audit log never saw
 *     created.
 *
 * Now, however the write ends once its rows are written:
 *
 *   - each row a delete removed is in the audit log right after the DELETE,
 *     as read before it; its workflow and realtime events went before the
 *     hook, as they always did;
 *   - a create's record is in the audit log as soon as it is there to stay -
 *     as it was inserted, before the hooks, so what they change of it is
 *     recorded after its create, never before - and open pages hear of it,
 *     from the create's catch when it fails;
 *   - no workflow starts on a create that failed: a run reads the record as
 *     the hooks leave it, and they did not finish with it;
 *   - a create taken out again because its creator could not be made its
 *     owner is neither recorded nor announced: it was not made;
 *   - the write still rejects, with the hook's own error, and its error hook
 *     is still told;
 *   - a write that succeeds is recorded and announced once, as before.
 *
 * It drives DatabaseService's real create, deleteBy, deleteOneById and
 * updateBy, with the database left out (WriteWorld).
 */

// The workflow events posted and the audit log entries, of each test.
const { posted, audited }: WriteRecorders = useWriteRecorders();

// What a service's success hook failed with.
const HOOK_FAILURE: string = "The incident's timeline could not be written.";

// What a step after the write failed with.
const STEP_FAILURE: string = "The cache could not be reached.";

function fail(message: string): () => Promise<void> {
  return async (): Promise<void> => {
    throw new BadDataException(message);
  };
}

// What the error hook of a write that failed around its write is told.
function failedAroundTheWrite(
  write: WriteKind,
  message: string,
): Array<ErrorHookCall> {
  return [
    {
      write: write,
      message: message,
      isHandedBack: true,
      failedStep: WriteStep.AroundWrite,
    },
  ];
}

// The table of a kind as its workflow route names it ("incident-internal-note").
function routeOf(kind: Kind<BaseModel>): string {
  return new kind.modelType()
    .tableName!.replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

async function createOne(world: World, kind: Kind<BaseModel>): Promise<void> {
  await world.service.create({
    data: kind.newRecord(),
    props: rootProps(),
  });
}

async function deleteBoth(world: World): Promise<number> {
  return await world.service.deleteBy({
    query: { projectId: PROJECT_ID } as never,
    limit: 10,
    skip: 0,
    props: rootProps(),
  });
}

describe.each(KINDS)(
  "a create of $name whose onCreateSuccess fails",
  (kind: Kind<BaseModel>) => {
    test("rejects with the hook's error, tells onCreateError, and is still in the audit log and heard by open pages; no workflow starts on it", async () => {
      const world: World = useDatabase(kind, "not private");
      world.service.successHookActs.create = fail(HOOK_FAILURE);

      await expect(createOne(world, kind)).rejects.toThrow(HOOK_FAILURE);

      // The row is written, and stays.
      expect(world.written).toEqual(["insert"]);
      expect(world.service.successHooks).toEqual([`create: ${RECORD_ID}`]);
      expect(world.service.errorHooks).toEqual(
        failedAroundTheWrite("create", HOOK_FAILURE),
      );

      // Recorded, and announced, once.
      expect(audited).toEqual([`create ${RECORD_ID}`]);
      expect(world.realtime).toEqual([`Create ${RECORD_ID}`]);

      // A run reads the record as the hooks leave it: none starts.
      expect(posted).toEqual([]);
    });
  },
);

describe("a create that fails at another step once its row is written", () => {
  const STEPS: Array<{
    name: string;
    failStep: (world: World) => void;
  }> = [
    {
      name: "the list it joins (before the hooks)",
      failStep: (world: World): void => {
        getJestSpyOn(
          world.service,
          "applyListOrderCreatePlan",
        ).mockRejectedValue(new BadDataException(STEP_FAILURE) as never);
      },
    },
    {
      name: "the images it shows to everyone (before the hooks)",
      failStep: (): void => {
        jest
          .spyOn(PublishedImages, "afterCreate")
          .mockRejectedValue(new BadDataException(STEP_FAILURE) as never);
      },
    },
    {
      name: "the teams picked to own it (after the hooks)",
      failStep: (): void => {
        jest
          .spyOn(RuleOwningTeams, "addAfterCreate")
          .mockRejectedValue(new BadDataException(STEP_FAILURE) as never);
      },
    },
  ];

  test.each(STEPS)(
    "$name: rejects, and is still in the audit log and heard by open pages, once",
    async (step: { name: string; failStep: (world: World) => void }) => {
      const world: World = useDatabase(
        AN_INCIDENT as unknown as Kind<BaseModel>,
        "not private",
      );
      step.failStep(world);

      await expect(
        createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>),
      ).rejects.toThrow(STEP_FAILURE);

      expect(world.written).toEqual(["insert"]);
      expect(world.service.errorHooks).toEqual(
        failedAroundTheWrite("create", STEP_FAILURE),
      );
      expect(audited).toEqual([`create ${RECORD_ID}`]);
      expect(world.realtime).toEqual([`Create ${RECORD_ID}`]);
      expect(posted).toEqual([]);
    },
  );
});

describe("a create taken out again because its creator could not be made its owner", () => {
  test("is neither in the audit log nor heard by open pages: it was not made", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );

    // A creator whose access reaches only what they own, on a model with owners.
    getJestSpyOn(world.service, "createReliesOnOwnership").mockReturnValue(
      true as never,
    );
    jest
      .spyOn(OwnedScopePermission, "hasOwnerTables")
      .mockReturnValue(true as never);

    // Their owner row is not written, and they do not own it after all.
    getJestSpyOn(world.service, "insertCreatorAsOwner").mockRejectedValue(
      new Error("The owner row could not be written.") as never,
    );
    getJestSpyOn(world.service, "isCreatorOwnerOf").mockResolvedValue(
      false as never,
    );
    const undo: jest.SpyInstance<any, any> = getJestSpyOn(
      world.service,
      "hardDeleteBy",
    ).mockResolvedValue(1 as never);

    await expect(
      createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>),
    ).rejects.toThrow("was not created");

    // Written, then taken out again.
    expect(world.written).toEqual(["insert"]);
    expect(undo).toHaveBeenCalledTimes(1);

    expect(audited).toEqual([]);
    expect(world.realtime).toEqual([]);
    expect(posted).toEqual([]);
    expect(world.service.successHooks).toEqual([]);
    expect(world.service.errorHooks).toHaveLength(1);
  });
});

describe("a create whose INSERT fails", () => {
  test("writes nothing, so records and announces nothing; its error hook is told the write itself failed", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );

    getJestSpyOn(world.service, "getRepository").mockReturnValue({
      save: async (): Promise<never> => {
        throw new Error("The database refused the row.");
      },
    } as never);

    await expect(
      createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>),
    ).rejects.toThrow("The database refused the row.");

    expect(audited).toEqual([]);
    expect(world.realtime).toEqual([]);
    expect(posted).toEqual([]);
    expect(world.service.successHooks).toEqual([]);
    expect(world.service.errorHooks).toEqual([
      {
        write: "create",
        message: "The database refused the row.",
        isHandedBack: true,
        failedStep: WriteStep.Write,
      },
    ]);
  });
});

describe("a create that succeeds", () => {
  test.each(KINDS)(
    "$name is recorded once, heard once, and starts its workflows once, after its hooks",
    async (kind: Kind<BaseModel>) => {
      const world: World = useDatabase(kind, "not private");

      await createOne(world, kind);

      expect(world.written).toEqual(["insert"]);
      expect(world.service.successHooks).toEqual([`create: ${RECORD_ID}`]);
      expect(world.service.errorHooks).toEqual([]);
      expect(audited).toEqual([`create ${RECORD_ID}`]);
      expect(world.realtime).toEqual([`Create ${RECORD_ID}`]);
      expect(posted).toEqual([`${routeOf(kind)} on-create ${RECORD_ID}`]);
    },
  );

  test("a change its hook makes to the record is recorded after its create, never before it", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );

    world.service.successHookActs.create = async (
      createdItem: BaseModel,
    ): Promise<void> => {
      await world.service.updateOneById({
        id: createdItem.id!,
        data: AN_INCIDENT.change as never,
        props: rootProps(),
      });
    };

    await createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>);

    expect(world.written).toEqual(["insert", `update ${RECORD_ID}`]);
    expect(audited).toEqual([`create ${RECORD_ID}`, `update ${RECORD_ID}`]);

    // The events go as they did: the update's as it is written, the create's last.
    expect(world.realtime).toEqual([
      `Update ${RECORD_ID}`,
      `Create ${RECORD_ID}`,
    ]);
    expect(posted).toEqual([
      `incident on-update ${RECORD_ID}`,
      `incident on-create ${RECORD_ID}`,
    ]);
  });

  test("its entry is the record as it was inserted, not as a hook left it in memory", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );
    const titlesRecorded: Array<string | undefined> = [];

    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockImplementation((async (data: { createdItem: BaseModel }) => {
        titlesRecorded.push((data.createdItem as Incident).title);
      }) as never);

    world.service.successHookActs.create = async (
      createdItem: BaseModel,
    ): Promise<void> => {
      (createdItem as Incident).title = "Set in memory by a hook";
    };

    await createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>);

    expect(titlesRecorded).toEqual(["Checkout is slow"]);
  });

  test("one with ignoreHooks is not in the audit log, as before, and is still heard by open pages", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );

    await world.service.create({
      data: AN_INCIDENT.newRecord(),
      props: { ...rootProps(), ignoreHooks: true },
    });

    expect(world.service.successHooks).toEqual([]);
    expect(audited).toEqual([]);
    expect(world.realtime).toEqual([`Create ${RECORD_ID}`]);
    expect(posted).toEqual([`incident on-create ${RECORD_ID}`]);
  });
});

describe("a create whose hook takes its record out again, then fails (a verification code that could not be sent)", () => {
  test("is in the audit log as created, then deleted - in that order - and still rejects", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
    );

    world.service.successHookActs.create = async (
      createdItem: BaseModel,
    ): Promise<void> => {
      await world.service.deleteOneById({
        id: createdItem.id!,
        props: rootProps(),
      });

      throw new BadDataException("The verification code was not sent.");
    };

    await expect(
      createOne(world, AN_INCIDENT as unknown as Kind<BaseModel>),
    ).rejects.toThrow("The verification code was not sent.");

    expect(world.written).toEqual(["insert", "delete"]);
    expect(audited).toEqual([`create ${RECORD_ID}`, `delete ${RECORD_ID}`]);
    expect(world.service.errorHooks).toEqual(
      failedAroundTheWrite("create", "The verification code was not sent."),
    );
  });
});

describe.each(KINDS)(
  "a delete of $name whose onDeleteSuccess fails",
  (kind: Kind<BaseModel>) => {
    test("by query: rejects with the hook's error, tells onDeleteError, and each row deleted is still in the audit log, with its workflow and realtime events", async () => {
      const world: World = useDatabase(kind, "not private", [
        RECORD_ID,
        OTHER_RECORD_ID,
      ]);
      world.service.successHookActs.delete = fail(HOOK_FAILURE);

      await expect(deleteBoth(world)).rejects.toThrow(HOOK_FAILURE);

      // The rows are gone, and stay gone.
      expect(world.written).toEqual(["delete"]);
      expect(world.service.successHooks).toEqual(["delete: 2"]);
      expect(world.service.errorHooks).toEqual(
        failedAroundTheWrite("delete", HOOK_FAILURE),
      );

      // Each recorded once.
      expect(audited).toEqual([
        `delete ${RECORD_ID}`,
        `delete ${OTHER_RECORD_ID}`,
      ]);
      expect(world.realtime).toEqual([
        `Delete ${RECORD_ID}`,
        `Delete ${OTHER_RECORD_ID}`,
      ]);
      expect(posted).toEqual([
        `${routeOf(kind)} on-delete ${RECORD_ID}`,
        `${routeOf(kind)} on-delete ${OTHER_RECORD_ID}`,
      ]);
    });

    test("by its id: rejects, and the row is still in the audit log, once", async () => {
      const world: World = useDatabase(kind, "not private");
      world.service.successHookActs.delete = fail(HOOK_FAILURE);

      await expect(
        world.service.deleteOneById({
          id: new ObjectID(RECORD_ID),
          props: rootProps(),
        }),
      ).rejects.toThrow(HOOK_FAILURE);

      expect(world.written).toEqual(["delete"]);
      expect(world.service.errorHooks).toEqual(
        failedAroundTheWrite("delete", HOOK_FAILURE),
      );
      expect(audited).toEqual([`delete ${RECORD_ID}`]);
      expect(world.realtime).toEqual([`Delete ${RECORD_ID}`]);
    });
  },
);

describe("a delete that fails at a step after its DELETE", () => {
  test("rejects, and each row deleted is still in the audit log, once", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
    );

    jest
      .spyOn(ProjectUsageCache, "afterDelete")
      .mockRejectedValue(new BadDataException(STEP_FAILURE) as never);

    await expect(deleteBoth(world)).rejects.toThrow(STEP_FAILURE);

    expect(world.written).toEqual(["delete"]);
    expect(world.service.errorHooks).toEqual(
      failedAroundTheWrite("delete", STEP_FAILURE),
    );
    expect(audited).toEqual([
      `delete ${RECORD_ID}`,
      `delete ${OTHER_RECORD_ID}`,
    ]);
  });
});

describe("a delete whose DELETE fails", () => {
  test("deletes nothing, so records nothing; its error hook is told the write itself failed", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
    );

    getJestSpyOn(world.service, "getRepository").mockReturnValue({
      delete: async (): Promise<never> => {
        throw new Error("The database refused the delete.");
      },
    } as never);

    await expect(deleteBoth(world)).rejects.toThrow(
      "The database refused the delete.",
    );

    expect(audited).toEqual([]);
    expect(world.realtime).toEqual([]);
    expect(posted).toEqual([]);
    expect(world.service.successHooks).toEqual([]);
    expect(world.service.errorHooks).toEqual([
      {
        write: "delete",
        message: "The database refused the delete.",
        isHandedBack: true,
        failedStep: WriteStep.Write,
      },
    ]);
  });
});

describe("a delete that succeeds", () => {
  test.each(KINDS)(
    "$name: each row is recorded once, heard once, and starts its workflows once",
    async (kind: Kind<BaseModel>) => {
      const world: World = useDatabase(kind, "not private", [
        RECORD_ID,
        OTHER_RECORD_ID,
      ]);

      await expect(deleteBoth(world)).resolves.toBe(2);

      expect(world.service.successHooks).toEqual(["delete: 2"]);
      expect(world.service.errorHooks).toEqual([]);
      expect(audited).toEqual([
        `delete ${RECORD_ID}`,
        `delete ${OTHER_RECORD_ID}`,
      ]);
      expect(world.realtime).toEqual([
        `Delete ${RECORD_ID}`,
        `Delete ${OTHER_RECORD_ID}`,
      ]);
      expect(posted).toEqual([
        `${routeOf(kind)} on-delete ${RECORD_ID}`,
        `${routeOf(kind)} on-delete ${OTHER_RECORD_ID}`,
      ]);
    },
  );

  test("a delete that finds no rows deletes nothing and records nothing", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [],
    );

    await expect(deleteBoth(world)).resolves.toBe(0);

    expect(world.written).toEqual([]);
    expect(audited).toEqual([]);
    expect(world.realtime).toEqual([]);
  });
});

/*
 * An update was never this way - each row's audit entry and events go in
 * its own loop, before onUpdateSuccess - and stays so.
 */
describe("an update whose onUpdateSuccess fails", () => {
  test("rejects, and each row written is still in the audit log, with its workflow and realtime events, once", async () => {
    const world: World = useDatabase(
      AN_INCIDENT as unknown as Kind<BaseModel>,
      "not private",
      [RECORD_ID, OTHER_RECORD_ID],
    );
    world.service.successHookActs.update = fail(HOOK_FAILURE);

    await expect(
      world.service.updateBy({
        query: { projectId: PROJECT_ID } as never,
        data: AN_INCIDENT.change as never,
        limit: 10,
        skip: 0,
        props: rootProps(),
      }),
    ).rejects.toThrow(HOOK_FAILURE);

    expect(world.written).toEqual([
      `update ${RECORD_ID}`,
      `update ${OTHER_RECORD_ID}`,
    ]);
    expect(world.service.errorHooks).toEqual(
      failedAroundTheWrite("update", HOOK_FAILURE),
    );
    expect(audited).toEqual([
      `update ${RECORD_ID}`,
      `update ${OTHER_RECORD_ID}`,
    ]);
    expect(world.realtime).toEqual([
      `Update ${RECORD_ID}`,
      `Update ${OTHER_RECORD_ID}`,
    ]);
    expect(posted).toEqual([
      `incident on-update ${RECORD_ID}`,
      `incident on-update ${OTHER_RECORD_ID}`,
    ]);
  });
});
