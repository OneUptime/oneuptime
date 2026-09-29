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
  onCallDutyPolicyId: ObjectID;
}

/*
 * One icon per event type, shared by the feed items and the event type
 * checklist behind the Filter & Sort button, so the two always match.
 */
export const ON_CALL_DUTY_POLICY_FEED_ICONS: Record<
  OnCallDutyPolicyFeedEventType,
  IconProp
> = {
  [OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated]: IconProp.Call,
  [OnCallDutyPolicyFeedEventType.RosterHandoff]: IconProp.Calendar,
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded]: IconProp.Calendar,
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleRemoved]: IconProp.Close,
  [OnCallDutyPolicyFeedEventType.UserAdded]: IconProp.User,
  [OnCallDutyPolicyFeedEventType.TeamAdded]: IconProp.Team,
  [OnCallDutyPolicyFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [OnCallDutyPolicyFeedEventType.OwnerUserAdded]: IconProp.User,
  [OnCallDutyPolicyFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [OnCallDutyPolicyFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [OnCallDutyPolicyFeedEventType.UserRemoved]: IconProp.Close,
  [OnCallDutyPolicyFeedEventType.TeamRemoved]: IconProp.Close,
  [OnCallDutyPolicyFeedEventType.UserOverrideAdded]: IconProp.Circle,
  [OnCallDutyPolicyFeedEventType.UserOverrideRemoved]: IconProp.Circle,
  [OnCallDutyPolicyFeedEventType.CoverageGapStarted]: IconProp.Circle,
};

export const getOnCallDutyPolicyFeedEventIcon: (
  eventType: string,
) => IconProp = (eventType: string): IconProp => {
  return (
    ON_CALL_DUTY_POLICY_FEED_ICONS[
      eventType as OnCallDutyPolicyFeedEventType
    ] || IconProp.Circle
  );
};

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
      return {
        key: onCallDutyPolicyFeed.id!.toString(),
        textInMarkdown: onCallDutyPolicyFeed.feedInfoInMarkdown || "",
        moreTextInMarkdown:
          onCallDutyPolicyFeed.moreInformationInMarkdown || "",
        user: onCallDutyPolicyFeed.user,
        itemDateTime:
          onCallDutyPolicyFeed.postedAt || onCallDutyPolicyFeed.createdAt!,
        color: onCallDutyPolicyFeed.displayColor || Gray500,
        icon: getOnCallDutyPolicyFeedEventIcon(
          onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType || "",
        ),
      };
    };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(OnCallDutyPolicyFeedEventType),
    getEventTypeIcon: getOnCallDutyPolicyFeedEventIcon,
    storageKey: "on-call-policy",
    resetKey: props.onCallDutyPolicyId.toString(),
  });

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
    viewKey: feedOptions.optionsKey,
    getItems: async (
      limit: number,
    ): Promise<ListResult<OnCallDutyPolicyFeed>> => {
      return await ModelAPI.getList({
        modelType: OnCallDutyPolicyFeed,
        query: {
          onCallDutyPolicyId: props.onCallDutyPolicyId!,
          ...getFeedEventTypeQuery<OnCallDutyPolicyFeed>(
            "onCallDutyPolicyFeedEventType",
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
          onCallDutyPolicyFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
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
        <FeedOptionsButton
          key="on-call-policy-feed-options"
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
        {(isLoading || !isCurrentFeedLoaded) && <ComponentLoader />}
        {isCurrentFeedLoaded && error && <ErrorMessage message={error} />}
        {isCurrentFeedLoaded && !isLoading && !error && (
          <Feed
            items={feedItems}
            noItemsMessage={getFeedNoItemsMessage({
              options: feedOptions.options,
              noItemsMessage:
                "Looks like there are no items in this feed for this onCallDutyPolicy.",
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

export default OnCallDutyPolicyFeedElement;
