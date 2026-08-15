import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import FlamegraphView, {
  FlamegraphNode,
  ServerFlamegraphNode,
  normaliseServerFlamegraphNode,
} from "../Profiles/FlamegraphView";
import { buildTraceFlamegraphRequest } from "../../Utils/TraceCorrelatedSignals";

export interface TraceScopedFlamegraphProps {
  traceId: string;
  /** Narrow the flame graph to these spans' samples (e.g. one span). */
  spanIds?: Array<string> | undefined;
}

/**
 * Flame graph for the profile samples attached to one trace (optionally
 * narrowed to specific spans) via POST /telemetry/profiles/flamegraph with
 * { traceId, spanIds? }. No profile-type filter is applied so the graph
 * covers exactly the samples the trace-presence gate counted; sample values
 * are nanoseconds for every duration-typed profiler, matching
 * ProfileFlamegraph's default unit.
 */
const TraceScopedFlamegraph: FunctionComponent<TraceScopedFlamegraphProps> = (
  props: TraceScopedFlamegraphProps,
): ReactElement => {
  const [serverRoot, setServerRoot] = useState<ServerFlamegraphNode | null>(
    null,
  );
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Generation counter guards every fetch — including manual retries — so a
   * slow stale response can never overwrite a newer one (same pattern as
   * ProfileFlamegraph).
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const spanIdsKey: string = (props.spanIds || []).join(",");

  const load: (generation: number) => Promise<void> = async (
    generation: number,
  ): Promise<void> => {
    const requestBody: JSONObject | null = buildTraceFlamegraphRequest({
      traceId: props.traceId,
      spanIds: props.spanIds,
    });

    if (!requestBody) {
      setServerRoot(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/flamegraph",
          ),
          data: requestBody,
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (generation !== loadGenerationRef.current) {
        return;
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const root: ServerFlamegraphNode = response.data[
        "flamegraph"
      ] as unknown as ServerFlamegraphNode;
      setServerRoot(root);
      setIsTruncated(Boolean(response.data["truncated"]));
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);
    return () => {
      // Invalidate in-flight responses when scope changes or we unmount.
      loadGenerationRef.current += 1;
    };
  }, [props.traceId, spanIdsKey]);

  const root: FlamegraphNode = useMemo(() => {
    return normaliseServerFlamegraphNode(serverRoot);
  }, [serverRoot]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          loadGenerationRef.current += 1;
          void load(loadGenerationRef.current);
        }}
      />
    );
  }

  return (
    <FlamegraphView root={root} unit="nanoseconds" truncated={isTruncated} />
  );
};

export default TraceScopedFlamegraph;
