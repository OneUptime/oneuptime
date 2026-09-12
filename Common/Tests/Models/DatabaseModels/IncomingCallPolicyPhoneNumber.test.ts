import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "../../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

type ModelType = { new (): BaseModel };

const model: IncomingCallPolicyPhoneNumber =
  new IncomingCallPolicyPhoneNumber();
const policy: IncomingCallPolicy = new IncomingCallPolicy();

const MODELS_DIR: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);
const MODEL_INDEX_SOURCE: string = fs.readFileSync(
  path.join(MODELS_DIR, "Index.ts"),
  "utf8",
);
const SERVICE_INDEX_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../Server/Services/Index.ts"),
  "utf8",
);
const BASE_API_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

const OWN_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "incomingCallPolicy",
  "incomingCallPolicyId",
  "projectCallSMSConfig",
  "projectCallSMSConfigId",
  "phoneNumber",
  "callProviderPhoneNumberId",
  "countryCode",
  "areaCode",
  "phoneNumberPurchasedAt",
];

const REQUIRED_COLUMNS: Array<string> = [
  "projectId",
  "incomingCallPolicyId",
  "projectCallSMSConfigId",
  "phoneNumber",
  "callProviderPhoneNumberId",
];

function columns(): Array<ColumnMetadataArgs> {
  return getMetadataArgsStorage().columns.filter(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === IncomingCallPolicyPhoneNumber;
    },
  );
}

function column(propertyName: string): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined = columns().find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.propertyName === propertyName;
    },
  );

  if (!found) {
    throw new Error(
      `IncomingCallPolicyPhoneNumber.${propertyName} has no @Column`,
    );
  }

  return found;
}

function indices(): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (entry: IndexMetadataArgs): boolean => {
      return entry.target === IncomingCallPolicyPhoneNumber;
    },
  );
}

function relation(propertyName: string): RelationMetadataArgs {
  const found: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find(
      (entry: RelationMetadataArgs): boolean => {
        return (
          entry.target === IncomingCallPolicyPhoneNumber &&
          entry.propertyName === propertyName
        );
      },
    );

  if (!found) {
    throw new Error(
      `IncomingCallPolicyPhoneNumber.${propertyName} has no relation`,
    );
  }

  return found;
}

function indexWithName(name: string): IndexMetadataArgs | undefined {
  return indices().find((entry: IndexMetadataArgs): boolean => {
    return entry.name === name;
  });
}

describe("IncomingCallPolicyPhoneNumber model registration", () => {
  test("is documented, project-scoped, and has its own CRUD route", () => {
    expect(model.tableName).toBe("IncomingCallPolicyPhoneNumber");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/incoming-call-policy-phone-number",
    );
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.enableDocumentation).toBe(true);
  });

  test("is imported and exported exactly once by the database model registry", () => {
    expect(MODEL_INDEX_SOURCE).toContain(
      'import IncomingCallPolicyPhoneNumber from "./IncomingCallPolicyPhoneNumber";',
    );
    expect(
      MODEL_INDEX_SOURCE.match(/^\s*IncomingCallPolicyPhoneNumber,\s*$/gm),
    ).toHaveLength(1);
  });

  test("registers its service exactly once in the common service registry", () => {
    expect(SERVICE_INDEX_SOURCE).toContain(
      'import IncomingCallPolicyPhoneNumberService from "./IncomingCallPolicyPhoneNumberService";',
    );
    expect(
      SERVICE_INDEX_SOURCE.match(
        /^\s*IncomingCallPolicyPhoneNumberService,\s*$/gm,
      ),
    ).toHaveLength(1);
  });

  test("mounts the model with its matching service in BaseAPI", () => {
    expect(BASE_API_SOURCE).toContain(
      'import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";',
    );
    expect(BASE_API_SOURCE).toContain(
      "import IncomingCallPolicyPhoneNumberService, {",
    );

    const registrationStart: number = BASE_API_SOURCE.indexOf(
      "// IncomingCallPolicyPhoneNumber (read-only through model permissions)",
    );
    const registrationEnd: number = BASE_API_SOURCE.indexOf(
      "// IncomingCallLog",
      registrationStart,
    );
    const registration: string = BASE_API_SOURCE.slice(
      registrationStart,
      registrationEnd,
    );
    expect(registrationStart).toBeGreaterThan(-1);
    expect(registration).toContain("new BaseAPI<");
    expect(registration).toContain("IncomingCallPolicyPhoneNumber,");
    expect(registration).toContain("IncomingCallPolicyPhoneNumberService,");
  });

  test("has a CRUD route literal no other database model claims", () => {
    const owners: Array<string> = fs
      .readdirSync(MODELS_DIR)
      .filter((name: string): boolean => {
        return name.endsWith(".ts") && name !== "Index.ts";
      })
      .filter((name: string): boolean => {
        return fs
          .readFileSync(path.join(MODELS_DIR, name), "utf8")
          .includes('new Route("/incoming-call-policy-phone-number")');
      });

    expect(owners).toEqual(["IncomingCallPolicyPhoneNumber.ts"]);
  });

  test("declares exactly the provider-number fields in addition to BaseModel", () => {
    const baseColumns: Array<string> = new BaseModel().getTableColumns()
      .columns;
    const declared: Array<string> = model
      .getTableColumns()
      .columns.filter((name: string): boolean => {
        return !baseColumns.includes(name);
      });

    expect(declared.sort()).toEqual([...OWN_COLUMNS].sort());
  });

  test("inherits the policy read audience but is root-written and root-deleted", () => {
    expect(model.readRecordPermissions).toEqual(policy.readRecordPermissions);
    expect(model.readRecordPermissions.length).toBeGreaterThan(0);
    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  test("lets policy readers read every declared field but lets clients write none", () => {
    for (const name of OWN_COLUMNS) {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(name);

      expect({ name, create: access?.create || [] }).toEqual({
        name,
        create: [],
      });
      expect({ name, update: access?.update || [] }).toEqual({
        name,
        update: [],
      });
      expect({ name, read: access?.read || [] }).toEqual({
        name,
        read: policy.readRecordPermissions,
      });
    }
  });

  test("follows label/read scoping through its incoming-call policy", () => {
    expect(model.canAccessIfCanReadOn).toBe("incomingCallPolicy");
    expect(
      model.getTableColumnMetadata("incomingCallPolicy")
        .manyToOneRelationColumn,
    ).toBe("incomingCallPolicyId");
    expect(model.getTableColumnMetadata("incomingCallPolicy").modelType).toBe(
      IncomingCallPolicy,
    );
  });
});

describe("IncomingCallPolicyPhoneNumber persistence contract", () => {
  test("requires every identity needed to route and later release a number", () => {
    for (const name of REQUIRED_COLUMNS) {
      expect({
        name,
        tableRequired: model.getTableColumnMetadata(name).required,
        databaseNullable: column(name).options.nullable,
      }).toEqual({
        name,
        tableRequired: true,
        databaseNullable: false,
      });
    }
  });

  test("keeps descriptive provider metadata optional", () => {
    for (const name of ["countryCode", "areaCode", "phoneNumberPurchasedAt"]) {
      expect({
        name,
        tableRequired: model.getTableColumnMetadata(name).required,
        databaseNullable: column(name).options.nullable,
      }).toEqual({
        name,
        tableRequired: false,
        databaseNullable: true,
      });
    }
  });

  test("cascades with project, policy, and the provider configuration", () => {
    const expected: Array<{
      propertyName: string;
      modelType: ModelType;
    }> = [
      { propertyName: "project", modelType: Project },
      { propertyName: "incomingCallPolicy", modelType: IncomingCallPolicy },
      {
        propertyName: "projectCallSMSConfig",
        modelType: ProjectCallSMSConfig,
      },
    ];

    for (const item of expected) {
      expect({
        propertyName: item.propertyName,
        onDelete: relation(item.propertyName).options.onDelete,
        nullable: relation(item.propertyName).options.nullable,
        modelType: model.getTableColumnMetadata(item.propertyName).modelType,
      }).toEqual({
        propertyName: item.propertyName,
        onDelete: "CASCADE",
        nullable: false,
        modelType: item.modelType,
      });
    }
  });

  test("makes an active phone number globally unique for unambiguous webhook routing", () => {
    const uniquePhone: IndexMetadataArgs | undefined = indexWithName(
      "IDX_INCOMING_CALL_POLICY_PHONE_NUMBER_UNIQUE",
    );

    expect(uniquePhone).toBeDefined();
    expect(uniquePhone?.unique).toBe(true);
    expect(uniquePhone?.columns).toEqual(["phoneNumber"]);
    expect(uniquePhone?.where).toBe('"deletedAt" IS NULL');
  });

  test("makes a provider SID unique inside the configuration that owns it", () => {
    const uniqueProviderId: IndexMetadataArgs | undefined = indexWithName(
      "IDX_INCOMING_CALL_POLICY_PROVIDER_PHONE_NUMBER_UNIQUE",
    );

    expect(uniqueProviderId).toBeDefined();
    expect(uniqueProviderId?.unique).toBe(true);
    expect(uniqueProviderId?.columns).toEqual([
      "projectCallSMSConfigId",
      "callProviderPhoneNumberId",
    ]);
    expect(uniqueProviderId?.where).toBe('"deletedAt" IS NULL');
  });

  test("indexes policy/project lookup without making policy unique", () => {
    const policyProjectIndex: IndexMetadataArgs | undefined = indices().find(
      (entry: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(entry.columns) &&
          entry.columns.length === 2 &&
          entry.columns.includes("incomingCallPolicyId") &&
          entry.columns.includes("projectId")
        );
      },
    );

    expect(policyProjectIndex).toBeDefined();
    expect(policyProjectIndex?.unique).not.toBe(true);

    const policyUniqueIndexes: Array<IndexMetadataArgs> = indices().filter(
      (entry: IndexMetadataArgs): boolean => {
        return (
          entry.unique === true &&
          Array.isArray(entry.columns) &&
          entry.columns.includes("incomingCallPolicyId")
        );
      },
    );

    expect(policyUniqueIndexes).toEqual([]);
  });

  test("uses entity relations for policy, project, and provider configuration", () => {
    expect(model.getTableColumnMetadata("project").type).toBe(
      TableColumnType.Entity,
    );
    expect(model.getTableColumnMetadata("incomingCallPolicy").type).toBe(
      TableColumnType.Entity,
    );
    expect(model.getTableColumnMetadata("projectCallSMSConfig").type).toBe(
      TableColumnType.Entity,
    );
  });
});
