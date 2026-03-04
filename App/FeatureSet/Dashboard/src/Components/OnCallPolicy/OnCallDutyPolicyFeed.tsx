import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "Common/Models/DatabaseModels/OnCallDutyPolicyFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
}

const OnCallDutyPolicyFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);

  type GetFeedItemsFromOnCallDutyPolicyFeeds = (
    onCallDutyPolicyFeeds: OnCallDutyPolicyFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromOnCallDutyPolicyFeeds: GetFeedItemsFromOnCallDutyPolicyFeeds =
    (onCallDutyPolicyFeeds: OnCallDutyPolicyFeed[]): FeedItemProps[] => {
      return onCallDutyPolicyFeeds.map(
        (onCallDutyPolicyFeed: OnCallDutyPolicyFeed) => {
          return getFeedItemFromOnCallDutyPolicyFeed(onCallDutyPolicyFeed);
        },
      );
    };

  type GetFeedItemFromOnCallDutyPolicyFeed = (
    onCallDutyPolicyFeed: OnCallDutyPolicyFeed,
  ) => FeedItemProps;

  const getFeedItemFromOnCallDutyPolicyFeed: GetFeedItemFromOnCallDutyPolicyFeed =
    (onCallDutyPolicyFeed: OnCallDutyPolicyFeed): FeedItemProps => {
      let icon: IconProp = IconProp.Circle;

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated
      ) {
        icon = IconProp.Call;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.RosterHandoff
      ) {
        icon = IconProp.Calendar;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded
      ) {
        icon = IconProp.Calendar;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OnCallDutyScheduleRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.UserAdded
      ) {
        icon = IconProp.User;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.TeamAdded
      ) {
        icon = IconProp.Team;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OwnerTeamAdded
      ) {
        icon = IconProp.Team;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OwnerUserAdded
      ) {
        icon = IconProp.User;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OwnerUserRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.OwnerTeamRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.UserRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType ===
        OnCallDutyPolicyFeedEventType.TeamRemoved
      ) {
        icon = IconProp.Close;
      }

      return {
        key: onCallDutyPolicyFeed.id!.toString(),
        textInMarkdown: onCallDutyPolicyFeed.feedInfoInMarkdown || "",
        moreTextInMarkdown:
          onCallDutyPolicyFeed.moreInformationInMarkdown || "",
        user: onCallDutyPolicyFeed.user,
        itemDateTime:
          onCallDutyPolicyFeed.postedAt || onCallDutyPolicyFeed.createdAt!,
        color: onCallDutyPolicyFeed.displayColor || Gray500,
        icon: icon,
      };
    };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const onCallDutyPolicyFeeds: ListResult<OnCallDutyPolicyFeed> =
        await ModelAPI.getList({
          modelType: OnCallDutyPolicyFeed,
          query: {
            onCallDutyPolicyId: props.onCallDutyPolicyId!,
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
            onCallDutyPolicyFeedEventType: true,
            postedAt: true,
          },
          skip: 0,
          sort: {
            postedAt: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });

      setFeedItems(
        getFeedItemsFromOnCallDutyPolicyFeeds(onCallDutyPolicyFeeds.data),
      );
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.onCallDutyPolicyId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.onCallDutyPolicyId]);

  return (
    <Card
      title={"On Call Duty Policy Feed"}
      description={
        "This is the timeline and feed for this on call duty policy. You can see all the updates and information about this on call duty policy here."
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
            noItemsMessage="Looks like there are no items in this feed for this onCallDutyPolicy."
          />
        )}
      </div>
    </Card>
  );
};

export default OnCallDutyPolicyFeedElement;
