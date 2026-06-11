import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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
import ObjectID from "Common/Types/ObjectID";
import ProfileUtil from "../../Utils/ProfileUtil";
import FlamegraphView, {
  FlamegraphNode,
  ServerFlamegraphNode,
  normaliseServerFlamegraphNode,
} from "./FlamegraphView";

export interface AggregatedFlamegraphProps {
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  unit?: string | undefined;
  compact?: boolean | undefined;
  /**
   * Controlled search term, forwarded to {@link FlamegraphView} so the
   * page can keep flame graph search in shareable state (e.g. the
   * URL). Leave undefined for fully internal search.
   */
  searchTerm?: string | undefined;
  /**
   * Forwarded to {@link FlamegraphView}; called on every search edit.
   */
  onSearchTermChange?: ((term: string) => void) | undefined;
  /**
   * Forwarded to {@link FlamegraphView}; enables the "Callers &
   * callees" affordance on the zoomed frame.
   */
  onFocusFunction?:
    | ((frame: { functionName: string; fileName: string }) => void)
    | undefined;
}

/**
 * Fetches an aggregated flame graph for a service + time window from
 * the server and renders it via {@link FlamegraphView}. This is what
 * the home page uses to answer "where is my CPU going right now?"
 * across all recent profiles.
 */
const AggregatedFlamegraph: FunctionComponent<AggregatedFlamegraphProps> = (
  props: AggregatedFlamegraphProps,
): ReactElement => {
  const [serverRoot, setServerRoot] = useState<ServerFlamegraphNode | null>(
    null,
  );
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * The selector pill stores either a category (e.g. "cpu") or a raw
   * type — expand it to the raw type strings agents actually emit so
   * the server filters with IN (...) instead of a literal equality
   * that would miss rows.
   */
  const queryProfileTypes: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(props.profileType);

  const unit: string =
    props.unit ||
    (queryProfileTypes && queryProfileTypes.length > 0
      ? ProfileUtil.getProfileTypeUnit(queryProfileTypes[0]!)
      : "nanoseconds");

  const load: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/flamegraph",
          ),
          data: {
            startTime: props.startTime.toISOString(),
            endTime: props.endTime.toISOString(),
            serviceIds: props.serviceIds?.map((id: ObjectID) => {
              return id.toString();
            }),
            profileTypes: queryProfileTypes,
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const root: ServerFlamegraphNode = response.data[
        "flamegraph"
      ] as unknown as ServerFlamegraphNode;
      setServerRoot(root);
      setIsTruncated(Boolean(response.data["truncated"]));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [
    props.startTime.getTime(),
    props.endTime.getTime(),
    props.profileType,
    // serviceIds intentionally re-joined to compare by value
    (props.serviceIds || [])
      .map((i: ObjectID) => {
        return i.toString();
      })
      .join(","),
  ]);

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
          void load();
        }}
      />
    );
  }

  return (
    <FlamegraphView
      root={root}
      unit={unit}
      compact={props.compact}
      truncated={isTruncated}
      searchTerm={props.searchTerm}
      onSearchTermChange={props.onSearchTermChange}
      onFocusFunction={props.onFocusFunction}
    />
  );
};

export default AggregatedFlamegraph;
