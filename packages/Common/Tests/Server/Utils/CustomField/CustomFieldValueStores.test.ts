import Models from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import {
  CustomFieldValueStore,
  getCustomFieldValueStore,
  getCustomFieldValueStores,
} from "../../../../Server/Utils/CustomField/CustomFieldValueStores";
import { CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS } from "../../../../Types/CustomField/CustomFieldSavedViews";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";

/*
 * Renaming a dropdown option (#4564) has to reach every table that stores a
 * value of the field. CustomFieldValueStores says which those are; this pins
 * it to the models, so a resource that gains custom fields, or a template
 * that starts holding them, cannot be forgotten: its values would keep the
 * old option's text while the field offers the new one.
 */

type ModelType = { new (): BaseModel };

// Every definition table: a model with a dropdownOptions column.
const definitionModels: Array<ModelType> = (Models as Array<ModelType>).filter(
  (modelType: ModelType): boolean => {
    const model: BaseModel = new modelType();
    return (
      model.hasColumn("dropdownOptions") &&
      model.hasColumn("customFieldType") &&
      Boolean(model.tableName?.endsWith("CustomField"))
    );
  },
);

// Every value table: a model with a customFields JSON column.
const valueModels: Array<ModelType> = (Models as Array<ModelType>).filter(
  (modelType: ModelType): boolean => {
    const model: BaseModel = new modelType();
    return (
      model.hasColumn("customFields") &&
      model.getTableColumnMetadata("customFields")?.type ===
        TableColumnType.JSON
    );
  },
);

const tableNamesOf: (services: Array<DatabaseService<any>>) => Array<string> = (
  services: Array<DatabaseService<any>>,
): Array<string> => {
  return services.map((service: DatabaseService<any>): string => {
    return service.getModel().tableName || "";
  });
};

describe("the stores of each resource's custom field values", () => {
  test("there are nine definition tables, and a store for each", () => {
    expect(definitionModels).toHaveLength(9);

    expect(
      getCustomFieldValueStores()
        .map((store: CustomFieldValueStore): string => {
          return store.definitionTableName;
        })
        .sort(),
    ).toEqual(
      definitionModels
        .map((modelType: ModelType): string => {
          return new modelType().tableName!;
        })
        .sort(),
    );
  });

  test("every table that holds custom field values is a store of exactly one definition", () => {
    const listed: Array<string> = getCustomFieldValueStores().flatMap(
      (store: CustomFieldValueStore): Array<string> => {
        return tableNamesOf(store.getValueServices());
      },
    );

    expect([...listed].sort()).toEqual(
      valueModels
        .map((modelType: ModelType): string => {
          return new modelType().tableName!;
        })
        .sort(),
    );

    expect(new Set(listed).size).toBe(listed.length);
  });

  test("names the records first, then the templates", () => {
    const expected: Record<string, Array<string>> = {
      IncidentCustomField: ["Incident", "IncidentTemplate"],
      AlertCustomField: ["Alert"],
      ScheduledMaintenanceCustomField: [
        "ScheduledMaintenance",
        "ScheduledMaintenanceTemplate",
      ],
      MonitorCustomField: ["Monitor", "MonitorTemplate"],
      StatusPageCustomField: ["StatusPage"],
      OnCallDutyPolicyCustomField: ["OnCallDutyPolicy"],
      TeamCustomField: ["Team"],
      TeamMemberCustomField: ["ProjectUserProfile"],
      InventoryItemCustomField: ["InventoryItem"],
    };

    for (const [definitionTableName, tables] of Object.entries(expected)) {
      const store: CustomFieldValueStore | undefined =
        getCustomFieldValueStore(definitionTableName);

      expect(store).toBeDefined();
      expect(tableNamesOf(store!.getValueServices())).toEqual(tables);
      // The records are what the option editor counts.
      expect(store!.getRecordService().getModel().tableName).toBe(tables[0]);
    }
  });

  test("each store's saved views are the ones the views registry names", () => {
    for (const store of getCustomFieldValueStores()) {
      expect(store.savedViewTableIds).toEqual(
        CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS[store.definitionTableName],
      );
    }
  });

  test("only incident and scheduled maintenance fields can be questions of a form", () => {
    const withForms: Array<[string, FormTargetType | null]> =
      getCustomFieldValueStores()
        .filter((store: CustomFieldValueStore): boolean => {
          return store.formTargetType !== null;
        })
        .map(
          (store: CustomFieldValueStore): [string, FormTargetType | null] => {
            return [store.definitionTableName, store.formTargetType];
          },
        );

    expect(withForms.sort()).toEqual(
      [
        ["IncidentCustomField", FormTargetType.Incident],
        [
          "ScheduledMaintenanceCustomField",
          FormTargetType.ScheduledMaintenance,
        ],
      ].sort(),
    );
  });

  test("each store names its definition for the logs", () => {
    for (const store of getCustomFieldValueStores()) {
      expect(store.definitionName).toMatch(/custom field$/);
    }
  });

  test("an unknown definition table, or none, has no store", () => {
    expect(getCustomFieldValueStore("Incident")).toBeUndefined();
    expect(getCustomFieldValueStore("")).toBeUndefined();
    expect(getCustomFieldValueStore(undefined)).toBeUndefined();
  });

  test("is built once: the same stores on every call", () => {
    expect(getCustomFieldValueStores()).toBe(getCustomFieldValueStores());
  });
});
