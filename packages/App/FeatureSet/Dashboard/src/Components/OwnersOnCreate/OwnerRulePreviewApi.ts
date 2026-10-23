import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import OwnerRulePreview, {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "Common/Types/Rules/OwnerRulePreview";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Which owner rules would run for the event a create form holds, and who
 * they would add: POST /<event>/owner-rule-preview (Types/Rules/
 * OwnerRulePreview). Each event's route is written out in its own call
 * rather than read from OwnerRulePreview.getApiPath, so the tenant-header
 * sweep (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see
 * which route each call reaches; a test pins the two together. The tenant
 * header is what tells the server which project the answer is for.
 */

type PreviewResponse = HTTPResponse<JSONObject> | HTTPErrorResponse;

const askServer: (data: {
  event: OwnerRulePreviewEvent;
  body: JSONObject;
}) => Promise<PreviewResponse> = async (data: {
  event: OwnerRulePreviewEvent;
  body: JSONObject;
}): Promise<PreviewResponse> => {
  switch (data.event) {
    case OwnerRulePreviewEvent.Incident:
      return await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/incident/owner-rule-preview",
        ),
        data: data.body,
        headers: ModelAPI.getCommonHeaders(),
      });
    case OwnerRulePreviewEvent.Alert:
      return await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/alert/owner-rule-preview",
        ),
        data: data.body,
        headers: ModelAPI.getCommonHeaders(),
      });
    case OwnerRulePreviewEvent.IncidentEpisode:
      return await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/incident-episode/owner-rule-preview",
        ),
        data: data.body,
        headers: ModelAPI.getCommonHeaders(),
      });
    case OwnerRulePreviewEvent.AlertEpisode:
      return await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/alert-episode/owner-rule-preview",
        ),
        data: data.body,
        headers: ModelAPI.getCommonHeaders(),
      });
  }
};

export const fetchOwnerRulePreview: (data: {
  event: OwnerRulePreviewEvent;
  draft: OwnerRulePreviewDraft;
}) => Promise<OwnerRulePreviewResult> = async (data: {
  event: OwnerRulePreviewEvent;
  draft: OwnerRulePreviewDraft;
}): Promise<OwnerRulePreviewResult> => {
  const response: PreviewResponse = await askServer({
    event: data.event,
    body: OwnerRulePreview.draftToJSON(data.draft),
  });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return OwnerRulePreview.resultFromJSON(response.data || {});
};
