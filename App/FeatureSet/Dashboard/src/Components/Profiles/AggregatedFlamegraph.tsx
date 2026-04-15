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
import FlamegraphView, { FlamegraphNode } from "./FlamegraphView";

export interface AggregatedFlamegraphProps {
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  unit?: string | undefined;
  compact?: boolean | undefined;
}

/**
 * Server shape returned by /telemetry/profiles/flamegraph. Matches
 * `ProfileFlamegraphNode` on the server.
 */
interface ServerNode {
  functionName: string;
  fileName: string;
  lineNumber: number;
  selfValue: number;
  totalValue: number;
  children: Array<ServerNode>;
  frameType: string;
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
  const [serverRoot, setServerRoot] = useState<ServerNode | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const unit: string =
    props.unit ||
    (props.profileType
      ? ProfileUtil.getProfileTypeUnit(props.profileType)
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
            profileType: props.profileType,
            profileTypes: ProfileUtil.getRawProfileTypesForCategory(
              props.profileType,
            ),
          },
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const root: ServerNode = response.data[
        "flamegraph"
      ] as unknown as ServerNode;
      setServerRoot(root);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return normalise(serverRoot);
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

  return <FlamegraphView root={root} unit={unit} compact={props.compact} />;
};

/**
 * Recursively convert the server's wire shape to the client's
 * FlamegraphNode, inferring the module category from the filename
 * (so color-by-module works identically to the single-profile view).
 */
function normalise(node: ServerNode | null): FlamegraphNode {
  if (!node) {
    return {
      name: "(all)",
      fileName: "",
      lineNumber: 0,
      frameType: "",
      category: "unknown",
      selfValue: 0,
      totalValue: 0,
      children: [],
    };
  }
  return {
    name: node.functionName || "(root)",
    fileName: node.fileName || "",
    lineNumber: node.lineNumber || 0,
    frameType: node.frameType || "",
    category: ProfileUtil.getModuleCategory(node.fileName || ""),
    selfValue: Number(node.selfValue || 0),
    totalValue: Number(node.totalValue || 0),
    children: (node.children || []).map(normalise),
  };
}

export default AggregatedFlamegraph;
