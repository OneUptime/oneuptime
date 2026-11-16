import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * THE SIGN-IN PAGES RUN IN THE BROWSER, WITH NOTHING OF THE SERVER IN THEM.
 *
 * The sign-up page read whether billing and the daily check-in are on from
 * the server's configuration (Common/Server/EnvironmentConfig), which
 * brought the whole of it - every setting the server reads, its billing and
 * cluster settings and the database's connection shares - into what a
 * visitor downloads before the page draws: some 6 KB gzipped
 * (packages/Common/Scripts/first-load-budgets.js). It reads both from the
 * page's own configuration (Common/UI/Config), which the server fills from
 * the same settings. No page of the sign-in frontend imports a module of
 * the server's.
 */

const ACCOUNTS_SOURCE: string = nodePath.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Accounts",
  "src",
);

const SOURCE_FILE: RegExp = /\.tsx?$/;

const sourceFiles: (folder: string) => Array<string> = (
  folder: string,
): Array<string> => {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = nodePath.join(folder, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
};

// Every module a file imports, as written.
const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  return Array.from(
    fs
      .readFileSync(file, "utf8")
      .matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)";/gm),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
};

describe("the sign-in frontend's sources", () => {
  const files: Array<string> = sourceFiles(ACCOUNTS_SOURCE);

  test("are found", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(nodePath.join("Pages", "Register.tsx"));
      }),
    ).toBe(true);
  });

  test("import no module of the server's", () => {
    const serverImports: Array<string> = files.flatMap(
      (file: string): Array<string> => {
        return importsOf(file)
          .filter((module: string): boolean => {
            return module.startsWith("Common/Server/");
          })
          .map((module: string): string => {
            return `${nodePath.relative(ACCOUNTS_SOURCE, file)}: ${module}`;
          });
      },
    );

    expect(serverImports).toEqual([]);
  });

  test("the sign-up page reads billing and the daily check-in from the page's own configuration", () => {
    const register: string = fs.readFileSync(
      nodePath.join(ACCOUNTS_SOURCE, "Pages", "Register.tsx"),
      "utf8",
    );
    const configImport: RegExpMatchArray | null = register.match(
      /import \{([^}]*)\} from "Common\/UI\/Config";/,
    );

    expect(configImport).not.toBeNull();
    expect(configImport![1]).toContain("BILLING_ENABLED");
    expect(configImport![1]).toContain("DISABLE_INSTANCE_CHECK_IN");
    expect(register).toContain(
      "if (!BILLING_ENABLED && !DISABLE_INSTANCE_CHECK_IN) {",
    );
    expect(register).not.toContain("IsBillingEnabled");
    expect(register).not.toContain("DisableInstanceCheckIn");
  });
});
