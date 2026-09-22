import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MonitorFeed, {
  MonitorFeedEventType,
} from "Common/Models/DatabaseModels/MonitorFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedOptionsButton from "Common/UI/Components/Feed/FeedOptionsButton";
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
  "This is the timeline and feed for this monitor. You can see all the updates and information about this monitor here.";

/*
 * One icon per event type, shared by the feed items and the event type
 * checklist behind the Filter & Sort button, so the two always match.
 */
export const MONITOR_FEED_ICONS: Record<MonitorFeedEventType, IconProp> = {
  [MonitorFeedEventType.MonitorCreated]: IconProp.AltGlobe,
  [MonitorFeedEventType.MonitorStatusChanged]: IconProp.ArrowCircleRight,
  [MonitorFeedEventType.MonitorUpdated]: IconProp.Edit,
  [MonitorFeedEventType.OwnerNotificationSent]: IconProp.Bell,
  [MonitorFeedEventType.SubscriberNotificationSent]: IconProp.Notification,
  [MonitorFeedEventType.OwnerUserAdded]: IconProp.User,
  [MonitorFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [MonitorFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [MonitorFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [MonitorFeedEventType.OwnerRuleExecuted]: IconProp.Circle,
  [MonitorFeedEventType.LabelRuleExecuted]: IconProp.Circle,
};

export const getMonitorFeedEventIcon: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return (
    MONITOR_FEED_ICONS[eventType as MonitorFeedEventType] || IconProp.Circle
  );
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
    return {
      key: monitorFeed.id!.toString(),
      textInMarkdown: monitorFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: monitorFeed.moreInformationInMarkdown || "",
      user: monitorFeed.user,
      itemDateTime: monitorFeed.postedAt || monitorFeed.createdAt!,
      color: monitorFeed.displayColor || Gray500,
      icon: getMonitorFeedEventIcon(monitorFeed.monitorFeedEventType || ""),
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(MonitorFeedEventType),
    getEventTypeIcon: getMonitorFeedEventIcon,
    storageKey: "monitor",
    resetKey: props.monitorId.toString(),
  });

  const {
    feedItems,
    isLoadingMore,
    error,
    loadMoreError,
    hasMore,
    isCurrentFeedLoaded,
    refresh,
    loadMore,
  } = useFeedItems<MonitorFeed>({
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
    <Card
      title={props.title || DEFAULT_TITLE}
      description={props.description || DEFAULT_DESCRIPTION}
      buttons={[
        <FeedOptionsButton
          key="monitor-feed-options"
          value={feedOptions.options}
          eventTypeOptions={feedOptions.eventTypeOptions}
          onChange={feedOptions.setOptions}
        />,
        {
          title: "Refresh",
          buttonStyle: ButtonStyleType.ICON,
          icon: IconProp.Refresh,
          onClick: async () => {
            await refresh();
          },
        },
      ]}
    >
      <div>
        {/*
         * The loader is for a feed that has not loaded yet (first load, or
         * another monitor). A refresh keeps the items on screen and swaps
         * them when the new page arrives, so a poll never blanks the feed.
         */}
        {!isCurrentFeedLoaded && <ComponentLoader />}
        {isCurrentFeedLoaded && error && <ErrorMessage message={error} />}
        {isCurrentFeedLoaded && !error && (
          <Feed
            items={feedItems}
            noItemsMessage={getFeedNoItemsMessage({
              options: feedOptions.options,
              noItemsMessage:
                "Looks like there are no items in this feed for this monitor.",
            })}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onMore={loadMore}
          />
        )}
        {loadMoreError && <ErrorMessage message={loadMoreError} />}
      </div>
    </Card>
  );
};

export default MonitorFeedElement;
