import DatabaseConfig from "../DatabaseConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import MonitorStatusService from "./MonitorStatusService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageLabelRuleEngineService from "./StatusPageLabelRuleEngineService";
import StatusPageOwnerRuleEngineService from "./StatusPageOwnerRuleEngineService";
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
  LetsEncryptAccountKey,
} from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Recurring from "../../Types/Events/Recurring";
import Email from "../../Types/Email";
import StatusPageSubscriberService from "./StatusPageSubscriberService";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import MailService from "./MailService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import StatusPageSubscriberNotificationTemplateService from "./StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplate from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { StatusPageApiRoute } from "../../ServiceRoute";
import ProjectSMTPConfigService from "./ProjectSmtpConfigService";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageResourceService from "./StatusPageResourceService";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorGroupService from "./MonitorGroupService";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import IncidentService from "./IncidentService";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import UptimeUtil, { UptimeWindow } from "../../Utils/Uptime/UptimeUtil";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import IP from "../../Types/IP/IP";
import { resolveClientIp } from "../Utils/ClientIp";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../Types/Exception/MasterPasswordRequiredException";
import {
  MASTER_PASSWORD_COOKIE_IDENTIFIER,
  MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../Types/StatusPage/MasterPassword";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupService from "./StatusPageGroupService";
import StatusPageGroupTreeUtil from "../../Utils/StatusPage/GroupTree";
import StatusPageReportTreeUtil, {
  StatusPageReportResourceEntry,
  StatusPageReportStructure,
} from "../../Utils/StatusPage/Report";
import {
  StatusPageReport,
  StatusPageReportGroup,
  StatusPageReportGroupMetrics,
  StatusPageReportItem,
  StatusPageReportRow,
} from "../../Types/StatusPage/StatusPageReport";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../Utils/StatusPage/ReportPeriod";
import Timezone from "../../Types/Timezone";

export {
  StatusPageReport,
  StatusPageReportGroup,
  StatusPageReportItem,
  StatusPageReportRow,
};

export class Service extends DatabaseService<StatusPage> {
  /*
   * Caches the resolved status page URL per statusPageId. `getStatusPageURL`
   * is called inside per-subscriber notification loops (see
   * `StatusPageSubscriberService`), where a single batch can fire N×
   * Postgres lookups against `StatusPageDomain`. Usable custom domains
   * change rarely (provisioning/verification takes minutes), so a 60s
   * staleness window is acceptable. Callers that need stronger consistency can call
   * `clearStatusPageUrlCache` after writes to the underlying domain.
   */
  private statusPageUrlCache: InMemoryTTLCache<string> = new InMemoryTTLCache(
    10_000,
  );

  /*
   * Caches verified custom-domain -> statusPageId resolution. Every public
   * status-page API call served on a custom domain (overview, incidents,
   * announcements, polling — several per page view) starts with this lookup,
   * and the mapping only changes when a customer provisions or removes a
   * domain (which takes minutes anyway), so a 60s staleness window is the
   * same tradeoff `statusPageUrlCache` above already accepts. Only
   * SUCCESSFUL resolutions are cached: misses re-query, so a freshly
   * verified domain works immediately and attacker-controlled Host headers
   * cannot fill the cache with negative entries.
   */
  private statusPageDomainToIdCache: InMemoryTTLCache<string> =
    new InMemoryTTLCache(10_000);

  private static readonly DOMAIN_TO_ID_CACHE_TTL_MS: number = 60 * 1000;

  public constructor() {
    super(StatusPage);
  }

  public clearStatusPageUrlCache(statusPageId?: ObjectID): void {
    if (statusPageId) {
      this.statusPageUrlCache.delete(statusPageId.toString());
      return;
    }
    this.statusPageUrlCache.clear();
  }

  public clearStatusPageDomainToIdCache(fullDomain?: string): void {
    if (fullDomain) {
      this.statusPageDomainToIdCache.delete(fullDomain);
      return;
    }
    this.statusPageDomainToIdCache.clear();
  }

  /*
   * Mirrors `resolveStatusPageIdOrThrow` in `Common/Server/API/StatusPageAPI.ts`
   * (module-private there), but returns null instead of throwing so callers can
   * collapse "no such page" and "page exists but is gated" into one answer.
   * The dot check — not a UUID check — is the discriminator, so both resolvers
   * agree on dotless hostnames like "localhost".
   */
  @CaptureSpan()
  public async resolveStatusPageIdOrNull(
    statusPageIdOrDomain: string,
  ): Promise<ObjectID | null> {
    if (!statusPageIdOrDomain) {
      return null;
    }

    if (statusPageIdOrDomain.includes(".")) {
      const cachedStatusPageId: string | undefined =
        this.statusPageDomainToIdCache.get(statusPageIdOrDomain);

      if (cachedStatusPageId) {
        return new ObjectID(cachedStatusPageId);
      }

      const statusPageDomain: StatusPageDomain | null =
        await StatusPageDomainService.findOneBy({
          query: {
            fullDomain: statusPageIdOrDomain,
            domain: {
              isVerified: true,
            } as any,
          },
          select: {
            statusPageId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!statusPageDomain || !statusPageDomain.statusPageId) {
        return null;
      }

      this.statusPageDomainToIdCache.set(
        statusPageIdOrDomain,
        statusPageDomain.statusPageId.toString(),
        Service.DOMAIN_TO_ID_CACHE_TTL_MS,
      );

      return statusPageDomain.statusPageId;
    }

    try {
      ObjectID.validateUUID(statusPageIdOrDomain);
      return new ObjectID(statusPageIdOrDomain);
    } catch (err) {
      logger.error(
        `Error converting statusPageIdOrDomain to ObjectID: ${statusPageIdOrDomain}`,
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Folds existence and the `enableMcpServer` flag into a single query so the
   * caller cannot distinguish "not found" from "disabled". The public MCP tools
   * need no API key, so a distinct "disabled" message would be a status page
   * enumeration oracle.
   *
   * Throws on database failure rather than returning false, so the caller
   * reports an error instead of reporting the page as gated.
   */
  @CaptureSpan()
  public async isMcpServerEnabled(
    statusPageIdOrDomain: string,
  ): Promise<boolean> {
    const statusPageId: ObjectID | null =
      await this.resolveStatusPageIdOrNull(statusPageIdOrDomain);

    if (!statusPageId) {
      return false;
    }

    const statusPage: StatusPage | null = await this.findOneBy({
      query: {
        _id: statusPageId,
        enableMcpServer: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(statusPage);
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

    if (!createBy.data.downtimeMonitorStatuses) {
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
    // Activation event for marketing funnels.
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId || createdItem.createdByUserId,
      event: "server/status_page_created",
      properties: {
        project_id: createdItem.projectId?.toString() || "",
      },
    });

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
        logger.error(`Error in StatusPageService owner assignment: ${error}`, {
          projectId: createdItem.projectId?.toString(),
          statusPageId: createdItem.id?.toString(),
        } as LogAttributes);
      });
    }

    /*
     * Apply label rules first so rule-added labels are persisted before owner
     * rules run. Owner rules re-fetch labels from the DB, so this lets owner
     * rules key on rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await StatusPageLabelRuleEngineService.applyRulesToStatusPage(
            createdItem,
          );
        })
        .then(async () => {
          await StatusPageOwnerRuleEngineService.applyRulesToStatusPage(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying status page rules in StatusPageService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              statusPageId: createdItem.id?.toString(),
            } as LogAttributes,
          );
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

        /*
         * One address, resolved from the trusted end of X-Forwarded-For.
         * Never the raw header: a caller can prepend any address they like to
         * it, so checking the chain rather than a single resolved address let
         * anyone who knew an allowlisted address walk straight in.
         */
        const ipAccessedFrom: string | undefined = resolveClientIp(req);

        if (!ipAccessedFrom) {
          logger.error("IP address not found in request.", {
            statusPageId: statusPageId?.toString(),
          } as LogAttributes);
          return {
            hasReadAccess: false,
            error: new ForbiddenException(
              "Unable to verify IP address for status page access.",
            ),
          };
        }

        const isIPWhitelisted: boolean = IP.isInWhitelist({
          ip: ipAccessedFrom,
          whitelist: ipWhitelist,
        });

        if (!isIPWhitelisted) {
          logger.error(
            `IP address ${ipAccessedFrom} is not whitelisted for status page ${statusPageId.toString()}.`,
            { statusPageId: statusPageId?.toString() } as LogAttributes,
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
          logger.error(err, {
            statusPageId: statusPageId?.toString(),
          } as LogAttributes);
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
      logger.error(err, {
        statusPageId: statusPageId?.toString(),
      } as LogAttributes);
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
      logger.error(err, {
        statusPageId: data.statusPageId?.toString(),
      } as LogAttributes);
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
      /*
       * Select every row that actually OVERLAPS [startDate, endDate]:
       * it started on or before the window ends, and it either ended on or after the window
       * started or is still open (endsAt IS NULL).
       *
       * This used to be two queries that were concatenated - one keyed on
       * `endsAt BETWEEN startDate AND endDate`, and one on `endsAt IS NULL` with NO date bound
       * at all. That had two bugs. The unbounded open-row query pulled orphaned rows from
       * months (or years) before the window into the report, and the endsAt-only window
       * excluded any event that spanned the ENTIRE window but closed after it, so a total
       * outage could render as a silent 100% uptime.
       *
       * `greaterThanEqualToOrNull` emits `(endsAt >= :date or endsAt IS NULL)` - the inclusive
       * `>=` is deliberate so a row that ends exactly at `startDate` still counts as overlapping.
       * `greaterThanOrNull` would emit a strict `>` and drop that boundary row, so it is NOT
       * interchangeable here.
       *
       * Supported by the (monitorId, startsAt) and (endsAt) indexes.
       */
      monitorStatusTimelines = await MonitorStatusTimelineService.findBy({
        query: {
          monitorId: QueryHelper.any(data.monitorIds),
          startsAt: QueryHelper.lessThanEqualTo(endDate),
          endsAt: QueryHelper.greaterThanEqualToOrNull(startDate),
        },
        select: {
          monitorId: true,
          createdAt: true,
          endsAt: true,
          startsAt: true,
          /*
           * `_id` is selected explicitly because UptimeUtil reads `monitorStatus.id` (a getter
           * over `_id`) to match events against the downtime statuses. It works today only
           * because SelectUtil.sanitizeSelect force injects `_id: true` into every relation
           * select - state that dependency here rather than rely on it implicitly. Note `_id`
           * is the decorated primary column; `id` itself has no TableColumnMetadata.
           */
          monitorStatus: {
            _id: true,
            name: true,
            color: true,
            priority: true,
          } as any,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        skip: 0,
        limit: LIMIT_MAX, // This can be optimized.
        props: {
          isRoot: true,
        },
      });

      /*
       * Sort by startsAt and NOT by createdAt. createdAt is generated DB side with now(),
       * while startsAt is generated on the worker pod with moment(). Those are different
       * clocks with measured skew, so ordering by createdAt does not reliably reproduce the
       * real chronological order of the timeline.
       */
      monitorStatusTimelines = monitorStatusTimelines.sort(
        (a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
          if (!a.startsAt || !b.startsAt) {
            return 0;
          }

          return b.startsAt!.getTime() - a.startsAt!.getTime();
        },
      );
    }

    return monitorStatusTimelines;
  }

  /*
   * Picks the custom domain to use when linking to this status page from
   * subscriber notifications (email/SMS/Slack/Teams/webhooks) and SSO
   * redirects. A domain is usable when any of these holds, in order of
   * preference:
   * 1. `isSslProvisioned` — OneUptime ordered the certificate and confirmed
   *    the domain serves HTTPS.
   * 2. `isCustomCertificate` + `isCnameVerified` — the user uploaded their
   *    own certificate (the SSL provisioning jobs skip these domains, so
   *    `isSslProvisioned` never becomes true for them) and the CNAME check
   *    confirmed the domain actually routes to this instance. CNAME alone
   *    guards against certs uploaded before DNS is pointed.
   * 3. `isCnameVerified`, but only when this instance has no Let's Encrypt
   *    account key — self-hosted installs that terminate TLS at their own
   *    proxy can never provision SSL, so CNAME verification is the
   *    strongest available signal that the domain routes to this instance.
   *    (With Let's Encrypt configured, a verified-but-unprovisioned domain
   *    is just mid-provisioning and will be picked up by rule 1 shortly.)
   * Without rules 2 and 3, such status pages fall back to the installation
   * URL in every subscriber notification
   * (https://github.com/OneUptime/oneuptime/issues/1951).
   */
  @CaptureSpan()
  public async getUsableCustomDomain(
    statusPageId: ObjectID,
  ): Promise<StatusPageDomain | null> {
    const domains: Array<StatusPageDomain> =
      await StatusPageDomainService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          fullDomain: true,
          isSslProvisioned: true,
          isCustomCertificate: true,
          isCnameVerified: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    const domainsWithFullDomain: Array<StatusPageDomain> = domains.filter(
      (domain: StatusPageDomain) => {
        return Boolean(domain.fullDomain);
      },
    );

    return (
      domainsWithFullDomain.find((domain: StatusPageDomain) => {
        return domain.isSslProvisioned;
      }) ||
      domainsWithFullDomain.find((domain: StatusPageDomain) => {
        return domain.isCustomCertificate && domain.isCnameVerified;
      }) ||
      (!LetsEncryptAccountKey
        ? domainsWithFullDomain.find((domain: StatusPageDomain) => {
            return domain.isCnameVerified;
          })
        : undefined) ||
      null
    );
  }

  /*
   * SSL-provisioned and custom-certificate domains are known to serve
   * HTTPS. A CNAME-verified-only domain (self-hosted instance behind the
   * user's own proxy) follows the instance protocol instead — CNAME
   * verification can succeed over plain HTTP, so an HTTP-only install
   * gets http:// links that actually work.
   */
  private async getProtocolForCustomDomain(
    domain: StatusPageDomain,
  ): Promise<Protocol> {
    if (domain.isSslProvisioned || domain.isCustomCertificate) {
      return Protocol.HTTPS;
    }

    return DatabaseConfig.getHttpProtocol();
  }

  @CaptureSpan()
  public async getStatusPageURL(statusPageId: ObjectID): Promise<string> {
    const cacheKey: string = statusPageId.toString();
    const cached: string | undefined = this.statusPageUrlCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const domain: StatusPageDomain | null =
      await this.getUsableCustomDomain(statusPageId);

    let statusPageURL: string = "";

    if (domain?.fullDomain) {
      const protocol: Protocol = await this.getProtocolForCustomDomain(domain);
      statusPageURL = `${protocol}${domain.fullDomain}`;
    }

    if (!statusPageURL) {
      const host: Hostname = await DatabaseConfig.getHost();

      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
      statusPageURL = new URL(httpProtocol, host)
        .addRoute("/status-page/" + statusPageId.toString())
        .toString();
    }

    this.statusPageUrlCache.set(cacheKey, statusPageURL, 60_000);

    return statusPageURL;
  }

  @CaptureSpan()
  public async getStatusPageFirstURL(statusPageId: ObjectID): Promise<string> {
    const domain: StatusPageDomain | null =
      await this.getUsableCustomDomain(statusPageId);

    if (domain?.fullDomain) {
      const protocol: Protocol = await this.getProtocolForCustomDomain(domain);
      return `${protocol}${domain.fullDomain}`;
    }

    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
    return new URL(httpProtocol, host)
      .addRoute("/status-page/" + statusPageId.toString())
      .toString();
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
      updateBy.data.reportTimezone ||
      updateBy.data.sendNextReportBy
    ) {
      const statusPages: Array<StatusPage> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          reportStartDateTime: true,
          reportRecurringInterval: true,
          reportTimezone: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      for (const statusPage of statusPages) {
        const reportStartDate: Date | undefined =
          (updateBy.data.reportStartDateTime as Date) ||
          statusPage.reportStartDateTime;
        const reportRecurringInterval: Recurring | undefined =
          Recurring.fromJSON(
            (updateBy.data.reportRecurringInterval as Recurring) ||
              statusPage.reportRecurringInterval,
          );

        if (reportStartDate && reportRecurringInterval) {
          /*
           * Calendar-correct rather than Recurring.getNextDate's fixed
           * millisecond approximation, which walks a monthly schedule anchored
           * on the 1st backwards to the 31st, then the 30th, and eventually
           * skips a month. Resolved in the report timezone so "the 1st at
           * 09:00" survives a DST transition.
           */
          updateBy.data.sendNextReportBy = Recurring.getNextDateAfter({
            startDate: reportStartDate,
            recurring: reportRecurringInterval,
            afterDate: OneUptimeDate.getCurrentDate(),
            timezone:
              (updateBy.data.reportTimezone as Timezone) ||
              statusPage.reportTimezone ||
              StatusPageReportPeriodUtil.DEFAULT_TIMEZONE,
          });
        }
      }
    }

    return {
      carryForward: null,
      updateBy: updateBy,
    };
  }

  /*
   * The window the next report off this status page will cover. Static because
   * the settings screen resolves the very same window from the very same
   * columns to show the user what they are about to schedule.
   */
  public static getReportPeriodForStatusPage(
    statusPage: StatusPage,
    sentAt?: Date | undefined,
  ): StatusPageReportPeriod {
    return StatusPageReportPeriodUtil.getReportPeriod({
      periodType: statusPage.reportPeriodType,
      reportRecurringInterval: statusPage.reportRecurringInterval,
      reportDataInDays: statusPage.reportDataInDays,
      timezone: statusPage.reportTimezone,
      sentAt: sentAt,
    });
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
      reportPeriod: Service.getReportPeriodForStatusPage(statuspage),
    });

    /*
     * Look up a custom report email template for this status page (if any).
     * When present (and a custom SMTP is configured, mirroring the gating used
     * for other subscriber notifications), the subscriber receives the custom
     * template instead of the built-in StatusPageSubscriberReport.hbs. The
     * custom body is rendered through Handlebars on the notification side
     * (templateType omitted => MailService compiles the body string with the
     * same `report` vars, helpers and partials), so it supports loops/
     * conditionals such as {{#each report.resources}}.
     */
    const customReportEmailTemplate: StatusPageSubscriberNotificationTemplate | null =
      await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
        {
          statusPageId: statuspage.id!,
          eventType: StatusPageSubscriberNotificationEventType.SubscriberReport,
          notificationMethod: StatusPageSubscriberNotificationMethod.Email,
        },
      );

    type SendEmailFunction = (
      email: Email,
      unsubscribeUrl: URL | null,
    ) => Promise<void>;

    const sendEmail: SendEmailFunction = async (
      email: Email,
      unsubscribeUrl: URL | null,
    ): Promise<void> => {
      // send email here.

      const vars: Dictionary<string | JSONObject> = {
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
        isPublicStatusPage: statuspage.isPublicStatusPage ? "true" : "false",

        unsubscribeUrl: unsubscribeUrl?.toString() || "",
      };

      /*
       * Use the custom template only when a custom SMTP is configured for the
       * status page, matching the gating used by the other subscriber
       * notifications (e.g. Incident). Custom-authored HTML is then sent from
       * the customer's own mail server rather than the shared servers.
       */
      const useCustomTemplate: boolean = Boolean(
        customReportEmailTemplate?.templateBody && statuspage.smtpConfig,
      );

      MailService.sendMail(
        useCustomTemplate
          ? {
              toEmail: email,
              // templateType omitted => body is compiled as a Handlebars string.
              body: customReportEmailTemplate!.templateBody!,
              vars: vars,
              subject: customReportEmailTemplate!.emailSubject
                ? customReportEmailTemplate!.emailSubject
                : "[Report] " + statusPageName,
            }
          : {
              toEmail: email,
              templateType: EmailTemplateType.StatusPageSubscriberReport,
              vars: vars,
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
        logger.error(err, {
          projectId: statuspage.projectId?.toString(),
          statusPageId: statuspage.id?.toString(),
        } as LogAttributes);
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
        logger.error(err, {
          projectId: statuspage.projectId?.toString(),
          statusPageId: statuspage.id?.toString(),
        } as LogAttributes);
      }
    }
  }

  @CaptureSpan()
  public async getReportByStatusPage(data: {
    statusPageId: ObjectID;
    /*
     * The exact window to measure. Resolved by StatusPageReportPeriodUtil from
     * the status page's report settings, so a monthly report can cover July
     * rather than "the 30 days ending whenever the cron happened to fire".
     */
    reportPeriod: StatusPageReportPeriod;
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

    const startDate: Date = data.reportPeriod.startDate;
    const endDate: Date = data.reportPeriod.endDate;

    /*
     * This window is what every uptime number below has to be measured against.
     * It used to be computed only to fetch the timeline and was then discarded,
     * which let an event that started before the window contribute its whole
     * duration to the downtime total, and made the denominator "first event ->
     * now" instead of the window - so the reported percentage drifted upwards
     * every day.
     */
    const reportWindow: UptimeWindow = {
      startDate: startDate,
      endDate: endDate,
    };

    const periodStrings: Pick<
      StatusPageReport,
      | "reportDates"
      | "reportPeriodName"
      | "reportStartDate"
      | "reportEndDate"
      | "reportTimezone"
    > = {
      reportDates: data.reportPeriod.reportDates,
      reportPeriodName: data.reportPeriod.periodName,
      reportStartDate: OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: startDate,
        format: "MMM D, YYYY",
        timezone: data.reportPeriod.timezone,
      }),
      reportEndDate: OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: endDate,
        format: "MMM D, YYYY",
        timezone: data.reportPeriod.timezone,
      }),
      reportTimezone: data.reportPeriod.timezone,
    };

    if (statusPageResources.length === 0) {
      return {
        ...periodStrings,
        totalResources: 0,
        totalIncidents: 0,
        averageUptimePercent: "0%",
        totalDowntimeInHoursAndMinutes: "0",
        resources: [],
        groups: [],
        ungroupedResources: [],
        rows: [],
        hasGroups: false,
      };
    }

    const incidentCount: number = await this.getIncidentCountOnStatusPage({
      statusPageId: data.statusPageId,
      startDate: startDate,
      endDate: endDate,
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

    const entries: Array<StatusPageReportResourceEntry> = [];

    /*
     * Kept alongside `entries` so a group can roll up the monitors of every
     * resource beneath it without expanding monitor groups a second time.
     */
    const monitorIdsByResourceIndex: Array<Array<ObjectID>> = [];

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
        reportWindow,
      );
      const downtime: {
        totalDowntimeInSeconds: number;
        totalSecondsInTimePeriod: number;
      } = UptimeUtil.getTotalDowntimeInSeconds(
        timelineForThisResource,
        statusPage.downtimeMonitorStatuses!,
        reportWindow,
      );

      entries.push({
        statusPageResource: resource,
        reportItem: {
          resourceName: resource.displayName || "",
          totalIncidentCount: await this.getIncidentCountByMonitorIds({
            monitorIds: monitorIdsForThisResource,
            startDate: startDate,
            endDate: endDate,
          }),
          uptimePercent: uptimePercent,
          uptimePercentAsString: `${uptimePercent}%`,
          downtimeInHoursAndMinutes:
            OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
              Math.ceil(downtime.totalDowntimeInSeconds / 60),
            ),
        },
      });

      monitorIdsByResourceIndex.push(monitorIdsForThisResource);
    }

    const avgUptimePercent: number =
      entries.reduce((acc: number, entry: StatusPageReportResourceEntry) => {
        return acc + entry.reportItem.uptimePercent;
      }, 0) / entries.length;

    const avgUptimePercentString: string = avgUptimePercent.toFixed(2) + "%";

    const totalDowntimeInSeconds: {
      totalDowntimeInSeconds: number;
      totalSecondsInTimePeriod: number;
    } = UptimeUtil.getTotalDowntimeInSeconds(
      timeline,
      statusPage.downtimeMonitorStatuses!,
      reportWindow,
    );

    /*
     * The status page arranges its resources into a tree of groups and shows a
     * rolled up number at every level. Recipients of this email usually have no
     * login, so the report has to carry that hierarchy too - see
     * StatusPageReportTreeUtil.
     */
    const statusPageGroups: Array<StatusPageGroup> =
      await this.getStatusPageGroups({
        statusPageId: data.statusPageId,
      });

    const groupMetricsByGroupId: Dictionary<StatusPageReportGroupMetrics> =
      await this.getReportGroupMetrics({
        statusPageGroups: statusPageGroups,
        entries: entries,
        monitorIdsByResourceIndex: monitorIdsByResourceIndex,
        timeline: timeline,
        downtimeMonitorStatuses: statusPage.downtimeMonitorStatuses || [],
        reportWindow: reportWindow,
      });

    const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build(
      {
        entries: entries,
        statusPageGroups: statusPageGroups,
        groupMetricsByGroupId: groupMetricsByGroupId,
      },
    );

    return {
      ...periodStrings,
      totalResources: statusPageResources.length,
      totalIncidents: incidentCount,
      averageUptimePercent: avgUptimePercentString,
      resources: structure.resources,
      groups: structure.groups,
      ungroupedResources: structure.resourcesWithoutGroup,
      rows: structure.rows,
      hasGroups: structure.groups.length > 0,
      totalDowntimeInHoursAndMinutes:
        OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
          Math.ceil(totalDowntimeInSeconds.totalDowntimeInSeconds / 60),
        ),
    };
  }

  /*
   * Uptime, downtime and incidents for each group, measured over the group and
   * every group nested under it - the same set of resources the live status page
   * rolls a group's number over.
   */
  @CaptureSpan()
  public async getReportGroupMetrics(data: {
    statusPageGroups: Array<StatusPageGroup>;
    entries: Array<StatusPageReportResourceEntry>;
    monitorIdsByResourceIndex: Array<Array<ObjectID>>;
    timeline: Array<MonitorStatusTimeline>;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    reportWindow: UptimeWindow;
  }): Promise<Dictionary<StatusPageReportGroupMetrics>> {
    const groupMetricsByGroupId: Dictionary<StatusPageReportGroupMetrics> = {};
    const incidentCountByMonitorSet: Dictionary<number> = {};

    for (const group of data.statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (!groupId) {
        continue;
      }

      const groupIdsInSubtree: Set<string> = new Set<string>(
        StatusPageGroupTreeUtil.getGroupAndDescendants({
          statusPageGroup: group,
          statusPageGroups: data.statusPageGroups,
        }).map((groupInSubtree: StatusPageGroup) => {
          return groupInSubtree._id?.toString() || "";
        }),
      );

      const uptimePercentsInSubtree: Array<number> = [];
      const monitorIdsInSubtree: Dictionary<ObjectID> = {};

      data.entries.forEach(
        (entry: StatusPageReportResourceEntry, index: number) => {
          const resourceGroupId: string | undefined =
            entry.statusPageResource.statusPageGroupId?.toString();

          if (!resourceGroupId || !groupIdsInSubtree.has(resourceGroupId)) {
            return;
          }

          uptimePercentsInSubtree.push(entry.reportItem.uptimePercent);

          for (const monitorId of data.monitorIdsByResourceIndex[index] || []) {
            // de-duplicated: the same monitor can back more than one resource.
            monitorIdsInSubtree[monitorId.toString()] = monitorId;
          }
        },
      );

      const monitorIds: Array<ObjectID> = Object.values(monitorIdsInSubtree);

      const timelineForThisGroup: Array<MonitorStatusTimeline> =
        data.timeline.filter((item: MonitorStatusTimeline) => {
          return Boolean(
            item.monitorId && monitorIdsInSubtree[item.monitorId.toString()],
          );
        });

      const downtime: {
        totalDowntimeInSeconds: number;
        totalSecondsInTimePeriod: number;
      } = UptimeUtil.getTotalDowntimeInSeconds(
        timelineForThisGroup,
        data.downtimeMonitorStatuses,
        data.reportWindow,
      );

      /*
       * Averaging the resources' percentages (rather than recomputing from the
       * merged timeline) is what the live page does, so a group in the email
       * shows the number a reader can compare against the page.
       */
      const uptimePercent: number =
        uptimePercentsInSubtree.length > 0
          ? UptimeUtil.calculateAvgUptimePercentage({
              uptimePercentages: uptimePercentsInSubtree,
              precision:
                group.uptimePercentPrecision || UptimePrecision.TWO_DECIMAL,
            })
          : 0;

      /*
       * A chain like Corporate -> Region -> Market -> Unit rolls up the exact
       * same monitors at every level, so the incident count is cached by the
       * monitor set rather than issuing one identical query per level.
       */
      const monitorSetKey: string = monitorIds
        .map((monitorId: ObjectID) => {
          return monitorId.toString();
        })
        .sort()
        .join(",");

      let totalIncidentCount: number | undefined =
        incidentCountByMonitorSet[monitorSetKey];

      if (totalIncidentCount === undefined) {
        totalIncidentCount =
          monitorIds.length > 0
            ? await this.getIncidentCountByMonitorIds({
                monitorIds: monitorIds,
                startDate: data.reportWindow.startDate,
                endDate: data.reportWindow.endDate,
              })
            : 0;

        incidentCountByMonitorSet[monitorSetKey] = totalIncidentCount;
      }

      groupMetricsByGroupId[groupId] = {
        uptimePercent: uptimePercent,
        uptimePercentAsString: `${uptimePercent}%`,
        downtimeInHoursAndMinutes:
          OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
            Math.ceil(downtime.totalDowntimeInSeconds / 60),
          ),
        totalIncidentCount: totalIncidentCount,
      };
    }

    return groupMetricsByGroupId;
  }

  @CaptureSpan()
  public async getStatusPageGroups(data: {
    statusPageId: ObjectID;
  }): Promise<Array<StatusPageGroup>> {
    return await StatusPageGroupService.findBy({
      query: {
        statusPageId: data.statusPageId,
      },
      select: {
        name: true,
        order: true,
        parentStatusPageGroupId: true,
        uptimePercentPrecision: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getIncidentCountByMonitorIds(data: {
    monitorIds: Array<ObjectID>;
    startDate: Date;
    endDate: Date;
  }): Promise<number> {
    const incidentCount: PositiveNumber = await IncidentService.countBy({
      query: {
        monitors: data.monitorIds as any,
        createdAt: QueryHelper.inBetween(data.startDate, data.endDate),
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
    startDate: Date;
    endDate: Date;
  }): Promise<number> {
    const monitorsOnStatusPage: {
      monitorsOnStatusPage: Array<ObjectID>;
      monitorsInGroup: Dictionary<Array<ObjectID>>;
    } = await this.getMonitorIdsOnStatusPage({
      statusPageId: data.statusPageId,
    });

    return this.getIncidentCountByMonitorIds({
      monitorIds: monitorsOnStatusPage.monitorsOnStatusPage,
      startDate: data.startDate,
      endDate: data.endDate,
    });
  }

  @CaptureSpan()
  public async getMonitorIdsOnStatusPage(data: {
    statusPageId: ObjectID;
    /*
     * Pass when the caller has already loaded the page's resources —
     * several public endpoints fetch them right before calling this, and
     * without this parameter the identical StatusPageResource query used to
     * run twice per request.
     */
    statusPageResources?: Array<StatusPageResource> | undefined;
  }): Promise<{
    monitorsOnStatusPage: Array<ObjectID>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }> {
    const statusPageResources: Array<StatusPageResource> =
      data.statusPageResources ||
      (await this.getStatusPageResources({
        statusPageId: data.statusPageId,
      }));

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

    // Batched: one query for all monitor groups instead of one per group.
    const monitorIdsByGroupId: Dictionary<Array<ObjectID>> =
      await MonitorGroupService.getMonitorIdsInMonitorGroups(monitorGroupIds);

    for (const monitorGroupId of monitorGroupIds) {
      // get monitors in the group.

      const monitorsInGroupIds: Array<ObjectID> =
        monitorIdsByGroupId[monitorGroupId.toString()] || [];

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
            viewMode: true,
            rowAxisLabel: true,
            columnAxisLabel: true,
          },
          monitorId: true,
          displayTooltip: true,
          displayDescription: true,
          displayName: true,
          rowAxisValue: true,
          columnAxisValue: true,
          monitor: {
            _id: true,
            currentMonitorStatusId: true,
          },
          monitorGroupId: true,
          order: true,
          /*
           * needed so the emailed report rounds to the same precision the status page renders
           * with. Without it `resource.uptimePercentPrecision` is always undefined and the
           * report silently falls back to two decimals.
           */
          uptimePercentPrecision: true,
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

    /*
     * Batched: this used to issue one MonitorGroupResource query per status
     * page resource (not even per distinct group) on every badge render and
     * subscriber report. One query now serves all groups.
     */
    const resourcesByGroupId: Dictionary<Array<MonitorGroupResource>> =
      await MonitorGroupService.getMonitorGroupResourcesByGroupIds(
        data.statusPageResources
          .map((resource: StatusPageResource) => {
            return resource.monitorGroupId!;
          })
          .filter((id: ObjectID) => {
            return Boolean(id); // remove nulls
          }),
      );

    for (const resource of data.statusPageResources) {
      if (resource.monitorGroupId) {
        const monitorGroupResources: Array<MonitorGroupResource> =
          resourcesByGroupId[resource.monitorGroupId.toString()] || [];

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
