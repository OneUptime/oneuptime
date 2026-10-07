import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../../../Models/DatabaseModels/IncidentAlert";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import Label from "../../../../../Models/DatabaseModels/Label";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { getLabelJoinTable } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * EVERY GRANT AND SCOPE A READ ACCEPTS NARROWS THE RECORDS IT REACHES
 * (BasePermission.addRecordScopeToQuery):
 *
 *   - an operational resource's *AllOperationalResources wildcard counts
 *     like one of the model's own permissions: limited to labels, it keeps
 *     the records carrying them; over the whole project, it reaches every
 *     record; a block with labels on it takes away what it grants;
 *   - a record read through another one (@CanAccessIfCanReadOn) keeps to
 *     the parents the caller owns when their grants on the parent are
 *     limited to owned records - on a read, an update and a delete.
 *
 * The join tables are named as a migrated database names them; the
 * conditions are checked as the SQL they become.
 */

type Operation =
  | DatabaseRequestType.Read
  | DatabaseRequestType.Update
  | DatabaseRequestType.Delete;

const OPERATIONS: Array<Operation> = [
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

// The note permission each operation asks for.
const NOTE_PERMISSION: Record<Operation, Permission> = {
  [DatabaseRequestType.Read]: Permission.ReadIncidentInternalNote,
  [DatabaseRequestType.Update]: Permission.EditIncidentInternalNote,
  [DatabaseRequestType.Delete]: Permission.DeleteIncidentInternalNote,
};

// The wildcard each operation on an operational resource accepts.
const WILDCARD: Record<Operation, Permission> = {
  [DatabaseRequestType.Read]: Permission.ReadAllOperationalResources,
  [DatabaseRequestType.Update]: Permission.EditAllOperationalResources,
  [DatabaseRequestType.Delete]: Permission.DeleteAllOperationalResources,
};

const projectId: ObjectID = ObjectID.generate();
const productionLabelId: ObjectID = ObjectID.generate();
const stagingLabelId: ObjectID = ObjectID.generate();
const ownedIncidentId: ObjectID = ObjectID.generate();
const otherOwnedIncidentId: ObjectID = ObjectID.generate();

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
  };
};

const labelled: (
  permission: Permission,
  labelIds: Array<ObjectID>,
) => UserPermission = (
  permission: Permission,
  labelIds: Array<ObjectID>,
): UserPermission => {
  return row(permission, { labelIds: labelIds, scope: PermissionScope.Labels });
};

const owned: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.Owned });
};

const everywhere: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.All });
};

// A member of one team, acting in one project with these permission rows.
const member: (
  permissions: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTeamIds: [ObjectID.generate()],
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [projectId],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions,
      },
    },
  };
};

// The SQL a condition becomes, an AND of conditions joined.
const sqlOf: (condition: unknown, alias?: string) => string = (
  condition: unknown,
  alias: string = "key",
): string => {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  expect(operator).toBeInstanceOf(FindOperator);

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>)
      .map((part: unknown): string => {
        return sqlOf(part, alias);
      })
      .join(" AND ");
  }

  if (operator.type === "equal") {
    return `${alias} = '${String(operator.value)}'`;
  }

  return (operator as unknown as { getSql: (alias: string) => string }).getSql(
    alias,
  );
};

// Every value a condition binds, an AND of conditions included.
const valuesOf: (condition: unknown) => Array<string> = (
  condition: unknown,
): Array<string> => {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>).flatMap(valuesOf);
  }

  if (operator.type === "equal") {
    return [String(operator.value)];
  }

  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters?: Record<string, unknown>;
      }
    ).objectLiteralParameters || {},
  )
    .flat()
    .map(String);
};

const idsOf: (...ids: Array<ObjectID>) => Array<string> = (
  ...ids: Array<ObjectID>
): Array<string> => {
  return ids
    .map((id: ObjectID): string => {
      return id.toString();
    })
    .sort();
};

// The label ids a labelled model's read keeps to, as the rule wrote them.
const labelsOf: (query: Query<Incident>) => Array<string> = (
  query: Query<Incident>,
): Array<string> => {
  return ((query.labels as unknown as Array<ObjectID>) || [])
    .map((labelId: ObjectID): string => {
      return labelId.toString();
    })
    .sort();
};

const scopeOf: (
  modelType: { new (): BaseModel },
  props: DatabaseCommonInteractionProps,
  operation: Operation,
  query?: Query<BaseModel>,
) => Promise<Query<BaseModel>> = async (
  modelType: { new (): BaseModel },
  props: DatabaseCommonInteractionProps,
  operation: Operation,
  query: Query<BaseModel> = {},
): Promise<Query<BaseModel>> => {
  return await BasePermission.addRecordScopeToQuery(
    modelType,
    { ...query },
    null,
    props,
    operation,
  );
};

let ownedIds: Array<ObjectID> = [];

describe("every grant and scope a read accepts narrows the records it reaches", () => {
  beforeEach(() => {
    ownedIds = [ownedIncidentId, otherOwnedIncidentId];

    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockImplementation(((
        modelType: { new (): BaseModel },
        column: string,
      ): ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> => {
        if (
          modelType === StatusPageAnnouncement &&
          column === "statusPages"
        ) {
          return {
            joinTableName: "AnnouncementStatusPage",
            ownerColumnName: "announcementId",
            relationColumnName: "statusPageId",
          };
        }

        if (column === new modelType().getAccessControlColumn()) {
          return getLabelJoinTable(modelType);
        }

        return null;
      }) as never);

    jest
      .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
      .mockImplementation((async (): Promise<Array<ObjectID>> => {
        return ownedIds;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("an operational resource's wildcard grant", () => {
    test("limited to labels, it keeps the records to those labels", async () => {
      for (const operation of OPERATIONS) {
        const rows: Array<UserPermission> = [
          labelled(Permission.ReadAllOperationalResources, [
            productionLabelId,
          ]),
        ];

        if (operation !== DatabaseRequestType.Read) {
          rows.push(labelled(WILDCARD[operation], [productionLabelId]));
        }

        const query: Query<Incident> = (await scopeOf(
          Incident,
          member(rows),
          operation,
        )) as Query<Incident>;

        expect([operation, labelsOf(query)]).toEqual([
          operation,
          idsOf(productionLabelId),
        ]);
      }
    });

    test("over the whole project, it reaches every record", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([everywhere(Permission.ReadAllOperationalResources)]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(query).toEqual({});
    });

    test("a write keeps to the labels its wildcard read is limited to", async () => {
      for (const operation of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ] as Array<Operation>) {
        const query: Query<Incident> = (await scopeOf(
          Incident,
          member([
            labelled(Permission.ReadAllOperationalResources, [
              productionLabelId,
            ]),
            everywhere(WILDCARD[operation]),
          ]),
          operation,
        )) as Query<Incident>;

        expect([operation, labelsOf(query)]).toEqual([
          operation,
          idsOf(productionLabelId),
        ]);
      }
    });

    test("its labels and a role's labels are one list of labels to keep", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          labelled(Permission.ReadAllOperationalResources, [
            productionLabelId,
          ]),
          labelled(Permission.IncidentViewer, [stagingLabelId]),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(labelsOf(query)).toEqual(
        idsOf(productionLabelId, stagingLabelId),
      );
    });

    test("over the whole project, it is broader than a role limited to labels", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          everywhere(Permission.ReadAllOperationalResources),
          labelled(Permission.IncidentViewer, [stagingLabelId]),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(query).toEqual({});
    });

    test("taken away by a block with no labels, it grants nothing and its labels narrow nothing", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          labelled(Permission.ReadAllOperationalResources, [
            productionLabelId,
          ]),
          row(Permission.ReadAllOperationalResources, { isBlock: true }),
          labelled(Permission.IncidentViewer, [stagingLabelId]),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(labelsOf(query)).toEqual(idsOf(stagingLabelId));
    });

    test("a block with labels on it leaves the records carrying them out", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          everywhere(Permission.ReadAllOperationalResources),
          row(Permission.ReadAllOperationalResources, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(sqlOf(query._id, "incident._id")).toContain(
        'incident._id NOT IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
      );
      expect(valuesOf(query._id)).toEqual([productionLabelId.toString()]);
      expect(query.labels).toBeUndefined();
    });

    test("a block with labels on it takes nothing from a role over the whole project", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          everywhere(Permission.IncidentViewer),
          everywhere(Permission.ReadAllOperationalResources),
          row(Permission.ReadAllOperationalResources, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(query).toEqual({});
    });

    test("a block with labels on a wildcard the caller does not hold takes nothing away", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          labelled(Permission.IncidentViewer, [stagingLabelId]),
          row(Permission.ReadAllOperationalResources, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(labelsOf(query)).toEqual(idsOf(stagingLabelId));
      expect(query._id).toBeUndefined();
    });

    test("a block with labels on the wildcard read leaves the records out of a write too", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          everywhere(Permission.ReadAllOperationalResources),
          everywhere(Permission.EditAllOperationalResources),
          row(Permission.ReadAllOperationalResources, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        DatabaseRequestType.Update,
      )) as Query<Incident>;

      expect(valuesOf(query._id)).toEqual([productionLabelId.toString()]);
    });

    test("is not a grant on a model that is no operational resource", async () => {
      // A label is project configuration: the wildcard does not reach it.
      expect(
        AccessControlPermission.getAccessControlIdsForModel(
          Label,
          member([
            labelled(Permission.ReadAllOperationalResources, [
              productionLabelId,
            ]),
            everywhere(Permission.ProjectMember),
          ]),
          DatabaseRequestType.Read,
        ),
      ).toEqual([]);
    });

    test("the record read through a parent keeps to the parents its wildcard read is limited to", async () => {
      const read: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          labelled(Permission.ReadAllOperationalResources, [
            productionLabelId,
          ]),
          everywhere(Permission.ReadIncidentInternalNote),
        ]),
        DatabaseRequestType.Read,
      )) as Query<IncidentInternalNote>;

      expect(
        (read.incident as unknown as { labels: Array<ObjectID> }).labels.map(
          String,
        ),
      ).toEqual([productionLabelId.toString()]);

      for (const operation of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ] as Array<Operation>) {
        const write: Query<IncidentInternalNote> = (await scopeOf(
          IncidentInternalNote,
          member([
            labelled(Permission.ReadAllOperationalResources, [
              productionLabelId,
            ]),
            everywhere(Permission.ReadIncidentInternalNote),
            everywhere(NOTE_PERMISSION[operation]),
          ]),
          operation,
        )) as Query<IncidentInternalNote>;

        expect([operation, valuesOf(write._id)]).toEqual([
          operation,
          [productionLabelId.toString()],
        ]);
      }
    });

    test("a block with labels on the wildcard read leaves the notes of the parents carrying them out", async () => {
      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          everywhere(Permission.ReadAllOperationalResources),
          row(Permission.ReadAllOperationalResources, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
          everywhere(Permission.ReadIncidentInternalNote),
        ]),
        DatabaseRequestType.Read,
      )) as Query<IncidentInternalNote>;

      expect(sqlOf(query.incidentId, "note.incidentId")).toContain(
        'note.incidentId NOT IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
      );
      expect(valuesOf(query.incidentId)).toEqual([
        productionLabelId.toString(),
      ]);
    });
  });

  describe("the labels and blocks a lookup by id weighs", () => {
    const incidentCarrying: (labelId: ObjectID) => Incident = (
      labelId: ObjectID,
    ): Incident => {
      const label: Label = new Label();
      label.id = labelId;

      const incident: Incident = new Incident();
      incident.id = ObjectID.generate();
      incident.projectId = projectId;
      incident.labels = [label];

      return incident;
    };

    test("a record outside the labels a wildcard read is limited to is answered as missing", async () => {
      await expect(
        AccessControlPermission.checkRecordByModel({
          fetchModelWithAccessControlIds: async (): Promise<Incident> => {
            return incidentCarrying(stagingLabelId);
          },
          modelType: Incident,
          props: member([
            labelled(Permission.ReadAllOperationalResources, [
              productionLabelId,
            ]),
            everywhere(Permission.EditAllOperationalResources),
          ]),
          type: DatabaseRequestType.Update,
        }),
      ).rejects.toThrow(NotFoundException);

      await expect(
        AccessControlPermission.checkRecordByModel({
          fetchModelWithAccessControlIds: async (): Promise<Incident> => {
            return incidentCarrying(productionLabelId);
          },
          modelType: Incident,
          props: member([
            labelled(Permission.ReadAllOperationalResources, [
              productionLabelId,
            ]),
            everywhere(Permission.EditAllOperationalResources),
          ]),
          type: DatabaseRequestType.Update,
        }),
      ).resolves.toBeUndefined();
    });

    test("a record carrying a label a block on the wildcard takes away is refused", async () => {
      await expect(
        AccessControlPermission.checkRecordByModel({
          fetchModelWithAccessControlIds: async (): Promise<Incident> => {
            return incidentCarrying(productionLabelId);
          },
          modelType: Incident,
          props: member([
            everywhere(Permission.ReadAllOperationalResources),
            everywhere(Permission.DeleteAllOperationalResources),
            row(Permission.DeleteAllOperationalResources, {
              isBlock: true,
              labelIds: [productionLabelId],
            }),
          ]),
          type: DatabaseRequestType.Delete,
        }),
      ).rejects.toThrow(
        "because DeleteAllOperationalResources is in your team's permission block list",
      );
    });

    test("the block rows a lookup weighs are the record rule's", () => {
      const props: DatabaseCommonInteractionProps = member([
        everywhere(Permission.ReadAllOperationalResources),
        row(Permission.ReadAllOperationalResources, {
          isBlock: true,
          labelIds: [productionLabelId],
        }),
        row(Permission.ReadProjectMonitor, {
          isBlock: true,
          labelIds: [stagingLabelId],
        }),
      ]);

      expect(
        ReadPermission.getLabelledBlockRows(
          Incident,
          props,
          DatabaseRequestType.Read,
        ).map((blockRow: UserPermission): string => {
          return blockRow.permission;
        }),
      ).toEqual([Permission.ReadAllOperationalResources]);
    });
  });

  describe("a role that cannot be scoped reaches the whole project whatever scope a row of it carries", () => {
    test("its Owned row is broader than a role limited to labels", async () => {
      const query: Query<Incident> = (await scopeOf(
        Incident,
        member([
          owned(Permission.ProjectAdmin),
          labelled(Permission.IncidentViewer, [stagingLabelId]),
        ]),
        DatabaseRequestType.Read,
      )) as Query<Incident>;

      expect(query).toEqual({});
    });

    test("an Owned row of a role that can be scoped still adds no label to keep", () => {
      expect(
        AccessControlPermission.getAccessControlIdsForModel(
          Incident,
          member([
            owned(Permission.IncidentViewer),
            labelled(Permission.IncidentMember, [stagingLabelId]),
          ]),
          DatabaseRequestType.Read,
        ).map(String),
      ).toEqual([stagingLabelId.toString()]);
    });
  });

  describe("a record read through its parent follows the parent's owners", () => {
    test.each(OPERATIONS)(
      "an incident read limited to owned incidents keeps a project-wide note %s to their notes",
      async (operation: Operation) => {
        const rows: Array<UserPermission> = [
          owned(Permission.ReadProjectIncident),
          everywhere(Permission.ReadIncidentInternalNote),
        ];

        if (operation !== DatabaseRequestType.Read) {
          rows.push(everywhere(NOTE_PERMISSION[operation]));
        }

        const query: Query<IncidentInternalNote> = (await scopeOf(
          IncidentInternalNote,
          member(rows),
          operation,
        )) as Query<IncidentInternalNote>;

        expect(sqlOf(query.incidentId, "note.incidentId")).toContain(
          "note.incidentId IN",
        );
        expect(valuesOf(query.incidentId).sort()).toEqual(
          idsOf(ownedIncidentId, otherOwnedIncidentId),
        );
      },
    );

    test("the caller's own filter on the parent stays beside the owners", async () => {
      const incidentId: ObjectID = ObjectID.generate();

      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          owned(Permission.ReadProjectIncident),
          everywhere(Permission.ReadIncidentInternalNote),
        ]),
        DatabaseRequestType.Read,
        { incidentId: incidentId.toString() } as Query<BaseModel>,
      )) as Query<IncidentInternalNote>;

      const condition: FindOperator<unknown> =
        query.incidentId as unknown as FindOperator<unknown>;

      expect(condition.type).toBe("and");
      expect(valuesOf(condition)).toEqual(
        expect.arrayContaining([
          incidentId.toString(),
          ownedIncidentId.toString(),
          otherOwnedIncidentId.toString(),
        ]),
      );
    });

    test("a caller who owns no parent reaches no record read through one", async () => {
      ownedIds = [];

      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          owned(Permission.ReadProjectIncident),
          everywhere(Permission.ReadIncidentInternalNote),
        ]),
        DatabaseRequestType.Read,
      )) as Query<IncidentInternalNote>;

      expect(valuesOf(query._id)).toEqual([
        ObjectID.getZeroObjectID().toString(),
      ]);
    });

    test("a parent read over the whole project is broader than an owned one", async () => {
      const lookup: SpyInstance<(...args: never) => never> = jest.spyOn(
        OwnedScopePermission as never,
        "getAllowedResourceIds",
      );

      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          owned(Permission.ReadProjectIncident),
          everywhere(Permission.IncidentViewer),
          everywhere(Permission.ReadIncidentInternalNote),
        ]),
        DatabaseRequestType.Read,
      )) as Query<IncidentInternalNote>;

      expect(query).toEqual({});
      expect(lookup).not.toHaveBeenCalled();
    });

    test("an update also keeps to the parents the caller may update, when those are only their own", async () => {
      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          everywhere(Permission.ReadProjectIncident),
          owned(Permission.EditProjectIncident),
          everywhere(Permission.ReadIncidentInternalNote),
          everywhere(Permission.EditIncidentInternalNote),
        ]),
        DatabaseRequestType.Update,
      )) as Query<IncidentInternalNote>;

      expect(valuesOf(query.incidentId).sort()).toEqual(
        idsOf(ownedIncidentId, otherOwnedIncidentId),
      );

      // A delete weighs no grant on the parent beyond its read.
      const deleted: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([
          everywhere(Permission.ReadProjectIncident),
          owned(Permission.DeleteProjectIncident),
          everywhere(Permission.ReadIncidentInternalNote),
          everywhere(Permission.DeleteIncidentInternalNote),
        ]),
        DatabaseRequestType.Delete,
      )) as Query<IncidentInternalNote>;

      expect(deleted).toEqual({});
    });

    test("rows already kept to the owned parents by their own grants are not looked up twice", async () => {
      const lookup: SpyInstance<(...args: never) => never> = jest.spyOn(
        OwnedScopePermission as never,
        "getAllowedResourceIds",
      );

      const query: Query<IncidentInternalNote> = (await scopeOf(
        IncidentInternalNote,
        member([owned(Permission.IncidentMember)]),
        DatabaseRequestType.Read,
      )) as Query<IncidentInternalNote>;

      expect(valuesOf(query.incidentId).sort()).toEqual(
        idsOf(ownedIncidentId, otherOwnedIncidentId),
      );
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    test("a parent read through a join table keeps the rows linked to an owned parent", async () => {
      const query: Query<StatusPageAnnouncement> = (await scopeOf(
        StatusPageAnnouncement,
        member([
          owned(Permission.ReadProjectStatusPage),
          everywhere(Permission.ReadStatusPageAnnouncement),
        ]),
        DatabaseRequestType.Read,
      )) as Query<StatusPageAnnouncement>;

      expect(sqlOf(query._id, "announcement._id")).toContain(
        'announcement._id IN (SELECT "AnnouncementStatusPage"."announcementId" FROM "AnnouncementStatusPage" WHERE "AnnouncementStatusPage"."statusPageId" IN',
      );
      expect(valuesOf(query._id).sort()).toEqual(
        idsOf(ownedIncidentId, otherOwnedIncidentId),
      );
    });

    test("a model whose parent read is optional is narrowed only for a caller who holds one", async () => {
      // Alert responders read incident links without reading incidents.
      expect(
        await scopeOf(
          IncidentAlert,
          member([everywhere(Permission.AlertViewer)]),
          DatabaseRequestType.Read,
        ),
      ).toEqual({});

      const query: Query<IncidentAlert> = (await scopeOf(
        IncidentAlert,
        member([
          everywhere(Permission.AlertViewer),
          owned(Permission.ReadProjectIncident),
        ]),
        DatabaseRequestType.Read,
      )) as Query<IncidentAlert>;

      expect(valuesOf(query.incidentId).sort()).toEqual(
        idsOf(ownedIncidentId, otherOwnedIncidentId),
      );
    });

    test("root and master admin callers are left alone", async () => {
      for (const props of [
        { isRoot: true },
        { isMasterAdmin: true },
      ] as Array<DatabaseCommonInteractionProps>) {
        expect(
          await scopeOf(
            IncidentInternalNote,
            {
              ...member([
                owned(Permission.ReadProjectIncident),
                everywhere(Permission.ReadIncidentInternalNote),
              ]),
              ...props,
            },
            DatabaseRequestType.Read,
          ),
        ).toEqual({});
      }
    });
  });
});
