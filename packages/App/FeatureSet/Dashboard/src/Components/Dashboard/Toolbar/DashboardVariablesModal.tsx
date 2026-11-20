import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import AutocompleteTextInput from "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import DashboardVariable, {
  DashboardVariableType,
  DashboardVariableOption,
} from "Common/Types/Dashboard/DashboardVariable";
import ObjectID from "Common/Types/ObjectID";
import Label from "Common/Models/DatabaseModels/Label";
import {
  SharedNameFacts,
  getSharedNameFacts,
  getSharedNameSelect,
} from "Common/UI/Utils/SharedNameOptions";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getNamedDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getDashboardVariableTypeName } from "./DashboardVariableTypeNames";

/*
 * A Project Labels variable's default: one of its allowed labels, drawn as
 * the label is named. A default no longer among them is kept, named
 * "Unavailable label", so it can be seen and changed.
 */
export function getDefaultLabelOptions(
  variable: DashboardVariable,
  translator: Translator,
): Array<DropdownOption> {
  const labelOptions: Array<DashboardVariableOption> =
    variable.labelOptions || [];
  const isDefaultGone: boolean = Boolean(
    variable.defaultValue &&
      !labelOptions.some((option: DashboardVariableOption): boolean => {
        return option.value === variable.defaultValue;
      }),
  );

  return [
    ...(isDefaultGone && variable.defaultValue
      ? [
          getTranslatedDropdownOption(
            variable.defaultValue,
            translator.translateText("Unavailable label") ||
              "Unavailable label",
          ),
        ]
      : []),
    ...labelOptions.map((option: DashboardVariableOption): DropdownOption => {
      return getNamedDropdownOption(option.value, option.label);
    }),
  ];
}

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  telemetryAttributeOptions: Array<string>;
  onClose: () => void;
  onSave: (variables: Array<DashboardVariable>) => void;
}

interface VariableRowProps {
  variable: DashboardVariable;
  telemetryAttributeOptions: Array<string>;
  onChange: (variable: DashboardVariable) => void;
  onDelete: () => void;
  nameError?: string | undefined;
  labelError?: string | undefined;
}

const RESERVED_NAME_PATTERN: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface LabelChoicesProps {
  variable: DashboardVariable;
  onChange: (variable: DashboardVariable) => void;
}

const LabelChoices: FunctionComponent<LabelChoicesProps> = (
  props: LabelChoicesProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [options, setOptions] = useState<Array<DashboardVariableOption>>([]);
  /*
   * What tells two labels of one name apart, by id, for the picker alone
   * (#10314): what is saved is each label's name and id - the dashboard's
   * toolbar and its shared pages show that, never a label's description.
   */
  const [factsById, setFactsById] = useState<Map<string, SharedNameFacts>>(
    new Map<string, SharedNameFacts>(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled: boolean = false;
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          throw new Error("Select a project to choose labels.");
        }
        const choices: Array<DashboardVariableOption> = [];
        const facts: Map<string, SharedNameFacts> = new Map<
          string,
          SharedNameFacts
        >();
        let skip: number = 0;
        while (!cancelled) {
          const result: ListResult<Label> = await ModelAPI.getList<Label>({
            modelType: Label,
            query: { projectId },
            select: { _id: true, name: true, ...getSharedNameSelect(Label) },
            sort: { name: SortOrder.Ascending },
            skip,
            limit: 1000,
          });
          for (const label of result.data) {
            if (label._id && label.name) {
              choices.push({ label: label.name, value: label._id.toString() });

              const labelFacts: SharedNameFacts | undefined =
                getSharedNameFacts(label);

              if (labelFacts) {
                facts.set(label._id.toString(), labelFacts);
              }
            }
          }
          skip += result.data.length;
          if (result.data.length === 0 || skip >= result.count) {
            break;
          }
        }
        if (!cancelled) {
          setOptions(choices);
          setFactsById(facts);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const savedOptions: Array<DashboardVariableOption> =
    props.variable.labelOptions || [];
  const allOptions: Array<DashboardVariableOption> = [
    ...options,
    ...savedOptions.filter((saved: DashboardVariableOption) => {
      return !options.some((option: DashboardVariableOption) => {
        return option.value === saved.value;
      });
    }),
  ];

  return (
    <div>
      {isLoading ? (
        <p className="text-xs text-gray-500">
          {translator.translateText("Loading project labels…")}
        </p>
      ) : error ? (
        <FieldError message={error} className="text-xs" />
      ) : (
        <Dropdown
          ariaLabel="Allowed project labels"
          isMultiSelect={true}
          placeholder="Choose labels for this variable"
          options={allOptions.map(
            (option: DashboardVariableOption): DropdownOption => {
              const facts: SharedNameFacts | undefined = factsById.get(
                option.value,
              );

              // Two labels of one name told apart while choosing (#10314).
              return facts
                ? { label: option.label, value: option.value, sharedName: facts }
                : option;
            },
          )}
          value={savedOptions}
          onChange={(values: DropdownValue | Array<DropdownValue> | null) => {
            const selected: Array<string> = Array.isArray(values)
              ? values.map((value: DropdownValue) => {
                  return value.toString();
                })
              : [];
            const labelOptions: Array<DashboardVariableOption> =
              allOptions.filter((option: DashboardVariableOption) => {
                return selected.includes(option.value);
              });
            props.onChange({
              ...props.variable,
              labelOptions,
              defaultValue: selected.includes(props.variable.defaultValue || "")
                ? props.variable.defaultValue
                : "",
              selectedValue: selected.includes(
                props.variable.selectedValue || "",
              )
                ? props.variable.selectedValue
                : "",
              selectedValues: (props.variable.selectedValues || []).filter(
                (value: string) => {
                  return selected.includes(value);
                },
              ),
            });
          }}
        />
      )}
      <p className="text-xs text-gray-500 mt-1">
        {translator.translateText(
          "Choose up to 1,000 labels. Their names appear in the toolbar and on shared dashboards. Bind this variable in a Monitor List widget’s Label Variable setting.",
        )}
      </p>
    </div>
  );
};

const VariableRow: FunctionComponent<VariableRowProps> = (
  props: VariableRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { variable } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3">
      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-4">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            {translator.translateText("Name")}
          </label>
          <input
            type="text"
            className={`w-full text-sm border rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 ${
              props.nameError ? "border-red-300" : "border-gray-200"
            }`}
            placeholder={translator.translateText("cluster")}
            value={variable.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, name: e.target.value });
            }}
          />
          {props.nameError && (
            <FieldError
              message={props.nameError}
              className="mt-1 text-[11px]"
            />
          )}
        </div>

        <div className="col-span-4">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            {translator.translateText("Label")}
          </label>
          <input
            type="text"
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder={translator.translateText("Cluster")}
            value={variable.label || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, label: e.target.value });
            }}
          />
        </div>

        <div className="col-span-3">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            {translator.translateText("Default")}
          </label>
          {/*
           * Defaults are a single-select concept: a multi-select starts on
           * "All" and its selector has no way to show anything else while
           * nothing is picked. Leaving this editable next to the
           * multi-select checkbox invites a default that silently never
           * applies, so it is disabled instead of quietly ignored. The
           * stored value is kept so unticking the box restores it.
           */}
          {variable.type === DashboardVariableType.ProjectLabel ? (
            <Dropdown
              className="relative w-full overflow-visible"
              options={getDefaultLabelOptions(variable, translator)}
              value={findDropdownOption(
                getDefaultLabelOptions(variable, translator),
                variable.defaultValue,
              )}
              // Cleared, the variable starts on every label: "All".
              placeholder={translator.translateText("All")}
              isPlaceholderTranslated={true}
              ariaLabel={translator.translateText("Default label")}
              isAriaLabelTranslated={true}
              disabled={Boolean(variable.isMultiSelect)}
              onChange={(
                next: DropdownValue | Array<DropdownValue> | null,
              ): void => {
                props.onChange({
                  ...variable,
                  defaultValue: readPickedDropdownValue(next) || "",
                });
              }}
            />
          ) : (
            <input
              type="text"
              className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={translator.translateText(
                variable.isMultiSelect ? "All" : "(none)",
              )}
              value={variable.defaultValue || ""}
              disabled={Boolean(variable.isMultiSelect)}
              title={
                variable.isMultiSelect
                  ? translator.translateText(
                      "Multi-select variables start on All and do not use a default.",
                    )
                  : undefined
              }
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                props.onChange({ ...variable, defaultValue: e.target.value });
              }}
            />
          )}
          <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={Boolean(variable.isMultiSelect)}
              disabled={
                variable.type === DashboardVariableType.TextInput ||
                variable.type === DashboardVariableType.Query
              }
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                props.onChange({
                  ...variable,
                  isMultiSelect: e.target.checked,
                });
              }}
            />
            {translator.translateText("Allow multi-select")}
          </label>
        </div>

        <div className="col-span-1 flex items-end justify-end h-full pb-1">
          <button
            type="button"
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            onClick={props.onDelete}
            title={translator.translateText("Remove variable")}
          >
            <Icon icon={IconProp.Trash} className="w-4 h-4" />
          </button>
        </div>

        <div className="col-span-12">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            {translator.translateText("Source")}
          </label>
          <Dropdown
            ariaLabel="Variable source"
            /*
             * A variable always has a source: another is picked in its
             * place, never none. Its clear button did nothing - the empty
             * pick is ignored below - as a required pick's has none.
             */
            isClearable={false}
            options={[
              DashboardVariableType.TelemetryAttribute,
              DashboardVariableType.ProjectLabel,
              DashboardVariableType.CustomList,
              DashboardVariableType.TextInput,
              ...(variable.type === DashboardVariableType.Query
                ? [DashboardVariableType.Query]
                : []),
            ].map((type: DashboardVariableType): DropdownOption => {
              return {
                label: getDashboardVariableTypeName(type),
                // A source's name is the product's word, looked up.
                isUserContent: false,
                value: type,
              };
            })}
            value={{
              label: getDashboardVariableTypeName(variable.type),
              isUserContent: false,
              value: variable.type,
            }}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string" && value !== variable.type) {
                props.onChange({
                  ...variable,
                  type: value as DashboardVariableType,
                  attributeKey:
                    value === DashboardVariableType.TelemetryAttribute
                      ? variable.attributeKey
                      : undefined,
                  labelOptions:
                    value === DashboardVariableType.ProjectLabel
                      ? variable.labelOptions
                      : undefined,
                  customListValues:
                    value === DashboardVariableType.CustomList
                      ? variable.customListValues
                      : undefined,
                  query:
                    value === DashboardVariableType.Query
                      ? variable.query
                      : undefined,
                  isMultiSelect:
                    value === DashboardVariableType.TextInput
                      ? false
                      : variable.isMultiSelect,
                  defaultValue: "",
                  selectedValue: "",
                  selectedValues: [],
                });
              }
            }}
          />
        </div>
        <div className="col-span-12">
          {variable.type === DashboardVariableType.TelemetryAttribute ? (
            <>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
                {translator.translateText("Attribute Key")}
              </label>
              <AutocompleteTextInput
                value={variable.attributeKey || ""}
                placeholder="e.g. k8s.cluster.name"
                suggestions={props.telemetryAttributeOptions}
                className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono"
                outerDivClassName="relative w-full"
                onChange={(value: string) => {
                  return props.onChange({ ...variable, attributeKey: value });
                }}
              />
              <p className="text-xs text-gray-500 mt-1">
                {translator.translateText(
                  variable.isMultiSelect
                    ? 'Widgets that support this attribute will be scoped to the selected value. Choosing "All" removes this attribute filter — a multi-select with nothing picked is All.'
                    : 'Widgets that support this attribute will be scoped to the selected value. Choosing "All" removes this attribute filter.',
                )}
              </p>
            </>
          ) : variable.type === DashboardVariableType.ProjectLabel ? (
            <>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
                {translator.translateText("Allowed Labels")}
              </label>
              <LabelChoices variable={variable} onChange={props.onChange} />
              {props.labelError && (
                <FieldError
                  message={props.labelError}
                  className="mt-1 text-xs"
                />
              )}
            </>
          ) : variable.type === DashboardVariableType.CustomList ? (
            <>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
                {translator.translateText("Values")}
              </label>
              <input
                aria-label={translator.translateText("Custom list values")}
                className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5"
                placeholder={translator.translateText("prod, staging")}
                value={variable.customListValues || ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  return props.onChange({
                    ...variable,
                    customListValues: e.target.value,
                  });
                }}
              />
              <p className="text-xs text-gray-500 mt-1">
                {translator.translateText(
                  "Comma-separated values for text and query placeholders. Use Project Labels to filter Monitor Lists.",
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              {translator.translateText(
                variable.type === DashboardVariableType.Query
                  ? "This legacy query variable is preserved. Query option loading is not supported."
                  : "Viewers enter a value for text and query placeholders. Use Project Labels to filter Monitor Lists.",
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const DashboardVariablesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [variables, setVariables] = useState<Array<DashboardVariable>>(
    props.variables.map((v: DashboardVariable) => {
      return { ...v };
    }),
  );

  const nameErrors: Record<string, string> = useMemo(() => {
    const errors: Record<string, string> = {};
    const seen: Set<string> = new Set();
    for (const v of variables) {
      const trimmed: string = (v.name || "").trim();
      if (!trimmed) {
        errors[v.id] = translationKey("Required");
        continue;
      }
      if (!RESERVED_NAME_PATTERN.test(trimmed)) {
        errors[v.id] = translationKey("Letters, digits and underscore only");
        continue;
      }
      const lower: string = trimmed.toLowerCase();
      if (seen.has(lower)) {
        errors[v.id] = translationKey("Duplicate name");
        continue;
      }
      seen.add(lower);
    }
    return errors;
  }, [variables]);

  const labelErrors: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.type === DashboardVariableType.ProjectLabel) {
      const count: number = variable.labelOptions?.length || 0;
      if (count === 0 || count > 1000) {
        labelErrors[variable.id] = translationKey(
          "Choose between 1 and 1,000 allowed labels.",
        );
      } else if (
        variable.defaultValue &&
        !variable.labelOptions?.some((option: DashboardVariableOption) => {
          return option.value === variable.defaultValue;
        })
      ) {
        labelErrors[variable.id] = translationKey(
          "Choose a default from the allowed labels or select All.",
        );
      }
    }
  }
  const hasErrors: boolean =
    Object.keys(nameErrors).length > 0 || Object.keys(labelErrors).length > 0;

  const addVariable: () => void = () => {
    const newVar: DashboardVariable = {
      id: ObjectID.generate().toString(),
      name: "",
      type: DashboardVariableType.TelemetryAttribute,
    };
    setVariables([...variables, newVar]);
  };

  const updateVariable: (next: DashboardVariable) => void = (
    next: DashboardVariable,
  ) => {
    setVariables(
      variables.map((v: DashboardVariable) => {
        return v.id === next.id ? next : v;
      }),
    );
  };

  const deleteVariable: (id: string) => void = (id: string) => {
    setVariables(
      variables.filter((v: DashboardVariable) => {
        return v.id !== id;
      }),
    );
  };

  return (
    <Modal
      title="Dashboard Variables"
      description="Add toolbar selectors for supported telemetry attributes or explicitly bind project labels to Monitor List widgets."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      onSubmit={() => {
        if (hasErrors) {
          return;
        }
        const normalized: Array<DashboardVariable> = variables.map(
          (v: DashboardVariable) => {
            const definition: DashboardVariable = {
              ...v,
              name: (v.name || "").trim(),
            };
            /*
             * Toolbar choices belong to the current viewer. Publishing them
             * would override the configured default for subsequent viewers.
             */
            delete definition.selectedValue;
            delete definition.selectedValues;
            return definition;
          },
        );
        props.onSave(normalized);
      }}
      submitButtonText="Save Variables"
      disableSubmitButton={hasErrors}
      closeButtonText="Cancel"
    >
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
        {variables.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center">
            <Icon
              icon={IconProp.Variable}
              className="w-6 h-6 text-gray-300 mx-auto mb-2"
            />
            <p className="text-sm text-gray-500 mb-1">
              {translator.translateText("No variables yet")}
            </p>
            <p className="text-xs text-gray-500">
              {translator.translateText(
                "Add a variable, then configure the widgets it should filter.",
              )}
            </p>
          </div>
        ) : (
          variables.map((variable: DashboardVariable) => {
            return (
              <VariableRow
                key={variable.id}
                variable={variable}
                telemetryAttributeOptions={props.telemetryAttributeOptions}
                onChange={updateVariable}
                onDelete={() => {
                  deleteVariable(variable.id);
                }}
                nameError={nameErrors[variable.id]}
                labelError={labelErrors[variable.id]}
              />
            );
          })
        )}

        <div className="mt-2">
          <Button
            icon={IconProp.Add}
            title="Add Variable"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={addVariable}
          />
        </div>
      </div>
    </Modal>
  );
};

export default DashboardVariablesModal;
