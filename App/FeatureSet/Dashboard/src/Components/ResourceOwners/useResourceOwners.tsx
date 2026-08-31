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
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import FilterChipDropdown, {
  FilterChipDropdownOption,
  FilterOperator,
} from "./FilterChipDropdown";
import FilterChipDateRange from "./FilterChipDateRange";
import FilterChipValueInput from "./FilterChipValueInput";
import { CUSTOM_FIELD_FACET_KEY_PREFIX } from "../CustomFields/CustomFieldFacets";
import { ResourceFacet } from "./ResourceFacet";
import { FacetColumnQuery, buildFacetColumnQuery } from "./FacetColumnQuery";
import {
  OPTION_FACET_OPERATORS,
  isTypedValueFacetKind,
} from "./FilterChipDropdownTypes";
import { ResourceOwnerEntry } from "./OwnerEntry";
import {
  FacetConflictMap,
  FacetSelectionState,
  buildFacetConflictMap,
  isFacetActive,
  normalizeFacetValues,
  parseFacetSelectionState,
  resolveFacetOperator,
  sanitizeFacetSelectionState,
} from "./FacetSelectionState";

const PICKER_PAGE_SIZE: number = 50;

/*
 * The three "what does this chip write" helpers now live in FacetColumnQuery,
 * next to the merge rules they feed, so that a facet vocabulary module — one
 * that only *describes* chips and must stay importable from App/Tests, where
 * there is no React — can reach them. Re-exported here because every page that
 * builds a chip imports them off this hook.
 */
export {
  buildBooleanFacetQuery,
  buildEntityFacetQuery,
  buildEnumFacetQuery,
} from "./FacetColumnQuery";

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

export type { ResourceFacet } from "./ResourceFacet";

export interface UseResourceOwnersOptions {
  /**
   * Owner junction model types and the FK column. Required when
   * `showOwnerFacet !== false`. Safe to omit when the table doesn't
   * have an owner concept (e.g. a TeamMember listing).
   */
  ownerUserModelType?: { new (): OwnerJunctionModel } | undefined;
  ownerTeamModelType?: { new (): OwnerJunctionModel } | undefined;
  resourceIdField?: string | undefined;
  /**
   * Render the Owner chip. Defaults to true. Set false for tables
   * where ownership doesn't apply.
   */
  showOwnerFacet?: boolean | undefined;
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
  /**
   * When set, the current facet selections are mirrored into the URL query
   * string under this key (typically the table's `saveFilterProps.tableId`).
   * This keeps facets alive when navigating to a detail page and back, and
   * makes the filtered view shareable. Omit to disable URL persistence.
   */
  persistKey?: string | undefined;
  /**
   * True while `extraFacets` is still being assembled from an async source —
   * today, a resource's custom field definitions.
   *
   * While it is true the hook neither writes nor clears the URL snapshot,
   * because a facet that has not arrived yet cannot be told apart from one the
   * user cleared, and the two call for opposite things. When it goes false the
   * hook reconciles once: late facets get their clamp, and selections for
   * facets that never arrived are dropped.
   */
  areFacetsLoading?: boolean | undefined;
  /**
   * Facet-key prefixes the settle-time reconciliation is allowed to drop.
   * Defaults to the custom field prefix. A key outside these prefixes is left
   * alone however long it goes unclaimed — the hook cannot know whether a page
   * puts its own bookkeeping in the snapshot.
   */
  reconcilableFacetKeyPrefixes?: Array<string> | undefined;
}

export interface UseResourceOwnersResult<TResource extends BaseModel> {
  ownersByResourceId: { [resourceId: string]: Array<ResourceOwnerEntry> };
  /**
   * Resource-id-tolerant lookup. Pass the resource row directly; the hook
   * handles the `id`-getter vs raw `_id` discrepancy that bit us before.
   * Prefer this over indexing `ownersByResourceId` from the consumer.
   */
  getOwnersForResource: (
    resource: TResource,
  ) => Array<ResourceOwnerEntry> | undefined;
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
   * Live selections for the `extraFacets`, keyed by facet key. Read-only — use
   * `setFacetSelection` to change one.
   *
   * Exposed so a page can react to its own chips: light up the summary tile
   * whose rows the bar is currently showing, or label a filter whose meaning
   * depends on when it was applied.
   */
  facetSelections: { [facetKey: string]: Array<string> };
  /**
   * Live per-facet operators, keyed by facet key. A facet with no entry is on
   * "is" — read through `resolveFacetOperator` rather than assuming.
   */
  facetOperators: { [facetKey: string]: FilterOperator };
  /**
   * Set one facet's selection from outside the bar — a summary tile, a deep
   * link, a "show me these rows" affordance elsewhere on the page.
   *
   * Passing an empty `values` with the default operator clears that facet.
   * Other facets are left alone: chips layer, so drilling into a status does
   * not throw away the site the user had already picked.
   */
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
  /** Clear every chip — what the bar's own "Clear all" button does. */
  clearAllFacets: () => void;
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
  const showOwnerFacet: boolean = options.showOwnerFacet !== false;
  const showLabelsFacet: boolean = Boolean(options.showLabelsFacet);
  const extraFacets: Array<ResourceFacet> = options.extraFacets || [];
  const persistKey: string | undefined = options.persistKey;
  const areFacetsLoading: boolean = Boolean(options.areFacetsLoading);
  const reconcilableFacetKeyPrefixes: Array<string> =
    options.reconcilableFacetKeyPrefixes || [CUSTOM_FIELD_FACET_KEY_PREFIX];

  const [ownersByResourceId, setOwnersByResourceId] = useState<{
    [resourceId: string]: Array<ResourceOwnerEntry>;
  }>({});
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(false);

  /*
   * Selections that were on the URL when this page was opened — a Back
   * navigation from a detail page, or a link a teammate shared. Read once,
   * synchronously, so the very first merged query already carries them and
   * the table never flashes the unfiltered list.
   *
   * Only IDs are restored, so this does not have to wait for the facets'
   * option lists to load; the chips fill in their display names later.
   */
  const initialFacetState: FacetSelectionState = useMemo(() => {
    return sanitizeFacetSelectionState(
      parseFacetSelectionState(TableFilterUrlState.read(persistKey, "facets")),
      extraFacets,
    );
  }, []);

  const [selectedOwnerKeys, setSelectedOwnerKeys] = useState<Array<string>>(
    initialFacetState.selectedOwnerKeys,
  );
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>(
    initialFacetState.selectedLabelIds,
  );

  // Per-facet operator (defaults to "is" when missing).
  const [ownerOperator, setOwnerOperator] = useState<FilterOperator>(
    initialFacetState.ownerOperator,
  );
  const [labelOperator, setLabelOperator] = useState<FilterOperator>(
    initialFacetState.labelOperator,
  );
  const [facetOperators, setFacetOperators] = useState<{
    [facetKey: string]: FilterOperator;
  }>(initialFacetState.facetOperators);

  // Per-facet selected values keyed by facet.key.
  const [facetSelections, setFacetSelections] = useState<{
    [facetKey: string]: Array<string>;
  }>(initialFacetState.facetSelections);
  // Per-facet dynamic option lists keyed by facet.key.
  const [facetDynamicOptions, setFacetDynamicOptions] = useState<{
    [facetKey: string]: Array<FilterChipDropdownOption>;
  }>({});
  /*
   * For facets with `computeMatchingResourceIds`, the resolver's result is
   * cached here keyed by facet.key. `null` means "not yet computed / no
   * selection" (don't constrain). An empty array means "selection produced
   * no matches" (force empty result set).
   */
  const [facetMatchingIds, setFacetMatchingIds] = useState<{
    [facetKey: string]: Array<string> | null;
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
    if (!showOwnerFacet) {
      return;
    }
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    if (selectedOwnerKeys.length === 0) {
      setMatchingResourceIds(null);
      return;
    }

    if (!ownerUserModelType || !ownerTeamModelType || !resourceIdField) {
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

  /*
   * Pre-fetch matching parent IDs for facets that filter across multiple
   * relationship fields (e.g. "Affected Resources"). Re-runs whenever the
   * facet's selection or operator changes. We track per-facet to keep each
   * resolver independent.
   */
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }
    const multiFieldFacets: Array<ResourceFacet> = extraFacets.filter(
      (f: ResourceFacet) => {
        return Boolean(f.computeMatchingResourceIds);
      },
    );
    if (multiFieldFacets.length === 0) {
      return;
    }

    let cancelled: boolean = false;

    const run: () => Promise<void> = async (): Promise<void> => {
      for (const facet of multiFieldFacets) {
        const selected: Array<string> = facetSelections[facet.key] || [];
        const op: FilterOperator = facetOperators[facet.key] || "is";

        if (
          selected.length === 0 ||
          op === "is_empty" ||
          op === "is_not_empty"
        ) {
          /*
           * Nothing selected (or operator that doesn't take values) — clear
           * any cached IDs so the merged query stops constraining on this
           * facet. Using a functional setter so concurrent facet updates
           * don't clobber each other.
           */
          setFacetMatchingIds((prev: { [k: string]: Array<string> | null }) => {
            if (prev[facet.key] === null || prev[facet.key] === undefined) {
              return prev;
            }
            const next: { [k: string]: Array<string> | null } = { ...prev };
            next[facet.key] = null;
            return next;
          });
          continue;
        }

        try {
          const ids: Array<string> = await facet.computeMatchingResourceIds!(
            projectId,
            selected,
            op,
          );
          if (cancelled) {
            return;
          }
          setFacetMatchingIds((prev: { [k: string]: Array<string> | null }) => {
            return { ...prev, [facet.key]: ids };
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[useResourceOwners] Failed to compute matching IDs for facet "${facet.key}":`,
            err,
          );
          if (cancelled) {
            return;
          }
          /*
           * Treat error as "no matches" so the chip's filter is still applied
           * visibly rather than silently dropped.
           */
          setFacetMatchingIds((prev: { [k: string]: Array<string> | null }) => {
            return { ...prev, [facet.key]: [] };
          });
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [facetSelections, facetOperators]);

  const onResourcesFetched: (resources: Array<TResource>) => void = (
    resources: Array<TResource>,
  ): void => {
    if (!showOwnerFacet) {
      return;
    }
    if (!ownerUserModelType || !ownerTeamModelType || !resourceIdField) {
      return;
    }
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    /*
     * Some code paths hand us plain JSON (e.g. when BaseModel isn't fully
     * deserialized). Fall back through `id` → `_id` so we cover both
     * shapes — without this, the entire owners map ends up keyed by
     * undefined and every row shows "No owners".
     */
    const resourceIdOf: (r: TResource) => string | undefined = (
      r: TResource,
    ): string | undefined => {
      const fromGetter: string | undefined = r.id?.toString();
      if (fromGetter) {
        return fromGetter;
      }
      const raw: Record<string, unknown> = r as unknown as Record<
        string,
        unknown
      >;
      const rawId: unknown = raw["_id"];
      if (typeof rawId === "string") {
        return rawId;
      }
      if (rawId && typeof rawId === "object") {
        const envelope: { _type?: unknown; value?: unknown } = rawId as {
          _type?: unknown;
          value?: unknown;
        };
        if (
          envelope._type === "ObjectID" &&
          typeof envelope.value === "string"
        ) {
          return envelope.value;
        }
      }
      if (
        rawId &&
        typeof (rawId as { toString?: () => string }).toString === "function"
      ) {
        const s: string = (rawId as { toString: () => string }).toString();
        if (s && s !== "[object Object]") {
          return s;
        }
      }
      return undefined;
    };

    const ids: Array<string> = resources
      .map(resourceIdOf)
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      setOwnersByResourceId({});
      return;
    }

    setIsLoadingOwners(true);

    /*
     * Derive the relation property name from the FK column name (e.g.
     * `monitorId` → `monitor`). When the FK isn't returned in the
     * serialized response (some endpoints strip FK columns and only emit
     * the joined entity), we fall back to `relation._id`.
     */
    const relationField: string = resourceIdField.endsWith("Id")
      ? resourceIdField.slice(0, -2)
      : resourceIdField;

    /**
     * Extract the resource id from a junction record. We try a few accessors
     * to be robust to both raw JSON and BaseModel-deserialized instances —
     * some access paths drop the FK column when only a relation was selected
     * elsewhere, so we fall back through the chain before giving up.
     */
    type WithFlexibleId = Record<string, unknown> & {
      getColumnValue?: (col: string) => unknown;
    };
    /*
     * Coerce a value of unknown shape into the underlying id string.
     * The API serializes ObjectID columns as `{_type:"ObjectID",value:"…"}`,
     * which `String()` flattens to "[object Object]" — so we look for the
     * envelope shape explicitly before falling back to `toString()`.
     */
    const coerceToIdString: (value: unknown) => string | undefined = (
      value: unknown,
    ): string | undefined => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value === "string") {
        return value;
      }
      if (typeof value === "object") {
        const envelope: { _type?: unknown; value?: unknown } = value as {
          _type?: unknown;
          value?: unknown;
        };
        if (
          envelope._type === "ObjectID" &&
          typeof envelope.value === "string"
        ) {
          return envelope.value;
        }
        const nested: Record<string, unknown> = value as Record<
          string,
          unknown
        >;
        if (typeof nested["id"] === "string") {
          return nested["id"] as string;
        }
        if (typeof nested["_id"] === "string") {
          return nested["_id"] as string;
        }
      }
      if (
        typeof (value as { toString?: () => string }).toString === "function"
      ) {
        const str: string = (value as { toString: () => string }).toString();
        if (str && str !== "[object Object]") {
          return str;
        }
      }
      return undefined;
    };

    const extractResourceId: (
      item: OwnerJunctionModel,
    ) => string | undefined = (
      item: OwnerJunctionModel,
    ): string | undefined => {
      const raw: WithFlexibleId = item as unknown as WithFlexibleId;
      const relationRaw: WithFlexibleId | undefined =
        (raw[relationField] as WithFlexibleId | undefined) || undefined;
      const candidates: Array<unknown> = [
        raw[resourceIdField],
        raw[`_${resourceIdField}`],
        typeof raw.getColumnValue === "function"
          ? raw.getColumnValue(resourceIdField)
          : undefined,
        // Fallback: nested relation object (e.g. junction.monitor._id).
        relationRaw ? relationRaw["_id"] : undefined,
        relationRaw ? relationRaw["id"] : undefined,
      ];
      for (const c of candidates) {
        const id: string | undefined = coerceToIdString(c);
        if (id) {
          return id;
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
              /*
               * Belt + suspenders: ask for the relation's id too so
               * extractResourceId has a fallback when the FK column is
               * stripped from the response by the API layer.
               */
              [relationField]: { _id: true },
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
              [relationField]: { _id: true },
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

    /*
     * Several filters (owner, plus any facet with `computeMatchingResourceIds`)
     * narrow on `_id`. They can't each write to `_id` directly — the last one
     * would win. So we collect every contributing set first, then combine:
     *   - "is" sets are intersected (a row must be in all of them)
     *   - "is_not" sets are unioned and subtracted from the intersection,
     *     or expressed as IncludesNone when there are no positive sets
     */
    const SENTINEL_EMPTY_ID: string = "00000000-0000-0000-0000-000000000000";
    const positiveIdSets: Array<Set<string>> = [];
    const negativeIdSets: Array<Set<string>> = [];

    // Owner contribution.
    if (showOwnerFacet) {
      if (ownerOperator === "is_empty") {
        // No owners exist on any of our resources → force empty.
        positiveIdSets.push(new Set([SENTINEL_EMPTY_ID]));
      } else if (matchingResourceIds !== null) {
        if (matchingResourceIds.length === 0) {
          if (ownerOperator !== "is_not") {
            positiveIdSets.push(new Set([SENTINEL_EMPTY_ID]));
          }
          // is_not with empty set → no constraint (everything matches "not in empty")
        } else if (ownerOperator === "is_not") {
          negativeIdSets.push(new Set(matchingResourceIds));
        } else {
          positiveIdSets.push(new Set(matchingResourceIds));
        }
      }
    }

    // Labels.
    if (labelOperator === "is_empty") {
      (merged as unknown as Record<string, unknown>)["labels"] = new IsNull();
    } else if (labelOperator === "is_not_empty") {
      (merged as unknown as Record<string, unknown>)["labels"] = new NotNull();
    } else if (selectedLabelIds.length > 0) {
      const labelObjectIds: Array<ObjectID> = selectedLabelIds.map(
        (id: string) => {
          return new ObjectID(id);
        },
      );
      (merged as unknown as Record<string, unknown>)["labels"] =
        labelOperator === "is_not"
          ? new IncludesNone(labelObjectIds)
          : new Includes(labelObjectIds);
    }

    // Extra facets.
    for (const facet of extraFacets) {
      const op: FilterOperator = facetOperators[facet.key] || "is";
      const selected: Array<string> = facetSelections[facet.key] || [];
      const field: string = facet.queryField || facet.key;

      // Multi-field facet: contributes to the _id intersection, not a column.
      if (facet.computeMatchingResourceIds) {
        if (op === "is_empty" || op === "is_not_empty") {
          /*
           * Not meaningful for resolver-based facets — disable in chip via
           * supportedOperators. Skip if it slips through.
           */
          continue;
        }
        if (selected.length === 0) {
          continue;
        }
        const ids: Array<string> | null | undefined =
          facetMatchingIds[facet.key];
        if (ids === null || ids === undefined) {
          /*
           * Resolver hasn't returned yet — leave the query unconstrained
           * for this facet rather than briefly showing a wrong result.
           */
          continue;
        }
        if (ids.length === 0) {
          if (op !== "is_not") {
            positiveIdSets.push(new Set([SENTINEL_EMPTY_ID]));
          }
          continue;
        }
        if (op === "is_not") {
          negativeIdSets.push(new Set(ids));
        } else {
          positiveIdSets.push(new Set(ids));
        }
        continue;
      }

      /*
       * Which column this chip writes, and what — including how it combines
       * with a chip that already wrote the same column. See FacetColumnQuery;
       * it lives outside the hook so the two rules that fail invisibly (chips
       * clobbering each other, and "is empty" asking about the wrong thing)
       * can be pinned in tests.
       */
      const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
        facet: facet,
        operator: op,
        values: selected,
        existingValue: (merged as unknown as Record<string, unknown>)[field],
      });

      if (!columnQuery) {
        continue;
      }

      (merged as unknown as Record<string, unknown>)[columnQuery.field] =
        columnQuery.value;
    }

    // Combine the collected _id sets.
    if (positiveIdSets.length > 0) {
      let combined: Set<string> = new Set(positiveIdSets[0]);
      for (let i: number = 1; i < positiveIdSets.length; i++) {
        combined = new Set(
          [...combined].filter((id: string) => {
            return positiveIdSets[i]!.has(id);
          }),
        );
      }
      for (const neg of negativeIdSets) {
        combined = new Set(
          [...combined].filter((id: string) => {
            return !neg.has(id);
          }),
        );
      }
      if (combined.size === 0) {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes([
          new ObjectID(SENTINEL_EMPTY_ID),
        ]);
      } else {
        (merged as unknown as Record<string, unknown>)["_id"] = new Includes(
          [...combined].map((id: string) => {
            return new ObjectID(id);
          }),
        );
      }
    } else if (negativeIdSets.length > 0) {
      const union: Set<string> = new Set();
      for (const neg of negativeIdSets) {
        for (const id of neg) {
          union.add(id);
        }
      }
      (merged as unknown as Record<string, unknown>)["_id"] = new IncludesNone(
        [...union].map((id: string) => {
          return new ObjectID(id);
        }),
      );
    }

    return merged;
  };

  const anyExtraFacetActive: boolean = extraFacets.some((f: ResourceFacet) => {
    return isFacetActive(f, facetSelections[f.key], facetOperators[f.key]);
  });

  const ownerOperatorActive: boolean =
    showOwnerFacet &&
    (ownerOperator === "is_empty" ||
      ownerOperator === "is_not_empty" ||
      selectedOwnerKeys.length > 0);
  const labelOperatorActive: boolean =
    labelOperator === "is_empty" ||
    labelOperator === "is_not_empty" ||
    selectedLabelIds.length > 0;

  const hasActiveFilters: boolean = Boolean(
    ownerOperatorActive || labelOperatorActive || anyExtraFacetActive,
  );

  // Facet key → the keys it cannot be active alongside.
  const facetConflicts: FacetConflictMap = useMemo((): FacetConflictMap => {
    return buildFacetConflictMap(extraFacets);
  }, [extraFacets]);

  const facetByKey: { [facetKey: string]: ResourceFacet } = useMemo((): {
    [facetKey: string]: ResourceFacet;
  } => {
    const map: { [facetKey: string]: ResourceFacet } = {};
    for (const facet of extraFacets) {
      map[facet.key] = facet;
    }
    return map;
  }, [extraFacets]);

  /**
   * Set one facet's values and operator together, clearing anything it conflicts
   * with.
   *
   * The single write path for every facet change — the chips, the summary tiles,
   * and deep links all land here — so the conflict rule cannot be enforced in
   * one of them and forgotten in another.
   */
  const applyFacetChange: (
    facetKey: string,
    values: Array<string>,
    operator: FilterOperator,
  ) => void = useCallback(
    (
      facetKey: string,
      values: Array<string>,
      operator: FilterOperator,
    ): void => {
      const conflicting: Array<string> = facetConflicts[facetKey] || [];
      const facet: ResourceFacet = facetByKey[facetKey] || {
        key: facetKey,
        label: facetKey,
      };
      /*
       * Only an active chip displaces another. Clearing a chip, or leaving it
       * mid-range, must not wipe the one the user set before it.
       */
      const displaces: boolean =
        conflicting.length > 0 && isFacetActive(facet, values, operator);

      setFacetSelections((prev: { [k: string]: Array<string> }) => {
        const next: { [k: string]: Array<string> } = {
          ...prev,
          [facetKey]: values,
        };
        if (displaces) {
          for (const other of conflicting) {
            next[other] = [];
          }
        }
        return next;
      });
      setFacetOperators((prev: { [k: string]: FilterOperator }) => {
        const next: { [k: string]: FilterOperator } = {
          ...prev,
          [facetKey]: operator,
        };
        if (displaces) {
          for (const other of conflicting) {
            next[other] = "is";
          }
        }
        return next;
      });
    },
    [facetConflicts, facetByKey],
  );

  const setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void = useCallback(
    (
      facetKey: string,
      values: Array<string>,
      operator?: FilterOperator,
    ): void => {
      if (!facetKey) {
        return;
      }

      /*
       * Selection and operator are set together, and always both: a caller that
       * moved the values but left a stale "is empty" behind would produce a
       * query that ignores the values it just chose, with a chip that claims
       * otherwise.
       */
      const nextOperator: FilterOperator = resolveFacetOperator(operator);
      /*
       * Date facets keep their two instants inside a single value, so the
       * set-semantics of normalizeFacetValues (dedupe, drop blanks) would be
       * meaningless at best. The range's own encoding is what validates it.
       */
      const nextValues: Array<string> =
        facetByKey[facetKey]?.type === "dateRange"
          ? values.slice(0, 1)
          : normalizeFacetValues(values);

      applyFacetChange(facetKey, nextValues, nextOperator);

      /*
       * Resolver-based facets recompute from the effect keyed on the selections
       * above, so nothing to do for them here.
       */
    },
    [applyFacetChange, facetByKey],
  );

  const clearAllFacets: () => void = useCallback((): void => {
    setSelectedOwnerKeys([]);
    setSelectedLabelIds([]);
    setFacetSelections({});
    setOwnerOperator("is");
    setLabelOperator("is");
    setFacetOperators({});
    setFacetMatchingIds({});
  }, []);

  /**
   * Server-side search for the Owner chip. Matches users by name or email
   * (via TeamMember) and teams by name, in parallel, dedups users, and returns
   * up to 50 of each kind.
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

      /*
       * Project members are searched through TeamMember — the only
       * project-scoped link to User (the User model itself isn't listable by
       * project members). We match the term against BOTH the user's name and
       * email. There's no OR across two relation fields in a single query, so
       * we run one query per field and union the results, deduping users who
       * appear on multiple teams or match on both fields.
       */
      const userQueries: Array<Query<TeamMember>> = trimmed
        ? [
            {
              projectId: projectId,
              user: { name: new Search(trimmed) },
            } as unknown as Query<TeamMember>,
            {
              projectId: projectId,
              user: { email: new Search(trimmed) },
            } as unknown as Query<TeamMember>,
          ]
        : [{ projectId: projectId } as Query<TeamMember>];

      const teamQuery: Query<Team> = {
        projectId: projectId,
      } as Query<Team>;
      if (trimmed) {
        (teamQuery as unknown as Record<string, unknown>)["name"] = new Search(
          trimmed,
        );
      }

      try {
        const [teamMemberResults, teamsResult]: [
          Array<ListResult<TeamMember>>,
          ListResult<Team>,
        ] = await Promise.all([
          Promise.all(
            userQueries.map((q: Query<TeamMember>) => {
              return ModelAPI.getList<TeamMember>({
                modelType: TeamMember,
                query: q,
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
              });
            }),
          ),
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
        for (const teamMembersResult of teamMemberResults) {
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
          select: { _id: true, name: true, color: true },
          sort: { name: SortOrder.Ascending },
        });
        return result.data.map((l: Label) => {
          const label: string = l.name?.toString() || "";
          return {
            value: l._id as string,
            label: label,
            color: l.color?.toString() || "#9ca3af",
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
          select: { _id: true, name: true, color: true },
          sort: {},
        });
        return result.data.map((l: Label) => {
          const label: string = l.name?.toString() || "";
          return {
            value: l._id as string,
            label: label,
            color: l.color?.toString() || "#9ca3af",
          };
        });
      } catch {
        return [];
      }
    },
    [],
  );

  const filterBar: ReactElement = useMemo((): ReactElement => {
    const isOwnerActive: boolean =
      showOwnerFacet &&
      (ownerOperator === "is_empty" ||
        ownerOperator === "is_not_empty" ||
        selectedOwnerKeys.length > 0);
    const isLabelActive: boolean =
      labelOperator === "is_empty" ||
      labelOperator === "is_not_empty" ||
      selectedLabelIds.length > 0;
    const activeCount: number =
      (isOwnerActive ? 1 : 0) +
      (isLabelActive ? 1 : 0) +
      extraFacets.filter((f: ResourceFacet) => {
        return isFacetActive(f, facetSelections[f.key], facetOperators[f.key]);
      }).length;

    return (
      <div className="-mt-1 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-semibold text-gray-500">
          <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
          Filter
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700">
              {activeCount}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className="hidden h-5 w-px bg-gray-200 sm:inline-block"
        />

        {showOwnerFacet && (
          <FilterChipDropdown
            label="Owner"
            emptyIcon={IconProp.User}
            loadOptions={loadOwners}
            resolveOptions={resolveOwners}
            isMultiSelect={true}
            value={selectedOwnerKeys}
            searchPlaceholder="Search people and teams..."
            popoverWidthClassName="w-72"
            operator={ownerOperator}
            onOperatorChange={(op: FilterOperator) => {
              setOwnerOperator(op);
            }}
            supportedOperators={["is", "is_not", "is_empty", "is_not_empty"]}
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
        )}
        {showLabelsFacet && (
          <FilterChipDropdown
            label="Labels"
            emptyIcon={IconProp.Tag}
            loadOptions={loadLabelsForChip}
            resolveOptions={resolveLabelsForChip}
            isMultiSelect={true}
            value={selectedLabelIds}
            searchPlaceholder="Search labels..."
            operator={labelOperator}
            onOperatorChange={(op: FilterOperator) => {
              setLabelOperator(op);
            }}
            supportedOperators={["is", "is_not", "is_empty", "is_not_empty"]}
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
          const selected: Array<string> = facetSelections[facet.key] || [];

          if (facet.type === "dateRange") {
            return (
              <FilterChipDateRange
                key={facet.key}
                label={facet.label}
                emptyIcon={facet.icon}
                values={selected}
                operator={facetOperators[facet.key] || "is"}
                supportedOperators={facet.supportedOperators}
                onChange={(
                  nextValues: Array<string>,
                  nextOperator: FilterOperator,
                ) => {
                  applyFacetChange(facet.key, nextValues, nextOperator);
                }}
              />
            );
          }

          if (isTypedValueFacetKind(facet.type)) {
            return (
              <FilterChipValueInput
                key={facet.key}
                label={facet.label}
                emptyIcon={facet.icon}
                values={selected}
                valueType={facet.type === "number" ? "number" : "text"}
                operator={facetOperators[facet.key] || "is"}
                supportedOperators={facet.supportedOperators}
                placeholder={facet.searchPlaceholder}
                onChange={(
                  nextValues: Array<string>,
                  nextOperator: FilterOperator,
                ) => {
                  applyFacetChange(facet.key, nextValues, nextOperator);
                }}
              />
            );
          }

          const opts: Array<FilterChipDropdownOption> =
            facet.options || facetDynamicOptions[facet.key] || [];
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
              operator={facetOperators[facet.key] || "is"}
              onOperatorChange={(op: FilterOperator) => {
                applyFacetChange(facet.key, selected, op);
              }}
              supportedOperators={
                facet.supportedOperators || OPTION_FACET_OPERATORS
              }
              onChange={(next: string | Array<string> | null) => {
                const nextValues: Array<string> =
                  next === null ? [] : Array.isArray(next) ? next : [next];

                applyFacetChange(
                  facet.key,
                  nextValues,
                  facetOperators[facet.key] || "is",
                );
              }}
            />
          );
        })}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFacets}
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
    showOwnerFacet,
    showLabelsFacet,
    hasActiveFilters,
    extraFacets,
    facetSelections,
    facetDynamicOptions,
    ownerOperator,
    labelOperator,
    facetOperators,
    clearAllFacets,
    applyFacetChange,
  ]);

  const facetSaveState: JSONObject = useMemo((): JSONObject => {
    return {
      selectedOwnerKeys: selectedOwnerKeys,
      selectedLabelIds: selectedLabelIds,
      facetSelections: facetSelections as unknown as JSONObject,
      ownerOperator: ownerOperator,
      labelOperator: labelOperator,
      facetOperators: facetOperators as unknown as JSONObject,
    };
  }, [
    selectedOwnerKeys,
    selectedLabelIds,
    facetSelections,
    ownerOperator,
    labelOperator,
    facetOperators,
  ]);

  const restoreFacetState: (state: JSONObject | null) => void = (
    state: JSONObject | null,
  ): void => {
    // Same clamp as the URL restore — a saved view is just as old and as editable.
    const parsed: FacetSelectionState = sanitizeFacetSelectionState(
      parseFacetSelectionState(state),
      extraFacets,
    );

    setSelectedOwnerKeys(parsed.selectedOwnerKeys);
    setSelectedLabelIds(parsed.selectedLabelIds);
    setFacetSelections(parsed.facetSelections);
    setOwnerOperator(parsed.ownerOperator);
    setLabelOperator(parsed.labelOperator);
    setFacetOperators(parsed.facetOperators);

    if (!state) {
      setFacetMatchingIds({});
    }
  };

  /*
   * Mirror active facet selections into the URL whenever they change, so the
   * chips survive a Back-navigation and the link can be shared.
   *
   * The restore side happens in the `useState` initializers above — reading
   * the URL synchronously on the first render means the merged query is
   * already correct when the table fires its first fetch. Restoring in an
   * effect instead (what this used to do) fetched the unfiltered list first
   * and then threw it away.
   */
  useEffect(() => {
    /*
     * While the facet list is still being assembled from an async source
     * (custom field definitions), a restored selection whose chip has not
     * arrived yet is indistinguishable from one the user cleared — and
     * `hasActiveFilters` reads it as cleared. Writing then would delete the
     * very param the link was opened with, before the chips that justify it
     * exist. So the URL is left exactly as found until the list settles.
     */
    if (areFacetsLoading) {
      return;
    }

    TableFilterUrlState.write(
      persistKey,
      "facets",
      hasActiveFilters ? facetSaveState : null,
    );
  }, [persistKey, hasActiveFilters, facetSaveState, areFacetsLoading]);

  /*
   * Reconcile once the facet list settles.
   *
   * Two things can only be decided here. A late-arriving facet's restored
   * selection has never been clamped against the chip that now owns it, and a
   * selection whose facet never arrives at all — a custom field that was
   * renamed or deleted since the link was made — would otherwise filter the
   * list forever with no chip on screen to explain or clear it.
   *
   * Scoped to `reconcilableFacetKeyPrefixes` so a page carrying keys this hook
   * does not know about (a summary tile's own bookkeeping, say) is untouched.
   */
  const hasReconciledFacets: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);

  useEffect(() => {
    if (areFacetsLoading) {
      /*
       * A reload — the project changed under the page — deserves the same
       * reconciliation the first load got, so the flag is armed again rather
       * than left set from last time.
       */
      hasReconciledFacets.current = false;
      return;
    }

    if (hasReconciledFacets.current) {
      return;
    }

    hasReconciledFacets.current = true;

    const declaredKeys: Set<string> = new Set<string>(
      extraFacets.map((facet: ResourceFacet) => {
        return facet.key;
      }),
    );

    const isOrphaned: (key: string) => boolean = (key: string): boolean => {
      if (declaredKeys.has(key)) {
        return false;
      }

      return reconcilableFacetKeyPrefixes.some((prefix: string) => {
        return key.startsWith(prefix);
      });
    };

    const clamped: FacetSelectionState = sanitizeFacetSelectionState(
      {
        selectedOwnerKeys: selectedOwnerKeys,
        selectedLabelIds: selectedLabelIds,
        facetSelections: facetSelections,
        ownerOperator: ownerOperator,
        labelOperator: labelOperator,
        facetOperators: facetOperators,
      },
      extraFacets,
    );

    const nextSelections: { [facetKey: string]: Array<string> } = {};
    const nextOperators: { [facetKey: string]: FilterOperator } = {};

    for (const key of Object.keys(clamped.facetSelections)) {
      if (!isOrphaned(key)) {
        nextSelections[key] = clamped.facetSelections[key]!;
      }
    }

    for (const key of Object.keys(clamped.facetOperators)) {
      if (!isOrphaned(key)) {
        nextOperators[key] = clamped.facetOperators[key]!;
      }
    }

    /*
     * Both setters run through the same equality check so a settled list with
     * nothing to fix does not schedule a re-render — and, through
     * `facetSaveState`, a redundant URL write.
     */
    if (
      JSON.stringify(nextSelections) !== JSON.stringify(facetSelections) ||
      JSON.stringify(nextOperators) !== JSON.stringify(facetOperators)
    ) {
      setFacetSelections(nextSelections);
      setFacetOperators(nextOperators);
    }
  }, [areFacetsLoading, extraFacets]);

  const getOwnersForResource: (
    resource: TResource,
  ) => Array<ResourceOwnerEntry> | undefined = (
    resource: TResource,
  ): Array<ResourceOwnerEntry> | undefined => {
    if (!resource) {
      return undefined;
    }
    const fromGetter: string | undefined = resource.id?.toString();
    if (fromGetter && ownersByResourceId[fromGetter]) {
      return ownersByResourceId[fromGetter];
    }
    const raw: Record<string, unknown> = resource as unknown as Record<
      string,
      unknown
    >;
    const rawId: unknown = raw["_id"];
    let fallbackKey: string | undefined;
    if (typeof rawId === "string") {
      fallbackKey = rawId;
    } else if (rawId && typeof rawId === "object") {
      // Handle the API's `{_type:"ObjectID", value:"..."}` envelope.
      const envelope: { _type?: unknown; value?: unknown } = rawId as {
        _type?: unknown;
        value?: unknown;
      };
      if (envelope._type === "ObjectID" && typeof envelope.value === "string") {
        fallbackKey = envelope.value;
      } else if (
        typeof (rawId as { toString?: () => string }).toString === "function"
      ) {
        const s: string = (rawId as { toString: () => string }).toString();
        if (s && s !== "[object Object]") {
          fallbackKey = s;
        }
      }
    }
    if (fallbackKey && ownersByResourceId[fallbackKey]) {
      return ownersByResourceId[fallbackKey];
    }
    return fromGetter ? ownersByResourceId[fromGetter] : undefined;
  };

  return {
    ownersByResourceId,
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    mergeFiltersIntoQuery,
    hasActiveFilters,
    facetSelections,
    facetOperators,
    setFacetSelection,
    clearAllFacets,
    facetSaveState,
    restoreFacetState,
  };
};

export default useResourceOwners;
