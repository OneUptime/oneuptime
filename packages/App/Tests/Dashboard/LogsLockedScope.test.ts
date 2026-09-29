import { describe, expect, test } from "@jest/globals";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
/*
 * Pure modules, imported statically: none reaches `window`, and the chips
 * the viewer builds come from here, so the glue is exercised on real chips.
 */
import * as Scope from "../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope";
import {
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  NO_SEARCH_SYNTAX_REASON,
  SESSION_NO_SYNTAX_REASON,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The logs viewer's glue for the locked chips' search syntax: which describer
 * each locked chip gets (by the column it filters), that the raw attribute
 * values the page pinned reach the describers, and that entity-key chips —
 * which arrive from buildLockedEntityKeyChips with their detail attached —
 * pass through untouched. Every locked chip so carries the search syntax (or
 * the reason there is none) its tooltip shows. The search grammar itself is
 * pinned in LockedTelemetryScope.test.ts; this suite pins the dispatch.
 */

function chip(overrides: Partial<ActiveFilter>): ActiveFilter {
  return {
    facetKey: "attributes.resource.k8s.cluster.name",
    value: "prod-eks-01",
    displayKey: "Cluster",
    displayValue: "production",
    readOnly: true,
    ...overrides,
  };
}

function tokensOf(chips: Array<ActiveFilter>): Array<string | undefined> {
  return chips.map((each: ActiveFilter): string | undefined => {
    return each.lockedDetail?.searchToken;
  });
}

function detailsOf(chips: Array<ActiveFilter>): Array<unknown> {
  return chips.map((each: ActiveFilter): unknown => {
    return each.lockedDetail;
  });
}

const CLUSTER_DETAIL: LockedFilterDetail = {
  searchToken: "@resource.k8s.cluster.name:prod-eks-01",
};

/*
 * The reasons LockedTelemetryScope keeps private, word for word as the
 * tooltip shows them.
 */
const UNSAFE_KEY_REASON: string =
  "This attribute key cannot be typed into the search bar.";
const OPERATOR_REASON: string =
  "This operator filter cannot be spelled in the search bar.";
const EMPTY_VALUE_REASON: string = "This filter has no value to copy.";

describe("describeLogsLockedChip", () => {
  test("an attribute chip is spelled from the PINNED value, never from the chip's display text", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({}),
      {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
      },
    );

    // The chip reads "Cluster: production"; the syntax spells what is pinned.
    expect(detail).toEqual(CLUSTER_DETAIL);
    expect(detail!.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
    expect(detail!.searchTokenUnavailableReason).toBeUndefined();
  });

  test("a chip reads only its OWN key from the page's pinned attributes", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({
        facetKey: "attributes.resource.container.runtime",
        value: "docker",
        displayKey: "Runtime",
        displayValue: "docker",
      }),
      {
        logQueryAttributes: {
          "resource.host.name": "web-01",
          "resource.container.runtime": "docker",
        },
      },
    );

    expect(detail).toEqual({
      searchToken: "@resource.container.runtime:docker",
    });
    expect(detail!.searchToken).toBe("@resource.container.runtime:docker");
  });

  test("an operator-valued pinned attribute is spelled from the operator, never from the chip's display text", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({
        facetKey: "attributes.k8s.namespace.name",
        value: "is any of payments, checkout",
        displayKey: "Namespace",
        displayValue: "is any of payments, checkout",
      }),
      {
        logQueryAttributes: {
          "k8s.namespace.name": new Includes(["payments", "checkout"]),
        },
      },
    );

    // The PINNED value is what gets spelled; the display text would be wrong.
    expect(detail!.searchToken).toBe(
      "@k8s.namespace.name:(payments OR checkout)",
    );
    expect(detail!.searchTokenUnavailableReason).toBeUndefined();
    expect(detail).toEqual({
      searchToken: "@k8s.namespace.name:(payments OR checkout)",
    });
  });

  test("a chip whose key the page did not pin is spelled from its own value", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({}),
      {},
    );

    expect(detail!.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
    expect(detail).toEqual(CLUSTER_DETAIL);
  });

  test("entity, trace, span and session chips get their own describers", () => {
    const entity: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({
        facetKey: "primaryEntityId",
        value: "651a000000000000000000aa",
        displayKey: "RUM Application",
        displayValue: "checkout-web",
      }),
      {},
    );
    expect(entity!.searchToken).toBe("service:651a000000000000000000aa");
    expect(entity).toEqual({ searchToken: "service:651a000000000000000000aa" });

    // The pre-rename alias reads as an entity chip too.
    const alias: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({
        facetKey: "serviceId",
        value: "651a000000000000000000aa",
        displayKey: "Service",
        displayValue: "api",
      }),
      {},
    );
    expect(alias!.searchToken).toBe("service:651a000000000000000000aa");
    expect(alias).toEqual({ searchToken: "service:651a000000000000000000aa" });

    const trace: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({ facetKey: "traceId", value: "t-1", displayKey: "Trace" }),
      {},
    );
    expect(trace!.searchToken).toBe("trace:t-1");
    expect(trace).toEqual({ searchToken: "trace:t-1" });

    const span: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({ facetKey: "spanId", value: "s-1", displayKey: "Span" }),
      {},
    );
    expect(span!.searchToken).toBe("span:s-1");
    expect(span).toEqual({ searchToken: "span:s-1" });

    const session: LockedFilterDetail | undefined =
      Scope.describeLogsLockedChip(
        chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" }),
        {},
      );
    expect(session!.searchToken).toBeUndefined();
    expect(session!.searchTokenUnavailableReason).toBe(
      SESSION_NO_SYNTAX_REASON,
    );
    expect(session).toEqual({
      searchTokenUnavailableReason: SESSION_NO_SYNTAX_REASON,
    });
  });

  test("a column with no describer keeps a plain chip", () => {
    expect(
      Scope.describeLogsLockedChip(
        chip({ facetKey: "kind", value: "server", displayKey: "Kind" }),
        {},
      ),
    ).toBeUndefined();
  });

  test("an attribute chip the logs search bar cannot spell gets the reason for what it cannot spell, and no token", () => {
    // An unsafe key, whether its value is pinned as a scalar or an operator.
    for (const pinned of ["x", new Includes(["a", "b"])]) {
      expect(
        Scope.describeLogsLockedChip(
          chip({ facetKey: "attributes.weird key", value: "x" }),
          { logQueryAttributes: { "weird key": pinned } },
        ),
      ).toStrictEqual({ searchTokenUnavailableReason: UNSAFE_KEY_REASON });
    }

    // A pinned operator the grammar cannot spell, whatever the chip reads.
    expect(
      Scope.describeLogsLockedChip(
        chip({
          facetKey: "attributes.list.key",
          value: "is any of a,b, c",
          displayValue: "is any of a,b, c",
        }),
        { logQueryAttributes: { "list.key": new Includes(["a,b", "c"]) } },
      ),
    ).toStrictEqual({ searchTokenUnavailableReason: OPERATOR_REASON });

    // An empty pinned value — never an empty token.
    const empty: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      chip({ value: "" }),
      { logQueryAttributes: { "resource.k8s.cluster.name": "" } },
    );

    expect(empty).toStrictEqual({
      searchTokenUnavailableReason: EMPTY_VALUE_REASON,
    });
    expect(empty).not.toHaveProperty("searchToken");
  });

  test("more pinned operators are spelled from the operator: a negation, a glob list and a range", () => {
    const cases: Array<[string, unknown, string]> = [
      ["user.id", new IsNull(), "-@user.id:*"],
      [
        "glob.key",
        new Wildcard(["api-*", "web-?"]),
        "@glob.key:(api-* OR web-?)",
      ],
      ["http.status_code", new GreaterThan(500), "@http.status_code:>500"],
    ];

    for (const [attributeKey, pinned, searchToken] of cases) {
      expect(
        Scope.describeLogsLockedChip(
          chip({
            facetKey: `attributes.${attributeKey}`,
            value: "display text",
            displayValue: "display text",
          }),
          { logQueryAttributes: { [attributeKey]: pinned } as never },
        ),
      ).toStrictEqual({ searchToken });
    }
  });

  test("entity, trace and span chips with an empty value have no token, each with its describer's reason", () => {
    for (const facetKey of ["primaryEntityId", "serviceId"]) {
      expect(
        Scope.describeLogsLockedChip(chip({ facetKey, value: "" }), {}),
      ).toStrictEqual({ searchTokenUnavailableReason: EMPTY_VALUE_REASON });
    }

    for (const facetKey of ["traceId", "spanId"]) {
      expect(
        Scope.describeLogsLockedChip(chip({ facetKey, value: "" }), {}),
      ).toStrictEqual({
        searchTokenUnavailableReason: NO_SEARCH_SYNTAX_REASON,
      });
    }

    // A span id that needs quoting is quoted, not refused.
    expect(
      Scope.describeLogsLockedChip(
        chip({ facetKey: "spanId", value: "span 1" }),
        {},
      ),
    ).toStrictEqual({ searchToken: 'span:"span 1"' });
  });

  test("a session chip has no token whatever its value, and a user's session chip is not described at all", () => {
    for (const value of ["sess-1", ""]) {
      expect(
        Scope.describeLogsLockedChip(
          chip({ facetKey: "sessionId", value }),
          {},
        ),
      ).toStrictEqual({
        searchTokenUnavailableReason: SESSION_NO_SYNTAX_REASON,
      });
    }

    const userSession: ActiveFilter = chip({
      facetKey: "sessionId",
      value: "sess-1",
      readOnly: false,
    });

    expect(Scope.attachLogsLockedFilterDetails([userSession], {})[0]).toBe(
      userSession,
    );
  });
});

describe("attachLogsLockedFilterDetails", () => {
  test("decorates only read-only chips and leaves the rest as the same objects", () => {
    const removable: ActiveFilter = chip({
      facetKey: "severityText",
      value: "Error",
      displayKey: "Severity",
      displayValue: "Error",
      readOnly: false,
    });
    const unknown: ActiveFilter = chip({
      facetKey: "kind",
      value: "server",
      displayKey: "Kind",
    });
    const locked: ActiveFilter = chip({});

    const result: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [removable, unknown, locked],
      { logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" } },
    );

    expect(result[0]).toBe(removable);
    expect(result[1]).toBe(unknown);
    expect(result[2]).not.toBe(locked);
    expect(result[2]!.lockedDetail).toEqual(CLUSTER_DETAIL);
    // Everything the chip carried survives the decoration.
    expect(result[2]!.facetKey).toBe(locked.facetKey);
    expect(result[2]!.value).toBe(locked.value);
    expect(result[2]!.readOnly).toBe(true);
    // The input array is not mutated.
    expect(locked.lockedDetail).toBeUndefined();
  });
});

describe("attachLogsLockedFilterDetails — every locked chip carries its own search syntax", () => {
  test("each locked attribute chip is spelled on its own; the removable chip gets nothing", () => {
    const removable: ActiveFilter = chip({
      facetKey: "severityText",
      value: "Error",
      displayKey: "Severity",
      displayValue: "Error",
      readOnly: false,
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        chip({}),
        chip({
          facetKey: "attributes.resource.container.runtime",
          value: "docker",
          displayKey: "Runtime",
          displayValue: "docker",
        }),
        removable,
      ],
      {
        logQueryAttributes: {
          "resource.k8s.cluster.name": "prod-eks-01",
          "resource.container.runtime": "docker",
        },
      },
    );

    expect(tokensOf(decorated)).toEqual([
      "@resource.k8s.cluster.name:prod-eks-01",
      "@resource.container.runtime:docker",
      undefined,
    ]);
    expect(detailsOf(decorated)).toEqual([
      { searchToken: "@resource.k8s.cluster.name:prod-eks-01" },
      { searchToken: "@resource.container.runtime:docker" },
      undefined,
    ]);
    expect(decorated[2]).toBe(removable);
  });

  test("an operator-valued pinned attribute is spelled from the operator, beside a plain one", () => {
    const attributes: Record<string, unknown> = {
      "resource.host.name": "web-01",
      "k8s.namespace.name": new Search("pay"),
    };

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        chip({
          facetKey: "attributes.resource.host.name",
          value: "web-01",
          displayKey: "Host",
          displayValue: "web-01",
        }),
        chip({
          facetKey: "attributes.k8s.namespace.name",
          value: "contains pay",
          displayKey: "Namespace",
          displayValue: "contains pay",
        }),
      ],
      { logQueryAttributes: attributes as never },
    );

    // The search bar can say "contains"; the chip's display text cannot.
    expect(tokensOf(decorated)).toEqual([
      "@resource.host.name:web-01",
      "@k8s.namespace.name:~pay",
    ]);

    for (const decoratedChip of decorated) {
      expect(
        decoratedChip.lockedDetail!.searchTokenUnavailableReason,
      ).toBeUndefined();
    }
    expect(detailsOf(decorated)).toEqual([
      { searchToken: "@resource.host.name:web-01" },
      { searchToken: "@k8s.namespace.name:~pay" },
    ]);
  });
});

/*
 * An Inventory item's pages scope by `logQuery.entityKeys` alone. The chips
 * come from the shared builder with their search syntax (or the reason there
 * is none) already attached, spelled from the item's identifying attributes.
 * The viewer then runs every locked chip through
 * attachLogsLockedFilterDetails, which has no describer for the entity-key
 * column: those chips pass through as the same objects, keeping exactly the
 * detail the builder gave them. The grammar itself is owned by
 * LockedTelemetryScope.test.ts.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
const DISK_KEY: string = "bbbbbbbbbbbbbbbb";

// The pod's identifying resource attributes, keys without `resource.`.
const POD_SEARCH_ATTRIBUTES: Record<string, string> = {
  "k8s.cluster.name": "prod",
  "k8s.namespace.name": "shop",
  "k8s.pod.name": "checkout-7d9f",
};
const POD_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

const POD_DISPLAYS_WITH_ATTRIBUTES: LockedEntityKeyDisplayMap = {
  [POD_KEY]: {
    displayKey: "Kubernetes Pod",
    displayValue: "checkout-7d9f",
    searchAttributes: POD_SEARCH_ATTRIBUTES,
  },
};

// The node's identifying resource attributes, for pages naming several keys.
const NODE_DISPLAY_WITH_ATTRIBUTES: LockedEntityKeyDisplay = {
  displayKey: "Kubernetes Node",
  displayValue: "ip-10-0-1-7",
  searchAttributes: {
    "k8s.cluster.name": "prod",
    "k8s.node.name": "ip-10-0-1-7",
  },
};
const NODE_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod @resource.k8s.node.name:ip-10-0-1-7";

const POD_DETAIL: LockedFilterDetail = { searchToken: POD_SEARCH_TOKEN };
const NO_ATTRIBUTES_DETAIL: LockedFilterDetail = {
  searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
};

function entityKeyChip(overrides: Partial<ActiveFilter>): ActiveFilter {
  return chip({
    facetKey: "entityKeys",
    value: POD_KEY,
    displayKey: "Kubernetes Pod",
    displayValue: "checkout-7d9f",
    ...overrides,
  });
}

describe("describeLogsLockedChip — entity-key chips", () => {
  test("an entityKeys chip has no describer here: nothing is returned, so no token is ever spelled from the key", () => {
    expect(Scope.describeLogsLockedChip(entityKeyChip({}), {})).toBeUndefined();
    expect(
      Scope.describeLogsLockedChip(
        entityKeyChip({ value: NODE_KEY, displayKey: "Kubernetes Node" }),
        {},
      ),
    ).toBeUndefined();
  });

  test("the chip's display key — the builder's \"Resource\" fallback in any case, or blank — never makes one describable", () => {
    for (const displayKey of ["Resource", "resource", "RESOURCE", "", "   "]) {
      expect(
        Scope.describeLogsLockedChip(
          entityKeyChip({ displayKey, displayValue: POD_KEY }),
          {},
        ),
      ).toBeUndefined();
    }
  });

  test("the page's pinned attributes never spell an entityKeys chip", () => {
    expect(
      Scope.describeLogsLockedChip(entityKeyChip({}), {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
      }),
    ).toBeUndefined();
  });
});

describe("attachLogsLockedFilterDetails — entity-key chips", () => {
  test("a chip from the shared builder passes through as the same object, keeping the detail it was built with — one key", () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
        },
      },
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      {},
    );

    expect(decorated).toHaveLength(1);
    expect(decorated[0]).toBe(built[0]);
    expect(decorated[0]!.lockedDetail).toEqual(NO_ATTRIBUTES_DETAIL);
    expect(decorated[0]!.lockedDetail).toEqual(
      describeLockedEntityKeyFilter({ rows: "logs" }),
    );
    // Everything else the chip carried is untouched.
    expect({ ...decorated[0]!, lockedDetail: undefined }).toEqual({
      facetKey: "entityKeys",
      value: POD_KEY,
      displayKey: "Kubernetes Pod",
      displayValue: "checkout-7d9f",
      readOnly: true,
      lockedDetail: undefined,
    });
  });

  test("every builder chip passes through unchanged — without a display map, with an empty one, with blank or padded display strings, and with search attributes", () => {
    const displayVariants: Array<LockedEntityKeyDisplayMap | undefined> = [
      undefined,
      {},
      { [POD_KEY]: { displayKey: "   ", displayValue: "" } },
      { [POD_KEY]: { displayKey: "  Host  ", displayValue: "  web-01 " } },
      POD_DISPLAYS_WITH_ATTRIBUTES,
    ];
    const keyVariants: Array<Array<string>> = [
      [POD_KEY],
      [POD_KEY, NODE_KEY],
      [` ${POD_KEY}`, POD_KEY, "", NODE_KEY],
    ];

    for (const displays of displayVariants) {
      for (const entityKeys of keyVariants) {
        const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys,
          displays,
        });

        // The decoration is handed no display map at all.
        const decorated: Array<ActiveFilter> =
          Scope.attachLogsLockedFilterDetails(built, {});

        expect(decorated).toHaveLength(built.length);
        decorated.forEach((decoratedChip: ActiveFilter, index: number) => {
          expect(decoratedChip).toBe(built[index]);
        });

        // Only the pod, and only when the map names its attributes, is spelled.
        expect(detailsOf(decorated)).toEqual(
          built.map((builtChip: ActiveFilter): LockedFilterDetail => {
            return builtChip.value === POD_KEY &&
              displays === POD_DISPLAYS_WITH_ATTRIBUTES
              ? POD_DETAIL
              : NO_ATTRIBUTES_DETAIL;
          }),
        );
      }
    }
  });

  test("attachLogsLockedFilterDetails keeps the builder's entity-key token (same chip object) with no displays input", () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(tokensOf(built)).toEqual([POD_SEARCH_TOKEN, undefined]);

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      {},
    );

    expect(decorated[0]).toBe(built[0]);
    expect(decorated[1]).toBe(built[1]);
    expect(tokensOf(decorated)).toEqual([POD_SEARCH_TOKEN, undefined]);
    expect(decorated[0]!.lockedDetail!.searchToken).toBe(POD_SEARCH_TOKEN);
    expect(
      decorated[0]!.lockedDetail!.searchTokenUnavailableReason,
    ).toBeUndefined();
    expect(detailsOf(decorated)).toEqual([POD_DETAIL, NO_ATTRIBUTES_DETAIL]);
    // The key the page named no attributes for still has no syntax.
    expect(decorated[1]!.lockedDetail!.searchToken).toBeUndefined();
    expect(decorated[1]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  });

  test("on a page pinning several keys, each builder chip keeps the syntax of its OWN key — or the reason, when the page named no attributes for it", () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY, DISK_KEY],
      displays: {
        ...POD_DISPLAYS_WITH_ATTRIBUTES,
        [NODE_KEY]: NODE_DISPLAY_WITH_ATTRIBUTES,
      },
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      { logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" } },
    );

    decorated.forEach((decoratedChip: ActiveFilter, index: number) => {
      expect(decoratedChip).toBe(built[index]);
    });
    expect(detailsOf(decorated)).toEqual([
      POD_DETAIL,
      { searchToken: NODE_SEARCH_TOKEN },
      NO_ATTRIBUTES_DETAIL,
    ]);
    expect(decorated[2]!.lockedDetail!.searchToken).toBeUndefined();
  });

  test("a detail-less entity-key chip passes through with no detail — the same object, never described here", () => {
    const bare: Array<ActiveFilter> = [
      entityKeyChip({ displayKey: "Resource", displayValue: POD_KEY }),
      entityKeyChip({
        value: NODE_KEY,
        displayKey: "Resource",
        displayValue: NODE_KEY,
      }),
    ];

    expect(bare[0]!.lockedDetail).toBeUndefined();

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      bare,
      {},
    );

    expect(decorated[0]).toBe(bare[0]);
    expect(decorated[1]).toBe(bare[1]);
    expect(detailsOf(decorated)).toEqual([undefined, undefined]);
    expect(tokensOf(decorated)).toEqual([undefined, undefined]);
  });

  test("a removable entityKeys chip is the user's: passed through as the same object with no detail, beside a locked builder chip that keeps its own", () => {
    const lockedPod: ActiveFilter = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS_WITH_ATTRIBUTES,
    })[0]!;
    const userChip: ActiveFilter = entityKeyChip({
      value: NODE_KEY,
      displayKey: "Resource",
      displayValue: NODE_KEY,
      readOnly: false,
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [lockedPod, userChip],
      {},
    );

    expect(decorated[1]).toBe(userChip);
    expect(decorated[1]!.lockedDetail).toBeUndefined();
    expect(decorated[0]).toBe(lockedPod);
    expect(decorated[0]!.lockedDetail).toEqual(POD_DETAIL);
  });

  test("decoration keeps the chip order the viewer built: entity id, entity key, trace, session, attribute, then the user's chips", () => {
    const userSeverity: ActiveFilter = chip({
      facetKey: "severityText",
      value: "Error",
      displayKey: "Severity",
      displayValue: "Error",
      readOnly: false,
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        chip({
          facetKey: "primaryEntityId",
          value: "651a000000000000000000aa",
          displayKey: "Service",
          displayValue: "api",
        }),
        ...buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] }),
        chip({ facetKey: "traceId", value: "t-1", displayKey: "Trace" }),
        chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" }),
        chip({}),
        userSeverity,
      ],
      { logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" } },
    );

    expect(
      decorated.map((decoratedChip: ActiveFilter): string => {
        return decoratedChip.facetKey;
      }),
    ).toEqual([
      "primaryEntityId",
      "entityKeys",
      "traceId",
      "sessionId",
      "attributes.resource.k8s.cluster.name",
      "severityText",
    ]);
    expect(decorated[5]).toBe(userSeverity);

    for (const lockedChip of decorated.slice(0, 5)) {
      expect(lockedChip.readOnly).toBe(true);
    }

    // Each locked chip carries its own syntax or reason; the user's none.
    expect(detailsOf(decorated)).toEqual([
      { searchToken: "service:651a000000000000000000aa" },
      NO_ATTRIBUTES_DETAIL,
      { searchToken: "trace:t-1" },
      { searchTokenUnavailableReason: SESSION_NO_SYNTAX_REASON },
      CLUSTER_DETAIL,
      undefined,
    ]);
  });

  test("a page with no pinned entity keys gets no entity-key chip at all (Kubernetes-style pages included)", () => {
    expect(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: undefined }),
    ).toEqual([]);

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [chip({})],
      {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
      },
    );

    expect(
      decorated.map((decoratedChip: ActiveFilter): string => {
        return decoratedChip.facetKey;
      }),
    ).toEqual(["attributes.resource.k8s.cluster.name"]);
    // Such a page's scope is its attribute chip, spelled from the pinned value.
    expect(decorated[0]!.lockedDetail).toEqual(CLUSTER_DETAIL);
  });
});

describe("attachLogsLockedFilterDetails — the search syntax of an entity-key scope", () => {
  function inventoryChips(entityKeys: Array<string>): Array<ActiveFilter> {
    return Scope.attachLogsLockedFilterDetails(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys,
        displays: {
          [POD_KEY]: {
            displayKey: "Kubernetes Pod",
            displayValue: "checkout-7d9f",
          },
        },
      }),
      {},
    );
  }

  test("an entity-key-only scope whose page names no attributes has no search syntax on any chip, and every chip says why", () => {
    /*
     * The logs grammar has no entity-key token, and without the item's
     * identifying attributes there is nothing else to spell the scope with.
     * More keys are not more to spell.
     */
    for (const entityKeys of [[POD_KEY], [POD_KEY, NODE_KEY, DISK_KEY]]) {
      const chips: Array<ActiveFilter> = inventoryChips(entityKeys);

      expect(chips).toHaveLength(entityKeys.length);

      for (const inventoryChip of chips) {
        expect(inventoryChip.lockedDetail!.searchToken).toBeUndefined();
        expect(inventoryChip.lockedDetail!.searchTokenUnavailableReason).toBe(
          ENTITY_KEY_NO_ATTRIBUTES_REASON,
        );
        expect(inventoryChip.lockedDetail).toEqual(NO_ATTRIBUTES_DETAIL);
      }
    }
  });

  test("a bare entityKeys chip with no detail stays detail-less even beside pinned attributes — never a token spelled from the key", () => {
    const bare: ActiveFilter = entityKeyChip({
      displayKey: "Resource",
      displayValue: POD_KEY,
    });
    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [bare],
      { logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" } },
    );

    expect(decorated[0]).toBe(bare);
    expect(tokensOf(decorated)).toEqual([undefined]);
    expect(detailsOf(decorated)).toEqual([undefined]);
  });

  test("a mixed scope: the attribute chip keeps its token, the entity-key chip has none, the user's chip is left alone", () => {
    const chips: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        ...buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: [POD_KEY],
        }),
        chip({}),
        chip({
          facetKey: "severityText",
          value: "Error",
          displayKey: "Severity",
          displayValue: "Error",
          readOnly: false,
        }),
      ],
      {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
      },
    );

    expect(tokensOf(chips)).toEqual([
      undefined,
      "@resource.k8s.cluster.name:prod-eks-01",
      undefined,
    ]);
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
    expect(chips[1]!.lockedDetail).toEqual(CLUSTER_DETAIL);
    expect(chips[2]!.lockedDetail).toBeUndefined();
  });

  test("an entity key plus a session: neither has search syntax, and each gives its own reason", () => {
    const chips: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        ...buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] }),
        chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" }),
      ],
      {},
    );

    expect(tokensOf(chips)).toEqual([undefined, undefined]);
    expect(
      chips.map((each: ActiveFilter): string | undefined => {
        return each.lockedDetail!.searchTokenUnavailableReason;
      }),
    ).toEqual([ENTITY_KEY_NO_ATTRIBUTES_REASON, SESSION_NO_SYNTAX_REASON]);
    expect(detailsOf(chips)).toEqual([
      NO_ATTRIBUTES_DETAIL,
      { searchTokenUnavailableReason: SESSION_NO_SYNTAX_REASON },
    ]);
  });

  test("an operator-valued attribute keeps its token alone and beside an entity key", () => {
    const attributes: Record<string, unknown> = {
      "k8s.namespace.name": new Search("pay"),
    };
    const operatorChip: ActiveFilter = chip({
      facetKey: "attributes.k8s.namespace.name",
      value: "contains pay",
      displayKey: "Namespace",
      displayValue: "contains pay",
    });

    expect(
      tokensOf(
        Scope.attachLogsLockedFilterDetails([operatorChip], {
          logQueryAttributes: attributes as never,
        }),
      ),
    ).toEqual(["@k8s.namespace.name:~pay"]);

    const besideEntityKey: Array<ActiveFilter> =
      Scope.attachLogsLockedFilterDetails(
        [
          ...buildLockedEntityKeyChips({
            rows: "logs",
            entityKeys: [POD_KEY],
          }),
          operatorChip,
        ],
        { logQueryAttributes: attributes as never },
      );

    expect(tokensOf(besideEntityKey)).toEqual([
      undefined,
      "@k8s.namespace.name:~pay",
    ]);
    expect(detailsOf(besideEntityKey)).toEqual([
      NO_ATTRIBUTES_DETAIL,
      { searchToken: "@k8s.namespace.name:~pay" },
    ]);
  });
});
