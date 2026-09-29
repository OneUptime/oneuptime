/*
 * WHICH devices a Network Alert Policy covers.
 *
 * A policy says "devices like THESE get a Network Device monitor cloned from
 * THIS template" once, and the engine keeps one monitor per matching device
 * from then on. The "like these" half is this object: a set of site ids, a
 * set of device-role ids and a set of label ids, stored as one jsonb column
 * on the policy row rather than as three join tables.
 *
 * jsonb, not join tables, on purpose. The scope is read whole every time the
 * engine asks "does this device match?" and never queried the other way
 * round ("which policies name site X?" is answered by scanning the project's
 * handful of policies, not by an index), so three link tables would buy
 * nothing but three more CRUD surfaces and three more cascade rules to get
 * right. It also lets the dashboard post the whole picker state as one field.
 *
 * The matching rule is the one every filter in this product uses:
 *
 *   - AND across kinds: a device must satisfy the site list AND the role list
 *     AND the label list.
 *   - OR within a kind: "in site A or site B", "carrying label X or label Y".
 *   - An EMPTY kind matches everything. Leaving the sites list empty means
 *     "any site (including no site)", not "no site".
 *
 * So `{}` — every list empty — is the widest possible scope: every device in
 * the project. That is a legitimate and common policy ("everything gets a
 * reachability monitor"), but it is also the one that provisions the most
 * billable monitors, which is why `isUnscoped` exists as a named question
 * rather than a `length === 0` check scattered over the callers: the settings
 * table, the confirm dialog and the engine all need to say "ALL devices" in
 * the same breath.
 *
 * Everything that reads a scope goes through `normalize` first. The column is
 * jsonb, so a row can hold whatever a client — or a hand-edited API call — put
 * in it: a lone string where an array was expected, nulls, duplicated ids,
 * blank strings from an empty picker. Tolerating all of that in one place
 * means the engine never throws over one bad row and never double-counts a
 * device because a site id was listed twice.
 */
export interface NetworkAlertPolicyScope {
  siteIds?: Array<string>;
  networkDeviceRoleIds?: Array<string>;
  labelIds?: Array<string>;
}

/*
 * The slice of a NetworkDevice the matcher looks at. Kept to plain ids so
 * the engine can feed it rows selected with three columns and a label join,
 * and so a test can build one in a line.
 */
export interface NetworkAlertPolicyScopeDevice {
  siteId?: string | null;
  networkDeviceRoleId?: string | null;
  labelIds?: Array<string>;
}

/*
 * Display names for `describe`, keyed by id. Every map is optional and every
 * lookup may miss: the settings table renders before its lookups resolve,
 * and a scope can name a site that has since been deleted. A missing name
 * falls back to a count ("in 2 sites"), never to the raw id.
 */
export interface NetworkAlertPolicyScopeNames {
  sites?: Record<string, string>;
  roles?: Record<string, string>;
  labels?: Record<string, string>;
}

/*
 * A normalized scope: every list present, deduplicated, and holding only
 * non-blank strings. What `normalize` returns and what every other method
 * works on internally.
 */
interface NormalizedNetworkAlertPolicyScope {
  siteIds: Array<string>;
  networkDeviceRoleIds: Array<string>;
  labelIds: Array<string>;
}

/*
 * One kind of id, for `describe`. `singular`/`plural` are the nouns; how the
 * clause hangs off "Devices" is decided by the caller — sites are somewhere
 * ("in"), roles and labels are something a device has ("with").
 */
interface ScopeKindDescription {
  ids: Array<string>;
  names: Record<string, string> | undefined;
  singular: string;
  plural: string;
}

export class NetworkAlertPolicyScopeUtil {
  /*
   * The canonical form of whatever was stored or posted.
   *
   * Accepts anything: `undefined`, `null`, a non-object, an object whose
   * lists are missing, `null`, lone strings, or arrays holding nulls,
   * numbers, blanks and duplicates. Returns three arrays of unique, trimmed,
   * non-empty strings — and nothing else, so a stray property on the stored
   * JSON never round-trips back into the column.
   */
  public static normalize(raw: unknown): NetworkAlertPolicyScope {
    const source: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    return {
      siteIds: NetworkAlertPolicyScopeUtil.readIdList(source["siteIds"]),
      networkDeviceRoleIds: NetworkAlertPolicyScopeUtil.readIdList(
        source["networkDeviceRoleIds"],
      ),
      labelIds: NetworkAlertPolicyScopeUtil.readIdList(source["labelIds"]),
    };
  }

  /*
   * True when the scope names nothing at all — every device in the project.
   *
   * Runs through `normalize` first, so a scope of `{ siteIds: [""] }` or
   * `{ siteIds: null }` reads as unscoped too: a blank picker is an empty
   * picker, and the alternative — a scope that matches nothing because it
   * holds one blank id — would be a policy that silently does nothing.
   */
  public static isUnscoped(
    scope: NetworkAlertPolicyScope | null | undefined,
  ): boolean {
    const normalized: NormalizedNetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize(
        scope,
      ) as NormalizedNetworkAlertPolicyScope;

    return (
      normalized.siteIds.length === 0 &&
      normalized.networkDeviceRoleIds.length === 0 &&
      normalized.labelIds.length === 0
    );
  }

  /*
   * The matching rule itself: AND across kinds, OR within a kind, an empty
   * kind matches everything.
   *
   * A device with no site never matches a scope that lists sites, and a
   * device with no labels never matches a scope that lists labels — "in site
   * A" cannot be true of a device that is nowhere. The converse is the
   * empty-kind rule: a scope that lists no sites is satisfied by a device
   * with no site.
   */
  public static matchesDevice(
    scope: NetworkAlertPolicyScope | null | undefined,
    device: NetworkAlertPolicyScopeDevice,
  ): boolean {
    const normalized: NormalizedNetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize(
        scope,
      ) as NormalizedNetworkAlertPolicyScope;

    if (
      normalized.siteIds.length > 0 &&
      !NetworkAlertPolicyScopeUtil.listHasId(normalized.siteIds, device.siteId)
    ) {
      return false;
    }

    if (
      normalized.networkDeviceRoleIds.length > 0 &&
      !NetworkAlertPolicyScopeUtil.listHasId(
        normalized.networkDeviceRoleIds,
        device.networkDeviceRoleId,
      )
    ) {
      return false;
    }

    if (normalized.labelIds.length > 0) {
      const deviceLabelIds: Array<string> =
        NetworkAlertPolicyScopeUtil.readIdList(device.labelIds);

      const hasAnyLabel: boolean = deviceLabelIds.some(
        (labelId: string): boolean => {
          return normalized.labelIds.includes(labelId);
        },
      );

      if (!hasAnyLabel) {
        return false;
      }
    }

    return true;
  }

  /*
   * A sentence for the settings table.
   *
   *   {}                                    -> "All devices"
   *   { siteIds: [a, b] }                   -> "Devices in 2 sites"
   *   { siteIds: [a], roles: [switch] }     -> "Devices in site Warehouse with role Switch"
   *   { roles: [switch], labels: [prod] }   -> "Devices with role Switch and label Production"
   *
   * A single id whose name is known is named; anything else is counted. The
   * count, never the id: an operator reading "in site 7f3c..." learns
   * nothing, and "in 1 site" at least tells them to open the policy.
   *
   * "All devices" is deliberately blunt. It is the row that provisions a
   * monitor for everything, and the wording should make somebody scanning
   * the table stop on it.
   */
  public static describe(
    scope: NetworkAlertPolicyScope | null | undefined,
    names: NetworkAlertPolicyScopeNames = {},
  ): string {
    const normalized: NormalizedNetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize(
        scope,
      ) as NormalizedNetworkAlertPolicyScope;

    if (NetworkAlertPolicyScopeUtil.isUnscoped(normalized)) {
      return "All devices";
    }

    let sentence: string = "Devices";

    if (normalized.siteIds.length > 0) {
      sentence += ` in ${NetworkAlertPolicyScopeUtil.describeKind({
        ids: normalized.siteIds,
        names: names.sites,
        singular: "site",
        plural: "sites",
      })}`;
    }

    const withClauses: Array<string> = [];

    if (normalized.networkDeviceRoleIds.length > 0) {
      withClauses.push(
        NetworkAlertPolicyScopeUtil.describeKind({
          ids: normalized.networkDeviceRoleIds,
          names: names.roles,
          singular: "role",
          plural: "roles",
        }),
      );
    }

    if (normalized.labelIds.length > 0) {
      withClauses.push(
        NetworkAlertPolicyScopeUtil.describeKind({
          ids: normalized.labelIds,
          names: names.labels,
          singular: "label",
          plural: "labels",
        }),
      );
    }

    if (withClauses.length > 0) {
      sentence += ` with ${withClauses.join(" and ")}`;
    }

    return sentence;
  }

  // "site Warehouse" when there is one id and a name for it; "2 sites" else.
  private static describeKind(kind: ScopeKindDescription): string {
    if (kind.ids.length === 1) {
      const name: string = (kind.names?.[kind.ids[0] as string] || "").trim();

      if (name) {
        return `${kind.singular} ${name}`;
      }
    }

    return `${kind.ids.length} ${
      kind.ids.length === 1 ? kind.singular : kind.plural
    }`;
  }

  /*
   * One id list, cleaned. A lone string is one id (a client that sent
   * `siteIds: "abc"` meant `["abc"]`); anything that is not a string or an
   * array yields nothing. Inside an array only non-blank strings and
   * ObjectID-shaped objects (which carry their id under `_id` / `id`) count,
   * trimmed and deduplicated in first-seen order so the stored form is
   * stable across saves.
   */
  private static readIdList(raw: unknown): Array<string> {
    const candidates: Array<unknown> = Array.isArray(raw)
      ? raw
      : raw === undefined || raw === null
        ? []
        : [raw];

    const ids: Array<string> = [];

    for (const candidate of candidates) {
      const id: string | null = NetworkAlertPolicyScopeUtil.readId(candidate);

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  private static readId(value: unknown): string | null {
    if (typeof value === "string") {
      const trimmed: string = value.trim();

      return trimmed || null;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const relation: { _id?: unknown; id?: unknown } = value as {
        _id?: unknown;
        id?: unknown;
      };

      const relationId: unknown = relation._id || relation.id;

      if (typeof relationId === "string") {
        const trimmed: string = relationId.trim();

        return trimmed || null;
      }
    }

    return null;
  }

  private static listHasId(
    list: Array<string>,
    id: string | null | undefined,
  ): boolean {
    const normalizedId: string | null = NetworkAlertPolicyScopeUtil.readId(id);

    return normalizedId !== null && list.includes(normalizedId);
  }
}

export default NetworkAlertPolicyScope;
