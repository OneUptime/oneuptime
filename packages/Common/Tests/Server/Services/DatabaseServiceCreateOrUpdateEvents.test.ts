import Monitor from "../../../Models/DatabaseModels/Monitor";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import FileService from "../../../Server/Services/FileService";
import RecordsBeingCreated from "../../../Server/Utils/Database/RecordsBeingCreated";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * ONE SAVE, ONE RUN OF ON CREATE OR UPDATE: WHAT DATABASESERVICE SENDS.
 *
 * A create can change its own record before it has announced it - an
 * on-call policy run sets its status twice in its create's hooks, then its
 * On Create event goes. Each of those changes is an update, and sends an On
 * Update event as it always has. Those events now say they are part of the
 * create (isPartOfCreate), so On Create or Update - which hears the create -
 * does not run for them as well (Types/Workflow/CreateOrUpdateTrigger).
 *
 * This drives DatabaseService's real create and update with the database
 * left out (a repository that keeps nothing), and reads what it posts to the
 * workflow service.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b000",
);
const MONITOR_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b001";

interface Posted {
  // The last parts of the route: model, project, table and event.
  event: Array<string>;
  body: JSONObject;
}

let posted: Array<Posted> = [];

/*
 * A monitor service whose create fills in two of its own fields after the
 * row is written, as some services' hooks do.
 */
class MonitorWithFollowUps extends DatabaseService<Monitor> {
  public followUps: number = 2;
  public failAfterInsert: boolean = false;

  public constructor() {
    super(Monitor);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Monitor>,
    createdItem: Monitor,
  ): Promise<Monitor> {
    for (let index: number = 1; index <= this.followUps; index++) {
      await this.updateOneById({
        id: createdItem.id!,
        data: { description: `Filled in ${index}` } as never,
        props: { isRoot: true },
      });
    }

    if (this.failAfterInsert) {
      throw new Error("A hook failed after the row was written.");
    }

    return createdItem;
  }
}

function useRepository(service: DatabaseService<Monitor>): void {
  let description: string = "As created";

  getJestSpyOn(service, "getRepository").mockReturnValue({
    save: async (entity: unknown): Promise<unknown> => {
      const saved: Monitor = entity as Monitor;
      saved._id = MONITOR_ID;
      return saved;
    },
    update: async (
      _criteria: unknown,
      data: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      if (typeof data["description"] === "string") {
        description = data["description"];
      }

      return { affected: 1 };
    },
    find: async (): Promise<Array<Monitor>> => {
      return [];
    },
  } as never);

  // The row an update reads before it writes: the monitor as it stands.
  getJestSpyOn(service, "_findBy").mockImplementation((async () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.projectId = PROJECT_ID;
    monitor.description = description;
    return [monitor];
  }) as never);

  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

function newMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = "Checkout API";
  monitor.description = "As created";
  monitor.projectId = PROJECT_ID;
  return monitor;
}

// What each post said: its event, and whether it was part of a create.
function summary(): Array<[string, boolean]> {
  return posted.map((post: Posted): [string, boolean] => {
    return [post.event[3]!, post.body["isPartOfCreate"] === true];
  });
}

beforeEach(() => {
  posted = [];

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { route: { toString: () => string } };
    data: JSONObject;
  }) => {
    const segments: Array<string> = options.url.route
      .toString()
      .split("/")
      .filter((segment: string): boolean => {
        return segment.length > 0;
      });

    posted.push({ event: segments.slice(-4), body: options.data });

    return {};
  }) as never);

  jest
    .spyOn(PublishedImages, "setImagesVisibility")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(FileService, "getFileOwners")
    .mockResolvedValue(new Map() as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create that changes its own record", () => {
  test("sends those changes as updates that are part of it, then its create", async () => {
    const service: MonitorWithFollowUps = new MonitorWithFollowUps();
    useRepository(service);

    await service.create({ data: newMonitor(), props: rootProps() });

    expect(summary()).toEqual([
      ["on-update", true],
      ["on-update", true],
      ["on-create", false],
    ]);

    // Addressed as every model event is: the project, the table, the event.
    expect(posted[0]!.event).toEqual([
      "model",
      PROJECT_ID.toString(),
      "monitor",
      "on-update",
    ]);
    // What a run receives is what it always was; the flag is beside it.
    expect(posted[0]!.body["data"]).toEqual({
      _id: MONITOR_ID,
      miscData: { updatedFields: { description: "Filled in 1" } },
    });
    expect(posted[2]!.body).toEqual({
      data: { _id: MONITOR_ID, miscData: undefined },
    });
  });

  test("is done once announced: a change after it is an update like any other", async () => {
    const service: MonitorWithFollowUps = new MonitorWithFollowUps();
    useRepository(service);

    await service.create({ data: newMonitor(), props: rootProps() });

    posted = [];

    await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: { description: "Edited later" } as never,
      props: rootProps(),
    });

    expect(summary()).toEqual([["on-update", false]]);
    expect(posted[0]!.body).not.toHaveProperty("isPartOfCreate");
    expect(RecordsBeingCreated.count()).toBe(0);
  });

  test("a create whose hooks change nothing sends its create alone", async () => {
    const service: MonitorWithFollowUps = new MonitorWithFollowUps();
    service.followUps = 0;
    useRepository(service);

    await service.create({ data: newMonitor(), props: rootProps() });

    expect(summary()).toEqual([["on-create", false]]);
  });

  test("a create that fails after its row is written leaves nothing marked", async () => {
    const service: MonitorWithFollowUps = new MonitorWithFollowUps();
    service.failAfterInsert = true;
    useRepository(service);

    await expect(
      service.create({ data: newMonitor(), props: rootProps() }),
    ).rejects.toThrow();

    // Its own changes were part of it; nothing was announced.
    expect(summary()).toEqual([
      ["on-update", true],
      ["on-update", true],
    ]);
    expect(RecordsBeingCreated.count()).toBe(0);
    expect(
      RecordsBeingCreated.isBeingCreated({
        tableName: "Monitor",
        id: MONITOR_ID,
      }),
    ).toBe(false);
  });
});

describe("an event that is not an update of a record being created", () => {
  test("is never said to be part of a create", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const done: () => void = RecordsBeingCreated.start({
      tableName: "Monitor",
      id: MONITOR_ID,
    });

    try {
      await service.onTriggerWorkflow(
        new ObjectID(MONITOR_ID),
        PROJECT_ID,
        "on-create",
      );
      await service.onTriggerWorkflow(
        new ObjectID(MONITOR_ID),
        PROJECT_ID,
        "on-delete",
      );
      // Another record's update, while this one is being created.
      await service.onTriggerWorkflow(
        ObjectID.generate(),
        PROJECT_ID,
        "on-update",
        { updatedFields: { name: "Other" } },
      );
      // This record's own: part of its create.
      await service.onTriggerWorkflow(
        new ObjectID(MONITOR_ID),
        PROJECT_ID,
        "on-update",
        { updatedFields: { name: "Checkout API" } },
      );
    } finally {
      done();
    }

    expect(summary()).toEqual([
      ["on-create", false],
      ["on-delete", false],
      ["on-update", false],
      ["on-update", true],
    ]);
  });
});
