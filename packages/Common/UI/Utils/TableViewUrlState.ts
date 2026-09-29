import { JSONObject } from "../../Types/JSON";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";

/**
 * The "everything that isn't a column filter or a facet" slice of a table's
 * view: the search box, the label chips next to it, the active sort and where
 * in the pagination the user is.
 *
 * Kept deliberately primitive (strings / numbers / string arrays) so the URL
 * param stays short and human-readable, and so a hand-edited link can never
 * smuggle a typed object into the table's query.
 */
export interface TableViewUrlStateData {
  search?: string | undefined;
  labels?: Array<string> | undefined;
  sortBy?: string | undefined;
  sortOrder?: SortOrder | undefined;
  page?: number | undefined;
  itemsOnPage?: number | undefined;
}

/**
 * The values a slice is compared against before being written. Anything equal
 * to its default is left out of the URL, so a table the user hasn't touched
 * contributes no query params at all.
 */
export interface TableViewUrlStateDefaults {
  sortBy?: string | undefined;
  sortOrder?: SortOrder | undefined;
}

/**
 * Hard ceiling on a restored page size. Anything above this is a hand-edited
 * URL trying to make the table ask the API for an unbounded page.
 */
export const MaxItemsOnPage: number = 1000;

export default class TableViewUrlState {
  /**
   * Serialize to the plain object that goes in the URL, omitting every value
   * that matches its default. Returns `null` when nothing is worth persisting
   * so the caller can drop the param entirely.
   */
  public static toJSON(
    state: TableViewUrlStateData,
    defaults?: TableViewUrlStateDefaults | undefined,
  ): JSONObject | null {
    const json: JSONObject = {};

    const search: string = (state.search || "").trim();
    if (search.length > 0) {
      json["search"] = search;
    }

    const labels: Array<string> = (state.labels || []).filter((l: string) => {
      return Boolean(l);
    });
    if (labels.length > 0) {
      json["labels"] = labels;
    }

    /*
     * Sort is only worth persisting when it differs from the sort the table
     * was mounted with — otherwise every table on the page would carry a
     * redundant param.
     */
    const sortIsDefault: boolean =
      (state.sortBy || null) === (defaults?.sortBy || null) &&
      (state.sortOrder || null) === (defaults?.sortOrder || null);

    if (state.sortBy && !sortIsDefault) {
      json["sortBy"] = state.sortBy;
      json["sortOrder"] = state.sortOrder || SortOrder.Ascending;
    }

    if (state.page && state.page > 1) {
      json["page"] = state.page;
    }

    if (state.itemsOnPage && state.itemsOnPage > 0) {
      json["itemsOnPage"] = state.itemsOnPage;
    }

    if (Object.keys(json).length === 0) {
      return null;
    }

    return json;
  }

  /**
   * Rebuild the view state from a URL param. Every field is validated
   * independently: a bad `page` doesn't discard a good `search`, and an
   * unrecognised value is dropped rather than passed through to the query.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): TableViewUrlStateData {
    const state: TableViewUrlStateData = {};

    if (!json || typeof json !== "object") {
      return state;
    }

    if (typeof json["search"] === "string" && json["search"].trim() !== "") {
      state.search = json["search"];
    }

    if (Array.isArray(json["labels"])) {
      const labels: Array<string> = (json["labels"] as Array<unknown>)
        .filter((l: unknown) => {
          return typeof l === "string" && l.trim() !== "";
        })
        .map((l: unknown) => {
          return l as string;
        });

      if (labels.length > 0) {
        state.labels = labels;
      }
    }

    if (typeof json["sortBy"] === "string" && json["sortBy"].trim() !== "") {
      state.sortBy = json["sortBy"];

      state.sortOrder =
        json["sortOrder"] === SortOrder.Descending
          ? SortOrder.Descending
          : SortOrder.Ascending;
    }

    const page: number | null = this.toPositiveInteger(json["page"]);
    if (page !== null && page >= 1) {
      state.page = page;
    }

    const itemsOnPage: number | null = this.toPositiveInteger(
      json["itemsOnPage"],
    );
    if (
      itemsOnPage !== null &&
      itemsOnPage >= 1 &&
      itemsOnPage <= MaxItemsOnPage
    ) {
      state.itemsOnPage = itemsOnPage;
    }

    return state;
  }

  private static toPositiveInteger(value: unknown): number | null {
    if (typeof value !== "number" || !isFinite(value)) {
      return null;
    }

    const asInteger: number = Math.floor(value);

    if (asInteger < 1 || asInteger > LIMIT_MAX) {
      return null;
    }

    return asInteger;
  }
}
