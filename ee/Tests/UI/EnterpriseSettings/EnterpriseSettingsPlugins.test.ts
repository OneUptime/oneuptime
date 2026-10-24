import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The four Enterprise areas the Dashboard plugin gained with custom roles,
 * IP allowlists and a status page's branding and access controls:
 *
 *   - every key is on the assembled plugin (ee/Dashboard/Index.tsx), lazy,
 *     and nowhere else: each area owns only its own keys;
 *   - each area's files reach core only through "@oneuptime/dashboard/..."
 *     and "Common/...", and never import back the core shell that reads the
 *     plugins (that import cycle crashes the Enterprise bundle);
 *   - the cards that moved out of core are here, and gone from core: the
 *     Community image does not ship them.
 */

import EnterpriseDashboardPlugins from "../../../Dashboard/Index";
import CustomRolesPlugins from "../../../Dashboard/CustomRoles/Plugins";
import IpAllowlistPlugins from "../../../Dashboard/IpAllowlists/Plugins";
import StatusPageAccessControlsPlugins from "../../../Dashboard/StatusPageAccessControls/Plugins";
import StatusPageBrandingPlugins from "../../../Dashboard/StatusPageBranding/Plugins";
import {
  DASHBOARD_ENTERPRISE_PLUGIN_KEYS,
  DashboardEnterprisePlugins,
} from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const EE_DASHBOARD_DIR: string = path.join(EE_DIR, "Dashboard");
const DASHBOARD_SRC: string = path.join(
  EE_DIR,
  "..",
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

// React.lazy's own marker, so a plain component handed over fails here.
const LAZY_TYPE: symbol = Symbol.for("react.lazy");

interface Area {
  directory: string;
  plugins: Partial<DashboardEnterprisePlugins>;
  keys: Array<string>;
  // The core shells that read these plugins, which the area must never import.
  shells: Array<string>;
}

const AREAS: Array<Area> = [
  {
    directory: "CustomRoles",
    plugins: CustomRolesPlugins,
    keys: ["TeamRoles", "TeamRoleView", "TeamCustomRoles", "ApiKeyCustomRoles"],
    shells: [
      "@oneuptime/dashboard/Pages/Teams/Roles",
      "@oneuptime/dashboard/Pages/Teams/RoleView",
      "@oneuptime/dashboard/Components/Team/TeamCustomRolesSettings",
      "@oneuptime/dashboard/Components/ApiKey/ApiKeyCustomRolesSettings",
    ],
  },
  {
    directory: "IpAllowlists",
    plugins: IpAllowlistPlugins,
    keys: ["IpAllowlistCard"],
    shells: ["@oneuptime/dashboard/Components/IpAllowlist/IpAllowlistSettings"],
  },
  {
    directory: "StatusPageBranding",
    plugins: StatusPageBrandingPlugins,
    keys: ["StatusPagePoweredBy"],
    shells: [
      "@oneuptime/dashboard/Components/StatusPage/StatusPagePoweredBySettings",
    ],
  },
  {
    directory: "StatusPageAccessControls",
    plugins: StatusPageAccessControlsPlugins,
    keys: ["StatusPageSessionLength", "StatusPageSubscriberRestrictions"],
    shells: [
      "@oneuptime/dashboard/Components/StatusPage/StatusPageSessionLengthSettings",
      "@oneuptime/dashboard/Components/StatusPage/SubscriberRestrictionsSettings",
    ],
  },
];

const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const source: string = fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
};

const sourceFilesOf: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  return fs
    .readdirSync(directory)
    .filter((file: string): boolean => {
      return TYPESCRIPT_FILE.test(file);
    })
    .map((file: string): string => {
      return path.join(directory, file);
    });
};

describe.each(AREAS)("ee/Dashboard/$directory", (area: Area) => {
  test("owns exactly its keys, each lazy, and the assembled plugin carries them", () => {
    expect(Object.keys(area.plugins).sort()).toEqual([...area.keys].sort());

    for (const key of area.keys) {
      const component: unknown = (area.plugins as Record<string, unknown>)[key];

      expect({
        key,
        isLazy: (component as { $$typeof?: symbol }).$$typeof === LAZY_TYPE,
      }).toEqual({ key, isLazy: true });
      expect((EnterpriseDashboardPlugins as Record<string, unknown>)[key]).toBe(
        component,
      );
      expect(
        DASHBOARD_ENTERPRISE_PLUGIN_KEYS as ReadonlyArray<string>,
      ).toContain(key);
    }
  });

  test("reaches core only through the mapped specifiers, and never imports back a shell", () => {
    const directory: string = path.join(EE_DASHBOARD_DIR, area.directory);
    const MAPPED: RegExp = /^(@oneuptime\/dashboard\/|Common\/|react$)/;

    for (const file of sourceFilesOf(directory)) {
      for (const specifier of importsOf(file)) {
        const where: string = `${path.basename(file)}: ${specifier}`;

        if (specifier.startsWith(".")) {
          expect({
            where,
            staysInEeDashboard: path
              .resolve(path.dirname(file), specifier)
              .startsWith(EE_DASHBOARD_DIR),
          }).toEqual({ where, staysInEeDashboard: true });
          continue;
        }

        expect({ where, isMapped: MAPPED.test(specifier) }).toEqual({
          where,
          isMapped: true,
        });
        expect({
          where,
          isShell:
            area.shells.includes(specifier) ||
            specifier === "@oneuptime/dashboard/Enterprise/Plugins",
        }).toEqual({ where, isShell: false });
      }
    }
  });
});

describe("what moved out of core", () => {
  test.each([
    ["Components/StatusPage/StatusPageSessionLengthCard.tsx"],
    ["Components/StatusPage/SubscriberRestrictionsCard.tsx"],
    ["Components/Team/TeamCustomRoleTable.tsx"],
    ["Components/CustomRole/CustomRoleCreateForm.ts"],
    ["Components/CustomRole/CustomRoleCreateNotice.tsx"],
    ["Components/CustomRole/CustomRolePermissionPicker.ts"],
    ["Components/CustomRole/CustomRolePermissionTable.tsx"],
    ["Components/CustomRole/CustomRoleTeamsTable.tsx"],
    ["Components/CustomRole/CustomRoleApiKeysTable.tsx"],
    ["Components/ApiKey/ApiKeyCustomRoleTable.tsx"],
    ["Components/FormBuilder/FormPlan.ts"],
  ])("%s is no longer in the Community Dashboard", (file: string) => {
    expect(fs.existsSync(path.join(DASHBOARD_SRC, file))).toBe(false);
  });

  test.each([
    ["Components/IpAllowlist/IpAllowlistSettings.tsx"],
    ["Components/StatusPage/StatusPagePoweredBySettings.tsx"],
    ["Components/StatusPage/StatusPageSessionLengthSettings.tsx"],
    ["Components/StatusPage/SubscriberRestrictionsSettings.tsx"],
    ["Components/Team/TeamCustomRolesSettings.tsx"],
    ["Components/ApiKey/ApiKeyCustomRolesSettings.tsx"],
    ["Pages/Teams/Roles.tsx"],
    ["Pages/Teams/RoleView.tsx"],
  ])(
    "%s, the shell, stays in core and draws no Enterprise card itself",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      expect(source).toContain("getDashboardPlugins()");
      expect(source).not.toContain("<CardModelDetail");
      expect(source).not.toContain("StatusPageSwitchRow");
    },
  );

  test("the Powered by switch is no longer on the What your status page shows card", () => {
    const copy: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components/StatusPage/StatusPageDisplaySettingsCopy.ts",
      ),
      "utf8",
    );

    expect(copy).not.toContain('id: "powered-by"');
    expect(copy).not.toContain('column: "hidePoweredByOneUptimeBranding"');
  });
});
