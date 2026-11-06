import { getInlineSeparator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What stands between two facts on one line, as the reader's language sets
 * them apart (Types/Translator's getInlineSeparator): " · ", or " • " on a
 * Persian page, where a middle dot beside Persian digits read as a zero -
 * "۱۲ حادثه · ۳ هشدار" looked like "۳ ۰". Drawn where a line wrote its
 * middle dot by hand.
 */
const InlineSeparator: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return <>{getInlineSeparator(translator.language)}</>;
};

export default InlineSeparator;
