import {
  listProductFiles,
  listTestCodeFiles,
} from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import Permission from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * RUNBOOK CREDENTIALS ARE GONE, AND NOTHING REACHES FOR THEM.
 *
 * Runbooks > Runners > AI Access held the runbook credentials OneUptime AI's
 * own commands reached a host over SSH, or a Kubernetes cluster from a
 * Runner outside it, with. Hosts and clusters have AI agents of their own,
 * and runbook steps sign in with runbook variables, so the page, the
 * credentials and every path that used them were removed. This guard keeps
 * them removed across the whole checkout - product code and test code: the
 * Dashboard, the server, the Runner, the E2E fixtures, and ee/ when it is
 * checked out:
 *
 *   - the modules that held them are gone, and nothing imports one;
 *   - the four Runbook Credential permissions are no permission any more,
 *     and product code names them only in the schema migration that deletes
 *     the rows that held them;
 *   - the AI Access page's address is named by product code only where it
 *     forwards to the Runners (MovedPagePaths), its PageMap entry is gone,
 *     and no Dashboard locale keeps its menu label.
 *
 * A module, a permission or the page brought back fails this guard until it
 * is taken out of these lists on purpose.
 */

// The modules that were removed, by their path from the repository's root.
const REMOVED_MODULES: ReadonlyArray<string> = [
  "packages/Common/Models/DatabaseModels/RunbookCredential.ts",
  "packages/Common/Server/Services/RunbookCredentialService.ts",
  "packages/Common/Types/Runbook/RunbookCredentialType.ts",
  "packages/Common/Server/Utils/AutoRemediation/AiCommandCredentialReach.ts",
  "packages/Common/Server/Utils/AutoRemediation/AiRemediationCredentialUse.ts",
  "packages/Common/Server/Utils/AutoRemediation/RunbookCredentialReaders.ts",
  "packages/App/FeatureSet/Runbook/Utils/Credentials.ts",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Runner/RunnerCredentialSignIn.ts",
];

const REMOVED_PERMISSIONS: ReadonlyArray<string> = [
  "CreateRunbookCredential",
  "EditRunbookCredential",
  "DeleteRunbookCredential",
  "ReadRunbookCredential",
];

// The one product file that names them: the migration that deletes their rows.
const REMOVED_PERMISSIONS_MIGRATION: string =
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1805780000000-RemoveRunbookCredentials.ts";

// The one product file that names the page's address: where it forwards.
const MOVED_PAGE_PATHS: string =
  "packages/App/FeatureSet/Dashboard/src/Routes/MovedPagePaths.ts";

const DASHBOARD_LOCALES: string =
  "packages/App/FeatureSet/Dashboard/src/Locales";

// What a file imports: an `import … from`, an `export … from`, a require or an import().
const MODULE_SPECIFIER: RegExp =
  /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)["']([^"'\n]+)["']/g;
const CODE_EXTENSION: RegExp = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const REMOVED_PERMISSION_NAME: RegExp =
  /\b(?:Create|Read|Edit|Delete)RunbookCredential\b/;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

// A module's path from the repository's root, without its extension.
function withoutExtension(relativePath: string): string {
  return relativePath.replace(CODE_EXTENSION, "");
}

/*
 * The module a specifier in `file` names, by its path from the repository's
 * root without its extension: a relative one, or one through the Common
 * alias. Null for a package from node_modules.
 */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    return withoutExtension(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(file), specifier),
      ),
    );
  }

  if (specifier.startsWith("Common/")) {
    return withoutExtension(`packages/${specifier}`);
  }

  return null;
}

// The removed modules a file's text imports.
function removedImports(file: string, text: string): Array<string> {
  const removed: Set<string> = new Set<string>(
    REMOVED_MODULES.map((module: string): string => {
      return withoutExtension(module);
    }),
  );
  const found: Array<string> = [];

  for (const match of text.matchAll(MODULE_SPECIFIER)) {
    const resolved: string | null = resolveSpecifier(file, match[1] as string);

    if (resolved && removed.has(resolved)) {
      found.push(`${file} imports ${match[1]}`);
    }
  }

  return found;
}

const PRODUCT_FILES: Array<string> = listProductFiles();
/*
 * Every test file but this one, whose negative controls below import the
 * removed modules in strings on purpose.
 */
const THIS_FILE: string =
  "packages/Common/Tests/Server/Utils/Runbook/RunbookCredentialsGoneGuard.test.ts";
const TEST_FILES: Array<string> = listTestCodeFiles().filter(
  (file: string): boolean => {
    return file !== THIS_FILE;
  },
);

describe("runbook credentials are gone, and nothing reaches for them", () => {
  test("the modules that held them are gone", () => {
    const present: Array<string> = REMOVED_MODULES.filter(
      (module: string): boolean => {
        return fs.existsSync(path.join(REPOSITORY_DIRECTORY, module));
      },
    );

    expect(present).toEqual([]);
  });

  test("no product or test code imports one", () => {
    // The walks read the checkout, and leave out only this file: not vacuous.
    expect(PRODUCT_FILES.length).toBeGreaterThan(1000);
    expect(TEST_FILES.length).toBeGreaterThan(1000);
    expect(listTestCodeFiles()).toContain(THIS_FILE);

    const found: Array<string> = [...PRODUCT_FILES, ...TEST_FILES].flatMap(
      (file: string): Array<string> => {
        if (!CODE_EXTENSION.test(file)) {
          return [];
        }

        return removedImports(file, read(file));
      },
    );

    expect(found).toEqual([]);
  });

  test("the four Runbook Credential permissions are no permission, and product code names them only where their rows are deleted", () => {
    const permissions: Array<string> = Object.values(
      Permission,
    ) as Array<string>;

    for (const name of REMOVED_PERMISSIONS) {
      expect({ name, permission: permissions.includes(name) }).toEqual({
        name,
        permission: false,
      });
    }

    const naming: Array<string> = PRODUCT_FILES.filter(
      (file: string): boolean => {
        return (
          CODE_EXTENSION.test(file) && REMOVED_PERMISSION_NAME.test(read(file))
        );
      },
    );

    expect(naming).toEqual([REMOVED_PERMISSIONS_MIGRATION]);

    for (const name of REMOVED_PERMISSIONS) {
      expect(read(REMOVED_PERMISSIONS_MIGRATION)).toContain(`"${name}",`);
    }
  });

  test("the AI Access page's address is named only where it forwards to the Runners, and its route and menu label are gone", () => {
    const naming: Array<string> = PRODUCT_FILES.filter(
      (file: string): boolean => {
        return (
          CODE_EXTENSION.test(file) && read(file).includes("runner-credentials")
        );
      },
    );

    expect(naming).toEqual([MOVED_PAGE_PATHS]);
    expect(read(MOVED_PAGE_PATHS)).toContain(
      'export const MOVED_RUNNER_CREDENTIALS_PATH: string = "runner-credentials";',
    );

    const routing: Array<string> = PRODUCT_FILES.filter(
      (file: string): boolean => {
        return (
          CODE_EXTENSION.test(file) &&
          read(file).includes("RUNBOOKS_RUNNER_CREDENTIALS")
        );
      },
    );

    expect(routing).toEqual([]);

    const locales: Array<string> = fs
      .readdirSync(path.join(REPOSITORY_DIRECTORY, DASHBOARD_LOCALES))
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(locales.length).toBeGreaterThan(10);

    for (const locale of locales) {
      const keys: Record<string, unknown> = JSON.parse(
        read(`${DASHBOARD_LOCALES}/${locale}`),
      ) as Record<string, unknown>;

      expect({ locale, label: "AI Access" in keys }).toEqual({
        locale,
        label: false,
      });
    }
  });
});

/*
 * Negative controls: the reading above catches what it is for, so an empty
 * list means nothing imports a removed module, not that nothing was read.
 */
describe("the guard's reading of imports", () => {
  test("finds a removed module imported relatively, through the Common alias, by require and by import()", () => {
    expect(
      removedImports(
        "packages/Common/Server/Services/SomeService.ts",
        'import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";',
      ),
    ).toHaveLength(1);
    expect(
      removedImports(
        "packages/App/FeatureSet/Runbook/API/Somewhere.ts",
        'import Service from "Common/Server/Services/RunbookCredentialService";\nexport { x } from "../Utils/Credentials";',
      ),
    ).toHaveLength(2);
    expect(
      removedImports(
        "packages/E2E/Some/Fixture/Fixture.js",
        'const page = require("../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials");\nconst sign = import("../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerCredentialSignIn.ts");',
      ),
    ).toHaveLength(2);
  });

  test("leaves alone a module that is still there, and a package from node_modules", () => {
    expect(
      removedImports(
        "packages/Common/Server/Services/SomeService.ts",
        'import RunbookVariable from "../../Models/DatabaseModels/RunbookVariable";\nimport typeorm from "typeorm";\nimport Credentials from "./Credentials";',
      ),
    ).toEqual([]);
    expect(resolveSpecifier("packages/Common/a.ts", "typeorm")).toBeNull();
  });
});
