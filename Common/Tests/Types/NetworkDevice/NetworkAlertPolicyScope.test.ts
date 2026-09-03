import { describe, expect, test } from "@jest/globals";
import NetworkAlertPolicyScope, {
  NetworkAlertPolicyScopeDevice,
  NetworkAlertPolicyScopeUtil,
} from "../../../Types/NetworkDevice/NetworkAlertPolicyScope";

/*
 * The scope is the half of a Network Alert Policy that decides how many
 * monitors get provisioned, and it lives in a jsonb column that the engine
 * re-reads on every device event. Two things are therefore pinned here:
 *
 *  1. THE MATCHING RULE. AND across kinds, OR within a kind, an empty kind
 *     matches everything. Every combination of the three kinds is walked
 *     below, because the rule's failure modes are silent in both directions:
 *     a too-wide match provisions billable monitors nobody asked for, and a
 *     too-narrow one leaves the warehouse switch the policy was written for
 *     unmonitored with no error anywhere.
 *
 *  2. THE CANONICAL FORM. Whatever a client or a hand-edited row holds,
 *     `normalize` returns three deduplicated string lists and nothing else.
 *     `matchesDevice`, `isUnscoped` and `describe` all read through it, so
 *     one junk row can never throw inside the engine, and a site id listed
 *     twice never counts a device twice.
 */

const SITE_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE_SWITCH: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROLE_ROUTER: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LABEL_PROD: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LABEL_EDGE: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const UNRELATED: string = "99999999-9999-4999-8999-999999999999";

const EMPTY_SCOPE: NetworkAlertPolicyScope = {
  siteIds: [],
  networkDeviceRoleIds: [],
  labelIds: [],
};

describe("NetworkAlertPolicyScopeUtil.normalize", () => {
  /*
   * Every shape a jsonb column or a request body can hold in place of a
   * scope, and all of them read as the widest scope rather than as an
   * error. The engine evaluates scopes in a loop over every policy in a
   * project; one throw would take out the provisioning of all of them.
   */
  test.each([
    undefined,
    null,
    "",
    "all",
    0,
    false,
    42,
    [],
    [SITE_A],
    (): void => {},
  ])("reads %p as the empty scope", (raw: unknown) => {
    expect(NetworkAlertPolicyScopeUtil.normalize(raw)).toEqual(EMPTY_SCOPE);
  });

  test("returns every list, present and empty, when the input has none", () => {
    const normalized: NetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize({});

    expect(normalized).toEqual(EMPTY_SCOPE);
    expect(Array.isArray(normalized.siteIds)).toBe(true);
    expect(Array.isArray(normalized.networkDeviceRoleIds)).toBe(true);
    expect(Array.isArray(normalized.labelIds)).toBe(true);
  });

  test("keeps well-formed lists as they are", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        siteIds: [SITE_A, SITE_B],
        networkDeviceRoleIds: [ROLE_SWITCH],
        labelIds: [LABEL_PROD, LABEL_EDGE],
      }),
    ).toEqual({
      siteIds: [SITE_A, SITE_B],
      networkDeviceRoleIds: [ROLE_SWITCH],
      labelIds: [LABEL_PROD, LABEL_EDGE],
    });
  });

  /*
   * A duplicated id is the difference between "this device matches" and
   * "this device matches twice" for any reader that counts, and between a
   * stable stored form and one that grows on every save for the row.
   */
  test("deduplicates ids in first-seen order", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        siteIds: [SITE_B, SITE_A, SITE_B, SITE_A, SITE_B],
      }).siteIds,
    ).toEqual([SITE_B, SITE_A]);
  });

  test("trims ids and drops blank ones", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        labelIds: [` ${LABEL_PROD} `, "", "   ", "\t\n", LABEL_PROD],
      }).labelIds,
    ).toEqual([LABEL_PROD]);
  });

  test("drops nulls, numbers, booleans and nested arrays inside a list", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        networkDeviceRoleIds: [
          null,
          undefined,
          7,
          true,
          [ROLE_ROUTER],
          ROLE_SWITCH,
          {},
        ],
      }).networkDeviceRoleIds,
    ).toEqual([ROLE_SWITCH]);
  });

  /*
   * A server-side caller can hand over ObjectID instances or serialised
   * relations rather than strings. Their id is what the scope means.
   */
  test("reads ObjectID-shaped objects by their _id or id", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        siteIds: [{ _id: SITE_A }, { id: SITE_B }, { _id: SITE_A }],
      }).siteIds,
    ).toEqual([SITE_A, SITE_B]);
  });

  test("treats a lone string as a one-element list", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({ siteIds: SITE_A }).siteIds,
    ).toEqual([SITE_A]);
  });

  test("treats a null or non-list value for a kind as that kind being empty", () => {
    expect(
      NetworkAlertPolicyScopeUtil.normalize({
        siteIds: null,
        networkDeviceRoleIds: 12,
        labelIds: { _id: LABEL_PROD },
      }),
    ).toEqual({
      siteIds: [],
      networkDeviceRoleIds: [],
      labelIds: [LABEL_PROD],
    });
  });

  /*
   * Only the three lists round-trip. A stray property on the stored JSON —
   * a renamed key from an older client, a typo — must not be carried
   * forward into the column on the next save.
   */
  test("drops properties that are not one of the three lists", () => {
    const normalized: NetworkAlertPolicyScope =
      NetworkAlertPolicyScopeUtil.normalize({
        siteIds: [SITE_A],
        sites: [SITE_B],
        anything: true,
      });

    expect(Object.keys(normalized).sort()).toEqual([
      "labelIds",
      "networkDeviceRoleIds",
      "siteIds",
    ]);
  });

  test("is idempotent", () => {
    const once: NetworkAlertPolicyScope = NetworkAlertPolicyScopeUtil.normalize(
      {
        siteIds: [SITE_A, SITE_A, " "],
        labelIds: LABEL_PROD,
      },
    );

    expect(NetworkAlertPolicyScopeUtil.normalize(once)).toEqual(once);
  });

  test("does not mutate its input", () => {
    const raw: { siteIds: Array<string> } = { siteIds: [SITE_A, SITE_A] };

    NetworkAlertPolicyScopeUtil.normalize(raw);

    expect(raw).toEqual({ siteIds: [SITE_A, SITE_A] });
  });
});

describe("NetworkAlertPolicyScopeUtil.isUnscoped", () => {
  /*
   * "Every device in the project" is what the confirm dialog and the
   * settings table have to say out loud, so every spelling of nothing has
   * to be recognised as nothing.
   */
  test.each([
    undefined,
    null,
    {},
    EMPTY_SCOPE,
    { siteIds: [] },
    { siteIds: [""], networkDeviceRoleIds: [" "], labelIds: [null] },
    { siteIds: null, networkDeviceRoleIds: undefined },
    { unrelated: [SITE_A] },
  ])("is true for %p", (scope: unknown) => {
    expect(
      NetworkAlertPolicyScopeUtil.isUnscoped(
        scope as NetworkAlertPolicyScope | null | undefined,
      ),
    ).toBe(true);
  });

  test.each([
    { siteIds: [SITE_A] },
    { networkDeviceRoleIds: [ROLE_SWITCH] },
    { labelIds: [LABEL_PROD] },
    { siteIds: SITE_A },
    { siteIds: [{ _id: SITE_A }] },
  ])("is false for %p", (scope: unknown) => {
    expect(
      NetworkAlertPolicyScopeUtil.isUnscoped(scope as NetworkAlertPolicyScope),
    ).toBe(false);
  });
});

describe("NetworkAlertPolicyScopeUtil.matchesDevice", () => {
  const warehouseSwitch: NetworkAlertPolicyScopeDevice = {
    siteId: SITE_A,
    networkDeviceRoleId: ROLE_SWITCH,
    labelIds: [LABEL_PROD, LABEL_EDGE],
  };

  const bareDevice: NetworkAlertPolicyScopeDevice = {
    siteId: null,
    networkDeviceRoleId: null,
    labelIds: [],
  };

  /*
   * The empty-kind rule, first, because it is the one that turns `{}` into
   * "all devices": a scope that lists nothing matches a device that has
   * nothing.
   */
  test("an empty scope matches every device, including one with no site, role or labels", () => {
    expect(NetworkAlertPolicyScopeUtil.matchesDevice({}, warehouseSwitch)).toBe(
      true,
    );
    expect(NetworkAlertPolicyScopeUtil.matchesDevice({}, bareDevice)).toBe(
      true,
    );
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(undefined, { labelIds: [] }),
    ).toBe(true);
    expect(NetworkAlertPolicyScopeUtil.matchesDevice(null, {})).toBe(true);
  });

  describe("one kind at a time", () => {
    test("site: matches a device in a listed site", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    test("site: OR within the kind — any listed site will do", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_B, SITE_A] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    test("site: refuses a device in an unlisted site", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_B] },
          warehouseSwitch,
        ),
      ).toBe(false);
    });

    /*
     * "In site A" cannot be true of a device that is nowhere. Matching a
     * site-less device against a site-scoped policy would provision a
     * monitor for every un-sited device the moment any policy named a site.
     */
    test("site: refuses a device with no site", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A] },
          bareDevice,
        ),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice({ siteIds: [SITE_A] }, {}),
      ).toBe(false);
    });

    test("role: matches a device with a listed role", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_SWITCH] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    test("role: OR within the kind", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_ROUTER, ROLE_SWITCH] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    test("role: refuses a device with an unlisted role, or none", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_ROUTER] },
          warehouseSwitch,
        ),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_SWITCH] },
          bareDevice,
        ),
      ).toBe(false);
    });

    test("label: matches a device carrying a listed label", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { labelIds: [LABEL_PROD] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    /*
     * OR within the kind, on both sides: the scope may list several labels
     * and the device may carry several, and one shared label is a match.
     */
    test("label: any shared label is enough", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { labelIds: [UNRELATED, LABEL_EDGE] },
          warehouseSwitch,
        ),
      ).toBe(true);
    });

    test("label: refuses a device sharing no listed label, or carrying none", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { labelIds: [UNRELATED] },
          warehouseSwitch,
        ),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { labelIds: [LABEL_PROD] },
          bareDevice,
        ),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { labelIds: [LABEL_PROD] },
          { siteId: SITE_A },
        ),
      ).toBe(false);
    });
  });

  describe("kinds combined — AND across kinds", () => {
    test("site AND role: both must hold", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A], networkDeviceRoleIds: [ROLE_SWITCH] },
          warehouseSwitch,
        ),
      ).toBe(true);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A], networkDeviceRoleIds: [ROLE_ROUTER] },
          warehouseSwitch,
        ),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_B], networkDeviceRoleIds: [ROLE_SWITCH] },
          warehouseSwitch,
        ),
      ).toBe(false);
    });

    test("site AND label", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A], labelIds: [LABEL_EDGE] },
          warehouseSwitch,
        ),
      ).toBe(true);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { siteIds: [SITE_A], labelIds: [UNRELATED] },
          warehouseSwitch,
        ),
      ).toBe(false);
    });

    test("role AND label", () => {
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_SWITCH], labelIds: [LABEL_PROD] },
          warehouseSwitch,
        ),
      ).toBe(true);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(
          { networkDeviceRoleIds: [ROLE_ROUTER], labelIds: [LABEL_PROD] },
          warehouseSwitch,
        ),
      ).toBe(false);
    });

    /*
     * All three at once, with OR inside each: the policy from the model's
     * own header — "switches or routers, in either warehouse, tagged prod
     * or edge" — and the one-kind-off failure for each kind in turn.
     */
    test("site AND role AND label, each kind OR-ed inside", () => {
      const scope: NetworkAlertPolicyScope = {
        siteIds: [SITE_B, SITE_A],
        networkDeviceRoleIds: [ROLE_ROUTER, ROLE_SWITCH],
        labelIds: [LABEL_EDGE, UNRELATED],
      };

      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(scope, warehouseSwitch),
      ).toBe(true);

      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(scope, {
          ...warehouseSwitch,
          siteId: UNRELATED,
        }),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(scope, {
          ...warehouseSwitch,
          networkDeviceRoleId: UNRELATED,
        }),
      ).toBe(false);
      expect(
        NetworkAlertPolicyScopeUtil.matchesDevice(scope, {
          ...warehouseSwitch,
          labelIds: [LABEL_PROD],
        }),
      ).toBe(false);
    });
  });

  /*
   * The matcher reads the scope through normalize, so the junk shapes the
   * normalize suite tolerates are tolerated here too — and, crucially, a
   * blank id does not count as a listed id. `{ siteIds: [""] }` is an empty
   * picker, and an empty picker matches everything rather than nothing.
   */
  test("reads the scope through normalize — blanks and duplicates change nothing", () => {
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(
        {
          siteIds: [""],
          networkDeviceRoleIds: [null],
        } as unknown as NetworkAlertPolicyScope,
        bareDevice,
      ),
    ).toBe(true);
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(
        { siteIds: [` ${SITE_A} `, SITE_A] },
        warehouseSwitch,
      ),
    ).toBe(true);
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(
        { siteIds: SITE_A } as unknown as NetworkAlertPolicyScope,
        warehouseSwitch,
      ),
    ).toBe(true);
  });

  test("trims the device's own ids before comparing", () => {
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(
        { siteIds: [SITE_A], labelIds: [LABEL_PROD] },
        { siteId: ` ${SITE_A} `, labelIds: [` ${LABEL_PROD}`] },
      ),
    ).toBe(true);
  });

  test("never matches on a blank device id against a listed kind", () => {
    expect(
      NetworkAlertPolicyScopeUtil.matchesDevice(
        { siteIds: [SITE_A] },
        { siteId: "   " },
      ),
    ).toBe(false);
  });
});

describe("NetworkAlertPolicyScopeUtil.describe", () => {
  const names: {
    sites: Record<string, string>;
    roles: Record<string, string>;
    labels: Record<string, string>;
  } = {
    sites: { [SITE_A]: "Warehouse", [SITE_B]: "Depot" },
    roles: { [ROLE_SWITCH]: "Switch", [ROLE_ROUTER]: "Router" },
    labels: { [LABEL_PROD]: "Production", [LABEL_EDGE]: "Edge" },
  };

  /*
   * The row that provisions a monitor for everything has to be the row
   * that stops the eye. It is also the answer for every junk shape, for
   * the same reason isUnscoped reads those as unscoped.
   */
  test.each([undefined, null, {}, EMPTY_SCOPE, { siteIds: [""] }])(
    "says 'All devices' for %p",
    (scope: unknown) => {
      expect(
        NetworkAlertPolicyScopeUtil.describe(
          scope as NetworkAlertPolicyScope | null | undefined,
          names,
        ),
      ).toBe("All devices");
    },
  );

  test("names a single site when its name is known", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe({ siteIds: [SITE_A] }, names),
    ).toBe("Devices in site Warehouse");
  });

  /*
   * A count, never a raw id. "in site 7f3c9a…" tells the operator nothing
   * and breaks the table's column width; "in 1 site" tells them to open the
   * policy, which is the most the table can honestly say.
   */
  test("counts instead when the name is unknown, and never prints the id", () => {
    const description: string = NetworkAlertPolicyScopeUtil.describe(
      { siteIds: [UNRELATED] },
      names,
    );

    expect(description).toBe("Devices in 1 site");
    expect(description).not.toContain(UNRELATED);
  });

  test("counts several sites even when every name is known", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { siteIds: [SITE_A, SITE_B] },
        names,
      ),
    ).toBe("Devices in 2 sites");
  });

  test("works with no names at all", () => {
    expect(NetworkAlertPolicyScopeUtil.describe({ siteIds: [SITE_A] })).toBe(
      "Devices in 1 site",
    );
    expect(
      NetworkAlertPolicyScopeUtil.describe({
        networkDeviceRoleIds: [ROLE_SWITCH, ROLE_ROUTER],
      }),
    ).toBe("Devices with 2 roles");
  });

  test("the example from the settings table: sites counted, role named", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { siteIds: [SITE_A, SITE_B], networkDeviceRoleIds: [ROLE_SWITCH] },
        names,
      ),
    ).toBe("Devices in 2 sites with role Switch");
  });

  test("role and label are joined with 'and'", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { networkDeviceRoleIds: [ROLE_SWITCH], labelIds: [LABEL_PROD] },
        names,
      ),
    ).toBe("Devices with role Switch and label Production");
  });

  test("label alone", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe({ labelIds: [LABEL_EDGE] }, names),
    ).toBe("Devices with label Edge");
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { labelIds: [LABEL_EDGE, LABEL_PROD, UNRELATED] },
        names,
      ),
    ).toBe("Devices with 3 labels");
  });

  test("all three kinds", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        {
          siteIds: [SITE_A],
          networkDeviceRoleIds: [ROLE_SWITCH, ROLE_ROUTER],
          labelIds: [LABEL_PROD],
        },
        names,
      ),
    ).toBe("Devices in site Warehouse with 2 roles and label Production");
  });

  test("a blank name is treated as unknown", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { siteIds: [SITE_A] },
        { sites: { [SITE_A]: "   " } },
      ),
    ).toBe("Devices in 1 site");
  });

  /*
   * Duplicates are collapsed before counting: a scope holding the same
   * site twice is "in site Warehouse", not "in 2 sites".
   */
  test("counts after deduplication", () => {
    expect(
      NetworkAlertPolicyScopeUtil.describe(
        { siteIds: [SITE_A, SITE_A, ` ${SITE_A} `] },
        names,
      ),
    ).toBe("Devices in site Warehouse");
  });
});
