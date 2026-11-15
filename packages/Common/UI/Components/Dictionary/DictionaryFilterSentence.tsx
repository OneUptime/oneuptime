import {
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "./DictionaryFilterOperator";
import IsolatedText from "../IsolatedText/IsolatedText";
import IsolatedTextList from "../IsolatedText/IsolatedTextList";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import {
  composedValue,
  formatList,
  TemplateValues,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * AN ATTRIBUTE FILTER, SAID AS ONE SENTENCE IN THE READER'S LANGUAGE (#7931).
 *
 * "Filter by Attributes" - a log or trace monitor's criteria, the metric
 * query form, a dashboard table widget - words each operator in the
 * reader's language in its picker. The places that sum a picked filter up
 * drew the operator's English symbol between the key and the value
 * instead: "http.route matches /api/*" in a chip under a German form that
 * said "stimmt überein", and an English word in the middle of a Persian
 * line. And glued in English order, a language that puts its verb last
 * (Japanese, Hindi) could not move it.
 *
 * Each operator is one sentence here, with the key and the value as its
 * slots, so each language orders it. The key and the value are what a
 * person typed - an attribute's name, a path, a glob - so each is set apart
 * as written (IsolatedText): a glob that ends in a star never has its star
 * moved to its start on a Persian page. An operator drawn as a symbol (=,
 * !=, >) has no words to translate, and its sentence is the symbol between
 * the two.
 *
 * Every place that sums an attribute filter up draws it through this file
 * - the filter bar's chip (FilterViewer), a metric query's collapsed chips
 * (MetricQueryConfig) and a metric chart's details (ChartGroup) - and
 * DictionaryFilterSymbolGuard fails on a file that draws an operator's
 * symbol itself.
 */

export const DICTIONARY_FILTER_SENTENCES: Record<
  DictionaryFilterOperator,
  string
> = {
  // A symbol has no words: the sentence is drawn as written in every language.
  [DictionaryFilterOperator.EqualTo]: "{{field}} = {{value}}",
  [DictionaryFilterOperator.NotEqual]: "{{field}} != {{value}}",
  [DictionaryFilterOperator.GreaterThan]: "{{field}} > {{value}}",
  [DictionaryFilterOperator.GreaterThanOrEqual]: "{{field}} >= {{value}}",
  [DictionaryFilterOperator.LessThan]: "{{field}} < {{value}}",
  [DictionaryFilterOperator.LessThanOrEqual]: "{{field}} <= {{value}}",
  // The table filters' chips say these the same way (FilterViewer).
  [DictionaryFilterOperator.IsAnyOf]: translationKey(
    "{{field}} is any of: {{value}}",
  ),
  [DictionaryFilterOperator.IsNoneOf]: translationKey(
    "{{field}} is none of: {{value}}",
  ),
  [DictionaryFilterOperator.Contains]: translationKey(
    "{{field}} contains {{value}}",
  ),
  [DictionaryFilterOperator.NotContains]: translationKey(
    "{{field}} does not contain {{value}}",
  ),
  [DictionaryFilterOperator.StartsWith]: translationKey(
    "{{field}} starts with {{value}}",
  ),
  [DictionaryFilterOperator.EndsWith]: translationKey(
    "{{field}} ends with {{value}}",
  ),
  [DictionaryFilterOperator.Matches]: translationKey(
    "{{field}} matches {{value}}",
  ),
  [DictionaryFilterOperator.NotMatches]: translationKey(
    "{{field}} does not match {{value}}",
  ),
  [DictionaryFilterOperator.IsEmpty]: translationKey("{{field}} is empty"),
  [DictionaryFilterOperator.IsNotEmpty]: translationKey(
    "{{field}} is not empty",
  ),
};

// A yes or no a filter holds, in the reader's words.
const TRUE_WORD: string = translationKey("True");
const FALSE_WORD: string = translationKey("False");

// What a stored attribute filter says: its operator's sentence and its values.
export interface DictionaryFilterReading {
  operator: DictionaryFilterOperator;
  template: string;
  // The values as typed: none for an operator that takes none (is empty).
  values: Array<string>;
  // A yes or no, drawn in the reader's words rather than as typed.
  booleanValue?: boolean | undefined;
}

export const readDictionaryFilter: (
  value: unknown,
) => DictionaryFilterReading = (value: unknown): DictionaryFilterReading => {
  const detected: {
    operator: DictionaryFilterOperator;
    rawValue: string;
    rawValues?: Array<string> | undefined;
  } = detectOperatorFromValue(value);
  const option: DictionaryFilterOperatorOption = getOperatorOption(
    detected.operator,
  );
  const reading: DictionaryFilterReading = {
    operator: option.operator,
    template: DICTIONARY_FILTER_SENTENCES[option.operator],
    values: [],
  };

  if (option.hidesValueInput) {
    return reading;
  }

  if (typeof value === "boolean") {
    return { ...reading, values: [String(value)], booleanValue: value };
  }

  if (option.expectsMultiValue) {
    return { ...reading, values: detected.rawValues ?? [] };
  }

  return { ...reading, values: [detected.rawValue] };
};

// Whether the sentence has a value to say: "is empty" has none.
const hasValueSlot: (reading: DictionaryFilterReading) => boolean = (
  reading: DictionaryFilterReading,
): boolean => {
  return reading.template.includes("{{value}}");
};

const getBooleanWord: (value: boolean, translator: Translator) => string = (
  value: boolean,
  translator: Translator,
): string => {
  const word: string = value ? TRUE_WORD : FALSE_WORD;

  return translator.translateText(word) || word;
};

/*
 * The filter as text, in the reader's language: an aria label, a title, a
 * line that cannot hold elements. Its key and values go in as written, set
 * apart where they could move the words around them.
 */
export const formatDictionaryFilterSentence: (data: {
  attributeKey: string;
  value: unknown;
  translator: Translator;
}) => string = (data: {
  attributeKey: string;
  value: unknown;
  translator: Translator;
}): string => {
  const reading: DictionaryFilterReading = readDictionaryFilter(data.value);
  const values: TemplateValues = { field: data.attributeKey };

  if (hasValueSlot(reading)) {
    values["value"] = composedValue((sentence: Translator): string => {
      if (reading.booleanValue !== undefined) {
        return getBooleanWord(reading.booleanValue, sentence);
      }

      return formatList(reading.values, sentence);
    });
  }

  return data.translator.translateTemplate(reading.template, values);
};

export interface ComponentProps {
  attributeKey: string;
  // The stored value: a bare value (=) or an operator's (contains, is any of).
  value: unknown;
  keyClassName?: string | undefined;
  valueClassName?: string | undefined;
  // The operator's own words between the two: "stimmt überein".
  wordsClassName?: string | undefined;
  dataTestId?: string | undefined;
}

const DictionaryFilterSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const reading: DictionaryFilterReading = readDictionaryFilter(props.value);

  const slots: Record<string, ReactNode> = {
    field: (
      <IsolatedText text={props.attributeKey} className={props.keyClassName} />
    ),
  };

  if (hasValueSlot(reading)) {
    if (reading.booleanValue !== undefined) {
      slots["value"] = (
        <span className={props.valueClassName}>
          {getBooleanWord(reading.booleanValue, translator)}
        </span>
      );
    } else if (reading.values.length === 1) {
      slots["value"] = (
        <IsolatedText
          text={reading.values[0] as string}
          className={props.valueClassName}
        />
      );
    } else {
      slots["value"] = (
        <IsolatedTextList
          texts={reading.values}
          className={props.valueClassName}
        />
      );
    }
  }

  return (
    <span data-testid={props.dataTestId}>
      <TranslatedSentence
        template={reading.template}
        slots={slots}
        renderText={
          props.wordsClassName
            ? (text: string): ReactNode => {
                return <span className={props.wordsClassName}>{text}</span>;
              }
            : undefined
        }
      />
    </span>
  );
};

export default DictionaryFilterSentence;
