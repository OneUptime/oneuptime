import CloudBudget from "../../Models/DatabaseModels/CloudBudget";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudBudgetCheckWindow,
  CloudBudgetScope,
  getCloudBudgetCheckWindow,
  getCloudBudgetPlannedToDate,
  getCloudBudgetWindowDays,
  readCloudBudgetScope,
} from "../../Types/Cloud/CloudBudget";
import {
  CloudBudgetPageResult,
  CloudCostForecastRequest,
  CloudCostForecastResult,
  readCloudCostForecastRequest,
  toCloudBudgetPageDays,
  toCloudBudgetPageMonths,
} from "../../Types/Cloud/CloudBudgetReads";
import { startOfUtcDay } from "../../Types/Cloud/CloudCost";
import { CloudCostBasis } from "../../Types/Cloud/CloudCostBasis";
import {
  CloudCostForecast,
  applyCloudCostGrowth,
} from "../../Types/Cloud/CloudCostForecast";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudBudgetService, {
  Service as CloudBudgetServiceType,
} from "../Services/CloudBudgetService";
import CloudCostSettingService from "../Services/CloudCostSettingService";
import CloudBudgetEvaluator from "../Utils/CloudConnection/CloudBudgetEvaluator";
import CloudBudgetFigures, {
  CloudBudgetFiguresRead,
} from "../Utils/CloudCost/CloudBudgetFigures";
import CloudBudgetSpendReader, {
  CloudBudgetScopeRead,
} from "../Utils/CloudCost/CloudBudgetSpendReader";
import CloudCostAllocation from "../Utils/CloudCost/CloudCostAllocation";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Cloud budgets (#11008): the CRUD routes, and
 *
 *   POST /cloud-budget/:budgetId/spend
 *     A budget's period month by month - what each month cost or is on
 *     course to cost, against its share of a split year - this month's
 *     days, the full months before them, the forecast of the months ahead,
 *     and what cost the most (CloudBudgetPageResult). A budget's page reads
 *     it, and so can a script.
 *
 *   POST /cloud-budget/forecast
 *     { scope, cloudAccountId?, cloudCostGroupId?, filterRules?, currency?,
 *       basis?, monthsAhead?, growth?: { percent, fromMonth } }
 *     A scope's forecast: every account, one account, a cost group, or a
 *     filter of services, Regions and tags - this month and up to 24 months
 *     ahead, how it was made, and a what-if (CloudCostForecastResult). The
 *     Forecast page reads it, and saves it as a yearly budget's plan.
 *
 * Both read as the caller may read the budget, the cost group and the
 * costs, on the budget's cost basis (or the one asked for, else the
 * project's).
 */
export default class CloudBudgetAPI extends BaseAPI<
  CloudBudget,
  CloudBudgetServiceType
> {
  public constructor() {
    super(CloudBudget, CloudBudgetService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.post(
      `${path}/forecast`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readForecast(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/:budgetId/spend`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.readSpend(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async readProps(req: ExpressRequest): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = props.isMasterAdmin
      ? CommonAPI.assertTenantScoped(props)
      : CommonAPI.assertAuthenticatedProjectPrincipal(props);

    return { props, projectId };
  }

  private async readSpend(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { props, projectId } = await this.readProps(req);
    const budgetId: string = String(req.params["budgetId"] || "");

    if (!ObjectID.isValidUUID(budgetId)) {
      throw new BadDataException("The budget's ID is not valid.");
    }

    const budget: CloudBudget | null = await CloudBudgetService.findOneBy({
      query: { _id: new ObjectID(budgetId), projectId },
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      props,
    });

    if (!budget || !budget.id) {
      throw new NotFoundException(
        "This budget was not found. It may have been deleted, or you may not have access to it.",
      );
    }

    const now: Date = new Date();
    const scope: CloudBudgetScope = readCloudBudgetScope({
      scope: budget.scope,
      cloudAccountId: budget.cloudAccountId,
    });

    if (scope === CloudBudgetScope.CostGroup && !budget.cloudCostGroupId) {
      throw new NotFoundException(
        "This budget's cost group was deleted. Edit the budget to choose another group, or delete it.",
      );
    }

    const basis: CloudCostBasis = await CloudBudgetEvaluator.getBudgetBasis(
      budget,
      new Map(),
    );
    const currency: string = (budget.currency || "USD").toUpperCase();
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: budget.period,
      fiscalYearStartMonth: budget.fiscalYearStartMonth,
      amount: Number(budget.monthlyAmount) || 0,
      planSplit: budget.planSplit,
      monthlyPlan: budget.monthlyPlan,
      now,
    });
    const read: CloudBudgetScopeRead = {
      projectId,
      scope,
      cloudAccountId: budget.cloudAccountId || null,
      cloudCostGroupId: budget.cloudCostGroupId || null,
      filterRules: CloudBudgetEvaluator.readFilterRules(budget.filterRules),
      currency,
      basis,
      props,
      now,
    };
    const [figures, topServices]: [
      CloudBudgetFiguresRead,
      Array<{ service: string; amount: number }>,
    ] = await Promise.all([
      CloudBudgetFigures.read({ read, window, now, withForecast: true }),
      CloudBudgetSpendReader.readTopServices(
        read,
        window.period.start,
        startOfUtcDay(now),
        5,
      ),
    ]);
    const periodDays: { start: string; lastDay: string } =
      getCloudBudgetWindowDays(window.period);
    const windowDays: { start: string; lastDay: string } =
      getCloudBudgetWindowDays(window);

    const result: CloudBudgetPageResult = {
      budgetId: budget.id.toString(),
      currency,
      basis,
      period: {
        period: window.period.period,
        start: periodDays.start,
        lastDay: periodDays.lastDay,
        key: window.period.key,
        months: window.period.months,
      },
      window: {
        start: windowDays.start,
        lastDay: windowDays.lastDay,
        key: window.key,
        isPlanMonth: window.isPlanMonth,
        amount: window.amount,
      },
      amount: Number(budget.monthlyAmount) || 0,
      spentThisPeriod: figures.period.spent,
      projectedThisPeriod: figures.period.projected,
      plannedToDate: getCloudBudgetPlannedToDate({
        window,
        now,
        latestDay: figures.month.latestDay,
      }),
      spentThisMonth: figures.window.monthSpent,
      projectedThisMonth: figures.window.monthProjected,
      months: toCloudBudgetPageMonths({
        window,
        now,
        pastMonths: figures.pastMonths,
        month: figures.month,
        forecast: figures.forecast,
      }),
      history: Array.from(figures.pastMonths.entries())
        .map(([month, amount]: [string, number]) => {
          return { month, amount: Math.round(amount * 100) / 100 };
        })
        .sort((a: { month: string }, b: { month: string }): number => {
          return a.month.localeCompare(b.month);
        }),
      days: toCloudBudgetPageDays({ dailyTotals: figures.dailyTotals, now }),
      forecast: figures.forecast!,
      topServices,
      latestDay: figures.month.latestDay,
      readAt: now.toISOString(),
    };

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private async readForecast(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { props, projectId } = await this.readProps(req);
    const request: CloudCostForecastRequest = readCloudCostForecastRequest(
      req.body,
    );
    const now: Date = new Date();
    const currency: string =
      request.currency ||
      (await CloudCostAllocation.getProjectCurrency(projectId));
    const basis: CloudCostBasis =
      request.basis ||
      (await CloudCostSettingService.getCostBasisOfProject(projectId));
    const read: CloudBudgetScopeRead = {
      projectId,
      scope: request.scope,
      cloudAccountId: request.cloudAccountId || null,
      cloudCostGroupId: request.cloudCostGroupId || null,
      filterRules: request.filterRules || null,
      currency,
      basis,
      props,
      now,
    };
    const made: {
      forecast: CloudCostForecast;
      latestDay?: string | undefined;
    } = await CloudBudgetFigures.forecast({
      read,
      now,
      monthsAhead: request.monthsAhead,
    });

    const result: CloudCostForecastResult = {
      scope: request.scope,
      currency,
      basis,
      forecast: applyCloudCostGrowth(made.forecast, request.growth),
      latestDay: made.latestDay,
      readAt: now.toISOString(),
    };

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }
}
