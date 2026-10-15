import React, { FunctionComponent, ReactElement } from "react";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import { translationKey } from "../../../Utils/TranslateTemplate";

/*
 * A sentence of the `@key:` dropdown that names the key being typed (issue
 * #4708): "Loading values for {{key}}...", "Values for {{key}} took too long
 * to load.", "No values to suggest for {{key}} in this time range.".
 *
 * The sentence is in the reader's language, worded whole by the locale. The
 * key is drawn the way the search box and the value rows draw it - in
 * monospace, exactly as typed - so it reads as the thing typed, not as a word
 * of the sentence, and it never goes through translation.
 */

export const ATTRIBUTE_KEY_IN_SENTENCE_TEST_ID: string =
  "attribute-key-in-sentence";

// The dropdown's line while a key's values are on their way.
export const LOADING_ATTRIBUTE_VALUES_SENTENCE: string = translationKey(
  "Loading values for {{key}}...",
);

export interface AttributeKeySentenceProps {
  /*
   * The English sentence with a {{key}} placeholder, which is its
   * translation key: pass a translationKey() constant, so the extractor
   * finds it.
   */
  template: string;
  attributeKey: string;
}

const AttributeKeySentence: FunctionComponent<AttributeKeySentenceProps> = (
  props: AttributeKeySentenceProps,
): ReactElement => {
  return (
    <TranslatedSentence
      template={props.template}
      slots={{
        key: (
          <code
            data-testid={ATTRIBUTE_KEY_IN_SENTENCE_TEST_ID}
            className="font-mono text-[0.8125rem]"
          >
            {props.attributeKey}
          </code>
        ),
      }}
    />
  );
};

export default AttributeKeySentence;
