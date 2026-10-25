import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleInvites, {
  NotificationRuleInvitee,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleInvites";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useId,
  useRef,
} from "react";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import NotificationRuleConditions from "./NotificationRuleConditions";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import BaseNotificationRule from "Common/Types/Workspace/NotificationRules/BaseNotificationRule";
import AlertNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/AlertNotificationRule";
import ScheduledMaintenanceNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/ScheduledMaintenanceNotificationRule";
import MonitorNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/MonitorNotificationRule";
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { WorkspaceChannelNumberPrefixes } from "Common/Utils/Workspace/WorkspaceChannelName";
import {
  CHANNEL_NAME_PREFIX_DESCRIPTIONS,
  ChannelNamePreview,
} from "./ChannelNamePreview";
import {
  ALSO_INVITE_BUTTON_TEXT,
  ALSO_INVITE_DESCRIPTION,
  ALSO_INVITE_EMPTY_TEXT,
  ALSO_INVITE_SEARCH_PLACEHOLDER,
  ALSO_INVITE_TITLE,
  ARCHIVE_CHANNEL_TITLES,
  CHATS_DESCRIPTION,
  CHATS_PLACEHOLDER,
  CHATS_TITLE,
  CREATE_CHANNEL_DESCRIPTIONS,
  CREATE_CHANNEL_TITLES,
  EXISTING_CHANNEL_NAMES_DESCRIPTIONS,
  EXISTING_CHANNEL_NAMES_TITLE,
  EXISTING_CHANNELS_TEAM_DESCRIPTION,
  INCIDENT_ROLES_DESCRIPTION,
  INCIDENT_ROLES_TITLE,
  MENTION_ON_CALL_BUTTON_TEXT,
  MENTION_ON_CALL_DESCRIPTION,
  MENTION_ON_CALL_EMPTY_TEXT,
  MENTION_ON_CALL_SEARCH_PLACEHOLDER,
  MENTION_ON_CALL_TITLE,
  NEW_CHANNEL_TEAM_DESCRIPTION,
  NO_CHATS_DESCRIPTION,
  NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS,
  ON_CALL_RESPONDERS_DESCRIPTION,
  ON_CALL_RESPONDERS_TITLE,
  OWNERS_TITLE,
  POST_TO_CHATS_DESCRIPTION,
  POST_TO_CHATS_TITLE,
  POST_TO_EXISTING_CHANNELS_DESCRIPTION,
  POST_TO_EXISTING_CHANNELS_TITLE,
  RULE_SUMMARY_TITLE,
  TEAM_PLACEHOLDER,
  TEAM_TITLE,
  TEAMS_WHO_JOINS_NOTE,
  WHO_JOINS_SECTION_DESCRIPTION,
  WHO_JOINS_SECTION_TITLE,
} from "./NotificationRuleCopy";
import NotificationRuleSummary from "./NotificationRuleSummary";
import {
  canRuleCreateChannel,
  ChannelRecordEventType,
} from "./NotificationRuleOwnChannel";

/*
 * Which half of a rule this form edits. The rule wizard asks the two on
 * separate steps: Conditions (when the rule fires) and Destination (where
 * it posts). They were one step that could show a dozen fields.
 */
export enum NotificationRuleFormPart {
  Conditions = "Conditions",
  Destination = "Destination",
}

/*
 * The form key the Destination step is registered under. It edits the
 * rule's notificationRule column, which the Conditions step already holds,
 * so it needs a key of its own; it is form-only and never sent.
 */
export const NOTIFICATION_RULE_DESTINATION_FIELD_KEY: string =
  "notificationRuleDestination";

/*
 * The people picker's own key in the Destination half: form-only, never
 * written to the rule. The picks are kept in the rule's
 * inviteUsersToNewChannel and inviteTeamsToNewChannel, as the two dropdowns
 * that asked before it kept them, and its on-call schedules in
 * inviteOnCallSchedulesToNewChannel.
 */
export const ALSO_INVITE_FIELD_KEY: string = "alsoInviteToNewChannel";

// The rule's on-call schedules in a key of the rule's own.
const ON_CALL_SCHEDULES_VALUE_KEY: string = "inviteOnCallSchedulesToNewChannel";

// Teams says who sees a channel: the note in place of who joins it.
export const TEAMS_WHO_JOINS_NOTE_FIELD_KEY: string = "teamsWhoJoinsNote";

/*
 * Microsoft Teams' schedule picker's own key: form-only, as the Slack
 * picker's is. Its picks are the rule's inviteOnCallSchedulesToNewChannel.
 */
export const MENTION_ON_CALL_FIELD_KEY: string = "mentionOnCallInNewChannel";

// What the Destination half never hands up: the keys that only draw it.
const DESTINATION_FORM_ONLY_KEYS: ReadonlyArray<string> = [
  ALSO_INVITE_FIELD_KEY,
  TEAMS_WHO_JOINS_NOTE_FIELD_KEY,
  MENTION_ON_CALL_FIELD_KEY,
];

export interface ComponentProps {
  part: NotificationRuleFormPart;
  value?: undefined | IncidentNotificationRule;
  onChange?: undefined | ((value: IncidentNotificationRule) => void);
  eventType: NotificationRuleEventType;
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  // A security case rule's: the project's own case priorities and statuses.
  securityCasePriorities?: Array<SecurityCasePriority> | undefined;
  securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
  monitorStatus: Array<MonitorStatus>;
  workspaceType: WorkspaceType;
  teams: Array<Team>;
  microsoftTeamsTeams?: Array<MicrosoftTeamsTeam>;
  microsoftTeamsChats?: Array<MicrosoftTeamsChat>;
  users: Array<User>;
  // For the summary to name the schedules whose on-call person joins.
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
  /*
   * The project's number prefixes and a monitor's or on-call policy's name,
   * for the preview of the name of the channel the rule creates.
   */
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  exampleRecordName?: string | undefined;
  error?: string | undefined;
}

type NotificationRulesType =
  | IncidentNotificationRule
  | AlertNotificationRule
  | ScheduledMaintenanceNotificationRule
  | MonitorNotificationRule;

type CreateNewChannelNotificationRuleType =
  | IncidentNotificationRule
  | AlertNotificationRule
  | ScheduledMaintenanceNotificationRule;

// Whether the rule creates a channel for each record, as the form holds it now.
const createsChannel: (
  formValue: FormValues<NotificationRulesType>,
) => boolean = (formValue: FormValues<NotificationRulesType>): boolean => {
  return Boolean(
    (formValue as CreateNewChannelNotificationRuleType).shouldCreateNewChannel,
  );
};

/*
 * The rule as the Destination half shows it: a rule that does not say
 * whether it invites the people given an incident role shows - and, once
 * changed, saves - the value it acts on (NotificationRuleInvites), so the
 * box is ticked exactly when the rule adds the Incident Commander.
 */
export const getDestinationValues: (data: {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
}) => IncidentNotificationRule | undefined = (data: {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
}): IncidentNotificationRule | undefined => {
  if (!data.rule) {
    return data.rule;
  }

  return NotificationRuleInvites.withSwitchesAsTheyAct({
    rule: data.rule,
    eventType: data.eventType,
  });
};

// The Destination half's values as the rule saves them: without its own keys.
export const withoutDestinationFormKeys: (
  value: IncidentNotificationRule,
) => IncidentNotificationRule = (
  value: IncidentNotificationRule,
): IncidentNotificationRule => {
  const rule: Record<string, unknown> = { ...value };

  for (const key of DESTINATION_FORM_ONLY_KEYS) {
    delete rule[key];
  }

  return rule as unknown as IncidentNotificationRule;
};

const NotificationRuleForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The rule as it is on this render, for handlers drawn on an earlier one.
  const latestValue: MutableRefObject<IncidentNotificationRule | undefined> =
    useRef<IncidentNotificationRule | undefined>(props.value);
  latestValue.current = props.value;

  // The channel name preview, which describes the Channel Name Prefix field.
  const channelNamePreviewId: string = useId();

  const isTeams: boolean = props.workspaceType === WorkspaceType.MicrosoftTeams;

  /*
   * The kind of record, when a rule for it can create a channel of its own.
   * A security case rule cannot (NotificationRuleOwnChannel): it only posts.
   */
  const channelEventType: ChannelRecordEventType | null = canRuleCreateChannel(
    props.eventType,
  )
    ? props.eventType
    : null;

  /*
   * When the rule fires: its conditions, then - once there are two to
   * combine - whether all of them must be met or any one is enough
   * (isFilterConditionNeeded). With one condition, All and Any fire on the
   * same events: the rule's conditions step refuses a condition without an
   * operator, the only kind the matcher (WorkspaceNotificationRuleUtil)
   * reads differently under the two. Hidden, the choice keeps what the rule
   * holds - All for a new rule (WorkspaceNotificationRulesTable) - and the
   * rule is saved with it, so it fires exactly as it would have.
   */
  const conditionFields: Array<Field<NotificationRulesType>> = [
    {
      field: {
        filters: true,
      },
      title: "Conditions",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      // The step's own field names it already ("Which incidents").
      customElementDrawsOwnLabel: true,
      getCustomElement: () => {
        return (
          <NotificationRuleConditions
            eventType={props.eventType}
            monitors={props.monitors}
            labels={props.labels}
            alertStates={props.alertStates}
            alertSeverities={props.alertSeverities}
            incidentSeverities={props.incidentSeverities}
            incidentStates={props.incidentStates}
            scheduledMaintenanceStates={props.scheduledMaintenanceStates}
            securityCasePriorities={props.securityCasePriorities}
            securityCaseStatuses={props.securityCaseStatuses}
            monitorStatus={props.monitorStatus}
            // When they are checked, over the conditions once there are some.
            conditionsDescription={
              NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS[props.eventType]
            }
            onChange={(value: Array<NotificationRuleCondition>) => {
              if (props.onChange) {
                /*
                 * Onto the rule as it is now, not as it was when this
                 * element was drawn: BasicForm keeps its fields - and this
                 * closure - a render behind, so a condition removed right
                 * after Any was picked handed the old match condition back.
                 */
                props.onChange({
                  ...latestValue.current!,
                  filters: value,
                });
              }
            }}
            value={props.value?.filters || []}
          />
        );
      },
    },
    {
      field: {
        filterCondition: true,
      },
      title: "Match Condition",
      description: "Should all conditions match, or just any one of them?",
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      radioButtonOptions: [
        {
          title: "All",
          value: FilterCondition.All,
        },
        {
          title: "Any",
          value: FilterCondition.Any,
        },
      ],
      showIf: (formValue: FormValues<NotificationRulesType>): boolean => {
        return isFilterConditionNeeded(formValue.filters);
      },
    },
  ];

  const teamOptions: Array<{ label: string; value: string }> = isTeams
    ? (props.microsoftTeamsTeams || []).map((team: MicrosoftTeamsTeam) => {
        return {
          label: team.name,
          value: team.id,
        };
      })
    : [];

  /*
   * Where it posts, and the channel it creates. Posting to channels people
   * already have comes first: the one switch most rules need. A channel of
   * the record's own follows, with who joins it - the people the record
   * has, as they join it - and, folded, the prefix of its name. A rule that
   * only posts (a security case's) asks where it posts and nothing more.
   */
  let destinationFields: Array<Field<NotificationRulesType>> = [
    {
      field: {
        shouldPostToExistingChannel: true,
      },
      title: POST_TO_EXISTING_CHANNELS_TITLE,
      description: POST_TO_EXISTING_CHANNELS_DESCRIPTION,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: {
        existingTeam: true,
      },
      title: TEAM_TITLE,
      description: EXISTING_CHANNELS_TEAM_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      placeholder: TEAM_PLACEHOLDER,
      required: true,
      showIf: (formValue: FormValues<BaseNotificationRule>) => {
        return Boolean(formValue.shouldPostToExistingChannel) && isTeams;
      },
      dropdownOptions: teamOptions,
    },
    {
      field: {
        existingChannelNames: true,
      },
      title: EXISTING_CHANNEL_NAMES_TITLE,
      description: EXISTING_CHANNEL_NAMES_DESCRIPTIONS[props.workspaceType],
      fieldType: FormFieldSchemaType.Text,
      placeholder: isTeams ? "Incidents, General" : "#incidents, #ops",
      required: true,
      showIf: (formValue: FormValues<BaseNotificationRule>) => {
        return Boolean(formValue.shouldPostToExistingChannel) || false;
      },
    },
  ];

  // Chats are a Microsoft Teams only destination.
  if (isTeams) {
    const hasConnectedChats: boolean =
      (props.microsoftTeamsChats || []).length > 0;

    destinationFields = destinationFields.concat([
      {
        field: {
          shouldPostToExistingChat: true,
        },
        title: POST_TO_CHATS_TITLE,
        description: POST_TO_CHATS_DESCRIPTION,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: {
          existingChatIds: true,
        },
        title: CHATS_TITLE,
        description: hasConnectedChats
          ? CHATS_DESCRIPTION
          : NO_CHATS_DESCRIPTION,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        placeholder: CHATS_PLACEHOLDER,
        required: true,
        showIf: (formValue: FormValues<BaseNotificationRule>) => {
          return Boolean(formValue.shouldPostToExistingChat);
        },
        dropdownOptions: (props.microsoftTeamsChats || []).map(
          (chat: MicrosoftTeamsChat) => {
            return {
              label:
                chat.chatType === "personal"
                  ? `${chat.name} (1:1 chat)`
                  : chat.name,
              value: chat.id,
            };
          },
        ),
      },
    ]);
  }

  /*
   * Who joins the channel, for a workspace that adds people one by one
   * (Slack): the kinds of people this kind of record has, ticked for a new
   * rule, then anybody the rule names - people, teams, and on-call
   * schedules, whose on-call person joins when the channel is created. Each
   * kind joins as it joins the record - the commander when assigned, the
   * person paged when paged - not only when the channel is created.
   */
  const inviteeFields: Record<
    NotificationRuleInvitee,
    Field<NotificationRulesType>
  > = {
    [NotificationRuleInvitee.OnCallResponders]: {
      field: {
        shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      } as never,
      title: ON_CALL_RESPONDERS_TITLE,
      description: ON_CALL_RESPONDERS_DESCRIPTION,
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      dataTestId: "who-joins-on-call-responders",
    },
    [NotificationRuleInvitee.IncidentRoles]: {
      field: {
        shouldInviteIncidentRolesToNewChannel: true,
      } as never,
      title: INCIDENT_ROLES_TITLE,
      description: INCIDENT_ROLES_DESCRIPTION,
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      dataTestId: "who-joins-incident-roles",
    },
    [NotificationRuleInvitee.Owners]: {
      field: {
        shouldInviteOwnersToNewChannel: true,
      } as never,
      title: OWNERS_TITLE,
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      dataTestId: "who-joins-owners",
    },
  };

  /*
   * Microsoft Teams: the same section as Slack's, with what Teams does in
   * place of the boxes - its heading and the note under it, as Slack's
   * heading and its sentence - and the schedules whose on-call person is
   * @mentioned in the channel: Teams adds nobody to one.
   */
  const whoJoinsFields: Array<Field<NotificationRulesType>> = isTeams
    ? [
        {
          field: {
            [TEAMS_WHO_JOINS_NOTE_FIELD_KEY]: true,
          } as never,
          title: WHO_JOINS_SECTION_TITLE,
          sectionTitle: WHO_JOINS_SECTION_TITLE,
          sectionDescription: (
            <span data-testid="who-joins-teams-note">
              {translator.translateText(TEAMS_WHO_JOINS_NOTE)}
            </span>
          ),
          fieldType: FormFieldSchemaType.CustomComponent,
          // The section says it all: there is nothing to fill in.
          customElementDrawsOwnLabel: true,
          required: false,
          hideOptionalLabel: true,
          showIf: createsChannel,
          getCustomElement: (): ReactElement => {
            return <></>;
          },
        },
        {
          field: {
            [MENTION_ON_CALL_FIELD_KEY]: true,
          } as never,
          title: MENTION_ON_CALL_TITLE,
          description: MENTION_ON_CALL_DESCRIPTION,
          fieldType: FormFieldSchemaType.PeoplePicker,
          required: false,
          dataTestId: "who-joins-mention-on-call",
          showIf: createsChannel,
          peoplePicker: {
            kinds: [
              {
                kind: PeoplePickerKind.OnCallSchedule,
                valueKey: ON_CALL_SCHEDULES_VALUE_KEY,
              },
            ],
            addButtonText: MENTION_ON_CALL_BUTTON_TEXT,
            searchPlaceholder: MENTION_ON_CALL_SEARCH_PLACEHOLDER,
            emptyText: MENTION_ON_CALL_EMPTY_TEXT,
          },
        },
      ]
    : [
        ...NotificationRuleInvites.getInvitees(props.eventType).map(
          (
            invitee: NotificationRuleInvitee,
            index: number,
          ): Field<NotificationRulesType> => {
            return {
              ...inviteeFields[invitee],
              showIf: createsChannel,
              ...(index === 0
                ? {
                    sectionTitle: WHO_JOINS_SECTION_TITLE,
                    sectionDescription: WHO_JOINS_SECTION_DESCRIPTION,
                  }
                : {}),
            };
          },
        ),
        {
          field: {
            [ALSO_INVITE_FIELD_KEY]: true,
          } as never,
          title: ALSO_INVITE_TITLE,
          description: ALSO_INVITE_DESCRIPTION,
          fieldType: FormFieldSchemaType.PeoplePicker,
          required: false,
          // "Also" says it is optional already.
          hideOptionalLabel: true,
          dataTestId: "who-joins-also-invite",
          showIf: createsChannel,
          peoplePicker: {
            kinds: [
              {
                kind: PeoplePickerKind.User,
                valueKey: "inviteUsersToNewChannel",
              },
              {
                kind: PeoplePickerKind.Team,
                valueKey: "inviteTeamsToNewChannel",
              },
              {
                kind: PeoplePickerKind.OnCallSchedule,
                valueKey: ON_CALL_SCHEDULES_VALUE_KEY,
              },
            ],
            addButtonText: ALSO_INVITE_BUTTON_TEXT,
            searchPlaceholder: ALSO_INVITE_SEARCH_PLACEHOLDER,
            emptyText: ALSO_INVITE_EMPTY_TEXT,
          },
        },
      ];

  // Rarely needed: a prefix in front of the channel's name.
  const channelNameSection: FormFieldCollapsibleSection<NotificationRulesType> =
    getAdvancedFormSection<NotificationRulesType>({ id: "channel-name" });

  // A channel of the record's own, and who joins it: only where it can have one.
  if (channelEventType) {
    destinationFields = destinationFields.concat([
      {
        field: {
          shouldCreateNewChannel: true,
        },
        title: CREATE_CHANNEL_TITLES[channelEventType],
        description: CREATE_CHANNEL_DESCRIPTIONS[channelEventType],
        fieldType: FormFieldSchemaType.Toggle,
        showHorizontalRuleAbove: true,
        required: false,
      },
      {
        field: {
          teamToCreateChannelIn: true,
        },
        title: TEAM_TITLE,
        description: NEW_CHANNEL_TEAM_DESCRIPTION,
        fieldType: FormFieldSchemaType.Dropdown,
        placeholder: TEAM_PLACEHOLDER,
        required: true,
        showIf: (formValue: FormValues<NotificationRulesType>) => {
          return createsChannel(formValue) && isTeams;
        },
        dropdownOptions: teamOptions,
      },
      /*
       * Slack only: OneUptime cannot archive a Microsoft Teams channel
       * (MicrosoftTeams.archiveChannels), so the switch would do nothing there.
       */
      {
        field: {
          archiveChannelAutomatically: true,
        },
        title: ARCHIVE_CHANNEL_TITLES[channelEventType],
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        showIf: (formValue: FormValues<NotificationRulesType>): boolean => {
          return createsChannel(formValue) && !isTeams;
        },
      },
      /*
       * Optional: without a prefix, a channel is named after its record -
       * inc-42 for incident INC-42 - and a prefix goes in front of that name,
       * prod-inc-42. Folded under More fields: most rules need none, and the
       * summary under the step names the channel either way. The preview
       * under the field shows the name as it is typed, worked out as the
       * server names channels (WorkspaceChannelName), and describes the field
       * to a screen reader. The placeholder shows the usual shape of a
       * prefix: a word and a hyphen.
       */
      {
        field: {
          newChannelTemplateName: true,
        },
        title: "Channel Name Prefix",
        showIf: createsChannel,
        required: false,
        description: CHANNEL_NAME_PREFIX_DESCRIPTIONS[channelEventType],
        fieldType: FormFieldSchemaType.Text,
        placeholder: "e.g. prod-",
        disableSpellCheck: true,
        dataTestId: "channel-name-prefix",
        ariaDescribedby: channelNamePreviewId,
        collapsibleSection: channelNameSection,
        getFooterElement: (
          formValue: FormValues<NotificationRulesType>,
        ): ReactElement => {
          return (
            <ChannelNamePreview
              id={channelNamePreviewId}
              workspaceType={props.workspaceType}
              eventType={props.eventType}
              prefix={
                (formValue as CreateNewChannelNotificationRuleType)
                  .newChannelTemplateName
              }
              numberPrefixes={props.numberPrefixes}
              exampleRecordName={props.exampleRecordName}
              dataTestId="channel-name-prefix-preview"
            />
          );
        },
      },
      /*
       * Who joins the channel, under a heading of its own, last: the fold
       * above it is the channel's, so it sits with the channel's switches,
       * not under who joins.
       */
      ...whoJoinsFields,
    ]);
  }

  const isDestination: boolean =
    props.part === NotificationRuleFormPart.Destination;

  // The Destination half shows a rule as it acts (getDestinationValues).
  const formValue: IncidentNotificationRule | undefined = isDestination
    ? getDestinationValues({ rule: props.value, eventType: props.eventType })
    : props.value;

  return (
    <div>
      <BasicForm
        error={props.error}
        /*
         * Seeded with the rule as well as handed it. BasicForm starts from its
         * initialValues, so without them the form opened empty - a saved
         * rule's switches drawn off - and the first change sent back only
         * what this half holds, dropping the other half: a Destination
         * change made after the Conditions step lost the conditions.
         */
        initialValues={formValue}
        values={formValue}
        onChange={(value: IncidentNotificationRule) => {
          props.onChange?.(
            isDestination ? withoutDestinationFormKeys(value) : value,
          );
        }}
        fields={isDestination ? destinationFields : conditionFields}
        hideSubmitButton={true}
      />
      {isDestination ? (
        <div
          data-testid="notification-rule-summary-section"
          className="mt-6 rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
        >
          <h4 className="mb-2 text-sm font-semibold text-gray-900">
            {translator.translateText(RULE_SUMMARY_TITLE)}
          </h4>
          <NotificationRuleSummary
            rule={props.value}
            eventType={props.eventType}
            workspaceType={props.workspaceType}
            users={props.users}
            teams={props.teams}
            onCallSchedules={props.onCallSchedules}
            microsoftTeamsTeams={props.microsoftTeamsTeams}
            microsoftTeamsChats={props.microsoftTeamsChats}
            numberPrefixes={props.numberPrefixes}
            exampleRecordName={props.exampleRecordName}
            showWhenEmpty={true}
            dataTestId="notification-rule-summary"
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default NotificationRuleForm;
