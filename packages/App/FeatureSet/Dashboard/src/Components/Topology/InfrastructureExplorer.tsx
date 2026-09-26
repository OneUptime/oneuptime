import React, {
  FunctionComponent,
  ReactElement,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { getInventoryTypeIcon } from "../Inventory/InventoryTypeCatalog";
import InfrastructureGraph from "./InfrastructureGraph";
import EdgeDetailPanel from "./EdgeDetailPanel";
import EntityDetailPanel from "./EntityDetailPanel";
import {
  CollectionCursor,
  CollectionErrorDescription,
  CollectionPage,
  describeCollectionError,
  fetchCollectionPage,
  fetchCollectionSearchCounts,
  isCollectionSearchable,
} from "./InfrastructureCollectionApi";
import {
  InfrastructureNode,
  InfrastructureSearchIndex,
  InfrastructureServiceCall,
  InfrastructureTopologyModel,
  InfrastructureTrafficLink,
  buildInfrastructureSearchIndex,
  buildInfrastructureTopologyModel,
  collectMapCards,
  collectionNameTerms,
  compareNames,
  describeInfrastructureNode,
  getInfrastructurePath,
  infrastructureSearchTerms,
  isContainerNode,
  searchInfrastructure,
  summarizeCounts,
} from "./InfrastructureTopologyModel";
import { formatLastSeen, isEntityActive } from "./TopologyActivity";
import {
  EntityDetailTarget,
  InfrastructureCollection,
  InfrastructureTotals,
  TopologyEntity,
  TopologyRelationship,
  TopologyTruncation,
} from "./TopologyData";
import { metaForEntityType } from "./TopologyMeta";
import { nounForType } from "./ServiceMapViewModel";

/*
 * Infrastructure: "what runs where", walked top-down.
 *
 * A tree on the left holds only things that contain other things — categories,
 * clusters, namespaces, deployments, groups of replicas, collections — so it
 * stays short even for a large estate. The right side shows what is inside the
 * selected scope, as a table (every row says what it contains and which
 * services run there) or as a map of that one level. Fleets are grouped by
 * workload, and resources that did not report in the selected range are left
 * out unless the page asks for them.
 *
 * A collection (a flat type with too many items to ship, like 40,000 IoT
 * devices) is one node with exact counts; opening it pages its items from the
 * server, and search asks the server how many of its items match. Details of
 * anything are fetched by the drawer itself, so nothing here needs more than
 * the lean rows the map is built from.
 */

const PAGE_SIZE: number = 50;
const ROOT_ID: string = "__all__";
/* Up to this many containers the tree opens fully; beyond it, only categories. */
const TREE_EXPAND_ALL_LIMIT: number = 200;
/* Containers listed under one tree node before "Show all". */
const TREE_CHILD_LIMIT: number = 100;
const COLLECTION_SEARCH_DEBOUNCE_MS: number = 300;
const SYNTHETIC_ID_PATTERN: RegExp = /^(category|group|collection):/;

export interface ComponentProps {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
  /* Flat types summarized by the server; their items are paged on demand. */
  collections?: Array<InfrastructureCollection> | undefined;
  /* Exact inventory totals, used for the summary when a safety cap was hit. */
  totals?: InfrastructureTotals | undefined;
  truncation?: TopologyTruncation | null | undefined;
  metricsWindowSeconds: number;
  /** The range start the server used; activity is judged against it. */
  rangeStart?: Date | null | undefined;
  /*
   * The page's time range, for a traffic line's history. Without it a
   * line on the map is not clickable.
   */
  timeRange?: RangeStartAndEndDateTime | undefined;
  includeInactive?: boolean | undefined;
  /** Focus a service on the Service Map. */
  onOpenServiceMap?: ((serviceKey: string) => void) | undefined;
}

type InfrastructureView = "list" | "map";

type RequestStatus = "loading" | "ready" | "error";

interface CollectionFailure {
  message: string;
  /* The server speaks another format: reloading the page is the only cure. */
  isOutdated: boolean;
}

interface CollectionPageState {
  key: string;
  status: RequestStatus;
  page: CollectionPage | null;
  error: CollectionFailure | null;
}

interface CollectionSearchState {
  key: string;
  status: RequestStatus;
  counts: Map<string, number>;
  error: CollectionFailure | null;
}

interface CollectionMatch {
  node: InfrastructureNode;
  nameTerms: Array<string>;
  count: number;
}

interface ExplorerSummary {
  workloadCount: number;
  servicesPlaced: number;
  containerCount: number;
  /* Container id → its children that are containers too (the tree's rows). */
  containerChildren: Map<string, Array<string>>;
  collections: Array<InfrastructureNode>;
}

const BUTTON: string =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";

function iconForNode(node: InfrastructureNode): IconProp {
  if (node.kind === "category") {
    return IconProp.Folder;
  }
  if (node.kind === "group") {
    return IconProp.Squares;
  }
  return getInventoryTypeIcon(node.entityType || "");
}

function colorForNode(node: InfrastructureNode): string {
  return node.kind === "category"
    ? "#6366f1"
    : metaForEntityType(node.entityType || undefined).color;
}

function targetForEntity(entity: TopologyEntity): EntityDetailTarget | null {
  if (!entity.entityKey) {
    return null;
  }
  return {
    entityKey: entity.entityKey,
    entityType: entity.entityType,
    displayName: entity.displayName,
  };
}

function summarize(model: InfrastructureTopologyModel): ExplorerSummary {
  let workloadCount: number = 0;
  let containerCount: number = 0;
  const containerChildren: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const collections: Array<InfrastructureNode> = [];
  for (const node of model.nodes.values()) {
    if (
      node.kind === "group" ||
      node.entityType === EntityType.KubernetesDeployment ||
      node.entityType === EntityType.DockerSwarmService
    ) {
      workloadCount++;
    }
    if (node.kind === "collection") {
      collections.push(node);
    }
    if (!isContainerNode(node)) {
      continue;
    }
    containerCount++;
    containerChildren.set(
      node.id,
      node.childIds.filter((childId: string): boolean => {
        const child: InfrastructureNode | undefined = model.nodes.get(childId);
        return Boolean(child && isContainerNode(child));
      }),
    );
  }
  // Collection matches list in a stable order, whatever order they came in.
  collections.sort((a: InfrastructureNode, b: InfrastructureNode): number => {
    return compareNames(a.name, b.name);
  });
  const services: Set<string> = new Set<string>();
  for (const rootId of model.rootIds) {
    for (const key of model.nodes.get(rootId)?.serviceKeys || []) {
      services.add(key);
    }
  }
  return {
    workloadCount,
    servicesPlaced: services.size,
    containerCount,
    containerChildren,
    collections,
  };
}

const InfrastructureExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  /*
   * A busy server (429) is worth another try in a moment; a server that
   * speaks another format is not — only loading the matching page helps.
   */
  const describeError: (error: unknown) => CollectionFailure = (
    error: unknown,
  ): CollectionFailure => {
    const described: CollectionErrorDescription =
      describeCollectionError(error);
    if (described.isOutdated) {
      return {
        message: t("Topology was updated. Reload the page."),
        isOutdated: true,
      };
    }
    if (described.isBusy) {
      return {
        message: t("The topology service is busy. Try again in a moment."),
        isOutdated: false,
      };
    }
    return {
      message: described.detail || t("Something went wrong. Please try again."),
      isOutdated: false,
    };
  };

  const model: InfrastructureTopologyModel = useMemo(() => {
    return buildInfrastructureTopologyModel(
      props.entities,
      props.relationships,
      {
        rangeStart: props.rangeStart || undefined,
        includeInactive: props.includeInactive,
        collections: props.collections,
      },
    );
  }, [
    props.entities,
    props.relationships,
    props.collections,
    props.rangeStart,
    props.includeInactive,
  ]);

  const summary: ExplorerSummary = useMemo(() => {
    return summarize(model);
  }, [model]);

  /*
   * Search text is built lazily: most visits never search, and a large
   * estate's index is worth building once, not on every model rebuild.
   */
  const searchIndexCache: React.MutableRefObject<{
    model: InfrastructureTopologyModel;
    index: InfrastructureSearchIndex;
  } | null> = useRef<{
    model: InfrastructureTopologyModel;
    index: InfrastructureSearchIndex;
  } | null>(null);
  const searchIndexFor: () => InfrastructureSearchIndex =
    (): InfrastructureSearchIndex => {
      if (searchIndexCache.current?.model !== model) {
        searchIndexCache.current = {
          model,
          index: buildInfrastructureSearchIndex(model),
        };
      }
      return searchIndexCache.current.index;
    };

  /*
   * A focus from the URL may name a container (open it), a single resource
   * (open its parent and its details) or a resource the tree does not hold
   * (a collection's item, or one that is hidden) — the drawer shows that
   * one by itself. The Service Map and Inventory link to all of them.
   */
  const initialFocus: string | null =
    Navigation.getQueryStringByName("infraFocus");
  const [scopeId, setScopeId] = useState<string>(ROOT_ID);
  const [detailTarget, setDetailTarget] = useState<EntityDetailTarget | null>(
    null,
  );
  const [search, setSearch] = useState<string>(
    Navigation.getQueryStringByName("infraSearch") || "",
  );
  const [view, setView] = useState<InfrastructureView>(
    Navigation.getQueryStringByName("infraView") === "map" ? "map" : "list",
  );
  const [pages, setPages] = useState<Map<string, number>>(
    new Map<string, number>(),
  );
  /*
   * Tree expansion: an explicit choice per node (the user's toggle, or a
   * node on the path to something opened) over a default that depends on
   * the size of the tree — everything open when it is small, only the
   * categories when it is not.
   */
  const [expansion, setExpansion] = useState<Map<string, boolean>>(
    new Map<string, boolean>(),
  );
  const [treeShowAll, setTreeShowAll] = useState<Set<string>>(
    new Set<string>(),
  );
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);
  /* Name terms the open collection is filtered by (from a search match). */
  const [collectionFilter, setCollectionFilter] = useState<Array<string>>([]);
  /*
   * The keyset stack of the open collection: one cursor per page visited,
   * for the listing named by `baseKey`. It is only ever used for that
   * listing, and starts over whenever a scope is opened or the listing
   * changes (see below), so nothing reopens deep inside a collection.
   */
  const [collectionPaging, setCollectionPaging] = useState<{
    baseKey: string;
    cursors: Array<CollectionCursor | null>;
  }>({ baseKey: "", cursors: [null] });
  const [collectionPageState, setCollectionPageState] =
    useState<CollectionPageState | null>(null);
  const [collectionRetry, setCollectionRetry] = useState<number>(0);
  const [collectionSearch, setCollectionSearch] =
    useState<CollectionSearchState | null>(null);
  const [collectionSearchRetry, setCollectionSearchRetry] = useState<number>(0);
  const treeListRef: React.RefObject<HTMLUListElement> =
    useRef<HTMLUListElement>(null);

  const expandAllByDefault: boolean =
    summary.containerCount <= TREE_EXPAND_ALL_LIMIT;
  const isExpanded: (node: InfrastructureNode) => boolean = (
    node: InfrastructureNode,
  ): boolean => {
    const choice: boolean | undefined = expansion.get(node.id);
    if (choice !== undefined) {
      return choice;
    }
    return expandAllByDefault || node.kind === "category";
  };
  const expandPath: (id: string) => void = (id: string): void => {
    const path: Array<InfrastructureNode> = getInfrastructurePath(model, id);
    setExpansion((previous: Map<string, boolean>) => {
      const next: Map<string, boolean> = new Map<string, boolean>(previous);
      for (const node of path) {
        next.set(node.id, true);
      }
      return next;
    });
  };

  const targetForNode: (
    node: InfrastructureNode,
  ) => EntityDetailTarget | null = (
    node: InfrastructureNode,
  ): EntityDetailTarget | null => {
    return node.entity ? targetForEntity(node.entity) : null;
  };

  useEffect(() => {
    if (!initialFocus || appliedFocus === initialFocus) {
      return;
    }
    setAppliedFocus(initialFocus);
    const node: InfrastructureNode | undefined = model.nodes.get(initialFocus);
    if (!node) {
      /*
       * Not in the tree: the drawer looks the key up itself (and says so if
       * it is gone). A stale link to a group or category just falls back to
       * the overview.
       */
      if (!SYNTHETIC_ID_PATTERN.test(initialFocus)) {
        setDetailTarget({ entityKey: initialFocus });
      }
      return;
    }
    if (isContainerNode(node)) {
      setScopeId(node.id);
      expandPath(node.id);
    } else {
      setScopeId(node.parentId || ROOT_ID);
      if (node.parentId) {
        expandPath(node.parentId);
      }
      setDetailTarget(targetForNode(node));
    }
  }, [model, initialFocus]);

  /*
   * Bring the opened scope into view in the tree (a deep link can land far
   * down a long list). Only the tree scrolls, and only when the row is out
   * of its view — never the page.
   */
  useEffect(() => {
    const list: HTMLUListElement | null = treeListRef.current;
    const current: HTMLElement | null | undefined =
      list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !current) {
      return;
    }
    const top: number = current.offsetTop;
    const bottom: number = top + current.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  }, [appliedFocus]);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      Navigation.setQueryString({ infraSearch: search || null });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [search]);

  /*
   * Typing stays responsive on a large estate: the input updates at once and
   * the results follow as soon as React has time for them.
   */
  const deferredSearch: string = useDeferredValue(search);
  const searchTerms: Array<string> = useMemo(() => {
    return infrastructureSearchTerms(deferredSearch);
  }, [deferredSearch]);
  const searching: boolean = searchTerms.length > 0;

  useEffect(() => {
    setPages(new Map<string, number>());
  }, [scopeId, deferredSearch]);

  const scope: InfrastructureNode | null =
    scopeId === ROOT_ID ? null : model.nodes.get(scopeId) || null;
  const effectiveScopeId: string = scope ? scope.id : ROOT_ID;
  const path: Array<InfrastructureNode> = useMemo(() => {
    return getInfrastructurePath(model, scope?.id || null);
  }, [model, scope]);
  const pathIds: Set<string> = useMemo(() => {
    return new Set<string>(
      path.map((node: InfrastructureNode): string => {
        return node.id;
      }),
    );
  }, [path]);

  const openScope: (id: string, nameTerms?: Array<string>) => void = (
    id: string,
    nameTerms: Array<string> = [],
  ): void => {
    setScopeId(id);
    setSearch("");
    setCollectionFilter(nameTerms);
    // A collection always opens on its first page, even the one already open.
    setCollectionPaging({ baseKey: "", cursors: [null] });
    Navigation.setQueryString({
      infraFocus: id === ROOT_ID ? null : id,
      infraSearch: null,
    });
    // Opening something always reveals it in the tree.
    if (id !== ROOT_ID) {
      expandPath(id);
    }
  };
  const openNode: (id: string) => void = (id: string): void => {
    const node: InfrastructureNode | undefined = model.nodes.get(id);
    if (!node) {
      return;
    }
    if (isContainerNode(node)) {
      openScope(id);
    } else {
      const target: EntityDetailTarget | null = targetForNode(node);
      if (target) {
        setDetailTarget(target);
      }
    }
  };
  const openService: (serviceKey: string) => void = (
    serviceKey: string,
  ): void => {
    if (props.onOpenServiceMap) {
      props.onOpenServiceMap(serviceKey);
      return;
    }
    setDetailTarget({
      entityKey: serviceKey,
      entityType: EntityType.Service,
      displayName: model.serviceByKey.get(serviceKey)?.displayName,
    });
  };
  /*
   * A traffic line opens the history of the busiest call it stands for — the
   * Service Map's own drill-down, since traffic is measured per service
   * pair. One drawer at a time: it replaces a resource's details.
   */
  const [trafficCall, setTrafficCall] =
    useState<InfrastructureServiceCall | null>(null);
  const openTraffic: (link: InfrastructureTrafficLink) => void = (
    link: InfrastructureTrafficLink,
  ): void => {
    const busiest: InfrastructureServiceCall | undefined = link.serviceCalls[0];
    if (!busiest) {
      return;
    }
    setDetailTarget(null);
    setTrafficCall(busiest);
  };
  useEffect(() => {
    if (detailTarget) {
      setTrafficCall(null);
    }
  }, [detailTarget]);
  const serviceEntity: (key: string) => TopologyEntity = (
    key: string,
  ): TopologyEntity => {
    return (
      model.serviceByKey.get(key) || {
        entityKey: key,
        entityType: EntityType.Service,
      }
    );
  };

  const changeView: (value: InfrastructureView) => void = (
    value: InfrastructureView,
  ): void => {
    setView(value);
    Navigation.setQueryString({ infraView: value === "map" ? "map" : null });
  };

  const results: Array<InfrastructureNode> = useMemo(() => {
    if (!searching) {
      return [];
    }
    return searchInfrastructure(model, deferredSearch, searchIndexFor());
  }, [model, deferredSearch, searching]);

  /*
   * Collections are searched by the server, one count per collection. Terms
   * that match the collection's type label are satisfied by every item (as
   * they are for a resource in the tree), so a collection whose label
   * matches the whole query counts all of its items without asking.
   */
  const collectionQueries: Array<{
    node: InfrastructureNode;
    nameTerms: Array<string>;
  }> = useMemo(() => {
    if (!searching || !isCollectionSearchable(searchTerms)) {
      return [];
    }
    return summary.collections.map((node: InfrastructureNode) => {
      return {
        node,
        nameTerms: collectionNameTerms(node.entityType || "", searchTerms),
      };
    });
  }, [summary, searching, searchTerms]);
  const serverSearchTypes: Array<{
    entityType: string;
    nameTerms: Array<string>;
  }> = collectionQueries
    .filter((query: { nameTerms: Array<string> }): boolean => {
      return query.nameTerms.length > 0;
    })
    .map((query: { node: InfrastructureNode; nameTerms: Array<string> }) => {
      return {
        entityType: query.node.entityType || "",
        nameTerms: query.nameTerms,
      };
    });
  const collectionSearchKey: string =
    serverSearchTypes.length > 0 && props.rangeStart
      ? JSON.stringify([
          props.rangeStart.toISOString(),
          Boolean(props.includeInactive),
          serverSearchTypes,
        ])
      : "";

  useEffect(() => {
    if (!collectionSearchKey || !props.rangeStart) {
      return;
    }
    const rangeStart: Date = props.rangeStart;
    const key: string = collectionSearchKey;
    const types: Array<{ entityType: string; nameTerms: Array<string> }> =
      serverSearchTypes;
    const controller: AbortController = new AbortController();
    setCollectionSearch({
      key,
      status: "loading",
      counts: new Map<string, number>(),
      error: null,
    });
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      fetchCollectionSearchCounts(
        rangeStart,
        { includeInactive: Boolean(props.includeInactive), types },
        { signal: controller.signal },
      )
        .then((counts: Map<string, number>) => {
          if (!controller.signal.aborted) {
            setCollectionSearch({ key, status: "ready", counts, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setCollectionSearch({
              key,
              status: "error",
              counts: new Map<string, number>(),
              error: describeError(error),
            });
          }
        });
    }, COLLECTION_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [collectionSearchKey, collectionSearchRetry]);

  const currentCollectionSearch: CollectionSearchState | null =
    collectionSearch && collectionSearch.key === collectionSearchKey
      ? collectionSearch
      : null;
  const collectionSearchPending: boolean = Boolean(
    collectionSearchKey &&
      (!currentCollectionSearch ||
        currentCollectionSearch.status === "loading"),
  );
  const collectionMatches: Array<CollectionMatch> = collectionQueries
    .map(
      (query: {
        node: InfrastructureNode;
        nameTerms: Array<string>;
      }): CollectionMatch => {
        const count: number =
          query.nameTerms.length === 0
            ? query.node.resourceCount
            : currentCollectionSearch?.status === "ready"
              ? currentCollectionSearch.counts.get(
                  query.node.entityType || "",
                ) || 0
              : 0;
        return { node: query.node, nameTerms: query.nameTerms, count };
      },
    )
    .filter((match: CollectionMatch): boolean => {
      return match.count > 0;
    });
  let collectionMatchCount: number = 0;
  for (const match of collectionMatches) {
    collectionMatchCount += match.count;
  }

  // The open collection's items, a page at a time.
  const collectionScope: InfrastructureNode | null =
    scope && scope.kind === "collection" && !searching ? scope : null;
  const collectionBaseKey: string = collectionScope
    ? JSON.stringify([
        collectionScope.entityType,
        props.rangeStart ? props.rangeStart.toISOString() : "",
        Boolean(props.includeInactive),
        collectionFilter,
      ])
    : "";
  const collectionCursors: Array<CollectionCursor | null> =
    collectionPaging.baseKey === collectionBaseKey
      ? collectionPaging.cursors
      : [null];
  const collectionCursor: CollectionCursor | null =
    collectionCursors[collectionCursors.length - 1] || null;
  const collectionPageKey: string = collectionScope
    ? JSON.stringify([collectionBaseKey, collectionCursor])
    : "";

  /*
   * A stack belongs to the listing it was built for. When the listing
   * changes — another collection, the name filter, Show inactive, leaving
   * the collection — the stored stack is replaced by a fresh one for the
   * new listing, so switching back (say, Show inactive off again) starts at
   * page 1 instead of resuming a cursor that may point past the end. The
   * render in between already reads page 1 (the keys differ), so this never
   * fetches a stale page first.
   */
  useEffect(() => {
    setCollectionPaging(
      (previous: {
        baseKey: string;
        cursors: Array<CollectionCursor | null>;
      }) => {
        return previous.baseKey === collectionBaseKey
          ? previous
          : { baseKey: collectionBaseKey, cursors: [null] };
      },
    );
  }, [collectionBaseKey]);

  useEffect(() => {
    if (!collectionScope || !props.rangeStart) {
      return;
    }
    const key: string = collectionPageKey;
    const controller: AbortController = new AbortController();
    setCollectionPageState({ key, status: "loading", page: null, error: null });
    fetchCollectionPage(
      props.rangeStart,
      {
        entityType: collectionScope.entityType || "",
        includeInactive: Boolean(props.includeInactive),
        nameTerms: collectionFilter,
        cursor: collectionCursor,
        limit: PAGE_SIZE,
      },
      { signal: controller.signal },
    )
      .then((page: CollectionPage) => {
        if (!controller.signal.aborted) {
          setCollectionPageState({ key, status: "ready", page, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCollectionPageState({
            key,
            status: "error",
            page: null,
            error: describeError(error),
          });
        }
      });
    return () => {
      controller.abort();
    };
  }, [collectionPageKey, collectionRetry]);

  const mapCards: Array<string> = useMemo(() => {
    return collectMapCards(model, scope?.id || null);
  }, [model, scope]);
  const listedIds: Array<string> = searching
    ? results.map((node: InfrastructureNode): string => {
        return node.id;
      })
    : scope
      ? scope.childIds
      : [];

  /*
   * With a safety cap hit, the model holds only part of the estate; the
   * summary still reports the exact totals the server counted.
   */
  const capped: InfrastructureTotals | null =
    props.truncation && props.totals ? props.totals : null;
  const resourcesShown: number = capped
    ? props.includeInactive
      ? capped.resources
      : capped.activeResources
    : model.resourceCount;
  const inactiveHidden: number = props.includeInactive
    ? 0
    : capped
      ? Math.max(0, capped.resources - capped.activeResources)
      : model.inactiveCount;

  if (model.resourceCount === 0 && model.inactiveCount === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8">
        <EmptyState
          id="topology-empty"
          icon={IconProp.Layers}
          title="No infrastructure topology discovered yet"
          description="Connect a host or Kubernetes cluster to discover its resources and see what runs where. Resources also appear when you add them to Inventory."
          footer={
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
              )}
              className="text-sm font-medium text-indigo-600"
            >
              {t("Connect your infrastructure")}
            </Link>
          }
        />
      </div>
    );
  }

  const renderTree: (id: string, depth: number) => ReactElement | null = (
    id: string,
    depth: number,
  ): ReactElement | null => {
    const node: InfrastructureNode | undefined = model.nodes.get(id);
    if (!node) {
      return null;
    }
    const containers: Array<string> = summary.containerChildren.get(id) || [];
    const expanded: boolean = isExpanded(node);
    const selected: boolean = effectiveScopeId === id;
    /*
     * A level with thousands of containers lists the first ones and offers
     * the rest; whatever is on the way to the open scope is always listed.
     */
    const limited: boolean =
      containers.length > TREE_CHILD_LIMIT && !treeShowAll.has(id);
    const visible: Array<string> = limited
      ? containers.filter((childId: string, index: number): boolean => {
          return index < TREE_CHILD_LIMIT || pathIds.has(childId);
        })
      : containers;
    return (
      <li key={id}>
        <div
          className={`flex items-center gap-1 rounded-md pr-2 ${selected ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100"}`}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {containers.length > 0 ? (
            <button
              type="button"
              aria-label={`${t(expanded ? "Collapse" : "Expand")} ${node.kind === "category" ? t(node.name) : node.name}`}
              aria-expanded={expanded}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-700"
              onClick={() => {
                setExpansion((previous: Map<string, boolean>) => {
                  const next: Map<string, boolean> = new Map<string, boolean>(
                    previous,
                  );
                  next.set(id, !expanded);
                  return next;
                });
              }}
            >
              <Icon
                icon={expanded ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-3.5 w-3.5"
              />
            </button>
          ) : (
            <span className="h-6 w-6 flex-shrink-0" />
          )}
          <button
            type="button"
            data-testid={`infrastructure-tree-${id}`}
            aria-current={selected ? "true" : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm ${node.isActive ? "" : "opacity-60"}`}
            onClick={() => {
              openScope(id);
            }}
            title={node.name}
          >
            <span
              style={{ color: colorForNode(node) }}
              className="flex-shrink-0"
            >
              <Icon icon={iconForNode(node)} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {node.kind === "category" ? t(node.name) : node.name}
            </span>
            <span className="flex-shrink-0 rounded bg-white/70 px-1.5 text-xs text-gray-500">
              {(node.kind === "resource"
                ? node.resourceCount - 1
                : node.kind === "group"
                  ? node.childIds.length
                  : node.resourceCount
              ).toLocaleString()}
            </span>
          </button>
        </div>
        {containers.length > 0 && expanded && (
          <ul>
            {visible.map((childId: string): ReactElement | null => {
              return renderTree(childId, depth + 1);
            })}
            {limited && (
              <li>
                <button
                  type="button"
                  className="my-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  style={{ marginLeft: 4 + (depth + 1) * 14 + 28 }}
                  aria-label={`${t("Show all")} ${containers.length.toLocaleString()} ${t("in")} ${node.kind === "category" ? t(node.name) : node.name}`}
                  onClick={() => {
                    setTreeShowAll((previous: Set<string>) => {
                      return new Set<string>([...previous, id]);
                    });
                  }}
                >
                  {t("Show all")} {containers.length.toLocaleString()}
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const renderServiceChips: (node: InfrastructureNode) => ReactElement = (
    node: InfrastructureNode,
  ): ReactElement => {
    if (node.serviceKeys.length === 0) {
      return <span className="text-xs text-gray-400">—</span>;
    }
    return (
      <span className="flex flex-wrap gap-1">
        {node.serviceKeys.slice(0, 3).map((key: string): ReactElement => {
          const name: string =
            model.serviceByKey.get(key)?.displayName || "service";
          return props.onOpenServiceMap ? (
            <button
              key={key}
              type="button"
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
              aria-label={`${t("Show")} ${name} ${t("on the service map")}`}
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                props.onOpenServiceMap?.(key);
              }}
            >
              {name}
            </button>
          ) : (
            <span
              key={key}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
            >
              {name}
            </span>
          );
        })}
        {node.serviceKeys.length > 3 && (
          <span className="px-1 text-xs text-gray-500">
            +{node.serviceKeys.length - 3}
          </span>
        )}
      </span>
    );
  };

  const renderRow: (id: string) => ReactElement | null = (
    id: string,
  ): ReactElement | null => {
    const node: InfrastructureNode | undefined = model.nodes.get(id);
    if (!node) {
      return null;
    }
    const container: boolean = isContainerNode(node);
    const parent: InfrastructureNode | undefined = node.parentId
      ? model.nodes.get(node.parentId)
      : undefined;
    const typeLabel: string = metaForEntityType(
      node.entityType || undefined,
    ).label;
    return (
      <tr
        key={id}
        data-testid="infrastructure-row"
        className={`cursor-pointer hover:bg-gray-50 ${node.isActive ? "" : "text-gray-400"}`}
        onClick={() => {
          openNode(id);
        }}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
              style={{
                color: colorForNode(node),
                background: `${colorForNode(node)}14`,
              }}
              aria-hidden={true}
            >
              <Icon icon={iconForNode(node)} className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <button
                type="button"
                className="block min-w-[10rem] max-w-md break-words text-left text-sm font-medium text-gray-900 hover:text-indigo-600"
                aria-label={`${t(container ? "Open" : "View details for")} ${node.name}`}
                onClick={(event: React.MouseEvent) => {
                  event.stopPropagation();
                  openNode(id);
                }}
              >
                {node.name}
              </button>
              <span className="mt-0.5 block text-xs text-gray-500">
                {node.kind === "group"
                  ? t(`${typeLabel} replicas`)
                  : node.kind === "collection"
                    ? t("Collection")
                    : t(typeLabel)}
                {searching && parent && parent.kind !== "category"
                  ? ` · ${t("in")} ${parent.name}`
                  : ""}
              </span>
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
          {container
            ? node.kind === "group" || node.kind === "collection"
              ? describeInfrastructureNode(node)
              : summarizeCounts(node.countsByType) || "—"
            : "—"}
        </td>
        <td className="px-4 py-3">{renderServiceChips(node)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${node.isActive ? "bg-emerald-500" : "bg-gray-300"}`}
              aria-hidden={true}
            />
            <span className={node.isActive ? "text-gray-600" : "text-gray-400"}>
              {t(node.isActive ? "Active" : "Inactive")} ·{" "}
              {formatLastSeen(node.lastSeenAt || undefined)}
            </span>
          </span>
        </td>
        <td className="px-3 py-3 text-right text-gray-400">
          <Icon icon={IconProp.ChevronRight} className="ml-auto h-4 w-4" />
        </td>
      </tr>
    );
  };

  const renderPager: (data: {
    label: string;
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
  }) => ReactElement = (data: {
    label: string;
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
  }): ReactElement => {
    return (
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
        <span className="text-xs text-gray-500">{data.label}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!data.canGoBack}
            className={`${BUTTON} text-gray-600 disabled:opacity-40`}
            onClick={data.onBack}
          >
            {t("Previous")}
          </button>
          <button
            type="button"
            disabled={!data.canGoForward}
            className={`${BUTTON} text-gray-600 disabled:opacity-40`}
            onClick={data.onForward}
          >
            {t("Next")}
          </button>
        </div>
      </div>
    );
  };

  const renderTable: (tableId: string, ids: Array<string>) => ReactElement = (
    tableId: string,
    ids: Array<string>,
  ): ReactElement => {
    const pageCount: number = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    const currentPage: number = Math.min(
      pages.get(tableId) || 0,
      pageCount - 1,
    );
    const setPage: (page: number) => void = (page: number): void => {
      setPages((previous: Map<string, number>) => {
        return new Map<string, number>(previous).set(tableId, page);
      });
    };
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200">
        {/*
         * `relative` makes this the containing block of the header's
         * screen-reader-only label, which is absolutely positioned and would
         * otherwise escape the scroll region and widen the whole page.
         */}
        <div
          className="relative overflow-x-auto"
          role="region"
          aria-label={t("Resources")}
          tabIndex={0}
        >
          <table
            className="w-full text-left text-sm"
            data-testid="infrastructure-table"
          >
            <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Name")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Contains")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Services running")}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  {t("Last seen")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{t("Open")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ids
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map(renderRow)}
            </tbody>
          </table>
        </div>
        {pageCount > 1 &&
          renderPager({
            label: `${t("Page")} ${(currentPage + 1).toLocaleString()} / ${pageCount.toLocaleString()}`,
            canGoBack: currentPage > 0,
            canGoForward: currentPage + 1 < pageCount,
            onBack: () => {
              setPage(currentPage - 1);
            },
            onForward: () => {
              setPage(currentPage + 1);
            },
          })}
      </div>
    );
  };

  /*
   * The way out of a failed request: try again, or — when the server speaks
   * another format and no retry can succeed — reload the page.
   */
  const renderRecovery: (
    failure: CollectionFailure | null,
    onRetry: () => void,
    className: string,
  ) => ReactElement = (
    failure: CollectionFailure | null,
    onRetry: () => void,
    className: string,
  ): ReactElement => {
    if (failure?.isOutdated) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => {
            Navigation.reload();
          }}
        >
          {t("Reload page")}
        </button>
      );
    }
    return (
      <button type="button" className={className} onClick={onRetry}>
        {t("Try again")}
      </button>
    );
  };

  const renderCollectionTable: (
    collection: InfrastructureNode,
  ) => ReactElement = (collection: InfrastructureNode): ReactElement => {
    const state: CollectionPageState | null =
      collectionPageState && collectionPageState.key === collectionPageKey
        ? collectionPageState
        : null;
    const noun: (count: number) => string = (count: number): string => {
      return nounForType(collection.entityType || "", count);
    };
    const filterNote: ReactElement | null =
      collectionFilter.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span>
            {t("Names containing")}{" "}
            {collectionFilter
              .map((term: string): string => {
                return `“${term}”`;
              })
              .join(" + ")}
          </span>
          <button
            type="button"
            className="rounded text-indigo-600 hover:underline focus:ring-2 focus:ring-indigo-500"
            onClick={() => {
              setCollectionFilter([]);
            }}
          >
            {t("Show all")} {noun(2)}
          </button>
        </div>
      ) : null;

    if (!props.rangeStart) {
      return (
        <p className="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
          {t("Pick a time range to list these resources.")}
        </p>
      );
    }
    if (!state || state.status === "loading") {
      return (
        <div>
          {filterNote}
          <div
            role="status"
            aria-busy="true"
            className="rounded-xl border border-gray-200 px-6 py-10 text-center text-sm text-gray-500"
          >
            {t("Loading")} {collection.name}…
          </div>
        </div>
      );
    }
    if (state.status === "error" || !state.page) {
      return (
        <div>
          {filterNote}
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-6 py-6 text-center text-sm text-red-700"
          >
            <p>{state.error?.message}</p>
            {renderRecovery(
              state.error,
              () => {
                setCollectionRetry((value: number): number => {
                  return value + 1;
                });
              },
              `${BUTTON} mt-3 bg-white text-gray-700 shadow-sm hover:bg-gray-50`,
            )}
          </div>
        </div>
      );
    }
    const page: CollectionPage = state.page;
    const pageIndex: number = collectionCursors.length - 1;
    /*
     * The page shown always counts: after items past the cursor went away the
     * total can fall below this page, and "Page 3 of 2" reads as a bug.
     */
    const pageCount: number = Math.max(
      1,
      Math.ceil(page.total / PAGE_SIZE),
      pageIndex + 1,
    );
    const pager: ReactElement = renderPager({
      label: `${t("Page")} ${(pageIndex + 1).toLocaleString()} ${t("of")} ${pageCount.toLocaleString()} · ${page.total.toLocaleString()} ${noun(page.total)}`,
      canGoBack: pageIndex > 0,
      canGoForward: Boolean(page.nextCursor),
      onBack: () => {
        setCollectionPaging({
          baseKey: collectionBaseKey,
          cursors: collectionCursors.slice(0, -1),
        });
      },
      onForward: () => {
        setCollectionPaging({
          baseKey: collectionBaseKey,
          cursors: [...collectionCursors, page.nextCursor],
        });
      },
    });
    if (page.items.length === 0 && pageIndex > 0) {
      /*
       * The items past this page's cursor went away (pruned, archived or
       * renamed) after the previous page was read. The collection is not
       * empty, so say what happened and keep a way back.
       */
      return (
        <div>
          {filterNote}
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div
              className="px-6 py-10 text-center text-sm text-gray-500"
              data-testid="infrastructure-collection-page-empty"
            >
              <p>{t("No more items on this page.")}</p>
              <button
                type="button"
                className={`${BUTTON} mt-3 bg-white text-gray-700 shadow-sm hover:bg-gray-50`}
                onClick={() => {
                  setCollectionPaging({
                    baseKey: collectionBaseKey,
                    cursors: [null],
                  });
                }}
              >
                {t("Back to the first page")}
              </button>
            </div>
            {pager}
          </div>
        </div>
      );
    }
    return (
      <div>
        {filterNote}
        {page.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
            {collectionFilter.length > 0
              ? t("No items match this filter.")
              : t("Nothing inside this resource.")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div
              className="relative overflow-x-auto"
              role="region"
              aria-label={collection.name}
              tabIndex={0}
            >
              <table
                className="w-full text-left text-sm"
                data-testid="infrastructure-collection-table"
              >
                <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t("Name")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      {t("Last seen")}
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      <span className="sr-only">{t("Open")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {page.items.map((item: TopologyEntity): ReactElement => {
                    const target: EntityDetailTarget | null =
                      targetForEntity(item);
                    const name: string =
                      item.displayName || t("Unnamed resource");
                    const active: boolean =
                      !props.rangeStart ||
                      isEntityActive(item, props.rangeStart);
                    const open: () => void = (): void => {
                      if (target) {
                        setDetailTarget(target);
                      }
                    };
                    return (
                      <tr
                        key={item.entityKey}
                        data-testid="infrastructure-collection-row"
                        className={`cursor-pointer hover:bg-gray-50 ${active ? "" : "text-gray-400"}`}
                        onClick={open}
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="block min-w-[10rem] max-w-md break-words text-left text-sm font-medium text-gray-900 hover:text-indigo-600"
                            aria-label={`${t("View details for")} ${name}`}
                            onClick={(event: React.MouseEvent) => {
                              event.stopPropagation();
                              open();
                            }}
                          >
                            {name}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-gray-300"}`}
                              aria-hidden={true}
                            />
                            <span
                              className={
                                active ? "text-gray-600" : "text-gray-400"
                              }
                            >
                              {t(active ? "Active" : "Inactive")} ·{" "}
                              {formatLastSeen(item.lastSeenAt)}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-gray-400">
                          <Icon
                            icon={IconProp.ChevronRight}
                            className="ml-auto h-4 w-4"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </div>
        )}
      </div>
    );
  };

  const renderCollectionMatches: () => ReactElement | null =
    (): ReactElement | null => {
      if (
        collectionMatches.length === 0 &&
        !collectionSearchPending &&
        currentCollectionSearch?.status !== "error"
      ) {
        return null;
      }
      return (
        <div className="mb-4 space-y-2">
          {collectionMatches.map((match: CollectionMatch): ReactElement => {
            const label: string = `${match.count.toLocaleString()} ${t("matching")} ${nounForType(match.node.entityType || "", match.count)}`;
            return (
              <button
                key={match.node.id}
                type="button"
                data-testid="infrastructure-collection-match"
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onClick={() => {
                  openScope(match.node.id, match.nameTerms);
                }}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{
                    color: colorForNode(match.node),
                    background: `${colorForNode(match.node)}14`,
                  }}
                  aria-hidden={true}
                >
                  <Icon icon={iconForNode(match.node)} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">
                    {label}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {t("in")} {match.node.name}
                  </span>
                </span>
                <Icon
                  icon={IconProp.ChevronRight}
                  className="h-4 w-4 text-gray-400"
                />
              </button>
            );
          })}
          {collectionSearchPending && (
            <p role="status" className="px-1 text-xs text-gray-500">
              {t("Searching large collections…")}
            </p>
          )}
          {currentCollectionSearch?.status === "error" && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 px-1 text-xs text-red-700"
            >
              <span>
                {t("Could not search large collections.")}{" "}
                {currentCollectionSearch.error?.message}
              </span>
              {renderRecovery(
                currentCollectionSearch.error,
                () => {
                  setCollectionSearchRetry((value: number): number => {
                    return value + 1;
                  });
                },
                "rounded font-medium text-indigo-600 hover:underline focus:ring-2 focus:ring-indigo-500",
              )}
            </div>
          )}
        </div>
      );
    };

  const renderOverview: () => ReactElement = (): ReactElement => {
    return (
      <div className="space-y-6">
        {model.rootIds.map((rootId: string): ReactElement | null => {
          const category: InfrastructureNode | undefined =
            model.nodes.get(rootId);
          if (!category) {
            return null;
          }
          return (
            <section key={rootId} aria-label={t(category.name)}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t(category.name)}
                </h3>
                <span className="text-xs text-gray-400">
                  {summarizeCounts(category.countsByType)}
                </span>
              </div>
              {renderTable(rootId, category.childIds)}
            </section>
          );
        })}
      </div>
    );
  };

  /*
   * "Show where it is" for what the drawer shows: a resource in the tree
   * opens (or opens its parent), a service opens on the Service Map.
   * Anything else has no place on this page to show.
   */
  const detailNode: InfrastructureNode | undefined = detailTarget
    ? model.nodes.get(detailTarget.entityKey)
    : undefined;
  const detailIsService: boolean = Boolean(
    detailTarget &&
      !detailNode &&
      (detailTarget.entityType === EntityType.Service ||
        (!detailTarget.entityType &&
          model.serviceByKey.has(detailTarget.entityKey))),
  );
  const canFocusDetail: boolean = Boolean(
    detailNode || (detailIsService && props.onOpenServiceMap),
  );

  const searchedNothing: boolean =
    searching &&
    results.length === 0 &&
    collectionMatches.length === 0 &&
    !collectionSearchPending &&
    currentCollectionSearch?.status !== "error";

  return (
    <div data-testid="infrastructure-explorer" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Resources",
            count: resourcesShown,
            hint: "Reporting in this time range",
            icon: IconProp.Cube,
          },
          {
            label: "Workloads",
            count: summary.workloadCount,
            hint: "Deployments and groups of replicas",
            icon: IconProp.Squares,
          },
          {
            label: "Services placed",
            count: summary.servicesPlaced,
            hint: "Services with a known location",
            icon: IconProp.SquareStack,
          },
          {
            label: "Inactive not shown",
            count: inactiveHidden,
            hint: props.includeInactive
              ? "Inactive resources are included"
              : "Silent in this time range",
            icon: IconProp.Clock,
          },
        ].map(
          (stat: {
            label: string;
            count: number;
            hint: string;
            icon: IconProp;
          }): ReactElement => {
            return (
              <div
                key={stat.label}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-500">
                    {t(stat.label)}
                  </span>
                  <Icon icon={stat.icon} className="h-4 w-4 text-indigo-400" />
                </div>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
                  {stat.count.toLocaleString()}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {t(stat.hint)}
                </p>
              </div>
            );
          },
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {t("Infrastructure")}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {t(
                "Where your services run. Replicas of one workload are grouped; open anything to look inside.",
              )}
            </p>
          </div>
          <div
            role="group"
            aria-label={t("Infrastructure view")}
            className="flex self-start rounded-lg bg-gray-100 p-1"
          >
            {[
              { id: "list", label: "List", icon: IconProp.TableCells },
              { id: "map", label: "Map", icon: IconProp.FlowDiagram },
            ].map(
              (option: {
                id: string;
                label: string;
                icon: IconProp;
              }): ReactElement => {
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={view === option.id}
                    data-testid={`infrastructure-view-${option.id}`}
                    className={`${BUTTON} flex items-center gap-2 ${view === option.id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                    onClick={() => {
                      changeView(option.id as InfrastructureView);
                    }}
                  >
                    <Icon icon={option.icon} className="h-4 w-4" />
                    {t(option.label)}
                  </button>
                );
              },
            )}
          </div>
        </div>

        {model.resourceCount === 0 ? (
          <div
            className="px-6 py-12 text-center"
            data-testid="infrastructure-all-inactive"
          >
            <Icon
              icon={IconProp.Clock}
              className="mx-auto h-8 w-8 text-gray-300"
            />
            <h3 className="mt-3 text-sm font-semibold text-gray-900">
              {t("Nothing reported in this time range")}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {inactiveHidden.toLocaleString()}{" "}
              {t(
                "resources are known but have been silent. Pick a longer time range or show inactive resources.",
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row">
            <aside
              aria-label={t("Infrastructure tree")}
              className="border-b border-gray-200 bg-gray-50/70 p-3 lg:w-72 lg:flex-shrink-0 lg:border-b-0 lg:border-r"
            >
              <button
                type="button"
                data-testid="infrastructure-tree-root"
                aria-current={effectiveScopeId === ROOT_ID ? "true" : undefined}
                className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold ${effectiveScopeId === ROOT_ID ? "bg-indigo-50 text-indigo-700" : "text-gray-800 hover:bg-gray-100"}`}
                onClick={() => {
                  openScope(ROOT_ID);
                }}
              >
                <Icon icon={IconProp.Layers} className="h-4 w-4" />
                <span className="flex-1">{t("All infrastructure")}</span>
                <span className="text-xs font-normal text-gray-500">
                  {model.resourceCount.toLocaleString()}
                </span>
              </button>
              <ul
                ref={treeListRef}
                className="relative max-h-[60vh] overflow-y-auto"
              >
                {model.rootIds.map((rootId: string): ReactElement | null => {
                  return renderTree(rootId, 0);
                })}
              </ul>
            </aside>

            <div className="min-w-0 flex-1 p-5">
              <nav
                aria-label={t("Infrastructure location")}
                className="mb-3 flex flex-wrap items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  className="rounded text-indigo-600 hover:underline focus:ring-2 focus:ring-indigo-500"
                  onClick={() => {
                    openScope(ROOT_ID);
                  }}
                >
                  {t("All infrastructure")}
                </button>
                {path.map((node: InfrastructureNode): ReactElement => {
                  return (
                    <React.Fragment key={node.id}>
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-3 w-3 text-gray-400"
                      />
                      <button
                        type="button"
                        aria-current={
                          node.id === effectiveScopeId ? "location" : undefined
                        }
                        className="max-w-xs truncate rounded text-gray-600 hover:text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                        title={node.name}
                        onClick={() => {
                          openScope(node.id);
                        }}
                      >
                        {node.kind === "category" ? t(node.name) : node.name}
                      </button>
                    </React.Fragment>
                  );
                })}
              </nav>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                    style={{
                      color: scope ? colorForNode(scope) : "#6366f1",
                      background: `${scope ? colorForNode(scope) : "#6366f1"}14`,
                    }}
                    aria-hidden={true}
                  >
                    <Icon
                      icon={scope ? iconForNode(scope) : IconProp.Layers}
                      className="h-5 w-5"
                    />
                  </span>
                  <div className="min-w-0">
                    <h3
                      className="break-all text-base font-semibold text-gray-900"
                      data-testid="infrastructure-scope-title"
                    >
                      {searching
                        ? t("Search results")
                        : scope
                          ? scope.kind === "category"
                            ? t(scope.name)
                            : scope.name
                          : t("All infrastructure")}
                    </h3>
                    <p role="status" className="mt-0.5 text-xs text-gray-500">
                      {searching
                        ? `${(results.length + collectionMatchCount).toLocaleString()} ${t(results.length + collectionMatchCount === 1 ? "match" : "matches")}`
                        : scope
                          ? `${scope.kind === "resource" ? `${t(metaForEntityType(scope.entityType || undefined).label)} · ` : ""}${summarizeCounts(scope.countsByType, 4) || t("Empty")}`
                          : `${model.resourceCount.toLocaleString()} ${t("resources")}`}
                    </p>
                    {!searching && scope && scope.serviceKeys.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        {t("Runs")} {renderServiceChips(scope)}
                      </div>
                    )}
                  </div>
                </div>
                {!searching && scope?.entity && (
                  <button
                    type="button"
                    className={`${BUTTON} flex-shrink-0 border border-gray-200 text-gray-600 hover:bg-gray-50`}
                    onClick={() => {
                      setDetailTarget(targetForNode(scope));
                    }}
                  >
                    {t("View details")}
                  </button>
                )}
              </div>

              <div className="relative mb-4">
                <Icon
                  icon={IconProp.Search}
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
                />
                <input
                  type="search"
                  data-testid="topology-search"
                  aria-label={t("Search infrastructure")}
                  placeholder={t(
                    "Find a cluster, host, pod, workload or the service running on it…",
                  )}
                  value={search}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setSearch(event.target.value);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {searching && renderCollectionMatches()}

              {searchedNothing ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                  <Icon
                    icon={IconProp.Search}
                    className="mx-auto h-8 w-8 text-gray-300"
                  />
                  <h3 className="mt-3 text-sm font-semibold text-gray-900">
                    {t("No resources match your search")}
                  </h3>
                  <button
                    type="button"
                    className={`${BUTTON} mt-4 bg-indigo-600 text-white hover:bg-indigo-700`}
                    onClick={() => {
                      setSearch("");
                    }}
                  >
                    {t("Clear search")}
                  </button>
                </div>
              ) : searching ? (
                results.length > 0 ? (
                  renderTable("search", listedIds)
                ) : null
              ) : collectionScope ? (
                renderCollectionTable(collectionScope)
              ) : view === "map" ? (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <p className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
                    {t(
                      "The workloads and machines in this scope, the services running on them, and the calls between them. Open a card to look inside it.",
                    )}
                  </p>
                  <InfrastructureGraph
                    key={effectiveScopeId}
                    model={model}
                    nodeIds={mapCards}
                    metricsWindowSeconds={props.metricsWindowSeconds}
                    onOpenNode={openNode}
                    onOpenService={openService}
                    onOpenTraffic={props.timeRange ? openTraffic : undefined}
                    onShowAll={() => {
                      changeView("list");
                    }}
                  />
                </div>
              ) : scope ? (
                listedIds.length > 0 ? (
                  renderTable(scope.id, listedIds)
                ) : (
                  <p className="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
                    {t("Nothing inside this resource.")}
                  </p>
                )
              ) : (
                renderOverview()
              )}
            </div>
          </div>
        )}
      </div>

      {trafficCall && props.timeRange && (
        <EdgeDetailPanel
          key={`${trafficCall.from}->${trafficCall.to}`}
          fromEntity={serviceEntity(trafficCall.from)}
          toEntity={serviceEntity(trafficCall.to)}
          relationship={{
            fromEntityKey: trafficCall.from,
            toEntityKey: trafficCall.to,
            relationshipType: EntityRelationshipType.DependsOn,
            callCount: trafficCall.calls,
            errorCount: trafficCall.errors,
            avgDurationMs: trafficCall.avgDurationMs ?? undefined,
          }}
          timeRange={props.timeRange}
          metricsWindowSeconds={props.metricsWindowSeconds}
          onClose={() => {
            setTrafficCall(null);
          }}
        />
      )}

      {detailTarget && (
        /*
         * One drawer for every entity shown in turn: it stays open (and keeps
         * focus) while a connection row switches it to another entity, and
         * handles the switch itself.
         */
        <EntityDetailPanel
          entity={detailTarget}
          rangeStart={props.rangeStart}
          metricsWindowSeconds={props.metricsWindowSeconds}
          onClose={() => {
            setDetailTarget(null);
          }}
          onFocus={
            canFocusDetail
              ? (key: string) => {
                  setDetailTarget(null);
                  const node: InfrastructureNode | undefined =
                    model.nodes.get(key);
                  if (node && isContainerNode(node)) {
                    openScope(key);
                  } else if (node?.parentId) {
                    openScope(node.parentId);
                  } else if (!node) {
                    props.onOpenServiceMap?.(key);
                  }
                }
              : undefined
          }
          focusButtonLabel={
            detailNode ? "Show where it is" : "Show on the service map"
          }
          onSelectEntity={(target: EntityDetailTarget) => {
            setDetailTarget(target);
          }}
        />
      )}
    </div>
  );
};

export default InfrastructureExplorer;
