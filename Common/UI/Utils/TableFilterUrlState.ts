import Navigation from "./Navigation";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import { Logger } from "./Logger";
import { VoidFunction } from "../../Types/FunctionTypes";

/**
 * The three independent slices of a table's view state. Each is stored under
 * its own `<tableId>-<kind>` query param so a change to one never has to
 * re-serialize the others.
 *
 *  - `filter` — the classic column-filter popup selections (`FilterData`).
 *  - `facets` — the chip/facet bar selections (see `useResourceOwners`).
 *  - `view`   — search text, label chips, sort and pagination.
 */
export type TableFilterUrlStateKind = "facets" | "filter" | "view";

export const TableFilterUrlStateKinds: Array<TableFilterUrlStateKind> = [
  "filter",
  "facets",
  "view",
];

/**
 * Persists a table's filter / facet / view selections in the URL query string
 * so they:
 *  - survive navigating to a detail page and clicking the browser "Back" button
 *    (the list page remounts with the params still on the URL), and
 *  - are shareable/bookmarkable (the URL fully describes the filtered view).
 *
 * The snapshot is run through {@link JSONFunctions} so OneUptime's typed query
 * values (Search, Includes, InBetween, ...) round-trip as real class instances
 * rather than plain objects. Params are namespaced by `tableId` so several
 * tables on the same route each keep their own state.
 */
export default class TableFilterUrlState {
  /**
   * Upper bound on the whole query string we are willing to produce.
   *
   * nginx's default `large_client_header_buffers` gives ~8KB for the entire
   * request line, and that budget is shared with the path and every other
   * table on the page. We stay well under it: past this point the table keeps
   * working from React state, it just stops mirroring the offending slice into
   * the URL (so the link degrades to "unshared" rather than the page failing
   * to load on refresh).
   */
  public static readonly MaxQueryStringLength: number = 4000;

  public static getParamName(
    tableId: string,
    kind: TableFilterUrlStateKind,
  ): string {
    return `${tableId}-${kind}`;
  }

  /**
   * Keys currently claimed by mounted tables, so a duplicate can be reported.
   * Not used to change behaviour — two tables sharing a key would already have
   * shared their `userPreferencesKey` page-size preference, so the fix always
   * belongs at the call site.
   */
  private static claimedKeys: Map<string, number> = new Map<string, number>();

  /**
   * Register a mounted table's URL namespace. Returns a release function to
   * call on unmount.
   *
   * Two tables on one route claiming the same key would read and write the
   * same params — paging one would repaginate the other, and a reload would
   * restore whichever wrote last. That is always a call-site bug (give the
   * tables distinct `userPreferencesKey`/`urlStateKey` values), so this warns
   * loudly rather than silently renaming a key that may already be in
   * someone's bookmarks.
   */
  public static claimKey(tableId: string | undefined): VoidFunction {
    if (!tableId) {
      return () => {
        // nothing claimed
      };
    }

    const claims: number = (this.claimedKeys.get(tableId) || 0) + 1;
    this.claimedKeys.set(tableId, claims);

    if (claims > 1) {
      Logger.warn(
        `TableFilterUrlState: ${claims} tables on this page share the URL state key "${tableId}". ` +
          `They will overwrite each other's filters, sort and pagination in the URL. ` +
          `Give each table a distinct "userPreferencesKey" (or pass "urlStateKey").`,
      );
    }

    return () => {
      const remaining: number = (this.claimedKeys.get(tableId) || 1) - 1;

      if (remaining <= 0) {
        this.claimedKeys.delete(tableId);
        return;
      }

      this.claimedKeys.set(tableId, remaining);
    };
  }

  /**
   * Test seam — drops every claim so one test's mounted tables don't leak into
   * the next.
   */
  public static resetClaimedKeys(): void {
    this.claimedKeys.clear();
  }

  /**
   * Every param name this table could own. Used to clear a table's state and
   * by tests.
   */
  public static getAllParamNames(tableId: string): Array<string> {
    return TableFilterUrlStateKinds.map((kind: TableFilterUrlStateKind) => {
      return this.getParamName(tableId, kind);
    });
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
    this.writeMany(tableId, { [kind]: state });
  }

  /**
   * Write several slices in one `history.replaceState` call. Passing a kind
   * with a `null`/empty value removes that param; omitting a kind leaves
   * whatever is already on the URL untouched.
   */
  public static writeMany(
    tableId: string | undefined,
    states: Partial<Record<TableFilterUrlStateKind, JSONObject | null>>,
  ): void {
    if (!tableId) {
      return;
    }

    const params: Dictionary<string | null> = {};

    /*
     * Track the query string as it would look after each param is applied, so
     * the size check accounts for the other params in this same batch — not
     * just the URL as it was before the batch started.
     */
    const projected: URLSearchParams = this.getCurrentSearchParams();

    for (const kind of Object.keys(states) as Array<TableFilterUrlStateKind>) {
      const state: JSONObject | null | undefined = states[kind];
      const paramName: string = this.getParamName(tableId, kind);

      let value: string | null = null;

      try {
        const hasState: boolean = Boolean(
          state && Object.keys(state).length > 0,
        );

        value = hasState
          ? JSON.stringify(JSONFunctions.serialize(state as JSONObject))
          : null;
      } catch (err) {
        /*
         * Serialization failure (shouldn't happen for filter data) — drop the
         * param rather than break the table, and leave a breadcrumb.
         */
        Logger.warn(
          `TableFilterUrlState: could not serialize "${paramName}": ${err}`,
        );
        value = null;
      }

      if (value === null) {
        projected.delete(paramName);
      } else {
        const previous: string | null = projected.get(paramName);
        projected.set(paramName, value);

        if (projected.toString().length > this.MaxQueryStringLength) {
          /*
           * Too big to share. Drop the param so a page refresh doesn't hit an
           * over-long request line — React state remains the source of truth
           * for this session.
           */
          Logger.warn(
            `TableFilterUrlState: "${paramName}" is too large for the URL (${value.length} chars) and was not persisted.`,
          );
          value = null;

          if (previous === null) {
            projected.delete(paramName);
          } else {
            projected.set(paramName, previous);
          }
        }
      }

      params[paramName] = value;
    }

    Navigation.setQueryString(params);
  }

  /**
   * Remove every param this table owns from the URL.
   */
  public static clear(tableId: string | undefined): void {
    if (!tableId) {
      return;
    }

    const params: Dictionary<string | null> = {};

    for (const paramName of this.getAllParamNames(tableId)) {
      params[paramName] = null;
    }

    Navigation.setQueryString(params);
  }

  /**
   * The current query string as a mutable `URLSearchParams`. Size checks
   * measure `toString()` on this — the *encoded* length, because that is what
   * actually travels on the wire.
   */
  private static getCurrentSearchParams(): URLSearchParams {
    try {
      return new URLSearchParams(Navigation.getQueryString());
    } catch {
      return new URLSearchParams();
    }
  }
}
