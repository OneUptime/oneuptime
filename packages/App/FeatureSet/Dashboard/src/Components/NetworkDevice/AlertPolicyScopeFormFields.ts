import NetworkAlertPolicyScope, {
  NetworkAlertPolicyScopeUtil,
} from "Common/Types/NetworkDevice/NetworkAlertPolicyScope";

/*
 * The form-side half of a Network Alert Policy's scope.
 *
 * The column is one jsonb object — { siteIds, networkDeviceRoleIds,
 * labelIds } — and the form edits it through three entity pickers. What
 * lives here is the plain mapping between the two, kept free of React and
 * of the form components so the App test suite (plain Node, no renderer)
 * can pin it: what the pickers hand back becomes a scope, what the row
 * holds becomes three picker values, and what the table shows against a
 * scope is a count per kind rather than a list of ids.
 *
 * Everything goes through NetworkAlertPolicyScopeUtil.normalize, the same
 * cleaner the service applies at the write, so the form never posts a shape
 * the engine would read differently from how the table described it.
 */

export interface AlertPolicyScopeSelection {
  siteIds: Array<string>;
  networkDeviceRoleIds: Array<string>;
  labelIds: Array<string>;
}

/*
 * The three picker values for a stored (or blank) scope. `raw` is whatever
 * the form holds for the column: the object the row carries on edit, or
 * undefined / "" on create — the form seeds an untouched custom field with an
 * empty string.
 */
export function readScopeSelection(raw: unknown): AlertPolicyScopeSelection {
  const normalized: NetworkAlertPolicyScope =
    NetworkAlertPolicyScopeUtil.normalize(raw);

  return {
    siteIds: normalized.siteIds || [],
    networkDeviceRoleIds: normalized.networkDeviceRoleIds || [],
    labelIds: normalized.labelIds || [],
  };
}

/* The scope to store for three picker values, in the canonical form. */
export function toScope(
  selection: AlertPolicyScopeSelection,
): NetworkAlertPolicyScope {
  return NetworkAlertPolicyScopeUtil.normalize(selection);
}

/*
 * The ids a multi-select picker handed back, as strings.
 *
 * Accepts every shape the dropdowns produce — nothing, one value, a list of
 * values, or a list of { value } options — so the mapping does not depend
 * on which dropdown implementation the field ends up rendering with.
 */
export function readDropdownIds(value: unknown): Array<string> {
  const candidates: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const candidate of candidates) {
    const id: string = readDropdownId(candidate);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

function readDropdownId(candidate: unknown): string {
  if (candidate === undefined || candidate === null) {
    return "";
  }

  if (typeof candidate === "object") {
    const option: { value?: unknown; _id?: unknown; id?: unknown } =
      candidate as { value?: unknown; _id?: unknown; id?: unknown };

    const inner: unknown = option.value ?? option._id ?? option.id;

    return inner === undefined || inner === null
      ? String(candidate).trim()
      : String(inner).trim();
  }

  return String(candidate).trim();
}

/*
 * What the settings table shows for a scope: "All devices", or a count per
 * kind — "2 sites, 1 role" — never an id. Resolving names is one lookup per
 * kind per row and belongs to the edit form, where the pickers do it
 * anyway; the table only has to say how wide the policy reaches.
 */
export function summarizeScope(scope: unknown): string {
  const selection: AlertPolicyScopeSelection = readScopeSelection(scope);

  const parts: Array<string> = [];

  if (selection.siteIds.length > 0) {
    parts.push(pluralize(selection.siteIds.length, "site", "sites"));
  }

  if (selection.networkDeviceRoleIds.length > 0) {
    parts.push(
      pluralize(selection.networkDeviceRoleIds.length, "role", "roles"),
    );
  }

  if (selection.labelIds.length > 0) {
    parts.push(pluralize(selection.labelIds.length, "label", "labels"));
  }

  if (parts.length === 0) {
    return "All devices";
  }

  return parts.join(", ");
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
