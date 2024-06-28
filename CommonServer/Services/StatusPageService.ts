import DatabaseConfig from "../DatabaseConfig";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MonitorStatusService from "./MonitorStatusService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageOwnerTeamService from "./StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "./StatusPageOwnerUserService";
import TeamMemberService from "./TeamMemberService";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Typeof from "Common/Types/Typeof";
import MonitorStatus from "Model/Models/MonitorStatus";
import StatusPage from "Model/Models/StatusPage";
import StatusPageDomain from "Model/Models/StatusPageDomain";
import StatusPageOwnerTeam from "Model/Models/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Model/Models/StatusPageOwnerUser";
import User from "Model/Models/User";
import {
  AllowedStatusPageCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";

export class Service extends DatabaseService<StatusPage> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(StatusPage, postgresDatabase);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<StatusPage>,
  ): Promise<OnCreate<StatusPage>> {
    if (!createBy.data.projectId) {
      throw new BadDataException("projectId is required");
    }

    // if the project is on the free plan, then only allow 1 status page.
    if (IsBillingEnabled) {
      const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
        createBy.data.projectId,
      );

      if (currentPlan.isSubscriptionUnpaid) {
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and pay all the outstanding invoices to add more status pages.",
        );
      }

      if (currentPlan.plan === PlanType.Free) {
        const statusPageCount: PositiveNumber = await this.countBy({
          query: {
            projectId: createBy.data.projectId,
          },
          props: {
            isRoot: true,
          },
        });

        if (statusPageCount.toNumber() >= AllowedStatusPageCountInFreePlan) {
          throw new BadDataException(
            `You have reached the maximum allowed status page limit for the free plan. Please upgrade your plan to add more status pages.`,
          );
        }
      }
    }

    if (
      !createBy.data.downtimeMonitorStatuses ||
      createBy.data.downtimeMonitorStatuses.length === 0
    ) {
      const monitorStatuses: Array<MonitorStatus> =
        await MonitorStatusService.findBy({
          query: {
            projectId: createBy.data.projectId,
          },
          select: {
            _id: true,
            isOperationalState: true,
          },
          props: {
            isRoot: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      const getNonOperationStatuses: Array<MonitorStatus> =
        monitorStatuses.filter((monitorStatus: MonitorStatus) => {
          return !monitorStatus.isOperationalState;
        });

      createBy.data.downtimeMonitorStatuses = getNonOperationStatuses;
    }

    if (!createBy.data.defaultBarColor) {
      createBy.data.defaultBarColor = Green;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<StatusPage>,
    createdItem: StatusPage,
  ): Promise<StatusPage> {
    // add owners.

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId!,
        createdItem.id!,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

  public async findOwners(statusPageId: ObjectID): Promise<Array<User>> {
    if (!statusPageId) {
      throw new BadDataException("statusPageId is required");
    }

    const ownerUsers: Array<StatusPageOwnerUser> =
      await StatusPageOwnerUserService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<StatusPageOwnerTeam> =
      await StatusPageOwnerTeamService.findBy({
        query: {
          statusPageId: statusPageId,
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
      ownerUsers.map((ownerUser: StatusPageOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: StatusPageOwnerTeam) => {
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

  public async addOwners(
    projectId: ObjectID,
    statusPageId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: StatusPageOwnerTeam = new StatusPageOwnerTeam();
      teamOwner.statusPageId = statusPageId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await StatusPageOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: StatusPageOwnerUser = new StatusPageOwnerUser();
      teamOwner.statusPageId = statusPageId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await StatusPageOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  public async getStatusPageLinkInDashboard(
    projectId: ObjectID,
    statusPageId: ObjectID,
  ): Promise<URL> {
    const dahboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dahboardUrl.toString()).addRoute(
      `/${projectId.toString()}/status-pages/${statusPageId.toString()}`,
    );
  }

  public async hasReadAccess(
    statusPageId: ObjectID,
    props: DatabaseCommonInteractionProps,
    req: ExpressRequest,
  ): Promise<boolean> {
    try {
      // token decode.
      const token: string | undefined = CookieUtil.getCookie(
        req,
        CookieUtil.getUserTokenKey(statusPageId),
      );

      if (token) {
        try {
          const decoded: JSONWebTokenData = JSONWebToken.decode(
            token as string,
          );

          if (decoded.statusPageId?.toString() === statusPageId.toString()) {
            return true;
          }
        } catch (err) {
          logger.error(err);
        }
      }

      const count: PositiveNumber = await this.countBy({
        query: {
          _id: statusPageId.toString(),
          isPublicStatusPage: true,
        },
        skip: 0,
        limit: 1,
        props: {
          isRoot: true,
        },
      });

      if (count.positiveNumber > 0) {
        return true;
      }

      // if it does not have public access, check if this user has access.

      const items: Array<StatusPage> = await this.findBy({
        query: {
          _id: statusPageId.toString(),
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: 1,
        props: props,
      });

      if (items.length > 0) {
        return true;
      }
    } catch (err) {
      logger.error(err);
    }

    return false;
  }

  public async getStatusPageURL(statusPageId: ObjectID): Promise<string> {
    const domains: Array<StatusPageDomain> =
      await StatusPageDomainService.findBy({
        query: {
          statusPageId: statusPageId,
          isSslProvisioned: true,
        },
        select: {
          fullDomain: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    let statusPageURL: string = domains
      .map((d: StatusPageDomain) => {
        return d.fullDomain;
      })
      .join(", ");

    if (domains.length === 0) {
      const host: Hostname = await DatabaseConfig.getHost();

      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
      statusPageURL = new URL(httpProtocol, host)
        .addRoute("/status-page/" + statusPageId.toString())
        .toString();
    }

    return statusPageURL;
  }

  public async getStatusPageFirstURL(statusPageId: ObjectID): Promise<string> {
    const domains: Array<StatusPageDomain> =
      await StatusPageDomainService.findBy({
        query: {
          statusPageId: statusPageId,
          isSslProvisioned: true,
        },
        select: {
          fullDomain: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    let statusPageURL: string = "";

    if (domains.length === 0) {
      const host: Hostname = await DatabaseConfig.getHost();

      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
      statusPageURL = new URL(httpProtocol, host)
        .addRoute("/status-page/" + statusPageId.toString())
        .toString();
    } else {
      statusPageURL = domains[0]?.fullDomain || "";
    }

    return statusPageURL;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<StatusPage>,
  ): Promise<OnUpdate<StatusPage>> {
    // is enabling SMS subscribers.

    if (updateBy.data.enableSmsSubscribers) {
      const statusPagesToBeUpdated: Array<StatusPage> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      for (const statusPage of statusPagesToBeUpdated) {
        const isSMSEnabled: boolean =
          await ProjectService.isSMSNotificationsEnabled(statusPage.projectId!);

        if (!isSMSEnabled) {
          throw new BadDataException(
            "SMS notifications are not enabled for this project. Please enable SMS notifications in the Project Settings > Notifications Settings.",
          );
        }
      }
    }

    return {
      carryForward: null,
      updateBy: updateBy,
    };
  }
}
export default new Service();
