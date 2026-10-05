import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger, { LogAttributes } from "../Utils/Logger";
import DashboardLabelRuleEngineService from "./DashboardLabelRuleEngineService";
import DashboardOwnerRuleEngineService from "./DashboardOwnerRuleEngineService";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import Model from "../../Models/DatabaseModels/Dashboard";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DashboardViewConfigUtil from "../../Utils/Dashboard/DashboardViewConfig";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import { resolveClientIp } from "../Utils/ClientIp";
import { DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../Types/Dashboard/MasterPassword";
import PublicDashboardAccessPolicy, {
  PUBLIC_DASHBOARD_ACCESS_SELECT,
  PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE,
  PublicDashboardAccess,
  PublicDashboardAccessResult,
  PublicDashboardVisitor,
  UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
} from "../Utils/Dashboard/PublicDashboardAccess";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (IsBillingEnabled) {
      // then if free plan, make sure it can only have 1 dashboard.

      if (createBy.props.currentPlan === PlanType.Free) {
        // get count by project id.
        const count: number = (
          await this.countBy({
            query: {
              projectId: createBy.data.projectId,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber();

        if (count > 0) {
          throw new BadDataException(
            "Free plan can only have 1 dashboard. Please upgrade your plan.",
          );
        }
      }
    }

    // Check if a template type was provided via miscDataProps
    const templateType: string | undefined = createBy.miscDataProps?.[
      DASHBOARD_TEMPLATE_MISC_DATA_KEY
    ] as string | undefined;

    if (
      templateType &&
      templateType !== DashboardTemplateType.Blank &&
      Object.values(DashboardTemplateType).includes(
        templateType as DashboardTemplateType,
      )
    ) {
      const templateConfig: DashboardViewConfig | null = getTemplateConfig(
        templateType as DashboardTemplateType,
      );

      if (templateConfig) {
        createBy.data.dashboardViewConfig = templateConfig;
      }
    }

    // use default empty config only if no template config was provided.
    if (
      !createBy.data.dashboardViewConfig ||
      !createBy.data.dashboardViewConfig.components ||
      createBy.data.dashboardViewConfig.components.length === 0
    ) {
      createBy.data.dashboardViewConfig =
        DashboardViewConfigUtil.createDefaultDashboardViewConfig();
    }

    return Promise.resolve({ createBy, carryForward: null });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await DashboardLabelRuleEngineService.applyRulesToDashboard(
            createdItem,
          );
        })
        .then(async () => {
          await DashboardOwnerRuleEngineService.applyRulesToDashboard(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying dashboard rules in DashboardService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dashboardId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  /*
   * What the visitor making this request is to a dashboard's public link:
   * the address its IP allowlist checks, and whether they hold its unlock
   * cookie.
   */
  public getPublicDashboardVisitor(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): PublicDashboardVisitor {
    return {
      /*
       * One address, resolved from the trusted end of X-Forwarded-For.
       * Never the raw header: a caller can prepend any address they like to
       * it, so checking the chain rather than a single resolved address let
       * anyone who knew an allowlisted address walk straight in.
       */
      clientIp: resolveClientIp(data.req),
      hasUnlockCookie: this.hasValidMasterPasswordCookie({
        req: data.req,
        dashboardId: data.dashboardId,
      }),
    };
  }

  /*
   * What the public link answers the visitor making this request
   * (Utils/Dashboard/PublicDashboardAccess). Every public dashboard route
   * asks this before it reads anything it sends. Fails closed: a lookup
   * that goes wrong answers like a dashboard that does not exist.
   */
  public async getPublicAccess(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<PublicDashboardAccessResult> {
    const dashboardId: ObjectID = data.dashboardId;

    try {
      const visitor: PublicDashboardVisitor =
        this.getPublicDashboardVisitor(data);

      const result: PublicDashboardAccessResult =
        PublicDashboardAccessPolicy.decide({
          dashboard: await this.findPublicAccessColumns(dashboardId),
          visitor,
        });

      if (result.access === PublicDashboardAccess.Forbidden) {
        if (!visitor.clientIp) {
          logger.error("IP address not found in request.", {
            dashboardId: dashboardId?.toString(),
          } as LogAttributes);
        } else {
          logger.error(
            `IP address ${visitor.clientIp} is not whitelisted for dashboard ${dashboardId.toString()}.`,
            { dashboardId: dashboardId?.toString() } as LogAttributes,
          );
        }
      }

      return result;
    } catch (err) {
      logger.error(err, {
        dashboardId: dashboardId?.toString(),
      } as LogAttributes);
    }

    return PublicDashboardAccessPolicy.decide({
      dashboard: null,
      visitor: UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
    });
  }

  /*
   * What the public link shows every visitor: decided for one nothing is
   * known about, with no unlock cookie and no address an IP allowlist could
   * name. For an answer rendered once for whoever loads the page, never for
   * whoever happens to ask - the page head filled in from the SEO answer.
   * Fails closed like getPublicAccess.
   */
  public async getPublicAccessForEveryone(data: {
    dashboardId: ObjectID;
  }): Promise<PublicDashboardAccessResult> {
    try {
      return PublicDashboardAccessPolicy.decide({
        dashboard: await this.findPublicAccessColumns(data.dashboardId),
        visitor: UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
      });
    } catch (err) {
      logger.error(err, {
        dashboardId: data.dashboardId?.toString(),
      } as LogAttributes);
    }

    return PublicDashboardAccessPolicy.decide({
      dashboard: null,
      visitor: UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
    });
  }

  /*
   * The read check of every public route that serves the dashboard's
   * content (its overview, view config and widget data): only a visitor the
   * link lets in (Granted) gets through. A refusal names the link's reason
   * (PublicDashboardAccessResult.error), and a missing, an archived and a
   * private dashboard are refused in the same words.
   */
  public async hasReadAccess(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<{
    hasReadAccess: boolean;
    error?: NotAuthenticatedException | ForbiddenException;
  }> {
    const result: PublicDashboardAccessResult =
      await this.getPublicAccess(data);

    if (result.access === PublicDashboardAccess.Granted) {
      return {
        hasReadAccess: true,
      };
    }

    return {
      hasReadAccess: false,
      error:
        result.error ||
        new NotAuthenticatedException(PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE),
    };
  }

  /*
   * The columns the public link's decision reads. A value that is not a
   * dashboard id at all is answered without a query, like an id no
   * dashboard has.
   */
  private async findPublicAccessColumns(
    dashboardId: ObjectID,
  ): Promise<Model | null> {
    if (!dashboardId || !ObjectID.isValidUUID(dashboardId.toString())) {
      return null;
    }

    return await this.findOneById({
      id: dashboardId,
      select: PUBLIC_DASHBOARD_ACCESS_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  private hasValidMasterPasswordCookie(data: {
    req: ExpressRequest;
    dashboardId: ObjectID;
  }): boolean {
    const token: string | undefined = CookieUtil.getCookieFromExpressRequest(
      data.req,
      CookieUtil.getDashboardMasterPasswordKey(data.dashboardId),
    );

    if (!token) {
      return false;
    }

    try {
      const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

      return (
        payload["dashboardId"] === data.dashboardId.toString() &&
        payload["type"] === DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER
      );
    } catch (err) {
      logger.error(err, {
        dashboardId: data.dashboardId?.toString(),
      } as LogAttributes);
    }

    return false;
  }
}

export default new Service();
