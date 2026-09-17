import DashboardVariable from "../../Types/Dashboard/DashboardVariable";

/*
 * URL state for dashboard variables.
 *
 * Selected values are reflected in the URL as `?var-<name>=<value>` so a
 * dashboard link is shareable with a specific scope already applied. We
 * use the *name* (not the id) because names are user-facing — links
 * survive across dashboards if a variable named `cluster` exists in both.
 *
 * Multi-select uses a `,` separator. Variable names are restricted to
 * `[A-Za-z_][A-Za-z0-9_]*` by the editor, which never collides with `,`.
 */
const VAR_PREFIX: string = "var-";

export interface VariableUrlSnapshot {
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
}

export default class DashboardVariableUrlState {
  public static parseFromSearch(
    search: string,
  ): Record<string, VariableUrlSnapshot> {
    const out: Record<string, VariableUrlSnapshot> = {};
    if (!search) {
      return out;
    }
    const params: URLSearchParams = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );
    params.forEach((rawValue: string, rawKey: string) => {
      if (!rawKey.startsWith(VAR_PREFIX)) {
        return;
      }
      const name: string = rawKey.slice(VAR_PREFIX.length);
      if (!name) {
        return;
      }
      const decoded: string = rawValue;
      if (decoded.includes(",")) {
        out[name] = {
          selectedValues: decoded
            .split(",")
            .map((v: string) => {
              return v.trim();
            })
            .filter((v: string) => {
              return v.length > 0;
            }),
        };
      } else {
        out[name] = { selectedValue: decoded };
      }
    });
    return out;
  }

  public static applyUrlToVariables(
    variables: Array<DashboardVariable>,
    fromUrl: Record<string, VariableUrlSnapshot>,
  ): Array<DashboardVariable> {
    return variables.map((variable: DashboardVariable) => {
      const fromName: VariableUrlSnapshot | undefined = fromUrl[variable.name];
      if (!fromName) {
        return variable;
      }

      /*
       * The URL's comma syntax cannot distinguish one multi-select choice
       * from a scalar. Resolve that ambiguity using the saved definition.
       */
      if (variable.isMultiSelect) {
        return {
          ...variable,
          selectedValue: undefined,
          selectedValues:
            fromName.selectedValues ||
            (fromName.selectedValue ? [fromName.selectedValue] : []),
        };
      }
      return {
        ...variable,
        selectedValue:
          fromName.selectedValue ?? fromName.selectedValues?.join(","),
        selectedValues: undefined,
      };
    });
  }

  /*
   * Write the current variable selection to window.location without
   * pushing a history entry. We mutate only the `var-<name>` params so
   * unrelated query string state (auth tokens, filter overrides) is
   * preserved.
   *
   * No-op outside browser contexts so callers can be reused in SSR/tests.
   */
  public static writeToBrowserUrl(variables: Array<DashboardVariable>): void {
    if (
      typeof window === "undefined" ||
      typeof window.history === "undefined" ||
      typeof window.location === "undefined"
    ) {
      return;
    }

    const url: URL = new URL(window.location.href);
    const params: URLSearchParams = url.searchParams;

    // Strip any prior var-* params so deleted variables stop appearing.
    const toDelete: Array<string> = [];
    params.forEach((_value: string, key: string) => {
      if (key.startsWith(VAR_PREFIX)) {
        toDelete.push(key);
      }
    });
    for (const key of toDelete) {
      params.delete(key);
    }

    for (const variable of variables) {
      const name: string = (variable.name || "").trim();
      if (!name) {
        continue;
      }
      const paramKey: string = `${VAR_PREFIX}${name}`;
      if (variable.isMultiSelect) {
        if (Array.isArray(variable.selectedValues)) {
          params.set(paramKey, variable.selectedValues.join(","));
        }
        continue;
      }

      /*
       * Keep an explicit All as `var-name=`. Omitting it would restore the
       * saved selection or default when this URL is reopened.
       */
      if (typeof variable.selectedValue === "string") {
        params.set(paramKey, variable.selectedValue);
      }
    }

    const nextSearch: string = params.toString();
    const nextUrl: string = `${url.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${url.hash || ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}
