import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  // API.getFriendlyMessage's answer.
  error: string;
  onTryAgain: () => void;
}

/*
 * THE BELL'S LINE WHEN IT COULD NOT CHECK WHO IS ON CALL (#9120).
 *
 * The header reads, on every page, which on-call policies the person is on
 * duty for. When that failed it opened a dialog over whatever page they
 * were on - "Something isnt right, we are unable to fetch on-call
 * policies..." - for a lookup they never asked for, and dropped the reason.
 * Now the bell says it, quietly, where its On-Call section would be: what
 * failed, why (ErrorLine: a failure nobody explained says what to do next,
 * with its reference) and Try again.
 */
const OnCallLookupFailedLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      data-testid="on-call-lookup-failed"
    >
      <Icon
        icon={IconProp.ExclaimationCircle}
        className="mt-0.5 h-5 w-5 flex-none text-red-600"
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-gray-900">
          {t("header.onCallPoliciesFetchError")}
        </p>
        <ErrorLine
          as="div"
          className="mt-1 break-words text-gray-500"
          message={props.error}
          dataTestId="on-call-lookup-failed-reason"
        />
        <button
          type="button"
          className="mt-2 rounded-md font-semibold text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid="on-call-lookup-try-again"
          onClick={props.onTryAgain}
        >
          {translator.translateText("Try again")}
        </button>
      </div>
    </div>
  );
};

export default OnCallLookupFailedLine;
