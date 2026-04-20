import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import Input from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import MetricFormulaData from "Common/Types/Metrics/MetricFormulaData";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";

export interface ComponentProps {
  data: MetricFormulaData;
  onDataChanged: (data: MetricFormulaData) => void;
  availableVariables?: Array<string> | undefined;
}

const MetricFormulaInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const availableVariables: Array<string> = useMemo(() => {
    return (props.availableVariables || []).filter((v: string): boolean => {
      return Boolean(v);
    });
  }, [props.availableVariables]);

  const validationError: string | null = useMemo(() => {
    if (!props.data.metricFormula) {
      return null;
    }
    return MetricFormulaEvaluator.validateFormula({
      formula: props.data.metricFormula,
      availableVariables,
    });
  }, [props.data.metricFormula, availableVariables]);

  const exampleFormula: string = availableVariables[0]
    ? `${availableVariables[0]} * 2`
    : "a * 2";

  return (
    <Fragment>
      <div className="flex mt-3">
        <div className="w-full">
          <FieldLabelElement
            required={true}
            title="Formula"
            description="Combine metric variables with +, -, *, /, %, ^ and parentheses."
          />

          {availableVariables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-500">Available:</span>
              {availableVariables.map((variable: string) => {
                return (
                  <span
                    key={variable}
                    className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    ${variable}
                  </span>
                );
              })}
            </div>
          )}

          <Input
            value={props.data.metricFormula}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricFormula: value,
              });
            }}
            placeholder={exampleFormula}
          />

          {validationError ? (
            <p className="mt-1 text-xs text-red-500">{validationError}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              Tip: reference variables with or without a leading "$" (e.g. "a +
              b" or "$A + $B").
            </p>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default MetricFormulaInput;
