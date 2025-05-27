import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);

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

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const monitorFeeds: ListResult<MonitorFeed> = await ModelAPI.getList({
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
        limit: 50,
      });

      // reverse the order of the items
      monitorFeeds.data.reverse();

      setFeedItems(getFeedItemsFromMonitorFeeds(monitorFeeds.data));
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.monitorId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.monitorId]);

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
            await fetchItems();
          },
        },
      ]}
    >
      <div>
        {isLoading && <ComponentLoader />}
        {error && <ErrorMessage message={error} />}
        {!isLoading && !error && (
          <Feed
            items={feedItems}
            noItemsMessage="Looks like there are no items in this feed for this monitor."
          />
        )}
      </div>
    </Card>
  );
};

export default MonitorFeedElement;
