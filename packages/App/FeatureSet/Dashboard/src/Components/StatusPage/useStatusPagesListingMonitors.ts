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
  StatusPageSuggestionsQuestion,
  StatusPageSuggestionsRequest,
  getStatusPageSuggestionsQuestion,
  getStatusPageSuggestionsRequestBodies,
  isStillShowingTheMonitors,
  mergeStatusPagesListingMonitors,
} from "./StatusPageSuggestionRules";

/*
 * The status pages that list some monitors, from
 * POST /status-page/listing-monitors (see StatusPagesListingMonitors), for
 * the suggestions under a status page picker (StatusPageSuggestions).
 *
 * A form's values change on every keystroke elsewhere in it, so the request
 * is keyed on the monitors it names (sorted) and the kind of event, fetched
 * only when those change and - while they are being picked on the form -
 * only once the picking has settled for a moment. An answer to a request
 * that has since changed is dropped. While a new answer is on its way, the
 * last one is kept if the monitors were only added to (every page it named
 * still shows one of them), so the line does not vanish under the pointer.
 */

export interface StatusPagesListingMonitorsState {
  // The pages that list the monitors; empty while nothing is known yet.
  statusPages: Array<StatusPageListingMonitors>;
  isLoading: boolean;
  error: string;
}

export interface StatusPagesListingMonitorsOptions {
  /*
   * Wait for the monitors to stop changing before asking: they are being
   * picked on the form. False for monitors read from a saved record, which
   * do not change while the picker is open.
   */
  waitForPickingToSettle?: boolean | undefined;
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

/*
 * Every page that lists any of the monitors: one request per
 * StatusPagesListingMonitors.maxIdsPerRequest monitors, the answers merged.
 */
export const fetchStatusPagesShowingMonitors: (
  question: StatusPageSuggestionsQuestion,
) => Promise<Array<StatusPageListingMonitors>> = async (
  question: StatusPageSuggestionsQuestion,
): Promise<Array<StatusPageListingMonitors>> => {
  const answers: Array<Array<StatusPageListingMonitors>> = await Promise.all(
    getStatusPageSuggestionsRequestBodies(question).map(
      (body: JSONObject): Promise<Array<StatusPageListingMonitors>> => {
        return fetchStatusPagesListingMonitors(body);
      },
    ),
  );

  return mergeStatusPagesListingMonitors(answers);
};

interface AnsweredState {
  key: string;
  question: StatusPageSuggestionsQuestion | null;
  statusPages: Array<StatusPageListingMonitors>;
  error: string;
}

const useStatusPagesListingMonitors: (
  request: StatusPageSuggestionsRequest | null,
  options?: StatusPagesListingMonitorsOptions,
) => StatusPagesListingMonitorsState = (
  request: StatusPageSuggestionsRequest | null,
  options?: StatusPagesListingMonitorsOptions,
): StatusPagesListingMonitorsState => {
  const question: StatusPageSuggestionsQuestion | null =
    getStatusPageSuggestionsQuestion(request);
  const requestKey: string = question ? JSON.stringify(question) : "";
  const waitForPickingToSettle: boolean =
    options?.waitForPickingToSettle !== false;

  const [state, setState] = useState<AnsweredState>({
    key: "",
    question: null,
    statusPages: [],
    error: "",
  });

  useEffect(() => {
    if (!requestKey) {
      return;
    }

    let isCancelled: boolean = false;
    const asked: StatusPageSuggestionsQuestion = JSON.parse(
      requestKey,
    ) as StatusPageSuggestionsQuestion;

    const run: () => void = (): void => {
      fetchStatusPagesShowingMonitors(asked)
        .then((statusPages: Array<StatusPageListingMonitors>) => {
          if (!isCancelled) {
            setState({
              key: requestKey,
              question: asked,
              statusPages: statusPages,
              error: "",
            });
          }
        })
        .catch((err: unknown) => {
          if (!isCancelled) {
            setState({
              key: requestKey,
              question: asked,
              statusPages: [],
              error: API.getFriendlyMessage(err),
            });
          }
        });
    };

    const timer: ReturnType<typeof setTimeout> | null = waitForPickingToSettle
      ? setTimeout(run, STATUS_PAGE_SUGGESTIONS_DEBOUNCE_MS)
      : null;

    if (!timer) {
      run();
    }

    return () => {
      isCancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [requestKey, waitForPickingToSettle]);

  if (!requestKey || !question) {
    return { statusPages: [], isLoading: false, error: "" };
  }

  if (state.key !== requestKey) {
    // Monitors only added: every page the last answer named still shows one.
    if (
      state.question &&
      !state.error &&
      isStillShowingTheMonitors({ before: state.question, after: question })
    ) {
      return { statusPages: state.statusPages, isLoading: true, error: "" };
    }

    return { statusPages: [], isLoading: true, error: "" };
  }

  return {
    statusPages: state.statusPages,
    isLoading: false,
    error: state.error,
  };
};

export default useStatusPagesListingMonitors;
