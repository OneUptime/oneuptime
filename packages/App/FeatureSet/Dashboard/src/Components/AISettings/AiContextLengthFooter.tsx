import {
  AI_CONTEXT_OUTLINE_BUTTON_TEXT,
  AI_CONTEXT_TEST_IDS,
  AiContextLength,
  describeAiContextLength,
  getAiContextLength,
  getAiContextOutline,
} from "./AiContextCopy";
import { AiContextOwner } from "Common/Types/AI/AiContext";
import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value: unknown;
  owner: AiContextOwner;
  /*
   * Lets the footer fill an empty field with the outline (FieldFooterProps,
   * handed in by the form). Without it, no outline is offered.
   */
  footer?: FieldFooterProps | undefined;
  // Offer "Start from an outline" while the field is empty.
  offersOutline?: boolean | undefined;
}

/*
 * Under an AI context field, as it is written: how much of its limit the
 * text takes and about how many tokens a model reads it as - "1,234 of
 * 20,000 characters · about 310 tokens" - in red once it is past the limit,
 * which the field's own error then explains. While the project's field is
 * empty, a way to start: an outline with a heading for each kind of note
 * (how the systems fit together, who owns what, where the logs are, the
 * words the team uses).
 *
 * Close under its box, a field's gap above the next field (mb-2), as the
 * rule fields' hints are.
 */
const AiContextLengthFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const length: AiContextLength = getAiContextLength({
    value: props.value,
    owner: props.owner,
  });

  const showsOutline: boolean =
    props.offersOutline === true &&
    Boolean(props.footer) &&
    length.characterCount === 0;

  return (
    <div className="mt-1.5 mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
      <span
        data-testid={AI_CONTEXT_TEST_IDS.length}
        className={
          length.isTooLong ? "font-medium text-red-600" : "text-gray-500"
        }
      >
        {describeAiContextLength(length, translator)}
      </span>
      {showsOutline ? (
        <button
          type="button"
          data-testid={AI_CONTEXT_TEST_IDS.outlineButton}
          className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
          onClick={() => {
            props.footer?.setValue(getAiContextOutline(translator));
          }}
        >
          {translator.translateText(AI_CONTEXT_OUTLINE_BUTTON_TEXT)}
        </button>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AiContextLengthFooter;
