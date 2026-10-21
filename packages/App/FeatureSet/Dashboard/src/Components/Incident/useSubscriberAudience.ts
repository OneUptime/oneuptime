import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceResult,
} from "Common/Types/StatusPage/IncidentSubscriberAudience";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useMemo, useState } from "react";
import { getIdsFromFormValue } from "./IncidentStatusPageScopeForm";

/*
 * Who an incident's status page notifications would reach, from
 * POST /incident/subscriber-audience (see IncidentSubscriberAudience):
 *
 * - {incidentId} for an incident that exists (the public note composer);
 * - {monitorIds, statusPageIds} for one being declared or edited, straight
 *   from the form's values in whatever shape they are held.
 *
 * A form's values change on every keystroke elsewhere in it, so the request
 * is keyed on the ids it names (sorted), fetched only when they change, and a
 * draft waits a moment for the picking to settle. An answer to a request that
 * has since changed is dropped.
 */

export type SubscriberAudienceRequest =
  | {
      incidentId: ObjectID | string;
      /*
       * Who a Retry of its 'created' notification reaches: the pages already
       * sent it in full are listed as not notified (see
       * IncidentSubscriberAudienceExclusionReason.AlreadyNotified).
       */
      excludeStatusPagesNotifiedOnCreation?: boolean | undefined;
    }
  | {
      monitorIds: unknown;
      statusPageIds: unknown;
    };

export interface SubscriberAudienceState {
  audience: IncidentSubscriberAudienceResult | null;
  isLoading: boolean;
  error: string;
}

// How long a draft waits for the ids to stop changing before it asks.
export const SUBSCRIBER_AUDIENCE_DEBOUNCE_MS: number = 400;

/*
 * The request body for a request, or null when there is nothing to ask. The
 * ids are normalized and sorted, so the body doubles as the request's key.
 */
export const getSubscriberAudienceRequestBody: (
  request: SubscriberAudienceRequest | null,
) => JSONObject | null = (
  request: SubscriberAudienceRequest | null,
): JSONObject | null => {
  if (!request) {
    return null;
  }

  if ("incidentId" in request) {
    const incidentId: string = request.incidentId.toString().trim();

    if (!incidentId) {
      return null;
    }

    return request.excludeStatusPagesNotifiedOnCreation
      ? { incidentId: incidentId, excludeStatusPagesNotifiedOnCreation: true }
      : { incidentId: incidentId };
  }

  return {
    monitorIds: getIdsFromFormValue(request.monitorIds).sort(),
    statusPageIds: getIdsFromFormValue(request.statusPageIds).sort(),
  };
};

/*
 * The route is written out rather than read from
 * IncidentSubscriberAudience.apiPath so the tenant-header sweep
 * (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see which
 * route this call reaches; a test pins the two together. The tenant header is
 * what tells the server which project the answer is for.
 */
export const fetchSubscriberAudience: (
  body: JSONObject,
) => Promise<IncidentSubscriberAudienceResult> = async (
  body: JSONObject,
): Promise<IncidentSubscriberAudienceResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/incident/subscriber-audience",
      ),
      data: body,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return IncidentSubscriberAudience.fromJSON(response.data || {});
};

const useSubscriberAudience: (
  request: SubscriberAudienceRequest | null,
) => SubscriberAudienceState = (
  request: SubscriberAudienceRequest | null,
): SubscriberAudienceState => {
  const body: JSONObject | null = getSubscriberAudienceRequestBody(request);
  const requestKey: string = body ? JSON.stringify(body) : "";

  const [state, setState] = useState<{
    key: string;
    audience: IncidentSubscriberAudienceResult | null;
    error: string;
  }>({ key: "", audience: null, error: "" });

  const isDraft: boolean = useMemo(() => {
    return Boolean(body && !("incidentId" in body));
  }, [requestKey]);

  useEffect(() => {
    if (!requestKey) {
      return;
    }

    let isCancelled: boolean = false;

    const run: () => void = (): void => {
      fetchSubscriberAudience(JSON.parse(requestKey) as JSONObject)
        .then((audience: IncidentSubscriberAudienceResult) => {
          if (!isCancelled) {
            setState({ key: requestKey, audience: audience, error: "" });
          }
        })
        .catch((err: unknown) => {
          if (!isCancelled) {
            setState({
              key: requestKey,
              audience: null,
              error: API.getFriendlyMessage(err),
            });
          }
        });
    };

    const timer: ReturnType<typeof setTimeout> | null = isDraft
      ? setTimeout(run, SUBSCRIBER_AUDIENCE_DEBOUNCE_MS)
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
  }, [requestKey]);

  if (!requestKey) {
    return { audience: null, isLoading: false, error: "" };
  }

  // Until the answer for this request arrives, the last one is stale.
  if (state.key !== requestKey) {
    return { audience: null, isLoading: true, error: "" };
  }

  return {
    audience: state.audience,
    isLoading: false,
    error: state.error,
  };
};

export default useSubscriberAudience;
