/*
 * A schema-driven editor for the two workflow arguments that are keyed on a
 * model's columns: the Query that picks which records a component acts on,
 * and the record of values a create/update writes.
 *
 * Both were bare JSON editors, with the column names — and, for a query, the
 * operator syntax — left entirely to memory. The first attempt at fixing that
 * borrowed the generic key/value row editor, which asked for a column name as
 * free text and then asked, in a dropdown next to it, whether the value was
 * Text, Number or Boolean. Both questions were already answered:
 * /model-schema/:tableName says that `color` is a Color and `name` is a Name,
 * so the builder could only agree with the schema or be wrong.
 *
 * So the rows are generated from the schema instead. A record is a form of the
 * model's own fields, with their real titles and descriptions; a query is a
 * list of conditions whose comparisons are filtered by the column's type. The
 * JSON escape hatch stays for the values rows cannot express, and now it
 * re-reads what was typed in it rather than discarding it.
 */

import CodeEditor from "../CodeEditor/CodeEditor";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import {
  DictionaryEntryValue,
  getOperatorOption,
} from "../Dictionary/DictionaryFilterOperator";
import Icon from "../Icon/Icon";
import {
  ModelSchemaAccess,
  ModelSchemaColumn,
  ModelSchemaState,
  findColumn,
  requiredWritableColumns,
  useModelSchema,
} from "./ModelSchema";
import { ModelColumnRow } from "./ColumnEditor/ColumnRow";
import {
  rowsFromParsedValue,
  seedRequiredRows,
  serializeColumnRows,
} from "./ColumnEditor/ColumnRowSerialization";
import ModelQueryBuilder from "./ColumnEditor/ModelQueryBuilder";
import ModelRecordForm from "./ColumnEditor/ModelRecordForm";
import CodeType from "../../../Types/Code/CodeType";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import { maskTemplateExpressions } from "../../../Types/Workflow/TemplateSyntax";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export enum ModelColumnEditorMode {
  /** Conditions that select records: column, operator, value. */
  Query = "Query",
  /** Values to write: column, value. No operators — you cannot save a ">". */
  Record = "Record",
}

/**
 * Whether the record being edited creates a row or updates one.
 *
 * It decides one thing: whether the editor opens with a blank row for every
 * column a create must supply. An update legitimately writes a single column,
 * so seeding those rows there presents six fields where the builder wanted one.
 */
export enum RecordIntent {
  Create = "Create",
  Update = "Update",
}

export interface ComponentProps {
  tableName: string;
  mode: ModelColumnEditorMode;
  initialValue?: string | JSONObject | null | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
  /** Record mode only; ignored for a query. Defaults to Create. */
  recordIntent?: RecordIntent | undefined;
  /*
   * Offered in any row whose column has no suggestions of its own - the other
   * steps' return values and the workflow's variables. The row editor replaced
   * the "pick this value from another component" footer for these arguments, so
   * without this there is no way to reach a reference from a record payload,
   * which is how almost every create is built.
   */
  valueSuggestions?: Array<string> | undefined;
}

type ViewMode = "builder" | "json";

/*
 * Operator wrappers the row editor can show. Anything else in a stored query
 * (an InBetween, a relation sub-object, a raw QueryHelper construct) keeps the
 * JSON editor rather than being silently flattened.
 */
const REPRESENTABLE_OPERATOR_TYPES: Array<string> = [
  ObjectType.EqualTo,
  ObjectType.NotEqual,
  ObjectType.Search,
  ObjectType.NotContains,
  ObjectType.StartsWith,
  ObjectType.EndsWith,
  ObjectType.GreaterThan,
  ObjectType.GreaterThanOrEqual,
  ObjectType.LessThan,
  ObjectType.LessThanOrEqual,
  ObjectType.IsNull,
  ObjectType.NotNull,
  ObjectType.Includes,
  ObjectType.IncludesNone,
];

export interface ParsedQuery {
  /** The raw text, always kept so the JSON editor can show it verbatim. */
  text: string;
  /** The parsed object, or null when the text is not a JSON object. */
  parsed: JSONObject | null;
  /**
   * True when the text is a JSON object apart from carrying a bare `{{ }}`
   * reference where a value belongs, as in `{"retries": {{local.variables.n}}}`.
   *
   * That is not JSON, so it cannot be rows, but it is a perfectly good workflow
   * value: GraphLint and form validation both mask references before parsing
   * and accept it. Without this distinction the editor called it "not a JSON
   * object" and locked itself while the canvas showed no error at all, so the
   * builder was told two different things about the same value.
   */
  hasTemplateExpressions: boolean;
}

type IsJSONObjectFunction = (value: unknown) => boolean;

const isJSONObject: IsJSONObjectFunction = (value: unknown): boolean => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export type NormalizeInitialValueFunction = (
  value: string | JSONObject | null | undefined,
) => ParsedQuery;

export const normalizeInitialValue: NormalizeInitialValueFunction = (
  value: string | JSONObject | null | undefined,
): ParsedQuery => {
  if (value === null || value === undefined || value === "") {
    return { text: "", parsed: {}, hasTemplateExpressions: false };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      text: JSON.stringify(value, null, 2),
      parsed: value,
      hasTemplateExpressions: false,
    };
  }

  if (typeof value !== "string") {
    return { text: String(value), parsed: null, hasTemplateExpressions: false };
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (isJSONObject(parsed)) {
      return {
        text: value,
        parsed: parsed as JSONObject,
        hasTemplateExpressions: false,
      };
    }

    return { text: value, parsed: null, hasTemplateExpressions: false };
  } catch {
    /*
     * Same masking TemplateSyntax.checkJSONSyntax does, so this editor and the
     * linter agree on which values are broken and which merely hold a
     * reference.
     */
    const masked: string = maskTemplateExpressions(value);

    if (masked !== value) {
      try {
        if (isJSONObject(JSON.parse(masked))) {
          return { text: value, parsed: null, hasTemplateExpressions: true };
        }
      } catch {
        // Still not JSON once the references are out of the way — genuinely broken.
      }
    }

    return { text: value, parsed: null, hasTemplateExpressions: false };
  }
};

interface CompatibilityResult {
  compatible: boolean;
  /** Shown to the builder so a locked JSON editor is never unexplained. */
  reasons: Array<string>;
}

type ClassifyCompatibilityFunction = (
  parsed: JSONObject | null,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
  hasTemplateExpressions?: boolean | undefined,
) => CompatibilityResult;

/**
 * Can this value be shown as rows without losing anything?
 *
 * Deliberately conservative: when in doubt the JSON editor stays, because a
 * value silently rewritten into something that means something else is far
 * worse than one the builder has to keep editing as text.
 */
export const classifyColumnValueCompatibility: ClassifyCompatibilityFunction = (
  parsed: JSONObject | null,
  columns: Array<ModelSchemaColumn>,
  mode: ModelColumnEditorMode,
  hasTemplateExpressions?: boolean | undefined,
): CompatibilityResult => {
  if (parsed === null) {
    return {
      compatible: false,
      reasons: [
        hasTemplateExpressions
          ? "This value uses a {{ }} reference where a value goes, which the rows can't show. It stays as JSON."
          : "The current value isn't a JSON object.",
      ],
    };
  }

  const reasons: Array<string> = [];

  for (const key of Object.keys(parsed)) {
    /*
     * Columns are only checked when the schema actually loaded. An unknown key
     * is worth saying out loud — it is the "id" versus "_id" mistake — but it
     * does not force the JSON editor, since the runner accepts column names
     * this endpoint does not surface.
     */
    if (columns.length > 0 && !findColumn(columns, key)) {
      reasons.push(`"${key}" isn't a known column on this model.`);
    }

    const value: unknown = parsed[key];

    if (value === null) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      /*
       * The "is any of" advice is Query-only: Record mode renders with
       * enableOperators={false}, so it was telling half its readers to reach
       * for a control that is not on their screen.
       */
      reasons.push(
        mode === ModelColumnEditorMode.Query
          ? `"${key}" holds a list. Use the "is any of" operator instead, or keep editing as JSON.`
          : `"${key}" holds a list, which the rows can't show. Keep editing as JSON.`,
      );
      continue;
    }

    if (typeof value === "object") {
      const objectType: unknown = (value as JSONObject)["_type"];

      if (
        mode === ModelColumnEditorMode.Query &&
        typeof objectType === "string" &&
        REPRESENTABLE_OPERATOR_TYPES.includes(objectType)
      ) {
        continue;
      }

      if (typeof objectType === "string") {
        reasons.push(`"${key}" uses ${objectType}, which the rows can't show.`);
        continue;
      }

      reasons.push(
        `"${key}" holds a nested record, which the rows can't show.`,
      );
      continue;
    }

    reasons.push(`"${key}" has an unexpected value.`);
  }

  /*
   * An unknown column name is a warning, not a reason to lock the editor —
   * the builder can still fix it in the row that shows it.
   */
  const blocking: Array<string> = reasons.filter((reason: string) => {
    return !reason.includes("isn't a known column");
  });

  return { compatible: blocking.length === 0, reasons: reasons };
};

type BuildQueryJsonFunction = (
  value: Dictionary<DictionaryEntryValue>,
  mode: ModelColumnEditorMode,
) => string;

/**
 * The rows, as the string stored on the workflow argument.
 *
 * Empty collapses to "" rather than "{}" so a required argument still reads as
 * empty to form validation and to the graph linter.
 *
 * In Record mode a row with no value is dropped. The record editor opens with a
 * blank row for every column a create must be given, and those rows serialize
 * to `""` — a non-empty string, which both validateRequired and
 * isEmptyArgumentValue read as "filled in". Keeping them would make an
 * untouched Create One look complete and let it save. Query mode keeps them,
 * because matching a column against "" is a real condition.
 */
export const buildColumnValueJson: BuildQueryJsonFunction = (
  value: Dictionary<DictionaryEntryValue>,
  mode: ModelColumnEditorMode,
): string => {
  const entries: JSONObject = {};

  for (const key of Object.keys(value)) {
    if (key.trim() === "") {
      continue;
    }

    if (mode === ModelColumnEditorMode.Record && value[key] === "") {
      continue;
    }

    entries[key] = value[key] as never;
  }

  if (Object.keys(entries).length === 0) {
    return "";
  }

  /*
   * The operator wrappers serialize themselves through toJSON() into
   * {_type, value}, which is exactly what the server rehydrates with
   * JSONFunctions.deserialize.
   */
  return JSON.stringify(entries);
};

const ModelColumnEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isQuery: boolean = props.mode === ModelColumnEditorMode.Query;

  /*
   * A query names columns to filter on, so it wants the read gate. A record
   * names columns to write, and the two lists genuinely differ: a write-only
   * column (MonitorSecret.secretValue declares `read: []`) is absent from the
   * read list, and asking for it under the read gate would leave the one column
   * Create One Monitor Secret exists to write out of its own editor.
   */
  const access: ModelSchemaAccess = isQuery ? "read" : "write";

  const schema: ModelSchemaState = useModelSchema(props.tableName, access);

  const initial: ParsedQuery = useMemo(() => {
    return normalizeInitialValue(props.initialValue);
  }, []);

  const [jsonText, setJsonText] = useState<string>(initial.text);
  const [viewMode, setViewMode] = useState<ViewMode>("builder");

  /*
   * The rows are the editor's own state, and both bodies are fully controlled
   * from here. Null until the schema resolves, because a row cannot be built
   * before it is known what kind of column it is for.
   *
   * Nothing in the seeding path calls props.onChange. That matters more than it
   * looks: this component is mounted every time someone opens a step's
   * settings, and a change fired during mount would rewrite the stored bytes of
   * every workflow just for being looked at.
   */
  const [rows, setRows] = useState<Array<ModelColumnRow> | null>(null);

  /*
   * Why the switch back from JSON is refused, when it is. Empty means it is
   * allowed.
   */
  const [returnToRowsBlockedBy, setReturnToRowsBlockedBy] = useState<
    Array<string>
  >([]);

  /*
   * Whether the value can be shown as rows at all. Read from the value as it
   * was loaded, deliberately: the decision has to be stable, or the editor
   * would change shape under the builder's hands as they type.
   */
  const compatibility: CompatibilityResult = useMemo(() => {
    return classifyColumnValueCompatibility(
      initial.parsed,
      schema.columns || [],
      props.mode,
      initial.hasTemplateExpressions,
    );
  }, [schema.columns, props.mode]);

  const columns: Array<ModelSchemaColumn> = schema.columns || [];

  type BuildRowsFunction = (parsed: JSONObject | null) => Array<ModelColumnRow>;

  /*
   * A create opens with a blank row for every column it must be given, so the
   * shape of the record is visible before anything is typed. Seeded rows hold
   * "" and are dropped on the way out, so an untouched Create One still reads
   * as empty to form validation and to the graph linter.
   *
   * Used by the JSON view's return trip as well as by the first load - built
   * only on the way in, those rows disappeared the first time anyone looked at
   * the JSON, and a create that had been read once no longer showed what it
   * needed.
   */
  const buildRows: BuildRowsFunction = (
    parsed: JSONObject | null,
  ): Array<ModelColumnRow> => {
    const storedRows: Array<ModelColumnRow> = rowsFromParsedValue(
      parsed,
      columns,
      props.mode,
    );

    const shouldSeed: boolean =
      !isQuery &&
      (props.recordIntent || RecordIntent.Create) === RecordIntent.Create;

    return shouldSeed ? seedRequiredRows(storedRows, columns) : storedRows;
  };

  useEffect(() => {
    if (schema.isLoading || rows !== null) {
      return;
    }

    setRows(buildRows(initial.parsed));
  }, [schema.isLoading, schema.columns]);

  if (schema.isLoading || rows === null) {
    return <ComponentLoader />;
  }

  const isLockedToJson: boolean = !compatibility.compatible;
  const effectiveMode: ViewMode = isLockedToJson ? "json" : viewMode;

  type OnJsonChangeFunction = (value: string) => void;

  const onJsonChange: OnJsonChangeFunction = (value: string): void => {
    setJsonText(value);
    /*
     * Any block on returning to rows was about the previous text, so it is
     * re-decided when the switch is next attempted rather than left standing.
     */
    setReturnToRowsBlockedBy([]);
    props.onChange(value);
  };

  type OnRowsChangeFunction = (value: Array<ModelColumnRow>) => void;

  const onRowsChange: OnRowsChangeFunction = (
    value: Array<ModelColumnRow>,
  ): void => {
    setRows(value);

    const asJson: string = serializeColumnRows(value, columns, props.mode);
    setJsonText(asJson);
    props.onChange(asJson);
  };

  type ShowJsonFunction = () => void;

  const showJson: ShowJsonFunction = (): void => {
    /*
     * What is shown is what is stored. Handing the code editor the text the
     * argument held before the rows were edited would be the same data loss as
     * the other direction, one step later.
     */
    setJsonText(serializeColumnRows(rows, columns, props.mode));
    setViewMode("json");
  };

  type ShowRowsFunction = () => void;

  const showRows: ShowRowsFunction = (): void => {
    /*
     * The JSON is re-read here, which is the fix for a real bug: the rows used
     * to be seeded once and never again, so editing as JSON, adding a key and
     * switching back silently dropped the key, and the next keystroke in any
     * row overwrote the argument with the pre-edit content.
     */
    const edited: ParsedQuery = normalizeInitialValue(jsonText);
    const editedCompatibility: CompatibilityResult =
      classifyColumnValueCompatibility(
        edited.parsed,
        columns,
        props.mode,
        edited.hasTemplateExpressions,
      );

    if (!editedCompatibility.compatible) {
      // Refused rather than silently losing the edit.
      setReturnToRowsBlockedBy(editedCompatibility.reasons);
      return;
    }

    setReturnToRowsBlockedBy([]);
    setRows(buildRows(edited.parsed));
    setViewMode("builder");
  };

  const filledRowCount: number = rows.filter((row: ModelColumnRow) => {
    if (row.columnId === "") {
      return false;
    }

    /*
     * "is set" and "is not set" carry no value by design, so counting only rows
     * that hold one reported a query with three real conditions as having none.
     */
    if (isQuery && getOperatorOption(row.operator).hidesValueInput) {
      return true;
    }

    return row.text !== "" || row.values.length > 0;
  }).length;

  /*
   * Recomputed from the rows on screen rather than from the value as it was
   * loaded, so fixing the column name that caused the warning also clears it.
   * Read from the frozen initial value, the "id isn't a known column" note
   * stayed up after the builder had corrected it to "_id", which reads as the
   * editor not having noticed.
   *
   * Only the non-blocking half is live. Whether the value can be rows at all is
   * decided once, above.
   */
  const unknownColumnWarnings: Array<string> = columns.length
    ? rows
        .filter((row: ModelColumnRow) => {
          return row.columnId !== "" && !findColumn(columns, row.columnId);
        })
        .map((row: ModelColumnRow) => {
          return `"${row.columnId}" isn't a known column on this model.`;
        })
    : [];

  const emptyRequiredCount: number = isQuery
    ? 0
    : requiredWritableColumns(columns).filter((column: ModelSchemaColumn) => {
        return rows.some((row: ModelColumnRow) => {
          return row.columnId === column.id && row.text === "";
        });
      }).length;

  const noun: string = isQuery ? "condition" : "field";

  return (
    <div>
      {schema.error && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 px-3 py-2.5">
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500"
          />
          <p className="text-sm text-red-700">
            Couldn&apos;t load this model&apos;s columns ({schema.error}). You
            can still write {isQuery ? "the query" : "these fields"} as JSON.
          </p>
        </div>
      )}

      {isLockedToJson && compatibility.reasons.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <p className="text-sm text-amber-800">Editing as JSON, because:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-700">
            {compatibility.reasons.map((reason: string, i: number) => {
              return <li key={i}>{reason}</li>;
            })}
          </ul>
        </div>
      )}

      {!isLockedToJson && unknownColumnWarnings.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <ul className="list-disc pl-5 text-sm text-amber-700">
            {unknownColumnWarnings.map((reason: string, i: number) => {
              return <li key={i}>{reason}</li>;
            })}
          </ul>
        </div>
      )}

      {returnToRowsBlockedBy.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <p className="text-sm text-amber-800">
            This can&apos;t go back to {isQuery ? "conditions" : "fields"},
            because:
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-700">
            {returnToRowsBlockedBy.map((reason: string, i: number) => {
              return <li key={i}>{reason}</li>;
            })}
          </ul>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {effectiveMode === "builder" ? (
            <>
              {filledRowCount} {noun}
              {filledRowCount === 1 ? "" : "s"} set
              {emptyRequiredCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  · {emptyRequiredCount} required field
                  {emptyRequiredCount === 1 ? "" : "s"} still empty
                </span>
              )}
            </>
          ) : (
            <>Editing the raw JSON this step will send.</>
          )}
        </p>

        {!isLockedToJson && (
          <button
            type="button"
            data-testid="model-column-json-toggle"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onClick={() => {
              if (effectiveMode === "builder") {
                showJson();
                return;
              }

              showRows();
            }}
          >
            <Icon
              icon={
                effectiveMode === "builder"
                  ? IconProp.Code
                  : IconProp.ListBullet
              }
              className="h-3.5 w-3.5 text-gray-500"
            />
            {effectiveMode === "builder"
              ? "Edit as JSON"
              : isQuery
                ? "Back to conditions"
                : "Back to fields"}
          </button>
        )}
      </div>

      {effectiveMode === "builder" ? (
        isQuery ? (
          <ModelQueryBuilder
            rows={rows}
            columns={columns}
            suggestions={props.valueSuggestions}
            onChange={onRowsChange}
          />
        ) : (
          <ModelRecordForm
            rows={rows}
            columns={columns}
            suggestions={props.valueSuggestions}
            onChange={onRowsChange}
          />
        )
      ) : (
        <CodeEditor
          type={CodeType.JSON}
          tabIndex={props.tabIndex}
          error={props.error}
          initialValue={initial.text}
          value={jsonText}
          placeholder={props.placeholder}
          onChange={onJsonChange}
        />
      )}

      {props.error && effectiveMode === "builder" && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}
    </div>
  );
};

export default ModelColumnEditor;
