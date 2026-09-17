import { describe, expect, test } from "@jest/globals";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import type { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import {
  buildSearchTokenValue,
  parseSearchValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import type { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import type {
  DescribeLockedAttributeFilterInput,
  DescribeLockedEntityKeyFilterInput,
  EntityKeyScopedRows,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
/*
 * A STATIC namespace import, on purpose: this module must stay importable
 * from plain Node without a browser stub, because the chip builders of all
 * three viewers import it and their suites run renderer-free. If a future
 * change drags RouteMap / Navigation / Common/UI/Config into it, this file
 * fails at load with "window is not defined" — which is the point.
 */
import * as Scope from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The renderer-free half of the locked chip tooltip: per locked chip, the
 * search syntax that reproduces it on the main explorer, or the reason there
 * is none. The chip component only renders what these describers return —
 * the token with a Copy button, or the reason in its place — so every token
 * and every reason is pinned here exactly.
 */

/*
 * The reasons the module keeps private, pinned verbatim: a tooltip shows
 * them word for word just like the exported ones.
 */
const UNSAFE_KEY_REASON: string =
  "This attribute key cannot be typed into the search bar.";
const OPERATOR_REASON: string =
  "This operator filter cannot be spelled in the search bar.";
const EMPTY_VALUE_REASON: string = "This filter has no value to copy.";
const METRICS_SESSION_REASON: string = "Sessions are not a metrics dimension.";

describe("the reasons a chip has no search syntax", () => {
  test("are pinned verbatim, and none sends the reader anywhere but the search bar", () => {
    /*
     * The tooltip shows the reason in place of a token, so it is the whole
     * of what a reader learns about a filter they cannot paste.
     */
    const reasons: Array<[string, string]> = [
      [Scope.NO_SEARCH_SYNTAX_REASON, "This filter has no search syntax."],
      [
        Scope.SESSION_NO_SYNTAX_REASON,
        "Session filters have no search syntax.",
      ],
      [
        Scope.METRICS_SERVICE_NO_SYNTAX_REASON,
        "The Metrics search bar matches services by name, not by id.",
      ],
      [
        Scope.ENTITY_KEY_NO_ATTRIBUTES_REASON,
        "This resource has no telemetry attributes to search by.",
      ],
      [Scope.ENTITY_KEY_NO_SYNTAX_REASON, "Entity keys have no search syntax."],
    ];

    for (const [reason, words] of reasons) {
      expect(reason).toBe(words);
    }

    for (const reason of [
      ...reasons.map(([exported]: [string, string]): string => {
        return exported;
      }),
      UNSAFE_KEY_REASON,
      OPERATOR_REASON,
      EMPTY_VALUE_REASON,
      METRICS_SESSION_REASON,
    ]) {
      expect(reason).not.toContain("Open in");
      expect(reason).not.toContain("explorer");
    }
  });
});

describe("describeLockedAttributeFilter", () => {
  function clusterChip(
    overrides: Partial<DescribeLockedAttributeFilterInput> = {},
  ): LockedFilterDetail {
    return Scope.describeLockedAttributeFilter({
      signal: "logs",
      attributeKey: "resource.k8s.cluster.name",
      rawValue: "prod-eks-01",
      ...overrides,
    });
  }

  test("a plain attribute scope: an @key:value token and no reason", () => {
    const detail: LockedFilterDetail = clusterChip();

    expect(detail).toStrictEqual({
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        detail,
        "searchTokenUnavailableReason",
      ),
    ).toBe(false);
  });

  test("the token is the same in every viewer, because every explorer has @ tokens", () => {
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(clusterChip({ signal })).toStrictEqual({
        searchToken: "@resource.k8s.cluster.name:prod-eks-01",
      });
    }
  });

  test("every attribute a page scopes by — resource, device or plain — is spelled with its own key", () => {
    const attributeKeys: Array<string> = [
      "resource.k8s.cluster.name",
      "resource.k8s.pod.name",
      "resource.host.name",
      "resource.container.runtime",
      "resource.faas.name",
      "resource.cloud.platform",
      "resource.ceph.cluster.name",
      "resource.docker.swarm.cluster.name",
      "resource.vmware.vcenter.name",
      "resource.iot.fleet.name",
      "resource.service.name",
      "networkDevice.id",
      "http.method",
      // A key that happens to name an Object.prototype member is just a key.
      "toString",
    ];

    for (const attributeKey of attributeKeys) {
      expect(clusterChip({ attributeKey })).toStrictEqual({
        searchToken: `@${attributeKey}:prod-eks-01`,
      });
    }

    // A key no resource page scopes by is spelled exactly the same way.
    expect(
      clusterChip({ attributeKey: "http.method", rawValue: "GET" }),
    ).toStrictEqual({ searchToken: "@http.method:GET" });
  });

  test("the token reproduces the attribute alone, whatever else the page scopes by", () => {
    /*
     * A Kubernetes cluster page's query also narrows by entity key
     * (`hasAny(entityKeys) OR attribute = value`). That clause is AND-ed with
     * the attribute, so it can never admit a row the attribute rejects: the
     * attribute's token alone reproduces the list on the main explorer, for a
     * scalar and for an operator value alike. That is why the describer is
     * handed only the attribute.
     */
    expect(clusterChip()).toStrictEqual({
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    });
    expect(
      clusterChip({ rawValue: new Includes(["prod-eks-01", "prod-eks-02"]) }),
    ).toStrictEqual({
      searchToken: "@resource.k8s.cluster.name:(prod-eks-01 OR prod-eks-02)",
    });
    // A chip for another attribute on the same page is spelled with its own.
    expect(
      clusterChip({
        attributeKey: "resource.container.runtime",
        rawValue: "docker",
      }),
    ).toStrictEqual({ searchToken: "@resource.container.runtime:docker" });
  });

  test("numbers and booleans are copied as-is", () => {
    expect(
      clusterChip({ attributeKey: "http.status_code", rawValue: 500 }),
    ).toStrictEqual({ searchToken: "@http.status_code:500" });

    expect(
      clusterChip({ attributeKey: "feature.enabled", rawValue: true }),
    ).toStrictEqual({ searchToken: "@feature.enabled:true" });

    expect(
      clusterChip({ attributeKey: "feature.enabled", rawValue: false }),
    ).toStrictEqual({ searchToken: "@feature.enabled:false" });
  });

  test("a value with grammar characters is escaped so the token means the literal", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "http.route",
      rawValue: "/api/*",
    });

    expect(detail).toStrictEqual({
      searchToken: `@http.route:${buildSearchTokenValue("/api/*")}`,
    });

    const tokenValue: string = detail.searchToken!.substring(
      "@http.route:".length,
    );
    expect(parseSearchValue(tokenValue).value).toBe("/api/*");
  });

  test("a value with spaces is quoted in the token", () => {
    expect(
      clusterChip({ attributeKey: "resource.host.name", rawValue: "web 01" }),
    ).toStrictEqual({ searchToken: '@resource.host.name:"web 01"' });
  });

  test("operator filters are spelled in the grammar", () => {
    /*
     * Every operator the attribute filter form offers has a spelling the
     * explorer compiles to the same filter (the round trips are pinned in
     * Common/Tests/Utils/Telemetry/LockedFilterSearch.test.ts); the tooltip
     * offers it, a negated one with the `-` on the token.
     */
    expect(
      clusterChip({
        attributeKey: "k8s.namespace.name",
        rawValue: new Includes(["payments", "checkout"]),
      }),
    ).toStrictEqual({
      searchToken: "@k8s.namespace.name:(payments OR checkout)",
    });

    expect(
      clusterChip({
        attributeKey: "url.path",
        rawValue: new Search("/checkout"),
      }),
    ).toStrictEqual({ searchToken: "@url.path:~/checkout" });

    expect(
      clusterChip({
        attributeKey: "severity",
        rawValue: new NotEqual("debug"),
      }),
    ).toStrictEqual({ searchToken: "@severity:!debug" });

    expect(
      clusterChip({ attributeKey: "user.id", rawValue: new IsNull() }),
    ).toStrictEqual({ searchToken: "-@user.id:*" });
  });

  test("an operator shape the grammar cannot spell has no syntax, and says why", () => {
    // Several operators AND-ed on one key: the grammar has one value per key.
    expect(
      clusterChip({
        attributeKey: "url.path",
        rawValue: [new Search("/api"), new NotEqual("/api/health")] as never,
      }),
    ).toStrictEqual({ searchTokenUnavailableReason: OPERATOR_REASON });

    // A list entry the list grammar would split in two.
    expect(
      clusterChip({
        attributeKey: "k8s.namespace.name",
        rawValue: new Includes(["a,b", "c"]),
      }),
    ).toStrictEqual({ searchTokenUnavailableReason: OPERATOR_REASON });
  });

  test("a key the search bar cannot spell has no syntax and says why, for scalars and operators alike", () => {
    for (const attributeKey of [
      "weird key",
      "a:b",
      'say"what',
      "@x",
      "-x",
      "",
    ]) {
      expect(clusterChip({ attributeKey, rawValue: "x" })).toStrictEqual({
        searchTokenUnavailableReason: UNSAFE_KEY_REASON,
      });
      expect(
        clusterChip({ attributeKey, rawValue: new Includes(["a", "b"]) }),
      ).toStrictEqual({ searchTokenUnavailableReason: UNSAFE_KEY_REASON });
    }
  });

  test("an empty value has no syntax and says why — never an empty token", () => {
    const detail: LockedFilterDetail = clusterChip({ rawValue: "" });

    expect(detail).toStrictEqual({
      searchTokenUnavailableReason: EMPTY_VALUE_REASON,
    });
    expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
      false,
    );
  });
});

describe("describeLockedAttributeFilter on every signal", () => {
  /*
   * All three explorers spell an attribute with the same `@` grammar, so an
   * attribute chip's tooltip must not depend on which viewer it sits in. The
   * cases above run on logs; these pin the operator values, the unsafe keys
   * and the empty value on traces and metrics too, token for token and
   * reason for reason.
   */
  const SIGNALS: Array<TelemetrySignal> = ["logs", "traces", "metrics"];
  const KEY: string = "resource.k8s.cluster.name";

  const OPERATOR_TOKENS: Array<[string, DictionaryEntryValue, string]> = [
    ["EqualTo", new EqualTo("x"), `@${KEY}:x`],
    ["NotEqual", new NotEqual("debug"), `@${KEY}:!debug`],
    ["Search", new Search("/checkout"), `@${KEY}:~/checkout`],
    ["Search with a space", new Search("a b"), `@${KEY}:~"a b"`],
    ["NotContains", new NotContains("x"), `-@${KEY}:~x`],
    ["StartsWith", new StartsWith("api"), `@${KEY}:api*`],
    ["StartsWith with a literal *", new StartsWith("a*b"), `@${KEY}:a\\*b*`],
    ["EndsWith", new EndsWith(".internal"), `@${KEY}:*.internal`],
    ["Wildcard", new Wildcard(["api-*"]), `@${KEY}:api-*`],
    [
      "Wildcard with two globs",
      new Wildcard(["api-*", "web-?"]),
      `@${KEY}:(api-* OR web-?)`,
    ],
    ["NotWildcard", new NotWildcard(["tmp-*"]), `-@${KEY}:tmp-*`],
    [
      "Includes",
      new Includes(["payments", "checkout"]),
      `@${KEY}:(payments OR checkout)`,
    ],
    ["Includes with one entry", new Includes(["payments"]), `@${KEY}:payments`],
    [
      "Includes with a spaced entry",
      new Includes(["a b", "c"]),
      `@${KEY}:("a b" OR c)`,
    ],
    ["IncludesNone", new IncludesNone(["x", "y"]), `-@${KEY}:(x OR y)`],
    ["IsNull", new IsNull(), `-@${KEY}:*`],
    ["NotNull", new NotNull(), `@${KEY}:*`],
    ["GreaterThan", new GreaterThan(500), `@${KEY}:>500`],
    ["GreaterThanOrEqual", new GreaterThanOrEqual(5), `@${KEY}:>=5`],
    ["LessThan", new LessThan(3), `@${KEY}:<3`],
    ["LessThanOrEqual", new LessThanOrEqual(10), `@${KEY}:<=10`],
  ];

  const UNSPELLABLE_OPERATORS: Array<[string, DictionaryEntryValue]> = [
    ["Includes with a comma entry", new Includes(["a,b", "c"])],
    ["Includes with an OR entry", new Includes(["a OR b", "c"])],
    ["an empty Includes", new Includes([])],
    ["IncludesNone with a comma entry", new IncludesNone(["x,y", "z"])],
    ["an empty Search", new Search("")],
    [
      "several operators on one key",
      [new Search("a"), new NotEqual("b")] as never,
    ],
  ];

  test.each(SIGNALS)(
    "%s: every operator the grammar can spell gets its token and no reason",
    (signal: TelemetrySignal) => {
      for (const [, rawValue, searchToken] of OPERATOR_TOKENS) {
        expect(
          Scope.describeLockedAttributeFilter({
            signal,
            attributeKey: KEY,
            rawValue,
          }),
        ).toStrictEqual({ searchToken });
      }
    },
  );

  test.each(SIGNALS)(
    "%s: an operator shape the grammar cannot spell gets the operator reason and no token",
    (signal: TelemetrySignal) => {
      for (const [, rawValue] of UNSPELLABLE_OPERATORS) {
        expect(
          Scope.describeLockedAttributeFilter({
            signal,
            attributeKey: KEY,
            rawValue,
          }),
        ).toStrictEqual({ searchTokenUnavailableReason: OPERATOR_REASON });
      }
    },
  );

  test.each(SIGNALS)(
    "%s: a scalar is spelled with its value, escaped or quoted where the grammar needs it",
    (signal: TelemetrySignal) => {
      const cases: Array<[string | number | boolean, string]> = [
        ["prod-eks-01", `@${KEY}:prod-eks-01`],
        ["web 01", `@${KEY}:"web 01"`],
        ["/api/*", `@${KEY}:/api/\\*`],
        [42, `@${KEY}:42`],
        [0, `@${KEY}:0`],
        [true, `@${KEY}:true`],
        [false, `@${KEY}:false`],
      ];

      for (const [rawValue, searchToken] of cases) {
        expect(
          Scope.describeLockedAttributeFilter({
            signal,
            attributeKey: KEY,
            rawValue,
          }),
        ).toStrictEqual({ searchToken });
      }
    },
  );

  test.each(SIGNALS)(
    "%s: a key the search bar cannot type gets the unsafe-key reason, for a scalar and an operator alike",
    (signal: TelemetrySignal) => {
      for (const attributeKey of [
        "a b",
        "a\tb",
        "a:b",
        'a"b',
        "@key",
        "-key",
      ]) {
        for (const rawValue of [
          "x",
          new Includes(["a", "b"]),
          new IsNull(),
        ] as Array<DictionaryEntryValue>) {
          expect(
            Scope.describeLockedAttributeFilter({
              signal,
              attributeKey,
              rawValue,
            }),
          ).toStrictEqual({ searchTokenUnavailableReason: UNSAFE_KEY_REASON });
        }
      }
    },
  );

  test.each(SIGNALS)(
    "%s: an empty value gets the empty-value reason — never an empty token",
    (signal: TelemetrySignal) => {
      const detail: LockedFilterDetail = Scope.describeLockedAttributeFilter({
        signal,
        attributeKey: KEY,
        rawValue: "",
      });

      expect(detail).toStrictEqual({
        searchTokenUnavailableReason: EMPTY_VALUE_REASON,
      });
      expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
        false,
      );
    },
  );
});

describe("describeLockedEntityFilter", () => {
  const RUM_ID: string = "651a000000000000000000aa";

  test("logs and traces: a service: token carrying the id", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedEntityFilter({ signal, id: RUM_ID }),
      ).toStrictEqual({ searchToken: `service:${RUM_ID}` });
    }
  });

  test("metrics: no token, because that search bar matches services by name", () => {
    expect(
      Scope.describeLockedEntityFilter({ signal: "metrics", id: RUM_ID }),
    ).toStrictEqual({
      searchTokenUnavailableReason: Scope.METRICS_SERVICE_NO_SYNTAX_REASON,
    });
  });

  test("an empty id has no token: no value on logs and traces, still the service reason on metrics", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedEntityFilter({ signal, id: "" }),
      ).toStrictEqual({ searchTokenUnavailableReason: EMPTY_VALUE_REASON });
    }

    expect(
      Scope.describeLockedEntityFilter({ signal: "metrics", id: "" }),
    ).toStrictEqual({
      searchTokenUnavailableReason: Scope.METRICS_SERVICE_NO_SYNTAX_REASON,
    });
  });
});

describe("describeLockedTraceFilter / describeLockedSpanFilter", () => {
  test("a trace: token on logs and traces", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedTraceFilter({ signal, traceId: "abc123" }),
      ).toStrictEqual({ searchToken: "trace:abc123" });
    }
  });

  test("a span: token on logs and traces", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedSpanFilter({ signal, spanId: "span-9" }),
      ).toStrictEqual({ searchToken: "span:span-9" });
    }
  });

  test("metrics has neither token, and says the filter has no search syntax", () => {
    expect(
      Scope.describeLockedTraceFilter({ signal: "metrics", traceId: "abc123" }),
    ).toStrictEqual({
      searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
    });

    expect(
      Scope.describeLockedSpanFilter({ signal: "metrics", spanId: "span-9" }),
    ).toStrictEqual({
      searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
    });
  });

  test("an empty id has no token on any signal", () => {
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedTraceFilter({ signal, traceId: "" }),
      ).toStrictEqual({
        searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
      });
      expect(
        Scope.describeLockedSpanFilter({ signal, spanId: "" }),
      ).toStrictEqual({
        searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
      });
    }
  });
});

describe("describeLockedSessionFilter", () => {
  test("logs / traces: no syntax, and says so", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      expect(Scope.describeLockedSessionFilter({ signal })).toStrictEqual({
        searchTokenUnavailableReason: Scope.SESSION_NO_SYNTAX_REASON,
      });
    }
  });

  test("metrics: sessions are not a dimension at all", () => {
    expect(
      Scope.describeLockedSessionFilter({ signal: "metrics" }),
    ).toStrictEqual({ searchTokenUnavailableReason: METRICS_SESSION_REASON });
  });
});

describe("describeLockedStoredQueryFilter", () => {
  test("an attribute chip gets its @ token", () => {
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "attributes.http.method",
        value: "GET",
      }),
    ).toStrictEqual({ searchToken: "@http.method:GET" });
  });

  test("a column chip is spelled with the column's field token", () => {
    const cases: Array<[string, string, string]> = [
      ["statusCode", "2", "status:2"],
      ["kind", "SPAN_KIND_SERVER", "kind:SPAN_KIND_SERVER"],
      ["hasException", "true", "hasexception:true"],
      // A single `name:` token is a substring match, as the stored query is.
      ["name", "checkout", "name:checkout"],
      ["statusMessage", "boom", "statusmessage:boom"],
    ];

    for (const [facetKey, value, searchToken] of cases) {
      expect(
        Scope.describeLockedStoredQueryFilter({
          signal: "traces",
          facetKey,
          value,
        }),
      ).toStrictEqual({ searchToken });
    }
  });

  test("an entityKeys chip has no search syntax on any explorer", () => {
    /*
     * A stored query holds only the key, never the resource attributes the
     * key was hashed from, and no explorer's grammar has an entity-key token.
     */
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedStoredQueryFilter({
          signal,
          facetKey: Scope.ENTITY_KEYS_FACET_KEY,
          value: "3f9a1b2c4d5e6f70",
        }),
      ).toStrictEqual({
        searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
      });
    }
  });

  test("trace, span and service chips get their field tokens", () => {
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "traceId",
        value: "t-1",
      }),
    ).toStrictEqual({ searchToken: "trace:t-1" });
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "spanId",
        value: "s-1",
      }),
    ).toStrictEqual({ searchToken: "span:s-1" });
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "primaryEntityId",
        value: "651a000000000000000000aa",
      }),
    ).toStrictEqual({ searchToken: "service:651a000000000000000000aa" });
  });

  test("a column the signal's grammar has no token for, or an empty value, gets the generic reason — never an empty token", () => {
    // Span columns exist only on the traces explorer.
    for (const signal of ["logs", "metrics"] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedStoredQueryFilter({
          signal,
          facetKey: "statusCode",
          value: "2",
        }),
      ).toStrictEqual({
        searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
      });
    }

    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "statusCode",
        value: "",
      }),
    ).toStrictEqual({
      searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
    });
  });

  test("an attribute chip is spelled the same on every signal, and one it cannot spell gets the generic reason — not the page chip's key or value reasons", () => {
    /*
     * A stored-query chip is described from its column and value alone, so
     * an unsafe key or an empty value falls through to the generic reason
     * rather than the more specific ones a page-pinned attribute chip gives.
     */
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(
        Scope.describeLockedStoredQueryFilter({
          signal,
          facetKey: "attributes.resource.k8s.cluster.name",
          value: "prod-eks-01",
        }),
      ).toStrictEqual({
        searchToken: "@resource.k8s.cluster.name:prod-eks-01",
      });

      expect(
        Scope.describeLockedStoredQueryFilter({
          signal,
          facetKey: "attributes.x",
          value: "v 1",
        }),
      ).toStrictEqual({ searchToken: '@x:"v 1"' });

      for (const [facetKey, value] of [
        ["attributes.weird key", "x"],
        ["attributes.a:b", "x"],
        ["attributes.", "x"],
        ["attributes.http.method", ""],
      ] as Array<[string, string]>) {
        expect(
          Scope.describeLockedStoredQueryFilter({ signal, facetKey, value }),
        ).toStrictEqual({
          searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
        });
      }
    }
  });

  test("a traces column with no field token gets the generic reason", () => {
    for (const facetKey of [
      "sessionId",
      "severityText",
      "body",
      "attributeSearches.http.url",
      "notAColumn",
    ]) {
      expect(
        Scope.describeLockedStoredQueryFilter({
          signal: "traces",
          facetKey,
          value: "x",
        }),
      ).toStrictEqual({
        searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
      });
    }
  });
});

describe("describeLockedEntityKeyFilter", () => {
  /*
   * An Inventory item's scope: `hasAny(entityKeys, [item key])` with no
   * attribute alongside, on Logs / Traces / Metrics and on the Exceptions and
   * Profiles lists. No grammar has an entity-key token, so the chip's syntax
   * is spelled with the entity's identifying resource attributes, or the
   * tooltip says why there is none.
   */
  const POD_KEY: string = "3f9a1b2c4d5e6f70";
  const NO_ATTRIBUTES: string = Scope.ENTITY_KEY_NO_ATTRIBUTES_REASON;
  const NO_SYNTAX: string = Scope.ENTITY_KEY_NO_SYNTAX_REASON;

  /*
   * A pod's identifying resource attributes, keys without the `resource.`
   * prefix and deliberately out of order: the token lists them sorted.
   */
  const POD_SEARCH_ATTRIBUTES: Record<string, string> = {
    "k8s.pod.name": "checkout-7d9f",
    "k8s.cluster.name": "prod",
    "k8s.namespace.name": "shop",
  };
  const POD_SEARCH_TOKEN: string =
    "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

  const NODE_SEARCH_ATTRIBUTES: Record<string, string> = {
    "k8s.node.name": "node-a",
    "k8s.cluster.name": "prod",
  };
  const NODE_SEARCH_TOKEN: string =
    "@resource.k8s.cluster.name:prod @resource.k8s.node.name:node-a";

  function entityKeyChip(
    overrides: Partial<DescribeLockedEntityKeyFilterInput> = {},
  ): LockedFilterDetail {
    return Scope.describeLockedEntityKeyFilter({
      rows: "logs",
      ...overrides,
    });
  }

  test("the vocabulary the viewers share", () => {
    expect(Scope.ENTITY_KEYS_FACET_KEY).toBe("entityKeys");
    expect(Scope.DEFAULT_ENTITY_KEY_DISPLAY_KEY).toBe("Resource");
    expect(Scope.RESOURCE_ATTRIBUTE_PREFIX).toBe("resource.");
  });

  const NO_ATTRIBUTE_CASES: Array<[EntityKeyScopedRows, string]> = [
    ["logs", NO_ATTRIBUTES],
    ["traces", NO_ATTRIBUTES],
    ["metrics", NO_ATTRIBUTES],
    ["exceptions", NO_SYNTAX],
    ["profiles", NO_SYNTAX],
  ];

  test.each(NO_ATTRIBUTE_CASES)(
    "%s without search attributes: no search token, and why",
    (rows: EntityKeyScopedRows, reason: string) => {
      const detail: LockedFilterDetail = entityKeyChip({ rows });

      expect(detail).toStrictEqual({ searchTokenUnavailableReason: reason });
      expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
        false,
      );
    },
  );

  test("telemetry rows with no search attributes — absent or empty — are told the resource has none to search by", () => {
    const missing: Array<Record<string, string> | undefined> = [undefined, {}];

    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      for (const searchAttributes of missing) {
        expect(entityKeyChip({ rows: signal, searchAttributes })).toStrictEqual(
          { searchTokenUnavailableReason: NO_ATTRIBUTES },
        );
      }
    }
  });

  test("search attributes spell the token on every explorer, and the chip carries no reason", () => {
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      const detail: LockedFilterDetail = entityKeyChip({
        rows: signal,
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      });

      expect(detail).toStrictEqual({ searchToken: POD_SEARCH_TOKEN });
      expect(
        Object.prototype.hasOwnProperty.call(
          detail,
          "searchTokenUnavailableReason",
        ),
      ).toBe(false);
    }
  });

  test("the exceptions and profiles lists have no search bar, so search attributes give them no token", () => {
    for (const rows of [
      "exceptions",
      "profiles",
    ] as Array<EntityKeyScopedRows>) {
      expect(
        entityKeyChip({ rows, searchAttributes: POD_SEARCH_ATTRIBUTES }),
      ).toStrictEqual({ searchTokenUnavailableReason: NO_SYNTAX });
    }
  });

  test("each chip of a multi-key scope is spelled with its own entity's attributes", () => {
    /*
     * A page that scopes by several entity keys shows one chip per key, and
     * each is described on its own: a sibling's attributes never lend a chip
     * a token, and a sibling without attributes never takes one away.
     */
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      expect(
        entityKeyChip({
          rows: signal,
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        }),
      ).toStrictEqual({ searchToken: POD_SEARCH_TOKEN });
      expect(
        entityKeyChip({
          rows: signal,
          searchAttributes: NODE_SEARCH_ATTRIBUTES,
        }),
      ).toStrictEqual({ searchToken: NODE_SEARCH_TOKEN });
      expect(entityKeyChip({ rows: signal })).toStrictEqual({
        searchTokenUnavailableReason: NO_ATTRIBUTES,
      });
    }

    // The lists without a search bar give every chip of the scope one reason.
    for (const rows of [
      "exceptions",
      "profiles",
    ] as Array<EntityKeyScopedRows>) {
      for (const searchAttributes of [
        POD_SEARCH_ATTRIBUTES,
        NODE_SEARCH_ATTRIBUTES,
        undefined,
      ]) {
        expect(entityKeyChip({ rows, searchAttributes })).toStrictEqual({
          searchTokenUnavailableReason: NO_SYNTAX,
        });
      }
    }
  });

  test("an attribute that cannot be spelled drops the whole token rather than widening the search", () => {
    const unspellable: Array<Record<string, string>> = [
      // A key the search bar cannot type.
      { ...POD_SEARCH_ATTRIBUTES, "k8s pod uid": "abc" },
      // A blank value.
      { ...POD_SEARCH_ATTRIBUTES, "k8s.pod.uid": "   " },
    ];

    for (const searchAttributes of unspellable) {
      expect(entityKeyChip({ rows: "traces", searchAttributes })).toStrictEqual(
        { searchTokenUnavailableReason: NO_ATTRIBUTES },
      );
    }
  });

  test("runtime garbage in place of search attributes is no attributes, never a token or a throw", () => {
    for (const searchAttributes of [
      "k8s.pod.name",
      ["k8s.pod.name"],
      42,
      null,
    ] as Array<never>) {
      expect(() => {
        return entityKeyChip({ searchAttributes });
      }).not.toThrow();
      expect(entityKeyChip({ searchAttributes })).toStrictEqual({
        searchTokenUnavailableReason: NO_ATTRIBUTES,
      });
    }
  });

  test("the traces viewer's stored-query entity-key chip has no search syntax either, for its own reason", () => {
    const pageDetail: LockedFilterDetail = entityKeyChip({ rows: "traces" });
    const storedDetail: LockedFilterDetail =
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: Scope.ENTITY_KEYS_FACET_KEY,
        value: POD_KEY,
      });

    /*
     * The page chip could be spelled had the page named the entity's
     * attributes; a stored query only ever holds the key.
     */
    expect(pageDetail).toStrictEqual({
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    });
    expect(storedDetail).toStrictEqual({
      searchTokenUnavailableReason: Scope.NO_SEARCH_SYNTAX_REASON,
    });
  });

  test("every call returns a fresh detail", () => {
    const first: LockedFilterDetail = entityKeyChip();
    const second: LockedFilterDetail = entityKeyChip();

    expect(first).not.toBe(second);

    first.searchTokenUnavailableReason = "mutated";

    expect(second).toStrictEqual({
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    });
    expect(entityKeyChip()).toStrictEqual({
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    });
  });
});
