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
 * The cell gives way before the table scrolls sideways (data-table-shrinks,
 * the Table's give-way): a number ends in "...", its icon and its "+2
 * more" kept whole. In German the Twilio Config table ran 51px past its
 * card at 1280px beside the side menu.
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
    <div
      className="space-y-1"
      data-testid="twilio-config-phone-numbers"
      data-table-shrinks="true"
    >
      {lines.map((line: TwilioConfigNumberLine): ReactElement => {
        const label: string | null = line.label
          ? translator.translateText(line.label) || line.label
          : null;

        return (
          <div
            key={`${line.label || "all"}-${line.phoneNumber}`}
            className="flex min-w-0 items-center gap-1.5"
            title={label || undefined}
          >
            {label ? (
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
            ) : (
              <></>
            )}
            <span className="min-w-0 truncate text-gray-900">
              {line.phoneNumber}
            </span>
            {line.otherPhoneNumbers.length > 0 ? (
              <span
                className="flex-none whitespace-nowrap text-gray-500"
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
