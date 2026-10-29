import fs from "fs";
import path from "path";

/*
 * THE TYPEORM ONEUPTIME'S QUERY PATCHES WERE WRITTEN AGAINST.
 *
 * EntityMetadataLookup and QueryPropertyNames stand in for two of TypeORM's
 * functions, and PagedFind rewrites the page TypeORM's find options set up.
 * Each was written against TypeORM 0.3.31 and is held to its answers there
 * by its own suite, and TypeOrmPatchesPinned holds the version and the
 * source of every TypeORM function they replace or rely on. Merges do not
 * always wait for CI, so they check the version themselves as well: against
 * any other TypeORM they stand aside and TypeORM's own code runs - slower,
 * never different - until someone reads the new TypeORM's code, runs the
 * patches' suites and moves the pin and this version together.
 */
export const PATCHED_TYPEORM_VERSION: string = "0.3.31";

// The installed version once read; undefined until then.
let installedVersion: string | null | undefined = undefined;

export default class TypeOrmPatchVersion {
  // The version of the typeorm package this process loads, or null.
  public static getInstalledVersion(): string | null {
    if (installedVersion === undefined) {
      try {
        // typeorm's exports map leaves package.json out: read it from disk.
        const packageJson: { version?: unknown } = JSON.parse(
          fs.readFileSync(
            path.join(path.dirname(require.resolve("typeorm")), "package.json"),
            "utf8",
          ),
        );

        installedVersion =
          typeof packageJson.version === "string" ? packageJson.version : null;
      } catch {
        installedVersion = null;
      }
    }

    return installedVersion;
  }

  // Whether the patches may stand in for TypeORM's code in this process.
  public static isPatchedVersion(): boolean {
    return (
      TypeOrmPatchVersion.getInstalledVersion() === PATCHED_TYPEORM_VERSION
    );
  }

  // Answer as if this version were installed (tests); undefined reads it again.
  public static setInstalledVersionForTests(
    version: string | null | undefined,
  ): void {
    installedVersion = version;
  }
}
