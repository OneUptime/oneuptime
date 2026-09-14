import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import LabelService from "../../../Server/Services/LabelService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyService from "../../../Server/Services/NetworkAlertPolicyService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceRoleService from "../../../Server/Services/NetworkDeviceRoleService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Services from "../../../Server/Services/Index";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import GenericFunction from "../../../Types/GenericFunction";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkAlertPolicyScope from "../../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

/*
 * NetworkAlertPolicy: the contracts that live in metadata and in wiring, and
 * the write-time guards in its service.
 *
 * A policy is "alert on a SET of devices": one Network Device monitor per
 * matching device, cloned from a template by an engine
 * (NetworkAlertPolicyEngineService) that hangs off this service's hooks. The
 * engine's own behaviour is pinned by NetworkAlertPolicyEngineService.test.ts
 * and its attachment to these hooks by NetworkAlertPolicyEngineHooks.test.ts;
 * what THIS file pins is everything the engine has to be able to trust about
 * a saved row:
 *
 *  1. THE ROW IS TENANT-SCOPED AND API-EXPOSED, with its own four granular
 *     permissions in the Monitor group, and writes held to owners, admins
 *     and those granular permissions — no ProjectMember, no Viewer — because
 *     a policy is spend, not a label. Four engine-owned columns are readable
 *     and never writable through the API. At most one policy per template
 *     per project, by partial unique index.
 *
 *  2. THE TEMPLATE IS REQUIRED TO THE OPERATOR, NULLABLE TO THE DATABASE, and
 *     the FK is SET NULL. Deleting a template must disable the policies that
 *     used it, never delete them.
 *
 *  3. THE SCOPE IS jsonb, NOT NULL, DEFAULTED TO `{}`, and every write goes
 *     through NetworkAlertPolicyScopeUtil.normalize, so the stored form is
 *     always the canonical one.
 *
 *  4. THE TEMPLATE IS TENANCY-CHECKED under both spellings a relation
 *     arrives in, a template from another project is indistinguishable from
 *     one that does not exist, and only a Network Device template is
 *     accepted.
 *
 *  5. THE CALLER MAY CAUSE MONITORS TO EXIST. Saving a policy — and enabling
 *     one, which is the same decision a day later — provisions billable
 *     monitors, so it takes the MONITOR table's create permission and a read
 *     of the template with the caller's own scopes. Without the second, a
 *     user who may edit policies could point one at a template their label
 *     scopes hide and have the engine clone it as root across the fleet.
 *
 *  6. EVERY SCOPE ID BELONGS TO THIS PROJECT, checked where the operator
 *     typed it. The scope is jsonb with no foreign keys behind it, so
 *     nothing else can catch a site id pasted from another tenant's URL —
 *     which would not leak that tenant's data, but would produce a policy
 *     that silently matches nothing forever. A non-UUID is refused outright,
 *     because `uuid = 'nonsense'` is a statement error rather than an empty
 *     result and would take a sweep down.
 *
 * Nothing here touches a database: the model is read for its decorator
 * metadata, the service hooks are run against spied collaborator services,
 * and the API router is read off its source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_TEMPLATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const POLICY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SITE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LABEL_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/*
 * Partial<> under exactOptionalPropertyTypes refuses an explicit undefined,
 * and "this field was left out of the payload" is exactly what several of
 * the cases below have to send.
 */
type PolicyOverrides = {
  [Key in keyof NetworkAlertPolicy]?:
    | NetworkAlertPolicy[Key]
    | undefined
    | null;
};

type MonitorTemplateOverrides = {
  [Key in keyof MonitorTemplate]?: MonitorTemplate[Key] | undefined;
};

/*
 * The API router lives in the App workspace, which this suite cannot
 * import. It is read as text — as the other wiring tests in this directory
 * do — so the assertion is on the registration itself.
 */
const BASE_API_INDEX_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

function relationArgs(
  target: GenericFunction,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

function columnArgs(
  target: GenericFunction,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
}

function accessControlFor(
  model: BaseModel,
  columnName: string,
): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(columnName);

  expect(accessControl).not.toBeNull();

  return accessControl as ColumnAccessControl;
}

describe("NetworkAlertPolicy is a project-scoped, API-exposed table", () => {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();

  test("it is scoped to a project by projectId", () => {
    expect(policy.getTenantColumn()).toBe("projectId");
  });

  test("it is served at /network-alert-policy", () => {
    expect(policy.getCrudApiPath()?.toString()).toBe("/network-alert-policy");
  });

  /*
   * A model that is not in AllModelTypes gets no table and no permission
   * catalogue coverage; a service that is not in Services is never wired
   * into the API's per-model routing.
   */
  test("the model is registered", () => {
    expect(AllModelTypes).toContain(NetworkAlertPolicy);
  });

  test("the service is registered", () => {
    expect(Services).toContain(NetworkAlertPolicyService);
  });

  test("the CRUD router is mounted in the API", () => {
    expect(BASE_API_INDEX_SOURCE).toContain(
      'import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";',
    );
    expect(BASE_API_INDEX_SOURCE).toContain(
      "new BaseAPI<NetworkAlertPolicy, NetworkAlertPolicyServiceType>(",
    );
    expect(BASE_API_INDEX_SOURCE).toContain("NetworkAlertPolicyService,");
  });
});

describe("the policy's columns", () => {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();

  test("name is required short text, unique within the project", () => {
    const metadata: TableColumnMetadata = policy.getTableColumnMetadata("name");

    expect(metadata.required).toBe(true);
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(columnArgs(NetworkAlertPolicy, "name")?.options.nullable).toBe(
      false,
    );
    /*
     * Per project, not globally: the first project to write "Reachability"
     * must not stop every other project from having one.
     */
    expect(getUniqueColumnBy(policy, "name")).toBe("projectId");
  });

  test("description is optional long text", () => {
    const metadata: TableColumnMetadata =
      policy.getTableColumnMetadata("description");

    expect(metadata.required).toBe(false);
    expect(metadata.type).toBe(TableColumnType.LongText);
    expect(
      columnArgs(NetworkAlertPolicy, "description")?.options.nullable,
    ).toBe(true);
  });

  test("isEnabled is a NOT NULL boolean defaulting to true", () => {
    const metadata: TableColumnMetadata =
      policy.getTableColumnMetadata("isEnabled");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);

    const column: ColumnMetadataArgs | undefined = columnArgs(
      NetworkAlertPolicy,
      "isEnabled",
    );

    expect(column?.options.nullable).toBe(false);
    expect(column?.options.default).toBe(true);
  });

  /*
   * THE FK CONTRACT. Required to the operator (the form and the API refuse
   * a policy without one, because there is nothing to provision from) but
   * nullable to the database, so that the SET NULL below has somewhere to
   * land.
   */
  test("monitorTemplateId is required to the API but nullable in the database", () => {
    const idMetadata: TableColumnMetadata =
      policy.getTableColumnMetadata("monitorTemplateId");

    expect(idMetadata.type).toBe(TableColumnType.ObjectID);
    expect(idMetadata.required).toBe(true);
    expect(idMetadata.canReadOnRelationQuery).toBe(true);
    expect(
      columnArgs(NetworkAlertPolicy, "monitorTemplateId")?.options.nullable,
    ).toBe(true);

    const relationMetadata: TableColumnMetadata =
      policy.getTableColumnMetadata("monitorTemplate");

    expect(relationMetadata.type).toBe(TableColumnType.Entity);
    expect(relationMetadata.modelType).toBe(MonitorTemplate);
    expect(relationMetadata.manyToOneRelationColumn).toBe("monitorTemplateId");
  });

  /*
   * Configuration must never delete intent. Deleting "Reachability v1"
   * takes the template away from the policies that used it — they can no
   * longer provision and the settings table can say so — but their names,
   * scopes and descriptions survive for the operator to repair. A CASCADE
   * here would make deleting one template delete six policies silently.
   */
  test("deleting the template detaches the policy rather than deleting it", () => {
    const relation: RelationMetadataArgs | undefined = relationArgs(
      NetworkAlertPolicy,
      "monitorTemplate",
    );

    expect(relation?.options.onDelete).toBe("SET NULL");
    expect(relation?.options.nullable).toBe(true);
  });

  /*
   * The template columns take the MonitorTemplate's own read permissions
   * (the NetworkDeviceAutoImportRule precedent): selecting the relation
   * reads a template's name and type, so it costs what reading a template
   * costs. Writing them, by contrast, is gated on the policy's own
   * permissions and never on a cross-model monitor permission.
   */
  test.each(["monitorTemplate", "monitorTemplateId"])(
    "%s is read under the monitor template's permissions and written under the policy's",
    (columnName: string) => {
      const accessControl: ColumnAccessControl = accessControlFor(
        policy,
        columnName,
      );

      expect(accessControl.read).toContain(Permission.ReadMonitorTemplate);
      expect(accessControl.create).toContain(
        Permission.CreateNetworkAlertPolicy,
      );
      expect(accessControl.update).toContain(Permission.EditNetworkAlertPolicy);
      expect(accessControl.create).not.toContain(
        Permission.CreateProjectMonitor,
      );
    },
  );

  /*
   * THE SCOPE CONTRACT. jsonb so the whole picker state is one field; NOT
   * NULL with a `{}` default so the engine always finds a readable scope
   * (`{}` being "all devices", a real policy); isDefaultValueColumn so a
   * create that omits it falls through to that default rather than being
   * refused for a required column.
   */
  test("scope is a NOT NULL jsonb column defaulting to {}", () => {
    const metadata: TableColumnMetadata =
      policy.getTableColumnMetadata("scope");

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toEqual({});

    const column: ColumnMetadataArgs | undefined = columnArgs(
      NetworkAlertPolicy,
      "scope",
    );

    expect(column?.options.type).toBe(ColumnType.JSON);
    expect(column?.options.type).toBe("jsonb");
    expect(column?.options.nullable).toBe(false);
    expect(typeof column?.options.default).toBe("function");
    expect((column?.options.default as () => string)()).toBe("'{}'");
  });

  test("scope is writable by the policy's own create and edit permissions", () => {
    const accessControl: ColumnAccessControl = accessControlFor(
      policy,
      "scope",
    );

    expect(accessControl.create).toContain(Permission.CreateNetworkAlertPolicy);
    expect(accessControl.update).toContain(Permission.EditNetworkAlertPolicy);
    expect(accessControl.read).toContain(Permission.ReadNetworkAlertPolicy);
  });
});

describe("who may write a policy", () => {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();

  /*
   * A policy provisions billable monitors — an unscoped one in a large
   * estate is thousands from a single submit — so writes are held to
   * ProjectOwner, ProjectAdmin and the policy's own granular permissions.
   * Not ProjectMember, not Viewer, and none of the Settings* roles that may
   * edit a device role or a site type: those are labels, this is spend. A
   * member who needs to run policies is handed CreateNetworkAlertPolicy.
   */
  test.each([
    ["create", policy.createRecordPermissions],
    ["update", policy.updateRecordPermissions],
    ["delete", policy.deleteRecordPermissions],
  ])(
    "%s is granted to owners and admins only — never members, viewers or the Settings roles",
    (_operation: string, permissions: Array<Permission>) => {
      expect(permissions).toContain(Permission.ProjectOwner);
      expect(permissions).toContain(Permission.ProjectAdmin);
      expect(permissions).not.toContain(Permission.ProjectMember);
      expect(permissions).not.toContain(Permission.Viewer);
      expect(permissions).not.toContain(Permission.SettingsAdmin);
      expect(permissions).not.toContain(Permission.SettingsMember);
      expect(permissions).not.toContain(Permission.SettingsViewer);
    },
  );

  /*
   * The table gate is only half of it. A column that still listed
   * ProjectMember on create would pass a member's write at the column and
   * refuse it at the table — and PermissionCatalogueCoverage reads such a
   * mismatch as a mis-key. Every column's write lists have to agree with
   * the table's, so this sweeps all of them rather than naming a few.
   */
  test("no column grants create or update to ProjectMember either", () => {
    const allColumns: Dictionary<ColumnAccessControl> =
      policy.getColumnAccessControlForAllColumns();
    const offenders: Array<string> = [];

    for (const columnName of Object.keys(allColumns)) {
      const accessControl: ColumnAccessControl = allColumns[
        columnName
      ] as ColumnAccessControl;

      if (
        accessControl.create.includes(Permission.ProjectMember) ||
        accessControl.update.includes(Permission.ProjectMember)
      ) {
        offenders.push(columnName);
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Reading stays open to every project role: the policy list is how
   * anybody finds out why a monitor exists.
   */
  test("reading stays open to members and viewers", () => {
    expect(policy.readRecordPermissions).toContain(Permission.ProjectMember);
    expect(policy.readRecordPermissions).toContain(Permission.Viewer);
    expect(policy.readRecordPermissions).toContain(
      Permission.ReadNetworkAlertPolicy,
    );
  });

  /*
   * The table's own access control has to accept the granular permissions,
   * or granting "Create Network Alert Policy" to a team would grant nothing
   * at all.
   */
  test("the model's table access control honours each granular permission", () => {
    expect(policy.createRecordPermissions).toContain(
      Permission.CreateNetworkAlertPolicy,
    );
    expect(policy.readRecordPermissions).toContain(
      Permission.ReadNetworkAlertPolicy,
    );
    expect(policy.updateRecordPermissions).toContain(
      Permission.EditNetworkAlertPolicy,
    );
    expect(policy.deleteRecordPermissions).toContain(
      Permission.DeleteNetworkAlertPolicy,
    );
  });
});

describe("the engine's own columns", () => {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();

  interface EngineColumnUnderTest {
    name: string;
    type: TableColumnType;
    columnType: ColumnType;
  }

  const ENGINE_COLUMNS: Array<EngineColumnUnderTest> = [
    {
      name: "lastSyncAt",
      type: TableColumnType.Date,
      columnType: ColumnType.Date,
    },
    {
      name: "lastSyncError",
      type: TableColumnType.LongText,
      columnType: ColumnType.LongText,
    },
    {
      name: "coveredDeviceCount",
      type: TableColumnType.Number,
      columnType: ColumnType.Number,
    },
    {
      name: "templateSyncedAt",
      type: TableColumnType.Date,
      columnType: ColumnType.Date,
    },
  ];

  /*
   * Written by the engine as root after each pass; the API can read them
   * and never set them (the Monitor.autoProvisionedNetworkDeviceId
   * pairing). A client that could write coveredDeviceCount would be lying
   * to the settings table, and one that could clear lastSyncError would
   * hide a failing policy.
   */
  test.each(ENGINE_COLUMNS)(
    "$name can be read through the API but never created or updated",
    (column: EngineColumnUnderTest) => {
      const accessControl: ColumnAccessControl = accessControlFor(
        policy,
        column.name,
      );

      expect(accessControl.create).toEqual([]);
      expect(accessControl.update).toEqual([]);
      expect(accessControl.read).toContain(Permission.ReadNetworkAlertPolicy);
      expect(accessControl.read).toContain(Permission.Viewer);
    },
  );

  test.each(ENGINE_COLUMNS)(
    "$name is optional and nullable, of the declared type",
    (column: EngineColumnUnderTest) => {
      const metadata: TableColumnMetadata = policy.getTableColumnMetadata(
        column.name,
      );

      expect(metadata.type).toBe(column.type);
      expect(metadata.required).toBe(false);

      const dbColumn: ColumnMetadataArgs | undefined = columnArgs(
        NetworkAlertPolicy,
        column.name,
      );

      expect(dbColumn?.options.type).toBe(column.columnType);
      expect(dbColumn?.options.nullable).toBe(true);
    },
  );

  test("coveredDeviceCount starts at 0, so a never-synced policy reads as covering nothing rather than as blank", () => {
    expect(
      columnArgs(NetworkAlertPolicy, "coveredDeviceCount")?.options.default,
    ).toBe(0);
    expect(
      policy.getTableColumnMetadata("coveredDeviceCount").defaultValue,
    ).toBe(0);
  });
});

describe("one policy per template per project", () => {
  /*
   * A provisioned monitor's provenance is (device, template) — the unique
   * index Monitor itself carries — so that pair is the only key the engine
   * has for "is this monitor mine?". A template used by two policies would
   * make ownership of every (device, template) monitor ambiguous: both
   * would claim it, the second to provision would fail on Monitor's index
   * forever, and neither could safely tear it down. The service refuses
   * the second policy with a sentence; this index is what makes the
   * refusal true under a race.
   */
  test("is enforced by a partial unique index on (projectId, monitorTemplateId)", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === NetworkAlertPolicy &&
            Array.isArray(candidate.columns) &&
            candidate.columns.length === 2 &&
            candidate.columns[0] === "projectId" &&
            candidate.columns[1] === "monitorTemplateId"
          );
        },
      );

    expect(index).toBeDefined();
    expect(index?.unique).toBe(true);
    /*
     * Partial on both counts: a soft-deleted policy must release its
     * template for a replacement, and a policy whose template was SET NULL
     * by a template delete must not collide with the next one in the same
     * state.
     */
    expect(index?.where).toContain('"deletedAt" IS NULL');
    expect(index?.where).toContain('"monitorTemplateId" IS NOT NULL');
  });
});

describe("the four policy permissions", () => {
  interface PolicyPermissionUnderTest {
    name: string;
    permission: Permission;
  }

  /*
   * The names are written out rather than derived from the enum, because
   * the stored value is the half that matters: a team's permission row
   * persists the string, so a value that drifts from its member name
   * orphans every grant already handed out.
   */
  const POLICY_PERMISSIONS: Array<PolicyPermissionUnderTest> = [
    {
      name: "CreateNetworkAlertPolicy",
      permission: Permission.CreateNetworkAlertPolicy,
    },
    {
      name: "ReadNetworkAlertPolicy",
      permission: Permission.ReadNetworkAlertPolicy,
    },
    {
      name: "EditNetworkAlertPolicy",
      permission: Permission.EditNetworkAlertPolicy,
    },
    {
      name: "DeleteNetworkAlertPolicy",
      permission: Permission.DeleteNetworkAlertPolicy,
    },
  ];

  /*
   * A permission the enum declares but the catalogue does not describe
   * cannot be granted: the team-permission editor renders from
   * getAllPermissionProps.
   */
  test.each(POLICY_PERMISSIONS)(
    "$name has a catalogue entry in the Monitor group, assignable to a team",
    (entry: PolicyPermissionUnderTest) => {
      const descriptor: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (props: PermissionProps): boolean => {
            return props.permission === entry.permission;
          },
        );

      expect(descriptor).toBeDefined();
      expect(descriptor?.group).toBe(PermissionGroup.Monitor);
      expect(descriptor?.isAssignableToTenant).toBe(true);
      expect(descriptor?.title).toContain("Network Alert Policy");
    },
  );

  test.each(POLICY_PERMISSIONS)(
    "$name is stored under exactly its own name",
    (entry: PolicyPermissionUnderTest) => {
      expect(entry.permission.toString()).toBe(entry.name);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The service's write-time guards.
 * ---------------------------------------------------------------------------
 */

function makeCreateBy(
  overrides: PolicyOverrides = {},
  props: CreateBy<NetworkAlertPolicy>["props"] = { isRoot: true },
): CreateBy<NetworkAlertPolicy> {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
  policy.projectId = PROJECT_ID;
  policy.name = "Warehouse switches";
  policy.monitorTemplateId = TEMPLATE_ID;
  Object.assign(policy, overrides);

  return {
    data: policy,
    props: props,
  };
}

function makeUpdateBy(
  data: Record<string, unknown>,
  props: UpdateBy<NetworkAlertPolicy>["props"] = {
    isRoot: false,
    tenantId: PROJECT_ID,
  },
): UpdateBy<NetworkAlertPolicy> {
  return {
    query: { _id: POLICY_ID.toString() },
    data: data,
    props: props,
  } as unknown as UpdateBy<NetworkAlertPolicy>;
}

/*
 * The template lookup is keyed on BOTH id and project — that query is the
 * whole tenancy check — so the stub answers the way the database would:
 * with the template only when the query names its project, and null for
 * any other project.
 */
function mockTemplateOwnedBy(
  ownerProjectId: ObjectID,
  overrides: MonitorTemplateOverrides = {},
): jest.SpyInstance {
  const monitorTemplate: MonitorTemplate = new MonitorTemplate();
  monitorTemplate._id = TEMPLATE_ID.toString();
  monitorTemplate.projectId = ownerProjectId;
  monitorTemplate.monitorType = MonitorType.NetworkDevice;
  Object.assign(monitorTemplate, overrides);

  return jest
    .spyOn(MonitorTemplateService, "findOneBy")
    .mockImplementation(
      async (
        findOneBy: FindOneBy<MonitorTemplate>,
      ): Promise<MonitorTemplate | null> => {
        const queriedProjectId: unknown = (
          findOneBy.query as Record<string, unknown>
        )["projectId"];
        const queriedId: unknown = (findOneBy.query as Record<string, unknown>)[
          "_id"
        ];

        if (
          queriedProjectId?.toString() === ownerProjectId.toString() &&
          queriedId?.toString() === TEMPLATE_ID.toString()
        ) {
          return monitorTemplate;
        }

        return null;
      },
    );
}

function runOnBeforeCreate(
  createBy: CreateBy<NetworkAlertPolicy>,
): Promise<{ createBy: CreateBy<NetworkAlertPolicy> }> {
  return (NetworkAlertPolicyService as any).onBeforeCreate(createBy);
}

function runOnBeforeUpdate(
  updateBy: UpdateBy<NetworkAlertPolicy>,
): Promise<{ updateBy: UpdateBy<NetworkAlertPolicy> }> {
  return (NetworkAlertPolicyService as any).onBeforeUpdate(updateBy);
}

/*
 * After the template itself passes, the service asks two more questions —
 * "does another policy in this project already use it?" and "does an
 * auto-import rule?" — through NetworkAlertPolicyService.findBy and
 * NetworkDeviceAutoImportRuleService.findBy. This answers both with "no",
 * and answers the update path's matched-row read (the same findBy, without
 * a monitorTemplateId in its query) with one policy in the caller's
 * project. Tests about the conflicts themselves override it.
 */
function mockNoTemplateConflicts(): {
  policies: jest.SpyInstance;
  rules: jest.SpyInstance;
} {
  const existing: NetworkAlertPolicy = new NetworkAlertPolicy();
  existing._id = POLICY_ID.toString();
  existing.projectId = PROJECT_ID;

  const policies: jest.SpyInstance = jest
    .spyOn(NetworkAlertPolicyService, "findBy")
    .mockImplementation(
      async (
        findBy: FindBy<NetworkAlertPolicy>,
      ): Promise<Array<NetworkAlertPolicy>> => {
        const query: Record<string, unknown> = findBy.query as Record<
          string,
          unknown
        >;

        if (query["monitorTemplateId"]) {
          return [];
        }

        return [existing];
      },
    );

  const rules: jest.SpyInstance = jest
    .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
    .mockResolvedValue([]);

  return { policies, rules };
}

/*
 * The rest of the write path saying "yes".
 *
 * Two more guards run on every accepted write and both would otherwise reach
 * a database (or a permission stack) these tests do not have:
 *
 *   - THE CALLER MAY CAUSE MONITORS TO EXIST: the Monitor table's create
 *     permission, plus a read of the template with the CALLER's own props.
 *     Stubbed to allow, so the cases about templates and scopes are about
 *     templates and scopes; the block about the permission itself removes
 *     these stubs and asserts the refusals.
 *   - EVERY SCOPE ID BELONGS TO THIS PROJECT: one read per non-empty kind
 *     against NetworkSite, NetworkDeviceRole and Label. Stubbed to echo back
 *     whatever ids the query asked about, i.e. "they all exist here"; the
 *     scope block overrides it to answer with a missing row.
 */
function mockScopeAndPermissionChecksPass(): {
  monitorCreateAllowed: jest.SpyInstance;
  templateReadableByCaller: jest.SpyInstance;
} {
  const monitorCreateAllowed: jest.SpyInstance = jest
    .spyOn(TablePermission, "checkTableLevelPermissions")
    .mockImplementation((): void => {
      return undefined;
    });

  jest
    .spyOn(TablePermission, "checkTableLevelBlockPermissions")
    .mockImplementation((): void => {
      return undefined;
    });

  const readableTemplate: MonitorTemplate = new MonitorTemplate();
  readableTemplate._id = TEMPLATE_ID.toString();

  const templateReadableByCaller: jest.SpyInstance = jest
    .spyOn(MonitorTemplateService, "findOneById")
    .mockResolvedValue(readableTemplate);

  const echoQueriedIds: (
    findBy: FindBy<BaseModel>,
  ) => Promise<Array<BaseModel>> = async (
    findBy: FindBy<BaseModel>,
  ): Promise<Array<BaseModel>> => {
    /*
     * The service asks with an `Includes` so the ids stay readable — both to
     * this stub and to whoever debugs the query later.
     */
    const queried: Includes = (findBy.query as Record<string, unknown>)[
      "_id"
    ] as Includes;

    return (queried?.values || []).map(
      (id: string | ObjectID | number): BaseModel => {
        const row: NetworkSite = new NetworkSite();
        row._id = id.toString();

        return row as unknown as BaseModel;
      },
    );
  };

  jest
    .spyOn(NetworkSiteService, "findBy")
    .mockImplementation(echoQueriedIds as never);
  jest
    .spyOn(NetworkDeviceRoleService, "findBy")
    .mockImplementation(echoQueriedIds as never);
  jest
    .spyOn(LabelService, "findBy")
    .mockImplementation(echoQueriedIds as never);

  return { monitorCreateAllowed, templateReadableByCaller };
}

function policyRow(id: ObjectID, projectId: ObjectID): NetworkAlertPolicy {
  const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
  policy._id = id.toString();
  policy.projectId = projectId;

  return policy;
}

describe("NetworkAlertPolicyService.onBeforeCreate", () => {
  beforeEach(() => {
    mockNoTemplateConflicts();
    mockScopeAndPermissionChecksPass();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a Network Device template from the policy's own project", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    const result: { createBy: CreateBy<NetworkAlertPolicy> } =
      await runOnBeforeCreate(makeCreateBy());

    expect(result.createBy.data.monitorTemplateId?.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
    /*
     * The tenancy check IS the query. A lookup by id alone, followed by a
     * comparison, would still be correct — but the query form is what makes
     * "other project" and "does not exist" the same answer.
     */
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: TEMPLATE_ID,
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  /*
   * THE INVARIANT THIS BLOCK EXISTS FOR. The FK only proves the template
   * row exists; a policy pointing at another tenant's template would have
   * the engine clone it, as root, into this project. And the refusal must
   * not say "wrong project", because that would confirm the id exists.
   */
  test("refuses a template from another project as not found", async () => {
    mockTemplateOwnedBy(OTHER_PROJECT_ID);

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Monitor Template not found.",
    );
  });

  test("refuses a template that does not exist with the same message", async () => {
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(null);

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Monitor Template not found.",
    );
  });

  /*
   * Belt and braces: even if the lookup ever stopped filtering by project,
   * a returned row from elsewhere is still refused, with the same message.
   */
  test("refuses a returned template whose projectId disagrees, as not found", async () => {
    const monitorTemplate: MonitorTemplate = new MonitorTemplate();
    monitorTemplate.projectId = OTHER_PROJECT_ID;
    monitorTemplate.monitorType = MonitorType.NetworkDevice;

    jest
      .spyOn(MonitorTemplateService, "findOneBy")
      .mockResolvedValue(monitorTemplate);

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Monitor Template not found.",
    );
  });

  test("refuses a template that is not a Network Device template", async () => {
    mockTemplateOwnedBy(PROJECT_ID, { monitorType: MonitorType.Ping });

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Monitor Template must be a Network Device monitor template.",
    );
  });

  test("refuses a template with no type at all", async () => {
    mockTemplateOwnedBy(PROJECT_ID, { monitorType: undefined });

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      BadDataException,
    );
  });

  /*
   * The dashboard posts the relation object, not the FK column. A guard
   * that only read `monitorTemplateId` would wave every UI-created policy
   * through unchecked.
   */
  test("reads the template under the relation spelling the dashboard posts", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(OTHER_PROJECT_ID);

    const monitorTemplate: MonitorTemplate = new MonitorTemplate();
    monitorTemplate._id = TEMPLATE_ID.toString();

    await expect(
      runOnBeforeCreate(
        makeCreateBy({
          monitorTemplateId: undefined,
          monitorTemplate: monitorTemplate,
        }),
      ),
    ).rejects.toThrow("Monitor Template not found.");

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ _id: TEMPLATE_ID }),
      }),
    );
  });

  test("refuses a payload whose two template spellings disagree, before any lookup", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    const monitorTemplate: MonitorTemplate = new MonitorTemplate();
    monitorTemplate._id = OTHER_TEMPLATE_ID.toString();

    await expect(
      runOnBeforeCreate(
        makeCreateBy({
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: monitorTemplate,
        }),
      ),
    ).rejects.toThrow("Conflicting Monitor Template references were provided.");

    expect(findSpy).not.toHaveBeenCalled();
  });

  test("refuses a policy with no template", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    await expect(
      runOnBeforeCreate(makeCreateBy({ monitorTemplateId: undefined })),
    ).rejects.toThrow("Monitor Template is required.");
    await expect(
      runOnBeforeCreate(
        makeCreateBy({
          monitorTemplateId: null as unknown as ObjectID,
        }),
      ),
    ).rejects.toThrow("Monitor Template is required.");

    expect(findSpy).not.toHaveBeenCalled();
  });

  test("takes the project from the caller's tenant when the data carries none", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    await runOnBeforeCreate(
      makeCreateBy(
        { projectId: undefined },
        { isRoot: false, tenantId: PROJECT_ID },
      ),
    );

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId: PROJECT_ID }),
      }),
    );
  });

  test("refuses a create with no project anywhere", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    await expect(
      runOnBeforeCreate(
        makeCreateBy({ projectId: undefined }, { isRoot: true }),
      ),
    ).rejects.toThrow("Project ID is required");

    expect(findSpy).not.toHaveBeenCalled();
  });

  /*
   * name is unique per project. Untrimmed, "Warehouse " and "Warehouse"
   * are two policies to the database and one to everybody reading the
   * table.
   */
  test("trims the name", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const result: { createBy: CreateBy<NetworkAlertPolicy> } =
      await runOnBeforeCreate(
        makeCreateBy({ name: "  Warehouse switches \n" }),
      );

    expect(result.createBy.data.name).toBe("Warehouse switches");
  });

  test.each(["", "   ", "\t\n", undefined, null])(
    "refuses a name of %p",
    async (name: string | undefined | null) => {
      mockTemplateOwnedBy(PROJECT_ID);

      await expect(
        runOnBeforeCreate(makeCreateBy({ name: name as string | undefined })),
      ).rejects.toThrow("Name is required.");
    },
  );

  /*
   * The engine reads the column on every device event and never runs
   * normalize on the read path for the dedup — the canonical form has to be
   * what is stored.
   */
  test("stores the scope in its canonical form", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const result: { createBy: CreateBy<NetworkAlertPolicy> } =
      await runOnBeforeCreate(
        makeCreateBy({
          scope: {
            siteIds: [SITE_ID, SITE_ID, " ", null],
            // A lone string is one id — a client that sent it meant a list.
            networkDeviceRoleIds: ROLE_ID,
            stray: true,
          } as unknown as NetworkAlertPolicyScope,
        }),
      );

    expect(result.createBy.data.scope).toEqual({
      siteIds: [SITE_ID],
      networkDeviceRoleIds: [ROLE_ID],
      labelIds: [],
    });
  });

  test("writes the empty scope when none was sent, so the column is never null", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const result: { createBy: CreateBy<NetworkAlertPolicy> } =
      await runOnBeforeCreate(makeCreateBy({ scope: undefined }));

    expect(result.createBy.data.scope).toEqual({
      siteIds: [],
      networkDeviceRoleIds: [],
      labelIds: [],
    });
  });

  /*
   * A provisioned monitor's provenance is (device, template) — Monitor's
   * own unique index — so one template has room for one owner. The second
   * policy on a template would fail on that index at the first shared
   * device while both claimed the monitor; the operator is told here, in a
   * sentence, rather than by the constraint violation from the partial
   * unique index that backs this check.
   */
  test("refuses a template another policy in the project already uses", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const policiesSpy: jest.SpyInstance = jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([policyRow(OTHER_POLICY_ID, PROJECT_ID)]);

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Another alert policy already uses this Monitor Template.",
    );

    // Root and project-keyed: the question is about THIS project's policies.
    expect(policiesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: PROJECT_ID,
          monitorTemplateId: TEMPLATE_ID,
        }),
        props: { isRoot: true },
      }),
    );
  });

  /*
   * The same collision from the other side: the rule provisions on import,
   * the policy then finds a monitor that looks like its own and takes it
   * down when the device leaves the scope.
   */
  test("refuses a template an auto-import rule in the project references", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
    rule.projectId = PROJECT_ID;
    rule.monitorTemplateId = TEMPLATE_ID;

    const rulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([rule]);

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "This Monitor Template is used by an auto-import rule; pick a different template.",
    );

    expect(rulesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: PROJECT_ID,
          monitorTemplateId: TEMPLATE_ID,
        }),
        props: { isRoot: true },
      }),
    );
  });

  /*
   * Ordering: a template that fails its own checks never reaches the claim
   * checks, so "not found" for another tenant's template stays "not found"
   * and cannot leak whether that template is in use anywhere.
   */
  test("asks about claims only after the template itself has passed", async () => {
    mockTemplateOwnedBy(OTHER_PROJECT_ID);

    const spies: { policies: jest.SpyInstance; rules: jest.SpyInstance } =
      mockNoTemplateConflicts();

    await expect(runOnBeforeCreate(makeCreateBy())).rejects.toThrow(
      "Monitor Template not found.",
    );

    expect(spies.policies).not.toHaveBeenCalled();
    expect(spies.rules).not.toHaveBeenCalled();
  });
});

describe("NetworkAlertPolicyService.onBeforeUpdate", () => {
  beforeEach(() => {
    mockNoTemplateConflicts();
    mockScopeAndPermissionChecksPass();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("leaves the template alone, and looks nothing up, when the update does not touch it", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);
    const policiesSpy: jest.SpyInstance = jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([]);

    const result: { updateBy: UpdateBy<NetworkAlertPolicy> } =
      await runOnBeforeUpdate(makeUpdateBy({ description: "Updated" }));

    expect(result.updateBy.data).toEqual({ description: "Updated" });
    expect(findSpy).not.toHaveBeenCalled();
    expect(policiesSpy).not.toHaveBeenCalled();
  });

  test("checks a re-pointed template against the caller's tenant", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    await runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }));

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: TEMPLATE_ID,
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  test("refuses re-pointing at another project's template as not found", async () => {
    mockTemplateOwnedBy(OTHER_PROJECT_ID);

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID })),
    ).rejects.toThrow("Monitor Template not found.");
  });

  test("refuses re-pointing at a template that is not a Network Device template", async () => {
    mockTemplateOwnedBy(PROJECT_ID, { monitorType: MonitorType.Website });

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID })),
    ).rejects.toThrow(
      "Monitor Template must be a Network Device monitor template.",
    );
  });

  test("reads the relation spelling on update too", async () => {
    mockTemplateOwnedBy(OTHER_PROJECT_ID);

    await expect(
      runOnBeforeUpdate(
        makeUpdateBy({ monitorTemplate: { _id: TEMPLATE_ID.toString() } }),
      ),
    ).rejects.toThrow("Monitor Template not found.");
  });

  test("refuses conflicting spellings on update", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    await expect(
      runOnBeforeUpdate(
        makeUpdateBy({
          monitorTemplateId: TEMPLATE_ID,
          monitorTemplate: { _id: OTHER_TEMPLATE_ID.toString() },
        }),
      ),
    ).rejects.toThrow("Conflicting Monitor Template references were provided.");

    expect(findSpy).not.toHaveBeenCalled();
  });

  /*
   * The database may null the column (SET NULL on template delete); the API
   * may not. A policy with no template provisions nothing, and the operator
   * has isEnabled for switching one off.
   */
  test.each([
    { monitorTemplateId: null },
    { monitorTemplate: null },
    { monitorTemplateId: "" },
  ])(
    "refuses clearing the template with %p",
    async (data: Record<string, unknown>) => {
      mockTemplateOwnedBy(PROJECT_ID);

      await expect(runOnBeforeUpdate(makeUpdateBy(data))).rejects.toThrow(
        "Monitor Template is required.",
      );
    },
  );

  /*
   * A root caller with no tenant — a worker updating by id — has no props
   * to take the project from, so the matched rows are read (as root, since
   * the hook runs before the query is permission-checked) and the template
   * is checked against each distinct project among them.
   */
  test("for a tenant-less root caller, takes the project from the matched rows", async () => {
    const findSpy: jest.SpyInstance = mockTemplateOwnedBy(PROJECT_ID);

    const existing: NetworkAlertPolicy = new NetworkAlertPolicy();
    existing._id = POLICY_ID.toString();
    existing.projectId = PROJECT_ID;

    const policiesSpy: jest.SpyInstance = jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([existing, existing]);

    await runOnBeforeUpdate(
      makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }, { isRoot: true }),
    );

    expect(policiesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: POLICY_ID.toString() },
        props: { isRoot: true },
      }),
    );
    // One distinct project among the matched rows: one template lookup.
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId: PROJECT_ID }),
      }),
    );
  });

  test("for a tenant-less root caller, a row in another project refuses the template", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const foreign: NetworkAlertPolicy = new NetworkAlertPolicy();
    foreign.projectId = OTHER_PROJECT_ID;

    jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([foreign]);

    await expect(
      runOnBeforeUpdate(
        makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }, { isRoot: true }),
      ),
    ).rejects.toThrow("Monitor Template not found.");
  });

  test("trims a written name and refuses a blank one", async () => {
    const trimmed: { updateBy: UpdateBy<NetworkAlertPolicy> } =
      await runOnBeforeUpdate(makeUpdateBy({ name: "  Depot routers  " }));

    expect(trimmed.updateBy.data.name).toBe("Depot routers");

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ name: "   " })),
    ).rejects.toThrow("Name is required.");
  });

  test("normalizes a written scope", async () => {
    const result: { updateBy: UpdateBy<NetworkAlertPolicy> } =
      await runOnBeforeUpdate(
        makeUpdateBy({
          scope: { labelIds: [SITE_ID, SITE_ID, ""], siteIds: null },
        }),
      );

    expect(result.updateBy.data.scope).toEqual({
      siteIds: [],
      networkDeviceRoleIds: [],
      labelIds: [SITE_ID],
    });
  });

  test("normalizes a scope written as null to the empty scope rather than storing null", async () => {
    const result: { updateBy: UpdateBy<NetworkAlertPolicy> } =
      await runOnBeforeUpdate(makeUpdateBy({ scope: null }));

    expect(result.updateBy.data.scope).toEqual({
      siteIds: [],
      networkDeviceRoleIds: [],
      labelIds: [],
    });
  });

  /*
   * Re-saving a policy with the template it already holds is not a
   * conflict: the rows the update matches are left out of "another
   * policy". Without this every edit of a policy from the settings form —
   * which posts the whole row, template included — would refuse itself.
   */
  test("a policy keeping its own template is not in conflict with itself", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockResolvedValue([policyRow(POLICY_ID, PROJECT_ID)]);

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID })),
    ).resolves.toBeDefined();
  });

  test("refuses re-pointing at a template another policy already uses", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    jest
      .spyOn(NetworkAlertPolicyService, "findBy")
      .mockImplementation(
        async (
          findBy: FindBy<NetworkAlertPolicy>,
        ): Promise<Array<NetworkAlertPolicy>> => {
          const query: Record<string, unknown> = findBy.query as Record<
            string,
            unknown
          >;

          // The matched-row read sees the policy itself; the claim read sees both.
          return query["monitorTemplateId"]
            ? [
                policyRow(POLICY_ID, PROJECT_ID),
                policyRow(OTHER_POLICY_ID, PROJECT_ID),
              ]
            : [policyRow(POLICY_ID, PROJECT_ID)];
        },
      );

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID })),
    ).rejects.toThrow(
      "Another alert policy already uses this Monitor Template.",
    );
  });

  test("refuses re-pointing at a template an auto-import rule references", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    jest
      .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
      .mockResolvedValue([new NetworkDeviceAutoImportRule()]);

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID })),
    ).rejects.toThrow(
      "This Monitor Template is used by an auto-import rule; pick a different template.",
    );
  });

  /*
   * onBeforeUpdate runs before DatabaseService permission-checks the query,
   * so the matched-row read — root, because it must see projectId — is
   * re-scoped to the caller's tenant first. A guessed id from another
   * project matches nothing here rather than becoming an oracle through the
   * checks that follow.
   */
  test("scopes the matched-row read to the caller's tenant", async () => {
    mockTemplateOwnedBy(PROJECT_ID);

    const spies: { policies: jest.SpyInstance; rules: jest.SpyInstance } =
      mockNoTemplateConflicts();

    await runOnBeforeUpdate(makeUpdateBy({ monitorTemplateId: TEMPLATE_ID }));

    expect(spies.policies).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: POLICY_ID.toString(), projectId: PROJECT_ID },
        props: { isRoot: true },
      }),
    );
  });
});

/*
 * PREREQUISITE 9. The scope is three lists of ids in a jsonb column with no
 * foreign keys behind them, so this hook is the only thing between a pasted
 * id and a policy that quietly covers nothing. Each non-empty kind is read
 * back against the policy's own project.
 */
describe("NetworkAlertPolicyService scope id validation", () => {
  beforeEach(() => {
    mockNoTemplateConflicts();
    mockScopeAndPermissionChecksPass();
    mockTemplateOwnedBy(PROJECT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a scope whose sites, roles and labels all exist in the project", async () => {
    await expect(
      runOnBeforeCreate(
        makeCreateBy({
          scope: {
            siteIds: [SITE_ID],
            networkDeviceRoleIds: [ROLE_ID],
            labelIds: [LABEL_ID],
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  test("reads each kind against the policy's own project", async () => {
    const siteSpy: jest.SpyInstance = jest.spyOn(NetworkSiteService, "findBy");

    await runOnBeforeCreate(makeCreateBy({ scope: { siteIds: [SITE_ID] } }));

    /*
     * projectId in the QUERY, not compared after the fact: that is what makes
     * "a site in another project" and "a site that does not exist" the same
     * answer, so the refusal cannot confirm another tenant's site id.
     */
    expect(siteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId: PROJECT_ID }),
        props: { isRoot: true },
      }),
    );
  });

  test("refuses a site id that belongs to another project", async () => {
    // The row exists somewhere; it is simply not in THIS project's read.
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);

    await expect(
      runOnBeforeCreate(makeCreateBy({ scope: { siteIds: [SITE_ID] } })),
    ).rejects.toThrow(
      `Network Site ${SITE_ID} does not belong to this project.`,
    );
  });

  test("refuses a role id that belongs to another project", async () => {
    jest.spyOn(NetworkDeviceRoleService, "findBy").mockResolvedValue([]);

    await expect(
      runOnBeforeCreate(
        makeCreateBy({ scope: { networkDeviceRoleIds: [ROLE_ID] } }),
      ),
    ).rejects.toThrow(
      `Network Device Role ${ROLE_ID} does not belong to this project.`,
    );
  });

  test("refuses a label id that belongs to another project", async () => {
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);

    await expect(
      runOnBeforeCreate(makeCreateBy({ scope: { labelIds: [LABEL_ID] } })),
    ).rejects.toThrow(`Label ${LABEL_ID} does not belong to this project.`);
  });

  /*
   * A non-UUID never reaches Postgres. `uuid = 'nonsense'` is a statement
   * ERROR rather than an empty result, so one hand-crafted API call would
   * otherwise take down every sweep that read the row afterwards.
   */
  test("refuses an id that is not a UUID without asking the database", async () => {
    const siteSpy: jest.SpyInstance = jest.spyOn(NetworkSiteService, "findBy");

    await expect(
      runOnBeforeCreate(
        makeCreateBy({
          scope: { siteIds: ["'; drop table --"] },
        }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(siteSpy).not.toHaveBeenCalled();
  });

  // An empty kind matches every device, so there is nothing to look up.
  test("asks nothing for an unscoped policy", async () => {
    const siteSpy: jest.SpyInstance = jest.spyOn(NetworkSiteService, "findBy");
    const roleSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceRoleService,
      "findBy",
    );
    const labelSpy: jest.SpyInstance = jest.spyOn(LabelService, "findBy");

    await runOnBeforeCreate(makeCreateBy({ scope: {} }));

    expect(siteSpy).not.toHaveBeenCalled();
    expect(roleSpy).not.toHaveBeenCalled();
    expect(labelSpy).not.toHaveBeenCalled();
  });

  test("validates the scope an update writes, too", async () => {
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ scope: { siteIds: [SITE_ID] } })),
    ).rejects.toThrow(
      `Network Site ${SITE_ID} does not belong to this project.`,
    );
  });

  /*
   * An update that does not touch the scope must not re-validate the stored
   * one. Ids go stale — a site is deleted, a label is renamed away — and a
   * policy that could no longer be RENAMED because one of its sites is gone
   * would be a trap. Stale ids match nothing; that is the whole contract.
   */
  test("does not re-validate a stored scope an update does not touch", async () => {
    const siteSpy: jest.SpyInstance = jest.spyOn(NetworkSiteService, "findBy");

    await runOnBeforeUpdate(makeUpdateBy({ isEnabled: false }));

    expect(siteSpy).not.toHaveBeenCalled();
  });
});

/*
 * PREREQUISITE 4. A policy row is cheap; the monitors it provisions are
 * billed. So the write takes the MONITOR table's create permission and a read
 * of the template through the CALLER's own scopes — the same pair
 * NetworkDeviceAutoImportRuleService requires before a rule may name a
 * template.
 */
describe("NetworkAlertPolicyService monitor-provisioning permission", () => {
  beforeEach(() => {
    mockNoTemplateConflicts();
    mockTemplateOwnedBy(PROJECT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function allowMonitorCreate(): {
    allow: jest.SpyInstance;
    block: jest.SpyInstance;
  } {
    const allow: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation((): void => {
        return undefined;
      });
    const block: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelBlockPermissions")
      .mockImplementation((): void => {
        return undefined;
      });

    return { allow, block };
  }

  /*
   * makeCreateBy defaults to a ROOT caller, which is exempt from both checks
   * (a worker or a seeder has no user to check). Every case in this block is
   * about a real API caller, so each one says so.
   */
  const API_CALLER: CreateBy<NetworkAlertPolicy>["props"] = {
    isRoot: false,
    tenantId: PROJECT_ID,
  };

  function templateVisibleToCaller(): jest.SpyInstance {
    const template: MonitorTemplate = new MonitorTemplate();
    template._id = TEMPLATE_ID.toString();

    return jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
  }

  test("a create checks both the allow and the block half of Monitor create", async () => {
    const permissions: { allow: jest.SpyInstance; block: jest.SpyInstance } =
      allowMonitorCreate();
    templateVisibleToCaller();

    await runOnBeforeCreate(makeCreateBy({}, API_CALLER));

    expect(permissions.allow).toHaveBeenCalledWith(
      Monitor,
      expect.anything(),
      DatabaseRequestType.Create,
    );
    expect(permissions.block).toHaveBeenCalledWith(
      Monitor,
      expect.anything(),
      DatabaseRequestType.Create,
    );
  });

  /*
   * The template read carries the caller's props, not root. A user who may
   * edit policies but cannot SEE a template must not be able to attach it and
   * have the engine clone it as root for the whole fleet.
   */
  test("a create reads the template with the caller's own props", async () => {
    allowMonitorCreate();
    const readSpy: jest.SpyInstance = templateVisibleToCaller();

    await runOnBeforeCreate(makeCreateBy({}, API_CALLER));

    expect(readSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEMPLATE_ID,
        props: expect.objectContaining({ tenantId: PROJECT_ID }),
      }),
    );
  });

  /*
   * ...and the refusal is the SAME "not found" the project check gives, so a
   * caller cannot use the difference to enumerate template ids they are not
   * allowed to see.
   */
  test("a template the caller cannot see is refused as not found", async () => {
    allowMonitorCreate();
    jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(null);

    await expect(
      runOnBeforeCreate(makeCreateBy({}, API_CALLER)),
    ).rejects.toThrow("Monitor Template not found.");
  });

  /*
   * A root caller has no user and no label scopes to check — a worker, a
   * seeder, the recommended-policy bootstrap. Exempting it is what keeps
   * those paths working; it is not a hole, because reaching root at all
   * already means the request never came from a browser.
   */
  test("a root caller is exempt from both checks", async () => {
    const permissions: { allow: jest.SpyInstance; block: jest.SpyInstance } =
      allowMonitorCreate();
    const readSpy: jest.SpyInstance = jest.spyOn(
      MonitorTemplateService,
      "findOneById",
    );

    await expect(runOnBeforeCreate(makeCreateBy())).resolves.toBeDefined();

    expect(permissions.allow).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("a caller without Monitor create permission cannot save a policy", async () => {
    templateVisibleToCaller();
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation((): void => {
        throw new NotAuthorizedException("no monitor create");
      });

    await expect(
      runOnBeforeCreate(makeCreateBy({}, API_CALLER)),
    ).rejects.toThrow("no monitor create");
  });

  /*
   * ENABLING is the same decision as saving, one day later: the moment the
   * switch goes on the engine starts creating billable monitors. A payload
   * that touches nothing but `isEnabled: true` therefore takes the same two
   * checks.
   */
  test("enabling a policy takes the Monitor create permission", async () => {
    templateVisibleToCaller();
    mockScopeAndPermissionChecksPass();
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation((): void => {
        throw new NotAuthorizedException("no monitor create");
      });

    jest.spyOn(NetworkAlertPolicyService, "findBy").mockResolvedValue([
      Object.assign(policyRow(POLICY_ID, PROJECT_ID), {
        monitorTemplateId: TEMPLATE_ID,
      }),
    ]);

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ isEnabled: true })),
    ).rejects.toThrow("no monitor create");
  });

  /*
   * DISABLING does not. Taking a policy out of service must stay available to
   * whoever can edit it, including after their Monitor permissions were
   * narrowed — otherwise the only way to stop a runaway policy would be to
   * delete it.
   */
  test("disabling a policy does not take the Monitor create permission", async () => {
    mockScopeAndPermissionChecksPass();
    const allow: jest.SpyInstance = jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation((): void => {
        throw new NotAuthorizedException("no monitor create");
      });

    await expect(
      runOnBeforeUpdate(makeUpdateBy({ isEnabled: false })),
    ).resolves.toBeDefined();

    expect(allow).not.toHaveBeenCalled();
  });
});
