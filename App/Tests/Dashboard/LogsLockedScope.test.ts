import { beforeAll, describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";

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
