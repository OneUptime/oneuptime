import NetworkDeviceGraph from "./NetworkDeviceGraph";
import NetworkDeviceDetailPanel from "./NetworkDeviceDetailPanel";
import NetworkLinkDetailPanel from "./NetworkLinkDetailPanel";
import { edgeKeyForEdge } from "./NetworkTopologyMeta";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import { APP_API_URL } from "Common/UI/Config";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * Self-contained live network topology view: fetch + auto-refresh + search
 * + graph + node/link detail panels. Rendered from two entry points — the
 * Network Devices section (the network engineer's home) and the Topology
 * page's Network tab (the unified maps hub) — so the fetch/render logic
 * lives here once. The topology endpoint is polled every 60 seconds;
 * background refreshes swap data in place without a loader, and the
 * graph's internal pan/zoom state keeps the viewport where the user left
 * it.
 */

export interface ComponentProps {
  /*
   * Scope the topology to one network site's devices. Omitted, the whole
   * project's map is shown.
   */
  siteId?: string | undefined;
  /*
   * "tiered" renders routers → switches → endpoints in layers (the unit
   * site view); "force" (the default) keeps the organic layout.
   */
  layoutMode?: "force" | "tiered" | undefined;
}

/*
 * NetworkTopology plus the endpoint-loss indicators the topology endpoint
 * reports alongside the graph.
 */
interface TopologyViewData extends NetworkTopology {
  endpointsTruncated?: boolean | undefined;
  droppedEndpointCount?: number | undefined;
}

const EMPTY_TOPOLOGY: TopologyViewData = { nodes: [], edges: [] };

const REFRESH_INTERVAL_MS: number = 60 * 1000;

// Narrow an untyped API payload into a NetworkTopology, dropping malformed rows.
const parseTopologyResponse: (
  data: JSONObject | undefined,
) => TopologyViewData = (data: JSONObject | undefined): TopologyViewData => {
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

  const droppedEndpointCountRaw: unknown = data?.["droppedEndpointCount"];

  return {
    nodes,
    edges,
    isTruncated: Boolean(data?.["isTruncated"]),
    endpointsTruncated: Boolean(data?.["endpointsTruncated"]),
    droppedEndpointCount:
      typeof droppedEndpointCountRaw === "number" &&
      Number.isFinite(droppedEndpointCountRaw)
        ? droppedEndpointCountRaw
        : undefined,
  };
};

const NetworkTopologyLiveView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [topology, setTopology] = useState<TopologyViewData>(EMPTY_TOPOLOGY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);

  // A background poll must not clobber the view if the component is gone.
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchTopology: (isBackgroundRefresh: boolean) => Promise<void> =
    useCallback(
      async (isBackgroundRefresh: boolean): Promise<void> => {
        if (!isBackgroundRefresh) {
          setIsLoading(true);
          setError("");
        }

        try {
          const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
            "/network-device/topology",
          );

          /*
           * Project scoping is attached automatically via the tenantid header
           * that ModelAPI.getCommonHeaders() sets from the current project.
           */
          const requestBody: JSONObject = {
            projectId: ProjectUtil.getCurrentProjectId()?.toString(),
          };
          if (props.siteId) {
            // Scope the graph to one site's devices (plus their endpoints).
            requestBody["siteId"] = props.siteId;
          }

          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url,
              data: requestBody,
              headers: { ...ModelAPI.getCommonHeaders() },
            });

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          if (isMounted.current) {
            setTopology(parseTopologyResponse(response.data));
            setError("");
          }
        } catch (err) {
          /*
           * A failed background poll keeps showing the last good graph —
           * only a foreground load surfaces the error state.
           */
          if (isMounted.current && !isBackgroundRefresh) {
            setError(API.getFriendlyMessage(err));
          }
        }

        if (isMounted.current && !isBackgroundRefresh) {
          setIsLoading(false);
        }
      },
      [props.siteId],
    );

  useEffect(() => {
    fetchTopology(false).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });

    // Auto-refresh: the graph preserves its viewport across data swaps.
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchTopology(true).catch(() => {
        // Background refresh failures are non-fatal; keep the last graph.
      });
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [fetchTopology]);

  const nodeById: Map<string, NetworkTopologyNode> = useMemo(() => {
    const map: Map<string, NetworkTopologyNode> = new Map<
      string,
      NetworkTopologyNode
    >();
    for (const node of topology.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [topology]);

  /*
   * Selection stores stable keys, not objects — after a background refresh
   * the panels re-resolve against the fresh topology so their numbers are
   * live too. A node/link that disappeared closes its panel gracefully.
   */
  const selectedNode: NetworkTopologyNode | null =
    (selectedNodeId && nodeById.get(selectedNodeId)) || null;
  const selectedEdge: NetworkTopologyEdge | null = useMemo(() => {
    if (!selectedEdgeKey) {
      return null;
    }
    return (
      topology.edges.find((edge: NetworkTopologyEdge) => {
        return edgeKeyForEdge(edge) === selectedEdgeKey;
      }) || null
    );
  }, [topology, selectedEdgeKey]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Network Topology"
      description="A live map of your network built from LLDP and CDP neighbor data. Managed devices are filled; unmanaged peers are hollow; endpoints discovered from ARP/FDB are small violet squares on dashed links. Red links have an interface down, amber links are running hot. Click a device or link for details."
      buttons={[
        {
          title: "Refresh",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          onClick: () => {
            fetchTopology(false).catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          },
        },
      ]}
    >
      <div className="mb-3 flex flex-col md:flex-row md:items-center gap-3">
        <div className="md:w-72">
          <Input
            dataTestId="network-topology-search"
            placeholder={
              translateString("Search by name, sysName or vendor") ||
              "Search by name, sysName or vendor"
            }
            value={searchText}
            onChange={(value: string) => {
              setSearchText(value);
            }}
          />
        </div>
        <p className="text-xs text-gray-500 md:ml-auto">
          {translateString(
            "Updates automatically every minute. Link color shows state; width shows utilization.",
          ) ||
            "Updates automatically every minute. Link color shows state; width shows utilization."}
        </p>
      </div>

      {topology.isTruncated ? (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          {translateString(
            "This network is very large, so only part of it is shown. Use search to narrow it down.",
          ) ||
            "This network is very large, so only part of it is shown. Use search to narrow it down."}
        </div>
      ) : (
        <></>
      )}

      {topology.endpointsTruncated ? (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          {translateString("Endpoint list truncated — showing first 2000") ||
            "Endpoint list truncated — showing first 2000"}
        </div>
      ) : (
        <></>
      )}

      {topology.droppedEndpointCount && topology.droppedEndpointCount > 0 ? (
        <p className="mb-3 text-xs text-gray-500">
          {`${topology.droppedEndpointCount} ${
            topology.droppedEndpointCount === 1 ? "endpoint" : "endpoints"
          } not shown (no attached switch in view)`}
        </p>
      ) : (
        <></>
      )}

      <NetworkDeviceGraph
        topology={topology}
        searchText={searchText}
        layoutMode={props.layoutMode || "force"}
        onNodeClick={(node: NetworkTopologyNode) => {
          /*
           * Panels are exclusive — SideOver has no backdrop, so two would
           * stack on top of each other.
           */
          setSelectedEdgeKey(null);
          setSelectedNodeId(node.id);
        }}
        onEdgeClick={(edge: NetworkTopologyEdge) => {
          setSelectedNodeId(null);
          setSelectedEdgeKey(edgeKeyForEdge(edge));
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

      {selectedNode ? (
        <NetworkDeviceDetailPanel
          node={selectedNode}
          edges={topology.edges}
          nodeById={nodeById}
          onClose={() => {
            setSelectedNodeId(null);
          }}
          onSelectEdge={(edge: NetworkTopologyEdge) => {
            setSelectedNodeId(null);
            setSelectedEdgeKey(edgeKeyForEdge(edge));
          }}
        />
      ) : (
        <></>
      )}

      {selectedEdge ? (
        <NetworkLinkDetailPanel
          key={selectedEdgeKey}
          edge={selectedEdge}
          fromNode={nodeById.get(selectedEdge.fromNodeId)}
          toNode={nodeById.get(selectedEdge.toNodeId)}
          onClose={() => {
            setSelectedEdgeKey(null);
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default NetworkTopologyLiveView;
