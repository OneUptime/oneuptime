import Phone from "Common/Types/Phone";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  getTwilioConfigNumberLines,
  TwilioConfigNumberLine,
} from "./TwilioConfigNumbersCopy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  config: {
    twilioPrimaryPhoneNumber?: Phone | string | null | undefined;
    twilioSmsPhoneNumbers?: string | null | undefined;
  };
}

/*
 * The numbers a Twilio config sends from, in its row of the Twilio Config
 * table: its primary number alone, as before, or - when SMS have numbers of
 * their own - the number calls go out from and the first SMS goes out from,
 * each saying which it sends (TwilioConfigNumbersCopy).
 */
const TwilioConfigPhoneNumbers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const lines: Array<TwilioConfigNumberLine> = getTwilioConfigNumberLines(
    props.config,
  );

  if (lines.length === 0) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <div className="space-y-0.5" data-testid="twilio-config-phone-numbers">
      {lines.map((line: TwilioConfigNumberLine): ReactElement => {
        return (
          <div
            key={`${line.label || "all"}-${line.phoneNumber}`}
            className="flex items-baseline gap-2"
          >
            <span className="text-gray-900">{line.phoneNumber}</span>
            {line.label ? (
              <span className="text-xs text-gray-500">
                {translator.translateText(line.label)}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TwilioConfigPhoneNumbers;
