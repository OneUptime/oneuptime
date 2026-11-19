import {
  ChannelReach,
  NotificationChannelDefinition,
  NotificationChannelKey,
  canChannelReach,
  getChannelWord,
} from "./NotificationChannelReadiness";
import { formatNameList } from "../AiAccess/AiAccessModes";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { isNotificationChannelOfferedForEvent } from "Common/Types/WhatsApp/WhatsAppEventTemplates";
import {
  PluralTemplate,
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of User Settings > Notification Settings that are not an event's
 * or a card's: its first line, the channels it cannot use yet, the names a
 * screen reader hears for its switches, and each tab's summary. Each is a
 * whole sentence, wrapped in translationKey() so npm run i18n:extract finds
 * it, and kept free of React so a test can read the exact words.
 */

export const NotificationSettingsWords: {
  // The page's first line: what it is for.
  intro: string;
  // ...and where the two pages it is mistaken for are.
  introSiblings: string;
  // Before the channels that cannot reach the person yet.
  notSetUpChannels: string;
  // A channel that cannot reach the person yet, as a link to set it up.
  setUpChannel: string;
  // Under a column whose channel has no verified method behind it.
  setUp: string;
  // Under a column whose channel the project or the server has off.
  turnedOff: string;
  // Beside a switch whose channel has no verified method behind it (phones).
  notSetUp: string;
  // The first row of a card: a switch per channel for all its events.
  allEvents: string;
  // A switch's name: its channel, for its event.
  channelForEvent: string;
  // An "All events" switch's name: its channel, for every event of its card.
  channelForEveryEvent: string;
  /*
   * Under an event a channel cannot send at all - WhatsApp, for an event it
   * has no approved template for (#9715) - where its switch would be.
   */
  notAvailableForEvent: string;
  // Under a card none of whose events a channel can send, which is no column of it.
  notAvailableForEvents: string;
} = {
  intro: translationKey(
    "Choose which updates reach you, and on which channels.",
  ),
  introSiblings: translationKey(
    "On-call pages follow {{howToReachMe}}, and {{emailPreferences}} sets how much email you get.",
  ),
  notSetUpChannels: translationKey("Channels not set up yet"),
  setUpChannel: translationKey("Set up {{channel}}"),
  setUp: translationKey("Set up"),
  turnedOff: translationKey("Turned off"),
  notSetUp: translationKey("Not set up"),
  allEvents: translationKey("All events"),
  channelForEvent: translationKey("{{channel}} for {{event}}"),
  channelForEveryEvent: translationKey(
    "{{channel}} for every event in {{section}}",
  ),
  notAvailableForEvent: translationKey(
    "{{channel}} is not available for this event.",
  ),
  notAvailableForEvents: translationKey(
    "{{channel}} is not available for these events.",
  ),
};

/*
 * A tab's summary, over its cards: how many of its events reach the person,
 * out of how many, and by which channels. The count of events is the one the
 * sentence's noun agrees with; the number that reach them is written in the
 * reader's digits beside it.
 */
export const TAB_SUMMARY: PluralTemplate = {
  one: "You hear about {{on}} of {{count}} event on this tab, by {{channels}}.",
  other:
    "You hear about {{on}} of {{count}} events on this tab, by {{channels}}.",
};

export const TAB_SUMMARY_NONE: string = translationKey(
  "You hear about none of the events on this tab.",
);

// A channel of the matrix, as the page offers it: its column and whether it can reach the person.
export interface OfferedChannel {
  definition: NotificationChannelDefinition;
  reach: ChannelReach;
}

export interface TabSummaryFacts {
  // How many of the tab's events reach the person.
  reaching: number;
  // How many events the tab lists.
  total: number;
  // The channels they reach the person by, in the matrix's order.
  channels: Array<NotificationChannelDefinition>;
}

/*
 * An event reaches the person when a channel that can reach them is on for
 * it. A switch on a channel that cannot (no verified method, or turned off)
 * sends nothing, so it is not counted - nor is a workspace the project has
 * not connected, whose column is not offered at all, nor a channel that
 * cannot send the event (WhatsApp with no approved template, #9715).
 */
export const getTabSummaryFacts: (data: {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: ReadonlyMap<
    NotificationSettingEventType,
    UserNotificationSetting
  >;
  channels: ReadonlyArray<OfferedChannel>;
}) => TabSummaryFacts = (data: {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: ReadonlyMap<
    NotificationSettingEventType,
    UserNotificationSetting
  >;
  channels: ReadonlyArray<OfferedChannel>;
}): TabSummaryFacts => {
  const reachingChannels: Array<OfferedChannel> = data.channels.filter(
    (channel: OfferedChannel): boolean => {
      return canChannelReach(channel.reach);
    },
  );

  const isOn: (
    eventType: NotificationSettingEventType,
    key: NotificationChannelKey,
  ) => boolean = (
    eventType: NotificationSettingEventType,
    key: NotificationChannelKey,
  ): boolean => {
    const row: UserNotificationSetting | undefined =
      data.rowsByEvent.get(eventType);

    return (
      Boolean(row && (row as unknown as Record<string, unknown>)[key]) &&
      isNotificationChannelOfferedForEvent({
        channel: key,
        eventType: eventType,
      })
    );
  };

  const reaching: number = data.eventTypes.filter(
    (eventType: NotificationSettingEventType): boolean => {
      return reachingChannels.some((channel: OfferedChannel): boolean => {
        return isOn(eventType, channel.definition.key);
      });
    },
  ).length;

  return {
    reaching: reaching,
    total: data.eventTypes.length,
    channels: reachingChannels
      .filter((channel: OfferedChannel): boolean => {
        return data.eventTypes.some(
          (eventType: NotificationSettingEventType): boolean => {
            return isOn(eventType, channel.definition.key);
          },
        );
      })
      .map((channel: OfferedChannel): NotificationChannelDefinition => {
        return channel.definition;
      }),
  };
};

// The summary, in the reader's language: one sentence, its channels listed as the language lists names.
export const describeTabSummary: (
  facts: TabSummaryFacts,
  translator: Translator,
) => string = (facts: TabSummaryFacts, translator: Translator): string => {
  if (facts.reaching === 0) {
    return translator.translateText(TAB_SUMMARY_NONE) || TAB_SUMMARY_NONE;
  }

  return translator.translatePlural(TAB_SUMMARY, facts.total, {
    on: translator.formatNumber(facts.reaching),
    channels: composedValue((sentence: Translator): string => {
      return formatNameList(
        facts.channels.map((channel: NotificationChannelDefinition): string => {
          return (
            sentence.translateText(getChannelWord(channel)) || channel.label
          );
        }),
        "and",
        sentence,
      );
    }),
  });
};
