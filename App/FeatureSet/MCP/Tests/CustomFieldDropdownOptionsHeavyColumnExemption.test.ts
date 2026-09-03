import {
  SelectableFieldsInfo,
  generateAllFieldsSelect,
  getSelectableFieldsForModel,
} from "../Services/SelectFieldGenerator";
import ModelType from "../Types/ModelType";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * dropdownOptions on the nine custom-field tables became `text`
 * (TableColumnType.VeryLongText) once it had to hold reference lists — a
 * country list runs to 250 entries. VeryLongText is on the MCP "heavy column"
 * exclusion list: types that tend to hold multi-KB payloads and are dropped
 * from the default select for token efficiency.
 *
 * That exclusion is wrong for this column. For a Dropdown or
 * MultiSelectDropdown custom field the option list IS the set of legal
 * values, so an agent that reads a custom-field definition without it cannot
 * tell what it is allowed to write — it would have to guess, or issue a
 * second explicit select. So all nine are exempted, and these tests pin BOTH
 * halves: the exemptions hold, and they did not accidentally disable the
 * heavy-column filter for anything else.
 */

type CustomFieldModelConstructor = new () => DatabaseBaseModel;

interface CustomFieldModelUnderTest {
  tableName: string;
  modelClass: CustomFieldModelConstructor;
}

const CUSTOM_FIELD_MODELS: Array<CustomFieldModelUnderTest> = [
  { tableName: "AlertCustomField", modelClass: AlertCustomField },
  { tableName: "IncidentCustomField", modelClass: IncidentCustomField },
  {
    tableName: "InventoryItemCustomField",
    modelClass: InventoryItemCustomField,
  },
  { tableName: "MonitorCustomField", modelClass: MonitorCustomField },
  {
    tableName: "OnCallDutyPolicyCustomField",
    modelClass: OnCallDutyPolicyCustomField,
  },
  {
    tableName: "ScheduledMaintenanceCustomField",
    modelClass: ScheduledMaintenanceCustomField,
  },
  { tableName: "StatusPageCustomField", modelClass: StatusPageCustomField },
  { tableName: "TeamCustomField", modelClass: TeamCustomField },
  { tableName: "TeamMemberCustomField", modelClass: TeamMemberCustomField },
];

describe("MCP default select: custom-field dropdownOptions", () => {
  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions is included in the default select despite being a text column",
    ({ tableName }: CustomFieldModelUnderTest) => {
      const select: JSONObject = generateAllFieldsSelect(
        tableName,
        ModelType.Database,
      );

      expect(select["dropdownOptions"]).toBe(true);
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions is not reported as a heavy field",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      const info: SelectableFieldsInfo = getSelectableFieldsForModel(
        new modelClass(),
      );

      expect(info.allFields).toContain("dropdownOptions");
      expect(info.heavyFields).not.toContain("dropdownOptions");
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName.dropdownOptions really is a heavy type, so the exemption is needed",
    ({ modelClass }: CustomFieldModelUnderTest) => {
      /*
       * If this ever fails the column was narrowed back to a bounded varchar
       * and the exemption in SelectFieldGenerator can be deleted.
       */
      expect(
        new modelClass().getTableColumnMetadata("dropdownOptions").type,
      ).toBe(TableColumnType.VeryLongText);
    },
  );

  test.each(CUSTOM_FIELD_MODELS)(
    "$tableName still selects the columns that identify the field itself",
    ({ tableName }: CustomFieldModelUnderTest) => {
      const select: JSONObject = generateAllFieldsSelect(
        tableName,
        ModelType.Database,
      );

      expect(select["name"]).toBe(true);
      expect(select["customFieldType"]).toBe(true);
    },
  );
});

describe("MCP default select: the heavy-column filter still works", () => {
  test("the filter still discriminates — an exempted text column is selected while a heavy JSON column is not", () => {
    /*
     * The exemption is not a blanket pass: it lets IncidentCustomField's
     * dropdownOptions (VeryLongText, exempted) through, while Monitor's
     * customFields (JSON, not exempted) stays out. Both facts come from real
     * columns — IncidentCustomField declares no JSON column of its own, so
     * the JSON half of this claim has to be shown on a model that actually
     * has one.
     */
    const exemptedSelect: JSONObject = generateAllFieldsSelect(
      "IncidentCustomField",
      ModelType.Database,
    );
    expect(exemptedSelect["dropdownOptions"]).toBe(true);

    const monitorInfo: SelectableFieldsInfo = getSelectableFieldsForModel(
      new Monitor(),
    );
    expect(monitorInfo.heavyFields).toContain("customFields");

    const monitorSelect: JSONObject = generateAllFieldsSelect(
      "Monitor",
      ModelType.Database,
    );
    expect(monitorSelect["customFields"]).toBeUndefined();
  });

  test("exempting dropdownOptions leaves the custom-field table with no heavy column at all", () => {
    /*
     * These definition tables declare exactly one heavy-typed column,
     * dropdownOptions, so once it is exempted heavyFields is empty. That is
     * the whole surface area of the exemption on this table — pinned
     * positively so a future heavy column added here is noticed rather than
     * silently dropped from the default select.
     */
    const info: SelectableFieldsInfo = getSelectableFieldsForModel(
      new IncidentCustomField(),
    );

    expect(info.allFields).toContain("dropdownOptions");
    expect(info.heavyFields).toEqual([]);
  });
});
