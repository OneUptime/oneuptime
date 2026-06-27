import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CodeType from "Common/Types/Code/CodeType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useState } from "react";

export type ConsoleDatastore = "postgres" | "clickhouse" | "redis";

/*
 * Per-datastore console state. The parent page owns one of these for each tab
 * so the draft query, the write toggle and the last result survive switching
 * between tabs (each tab's CodeEditor unmounts when it is not the active tab).
 */
export interface ConsoleState {
  query: string;
  allowWrite: boolean;
  isRunning: boolean;
  result: JSONObject | null;
  error: string;
}

export const emptyConsoleState: () => ConsoleState = (): ConsoleState => {
  return {
    query: "",
    allowWrite: false,
    isRunning: false,
    result: null,
    error: "",
  };
};

export interface ConsoleExample {
  label: string;
  query: string;
}

export interface ComponentProps {
  datastore: ConsoleDatastore;
  title: string;
  description: string;
  codeType: CodeType;
  editorPlaceholder: string;
  examples: Array<ConsoleExample>;
  state: ConsoleState;
  onStateChange: (patch: Partial<ConsoleState>) => void;
}

// Render one result cell. Objects/arrays are shown as compact JSON; null is muted.
const renderCell: (value: JSONValue) => ReactElement = (
  value: JSONValue,
): ReactElement => {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 italic">NULL</span>;
  }

  if (typeof value === "object") {
    return <span>{JSON.stringify(value)}</span>;
  }

  return <span>{String(value)}</span>;
};

const QueryConsole: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { state } = props;
  const [showWriteConfirm, setShowWriteConfirm] = useState<boolean>(false);

  const runQuery: () => Promise<void> = async (): Promise<void> => {
    const trimmed: string = state.query.trim();
    if (!trimmed) {
      props.onStateChange({ error: "Query cannot be empty." });
      return;
    }

    props.onStateChange({ isRunning: true, error: "" });

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/query",
          ),
          data: {
            datastore: props.datastore,
            query: trimmed,
            allowWrite: state.allowWrite,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      props.onStateChange({
        result: response.data,
        isRunning: false,
        error: "",
      });
    } catch (err) {
      props.onStateChange({
        error: API.getFriendlyMessage(err),
        isRunning: false,
        result: null,
      });
    }
  };

  const onRunClick: () => void = (): void => {
    if (!state.query.trim()) {
      props.onStateChange({ error: "Query cannot be empty." });
      return;
    }

    // Write mode is dangerous — always confirm before executing.
    if (state.allowWrite) {
      setShowWriteConfirm(true);
      return;
    }

    runQuery().catch(() => {
      // handled via onStateChange/setError
    });
  };

  const renderResult: () => ReactElement = (): ReactElement => {
    if (state.isRunning) {
      return <ComponentLoader />;
    }

    if (!state.result) {
      return (
        <div className="text-sm text-gray-500">
          Run a query to see results here.
        </div>
      );
    }

    const result: JSONObject = state.result;
    const datastore: string = String(result["datastore"] || props.datastore);
    const durationMs: number | null =
      typeof result["durationMs"] === "number"
        ? (result["durationMs"] as number)
        : null;
    const rowCount: number | null =
      typeof result["rowCount"] === "number"
        ? (result["rowCount"] as number)
        : null;
    const truncated: boolean = result["truncated"] === true;
    const message: string | null =
      typeof result["message"] === "string"
        ? (result["message"] as string)
        : null;

    const statsLine: ReactElement = (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
        {rowCount !== null ? (
          <span className="tabular-nums">
            {rowCount} row{rowCount === 1 ? "" : "s"}
          </span>
        ) : (
          <></>
        )}
        {durationMs !== null ? (
          <span className="tabular-nums">{durationMs} ms</span>
        ) : (
          <></>
        )}
        {truncated ? (
          <span className="text-amber-600">
            Results truncated to the first {rowCount} rows.
          </span>
        ) : (
          <></>
        )}
      </div>
    );

    // Redis: render the raw reply (which may legitimately be null / nil).
    if (datastore === "redis") {
      const redisResult: JSONValue = (result["redisResult"] ??
        null) as JSONValue;
      const command: string = String(result["command"] || "");

      return (
        <div>
          {statsLine}
          {command ? (
            <div className="text-xs text-gray-500 mb-1">
              Reply to{" "}
              <span className="font-mono text-gray-700">{command}</span>
            </div>
          ) : (
            <></>
          )}
          <pre className="bg-gray-50 border border-gray-200 rounded-md p-3 text-xs text-gray-800 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
            {redisResult === null
              ? "(nil)"
              : JSON.stringify(redisResult, null, 2)}
          </pre>
        </div>
      );
    }

    const columns: Array<string> = (result["columns"] || []) as Array<string>;
    const rows: Array<Array<JSONValue>> = (result["rows"] || []) as Array<
      Array<JSONValue>
    >;

    if (columns.length > 0) {
      return (
        <div>
          {statsLine}
          <div className="overflow-auto max-h-[60vh] border border-gray-200 rounded-md">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {columns.map(
                    (column: string, index: number): ReactElement => {
                      return (
                        <th
                          key={index}
                          className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap"
                        >
                          {column}
                        </th>
                      );
                    },
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(
                  (row: Array<JSONValue>, rowIndex: number): ReactElement => {
                    return (
                      <tr
                        key={rowIndex}
                        className="even:bg-gray-50/50 hover:bg-indigo-50/40"
                      >
                        {columns.map(
                          (_column: string, colIndex: number): ReactElement => {
                            return (
                              <td
                                key={colIndex}
                                className="px-3 py-1.5 text-gray-800 border-b border-gray-100 font-mono align-top max-w-md truncate"
                              >
                                {renderCell(row[colIndex] ?? null)}
                              </td>
                            );
                          },
                        )}
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // No columns and not Redis: a statement that returned no rows (write / DDL / empty SELECT).
    return (
      <div>
        {statsLine}
        <Alert
          type={AlertType.SUCCESS}
          title={message || "Statement executed successfully."}
        />
      </div>
    );
  };

  return (
    <Card title={props.title} description={props.description}>
      <div className="space-y-4">
        {props.examples.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {props.examples.map(
              (example: ConsoleExample, index: number): ReactElement => {
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      props.onStateChange({ query: example.query });
                    }}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  >
                    {example.label}
                  </button>
                );
              },
            )}
          </div>
        ) : (
          <></>
        )}

        <CodeEditor
          type={props.codeType}
          value={state.query}
          onChange={(code: string) => {
            props.onStateChange({ query: code });
          }}
          placeholder={props.editorPlaceholder}
          showLineNumbers={true}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Toggle
            title="Allow write queries"
            description={
              state.allowWrite
                ? "Writes & DDL are enabled — be careful."
                : "Read-only. Toggle to run writes / DDL."
            }
            value={state.allowWrite}
            onChange={(value: boolean) => {
              props.onStateChange({ allowWrite: value });
            }}
          />

          <Button
            title="Run query"
            icon={IconProp.Play}
            buttonStyle={
              state.allowWrite
                ? ButtonStyleType.DANGER
                : ButtonStyleType.PRIMARY
            }
            isLoading={state.isRunning}
            disabled={state.isRunning}
            onClick={onRunClick}
          />
        </div>

        {state.error ? (
          <Alert type={AlertType.DANGER} title={state.error} />
        ) : (
          <></>
        )}

        <div className="pt-2 border-t border-gray-100">{renderResult()}</div>
      </div>

      {showWriteConfirm ? (
        <ConfirmModal
          title="Run a write query?"
          description={
            `This will run the statement against ${props.title} in WRITE mode. ` +
            "It may modify or delete data, and the change cannot be undone from here. " +
            "Make sure you know exactly what this statement does before continuing."
          }
          submitButtonText="Run write query"
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText="Cancel"
          onClose={() => {
            setShowWriteConfirm(false);
          }}
          onSubmit={() => {
            setShowWriteConfirm(false);
            runQuery().catch(() => {
              // handled via onStateChange/setError
            });
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default QueryConsole;
