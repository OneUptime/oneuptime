import IconProp from "../../../Types/Icon/IconProp";
import { ProductFeedbackKind } from "../../../Types/ProductFeedback/ProductFeedback";
import ProductFeedback, {
  useProductFeedbackSettings,
} from "../../Utils/ProductFeedback";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "WAS THIS CLEAR?" UNDER AN EXPLANATION (issue #6832).
 *
 * A quiet line under How OneUptime works and under a term's definition:
 * the question and a thumb up and a thumb down. One press answers it,
 * kept on the server (ProductFeedback, kind explanation, the explanation
 * as its topic) with nothing the person wrote, and the line says thanks.
 *
 * Drawn only where OneUptime may ask this person (the server's switch and
 * their own: ProductFeedback.isAskingMe), so a server or a person that
 * turned questions off never sees it, and nor does a page drawn without
 * the Dashboard around it. Once answered, the same explanation says thanks
 * for the rest of the page's life rather than asking again.
 */

export interface ComponentProps {
  // The explanation, as the code names it: "how_oneuptime_works", "term.criteria".
  topic: string;
  className?: string | undefined;
}

export const WAS_THIS_CLEAR_TEST_ID: string = "was-this-clear";
export const WAS_THIS_CLEAR_YES_TEST_ID: string = "was-this-clear-yes";
export const WAS_THIS_CLEAR_NO_TEST_ID: string = "was-this-clear-no";
export const WAS_THIS_CLEAR_THANKS_TEST_ID: string = "was-this-clear-thanks";

export const WAS_THIS_CLEAR_QUESTION: string =
  translationKey("Was this clear?");
export const WAS_THIS_CLEAR_YES: string = translationKey("Yes, it was clear");
export const WAS_THIS_CLEAR_NO: string = translationKey("No, it was not clear");
export const WAS_THIS_CLEAR_THANKS: string = translationKey(
  "Thanks for telling us.",
);

// The explanations answered on this page, so each is asked once.
const answeredTopics: Set<string> = new Set<string>();

export const forgetAnsweredExplanations: () => void = (): void => {
  answeredTopics.clear();
};

const WasThisClear: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Drawn again when the settings arrive or change.
  useProductFeedbackSettings();
  const [isAnswered, setIsAnswered] = useState<boolean>(
    answeredTopics.has(props.topic),
  );

  if (!ProductFeedback.isAskingMe()) {
    return <></>;
  }

  if (isAnswered) {
    return (
      <p
        className={`text-xs text-gray-500 ${props.className || ""}`}
        data-testid={WAS_THIS_CLEAR_THANKS_TEST_ID}
        role="status"
      >
        {translator.translateText(WAS_THIS_CLEAR_THANKS)}
      </p>
    );
  }

  const answer: (isClear: boolean) => void = (isClear: boolean): void => {
    answeredTopics.add(props.topic);
    setIsAnswered(true);
    void ProductFeedback.submit({
      kind: ProductFeedbackKind.Explanation,
      topic: props.topic,
      isPositive: isClear,
    });
  };

  const buttonClassName: string =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

  return (
    <div
      className={`flex items-center gap-1 text-xs text-gray-500 ${props.className || ""}`}
      data-testid={WAS_THIS_CLEAR_TEST_ID}
    >
      <span className="me-1">
        {translator.translateText(WAS_THIS_CLEAR_QUESTION)}
      </span>
      <button
        type="button"
        className={buttonClassName}
        aria-label={translator.translateText(WAS_THIS_CLEAR_YES) || ""}
        title={translator.translateText(WAS_THIS_CLEAR_YES) || ""}
        data-testid={WAS_THIS_CLEAR_YES_TEST_ID}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
          answer(true);
        }}
      >
        <Icon icon={IconProp.HandThumbUp} className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={translator.translateText(WAS_THIS_CLEAR_NO) || ""}
        title={translator.translateText(WAS_THIS_CLEAR_NO) || ""}
        data-testid={WAS_THIS_CLEAR_NO_TEST_ID}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
          answer(false);
        }}
      >
        <Icon icon={IconProp.HandThumbDown} className="h-4 w-4" />
      </button>
    </div>
  );
};

export default WasThisClear;
