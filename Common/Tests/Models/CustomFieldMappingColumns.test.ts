import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertCustomField from "../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../Models/DatabaseModels/TeamMemberCustomField";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { getColumnAccessControl } from "../../Types/Database/AccessControl/ColumnAccessControl";
import {
  getTableColumn,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";

/*
 * The nine `*CustomField` definition tables are near-identical clones, and
 * this test exists because ONE of them missing a column is not a small
 * cosmetic inconsistency — it is an outage on unrelated pages.
 *
 * CustomFieldsDetail (the Custom Fields card on every resource) issues ONE
 * select for whatever definition model it is handed, and SelectPermission
 * throws BadDataException on a column the model does not declare. So adding
 * the value-mapping columns to only the three resources that can actually use
 * them, while asking for them in that shared select, would make the Monitor,
 * Team, Status Page, On-Call and Inventory custom-field cards error out and
 * their table columns and facet chips silently vanish.
 */

const MODELS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

const MAPPING_COLUMNS: Array<string> = [
  "mapFromResourceType",
  "mapFromCustomFieldName",
];

type ModelClass = { new (): BaseModel };

/*
 * Imported statically rather than resolved by path: dynamic `require` is
 * banned by this repo's lint config. A hand-written map is only a liability if
 * it can fall behind the directory, which the first test below rules out — a
 * tenth definition table fails this suite the day it is added.
 */
const DEFINITION_MODELS: Record<string, ModelClass> = {
  AlertCustomField: AlertCustomField,
  IncidentCustomField: IncidentCustomField,
  InventoryItemCustomField: InventoryItemCustomField,
  MonitorCustomField: MonitorCustomField,
  OnCallDutyPolicyCustomField: OnCallDutyPolicyCustomField,
  ScheduledMaintenanceCustomField: ScheduledMaintenanceCustomField,
  StatusPageCustomField: StatusPageCustomField,
  TeamCustomField: TeamCustomField,
  TeamMemberCustomField: TeamMemberCustomField,
};

const definitionModelNames: Array<string> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((fileName: string) => {
    return fileName.endsWith("CustomField.ts");
  })
  .map((fileName: string) => {
    return fileName.replace(/\.ts$/, "");
  })
  .sort();

type LoadModelFunction = (modelName: string) => BaseModel;

const loadModel: LoadModelFunction = (modelName: string): BaseModel => {
  return new DEFINITION_MODELS[modelName]!();
};

describe("custom field definition models", () => {
  /*
   * Also a guard against the suite passing vacuously: if the glob stopped
   * matching, every test.each below would silently run zero cases.
   */
  test("covers every definition model on disk", () => {
    expect(definitionModelNames.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(DEFINITION_MODELS).sort()).toEqual(definitionModelNames);
  });

  test.each(definitionModelNames)(
    "%s declares both value-mapping columns",
    (modelName: string) => {
      const model: BaseModel = loadModel(modelName);

      for (const columnName of MAPPING_COLUMNS) {
        expect(Object.prototype.hasOwnProperty.call(model, columnName)).toBe(
          true,
        );

        const tableColumn: TableColumnMetadata = getTableColumn(
          model,
          columnName,
        );

        expect(tableColumn).toBeTruthy();
        expect(tableColumn.type).toBe(TableColumnType.ShortText);
        expect(tableColumn.required).toBe(false);
      }
    },
  );

  /*
   * ModelForm drops any field the user has no declared permission on, without
   * an error. A column with no @ColumnAccessControl would therefore ship the
   * whole feature as an invisible no-op: the settings form would simply not
   * render the picker.
   */
  test.each(definitionModelNames)(
    "%s gates both value-mapping columns with read, create and update permissions",
    (modelName: string) => {
      const model: BaseModel = loadModel(modelName);

      for (const columnName of MAPPING_COLUMNS) {
        const accessControl: ColumnAccessControl = getColumnAccessControl(
          model,
          columnName,
        );

        expect(accessControl).toBeTruthy();
        expect(accessControl.read.length).toBeGreaterThan(0);
        expect(accessControl.create.length).toBeGreaterThan(0);
        expect(accessControl.update.length).toBeGreaterThan(0);
      }
    },
  );

  /*
   * The mapping columns must be gated exactly as this model's other editable
   * definition columns are — copying `dropdownOptions`' permission family is
   * what keeps a resource's own Create/Read/Edit roles in charge of them
   * (and is why InventoryItemCustomField correctly reuses the Telemetry
   * family rather than minting one of its own).
   */
  test.each(definitionModelNames)(
    "%s gates the value-mapping columns like its other editable columns",
    (modelName: string) => {
      const model: BaseModel = loadModel(modelName);

      const reference: ColumnAccessControl = getColumnAccessControl(
        model,
        "dropdownOptions",
      );

      expect(reference).toBeTruthy();

      for (const columnName of MAPPING_COLUMNS) {
        expect(getColumnAccessControl(model, columnName)).toEqual(reference);
      }
    },
  );
});
