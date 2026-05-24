import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import FilterChipDropdown, {
  FilterChipDropdownOption,
} from "./FilterChipDropdown";
import { ResourceOwnerEntry } from "./OwnerEntry";

const PICKER_PAGE_SIZE: number = 50;

const getInitials: (name: string) => string = (name: string): string => {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((p: string) => {
      return p.length > 0;
    });
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.charAt(0).toUpperCase();
  }
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase();
};

type OwnerJunctionModel = BaseModel & {
  user?: User;
  team?: Team;
};

export interface ResourceFacet {
  /** Internal state key; also the default query field name. */
  key: string;
  /** Chip label (e.g. "Status", "Type"). */
  label: string;
  /** Icon shown on the empty chip. */
  icon?: IconProp | undefined;
  /** Allow selecting multiple values. Defaults to false. */
  isMultiSelect?: boolean | undefined;
  /** Hint shown inside the popover search box. */
  searchPlaceholder?: string | undefined;
  /** Static option list (use either this or `fetchOptions` / `loadOptions`). */
  options?: Array<FilterChipDropdownOption> | undefined;
  /**
   * Dynamic option list, fetched once on mount. Receives the current
   * project's id. Suitable for bounded option sets (state, severity,
   * status — typically <100 rows).
   */
  fetchOptions?:
    | ((projectId: ObjectID) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Async loader for unbounded / very large option sets (e.g. a Monitor
   * picker on a project with thousands of monitors). The chip calls this
   * on open and on each (debounced) keystroke, so the server does the
   * heavy lifting. When set, `options` / `fetchOptions` are ignored.
   */
  loadOptions?:
    | ((
        projectId: ObjectID,
        searchTerm: string,
      ) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Companion to `loadOptions`. Resolves a set of previously-selected
   * values (e.g. from a saved view) into options so the chip can show
   * proper labels even when the values aren't in the current search page.
   */
  resolveOptions?:
    | ((
        projectId: ObjectID,
        values: Array<string>,
      ) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Query field name. Defaults to `key`. Useful when the chip key differs
   * from the actual entity field (e.g. internal key "status" mapped to
   * `currentMonitorStatus`).
   */
  queryField?: string | undefined;
  /**
   * Convert selected raw string values into the query value. Defaults:
   * - multi-select: new Includes(values) (raw strings)
   * - single-select: values[0] (raw string)
   * Override for ObjectID-wrapped values or booleans:
   *   `(values) => values[0] === "true"`
   *   `(values) => new Includes(values.map((v) => new ObjectID(v)))`
   */
  toQueryValue?: ((values: Array<string>) => unknown) | undefined;
}

export interface UseResourceOwnersOptions {
  ownerUserModelType: { new (): OwnerJunctionModel };
  ownerTeamModelType: { new (): OwnerJunctionModel };
  resourceIdField: string;
  /**
   * Show a Labels chip in the filter bar. When enabled, the merged query
   * includes `labels: Includes([...])` for the selected labels.
   */
  showLabelsFacet?: boolean | undefined;
  /**
   * Additional resource-specific facets (e.g. Monitor Status / Type,
   * Alert Severity, Incident State). Rendered after Owner + Labels.
   */
  extraFacets?: Array<ResourceFacet> | undefined;
}

export interface UseResourceOwnersResult<TResource extends BaseModel> {
  ownersByResourceId: { [resourceId: string]: Array<ResourceOwnerEntry> };
  isLoadingOwners: boolean;
  onResourcesFetched: (resources: Array<TResource>) => void;
  /**
   * Compact row of chip-dropdowns (one per filter type). Render it via the
   * `topContent` prop of ModelTable so it sits inside the table card.
   */
  filterBar: ReactElement;
  /**
   * Merge owner + label filters into the base query. Pass the result to
   * the ModelTable's `query` prop.
   */
  mergeFiltersIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource>;
  hasActiveFilters: boolean;
  /**
   * Serializable snapshot of all facet selections (owner, labels, extras).
   * Pass to ModelTable's `currentFacetState` so saved views capture it.
   */
  facetSaveState: JSONObject;
  /**
   * Restore the hook's selections from a previously saved snapshot. Wire to
   * ModelTable's `onFacetStateRestored` so loading a saved view restores
   * the chips.
   */
  restoreFacetState: (state: JSONObject | null) => void;
}

type OwnerSelectionKind = "user" | "team";

const OWNER_KEY_PREFIX: { user: "user:"; team: "team:" } = {
  user: "user:",
  team: "team:",
};

const parseOwnerKey: (key: string) => {
  kind: OwnerSelectionKind;
  id: string;
} | null = (key: string): { kind: OwnerSelectionKind; id: string } | null => {
  if (key.startsWith(OWNER_KEY_PREFIX.user)) {
    return { kind: "user", id: key.slice(OWNER_KEY_PREFIX.user.length) };
  }
  if (key.startsWith(OWNER_KEY_PREFIX.team)) {
    return { kind: "team", id: key.slice(OWNER_KEY_PREFIX.team.length) };
  }
  return null;
};

const useResourceOwners: <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
) => UseResourceOwnersResult<TResource> = <TResource extends BaseModel>(
  options: UseResourceOwnersOptions,
): UseResourceOwnersResult<TResource> => {
  const { ownerUserModelType, ownerTeamModelType, resourceIdField } = options;
  const showLabelsFacet: boolean = Boolean(options.showLabelsFacet);
  const extraFacets: Array<ResourceFacet> = options.extraFacets || [];

  const [ownersByResourceId, setOwnersByResourceId] = useState<{
    [resourceId: string]: Array<ResourceOwnerEntry>;
  }>({});
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(false);

  const [selectedOwnerKeys, setSelectedOwnerKeys] = useState<Array<string>>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>([]);

  // Per-facet selected values keyed by facet.key.
  const [facetSelections, setFacetSelections] = useState<{
    [facetKey: string]: Array<string>;
  }>({});
  // Per-facet dynamic option lists keyed by facet.key.
  const [facetDynamicOptions, setFacetDynamicOptions] = useState<{
    [facetKey: string]: Array<FilterChipDropdownOption>;
  }>({});

  const [matchingResourceIds, setMatchingResourceIds] =
    useState<Array<string> | null>(null);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    const facetsToFetch: Array<ResourceFacet> = extraFacets.filter(
      (f: ResourceFacet) => {
        // Skip facets with loadOptions — the chip will lazy-load instead.
        return Boolean(f.fetchOptions) && !f.loadOptions;
      },
    );

    if (facetsToFetch.length === 0) {
      return;
    }

    let cancelled: boolean = false;

    const run: () => Promise<void> = async (): Promise<void> => {
      for (const facet of facetsToFetch) {
        try {
          const opts: Array<FilterChipDropdownOption> =
            await facet.fetchOptions!(projectId);
          if (cancelled) {
            return;
          }
          setFacetDynamicOptions(
            (prev: { [k: string]: Array<FilterChipDropdownOption> }) => {
              return { ...prev, [facet.key]: opts };
            },
          );
        } catch (err) {
          /*
           * Surface the error to the console so the chip's empty state has
           * a debuggable trail; the chip itself still renders gracefully.
           */
          // eslint-disable-next-line no-console
          console.error(
            `[useResourceOwners] Failed to load options for facet "${facet.key}":`,
            err,
          );
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    if (selectedOwnerKeys.length === 0) {
      setMatchingResourceIds(null);
      return;
    }

    const userIds: Array<string> = [];
    const teamIds: Array<string> = [];
    for (const key of selectedOwnerKeys) {
      const parsed: { kind: OwnerSelectionKind; id: string } | null =
        parseOwnerKey(key);
      if (parsed?.kind === "user") {
        userIds.push(parsed.id);
      } else if (parsed?.kind === "team") {
        teamIds.push(parsed.id);
      }
    }

    let cancelled: boolean = false;

    const computeMatching: () => Promise<void> = async (): Promise<void> => {
      try {
        const fetches: Array<Promise<Array<string>>> = [];

        if (userIds.length > 0) {
          fetches.push(
            ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerUserModelType,
              query: {
                userId: new Includes(
                  userIds.map((id: string) => {
                    return new ObjectID(id);
                  }),
                ),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            }).then((result: ListResult<OwnerJunctionModel>) => {
              return result.data
                .map((item: OwnerJunctionModel) => {
                  const value: unknown = (
                    item as unknown as Record<string, unknown>
                  )[resourceIdField];
                  return value !== undefined && value !== null
                    ? (value as { toString: () => string }).toString()
                    : undefined;
                })
                .filter((id: string | undefined): id is string => {
                  return Boolean(id);
                });
            }),
          );
        }

        if (teamIds.length > 0) {
          fetches.push(
            ModelAPI.getList<OwnerJunctionModel>({
              modelType: ownerTeamModelType,
              query: {
                teamId: new Includes(
                  teamIds.map((id: string) => {
                    return new ObjectID(id);
                  }),
                ),
                projectId: projectId,
              } as Query<OwnerJunctionModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: { [resourceIdField]: true } as Record<string, true>,
              sort: {},
            }).then((result: ListResult<OwnerJunctionModel>) => {
              return result.data
                .map((item: OwnerJunctionModel) => {
                  const value: unknown = (
                    item as unknown as Record<string, unknown>
                  )[resourceIdField];
                  return value !== undefined && value !== null
                    ? (value as { toString: () => string }).toString()
                    : undefined;
                })
                .filter((id: string | undefined): id is string => {
                  return Boolean(id);
                });
            }),
          );
        }

        const results: Array<Array<string>> = await Promise.all(fetches);
        const union: Set<string> = new Set();
        for (const list of results) {
          for (const id of list) {
            union.add(id);
          }
        }

        if (!cancelled) {
          setMatchingResourceIds(Array.from(union));
        }
      } catch {
        if (!cancelled) {
          setMatchingResourceIds([]);
        }
      }
    };

    computeMatching();

    return () => {
      cancelled = true;
    };
  }, [selectedOwnerKeys]);

  const onResourcesFetched: (resources: Array<TResource>) => void = (
    resources: Array<TResource>,
  ): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const ids: Array<string> = resources
      .map((r: TResource) => {
        return r.id?.toString();
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      setOwnersByResourceId({});
      return;
    }

    setIsLoadingOwners(true);

    /**
     * Extract the resource id from a junction record. We try a few accessors
     * to be robust to both raw JSON and BaseModel-deserialized instances —
     * some access paths drop the FK column when only a relation was selected
     * elsewhere, so we fall back through the chain before giving up.
     */
    type WithFlexibleId = Record<string, unknown> & {
      getColumnValue?: (col: string) => unknown;
    };
    const extractResourceId: (
      item: OwnerJunctionModel,
    ) => string | undefined = (
      item: OwnerJunctionModel,
    ): string | undefined => {
      const raw: WithFlexibleId = item as unknown as WithFlexibleId;
      const candidates: Array<unknown> = [
        raw[resourceIdField],
        raw[`_${resourceIdField}`],
        typeof raw.getColumnValue === "function"
          ? raw.getColumnValue(resourceIdField)
          : undefined,
      ];
      for (const c of candidates) {
        if (c === null || c === undefined) {
          continue;
        }
        if (typeof c === "string") {
          return c;
        }
        if (typeof (c as { toString?: () => string }).toString === "function") {
          const str: string = (c as { toString: () => string }).toString();
          if (str && str !== "[object Object]") {
            return str;
          }
        }
      }
      return undefined;
    };

    const fetchOwners: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * Pass raw string IDs to Includes (the operator accepts both string
         * and ObjectID arrays). Plain strings are the most reliable shape
         * across the JSON serialization boundary.
         */
        const idQuery: Includes = new Includes(ids);

        const [userResult, teamResult]: [
          ListResult<OwnerJunctionModel>,
          ListResult<OwnerJunctionModel>,
        ] = await Promise.all([
          ModelAPI.getList<OwnerJunctionModel>({
            modelType: ownerUserModelType,
            query: {
              [resourceIdField]: idQuery,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              [resourceIdField]: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            } as Record<string, unknown>,
            sort: {},
          }),
          ModelAPI.getList<OwnerJunctionModel>({
            modelType: ownerTeamModelType,
            query: {
              [resourceIdField]: idQuery,
              projectId: projectId,
            } as Query<OwnerJunctionModel>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              [resourceIdField]: true,
              team: {
                _id: true,
                name: true,
              },
            } as Record<string, unknown>,
            sort: {},
          }),
        ]);

        const map: { [k: string]: Array<ResourceOwnerEntry> } = {};

        for (const id of ids) {
          map[id] = [];
        }

        for (const item of userResult.data) {
          const key: string | undefined = extractResourceId(item);
          if (key && item.user) {
            if (!map[key]) {
              map[key] = [];
            }
            map[key].push({ kind: "user", user: item.user });
          }
        }

        for (const item of teamResult.data) {
          const key: string | undefined = extractResourceId(item);
          if (key && item.team) {
            if (!map[key]) {
              map[key] = [];
            }
            map[key].push({ kind: "team", team: item.team });
          }
        }

        setOwnersByResourceId(map);
      } catch (err) {
        // Surface the error so the empty state is debuggable.
        // eslint-disable-next-line no-console
        console.error(
          "[useResourceOwners] Failed to load owners for resources:",
          err,
        );
      } finally {
        setIsLoadingOwners(false);
      }
    };

    fetchOwners();
  };

  const mergeFiltersIntoQuery: (
    base: Query<TResource> | undefined,
  ) => Query<TResource> = (
    base: Query<TResource> | undefined,
  ): Query<TResource> => {
    const merged: Query<TResource> = {
      ...((base || {}) as Query<TResource>),
    } as Query<TResource>;

    if (matchingResourceIds !== null) {
      if (matchingResourceIds.length === 0) {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes([
          new ObjectID("00000000-0000-0000-0000-000000000000"),
        ]);
      } else {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes(
          matchingResourceIds.map((id: string) => {
            return new ObjectID(id);
          }),
        );
      }
    }

    if (selectedLabelIds.length > 0) {
      (merged as unknown as Record<string, unknown>)["labels"] = new Includes(
        selectedLabelIds.map((id: string) => {
          return new ObjectID(id);
        }),
      );
    }

    for (const facet of extraFacets) {
      const selected: Array<string> = facetSelections[facet.key] || [];
      if (selected.length === 0) {
        continue;
      }
      const field: string = facet.queryField || facet.key;
      const value: unknown = facet.toQueryValue
        ? facet.toQueryValue(selected)
        : facet.isMultiSelect
          ? new Includes(selected)
          : selected[0];
      (merged as unknown as Record<string, unknown>)[field] = value;
    }

    return merged;
  };

  const anyExtraFacetActive: boolean = extraFacets.some((f: ResourceFacet) => {
    return (facetSelections[f.key] || []).length > 0;
  });

  const hasActiveFilters: boolean = Boolean(
    selectedOwnerKeys.length > 0 ||
      selectedLabelIds.length > 0 ||
      anyExtraFacetActive,
  );

  /**
   * Server-side search for the Owner chip. Hits TeamMember + Team in
   * parallel, dedups users, and returns up to 50 of each kind.
   */
  const loadOwners: (
    searchTerm: string,
  ) => Promise<Array<FilterChipDropdownOption>> = useCallback(
    async (searchTerm: string): Promise<Array<FilterChipDropdownOption>> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return [];
      }

      const trimmed: string = searchTerm.trim();
      const userQuery: Query<TeamMember> = {
        projectId: projectId,
      } as Query<TeamMember>;
      const teamQuery: Query<Team> = {
        projectId: projectId,
      } as Query<Team>;

      if (trimmed) {
        // Search nested user.name for TeamMember and name for Team.
        (userQuery as unknown as Record<string, unknown>)["user"] = {
          name: new Search(trimmed),
        };
        (teamQuery as unknown as Record<string, unknown>)["name"] = new Search(
          trimmed,
        );
      }

      try {
        const [teamMembersResult, teamsResult]: [
          ListResult<TeamMember>,
          ListResult<Team>,
        ] = await Promise.all([
          ModelAPI.getList<TeamMember>({
            modelType: TeamMember,
            query: userQuery,
            limit: PICKER_PAGE_SIZE,
            skip: 0,
            select: {
              _id: true,
              user: {
                _id: true,
                name: true,
                email: true,
              },
            },
            sort: {},
          }),
          ModelAPI.getList<Team>({
            modelType: Team,
            query: teamQuery,
            limit: PICKER_PAGE_SIZE,
            skip: 0,
            select: {
              _id: true,
              name: true,
            },
            sort: { name: SortOrder.Ascending },
          }),
        ]);

        const seenUserIds: Set<string> = new Set<string>();
        const userResults: Array<FilterChipDropdownOption> = [];
        for (const tm of teamMembersResult.data) {
          const userId: string | undefined = tm.user?._id?.toString();
          if (!userId || seenUserIds.has(userId)) {
            continue;
          }
          seenUserIds.add(userId);
          const label: string =
            tm.user?.name?.toString() || tm.user?.email?.toString() || "";
          userResults.push({
            value: `${OWNER_KEY_PREFIX.user}${userId}`,
            label: label,
            initials: getInitials(label),
            icon: IconProp.User,
            group: "People",
          });
        }

        const teamResults: Array<FilterChipDropdownOption> =
          teamsResult.data.map((t: Team) => {
            const label: string = t.name?.toString() || "";
            return {
              value: `${OWNER_KEY_PREFIX.team}${t._id as string}`,
              label: label,
              initials: getInitials(label),
              icon: IconProp.Team,
              group: "Teams",
            };
          });

        return [...userResults, ...teamResults];
      } catch {
        return [];
      }
    },
    [],
  );

  /**
   * Resolve a set of saved Owner keys back into labeled options. Splits
   * by user:/team: prefix and fetches each kind in one query.
   */
  const resolveOwners: (
    keys: Array<string>,
  ) => Promise<Array<FilterChipDropdownOption>> = useCallback(
    async (keys: Array<string>): Promise<Array<FilterChipDropdownOption>> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId || keys.length === 0) {
        return [];
      }

      const userIds: Array<string> = [];
      const teamIds: Array<string> = [];
      for (const k of keys) {
        const parsed: { kind: OwnerSelectionKind; id: string } | null =
          parseOwnerKey(k);
        if (parsed?.kind === "user") {
          userIds.push(parsed.id);
        } else if (parsed?.kind === "team") {
          teamIds.push(parsed.id);
        }
      }

      const results: Array<FilterChipDropdownOption> = [];

      try {
        if (userIds.length > 0) {
          const teamMembersResult: ListResult<TeamMember> =
            await ModelAPI.getList<TeamMember>({
              modelType: TeamMember,
              query: {
                projectId: projectId,
                userId: new Includes(userIds),
              } as Query<TeamMember>,
              limit: userIds.length,
              skip: 0,
              select: {
                _id: true,
                user: {
                  _id: true,
                  name: true,
                  email: true,
                },
              },
              sort: {},
            });
          const seen: Set<string> = new Set<string>();
          for (const tm of teamMembersResult.data) {
            const userId: string | undefined = tm.user?._id?.toString();
            if (!userId || seen.has(userId)) {
              continue;
            }
            seen.add(userId);
            const label: string =
              tm.user?.name?.toString() || tm.user?.email?.toString() || "";
            results.push({
              value: `${OWNER_KEY_PREFIX.user}${userId}`,
              label: label,
              initials: getInitials(label),
              icon: IconProp.User,
              group: "People",
            });
          }
        }

        if (teamIds.length > 0) {
          const teamsResult: ListResult<Team> = await ModelAPI.getList<Team>({
            modelType: Team,
            query: {
              projectId: projectId,
              _id: new Includes(teamIds),
            } as Query<Team>,
            limit: teamIds.length,
            skip: 0,
            select: { _id: true, name: true },
            sort: {},
          });
          for (const t of teamsResult.data) {
            const label: string = t.name?.toString() || "";
            results.push({
              value: `${OWNER_KEY_PREFIX.team}${t._id as string}`,
              label: label,
              initials: getInitials(label),
              icon: IconProp.Team,
              group: "Teams",
            });
          }
        }
      } catch {
        // ignore — chip will fall back to raw value as label
      }

      return results;
    },
    [],
  );

  /**
   * Server-side search for the Labels chip.
   */
  const loadLabelsForChip: (
    searchTerm: string,
  ) => Promise<Array<FilterChipDropdownOption>> = useCallback(
    async (searchTerm: string): Promise<Array<FilterChipDropdownOption>> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return [];
      }

      const trimmed: string = searchTerm.trim();
      const query: Query<Label> = { projectId: projectId } as Query<Label>;
      if (trimmed) {
        (query as unknown as Record<string, unknown>)["name"] = new Search(
          trimmed,
        );
      }

      try {
        const result: ListResult<Label> = await ModelAPI.getList<Label>({
          modelType: Label,
          query: query,
          limit: PICKER_PAGE_SIZE,
          skip: 0,
          select: { _id: true, name: true },
          sort: { name: SortOrder.Ascending },
        });
        return result.data.map((l: Label) => {
          const label: string = l.name?.toString() || "";
          return {
            value: l._id as string,
            label: label,
            initials: getInitials(label),
          };
        });
      } catch {
        return [];
      }
    },
    [],
  );

  /**
   * Resolve saved label IDs to options.
   */
  const resolveLabelsForChip: (
    ids: Array<string>,
  ) => Promise<Array<FilterChipDropdownOption>> = useCallback(
    async (ids: Array<string>): Promise<Array<FilterChipDropdownOption>> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId || ids.length === 0) {
        return [];
      }

      try {
        const result: ListResult<Label> = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {
            projectId: projectId,
            _id: new Includes(ids),
          } as Query<Label>,
          limit: ids.length,
          skip: 0,
          select: { _id: true, name: true },
          sort: {},
        });
        return result.data.map((l: Label) => {
          const label: string = l.name?.toString() || "";
          return {
            value: l._id as string,
            label: label,
            initials: getInitials(label),
          };
        });
      } catch {
        return [];
      }
    },
    [],
  );

  const filterBar: ReactElement = useMemo((): ReactElement => {
    return (
      <div className="-mt-1 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
          Filter by
        </span>
        <FilterChipDropdown
          label="Owner"
          emptyIcon={IconProp.User}
          loadOptions={loadOwners}
          resolveOptions={resolveOwners}
          isMultiSelect={true}
          value={selectedOwnerKeys}
          searchPlaceholder="Search people and teams..."
          popoverWidthClassName="w-72"
          onChange={(value: string | Array<string> | null) => {
            if (value === null) {
              setSelectedOwnerKeys([]);
              return;
            }
            if (Array.isArray(value)) {
              setSelectedOwnerKeys(value);
              return;
            }
            setSelectedOwnerKeys([value]);
          }}
        />
        {showLabelsFacet && (
          <FilterChipDropdown
            label="Labels"
            emptyIcon={IconProp.Tag}
            loadOptions={loadLabelsForChip}
            resolveOptions={resolveLabelsForChip}
            isMultiSelect={true}
            value={selectedLabelIds}
            searchPlaceholder="Search labels..."
            onChange={(value: string | Array<string> | null) => {
              if (value === null) {
                setSelectedLabelIds([]);
                return;
              }
              if (Array.isArray(value)) {
                setSelectedLabelIds(value);
                return;
              }
              setSelectedLabelIds([value]);
            }}
          />
        )}
        {extraFacets.map((facet: ResourceFacet) => {
          const opts: Array<FilterChipDropdownOption> =
            facet.options || facetDynamicOptions[facet.key] || [];
          const selected: Array<string> = facetSelections[facet.key] || [];
          const value: string | Array<string> | null = facet.isMultiSelect
            ? selected
            : selected[0] || null;
          const loadOptions:
            | ((searchTerm: string) => Promise<Array<FilterChipDropdownOption>>)
            | undefined = facet.loadOptions
            ? (searchTerm: string) => {
                const projectId: ObjectID | null =
                  ProjectUtil.getCurrentProjectId();
                if (!projectId) {
                  return Promise.resolve([]);
                }
                return facet.loadOptions!(projectId, searchTerm);
              }
            : undefined;
          const resolveOptions:
            | ((
                values: Array<string>,
              ) => Promise<Array<FilterChipDropdownOption>>)
            | undefined = facet.resolveOptions
            ? (values: Array<string>) => {
                const projectId: ObjectID | null =
                  ProjectUtil.getCurrentProjectId();
                if (!projectId) {
                  return Promise.resolve([]);
                }
                return facet.resolveOptions!(projectId, values);
              }
            : undefined;
          return (
            <FilterChipDropdown
              key={facet.key}
              label={facet.label}
              emptyIcon={facet.icon}
              options={loadOptions ? undefined : opts}
              loadOptions={loadOptions}
              resolveOptions={resolveOptions}
              isMultiSelect={facet.isMultiSelect}
              value={value}
              searchPlaceholder={facet.searchPlaceholder}
              onChange={(next: string | Array<string> | null) => {
                setFacetSelections((prev: { [k: string]: Array<string> }) => {
                  const updated: { [k: string]: Array<string> } = { ...prev };
                  if (next === null) {
                    updated[facet.key] = [];
                  } else if (Array.isArray(next)) {
                    updated[facet.key] = next;
                  } else {
                    updated[facet.key] = [next];
                  }
                  return updated;
                });
              }}
            />
          );
        })}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSelectedOwnerKeys([]);
              setSelectedLabelIds([]);
              setFacetSelections({});
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800 focus:outline-none"
          >
            <Icon icon={IconProp.Close} className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>
    );
  }, [
    loadOwners,
    resolveOwners,
    loadLabelsForChip,
    resolveLabelsForChip,
    selectedOwnerKeys,
    selectedLabelIds,
    showLabelsFacet,
    hasActiveFilters,
    extraFacets,
    facetSelections,
    facetDynamicOptions,
  ]);

  const facetSaveState: JSONObject = useMemo((): JSONObject => {
    return {
      selectedOwnerKeys: selectedOwnerKeys,
      selectedLabelIds: selectedLabelIds,
      facetSelections: facetSelections as unknown as JSONObject,
    };
  }, [selectedOwnerKeys, selectedLabelIds, facetSelections]);

  const restoreFacetState: (state: JSONObject | null) => void = (
    state: JSONObject | null,
  ): void => {
    if (!state) {
      setSelectedOwnerKeys([]);
      setSelectedLabelIds([]);
      setFacetSelections({});
      return;
    }

    const rawOwners: unknown = state["selectedOwnerKeys"];
    if (Array.isArray(rawOwners)) {
      setSelectedOwnerKeys(
        rawOwners.filter((v: unknown): v is string => {
          return typeof v === "string";
        }),
      );
    } else {
      setSelectedOwnerKeys([]);
    }

    const rawLabels: unknown = state["selectedLabelIds"];
    if (Array.isArray(rawLabels)) {
      setSelectedLabelIds(
        rawLabels.filter((v: unknown): v is string => {
          return typeof v === "string";
        }),
      );
    } else {
      setSelectedLabelIds([]);
    }

    const rawSelections: unknown = state["facetSelections"];
    if (
      rawSelections &&
      typeof rawSelections === "object" &&
      !Array.isArray(rawSelections)
    ) {
      const next: { [k: string]: Array<string> } = {};
      for (const [k, v] of Object.entries(
        rawSelections as Record<string, unknown>,
      )) {
        if (Array.isArray(v)) {
          next[k] = v.filter((x: unknown): x is string => {
            return typeof x === "string";
          });
        }
      }
      setFacetSelections(next);
    } else {
      setFacetSelections({});
    }
  };

  return {
    ownersByResourceId,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
    facetSaveState,
    restoreFacetState,
  };
};

export default useResourceOwners;
