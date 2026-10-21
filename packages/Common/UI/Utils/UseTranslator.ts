import { createTranslator, Translator } from "./TranslateTemplate";
import useTranslateValue, { UseTranslateValueResult } from "./Translation";

/*
 * The translation helpers for a shared component: fixed strings, whole
 * sentences with {{placeholders}}, count-dependent sentences, model names in
 * a sentence, and numbers - all in the reader's language, re-rendering when
 * it changes (see TranslateTemplate.ts for how each one falls back to
 * English).
 *
 * It builds them from useTranslateValue()'s translateString rather than
 * reading them off the hook's result, so it keeps working where a test
 * replaces useTranslateValue with a stub that only has translateString and
 * translateValue - as a hundred or so suites in this repository do.
 */
const useTranslator: () => Translator = (): Translator => {
  const translation: Partial<UseTranslateValueResult> = useTranslateValue();

  return createTranslator(translation.translateString, translation.language);
};

export default useTranslator;
