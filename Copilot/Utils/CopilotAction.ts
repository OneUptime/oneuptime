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
import CopilotActionProp from "Common/Types/Copilot/CopilotActionProps/Index";
import CodeRepositoryUtil from "./CodeRepository";

export default class CopilotActionUtil {
  public static async getExistingAction(data: {
    serviceCatalogId: ObjectID;
    actionType: CopilotActionType;
    actionProps: JSONObject;
  }): Promise<CopilotAction | null> {
    if (!data.serviceCatalogId) {
      throw new BadDataException("Service Catalog ID is required");
    }

    if (!data.actionType) {
      throw new BadDataException("Action Type is required");
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
        ?.toString()}/get-copilot-action/${repositorySecretKey}`,
    );

    const copilotActionResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url, {
        serviceCatalogId: data.serviceCatalogId.toString(),
        actionType: data.actionType,
        actionProps: JSON.stringify(data.actionProps),
      });

    if (copilotActionResult instanceof HTTPErrorResponse) {
      throw copilotActionResult;
    }

    if (!copilotActionResult.data["copilotAction"]) {
      return null;
    }

    return CopilotAction.fromJSONObject(
      copilotActionResult.data["copilotAction"] as JSONObject,
      CopilotAction,
    );
  }

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
    serviceRepositoryId: ObjectID;
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
        serviceRepositoryId: data.serviceRepositoryId,
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
    serviceRepositoryId: ObjectID;
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

    const actionProps: Array<CopilotActionProp> =
      await ActionBase.getActionPropsToQueue({
        serviceCatalogId: data.serviceCatalogId,
        serviceRepositoryId: data.serviceRepositoryId,
        maxActionsToQueue: data.itemsInQueue,
      });

    const savedActions: Array<CopilotAction> = [];

    // now these actions need to be saved.
    for (const actionProp of actionProps) {
      try {
        const savedAction: CopilotAction =
          await CopilotActionUtil.createCopilotAction({
            actionType: data.actionType,
            serviceCatalogId: data.serviceCatalogId,
            serviceRepositoryId: data.serviceRepositoryId,
            actionProps: actionProp,
          });

        savedActions.push(savedAction);
      } catch (error) {
        logger.error(`Error while adding copilot action: ${error}`);
      }
    }

    return savedActions;
  }

  public static async updateCopilotAction(data: {
    actionId: ObjectID;
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

  public static async createCopilotAction(data: {
    actionType: CopilotActionType;
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    actionProps: CopilotActionProp;
    actionStatus?: CopilotActionStatus;
  }): Promise<CopilotAction> {
    const action: CopilotAction = new CopilotAction();
    action.copilotActionType = data.actionType;
    action.serviceCatalogId = data.serviceCatalogId;
    action.serviceRepositoryId = data.serviceRepositoryId;
    action.copilotActionProp = data.actionProps;
    action.commitHash = await CodeRepositoryUtil.getCurrentCommitHash();

    if (data.actionStatus) {
      action.copilotActionStatus = data.actionStatus;
    } else {
      action.copilotActionStatus = CopilotActionStatus.IN_QUEUE;
    }

    // send this to the API.
    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotAction()
        .getCrudApiPath()
        ?.toString()}/create-copilot-action/${GetRepositorySecretKey()}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(url, {
        copilotAction: CopilotAction.toJSON(action, CopilotAction),
      });

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }

    return CopilotAction.fromJSONObject(
      codeRepositoryResult.data["copilotAction"] as JSONObject,
      CopilotAction,
    );
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

    debugger;

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
