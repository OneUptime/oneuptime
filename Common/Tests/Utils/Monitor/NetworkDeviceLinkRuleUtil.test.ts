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
