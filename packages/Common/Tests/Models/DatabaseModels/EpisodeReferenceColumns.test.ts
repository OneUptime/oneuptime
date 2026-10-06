import Alert from "../../../Models/DatabaseModels/Alert";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * An incident's episode (incidentEpisodeId / incidentEpisode) and an alert's
 * (alertEpisodeId / alertEpisode) mirror the episode's members, and only
 * the member services move them (EpisodeMembershipReference). Both columns
 * used to list the record's creators and editors, so the API, Terraform,
 * the MCP tools and a workflow's Update step could point a record at an
 * episode it was not a member of: the episode's overview then listed it
 * while the episode's members did not, and a record created with one was
 * never grouped.
 *
 * Pinned here at the source every surface is generated from - the column
 * permission lists - and in what is generated from them: the check every
 * API request passes, the published API's write schemas, and the Terraform
 * provider built from that document.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194e9a0-0000-4000-8000-000000000001",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0194e9a0-0000-4000-8000-0000000000e1",
);

type ModelType = { new (): DatabaseBaseModel };

interface Kind {
  name: "Incident" | "Alert";
  modelType: ModelType;
  // The episode's two names, ID column first.
  idColumn: string;
  relation: string;
  // Everyone who may create the record, and everyone who may edit it.
  creators: Array<Permission>;
  editors: Array<Permission>;
  // Who may read the episode: whoever may read the record.
  readers: Array<Permission>;
  // A create every creator may make, but for the episode.
  newRecord: () => DatabaseBaseModel;
  // What the Terraform provider calls the resource and the attribute.
  resourceName: string;
  attributeName: string;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    modelType: Incident,
    idColumn: "incidentEpisodeId",
    relation: "incidentEpisode",
    creators: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    editors: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
    readers: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    newRecord: (): DatabaseBaseModel => {
      const incident: Incident = new Incident();
      incident.projectId = PROJECT_ID;
      incident.title = "Payments are down";
      incident.incidentSeverityId = ObjectID.generate();
      return incident;
    },
    resourceName: "oneuptime_incident",
    attributeName: "incident_episode_id",
  },
  {
    name: "Alert",
    modelType: Alert,
    idColumn: "alertEpisodeId",
    relation: "alertEpisode",
    creators: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.CreateAlert,
    ],
    editors: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.EditAlert,
    ],
    readers: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlert,
    ],
    newRecord: (): DatabaseBaseModel => {
      const alert: Alert = new Alert();
      alert.projectId = PROJECT_ID;
      alert.title = "Disk is full";
      alert.alertSeverityId = ObjectID.generate();
      return alert;
    },
    resourceName: "oneuptime_alert",
    attributeName: "alert_episode_id",
  },
];

// A person in the project holding one permission, as an API request carries it.
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

// Each way a write can name the episode: either name, and a clear.
function episodeWrites(kind: Kind): Array<Record<string, unknown>> {
  return [
    { [kind.idColumn]: EPISODE_ID },
    { [kind.relation]: { _id: EPISODE_ID.toString() } },
    { [kind.idColumn]: EPISODE_ID, [kind.relation]: { _id: EPISODE_ID } },
    { [kind.idColumn]: null },
  ];
}

function refusalOf(write: () => void): unknown {
  try {
    write();
  } catch (error) {
    return error;
  }

  return null;
}

function shapeKeys(schema: unknown): Array<string> {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

describe.each(KINDS)("$name's episode", (kind: Kind) => {
  const accessControl: Record<string, ColumnAccessControl> =
    new kind.modelType().getColumnAccessControlForAllColumns();

  test("nobody may set it, under either name", () => {
    for (const column of [kind.idColumn, kind.relation]) {
      expect({ column, create: accessControl[column]?.create }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: accessControl[column]?.update }).toEqual({
        column,
        update: [],
      });
    }
  });

  test("whoever may read the record may read it, under either name", () => {
    for (const column of [kind.idColumn, kind.relation]) {
      expect({ column, read: accessControl[column]?.read }).toEqual({
        column,
        read: kind.readers,
      });
    }
  });

  test.each(kind.creators)(
    "a create that names it is refused for %s, who may make the same create without it",
    (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = propsWith(permission);

      expect(
        refusalOf(() => {
          ModelPermission.checkCreatePermissions(
            kind.modelType,
            kind.newRecord(),
            props,
          );
        }),
      ).toBeNull();

      for (const values of episodeWrites(kind)) {
        const record: DatabaseBaseModel = kind.newRecord();
        Object.assign(record, values);

        const refusal: unknown = refusalOf(() => {
          ModelPermission.checkCreatePermissions(kind.modelType, record, props);
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toMatch(
          new RegExp(
            `^User is not allowed to create on (${kind.idColumn}|${kind.relation}) column of ${kind.name}$`,
          ),
        );
      }
    },
  );

  test.each(kind.editors)(
    "an update that writes it is refused for %s, who may make the same update without it",
    (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = propsWith(permission);

      const update: (values: Record<string, unknown>) => unknown = (
        values: Record<string, unknown>,
      ): unknown => {
        return refusalOf(() => {
          ColumnPermissions.checkDataColumnPermissions(
            kind.modelType,
            values as unknown as DatabaseBaseModel,
            props,
            DatabaseRequestType.Update,
          );
        });
      };

      expect(update({ title: "Renamed" })).toBeNull();

      for (const values of episodeWrites(kind)) {
        const refusal: unknown = update({ title: "Renamed", ...values });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toMatch(
          new RegExp(
            `^User is not allowed to update on (${kind.idColumn}|${kind.relation}) column of ${kind.name}$`,
          ),
        );
      }
    },
  );

  test("the create and update schemas leave it out, as the API, its docs and the MCP tools read them", () => {
    const createKeys: Array<string> = shapeKeys(
      ModelSchema.getCreateModelSchema({ modelType: kind.modelType }),
    );
    const updateKeys: Array<string> = shapeKeys(
      ModelSchema.getUpdateModelSchema({ modelType: kind.modelType }),
    );
    const readKeys: Array<string> = shapeKeys(
      ModelSchema.getReadModelSchema({ modelType: kind.modelType }),
    );

    for (const column of [kind.idColumn, kind.relation]) {
      expect({ column, inCreate: createKeys.includes(column) }).toEqual({
        column,
        inCreate: false,
      });
      expect({ column, inUpdate: updateKeys.includes(column) }).toEqual({
        column,
        inUpdate: false,
      });
    }

    // Still read, and the record's own fields are still written.
    expect(readKeys).toContain(kind.idColumn);
    expect(createKeys).toContain("title");
    expect(updateKeys).toContain("title");
  });

  test("the dashboard's Terraform pages offer it as no attribute", () => {
    const columns: Array<string> = getTerraformAttributes(kind.modelType).map(
      (descriptor: TerraformAttributeDescriptor): string => {
        return descriptor.columnName;
      },
    );

    expect(columns).not.toContain(kind.idColumn);
    expect(columns).not.toContain(kind.relation);
    expect(columns).toContain("title");
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

  test.each(KINDS)("$name: read, never written", (kind: Kind) => {
    expect(properties(`${kind.name}ReadSchema`)[kind.idColumn]).toBeDefined();

    for (const suffix of ["CreateSchema", "UpdateSchema"]) {
      for (const column of [kind.idColumn, kind.relation]) {
        expect({
          schema: `${kind.name}${suffix}`,
          column,
          present: Boolean(properties(`${kind.name}${suffix}`)[column]),
        }).toEqual({
          schema: `${kind.name}${suffix}`,
          column,
          present: false,
        });
      }
    }

    // The schemas are there: the record's own fields are still written.
    expect(properties(`${kind.name}CreateSchema`)["title"]).toBeDefined();
  });

  test.each(KINDS)(
    "$name: the Terraform provider generated from it computes the episode and never sends it",
    (kind: Kind) => {
      const resource: TerraformResource | undefined = resources.get(
        kind.resourceName,
      );

      expect(resource).toBeDefined();

      const attribute: TerraformAttribute | undefined =
        resource!.schema[kind.attributeName];

      expect(attribute).toEqual(expect.objectContaining({ computed: true }));
      expect(attribute?.optional).toBeFalsy();
      expect(attribute?.required).toBeFalsy();

      // The provider writes only what its create and update requests carry.
      expect(
        Object.keys(resource!.operationSchemas?.create || {}),
      ).not.toContain(kind.attributeName);
      expect(
        Object.keys(resource!.operationSchemas?.update || {}),
      ).not.toContain(kind.attributeName);
    },
  );
});
