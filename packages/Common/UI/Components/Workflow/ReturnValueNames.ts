import { ReturnValue } from "../../../Types/Workflow/Component";
import { typeLabelForInputType } from "./ValuePicker/ValueSuggestion";
import {
  DEFAULT_LANGUAGE,
  createTranslator,
  translatableTerm,
  translationKey,
  Translator,
} from "../../../Types/Translator";

/*
 * A STEP'S RETURNED VALUES, IN THE READER'S LANGUAGE (#8316).
 *
 * A step's catalogue names what it returns - Request Body, Response
 * Headers, Incident ID - and a workflow reads each one by its id, which a
 * reference stores as written:
 * {{local.components.webhook-1.returnValues.request-body}}. The builder
 * draws a step's settings and outputs in the reader's language, and its
 * returned values were the one name left in English: the settings
 * panel's Returns list wrote "Response Body" beside a copy button its
 * German reader read as "Antworttext", and the value picker listed it the
 * same way.
 *
 * Every place that names a returned value draws it with these: the
 * Returns list, the value picker and the chip a reference shows. The
 * name is in the reader's language where the Dashboard's locale has the
 * words, in English where it has not, and the id is never translated.
 * Without a translator (a unit test, the server) they write English.
 */

// "The whole Request Body": the picker's first item inside a value.
export const WHOLE_VALUE_TEMPLATE: string =
  translationKey("The whole {{name}}");

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

type ReturnValueWords = Pick<ReturnValue, "id" | "name">;

export type ReturnValueNameFunction = (
  returnValue: ReturnValueWords,
  translator?: Translator | undefined,
) => string;

// The value's name as the reader's language words it; its id when it has none.
export const returnValueName: ReturnValueNameFunction = (
  returnValue: ReturnValueWords,
  translator: Translator | undefined = ENGLISH,
): string => {
  if (!returnValue.name) {
    return returnValue.id;
  }

  return translator.translateText(returnValue.name) || returnValue.name;
};

export type ReturnValueDescriptionFunction = (
  returnValue: Pick<ReturnValue, "description">,
  translator?: Translator | undefined,
) => string;

// What the value holds, in a sentence, as the reader's language words it.
export const returnValueDescription: ReturnValueDescriptionFunction = (
  returnValue: Pick<ReturnValue, "description">,
  translator: Translator | undefined = ENGLISH,
): string => {
  if (!returnValue.description) {
    return "";
  }

  return (
    translator.translateText(returnValue.description) || returnValue.description
  );
};

export type WholeReturnValueLabelFunction = (
  returnValue: ReturnValueWords,
  translator?: Translator | undefined,
) => string;

/*
 * "The whole Request Body", one sentence: in the reader's language with
 * the value named in it, or wholly English while the language has no
 * wording of the sentence (translatableTerm).
 */
export const wholeReturnValueLabel: WholeReturnValueLabelFunction = (
  returnValue: ReturnValueWords,
  translator: Translator | undefined = ENGLISH,
): string => {
  return translator.translateTemplate(WHOLE_VALUE_TEMPLATE, {
    name: returnValue.name
      ? translatableTerm(returnValue.name)
      : returnValue.id,
  });
};

export type ReturnValueTypeLabelFunction = (
  returnValue: Pick<ReturnValue, "type">,
  translator?: Translator | undefined,
) => string;

/*
 * The kind of value a step returns, in the words the value picker names it
 * by ("Key / value", "Record", "Yes / No"), in the reader's language
 * (#8361). A step's Returns list drew the code's type name instead
 * ("Dictionary of String"), in English in every language. A type the
 * picker has no word for keeps its own name.
 */
export const returnValueTypeLabel: ReturnValueTypeLabelFunction = (
  returnValue: Pick<ReturnValue, "type">,
  translator: Translator | undefined = ENGLISH,
): string => {
  const label: string | undefined = typeLabelForInputType(returnValue.type);

  if (!label) {
    return returnValue.type;
  }

  return translator.translateText(label) || label;
};
