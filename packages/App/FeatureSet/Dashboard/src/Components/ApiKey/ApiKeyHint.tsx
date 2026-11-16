import {
  API_KEY_HINT_TEST_ID,
  ApiKeyShownOnceCopy,
} from "./ApiKeyShownOnceCopy";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW A PROJECT'S API KEY ENDS (#8903): its last four characters, "Ends in
 * 2b34", drawn in place of the key, which is stored as its hash and shown
 * only once (#8902). A person tells one key from another by it, and matches
 * the key they hold against it. The hint is drawn as written, left to right
 * on every page, inside the reader's sentence.
 *
 * A key with no hint - one a failed upgrade left as it was written - draws
 * the quiet dash, as any empty value does.
 */

export interface ComponentProps {
  hint: string | null | undefined;
  isSmall?: boolean | undefined;
}

const ApiKeyHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hint: string = (props.hint || "").trim();

  if (!hint) {
    return <EmptyValue isSmall={props.isSmall} />;
  }

  return (
    <span data-testid={API_KEY_HINT_TEST_ID}>
      <TranslatedSentence
        template={ApiKeyShownOnceCopy.endsIn}
        slots={{
          hint: (
            <code className="font-mono text-gray-900" dir="ltr">
              {hint}
            </code>
          ),
        }}
      />
    </span>
  );
};

export default ApiKeyHint;
