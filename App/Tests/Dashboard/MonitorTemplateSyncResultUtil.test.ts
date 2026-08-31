import fs from "fs";
import path from "path";
import {
  buildSyncResultSummary,
  SyncResultSummary,
} from "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateSyncResultUtil";
import { describe, expect, it } from "@jest/globals";

const TEMPLATES_VIEW_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplatesView.tsx",
);

describe("Monitor template sync result summary", () => {
  it("reports a complete sync as done", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 12,
      totalLinkedMonitors: 12,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
    expect(summary.message).toBe(
      "Synced criteria onto 12 monitors (12 linked to this template).",
    );
  });

  /*
   * Regression: a short sync used to render as plain success, so a fleet left
   * partly on the old configuration looked fully updated.
   */
  it("flags a short sync instead of reporting success", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 10000,
      totalLinkedMonitors: 50000,
    });

    expect(summary.isIncomplete).toBe(true);
    expect(summary.title).toBe("Partially synced");
    expect(summary.message).toContain(
      "40000 linked monitors still use the previous configuration",
    );
  });

  it("singularizes the one-monitor cases", () => {
    expect(
      buildSyncResultSummary({
        subject: "labels",
        syncedMonitors: 1,
        totalLinkedMonitors: 1,
      }).message,
    ).toBe("Synced labels onto 1 monitor (1 linked to this template).");

    const partial: SyncResultSummary = buildSyncResultSummary({
      subject: "labels",
      syncedMonitors: 1,
      totalLinkedMonitors: 2,
    });

    expect(partial.message).toContain(
      "1 linked monitor still uses the previous configuration",
    );
  });

  it("treats a template with no linked monitors as done", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "monitoring interval",
      syncedMonitors: 0,
      totalLinkedMonitors: 0,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
  });

  /*
   * The linked count is read project-wide while the writes are narrowed to the
   * caller, and the two are separate round trips. A count that lands lower than
   * the writes must not report a negative remainder.
   */
  it("does not invent a shortfall when more rows were written than counted", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 5,
      totalLinkedMonitors: 3,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
    expect(summary.message).not.toContain("still");
  });

  it("names the subject it was asked to report on", () => {
    for (const subject of ["criteria", "monitoring interval", "labels"]) {
      expect(
        buildSyncResultSummary({
          subject: subject,
          syncedMonitors: 2,
          totalLinkedMonitors: 2,
        }).message,
      ).toContain(`Synced ${subject} onto`);
    }
  });

  it("keeps the raw counts visible even when it flags a shortfall", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "labels",
      syncedMonitors: 7,
      totalLinkedMonitors: 20,
    });

    expect(summary.message).toContain(
      "Synced labels onto 7 monitors (20 linked to this template).",
    );
    expect(summary.message).toContain("13 linked monitors still use");
  });

  /*
   * A zero-write sync against a non-empty fleet is the loudest possible
   * failure and must not read as success.
   */
  it("flags a sync that reached nothing at all", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 0,
      totalLinkedMonitors: 12,
    });

    expect(summary.isIncomplete).toBe(true);
    expect(summary.title).toBe("Partially synced");
    expect(summary.message).toContain("12 linked monitors still use");
  });
});

/*
 * The result modal shares one title across sync, link and unlink. A path that
 * sets a message without setting a title would inherit whatever the previous
 * action left behind — most visibly "Partially synced" sitting on top of a
 * later success. The view is a React page the App suite cannot render, so pin
 * the pairing at the source level the way the sibling tenant-header suite does.
 */
describe("Monitor template result modal title wiring", () => {
  it("sets a title on every path that shows a result message", () => {
    const source: string = fs.readFileSync(TEMPLATES_VIEW_SOURCE, "utf8");

    const contentMessages: number = (
      source.match(/setSyncResultMessage\((?!"")/g) || []
    ).length;
    const titles: number = (source.match(/setSyncResultTitle\(/g) || []).length;

    expect(contentMessages).toBeGreaterThan(0);
    expect(titles).toBeGreaterThanOrEqual(contentMessages);
  });

  it("routes all three bulk syncs through the shared summary helper", () => {
    const source: string = fs.readFileSync(TEMPLATES_VIEW_SOURCE, "utf8");

    expect((source.match(/buildSyncResultSummary\(/g) || []).length).toBe(3);
    for (const subject of ["criteria", "monitoring interval", "labels"]) {
      expect(source).toContain(`subject: "${subject}"`);
    }
  });

  it("renders the modal from the title state rather than a hardcoded string", () => {
    const source: string = fs.readFileSync(TEMPLATES_VIEW_SOURCE, "utf8");

    expect(source).toContain("title={syncResultTitle}");
  });

  /*
   * Modal titles are resolved through translateString, which falls back to the
   * raw English on a miss. The modal used to hardcode "Done", which every
   * catalog carries; a title that varies has to be carried too, or the one
   * case that needs the operator's attention is the one that shows up
   * untranslated.
   */
  it("carries both modal titles in every locale catalog", () => {
    const localeDir: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );

    const catalogs: Array<string> = fs
      .readdirSync(localeDir)
      .filter((file: string) => {
        return file.endsWith(".json");
      });

    expect(catalogs.length).toBeGreaterThan(0);

    for (const catalog of catalogs) {
      const messages: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localeDir, catalog), "utf8"),
      );

      expect(messages["Done"]).toBeTruthy();
      expect(messages["Partially synced"]).toBeTruthy();
    }
  });
});
