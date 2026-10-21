import CreateBy from "../Types/Database/CreateBy";
import CreateLimit from "../Types/Database/CreateLimit";
import { OnCreate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CookieUtil from "../Utils/Cookie";
import { ExpressRequest } from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectCountLimit from "../Utils/Database/ProjectCountLimit";
import DashboardLabelRuleEngineService from "./DashboardLabelRuleEngineService";
import DashboardOwnerRuleEngineService from "./DashboardOwnerRuleEngineService";
import ProjectReferencesService from "./ProjectReferencesService";
import ProjectService from "./ProjectService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import Model from "../../Models/DatabaseModels/Dashboard";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DashboardViewConfigUtil from "../../Utils/Dashboard/DashboardViewConfig";
import StoredDashboardViewConfig from "../../Utils/Dashboard/StoredDashboardViewConfig";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { resolveClientIp } from "../Utils/ClientIp";
import { DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../Types/Dashboard/MasterPassword";
import PublicDashboardAccessPolicy, {
  PUBLIC_DASHBOARD_ACCESS_SELECT,
  PublicDashboardAccess,
  PublicDashboardAccessResult,
  PublicDashboardVisitor,
  UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
} from "../Utils/Dashboard/PublicDashboardAccess";
import {
  DASHBOARD_THEME_COLUMN,
  NEW_DASHBOARD_THEME,
  getDashboardThemeProblem,
} from "../../Types/Dashboard/DashboardTheme";
import {
  DASHBOARD_TIME_RANGE_FIELD,
  getDashboardTimeRangeProblem,
} from "../../Types/Dashboard/DashboardTimeRange";
import {
  DASHBOARD_AUTO_REFRESH_FIELD,
  getDashboardAutoRefreshProblem,
} from "../../Types/Dashboard/DashboardAutoRefresh";
import { getDashboardWidgetSortsProblem } from "../../Utils/Dashboard/DashboardWidgetSorts";

// The dashboard column that holds its widgets, variables and defaults.
export const DASHBOARD_VIEW_CONFIG_COLUMN: string = "dashboardViewConfig";

/*
 * Why a write's dashboardViewConfig cannot be saved, or null when it can:
 * its default time range and auto-refresh must each be one a dashboard can
 * open on (Types/Dashboard/DashboardTimeRange, DashboardAutoRefresh), and
 * each list or table widget's own sort one the widget can be sorted by
 * (Utils/Dashboard/DashboardWidgetSorts), or left out. The config is read
 * the way every reader reads it (StoredDashboardViewConfig.unwrap: an
 * envelope, JSON text), and nothing else in it is looked at: a config is
 * stored as it is sent.
 */
export const getDashboardViewConfigProblem: (
  dashboardViewConfig: unknown,
) => string | null = (dashboardViewConfig: unknown): string | null => {
  if (dashboardViewConfig === undefined || dashboardViewConfig === null) {
    return null;
  }

  const stored: JSONObject =
    StoredDashboardViewConfig.unwrap(dashboardViewConfig);

  return (
    getDashboardTimeRangeProblem(stored[DASHBOARD_TIME_RANGE_FIELD]) ||
    getDashboardAutoRefreshProblem(stored[DASHBOARD_AUTO_REFRESH_FIELD]) ||
    getDashboardWidgetSortsProblem(stored)
  );
};

/*
 * Refuses a dashboard write holding a value no reader of it can use
 * (checkCreateBeforeReferences, checkUpdateBeforeReferences): a theme that
 * is not Light, Dark or System, spelled exactly so (Types/Dashboard/
 * DashboardTheme), and a dashboardViewConfig whose default time range or
 * auto-refresh is none a dashboard can open on, or with a widget sort its
 * widget cannot be sorted by. Nothing at all is fine for each: the light
 * page, the past hour, no auto-refresh, each widget's own order.
 */
export const assertDashboardWriteValues: (
  data: Record<string, unknown>,
) => void = (data: Record<string, unknown>): void => {
  const themeProblem: string | null = getDashboardThemeProblem(
    data[DASHBOARD_THEME_COLUMN],
  );

  if (themeProblem) {
    throw new BadDataException(themeProblem);
  }

  const viewConfigProblem: string | null = getDashboardViewConfigProblem(
    data[DASHBOARD_VIEW_CONFIG_COLUMN],
  );

  if (viewConfigProblem) {
    throw new BadDataException(viewConfigProblem);
  }
};

/*
 * THE FREE PLAN'S LIMIT ON DASHBOARDS: one.
 *
 * Asked twice: early, in onBeforeCreate, and again with the INSERT, in its
 * own transaction under the limit's lock in the project (getCreateLimit,
 * ProjectCountLimit), so dashboards created at the same moment cannot all
 * pass. How many the Free plan allows, the lock's name, what it counts -
 * every dashboard of the project, as the early check counts them - and the
 * refusal both checks give.
 */
export const ALLOWED_DASHBOARD_COUNT_IN_FREE_PLAN: number = 1;

export const FREE_PLAN_DASHBOARD_LIMIT_NAME: string = "free-plan-dashboards";

export const DASHBOARD_COUNT_STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "Dashboard" WHERE "projectId" = $1 AND "deletedAt" IS NULL';

export const FREE_PLAN_DASHBOARD_LIMIT_MESSAGE: string =
  "Free plan can only have 1 dashboard. Please upgrade your plan.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Whether the Free plan's limit on dashboards holds this create: billing
   * on, and a caller on the Free plan (the plan CommonAPI read for the
   * request). OneUptime itself and a server admin carry no plan.
   */
  private isHeldToFreePlanLimit(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return IsBillingEnabled && props.currentPlan === PlanType.Free;
  }

  // Every create and update, before anything it names is looked up.
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    assertDashboardWriteValues(
      createBy.data as unknown as Record<string, unknown>,
    );
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    assertDashboardWriteValues(
      updateBy.data as unknown as Record<string, unknown>,
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    // On the Free plan, a project may only have one dashboard.
    if (this.isHeldToFreePlanLimit(createBy.props)) {
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

      if (count >= ALLOWED_DASHBOARD_COUNT_IN_FREE_PLAN) {
        throw new BadDataException(FREE_PLAN_DASHBOARD_LIMIT_MESSAGE);
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

    /*
     * Use the default empty config only when the config sent has no widget
     * on it - read the way the dashboard reads it. A config sent as the API
     * reference's `{_type: "DashboardViewConfig", value: {...}}` envelope, or
     * as JSON text, has its widgets one level down: the old top-level
     * `components` check replaced it, widgets and all, with an empty one.
     *
     * One with widgets is stored as it was sent. Terraform reads a write back
     * and compares it with what it sent, so rewriting it here would fail
     * `terraform apply`; every reader reads it through
     * StoredDashboardViewConfig instead (issue #4571).
     */
    if (
      !createBy.data.dashboardViewConfig ||
      StoredDashboardViewConfig.read(createBy.data.dashboardViewConfig)
        .components.length === 0
    ) {
      createBy.data.dashboardViewConfig =
        DashboardViewConfigUtil.createDefaultDashboardViewConfig();
    }

    /*
     * A dashboard made from now on follows each visitor's device on its
     * public link, light or dark, unless its create names a theme - as a
     * status page made from now on does. The column's default stays Light:
     * it is what the dashboards made before the setting were given, and
     * what the Terraform provider sends for a configuration that names no
     * theme (Dashboard.theme).
     */
    if (createBy.data.theme === undefined || createBy.data.theme === null) {
      createBy.data.theme = NEW_DASHBOARD_THEME;
    }

    return Promise.resolve({ createBy, carryForward: null });
  }

  /*
   * The Free plan's limit on dashboards, decided again with the INSERT:
   * counted in the INSERT's own transaction, under the limit's lock in the
   * project, so dashboards created at the same moment - each of which
   * passed the early count in onBeforeCreate - cannot all be added. Every
   * create is asked, one that skips its hooks too. Null when the create is
   * held to no such limit.
   */
  protected override async getCreateLimit(
    createBy: CreateBy<Model>,
  ): Promise<CreateLimit | null> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (!projectId || !this.isHeldToFreePlanLimit(createBy.props)) {
      return null;
    }

    return ProjectCountLimit.getCreateLimit({
      limitName: FREE_PLAN_DASHBOARD_LIMIT_NAME,
      projectId: projectId,
      allowed: ALLOWED_DASHBOARD_COUNT_IN_FREE_PLAN,
      statement: DASHBOARD_COUNT_STATEMENT,
      parameters: [projectId.toString()],
      refusal: FREE_PLAN_DASHBOARD_LIMIT_MESSAGE,
    });
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
   * What the visitor making this request is to a dashboard's public link.
   * Each fact is worked out only when the decision asks for it: the address
   * for a dashboard with an IP allowlist, the unlock cookie for one that
   * asks for the password. So an open dashboard's many widget requests never
   * decode a cookie they have no use for.
   */
  public getPublicDashboardVisitor(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): PublicDashboardVisitor {
    const resolveAddress: () => string | undefined = (): string | undefined => {
      /*
       * One address, resolved from the trusted end of X-Forwarded-For.
       * Never the raw header: a caller can prepend any address they like to
       * it, so checking the chain rather than a single resolved address let
       * anyone who knew an allowlisted address walk straight in.
       */
      return resolveClientIp(data.req);
    };

    const holdsUnlockCookie: () => boolean = (): boolean => {
      return this.hasValidMasterPasswordCookie({
        req: data.req,
        dashboardId: data.dashboardId,
      });
    };

    return {
      get clientIp(): string | undefined {
        return resolveAddress();
      },
      get hasUnlockCookie(): boolean {
        return holdsUnlockCookie();
      },
    };
  }

  /*
   * The decision (Utils/Dashboard/PublicDashboardAccess) for a dashboard
   * already loaded with at least PUBLIC_DASHBOARD_ACCESS_SELECT, for the
   * visitor making this request. A refusal by the IP allowlist is logged.
   */
  public async decidePublicAccess(data: {
    dashboard: Model | null;
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<PublicDashboardAccessResult> {
    const visitor: PublicDashboardVisitor = this.getPublicDashboardVisitor({
      dashboardId: data.dashboardId,
      req: data.req,
    });

    const result: PublicDashboardAccessResult =
      PublicDashboardAccessPolicy.decide({
        dashboard: await this.withoutBlockedProject(data.dashboard),
        visitor,
      });

    if (result.access === PublicDashboardAccess.Forbidden) {
      const clientIp: string | undefined = visitor.clientIp;

      if (!clientIp) {
        logger.error("IP address not found in request.", {
          dashboardId: data.dashboardId?.toString(),
        } as LogAttributes);
      } else {
        logger.error(
          `IP address ${clientIp} is not whitelisted for dashboard ${data.dashboardId.toString()}.`,
          { dashboardId: data.dashboardId?.toString() } as LogAttributes,
        );
      }
    }

    return result;
  }

  /*
   * What the public link answers the visitor making this request. Every
   * public dashboard route asks this before it reads anything it sends. A
   * lookup that fails throws (the route answers 500); the read check turns
   * that into a refusal (hasReadAccess).
   */
  public async getPublicAccess(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<PublicDashboardAccessResult> {
    return await this.decidePublicAccess({
      dashboard: await this.findPublicAccessColumns(data.dashboardId),
      dashboardId: data.dashboardId,
      req: data.req,
    });
  }

  /*
   * What the public link shows every visitor: decided for one nothing is
   * known about, with no unlock cookie and no address an IP allowlist could
   * name. For an answer rendered once for whoever loads the page, never for
   * whoever happens to ask - the page head filled in from the SEO answer.
   */
  public async getPublicAccessForEveryone(data: {
    dashboardId: ObjectID;
  }): Promise<PublicDashboardAccessResult> {
    return PublicDashboardAccessPolicy.decide({
      dashboard: await this.withoutBlockedProject(
        await this.findPublicAccessColumns(data.dashboardId),
      ),
      visitor: UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
    });
  }

  /*
   * The dashboard as its public link may see it: none at all when a master
   * admin blocked its project. The decision then answers as it answers a
   * dashboard that does not exist (NotFound) - on every public route, since
   * every one of them is decided here - and unblocking the project puts the
   * link back as it was. The project's blocked flag is cached per server
   * (ProjectService.isProjectBlocked), so a dashboard's many widget requests
   * read nothing more.
   *
   * The dashboard must be loaded with its projectId, as
   * PUBLIC_DASHBOARD_ACCESS_SELECT loads it. A lookup that fails lets the
   * dashboard through, as it was before blocking existed: a fault in a check
   * that is there for abuse must not take every public dashboard down.
   */
  private async withoutBlockedProject(
    dashboard: Model | null,
  ): Promise<Model | null> {
    if (!dashboard?.projectId) {
      return dashboard;
    }

    try {
      if (await ProjectService.isProjectBlocked(dashboard.projectId)) {
        return null;
      }
    } catch (err) {
      logger.error(
        `Could not tell whether the project of dashboard ${dashboard.id?.toString()} is blocked; its public link answers as usual.`,
      );
      logger.error(err);
    }

    return dashboard;
  }

  /*
   * The read check of every public route that serves the dashboard's
   * content (its overview, view config and widget data): only a visitor the
   * link lets in (Granted) gets through. A refusal names the link's reason,
   * and a missing, an archived and a private dashboard are refused in the
   * same words.
   */
  public async hasReadAccess(data: {
    dashboardId: ObjectID;
    req: ExpressRequest;
  }): Promise<{
    hasReadAccess: boolean;
    error?: NotAuthenticatedException | ForbiddenException;
  }> {
    let result: PublicDashboardAccessResult;

    try {
      result = await this.getPublicAccess(data);
    } catch (err) {
      // Fails closed: a lookup that goes wrong refuses, and nothing is read.
      logger.error(err, {
        dashboardId: data.dashboardId?.toString(),
      } as LogAttributes);

      result = PublicDashboardAccessPolicy.decide({
        dashboard: null,
        visitor: UNKNOWN_PUBLIC_DASHBOARD_VISITOR,
      });
    }

    if (result.access === PublicDashboardAccess.Granted) {
      return {
        hasReadAccess: true,
      };
    }

    return {
      hasReadAccess: false,
      error: result.error,
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
