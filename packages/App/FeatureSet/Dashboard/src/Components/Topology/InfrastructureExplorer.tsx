import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { getInventoryTypeIcon } from "../Inventory/InventoryTypeCatalog";
import InfrastructureGraph from "./InfrastructureGraph";
import EntityDetailPanel from "./EntityDetailPanel";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  collectMapCards,
  describeInfrastructureNode,
  getInfrastructurePath,
  searchInfrastructure,
  summarizeCounts,
} from "./InfrastructureTopologyModel";
import { formatLastSeen } from "./TopologyActivity";
import { metaForEntityType } from "./TopologyMeta";

/*
 * Infrastructure: "what runs where", walked top-down.
 *
 * A tree on the left holds only things that contain other things — categories,
 * clusters, namespaces, deployments, groups of replicas — so it stays short
 * even for a large estate. The right side shows what is inside the selected
 * scope, as a table (every row says what it contains and which services run
 * there) or as a map of that one level. Fleets are grouped by workload, and
 * resources that did not report in the selected range are left out unless the
 * page asks for them.
 */

const PAGE_SIZE: number = 50;
const ROOT_ID: string = "__all__";

export interface ComponentProps {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  metricsWindowSeconds: number;
  rangeStart?: Date | null | undefined;
  includeInactive?: boolean | undefined;
  /** Focus a service on the Service Map. */
  onOpenServiceMap?: ((serviceKey: string) => void) | undefined;
}

type InfrastructureView = "list" | "map";

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

const InfrastructureExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const model: InfrastructureTopologyModel = useMemo(() => {
    return buildInfrastructureTopologyModel(
      props.entities,
      props.relationships,
      {
        rangeStart: props.rangeStart || undefined,
        includeInactive: props.includeInactive,
      },
    );
  }, [
    props.entities,
    props.relationships,
    props.rangeStart,
    props.includeInactive,
  ]);

  const entityByKey: Map<string, InventoryItem> = useMemo(() => {
    const map: Map<string, InventoryItem> = new Map<string, InventoryItem>();
    for (const entity of props.entities) {
      if (entity.entityKey) {
        map.set(entity.entityKey, entity);
      }
    }
    return map;
  }, [props.entities]);

  /*
   * A focus from the URL may name a container (open it) or a single resource
   * (open its parent and its details) — the Service Map links to both.
   */
  const initialFocus: string | null =
    Navigation.getQueryStringByName("infraFocus");
  const [scopeId, setScopeId] = useState<string>(ROOT_ID);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [search, setSearch] = useState<string>(
    Navigation.getQueryStringByName("infraSearch") || "",
  );
  const [view, setView] = useState<InfrastructureView>(
    Navigation.getQueryStringByName("infraView") === "map" ? "map" : "list",
  );
  const [page, setPage] = useState<number>(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set<string>());
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!initialFocus || appliedFocus === initialFocus) {
      return;
    }
    const node: InfrastructureNode | undefined = model.nodes.get(initialFocus);
    if (!node) {
      return;
    }
    setAppliedFocus(initialFocus);
    if (node.childIds.length > 0) {
      setScopeId(node.id);
    } else {
      setScopeId(node.parentId || ROOT_ID);
      if (node.entity) {
        setDetailKey(node.id);
      }
    }
  }, [model, initialFocus]);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      Navigation.setQueryString({ infraSearch: search || null });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [scopeId, search]);

  const scope: InfrastructureNode | null =
    scopeId === ROOT_ID ? null : model.nodes.get(scopeId) || null;
  const effectiveScopeId: string = scope ? scope.id : ROOT_ID;
  const path: Array<InfrastructureNode> = getInfrastructurePath(
    model,
    scope?.id || null,
  );

  const openScope: (id: string) => void = (id: string): void => {
    setScopeId(id);
    setSearch("");
    Navigation.setQueryString({
      infraFocus: id === ROOT_ID ? null : id,
      infraSearch: null,
    });
    // Opening something always reveals it in the tree.
    setCollapsed((previous: Set<string>) => {
      const next: Set<string> = new Set<string>(previous);
      for (const node of getInfrastructurePath(model, id)) {
        next.delete(node.id);
      }
      return next;
    });
  };
  const openNode: (id: string) => void = (id: string): void => {
    const node: InfrastructureNode | undefined = model.nodes.get(id);
    if (!node) {
      return;
    }
    if (node.childIds.length > 0) {
      openScope(id);
    } else if (node.entity) {
      setDetailKey(id);
    }
  };
  const changeView: (value: InfrastructureView) => void = (
    value: InfrastructureView,
  ): void => {
    setView(value);
    Navigation.setQueryString({ infraView: value === "map" ? "map" : null });
  };

  const searching: boolean = search.trim().length > 0;
  const results: Array<InfrastructureNode> = useMemo(() => {
    return searchInfrastructure(model, search);
  }, [model, search]);

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

  const workloadCount: number = Array.from(model.nodes.values()).filter(
    (node: InfrastructureNode): boolean => {
      return (
        node.kind === "group" ||
        node.entityType === "k8s.deployment" ||
        node.entityType === "docker.swarm.service"
      );
    },
  ).length;

  const servicesPlaced: number = new Set<string>(
    model.rootIds.flatMap((rootId: string): Array<string> => {
      return model.nodes.get(rootId)?.serviceKeys || [];
    }),
  ).size;

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
    const containers: Array<string> = node.childIds.filter(
      (childId: string): boolean => {
        return (model.nodes.get(childId)?.childIds.length || 0) > 0;
      },
    );
    const isCollapsed: boolean = collapsed.has(id);
    const selected: boolean = effectiveScopeId === id;
    return (
      <li key={id}>
        <div
          className={`flex items-center gap-1 rounded-md pr-2 ${selected ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-100"}`}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {containers.length > 0 ? (
            <button
              type="button"
              aria-label={`${t(isCollapsed ? "Expand" : "Collapse")} ${node.name}`}
              aria-expanded={!isCollapsed}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-700"
              onClick={() => {
                setCollapsed((previous: Set<string>) => {
                  const next: Set<string> = new Set<string>(previous);
                  if (next.has(id)) {
                    next.delete(id);
                  } else {
                    next.add(id);
                  }
                  return next;
                });
              }}
            >
              <Icon
                icon={
                  isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown
                }
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
              {node.kind === "resource"
                ? node.resourceCount - 1
                : node.kind === "group"
                  ? node.childIds.length
                  : node.resourceCount}
            </span>
          </button>
        </div>
        {containers.length > 0 && !isCollapsed && (
          <ul>
            {containers.map((childId: string): ReactElement | null => {
              return renderTree(childId, depth + 1);
            })}
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
    const container: boolean = node.childIds.length > 0;
    const parent: InfrastructureNode | undefined = node.parentId
      ? model.nodes.get(node.parentId)
      : undefined;
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
                  ? t(
                      `${metaForEntityType(node.entityType || undefined).label} replicas`,
                    )
                  : t(metaForEntityType(node.entityType || undefined).label)}
                {searching && parent && parent.kind !== "category"
                  ? ` · ${t("in")} ${parent.name}`
                  : ""}
              </span>
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
          {container
            ? node.kind === "group"
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

  const renderTable: (ids: Array<string>) => ReactElement = (
    ids: Array<string>,
  ): ReactElement => {
    const pageCount: number = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    const currentPage: number = Math.min(page, pageCount - 1);
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
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <span className="text-xs text-gray-500">
              {t("Page")} {currentPage + 1} / {pageCount}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage === 0}
                className={`${BUTTON} text-gray-600 disabled:opacity-40`}
                onClick={() => {
                  setPage(currentPage - 1);
                }}
              >
                {t("Previous")}
              </button>
              <button
                type="button"
                disabled={currentPage + 1 >= pageCount}
                className={`${BUTTON} text-gray-600 disabled:opacity-40`}
                onClick={() => {
                  setPage(currentPage + 1);
                }}
              >
                {t("Next")}
              </button>
            </div>
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
              {renderTable(category.childIds)}
            </section>
          );
        })}
      </div>
    );
  };

  const detailNode: InfrastructureNode | undefined = detailKey
    ? model.nodes.get(detailKey)
    : undefined;

  return (
    <div data-testid="infrastructure-explorer" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Resources",
            count: model.resourceCount,
            hint: "Reporting in this time range",
            icon: IconProp.Cube,
          },
          {
            label: "Workloads",
            count: workloadCount,
            hint: "Deployments and groups of replicas",
            icon: IconProp.Squares,
          },
          {
            label: "Services placed",
            count: servicesPlaced,
            hint: "Services with a known location",
            icon: IconProp.SquareStack,
          },
          {
            label: "Inactive not shown",
            count: props.includeInactive ? 0 : model.inactiveCount,
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
              {model.inactiveCount}{" "}
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
                  {model.resourceCount}
                </span>
              </button>
              <ul className="max-h-[60vh] overflow-y-auto">
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
                        ? `${results.length} ${t(results.length === 1 ? "match" : "matches")}`
                        : scope
                          ? `${scope.kind === "resource" ? `${t(metaForEntityType(scope.entityType || undefined).label)} · ` : ""}${summarizeCounts(scope.countsByType, 4) || t("Empty")}`
                          : `${model.resourceCount} ${t("resources")}`}
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
                      setDetailKey(scope.id);
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

              {searching && results.length === 0 ? (
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
              ) : view === "map" && !searching ? (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <p className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
                    {t(
                      "The workloads and machines in this scope, and the services running on them. Open a card to look inside it.",
                    )}
                  </p>
                  <InfrastructureGraph
                    key={effectiveScopeId}
                    model={model}
                    nodeIds={mapCards}
                    onOpenNode={openNode}
                    onOpenService={(serviceKey: string) => {
                      if (props.onOpenServiceMap) {
                        props.onOpenServiceMap(serviceKey);
                      } else {
                        setDetailKey(serviceKey);
                      }
                    }}
                    onShowAll={() => {
                      changeView("list");
                    }}
                  />
                </div>
              ) : searching || scope ? (
                listedIds.length > 0 ? (
                  renderTable(listedIds)
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

      {detailKey && (detailNode?.entity || entityByKey.get(detailKey)) && (
        <EntityDetailPanel
          entity={(detailNode?.entity || entityByKey.get(detailKey))!}
          relationships={props.relationships}
          entityByKey={entityByKey}
          metricsWindowSeconds={props.metricsWindowSeconds}
          onClose={() => {
            setDetailKey(null);
          }}
          onFocus={(key: string) => {
            setDetailKey(null);
            const node: InfrastructureNode | undefined = model.nodes.get(key);
            if (node && node.childIds.length > 0) {
              openScope(key);
            } else if (node?.parentId) {
              openScope(node.parentId);
            } else if (props.onOpenServiceMap && model.serviceByKey.has(key)) {
              props.onOpenServiceMap(key);
            }
          }}
          focusButtonLabel={
            model.serviceByKey.has(detailKey)
              ? "Show on the service map"
              : "Show where it is"
          }
          onSelectEntity={(key: string) => {
            if (model.nodes.has(key) || entityByKey.has(key)) {
              setDetailKey(key);
            }
          }}
        />
      )}
    </div>
  );
};

export default InfrastructureExplorer;
