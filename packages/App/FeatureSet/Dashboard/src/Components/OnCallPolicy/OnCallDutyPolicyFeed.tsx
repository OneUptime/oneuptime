import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "Common/Models/DatabaseModels/OnCallDutyPolicyFeed";
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
  FeedTone,
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
  onCallDutyPolicyId: ObjectID;
}

/*
 * What each event type is (FeedEntryKind): its icon and colour. Shared by the
 * feed items and the event type filter's checklist (the feed's ⋯ menu), so
 * the two always match.
 */
export const ON_CALL_DUTY_POLICY_FEED_KINDS: Record<
  OnCallDutyPolicyFeedEventType,
  FeedEntryKind
> = {
  [OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated]: {
    ...SHARED_FEED_ENTRY_KINDS.Created,
    icon: IconProp.Call,
  },
  // Someone's turn on call starting or ending.
  [OnCallDutyPolicyFeedEventType.RosterHandoff]: {
    icon: IconProp.ArrowPath,
    tone: FeedTone.Info,
  },
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded]: {
    icon: IconProp.Calendar,
    tone: FeedTone.Neutral,
  },
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleRemoved]: {
    icon: IconProp.Calendar,
    tone: FeedTone.Neutral,
  },
  [OnCallDutyPolicyFeedEventType.UserAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [OnCallDutyPolicyFeedEventType.TeamAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [OnCallDutyPolicyFeedEventType.OwnerTeamAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [OnCallDutyPolicyFeedEventType.OwnerUserAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [OnCallDutyPolicyFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [OnCallDutyPolicyFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [OnCallDutyPolicyFeedEventType.UserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [OnCallDutyPolicyFeedEventType.TeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  // Someone covering for someone else.
  [OnCallDutyPolicyFeedEventType.UserOverrideAdded]: {
    icon: IconProp.ArrowUturnRight,
    tone: FeedTone.Warning,
  },
  [OnCallDutyPolicyFeedEventType.UserOverrideRemoved]: {
    icon: IconProp.ArrowUturnLeft,
    tone: FeedTone.Neutral,
  },
  // Nobody on call: the one entry here that needs someone to act.
  [OnCallDutyPolicyFeedEventType.CoverageGapStarted]: {
    icon: IconProp.ExclaimationCircle,
    tone: FeedTone.Danger,
  },
};

export const ON_CALL_DUTY_POLICY_FEED_ICONS: Record<
  OnCallDutyPolicyFeedEventType,
  IconProp
> = getFeedIcons(ON_CALL_DUTY_POLICY_FEED_KINDS);

export const getOnCallDutyPolicyFeedEventIcon: (
  eventType: string,
) => IconProp = (eventType: string): IconProp => {
  return getFeedEntryKind({
    kinds: ON_CALL_DUTY_POLICY_FEED_KINDS,
    eventType,
  }).icon;
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
      const kind: FeedEntryKind = getFeedEntryKind({
        kinds: ON_CALL_DUTY_POLICY_FEED_KINDS,
        eventType: onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType,
      });

      return {
        key: onCallDutyPolicyFeed.id!.toString(),
        textInMarkdown: onCallDutyPolicyFeed.feedInfoInMarkdown || "",
        moreTextInMarkdown:
          onCallDutyPolicyFeed.moreInformationInMarkdown || "",
        user: onCallDutyPolicyFeed.user,
        itemDateTime:
          onCallDutyPolicyFeed.postedAt || onCallDutyPolicyFeed.createdAt!,
        color: getFeedEntryColor({
          kind: kind,
          rowColor: onCallDutyPolicyFeed.displayColor,
        }),
        icon: kind.icon,
        burstKind: kind.burst,
        detailsLabel: kind.moreText,
        eventType: onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType,
      };
    };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(OnCallDutyPolicyFeedEventType),
    getEventTypeIcon: getOnCallDutyPolicyFeedEventIcon,
    storageKey: "on-call-policy",
    resetKey: props.onCallDutyPolicyId.toString(),
  });

  const feed: UseFeedItemsResult = useFeedItems<OnCallDutyPolicyFeed>({
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
    <FeedCard
      title={"On-Call Policy Feed"}
      description={
        "Everything that has happened to this on-call policy: people, teams and schedules added or removed, overrides and handoffs."
      }
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
    >
      <div>
        <FeedContent
          feed={feed}
          noItemsMessage={getFeedNoItemsMessage({
            options: feedOptions.options,
            noItemsMessage: "Nothing has happened to this on-call policy yet.",
          })}
          sortOrder={feedOptions.options.sortOrder}
        />
      </div>
    </FeedCard>
  );
};

export default OnCallDutyPolicyFeedElement;
