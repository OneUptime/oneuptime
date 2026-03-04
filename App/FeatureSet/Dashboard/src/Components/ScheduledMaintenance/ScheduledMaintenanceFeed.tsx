import React, { FunctionComponent, ReactElement, useEffect } from "react";
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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import OneUptimeDate from "Common/Types/Date";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
}

const ScheduledMaintenanceFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);

  const [showPublicNoteModal, setShowPublicNoteModal] =
    React.useState<boolean>(false);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
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
      let icon: IconProp = IconProp.Circle;

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated
      ) {
        icon = IconProp.Alert;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged
      ) {
        icon = IconProp.ArrowCircleRight;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated
      ) {
        icon = IconProp.Edit;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OwnerNotificationSent
      ) {
        icon = IconProp.Bell;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.SubscriberNotificationSent
      ) {
        icon = IconProp.Notification;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.PublicNote
      ) {
        icon = IconProp.Announcement;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.PrivateNote
      ) {
        icon = IconProp.Lock;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OwnerUserAdded
      ) {
        icon = IconProp.User;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OwnerTeamAdded
      ) {
        icon = IconProp.Team;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.RemediationNotes
      ) {
        icon = IconProp.Wrench;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.RootCause
      ) {
        icon = IconProp.Cube;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OwnerUserRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OwnerTeamRemoved
      ) {
        icon = IconProp.Close;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OnCallNotification
      ) {
        icon = IconProp.Alert;
      }

      if (
        scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType ===
        ScheduledMaintenanceFeedEventType.OnCallPolicy
      ) {
        icon = IconProp.Call;
      }

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

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const scheduledMaintenanceFeeds: ListResult<ScheduledMaintenanceFeed> =
        await ModelAPI.getList({
          modelType: ScheduledMaintenanceFeed,
          query: {
            scheduledMaintenanceId: props.scheduledMaintenanceId!,
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
            postedAt: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });

      setFeedItems(
        getFeedItemsFromScheduledMaintenanceFeeds(
          scheduledMaintenanceFeeds.data,
        ),
      );
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.scheduledMaintenanceId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.scheduledMaintenanceId]);

  return (
    <Card
      title={"Scheduled Maintenance Feed"}
      description={
        "This is the timeline and feed for this scheduled maintenance. You can see all the updates and information about this scheduled maintenance here."
      }
      buttons={[
        {
          title: "Add Public Note",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Team,
          onClick: () => {
            setShowPublicNoteModal(true);
          },
        },
        {
          title: "Add Private Note",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Lock,
          onClick: () => {
            setShowPrivateNoteModal(true);
          },
        },
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
            noItemsMessage="Looks like there are no items in this feed for this scheduled maintenance."
          />
        )}
        {showPublicNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
            modelType={ScheduledMaintenancePublicNote}
            name={"create-scheduledMaintenancet-public-note"}
            title={"Add Public Note to this scheduled maintenance"}
            description={
              "Add a public note to this scheduled maintenance. This note will be visible to all subscribers of this scheduled maintenance and will show up on the status page."
            }
            onClose={() => {
              setShowPublicNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: ScheduledMaintenancePublicNote) => {
              model.scheduledMaintenanceId = props.scheduledMaintenanceId!;
              return model;
            }}
            onSuccess={() => {
              setShowPublicNoteModal(false);
              fetchItems().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              summary: {
                enabled: true,
                defaultStepName: "Public Note",
              },
              name: "create-scheduled-maintenance-state-timeline",
              modelType: ScheduledMaintenancePublicNote,
              id: "create-scheduled-maintenance-state-timeline",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a public note about this state change to the status page.",
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
                  description:
                    "Should status page subscribers be notified when this note is posted?",
                  title: "Notify Status Page Subscribers",
                  required: false,
                  defaultValue: true,
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}

        {showPrivateNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
            modelType={ScheduledMaintenanceInternalNote}
            name={"create-scheduledMaintenancet-internal-note"}
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
              fetchItems().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              summary: {
                enabled: true,
                defaultStepName: "Private Note",
              },
              name: "create-scheduledMaintenance-internal-note",
              modelType: ScheduledMaintenanceInternalNote,
              id: "create-scheduledMaintenance-internal-note",
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
