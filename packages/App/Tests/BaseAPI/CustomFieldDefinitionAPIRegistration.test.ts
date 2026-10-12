import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every custom field definition table - incidents, alerts, monitors and the
 * other six resources - is mounted with CustomFieldDefinitionAPI rather than
 * the plain BaseAPI, so each answers the option editor's
 * /<route>/:id/option-usage (#4564) beside its CRUD routes. Booting the API
 * router would pull in every service, so the mounting is pinned on the
 * source, whitespace-insensitively (a call prettier wrapped keeps a trailing
 * comma), as the other registration tests do.
 */

const PACKAGES_DIR: string = path.join(__dirname, "../../..");

function readSource(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(PACKAGES_DIR, ...parts), "utf8")
    .replace(/\s+/g, "");
}

// Every model that is a custom field definition: it has options and a type.
const definitionModelNames: Array<string> = (
  AllModelTypes as Array<DatabaseBaseModelType>
)
  .filter((modelType: DatabaseBaseModelType): boolean => {
    const model: BaseModel = new modelType();
    return (
      model.hasColumn("dropdownOptions") &&
      model.hasColumn("customFieldType") &&
      Boolean(model.tableName?.endsWith("CustomField"))
    );
  })
  .map((modelType: DatabaseBaseModelType): string => {
    return new modelType().tableName!;
  })
  .sort();

describe("the custom field definition routes under the API", () => {
  const index: string = readSource("App", "FeatureSet", "BaseAPI", "Index.ts");

  test("there are nine definition tables", () => {
    expect(definitionModelNames).toEqual([
      "AlertCustomField",
      "IncidentCustomField",
      "InventoryItemCustomField",
      "MonitorCustomField",
      "OnCallDutyPolicyCustomField",
      "ScheduledMaintenanceCustomField",
      "StatusPageCustomField",
      "TeamCustomField",
      "TeamMemberCustomField",
    ]);
  });

  test("CustomFieldDefinitionAPI is imported", () => {
    expect(index).toContain(
      'importCustomFieldDefinitionAPIfrom"Common/Server/API/CustomFieldDefinitionAPI";',
    );
  });

  test.each(definitionModelNames)(
    "%s is mounted once, with CustomFieldDefinitionAPI and not the plain BaseAPI",
    (modelName: string) => {
      const mounted: Array<string> =
        index.match(
          new RegExp(
            `newCustomFieldDefinitionAPI<${modelName},[A-Za-z]+>\\(${modelName},[A-Za-z]+,?\\)\\.getRouter\\(\\)`,
            "g",
          ),
        ) || [];

      expect(mounted).toHaveLength(1);
      expect(index).not.toContain(`newBaseAPI<${modelName},`);
    },
  );

  test("each one's service is its own definition service", () => {
    for (const modelName of definitionModelNames) {
      expect(index).toMatch(
        new RegExp(
          `newCustomFieldDefinitionAPI<${modelName},${modelName}ServiceType>\\(${modelName},${modelName}Service(Instance)?,?\\)`,
        ),
      );
    }
  });

  test("the route answers for POST and GET, behind the user middleware", () => {
    const api: string = readSource(
      "Common",
      "Server",
      "API",
      "CustomFieldDefinitionAPI.ts",
    );

    expect(api).toContain(
      'exportconstCUSTOM_FIELD_OPTION_USAGE_ROUTE:string="/option-usage";',
    );
    expect(api).toContain(
      "this.router.post(route,UserMiddleware.getUserMiddleware,handler);",
    );
    expect(api).toContain(
      "this.router.get(route,UserMiddleware.getUserMiddleware,handler);",
    );
    expect(api).toContain("CommonAPI.assertTenantScoped(props);");
  });
});
