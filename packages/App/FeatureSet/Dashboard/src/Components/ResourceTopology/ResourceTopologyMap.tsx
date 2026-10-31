import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import { getPageReadingDirection } from "Common/UI/Utils/PageLanguage";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import StatusChipGroup, { StatusChipOption } from "../Filters/StatusChipGroup";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyTruncation,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyKindInfo,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import {
  ResourceTopologyFilter,
  ResourceTopologyViewState,
  ResourceTopologyVisible,
  closeTopologyPart,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  openTopologyPart,
  revealTopologyPart,
  toggleTopologyGroup,
} from "./ResourceTopologyView";
import {
  ResourceTopologyDirection,
  ResourceTopologyLanes,
  ResourceTopologyLayout,
  ResourceTopologyLayoutRelation,
  layoutResourceTopology,
} from "./ResourceTopologyLayout";
import {
  ResourceTopologyFit,
  fitResourceTopology,
} from "./ResourceTopologyFit";
import ResourceTopologyCanvas, {
  ResourceTopologyFitRequest,
} from "./ResourceTopologyCanvas";
import ResourceTopologyOutline from "./ResourceTopologyOutline";
import ResourceTopologyDetailPanel from "./ResourceTopologyDetailPanel";
import {
  ResourceTopologyNodeCallbacks,
  topologyNodeName,
  tx,
} from "./ResourceTopologyNodes";
import {
  RESOURCE_TOPOLOGY_BRANCH_COLORS,
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_HEALTH_LABELS,
  RESOURCE_TOPOLOGY_LEGEND,
  RESOURCE_TOPOLOGY_RELATION_COLOR,
} from "./ResourceTopologyLook";

/*
 * A resource's topology, ready to read: what is in it and how it is doing
 * at the top, then the map (or the list), and the panel of whatever part is
 * picked. Every product's Topology page is this component over the graph its
 * builder made, so they all work the same way (README.md in this folder says
 * how a product adds its own):
 *
 *   - the map is a tree, never a box inside a box: the resource at the top,
 *     each part's parts in the column after it, joined to it by a line that
 *     is red or amber when a part that needs attention is that way, and the
 *     way to trouble open by itself (ResourceTopologyLayout, ...View);
 *   - "Needs attention" narrows the map to what is troubled and the path to
 *     it; a search narrows it to what matches;
 *   - clicking a part opens its panel (its own page one click further),
 *     its chevron opens or closes it, "+ N more" shows the rest of a group;
 *   - "Focus on this" narrows the map to one part, what is inside it and
 *     what it is related to;
 *   - where a resource can be read more than one way (a cluster's pods by
 *     workload or by node), "Group by" switches between them.
 *
 * What is open, picked, focused, filtered and searched lives in the address
 * bar, so a link opens the same view.
 */

export interface ResourceTopologyArrangement {
  id: string;
  /* English: "Workloads". */
  label: string;
  graph: ResourceTopologyGraph;
  /*
   * Draw every relation all the time: for a map that is about them, like a
   * host's calls. Otherwise only the picked part's relations are drawn.
   */
  alwaysShowRelations?: boolean | undefined;
  /* What those always-drawn lines are, for the legend (English). */
  relationLegend?: string | undefined;
  /* Parts of the top drawn beside it: what calls it, what it calls. */
  lanes?: ResourceTopologyLanes | undefined;
}

export interface ComponentProps {
  arrangements: Array<ResourceTopologyArrangement>;
  /* The search box's hint: "Find a host, VM or datastore…". */
  searchPlaceholder: string;
  /* More open incidents and alerts were open than were read. */
  issuesArePartial?: boolean | undefined;
  /* Open incidents or alerts could not be read at all. */
  issuesAreUnreadable?: boolean | undefined;
}

type DisplayMode = "map" | "list";

const QUERY_NODE: string = "node";
const QUERY_FOCUS: string = "focus";
const QUERY_FILTER: string = "filter";
const QUERY_VIEW: string = "view";
const QUERY_ARRANGEMENT: string = "by";
const QUERY_SEARCH: string = "search";

const PHONE_WIDTH_PX: number = 640;
const PHONE_CANVAS_HEIGHT: number = 520;
const MIN_CANVAS_HEIGHT: number = 480;
const MAX_CANVAS_HEIGHT: number = 760;
const DEFAULT_ASPECT: number = 1.8;
// The canvas width the first view is fitted to is rounded down to this.
const FIT_WIDTH_STEP: number = 40;
const SEARCH_URL_DELAY_MS: number = 300;

function readInitialDisplay(): DisplayMode {
  const fromUrl: string | null = Navigation.getQueryStringByName(QUERY_VIEW);

  if (fromUrl === "list" || fromUrl === "map") {
    return fromUrl;
  }

  if (typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH_PX) {
    return "list";
  }

  return "map";
}

function sumTruncations(
  truncations: Array<ResourceTopologyTruncation>,
  field: "shown" | "total",
): number {
  return truncations.reduce(
    (sum: number, truncation: ResourceTopologyTruncation): number => {
      return sum + truncation[field];
    },
    0,
  );
}

/*
 * What a map with lanes asks of the view: the lanes' sections always open,
 * and every part at either end of a relation shown, so a host's map draws
 * each call from the first view. Nothing for a map without lanes.
 */
export function getLaneViewOptions(
  graph: ResourceTopologyGraph,
  lanes: ResourceTopologyLanes | undefined,
): {
  alwaysOpen: ReadonlySet<string> | undefined;
  reveal: ReadonlyArray<string> | undefined;
} {
  if (!lanes || lanes.left.length + lanes.right.length === 0) {
    return { alwaysOpen: undefined, reveal: undefined };
  }

  const reveal: Set<string> = new Set<string>();

  for (const relation of graph.relations) {
    reveal.add(relation.from);
    reveal.add(relation.to);
  }

  return {
    alwaysOpen: new Set<string>([...lanes.left, ...lanes.right]),
    reveal: Array.from(reveal),
  };
}

export function getResourceTopologyPartCount(
  graph: ResourceTopologyGraph,
): number {
  let count: number = 1;

  for (const value of graph.countsByKind.values()) {
    count += value;
  }

  return count;
}

const ResourceTopologyMap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [arrangementId, setArrangementId] = useState<string>((): string => {
    const fromUrl: string | null =
      Navigation.getQueryStringByName(QUERY_ARRANGEMENT);

    return (
      props.arrangements.find((item: ResourceTopologyArrangement): boolean => {
        return item.id === fromUrl;
      })?.id ||
      props.arrangements[0]?.id ||
      ""
    );
  });

  const arrangement: ResourceTopologyArrangement =
    props.arrangements.find((item: ResourceTopologyArrangement): boolean => {
      return item.id === arrangementId;
    }) || props.arrangements[0]!;
  const graph: ResourceTopologyGraph = arrangement.graph;

  const [viewState, setViewState] = useState<ResourceTopologyViewState>(
    (): ResourceTopologyViewState => {
      const filter: string | null =
        Navigation.getQueryStringByName(QUERY_FILTER);
      const focus: string | null = Navigation.getQueryStringByName(QUERY_FOCUS);
      const node: string | null = Navigation.getQueryStringByName(QUERY_NODE);
      const initial: ResourceTopologyViewState =
        createResourceTopologyViewState({
          filter: filter === "attention" ? "attention" : "all",
          focusId: focus && graph.nodes.has(focus) ? focus : null,
          search: Navigation.getQueryStringByName(QUERY_SEARCH) || "",
        });

      return node ? revealTopologyPart(graph, initial, node) : initial;
    },
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    (): string | null => {
      const node: string | null = Navigation.getQueryStringByName(QUERY_NODE);

      return node && graph.nodes.has(node) ? node : null;
    },
  );
  const [display, setDisplay] = useState<DisplayMode>(readInitialDisplay);
  const [fitRequest, setFitRequest] = useState<ResourceTopologyFitRequest>({
    token: 0,
    nodeIds: null,
    animate: false,
  });
  const searchUrlTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFit: (nodeIds: Array<string> | null, animate: boolean) => void =
    useCallback((nodeIds: Array<string> | null, animate: boolean): void => {
      setFitRequest((previous: ResourceTopologyFitRequest) => {
        return {
          token: previous.token + 1,
          nodeIds: nodeIds,
          animate: animate,
        };
      });
    }, []);

  useEffect(() => {
    return () => {
      if (searchUrlTimer.current) {
        clearTimeout(searchUrlTimer.current);
      }
    };
  }, []);

  /*
   * The words a kind is found by: its English name and the reader's. Read
   * at search time, so a reader who switches language finds parts by the
   * words now on screen.
   */
  const kindLabel: (kind: string) => Array<string> = useCallback(
    (kind: string): Array<string> => {
      const info: ResourceTopologyKindInfo = getResourceTopologyKind(kind);

      return [
        info.label,
        info.plural,
        tx(info.label, translator),
        tx(info.plural, translator),
      ];
    },
    // The translator is rebuilt every render; its words change with the language.
    [translator.language],
  );

  /*
   * The canvas's shape, so the whole drawing is laid out to fill it: the
   * frame's width is measured (and followed as the window changes), its
   * height is set from the window's.
   */
  const frameRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState<number>(0);

  useEffect(() => {
    const frame: HTMLDivElement | null = frameRef.current;

    if (!frame) {
      return undefined;
    }

    const update: () => void = (): void => {
      setFrameWidth(frame.clientWidth);
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer: ResizeObserver = new ResizeObserver(update);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

  const isPhone: boolean =
    typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH_PX;
  const canvasHeight: number = isPhone
    ? PHONE_CANVAS_HEIGHT
    : Math.round(
        Math.min(
          MAX_CANVAS_HEIGHT,
          Math.max(
            MIN_CANVAS_HEIGHT,
            (typeof window !== "undefined" ? window.innerHeight : 900) - 260,
          ),
        ),
      );
  // Rounded, so a scrollbar coming and going does not lay everything out again.
  const aspect: number =
    frameWidth > 0
      ? Math.max(0.5, Math.round((frameWidth / canvasHeight) * 4) / 4)
      : DEFAULT_ASPECT;

  /*
   * How deep the first view opens: as deep as this canvas shows readably.
   * Worked out from a rounded width, so a scrollbar never changes it.
   */
  const fitWidth: number =
    frameWidth > 0
      ? Math.floor(frameWidth / FIT_WIDTH_STEP) * FIT_WIDTH_STEP
      : Math.round(DEFAULT_ASPECT * canvasHeight);
  /*
   * A map about calls (a host's) draws every call: its lanes are always
   * open, and every part at either end of a call is shown.
   */
  const laneOptions: {
    alwaysOpen: ReadonlySet<string> | undefined;
    reveal: ReadonlyArray<string> | undefined;
  } = useMemo(() => {
    return getLaneViewOptions(graph, arrangement.lanes);
  }, [graph, arrangement.lanes]);

  const fit: ResourceTopologyFit = useMemo(() => {
    return fitResourceTopology(
      graph,
      viewState.focusId,
      { width: fitWidth, height: canvasHeight },
      {
        lanes: arrangement.lanes,
        aspect: aspect,
        relations: arrangement.lanes ? graph.relations : undefined,
        alwaysOpen: laneOptions.alwaysOpen,
        reveal: laneOptions.reveal,
      },
    );
  }, [
    graph,
    viewState.focusId,
    fitWidth,
    canvasHeight,
    aspect,
    arrangement.lanes,
    laneOptions,
  ]);

  const visible: ResourceTopologyVisible = useMemo(() => {
    return computeResourceTopologyView(graph, viewState, {
      kindLabel: kindLabel,
      budget: fit.budget,
      maxAutomaticDepth: fit.depth,
      alwaysOpen: laneOptions.alwaysOpen,
      reveal: laneOptions.reveal,
      opensAll: fit.opensAll,
    });
  }, [graph, viewState, kindLabel, fit, laneOptions]);

  // A page read from right to left gets the tree mirrored.
  const direction: ResourceTopologyDirection =
    useMemo((): ResourceTopologyDirection => {
      return getPageReadingDirection();
    }, [translator.language]);
  // A lane's parts line up with what they are related to.
  const laneRelations:
    | ReadonlyArray<ResourceTopologyLayoutRelation>
    | undefined = arrangement.lanes ? graph.relations : undefined;

  const layout: ResourceTopologyLayout = useMemo(() => {
    return layoutResourceTopology(visible, {
      aspect: aspect,
      lanes: arrangement.lanes,
      relations: laneRelations,
      direction: direction,
      rowLength: fit.rowLength,
    });
  }, [
    visible,
    aspect,
    arrangement.lanes,
    laneRelations,
    direction,
    fit.rowLength,
  ]);

  // A new canvas shape lays the drawing out again: frame it again.
  useEffect(() => {
    requestFit(null, false);
  }, [aspect]);

  const select: (nodeId: string | null) => void = useCallback(
    (nodeId: string | null): void => {
      setSelectedId(nodeId);
      Navigation.setQueryString({ [QUERY_NODE]: nodeId });

      if (nodeId) {
        // A part picked from the panel or a link may be folded away: show it.
        setViewState((state: ResourceTopologyViewState) => {
          return revealTopologyPart(graph, state, nodeId);
        });
      }
    },
    [graph],
  );

  const callbacks: ResourceTopologyNodeCallbacks =
    useMemo((): ResourceTopologyNodeCallbacks => {
      return {
        onSelect: (nodeId: string): void => {
          select(nodeId);
        },
        onToggleOpen: (nodeId: string, open: boolean): void => {
          setViewState((state: ResourceTopologyViewState) => {
            return open
              ? openTopologyPart(graph, state, nodeId)
              : closeTopologyPart(state, nodeId);
          });

          if (open) {
            requestFit([nodeId], true);
          }
        },
        onToggleGroup: (key: string): void => {
          setViewState((state: ResourceTopologyViewState) => {
            return toggleTopologyGroup(state, key);
          });
        },
      };
    }, [graph, select, requestFit]);

  const setFilter: (filter: ResourceTopologyFilter) => void = (
    filter: ResourceTopologyFilter,
  ): void => {
    setViewState((state: ResourceTopologyViewState) => {
      return { ...state, filter: filter };
    });
    Navigation.setQueryString({
      [QUERY_FILTER]: filter === "attention" ? "attention" : null,
    });
    requestFit(null, true);
  };

  const setSearch: (search: string) => void = (search: string): void => {
    setViewState((state: ResourceTopologyViewState) => {
      return { ...state, search: search };
    });

    if (searchUrlTimer.current) {
      clearTimeout(searchUrlTimer.current);
    }

    searchUrlTimer.current = setTimeout(() => {
      Navigation.setQueryString({ [QUERY_SEARCH]: search.trim() || null });
      requestFit(null, true);
    }, SEARCH_URL_DELAY_MS);
  };

  const setFocus: (nodeId: string | null) => void = (
    nodeId: string | null,
  ): void => {
    setViewState((state: ResourceTopologyViewState) => {
      return { ...state, focusId: nodeId };
    });
    Navigation.setQueryString({ [QUERY_FOCUS]: nodeId });
    requestFit(null, true);
  };

  const changeArrangement: (id: string) => void = (id: string): void => {
    setArrangementId(id);
    setViewState((state: ResourceTopologyViewState) => {
      return createResourceTopologyViewState({
        filter: state.filter,
        search: state.search,
      });
    });
    setSelectedId(null);
    Navigation.setQueryString({
      [QUERY_ARRANGEMENT]: id === props.arrangements[0]?.id ? null : id,
      [QUERY_NODE]: null,
      [QUERY_FOCUS]: null,
    });
    requestFit(null, false);
  };

  const changeDisplay: (mode: DisplayMode) => void = (
    mode: DisplayMode,
  ): void => {
    setDisplay(mode);
    Navigation.setQueryString({
      [QUERY_VIEW]: mode === "list" ? "list" : null,
    });

    if (mode === "map") {
      requestFit(null, false);
    }
  };

  const partCount: number = getResourceTopologyPartCount(graph);
  const healthOptions: Array<StatusChipOption> = [
    {
      value: "all",
      label: tx("All", translator),
      description: tx("Every part of this resource", translator),
      count: partCount,
      testId: "resource-topology-filter-all",
    },
    {
      value: "attention",
      label: tx("Needs attention", translator),
      description: tx(
        "Parts that are critical, need attention, or have an open incident or alert",
        translator,
      ),
      color: RESOURCE_TOPOLOGY_HEALTH_COLORS.warning,
      count: graph.attentionCount,
      testId: "resource-topology-filter-attention",
    },
  ];

  const kindCounts: Array<[string, number]> = Array.from(
    graph.countsByKind.entries(),
  )
    .filter((entry: [string, number]): boolean => {
      return entry[1] > 0;
    })
    .sort((a: [string, number], b: [string, number]): number => {
      return (
        getResourceTopologyKind(a[0]).order -
        getResourceTopologyKind(b[0]).order
      );
    });

  const focusNode: ResourceTopologyNode | null = visible.focusId
    ? graph.nodes.get(visible.focusId) || null
    : null;
  const searching: boolean = viewState.search.trim().length > 0;

  const renderNotice: (
    testId: string,
    children: ReactElement | string,
    tone?: "info" | "warning",
  ) => ReactElement = (
    testId: string,
    children: ReactElement | string,
    tone: "info" | "warning" = "info",
  ): ReactElement => {
    return (
      <div
        role="status"
        data-testid={testId}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ${
          tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-indigo-100 bg-indigo-50 text-indigo-900"
        }`}
      >
        {children}
      </div>
    );
  };

  return (
    <div data-testid="resource-topology" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {kindCounts.map((entry: [string, number]): ReactElement => {
          const kind: ResourceTopologyKindInfo = getResourceTopologyKind(
            entry[0],
          );

          return (
            <span
              key={entry[0]}
              data-testid={`resource-topology-count-${entry[0]}`}
              className="inline-flex items-center gap-1.5 text-gray-600"
            >
              <span
                aria-hidden={true}
                className="flex h-5 w-5 items-center justify-center rounded"
                style={{
                  color: kind.color,
                  backgroundColor: `${kind.color}1f`,
                }}
              >
                <Icon icon={kind.icon} className="h-3 w-3" />
              </span>
              <span className="font-semibold text-gray-900">
                {translator.formatNumber(entry[1])}
              </span>
              <span>
                {tx(entry[1] === 1 ? kind.label : kind.plural, translator)}
              </span>
            </span>
          );
        })}
        {graph.incidentCount > 0 || graph.alertCount > 0 ? (
          <span
            data-testid="resource-topology-issue-summary"
            className="inline-flex flex-wrap items-center gap-x-3 sm:ml-auto"
          >
            {graph.incidentCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                <Icon icon={IconProp.Alert} className="h-4 w-4" />
                {translator.translatePlural(
                  {
                    one: "{{count}} open incident",
                    other: "{{count}} open incidents",
                  },
                  graph.incidentCount,
                )}
              </span>
            ) : null}
            {graph.alertCount > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <Icon icon={IconProp.Bell} className="h-4 w-4" />
                {translator.translatePlural(
                  {
                    one: "{{count}} open alert",
                    other: "{{count}} open alerts",
                  },
                  graph.alertCount,
                )}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/*
       * The search takes the room the controls leave it. When the controls
       * do not fit beside a usable search box (a Kubernetes cluster's Group
       * by, a long language, a phone), they move to a line of their own as
       * one group, instead of dropping one control under the others.
       */}
      <div
        data-testid="resource-topology-toolbar"
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
      >
        <div className="relative min-w-[15rem] flex-1">
          <Icon
            icon={IconProp.Search}
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400"
          />
          <input
            type="search"
            data-testid="resource-topology-search"
            aria-label={tx("Search this topology", translator)}
            placeholder={tx(props.searchPlaceholder, translator)}
            value={viewState.search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(event.target.value);
            }}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div
          data-testid="resource-topology-controls"
          className="flex flex-wrap items-center gap-2"
        >
          <StatusChipGroup
            options={healthOptions}
            value={viewState.filter}
            onChange={(value: string) => {
              setFilter(value === "attention" ? "attention" : "all");
            }}
            ariaLabel="Show"
            dataTestId="resource-topology-filter"
          />
          {props.arrangements.length > 1 ? (
            <div
              role="group"
              aria-label={tx("Group by", translator)}
              className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
            >
              <span className="px-2 text-xs text-gray-500">
                {tx("Group by", translator)}
              </span>
              {props.arrangements.map(
                (item: ResourceTopologyArrangement): ReactElement => {
                  const active: boolean = item.id === arrangement.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      data-testid={`resource-topology-arrangement-${item.id}`}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        active
                          ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                      onClick={() => {
                        changeArrangement(item.id);
                      }}
                    >
                      {tx(item.label, translator)}
                    </button>
                  );
                },
              )}
            </div>
          ) : null}
          <div
            role="group"
            aria-label={tx("Show as", translator)}
            className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
          >
            {(
              [
                { id: "map", label: "Map", icon: IconProp.FlowDiagram },
                { id: "list", label: "List", icon: IconProp.List },
              ] as Array<{ id: DisplayMode; label: string; icon: IconProp }>
            ).map(
              (option: {
                id: DisplayMode;
                label: string;
                icon: IconProp;
              }): ReactElement => {
                const active: boolean = display === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`resource-topology-display-${option.id}`}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active
                        ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                    onClick={() => {
                      changeDisplay(option.id);
                    }}
                  >
                    <Icon icon={option.icon} className="h-3.5 w-3.5" />
                    {tx(option.label, translator)}
                  </button>
                );
              },
            )}
          </div>
        </div>
      </div>

      {/*
       * One sentence for every read that hit its cap (a cluster's pods and
       * its other parts are read apart). What was not read cannot be
       * searched for, so the sentence says only how much is drawn.
       */}
      {graph.truncations.length > 0
        ? renderNotice(
            "resource-topology-truncated",
            translator.translateTemplate(
              "Showing {{shown}} of {{total}} parts, the most this map reads at once.",
              {
                shown: translator.formatNumber(
                  sumTruncations(graph.truncations, "shown"),
                ),
                total: translator.formatNumber(
                  sumTruncations(graph.truncations, "total"),
                ),
              },
            ),
            "warning",
          )
        : null}

      {props.issuesAreUnreadable
        ? renderNotice(
            "resource-topology-issues-unreadable",
            tx(
              "Some open incidents or alerts could not be read, so the map may not show them all.",
              translator,
            ),
            "warning",
          )
        : props.issuesArePartial
          ? renderNotice(
              "resource-topology-issues-partial",
              tx(
                "Only the newest open incidents and alerts are pinned to the map.",
                translator,
              ),
              "warning",
            )
          : null}

      {focusNode
        ? renderNotice(
            "resource-topology-focus",
            <>
              <span>
                {translator.translateTemplate(
                  "Showing {{name}}, what is inside it and what it is related to.",
                  { name: topologyNodeName(translator, focusNode) },
                )}
              </span>
              {/*
               * Beside it the map draws RELATED_LIMIT related parts at
               * most; the rest are listed in the part's panel, one click
               * away, rather than dropped without a word.
               */}
              {visible.relatedHidden > 0 ? (
                <button
                  type="button"
                  data-testid="resource-topology-related-hidden"
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                  onClick={() => {
                    select(focusNode.id);
                  }}
                >
                  {translator.translatePlural(
                    {
                      one: "See {{count}} more related part",
                      other: "See {{count}} more related parts",
                    },
                    visible.relatedHidden,
                  )}
                </button>
              ) : null}
              <button
                type="button"
                data-testid="resource-topology-focus-clear"
                className="font-semibold text-indigo-700 hover:text-indigo-900"
                onClick={() => {
                  setFocus(null);
                }}
              >
                {tx("Show everything", translator)}
              </button>
            </>,
          )
        : null}

      {searching
        ? renderNotice(
            "resource-topology-search-result",
            <>
              <span>
                {visible.matchCount > 0
                  ? translator.translatePlural(
                      {
                        one: "{{count}} part matches your search.",
                        other: "{{count}} parts match your search.",
                      },
                      visible.matchCount,
                    )
                  : tx("No part matches your search.", translator)}
              </span>
              <button
                type="button"
                className="font-semibold text-indigo-700 hover:text-indigo-900"
                onClick={() => {
                  setSearch("");
                }}
              >
                {tx("Clear search", translator)}
              </button>
            </>,
          )
        : null}

      {viewState.filter === "attention" && graph.attentionCount === 0
        ? renderNotice(
            "resource-topology-all-healthy",
            tx("Nothing here needs attention right now.", translator),
          )
        : null}

      <div
        ref={frameRef}
        className="overflow-hidden rounded-xl border border-gray-200"
      >
        {display === "map" ? (
          <ResourceTopologyCanvas
            graph={graph}
            visible={visible}
            layout={layout}
            selectedId={selectedId}
            callbacks={callbacks}
            fitRequest={fitRequest}
            height={canvasHeight}
            alwaysShowRelations={arrangement.alwaysShowRelations}
          />
        ) : (
          <ResourceTopologyOutline
            graph={graph}
            visible={visible}
            selectedId={selectedId}
            callbacks={callbacks}
          />
        )}
        <div
          data-testid="resource-topology-legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-500"
        >
          {RESOURCE_TOPOLOGY_LEGEND.map(
            (health: ResourceTopologyNode["health"]): ReactElement => {
              return (
                <span key={health} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden={true}
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: RESOURCE_TOPOLOGY_HEALTH_COLORS[health],
                    }}
                  />
                  {tx(RESOURCE_TOPOLOGY_HEALTH_LABELS[health], translator)}
                </span>
              );
            },
          )}
          {display === "map" ? (
            <span className="inline-flex items-center gap-1.5">
              <svg
                aria-hidden={true}
                width="20"
                height="12"
                viewBox="0 0 20 12"
                className="flex-shrink-0"
              >
                <path
                  d="M1 2 H7 Q10 2 10 5 V7 Q10 10 13 10 H19"
                  fill="none"
                  stroke={RESOURCE_TOPOLOGY_BRANCH_COLORS.calm}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {tx("What is inside", translator)}
            </span>
          ) : null}
          {display === "map" && arrangement.relationLegend ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden={true}
                className="inline-block w-5 border-t-2 border-gray-400"
              />
              {tx(arrangement.relationLegend, translator)}
            </span>
          ) : null}
          {display === "map" && !arrangement.alwaysShowRelations ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden={true}
                className="inline-block w-5 border-t-2 border-dashed"
                style={{ borderColor: RESOURCE_TOPOLOGY_RELATION_COLOR }}
              />
              {tx("Related, for the part you pick", translator)}
            </span>
          ) : null}
          {display === "map" ? (
            <span className="sm:ml-auto">
              {tx("Ctrl + scroll or pinch to zoom", translator)}
            </span>
          ) : null}
        </div>
      </div>

      {selectedId && graph.nodes.has(selectedId) ? (
        <ResourceTopologyDetailPanel
          graph={graph}
          nodeId={selectedId}
          focusId={visible.focusId}
          onClose={() => {
            select(null);
          }}
          onSelect={(nodeId: string) => {
            select(nodeId);
          }}
          onFocus={(nodeId: string | null) => {
            setFocus(nodeId);
          }}
        />
      ) : null}
    </div>
  );
};

export default ResourceTopologyMap;
