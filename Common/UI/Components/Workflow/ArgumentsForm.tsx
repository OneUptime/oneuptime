import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "../Forms/Types/Field";
import FormValues from "../Forms/Types/FormValues";
import ComponentValuePickerModal from "./ComponentValuePickerModal";
import CronScheduleField from "./CronScheduleField";
import ModelColumnEditor, { ModelColumnEditorMode } from "./ModelColumnEditor";
import ModelFieldPicker from "./ModelFieldPicker";
import {
  componentInputTypeToFormFieldType,
  parseStringDictionaryValue,
} from "./Utils";
import VariableModal from "./VariableModal";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
  isJSON5ToleratedInputType,
} from "../../../Types/Workflow/Component";
import { DropdownOption } from "../Dropdown/Dropdown";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  component: NodeDataProp;
  onHasFormValidationErrors: (values: Dictionary<boolean>) => void;
  workflowId: ObjectID;
  graphComponents: Array<NodeDataProp>;
  onFormChange: (value: NodeDataProp) => void;
}

const ArgumentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const formRef: React.MutableRefObject<FormProps<
    FormValues<JSONObject>
  > | null> = useRef<FormProps<FormValues<JSONObject>> | null>(null);
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [showVariableModal, setShowVariableModal] = useState<boolean>(false);
  const [showComponentPickerModal, setShowComponentPickerModal] =
    useState<boolean>(false);
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});

  const [selectedArgId, setSelectedArgId] = useState<string>("");

  /*
   * Arguments flagged isAdvanced are collapsed behind a disclosure, so the
   * settings panel opens on the two or three fields that actually decide what
   * the step does rather than on every knob it has. A required argument is
   * never collapsed no matter how it is flagged: BasicForm skips validation
   * for a field hidden by showIf, so hiding a required one would let an
   * incomplete step save cleanly.
   */
  const collapsibleAdvancedArguments: Array<Argument> = (
    component.metadata.arguments || []
  ).filter((arg: Argument) => {
    return Boolean(arg.isAdvanced) && !arg.required;
  });

  const hasValueForArgument: (arg: Argument) => boolean = (
    arg: Argument,
  ): boolean => {
    const value: unknown = component.arguments
      ? component.arguments[arg.id]
      : undefined;

    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim() !== "";
    }

    if (typeof value === "object") {
      return Object.keys(value as JSONObject).length > 0;
    }

    return true;
  };

  /*
   * Open on load when something down there is already set, so an existing
   * configuration is never hidden from the person who comes back to read it.
   */
  const [showAdvanced, setShowAdvanced] = useState<boolean>(
    collapsibleAdvancedArguments.some(hasValueForArgument),
  );

  const isCollapsibleAdvanced: (arg: Argument) => boolean = (
    arg: Argument,
  ): boolean => {
    return collapsibleAdvancedArguments.some((advancedArg: Argument) => {
      return advancedArg.id === arg.id;
    });
  };

  /*
   * StringDictionary arguments render as key/value rows, and the row editor
   * needs a real object. Every workflow written before that change stored a
   * JSON string, so parse those on the way into the form. Anything
   * parseStringDictionaryValue declines stays a string and keeps the JSON
   * editor (see componentInputTypeToFormFieldType), so the two always agree.
   */
  const formInitialValues: JSONObject = { ...(component.arguments || {}) };

  for (const arg of component.metadata.arguments || []) {
    if (arg.type !== ComponentInputType.StringDictionary) {
      continue;
    }

    const parsed: JSONObject | null = parseStringDictionaryValue(
      formInitialValues[arg.id],
    );

    if (parsed !== null) {
      formInitialValues[arg.id] = parsed;
    }
  }

  /*
   * Everyday settings first, collapsible ones last, each group keeping its
   * declared order. Without this an advanced argument declared in the middle
   * would pop into the middle of the form when the disclosure opens.
   */
  const orderedArguments: Array<Argument> = [
    ...(component.metadata.arguments || []).filter((arg: Argument) => {
      return !isCollapsibleAdvanced(arg);
    }),
    ...collapsibleAdvancedArguments,
  ];

  const firstAdvancedArgumentIndex: number =
    orderedArguments.length - collapsibleAdvancedArguments.length;

  /*
   * Workflows in the current project, used to populate dropdowns for any
   * argument of type WorkflowSelect (e.g. the "Workflow" field on the
   * Execute Workflow component). Empty until the fetch completes.
   */
  const [workflowDropdownOptions, setWorkflowDropdownOptions] = useState<
    Array<DropdownOption>
  >([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState<boolean>(false);

  const hasWorkflowSelectArg: boolean = Boolean(
    component.metadata.arguments?.some((arg: Argument) => {
      return arg.type === ComponentInputType.WorkflowSelect;
    }),
  );

  useEffect(() => {
    if (!hasWorkflowSelectArg) {
      return;
    }

    let cancelled: boolean = false;
    setIsLoadingWorkflows(true);

    const loadWorkflows: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Workflow> = await ModelAPI.getList<Workflow>({
          modelType: Workflow,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: "Ascending" as any,
          },
        });

        if (cancelled) {
          return;
        }

        const currentWorkflowIdStr: string = props.workflowId.toString();

        const options: Array<DropdownOption> = result.data
          .filter((wf: Workflow) => {
            // Exclude the current workflow — can't pick yourself.
            return wf._id?.toString() !== currentWorkflowIdStr;
          })
          .map((wf: Workflow) => {
            return {
              label: (wf.name as string) || (wf._id?.toString() ?? ""),
              value: wf._id?.toString() ?? "",
            };
          });

        setWorkflowDropdownOptions(options);
      } catch {
        /*
         * Swallow: the dropdown will simply be empty and the user can try
         * again by re-opening the settings panel.
         */
        if (!cancelled) {
          setWorkflowDropdownOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWorkflows(false);
        }
      }
    };

    void loadWorkflows();

    return () => {
      cancelled = true;
    };
    // Only re-fetch when the component in the settings panel changes identity.
  }, [component.id, hasWorkflowSelectArg]);

  useEffect(() => {
    props.onHasFormValidationErrors(hasFormValidationErrors);
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  return (
    <div>
      <div>
        {component.metadata.arguments &&
          component.metadata.arguments.length === 0 && (
            <ErrorMessage message={"This step does not need any settings."} />
          )}
        {/*
          If any argument is a WorkflowSelect and we're still fetching the
          list of workflows, show a loader instead of the form. Otherwise
          the user briefly sees an empty dropdown which is confusing.
        */}
        {hasWorkflowSelectArg && isLoadingWorkflows && <ComponentLoader />}
        {component.metadata.arguments &&
          component.metadata.arguments.length > 0 &&
          !(hasWorkflowSelectArg && isLoadingWorkflows) && (
            <BasicForm
              hideSubmitButton={true}
              ref={formRef}
              initialValues={{
                ...formInitialValues,
              }}
              onChange={(values: FormValues<JSONObject>) => {
                setComponent({
                  ...component,
                  arguments: {
                    ...((component.arguments as JSONObject) || {}),
                    ...((values as JSONObject) || {}),
                  },
                });
              }}
              onFormValidationErrorChanged={(hasError: boolean) => {
                /*
                 * Keyed "arguments", not "id": the Identifier field in the
                 * settings modal reports into the same dictionary under "id",
                 * so both forms were overwriting each other. Typing in the
                 * Identifier box cleared an outstanding argument error and
                 * re-enabled Save on a component that was still invalid.
                 */
                if (hasFormValidationErrors["arguments"] !== hasError) {
                  setHasFormValidationErrors({
                    ...hasFormValidationErrors,
                    arguments: hasError,
                  });
                }
              }}
              fields={
                component.metadata.arguments &&
                orderedArguments.map((arg: Argument, argIndex: number) => {
                  const isWorkflowSelect: boolean =
                    arg.type === ComponentInputType.WorkflowSelect;

                  /*
                   * Database Select args (the "Select Fields" / "Listen on"
                   * trigger inputs) get a tree-style field picker backed by
                   * the model's schema, instead of a raw JSON textarea. We
                   * need a tableName on the component metadata to fetch the
                   * column list; without it, fall back to the JSON editor.
                   */
                  const useFieldPicker: boolean =
                    arg.type === ComponentInputType.Select &&
                    Boolean(component.metadata.tableName);

                  /*
                   * The Schedule trigger's CronTab argument gets a dedicated
                   * cron picker (presets, custom expression with live preview,
                   * or a variable reference) instead of a bare dropdown.
                   */
                  const useCronPicker: boolean =
                    arg.type === ComponentInputType.CronTab;

                  /*
                   * Query arguments (which records does this act on) and
                   * BaseModel arguments (which values does it write) are both
                   * keyed on the model's columns, so both get the row editor
                   * backed by the model schema. Same tableName requirement as
                   * the field picker.
                   *
                   * BaseModelArray is deliberately not included: it holds a
                   * list of records, which rows cannot represent.
                   */
                  const columnEditorMode: ModelColumnEditorMode | undefined =
                    !component.metadata.tableName
                      ? undefined
                      : arg.type === ComponentInputType.Query
                        ? ModelColumnEditorMode.Query
                        : arg.type === ComponentInputType.BaseModel
                          ? ModelColumnEditorMode.Record
                          : undefined;

                  let baseField: {
                    fieldType: import("../Forms/Types/FormFieldSchemaType").default;
                    dropdownOptions?: Array<DropdownOption> | undefined;
                    getCustomElement?: (
                      values: FormValues<JSONObject>,
                      customProps: CustomElementProps,
                    ) => ReactElement | undefined;
                  };

                  if (columnEditorMode) {
                    baseField = {
                      fieldType: FormFieldSchemaType.CustomComponent,
                      getCustomElement: (
                        _values: FormValues<JSONObject>,
                        customProps: CustomElementProps,
                      ): ReactElement => {
                        return (
                          <ModelColumnEditor
                            tableName={component.metadata.tableName as string}
                            mode={columnEditorMode}
                            initialValue={customProps.initialValue}
                            onChange={(value: string) => {
                              void customProps.onChange?.(value);
                            }}
                            placeholder={customProps.placeholder}
                            error={customProps.error}
                            tabIndex={customProps.tabIndex}
                          />
                        );
                      },
                    };
                  } else if (useFieldPicker) {
                    baseField = {
                      fieldType: FormFieldSchemaType.CustomComponent,
                      getCustomElement: (
                        _values: FormValues<JSONObject>,
                        customProps: CustomElementProps,
                      ): ReactElement => {
                        return (
                          <ModelFieldPicker
                            tableName={component.metadata.tableName as string}
                            initialValue={customProps.initialValue}
                            onChange={(value: string) => {
                              void customProps.onChange?.(value);
                            }}
                            placeholder={customProps.placeholder}
                            error={customProps.error}
                            tabIndex={customProps.tabIndex}
                          />
                        );
                      },
                    };
                  } else if (useCronPicker) {
                    baseField = {
                      fieldType: FormFieldSchemaType.CustomComponent,
                      getCustomElement: (
                        _values: FormValues<JSONObject>,
                        customProps: CustomElementProps,
                      ): ReactElement => {
                        return (
                          <CronScheduleField
                            workflowId={props.workflowId}
                            initialValue={
                              customProps.initialValue as string | null
                            }
                            onChange={(value: string) => {
                              void customProps.onChange?.(value);
                            }}
                            placeholder={customProps.placeholder}
                            error={customProps.error}
                            tabIndex={customProps.tabIndex}
                          />
                        );
                      },
                    };
                  } else {
                    baseField = componentInputTypeToFormFieldType(
                      arg.type,
                      component.arguments && component.arguments[arg.id]
                        ? component.arguments[arg.id]
                        : null,
                    );
                  }

                  /*
                   * For WorkflowSelect, inject the dynamically fetched list
                   * of workflows as dropdown options.
                   */
                  if (isWorkflowSelect) {
                    baseField.dropdownOptions = workflowDropdownOptions;
                  }

                  /*
                   * The "pick from component / variable" footer doesn't
                   * apply to the field picker (it edits a structured object,
                   * not a free-text expression), to WorkflowSelect, or to the
                   * cron picker (which has its own built-in variable selector,
                   * and a schedule can't reference component return values).
                   */
                  const showVariableFooter: boolean =
                    !isWorkflowSelect &&
                    !useFieldPicker &&
                    !useCronPicker &&
                    !columnEditorMode;

                  const isAdvanced: boolean = isCollapsibleAdvanced(arg);

                  return {
                    title: `${arg.name}`,
                    /*
                     * The heading sits on the first advanced field, so the
                     * disclosure reads as a labelled section rather than as a
                     * run of extra inputs appearing out of nowhere.
                     */
                    sectionTitle:
                      isAdvanced && argIndex === firstAdvancedArgumentIndex
                        ? "Advanced"
                        : undefined,
                    showIf: isAdvanced
                      ? (): boolean => {
                          return showAdvanced;
                        }
                      : undefined,
                    footerElement: showVariableFooter ? (
                      <div className="text-gray-500">
                        <p className="text-sm">
                          Pick this value from other{" "}
                          <button
                            className="underline text-blue-500 hover:text-blue-600 cursor-pointer"
                            onClick={() => {
                              setSelectedArgId(arg.id);
                              setShowComponentPickerModal(true);
                            }}
                          >
                            component
                          </button>{" "}
                          or from{" "}
                          <button
                            className="underline text-blue-500 hover:text-blue-600 cursor-pointer"
                            onClick={() => {
                              setSelectedArgId(arg.id);
                              setShowVariableModal(true);
                            }}
                          >
                            variable.
                          </button>
                        </p>
                      </div>
                    ) : undefined,
                    description: `${
                      arg.required ? "Required" : "Optional"
                    }. ${arg.description}`,
                    field: {
                      [arg.id]: true,
                    },
                    required: arg.required,
                    placeholder: arg.placeholder,
                    /*
                     * Some argument types are read back with JSON5 rather than
                     * JSON, so the check has to be no stricter than the parser
                     * that will actually see the value.
                     */
                    allowJSON5: isJSON5ToleratedInputType(arg.type),
                    ...baseField,
                  };
                })
              }
            />
          )}

        {collapsibleAdvancedArguments.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={showAdvanced}
              className="text-sm underline text-blue-500 hover:text-blue-600 cursor-pointer"
              onClick={() => {
                setShowAdvanced(!showAdvanced);
              }}
            >
              {showAdvanced
                ? "Hide advanced settings"
                : `Show ${collapsibleAdvancedArguments.length} advanced setting${
                    collapsibleAdvancedArguments.length === 1 ? "" : "s"
                  }`}
            </button>
          </div>
        )}
      </div>
      {showVariableModal && (
        <VariableModal
          workflowId={props.workflowId}
          onClose={() => {
            setShowVariableModal(false);
          }}
          onSave={(variableId: string) => {
            setShowVariableModal(false);
            formRef.current?.setFieldValue(
              selectedArgId,
              (component.arguments && component.arguments[selectedArgId]
                ? component.arguments[selectedArgId]
                : "") + variableId,
            );
          }}
        />
      )}

      {showComponentPickerModal && (
        <ComponentValuePickerModal
          components={props.graphComponents}
          onClose={() => {
            setShowComponentPickerModal(false);
          }}
          onSave={(returnValuePath: string) => {
            setShowComponentPickerModal(false);
            formRef.current?.setFieldValue(
              selectedArgId,
              (component.arguments && component.arguments[selectedArgId]
                ? component.arguments[selectedArgId]
                : "") + returnValuePath,
            );
          }}
        />
      )}
    </div>
  );
};

export default ArgumentsForm;
