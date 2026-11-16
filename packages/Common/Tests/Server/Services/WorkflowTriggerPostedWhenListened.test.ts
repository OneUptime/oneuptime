import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import WorkflowListeners from "../../../Server/Utils/Workflow/WorkflowListeners";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * A WRITE POSTS ITS WORKFLOW TRIGGER ONLY WHEN A WORKFLOW LISTENS, AND A
 * WORKFLOW'S CHANGE IS HEARD BY THE NEXT WRITE (issue #8861).
 *
 * This drives DatabaseService's real create, update and delete with the
 * database left out (a repository that keeps nothing), and reads what it
 * posts to the workflow service, and what it tells WorkflowListeners:
 *
 *   - a write of a model a workflow can watch asks whether a workflow of its
 *     project listens to its trigger - the model's own, and On Create or
 *     Update for a create or an update - and posts only when one does;
 *   - every create, update (with its hooks or without) and delete of a
 *     workflow says its project's workflows changed, once the write is done.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd4b100",
);
const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4b101";

let posted: Array<Array<string>> = [];

// A repository that keeps nothing: what a write is handed back, and the row read before an update.
function useRepository<TModel extends Monitor | Workflow>(
  service: DatabaseService<TModel>,
  row: () => TModel,
  order: Array<string>,
): void {
  getJestSpyOn(service, "getRepository").mockReturnValue({
    save: async (entity: unknown): Promise<unknown> => {
      order.push("written");
      const saved: TModel = entity as TModel;
      saved._id = RECORD_ID;
      return saved;
    },
    update: async (): Promise<{ affected: number }> => {
      order.push("written");
      return { affected: 1 };
    },
    delete: async (): Promise<{ affected: number }> => {
      order.push("written");
      return { affected: 1 };
    },
    find: async (): Promise<Array<TModel>> => {
      return [];
    },
  } as never);

  getJestSpyOn(service, "_findBy").mockImplementation((async () => {
    return [row()];
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

function monitor(): Monitor {
  const each: Monitor = new Monitor();
  each._id = RECORD_ID;
  each.projectId = PROJECT_ID;
  each.name = "Checkout API";
  each.description = "As it was";
  return each;
}

function workflow(): Workflow {
  const each: Workflow = new Workflow();
  each._id = RECORD_ID;
  each.projectId = PROJECT_ID;
  each.name = "Page the database team";
  each.isEnabled = false;
  return each;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

let isListening: boolean = true;
let asked: Array<{ projectId: string; triggerIds: Array<string> }> = [];

beforeEach(() => {
  posted = [];
  asked = [];
  isListening = true;

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { route: { toString: () => string } };
  }) => {
    posted.push(
      options.url.route
        .toString()
        .split("/")
        .filter((segment: string): boolean => {
          return segment.length > 0;
        })
        .slice(-2),
    );

    return {};
  }) as never);

  jest
    .spyOn(WorkflowListeners, "isAnyListening")
    .mockImplementation(
      async (data: { projectId: ObjectID; triggerIds: Array<string> }) => {
        asked.push({
          projectId: data.projectId.toString(),
          triggerIds: data.triggerIds,
        });
        return isListening;
      },
    );

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

describe("a write of a model a workflow can watch", () => {
  test("posts nothing when no workflow of its project listens", async () => {
    isListening = false;
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    useRepository(service, monitor, []);

    await service.create({ data: monitor(), props: rootProps() });
    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { description: "Edited" } as never,
      props: rootProps(),
    });

    expect(posted).toEqual([]);
    // It asked, for each write.
    expect(asked).toHaveLength(2);
  });

  test("posts its trigger when one does, as before", async () => {
    isListening = true;
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    useRepository(service, monitor, []);

    await service.create({ data: monitor(), props: rootProps() });
    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { description: "Edited" } as never,
      props: rootProps(),
    });

    expect(posted).toEqual([
      ["monitor", "on-create"],
      ["monitor", "on-update"],
    ]);
  });

  test("asks about its project and its own trigger, and On Create or Update for a create and an update", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-create",
    );
    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-update",
    );
    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-delete",
    );

    expect(asked).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        triggerIds: ["monitor-on-create", "monitor-on-create-or-update"],
      },
      {
        projectId: PROJECT_ID.toString(),
        triggerIds: ["monitor-on-update", "monitor-on-create-or-update"],
      },
      {
        projectId: PROJECT_ID.toString(),
        triggerIds: ["monitor-on-delete"],
      },
    ]);
  });

  test("when it cannot be told - WorkflowListeners itself, with no Redis - the trigger is posted", async () => {
    jest.restoreAllMocks();
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: { route: { toString: () => string } };
    }) => {
      posted.push(options.url.route.toString().split("/").slice(-2));
      return {};
    }) as never);

    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );

    await service.onTriggerWorkflow(
      new ObjectID(RECORD_ID),
      PROJECT_ID,
      "on-delete",
    );

    expect(posted).toEqual([["monitor", "on-delete"]]);
  });
});

describe("a write of a workflow", () => {
  let changed: Array<Array<string>>;
  let order: Array<string>;

  beforeEach(() => {
    changed = [];
    order = [];

    jest
      .spyOn(WorkflowListeners, "changed")
      .mockImplementation(async (projectIds: Array<unknown>) => {
        order.push("changed");
        changed.push(
          projectIds.map((projectId: unknown): string => {
            return String(projectId);
          }),
        );
      });
  });

  test("created: says its project's workflows changed, once its row is written", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    useRepository(service, workflow, order);

    await service.create({ data: workflow(), props: rootProps() });

    expect(changed).toEqual([[PROJECT_ID.toString()]]);
    expect(order).toEqual(["written", "changed"]);
  });

  test("turned on, archived or given another trigger: says so, once its row is written", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    useRepository(service, workflow, order);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { isEnabled: true } as never,
      props: rootProps(),
    });

    expect(changed).toEqual([[PROJECT_ID.toString()]]);
    expect(order).toEqual(["written", "changed"]);
  });

  test("written with no hooks - as the trigger is saved from the graph - says so too", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    useRepository(service, workflow, order);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { triggerId: "incident-on-create" } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(changed).toEqual([[PROJECT_ID.toString()]]);
  });

  test("deleted: says so, once it is gone", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    useRepository(service, workflow, order);
    getJestSpyOn(service, "readRowsDeletedWith").mockResolvedValue([] as never);
    getJestSpyOn(service, "getRealtimeAccessBeforeDelete").mockResolvedValue(
      new Map() as never,
    );
    getJestSpyOn(service, "readAttachedFilesOfRowsDeleted").mockResolvedValue(
      new Map() as never,
    );

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: rootProps(),
    });

    expect(changed).toEqual([[PROJECT_ID.toString()]]);
    expect(order).toEqual(["written", "changed"]);
  });

  test("a write of any other model says nothing of workflows", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    useRepository(service, monitor, order);

    await service.create({ data: monitor(), props: rootProps() });
    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { description: "Edited" } as never,
      props: rootProps(),
    });

    expect(changed).toEqual([]);
  });
});
