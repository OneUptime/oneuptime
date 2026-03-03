import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IncidentEpisodeFeed, {
  IncidentEpisodeFeedEventType,
} from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
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
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";

export interface ComponentProps {
  incidentEpisodeId: ObjectID;
}

const IncidentEpisodeFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<FeedItemProps[]>([]);
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
    React.useState<boolean>(false);

  type GetFeedItemsFromEpisodeFeeds = (
    episodeFeeds: IncidentEpisodeFeed[],
  ) => FeedItemProps[];

  const getFeedItemsFromEpisodeFeeds: GetFeedItemsFromEpisodeFeeds = (
    episodeFeeds: IncidentEpisodeFeed[],
  ): FeedItemProps[] => {
    return episodeFeeds.map((episodeFeed: IncidentEpisodeFeed) => {
      return getFeedItemFromEpisodeFeed(episodeFeed);
    });
  };

  type GetFeedItemFromEpisodeFeed = (
    episodeFeed: IncidentEpisodeFeed,
  ) => FeedItemProps;

  const getFeedItemFromEpisodeFeed: GetFeedItemFromEpisodeFeed = (
    episodeFeed: IncidentEpisodeFeed,
  ): FeedItemProps => {
    let icon: IconProp = IconProp.Circle;

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.EpisodeCreated
    ) {
      icon = IconProp.Layers;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.EpisodeStateChanged
    ) {
      icon = IconProp.ArrowCircleRight;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.EpisodeUpdated
    ) {
      icon = IconProp.Edit;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.IncidentAdded
    ) {
      icon = IconProp.Alert;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.IncidentRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OwnerNotificationSent
    ) {
      icon = IconProp.Bell;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.PrivateNote
    ) {
      icon = IconProp.Lock;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OwnerUserAdded
    ) {
      icon = IconProp.User;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OwnerTeamAdded
    ) {
      icon = IconProp.Team;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.RootCause
    ) {
      icon = IconProp.Cube;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OwnerUserRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OwnerTeamRemoved
    ) {
      icon = IconProp.Close;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OnCallNotification
    ) {
      icon = IconProp.Alert;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.OnCallPolicy
    ) {
      icon = IconProp.Call;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.SeverityChanged
    ) {
      icon = IconProp.ExclaimationCircle;
    }

    if (
      episodeFeed.incidentEpisodeFeedEventType ===
      IncidentEpisodeFeedEventType.PostmortemNote
    ) {
      icon = IconProp.TextFile;
    }

    return {
      key: episodeFeed.id!.toString(),
      textInMarkdown: episodeFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: episodeFeed.moreInformationInMarkdown || "",
      user: episodeFeed.user,
      itemDateTime: episodeFeed.postedAt || episodeFeed.createdAt!,
      color: episodeFeed.displayColor || Gray500,
      icon: icon,
    };
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);
    try {
      const episodeFeeds: ListResult<IncidentEpisodeFeed> =
        await ModelAPI.getList({
          modelType: IncidentEpisodeFeed,
          query: {
            incidentEpisodeId: props.incidentEpisodeId!,
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
            incidentEpisodeFeedEventType: true,
            postedAt: true,
          },
          skip: 0,
          sort: {
            postedAt: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });

      setFeedItems(getFeedItemsFromEpisodeFeeds(episodeFeeds.data));
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.incidentEpisodeId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.incidentEpisodeId]);

  return (
    <Card
      title={"Episode Feed"}
      description={
        "This is the timeline and feed for this episode. You can see all the updates and information about this episode here."
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
            noItemsMessage="Looks like there are no items in this feed for this episode."
          />
        )}

        {showOnCallPolicyModal && (
          <ModelFormModal
            modelType={OnCallDutyPolicyExecutionLog}
            modalWidth={ModalWidth.Normal}
            name={"execute-on-call-policy"}
            title={"Execute On-Call Policy"}
            description={
              "Execute the on-call policy for this episode. This will notify the on-call team members and start the on-call process."
            }
            onClose={() => {
              setShowOnCallPolicyModal(false);
            }}
            submitButtonText="Execute Policy"
            onBeforeCreate={async (model: OnCallDutyPolicyExecutionLog) => {
              model.triggeredByIncidentEpisodeId = props.incidentEpisodeId!;
              model.userNotificationEventType =
                UserNotificationEventType.IncidentEpisodeCreated;
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
                    "Select the on-call policy to execute for this episode.",
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
            modelType={IncidentEpisodeInternalNote}
            name={"create-episode-internal-note"}
            title={"Add Private Note to this Episode"}
            description={
              "Add a private note to this episode. This note will be visible only to the team members of this episode."
            }
            onClose={() => {
              setShowPrivateNoteModal(false);
            }}
            submitButtonText="Save"
            onBeforeCreate={async (model: IncidentEpisodeInternalNote) => {
              model.incidentEpisodeId = props.incidentEpisodeId!;
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
              name: "create-episode-internal-note",
              modelType: IncidentEpisodeInternalNote,
              id: "create-episode-internal-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a private note about this episode. This note will be visible only to the team members of this episode.",
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

export default IncidentEpisodeFeedElement;
