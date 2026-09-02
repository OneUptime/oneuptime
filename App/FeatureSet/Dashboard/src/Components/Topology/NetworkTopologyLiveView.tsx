import NetworkDeviceGraph from "./NetworkDeviceGraph";
import NetworkDeviceDetailPanel from "./NetworkDeviceDetailPanel";
import AddNeighborToMonitoringModal from "./AddNeighborToMonitoringModal";
import { isAdoptableNode } from "./AdoptNeighborUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import NetworkLinkDetailPanel from "./NetworkLinkDetailPanel";
import { edgeKeyForEdge } from "./NetworkTopologyMeta";
import {
  ALL_NODE_KINDS,
  TopologyNodeKind,
  kindOfNode,
} from "./NetworkTopologyViewModel";
import StatusChipGroup, { StatusChipOption } from "../Filters/StatusChipGroup";
import {
  TopologyHealthFilterMode,
  TopologyHealthSummary,
  buildHealthFilterOptions,
  healthCountForMode,
  isHealthFilterActive,
  summarizeTopologyHealth,
} from "./TopologyHealthFilter";
import {
  ArrangementPersistence,
  PositionOverrides,
  TopologyLayoutMode,
  TopologyOverrideStorage,
  createArrangementPersistence,
  positionOverridesStorageKey,
  prunePositionOverrides,
} from "./TopologyPositionOverrides";
import { isEndpointNode } from "../NetworkDevice/EndpointNodeUtil";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  TopologyLinkRuleWarning,
  TopologyLinkRuleWarningSite,
  describeSiteListToggle,
  describeWarningSite,
  hiddenSiteCount,
  parseLinkRuleWarnings,
} from "./LinkRuleWarningUtil";
import {
  TopologyUplinkWarning,
  parseUplinkWarnings,
} from "./UplinkWarningUtil";
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
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import NetworkTopologySuppression from "Common/Models/DatabaseModels/NetworkTopologySuppression";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
   * tiered, radial, star and parent-child from the toolbar afterwards.
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
  // Nodes the project has hidden; drives the "N hidden — show them" note.
  suppressedNodeCount?: number | undefined;
  /*
   * Link rules with something to explain, at most one line each: a rule that
   * drew nothing at all, or a site-scoped one that drew in some sites and
   * could not in others. Not "rules that resolved to nothing" — a site-scoped
   * rule can draw thirteen sites' uplinks and still owe an account of the
   * fourteenth.
   */
  linkRuleWarnings?: Array<TopologyLinkRuleWarning> | undefined;
  /*
   * Ping-monitored devices that endpoint inference could not place, grouped
   * by cause — at most one line each. Every cause here is something the
   * operator can fix, and without them a device left floating is
   * indistinguishable from one that is genuinely unplugged.
   */
  uplinkInferenceWarnings?: Array<TopologyUplinkWarning> | undefined;
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
  const suppressedNodeCountRaw: unknown = data?.["suppressedNodeCount"];

  const linkRuleWarnings: Array<TopologyLinkRuleWarning> =
    parseLinkRuleWarnings(data?.["linkRuleWarnings"]);

  const uplinkInferenceWarnings: Array<TopologyUplinkWarning> =
    parseUplinkWarnings(data?.["uplinkInferenceWarnings"]);

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
    suppressedNodeCount:
      typeof suppressedNodeCountRaw === "number" &&
      Number.isFinite(suppressedNodeCountRaw)
        ? suppressedNodeCountRaw
        : undefined,
    linkRuleWarnings: linkRuleWarnings,
    uplinkInferenceWarnings: uplinkInferenceWarnings,
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
  const [suppressionError, setSuppressionError] = useState<string>("");
  /*
   * The unmanaged neighbour the "Add to Monitoring" dialog is open for.
   * Held as the node rather than as a boolean so the dialog is mounted only
   * once it has something to pre-fill from — its form reads its initial
   * values exactly once, on the render in which it first appears.
   */
  const [nodeToAdopt, setNodeToAdopt] = useState<NetworkTopologyNode | null>(
    null,
  );
  const [layoutMode, setLayoutMode] = useState<TopologyLayoutMode>(
    props.layoutMode || "force",
  );
  const [visibleKinds, setVisibleKinds] =
    useState<ReadonlySet<TopologyNodeKind> | null>(null);
  /*
   * Issue #3261: which health states the map is narrowed to. Opens on
   * "all" — a map that hid two thirds of the network before anybody asked
   * it to would be a different feature.
   */
  const [healthFilterMode, setHealthFilterMode] =
    useState<TopologyHealthFilterMode>("all");
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
   * Hiding and restoring nodes. Both refetch rather than mutating local
   * state: suppression is a project-wide fact resolved server-side, and
   * guessing at the result here would show this user a map nobody else has.
   */
  const hideNode: (node: NetworkTopologyNode) => void = useCallback(
    (node: NetworkTopologyNode): void => {
      const suppression: NetworkTopologySuppression =
        new NetworkTopologySuppression();
      suppression.projectId = ProjectUtil.getCurrentProjectId()!;
      suppression.nodeKey = node.id;
      suppression.nodeName = node.name;

      setSuppressionError("");
      setSelectedNodeId(null);

      ModelAPI.create<NetworkTopologySuppression>({
        model: suppression,
        modelType: NetworkTopologySuppression,
      })
        .then(() => {
          return fetchTopology(true);
        })
        .catch((err: Error) => {
          setSuppressionError(API.getFriendlyMessage(err));
        });
    },
    [fetchTopology],
  );

  /*
   * Whether this user may create a device at all. Checked here rather than
   * inside the panel so the action is simply absent for a viewer, instead of
   * opening a form that renders as a permission error — and hidden, not
   * disabled, when the gate has nothing honest to say (the permission
   * snapshot lands on a response header, so it is empty for the first paint
   * after a login or a project switch).
   */
  const canCreateDevice: boolean = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Create,
  ).isAllowed;

  const restoreAllHiddenNodes: () => void = useCallback((): void => {
    setSuppressionError("");

    ModelAPI.getList<NetworkTopologySuppression>({
      modelType: NetworkTopologySuppression,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { _id: true },
      sort: {},
    })
      .then(async (result: ListResult<NetworkTopologySuppression>) => {
        for (const row of result.data) {
          if (!row.id) {
            continue;
          }
          await ModelAPI.deleteItem<NetworkTopologySuppression>({
            modelType: NetworkTopologySuppression,
            id: row.id,
          });
        }
        return fetchTopology(true);
      })
      .catch((err: Error) => {
        setSuppressionError(API.getFriendlyMessage(err));
      });
  }, [fetchTopology]);

  /*
   * VLAN filter options: every distinct VLAN the current payload knows,
   * plus the "All VLANs" default.
   *
   * Read from ANY node carrying one, not only endpoint nodes. A device
   * placed by endpoint inference (issue #3489) is drawn as the device it
   * is, and the VLAN its endpoint row carried moves onto it — so scoping
   * this to endpoint nodes would make a site's VLANs vanish from the
   * dropdown precisely as inference started working, which reads as the
   * filter breaking.
   *
   * The FILTER itself is unchanged and still hides only endpoint nodes:
   * a managed device stays on the map whichever VLAN is selected, so the
   * physical fabric remains visible for context.
   */
  const vlanOptions: Array<DropdownOption> = useMemo(() => {
    const vlanIds: Set<number> = new Set<number>();
    for (const node of topology.nodes) {
      if (typeof node.vlanId === "number") {
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
   * The counts on the health chips describe what is ON THE MAP, not what
   * came back from the endpoint: they are computed after the VLAN filter
   * and after the kind filter, in that order, because a chip claiming
   * "3 down" over a map showing none of them is worse than no chip at
   * all.
   */
  const healthSummary: TopologyHealthSummary = useMemo(() => {
    return summarizeTopologyHealth(
      visibleTopology.nodes.filter((node: NetworkTopologyNode) => {
        return effectiveVisibleKinds.has(kindOfNode(node));
      }),
      visibleTopology.edges,
    );
  }, [visibleTopology, effectiveVisibleKinds]);

  const isHealthFiltered: boolean = isHealthFilterActive(healthFilterMode);
  const healthFilterMatchCount: number = healthCountForMode(
    healthSummary,
    healthFilterMode,
  );
  const healthChipOptions: Array<StatusChipOption> = useMemo(() => {
    return buildHealthFilterOptions(healthSummary);
  }, [healthSummary]);

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
   * Which arrangement is pending a write, and which key it belongs to.
   * Kept in one object precisely so the two cannot drift apart — see
   * ArrangementPersistence for what happens when they do. Built once and
   * held in a ref: the storage handle is feature-detected once at mount
   * and never changes, so there is nothing here to rebuild.
   */
  const persistenceRef: React.MutableRefObject<ArrangementPersistence | null> =
    useRef<ArrangementPersistence | null>(null);
  if (persistenceRef.current === null) {
    persistenceRef.current = createArrangementPersistence(
      overrideStorage,
      overridesStorageKey,
    );
  }
  const persistence: ArrangementPersistence = persistenceRef.current;

  /*
   * Render phase: refresh the coordinates a flush would write, and
   * nothing else. `overridesStorageKey` has ALREADY advanced to the mode
   * the user just picked while `positionOverrides` still holds the
   * outgoing mode's coordinates, so the key must not be touched here;
   * only `adopt` below moves it, and only alongside the arrangement it
   * belongs to.
   */
  persistence.hold(positionOverrides);

  /*
   * Load the saved arrangement for this (project, site, layout mode).
   * Each layout is its own coordinate system, so switching modes loads a
   * different arrangement rather than reinterpreting the current one.
   */
  useEffect(() => {
    setPositionOverrides(persistence.adopt(overridesStorageKey));
  }, [persistence, overridesStorageKey]);

  // Persist, debounced, so a drag does not write on every commit.
  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      persistence.flush();
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [persistence, overridesStorageKey, positionOverrides]);

  /*
   * Flush a pending write when the key changes or the view goes away.
   * Without this, a drag committed inside the 500ms debounce window is
   * simply lost if the user then switches layout mode or navigates — and
   * "I moved it and it did not save" is the whole feature failing.
   *
   * Deliberately NOT folded into the debounce effect above: that one
   * depends on `positionOverrides`, so its cleanup fires on every commit
   * and would write on each one, defeating the debounce. This cleanup
   * runs only on a key change or unmount, and because every cleanup runs
   * before any effect body, it happens before the `adopt` that switches
   * modes — so the outgoing arrangement is still the held one.
   */
  useEffect(() => {
    return () => {
      persistence.flush();
    };
  }, [persistence, overridesStorageKey]);

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
          /*
           * flex-wrap because five pills no longer fit a phone. The group
           * is flex-shrink-0 inside a flex-shrink-0 header column, so
           * without it the row simply grows past the card and the last
           * option is unreachable rather than merely cramped — and
           * "Parent-Child" is the widest label of the five, so it is the
           * one that would be lost.
           */
          className="inline-flex flex-wrap flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
        >
          {(
            [
              { mode: "force", label: "Force" },
              { mode: "tiered", label: "Tiered" },
              { mode: "radial", label: "Radial" },
              { mode: "star", label: "Star" },
              { mode: "parentChild", label: "Parent-Child" },
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
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
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

        {/*
         * Issue #3261: the health row. Its own line under the identity
         * controls rather than a fifth item beside them — "which of these
         * needs me" is a different question from "which of these am I
         * looking for", and the chips carry counts that make this row the
         * map's status line as much as its filter.
         */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusChipGroup
            dataTestId="network-topology-health-filter"
            ariaLabel="Filter by device health"
            options={healthChipOptions}
            value={healthFilterMode}
            onChange={(value: string) => {
              setHealthFilterMode(value as TopologyHealthFilterMode);
            }}
          />
          <p
            className="text-xs text-gray-500"
            data-testid="network-topology-health-filter-hint"
          >
            {isHealthFiltered
              ? `${healthFilterMatchCount} of ${healthSummary.total} ${
                  healthSummary.total === 1 ? "device needs" : "devices need"
                } a look. Healthy devices are hidden; each match keeps its neighbouring devices on the map, dimmed, so you can see where it sits.`
              : translateString(
                  "Narrow the map to the devices that need a look — counts refresh every minute.",
                ) ||
                "Narrow the map to the devices that need a look — counts refresh every minute."}
          </p>
        </div>
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

      {/*
       * Always shown when anything is hidden. A map that quietly drops
       * things is the same failure as one that quietly invents them, and
       * without this a node hidden months ago by somebody else is
       * unfindable.
       */}
      {topology.suppressedNodeCount && topology.suppressedNodeCount > 0 ? (
        <p
          className="mb-3 text-xs text-gray-500"
          data-testid="network-topology-suppressed-note"
        >
          {`${topology.suppressedNodeCount} ${
            topology.suppressedNodeCount === 1 ? "node is" : "nodes are"
          } hidden from this map. `}
          <button
            type="button"
            className="font-medium text-indigo-600 underline hover:text-indigo-800"
            onClick={restoreAllHiddenNodes}
          >
            {translateString("Show them") || "Show them"}
          </button>
        </p>
      ) : (
        <></>
      )}

      {suppressionError ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {suppressionError}
        </div>
      ) : (
        <></>
      )}

      {/*
       * The rules with something to explain — including a site-scoped rule
       * that drew in most of its sites and failed in the rest, so a listed
       * rule has not necessarily drawn nothing. Surfaced on the map rather
       * than only on the rule page: an ambiguous parent is invisible from the
       * rule list, which is exactly where somebody would go looking and find
       * a rule that appears perfectly configured.
       */}
      {/*
       * Ping-monitored devices that could not be placed automatically, one
       * line per cause. Deliberately on the map rather than only on the
       * device pages: this is the screen where somebody notices a till has
       * no cable, and it is where the answer to "why not" belongs.
       */}
      {topology.uplinkInferenceWarnings &&
      topology.uplinkInferenceWarnings.length > 0 ? (
        <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">
          <ul className="list-disc space-y-1 pl-4">
            {topology.uplinkInferenceWarnings.map(
              (warning: TopologyUplinkWarning, index: number): ReactElement => {
                return <li key={index}>{warning.message}</li>;
              },
            )}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {topology.linkRuleWarnings && topology.linkRuleWarnings.length > 0 ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <ul className="list-disc space-y-1 pl-4">
            {topology.linkRuleWarnings.map(
              (
                warning: TopologyLinkRuleWarning,
                index: number,
              ): ReactElement => {
                const hidden: number = hiddenSiteCount(warning);

                return (
                  <li key={index}>
                    <span className="font-medium">
                      {warning.ruleName || "Link rule"}
                    </span>
                    {`: ${warning.message}`}
                    {/*
                     * The sentence above names three sites and then a number.
                     * Collapsed rather than inline because the number can be
                     * in the hundreds — but present, because "694 more sites"
                     * is a blast radius and not a list of buildings anybody
                     * can go and fix (issue #3321).
                     */}
                    {warning.sites && warning.sites.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-amber-900 underline">
                          {describeSiteListToggle(warning)}
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {warning.sites.map(
                            (
                              site: TopologyLinkRuleWarningSite,
                            ): ReactElement => {
                              return (
                                <li key={site.siteId}>
                                  {describeWarningSite(site)}
                                </li>
                              );
                            },
                          )}
                        </ul>
                        {hidden > 0 ? (
                          <div className="mt-1 italic">
                            {`${hidden} more site${
                              hidden === 1 ? "" : "s"
                            } not listed here.`}
                          </div>
                        ) : (
                          <></>
                        )}
                      </details>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </div>
      ) : (
        <></>
      )}

      <NetworkDeviceGraph
        topology={visibleTopology}
        searchText={searchText}
        layoutMode={layoutMode}
        visibleKinds={effectiveVisibleKinds}
        healthFilterMode={healthFilterMode}
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
          onHideNode={hideNode}
          onAddToMonitoring={
            canCreateDevice && isAdoptableNode(selectedNode)
              ? (node: NetworkTopologyNode) => {
                  /*
                   * Close the drawer first, the same way hiding a node
                   * does: SideOver has no backdrop, so leaving it open
                   * behind the dialog stacks two surfaces the user can
                   * still click through to.
                   */
                  setSelectedNodeId(null);
                  setNodeToAdopt(node);
                }
              : undefined
          }
        />
      ) : (
        <></>
      )}

      {nodeToAdopt ? (
        <AddNeighborToMonitoringModal
          key={nodeToAdopt.id}
          node={nodeToAdopt}
          edges={visibleTopology.edges}
          nodeById={nodeById}
          onClose={() => {
            setNodeToAdopt(null);
          }}
          onSuccess={() => {
            setNodeToAdopt(null);
            /*
             * Refetch rather than patching local state, for the reason
             * hiding a node refetches: whether the new device absorbs the
             * unmanaged node is decided server-side, by re-deriving the
             * whole graph from the neighbour reports. Guessing at it here
             * would show this user a map nobody else has. The BACKGROUND
             * variant, so the viewport and the saved arrangement survive
             * the refresh the operator just triggered — and, like the
             * minute-by-minute refresh, a failure keeps the last graph
             * rather than reporting an error about a device that WAS
             * created.
             */
            fetchTopology(true).catch(() => {
              // Non-fatal: the next scheduled refresh picks the device up.
            });
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
