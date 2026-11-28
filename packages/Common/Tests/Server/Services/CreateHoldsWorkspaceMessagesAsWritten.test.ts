import fs from "fs";
import path from "path";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Team from "../../../Models/DatabaseModels/Team";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import RequiredUniqueNames from "../../../Server/Utils/Database/RequiredUniqueNames";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import ProjectUsageCache from "../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import WorkspaceCreatedMessageFirst from "../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import WorkspaceCreatedMessageLine from "../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import { WorkspaceRecord } from "../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  A_NOTE,
  Kind,
  PROJECT_ID,
  RECORD_ID,
  World,
  rootProps,
  useDatabase,
  useWriteRecorders,
} from "./WriteWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A NEW RECORD'S WORKSPACE MESSAGES ARE HELD FROM ITS INSERT (#11352).
 *
 * Every message about a new incident, alert, episode, maintenance event,
 * monitor or on-call policy waits for its Created message
 * (WorkspaceCreatedMessageFirst). The hold was set in each kind's create
 * hook (onCreateSuccess), but DatabaseService.create writes about the
 * record before that: a creator whose role creates only what they own is
 * made its owner right after the INSERT (makeCreatorOwnerOrUndo), and their
 * owner line reached chat before the Created message.
 *
 * Now DatabaseService holds the record's messages right after its INSERT,
 * in one place, for every kind whose create posts a Created message
 * (holdAsWritten): before anything else is written about it, and before the
 * create returns. The create hook takes the hold over (hold) and lets it go
 * once its Created message is out; a create that ends before its hook took
 * it lets it go as it ends (letGoIfNotTaken), however it ends, so nothing it
 * held waits five minutes for a Created message that will never come.
 *
 * Here DatabaseService's real create, with the database left out
 * (WriteWorld) and a service of each kind whose hook a test sets. The
 * kinds' real create chains, against a fake Slack, are in
 * WorkspaceRules/OwnedScopeCreatorFollowsCreated.test.ts.
 */

useWriteRecorders();

interface HeldKind {
  name: string;
  modelType: { new (): BaseModel };
  // The field a message names a record of the kind by.
  field: keyof WorkspaceRecord;
}

const HELD_KINDS: Array<HeldKind> = [
  { name: "an incident", modelType: Incident, field: "incidentId" },
  { name: "an alert", modelType: Alert, field: "alertId" },
  {
    name: "an incident episode",
    modelType: IncidentEpisode,
    field: "incidentEpisodeId",
  },
  {
    name: "an alert episode",
    modelType: AlertEpisode,
    field: "alertEpisodeId",
  },
  {
    name: "a scheduled maintenance event",
    modelType: ScheduledMaintenance,
    field: "scheduledMaintenanceId",
  },
  { name: "a monitor", modelType: Monitor, field: "monitorId" },
  {
    name: "an on-call policy",
    modelType: OnCallDutyPolicy,
    field: "onCallDutyPolicyId",
  },
];

// A kind of record, as the write world creates one.
function kindOf(modelType: { new (): BaseModel }): Kind<BaseModel> {
  const make: (id?: string) => BaseModel = (id?: string): BaseModel => {
    const record: BaseModel = new modelType();
    (record as unknown as { projectId: ObjectID }).projectId = PROJECT_ID;

    if (id) {
      record._id = id;
    }

    return record;
  };

  return {
    name: modelType.name,
    modelType: modelType,
    newRecord: (): BaseModel => {
      return make();
    },
    row: (id: string): BaseModel => {
      return make(id);
    },
    change: {},
    isPrivateBy: "itself",
  };
}

// The record the create writes, as its messages name it.
function recordOf(kind: HeldKind): WorkspaceRecord {
  return recordWith(kind.field, new ObjectID(RECORD_ID));
}

// Lets a few turns of the event loop go by.
async function turns(count: number = 10): Promise<void> {
  for (let i: number = 0; i < count; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

interface Created {
  world: World;
  record: WorkspaceRecord;
  // What happened, in order, each step marked when the record's messages were held then.
  steps: Array<string>;
}

/*
 * A create of `kind`, with its steps recorded: its INSERT, its creator's
 * owner row when it is written first, its create hook.
 */
function setUpCreate(
  kind: HeldKind | Kind<BaseModel>,
  record: WorkspaceRecord,
): Created {
  const world: World = useDatabase(
    "field" in kind ? kindOf(kind.modelType) : kind,
    "not private",
  );
  const steps: Array<string> = [];

  const held: () => string = (): string => {
    return WorkspaceCreatedMessageFirst.isHeld(record) ? " (held)" : "";
  };

  // The repository the write world gives the service, its INSERT recorded.
  const repository: { save: (entity: unknown) => Promise<unknown> } = (
    world.service as unknown as {
      getRepository: () => { save: (entity: unknown) => Promise<unknown> };
    }
  ).getRepository();

  getJestSpyOn(world.service, "getRepository").mockReturnValue({
    ...repository,
    save: async (entity: unknown): Promise<unknown> => {
      const saved: unknown = await repository.save(entity);
      steps.push(`insert${held()}`);
      return saved;
    },
  } as never);

  world.service.successHookActs.create = async (): Promise<void> => {
    steps.push(`create hook${held()}`);
  };

  return { world: world, record: record, steps: steps };
}

// The create relies on its creator owning the record, as an Owned-scope role's does.
function createdByOwnedScopeRole(
  created: Created,
  ownerRow: "written" | "fails" = "written",
): void {
  getJestSpyOn(
    created.world.service,
    "createReliesOnOwnership",
  ).mockReturnValue(true as never);
  jest
    .spyOn(OwnedScopePermission, "hasOwnerTables")
    .mockReturnValue(true as never);

  getJestSpyOn(
    created.world.service,
    "insertCreatorAsOwner",
  ).mockImplementation((async (): Promise<void> => {
    created.steps.push(
      `owner row${WorkspaceCreatedMessageFirst.isHeld(created.record) ? " (held)" : ""}`,
    );

    if (ownerRow === "fails") {
      throw new Error("The owner row could not be written.");
    }
  }) as never);
  getJestSpyOn(created.world.service, "isCreatorOwnerOf").mockResolvedValue(
    false as never,
  );
  getJestSpyOn(created.world.service, "hardDeleteBy").mockImplementation(
    (async (): Promise<number> => {
      created.steps.push(
        `taken out${WorkspaceCreatedMessageFirst.isHeld(created.record) ? " (held)" : ""}`,
      );
      return 1;
    }) as never,
  );
}

// The create itself: a new record of the service's kind, in the project.
function createWith(
  created: Created,
  props: DatabaseCommonInteractionProps = rootProps(),
): Promise<BaseModel> {
  const service: DatabaseService<BaseModel> = created.world.service;
  const data: BaseModel = new (
    service as unknown as { modelType: { new (): BaseModel } }
  ).modelType();
  (data as unknown as { projectId: ObjectID }).projectId = PROJECT_ID;

  return service.create({ data: data, props: props });
}

// A record named by `field`, as a message names it.
function recordWith(
  field: keyof WorkspaceRecord,
  id: ObjectID,
): WorkspaceRecord {
  const record: WorkspaceRecord = {};
  record[field] = id;
  return record;
}

// A message about the record, made now: whether it was kept, and when it is posted.
function aMessageAbout(
  record: WorkspaceRecord,
  posted: Array<string>,
  name: string,
): Promise<boolean> {
  return WorkspaceCreatedMessageFirst.keep({
    record: record,
    post: async (): Promise<void> => {
      posted.push(name);
    },
  });
}

let heldRecords: Array<WorkspaceRecord> = [];

beforeEach(() => {
  heldRecords = HELD_KINDS.map(recordOf);

  // What the steps around the INSERT read beside the record: nothing here.
  jest
    .spyOn(RequiredUniqueNames, "holdNameOnCreate")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectUsageCache, "afterCreate")
    .mockResolvedValue(undefined as never);
});

afterEach(async () => {
  // Whatever a test left held goes, so the next one starts with none.
  for (const record of heldRecords) {
    await WorkspaceCreatedMessageFirst.postHeld(record);
  }
});

describe.each(HELD_KINDS)("a create of $name", (kind: HeldKind) => {
  test("its messages are held from right after its INSERT - before its create hook runs, and before the create returns", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));

    await createWith(created);

    expect(created.steps).toEqual(["insert", "create hook (held)"]);
  });

  test("REGRESSION (#11352): by a creator whose role creates only what they own - held before their owner row is written", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    createdByOwnedScopeRole(created);

    await createWith(created);

    expect(created.steps).toEqual([
      "insert",
      "owner row (held)",
      "create hook (held)",
    ]);
  });

  test("a message made while its creator is made its owner waits, and nothing is posted before its Created message could be", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const posted: Array<string> = [];
    let wasKept: boolean | null = null;

    createdByOwnedScopeRole(created);
    getJestSpyOn(
      created.world.service,
      "insertCreatorAsOwner",
    ).mockImplementation((async (): Promise<void> => {
      // The owner row's own hook: "Added Ana Lee ... as the owner".
      wasKept = await aMessageAbout(created.record, posted, "Ana Lee added");
    }) as never);

    // The create hook takes the hold over, as each kind's does.
    created.world.service.successHookActs.create = async (): Promise<void> => {
      await WorkspaceCreatedMessageFirst.hold(created.record);
      posted.push("Created");
    };

    await createWith(created);
    await WorkspaceCreatedMessageFirst.postHeld(created.record);

    expect(wasKept).toBe(true);
    expect(posted).toEqual(["Created", "Ana Lee added"]);
  });

  test("its create hook takes the hold over: once the create has returned, it is the hook's chain's to let go, not the create's", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const posted: Array<string> = [];

    created.world.service.successHookActs.create = async (): Promise<void> => {
      await WorkspaceCreatedMessageFirst.hold(created.record);
      await aMessageAbout(created.record, posted, "Platform added");
    };

    await createWith(created);
    await turns();

    // Still held: the chain has not posted its Created message yet.
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(true);
    expect(posted).toEqual([]);

    // The chain posts it, and lets the hold go.
    posted.push("Created");
    await WorkspaceCreatedMessageFirst.postHeld(created.record);

    expect(posted).toEqual(["Created", "Platform added"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
  });

  test("a create hook that never takes the hold: the create lets it go as it returns, and what waited goes, once", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const posted: Array<string> = [];

    created.world.service.successHookActs.create = async (): Promise<void> => {
      await aMessageAbout(created.record, posted, "a note");
    };

    await createWith(created);
    await turns();

    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
    expect(posted).toEqual(["a note"]);
  });

  test("REGRESSION (#11352): its creator cannot be made its owner - it is taken out again, and its hold goes with the create, with what it kept", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const posted: Array<string> = [];

    createdByOwnedScopeRole(created, "fails");
    getJestSpyOn(created.world.service, "hardDeleteBy").mockImplementation(
      (async (): Promise<number> => {
        created.steps.push("taken out (held)");
        // Something said about it meanwhile waits with the rest.
        await aMessageAbout(created.record, posted, "a note");
        return 1;
      }) as never,
    );

    await expect(createWith(created)).rejects.toThrow("was not created");
    await turns();

    expect(created.steps).toEqual([
      "insert",
      "owner row (held)",
      "taken out (held)",
    ]);
    expect(created.world.service.successHooks).toEqual([]);
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
    expect(posted).toEqual(["a note"]);
  });

  test("a step between its INSERT and its create hook fails: its hold goes with the create", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));

    jest
      .spyOn(PublishedImages, "afterCreate")
      .mockRejectedValue(
        new BadDataException("The images could not be published.") as never,
      );

    await expect(createWith(created)).rejects.toThrow(
      "The images could not be published.",
    );
    await turns();

    expect(created.steps).toEqual(["insert"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
  });

  test("its create hook fails before taking the hold: the hold goes with the create", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));

    created.world.service.successHookActs.create = async (): Promise<void> => {
      throw new BadDataException("The record could not be read back.");
    };

    await expect(createWith(created)).rejects.toThrow(
      "The record could not be read back.",
    );
    await turns();

    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
  });

  test("its create hook takes the hold, then fails: the hold stays its chain's, and nothing it kept goes before the chain's Created message", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const posted: Array<string> = [];

    created.world.service.successHookActs.create = async (): Promise<void> => {
      await WorkspaceCreatedMessageFirst.hold(created.record);
      await aMessageAbout(created.record, posted, "Platform added");
      throw new BadDataException("A step of the chain failed.");
    };

    await expect(createWith(created)).rejects.toThrow(
      "A step of the chain failed.",
    );
    await turns();

    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(true);
    expect(posted).toEqual([]);

    posted.push("Created");
    await WorkspaceCreatedMessageFirst.postHeld(created.record);

    expect(posted).toEqual(["Created", "Platform added"]);
  });

  test("with ignoreHooks nothing is held: no hook runs to post a Created message", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    const holdAsWritten: SpyInstance<
      typeof WorkspaceCreatedMessageFirst.holdAsWritten
    > = jest.spyOn(WorkspaceCreatedMessageFirst, "holdAsWritten");

    await createWith(created, { ...rootProps(), ignoreHooks: true });

    expect(holdAsWritten).not.toHaveBeenCalled();
    expect(created.steps).toEqual(["insert"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(false);
  });

  test("a record held already, by something else, stays held: the create neither takes that hold nor lets it go", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));

    await WorkspaceCreatedMessageFirst.hold(created.record);

    await createWith(created);
    await turns();

    expect(created.steps).toEqual(["insert (held)", "create hook (held)"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(created.record)).toBe(true);
  });

  test("REGRESSION (#11352): the hold is in place before its creator's owner row is written: the row waits for Valkey to have opened the record's line", async () => {
    const created: Created = setUpCreate(kind, recordOf(kind));
    let openLine: (isOpen: boolean) => void = (): void => {
      // replaced below
    };

    createdByOwnedScopeRole(created);
    jest
      .spyOn(WorkspaceCreatedMessageLine, "isAvailable")
      .mockReturnValue(true);
    jest
      .spyOn(WorkspaceCreatedMessageLine, "start")
      .mockImplementation((): Promise<boolean> => {
        return new Promise<boolean>((resolve: (isOpen: boolean) => void) => {
          openLine = resolve;
        });
      });

    const creating: Promise<BaseModel> = createWith(created);
    await turns();

    // Valkey has not answered: the owner row is not written yet.
    expect(created.steps).toEqual(["insert"]);

    openLine(true);
    await creating;

    expect(created.steps).toEqual([
      "insert",
      "owner row (held)",
      "create hook (held)",
    ]);
  });
});

describe("a create of a kind whose create posts no Created message", () => {
  test.each([
    ["an incident's internal note", A_NOTE],
    ["a status page", kindOf(StatusPage)],
    ["a team", kindOf(Team)],
  ])("%s holds nothing", async (_name: string, kind: Kind<BaseModel>) => {
    const holdAsWritten: SpyInstance<
      typeof WorkspaceCreatedMessageFirst.holdAsWritten
    > = jest.spyOn(WorkspaceCreatedMessageFirst, "holdAsWritten");
    const created: Created = setUpCreate(kind, {});

    await created.world.service.create({
      data: kind.newRecord(),
      props: rootProps(),
    });

    // Asked, and answered that there is nothing to hold.
    expect(holdAsWritten).toHaveBeenCalledTimes(1);
    await expect(holdAsWritten.mock.results[0]!.value).resolves.toBeNull();
    expect(created.steps).toEqual(["insert", "create hook"]);
  });
});

/*
 * THE KINDS HELD AS THEY ARE WRITTEN ARE THE KINDS WHOSE CREATE HOOK TAKES
 * THE HOLD. A kind whose hook holds its messages and that DatabaseService
 * does not hold as it writes it would have its Owned-scope creator's owner
 * line reach chat before its Created message again; one held as written
 * whose hook never takes the hold would have nothing to hold for.
 */
describe("the tables DatabaseService holds as it writes their records", () => {
  const SERVICES_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );

  // Each service whose create hook takes the hold: its file, and the field it holds by.
  function servicesTakingTheHold(): Array<{ file: string; field: string }> {
    return fs
      .readdirSync(SERVICES_DIRECTORY)
      .filter((file: string): boolean => {
        return file.endsWith(".ts");
      })
      .flatMap((file: string): Array<{ file: string; field: string }> => {
        const source: string = fs.readFileSync(
          path.join(SERVICES_DIRECTORY, file),
          "utf8",
        );
        const call: RegExpMatchArray | null = source.match(
          /WorkspaceCreatedMessageFirst\.hold\(\{\s*(\w+):/,
        );

        return call ? [{ file: file, field: call[1]! }] : [];
      });
  }

  test("are the seven kinds whose create posts a Created message", () => {
    expect(WorkspaceCreatedMessageFirst.tablesHeldAsWritten().sort()).toEqual(
      HELD_KINDS.map((kind: HeldKind): string => {
        return new kind.modelType().tableName!;
      }).sort(),
    );
  });

  test("are exactly the tables of the services whose create hook takes the hold, each held by the field its hook holds by", () => {
    const takers: Array<{ file: string; field: string }> =
      servicesTakingTheHold();

    expect(takers.length).toBe(HELD_KINDS.length);

    const heldByTable: Record<string, string> = {};

    for (const taker of takers) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const service: DatabaseService<BaseModel> = require(
        path.join(SERVICES_DIRECTORY, taker.file),
      ).default;

      heldByTable[service.getModel().tableName!] = taker.field;
    }

    expect(Object.keys(heldByTable).sort()).toEqual(
      WorkspaceCreatedMessageFirst.tablesHeldAsWritten().sort(),
    );

    // Each table's record is held as written under the field its hook takes it by.
    for (const kind of HELD_KINDS) {
      expect(heldByTable[new kind.modelType().tableName!]).toBe(kind.field);
    }
  });

  test.each(HELD_KINDS)(
    "$name's record is held as written under its own field",
    async (kind: HeldKind) => {
      const id: ObjectID = ObjectID.generate();
      const expected: WorkspaceRecord = recordWith(kind.field, id);

      heldRecords.push(expected);

      const record: WorkspaceRecord | null =
        await WorkspaceCreatedMessageFirst.holdAsWritten({
          tableName: new kind.modelType().tableName,
          id: id,
        });

      expect(record).toEqual(expected);
      expect(WorkspaceCreatedMessageFirst.isHeld(expected)).toBe(true);

      await WorkspaceCreatedMessageFirst.letGoIfNotTaken(record!);

      expect(WorkspaceCreatedMessageFirst.isHeld(expected)).toBe(false);
    },
  );
});
