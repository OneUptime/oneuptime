import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE FRONTENDS' BROWSER CODE IMPORTS NO SERVICE, NOT EVEN A TYPE.
 *
 * TypeScript puts in a program the file a type comes from, even through
 * `import type`, and a file of Common/Server/Services brings every service,
 * model and migration with it. The Dashboard's on-call readiness types
 * (src/Components/OnCallPolicy/Readiness/ReadinessTypes.ts) were read from
 * OnCallReadinessService that way: they held the Dashboard's type check, and
 * ee's Dashboard and UI tests', to most of Common/Server, and ran ee's UI
 * tests out of Node's default heap on the 17.3.0 release. A type the browser
 * shares with a service lives in Common/Types, as the readiness types do
 * (Types/OnCallDutyPolicy/OnCallReadiness), and the service exports it from
 * there.
 *
 * A frontend's server (Serve.ts, and src/Server where it has one) is not
 * browser code, and is left out.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const FEATURE_SET_DIR: string = path.join(PACKAGES_DIR, "App", "FeatureSet");
const SERVICES_DIR: string = path.join(
  PACKAGES_DIR,
  "Common",
  "Server",
  "Services",
);
const SERVICES_SPECIFIER: string = "Common/Server/Services";

const FRONTENDS: Array<string> = [
  "Dashboard",
  "Accounts",
  "StatusPage",
  "AdminDashboard",
  "PublicDashboard",
];

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// Every .ts and .tsx file of a frontend's browser code.
const listBrowserFiles: (frontend: string) => Array<string> = (
  frontend: string,
): Array<string> => {
  const sourceDir: string = path.join(FEATURE_SET_DIR, frontend, "src");
  const serverDir: string = path.join(sourceDir, "Server");
  const files: Array<string> = [];

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && full !== serverDir) {
          walk(full);
        }
      } else if (TYPESCRIPT_FILE.test(entry.name)) {
        files.push(full);
      }
    }
  };

  walk(sourceDir);

  return files;
};

/*
 * The module specifiers of a file's imports and exports that name a service:
 * as "Common/Server/Services/...", or as a relative path into that folder.
 * Type-only imports count; strings and comments do not.
 */
const readServiceImports: (file: string, source: string) => Array<string> = (
  file: string,
  source: string,
): Array<string> => {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((imported: ts.FileReference): string => {
      return imported.fileName;
    })
    .filter((specifier: string): boolean => {
      if (
        specifier === SERVICES_SPECIFIER ||
        specifier.startsWith(`${SERVICES_SPECIFIER}/`)
      ) {
        return true;
      }

      if (!specifier.startsWith(".")) {
        return false;
      }

      const target: string = path.resolve(path.dirname(file), specifier);

      return (
        target === SERVICES_DIR || target.startsWith(SERVICES_DIR + path.sep)
      );
    });
};

describe("the guard's own machinery", () => {
  test("sees a service imported however it is named, a type-only import too", () => {
    const file: string = path.join(
      FEATURE_SET_DIR,
      "Dashboard",
      "src",
      "Components",
      "Example.ts",
    );
    const source: string = [
      'import type { ReadinessSummary } from "Common/Server/Services/OnCallReadinessService";',
      'import ProjectService from "Common/Server/Services/ProjectService";',
      'export { default } from "../../../../../Common/Server/Services/UserService";',
      // Neither of these is a service.
      'import GroupBy from "Common/Server/Types/Database/GroupBy";',
      'import { ReadinessStatus } from "Common/Types/OnCallDutyPolicy/OnCallReadiness";',
      // A string or a comment is not an import.
      'const text: string = "Common/Server/Services/TeamService";',
      '// import TeamMemberService from "Common/Server/Services/TeamMemberService";',
    ].join("\n");

    expect(readServiceImports(file, source)).toEqual([
      "Common/Server/Services/OnCallReadinessService",
      "Common/Server/Services/ProjectService",
      "../../../../../Common/Server/Services/UserService",
    ]);
  });

  test("reads every frontend's browser code, the readiness types among it", () => {
    const dashboardFiles: Array<string> = listBrowserFiles("Dashboard");

    expect(dashboardFiles).toContain(
      path.join(
        FEATURE_SET_DIR,
        "Dashboard",
        "src",
        "Components",
        "OnCallPolicy",
        "Readiness",
        "ReadinessTypes.ts",
      ),
    );

    for (const frontend of FRONTENDS) {
      expect({
        frontend,
        hasFiles: listBrowserFiles(frontend).length > 0,
      }).toEqual({ frontend, hasFiles: true });
    }
  });
});

describe("the frontends' browser code", () => {
  test.each(FRONTENDS)("%s imports no service", (frontend: string) => {
    const found: Array<string> = [];

    for (const file of listBrowserFiles(frontend)) {
      for (const specifier of readServiceImports(
        file,
        fs.readFileSync(file, "utf8"),
      )) {
        found.push(`${path.relative(FEATURE_SET_DIR, file)} -> ${specifier}`);
      }
    }

    expect(found).toEqual([]);
  });
});
