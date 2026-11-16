import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import ProjectSCIM from "../../../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../../../Models/DatabaseModels/StatusPageSCIM";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import UserWebhook from "../../../../../Models/DatabaseModels/UserWebhook";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import SortValidator from "../../../../../Server/Types/Database/Permissions/SortValidator";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import { isOwnerOnlyColumn } from "../../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import TableAccessControl from "../../../../../Types/Database/AccessControl/TableAccessControl";
import { ListOrderSettings } from "../../../../../Types/Database/ListOrderColumn";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import ModelTableColumn from "../../../../../UI/Components/ModelTable/Column";
import {
  RelationColumnSort,
  getRelationColumnSort,
  getRelationColumnSortValue,
} from "../../../../../UI/Components/ModelTable/ColumnSort";
import FieldType from "../../../../../UI/Components/Types/FieldType";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A SORT IS HELD TO THE READ OF EVERY COLUMN IT NAMES (#8839).
 *
 * A list read held the columns its select and its query name to the
 * caller's read, but not the columns its sort names: a member who may list
 * probes but not read a probe's key got the probes back in the order of
 * their keys. Where each record falls in an order says what it holds, so
 * the order was a comparison oracle on every column read by fewer people
 * than may list its records - plain-text secrets among them.
 *
 * The read check now holds a sort as it holds a select (BasePermission
 * .checkPermissions, SortValidator.checkSortPermission). Held here through
 * the real entry point every read goes through
 * (ModelPermission.checkReadQueryPermission), with no database:
 *
 *  - the plain-text secrets: refused (403) to a caller who may list their
 *    records but not read them, sorted for one who may, and for root and a
 *    master admin;
 *  - through a relation, and two relations deep;
 *  - a column only its own user reads;
 *  - a read across projects, each project by its own permissions;
 *  - every sort the product sends passes, for every reader it sends it as.
 */

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

type ModelType = { new (): BaseModel };

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const rowsOf: (permissions: Array<Permission>) => Array<UserPermission> = (
  permissions: Array<Permission>,
): Array<UserPermission> => {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });
};

/*
 * A signed-in person holding exactly `permissions` in the project. Fresh
 * per call: the permission layer adds Public and Current User to the props
 * it is handed.
 */
const personWith: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rowsOf(permissions),
      },
    },
  };
};

// The read check every list read goes through, with the sort it asked for.
const readCheck: (data: {
  modelType: ModelType;
  sort: unknown;
  props: DatabaseCommonInteractionProps;
  query?: Dictionary<unknown> | undefined;
}) => Promise<unknown> = async (data: {
  modelType: ModelType;
  sort: unknown;
  props: DatabaseCommonInteractionProps;
  query?: Dictionary<unknown> | undefined;
}): Promise<unknown> => {
  return await ModelPermission.checkReadQueryPermission<BaseModel>(
    data.modelType,
    (data.query || {}) as Query<BaseModel>,
    { _id: true } as Select<BaseModel>,
    data.props,
    data.sort,
  );
};

// What the read check refused with, or null when it let the read through.
const refusalOf: (data: {
  modelType: ModelType;
  sort: unknown;
  props: DatabaseCommonInteractionProps;
  query?: Dictionary<unknown> | undefined;
}) => Promise<Error | null> = async (data: {
  modelType: ModelType;
  sort: unknown;
  props: DatabaseCommonInteractionProps;
  query?: Dictionary<unknown> | undefined;
}): Promise<Error | null> => {
  try {
    await readCheck(data);
    return null;
  } catch (error) {
    return error as Error;
  }
};

// The columns `permissions` may read of `modelType`, as a select is held.
const readableBy: (
  modelType: ModelType,
  permissions: Array<Permission>,
) => Array<string> = (
  modelType: ModelType,
  permissions: Array<Permission>,
): Array<string> => {
  return [
    ...ColumnPermissions.getModelColumnsByPermissions(
      modelType,
      rowsOf([Permission.Public, Permission.CurrentUser, ...permissions]),
      DatabaseRequestType.Read,
    ).columns,
    ...ColumnPermissions.getExcludedColumnNames(),
  ];
};

/*
 * The plain-text secrets a caller may list the records of but not read:
 * stored as they are (not hashed, not encrypted), so their order said what
 * they hold. A project's SMTP client secret was one, until it was kept
 * encrypted and write-only (#8989): nobody sorts by it now
 * (ProjectCredentialsAtRest).
 */
const SECRETS: Array<[string, ModelType, string]> = [
  ["a probe's key", Probe, "key"],
  ["an AI agent's key", AIAgent, "key"],
  ["a workflow's webhook secret key", Workflow, "webhookSecretKey"],
  [
    "a workflow's incoming email secret key",
    Workflow,
    "incomingEmailSecretKey",
  ],
  ["a status page's SCIM bearer token", StatusPageSCIM, "bearerToken"],
  ["a project's SCIM bearer token", ProjectSCIM, "bearerToken"],
  [
    "a monitor's incoming request secret key",
    Monitor,
    "incomingRequestSecretKey",
  ],
  ["a monitor's server monitor secret key", Monitor, "serverMonitorSecretKey"],
  ["a monitor's incoming email secret key", Monitor, "incomingEmailSecretKey"],
];

describe("a plain-text secret orders no list for a caller who may not read it", () => {
  test.each(SECRETS)(
    "%s: refused to every reader of the table who may not read it, sorted for every one who may",
    async (_name: string, modelType: ModelType, column: string) => {
      const model: BaseModel = new modelType();
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      // Stored as it is: its order is the value's own.
      expect(metadata.hashed || metadata.encrypted).toBeFalsy();

      const tableReaders: Array<Permission> = model.getReadPermissions() || [];
      let refused: number = 0;

      for (const permission of tableReaders) {
        // A permission that lists none of the table's records is no reader of it.
        if (
          await refusalOf({
            modelType: modelType,
            sort: { _id: SortOrder.Ascending },
            props: personWith([permission]),
          })
        ) {
          continue;
        }

        const mayRead: boolean = readableBy(modelType, [permission]).includes(
          column,
        );

        const refusal: Error | null = await refusalOf({
          modelType: modelType,
          sort: { [column]: SortOrder.Ascending },
          props: personWith([permission]),
        });

        if (mayRead) {
          expect([permission, refusal]).toEqual([permission, null]);
          continue;
        }

        refused++;
        expect([permission, refusal]).toEqual([
          permission,
          expect.any(NotAuthorizedException),
        ]);
        expect(refusal!.message).toMatch(
          new RegExp(`^You do not have permissions to sort on - ${column}\\. `),
        );
      }

      // Some who may list the records may not read the secret: that is the point.
      expect(refused).toBeGreaterThan(0);
    },
  );

  test("the refusal names who may: a probe's key, to a project member", async () => {
    const refusal: Error | null = await refusalOf({
      modelType: Probe,
      sort: { key: SortOrder.Ascending },
      props: personWith([Permission.ProjectMember]),
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      "You do not have permissions to sort on - key. You need one of these permissions: Project Owner, Project Admin.",
    );
  });

  test("whatever direction, or however it says where empty values go", async () => {
    for (const order of [
      SortOrder.Descending,
      "asc",
      -1,
      { direction: SortOrder.Descending, nulls: "LAST" },
    ]) {
      expect(
        await refusalOf({
          modelType: Probe,
          sort: { name: SortOrder.Ascending, key: order },
          props: personWith([Permission.ProjectMember]),
        }),
      ).toBeInstanceOf(NotAuthorizedException);
    }
  });

  test.each(SECRETS)(
    "%s: root and a master admin still sort by it",
    async (_name: string, modelType: ModelType, column: string) => {
      for (const props of [
        { isRoot: true, tenantId: PROJECT_ID },
        { isMasterAdmin: true, userId: USER_ID },
      ] as Array<DatabaseCommonInteractionProps>) {
        expect(
          await refusalOf({
            modelType: modelType,
            sort: { [column]: SortOrder.Ascending },
            props: props,
          }),
        ).toBeNull();
      }
    },
  );

  test("a column nobody may read orders no list but root's: an incident's grouping wait key", async () => {
    expect(
      new Incident().getColumnAccessControlFor("groupingWaitKey")?.read,
    ).toEqual([]);

    const refusal: Error | null = await refusalOf({
      modelType: Incident,
      sort: { groupingWaitKey: SortOrder.Ascending },
      props: personWith([Permission.ProjectOwner]),
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      "You do not have permissions to sort on - groupingWaitKey. No permission allows it: a list cannot be sorted by the column through the API.",
    );
    expect(
      await refusalOf({
        modelType: Incident,
        sort: { groupingWaitKey: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    ).toBeNull();
  });

  test("the ids and times every select may name sort for anyone who may list", async () => {
    for (const column of [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ]) {
      expect(
        await refusalOf({
          modelType: Probe,
          sort: { [column]: SortOrder.Descending },
          props: personWith([Permission.ProjectMember]),
        }),
      ).toBeNull();
    }
  });
});

describe("through a relation", () => {
  test("a related record's column the caller may not read orders nothing: a probe's key, from its monitors", async () => {
    expect(
      new Probe().getTableColumnMetadata("key").canReadOnRelationQuery,
    ).toBeFalsy();

    const refusal: Error | null = await refusalOf({
      modelType: MonitorProbe,
      sort: { probe: { key: SortOrder.Ascending } },
      props: personWith([Permission.ProjectMember]),
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      "You do not have permissions to sort on - key of Probe through probe. You need one of these permissions: Project Owner, Project Admin.",
    );
  });

  test("one the caller may read on the related record sorts: a probe's key, for an admin", async () => {
    expect(
      await refusalOf({
        modelType: MonitorProbe,
        sort: { probe: { key: SortOrder.Ascending } },
        props: personWith([Permission.ProjectAdmin]),
      }),
    ).toBeNull();
  });

  test("one any reader of the relation may read sorts for anyone who may list: a probe's name", async () => {
    expect(
      new Probe().getTableColumnMetadata("name").canReadOnRelationQuery,
    ).toBe(true);

    expect(
      await refusalOf({
        modelType: MonitorProbe,
        sort: { probe: { name: SortOrder.Ascending } },
        props: personWith([Permission.ProjectMember]),
      }),
    ).toBeNull();
  });

  test("two relations deep, the same rule at each: an alert's monitor's status sorts, its monitor's secret key does not", async () => {
    const viewer: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return personWith([Permission.Viewer]);
      };

    expect(
      await refusalOf({
        modelType: Alert,
        sort: {
          monitor: { currentMonitorStatus: { priority: SortOrder.Descending } },
        },
        props: viewer(),
      }),
    ).toBeNull();

    const refusal: Error | null = await refusalOf({
      modelType: Alert,
      sort: { monitor: { incomingRequestSecretKey: SortOrder.Ascending } },
      props: viewer(),
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toMatch(
      /^You do not have permissions to sort on - incomingRequestSecretKey of Monitor through monitor\. /,
    );
  });

  test("the relation itself is held to the caller's read too, as a select of it is", async () => {
    // A column of the list's own model: who may read it decides, relation or not.
    const viewerReadsCreatedByProbe: boolean = readableBy(Incident, [
      Permission.Viewer,
    ]).includes("createdByProbe");

    const refusal: Error | null = await refusalOf({
      modelType: Incident,
      sort: { createdByProbe: { name: SortOrder.Ascending } },
      props: personWith([Permission.Viewer]),
    });

    expect(refusal === null).toBe(viewerReadsCreatedByProbe);
  });
});

/*
 * A webhook any admin may list, so that a column only its own user reads
 * can be met by someone else (as OwnerOnlyColumns.test.ts meets it).
 */
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser, Permission.ProjectAdmin],
  update: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
})
class AdminReadableUserWebhook extends UserWebhook {}

describe("a column only its own user reads", () => {
  test("sorts a list pinned to the caller's own records", async () => {
    expect(
      await refusalOf({
        modelType: AdminReadableUserWebhook,
        sort: { webhookUrl: SortOrder.Ascending },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        query: { userId: USER_ID.toString() },
      }),
    ).toBeNull();
  });

  test("orders nothing for an admin reading other people's", async () => {
    const refusal: Error | null = await refusalOf({
      modelType: AdminReadableUserWebhook,
      sort: { webhookUrl: SortOrder.Ascending },
      props: personWith([Permission.ProjectAdmin]),
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      "You do not have permissions to sort on - webhookUrl. This column belongs to the user it was created for, so a list can be sorted by it only when the query is restricted to your own records.",
    );
  });
});

/*
 * An incident whose title only a Project Owner reads, so that a read across
 * projects can meet a caller who may read it in one and not the other.
 */
class IncidentTitledForOwners extends Incident {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  public override title?: string = undefined;
}

describe("a read across projects, each project by its own permissions", () => {
  // The owner of one project, a member of the other.
  const acrossProjects: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return {
        userId: USER_ID,
        userType: UserType.User,
        isMultiTenantRequest: true,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
          globalPermissions: [Permission.Public, Permission.User],
        },
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: rowsOf([Permission.ProjectOwner]),
          },
          [OTHER_PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: OTHER_PROJECT_ID,
            permissions: rowsOf([Permission.ProjectMember]),
          },
        },
      };
    };

  const projectsRead: (sort: JSONObject) => Promise<Array<string>> = async (
    sort: JSONObject,
  ): Promise<Array<string>> => {
    const result: { query: unknown } = (await readCheck({
      modelType: IncidentTitledForOwners,
      sort: sort,
      props: acrossProjects(),
    })) as { query: unknown };

    const queries: Array<unknown> = Array.isArray(result.query)
      ? result.query
      : [result.query];

    return [PROJECT_ID, OTHER_PROJECT_ID]
      .map((projectId: ObjectID): string => {
        return projectId.toString();
      })
      .filter((projectId: string): boolean => {
        return queries.some((query: unknown): boolean => {
          return JSON.stringify(query).includes(projectId);
        });
      });
  };

  test("a column both projects let the caller read: both projects are read", async () => {
    expect(await projectsRead({ declaredAt: SortOrder.Descending })).toEqual([
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ]);
  });

  test("a column one project hides: that project is left out, as it is for a select of it", async () => {
    expect(await projectsRead({ title: SortOrder.Ascending })).toEqual([
      PROJECT_ID.toString(),
    ]);
  });

  test("hidden in every project: nothing is read", async () => {
    const props: DatabaseCommonInteractionProps = acrossProjects();

    props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions =
      rowsOf([Permission.ProjectMember]);

    let refusal: unknown = null;

    try {
      await ModelPermission.checkReadQueryPermission<BaseModel>(
        IncidentTitledForOwners,
        {} as Query<BaseModel>,
        { _id: true } as Select<BaseModel>,
        props,
        { title: SortOrder.Ascending },
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
  });
});

const MODELS: Array<ModelType> = Entities as Array<ModelType>;

const fieldsOf: (modelType: ModelType) => Dictionary<TableColumnMetadata> = (
  modelType: ModelType,
): Dictionary<TableColumnMetadata> => {
  return getTableColumns(new modelType());
};

// The sort permission check as the read check asks it, for one caller.
const sortRefusalOf: (
  modelType: ModelType,
  sort: unknown,
  permissions: Array<Permission>,
) => Error | null = (
  modelType: ModelType,
  sort: unknown,
  permissions: Array<Permission>,
): Error | null => {
  try {
    SortValidator.checkSortPermission({
      modelType: modelType,
      query: {} as Query<BaseModel>,
      sort: sort,
      props: personWith(permissions),
    });
    return null;
  } catch (error) {
    return error as Error;
  }
};

describe("every sort the product sends passes, for every reader it sends it as", () => {
  test("a list's own order - newest first, the primary key after it - for every reader of every model", () => {
    for (const modelType of MODELS) {
      for (const permission of new modelType().getReadPermissions() || []) {
        expect([
          modelType.name,
          permission,
          sortRefusalOf(
            modelType,
            { createdAt: SortOrder.Descending, _id: SortOrder.Ascending },
            [permission],
          ),
        ]).toEqual([modelType.name, permission, null]);
      }
    }
  });

  test("a list people put in order, by its place, for every reader of it (the reorderable tables)", () => {
    let lists: number = 0;

    for (const modelType of MODELS) {
      const listOrder: ListOrderSettings | null =
        new modelType().getListOrder();

      if (!listOrder) {
        continue;
      }

      lists++;

      for (const permission of new modelType().getReadPermissions() || []) {
        expect([
          modelType.name,
          permission,
          sortRefusalOf(
            modelType,
            {
              [listOrder.column]: listOrder.sortOrder,
              createdAt: SortOrder.Ascending,
            },
            [permission],
          ),
        ]).toEqual([modelType.name, permission, null]);
      }
    }

    expect(lists).toBeGreaterThan(5);
  });

  test("a table's column, for every reader who may see it: a sort by a column passes wherever a select of it does", () => {
    let compared: number = 0;

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();
      const fields: Dictionary<TableColumnMetadata> = fieldsOf(modelType);

      for (const permission of model.getReadPermissions() || []) {
        const readable: Array<string> = readableBy(modelType, [permission]);

        for (const field of Object.keys(fields)) {
          if (fields[field]!.type === TableColumnType.EntityArray) {
            continue;
          }

          compared++;

          /*
           * Selectable by this reader of a list that is not pinned to their
           * own records (OwnerOnlyColumnPermission refuses such a select of
           * a column only its own user reads).
           */
          const selectable: boolean =
            readable.includes(field) && !isOwnerOnlyColumn(model, field);

          const passed: boolean =
            sortRefusalOf(modelType, { [field]: SortOrder.Ascending }, [
              permission,
            ]) === null;

          if (passed !== selectable) {
            expect([modelType.name, permission, field, passed]).toEqual([
              modelType.name,
              permission,
              field,
              selectable,
            ]);
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(50000);
  });

  test("a table's column that shows a related record (ColumnSort), for every reader who may see the column", () => {
    let sorted: number = 0;

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();
      const fields: Dictionary<TableColumnMetadata> = fieldsOf(modelType);

      for (const relation of Object.keys(fields).filter((field: string) => {
        return fields[field]!.type === TableColumnType.Entity;
      })) {
        const relationSort: RelationColumnSort | null = getRelationColumnSort(
          model,
          {
            field: { [relation]: { name: true, title: true } },
            title: "Column",
            type: FieldType.Entity,
          } as unknown as ModelTableColumn<BaseModel>,
        );

        if (!relationSort) {
          continue;
        }

        for (const permission of model.getReadPermissions() || []) {
          // A column a reader may not select is not drawn for them.
          if (!readableBy(modelType, [permission]).includes(relation)) {
            continue;
          }

          for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
            sorted++;

            expect([
              modelType.name,
              relation,
              permission,
              sortRefusalOf(
                modelType,
                getRelationColumnSortValue(relationSort, sortOrder),
                [permission],
              ),
            ]).toEqual([modelType.name, relation, permission, null]);
          }
        }
      }
    }

    expect(sorted).toBeGreaterThan(5000);
  });

  test("an incident list sorted by its severity's place, for every reader of incidents (the dashboard's Severity column)", () => {
    for (const permission of new Incident().getReadPermissions() || []) {
      expect([
        permission,
        sortRefusalOf(
          Incident,
          { incidentSeverity: { order: SortOrder.Ascending } },
          [permission],
        ),
      ]).toEqual([permission, null]);
    }

    expect(
      new IncidentSeverity().getTableColumnMetadata("order")
        .canReadOnRelationQuery,
    ).toBe(true);
  });

  test("a team's members, for a caller who reads only their own (a person's pending invitations)", async () => {
    expect(
      await refusalOf({
        modelType: TeamMember,
        sort: { createdAt: SortOrder.Descending },
        props: {
          userId: USER_ID,
          userType: UserType.User,
          isMultiTenantRequest: true,
          userGlobalAccessPermission: {
            _type: "UserGlobalAccessPermission",
            projectIds: [],
            globalPermissions: [Permission.Public, Permission.User],
          },
        },
      }),
    ).toBeNull();
  });
});
