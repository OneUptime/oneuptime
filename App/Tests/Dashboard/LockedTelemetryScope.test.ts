import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import {
  buildSearchTokenValue,
  parseSearchValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  DictionaryFilterOperator,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
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
 * The renderer-free half of the locked-filter explainer: what each locked
 * chip says about itself (source, summary, the predicates the server
 * evaluates, the search syntax that reproduces it, or the reason there is
 * none). The chip component only renders what these return — its tooltip is
 * the search syntax or that reason — so every wording rule is pinned here.
 */

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
      expect(reason).not.toContain("Open in");
      expect(reason).not.toContain("explorer");
    }
  });
});

describe("getScopeNounForAttributeKey", () => {
  test("names every resource attribute a page scopes by", () => {
    expect(Scope.getScopeNounForAttributeKey("resource.k8s.cluster.name")).toBe(
      "Kubernetes cluster",
    );
    expect(Scope.getScopeNounForAttributeKey("resource.k8s.pod.name")).toBe(
      "Kubernetes pod",
    );
    expect(Scope.getScopeNounForAttributeKey("resource.host.name")).toBe(
      "host",
    );
    expect(
      Scope.getScopeNounForAttributeKey("resource.container.runtime"),
    ).toBe("container runtime");
    expect(Scope.getScopeNounForAttributeKey("resource.faas.name")).toBe(
      "serverless function",
    );
    expect(Scope.getScopeNounForAttributeKey("resource.cloud.platform")).toBe(
      "cloud platform",
    );
    expect(
      Scope.getScopeNounForAttributeKey("resource.ceph.cluster.name"),
    ).toBe("Ceph cluster");
    expect(
      Scope.getScopeNounForAttributeKey("resource.docker.swarm.cluster.name"),
    ).toBe("Docker Swarm cluster");
    expect(
      Scope.getScopeNounForAttributeKey("resource.vmware.vcenter.name"),
    ).toBe("VMware vCenter");
    expect(Scope.getScopeNounForAttributeKey("resource.iot.fleet.name")).toBe(
      "IoT fleet",
    );
    expect(Scope.getScopeNounForAttributeKey("resource.service.name")).toBe(
      "service",
    );
    expect(Scope.getScopeNounForAttributeKey("networkDevice.id")).toBe(
      "network device",
    );
  });

  test("falls back to 'resource' for unknown keys and never reads the prototype", () => {
    expect(Scope.getScopeNounForAttributeKey("http.method")).toBe("resource");
    expect(Scope.getScopeNounForAttributeKey("toString")).toBe("resource");
    expect(Scope.getScopeNounForAttributeKey("")).toBe("resource");
  });

  test("every mapped noun is a lower-case phrase or a proper product name", () => {
    /*
     * The noun lands mid-sentence ("Only logs from this <noun> are shown."),
     * so it must read lower-case unless it starts with a product name.
     */
    const PRODUCT_NAMES: Array<string> = [
      "Kubernetes",
      "Ceph",
      "Proxmox",
      "Docker Swarm",
      "VMware",
      "IoT",
    ];

    for (const noun of Object.values(Scope.SCOPE_NOUN_BY_ATTRIBUTE_KEY)) {
      expect(noun.trim()).toBe(noun);
      expect(noun.length).toBeGreaterThan(0);

      const startsWithProductName: boolean = PRODUCT_NAMES.some(
        (productName: string): boolean => {
          return noun.startsWith(productName);
        },
      );

      if (!startsWithProductName) {
        expect(noun.charAt(0)).toBe(noun.charAt(0).toLowerCase());
      }
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
      displayKey: "Cluster",
      displayValue: "production",
      ...overrides,
    });
  }

  test("a plain attribute scope: summary, page source, one equality predicate, search token", () => {
    const detail: LockedFilterDetail = clusterChip();

    expect(detail.source).toBe(Scope.LOCKED_FILTER_SOURCE_PAGE);
    expect(detail.summary).toBe(
      "Only logs from this Kubernetes cluster are shown.",
    );
    expect(detail.predicates).toEqual([
      {
        label: "Attribute",
        expression: 'resource.k8s.cluster.name = "prod-eks-01"',
      },
    ]);
    expect(detail.combinator).toBe("all");
    expect(detail.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
    expect(detail.searchTokenUnavailableReason).toBeUndefined();
  });

  test("the summary names the signal of the viewer it sits in", () => {
    expect(clusterChip({ signal: "traces" }).summary).toBe(
      "Only traces from this Kubernetes cluster are shown.",
    );
    expect(clusterChip({ signal: "metrics" }).summary).toBe(
      "Only metrics from this Kubernetes cluster are shown.",
    );
  });

  test("an attribute the noun map does not know is described generically", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "http.method",
      rawValue: "GET",
    });

    expect(detail.summary).toBe(
      "Only logs matching this resource attribute are shown.",
    );
    expect(detail.searchToken).toBe("@http.method:GET");
  });

  test("an entity scope for the same attribute adds ONE entity-scope predicate, AND-ed with the attribute", () => {
    const detail: LockedFilterDetail = clusterChip({
      entityScope: {
        entityKeys: ["3f9a1b2c4d5e6f70", "aaaaaaaaaaaaaaaa"],
        attributeKey: "resource.k8s.cluster.name",
        attributeValue: "prod-eks-01",
      },
    });

    /*
     * The page pins the attribute equality as its own filter AND the entity
     * scope (which the server compiles to `hasAny(entityKeys) OR attribute =
     * value`). The two AND together, so the entity-key half can never admit
     * a row the attribute rejects — "any of" would promise rows the query
     * never returns. The tooltip shows the literal shape and says so.
     */
    expect(detail.combinator).toBe("all");
    expect(detail.predicates).toHaveLength(2);
    expect(detail.predicates[0]).toEqual({
      label: "Attribute",
      expression: 'resource.k8s.cluster.name = "prod-eks-01"',
      note: "Matches the OpenTelemetry resource attribute this page scopes by.",
    });
    expect(detail.predicates[1]!.label).toBe("Entity scope");
    expect(detail.predicates[1]!.expression).toBe(
      'entityKeys has 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa OR resource.k8s.cluster.name = "prod-eks-01"',
    );
    expect(detail.predicates[1]!.note).toBe(
      "Newer rows are also stamped with a stable entity key at ingest; because the attribute filter applies too, only rows carrying the attribute are shown.",
    );
    /*
     * The syntax reproduces the attribute half: the AND-ed entity scope can
     * never admit a row the attribute rejects, so the attribute alone
     * reproduces the list on the main explorer.
     */
    expect(detail.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
  });

  test("an entity scope for a DIFFERENT attribute is not attached", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "resource.container.runtime",
      rawValue: "docker",
      entityScope: {
        entityKeys: ["3f9a1b2c4d5e6f70"],
        attributeKey: "resource.host.name",
        attributeValue: "web-01",
      },
    });

    expect(detail.combinator).toBe("all");
    expect(detail.predicates).toHaveLength(1);
    expect(detail.predicates[0]!.note).toBeUndefined();
  });

  test("an entity scope with no keys adds nothing", () => {
    const detail: LockedFilterDetail = clusterChip({
      entityScope: {
        entityKeys: [],
        attributeKey: "resource.k8s.cluster.name",
        attributeValue: "prod-eks-01",
      },
    });

    expect(detail.combinator).toBe("all");
    expect(detail.predicates).toHaveLength(1);
  });

  test("numbers and booleans are shown bare and copied as-is", () => {
    const numeric: LockedFilterDetail = clusterChip({
      attributeKey: "http.status_code",
      rawValue: 500,
    });
    expect(numeric.predicates[0]!.expression).toBe("http.status_code = 500");
    expect(numeric.searchToken).toBe("@http.status_code:500");

    const flag: LockedFilterDetail = clusterChip({
      attributeKey: "feature.enabled",
      rawValue: true,
    });
    expect(flag.predicates[0]!.expression).toBe("feature.enabled = true");
    expect(flag.searchToken).toBe("@feature.enabled:true");
  });

  test("a value with grammar characters is escaped so the token means the literal", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "http.route",
      rawValue: "/api/*",
    });

    expect(detail.predicates[0]!.expression).toBe('http.route = "/api/*"');
    expect(detail.searchToken).toBe(
      `@http.route:${buildSearchTokenValue("/api/*")}`,
    );

    const tokenValue: string = detail.searchToken!.substring(
      "@http.route:".length,
    );
    expect(parseSearchValue(tokenValue).value).toBe("/api/*");
  });

  test("a value with spaces is quoted in the token", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "resource.host.name",
      rawValue: "web 01",
    });

    expect(detail.searchToken).toBe('@resource.host.name:"web 01"');
  });

  test("operator filters are described with the form's operator words and spelled in the grammar", () => {
    /*
     * Every operator the attribute filter form offers has a spelling the
     * explorer compiles to the same predicate (the round trips are pinned in
     * Common/Tests/Utils/Telemetry/LockedFilterSearch.test.ts); the tooltip
     * offers it, a negated one with the `-` on the token.
     */
    const anyOf: LockedFilterDetail = clusterChip({
      attributeKey: "k8s.namespace.name",
      rawValue: new Includes(["payments", "checkout"]),
    });
    expect(anyOf.predicates[0]!.expression).toBe(
      `k8s.namespace.name ${
        getOperatorOption(DictionaryFilterOperator.IsAnyOf).symbol
      } payments, checkout`,
    );
    expect(anyOf.searchToken).toBe(
      "@k8s.namespace.name:(payments OR checkout)",
    );
    expect(anyOf.searchTokenUnavailableReason).toBeUndefined();

    const contains: LockedFilterDetail = clusterChip({
      attributeKey: "url.path",
      rawValue: new Search("/checkout"),
    });
    expect(contains.predicates[0]!.expression).toBe(
      `url.path ${
        getOperatorOption(DictionaryFilterOperator.Contains).symbol
      } /checkout`,
    );
    expect(contains.searchToken).toBe("@url.path:~/checkout");

    const notEqual: LockedFilterDetail = clusterChip({
      attributeKey: "severity",
      rawValue: new NotEqual("debug"),
    });
    expect(notEqual.predicates[0]!.expression).toBe(
      `severity ${
        getOperatorOption(DictionaryFilterOperator.NotEqual).symbol
      } debug`,
    );
    expect(notEqual.searchToken).toBe("@severity:!debug");

    const isEmpty: LockedFilterDetail = clusterChip({
      attributeKey: "user.id",
      rawValue: new IsNull(),
    });
    expect(isEmpty.predicates[0]!.expression).toBe(
      `user.id ${getOperatorOption(DictionaryFilterOperator.IsEmpty).symbol}`,
    );
    expect(isEmpty.searchToken).toBe("-@user.id:*");
  });

  test("an operator shape the grammar cannot spell is described but has no syntax, and says why", () => {
    // Several operators AND-ed on one key: the grammar has one value per key.
    const stacked: LockedFilterDetail = clusterChip({
      attributeKey: "url.path",
      rawValue: [new Search("/api"), new NotEqual("/api/health")] as never,
    });
    expect(stacked.searchToken).toBeUndefined();
    expect(stacked.searchTokenUnavailableReason).toBe(
      "This operator filter cannot be spelled in the search bar.",
    );

    // A list entry the list grammar would split in two.
    const commaList: LockedFilterDetail = clusterChip({
      attributeKey: "k8s.namespace.name",
      rawValue: new Includes(["a,b", "c"]),
    });
    expect(commaList.searchToken).toBeUndefined();
    expect(commaList.searchTokenUnavailableReason).toBe(
      "This operator filter cannot be spelled in the search bar.",
    );
  });

  test("an operator filter with an entity scope still lists the entity scope", () => {
    const detail: LockedFilterDetail = clusterChip({
      rawValue: new Includes(["prod-eks-01", "prod-eks-02"]),
      entityScope: {
        entityKeys: ["3f9a1b2c4d5e6f70"],
        attributeKey: "resource.k8s.cluster.name",
        attributeValue: "prod-eks-01",
      },
    });

    expect(detail.combinator).toBe("all");
    expect(detail.predicates).toHaveLength(2);
    expect(detail.predicates[1]!.label).toBe("Entity scope");
    expect(detail.searchToken).toBe(
      "@resource.k8s.cluster.name:(prod-eks-01 OR prod-eks-02)",
    );
  });

  test("a key the search bar cannot spell has no syntax and says why", () => {
    const detail: LockedFilterDetail = clusterChip({
      attributeKey: "weird key",
      rawValue: "x",
    });

    expect(detail.searchToken).toBeUndefined();
    expect(detail.searchTokenUnavailableReason).toBe(
      "This attribute key cannot be typed into the search bar.",
    );
    // The predicate still shows the real filter.
    expect(detail.predicates[0]!.expression).toBe('weird key = "x"');
  });

  test("an empty value has no syntax and says why", () => {
    const detail: LockedFilterDetail = clusterChip({ rawValue: "" });

    expect(detail.predicates[0]!.expression).toBe(
      'resource.k8s.cluster.name = ""',
    );
    expect(detail.searchToken).toBeUndefined();
    expect(detail.searchTokenUnavailableReason).toBe(
      "This filter has no value to copy.",
    );
  });

  test("a caller-supplied source wins over the page default", () => {
    expect(
      clusterChip({ source: Scope.LOCKED_FILTER_SOURCE_STORED_QUERY }).source,
    ).toBe(Scope.LOCKED_FILTER_SOURCE_STORED_QUERY);
  });
});

describe("describeLockedEntityFilter", () => {
  const RUM_ID: string = "651a000000000000000000aa";

  test("logs and traces: entity id predicate and a service: token carrying the id", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      const detail: LockedFilterDetail = Scope.describeLockedEntityFilter({
        signal,
        entityTypeLabel: "RUM Application",
        id: RUM_ID,
        name: "checkout-web",
      });

      expect(detail.source).toBe(Scope.LOCKED_FILTER_SOURCE_PAGE);
      expect(detail.summary).toBe(
        `Only ${signal} emitted by this RUM Application are shown.`,
      );
      expect(detail.predicates).toEqual([
        {
          label: "Entity id",
          expression: `primaryEntityId = "${RUM_ID}"`,
          note: "The RUM Application's OneUptime id, stored on every row it emits.",
        },
      ]);
      expect(detail.combinator).toBe("all");
      expect(detail.searchToken).toBe(`service:${RUM_ID}`);
      expect(detail.searchTokenUnavailableReason).toBeUndefined();
    }
  });

  test("metrics: no token, because that search bar matches services by name", () => {
    const detail: LockedFilterDetail = Scope.describeLockedEntityFilter({
      signal: "metrics",
      entityTypeLabel: "Service",
      id: RUM_ID,
    });

    expect(detail.searchToken).toBeUndefined();
    expect(detail.searchTokenUnavailableReason).toBe(
      Scope.METRICS_SERVICE_NO_SYNTAX_REASON,
    );
  });

  test("an empty id has no token", () => {
    const detail: LockedFilterDetail = Scope.describeLockedEntityFilter({
      signal: "logs",
      entityTypeLabel: "Service",
      id: "",
    });

    expect(detail.searchToken).toBeUndefined();
    expect(detail.searchTokenUnavailableReason).toBe(
      "This filter has no value to copy.",
    );
  });
});

describe("describeLockedTraceFilter / describeLockedSpanFilter", () => {
  test("trace: predicate on traceId and a trace: token on logs and traces", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      const detail: LockedFilterDetail = Scope.describeLockedTraceFilter({
        signal,
        traceId: "abc123",
      });

      expect(detail.summary).toBe(
        `Only ${signal} that belong to this trace are shown.`,
      );
      expect(detail.predicates).toEqual([
        { label: "Trace ID", expression: 'traceId = "abc123"' },
      ]);
      expect(detail.searchToken).toBe("trace:abc123");
    }
  });

  test("span: predicate on spanId and a span: token on logs and traces", () => {
    for (const signal of ["logs", "traces"] as Array<TelemetrySignal>) {
      const detail: LockedFilterDetail = Scope.describeLockedSpanFilter({
        signal,
        spanId: "span-9",
      });

      expect(detail.summary).toBe(
        `Only ${signal} that belong to this span are shown.`,
      );
      expect(detail.predicates).toEqual([
        { label: "Span ID", expression: 'spanId = "span-9"' },
      ]);
      expect(detail.searchToken).toBe("span:span-9");
    }
  });

  test("metrics has neither token, and says the filter has no search syntax", () => {
    const trace: LockedFilterDetail = Scope.describeLockedTraceFilter({
      signal: "metrics",
      traceId: "abc123",
    });
    expect(trace.searchToken).toBeUndefined();
    expect(trace.searchTokenUnavailableReason).toBe(
      Scope.NO_SEARCH_SYNTAX_REASON,
    );

    const span: LockedFilterDetail = Scope.describeLockedSpanFilter({
      signal: "metrics",
      spanId: "span-9",
    });
    expect(span.searchToken).toBeUndefined();
    expect(span.searchTokenUnavailableReason).toBe(
      Scope.NO_SEARCH_SYNTAX_REASON,
    );
  });
});

describe("describeLockedSessionFilter", () => {
  test("logs / traces: sessionId predicate, no syntax, and says so", () => {
    const logs: LockedFilterDetail = Scope.describeLockedSessionFilter({
      signal: "logs",
      sessionId: "sess-1",
    });
    expect(logs.summary).toBe(
      "Only logs recorded during this session are shown.",
    );
    expect(logs.predicates).toEqual([
      { label: "Session ID", expression: 'sessionId = "sess-1"' },
    ]);
    expect(logs.searchToken).toBeUndefined();
    expect(logs.searchTokenUnavailableReason).toBe(
      Scope.SESSION_NO_SYNTAX_REASON,
    );

    const traces: LockedFilterDetail = Scope.describeLockedSessionFilter({
      signal: "traces",
      sessionId: "sess-1",
    });
    expect(traces.summary).toBe(
      "Only traces recorded during this session are shown.",
    );
    expect(traces.searchToken).toBeUndefined();
    expect(traces.searchTokenUnavailableReason).toBe(
      Scope.SESSION_NO_SYNTAX_REASON,
    );
  });

  test("metrics: sessions are not a dimension at all", () => {
    const detail: LockedFilterDetail = Scope.describeLockedSessionFilter({
      signal: "metrics",
      sessionId: "sess-1",
    });

    expect(detail.searchTokenUnavailableReason).toBe(
      "Sessions are not a metrics dimension.",
    );
  });
});

describe("describeLockedStoredQueryFilter", () => {
  test("an attribute chip: stored-query source, Attribute label, @ token", () => {
    const detail: LockedFilterDetail = Scope.describeLockedStoredQueryFilter({
      signal: "traces",
      facetKey: "attributes.http.method",
      value: "GET",
      displayKey: "http.method",
      displayValue: "GET",
    });

    expect(detail.source).toBe(Scope.LOCKED_FILTER_SOURCE_STORED_QUERY);
    expect(detail.summary).toBe(
      "Only traces matching the stored query are shown.",
    );
    expect(detail.predicates).toEqual([
      { label: "Attribute", expression: 'http.method = "GET"' },
    ]);
    expect(detail.combinator).toBe("all");
    expect(detail.searchToken).toBe("@http.method:GET");
  });

  test("a column chip keeps the chip's own label and is spelled with the column's field token", () => {
    const detail: LockedFilterDetail = Scope.describeLockedStoredQueryFilter({
      signal: "traces",
      facetKey: "statusCode",
      value: "2",
      displayKey: "Status",
      displayValue: "Error",
    });

    expect(detail.predicates).toEqual([
      { label: "Status", expression: 'statusCode = "2"' },
    ]);
    expect(detail.searchToken).toBe("status:2");
    expect(detail.searchTokenUnavailableReason).toBeUndefined();

    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "kind",
        value: "SPAN_KIND_SERVER",
        displayKey: "Kind",
        displayValue: "SPAN_KIND_SERVER",
      }).searchToken,
    ).toBe("kind:SPAN_KIND_SERVER");
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "hasException",
        value: "true",
        displayKey: "Has Exception",
        displayValue: "Yes",
      }).searchToken,
    ).toBe("hasexception:true");
  });

  test("a single stored text value is a substring match when the caller says so, and the token carries the same semantics", () => {
    const contains: LockedFilterDetail = Scope.describeLockedStoredQueryFilter({
      signal: "traces",
      facetKey: "name",
      value: "checkout",
      displayKey: "Name",
      displayValue: "checkout",
      matches: "contains",
    });

    // A single `name:` token is a substring match on the traces explorer too.
    expect(contains.predicates).toEqual([
      { label: "Name", expression: 'name contains "checkout"' },
    ]);
    expect(contains.searchToken).toBe("name:checkout");

    const exact: LockedFilterDetail = Scope.describeLockedStoredQueryFilter({
      signal: "traces",
      facetKey: "statusMessage",
      value: "boom",
      displayKey: "Status Message",
      displayValue: "boom",
    });

    expect(exact.predicates).toEqual([
      { label: "Status Message", expression: 'statusMessage = "boom"' },
    ]);
    expect(exact.searchToken).toBe("statusmessage:boom");
  });

  test("an entityKeys chip reads as a membership, not an equality, and has no search syntax on any explorer", () => {
    /*
     * A stored query holds only the key, never the resource attributes the
     * key was hashed from, and no explorer's grammar has an entity-key token.
     */
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      const detail: LockedFilterDetail = Scope.describeLockedStoredQueryFilter({
        signal,
        facetKey: "entityKeys",
        value: "3f9a1b2c4d5e6f70",
        displayKey: "Resource",
        displayValue: "3f9a1b2c4d5e6f70",
      });

      expect(detail.predicates).toEqual([
        {
          label: "Entity key",
          expression: "entityKeys has 3f9a1b2c4d5e6f70",
        },
      ]);
      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        Scope.NO_SEARCH_SYNTAX_REASON,
      );
    }
  });

  test("trace, span and service chips get their field tokens", () => {
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "traceId",
        value: "t-1",
        displayKey: "Trace",
        displayValue: "t-1",
      }).searchToken,
    ).toBe("trace:t-1");
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "spanId",
        value: "s-1",
        displayKey: "Span",
        displayValue: "s-1",
      }).searchToken,
    ).toBe("span:s-1");
    expect(
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: "primaryEntityId",
        value: "651a000000000000000000aa",
        displayKey: "Service",
        displayValue: "api",
      }).searchToken,
    ).toBe("service:651a000000000000000000aa");
  });
});

describe("describeLockedEntityKeyFilter", () => {
  /*
   * An Inventory item's scope: `hasAny(entityKeys, [item key])` with no
   * attribute alongside, on Logs / Traces / Metrics and on the Exceptions and
   * Profiles lists. The chip is the only thing telling a reader why the list
   * is filtered, so every sentence it says is pinned verbatim.
   */
  const POD_KEY: string = "3f9a1b2c4d5e6f70";
  const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
  const CLUSTER_KEY: string = "0123456789abcdef";

  /*
   * A possibility, not a claim: a Service item's rows all name the service
   * as their owner, so the list may hold no other resource's rows at all.
   */
  const INGEST_NOTE: string =
    "Rows are stamped at ingest with the key of every resource they describe, so rows primarily owned by another resource (a service running on it, say) can appear here too.";
  const ANY_OF_NOTE: string =
    "A row carrying any one of these keys is shown. Rows are stamped at ingest with the key of every resource they describe, so rows primarily owned by another resource (a service running on it, say) can appear here too.";
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

  const ALL_ROWS: Array<EntityKeyScopedRows> = [
    "logs",
    "traces",
    "metrics",
    "exceptions",
    "profiles",
  ];

  function entityKeyChip(
    overrides: Partial<DescribeLockedEntityKeyFilterInput> = {},
  ): LockedFilterDetail {
    return Scope.describeLockedEntityKeyFilter({
      rows: "logs",
      entityKey: POD_KEY,
      ...overrides,
    });
  }

  test("the vocabulary the viewers share", () => {
    expect(Scope.ENTITY_KEYS_FACET_KEY).toBe("entityKeys");
    expect(Scope.DEFAULT_ENTITY_KEY_DISPLAY_KEY).toBe("Resource");
    expect(Scope.RESOURCE_ATTRIBUTE_PREFIX).toBe("resource.");
  });

  const SINGLE_KEY_CASES: Array<[EntityKeyScopedRows, string, string]> = [
    ["logs", "Only logs linked to this resource are shown.", NO_ATTRIBUTES],
    ["traces", "Only traces linked to this resource are shown.", NO_ATTRIBUTES],
    [
      "metrics",
      "Only metrics linked to this resource are shown.",
      NO_ATTRIBUTES,
    ],
    [
      "exceptions",
      "Only exceptions linked to this resource are shown.",
      NO_SYNTAX,
    ],
    ["profiles", "Only profiles linked to this resource are shown.", NO_SYNTAX],
  ];

  test.each(SINGLE_KEY_CASES)(
    "%s: page source, one membership predicate, no search token, and why",
    (rows: EntityKeyScopedRows, summary: string, reason: string) => {
      const detail: LockedFilterDetail = entityKeyChip({ rows });

      expect(detail).toStrictEqual({
        source: "Pinned by this page",
        summary,
        predicates: [
          {
            label: "Entity key",
            expression: "entityKeys has 3f9a1b2c4d5e6f70",
            note: INGEST_NOTE,
          },
        ],
        combinator: "all",
        searchTokenUnavailableReason: reason,
      });
      expect(Object.prototype.hasOwnProperty.call(detail, "searchToken")).toBe(
        false,
      );
    },
  );

  test("telemetry rows with no search attributes — absent or empty — are told the resource has none to search by", () => {
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      for (const searchAttributes of [undefined, {}]) {
        const detail: LockedFilterDetail = entityKeyChip({
          rows: signal,
          searchAttributes,
        });

        expect(detail.searchToken).toBeUndefined();
        expect(detail.searchTokenUnavailableReason).toBe(NO_ATTRIBUTES);
      }
    }
  });

  test("search attributes spell the token on every explorer and change nothing else about the chip", () => {
    for (const signal of [
      "logs",
      "traces",
      "metrics",
    ] as Array<TelemetrySignal>) {
      const bare: LockedFilterDetail = entityKeyChip({
        rows: signal,
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Pod",
      });

      expect(
        entityKeyChip({
          rows: signal,
          entityKeys: [POD_KEY, NODE_KEY],
          entityTypeLabel: "Kubernetes Pod",
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        }),
      ).toStrictEqual({
        source: bare.source,
        summary: bare.summary,
        predicates: bare.predicates,
        combinator: bare.combinator,
        searchToken: POD_SEARCH_TOKEN,
      });
    }
  });

  test("the exceptions and profiles lists have no search bar, so search attributes give them no token", () => {
    for (const rows of [
      "exceptions",
      "profiles",
    ] as Array<EntityKeyScopedRows>) {
      expect(
        entityKeyChip({ rows, searchAttributes: POD_SEARCH_ATTRIBUTES }),
      ).toStrictEqual(entityKeyChip({ rows }));
      expect(
        entityKeyChip({ rows, searchAttributes: POD_SEARCH_ATTRIBUTES })
          .searchTokenUnavailableReason,
      ).toBe(NO_SYNTAX);
    }
  });

  const LABELLED_CASES: Array<[EntityKeyScopedRows, string]> = [
    ["logs", "Only logs linked to this Kubernetes Pod are shown."],
    ["traces", "Only traces linked to this Kubernetes Pod are shown."],
    ["metrics", "Only metrics linked to this Kubernetes Pod are shown."],
    ["exceptions", "Only exceptions linked to this Kubernetes Pod are shown."],
    ["profiles", "Only profiles linked to this Kubernetes Pod are shown."],
  ];

  test.each(LABELLED_CASES)(
    "%s: an entity type label names the thing in the summary and changes nothing else",
    (rows: EntityKeyScopedRows, summary: string) => {
      expect(
        entityKeyChip({ rows, entityTypeLabel: "Kubernetes Pod" }),
      ).toStrictEqual({ ...entityKeyChip({ rows }), summary });
    },
  );

  test("the label is trimmed", () => {
    expect(
      entityKeyChip({ rows: "traces", entityTypeLabel: "  Host \n" }).summary,
    ).toBe("Only traces linked to this Host are shown.");
  });

  test("a missing, blank or non-string label reads 'resource'", () => {
    for (const entityTypeLabel of [
      undefined,
      "",
      "   ",
      42 as never,
      null as never,
      {} as never,
    ]) {
      expect(entityKeyChip({ rows: "metrics", entityTypeLabel }).summary).toBe(
        "Only metrics linked to this resource are shown.",
      );
    }
  });

  test("'Resource' in any case collapses to the lower-case noun — never 'this Resource'", () => {
    for (const entityTypeLabel of [
      "Resource",
      "RESOURCE",
      "resource",
      "  Resource  ",
    ]) {
      expect(entityKeyChip({ rows: "profiles", entityTypeLabel }).summary).toBe(
        "Only profiles linked to this resource are shown.",
      );
    }
  });

  test("a label that merely contains the word is kept as written", () => {
    expect(entityKeyChip({ entityTypeLabel: "Cloud Resource" }).summary).toBe(
      "Only logs linked to this Cloud Resource are shown.",
    );
  });

  test("a caller-supplied source wins; an empty one falls back to the page", () => {
    expect(
      entityKeyChip({ source: Scope.LOCKED_FILTER_SOURCE_STORED_QUERY }).source,
    ).toBe("Pinned by the stored query this view was opened with");
    expect(entityKeyChip({ source: "" }).source).toBe("Pinned by this page");
  });

  test("keys a stored query pinned are counted as the stored query's, never as keys this page pins", () => {
    /*
     * A log monitor's incident snapshot hands the logs viewer entity keys
     * from the monitor's stored query. The chip's source already says so;
     * the multi-key sentence has to agree with it.
     */
    const STORED: string = Scope.LOCKED_FILTER_SOURCE_STORED_QUERY;

    expect(
      entityKeyChip({
        entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY],
        source: STORED,
      }),
    ).toStrictEqual({
      source: "Pinned by the stored query this view was opened with",
      summary:
        "Logs linked to this resource are shown, along with logs linked to the 2 other resources the stored query pins.",
      predicates: [
        {
          label: "Entity key",
          expression:
            "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa, 0123456789abcdef",
          note: ANY_OF_NOTE,
        },
      ],
      combinator: "all",
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    });

    expect(
      entityKeyChip({
        rows: "exceptions",
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Pod",
        source: STORED,
      }).summary,
    ).toBe(
      "Exceptions linked to this Kubernetes Pod are shown, along with exceptions linked to the 1 other resource the stored query pins.",
    );

    // A lone key names no count, so its sentence is the same from either source.
    expect(entityKeyChip({ source: STORED }).summary).toBe(
      "Only logs linked to this resource are shown.",
    );

    // Any other source — none, an empty one, the page's — keeps the page wording.
    for (const source of [undefined, "", Scope.LOCKED_FILTER_SOURCE_PAGE]) {
      expect(
        entityKeyChip({ entityKeys: [POD_KEY, NODE_KEY], source }).summary,
      ).toBe(
        "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
      );
    }
  });

  test("two keys: the chip says the scope WIDENS — a row carrying either is shown", () => {
    /*
     * The combinator stays "all": its one predicate IS the `hasAny`, and
     * "any of" a single predicate would read as OR-ing it with nothing.
     */
    expect(
      entityKeyChip({
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Pod",
      }),
    ).toStrictEqual({
      source: "Pinned by this page",
      summary:
        "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 1 other resource this page pins.",
      predicates: [
        {
          label: "Entity key",
          expression:
            "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa",
          note: ANY_OF_NOTE,
        },
      ],
      combinator: "all",
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    });
  });

  const THREE_KEY_CASES: Array<[EntityKeyScopedRows, string, string]> = [
    [
      "logs",
      "Logs linked to this resource are shown, along with logs linked to the 2 other resources this page pins.",
      NO_ATTRIBUTES,
    ],
    [
      "traces",
      "Traces linked to this resource are shown, along with traces linked to the 2 other resources this page pins.",
      NO_ATTRIBUTES,
    ],
    [
      "metrics",
      "Metrics linked to this resource are shown, along with metrics linked to the 2 other resources this page pins.",
      NO_ATTRIBUTES,
    ],
    [
      "exceptions",
      "Exceptions linked to this resource are shown, along with exceptions linked to the 2 other resources this page pins.",
      NO_SYNTAX,
    ],
    [
      "profiles",
      "Profiles linked to this resource are shown, along with profiles linked to the 2 other resources this page pins.",
      NO_SYNTAX,
    ],
  ];

  test.each(THREE_KEY_CASES)(
    "%s: three keys — capitalised, plural, every key listed",
    (rows: EntityKeyScopedRows, summary: string, reason: string) => {
      expect(
        entityKeyChip({ rows, entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY] }),
      ).toStrictEqual({
        source: "Pinned by this page",
        summary,
        predicates: [
          {
            label: "Entity key",
            expression:
              "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa, 0123456789abcdef",
            note: ANY_OF_NOTE,
          },
        ],
        combinator: "all",
        searchTokenUnavailableReason: reason,
      });
    },
  );

  test("each chip leads with its own key, then the others in the page's order", () => {
    expect(
      entityKeyChip({
        entityKey: NODE_KEY,
        entityKeys: [POD_KEY, NODE_KEY, CLUSTER_KEY],
      }).predicates[0]!.expression,
    ).toBe(
      "entityKeys has any of aaaaaaaaaaaaaaaa, 3f9a1b2c4d5e6f70, 0123456789abcdef",
    );
  });

  test("the chip's own key, repeats, padding and blanks never count as another resource", () => {
    expect(
      entityKeyChip({
        entityKeys: [POD_KEY, ` ${POD_KEY} `, "", "   ", POD_KEY],
      }),
    ).toStrictEqual(entityKeyChip());

    const detail: LockedFilterDetail = entityKeyChip({
      entityKeys: [POD_KEY, NODE_KEY, ` ${NODE_KEY}`, NODE_KEY],
    });

    expect(detail.summary).toBe(
      "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
    );
    expect(detail.predicates[0]!.expression).toBe(
      "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa",
    );
  });

  test("a padded chip key is trimmed, so it neither prints its padding nor counts itself as another resource", () => {
    expect(
      entityKeyChip({ entityKey: `  ${POD_KEY}\t`, entityKeys: [POD_KEY] }),
    ).toStrictEqual(entityKeyChip());
  });

  test("a list that omits the chip's own key still leads with it and counts only the others", () => {
    const detail: LockedFilterDetail = entityKeyChip({
      entityKeys: [NODE_KEY],
    });

    expect(detail.predicates[0]!.expression).toBe(
      "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa",
    );
    expect(detail.summary).toBe(
      "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
    );
  });

  test("keys are compared exactly: case is significant, as it is to hasAny", () => {
    expect(
      entityKeyChip({
        entityKey: "ABCDEF",
        entityKeys: ["ABCDEF", "abcdef"],
      }).predicates[0]!.expression,
    ).toBe("entityKeys has any of ABCDEF, abcdef");
  });

  test("runtime garbage in the key list is ignored rather than printed or thrown on", () => {
    expect(
      entityKeyChip({
        entityKeys: [POD_KEY, 42, null, undefined, {}, NODE_KEY] as never,
      }).predicates[0]!.expression,
    ).toBe("entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa");

    /*
     * A lone string would otherwise iterate its characters ("a" as another
     * resource) and an operator instance is not iterable at all.
     */
    for (const entityKeys of [
      NODE_KEY,
      new Includes([NODE_KEY]),
      42,
      null,
      {},
    ] as Array<never>) {
      expect(() => {
        return entityKeyChip({ entityKeys });
      }).not.toThrow();
      expect(entityKeyChip({ entityKeys })).toStrictEqual(entityKeyChip());
    }
  });

  test("without search attributes, no combination of surface, label or key count offers a search token", () => {
    for (const rows of ALL_ROWS) {
      for (const entityTypeLabel of [undefined, "Kubernetes Pod"]) {
        for (const entityKeys of [undefined, [POD_KEY], [POD_KEY, NODE_KEY]]) {
          const detail: LockedFilterDetail = entityKeyChip({
            rows,
            entityTypeLabel,
            entityKeys,
          });

          expect(detail.searchToken).toBeUndefined();
          expect(
            Object.prototype.hasOwnProperty.call(detail, "searchToken"),
          ).toBe(false);
          expect(detail.searchTokenUnavailableReason).toBe(
            rows === "exceptions" || rows === "profiles"
              ? NO_SYNTAX
              : NO_ATTRIBUTES,
          );
          expect(detail.combinator).toBe("all");
          expect(detail.predicates).toHaveLength(1);
          expect(detail.predicates[0]!.label).toBe("Entity key");
        }
      }
    }
  });

  test("reads the same predicate as the traces viewer's stored-query entity-key chip; neither has search syntax without attributes", () => {
    const pageDetail: LockedFilterDetail = entityKeyChip({ rows: "traces" });
    const storedDetail: LockedFilterDetail =
      Scope.describeLockedStoredQueryFilter({
        signal: "traces",
        facetKey: Scope.ENTITY_KEYS_FACET_KEY,
        value: POD_KEY,
        displayKey: Scope.DEFAULT_ENTITY_KEY_DISPLAY_KEY,
        displayValue: POD_KEY,
      });

    expect(pageDetail.predicates[0]!.label).toBe(
      storedDetail.predicates[0]!.label,
    );
    expect(pageDetail.predicates[0]!.expression).toBe(
      storedDetail.predicates[0]!.expression,
    );
    expect(pageDetail.searchToken).toBeUndefined();
    expect(storedDetail.searchToken).toBeUndefined();
    /*
     * The page chip could be spelled had the page named the entity's
     * attributes; a stored query only ever holds the key.
     */
    expect(pageDetail.searchTokenUnavailableReason).toBe(NO_ATTRIBUTES);
    expect(storedDetail.searchTokenUnavailableReason).toBe(
      Scope.NO_SEARCH_SYNTAX_REASON,
    );
    expect(pageDetail.source).toBe(Scope.LOCKED_FILTER_SOURCE_PAGE);
    expect(storedDetail.source).toBe(Scope.LOCKED_FILTER_SOURCE_STORED_QUERY);
  });

  test("every call returns a fresh detail", () => {
    const first: LockedFilterDetail = entityKeyChip();
    const second: LockedFilterDetail = entityKeyChip();

    expect(first).not.toBe(second);
    expect(first.predicates).not.toBe(second.predicates);

    first.predicates[0]!.expression = "mutated";

    expect(second.predicates[0]!.expression).toBe(
      "entityKeys has 3f9a1b2c4d5e6f70",
    );
  });
});
