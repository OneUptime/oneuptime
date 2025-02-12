import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../Types/ObjectID";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceMessagePayload, { WorkspaceMessageBlock } from "../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import SlackUtil from "../Utils/Slack/Slack";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import SlackNotificationRule from "../../Types/Workspace/NotificationRules/SlackNotificationRule";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentService from "./IncidentService";
import { NotificationRuleConditionCheckOn } from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import BadDataException from "../../Types/Exception/BadDataException";
import Label from "../../Models/DatabaseModels/Label";
import MonitorService from "./MonitorService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import { WorkspaceNotificationRuleUtil } from "../../Types/Workspace/NotificationRules/NotificationRuleUtil";


export interface NotificationFor {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorStatusTimelineId?: ObjectID | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async executeNotificationRules(data: {
    projectId: ObjectID;
    notificationRuleEventType: NotificationRuleEventType;
    workspaceMessageBlocks: Array<WorkspaceMessageBlock>;
    alreadyCreatedChannelIds: Array<string>;
    notificationFor: NotificationFor;
  }): Promise<void> {
    logger.debug("Notify Workspaces");
    logger.debug(data);

    // this is an array because, slack and teams can both be connected. 
    const projectAuths: Array<WorkspaceProjectAuthToken> = await WorkspaceProjectAuthTokenService.getProjectAuths({
      projectId: data.projectId,
    });

    for (const projectAuth of projectAuths) {

      if (!projectAuth.workspaceType) {
        // No workspace type. Skipping... 
        continue;
      }

      await this.executeNotificationRulesForWorkspace({
        projectId: data.projectId,
        projectAuth: projectAuth,
        workspaceType: projectAuth.workspaceType!,
        notificationRuleEventType: data.notificationRuleEventType,
        alreadyCreatedChannelIds: data.alreadyCreatedChannelIds,
        workspaceMessageBlocks: data.workspaceMessageBlocks,
        notificaitonFor: data.notificationFor,
      });
    }
  }

  private async executeNotificationRulesForWorkspace(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    workspaceMessageBlocks: Array<WorkspaceMessageBlock>;
    projectAuth: WorkspaceProjectAuthToken;
    alreadyCreatedChannelIds: Array<string>;
    notificationFor: NotificationFor;
  }): Promise<void> {

    logger.debug("Notify Workspace");
    logger.debug(data);


    if (!data.projectAuth.authToken) {
      logger.debug("No auth token. Skipping...");
      return;
    }

    const matchedNotificationRules: Array<Model> = await this.getMatchingNotificationRules({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
      notificationFor: data.notificationFor,
    });


    if(matchedNotificationRules.length === 0) {
      logger.debug("No matching notification rules found. Skipping...");
      return;
    }

    const workspaceMessagePayload: WorkspaceMessagePayload = this.getWorkspaceMessagePayload({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
      workspaceMessageBlocks: data.workspaceMessageBlocks,
      alreadyCreatedChannelIds: data.alreadyCreatedChannelIds,
    });

    if (data.workspaceType === WorkspaceType.Slack) {
      await SlackUtil.sendMessage({
        workspaceMessagePayload: workspaceMessagePayload,
        authToken: data.projectAuth.authToken, // send from bot token.
      });
    }
  }


  private async getNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        eventType: data.notificationRuleEventType,
      },
      select: {
        notificationRule: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT
    });
  }


  private async getValuesBasedOnNotificationFor(data: {
    notificationFor: NotificationFor;
  }): Promise<{
    [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
  }> {

    if (data.notificationFor.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.notificationFor.incidentId,
        select: {
          title: true,
          description: true,
          incidentSeverity: true,
          currentIncidentState: true,
          labels: true,
          monitors: true,
        },
        props: {
          isRoot: true,
        }
      });


      if (!incident) {
        throw new BadDataException("Incident ID not found");
      }

      const monitorLabels: Array<Label> = await MonitorService.getLabelsForMonitors({
        monitorIds: incident.monitors?.map((monitor) => {
          return monitor.id!;
        }) || []
      })

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: incident.title || "",
        [NotificationRuleConditionCheckOn.IncidentDescription]: incident.description || "",
        [NotificationRuleConditionCheckOn.IncidentSeverity]: incident.incidentSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentState]: incident.currentIncidentState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: incident.labels?.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: monitorLabels.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
        [NotificationRuleConditionCheckOn.Monitors]: incident.monitors?.map((monitor) => {
          return monitor._id?.toString() || "";
        }) || [],
      }
    }

    if (data.notificationFor.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.notificationFor.alertId,
        select: {
          title: true,
          description: true,
          alertSeverity: true,
          currentAlertState: true,
          labels: true,
          monitor: true,
        },
        props: {
          isRoot: true,
        }
      });

      if (!alert) {
        throw new BadDataException("Alert ID not found");
      }


      const monitorLabels: Array<Label> = await MonitorService.getLabelsForMonitors({
        monitorIds: alert.monitor?.id! ? [alert.monitor?.id!] : []
      })

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: alert.title || "",
        [NotificationRuleConditionCheckOn.AlertDescription]: alert.description || "",
        [NotificationRuleConditionCheckOn.AlertSeverity]: alert.alertSeverity?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertState]: alert.currentAlertState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: alert.labels?.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.MonitorLabels]: monitorLabels.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          alert.monitor?.id!.toString() || ""
        ],
      }
    }


    if (data.notificationFor.scheduledMaintenanceId) {
      const scheduledMaintenance: ScheduledMaintenance | null = await ScheduledMaintenanceService.findOneById({
        id: data.notificationFor.scheduledMaintenanceId,
        select: {
          title: true,
          description: true,
          currentScheduledMaintenanceState: true,
          labels: true,
          monitors: true,
        },
        props: {
          isRoot: true,
        }
      });


      if (!scheduledMaintenance) {
        throw new BadDataException("Scheduled Maintenance ID not found");
      }

      const monitorLabels: Array<Label> = await MonitorService.getLabelsForMonitors({
        monitorIds: scheduledMaintenance.monitors?.map((monitor) => {
          return monitor.id!;
        }) || []
      })

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: undefined,
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: undefined,
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: scheduledMaintenance.title || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]: scheduledMaintenance.description || "",
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: scheduledMaintenance.currentScheduledMaintenanceState?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: monitorLabels.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: scheduledMaintenance.labels?.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.Monitors]: scheduledMaintenance.monitors?.map((monitor) => {
          return monitor._id?.toString() || "";
        }) || [],
      }
    }


    if (data.notificationFor.monitorStatusTimelineId) {
      const monitorStatusTimeline: MonitorStatusTimeline | null = await MonitorStatusTimelineService.findOneById({
        id: data.notificationFor.monitorStatusTimelineId,
        select: {
          monitor: {
            name: true,
            labels: true,
            monitorType: true,
          },
          monitorStatus: true,
        },
        props: {
          isRoot: true,
        }
      });


      if (!monitorStatusTimeline) {
        throw new BadDataException("Monitor Status Timeline ID not found");
      }

      const monitorLabels: Array<Label> = monitorStatusTimeline.monitor?.labels || [];

      return {
        [NotificationRuleConditionCheckOn.MonitorName]: monitorStatusTimeline.monitor?.name || "",
        [NotificationRuleConditionCheckOn.IncidentTitle]: undefined,
        [NotificationRuleConditionCheckOn.IncidentDescription]: undefined,
        [NotificationRuleConditionCheckOn.IncidentSeverity]: undefined,
        [NotificationRuleConditionCheckOn.IncidentState]: undefined,
        [NotificationRuleConditionCheckOn.MonitorType]: monitorStatusTimeline.monitor?.monitorType || undefined,
        [NotificationRuleConditionCheckOn.MonitorStatus]: monitorStatusTimeline.monitorStatus?._id?.toString() || "",
        [NotificationRuleConditionCheckOn.AlertTitle]: undefined,
        [NotificationRuleConditionCheckOn.AlertDescription]: undefined,
        [NotificationRuleConditionCheckOn.AlertSeverity]: undefined,
        [NotificationRuleConditionCheckOn.AlertState]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription]: undefined,
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceState]: undefined,
        [NotificationRuleConditionCheckOn.IncidentLabels]: undefined,
        [NotificationRuleConditionCheckOn.AlertLabels]: undefined,
        [NotificationRuleConditionCheckOn.MonitorLabels]: monitorLabels.map((label) => {
          return label._id?.toString() || "";
        }) || [],
        [NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels]: undefined,
        [NotificationRuleConditionCheckOn.Monitors]: [
          monitorStatusTimeline.monitor?._id?.toString() || ""
        ],
      }
    }

    throw new BadDataException("NotificationFor is not supported");
  }


  private async getMatchingNotificationRules(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    notificationRuleEventType: NotificationRuleEventType;
    notificationFor: NotificationFor;
  }): Promise<Array<Model>> {

    const notificationRules: Array<Model> = await this.getNotificationRules({
      projectId: data.projectId,
      workspaceType: data.workspaceType,
      notificationRuleEventType: data.notificationRuleEventType,
    });


    const values: {
      [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
    } = await this.getValuesBasedOnNotificationFor({
      notificationFor: data.notificationFor,
    });


    const matchingNotificationRules: Array<Model> = [];

    for (const notificationRule of notificationRules) {
      if(WorkspaceNotificationRuleUtil.isRuleMatching({
        notificationRule: notificationRule.notificationRule as SlackNotificationRule,
        values: values,
      })) {
        matchingNotificationRules.push(notificationRule);
      }
    }

    return matchingNotificationRules;
  }



}
export default new Service();
