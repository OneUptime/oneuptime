import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Search from "Common/Types/BaseDatabase/Search";
import IconProp from "Common/Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type AffectedResourceType =
  | "Monitor"
  | "Host"
  | "KubernetesCluster"
  | "DockerHost"
  | "Service";

export interface AffectedResourceItem {
  _id: string;
  name: string;
  type: AffectedResourceType;
}

/*
 * Shape that the picker passes to onChange. The wrapper sentinel lets the
 * form-level handler tell our payload apart from a regular Array<Monitor>
 * the form may produce or receive from the API.
 */
export interface AffectedResourcesPayload {
  __affectedResourcesPayload: true;
  monitors: Array<string>;
  hosts: Array<string>;
  kubernetesClusters: Array<string>;
  dockerHosts: Array<string>;
  services: Array<string>;
}

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  services?: Array<Service> | undefined;
  resourceTypes?: Array<AffectedResourceType> | undefined;
  onChange: (payload: AffectedResourcesPayload) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}

interface ResourceConfig {
  label: string;
  icon: IconProp;
  modelType: { new (): BaseModel };
}

const RESOURCE_CONFIG: Record<AffectedResourceType, ResourceConfig> = {
  Monitor: {
    label: "Monitor",
    icon: IconProp.AltGlobe,
    modelType: Monitor,
  },
  Host: {
    label: "Host",
    icon: IconProp.Server,
    modelType: Host,
  },
  KubernetesCluster: {
    label: "Kubernetes Cluster",
    icon: IconProp.Kubernetes,
    modelType: KubernetesCluster,
  },
  DockerHost: {
    label: "Docker Host",
    icon: IconProp.Docker,
    modelType: DockerHost,
  },
  Service: {
    label: "Service",
    icon: IconProp.SquareStack,
    modelType: Service,
  },
};

const ALL_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "Service",
];

const SEARCH_DEBOUNCE_MS: number = 250;
const SEARCH_LIMIT_PER_TYPE: number = 15;

/*
 * Translate the resource arrays already attached to the parent entity into a
 * flat, typed list the picker can render. Server payloads sometimes hand us
 * BaseModel instances, sometimes plain objects, sometimes bare ID strings
 * (the form-level onChange that splits our payload writes Array<string>),
 * so we accept all three shapes. Names that arrive in objects are mirrored
 * into nameCache so later renders against bare IDs can still show them.
 */
const toItems: (
  models: Array<unknown> | undefined,
  type: AffectedResourceType,
  nameCache: Map<string, string>,
) => Array<AffectedResourceItem> = (
  models: Array<unknown> | undefined,
  type: AffectedResourceType,
  nameCache: Map<string, string>,
): Array<AffectedResourceItem> => {
  if (!models || models.length === 0) {
    return [];
  }
  const items: Array<AffectedResourceItem> = [];
  for (const model of models) {
    if (!model) {
      continue;
    }
    /*
     * Bare string ID — the form's serializer leaves M2M fields like this
     * after our splitter writes Array<string> into them.
     */
    if (typeof model === "string") {
      const cacheKey: string = `${type}:${model}`;
      const cachedName: string | undefined = nameCache.get(cacheKey);
      items.push({
        _id: model,
        name: cachedName || `Unnamed ${RESOURCE_CONFIG[type].label}`,
        type,
      });
      continue;
    }
    const anyModel: { _id?: unknown; id?: unknown; name?: unknown } = model as {
      _id?: unknown;
      id?: unknown;
      name?: unknown;
    };
    const id: string | undefined = anyModel._id
      ? String(anyModel._id)
      : anyModel.id
        ? String(anyModel.id)
        : undefined;
    if (!id) {
      continue;
    }
    const name: string =
      typeof anyModel.name === "string" && anyModel.name.length > 0
        ? anyModel.name
        : nameCache.get(`${type}:${id}`) ||
          `Unnamed ${RESOURCE_CONFIG[type].label}`;
    nameCache.set(`${type}:${id}`, name);
    items.push({ _id: id, name, type });
  }
  return items;
};

/*
 * Pre-flight permission check so we don't render dropdown options the user
 * could never read. Master admin bypasses everything. For anyone else we
 * intersect the model's readRecordPermissions against the user's tenant
 * permissions — same pattern CardModelDetail uses for the edit button.
 */
const filterTypesByReadPermission: (types: Array<AffectedResourceType>) => {
  allowed: Array<AffectedResourceType>;
  denied: Array<AffectedResourceType>;
} = (
  types: Array<AffectedResourceType>,
): {
  allowed: Array<AffectedResourceType>;
  denied: Array<AffectedResourceType>;
} => {
  if (User.isMasterAdmin()) {
    return { allowed: types, denied: [] };
  }
  const userPerms: UserTenantAccessPermission | null =
    PermissionUtil.getProjectPermissions();
  if (!userPerms || !userPerms.permissions) {
    /*
     * No permissions cached yet — let the API decide; the catch block
     * around each request will silence per-type 403s.
     */
    return { allowed: types, denied: [] };
  }
  const flatUserPerms: Array<Permission> = userPerms.permissions.map(
    (p: UserPermission): Permission => {
      return p.permission;
    },
  );
  const allowed: Array<AffectedResourceType> = [];
  const denied: Array<AffectedResourceType> = [];
  for (const type of types) {
    const cfg: ResourceConfig = RESOURCE_CONFIG[type];
    const required: Array<Permission> = new cfg.modelType()
      .readRecordPermissions;
    if (
      required.length === 0 ||
      PermissionHelper.doesPermissionsIntersect(required, flatUserPerms)
    ) {
      allowed.push(type);
    } else {
      denied.push(type);
    }
  }
  return { allowed, denied };
};

const AffectedResourcesPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const requestedTypes: Array<AffectedResourceType> =
    props.resourceTypes && props.resourceTypes.length > 0
      ? props.resourceTypes
      : ALL_TYPES;

  const {
    allowed: resourceTypes,
    denied: deniedTypes,
  }: {
    allowed: Array<AffectedResourceType>;
    denied: Array<AffectedResourceType>;
  } = useMemo(() => {
    return filterTypesByReadPermission(requestedTypes);
  }, [requestedTypes]);

  /*
   * nameCache survives across renders so that after the form serializes the
   * selected items down to bare IDs, we can still show user-recognisable
   * names. Keyed by `${type}:${id}` to avoid collisions across resource types.
   */
  const nameCacheRef: React.MutableRefObject<Map<string, string>> = useRef<
    Map<string, string>
  >(new Map());

  /*
   * Selected items derived from props each render. The parent owns the truth;
   * we never mirror it into local state to avoid drift after setNewFormValues
   * rewrites the form's monitors/hosts/kubernetesClusters/dockerHosts/services
   * arrays.
   */
  const selected: Array<AffectedResourceItem> = useMemo(() => {
    const cache: Map<string, string> = nameCacheRef.current;
    const items: Array<AffectedResourceItem> = [];
    if (resourceTypes.includes("Monitor")) {
      items.push(...toItems(props.monitors, "Monitor", cache));
    }
    if (resourceTypes.includes("Host")) {
      items.push(...toItems(props.hosts, "Host", cache));
    }
    if (resourceTypes.includes("KubernetesCluster")) {
      items.push(
        ...toItems(props.kubernetesClusters, "KubernetesCluster", cache),
      );
    }
    if (resourceTypes.includes("DockerHost")) {
      items.push(...toItems(props.dockerHosts, "DockerHost", cache));
    }
    if (resourceTypes.includes("Service")) {
      items.push(...toItems(props.services, "Service", cache));
    }
    return items;
  }, [
    props.monitors,
    props.hosts,
    props.kubernetesClusters,
    props.dockerHosts,
    props.services,
    resourceTypes,
  ]);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<
    Array<AffectedResourceItem>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  /*
   * highlightedIndex tracks the keyboard cursor across the *flat* order of
   * availableResults (group order matches resourceTypes). -1 means nothing
   * highlighted; Enter is a no-op until the user arrows into the list.
   */
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  /*
   * Two-mode dropdown: "resources" runs the existing name/description
   * search; "labels" turns the same popover into a multi-select label
   * picker that bulk-adds every resource tagged with the chosen labels.
   * The label flow used to live in a separate modal triggered by a
   * "Select by Labels" link — folding it into the dropdown removes the
   * modal entirely and surfaces label-based selection at the same level
   * of discoverability as the search.
   */
  const [activeTab, setActiveTab] = useState<"resources" | "labels">(
    "resources",
  );
  const [allLabels, setAllLabels] = useState<Array<Label>>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState<boolean>(false);
  const [labelsLoaded, setLabelsLoaded] = useState<boolean>(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>([]);
  const [isApplyingLabels, setIsApplyingLabels] = useState<boolean>(false);
  const [labelError, setLabelError] = useState<string>("");
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const debounceRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  /*
   * searchSeqRef discards stale responses when a new query is fired before
   * the previous one resolves. Without it the UI flickers between results.
   */
  const searchSeqRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  /*
   * Shared fetcher used both for typed searches (name/description filters) and
   * for the default "suggestions" list shown when the dropdown is open with an
   * empty query. Failures per type are swallowed so a 403 on one resource type
   * doesn't blank out results for the others.
   */
  const fetchByQuery: (
    type: AffectedResourceType,
    query: Record<string, unknown>,
    limit: number,
  ) => Promise<Array<AffectedResourceItem>> = async (
    type: AffectedResourceType,
    query: Record<string, unknown>,
    limit: number,
  ): Promise<Array<AffectedResourceItem>> => {
    const cfg: ResourceConfig = RESOURCE_CONFIG[type];
    try {
      const result: { data: Array<BaseModel> } =
        await ModelAPI.getList<BaseModel>({
          modelType: cfg.modelType,
          query: query as never,
          limit,
          skip: 0,
          select: { _id: true, name: true } as never,
          sort: { name: SortOrder.Ascending } as never,
        });
      return (result.data || [])
        .map((item: BaseModel): AffectedResourceItem | null => {
          const id: string | undefined = item._id
            ? String(item._id)
            : undefined;
          const name: string =
            typeof (item as { name?: unknown }).name === "string"
              ? ((item as { name?: string }).name as string)
              : "";
          if (!id) {
            return null;
          }
          return {
            _id: id,
            name: name.length > 0 ? name : `Unnamed ${cfg.label}`,
            type,
          };
        })
        .filter((i: AffectedResourceItem | null): i is AffectedResourceItem => {
          return i !== null;
        });
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    /*
     * Skip fetching when the dropdown is closed or the user is on the
     * Labels tab — there's nothing to render. Re-opening (or the user
     * typing) re-runs this effect and refills results.
     */
    if (!isOpen || activeTab !== "resources") {
      return;
    }

    const trimmed: string = searchQuery.trim();
    setIsLoading(true);
    const mySeq: number = ++searchSeqRef.current;
    /*
     * Empty queries fire immediately so the user sees suggestions the moment
     * they focus the input. Typed queries are debounced to spare the API.
     */
    const delay: number = trimmed === "" ? 0 : SEARCH_DEBOUNCE_MS;

    debounceRef.current = window.setTimeout(async () => {
      try {
        const requests: Array<Promise<Array<AffectedResourceItem>>> = [];
        if (trimmed === "") {
          // Default suggestions: top-N alphabetical per enabled type.
          for (const type of resourceTypes) {
            requests.push(fetchByQuery(type, {}, SEARCH_LIMIT_PER_TYPE));
          }
        } else {
          /*
           * Search mode: fire two parallel queries per type (name + description)
           * since the backend doesn't expose a cross-column OR. Results are
           * unioned and deduped by `${type}:${_id}` below.
           */
          for (const type of resourceTypes) {
            requests.push(
              fetchByQuery(
                type,
                { name: new Search(trimmed) },
                SEARCH_LIMIT_PER_TYPE,
              ),
            );
            requests.push(
              fetchByQuery(
                type,
                { description: new Search(trimmed) },
                SEARCH_LIMIT_PER_TYPE,
              ),
            );
          }
        }

        const buckets: Array<Array<AffectedResourceItem>> =
          await Promise.all(requests);
        if (mySeq !== searchSeqRef.current) {
          return; // stale
        }
        const seen: Set<string> = new Set();
        const merged: Array<AffectedResourceItem> = [];
        for (const bucket of buckets) {
          for (const item of bucket) {
            const key: string = `${item.type}:${item._id}`;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            merged.push(item);
          }
        }
        /*
         * Cache names so the selected chips still render readably after the
         * form turns our payload into bare ID arrays.
         */
        for (const item of merged) {
          nameCacheRef.current.set(`${item.type}:${item._id}`, item.name);
        }
        setSearchResults(merged);
      } catch {
        if (mySeq === searchSeqRef.current) {
          setSearchResults([]);
        }
      } finally {
        if (mySeq === searchSeqRef.current) {
          setIsLoading(false);
        }
      }
    }, delay);
  }, [searchQuery, resourceTypes, isOpen, activeTab]);

  const availableResults: Array<AffectedResourceItem> = useMemo(() => {
    return searchResults.filter((result: AffectedResourceItem) => {
      return !selected.some((s: AffectedResourceItem) => {
        return s._id === result._id && s.type === result.type;
      });
    });
  }, [searchResults, selected]);

  const groupedAvailable: Array<{
    type: AffectedResourceType;
    items: Array<AffectedResourceItem>;
  }> = useMemo(() => {
    const groups: Array<{
      type: AffectedResourceType;
      items: Array<AffectedResourceItem>;
    }> = [];
    for (const type of resourceTypes) {
      const items: Array<AffectedResourceItem> = availableResults.filter(
        (r: AffectedResourceItem): boolean => {
          return r.type === type;
        },
      );
      if (items.length > 0) {
        groups.push({ type, items });
      }
    }
    return groups;
  }, [availableResults, resourceTypes]);

  /*
   * Flatten groupedAvailable into the same order it renders so the keyboard
   * cursor and the visual order stay in sync.
   */
  const flatAvailable: Array<AffectedResourceItem> = useMemo(() => {
    const flat: Array<AffectedResourceItem> = [];
    for (const group of groupedAvailable) {
      for (const item of group.items) {
        flat.push(item);
      }
    }
    return flat;
  }, [groupedAvailable]);

  const notify: (next: Array<AffectedResourceItem>) => void = (
    next: Array<AffectedResourceItem>,
  ): void => {
    props.onChange({
      __affectedResourcesPayload: true,
      monitors: next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === "Monitor";
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        }),
      hosts: next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === "Host";
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        }),
      kubernetesClusters: next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === "KubernetesCluster";
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        }),
      dockerHosts: next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === "DockerHost";
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        }),
      services: next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === "Service";
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        }),
    });
  };

  const addItem: (item: AffectedResourceItem) => void = (
    item: AffectedResourceItem,
  ): void => {
    notify([...selected, item]);
    setSearchQuery("");
    setSearchResults([]);
    inputRef.current?.focus();
  };

  /*
   * Lazy-load labels the first time the user switches to the Labels tab.
   * The list is cached for the picker's lifetime — switching back and
   * forth between tabs is instant.
   */
  useEffect(() => {
    if (activeTab !== "labels" || labelsLoaded || isLoadingLabels) {
      return;
    }
    let cancelled: boolean = false;
    const loadLabels: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingLabels(true);
      setLabelError("");
      try {
        const result: { data: Array<Label> } = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {} as never,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, name: true, color: true } as never,
          sort: { name: SortOrder.Ascending } as never,
        });
        if (cancelled) {
          return;
        }
        setAllLabels(result.data || []);
        setLabelsLoaded(true);
      } catch {
        if (cancelled) {
          return;
        }
        setLabelError(
          "Failed to load labels. You may not have permission to read labels.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingLabels(false);
        }
      }
    };
    void loadLabels();
    return () => {
      cancelled = true;
    };
  }, [activeTab, labelsLoaded, isLoadingLabels]);

  const toggleLabelId: (id: string) => void = (id: string): void => {
    setSelectedLabelIds((prev: Array<string>): Array<string> => {
      if (prev.includes(id)) {
        return prev.filter((x: string): boolean => {
          return x !== id;
        });
      }
      return [...prev, id];
    });
  };

  /*
   * On the Labels tab the same input filters the label list client-side
   * (we already have all labels in memory). Keeping a single searchQuery
   * for both tabs keeps the input behavior intuitive — the user types,
   * the visible list narrows, regardless of which tab they're on.
   */
  const filteredLabels: Array<Label> = useMemo(() => {
    const q: string = searchQuery.trim().toLowerCase();
    if (q === "") {
      return allLabels;
    }
    return allLabels.filter((label: Label): boolean => {
      const name: string = (label.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [allLabels, searchQuery]);

  /*
   * Clamp the keyboard cursor when the active list shrinks under it (e.g.
   * the user typed and narrowed the results). Both tabs share the cursor —
   * which list it indexes into depends on activeTab.
   */
  useEffect(() => {
    const len: number =
      activeTab === "labels" ? filteredLabels.length : flatAvailable.length;
    if (highlightedIndex >= len) {
      setHighlightedIndex(len - 1);
    }
  }, [flatAvailable, filteredLabels, highlightedIndex, activeTab]);

  /*
   * Pulls every resource (of each enabled type) tagged with any of the chosen
   * labels and merges them into the current selection. Per-type failures are
   * swallowed; the cap is generous (LIMIT_PER_PROJECT) since this is an
   * intentional bulk selection rather than a quick search.
   */
  const applyLabelSelection: () => Promise<void> = async (): Promise<void> => {
    if (selectedLabelIds.length === 0) {
      return;
    }
    setIsApplyingLabels(true);
    setLabelError("");
    try {
      const requests: Array<Promise<Array<AffectedResourceItem>>> = [];
      for (const type of resourceTypes) {
        requests.push(
          fetchByQuery(
            type,
            { labels: new Includes(selectedLabelIds) },
            LIMIT_PER_PROJECT,
          ),
        );
      }
      const buckets: Array<Array<AffectedResourceItem>> =
        await Promise.all(requests);

      // Merge new items into the existing selection, deduping by type+id.
      const existing: Set<string> = new Set(
        selected.map((s: AffectedResourceItem): string => {
          return `${s.type}:${s._id}`;
        }),
      );
      const additions: Array<AffectedResourceItem> = [];
      for (const bucket of buckets) {
        for (const item of bucket) {
          const key: string = `${item.type}:${item._id}`;
          if (existing.has(key)) {
            continue;
          }
          existing.add(key);
          additions.push(item);
          nameCacheRef.current.set(key, item.name);
        }
      }

      if (additions.length === 0) {
        setLabelError(
          "No new resources matched the selected labels (or you don't have read access).",
        );
        setIsApplyingLabels(false);
        return;
      }

      notify([...selected, ...additions]);
      /*
       * Bounce back to the resources view, drop the label selection, and
       * close the popover so the user sees the resulting chips appear.
       */
      setSelectedLabelIds([]);
      setSearchQuery("");
      setActiveTab("resources");
      setIsOpen(false);
    } catch {
      setLabelError("Failed to fetch resources for the selected labels.");
    } finally {
      setIsApplyingLabels(false);
    }
  };

  const removeItem: (item: AffectedResourceItem) => void = (
    item: AffectedResourceItem,
  ): void => {
    notify(
      selected.filter((s: AffectedResourceItem): boolean => {
        return !(s._id === item._id && s.type === item.type);
      }),
    );
  };

  const resourcesPlaceholder: string =
    props.placeholder ||
    (resourceTypes.length === ALL_TYPES.length
      ? "Search monitors, hosts, Kubernetes clusters, Docker hosts, or services..."
      : `Search ${resourceTypes
          .map((t: AffectedResourceType): string => {
            return RESOURCE_CONFIG[t].label.toLowerCase();
          })
          .join(", ")}...`);
  const placeholder: string =
    activeTab === "labels" ? "Search labels..." : resourcesPlaceholder;

  return (
    <div ref={containerRef} className="relative mt-1 w-full">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((item: AffectedResourceItem) => {
            const cfg: ResourceConfig = RESOURCE_CONFIG[item.type];
            return (
              <span
                key={`${item.type}-${item._id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-700"
              >
                <Icon icon={cfg.icon} className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  {cfg.label}
                </span>
                <span className="text-gray-800">{item.name}</span>
                {!props.disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      removeItem(item);
                    }}
                    className="ml-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        disabled={props.disabled}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        role="combobox"
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          setSearchQuery(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          setIsOpen(true);
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          /*
           * The cursor walks whichever list the active tab is showing —
           * resources or labels. Length is checked against the active list
           * so ArrowUp/Down become no-ops when there's nothing to move to.
           */
          const activeLen: number =
            activeTab === "labels"
              ? filteredLabels.length
              : flatAvailable.length;

          if (event.key === "ArrowDown") {
            if (activeLen === 0) {
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev: number): number => {
              const next: number = prev + 1;
              return next >= activeLen ? 0 : next;
            });
            return;
          }
          if (event.key === "ArrowUp") {
            if (activeLen === 0) {
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev: number): number => {
              if (prev <= 0) {
                return activeLen - 1;
              }
              return prev - 1;
            });
            return;
          }
          if (event.key === "Enter") {
            if (highlightedIndex < 0 || highlightedIndex >= activeLen) {
              return;
            }
            event.preventDefault();
            if (activeTab === "labels") {
              const label: Label | undefined = filteredLabels[highlightedIndex];
              const labelId: string = label?._id ? String(label._id) : "";
              if (labelId) {
                toggleLabelId(labelId);
              }
              return;
            }
            const target: AffectedResourceItem | undefined =
              flatAvailable[highlightedIndex];
            if (target) {
              addItem(target);
              setHighlightedIndex(-1);
            }
            return;
          }
          if (event.key === "Escape") {
            setIsOpen(false);
            setHighlightedIndex(-1);
            return;
          }
          if (
            event.key === "Backspace" &&
            searchQuery === "" &&
            selected.length > 0 &&
            activeTab === "resources"
          ) {
            /*
             * Backspace on empty input removes the last selected chip — same
             * convention as react-select and most tag inputs. Gated to the
             * resources tab so labels-tab backspace doesn't accidentally
             * delete a resource chip the user is no longer looking at.
             */
            event.preventDefault();
            removeItem(selected[selected.length - 1] as AffectedResourceItem);
          }
        }}
        placeholder={placeholder}
        className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
      />

      {isOpen && !props.disabled && (
        <div
          className="absolute z-10 mt-1 flex max-h-96 w-full flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg"
          role="listbox"
        >
          {/*
           * Tab strip. Two modes share the same input above: "Resources"
           * runs the live name/description search; "Labels" lets the user
           * bulk-add every resource tagged with the chosen labels.
           */}
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50 px-1.5 py-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "resources"}
              onMouseDown={(
                event: React.MouseEvent<HTMLButtonElement>,
              ): void => {
                event.preventDefault();
              }}
              onClick={(): void => {
                setActiveTab("resources");
                setHighlightedIndex(-1);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                activeTab === "resources"
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
              }`}
            >
              Resources
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "labels"}
              onMouseDown={(
                event: React.MouseEvent<HTMLButtonElement>,
              ): void => {
                event.preventDefault();
              }}
              onClick={(): void => {
                setActiveTab("labels");
                setHighlightedIndex(-1);
              }}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                activeTab === "labels"
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
              }`}
            >
              <Icon icon={IconProp.Tag} className="h-3.5 w-3.5" />
              Labels
              {selectedLabelIds.length > 0 && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700">
                  {selectedLabelIds.length}
                </span>
              )}
            </button>
            <span className="ml-auto pr-1 text-[11px] text-gray-400">
              {activeTab === "resources"
                ? "Search and add individually"
                : "Bulk-add by tag"}
            </span>
          </div>

          {/* Resources tab body. */}
          {activeTab === "resources" && (
            <div className="flex-1 overflow-auto py-1">
              {isLoading && (
                <div className="flex w-full items-center px-3 py-2 text-left text-gray-500">
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>Searching...</span>
                </div>
              )}

              {!isLoading &&
                searchQuery.trim() === "" &&
                groupedAvailable.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No resources available. Type to search across all resources.
                  </div>
                )}

              {!isLoading &&
                searchQuery.trim() !== "" &&
                groupedAvailable.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No matching resources.
                  </div>
                )}

              {!isLoading &&
                (() => {
                  /*
                   * Track the running flat index alongside the visual render
                   * so the highlight class matches the keyboard cursor
                   * exactly.
                   */
                  let flatIdx: number = -1;
                  return groupedAvailable.map(
                    (group: {
                      type: AffectedResourceType;
                      items: Array<AffectedResourceItem>;
                    }) => {
                      const cfg: ResourceConfig = RESOURCE_CONFIG[group.type];
                      return (
                        <div key={group.type}>
                          <div className="bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {cfg.label}s
                          </div>
                          {group.items.map((item: AffectedResourceItem) => {
                            flatIdx += 1;
                            const isHighlighted: boolean =
                              flatIdx === highlightedIndex;
                            return (
                              <button
                                key={`${item.type}-${item._id}`}
                                type="button"
                                role="option"
                                aria-selected={isHighlighted}
                                onMouseEnter={() => {
                                  /*
                                   * Sync the highlight to the mouse so keyboard
                                   * and mouse never disagree on which row is
                                   * about to be picked.
                                   */
                                  setHighlightedIndex(flatIdx);
                                }}
                                onMouseDown={(
                                  event: React.MouseEvent<HTMLButtonElement>,
                                ) => {
                                  /*
                                   * Prevent the input blur from firing before
                                   * onClick resolves the selection.
                                   */
                                  event.preventDefault();
                                }}
                                onClick={() => {
                                  addItem(item);
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                                  isHighlighted
                                    ? "bg-indigo-600 text-white"
                                    : "text-gray-700 hover:bg-indigo-50"
                                }`}
                              >
                                <Icon
                                  icon={cfg.icon}
                                  className={`h-4 w-4 ${
                                    isHighlighted
                                      ? "text-white"
                                      : "text-gray-400"
                                  }`}
                                />
                                <span>{item.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    },
                  );
                })()}

              {deniedTypes.length > 0 && (
                <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  You don&apos;t have permission to read:{" "}
                  {deniedTypes
                    .map((t: AffectedResourceType): string => {
                      return RESOURCE_CONFIG[t].label;
                    })
                    .join(", ")}
                  .
                </div>
              )}
            </div>
          )}

          {/* Labels tab body. */}
          {activeTab === "labels" && (
            <div className="flex-1 overflow-auto py-1">
              {isLoadingLabels && (
                <div className="flex w-full items-center px-3 py-2 text-left text-gray-500">
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>Loading labels...</span>
                </div>
              )}

              {!isLoadingLabels && labelError !== "" && (
                <div className="px-3 py-2 text-red-600">{labelError}</div>
              )}

              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No labels found in this project. Create labels first to use
                    this shortcut.
                  </div>
                )}

              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length > 0 &&
                filteredLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    No labels match &ldquo;{searchQuery.trim()}&rdquo;.
                  </div>
                )}

              {!isLoadingLabels &&
                filteredLabels.map(
                  (label: Label, idx: number): ReactElement => {
                    const labelId: string = label._id ? String(label._id) : "";
                    if (!labelId) {
                      return <span key={`empty-${idx}`} />;
                    }
                    const isChecked: boolean =
                      selectedLabelIds.includes(labelId);
                    const isHighlighted: boolean = idx === highlightedIndex;
                    const labelColor: string | undefined = label.color
                      ? typeof (label.color as { toString?: unknown })
                          .toString === "function"
                        ? label.color.toString()
                        : (label.color as unknown as string)
                      : undefined;

                    return (
                      <button
                        key={labelId}
                        type="button"
                        role="option"
                        aria-selected={isChecked}
                        onMouseEnter={(): void => {
                          setHighlightedIndex(idx);
                        }}
                        onMouseDown={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ): void => {
                          /*
                           * Keep focus on the input so subsequent keystrokes
                           * still hit the combobox keyDown handler.
                           */
                          event.preventDefault();
                        }}
                        onClick={(): void => {
                          toggleLabelId(labelId);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                          isHighlighted
                            ? "bg-indigo-50 text-gray-900"
                            : "text-gray-700 hover:bg-indigo-50"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            isChecked
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {isChecked && (
                            <svg
                              className="h-3 w-3"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </span>
                        {labelColor && (
                          <span
                            className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: labelColor }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate">
                          {label.name || "Unnamed Label"}
                        </span>
                      </button>
                    );
                  },
                )}
            </div>
          )}

          {/*
           * Sticky footer on the Labels tab. Shows the apply action and a
           * Clear shortcut once the user has picked something — keeps the
           * primary action visible no matter how far they scrolled.
           */}
          {activeTab === "labels" && selectedLabelIds.length > 0 && (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-2 py-1.5">
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setSelectedLabelIds([]);
                }}
                disabled={isApplyingLabels}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  void applyLabelSelection();
                }}
                disabled={isApplyingLabels}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-60"
              >
                {isApplyingLabels && (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                )}
                {isApplyingLabels
                  ? "Adding..."
                  : `Add resources from ${selectedLabelIds.length} label${
                      selectedLabelIds.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AffectedResourcesPicker;

/*
 * Splits the picker payload back into the four model arrays so callers can
 * merge them into form state from a top-level onChange hook. Keeping this in
 * the same file ensures the payload shape and the consumer stay in sync.
 */
export const isAffectedResourcesPayload: (
  value: unknown,
) => value is AffectedResourcesPayload = (
  value: unknown,
): value is AffectedResourcesPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    (value as { __affectedResourcesPayload?: unknown })
      .__affectedResourcesPayload === true
  );
};
