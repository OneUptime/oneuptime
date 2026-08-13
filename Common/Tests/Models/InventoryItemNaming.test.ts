import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Route from "../../Types/API/Route";
import InventoryItem from "../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../Models/DatabaseModels/InventoryItemRelationship";

/*
 * The Inventory product's two tables were called TelemetryEntity and
 * TelemetryEntityRelationship — the name of the mechanism that populates
 * them, not of the thing they hold. This pins the rename across all four
 * places the old name used to surface, each of which leaks to a different
 * audience:
 *
 *   tableName   -> the database, and the migration that renames it
 *   CRUD route  -> every API consumer
 *   display     -> the delete confirmation, the detail card, the API docs
 *   class name  -> everyone reading the code
 *
 * The last test is the one that matters most over time: it sweeps the whole
 * source tree for the old name, so a copy-paste from an older branch cannot
 * quietly reintroduce it.
 */

interface ModelUnderTest {
  label: string;
  instance: InventoryItem | InventoryItemRelationship;
  tableName: string;
  route: string;
  singularName: string;
  pluralName: string;
}

const MODELS: Array<ModelUnderTest> = [
  {
    label: "InventoryItem",
    instance: new InventoryItem(),
    tableName: "InventoryItem",
    route: "/inventory-item",
    singularName: "Inventory Item",
    pluralName: "Inventory Items",
  },
  {
    label: "InventoryItemRelationship",
    instance: new InventoryItemRelationship(),
    tableName: "InventoryItemRelationship",
    route: "/inventory-item-relationship",
    singularName: "Inventory Item Relationship",
    pluralName: "Inventory Item Relationships",
  },
];

describe.each(MODELS)("$label", (model: ModelUnderTest) => {
  test("maps to its renamed table", () => {
    expect(model.instance.tableName).toBe(model.tableName);
  });

  test("serves its renamed CRUD path", () => {
    const route: Route | null = model.instance.getCrudApiPath();

    expect(route).not.toBeNull();
    expect(route!.toString()).toBe(model.route);
  });

  test("reads as Inventory everywhere a human sees it", () => {
    expect(model.instance.singularName).toBe(model.singularName);
    expect(model.instance.pluralName).toBe(model.pluralName);
  });

  test("carries no trace of the old name in its own metadata", () => {
    const surfaces: Array<string> = [
      model.instance.tableName || "",
      model.instance.singularName || "",
      model.instance.pluralName || "",
      model.instance.tableDescription || "",
      model.instance.getCrudApiPath()?.toString() || "",
    ];

    for (const surface of surfaces) {
      expect(surface.toLowerCase()).not.toContain("telemetryentity");
      expect(surface.toLowerCase()).not.toContain("telemetry entity");
      expect(surface.toLowerCase()).not.toContain("telemetry-entity");
    }
  });
});

describe("the class identities are distinct", () => {
  test("the relationship model is not the item model", () => {
    // A half-applied rename could collapse the two onto one class.
    expect(InventoryItem).not.toBe(InventoryItemRelationship);
    expect(new InventoryItem().tableName).not.toBe(
      new InventoryItemRelationship().tableName,
    );
  });

  test("their CRUD paths do not collide", () => {
    expect(new InventoryItem().getCrudApiPath()!.toString()).not.toBe(
      new InventoryItemRelationship().getCrudApiPath()!.toString(),
    );
  });
});

describe("the old name is gone from the source tree", () => {
  const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

  const SKIP_DIRECTORIES: ReadonlySet<string> = new Set<string>([
    "node_modules",
    ".git",
    "build",
    "dist",
    "coverage",
    // Applied history. These migrations name the tables as they were.
    "SchemaMigrations",
  ]);

  /*
   * Deliberate survivors, each for a stated reason:
   *
   *   Utils/Telemetry/TelemetryEntity   the OTel resource-extraction layer.
   *                                     It derives entities from an OTLP
   *                                     resource; that is the spec's word,
   *                                     not the product's, and it is not a
   *                                     table.
   *   Jobs/TelemetryEntity/             the cron identifiers registered from
   *   "TelemetryEntity:                 this directory are BullMQ repeatable
   *                                     job names. Renaming one orphans its
   *                                     schedule in Redis, because the
   *                                     dedup pass only removes repeatables
   *                                     matching the same name.
   */
  interface AllowedReference {
    substring: string;
    /**
     * Only allowed in files under this path fragment. Set it wherever the
     * substring alone would be too broad — a bare relative import can only
     * mean the OTel util from inside that util's own directory, and allowing
     * it everywhere would hide a real mis-rewrite.
     */
    onlyUnder?: string | undefined;
  }

  const ALLOWED_REFERENCES: ReadonlyArray<AllowedReference> = [
    { substring: "Utils/Telemetry/TelemetryEntity" },
    // Its neighbours import it relatively.
    {
      substring: './TelemetryEntity"',
      onlyUnder: path.join("Server", "Utils", "Telemetry"),
    },
    { substring: "Jobs/TelemetryEntity/" },
    { substring: '"TelemetryEntity:' },
  ];

  /*
   * The two files whose job is to name the old name: this sweep itself, and
   * the migration test that checks each table is renamed rather than
   * recreated. Excluded by filename rather than by skipping tests wholesale —
   * a stale reference in any other test is still worth catching.
   */
  const ALLOWED_FILES: ReadonlySet<string> = new Set<string>([
    "InventoryItemNaming.test.ts",
    "RenameInventoryItemMigration.test.ts",
  ]);

  type CollectFilesFunction = (directory: string) => Array<string>;

  const collectSourceFiles: CollectFilesFunction = (
    directory: string,
  ): Array<string> => {
    const found: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }

        found.push(...collectSourceFiles(path.join(directory, entry.name)));
        continue;
      }

      if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !ALLOWED_FILES.has(entry.name)
      ) {
        found.push(path.join(directory, entry.name));
      }
    }

    return found;
  };

  type OffendingLinesFunction = (file: string) => Array<string>;

  const getOffendingLines: OffendingLinesFunction = (
    file: string,
  ): Array<string> => {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line: string): boolean => {
        if (
          !line.includes("TelemetryEntity") &&
          !line.includes("telemetry-entity")
        ) {
          return false;
        }

        return !ALLOWED_REFERENCES.some((allowed: AllowedReference): boolean => {
          if (!line.includes(allowed.substring)) {
            return false;
          }

          return !allowed.onlyUnder || file.includes(allowed.onlyUnder);
        });
      })
      .map((line: string): string => {
        return line.trim();
      });
  };

  test("the sweep actually reads files", () => {
    // Guards against a path mistake making every assertion below vacuous.
    expect(
      collectSourceFiles(path.join(REPO_ROOT, "Common", "Models")).length,
    ).toBeGreaterThan(50);
  });

  test.each(["Common", "App"])(
    "%s has no stale TelemetryEntity reference",
    (projectDirectory: string) => {
      const offenders: Array<string> = [];

      for (const file of collectSourceFiles(
        path.join(REPO_ROOT, projectDirectory),
      )) {
        for (const line of getOffendingLines(file)) {
          offenders.push(`${path.relative(REPO_ROOT, file)}: ${line}`);
        }
      }

      expect(offenders).toEqual([]);
    },
  );

  test("the model and service files were renamed, not copied", () => {
    const gone: Array<string> = [
      path.join(
        REPO_ROOT,
        "Common",
        "Models",
        "DatabaseModels",
        "TelemetryEntity.ts",
      ),
      path.join(
        REPO_ROOT,
        "Common",
        "Models",
        "DatabaseModels",
        "TelemetryEntityRelationship.ts",
      ),
      path.join(
        REPO_ROOT,
        "Common",
        "Server",
        "Services",
        "TelemetryEntityService.ts",
      ),
      path.join(
        REPO_ROOT,
        "Common",
        "Server",
        "Services",
        "TelemetryEntityRelationshipService.ts",
      ),
    ];

    for (const file of gone) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  test("the OTel extraction util is deliberately left alone", () => {
    /*
     * Not an oversight: it derives entities from an OTLP resource, which is
     * the OpenTelemetry spec's concept and not this product's table.
     */
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "Common",
          "Server",
          "Utils",
          "Telemetry",
          "TelemetryEntity.ts",
        ),
      ),
    ).toBe(true);
  });
});
