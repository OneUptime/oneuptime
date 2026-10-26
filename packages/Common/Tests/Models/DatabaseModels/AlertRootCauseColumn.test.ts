import Alert from "../../../Models/DatabaseModels/Alert";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnRefusalMessage, {
  NO_PERMISSION_ALLOWS,
} from "../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  getTerraformAttributes,
  TerraformAttributeDescriptor,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * An alert's root cause could be set when the alert was made, and by
 * nobody after: its column's update list was empty. The Dashboard's Root
 * Cause page offered Edit anyway and opened an empty dialog, the API
 * refused the change, the MCP tools and a workflow's Update step could not
 * make it, and the Terraform provider generated from the API marked
 * root_cause as forcing a new resource - changing it in a configuration
 * destroyed the alert and made a new one.
 *
 * An incident's root cause has been editable since its page was; an
 * alert's now is too, by whoever may edit the alert. Pinned here at the
 * source every surface is generated from - the column's permission lists -
 * and in what is generated from them: the check every API request passes,
 * the API's write schemas, the published OpenAPI document and the
 * Terraform provider built from it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194e9a0-0000-4000-8000-000000000001",
);

// Everyone who may edit an alert, as the alert's table says.
const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.EditAlert,
];

// Everyone who may make an alert.
const CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.CreateAlert,
];

// Everyone who may read an alert.
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.AlertAdmin,
  Permission.AlertMember,
  Permission.AlertViewer,
  Permission.ReadAlert,
];

// Who may read alerts but not change them.
const READ_ONLY: Array<Permission> = [
  Permission.Viewer,
  Permission.AlertViewer,
  Permission.ReadAlert,
];

// What an alert's root cause may be changed to: new text, nothing, a clear.
const ROOT_CAUSE_WRITES: Array<string | null> = [
  "Log rotation was switched off on db-1.",
  "## What happened\n\n- The disk filled up.\n- Writes failed.",
  "",
  null,
];

const alertAccess: Record<string, ColumnAccessControl> =
  new Alert().getColumnAccessControlForAllColumns();

// A person in the project holding these permissions, as an API request carries them.
function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
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

function refusalOf(write: () => void): unknown {
  try {
    write();
  } catch (error) {
    return error;
  }

  return null;
}

// The column check an API update of an alert passes, for these values.
function updateRefusal(
  permissions: Array<Permission>,
  values: Record<string, unknown>,
): unknown {
  return refusalOf(() => {
    ColumnPermissions.checkDataColumnPermissions(
      Alert,
      values as unknown as DatabaseBaseModel,
      propsWith(permissions),
      DatabaseRequestType.Update,
    );
  });
}

function shapeKeys(schema: unknown): Array<string> {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

describe("the alert's rootCause column", () => {
  test("whoever may edit the alert may change it", () => {
    expect(alertAccess["rootCause"]?.update).toEqual(EDITORS);
  });

  test("is changed by the same people as the alert's other investigation notes", () => {
    expect(alertAccess["rootCause"]?.update).toEqual(
      alertAccess["remediationNotes"]?.update,
    );
    expect(alertAccess["rootCause"]?.update).toEqual(
      alertAccess["description"]?.update,
    );
  });

  test("is changed by no one the alert itself does not let edit it", () => {
    const tableUpdate: Array<Permission> = new Alert().getUpdatePermissions();

    for (const permission of alertAccess["rootCause"]?.update || []) {
      expect({ permission, onTable: tableUpdate.includes(permission) }).toEqual(
        { permission, onTable: true },
      );
    }
  });

  test("who may read it and set it on a new alert is unchanged", () => {
    expect(alertAccess["rootCause"]?.read).toEqual(READERS);
    expect(alertAccess["rootCause"]?.create).toEqual(CREATORS);
  });

  test("an incident's root cause is changed by the incident's editors, the rule an alert's now follows", () => {
    const incidentAccess: Record<string, ColumnAccessControl> =
      new Incident().getColumnAccessControlForAllColumns();

    expect(incidentAccess["rootCause"]?.update).toEqual(
      new Incident().getUpdatePermissions(),
    );
    expect(alertAccess["rootCause"]?.update).toEqual(
      new Alert().getUpdatePermissions(),
    );
  });
});

describe("an API update of an alert's root cause", () => {
  test.each(EDITORS)("is let through for %s", (permission: Permission) => {
    for (const rootCause of ROOT_CAUSE_WRITES) {
      expect({
        rootCause,
        refusal: updateRefusal([permission], { rootCause: rootCause }),
      }).toEqual({ rootCause, refusal: null });
    }
  });

  test.each(EDITORS)(
    "is let through for %s alongside the alert's other notes, as a whole-record write sends it",
    (permission: Permission) => {
      expect(
        updateRefusal([permission], {
          title: "Disk is full",
          description: "db-1 stopped taking writes.",
          rootCause: "Log rotation was switched off.",
          remediationNotes: "Switch log rotation back on.",
        }),
      ).toBeNull();
    },
  );

  test.each(READ_ONLY)(
    "is refused for %s, naming who may make it",
    (permission: Permission) => {
      const refusal: unknown = updateRefusal([permission], {
        rootCause: "Log rotation was switched off.",
      });

      expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
      expect((refusal as Error).message).toMatch(
        /^User is not allowed to update on rootCause column of Alert\./,
      );
      // Someone may: the refusal names the alert's editors, not nobody.
      expect((refusal as Error).message).toContain(
        ColumnRefusalMessage.getWhoMay("update", EDITORS),
      );
      expect((refusal as Error).message).not.toContain(
        NO_PERMISSION_ALLOWS.update,
      );
    },
  );

  test("is refused when every read-only role is held at once", () => {
    expect(
      updateRefusal(READ_ONLY, { rootCause: "Log rotation was switched off." }),
    ).toBeInstanceOf(ColumnWriteRefusedException);
  });

  test("a read-only role beside an editing one is let through", () => {
    expect(
      updateRefusal([Permission.Viewer, Permission.AlertMember], {
        rootCause: "Log rotation was switched off.",
      }),
    ).toBeNull();
  });

  test("an update that leaves the root cause out is not asked about it", () => {
    expect(
      updateRefusal([Permission.AlertMember], {
        title: "Disk is full",
        rootCause: undefined,
      }),
    ).toBeNull();
  });
});

describe("the API's alert schemas", () => {
  test("write the root cause on update, as on create, and read it", () => {
    expect(
      shapeKeys(ModelSchema.getUpdateModelSchema({ modelType: Alert })),
    ).toContain("rootCause");
    expect(
      shapeKeys(ModelSchema.getCreateModelSchema({ modelType: Alert })),
    ).toContain("rootCause");
    expect(
      shapeKeys(ModelSchema.getReadModelSchema({ modelType: Alert })),
    ).toContain("rootCause");
  });

  test("the dashboard's Terraform pages offer root_cause as an attribute updated in place", () => {
    const descriptor: TerraformAttributeDescriptor | undefined =
      getTerraformAttributes(Alert).find(
        (attribute: TerraformAttributeDescriptor): boolean => {
          return attribute.columnName === "rootCause";
        },
      );

    expect(descriptor).toEqual(
      expect.objectContaining({
        attributeName: "root_cause",
        inCreateSchema: true,
        inUpdateSchema: true,
        isRequired: false,
        isServerManaged: false,
      }),
    );
  });
});

describe("the published OpenAPI document", () => {
  let schemas: Record<string, JSONObject>;
  let resources: Map<string, TerraformResource>;

  beforeAll(() => {
    const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();

    schemas = (spec["components"] as JSONObject)["schemas"] as Record<
      string,
      JSONObject
    >;

    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec as never);

    resources = new Map<string, TerraformResource>();

    for (const resource of parser.getResources()) {
      resources.set(`oneuptime_${resource.name}`, resource);
    }
  });

  function properties(schemaName: string): Record<string, JSONObject> {
    return (
      (((schemas[schemaName] || {}) as JSONObject)["properties"] as
        | Record<string, JSONObject>
        | undefined) || {}
    );
  }

  test("an alert's update writes its root cause, as its create does", () => {
    expect(properties("AlertUpdateSchema")["rootCause"]).toBeDefined();
    expect(properties("AlertCreateSchema")["rootCause"]).toBeDefined();
    expect(properties("AlertReadSchema")["rootCause"]).toBeDefined();
  });

  test("the Terraform provider changes an alert's root_cause in place, never by making a new alert", () => {
    const resource: TerraformResource | undefined =
      resources.get("oneuptime_alert");

    expect(resource).toBeDefined();

    const attribute: TerraformAttribute | undefined =
      resource!.schema["root_cause"];

    expect(attribute).toBeDefined();
    expect(attribute?.forceNew).toBeFalsy();
    expect(attribute?.required).toBeFalsy();
    expect(attribute?.optional).toBe(true);

    expect(Object.keys(resource!.operationSchemas?.create || {})).toContain(
      "root_cause",
    );
    expect(Object.keys(resource!.operationSchemas?.update || {})).toContain(
      "root_cause",
    );
  });

  test("an alert's root_cause is shaped as an incident's is", () => {
    const alertAttribute: TerraformAttribute | undefined =
      resources.get("oneuptime_alert")?.schema["root_cause"];
    const incidentAttribute: TerraformAttribute | undefined =
      resources.get("oneuptime_incident")?.schema["root_cause"];

    expect(incidentAttribute).toBeDefined();
    expect({
      type: alertAttribute?.type,
      required: Boolean(alertAttribute?.required),
      optional: Boolean(alertAttribute?.optional),
      computed: Boolean(alertAttribute?.computed),
      forceNew: Boolean(alertAttribute?.forceNew),
    }).toEqual({
      type: incidentAttribute?.type,
      required: Boolean(incidentAttribute?.required),
      optional: Boolean(incidentAttribute?.optional),
      computed: Boolean(incidentAttribute?.computed),
      forceNew: Boolean(incidentAttribute?.forceNew),
    });
  });
});
