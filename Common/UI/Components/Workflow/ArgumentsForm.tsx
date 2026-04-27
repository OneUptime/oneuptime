import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormValues from "../Forms/Types/FormValues";
import ComponentValuePickerModal from "./ComponentValuePickerModal";
import { componentInputTypeToFormFieldType } from "./Utils";
import VariableModal from "./VariableModal";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
    <div className="mb-3 mt-3">
      <div className="mt-5 mb-5">
        <h2 className="text-base font-medium text-gray-500">Arguments</h2>
        <p className="text-sm font-medium text-gray-400 mb-5">
          Arguments for this component
        </p>
        {component.metadata.arguments &&
          component.metadata.arguments.length === 0 && (
            <ErrorMessage
              message={"This component does not take any arguments."}
            />
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
                if (hasFormValidationErrors["id"] !== hasError) {
                  setHasFormValidationErrors({
                    ...hasFormValidationErrors,
                    id: hasError,
                  });
                }
              }}
              fields={
                component.metadata.arguments &&
                component.metadata.arguments.map((arg: Argument) => {
                  const isWorkflowSelect: boolean =
                    arg.type === ComponentInputType.WorkflowSelect;

                  const baseField: {
                    fieldType: import("../Forms/Types/FormFieldSchemaType").default;
                    dropdownOptions?: Array<DropdownOption> | undefined;
                  } = componentInputTypeToFormFieldType(
                    arg.type,
                    component.arguments && component.arguments[arg.id]
                      ? component.arguments[arg.id]
                      : null,
                  );

                  /*
                   * For WorkflowSelect, inject the dynamically fetched list
                   * of workflows as dropdown options.
                   */
                  if (isWorkflowSelect) {
                    baseField.dropdownOptions = workflowDropdownOptions;
                  }

                  return {
                    title: `${arg.name}`,
                    /*
                     * WorkflowSelect has no "pick from component/variable"
                     * footer — it's a bound dropdown, not a free-text field.
                     */
                    footerElement: isWorkflowSelect ? undefined : (
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
                    ),
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
                })
              }
            />
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
