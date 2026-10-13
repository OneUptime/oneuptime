import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import AlertFeed, {
  AlertFeedEventType,
} from "Common/Models/DatabaseModels/AlertFeed";
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
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import RunbookPicker from "../Runbook/RunbookPicker";
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
import { getAlertPrivateNoteKind } from "../EventNotes/NoteKinds/AlertNoteKinds";

export interface ComponentProps {
  alertId: ObjectID;
  refreshToken?: number | undefined;
}

/*
 * What each event type is (FeedEntryKind): its icon and colour, and whether
 * a burst of it folds together. Shared by the feed's entries and the event
 * type filter's checklist (the feed's ⋯ menu), so the two always match. A
 * root cause posted by an AI investigation is the one entry that swaps its
 * kind (see getFeedItemFromAlertFeed).
 */
export const ALERT_FEED_KINDS: Record<AlertFeedEventType, FeedEntryKind> = {
  [AlertFeedEventType.PublicNote]: SHARED_FEED_ENTRY_KINDS.PublicNote,
  [AlertFeedEventType.SubscriberNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.SubscriberNotificationSent,
  [AlertFeedEventType.OwnerNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
  [AlertFeedEventType.OwnerUserAdded]: SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [AlertFeedEventType.OwnerTeamAdded]: SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  // The bell an alert rings with, in red.
  [AlertFeedEventType.AlertCreated]: {
    icon: IconProp.BellAlert,
    tone: FeedTone.Danger,
  },
  [AlertFeedEventType.AlertStateChanged]: SHARED_FEED_ENTRY_KINDS.StateChanged,
  [AlertFeedEventType.PrivateNote]: SHARED_FEED_ENTRY_KINDS.PrivateNote,
  [AlertFeedEventType.AlertUpdated]: SHARED_FEED_ENTRY_KINDS.Updated,
  [AlertFeedEventType.RootCause]: SHARED_FEED_ENTRY_KINDS.RootCause,
  [AlertFeedEventType.RemediationNotes]:
    SHARED_FEED_ENTRY_KINDS.RemediationNotes,
  [AlertFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [AlertFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [AlertFeedEventType.OnCallPolicy]: SHARED_FEED_ENTRY_KINDS.OnCallPolicy,
  [AlertFeedEventType.OnCallNotification]:
    SHARED_FEED_ENTRY_KINDS.OnCallNotification,
  [AlertFeedEventType.AddedToEpisode]: SHARED_FEED_ENTRY_KINDS.MemberAdded,
  [AlertFeedEventType.RemovedFromEpisode]:
    SHARED_FEED_ENTRY_KINDS.MemberRemoved,
  [AlertFeedEventType.LinkedToIncident]: SHARED_FEED_ENTRY_KINDS.Linked,
  [AlertFeedEventType.UnlinkedFromIncident]: SHARED_FEED_ENTRY_KINDS.Unlinked,
  [AlertFeedEventType.LabelRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
  [AlertFeedEventType.OwnerRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
  [AlertFeedEventType.PrivacyRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.PrivacyRuleExecuted,
  [AlertFeedEventType.OnCallRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OnCallRuleExecuted,
  [AlertFeedEventType.AutoRemediation]: SHARED_FEED_ENTRY_KINDS.AutoRemediation,
  [AlertFeedEventType.VideoCallStarted]:
    SHARED_FEED_ENTRY_KINDS.VideoCallStarted,
  [AlertFeedEventType.VideoCallFailed]: SHARED_FEED_ENTRY_KINDS.VideoCallFailed,
};

export const ALERT_FEED_ICONS: Record<AlertFeedEventType, IconProp> =
  getFeedIcons(ALERT_FEED_KINDS);

export const getAlertFeedEventIcon: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return getFeedEntryKind({ kinds: ALERT_FEED_KINDS, eventType }).icon;
};

const AlertFeedElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertIdString: string = props.alertId.toString();
  const [showOnCallPolicyModal, setShowOnCallPolicyModal] =
    React.useState<boolean>(false);

  const [showRunbookPickerModal, setShowRunbookPickerModal] =
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
    const isAIInvestigation: boolean = Boolean(
      alertFeed.alertFeedEventType === AlertFeedEventType.RootCause &&
        (alertFeed.aiRunId ||
          alertFeed.feedInfoInMarkdown?.includes(
            "AI — Automated Root Cause Analysis",
          )),
    );

    const kind: FeedEntryKind = isAIInvestigation
      ? SHARED_FEED_ENTRY_KINDS.AIRootCause
      : getFeedEntryKind({
          kinds: ALERT_FEED_KINDS,
          eventType: alertFeed.alertFeedEventType,
        });

    /*
     * An AI report is laid out in full by the AI Investigation card, so its
     * feed item shows only the summary and root cause; the whole report
     * unfolds under Show the full report.
     */
    const feedItemMarkdown: FeedItemMarkdown = getFeedItemMarkdown({
      isAIInvestigation,
      feedInfoInMarkdown: alertFeed.feedInfoInMarkdown,
      moreInformationInMarkdown: alertFeed.moreInformationInMarkdown,
    });

    return {
      key: alertFeed.id!.toString(),
      textInMarkdown: feedItemMarkdown.textInMarkdown,
      moreTextInMarkdown: feedItemMarkdown.moreTextInMarkdown,
      user: alertFeed.user,
      itemDateTime: alertFeed.postedAt || alertFeed.createdAt!,
      color: getFeedEntryColor({
        kind: kind,
        rowColor: alertFeed.displayColor,
      }),
      icon: kind.icon,
      burstKind: kind.burst,
      eventType: alertFeed.alertFeedEventType,
      detailsLabel: isAIInvestigation
        ? AI_REPORT_DETAILS_LABEL
        : kind.moreText,
      safeMode: isAIInvestigation,
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(AlertFeedEventType),
    getEventTypeIcon: getAlertFeedEventIcon,
    storageKey: "alert",
    resetKey: alertIdString,
  });

  const feed: UseFeedItemsResult = useFeedItems<AlertFeed>({
    resourceKey: alertIdString,
    viewKey: feedOptions.optionsKey,
    refreshToken: props.refreshToken,
    getItems: async (limit: number): Promise<ListResult<AlertFeed>> => {
      return await ModelAPI.getList({
        modelType: AlertFeed,
        query: {
          alertId: props.alertId!,
          ...getFeedEventTypeQuery<AlertFeed>(
            "alertFeedEventType",
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
          alertFeedEventType: true,
          postedAt: true,
        },
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: getFeedItemsFromAlertFeeds,
  });

  // "Add Private Note": the alert's Notes page composer, in a dialog.
  const noteActions: FeedNoteActions = useFeedNoteActions({
    keyPrefix: "alert",
    privateNoteKind: getAlertPrivateNoteKind({ alertId: props.alertId }),
    onPosted: () => {
      feed.refresh().catch((err: unknown) => {
        feed.setError(API.getFriendlyMessage(err as Exception));
      });
    },
  });

  return (
    <FeedCard
      title={"Alert Feed"}
      description={
        "Everything that has happened to this alert: status changes, notes, owners and every notification sent."
      }
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
      actions={
        <FeedActionsMenu key="alert-feed-actions-menu">
          {[
            <MoreMenuItem
              key="alert-action-run-runbook"
              text="Execute Runbook"
              icon={IconProp.Play}
              onClick={() => {
                setShowRunbookPickerModal(true);
              }}
            />,
            <MoreMenuItem
              key="alert-action-execute-policy"
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
            noItemsMessage: "Nothing has happened to this alert yet.",
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
          alertId={props.alertId}
        />

        {noteActions.dialog}
      </div>
    </FeedCard>
  );
};

export default AlertFeedElement;
