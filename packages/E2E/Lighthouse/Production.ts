import { FormFactor } from "./Pages";
import { Report, scoreOf } from "./Results";
import fs from "fs";
import path from "path";

/*
 * The nightly scan of oneuptime.com (Production.scan.ts, issue #5609): how
 * fast its live pages load, with the real CDN, network, web fonts and
 * Google Tag Manager, which the pull request check (Lighthouse.spec.ts)
 * cannot see. It tracks and never judges: no page fails on a score, only on
 * not being scanned at all. ProductionResults.spec.ts holds this file to its
 * job.
 */

// LIGHTHOUSE_ORIGIN scans another installation's pages, such as staging.
const Origin: string = (
  process.env["LIGHTHOUSE_ORIGIN"] || "https://oneuptime.com"
).replace(/\/+$/, "");

export interface ProductionPage {
  name: string;
  url: string;
}

export const ProductionPages: ReadonlyArray<ProductionPage> = [
  { name: "home", url: `${Origin}/` },
  { name: "pricing", url: `${Origin}/pricing` },
  {
    name: "a docs page",
    url: `${Origin}/docs/en/introduction/getting-started`,
  },
  { name: "the API reference", url: `${Origin}/reference/en/introduction` },
  { name: "sign-in", url: `${Origin}/accounts/login` },
  { name: "sign-up", url: `${Origin}/accounts/register` },
  // OneUptime's own status page, on a domain of its own.
  { name: "a status page", url: "https://status.oneuptime.com/" },
];

// A performance score moves from run to run: each page is scanned this often.
export const RunsPerPage: number = 3;

export const AllCategories: ReadonlyArray<string> = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];

/*
 * The run to report: the median by performance score (of three, the
 * middle; of two, the slower). A run Lighthouse could not complete is left
 * out, and with none left there is nothing to report.
 */
export function medianRun(reports: Array<Report>): Report | null {
  const scanned: Array<Report> = reports
    .filter((report: Report): boolean => {
      return !report.runtimeError;
    })
    .sort((first: Report, second: Report): number => {
      return (
        (first.categories["performance"]?.score ?? 0) -
        (second.categories["performance"]?.score ?? 0)
      );
    });

  return scanned.length > 0
    ? scanned[Math.floor((scanned.length - 1) / 2)]!
    : null;
}

// What a run measured, with a metric Lighthouse could not take as null.
export interface ProductionMeasure {
  name: string;
  url: string;
  formFactor: FormFactor;
  // How many of the page's runs Lighthouse completed.
  runs: number;
  // A category's id: its score out of 100, or "-".
  scores: Record<string, string>;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTimeMs: number | null;
  firstContentfulPaintMs: number | null;
  speedIndexMs: number | null;
}

function metricOf(report: Report, id: string): number | null {
  const value: number | undefined = report.audits[id]?.numericValue;

  return typeof value === "number" ? value : null;
}

function rounded(value: number | null, decimals: number = 0): number | null {
  if (value === null) {
    return null;
  }

  const factor: number = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

export function measureOf(data: {
  page: ProductionPage;
  formFactor: FormFactor;
  report: Report;
  runs: number;
}): ProductionMeasure {
  const { page, formFactor, report, runs } = data;

  return {
    name: page.name,
    url: page.url,
    formFactor,
    runs,
    scores: Object.fromEntries(
      AllCategories.map((category: string): [string, string] => {
        return [category, scoreOf(report, category)];
      }),
    ),
    largestContentfulPaintMs: rounded(
      metricOf(report, "largest-contentful-paint"),
    ),
    cumulativeLayoutShift: rounded(
      metricOf(report, "cumulative-layout-shift"),
      3,
    ),
    totalBlockingTimeMs: rounded(metricOf(report, "total-blocking-time")),
    firstContentfulPaintMs: rounded(metricOf(report, "first-contentful-paint")),
    speedIndexMs: rounded(metricOf(report, "speed-index")),
  };
}

function shown(value: number | null, unit: string = ""): string {
  return value === null ? "-" : `${value.toLocaleString("en-US")}${unit}`;
}

// The run's summary: a row per page and form factor.
export function summaryOf(measures: Array<ProductionMeasure>): string {
  return [
    "## Lighthouse on oneuptime.com",
    "",
    `Each page's median of ${RunsPerPage} runs by performance score, with every third party it loads. Tracked, never failed on: every report is in the run's \`lighthouse-production\` artifact.`,
    "",
    "| Page | Form factor | Performance | LCP | CLS | TBT | Accessibility | Best practices | SEO | Runs |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...measures.map((measure: ProductionMeasure): string => {
      return `| [${measure.name}](${measure.url}) | ${measure.formFactor} | ${measure.scores["performance"]} | ${shown(measure.largestContentfulPaintMs, " ms")} | ${shown(measure.cumulativeLayoutShift)} | ${shown(measure.totalBlockingTimeMs, " ms")} | ${measure.scores["accessibility"]} | ${measure.scores["best-practices"]} | ${measure.scores["seo"]} | ${measure.runs}/${RunsPerPage} |`;
    }),
    "",
  ].join("\n");
}

/*
 * The measures as OpenTelemetry metrics (OTLP/HTTP JSON), one gauge per
 * metric with a point per page and form factor, for a OneUptime project to
 * chart and alert on.
 */
interface Gauge {
  name: string;
  unit: string;
  description: string;
  valueOf: (measure: ProductionMeasure) => number | null;
}

function scoreValue(
  category: string,
): (measure: ProductionMeasure) => number | null {
  return (measure: ProductionMeasure): number | null => {
    const score: number = Number(measure.scores[category]);

    return Number.isFinite(score) ? score : null;
  };
}

export const Gauges: ReadonlyArray<Gauge> = [
  {
    name: "lighthouse.performance.score",
    unit: "{score}",
    description: "Lighthouse's performance score, out of 100",
    valueOf: scoreValue("performance"),
  },
  {
    name: "lighthouse.accessibility.score",
    unit: "{score}",
    description: "Lighthouse's accessibility score, out of 100",
    valueOf: scoreValue("accessibility"),
  },
  {
    name: "lighthouse.best_practices.score",
    unit: "{score}",
    description: "Lighthouse's best practices score, out of 100",
    valueOf: scoreValue("best-practices"),
  },
  {
    name: "lighthouse.seo.score",
    unit: "{score}",
    description: "Lighthouse's SEO score, out of 100",
    valueOf: scoreValue("seo"),
  },
  {
    name: "lighthouse.largest_contentful_paint",
    unit: "ms",
    description: "Largest Contentful Paint",
    valueOf: (measure: ProductionMeasure): number | null => {
      return measure.largestContentfulPaintMs;
    },
  },
  {
    name: "lighthouse.cumulative_layout_shift",
    unit: "1",
    description: "Cumulative Layout Shift",
    valueOf: (measure: ProductionMeasure): number | null => {
      return measure.cumulativeLayoutShift;
    },
  },
  {
    name: "lighthouse.total_blocking_time",
    unit: "ms",
    description: "Total Blocking Time",
    valueOf: (measure: ProductionMeasure): number | null => {
      return measure.totalBlockingTimeMs;
    },
  },
  {
    name: "lighthouse.first_contentful_paint",
    unit: "ms",
    description: "First Contentful Paint",
    valueOf: (measure: ProductionMeasure): number | null => {
      return measure.firstContentfulPaintMs;
    },
  },
  {
    name: "lighthouse.speed_index",
    unit: "ms",
    description: "Speed Index",
    valueOf: (measure: ProductionMeasure): number | null => {
      return measure.speedIndexMs;
    },
  },
];

export interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

export interface OtlpDataPoint {
  timeUnixNano: string;
  asDouble: number;
  attributes: Array<OtlpAttribute>;
}

export interface OtlpGauge {
  name: string;
  unit: string;
  description: string;
  gauge: { dataPoints: Array<OtlpDataPoint> };
}

export interface OtlpPayload {
  resourceMetrics: Array<{
    resource: { attributes: Array<OtlpAttribute> };
    scopeMetrics: Array<{ scope: { name: string }; metrics: Array<OtlpGauge> }>;
  }>;
}

function attribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

export function otlpPayloadOf(
  measures: Array<ProductionMeasure>,
  timeUnixNano: string,
): OtlpPayload {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [attribute("service.name", "oneuptime-lighthouse")],
        },
        scopeMetrics: [
          {
            scope: { name: "packages/E2E/Lighthouse" },
            metrics: Gauges.map((gauge: Gauge): OtlpGauge => {
              const dataPoints: Array<OtlpDataPoint> = [];

              for (const measure of measures) {
                const value: number | null = gauge.valueOf(measure);

                if (value === null) {
                  continue;
                }

                dataPoints.push({
                  timeUnixNano,
                  asDouble: value,
                  attributes: [
                    attribute("page.name", measure.name),
                    attribute("url.full", measure.url),
                    attribute("lighthouse.form_factor", measure.formFactor),
                  ],
                });
              }

              return {
                name: gauge.name,
                unit: gauge.unit,
                description: gauge.description,
                gauge: { dataPoints },
              };
            }),
          },
        ],
      },
    ],
  };
}

// The scan's own reports folder, apart from the pull request check's.
export const ProductionReportsFolder: string = path.resolve(
  __dirname,
  "../../../output/playwright/lighthouse-production/reports",
);

const MeasuresFile: string = path.join(
  ProductionReportsFolder,
  "measures.jsonl",
);

export function writeMeasure(measure: ProductionMeasure): void {
  fs.mkdirSync(ProductionReportsFolder, { recursive: true });
  fs.appendFileSync(MeasuresFile, `${JSON.stringify(measure)}\n`);
}

export function readMeasures(): Array<ProductionMeasure> {
  if (!fs.existsSync(MeasuresFile)) {
    return [];
  }

  return fs
    .readFileSync(MeasuresFile, "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    })
    .map((line: string): ProductionMeasure => {
      return JSON.parse(line) as ProductionMeasure;
    });
}
