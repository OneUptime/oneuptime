import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  isFacetTileSelectionApplied,
} from "../ResourceOwners/FacetTileSelection";
import {
  normalizeFacetValues,
  resolveFacetOperator,
} from "../ResourceOwners/FacetSelectionState";
import { FilterOperator } from "../ResourceOwners/FilterChipDropdownTypes";
import { PostmortemProgress } from "Common/Utils/Incident/PostmortemStatus";
import { PostmortemStatusChoice } from "./PostmortemStatusChoices";
import { POSTMORTEM_STATUS_FACET_KEY } from "./PostmortemListFacetKeys";

/*
 * The counts above the Postmortems list: one tile per postmortem status the
 * project uses (archived ones are left out - nobody moves a postmortem into
 * them, and the Postmortem Status chip still finds incidents in them), in
 * the order of the project's list. Each answers a question the reader wants
 * the rows for at once - "twelve are not started: which twelve?" - so its
 * click moves the Postmortem Status chip to exactly the incidents it counts,
 * and a second click clears it again. The other chips stay: a tile layers
 * over the owner the reader picked, as the SLO list's tiles do.
 *
 * React-free, so App tests read the same rules the tiles follow.
 */

export interface PostmortemStatusTile {
  // The status's id: also the React key and the data-testid suffix.
  statusId: string;
  name: string;
  description: string;
  color: string;
  progress: PostmortemProgress;
}

// The statuses that get a tile: those not archived, top of the list first.
export const getPostmortemStatusTiles: (
  choices: Array<PostmortemStatusChoice>,
) => Array<PostmortemStatusTile> = (
  choices: Array<PostmortemStatusChoice>,
): Array<PostmortemStatusTile> => {
  return choices
    .filter((choice: PostmortemStatusChoice): boolean => {
      return !choice.isArchived;
    })
    .map((choice: PostmortemStatusChoice): PostmortemStatusTile => {
      return {
        statusId: choice.id,
        name: choice.name,
        description: choice.description,
        color: choice.color,
        progress: choice.progress,
      };
    });
};

// What the tile's click sets: the Postmortem Status chip, on that one status.
export const getPostmortemStatusTileSelection: (
  tile: PostmortemStatusTile,
) => FacetTileSelection = (tile: PostmortemStatusTile): FacetTileSelection => {
  return {
    facetKey: POSTMORTEM_STATUS_FACET_KEY,
    values: [tile.statusId],
    operator: "is",
  };
};

/*
 * Is the bar already showing exactly what this tile counts? Drives both the
 * tile's pressed state and its toggle-off, so a tile that looks lit is
 * always the one a second click turns off.
 */
export const isPostmortemStatusTileApplied: (
  tile: PostmortemStatusTile,
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
) => boolean = (
  tile: PostmortemStatusTile,
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
): boolean => {
  return isFacetTileSelectionApplied(
    getPostmortemStatusTileSelection(tile),
    facetSelections,
    facetOperators,
  );
};

/*
 * Moves the Postmortem Status chip to what a tile counts - or, when it is
 * there already, clears it. Only that chip: an owner or a severity the
 * reader picked stays.
 */
export const applyPostmortemStatusTile: (data: {
  tile: PostmortemStatusTile;
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
}) => void = (data: {
  tile: PostmortemStatusTile;
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
}): void => {
  const selection: FacetTileSelection = getPostmortemStatusTileSelection(
    data.tile,
  );

  if (
    isPostmortemStatusTileApplied(
      data.tile,
      data.facetSelections,
      data.facetOperators,
    )
  ) {
    data.setFacetSelection(POSTMORTEM_STATUS_FACET_KEY, [], "is");
    return;
  }

  data.setFacetSelection(
    POSTMORTEM_STATUS_FACET_KEY,
    normalizeFacetValues(selection.values),
    resolveFacetOperator(selection.operator),
  );
};

/*
 * The colour of a tile's count. A postmortem still owed draws the eye while
 * there is one - amber for those not started, indigo for those under way;
 * done ones stay quiet. A zero is grey whatever the status.
 */
export const getPostmortemStatusTileCountClassName: (
  tile: PostmortemStatusTile,
  count: number,
) => string = (tile: PostmortemStatusTile, count: number): string => {
  if (count <= 0) {
    return "text-gray-400";
  }

  if (tile.progress === PostmortemProgress.NotStarted) {
    return "text-amber-600";
  }

  if (tile.progress === PostmortemProgress.InProgress) {
    return "text-indigo-600";
  }

  return "text-gray-900";
};

/*
 * The tiles' grid: one column per status up to four from md up, so the
 * four statuses a project starts with share one line, and more wrap. Class
 * names are written out whole, as Tailwind finds them.
 */
export const getPostmortemStatusTilesGridClassName: (
  tileCount: number,
) => string = (tileCount: number): string => {
  if (tileCount <= 2) {
    return "grid grid-cols-2 gap-4";
  }

  if (tileCount === 3) {
    return "grid grid-cols-2 gap-4 md:grid-cols-3";
  }

  return "grid grid-cols-2 gap-4 md:grid-cols-4";
};
