import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The custom role screens, now Enterprise screens in ee/Dashboard/CustomRoles,
 * held to the wiring core holds every other Add Role to
 * (packages/App/Tests/Dashboard/RolePickerWiring.test.ts, which core CI runs
 * without ee/):
 *
 *   - a custom role's Add Role uses the one role field, without Project
 *     Owner, opening on One area, and keeps the More fields room with the
 *     Scope's own question;
 *   - it builds no card grid of roles, draws Add Role at medium width and
 *     the full permission list wide, and says what Add Role adds in its
 *     title alone;
 *   - the create form is the one place here that lists the role cards (as a
 *     searchable dropdown of the roles a new role starts with);
 *   - every file reaches core through "@oneuptime/dashboard/..." and
 *     "Common/..." only, and none imports back a core shell that reads the
 *     plugins (Pages/Teams/Roles, Pages/Teams/RoleView,
 *     Components/Team/TeamCustomRolesSettings): that import cycle crashes
 *     the Enterprise bundle.
 */

const AREA_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Dashboard",
  "CustomRoles",
);

const WHITESPACE: RegExp = /\s+/g;
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

const ROLE_TABLE: string = "CustomRolePermissionTable.tsx";
const CREATE_FORM: string = "CustomRoleCreateForm.ts";

// Without its comments, collapsed to one line.
const readSource: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(path.join(AREA_DIR, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1 ")
    .replace(WHITESPACE, " ");
};

const AREA_FILES: Array<string> = fs
  .readdirSync(AREA_DIR)
  .filter((file: string): boolean => {
    return TYPESCRIPT_FILE.test(file);
  })
  .sort();

const importsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const source: string = fs
    .readFileSync(path.join(AREA_DIR, file), "utf8")
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

describe("a custom role's Add Role uses the one role field", () => {
  const table: string = readSource(ROLE_TABLE);

  test("without Project Owner, opening on One area", () => {
    expect(table).toContain(
      "getRolePickerFormField<CustomRolePermission>({ excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE, startOn: RoleReach.OneArea, onChange: onPermissionPicked, isMoreFieldsShownFor: isScopeShownFor, }),",
    );
  });

  test("it keeps the More fields room with the Scope's own question", () => {
    expect(table).toContain("isMoreFieldsShownFor: isScopeShownFor,");
    expect(table).toContain('return isScopeShownFor(values["permission"]);');
    expect(table).toContain(
      'import { getPermissionScopeFields, isScopeShownFor, } from "@oneuptime/dashboard/Components/Permission/PermissionScopeChoice";',
    );
  });

  test("it builds no card grid of roles", () => {
    expect(table).not.toContain("FormFieldSchemaType.CardSelect");
    expect(table).not.toContain("cardSelectOptions");
    expect(table).not.toContain("getRoleCardSelectOptions");
  });

  test("Add Role is of medium width, the full permission list wide", () => {
    expect(table).toContain(
      "createEditModalWidth={isRoleBased ? ModalWidth.Medium : ModalWidth.Large}",
    );
  });

  test("it says what Add Role adds in its title alone: the field's help is gone", () => {
    expect(table).not.toContain(
      "A built-in role to bundle into this one. Every team with this role gets what it can do.",
    );
  });

  test("its Add Role is the role picker, with no list of its own left behind", () => {
    const raw: string = fs.readFileSync(
      path.join(AREA_DIR, ROLE_TABLE),
      "utf8",
    );

    expect(raw).toContain("getRolePickerFormField<CustomRolePermission>(");
    expect(raw).not.toContain("roleIconMap");
    expect(raw).not.toContain("getRolePermissionProps");
  });

  test("the roles a new custom role starts with leave out the ones never in a custom role", () => {
    const form: string = readSource(CREATE_FORM);

    expect(form).toContain(
      "getRoleCardSelectOptions({ excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE, })",
    );
    expect(form).not.toContain("getRolePermissionProps");
  });

  test("the create form is the one file here that lists the role cards", () => {
    expect(readSource(CREATE_FORM)).toContain("getRoleCardSelectOptions(");
    expect(
      AREA_FILES.filter((file: string): boolean => {
        return readSource(file).includes("getRoleCardSelectOptions(");
      }),
    ).toEqual([CREATE_FORM]);
  });

  test("no file here draws the role picker itself", () => {
    for (const file of AREA_FILES) {
      expect({
        file,
        drawsPicker: readSource(file).includes("<RolePicker "),
      }).toEqual({ file, drawsPicker: false });
    }
  });
});

describe("the area's imports", () => {
  test("the moved screens are all here", () => {
    expect(AREA_FILES).toEqual(
      [
        "ApiKeyCustomRoleTable.tsx",
        "CustomRoleApiKeysTable.tsx",
        "CustomRoleCreateForm.ts",
        "CustomRoleCreateNotice.tsx",
        "CustomRolePermissionPicker.ts",
        "CustomRolePermissionTable.tsx",
        "CustomRoleTeamsTable.tsx",
        "Plugins.ts",
        "RoleViewPage.tsx",
        "RolesPage.tsx",
        // The Roles page's name as a link, for the cards' and dialogs' words.
        "RolesPageLink.tsx",
        "TeamCustomRoleTable.tsx",
      ].sort(),
    );
  });

  test.each(AREA_FILES)(
    "%s reaches core only through the mapped specifiers",
    (file: string) => {
      const EE_DASHBOARD_DIR: string = path.resolve(AREA_DIR, "..");
      const MAPPED: RegExp = /^(@oneuptime\/dashboard\/|Common\/|react$)/;

      for (const specifier of importsOf(file)) {
        if (specifier.startsWith(".")) {
          // Within ee/Dashboard: this area, or its shared license helpers.
          const resolved: string = path.resolve(AREA_DIR, specifier);

          expect({
            file,
            specifier,
            staysInEeDashboard: resolved.startsWith(EE_DASHBOARD_DIR),
          }).toEqual({ file, specifier, staysInEeDashboard: true });
          continue;
        }

        expect({ file, specifier, isMapped: MAPPED.test(specifier) }).toEqual({
          file,
          specifier,
          isMapped: true,
        });
      }
    },
  );

  test.each(AREA_FILES)(
    "%s never imports back a core shell that reads the plugins",
    (file: string) => {
      const shells: Array<string> = [
        "@oneuptime/dashboard/Pages/Teams/Roles",
        "@oneuptime/dashboard/Pages/Teams/RoleView",
        "@oneuptime/dashboard/Components/Team/TeamCustomRolesSettings",
        "@oneuptime/dashboard/Components/ApiKey/ApiKeyCustomRolesSettings",
        "@oneuptime/dashboard/Enterprise/Plugins",
      ];

      for (const specifier of importsOf(file)) {
        expect({
          file,
          specifier,
          isShell: shells.includes(specifier),
        }).toEqual({ file, specifier, isShell: false });
      }
    },
  );
});
