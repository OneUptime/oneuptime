import BadDataException from "Common/Types/Exception/BadDataException";
import CopilotAction from "Common/AppModels/Models/CopilotAction";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import logger from "CommonServer/Utils/Logger";

export default class CopilotActionUtil {
  public static async getCopilotActions(data: {
    filePath: string;
    serviceCatalogId: ObjectID;
  }): Promise<Array<CopilotAction>> {
    if (!data.filePath) {
      throw new BadDataException("File path is required");
    }

    if (!data.serviceCatalogId) {
      throw new BadDataException("Service catalog id is required");
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
        ?.toString()}/copilot-actions-by-file/${repositorySecretKey}`,
    );

    const copilotActionsResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url, {
        filePath: data.filePath,
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
      `Copilot events fetched successfully for file path: ${data.filePath} and service catalog id: ${data.serviceCatalogId}`,
    );

    logger.debug(`Copilot events: ${JSON.stringify(copilotActions, null, 2)}`);

    return copilotActions;
  }
}
