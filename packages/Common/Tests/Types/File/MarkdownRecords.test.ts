import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import ShownImage from "../../../Models/DatabaseModels/ShownImage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import User from "../../../Models/DatabaseModels/User";
import { getCustomFieldRecordKind } from "../../../Types/CustomField/CustomFieldRecordKinds";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  canShowImages,
  canShowMarkdownFiles,
  COMMON_MARKDOWN_RECORD_TABLE_NAMES,
  CUSTOM_FIELDS_COLUMN,
  getImageColumns,
  getMarkdownColumns,
  getMarkdownCustomFieldKind,
  getMarkdownFilesRecordTypes,
  getMarkdownInJsonColumns,
  isMarkdownFilesRecordType,
  MARKDOWN_IN_JSON_COLUMNS,
} from "../../../Types/File/MarkdownRecords";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Which records can show files in Markdown, read from the models (#11256):
 * the records that get the markdown-files route, and the record types a Get
 * Files From Markdown step reads and its Record Type list offers. Held to
 * every model, so a model that gains a Markdown column is covered the day it
 * does.
 */

const MODELS: Array<BaseModel> = Entities.map(
  (modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  },
);

const tableNamesOf: (models: Array<BaseModel>) => Array<string> = (
  models: Array<BaseModel>,
): Array<string> => {
  return models.map((model: BaseModel): string => {
    return model.tableName || "";
  });
};

describe("getMarkdownColumns", () => {
  test("an incident's Markdown, in the order the model declares it", () => {
    expect(getMarkdownColumns(new Incident())).toEqual([
      "description",
      "rootCause",
      "postmortemNote",
      "remediationNotes",
    ]);
  });

  test("a note's Markdown", () => {
    expect(getMarkdownColumns(new IncidentInternalNote())).toEqual(["note"]);
    expect(getMarkdownColumns(new IncidentPublicNote())).toEqual([
      "note",
      "pendingNote",
    ]);
  });

  test("every column it names is a Markdown column of the model, and it names them all", () => {
    for (const model of MODELS) {
      const markdown: Array<string> = getMarkdownColumns(model);

      for (const column of model.getTableColumns().columns) {
        const isMarkdown: boolean =
          model.getTableColumnMetadata(column)?.type ===
          TableColumnType.Markdown;

        expect([model.tableName, column, markdown.includes(column)]).toEqual([
          model.tableName,
          column,
          isMarkdown,
        ]);
      }
    }
  });
});

describe("getMarkdownCustomFieldKind", () => {
  test("a record with custom fields, of a kind that has them", () => {
    expect(
      getMarkdownCustomFieldKind(new Incident())?.definitionTableName,
    ).toBe("IncidentCustomField");
    expect(getMarkdownCustomFieldKind(new Monitor())?.definitionTableName).toBe(
      "MonitorCustomField",
    );
  });

  test("a record with no custom fields has none", () => {
    expect(
      getMarkdownCustomFieldKind(new IncidentPublicNote()),
    ).toBeUndefined();
    expect(getMarkdownCustomFieldKind(new File())).toBeUndefined();
  });

  test("every model with a custom fields column is a kind of record with custom fields", () => {
    for (const model of MODELS) {
      if (model.getTableColumns().columns.includes(CUSTOM_FIELDS_COLUMN)) {
        expect([
          model.tableName,
          Boolean(getCustomFieldRecordKind(model.tableName)),
        ]).toEqual([model.tableName, true]);
      }
    }
  });
});

describe("canShowMarkdownFiles", () => {
  test("records of a project with Markdown, or with custom fields", () => {
    expect(canShowMarkdownFiles(new Incident())).toBe(true);
    expect(canShowMarkdownFiles(new IncidentPublicNote())).toBe(true);
    expect(canShowMarkdownFiles(new Alert())).toBe(true);
    // A monitor has no Markdown column, but its custom fields may be Markdown.
    expect(getMarkdownColumns(new Monitor())).toEqual([]);
    expect(canShowMarkdownFiles(new Monitor())).toBe(true);
  });

  test("a record of no project, and a file itself, show none", () => {
    expect(canShowMarkdownFiles(new User())).toBe(false);
    expect(canShowMarkdownFiles(new File())).toBe(false);
  });

  test("every model that can show files is of a project, with Markdown or custom fields", () => {
    for (const model of MODELS) {
      if (!canShowMarkdownFiles(model)) {
        continue;
      }

      expect([model.tableName, Boolean(model.getTenantColumn())]).toEqual([
        model.tableName,
        true,
      ]);
      expect([
        model.tableName,
        getMarkdownColumns(model).length > 0 ||
          Boolean(getMarkdownCustomFieldKind(model)),
      ]).toEqual([model.tableName, true]);
    }
  });
});

describe("the record types a Get Files From Markdown step reads", () => {
  const recordTypes: Array<BaseModel> = getMarkdownFilesRecordTypes(MODELS);
  const tableNames: Array<string> = tableNamesOf(recordTypes);

  test("exactly the record types a workflow reads (Find One) whose records can show files", () => {
    const expected: Array<string> = tableNamesOf(
      MODELS.filter((model: BaseModel): boolean => {
        return (
          canShowMarkdownFiles(model) && Boolean(model.enableWorkflowOn?.read)
        );
      }),
    ).sort();

    expect([...tableNames].sort()).toEqual(expected);

    for (const model of recordTypes) {
      expect(isMarkdownFilesRecordType(model)).toBe(true);
    }
  });

  test("each record type once", () => {
    expect(new Set(tableNames).size).toBe(tableNames.length);
  });

  test("the common ones lead, in their order, then the rest by name", () => {
    expect(
      tableNames.slice(0, COMMON_MARKDOWN_RECORD_TABLE_NAMES.length),
    ).toEqual([...COMMON_MARKDOWN_RECORD_TABLE_NAMES]);

    const rest: Array<string> = recordTypes
      .slice(COMMON_MARKDOWN_RECORD_TABLE_NAMES.length)
      .map((model: BaseModel): string => {
        return model.singularName || model.tableName || "";
      });

    expect(rest).toEqual(
      [...rest].sort((left: string, right: string): number => {
        return left.localeCompare(right);
      }),
    );
  });

  test("every common record type is one the step reads: a rename cannot drop it quietly", () => {
    for (const tableName of COMMON_MARKDOWN_RECORD_TABLE_NAMES) {
      expect([tableName, tableNames.includes(tableName)]).toEqual([
        tableName,
        true,
      ]);
    }
  });

  test("the incident, its notes and its custom fields lead the list", () => {
    expect(tableNames.slice(0, 3)).toEqual([
      "Incident",
      "IncidentPublicNote",
      "IncidentInternalNote",
    ]);
  });

  test("a model that a workflow does not read is not offered, whatever its Markdown", () => {
    for (const model of MODELS) {
      if (canShowMarkdownFiles(model) && !model.enableWorkflowOn?.read) {
        expect(tableNames).not.toContain(model.tableName);
      }
    }
  });

  test("the same model listed twice is offered once", () => {
    expect(
      tableNamesOf(
        getMarkdownFilesRecordTypes([
          new Incident(),
          new Incident(),
          new Alert(),
        ]),
      ),
    ).toEqual(["Incident", "Alert"]);
  });
});

/*
 * Which records show inline images to the people who may read them
 * (#11478): wider than what Get Files From Markdown reads - the Markdown a
 * record keeps in JSON too, where the dashboard's editor uploads pictures
 * as it does into any Markdown field.
 */
describe("the Markdown a record keeps in JSON columns", () => {
  test("a monitor's and a monitor template's criteria, and a playbook's steps", () => {
    expect(getMarkdownInJsonColumns(new Monitor())).toEqual(["monitorSteps"]);
    expect(getMarkdownInJsonColumns(new MonitorTemplate())).toEqual([
      "monitorSteps",
    ]);
    expect(getMarkdownInJsonColumns(new SecurityPlaybook())).toEqual(["steps"]);
  });

  test("a model with none has none", () => {
    expect(getMarkdownInJsonColumns(new Incident())).toEqual([]);
    expect(getMarkdownInJsonColumns(new User())).toEqual([]);
  });

  test("each column named is a JSON column of a model of that table, of a project", () => {
    for (const [tableName, columns] of Object.entries(
      MARKDOWN_IN_JSON_COLUMNS,
    )) {
      const model: BaseModel | undefined = MODELS.find(
        (candidate: BaseModel): boolean => {
          return candidate.tableName === tableName;
        },
      );

      expect([tableName, Boolean(model)]).toEqual([tableName, true]);
      expect([tableName, Boolean(model!.getTenantColumn())]).toEqual([
        tableName,
        true,
      ]);

      for (const column of columns) {
        expect([
          tableName,
          column,
          getMarkdownInJsonColumns(model!).includes(column),
        ]).toEqual([tableName, column, true]);
        expect([
          tableName,
          column,
          [TableColumnType.JSON, TableColumnType.MonitorSteps].includes(
            model!.getTableColumnMetadata(column)!.type,
          ),
        ]).toEqual([tableName, column, true]);
      }
    }
  });

  test("a table named in the list that has no such column names nothing", () => {
    const stranger: Monitor = new Monitor();

    jest
      .spyOn(stranger, "getTableColumns")
      .mockReturnValue({ columns: ["_id", "projectId"] } as never);

    expect(getMarkdownInJsonColumns(stranger)).toEqual([]);
  });
});

describe("getImageColumns", () => {
  test("an incident's Markdown, then its custom fields", () => {
    expect(getImageColumns(new Incident())).toEqual([
      "description",
      "rootCause",
      "postmortemNote",
      "remediationNotes",
      CUSTOM_FIELDS_COLUMN,
    ]);
  });

  test("a monitor's criteria and its custom fields", () => {
    expect(getImageColumns(new Monitor())).toEqual([
      "monitorSteps",
      CUSTOM_FIELDS_COLUMN,
    ]);
  });

  test("a note's Markdown alone, an edit waiting for approval too", () => {
    expect(getImageColumns(new IncidentInternalNote())).toEqual(["note"]);
    expect(getImageColumns(new IncidentPublicNote())).toEqual([
      "note",
      "pendingNote",
    ]);
  });

  test("an announcement's description", () => {
    expect(getImageColumns(new StatusPageAnnouncement())).toEqual([
      "description",
    ]);
  });

  test("covers everything Get Files From Markdown reads, for every model", () => {
    for (const model of MODELS) {
      const columns: Array<string> = getImageColumns(model);

      for (const column of getMarkdownColumns(model)) {
        expect([model.tableName, column, columns.includes(column)]).toEqual([
          model.tableName,
          column,
          true,
        ]);
      }

      if (getMarkdownCustomFieldKind(model)) {
        expect([
          model.tableName,
          columns.includes(CUSTOM_FIELDS_COLUMN),
        ]).toEqual([model.tableName, true]);
      }
    }
  });

  test("each column once, every one a column of the model", () => {
    for (const model of MODELS) {
      const columns: Array<string> = getImageColumns(model);

      expect([model.tableName, new Set(columns).size]).toEqual([
        model.tableName,
        columns.length,
      ]);

      for (const column of columns) {
        expect([
          model.tableName,
          column,
          model.getTableColumns().columns.includes(column),
        ]).toEqual([model.tableName, column, true]);
      }
    }
  });
});

describe("canShowImages", () => {
  test("every record that can show files in Markdown, and a playbook too", () => {
    for (const model of MODELS) {
      if (canShowMarkdownFiles(model)) {
        expect([model.tableName, canShowImages(model)]).toEqual([
          model.tableName,
          true,
        ]);
      }
    }

    expect(canShowMarkdownFiles(new SecurityPlaybook())).toBe(false);
    expect(canShowImages(new SecurityPlaybook())).toBe(true);
  });

  test("a record of no project, a file, and the table of shown images itself show none", () => {
    expect(canShowImages(new User())).toBe(false);
    expect(canShowImages(new File())).toBe(false);
    expect(canShowImages(new ShownImage())).toBe(false);
  });

  test("every model that can show images is of a project, with a column to show them in", () => {
    for (const model of MODELS) {
      if (!canShowImages(model)) {
        continue;
      }

      expect([model.tableName, Boolean(model.getTenantColumn())]).toEqual([
        model.tableName,
        true,
      ]);
      expect([model.tableName, getImageColumns(model).length > 0]).toEqual([
        model.tableName,
        true,
      ]);
    }
  });
});
