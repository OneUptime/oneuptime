import React, { FunctionComponent, ReactElement } from "react";
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
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Exception from "Common/Types/Exception/Exception";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import OneUptimeDate from "Common/Types/Date";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Icon from "Common/UI/Components/Icon/Icon";
import RunbookPicker from "../Runbook/RunbookPicker";
import useFeedItems from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedOptionsButton from "Common/UI/Components/Feed/FeedOptionsButton";
import {
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";
import {
  FeedItemMarkdown,
  getFeedItemMarkdown,
} from "../../Utils/AIRootCauseFeedItem";

export interface ComponentProps {
  incidentId: ObjectID;
  refreshToken?: number | undefined;
  /*
   * Where "Notify Status Page Subscribers" starts on a new public note.
   * False when the incident was declared without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
}

/*
 * One icon per event type, shared by the feed items and the event type
 * checklist behind the Filter & Sort button, so the two always match. A root
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

  const [showPublicNoteModal, setShowPublicNoteModal] =
    React.useState<boolean>(false);

  const [showPrivateNoteModal, setShowPrivateNoteModal] =
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

  return (
    <Card
      title={"Incident Feed"}
      description={
        "This is the timeline and feed for this incident. You can see all the updates and information about this incident here."
      }
      buttons={[
        <FeedOptionsButton
          key="incident-feed-options"
          value={feedOptions.options}
          eventTypeOptions={feedOptions.eventTypeOptions}
          onChange={feedOptions.setOptions}
        />,
        <MoreMenu
          key="incident-feed-actions-menu"
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
            key="incident-action-run-runbook"
            text="Execute Runbook"
            icon={IconProp.Play}
            onClick={() => {
              setShowRunbookPickerModal(true);
            }}
          />
          <MoreMenuItem
            key="incident-action-execute-policy"
            text="Execute On-Call Policy"
            icon={IconProp.Call}
            onClick={() => {
              setShowOnCallPolicyModal(true);
            }}
          />
          <MoreMenuItem
            key="incident-action-public-note"
            text="Add Public Note"
            icon={IconProp.Team}
            onClick={() => {
              setShowPublicNoteModal(true);
            }}
          />
          <MoreMenuItem
            key="incident-action-private-note"
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
            /*
             * Seeded as a value, not only as the field's default: the form
             * drops a false default, and an unsent flag would fall back to
             * notifying.
             */
            initialValues={{
              shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                notifySubscribersByDefault,
            }}
            onBeforeCreate={async (model: IncidentPublicNote) => {
              model.incidentId = props.incidentId!;
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
                    : PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
                  title: "Notify Status Page Subscribers",
                  required: false,
                  defaultValue: notifySubscribersByDefault,
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
            refresh().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
          incidentId={props.incidentId}
        />

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
              refresh().catch((err: unknown) => {
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
                {
                  field: {
                    attachments: true,
                  },
                  fieldType: FormFieldSchemaType.MultipleFiles,
                  description:
                    "Attach files that should be visible to the incident response team.",
                  title: "Attachments",
                  required: false,
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
