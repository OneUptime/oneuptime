import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import useFeedItems, {
  UseFeedItemsResult,
} from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedContent from "Common/UI/Components/Feed/FeedContent";
import FeedActionsMenu from "Common/UI/Components/Feed/FeedActionsMenu";
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
 * What each event type is (FeedEntryKind): its icon and colour, and whether a
 * burst of it folds together. A Record (rather than a chain of ifs) makes the
 * compiler flag a new event type that has no kind, instead of it quietly
 * falling back to a plain circle. It is shared by the feed items and the
 * event type filter's checklist (the feed's ⋯ menu), so the two always
 * match.
 */
export const SCHEDULED_MAINTENANCE_FEED_KINDS: Record<
  ScheduledMaintenanceFeedEventType,
  FeedEntryKind
> = {
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated]: {
    ...SHARED_FEED_ENTRY_KINDS.Created,
    icon: IconProp.Calendar,
  },
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged]:
    SHARED_FEED_ENTRY_KINDS.StateChanged,
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated]:
    SHARED_FEED_ENTRY_KINDS.Updated,
  [ScheduledMaintenanceFeedEventType.OwnerNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
  [ScheduledMaintenanceFeedEventType.SubscriberNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.SubscriberNotificationSent,
  [ScheduledMaintenanceFeedEventType.PublicNote]:
    SHARED_FEED_ENTRY_KINDS.PublicNote,
  [ScheduledMaintenanceFeedEventType.PrivateNote]:
    SHARED_FEED_ENTRY_KINDS.PrivateNote,
  [ScheduledMaintenanceFeedEventType.OwnerUserAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [ScheduledMaintenanceFeedEventType.OwnerTeamAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [ScheduledMaintenanceFeedEventType.RemediationNotes]:
    SHARED_FEED_ENTRY_KINDS.RemediationNotes,
  [ScheduledMaintenanceFeedEventType.RootCause]:
    SHARED_FEED_ENTRY_KINDS.RootCause,
  [ScheduledMaintenanceFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [ScheduledMaintenanceFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [ScheduledMaintenanceFeedEventType.OnCallNotification]:
    SHARED_FEED_ENTRY_KINDS.OnCallNotification,
  [ScheduledMaintenanceFeedEventType.OnCallPolicy]:
    SHARED_FEED_ENTRY_KINDS.OnCallPolicy,
  [ScheduledMaintenanceFeedEventType.OwnerRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
  [ScheduledMaintenanceFeedEventType.LabelRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
};

export const SCHEDULED_MAINTENANCE_FEED_ICONS: Record<
  ScheduledMaintenanceFeedEventType,
  IconProp
> = getFeedIcons(SCHEDULED_MAINTENANCE_FEED_KINDS);

export const getScheduledMaintenanceFeedKind: (
  eventType: ScheduledMaintenanceFeedEventType | string | undefined,
) => FeedEntryKind = (
  eventType: ScheduledMaintenanceFeedEventType | string | undefined,
): FeedEntryKind => {
  // Rows written by a newer server can carry a type this build does not know.
  return getFeedEntryKind({
    kinds: SCHEDULED_MAINTENANCE_FEED_KINDS,
    eventType: eventType,
  });
};

export const getScheduledMaintenanceFeedIcon: (
  eventType: ScheduledMaintenanceFeedEventType | undefined,
) => IconProp = (
  eventType: ScheduledMaintenanceFeedEventType | undefined,
): IconProp => {
  return getScheduledMaintenanceFeedKind(eventType).icon;
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
      const kind: FeedEntryKind = getScheduledMaintenanceFeedKind(
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
        color: getFeedEntryColor({
          kind: kind,
          rowColor: scheduledMaintenanceFeed.displayColor,
        }),
        icon: kind.icon,
        burstKind: kind.burst,
        eventType: scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType,
      };
    };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(ScheduledMaintenanceFeedEventType),
    getEventTypeIcon: getScheduledMaintenanceFeedEventIcon,
    storageKey: "scheduled-maintenance",
    resetKey: props.scheduledMaintenanceId.toString(),
  });

  const feed: UseFeedItemsResult = useFeedItems<ScheduledMaintenanceFeed>({
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
      feed.refresh().catch((err: unknown) => {
        feed.setError(API.getFriendlyMessage(err as Exception));
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
      onRefresh={feed.refresh}
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
        <FeedContent
          feed={feed}
          noItemsMessage={getFeedNoItemsMessage({
            options: feedOptions.options,
            noItemsMessage: "Nothing has happened to this scheduled maintenance event yet.",
          })}
          sortOrder={feedOptions.options.sortOrder}
        />

        {noteActions.dialog}

        <RunbookPicker
          isOpen={showRunbookPickerModal}
          onClose={() => {
            setShowRunbookPickerModal(false);
          }}
          onStarted={() => {
            feed.refresh().catch((err: unknown) => {
              feed.setError(API.getFriendlyMessage(err as Exception));
            });
          }}
          scheduledMaintenanceId={props.scheduledMaintenanceId}
        />
      </div>
    </FeedCard>
  );
};

export default ScheduledMaintenanceFeedElement;
