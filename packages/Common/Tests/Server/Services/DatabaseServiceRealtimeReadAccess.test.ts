import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService, {
  Service as IncidentServiceClass,
} from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIConversationMessageService, {
  Service as AIConversationMessageServiceClass,
} from "../../../Server/Services/AIConversationMessageService";
import AIInsightService from "../../../Server/Services/AIInsightService";
import { Service as AIRunServiceClass } from "../../../Server/Services/AIRunService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import { Service as ActionItemServiceClass } from "../../../Server/Services/IncidentPostmortemActionItemService";
import { Service as MonitorServiceClass } from "../../../Server/Services/MonitorService";
import Realtime from "../../../Server/Utils/Realtime";
import RealtimeMetrics, {
  BeforeWriteDecisionOutcome,
} from "../../../Server/Utils/Realtime/RealtimeMetrics";
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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
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
        "a Project Owner",
        propsWith([{ permission: Permission.ProjectOwner }]),
        true,
      ],
      [
        "a Project Admin",
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
        "a Project Owner granted for some labels only",
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

  /*
   * A grant limited to labels reaches a record with no labels of its own
   * through the labelled records it names (an insight through its service),
   * as a block with labels does: its read is narrowed, so live updates are
   * decided record by record.
   */
  test("a record with no labels of its own: a grant for some labels does not read every one, as its read does not", async () => {
    withLabelLinks();

    const labelsReader: DatabaseCommonInteractionProps = propsWith([
      {
        permission: Permission.ProjectMember,
        labelIds: [LABEL_ID],
        scope: PermissionScope.Labels,
      },
    ]);

    await expect(
      AIInsightService.readsEveryRecordInProject(labelsReader),
    ).resolves.toBe(false);
    // One condition on the row's id, over every record the row names.
    await expect(
      AIInsightService.getColumnsNarrowingReadOf(labelsReader),
    ).resolves.toEqual(["_id"]);
  });

  /*
   * A write that names another service may take an insight out of what
   * that reader reaches, so they are asked whether they could read it
   * before; a write that changes nothing they are narrowed by is not.
   */
  test.each([
    ["the service it is about", { telemetryServiceId: true }, true],
    ["only its title", { title: true }, false],
  ] as Array<[string, Record<string, boolean>, boolean]>)(
    "a record with no labels of its own: a grant for some labels may lose it when %s is written",
    async (
      _written: string,
      written: Record<string, boolean>,
      mayChange: boolean,
    ) => {
      withLabelLinks();

      const reader: RealtimeReader = readerWith(
        propsWith([
          {
            permission: Permission.ProjectMember,
            labelIds: [LABEL_ID],
            scope: PermissionScope.Labels,
          },
        ]),
      );

      await expect(
        (
          AIInsightService as unknown as {
            writeMayChangeWhetherTheyRead: (
              reader: RealtimeReader,
              columns: Array<string>,
            ) => Promise<boolean>;
          }
        ).writeMayChangeWhetherTheyRead(reader, Object.keys(written)),
      ).resolves.toBe(mayChange);
    },
  );

  test("a record with no labels of its own: a grant over the whole project reads every one", async () => {
    await expect(
      AIInsightService.readsEveryRecordInProject(
        propsWith([
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
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
      "a member, when the private switch and the title are written",
      MEMBER,
      { isPrivate: true, title: "Renamed" },
      true,
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
      "someone with a block with labels, when the private switch is written",
      BLOCKED,
      { isPrivate: true },
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

  /*
   * No read of an incident is narrowed by its title - nor its state, its
   * severity, its description - so writing them cannot take the incident
   * away from anyone: nobody is asked, here or on the other App servers,
   * and the write does not wait (#8964).
   */
  test.each([
    ["the title", { title: "Renamed" }],
    ["the description", { description: "Checkout fails for some cards." }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a write of %s alone asks nobody before the write, and is heard by whoever reads the incident",
    async (_what: string, data: Record<string, unknown>) => {
      jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

      await update(data);

      expect(snapshot).not.toHaveBeenCalled();
      expect(order).toEqual(["write"]);
      // The service's own access: who reads it after the write.
      expect(accessOfEvents()).toEqual([undefined]);
    },
  );

  test("a write that leaves the rows as they are decides nothing before it", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await update({ isPrivate: true });
    expect(snapshot).toHaveBeenCalledTimes(1);

    snapshot.mockClear();
    order.length = 0;

    // The same again: the row is private already, and sends no event.
    await update({ isPrivate: true });

    expect(snapshot).not.toHaveBeenCalled();
    expect(order).toEqual(["write"]);
    expect(
      (service.onTriggerRealtime as unknown as jest.SpyInstance).mock.calls,
    ).toHaveLength(1);
  });

  /*
   * The row is not private, and the write says so again - the incident's
   * Settings form sends its switches with every save. A switch that is off
   * used to read as "no value" in the comparison, so writing false over
   * false counted as a change and cost a decision before every such save.
   */
  test("writing a switch back as off, where it is off, decides nothing either", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await update({ isPrivate: false });

    expect(snapshot).not.toHaveBeenCalled();
    expect(order).toEqual(["write"]);
    expect(
      (service.onTriggerRealtime as unknown as jest.SpyInstance).mock.calls,
    ).toHaveLength(0);
  });

  test('nor does writing it as the text "false", which the database stores as off', async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await update({ isPrivate: "false" });

    expect(snapshot).not.toHaveBeenCalled();
    expect(
      (service.onTriggerRealtime as unknown as jest.SpyInstance).mock.calls,
    ).toHaveLength(0);
  });

  test("while turning it on is a change: decided before the write, and the event is sent", async () => {
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    await update({ isPrivate: "true" });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["decide", "write"]);
    expect(
      (service.onTriggerRealtime as unknown as jest.SpyInstance).mock.calls,
    ).toHaveLength(1);
  });

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

/*
 * A switch that records who turned it (Archived, with archivedAt and its
 * person) puts those stamps into the write for every row it names. A row
 * already archived keeps who archived it, and when, so writing Archived back
 * as on changes nothing in that row - and costs no decision before the
 * write, as no event follows it. An SLO sends live updates, and records who
 * archived it.
 */
describe("updating a switch that records who turned it, back as it stands", () => {
  const SLO_ROW: string = "c0000000-0000-4000-8000-00000000000c";
  const ARCHIVED_AT: Date = new Date("2026-10-01T08:00:00.000Z");

  let service: DatabaseService<ServiceLevelObjective>;
  let table: ReturnType<typeof useInMemoryTable>;
  let order: Array<string>;
  let snapshot: jest.SpyInstance;

  function events(): Array<Array<unknown>> {
    return (service.onTriggerRealtime as unknown as jest.SpyInstance).mock
      .calls as Array<Array<unknown>>;
  }

  beforeEach(() => {
    order = [];
    RealtimeReaders.clear();

    service = new DatabaseService<ServiceLevelObjective>(ServiceLevelObjective);
    table = useInMemoryTable(service as unknown as DatabaseService<BaseModel>, [
      {
        _id: SLO_ROW,
        projectId: PROJECT_ID.toString(),
        isArchived: true,
        archivedAt: ARCHIVED_AT,
        archivedByUserId: USER_ID.toString(),
      },
    ]);

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
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    snapshot = jest
      .spyOn(Realtime, "snapshotReadAccess")
      .mockImplementation(async (): Promise<RealtimeReadAccess> => {
        order.push("decide");
        return NO_READER_ACCESS;
      });

    /*
     * No read of an SLO is narrowed by Archived, so no update of it is
     * decided on before the write (#8964). Here every column is taken to
     * narrow one, so the decision shows which rows a write changes.
     */
    jest.spyOn(service, "getColumnsAnyReadMayNarrowBy").mockReturnValue(null);
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

  test("the model sends live updates and records who archived it, or this proves nothing", () => {
    expect(service.getModel().enableRealtimeEventsOn?.update).toBe(true);
    expect(service.getModel().enableWorkflowOn?.update).toBe(true);
    expect(service.getModel().isTableColumn("archivedAt")).toBe(true);
  });

  test.each([
    ["true", true],
    ['the text "true"', "true"],
    ['the text "yes"', "yes"],
    ["1", 1],
  ] as Array<[string, unknown]>)(
    "Archived written back as %s over an archived SLO decides nothing and sends nothing",
    async (_label: string, value: unknown) => {
      await update({ isArchived: value });

      expect(snapshot).not.toHaveBeenCalled();
      expect(order).toEqual(["write"]);
      expect(events()).toHaveLength(0);

      // It keeps who archived it, and when.
      const row: Record<string, unknown> = table.get(SLO_ROW)!;
      expect(row["isArchived"]).toBe(true);
      expect(row["archivedAt"]).toEqual(ARCHIVED_AT);
      expect(String(row["archivedByUserId"])).toBe(USER_ID.toString());
    },
  );

  test("unarchiving it is a change: decided before the write, and the event is sent", async () => {
    await update({ isArchived: "false" });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["decide", "write"]);
    expect(events()).toHaveLength(1);

    const row: Record<string, unknown> = table.get(SLO_ROW)!;
    expect(row["isArchived"]).toBe(false);
    expect(row["archivedAt"]).toBeNull();
  });

  test("of two SLOs, only the one the write archives is decided on and heard about", async () => {
    const OTHER_ROW: string = "d0000000-0000-4000-8000-00000000000d";
    table.rows.push({
      _id: OTHER_ROW,
      projectId: PROJECT_ID.toString(),
      isArchived: false,
      archivedAt: null,
    });

    await update({ isArchived: true });

    expect(snapshot).toHaveBeenCalledTimes(1);

    const asked: { modelIds: Array<ObjectID> } = snapshot.mock.calls[0]![0] as {
      modelIds: Array<ObjectID>;
    };

    expect(
      asked.modelIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([OTHER_ROW]);
    expect(events()).toHaveLength(1);
    expect(String(events()[0]![0])).toBe(OTHER_ROW);

    // The SLO archived already keeps its stamps; the other gets them now.
    expect(table.get(SLO_ROW)!["archivedAt"]).toEqual(ARCHIVED_AT);
    expect(table.get(OTHER_ROW)!["archivedAt"]).toBeInstanceOf(Date);
  });
});

/*
 * AN UPDATE NO READ IS NARROWED BY ASKS NOBODY BEFORE THE WRITE (#8964).
 *
 * Every update of a table that announces its changes used to ask, before
 * the write, who listens - on this server and, over the cluster, on every
 * other App server - and only then which of them the written columns could
 * take the rows away from. Most writes can take them from nobody: a
 * monitor's status, an incident's state or title. Those writes now ask
 * nobody: no read anyone makes names a column they write
 * (getColumnsAnyReadMayNarrowBy), so who reads a row after is who read it
 * before. A write that may - a label, a private switch - still decides
 * before it is made, as before.
 */
describe("an update that names no column any read is narrowed by asks nobody before the write (#8964)", () => {
  const MONITOR_A: string = "e0000000-0000-4000-8000-00000000000e";
  const ONLINE: string = "e1000000-0000-4000-8000-0000000000e1";
  const OFFLINE: string = "e2000000-0000-4000-8000-0000000000e2";

  let monitors: DatabaseService<Monitor>;
  let order: Array<string>;
  let snapshot: jest.SpyInstance;
  let skipped: jest.SpyInstance;

  function eventsOf(
    service: DatabaseService<BaseModel>,
  ): Array<{ eventType: unknown; access: unknown }> {
    return (
      service.onTriggerRealtime as unknown as jest.SpyInstance
    ).mock.calls.map((call: Array<unknown>) => {
      return {
        eventType: call[2],
        access: (call[3] as { access?: unknown } | undefined)?.access,
      };
    });
  }

  /*
   * The service's table in memory, every write noted in `order`: a row's
   * columns are updated, a row with its links (labels) is saved.
   */
  function inMemory(
    service: DatabaseService<BaseModel>,
    rows: Array<Record<string, unknown>>,
  ): ReturnType<typeof useInMemoryTable> {
    const table: ReturnType<typeof useInMemoryTable> = useInMemoryTable(
      service,
      rows,
    );

    noteWrites(table.repository.update as unknown as jest.SpyInstance);
    noteWrites(table.repository.save as unknown as jest.SpyInstance);

    return table;
  }

  function noteWrites(write: jest.SpyInstance): void {
    const writeRows: (...args: Array<unknown>) => Promise<unknown> =
      write.getMockImplementation() as (
        ...args: Array<unknown>
      ) => Promise<unknown>;

    write.mockImplementation(
      async (...args: Array<unknown>): Promise<unknown> => {
        order.push("write");
        return await writeRows(...args);
      },
    );
  }

  async function updateMonitor(data: Record<string, unknown>): Promise<void> {
    await monitors.updateOneBy({
      query: { _id: MONITOR_A },
      data: data as never,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  // What a snapshot's caller was asked to keep to (RealtimeAudience).
  function onlyForOf(
    call: number,
  ): (reader: RealtimeReader) => Promise<boolean> {
    return (
      snapshot.mock.calls[call]![0] as {
        onlyFor: (reader: RealtimeReader) => Promise<boolean>;
      }
    ).onlyFor;
  }

  beforeEach(() => {
    order = [];
    RealtimeReaders.clear();
    withLabelLinks();

    jest.spyOn(PublishedImages, "afterUpdate").mockResolvedValue(undefined);
    jest
      .spyOn(StatusPageOverviewCache, "afterUpdate")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
    jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);

    snapshot = jest
      .spyOn(Realtime, "snapshotReadAccess")
      .mockImplementation(async (): Promise<RealtimeReadAccess> => {
        order.push("decide");
        return NO_READER_ACCESS;
      });
    skipped = jest.spyOn(RealtimeMetrics, "recordBeforeWriteDecisionsSkipped");

    monitors = new MonitorServiceClass();
    inMemory(monitors as unknown as DatabaseService<BaseModel>, [
      {
        _id: MONITOR_A,
        projectId: PROJECT_ID.toString(),
        name: "Checkout API",
        currentMonitorStatusId: ONLINE,
        disableActiveMonitoring: false,
        isArchived: false,
        isAllProbesDisconnectedFromThisMonitor: false,
        isNoProbeEnabledOnThisMonitor: false,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the columns some read of a table may be narrowed by", () => {
    test("a monitor's: its labels and links, never its status, its probes' flags or its name", () => {
      const columns: ReadonlySet<string> | null =
        new MonitorServiceClass().getColumnsAnyReadMayNarrowBy();

      expect(columns).not.toBeNull();
      expect(columns!.has("labels")).toBe(true);

      for (const column of [
        "currentMonitorStatusId",
        "currentMonitorStatus",
        "isAllProbesDisconnectedFromThisMonitor",
        "isNoProbeEnabledOnThisMonitor",
        "disableActiveMonitoring",
        "isArchived",
        "name",
        "firstMeasuredAt",
        "_id",
        "projectId",
      ]) {
        expect({ column, narrows: columns!.has(column) }).toEqual({
          column,
          narrows: false,
        });
      }
    });

    test("an incident's: its labels and its private switch, never its state, severity or title", () => {
      const columns: ReadonlySet<string> | null =
        new IncidentServiceClass().getColumnsAnyReadMayNarrowBy();

      expect(columns!.has("labels")).toBe(true);
      expect(columns!.has("isPrivate")).toBe(true);

      for (const column of [
        "currentIncidentStateId",
        "incidentSeverityId",
        "title",
        "description",
      ]) {
        expect({ column, narrows: columns!.has(column) }).toEqual({
          column,
          narrows: false,
        });
      }
    });

    test("an action item read through its incident: the incident, by relation and by key", () => {
      const columns: ReadonlySet<string> | null =
        new ActionItemServiceClass().getColumnsAnyReadMayNarrowBy();

      expect(columns!.has("incident")).toBe(true);
      expect(columns!.has("incidentId")).toBe(true);
      expect(columns!.has("title")).toBe(false);
    });

    test("a person's own AI conversation: whose it is", () => {
      expect(
        new AIConversationMessageServiceClass()
          .getColumnsAnyReadMayNarrowBy()!
          .has("userId"),
      ).toBe(true);
    });

    test("is worked out once per service", () => {
      const service: DatabaseService<Monitor> = new MonitorServiceClass();

      expect(service.getColumnsAnyReadMayNarrowBy()).toBe(
        service.getColumnsAnyReadMayNarrowBy(),
      );
    });

    test("a service whose read hook does not say what it narrows by: it cannot be told", () => {
      class HookedIncidents extends DatabaseService<Incident> {
        public constructor() {
          super(Incident);
        }

        protected override async onBeforeFind(
          findBy: FindBy<Incident>,
        ): Promise<{ findBy: FindBy<Incident>; carryForward: null }> {
          return { findBy, carryForward: null };
        }
      }

      expect(new HookedIncidents().getColumnsReadHooksNarrowBy()).toBeNull();
      expect(new HookedIncidents().getColumnsAnyReadMayNarrowBy()).toBeNull();
      // The base read hook narrows nothing.
      expect(
        new DatabaseService<Incident>(Incident).getColumnsReadHooksNarrowBy(),
      ).toEqual([]);
    });

    test("a table no read of which is told apart before it is made: nothing narrows anyone's", () => {
      class OwnRead extends DatabaseService<Incident> {
        public constructor() {
          super(Incident);
        }

        public override async findBy(
          findBy: FindBy<Incident>,
        ): Promise<Array<Incident>> {
          return await super.findBy(findBy);
        }
      }

      expect(Array.from(new OwnRead().getColumnsAnyReadMayNarrowBy()!)).toEqual(
        [],
      );
    });
  });

  describe("a monitor", () => {
    test("whose status changes asks nobody before the write, and is announced to whoever reads it", async () => {
      await updateMonitor({ currentMonitorStatusId: OFFLINE });

      expect(snapshot).not.toHaveBeenCalled();
      expect(order).toEqual(["write"]);
      expect(
        eventsOf(monitors as unknown as DatabaseService<BaseModel>),
      ).toEqual([{ eventType: ModelEventType.Update, access: undefined }]);
    });

    test.each([
      [
        "every probe disconnected",
        { isAllProbesDisconnectedFromThisMonitor: true },
      ],
      ["no probe left enabled", { isNoProbeEnabledOnThisMonitor: true }],
      ["monitoring turned off", { disableActiveMonitoring: true }],
      ["archived", { isArchived: true }],
      ["renamed", { name: "Checkout API (EU)" }],
    ] as Array<[string, Record<string, unknown>]>)(
      "%s asks nobody before the write either",
      async (_what: string, data: Record<string, unknown>) => {
        await updateMonitor(data);

        expect(snapshot).not.toHaveBeenCalled();
        expect(order).toEqual(["write"]);
        expect(
          eventsOf(monitors as unknown as DatabaseService<BaseModel>),
        ).toHaveLength(1);
      },
    );

    test("whose labels are written may be taken from someone: decided before the write", async () => {
      await updateMonitor({ labels: [] });

      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["decide", "write"]);
      expect(skipped).not.toHaveBeenCalled();
    });

    test("the decision it did not make is counted, one for its project", async () => {
      await updateMonitor({ currentMonitorStatusId: OFFLINE });

      expect(skipped).toHaveBeenCalledTimes(1);
      expect(skipped).toHaveBeenCalledWith({
        tableName: "Monitor",
        eventType: ModelEventType.Update,
        decisions: 1,
      });
    });

    test("a status written back as it stands is no change: nothing decided, nothing counted, nothing sent", async () => {
      await updateMonitor({ currentMonitorStatusId: ONLINE });

      expect(snapshot).not.toHaveBeenCalled();
      expect(skipped).not.toHaveBeenCalled();
      expect(
        eventsOf(monitors as unknown as DatabaseService<BaseModel>),
      ).toHaveLength(0);
    });
  });

  test("an incident made private is decided on before the write, as before", async () => {
    const incidents: DatabaseService<Incident> = new IncidentServiceClass();
    inMemory(incidents as unknown as DatabaseService<BaseModel>, [
      {
        _id: "e3000000-0000-4000-8000-0000000000e3",
        projectId: PROJECT_ID.toString(),
        isPrivate: false,
      },
    ]);

    await incidents.updateBy({
      query: { projectId: PROJECT_ID },
      data: { isPrivate: true } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["decide", "write"]);
  });

  test("a service whose read hook says nothing of what it narrows by decides before every write, as before", async () => {
    class HookedMonitors extends DatabaseService<Monitor> {
      public constructor() {
        super(Monitor);
      }

      protected override async onBeforeFind(
        findBy: FindBy<Monitor>,
      ): Promise<{ findBy: FindBy<Monitor>; carryForward: null }> {
        return { findBy, carryForward: null };
      }
    }

    const hooked: DatabaseService<Monitor> = new HookedMonitors();
    inMemory(hooked as unknown as DatabaseService<BaseModel>, [
      {
        _id: MONITOR_A,
        projectId: PROJECT_ID.toString(),
        currentMonitorStatusId: ONLINE,
      },
    ]);

    await hooked.updateOneBy({
      query: { _id: MONITOR_A },
      data: { currentMonitorStatusId: OFFLINE } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["decide", "write"]);
  });

  /*
   * A read narrowed through the record its rows are read through names the
   * relation itself (an action item's `incident`), and a write may name its
   * key (`incidentId`): moving an action item to another incident may take
   * it from someone, and they are asked.
   */
  test("a write of a record's key reaches a read narrowed by its relation", async () => {
    const items: DatabaseService<BaseModel> =
      new ActionItemServiceClass() as unknown as DatabaseService<BaseModel>;
    inMemory(items, [
      {
        _id: "e4000000-0000-4000-8000-0000000000e4",
        projectId: PROJECT_ID.toString(),
        incidentId: "e5000000-0000-4000-8000-0000000000e5",
      },
    ]);
    jest
      .spyOn(items, "getColumnsNarrowingReadOf")
      .mockResolvedValue(["incident"]);

    await items.updateBy({
      query: { projectId: PROJECT_ID } as never,
      data: { incidentId: "e6000000-0000-4000-8000-0000000000e6" } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    await expect(
      onlyForOf(0)(
        readerWith(
          propsWith([
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.All,
            },
          ]),
        ),
      ),
    ).resolves.toBe(true);
  });

  /*
   * An AI run's read hook puts its condition on the run's type, and the
   * condition reads who started it: a reader the hook narrows is narrowed
   * by both. (An AI run's update announces itself, CodeTaskLive; here the
   * service sends its update events, as a model with the update workflow
   * trigger does.)
   */
  test("a reader narrowed by a read hook is asked about a write of any column the hook reads", async () => {
    const runs: DatabaseService<BaseModel> =
      new AIRunServiceClass() as unknown as DatabaseService<BaseModel>;
    jest
      .spyOn(
        runs as unknown as { sendsRealtimeUpdateEvents: () => boolean },
        "sendsRealtimeUpdateEvents",
      )
      .mockReturnValue(true);
    inMemory(runs, [
      {
        _id: "e7000000-0000-4000-8000-0000000000e7",
        projectId: PROJECT_ID.toString(),
        userId: USER_ID.toString(),
      },
    ]);
    jest
      .spyOn(runs, "getColumnsNarrowingReadOf")
      .mockResolvedValue(["runType"]);

    await runs.updateBy({
      query: { projectId: PROJECT_ID } as never,
      data: { userId: "e8000000-0000-4000-8000-0000000000e8" } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    await expect(
      onlyForOf(0)(
        readerWith(
          propsWith([
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.All,
            },
          ]),
        ),
      ),
    ).resolves.toBe(true);
  });
});

/*
 * The round trip itself, through the real Realtime: a socket server with
 * another App server in its cluster, which answers who listens after a
 * while. A monitor's status change does not ask it; an incident made
 * private does, before the write, and the time it waited is measured.
 */
describe("the other App servers are asked only about a write that may change who reads (#8964)", () => {
  const OTHERS_ANSWER_AFTER_MS: number = 150;

  let askOthers: jest.Mock;
  let decisions: jest.SpyInstance;
  let skipped: jest.SpyInstance;

  beforeEach(() => {
    RealtimeReaders.clear();
    withLabelLinks();

    jest.spyOn(PublishedImages, "afterUpdate").mockResolvedValue(undefined);
    jest
      .spyOn(StatusPageOverviewCache, "afterUpdate")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
    // The delivery after the write is not what is measured here.
    jest.spyOn(Realtime, "emitModelEvent").mockResolvedValue(undefined);

    askOthers = jest.fn(async (): Promise<Array<unknown>> => {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, OTHERS_ANSWER_AFTER_MS);
      });
      // Nobody listens there either.
      return [[]];
    });

    (Realtime as unknown as { socketServer: unknown }).socketServer = {
      // Nobody listens on this server.
      local: {
        in: (): { fetchSockets: () => Promise<Array<unknown>> } => {
          return {
            fetchSockets: async (): Promise<Array<unknown>> => {
              return [];
            },
          };
        },
      },
      of: (): { adapter: unknown } => {
        return {
          adapter: {
            serverCount: async (): Promise<number> => {
              return 2;
            },
            canReachOthers: (): boolean => {
              return true;
            },
          },
        };
      },
      serverSideEmitWithAck: askOthers,
    };

    decisions = jest.spyOn(RealtimeMetrics, "recordBeforeWriteDecision");
    skipped = jest.spyOn(RealtimeMetrics, "recordBeforeWriteDecisionsSkipped");
  });

  afterEach(() => {
    (Realtime as unknown as { socketServer: unknown }).socketServer = null;
    jest.restoreAllMocks();
  });

  test("a monitor's status change asks no other server, and waits for none", async () => {
    const service: DatabaseService<Monitor> = new MonitorServiceClass();
    useInMemoryTable(service as unknown as DatabaseService<BaseModel>, [
      {
        _id: "f0000000-0000-4000-8000-00000000000f",
        projectId: PROJECT_ID.toString(),
        currentMonitorStatusId: "f1000000-0000-4000-8000-0000000000f1",
      },
    ]);

    await service.updateOneBy({
      query: { _id: "f0000000-0000-4000-8000-00000000000f" },
      data: {
        currentMonitorStatusId: "f2000000-0000-4000-8000-0000000000f2",
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(askOthers).not.toHaveBeenCalled();
    expect(decisions).not.toHaveBeenCalled();
    expect(skipped).toHaveBeenCalledWith({
      tableName: "Monitor",
      eventType: ModelEventType.Update,
      decisions: 1,
    });
  });

  test("an incident made private asks them before the write, and what it waited is measured", async () => {
    const service: DatabaseService<Incident> = new IncidentServiceClass();
    useInMemoryTable(service as unknown as DatabaseService<BaseModel>, [
      {
        _id: "f3000000-0000-4000-8000-0000000000f3",
        projectId: PROJECT_ID.toString(),
        isPrivate: false,
      },
    ]);

    await service.updateOneBy({
      query: { _id: "f3000000-0000-4000-8000-0000000000f3" },
      data: { isPrivate: true } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(askOthers).toHaveBeenCalledTimes(1);
    expect(skipped).not.toHaveBeenCalled();
    expect(decisions).toHaveBeenCalledTimes(1);

    const measured: {
      tableName: string;
      eventType: ModelEventType;
      outcome: BeforeWriteDecisionOutcome;
      durationInMs: number;
    } = decisions.mock.calls[0]![0];

    expect(measured.tableName).toBe("Incident");
    expect(measured.eventType).toBe(ModelEventType.Update);
    expect(measured.outcome).toBe(BeforeWriteDecisionOutcome.NobodyCouldRead);
    // The write waited for the other server's answer.
    expect(measured.durationInMs).toBeGreaterThanOrEqual(
      OTHERS_ANSWER_AFTER_MS - 5,
    );
  });
});
