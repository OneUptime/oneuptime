import JSONArgumentInput from "./JSONArgumentInput";
import { KeyValueRow, parseKeyValue, serializeKeyValue } from "./KeyValueUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * Edit a StringDictionary argument (HTTP headers, query params, …) as
 * key/value rows instead of hand-written JSON — far harder to get wrong. The
 * value stays a JSON string (see KeyValueUtils), so storage/execution are
 * unchanged. An "Edit as JSON" escape covers values that aren't simple pairs.
 */

interface Row extends KeyValueRow {
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

const KeyValueInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idRef: React.MutableRefObject<number> = useRef<number>(0);

  type MakeRowFunction = (key: string, value: string) => Row;
  const makeRow: MakeRowFunction = (key: string, value: string): Row => {
    idRef.current += 1;
    return { id: idRef.current, key: key, value: value };
  };

  const parsedInitial: Array<KeyValueRow> | null = parseKeyValue(props.value);

  const [rows, setRows] = useState<Array<Row>>(() => {
    return (parsedInitial || []).map((r: KeyValueRow) => {
      return makeRow(r.key, r.value);
    });
  });
  const [mode, setMode] = useState<"fields" | "json">(
    parsedInitial === null ? "json" : "fields",
  );

  type CommitFunction = (nextRows: Array<Row>) => void;
  const commit: CommitFunction = (nextRows: Array<Row>): void => {
    setRows(nextRows);
    props.onChange(serializeKeyValue(nextRows));
    // Rows always serialize to valid JSON.
    props.onValidationChange?.(false);
  };

  if (mode === "json") {
    const canSwitchToFields: boolean = parseKeyValue(props.value) !== null;
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
              ? "Show as key/value fields"
              : "Can't show as fields while the JSON is invalid or nested."
          }
          onClick={() => {
            const parsed: Array<KeyValueRow> | null = parseKeyValue(
              props.value,
            );
            if (!parsed) {
              return;
            }
            setRows(
              parsed.map((r: KeyValueRow) => {
                return makeRow(r.key, r.value);
              }),
            );
            setMode("fields");
            props.onValidationChange?.(false);
          }}
        >
          Switch to fields
        </button>
      </div>
    );
  }

  return (
    <div>
      {rows.length === 0 && (
        <p className="mb-2 text-sm text-gray-400">No entries yet.</p>
      )}

      <div className="space-y-2">
        {rows.map((row: Row) => {
          return (
            <div key={row.id} className="flex items-center gap-2">
              <input
                className={inputClass}
                placeholder="Key"
                aria-label="Key"
                value={row.key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  commit(
                    rows.map((r: Row) => {
                      return r.id === row.id
                        ? { ...r, key: e.target.value }
                        : r;
                    }),
                  );
                }}
              />
              <input
                className={inputClass}
                placeholder="Value"
                aria-label="Value"
                value={row.value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  commit(
                    rows.map((r: Row) => {
                      return r.id === row.id
                        ? { ...r, value: e.target.value }
                        : r;
                    }),
                  );
                }}
              />
              <button
                type="button"
                aria-label="Remove row"
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
            setRows([...rows, makeRow("", "")]);
          }}
        >
          + Add
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

export default KeyValueInput;
