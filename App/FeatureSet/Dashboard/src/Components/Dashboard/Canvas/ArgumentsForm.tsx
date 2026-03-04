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
import {
  ComponentArgument,
  ComponentInputType,
} from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import ComponentInputTypeToFormFieldType from "./ComponentInputTypeToFormFieldType";
import BasicForm, { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import MetricQueryConfig from "../../Metrics/MetricQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import MetricType from "Common/Models/DatabaseModels/MetricType";

export interface ComponentProps {
  // eslint-disable-next-line react/no-unused-prop-types
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
  component: DashboardBaseComponent;
  onHasFormValidationErrors?:
    | ((values: Dictionary<boolean>) => void)
    | undefined;
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
    if (props.onHasFormValidationErrors) {
      props.onHasFormValidationErrors(hasFormValidationErrors);
    }
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  useEffect(() => {
    setComponent(props.component);
  }, [props.component]);

  const componentType: DashboardComponentType = component.componentType;
  const componentArguments: Array<ComponentArgument<DashboardBaseComponent>> =
    DashboardComponentsUtil.getComponentSettingsArguments(componentType);

  type GetMetricsQueryConfigFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ) => (
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement;

  const getMetricsQueryConfigForm: GetMetricsQueryConfigFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ): ((
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement) => {
    // eslint-disable-next-line react/display-name
    return (
      value: FormValues<JSONObject>,
      componentProps: CustomElementProps,
    ) => {
      return (
        <MetricQueryConfig
          {...componentProps}
          data={value[arg.id] as MetricQueryConfigData}
          metricTypes={props.metrics.metricTypes}
          telemetryAttributes={props.metrics.telemetryAttributes}
          hideCard={true}
        />
      );
    };
  };

  type GetCustomElementFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ) =>
    | ((
        value: FormValues<JSONObject>,
        componentProps: CustomElementProps,
      ) => ReactElement)
    | undefined;

  const getCustomElememnt: GetCustomElementFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ):
    | ((
        value: FormValues<JSONObject>,
        componentProps: CustomElementProps,
      ) => ReactElement)
    | undefined => {
    if (arg.type === ComponentInputType.MetricsQueryConfig) {
      return getMetricsQueryConfigForm(arg);
    }
    return undefined;
  };

  const getForm: GetReactElementFunction = (): ReactElement => {
    return (
      <BasicForm
        hideSubmitButton={true}
        ref={formRef}
        values={{
          ...(component?.arguments || {}),
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
                  arg.dropdownOptions,
                ),
                getCustomElement: getCustomElememnt(arg),
              };
            },
          )
        }
      />
    );
  };

  return (
    <div className="mb-3 mt-3">
      <div className="mt-5 mb-5">
        <h2 className="text-base font-medium text-gray-500">Arguments</h2>
        <p className="text-sm font-medium text-gray-400 mb-5">
          Arguments for this component
        </p>
        {componentArguments && componentArguments.length === 0 && (
          <ErrorMessage
            message={"This component does not take any arguments."}
          />
        )}
        {componentArguments && componentArguments.length > 0 && getForm()}
      </div>
    </div>
  );
};

export default ArgumentsForm;
