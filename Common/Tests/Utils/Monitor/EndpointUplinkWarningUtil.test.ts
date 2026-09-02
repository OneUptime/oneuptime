import {
  UplinkRefusal,
  UplinkRefusalReason,
} from "../../../Utils/Monitor/EndpointUplinkInferenceUtil";
import EndpointUplinkWarningUtil, {
  MAX_NAMED_DEVICES,
  UplinkInferenceWarning,
} from "../../../Utils/Monitor/EndpointUplinkWarningUtil";

describe("EndpointUplinkWarningUtil.getWarnings", () => {
  /*
   * Mirrors MAX_DEVICE_NAME_LENGTH inside the util, which is deliberately
   * not exported. Restated here so a change to the clamp has to be a
   * deliberate one rather than something the test quietly follows.
   */
  const NAME_CLAMP: number = 40;

  /*
   * Every member of UplinkRefusalReason, as a Record so the COMPILER is
   * what enforces completeness: adding a member to the union without
   * adding it here fails to type-check, which is the point — a reason
   * that reaches the banner with no sentence written for it would render
   * the useless "could not be placed automatically" fallback.
   */
  const ALL_REASONS_PRESENT: Record<UplinkRefusalReason, true> = {
    endpointCollectionOff: true,
    noMatchableAddress: true,
    deviceHasNoSite: true,
    noEndpointMatch: true,
    arpOnlyAttachment: true,
    attachmentSourceUnknown: true,
    attachmentStale: true,
    ipBindingStale: true,
    transitPort: true,
    portHasMultipleDevices: true,
    ambiguous: true,
    selfAttachment: true,
    endpointListTruncated: true,
  };

  const ALL_REASONS: Array<UplinkRefusalReason> = Object.keys(
    ALL_REASONS_PRESENT,
  ) as Array<UplinkRefusalReason>;

  /*
   * The order the banner is expected to render bullets in, most-fixable
   * first. Restates the util's private REASON_ORDER so that reordering the
   * banner is a visible decision, and so a reason that is given a sentence
   * but never added to the order — and would therefore silently produce no
   * bullet at all — fails here.
   */
  const EXPECTED_ORDER: Array<UplinkRefusalReason> = [
    "endpointCollectionOff",
    "arpOnlyAttachment",
    "noMatchableAddress",
    "deviceHasNoSite",
    "ambiguous",
    "noEndpointMatch",
    "portHasMultipleDevices",
    "transitPort",
    "attachmentStale",
    "ipBindingStale",
    "attachmentSourceUnknown",
    "endpointListTruncated",
    "selfAttachment",
  ];

  const makeRefusal: (
    deviceId: string,
    reason: UplinkRefusalReason,
    overrides?: Partial<UplinkRefusal>,
  ) => UplinkRefusal = (
    deviceId: string,
    reason: UplinkRefusalReason,
    overrides?: Partial<UplinkRefusal>,
  ): UplinkRefusal => {
    return {
      deviceId,
      reason,
      ...overrides,
    };
  };

  const namesOf: (entries: Array<[string, string]>) => Map<string, string> = (
    entries: Array<[string, string]>,
  ): Map<string, string> => {
    return new Map<string, string>(entries);
  };

  const reasonsOf: (
    warnings: Array<UplinkInferenceWarning>,
  ) => Array<UplinkRefusalReason> = (
    warnings: Array<UplinkInferenceWarning>,
  ): Array<UplinkRefusalReason> => {
    return warnings.map((warning: UplinkInferenceWarning) => {
      return warning.reason;
    });
  };

  describe("grouping by cause", () => {
    it("collapses forty devices with one cause into a single bullet", () => {
      /*
       * The whole reason the banner groups by cause. A site whose switches
       * have endpoint collection off floats every till on the map at once;
       * that is one checkbox of work, so it is one line — not forty lines
       * telling the operator the same thing forty times.
       */
      const refusals: Array<UplinkRefusal> = [];
      const names: Map<string, string> = new Map<string, string>();

      for (let index: number = 1; index <= 40; index++) {
        const suffix: string = String(index).padStart(2, "0");
        refusals.push(makeRefusal(`d-${suffix}`, "endpointCollectionOff"));
        names.set(`d-${suffix}`, `till-${suffix}`);
      }

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(refusals, names);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("endpointCollectionOff");
      expect(warnings[0]!.deviceCount).toBe(40);
      expect(warnings[0]!.message).toContain("40 ping-monitored devices");
    });

    it("names at most MAX_NAMED_DEVICES ids while the count stays exact", () => {
      /*
       * The cap is on the NAMES, never on the count. A truncated count
       * would understate the blast radius, which is the one number the
       * operator uses to decide whether this is worth their afternoon.
       */
      const refusals: Array<UplinkRefusal> = [];
      const names: Map<string, string> = new Map<string, string>();

      for (let index: number = 1; index <= 12; index++) {
        const suffix: string = String(index).padStart(2, "0");
        refusals.push(makeRefusal(`d-${suffix}`, "ambiguous"));
        names.set(`d-${suffix}`, `till-${suffix}`);
      }

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(refusals, names);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.deviceCount).toBe(12);
      expect(warnings[0]!.deviceIds).toHaveLength(MAX_NAMED_DEVICES);
      expect(warnings[0]!.deviceIds).toEqual(["d-01", "d-02", "d-03"]);
    });

    it("keeps one bullet per cause when several causes are present", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "ambiguous"),
            makeRefusal("d2", "ambiguous"),
            makeRefusal("d3", "selfAttachment"),
            makeRefusal("d4", "ambiguous"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
            ["d3", "till-c"],
            ["d4", "till-d"],
          ]),
        );

      expect(reasonsOf(warnings)).toEqual(["ambiguous", "selfAttachment"]);
      expect(warnings[0]!.deviceCount).toBe(3);
      expect(warnings[1]!.deviceCount).toBe(1);
    });

    it("returns an empty array when nothing was refused", () => {
      /*
       * A map where every device placed cleanly must render no banner at
       * all, not an empty one.
       */
      expect(
        EndpointUplinkWarningUtil.getWarnings([], new Map<string, string>()),
      ).toEqual([]);
    });
  });

  describe("the sentence", () => {
    it("names three devices and then collapses the rest to a count", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "deviceHasNoSite"),
            makeRefusal("d2", "deviceHasNoSite"),
            makeRefusal("d3", "deviceHasNoSite"),
            makeRefusal("d4", "deviceHasNoSite"),
            makeRefusal("d5", "deviceHasNoSite"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
            ["d3", "till-c"],
            ["d4", "till-d"],
            ["d5", "till-e"],
          ]),
        );

      expect(warnings[0]!.message).toContain(
        "till-a, till-b, till-c and 2 more devices",
      );
      expect(warnings[0]!.message).not.toContain("till-d");
    });

    it("says 'device' rather than 'devices' for a remainder of exactly one", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "deviceHasNoSite"),
            makeRefusal("d2", "deviceHasNoSite"),
            makeRefusal("d3", "deviceHasNoSite"),
            makeRefusal("d4", "deviceHasNoSite"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
            ["d3", "till-c"],
            ["d4", "till-d"],
          ]),
        );

      expect(warnings[0]!.message).toContain(
        "till-a, till-b, till-c and 1 more device)",
      );
      expect(warnings[0]!.message).not.toContain("1 more devices");
    });

    it("reads as prose for one, two and three devices", () => {
      const one: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "deviceHasNoSite")],
          namesOf([["d1", "till-a"]]),
        );
      const two: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "deviceHasNoSite"),
            makeRefusal("d2", "deviceHasNoSite"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );
      const three: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "deviceHasNoSite"),
            makeRefusal("d2", "deviceHasNoSite"),
            makeRefusal("d3", "deviceHasNoSite"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
            ["d3", "till-c"],
          ]),
        );

      expect(one[0]!.message).toContain("(till-a)");
      expect(two[0]!.message).toContain("(till-a and till-b)");
      expect(three[0]!.message).toContain("(till-a, till-b and till-c)");
      expect(one[0]!.message).not.toContain("more device");
      expect(three[0]!.message).not.toContain("more device");
    });

    it("uses the singular subject for a single refused device", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "arpOnlyAttachment")],
          namesOf([["d1", "till-a"]]),
        );

      expect(warnings[0]!.deviceCount).toBe(1);
      expect(warnings[0]!.message).toContain("1 ping-monitored device is");
      expect(warnings[0]!.message).not.toContain("ping-monitored devices");
    });

    it("uses the plural subject as soon as there are two", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "arpOnlyAttachment"),
            makeRefusal("d2", "arpOnlyAttachment"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );

      expect(warnings[0]!.message).toContain("2 ping-monitored devices are");
    });

    it("agrees the verb with the count in the sentences that carry one", () => {
      /*
       * The banner is read by operators, not parsed by anything, so the
       * one thing it has to be is readable. These two sentences carry
       * their own verb rather than the shared one, and both got the
       * agreement wrong before.
       */
      const oneAmbiguous: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "ambiguous")],
          namesOf([["d1", "till-a"]]),
        );
      const twoAmbiguous: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "ambiguous"), makeRefusal("d2", "ambiguous")],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );
      const oneStale: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "attachmentStale")],
          namesOf([["d1", "till-a"]]),
        );
      const twoStale: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "attachmentStale"),
            makeRefusal("d2", "attachmentStale"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );

      expect(oneAmbiguous[0]!.message).toContain(
        "1 ping-monitored device shares an address",
      );
      expect(twoAmbiguous[0]!.message).toContain(
        "2 ping-monitored devices share an address",
      );
      expect(oneStale[0]!.message).toContain(
        "1 ping-monitored device was last seen by its switch",
      );
      expect(twoStale[0]!.message).toContain(
        "2 ping-monitored devices were last seen by their switch",
      );
    });
  });

  describe("bullet order", () => {
    it("follows the fixed order no matter what order the refusals arrive in", () => {
      /*
       * Fed in exactly reversed, so anything that preserved input order
       * would come out backwards. A banner whose lines move between polls
       * is one people stop reading.
       */
      const reversed: Array<UplinkRefusalReason> = [
        ...EXPECTED_ORDER,
      ].reverse();
      const refusals: Array<UplinkRefusal> = reversed.map(
        (reason: UplinkRefusalReason) => {
          return makeRefusal(`d-${reason}`, reason);
        },
      );

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          refusals,
          new Map<string, string>(),
        );

      expect(reasonsOf(warnings)).toEqual(EXPECTED_ORDER);
    });

    it("does not let a large group jump the queue", () => {
      /*
       * Sorting by size instead would reshuffle the banner as devices come
       * and go. The last-listed cause has nine devices and the first-listed
       * has one; the order must not notice.
       */
      const refusals: Array<UplinkRefusal> = [
        makeRefusal("d0", "endpointCollectionOff"),
      ];

      for (let index: number = 1; index <= 9; index++) {
        refusals.push(makeRefusal(`s${index}`, "selfAttachment"));
      }

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          refusals,
          new Map<string, string>(),
        );

      expect(reasonsOf(warnings)).toEqual([
        "endpointCollectionOff",
        "selfAttachment",
      ]);
      expect(warnings[0]!.deviceCount).toBe(1);
      expect(warnings[1]!.deviceCount).toBe(9);
    });

    it("has an order entry for every reason there is", () => {
      /*
       * A reason with a sentence but no place in the order produces no
       * bullet at all — the quietest possible regression, and exactly the
       * silence this feature exists to end.
       */
      expect([...EXPECTED_ORDER].sort()).toEqual([...ALL_REASONS].sort());
    });
  });

  describe("naming the devices", () => {
    it("names devices in name order, not in id order", () => {
      /*
       * The ids are stable but meaningless to a reader. A banner listing
       * tills in a jumble is harder to scan than one listing them in
       * order, so the sentence and deviceIds both follow the names.
       */
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "noEndpointMatch"),
            makeRefusal("d2", "noEndpointMatch"),
            makeRefusal("d3", "noEndpointMatch"),
          ],
          namesOf([
            ["d1", "zulu-till"],
            ["d2", "alpha-till"],
            ["d3", "mike-till"],
          ]),
        );

      expect(warnings[0]!.message).toContain(
        "(alpha-till, mike-till and zulu-till)",
      );
      expect(warnings[0]!.deviceIds).toEqual(["d2", "d3", "d1"]);
    });

    it("keeps deviceIds in the same order the sentence names them", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "ipBindingStale"),
            makeRefusal("d2", "ipBindingStale"),
            makeRefusal("d3", "ipBindingStale"),
            makeRefusal("d4", "ipBindingStale"),
          ],
          namesOf([
            ["d1", "delta-till"],
            ["d2", "charlie-till"],
            ["d3", "bravo-till"],
            ["d4", "alpha-till"],
          ]),
        );

      expect(warnings[0]!.deviceIds).toEqual(["d4", "d3", "d2"]);
      expect(warnings[0]!.message).toContain(
        "alpha-till, bravo-till, charlie-till and 1 more device",
      );
    });

    it("names an unknown device generically rather than dropping it", () => {
      /*
       * deviceNameById is best-effort — a device deleted between the
       * topology build and the name lookup still has to be counted. A
       * count that shrinks because a name was missing understates the
       * work, which is the one thing the count must never do.
       */
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "attachmentStale"),
            makeRefusal("d2", "attachmentStale"),
            makeRefusal("d3", "attachmentStale"),
          ],
          namesOf([
            ["d1", "alpha-till"],
            ["d3", "zulu-till"],
          ]),
        );

      expect(warnings[0]!.deviceCount).toBe(3);
      expect(warnings[0]!.deviceIds).toEqual(["d1", "d2", "d3"]);
      expect(warnings[0]!.message).toContain(
        "(alpha-till, Unnamed device and zulu-till)",
      );
    });

    it("counts a device whose name is blank or whitespace", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "attachmentStale"),
            makeRefusal("d2", "attachmentStale"),
          ],
          namesOf([
            ["d1", "   "],
            ["d2", ""],
          ]),
        );

      expect(warnings[0]!.deviceCount).toBe(2);
      expect(warnings[0]!.message).toContain(
        "(Unnamed device and Unnamed device)",
      );
    });

    it("counts every device even when none of them can be named", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "noMatchableAddress"),
            makeRefusal("d2", "noMatchableAddress"),
            makeRefusal("d3", "noMatchableAddress"),
            makeRefusal("d4", "noMatchableAddress"),
          ],
          new Map<string, string>(),
        );

      expect(warnings[0]!.deviceCount).toBe(4);
      expect(warnings[0]!.deviceIds).toEqual(["d1", "d2", "d3"]);
      expect(warnings[0]!.message).toContain("and 1 more device");
    });

    it("truncates a name longer than the clamp with an ellipsis", () => {
      /*
       * One overlong name must not push the rest of the sentence — and the
       * fix it carries — off the end of the banner.
       */
      const longName: string =
        "ground-floor-reception-desk-payment-terminal-number-7";
      const clamped: string = `${longName.slice(0, NAME_CLAMP - 1)}…`;

      expect(longName.length).toBeGreaterThan(NAME_CLAMP);

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "portHasMultipleDevices")],
          namesOf([["d1", longName]]),
        );

      expect(clamped).toHaveLength(NAME_CLAMP);
      expect(warnings[0]!.message).toContain(clamped);
      expect(warnings[0]!.message).not.toContain(longName);
      expect(warnings[0]!.deviceCount).toBe(1);
    });

    it("leaves a name exactly at the clamp alone", () => {
      const exactName: string = "a".repeat(NAME_CLAMP);

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "portHasMultipleDevices")],
          namesOf([["d1", exactName]]),
        );

      expect(warnings[0]!.message).toContain(`(${exactName})`);
      expect(warnings[0]!.message).not.toContain("…");
    });
  });

  describe("the transit-port sentence", () => {
    it("quotes the port's actual MAC count when the refusal carries one", () => {
      /*
       * For a transit port the number IS the explanation — "37 MACs on one
       * port" is what tells the operator there is an unmanaged switch down
       * there, in a way "too many" never does.
       */
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "transitPort", { portMacCount: 37 })],
          namesOf([["d1", "till-a"]]),
        );

      expect(warnings[0]!.message).toContain("carrying 37 MAC addresses");
      expect(warnings[0]!.message).not.toContain("too many");
    });

    it("falls back to 'too many' when no count was recorded", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [makeRefusal("d1", "transitPort")],
          namesOf([["d1", "till-a"]]),
        );

      expect(warnings[0]!.message).toContain("too many MAC addresses");
    });

    it("takes the count from whichever refusal in the group carries one", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "transitPort"),
            makeRefusal("d2", "transitPort", { portMacCount: 12 }),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );

      expect(warnings[0]!.deviceCount).toBe(2);
      expect(warnings[0]!.message).toContain("carrying 12 MAC addresses");
    });

    it("does not leak a MAC count into another cause's sentence", () => {
      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          [
            makeRefusal("d1", "transitPort", { portMacCount: 37 }),
            makeRefusal("d2", "ambiguous"),
          ],
          namesOf([
            ["d1", "till-a"],
            ["d2", "till-b"],
          ]),
        );

      const ambiguous: UplinkInferenceWarning | undefined = warnings.find(
        (warning: UplinkInferenceWarning) => {
          return warning.reason === "ambiguous";
        },
      );

      expect(ambiguous).toBeDefined();
      expect(ambiguous!.message).not.toContain("37");
    });
  });

  describe("every refusal reason", () => {
    /*
     * The guard against a reason being added to the union with no sentence
     * written for it. ALL_REASONS is compiler-checked to be exhaustive, so
     * a new member has to appear here, and this loop then fails until it
     * has both a bullet in the order and words of its own.
     */
    it.each(ALL_REASONS)(
      "produces one actionable bullet for %s",
      (reason: UplinkRefusalReason) => {
        const warnings: Array<UplinkInferenceWarning> =
          EndpointUplinkWarningUtil.getWarnings(
            [makeRefusal("d1", reason)],
            namesOf([["d1", "till-a"]]),
          );

        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.reason).toBe(reason);
        expect(warnings[0]!.deviceCount).toBe(1);
        expect(warnings[0]!.deviceIds).toEqual(["d1"]);

        const message: string = warnings[0]!.message;

        expect(message.length).toBeGreaterThan(0);
        // The affected device is always named, so the bullet points somewhere.
        expect(message).toContain("(till-a)");
        /*
         * The fallback is a bullet that tells the operator nothing they
         * could not already see on the map. Reaching it is the failure.
         */
        expect(message).not.toContain("could not be placed automatically");
        /*
         * Every written sentence is longer than the fallback would be,
         * because each one carries the cause and the fix as well.
         */
        expect(message.length).toBeGreaterThan(120);
      },
    );

    it("renders a bullet for every reason at once without dropping any", () => {
      const refusals: Array<UplinkRefusal> = ALL_REASONS.map(
        (reason: UplinkRefusalReason) => {
          return makeRefusal(`d-${reason}`, reason);
        },
      );

      const warnings: Array<UplinkInferenceWarning> =
        EndpointUplinkWarningUtil.getWarnings(
          refusals,
          new Map<string, string>(),
        );

      expect(warnings).toHaveLength(ALL_REASONS.length);
      expect([...reasonsOf(warnings)].sort()).toEqual([...ALL_REASONS].sort());

      const messages: Set<string> = new Set<string>(
        warnings.map((warning: UplinkInferenceWarning) => {
          return warning.message;
        }),
      );

      // Every cause reads differently, or two of them are the same bullet.
      expect(messages.size).toBe(ALL_REASONS.length);
    });
  });
});
