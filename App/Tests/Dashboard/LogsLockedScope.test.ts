import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
/*
 * Pure modules, imported statically: none reaches `window`, and the chips
 * the viewer builds come from here, so the glue is exercised on real chips.
 */
import * as Scope from "../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  LOCKED_FILTER_SOURCE_PAGE,
  LOCKED_FILTER_SOURCE_STORED_QUERY,
  SESSION_NO_SYNTAX_REASON,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The logs viewer's glue for the locked-filter explainer: which describer
 * each locked chip gets (by the column it filters), and that what the page
 * pinned — raw attribute values, its entity scope, who pinned its entity
 * keys and the attributes that name them — reaches the describers, so every
 * chip carries the search syntax (or the reason there is none) its tooltip
 * shows. The wording and the search grammar themselves are pinned in
 * LockedTelemetryScope.test.ts; this suite pins the dispatch.
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

describe("describeLogsLockedChip", () => {
  test("an attribute chip is explained from the PINNED value, with the page's entity scope", () => {
    const detail: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(chip({}), {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
        entityScope: {
          entityKeys: ["3f9a1b2c4d5e6f70"],
          attributeKey: "resource.k8s.cluster.name",
          attributeValue: "prod-eks-01",
        },
      });

    expect(detail).toBeDefined();
    expect(detail!.summary).toBe(
      "Only logs from this Kubernetes cluster are shown.",
    );
    // The attribute equality and the entity scope AND together on the page.
    expect(detail!.combinator).toBe("all");
    expect(
      detail!.predicates.map((predicate: { label: string }): string => {
        return predicate.label;
      }),
    ).toEqual(["Attribute", "Entity scope"]);
    expect(detail!.predicates[1]!.expression).toBe(
      'entityKeys has 3f9a1b2c4d5e6f70 OR resource.k8s.cluster.name = "prod-eks-01"',
    );
    expect(detail!.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
  });

  test("an entity scope for a DIFFERENT attribute is not attached", () => {
    const detail: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
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
          entityScope: {
            entityKeys: ["abc"],
            attributeKey: "resource.host.name",
            attributeValue: "web-01",
          },
        },
      );

    expect(detail!.combinator).toBe("all");
    expect(detail!.predicates).toHaveLength(1);
    expect(detail!.searchToken).toBe("@resource.container.runtime:docker");
  });

  test("an operator-valued pinned attribute is explained from the operator, never from the chip's display text, and spelled in the grammar", () => {
    const detail: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
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

    expect(detail!.predicates[0]!.expression).toContain("k8s.namespace.name");
    expect(detail!.predicates[0]!.expression).not.toContain('= "is any of');
    // The PINNED value is what gets spelled; the display text would be wrong.
    expect(detail!.searchToken).toBe(
      "@k8s.namespace.name:(payments OR checkout)",
    );
    expect(detail!.searchTokenUnavailableReason).toBeUndefined();
  });

  test("a chip whose key the page did not pin is explained from its own text", () => {
    const detail: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(chip({}), {});

    expect(detail!.predicates[0]!.expression).toBe(
      'resource.k8s.cluster.name = "prod-eks-01"',
    );
    expect(detail!.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
  });

  test("entity, trace, span and session chips get their own describers", () => {
    const entity: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
        chip({
          facetKey: "primaryEntityId",
          value: "651a000000000000000000aa",
          displayKey: "RUM Application",
          displayValue: "checkout-web",
        }),
        {},
      );
    expect(entity!.summary).toBe(
      "Only logs emitted by this RUM Application are shown.",
    );
    expect(entity!.searchToken).toBe("service:651a000000000000000000aa");

    // The pre-rename alias reads as an entity chip too.
    expect(
      Scope.describeLogsLockedChip(
        chip({
          facetKey: "serviceId",
          value: "651a000000000000000000aa",
          displayKey: "Service",
          displayValue: "api",
        }),
        {},
      )!.searchToken,
    ).toBe("service:651a000000000000000000aa");

    const trace: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
        chip({ facetKey: "traceId", value: "t-1", displayKey: "Trace" }),
        {},
      );
    expect(trace!.searchToken).toBe("trace:t-1");
    expect(trace!.predicates[0]!.label).toBe("Trace ID");

    const span: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
        chip({ facetKey: "spanId", value: "s-1", displayKey: "Span" }),
        {},
      );
    expect(span!.searchToken).toBe("span:s-1");

    const session: ReturnType<typeof Scope.describeLogsLockedChip> =
      Scope.describeLogsLockedChip(
        chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" }),
        {},
      );
    expect(session!.searchToken).toBeUndefined();
    expect(session!.searchTokenUnavailableReason).toBe(
      SESSION_NO_SYNTAX_REASON,
    );
  });

  test("a column with no describer keeps a plain chip", () => {
    expect(
      Scope.describeLogsLockedChip(
        chip({ facetKey: "kind", value: "server", displayKey: "Kind" }),
        {},
      ),
    ).toBeUndefined();
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
    expect(result[2]!.lockedDetail).toBeDefined();
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
  });
});

/*
 * An Inventory item's pages scope by `logQuery.entityKeys` alone. The chips
 * come from the shared builder with an explanation already attached; the
 * viewer then runs every locked chip through attachLogsLockedFilterDetails,
 * which must describe the entity-key column itself — and must not trade the
 * builder's multi-key wording (its source, or the search syntax spelled from
 * the item's identifying attributes) for the single-key sentence on the way.
 * The wording itself is owned by LockedTelemetryScope.test.ts.
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

function entityKeyChip(overrides: Partial<ActiveFilter>): ActiveFilter {
  return chip({
    facetKey: "entityKeys",
    value: POD_KEY,
    displayKey: "Kubernetes Pod",
    displayValue: "checkout-7d9f",
    ...overrides,
  });
}

function detailsOf(chips: Array<ActiveFilter>): Array<unknown> {
  return chips.map((each: ActiveFilter): unknown => {
    return each.lockedDetail;
  });
}

describe("describeLogsLockedChip — entity-key chips", () => {
  test("an entityKeys chip is explained as a membership named by the chip's key, and has no search syntax when the page names no attributes", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      entityKeyChip({}),
      {},
    );

    expect(detail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "logs",
        entityKey: POD_KEY,
        entityTypeLabel: "Kubernetes Pod",
      }),
    );
    expect(detail!.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
    expect(detail!.source).toBe(LOCKED_FILTER_SOURCE_PAGE);
    expect(detail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
    // No token at all — the key itself must never be spelled as one.
    expect(detail!.searchToken).toBeUndefined();
  });

  test("the page's display map reaches the describer: the chip is spelled with the attributes named for ITS key", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      entityKeyChip({}),
      { entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES },
    );

    expect(detail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "logs",
        entityKey: POD_KEY,
        entityTypeLabel: "Kubernetes Pod",
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      }),
    );
    expect(detail!.searchToken).toBe(POD_SEARCH_TOKEN);
    expect(detail!.searchTokenUnavailableReason).toBeUndefined();
    // The attributes change the syntax only, never what the chip says.
    expect(detail!.summary).toBe(
      Scope.describeLogsLockedChip(entityKeyChip({}), {})!.summary,
    );

    // Attributes named for another key do not spell this chip.
    const other: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      entityKeyChip({ value: NODE_KEY, displayKey: "Resource" }),
      { entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES },
    );

    expect(other!.searchToken).toBeUndefined();
    expect(other!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  });

  test('the builder\'s "Resource" fallback key reads as "this resource", in any case', () => {
    for (const displayKey of ["Resource", "resource", "RESOURCE"]) {
      expect(
        Scope.describeLogsLockedChip(
          entityKeyChip({ displayKey, displayValue: POD_KEY }),
          {},
        )!.summary,
      ).toBe("Only logs linked to this resource are shown.");
    }
  });

  test('a blank chip key falls back to "resource" rather than a sentence with a hole in it', () => {
    for (const displayKey of ["", "   "]) {
      expect(
        Scope.describeLogsLockedChip(entityKeyChip({ displayKey }), {})!
          .summary,
      ).toBe("Only logs linked to this resource are shown.");
    }
  });

  test("with the page's other keys, each chip says the scope WIDENS — the column is matched with hasAny", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      entityKeyChip({ value: NODE_KEY, displayKey: "Kubernetes Node" }),
      { entityKeys: [POD_KEY, NODE_KEY, DISK_KEY] },
    );

    expect(detail!.summary).toBe(
      "Logs linked to this Kubernetes Node are shown, along with logs linked to the 2 other resources this page pins.",
    );
    // Described from the chip's own key and label, told of every page key.
    expect(detail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "logs",
        entityKey: NODE_KEY,
        entityKeys: [POD_KEY, NODE_KEY, DISK_KEY],
        entityTypeLabel: "Kubernetes Node",
      }),
    );
    expect(detail!.combinator).toBe("all");
    expect(detail!.searchToken).toBeUndefined();
    expect(detail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  });

  test('one other key is "1 other resource", singular', () => {
    expect(
      Scope.describeLogsLockedChip(entityKeyChip({}), {
        entityKeys: [POD_KEY, NODE_KEY],
      })!.summary,
    ).toBe(
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 1 other resource this page pins.",
    );
  });

  test("the page's key list is normalised: blanks, duplicates, padding and the chip's own key are not counted", () => {
    const detail: LockedFilterDetail | undefined = Scope.describeLogsLockedChip(
      entityKeyChip({}),
      {
        entityKeys: [
          ` ${POD_KEY} `,
          "",
          POD_KEY,
          "   ",
          NODE_KEY,
          `${NODE_KEY} `,
        ],
      },
    );

    expect(detail!.summary).toBe(
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 1 other resource this page pins.",
    );
    expect(detail!.predicates[0]!.expression).toBe(
      "entityKeys has any of 3f9a1b2c4d5e6f70, aaaaaaaaaaaaaaaa",
    );
  });

  test("a key list holding only the chip's own key reads as the single-key sentence", () => {
    expect(
      Scope.describeLogsLockedChip(entityKeyChip({}), {
        entityKeys: [POD_KEY, ` ${POD_KEY}`],
      }),
    ).toEqual(Scope.describeLogsLockedChip(entityKeyChip({}), {}));
  });

  test("a Kubernetes-style entity scope on the input never leaks into an entityKeys chip's explanation", () => {
    const withScope: LockedFilterDetail | undefined =
      Scope.describeLogsLockedChip(entityKeyChip({}), {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
        entityScope: {
          entityKeys: [NODE_KEY, DISK_KEY],
          attributeKey: "resource.k8s.cluster.name",
          attributeValue: "prod-eks-01",
        },
      });

    expect(withScope).toEqual(
      Scope.describeLogsLockedChip(entityKeyChip({}), {}),
    );
  });
});

describe("attachLogsLockedFilterDetails — entity-key chips", () => {
  test("a chip from the shared builder is re-described to exactly the explanation it was built with — one key", () => {
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
    expect(decorated[0]!.lockedDetail).toEqual(built[0]!.lockedDetail);
    expect(decorated[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
    // Everything else the chip carried survives the decoration.
    expect({ ...decorated[0]!, lockedDetail: undefined }).toEqual({
      facetKey: "entityKeys",
      value: POD_KEY,
      displayKey: "Kubernetes Pod",
      displayValue: "checkout-7d9f",
      readOnly: true,
      lockedDetail: undefined,
    });
  });

  test('...and with several keys the "along with the N other resources" wording survives, with no key list passed in', () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY, DISK_KEY],
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

    expect(detailsOf(decorated)).toEqual(detailsOf(built));
    expect(
      decorated.map((decoratedChip: ActiveFilter): string => {
        return decoratedChip.lockedDetail!.summary;
      }),
    ).toEqual([
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 2 other resources this page pins.",
      "Logs linked to this resource are shown, along with logs linked to the 2 other resources this page pins.",
      "Logs linked to this resource are shown, along with logs linked to the 2 other resources this page pins.",
    ]);
  });

  test("parity holds without a display map, with an empty one, with blank or padded display strings, and with search attributes", () => {
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

        // The viewer hands the decoration the same map it built the chips with.
        expect(
          detailsOf(
            Scope.attachLogsLockedFilterDetails(built, {
              entityKeyDisplays: displays,
            }),
          ),
        ).toEqual(detailsOf(built));
      }
    }
  });

  test("the item's search syntax survives the decoration only when the display map is passed — which is why the viewer passes it", () => {
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(tokensOf(built)).toEqual([POD_SEARCH_TOKEN, undefined]);

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      { entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES },
    );

    expect(detailsOf(decorated)).toEqual(detailsOf(built));
    // The key the page named no attributes for still has no syntax.
    expect(decorated[1]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );

    const withoutMap: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      {},
    );

    expect(tokensOf(withoutMap)).toEqual([undefined, undefined]);
    expect(withoutMap[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
  });

  test("a bare entityKeys chip (no detail attached upstream) still gets its explanation, multi-key wording included", () => {
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

    expect(decorated[0]!.lockedDetail!.summary).toBe(
      "Logs linked to this resource are shown, along with logs linked to the 1 other resource this page pins.",
    );
    expect(decorated[1]!.lockedDetail!.predicates[0]!.expression).toBe(
      "entityKeys has any of aaaaaaaaaaaaaaaa, 3f9a1b2c4d5e6f70",
    );
    // The input chips are not mutated.
    expect(bare[0]!.lockedDetail).toBeUndefined();
    expect(bare[1]!.lockedDetail).toBeUndefined();
  });

  test("a removable entityKeys chip is the user's: passed through as the same object and never counted as a pinned key", () => {
    const userChip: ActiveFilter = entityKeyChip({
      value: NODE_KEY,
      displayKey: "Resource",
      displayValue: NODE_KEY,
      readOnly: false,
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [entityKeyChip({}), userChip],
      {},
    );

    expect(decorated[1]).toBe(userChip);
    expect(decorated[1]!.lockedDetail).toBeUndefined();
    expect(decorated[0]!.lockedDetail!.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
  });

  test("keys a stored query pinned keep that source through the decoration — never re-described as the page's", () => {
    /*
     * An incident's log snapshot: the builder is told the stored query
     * pinned the keys, and this step re-describes every entity-key chip, so
     * it has to be told the same or it restores "Pinned by this page".
     */
    const built: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY, NODE_KEY],
      source: LOCKED_FILTER_SOURCE_STORED_QUERY,
    });

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      built,
      { entityKeysSource: LOCKED_FILTER_SOURCE_STORED_QUERY },
    );

    expect(detailsOf(decorated)).toEqual(detailsOf(built));

    for (const decoratedChip of decorated) {
      expect(decoratedChip.lockedDetail!.source).toBe(
        LOCKED_FILTER_SOURCE_STORED_QUERY,
      );
      expect(decoratedChip.lockedDetail!.summary).toBe(
        "Logs linked to this resource are shown, along with logs linked to the 1 other resource the stored query pins.",
      );
    }

    // Without the source the decoration falls back to the page — which is why the viewer passes it.
    expect(
      Scope.attachLogsLockedFilterDetails(built, {})[0]!.lockedDetail!.source,
    ).toBe(LOCKED_FILTER_SOURCE_PAGE);
  });

  test("a key list the caller names wins over the chips", () => {
    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [entityKeyChip({})],
      { entityKeys: [POD_KEY, NODE_KEY] },
    );

    expect(decorated[0]!.lockedDetail!.summary).toBe(
      "Logs linked to this Kubernetes Pod are shown, along with logs linked to the 1 other resource this page pins.",
    );
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
      expect(lockedChip.lockedDetail).toBeDefined();
    }

    // Other locked chips never make an entity-key chip read as "one of several".
    expect(decorated[1]!.lockedDetail!.summary).toBe(
      "Only logs linked to this resource are shown.",
    );
  });

  test("a page with no pinned entity keys gets no entity-key chip at all (Kubernetes-style pages included)", () => {
    expect(
      buildLockedEntityKeyChips({ rows: "logs", entityKeys: undefined }),
    ).toEqual([]);

    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [chip({})],
      {
        logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
        entityScope: {
          entityKeys: [POD_KEY],
          attributeKey: "resource.k8s.cluster.name",
          attributeValue: "prod-eks-01",
        },
      },
    );

    expect(
      decorated.map((decoratedChip: ActiveFilter): string => {
        return decoratedChip.facetKey;
      }),
    ).toEqual(["attributes.resource.k8s.cluster.name"]);
    // The attribute chip is the one that explains the entity keys.
    expect(decorated[0]!.lockedDetail!.predicates[1]!.expression).toBe(
      'entityKeys has 3f9a1b2c4d5e6f70 OR resource.k8s.cluster.name = "prod-eks-01"',
    );
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
      }
    }
  });

  test("a bare entityKeys chip with no detail gets the same reason — never a token spelled from the key", () => {
    const decorated: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [entityKeyChip({ displayKey: "Resource", displayValue: POD_KEY })],
      {},
    );

    expect(tokensOf(decorated)).toEqual([undefined]);
    expect(decorated[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
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

    expect(
      tokensOf(
        Scope.attachLogsLockedFilterDetails(
          [
            ...buildLockedEntityKeyChips({
              rows: "logs",
              entityKeys: [POD_KEY],
            }),
            operatorChip,
          ],
          { logQueryAttributes: attributes as never },
        ),
      ),
    ).toEqual([undefined, "@k8s.namespace.name:~pay"]);
  });
});
