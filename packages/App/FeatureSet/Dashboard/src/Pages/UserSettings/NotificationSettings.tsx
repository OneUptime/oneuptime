import ProjectUtil from "Common/UI/Utils/Project";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import PageComponentProps from "../PageComponentProps";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import User from "Common/UI/Utils/User";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useId,
  useState,
} from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ObjectID from "Common/Types/ObjectID";
import {
  Blue500,
  Green500,
  Indigo500,
  Orange500,
  Purple500,
  Sky500,
} from "Common/Types/BrandColors";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  getOfferedWorkspaces,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import {
  CustomNotificationChannelsState,
  useCustomNotificationChannels,
} from "../../Utils/CustomNotificationChannels";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import { recordNameInSentence } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import {
  SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES,
  SecurityCaseNotificationChoiceKind,
  SecurityCaseNotificationPriorityChoice,
  getSecurityCaseNotificationPriorityChoices,
  readSecurityCaseNotificationMinimum,
} from "Common/Utils/SecurityCase/SecurityCaseNotificationPriority";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import NotificationMatrix, {
  NotificationMatrixEvent,
  NotificationMatrixSection,
} from "../../Components/NotificationSettings/NotificationMatrix";
import {
  ChannelReadinessFacts,
  NotificationChannelDefinition,
  NotificationChannelKey,
  getChannelReach,
  useNotificationChannelReadiness,
} from "../../Components/NotificationSettings/NotificationChannelReadiness";
import {
  NotificationSettingsWords,
  OfferedChannel,
} from "../../Components/NotificationSettings/NotificationSettingsWords";
import useNotificationSettingRows, {
  NotificationSettingRows,
} from "../../Components/NotificationSettings/useNotificationSettingRows";
import ChannelsNotSetUp from "../../Components/NotificationSettings/ChannelsNotSetUp";
import NotificationTabSummary from "../../Components/NotificationSettings/NotificationTabSummary";
import UserSettingsPageIntro, {
  USER_SETTINGS_PAGE_LINK_CLASS_NAME,
} from "../../Components/UserSettings/UserSettingsPageIntro";

export {
  doesNotificationMatrixTableFit,
  NOTIFICATION_MATRIX_CHANNEL_COLUMN_WIDTH_PX,
  NOTIFICATION_MATRIX_EVENT_COLUMN_MIN_WIDTH_PX,
} from "../../Components/NotificationSettings/NotificationMatrix";

/*
 * User Settings > Notification Settings: which updates reach the person -
 * about the records they own, and about their own on-call shifts - and on
 * which channels. One switch per event and channel, saved as it is flipped.
 *
 * The page opens on what it is for, and where the two pages it is mistaken
 * for are: on-call pages follow How to Reach Me, and how much email the
 * updates add up to is Email Preferences' (#8887). Then the channels that
 * cannot reach the person yet, each a link to set it up (ChannelsNotSetUp),
 * and a tab per area, each opening on what it adds up to
 * (NotificationTabSummary) and holding a card per kind of record
 * (NotificationMatrix).
 *
 * The events, their cards and the channels are listed here; how a card is
 * drawn, read and saved is in Components/NotificationSettings.
 */

export type ChannelKey = NotificationChannelKey;

type ChannelDef = NotificationChannelDefinition;

const CHANNELS: ReadonlyArray<ChannelDef> = [
  { key: "alertByEmail", label: "Email", icon: IconProp.Email, color: Blue500 },
  { key: "alertBySMS", label: "SMS", icon: IconProp.SMS, color: Purple500 },
  /*
   * Call and Push are drawn by keys that name their meaning (#7178): the
   * bare "Call" is a function call in Chinese (调用), and "Push" a payment
   * in Arabic (الدفع). English reads them as the label.
   */
  {
    key: "alertByCall",
    label: "Call",
    word: translationKey("Call (phone call)"),
    icon: IconProp.Call,
    color: Orange500,
  },
  {
    key: "alertByPush",
    label: "Push",
    word: translationKey("Push (push notification)"),
    icon: IconProp.Notification,
    color: Sky500,
  },
  {
    key: "alertByWhatsApp",
    label: "WhatsApp",
    icon: IconProp.WhatsApp,
    color: Green500,
  },
  {
    key: "alertByTelegram",
    label: "Telegram",
    icon: IconProp.Telegram,
    color: Blue500,
  },
  {
    key: "alertBySlack",
    label: "Slack",
    icon: IconProp.Slack,
    color: Purple500,
    workspaceType: WorkspaceType.Slack,
  },
  /*
   * The product's own name, as every other list of channels writes it. The
   * bare "Teams" key means teams of people, and most languages translate it
   * that way (French "Equipes", Spanish "Equipos"), so a column labelled
   * with it named something other than the Microsoft Teams messages it
   * switches.
   */
  {
    key: "alertByMicrosoftTeams",
    label: "Microsoft Teams",
    icon: IconProp.MicrosoftTeams,
    color: Blue500,
    workspaceType: WorkspaceType.MicrosoftTeams,
  },
  {
    key: "alertByMattermost",
    label: "Mattermost",
    icon: IconProp.Mattermost,
    color: Blue500,
    workspaceType: WorkspaceType.Mattermost,
  },
  {
    key: "alertByWebhook",
    label: "Webhook",
    icon: IconProp.Webhook,
    color: Sky500,
  },
  /*
   * Every custom channel the server's admin turned on, in one column: the
   * company's own app, often, which may be how the person wants their
   * notifications too. Off for everyone until they turn it on.
   */
  {
    key: "alertByCustomChannel",
    label: "Custom Channels",
    icon: IconProp.Notification,
    color: Indigo500,
    isCustomChannels: true,
  },
];

/*
 * The columns a matrix offers: every channel, except a chat workspace the
 * project has not connected. A hidden column's switches keep their saved
 * value; they are only not offered. Which of these can reach the person is
 * NotificationChannelReadiness's to say.
 */
export function getShownChannelKeys(
  offeredWorkspaces: ReadonlyArray<WorkspaceType>,
  hasCustomChannels: boolean = false,
): Array<ChannelKey> {
  return CHANNELS.filter((channel: ChannelDef): boolean => {
    if (channel.isCustomChannels) {
      return hasCustomChannels;
    }

    return (
      !channel.workspaceType ||
      offeredWorkspaces.includes(channel.workspaceType)
    );
  }).map((channel: ChannelDef): ChannelKey => {
    return channel.key;
  });
}

/*
 * The channels the cards offer, each with whether it can reach the person,
 * in the columns' order.
 */
export function getOfferedChannels(data: {
  offeredWorkspaces: ReadonlyArray<WorkspaceType>;
  hasCustomChannels: boolean;
  readiness: ChannelReadinessFacts;
}): Array<OfferedChannel> {
  const shownKeys: Array<ChannelKey> = getShownChannelKeys(
    data.offeredWorkspaces,
    data.hasCustomChannels,
  );

  return CHANNELS.filter((channel: ChannelDef): boolean => {
    return shownKeys.includes(channel.key);
  }).map((channel: ChannelDef): OfferedChannel => {
    return {
      definition: channel,
      reach: getChannelReach(channel.key, data.readiness),
    };
  });
}

interface EventDef extends NotificationMatrixEvent {
  type: NotificationSettingEventType;
  label: string;
  description: string;
  /*
   * The row also asks for the lowest priority that notifies: the New
   * Security Case setting (UserNotificationSetting.minimumSecurityCasePriorityId).
   */
  hasPriorityChoice?: boolean | undefined;
}

// The events whose row has a priority to choose.
const PRIORITY_CHOICE_EVENT_TYPES: ReadonlyArray<NotificationSettingEventType> =
  [NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION];

/*
 * The New Security Case row's choices: one per priority of the project's
 * (Security Events > Settings > Case Priorities), most urgent first, each the
 * lowest priority that notifies, worded as the server words them in its
 * emails (SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES): the top one
 * "Critical only", the last one "Every case", the rest "High and above".
 */
export const SECURITY_CASE_PRIORITY_CHOICE_TEMPLATES: Readonly<
  Record<SecurityCaseNotificationChoiceKind, string>
> = {
  [SecurityCaseNotificationChoiceKind.Only]:
    translationKey("{{priority}} only"),
  [SecurityCaseNotificationChoiceKind.AndAbove]: translationKey(
    "{{priority}} and above",
  ),
  [SecurityCaseNotificationChoiceKind.Every]: translationKey("Every case"),
};

/*
 * A choice in the reader's language, the priority's name read by its list
 * (Common/Utils/DefaultRecordNames): the five a project starts with in the
 * reader's words, a priority the project named itself as written.
 */
export function describePriorityChoice(
  choice: Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind">,
  translator: Translator,
): string {
  return translator.translateTemplate(
    SECURITY_CASE_PRIORITY_CHOICE_TEMPLATES[choice.kind] ||
      SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES[choice.kind],
    {
      priority: recordNameInSentence(
        StateListType.SecurityCasePriority,
        choice.name,
      ),
    },
  );
}

const EVENT_LIBRARY: Record<
  NotificationSettingEventType,
  { label: string; description: string }
> = {
  [NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION]: {
    label: "Incident created",
    description: "A new incident is opened on a resource you own.",
  },
  [NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Incident state changed",
      description:
        "The state of an incident you own changes (e.g. acknowledged, resolved).",
    },
  [NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION]: {
    label: "Incident reminder",
    description:
      "Periodic reminder that an incident you own is still open, based on the project's reminder rules.",
  },
  [NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION]:
    {
      label: "Incident SLA breached",
      description:
        "An incident you own misses its SLA response or resolution deadline.",
    },
  [NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION]: {
    label: "Incident note posted",
    description: "Someone posts a note on an incident you own.",
  },
  [NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as incident owner",
    description: "You are added as an owner of an incident.",
  },
  [NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION]: {
    label: "Assigned to an incident",
    description: "You are assigned to an incident as a member.",
  },

  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    {
      label: "Incident episode created",
      description: "A new episode is created on an incident you own.",
    },
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Incident episode state changed",
      description: "The state of an incident episode you own changes.",
    },
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    {
      label: "Incident episode note posted",
      description: "Someone posts a note on an incident episode you own.",
    },
  [NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION]:
    {
      label: "Added as incident episode owner",
      description: "You are added as an owner of an incident episode.",
    },
  [NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    {
      label: "Incident added to incident episode",
      description:
        "A new incident is added to an existing incident episode you own.",
    },

  [NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION]: {
    label: "Alert created",
    description: "A new alert is opened on a resource you own.",
  },
  [NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION]: {
    label: "Alert state changed",
    description: "The state of an alert you own changes.",
  },
  [NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION]: {
    label: "Alert reminder",
    description:
      "Periodic reminder that an alert you own is still open, based on the project's reminder rules.",
  },
  [NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION]: {
    label: "Alert note posted",
    description: "Someone posts a note on an alert you own.",
  },
  [NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as alert owner",
    description: "You are added as an owner of an alert.",
  },

  [NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION]:
    {
      label: "Alert episode created",
      description: "A new episode is created on an alert you own.",
    },
  [NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Alert episode state changed",
      description: "The state of an alert episode you own changes.",
    },
  [NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION]:
    {
      label: "Alert episode note posted",
      description: "Someone posts a note on an alert episode you own.",
    },
  [NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as alert episode owner",
    description: "You are added as an owner of an alert episode.",
  },
  [NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION]:
    {
      label: "Alert added to alert episode",
      description: "A new alert is added to an existing alert episode you own.",
    },

  [NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION]: {
    label: "Monitor created",
    description: "A new monitor is created and you are its owner.",
  },
  [NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Monitor status changed",
      description: "The status of a monitor you own changes (up, down, etc.).",
    },
  [NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as monitor owner",
    description: "You are added as an owner of a monitor.",
  },
  [NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as monitor group owner",
    description: "You are added as an owner of a monitor group.",
  },
  [NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION]: {
    label: "SLO status changed",
    description:
      "An SLO you own changes status (e.g. becomes At Risk or exhausts its error budget).",
  },
  [NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as SLO owner",
    description: "You are added as an owner of a service level objective.",
  },
  [NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION]: {
    label: "Exception assigned to me",
    description:
      "Someone assigns an exception to you, or to a team you are on.",
  },
  [NotificationSettingEventType.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as table owner",
    description: "You are added as an owner of a table.",
  },
  [NotificationSettingEventType.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as pipeline owner",
    description: "You are added as an owner of a pipeline.",
  },
  [NotificationSettingEventType.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as data store owner",
    description: "You are added as an owner of a data store.",
  },
  [NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION]:
    {
      label: "Added as service or infrastructure owner",
      description:
        "You are added as an owner of a service, a RUM application, a host, a cluster, a database, a queue, a cloud resource or other infrastructure.",
    },
  [NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as dashboard owner",
    description: "You are added as an owner of a dashboard.",
  },
  [NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as workflow owner",
    description: "You are added as an owner of a workflow.",
  },
  [NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as runbook owner",
    description: "You are added as an owner of a runbook.",
  },
  [NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as Runner owner",
    description:
      "You are added as an owner of a Runner, which runs runbook steps and AI code fixes.",
  },
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES]:
    {
      label: "Probe status changed for your monitor",
      description: "A probe monitoring one of your resources changes status.",
    },
  [NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR]:
    {
      label: "Monitor has no active probes",
      description:
        "No probes are currently monitoring one of your resources — coverage gap.",
    },

  [NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION]: {
    label: "Probe status changed",
    description: "The status of a custom probe you own changes.",
  },
  [NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as probe owner",
    description: "You are added as an owner of a probe.",
  },

  [NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION]: {
    label: "Status page created",
    description: "A new status page is created and you are its owner.",
  },
  [NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION]:
    {
      label: "Status page announcement posted",
      description: "An announcement is posted on a status page you own.",
    },
  [NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as status page owner",
    description: "You are added as an owner of a status page.",
  },
  [NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION]:
    {
      label: "Public note waiting for my approval",
      description:
        "A public note on an incident, episode or maintenance event waits for you, or a team you are on, to approve it. It reaches status pages and subscribers only once it is approved.",
    },
  [NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION]:
    {
      label: "My public note approved or rejected",
      description:
        "A public note you sent for approval is approved and published, or rejected with a reason.",
    },

  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION]:
    {
      label: "Maintenance event created",
      description: "A new maintenance event is created on a resource you own.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Maintenance state changed",
      description: "The state of a maintenance event you own changes.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION]:
    {
      label: "Maintenance reminder",
      description:
        "Periodic reminder that a maintenance event you own has not yet finished, based on the project's reminder rules.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION]:
    {
      label: "Maintenance note posted",
      description: "Someone posts a note on a maintenance event you own.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION]:
    {
      label: "Added as maintenance owner",
      description: "You are added as an owner of a maintenance event.",
    },

  [NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "AI agent status changed",
      description: "The status of an AI agent you own changes.",
    },
  [NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as AI agent owner",
    description: "You are added as an owner of an AI agent.",
  },

  [NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION]: {
    label: "New security case",
    description:
      "A security case you can see opens, or rises, at the priority you choose here or above.",
  },
  [NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION]: {
    label: "Security case assigned to me",
    description: "A security case is assigned to you, or to a team you are on.",
  },
  [NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION]: {
    label: "Playbook step waiting for my approval",
    description:
      "A playbook step on a security case waits for someone who can approve it. Nothing runs until somebody approves or rejects it.",
  },
  [NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION]: {
    label: "Security case response target",
    description:
      "A security case you are on is about to miss its acknowledge or contain target, or misses it. When nobody is on the case, you hear it for cases at your chosen priority.",
  },
  [NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION]:
    {
      label: "Security case task assigned to me",
      description: "A task on a security case is assigned to you.",
    },
  [NotificationSettingEventType.SEND_SECURITY_CASE_STEP_REGRESSED_NOTIFICATION]:
    {
      label: "Security case step stopped holding",
      description:
        "A step of a security case you are on that OneUptime saw done stops holding, such as a blocked address getting through again. When nobody is on the case, you hear it for cases at your chosen priority.",
    },
  [NotificationSettingEventType.SEND_SECURITY_CASE_AI_HANDED_OFF_NOTIFICATION]:
    {
      label: "OneUptime AI handed a security case to people",
      description:
        "OneUptime AI stops working a security case you are on and says why. When nobody is on the case, you hear it for cases at your chosen priority.",
    },
  [NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION]: {
    label: "Hunt found security events",
    description:
      "A scheduled hunt that names you, or a team you are on, finds security events.",
  },

  [NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION]: {
    label: "Missed call",
    description:
      "A call to an incoming call policy you own ends without reaching anyone.",
  },
  [NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION]:
    {
      label: "Added as incoming call policy owner",
      description: "You are added as an owner of an incoming call policy.",
    },
  [NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as on-call policy owner",
    description: "You are added as an owner of an on-call policy.",
  },
  [NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION]:
    {
      label: "Added as on-call schedule owner",
      description: "You are added as an owner of an on-call schedule.",
    },

  [NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER]: {
    label: "You go on-call",
    description: "Your shift on an on-call roster begins.",
  },
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER]: {
    label: "You are up next on-call",
    description: "You are the next person scheduled on an on-call roster.",
  },
  [NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER]:
    {
      label: "You go off-call",
      description: "Your shift on an on-call roster ends.",
    },
  [NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY]: {
    label: "Added to on-call policy",
    description: "You are added to an on-call policy.",
  },
  [NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY]:
    {
      label: "Removed from on-call policy",
      description: "You are removed from an on-call policy.",
    },
  [NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS]: {
    label: "Before my on-call shift starts",
    description:
      "Reminders ahead of a shift, at the lead times you pick on the Calendar Feed page.",
  },
  [NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED]: {
    label: "My upcoming on-call shift is reassigned",
    description:
      "A shift you were reminded about is now covered by someone else.",
  },
};

interface SectionDef {
  title: string;
  description: string;
  events: Array<EventDef>;
}

type SectionFactory = (
  title: string,
  description: string,
  types: Array<NotificationSettingEventType>,
) => SectionDef;

const buildSection: SectionFactory = (
  title: string,
  description: string,
  types: Array<NotificationSettingEventType>,
): SectionDef => {
  return {
    title,
    description,
    events: types.map((type: NotificationSettingEventType): EventDef => {
      const entry: { label: string; description: string } = EVENT_LIBRARY[type];
      return {
        type,
        label: entry.label,
        description: entry.description,
        hasPriorityChoice: PRIORITY_CHOICE_EVENT_TYPES.includes(type),
      };
    }),
  };
};

export interface PriorityChoiceProps {
  // The project's case priorities; null until they are read.
  priorities: Array<SecurityCasePriority> | null;
  // The id the person chose; empty for the default.
  chosenId: ObjectID | undefined;
  onChange: (nextId: string) => Promise<void>;
}

/*
 * The priority picker's own classes, exported so its test reads the same
 * strings. The words and the shared Dropdown share a row while they fit,
 * and the Dropdown goes under the words in a column too narrow for both.
 */
export const PRIORITY_CHOICE_ROW_CLASS_NAME: string =
  "mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600";
export const PRIORITY_CHOICE_DROPDOWN_CLASS_NAME: string =
  "relative min-w-[12rem] max-w-xs flex-1 overflow-visible";

/*
 * The project's priorities as the picker's options, in the reader's
 * language already ("High and above"): drawn as given, never looked up a
 * second time, and read the page's way.
 */
export function getPriorityChoiceOptions(
  choices: Array<SecurityCaseNotificationPriorityChoice>,
  translator: Translator,
): Array<DropdownOption> {
  return choices.map(
    (choice: SecurityCaseNotificationPriorityChoice): DropdownOption => {
      return {
        value: choice.priorityId,
        label: describePriorityChoice(choice, translator),
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );
}

/*
 * The lowest priority that notifies, under the New Security Case row. The
 * shared Dropdown, saved as soon as it changes, like the switches beside
 * it: its size, border, focus ring and dark theme are every other picker's.
 * It was a raw select element with classes of its own (#9194). Its choices
 * are the project's priorities; it waits for them.
 */
export const PriorityChoice: FunctionComponent<PriorityChoiceProps> = (
  props: PriorityChoiceProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const labelId: string = `security-case-notification-priority-label-${useId()}`;

  if (!props.priorities) {
    return <></>;
  }

  const chosen: SecurityCasePriority | null =
    readSecurityCaseNotificationMinimum(props.priorities, props.chosenId);
  const choices: Array<SecurityCaseNotificationPriorityChoice> =
    getSecurityCaseNotificationPriorityChoices({
      priorities: props.priorities,
      currentId: chosen?.id,
    });

  if (!chosen?.id || choices.length === 0) {
    return <></>;
  }

  const options: Array<DropdownOption> = getPriorityChoiceOptions(
    choices,
    translator,
  );
  const chosenId: string = chosen.id.toString();
  const chosenOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === chosenId;
    },
  );

  return (
    <div className={PRIORITY_CHOICE_ROW_CLASS_NAME}>
      <span id={labelId}>{translator.translateText("Notify me about")}</span>
      <Dropdown
        className={PRIORITY_CHOICE_DROPDOWN_CLASS_NAME}
        options={options}
        value={chosenOption}
        disabled={isBusy}
        isLoading={isBusy}
        // A priority always notifies: there is nothing to clear it to.
        isClearable={false}
        ariaLabelledby={labelId}
        dataTestId="security-case-notification-priority"
        onChange={async (
          next: DropdownValue | Array<DropdownValue> | null,
        ): Promise<void> => {
          if (typeof next !== "string" || next === chosenId) {
            return;
          }

          setIsBusy(true);
          try {
            await props.onChange(next);
          } catch {
            // The card says why, over the matrix.
          } finally {
            setIsBusy(false);
          }
        }}
      />
    </div>
  );
};

const incidents: Array<SectionDef> = [
  buildSection(
    translationKey("Incidents"),
    translationKey("Notify me about incidents on resources I own."),
    [
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION,
    ],
  ),
  buildSection(
    translationKey("Incident Episodes"),
    translationKey("Notify me about activity on incident episodes I own."),
    [
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    ],
  ),
];

const alerts: Array<SectionDef> = [
  buildSection(
    translationKey("Alerts"),
    translationKey("Notify me about alerts on resources I own."),
    [
      NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  buildSection(
    translationKey("Alert Episodes"),
    translationKey("Notify me about activity on alert episodes I own."),
    [
      NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION,
    ],
  ),
];

const monitoring: Array<SectionDef> = [
  buildSection(
    translationKey("Monitors"),
    translationKey("Notify me about monitors I own."),
    [
      NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
      // A group of them, made an owner of on its Owners page (#9758).
      NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
    ],
  ),
  buildSection(
    translationKey("SLOs"),
    translationKey("Notify me about SLOs I own."),
    [
      NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
      NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  // Keys of their own, so the card says them in the reader's language.
  buildSection(
    translationKey("Exceptions"),
    translationKey(
      "Notify me about exceptions assigned to me or to a team I am on.",
    ),
    [NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION],
  ),
  buildSection(
    translationKey("Probes"),
    translationKey("Notify me about custom probes I own."),
    [
      NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  buildSection(
    translationKey("AI Agents"),
    translationKey("Notify me about AI agents I own."),
    [
      NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  /*
   * Tables and pipelines (#9681): being made an owner, by an owner rule
   * whose Notify Owners is on or on an Owners page.
   */
  buildSection(
    translationKey("Data Observability"),
    translationKey("Notify me about tables and pipelines I own."),
    [
      NotificationSettingEventType.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  /*
   * Services, apps and infrastructure (#9700): one switch for being made an
   * owner of any of them - a service, a RUM application, a host, a cluster,
   * a database, a queue, a cloud resource - by an owner rule whose Notify
   * Owners is on or on an Owners page. The message names which it is.
   */
  buildSection(
    translationKey("Services and Infrastructure"),
    translationKey("Notify me about the services and infrastructure I own."),
    [
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  /*
   * Dashboards, workflows and runbooks (#9700), the products menu's own
   * group, and the Runners that run runbook steps (#9758).
   */
  buildSection(
    translationKey("Dashboards & Automation"),
    translationKey(
      "Notify me about dashboards, workflows, runbooks and Runners I own.",
    ),
    [
      NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION,
    ],
  ),
];

const statusPages: Array<SectionDef> = [
  buildSection(
    translationKey("Status Pages"),
    translationKey("Notify me about status pages I own."),
    [
      NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  buildSection(
    translationKey("Public Note Approval"),
    translationKey(
      "Notify me about public notes that wait for approval before they are published on status pages.",
    ),
    [
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION,
    ],
  ),
];

const scheduledMaintenance: Array<SectionDef> = [
  buildSection(
    translationKey("Scheduled Maintenance"),
    translationKey("Notify me about maintenance events I own."),
    [
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
];

const onCall: Array<SectionDef> = [
  buildSection(
    translationKey("On-Call"),
    translationKey(
      "Notify me about my on-call schedule and policy membership.",
    ),
    [
      NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
      NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
      NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
      NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    ],
  ),
  /*
   * The on-call policies and schedules the person owns (#9700): being made
   * an owner of one. Apart from the card above, which is about the person's
   * own shifts and the policies that page them.
   */
  buildSection(
    translationKey("On-Call Policies and Schedules"),
    translationKey("Notify me about on-call policies and schedules I own."),
    [
      NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
      NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION,
    ],
  ),
  buildSection(
    translationKey("Incoming Call Policies"),
    translationKey("Notify me about incoming call policies I own."),
    [
      NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
    ],
  ),
];

const security: Array<SectionDef> = [
  buildSection(
    translationKey("Security Cases"),
    translationKey(
      "Notify me about security cases I can see: new ones at my priority, ones assigned to me, playbook steps waiting for my approval, cases about to miss a target, tasks for me, steps that stop holding, and cases OneUptime AI hands to people.",
    ),
    [
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_STEP_REGRESSED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_AI_HANDED_OFF_NOTIFICATION,
    ],
  ),
  // Keys of their own, so the card says them in the reader's language.
  buildSection(
    translationKey("Hunts"),
    translationKey(
      "Notify me when a scheduled hunt that names me, or a team I am on, finds security events.",
    ),
    [NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION],
  ),
  /*
   * Data stores (#9681): being made an owner, by an owner rule whose Notify
   * Owners is on or on a store's Owners page.
   */
  buildSection(
    translationKey("Data Security"),
    translationKey("Notify me about data stores I own."),
    [NotificationSettingEventType.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION],
  ),
];

/*
 * Every card of the page, tab by tab, in its order: what its tests walk
 * through, so an event is checked the day it is listed here.
 */
export const NOTIFICATION_SETTINGS_CARDS: ReadonlyArray<NotificationMatrixSection> =
  [
    ...incidents,
    ...alerts,
    ...monitoring,
    ...statusPages,
    ...scheduledMaintenance,
    ...onCall,
    ...security,
  ];

// Every event the page lists, read in one go.
const ALL_EVENT_TYPES: Array<NotificationSettingEventType> =
  NOTIFICATION_SETTINGS_CARDS.flatMap(
    (
      section: NotificationMatrixSection,
    ): Array<NotificationSettingEventType> => {
      return section.events.map(
        (event: NotificationMatrixEvent): NotificationSettingEventType => {
          return event.type;
        },
      );
    },
  );

export const NOTIFICATION_SETTINGS_INTRO_TEST_ID: string =
  "notification-settings-intro";

/*
 * THE PAGE'S FIRST LINE.
 *
 * What the page is for, and where the two pages it is mistaken for are. It
 * used to open on a grey box that said what the switches do NOT do ("not
 * how much email they add up to") - the pointer that keeps the email-volume
 * controls findable since they moved to Email Preferences, and the place a
 * rollup digest sent before the move still lands, because those emails
 * carry a link here. The pointer is kept, as one of the two links, after a
 * sentence that says what the page does.
 */
const NotificationSettingsIntro: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const howToReachMeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route,
  );
  const emailPreferencesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route,
  );

  return (
    <UserSettingsPageIntro
      docsPath="/docs/notifications/notification-settings"
      dataTestId={NOTIFICATION_SETTINGS_INTRO_TEST_ID}
    >
      {translator.translateText(NotificationSettingsWords.intro)}{" "}
      <TranslatedSentence
        template={NotificationSettingsWords.introSiblings}
        slots={{
          howToReachMe: (
            <Link
              to={howToReachMeRoute}
              className={USER_SETTINGS_PAGE_LINK_CLASS_NAME}
            >
              {translator.translateText("How to Reach Me")}
            </Link>
          ),
          emailPreferences: (
            <Link
              to={emailPreferencesRoute}
              className={USER_SETTINGS_PAGE_LINK_CLASS_NAME}
            >
              {translator.translateText("Email Preferences")}
            </Link>
          ),
        }}
      />
    </UserSettingsPageIntro>
  );
};

/*
 * Everything the cards need before they can be drawn: the rows, which
 * workspaces the project has connected, the server's custom channels, and
 * what can reach the person. A card keeps its loader until all are in, so
 * no column appears or goes under the reader.
 */
const NotificationSettingsBody: FunctionComponent = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const userId: ObjectID | null = User.getUserId();

  const settings: NotificationSettingRows = useNotificationSettingRows({
    projectId: projectId,
    userId: userId,
    eventTypes: ALL_EVENT_TYPES,
  });

  /*
   * Null on a first visit until the project's workspaces are known: the
   * cards keep their loaders until then rather than drawing every
   * workspace's column and dropping the ones the project has not connected.
   */
  const offeredWorkspaces: ReadonlyArray<WorkspaceType> | null =
    getOfferedWorkspaces(useWorkspaceConnections());
  // Waited for like the workspaces: the server's custom channels that are on.
  const customChannels: CustomNotificationChannelsState =
    useCustomNotificationChannels();
  // Waited for too: which channels can reach the person.
  const readiness: ChannelReadinessFacts | null =
    useNotificationChannelReadiness({ projectId: projectId, userId: userId });
  // The project's case priorities, which the New Security Case row picks from.
  const { values: caseValues } = useSecurityCaseValues();

  const isReady: boolean = Boolean(
    !settings.isLoading &&
      offeredWorkspaces &&
      customChannels.channels &&
      readiness,
  );

  const channels: Array<OfferedChannel> =
    isReady && offeredWorkspaces && customChannels.channels && readiness
      ? getOfferedChannels({
          offeredWorkspaces: offeredWorkspaces,
          hasCustomChannels: customChannels.channels.length > 0,
          readiness: readiness,
        })
      : [];

  const renderSection: (section: SectionDef) => ReactElement = (
    section: SectionDef,
  ): ReactElement => {
    if (!isReady || settings.loadError) {
      return (
        <Card
          key={section.title}
          title={section.title}
          description={section.description}
          bodyClassName="mt-5"
        >
          {settings.loadError && !settings.isLoading ? (
            <ErrorMessage
              message={settings.loadError}
              onRefreshClick={() => {
                settings.reload().catch(() => {
                  // reload() reports its own failure.
                });
              }}
            />
          ) : (
            <DetailListSkeleton fields={3} columns={1} />
          )}
        </Card>
      );
    }

    return (
      <NotificationMatrix
        key={section.title}
        section={section}
        channels={channels}
        rowsByEvent={settings.rowsByEvent}
        setChannel={settings.setChannel}
        renderEventDetail={(
          event: NotificationMatrixEvent,
          row: UserNotificationSetting | undefined,
          onSaving: <T>(save: Promise<T>) => Promise<T>,
        ): ReactElement | null => {
          if (!(event as EventDef).hasPriorityChoice) {
            return null;
          }

          return (
            <PriorityChoice
              priorities={caseValues ? caseValues.priorities : null}
              chosenId={row?.minimumSecurityCasePriorityId}
              onChange={async (next: string): Promise<void> => {
                await onSaving(settings.setPriority(event.type, next));
              }}
            />
          );
        }}
      />
    );
  };

  const renderSections: (sections: Array<SectionDef>) => ReactElement = (
    sections: Array<SectionDef>,
  ): ReactElement => {
    const eventTypes: Array<NotificationSettingEventType> = sections.flatMap(
      (section: SectionDef): Array<NotificationSettingEventType> => {
        return section.events.map(
          (event: EventDef): NotificationSettingEventType => {
            return event.type;
          },
        );
      },
    );

    return (
      <div className="space-y-4">
        {isReady && !settings.loadError ? (
          <NotificationTabSummary
            eventTypes={eventTypes}
            rowsByEvent={settings.rowsByEvent}
            channels={channels}
          />
        ) : (
          <></>
        )}
        {sections.map(renderSection)}
      </div>
    );
  };

  return (
    <Fragment>
      <NotificationSettingsIntro />
      {isReady && !settings.loadError ? (
        <ChannelsNotSetUp channels={channels} />
      ) : (
        <></>
      )}
      <Tabs
        label="Notification Settings"
        tabs={[
          {
            name: "Incidents",
            children: renderSections(incidents),
          },
          {
            name: "Alerts",
            children: renderSections(alerts),
          },
          {
            name: "Monitoring",
            children: renderSections(monitoring),
          },
          {
            name: "Status Pages",
            children: renderSections(statusPages),
          },
          {
            name: "Scheduled Maintenance",
            children: renderSections(scheduledMaintenance),
          },
          {
            name: "On-Call",
            children: renderSections(onCall),
          },
          {
            name: "Security",
            children: renderSections(security),
          },
        ]}
        /*
         * Seven areas: beside the side menu on a tablet, or on a phone, one
         * row of them ran past the page (Security and On-Call out of sight,
         * the page scrolling sideways). They wrap onto a second row
         * instead, every area in sight, as the matrix below them does.
         */
        wrap={true}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * Keyed by project, so switching projects reads every row, method and
   * channel again rather than showing the previous project's.
   */
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  return <NotificationSettingsBody key={projectId} />;
};

export default Settings;
