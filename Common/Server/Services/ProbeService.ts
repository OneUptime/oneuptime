import User from "../../Models/DatabaseModels/User";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import Model, {
  ProbeConnectionStatus,
} from "../../Models/DatabaseModels/Probe";
import ProbeOwnerUser from "../../Models/DatabaseModels/ProbeOwnerUser";
import ProbeOwnerUserService from "./ProbeOwnerUserService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ProbeOwnerTeam from "../../Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerTeamService from "./ProbeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import BadDataException from "../../Types/Exception/BadDataException";
import ProjectService from "./ProjectService";
import Dictionary from "../../Types/Dictionary";
import OneUptimeDate from "../../Types/Date";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import logger from "../Utils/Logger";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import { SMSMessage } from "../../Types/SMS/SMS";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import UpdateBy from "../Types/Database/UpdateBy";
import MonitorService from "./MonitorService";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { IsBillingEnabled } from "../EnvironmentConfig";
import GlobalCache from "../Infrastructure/GlobalCache";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async saveLastAliveInCache(
    probeId: ObjectID,
    lastAlive: Date,
  ): Promise<void> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    try {
      await GlobalCache.setString(
        "probe-last-alive",
        probeId.toString(),
        OneUptimeDate.toString(lastAlive),
      );
    } catch (err) {
      logger.error("Error in saving last alive in cache");
      logger.error(err);
    }
  }

  public async shouldSaveLastAlive(probeId: ObjectID): Promise<boolean> {
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      // before we hit the database, we need to check if the lastAlive was updated in Global Cache.
      const previousLastAliveCheck: string | null = await GlobalCache.getString(
        "probe-last-alive",
        probeId.toString(),
      );

      if (!previousLastAliveCheck) {
        await this.saveLastAliveInCache(probeId, now);
        return true;
      }

      const previousLastAliveCheckDate: Date | null = OneUptimeDate.fromString(
        previousLastAliveCheck,
      );

      // if this date is within 30 seconds of current date, then we will not update the last alive.
      if (previousLastAliveCheckDate) {
        const diff: number = OneUptimeDate.getDifferenceInSeconds(
          now,
          previousLastAliveCheckDate,
        );

        if (diff < 30) {
          return false;
        }
      }

      await this.saveLastAliveInCache(probeId, now);
    } catch (err) {
      // failed to hit the cache, so we will hit the database
      logger.error("Error in getting last alive from cache");
      logger.error(err);
    }

    return true;
  }

  public async updateLastAlive(probeId: ObjectID): Promise<void> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    const shouldSaveLastAlive: boolean =
      await this.shouldSaveLastAlive(probeId);

    if (!shouldSaveLastAlive) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    await this.updateOneById({
      id: probeId,
      data: {
        lastAlive: now,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: any = {
      probesToNotifyOwners: [],
    };

    if (updateBy.data.connectionStatus && updateBy.query._id) {
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

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.carryForward &&
      onUpdate.carryForward.probesToNotifyOwners.length > 0
    ) {
      for (const probe of onUpdate.carryForward.probesToNotifyOwners) {
        await MonitorService.refreshProbeStatus(probe.id!);

        await this.notifyOwnersOnStatusChange({
          probeId: probe.id!,
        });
      }
    }

    return Promise.resolve(onUpdate);
  }

  @CaptureSpan()
  public async notifyOwnersOnStatusChange(data: {
    probeId: ObjectID;
  }): Promise<void> {
    const probe: Model | null = await this.findOneById({
      id: data.probeId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        lastAlive: true,
        connectionStatus: true,
        isGlobalProbe: true,
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

    if (probe.isGlobalProbe && IsBillingEnabled) {
      return; // do not notify for global probes.
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
      probe.connectionStatus === ProbeConnectionStatus.Connected
        ? "Connected"
        : "Disconnected";

    for (const user of owners) {
      try {
        const vars: Dictionary<string> = {
          title: `${probe.name} is ${connectionStatus}`,
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

        const pushMessageParams: {
          probeName: string;
          projectName: string;
          connectionStatus: string;
          clickAction?: string;
        } = {
          probeName: probe.name!,
          projectName: probe.project?.name || "Project",
          connectionStatus: connectionStatus,
        };

        if (vars["viewProbesLink"]) {
          pushMessageParams.clickAction = vars["viewProbesLink"];
        }

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createProbeStatusChangedNotification(
            pushMessageParams,
          );

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION,
        });
      } catch (e) {
        logger.error("Error in sending incident created resource notification");
        logger.error(e);
      }
    }
  }

  @CaptureSpan()
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
