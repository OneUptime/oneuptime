import { beforeAll, describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
/*
 * Pure modules, imported statically: neither reaches `window`, and the chips
 * the viewer builds come from here, so the glue is exercised on real chips.
 */
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  CANNOT_TRAVEL_REASON,
  LOCKED_FILTER_SOURCE_PAGE,
  LOCKED_FILTER_SOURCE_STORED_QUERY,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The logs viewer's glue for the locked-filter explainer: which describer
 * each locked chip gets (by the column it filters), that the page's pinned
 * raw values and entity scope reach the attribute describer, and that the
 * "Copy filter" / "Open in Logs" actions are built from the locked chips
 * alone — and degrade to copy-only when the explorer route cannot be
 * resolved. The wording and URL grammar themselves are pinned in
 * LockedTelemetryScope.test.ts; this suite pins the dispatch.
 */

type ScopeModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope");

let Scope: ScopeModule;

const PROJECT_ID: string = "2d1a3f6e-0f7b-4c1d-9a2e-8b3c4d5e6f70";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/abc123/logs`;

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

/*
 * The link builder reads the current URL through Navigation, and
 * Common/UI/Config reads `window` the moment it loads — the browser stub has
 * to exist before the module is imported (same approach as
 * LockedTelemetryScope.test.ts).
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: PAGE_PATH,
      search: "",
      hash: "",
      href: `https://app.example.com${PAGE_PATH}`,
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Scope = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope"
  );
});

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

function filtersOf(actions: LockedFilterActionOptions | undefined): unknown {
  const raw: string | null = new globalThis.URL(
    actions!.openExplorerRoute!.toString(),
  ).searchParams.get("filters");

  return raw === null ? null : JSON.parse(raw);
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
    expect(session!.searchTokenUnavailableReason).toContain("Open in Logs");
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

describe("buildLogsLockedFilterActions", () => {
  test("nothing locked → nothing to offer", () => {
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: [
          chip({
            facetKey: "severityText",
            value: "Error",
            readOnly: false,
          }),
        ],
        timeRange: PAST_ONE_HOUR,
      }),
    ).toBeUndefined();
  });

  test("copy text and the explorer link cover every locked chip, removable chips excluded", () => {
    const locked: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        chip({}),
        chip({
          facetKey: "attributes.resource.container.runtime",
          value: "docker",
          displayKey: "Runtime",
          displayValue: "docker",
        }),
        chip({
          facetKey: "severityText",
          value: "Error",
          displayKey: "Severity",
          displayValue: "Error",
          readOnly: false,
        }),
      ],
      {
        logQueryAttributes: {
          "resource.k8s.cluster.name": "prod-eks-01",
          "resource.container.runtime": "docker",
        },
      },
    );

    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips: locked,
        logQueryAttributes: {
          "resource.k8s.cluster.name": "prod-eks-01",
          "resource.container.runtime": "docker",
        },
        timeRange: PAST_ONE_HOUR,
      });

    expect(actions!.copyText).toBe(
      "@resource.k8s.cluster.name:prod-eks-01 @resource.container.runtime:docker",
    );
    expect(actions!.openExplorerRoute).toBeDefined();
    expect(
      new globalThis.URL(actions!.openExplorerRoute!.toString()).pathname,
    ).toBe(`/dashboard/${PROJECT_ID}/logs`);
    expect(filtersOf(actions)).toEqual([
      ["attributes.resource.k8s.cluster.name", ["prod-eks-01"]],
      ["attributes.resource.container.runtime", ["docker"]],
    ]);
    expect(
      new globalThis.URL(
        actions!.openExplorerRoute!.toString(),
      ).searchParams.get("range"),
    ).toBe(TimeRange.PAST_ONE_HOUR);
    expect(actions!.notCarried).toEqual([]);
  });

  test("an operator-valued pinned attribute is spelled in the copy text (the grammar has it) but the URL chip cannot carry it, and says so", () => {
    const attributes: Record<string, unknown> = {
      "resource.host.name": "web-01",
      "k8s.namespace.name": new Search("pay"),
    };
    const locked: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
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

    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips: locked,
        logQueryAttributes: attributes as never,
        timeRange: PAST_ONE_HOUR,
      });

    /*
     * The search bar can say "contains"; a URL chip is an exact value
     * re-parsed as grammar and cannot, so the link reports it instead.
     */
    expect(actions!.copyText).toBe(
      "@resource.host.name:web-01 @k8s.namespace.name:~pay",
    );
    expect(filtersOf(actions)).toEqual([
      ["attributes.resource.host.name", ["web-01"]],
    ]);
    expect(actions!.notCarried).toEqual(["attribute k8s.namespace.name"]);
  });

  test("a session chip travels in the link (as the sessionId chip the explorer compiles) but has no copy text", () => {
    const locked: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" })],
      {},
    );

    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips: locked,
        timeRange: PAST_ONE_HOUR,
      });

    expect(actions!.copyText).toBeUndefined();
    expect(actions!.openExplorerRoute).toBeDefined();
    expect(filtersOf(actions)).toEqual([["sessionId", ["sess-1"]]]);
    expect(actions!.notCarried).toEqual([]);
    /*
     * ...which is what the chip's own tooltip promised: the two affordances
     * must agree, or the reader is sent to a link that drops the session.
     */
    expect(locked[0]!.lockedDetail!.searchTokenUnavailableReason).toContain(
      "use Open in Logs instead",
    );
  });

  test("without a resolvable explorer route the copy affordance survives alone", () => {
    const previousWindow: unknown = (globalThis as Record<string, unknown>)[
      "window"
    ];
    // No project id in the path: the route cannot be populated.
    (globalThis as Record<string, unknown>)["window"] = {
      ...(previousWindow as Record<string, unknown>),
      location: {
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.example.com/",
      },
    };

    try {
      const actions: LockedFilterActionOptions | undefined =
        Scope.buildLogsLockedFilterActions({
          chips: Scope.attachLogsLockedFilterDetails([chip({})], {}),
          timeRange: PAST_ONE_HOUR,
        });

      /*
       * The link builder throws when it cannot resolve a project (a link to
       * the literal `/dashboard/:projectId/logs` template would be worse
       * than none); the catch keeps the copy affordance and drops the rest.
       */
      expect(actions).toBeDefined();
      expect(actions!.copyText).toBe("@resource.k8s.cluster.name:prod-eks-01");
      expect(actions!.openExplorerRoute).toBeUndefined();
      expect(actions!.notCarried).toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>)["window"] = previousWindow;
    }
  });

  test("with a resolvable route the link names the current project, never the :projectId template", () => {
    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips: Scope.attachLogsLockedFilterDetails([chip({})], {}),
        timeRange: PAST_ONE_HOUR,
      });

    const pathname: string = new globalThis.URL(
      actions!.openExplorerRoute!.toString(),
    ).pathname;

    expect(pathname).toBe(`/dashboard/${PROJECT_ID}/logs`);
    expect(pathname).not.toContain(":projectId");
  });
});

/*
 * An Inventory item's pages scope by `logQuery.entityKeys` alone. The chips
 * come from the shared builder with an explanation already attached; the
 * viewer then runs every locked chip through attachLogsLockedFilterDetails,
 * which must describe the entity-key column itself — and must not trade the
 * builder's multi-key wording (or its source) for the single-key sentence on
 * the way. The wording itself is owned by LockedTelemetryScope.test.ts.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
const DISK_KEY: string = "bbbbbbbbbbbbbbbb";

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
  test("an entityKeys chip is explained as a membership named by the chip's key, and says it cannot travel", () => {
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
    expect(detail!.searchTokenUnavailableReason).toBe(CANNOT_TRAVEL_REASON);
    // No token at all — "Copy filter" must not invent one.
    expect(detail!.searchToken).toBeUndefined();
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
    expect(detail!.searchTokenUnavailableReason).toBe(CANNOT_TRAVEL_REASON);
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

  test("parity holds without a display map, with an empty one, and with blank or padded display strings", () => {
    const displayVariants: Array<LockedEntityKeyDisplayMap | undefined> = [
      undefined,
      {},
      { [POD_KEY]: { displayKey: "   ", displayValue: "" } },
      { [POD_KEY]: { displayKey: "  Host  ", displayValue: "  web-01 " } },
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

        expect(
          detailsOf(Scope.attachLogsLockedFilterDetails(built, {})),
        ).toEqual(detailsOf(built));
      }
    }
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

describe("buildLogsLockedFilterActions — entity-key scopes", () => {
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

  test("an entity-key-only scope offers no actions at all: nothing to copy, and no Open in Logs link that would drop the scope", () => {
    /*
     * No copy text: the logs grammar has no entity-key token. No link: the
     * only URL the link builder can make for this scope is the window alone
     * (carriedFilterCount 0, pinned in LockedTelemetryScopeLink.test.ts),
     * which would open the Logs explorer UNFILTERED under "Open in Logs" —
     * a "not carried over: resource" caveat does not make that link useful.
     * With neither, undefined keeps the actions group from mounting at all;
     * the chip's own tooltip already says the filter cannot travel.
     *
     * Deliberately changed from the earlier expectation of a window-only
     * link carrying that caveat.
     */
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: inventoryChips([POD_KEY]),
        timeRange: PAST_ONE_HOUR,
      }),
    ).toBeUndefined();
  });

  test("a Custom window does not bring the link back — the window was never the problem", () => {
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: inventoryChips([POD_KEY]),
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-08-10T10:00:00.000Z"),
            new Date("2026-08-10T11:00:00.000Z"),
          ),
        },
      }),
    ).toBeUndefined();
  });

  test("the chip's tooltip and the actions agree: it can neither be copied nor carried", () => {
    const chips: Array<ActiveFilter> = inventoryChips([POD_KEY]);

    expect(chips[0]!.lockedDetail!.searchToken).toBeUndefined();
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).toBe(
      "This filter cannot be copied or carried to the explorer.",
    );
    // Never "use Open in Logs instead" — that link would drop the scope.
    expect(chips[0]!.lockedDetail!.searchTokenUnavailableReason).not.toContain(
      "Open in Logs",
    );
  });

  test("several entity keys still offer nothing — more keys are not more to carry", () => {
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: inventoryChips([POD_KEY, NODE_KEY, DISK_KEY]),
        timeRange: PAST_ONE_HOUR,
      }),
    ).toBeUndefined();
  });

  test("a bare entityKeys chip with no detail offers nothing either — no entity-key search token, and no entity-key URL chip", () => {
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: [
          entityKeyChip({ displayKey: "Resource", displayValue: POD_KEY }),
        ],
        timeRange: PAST_ONE_HOUR,
      }),
    ).toBeUndefined();
  });

  test("a mixed scope copies and carries the attribute, and reports only the resource as left behind", () => {
    const attributes: Record<string, unknown> = {
      "resource.k8s.cluster.name": "prod-eks-01",
    };
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
      { logQueryAttributes: attributes as never },
    );

    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips,
        logQueryAttributes: attributes as never,
        timeRange: PAST_ONE_HOUR,
      });

    expect(actions!.copyText).toBe("@resource.k8s.cluster.name:prod-eks-01");
    // The attribute rides, so the link is offered — with the resource caveat.
    expect(actions!.openExplorerRoute).toBeDefined();
    expect(filtersOf(actions)).toEqual([
      ["attributes.resource.k8s.cluster.name", ["prod-eks-01"]],
    ]);
    expect(actions!.notCarried).toEqual(["resource"]);
  });

  test("an entity key plus a session: the session travels, the resource is reported, neither copies", () => {
    const chips: Array<ActiveFilter> = Scope.attachLogsLockedFilterDetails(
      [
        ...buildLockedEntityKeyChips({ rows: "logs", entityKeys: [POD_KEY] }),
        chip({ facetKey: "sessionId", value: "sess-1", displayKey: "Session" }),
      ],
      {},
    );

    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLogsLockedFilterActions({
        chips,
        timeRange: PAST_ONE_HOUR,
      });

    expect(actions!.copyText).toBeUndefined();
    expect(filtersOf(actions)).toEqual([["sessionId", ["sess-1"]]]);
    expect(actions!.notCarried).toEqual(["resource"]);
  });

  test("the rule is what the URL carries, not entity keys: an operator-valued attribute alone keeps Copy and gets no link", () => {
    const attributes: Record<string, unknown> = {
      "k8s.namespace.name": new Search("pay"),
    };
    const operatorChip: ActiveFilter = chip({
      facetKey: "attributes.k8s.namespace.name",
      value: "contains pay",
      displayKey: "Namespace",
      displayValue: "contains pay",
    });

    /*
     * The search grammar can say "contains", so the copy text survives; a
     * URL chip is an exact value and cannot, so the only link would have
     * opened every log in the project.
     */
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: Scope.attachLogsLockedFilterDetails([operatorChip], {
          logQueryAttributes: attributes as never,
        }),
        logQueryAttributes: attributes as never,
        timeRange: PAST_ONE_HOUR,
      }),
    ).toEqual({ copyText: "@k8s.namespace.name:~pay" });

    // Beside an entity key it is still copy only: two locked filters, none carried.
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: Scope.attachLogsLockedFilterDetails(
          [
            ...buildLockedEntityKeyChips({
              rows: "logs",
              entityKeys: [POD_KEY],
            }),
            operatorChip,
          ],
          { logQueryAttributes: attributes as never },
        ),
        logQueryAttributes: attributes as never,
        timeRange: PAST_ONE_HOUR,
      }),
    ).toEqual({ copyText: "@k8s.namespace.name:~pay" });
  });

  test("a user's removable entityKeys chip is not part of the locked scope the actions describe", () => {
    expect(
      Scope.buildLogsLockedFilterActions({
        chips: [
          entityKeyChip({
            displayKey: "Resource",
            displayValue: POD_KEY,
            readOnly: false,
          }),
        ],
        timeRange: PAST_ONE_HOUR,
      }),
    ).toBeUndefined();
  });

  test("an entity-key-only scope with no resolvable explorer route offers nothing — never an empty Copy button", () => {
    const previousWindow: unknown = (globalThis as Record<string, unknown>)[
      "window"
    ];
    (globalThis as Record<string, unknown>)["window"] = {
      ...(previousWindow as Record<string, unknown>),
      location: {
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.example.com/",
      },
    };

    try {
      /*
       * No copy text and no link leaves nothing to render; undefined keeps
       * the actions group from mounting at all.
       */
      expect(
        Scope.buildLogsLockedFilterActions({
          chips: inventoryChips([POD_KEY]),
          timeRange: PAST_ONE_HOUR,
        }),
      ).toBeUndefined();

      // A mixed scope in the same spot keeps its copy text, alone.
      expect(
        Scope.buildLogsLockedFilterActions({
          chips: Scope.attachLogsLockedFilterDetails(
            [
              ...buildLockedEntityKeyChips({
                rows: "logs",
                entityKeys: [POD_KEY],
              }),
              chip({}),
            ],
            {},
          ),
          timeRange: PAST_ONE_HOUR,
        }),
      ).toEqual({ copyText: "@resource.k8s.cluster.name:prod-eks-01" });
    } finally {
      (globalThis as Record<string, unknown>)["window"] = previousWindow;
    }
  });
});
