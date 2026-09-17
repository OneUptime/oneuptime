import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  isFacetTileSelectionApplied,
} from "../ResourceOwners/FacetTileSelection";
import { buildBooleanFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import {
  normalizeFacetValues,
  resolveFacetOperator,
} from "../ResourceOwners/FacetSelectionState";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Query from "Common/Types/BaseDatabase/Query";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import { getSloStatusColor } from "Common/Utils/Slo/SloStatusColor";

/*
 * The SLO list's status vocabulary: how a row reads (Archived, Disabled, or
 * its measured status), which chips the list's facet bar offers for that, and
 * the summary tiles above the table.
 *
 * Every tile answers a question the user immediately wants the rows for - "two
 * SLOs have exhausted their budget, which two?" - so a tile's count, the rows
 * its click produces, and the pill each of those rows wears are all derived
 * from the definitions here and cannot drift apart. The counts are fetched in
 * SloStatusSummaryCards, the rows by the ModelTable on the SLOs page.
 *
 * React-free, and free of RouteMap / Navigation (which read `window` at module
 * load), so App tests can pin it without a renderer.
 */

/*
 * Shared by the table's `id`, its `userPreferencesKey` and the URL namespace
 * its filter, facet and view state are persisted under.
 */
export const SLOS_TABLE_ID: string = "slos-table";

export const SLO_STATUS_FACET_KEY: string = "sloStatus";
export const SLO_ENABLED_FACET_KEY: string = "sloEnabled";

/*
 * The column each chip owns. The column-filter popup must not also offer a
 * filter on either: BaseModelTable builds its request as
 * `{...props.query, ...columnFilterQuery}`, so a popup filter on a chip's
 * column replaces the chip's constraint outright - silently, while the chip
 * carries on claiming it applies.
 */
export const SLO_FACET_QUERY_FIELDS: { status: string; enabled: string } = {
  status: "sloStatus",
  enabled: "isEnabled",
};

// String forms of the boolean, as buildBooleanFacetQuery reads them.
export enum SloEnabledFacetValue {
  Enabled = "true",
  Disabled = "false",
}

/*
 * The base query of the live SLO list. Archived SLOs are retired - hidden from
 * the list and not evaluated - and live on their own Archived page instead.
 * Built fresh on every call so no caller can mutate a shared object.
 */
export type GetSloListBaseQueryFunction = () => Query<ServiceLevelObjective>;

export const getSloListBaseQuery: GetSloListBaseQueryFunction =
  (): Query<ServiceLevelObjective> => {
    return {
      isArchived: false,
    };
  };

type ToStatusOptionFunction = (status: SloStatus) => FilterChipDropdownOption;

const toStatusOption: ToStatusOptionFunction = (
  status: SloStatus,
): FilterChipDropdownOption => {
  return {
    value: status,
    label: status,
    color: getSloStatusColor(status).toString(),
  };
};

/*
 * The chips the SLO list offers beside Owner. A module-level constant on
 * purpose: useResourceOwners derives its facet lookups from this array, so a
 * fresh array on every render would churn them.
 */
export const SLO_LIST_FACETS: Array<ResourceFacet> = [
  {
    key: SLO_STATUS_FACET_KEY,
    label: "Status",
    icon: IconProp.Gauge,
    isMultiSelect: true,
    queryField: SLO_FACET_QUERY_FIELDS.status,
    /*
     * "is empty" stays on offer: an SLO with no status has never been
     * evaluated, and "what has not been measured yet?" is a real question.
     */
    options: Object.values(SloStatus).map(toStatusOption),
  },
  {
    key: SLO_ENABLED_FACET_KEY,
    label: "Enabled",
    icon: IconProp.Power,
    isMultiSelect: false,
    queryField: SLO_FACET_QUERY_FIELDS.enabled,
    options: [
      { value: SloEnabledFacetValue.Enabled, label: "Enabled" },
      { value: SloEnabledFacetValue.Disabled, label: "Disabled" },
    ],
    // The column is NOT NULL, so there is nothing for "is empty" to find.
    supportedOperators: ["is", "is_not"],
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return buildBooleanFacetQuery(values, operator);
    },
  },
];

/*
 * How one SLO row reads in a list. Both flags take an SLO out of evaluation
 * and leave its last status column behind, so rendering that status would
 * claim a live measurement that is not happening. Archived outranks Disabled
 * because it is the more permanent state - an archived SLO may well be
 * disabled too, and "Archived" is the thing to know about it.
 */
export enum SloListStatusKind {
  Archived = "Archived",
  Disabled = "Disabled",
  Measured = "Measured",
}

export type GetSloListStatusKindFunction = (slo: {
  isArchived?: boolean | undefined;
  isEnabled?: boolean | undefined;
}) => SloListStatusKind;

export const getSloListStatusKind: GetSloListStatusKindFunction = (slo: {
  isArchived?: boolean | undefined;
  isEnabled?: boolean | undefined;
}): SloListStatusKind => {
  if (slo.isArchived === true) {
    return SloListStatusKind.Archived;
  }

  if (slo.isEnabled === false) {
    return SloListStatusKind.Disabled;
  }

  return SloListStatusKind.Measured;
};

export enum SloStatusSummaryTileKey {
  Healthy = "healthy",
  AtRisk = "at-risk",
  BudgetExhausted = "budget-exhausted",
  Misconfigured = "misconfigured",
  Paused = "paused",
  Disabled = "disabled",
}

export interface SloStatusSummaryTile {
  // Also the React key and the `data-testid` suffix.
  key: SloStatusSummaryTileKey;
  label: string;
  caption: string;
  /*
   * The slice of the live (non-archived) list this tile stands for. A status
   * tile counts that status among ENABLED SLOs only: a disabled SLO keeps its
   * last status, but the list shows it as Disabled, so it belongs to the
   * Disabled tile alone. `sloStatus: null` means any status. Together the
   * tiles partition every evaluated live SLO exactly once.
   */
  isEnabled: boolean;
  sloStatus: SloStatus | null;
  // Tailwind text class for the count while it is above zero.
  attentionClassName: string;
}

export const SLO_STATUS_SUMMARY_TILES: Array<SloStatusSummaryTile> = [
  {
    key: SloStatusSummaryTileKey.Healthy,
    label: "Healthy",
    caption: "Meeting target with error budget to spare.",
    isEnabled: true,
    sloStatus: SloStatus.Healthy,
    attentionClassName: "text-emerald-600",
  },
  {
    key: SloStatusSummaryTileKey.AtRisk,
    label: "At Risk",
    caption: "Error budget is below the at-risk threshold.",
    isEnabled: true,
    sloStatus: SloStatus.AtRisk,
    attentionClassName: "text-amber-600",
  },
  {
    key: SloStatusSummaryTileKey.BudgetExhausted,
    label: "Budget Exhausted",
    caption: "Error budget is fully spent. The target is breached.",
    isEnabled: true,
    sloStatus: SloStatus.BudgetExhausted,
    attentionClassName: "text-red-600",
  },
  {
    key: SloStatusSummaryTileKey.Misconfigured,
    label: "Misconfigured",
    caption: "Cannot be measured. Check its monitors and target.",
    isEnabled: true,
    sloStatus: SloStatus.Misconfigured,
    attentionClassName: "text-amber-600",
  },
  {
    key: SloStatusSummaryTileKey.Paused,
    label: "Paused",
    caption: "Every monitor it measures is disabled.",
    isEnabled: true,
    sloStatus: SloStatus.Paused,
    attentionClassName: "text-gray-900",
  },
  {
    key: SloStatusSummaryTileKey.Disabled,
    label: "Disabled",
    caption: "Turned off in Settings, so not evaluated.",
    isEnabled: false,
    sloStatus: null,
    attentionClassName: "text-gray-900",
  },
];

/*
 * What the tile counts. Starts from the live list's own base query, so the
 * strip can never count an archived SLO the table below would not show.
 */
export type GetSloStatusSummaryTileQueryFunction = (
  tile: SloStatusSummaryTile,
) => Query<ServiceLevelObjective>;

export const getSloStatusSummaryTileQuery: GetSloStatusSummaryTileQueryFunction =
  (tile: SloStatusSummaryTile): Query<ServiceLevelObjective> => {
    const query: Query<ServiceLevelObjective> = {
      ...getSloListBaseQuery(),
      isEnabled: tile.isEnabled,
    };

    if (tile.sloStatus) {
      query.sloStatus = tile.sloStatus;
    }

    return query;
  };

/*
 * The chips that produce exactly the rows the tile counts. Both chips are
 * always named - the Disabled tile clears Status rather than leaving it be -
 * because a Status chip left over from an earlier click would otherwise narrow
 * "Disabled" down to a subset the tile never counted.
 */
export type GetSloStatusSummaryTileSelectionsFunction = (
  tile: SloStatusSummaryTile,
) => Array<FacetTileSelection>;

export const getSloStatusSummaryTileSelections: GetSloStatusSummaryTileSelectionsFunction =
  (tile: SloStatusSummaryTile): Array<FacetTileSelection> => {
    return [
      {
        facetKey: SLO_ENABLED_FACET_KEY,
        values: [
          tile.isEnabled
            ? SloEnabledFacetValue.Enabled
            : SloEnabledFacetValue.Disabled,
        ],
        operator: "is",
      },
      {
        facetKey: SLO_STATUS_FACET_KEY,
        values: tile.sloStatus ? [tile.sloStatus] : [],
        operator: "is",
      },
    ];
  };

/*
 * Is the bar already showing exactly what this tile describes? Drives both the
 * tile's pressed state and its toggle-off, so a tile that looks lit is always
 * the one a second click turns off.
 */
export type IsSloStatusSummaryTileAppliedFunction = (
  tile: SloStatusSummaryTile,
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
) => boolean;

export const isSloStatusSummaryTileApplied: IsSloStatusSummaryTileAppliedFunction =
  (
    tile: SloStatusSummaryTile,
    facetSelections: FacetSelectionMap,
    facetOperators: FacetOperatorMap,
  ): boolean => {
    return getSloStatusSummaryTileSelections(tile).every(
      (selection: FacetTileSelection): boolean => {
        return isFacetTileSelectionApplied(
          selection,
          facetSelections,
          facetOperators,
        );
      },
    );
  };

export interface ApplySloStatusSummaryTileOptions {
  tile: SloStatusSummaryTile;
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
}

export type ApplySloStatusSummaryTileFunction = (
  options: ApplySloStatusSummaryTileOptions,
) => void;

/*
 * Move the bar to what a tile describes - or, when it is already there, back
 * out of it by clearing the chips the tile set. Owner and Labels chips are
 * left alone: chips layer, so drilling into a status must not throw away the
 * owner the user had already picked.
 *
 * Safe to call setFacetSelection twice in a row: the hook applies each change
 * as a functional state update.
 */
export const applySloStatusSummaryTile: ApplySloStatusSummaryTileFunction = (
  options: ApplySloStatusSummaryTileOptions,
): void => {
  const selections: Array<FacetTileSelection> =
    getSloStatusSummaryTileSelections(options.tile);

  const isApplied: boolean = isSloStatusSummaryTileApplied(
    options.tile,
    options.facetSelections,
    options.facetOperators,
  );

  for (const selection of selections) {
    if (!selection.facetKey) {
      continue;
    }

    if (isApplied) {
      options.setFacetSelection(selection.facetKey, [], "is");
      continue;
    }

    options.setFacetSelection(
      selection.facetKey,
      normalizeFacetValues(selection.values),
      resolveFacetOperator(selection.operator),
    );
  }
};

/*
 * The dot beside a tile's caption: the same colour the rows' status pills
 * wear, so the strip and the table read as one thing.
 */
export type GetSloStatusSummaryTileColorFunction = (
  tile: SloStatusSummaryTile,
) => Color;

export const getSloStatusSummaryTileColor: GetSloStatusSummaryTileColorFunction =
  (tile: SloStatusSummaryTile): Color => {
    return tile.sloStatus ? getSloStatusColor(tile.sloStatus) : Gray500;
  };
