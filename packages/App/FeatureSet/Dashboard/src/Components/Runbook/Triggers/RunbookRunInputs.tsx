import { JSONObject } from "Common/Types/JSON";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  RunbookTriggersCopy,
  TriggerDetailCopy,
  translateCopy,
} from "./RunbookTriggersCopy";

/*
 * "Inputs", on a run's page: the values its webhook call sent - or, for a
 * run a security playbook started, the case it was started for - as JSON,
 * and how the steps read them. Drawn as text, never as markup - they came
 * from outside OneUptime, or name what an attacker did.
 */

export interface ComponentProps {
  inputs: JSONObject;
  // What started the run, which says where its inputs came from.
  triggerType?: RunbookTriggerType | undefined;
}

// Where a run's inputs came from, in a sentence: the webhook's caller, or the case.
export function getRunInputsDescription(
  triggerType: RunbookTriggerType | undefined,
): string {
  return triggerType === RunbookTriggerType.SecurityPlaybook
    ? TriggerDetailCopy.playbookInputsCardDescription
    : TriggerDetailCopy.inputsCardDescription;
}

export const RUNBOOK_RUN_INPUTS_TEST_ID: string = "runbook-run-inputs";

// The variable and the argument the description names, drawn as code.
const CODE_CLASS_NAME: string =
  "rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800";

const RunbookRunInputs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const translate: (text: string) => string = (text: string): string => {
    return translateCopy(translator, text);
  };
  const json: string = JSON.stringify(props.inputs, null, 2);

  return (
    <div
      className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3"
      data-testid={RUNBOOK_RUN_INPUTS_TEST_ID}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          {translate(TriggerDetailCopy.inputsCardTitle)}
        </div>
        <CopyTextButton
          textToBeCopied={json}
          label={translate(RunbookTriggersCopy.copyExample)}
          copiedLabel={translate(RunbookTriggersCopy.copied)}
          size="sm"
          variant="soft"
          title={translate(TriggerDetailCopy.copyInputsTitle)}
        />
      </div>
      <p className="mb-2 text-sm text-gray-500">
        <TranslatedSentence
          template={getRunInputsDescription(props.triggerType)}
          slots={{
            bash: (
              <code className={CODE_CLASS_NAME}>
                {props.triggerType === RunbookTriggerType.SecurityPlaybook
                  ? "ONEUPTIME_INPUT_IP"
                  : "ONEUPTIME_INPUT_HOST"}
              </code>
            ),
            javascript: <code className={CODE_CLASS_NAME}>args.inputs</code>,
          }}
        />
      </p>
      <pre className="max-h-80 overflow-auto rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800">
        <code className="font-mono">{json}</code>
      </pre>
    </div>
  );
};

export default RunbookRunInputs;
