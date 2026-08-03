import NetworkDeviceGraph from "./NetworkDeviceGraph";
import NetworkDeviceDetailPanel from "./NetworkDeviceDetailPanel";
import NetworkLinkDetailPanel from "./NetworkLinkDetailPanel";
import { edgeKeyForEdge } from "./NetworkTopologyMeta";
import {
  ALL_NODE_KINDS,
  TopologyNodeKind,
  kindOfNode,
} from "./NetworkTopologyViewModel";
import {
  PositionOverrides,
  TopologyLayoutMode,
  TopologyOverrideStorage,
  positionOverridesStorageKey,
  prunePositionOverrides,
  readPersistedOverrides,
  writePersistedOverrides,
} from "./TopologyPositionOverrides";
import { isEndpointNode } from "../NetworkDevice/EndpointNodeUtil";
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
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
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
   * The layout the view opens on. The user can switch between force,
   * tiered and radial from the toolbar afterwards.
   */
  layoutMode?: TopologyLayoutMode | undefined;
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

// Sentinel for the VLAN filter's default "show everything" option.
const ALL_VLANS: string = "all";

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
  const [selectedVlan, setSelectedVlan] = useState<string>(ALL_VLANS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<TopologyLayoutMode>(
    props.layoutMode || "force",
  );
  const [visibleKinds, setVisibleKinds] =
    useState<ReadonlySet<TopologyNodeKind> | null>(null);
  /*
   * Node positions the user established by dragging. Owned here rather
   * than in the graph so they survive the graph remounting, and — more
   * importantly — so pruning runs against the UNFILTERED node set.
   * Pruning against the VLAN-filtered set would throw away the
   * arrangement of every endpoint outside the selected VLAN the moment
   * somebody touched the dropdown.
   */
  const [positionOverrides, setPositionOverrides] = useState<PositionOverrides>(
    new Map(),
  );

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

  /*
   * VLAN filter options: the distinct VLANs the current payload's endpoint
   * nodes carry, plus the "All VLANs" default. Device and unmanaged nodes
   * never contribute — only discovered endpoints know their VLAN.
   */
  const vlanOptions: Array<DropdownOption> = useMemo(() => {
    const vlanIds: Set<number> = new Set<number>();
    for (const node of topology.nodes) {
      if (isEndpointNode(node) && typeof node.vlanId === "number") {
        vlanIds.add(node.vlanId);
      }
    }
    const sorted: Array<number> = Array.from(vlanIds).sort(
      (a: number, b: number) => {
        return a - b;
      },
    );
    return [
      {
        value: ALL_VLANS,
        label: translateString("All VLANs") || "All VLANs",
      },
      ...sorted.map((vlanId: number): DropdownOption => {
        return { value: vlanId.toString(), label: `VLAN ${vlanId}` };
      }),
    ];
  }, [topology, translateString]);

  /*
   * If the selected VLAN disappears from a refresh (its endpoints aged
   * out), fall back to All VLANs — otherwise the filter would keep hiding
   * every endpoint while the dropdown claims "All VLANs", with no way to
   * clear it once the dropdown unmounts.
   */
  useEffect(() => {
    if (
      selectedVlan !== ALL_VLANS &&
      !vlanOptions.some((option: DropdownOption) => {
        return option.value === selectedVlan;
      })
    ) {
      setSelectedVlan(ALL_VLANS);
    }
  }, [vlanOptions, selectedVlan]);

  /*
   * The topology the graph and panels actually see. A selected VLAN hides
   * endpoint nodes outside it (including endpoints with no known VLAN) and
   * the FDB edges that hang off them; device and unmanaged nodes are never
   * hidden, so the physical fabric stays visible for context.
   */
  const visibleTopology: TopologyViewData = useMemo(() => {
    if (selectedVlan === ALL_VLANS) {
      return topology;
    }
    const selectedVlanId: number = Number(selectedVlan);
    const hiddenNodeIds: Set<string> = new Set<string>();
    for (const node of topology.nodes) {
      if (isEndpointNode(node) && node.vlanId !== selectedVlanId) {
        hiddenNodeIds.add(node.id);
      }
    }
    if (hiddenNodeIds.size === 0) {
      return topology;
    }
    return {
      ...topology,
      nodes: topology.nodes.filter((node: NetworkTopologyNode) => {
        return !hiddenNodeIds.has(node.id);
      }),
      edges: topology.edges.filter((edge: NetworkTopologyEdge) => {
        return (
          !hiddenNodeIds.has(edge.fromNodeId) &&
          !hiddenNodeIds.has(edge.toNodeId)
        );
      }),
    };
  }, [topology, selectedVlan]);

  const nodeById: Map<string, NetworkTopologyNode> = useMemo(() => {
    const map: Map<string, NetworkTopologyNode> = new Map<
      string,
      NetworkTopologyNode
    >();
    for (const node of visibleTopology.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [visibleTopology]);

  /*
   * Which node kinds exist in this payload at all. The kind filters only
   * offer what is actually there — a checkbox for "endpoints" on a
   * network that has none is noise.
   */
  const availableKinds: Set<TopologyNodeKind> = useMemo(() => {
    const kinds: Set<TopologyNodeKind> = new Set<TopologyNodeKind>();
    for (const node of topology.nodes) {
      kinds.add(kindOfNode(node));
    }
    return kinds;
  }, [topology]);

  const effectiveVisibleKinds: ReadonlySet<TopologyNodeKind> =
    visibleKinds || ALL_NODE_KINDS;

  /*
   * ------------------------------------------------------------------
   * Saved arrangements
   * ------------------------------------------------------------------
   */

  const overrideStorage: TopologyOverrideStorage | null = useMemo(() => {
    /*
     * Feature-detected rather than assumed: Safari in private mode throws
     * on access, and the module is written to work with no storage at all
     * so a saved arrangement is a bonus rather than a dependency.
     */
    try {
      return typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null;
    } catch {
      return null;
    }
  }, []);

  const overridesStorageKey: string = useMemo(() => {
    return positionOverridesStorageKey(
      ProjectUtil.getCurrentProjectId()?.toString() || "",
      props.siteId,
      layoutMode,
    );
  }, [props.siteId, layoutMode]);

  /*
   * Load the saved arrangement for this (project, site, layout mode).
   * Each layout is its own coordinate system, so switching modes loads a
   * different arrangement rather than reinterpreting the current one.
   */
  useEffect(() => {
    setPositionOverrides(
      readPersistedOverrides(overrideStorage, overridesStorageKey),
    );
  }, [overrideStorage, overridesStorageKey]);

  /*
   * The latest arrangement and the key it belongs to, so a write can be
   * flushed from a cleanup — which runs after `positionOverrides` has
   * already moved on — without the flush itself depending on them.
   */
  const pendingWrite: React.MutableRefObject<{
    key: string;
    overrides: PositionOverrides;
  }> = useRef<{ key: string; overrides: PositionOverrides }>({
    key: overridesStorageKey,
    overrides: positionOverrides,
  });
  pendingWrite.current = {
    key: overridesStorageKey,
    overrides: positionOverrides,
  };

  // Persist, debounced, so a drag does not write on every commit.
  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      writePersistedOverrides(
        overrideStorage,
        overridesStorageKey,
        positionOverrides,
      );
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [overrideStorage, overridesStorageKey, positionOverrides]);

  /*
   * Flush a pending write when the key changes or the view goes away.
   * Without this, a drag committed inside the 500ms debounce window is
   * simply lost if the user then switches layout mode or navigates — and
   * "I moved it and it did not save" is the whole feature failing.
   *
   * Deliberately NOT folded into the debounce effect above: that one
   * depends on `positionOverrides`, so its cleanup fires on every commit
   * and would write on each one, defeating the debounce. This effect's
   * cleanup runs only on a key change or unmount, and because cleanups
   * run before any effect body, the ref still holds the OLD key at that
   * moment — which is the key the pending arrangement belongs to.
   */
  useEffect(() => {
    return () => {
      writePersistedOverrides(
        overrideStorage,
        pendingWrite.current.key,
        pendingWrite.current.overrides,
      );
    };
  }, [overrideStorage, overridesStorageKey]);

  /*
   * Forget positions for devices that have left the topology. Runs
   * against the unfiltered node set, and returns the same map instance
   * when nothing was dropped so the sixty-second poll does not re-render
   * the graph for no reason.
   */
  useEffect(() => {
    /*
     * Nothing has been fetched yet, so EVERY id would look stale. Without
     * this guard the mount flush prunes the just-loaded arrangement down
     * to nothing — React applies the load effect's value first and this
     * updater second — and the debounced write then DELETES the stored
     * entry half a second later. Dragging would never survive a reload.
     */
    if (topology.nodes.length === 0) {
      return;
    }
    const liveNodeIds: Set<string> = new Set<string>(
      topology.nodes.map((node: NetworkTopologyNode) => {
        return node.id;
      }),
    );
    setPositionOverrides((current: PositionOverrides): PositionOverrides => {
      return prunePositionOverrides(current, liveNodeIds);
    });
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
      visibleTopology.edges.find((edge: NetworkTopologyEdge) => {
        return edgeKeyForEdge(edge) === selectedEdgeKey;
      }) || null
    );
  }, [visibleTopology, selectedEdgeKey]);

  /*
   * Only replace the whole card while there is genuinely nothing to show.
   * Unmounting the graph to display a loader throws away the viewport the
   * user framed and the fullscreen state, so hitting Refresh after zooming
   * into a rack used to snap the map back to fit-all; and swapping in an
   * error message removed the Refresh button along with the map, leaving
   * no way back until the next poll succeeded.
   */
  if (isLoading && topology.nodes.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (error && topology.nodes.length === 0) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Network Topology"
      description="A live map of your network built from LLDP and CDP neighbor data. Drag any device to arrange the map the way you think about it — your arrangement is saved for this site. Click a device or link for details."
      rightElement={
        <div
          role="group"
          aria-label={translateString("Topology layout") || "Topology layout"}
          className="inline-flex flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
        >
          {(
            [
              { mode: "force", label: "Force" },
              { mode: "tiered", label: "Tiered" },
              { mode: "radial", label: "Radial" },
            ] as Array<{ mode: TopologyLayoutMode; label: string }>
          ).map(
            (option: {
              mode: TopologyLayoutMode;
              label: string;
            }): ReactElement => {
              const isActive: boolean = layoutMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  title={`${option.label} layout`}
                  aria-pressed={isActive}
                  data-testid={`network-topology-layout-mode-${option.mode}`}
                  /*
                   * The ring is load-bearing in dark mode: the raised pill
                   * is DARKER than the track behind it there, so without
                   * an outline the selected option all but disappears.
                   */
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                  onClick={() => {
                    setLayoutMode(option.mode);
                  }}
                >
                  {translateString(option.label) || option.label}
                </button>
              );
            },
          )}
        </div>
      }
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
        {vlanOptions.length > 1 ? (
          <div className="md:w-48" data-testid="network-topology-vlan-filter">
            <Dropdown
              value={
                vlanOptions.find((option: DropdownOption) => {
                  return option.value === selectedVlan;
                }) || vlanOptions[0]
              }
              options={vlanOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setSelectedVlan(value ? value.toString() : ALL_VLANS);
              }}
            />
          </div>
        ) : (
          <></>
        )}
        {/*
         * Node-kind filters. The endpoint fan is what turns a busy site
         * into a hairball, and until now the only way to hide it was a
         * VLAN filter that exists only when endpoints happen to carry
         * VLAN ids.
         */}
        <div
          role="group"
          aria-label={translateString("Node types") || "Node types"}
          className="inline-flex flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
        >
          {(
            [
              { kind: "device", label: "Devices" },
              { kind: "unmanaged", label: "Peers" },
              { kind: "endpoint", label: "Endpoints" },
            ] as Array<{ kind: TopologyNodeKind; label: string }>
          )
            .filter((option: { kind: TopologyNodeKind; label: string }) => {
              return availableKinds.has(option.kind);
            })
            .map(
              (option: {
                kind: TopologyNodeKind;
                label: string;
              }): ReactElement => {
                const isActive: boolean = effectiveVisibleKinds.has(
                  option.kind,
                );
                return (
                  <button
                    key={option.kind}
                    type="button"
                    title={option.label}
                    aria-pressed={isActive}
                    data-testid={`network-topology-kind-filter-${option.kind}`}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                        : "text-gray-500 hover:text-gray-800"
                    }`}
                    onClick={() => {
                      setVisibleKinds(
                        (
                          current: ReadonlySet<TopologyNodeKind> | null,
                        ): ReadonlySet<TopologyNodeKind> => {
                          const next: Set<TopologyNodeKind> =
                            new Set<TopologyNodeKind>(
                              current || ALL_NODE_KINDS,
                            );
                          if (next.has(option.kind)) {
                            next.delete(option.kind);
                          } else {
                            next.add(option.kind);
                          }
                          return next;
                        },
                      );
                    }}
                  >
                    {translateString(option.label) || option.label}
                  </button>
                );
              },
            )}
        </div>
        <p className="text-xs text-gray-500 md:ml-auto">
          {translateString(
            "Drag a device to arrange the map — your layout is saved. Updates automatically every minute.",
          ) ||
            "Drag a device to arrange the map — your layout is saved. Updates automatically every minute."}
        </p>
      </div>

      {error ? (
        <div
          className="mb-3 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800"
          data-testid="network-topology-refresh-error"
        >
          {`${error} — showing the last map that loaded.`}
        </div>
      ) : (
        <></>
      )}

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
        topology={visibleTopology}
        searchText={searchText}
        layoutMode={layoutMode}
        visibleKinds={effectiveVisibleKinds}
        positionOverrides={positionOverrides}
        onPositionOverridesChange={setPositionOverrides}
        selectedNodeId={selectedNodeId}
        selectedEdgeKey={selectedEdgeKey}
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
          edges={visibleTopology.edges}
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
