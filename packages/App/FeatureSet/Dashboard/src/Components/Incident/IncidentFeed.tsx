import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import getSavedChatMessageFeedAuthor from "Common/UI/Components/Feed/SavedChatMessageFeedAuthor";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import RunbookPicker from "../Runbook/RunbookPicker";
import useFeedItems, {
  UseFeedItemsResult,
} from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedActionsMenu from "Common/UI/Components/Feed/FeedActionsMenu";
import FeedContent from "Common/UI/Components/Feed/FeedContent";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
  getFeedEntryKind,
  getFeedIcons,
} from "Common/UI/Components/Feed/FeedEntryKind";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import {
  AI_REPORT_DETAILS_LABEL,
  FeedItemMarkdown,
  getFeedItemMarkdown,
} from "../../Utils/AIRootCauseFeedItem";
import useFeedNoteActions, {
  FeedNoteActions,
} from "../EventNotes/useFeedNoteActions";
import {
  getIncidentPrivateNoteKind,
  getIncidentPublicNoteKind,
} from "../EventNotes/NoteKinds/IncidentNoteKinds";

export interface ComponentProps {
  incidentId: ObjectID;
  refreshToken?: number | undefined;
  /*
   * Where "Notify status page subscribers" starts on a new public note.
   * False when the incident was declared without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * What each event type is (FeedEntryKind): its icon and colour, and whether
 * a burst of it folds together. Shared by the feed's entries and the event
 * type filter's checklist (the feed's ⋯ menu), so the two always match. A
 * root cause posted by an AI investigation is the one entry that swaps its
 * kind (see getFeedItemFromIncidentFeed).
 */
export const INCIDENT_FEED_KINDS: Record<IncidentFeedEventType, FeedEntryKind> =
  {
    [IncidentFeedEventType.PublicNote]: SHARED_FEED_ENTRY_KINDS.PublicNote,
    [IncidentFeedEventType.SubscriberNotificationSent]:
      SHARED_FEED_ENTRY_KINDS.SubscriberNotificationSent,
    [IncidentFeedEventType.OwnerNotificationSent]:
      SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
    [IncidentFeedEventType.OwnerUserAdded]:
      SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
    [IncidentFeedEventType.OwnerTeamAdded]:
      SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
    // The flag a declared incident is planted with, in red.
    [IncidentFeedEventType.IncidentCreated]: {
      icon: IconProp.Flag,
      tone: FeedTone.Danger,
    },
    [IncidentFeedEventType.IncidentStateChanged]:
      SHARED_FEED_ENTRY_KINDS.StateChanged,
    [IncidentFeedEventType.PrivateNote]: SHARED_FEED_ENTRY_KINDS.PrivateNote,
    [IncidentFeedEventType.IncidentUpdated]: SHARED_FEED_ENTRY_KINDS.Updated,
    [IncidentFeedEventType.RootCause]: SHARED_FEED_ENTRY_KINDS.RootCause,
    [IncidentFeedEventType.RemediationNotes]:
      SHARED_FEED_ENTRY_KINDS.RemediationNotes,
    [IncidentFeedEventType.PostmortemNote]:
      SHARED_FEED_ENTRY_KINDS.PostmortemNote,
    [IncidentFeedEventType.OwnerUserRemoved]:
      SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
    [IncidentFeedEventType.OwnerTeamRemoved]:
      SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
    [IncidentFeedEventType.OnCallPolicy]: SHARED_FEED_ENTRY_KINDS.OnCallPolicy,
    [IncidentFeedEventType.OnCallNotification]:
      SHARED_FEED_ENTRY_KINDS.OnCallNotification,
    [IncidentFeedEventType.IncidentMemberAdded]:
      SHARED_FEED_ENTRY_KINDS.RoleAssigned,
    [IncidentFeedEventType.IncidentMemberRemoved]:
      SHARED_FEED_ENTRY_KINDS.RoleUnassigned,
    [IncidentFeedEventType.AlertLinked]: SHARED_FEED_ENTRY_KINDS.Linked,
    [IncidentFeedEventType.AlertUnlinked]: SHARED_FEED_ENTRY_KINDS.Unlinked,
    [IncidentFeedEventType.LabelRuleExecuted]:
      SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
    [IncidentFeedEventType.OwnerRuleExecuted]:
      SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
    [IncidentFeedEventType.PrivacyRuleExecuted]:
      SHARED_FEED_ENTRY_KINDS.PrivacyRuleExecuted,
    [IncidentFeedEventType.OnCallRuleExecuted]:
      SHARED_FEED_ENTRY_KINDS.OnCallRuleExecuted,
    [IncidentFeedEventType.AutoRemediation]:
      SHARED_FEED_ENTRY_KINDS.AutoRemediation,
    [IncidentFeedEventType.VideoCallStarted]:
      SHARED_FEED_ENTRY_KINDS.VideoCallStarted,
    [IncidentFeedEventType.VideoCallFailed]:
      SHARED_FEED_ENTRY_KINDS.VideoCallFailed,
  };

export const INCIDENT_FEED_ICONS: Record<IncidentFeedEventType, IconProp> =
  getFeedIcons(INCIDENT_FEED_KINDS);

export const getIncidentFeedEventIcon: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return getFeedEntryKind({ kinds: INCIDENT_FEED_KINDS, eventType }).icon;
};

const IncidentFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const incidentIdString: string = props.incidentId.toString();
  const notifySubscribersByDefault: boolean =
    props.notifyStatusPageSubscribersByDefault ?? true;
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

  const [showRunbookPickerModal, setShowRunbookPickerModal] =
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
    const isAIInvestigation: boolean = Boolean(
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.RootCause &&
        (incidentFeed.aiRunId ||
          incidentFeed.feedInfoInMarkdown?.includes(
            "AI — Automated Root Cause Analysis",
          )),
    );

    const kind: FeedEntryKind = isAIInvestigation
      ? SHARED_FEED_ENTRY_KINDS.AIRootCause
      : getFeedEntryKind({
          kinds: INCIDENT_FEED_KINDS,
          eventType: incidentFeed.incidentFeedEventType,
        });

    /*
     * An AI report is laid out in full by the AI Investigation card, so its
     * feed item shows only the summary and root cause; the whole report
     * unfolds under Show the full report.
     */
    const feedItemMarkdown: FeedItemMarkdown = getFeedItemMarkdown({
      isAIInvestigation,
      feedInfoInMarkdown: incidentFeed.feedInfoInMarkdown,
      moreInformationInMarkdown: incidentFeed.moreInformationInMarkdown,
    });

    return {
      key: incidentFeed.id!.toString(),
      textInMarkdown: feedItemMarkdown.textInMarkdown,
      moreTextInMarkdown: feedItemMarkdown.moreTextInMarkdown,
      /*
       * A note saved from a chat message is led by the message's author;
       * the row's user only saved it (SavedChatMessageFeedAuthor).
       */
      ...getSavedChatMessageFeedAuthor({
        savedFromChatMessage: incidentFeed.savedFromChatMessage,
        user: incidentFeed.user,
      }),
      // A change no person made, by a project API key: the key's name then.
      apiKeyName: incidentFeed.user ? undefined : incidentFeed.apiKeyName,
      itemDateTime: incidentFeed.postedAt || incidentFeed.createdAt!,
      color: getFeedEntryColor({
        kind: kind,
        rowColor: incidentFeed.displayColor,
      }),
      icon: kind.icon,
      burstKind: kind.burst,
      eventType: incidentFeed.incidentFeedEventType,
      detailsLabel: isAIInvestigation ? AI_REPORT_DETAILS_LABEL : kind.moreText,
      isNote: kind.isNote,
      safeMode: isAIInvestigation,
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(IncidentFeedEventType),
    getEventTypeIcon: getIncidentFeedEventIcon,
    storageKey: "incident",
    resetKey: incidentIdString,
  });

  const feed: UseFeedItemsResult = useFeedItems<IncidentFeed>({
    resourceKey: incidentIdString,
    viewKey: feedOptions.optionsKey,
    refreshToken: props.refreshToken,
    getItems: async (limit: number): Promise<ListResult<IncidentFeed>> => {
      return await ModelAPI.getList({
        modelType: IncidentFeed,
        query: {
          incidentId: props.incidentId!,
          ...getFeedEventTypeQuery<IncidentFeed>(
            "incidentFeedEventType",
            feedOptions.options,
          ),
        },
        select: {
          moreInformationInMarkdown: true,
          feedInfoInMarkdown: true,
          displayColor: true,
          createdAt: true,
          aiRunId: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
          apiKeyName: true,
          incidentFeedEventType: true,
          postedAt: true,
          savedFromChatMessage: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromIncidentFeeds,
  });

  /*
   * "Add Public Note" and "Add Private Note": the incident's Notes page
   * composer, in a dialog.
   */
  const noteActions: FeedNoteActions = useFeedNoteActions({
    keyPrefix: "incident",
    publicNoteKind: getIncidentPublicNoteKind({
      incidentId: props.incidentId,
      isNotifyingByDefault: notifySubscribersByDefault,
    }),
    privateNoteKind: getIncidentPrivateNoteKind({
      incidentId: props.incidentId,
    }),
    onPosted: () => {
      feed.refresh().catch((err: unknown) => {
        feed.setError(API.getFriendlyMessage(err as Exception));
      });
    },
  });

  return (
    <FeedCard
      title={"Incident Feed"}
      description={
        "Everything that has happened to this incident: status changes, notes, owners and every notification sent."
      }
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
      actions={
        <FeedActionsMenu key="incident-feed-actions-menu">
          {[
            <MoreMenuItem
              key="incident-action-run-runbook"
              text="Execute Runbook"
              icon={IconProp.Play}
              onClick={() => {
                setShowRunbookPickerModal(true);
              }}
            />,
            <MoreMenuItem
              key="incident-action-execute-policy"
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
            noItemsMessage: "Nothing has happened to this incident yet.",
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
          incidentId={props.incidentId}
        />
      </div>
    </FeedCard>
  );
};

export default IncidentFeedElement;
