import NetworkDeviceLinkRuleUtil, {
  LinkRuleDeviceInput,
  LinkRuleInput,
  LinkRuleOutcome,
} from "../../../Utils/Monitor/NetworkDeviceLinkRuleUtil";

describe("NetworkDeviceLinkRuleUtil.resolveRule", () => {
  const AP: string = "label-ap";
  const FLOOR_1: string = "label-floor-1";
  const UPLINK: string = "label-uplink";

  const device: (id: string, labelIds: Array<string>) => LinkRuleDeviceInput = (
    id: string,
    labelIds: Array<string>,
  ): LinkRuleDeviceInput => {
    return { id, labelIds };
  };

  const rule: (overrides?: Partial<LinkRuleInput>) => LinkRuleInput = (
    overrides?: Partial<LinkRuleInput>,
  ): LinkRuleInput => {
    return {
      id: "r1",
      name: "Floor 1 APs",
      isEnabled: true,
      childLabelIds: [AP, FLOOR_1],
      parentLabelIds: [UPLINK, FLOOR_1],
      ...overrides,
    };
  };

  it("draws one uplink per matching child, not a mesh between them", () => {
    /*
     * The whole reason the rule is directed. Three children sharing a label
     * is three edges, not the three-way clique a symmetric "same label"
     * match would produce — and at forty devices that difference is 40
     * edges versus 780.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [
        device("ap1", [AP, FLOOR_1]),
        device("ap2", [AP, FLOOR_1]),
        device("ap3", [AP, FLOOR_1]),
        device("sw1", [UPLINK, FLOOR_1]),
      ],
    );

    expect(outcome.links).toHaveLength(3);
    expect(outcome.skipReason).toBeUndefined();
    for (const link of outcome.links) {
      expect(link.toDeviceId).toBe("sw1");
    }
    expect(
      outcome.links.map((link: { fromDeviceId: string }) => {
        return link.fromDeviceId;
      }),
    ).toEqual(["ap1", "ap2", "ap3"]);
  });

  it("requires ALL the labels, not any of them", () => {
    /*
     * "Access points on floor 1", not "access points anywhere plus
     * everything on floor 1" — any-of would sweep in the whole building.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [
        device("ap1", [AP, FLOOR_1]),
        device("ap-floor-2", [AP, "label-floor-2"]),
        device("printer-floor-1", [FLOOR_1]),
        device("sw1", [UPLINK, FLOOR_1]),
      ],
    );

    expect(outcome.links).toHaveLength(1);
    expect(outcome.links[0]!.fromDeviceId).toBe("ap1");
  });

  it("draws nothing and says why when two devices could be the parent", () => {
    /*
     * Not a tie to break. Two candidate uplinks is a question the labels do
     * not answer, and picking one would assert a cable nobody stated.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [
        device("ap1", [AP, FLOOR_1]),
        device("sw1", [UPLINK, FLOOR_1]),
        device("sw2", [UPLINK, FLOOR_1]),
      ],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("ambiguousParent");
    expect(outcome.matchedParentCount).toBe(2);
    expect(NetworkDeviceLinkRuleUtil.describeOutcome(outcome)).toContain(
      "2 devices",
    );
  });

  it("draws nothing and says why when no device is the parent", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [device("ap1", [AP, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("noParentMatched");
  });

  it("reports an empty child set rather than resolving it", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule({ childLabelIds: [] }),
      [device("ap1", [AP]), device("sw1", [UPLINK, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("noChildLabels");
  });

  it("reports an empty parent set rather than matching every device", () => {
    /*
     * An empty label set matches everything, so resolving it would make the
     * parent ambiguous across the whole project — or worse, link the whole
     * project to one box. Refused at the door instead.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule({ parentLabelIds: [] }),
      [device("ap1", [AP, FLOOR_1]), device("sw1", [UPLINK, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("noParentLabels");
  });

  it("never links the parent to itself", () => {
    // A switch carrying both label sets is still one box.
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [device("sw1", [UPLINK, FLOOR_1, AP]), device("ap1", [AP, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(1);
    expect(outcome.links[0]!.fromDeviceId).toBe("ap1");
    expect(outcome.links[0]!.toDeviceId).toBe("sw1");
  });

  it("a disabled rule draws nothing", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule({ isEnabled: false }),
      [device("ap1", [AP, FLOOR_1]), device("sw1", [UPLINK, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("disabled");
  });

  it("a parent with no children yet is reported, not silently empty", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      rule(),
      [device("sw1", [UPLINK, FLOOR_1])],
    );

    expect(outcome.links).toHaveLength(0);
    expect(outcome.skipReason).toBe("noChildrenMatched");
    expect(outcome.matchedParentCount).toBe(1);
  });

  it("resolves each rule independently", () => {
    const outcomes: Array<LinkRuleOutcome> =
      NetworkDeviceLinkRuleUtil.resolveRules(
        [
          rule(),
          rule({
            id: "r2",
            name: "Floor 2 APs",
            childLabelIds: [AP, "label-floor-2"],
            parentLabelIds: [UPLINK, "label-floor-2"],
          }),
        ],
        [
          device("ap1", [AP, FLOOR_1]),
          device("sw1", [UPLINK, FLOOR_1]),
          device("ap2", [AP, "label-floor-2"]),
          device("sw2", [UPLINK, "label-floor-2"]),
        ],
      );

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.links).toEqual([
      { fromDeviceId: "ap1", toDeviceId: "sw1" },
    ]);
    expect(outcomes[1]!.links).toEqual([
      { fromDeviceId: "ap2", toDeviceId: "sw2" },
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Site scope — GitHub issue #3260.
 *
 * The suite above is the project-scope contract and has to keep passing
 * exactly as written: site scope is opt-in, so every rule saved before the
 * column existed still means "one parent for the whole project".
 *
 * The fixtures below speak the reporter's vocabulary — routers and switches
 * in numbered units — because the bug is only legible at that shape: fourteen
 * units, fourteen routers all carrying the same label, and a global map that
 * answered "which one is THE router?" with silence in all fourteen.
 * ---------------------------------------------------------------------------
 */

const SWITCH_LABEL: string = "label-subcategory-switch";
const ROUTER_LABEL: string = "label-subcategory-router";
const MANAGED_LABEL: string = "label-managed";

/*
 * The `device` helper from the suite above, extended rather than replaced: id
 * and labels first, the two site fields optional, so an unsited device is
 * still written `deviceAt("sw1", [...])` and reads the way it always did.
 */
const deviceAt: (
  id: string,
  labelIds: Array<string>,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
) => LinkRuleDeviceInput = (
  id: string,
  labelIds: Array<string>,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
): LinkRuleDeviceInput => {
  return { id, labelIds, siteId, siteName };
};

const routerAt: (
  id: string,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
) => LinkRuleDeviceInput = (
  id: string,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
): LinkRuleDeviceInput => {
  return deviceAt(id, [ROUTER_LABEL, MANAGED_LABEL], siteId, siteName);
};

const switchAt: (
  id: string,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
) => LinkRuleDeviceInput = (
  id: string,
  siteId?: string | null | undefined,
  siteName?: string | undefined,
): LinkRuleDeviceInput => {
  return deviceAt(id, [SWITCH_LABEL, MANAGED_LABEL], siteId, siteName);
};

// Site-scoped by default; `scopedRule({ scope: "Project" })` for the other one.
const scopedRule: (overrides?: Partial<LinkRuleInput>) => LinkRuleInput = (
  overrides?: Partial<LinkRuleInput>,
): LinkRuleInput => {
  return {
    id: "rule-uplink",
    name: "Switch uplinks",
    isEnabled: true,
    childLabelIds: [SWITCH_LABEL, MANAGED_LABEL],
    parentLabelIds: [ROUTER_LABEL, MANAGED_LABEL],
    scope: "Site",
    ...overrides,
  };
};

/*
 * Site names sort into the warning text, so they are zero padded: "Unit 9"
 * would sort after "Unit 14" and make an assertion about which three sites got
 * named depend on how many units the test happened to build.
 */
const twoDigit: (value: number) => string = (value: number): string => {
  return value < 10 ? `0${value}` : `${value}`;
};

/** One unit's devices, in the order a device query would hand them over. */
const unit: (
  index: number,
  routerCount: number,
  switchCount: number,
) => Array<LinkRuleDeviceInput> = (
  index: number,
  routerCount: number,
  switchCount: number,
): Array<LinkRuleDeviceInput> => {
  const siteId: string = `site-${twoDigit(index)}`;
  const siteName: string = `Unit ${twoDigit(index)}`;
  const devices: Array<LinkRuleDeviceInput> = [];
  for (let router: number = 1; router <= routerCount; router++) {
    devices.push(
      routerAt(`router-${twoDigit(index)}-${router}`, siteId, siteName),
    );
  }
  for (let leaf: number = 1; leaf <= switchCount; leaf++) {
    devices.push(
      switchAt(`switch-${twoDigit(index)}-${leaf}`, siteId, siteName),
    );
  }
  return devices;
};

/** `unit()` over a run of consecutive units, flattened. */
const units: (
  from: number,
  to: number,
  routerCount: number,
  switchCount: number,
) => Array<LinkRuleDeviceInput> = (
  from: number,
  to: number,
  routerCount: number,
  switchCount: number,
): Array<LinkRuleDeviceInput> => {
  const devices: Array<LinkRuleDeviceInput> = [];
  for (let index: number = from; index <= to; index++) {
    devices.push(...unit(index, routerCount, switchCount));
  }
  return devices;
};

/*
 * Device id -> normalised site key, so a test can ask which site a link's two
 * ends live in without hard-coding the id-to-site mapping a second time.
 */
const siteIndexOf: (
  devices: Array<LinkRuleDeviceInput>,
) => Map<string, string> = (
  devices: Array<LinkRuleDeviceInput>,
): Map<string, string> => {
  const index: Map<string, string> = new Map<string, string>();
  for (const entry of devices) {
    index.set(entry.id, (entry.siteId || "").toString().trim());
  }
  return index;
};

/*
 * The util's warning and group-failure types, reached through its own
 * signatures. A second `import` from the same module would trip
 * `no-duplicate-imports`, and this file is only ever meant to grow downwards.
 */
type ResolvedWarning = NonNullable<
  ReturnType<typeof NetworkDeviceLinkRuleUtil.getWarning>
>;

type ResolvedGroupFailure = NonNullable<
  LinkRuleOutcome["groupFailures"]
>[number];

const warningOf: (outcome: LinkRuleOutcome) => ResolvedWarning = (
  outcome: LinkRuleOutcome,
): ResolvedWarning => {
  const warning: ResolvedWarning | null =
    NetworkDeviceLinkRuleUtil.getWarning(outcome);
  expect(warning).not.toBeNull();
  return warning!;
};

const failuresOf: (outcome: LinkRuleOutcome) => Array<ResolvedGroupFailure> = (
  outcome: LinkRuleOutcome,
): Array<ResolvedGroupFailure> => {
  return outcome.groupFailures || [];
};

interface ScopeScenario {
  label: string;
  rule: LinkRuleInput;
  devices: Array<LinkRuleDeviceInput>;
}

/*
 * One table, swept by the invariant tests below. The point of sweeping rather
 * than asserting case by case is that the two invariants — matchedChildCount
 * tracks links, and "empty" and "skipped" are the same fact — are what every
 * caller reads the outcome through, so they must hold on the paths nobody
 * thought about as much as on the ones they did.
 */
const SCOPE_SCENARIOS: Array<ScopeScenario> = [
  {
    label: "project scope, one router and two switches",
    rule: scopedRule({ scope: "Project" }),
    devices: unit(1, 1, 2),
  },
  {
    label: "project scope, a router in each of two units",
    rule: scopedRule({ scope: "Project" }),
    devices: units(1, 2, 1, 2),
  },
  {
    label: "project scope, no router anywhere",
    rule: scopedRule({ scope: "Project" }),
    devices: unit(1, 0, 2),
  },
  {
    label: "project scope, a router and nothing to place",
    rule: scopedRule({ scope: "Project" }),
    devices: unit(1, 1, 0),
  },
  {
    label: "project scope, disabled",
    rule: scopedRule({ scope: "Project", isEnabled: false }),
    devices: unit(1, 1, 2),
  },
  {
    label: "project scope, no child labels",
    rule: scopedRule({ scope: "Project", childLabelIds: [] }),
    devices: unit(1, 1, 2),
  },
  {
    label: "project scope, no parent labels",
    rule: scopedRule({ scope: "Project", parentLabelIds: [] }),
    devices: unit(1, 1, 2),
  },
  {
    label: "site scope, fourteen healthy units",
    rule: scopedRule(),
    devices: units(1, 14, 1, 3),
  },
  {
    label: "site scope, thirteen healthy units and one with two routers",
    rule: scopedRule(),
    devices: [...units(1, 13, 1, 3), ...unit(14, 2, 3)],
  },
  {
    label: "site scope, every unit parentless",
    rule: scopedRule(),
    devices: units(1, 3, 0, 2),
  },
  {
    label: "site scope, nothing is assigned to a site",
    rule: scopedRule(),
    devices: [
      switchAt("floater-1"),
      switchAt("floater-2"),
      routerAt("floater-3"),
    ],
  },
  {
    label: "site scope, no devices at all",
    rule: scopedRule(),
    devices: [],
  },
  {
    label: "site scope, the only child match is the router itself",
    rule: scopedRule(),
    devices: [
      deviceAt(
        "core-01",
        [ROUTER_LABEL, SWITCH_LABEL, MANAGED_LABEL],
        "site-01",
        "Unit 01",
      ),
    ],
  },
  {
    label: "site scope, nothing carries the child labels",
    rule: scopedRule(),
    devices: units(1, 3, 1, 0),
  },
  {
    label: "site scope, disabled",
    rule: scopedRule({ isEnabled: false }),
    devices: units(1, 3, 1, 2),
  },
];

describe("NetworkDeviceLinkRuleUtil.resolveRule — site scope", () => {
  it("leaves the project-scope outcome byte for byte what it always was", () => {
    /*
     * The migration adds a nullable column, so every rule in every existing
     * project arrives here with scope undefined. If that path grew even one
     * new key, a rule nobody touched would start reporting site coverage for
     * a project that has never been divided into sites — which is why the
     * absence of the keys is asserted with `in`, not with `toBeUndefined`.
     */
    const devices: Array<LinkRuleDeviceInput> = unit(1, 1, 2);

    const implicit: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule({ scope: undefined }),
      devices,
    );
    const explicit: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule({ scope: "Project" }),
      devices,
    );
    // An unrecognised column value is a project-scoped rule too, never a guess.
    const garbage: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule({ scope: "Region" }),
      devices,
    );

    expect(implicit).toEqual(explicit);
    expect(garbage).toEqual(explicit);

    expect(Object.keys(implicit).sort()).toEqual([
      "links",
      "matchedChildCount",
      "matchedParentCount",
      "ruleId",
      "ruleName",
    ]);
    expect("groupFailures" in implicit).toBe(false);
    expect("applicableSiteCount" in implicit).toBe(false);
    expect("unsitedChildDeviceCount" in implicit).toBe(false);

    // The skipping path carries exactly one more key, and still no site keys.
    const skipped: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule({ scope: "Project" }),
      unit(1, 0, 2),
    );

    expect(Object.keys(skipped).sort()).toEqual([
      "links",
      "matchedChildCount",
      "matchedParentCount",
      "ruleId",
      "ruleName",
      "skipReason",
    ]);
    expect("groupFailures" in skipped).toBe(false);
    expect("applicableSiteCount" in skipped).toBe(false);
    expect("unsitedChildDeviceCount" in skipped).toBe(false);
  });

  it("asks the parent question once per site, so two units draw four uplinks", () => {
    /*
     * Under project scope this exact device set is `ambiguousParent` — two
     * routers carry the parent labels — and draws nothing. Partitioning by
     * site turns the same labels into the star each unit was meant to have.
     */
    const devices: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 2),
      ...unit(2, 1, 2),
    ];

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    expect(outcome.links).toHaveLength(4);
    expect(outcome.skipReason).toBeUndefined();
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(2);

    // No uplink may cross a site boundary: that would be a cable nobody has.
    const siteOf: Map<string, string> = siteIndexOf(devices);
    for (const link of outcome.links) {
      expect(siteOf.get(link.fromDeviceId)).toBe(siteOf.get(link.toDeviceId));
    }
  });

  it("draws all fourteen units instead of reporting fourteen candidate routers", () => {
    /*
     * The reporter's exact scenario from issue #3260: fourteen units, each
     * with one router carrying `SubCategory:Router` and three switches. On
     * the global map the old resolver saw fourteen parent candidates, called
     * the rule ambiguous, and drew NOTHING — not even the thirteen units that
     * were never ambiguous in the first place.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 14, 1, 3),
    );

    expect(outcome.links).toHaveLength(42);
    expect(outcome.skipReason).toBeUndefined();
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(14);
    expect(outcome.matchedParentCount).toBe(14);
    // A rule doing its job owes the operator no explanation.
    expect(NetworkDeviceLinkRuleUtil.getWarning(outcome)).toBeNull();
  });

  it("puts a null site and a missing site in the same excluded bucket", () => {
    /*
     * `null` and `undefined` are the same fact — "nobody has assigned this
     * device to a site" — and the resolver keys its groups on a string, so if
     * they normalised differently they would become two sites, each with one
     * router, each drawing uplinks between devices whose only relationship is
     * that neither has been filed yet.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        routerAt("router-null", null),
        switchAt("switch-null", null),
        routerAt("router-undefined"),
        switchAt("switch-undefined"),
        switchAt("switch-empty", ""),
        switchAt("switch-blank", "   "),
      ],
    );

    expect(outcome.links).toEqual([]);
    expect(outcome.applicableSiteCount).toBe(0);
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.unsitedChildDeviceCount).toBe(4);
  });

  it("trims and stringifies the site key, so '  s1  ' and 's1' are one site", () => {
    /*
     * The caller stringifies an ObjectID into this field, and a stray space in
     * an imported site id would otherwise split one building into two — each
     * half then reporting that it has no router.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        routerAt("router-1", "  s1  ", "Unit 01"),
        switchAt("switch-1", "s1", "Unit 01"),
        switchAt("switch-2", "s1 ", "Unit 01"),
      ],
    );

    expect(outcome.links).toEqual([
      { fromDeviceId: "switch-1", toDeviceId: "router-1" },
      { fromDeviceId: "switch-2", toDeviceId: "router-1" },
    ]);
    expect(outcome.applicableSiteCount).toBe(1);
    expect(outcome.groupFailures).toBeUndefined();
  });

  it("counts unsited children rather than linking them to each other", () => {
    /*
     * Two switches and a router with no site is not a site with three devices
     * in it. Linking them would assert a cabling fact from the absence of
     * data, so they are walked past — and counted, because "the rule skipped
     * four of your devices" is the whole reason the operator can act on it.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [switchAt("switch-1"), switchAt("switch-2"), routerAt("router-1")],
    );

    expect(outcome.links).toEqual([]);
    expect(outcome.unsitedChildDeviceCount).toBe(2);
    expect(outcome.applicableSiteCount).toBe(0);
    expect(warningOf(outcome).message).toContain("not assigned to a site");
  });

  it("does not count an unsited device that only carries the parent labels", () => {
    /*
     * The count is a damage assessment — "these are the nodes floating on your
     * map" — and an unsited router is not a node the rule wanted to place. It
     * would inflate the number the operator is being asked to act on.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [routerAt("router-unsited"), ...unit(1, 1, 1)],
    );

    expect(outcome.unsitedChildDeviceCount).toBeUndefined();
    expect(outcome.links).toEqual([
      { fromDeviceId: "switch-01-1", toDeviceId: "router-01-1" },
    ]);
  });

  it("says nothing about a site holding neither a parent nor a child", () => {
    /*
     * The rule simply does not apply in that building. Reporting it would
     * trade one loud failure for one quiet one per site in the project, and a
     * banner that lists two hundred irrelevant sites is a banner nobody reads.
     */
    const devices: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 2),
      deviceAt("camera-1", ["label-camera"], "site-02", "Unit 02"),
      deviceAt("camera-2", ["label-camera"], "site-02", "Unit 02"),
    ];

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    expect(outcome.links).toHaveLength(2);
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(1);
  });

  it("says nothing about a site with a router and nothing to place", () => {
    /*
     * A parent label like `SubCategory:Router` is present in nearly every
     * site by construction, so a site that has one and no switches is the
     * normal case, not a misconfiguration.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 1, 2), ...unit(2, 1, 0), ...unit(3, 3, 0)],
    );

    expect(outcome.links).toHaveLength(2);
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(1);
  });

  it("says nothing about a site whose only child match is its own router", () => {
    /*
     * A collapsed core carrying both label sets is one box: after the
     * self-link exclusion the site has nothing left to place, which is the
     * same silence as having no switches at all rather than a failure to
     * report. The pre-exclusion child count is 1 here, so this pins that the
     * gate looks at what is left AFTER the parent is removed.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        ...unit(1, 1, 2),
        deviceAt(
          "core-02",
          [ROUTER_LABEL, SWITCH_LABEL, MANAGED_LABEL],
          "site-02",
          "Unit 02",
        ),
      ],
    );

    expect(outcome.links).toHaveLength(2);
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(1);
  });

  it("reports a site with switches and no router once, with its own damage count", () => {
    const devices: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 2),
      ...unit(2, 0, 3),
    ];

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    expect(outcome.links).toHaveLength(2);
    expect(failuresOf(outcome)).toEqual([
      {
        siteId: "site-02",
        siteName: "Unit 02",
        reason: "noParentMatched",
        matchedParentCount: 0,
        // The three switches stranded in Unit 02, not the five in the project.
        matchedChildCount: 3,
      },
    ]);
    expect(outcome.applicableSiteCount).toBe(2);
  });

  it("reports an ambiguous site's own parent count, never the project-wide one", () => {
    /*
     * The old failure mode in one number. Project-wide there are four routers
     * here; the operator's actual problem is the two sitting in Unit 03, and
     * telling them "4 devices carry the parent labels" would send them looking
     * at the three units that are fine.
     */
    const devices: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 2),
      ...unit(2, 1, 2),
      ...unit(3, 2, 2),
    ];

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    expect(outcome.links).toHaveLength(4);
    expect(failuresOf(outcome)).toHaveLength(1);
    expect(failuresOf(outcome)[0]!.reason).toBe("ambiguousParent");
    expect(failuresOf(outcome)[0]!.matchedParentCount).toBe(2);
    expect(failuresOf(outcome)[0]!.siteId).toBe("site-03");
    expect(failuresOf(outcome)[0]!.matchedChildCount).toBe(2);
  });

  it("keeps matchedChildCount equal to links.length in every scope and outcome", () => {
    /*
     * The rule list renders "Draws N uplinks" from matchedChildCount while the
     * map renders links, so the moment those two disagree the product tells
     * the operator two different stories about the same rule.
     */
    for (const scenario of SCOPE_SCENARIOS) {
      const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
        scenario.rule,
        scenario.devices,
      );

      expect({
        label: scenario.label,
        matchedChildCount: outcome.matchedChildCount,
      }).toEqual({
        label: scenario.label,
        matchedChildCount: outcome.links.length,
      });
    }
  });

  it("treats an empty links array and a skipReason as the same fact, both scopes", () => {
    /*
     * describeOutcome switches on skipReason and falls through to "Draws N
     * uplinks", so a gap in either direction produces a rule that either
     * claims to draw nothing while drawing, or claims to draw nothing while
     * offering no reason at all.
     */
    for (const scenario of SCOPE_SCENARIOS) {
      const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
        scenario.rule,
        scenario.devices,
      );

      expect({
        label: scenario.label,
        empty: outcome.links.length === 0,
      }).toEqual({
        label: scenario.label,
        empty: outcome.skipReason !== undefined,
      });
    }
  });

  it("never claims to draw anything for an outcome that drew nothing", () => {
    for (const scenario of SCOPE_SCENARIOS) {
      const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
        scenario.rule,
        scenario.devices,
      );
      const sentence: string =
        NetworkDeviceLinkRuleUtil.describeOutcome(outcome);

      expect({
        label: scenario.label,
        draws: sentence.startsWith("Draws"),
      }).toEqual({
        label: scenario.label,
        draws: outcome.links.length > 0,
      });
    }
  });

  it("reports an empty device list as nothing to place, not as a resolved rule", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [],
    );

    expect(outcome.links).toEqual([]);
    expect(outcome.skipReason).toBe("noChildrenMatched");
    expect(outcome.groupFailures).toBeUndefined();
    expect(outcome.unsitedChildDeviceCount).toBeUndefined();
    expect(outcome.applicableSiteCount).toBe(0);
  });

  it("never links a device to itself, and a dual-labelled core is its site's parent", () => {
    /*
     * A collapsed core carrying both label sets is still one box. In Unit 01
     * it is the only parent candidate, so it becomes the parent and is
     * excluded from its own children; Unit 02 resolves its own star in
     * parallel and the two never touch.
     */
    const dualIsTheOnlyParent: LinkRuleOutcome =
      NetworkDeviceLinkRuleUtil.resolveRule(scopedRule(), [
        deviceAt(
          "core-01",
          [ROUTER_LABEL, SWITCH_LABEL, MANAGED_LABEL],
          "site-01",
          "Unit 01",
        ),
        switchAt("switch-01-1", "site-01", "Unit 01"),
        routerAt("router-02-1", "site-02", "Unit 02"),
        switchAt("switch-02-1", "site-02", "Unit 02"),
      ]);

    expect(dualIsTheOnlyParent.links).toEqual([
      { fromDeviceId: "switch-01-1", toDeviceId: "core-01" },
      { fromDeviceId: "switch-02-1", toDeviceId: "router-02-1" },
    ]);
    for (const link of dualIsTheOnlyParent.links) {
      expect(link.fromDeviceId).not.toBe(link.toDeviceId);
    }

    /*
     * And the other half of the same rule: a device carrying the parent labels
     * is always a parent CANDIDATE, so it is never quietly demoted to child
     * just because its site already has a router. Unit 02 below has two boxes
     * answering to `SubCategory:Router` and the honest answer is that nobody
     * said which one is the uplink — so Unit 02 draws nothing and says why,
     * while Unit 01 is untouched by its neighbour's problem.
     */
    const dualCompetesWithARouter: LinkRuleOutcome =
      NetworkDeviceLinkRuleUtil.resolveRule(scopedRule(), [
        deviceAt(
          "core-01",
          [ROUTER_LABEL, SWITCH_LABEL, MANAGED_LABEL],
          "site-01",
          "Unit 01",
        ),
        switchAt("switch-01-1", "site-01", "Unit 01"),
        deviceAt(
          "core-02",
          [ROUTER_LABEL, SWITCH_LABEL, MANAGED_LABEL],
          "site-02",
          "Unit 02",
        ),
        routerAt("router-02-1", "site-02", "Unit 02"),
        switchAt("switch-02-1", "site-02", "Unit 02"),
      ]);

    expect(dualCompetesWithARouter.links).toEqual([
      { fromDeviceId: "switch-01-1", toDeviceId: "core-01" },
    ]);
    expect(failuresOf(dualCompetesWithARouter)).toEqual([
      {
        siteId: "site-02",
        siteName: "Unit 02",
        reason: "ambiguousParent",
        matchedParentCount: 2,
        matchedChildCount: 2,
      },
    ]);
  });

  it("never draws the same pair twice under site scope", () => {
    /*
     * Sites are disjoint buckets and the builder merges by pair, so a repeated
     * pair would silently become one edge on the map while inflating every
     * count the rule list shows.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 4, 1, 3),
    );

    const pairs: Set<string> = new Set<string>(
      outcome.links.map(
        (link: { fromDeviceId: string; toDeviceId: string }) => {
          return `${link.fromDeviceId}->${link.toDeviceId}`;
        },
      ),
    );

    expect(outcome.links).toHaveLength(12);
    expect(pairs.size).toBe(outcome.links.length);
  });

  it("is exactly project scope when every device is in one site", () => {
    /*
     * One site is one universe, so the partition is the identity and the two
     * scopes cannot disagree. This is what makes the column safe to flip on a
     * single-site project: the map does not move.
     */
    const devices: Array<LinkRuleDeviceInput> = unit(1, 1, 3);

    const siteScoped: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );
    const projectScoped: LinkRuleOutcome =
      NetworkDeviceLinkRuleUtil.resolveRule(
        scopedRule({ scope: "Project" }),
        devices,
      );

    expect(siteScoped.links).toEqual(projectScoped.links);
    expect(siteScoped.matchedChildCount).toBe(projectScoped.matchedChildCount);
    expect(siteScoped.matchedParentCount).toBe(
      projectScoped.matchedParentCount,
    );
    expect(siteScoped.skipReason).toBe(projectScoped.skipReason);
  });

  it("reports noSiteResolved rather than borrowing one site's reason", () => {
    /*
     * Unit 01 has no router and Unit 02 has two. Reporting either reason for
     * the rule as a whole would be a false statement about the other site, and
     * the mixture is exactly why this reason exists.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 0, 2), ...unit(2, 2, 1)],
    );

    expect(outcome.links).toEqual([]);
    expect(outcome.skipReason).toBe("noSiteResolved");
    expect(NetworkDeviceLinkRuleUtil.describeOutcome(outcome)).toBe(
      "No site resolved this rule.",
    );
    expect(failuresOf(outcome)).toHaveLength(2);
    expect(outcome.applicableSiteCount).toBe(2);
  });

  it("counts every site that drew in the coverage fraction's numerator", () => {
    /*
     * "Drawing in X of Y sites" is subtraction, so it is only true if the
     * sites that failed and the sites that drew partition the applicable set
     * with nothing double-counted and nothing missing. Checked against the
     * links themselves rather than against the counters.
     */
    const devices: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 2),
      ...unit(2, 1, 1),
      ...unit(3, 0, 2),
      ...unit(4, 2, 1),
      ...unit(5, 1, 0),
      deviceAt("camera-1", ["label-camera"], "site-06", "Unit 06"),
    ];

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    const siteOf: Map<string, string> = siteIndexOf(devices);
    const sitesThatDrew: Set<string> = new Set<string>();
    for (const link of outcome.links) {
      sitesThatDrew.add(siteOf.get(link.fromDeviceId)!);
      sitesThatDrew.add(siteOf.get(link.toDeviceId)!);
    }

    expect(outcome.applicableSiteCount).toBe(4);
    expect(failuresOf(outcome)).toHaveLength(2);
    expect(sitesThatDrew.size).toBe(
      (outcome.applicableSiteCount || 0) - failuresOf(outcome).length,
    );
  });

  it("does not touch the device array it was handed", () => {
    /*
     * resolveRules hands the SAME array instance to every rule in turn, so a
     * resolver that sorted or bucketed in place would make rule two see a
     * different project from rule one — and the bug would only show up in
     * projects with more than one rule.
     */
    const devices: Array<LinkRuleDeviceInput> = [
      ...units(1, 3, 1, 2),
      switchAt("floater-1"),
    ];
    const before: string = JSON.stringify(devices);

    const alone: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );

    const outcomes: Array<LinkRuleOutcome> =
      NetworkDeviceLinkRuleUtil.resolveRules(
        [
          scopedRule({ id: "rule-first", scope: "Project" }),
          scopedRule({ id: "rule-second", childLabelIds: ["label-camera"] }),
          scopedRule(),
        ],
        devices,
      );

    expect(JSON.stringify(devices)).toBe(before);
    // Third in a queue, and still the outcome it produces on its own.
    expect(outcomes[2]).toEqual(alone);
  });

  it("does not reach across the site tree from an ancestor site", () => {
    /*
     * DELIBERATE, not a gap: sites are matched exactly, so a router filed
     * under the campus does not parent the switches filed under each building
     * inside it. Resolving up the tree would mean the map silently depends on
     * a hierarchy the operator can restructure at any time, and every building
     * would suddenly share one uplink. The rule refuses and names the
     * buildings instead, which is a fix the operator can actually make.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        routerAt("campus-core", "site-campus", "Campus"),
        switchAt("switch-a-1", "site-bldg-a", "Building A"),
        switchAt("switch-a-2", "site-bldg-a", "Building A"),
        switchAt("switch-b-1", "site-bldg-b", "Building B"),
      ],
    );

    expect(outcome.links).toEqual([]);
    expect(outcome.skipReason).toBe("noSiteResolved");
    expect(failuresOf(outcome)).toEqual([
      {
        siteId: "site-bldg-a",
        siteName: "Building A",
        reason: "noParentMatched",
        matchedParentCount: 0,
        matchedChildCount: 2,
      },
      {
        siteId: "site-bldg-b",
        siteName: "Building B",
        reason: "noParentMatched",
        matchedParentCount: 0,
        matchedChildCount: 1,
      },
    ]);
    // The campus itself had nothing to place, so it is not counted against.
    expect(outcome.applicableSiteCount).toBe(2);
  });
});

describe("NetworkDeviceLinkRuleUtil.getWarning", () => {
  it("stays silent for a rule that is doing its job, in either scope", () => {
    const projectScoped: LinkRuleOutcome =
      NetworkDeviceLinkRuleUtil.resolveRule(
        scopedRule({ scope: "Project" }),
        unit(1, 1, 3),
      );
    const siteScoped: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 6, 1, 2),
    );

    expect(NetworkDeviceLinkRuleUtil.getWarning(projectScoped)).toBeNull();
    expect(NetworkDeviceLinkRuleUtil.getWarning(siteScoped)).toBeNull();
  });

  it("echoes describeOutcome verbatim for every project-scoped skip", () => {
    /*
     * The project path is what the topology API used to compute inline, and
     * the banner and the rule list render the same rule side by side. Asserted
     * against describeOutcome's OWN return value rather than against copies of
     * its sentences, so the two can never be edited apart.
     */
    const skips: Array<ScopeScenario> = [
      {
        label: "disabled",
        rule: scopedRule({ scope: "Project", isEnabled: false }),
        devices: unit(1, 1, 2),
      },
      {
        label: "noChildLabels",
        rule: scopedRule({ scope: "Project", childLabelIds: [] }),
        devices: unit(1, 1, 2),
      },
      {
        label: "noParentLabels",
        rule: scopedRule({ scope: "Project", parentLabelIds: [] }),
        devices: unit(1, 1, 2),
      },
      {
        label: "noParentMatched",
        rule: scopedRule({ scope: "Project" }),
        devices: unit(1, 0, 2),
      },
      {
        label: "ambiguousParent",
        rule: scopedRule({ scope: "Project" }),
        devices: units(1, 2, 1, 2),
      },
      {
        label: "noChildrenMatched",
        rule: scopedRule({ scope: "Project" }),
        devices: unit(1, 1, 0),
      },
    ];

    for (const scenario of skips) {
      const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
        scenario.rule,
        scenario.devices,
      );
      const warning: ResolvedWarning = warningOf(outcome);

      expect({ label: scenario.label, reason: warning.reason }).toEqual({
        label: scenario.label,
        reason: outcome.skipReason,
      });
      expect({ label: scenario.label, message: warning.message }).toEqual({
        label: scenario.label,
        message: NetworkDeviceLinkRuleUtil.describeOutcome(outcome),
      });
      expect(warning.ruleId).toBe("rule-uplink");
      expect(warning.ruleName).toBe("Switch uplinks");
    }
  });

  it("warns about the fourteenth unit while the other thirteen keep drawing", () => {
    /*
     * The regression this whole change is for. The warning predicate used to
     * be `links.length === 0`, which this outcome passes — 39 links — while
     * the operator's fourteenth building is genuinely broken. Silence here
     * means a site that has been quietly missing its uplinks since somebody
     * racked a second router in it.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...units(1, 13, 1, 3), ...unit(14, 2, 3)],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(outcome.links.length).toBeGreaterThan(0);
    expect(outcome.links).toHaveLength(39);
    expect(warning.reason).toBe("ambiguousParent");
    expect(warning.message).toContain("Drawing in 13 of 14 sites.");
    expect(warning.message).toContain("Unit 14");
    expect(warning.message).toContain("2 devices carry the parent labels");
  });

  it("folds mixed failures into one bullet, ambiguity before missing parents", () => {
    /*
     * One bullet per rule, never one per site: the banner's length has to be
     * bounded by the number of rules the operator wrote, not by the number of
     * sites they own. Ambiguity leads because it is the more specific
     * complaint — "you have two of these" is a five-second fix, "you have
     * none" may be a truck roll.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 2, 2), ...unit(2, 0, 1), ...unit(3, 0, 2), ...unit(4, 1, 1)],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(failuresOf(outcome)).toHaveLength(3);
    expect(warning.reason).toBe("ambiguousParent");

    const ambiguity: number = warning.message.indexOf(
      "2 devices carry the parent labels in Unit 01.",
    );
    const missing: number = warning.message.indexOf(
      "No device carries the parent labels in Unit 02 and Unit 03,",
    );

    expect(ambiguity).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(-1);
    expect(ambiguity).toBeLessThan(missing);
    expect(warning.message).toContain("3 devices there have no uplink.");
  });

  it("uses the project's own sentence when nothing carries the child labels", () => {
    /*
     * No site failed and nothing was stranded, so there is nothing site-shaped
     * to say — and inventing a site-scoped phrasing here would give the
     * operator two different sentences for the same situation depending on a
     * column they may not know they set.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 3, 1, 0),
    );

    expect(outcome.skipReason).toBe("noChildrenMatched");
    expect(warningOf(outcome).message).toBe(
      "No device carries the child labels yet.",
    );
  });

  it("opens with the headline that matches whether anything drew at all", () => {
    const nothingDrew: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 2, 0, 1),
    );
    const somethingDrew: LinkRuleOutcome =
      NetworkDeviceLinkRuleUtil.resolveRule(scopedRule(), [
        ...unit(1, 1, 2),
        ...unit(2, 0, 1),
      ]);

    expect(
      warningOf(nothingDrew).message.startsWith("No site resolved this rule."),
    ).toBe(true);
    expect(warningOf(somethingDrew).message.startsWith("Drawing in")).toBe(
      true,
    );
    expect(warningOf(somethingDrew).message).toContain(
      "Drawing in 1 of 2 sites.",
    );
  });

  it("omits the coverage fraction when only one site applies", () => {
    /*
     * "Drawing in 1 of 1 sites" is a sentence that costs the reader time and
     * tells them nothing. The unsited clause still has to be emitted, so this
     * pins that the two are independent rather than one gating the other.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 1, 2), switchAt("floater-1"), switchAt("floater-2")],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(outcome.applicableSiteCount).toBe(1);
    expect(outcome.links).toHaveLength(2);
    expect(warning.reason).toBe("devicesWithoutSite");
    expect(warning.message).toBe(
      "2 devices carrying the child labels are not assigned to a site, so this site-scoped rule skips them.",
    );
    expect(warning.message).not.toContain("Drawing in");
    expect(warning.message).not.toContain("of 1 sites");
  });

  it("names three sites and counts the rest exactly", () => {
    /*
     * Three names is enough to recognise a pattern; fifteen is a wall of text
     * in a banner. The COUNT stays exact even though the names are elided, so
     * the operator still knows the true blast radius.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 15, 0, 1),
    );

    const warning: ResolvedWarning = warningOf(outcome);
    const allNames: Array<string> = [];
    for (let index: number = 1; index <= 15; index++) {
      allNames.push(`Unit ${twoDigit(index)}`);
    }
    const named: Array<string> = allNames.filter((name: string): boolean => {
      return warning.message.includes(name);
    });

    expect(failuresOf(outcome)).toHaveLength(15);
    expect(named).toEqual(["Unit 01", "Unit 02", "Unit 03"]);
    expect(warning.message).toContain("and 12 more sites");
    expect(warning.message).toContain("15 devices there have no uplink.");
  });

  it("says 'and 1 more site' rather than 'and 1 more sites'", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      units(1, 4, 0, 1),
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.message).toContain(
      "Unit 01, Unit 02, Unit 03 and 1 more site,",
    );
    expect(warning.message).not.toContain("more sites");
  });

  it("describes a site with no name instead of printing its id", () => {
    /*
     * The id is a database key: it means nothing to the reader and, printed in
     * a banner, it is the one part of the sentence they might paste into a
     * ticket. A site with no name is missing a name, which is a different
     * problem from the one this warning is about.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [switchAt("switch-x", "site-9f3c-never-printed")],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.message).toBe(
      "No site resolved this rule. No device carries the parent labels in an unnamed site, so 1 device there has no uplink.",
    );
    expect(warning.message).not.toContain("site-9f3c-never-printed");
  });

  it("truncates a site name past 40 characters to 39 and an ellipsis", () => {
    /*
     * Site names are ShortText and run to 100 characters. Three of them
     * unabridged would be a 300-character site list inside a one-line banner.
     */
    const longName: string = "Manufacturing Plant Seven East Annex Riser Room";

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [switchAt("switch-x", "site-long", longName)],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(longName.length).toBeGreaterThan(40);
    expect(warning.message).toContain(
      "Manufacturing Plant Seven East Annex Ri…",
    );
    expect(warning.message).not.toContain(longName);
  });

  it("produces a byte-identical message however the devices are ordered", () => {
    /*
     * The live view refetches every sixty seconds and the device query has no
     * ORDER BY, so an unsorted site list would reshuffle the banner on every
     * poll and read as a change that did not happen. Links keep following
     * first appearance in the array — that is the map's stable draw order, not
     * the banner's.
     */
    const inOrder: Array<LinkRuleDeviceInput> = [
      ...unit(5, 1, 1),
      ...unit(3, 0, 1),
      ...unit(1, 1, 1),
      ...unit(4, 2, 1),
      ...unit(2, 0, 1),
    ];
    const shuffled: Array<LinkRuleDeviceInput> = [
      ...unit(1, 1, 1),
      ...unit(2, 0, 1),
      ...unit(4, 2, 1),
      ...unit(5, 1, 1),
      ...unit(3, 0, 1),
    ];

    const first: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      inOrder,
    );
    const second: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      shuffled,
    );

    expect(warningOf(first).message).toBe(warningOf(second).message);
    expect(warningOf(first).message).toContain(
      "Unit 02 and Unit 03, so 2 devices there have no uplink.",
    );

    expect(first.links).toEqual([
      { fromDeviceId: "switch-05-1", toDeviceId: "router-05-1" },
      { fromDeviceId: "switch-01-1", toDeviceId: "router-01-1" },
    ]);
    expect(second.links).toEqual([
      { fromDeviceId: "switch-01-1", toDeviceId: "router-01-1" },
      { fromDeviceId: "switch-05-1", toDeviceId: "router-05-1" },
    ]);
  });

  it("reads 'has' for one stranded device and 'have' for several", () => {
    const one: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 1, 1), ...unit(2, 0, 1)],
    );
    const several: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...unit(1, 1, 1), ...unit(2, 0, 4)],
    );

    expect(warningOf(one).message).toContain(
      "so 1 device there has no uplink.",
    );
    expect(warningOf(several).message).toContain(
      "so 4 devices there have no uplink.",
    );
  });

  it("keeps even the worst case short enough to read", () => {
    /*
     * The banner is one line per rule. Thirty failing sites of both kinds,
     * hundred-character names and stranded unsited devices is the loudest a
     * single rule can be, and it still has to fit somewhere a human will read
     * it rather than scroll past.
     */
    const hundredCharName: (index: number) => string = (
      index: number,
    ): string => {
      const base: string = `Unit ${twoDigit(index)} Distribution Annex `;
      return (base + "0123456789".repeat(10)).slice(0, 100);
    };

    const devices: Array<LinkRuleDeviceInput> = [];
    for (let index: number = 1; index <= 15; index++) {
      const siteId: string = `ambiguous-${twoDigit(index)}`;
      const siteName: string = hundredCharName(index);
      devices.push(routerAt(`amb-router-a-${index}`, siteId, siteName));
      devices.push(routerAt(`amb-router-b-${index}`, siteId, siteName));
      devices.push(switchAt(`amb-switch-${index}`, siteId, siteName));
    }
    for (let index: number = 16; index <= 30; index++) {
      const siteId: string = `parentless-${twoDigit(index)}`;
      const siteName: string = hundredCharName(index);
      devices.push(switchAt(`orphan-switch-${index}`, siteId, siteName));
    }
    devices.push(switchAt("floater-1"));
    devices.push(switchAt("floater-2"));

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );
    const warning: ResolvedWarning = warningOf(outcome);

    expect(hundredCharName(1)).toHaveLength(100);
    expect(failuresOf(outcome)).toHaveLength(30);
    expect(outcome.unsitedChildDeviceCount).toBe(2);
    expect(warning.message.length).toBeLessThanOrEqual(700);
  });
});

/*
 * ISSUE #3321 — the audit list.
 *
 * The sentence a failing site-scoped rule produces names three sites and then
 * a number: "…in WB Franchise Unit 0005, WB Franchise Unit 0047, WB Franchise
 * Unit 0069 and 694 more sites". At fourteen sites that is a summary. At 949
 * it is a dead end — the operator has been told the size of the problem and
 * nothing about where it is. These rows are what the banner expands into.
 */
describe("NetworkDeviceLinkRuleUtil.getWarning — the failing-site list", () => {
  type ResolvedWarningSite = NonNullable<ResolvedWarning["sites"]>[number];

  /** Zero padded past three digits so 949 sites still sort as text. */
  const fourDigit: (value: number) => string = (value: number): string => {
    return `${value}`.padStart(4, "0");
  };

  /**
   * `franchise(index, routers, switches)` — one WB-style unit, named the way
   * the reporter's are so the sort order under test is the one they see.
   */
  const franchise: (
    index: number,
    routerCount: number,
    switchCount: number,
  ) => Array<LinkRuleDeviceInput> = (
    index: number,
    routerCount: number,
    switchCount: number,
  ): Array<LinkRuleDeviceInput> => {
    const siteId: string = `wb-${fourDigit(index)}`;
    const siteName: string = `WB Franchise Unit ${fourDigit(index)}`;
    const devices: Array<LinkRuleDeviceInput> = [];
    for (let router: number = 1; router <= routerCount; router++) {
      devices.push(routerAt(`wb-router-${index}-${router}`, siteId, siteName));
    }
    for (let leaf: number = 1; leaf <= switchCount; leaf++) {
      devices.push(switchAt(`wb-switch-${index}-${leaf}`, siteId, siteName));
    }
    return devices;
  };

  const sitesOf: (outcome: LinkRuleOutcome) => Array<ResolvedWarningSite> = (
    outcome: LinkRuleOutcome,
  ): Array<ResolvedWarningSite> => {
    return warningOf(outcome).sites || [];
  };

  it("lists the sites the sentence could only count", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        ...franchise(5, 1, 2),
        // No router: three switches with nowhere to go.
        ...franchise(47, 0, 3),
        ...franchise(69, 0, 1),
      ],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.siteCount).toBe(2);
    expect(warning.sites).toEqual([
      {
        siteId: "wb-0047",
        siteName: "WB Franchise Unit 0047",
        reason: "noParentMatched",
        strandedDeviceCount: 3,
        matchedParentCount: 0,
      },
      {
        siteId: "wb-0069",
        siteName: "WB Franchise Unit 0069",
        reason: "noParentMatched",
        strandedDeviceCount: 1,
        matchedParentCount: 0,
      },
    ]);
  });

  it("carries each site's own reason, not the rule's headline one", () => {
    /*
     * The rule's `reason` is the highest-ranked condition present, so a mixed
     * failure reads "ambiguousParent" — which is wrong about every one of the
     * parentless sites. Per-site reasons are the whole reason the list is
     * worth sending: the two faults need opposite fixes (delete a label vs.
     * add one), and a list that got them backwards would be worse than none.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        ...franchise(1, 1, 1),
        // Two routers in one unit.
        ...franchise(2, 2, 1),
        // None in the other.
        ...franchise(3, 0, 2),
      ],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.reason).toBe("ambiguousParent");
    expect(
      (warning.sites || []).map((site: ResolvedWarningSite) => {
        return [site.siteName, site.reason, site.matchedParentCount];
      }),
    ).toEqual([
      ["WB Franchise Unit 0002", "ambiguousParent", 2],
      ["WB Franchise Unit 0003", "noParentMatched", 0],
    ]);
  });

  it("orders the list exactly as the sentence names them", () => {
    /*
     * The first rows of the list must be the sites the sentence already
     * named, or the two read as different sets of buildings. Both go through
     * one sort for that reason.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [
        ...franchise(1, 1, 1),
        ...franchise(69, 0, 1),
        ...franchise(5, 0, 1),
        ...franchise(47, 0, 1),
        ...franchise(12, 0, 1),
      ],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.message).toContain(
      "WB Franchise Unit 0005, WB Franchise Unit 0012, WB Franchise Unit 0047 and 1 more site",
    );
    expect(
      (warning.sites || []).map((site: ResolvedWarningSite) => {
        return site.siteName;
      }),
    ).toEqual([
      "WB Franchise Unit 0005",
      "WB Franchise Unit 0012",
      "WB Franchise Unit 0047",
      "WB Franchise Unit 0069",
    ]);
  });

  it("stays byte-identical however the device query ordered its rows", () => {
    /*
     * The live view refetches every sixty seconds; a reshuffling list reads
     * as a change that did not happen.
     */
    const forwards: Array<LinkRuleDeviceInput> = [
      ...franchise(3, 0, 1),
      ...franchise(1, 0, 1),
      ...franchise(2, 0, 1),
    ];
    const backwards: Array<LinkRuleDeviceInput> = [
      ...franchise(2, 0, 1),
      ...franchise(3, 0, 1),
      ...franchise(1, 0, 1),
    ];

    expect(
      sitesOf(NetworkDeviceLinkRuleUtil.resolveRule(scopedRule(), forwards)),
    ).toEqual(
      sitesOf(NetworkDeviceLinkRuleUtil.resolveRule(scopedRule(), backwards)),
    );
  });

  it("names a site with no name nothing at all rather than guessing one", () => {
    /*
     * A device can carry a siteId whose name never came back — the name rides
     * on a relation read. The row still has to be sent: its id is what the
     * operator navigates by.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...franchise(1, 1, 1), switchAt("nameless-switch", "site-nameless")],
    );

    expect(sitesOf(outcome)).toEqual([
      {
        siteId: "site-nameless",
        siteName: undefined,
        reason: "noParentMatched",
        strandedDeviceCount: 1,
        matchedParentCount: 0,
      },
    ]);
  });

  it("caps the list but never the count", () => {
    /*
     * The cap is what keeps a 60-second poll from carrying a megabyte of site
     * names. Reporting sites.length as the number of broken sites is then a
     * bug waiting to happen, so the exact total rides alongside.
     */
    const devices: Array<LinkRuleDeviceInput> = [...franchise(1, 1, 1)];
    for (let index: number = 2; index <= 400; index++) {
      devices.push(...franchise(index, 0, 1));
    }

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );
    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.siteCount).toBe(399);
    expect(warning.sites).toHaveLength(
      NetworkDeviceLinkRuleUtil.MAX_LISTED_SITES,
    );
    // The cap keeps the sentence's own three sites, which are the first rows.
    expect((warning.sites || [])[0]!.siteName).toBe("WB Franchise Unit 0002");
  });

  it("says nothing about sites when the rule is project scoped", () => {
    /*
     * A project-scoped outcome has no site dimension at all, and inventing an
     * empty list for it would put a "0 sites need attention" control on a
     * banner that is not about sites.
     */
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule({ scope: "Project" }),
      [...franchise(1, 1, 1), ...franchise(2, 1, 1)],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.reason).toBe("ambiguousParent");
    expect(warning.sites).toBeUndefined();
    expect(warning.siteCount).toBeUndefined();
  });

  it("says nothing about sites when only unsited devices are wrong", () => {
    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      [...franchise(1, 1, 1), switchAt("spare-switch")],
    );

    const warning: ResolvedWarning = warningOf(outcome);

    expect(warning.reason).toBe("devicesWithoutSite");
    expect(warning.sites).toBeUndefined();
    expect(warning.siteCount).toBeUndefined();
  });

  it("keeps the list and the sentence telling the same story at 949 sites", () => {
    /*
     * The reporter's estate, with the truncation removed: 949 units, of which
     * 697 have no router. The two numbers an operator reads — the coverage
     * fraction and the stranded device total — have to be reproducible from
     * the rows, or the list is a second opinion rather than a breakdown.
     */
    const devices: Array<LinkRuleDeviceInput> = [];
    for (let index: number = 1; index <= 252; index++) {
      devices.push(...franchise(index, 1, 3));
    }
    for (let index: number = 253; index <= 949; index++) {
      devices.push(...franchise(index, 0, 3));
    }

    const outcome: LinkRuleOutcome = NetworkDeviceLinkRuleUtil.resolveRule(
      scopedRule(),
      devices,
    );
    const warning: ResolvedWarning = warningOf(outcome);

    expect(outcome.links).toHaveLength(252 * 3);
    expect(outcome.applicableSiteCount).toBe(949);
    expect(warning.message).toContain("Drawing in 252 of 949 sites.");
    expect(warning.message).toContain("so 2091 devices there have no uplink.");

    expect(warning.siteCount).toBe(697);
    expect(warning.sites).toHaveLength(
      NetworkDeviceLinkRuleUtil.MAX_LISTED_SITES,
    );
    for (const site of warning.sites || []) {
      expect(site.reason).toBe("noParentMatched");
      expect(site.strandedDeviceCount).toBe(3);
      expect(site.matchedParentCount).toBe(0);
    }
  });
});
