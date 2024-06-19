import BadDataException from "Common/Types/Exception/BadDataException";
import CopilotEvent from "Model/Models/CopilotEvent";
import { GetOneUptimeURL, GetRepositorySecretKey } from "../Config";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/Utils/API";
import ObjectID from "Common/Types/ObjectID";
import logger from "CommonServer/Utils/Logger";

export default class CopilotEventUtil {
  public static async getCopilotEvents(data: {
    filePath: string;
    serviceCatalogId: ObjectID;
  }): Promise<Array<CopilotEvent>> {
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
      `${new CopilotEvent()
        .getCrudApiPath()
        ?.toString()}/copilot-events-by-file/${repositorySecretKey}`,
    );

    const copilotEventsResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url, {
        filePath: data.filePath,
        serviceCatalogId: data.serviceCatalogId.toString(),
      });

    if (copilotEventsResult instanceof HTTPErrorResponse) {
      throw copilotEventsResult;
    }

    const copilotEvents: Array<CopilotEvent> =
      CopilotEvent.fromJSONArray(
        copilotEventsResult.data["copilotEvents"] as JSONArray,
        CopilotEvent,
      ) || [];

    logger.debug(
      `Copilot events fetched successfully for file path: ${data.filePath} and service catalog id: ${data.serviceCatalogId}`,
    );

    logger.debug(`Copilot events: ${JSON.stringify(copilotEvents, null, 2)}`);

    return copilotEvents;
  }
}
