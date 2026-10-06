import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import PublishedImages, {
  CASCADES,
  getCascadedRowsSql,
  PublishedCascade,
} from "../../../Server/Utils/File/PublishedImages";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * DATABASESERVICE KEEPS PUBLISHED IMAGES PUBLIC, AND NOTHING ELSE
 * (PublishedImages).
 *
 * Every create, update and delete of a record that shows what people write
 * to everyone - from the dashboard, the API, a workflow, OneUptime itself -
 * makes the images it shows public, and those it stops showing private, as
 * it writes and before the service's own hooks run (so a notification they
 * queue never links to a private image). An update that writes nothing a
 * record shows reads nothing more and changes no image.
 *
 * The services here are DatabaseService itself with recording hooks, so
 * what is tested is DatabaseService's write path. No database: the
 * repository is an in-memory list of rows, and the visibility asked of each
 * image is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RECORD_ID: string = "eeeeeeee-0000-4000-8000-000000000001";
const NOTE_ID: string = "eeeeeeee-0000-4000-8000-000000000002";

const image: (token: string) => string = (token: string): string => {
  return `![shot](https://oneuptime.example/file/image/access-token/${token})`;
};

interface VisibilityRequest {
  projectId: unknown;
  publish: Iterable<string>;
  unpublish: Iterable<string>;
}

type SetImagesVisibilityMock = Mock<(data: VisibilityRequest) => Promise<void>>;

let setImagesVisibility: SetImagesVisibilityMock;

// The order things happened in: image changes, reads, deletes and hooks.
let events: Array<string>;

// What each image was asked to be, in order: "aaa:public", "bbb:private".
function visibilityAsked(): Array<string> {
  return setImagesVisibility.mock.calls.flatMap(
    (call: [VisibilityRequest]): Array<string> => {
      expect(String(call[0].projectId)).toBe(PROJECT_ID.toString());

      return [
        ...Array.from(call[0].publish).map((token: string): string => {
          return `${token}:public`;
        }),
        ...Array.from(call[0].unpublish).map((token: string): string => {
          return `${token}:private`;
        }),
      ];
    },
  );
}

interface FakeRepository {
  rows: Array<BaseModel>;
  find: Mock<(options: Record<string, unknown>) => Promise<Array<BaseModel>>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<
    (criteria: unknown, data: unknown) => Promise<{ affected: number }>
  >;
  delete: Mock<(criteria: unknown) => Promise<{ affected: number }>>;
  manager: {
    query: Mock<(sql: string, parameters: Array<unknown>) => Promise<unknown>>;
  };
}

// The select each find of the repository was made with.
function selectsAsked(repository: FakeRepository): Array<Array<string>> {
  return repository.find.mock.calls.map(
    (call: [Record<string, unknown>]): Array<string> => {
      return Object.keys(
        (call[0]["select"] as Record<string, unknown>) || {},
      ).sort();
    },
  );
}

function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel> = [],
  // The rows each statement of the database reads, by its SQL.
  answers: Map<string, Array<Record<string, unknown>>> = new Map(),
): FakeRepository {
  const repository: FakeRepository = {
    rows: rows,
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return rows;
    }),
    save: jest.fn(async (entity: unknown): Promise<unknown> => {
      const saved: BaseModel = entity as BaseModel;

      if (!saved._id) {
        saved._id = RECORD_ID;
      }

      return saved;
    }),
    update: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: 1 };
    }),
    delete: jest.fn(async (): Promise<{ affected: number }> => {
      events.push("delete");
      return { affected: rows.length };
    }),
    manager: {
      query: jest.fn(async (sql: string): Promise<unknown> => {
        events.push("read cascaded rows");
        return answers.get(sql) || [];
      }),
    },
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
    undefined as never,
  );

  return repository;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

function userPermission(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

// A project owner of PROJECT_ID, signed in, on a plan that has every feature.
function ownerProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [userPermission(Permission.ProjectOwner)],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

// Services that record when their own hooks run.
class IncidentWrites extends DatabaseService<Incident> {
  public constructor() {
    super(Incident);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Incident>,
    createdItem: Incident,
  ): Promise<Incident> {
    events.push("onCreateSuccess");
    return createdItem;
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Incident>,
  ): Promise<OnUpdate<Incident>> {
    events.push("onUpdateSuccess");
    return onUpdate;
  }
}

class MaintenanceWrites extends DatabaseService<ScheduledMaintenance> {
  public constructor() {
    super(ScheduledMaintenance);
  }
}

class NoteWrites extends DatabaseService<IncidentPublicNote> {
  public constructor() {
    super(IncidentPublicNote);
  }
}

class StatusPageWrites extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }
}

class GroupWrites extends DatabaseService<StatusPageGroup> {
  public constructor() {
    super(StatusPageGroup);
  }
}

function storedIncident(data: {
  description?: string;
  postmortemNote?: string;
  isVisibleOnStatusPage?: boolean;
  showPostmortemOnStatusPage?: boolean;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = RECORD_ID;
  incident.projectId = PROJECT_ID;

  for (const [key, value] of Object.entries(data)) {
    (incident as unknown as Record<string, unknown>)[key] = value;
  }

  return incident;
}

const INCIDENT_SHOWN_COLUMNS: Array<string> = [
  "description",
  "isVisibleOnStatusPage",
  "postmortemNote",
  "showPostmortemOnStatusPage",
];

beforeEach(() => {
  events = [];
  setImagesVisibility = jest.fn(
    async (data: VisibilityRequest): Promise<void> => {
      for (const token of data.publish) {
        events.push(`${token}:public`);
      }

      for (const token of data.unpublish) {
        events.push(`${token}:private`);
      }
    },
  );

  jest
    .spyOn(PublishedImages, "setImagesVisibility")
    .mockImplementation(setImagesVisibility as never);
  jest
    .spyOn(FileService, "getFileOwners")
    .mockResolvedValue(new Map<string, FileOwners>() as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordDelete")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("create", () => {
  test("an incident shown on status pages makes its description's images public, before its own hooks run", async () => {
    const service: IncidentWrites = new IncidentWrites();
    useRepository(service as never);

    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.description = `${image("aaa111")} and ${image("bbb222")}`;
    incident.isVisibleOnStatusPage = true;

    await service.create({ data: incident, props: rootProps() });

    expect(visibilityAsked()).toEqual(["aaa111:public", "bbb222:public"]);
    expect(events).toEqual([
      "aaa111:public",
      "bbb222:public",
      "onCreateSuccess",
    ]);
  });

  test("an incident kept off status pages leaves them private", async () => {
    const service: IncidentWrites = new IncidentWrites();
    useRepository(service as never);

    const incident: Incident = new Incident();
    incident.title = "Database failover drill";
    incident.description = image("aaa111");
    incident.isVisibleOnStatusPage = false;

    await service.create({ data: incident, props: rootProps() });

    expect(visibilityAsked()).toEqual([]);
  });

  test("a switch left to its column's default is read as stored", async () => {
    const service: IncidentWrites = new IncidentWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedIncident({ isVisibleOnStatusPage: true }),
    ]);

    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.description = image("aaa111");

    await service.create({ data: incident, props: rootProps() });

    expect(visibilityAsked()).toEqual(["aaa111:public"]);
    // Only the switch the description is shown by, read once.
    expect(selectsAsked(repository)).toHaveLength(1);
    expect(selectsAsked(repository)[0]).toContain("isVisibleOnStatusPage");
    expect(selectsAsked(repository)[0]).not.toContain("description");
    expect(selectsAsked(repository)[0]).not.toContain("postmortemNote");
  });

  test("a status page group always shows its description", async () => {
    const service: GroupWrites = new GroupWrites();
    useRepository(service as never);

    const group: StatusPageGroup = new StatusPageGroup();
    group.name = "Payments";
    group.description = image("ccc333");
    group.statusPageId = new ObjectID("eeeeeeee-0000-4000-8000-000000000009");

    await service.create({ data: group, props: rootProps() });

    expect(visibilityAsked()).toEqual(["ccc333:public"]);
  });
});

describe("update", () => {
  test("hiding an incident from status pages makes the images it showed private, before its own hooks run", async () => {
    const service: IncidentWrites = new IncidentWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedIncident({
        description: image("aaa111"),
        postmortemNote: image("bbb222"),
        isVisibleOnStatusPage: true,
        showPostmortemOnStatusPage: true,
      }),
    ]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { isVisibleOnStatusPage: false },
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["aaa111:private", "bbb222:private"]);
    expect(events.indexOf("onUpdateSuccess")).toBe(events.length - 1);

    // The row was read with everything it shows, not only what was written.
    expect(selectsAsked(repository)[0]).toEqual(
      expect.arrayContaining(INCIDENT_SHOWN_COLUMNS),
    );
  });

  test("an edit that takes an image out and puts another in", async () => {
    const service: IncidentWrites = new IncidentWrites();
    useRepository(service as never, [
      storedIncident({
        description: image("aaa111"),
        isVisibleOnStatusPage: true,
      }),
    ]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { description: `Updated: ${image("ccc333")}` },
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["ccc333:public", "aaa111:private"]);
  });

  test("an update of nothing an incident shows reads nothing more and changes no image", async () => {
    const service: IncidentWrites = new IncidentWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedIncident({
        description: image("aaa111"),
        isVisibleOnStatusPage: true,
      }),
    ]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { title: "Renamed" },
      props: rootProps(),
    });

    expect(setImagesVisibility).not.toHaveBeenCalled();

    for (const select of selectsAsked(repository)) {
      expect(select).not.toContain("description");
      expect(select).not.toContain("postmortemNote");
    }
  });

  test("showing a maintenance event on status pages makes its description's images public", async () => {
    const service: MaintenanceWrites = new MaintenanceWrites();
    const stored: ScheduledMaintenance = new ScheduledMaintenance();
    stored._id = RECORD_ID;
    stored.projectId = PROJECT_ID;
    stored.description = image("ddd444");
    stored.isVisibleOnStatusPage = false;
    useRepository(service as never, [stored]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { isVisibleOnStatusPage: true },
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["ddd444:public"]);
  });

  test("a project owner editing the status page's overview description, through the permission checks", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const stored: StatusPage = new StatusPage();
    stored._id = RECORD_ID;
    stored.projectId = PROJECT_ID;
    stored.overviewPageDescription = image("aaa111");
    useRepository(service as never, [stored]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { overviewPageDescription: image("bbb222") },
      props: ownerProps(),
    });

    expect(visibilityAsked()).toEqual(["bbb222:public", "aaa111:private"]);
  });

  test("a public note edited with a new image", async () => {
    const service: NoteWrites = new NoteWrites();
    const stored: IncidentPublicNote = new IncidentPublicNote();
    stored._id = RECORD_ID;
    stored.projectId = PROJECT_ID;
    stored.note = "Investigating.";
    useRepository(service as never, [stored]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { note: `Found it: ${image("eee555")}` },
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["eee555:public"]);
  });
});

describe("delete", () => {
  test("a deleted incident's shown images become private", async () => {
    const service: IncidentWrites = new IncidentWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedIncident({
        description: image("aaa111"),
        isVisibleOnStatusPage: true,
      }),
    ]);

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["aaa111:private"]);
    expect(repository.delete).toHaveBeenCalledTimes(1);
    // The rows were read with what they show, before they were deleted.
    expect(selectsAsked(repository).pop()).toEqual(
      expect.arrayContaining(INCIDENT_SHOWN_COLUMNS),
    );
  });

  test("a deleted public note's images become private", async () => {
    const service: NoteWrites = new NoteWrites();
    const stored: IncidentPublicNote = new IncidentPublicNote();
    stored._id = RECORD_ID;
    stored.projectId = PROJECT_ID;
    stored.note = image("fff666");
    useRepository(service as never, [stored]);

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: rootProps(),
    });

    expect(visibilityAsked()).toEqual(["fff666:private"]);
  });

  /*
   * The database deletes an incident's public notes with it, unseen by
   * NoteWrites: DatabaseService reads them before the incident goes, so
   * their images go out of view with the incident's own.
   */
  test("a deleted incident's public notes' images become private with its own, read before the delete", async () => {
    const notesOfIncident: PublishedCascade = CASCADES.find(
      (cascade: PublishedCascade): boolean => {
        return (
          cascade.parentTable === "Incident" &&
          cascade.tableName === "IncidentPublicNote"
        );
      },
    )!;

    const service: IncidentWrites = new IncidentWrites();
    const repository: FakeRepository = useRepository(
      service as never,
      [
        storedIncident({
          description: image("aaa111"),
          isVisibleOnStatusPage: true,
        }),
      ],
      new Map([
        [
          getCascadedRowsSql(notesOfIncident),
          [
            {
              _id: NOTE_ID,
              projectId: PROJECT_ID.toString(),
              note: `Fixed: ${image("abc777")}`,
            },
          ],
        ],
      ]),
    );

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: rootProps(),
    });

    // One request for the project: the incident's image and its note's.
    expect(setImagesVisibility).toHaveBeenCalledTimes(1);
    expect(visibilityAsked()).toEqual(["aaa111:private", "abc777:private"]);

    // The notes were read with the incident's id, while they were there.
    expect(repository.manager.query.mock.calls[0]![1]).toEqual([[RECORD_ID]]);
    expect(events).toEqual([
      "read cascaded rows",
      "delete",
      "aaa111:private",
      "abc777:private",
    ]);
  });

  test("a delete of a table no published row hangs from reads nothing more", async () => {
    const service: NoteWrites = new NoteWrites();
    const stored: IncidentPublicNote = new IncidentPublicNote();
    stored._id = RECORD_ID;
    stored.projectId = PROJECT_ID;
    stored.note = "Investigating.";
    const repository: FakeRepository = useRepository(service as never, [
      stored,
    ]);

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: rootProps(),
    });

    expect(repository.manager.query).not.toHaveBeenCalled();
    expect(setImagesVisibility).not.toHaveBeenCalled();
  });
});
