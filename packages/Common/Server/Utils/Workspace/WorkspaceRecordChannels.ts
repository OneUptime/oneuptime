import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceChannelName, {
  WorkspaceChannelNameParts,
} from "../../../Utils/Workspace/WorkspaceChannelName";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../Infrastructure/Semaphore";
import type { MessageBlocksByWorkspaceType } from "../../Services/WorkspaceNotificationRuleService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import AlertWorkspaceMessages from "./WorkspaceMessages/Alert";
import AlertEpisodeWorkspaceMessages from "./WorkspaceMessages/AlertEpisode";
import IncidentWorkspaceMessages from "./WorkspaceMessages/Incident";
import IncidentEpisodeWorkspaceMessages from "./WorkspaceMessages/IncidentEpisode";
import MonitorWorkspaceMessages from "./WorkspaceMessages/Monitor";
import OnCallDutyPolicyWorkspaceMessages from "./WorkspaceMessages/OnCallDutyPolicy";
import ScheduledMaintenanceWorkspaceMessages from "./WorkspaceMessages/ScheduledMaintenance";
import { WorkspaceRecord } from "./WorkspaceRecordPeople";

// Where the lock a record's later channels are opened under lives.
export const WORKSPACE_RECORD_CHANNELS_LOCK_NAMESPACE: string =
  "WorkspaceRecordChannels";

/*
 * A RECORD'S OWN CHANNELS, AS A RULE THAT STARTS TO MATCH IT LATER NEEDS
 * THEM.
 *
 * A rule creates a record's channel the first time the record matches its
 * conditions: when the record is created, or later - an incident whose rule
 * asks for the Acknowledged state gets its channel when it is acknowledged,
 * one whose rule asks for Critical when its severity is raised to it. What
 * that later channel needs from the record, one read per kind of record:
 * the channels it has already, whether it is still going on, its name for a
 * channel, whether its channel is private, and how to introduce it.
 */
export interface WorkspaceRecordChannelState {
  projectId: ObjectID;
  eventType: NotificationRuleEventType;
  /*
   * The channels OneUptime created for it, or null when its own channel
   * setup has not run: it is being created right now (its own setup creates
   * its channels), it was created before OneUptime set up channels this
   * way, no workspace was connected then, or it was created resolved. A
   * record whose setup ran holds a list, an empty one when no rule asked for
   * a channel.
   */
  channels: Array<NotificationRuleWorkspaceChannel> | null;
  /*
   * Whether it is still going on: not resolved (an incident, an alert, an
   * episode), not completed (a scheduled maintenance event). A monitor and
   * an on-call policy always are. No channel is opened for a record that is
   * over.
   */
  isOngoing: boolean;
  isPrivate: boolean;
  channelNameParts: WorkspaceChannelNameParts;
  // "Incident INC-42", "Monitor API Health": what the record is called.
  displayName: string;
  title: string;
  link: URL;
}

export default class WorkspaceRecordChannels {
  public static getEventType(
    record: WorkspaceRecord,
  ): NotificationRuleEventType | null {
    if (record.incidentId) {
      return NotificationRuleEventType.Incident;
    }

    if (record.alertId) {
      return NotificationRuleEventType.Alert;
    }

    if (record.incidentEpisodeId) {
      return NotificationRuleEventType.IncidentEpisode;
    }

    if (record.alertEpisodeId) {
      return NotificationRuleEventType.AlertEpisode;
    }

    if (record.scheduledMaintenanceId) {
      return NotificationRuleEventType.ScheduledMaintenance;
    }

    if (record.monitorId) {
      return NotificationRuleEventType.Monitor;
    }

    if (record.onCallDutyPolicyId) {
      return NotificationRuleEventType.OnCallDutyPolicy;
    }

    return null;
  }

  // The record as its channels need it, or null when it is not found.
  @CaptureSpan()
  public static async read(
    record: WorkspaceRecord,
  ): Promise<WorkspaceRecordChannelState | null> {
    if (record.incidentId) {
      return await WorkspaceRecordChannels.readIncident(record.incidentId);
    }

    if (record.alertId) {
      return await WorkspaceRecordChannels.readAlert(record.alertId);
    }

    if (record.incidentEpisodeId) {
      return await WorkspaceRecordChannels.readIncidentEpisode(
        record.incidentEpisodeId,
      );
    }

    if (record.alertEpisodeId) {
      return await WorkspaceRecordChannels.readAlertEpisode(
        record.alertEpisodeId,
      );
    }

    if (record.scheduledMaintenanceId) {
      return await WorkspaceRecordChannels.readScheduledMaintenance(
        record.scheduledMaintenanceId,
      );
    }

    if (record.monitorId) {
      return await WorkspaceRecordChannels.readMonitor(record.monitorId);
    }

    if (record.onCallDutyPolicyId) {
      return await WorkspaceRecordChannels.readOnCallDutyPolicy(
        record.onCallDutyPolicyId,
      );
    }

    return null;
  }

  /*
   * Stores the record's channels: what a rule's channel is posted to from
   * then on, and what the people the rule adds later are invited to. As
   * OneUptime, the way the record's own setup always stored them.
   */
  @CaptureSpan()
  public static async store(data: {
    record: WorkspaceRecord;
    channels: Array<NotificationRuleWorkspaceChannel>;
  }): Promise<void> {
    const channels: Array<NotificationRuleWorkspaceChannel> = data.channels;

    if (data.record.incidentId) {
      await IncidentService.updateOneById({
        id: data.record.incidentId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.alertId) {
      await AlertService.updateOneById({
        id: data.record.alertId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.incidentEpisodeId) {
      await IncidentEpisodeService.updateOneById({
        id: data.record.incidentEpisodeId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.alertEpisodeId) {
      await AlertEpisodeService.updateOneById({
        id: data.record.alertEpisodeId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.scheduledMaintenanceId) {
      await ScheduledMaintenanceService.updateOneById({
        id: data.record.scheduledMaintenanceId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.monitorId) {
      await MonitorService.updateOneById({
        id: data.record.monitorId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
      return;
    }

    if (data.record.onCallDutyPolicyId) {
      await OnCallDutyPolicyService.updateOneById({
        id: data.record.onCallDutyPolicyId,
        data: { postUpdatesToWorkspaceChannels: channels },
        props: { isRoot: true },
      });
    }
  }

  /*
   * The buttons a record's first message carries - View, Acknowledge,
   * Resolve, Add Note and the rest - for a channel opened for it later, so
   * the channel starts where one opened with the record would.
   */
  @CaptureSpan()
  public static async getActionBlocks(data: {
    record: WorkspaceRecord;
    projectId: ObjectID;
  }): Promise<Array<MessageBlocksByWorkspaceType>> {
    const record: WorkspaceRecord = data.record;

    if (record.incidentId) {
      return await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
        incidentId: record.incidentId,
        projectId: data.projectId,
      });
    }

    if (record.alertId) {
      return await AlertWorkspaceMessages.getAlertCreateMessageBlocks({
        alertId: record.alertId,
        projectId: data.projectId,
      });
    }

    if (record.incidentEpisodeId) {
      return await IncidentEpisodeWorkspaceMessages.getIncidentEpisodeCreateMessageBlocks(
        {
          incidentEpisodeId: record.incidentEpisodeId,
          projectId: data.projectId,
        },
      );
    }

    if (record.alertEpisodeId) {
      return await AlertEpisodeWorkspaceMessages.getAlertEpisodeCreateMessageBlocks(
        {
          alertEpisodeId: record.alertEpisodeId,
          projectId: data.projectId,
        },
      );
    }

    if (record.scheduledMaintenanceId) {
      return await ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
        {
          scheduledMaintenanceId: record.scheduledMaintenanceId,
          projectId: data.projectId,
        },
      );
    }

    if (record.monitorId) {
      return await MonitorWorkspaceMessages.getMonitorCreateMessageBlocks({
        monitorId: record.monitorId,
        projectId: data.projectId,
      });
    }

    if (record.onCallDutyPolicyId) {
      return await OnCallDutyPolicyWorkspaceMessages.getOnCallDutyPolicyCreateMessageBlocks(
        {
          onCallDutyPolicyId: record.onCallDutyPolicyId,
          projectId: data.projectId,
        },
      );
    }

    return [];
  }

  /*
   * Runs what opens a record's later channels while holding the record's
   * lock, so two changes of the record at once - a state change and a note
   * - never both open the channel a rule has just started to ask for: the
   * second reads the record again under the lock and finds it.
   *
   * Null, without running it, when another change still holds the lock
   * after the wait: that change is opening the record's channels. Without
   * Valkey it runs unlocked, as a state change does (StateChangeLock).
   */
  public static async runExclusive<T>(
    record: WorkspaceRecord,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    const key: string | undefined = (
      record.incidentId ||
      record.alertId ||
      record.incidentEpisodeId ||
      record.alertEpisodeId ||
      record.scheduledMaintenanceId ||
      record.monitorId ||
      record.onCallDutyPolicyId
    )?.toString();

    if (!key) {
      return null;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: key,
        namespace: WORKSPACE_RECORD_CHANNELS_LOCK_NAMESPACE,
        lockTimeout: 60 * 1000,
        acquireTimeout: 30 * 1000,
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `Another change is opening the channels of ${key}; leaving them to it.`,
        );
        return null;
      }

      // Valkey cannot be reached: go ahead without the lock.
      logger.error(err);
    }

    try {
      return await operation();
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          // The lock runs out on its own.
          logger.error(err);
        }
      }
    }
  }

  /*
   * The channels a record holds, as stored: a list, or null when nothing
   * was ever stored (JSON that is not a list reads as null).
   */
  public static channelsOf(
    value: unknown,
  ): Array<NotificationRuleWorkspaceChannel> | null {
    return Array.isArray(value)
      ? (value as Array<NotificationRuleWorkspaceChannel>)
      : null;
  }

  private static async readIncident(
    incidentId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        currentIncidentStateId: true,
        isPrivate: true,
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      return null;
    }

    const isResolved: boolean = incident.currentIncidentStateId
      ? await IncidentStateService.isResolvedIncidentState({
          projectId: incident.projectId,
          incidentStateId: incident.currentIncidentStateId,
        })
      : false;

    return {
      projectId: incident.projectId,
      eventType: NotificationRuleEventType.Incident,
      channels: WorkspaceRecordChannels.channelsOf(
        incident.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: !isResolved,
      isPrivate: incident.isPrivate === true,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.Incident,
        number: incident.incidentNumber || 0,
        numberWithPrefix: incident.incidentNumberWithPrefix || undefined,
      }),
      displayName: `Incident ${WorkspaceRecordChannels.numberOf(
        incident.incidentNumberWithPrefix,
        incident.incidentNumber,
      )}`,
      title: incident.title || "",
      link: await IncidentService.getIncidentLinkInDashboard(
        incident.projectId,
        incidentId,
      ),
    };
  }

  private static async readAlert(
    alertId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        projectId: true,
        title: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        currentAlertStateId: true,
        isPrivate: true,
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.projectId) {
      return null;
    }

    const isResolved: boolean = alert.currentAlertStateId
      ? await AlertStateService.isResolvedAlertState({
          projectId: alert.projectId,
          alertStateId: alert.currentAlertStateId,
        })
      : false;

    return {
      projectId: alert.projectId,
      eventType: NotificationRuleEventType.Alert,
      channels: WorkspaceRecordChannels.channelsOf(
        alert.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: !isResolved,
      isPrivate: alert.isPrivate === true,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.Alert,
        number: alert.alertNumber || 0,
        numberWithPrefix: alert.alertNumberWithPrefix || undefined,
      }),
      displayName: `Alert ${WorkspaceRecordChannels.numberOf(
        alert.alertNumberWithPrefix,
        alert.alertNumber,
      )}`,
      title: alert.title || "",
      link: await AlertService.getAlertLinkInDashboard(
        alert.projectId,
        alertId,
      ),
    };
  }

  private static async readIncidentEpisode(
    episodeId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: episodeId,
        select: {
          projectId: true,
          title: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          currentIncidentStateId: true,
          isPrivate: true,
          postUpdatesToWorkspaceChannels: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!episode || !episode.projectId) {
      return null;
    }

    const isResolved: boolean = episode.currentIncidentStateId
      ? await IncidentStateService.isResolvedIncidentState({
          projectId: episode.projectId,
          incidentStateId: episode.currentIncidentStateId,
        })
      : false;

    return {
      projectId: episode.projectId,
      eventType: NotificationRuleEventType.IncidentEpisode,
      channels: WorkspaceRecordChannels.channelsOf(
        episode.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: !isResolved,
      isPrivate: episode.isPrivate === true,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.IncidentEpisode,
        number: episode.episodeNumber || 0,
        numberWithPrefix: episode.episodeNumberWithPrefix || undefined,
      }),
      displayName: `Incident Episode ${WorkspaceRecordChannels.numberOf(
        episode.episodeNumberWithPrefix,
        episode.episodeNumber,
      )}`,
      title: episode.title || "",
      link: await IncidentEpisodeService.getEpisodeLinkInDashboard(
        episode.projectId,
        episodeId,
      ),
    };
  }

  private static async readAlertEpisode(
    episodeId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const episode: AlertEpisode | null = await AlertEpisodeService.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        title: true,
        episodeNumber: true,
        episodeNumberWithPrefix: true,
        currentAlertStateId: true,
        isPrivate: true,
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      return null;
    }

    const isResolved: boolean = episode.currentAlertStateId
      ? await AlertStateService.isResolvedAlertState({
          projectId: episode.projectId,
          alertStateId: episode.currentAlertStateId,
        })
      : false;

    return {
      projectId: episode.projectId,
      eventType: NotificationRuleEventType.AlertEpisode,
      channels: WorkspaceRecordChannels.channelsOf(
        episode.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: !isResolved,
      isPrivate: episode.isPrivate === true,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.AlertEpisode,
        number: episode.episodeNumber || 0,
        numberWithPrefix: episode.episodeNumberWithPrefix || undefined,
      }),
      displayName: `Alert Episode ${WorkspaceRecordChannels.numberOf(
        episode.episodeNumberWithPrefix,
        episode.episodeNumber,
      )}`,
      title: episode.title || "",
      link: await AlertEpisodeService.getEpisodeLinkInDashboard(
        episode.projectId,
        episodeId,
      ),
    };
  }

  private static async readScheduledMaintenance(
    scheduledMaintenanceId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const event: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: scheduledMaintenanceId,
        select: {
          projectId: true,
          title: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
          postUpdatesToWorkspaceChannels: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!event || !event.projectId) {
      return null;
    }

    const isCompleted: boolean =
      await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
        scheduledMaintenanceId: scheduledMaintenanceId,
      });

    return {
      projectId: event.projectId,
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      channels: WorkspaceRecordChannels.channelsOf(
        event.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: !isCompleted,
      isPrivate: false,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        number: event.scheduledMaintenanceNumber || 0,
        numberWithPrefix:
          event.scheduledMaintenanceNumberWithPrefix || undefined,
      }),
      displayName: `Scheduled Maintenance ${WorkspaceRecordChannels.numberOf(
        event.scheduledMaintenanceNumberWithPrefix,
        event.scheduledMaintenanceNumber,
      )}`,
      title: event.title || "",
      link: await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        event.projectId,
        scheduledMaintenanceId,
      ),
    };
  }

  private static async readMonitor(
    monitorId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      select: {
        projectId: true,
        name: true,
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor || !monitor.projectId) {
      return null;
    }

    return {
      projectId: monitor.projectId,
      eventType: NotificationRuleEventType.Monitor,
      channels: WorkspaceRecordChannels.channelsOf(
        monitor.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: true,
      isPrivate: false,
      channelNameParts: WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: monitor.name || "",
      }),
      displayName: `Monitor ${monitor.name || ""}`.trim(),
      // Its name is what it is called: nothing more to say after it.
      title: "",
      link: await MonitorService.getMonitorLinkInDashboard(
        monitor.projectId,
        monitorId,
      ),
    };
  }

  private static async readOnCallDutyPolicy(
    onCallDutyPolicyId: ObjectID,
  ): Promise<WorkspaceRecordChannelState | null> {
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: onCallDutyPolicyId,
        select: {
          projectId: true,
          name: true,
          postUpdatesToWorkspaceChannels: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!policy || !policy.projectId) {
      return null;
    }

    return {
      projectId: policy.projectId,
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      channels: WorkspaceRecordChannels.channelsOf(
        policy.postUpdatesToWorkspaceChannels,
      ),
      isOngoing: true,
      isPrivate: false,
      channelNameParts: WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        name: policy.name || "",
      }),
      displayName: `On-Call Policy ${policy.name || ""}`.trim(),
      title: "",
      link: await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
        policy.projectId,
        onCallDutyPolicyId,
      ),
    };
  }

  // A record's number as people read it: INC-42, or #42 without a prefix.
  private static numberOf(
    numberWithPrefix: string | undefined | null,
    num: number | undefined | null,
  ): string {
    if (numberWithPrefix) {
      return numberWithPrefix;
    }

    return `#${num === undefined || num === null ? "" : num.toString()}`;
  }
}
