import ProjectUtil from "Common/UI/Utils/Project";
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
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  Blue500,
  Green500,
  Orange500,
  Purple500,
  Sky500,
} from "Common/Types/BrandColors";

type ChannelKey =
  | "alertByEmail"
  | "alertBySMS"
  | "alertByCall"
  | "alertByPush"
  | "alertByWhatsApp"
  | "alertByTelegram"
  | "alertByWebhook";

interface ChannelDef {
  key: ChannelKey;
  label: string;
  icon: IconProp;
  color: Color;
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
    key: "alertByWebhook",
    label: "Webhook",
    icon: IconProp.Webhook,
    color: Sky500,
  },
];

interface EventDef {
  type: NotificationSettingEventType;
  label: string;
  description: string;
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

  [NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION]: {
    label: "Alert created",
    description: "A new alert is opened on a resource you own.",
  },
  [NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION]: {
    label: "Alert state changed",
    description: "The state of an alert you own changes.",
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
      aria-label={`${props.channel.label}: ${props.enabled ? "On" : "Off"}. Click to ${props.enabled ? "disable" : "enable"}.`}
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

interface NotificationMatrixProps {
  section: SectionDef;
}

const NotificationMatrix: FunctionComponent<NotificationMatrixProps> = (
  props: NotificationMatrixProps,
): ReactElement => {
  const eventTypes: Array<NotificationSettingEventType> = useMemo(() => {
    return props.section.events.map((event: EventDef) => {
      return event.type;
    });
  }, [props.section]);

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
              alertByWebhook: true,
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

  return (
    <Card
      title={props.section.title}
      description={props.section.description}
      bodyClassName="mt-5"
    >
      {isLoading ? (
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
                    className="sticky left-0 z-10 bg-white py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  >
                    Event
                  </th>
                  {CHANNELS.map((channel: ChannelDef) => {
                    return (
                      <th
                        key={channel.key}
                        scope="col"
                        className="px-3 py-3 text-center"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <Icon
                            icon={channel.icon}
                            className="h-4 w-4 text-gray-500"
                            size={SizeProp.Regular}
                          />
                          <span className="text-[11px] font-medium text-gray-600">
                            {channel.label}
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
                      <td className="sticky left-0 z-10 bg-white py-4 pr-4 align-top group-hover:bg-gray-50/60 transition-colors">
                        <div className="text-sm font-medium text-gray-900">
                          {event.label}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500 max-w-md">
                          {event.description}
                        </div>
                      </td>
                      {CHANNELS.map((channel: ChannelDef) => {
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
                              onChange={(nextValue: boolean) => {
                                return persistToggle(
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
            Click any channel to switch it on or off. Changes save
            automatically.
          </p>
        </Fragment>
      )}
    </Card>
  );
};

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const incidentsAndAlerts: Array<SectionDef> = [
    buildSection("Incidents", "Notify me about incidents on resources I own.", [
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
    ]),
    buildSection(
      "Incident Episodes",
      "Notify me about activity on incident episodes I own.",
      [
        NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION,
        NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION,
        NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
        NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION,
      ],
    ),
    buildSection("Alerts", "Notify me about alerts on resources I own.", [
      NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
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
    buildSection("Probes", "Notify me about custom probes I own.", [
      NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
    ]),
  ];

  const statusPagesAndMaintenance: Array<SectionDef> = [
    buildSection("Status Pages", "Notify me about status pages I own.", [
      NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
    ]),
    buildSection(
      "Scheduled Maintenance",
      "Notify me about scheduled maintenance events I own.",
      [
        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION,
        NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION,
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
      ],
    ),
  ];

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
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Incidents & Alerts",
            children: renderSections(incidentsAndAlerts),
          },
          {
            name: "Monitoring",
            children: renderSections(monitoring),
          },
          {
            name: "Status Pages & Maintenance",
            children: renderSections(statusPagesAndMaintenance),
          },
          {
            name: "On-Call",
            children: renderSections(onCall),
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default Settings;
