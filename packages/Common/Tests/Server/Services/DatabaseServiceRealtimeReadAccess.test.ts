import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService, {
  Service as IncidentServiceClass,
} from "../../../Server/Services/IncidentService";
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
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
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

/*
 * The table linking rows to their labels, as Postgres's metadata names it.
 * A block with labels is a condition on that table; without a database the
 * metadata is not there, and the read is refused rather than let through.
 */
function withLabelLinks(): void {
  const original: typeof QueryUtil.getManyToManyRelationMetadata =
    QueryUtil.getManyToManyRelationMetadata.bind(QueryUtil);

  jest
    .spyOn(QueryUtil, "getManyToManyRelationMetadata")
    .mockImplementation(
      (
        modelType: { new (): BaseModel },
        propertyPath: string,
      ): ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> => {
        if (propertyPath !== "labels") {
          return original(modelType, propertyPath);
        }

        return {
          joinTableName: `${new modelType().tableName}Label`,
          ownerColumnName: "ownerId",
          relationColumnName: "labelId",
        };
      },
    );
}

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

    const asked: FindBy<BaseModel> = findBy.mock
      .calls[0]![0] as FindBy<BaseModel>;
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

describe("DatabaseService.getColumnsNarrowingReadOf", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("someone who reads every record: nothing narrows their read", async () => {
    await expect(
      IncidentService.getColumnsNarrowingReadOf(
        propsWith([{ permission: Permission.ProjectOwner }]),
      ),
    ).resolves.toEqual([]);
  });

  test("a member: private incidents narrow their read by the private switch", async () => {
    await expect(
      IncidentService.getColumnsNarrowingReadOf(
        propsWith([
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
        ]),
      ),
    ).resolves.toEqual(["isPrivate"]);
  });

  test("a grant for some labels narrows the read by the labels", async () => {
    await expect(
      ServiceLevelObjectiveService.getColumnsNarrowingReadOf(
        propsWith([
          {
            permission: Permission.ProjectMember,
            labelIds: [LABEL_ID],
            scope: PermissionScope.Labels,
          },
        ]),
      ),
    ).resolves.toContain("labels");
  });

  test("a block with labels narrows the read by a condition on the row itself", async () => {
    withLabelLinks();

    await expect(
      ServiceLevelObjectiveService.getColumnsNarrowingReadOf(
        propsWith([
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
          {
            permission: Permission.ProjectMember,
            labelIds: [LABEL_ID],
            isBlockPermission: true,
          },
        ]),
      ),
    ).resolves.toContain("_id");
  });

  test("a refused read, or props across projects, cannot be told apart", async () => {
    await expect(
      IncidentService.getColumnsNarrowingReadOf(
        propsWith([{ permission: Permission.ManageProjectBilling }]),
      ),
    ).resolves.toBeNull();
    await expect(
      IncidentService.getColumnsNarrowingReadOf({
        ...propsWith([{ permission: Permission.ProjectOwner }]),
        isMultiTenantRequest: true,
      }),
    ).resolves.toBeNull();
  });
});

describe("updating records: who could read them before the write hears about it too", () => {
  const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";

  const MEMBER: DatabaseCommonInteractionProps = propsWith([
    { permission: Permission.ProjectMember, scope: PermissionScope.All },
  ]);
  const OWNER: DatabaseCommonInteractionProps = propsWith([
    { permission: Permission.ProjectOwner },
  ]);
  const BLOCKED: DatabaseCommonInteractionProps = propsWith([
    { permission: Permission.ProjectOwner },
    {
      permission: Permission.ProjectOwner,
      labelIds: [LABEL_ID],
      isBlockPermission: true,
    },
  ]);

  type SnapshotAsked = {
    tenantId: string;
    modelType: unknown;
    modelIds: Array<ObjectID>;
    access: RealtimeReadAccess;
    eventType: ModelEventType;
    onlyFor: (reader: RealtimeReader) => Promise<boolean>;
  };

  let service: DatabaseService<Incident>;
  let order: Array<string>;
  let decided: RealtimeReadAccess;
  let snapshot: jest.SpyInstance;

  beforeEach(() => {
    order = [];
    RealtimeReaders.clear();

    withLabelLinks();

    // The real service: its read hook keeps private incidents to their owners.
    service = new IncidentServiceClass();
    const table: ReturnType<typeof useInMemoryTable> = useInMemoryTable(
      service as unknown as DatabaseService<BaseModel>,
      [{ _id: RECORD_A, projectId: PROJECT_ID.toString(), isPrivate: false }],
    );

    const write: jest.SpyInstance = table.repository
      .update as unknown as jest.SpyInstance;
    const writeRows: (where: unknown, set: unknown) => Promise<unknown> =
      write.getMockImplementation() as (
        where: unknown,
        set: unknown,
      ) => Promise<unknown>;
    write.mockImplementation(
      async (where: unknown, set: unknown): Promise<unknown> => {
        order.push("write");
        return await writeRows(where, set);
      },
    );

    jest.spyOn(PublishedImages, "afterUpdate").mockResolvedValue(undefined);
    jest
      .spyOn(StatusPageOverviewCache, "afterUpdate")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);

    decided = {
      answersWithoutReading: true,
      readsEveryRecord: async (): Promise<boolean> => {
        return false;
      },
      getReadableIds: async (
        reader: RealtimeReader,
        modelIds: Array<ObjectID>,
      ): Promise<Array<string>> => {
        return reader.key === "could-read-before"
          ? modelIds.map((id: ObjectID): string => {
              return id.toString();
            })
          : [];
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

  async function update(data: Record<string, unknown>): Promise<void> {
    await service.updateBy({
      query: { projectId: PROJECT_ID },
      data: data as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  function askedOf(call: number = 0): SnapshotAsked {
    return snapshot.mock.calls[call]![0] as SnapshotAsked;
  }

  function accessOfEvents(): Array<RealtimeReadAccess | undefined> {
    return (
      service.onTriggerRealtime as unknown as jest.SpyInstance
    ).mock.calls.map((call: Array<unknown>): RealtimeReadAccess | undefined => {
      expect(call[2]).toBe(ModelEventType.Update);
      return (call[3] as { access?: RealtimeReadAccess } | undefined)?.access;
    });
  }

  test("it is decided before the write, for the update's listeners and the rows written", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await update({ isPrivate: true });

    expect(order).toEqual(["decide", "write"]);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const asked: SnapshotAsked = askedOf();
    expect(asked.tenantId).toBe(PROJECT_ID.toString());
    expect(asked.modelType).toBe(Incident);
    expect(asked.eventType).toBe(ModelEventType.Update);
    expect(asked.access).toBe(service.getRealtimeReadAccess());
    expect(
      asked.modelIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([RECORD_A]);
  });

  test("the update events carry both: who can read the row now, and who could before", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
    const now: jest.SpyInstance = jest
      .spyOn(service.getRealtimeReadAccess(), "getReadableIds")
      .mockResolvedValue([]);

    await update({ isPrivate: true });

    const accesses: Array<RealtimeReadAccess | undefined> = accessOfEvents();
    expect(accesses).toHaveLength(1);

    const access: RealtimeReadAccess = accesses[0]!;
    expect(access).not.toBe(service.getRealtimeReadAccess());

    const before: RealtimeReader = readerWith(MEMBER);
    before.key = "could-read-before";

    await expect(
      access.getReadableIds(before, [new ObjectID(RECORD_A)]),
    ).resolves.toEqual([RECORD_A]);
    await expect(
      access.getReadableIds(readerWith(MEMBER), [new ObjectID(RECORD_A)]),
    ).resolves.toEqual([]);
    expect(now).toHaveBeenCalled();
  });

  test("nobody could read the rows before, among those asked: the events carry the service's own access", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
    decided = NO_READER_ACCESS;

    await update({ isPrivate: true });

    expect(accessOfEvents()).toEqual([undefined]);
  });

  test.each([
    [
      "a member, when the private switch is written",
      MEMBER,
      { isPrivate: true },
      true,
    ],
    [
      "a member, when only the title is written",
      MEMBER,
      { title: "Renamed" },
      false,
    ],
    [
      "someone who reads every record, whatever is written",
      OWNER,
      { isPrivate: true },
      false,
    ],
    [
      "someone with a block with labels, when the labels are written",
      BLOCKED,
      { labels: [] },
      true,
    ],
    [
      "someone with a block with labels, when only the title is written",
      BLOCKED,
      { title: "Renamed" },
      false,
    ],
  ] as Array<
    [string, DatabaseCommonInteractionProps, Record<string, unknown>, boolean]
  >)(
    "only those whose read the write may change are asked: %s",
    async (
      _who: string,
      props: DatabaseCommonInteractionProps,
      data: Record<string, unknown>,
      asked: boolean,
    ) => {
      jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

      await update(data);

      await expect(askedOf().onlyFor(readerWith(props))).resolves.toBe(asked);
    },
  );

  test("Realtime not running here, or a model that sends no update events: nothing is decided", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(false);

    await update({ isPrivate: true });

    expect(snapshot).not.toHaveBeenCalled();

    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
    (
      service.getModel() as unknown as { enableWorkflowOn: unknown }
    ).enableWorkflowOn = { create: true, delete: true };

    await update({ isPrivate: false });

    expect(snapshot).not.toHaveBeenCalled();
    expect(order).toEqual(["write", "write"]);
  });
});

describe("deleting records sends delete events only with the delete workflow trigger", () => {
  function deletableIncidents(
    rows: Array<Record<string, unknown>>,
  ): DatabaseService<Incident> {
    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    useInMemoryTable(service as unknown as DatabaseService<BaseModel>, rows);
    jest.spyOn(PublishedImages, "readCascadedRows").mockResolvedValue([]);
    jest.spyOn(PublishedImages, "afterDelete").mockResolvedValue(undefined);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
    return service;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("so nothing is decided before a delete whose rows send no events", async () => {
    const service: DatabaseService<Incident> = deletableIncidents([
      {
        _id: "a0000000-0000-4000-8000-00000000000a",
        projectId: PROJECT_ID.toString(),
      },
    ]);
    const snapshot: jest.SpyInstance = jest
      .spyOn(Realtime, "snapshotReadAccess")
      .mockResolvedValue(NO_READER_ACCESS);

    (
      service.getModel() as unknown as { enableWorkflowOn: unknown }
    ).enableWorkflowOn = { create: true, update: true };

    await service.deleteBy({
      query: { projectId: PROJECT_ID },
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).not.toHaveBeenCalled();
    expect(
      (service.onTriggerRealtime as unknown as jest.SpyInstance).mock.calls,
    ).toEqual([]);
  });

  test("rows of several projects are decided at once, not one project after another", async () => {
    const service: DatabaseService<Incident> = deletableIncidents([
      {
        _id: "a0000000-0000-4000-8000-00000000000a",
        projectId: PROJECT_ID.toString(),
      },
      {
        _id: "b0000000-0000-4000-8000-00000000000b",
        projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    ]);

    let inFlight: number = 0;
    let mostAtOnce: number = 0;

    jest
      .spyOn(Realtime, "snapshotReadAccess")
      .mockImplementation(async (): Promise<RealtimeReadAccess> => {
        inFlight++;
        mostAtOnce = Math.max(mostAtOnce, inFlight);
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 10);
        });
        inFlight--;
        return NO_READER_ACCESS;
      });

    await service.deleteBy({
      query: {},
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(mostAtOnce).toBe(2);
  });
});
