import { describe, expect, test } from "@jest/globals";
import DEFAULT_NETWORK_DEVICE_ROLES, {
  DefaultNetworkDeviceRole,
} from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";
import {
  FALLBACK_DEVICE_ROLE_KEY,
  buildUniqueDeviceRoleKey,
  deriveDeviceRoleKey,
} from "../../../Utils/NetworkDevice/DeviceRoleKeyUtil";

/*
 * Device roles became per-project rows an operator can rename at will, so the
 * NAME stopped being able to identify one. The KEY took that job: it is what
 * the SNMP classifier's answer is matched against, what a topology payload
 * carries, and what survives a rename.
 *
 * That makes this module load-bearing in a quiet way — nothing here can throw
 * or look broken, it can only produce a key that fails to match later, on a
 * different machine, in a different module. So every branch is pinned, and
 * the three places the derivation is ASYMMETRIC (a multi-word name has its
 * first word lowercased whole, every later word keeps its capitals, and a
 * one-word name is left alone) are pinned loudest, with the reason each is
 * what it is.
 */

describe("deriveDeviceRoleKey — the shape of a key", () => {
  test("a single word becomes its lowercase self", () => {
    expect(deriveDeviceRoleKey("Router")).toBe("router");
  });

  test("a multi-word name becomes lowerCamelCase", () => {
    expect(deriveDeviceRoleKey("Load balancer")).toBe("loadBalancer");
  });

  test("leading and trailing whitespace is not part of any word", () => {
    expect(deriveDeviceRoleKey("  Router  ")).toBe("router");
  });

  /*
   * The single most important non-obvious rule in the module, and it is
   * asymmetric. A LATER word keeps its interior, so an acronym stays an
   * acronym and the boundaries a reader navigates by survive.
   */
  test("a later word keeps its capitals, so acronyms stay acronyms", () => {
    expect(deriveDeviceRoleKey("Wireless AP")).toBe("wirelessAP");
    expect(deriveDeviceRoleKey("SD-WAN Edge")).toBe("sdWANEdge");
    expect(deriveDeviceRoleKey("Wi-Fi AP")).toBe("wiFiAP");
  });

  /*
   * The other half of the asymmetry: the FIRST word is lowercased whole. Only
   * re-casing its first letter is what used to turn "PoS Terminal" into
   * "poSTerminal" and "IP phone" into "iPPhone" - and the key is a column an
   * operator reads on the settings page.
   */
  test("the first word is lowercased whole, so a leading acronym reads as a word", () => {
    expect(deriveDeviceRoleKey("IoT Gateway")).toBe("iotGateway");
    expect(deriveDeviceRoleKey("IP phone")).toBe("ipPhone");
    expect(deriveDeviceRoleKey("PoS Terminal")).toBe("posTerminal");
  });

  /*
   * ...and a ONE-WORD name is exempt from it, re-cased only at its first
   * letter. A name with no word boundaries has none to normalise, and the
   * exemption is what makes every derived key a fixed point of the deriver:
   * a key is always a single run of letters and digits, so it re-splits into
   * exactly one word. See the fixed-point block below.
   */
  test("a one-word name keeps its interior, so an already-camelCase name survives", () => {
    expect(deriveDeviceRoleKey("wirelessAccessPoint")).toBe(
      "wirelessAccessPoint",
    );
    expect(deriveDeviceRoleKey("loadBalancer")).toBe("loadBalancer");
  });

  test.each([
    ["pos-terminal", "posTerminal"],
    ["pos_terminal", "posTerminal"],
    ["pos terminal", "posTerminal"],
    ["pos.terminal", "posTerminal"],
    ["pos/terminal", "posTerminal"],
    ["pos   terminal", "posTerminal"],
    ["  pos terminal!  ", "posTerminal"],
  ])(
    "anything that is not a letter or a digit is a word boundary: %p derives %p",
    (name: string, expected: string) => {
      expect(deriveDeviceRoleKey(name)).toBe(expected);
    },
  );

  test("digits are word characters, and a key is allowed to start with one", () => {
    /*
     * A key is a lookup value in a database column, never a JavaScript
     * identifier, so "5gRouter" is a perfectly good key and is deliberately
     * not prefixed or rejected. The G is lowercase because "5G" is the first
     * word of a multi-word name and the head of a camelCase key is lowercase;
     * an acronym in a LATER word keeps its capitals ("sdWANEdge").
     */
    expect(deriveDeviceRoleKey("5G Router")).toBe("5gRouter");
    expect(deriveDeviceRoleKey("3rd party")).toBe("3rdParty");
    expect(deriveDeviceRoleKey("router_1")).toBe("router1");
  });

  test("a derived key only ever contains letters and digits", () => {
    const messyNames: ReadonlyArray<string> = [
      "Core / Distribution Switch",
      "PoE+ Access Switch (2024)",
      "  ---  Edge  ---  ",
      "SD-WAN\tEdge\nRouter",
      "role@example.com",
    ];

    for (const name of messyNames) {
      expect(deriveDeviceRoleKey(name)).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });
});

describe("deriveDeviceRoleKey — names it cannot build a key from", () => {
  test.each(["", "   ", "\t\n", "---", "!!!", "***", "/", "路由器", "…"])(
    "falls back to the reserved key for %p, which has no letters or digits to use",
    (name: string) => {
      /*
       * Returning "" here would fail the column's NOT NULL and surface to the
       * operator as a database error on a form they filled in correctly. The
       * fallback plus the caller's suffixing turns a second such name into
       * "role2" instead.
       */
      expect(deriveDeviceRoleKey(name)).toBe(FALLBACK_DEVICE_ROLE_KEY);
    },
  );

  test("the fallback key is 'role'", () => {
    expect(FALLBACK_DEVICE_ROLE_KEY).toBe("role");
  });

  /*
   * Worth knowing about rather than worth fixing here: the word split is
   * ASCII-only, so a non-ASCII name keeps only its ASCII letters. A name with
   * NO ASCII letters at all ("路由器") therefore lands on the fallback, and a
   * project naming its roles in a non-Latin script would get "role", "role2",
   * "role3". The keys still work — they are opaque identifiers and the NAME is
   * what the operator ever sees — but they carry no meaning.
   */
  test("non-ASCII letters are treated as separators, not as word characters", () => {
    expect(deriveDeviceRoleKey("Café Router")).toBe("cafRouter");
  });
});

describe("deriveDeviceRoleKey — length", () => {
  test("a 200-character name is capped at the column's 100 characters", () => {
    const longName: string = "a".repeat(200);

    expect(longName).toHaveLength(200);
    expect(deriveDeviceRoleKey(longName)).toBe("a".repeat(100));
  });

  test("a long multi-word name is capped at 100 too", () => {
    // 8 words x 25 chars, so the un-capped key would be far past the limit.
    const longName: string = "Distribution Layer Switch ".repeat(8).trim();

    expect(longName.length).toBeGreaterThan(100);
    expect(deriveDeviceRoleKey(longName)).toHaveLength(100);
  });

  test("a name that derives exactly 100 characters is not truncated", () => {
    const exactName: string = "b".repeat(100);

    expect(deriveDeviceRoleKey(exactName)).toBe(exactName);
  });
});

describe("deriveDeviceRoleKey — purity", () => {
  test("the same name always derives the same key", () => {
    const names: ReadonlyArray<string> = [
      "Wireless AP",
      "PoS Terminal",
      "---",
      "",
      "5G Router",
    ];

    for (const name of names) {
      expect(deriveDeviceRoleKey(name)).toBe(deriveDeviceRoleKey(name));
    }
  });

  /*
   * Idempotence is what makes the key safe to re-derive. The service derives
   * on create; a later import, backfill or copy of a project may well hand the
   * KEY back in as a name, and doing so must not shift the identity of the
   * role. It holds for every input because a derived key contains only
   * letters and digits (so it re-splits into exactly one word) whose first
   * character is already lowercase.
   */
  test("running a derived key back through the deriver returns it unchanged", () => {
    const names: ReadonlyArray<string> = [
      "Router",
      "Wireless AP",
      "IP phone",
      "Load balancer",
      "PoS Terminal",
      "POS  terminal!",
      "SD-WAN Edge",
      "5G Router",
      "Café Router",
      "路由器",
      "",
      "---",
      "a".repeat(200),
    ];

    for (const name of names) {
      const key: string = deriveDeviceRoleKey(name);
      expect(deriveDeviceRoleKey(key)).toBe(key);
    }
  });
});

/*
 * The eleven built-in roles are seeded with an EXPLICIT key rather than one
 * derived from their name. These tests exist to show why that is not
 * belt-and-braces: two of the eleven names do not derive their seeded key, so
 * a seeder that let the service derive would create a project whose "Wireless
 * AP" row is keyed "wirelessAP" — a key the SNMP classifier, which only ever
 * says "wirelessAccessPoint", could never match.
 */
describe("deriveDeviceRoleKey — the eleven built-in default names", () => {
  test.each([
    ["Router", "router"],
    ["Switch", "switch"],
    ["Firewall", "firewall"],
    // Does NOT round-trip: the seeded key is "wirelessAccessPoint".
    ["Wireless AP", "wirelessAP"],
    ["Load balancer", "loadBalancer"],
    ["Server", "server"],
    ["Storage", "storage"],
    ["Printer", "printer"],
    ["Camera", "camera"],
    // Does NOT round-trip: the seeded key is "phone".
    ["IP phone", "ipPhone"],
    ["Host", "host"],
  ])("the default name %p derives %p", (name: string, expected: string) => {
    expect(deriveDeviceRoleKey(name)).toBe(expected);
  });

  test("exactly two of the eleven default names do not derive their seeded key", () => {
    const mismatched: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.filter(
      (role: DefaultNetworkDeviceRole): boolean => {
        return deriveDeviceRoleKey(role.name) !== role.key;
      },
    ).map((role: DefaultNetworkDeviceRole): string => {
      return role.name;
    });

    /*
     * "Wireless AP" is an abbreviation of its key and "IP phone" is a
     * different word from its key, so neither can be recovered from the name.
     * This is exactly the reason ProjectService.addDefaultNetworkDeviceRoles
     * and the BackfillNetworkDeviceRoles migration pass `key` explicitly
     * instead of letting NetworkDeviceRoleService.onBeforeCreate derive it.
     * If this list ever shrinks to zero the explicit key is still correct —
     * but if it GROWS, a new default was added whose name and key disagree,
     * and the seeder must keep passing the key.
     */
    expect(mismatched).toEqual(["Wireless AP", "IP phone"]);
  });

  test("the other nine default names do derive their seeded key", () => {
    const matched: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.filter(
      (role: DefaultNetworkDeviceRole): boolean => {
        return deriveDeviceRoleKey(role.name) === role.key;
      },
    ).map((role: DefaultNetworkDeviceRole): string => {
      return role.key;
    });

    expect(matched).toEqual([
      "router",
      "switch",
      "firewall",
      "loadBalancer",
      "server",
      "storage",
      "printer",
      "camera",
      "host",
    ]);
  });

  test("every seeded key is itself a fixed point of the deriver", () => {
    /*
     * Even the two that the NAME cannot produce: the KEY must still survive
     * being re-derived, because a backfill or an import can hand the key in as
     * a name and the role's identity must not move.
     */
    for (const role of DEFAULT_NETWORK_DEVICE_ROLES) {
      expect(deriveDeviceRoleKey(role.key)).toBe(role.key);
    }
  });
});

/*
 * Three spellings of one name derive one key, letter for letter. That is what
 * lowercasing the first word buys: without it these were "poSTerminal",
 * "posTerminal" and "pOSTerminal" — three near-duplicate rows in the settings
 * list, differing only in case, each of them a key an operator would read as
 * a bug.
 *
 * Pinned here because the exact strings are what land in the database, and
 * because the collapse still has a second line of defence one level up:
 * buildUniqueDeviceRoleKey compares case-insensitively and normalizeRoleKey
 * (NetworkDeviceRoleCatalog) looks keys up case-insensitively, so even a name
 * whose derived key differs only in case from an existing one is suffixed
 * rather than duplicated.
 */
describe("deriveDeviceRoleKey — three spellings of one name derive one key", () => {
  const nearDuplicates: ReadonlyArray<string> = [
    "PoS Terminal",
    "pos-terminal",
    "POS  terminal!",
  ];

  test.each([
    ["PoS Terminal", "posTerminal"],
    ["pos-terminal", "posTerminal"],
    ["POS  terminal!", "posTerminal"],
  ])(
    "%p derives %p — three spellings of one name, one key",
    (name: string, expected: string) => {
      expect(deriveDeviceRoleKey(name)).toBe(expected);
    },
  );

  test("all three are the same key once cased the way every lookup cases it", () => {
    const lowered: Array<string> = nearDuplicates.map(
      (name: string): string => {
        return deriveDeviceRoleKey(name).toLowerCase();
      },
    );

    expect(new Set<string>(lowered).size).toBe(1);
  });

  test("so the second and third of them are suffixed rather than duplicated", () => {
    const taken: Set<string> = new Set<string>();
    const assigned: Array<string> = nearDuplicates.map(
      (name: string): string => {
        const key: string = buildUniqueDeviceRoleKey(name, taken);
        taken.add(key);
        return key;
      },
    );

    expect(assigned).toEqual(["posTerminal", "posTerminal2", "posTerminal3"]);
  });
});

describe("buildUniqueDeviceRoleKey — when the base key is free", () => {
  test("an empty project gets the plain derived key", () => {
    expect(buildUniqueDeviceRoleKey("Router", new Set<string>())).toBe(
      "router",
    );
  });

  test("keys taken by unrelated roles do not perturb it", () => {
    expect(
      buildUniqueDeviceRoleKey(
        "Load balancer",
        new Set<string>(["router", "switch", "firewall"]),
      ),
    ).toBe("loadBalancer");
  });

  test("a name with no usable letters still gets the fallback when it is free", () => {
    expect(buildUniqueDeviceRoleKey("---", new Set<string>())).toBe(
      FALLBACK_DEVICE_ROLE_KEY,
    );
  });
});

describe("buildUniqueDeviceRoleKey — when the base key is taken", () => {
  test("the first collision is suffixed 2, never 1", () => {
    // "router1" would read as the first of a series that does not exist.
    expect(
      buildUniqueDeviceRoleKey("Router", new Set<string>(["router"])),
    ).toBe("router2");
  });

  test("suffixes count up past every taken candidate", () => {
    expect(
      buildUniqueDeviceRoleKey(
        "Router",
        new Set<string>(["router", "router2", "router3"]),
      ),
    ).toBe("router4");
  });

  test("a gap in the sequence is filled rather than skipped", () => {
    // Roles get deleted; the next one should reuse the hole, not run away.
    expect(
      buildUniqueDeviceRoleKey(
        "Router",
        new Set<string>(["router", "router3", "router4"]),
      ),
    ).toBe("router2");
  });

  test("the suffix goes on the derived key, not on the name", () => {
    expect(
      buildUniqueDeviceRoleKey(
        "Load balancer",
        new Set<string>(["loadBalancer"]),
      ),
    ).toBe("loadBalancer2");
  });

  test("a punctuation-only name collides on the fallback and becomes 'role2'", () => {
    expect(
      buildUniqueDeviceRoleKey(
        "!!!",
        new Set<string>([FALLBACK_DEVICE_ROLE_KEY]),
      ),
    ).toBe("role2");
  });
});

describe("buildUniqueDeviceRoleKey — comparison is case- and whitespace-insensitive", () => {
  /*
   * It has to be: normalizeRoleKey lowercases and trims before looking a role
   * up, so two keys differing only in case would be one key at lookup time and
   * whichever row the index happened to keep would silently win.
   */
  test.each(["ROUTER", "Router", "RoUtEr"])(
    "a taken key spelled %p still blocks the base key",
    (taken: string) => {
      expect(buildUniqueDeviceRoleKey("Router", new Set<string>([taken]))).toBe(
        "router2",
      );
    },
  );

  test("a taken key with surrounding whitespace still blocks the base key", () => {
    expect(
      buildUniqueDeviceRoleKey("Router", new Set<string>(["  router  "])),
    ).toBe("router2");
  });

  test("the suffixed candidates are compared case-insensitively as well", () => {
    expect(
      buildUniqueDeviceRoleKey(
        "Router",
        new Set<string>(["router", "ROUTER2"]),
      ),
    ).toBe("router3");
  });

  test("a name whose derived key differs only in case from a taken key is suffixed", () => {
    // "wirelessAP" vs a hand-imported "WIRELESSAP" is one key at lookup time.
    expect(
      buildUniqueDeviceRoleKey("Wireless AP", new Set<string>(["WIRELESSAP"])),
    ).toBe("wirelessAP2");
  });
});

describe("buildUniqueDeviceRoleKey — the search is bounded", () => {
  type TakenKeysFunction = (base: string, upTo: number) => Set<string>;

  const takenThrough: TakenKeysFunction = (
    base: string,
    upTo: number,
  ): Set<string> => {
    const taken: Set<string> = new Set<string>([base]);
    for (let suffix: number = 2; suffix <= upTo; suffix++) {
      taken.add(`${base}${suffix}`);
    }
    return taken;
  };

  test("the last suffix it will ever hand out is 999", () => {
    expect(
      buildUniqueDeviceRoleKey("Router", takenThrough("router", 998)),
    ).toBe("router999");
  });

  /*
   * Past the bound the caller gets the base key back, which the unique index
   * on (projectId, key) then rejects. That is deliberate: a loud failure on a
   * project with a thousand identically-named roles beats a loop that spins.
   */
  test("a project that has exhausted the bound gets the base key back, so the database refuses the create", () => {
    const taken: Set<string> = takenThrough("router", 999);

    expect(taken.size).toBe(999);
    expect(buildUniqueDeviceRoleKey("Router", taken)).toBe("router");
    expect(taken.has("router")).toBe(true);
  });
});

describe("buildUniqueDeviceRoleKey — purity", () => {
  test("the taken set is not mutated", () => {
    const taken: Set<string> = new Set<string>(["router", "ROUTER2"]);

    buildUniqueDeviceRoleKey("Router", taken);

    expect(Array.from(taken)).toEqual(["router", "ROUTER2"]);
  });

  test("the same name and the same taken set always give the same key", () => {
    const taken: ReadonlySet<string> = new Set<string>(["router", "router2"]);

    expect(buildUniqueDeviceRoleKey("Router", taken)).toBe(
      buildUniqueDeviceRoleKey("Router", taken),
    );
  });

  test("seeding a fresh project hands every default name an unsuffixed key", () => {
    /*
     * The real sequence the seeder runs: eleven names, each checked against
     * the keys already assigned. None of the eleven derive the same key, so
     * none of them may pick up a numeric suffix — a seeded "router2" would be
     * a role the classifier can never match.
     */
    const taken: Set<string> = new Set<string>();
    const assigned: Array<string> = DEFAULT_NETWORK_DEVICE_ROLES.map(
      (role: DefaultNetworkDeviceRole): string => {
        const key: string = buildUniqueDeviceRoleKey(role.name, taken);
        taken.add(key);
        return key;
      },
    );

    for (const key of assigned) {
      expect(key).not.toMatch(/\d$/);
    }
    expect(new Set<string>(assigned).size).toBe(assigned.length);
  });
});
