import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * A resource's AI access status, read for the Overview's "AI agent" card
 * from the route its AI agent page reads — /kubernetes-cluster/ai-access/
 * status for a cluster, /resource-ai-access/status for everything else.
 * Both only need read access to the resource, which whoever sees its
 * Overview has.
 *
 * Read once per resource, and again whenever refreshToken changes (the
 * Overview's own refresh). The card is supplementary: a refused, failed or
 * unreadable answer leaves status null on a first read — the card says it
 * could not load it — and keeps the last good status on a refresh, never an
 * error.
 *
 * isEnabled false reads nothing: a card handed the read its Overview
 * already made (the cluster Overview shows the status twice, and reads it
 * once for both).
 */
export interface AiAgentAccessStatusRead<TStatus> {
  status: TStatus | null;
  isLoading: boolean;
}

/*
 * Whether a change of the Overview's refresh signal is a refresh to read
 * again for. The Overviews stamp their signal when a load finishes, the
 * first one included: the signal going from none to one is the page's own
 * first load ending, which the read made when the card opened already
 * covers. Every change after that is a refresh.
 */
export function isAiAgentStatusRefresh(data: {
  previousToken: number | undefined;
  token: number | undefined;
}): boolean {
  if (data.previousToken === data.token) {
    return false;
  }

  return data.previousToken !== undefined;
}

interface StatusRead {
  key: string;
  token: number | undefined;
}

export default function useAiAgentAccessStatus<TStatus>(data: {
  route: string;
  body: JSONObject;
  // The status the route answered, or null when the body is not one.
  parse: (value: unknown) => TStatus | null;
  refreshToken?: number | undefined;
  isEnabled?: boolean | undefined;
}): AiAgentAccessStatusRead<TStatus> {
  const [status, setStatus] = useState<TStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // The resource and refresh signal the last read was made for.
  const lastReadRef: MutableRefObject<StatusRead | null> =
    useRef<StatusRead | null>(null);
  // Only the latest read may change what the card shows.
  const latestReadIdRef: MutableRefObject<number> = useRef<number>(0);
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const key: string = `${data.route}:${JSON.stringify(data.body)}`;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isEnabled: boolean = data.isEnabled !== false;

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const previous: StatusRead | null = lastReadRef.current;
    const isAnotherResource: boolean = !previous || previous.key !== key;

    lastReadRef.current = { key, token: data.refreshToken };

    if (
      !isAnotherResource &&
      !isAiAgentStatusRefresh({
        previousToken: previous?.token,
        token: data.refreshToken,
      })
    ) {
      return;
    }

    // Another resource: its status is not this one's.
    if (isAnotherResource) {
      setStatus(null);
      setIsLoading(true);
    }

    latestReadIdRef.current += 1;
    const readId: number = latestReadIdRef.current;

    const isCurrent: () => boolean = (): boolean => {
      return isMountedRef.current && latestReadIdRef.current === readId;
    };

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(data.route),
            data: data.body,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (isCurrent() && !(response instanceof HTTPErrorResponse)) {
          const parsed: TStatus | null = data.parse(response.data);

          if (parsed) {
            setStatus(parsed);
          }
        }
      } catch {
        // The card says the status could not be loaded; the page goes on.
      }

      if (isCurrent()) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // handled inside load
    });
  }, [key, data.refreshToken, isEnabled]);

  return { status, isLoading };
}
