import User from "Model/Models/User";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "Common/Types/ObjectID";
import Version from "Common/Types/Version";
import Model, { ProbeConnectionStatus } from "Model/Models/Probe";
import ProbeOwnerUser from "Model/Models/ProbeOwnerUser";
import ProbeOwnerUserService from "./ProbeOwnerUserService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProbeOwnerTeam from "Model/Models/ProbeOwnerTeam";
import ProbeOwnerTeamService from "./ProbeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import BadDataException from "Common/Types/Exception/BadDataException";
import ProjectService from "./ProjectService";
import Dictionary from "Common/Types/Dictionary";
import OneUptimeDate from "Common/Types/Date";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import logger from "../Utils/Logger";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import DatabaseConfig from "../DatabaseConfig";
import URL from "Common/Types/API/URL";
import UpdateBy from "../Types/Database/UpdateBy";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    if (!createBy.data.probeVersion) {
      createBy.data.probeVersion = new Version("1.0.0");
    }

    return { createBy: createBy, carryForward: [] };
  }

  public async getOwners(probeId: ObjectID): Promise<Array<User>> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    const ownerUsers: Array<ProbeOwnerUser> =
      await ProbeOwnerUserService.findBy({
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<ProbeOwnerTeam> =
      await ProbeOwnerTeamService.findBy({
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: ProbeOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ProbeOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: any = {
      probesToNotifyOwners: [],
    };

    if (updateBy.data.connectionStatus && updateBy.query._id) {

      debugger;

      const probes: Array<Model> = await this.findBy({
        query: updateBy.query,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          connectionStatus: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
      });

      const probesToNotifyOwners: Array<Model> = probes.filter(
        (probe: Model) => {
          return (
            probe.connectionStatus &&
            probe.connectionStatus !== updateBy.data.connectionStatus
          );
        },
      );

      carryForward.probesToNotifyOwners = probesToNotifyOwners;
    }

    return { updateBy: updateBy, carryForward };
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.carryForward && onUpdate.carryForward.probesToNotifyOwners.length > 0) {
      for (const probe of onUpdate.carryForward.probesToNotifyOwners) {
        await this.notifyOwnersOnStatusChange({
          probeId: probe.id!,
          connectionStatus: probe.connectionStatus!,
        });
      }
    }

    return Promise.resolve(onUpdate);
  }

  public async notifyOwnersOnStatusChange(data: {
    probeId: ObjectID;
    connectionStatus: ProbeConnectionStatus;
  }): Promise<void> {

    debugger;

    const probe: Model | null = await this.findOneById({
      id: data.probeId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        lastAlive: true,
        connectionStatus: true,
        name: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
      },
    });

    if (!probe || !probe.id) {
      throw new BadDataException("Probe not found");
    }

    if (!probe.projectId) {
      return; // might be global probe. Do not notify.
    }

    // notify the probe owner
    let owners: Array<User> = await this.getOwners(probe.id!);

    let doesResourceHasOwners: boolean = true;

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(probe.projectId!);
    }

    if (owners.length === 0) {
      return; // no owners to notify.
    }

    const connectionStatus: string =
      data.connectionStatus === ProbeConnectionStatus.Connected
        ? "Connected"
        : "Disconnected";

    for (const user of owners) {
      try {
        const vars: Dictionary<string> = {
          probeName: probe.name || "Probe",
          probeDescription: probe.description || "No description provided",
          projectName: probe.project?.name || "Project",
          probeStatus: connectionStatus || "Unknown",
          lastAlive: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: probe.lastAlive || OneUptimeDate.getCurrentDate(),
            timezones: user.timezone ? [user.timezone] : [],
          }),
          viewProbesLink: (
            await this.getLinkInDashboard(probe.projectId!, probe.id!)
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProbeConnectionStatusChange,
          vars: vars,
          subject: `[Probe ${connectionStatus}] ${probe.name}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Probe ${probe.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Probe ${probe.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          eventType:
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
        });
      } catch (e) {
        logger.error("Error in sending incident created resource notification");
        logger.error(e);
      }
    }
  }

  public async getLinkInDashboard(
    projectId: ObjectID,
    probeId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/settings/probes/${probeId.toString()}`,
    );
  }
}

export default new Service();
