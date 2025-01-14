import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ComponentProps as FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  incidentId?: ObjectID;
}

const IncidentFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);

  type GetFeedItemsFromIncidentFeeds = (
    incidentFeeds: IncidentFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromIncidentFeeds: GetFeedItemsFromIncidentFeeds = (
    incidentFeeds: IncidentFeed[],
  ): FeedItemProps[] => {
    return incidentFeeds.map((incidentFeed: IncidentFeed) => {
      return getFeedItemFromIncidentFeed(incidentFeed);
    });
  };

  type GetFeedItemFromIncidentFeed = (
    incidentFeed: IncidentFeed,
  ) => FeedItemProps;

  const getFeedItemFromIncidentFeed: GetFeedItemFromIncidentFeed = (
    incidentFeed: IncidentFeed,
  ): FeedItemProps => {
    let icon: IconProp = IconProp.Circle;

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentCreated
    ) {
      icon = IconProp.Alert;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentStateChanged
    ) {
      icon = IconProp.ArrowCircleRight;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentUpdated
    ) {
      icon = IconProp.Edit;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.SubscriberNotificationSent
    ) {
      icon = IconProp.Notification;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.PublicNote
    ) {
      icon = IconProp.Announcement;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.PrivateNote
    ) {
      icon = IconProp.Lock;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerUserAdded
    ) {
      icon = IconProp.User;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerTeamAdded
    ) {
      icon = IconProp.Team;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.RemediationNotes
    ) {
      icon = IconProp.Wrench;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.RootCause
    ) {
      icon = IconProp.Cube;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerUserRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerTeamRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OnCallNotification
    ) {
      icon = IconProp.Alert;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.OnCallPolicy
    ) {
      icon = IconProp.Call;
    }

    return {
      key: incidentFeed.id!.toString(),
      textInMarkdown: incidentFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: incidentFeed.moreInformationInMarkdown || "",
      user: incidentFeed.user,
      itemDateTime: incidentFeed.postedAt || incidentFeed.createdAt!,
      color: incidentFeed.displayColor || Gray500,
      icon: icon,
    };
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const incidentFeeds: ListResult<IncidentFeed> = await ModelAPI.getList({
        modelType: IncidentFeed,
        query: {
          incidentId: props.incidentId!,
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
          incidentFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      });

      setFeedItems(getFeedItemsFromIncidentFeeds(incidentFeeds.data));
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.incidentId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.incidentId]);

  return (
    <Card
      title={"Incident Feed"}
      description={
        "This is the timeline and feed for this incident. You can see all the updates and information about this incident here."
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
        {error && <ErrorMessage error={error} />}
        {!isLoading && !error && (
          <Feed
            items={feedItems}
            noItemsMessage="Looks like there are no items in this feed for this incident."
          />
        )}
      </div>
    </Card>
  );
};

export default IncidentFeedElement;
