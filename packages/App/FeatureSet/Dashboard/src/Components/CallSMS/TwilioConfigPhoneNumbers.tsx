import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TwilioConfigNumbersCopy, {
  getTwilioConfigNumberLines,
  TwilioConfigNumberLine,
  TwilioConfigNumbers,
} from "./TwilioConfigNumbersCopy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  config: TwilioConfigNumbers;
}

/*
 * The numbers a Twilio config sends from, in its row of the Twilio Config
 * table: its primary number alone, as before, or - when SMS have numbers of
 * their own - the number calls go out from and the first SMS goes out from,
 * each marked with what it sends: the handset and message icons the row's
 * Send Test Call and Send Test SMS actions use, named for screen readers
 * and on hover (TwilioConfigNumbersCopy). Icons rather than words keep the
 * column as narrow as one number, so the table's other columns stay in view.
 *
 * A line with more numbers of its kind - secondary numbers after the
 * primary one, more SMS numbers after the first - says how many ("+2
 * more"), and lists them on hover: the config's Edit dialog has them all.
 *
 * A number is never cut short: "+14155..." says nothing about which
 * number it is. Where the column is narrow, its "+2 more" goes onto a line
 * of its own under it instead (TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME), so
 * the column needs no more than one number's width - in German the Twilio
 * Config table ran 51px past its card at 1280px beside the side menu.
 */
/*
 * A line of the cell: the icon and the number, which stay together and
 * whole, and the "+2 more", which wraps onto a line of its own where the
 * column is narrow - under the number, the icon's 16px and its 6px gap
 * hung to the left of the line (pl-[22px] on the line, -ml-[22px] on the
 * icon and the number).
 */
export const TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-1.5";

export const TWILIO_CONFIG_NUMBER_LINE_WITH_ICON_CLASS_NAME: string = `${TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME} pl-[22px]`;

export const TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME: string =
  "-ml-[22px] inline-flex items-center gap-1.5 whitespace-nowrap";

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
    <div className="space-y-1" data-testid="twilio-config-phone-numbers">
      {lines.map((line: TwilioConfigNumberLine): ReactElement => {
        const label: string | null = line.label
          ? translator.translateText(line.label) || line.label
          : null;

        const number: ReactElement = (
          <span className="whitespace-nowrap text-gray-900">
            {line.phoneNumber}
          </span>
        );

        return (
          <div
            key={`${line.label || "all"}-${line.phoneNumber}`}
            className={
              label
                ? TWILIO_CONFIG_NUMBER_LINE_WITH_ICON_CLASS_NAME
                : TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME
            }
            title={label || undefined}
          >
            {label ? (
              <span className={TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME}>
                <Icon
                  icon={
                    line.label === TwilioConfigNumbersCopy.smsLabel
                      ? IconProp.SMS
                      : IconProp.Call
                  }
                  size={SizeProp.Small}
                  className="h-4 w-4 flex-none text-gray-400"
                  ariaLabel={label}
                />
                {number}
              </span>
            ) : (
              number
            )}
            {line.otherPhoneNumbers.length > 0 ? (
              <span
                className="whitespace-nowrap text-gray-500"
                title={line.otherPhoneNumbers.join(", ")}
                data-testid="twilio-config-more-phone-numbers"
              >
                {translator.translatePlural(
                  TwilioConfigNumbersCopy.moreNumbers,
                  line.otherPhoneNumbers.length,
                )}
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
