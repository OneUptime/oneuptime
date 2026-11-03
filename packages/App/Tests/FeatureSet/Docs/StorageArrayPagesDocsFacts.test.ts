import { describe, expect, test } from "@jest/globals";
import { readPage } from "./DocsContentSupport";
import {
  FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO,
  FLASHARRAY_LATENCY_WARNING_USEC,
  FLASHBLADE_READ_LATENCY_WARNING_USEC,
  STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
  STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
  STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS,
} from "../../../FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import { getAllStorageArrayAlertTemplates } from "Common/Types/Monitor/StorageArrayAlertTemplates";

/*
 * The storage array agent page's "What the array's pages show"
 * (telemetry/storage-arrays) says the rules the array's pages judge it by
 * (Pages/StorageArray/Utils/StorageArrayHealth), and the paragraph before
 * it what the list's Health column says: change a line there, and these
 * words go stale. The translations hold the same numbers line for line
 * (InfrastructureAgentDocsTranslations, StorageArrayDocs).
 */

const PAGE: string = "telemetry/storage-arrays";
const HEADING: string = "## What the array's pages show";

function section(): string {
  const text: string = readPage("en", PAGE);
  const start: number = text.indexOf(HEADING);
  expect(start).toBeGreaterThan(-1);
  const end: number = text.indexOf("\n## ", start + 1);
  return text.slice(start, end);
}

function healthParagraph(): string {
  const text: string = readPage("en", PAGE);
  const line: string | undefined = text.split("\n").find((row: string) => {
    return row.startsWith("The **Health** column of **All Storage Arrays**");
  });
  expect(line).toBeDefined();
  return line as string;
}

describe("telemetry/storage-arrays: what the array's pages show", () => {
  test("sits after What the agent collects, before the syslog section", () => {
    const text: string = readPage("en", PAGE);
    const collects: number = text.indexOf("## What the agent collects");
    const pages: number = text.indexOf(HEADING);
    const syslog: number = text.indexOf(
      "## Optional — Ship the array's syslog",
    );
    expect(collects).toBeGreaterThan(-1);
    expect(pages).toBeGreaterThan(collects);
    expect(syslog).toBeGreaterThan(pages);
  });

  test("says the capacity lines as the rules draw them, by their templates' names", () => {
    const text: string = section();
    expect(text).toContain(
      `Past ${STORAGE_ARRAY_CAPACITY_WARNING_PERCENT}% of its usable capacity it needs a look, and past ${STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT}% it is critical`,
    );
    const names: Array<string> = getAllStorageArrayAlertTemplates().map(
      (template: { name: string }): string => {
        return template.name;
      },
    );
    for (const name of [
      `Capacity Above ${STORAGE_ARRAY_CAPACITY_WARNING_PERCENT}%`,
      `Capacity Above ${STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT}%`,
    ]) {
      expect(names).toContain(name);
      expect(text).toContain(name);
    }
  });

  test("says the latency lines as the rules draw them", () => {
    const text: string = section();
    expect(text).toContain(
      `average read or write latency is past ${FLASHARRAY_LATENCY_WARNING_USEC / 1000} ms`,
    );
    expect(text).toContain(
      `a FlashBlade whose reads take longer than ${FLASHBLADE_READ_LATENCY_WARNING_USEC / 1000} ms`,
    );
  });

  test("says the pod lag and the file system line as the rules draw them", () => {
    const text: string = section();
    // The rules' lag line is a minute.
    expect(STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS).toBe(60 * 1000);
    expect(text).toContain("one more than a minute behind needs a look");
    expect(text).toContain(
      `less than ${Math.round(FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO * 100)}% of its provisioned size left`,
    );
  });

  test("names the Dashboard's own words, in bold", () => {
    const text: string = section();
    for (const label of [
      "**Overview**",
      "**Healthy**",
      "**Degraded**",
      "**Unhealthy**",
      "**Needs attention**",
      "**Hosts**",
      "**Replication**",
      "**File Systems**",
      "**Health Unknown**",
    ]) {
      expect({ label, found: text.includes(label) }).toEqual({
        label,
        found: true,
      });
    }
  });

  test("says the list's Health column is the array's own alerts and hardware, Unknown while disconnected", () => {
    const paragraph: string = healthParagraph();
    for (const word of [
      "**Critical**",
      "**Warning**",
      "**OK**",
      "**Unknown** while the agent is disconnected",
      "The array's **Overview** judges more, as the next section says.",
    ]) {
      expect({ word, found: paragraph.includes(word) }).toEqual({
        word,
        found: true,
      });
    }
    // The page no longer says the Overview's health is the list's verdict.
    expect(readPage("en", PAGE)).not.toContain(
      "The array's health on its **Overview** is **Critical**",
    );
  });
});
