import PlaceholderText from "./PlaceholderText";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a detail card shows for a field with no value.
 *
 * The field's own words when it has some ("No logo uploaded."), in the
 * muted grey of a value that is not there. Without them, a dash - the mark
 * a table or a form summary leaves in an empty cell - read out as "Not set"
 * to a screen reader. It used to be nothing at all, so the name of an empty
 * field hung over a blank line and read as if the card had not finished
 * loading.
 */

// The mark an empty value is drawn as, everywhere a detail card draws one.
export const EMPTY_VALUE_MARK: string = "\u2014";

export const EMPTY_VALUE_CLASS_NAME: string = "text-sm text-gray-400";

export const EMPTY_VALUE_TEST_ID: string = "detail-empty-value";

export interface ComponentProps {
  placeholder?: string | undefined;
}

const EmptyValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.placeholder) {
    return <PlaceholderText text={props.placeholder} />;
  }

  return (
    <span className={EMPTY_VALUE_CLASS_NAME} data-testid={EMPTY_VALUE_TEST_ID}>
      <span aria-hidden="true">{EMPTY_VALUE_MARK}</span>
      <span className="sr-only">{translator.translateText("Not set")}</span>
    </span>
  );
};

export default EmptyValue;
