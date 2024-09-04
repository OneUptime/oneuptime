import BadDataException from "Common/Types/Exception/BadDataException";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import {
  GetOneUptimeURL,
  GetRepositorySecretKey,
  MIN_ITEMS_IN_QUEUE_PER_SERVICE_CATALOG,
} from "../Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionTypeUtil from "./CopilotActionTypes";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import { ActionDictionary } from "../Service/CopilotActions/Index";
import CopilotActionBase from "../Service/CopilotActions/CopilotActionsBase";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";

export default class CopilotActionUtil {
  public static async getActionTypesBasedOnPriority(): Promise<
    Array<CopilotActionTypePriority>
  > {
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

    const actionTypes: Array<CopilotActionTypePriority> =
      CopilotActionTypePriority.fromJSONArray(
        actionTypesResult.data["actionTypes"] as JSONArray,
        CopilotActionTypePriority,
      ) || [];

    logger.debug(
      `Copilot action types based on priority: ${JSON.stringify(actionTypes, null, 2)}`,
    );

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

    const actionsInQueue: Array<CopilotAction> =
      await CopilotActionUtil.getInQueueActions({
        serviceCatalogId: data.serviceCatalogId,
      });

    if (actionsInQueue.length >= MIN_ITEMS_IN_QUEUE_PER_SERVICE_CATALOG) {
      logger.debug(
        `Actions in queue: ${JSON.stringify(actionsInQueue, null, 2)}`,
      );
      return actionsInQueue;
    }

    const actionTypePriorities: Array<CopilotActionTypePriority> =
      await CopilotActionTypeUtil.getEnabledActionTypesBasedOnPriority();

    for (const actionTypePriority of actionTypePriorities) {
      // get items in queue based on priority
      const itemsInQueue: number =
        CopilotActionTypeUtil.getItemsInQueueByPriority(
          actionTypePriority.priority || 1,
        );

      // get actions based on priority
      const actions: Array<CopilotAction> = await CopilotActionUtil.getActions({
        serviceCatalogId: data.serviceCatalogId,
        actionType: actionTypePriority.actionType!,
        itemsInQueue,
      });

      // add these actions to the queue
      actionsInQueue.push(...actions);
    }

    return actionsInQueue;
  }

  public static async getActions(data: {
    serviceCatalogId: ObjectID;
    actionType: CopilotActionType;
    itemsInQueue: number;
  }): Promise<Array<CopilotAction>> {
    if (!data.serviceCatalogId) {
      throw new BadDataException("Service Catalog ID is required");
    }

    if (!data.actionType) {
      throw new BadDataException("Action Type is required");
    }

    const CopilotActionBaseType: typeof CopilotActionBase =
      ActionDictionary[data.actionType]!;
    const ActionBase: CopilotActionBase = new CopilotActionBaseType();

    const actions: Array<CopilotAction> = await ActionBase.getActionsToQueue({
      serviceCatalogId: data.serviceCatalogId,
      maxActionsToQueue: data.itemsInQueue,
    });

    const savedActions: Array<CopilotAction> = [];

    // now these actions need to be saved.
    for (const action of actions) {
      try {
        const savedAction: CopilotAction =
          await CopilotActionUtil.addCopilotAction({
            copilotAction: action,
          });

        savedActions.push(savedAction);
      } catch (error) {
        logger.error(`Error while adding copilot action: ${error}`);
      }
    }

    return savedActions;
  }

  public static async updateCopilotAction(data: {
    actionStatus: CopilotActionStatus;
    pullRequestId?: ObjectID | undefined;
    commitHash?: string | undefined;
    statusMessage?: string | undefined;
    logs?: Array<string> | undefined;
  }): Promise<void> {
    // send this to the API.
    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction()
        .getCrudApiPath()
        ?.toString()}/update-copilot-action/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(url, {
        ...data,
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }
  }

  public static async addCopilotAction(data: {
    copilotAction: CopilotAction;
  }): Promise<CopilotAction> {
    // send this to the API.
    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction()
        .getCrudApiPath()
        ?.toString()}/add-copilot-action/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(url, {
        copilotAction: CopilotAction.toJSON(data.copilotAction, CopilotAction),
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }

    return CopilotAction.fromJSONObject(data.copilotAction, CopilotAction);
  }

  public static async getInQueueActions(data: {
    serviceCatalogId: ObjectID;
  }): Promise<Array<CopilotAction>> {
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
