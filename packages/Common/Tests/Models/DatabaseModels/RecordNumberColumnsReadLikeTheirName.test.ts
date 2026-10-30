import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission from "../../../Types/Permission";
import { getDisplayNameColumn } from "../../../UI/Utils/ModelDisplayName";
import {
  RecordNumberColumns,
  getRecordNumberColumns,
} from "../../../Utils/Project/RecordNumber";
import { describe, expect, test } from "@jest/globals";

/*
 * WHOEVER MAY READ A NUMBERED RECORD'S NAME MAY READ ITS NUMBER.
 *
 * A numbered record's page reads its number with its name, in one read:
 * the heading, the trail and the browser tab say "INC-18 Manually
 * declared" (ModelPage), and so does its Delete card (ModelDelete). The
 * server refuses a whole read that selects one column the reader may not
 * read (SelectPermission), so a number column readable by fewer people
 * than the name would take the page's header away from everybody else -
 * an error where the incident's title used to be.
 *
 * So for every model that numbers its records (Utils/Project/RecordNumber:
 * a number column with a "...WithPrefix" column beside it), both number
 * columns are readable by every permission that reads the model's name
 * column.
 */

interface NumberedModel {
  name: string;
  model: BaseModel;
  numberColumns: RecordNumberColumns;
  nameColumn: string;
}

function getNumberedModels(): Array<NumberedModel> {
  const numbered: Array<NumberedModel> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const numberColumns: RecordNumberColumns | null =
      getRecordNumberColumns(model);

    if (!numberColumns) {
      continue;
    }

    numbered.push({
      name: model.tableName || modelType.name,
      model,
      numberColumns,
      nameColumn: getDisplayNameColumn(model) || "",
    });
  }

  return numbered;
}

const NUMBERED_MODELS: Array<NumberedModel> = getNumberedModels();

function readPermissions(model: BaseModel, column: string): Array<Permission> {
  return model.getColumnAccessControlFor(column)?.read || [];
}

describe("numbered records", () => {
  test("are found among every model: the five events and security cases", () => {
    expect(
      NUMBERED_MODELS.map((numbered: NumberedModel): string => {
        return numbered.name;
      }).sort(),
    ).toEqual(
      [
        "Alert",
        "AlertEpisode",
        "Incident",
        "IncidentEpisode",
        "ScheduledMaintenance",
        "SecurityCase",
      ].sort(),
    );
  });

  test("each is named by a column of its own: its title", () => {
    for (const numbered of NUMBERED_MODELS) {
      expect({ model: numbered.name, name: numbered.nameColumn }).toEqual({
        model: numbered.name,
        name: "title",
      });
    }
  });

  test.each(
    NUMBERED_MODELS.map((numbered: NumberedModel): [string, NumberedModel] => {
      return [numbered.name, numbered];
    }),
  )(
    "%s: whoever may read its title may read its number",
    (_name: string, numbered: NumberedModel) => {
      const nameReaders: Array<Permission> = readPermissions(
        numbered.model,
        numbered.nameColumn,
      );
      expect(nameReaders.length).toBeGreaterThan(0);

      for (const column of [
        numbered.numberColumns.numberColumn,
        numbered.numberColumns.numberWithPrefixColumn,
      ]) {
        const numberReaders: Array<Permission> = readPermissions(
          numbered.model,
          column,
        );

        const missing: Array<Permission> = nameReaders.filter(
          (permission: Permission): boolean => {
            return !numberReaders.includes(permission);
          },
        );

        expect({ column, missing }).toEqual({ column, missing: [] });
      }
    },
  );
});
