import {
  DETECTION_RULE_RESPONSE_STEPS_TEST_IDS,
  RESPONSE_STEPS_EMPTY,
  RESPONSE_STEPS_FROM_LIBRARY,
  RESPONSE_STEPS_FULL,
  RESPONSE_STEP_ADD,
  RESPONSE_STEP_PART_LABEL,
  RESPONSE_STEP_PLACEHOLDER,
  RESPONSE_STEP_REMOVE,
  RESPONSE_STEP_REMOVE_LABEL,
  RESPONSE_STEP_TEXT_LABEL,
} from "./DetectionRuleResponseStepsCopy";
import {
  ResponseStepsShown,
  addResponseStep,
  canAddResponseStep,
  changeResponseStep,
  getResponseStepsShown,
  removeResponseStep,
} from "./DetectionRuleResponseStepsModel";
import { RESPONSE_PHASE_TITLES } from "../../SecurityCase/Response/SecurityCaseResponseCopy";
import { ResponsePhase } from "../../SecurityCase/Response/SecurityCaseResponseTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DETECTION_RULE_RESPONSE_PHASES,
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  isDetectionRuleResponsePhase,
} from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Input from "Common/UI/Components/Input/Input";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A DETECTION RULE'S RESPONSE STEPS, ON ITS FORM (#9621).
 *
 * A short list - what to do when the rule opens a case, in the author's
 * words - each step under the part of the case's Response Plan it goes
 * under, picked by the words the plan shows it under: Confirm it is real,
 * Contain it, Fix what let it happen. Add Step puts one more line in; a
 * line's bin takes it out. A rule added from the library shows the steps
 * it comes with until one is changed (DetectionRuleResponseStepsModel).
 *
 * On a phone each line stacks: the part over the words, the bin beside
 * them.
 */

// The parts of the plan a step can go under, in the plan's words.
export function getResponseStepPartOptions(): Array<DropdownOption> {
  return DETECTION_RULE_RESPONSE_PHASES.map(
    (phase: DetectionRuleResponsePhase): DropdownOption => {
      return {
        value: phase,
        label: RESPONSE_PHASE_TITLES[phase as string as ResponsePhase],
      };
    },
  );
}

export interface ComponentProps {
  // The form's value: the rule's own steps, or none written (null).
  value: unknown;
  // Whose library rule's steps show while it has none of its own.
  sigmaRuleYaml: unknown;
  onChange: (steps: Array<DetectionRuleResponseStep>) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
}

const DetectionRuleResponseStepsField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const shown: ResponseStepsShown = getResponseStepsShown({
    value: props.value,
    sigmaRuleYaml: props.sigmaRuleYaml,
  });
  const steps: Array<DetectionRuleResponseStep> = shown.steps;
  const partOptions: Array<DropdownOption> = getResponseStepPartOptions();
  const canAdd: boolean = canAddResponseStep(steps);

  return (
    <div
      className="space-y-3"
      role="group"
      aria-labelledby={props.ariaLabelledby}
      aria-describedby={props.ariaDescribedby}
      data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.field}
    >
      {shown.isFromLibrary ? (
        <p
          className="text-sm text-gray-500"
          data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.fromLibrary}
        >
          {translator.translateText(RESPONSE_STEPS_FROM_LIBRARY)}
        </p>
      ) : (
        <></>
      )}

      {steps.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
          data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.empty}
        >
          {translator.translateText(RESPONSE_STEPS_EMPTY)}
        </p>
      ) : (
        <ol className="space-y-2">
          {steps.map(
            (step: DetectionRuleResponseStep, index: number): ReactElement => {
              const number: string = translator.formatNumber(index + 1);

              return (
                <li
                  key={step.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-start"
                  data-testid={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.row}-${index}`}
                >
                  <div className="shrink-0 sm:w-56">
                    <Dropdown
                      dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.part}-${index}`}
                      isClearable={false}
                      ariaLabel={translator.translateTemplate(
                        RESPONSE_STEP_PART_LABEL,
                        { number },
                      )}
                      isAriaLabelTranslated={true}
                      options={partOptions}
                      value={partOptions.find(
                        (option: DropdownOption): boolean => {
                          return option.value === step.phase;
                        },
                      )}
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ) => {
                        if (!isDetectionRuleResponsePhase(value)) {
                          return;
                        }

                        props.onChange(
                          changeResponseStep(steps, index, { phase: value }),
                        );
                      }}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.text}-${index}`}
                        ariaLabel={translator.translateTemplate(
                          RESPONSE_STEP_TEXT_LABEL,
                          { number },
                        )}
                        value={step.text}
                        maxLength={DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH}
                        placeholder={RESPONSE_STEP_PLACEHOLDER}
                        onChange={(text: string) => {
                          props.onChange(
                            changeResponseStep(steps, index, { text }),
                          );
                        }}
                      />
                    </div>
                    <Button
                      dataTestId={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.remove}-${index}`}
                      ariaLabel={translator.translateTemplate(
                        RESPONSE_STEP_REMOVE_LABEL,
                        { number },
                      )}
                      isAriaLabelTranslated={true}
                      icon={IconProp.Trash}
                      buttonStyle={ButtonStyleType.ICON}
                      buttonSize={ButtonSize.Small}
                      tooltip={RESPONSE_STEP_REMOVE}
                      onClick={() => {
                        props.onChange(removeResponseStep(steps, index));
                      }}
                    />
                  </div>
                </li>
              );
            },
          )}
        </ol>
      )}

      <div>
        <Button
          dataTestId={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.add}
          title={RESPONSE_STEP_ADD}
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          disabled={!canAdd}
          tooltip={
            canAdd
              ? undefined
              : translator.translatePlural(
                  RESPONSE_STEPS_FULL,
                  DETECTION_RULE_RESPONSE_STEPS_MAX,
                )
          }
          onClick={() => {
            props.onChange(addResponseStep(steps));
          }}
        />
      </div>

      {props.error ? <FieldError message={props.error} /> : <></>}
    </div>
  );
};

export default DetectionRuleResponseStepsField;
