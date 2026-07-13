import TopologyGraph from "./TopologyGraph";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Self-contained LLDP network topology view: fetch + refresh + graph +
 * device navigation. Rendered from two entry points — the Network Devices
 * section (the network engineer's home) and the Topology page's Network
 * tab (the unified maps hub) — so the fetch/render logic lives here once.
 */

const EMPTY_TOPOLOGY: NetworkTopology = { nodes: [], edges: [] };

// Narrow an untyped API payload into a NetworkTopology, dropping malformed rows.
const parseTopologyResponse: (
  data: JSONObject | undefined,
) => NetworkTopology = (data: JSONObject | undefined): NetworkTopology => {
  const rawNodes: JSONArray = Array.isArray(data?.["nodes"])
    ? (data!["nodes"] as JSONArray)
    : [];
  const rawEdges: JSONArray = Array.isArray(data?.["edges"])
    ? (data!["edges"] as JSONArray)
    : [];

  const nodes: Array<NetworkTopologyNode> = rawNodes
    .map((row: unknown): NetworkTopologyNode | null => {
      const node: JSONObject = (row || {}) as JSONObject;
      if (!node["id"]) {
        return null;
      }
      return node as unknown as NetworkTopologyNode;
    })
    .filter((n: NetworkTopologyNode | null): n is NetworkTopologyNode => {
      return n !== null;
    });

  const edges: Array<NetworkTopologyEdge> = rawEdges
    .map((row: unknown): NetworkTopologyEdge | null => {
      const edge: JSONObject = (row || {}) as JSONObject;
      if (!edge["fromNodeId"] || !edge["toNodeId"]) {
        return null;
      }
      return edge as unknown as NetworkTopologyEdge;
    })
    .filter((e: NetworkTopologyEdge | null): e is NetworkTopologyEdge => {
      return e !== null;
    });

  return { nodes, edges };
};

const NetworkTopologyView: FunctionComponent = (): ReactElement => {
  const [topology, setTopology] = useState<NetworkTopology>(EMPTY_TOPOLOGY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchTopology: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
        "/network-device/topology",
      );

      /*
       * Project scoping is attached automatically via the tenantid header
       * that ModelAPI.getCommonHeaders() sets from the current project.
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: {
            projectId: ProjectUtil.getCurrentProjectId()?.toString(),
          },
          headers: { ...ModelAPI.getCommonHeaders() },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setTopology(parseTopologyResponse(response.data));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchTopology().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Network Topology"
      description="A live map of your network built from LLDP neighbor data. Managed devices are filled; unmanaged LLDP peers are hollow. Node color reflects status. Click a managed device to open it."
      buttons={[
        {
          title: "Refresh",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          onClick: () => {
            fetchTopology().catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          },
        },
      ]}
    >
      <TopologyGraph
        topology={topology}
        onManagedNodeClick={(node: NetworkTopologyNode) => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
              { modelId: new ObjectID(node.id) },
            ),
          );
        }}
        emptyStateFooter={
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICES] as Route,
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Set up network device monitoring
          </Link>
        }
      />
    </Card>
  );
};

export default NetworkTopologyView;
