import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { CloudBudgetScope } from "Common/Types/Cloud/CloudBudget";
import {
  CloudBudgetPageResult,
  CloudCostForecastResult,
} from "Common/Types/Cloud/CloudBudgetReads";
import { CloudCostBasis } from "Common/Types/Cloud/CloudCostBasis";
import { CloudCostForecastGrowth } from "Common/Types/Cloud/CloudCostForecast";
import { CloudCostRule } from "Common/Types/Cloud/CloudCostRules";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT THE BUDGET AND FORECAST PAGES READ (#11008).
 *
 * A budget's page reads POST /cloud-budget/:id/spend: its period month by
 * month, this month's days, the months before them and the forecast of the
 * months ahead. The Forecast page reads POST /cloud-budget/forecast for the
 * scope picked: every account, one account, a cost group or a service.
 * Both are read as the person may read the budget and the costs; the
 * server works them out (CloudBudgetFigures).
 */

export interface CloudCostForecastAsk {
  scope: CloudBudgetScope;
  cloudAccountId?: ObjectID | undefined;
  cloudCostGroupId?: ObjectID | undefined;
  filterRules?: Array<CloudCostRule> | undefined;
  currency?: string | undefined;
  basis?: CloudCostBasis | undefined;
  monthsAhead?: number | undefined;
  growth?: CloudCostForecastGrowth | null | undefined;
}

async function post<T>(route: string, data: JSONObject): Promise<T> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as unknown as T;
}

export async function fetchCloudBudgetPage(
  budgetId: ObjectID,
): Promise<CloudBudgetPageResult> {
  return await post<CloudBudgetPageResult>(
    `/cloud-budget/${budgetId.toString()}/spend`,
    {},
  );
}

// A forecast's request as the API reads it.
export function toCloudCostForecastBody(ask: CloudCostForecastAsk): JSONObject {
  const body: JSONObject = { scope: ask.scope };

  if (ask.cloudAccountId) {
    body["cloudAccountId"] = ask.cloudAccountId.toString();
  }

  if (ask.cloudCostGroupId) {
    body["cloudCostGroupId"] = ask.cloudCostGroupId.toString();
  }

  if (ask.filterRules) {
    body["filterRules"] = ask.filterRules as unknown as JSONObject;
  }

  if (ask.currency) {
    body["currency"] = ask.currency;
  }

  if (ask.basis) {
    body["basis"] = ask.basis;
  }

  if (ask.monthsAhead) {
    body["monthsAhead"] = ask.monthsAhead;
  }

  if (ask.growth) {
    body["growth"] = ask.growth as unknown as JSONObject;
  }

  return body;
}

export async function fetchCloudCostForecast(
  ask: CloudCostForecastAsk,
): Promise<CloudCostForecastResult> {
  return await post<CloudCostForecastResult>(
    `/cloud-budget/forecast`,
    toCloudCostForecastBody(ask),
  );
}
