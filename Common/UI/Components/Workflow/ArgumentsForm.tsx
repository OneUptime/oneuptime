import ComponentLoader from "../ComponentLoader/ComponentLoader";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "../Forms/Types/Field";
import FormValues from "../Forms/Types/FormValues";
import ComponentValuePickerModal from "./ComponentValuePickerModal";
import ConditionBuilder from "./ConditionBuilder";
import DataReferenceInput from "./DataReferenceInput";
import JSONArgumentInput from "./JSONArgumentInput";
import KeyValueInput from "./KeyValueInput";
import ModelFieldPicker from "./ModelFieldPicker";
import { componentInputTypeToFormFieldType } from "./Utils";
import VariableModal from "./VariableModal";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
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

/*
 * Argument types that are edited as JSON. These used to render as a plain
 * textarea; they now use the validating JSONArgumentInput. Select is included
 * only when the component has no tableName (otherwise it uses ModelFieldPicker).
 * StringDictionary is handled separately (key/value rows, see KeyValueInput).
 */
const JSON_INPUT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
  ComponentInputType.Query,
  ComponentInputType.Select,
];

export interface ComponentProps {
  component: NodeDataProp;
  onHasFormValidationErrors: (values: Dictionary<boolean>) => void;
  workflowId: ObjectID;
  graphComponents: Array<NodeDataProp>;
  // Component data ids upstream of this step (their output is referenceable).
  upstreamComponentIds?: Set<string> | undefined;
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
   * Advanced arguments (Argument.isAdvanced) are hidden behind a toggle to
   * keep the common configuration to a couple of fields. We start expanded
   * only if an advanced field is required or already has a value, so nothing
   * important is ever hidden.
   */
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    const args: Array<Argument> = props.component.metadata.arguments || [];
    return args.some((arg: Argument) => {
      if (arg.isAdvanced !== true) {
        return false;
      }
      const value: unknown = props.component.arguments
        ? props.component.arguments[arg.id]
        : undefined;
      return arg.required === true || (value !== undefined && value !== "");
    });
  });

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

  type SetJsonFieldErrorFunction = (argId: string, isInvalid: boolean) => void;

  /*
   * Each JSON argument reports whether its content is currently invalid. We
   * track these under distinct "json:<argId>" keys so an invalid JSON body
   * disables Save without clobbering the form's own validation state.
   */
  const setJsonFieldError: SetJsonFieldErrorFunction = (
    argId: string,
    isInvalid: boolean,
  ): void => {
    const key: string = `json:${argId}`;
    setHasFormValidationErrors((prev: Dictionary<boolean>) => {
      if (prev[key] === isInvalid) {
        return prev;
      }
      return { ...prev, [key]: isInvalid };
    });
  };

  /*
   * The If / Else step gets a purpose-built condition editor instead of the
   * five generic fields (its ValueType/Operator inputs are used nowhere else).
   */
  const isConditionComponent: boolean =
    component.metadata.id === ComponentID.IfElse;

  const allArguments: Array<Argument> = component.metadata.arguments || [];
  const advancedArguments: Array<Argument> = allArguments.filter(
    (arg: Argument) => {
      return arg.isAdvanced === true;
    },
  );
  const hasAdvancedArguments: boolean = advancedArguments.length > 0;
  const visibleArguments: Array<Argument> = allArguments.filter(
    (arg: Argument) => {
      return showAdvanced || arg.isAdvanced !== true;
    },
  );

  return (
    <div>
      <div>
        {allArguments.length === 0 && (
          <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">
            This step doesn&apos;t need any configuration.
          </div>
        )}
        {/*
          If any argument is a WorkflowSelect and we're still fetching the
          list of workflows, show a loader instead of the form. Otherwise
          the user briefly sees an empty dropdown which is confusing.
        */}
        {hasWorkflowSelectArg && isLoadingWorkflows && <ComponentLoader />}

        {isConditionComponent && (
          <ConditionBuilder
            arguments={(component.arguments as JSONObject) || {}}
            components={props.graphComponents}
            upstreamComponentIds={props.upstreamComponentIds}
            currentComponentId={component.id}
            workflowId={props.workflowId}
            onArgumentsChange={(patch: JSONObject) => {
              setComponent({
                ...component,
                arguments: {
                  ...((component.arguments as JSONObject) || {}),
                  ...patch,
                },
              });
            }}
            onValidityChange={(hasError: boolean) => {
              setHasFormValidationErrors((prev: Dictionary<boolean>) => {
                if (prev["condition"] === hasError) {
                  return prev;
                }
                return { ...prev, condition: hasError };
              });
            }}
          />
        )}

        {!isConditionComponent &&
          allArguments.length > 0 &&
          !(hasWorkflowSelectArg && isLoadingWorkflows) && (
            <BasicForm
              hideSubmitButton={true}
              ref={formRef}
              initialValues={{
                ...(component.arguments || {}),
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
                setHasFormValidationErrors((prev: Dictionary<boolean>) => {
                  if (prev["arguments"] === hasError) {
                    return prev;
                  }
                  return { ...prev, arguments: hasError };
                });
              }}
              fields={visibleArguments.map((arg: Argument) => {
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
                 * All structured/JSON-ish argument types render in the
                 * validating JSONArgumentInput instead of a bare editor, so
                 * syntax mistakes surface while editing rather than at run
                 * time.
                 */
                const useJsonEditor: boolean =
                  !useFieldPicker && JSON_INPUT_TYPES.includes(arg.type);

                /*
                 * StringDictionary args (HTTP headers, query params) are
                 * edited as key/value rows rather than raw JSON.
                 */
                const useKeyValueEditor: boolean =
                  arg.type === ComponentInputType.StringDictionary;

                let baseField: {
                  fieldType: import("../Forms/Types/FormFieldSchemaType").default;
                  dropdownOptions?: Array<DropdownOption> | undefined;
                  getCustomElement?: (
                    values: FormValues<JSONObject>,
                    customProps: CustomElementProps,
                  ) => ReactElement | undefined;
                };

                if (useFieldPicker) {
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
                } else if (useJsonEditor) {
                  baseField = {
                    fieldType: FormFieldSchemaType.CustomComponent,
                    getCustomElement: (
                      _values: FormValues<JSONObject>,
                      customProps: CustomElementProps,
                    ): ReactElement => {
                      return (
                        <JSONArgumentInput
                          value={(customProps.initialValue as string) || ""}
                          placeholder={arg.placeholder}
                          error={customProps.error}
                          tabIndex={customProps.tabIndex}
                          onChange={(value: string) => {
                            void customProps.onChange?.(value);
                          }}
                          onValidationChange={(isInvalid: boolean) => {
                            setJsonFieldError(arg.id, isInvalid);
                          }}
                        />
                      );
                    },
                  };
                } else if (useKeyValueEditor) {
                  baseField = {
                    fieldType: FormFieldSchemaType.CustomComponent,
                    getCustomElement: (
                      _values: FormValues<JSONObject>,
                      customProps: CustomElementProps,
                    ): ReactElement => {
                      return (
                        <KeyValueInput
                          value={(customProps.initialValue as string) || ""}
                          placeholder={arg.placeholder}
                          error={customProps.error}
                          onChange={(value: string) => {
                            void customProps.onChange?.(value);
                          }}
                          onValidationChange={(isInvalid: boolean) => {
                            setJsonFieldError(arg.id, isInvalid);
                          }}
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
                 * The data-reference footer doesn't apply to the field
                 * picker (it edits a structured object, not a free-text
                 * expression) or to WorkflowSelect.
                 */
                const showVariableFooter: boolean =
                  !isWorkflowSelect && !useFieldPicker && !useKeyValueEditor;

                /*
                 * Plain text fields get the inline chip helper: existing
                 * {{ tokens }} render as friendly, removable chips and new
                 * references are inserted from an upstream-scoped menu. JSON
                 * editors keep the modal-based picker (inserting into a raw
                 * body is better served by the full picker for now).
                 */
                let footerElement: ReactElement | undefined = undefined;
                if (showVariableFooter && useJsonEditor) {
                  footerElement = (
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
                  );
                } else if (showVariableFooter) {
                  footerElement = (
                    <DataReferenceInput
                      value={
                        component.arguments && component.arguments[arg.id]
                          ? String(component.arguments[arg.id])
                          : ""
                      }
                      components={props.graphComponents}
                      upstreamComponentIds={props.upstreamComponentIds}
                      currentComponentId={component.id}
                      workflowId={props.workflowId}
                      onChange={(newValue: string) => {
                        formRef.current?.setFieldValue(arg.id, newValue);
                      }}
                    />
                  );
                }

                return {
                  title: `${arg.name}`,
                  footerElement: footerElement,
                  description: `${
                    arg.required ? "Required" : "Optional"
                  }. ${arg.description}`,
                  field: {
                    [arg.id]: true,
                  },
                  required: arg.required,
                  placeholder: arg.placeholder,
                  ...baseField,
                };
              })}
            />
          )}

        {hasAdvancedArguments &&
          !(hasWorkflowSelectArg && isLoadingWorkflows) && (
            <button
              type="button"
              onClick={() => {
                setShowAdvanced((value: boolean) => {
                  return !value;
                });
              }}
              className="mt-3 text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
            >
              {showAdvanced
                ? "Hide advanced settings"
                : `Show advanced settings (${advancedArguments.length})`}
            </button>
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
          upstreamComponentIds={props.upstreamComponentIds}
          currentComponentId={component.id}
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
