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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";

export interface ComponentProps {
  monitorId: ObjectID;
}

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
    let icon: IconProp = IconProp.Circle;

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.MonitorCreated
    ) {
      icon = IconProp.AltGlobe;
    }

    if (
      monitorFeed.monitorFeedEventType ===
      MonitorFeedEventType.MonitorStatusChanged
    ) {
      icon = IconProp.ArrowCircleRight;
    }

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.MonitorUpdated
    ) {
      icon = IconProp.Edit;
    }

    if (
      monitorFeed.monitorFeedEventType ===
      MonitorFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      monitorFeed.monitorFeedEventType ===
      MonitorFeedEventType.SubscriberNotificationSent
    ) {
      icon = IconProp.Notification;
    }

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.OwnerUserAdded
    ) {
      icon = IconProp.User;
    }

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.OwnerTeamAdded
    ) {
      icon = IconProp.Team;
    }

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.OwnerUserRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      monitorFeed.monitorFeedEventType === MonitorFeedEventType.OwnerTeamRemoved
    ) {
      icon = IconProp.Close;
    }

    return {
      key: monitorFeed.id!.toString(),
      textInMarkdown: monitorFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: monitorFeed.moreInformationInMarkdown || "",
      user: monitorFeed.user,
      itemDateTime: monitorFeed.postedAt || monitorFeed.createdAt!,
      color: monitorFeed.displayColor || Gray500,
      icon: icon,
    };
  };

  const {
    feedItems,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    hasMore,
    isCurrentFeedLoaded,
    refresh,
    loadMore,
  } = useFeedItems<MonitorFeed>({
    resourceKey: props.monitorId.toString(),
    getItems: async (limit: number): Promise<ListResult<MonitorFeed>> => {
      return await ModelAPI.getList({
        modelType: MonitorFeed,
        query: {
          monitorId: props.monitorId!,
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
          postedAt: SortOrder.Descending,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromMonitorFeeds,
  });

  return (
    <Card
      title={"Monitor Feed"}
      description={
        "This is the timeline and feed for this monitor. You can see all the updates and information about this monitor here."
      }
      buttons={[
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
        {(isLoading || !isCurrentFeedLoaded) && <ComponentLoader />}
        {isCurrentFeedLoaded && error && <ErrorMessage message={error} />}
        {isCurrentFeedLoaded && !isLoading && !error && (
          <Feed
            items={feedItems}
            noItemsMessage="Looks like there are no items in this feed for this monitor."
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
