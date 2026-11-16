import {
  AppliedDataMigrationRow,
  readAppliedDataMigrations,
} from "../../API/AdminHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * Admin Dashboard -> Health -> Data migrations, as the status card counts
 * them: only the migrations the build ships. The rows of DataMigrations also
 * hold names no migration of this build has - a migration a later build
 * renamed, and the done markers of the job that clears stored Synthetic
 * screenshots (ClearStoredLogScreenshots:<table>, issue #6942) - and counted,
 * they made a server look five migrations ahead of what it ships, and named
 * a marker as its latest migration.
 */

const DEFINED: Array<string> = ["AddA", "AddB", "AddC"];

function row(name: string, executedAt: string | null): AppliedDataMigrationRow {
  return { name, executedAt };
}

describe("readAppliedDataMigrations", () => {
  test("counts only the build's own migrations, and lists the rest pending in run order", () => {
    expect(
      readAppliedDataMigrations({
        definedNames: DEFINED,
        rows: [
          row("AddA", "2026-11-01T00:00:00.000Z"),
          row("ClearStoredLogScreenshots:IncidentStateTimeline", null),
          row("ClearStoredLogScreenshots:Alert", "2026-11-15T00:00:00.000Z"),
          row("RenamedLongAgo", "2025-01-01T00:00:00.000Z"),
          row("AddC", "2026-11-03T00:00:00.000Z"),
        ],
      }),
    ).toEqual({
      totalApplied: 2,
      pending: ["AddB"],
      lastExecuted: row("AddC", "2026-11-03T00:00:00.000Z"),
    });
  });

  test("a job's done marker run last is never named as the latest migration", () => {
    expect(
      readAppliedDataMigrations({
        definedNames: DEFINED,
        rows: [
          row("AddB", "2026-11-02T00:00:00.000Z"),
          row(
            "ClearStoredLogScreenshots:MonitorStatusTimeline",
            "2026-11-16T00:00:00.000Z",
          ),
        ],
      }).lastExecuted,
    ).toEqual(row("AddB", "2026-11-02T00:00:00.000Z"));
  });

  test("every migration applied is up to date, however many other rows there are", () => {
    const status: ReturnType<typeof readAppliedDataMigrations> =
      readAppliedDataMigrations({
        definedNames: DEFINED,
        rows: [
          ...DEFINED.map((name: string): AppliedDataMigrationRow => {
            return row(name, "2026-11-01T00:00:00.000Z");
          }),
          row("ClearStoredLogScreenshots:Incident", "2026-11-02T00:00:00.000Z"),
        ],
      });

    expect(status.totalApplied).toBe(DEFINED.length);
    expect(status.pending).toEqual([]);
  });

  test("a name recorded twice counts once", () => {
    expect(
      readAppliedDataMigrations({
        definedNames: DEFINED,
        rows: [row("AddA", null), row("AddA", "2026-11-01T00:00:00.000Z")],
      }).totalApplied,
    ).toBe(1);
  });

  test("with no row executed, every migration is pending and none is the latest", () => {
    expect(
      readAppliedDataMigrations({ definedNames: DEFINED, rows: [] }),
    ).toEqual({ totalApplied: 0, pending: DEFINED, lastExecuted: null });
  });
});
