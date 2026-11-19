import { DETECTION_RULE_RESPONSE_STEPS_TEST_IDS } from "./DetectionRuleResponseStepsCopy";
import {
  ResponseStepsOfPart,
  getResponseStepsByPart,
} from "./DetectionRuleResponseStepsModel";
import { RESPONSE_PHASE_TITLES } from "../../SecurityCase/Response/SecurityCaseResponseCopy";
import { ResponsePhase } from "../../SecurityCase/Response/SecurityCaseResponseTypes";
import { DetectionRuleResponseStep } from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A rule's response steps to read (#9621): under each part of the case's
 * Response Plan they go under, in the plan's order and words, each step as
 * its author wrote it. A library rule's details show the steps it comes
 * with this way.
 */

export interface ComponentProps {
  steps: Array<DetectionRuleResponseStep>;
}

const DetectionRuleResponseStepsList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const parts: Array<ResponseStepsOfPart> = getResponseStepsByPart(props.steps);

  return (
    <div
      className="space-y-3"
      data-testid={DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.list}
    >
      {parts.map((part: ResponseStepsOfPart): ReactElement => {
        return (
          <div
            key={part.phase}
            data-testid={`${DETECTION_RULE_RESPONSE_STEPS_TEST_IDS.listPart}-${part.phase}`}
          >
            <h4 className="text-sm font-medium text-gray-900">
              {translator.translateText(
                RESPONSE_PHASE_TITLES[part.phase as string as ResponsePhase],
              )}
            </h4>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-gray-700">
              {part.steps.map(
                (step: DetectionRuleResponseStep): ReactElement => {
                  return (
                    <li key={step.id} className="[overflow-wrap:anywhere]">
                      <IsolatedText text={step.text} />
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
};

export default DetectionRuleResponseStepsList;
