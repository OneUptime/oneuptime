import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "Common/Models/DatabaseModels/OnCallDutyPolicyFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
}

const OnCallDutyPolicyFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
  } = useFeedItems<OnCallDutyPolicyFeed>({
    resourceKey: props.onCallDutyPolicyId.toString(),
    getItems: async (
      limit: number,
    ): Promise<ListResult<OnCallDutyPolicyFeed>> => {
      return await ModelAPI.getList({
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
          postedAt: SortOrder.Descending,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromOnCallDutyPolicyFeeds,
  });

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
            noItemsMessage="Looks like there are no items in this feed for this onCallDutyPolicy."
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

export default OnCallDutyPolicyFeedElement;
