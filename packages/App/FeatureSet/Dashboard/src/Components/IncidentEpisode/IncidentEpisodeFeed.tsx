import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import IncidentEpisodeFeed, {
  IncidentEpisodeFeedEventType,
} from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";
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
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import {
  getIncidentEpisodeFeedIcon,
  getIncidentEpisodeFeedKind,
} from "../EpisodeView/EpisodeFeedIcons";
import {
  FeedEntryKind,
  getFeedEntryColor,
} from "Common/UI/Components/Feed/FeedEntryKind";
import useFeedNoteActions, {
  FeedNoteActions,
} from "../EventNotes/useFeedNoteActions";
import {
  getIncidentEpisodePrivateNoteKind,
  getIncidentEpisodePublicNoteKind,
} from "../EventNotes/NoteKinds/IncidentEpisodeNoteKinds";

export interface ComponentProps {
  incidentEpisodeId: ObjectID;
  /*
   * Bump to reload the feed in place, e.g. after the episode's state changed
   * on the overview. The loaded items stay on screen while it reloads.
   */
  refreshToken?: number | undefined;
  /*
   * Where "Notify status page subscribers" starts on a new public note.
   * False when the episode was created without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * The event type filter's checklist (the feed's ⋯ menu) hands over plain
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
    const kind: FeedEntryKind = getIncidentEpisodeFeedKind(
      episodeFeed.incidentEpisodeFeedEventType,
    );

    return {
      key: episodeFeed.id!.toString(),
      textInMarkdown: episodeFeed.feedInfoInMarkdown || "",
      moreTextInMarkdown: episodeFeed.moreInformationInMarkdown || "",
      user: episodeFeed.user,
      itemDateTime: episodeFeed.postedAt || episodeFeed.createdAt!,
      color: getFeedEntryColor({
        kind: kind,
        rowColor: episodeFeed.displayColor,
      }),
      icon: kind.icon,
      burstKind: kind.burst,
      eventType: episodeFeed.incidentEpisodeFeedEventType,
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(IncidentEpisodeFeedEventType),
    getEventTypeIcon: getIncidentEpisodeFeedEventIcon,
    storageKey: "incident-episode",
    resetKey: props.incidentEpisodeId.toString(),
  });

  const feed: UseFeedItemsResult = useFeedItems<IncidentEpisodeFeed>({
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

  /*
   * "Add Public Note" and "Add Private Note": the episode's Notes page
   * composer, in a dialog.
   */
  const noteActions: FeedNoteActions = useFeedNoteActions({
    keyPrefix: "incident-episode",
    publicNoteKind: getIncidentEpisodePublicNoteKind({
      incidentEpisodeId: props.incidentEpisodeId,
      isNotifyingByDefault: notifySubscribersByDefault,
    }),
    privateNoteKind: getIncidentEpisodePrivateNoteKind({
      incidentEpisodeId: props.incidentEpisodeId,
    }),
    onPosted: () => {
      feed.refresh().catch((err: unknown) => {
        feed.setError(API.getFriendlyMessage(err as Exception));
      });
    },
  });

  return (
    <FeedCard
      title={"Episode Feed"}
      description={
        "Everything that has happened to this episode: status changes, notes, owners and every notification sent."
      }
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
      actions={
        <FeedActionsMenu key="incident-episode-feed-actions-menu">
          {[
            <MoreMenuItem
              key="incident-episode-action-execute-policy"
              text="Execute On-Call Policy"
              icon={IconProp.Call}
              onClick={() => {
                setShowOnCallPolicyModal(true);
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
            noItemsMessage: "Nothing has happened to this episode yet.",
          })}
          sortOrder={feedOptions.options.sortOrder}
        />

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
              feed.refresh().catch((err: unknown) => {
                feed.setError(API.getFriendlyMessage(err as Exception));
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

        {noteActions.dialog}
      </div>
    </FeedCard>
  );
};

export default IncidentEpisodeFeedElement;
