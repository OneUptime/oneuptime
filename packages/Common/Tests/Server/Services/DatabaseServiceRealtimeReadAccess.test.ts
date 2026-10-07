import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import AIInsightService from "../../../Server/Services/AIInsightService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import Realtime from "../../../Server/Utils/Realtime";
import RealtimeReaders from "../../../Server/Utils/Realtime/RealtimeReaders";
import {
  NO_READER_ACCESS,
  RealtimeReadAccess,
  RealtimeReader,
} from "../../../Server/Utils/Realtime/RealtimeReadAccess";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import FindBy from "../../../Server/Types/Database/FindBy";
import Incident from "../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import UserType from "../../../Types/UserType";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHO MAY HEAR ABOUT A RECORD, as a service answers it for Realtime: the
 * record's own read.
 *
 *   - readsEveryRecordInProject: whether what findBy does before it queries
 *     - the service's read hooks, then the permission check - adds nothing
 *     beyond the project for these props. Such a listener hears about every
 *     record with no read per record; anyone else is read record by record.
 *   - getRealtimeReadAccess().getReadableIds: the records of a batch the
 *     listener's own findBy finds.
 *   - onTriggerRealtime hands Realtime the service's access, or the one
 *     decided before a delete.
 *
 * These run the real services, hooks and permission checks, without
 * Postgres: the conditions a read would add are looked at, not run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const LABEL_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

interface Row {
  permission: Permission;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
  scope?: PermissionScope | undefined;
}

function propsWith(
  rows: Array<Row>,
  extra: DatabaseCommonInteractionProps = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      { permission: Permission.CurrentUser },
      { permission: Permission.ProjectUser },
      ...rows,
    ].map((row: Row): UserPermission => {
      return {
        _type: "UserPermission",
        permission: row.permission,
        labelIds: row.labelIds || [],
        isBlockPermission: Boolean(row.isBlockPermission),
        scope: row.scope,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    userTeamIds: [],
    // The plan a request carries, so no plan is looked up.
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

function readerWith(props: DatabaseCommonInteractionProps): RealtimeReader {
  const remembered: Map<string, Promise<unknown>> = new Map<
    string,
    Promise<unknown>
  >();

  return {
    key: "reader",
    props: props,
    remember: <T>(name: string, work: () => Promise<T>): Promise<T> => {
      if (!remembered.has(name)) {
        remembered.set(name, work());
      }

      return remembered.get(name) as Promise<T>;
    },
  };
}

type AnyService = DatabaseService<BaseModel>;

describe("DatabaseService.readsEveryRecordInProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("incidents and alerts: private records are read by their owners and the project's owners and admins", () => {
    test.each([
      [
        "a project owner",
        propsWith([{ permission: Permission.ProjectOwner }]),
        true,
      ],
      [
        "a project admin",
        propsWith([{ permission: Permission.ProjectAdmin }]),
        true,
      ],
      [
        "a server admin",
        { userId: USER_ID, isMasterAdmin: true, tenantId: PROJECT_ID },
        true,
      ],
      [
        "a project member (private records are read record by record)",
        propsWith([
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
        ]),
        false,
      ],
      [
        "a project owner granted for some labels only",
        propsWith([
          {
            permission: Permission.ProjectOwner,
            labelIds: [LABEL_ID],
            scope: PermissionScope.Labels,
          },
        ]),
        false,
      ],
      [
        "someone who may not read the table at all",
        propsWith([{ permission: Permission.ManageProjectBilling }]),
        false,
      ],
      [
        "someone whose read is blocked outright",
        propsWith([
          { permission: Permission.ProjectOwner },
          { permission: Permission.ProjectOwner, isBlockPermission: true },
        ]),
        false,
      ],
    ] as Array<[string, DatabaseCommonInteractionProps, boolean]>)(
      "%s",
      async (
        _who: string,
        props: DatabaseCommonInteractionProps,
        expected: boolean,
      ) => {
        await expect(
          IncidentService.readsEveryRecordInProject(props),
        ).resolves.toBe(expected);
        await expect(
          AlertService.readsEveryRecordInProject(props),
        ).resolves.toBe(expected);
      },
    );
  });

  describe("SLOs: labels and the operational wildcard, nothing private", () => {
    test.each([
      [
        "a project member over the whole project",
        propsWith([
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
        ]),
        true,
      ],
      [
        "Read All Operational Resources",
        propsWith([{ permission: Permission.ReadAllOperationalResources }]),
        true,
      ],
      [
        "a project member for some labels only",
        propsWith([
          {
            permission: Permission.ProjectMember,
            labelIds: [LABEL_ID],
            scope: PermissionScope.Labels,
          },
        ]),
        false,
      ],
      [
        "Read All Operational Resources, blocked itself",
        propsWith([
          { permission: Permission.ReadAllOperationalResources },
          {
            permission: Permission.ReadAllOperationalResources,
            isBlockPermission: true,
          },
        ]),
        false,
      ],
    ] as Array<[string, DatabaseCommonInteractionProps, boolean]>)(
      "%s",
      async (
        _who: string,
        props: DatabaseCommonInteractionProps,
        expected: boolean,
      ) => {
        await expect(
          ServiceLevelObjectiveService.readsEveryRecordInProject(props),
        ).resolves.toBe(expected);
      },
    );
  });

  test("a person's own AI conversations: nobody but a server admin reads every record", async () => {
    const owner: DatabaseCommonInteractionProps = propsWith([
      { permission: Permission.ProjectOwner },
    ]);

    await expect(
      AIRunEventService.readsEveryRecordInProject(owner),
    ).resolves.toBe(false);
    await expect(
      AIConversationMessageService.readsEveryRecordInProject(owner),
    ).resolves.toBe(false);
    await expect(
      AIRunEventService.readsEveryRecordInProject({
        userId: USER_ID,
        isMasterAdmin: true,
        tenantId: PROJECT_ID,
      }),
    ).resolves.toBe(true);
  });

  test("a record with no labels of its own: a grant for some labels reads every one, as its read does", async () => {
    await expect(
      AIInsightService.readsEveryRecordInProject(
        propsWith([
          {
            permission: Permission.ProjectMember,
            labelIds: [LABEL_ID],
            scope: PermissionScope.Labels,
          },
        ]),
      ),
    ).resolves.toBe(true);
  });

  test("props without a project, or across projects, never read every record", async () => {
    const owner: DatabaseCommonInteractionProps = propsWith([
      { permission: Permission.ProjectOwner },
    ]);

    await expect(
      IncidentService.readsEveryRecordInProject({
        ...owner,
        tenantId: undefined,
      }),
    ).resolves.toBe(false);
    await expect(
      IncidentService.readsEveryRecordInProject({
        ...owner,
        isMultiTenantRequest: true,
      }),
    ).resolves.toBe(false);
  });

  test("a model without a project column never reads every record", async () => {
    const labels: AnyService = new DatabaseService<BaseModel>(
      Label as unknown as { new (): BaseModel },
    );
    jest.spyOn(labels.getModel(), "getTenantColumn").mockReturnValue(null);

    await expect(
      labels.readsEveryRecordInProject(
        propsWith([{ permission: Permission.ProjectOwner }]),
      ),
    ).resolves.toBe(false);
  });

  describe("a service that narrows its reads anywhere but onBeforeFind is read record by record", () => {
    class ReplacesFindBy extends DatabaseService<Incident> {
      public constructor() {
        super(Incident);
      }

      public override async findBy(
        findBy: FindBy<Incident>,
      ): Promise<Array<Incident>> {
        return (await super.findBy(findBy)).slice(0, 1);
      }
    }

    class FiltersWhatWasFound extends DatabaseService<Incident> {
      public constructor() {
        super(Incident);
      }

      protected override async onFindSuccess(
        onFind: { findBy: FindBy<Incident>; carryForward: unknown },
        items: Array<Incident>,
      ): Promise<{ findBy: FindBy<Incident>; carryForward: Array<Incident> }> {
        return {
          findBy: onFind.findBy,
          carryForward: items.slice(0, 1),
        };
      }
    }

    test.each([
      ["a findBy of its own", new ReplacesFindBy()],
      ["a filter on what was found", new FiltersWhatWasFound()],
    ] as Array<[string, AnyService]>)(
      "%s",
      async (_how: string, service: AnyService) => {
        const owner: DatabaseCommonInteractionProps = propsWith([
          { permission: Permission.ProjectOwner },
        ]);

        // A plain service over the same table reads every record...
        await expect(
          new DatabaseService<Incident>(Incident).readsEveryRecordInProject(
            owner,
          ),
        ).resolves.toBe(true);

        // ...this one is never taken to.
        await expect(service.readsEveryRecordInProject(owner)).resolves.toBe(
          false,
        );
      },
    );
  });
});

describe("DatabaseService.getRealtimeReadAccess", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is one access per service, so a table's events go in one delivery", () => {
    expect(IncidentService.getRealtimeReadAccess()).toBe(
      IncidentService.getRealtimeReadAccess(),
    );
    expect(IncidentService.getRealtimeReadAccess()).not.toBe(
      AlertService.getRealtimeReadAccess(),
    );
  });

  test("the records of a batch a listener may read are the ones their own findBy finds", async () => {
    const service: AnyService = new DatabaseService<BaseModel>(
      Incident as unknown as { new (): BaseModel },
    );
    const props: DatabaseCommonInteractionProps = propsWith([
      { permission: Permission.ProjectMember },
    ]);
    const recordA: ObjectID = ObjectID.generate();
    const recordB: ObjectID = ObjectID.generate();
    const found: Incident = new Incident();
    found._id = recordB.toString();

    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findBy",
    ).mockResolvedValue([found]);

    await expect(
      service
        .getRealtimeReadAccess()
        .getReadableIds(readerWith(props), [recordA, recordB]),
    ).resolves.toEqual([recordB.toString()]);

    expect(findBy).toHaveBeenCalledTimes(1);

    const asked: FindBy<BaseModel> = findBy.mock.calls[0]![0] as FindBy<BaseModel>;
    expect(asked.props).toBe(props);
    expect(asked.select).toEqual({ _id: true });
    expect(asked.limit).toBe(2);
    expect(asked.skip).toBe(0);

    // `_id IN (...)` over exactly the batch's records.
    const idCondition: FindOperator<unknown> = (
      asked.query as unknown as { _id: FindOperator<unknown> }
    )._id;
    expect(idCondition).toBeInstanceOf(FindOperator);
    expect(Object.values(idCondition.objectLiteralParameters || {})).toEqual([
      [recordA.toString(), recordB.toString()],
    ]);
  });

  test("no records: nothing is read", async () => {
    const service: AnyService = new DatabaseService<BaseModel>(
      Incident as unknown as { new (): BaseModel },
    );
    const findBy: jest.SpyInstance = getJestSpyOn(service, "findBy");

    await expect(
      service
        .getRealtimeReadAccess()
        .getReadableIds(
          readerWith(propsWith([{ permission: Permission.ProjectMember }])),
          [],
        ),
    ).resolves.toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("whether a listener reads every record is worked out once for them, per table", async () => {
    const service: AnyService = new DatabaseService<BaseModel>(
      Incident as unknown as { new (): BaseModel },
    );
    const probe: jest.SpyInstance = getJestSpyOn(
      service,
      "readsEveryRecordInProject",
    ).mockResolvedValue(true);
    const reader: RealtimeReader = readerWith(
      propsWith([{ permission: Permission.ProjectOwner }]),
    );

    await service.getRealtimeReadAccess().readsEveryRecord(reader);
    await service.getRealtimeReadAccess().readsEveryRecord(reader);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(reader.props);
  });
});

describe("DatabaseService.onTriggerRealtime", () => {
  let emitted: jest.SpyInstance;

  beforeEach(() => {
    emitted = jest
      .spyOn(Realtime, "emitModelEvent")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("hands Realtime the service's own access", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
    const recordId: ObjectID = ObjectID.generate();

    await IncidentService.onTriggerRealtime(
      recordId,
      PROJECT_ID,
      ModelEventType.Update,
    );

    expect(emitted).toHaveBeenCalledWith({
      tenantId: PROJECT_ID,
      eventType: ModelEventType.Update,
      modelId: recordId,
      modelType: Incident,
      access: IncidentService.getRealtimeReadAccess(),
    });
  });

  test("or the access it is given, for records no read can find any more", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await IncidentService.onTriggerRealtime(
      ObjectID.generate(),
      PROJECT_ID,
      ModelEventType.Delete,
      { access: NO_READER_ACCESS },
    );

    expect(
      (emitted.mock.calls[0]![0] as { access: RealtimeReadAccess }).access,
    ).toBe(NO_READER_ACCESS);
  });

  test("sends nothing when Realtime is not running here, or the model does not send that kind of event", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(false);

    await IncidentService.onTriggerRealtime(
      ObjectID.generate(),
      PROJECT_ID,
      ModelEventType.Update,
    );

    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    // SLOs send updates only.
    await ServiceLevelObjectiveService.onTriggerRealtime(
      ObjectID.generate(),
      PROJECT_ID,
      ModelEventType.Delete,
    );

    expect(emitted).not.toHaveBeenCalled();
  });
});

describe("deleting records: who may hear about it is decided before the rows go", () => {
  const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";
  const RECORD_B: string = "b0000000-0000-4000-8000-00000000000b";

  let service: DatabaseService<Incident>;
  let order: Array<string>;
  let decided: RealtimeReadAccess;
  let snapshot: jest.SpyInstance;

  beforeEach(() => {
    order = [];
    RealtimeReaders.clear();

    service = new DatabaseService<Incident>(Incident);
    const table: ReturnType<typeof useInMemoryTable> = useInMemoryTable(
      service as unknown as DatabaseService<BaseModel>,
      [
        { _id: RECORD_A, projectId: PROJECT_ID.toString() },
        { _id: RECORD_B, projectId: PROJECT_ID.toString() },
      ],
    );

    const remove: jest.SpyInstance = table.repository
      .delete as unknown as jest.SpyInstance;
    const deleteRows: (where: unknown) => Promise<unknown> =
      remove.getMockImplementation() as (where: unknown) => Promise<unknown>;
    remove.mockImplementation(async (where: unknown): Promise<unknown> => {
      order.push("delete");
      return await deleteRows(where);
    });

    jest.spyOn(PublishedImages, "readCascadedRows").mockResolvedValue([]);
    jest.spyOn(PublishedImages, "afterDelete").mockResolvedValue(undefined);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);

    decided = {
      readsEveryRecord: async (): Promise<boolean> => {
        return false;
      },
      getReadableIds: async (): Promise<Array<string>> => {
        return [];
      },
    };

    snapshot = jest
      .spyOn(Realtime, "snapshotReadAccess")
      .mockImplementation(async (): Promise<RealtimeReadAccess> => {
        order.push("decide");
        return decided;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the decision is made while the rows are there, and the delete events carry it", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await service.deleteBy({
      query: { projectId: PROJECT_ID },
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(order).toEqual(["decide", "delete"]);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const asked: {
      tenantId: string;
      modelType: unknown;
      modelIds: Array<ObjectID>;
      access: RealtimeReadAccess;
    } = snapshot.mock.calls[0]![0] as {
      tenantId: string;
      modelType: unknown;
      modelIds: Array<ObjectID>;
      access: RealtimeReadAccess;
    };

    expect(asked.tenantId).toBe(PROJECT_ID.toString());
    expect(asked.modelType).toBe(Incident);
    expect(asked.access).toBe(service.getRealtimeReadAccess());
    expect(
      asked.modelIds
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    ).toEqual([RECORD_A, RECORD_B]);

    const triggered: Array<Array<unknown>> = (
      service.onTriggerRealtime as unknown as jest.SpyInstance
    ).mock.calls;

    expect(triggered).toHaveLength(2);

    for (const call of triggered) {
      expect(call[2]).toBe(ModelEventType.Delete);
      expect((call[3] as { access: RealtimeReadAccess }).access).toBe(decided);
    }
  });

  test("Realtime not running here: nothing is decided, nothing is read for it", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(false);

    await service.deleteBy({
      query: { projectId: PROJECT_ID },
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).not.toHaveBeenCalled();
    expect(order).toEqual(["delete"]);
  });
});
