import React, { FunctionComponent, ReactElement } from "react";
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
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedOptionsButton from "Common/UI/Components/Feed/FeedOptionsButton";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import OneUptimeDate from "Common/Types/Date";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Icon from "Common/UI/Components/Icon/Icon";
import { getIncidentEpisodeFeedIcon } from "../EpisodeView/EpisodeFeedIcons";

export interface ComponentProps {
  incidentEpisodeId: ObjectID;
  /*
   * Bump to reload the feed in place, e.g. after the episode's state changed
   * on the overview. The loaded items stay on screen while it reloads.
   */
  refreshToken?: number | undefined;
  /*
   * Where "Notify Status Page Subscribers" starts on a new public note.
   * False when the episode was created without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * The event type checklist behind the Filter & Sort button hands over plain
 * strings. This reads them from the same per-event-type table the feed items
 * use, so the two always match.
 */
export const getIncidentEpisodeFeedEventIcon: (
  eventType: string,
) => IconProp = (eventType: string): IconProp => {
  return getIncidentEpisodeFeedIcon(eventType as IncidentEpisodeFeedEventType);
};

const IncidentEpisodeFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const notifySubscribersByDefault: boolean =
    props.notifyStatusPageSubscribersByDefault ?? true;
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

  const [showPublicNoteModal, setShowPublicNoteModal] =
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
    const icon: IconProp = getIncidentEpisodeFeedIcon(
      episodeFeed.incidentEpisodeFeedEventType,
    );

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

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(IncidentEpisodeFeedEventType),
    getEventTypeIcon: getIncidentEpisodeFeedEventIcon,
    storageKey: "incident-episode",
    resetKey: props.incidentEpisodeId.toString(),
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
  } = useFeedItems<IncidentEpisodeFeed>({
    resourceKey: props.incidentEpisodeId.toString(),
    viewKey: feedOptions.optionsKey,
    refreshToken: props.refreshToken,
    getItems: async (
      limit: number,
    ): Promise<ListResult<IncidentEpisodeFeed>> => {
      return await ModelAPI.getList<IncidentEpisodeFeed>({
        modelType: IncidentEpisodeFeed,
        query: {
          incidentEpisodeId: props.incidentEpisodeId!,
          ...getFeedEventTypeQuery<IncidentEpisodeFeed>(
            "incidentEpisodeFeedEventType",
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
          incidentEpisodeFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: (
      episodeFeeds: Array<IncidentEpisodeFeed>,
    ): Array<FeedItemProps> => {
      return getFeedItemsFromEpisodeFeeds(episodeFeeds);
    },
  });

  return (
    <Card
      title={"Episode Feed"}
      description={
        "This is the timeline and feed for this episode. You can see all the updates and information about this episode here."
      }
      buttons={[
        <FeedOptionsButton
          key="incident-episode-feed-options"
          value={feedOptions.options}
          eventTypeOptions={feedOptions.eventTypeOptions}
          onChange={feedOptions.setOptions}
        />,
        <MoreMenu
          key="incident-episode-feed-actions-menu"
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
            key="incident-episode-action-execute-policy"
            text="Execute On-Call Policy"
            icon={IconProp.Call}
            onClick={() => {
              setShowOnCallPolicyModal(true);
            }}
          />
          <MoreMenuItem
            key="incident-episode-action-public-note"
            text="Add Public Note"
            icon={IconProp.Announcement}
            onClick={() => {
              setShowPublicNoteModal(true);
            }}
          />
          <MoreMenuItem
            key="incident-episode-action-private-note"
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
                "Looks like there are no items in this feed for this episode.",
            })}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onMore={loadMore}
          />
        )}
        {loadMoreError && <ErrorMessage message={loadMoreError} />}

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
              refresh().catch((err: unknown) => {
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

        {showPublicNoteModal && (
          <ModelFormModal
            modalWidth={ModalWidth.Large}
            modelType={IncidentEpisodePublicNote}
            name={"create-episode-public-note"}
            title={"Add Public Note to this Episode"}
            description={
              "Add a public note to this episode. It shows up on the status pages this episode is visible on, and subscribers can be notified."
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
            onBeforeCreate={async (model: IncidentEpisodePublicNote) => {
              model.incidentEpisodeId = props.incidentEpisodeId!;
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
              name: "create-episode-public-note",
              modelType: IncidentEpisodePublicNote,
              id: "create-episode-public-note",
              fields: [
                {
                  field: {
                    note: true,
                  },
                  fieldType: FormFieldSchemaType.Markdown,
                  description:
                    "Post a public note about this episode to the status page.",
                  title: "Public Note",
                  required: true,
                },
                {
                  field: {
                    attachments: true,
                  },
                  fieldType: FormFieldSchemaType.MultipleFiles,
                  description:
                    "Attach files that should be shared with subscribers on the status page.",
                  title: "Attachments",
                  required: false,
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
                    : PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
                  title: "Notify Status Page Subscribers",
                  required: false,
                  defaultValue: notifySubscribersByDefault,
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
              refresh().catch((err: unknown) => {
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
