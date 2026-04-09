import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../Types/Exception/MasterPasswordRequiredException";
import Model from "../../Models/DatabaseModels/Dashboard";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DashboardViewConfigUtil from "../../Utils/Dashboard/DashboardViewConfig";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import IP from "../../Types/IP/IP";
import {
  DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
  DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
} from "../../Types/Dashboard/MasterPassword";

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
      "dashboardTemplateType"
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

  public async hasReadAccess(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<{
    hasReadAccess: boolean;
    error?: NotAuthenticatedException | ForbiddenException;
  }> {
    const dashboardId: ObjectID = data.dashboardId;
    const req: ExpressRequest = data.req;

    try {
      const dashboard: Model | null = await this.findOneById({
        id: dashboardId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isPublicDashboard: true,
          ipWhitelist: true,
          enableMasterPassword: true,
          masterPassword: true,
        },
      });

      // If dashboard is not public, deny access
      if (dashboard && !dashboard.isPublicDashboard) {
        return {
          hasReadAccess: false,
          error: new NotAuthenticatedException(
            "This dashboard is not available.",
          ),
        };
      }

      if (dashboard?.ipWhitelist && dashboard.ipWhitelist.length > 0) {
        const ipWhitelist: Array<string> = dashboard.ipWhitelist?.split("\n");

        const ipAccessedFrom: string | undefined =
          req.headers["x-forwarded-for"]?.toString() ||
          req.headers["x-real-ip"]?.toString() ||
          req.socket.remoteAddress ||
          req.ip ||
          req.ips[0];

        if (!ipAccessedFrom) {
          logger.error("IP address not found in request.", {
            dashboardId: dashboardId?.toString(),
          } as LogAttributes);
          return {
            hasReadAccess: false,
            error: new ForbiddenException(
              "Unable to verify IP address for dashboard access.",
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
            `IP address ${ipAccessedFrom} is not whitelisted for dashboard ${dashboardId.toString()}.`,
            { dashboardId: dashboardId?.toString() } as LogAttributes,
          );

          return {
            hasReadAccess: false,
            error: new ForbiddenException(
              `Your IP address ${ipAccessedFrom} is blocked from accessing this dashboard.`,
            ),
          };
        }
      }

      const shouldEnforceMasterPassword: boolean = Boolean(
        dashboard &&
          dashboard.isPublicDashboard &&
          dashboard.enableMasterPassword &&
          dashboard.masterPassword,
      );

      if (shouldEnforceMasterPassword) {
        const hasValidMasterPassword: boolean =
          this.hasValidMasterPasswordCookie({
            req,
            dashboardId,
          });

        if (hasValidMasterPassword) {
          return {
            hasReadAccess: true,
          };
        }

        return {
          hasReadAccess: false,
          error: new MasterPasswordRequiredException(
            DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
          ),
        };
      }

      // Public dashboard without master password - grant access
      if (dashboard && dashboard.isPublicDashboard) {
        return {
          hasReadAccess: true,
        };
      }
    } catch (err) {
      logger.error(err, {
        dashboardId: dashboardId?.toString(),
      } as LogAttributes);
    }

    return {
      hasReadAccess: false,
      error: new NotAuthenticatedException(
        "You do not have access to this dashboard.",
      ),
    };
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
