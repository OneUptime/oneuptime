import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import User from "../../../Models/DatabaseModels/User";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnBy } from "../../../Types/Database/UniqueColumnBy";
import UserAttribution from "../../../Types/Database/UserAttribution";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  FormFieldSource,
  getDefaultFormFields,
  readFormFields,
  validateFormFields,
} from "../../../Types/Form/FormField";
import { validateFormTargetSettings } from "../../../Types/Form/FormTargetSettings";
import FormTargetType, {
  DEFAULT_FORM_TARGET_TYPE,
} from "../../../Types/Form/FormTargetType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
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
 * Forms and their submissions, at the schema and permission level.
 *
 * A form lets people with no OneUptime account create incidents - and page
 * on-call - or schedule maintenance in a project. So building, changing and
 * deleting one is for project owners and admins, and for whoever is given
 * the Form permissions on purpose; everyone who reads incidents or
 * scheduled maintenance may read forms and their links. The link key is
 * minted by the service and only form editors may replace it.
 *
 * A submission holds what a stranger wrote and how to reach them, so it is
 * read only by owners, admins and Read Form Submission, and written by the
 * submit route alone. The service tests pass just as happily against a
 * model the wrong role can write, so those rules are pinned here - along
 * with every column the migration creates.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = Models as Array<ModelType>;
const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f001",
);

const OWNERS_AND_ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const FORM_CREATORS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.CreateForm,
];
const FORM_EDITORS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.EditForm,
];
const FORM_DELETERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.DeleteForm,
];
const FORM_READERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
  Permission.ReadForm,
];

const SUBMISSION_READERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.ReadFormSubmission,
];
const SUBMISSION_DELETERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.DeleteFormSubmission,
];

const GRANULAR_PERMISSIONS: Array<[Permission, string]> = [
  [Permission.CreateForm, "Create Form"],
  [Permission.DeleteForm, "Delete Form"],
  [Permission.EditForm, "Edit Form"],
  [Permission.ReadForm, "Read Form"],
  [Permission.DeleteFormSubmission, "Delete Form Submission"],
  [Permission.ReadFormSubmission, "Read Form Submission"],
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
  "targetType",
  "fields",
  "targetSettings",
  "successMessage",
  "ipWhitelist",
  // Its branding (AddFormBranding1797700000000).
  "logoFile",
  "logoFileId",
  "logoAltText",
  "faviconFile",
  "faviconFileId",
  "createdByUser",
  "createdByUserId",
  "deletedByUser",
  "deletedByUserId",
];

// The columns a form editor changes once the form exists.
const FORM_SETTINGS_COLUMNS: Array<string> = [
  "name",
  "description",
  "isEnabled",
  "targetType",
  "fields",
  "targetSettings",
  "successMessage",
  "ipWhitelist",
  "logoFile",
  "logoFileId",
  "logoAltText",
  "faviconFile",
  "faviconFileId",
];

const SUBMISSION_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "form",
  "formId",
  "answers",
  "submitterName",
  "submitterEmail",
  "targetType",
  "incident",
  "incidentId",
  "scheduledMaintenance",
  "scheduledMaintenanceId",
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

function formPayload(): Form {
  const form: Form = new Form();
  form.projectId = PROJECT_ID;
  form.name = "Request a Change";
  form.description = "Anything you need changed.";
  form.isEnabled = true;
  form.targetType = FormTargetType.ScheduledMaintenance;
  form.fields = getDefaultFormFields(
    FormTargetType.ScheduledMaintenance,
  ) as unknown as JSONArray;
  form.targetSettings = { showOnStatusPages: false };
  form.successMessage = "Thanks!";
  return form;
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

describe("Form and FormSubmission registration", () => {
  test.each([
    [Form, "Form", "/form"],
    [FormSubmission, "FormSubmission", "/form-submission"],
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

  test("incident forms are gone: no model owns their tables or routes", () => {
    expect(
      claimants((candidate: BaseModel): boolean => {
        return (
          candidate.tableName === "IncidentForm" ||
          candidate.tableName === "IncidentFormSubmission" ||
          (candidate.getCrudApiPath()?.toString() || "").startsWith(
            "/incident-form",
          )
        );
      }),
    ).toEqual([]);
  });

  test("both are named, documented and scoped to a project", () => {
    const form: Form = new Form();
    const submission: FormSubmission = new FormSubmission();

    expect(form.singularName).toBe("Form");
    expect(form.pluralName).toBe("Forms");
    expect(form.icon).toBe(IconProp.ClipboardDocumentList);
    expect(submission.singularName).toBe("Form Submission");
    expect(submission.pluralName).toBe("Form Submissions");
    expect(submission.icon).toBe(IconProp.ClipboardDocumentCheck);

    for (const model of [form, submission] as Array<BaseModel>) {
      expect(model.enableDocumentation).toBe(true);
      expect(model.tableDescription?.length).toBeGreaterThan(0);
      expect(model.getTenantColumn()).toBe("projectId");
    }
  });

  test("a form is offered to workflows; a submission is not (what it created has its own triggers)", () => {
    expect(new Form().enableWorkflowOn).toEqual({
      create: true,
      delete: true,
      update: true,
      read: true,
    });

    const submissionWorkflow: Record<string, unknown> =
      (new FormSubmission().enableWorkflowOn as unknown as
        | Record<string, unknown>
        | undefined) || {};

    expect(
      ["create", "read", "update", "delete"].filter((flag: string): boolean => {
        return Boolean(submissionWorkflow[flag]);
      }),
    ).toEqual([]);
  });

  test.each([[Form], [FormSubmission]] as Array<[ModelType]>)(
    "%p is on the Growth plan",
    (modelType: ModelType) => {
      const model: BaseModel = new modelType();

      expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getReadBillingPlan()).toBe(PlanType.Growth);
      expect(model.getUpdateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getDeleteBillingPlan()).toBe(PlanType.Growth);
    },
  );
});

describe("the six form permissions", () => {
  test.each(GRANULAR_PERMISSIONS)(
    "%s is a tenant-assignable Form permission titled %j",
    (permission: Permission, title: string) => {
      const props: PermissionProps | undefined = PERMISSION_PROPS.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );

      expect(props).toBeDefined();
      expect(props!.title).toBe(title);
      expect(props!.group).toBe(PermissionGroup.Form);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.isAccessControlPermission).toBe(false);
      expect(props!.isRolePermission).toBe(false);
      expect(props!.description.length).toBeGreaterThan(0);
      expect(PermissionHelper.getTitle(permission)).toBe(title);
    },
  );

  test("each is spelled as its enum member, in a group of their own", () => {
    for (const [permission] of GRANULAR_PERMISSIONS) {
      expect(Permission[permission as keyof typeof Permission]).toBe(
        permission,
      );
    }

    expect(PermissionGroup.Form).toBe("Form");
    expect(
      PERMISSION_PROPS.filter((props: PermissionProps): boolean => {
        return props.group === PermissionGroup.Form;
      })
        .map((props: PermissionProps): Permission => {
          return props.permission;
        })
        .sort(),
    ).toEqual(
      GRANULAR_PERMISSIONS.map(([permission]: [Permission, string]) => {
        return permission;
      }).sort(),
    );
  });

  test("the incident form permissions are gone", () => {
    for (const name of [
      "CreateIncidentForm",
      "DeleteIncidentForm",
      "EditIncidentForm",
      "ReadIncidentForm",
      "DeleteIncidentFormSubmission",
      "ReadIncidentFormSubmission",
    ]) {
      expect((Permission as unknown as Record<string, unknown>)[name]).toBe(
        undefined,
      );
    }
  });

  test.each([[Form], [FormSubmission]] as Array<[ModelType]>)(
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

describe("Form: who may build, read and change a form", () => {
  const model: Form = new Form();

  test("create, update and delete: owners, admins and the granular permission", () => {
    expect(model.getCreatePermissions()).toEqual(FORM_CREATORS);
    expect(model.getUpdatePermissions()).toEqual(FORM_EDITORS);
    expect(model.getDeletePermissions()).toEqual(FORM_DELETERS);
  });

  test("read: everyone who reads incidents or scheduled maintenance", () => {
    expect(model.getReadPermissions()).toEqual(FORM_READERS);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateForm,
  ])("%s may create a form", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        Form,
        formPayload(),
        propsWith(permission),
      );
    }).not.toThrow();
  });

  /*
   * A form lets people outside the team create records in the project -
   * incidents that page on-call, maintenance that goes on status pages - so
   * neither tier's admins may build one by that role alone.
   */
  test.each([
    Permission.IncidentAdmin,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.Viewer,
    Permission.ReadForm,
    Permission.EditForm,
    Permission.DeleteForm,
    Permission.CreateIncidentTemplate,
  ])("%s may not create a form", (permission: Permission) => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        Form,
        formPayload(),
        propsWith(permission),
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditForm,
  ])("%s may change every setting of a form", (permission: Permission) => {
    const settings: Form = formPayload();
    delete settings.projectId;
    settings.ipWhitelist = "10.0.0.0/8";

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Form,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
      ColumnPermissions.checkDataColumnPermissions(
        Form,
        settings,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.IncidentAdmin,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadForm,
    Permission.CreateForm,
    Permission.EditIncidentTemplate,
  ])("%s may not change a form", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Form,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).toThrow(NotAuthorizedException);
  });

  test.each([
    Permission.Viewer,
    Permission.ProjectMember,
    Permission.IncidentViewer,
    Permission.IncidentMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ScheduledMaintenanceMember,
    Permission.ReadForm,
  ])("%s may read forms", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Form,
        propsWith(permission),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.ReadFormSubmission,
    Permission.CreateIncidentTemplate,
    Permission.ReadStatusPageOwnerTeam,
  ])("%s may not read forms", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Form,
        propsWith(permission),
        DatabaseRequestType.Read,
      );
    }).toThrow(NotAuthorizedException);
  });

  /*
   * Who created or deleted a form is OneUptime's to say (UserAttribution):
   * DatabaseService takes both out of every write it does not make itself,
   * and the column check skips them as computed, so a client that still
   * sends one is not refused for it - and the value is never stored.
   */
  test("nobody can set who deleted a form", () => {
    const model: Form = new Form();

    expect(model.getTableColumnMetadata("deletedByUserId").computed).toBe(true);
    expect(UserAttribution.getColumns(model)).toEqual(
      expect.arrayContaining(["deletedByUser", "deletedByUserId"]),
    );
  });
});

describe("Form.shareKey: the key in the form's link", () => {
  const model: Form = new Form();

  test("is a computed ObjectID the API reference documents, with the link it is part of", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("shareKey");

    expect(metadata.type).toBe(TableColumnType.ObjectID);
    expect(metadata.computed).toBe(true);
    expect(metadata.hideColumnInDocumentation).toBeFalsy();
    expect(metadata.description).toContain("/accounts/form/<shareKey>");
  });

  test("nobody chooses it on create; readers of the form read it; form editors may replace it", () => {
    const control: ColumnAccessControl = access(model, "shareKey");

    expect(control.create).toEqual([]);
    expect(control.read).toEqual(model.getReadPermissions());
    expect(control.update).toEqual(model.getUpdatePermissions());
  });

  test("a key in a create request passes the permission check, to be replaced by the service", () => {
    const form: Form = formPayload();
    form.shareKey = ObjectID.generate();

    expect(() => {
      ModelPermission.checkCreatePermissions(
        Form,
        form,
        propsWith(Permission.CreateForm),
      );
    }).not.toThrow();
  });

  test.each([Permission.EditForm, Permission.ProjectAdmin])(
    "%s may reset it, as the dashboard's Reset Link does",
    (permission: Permission) => {
      const reset: Form = new Form();
      reset.shareKey = ObjectID.generate();

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Form,
          reset,
          propsWith(permission),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test.each([
    Permission.IncidentAdmin,
    Permission.IncidentViewer,
    Permission.ReadForm,
    Permission.CreateForm,
  ])("%s may not reset it", (permission: Permission) => {
    const reset: Form = new Form();
    reset.shareKey = ObjectID.generate();

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Form,
        reset,
        propsWith(permission),
        DatabaseRequestType.Update,
      );
    }).toThrow("shareKey");
  });

  test("is unique across every project and never null: a visit finds its form by this key alone", () => {
    const args: ColumnMetadataArgs = columnArgs(Form, "shareKey");

    expect(args.options.type).toBe(ColumnType.ObjectID);
    expect(args.options.unique).toBe(true);
    expect(args.options.nullable).toBe(false);
    expect(args.options.transformer).toBeDefined();
  });
});

describe("Form columns", () => {
  const model: Form = new Form();

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

  test.each(["project", "projectId"])(
    "%s is set on create and never changed",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: FORM_CREATORS,
        read: FORM_READERS,
        update: [],
      });
    },
  );

  // OneUptime decides who created a form: readable, written by no request.
  test.each(["createdByUser", "createdByUserId"])(
    "%s is read by form readers and written by no request",
    (column: string) => {
      expect(access(model, column)).toEqual({
        create: [],
        read: FORM_READERS,
        update: [],
      });
      expect(model.getTableColumnMetadata(column).computed).toBe(true);
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

  test("what the form creates is required, and starts as an incident", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("targetType");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(true);
    expect(metadata.title).toBe("Creates");
    expect(metadata.defaultValue).toBe(DEFAULT_FORM_TARGET_TYPE);
    expect(model.isDefaultValueColumn("targetType")).toBe(true);
    expect(columnArgs(Form, "targetType").options).toMatchObject({
      type: ColumnType.ShortText,
      length: ColumnLength.ShortText,
      nullable: false,
      default: FormTargetType.Incident,
    });
  });

  test("accepting submissions is a required switch that starts on", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("isEnabled");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.title).toBe("Accepting Submissions");
    expect(metadata.defaultValue).toBe(true);
    expect(columnArgs(Form, "isEnabled").options).toMatchObject({
      type: ColumnType.Boolean,
      nullable: false,
      default: true,
    });
  });

  test("the questions are a nullable JSON list the server fills in for a new form", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("fields");

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBeFalsy();
    expect(metadata.title).toBe("Questions");
    expect(columnArgs(Form, "fields").options.nullable).toBe(true);

    for (const source of Object.values(FormFieldSource)) {
      expect(metadata.description).toContain(source);
    }
  });

  test("the example questions in the API reference are questions the server accepts", () => {
    const example: unknown = model.getTableColumnMetadata("fields").example;

    expect(Array.isArray(example)).toBe(true);
    expect(
      validateFormFields({
        value: example,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
    expect(readFormFields(example)).toHaveLength(
      (example as Array<unknown>).length,
    );
  });

  test("the On Submit settings are a nullable JSON object whose example the server accepts", () => {
    const metadata: TableColumnMetadata =
      model.getTableColumnMetadata("targetSettings");

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBeFalsy();
    expect(columnArgs(Form, "targetSettings").options.nullable).toBe(true);
    expect(
      validateFormTargetSettings({
        value: metadata.example,
        targetType: FormTargetType.Incident,
      }),
    ).toBeNull();
    expect(metadata.description).toContain("showOnStatusPages");
    expect(metadata.description).toContain("incidentTemplateId");
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

  test("only the project id is indexed (the share key's unique constraint is its index)", () => {
    expect(indexedColumns(Form)).toEqual(["projectId"]);
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
      expect(relationArgs(Form, relation).relationType).toBe("many-to-one");
      expect(relationArgs(Form, relation).options.onDelete).toBe(onDelete);
    },
  );
});

/*
 * What the published API (and so the MCP tools and the Terraform provider)
 * says about a form.
 */
describe("Form in the published API", () => {
  type SchemaGetter = (data: {
    modelType: new () => BaseModel;
  }) => ModelSchemaType;

  function generated(getSchema: SchemaGetter): JSONObject {
    const registry: OpenAPIRegistry = new OpenAPIRegistry();

    registry.register("Schema", getSchema({ modelType: Form }));

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

  test("a form cannot be created without a name", () => {
    expect(requiredOf(create)).toEqual(expect.arrayContaining(["name"]));
  });

  test("what it creates and whether it accepts submissions are optional to send, with their defaults published", () => {
    for (const column of [
      "isEnabled",
      "targetType",
      "fields",
      "targetSettings",
    ]) {
      expect(requiredOf(create)).not.toContain(column);
    }

    expect((propertiesOf(create)["targetType"] as JSONObject)["default"]).toBe(
      DEFAULT_FORM_TARGET_TYPE,
    );
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

  /*
   * The API names a logo or favicon by its file's id (logoFileId,
   * faviconFileId), as it names every other relation; the relation objects
   * themselves are the dashboard's.
   */
  test("names the logo and favicon by their files' ids, not as objects", () => {
    for (const relation of ["logoFile", "faviconFile"]) {
      expect(propertiesOf(create)[relation]).toBeUndefined();
      expect(propertiesOf(update)[relation]).toBeUndefined();
    }
  });

  test.each(
    FORM_SETTINGS_COLUMNS.filter((column: string): boolean => {
      return column !== "logoFile" && column !== "faviconFile";
    }),
  )("%s is writable on create and update", (column: string) => {
    expect(propertiesOf(create)[column]).toBeDefined();
    expect(propertiesOf(update)[column]).toBeDefined();
  });
});

describe("FormSubmission: written by the submit route alone", () => {
  const model: FormSubmission = new FormSubmission();

  test("the API cannot create or edit a submission; owners, admins and the granular permissions read and delete them", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getReadPermissions()).toEqual(SUBMISSION_READERS);
    expect(model.getDeletePermissions()).toEqual(SUBMISSION_DELETERS);
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
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.IncidentAdmin,
    Permission.IncidentViewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ReadForm,
    Permission.EditForm,
  ])(
    "%s may not read a stranger's answers, name and email",
    (permission: Permission) => {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          FormSubmission,
          propsWith(permission),
          DatabaseRequestType.Read,
        );
      }).toThrow(NotAuthorizedException);
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadFormSubmission,
  ])("%s may read submissions", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        FormSubmission,
        propsWith(permission),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteFormSubmission,
  ])("%s may delete a submission", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        FormSubmission,
        propsWith(permission),
        DatabaseRequestType.Delete,
      );
    }).not.toThrow();
  });

  test.each([Permission.ProjectOwner, Permission.ReadFormSubmission])(
    "%s may not create one",
    (permission: Permission) => {
      const submission: FormSubmission = new FormSubmission();
      submission.projectId = PROJECT_ID;
      submission.formId = ObjectID.generate();
      submission.submitterName = "Jane";

      expect(() => {
        ModelPermission.checkCreatePermissions(
          FormSubmission,
          submission,
          propsWith(permission),
        );
      }).toThrow(NotAuthorizedException);
    },
  );
});

describe("FormSubmission columns", () => {
  const model: FormSubmission = new FormSubmission();

  test("has exactly the columns the migration creates - no created-by or deleted-by user", () => {
    expect([...model.getTableColumns().columns].sort()).toEqual(
      [...BASE_COLUMNS, ...SUBMISSION_COLUMNS].sort(),
    );
  });

  test("the project, form, incident and event ids are indexed", () => {
    expect(indexedColumns(FormSubmission)).toEqual(
      ["formId", "incidentId", "projectId", "scheduledMaintenanceId"].sort(),
    );
  });

  test("the submitter's name and email are optional and as long as the public form allows", () => {
    expect(model.getTableColumnMetadata("submitterName")).toMatchObject({
      type: TableColumnType.ShortText,
      required: false,
    });
    expect(columnArgs(FormSubmission, "submitterName").options).toMatchObject({
      nullable: true,
      length: ColumnLength.ShortText,
    });
    expect(model.getTableColumnMetadata("submitterEmail")).toMatchObject({
      type: TableColumnType.Email,
      required: false,
    });
    expect(columnArgs(FormSubmission, "submitterEmail").options).toMatchObject({
      nullable: true,
      length: ColumnLength.Email,
    });
  });

  test("the answers are a nullable JSON list", () => {
    expect(model.getTableColumnMetadata("answers").type).toBe(
      TableColumnType.JSON,
    );
    expect(columnArgs(FormSubmission, "answers").options.nullable).toBe(true);
  });

  interface RelationCase {
    relation: string;
    idColumn: string;
    modelType: ModelType;
    onDelete: string;
    nullable: boolean;
  }

  test.each([
    {
      relation: "project",
      idColumn: "projectId",
      modelType: Project,
      onDelete: "CASCADE",
      nullable: false,
    },
    {
      relation: "form",
      idColumn: "formId",
      modelType: Form,
      onDelete: "CASCADE",
      nullable: false,
    },
    {
      relation: "incident",
      idColumn: "incidentId",
      modelType: Incident,
      onDelete: "SET NULL",
      nullable: true,
    },
    {
      relation: "scheduledMaintenance",
      idColumn: "scheduledMaintenanceId",
      modelType: ScheduledMaintenance,
      onDelete: "SET NULL",
      nullable: true,
    },
  ] as Array<RelationCase>)(
    "$relation points at its model through $idColumn: $onDelete on delete",
    ({ relation, idColumn, modelType, onDelete, nullable }: RelationCase) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(modelType);
      expect(metadata.manyToOneRelationColumn).toBe(idColumn);
      expect(relationArgs(FormSubmission, relation).options).toMatchObject({
        onDelete,
        nullable,
      });
    },
  );

  test("deleting the form deletes its submissions; deleting what one created keeps it", () => {
    expect(relationArgs(FormSubmission, "form").options.onDelete).toBe(
      "CASCADE",
    );
    expect(relationArgs(FormSubmission, "incident").options.onDelete).toBe(
      "SET NULL",
    );
    expect(
      relationArgs(FormSubmission, "scheduledMaintenance").options.onDelete,
    ).toBe("SET NULL");
  });
});
