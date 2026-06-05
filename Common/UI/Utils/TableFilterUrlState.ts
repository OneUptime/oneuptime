import Navigation from "./Navigation";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";

export type TableFilterUrlStateKind = "facets" | "filter";

/**
 * Persists a table's filter/facet selections in the URL query string so they:
 *  - survive navigating to a detail page and clicking the browser "Back" button
 *    (the list page remounts with the params still on the URL), and
 *  - are shareable/bookmarkable (the URL fully describes the filtered view).
 *
 * The snapshot is run through {@link JSONFunctions} so OneUptime's typed query
 * values (Search, Includes, InBetween, ...) round-trip as real class instances
 * rather than plain objects. Params are namespaced by `tableId` so two tables on
 * the same route don't clobber each other.
 */
export default class TableFilterUrlState {
  private static getParamName(
    tableId: string,
    kind: TableFilterUrlStateKind,
  ): string {
    return `${tableId}-${kind}`;
  }

  /*
   * Read a previously-persisted snapshot from the URL. Returns null when absent,
   * empty, or unparseable (e.g. a hand-edited param) so callers fall back to
   * their defaults.
   */
  public static read(
    tableId: string | undefined,
    kind: TableFilterUrlStateKind,
  ): JSONObject | null {
    if (!tableId) {
      return null;
    }

    try {
      const raw: string | null = Navigation.getQueryStringByName(
        this.getParamName(tableId, kind),
      );

      if (!raw) {
        return null;
      }

      const deserialized: JSONObject = JSONFunctions.deserialize(
        JSONFunctions.parseJSONObject(raw),
      );

      if (deserialized && Object.keys(deserialized).length > 0) {
        return deserialized;
      }

      return null;
    } catch {
      return null;
    }
  }

  /*
   * Persist a snapshot to the URL, or remove the param when the state is empty
   * (`null`, or an object with no keys). Does not add a browser-history entry.
   */
  public static write(
    tableId: string | undefined,
    kind: TableFilterUrlStateKind,
    state: JSONObject | null,
  ): void {
    if (!tableId) {
      return;
    }

    try {
      const hasState: boolean = Boolean(state && Object.keys(state).length > 0);

      const value: string | null = hasState
        ? JSON.stringify(JSONFunctions.serialize(state as JSONObject))
        : null;

      Navigation.setQueryString({
        [this.getParamName(tableId, kind)]: value,
      });
    } catch {
      /*
       * Serialization failure (shouldn't happen for filter data) — skip the
       * URL sync rather than break the table.
       */
    }
  }
}
