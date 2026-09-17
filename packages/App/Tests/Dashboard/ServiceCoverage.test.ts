import { describe, expect, test } from "@jest/globals";
import {
  computeScopedServiceCoverage,
  type ScopedServiceCoverage,
  type ScopedServiceCoverageInput,
} from "../../FeatureSet/Dashboard/src/Utils/ServiceCoverage";

/*
 * "Quiet services / 27 / no logs in range."
 *
 * That tile was wrong, and wrong in the worst way a monitoring product can
 * be wrong: it was alarming, specific, and confidently derived from two
 * different populations. The project had thirty services; the user had
 * scoped the slice to one host; three services log from that host. The
 * numerator came from the scoped slice, the denominator came from the whole
 * project, and the subtraction manufactured twenty-seven silent services out
 * of a filter the user had applied on purpose.
 *
 * The mirror-image failure on Metrics printed "4 of 3 services", because a
 * synthetic "Unknown Service" was counted in the numerator and not in the
 * denominator.
 *
 * So the single property this module exists to hold is: THE NUMERATOR AND
 * THE DENOMINATOR COME FROM ONE POPULATION. Everything below is written as
 * an invariant over a scope matrix rather than as a handful of examples,
 * because both bugs were individually plausible-looking cases that only
 * disagree with each other when you line the scopes up side by side.
 *
 * The second theme is that a slice with no service dimension must SAY SO
 * rather than print a number. A host-scoped slice cannot answer "how many of
 * my services are quiet" — the services that log from a host are not a set
 * anybody has counted — so the honest output is the flag, and the numbers
 * are zeroed so a caller that ignores the flag renders nothing rather than
 * renders the old lie.
 */

const SERVICE_A: string = "0195d6c1-0000-7000-8000-00000000000a";
const SERVICE_B: string = "0195d6c1-0000-7000-8000-00000000000b";
const SERVICE_C: string = "0195d6c1-0000-7000-8000-00000000000c";
const SERVICE_D: string = "0195d6c1-0000-7000-8000-00000000000d";
const SERVICE_E: string = "0195d6c1-0000-7000-8000-00000000000e";

const FIVE_SERVICES: Array<string> = [
  SERVICE_A,
  SERVICE_B,
  SERVICE_C,
  SERVICE_D,
  SERVICE_E,
];

/*
 * A scope shape plus the population an honest answer would be drawn from,
 * stated independently of the implementation. `populationSize: null` means
 * "this slice has no service population at all" — the host-only case.
 */
interface ScopeShape {
  label: string;
  scopedServiceIds: Array<string>;
  hasNonServiceResourceScope: boolean;
  populationSize: (projectServiceCount: number) => number | null;
}

const SCOPE_SHAPES: Array<ScopeShape> = [
  {
    label: "no scope",
    scopedServiceIds: [],
    hasNonServiceResourceScope: false,
    populationSize: (projectServiceCount: number): number | null => {
      return projectServiceCount;
    },
  },
  {
    label: "service scope of 1",
    scopedServiceIds: [SERVICE_A],
    hasNonServiceResourceScope: false,
    populationSize: (): number | null => {
      return 1;
    },
  },
  {
    label: "service scope of 5",
    scopedServiceIds: FIVE_SERVICES,
    hasNonServiceResourceScope: false,
    populationSize: (): number | null => {
      return 5;
    },
  },
  {
    label: "host-only scope",
    scopedServiceIds: [],
    hasNonServiceResourceScope: true,
    populationSize: (): number | null => {
      return null;
    },
  },
  {
    label: "service + host scope",
    scopedServiceIds: FIVE_SERVICES,
    hasNonServiceResourceScope: true,
    populationSize: (): number | null => {
      return 5;
    },
  },
];

const PROJECT_SERVICE_COUNTS: Array<number> = [0, 1, 5, 30];
const REPORTING_SERVICE_COUNTS: Array<number> = [0, 1, 3];

describe("computeScopedServiceCoverage — one population, across the scope matrix", () => {
  /*
   * The whole matrix in one pass. A per-case test would let a future scope
   * shape be added to the module without being added here; walking the
   * product means a new shape has to be given a population before it can be
   * listed, which is the thinking the original bug skipped.
   *
   * Note which cells are INCOHERENT rather than merely uninteresting: a cell
   * asking for 3 reporting services out of a population of 0 or 1 describes
   * telemetry that cannot exist. Real callers cannot produce it, but a
   * corrupt URL or a race between two fetches can, so those cells are
   * asserted to CLAMP — "0 quiet" — instead of rendering "-2 quiet
   * services", which is the other way a subtraction embarrasses itself on
   * screen.
   */
  test("the numerator never exceeds the denominator, and a meaningless slice prints nothing", () => {
    const actualRows: Array<string> = [];
    const expectedRows: Array<string> = [];
    let coherentCellsChecked: number = 0;
    let clampedCellsChecked: number = 0;

    for (const shape of SCOPE_SHAPES) {
      for (const projectServiceCount of PROJECT_SERVICE_COUNTS) {
        for (const reportingServices of REPORTING_SERVICE_COUNTS) {
          const where: string = `${shape.label} / project=${projectServiceCount} / reporting=${reportingServices}`;

          const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
            scopedServiceIds: shape.scopedServiceIds,
            hasNonServiceResourceScope: shape.hasNonServiceResourceScope,
            projectServiceCount,
            reportingServices,
          });

          /*
           * Nothing here is ever allowed to reach a template as NaN or as a
           * negative count, whatever the caller passed in.
           */
          expect(Number.isInteger(coverage.scopedServiceCount)).toBe(true);
          expect(Number.isInteger(coverage.quietServices)).toBe(true);
          expect(coverage.scopedServiceCount).toBeGreaterThanOrEqual(0);
          expect(coverage.quietServices).toBeGreaterThanOrEqual(0);

          /*
           * "Quiet" is a subset of the denominator by definition. If this
           * ever exceeds it, the tile is subtracting across populations
           * again.
           */
          expect(coverage.quietServices).toBeLessThanOrEqual(
            coverage.scopedServiceCount,
          );

          const populationSize: number | null =
            shape.populationSize(projectServiceCount);

          /*
           * The expected row is derived from the population alone, so the
           * table below is a restatement of the rule and not a transcript of
           * the implementation.
           */
          if (populationSize === null) {
            /*
             * No service dimension: the answer is not zero, it is
             * unavailable. Zeroing both numbers is what keeps a caller that
             * forgets to read the flag from printing the 27.
             */
            expectedRows.push(`${where} -> unanswerable, 0 of 0`);
          } else {
            if (reportingServices <= populationSize) {
              coherentCellsChecked++;
            } else {
              clampedCellsChecked++;
            }

            const quiet: number = Math.max(
              0,
              populationSize - reportingServices,
            );

            expectedRows.push(
              `${where} -> answerable, ${quiet} of ${populationSize}`,
            );
          }

          actualRows.push(
            coverage.isCoverageMeaningful
              ? `${where} -> answerable, ${coverage.quietServices} of ${coverage.scopedServiceCount}`
              : `${where} -> unanswerable, ${coverage.quietServices} of ${coverage.scopedServiceCount}`,
          );

          if (populationSize !== null && reportingServices <= populationSize) {
            // The Metrics failure, stated directly: "4 of 3 services".
            expect(reportingServices).toBeLessThanOrEqual(
              coverage.scopedServiceCount,
            );
          }
        }
      }
    }

    expect(actualRows).toEqual(expectedRows);

    /*
     * Guard the guard: a matrix that walked no cells, or that never reached
     * the clamping branch, would otherwise leave this test green while
     * asserting almost nothing.
     */
    expect(actualRows).toHaveLength(
      SCOPE_SHAPES.length *
        PROJECT_SERVICE_COUNTS.length *
        REPORTING_SERVICE_COUNTS.length,
    );
    expect(coherentCellsChecked).toBeGreaterThan(0);
    expect(clampedCellsChecked).toBeGreaterThan(0);
  });
});

describe("computeScopedServiceCoverage — a host-only scope cannot answer the question", () => {
  /*
   * The exact shipped failure, pinned as a number that must never come back.
   *
   * 30 project services, scoped to one host, three services logging from it:
   * the tile rendered "Quiet services / 27". Twenty-seven services reported
   * as silent when the user had simply filtered them out — a page full of
   * fabricated outage. The scoped denominator exists to prevent precisely
   * this, so 27 is asserted absent rather than merely "not the current
   * output", and it is asserted across the whole reporting range because the
   * old arithmetic produced 30, 29 and 27 from the same broken subtraction.
   */
  test("30 services filtered down to one host never yields 27 quiet services", () => {
    for (const reportingServices of [0, 1, 2, 3]) {
      const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
        scopedServiceIds: [],
        hasNonServiceResourceScope: true,
        projectServiceCount: 30,
        reportingServices,
      });

      expect(coverage.isCoverageMeaningful).toBe(false);
      expect(coverage.quietServices).not.toBe(27);
      expect(coverage.quietServices).toBe(0);
      expect(coverage.scopedServiceCount).toBe(0);
      /*
       * The project total must not leak through as the denominator either;
       * that is the value the bad subtraction was reaching for.
       */
      expect(coverage.scopedServiceCount).not.toBe(30);
    }
  });

  test("the project size is irrelevant to a host-only slice", () => {
    /*
     * A property rather than a case: if the project count changed the
     * output at all, the project population would still be feeding an
     * answer about a host, which is the bug wearing a different number.
     */
    const outputs: Array<string> = [0, 1, 5, 30, 4000].map(
      (projectServiceCount: number): string => {
        return JSON.stringify(
          computeScopedServiceCoverage({
            scopedServiceIds: [],
            hasNonServiceResourceScope: true,
            projectServiceCount,
            reportingServices: 3,
          }),
        );
      },
    );

    expect(new Set(outputs).size).toBe(1);
  });
});

describe("computeScopedServiceCoverage — a service scope counts itself", () => {
  /*
   * The user picked five services. "Quiet" then means "of those five", and
   * the size of the project behind them is none of the tile's business —
   * on a 30-service project, answering 28 would be the same category of lie
   * as the 27 above, just with the arithmetic hidden behind a plausible
   * number.
   */
  test("five scoped services, two reporting -> 3 quiet out of 5, not out of 30", () => {
    const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
      scopedServiceIds: FIVE_SERVICES,
      hasNonServiceResourceScope: false,
      projectServiceCount: 30,
      reportingServices: 2,
    });

    expect(coverage.scopedServiceCount).toBe(5);
    expect(coverage.quietServices).toBe(3);
    expect(coverage.isCoverageMeaningful).toBe(true);
  });

  test("the denominator tracks the selection, not the project, at every selection size", () => {
    for (
      let selected: number = 1;
      selected <= FIVE_SERVICES.length;
      selected++
    ) {
      const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
        scopedServiceIds: FIVE_SERVICES.slice(0, selected),
        hasNonServiceResourceScope: false,
        projectServiceCount: 30,
        reportingServices: 1,
      });

      expect(coverage.scopedServiceCount).toBe(selected);
      expect(coverage.quietServices).toBe(selected - 1);
    }
  });
});

describe("computeScopedServiceCoverage — service + host scope keeps the service dimension", () => {
  /*
   * The two scopes AND together server-side: a slice narrowed to five
   * services AND a host is still a slice OF THOSE FIVE SERVICES, so the
   * question stays answerable. Suppressing the tile here — treating any
   * host scope as disqualifying — would hide a real answer from the user
   * every time they drilled from a service list into a host, which is the
   * over-correction the flag invites.
   */
  test("adding a host to a service scope does not disqualify the count", () => {
    const withoutHost: ScopedServiceCoverage = computeScopedServiceCoverage({
      scopedServiceIds: FIVE_SERVICES,
      hasNonServiceResourceScope: false,
      projectServiceCount: 30,
      reportingServices: 2,
    });

    const withHost: ScopedServiceCoverage = computeScopedServiceCoverage({
      scopedServiceIds: FIVE_SERVICES,
      hasNonServiceResourceScope: true,
      projectServiceCount: 30,
      reportingServices: 2,
    });

    expect(withHost.isCoverageMeaningful).toBe(true);
    expect(withHost.scopedServiceCount).toBe(5);
    expect(withHost).toEqual(withoutHost);
  });
});

describe("computeScopedServiceCoverage — degenerate input degrades, it does not render", () => {
  /*
   * Every one of these inputs is reachable: counts arrive from in-flight
   * aggregation queries that can resolve to undefined, and the scoped id
   * list arrives from a URL a user can hand-edit. The requirement is not
   * that the module guess the right answer, it is that "NaN" and "-2" never
   * reach the tile — a garbled number on a monitoring page is read as an
   * incident.
   */
  const degenerateCases: Array<{
    label: string;
    input: ScopedServiceCoverageInput;
  }> = [
    {
      label: "reporting count arrived as NaN from an unresolved query",
      input: {
        scopedServiceIds: [],
        hasNonServiceResourceScope: false,
        projectServiceCount: 30,
        reportingServices: Number.NaN,
      },
    },
    {
      label: "project count arrived as NaN",
      input: {
        scopedServiceIds: [],
        hasNonServiceResourceScope: false,
        projectServiceCount: Number.NaN,
        reportingServices: 3,
      },
    },
    {
      label: "negative counts on both sides",
      input: {
        scopedServiceIds: [],
        hasNonServiceResourceScope: false,
        projectServiceCount: -5,
        reportingServices: -3,
      },
    },
    {
      label: "more reporting than the project has, from a stale numerator",
      input: {
        scopedServiceIds: [],
        hasNonServiceResourceScope: false,
        projectServiceCount: 3,
        reportingServices: 4,
      },
    },
    {
      label: "Infinity",
      input: {
        scopedServiceIds: [],
        hasNonServiceResourceScope: false,
        projectServiceCount: Number.POSITIVE_INFINITY,
        reportingServices: Number.POSITIVE_INFINITY,
      },
    },
    {
      label: "scoped ids came back as a non-array from a hand-edited URL",
      input: {
        scopedServiceIds: null as unknown as Array<string>,
        hasNonServiceResourceScope: false,
        projectServiceCount: 30,
        reportingServices: 2,
      },
    },
    {
      label: "scoped ids came back as a bare string",
      input: {
        scopedServiceIds: SERVICE_A as unknown as Array<string>,
        hasNonServiceResourceScope: false,
        projectServiceCount: 30,
        reportingServices: 2,
      },
    },
  ];

  test.each(degenerateCases)(
    "$label yields printable finite counts",
    ({ input }: { input: ScopedServiceCoverageInput }): void => {
      const coverage: ScopedServiceCoverage =
        computeScopedServiceCoverage(input);

      expect(Number.isFinite(coverage.scopedServiceCount)).toBe(true);
      expect(Number.isFinite(coverage.quietServices)).toBe(true);
      expect(coverage.scopedServiceCount).toBeGreaterThanOrEqual(0);
      expect(coverage.quietServices).toBeGreaterThanOrEqual(0);
      expect(coverage.quietServices).toBeLessThanOrEqual(
        coverage.scopedServiceCount,
      );
      expect(typeof coverage.isCoverageMeaningful).toBe("boolean");
    },
  );

  test("a non-array scope is treated as 'not narrowed', not as an empty selection", () => {
    /*
     * A junk `serviceIds` param must fall back to the project-wide answer.
     * Treating it as a selection of zero services would render "0 of 0
     * services" on a healthy 30-service project — the tile going blank is
     * how the user learns nothing, rather than learning something wrong.
     */
    const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
      scopedServiceIds: undefined as unknown as Array<string>,
      hasNonServiceResourceScope: false,
      projectServiceCount: 30,
      reportingServices: 2,
    });

    expect(coverage.isCoverageMeaningful).toBe(true);
    expect(coverage.scopedServiceCount).toBe(30);
    expect(coverage.quietServices).toBe(28);
  });

  test("an empty project with nothing reporting is answerable and simply zero", () => {
    /*
     * A brand-new project is not a broken slice: the question "how many of
     * your services are quiet" has the answer "none, you have none". That
     * has to stay distinguishable from the host-only case, which zeroes the
     * same two numbers but flags them as unanswerable.
     */
    const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
      scopedServiceIds: [],
      hasNonServiceResourceScope: false,
      projectServiceCount: 0,
      reportingServices: 0,
    });

    expect(coverage).toEqual({
      scopedServiceCount: 0,
      quietServices: 0,
      isCoverageMeaningful: true,
    });
  });
});
