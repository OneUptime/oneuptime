import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormValues from "../Forms/Types/FormValues";
import ComponentValuePickerModal from "./ComponentValuePickerModal";
import { componentInputTypeToFormFieldType } from "./Utils";
import VariableModal from "./VariableModal";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { Argument, NodeDataProp } from "../../../Types/Workflow/Component";
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
        {component.metadata.arguments &&
          component.metadata.arguments.length > 0 && (
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
                  return {
                    title: `${arg.name}`,
                    footerElement: (
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
                    ...componentInputTypeToFormFieldType(
                      arg.type,
                      component.arguments && component.arguments[arg.id]
                        ? component.arguments[arg.id]
                        : null,
                    ),
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
