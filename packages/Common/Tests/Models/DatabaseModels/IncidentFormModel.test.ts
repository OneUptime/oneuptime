import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import ColumnType from "../../../Types/Database/ColumnType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
  INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
  IncidentFormFieldSetting,
  PublicIncidentForm,
  getPublicIncidentForm,
} from "../../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { JSONObject } from "../../../Types/JSON";
import {
  ModelSchema,
  ModelSchemaType,
} from "../../../Utils/Schema/ModelSchema";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Incident forms and their submissions, at the schema and permission level.
 *
 * A form lets people with no OneUptime account page on-call, so who may
 * build one is the incident settings tier (owners, admins, incident admins),
 * not the tier that edits templates; everyone who reads incidents may read
 * forms and their links. The link key is minted by the service and only
 * form editors may replace it. Submissions are written by the submit route
 * alone: the API can read them and incident admins can delete them, nothing
 * else. The service tests pass just as happily against a model the wrong
 * role can write, so those rules are pinned here - along with every column
 * the migration creates.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;
const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f001",
);

const FORM_WRITERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.IncidentAdmin,
];

const INCIDENT_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
];

const FORM_CREATORS: Array<Permission> = [
  ...FORM_WRITERS,
  Permission.CreateIncidentForm,
];
const FORM_READERS: Array<Permission> = [
  ...INCIDENT_READERS,
  Permission.ReadIncidentForm,
];
const FORM_EDITORS: Array<Permission> = [
  ...FORM_WRITERS,
  Permission.EditIncidentForm,
];
const FORM_DELETERS: Array<Permission> = [
  ...FORM_WRITERS,
  Permission.DeleteIncidentForm,
];

const SUBMISSION_READERS: Array<Permission> = [
  ...INCIDENT_READERS,
  Permission.ReadIncidentFormSubmission,
];
const SUBMISSION_DELETERS: Array<Permission> = [
  ...FORM_WRITERS,
  Permission.DeleteIncidentFormSubmission,
];

const GRANULAR_PERMISSIONS: Array<[Permission, string]> = [
  [Permission.CreateIncidentForm, "Create Incident Form"],
  [Permission.DeleteIncidentForm, "Delete Incident Form"],
  [Permission.EditIncidentForm, "Edit Incident Form"],
  [Permission.ReadIncidentForm, "Read Incident Form"],
  [Permission.DeleteIncidentFormSubmission, "Delete Incident Form Submission"],
  [Permission.ReadIncidentFormSubmission, "Read Incident Form Submission"],
];

const BASE_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

const FORM_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "name",
  "description",
  "isEnabled",
  "shareKey",
  "incidentSeverity",
  "incidentSeverityId",
  "allowReporterToChooseSeverity",
  "incidentTemplate",
  "incidentTemplateId",
  "descriptionSetting",
  "customFieldSettings",
  "isReporterDetailsRequired",
  "successMessage",
  "ipWhitelist",
  "createdByUser",
  "createdByUserId",
  "deletedByUser",
  "deletedByUserId",
];

// The columns a form editor changes after the form is created.
const FORM_SETTINGS_COLUMNS: Array<string> = [
  "name",
  "description",
  "isEnabled",
  "incidentSeverity",
  "incidentSeverityId",
  "allowReporterToChooseSeverity",
  "incidentTemplate",
  "incidentTemplateId",
  "descriptionSetting",
  "customFieldSettings",
  "isReporterDetailsRequired",
  "successMessage",
  "ipWhitelist",
];

const SUBMISSION_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "incidentForm",
  "incidentFormId",
  "incident",
  "incidentId",
  "reporterName",
  "reporterEmail",
];

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

function formPayload(): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form.projectId = PROJECT_ID;
  form.name = "Report a Security Concern";
  form.description = "Anything that looks wrong.";
  form.incidentSeverityId = ObjectID.generate();
  form.incidentTemplateId = ObjectID.generate();
  form.allowReporterToChooseSeverity = true;
  form.descriptionSetting = IncidentFormFieldSetting.Required;
  form.customFieldSettings = { impact: "Required" };
  form.isReporterDetailsRequired = false;
  form.successMessage = "Thanks!";
  form.isEnabled = true;
  return form;
}

function submissionPayload(): IncidentFormSubmission {
  const submission: IncidentFormSubmission = new IncidentFormSubmission();
  submission.projectId = PROJECT_ID;
  submission.incidentFormId = ObjectID.generate();
  submission.incidentId = ObjectID.generate();
  submission.reporterName = "Jane Doe";
  return submission;
}

function access(model: BaseModel, column: string): ColumnAccessControl {
  const control: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect({ column, hasAccessControl: control !== null }).toEqual({
    column,
    hasAccessControl: true,
  });

  return control as ColumnAccessControl;
}

function columnArgs(
  target: ModelType,
  propertyName: string,
): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === target && candidate.propertyName === propertyName
        );
      },
    );

  expect(args).toBeDefined();

  return args as ColumnMetadataArgs;
}

function relationArgs(
  target: ModelType,
  propertyName: string,
): RelationMetadataArgs {
  const args: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find(
      (candidate: RelationMetadataArgs): boolean => {
        return (
          candidate.target === target && candidate.propertyName === propertyName
        );
      },
    );

  expect(args).toBeDefined();

  return args as RelationMetadataArgs;
}

function indexedColumns(target: ModelType): Array<string> {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === target;
    })
    .map((index: IndexMetadataArgs): string => {
      return (index.columns as Array<string>).join(",");
    })
    .sort();
}

function claimants(predicate: (model: BaseModel) => boolean): Array<string> {
  return MODEL_TYPES.filter((modelType: ModelType): boolean => {
    return predicate(new modelType());
  }).map((modelType: ModelType): string => {
    return modelType.name;
  });
}

describe("IncidentForm and IncidentFormSubmission registration", () => {
  test.each([
    [IncidentForm, "IncidentForm", "/incident-form"],
    [
      IncidentFormSubmission,
      "IncidentFormSubmission",
      "/incident-form-submission",
    ],
  ] as Array<[ModelType, string, string]>)(
    "%p is registered and owns its table and CRUD route",
    (modelType: ModelType, tableName: string, route: string) => {
      const model: BaseModel = new modelType();

      expect(MODEL_TYPES).toContain(modelType);
      expect(model.tableName).toBe(tableName);
      expect(model.getCrudApiPath()?.toString()).toBe(route);

      // A duplicate route silently shadows another model's API.
      expect(
        claimants((candidate: BaseModel): boolean => {
          return candidate.getCrudApiPath()?.toString() === route;
        }),
      ).toEqual([modelType.name]);
      expect(
        claimants((candidate: BaseModel): boolean => {
          return candidate.tableName === tableName;
        }),
      ).toEqual([modelType.name]);
    },
  );

  test("both are named, documented and scoped to a project", () => {
    const form: IncidentForm = new IncidentForm();
    const submission: IncidentFormSubmission = new IncidentFormSubmission();

    expect(form.singularName).toBe("Incident Form");
    expect(form.pluralName).toBe("Incident Forms");
    expect(form.icon).toBe(IconProp.ClipboardDocumentList);
    expect(submission.singularName).toBe("Incident Form Submission");
    expect(submission.pluralName).toBe("Incident Form Submissions");

    for (const model of [form, submission] as Array<BaseModel>) {
      expect(model.enableDocumentation).toBe(true);
      expect(model.tableDescription?.length).toBeGreaterThan(0);
      expect(model.getTenantColumn()).toBe("projectId");
    }
  });

  test("a form is offered to workflows; a submission is not (its incident's triggers fire instead)", () => {
    expect(new IncidentForm().enableWorkflowOn).toEqual({
      create: true,
      delete: true,
      update: true,
      read: true,
    });

    const submissionWorkflow: Record<string, unknown> =
      (new IncidentFormSubmission().enableWorkflowOn as unknown as
        | Record<string, unknown>
        | undefined) || {};

    expect(
      ["create", "read", "update", "delete"].filter((flag: string): boolean => {
        return Boolean(submissionWorkflow[flag]);
      }),
    ).toEqual([]);
  });

  test.each([[IncidentForm], [IncidentFormSubmission]] as Array<[ModelType]>)(
    "%p is on the Growth plan, like incident templates",
    (modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getReadBillingPlan()).toBe(PlanType.Growth);
      expect(model.getUpdateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getDeleteBillingPlan()).toBe(PlanType.Growth);
      expect(new IncidentTemplate().getCreateBillingPlan()).toBe(
        PlanType.Growth,
      );
    },
  );
});

describe("the six incident form permissions", () => {
  test.each(GRANULAR_PERMISSIONS)(
    "%s is a tenant-assignable Incident permission titled %j",
    (permission: Permission, title: string) => {
      const props: PermissionProps | undefined = PERMISSION_PROPS.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );

      expect(props).toBeDefined();
      expect(props!.title).toBe(title);
      expect(props!.group).toBe(PermissionGroup.Incident);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.isRolePermission).toBe(false);
      expect(props!.description.length).toBeGreaterThan(0);
      expect(PermissionHelper.getTitle(permission)).toBe(title);
    },
  );

  test("each is spelled as its enum member", () => {
    for (const [permission] of GRANULAR_PERMISSIONS) {
      expect(Permission[permission as keyof typeof Permission]).toBe(
        permission,
      );
    }
  });

  test.each([[IncidentForm], [IncidentFormSubmission]] as Array<[ModelType]>)(
    "every permission %p names is in the permission catalogue, and none is ProjectUser",
    (modelType: ModelType) => {
      const model: BaseModel = new modelType();

      const named: Set<Permission> = new Set([
        ...model.getCreatePermissions(),
        ...model.getReadPermissions(),
        ...model.getUpdatePermissions(),
        ...model.getDeletePermissions(),
      ]);

      for (const control of Object.values(
        model.getColumnAccessControlForAllColumns(),
      )) {
        for (const permission of [
          ...control.create,
          ...control.read,
          ...control.update,
        ]) {
          named.add(permission);
        }
      }

      expect(named.has(Permission.ProjectUser)).toBe(false);

      for (const permission of named) {
        expect({
          permission,
          catalogued: PERMISSION_PROPS.some(
            (candidate: PermissionProps): boolean => {
              return candidate.permission === permission;
            },
          ),
        }).toEqual({ permission, catalogued: true });
      }
    },
  );
});

describe("IncidentForm: who may build, read and change a form", () => {
  const model: IncidentForm = new IncidentForm();

  test("create, update and delete: owners, admins and incident admins, plus the granular permission", () => {
    expect(model.getCreatePermissions()).toEqual(FORM_CREATORS);
    expect(model.getUpdatePermissions()).toEqual(FORM_EDITORS);
    expect(model.getDeletePermissions()).toEqual(FORM_DELETERS);
  });

  test("read: everyone who reads incidents", () => {
    expect(model.getReadPermissions()).toEqual(FORM_READERS);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.CreateIncidentForm,
  ])("%s may create a form", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentForm,
        formPayload(),
        propsWith(permission),
      );
    }).not.toThrow();
  });

  /*
   * Incident members may edit incident templates, but a form lets people
   * outside the team page on-call, so building one is not theirs to do.
   */
  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.Viewer,
    Permission.IncidentViewer,
    Permission.ReadIncidentForm,
    Permission.EditIncidentForm,
    Permission.DeleteIncidentForm,
    Permission.CreateIncidentTemplate,
  ])("%s may not create a form", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentForm,
        formPayload(),
        propsWith(permission),
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.EditIncidentForm,
  ])("%s may change every setting of a form", (permission: Permission) => {
    const settings: IncidentForm = formPayload();
    delete settings.projectId;

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentForm,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
      ColumnPermissions.checkDataColumnPermissions(
        IncidentForm,
        settings,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.Viewer,
    Permission.IncidentViewer,
    Permission.ReadIncidentForm,
    Permission.CreateIncidentForm,
    Permission.EditIncidentTemplate,
  ])("%s may not change a form", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentForm,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each([
    Permission.IncidentViewer,
    Permission.Viewer,
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.ReadIncidentForm,
  ])("%s may read forms", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentForm,
        propsWith(permission),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  test("nobody can set who deleted a form", () => {
    const form: IncidentForm = formPayload();
    form.deletedByUserId = ObjectID.generate();

    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentForm,
        form,
        propsWith(Permission.ProjectOwner),
      );
    }).toThrow("deletedByUserId");
  });
});

describe("IncidentForm.shareKey: the key in the form's link", () => {
  const model: IncidentForm = new IncidentForm();

  test("is a computed ObjectID the API reference documents", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("shareKey");

    expect(metadata.type).toBe(TableColumnType.ObjectID);
    expect(metadata.computed).toBe(true);
    expect(metadata.hideColumnInDocumentation).toBeFalsy();
    expect(metadata.description).toContain(
      "/accounts/incident-form/<shareKey>",
    );
  });

  test("nobody chooses it on create; readers of the form read it; form editors may replace it", () => {
    const control: ColumnAccessControl = access(model, "shareKey");

    expect(control.create).toEqual([]);
    expect(control.read).toEqual(model.getReadPermissions());
    expect(control.update).toEqual(model.getUpdatePermissions());
  });

  /*
   * A computed column is not refused on create - the value is simply
   * replaced by IncidentFormService.onBeforeCreate (its test pins that).
   */
  test("a key in a create request passes the permission check, to be replaced by the service", () => {
    const form: IncidentForm = formPayload();
    form.shareKey = ObjectID.generate();

    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentForm,
        form,
        propsWith(Permission.IncidentAdmin),
      );
    }).not.toThrow();
  });

  test.each([
    Permission.IncidentAdmin,
    Permission.EditIncidentForm,
    Permission.ProjectAdmin,
  ])(
    "%s may reset it, as the dashboard's Reset Link does",
    (permission: Permission) => {
      const reset: IncidentForm = new IncidentForm();
      reset.shareKey = ObjectID.generate();

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          IncidentForm,
          reset,
          propsWith(permission),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test.each([
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadIncidentForm,
    Permission.CreateIncidentForm,
  ])("%s may not reset it", (permission: Permission) => {
    const reset: IncidentForm = new IncidentForm();
    reset.shareKey = ObjectID.generate();

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentForm,
        reset,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).toThrow("shareKey");
  });

  test("is unique across every project and never null: a visit finds its form by this key alone", () => {
    const args: ColumnMetadataArgs = columnArgs(IncidentForm, "shareKey");

    expect(args.options.type).toBe(ColumnType.ObjectID);
    expect(args.options.unique).toBe(true);
    expect(args.options.nullable).toBe(false);
    expect(args.options.transformer).toBeDefined();
  });
});

describe("IncidentForm columns", () => {
  const model: IncidentForm = new IncidentForm();

  test("has exactly the columns the migration creates", () => {
    expect([...model.getTableColumns().columns].sort()).toEqual(
      [...BASE_COLUMNS, ...FORM_COLUMNS].sort(),
    );
  });

  test.each(FORM_SETTINGS_COLUMNS)(
    "%s is created by form creators, read by form readers and changed by form editors",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: FORM_CREATORS,
        read: FORM_READERS,
        update: FORM_EDITORS,
      });
    },
  );

  test.each(["project", "projectId", "createdByUser", "createdByUserId"])(
    "%s is set on create and never changed",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: FORM_CREATORS,
        read: FORM_READERS,
        update: [],
      });
    },
  );

  test.each(["deletedByUser", "deletedByUserId"])(
    "%s cannot be written or read through the API",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    },
  );

  test("a name is required, unique within the project, and readable on a submission's relation", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata("name");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(true);
    expect(metadata.canReadOnRelationQuery).toBe(true);
    expect(getUniqueColumnBy(model, "name")).toBe("projectId");
  });

  /*
   * Required when a form is created (the dashboard's create form and the
   * API both ask for it), but nullable in the database, so deleting the
   * severity neither fails because of a form nor deletes the form.
   */
  test("incidentSeverityId is required by the app but nullable in the database, and cleared when its severity is deleted", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("incidentSeverityId");

    expect(metadata.type).toBe(TableColumnType.ObjectID);
    expect(metadata.required).toBe(true);
    expect(model.getRequiredColumns().columns).toContain("incidentSeverityId");
    expect(
      columnArgs(IncidentForm, "incidentSeverityId").options.nullable,
    ).toBe(true);
    expect(
      relationArgs(IncidentForm, "incidentSeverity").options,
    ).toMatchObject({ nullable: true, onDelete: "SET NULL" });
  });

  test("the template is optional, and cleared when the template is deleted", () => {
    expect(model.getTableColumnMetadata("incidentTemplateId").required).toBe(
      false,
    );
    expect(
      columnArgs(IncidentForm, "incidentTemplateId").options.nullable,
    ).toBe(true);
    expect(
      relationArgs(IncidentForm, "incidentTemplate").options,
    ).toMatchObject({ nullable: true, onDelete: "SET NULL" });
  });

  test("the project, severity and template ids are indexed", () => {
    expect(indexedColumns(IncidentForm)).toEqual(
      ["incidentSeverityId", "incidentTemplateId", "projectId"].sort(),
    );
  });

  test.each([
    ["isEnabled", true],
    ["allowReporterToChooseSeverity", false],
    ["isReporterDetailsRequired", true],
  ])(
    "%s is a required boolean that starts as %j",
    (column: string, defaultValue: boolean) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.required).toBe(true);
      expect(metadata.defaultValue).toBe(defaultValue);
      expect(model.isDefaultValueColumn(column)).toBe(true);
      expect(columnArgs(IncidentForm, column).options).toMatchObject({
        type: ColumnType.Boolean,
        nullable: false,
        default: defaultValue,
      });
    },
  );

  test("the description question starts as Optional, the contract's default", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("descriptionSetting");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.defaultValue).toBe(
      DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
    );
    expect(metadata.defaultValue).toBe(IncidentFormFieldSetting.Optional);
    expect(model.isDefaultValueColumn("descriptionSetting")).toBe(true);
    expect(
      columnArgs(IncidentForm, "descriptionSetting").options,
    ).toMatchObject({
      nullable: false,
      default: DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
    });
  });

  test("the questions are a nullable JSON object keyed by template variable key", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(
      "customFieldSettings",
    );

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBeFalsy();
    expect(
      columnArgs(IncidentForm, "customFieldSettings").options.nullable,
    ).toBe(true);
    expect(metadata.description).toContain("variableKey");
    expect(metadata.description).toContain("Required");
    expect(metadata.description).toContain("Optional");
    expect(metadata.description).toContain("not listed");
  });

  test.each(["description", "successMessage"])(
    "%s is optional Markdown",
    (column: string) => {
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.Markdown,
      );
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    },
  );

  test("the IP allowlist is optional and priced like a dashboard's", () => {
    expect(model.getTableColumnMetadata("ipWhitelist").type).toBe(
      TableColumnType.VeryLongText,
    );
    expect(model.getTableColumnMetadata("ipWhitelist").required).toBeFalsy();

    const billing: ColumnBillingAccessControl =
      model.getColumnBillingAccessControl("ipWhitelist");

    expect(billing).toEqual(
      new Dashboard().getColumnBillingAccessControl("ipWhitelist"),
    );
    expect(billing).toMatchObject({
      read: PlanType.Free,
      create: PlanType.Free,
      update: PlanType.Scale,
    });
  });

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
      relation: "incidentSeverity",
      idColumn: "incidentSeverityId",
      modelType: IncidentSeverity,
      onDelete: "SET NULL",
    },
    {
      relation: "incidentTemplate",
      idColumn: "incidentTemplateId",
      modelType: IncidentTemplate,
      onDelete: "SET NULL",
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
        model.getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(modelType);
      expect(metadata.manyToOneRelationColumn).toBe(idColumn);
      expect(relationArgs(IncidentForm, relation).relationType).toBe(
        "many-to-one",
      );
      expect(relationArgs(IncidentForm, relation).options.onDelete).toBe(
        onDelete,
      );
    },
  );
});

/*
 * What the published API (and so the MCP tools and the Terraform provider)
 * says about a form: see IncidentCustomFieldApiSchemaContract.test.ts for how
 * the provider reads these schemas.
 */
describe("IncidentForm in the published API", () => {
  type SchemaGetter = (data: {
    modelType: new () => BaseModel;
  }) => ModelSchemaType;

  function generated(getSchema: SchemaGetter): JSONObject {
    const registry: OpenAPIRegistry = new OpenAPIRegistry();

    registry.register("Schema", getSchema({ modelType: IncidentForm }));

    const document: JSONObject = new OpenApiGeneratorV3(
      registry.definitions,
    ).generateComponents() as unknown as JSONObject;

    return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
      "Schema"
    ] as JSONObject;
  }

  const create: JSONObject = generated(
    (data: { modelType: new () => BaseModel }): ModelSchemaType => {
      return ModelSchema.getCreateModelSchema(data);
    },
  );
  const update: JSONObject = generated(
    (data: { modelType: new () => BaseModel }): ModelSchemaType => {
      return ModelSchema.getUpdateModelSchema(data);
    },
  );
  const read: JSONObject = generated(
    (data: { modelType: new () => BaseModel }): ModelSchemaType => {
      return ModelSchema.getReadModelSchema(data);
    },
  );

  function propertiesOf(schema: JSONObject): JSONObject {
    return (schema["properties"] || {}) as JSONObject;
  }

  function requiredOf(schema: JSONObject): Array<string> {
    return (schema["required"] as Array<string> | undefined) || [];
  }

  test("a form cannot be created without a name and a severity", () => {
    expect(requiredOf(create)).toEqual(
      expect.arrayContaining(["name", "incidentSeverityId"]),
    );
  });

  test("the switches and the description question are optional to send, with their defaults published", () => {
    for (const column of [
      "isEnabled",
      "allowReporterToChooseSeverity",
      "isReporterDetailsRequired",
      "descriptionSetting",
    ]) {
      expect(requiredOf(create)).not.toContain(column);
    }

    expect(
      (propertiesOf(create)["descriptionSetting"] as JSONObject)["default"],
    ).toBe(DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING);
    expect((propertiesOf(create)["isEnabled"] as JSONObject)["default"]).toBe(
      true,
    );
  });

  test("the link key is read-only: returned on read, never in a create or update body", () => {
    expect(propertiesOf(create)["shareKey"]).toBeUndefined();
    expect(propertiesOf(update)["shareKey"]).toBeUndefined();

    const property: JSONObject = propertiesOf(read)["shareKey"] as JSONObject;

    expect(property).toBeDefined();
    expect(property["readOnly"]).toBe(true);
  });

  test.each(
    FORM_SETTINGS_COLUMNS.filter((column: string): boolean => {
      return !["incidentSeverity", "incidentTemplate"].includes(column);
    }),
  )("%s is writable on create and update", (column: string) => {
    expect(propertiesOf(create)[column]).toBeDefined();
    expect(propertiesOf(update)[column]).toBeDefined();
  });
});

describe("IncidentFormSubmission: written by the submit route alone", () => {
  const model: IncidentFormSubmission = new IncidentFormSubmission();

  test("the API cannot create or edit a submission; incident readers read them; incident admins delete them", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getReadPermissions()).toEqual(SUBMISSION_READERS);
    expect(model.getDeletePermissions()).toEqual(SUBMISSION_DELETERS);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.CreateIncidentForm,
  ])("not even %s may create one through the API", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentFormSubmission,
        submissionPayload(),
        propsWith(permission),
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.IncidentAdmin,
    Permission.EditIncidentForm,
  ])("not even %s may edit one", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentFormSubmission,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each(SUBMISSION_DELETERS)(
    "%s may delete one, and the reporter's name and email with it",
    (permission: Permission) => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          IncidentFormSubmission,
          propsWith(permission),
          DatabaseRequestType.Delete,
        );
      }).not.toThrow();
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadIncidentFormSubmission,
    Permission.DeleteIncidentForm,
  ])("%s may not delete one", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentFormSubmission,
        propsWith(permission),
        DatabaseRequestType.Delete,
      );
    }).toThrow(NotAuthorizedException);
  });

  /*
   * A submission belongs to its incident, like the incident's notes: a role
   * limited to some labels, or to the incidents its holder owns, must not
   * list the reporters of every other incident.
   */
  test("reads follow the incident's labels", () => {
    expect(model.canAccessIfCanReadOn).toBe("incident");
  });

  test("owners see the submissions of the incidents they own", () => {
    expect(model.ownedThrough).toEqual({
      fkColumn: "incidentId",
      parentModels: [Incident],
      includeProjectScope: false,
    });
  });

  test("reading a form does not mean reading its submissions", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentFormSubmission,
        propsWith(Permission.ReadIncidentForm),
        DatabaseRequestType.Read,
      );
    }).toThrow(NotAuthorizedException);

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        IncidentFormSubmission,
        propsWith(Permission.ReadIncidentFormSubmission),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });
});

describe("IncidentFormSubmission columns", () => {
  const model: IncidentFormSubmission = new IncidentFormSubmission();

  test("has exactly the columns the migration creates - no created-by or deleted-by user", () => {
    expect([...model.getTableColumns().columns].sort()).toEqual(
      [...BASE_COLUMNS, ...SUBMISSION_COLUMNS].sort(),
    );
  });

  test.each(SUBMISSION_COLUMNS)(
    "%s is read by submission readers and written by nobody",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: [],
        read: SUBMISSION_READERS,
        update: [],
      });
    },
  );

  test.each([
    ["projectId", true],
    ["incidentFormId", true],
    ["incidentId", false],
  ])(
    "%s is an id relation queries may read (required: %j)",
    (column: string, required: boolean) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.ObjectID);
      expect(Boolean(metadata.required)).toBe(required);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(columnArgs(IncidentFormSubmission, column).options.nullable).toBe(
        !required,
      );
    },
  );

  test("the project, form and incident ids are indexed", () => {
    expect(indexedColumns(IncidentFormSubmission)).toEqual(
      ["incidentFormId", "incidentId", "projectId"].sort(),
    );
  });

  test.each([
    ["project", "projectId", Project, "CASCADE"],
    ["incidentForm", "incidentFormId", IncidentForm, "CASCADE"],
    ["incident", "incidentId", Incident, "SET NULL"],
  ] as Array<[string, string, ModelType, string]>)(
    "%s points at its model through %s, and is %s on delete",
    (
      relation: string,
      idColumn: string,
      modelType: ModelType,
      onDelete: string,
    ) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(modelType);
      expect(metadata.manyToOneRelationColumn).toBe(idColumn);
      expect(
        relationArgs(IncidentFormSubmission, relation).options.onDelete,
      ).toBe(onDelete);
    },
  );

  test("the reporter's name and email are optional and as long as the public contract allows", () => {
    expect(model.getTableColumnMetadata("reporterName").type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata("reporterEmail").type).toBe(
      TableColumnType.Email,
    );

    const name: ColumnMetadataArgs = columnArgs(
      IncidentFormSubmission,
      "reporterName",
    );
    const email: ColumnMetadataArgs = columnArgs(
      IncidentFormSubmission,
      "reporterEmail",
    );

    expect(name.options.nullable).toBe(true);
    expect(email.options.nullable).toBe(true);
    expect(Number(name.options.length)).toBe(
      INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
    );
    expect(Number(email.options.length)).toBe(
      INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
    );
    expect(email.options.transformer).toBeDefined();
  });
});

describe("an IncidentForm row and the public contract", () => {
  test("a stored form passed as it is gives the public page its subset and nothing else", () => {
    const form: IncidentForm = formPayload();
    form._id = "0c0c0c0c-0000-4000-8000-00000000f002";
    form.shareKey = new ObjectID("0d0d0d0d-0000-4000-8000-00000000f003");
    form.ipWhitelist = "10.0.0.0/8";
    form.createdByUserId = ObjectID.generate();

    const severityId: string = form.incidentSeverityId!.toString();

    const publicForm: PublicIncidentForm = getPublicIncidentForm({
      form: form,
      askedDefinitions: [
        {
          name: "Impact",
          customFieldType: CustomFieldType.Text,
          isRequiredOnCreate: true,
        },
      ],
      severities: [{ _id: severityId, name: "High" }],
      isCaptchaRequired: false,
    });

    expect(publicForm).toEqual({
      name: "Report a Security Concern",
      description: "Anything that looks wrong.",
      descriptionSetting: IncidentFormFieldSetting.Required,
      isReporterDetailsRequired: false,
      severities: [{ _id: severityId, name: "High" }],
      defaultIncidentSeverityId: severityId,
      customFields: [
        {
          name: "Impact",
          customFieldType: CustomFieldType.Text,
          isRequired: true,
        },
      ],
      isCaptchaRequired: false,
    });

    const serialized: string = JSON.stringify(publicForm);

    for (const secret of [
      "0d0d0d0d-0000-4000-8000-00000000f003",
      form.incidentTemplateId!.toString(),
      PROJECT_ID.toString(),
      "10.0.0.0/8",
      "Thanks!",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
