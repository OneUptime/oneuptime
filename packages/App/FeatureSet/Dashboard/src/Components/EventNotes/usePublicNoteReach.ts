import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteReach, {
  PublicNoteReachResult,
} from "Common/Types/StatusPage/PublicNoteReach";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Whether a public note posted now on an event is on a status page, and
 * whether it notifies anyone (Common/Types/StatusPage/PublicNoteReach), from
 * POST /<event>/public-note-reach: what the note composer says beside
 * "Public" and under "Notify status page subscribers"
 * (PublicNoteReachCopy).
 *
 * Asked once per event. An answer for an event the page has left is
 * dropped, and the answer is handed out only for the event it is for, so
 * moving to another incident reads as "not known yet" from its very first
 * render. Not known - while it is asked, or when it could not be answered -
 * the composer promises nothing; the answer is advisory, and never stops a
 * note from being written.
 */

export interface PublicNoteReachRequest {
  // The event's API path: "/incident", "/incident-episode", "/scheduled-maintenance".
  apiPath: string;
  eventId: ObjectID | string;
}

export interface PublicNoteReachState {
  // Null while it is not known.
  reach: PublicNoteReachResult | null;
  isLoading: boolean;
  error: string;
}

export const NO_PUBLIC_NOTE_REACH: PublicNoteReachState = {
  reach: null,
  isLoading: false,
  error: "",
};

/*
 * The route is written out rather than read from PublicNoteReach.routePath
 * so the tenant-header sweep (App/Tests/Dashboard/
 * ProjectScopedApiTenantHeader.test.ts) can see which route this call
 * reaches; a test pins the two together. The tenant header is what tells
 * the server which project the answer is for.
 */
export const fetchPublicNoteReach: (
  request: PublicNoteReachRequest,
) => Promise<PublicNoteReachResult> = async (
  request: PublicNoteReachRequest,
): Promise<PublicNoteReachResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `${request.apiPath}/public-note-reach`,
      ),
      data: {
        eventId: request.eventId.toString(),
      },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const reach: PublicNoteReachResult | null = PublicNoteReach.fromJSON(
    response.data,
  );

  if (!reach) {
    throw new Error(
      "The answer about where this note is shown could not be read.",
    );
  }

  return reach;
};

// The request's key: which event, through which API. Empty for none.
export const getPublicNoteReachRequestKey: (
  request: PublicNoteReachRequest | null | undefined,
) => string = (request: PublicNoteReachRequest | null | undefined): string => {
  if (!request) {
    return "";
  }

  const eventId: string = request.eventId.toString().trim();

  if (!request.apiPath || !eventId) {
    return "";
  }

  return `${request.apiPath} ${eventId.toLowerCase()}`;
};

/*
 * The answer for `request`; null asks nothing (a private note, or a reader
 * who may write none), and says nothing.
 */
export default function usePublicNoteReach(
  request: PublicNoteReachRequest | null | undefined,
): PublicNoteReachState {
  const requestKey: string = getPublicNoteReachRequestKey(request);

  const [answer, setAnswer] = useState<{
    key: string;
    reach: PublicNoteReachResult | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!requestKey || !request) {
      return;
    }

    let isStale: boolean = false;

    fetchPublicNoteReach(request)
      .then((reach: PublicNoteReachResult) => {
        if (!isStale) {
          setAnswer({ key: requestKey, reach: reach, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (!isStale) {
          setAnswer({
            key: requestKey,
            reach: null,
            error: API.getFriendlyMessage(err),
          });
        }
      });

    return () => {
      isStale = true;
    };
  }, [requestKey]);

  if (!requestKey) {
    return NO_PUBLIC_NOTE_REACH;
  }

  // Until this event's answer arrives, the last one is another event's.
  if (!answer || answer.key !== requestKey) {
    return { reach: null, isLoading: true, error: "" };
  }

  return {
    reach: answer.reach,
    isLoading: false,
    error: answer.error,
  };
}
