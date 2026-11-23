import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../Server/Services/SecurityCaseTaskService";
import SecurityCaseStepCheckService from "../../../Server/Services/SecurityCaseStepCheckService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import IncidentPostmortemActionItemService from "../../../Server/Services/IncidentPostmortemActionItemService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import AIInsightService from "../../../Server/Services/AIInsightService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import HostLogSessionService from "../../../Server/Services/HostLogSessionService";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * THE COLUMNS SOME READ MAY BE NARROWED BY, HELD TO THE READS (#8964).
 *
 * An update of a table that announces its changes asks, before it is
 * written, who could read its rows - on every App server - only when it
 * names a column some read of the table may be narrowed by
 * (DatabaseService.getColumnsAnyReadMayNarrowBy). A column left out of that
 * set would let a write take a row away from someone listening without
 * their open page being told to drop it. So, for every service whose model
 * announces its changes, and for people whose reads are narrowed every way
 * the permission rules and the services' own read hooks narrow them - by
 * labels, a block with labels, owners, a private record, a person's own
 * records - every column their read is narrowed by is one of that set
 * (getColumnsNarrowingReadOf, the read's own conditions). And every
 * service's read hook names, in getColumnsReadHooksNarrowBy, every column
 * it puts a condition on.
 *
 * The real services, hooks and permission checks, without Postgres: the
 * conditions a read would add are looked at, not run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
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
        ...(row.scope === PermissionScope.Owned ? { teamId: TEAM_ID } : {}),
      } as UserPermission;
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    userTeamIds: [TEAM_ID],
    // The plan a request carries, so no plan is looked up.
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

/*
 * People whose reads are narrowed every way the rules narrow one: as their
 * project's owner, as a member, limited to labels, blocked from some,
 * limited to what they own - and the reads that are not narrowed at all.
 */
const READERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a Project Owner", propsWith([{ permission: Permission.ProjectOwner }])],
  ["a Project Admin", propsWith([{ permission: Permission.ProjectAdmin }])],
  [
    "a member over the whole project",
    propsWith([
      { permission: Permission.ProjectMember, scope: PermissionScope.All },
    ]),
  ],
  [
    "a member for some labels",
    propsWith([
      {
        permission: Permission.ProjectMember,
        labelIds: [LABEL_ID],
        scope: PermissionScope.Labels,
      },
    ]),
  ],
  [
    "a member blocked from some labels",
    propsWith([
      { permission: Permission.ProjectMember, scope: PermissionScope.All },
      {
        permission: Permission.ProjectMember,
        labelIds: [LABEL_ID],
        isBlockPermission: true,
      },
    ]),
  ],
  [
    "a member of what they own",
    propsWith([
      { permission: Permission.ProjectMember, scope: PermissionScope.Owned },
    ]),
  ],
  [
    "an owner for some labels",
    propsWith([
      {
        permission: Permission.ProjectOwner,
        labelIds: [LABEL_ID],
        scope: PermissionScope.Labels,
      },
    ]),
  ],
  [
    "a reader of every operational resource",
    propsWith([{ permission: Permission.ReadAllOperationalResources }]),
  ],
  [
    "a reader of every operational resource for some labels",
    propsWith([
      {
        permission: Permission.ReadAllOperationalResources,
        labelIds: [LABEL_ID],
        scope: PermissionScope.Labels,
      },
    ]),
  ],
];

/*
 * The services of every model that announces its changes (RealtimeEmitGuard
 * lists the same). A model that starts announcing them is added here.
 */
const SERVICES: Array<DatabaseService<BaseModel>> = [
  IncidentService,
  AlertService,
  IncidentEpisodeService,
  AlertEpisodeService,
  ServiceLevelObjectiveService,
  SecurityCaseService,
  SecurityCaseTaskService,
  // A step's check, read like its case, announces each one OneUptime writes (#10340).
  SecurityCaseStepCheckService,
  IncidentPostmortemActionItemService,
  SecurityPlaybookRunService,
  AIRunService,
  AIRunEventService,
  AIConversationMessageService,
  AIInsightService,
  MonitorService,
  ScheduledMaintenanceService,
  // An Android device moving a log session on shows on its host's Logs page at once (#9806).
  HostLogSessionService,
] as unknown as Array<DatabaseService<BaseModel>>;

const SERVICE_CASES: Array<[string, DatabaseService<BaseModel>]> = SERVICES.map(
  (
    service: DatabaseService<BaseModel>,
  ): [string, DatabaseService<BaseModel>] => {
    return [service.modelType.name, service];
  },
);

// Whether a service keeps the base read hook or has one of its own.
function hasReadHookOfItsOwn(service: DatabaseService<BaseModel>): boolean {
  return (
    (service as unknown as Record<string, unknown>)["onBeforeFind"] !==
    (DatabaseService.prototype as unknown as Record<string, unknown>)[
      "onBeforeFind"
    ]
  );
}

beforeEach(() => {
  /*
   * Without Postgres the join tables of a model's links are unknown, and
   * a label or owner rule refuses the read rather than let it through.
   * Every link is given one, as the database's metadata names them.
   */
  const original: typeof QueryUtil.getManyToManyRelationMetadata =
    QueryUtil.getManyToManyRelationMetadata.bind(QueryUtil);

  jest
    .spyOn(QueryUtil, "getManyToManyRelationMetadata")
    .mockImplementation(
      (
        modelType: { new (): BaseModel },
        propertyPath: string,
      ): ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> => {
        return (
          original(modelType, propertyPath) || {
            joinTableName: `${new modelType().tableName}${propertyPath}`,
            ownerColumnName: "ownerId",
            relationColumnName: "relationId",
          }
        );
      },
    );

  // The records a caller's teams own, as their owner rows would say.
  jest
    .spyOn(
      OwnedScopePermission as unknown as {
        getAllowedResourceIds: () => Promise<Array<ObjectID>>;
      },
      "getAllowedResourceIds",
    )
    .mockResolvedValue([new ObjectID("44444444-4444-4444-8444-444444444444")]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the services listed are every model's that announces its changes", () => {
  test("no more, no fewer", () => {
    expect(
      DatabaseModels.filter((modelType: { new (): BaseModel }): boolean => {
        return Boolean(new modelType().enableRealtimeEventsOn);
      })
        .map((modelType: { new (): BaseModel }): string => {
          return modelType.name;
        })
        .sort(),
    ).toEqual(
      SERVICE_CASES.map(([name]: [string, DatabaseService<BaseModel>]) => {
        return name;
      }).sort(),
    );
  });
});

describe("every column a read is narrowed by is one some read may be narrowed by", () => {
  test.each(SERVICE_CASES)(
    "%s",
    async (_model: string, service: DatabaseService<BaseModel>) => {
      const narrowing: ReadonlySet<string> | null =
        service.getColumnsAnyReadMayNarrowBy();

      // Every model here says what its reads are narrowed by.
      expect(narrowing).not.toBeNull();

      const hookColumns: Array<string> =
        service.getColumnsReadHooksNarrowBy() || [];

      for (const [reader, props] of READERS) {
        const narrowedBy: Array<string> | null =
          await service.getColumnsNarrowingReadOf(props);

        // A read that cannot be told apart narrows by nothing here.
        for (const column of narrowedBy || []) {
          if (column === "_id") {
            continue;
          }

          expect({
            reader,
            column,
            isOne: narrowing!.has(column),
          }).toEqual({ reader, column, isOne: true });
        }

        // What a read hook reads is one too (writeMayChangeWhetherTheyRead).
        for (const column of hookColumns) {
          expect({ column, isOne: narrowing!.has(column) }).toEqual({
            column,
            isOne: true,
          });
        }
      }
    },
  );

  /*
   * The check above would hold for reads that were all refused, or all
   * narrowed by nothing: these are reads it does look at.
   */
  test("reads are narrowed here, by labels, blocks, owners and the services' own hooks", async () => {
    const seen: Set<string> = new Set<string>();
    let toldApart: number = 0;

    for (const [, service] of SERVICE_CASES) {
      for (const [reader, props] of READERS) {
        const narrowedBy: Array<string> | null =
          await service.getColumnsNarrowingReadOf(props);

        if (narrowedBy) {
          toldApart++;
        }

        for (const column of narrowedBy || []) {
          seen.add(`${service.modelType.name}.${column}`);
          seen.add(`${reader}: ${service.modelType.name}.${column}`);
        }
      }
    }

    expect(toldApart).toBeGreaterThan(60);

    for (const column of [
      /*
       * A grant limited to labels: a condition on the row's id - the records
       * the label join table links to a permitted label - which reaches the
       * row's labels (weighed below).
       */
      "a member for some labels: Monitor._id",
      "a member for some labels: Incident._id",
      // A block with labels, an Owned grant: a condition on the row.
      "Monitor._id",
      // A private incident, alert or episode.
      "Incident.isPrivate",
      "Alert.isPrivate",
      // A person's own AI conversation.
      "AIConversationMessage.userId",
      // An action item of a private incident.
      "IncidentPostmortemActionItem.incidentId",
    ]) {
      expect({ column, seen: seen.has(column) }).toEqual({
        column,
        seen: true,
      });
    }

    /*
     * The labels a grant limited to them reaches through the row's id are
     * a column some read may be narrowed by: a write of them asks who reads
     * the row (writeMayChangeWhetherTheyRead).
     */
    for (const service of [MonitorService, IncidentService] as unknown as Array<
      DatabaseService<BaseModel>
    >) {
      expect({
        model: service.modelType.name,
        labelsNarrowSomeRead: service
          .getColumnsAnyReadMayNarrowBy()
          ?.has("labels"),
      }).toEqual({ model: service.modelType.name, labelsNarrowSomeRead: true });
    }
  });
});

describe("a service's own read hook names every column it narrows a read by", () => {
  test.each(
    SERVICE_CASES.filter(
      ([, service]: [string, DatabaseService<BaseModel>]) => {
        return hasReadHookOfItsOwn(service);
      },
    ),
  )("%s", async (_model: string, service: DatabaseService<BaseModel>) => {
    const declared: Array<string> | null =
      service.getColumnsReadHooksNarrowBy();

    // A hook of its own says what it narrows by, or every write would ask.
    expect(declared).not.toBeNull();

    let narrowed: number = 0;

    for (const [reader, props] of READERS) {
      let onFind: OnFind<BaseModel>;

      try {
        onFind = await (
          service as unknown as {
            onBeforeFind: (
              findBy: FindBy<BaseModel>,
            ) => Promise<OnFind<BaseModel>>;
          }
        ).onBeforeFind({
          query: {},
          select: { _id: true } as never,
          skip: 0,
          limit: 1,
          props: props,
        });
      } catch {
        // A read the hook refuses narrows nothing: there is nothing to read.
        continue;
      }

      const columns: Array<string> = Object.keys(onFind.findBy.query || {});

      if (columns.length > 0) {
        narrowed++;
      }

      for (const column of columns) {
        expect({
          reader,
          column,
          declared: declared!.includes(column),
        }).toEqual({ reader, column, declared: true });
      }
    }

    // The hook narrows someone's read here, or this proves nothing.
    expect(narrowed).toBeGreaterThan(0);
  });

  test("the services with no hook of their own narrow nothing by one", () => {
    for (const [name, service] of SERVICE_CASES) {
      if (hasReadHookOfItsOwn(service)) {
        continue;
      }

      expect({ name, declared: service.getColumnsReadHooksNarrowBy() }).toEqual(
        { name, declared: [] },
      );
    }
  });
});
