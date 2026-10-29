import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  AFFECTED_RESOURCE_SEARCH_ROUTE,
  AffectedResourceKind,
  AffectedResourceSearchResult,
  readAffectedResourceSearchResult,
} from "Common/Types/AffectedResources/AffectedResourceSearch";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Affected Resources picker's one search across every kind of resource
 * (issue #5341): POST /affected-resources/search, answered with each kind's
 * count and first matches, read with the person's own rights on the server
 * (AffectedResourceSearch). No React here, so App's tests can load it.
 */

export interface AffectedResourceSearchQuery {
  search: string;
  kinds: Array<AffectedResourceKind>;
  limitPerKind: number;
  countKinds?: Array<AffectedResourceKind> | undefined;
}

// The request body the route reads (readAffectedResourceSearchRequest).
export function toAffectedResourceSearchBody(
  query: AffectedResourceSearchQuery,
): JSONObject {
  return {
    search: query.search,
    kinds: [...query.kinds],
    limitPerKind: query.limitPerKind,
    countKinds: [...(query.countKinds || [])],
  };
}

/*
 * Throws when the request fails - the picker says so and keeps what it
 * showed - and reads a malformed answer as nothing found.
 */
export async function searchAffectedResources(
  query: AffectedResourceSearchQuery,
): Promise<AffectedResourceSearchResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        AFFECTED_RESOURCE_SEARCH_ROUTE,
      ),
      data: toAffectedResourceSearchBody(query),
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readAffectedResourceSearchResult(response.data);
}
