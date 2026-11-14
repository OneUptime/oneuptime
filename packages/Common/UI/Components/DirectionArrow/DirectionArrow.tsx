import { getArrowBack, getArrowOn } from "../../../Types/DirectionArrow";
import { useSentenceLanguage } from "../../Utils/SentenceLanguage";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Points to what came before ("← Back") instead of on to what comes next.
  pointsBack?: boolean | undefined;
  className?: string | undefined;
  // It only repeats what the words say - a link's "go there" - so it is not read out.
  isDecorative?: boolean | undefined;
  dataTestId?: string | undefined;
}

/*
 * "→" or "←": an arrow that points the way its line is read (Common/Types/
 * DirectionArrow), on to what comes next unless it points back. The line
 * is read in the language of the sentence the arrow stands in - a
 * TranslatedSentence's, which stays English while the reader's language
 * has no wording for it - and in the reader's language everywhere else.
 *
 * Between two values, set each apart (bdi, IsolatedText), so the arrow
 * is the line's and not drawn the way the values beside it read.
 */
const DirectionArrow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const sentenceLanguage: string | null = useSentenceLanguage();
  const language: string = sentenceLanguage ?? translator.language;

  return (
    <span
      className={props.className}
      aria-hidden={props.isDecorative ? true : undefined}
      data-testid={props.dataTestId}
    >
      {props.pointsBack ? getArrowBack(language) : getArrowOn(language)}
    </span>
  );
};

export default DirectionArrow;
