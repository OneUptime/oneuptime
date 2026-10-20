import {
  AI_TASK_TONE_CLASS_NAMES,
  AITaskTone,
} from "../../Utils/ExceptionAIAssistance";
import {
  FixProductionWords,
  getFixProductionLabel,
  getFixProductionVerdictTone,
} from "../../Utils/FixProduction";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Merged is not fixed: what production showed once a merged AI fix
 * shipped (FixProductionVerifier), wherever the fix is shown - a block with
 * the verdict and the sentence that backs it, or, where a row has room for
 * a word only, a pill whose sentence shows on hover. Told by its tone too:
 * green fixed, red not, gray impossible to tell, blue still on its way.
 */

export interface ComponentProps {
  production: FixProductionWords & { summary?: string | undefined };
  // A pill, for a row that has room for one word.
  isCompact?: boolean | undefined;
  testId?: string | undefined;
  className?: string | undefined;
}

const FixProductionVerdict: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: AITaskTone = getFixProductionVerdictTone(props.production);
  const label: string = translator.translateText(
    getFixProductionLabel(props.production),
  );

  if (props.isCompact) {
    return (
      <span
        data-testid={props.testId || "fix-production-verdict"}
        data-production-status={props.production.status}
        title={props.production.summary || undefined}
        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
          AI_TASK_TONE_CLASS_NAMES[tone]
        } ${props.className || ""}`}
      >
        {label}
      </span>
    );
  }

  return (
    <div
      data-testid={props.testId || "fix-production-verdict"}
      data-production-status={props.production.status}
      className={`max-w-3xl rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
        AI_TASK_TONE_CLASS_NAMES[tone]
      } ${props.className || ""}`}
    >
      <p className="font-medium">{label}</p>
      {props.production.summary ? (
        <p className="mt-1 break-words">{props.production.summary}</p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default FixProductionVerdict;
