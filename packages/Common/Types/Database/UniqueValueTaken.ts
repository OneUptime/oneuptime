import {
  getRefusalText,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

/*
 * A VALUE ANOTHER RECORD HAS, IN A COLUMN THAT HOLDS EACH VALUE ONCE (#7276).
 *
 * Every column marked unique refused a value another record holds with
 * "{Title} {value} already exists. Please choose a different {Title}": no
 * full stop, and the value run into the sentence with nothing to set it
 * apart. It says now which value is taken, quoted, and what to do.
 *
 * The server fills it in English (getUniqueValueTakenMessage): an API
 * client reads it as it is. The Dashboard reads the column's title and the
 * value back out of it and says the sentence in the reader's language
 * (Common/UI/Utils/ErrorInSentence): the column's title as the reader's
 * word for it, the value as written. The sentence is a key of the
 * Dashboard's locales (this file is a "keys" root of its extractor).
 * React-free and server-safe.
 */
export const UNIQUE_VALUE_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    '{{field}} "{{value}}" already exists. Choose another {{field}}, then try again.',
  ),
  terms: ["field"],
};

// The refusal for `value` of the column titled `field`, in English.
export const getUniqueValueTakenMessage: (data: {
  field: string;
  value: string;
}) => string = (data: { field: string; value: string }): string => {
  return getRefusalText(UNIQUE_VALUE_TAKEN_REFUSAL, {
    field: data.field,
    value: data.value,
  });
};
