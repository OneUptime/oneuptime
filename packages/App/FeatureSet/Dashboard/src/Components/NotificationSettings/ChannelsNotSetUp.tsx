import {
  ChannelReach,
  getChannelSetUpRoute,
  getChannelWord,
} from "./NotificationChannelReadiness";
import {
  NotificationSettingsWords,
  OfferedChannel,
} from "./NotificationSettingsWords";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE CHANNELS THAT CANNOT REACH THE PERSON YET, AND WHERE TO SET THEM UP.
 *
 * A channel with no verified method of the person's behind it is no column
 * of the matrix (NotificationChannelReadiness): a switch on it would send
 * nothing. It is named here instead, once for the page, each name a link to
 * the tab of Notification Methods that sets it up - a phone number for SMS,
 * a device for push. Once it can reach the person it is a column.
 *
 * A channel the project or the server has turned off is not named: the
 * person cannot set it up, and Notification Methods says who can. With
 * every channel set up, there is nothing here.
 */

export const CHANNELS_NOT_SET_UP_TEST_ID: string = "channels-not-set-up";

export const CHANNEL_SET_UP_LINK_TEST_ID: string = "channel-set-up-link";

// The channels to name: those the person can set up, in the matrix's order.
export const getChannelsToSetUp: (
  channels: ReadonlyArray<OfferedChannel>,
) => Array<OfferedChannel> = (
  channels: ReadonlyArray<OfferedChannel>,
): Array<OfferedChannel> => {
  return channels.filter((channel: OfferedChannel): boolean => {
    return (
      channel.reach === ChannelReach.NotSetUp &&
      getChannelSetUpRoute(channel.definition.key) !== null
    );
  });
};

export interface ComponentProps {
  channels: ReadonlyArray<OfferedChannel>;
}

const ChannelsNotSetUp: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const toSetUp: Array<OfferedChannel> = getChannelsToSetUp(props.channels);

  if (toSetUp.length === 0) {
    return <></>;
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid={CHANNELS_NOT_SET_UP_TEST_ID}
    >
      <span className="text-sm text-gray-500">
        {translator.translateText(NotificationSettingsWords.notSetUpChannels)}
      </span>
      <ul className="flex flex-wrap items-center gap-2">
        {toSetUp.map((channel: OfferedChannel) => {
          const route: Route = getChannelSetUpRoute(channel.definition.key)!;

          return (
            <li key={channel.definition.key}>
              <Link
                to={route}
                dataTestId={CHANNEL_SET_UP_LINK_TEST_ID}
                title={translator.translateTemplate(
                  NotificationSettingsWords.setUpChannel,
                  {
                    channel: translatableTerm(
                      getChannelWord(channel.definition),
                    ),
                  },
                )}
                isTitleTranslated={true}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-400 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
                <span>
                  {translator.translateText(getChannelWord(channel.definition))}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ChannelsNotSetUp;
