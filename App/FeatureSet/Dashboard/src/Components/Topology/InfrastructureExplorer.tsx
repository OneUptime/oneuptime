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
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import InfrastructureGraph from "./InfrastructureGraph";
import EntityDetailPanel from "./EntityDetailPanel";
import { metaForEntityType, labelForRelationship } from "./TopologyMeta";
import {
  buildInfrastructureExplorerModel,
  findInfrastructureResources,
  getInfrastructureBreadcrumbs,
  getInfrastructureDescendants,
  InfrastructureExplorerModel,
  InfrastructureResource,
} from "./InfrastructureExplorerModel";

const PAGE_SIZE: number = 40;
export interface ComponentProps {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  metricsWindowSeconds: number;
}

const BUTTON: string =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";

const InfrastructureExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };
  const [search, setSearch] = useState<string>(
    Navigation.getQueryStringByName("infraSearch") || "",
  );
  const [scopeKey, setScopeKey] = useState<string | null>(
    Navigation.getQueryStringByName("infraFocus"),
  );
  const [type, setType] = useState<string | null>(
    Navigation.getQueryStringByName("infraType"),
  );
  const [view, setView] = useState<string>(
    Navigation.getQueryStringByName("infraView") === "map" ? "map" : "explore",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState<number>(0);
  const model: InfrastructureExplorerModel = useMemo(() => {
    return buildInfrastructureExplorerModel(
      props.entities,
      props.relationships,
    );
  }, [props.entities, props.relationships]);
  const scope: InfrastructureResource | undefined = scopeKey
    ? model.resources.get(scopeKey)
    : undefined;
  const effectiveScopeKey: string | null = scope?.key || null;
  const selected: InfrastructureResource | undefined = selectedKey
    ? model.resources.get(selectedKey)
    : undefined;
  const entityByKey: Map<string, InventoryItem> = useMemo(() => {
    return new Map(
      props.entities
        .filter((entity: InventoryItem): boolean => {
          return Boolean(entity.entityKey);
        })
        .map((entity: InventoryItem): [string, InventoryItem] => {
          return [entity.entityKey!, entity];
        }),
    );
  }, [props.entities]);
  const allInScope: Array<InfrastructureResource> = useMemo(() => {
    return findInfrastructureResources(model, {
      scopeKey: effectiveScopeKey,
      search: "",
      type: null,
    });
  }, [model, effectiveScopeKey]);
  const types: Array<{ type: string; count: number }> = useMemo(() => {
    const counts: Map<string, number> = new Map();
    for (const resource of allInScope) {
      counts.set(resource.type, (counts.get(resource.type) || 0) + 1);
    }
    return Array.from(counts, ([type, count]: [string, number]) => {
      return { type, count };
    }).sort((a: { type: string }, b: { type: string }): number => {
      return metaForEntityType(a.type).label.localeCompare(
        metaForEntityType(b.type).label,
      );
    });
  }, [allInScope]);
  const results: Array<InfrastructureResource> = useMemo(() => {
    return findInfrastructureResources(model, {
      scopeKey: effectiveScopeKey,
      search,
      type,
    });
  }, [model, effectiveScopeKey, search, type]);
  const filtered: boolean = Boolean(search.trim() || type);
  const childKeys: Array<string> = scope
    ? model.childrenOf.get(scope.key) || []
    : model.roots;
  const groups: Array<InfrastructureResource> = childKeys
    .filter((key: string): boolean => {
      return Boolean(model.childrenOf.get(key)?.length);
    })
    .map((key: string): InfrastructureResource => {
      return model.resources.get(key)!;
    })
    .sort((a: InfrastructureResource, b: InfrastructureResource): number => {
      return a.name.localeCompare(b.name);
    });
  const showOverview: boolean = !filtered && (!scope || childKeys.length > 0);
  const directResources: Array<InfrastructureResource> = childKeys
    .filter((key: string): boolean => {
      return !model.childrenOf.get(key)?.length;
    })
    .map((key: string): InfrastructureResource => {
      return model.resources.get(key)!;
    })
    .sort((a: InfrastructureResource, b: InfrastructureResource): number => {
      return a.name.localeCompare(b.name);
    });
  const listedResources: Array<InfrastructureResource> = showOverview
    ? directResources
    : results;
  const pageCount: number = Math.max(
    1,
    Math.ceil(listedResources.length / PAGE_SIZE),
  );
  const currentPage: number = Math.min(page, pageCount - 1);
  const breadcrumbs: Array<InfrastructureResource> =
    getInfrastructureBreadcrumbs(model, effectiveScopeKey);

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
  }, [search, type, effectiveScopeKey]);
  const openScope: (key: string | null) => void = (
    key: string | null,
  ): void => {
    setScopeKey(key);
    setSearch("");
    setType(null);
    setSelectedKey(null);
    setPage(0);
    Navigation.setQueryString({
      infraFocus: key,
      infraSearch: null,
      infraType: null,
    });
  };
  const selectType: (value: string | null) => void = (
    value: string | null,
  ): void => {
    setType(value);
    setPage(0);
    Navigation.setQueryString({ infraType: value });
  };
  const resetFilters: () => void = (): void => {
    setSearch("");
    selectType(null);
    Navigation.setQueryString({ infraSearch: null });
  };
  // Keep map inputs stable while opening a drawer so inspection does not reset pan/zoom.
  const mapKeys: Set<string> = useMemo(() => {
    const keys: Set<string> = new Set(
      results.map((resource: InfrastructureResource): string => {
        return resource.key;
      }),
    );
    if (scope && !filtered) {
      keys.add(scope.key);
    }
    return keys;
  }, [results, scope, filtered]);
  const mapEntities: Array<InventoryItem> = useMemo(() => {
    return Array.from(mapKeys, (key: string): InventoryItem => {
      const resource: InfrastructureResource = model.resources.get(key)!;
      if (resource.entity) {
        return resource.entity;
      }
      const placeholder: InventoryItem = new InventoryItem();
      placeholder.entityKey = key;
      placeholder.displayName = resource.name;
      return placeholder;
    });
  }, [mapKeys, model]);
  const mapRelationships: Array<InventoryItemRelationship> = useMemo(() => {
    return model.relationships.filter(
      (edge: InventoryItemRelationship): boolean => {
        return (
          mapKeys.has(edge.fromEntityKey!) && mapKeys.has(edge.toEntityKey!)
        );
      },
    );
  }, [mapKeys, model]);
  const collections: Map<string, number> = new Map();
  for (const resource of directResources) {
    collections.set(
      resource.type,
      types.find((item: { type: string; count: number }): boolean => {
        return item.type === resource.type;
      })?.count || 0,
    );
  }

  const renderList: () => ReactElement = (): ReactElement => {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t("Resource")}
          </h3>
          <span className="text-xs text-gray-500">
            {listedResources.length} {t("resources")}
          </span>
        </div>
        <ul className="divide-y divide-gray-100">
          {listedResources
            .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
            .map((resource: InfrastructureResource): ReactElement => {
              const parent: InfrastructureResource | undefined =
                model.resources.get(model.parentOf.get(resource.key) || "");
              const hasChildren: boolean = Boolean(
                model.childrenOf.get(resource.key)?.length,
              );
              return (
                <li
                  key={resource.key}
                  className="flex items-center gap-3 px-4 py-1 hover:bg-gray-50"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onClick={() => {
                      setSelectedKey(resource.key);
                    }}
                  >
                    <span
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50"
                      style={{ color: metaForEntityType(resource.type).color }}
                    >
                      <Icon
                        icon={hasChildren ? IconProp.Layers : IconProp.Cube}
                        className="h-5 w-5"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-gray-900">
                        {resource.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {t(metaForEntityType(resource.type).label)}
                        {parent ? ` · ${parent.name}` : ""}
                      </span>
                    </span>
                    <span className="hidden flex-shrink-0 text-xs text-gray-500 sm:block">
                      {model.neighborsOf.get(resource.key)?.size || 0}{" "}
                      {t(
                        (model.neighborsOf.get(resource.key)?.size || 0) === 1
                          ? "connection"
                          : "connections",
                      )}
                    </span>
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-4 w-4 flex-shrink-0 text-gray-400"
                    />
                  </button>
                  {hasChildren && (
                    <button
                      type="button"
                      className={`${BUTTON} text-indigo-600 hover:bg-indigo-50`}
                      aria-label={`${t("Explore")} ${resource.name}`}
                      onClick={() => {
                        openScope(resource.key);
                      }}
                    >
                      {t("Explore")}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
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

  if (model.resources.size === 0) {
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

  return (
    <div data-testid="infrastructure-explorer" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Resources",
            count: model.resources.size,
            hint: "Across your inventory",
            icon: IconProp.Cube,
          },
          {
            label: "Groups",
            count: model.childrenOf.size,
            hint: "Resources with children",
            icon: IconProp.Layers,
          },
          {
            label: "Connections",
            count: model.relationships.length,
            hint: "Observed infrastructure relationships",
            icon: IconProp.FlowDiagram,
          },
          {
            label: "Unlinked resources",
            count: model.unlinkedCount,
            hint: "No observed infrastructure connection",
            icon: IconProp.Server,
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
                title={t(stat.hint)}
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
                <p className="sr-only">{t(stat.hint)}</p>
              </div>
            );
          },
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {t("Infrastructure explorer")}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {t("Start with a group, then explore the resources inside it.")}
            </p>
          </div>
          <div
            role="group"
            aria-label={t("Infrastructure view")}
            className="flex self-start rounded-lg bg-gray-100 p-1"
          >
            {[
              { id: "explore", label: "Explore", icon: IconProp.Grid },
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
                    className={`${BUTTON} flex items-center gap-2 ${view === option.id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
                    onClick={() => {
                      setView(option.id);
                      Navigation.setQueryString({
                        infraView: option.id === "map" ? "map" : null,
                      });
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
        <div className="flex flex-col lg:flex-row">
          <aside
            aria-label={t("Resource types")}
            className="border-b border-gray-200 bg-gray-50 p-4 lg:w-56 lg:flex-shrink-0 lg:border-b-0 lg:border-r"
          >
            <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("Browse resources")}
            </p>
            <div className="flex flex-wrap gap-1 lg:flex-col">
              <button
                type="button"
                aria-pressed={!type}
                onClick={() => {
                  selectType(null);
                }}
                className={`${BUTTON} flex items-center justify-between gap-4 text-left ${!type ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-white"}`}
              >
                <span>{t("All types")}</span>
                <span className="text-xs">{allInScope.length}</span>
              </button>
              {types.map(
                (item: { type: string; count: number }): ReactElement => {
                  return (
                    <button
                      key={item.type}
                      type="button"
                      aria-pressed={type === item.type}
                      className={`${BUTTON} flex items-center justify-between gap-3 text-left ${type === item.type ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-white"}`}
                      onClick={() => {
                        selectType(type === item.type ? null : item.type);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor: metaForEntityType(item.type).color,
                          }}
                        />
                        {t(metaForEntityType(item.type).label)}
                      </span>
                      <span className="text-xs">{item.count}</span>
                    </button>
                  );
                },
              )}
            </div>
            <div className="mt-6 hidden border-t border-gray-200 px-2 pt-4 lg:block">
              <p className="text-xs font-medium text-gray-700">
                {t("How to read this view")}
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                {t(
                  "Groups show what runs together. Open a resource for its connections and inventory details. Switch to Map to see the relationships visually.",
                )}
              </p>
            </div>
          </aside>
          <div className="min-w-0 flex-1 p-5">
            <nav
              aria-label={t("Infrastructure location")}
              className="mb-3 flex flex-wrap items-center gap-2 text-xs"
            >
              <button
                type="button"
                className="rounded text-indigo-600 hover:underline focus:ring-2 focus:ring-indigo-500"
                onClick={() => {
                  openScope(null);
                }}
              >
                {t("All infrastructure")}
              </button>
              {breadcrumbs.map(
                (resource: InfrastructureResource): ReactElement => {
                  return (
                    <React.Fragment key={resource.key}>
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-3 w-3 text-gray-400"
                      />
                      <button
                        type="button"
                        aria-current={
                          resource.key === effectiveScopeKey
                            ? "location"
                            : undefined
                        }
                        className="max-w-xs truncate rounded text-gray-600 hover:text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                        title={resource.name}
                        onClick={() => {
                          openScope(resource.key);
                        }}
                      >
                        {resource.name}
                      </button>
                    </React.Fragment>
                  );
                },
              )}
            </nav>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Icon
                  icon={IconProp.Search}
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
                />
                <input
                  type="search"
                  data-testid="topology-search"
                  aria-label={t("Search infrastructure")}
                  placeholder={
                    scope
                      ? t(
                          model.childrenOf.has(scope.key)
                            ? "Search within this group…"
                            : "Search connected resources…",
                        )
                      : t("Find a cluster, host, service, or resource…")
                  }
                  value={search}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setSearch(event.target.value);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              {filtered && (
                <button
                  type="button"
                  className={`${BUTTON} text-indigo-600 hover:bg-indigo-50`}
                  onClick={resetFilters}
                >
                  {t("Clear filters")}
                </button>
              )}
            </div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {filtered
                    ? t("Search results")
                    : scope?.name || t("Your infrastructure at a glance")}
                </h3>
                <p role="status" className="mt-1 text-xs text-gray-500">
                  {results.length}{" "}
                  {t(
                    filtered ? "matching resources" : "resources in this view",
                  )}
                  {type ? ` · ${t(metaForEntityType(type).label)}` : ""}
                </p>
              </div>
              {scope && (
                <button
                  type="button"
                  className={`${BUTTON} border border-gray-200 text-gray-600 hover:bg-gray-50`}
                  onClick={() => {
                    setSelectedKey(scope.key);
                  }}
                >
                  {t("View resource details")}
                </button>
              )}
            </div>
            {results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <Icon
                  icon={IconProp.Search}
                  className="mx-auto h-8 w-8 text-gray-300"
                />
                <h3 className="mt-3 text-sm font-semibold text-gray-900">
                  {t("No resources match your filters")}
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  {t(
                    "Try another name or clear the filters to see everything in this view.",
                  )}
                </p>
                <button
                  type="button"
                  className={`${BUTTON} mt-4 bg-indigo-600 text-white hover:bg-indigo-700`}
                  onClick={resetFilters}
                >
                  {t("Clear filters")}
                </button>
                {scope && (
                  <button
                    type="button"
                    className={`${BUTTON} ml-2 mt-4 text-indigo-600`}
                    onClick={() => {
                      openScope(null);
                    }}
                  >
                    {t("Search all infrastructure")}
                  </button>
                )}
              </div>
            ) : view === "map" ? (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <p className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                  {t(
                    "Boxes contain their child resources. Select a resource for details; drag the canvas to pan and use the controls to zoom.",
                  )}
                </p>
                <InfrastructureGraph
                  key={`${effectiveScopeKey || "all"}-${type || "all"}`}
                  entities={mapEntities}
                  relationships={mapRelationships}
                  onSelectResource={setSelectedKey}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {showOverview && groups.length > 0 && (
                  <section aria-label={t("Infrastructure groups")}>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {groups.map(
                        (group: InfrastructureResource): ReactElement => {
                          const descendants: Array<string> =
                            getInfrastructureDescendants(model, group.key);
                          const counts: Map<string, number> = new Map();
                          for (const key of descendants) {
                            const kind: string = model.resources.get(key)!.type;
                            counts.set(kind, (counts.get(kind) || 0) + 1);
                          }
                          return (
                            <button
                              type="button"
                              key={group.key}
                              aria-label={`${t("Explore")} ${group.name}`}
                              onClick={() => {
                                openScope(group.key);
                              }}
                              className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <div className="mb-4 flex w-full items-center justify-between">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                                  <Icon
                                    icon={IconProp.Layers}
                                    className="h-5 w-5"
                                  />
                                </span>
                                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                                  {descendants.length}{" "}
                                  {t(
                                    descendants.length === 1
                                      ? "resource"
                                      : "resources",
                                  )}
                                </span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {t(metaForEntityType(group.type).label)}
                              </span>
                              <span className="mt-1 break-all text-sm font-semibold text-gray-900">
                                {group.name}
                              </span>
                              <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                                {Array.from(counts)
                                  .slice(0, 3)
                                  .map(
                                    ([kind, count]: [
                                      string,
                                      number,
                                    ]): ReactElement => {
                                      return (
                                        <span key={kind}>
                                          {count}{" "}
                                          {t(metaForEntityType(kind).label)}
                                        </span>
                                      );
                                    },
                                  )}
                                {counts.size > 3
                                  ? ` +${counts.size - 3} ${t("types")}`
                                  : ""}
                              </span>
                              <span className="mt-auto flex items-center gap-2 pt-5 text-xs font-medium text-indigo-600">
                                {t("Explore resources")}
                                <Icon
                                  icon={IconProp.ArrowRight}
                                  className="h-4 w-4"
                                />
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  </section>
                )}
                {showOverview && !scope && directResources.length > 0 ? (
                  <section>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t(
                        groups.length
                          ? "More resources"
                          : "Browse by resource type",
                      )}
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {Array.from(collections).map(
                        ([kind, count]: [string, number]): ReactElement => {
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => {
                                selectType(kind);
                              }}
                              className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <Icon
                                icon={IconProp.Cube}
                                className="h-5 w-5"
                                style={{ color: metaForEntityType(kind).color }}
                              />
                              <span className="flex-1 text-sm font-medium text-gray-700">
                                {t(metaForEntityType(kind).label)}
                              </span>
                              <span className="text-sm text-gray-500">
                                {count}
                              </span>
                              <Icon
                                icon={IconProp.ChevronRight}
                                className="h-4 w-4 text-gray-400"
                              />
                            </button>
                          );
                        },
                      )}
                    </div>
                  </section>
                ) : (
                  listedResources.length > 0 && renderList()
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {selected?.entity && (
        <EntityDetailPanel
          entity={selected.entity}
          relationships={props.relationships}
          entityByKey={entityByKey}
          metricsWindowSeconds={props.metricsWindowSeconds}
          onClose={() => {
            setSelectedKey(null);
          }}
          onFocus={openScope}
          focusButtonLabel="Explore this resource"
          onSelectEntity={setSelectedKey}
        />
      )}
      {selected && !selected.entity && (
        <SideOver
          title={t("Undiscovered resource")}
          description={selected.key}
          size={SideOverSize.Small}
          onClose={() => {
            setSelectedKey(null);
          }}
        >
          <p className="text-sm text-gray-600">
            {t(
              "This resource was referenced by a connection, but its inventory details have not been discovered yet.",
            )}
          </p>
          <h3 className="mt-6 text-sm font-semibold text-gray-900">
            {t("Known connections")}
          </h3>
          <ul className="mt-3 space-y-3">
            {model.relationships
              .filter((edge: InventoryItemRelationship): boolean => {
                return (
                  edge.fromEntityKey === selected.key ||
                  edge.toEntityKey === selected.key
                );
              })
              .map(
                (
                  edge: InventoryItemRelationship,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={index}
                      className="break-words text-sm text-gray-600"
                    >
                      {model.resources.get(edge.fromEntityKey!)?.name}{" "}
                      {t(labelForRelationship(edge.relationshipType))}{" "}
                      {model.resources.get(edge.toEntityKey!)?.name}
                    </li>
                  );
                },
              )}
          </ul>
        </SideOver>
      )}
    </div>
  );
};

export default InfrastructureExplorer;
