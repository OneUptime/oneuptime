import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
  | "DockerHost";

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
}

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
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
};

const ALL_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
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
   * rewrites the form's monitors/hosts/kubernetesClusters/dockerHosts arrays.
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
    return items;
  }, [
    props.monitors,
    props.hosts,
    props.kubernetesClusters,
    props.dockerHosts,
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

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    const trimmed: string = searchQuery.trim();
    if (trimmed === "") {
      setSearchResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const mySeq: number = ++searchSeqRef.current;

    debounceRef.current = window.setTimeout(async () => {
      try {
        /*
         * For each enabled type fire two parallel searches: one against name,
         * one against description. The backend doesn't expose a single OR
         * filter across columns, so we union client-side and dedupe by ID.
         * Per-type/per-field failures are swallowed so a 403 on one resource
         * doesn't blank out the dropdown for the others.
         */
        type SearchField = "name" | "description";
        const fetchOne: (
          type: AffectedResourceType,
          field: SearchField,
        ) => Promise<Array<AffectedResourceItem>> = async (
          type: AffectedResourceType,
          field: SearchField,
        ): Promise<Array<AffectedResourceItem>> => {
          const cfg: ResourceConfig = RESOURCE_CONFIG[type];
          try {
            const result: { data: Array<BaseModel> } =
              await ModelAPI.getList<BaseModel>({
                modelType: cfg.modelType,
                query: {
                  [field]: new Search(trimmed),
                } as never,
                limit: SEARCH_LIMIT_PER_TYPE,
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
              .filter(
                (i: AffectedResourceItem | null): i is AffectedResourceItem => {
                  return i !== null;
                },
              );
          } catch {
            return [];
          }
        };

        const requests: Array<Promise<Array<AffectedResourceItem>>> = [];
        for (const type of resourceTypes) {
          requests.push(fetchOne(type, "name"));
          requests.push(fetchOne(type, "description"));
        }

        const buckets: Array<Array<AffectedResourceItem>> =
          await Promise.all(requests);
        if (mySeq !== searchSeqRef.current) {
          return; // stale
        }
        /*
         * Dedupe by `${type}:${_id}` so an item matched by both name and
         * description doesn't render twice.
         */
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
    }, SEARCH_DEBOUNCE_MS);
  }, [searchQuery, resourceTypes]);

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

  // Clamp the highlight whenever the result set shrinks under our cursor.
  useEffect(() => {
    if (highlightedIndex >= flatAvailable.length) {
      setHighlightedIndex(flatAvailable.length - 1);
    }
  }, [flatAvailable, highlightedIndex]);

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

  const removeItem: (item: AffectedResourceItem) => void = (
    item: AffectedResourceItem,
  ): void => {
    notify(
      selected.filter((s: AffectedResourceItem): boolean => {
        return !(s._id === item._id && s.type === item.type);
      }),
    );
  };

  const placeholder: string =
    props.placeholder ||
    (resourceTypes.length === ALL_TYPES.length
      ? "Search monitors, hosts, Kubernetes clusters, or Docker hosts..."
      : `Search ${resourceTypes
          .map((t: AffectedResourceType): string => {
            return RESOURCE_CONFIG[t].label.toLowerCase();
          })
          .join(", ")}...`);

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
          if (event.key === "ArrowDown") {
            if (flatAvailable.length === 0) {
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev: number): number => {
              const next: number = prev + 1;
              return next >= flatAvailable.length ? 0 : next;
            });
            return;
          }
          if (event.key === "ArrowUp") {
            if (flatAvailable.length === 0) {
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev: number): number => {
              if (prev <= 0) {
                return flatAvailable.length - 1;
              }
              return prev - 1;
            });
            return;
          }
          if (event.key === "Enter") {
            if (
              highlightedIndex >= 0 &&
              highlightedIndex < flatAvailable.length
            ) {
              event.preventDefault();
              const target: AffectedResourceItem | undefined =
                flatAvailable[highlightedIndex];
              if (target) {
                addItem(target);
                setHighlightedIndex(-1);
              }
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
            selected.length > 0
          ) {
            /*
             * Backspace on empty input removes the last selected chip — same
             * convention as react-select and most tag inputs.
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
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
          role="listbox"
        >
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

          {!isLoading && searchQuery.trim() === "" && (
            <div className="px-3 py-2 text-gray-500">
              Start typing to search resources...
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
               * Track the running flat index alongside the visual render so
               * the highlight class matches the keyboard cursor exactly.
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
                                isHighlighted ? "text-white" : "text-gray-400"
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
