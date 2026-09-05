import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Permission from "../../../Types/Permission";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import RumSessionChunk from "../../../Models/AnalyticsModels/RumSessionChunk";
import AddSessionReplayEngagementColumns from "../../../../App/FeatureSet/Workers/DataMigrations/AddSessionReplayEngagementColumns";

/*
 * The migration imports the two ClickHouse services for their column DDL
 * helpers. Neither is exercised here (the migration is a no-op on
 * clusters and the column assertions read the models directly), and
 * loading them for real drags the ClickHouse client into a model test.
 */
jest.mock("Common/Server/Services/RumSessionService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/RumSessionChunkService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
});

/*
 * The engagement columns added for identify()/setTags()/track() and the
 * click recorder. Two of these decisions are privacy decisions and are
 * pinned by identity, not by value: identifiedUserTraits describes a
 * PERSON and must sit behind exactly the ACL object identifiedUserLabel
 * uses, and tags describe a SESSION and must sit behind exactly the
 * object the rest of the row uses. Sharing the object (not a copy) is
 * what guarantees a future ACL change moves both columns together.
 */

function findColumn(
  model: AnalyticsBaseModel,
  key: string,
): AnalyticsTableColumn | undefined {
  return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
    return column.key === key;
  });
}

function requireColumn(
  model: AnalyticsBaseModel,
  key: string,
): AnalyticsTableColumn {
  const column: AnalyticsTableColumn | undefined = findColumn(model, key);

  if (!column) {
    throw new Error(`${model.tableName} does not declare ${key}`);
  }

  return column;
}

describe("RumSession engagement columns", () => {
  const model: RumSession = new RumSession();

  it("declares every engagement column", () => {
    for (const key of [
      "tags",
      "identifiedUserTraits",
      "clickCount",
      "customEventCount",
      "firstErrorOffsetMs",
      "activeMs",
    ]) {
      expect(findColumn(model, key)).toBeDefined();
    }
  });

  it("identifiedUserTraits carries the SAME ACL object as identifiedUserLabel", () => {
    const label: AnalyticsTableColumn = requireColumn(
      model,
      "identifiedUserLabel",
    );
    const traits: AnalyticsTableColumn = requireColumn(
      model,
      "identifiedUserTraits",
    );

    expect(traits.accessControl).toBeDefined();
    expect(traits.accessControl).toBe(label.accessControl);
    /* And that object is the narrow one: no plain list permission. */
    expect(traits.accessControl?.read).not.toContain(
      Permission.ReadRumSessionReplay,
    );
    expect(traits.accessControl?.read).not.toContain(Permission.TelemetryAdmin);
    expect(traits.accessControl?.read).toContain(
      Permission.ReadRumSessionReplayPayload,
    );
  });

  it("identifiedUserTraits is a Map(String, String) defaulting to {} with no skip index", () => {
    const traits: AnalyticsTableColumn = requireColumn(
      model,
      "identifiedUserTraits",
    );

    expect(traits.type).toBe(TableColumnType.MapStringString);
    expect(traits.defaultValue).toEqual({});
    expect(traits.required).toBe(true);
    /* Traits are never filtered on; an index would only index PII. */
    expect(traits.skipIndex).toBeUndefined();
  });

  it("tags carries the SAME ACL object as the ordinary session columns", () => {
    const tags: AnalyticsTableColumn = requireColumn(model, "tags");
    const durationMs: AnalyticsTableColumn = requireColumn(model, "durationMs");
    const errorCount: AnalyticsTableColumn = requireColumn(model, "errorCount");

    expect(tags.accessControl).toBeDefined();
    expect(tags.accessControl).toBe(durationMs.accessControl);
    expect(tags.accessControl).toBe(errorCount.accessControl);
    expect(tags.accessControl?.read).toContain(Permission.ReadRumSessionReplay);
    expect(tags.type).toBe(TableColumnType.MapStringString);
    expect(tags.defaultValue).toEqual({});
  });

  it("tags and traits are distinct columns with distinct ACLs", () => {
    const tags: AnalyticsTableColumn = requireColumn(model, "tags");
    const traits: AnalyticsTableColumn = requireColumn(
      model,
      "identifiedUserTraits",
    );

    expect(tags.accessControl).not.toBe(traits.accessControl);
  });

  it("clickCount and customEventCount are Int32 counters under the session ACL, defaulting to 0", () => {
    for (const key of ["clickCount", "customEventCount"]) {
      const column: AnalyticsTableColumn = requireColumn(model, key);
      const errorCount: AnalyticsTableColumn = requireColumn(
        model,
        "errorCount",
      );

      expect(column.type).toBe(TableColumnType.Number);
      expect(column.defaultValue).toBe(0);
      expect(column.accessControl).toBe(errorCount.accessControl);
    }
  });

  it("firstErrorOffsetMs and activeMs are Int64 (BigNumber), default 0, and never T64-coded", () => {
    for (const key of ["firstErrorOffsetMs", "activeMs"]) {
      const column: AnalyticsTableColumn = requireColumn(model, key);
      const durationMs: AnalyticsTableColumn = requireColumn(
        model,
        "durationMs",
      );

      expect(column.type).toBe(TableColumnType.BigNumber);
      expect(column.defaultValue).toBe(0);
      expect(column.accessControl).toBe(durationMs.accessControl);

      const codecs: Array<{ codec: string }> = Array.isArray(column.codec)
        ? (column.codec as Array<{ codec: string }>)
        : column.codec
          ? [column.codec as { codec: string }]
          : [];

      expect(
        codecs.some((codec: { codec: string }): boolean => {
          return codec.codec === "T64";
        }),
      ).toBe(false);
    }
  });

  it("the existing counters and the sort key are untouched", () => {
    expect(requireColumn(model, "errorCount").defaultValue).toBeUndefined();
    expect(model.sortKeys).toEqual([
      "projectId",
      "rumApplicationId",
      "startTime",
      "sessionId",
    ]);
  });
});

describe("RumSessionChunk engagement columns", () => {
  const model: RumSessionChunk = new RumSessionChunk();

  it("declares clickCount and customEventCount as Int32 counters defaulting to 0 under the chunk metadata ACL", () => {
    const errorCount: AnalyticsTableColumn = requireColumn(model, "errorCount");

    for (const key of ["clickCount", "customEventCount"]) {
      const column: AnalyticsTableColumn = requireColumn(model, key);

      expect(column.type).toBe(TableColumnType.Number);
      expect(column.defaultValue).toBe(0);
      expect(column.accessControl).toBe(errorCount.accessControl);
      expect(column.accessControl?.read).not.toContain(Permission.Viewer);
    }
  });

  it("already carries a per-chunk url column, so none is added", () => {
    expect(requireColumn(model, "url").type).toBe(TableColumnType.Text);
    expect(
      model.tableColumns.filter((column: AnalyticsTableColumn): boolean => {
        return column.key === "url";
      }),
    ).toHaveLength(1);
  });

  it("the existing counters keep no default, so a missing envelope counter is still an insert error", () => {
    expect(requireColumn(model, "errorCount").defaultValue).toBeUndefined();
  });
});

describe("AddSessionReplayEngagementColumns migration", () => {
  /*
   * Registration is pinned by reading Index.ts as text, the same way the
   * App-side migration tests do: importing the index would instantiate
   * every migration in the repo and their Postgres services.
   */
  const indexSource: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Workers/DataMigrations/Index.ts",
    ),
    "utf8",
  );

  it("is imported and instantiated in DataMigrations/Index.ts exactly once", () => {
    expect(indexSource).toContain(
      'import AddSessionReplayEngagementColumns from "./AddSessionReplayEngagementColumns";',
    );
    expect(
      indexSource.split("new AddSessionReplayEngagementColumns()"),
    ).toHaveLength(2);
  });

  it("is registered LAST in the data-migration chain", () => {
    const instantiations: Array<string> =
      indexSource.match(/new [A-Za-z0-9_]+\(\)/g) || [];

    expect(instantiations.length).toBeGreaterThan(0);
    expect(instantiations[instantiations.length - 1]).toBe(
      "new AddSessionReplayEngagementColumns()",
    );
  });

  it("does not run in cluster mode, because boot schema-sync performs the same ADD COLUMN there", () => {
    expect(new AddSessionReplayEngagementColumns().runsInClusterMode()).toBe(
      false,
    );
  });

  it("names itself so the runner records it under a stable key", () => {
    expect(new AddSessionReplayEngagementColumns().name).toBe(
      "AddSessionReplayEngagementColumns",
    );
  });
});
