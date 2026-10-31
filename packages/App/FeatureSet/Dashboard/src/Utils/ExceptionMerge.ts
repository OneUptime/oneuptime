import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  ExceptionOfFingerprint,
  readExceptionsOfFingerprints,
} from "Common/Types/Telemetry/ExceptionFingerprintLookup";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  EXCEPTION_FINGERPRINT_LOOKUP_ROUTE,
  buildExceptionFingerprintLookupRequest,
} from "./ExceptionCorrelation";

/*
 * MERGING AN EXCEPTION INTO ANOTHER AS THE SAME BUG, FROM THE DASHBOARD.
 *
 * The server does the work (TelemetryExceptionMerge): counts move, the
 * merged exception leaves the lists, and its fingerprint becomes an alias
 * of the one it was merged into. These are the two requests, what an
 * exception's page reads of the exceptions merged into it, and the lookup
 * that takes a fingerprint of occurrences - a merged exception's included -
 * to the exception it counts on.
 */

export const MERGE_ROUTE_PREFIX: string = "/telemetry-exception/merge";
export const UNMERGE_ROUTE_PREFIX: string = "/telemetry-exception/unmerge";

// What an exception's page reads of the exceptions merged into it.
export const MERGED_EXCEPTION_SELECT: {
  _id: true;
  fingerprint: true;
  exceptionType: true;
  message: true;
  occuranceCount: true;
  mergedAt: true;
} = {
  _id: true,
  fingerprint: true,
  exceptionType: true,
  message: true,
  occuranceCount: true,
  mergedAt: true,
};

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as JSONObject;
}

// Merge `mergedId` into `survivorId`.
export async function mergeExceptionInto(data: {
  survivorId: string;
  mergedId: string;
}): Promise<JSONObject> {
  return post(`${MERGE_ROUTE_PREFIX}/${data.survivorId}`, {
    mergedTelemetryExceptionIds: [data.mergedId],
  });
}

// Give a merged exception back its own place in the lists.
export async function unmergeException(id: string): Promise<JSONObject> {
  return post(`${UNMERGE_ROUTE_PREFIX}/${id}`, {});
}

/*
 * The exception each of these fingerprints of occurrences counts on: its
 * own, or the one it was merged into, as the viewer may read them. One
 * request for the batch; none for a batch with nothing to ask about.
 */
export async function findExceptionsOfFingerprints(
  fingerprints: ReadonlyArray<string>,
): Promise<Array<ExceptionOfFingerprint>> {
  const request: JSONObject | null =
    buildExceptionFingerprintLookupRequest(fingerprints);

  if (!request) {
    return [];
  }

  return readExceptionsOfFingerprints(
    await post(EXCEPTION_FINGERPRINT_LOOKUP_ROUTE, request),
  );
}
