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
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";

export interface ComponentProps {
  alertId: ObjectID;
}

const AlertFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

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

  type GetFeedItemFromAlertFeed = (alertFeed: AlertFeed) => FeedItemProps;

  const getFeedItemFromAlertFeed: GetFeedItemFromAlertFeed = (
    alertFeed: AlertFeed,
  ): FeedItemProps => {
    let icon: IconProp = IconProp.Circle;

    if (alertFeed.alertFeedEventType === AlertFeedEventType.AlertCreated) {
      icon = IconProp.Alert;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.AlertStateChanged) {
      icon = IconProp.ArrowCircleRight;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.AlertUpdated) {
      icon = IconProp.Edit;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      alertFeed.alertFeedEventType ===
      AlertFeedEventType.SubscriberNotificationSent
    ) {
      icon = IconProp.Notification;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.PublicNote) {
      icon = IconProp.Announcement;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.PrivateNote) {
      icon = IconProp.Lock;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.OwnerUserAdded) {
      icon = IconProp.User;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.OwnerTeamAdded) {
      icon = IconProp.Team;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.RemediationNotes) {
      icon = IconProp.Wrench;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.RootCause) {
      icon = IconProp.Cube;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.OwnerUserRemoved) {
      icon = IconProp.Close;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.OwnerTeamRemoved) {
      icon = IconProp.Close;
    }

    if (
      alertFeed.alertFeedEventType === AlertFeedEventType.OnCallNotification
    ) {
      icon = IconProp.Alert;
    }

    if (alertFeed.alertFeedEventType === AlertFeedEventType.OnCallPolicy) {
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
          title: "Execute On-Call Policy",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Call,
          onClick: () => {
            setShowOnCallPolicyModal(true);
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
            noItemsMessage="Looks like there are no items in this feed for this alert."
          />
        )}

        {showOnCallPolicyModal && (
          <ModelFormModal
            modelType={OnCallDutyPolicyExecutionLog}
            modalWidth={ModalWidth.Normal}
            name={"execute-on-call-policy"}
            title={"Execute On-Call Policy"}
            description={
              "Execute the on-call policy for this alert. This will notify the on-call team members and start the on-call process."
            }
            onClose={() => {
              setShowOnCallPolicyModal(false);
            }}
            submitButtonText="Execute Policy"
            onBeforeCreate={async (model: OnCallDutyPolicyExecutionLog) => {
              model.triggeredByAlertId = props.alertId!;
              model.userNotificationEventType =
                UserNotificationEventType.AlertCreated;
              return model;
            }}
            onSuccess={() => {
              setShowOnCallPolicyModal(false);
              fetchItems().catch((err: unknown) => {
                setError(API.getFriendlyMessage(err as Exception));
              });
            }}
            formProps={{
              name: "create-on-call-policy-log",
              modelType: OnCallDutyPolicyExecutionLog,
              id: "create-on-call-policy-log",
              fields: [
                {
                  field: {
                    onCallDutyPolicy: true,
                  },
                  title: "Select On-Call Policy",
                  description:
                    "Select the on-call policy to execute for this alert.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: OnCallDutyPolicy,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  placeholder: "Select On-Call Policy",
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}

        {showPrivateNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
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
              summary: {
                enabled: true,
                defaultStepName: "Private Note",
              },
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
