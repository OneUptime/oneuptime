import ProjectUtil from "Common/UI/Utils/Project";
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
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Includes from "Common/Types/BaseDatabase/Includes";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Color from "Common/Types/Color";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
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
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import {
  SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES,
  SecurityCaseNotificationChoiceKind,
  SecurityCaseNotificationPriorityChoice,
  getSecurityCaseNotificationPriorityChoices,
  readSecurityCaseNotificationMinimum,
} from "Common/Utils/SecurityCase/SecurityCaseNotificationPriority";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";

export type ChannelKey =
  | "alertByEmail"
  | "alertBySMS"
  | "alertByCall"
  | "alertByPush"
  | "alertByWhatsApp"
  | "alertByTelegram"
  | "alertBySlack"
  | "alertByMicrosoftTeams"
  | "alertByWebhook"
  | "alertByCustomChannel";

interface ChannelDef {
  key: ChannelKey;
  label: string;
  icon: IconProp;
  color: Color;
  /*
   * Set on the two chat workspaces: their column is shown only when the
   * project has connected that workspace, since nothing can reach anybody
   * through a workspace the project never connected.
   */
  workspaceType?: WorkspaceType | undefined;
  /*
   * Set on the custom channels' column: shown only while the server has a
   * custom channel on, since nothing goes through one it does not have.
   */
  isCustomChannels?: boolean | undefined;
}

const CHANNELS: ReadonlyArray<ChannelDef> = [
  { key: "alertByEmail", label: "Email", icon: IconProp.Email, color: Blue500 },
  { key: "alertBySMS", label: "SMS", icon: IconProp.SMS, color: Purple500 },
  { key: "alertByCall", label: "Call", icon: IconProp.Call, color: Orange500 },
  {
    key: "alertByPush",
    label: "Push",
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
 * The columns a matrix shows: every channel, except a chat workspace the
 * project has not connected. A hidden column's switches keep their saved
 * value; they are only not offered.
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

interface EventDef {
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

// A choice in the reader's language, the priority's name looked up too.
export function describePriorityChoice(
  choice: Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind">,
  translator: Translator,
): string {
  return translator.translateTemplate(
    SECURITY_CASE_PRIORITY_CHOICE_TEMPLATES[choice.kind] ||
      SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES[choice.kind],
    { priority: translatableTerm(choice.name) },
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
  [NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION]: {
    label: "SLO status changed",
    description:
      "An SLO you own changes status (e.g. becomes At Risk or exhausts its error budget).",
  },
  [NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION]: {
    label: "Added as SLO owner",
    description: "You are added as an owner of a service level objective.",
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

  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION]:
    {
      label: "Maintenance event created",
      description:
        "A new scheduled maintenance event is created on a resource you own.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION]:
    {
      label: "Maintenance state changed",
      description:
        "The state of a scheduled maintenance event you own changes.",
    },
  [NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION]:
    {
      label: "Maintenance reminder",
      description:
        "Periodic reminder that a scheduled maintenance event you own has not yet finished, based on the project's reminder rules.",
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

interface ChannelCellProps {
  channel: ChannelDef;
  enabled: boolean;
  onChange: (next: boolean) => Promise<void>;
}

const ChannelCell: FunctionComponent<ChannelCellProps> = (
  props: ChannelCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const handleClick: () => Promise<void> = async (): Promise<void> => {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await props.onChange(!props.enabled);
    } finally {
      setIsBusy(false);
    }
  };

  const stateClasses: string = props.enabled
    ? "border-emerald-500/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
    : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:border-gray-300";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.enabled}
      aria-label={
        props.enabled
          ? translator.translateTemplate("{{channel}}: On. Click to disable.", {
              channel: translatableTerm(props.channel.label),
            })
          : translator.translateTemplate("{{channel}}: Off. Click to enable.", {
              channel: translatableTerm(props.channel.label),
            })
      }
      onClick={handleClick}
      disabled={isBusy}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-60 ${stateClasses}`}
    >
      {props.enabled ? (
        <Icon icon={IconProp.Check} className="h-4 w-4" size={SizeProp.Small} />
      ) : (
        <span className="block h-1.5 w-1.5 rounded-full bg-gray-300" />
      )}
    </button>
  );
};

interface PriorityChoiceProps {
  // The project's case priorities; null until they are read.
  priorities: Array<SecurityCasePriority> | null;
  // The id the person chose; empty for the default.
  chosenId: ObjectID | undefined;
  onChange: (nextId: string) => Promise<void>;
}

/*
 * The lowest priority that notifies, under the New Security Case row. A
 * plain select, saved as soon as it changes, like the switches beside it.
 * Its choices are the project's priorities; it waits for them.
 */
const PriorityChoice: FunctionComponent<PriorityChoiceProps> = (
  props: PriorityChoiceProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isBusy, setIsBusy] = useState<boolean>(false);

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

  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
      <span>{translator.translateText("Notify me about")}</span>
      <select
        className="rounded-md border border-gray-300 bg-white py-1 pl-2 pr-7 text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
        value={chosen.id.toString()}
        disabled={isBusy}
        data-testid="security-case-notification-priority"
        onChange={async (event: React.ChangeEvent<HTMLSelectElement>) => {
          setIsBusy(true);
          try {
            await props.onChange(event.target.value);
          } finally {
            setIsBusy(false);
          }
        }}
      >
        {choices.map((choice: SecurityCaseNotificationPriorityChoice) => {
          return (
            <option key={choice.priorityId} value={choice.priorityId}>
              {describePriorityChoice(choice, translator)}
            </option>
          );
        })}
      </select>
    </label>
  );
};

interface NotificationMatrixProps {
  section: SectionDef;
}

const NotificationMatrix: FunctionComponent<NotificationMatrixProps> = (
  props: NotificationMatrixProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  // The project's case priorities, which the New Security Case row picks from.
  const { values: caseValues } = useSecurityCaseValues();
  const eventTypes: Array<NotificationSettingEventType> = useMemo(() => {
    return props.section.events.map((event: EventDef) => {
      return event.type;
    });
  }, [props.section]);

  /*
   * Null on a first visit until the project's workspaces are known: the
   * matrix keeps its loader until then rather than drawing nine columns and
   * dropping two.
   */
  const offeredWorkspaces: ReadonlyArray<WorkspaceType> | null =
    getOfferedWorkspaces(useWorkspaceConnections());
  // Waited for like the workspaces: the server's custom channels that are on.
  const customChannels: CustomNotificationChannelsState =
    useCustomNotificationChannels();
  const shownChannelKeys: Array<ChannelKey> =
    offeredWorkspaces && customChannels.channels
      ? getShownChannelKeys(
          offeredWorkspaces,
          customChannels.channels.length > 0,
        )
      : [];
  const shownChannels: Array<ChannelDef> = CHANNELS.filter(
    (channel: ChannelDef): boolean => {
      return shownChannelKeys.includes(channel.key);
    },
  );

  const [rowsByEvent, setRowsByEvent] = useState<
    Map<NotificationSettingEventType, UserNotificationSetting>
  >(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchSettings: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      try {
        const result: ListResult<UserNotificationSetting> =
          await ModelAPI.getList<UserNotificationSetting>({
            modelType: UserNotificationSetting,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              userId: User.getUserId(),
              eventType: new Includes(eventTypes),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              eventType: true,
              alertByEmail: true,
              alertBySMS: true,
              alertByCall: true,
              alertByPush: true,
              alertByWhatsApp: true,
              alertByTelegram: true,
              alertBySlack: true,
              alertByMicrosoftTeams: true,
              alertByWebhook: true,
              alertByCustomChannel: true,
              minimumSecurityCasePriorityId: true,
            },
            sort: {},
          });

        const nextMap: Map<
          NotificationSettingEventType,
          UserNotificationSetting
        > = new Map();
        for (const setting of result.data) {
          if (setting.eventType) {
            nextMap.set(setting.eventType, setting);
          }
        }
        setRowsByEvent(nextMap);
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    }, [eventTypes]);

  useEffect(() => {
    fetchSettings().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchSettings]);

  const persistToggle: (
    eventType: NotificationSettingEventType,
    channelKey: ChannelKey,
    next: boolean,
  ) => Promise<void> = async (
    eventType: NotificationSettingEventType,
    channelKey: ChannelKey,
    next: boolean,
  ): Promise<void> => {
    const previous: UserNotificationSetting | undefined =
      rowsByEvent.get(eventType);

    const optimistic: UserNotificationSetting = new UserNotificationSetting();
    if (previous) {
      for (const channel of CHANNELS) {
        (optimistic as unknown as Record<string, boolean | undefined>)[
          channel.key
        ] = Boolean(
          (previous as unknown as Record<string, boolean | undefined>)[
            channel.key
          ],
        );
      }
      if (previous._id) {
        optimistic._id = previous._id;
      }
    }
    optimistic.projectId = ProjectUtil.getCurrentProjectId()!;
    optimistic.userId = User.getUserId();
    optimistic.eventType = eventType;
    (optimistic as unknown as Record<string, boolean>)[channelKey] = next;

    const optimisticMap: Map<
      NotificationSettingEventType,
      UserNotificationSetting
    > = new Map(rowsByEvent);
    optimisticMap.set(eventType, optimistic);
    setRowsByEvent(optimisticMap);

    try {
      if (previous && previous.id) {
        await ModelAPI.updateById<UserNotificationSetting>({
          modelType: UserNotificationSetting,
          id: previous.id as ObjectID,
          data: { [channelKey]: next } as JSONObject,
        });
      } else {
        const newModel: UserNotificationSetting = new UserNotificationSetting();
        newModel.projectId = ProjectUtil.getCurrentProjectId()!;
        newModel.userId = User.getUserId();
        newModel.eventType = eventType;
        for (const channel of CHANNELS) {
          (newModel as unknown as Record<string, boolean>)[channel.key] =
            channel.key === channelKey ? next : false;
        }
        await ModelAPI.create<UserNotificationSetting>({
          model: newModel,
          modelType: UserNotificationSetting,
        });
        await fetchSettings();
      }
    } catch (err) {
      const reverted: Map<
        NotificationSettingEventType,
        UserNotificationSetting
      > = new Map(rowsByEvent);
      if (previous) {
        reverted.set(eventType, previous);
      } else {
        reverted.delete(eventType);
      }
      setRowsByEvent(reverted);
      setError(API.getFriendlyMessage(err));
    }
  };

  /*
   * The New Security Case row's priority, shown at once and put back if it
   * cannot be saved. Without a row yet, one is made as the server would have
   * seeded it - email and push on - with the choice.
   */
  const persistPriority: (
    eventType: NotificationSettingEventType,
    next: string,
  ) => Promise<void> = async (
    eventType: NotificationSettingEventType,
    next: string,
  ): Promise<void> => {
    const previous: UserNotificationSetting | undefined =
      rowsByEvent.get(eventType);

    try {
      if (previous && previous.id) {
        const optimistic: UserNotificationSetting =
          new UserNotificationSetting();
        for (const channel of CHANNELS) {
          (optimistic as unknown as Record<string, boolean | undefined>)[
            channel.key
          ] = Boolean(
            (previous as unknown as Record<string, boolean | undefined>)[
              channel.key
            ],
          );
        }
        if (previous._id) {
          optimistic._id = previous._id;
        }
        optimistic.projectId = ProjectUtil.getCurrentProjectId()!;
        optimistic.userId = User.getUserId();
        optimistic.eventType = eventType;
        optimistic.minimumSecurityCasePriorityId = new ObjectID(next);

        const optimisticMap: Map<
          NotificationSettingEventType,
          UserNotificationSetting
        > = new Map(rowsByEvent);
        optimisticMap.set(eventType, optimistic);
        setRowsByEvent(optimisticMap);

        await ModelAPI.updateById<UserNotificationSetting>({
          modelType: UserNotificationSetting,
          id: previous.id as ObjectID,
          data: { minimumSecurityCasePriorityId: next } as JSONObject,
        });
      } else {
        const newModel: UserNotificationSetting = new UserNotificationSetting();
        newModel.projectId = ProjectUtil.getCurrentProjectId()!;
        newModel.userId = User.getUserId();
        newModel.eventType = eventType;
        for (const channel of CHANNELS) {
          (newModel as unknown as Record<string, boolean>)[channel.key] =
            channel.key === "alertByEmail" || channel.key === "alertByPush";
        }
        newModel.minimumSecurityCasePriorityId = new ObjectID(next);
        await ModelAPI.create<UserNotificationSetting>({
          model: newModel,
          modelType: UserNotificationSetting,
        });
        await fetchSettings();
      }
      setError("");
    } catch (err) {
      const reverted: Map<
        NotificationSettingEventType,
        UserNotificationSetting
      > = new Map(rowsByEvent);
      if (previous) {
        reverted.set(eventType, previous);
      } else {
        reverted.delete(eventType);
      }
      setRowsByEvent(reverted);
      setError(API.getFriendlyMessage(err));
    }
  };

  return (
    <Card
      title={props.section.title}
      description={props.section.description}
      bodyClassName="mt-5"
    >
      {isLoading || !offeredWorkspaces || !customChannels.channels ? (
        <ComponentLoader />
      ) : (
        <Fragment>
          {error ? (
            <div className="mb-4">
              <ErrorMessage
                message={error}
                onRefreshClick={() => {
                  fetchSettings().catch((err: Error) => {
                    setError(API.getFriendlyMessage(err));
                  });
                }}
              />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th
                    scope="col"
                    className="sticky left-0 z-0 bg-white py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  >
                    {translateString("Event")}
                  </th>
                  {shownChannels.map((channel: ChannelDef) => {
                    /*
                     * Top-aligned, so the icons stay in one row when a
                     * label takes two lines ("Microsoft Teams" in a narrow
                     * column, or a long translation such as "Correo
                     * electronico"); the Event header, centred, then sits
                     * level with the labels' first line.
                     */
                    return (
                      <th
                        key={channel.key}
                        scope="col"
                        className="px-3 py-3 text-center align-top"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <Icon
                            icon={channel.icon}
                            className="h-4 w-4 text-gray-500"
                            size={SizeProp.Regular}
                          />
                          <span className="text-[11px] font-medium text-gray-600">
                            {translateString(channel.label)}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {props.section.events.map((event: EventDef) => {
                  const row: UserNotificationSetting | undefined =
                    rowsByEvent.get(event.type);
                  return (
                    <tr
                      key={event.type}
                      className="group hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="sticky left-0 z-0 bg-white py-4 pr-4 align-top group-hover:bg-gray-50/60 transition-colors">
                        <div className="text-sm font-medium text-gray-900">
                          {translateString(event.label)}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500 max-w-md">
                          {translateString(event.description)}
                        </div>
                        {event.hasPriorityChoice ? (
                          <PriorityChoice
                            priorities={
                              caseValues ? caseValues.priorities : null
                            }
                            chosenId={row?.minimumSecurityCasePriorityId}
                            onChange={async (next: string): Promise<void> => {
                              await persistPriority(event.type, next);
                            }}
                          />
                        ) : null}
                      </td>
                      {shownChannels.map((channel: ChannelDef) => {
                        const enabled: boolean = Boolean(
                          row &&
                            (row as unknown as Record<string, boolean>)[
                              channel.key
                            ],
                        );
                        return (
                          <td
                            key={channel.key}
                            className="px-3 py-4 text-center align-middle"
                          >
                            <ChannelCell
                              channel={channel}
                              enabled={enabled}
                              onChange={async (
                                nextValue: boolean,
                              ): Promise<void> => {
                                await persistToggle(
                                  event.type,
                                  channel.key,
                                  nextValue,
                                );
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-gray-500">
            {translator.translateText(
              "Click any channel to switch it on or off. Changes save automatically.",
            )}
          </p>
        </Fragment>
      )}
    </Card>
  );
};

const incidents: Array<SectionDef> = [
  buildSection("Incidents", "Notify me about incidents on resources I own.", [
    NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION,
  ]),
  buildSection(
    "Incident Episodes",
    "Notify me about activity on incident episodes I own.",
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
  buildSection("Alerts", "Notify me about alerts on resources I own.", [
    NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION,
  ]),
  buildSection(
    "Alert Episodes",
    "Notify me about activity on alert episodes I own.",
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
  buildSection("Monitors", "Notify me about monitors I own.", [
    NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
    NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
    NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
  ]),
  buildSection("SLOs", "Notify me about SLOs I own.", [
    NotificationSettingEventType.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
    NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION,
  ]),
  buildSection("Probes", "Notify me about custom probes I own.", [
    NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
  ]),
  buildSection("AI Agents", "Notify me about AI agents I own.", [
    NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION,
  ]),
];

const statusPages: Array<SectionDef> = [
  buildSection("Status Pages", "Notify me about status pages I own.", [
    NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
    NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
  ]),
];

const scheduledMaintenance: Array<SectionDef> = [
  buildSection(
    "Scheduled Maintenance",
    "Notify me about scheduled maintenance events I own.",
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
    "On-Call",
    "Notify me about my on-call schedule and policy membership.",
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
  buildSection(
    "Incoming Call Policies",
    "Notify me about calls to incoming call policies I own.",
    [NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION],
  ),
];

const security: Array<SectionDef> = [
  buildSection(
    "Security Cases",
    "Notify me about security cases I can see: new ones at my priority, ones assigned to me, playbook steps waiting for my approval, cases about to miss a target, and tasks for me.",
    [
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
    ],
  ),
  buildSection(
    "Hunts",
    "Notify me when a scheduled hunt that names me, or a team I am on, finds security events.",
    [NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION],
  ),
];

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { translateString } = useTranslateValue();
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  const emailPreferencesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route,
  );

  const renderSections: (sections: Array<SectionDef>) => ReactElement = (
    sections: Array<SectionDef>,
  ): ReactElement => {
    return (
      <div className="space-y-4">
        {sections.map((section: SectionDef) => {
          return <NotificationMatrix key={section.title} section={section} />;
        })}
      </div>
    );
  };

  return (
    <Fragment key={projectId}>
      {/*
       * THE POINTER THAT KEEPS EMAIL VOLUME DISCOVERABLE.
       *
       * The two controls that change how much email this project sends -
       * the routine-email switch and email rollup - are not per-event, so
       * they are not rows in the matrix below and they live on their own
       * page. Without this line the matrix reads as the whole story, and a
       * reader drowning in mail would conclude that switching individual
       * events off one at a time is the only remedy OneUptime offers. It is
       * also where a rollup digest sent before the move still lands, because
       * those emails carry a link to this page.
       */}
      <div className="mb-4 rounded-md border border-gray-200 bg-white px-6 py-4 text-sm text-gray-600">
        {translateString(
          "These switches decide which notifications reach you, not how much email they add up to.",
        )}{" "}
        <Link
          to={emailPreferencesRoute}
          className="text-indigo-600 hover:underline"
        >
          {translateString(
            "Reduce routine emails or change email rollup in Email Preferences",
          )}
        </Link>
      </div>
      <Tabs
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
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default Settings;
