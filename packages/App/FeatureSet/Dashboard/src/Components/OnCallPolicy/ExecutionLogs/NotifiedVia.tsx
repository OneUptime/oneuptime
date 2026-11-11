import IconProp from "Common/Types/Icon/IconProp";
import {
  OnCallPageChannel,
  readOnCallPageChannels,
} from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import Icon from "Common/UI/Components/Icon/Icon";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "NOTIFIED VIA" ON AN ON-CALL RUN'S EXECUTION TIMELINE: the channels each
 * step's page went out to its person by, as the step keeps them
 * (notificationChannels). The person's own notifications say the same, but
 * only that person can read them; whoever reviews the run can read this.
 * How the person answered stays in the record's feed, which says it.
 */
export const NOTIFIED_VIA_TITLE: string = translationKey("Notified Via");

/*
 * Each channel by the name the feed's sentence gives it ("paged Nitin via
 * phone call"). Not the run's chat message's shorter "call" and "push":
 * alone on a label, those read as something else in several languages.
 */
export const NOTIFIED_VIA_CHANNEL_LABELS: Record<OnCallPageChannel, string> = {
  [OnCallPageChannel.Call]: translationKey("Phone call"),
  [OnCallPageChannel.SMS]: translationKey("SMS"),
  [OnCallPageChannel.WhatsApp]: translationKey("WhatsApp"),
  [OnCallPageChannel.Telegram]: translationKey("Telegram"),
  [OnCallPageChannel.Push]: translationKey("Push notification"),
  [OnCallPageChannel.Email]: translationKey("Email"),
  [OnCallPageChannel.Slack]: translationKey("Slack"),
  [OnCallPageChannel.MicrosoftTeams]: translationKey("Microsoft Teams"),
  [OnCallPageChannel.Mattermost]: translationKey("Mattermost"),
  [OnCallPageChannel.Webhook]: translationKey("Webhook"),
  [OnCallPageChannel.CustomChannel]: translationKey("Custom Channel"),
};

/*
 * Each channel's icon, as the person's notification settings and the
 * On-Call Readiness page draw it.
 */
export const NOTIFIED_VIA_CHANNEL_ICONS: Record<OnCallPageChannel, IconProp> = {
  [OnCallPageChannel.Call]: IconProp.Call,
  [OnCallPageChannel.SMS]: IconProp.SMS,
  [OnCallPageChannel.WhatsApp]: IconProp.WhatsApp,
  [OnCallPageChannel.Telegram]: IconProp.Telegram,
  [OnCallPageChannel.Push]: IconProp.Bell,
  [OnCallPageChannel.Email]: IconProp.Email,
  [OnCallPageChannel.Slack]: IconProp.Slack,
  [OnCallPageChannel.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [OnCallPageChannel.Mattermost]: IconProp.Mattermost,
  [OnCallPageChannel.Webhook]: IconProp.Webhook,
  [OnCallPageChannel.CustomChannel]: IconProp.Notification,
};

/*
 * The channels a step kept, in the order the run's message lists them:
 * none for a step that reached nobody, and for one written before steps
 * kept their channels - that it reached nobody is not known.
 */
export const getNotifiedViaChannels: (
  value: unknown,
) => Array<OnCallPageChannel> = (value: unknown): Array<OnCallPageChannel> => {
  return readOnCallPageChannels(value) || [];
};

export interface ComponentProps {
  // The step's notificationChannels, as the API hands it over.
  channels: unknown;
}

/*
 * One step's channels, as small grey chips - the On-Call Readiness page's
 * "Reached via" ones - in the order the run's message lists them, and a
 * dash for none.
 *
 * Two or three to a line, not one long row: at most 16rem wide, which
 * keeps "Phone call", "SMS", "Push notification" and "Email" to two lines
 * in English and in German, and leaves the timeline's other columns their
 * room - beside the side menu the table already scrolls at 1280 pixels.
 * A chip never breaks its name over two lines: alone in a narrow column
 * it is one chip a line, each whole.
 */
const NotifiedVia: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const channels: Array<OnCallPageChannel> = getNotifiedViaChannels(
    props.channels,
  );

  if (channels.length === 0) {
    return <p>-</p>;
  }

  return (
    <div
      data-testid="on-call-timeline-notified-via"
      className="flex min-w-0 max-w-[16rem] flex-wrap gap-1"
    >
      {channels.map((channel: OnCallPageChannel): ReactElement => {
        /*
         * A div, as the table's other chips are: the Icon draws a div,
         * which a span cannot hold.
         */
        return (
          <div
            key={channel}
            data-testid="on-call-timeline-notified-via-channel"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
          >
            <Icon
              icon={NOTIFIED_VIA_CHANNEL_ICONS[channel]}
              className="h-3 w-3 flex-shrink-0 text-gray-500"
            />
            <span>
              {translator.translateText(NOTIFIED_VIA_CHANNEL_LABELS[channel])}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default NotifiedVia;
