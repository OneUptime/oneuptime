import BadDataException from "Common/Types/Exception/BadDataException";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";

export default class CopilotActionUtil {

  public static async getActionTypesBasedOnPriority(): Promise<Array<CopilotActionTypePriority>> {

    const repositorySecretKey: string | null = GetRepositorySecretKey();

    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction().getCrudApiPath()?.toString()}/copilot-action-types-by-priority/${repositorySecretKey}`,
    );

    const actionTypesResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url);

    if (actionTypesResult instanceof HTTPErrorResponse) {
      throw actionTypesResult;
    }

    const actionTypes: Array<CopilotActionTypePriority> = CopilotActionTypePriority.fromJSONArray(
      actionTypesResult.data["actionTypes"] as JSONArray,
      CopilotActionTypePriority,
    ) || [];

    logger.debug(`Copilot action types based on priority: ${JSON.stringify(actionTypes, null, 2)}`);

    return actionTypes;
  }

  public static async getActionsToWorkOn(data: {
    serviceCatalogId: ObjectID;
  }): Promise<Array<CopilotAction>> {
    if (!data.serviceCatalogId) {
      throw new BadDataException("Service Catalog ID is required");
    }

    const repositorySecretKey: string | null = GetRepositorySecretKey();

    if (!repositorySecretKey) {
      throw new BadDataException("Repository Secret Key is required");
    }

   // check actions in queue

   const actionsInQueue: Array<CopilotAction> = await CopilotActionUtil.getInQueueActions({
      serviceCatalogId: data.serviceCatalogId,
    });

    if(actionsInQueue.length > 0) {
      logger.debug(`Actions in queue: ${JSON.stringify(actionsInQueue, null, 2)}`);
      return actionsInQueue;
    }

   const getEnabledActionsBasedOnPriority


  }


  public static async getInQueueActions(data: {
    serviceCatalogId: ObjectID;
  }): Promise<Array<CopilotAction>>  {
    if (!data.serviceCatalogId) {
      throw new BadDataException("Service Catalog ID is required");
    }

    const repositorySecretKey: string | null = GetRepositorySecretKey();

    if (!repositorySecretKey) {
      throw new BadDataException("Repository Secret Key is required");
    }

    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction()
        .getCrudApiPath()
        ?.toString()}/copilot-actions-in-queue/${repositorySecretKey}`,
    );

    const copilotActionsResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url, {
        serviceCatalogId: data.serviceCatalogId.toString(),
      });

    if (copilotActionsResult instanceof HTTPErrorResponse) {
      throw copilotActionsResult;
    }

    const copilotActions: Array<CopilotAction> =
      CopilotAction.fromJSONArray(
        copilotActionsResult.data["copilotActions"] as JSONArray,
        CopilotAction,
      ) || [];

    logger.debug(
      `Copilot actions in queue for service catalog id: ${data.serviceCatalogId}`,
    );

    logger.debug(`Copilot events: ${JSON.stringify(copilotActions, null, 2)}`);

    return copilotActions;
  }
}
