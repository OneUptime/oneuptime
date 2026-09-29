import {
  INVENTORY_ITEMS_TABLE_ID,
  INVENTORY_SOURCE_FACET_KEY,
  INVENTORY_STATUS_FACET_KEY,
  INVENTORY_TYPE_FACET_KEY,
} from "./InventoryFacets";
import {
  INVENTORY_SCOPE_SOURCE_PARAM,
  INVENTORY_SCOPE_STALE_PARAM,
  INVENTORY_SCOPE_TYPE_PARAM,
  InventoryScope,
  isInventoryScopeEmpty,
  parseInventoryScope,
} from "./InventoryScope";
import {
  FacetSelectionState,
  parseFacetSelectionState,
} from "../ResourceOwners/FacetSelectionState";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

const SCOPE_PARAMETERS: Array<string> = [
  INVENTORY_SCOPE_TYPE_PARAM,
  INVENTORY_SCOPE_SOURCE_PARAM,
  INVENTORY_SCOPE_STALE_PARAM,
];

type ReadSnapshotFunction = (raw: string | null) => JSONObject | null;

const readSnapshot: ReadSnapshotFunction = (
  raw: string | null,
): JSONObject | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSONFunctions.deserialize(JSONFunctions.parseJSONObject(raw));
  } catch {
    return null;
  }
};

export type NormalizeInventoryListFacetSearchFunction = (
  search: string,
) => string;

/**
 * Overview and sidebar links still carry the short `type`, `source` and
 * `stale` parameters. Consume them once into the table's regular facet state
 * so the arriving filters are visible, editable and clearable. Removing the
 * old parameters also prevents refresh from reapplying a cleared chip.
 *
 * This runs before InventoryTable mounts: its facet hook reads the browser
 * URL once to restore selections, and must see the normalized URL immediately.
 */
export const normalizeInventoryListFacetSearch: NormalizeInventoryListFacetSearchFunction =
  (search: string): string => {
    const params: URLSearchParams = new URLSearchParams(search);

    if (
      !SCOPE_PARAMETERS.some((param: string): boolean => {
        return params.has(param);
      })
    ) {
      return search;
    }

    const scope: InventoryScope = parseInventoryScope(
      (param: string): string | null => {
        return params.get(param);
      },
    );

    for (const param of SCOPE_PARAMETERS) {
      params.delete(param);
    }

    if (!isInventoryScopeEmpty(scope)) {
      const facetParam: string = TableFilterUrlState.getParamName(
        INVENTORY_ITEMS_TABLE_ID,
        "facets",
      );
      const state: FacetSelectionState = parseFacetSelectionState(
        readSnapshot(params.get(facetParam)),
      );

      const scopedValues: Record<string, string | undefined> = {
        [INVENTORY_TYPE_FACET_KEY]: scope.entityType,
        [INVENTORY_SOURCE_FACET_KEY]: scope.source,
        [INVENTORY_STATUS_FACET_KEY]: scope.staleOnly ? "stale" : undefined,
      };

      for (const [key, value] of Object.entries(scopedValues)) {
        if (value) {
          state.facetSelections[key] = [value];
          state.facetOperators[key] = "is";
        }
      }

      params.set(
        facetParam,
        TableFilterUrlState.serializeState(state as unknown as JSONObject)!,
      );

      // A page from the previous list may be outside the narrower result set.
      const viewParam: string = TableFilterUrlState.getParamName(
        INVENTORY_ITEMS_TABLE_ID,
        "view",
      );
      const view: JSONObject = readSnapshot(params.get(viewParam)) || {};
      params.set(
        viewParam,
        TableFilterUrlState.serializeState({ ...view, page: 1 })!,
      );
    }

    const normalized: string = params.toString();
    return normalized ? `?${normalized}` : "";
  };
