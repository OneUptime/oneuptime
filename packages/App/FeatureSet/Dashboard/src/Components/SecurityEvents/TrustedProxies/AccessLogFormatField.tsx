import {
  ACCESS_LOG_FORMAT_KNOWN,
  TRUSTED_PROXIES_TEST_IDS,
  getAccessLogFormatSummary,
} from "../SecurityTrustedProxiesCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { isPageRightToLeft } from "Common/UI/Utils/PageLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  AccessLogFormat,
  KNOWN_ACCESS_LOG_FORMATS,
  KnownAccessLogFormat,
  readAccessLogFormat,
} from "Common/Utils/SecurityEvent/LogParsers/AccessLogFormat";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE LOG FORMAT A PROJECT'S ACCESS LOGS ARE WRITTEN IN (#11048), as it is
 * given in the Log Format dialog: a box for the log_format as nginx.conf
 * writes it, a menu of the formats people run to start from (nginx's main,
 * ingress-nginx's upstreaminfo), and under the box, as it is typed, what
 * OneUptime will read of a line in it - where the address that connected
 * is, and where X-Forwarded-For is, or that the format logs none. What is
 * wrong with it is the field's error, worded as the server refuses it.
 */

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
}

const AccessLogFormatField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const format: AccessLogFormat | null = readAccessLogFormat(
    props.value,
  ).format;

  return (
    <div
      className="space-y-2"
      data-testid={TRUSTED_PROXIES_TEST_IDS.accessLogFormatField}
    >
      {/*
       * The known formats at the end of the row above the box, as Check a
       * log line keeps its examples: hanging into the dialog, leftwards in a
       * left-to-right page and rightwards in a right-to-left one.
       */}
      <div className="flex justify-end">
        <MoreMenu
          ariaLabel={ACCESS_LOG_FORMAT_KNOWN}
          isMenuPortaled={true}
          isMenuLeftAligned={isPageRightToLeft()}
          elementToBeShownInsteadOfButton={
            <button
              type="button"
              data-testid={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormatField}-known`}
              className="-me-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {translator.translateText(ACCESS_LOG_FORMAT_KNOWN) ||
                ACCESS_LOG_FORMAT_KNOWN}
              <Icon
                icon={IconProp.ChevronDown}
                className="h-4 w-4 flex-shrink-0"
              />
            </button>
          }
        >
          {KNOWN_ACCESS_LOG_FORMATS.map(
            (known: KnownAccessLogFormat): ReactElement => {
              return (
                <MoreMenuItem
                  key={known.key}
                  text={known.name}
                  icon={IconProp.Logs}
                  dataTestId={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormatField}-known-${known.key}`}
                  onClick={() => {
                    props.onChange(known.text);
                  }}
                />
              );
            },
          )}
        </MoreMenu>
      </div>
      <TextArea
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        rows={5}
        autoGrow={true}
        maxRows={14}
        value={props.value}
        disableSpellCheck={true}
        error={props.error}
        dataTestId={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormatField}-input`}
        onChange={(value: string) => {
          props.onChange(value);
        }}
      />
      {format ? (
        <p
          className="text-sm text-gray-600"
          aria-live="polite"
          data-testid={`${TRUSTED_PROXIES_TEST_IDS.accessLogFormatField}-reads`}
        >
          {getAccessLogFormatSummary(format, translator)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default AccessLogFormatField;
