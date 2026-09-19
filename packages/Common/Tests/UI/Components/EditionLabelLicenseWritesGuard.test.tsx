import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The edition dialog in core only READS the license. Activating it (with a
 * key or an offline token) and refreshing it are POSTs to routes that exist
 * only in the Enterprise server (ee/Server/License/API/LicenseClientAPI.ts),
 * and their UI is the Enterprise plugin's license manager
 * (ee/AdminDashboard/License). This guard keeps that code from drifting back
 * into the Apache-2.0 component, where it would ship in every Community
 * bundle: EditionLabel's branches key on a runtime flag, so the bundler
 * cannot drop them.
 *
 * It scans every source file in the EditionLabel directory, so a new file
 * next to EditionLabel.tsx cannot bring the code back either.
 */

const EDITION_LABEL_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "EditionLabel",
);

interface ForbiddenPattern {
  pattern: RegExp;
  why: string;
}

const FORBIDDEN: Array<ForbiddenPattern> = [
  {
    pattern: /\/license\/refresh/,
    why: "the license refresh route (POST /global-config/license/refresh)",
  },
  {
    pattern: /\blicenseToken\b/,
    why: "the offline activation request body ({ licenseToken })",
  },
  {
    pattern: /HTTPMethod\.(POST|PUT|PATCH|DELETE)\b/,
    why: "a license write",
  },
  {
    pattern: /\bAPI\.(post|put|patch|delete)\b/,
    why: "a license write",
  },
  {
    pattern: /\bmethod:\s*["'](POST|PUT|PATCH|DELETE)["']/i,
    why: "a license write",
  },
  {
    pattern: /from\s+["'][./]*\/(Input\/Input|TextArea\/TextArea)["']/,
    why: "the license key / offline token inputs",
  },
];

type FindViolationsFunction = (source: string) => Array<string>;

const findViolations: FindViolationsFunction = (
  source: string,
): Array<string> => {
  return FORBIDDEN.filter((entry: ForbiddenPattern): boolean => {
    return entry.pattern.test(source);
  }).map((entry: ForbiddenPattern): string => {
    return entry.why;
  });
};

const SOURCE_FILE: RegExp = /\.(ts|tsx|js|jsx)$/;

const listSourceFiles: () => Array<string> = (): Array<string> => {
  return fs
    .readdirSync(EDITION_LABEL_DIR)
    .filter((name: string): boolean => {
      return SOURCE_FILE.test(name);
    })
    .map((name: string): string => {
      return path.join(EDITION_LABEL_DIR, name);
    });
};

describe("the core edition dialog never writes the license", () => {
  it("scans EditionLabel.tsx and the license manager contract", () => {
    const names: Array<string> = listSourceFiles().map(
      (file: string): string => {
        return path.basename(file);
      },
    );

    expect(names).toEqual(
      expect.arrayContaining(["EditionLabel.tsx", "LicenseManager.ts"]),
    );
  });

  it.each(
    listSourceFiles().map((file: string): [string, string] => {
      return [path.basename(file), file];
    }),
  )(
    "%s holds no license write, activation input or refresh",
    (_name: string, file: string) => {
      expect(findViolations(fs.readFileSync(file, "utf8"))).toEqual([]);
    },
  );

  it("still reads the license with a GET", () => {
    const source: string = fs.readFileSync(
      path.join(EDITION_LABEL_DIR, "EditionLabel.tsx"),
      "utf8",
    );

    expect(source).toContain("HTTPMethod.GET");
    expect(source).toContain('new Route("/global-config/license")');
  });

  // Negative control: every pattern fires on the code that moved to ee.
  it.each([
    [
      'new Route("/global-config/license/refresh")',
      "the license refresh route (POST /global-config/license/refresh)",
    ],
    [
      "data: { licenseToken: trimmedToken }",
      "the offline activation request body ({ licenseToken })",
    ],
    ["method: HTTPMethod.POST,", "a license write"],
    ["await API.post<JSONObject>({ url })", "a license write"],
    ['{ method: "POST", url }', "a license write"],
    [
      'import Input from "../Input/Input";',
      "the license key / offline token inputs",
    ],
    [
      'import TextArea from "../TextArea/TextArea";',
      "the license key / offline token inputs",
    ],
  ])("flags %s", (source: string, why: string) => {
    expect(findViolations(source)).toContain(why);
  });

  it("does not flag the read-only code that stays", () => {
    expect(
      findViolations(
        [
          'const licenseUrl: URL = URL.fromURL(APP_API_URL).addRoute(new Route("/global-config/license"));',
          "await API.fetch<JSONObject>({ method: HTTPMethod.GET, url: licenseUrl });",
          'configModel.enterpriseLicenseKey = payload["licenseKey"] as string;',
          'import Button, { ButtonStyleType } from "../Button/Button";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
