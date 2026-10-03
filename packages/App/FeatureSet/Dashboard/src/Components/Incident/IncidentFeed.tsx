import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
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
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedActionsMenu from "Common/UI/Components/Feed/FeedActionsMenu";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import {
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
 * One icon per event type, shared by the feed items and the event type
 * filter's checklist (the feed's ⋯ menu), so the two always match. A root
 * cause posted by an AI investigation is the one item that swaps its icon
 * (see getFeedItemFromIncidentFeed).
 */
export const INCIDENT_FEED_ICONS: Record<IncidentFeedEventType, IconProp> = {
  [IncidentFeedEventType.PublicNote]: IconProp.Announcement,
  [IncidentFeedEventType.SubscriberNotificationSent]: IconProp.Notification,
  [IncidentFeedEventType.OwnerNotificationSent]: IconProp.Bell,
  [IncidentFeedEventType.OwnerUserAdded]: IconProp.User,
  [IncidentFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [IncidentFeedEventType.IncidentCreated]: IconProp.Alert,
  [IncidentFeedEventType.IncidentStateChanged]: IconProp.ArrowCircleRight,
  [IncidentFeedEventType.PrivateNote]: IconProp.Lock,
  [IncidentFeedEventType.IncidentUpdated]: IconProp.Edit,
  [IncidentFeedEventType.RootCause]: IconProp.Cube,
  [IncidentFeedEventType.RemediationNotes]: IconProp.Wrench,
  [IncidentFeedEventType.PostmortemNote]: IconProp.Book,
  [IncidentFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [IncidentFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [IncidentFeedEventType.OnCallPolicy]: IconProp.Call,
  [IncidentFeedEventType.OnCallNotification]: IconProp.Alert,
  [IncidentFeedEventType.IncidentMemberAdded]: IconProp.Circle,
  [IncidentFeedEventType.IncidentMemberRemoved]: IconProp.Circle,
  [IncidentFeedEventType.AlertLinked]: IconProp.Link,
  [IncidentFeedEventType.AlertUnlinked]: IconProp.LinkSlash,
  [IncidentFeedEventType.LabelRuleExecuted]: IconProp.Tag,
  [IncidentFeedEventType.OwnerRuleExecuted]: IconProp.User,
  [IncidentFeedEventType.PrivacyRuleExecuted]: IconProp.Circle,
  [IncidentFeedEventType.OnCallRuleExecuted]: IconProp.Call,
  [IncidentFeedEventType.AutoRemediation]: IconProp.Circle,
};

export const getIncidentFeedEventIcon: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return (
    INCIDENT_FEED_ICONS[eventType as IncidentFeedEventType] || IconProp.Circle
  );
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
    let icon: IconProp = getIncidentFeedEventIcon(
      incidentFeed.incidentFeedEventType || "",
    );
    const isAIInvestigation: boolean = Boolean(
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.RootCause &&
        (incidentFeed.aiRunId ||
          incidentFeed.feedInfoInMarkdown?.includes(
            "AI — Automated Root Cause Analysis",
          )),
    );

    if (
      incidentFeed.incidentFeedEventType === IncidentFeedEventType.RootCause
    ) {
      icon = isAIInvestigation ? IconProp.Sparkles : IconProp.Cube;
    }

    /*
     * An AI report is laid out in full by the AI Investigation card, so its
     * feed item shows only the summary and root cause; the whole report sits
     * behind More Information.
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
      user: incidentFeed.user,
      itemDateTime: incidentFeed.postedAt || incidentFeed.createdAt!,
      color: incidentFeed.displayColor || Gray500,
      icon: icon,
      safeMode: isAIInvestigation,
    };
  };

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: Object.values(IncidentFeedEventType),
    getEventTypeIcon: getIncidentFeedEventIcon,
    storageKey: "incident",
    resetKey: incidentIdString,
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
  } = useFeedItems<IncidentFeed>({
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
          incidentFeedEventType: true,
          postedAt: true,
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
      refresh().catch((err: unknown) => {
        setError(API.getFriendlyMessage(err as Exception));
      });
    },
  });

  return (
    <FeedCard
      title={"Incident Feed"}
      description={
        "This is the timeline and feed for this incident. You can see all the updates and information about this incident here."
      }
      feedOptions={feedOptions}
      onRefresh={refresh}
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
        {(isLoading || !isCurrentFeedLoaded) && <ComponentLoader />}
        {isCurrentFeedLoaded && error && <ErrorMessage message={error} />}
        {isCurrentFeedLoaded && !isLoading && !error && (
          <Feed
            items={feedItems}
            noItemsMessage={getFeedNoItemsMessage({
              options: feedOptions.options,
              noItemsMessage:
                "Looks like there are no items in this feed for this incident.",
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
            refresh().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
          incidentId={props.incidentId}
        />
      </div>
    </FeedCard>
  );
};

export default IncidentFeedElement;
