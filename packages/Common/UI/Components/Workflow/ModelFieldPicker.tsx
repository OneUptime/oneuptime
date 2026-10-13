/*
 * A record step's field list, as chips: Fields to pass on (the On Create and
 * On Update triggers' and the Find steps' "select") and Fields to watch (the
 * On Update trigger's "listen-on").
 *
 * Both were "Select Fields" and "Listen on": two identical lists of 70-odd
 * checkboxes stacked in one dialog, each with a counter, a search box and
 * Select all, under names nobody uses - the maintainer's "very confusing".
 * Now each shows only what it holds, as chips, says in a line what empty
 * means, and adds fields from one searchable list grouped the way people
 * think of a record (AddFieldsPanel). Watching offers only what an update
 * can change, so a related record is watched by its ID column, the one an
 * update changes (Types/Workflow/WatchedFields).
 *
 * The stored value is the same JSON as before - {"title": true} - and a
 * value the list cannot show (a field set to something other than true, a
 * whole related record) is kept as JSON, with the reasons, so a workflow
 * keeps running unchanged. Anyone can edit it as JSON from here too.
 */

import CodeEditor from "../CodeEditor/CodeEditor";
import Icon from "../Icon/Icon";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import AddFieldsPanel from "./FieldPicker/AddFieldsPanel";
import {
  ChosenFields,
  FieldGroup,
  FieldOption,
  FieldPickerMode,
  findFieldOption,
  getFieldGroups,
  getFieldOptions,
  getStoredPaths,
  readChosenFields,
  readStoredValue,
  writeChosenFields,
} from "./FieldPicker/FieldPickerOptions";
import { ModelSchemaState, useModelSchema } from "./ModelSchema";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeType from "../../../Types/Code/CodeType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "../../../Types/Workflow/Components/BaseModel";
import {
  getDisplayColumn,
  getWorkflowModel,
} from "../../../Types/Workflow/Documentation/ModelExamples";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export { FieldPickerMode };

export const ModelFieldPickerCopy: {
  readonly addField: string;
  readonly chosenFields: string;
  readonly remove: string;
  readonly emptyWatch: string;
  readonly emptyPassOn: string;
  readonly unknownField: string;
  readonly loading: string;
  readonly couldNotLoad: string;
  readonly editAsJson: string;
  readonly backToList: string;
  readonly jsonHint: string;
  readonly keptAsJson: string;
  readonly keptAsJsonHelp: string;
  readonly startOver: string;
} = {
  addField: translationKey("Add field"),
  chosenFields: translationKey("Chosen fields"),
  remove: translationKey("Remove {{field}}"),
  emptyWatch: translationKey(
    "Every change to the {{record}} runs this workflow.",
  ),
  emptyPassOn: translationKey("Pick the fields the next steps need."),
  unknownField: translationKey(
    "There is no field called “{{key}}”, so the run leaves it out.",
  ),
  loading: translationKey("Loading the fields…"),
  couldNotLoad: translationKey(
    "Could not load the fields, so they are shown as JSON: {{error}}",
  ),
  editAsJson: translationKey("Edit as JSON"),
  backToList: translationKey("Back to the list"),
  jsonHint: translationKey(
    'Keys are the field names, such as "title". The ID is "_id".',
  ),
  keptAsJson: translationKey("Kept as JSON"),
  keptAsJsonHelp: translationKey(
    "Your workflow keeps running unchanged. Edit the JSON below, or click {{reset}} to pick the fields from the list.",
  ),
  startOver: translationKey("Start over"),
};

export interface ComponentProps {
  tableName: string;
  // Fields to pass on (the default) or Fields to watch.
  mode?: FieldPickerMode | undefined;
  initialValue?: string | JSONObject | null | undefined;
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
  // The id of the setting's label, which names the chips and the list.
  ariaLabelledby?: string | undefined;
}

const ModelFieldPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const mode: FieldPickerMode = props.mode || FieldPickerMode.PassOn;
  const testId: string =
    mode === FieldPickerMode.Watch ? "fields-to-watch" : "fields-to-pass-on";
  const label: string =
    mode === FieldPickerMode.Watch ? WATCHED_FIELDS_NAME : SELECT_FIELDS_NAME;

  const model: BaseModel | null = useMemo(() => {
    return getWorkflowModel(props.tableName);
  }, [props.tableName]);

  const recordName: string = model?.singularName || props.tableName;
  const displayColumnId: string | undefined = model
    ? getDisplayColumn(model).id
    : undefined;

  const schema: ModelSchemaState = useModelSchema(props.tableName, "read");

  // What was stored, read once: the list keeps it from then on.
  const [initialValue] = useState<unknown>(props.initialValue);

  const storedPaths: Array<string> = useMemo(() => {
    return getStoredPaths(initialValue);
  }, [initialValue]);

  const options: Array<FieldOption> = useMemo(() => {
    return getFieldOptions({
      columns: schema.columns || [],
      mode: mode,
      displayColumnId: displayColumnId,
      storedPaths: storedPaths,
    });
  }, [schema.columns, mode, displayColumnId, storedPaths]);

  const groups: Array<FieldGroup> = useMemo(() => {
    return getFieldGroups({
      options: options,
      displayColumnId: displayColumnId,
    });
  }, [options, displayColumnId]);

  const [paths, setPaths] = useState<Array<string> | null>(null);
  const [unknownPaths, setUnknownPaths] = useState<Array<string>>([]);
  const [jsonText, setJsonText] = useState<string>(() => {
    return readStoredValue(initialValue).text;
  });
  const [isJson, setIsJson] = useState<boolean>(false);
  const [problems, setProblems] = useState<Array<string>>([]);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

  const addButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const chipsRef: React.MutableRefObject<HTMLUListElement | null> =
    useRef<HTMLUListElement | null>(null);
  const focusAfterRemoveRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  type ShowChosenFunction = (chosen: ChosenFields) => void;

  const showChosen: ShowChosenFunction = (chosen: ChosenFields): void => {
    if (chosen.problems.length > 0) {
      setProblems(chosen.problems);
      setIsJson(true);
      setPaths([]);
      setUnknownPaths([]);
      return;
    }

    setProblems([]);
    setIsJson(false);
    setPaths(chosen.paths);
    setUnknownPaths(chosen.unknownPaths);
  };

  // Once the fields are known, what was stored is read as the fields it names.
  useEffect(() => {
    if (schema.isLoading || paths !== null) {
      return;
    }

    if (schema.error) {
      setIsJson(true);
      setPaths([]);
      return;
    }

    showChosen(
      readChosenFields({
        value: initialValue,
        options: options,
        mode: mode,
      }),
    );
  }, [schema.isLoading, schema.error, options]);

  // After a chip goes, the focus moves to the chip that takes its place.
  useEffect(() => {
    const index: number | null = focusAfterRemoveRef.current;

    if (index === null) {
      return;
    }

    focusAfterRemoveRef.current = null;

    const buttons: Array<HTMLButtonElement> = Array.from(
      chipsRef.current?.querySelectorAll<HTMLButtonElement>(
        `[data-testid="${testId}-remove"]`,
      ) || [],
    );

    const target: HTMLButtonElement | undefined =
      buttons[Math.min(index, buttons.length - 1)];

    (target || addButtonRef.current)?.focus();
  }, [paths]);

  type EmitFunction = (next: Array<string>) => void;

  const emit: EmitFunction = (next: Array<string>): void => {
    const value: string = writeChosenFields({ paths: next, mode: mode });

    setPaths(next);
    setJsonText(value);
    props.onChange(value);
  };

  type ToggleFunction = (option: FieldOption) => void;

  const toggle: ToggleFunction = (option: FieldOption): void => {
    const current: Array<string> = paths || [];

    emit(
      current.includes(option.path)
        ? current.filter((path: string): boolean => {
            return path !== option.path;
          })
        : [...current, option.path],
    );
  };

  type RemoveFunction = (path: string) => void;

  const remove: RemoveFunction = (path: string): void => {
    const current: Array<string> = paths || [];

    const next: Array<string> = current.filter((candidate: string): boolean => {
      return candidate !== path;
    });

    focusAfterRemoveRef.current = current.indexOf(path);
    setUnknownPaths((unknown: Array<string>) => {
      return unknown.filter((candidate: string): boolean => {
        return candidate !== path;
      });
    });
    emit(next);

    /*
     * The last field taken off: the form is told the list was left as it
     * is, so a list that must hold a field says so here and now. The dialog
     * already says that something needs fixing, and without this it did not
     * say what until the focus went elsewhere.
     */
    if (next.length === 0) {
      props.onBlur?.();
    }
  };

  type BackToListFunction = () => void;

  const backToList: BackToListFunction = (): void => {
    showChosen(
      readChosenFields({ value: jsonText, options: options, mode: mode }),
    );
  };

  type StartOverFunction = () => void;

  const startOver: StartOverFunction = (): void => {
    setProblems([]);
    setIsJson(false);
    setUnknownPaths([]);
    emit([]);
  };

  type ChipTitleFunction = (path: string) => string;

  const chipTitle: ChipTitleFunction = (path: string): string => {
    const option: FieldOption | undefined = findFieldOption(options, path);

    return option ? translator.translateText(option.title) || path : path;
  };

  if (schema.isLoading || (paths === null && !isJson)) {
    return (
      <p
        className="py-2 text-sm text-gray-500"
        role="status"
        data-testid={`${testId}-loading`}
      >
        {translator.translateText(ModelFieldPickerCopy.loading)}
      </p>
    );
  }

  if (isJson) {
    return (
      <div className="space-y-2" data-testid={testId} data-view="json">
        {schema.error ? (
          <p
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid={`${testId}-load-error`}
          >
            {translator.translateTemplate(ModelFieldPickerCopy.couldNotLoad, {
              error: schema.error,
            })}
          </p>
        ) : null}

        {problems.length > 0 ? (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"
            data-testid={`${testId}-kept-as-json`}
          >
            <p className="font-semibold text-amber-900">
              {translator.translateText(ModelFieldPickerCopy.keptAsJson)}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {problems.map((problem: string, index: number) => {
                return <li key={index}>{problem}</li>;
              })}
            </ul>
            <p className="mt-1">
              <TranslatedSentence
                template={ModelFieldPickerCopy.keptAsJsonHelp}
                slots={{
                  reset: (
                    <button
                      type="button"
                      data-testid={`${testId}-start-over`}
                      className="font-semibold text-amber-900 underline hover:text-amber-700"
                      onClick={startOver}
                    >
                      {translator.translateText(ModelFieldPickerCopy.startOver)}
                    </button>
                  ),
                }}
              />
            </p>
          </div>
        ) : null}

        <CodeEditor
          type={CodeType.JSON}
          value={jsonText}
          onChange={(next: string) => {
            setJsonText(next);
            props.onChange(next);
          }}
          placeholder={props.placeholder || 'Example: {"title": true}'}
          error={props.error}
          tabIndex={props.tabIndex}
          ariaLabelledby={props.ariaLabelledby}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {translator.translateText(ModelFieldPickerCopy.jsonHint)}
          </p>
          {!schema.error && problems.length === 0 ? (
            <button
              type="button"
              data-testid={`${testId}-back-to-list`}
              className="-mr-1 inline-flex items-center gap-1 rounded px-1 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
              onClick={backToList}
            >
              <Icon icon={IconProp.ListBullet} className="h-3.5 w-3.5" />
              {translator.translateText(ModelFieldPickerCopy.backToList)}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const chosen: Array<string> = paths || [];

  return (
    <div
      className="space-y-1"
      data-testid={testId}
      data-view="list"
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        /*
         * Escape with the list open closes the list, wherever the focus is
         * - in its search box, on Done, on Add field after a second press on
         * it - and never the settings dialog around it. From Done it used to
         * reach the dialog, which closed and took every unsaved setting
         * with it.
         */
        if (event.key !== "Escape" || !isPanelOpen) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setIsPanelOpen(false);
        addButtonRef.current?.focus();
      }}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        const next: EventTarget | null = event.relatedTarget;

        if (next instanceof Node && event.currentTarget.contains(next)) {
          return;
        }

        props.onBlur?.();
      }}
    >
      <div
        className={`rounded-md border bg-white px-2 py-2 shadow-sm ${
          props.error ? "border-red-300" : "border-gray-300"
        }`}
      >
        <ul
          ref={chipsRef}
          aria-labelledby={props.ariaLabelledby}
          aria-label={
            props.ariaLabelledby
              ? undefined
              : translator.translateText(ModelFieldPickerCopy.chosenFields)
          }
          className="flex flex-wrap items-center gap-1.5"
          data-testid={`${testId}-chips`}
        >
          {chosen.map((path: string) => {
            const isUnknown: boolean = unknownPaths.includes(path);
            const title: string = chipTitle(path);

            return (
              <li
                key={path}
                data-testid={`${testId}-chip`}
                data-path={path}
                data-unknown={isUnknown ? "true" : "false"}
                title={
                  isUnknown
                    ? translator.translateTemplate(
                        ModelFieldPickerCopy.unknownField,
                        { key: path },
                      )
                    : title
                }
                className={`inline-flex max-w-full items-center gap-0.5 rounded-md border pl-2 text-sm ${
                  isUnknown
                    ? "border-amber-200 bg-amber-50 font-mono text-amber-800"
                    : "border-gray-200 bg-gray-50 text-gray-800"
                }`}
              >
                {isUnknown ? (
                  <Icon
                    icon={IconProp.ExclaimationCircle}
                    className="h-3.5 w-3.5 shrink-0 text-amber-600"
                  />
                ) : null}
                <span className="truncate">{title}</span>
                <button
                  type="button"
                  data-testid={`${testId}-remove`}
                  aria-label={translator.translateTemplate(
                    ModelFieldPickerCopy.remove,
                    { field: title },
                  )}
                  // 24px square: no smaller a target than a finger needs.
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    remove(path);
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </li>
            );
          })}
          {chosen.length === 0 ? (
            <li
              className="px-1 text-sm text-gray-500"
              data-testid={`${testId}-empty`}
            >
              {mode === FieldPickerMode.Watch
                ? translator.translateTemplate(
                    ModelFieldPickerCopy.emptyWatch,
                    {
                      record: translatableTerm(recordName, {
                        inSentence: true,
                      }),
                    },
                  )
                : translator.translateText(ModelFieldPickerCopy.emptyPassOn)}
            </li>
          ) : null}
          <li>
            <button
              ref={addButtonRef}
              type="button"
              data-testid={`${testId}-add`}
              aria-haspopup="listbox"
              aria-expanded={isPanelOpen}
              tabIndex={props.tabIndex}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => {
                setIsPanelOpen(!isPanelOpen);
              }}
            >
              <Icon icon={IconProp.Add} className="h-4 w-4" />
              {translator.translateText(ModelFieldPickerCopy.addField)}
            </button>
          </li>
        </ul>
      </div>

      {isPanelOpen ? (
        <AddFieldsPanel
          options={options}
          groups={groups}
          chosen={chosen}
          onToggle={toggle}
          label={label}
          dataTestId={testId}
          toggleRef={addButtonRef}
          onClose={(closeOptions: { returnFocus: boolean }) => {
            setIsPanelOpen(false);

            if (closeOptions.returnFocus) {
              addButtonRef.current?.focus();
            }
          }}
        />
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          data-testid={`${testId}-edit-json`}
          className="-mr-1 rounded px-1 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:underline"
          onClick={() => {
            setIsPanelOpen(false);
            setIsJson(true);
          }}
        >
          {translator.translateText(ModelFieldPickerCopy.editAsJson)}
        </button>
      </div>

      {props.error ? (
        <p className="text-sm text-red-600" data-testid="error-message">
          {props.error}
        </p>
      ) : null}
    </div>
  );
};

export default ModelFieldPicker;
