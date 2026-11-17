import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Said above a state or status change's log (View Logs) when the check it
 * kept was cut to its size limit (StoredCheckEvidence, #9189), so the
 * reader knows the JSON below is not the whole check.
 */
export interface ComponentProps {
  isTrimmed: boolean;
}

const TrimmedLogNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.isTrimmed) {
    return <></>;
  }

  return (
    <p data-testid="trimmed-log-note" className="mb-3 text-sm text-gray-500">
      {translator.translateText(
        "This check was too large to keep in full, so it was trimmed.",
      )}
    </p>
  );
};

export default TrimmedLogNote;
