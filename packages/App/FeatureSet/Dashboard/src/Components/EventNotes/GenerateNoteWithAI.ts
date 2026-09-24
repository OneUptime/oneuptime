import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { GenerateAIRequestData } from "Common/UI/Components/AI/GenerateFromAIModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Returns the "Draft with AI" call for one event: POSTs the chosen template
 * to `<apiPath>/<eventId>` and resolves to the drafted note.
 *
 * `noteType` is left out for event types whose endpoint only drafts one kind
 * of note (alerts have no public notes).
 */
export function getNoteGenerator(data: {
  apiPath: string;
  eventId: ObjectID;
  noteType?: "public" | "internal" | undefined;
}): (request: GenerateAIRequestData) => Promise<string> {
  return async (request: GenerateAIRequestData): Promise<string> => {
    const body: JSONObject = {
      template: request.template,
    };

    if (data.noteType) {
      body["noteType"] = data.noteType;
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `${data.apiPath}/${data.eventId.toString()}`,
        ),
        data: body,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(response.message || "Failed to generate note with AI");
    }

    return response.data["note"] as string;
  };
}
