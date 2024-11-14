import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { ComponentArgument } from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import ComponentInputTypeToFormFieldType from "./ComponentInputTypeToFormFieldType";
import BasicForm, { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";

export interface ComponentProps {
  component: DashboardBaseComponent;
  onHasFormValidationErrors: (values: Dictionary<boolean>) => void;
  onFormChange: (component: DashboardBaseComponent) => void;
}

const ArgumentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const formRef: any = useRef<FormProps<FormValues<JSONObject>>>(null);
  const [component, setComponent] = useState<DashboardBaseComponent>(
    props.component,
  );
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});

  useEffect(() => {
    props.onHasFormValidationErrors(hasFormValidationErrors);
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  const componentType: DashboardComponentType = component.componentType;
  const componentArguments: Array<ComponentArgument<DashboardBaseComponent>> =
    DashboardComponentsUtil.getComponentSettingsArguments(componentType);

  return (
    <div className="mb-3 mt-3">
      <div className="mt-5 mb-5">
        <h2 className="text-base font-medium text-gray-500">Arguments</h2>
        <p className="text-sm font-medium text-gray-400 mb-5">
          Arguments for this component
        </p>
        {componentArguments && componentArguments.length === 0 && (
          <ErrorMessage error={"This component does not take any arguments."} />
        )}
        {componentArguments && componentArguments.length > 0 && (
          <BasicForm
            hideSubmitButton={true}
            ref={formRef}
            initialValues={{
              ...(component || {}),
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
              componentArguments &&
              componentArguments.map(
                (arg: ComponentArgument<DashboardBaseComponent>) => {
                  return {
                    title: `${arg.name}`,
                    description: `${
                      arg.required ? "Required" : "Optional"
                    }. ${arg.description}`,
                    field: {
                      [arg.id]: true,
                    },
                    required: arg.required,
                    placeholder: arg.placeholder,
                    ...ComponentInputTypeToFormFieldType.getFormFieldTypeByComponentInputType(
                      arg.type,
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

export default ArgumentsForm;
