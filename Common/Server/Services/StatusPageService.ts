import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import MonitorStatusService from "./MonitorStatusService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageOwnerTeamService from "./StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "./StatusPageOwnerUserService";
import TeamMemberService from "./TeamMemberService";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green } from "../../Types/BrandColors";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Typeof from "../../Types/Typeof";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import StatusPageOwnerTeam from "../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "../../Models/DatabaseModels/StatusPageOwnerUser";
import User from "../../Models/DatabaseModels/User";
import {
  AllowedStatusPageCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Recurring from "../../Types/Events/Recurring";
import Email from "../../Types/Email";
import StatusPageSubscriberService from "./StatusPageSubscriberService";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import MailService from "./MailService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { StatusPageApiRoute } from "../../ServiceRoute";
import ProjectSMTPConfigService from "./ProjectSmtpConfigService";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageResourceService from "./StatusPageResourceService";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import IncidentService from "./IncidentService";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import UptimeUtil from "../../Utils/Uptime/UptimeUtil";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import IP from "../../Types/IP/IP";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../Types/Exception/MasterPasswordRequiredException";
import {
  MASTER_PASSWORD_COOKIE_IDENTIFIER,
  MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../Types/StatusPage/MasterPassword";

export interface StatusPageReportItem {
  resourceName: string;
  totalIncidentCount: number;
  uptimePercent: number;
  uptimePercentAsString: string;
  downtimeInHoursAndMinutes: string;
}

export interface StatusPageReport {
  reportDates: string; // start date and end date in string. e.g. "01 July 2021 - 14 July 2021"
  totalResources: number;
  totalIncidents: number;
  averageUptimePercent: string;
  totalDowntimeInHoursAndMinutes: string;
  resources: Array<StatusPageReportItem>;
}

export class Service extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }

  public static getDefaultEmailFooterText(): string {
    return "This is an automated email sent to you because you are subscribed to this Status Page.";
  }

  public static getSubscriberEmailFooterText(statusPage: StatusPage): string {
    if (
      statusPage.enableCustomSubscriberEmailNotificationFooterText &&
      statusPage.subscriberEmailNotificationFooterText
    ) {
      return statusPage.subscriberEmailNotificationFooterText;
    }
    return this.getDefaultEmailFooterText();
  }

  @CaptureSpan()
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

    /*
     * For new status pages, set enableCustomSubscriberEmailNotificationFooterText to false by default
     * and provide a default custom footer text only if not provided
     */
    if (
      createBy.data.enableCustomSubscriberEmailNotificationFooterText ===
      undefined
    ) {
      createBy.data.enableCustomSubscriberEmailNotificationFooterText = false;
    }

    if (!createBy.data.subscriberEmailNotificationFooterText) {
      createBy.data.subscriberEmailNotificationFooterText =
        "This is an automated email sent to you because you are subscribed to " +
        (createBy.data?.pageTitle || createBy.data?.name || "Status Page");
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<StatusPage>,
    createdItem: StatusPage,
  ): Promise<StatusPage> {
    // Execute owner assignment asynchronously
    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      // Run owner assignment in background without blocking
      this.addOwners(
        createdItem.projectId!,
        createdItem.id!,
        (onCreate.createBy.miscDataProps!["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps!["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      ).catch((error: Error) => {
        logger.error(`Error in StatusPageService owner assignment: ${error}`);
      });
    }

    return createdItem;
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
  public async getStatusPageLinkInDashboard(
    projectId: ObjectID,
    statusPageId: ObjectID,
  ): Promise<URL> {
    if (!projectId) {
      throw new BadDataException(
        "projectId is required to build status page dashboard link",
      );
    }

    if (!statusPageId) {
      throw new BadDataException(
        "statusPageId is required to build status page dashboard link",
      );
    }

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    // Defensive: ensure objects have toString
    const projectIdStr: string = projectId.toString();
    const statusPageIdStr: string = statusPageId.toString();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectIdStr}/status-pages/${statusPageIdStr}`,
    );
  }

  @CaptureSpan()
  public async hasReadAccess(data: {
    statusPageId: ObjectID;
    req: ExpressRequest;
  }): Promise<{
    hasReadAccess: boolean;
    error?: NotAuthenticatedException | ForbiddenException;
  }> {
    const statusPageId: ObjectID = data.statusPageId;
    const req: ExpressRequest = data.req;

    try {
      // get status page by id.
      const statusPage: StatusPage | null = await this.findOneById({
        id: statusPageId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isPublicStatusPage: true,
          ipWhitelist: true,
          enableMasterPassword: true,
          masterPassword: true,
        },
      });

      if (statusPage?.ipWhitelist && statusPage.ipWhitelist.length > 0) {
        const ipWhitelist: Array<string> = statusPage.ipWhitelist?.split("\n");

        const ipAccessedFrom: string | undefined =
          req.headers["x-forwarded-for"]?.toString() ||
          req.headers["x-real-ip"]?.toString() ||
          req.socket.remoteAddress ||
          req.ip ||
          req.ips[0];

        if (!ipAccessedFrom) {
          logger.error("IP address not found in request.");
          return {
            hasReadAccess: false,
            error: new ForbiddenException(
              "Unable to verify IP address for status page access.",
            ),
          };
        }

        const isIPWhitelisted: boolean = IP.isInWhitelist({
          ips:
            ipAccessedFrom?.split(",").map((i: string) => {
              return i.trim();
            }) || [],
          whitelist: ipWhitelist,
        });

        if (!isIPWhitelisted) {
          logger.error(
            `IP address ${ipAccessedFrom} is not whitelisted for status page ${statusPageId.toString()}.`,
          );

          return {
            hasReadAccess: false,
            error: new ForbiddenException(
              `Your IP address ${ipAccessedFrom} is blocked from accessing this status page.`,
            ),
          };
        }
      }

      if (statusPage && statusPage.isPublicStatusPage) {
        return {
          hasReadAccess: true,
        };
      }

      // token decode.
      const token: string | undefined = CookieUtil.getCookieFromExpressRequest(
        req,
        CookieUtil.getUserTokenKey(statusPageId),
      );

      if (token) {
        try {
          const decoded: JSONWebTokenData = JSONWebToken.decode(
            token as string,
          );

          if (decoded.statusPageId?.toString() === statusPageId.toString()) {
            return {
              hasReadAccess: true,
            };
          }
        } catch (err) {
          logger.error(err);
        }
      }

      const shouldEnforceMasterPassword: boolean = Boolean(
        statusPage &&
          statusPage.enableMasterPassword &&
          statusPage.masterPassword &&
          !statusPage.isPublicStatusPage,
      );

      if (shouldEnforceMasterPassword) {
        const hasValidMasterPassword: boolean =
          this.hasValidMasterPasswordCookie({
            req,
            statusPageId,
          });

        if (hasValidMasterPassword) {
          return {
            hasReadAccess: true,
          };
        }

        return {
          hasReadAccess: false,
          error: new MasterPasswordRequiredException(
            MASTER_PASSWORD_REQUIRED_MESSAGE,
          ),
        };
      }
    } catch (err) {
      logger.error(err);
    }

    return {
      hasReadAccess: false,
      error: new NotAuthenticatedException(
        "You do not have access to this status page. Please login to view the status page.",
      ),
    };
  }

  private hasValidMasterPasswordCookie(data: {
    req: ExpressRequest;
    statusPageId: ObjectID;
  }): boolean {
    const token: string | undefined = CookieUtil.getCookieFromExpressRequest(
      data.req,
      CookieUtil.getStatusPageMasterPasswordKey(data.statusPageId),
    );

    if (!token) {
      return false;
    }

    try {
      const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

      return (
        payload["statusPageId"] === data.statusPageId.toString() &&
        payload["type"] === MASTER_PASSWORD_COOKIE_IDENTIFIER
      );
    } catch (err) {
      logger.error(err);
    }

    return false;
  }

  @CaptureSpan()
  public async getMonitorStatusTimelineForStatusPage(data: {
    monitorIds: Array<ObjectID>;
    startDate: Date;
    endDate: Date;
  }): Promise<Array<MonitorStatusTimeline>> {
    const startDate: Date = data.startDate;
    const endDate: Date = data.endDate;

    let monitorStatusTimelines: Array<MonitorStatusTimeline> = [];

    if (data.monitorIds.length > 0) {
      monitorStatusTimelines = await MonitorStatusTimelineService.findBy({
        query: {
          monitorId: QueryHelper.any(data.monitorIds),
          endsAt: QueryHelper.inBetween(startDate, endDate),
        },
        select: {
          monitorId: true,
          createdAt: true,
          endsAt: true,
          startsAt: true,
          monitorStatus: {
            name: true,
            color: true,
            priority: true,
          } as any,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: LIMIT_MAX, // This can be optimized.
        props: {
          isRoot: true,
        },
      });

      monitorStatusTimelines = monitorStatusTimelines.concat(
        await MonitorStatusTimelineService.findBy({
          query: {
            monitorId: QueryHelper.any(data.monitorIds),
            endsAt: QueryHelper.isNull(),
          },
          select: {
            monitorId: true,
            createdAt: true,
            endsAt: true,
            startsAt: true,
            monitorStatus: {
              name: true,
              color: true,
              priority: true,
            } as any,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          skip: 0,
          limit: LIMIT_MAX, // This can be optimized.
          props: {
            isRoot: true,
          },
        }),
      );

      // sort monitorStatusTimelines by createdAt.
      monitorStatusTimelines = monitorStatusTimelines.sort(
        (a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
          if (!a.createdAt || !b.createdAt) {
            return 0;
          }

          return b.createdAt!.getTime() - a.createdAt!.getTime();
        },
      );
    }

    return monitorStatusTimelines;
  }

  @CaptureSpan()
  public async getStatusPageURL(statusPageId: ObjectID): Promise<string> {
    const domain: StatusPageDomain | null =
      await StatusPageDomainService.findOneBy({
        query: {
          statusPageId: statusPageId,
          isSslProvisioned: true,
        },
        select: {
          fullDomain: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    let statusPageURL: string = domain?.fullDomain
      ? `https://${domain.fullDomain}`
      : "";

    if (!statusPageURL) {
      const host: Hostname = await DatabaseConfig.getHost();

      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
      statusPageURL = new URL(httpProtocol, host)
        .addRoute("/status-page/" + statusPageId.toString())
        .toString();
    }

    return statusPageURL;
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

    if (
      updateBy.data.reportStartDateTime ||
      updateBy.data.reportRecurringInterval ||
      updateBy.data.sendNextReportBy
    ) {
      const statusPages: Array<StatusPage> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          reportStartDateTime: true,
          reportRecurringInterval: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      for (const statusPage of statusPages) {
        const rerportStartDate: Date | undefined =
          (updateBy.data.reportStartDateTime as Date) ||
          statusPage.reportStartDateTime;
        const reportRecurringInterval: Recurring | undefined =
          Recurring.fromJSON(
            (updateBy.data.reportRecurringInterval as Recurring) ||
              statusPage.reportRecurringInterval,
          );

        if (rerportStartDate && reportRecurringInterval) {
          const nextReportDate: Date = Recurring.getNextDate(
            rerportStartDate,
            reportRecurringInterval,
          );
          updateBy.data.sendNextReportBy = nextReportDate;
        }
      }
    }

    return {
      carryForward: null,
      updateBy: updateBy,
    };
  }

  @CaptureSpan()
  public async sendEmailReport(data: {
    statusPageId: ObjectID;
    email?: Email | undefined;
  }): Promise<void> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const statusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        data.statusPageId,
      ]);

    if (statusPages.length === 0) {
      throw new BadDataException("Status page not found");
    }

    const statuspage: StatusPage = statusPages[0]!;

    if (!statuspage.id) {
      throw new BadDataException("Status page not found");
    }

    const statusPageURL: string = await this.getStatusPageURL(statuspage.id);
    const statusPageName: string =
      statuspage.pageTitle || statuspage.name || "Status Page";

    const statusPageIdString: string | null =
      statuspage.id?.toString() || statuspage._id?.toString() || null;

    const report: StatusPageReport = await this.getReportByStatusPage({
      statusPageId: statuspage.id!,
      historyDays: statuspage.reportDataInDays || 14,
    });

    type SendEmailFunction = (
      email: Email,
      unsubscribeUrl: URL | null,
    ) => Promise<void>;

    const sendEmail: SendEmailFunction = async (
      email: Email,
      unsubscribeUrl: URL | null,
    ): Promise<void> => {
      // send email here.

      MailService.sendMail(
        {
          toEmail: email,
          templateType: EmailTemplateType.StatusPageSubscriberReport,
          vars: {
            statusPageName: statusPageName,
            subscriberEmailNotificationFooterText:
              Service.getSubscriberEmailFooterText(statuspage),
            statusPageUrl: statusPageURL,
            detailsUrl: statusPageURL,
            hasResources: report.totalResources > 0 ? "true" : "false",
            report: report as any,
            logoUrl:
              statuspage.logoFileId && statusPageIdString
                ? new URL(httpProtocol, host)
                    .addRoute(StatusPageApiRoute)
                    .addRoute(`/logo/${statusPageIdString}`)
                    .toString()
                : "",
            isPublicStatusPage: statuspage.isPublicStatusPage
              ? "true"
              : "false",

            unsubscribeUrl: unsubscribeUrl?.toString() || "",
          },
          subject: "[Report] " + statusPageName,
        },
        {
          mailServer: ProjectSMTPConfigService.toEmailServer(
            statuspage.smtpConfig,
          ),
          projectId: statuspage.projectId,
          statusPageId: statuspage.id!,
        },
      ).catch((err: Error) => {
        logger.error(err);
      });
    };

    if (data.email) {
      // force send to this email instead of sending to all subscribers.
      await sendEmail(data.email, null);
      return; // don't notify subscribers when explicitly sending a test email.
    }

    const subscribers: Array<StatusPageSubscriber> =
      await StatusPageSubscriberService.getSubscribersByStatusPage(
        statuspage.id!,
        {
          isRoot: true,
          ignoreHooks: true,
        },
      );

    for (const subscriber of subscribers) {
      try {
        if (!subscriber._id) {
          continue;
        }

        const shouldNotifySubscriber: boolean = !subscriber.isUnsubscribed;

        if (!shouldNotifySubscriber) {
          continue;
        }

        const unsubscribeUrl: string =
          StatusPageSubscriberService.getUnsubscribeLink(
            URL.fromString(statusPageURL),
            subscriber.id!,
          ).toString();

        if (subscriber.subscriberEmail) {
          await sendEmail(
            subscriber.subscriberEmail,
            URL.fromString(unsubscribeUrl),
          );
        }

        if (subscriber.subscriberPhone) {
          continue; // Cant send Status Page reports to SMS subscribers.
        }
      } catch (err) {
        logger.error(err);
      }
    }
  }

  @CaptureSpan()
  public async getReportByStatusPage(data: {
    statusPageId: ObjectID;
    historyDays: number;
  }): Promise<StatusPageReport> {
    const statusPage: StatusPage | null = await this.findOneById({
      id: data.statusPageId,
      props: {
        isRoot: true,
      },
      select: {
        downtimeMonitorStatuses: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status page not found");
    }

    const statusPageResources: StatusPageResource[] =
      await this.getStatusPageResources({
        statusPageId: data.statusPageId,
      });

    const numberOfDays: number = data.historyDays || 14;

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(numberOfDays);
    const startAndEndDate: string = `${numberOfDays} days (${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(startDate, true)} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(endDate, true)})`;

    if (statusPageResources.length === 0) {
      return {
        reportDates: startAndEndDate,
        totalResources: 0,
        totalIncidents: 0,
        averageUptimePercent: "0%",
        totalDowntimeInHoursAndMinutes: "0",
        resources: [],
      };
    }

    const incidentCount: number = await this.getIncidentCountOnStatusPage({
      statusPageId: data.statusPageId,
      historyDays: data.historyDays,
    });

    const monitors: {
      monitorsOnStatusPage: Array<ObjectID>;
      monitorsInGroup: Dictionary<Array<ObjectID>>;
    } = await this.getMonitorIdsOnStatusPage({
      statusPageId: data.statusPageId,
    });

    const timeline: Array<MonitorStatusTimeline> =
      await this.getMonitorStatusTimelineForStatusPage({
        monitorIds: monitors.monitorsOnStatusPage,
        startDate: startDate,
        endDate: endDate,
      });

    const reportItems: Array<StatusPageReportItem> = [];

    for (const resource of statusPageResources) {
      // for each of these resource, calculate uptime percent.

      let monitorIdsForThisResource: Array<ObjectID> = [];

      if (resource.monitorId) {
        monitorIdsForThisResource.push(resource.monitorId);
      }

      if (resource.monitorGroupId) {
        const groupId: string = resource.monitorGroupId.toString();
        monitorIdsForThisResource = monitorIdsForThisResource.concat(
          monitors.monitorsInGroup[groupId] || [],
        );
      }

      const timelineForThisResource: Array<MonitorStatusTimeline> =
        timeline.filter((item: MonitorStatusTimeline) => {
          return monitorIdsForThisResource.find((id: ObjectID) => {
            return id.toString() === item.monitorId?.toString();
          });
        });

      const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
        timelineForThisResource,
        resource.uptimePercentPrecision || UptimePrecision.TWO_DECIMAL,
        statusPage.downtimeMonitorStatuses!,
      );
      const downtime: {
        totalDowntimeInSeconds: number;
        totalSecondsInTimePeriod: number;
      } = UptimeUtil.getTotalDowntimeInSeconds(
        timelineForThisResource,
        statusPage.downtimeMonitorStatuses!,
      );

      const reportItem: StatusPageReportItem = {
        resourceName: resource.displayName || "",
        totalIncidentCount: await this.getIncidentCountByMonitorIds({
          monitorIds: monitorIdsForThisResource,
          historyDays: data.historyDays,
        }),
        uptimePercent: uptimePercent,
        uptimePercentAsString: `${uptimePercent}%`,
        downtimeInHoursAndMinutes:
          OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
            Math.ceil(downtime.totalDowntimeInSeconds / 60),
          ),
      };

      reportItems.push(reportItem);
    }

    const avgUptimePercent: number =
      reportItems.reduce((acc: number, item: StatusPageReportItem) => {
        return acc + item.uptimePercent;
      }, 0) / reportItems.length;

    const avgUptimePercentString: string = avgUptimePercent.toFixed(2) + "%";

    const totalDowntimeInSeconds: {
      totalDowntimeInSeconds: number;
      totalSecondsInTimePeriod: number;
    } = UptimeUtil.getTotalDowntimeInSeconds(
      timeline,
      statusPage.downtimeMonitorStatuses!,
    );

    return {
      reportDates: startAndEndDate,
      totalResources: statusPageResources.length,
      totalIncidents: incidentCount,
      averageUptimePercent: avgUptimePercentString,
      resources: reportItems,
      totalDowntimeInHoursAndMinutes:
        OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
          Math.ceil(totalDowntimeInSeconds.totalDowntimeInSeconds / 60),
        ),
    };
  }

  @CaptureSpan()
  public async getIncidentCountByMonitorIds(data: {
    monitorIds: Array<ObjectID>;
    historyDays: number;
  }): Promise<number> {
    const today: Date = OneUptimeDate.getCurrentDate();

    const historyDays: Date = OneUptimeDate.getSomeDaysAgo(
      data.historyDays || 14,
    );

    const incidentCount: PositiveNumber = await IncidentService.countBy({
      query: {
        monitors: data.monitorIds as any,
        createdAt: QueryHelper.inBetween(historyDays, today),
      },
      props: {
        isRoot: true,
      },
    });

    return incidentCount.toNumber();
  }

  @CaptureSpan()
  public async getIncidentCountOnStatusPage(data: {
    statusPageId: ObjectID;
    historyDays: number;
  }): Promise<number> {
    const monitorsOnStatusPage: {
      monitorsOnStatusPage: Array<ObjectID>;
      monitorsInGroup: Dictionary<Array<ObjectID>>;
    } = await this.getMonitorIdsOnStatusPage({
      statusPageId: data.statusPageId,
    });

    return this.getIncidentCountByMonitorIds({
      monitorIds: monitorsOnStatusPage.monitorsOnStatusPage,
      historyDays: data.historyDays,
    });
  }

  @CaptureSpan()
  public async getMonitorIdsOnStatusPage(data: {
    statusPageId: ObjectID;
  }): Promise<{
    monitorsOnStatusPage: Array<ObjectID>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }> {
    const statusPageResources: Array<StatusPageResource> =
      await this.getStatusPageResources(data);

    const monitorGroupIds: Array<ObjectID> = statusPageResources
      .map((resource: StatusPageResource) => {
        return resource.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    const monitorsInGroup: Dictionary<Array<ObjectID>> = {};

    // get monitor status charts.
    const monitorsOnStatusPage: Array<ObjectID> = statusPageResources
      .map((monitor: StatusPageResource) => {
        return monitor.monitorId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    for (const monitorGroupId of monitorGroupIds) {
      // get current status of monitors in the group.

      // get monitors in the group.

      const groupResources: Array<MonitorGroupResource> =
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroupId,
          },
          select: {
            monitorId: true,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const monitorsInGroupIds: Array<ObjectID> = groupResources
        .map((resource: MonitorGroupResource) => {
          return resource.monitorId!;
        })
        .filter((id: ObjectID) => {
          return Boolean(id); // remove nulls
        });

      for (const monitorId of monitorsInGroupIds) {
        if (
          !monitorsOnStatusPage.find((item: ObjectID) => {
            return item.toString() === monitorId.toString();
          })
        ) {
          monitorsOnStatusPage.push(monitorId);
        }
      }

      monitorsInGroup[monitorGroupId.toString()] = monitorsInGroupIds;
    }

    return {
      monitorsOnStatusPage: monitorsOnStatusPage,
      monitorsInGroup: monitorsInGroup,
    };
  }

  @CaptureSpan()
  public async getStatusPageResources(data: {
    statusPageId: ObjectID;
  }): Promise<Array<StatusPageResource>> {
    // get monitors on status page.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          statusPageId: data.statusPageId,
        },
        select: {
          statusPageGroupId: true,
          statusPageGroup: {
            name: true,
          },
          monitorId: true,
          displayTooltip: true,
          displayDescription: true,
          displayName: true,
          monitor: {
            _id: true,
            currentMonitorStatusId: true,
          },
          monitorGroupId: true,
          order: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    // sort by order and then return

    return statusPageResources.sort(
      (a: StatusPageResource, b: StatusPageResource) => {
        return a.order! - b.order!;
      },
    );
  }

  @CaptureSpan()
  public async getMonitorGroupCurrentStatuses(data: {
    statusPageResources: Array<StatusPageResource>;
    monitorStatuses: Array<MonitorStatus>;
  }): Promise<Dictionary<ObjectID>> {
    const monitorGroupCurrentStatuses: Dictionary<ObjectID> = {};

    for (const resource of data.statusPageResources) {
      if (resource.monitorGroupId) {
        const monitorGroupResources: Array<MonitorGroupResource> =
          await MonitorGroupResourceService.findBy({
            query: {
              monitorGroupId: resource.monitorGroupId,
            },
            select: {
              monitorId: true,
              monitor: {
                currentMonitorStatusId: true,
              },
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: {
              isRoot: true,
            },
          });

        const statuses: Array<ObjectID> = monitorGroupResources
          .filter((item: MonitorGroupResource) => {
            return (
              item.monitor &&
              item.monitor.currentMonitorStatusId &&
              item.monitorId
            );
          })
          .map((item: MonitorGroupResource) => {
            return item.monitor!.currentMonitorStatusId!;
          });

        let worstStatus: MonitorStatus | null = null;

        for (const statusId of statuses) {
          const status: MonitorStatus | undefined = data.monitorStatuses.find(
            (status: MonitorStatus) => {
              return status._id?.toString() === statusId.toString();
            },
          );

          if (
            status &&
            (!worstStatus || status.priority! < worstStatus.priority!)
          ) {
            worstStatus = status;
          }
        }

        if (worstStatus && worstStatus._id) {
          monitorGroupCurrentStatuses[resource.monitorGroupId.toString()] =
            new ObjectID(worstStatus._id);
        }
      }
    }

    return monitorGroupCurrentStatuses;
  }

  @CaptureSpan()
  public getOverallMonitorStatus(data: {
    statusPageResources: Array<StatusPageResource>;
    monitorStatuses: Array<MonitorStatus>;
    monitorGroupCurrentStatuses: Dictionary<ObjectID>;
  }): MonitorStatus | null {
    let currentStatus: MonitorStatus | null =
      data.monitorStatuses.length > 0 && data.monitorStatuses[0]
        ? data.monitorStatuses[0]
        : null;

    const dict: Dictionary<number> = {};

    for (const resource of data.statusPageResources) {
      if (resource.monitor?.currentMonitorStatusId) {
        if (
          !Object.keys(dict).includes(
            resource.monitor?.currentMonitorStatusId.toString() || "",
          )
        ) {
          dict[resource.monitor?.currentMonitorStatusId?.toString()] = 1;
        } else {
          dict[resource.monitor!.currentMonitorStatusId!.toString()]!++;
        }
      }
    }

    // check status of monitor groups.

    for (const groupId in data.monitorGroupCurrentStatuses) {
      const statusId: ObjectID | undefined =
        data.monitorGroupCurrentStatuses[groupId];

      if (statusId) {
        if (!Object.keys(dict).includes(statusId.toString() || "")) {
          dict[statusId.toString()] = 1;
        } else {
          dict[statusId.toString()]!++;
        }
      }
    }

    for (const monitorStatus of data.monitorStatuses) {
      if (monitorStatus._id && dict[monitorStatus._id]) {
        currentStatus = monitorStatus;
      }
    }

    return currentStatus;
  }
}
export default new Service();
