import URL from "Common/Types/API/URL";
import {
  getTwilioErrorCodeMeaning,
  getTwilioErrorCodeUrl,
} from "Common/Types/CallAndSMS/TwilioErrorCode";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * AN SMS LOG'S ERROR CODE, SAYING WHAT IT MEANS (#11417).
 *
 * Twilio's code was a bare number: someone reading the log had to look
 * 30003 up elsewhere. It is a link to Twilio's page for the code, in a new
 * tab, and the codes an SMS log most often shows say under it in one plain
 * line what they mean (TwilioErrorCode): "The phone is off or out of
 * reach." A code that is not Twilio's - the HTTP status the server's own
 * SMS and call gateway answered, a network's code - is drawn as written,
 * with nothing to open. The code is an identifier: read from the left on a
 * page read from the right too.
 */

export const SMS_ERROR_CODE_TEST_ID: string = "sms-log-error-code";
export const SMS_ERROR_CODE_LINK_TEST_ID: string = "sms-log-error-code-link";
export const SMS_ERROR_CODE_MEANING_TEST_ID: string =
  "sms-log-error-code-meaning";

// The link's name for a screen reader, and its hover tip.
export const TWILIO_ERROR_CODE_LINK_TITLE: string = translationKey(
  "Twilio's page for error {{code}}, in a new tab",
);

export interface ComponentProps {
  code: string | null | undefined;
}

const SmsErrorCode: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const code: string = (props.code || "").trim();

  if (!code) {
    return <TableEmptyValue />;
  }

  const url: string | null = getTwilioErrorCodeUrl(code);

  if (!url) {
    return (
      <span
        dir="ltr"
        className="text-sm text-gray-900"
        data-testid={SMS_ERROR_CODE_TEST_ID}
      >
        {code}
      </span>
    );
  }

  const meaning: string | null = getTwilioErrorCodeMeaning(code);

  return (
    <div
      className="flex min-w-0 flex-col gap-0.5"
      data-testid={SMS_ERROR_CODE_TEST_ID}
    >
      <Link
        to={URL.fromString(url)}
        openInNewTab={true}
        title={translator.translateTemplate(TWILIO_ERROR_CODE_LINK_TITLE, {
          code: code,
        })}
        isTitleTranslated={true}
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-indigo-700 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:underline"
        dataTestId={SMS_ERROR_CODE_LINK_TEST_ID}
      >
        <span dir="ltr">{code}</span>
        <Icon
          icon={IconProp.ExternalLink}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
      </Link>
      {meaning ? (
        <span
          className="text-xs text-gray-600"
          data-testid={SMS_ERROR_CODE_MEANING_TEST_ID}
        >
          {translator.translateText(meaning) || meaning}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SmsErrorCode;
