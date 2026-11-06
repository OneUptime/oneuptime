import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";
import { DictionaryFilterOperator } from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  columnPickLabel,
  columnTypeLabel,
  controlForColumn,
  getColumnTitle,
  isOfferableColumn,
  jsonOnlyColumns,
  literalFitsControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnControl";
import { operatorsForControl } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnOperators";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
  makeColumnRow,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import {
  classifyRowValue,
  rowsFromParsedValue,
  serializeColumnRows,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRowSerialization";
import { ColumnUse } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import {
  ModelColumnEditorMode,
  classifyColumnValueCompatibility,
} from "../../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import {
  ComponentInputType,
  NodeDataProp,
} from "../../../../../Types/Workflow/Component";
import {
  FieldOption,
  FieldPickerMode,
  getFieldOptions,
} from "../../../../../UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { recordFieldSuggestions } from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { ValueSuggestion } from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #5943, in the record editor and the query builder: what a column that
 * names another record is drawn as, and that what it stores is the bytes the
 * step always wrote - a workflow that is only opened and saved does not change.
 */

const SEVERITY_ID: string = "7c000000-0000-4000-8000-0000000000a1";
const LABEL_ONE: string = "7c000000-0000-4000-8000-0000000000b1";
const LABEL_TWO: string = "7c000000-0000-4000-8000-0000000000b2";

const SEVERITY_COLUMN: ModelSchemaColumn = {
  id: "incidentSeverityId",
  title: "Incident Severity ID",
  type: TableColumnType.ObjectID,
  isRelation: false,
  linkedTableName: "IncidentSeverity",
  linkedTitle: "Incident Severity",
  required: true,
};

const PLAIN_ID_COLUMN: ModelSchemaColumn = {
  id: "someOtherId",
  title: "Some Other ID",
  type: TableColumnType.ObjectID,
  isRelation: false,
};

const LABELS_COLUMN: ModelSchemaColumn = {
  id: "labels",
  title: "Labels",
  type: TableColumnType.EntityArray,
  isRelation: true,
  relatedTableName: "Label",
  linkedTableName: "Label",
  linkedTitle: "Labels",
};

const FILES_COLUMN: ModelSchemaColumn = {
  id: "attachments",
  title: "Attachments",
  type: TableColumnType.EntityArray,
  isRelation: true,
  relatedTableName: "File",
};

const SEVERITY_RELATION: ModelSchemaColumn = {
  id: "incidentSeverity",
  title: "Incident Severity",
  type: TableColumnType.Entity,
  isRelation: true,
  relatedTableName: "IncidentSeverity",
  relationIdColumn: "incidentSeverityId",
};

const TITLE_COLUMN: ModelSchemaColumn = {
  id: "title",
  title: "Title",
  type: TableColumnType.ShortText,
  isRelation: false,
};

const COLUMNS: Array<ModelSchemaColumn> = [
  TITLE_COLUMN,
  SEVERITY_COLUMN,
  SEVERITY_RELATION,
  LABELS_COLUMN,
  FILES_COLUMN,
  PLAIN_ID_COLUMN,
];

describe("controlForColumn", () => {
  test("an ID whose records can be listed is picked from them", () => {
    expect(controlForColumn(SEVERITY_COLUMN)).toBe(ModelColumnControl.Record);
  });

  test("an ID nothing lists stays a box to type it into", () => {
    expect(controlForColumn(PLAIN_ID_COLUMN)).toBe(ModelColumnControl.ObjectId);
  });

  test("a list of records that can be listed is picked from them", () => {
    expect(controlForColumn(LABELS_COLUMN)).toBe(ModelColumnControl.RecordList);
  });

  test("a list of records nothing lists stays JSON", () => {
    expect(controlForColumn(FILES_COLUMN)).toBe(ModelColumnControl.Unsupported);
  });

  test("a relation to one record stays JSON: its ID column is the row", () => {
    expect(controlForColumn(SEVERITY_RELATION)).toBe(
      ModelColumnControl.Unsupported,
    );
  });

  test("a response from before the field existed changes nothing", () => {
    const { linkedTableName, ...older } = SEVERITY_COLUMN;

    expect(linkedTableName).toBeDefined();
    expect(controlForColumn(older)).toBe(ModelColumnControl.ObjectId);
  });
});

describe("what such a field is called", () => {
  test("by what it points at, not by the ID it holds", () => {
    expect(getColumnTitle(SEVERITY_COLUMN)).toBe("Incident Severity");
    expect(getColumnTitle(LABELS_COLUMN)).toBe("Labels");
  });

  test("any other field keeps the model's name", () => {
    expect(getColumnTitle(TITLE_COLUMN)).toBe("Title");
    expect(getColumnTitle(PLAIN_ID_COLUMN)).toBe("Some Other ID");
    expect(getColumnTitle(undefined)).toBeUndefined();
  });

  test("where it is filled in, its kind of value is a record, or records", () => {
    expect(columnPickLabel(SEVERITY_COLUMN)).toBe("Record");
    expect(columnPickLabel(LABELS_COLUMN)).toBe("Records");
  });

  test("what it holds, which a later step reads, is still an ID", () => {
    expect(columnTypeLabel(SEVERITY_COLUMN)).toBe("ID");
    expect(columnTypeLabel(PLAIN_ID_COLUMN)).toBe("ID");
    expect(columnTypeLabel(LABELS_COLUMN)).toBe("Records");
  });

  test("any other column is called the same in both places", () => {
    expect(columnPickLabel(TITLE_COLUMN)).toBe(columnTypeLabel(TITLE_COLUMN));
    expect(columnPickLabel(PLAIN_ID_COLUMN)).toBe(
      columnTypeLabel(PLAIN_ID_COLUMN),
    );
    expect(columnPickLabel(undefined)).toBe(columnTypeLabel(undefined));
  });
});

describe("the value picker and the field lists", () => {
  test("say what a later step gets: an ID", () => {
    const fields: Array<ValueSuggestion> = recordFieldSuggestions({
      component: {
        id: "incident-on-create-1",
        metadataId: "incident-on-create",
        arguments: {},
        metadata: { arguments: [] },
      } as unknown as NodeDataProp,
      returnValue: {
        id: "model",
        name: "Incident",
        description: "",
        type: ComponentInputType.BaseModel,
        required: false,
      },
      columns: [SEVERITY_COLUMN],
    });

    expect(fields[0]?.typeLabel).toBe("ID");

    const options: Array<FieldOption> = getFieldOptions({
      columns: [SEVERITY_COLUMN],
      mode: FieldPickerMode.PassOn,
    });

    expect(options[0]?.typeLabel).toBe("ID");
  });
});

describe("isOfferableColumn", () => {
  test("offers a linked ID for a create, an update and a filter", () => {
    for (const use of [ColumnUse.Create, ColumnUse.Update, ColumnUse.Filter]) {
      expect(isOfferableColumn(SEVERITY_COLUMN, use)).toBe(true);
    }
  });

  test("offers a list of records to write", () => {
    expect(isOfferableColumn(LABELS_COLUMN, ColumnUse.Create)).toBe(true);
    expect(isOfferableColumn(LABELS_COLUMN, ColumnUse.Update)).toBe(true);
  });

  test("does not offer it as a filter: a query's relation stays JSON", () => {
    expect(isOfferableColumn(LABELS_COLUMN, ColumnUse.Filter)).toBe(false);
  });

  test("still leaves out what no row can hold", () => {
    expect(isOfferableColumn(FILES_COLUMN, ColumnUse.Create)).toBe(false);
    expect(isOfferableColumn(SEVERITY_RELATION, ColumnUse.Create)).toBe(false);
  });

  test("respects a list that only an update may change", () => {
    expect(
      isOfferableColumn(
        { ...LABELS_COLUMN, canCreate: false },
        ColumnUse.Create,
      ),
    ).toBe(false);
    expect(
      isOfferableColumn(
        { ...LABELS_COLUMN, canCreate: false },
        ColumnUse.Update,
      ),
    ).toBe(true);
  });
});

describe("jsonOnlyColumns", () => {
  test("no longer names a list that can be picked", () => {
    const names: Array<string> = jsonOnlyColumns(COLUMNS, ColumnUse.Create).map(
      (column: ModelSchemaColumn): string => {
        return column.id;
      },
    );

    expect(names).not.toContain("labels");
    expect(names).toContain("attachments");
  });
});

describe("the comparisons a linked ID offers", () => {
  test("are an ID's: no contains, no greater than", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Record,
    );

    expect(operators).toEqual(operatorsForControl(ModelColumnControl.ObjectId));
    expect(operators).toContain(DictionaryFilterOperator.IsAnyOf);
    expect(operators).not.toContain(DictionaryFilterOperator.Contains);
  });
});

describe("literalFitsControl", () => {
  test("a record takes text, and nothing else", () => {
    expect(literalFitsControl(ModelColumnControl.Record, SEVERITY_ID)).toBe(
      true,
    );
    expect(literalFitsControl(ModelColumnControl.Record, 8)).toBe(false);
    expect(literalFitsControl(ModelColumnControl.Record, null)).toBe(false);
  });

  test("a list takes the list a step writes", () => {
    expect(
      literalFitsControl(ModelColumnControl.RecordList, [{ _id: LABEL_ONE }]),
    ).toBe(true);
    expect(literalFitsControl(ModelColumnControl.RecordList, [LABEL_ONE])).toBe(
      false,
    );
    expect(
      literalFitsControl(ModelColumnControl.RecordList, "not a list"),
    ).toBe(false);
  });
});

describe("classifyRowValue", () => {
  test("a stored ID is the record it names", () => {
    expect(classifyRowValue(ModelColumnControl.Record, SEVERITY_ID)).toEqual({
      valueMode: ColumnValueMode.Literal,
      text: SEVERITY_ID,
    });
  });

  test("a stored reference stays a value from an earlier step", () => {
    expect(
      classifyRowValue(ModelColumnControl.Record, "{{local.variables.a}}"),
    ).toEqual({
      valueMode: ColumnValueMode.Reference,
      text: "{{local.variables.a}}",
    });
  });

  test("a stored list is the IDs it names", () => {
    expect(
      classifyRowValue(ModelColumnControl.RecordList, [
        { _id: LABEL_ONE },
        { _id: LABEL_TWO },
      ]),
    ).toEqual({
      valueMode: ColumnValueMode.Literal,
      text: "",
      values: [LABEL_ONE, LABEL_TWO],
    });
  });

  test("a reference for the whole list stays one", () => {
    expect(
      classifyRowValue(ModelColumnControl.RecordList, "{{local.variables.a}}"),
    ).toEqual({
      valueMode: ColumnValueMode.Reference,
      text: "{{local.variables.a}}",
    });
  });

  test("a null keeps its own value", () => {
    expect(classifyRowValue(ModelColumnControl.Record, null)).toEqual({
      valueMode: ColumnValueMode.Raw,
      text: "",
      rawValue: null,
    });
  });
});

type RoundTripFunction = (
  value: JSONObject,
  mode?: ModelColumnEditorMode,
) => string;

const roundTrip: RoundTripFunction = (
  value: JSONObject,
  mode: ModelColumnEditorMode = ModelColumnEditorMode.Record,
): string => {
  return serializeColumnRows(
    rowsFromParsedValue(value, COLUMNS, mode),
    COLUMNS,
    mode,
  );
};

describe("opening a record and saving it again", () => {
  test("a linked ID comes back as it was", () => {
    const stored: JSONObject = { incidentSeverityId: SEVERITY_ID };

    expect(roundTrip(stored)).toBe(JSON.stringify(stored));
  });

  test("a list of records comes back as it was, in its order", () => {
    const stored: JSONObject = {
      title: "Down",
      labels: [{ _id: LABEL_TWO }, { _id: LABEL_ONE }],
    };

    expect(roundTrip(stored)).toBe(JSON.stringify(stored));
  });

  test("a reference among the list's entries comes back as it was", () => {
    const stored: JSONObject = {
      labels: [{ _id: "{{local.variables.labelId}}" }, { _id: LABEL_ONE }],
    };

    expect(roundTrip(stored)).toBe(JSON.stringify(stored));
  });

  test("a reference for a whole list comes back as it was", () => {
    const stored: JSONObject = {
      labels:
        "{{local.components.find-1.returnValues.model.labels}}" as unknown as Array<JSONObject>,
    };

    expect(roundTrip(stored)).toBe(JSON.stringify(stored));
  });
});

describe("what a row writes", () => {
  type RowsFunction = (rows: Array<ModelColumnRow>) => string;

  const write: RowsFunction = (rows: Array<ModelColumnRow>): string => {
    return serializeColumnRows(rows, COLUMNS, ModelColumnEditorMode.Record);
  };

  test("a picked record, as the ID the step has always sent", () => {
    expect(
      write([
        makeColumnRow({ columnId: "incidentSeverityId", text: SEVERITY_ID }),
      ]),
    ).toBe(JSON.stringify({ incidentSeverityId: SEVERITY_ID }));
  });

  test("a list with nothing picked says nothing about the record's list", () => {
    expect(write([makeColumnRow({ columnId: "labels", values: [] })])).toBe("");
  });

  test("picked records, as the list a step writes", () => {
    expect(
      write([
        makeColumnRow({ columnId: "labels", values: [LABEL_ONE, LABEL_TWO] }),
      ]),
    ).toBe(
      JSON.stringify({ labels: [{ _id: LABEL_ONE }, { _id: LABEL_TWO }] }),
    );
  });
});

describe("what the model makes of it when the step runs", () => {
  test("Create One reads a picked list as the related records it names", () => {
    const written: string = serializeColumnRows(
      [makeColumnRow({ columnId: "labels", values: [LABEL_ONE, LABEL_TWO] })],
      COLUMNS,
      ModelColumnEditorMode.Record,
    );

    const incident: Incident = BaseModel.fromJSON<Incident>(
      JSON.parse(written) as JSONObject,
      Incident,
    ) as Incident;

    expect(incident.labels).toHaveLength(2);
    expect(incident.labels?.[0]).toBeInstanceOf(Label);
    expect(incident.labels?.[0]?._id?.toString()).toBe(LABEL_ONE);
    expect(incident.labels?.[1]?._id?.toString()).toBe(LABEL_TWO);
  });
});

describe("a query", () => {
  test("is any of keeps its list of IDs", () => {
    const stored: JSONObject = {
      incidentSeverityId: {
        _type: "Includes",
        value: [SEVERITY_ID],
      } as unknown as JSONObject,
    };

    expect(
      rowsFromParsedValue(stored, COLUMNS, ModelColumnEditorMode.Query)[0]
        ?.values,
    ).toEqual([SEVERITY_ID]);
    expect(roundTrip(stored, ModelColumnEditorMode.Query)).toBe(
      JSON.stringify(stored),
    );
  });

  test("a list on a relation stays JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        { labels: [{ _id: LABEL_ONE }] },
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(false);
  });
});

describe("classifyColumnValueCompatibility, for a record", () => {
  test("the list a step writes is a row", () => {
    expect(
      classifyColumnValueCompatibility(
        { labels: [{ _id: LABEL_ONE }, { _id: LABEL_TWO }] },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toEqual({ compatible: true, reasons: [] });
  });

  test("a list that says more than its IDs stays JSON, saying why", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { labels: [{ _id: LABEL_ONE, name: "x" }] },
        COLUMNS,
        ModelColumnEditorMode.Record,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons.join(" ")).toContain("labels");
  });

  test("a list on a column nothing lists stays JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        { attachments: [{ _id: LABEL_ONE }] },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ).compatible,
    ).toBe(false);
  });

  test("a list stays JSON when the schema did not load", () => {
    expect(
      classifyColumnValueCompatibility(
        { labels: [{ _id: LABEL_ONE }] },
        [],
        ModelColumnEditorMode.Record,
      ).compatible,
    ).toBe(false);
  });
});
