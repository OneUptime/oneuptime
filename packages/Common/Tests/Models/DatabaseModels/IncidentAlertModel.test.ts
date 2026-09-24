import Models from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { OwnedThroughMetadata } from "../../../Types/Database/AccessControl/OwnedThrough";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getFeedEventTypeLabel } from "../../../UI/Components/Feed/FeedOptions";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * IncidentAlert: an alert linked to an incident, at the schema and
 * permission level.
 *
 * The service tests pass just as happily against a link table the wrong role
 * can write, whose pair is not unique, that forgets the incident's label
 * scope, or that an edit can re-point at another alert. The dashboard pages,
 * the migration and the docs all name what is pinned here, so a change to
 * the model fails here first.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;
const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-000000000001",
);

const WRITERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.AlertAdmin,
  Permission.AlertMember,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.AlertViewer,
  Permission.ReadIncidentAlert,
];

const GRANULAR_PERMISSIONS: Array<Permission> = [
  Permission.CreateIncidentAlert,
  Permission.DeleteIncidentAlert,
  Permission.EditIncidentAlert,
  Permission.ReadIncidentAlert,
];

function model(): IncidentAlert {
  return new IncidentAlert();
}

function propsWith(permission: Permission): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function linkPayload(): IncidentAlert {
  const link: IncidentAlert = new IncidentAlert();
  link.projectId = PROJECT_ID;
  link.incidentId = ObjectID.generate();
  link.alertId = ObjectID.generate();
  return link;
}

describe("IncidentAlert registration", () => {
  test("is a registered database model", () => {
    expect(MODEL_TYPES).toContain(IncidentAlert);
  });

  test("owns its table name and CRUD route", () => {
    expect(model().tableName).toBe("IncidentAlert");
    expect(model().getCrudApiPath()?.toString()).toBe("/incident-alert");

    const routeClaimants: Array<string> = MODEL_TYPES.filter(
      (modelType: ModelType) => {
        return (
          new modelType().getCrudApiPath()?.toString() === "/incident-alert"
        );
      },
    ).map((modelType: ModelType) => {
      return modelType.name;
    });
    const tableClaimants: Array<string> = MODEL_TYPES.filter(
      (modelType: ModelType) => {
        return new modelType().tableName === "IncidentAlert";
      },
    ).map((modelType: ModelType) => {
      return modelType.name;
    });

    // A duplicate route silently shadows another model's API.
    expect(routeClaimants).toEqual(["IncidentAlert"]);
    expect(tableClaimants).toEqual(["IncidentAlert"]);
  });

  test("is named and documented for the API reference", () => {
    expect(model().singularName).toBe("Incident Alert");
    expect(model().pluralName).toBe("Incident Alerts");
    expect(model().tableDescription?.length).toBeGreaterThan(0);
  });

  test("is scoped to a project through projectId", () => {
    expect(model().getTenantColumn()).toBe("projectId");
  });

  test("is documented, exposed to MCP, and offered to workflows", () => {
    expect(model().enableDocumentation).toBe(true);
    expect(model().enableMCP).toBe(true);
    expect(model().enableWorkflowOn).toEqual({
      create: true,
      delete: true,
      update: true,
      read: true,
    });
  });
});

describe("IncidentAlert table permissions", () => {
  test("create, delete and update: the incident and alert writers", () => {
    expect(model().getCreatePermissions()).toEqual([
      ...WRITERS,
      Permission.CreateIncidentAlert,
    ]);
    expect(model().getDeletePermissions()).toEqual([
      ...WRITERS,
      Permission.DeleteIncidentAlert,
    ]);
    expect(model().getUpdatePermissions()).toEqual([
      ...WRITERS,
      Permission.EditIncidentAlert,
    ]);
  });

  test("read: the incident and alert readers", () => {
    expect(model().getReadPermissions()).toEqual(READERS);
  });

  test("no list names ProjectUser", () => {
    for (const list of [
      model().getCreatePermissions(),
      model().getReadPermissions(),
      model().getUpdatePermissions(),
      model().getDeletePermissions(),
    ]) {
      expect(list).not.toContain(Permission.ProjectUser);
    }
  });

  test.each(GRANULAR_PERMISSIONS)(
    "%s is a tenant-assignable Incident permission, not a label permission",
    (permission: Permission) => {
      const props: PermissionProps | undefined = PERMISSION_PROPS.find(
        (candidate: PermissionProps) => {
          return candidate.permission === permission;
        },
      );

      expect(props).toBeDefined();
      expect(props!.group).toBe(PermissionGroup.Incident);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.title.length).toBeGreaterThan(0);
      expect(props!.description.length).toBeGreaterThan(0);
    },
  );

  test("every permission the model names is in the permission catalogue", () => {
    const named: Set<Permission> = new Set([
      ...model().getCreatePermissions(),
      ...model().getReadPermissions(),
      ...model().getUpdatePermissions(),
      ...model().getDeletePermissions(),
    ]);

    for (const access of Object.values(
      model().getColumnAccessControlForAllColumns(),
    )) {
      for (const permission of [
        ...access.create,
        ...access.read,
        ...access.update,
      ]) {
        named.add(permission);
      }
    }

    for (const permission of named) {
      expect({
        permission,
        catalogued: PERMISSION_PROPS.some((candidate: PermissionProps) => {
          return candidate.permission === permission;
        }),
      }).toEqual({ permission, catalogued: true });
    }
  });

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.AlertMember,
    Permission.ProjectAdmin,
    Permission.CreateIncidentAlert,
  ])("%s may create a link", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentAlert,
        linkPayload(),
        propsWith(permission),
      );
    }).not.toThrow();
  });

  test.each([
    Permission.Viewer,
    Permission.IncidentViewer,
    Permission.AlertViewer,
    Permission.ReadIncidentAlert,
  ])("%s may not create a link", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentAlert,
        linkPayload(),
        propsWith(permission),
      );
    }).toThrow();
  });

  test("nobody can set who deleted a link", () => {
    const link: IncidentAlert = linkPayload();
    link.deletedByUserId = ObjectID.generate();

    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentAlert,
        link,
        propsWith(Permission.ProjectAdmin),
      );
    }).toThrow("deletedByUserId");
  });
});

describe("IncidentAlert columns", () => {
  const COLUMNS: Array<string> = [
    "project",
    "projectId",
    "incident",
    "incidentId",
    "alert",
    "alertId",
    "createdByUser",
    "createdByUserId",
    "deletedByUser",
    "deletedByUserId",
  ];

  test("has exactly the columns the migration creates", () => {
    const baseColumns: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];

    expect([...model().getTableColumns().columns].sort()).toEqual(
      [...baseColumns, ...COLUMNS].sort(),
    );
  });

  test.each(COLUMNS)(
    "%s cannot be edited: a link is created or removed, never changed",
    (column: string) => {
      const access: ColumnAccessControl | null =
        model().getColumnAccessControlFor(column);

      expect(access).not.toBeNull();
      expect(access!.update).toEqual([]);
    },
  );

  test.each(["projectId", "incidentId", "alertId"])(
    "%s is a required id that relation queries may read",
    (column: string) => {
      const metadata: TableColumnMetadata =
        model().getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.ObjectID);
      expect(metadata.required).toBe(true);
      expect(metadata.canReadOnRelationQuery).toBe(true);
    },
  );

  test.each(["createdByUserId", "deletedByUserId"])(
    "%s is optional",
    (column: string) => {
      expect(Boolean(model().getTableColumnMetadata(column).required)).toBe(
        false,
      );
    },
  );

  interface RelationCase {
    relation: string;
    idColumn: string;
    modelType: ModelType;
    onDelete: string;
  }

  test.each([
    {
      relation: "project",
      idColumn: "projectId",
      modelType: Project,
      onDelete: "CASCADE",
    },
    {
      relation: "incident",
      idColumn: "incidentId",
      modelType: Incident,
      onDelete: "CASCADE",
    },
    {
      relation: "alert",
      idColumn: "alertId",
      modelType: Alert,
      onDelete: "CASCADE",
    },
    {
      relation: "createdByUser",
      idColumn: "createdByUserId",
      modelType: User,
      onDelete: "SET NULL",
    },
    {
      relation: "deletedByUser",
      idColumn: "deletedByUserId",
      modelType: User,
      onDelete: "SET NULL",
    },
  ] as Array<RelationCase>)(
    "$relation points at its model through $idColumn, and is $onDelete on delete",
    ({ relation, idColumn, modelType, onDelete }: RelationCase) => {
      const metadata: TableColumnMetadata =
        model().getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(modelType);
      expect(metadata.manyToOneRelationColumn).toBe(idColumn);

      const relationArgs: RelationMetadataArgs | undefined =
        getMetadataArgsStorage().relations.find(
          (candidate: RelationMetadataArgs) => {
            return (
              candidate.target === IncidentAlert &&
              candidate.propertyName === relation
            );
          },
        );

      expect(relationArgs?.relationType).toBe("many-to-one");
      expect(relationArgs?.options.onDelete).toBe(onDelete);
    },
  );

  test("the two deletedBy columns cannot be written on create", () => {
    expect(model().getColumnAccessControlFor("deletedByUser")!.create).toEqual(
      [],
    );
    expect(
      model().getColumnAccessControlFor("deletedByUserId")!.create,
    ).toEqual([]);
  });
});

describe("IncidentAlert uniqueness and scope", () => {
  test("a pair can only be linked once: a unique index backs the service check", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter((index: IndexMetadataArgs) => {
        return index.target === IncidentAlert && Array.isArray(index.columns);
      });

    const unique: Array<IndexMetadataArgs> = indexes.filter(
      (index: IndexMetadataArgs) => {
        return index.unique === true;
      },
    );

    expect(unique).toHaveLength(1);
    expect(unique[0]!.columns).toEqual(["incidentId", "alertId", "projectId"]);

    const constraints: Array<UniqueColumnsTogetherMetadata> =
      model().getUniqueColumnsTogether();

    expect(constraints).toEqual([
      {
        columnNames: ["incidentId", "alertId", "projectId"],
        errorMessage: "This alert is already linked to this incident.",
      },
    ]);
  });

  test("reads follow the incident's labels", () => {
    expect(model().canAccessIfCanReadOn).toBe("incident");
  });

  test("owners see the links of the incidents they own", () => {
    const ownedThrough: OwnedThroughMetadata | null = model().ownedThrough;

    expect(ownedThrough?.fkColumn).toBe("incidentId");
    expect(ownedThrough?.parentModels).toEqual([Incident]);
    expect(ownedThrough?.includeProjectScope).toBe(false);
  });
});

describe("the project switches for linked alerts", () => {
  test.each([
    "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
    "resolveLinkedAlertsWhenIncidentResolved",
  ])(
    "%s is an off-by-default boolean only owners and admins may change",
    (column: string) => {
      const project: Project = new Project();
      const metadata: TableColumnMetadata =
        project.getTableColumnMetadata(column);
      const access: ColumnAccessControl | null =
        project.getColumnAccessControlFor(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.required).toBe(true);
      expect(metadata.defaultValue).toBe(false);
      expect(project.isDefaultValueColumn(column)).toBe(true);
      expect(access!.create).toEqual([]);
      expect(access!.update).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
      expect(access!.read).toContain(Permission.ProjectMember);
    },
  );
});

describe("the feed events a link writes", () => {
  test.each([
    [
      AlertFeedEventType.LinkedToIncident,
      "LinkedToIncident",
      "Linked to Incident",
    ],
    [
      AlertFeedEventType.UnlinkedFromIncident,
      "UnlinkedFromIncident",
      "Unlinked from Incident",
    ],
    [IncidentFeedEventType.AlertLinked, "AlertLinked", "Alert Linked"],
    [IncidentFeedEventType.AlertUnlinked, "AlertUnlinked", "Alert Unlinked"],
  ])(
    "%s is stored as %s and labelled %s",
    (eventType: string, stored: string, label: string) => {
      expect(eventType).toBe(stored);
      expect(getFeedEventTypeLabel(eventType)).toBe(label);
    },
  );
});
