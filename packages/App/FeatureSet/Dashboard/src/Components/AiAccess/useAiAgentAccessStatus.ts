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
 */
export interface AiAgentAccessStatusRead<TStatus> {
  status: TStatus | null;
  isLoading: boolean;
}

export default function useAiAgentAccessStatus<TStatus>(data: {
  route: string;
  body: JSONObject;
  // The status the route answered, or null when the body is not one.
  parse: (value: unknown) => TStatus | null;
  refreshToken?: number | undefined;
}): AiAgentAccessStatusRead<TStatus> {
  const [status, setStatus] = useState<TStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Which resource the status on screen belongs to.
  const statusKeyRef: MutableRefObject<string> = useRef<string>("");
  const key: string = `${data.route}:${JSON.stringify(data.body)}`;

  useEffect(() => {
    let isMounted: boolean = true;

    // Another resource: its status is not this one's.
    if (statusKeyRef.current !== key) {
      statusKeyRef.current = key;
      setStatus(null);
      setIsLoading(true);
    }

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(data.route),
            data: data.body,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (isMounted && !(response instanceof HTTPErrorResponse)) {
          const parsed: TStatus | null = data.parse(response.data);

          if (parsed) {
            setStatus(parsed);
          }
        }
      } catch {
        // The card says the status could not be loaded; the page goes on.
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, [key, data.refreshToken]);

  return { status, isLoading };
}
