import {
  CODE_TASK_CONTEXT_KINDS,
  CodeTaskContextKindCopy,
} from "./CodeTaskCopy";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CODE_TASK_LIMITS,
  CODE_TASK_LOG_WINDOWS_IN_HOURS,
  CodeTaskContextInput,
  CodeTaskContextInputUtil,
  CodeTaskContextType,
  DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
} from "Common/Types/AI/CodeTask";
import Exception from "Common/Types/Exception/Exception";
import { DropdownValue } from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import Modal from "Common/UI/Components/Modal/Modal";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A piece of context a person is adding to a request, before it is sent:
 * what goes to the server, and what its chip says meanwhile.
 */
export interface CodeContextDraft {
  input: CodeTaskContextInput;
  label: string;
}

// The record pickers: which model, and the column each option is named by.
interface RecordPicker {
  modelType: DatabaseBaseModelType;
  labelField: string;
  placeholder: string;
}

const RECORD_PICKERS: Partial<Record<CodeTaskContextType, RecordPicker>> = {
  [CodeTaskContextType.Incident]: {
    modelType: Incident,
    labelField: "title",
    placeholder: translationKey("Search incidents by title"),
  },
  [CodeTaskContextType.Alert]: {
    modelType: Alert,
    labelField: "title",
    placeholder: translationKey("Search alerts by title"),
  },
  [CodeTaskContextType.Exception]: {
    modelType: TelemetryException,
    labelField: "message",
    placeholder: translationKey("Search exceptions by message"),
  },
  [CodeTaskContextType.Monitor]: {
    modelType: Monitor,
    labelField: "name",
    placeholder: translationKey("Search monitors by name"),
  },
};

// What each kind's dialog says it is for.
const KIND_DESCRIPTIONS: Record<CodeTaskContextType, string> = {
  [CodeTaskContextType.File]: translationKey(
    "A file or folder in this repository. AI reads it first.",
  ),
  [CodeTaskContextType.Note]: translationKey(
    "Text AI should know: an error, a spec, a log line.",
  ),
  [CodeTaskContextType.Link]: translationKey(
    "A web address, given to AI as a reference.",
  ),
  [CodeTaskContextType.Incident]: translationKey(
    "AI reads the incident as it is now: its state, description and root cause.",
  ),
  [CodeTaskContextType.Alert]: translationKey(
    "AI reads the alert as it is now: its state, description and root cause.",
  ),
  [CodeTaskContextType.Exception]: translationKey(
    "AI reads the exception's message and stack trace.",
  ),
  [CodeTaskContextType.Monitor]: translationKey(
    "AI reads the monitor's type, status and description.",
  ),
  [CodeTaskContextType.Trace]: translationKey(
    "AI reads the trace's spans: their names, timings and errors.",
  ),
  [CodeTaskContextType.Logs]: translationKey(
    "AI reads the latest log lines that contain your search.",
  ),
};

const LOG_WINDOW_LABELS: Record<number, string> = {
  1: translationKey("Last hour"),
  24: translationKey("Last day"),
  168: translationKey("Last week"),
};

const INPUT_CLASS_NAME: string =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const LABEL_CLASS_NAME: string = "block text-sm font-medium text-gray-700";

export interface ComponentProps {
  kind: CodeTaskContextType;
  onAdd: (draft: CodeContextDraft) => void;
  onClose: () => void;
}

/*
 * Adding one piece of context to a request: one small dialog per kind,
 * asking only what that kind needs - a path, a note, an address, or a
 * OneUptime record picked by name. What the person picks is checked with
 * the server's own rules (CodeTaskContextInputUtil) before it is added, so
 * a mistyped path or trace ID is said here, not after sending.
 */
const CodeContextModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: CodeTaskContextKindCopy = CODE_TASK_CONTEXT_KINDS[props.kind];
  const picker: RecordPicker | undefined = RECORD_PICKERS[props.kind];

  const [text, setText] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [recordId, setRecordId] = useState<string>("");
  const [recordLabel, setRecordLabel] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [hours, setHours] = useState<number>(
    DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
  );
  const [error, setError] = useState<string | null>(null);

  const buildRaw: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    switch (props.kind) {
      case CodeTaskContextType.File:
        return { type: props.kind, path: text };
      case CodeTaskContextType.Note:
        return { type: props.kind, text: text };
      case CodeTaskContextType.Link:
        return { type: props.kind, url: text, title: title };
      case CodeTaskContextType.Trace:
        return { type: props.kind, traceId: text };
      case CodeTaskContextType.Logs:
        return {
          type: props.kind,
          search: text,
          hours: hours,
          ...(serviceId ? { serviceId: serviceId } : {}),
        };
      default:
        return { type: props.kind, id: recordId };
    }
  };

  const describe: (input: CodeTaskContextInput) => string = (
    input: CodeTaskContextInput,
  ): string => {
    switch (input.type) {
      case CodeTaskContextType.File:
        return input.path || "";
      case CodeTaskContextType.Note:
        return (input.text || "").split(/\s+/).join(" ").substring(0, 60);
      case CodeTaskContextType.Link:
        return input.title || input.url || "";
      case CodeTaskContextType.Trace:
        return translator.translateTemplate("Trace {{traceId}}", {
          traceId: `${(input.traceId || "").substring(0, 8)}…`,
        });
      case CodeTaskContextType.Logs:
        return translator.translateTemplate('Logs matching "{{search}}"', {
          search: input.search || "",
        });
      default:
        return recordLabel || translator.translateTemplate(kind.label);
    }
  };

  const add: () => void = (): void => {
    try {
      const input: CodeTaskContextInput =
        CodeTaskContextInputUtil.readItem(buildRaw());

      props.onAdd({ input, label: describe(input) });
    } catch (err) {
      setError(
        err instanceof Exception || err instanceof Error
          ? err.message
          : String(err),
      );
    }
  };

  const isEmpty: boolean = picker ? !recordId : !text.trim();

  return (
    <Modal
      title={kind.addTitle}
      description={KIND_DESCRIPTIONS[props.kind]}
      submitButtonText="Add"
      disableSubmitButton={isEmpty}
      onSubmit={add}
      onClose={props.onClose}
      error={error || undefined}
    >
      <div className="space-y-4" data-testid="code-context-modal">
        {picker ? (
          <EntityDropdown
            modelType={picker.modelType}
            labelField={picker.labelField}
            valueField="_id"
            placeholder={translator.translateText(picker.placeholder)}
            ariaLabel={translator.translateText(kind.label)}
            dataTestId="code-context-record"
            value={recordId || null}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
              change: DropdownChange,
            ) => {
              setError(null);
              setRecordId(value ? value.toString() : "");
              setRecordLabel(change.selectedOptions[0]?.label || "");
            }}
          />
        ) : (
          <></>
        )}

        {props.kind === CodeTaskContextType.File ? (
          <div>
            <label htmlFor="code-context-path" className={LABEL_CLASS_NAME}>
              {translator.translateText("Path in the repository")}
            </label>
            <input
              id="code-context-path"
              data-testid="code-context-path"
              autoFocus={true}
              className={`${INPUT_CLASS_NAME} mt-1 font-mono`}
              placeholder="src/api/users.ts"
              maxLength={CODE_TASK_LIMITS.maxPathLength}
              value={text}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setError(null);
                setText(event.target.value);
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {props.kind === CodeTaskContextType.Note ? (
          <div>
            <label htmlFor="code-context-note" className={LABEL_CLASS_NAME}>
              {translator.translateText("Note")}
            </label>
            <textarea
              id="code-context-note"
              data-testid="code-context-note"
              autoFocus={true}
              rows={6}
              className={`${INPUT_CLASS_NAME} mt-1`}
              maxLength={CODE_TASK_LIMITS.maxNoteLength}
              value={text}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                setError(null);
                setText(event.target.value);
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {props.kind === CodeTaskContextType.Link ? (
          <>
            <div>
              <label htmlFor="code-context-url" className={LABEL_CLASS_NAME}>
                {translator.translateText("Web address")}
              </label>
              <input
                id="code-context-url"
                data-testid="code-context-url"
                type="url"
                autoFocus={true}
                className={`${INPUT_CLASS_NAME} mt-1`}
                placeholder="https://"
                maxLength={CODE_TASK_LIMITS.maxLinkLength}
                value={text}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setError(null);
                  setText(event.target.value);
                }}
              />
            </div>
            <div>
              <label
                htmlFor="code-context-link-title"
                className={LABEL_CLASS_NAME}
              >
                {translator.translateText("Name (optional)")}
              </label>
              <input
                id="code-context-link-title"
                data-testid="code-context-link-title"
                className={`${INPUT_CLASS_NAME} mt-1`}
                maxLength={CODE_TASK_LIMITS.maxLinkTitleLength}
                value={title}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setTitle(event.target.value);
                }}
              />
            </div>
          </>
        ) : (
          <></>
        )}

        {props.kind === CodeTaskContextType.Trace ? (
          <div>
            <label htmlFor="code-context-trace" className={LABEL_CLASS_NAME}>
              {translator.translateText("Trace ID")}
            </label>
            <input
              id="code-context-trace"
              data-testid="code-context-trace"
              autoFocus={true}
              className={`${INPUT_CLASS_NAME} mt-1 font-mono`}
              placeholder="4bf92f3577b34da6a3ce929d0e0e4736"
              maxLength={64}
              value={text}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setError(null);
                setText(event.target.value);
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {props.kind === CodeTaskContextType.Logs ? (
          <>
            <div>
              <label htmlFor="code-context-logs" className={LABEL_CLASS_NAME}>
                {translator.translateText("Log lines that contain")}
              </label>
              <input
                id="code-context-logs"
                data-testid="code-context-logs"
                autoFocus={true}
                className={`${INPUT_CLASS_NAME} mt-1`}
                maxLength={CODE_TASK_LIMITS.maxLogSearchLength}
                value={text}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setError(null);
                  setText(event.target.value);
                }}
              />
            </div>
            <div>
              <span className={LABEL_CLASS_NAME}>
                {translator.translateText("Service (optional)")}
              </span>
              <div className="mt-1">
                <EntityDropdown
                  modelType={Service}
                  labelField="name"
                  valueField="_id"
                  placeholder={translator.translateText("Any service")}
                  ariaLabel={translator.translateText("Service (optional)")}
                  dataTestId="code-context-logs-service"
                  value={serviceId || null}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setServiceId(value ? value.toString() : "");
                  }}
                />
              </div>
            </div>
            <fieldset>
              <legend className={LABEL_CLASS_NAME}>
                {translator.translateText("Time range")}
              </legend>
              <div className="mt-2 inline-flex rounded-lg bg-gray-100 p-0.5">
                {CODE_TASK_LOG_WINDOWS_IN_HOURS.map((windowInHours: number) => {
                  const isPicked: boolean = windowInHours === hours;

                  return (
                    <button
                      key={windowInHours}
                      type="button"
                      aria-pressed={isPicked}
                      data-testid={`code-context-logs-window-${windowInHours}`}
                      onClick={() => {
                        setHours(windowInHours);
                      }}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        isPicked
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {translator.translateText(
                        LOG_WINDOW_LABELS[windowInHours] || "",
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CodeContextModal;
