import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import AlertFeed, {
  AlertFeedEventType,
} from "Common/Models/DatabaseModels/AlertFeed";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
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
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";

export interface ComponentProps {
  alertId: ObjectID;
}

const AlertFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
    React.useState<boolean>(false);

  type GetFeedItemsFromAlertFeeds = (
    alertFeeds: AlertFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromAlertFeeds: GetFeedItemsFromAlertFeeds = (
    alertFeeds: AlertFeed[],
  ): FeedItemProps[] => {
    return alertFeeds.map((alertFeed: AlertFeed) => {
      return getFeedItemFromAlertFeed(alertFeed);
    });
  };

  type GetFeedItemFromAlertFeed = (
    alertFeed: AlertFeed,
  ) => FeedItemProps;

  const getFeedItemFromAlertFeed: GetFeedItemFromAlertFeed = (
    alertFeed: AlertFeed,
  ): FeedItemProps => {
    let icon: IconProp = IconProp.Circle;

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.AlertCreated
    ) {
      icon = IconProp.Alert;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.AlertStateChanged
    ) {
      icon = IconProp.ArrowCircleRight;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.AlertUpdated
    ) {
      icon = IconProp.Edit;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.SubscriberNotificationSent
    ) {
      icon = IconProp.Notification;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.PublicNote
    ) {
      icon = IconProp.Announcement;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.PrivateNote
    ) {
      icon = IconProp.Lock;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OwnerUserAdded
    ) {
      icon = IconProp.User;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OwnerTeamAdded
    ) {
      icon = IconProp.Team;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.RemediationNotes
    ) {
      icon = IconProp.Wrench;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.RootCause
    ) {
      icon = IconProp.Cube;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OwnerUserRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OwnerTeamRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.OnCallNotification
    ) {
      icon = IconProp.Alert;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.OnCallPolicy
    ) {
      icon = IconProp.Call;
    }

    return {
      key: alertFeed.id!.toString(),
      textInMarkdown: alertFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: alertFeed.moreInformationInMarkdown || "",
      user: alertFeed.user,
      itemDateTime: alertFeed.postedAt || alertFeed.createdAt!,
      color: alertFeed.displayColor || Gray500,
      icon: icon,
    };
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const alertFeeds: ListResult<AlertFeed> = await ModelAPI.getList({
        modelType: AlertFeed,
        query: {
          alertId: props.alertId!,
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
          alertFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      });

      setFeedItems(getFeedItemsFromAlertFeeds(alertFeeds.data));
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.alertId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.alertId]);

  return (
    <Card
      title={"Alert Feed"}
      description={
        "This is the timeline and feed for this alert. You can see all the updates and information about this alert here."
      }
      buttons={[
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
            noItemsMessage="Looks like there are no items in this feed for this alert."
          />
        )}

        {showPrivateNoteModal && (
          <ModelFormModal
            modelType={AlertInternalNote}
            name={"create-alertt-internal-note"}
            title={"Add Private Note to this Alert"}
            description={
              "Add a private note to this alert. This note will be visible only to the team members of this alert."
            }
            onClose={() => {
              setShowPrivateNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: AlertInternalNote) => {
              model.alertId = props.alertId!;
              return model;
            }}
            onSuccess={() => {
              setShowPrivateNoteModal(false);
              fetchItems().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              name: "create-alert-internal-note",
              modelType: AlertInternalNote,
              id: "create-alert-internal-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a private note about this alert. This note will be visible only to the team members of this alert.",
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

export default AlertFeedElement;
