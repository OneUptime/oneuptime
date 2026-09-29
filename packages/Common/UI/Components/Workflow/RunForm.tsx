import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, { FormProps } from "../Forms/BasicForm";
import FormValues from "../Forms/Types/FormValues";
import {
  componentInputTypeToFormFieldType,
  parseStringDictionaryValue,
} from "./Utils";
import { JSONObject } from "../../../Types/JSON";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
} from "../../../Types/Workflow/Component";
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

  /*
   * Same hydration ArgumentsForm does: a StringDictionary renders as key/value
   * rows, and those need a real object rather than the JSON string older
   * workflows stored. The field type is chosen from the same value, so the two
   * cannot disagree about which editor is on screen.
   */
  const formInitialValues: JSONObject = { ...(component.arguments || {}) };

  for (const argument of component.metadata.runWorkflowManuallyArguments ||
    []) {
    if (argument.type !== ComponentInputType.StringDictionary) {
      continue;
    }

    const parsed: JSONObject | null = parseStringDictionaryValue(
      formInitialValues[argument.id],
    );

    if (parsed !== null) {
      formInitialValues[argument.id] = parsed;
    }
  }

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
                      /*
                       * Decided from the value the form actually renders.
                       * This used to read component.returnValues, which is not
                       * where RunForm writes — so for a field holding a value
                       * the row editor cannot represent, the editor on screen
                       * and the value behind it could disagree.
                       */
                      ...componentInputTypeToFormFieldType(
                        argument.type,
                        formInitialValues[argument.id] ?? null,
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
