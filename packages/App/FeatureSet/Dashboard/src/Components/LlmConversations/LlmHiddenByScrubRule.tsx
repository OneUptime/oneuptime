import React, { FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * WHERE AN AI CALL'S PERSON OR TEAM WOULD BE, ONCE A SCRUB RULE HID EVERY
 * NAME IT HAD (#10435, #10631).
 *
 * The Usage tab's hidden row, a conversation's person (in the list and on
 * the conversation) and the Calls table's User and Team cells all say
 * "Hidden by a scrub rule" where the readers answer the hidden key
 * (Common/Utils/Telemetry/LlmCallIdentity): never "[REDACTED]", a mask or a
 * token as if it were somebody. Drawn muted, on a grey ground, so it never
 * reads as a person's name - and apart from a call that names nobody, which
 * shows no one at all: a person unknown is not a person withheld.
 */
export const LLM_HIDDEN_BY_A_SCRUB_RULE: string = translationKey(
  "Hidden by a scrub rule",
);

export const LLM_HIDDEN_BY_A_SCRUB_RULE_TEST_ID: string =
  "llm-hidden-by-scrub-rule";

// The words, in the reader's language: for a cell's export, or any text.
export function getLlmHiddenByScrubRuleText(translator: Translator): string {
  return (
    translator.translateText(LLM_HIDDEN_BY_A_SCRUB_RULE) ||
    LLM_HIDDEN_BY_A_SCRUB_RULE
  );
}

export interface ComponentProps {
  dataTestId?: string | undefined;
}

const LlmHiddenByScrubRule: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
      data-testid={props.dataTestId || LLM_HIDDEN_BY_A_SCRUB_RULE_TEST_ID}
    >
      {getLlmHiddenByScrubRuleText(translator)}
    </span>
  );
};

export default LlmHiddenByScrubRule;
