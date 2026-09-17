/*
 * The locked pill of the profiles table, for an entity-key scope.
 *
 * An Inventory item's Profiles page hands the table `entityKeys={[key]}`,
 * which the table compiles to `hasAny(entityKeys, [key])`. The list WAS
 * filtered, but the table had no chip bar and its pill row only opened for
 * the removable deep-link pills — so a pod's profiles page looked exactly
 * like the project-wide list. These tests pin how the pill is named, the
 * no-search-syntax reason its tooltip shows (the profiles list has no search
 * bar), and when the row opens; ProfilesEntityKeyLockedScopeWiring.test.ts
 * pins that the table really renders it.
 *
 * ProfilesEntityDisplay imports the shared entity-name resolver, which
 * imports ModelAPI; it is mocked so nothing reaches the network.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  INVENTORY_ITEM_FALLBACK_DISPLAY_KEY,
  buildInventoryEntityKeyDisplays,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import {
  ProfileTableFilterRowInput,
  hasProfileTableFilterRow,
} from "../../FeatureSet/Dashboard/src/Utils/ProfilesEntityDisplay";

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
const HOST_KEY: string = "bbbbbbbbbbbbbbbb";

type ProfileChipsFunction = (
  entityKeys: ReadonlyArray<string> | undefined,
  displays?: LockedEntityKeyDisplayMap | undefined,
) => Array<ActiveFilter>;

/*
 * Exactly the call ProfileTable makes (its wiring test pins the arguments),
 * so every expectation below is what the table would render.
 */
const profileChips: ProfileChipsFunction = (
  entityKeys: ReadonlyArray<string> | undefined,
  displays?: LockedEntityKeyDisplayMap | undefined,
): Array<ActiveFilter> => {
  return buildLockedEntityKeyChips({
    rows: "profiles",
    entityKeys,
    displays,
  });
};

/*
 * The detail every profiles pill carries: no search token (there is no
 * search bar to paste one into), only the entity-key reason. Its exact
 * spelling is pinned by the contract test below.
 */
const PROFILES_PILL_DETAIL: LockedFilterDetail = {
  searchTokenUnavailableReason: ENTITY_KEY_NO_SYNTAX_REASON,
};

const POD_DISPLAYS: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
  {
    entityKey: POD_KEY,
    entityType: EntityType.KubernetesPod,
    displayName: "checkout-7d9f",
  },
);

/*
 * The same pod, named with the resource attributes that identify it — what
 * an explorer spells its entity-key chip's search syntax with.
 */
const POD_ATTRIBUTE_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: {
    displayKey: "Kubernetes Pod",
    displayValue: "checkout-7d9f",
    searchAttributes: {
      "k8s.cluster.name": "prod",
      "k8s.namespace.name": "shop",
      "k8s.pod.name": "checkout-7d9f",
    },
  },
};

const POD_EXPLORER_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

describe("the contract strings the profiles pill is built from", () => {
  test("the facet, fallback keys and no-syntax reasons read as the pill shows them", () => {
    expect(ENTITY_KEYS_FACET_KEY).toBe("entityKeys");
    expect(DEFAULT_ENTITY_KEY_DISPLAY_KEY).toBe("Resource");
    expect(ENTITY_KEY_NO_SYNTAX_REASON).toBe(
      "Entity keys have no search syntax.",
    );
    expect(ENTITY_KEY_NO_ATTRIBUTES_REASON).toBe(
      "This resource has no telemetry attributes to search by.",
    );
    expect(INVENTORY_ITEM_FALLBACK_DISPLAY_KEY).toBe("Inventory Item");
  });

  test("the describer gives the profiles list the entity-key reason and nothing else", () => {
    expect(describeLockedEntityKeyFilter({ rows: "profiles" })).toStrictEqual(
      PROFILES_PILL_DETAIL,
    );
    expect(
      describeLockedEntityKeyFilter({
        rows: "profiles",
        searchAttributes: POD_ATTRIBUTE_DISPLAYS[POD_KEY]!.searchAttributes,
      }),
    ).toStrictEqual(PROFILES_PILL_DETAIL);
  });
});

describe("an Inventory item's Profiles page names its locked pill", () => {
  test("a Kubernetes pod reads 'Kubernetes Pod: checkout-7d9f' with the entity-key reason in its tooltip", () => {
    expect(POD_DISPLAYS).toEqual({
      [POD_KEY]: {
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
      },
    });

    const chips: Array<ActiveFilter> = profileChips([POD_KEY], POD_DISPLAYS);

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: PROFILES_PILL_DETAIL,
      },
    ]);
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a host item reads 'Host: web-01'", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [HOST_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: HOST_KEY,
        entityType: EntityType.Host,
        displayName: "web-01",
      }),
    );

    expect(chips).toHaveLength(1);
    expect(chips[0]!.displayKey).toBe("Host");
    expect(chips[0]!.displayValue).toBe("web-01");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("an item without a type reads 'Inventory Item: <name>'", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [POD_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: "   ",
        displayName: "checkout-7d9f",
      }),
    );

    expect(chips[0]!.displayKey).toBe("Inventory Item");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("an item without a name shows its key as the value, still under its type", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [POD_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "",
      }),
    );

    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a type this build has no label for is shown as the raw type", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [POD_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: "future.widget",
        displayName: "w-1",
      }),
    );

    expect(chips[0]!.displayKey).toBe("future.widget");
    expect(chips[0]!.displayValue).toBe("w-1");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });
});

describe("the pill renders without a display map", () => {
  test("REGRESSION: an entity-key scope with no display map still gets a pill, reading 'Resource: <key>'", () => {
    /*
     * The bug was a filtered list with nothing above it. A host that scopes
     * by entity key but cannot name the entity must still say so.
     */
    const chips: Array<ActiveFilter> = profileChips([POD_KEY]);

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Resource",
        displayValue: POD_KEY,
        readOnly: true,
        lockedDetail: PROFILES_PILL_DETAIL,
      },
    ]);
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("an empty map — the shell's answer for an item without a key — falls back the same way", () => {
    expect(buildInventoryEntityKeyDisplays({ entityKey: "  " })).toEqual({});

    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {});

    expect(chips).toEqual(profileChips([POD_KEY]));
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a map built for another key does not name this page's pill", () => {
    const chips: Array<ActiveFilter> = profileChips([HOST_KEY], POD_DISPLAYS);

    expect(chips).toHaveLength(1);
    expect(chips[0]!.displayKey).toBe("Resource");
    expect(chips[0]!.displayValue).toBe(HOST_KEY);
    expect(chips[0]!.displayValue).not.toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });
});

describe("display text that is blank or padded", () => {
  test("a whitespace-only key and value fall back to 'Resource: <key>'", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {
      [POD_KEY]: { displayKey: "   ", displayValue: "\t\n" },
    });

    expect(chips[0]!.displayKey).toBe("Resource");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a blank key alone falls back while the name is kept", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {
      [POD_KEY]: { displayKey: "", displayValue: "checkout-7d9f" },
    });

    expect(chips[0]!.displayKey).toBe("Resource");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a blank value alone falls back to the key while the type is kept", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {
      [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "  " },
    });

    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("padded display text is trimmed on the pill", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {
      [POD_KEY]: {
        displayKey: "  Kubernetes Pod ",
        displayValue: " checkout-7d9f  ",
      },
    });

    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("a display key of 'Resource' in any case is kept as the page wrote it", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY], {
      [POD_KEY]: { displayKey: "RESOURCE", displayValue: "checkout-7d9f" },
    });

    expect(chips[0]!.displayKey).toBe("RESOURCE");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });
});

describe("several entity keys", () => {
  test("one pill per key in page order, each with the reason a lone key's pill shows", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [POD_KEY, NODE_KEY],
      POD_DISPLAYS,
    );

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: PROFILES_PILL_DETAIL,
      },
      {
        facetKey: "entityKeys",
        value: NODE_KEY,
        displayKey: "Resource",
        displayValue: NODE_KEY,
        readOnly: true,
        lockedDetail: PROFILES_PILL_DETAIL,
      },
    ]);
    expect(
      chips.map((chip: ActiveFilter): string | undefined => {
        return chip.lockedDetail!.searchTokenUnavailableReason;
      }),
    ).toEqual([ENTITY_KEY_NO_SYNTAX_REASON, ENTITY_KEY_NO_SYNTAX_REASON]);
    // The other key on the page changes nothing about a pill's detail.
    expect(chips[0]!.lockedDetail).toStrictEqual(
      profileChips([POD_KEY], POD_DISPLAYS)[0]!.lockedDetail,
    );
    expect(chips[1]!.lockedDetail).toStrictEqual(
      profileChips([NODE_KEY])[0]!.lockedDetail,
    );
  });

  test("three keys build three pills in page order, none carrying a search token", () => {
    const chips: Array<ActiveFilter> = profileChips([
      POD_KEY,
      NODE_KEY,
      HOST_KEY,
    ]);

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([POD_KEY, NODE_KEY, HOST_KEY]);
    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    }
  });

  test("duplicate, padded and blank keys collapse to one pill per distinct key", () => {
    const chips: Array<ActiveFilter> = profileChips([
      ` ${POD_KEY} `,
      POD_KEY,
      "",
      "   ",
      NODE_KEY,
      `${NODE_KEY}\t`,
    ]);

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([POD_KEY, NODE_KEY]);
    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    }
  });

  test("a duplicated single key builds exactly the pill a lone key builds", () => {
    const chips: Array<ActiveFilter> = profileChips([POD_KEY, POD_KEY]);

    expect(chips).toHaveLength(1);
    expect(chips).toEqual(profileChips([POD_KEY]));
    expect(chips[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
  });

  test("the table's React keys are unique per pill", () => {
    const chips: Array<ActiveFilter> = profileChips([
      POD_KEY,
      POD_KEY,
      NODE_KEY,
      HOST_KEY,
    ]);
    const reactKeys: Set<string> = new Set<string>(
      chips.map((chip: ActiveFilter): string => {
        return `readonly:${chip.facetKey}:${chip.value}`;
      }),
    );

    expect(reactKeys.size).toBe(chips.length);
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    }
  });
});

describe("no entity-key scope, no pill", () => {
  test.each<[string, Array<string> | undefined]>([
    ["no entityKeys prop", undefined],
    ["an empty list", []],
    ["only blank keys", ["", "   ", "\t"]],
  ])(
    "%s builds no pill",
    (_label: string, entityKeys: Array<string> | undefined) => {
      expect(profileChips(entityKeys, POD_DISPLAYS)).toEqual([]);
    },
  );

  test("a display map alone does not invent a pill", () => {
    expect(profileChips(undefined, POD_DISPLAYS)).toEqual([]);
  });
});

describe("every profiles pill is locked and carries nothing to copy", () => {
  const chips: Array<ActiveFilter> = profileChips(
    [POD_KEY, NODE_KEY],
    POD_DISPLAYS,
  );

  test("read-only, on the entityKeys facet, valued by the raw key — never the display name", () => {
    for (const chip of chips) {
      expect(chip.readOnly).toBe(true);
      expect(chip.facetKey).toBe("entityKeys");
      expect([POD_KEY, NODE_KEY]).toContain(chip.value);
      expect(chip.openRoute).toBeUndefined();
      expect(chip.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    }
    expect(chips[0]!.value).not.toBe(chips[0]!.displayValue);
  });

  test("no search token, so the chip's Enter copies nothing and its tooltip shows no Copy button", () => {
    for (const chip of chips) {
      const detail: LockedFilterDetail = chip.lockedDetail!;

      expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
        false,
      );
      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_NO_SYNTAX_REASON,
      );
    }
  });

  test("profiles have no search bar, so the reason is the entity-key one — never the explorers' missing-attributes one", () => {
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_SYNTAX_REASON,
    );
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).not.toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
    // The same scope on the logs explorer gives the explorers' reason instead.
    expect(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] })[0]!
        .lockedDetail,
    ).toStrictEqual({
      searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
    });
  });

  test("an item that names its identifying attributes still gets no search syntax on the profiles pill", () => {
    const detail: LockedFilterDetail = profileChips(
      [POD_KEY],
      POD_ATTRIBUTE_DISPLAYS,
    )[0]!.lockedDetail!;

    expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
      false,
    );
    expect(detail.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_SYNTAX_REASON,
    );
    // The attributes leave the detail exactly as a pill without them has it.
    expect(detail).toStrictEqual(
      profileChips([POD_KEY], POD_DISPLAYS)[0]!.lockedDetail,
    );
  });

  test("the profiles pill shares the exceptions list's reason, while an explorer spells the same entity's attributes", () => {
    expect(
      profileChips([POD_KEY], POD_ATTRIBUTE_DISPLAYS)[0]!.lockedDetail,
    ).toStrictEqual(PROFILES_PILL_DETAIL);
    // The exceptions list has no search bar either.
    expect(
      buildLockedEntityKeyChips({
        rows: "exceptions",
        entityKeys: [POD_KEY],
        displays: POD_ATTRIBUTE_DISPLAYS,
      })[0]!.lockedDetail,
    ).toStrictEqual(PROFILES_PILL_DETAIL);

    const explorers: Array<EntityKeyScopedRows> = ["logs", "traces", "metrics"];

    for (const rows of explorers) {
      expect(
        buildLockedEntityKeyChips({
          rows,
          entityKeys: [POD_KEY],
          displays: POD_ATTRIBUTE_DISPLAYS,
        })[0]!.lockedDetail,
      ).toStrictEqual({ searchToken: POD_EXPLORER_SEARCH_TOKEN });
    }
  });
});

describe("the pill is display only", () => {
  test("building it leaves the page's key list and display map untouched — the query reads the same list", () => {
    const entityKeys: ReadonlyArray<string> = Object.freeze([
      ` ${POD_KEY} `,
      POD_KEY,
      "",
    ]);
    const displays: LockedEntityKeyDisplayMap = Object.freeze({
      [POD_KEY]: Object.freeze({
        displayKey: " Kubernetes Pod ",
        displayValue: "checkout-7d9f",
      }),
    }) as LockedEntityKeyDisplayMap;

    let chips: Array<ActiveFilter> = [];

    expect(() => {
      chips = profileChips(entityKeys, displays);
    }).not.toThrow();
    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: PROFILES_PILL_DETAIL,
      },
    ]);
    expect(entityKeys).toEqual([` ${POD_KEY} `, POD_KEY, ""]);
    expect(displays).toEqual({
      [POD_KEY]: {
        displayKey: " Kubernetes Pod ",
        displayValue: "checkout-7d9f",
      },
    });
  });

  test("the same inputs build equal pills every time", () => {
    const chips: Array<ActiveFilter> = profileChips(
      [POD_KEY, NODE_KEY],
      POD_DISPLAYS,
    );

    expect(chips).toEqual(profileChips([POD_KEY, NODE_KEY], POD_DISPLAYS));
    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    }
  });
});

describe("hasProfileTableFilterRow", () => {
  const LOCKED: Array<ActiveFilter> = profileChips([POD_KEY], POD_DISPLAYS);

  test("no locked chip and no deep link: no row", () => {
    expect(hasProfileTableFilterRow({})).toBe(false);
    expect(
      hasProfileTableFilterRow({
        lockedChips: [],
        traceIdFilter: null,
        serviceIdFilter: null,
        profileTypeFilter: null,
      }),
    ).toBe(false);
    expect(
      hasProfileTableFilterRow({
        lockedChips: undefined,
        traceIdFilter: undefined,
        serviceIdFilter: undefined,
        profileTypeFilter: undefined,
      }),
    ).toBe(false);
  });

  test("REGRESSION: a locked entity-key chip opens the row with no deep link set", () => {
    expect(LOCKED[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    expect(
      hasProfileTableFilterRow({
        lockedChips: LOCKED,
        traceIdFilter: null,
        serviceIdFilter: null,
        profileTypeFilter: null,
      }),
    ).toBe(true);
  });

  test("a fallback pill (no display map) opens the row just the same", () => {
    const fallback: Array<ActiveFilter> = profileChips([POD_KEY]);

    expect(fallback[0]!.lockedDetail).toStrictEqual(PROFILES_PILL_DETAIL);
    expect(hasProfileTableFilterRow({ lockedChips: fallback })).toBe(true);
  });

  test.each<[string, ProfileTableFilterRowInput]>([
    [
      "a trace deep link",
      { traceIdFilter: "4bf92f3577b34da6a3ce929d0e0e4736" },
    ],
    [
      "a service deep link",
      { serviceIdFilter: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ],
    ["a profile-type deep link", { profileTypeFilter: "cpu" }],
  ])(
    "%s alone still opens the row, as before",
    (_label: string, input: ProfileTableFilterRowInput) => {
      expect(hasProfileTableFilterRow({ lockedChips: [], ...input })).toBe(
        true,
      );
    },
  );

  test("an empty deep-link value renders no pill, so it opens no row", () => {
    expect(
      hasProfileTableFilterRow({
        lockedChips: [],
        traceIdFilter: "",
        serviceIdFilter: "",
        profileTypeFilter: "",
      }),
    ).toBe(false);
  });

  test("locked chips and deep links together share the one row", () => {
    expect(
      hasProfileTableFilterRow({
        lockedChips: LOCKED,
        traceIdFilter: "4bf92f3577b34da6a3ce929d0e0e4736",
        serviceIdFilter: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profileTypeFilter: "cpu",
      }),
    ).toBe(true);
  });

  test("a page that scopes by something other than entity keys builds no pill, so only its deep links open the row", () => {
    /*
     * A Kubernetes cluster's Profiles page scopes through profileQuery
     * (entityScope), a Service's through modelId: neither passes entityKeys,
     * so neither gets an entity-key pill from this table.
     */
    expect(
      hasProfileTableFilterRow({
        lockedChips: profileChips(undefined, undefined),
      }),
    ).toBe(false);
  });
});
