import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
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
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Exception from "Common/Types/Exception/Exception";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import OneUptimeDate from "Common/Types/Date";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Icon from "Common/UI/Components/Icon/Icon";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedOptionsButton from "Common/UI/Components/Feed/FeedOptionsButton";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import RunbookPicker from "../Runbook/RunbookPicker";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  /*
   * Bump to re-read the feed, e.g. after the page changed the event's state,
   * so the new activity shows without pressing Refresh.
   */
  refreshToken?: number | undefined;
  /*
   * Where "Notify Status Page Subscribers" starts on a new public note.
   * False when the event was created without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * One icon per event type. A Record (rather than a chain of ifs) makes the
 * compiler flag a new event type that has no icon, instead of it quietly
 * falling back to a plain circle. It is shared by the feed items and the
 * event type checklist behind the Filter & Sort button, so the two always
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

  const [showPublicNoteModal, setShowPublicNoteModal] =
    React.useState<boolean>(false);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
    React.useState<boolean>(false);

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

  return (
    <Card
      title={"Scheduled Maintenance Feed"}
      description={
        "This is the timeline and feed for this scheduled maintenance. You can see all the updates and information about this scheduled maintenance here."
      }
      buttons={[
        <FeedOptionsButton
          key="scheduled-maintenance-feed-options"
          value={feedOptions.options}
          eventTypeOptions={feedOptions.eventTypeOptions}
          onChange={feedOptions.setOptions}
        />,
        <MoreMenu
          key="scheduled-maintenance-feed-actions-menu"
          elementToBeShownInsteadOfButton={
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none">
              <Icon icon={IconProp.Bolt} className="h-4 w-4 text-gray-500" />
              <span>Actions</span>
              <Icon
                icon={IconProp.ChevronDown}
                className="h-3.5 w-3.5 text-gray-400 ml-0.5"
              />
            </div>
          }
        >
          <MoreMenuItem
            key="scheduled-maintenance-action-run-runbook"
            text="Execute Runbook"
            icon={IconProp.Play}
            onClick={() => {
              setShowRunbookPickerModal(true);
            }}
          />
          <MoreMenuItem
            key="scheduled-maintenance-action-public-note"
            text="Add Public Note"
            icon={IconProp.Team}
            onClick={() => {
              setShowPublicNoteModal(true);
            }}
          />
          <MoreMenuItem
            key="scheduled-maintenance-action-private-note"
            text="Add Private Note"
            icon={IconProp.Lock}
            onClick={() => {
              setShowPrivateNoteModal(true);
            }}
          />
        </MoreMenu>,
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
                "Looks like there are no items in this feed for this scheduled maintenance.",
            })}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onMore={loadMore}
          />
        )}
        {loadMoreError && <ErrorMessage message={loadMoreError} />}
        {showPublicNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
            modelType={ScheduledMaintenancePublicNote}
            name={"create-scheduled-maintenance-public-note"}
            title={"Add Public Note to this scheduled maintenance"}
            description={
              "Add a public note to this scheduled maintenance. This note will be visible to all subscribers of this scheduled maintenance and will show up on the status page."
            }
            onClose={() => {
              setShowPublicNoteModal(false);
            }}
            submitButtonText="Save"
            /*
             * Seeded as a value, not only as the field's default: the form
             * drops a false default, and an unsent flag would fall back to
             * notifying.
             */
            initialValues={{
              shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                notifySubscribersByDefault,
            }}
            onBeforeCreate={async (model: ScheduledMaintenancePublicNote) => {
              model.scheduledMaintenanceId = props.scheduledMaintenanceId!;
              return model;
            }}
            onSuccess={() => {
              setShowPublicNoteModal(false);
              refresh().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              summary: {
                enabled: true,
                defaultStepName: "Public Note",
              },
              name: "create-scheduled-maintenance-public-note",
              modelType: ScheduledMaintenancePublicNote,
              id: "create-scheduled-maintenance-public-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Share an update about this scheduled maintenance. The note is shown on the status page.",
                  title: "Public Note",
                  required: true,
                },
                {
                  field: {
                    postedAt: true,
                  },
                  fieldType: FormFieldSchemaType.DateTime,
                  description:
                    "The date and time this note was posted. By default, it will be the current date and time.",
                  title: "Posted At",
                  required: true,
                  getDefaultValue: () => {
                    return OneUptimeDate.getCurrentDate();
                  },
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
                  },
                  fieldType: FormFieldSchemaType.Checkbox,
                  description: notifySubscribersByDefault
                    ? "Should status page subscribers be notified when this note is posted?"
                    : PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
                  title: "Notify Status Page Subscribers",
                  required: false,
                  defaultValue: notifySubscribersByDefault,
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}

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

        {showPrivateNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
            modelType={ScheduledMaintenanceInternalNote}
            name={"create-scheduled-maintenance-internal-note"}
            title={"Add Private Note to this scheduled maintenance"}
            description={
              "Add a private note to this scheduled maintenance. This note will be visible only to the team members of this scheduled maintenance."
            }
            onClose={() => {
              setShowPrivateNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: ScheduledMaintenanceInternalNote) => {
              model.scheduledMaintenanceId = props.scheduledMaintenanceId!;
              return model;
            }}
            onSuccess={() => {
              setShowPrivateNoteModal(false);
              refresh().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              summary: {
                enabled: true,
                defaultStepName: "Private Note",
              },
              name: "create-scheduled-maintenance-internal-note",
              modelType: ScheduledMaintenanceInternalNote,
              id: "create-scheduled-maintenance-internal-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a private note about this scheduled maintenance. This note will be visible only to the team members of this scheduled maintenance.",
                  title: "Private Note",
                  required: true,
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default ScheduledMaintenanceFeedElement;
