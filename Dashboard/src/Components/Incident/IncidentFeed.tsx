import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
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
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import OneUptimeDate from "Common/Types/Date";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";

export interface ComponentProps {
  incidentId: ObjectID;
}

const IncidentFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

  const [showPublicNoteModal, setShowPublicNoteModal] =
    React.useState<boolean>(false);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
    React.useState<boolean>(false);

  type GetFeedItemsFromIncidentFeeds = (
    incidentFeeds: IncidentFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromIncidentFeeds: GetFeedItemsFromIncidentFeeds = (
    incidentFeeds: IncidentFeed[],
  ): FeedItemProps[] => {
    return incidentFeeds.map((incidentFeed: IncidentFeed) => {
      return getFeedItemFromIncidentFeed(incidentFeed);
    });
  };

  type GetFeedItemFromIncidentFeed = (
    incidentFeed: IncidentFeed,
  ) => FeedItemProps;

  const getFeedItemFromIncidentFeed: GetFeedItemFromIncidentFeed = (
    incidentFeed: IncidentFeed,
  ): FeedItemProps => {
    let icon: IconProp = IconProp.Circle;

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentCreated
    ) {
      icon = IconProp.Alert;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentStateChanged
    ) {
      icon = IconProp.ArrowCircleRight;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.IncidentUpdated
    ) {
      icon = IconProp.Edit;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.SubscriberNotificationSent
    ) {
      icon = IconProp.Notification;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.PublicNote
    ) {
      icon = IconProp.Announcement;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.PrivateNote
    ) {
      icon = IconProp.Lock;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerUserAdded
    ) {
      icon = IconProp.User;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerTeamAdded
    ) {
      icon = IconProp.Team;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.RemediationNotes
    ) {
      icon = IconProp.Wrench;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.RootCause
    ) {
      icon = IconProp.Cube;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerUserRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OwnerTeamRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      incidentFeed.incidentFeedEventType ===
      IncidentFeedEventType.OnCallNotification
    ) {
      icon = IconProp.Alert;
    }

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.OnCallPolicy
    ) {
      icon = IconProp.Call;
    }

    return {
      key: incidentFeed.id!.toString(),
      textInMarkdown: incidentFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: incidentFeed.moreInformationInMarkdown || "",
      user: incidentFeed.user,
      itemDateTime: incidentFeed.postedAt || incidentFeed.createdAt!,
      color: incidentFeed.displayColor || Gray500,
      icon: icon,
    };
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const incidentFeeds: ListResult<IncidentFeed> = await ModelAPI.getList({
        modelType: IncidentFeed,
        query: {
          incidentId: props.incidentId!,
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
          incidentFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      });

      setFeedItems(getFeedItemsFromIncidentFeeds(incidentFeeds.data));
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.incidentId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.incidentId]);

  return (
    <Card
      title={"Incident Feed"}
      description={
        "This is the timeline and feed for this incident. You can see all the updates and information about this incident here."
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
            noItemsMessage="Looks like there are no items in this feed for this incident."
          />
        )}

        {showOnCallPolicyModal && (
          <ModelFormModal
            modelType={OnCallDutyPolicyExecutionLog}
            modalWidth={ModalWidth.Normal}
            name={"execute-on-call-policy"}
            title={"Execute On-Call Policy"}
            description={
              "Execute the on-call policy for this incident. This will notify the on-call team members and start the on-call process."
            }
            onClose={() => {
              setShowOnCallPolicyModal(false);
            }}
            submitButtonText="Execute Policy"
            onBeforeCreate={async (model: OnCallDutyPolicyExecutionLog) => {
              model.triggeredByIncidentId = props.incidentId!;
              model.userNotificationEventType =
                UserNotificationEventType.IncidentCreated;
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
                    "Select the on-call policy to execute for this incident.",
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

        {showPublicNoteModal && (
          <ModelFormModal
            modelType={IncidentPublicNote}
            modalWidth={ModalWidth.Large}
            name={"create-incident-public-note"}
            title={"Add Public Note to this Incident"}
            description={
              "Add a public note to this incident. This note will be visible to all subscribers of this incident and will show up on the status page."
            }
            onClose={() => {
              setShowPublicNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: IncidentPublicNote) => {
              model.incidentId = props.incidentId!;
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
              name: "create-incident-state-timeline",
              modelType: IncidentPublicNote,
              id: "create-incident-state-timeline",
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
            modelType={IncidentInternalNote}
            name={"create-incident-internal-note"}
            modalWidth={ModalWidth.Large}
            title={"Add Private Note to this Incident"}
            description={
              "Add a private note to this incident. This note will be visible only to the team members of this incident."
            }
            onClose={() => {
              setShowPrivateNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: IncidentInternalNote) => {
              model.incidentId = props.incidentId!;
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
              name: "create-incident-internal-note",
              modelType: IncidentInternalNote,
              id: "create-incident-internal-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a private note about this incident. This note will be visible only to the team members of this incident.",
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

export default IncidentFeedElement;
