import {
  ProductionMeasure,
  ProductionReportsFolder,
  otlpPayloadOf,
  readMeasures,
  summaryOf,
} from "./Production";
import fs from "fs";
import path from "path";

// A line in the job's log; "::warning::" makes it an annotation on the run.
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/*
 * The nightly scan's measures, in one table on the run's summary page
 * (GITHUB_STEP_SUMMARY) and in summary.md beside the reports. When
 * ONEUPTIME_LIGHTHOUSE_OTLP_TOKEN holds a OneUptime project's telemetry
 * ingestion key, they are also sent to that project as OpenTelemetry
 * metrics (ONEUPTIME_LIGHTHOUSE_OTLP_ENDPOINT, https://oneuptime.com/otlp by
 * default), for a dashboard to chart and a monitor to alert on. A failed
 * send is a warning, not a failed scan.
 */
export default async function globalTeardown(): Promise<void> {
  const measures: Array<ProductionMeasure> = readMeasures();

  if (measures.length === 0) {
    return;
  }

  const summary: string = summaryOf(measures);

  fs.writeFileSync(path.join(ProductionReportsFolder, "summary.md"), summary);

  const stepSummary: string | undefined = process.env["GITHUB_STEP_SUMMARY"];

  if (stepSummary) {
    fs.appendFileSync(stepSummary, summary);
  }

  const token: string | undefined =
    process.env["ONEUPTIME_LIGHTHOUSE_OTLP_TOKEN"];

  if (!token) {
    say(
      "ONEUPTIME_LIGHTHOUSE_OTLP_TOKEN is not set: the measures were not sent to OneUptime (Lighthouse/README.md).",
    );
    return;
  }

  const endpoint: string = (
    process.env["ONEUPTIME_LIGHTHOUSE_OTLP_ENDPOINT"] ||
    "https://oneuptime.com/otlp"
  ).replace(/\/+$/, "");

  try {
    const response: Response = await fetch(`${endpoint}/v1/metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-oneuptime-token": token,
      },
      // The time in nanoseconds: milliseconds and six zeros.
      body: JSON.stringify(otlpPayloadOf(measures, `${Date.now()}000000`)),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    say(`Sent ${measures.length} pages' measures to ${endpoint}.`);
  } catch (error) {
    say(
      `::warning::The measures were not sent to ${endpoint}: ${(error as Error).message}`,
    );
  }
}
