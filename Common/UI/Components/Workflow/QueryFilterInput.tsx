import JSONArgumentInput from "./JSONArgumentInput";
import {
  QueryFieldType,
  QueryFilterRow,
  parseQuery,
  serializeQuery,
} from "./QueryFilterUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * Edit a database Query argument as "field = value" rows (with an explicit
 * type per row) instead of hand-written JSON. See QueryFilterUtils for the
 * byte-safe serialization. An "Edit as JSON" escape covers operator/complex
 * queries, and the editor starts in JSON mode automatically when the value
 * isn't a flat equality query.
 */

interface Row extends QueryFilterRow {
  id: number;
}

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  onValidationChange?: ((isInvalid: boolean) => void) | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
}

const inputClass: string =
  "block w-full rounded-md border border-gray-300 py-2 px-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const selectClass: string =
  "rounded-md border border-gray-300 py-2 px-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const TYPE_OPTIONS: Array<{ label: string; value: QueryFieldType }> = [
  { label: "Text", value: "text" },
  { label: "Number", value: "number" },
  { label: "True / False", value: "boolean" },
];

const QueryFilterInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idRef: React.MutableRefObject<number> = useRef<number>(0);

  type MakeRowFunction = (row: QueryFilterRow) => Row;
  const makeRow: MakeRowFunction = (row: QueryFilterRow): Row => {
    idRef.current += 1;
    return { id: idRef.current, ...row };
  };

  const parsedInitial: Array<QueryFilterRow> | null = parseQuery(props.value);

  const [rows, setRows] = useState<Array<Row>>(() => {
    return (parsedInitial || []).map(makeRow);
  });
  const [mode, setMode] = useState<"fields" | "json">(
    parsedInitial === null ? "json" : "fields",
  );

  type CommitFunction = (nextRows: Array<Row>) => void;
  const commit: CommitFunction = (nextRows: Array<Row>): void => {
    setRows(nextRows);
    props.onChange(serializeQuery(nextRows));
    props.onValidationChange?.(false);
  };

  if (mode === "json") {
    const canSwitchToFields: boolean = parseQuery(props.value) !== null;
    return (
      <div>
        <JSONArgumentInput
          value={props.value}
          placeholder={props.placeholder}
          error={props.error}
          onChange={(value: string) => {
            props.onChange(value);
          }}
          onValidationChange={props.onValidationChange}
        />
        <button
          type="button"
          disabled={!canSwitchToFields}
          className={
            canSwitchToFields
              ? "mt-1 text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
              : "mt-1 text-xs font-medium text-gray-300 cursor-not-allowed"
          }
          title={
            canSwitchToFields
              ? "Show as filter fields"
              : "Can't show as fields while the query uses operators or is invalid."
          }
          onClick={() => {
            const parsed: Array<QueryFilterRow> | null = parseQuery(
              props.value,
            );
            if (!parsed) {
              return;
            }
            setRows(parsed.map(makeRow));
            setMode("fields");
            props.onValidationChange?.(false);
          }}
        >
          Switch to fields
        </button>
      </div>
    );
  }

  type UpdateRowFunction = (id: number, patch: Partial<QueryFilterRow>) => void;
  const updateRow: UpdateRowFunction = (
    id: number,
    patch: Partial<QueryFilterRow>,
  ): void => {
    commit(
      rows.map((r: Row) => {
        return r.id === id ? { ...r, ...patch } : r;
      }),
    );
  };

  return (
    <div>
      {rows.length === 0 && (
        <p className="mb-2 text-sm text-gray-400">No filters yet.</p>
      )}

      <div className="space-y-2">
        {rows.map((row: Row) => {
          return (
            <div key={row.id} className="flex items-center gap-2">
              <input
                className={inputClass}
                placeholder="Field"
                aria-label="Field"
                value={row.field}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  updateRow(row.id, { field: e.target.value });
                }}
              />
              <span className="text-sm text-gray-400">=</span>
              <input
                className={inputClass}
                placeholder="Value"
                aria-label="Value"
                value={row.value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  updateRow(row.id, { value: e.target.value });
                }}
              />
              <select
                className={selectClass}
                aria-label="Field value type"
                value={row.type}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  updateRow(row.id, {
                    type: e.target.value as QueryFieldType,
                  });
                }}
              >
                {TYPE_OPTIONS.map(
                  (option: { label: string; value: QueryFieldType }) => {
                    return (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    );
                  },
                )}
              </select>
              <button
                type="button"
                aria-label="Remove filter"
                className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
                onClick={() => {
                  commit(
                    rows.filter((r: Row) => {
                      return r.id !== row.id;
                    }),
                  );
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
          onClick={() => {
            setRows([...rows, makeRow({ field: "", type: "text", value: "" })]);
          }}
        >
          + Add filter
        </button>
        <button
          type="button"
          className="text-xs font-medium text-gray-400 hover:text-gray-600 cursor-pointer"
          onClick={() => {
            setMode("json");
          }}
        >
          Edit as JSON
        </button>
      </div>
    </div>
  );
};

export default QueryFilterInput;
