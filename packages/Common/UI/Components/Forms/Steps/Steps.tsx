import { FormStep, FormStepState } from "../Types/FormStep";
import FormValues from "../Types/FormValues";
import Step from "./Step";
import GenericObject from "../../../../Types/GenericObject";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { ReactElement } from "react";

export interface ComponentProps<T> {
  steps: Array<FormStep<T>>;
  onClick: (step: FormStep<T>) => void;
  currentFormStepId: string;
  formValues: FormValues<T>;
  /*
   * Steps not reached yet can be opened too, not only the ones walked
   * through. Set on a form whose steps are all filled in already.
   */
  allowAnyStep?: boolean | undefined;
}

const Steps: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<FormStep<T>> = props.steps.filter((step: FormStep<T>) => {
    if (!step.showIf) {
      return true;
    }

    return step.showIf(props.formValues);
  });

  return (
    <div className="pr-4 py-6 sm:pr-6 lg:pr-8">
      <nav className="flex" aria-label={translator.translateText("Progress")}>
        <ol role="list" className="space-y-6">
          {steps.map((step: FormStep<T>, index: number) => {
            const indexOfCurrentState: number = steps.findIndex(
              (step: FormStep<T>) => {
                return step.id === props.currentFormStepId;
              },
            );

            let state: FormStepState = FormStepState.INACTIVE;

            if (indexOfCurrentState > index) {
              state = FormStepState.COMPLETED;
            } else if (indexOfCurrentState === index) {
              state = FormStepState.ACTIVE;
            } else {
              state = FormStepState.INACTIVE;
            }

            return (
              <Step
                state={state}
                step={step}
                key={index}
                isClickable={
                  state === FormStepState.COMPLETED ||
                  (state === FormStepState.INACTIVE &&
                    Boolean(props.allowAnyStep))
                }
                onClick={(step: FormStep<T>) => {
                  props.onClick(step);
                }}
              />
            );
          })}
        </ol>
      </nav>
    </div>
  );
};

export default Steps;
