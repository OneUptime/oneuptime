import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedActionsMenu from "Common/UI/Components/Feed/FeedActionsMenu";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import RunbookPicker from "../Runbook/RunbookPicker";
import useFeedNoteActions, {
  FeedNoteActions,
} from "../EventNotes/useFeedNoteActions";
import {
  getScheduledMaintenancePrivateNoteKind,
  getScheduledMaintenancePublicNoteKind,
} from "../EventNotes/NoteKinds/ScheduledMaintenanceNoteKinds";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  /*
   * Bump to re-read the feed, e.g. after the page changed the event's state,
   * so the new activity shows without pressing Refresh.
   */
  refreshToken?: number | undefined;
  /*
   * Where "Notify status page subscribers" starts on a new public note.
   * False when the event was created without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * One icon per event type. A Record (rather than a chain of ifs) makes the
 * compiler flag a new event type that has no icon, instead of it quietly
 * falling back to a plain circle. It is shared by the feed items and the
 * event type filter's checklist (the feed's ⋯ menu), so the two always
 * match.
 */
export const SCHEDULED_MAINTENANCE_FEED_ICONS: Record<
  ScheduledMaintenanceFeedEventType,
  IconProp
> = {
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated]:
    IconProp.Alert,
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged]:
    IconProp.ArrowCircleRight,
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated]:
    IconProp.Edit,
  [ScheduledMaintenanceFeedEventType.OwnerNotificationSent]: IconProp.Bell,
  [ScheduledMaintenanceFeedEventType.SubscriberNotificationSent]:
    IconProp.Notification,
  [ScheduledMaintenanceFeedEventType.PublicNote]: IconProp.Announcement,
  [ScheduledMaintenanceFeedEventType.PrivateNote]: IconProp.Lock,
  [ScheduledMaintenanceFeedEventType.OwnerUserAdded]: IconProp.User,
  [ScheduledMaintenanceFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [ScheduledMaintenanceFeedEventType.RemediationNotes]: IconProp.Wrench,
  [ScheduledMaintenanceFeedEventType.RootCause]: IconProp.Cube,
  [ScheduledMaintenanceFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [ScheduledMaintenanceFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [ScheduledMaintenanceFeedEventType.OnCallNotification]: IconProp.Alert,
  [ScheduledMaintenanceFeedEventType.OnCallPolicy]: IconProp.Call,
  [ScheduledMaintenanceFeedEventType.OwnerRuleExecuted]: IconProp.User,
  [ScheduledMaintenanceFeedEventType.LabelRuleExecuted]: IconProp.Tag,
};

export const getScheduledMaintenanceFeedIcon: (
  eventType: ScheduledMaintenanceFeedEventType | undefined,
) => IconProp = (
  eventType: ScheduledMaintenanceFeedEventType | undefined,
): IconProp => {
  if (!eventType) {
    return IconProp.Circle;
  }

  // Rows written by a newer server can carry a type this build does not know.
  return SCHEDULED_MAINTENANCE_FEED_ICONS[eventType] || IconProp.Circle;
};

// The checklist hands over plain strings rather than the enum.
export const getScheduledMaintenanceFeedEventIcon: (
  eventType: string,
) => IconProp = (eventType: string): IconProp => {
  return getScheduledMaintenanceFeedIcon(
    eventType as ScheduledMaintenanceFeedEventType,
  );
};

const ScheduledMaintenanceFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const notifySubscribersByDefault: boolean =
    props.notifyStatusPageSubscribersByDefault ?? true;

  const [showRunbookPickerModal, setShowRunbookPickerModal] =
    React.useState<boolean>(false);

  type GetFeedItemsFromScheduledMaintenanceFeeds = (
    scheduledMaintenanceFeeds: ScheduledMaintenanceFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromScheduledMaintenanceFeeds: GetFeedItemsFromScheduledMaintenanceFeeds =
    (
      scheduledMaintenanceFeeds: ScheduledMaintenanceFeed[],
    ): FeedItemProps[] => {
      return scheduledMaintenanceFeeds.map(
        (scheduledMaintenanceFeed: ScheduledMaintenanceFeed) => {
          return getFeedItemFromScheduledMaintenanceFeed(
            scheduledMaintenanceFeed,
          );
        },
      );
    };

  type GetFeedItemFromScheduledMaintenanceFeed = (
    scheduledMaintenanceFeed: ScheduledMaintenanceFeed,
  ) => FeedItemProps;

  const getFeedItemFromScheduledMaintenanceFeed: GetFeedItemFromScheduledMaintenanceFeed =
    (scheduledMaintenanceFeed: ScheduledMaintenanceFeed): FeedItemProps => {
      const icon: IconProp = getScheduledMaintenanceFeedIcon(
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType,
      );

      return {
        key: scheduledMaintenanceFeed.id!.toString(),
        textInMarkdown: scheduledMaintenanceFeed.feedInfoInMarkdown || "",
        moreTextInMarkdown:
          scheduledMaintenanceFeed.moreInformationInMarkdown || "",
        user: scheduledMaintenanceFeed.user,
        itemDateTime:
          scheduledMaintenanceFeed.postedAt ||
          scheduledMaintenanceFeed.createdAt!,
        color: scheduledMaintenanceFeed.displayColor || Gray500,
        icon: icon,
      };
    };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(ScheduledMaintenanceFeedEventType),
    getEventTypeIcon: getScheduledMaintenanceFeedEventIcon,
    storageKey: "scheduled-maintenance",
    resetKey: props.scheduledMaintenanceId.toString(),
  });

  const {
    feedItems,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    hasMore,
    isCurrentFeedLoaded,
    setError,
    refresh,
    loadMore,
  } = useFeedItems<ScheduledMaintenanceFeed>({
    resourceKey: props.scheduledMaintenanceId.toString(),
    viewKey: feedOptions.optionsKey,
    refreshToken: props.refreshToken,
    getItems: async (
      limit: number,
    ): Promise<ListResult<ScheduledMaintenanceFeed>> => {
      return await ModelAPI.getList({
        modelType: ScheduledMaintenanceFeed,
        query: {
          scheduledMaintenanceId: props.scheduledMaintenanceId!,
          ...getFeedEventTypeQuery<ScheduledMaintenanceFeed>(
            "scheduledMaintenanceFeedEventType",
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
          scheduledMaintenanceFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromScheduledMaintenanceFeeds,
  });

  /*
   * "Add Public Note" and "Add Private Note": the event's Notes page
   * composer, in a dialog.
   */
  const noteActions: FeedNoteActions = useFeedNoteActions({
    keyPrefix: "scheduled-maintenance",
    publicNoteKind: getScheduledMaintenancePublicNoteKind({
      scheduledMaintenanceId: props.scheduledMaintenanceId,
      isNotifyingByDefault: notifySubscribersByDefault,
    }),
    privateNoteKind: getScheduledMaintenancePrivateNoteKind({
      scheduledMaintenanceId: props.scheduledMaintenanceId,
    }),
    onPosted: () => {
      refresh().catch((err: unknown) => {
        setError(API.getFriendlyMessage(err as Exception));
      });
    },
  });

  return (
    <FeedCard
      title={"Scheduled Maintenance Feed"}
      description={
        "Everything that has happened to this maintenance event: status changes, notes, owners and every notification sent."
      }
      feedOptions={feedOptions}
      onRefresh={refresh}
      actions={
        <FeedActionsMenu key="scheduled-maintenance-feed-actions-menu">
          {[
            <MoreMenuItem
              key="scheduled-maintenance-action-run-runbook"
              text="Execute Runbook"
              icon={IconProp.Play}
              onClick={() => {
                setShowRunbookPickerModal(true);
              }}
            />,
            ...noteActions.menuItems,
          ]}
        </FeedActionsMenu>
      }
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
                "Looks like there are no items in this feed for this scheduled maintenance.",
            })}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onMore={loadMore}
          />
        )}
        {loadMoreError && <ErrorMessage message={loadMoreError} />}

        {noteActions.dialog}

        <RunbookPicker
          isOpen={showRunbookPickerModal}
          onClose={() => {
            setShowRunbookPickerModal(false);
          }}
          onStarted={() => {
            refresh().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
          scheduledMaintenanceId={props.scheduledMaintenanceId}
        />
      </div>
    </FeedCard>
  );
};

export default ScheduledMaintenanceFeedElement;
