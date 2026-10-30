import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A LIST OF WORDS IN A FORM: TYPE ONE, PRESS ENTER, AND IT IS A CHIP.
 *
 * Data Security keeps several settings as lists a person writes - a data
 * type's keywords and field names, the regions a residency rule allows, the
 * values a project says are never sensitive - each a JSON column holding a
 * list of strings. They are edited here as chips: typed and added with
 * Enter, removed with their ×, never as JSON. A field can offer common
 * values to pick (suggestions) and say how a typed value is written down
 * (normalize: trimmed and lower-cased for a region, say) - the way the
 * server saves it, so what is shown is what is stored.
 */

export const WORD_LIST_ADD_LABEL: string = translationKey("Add {{value}}");

export const WORD_LIST_EMPTY_MENU: string = translationKey(
  "Type a value and press Enter to add it.",
);

// A word as written: trimmed. A field may write it down otherwise.
export const keepWordAsWritten: (word: string) => string = (
  word: string,
): string => {
  return word.trim();
};

// Trimmed and lower-cased: keywords, field names and regions are saved so.
export const lowerCaseWord: (word: string) => string = (
  word: string,
): string => {
  return word.trim().toLowerCase();
};

/*
 * The words a form value holds: a list of strings, or text with one to a
 * line (or a comma), each written down by `normalize`, empty ones and
 * repeats left out, in the order given.
 */
export const readWordList: (
  value: unknown,
  normalize?: (word: string) => string,
) => Array<string> = (
  value: unknown,
  normalize: (word: string) => string = keepWordAsWritten,
): Array<string> => {
  let words: Array<unknown> = [];

  if (Array.isArray(value)) {
    words = value;
  } else if (typeof value === "string") {
    words = value.split(/[\n,]/);
  }

  const list: Array<string> = [];

  for (const word of words) {
    const text: unknown =
      word !== null && typeof word === "object" && "value" in word
        ? (word as { value: unknown }).value
        : word;

    if (typeof text !== "string" && typeof text !== "number") {
      continue;
    }

    const written: string = normalize(String(text));

    if (written.length > 0 && !list.includes(written)) {
      list.push(written);
    }
  }

  return list;
};

export interface WordListInputProps {
  value: unknown;
  onChange: (words: Array<string>) => void;
  onBlur?: (() => void) | undefined;
  // English; the dropdown translates it.
  placeholder?: string | undefined;
  normalize?: ((word: string) => string) | undefined;
  // Values offered to pick, besides what is typed.
  suggestions?: ReadonlyArray<string> | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

// A word as an option: drawn as written, never looked up as a translation.
const toOption: (word: string) => DropdownOption = (
  word: string,
): DropdownOption => {
  return { value: word, label: word, isUserContent: true };
};

export const WordListInput: FunctionComponent<WordListInputProps> = (
  props: WordListInputProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const normalize: (word: string) => string =
    props.normalize || keepWordAsWritten;
  const words: Array<string> = readWordList(props.value, normalize);

  const options: Array<DropdownOption> = readWordList(
    props.suggestions ? [...props.suggestions] : [],
    normalize,
  )
    .filter((word: string): boolean => {
      return !words.includes(word);
    })
    .map(toOption);

  return (
    <Dropdown
      isMultiSelect={true}
      isCreatable={true}
      options={options}
      value={words.map(toOption)}
      placeholder={props.placeholder}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      error={props.error}
      dataTestId={props.dataTestId}
      onBlur={props.onBlur}
      formatCreateLabel={(inputValue: string): string => {
        return translator.translateTemplate(WORD_LIST_ADD_LABEL, {
          value: normalize(inputValue),
        });
      }}
      noOptionsMessage={(): string => {
        return (
          translator.translateText(WORD_LIST_EMPTY_MENU) || WORD_LIST_EMPTY_MENU
        );
      }}
      onChange={(value: DropdownValue | Array<DropdownValue> | null): void => {
        const picked: Array<DropdownValue> = Array.isArray(value)
          ? value
          : value === null
            ? []
            : [value];

        props.onChange(readWordList(picked, normalize));
      }}
    />
  );
};

export interface WordListElementOptions {
  // The column the list is kept in.
  column: string;
  placeholder?: string | undefined;
  normalize?: ((word: string) => string) | undefined;
  suggestions?: ReadonlyArray<string> | undefined;
  dataTestId?: string | undefined;
}

// The element a list field draws, from the form's values as they are now.
const drawWordList: (
  options: WordListElementOptions,
  values: Record<string, unknown> | undefined,
  props: CustomElementProps,
) => ReactElement = (
  options: WordListElementOptions,
  values: Record<string, unknown> | undefined,
  props: CustomElementProps,
): ReactElement => {
  return React.createElement(WordListInput, {
    value: values?.[options.column],
    onChange: (words: Array<string>): void => {
      props.onChange?.(words);
    },
    onBlur: props.onBlur,
    placeholder: options.placeholder,
    normalize: options.normalize,
    suggestions: options.suggestions,
    ariaLabelledby: props.ariaLabelledby,
    ariaDescribedby: props.ariaDescribedby,
    error: props.error,
    dataTestId: options.dataTestId,
  });
};

/*
 * A form field's getCustomElement for a list of words kept in `column`:
 * the field keeps its own label and help above it, as any field does.
 */
export const getWordListElement: <TEntity>(
  options: WordListElementOptions,
) => (
  values: FormValues<TEntity>,
  props: CustomElementProps,
) => ReactElement = <TEntity,>(
  options: WordListElementOptions,
): ((
  values: FormValues<TEntity>,
  props: CustomElementProps,
) => ReactElement) => {
  return (
    values: FormValues<TEntity>,
    props: CustomElementProps,
  ): ReactElement => {
    return drawWordList(
      options,
      values as Record<string, unknown> | undefined,
      props,
    );
  };
};
