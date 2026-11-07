import { getInlineSeparator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * The mark alone, without the spaces either side of it: for a line whose
   * gap or margins already space its facts, where the dot was a span's
   * whole text.
   */
  markOnly?: boolean | undefined;
}

/*
 * What stands between two facts on one line, as the reader's language sets
 * them apart (Types/Translator's getInlineSeparator): " · ", or " • " on a
 * Persian page, where a middle dot beside Persian digits read as a zero -
 * "۱۲ حادثه · ۳ هشدار" looked like "۳ ۰". Drawn where a line wrote its
 * middle dot by hand.
 */
const InlineSeparator: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const separator: string = getInlineSeparator(translator.language);

  return <>{props.markOnly ? separator.trim() : separator}</>;
};

export default InlineSeparator;
