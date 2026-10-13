import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorFeed, {
  MonitorFeedEventType,
} from "Common/Models/DatabaseModels/MonitorFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import IconProp from "Common/Types/Icon/IconProp";
import useFeedItems, {
  UseFeedItemsResult,
} from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedContent from "Common/UI/Components/Feed/FeedContent";
import {
  FeedEntryKind,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
  getFeedEntryKind,
  getFeedIcons,
} from "Common/UI/Components/Feed/FeedEntryKind";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";

export interface ComponentProps {
  monitorId: ObjectID;
  title?: string | undefined;
  description?: string | undefined;
  /*
   * Bumped by the page when it knows the feed has changed (a status change,
   * an edit), so the new item appears without pressing Refresh.
   */
  refreshToken?: number | undefined;
}

const DEFAULT_TITLE: string = "Monitor Feed";
const DEFAULT_DESCRIPTION: string =
  "Everything that has happened to this monitor, newest first.";

/*
 * What each event type is (FeedEntryKind): its icon and colour, and whether a
 * burst of it folds together. Shared by the feed items and the event type
 * filter's checklist (the feed's ⋯ menu), so the two always match. A status
 * change is drawn in the new status's colour.
 */
export const MONITOR_FEED_KINDS: Record<MonitorFeedEventType, FeedEntryKind> = {
  [MonitorFeedEventType.MonitorCreated]: {
    ...SHARED_FEED_ENTRY_KINDS.Created,
    icon: IconProp.AltGlobe,
  },
  [MonitorFeedEventType.MonitorStatusChanged]:
    SHARED_FEED_ENTRY_KINDS.StateChanged,
  [MonitorFeedEventType.MonitorUpdated]: SHARED_FEED_ENTRY_KINDS.Updated,
  [MonitorFeedEventType.OwnerNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
  [MonitorFeedEventType.SubscriberNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.SubscriberNotificationSent,
  [MonitorFeedEventType.OwnerUserAdded]: SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [MonitorFeedEventType.OwnerTeamAdded]: SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [MonitorFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [MonitorFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [MonitorFeedEventType.OwnerRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
  [MonitorFeedEventType.LabelRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
};

export const MONITOR_FEED_ICONS: Record<MonitorFeedEventType, IconProp> =
  getFeedIcons(MONITOR_FEED_KINDS);

export const getMonitorFeedEventIcon: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return getFeedEntryKind({ kinds: MONITOR_FEED_KINDS, eventType }).icon;
};

const MonitorFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetFeedItemsFromMonitorFeeds = (
    monitorFeeds: MonitorFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromMonitorFeeds: GetFeedItemsFromMonitorFeeds = (
    monitorFeeds: MonitorFeed[],
  ): FeedItemProps[] => {
    return monitorFeeds.map((monitorFeed: MonitorFeed) => {
      return getFeedItemFromMonitorFeed(monitorFeed);
    });
  };

  type GetFeedItemFromMonitorFeed = (monitorFeed: MonitorFeed) => FeedItemProps;

  const getFeedItemFromMonitorFeed: GetFeedItemFromMonitorFeed = (
    monitorFeed: MonitorFeed,
  ): FeedItemProps => {
    const kind: FeedEntryKind = getFeedEntryKind({
      kinds: MONITOR_FEED_KINDS,
      eventType: monitorFeed.monitorFeedEventType,
    });

    return {
      key: monitorFeed.id!.toString(),
      textInMarkdown: monitorFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: monitorFeed.moreInformationInMarkdown || "",
      user: monitorFeed.user,
      itemDateTime: monitorFeed.postedAt || monitorFeed.createdAt!,
      color: getFeedEntryColor({
        kind: kind,
        rowColor: monitorFeed.displayColor,
      }),
      icon: kind.icon,
      burstKind: kind.burst,
      detailsLabel: kind.moreText,
      isNote: kind.isNote,
      eventType: monitorFeed.monitorFeedEventType,
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(MonitorFeedEventType),
    getEventTypeIcon: getMonitorFeedEventIcon,
    storageKey: "monitor",
    resetKey: props.monitorId.toString(),
  });

  const feed: UseFeedItemsResult = useFeedItems<MonitorFeed>({
    resourceKey: props.monitorId.toString(),
    viewKey: feedOptions.optionsKey,
    refreshToken: props.refreshToken,
    getItems: async (limit: number): Promise<ListResult<MonitorFeed>> => {
      return await ModelAPI.getList({
        modelType: MonitorFeed,
        query: {
          monitorId: props.monitorId!,
          ...getFeedEventTypeQuery<MonitorFeed>(
            "monitorFeedEventType",
            feedOptions.options,
          ),
        },
        select: {
          moreInformationInMarkdown: true,
          feedInfoInMarkdown: true,
          displayColor: true,
          createdAt: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
          monitorFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromMonitorFeeds,
  });

  return (
    <FeedCard
      title={props.title || DEFAULT_TITLE}
      description={props.description || DEFAULT_DESCRIPTION}
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
    >
      <div>
        <FeedContent
          feed={feed}
          noItemsMessage={getFeedNoItemsMessage({
            options: feedOptions.options,
            noItemsMessage: "Nothing has happened to this monitor yet.",
          })}
          sortOrder={feedOptions.options.sortOrder}
        />
      </div>
    </FeedCard>
  );
};

export default MonitorFeedElement;
