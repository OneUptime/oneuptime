import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { StorageArrayPlatform } from "../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";

/*
 * NO VENDOR'S METRIC NAMES IN SHARED CODE (#11000).
 *
 * A platform's metric names are its own: its platform folder, its
 * extractor, its agent config and the docs say them, and every other file
 * reads them from the platform (StorageArrayPlatformRegistry). A shared
 * file that names one - a purefa_ series in a page, a purefb_ prefix in the
 * ingest - is a file the next vendor would have to change, and the code a
 * vendor's change could break. This fails on any.
 *
 * Each platform's names are its metric prefix (StorageArrayPlatform
 * .metricPrefix), so a platform added later is held to it with no change
 * here, its own folders found by its vendor's name: Pure Storage's are
 * Platforms/PureStorage/ and Telemetry/StorageArray/PureStorage/.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// Where shipped code lives.
const SCANNED: ReadonlyArray<string> = ["packages", "agents", "Scripts"];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "build",
  "dist",
  ".git",
  "coverage",
  "playwright-report",
  "test-results",
]);

const TEXT_FILE: RegExp =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|sh|md|html|hbs|ejs|txt|sql|py|go|tf|conf|ini|toml)$/;

/*
 * What may name any vendor's metrics, and why:
 *   - tests, their captures and goldens, and the end-to-end suites: they
 *     pin what a platform reads and shows;
 *   - the docs, and the Dashboard's in-app setup guide with its
 *     translations: they tell an operator which series their array sends
 *     (the guide's steps are Pure's until each platform has a guide of its
 *     own, #11123);
 *   - the Dashboard's locale files: the words a platform's catalog marks,
 *     translated, which name its series;
 *   - the agent's collector configs, README and troubleshooting script:
 *     what the agent scrapes, and how to check it (troubleshoot.sh probes
 *     Pure's endpoints until each platform has probes of its own, #11124).
 */
const ANY_VENDOR: ReadonlyArray<RegExp> = [
  /(^|\/)Tests?\//,
  /\.(test|spec)\.[a-z]+$/,
  /\.golden\.json$/,
  /^packages\/E2E\//,
  /^packages\/App\/FeatureSet\/Docs\/Content\//,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Locales\//,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Pages\/StorageArray\/Utils\/DocumentationMarkdown\.ts$/,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Pages\/StorageArray\/DocumentationTranslations\//,
  /^agents\/StorageArrayAgent\/otel-collector-config[a-z0-9.-]*\.yaml$/,
  /^agents\/StorageArrayAgent\/README\.md$/,
  /^agents\/StorageArrayAgent\/troubleshoot\.sh$/,
];

interface Vendor {
  name: string;
  // Its platforms' metric prefixes: "purefa_", "purefb_".
  prefixes: Array<string>;
  // Its own folders, where its names belong.
  own: Array<string>;
}

function vendorFolder(vendorName: string): string {
  return vendorName.replace(/[^A-Za-z0-9]/g, "");
}

function getVendors(): Array<Vendor> {
  const vendors: Map<string, Vendor> = new Map();
  for (const platform of StorageArrayPlatformRegistry.getPlatforms()) {
    if (!platform.metricPrefix) {
      continue;
    }
    const folder: string = vendorFolder(platform.vendorName);
    let vendor: Vendor | undefined = vendors.get(folder);
    if (!vendor) {
      vendor = {
        name: platform.vendorName,
        prefixes: [],
        own: [
          `packages/Common/Types/StorageArray/Platforms/${folder}/`,
          `packages/Common/Server/Utils/Telemetry/StorageArray/${folder}/`,
        ],
      };
      vendors.set(folder, vendor);
    }
    vendor.prefixes.push(platform.metricPrefix);
  }
  return Array.from(vendors.values());
}

function shippedTextFiles(): Array<string> {
  const files: Array<string> = [];
  const visit: (relative: string) => void = (relative: string): void => {
    const absolute: string = path.join(REPOSITORY_ROOT, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child: string = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(child);
        }
      } else if (entry.isFile() && TEXT_FILE.test(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const directory of SCANNED) {
    if (fs.existsSync(path.join(REPOSITORY_ROOT, directory))) {
      visit(directory);
    }
  }
  return files.sort();
}

function mayNameAnyVendor(file: string): boolean {
  return ANY_VENDOR.some((allowed: RegExp): boolean => {
    return allowed.test(file);
  });
}

const VENDORS: Array<Vendor> = getVendors();
const FILES: Array<string> = shippedTextFiles();

describe("a vendor's metric names stay in its own folders", () => {
  test("Pure Storage's are FlashArray's purefa_ and FlashBlade's purefb_, Dell's PowerScale's powerscale_", () => {
    expect(VENDORS).toEqual([
      {
        name: "Pure Storage",
        prefixes: ["purefa_", "purefb_"],
        own: [
          "packages/Common/Types/StorageArray/Platforms/PureStorage/",
          "packages/Common/Server/Utils/Telemetry/StorageArray/PureStorage/",
        ],
      },
      {
        name: "Dell",
        prefixes: ["powerscale_"],
        own: [
          "packages/Common/Types/StorageArray/Platforms/Dell/",
          "packages/Common/Server/Utils/Telemetry/StorageArray/Dell/",
        ],
      },
    ]);
    for (const vendor of VENDORS) {
      for (const folder of vendor.own) {
        expect({
          folder,
          exists: fs.existsSync(path.join(REPOSITORY_ROOT, folder)),
        }).toEqual({ folder, exists: true });
      }
    }
  });

  test("it reads the shipped code: thousands of files, the shared Storage Array files among them", () => {
    expect(FILES.length).toBeGreaterThan(5000);
    for (const shared of [
      "packages/Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts",
      "packages/Common/Types/Monitor/StorageArrayMetricCatalog.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index.tsx",
      "packages/App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
      "agents/StorageArrayAgent/install.sh",
    ]) {
      expect(FILES).toContain(shared);
      expect(mayNameAnyVendor(shared)).toBe(false);
    }
  });

  test.each(
    VENDORS.map((vendor: Vendor): [string, Vendor] => {
      return [vendor.name, vendor];
    }),
  )(
    "no file outside %s's folders, its agent configs, the docs and the tests names its series",
    (_name: string, vendor: Vendor) => {
      const naming: Array<string> = [];
      for (const file of FILES) {
        if (
          mayNameAnyVendor(file) ||
          vendor.own.some((folder: string): boolean => {
            return file.startsWith(folder);
          })
        ) {
          continue;
        }
        const text: string = fs.readFileSync(
          path.join(REPOSITORY_ROOT, file),
          "utf8",
        );
        const named: Array<string> = vendor.prefixes.filter(
          (prefix: string): boolean => {
            return text.includes(prefix);
          },
        );
        if (named.length > 0) {
          naming.push(`${file}: ${named.join(", ")}`);
        }
      }
      expect(naming).toEqual([]);
    },
  );

  test("a vendor's own folders name no other vendor's series", () => {
    for (const vendor of VENDORS) {
      const others: Array<string> = VENDORS.filter((other: Vendor): boolean => {
        return other !== vendor;
      }).flatMap((other: Vendor): Array<string> => {
        return other.prefixes;
      });
      for (const file of FILES) {
        if (
          !vendor.own.some((folder: string): boolean => {
            return file.startsWith(folder);
          })
        ) {
          continue;
        }
        const text: string = fs.readFileSync(
          path.join(REPOSITORY_ROOT, file),
          "utf8",
        );
        for (const prefix of others) {
          expect({
            file,
            names: text.includes(prefix) ? prefix : null,
          }).toEqual({ file, names: null });
        }
      }
    }
  });

  test("the vendor folders hold the platforms the registry lists, and nothing else does", () => {
    const platformsDirectory: string =
      "packages/Common/Types/StorageArray/Platforms";
    const folders: Array<string> = fs
      .readdirSync(path.join(REPOSITORY_ROOT, platformsDirectory), {
        withFileTypes: true,
      })
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();
    expect(folders).toEqual(
      Array.from(
        new Set(
          StorageArrayPlatformRegistry.getPlatforms().map(
            (platform: StorageArrayPlatform): string => {
              return vendorFolder(platform.vendorName);
            },
          ),
        ),
      ).sort(),
    );
  });
});
