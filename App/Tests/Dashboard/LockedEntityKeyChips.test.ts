import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import type { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
/*
 * STATIC imports, on purpose: every viewer's chip builder calls this module
 * and their suites run in plain Node without a browser stub. If a future
 * change drags RouteMap / Navigation / Common/UI/Config into it (or into the
 * describers it imports), this file fails at load with "window is not
 * defined" — which is the point.
 */
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
  normalizeLockedEntityKeys,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import {
  SpanQueryScope,
  SpanScopeChip,
  buildSpanQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/SpanQueryScope";

/*
 * The locked pill for an entity-key scope — what an Inventory item's Logs /
 * Traces / Metrics / Exceptions / Profiles pages were missing. Every viewer
 * turns its entity-key scope into chips through this one builder, so the
 * five surfaces cannot drift; the rules it has to keep are all silent when
 * broken:
 *
 *  - a scoped viewer with no display map must STILL show a pill ("Resource:
 *    <key>") — a filtered list under an empty chip bar is the bug;
 *  - the name is display only: the chip's facet and value are the key the
 *    query matched, never the name;
 *  - one chip per distinct key, so the chip bar (which keys its pills by
 *    facet and value) never renders a duplicate;
 *  - a chip's search syntax is spelled from its OWN display entry's search
 *    attributes — never a neighbour's, a skipped key's or an inherited
 *    entry's — and a chip without them carries the reason it has none;
 *  - runtime garbage in the key list or the display map degrades to the
 *    fallback rather than throwing inside a viewer's memo.
 *
 * Every chip's tooltip detail is asserted here by its exact search token or
 * exact reason, and against the describer called directly. How the describer
 * spells a token is pinned in LockedTelemetryScope.test.ts.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
const CLUSTER_KEY: string = "0123456789abcdef";

const POD_NAME: string = "checkout-7d9f";

const ALL_ROWS: Array<EntityKeyScopedRows> = [
  "logs",
  "traces",
  "metrics",
  "exceptions",
  "profiles",
];

const NO_ATTRIBUTES: string = ENTITY_KEY_NO_ATTRIBUTES_REASON;
const NO_SYNTAX: string = ENTITY_KEY_NO_SYNTAX_REASON;

// An explorer's chip whose page did not name the entity's attributes.
const NO_ATTRIBUTES_DETAIL: LockedFilterDetail = {
  searchTokenUnavailableReason: NO_ATTRIBUTES,
};

// An exceptions or profiles chip: those lists have no search bar at all.
const NO_SYNTAX_DETAIL: LockedFilterDetail = {
  searchTokenUnavailableReason: NO_SYNTAX,
};

const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_NAME },
};

// The pod's identifying resource attributes, keys without `resource.`.
const POD_SEARCH_ATTRIBUTES: Record<string, string> = {
  "k8s.cluster.name": "prod",
  "k8s.namespace.name": "shop",
  "k8s.pod.name": POD_NAME,
};

// The same on every explorer: one `@resource.<key>:<value>` per attribute, in key order.
const POD_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

const POD_TOKEN_DETAIL: LockedFilterDetail = { searchToken: POD_SEARCH_TOKEN };

type PillTextFunction = (chip: ActiveFilter) => string;

/** The pill as the chip bar prints it: `<displayKey>: <displayValue>`. */
const pillText: PillTextFunction = (chip: ActiveFilter): string => {
  return `${chip.displayKey}: ${chip.displayValue}`;
};

type PillTextsFunction = (chips: Array<ActiveFilter>) => Array<string>;

const pillTexts: PillTextsFunction = (
  chips: Array<ActiveFilter>,
): Array<string> => {
  return chips.map(pillText);
};

type LockedDetailsFunction = (
  chips: Array<ActiveFilter>,
) => Array<LockedFilterDetail | undefined>;

/** What each chip's tooltip shows: its search syntax, or why it has none. */
const lockedDetails: LockedDetailsFunction = (
  chips: Array<ActiveFilter>,
): Array<LockedFilterDetail | undefined> => {
  return chips.map((chip: ActiveFilter): LockedFilterDetail | undefined => {
    return chip.lockedDetail;
  });
};

describe("normalizeLockedEntityKeys", () => {
  test("trims, drops blanks, de-duplicates after trimming and keeps first-seen order", () => {
    expect(
      normalizeLockedEntityKeys([
        ` ${NODE_KEY}`,
        POD_KEY,
        "",
        "   ",
        `${NODE_KEY} `,
        POD_KEY,
        "\t",
        CLUSTER_KEY,
      ]),
    ).toEqual([NODE_KEY, POD_KEY, CLUSTER_KEY]);
  });

  test("no keys is an empty list", () => {
    expect(normalizeLockedEntityKeys(undefined)).toEqual([]);
    expect(normalizeLockedEntityKeys([])).toEqual([]);
    expect(normalizeLockedEntityKeys(["", " \t\n "])).toEqual([]);
  });

  test("non-string entries are ignored", () => {
    expect(
      normalizeLockedEntityKeys([
        POD_KEY,
        42,
        null,
        undefined,
        {},
        [NODE_KEY],
        NODE_KEY,
      ] as never),
    ).toEqual([POD_KEY, NODE_KEY]);
  });

  test("a non-array is no keys — never one key per character, never a throw", () => {
    for (const entityKeys of [
      POD_KEY,
      new Includes([POD_KEY]),
      42,
      null,
      { 0: POD_KEY, length: 1 },
    ] as Array<never>) {
      expect(() => {
        return normalizeLockedEntityKeys(entityKeys);
      }).not.toThrow();
      expect(normalizeLockedEntityKeys(entityKeys)).toEqual([]);
    }
  });

  test("keys are compared exactly: case is significant, as it is to hasAny", () => {
    expect(normalizeLockedEntityKeys(["ABCDEF", "abcdef"])).toEqual([
      "ABCDEF",
      "abcdef",
    ]);
  });

  test("returns a fresh array and never writes to its input", () => {
    const input: ReadonlyArray<string> = Object.freeze([POD_KEY, NODE_KEY]);
    const normalized: Array<string> = normalizeLockedEntityKeys(input);

    expect(normalized).toEqual([POD_KEY, NODE_KEY]);
    expect(normalized).not.toBe(input);

    normalized.push(CLUSTER_KEY);

    expect(input).toEqual([POD_KEY, NODE_KEY]);
  });
});

describe("buildLockedEntityKeyChips", () => {
  test("one read-only chip naming the entity, valued by its key, carrying the reason it has no search syntax", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    });

    expect(chips).toStrictEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: { searchTokenUnavailableReason: NO_ATTRIBUTES },
      },
    ]);
    expect(chips[0]!.lockedDetail).toStrictEqual(
      describeLockedEntityKeyFilter({ rows: "logs" }),
    );
    expect(chips[0]!.lockedDetail?.searchTokenUnavailableReason).toBe(
      NO_ATTRIBUTES,
    );
  });

  test("without a display map the pill STILL renders, reading 'Resource: <key>'", () => {
    const fallback: Array<ActiveFilter> = [
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Resource",
        displayValue: POD_KEY,
        readOnly: true,
        lockedDetail: { searchTokenUnavailableReason: NO_ATTRIBUTES },
      },
    ];

    expect(
      buildLockedEntityKeyChips({ rows: "traces", entityKeys: [POD_KEY] }),
    ).toStrictEqual(fallback);
    expect(
      buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY],
        displays: undefined,
      }),
    ).toStrictEqual(fallback);
    expect(
      buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY],
        displays: {},
      }),
    ).toStrictEqual(fallback);
  });

  test("a key the display map does not know falls back, even when the map names others", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "metrics",
      entityKeys: [NODE_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: POD_NAME,
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        },
      },
    });

    expect(pillTexts(chips)).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
    // The pod's attributes are the pod's: the unknown key is not spelled with them.
    expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
  });

  test("blank or whitespace display strings fall back field by field; padded ones are trimmed; none of it touches the reason", () => {
    const cases: Array<[LockedEntityKeyDisplayMap, string]> = [
      [
        { [POD_KEY]: { displayKey: "", displayValue: "" } },
        "Resource: 3f9a1b2c4d5e6f70",
      ],
      [
        { [POD_KEY]: { displayKey: "   ", displayValue: "\t\n" } },
        "Resource: 3f9a1b2c4d5e6f70",
      ],
      [
        { [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "  " } },
        "Kubernetes Pod: 3f9a1b2c4d5e6f70",
      ],
      [
        { [POD_KEY]: { displayKey: " ", displayValue: POD_NAME } },
        "Resource: checkout-7d9f",
      ],
      [
        {
          [POD_KEY]: {
            displayKey: "  Kubernetes Pod ",
            displayValue: `\t${POD_NAME}  `,
          },
        },
        "Kubernetes Pod: checkout-7d9f",
      ],
    ];

    for (const [displays, pill] of cases) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays,
      });

      expect(pillTexts(chips)).toEqual([pill]);
      expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
      expect(chips[0]!.value).toBe(POD_KEY);
    }
  });

  test("a display key of 'Resource' keeps the pill's word, and an exceptions chip still has no search syntax", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "exceptions",
      entityKeys: [POD_KEY],
      displays: {
        [POD_KEY]: { displayKey: "Resource", displayValue: POD_NAME },
      },
    });

    expect(pillTexts(chips)).toEqual(["Resource: checkout-7d9f"]);
    expect(lockedDetails(chips)).toStrictEqual([NO_SYNTAX_DETAIL]);
  });

  test("display entries of the wrong shape at runtime fall back rather than throw", () => {
    for (const entry of [
      null,
      undefined,
      "Kubernetes Pod",
      7,
      { displayKey: 42, displayValue: {} },
      [],
    ]) {
      const displays: LockedEntityKeyDisplayMap = {
        [POD_KEY]: entry as never,
      };

      for (const [rows, detail] of [
        ["profiles", NO_SYNTAX_DETAIL],
        ["logs", NO_ATTRIBUTES_DETAIL],
      ] as Array<[EntityKeyScopedRows, LockedFilterDetail]>) {
        const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
          rows,
          entityKeys: [POD_KEY],
          displays,
        });

        expect(pillTexts(chips)).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
        expect(lockedDetails(chips)).toStrictEqual([detail]);
      }
    }
  });

  test("only the map's OWN entries are read — an inherited entry never names a chip nor spells its search syntax", () => {
    const inherited: LockedEntityKeyDisplayMap = Object.create({
      [POD_KEY]: {
        displayKey: "Inherited",
        displayValue: "leak",
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      },
    }) as LockedEntityKeyDisplayMap;

    expect(POD_KEY in inherited).toBe(true);

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: inherited,
    });

    expect(pillTexts(chips)).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
    expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
  });

  test("an inherited entry under an Object.prototype member's name never names a chip nor spells its search syntax", () => {
    /*
     * Against a plain map these names fall back even WITHOUT the own-entry
     * rule — `constructor` and friends resolve to functions or
     * Object.prototype, none with display strings — so only a prototype that
     * really carries an entry under the name shows the rule at work.
     */
    for (const name of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      const displays: LockedEntityKeyDisplayMap = Object.create({
        [name]: {
          displayKey: "Leak",
          displayValue: "x",
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        },
      }) as LockedEntityKeyDisplayMap;

      // Not vacuous: a plain lookup finds the inherited entry.
      expect((displays as Record<string, unknown>)[name]).toEqual({
        displayKey: "Leak",
        displayValue: "x",
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      });

      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [name],
        displays,
      });

      expect(pillTexts(chips)).toEqual([`Resource: ${name}`]);
      expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
    }
  });

  test("own entries under those names ARE read, search attributes included, and a prototype-less map works", () => {
    // JSON.parse makes `__proto__` an own property, as an object literal cannot.
    const parsed: LockedEntityKeyDisplayMap = JSON.parse(
      '{"__proto__":{"displayKey":"Host","displayValue":"web-01","searchAttributes":{"host.name":"web-01"}},"constructor":{"displayKey":"Container","displayValue":"api"}}',
    ) as LockedEntityKeyDisplayMap;

    const parsedChips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: ["__proto__", "constructor"],
      displays: parsed,
    });

    expect(pillTexts(parsedChips)).toEqual(["Host: web-01", "Container: api"]);
    expect(lockedDetails(parsedChips)).toStrictEqual([
      { searchToken: "@resource.host.name:web-01" },
      NO_ATTRIBUTES_DETAIL,
    ]);

    const bare: LockedEntityKeyDisplayMap = Object.create(
      null,
    ) as LockedEntityKeyDisplayMap;
    bare[POD_KEY] = {
      displayKey: "Kubernetes Pod",
      displayValue: POD_NAME,
      searchAttributes: POD_SEARCH_ATTRIBUTES,
    };

    const bareChips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: bare,
    });

    expect(pillTexts(bareChips)).toEqual(["Kubernetes Pod: checkout-7d9f"]);
    expect(lockedDetails(bareChips)).toStrictEqual([POD_TOKEN_DETAIL]);
  });

  test("several keys: one chip each, in the page's order, each with the search syntax of its own entity alone", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY],
      displays: {
        ...POD_DISPLAYS,
        [NODE_KEY]: {
          displayKey: "Kubernetes Node",
          displayValue: "ip-10-0-1-7",
          searchAttributes: { "k8s.node.name": "ip-10-0-1-7" },
        },
      },
    });

    expect(
      chips.map(
        (chip: ActiveFilter): [string, string, string, string, boolean] => {
          return [
            chip.facetKey,
            chip.value,
            chip.displayKey,
            chip.displayValue,
            Boolean(chip.readOnly),
          ];
        },
      ),
    ).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
      ["entityKeys", NODE_KEY, "Kubernetes Node", "ip-10-0-1-7", true],
      ["entityKeys", CLUSTER_KEY, "Resource", CLUSTER_KEY, true],
    ]);

    /*
     * Only the node's entry names attributes, so only the node's chip has a
     * token — and it spells the node alone, not the page's whole scope.
     */
    expect(lockedDetails(chips)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      { searchToken: "@resource.k8s.node.name:ip-10-0-1-7" },
      NO_ATTRIBUTES_DETAIL,
    ]);
    expect(chips[1]!.lockedDetail).toStrictEqual(
      describeLockedEntityKeyFilter({
        rows: "logs",
        searchAttributes: { "k8s.node.name": "ip-10-0-1-7" },
      }),
    );
  });

  test("duplicate, padded and blank keys collapse to one chip per distinct key, valued by the trimmed key", () => {
    expect(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [` ${POD_KEY}`, "", POD_KEY, "  ", `${POD_KEY} `],
        displays: POD_DISPLAYS,
      }),
    ).toStrictEqual(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays: POD_DISPLAYS,
      }),
    );

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY, ` ${POD_KEY} `, NODE_KEY],
    });

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([POD_KEY, NODE_KEY]);
    expect(lockedDetails(chips)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
  });

  test("a chip's identity — facet and value — is unique for any input, so the chip bar never renders a pill twice", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "traces",
      entityKeys: [
        POD_KEY,
        ` ${POD_KEY}`,
        NODE_KEY,
        "",
        NODE_KEY,
        CLUSTER_KEY,
        `${CLUSTER_KEY}\n`,
      ],
    });
    const identities: Set<string> = new Set<string>(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.facetKey}|${chip.value}`;
      }),
    );

    expect(chips).toHaveLength(3);
    expect(identities.size).toBe(chips.length);
    expect(lockedDetails(chips)).toStrictEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
  });

  describe("skipEntityKeys", () => {
    test("a skipped key gets no chip, and lends the remaining chips none of its search attributes", () => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        displays: {
          [POD_KEY]: {
            displayKey: "Kubernetes Pod",
            displayValue: POD_NAME,
            searchAttributes: POD_SEARCH_ATTRIBUTES,
          },
        },
        skipEntityKeys: [POD_KEY],
      });

      expect(pillTexts(chips)).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({ rows: "traces" }),
      );
      expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
    });

    test("skip keys are trimmed like the scope's keys", () => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        skipEntityKeys: [` ${POD_KEY}\t`, ""],
      });

      expect(pillTexts(chips)).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
      expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
    });

    test("skipping a key the page does not pin, or nothing at all, changes nothing", () => {
      const unskipped: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        displays: POD_DISPLAYS,
      });

      expect(pillTexts(unskipped)).toEqual([
        "Kubernetes Pod: checkout-7d9f",
        "Resource: aaaaaaaaaaaaaaaa",
      ]);
      expect(lockedDetails(unskipped)).toStrictEqual([
        NO_ATTRIBUTES_DETAIL,
        NO_ATTRIBUTES_DETAIL,
      ]);

      for (const skipEntityKeys of [
        undefined,
        [],
        [CLUSTER_KEY],
        ["", "  "],
        POD_KEY as never,
      ]) {
        expect(
          buildLockedEntityKeyChips({
            rows: "traces",
            entityKeys: [POD_KEY, NODE_KEY],
            displays: POD_DISPLAYS,
            skipEntityKeys,
          }),
        ).toStrictEqual(unskipped);
      }
    });

    test("skipping every key leaves no chips", () => {
      expect(
        buildLockedEntityKeyChips({
          rows: "traces",
          entityKeys: [POD_KEY, NODE_KEY],
          skipEntityKeys: [NODE_KEY, POD_KEY],
        }),
      ).toEqual([]);
    });

    test("with the traces viewer's stored-query chips, each entity key renders exactly once", () => {
      /*
       * The case the option exists for: an incident's stored span query
       * already shows a "Resource: <key>" chip for a key the page pins too.
       */
      const spanScope: SpanQueryScope = buildSpanQueryScope({
        entityKeys: new Includes([POD_KEY]),
      });
      const storedChips: Array<SpanScopeChip> = spanScope.chips.filter(
        (chip: SpanScopeChip): boolean => {
          return chip.facetKey === ENTITY_KEYS_FACET_KEY;
        },
      );
      const pageChips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        skipEntityKeys: spanScope.entityKeys,
      });

      expect(storedChips).toHaveLength(1);
      expect(
        [...storedChips, ...pageChips].map(
          (chip: SpanScopeChip | ActiveFilter): string => {
            return `${chip.facetKey}|${chip.value}`;
          },
        ),
      ).toEqual([`entityKeys|${POD_KEY}`, `entityKeys|${NODE_KEY}`]);
      // The page's remaining chip is described like any other traces chip.
      expect(lockedDetails(pageChips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
    });
  });

  test("the fallback key is the same word the stored query's entity-key chip is seeded with", () => {
    const spanScope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: new Includes([POD_KEY]),
    });

    expect(DEFAULT_ENTITY_KEY_DISPLAY_KEY).toBe("Resource");
    expect(
      spanScope.chips
        .filter((chip: SpanScopeChip): boolean => {
          return chip.facetKey === ENTITY_KEYS_FACET_KEY;
        })
        .map((chip: SpanScopeChip): string => {
          return chip.displayKey;
        }),
    ).toEqual([DEFAULT_ENTITY_KEY_DISPLAY_KEY]);

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "traces",
      entityKeys: [POD_KEY],
    });

    expect(chips[0]!.displayKey).toBe(DEFAULT_ENTITY_KEY_DISPLAY_KEY);
    expect(lockedDetails(chips)).toStrictEqual([NO_ATTRIBUTES_DETAIL]);
  });

  /*
   * Per surface, the chip's detail without the entity's attributes and with
   * them: the explorers spell the attributes, the exceptions and profiles
   * lists have no search bar either way.
   */
  const DETAIL_BY_ROWS: Array<
    [EntityKeyScopedRows, LockedFilterDetail, LockedFilterDetail]
  > = [
    ["logs", NO_ATTRIBUTES_DETAIL, POD_TOKEN_DETAIL],
    ["traces", NO_ATTRIBUTES_DETAIL, POD_TOKEN_DETAIL],
    ["metrics", NO_ATTRIBUTES_DETAIL, POD_TOKEN_DETAIL],
    ["exceptions", NO_SYNTAX_DETAIL, NO_SYNTAX_DETAIL],
    ["profiles", NO_SYNTAX_DETAIL, NO_SYNTAX_DETAIL],
  ];

  test.each(DETAIL_BY_ROWS)(
    "%s: the chip carries that surface's search syntax, or its reason for having none",
    (
      rows: EntityKeyScopedRows,
      withoutAttributes: LockedFilterDetail,
      withAttributes: LockedFilterDetail,
    ) => {
      const unnamed: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [POD_KEY],
        displays: POD_DISPLAYS,
      });

      expect(unnamed).toHaveLength(1);
      expect(lockedDetails(unnamed)).toStrictEqual([withoutAttributes]);

      const named: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [POD_KEY],
        displays: {
          [POD_KEY]: {
            displayKey: "Kubernetes Pod",
            displayValue: POD_NAME,
            searchAttributes: POD_SEARCH_ATTRIBUTES,
          },
        },
      });

      expect(named).toHaveLength(1);
      expect(lockedDetails(named)).toStrictEqual([withAttributes]);
    },
  );

  test.each(ALL_ROWS)(
    "%s: named or not, a chip whose display gives no search attributes carries exactly the describer's detail for its rows",
    (rows: EntityKeyScopedRows) => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [` ${POD_KEY}`, NODE_KEY, POD_KEY],
        displays: POD_DISPLAYS,
      });
      const expected: LockedFilterDetail =
        rows === "exceptions" || rows === "profiles"
          ? NO_SYNTAX_DETAIL
          : NO_ATTRIBUTES_DETAIL;

      expect(chips).toHaveLength(2);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({ rows }),
      );
      expect(chips[1]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({ rows }),
      );
      expect(lockedDetails(chips)).toStrictEqual([expected, expected]);
    },
  );

  test("every chip is read-only, on the entityKeys facet, valued by its key, with no search token while the page names no search attributes", () => {
    for (const rows of ALL_ROWS) {
      for (const displays of [undefined, POD_DISPLAYS]) {
        for (const chip of buildLockedEntityKeyChips({
          rows,
          entityKeys: [POD_KEY, NODE_KEY],
          displays,
        })) {
          expect(Object.keys(chip).sort()).toEqual([
            "displayKey",
            "displayValue",
            "facetKey",
            "lockedDetail",
            "readOnly",
            "value",
          ]);
          expect(chip.facetKey).toBe(ENTITY_KEYS_FACET_KEY);
          expect(chip.readOnly).toBe(true);
          expect([POD_KEY, NODE_KEY]).toContain(chip.value);
          expect(chip.lockedDetail?.searchToken).toBeUndefined();
          expect(chip.lockedDetail?.searchTokenUnavailableReason).toBe(
            rows === "exceptions" || rows === "profiles"
              ? NO_SYNTAX
              : NO_ATTRIBUTES,
          );
          expect(chip.lockedDetail).toStrictEqual(
            rows === "exceptions" || rows === "profiles"
              ? NO_SYNTAX_DETAIL
              : NO_ATTRIBUTES_DETAIL,
          );
        }
      }
    }
  });

  test("the name is display only: the value — what the query reads — is always the key", () => {
    const chip: ActiveFilter = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    })[0]!;

    expect(chip.displayValue).toBe(POD_NAME);
    expect(chip.value).toBe(POD_KEY);
    expect(chip.facetKey).toBe("entityKeys");
    expect(chip.lockedDetail).toStrictEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("a display's search attributes reach its own chip's describer only, and change nothing on the pill", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [POD_KEY]: {
        displayKey: "Kubernetes Pod",
        displayValue: POD_NAME,
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      },
    };

    for (const rows of ALL_ROWS) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [POD_KEY, NODE_KEY],
        displays,
      });
      const hasSearchBar: boolean =
        rows !== "exceptions" && rows !== "profiles";

      expect(pillTexts(chips)).toEqual([
        "Kubernetes Pod: checkout-7d9f",
        "Resource: aaaaaaaaaaaaaaaa",
      ]);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows,
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        }),
      );
      // The neighbour the page did not name has nothing to be spelled with.
      expect(chips[1]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({ rows }),
      );
      expect(chips[1]!.lockedDetail?.searchToken).toBeUndefined();
      expect(lockedDetails(chips)).toStrictEqual(
        hasSearchBar
          ? [POD_TOKEN_DETAIL, NO_ATTRIBUTES_DETAIL]
          : [NO_SYNTAX_DETAIL, NO_SYNTAX_DETAIL],
      );
    }

    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(
        buildLockedEntityKeyChips({
          rows: signal,
          entityKeys: [POD_KEY],
          displays,
        })[0]!.lockedDetail,
      ).toStrictEqual(POD_TOKEN_DETAIL);
    }
  });

  test("no keys, no chips", () => {
    for (const entityKeys of [
      undefined,
      [],
      ["", "  "],
      POD_KEY as never,
      new Includes([POD_KEY]) as never,
    ]) {
      expect(
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys,
          displays: POD_DISPLAYS,
        }),
      ).toEqual([]);
    }
  });

  test("every call returns fresh chips", () => {
    const first: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    });
    const second: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    });

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]!.lockedDetail).not.toBe(second[0]!.lockedDetail);

    first[0]!.displayValue = "mutated";
    (
      first[0]!.lockedDetail as LockedFilterDetail
    ).searchTokenUnavailableReason = "mutated";

    expect(second[0]!.displayValue).toBe(POD_NAME);
    expect(second[0]!.lockedDetail?.searchTokenUnavailableReason).toBe(
      NO_ATTRIBUTES,
    );
    expect(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays: POD_DISPLAYS,
      })[0]!.lockedDetail,
    ).toStrictEqual(NO_ATTRIBUTES_DETAIL);
    expect(POD_DISPLAYS[POD_KEY]!.displayValue).toBe(POD_NAME);
  });

  test("reads, never writes, its inputs", () => {
    const entityKeys: ReadonlyArray<string> = Object.freeze([
      POD_KEY,
      NODE_KEY,
    ]);
    const skipEntityKeys: ReadonlyArray<string> = Object.freeze([CLUSTER_KEY]);
    const displays: LockedEntityKeyDisplayMap = Object.freeze({
      [POD_KEY]: Object.freeze({
        displayKey: "Kubernetes Pod",
        displayValue: POD_NAME,
        searchAttributes: Object.freeze({ ...POD_SEARCH_ATTRIBUTES }),
      }),
    }) as LockedEntityKeyDisplayMap;

    expect(() => {
      return buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys,
        displays,
        skipEntityKeys,
      });
    }).not.toThrow();

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys,
      displays,
      skipEntityKeys,
    });

    expect(pillTexts(chips)).toEqual([
      "Kubernetes Pod: checkout-7d9f",
      "Resource: aaaaaaaaaaaaaaaa",
    ]);
    expect(lockedDetails(chips)).toStrictEqual([
      POD_TOKEN_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
  });
});
