import { COULD_NOT_LOAD_USED_BY_WITH_ERROR, TRY_AGAIN } from "./UsedByWords";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What uses the record could not be read: the server's sentence (which
 * says what to do), and Try again.
 */
const UsedByError: FunctionComponent<{
  message: string;
  onTryAgain: () => void;
}> = (props: { message: string; onTryAgain: () => void }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="used-by-error">
      <p className="text-sm text-gray-600">
        {translator.translateTemplate(COULD_NOT_LOAD_USED_BY_WITH_ERROR, {
          error: translator.translateText(props.message) || props.message,
        })}
      </p>
      <button
        type="button"
        className="mt-2 text-sm font-medium text-indigo-700 hover:underline"
        data-testid="used-by-try-again"
        onClick={() => {
          props.onTryAgain();
        }}
      >
        {translator.translateText(TRY_AGAIN)}
      </button>
    </div>
  );
};

export default UsedByError;
