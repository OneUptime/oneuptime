import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
} from "Common/Types/StatusPage/StatusPagesListingMonitors";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";
import {
  StatusPageSuggestionsRequest,
  getStatusPageSuggestionsRequestBody,
} from "./StatusPageSuggestionRules";

/*
 * The status pages that list some monitors, from
 * POST /status-page/listing-monitors (see StatusPagesListingMonitors), for
 * the suggestions under a status page picker (StatusPageSuggestions).
 *
 * A form's values change on every keystroke elsewhere in it, so the request
 * is keyed on the monitors it names (sorted) and the kind of event, fetched
 * only when those change, and only once the picking has settled for a
 * moment. An answer to a request that has since changed is dropped.
 */

export interface StatusPagesListingMonitorsState {
  // The pages that list the monitors; empty while loading or on an error.
  statusPages: Array<StatusPageListingMonitors>;
  isLoading: boolean;
  error: string;
}

// How long the monitors have to stop changing before the request goes out.
export const STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS: number = 400;

/*
 * The route is written out rather than read from
 * StatusPagesListingMonitors.apiPath so the tenant-header sweep
 * (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see which
 * route this call reaches; a test pins the two together. The tenant header is
 * what tells the server which project the answer is for.
 */
export const fetchStatusPagesListingMonitors: (
  body: JSONObject,
) => Promise<Array<StatusPageListingMonitors>> = async (
  body: JSONObject,
): Promise<Array<StatusPageListingMonitors>> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/status-page/listing-monitors",
      ),
      data: body,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return StatusPagesListingMonitors.fromJSON(response.data || {}).statusPages;
};

const useStatusPagesListingMonitors: (
  request: StatusPageSuggestionsRequest | null,
) => StatusPagesListingMonitorsState = (
  request: StatusPageSuggestionsRequest | null,
): StatusPagesListingMonitorsState => {
  const body: JSONObject | null = getStatusPageSuggestionsRequestBody(request);
  const requestKey: string = body ? JSON.stringify(body) : "";

  const [state, setState] = useState<{
    key: string;
    statusPages: Array<StatusPageListingMonitors>;
    error: string;
  }>({ key: "", statusPages: [], error: "" });

  useEffect(() => {
    if (!requestKey) {
      return;
    }

    let isCancelled: boolean = false;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      fetchStatusPagesListingMonitors(JSON.parse(requestKey) as JSONObject)
        .then((statusPages: Array<StatusPageListingMonitors>) => {
          if (!isCancelled) {
            setState({ key: requestKey, statusPages: statusPages, error: "" });
          }
        })
        .catch((err: unknown) => {
          if (!isCancelled) {
            setState({
              key: requestKey,
              statusPages: [],
              error: API.getFriendlyMessage(err),
            });
          }
        });
    }, STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [requestKey]);

  if (!requestKey) {
    return { statusPages: [], isLoading: false, error: "" };
  }

  // Until the answer for this request arrives, the last one is stale.
  if (state.key !== requestKey) {
    return { statusPages: [], isLoading: true, error: "" };
  }

  return {
    statusPages: state.statusPages,
    isLoading: false,
    error: state.error,
  };
};

export default useStatusPagesListingMonitors;
