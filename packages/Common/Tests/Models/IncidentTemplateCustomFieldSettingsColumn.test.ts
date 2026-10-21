import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { validateCustomFieldCreateSettings } from "../../Types/CustomField/CustomFieldCreateSettings";
import ColumnType from "../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserTenantAccessPermission } from "../../Types/Permission";
import ModelImportExport from "../../Utils/ModelImportExport";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * IncidentTemplate.customFieldSettings in model metadata and in the
 * published API, where the OpenAPI spec, the MCP tools and the Terraform
 * provider all come from (see IncidentCustomFieldApiSchemaContract.test.ts
 * for how the provider reads a schema).
 *
 * What is pinned: the column is documented and writable by whoever may
 * edit a template - the same people who fill in its custom field values -
 * its description says how it is keyed (by the field's template variable
 * key, not its name) and that only the Declare Incident form applies it, it
 * travels with a template's JSON export (the keys mean the same fields in
 * the project it is imported into), and it is nullable with no default, so
 * every existing template keeps asking exactly what it asked before.
 */

const model: IncidentTemplate = new IncidentTemplate();
const projectId: ObjectID = ObjectID.generate();

type SchemaGetter = (data: {
  modelType: new () => BaseModel;
}) => ModelSchemaType;

function generated(getSchema: SchemaGetter): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register("Schema", getSchema({ modelType: IncidentTemplate }));

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
}

function propertiesOf(schema: JSONObject): JSONObject {
  return (schema["properties"] || {}) as JSONObject;
}

function requiredOf(schema: JSONObject): Array<string> {
  return (schema["required"] as Array<string> | undefined) || [];
}

const getCreate: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getCreateModelSchema(data);
};

const getRead: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getReadModelSchema(data);
};

const getUpdate: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getUpdateModelSchema(data);
};

function props(permission: Permission): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
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
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function withSettings(): IncidentTemplate {
  const data: IncidentTemplate = new IncidentTemplate();
  data.customFieldSettings = { impact: "Required" };
  return data;
}

function metadata(): TableColumnMetadata {
  return model.getTableColumnMetadata("customFieldSettings");
}

describe("IncidentTemplate.customFieldSettings in the model", () => {
  test("has exactly the access of the template's custom field values", () => {
    const settings: ColumnAccessControl | null =
      model.getColumnAccessControlFor("customFieldSettings");
    const values: ColumnAccessControl | null =
      model.getColumnAccessControlFor("customFields");

    expect(settings).not.toBeNull();
    expect(settings).toEqual(values);
  });

  test("is an optional JSON object, nullable, with no default: existing templates are unchanged", () => {
    expect(metadata().type).toBe(TableColumnType.JSON);
    expect(metadata().required).toBe(false);
    expect(metadata().defaultValue).toBeUndefined();
    expect(model.isDefaultValueColumn("customFieldSettings")).toBe(false);

    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === IncidentTemplate &&
            candidate.propertyName === "customFieldSettings"
          );
        },
      );

    expect(column?.options.type).toBe(ColumnType.JSON);
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
  });

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.IncidentAdmin,
    Permission.ProjectAdmin,
  ])(
    "%s, who may edit templates, may set them on create and change them",
    (permission: Permission) => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          IncidentTemplate,
          withSettings(),
          props(permission),
          DatabaseRequestType.Create,
        );
        ColumnPermissions.checkDataColumnPermissions(
          IncidentTemplate,
          withSettings(),
          props(permission),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    },
  );

  test("the granular template permissions reach it the way they reach the values", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentTemplate,
        withSettings(),
        props(Permission.CreateIncidentTemplate),
        DatabaseRequestType.Create,
      );
      ColumnPermissions.checkDataColumnPermissions(
        IncidentTemplate,
        withSettings(),
        props(Permission.EditIncidentTemplate),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test.each([
    Permission.Viewer,
    Permission.IncidentViewer,
    Permission.ReadIncidentTemplate,
  ])(
    "%s, who only reads templates, may not change them",
    (permission: Permission) => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          IncidentTemplate,
          withSettings(),
          props(permission),
          DatabaseRequestType.Update,
        );
      }).toThrow("customFieldSettings");
    },
  );

  test("travels with a template's JSON export, next to its values", () => {
    const exported: Array<string> =
      ModelImportExport.getImportExportableColumnNames(IncidentTemplate);

    expect(exported).toContain("customFieldSettings");
    expect(exported).toContain("customFields");
  });
});

describe("IncidentTemplate.customFieldSettings in the published API", () => {
  const create: JSONObject = generated(getCreate);
  const read: JSONObject = generated(getRead);
  const update: JSONObject = generated(getUpdate);

  test("is documented, not hidden from the API reference", () => {
    expect(metadata().hideColumnInDocumentation).toBeFalsy();
  });

  test("is writable on create and update, returned on read, and never required", () => {
    expect(propertiesOf(create)["customFieldSettings"]).toBeDefined();
    expect(propertiesOf(update)["customFieldSettings"]).toBeDefined();
    expect(propertiesOf(read)["customFieldSettings"]).toBeDefined();
    expect(requiredOf(create)).not.toContain("customFieldSettings");
  });

  test("is published as an object with no default for the provider to send", () => {
    const property: JSONObject = propertiesOf(create)[
      "customFieldSettings"
    ] as JSONObject;

    expect(property["type"]).toBe("object");
    expect(property).not.toHaveProperty("default");
  });

  test("the description says how it is keyed, what each value does, and who applies it", () => {
    const description: string = String(metadata().description);

    // Keyed by the key that survives a rename, never by the name.
    expect(description).toContain("template variable key (variableKey)");
    for (const setting of ["Required", "Optional", "Hidden", "Default"]) {
      expect(description).toContain(setting);
    }
    // What an unlisted field does.
    expect(description).toContain("not listed");
    expect(description).toContain("Show on Create and Required on Create");
    // Dashboard only, like Required on Create itself.
    expect(description).toContain(
      "Only the dashboard's Declare Incident form applies these settings",
    );
    expect(description).toContain(
      "incidents created through the API are not checked against them",
    );
  });

  test("its example is a value the server accepts", () => {
    expect(metadata().example).toEqual({
      impact: "Required",
      affected_location: "Optional",
      additional_information: "Hidden",
    });
    expect(validateCustomFieldCreateSettings(metadata().example)).toBeNull();
  });
});

describe("the API does not enforce a template's settings", () => {
  /*
   * The description promises the settings are the dashboard's alone, as the
   * project-wide Required on Create is. If IncidentService ever starts
   * reading them, that promise - and the docs - must change with it.
   */
  test("IncidentService never reads customFieldSettings", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../Server/Services/IncidentService.ts"),
      "utf8",
    );

    expect(source).not.toContain("customFieldSettings");
  });
});
