import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { StorageArrayPlatform } from "../../../Types/StorageArray/StorageArrayPlatform";

/*
 * A PLATFORM DEFINITION NEVER LEADS BACK TO THE REGISTRY (#11000).
 *
 * StorageArrayPlatformRegistry imports every platform definition, and the
 * readers (StorageSystemUtil, the catalog, the templates, the extractors)
 * import the registry. A platform definition - or an extractor - that
 * imported any of them would close a cycle: whichever module loads first,
 * the other sees `undefined` where the platform list or a platform should
 * be, and the pages, the ingest or the monitors break in some load order
 * and not in another. So a platform module imports leaves only: enums,
 * types, the contract (StorageArrayPlatform.ts) and its own vendor's files.
 *
 * The first half reads the imports; the second loads each entry point
 * first in a module registry of its own and checks the platforms are all
 * there whatever came first.
 */

const COMMON: string = path.resolve(__dirname, "../../..");

// The modules every platform module stands on, and the platforms themselves.
const LEAF_FILES: ReadonlyArray<string> = [
  "Types/StorageArray/StorageArrayPlatform.ts",
  "Types/StorageArray/StorageSystem.ts",
  "Types/StorageArray/StorageArrayResourceKind.ts",
  "Server/Utils/Telemetry/StorageArray/StorageArrayExtractor.ts",
];

// Each vendor's folders: every file in them is a leaf too.
const LEAF_DIRECTORIES: ReadonlyArray<string> = [
  "Types/StorageArray/Platforms",
  "Server/Utils/Telemetry/StorageArray",
];

// What reads the registry, and so must never be reached from a leaf.
const READERS: ReadonlyArray<string> = [
  "Types/StorageArray/StorageArrayPlatformRegistry.ts",
  "Types/StorageArray/StorageSystemUtil.ts",
  "Types/StorageArray/StorageArrayResourceKindUtil.ts",
  "Types/Monitor/StorageArrayMetricCatalog.ts",
  "Types/Monitor/StorageArrayAlertTemplates.ts",
  "Server/Utils/Telemetry/StorageArray/StorageArrayExtractors.ts",
  "Server/Utils/Telemetry/StorageArraySnapshotScan.ts",
];

const IMPORT: RegExp =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;

function relative(file: string): string {
  return path.relative(COMMON, file).split(path.sep).join("/");
}

function tsFilesUnder(directory: string): Array<string> {
  return fs
    .readdirSync(path.join(COMMON, directory), { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const child: string = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return tsFilesUnder(child);
      }
      return entry.name.endsWith(".ts") ? [child] : [];
    });
}

// A relative import, as the file it names; null for a package's.
function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base: string = path.resolve(
    path.dirname(path.join(COMMON, fromFile)),
    specifier,
  );
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    base,
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return relative(candidate);
    }
  }
  throw new Error(`${fromFile} imports ${specifier}, which does not resolve`);
}

function importsOf(file: string): Array<string> {
  const text: string = fs.readFileSync(path.join(COMMON, file), "utf8");
  const imports: Array<string> = [];
  for (const match of text.matchAll(IMPORT)) {
    const resolved: string | null = resolveImport(
      file,
      (match[1] || match[2]) as string,
    );
    if (resolved) {
      imports.push(resolved);
    }
  }
  return imports;
}

/*
 * Every module a file reaches through its relative imports, each with the
 * chain of imports that reached it.
 */
function reach(start: string): Map<string, Array<string>> {
  const reached: Map<string, Array<string>> = new Map([[start, [start]]]);
  const queue: Array<string> = [start];
  while (queue.length > 0) {
    const file: string = queue.shift() as string;
    for (const imported of importsOf(file)) {
      if (!reached.has(imported)) {
        reached.set(imported, [...(reached.get(file) || []), imported]);
        queue.push(imported);
      }
    }
  }
  return reached;
}

const LEAVES: Array<string> = Array.from(
  new Set([
    ...LEAF_FILES,
    ...LEAF_DIRECTORIES.flatMap((directory: string): Array<string> => {
      return tsFilesUnder(directory);
    }),
  ]),
)
  .filter((file: string): boolean => {
    // The extractors' list is a reader: it lists every vendor's extractor.
    return !READERS.includes(file);
  })
  .sort();

describe("a platform module imports leaves only", () => {
  test("the leaves are the contract, the enums, and every vendor's files", () => {
    expect(LEAVES).toEqual(
      expect.arrayContaining([
        "Types/StorageArray/StorageArrayPlatform.ts",
        "Types/StorageArray/Platforms/StorageArrayPlatforms.ts",
        "Types/StorageArray/Platforms/PureStorage/PureStorage.ts",
        "Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform.ts",
        "Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladeMetrics.ts",
        "Server/Utils/Telemetry/StorageArray/StorageArrayExtractor.ts",
        "Server/Utils/Telemetry/StorageArray/PureStorage/FlashArrayExtractor.ts",
      ]),
    );
    for (const reader of READERS) {
      expect(fs.existsSync(path.join(COMMON, reader))).toBe(true);
      expect(LEAVES).not.toContain(reader);
    }
  });

  test.each(LEAVES)(
    "%s never reaches the registry or its readers",
    (leaf: string) => {
      const reached: Map<string, Array<string>> = reach(leaf);
      const cycles: Array<string> = READERS.filter(
        (reader: string): boolean => {
          return reached.has(reader);
        },
      ).map((reader: string): string => {
        return (reached.get(reader) as Array<string>).join(" -> ");
      });
      expect(cycles).toEqual([]);
    },
  );

  test("the registry reaches every platform module, so the guard reads the right graph", () => {
    const reached: Map<string, Array<string>> = reach(
      "Types/StorageArray/StorageArrayPlatformRegistry.ts",
    );
    for (const platform of [
      "Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform.ts",
      "Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladePlatform.ts",
    ]) {
      expect(reached.has(platform)).toBe(true);
    }
    expect(
      reach(
        "Server/Utils/Telemetry/StorageArray/StorageArrayExtractors.ts",
      ).has(
        "Server/Utils/Telemetry/StorageArray/PureStorage/FlashBladeExtractor.ts",
      ),
    ).toBe(true);
  });
});

/*
 * Each module a page, the ingest or a monitor may load first, loaded first
 * in a registry of its own.
 */
const ENTRY_POINTS: ReadonlyArray<string> = [
  "../../../Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform",
  "../../../Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladeMetrics",
  "../../../Types/StorageArray/Platforms/StorageArrayPlatforms",
  "../../../Types/StorageArray/StorageArrayPlatformRegistry",
  "../../../Types/StorageArray/StorageSystemUtil",
  "../../../Types/StorageArray/StorageArrayResourceKindUtil",
  "../../../Types/Monitor/StorageArrayMetricCatalog",
  "../../../Types/Monitor/StorageArrayAlertTemplates",
  "../../../Server/Utils/Telemetry/StorageArray/PureStorage/FlashArrayExtractor",
  "../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractors",
  "../../../Server/Utils/Telemetry/StorageArraySnapshotScan",
];

interface Loaded {
  systems: Array<string>;
  metrics: number;
  templates: number;
  extractors: Array<string>;
}

function loadFirst(entryPoint: string): Loaded {
  let loaded: Loaded | null = null;
  jest.isolateModules(() => {
    jest.requireActual(entryPoint);
    const registry: {
      getPlatforms: () => ReadonlyArray<StorageArrayPlatform | undefined>;
    } = (
      jest.requireActual(
        "../../../Types/StorageArray/StorageArrayPlatformRegistry",
      ) as { default: never }
    ).default;
    const catalog: { getAllStorageArrayMetrics: () => Array<unknown> } =
      jest.requireActual("../../../Types/Monitor/StorageArrayMetricCatalog");
    const templates: {
      getAllStorageArrayAlertTemplates: () => Array<unknown>;
    } = jest.requireActual("../../../Types/Monitor/StorageArrayAlertTemplates");
    const extractors: {
      getExtractors: () => ReadonlyArray<{ storageSystem: string } | undefined>;
    } = (
      jest.requireActual(
        "../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractors",
      ) as { default: never }
    ).default;
    loaded = {
      systems: registry
        .getPlatforms()
        .map((platform: StorageArrayPlatform | undefined): string => {
          return platform?.storageSystem || "undefined";
        }),
      metrics: catalog.getAllStorageArrayMetrics().length,
      templates: templates.getAllStorageArrayAlertTemplates().length,
      extractors: extractors
        .getExtractors()
        .map((extractor: { storageSystem: string } | undefined): string => {
          return extractor?.storageSystem || "undefined";
        }),
    };
  });
  return loaded as unknown as Loaded;
}

describe("whatever loads first, every platform is there", () => {
  const expected: Loaded = loadFirst(
    "../../../Types/StorageArray/StorageArrayPlatformRegistry",
  );

  test("the registry, loaded first, holds both platforms, their catalog, templates and extractors", () => {
    expect(expected.systems).toEqual([
      "purestorage.flasharray",
      "purestorage.flashblade",
    ]);
    expect(expected.extractors).toEqual(expected.systems);
    expect(expected.metrics).toBeGreaterThan(50);
    expect(expected.templates).toBeGreaterThan(10);
  });

  test.each(ENTRY_POINTS)("loading %s first", (entryPoint: string) => {
    expect(loadFirst(entryPoint)).toEqual(expected);
  });
});
