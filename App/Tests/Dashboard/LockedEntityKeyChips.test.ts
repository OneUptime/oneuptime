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
  getLockedEntityKeySearchAttributes,
  normalizeLockedEntityKeys,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
  LOCKED_FILTER_SOURCE_PAGE,
  LOCKED_FILTER_SOURCE_STORED_QUERY,
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
 *  - runtime garbage in the key list or the display map degrades to the
 *    fallback rather than throwing inside a viewer's memo.
 *
 * The wording of the explanation is pinned in LockedTelemetryScope.test.ts;
 * here it is checked against the describer called directly.
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

const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_NAME },
};

// The pod's identifying resource attributes, keys without `resource.`.
const POD_SEARCH_ATTRIBUTES: Record<string, string> = {
  "k8s.cluster.name": "prod",
  "k8s.namespace.name": "shop",
  "k8s.pod.name": POD_NAME,
};

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
  test("one read-only chip naming the entity, valued by its key, carrying its explanation", () => {
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
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "logs",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      },
    ]);
    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
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
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "traces",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
        }),
      },
    ];

    expect(
      buildLockedEntityKeyChips({ rows: "traces", entityKeys: [POD_KEY] })[0]!
        .lockedDetail?.summary,
    ).toBe("Only traces linked to this resource are shown.");

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
      displays: POD_DISPLAYS,
    });

    expect(pillTexts(chips)).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Only metrics linked to this resource are shown.",
    );
  });

  test("blank or whitespace display strings fall back field by field; padded ones are trimmed", () => {
    const cases: Array<[LockedEntityKeyDisplayMap, string, string]> = [
      [
        { [POD_KEY]: { displayKey: "", displayValue: "" } },
        "Resource: 3f9a1b2c4d5e6f70",
        "Only logs linked to this resource are shown.",
      ],
      [
        { [POD_KEY]: { displayKey: "   ", displayValue: "\t\n" } },
        "Resource: 3f9a1b2c4d5e6f70",
        "Only logs linked to this resource are shown.",
      ],
      [
        { [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "  " } },
        "Kubernetes Pod: 3f9a1b2c4d5e6f70",
        "Only logs linked to this Kubernetes Pod are shown.",
      ],
      [
        { [POD_KEY]: { displayKey: " ", displayValue: POD_NAME } },
        "Resource: checkout-7d9f",
        "Only logs linked to this resource are shown.",
      ],
      [
        {
          [POD_KEY]: {
            displayKey: "  Kubernetes Pod ",
            displayValue: `\t${POD_NAME}  `,
          },
        },
        "Kubernetes Pod: checkout-7d9f",
        "Only logs linked to this Kubernetes Pod are shown.",
      ],
    ];

    for (const [displays, pill, summary] of cases) {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [POD_KEY],
        displays,
      });

      expect(pillTexts(chips)).toEqual([pill]);
      expect(chips[0]!.lockedDetail?.summary).toBe(summary);
      expect(chips[0]!.value).toBe(POD_KEY);
    }
  });

  test("a display key of 'Resource' keeps the pill's word and the summary's generic noun", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "exceptions",
      entityKeys: [POD_KEY],
      displays: {
        [POD_KEY]: { displayKey: "Resource", displayValue: POD_NAME },
      },
    });

    expect(pillTexts(chips)).toEqual(["Resource: checkout-7d9f"]);
    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Only exceptions linked to this resource are shown.",
    );
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

      expect(
        pillTexts(
          buildLockedEntityKeyChips({
            rows: "profiles",
            entityKeys: [POD_KEY],
            displays,
          }),
        ),
      ).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
    }
  });

  test("only the map's OWN entries are read — an inherited entry never names a chip", () => {
    const inherited: LockedEntityKeyDisplayMap = Object.create({
      [POD_KEY]: { displayKey: "Inherited", displayValue: "leak" },
    }) as LockedEntityKeyDisplayMap;

    expect(POD_KEY in inherited).toBe(true);
    expect(
      pillTexts(
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: [POD_KEY],
          displays: inherited,
        }),
      ),
    ).toEqual(["Resource: 3f9a1b2c4d5e6f70"]);
  });

  test("an inherited entry under an Object.prototype member's name never names a chip", () => {
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
        [name]: { displayKey: "Leak", displayValue: "x" },
      }) as LockedEntityKeyDisplayMap;

      // Not vacuous: a plain lookup finds the inherited entry.
      expect((displays as Record<string, unknown>)[name]).toEqual({
        displayKey: "Leak",
        displayValue: "x",
      });

      expect(
        pillTexts(
          buildLockedEntityKeyChips({
            rows: "logs",
            entityKeys: [name],
            displays,
          }),
        ),
      ).toEqual([`Resource: ${name}`]);
    }
  });

  test("own entries under those names ARE read, and a prototype-less map works", () => {
    // JSON.parse makes `__proto__` an own property, as an object literal cannot.
    const parsed: LockedEntityKeyDisplayMap = JSON.parse(
      '{"__proto__":{"displayKey":"Host","displayValue":"web-01"},"constructor":{"displayKey":"Container","displayValue":"api"}}',
    ) as LockedEntityKeyDisplayMap;

    expect(
      pillTexts(
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: ["__proto__", "constructor"],
          displays: parsed,
        }),
      ),
    ).toEqual(["Host: web-01", "Container: api"]);

    const bare: LockedEntityKeyDisplayMap = Object.create(
      null,
    ) as LockedEntityKeyDisplayMap;
    bare[POD_KEY] = { displayKey: "Kubernetes Pod", displayValue: POD_NAME };

    expect(
      pillTexts(
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: [POD_KEY],
          displays: bare,
        }),
      ),
    ).toEqual(["Kubernetes Pod: checkout-7d9f"]);
  });

  test("several keys: one chip each, in the page's order, each saying the scope widens", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY],
      displays: {
        ...POD_DISPLAYS,
        [NODE_KEY]: {
          displayKey: "Kubernetes Node",
          displayValue: "ip-10-0-1-7",
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

    // Each chip is described from its own key and label, told of all three.
    const labels: Array<string | undefined> = [
      "Kubernetes Pod",
      "Kubernetes Node",
      undefined,
    ];

    for (let index: number = 0; index < chips.length; index++) {
      expect(chips[index]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows: "logs",
          entityKey: chips[index]!.value,
          entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY],
          entityTypeLabel: labels[index],
        }),
      );
    }

    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 2 other resources this page pins.",
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
    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
    );
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
  });

  describe("skipEntityKeys", () => {
    test("a skipped key gets no chip; the others still count it, because the page's hasAny still includes it", () => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        skipEntityKeys: [POD_KEY],
      });

      expect(pillTexts(chips)).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows: "traces",
          entityKey: NODE_KEY,
          entityKeys: [POD_KEY, NODE_KEY],
        }),
      );
      expect(chips[0]!.lockedDetail?.summary).toBe(
        "Traces linked to this resource are shown, along with traces linked to the 1 other resource this page pins.",
      );
    });

    test("skip keys are trimmed like the scope's keys", () => {
      expect(
        pillTexts(
          buildLockedEntityKeyChips({
            rows: "traces",
            entityKeys: [POD_KEY, NODE_KEY],
            skipEntityKeys: [` ${POD_KEY}\t`, ""],
          }),
        ),
      ).toEqual(["Resource: aaaaaaaaaaaaaaaa"]);
    });

    test("skipping a key the page does not pin, or nothing at all, changes nothing", () => {
      const unskipped: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows: "traces",
        entityKeys: [POD_KEY, NODE_KEY],
        displays: POD_DISPLAYS,
      });

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
    expect(
      buildLockedEntityKeyChips({ rows: "traces", entityKeys: [POD_KEY] })[0]!
        .displayKey,
    ).toBe(DEFAULT_ENTITY_KEY_DISPLAY_KEY);
  });

  const SUMMARY_BY_ROWS: Array<[EntityKeyScopedRows, string, string]> = [
    [
      "logs",
      "Only logs linked to this Kubernetes Pod are shown.",
      NO_ATTRIBUTES,
    ],
    [
      "traces",
      "Only traces linked to this Kubernetes Pod are shown.",
      NO_ATTRIBUTES,
    ],
    [
      "metrics",
      "Only metrics linked to this Kubernetes Pod are shown.",
      NO_ATTRIBUTES,
    ],
    [
      "exceptions",
      "Only exceptions linked to this Kubernetes Pod are shown.",
      NO_SYNTAX,
    ],
    [
      "profiles",
      "Only profiles linked to this Kubernetes Pod are shown.",
      NO_SYNTAX,
    ],
  ];

  test.each(SUMMARY_BY_ROWS)(
    "%s: the chip explains itself in that surface's words",
    (rows: EntityKeyScopedRows, summary: string, reason: string) => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [POD_KEY],
        displays: POD_DISPLAYS,
      });

      expect(chips).toHaveLength(1);
      expect(chips[0]!.lockedDetail?.summary).toBe(summary);
      expect(chips[0]!.lockedDetail?.searchTokenUnavailableReason).toBe(reason);
    },
  );

  test.each(ALL_ROWS)(
    "%s: every chip's detail is exactly what the describer returns for that key, the page's keys and the chip's own label",
    (rows: EntityKeyScopedRows) => {
      const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
        rows,
        entityKeys: [` ${POD_KEY}`, NODE_KEY, POD_KEY],
        displays: POD_DISPLAYS,
      });

      expect(chips).toHaveLength(2);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows,
          entityKey: POD_KEY,
          entityKeys: [POD_KEY, NODE_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      );
      expect(chips[1]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows,
          entityKey: NODE_KEY,
          entityKeys: [POD_KEY, NODE_KEY],
        }),
      );
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
  });

  test("the source is forwarded, so keys a stored query pinned never claim the page pinned them", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS,
      source: LOCKED_FILTER_SOURCE_STORED_QUERY,
    });

    expect(chips).toHaveLength(2);

    for (const chip of chips) {
      expect(chip.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows: "logs",
          entityKey: chip.value,
          entityKeys: [POD_KEY, NODE_KEY],
          entityTypeLabel:
            chip.value === POD_KEY ? "Kubernetes Pod" : undefined,
          source: LOCKED_FILTER_SOURCE_STORED_QUERY,
        }),
      );
      expect(chip.lockedDetail?.source).toBe(LOCKED_FILTER_SOURCE_STORED_QUERY);
      expect(chip.lockedDetail?.summary).not.toContain("this page");
    }

    // Left out, the page is the source — an Inventory item's pages.
    expect(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] })[0]!
        .lockedDetail?.source,
    ).toBe(LOCKED_FILTER_SOURCE_PAGE);
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

      expect(pillTexts(chips)).toEqual([
        "Kubernetes Pod: checkout-7d9f",
        "Resource: aaaaaaaaaaaaaaaa",
      ]);
      expect(chips[0]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows,
          entityKey: POD_KEY,
          entityKeys: [POD_KEY, NODE_KEY],
          entityTypeLabel: "Kubernetes Pod",
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        }),
      );
      // The neighbour the page did not name has nothing to be spelled with.
      expect(chips[1]!.lockedDetail).toStrictEqual(
        describeLockedEntityKeyFilter({
          rows,
          entityKey: NODE_KEY,
          entityKeys: [POD_KEY, NODE_KEY],
        }),
      );
      expect(chips[1]!.lockedDetail?.searchToken).toBeUndefined();
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
        })[0]!.lockedDetail?.searchToken,
      ).toBe(
        "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
      );
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
    (first[0]!.lockedDetail as LockedFilterDetail).summary = "mutated";

    expect(second[0]!.displayValue).toBe(POD_NAME);
    expect(second[0]!.lockedDetail?.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
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
    expect(
      pillTexts(
        buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys,
          displays,
          skipEntityKeys,
        }),
      ),
    ).toEqual(["Kubernetes Pod: checkout-7d9f", "Resource: aaaaaaaaaaaaaaaa"]);
  });
});

describe("getLockedEntityKeySearchAttributes", () => {
  test("hands back the attributes of the key's own entry, by the same lookup the chip builder uses", () => {
    const displays: LockedEntityKeyDisplayMap = {
      [POD_KEY]: {
        displayKey: "Kubernetes Pod",
        displayValue: POD_NAME,
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      },
    };

    expect(getLockedEntityKeySearchAttributes(displays, POD_KEY)).toBe(
      POD_SEARCH_ATTRIBUTES,
    );
  });

  test("no map, an unknown key, an entry without attributes or an inherited entry is undefined", () => {
    const inherited: LockedEntityKeyDisplayMap = Object.create({
      [POD_KEY]: {
        displayKey: "Inherited",
        displayValue: "leak",
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      },
    }) as LockedEntityKeyDisplayMap;

    expect(
      getLockedEntityKeySearchAttributes(undefined, POD_KEY),
    ).toBeUndefined();
    expect(getLockedEntityKeySearchAttributes({}, POD_KEY)).toBeUndefined();
    expect(
      getLockedEntityKeySearchAttributes(POD_DISPLAYS, NODE_KEY),
    ).toBeUndefined();
    expect(
      getLockedEntityKeySearchAttributes(POD_DISPLAYS, POD_KEY),
    ).toBeUndefined();
    expect(
      getLockedEntityKeySearchAttributes(inherited, POD_KEY),
    ).toBeUndefined();
    expect(
      getLockedEntityKeySearchAttributes(POD_DISPLAYS, "constructor"),
    ).toBeUndefined();
  });
});
