import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormValues from "../Forms/Types/FormValues";
import { componentInputTypeToFormFieldType } from "./Utils";
import { JSONObject } from "../../../Types/JSON";
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
  onHasFormValidationErrors: (values: boolean) => void;
  onFormChange: (value: NodeDataProp) => void;
}

const RunForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const formRef: any = useRef<FormProps<FormValues<JSONObject>>>(null);
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] =
    useState<boolean>(false);

  useEffect(() => {
    props.onHasFormValidationErrors(hasFormValidationErrors);
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  return (
    <div className="mb-3 mt-3">
      <div className="mt-5 mb-5">
        <h2 className="text-base font-medium text-gray-500">
          Run {component.metadata.title}
        </h2>
        <p className="text-sm font-medium text-gray-400 mb-5">
          {component.metadata.description}
        </p>
        {component.metadata.runWorkflowManuallyArguments &&
          component.metadata.runWorkflowManuallyArguments.length === 0 && (
            <ErrorMessage
              message={
                'This workflow trigger does not take any values. You can run it by clicking the "Run" button below.'
              }
            />
          )}
        {component.metadata.runWorkflowManuallyArguments &&
          component.metadata.runWorkflowManuallyArguments.length > 0 && (
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
                setHasFormValidationErrors(hasError);
              }}
              fields={
                component.metadata.runWorkflowManuallyArguments &&
                component.metadata.runWorkflowManuallyArguments.map(
                  (argument: Argument) => {
                    return {
                      title: `${argument.name}`,

                      description: `${
                        argument.required ? "Required" : "Optional"
                      }. ${argument.description}`,
                      field: {
                        [argument.id]: true,
                      },
                      required: argument.required,
                      placeholder: argument.placeholder,
                      ...componentInputTypeToFormFieldType(
                        argument.type,
                        component.returnValues &&
                          component.returnValues[argument.id]
                          ? component.returnValues[argument.id]
                          : null,
                      ),
                    };
                  },
                )
              }
            />
          )}
      </div>
    </div>
  );
};

export default RunForm;
