/*
 * A row-based editor for the two workflow arguments that are keyed on a
 * model's columns: the Query that picks which records a component acts on,
 * and the record of values a create/update writes.
 *
 * Both were bare JSON editors, with the column names — and, for a query, the
 * operator syntax — left entirely to memory. The description on those
 * arguments had to carry a hint about "_id" versus "id" precisely because
 * nothing else told the builder what the columns were called.
 *
 * Everything needed to do better already existed: /model-schema/:tableName
 * knows the columns, and DictionaryForm's operator mode emits exactly the
 * {_type, value} shape that JSONFunctions.deserialize hydrates on the server
 * (FindManyBaseModel and friends). This wires the two together, and keeps a
 * JSON escape hatch for the values rows cannot express.
 */

import CodeEditor from "../CodeEditor/CodeEditor";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import DictionaryForm, { ValueType } from "../Dictionary/Dictionary";
import { DictionaryEntryValue } from "../Dictionary/DictionaryFilterOperator";
import Icon from "../Icon/Icon";
import {
  ModelSchemaAccess,
  ModelSchemaColumn,
  ModelSchemaState,
  findColumn,
  requiredWritableColumns,
  useModelSchema,
} from "./ModelSchema";
import CodeType from "../../../Types/Code/CodeType";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import { maskTemplateExpressions } from "../../../Types/Workflow/TemplateSyntax";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export enum ModelColumnEditorMode {
  /** Conditions that select records: column, operator, value. */
  Query = "Query",
  /** Values to write: column, value. No operators — you cannot save a ">". */
  Record = "Record",
}

export interface ComponentProps {
  tableName: string;
  mode: ModelColumnEditorMode;
  initialValue?: string | JSONObject | null | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
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
   * The row editor is uncontrolled after mount (DictionaryForm seeds itself
   * once), so this is computed rather than held in state. It only has to be
   * right on the render that first mounts DictionaryForm, which is the first
   * render after the schema resolves — the loader below returns early until
   * then.
   *
   * Record mode opens with a blank row for every column a create must be given
   * a value for. Seeding is additive and never overwrites what was stored, and
   * blank rows are dropped on the way back out (buildColumnValueJson), so
   * opening a saved workflow and saving it again cannot change what it does.
   */
  const initialRows: Dictionary<DictionaryEntryValue> = useMemo(() => {
    const stored: Dictionary<DictionaryEntryValue> = (initial.parsed ||
      {}) as Dictionary<DictionaryEntryValue>;

    if (isQuery || !schema.columns) {
      return stored;
    }

    const seeded: Dictionary<DictionaryEntryValue> = { ...stored };

    for (const column of requiredWritableColumns(schema.columns)) {
      if (seeded[column.id] === undefined) {
        seeded[column.id] = "";
      }
    }

    return seeded;
  }, [schema.columns, isQuery]);

  /*
   * The model's own example for each column, shown in the row it belongs to.
   * MonitorSecret.secretValue ships example: "sk_test_1234567890abcdefghijklmnop",
   * which answers "what goes in this box" better than any prose in the sidebar.
   */
  const valuePlaceholders: Dictionary<string> = useMemo(() => {
    const placeholders: Dictionary<string> = {};

    for (const column of schema.columns || []) {
      const hint: string | undefined = column.example || column.placeholder;

      if (hint) {
        placeholders[column.id] = hint;
      }
    }

    return placeholders;
  }, [schema.columns]);

  const compatibility: CompatibilityResult = useMemo(() => {
    return classifyColumnValueCompatibility(
      initial.parsed,
      schema.columns || [],
      props.mode,
      initial.hasTemplateExpressions,
    );
  }, [schema.columns, props.mode]);

  const columnKeys: Array<string> = useMemo(() => {
    return (schema.columns || []).map((column: ModelSchemaColumn) => {
      return column.id;
    });
  }, [schema.columns]);

  if (schema.isLoading) {
    return <ComponentLoader />;
  }

  const isLockedToJson: boolean = !compatibility.compatible;
  const effectiveMode: ViewMode = isLockedToJson ? "json" : viewMode;

  type OnJsonChangeFunction = (value: string) => void;

  const onJsonChange: OnJsonChangeFunction = (value: string): void => {
    setJsonText(value);
    props.onChange(value);
  };

  type OnRowsChangeFunction = (value: Dictionary<DictionaryEntryValue>) => void;

  const onRowsChange: OnRowsChangeFunction = (
    value: Dictionary<DictionaryEntryValue>,
  ): void => {
    const asJson: string = buildColumnValueJson(value, props.mode);
    setJsonText(asJson);
    props.onChange(asJson);
  };

  return (
    <div>
      {schema.error && (
        <p className="text-sm text-amber-600 mb-2">
          Couldn&apos;t load this model&apos;s columns ({schema.error}). You can
          still write {isQuery ? "the query" : "these fields"} as JSON.
        </p>
      )}

      {isLockedToJson && compatibility.reasons.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">Editing as JSON, because:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-700">
            {compatibility.reasons.map((reason: string, i: number) => {
              return <li key={i}>{reason}</li>;
            })}
          </ul>
        </div>
      )}

      {!isLockedToJson && compatibility.reasons.length > 0 && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <ul className="list-disc pl-5 text-sm text-amber-700">
            {compatibility.reasons.map((reason: string, i: number) => {
              return <li key={i}>{reason}</li>;
            })}
          </ul>
        </div>
      )}

      {effectiveMode === "builder" ? (
        <DictionaryForm
          keys={columnKeys}
          enableOperators={isQuery}
          valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
          addButtonSuffix={isQuery ? "condition" : "field"}
          keyPlaceholder="Column"
          valuePlaceholder="Value"
          valuePlaceholders={valuePlaceholders}
          defaultValueSuggestions={props.valueSuggestions}
          initialValue={initialRows}
          onChange={onRowsChange}
        />
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

      {!isLockedToJson && (
        <div className="mt-2">
          <button
            type="button"
            className="text-sm underline text-blue-500 hover:text-blue-600 cursor-pointer inline-flex items-center gap-1"
            onClick={() => {
              setViewMode(effectiveMode === "builder" ? "json" : "builder");
            }}
          >
            <Icon icon={IconProp.Code} className="h-3.5 w-3.5" />
            {effectiveMode === "builder"
              ? "Edit as JSON"
              : isQuery
                ? "Back to conditions"
                : "Back to fields"}
          </button>
        </div>
      )}

      {props.error && effectiveMode === "builder" && (
        <p className="mt-1 text-sm text-red-400">{props.error}</p>
      )}
    </div>
  );
};

export default ModelColumnEditor;
