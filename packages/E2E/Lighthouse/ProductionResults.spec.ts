import {
  AllCategories,
  Gauges,
  OtlpGauge,
  OtlpPayload,
  ProductionMeasure,
  ProductionPage,
  ProductionPages,
  RunsPerPage,
  measureOf,
  medianRun,
  otlpPayloadOf,
  summaryOf,
} from "./Production";
import { Report, ReportAudit } from "./Results";
import { expect, test } from "@playwright/test";

/*
 * Production.ts on reports written here: which run the nightly scan of
 * oneuptime.com reports, what it reads from it, and how its measures are
 * summarized and sent to OneUptime. It runs with the pull request check's
 * suite, which scans nothing outside the checkout; the scan itself runs only
 * from playwright.lighthouse-production.config.ts.
 */

function metric(numericValue: number): ReportAudit {
  return {
    title: "A metric",
    score: 1,
    scoreDisplayMode: "numeric",
    numericValue,
  };
}

function reportOf(
  performance: number | null,
  more: Partial<Report> = {},
): Report {
  return {
    lighthouseVersion: "13.5.0",
    categories: {
      performance: { title: "Performance", score: performance, auditRefs: [] },
      accessibility: { title: "Accessibility", score: 0.97, auditRefs: [] },
      "best-practices": { title: "Best practices", score: 1, auditRefs: [] },
      seo: { title: "SEO", score: 0.92, auditRefs: [] },
    },
    audits: {
      "largest-contentful-paint": metric(2519.6),
      "cumulative-layout-shift": metric(0.04567),
      "total-blocking-time": metric(312.4),
      "first-contentful-paint": metric(1201.2),
      "speed-index": metric(3100.5),
    },
    ...more,
  };
}

const PAGE: ProductionPage = {
  name: "pricing",
  url: "https://oneuptime.com/pricing",
};

test.describe("the run the nightly scan reports", () => {
  test("is the median by performance score", () => {
    const fast: Report = reportOf(0.9);
    const middle: Report = reportOf(0.7);
    const slow: Report = reportOf(0.4);

    expect(medianRun([fast, slow, middle])).toBe(middle);
  });

  test("of two that completed, is the slower; a run that failed is left out", () => {
    const failed: Report = reportOf(null, {
      runtimeError: { code: "NO_FCP", message: "The page did not paint" },
    });
    const fast: Report = reportOf(0.9);
    const slow: Report = reportOf(0.5);

    expect(medianRun([fast, failed, slow])).toBe(slow);
  });

  test("is none when no run completed", () => {
    const failed: Report = reportOf(null, {
      runtimeError: { code: "NO_FCP", message: "The page did not paint" },
    });

    expect(medianRun([failed, failed, failed])).toBeNull();
    expect(medianRun([])).toBeNull();
  });
});

test.describe("what the scan reads from a run", () => {
  test("every category's score out of 100, and the metrics rounded", () => {
    expect(
      measureOf({
        page: PAGE,
        formFactor: "mobile",
        report: reportOf(0.734),
        runs: 3,
      }),
    ).toEqual({
      name: "pricing",
      url: "https://oneuptime.com/pricing",
      formFactor: "mobile",
      runs: 3,
      scores: {
        performance: "73",
        accessibility: "97",
        "best-practices": "100",
        seo: "92",
      },
      largestContentfulPaintMs: 2520,
      cumulativeLayoutShift: 0.046,
      totalBlockingTimeMs: 312,
      firstContentfulPaintMs: 1201,
      speedIndexMs: 3101,
    });
  });

  test("a metric Lighthouse could not take is none", () => {
    const report: Report = reportOf(0.5);

    delete report.audits["total-blocking-time"];

    expect(
      measureOf({ page: PAGE, formFactor: "desktop", report, runs: 2 })
        .totalBlockingTimeMs,
    ).toBeNull();
  });
});

function measure(more: Partial<ProductionMeasure> = {}): ProductionMeasure {
  return {
    ...measureOf({
      page: PAGE,
      formFactor: "mobile",
      report: reportOf(0.73),
      runs: 3,
    }),
    ...more,
  };
}

test.describe("the run's summary", () => {
  test("has a row per page and form factor, linking the page", () => {
    const summary: string = summaryOf([
      measure(),
      measure({
        formFactor: "desktop",
        largestContentfulPaintMs: null,
        runs: 2,
      }),
    ]);

    expect(summary).toContain(
      "| [pricing](https://oneuptime.com/pricing) | mobile | 73 | 2,520 ms | 0.046 | 312 ms | 97 | 100 | 92 | 3/3 |",
    );
    expect(summary).toContain(
      "| [pricing](https://oneuptime.com/pricing) | desktop | 73 | - | 0.046 | 312 ms | 97 | 100 | 92 | 2/3 |",
    );
  });
});

test.describe("the measures as OpenTelemetry metrics", () => {
  const payload: OtlpPayload = otlpPayloadOf(
    [
      measure(),
      measure({ formFactor: "desktop", cumulativeLayoutShift: null }),
    ],
    "1762156800000000000",
  );
  const metrics: Array<OtlpGauge> =
    payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics;

  test("come from one service, a gauge per metric", () => {
    expect(payload.resourceMetrics[0]!.resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "oneuptime-lighthouse" } },
    ]);
    expect(
      metrics.map((gauge: OtlpGauge): string => {
        return `${gauge.name} ${gauge.unit}`;
      }),
    ).toEqual([
      "lighthouse.performance.score {score}",
      "lighthouse.accessibility.score {score}",
      "lighthouse.best_practices.score {score}",
      "lighthouse.seo.score {score}",
      "lighthouse.largest_contentful_paint ms",
      "lighthouse.cumulative_layout_shift 1",
      "lighthouse.total_blocking_time ms",
      "lighthouse.first_contentful_paint ms",
      "lighthouse.speed_index ms",
    ]);
    expect(Gauges).toHaveLength(metrics.length);
  });

  test("have a point per page and form factor, named by its attributes", () => {
    const pageAttributes: (formFactor: string) => Array<{
      key: string;
      value: { stringValue: string };
    }> = (formFactor: string) => {
      return [
        { key: "page.name", value: { stringValue: "pricing" } },
        {
          key: "url.full",
          value: { stringValue: "https://oneuptime.com/pricing" },
        },
        { key: "lighthouse.form_factor", value: { stringValue: formFactor } },
      ];
    };

    expect(metrics[0]!.gauge.dataPoints).toEqual([
      {
        timeUnixNano: "1762156800000000000",
        asDouble: 73,
        attributes: pageAttributes("mobile"),
      },
      {
        timeUnixNano: "1762156800000000000",
        asDouble: 73,
        attributes: pageAttributes("desktop"),
      },
    ]);
  });

  test("leave out a metric a run could not take", () => {
    expect(
      metrics[5]!.gauge.dataPoints.map(
        (point: { asDouble: number }): number => {
          return point.asDouble;
        },
      ),
    ).toEqual([0.046]);
  });
});

test.describe("the pages the nightly scan reads", () => {
  test("are the live site's home, pricing, docs, reference, sign-in, sign-up and a status page", () => {
    expect(
      ProductionPages.map((page: ProductionPage): string => {
        return page.url;
      }),
    ).toEqual([
      "https://oneuptime.com/",
      "https://oneuptime.com/pricing",
      "https://oneuptime.com/docs/en/introduction/getting-started",
      "https://oneuptime.com/reference/en/introduction",
      "https://oneuptime.com/accounts/login",
      "https://oneuptime.com/accounts/register",
      "https://status.oneuptime.com/",
    ]);
  });

  test("are read in all four categories, three runs a page", () => {
    expect(AllCategories).toEqual([
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ]);
    expect(RunsPerPage).toBe(3);
  });
});
