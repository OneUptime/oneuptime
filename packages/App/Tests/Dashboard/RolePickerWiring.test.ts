import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY ADD A ROLE ASKS THE SAME TWO QUESTIONS.
 *
 * The maintainer, on the Add a Role dialog's forty look-alike cards: "This
 * is very confusing. it gives a lot of information to the user. Can you
 * please make the UI a lot better to understand? ... Make it natural for
 * people to understand and use." The dialog now asks what every built-in
 * role answers - the whole project, or one area; for an area, Admin, Member
 * or Viewer - through one picker (Components/Permission/RolePicker), built
 * into a form by one field (RolePickerFormField).
 *
 * These hold the wiring, so a table written or refactored later cannot
 * quietly bring the wall of cards back:
 *
 *   - a team's (allow and block), an API key's and a custom role's Add Role
 *     each use the one field, with what each needs: a block's and a custom
 *     role's picker open on One area, a custom role's leaves out Project
 *     Owner, an API key's is for adding only;
 *   - nothing in the Dashboard hands the role cards to a card grid; the
 *     cards are read only where roles are listed, not picked;
 *   - each role dialog is of medium width, and says what it adds in its
 *     title alone - the field's old help is gone;
 *   - a role's Scope folds under More fields;
 *   - the catalog and the picker's options stay React-free.
 *
 * Source is read as text: App's tests never import a React module. What the
 * picker does is rendered in Common/Tests/App/Dashboard/RolePicker.test.tsx,
 * on the team and API key pages in TeamViewPermissions / ApiKeyView
 * Permissions, and in real Chromium in packages/E2E/CustomRoles.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const SOURCE_FILE: RegExp = /\.tsx?$/;

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function listSources(directory: string = DASHBOARD_SRC): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(path.relative(DASHBOARD_SRC, full));
    }
  }

  return files;
}

const TEAM_TABLE: string = "Components/Team/TeamPermissionTable.tsx";
const KEY_TABLE: string = "Components/ApiKey/ApiKeyPermissionTable.tsx";
const ROLE_TABLE: string =
  "Components/CustomRole/CustomRolePermissionTable.tsx";

describe("every Add Role uses the one role field", () => {
  test("a team's: the whole project to start with; its block table on One area", () => {
    const table: string = readSource(TEAM_TABLE);

    expect(table).toContain(
      'import { getRolePickerFormField } from "../Permission/RolePickerFormField";',
    );
    expect(table).toContain("getRolePickerFormField<TeamPermission>({");
    expect(table).toContain(
      "startOn: isBlock ? RoleReach.OneArea : RoleReach.WholeProject,",
    );
    // A new role clears the labels picked for the last one, as before.
    expect(table).toContain(
      'await formRef.current.setFieldValue("labels", [], true);',
    );
  });

  test("an API key's: for adding only - a row is edited with the one-permission list", () => {
    const table: string = readSource(KEY_TABLE);

    expect(table).toContain(
      "getRolePickerFormField<ApiKeyPermission>({ doNotShowWhenEditing: true, }),",
    );
    expect(table).toContain(
      "setCreatePermissionType(CreatePermissionType.Granular);",
    );
  });

  test("a custom role's: without Project Owner, opening on One area", () => {
    const table: string = readSource(ROLE_TABLE);

    expect(table).toContain(
      "getRolePickerFormField<CustomRolePermission>({ excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE, startOn: RoleReach.OneArea, onChange: onPermissionPicked, }),",
    );
  });

  test("the field draws the picker for the permission column, required, with no label or help over it", () => {
    const field: string = readSource(
      "Components/Permission/RolePickerFormField.tsx",
    );

    expect(field).toContain(
      "field: { permission: true } as unknown as SelectFormFields<TEntity>,",
    );
    expect(field).toContain("fieldType: FormFieldSchemaType.CustomComponent,");
    expect(field).toContain("customElementDrawsOwnLabel: true,");
    expect(field).toContain("required: true,");
    expect(field).toContain("<RolePicker ");
    expect(field).not.toContain("description:");
  });
});

describe("no Add Role draws a wall of cards again", () => {
  test.each([TEAM_TABLE, KEY_TABLE, ROLE_TABLE])(
    "%s builds no card grid of roles",
    (file: string) => {
      const table: string = readSource(file);

      expect(table).not.toContain("FormFieldSchemaType.CardSelect");
      expect(table).not.toContain("cardSelectOptions");
      expect(table).not.toContain("getRoleCardSelectOptions");
    },
  );

  /*
   * The role cards are read where roles are listed rather than picked one
   * by one: the Built-in Roles card (looked up), the roles a new custom
   * role starts with (a searchable dropdown), and the picker's own options.
   */
  test("the role cards are read only where roles are listed", () => {
    const readers: Array<string> = listSources()
      .filter((file: string): boolean => {
        return readSource(file).includes("getRoleCardSelectOptions(");
      })
      .sort();

    expect(readers).toEqual(
      [
        path.join("Components", "CustomRole", "BuiltInRolesCard.tsx"),
        path.join("Components", "CustomRole", "CustomRoleCreateForm.ts"),
      ].sort(),
    );
  });

  test("only the role field draws the role picker", () => {
    // The element, not a type such as Array<RolePickerRole>.
    const drawing: Array<string> = listSources()
      .filter((file: string): boolean => {
        return readSource(file).includes("<RolePicker ");
      })
      .sort();

    expect(drawing).toEqual([
      path.join("Components", "Permission", "RolePickerFormField.tsx"),
    ]);
  });
});

describe("the dialogs", () => {
  test.each([
    [
      TEAM_TABLE,
      "createEditModalWidth={ createPermissionType === CreatePermissionType.RoleBased ? ModalWidth.Medium : ModalWidth.Large }",
    ],
    [
      KEY_TABLE,
      "createEditModalWidth={ !isBlock && createPermissionType === CreatePermissionType.RoleBased ? ModalWidth.Medium : ModalWidth.Large }",
    ],
    [
      ROLE_TABLE,
      "createEditModalWidth={isRoleBased ? ModalWidth.Medium : ModalWidth.Large}",
    ],
  ])(
    "%s draws Add Role at medium width, the full permission list wide",
    (file: string, width: string) => {
      expect(readSource(file)).toContain(width);
    },
  );

  test.each([
    [TEAM_TABLE, "A ready-made set of permissions."],
    [
      KEY_TABLE,
      "A role is a ready-made set of permissions. The key can do what the role allows in the whole project.",
    ],
    [
      ROLE_TABLE,
      "A built-in role to bundle into this one. Every team with this role gets what it can do.",
    ],
  ])(
    "%s says what Add Role adds in its title alone: the field's help is gone",
    (file: string, help: string) => {
      expect(readSource(file)).not.toContain(help);
    },
  );

  test("a role's Scope, and the labels it may ask for, fold under More fields", () => {
    const scope: string = readSource(
      "Components/Permission/PermissionScopeChoice.ts",
    );

    expect(scope).toContain(
      "const moreFields: FormFieldCollapsibleSection<TEntity> = getAdvancedFormSection<TEntity>();",
    );
    expect(scope.split("collapsibleSection: moreFields,").length - 1).toBe(2);
  });
});

describe("the picker", () => {
  const picker: string = readSource("Components/Permission/RolePicker.tsx");

  test("asks Whole project | One area, and Admin | Member | Viewer, with the product's switch", () => {
    expect(picker).toContain(
      'import ViewSwitch, { ViewSwitchOption, } from "Common/UI/Components/ViewSwitch/ViewSwitch";',
    );
    expect(picker.split("<ViewSwitch<").length - 1).toBe(2);
    expect(picker.split("fillWidthOnPhone={true}").length - 1).toBe(2);
  });

  test("its lists are the browser's own radios, one group each, out of sight but focusable", () => {
    expect(picker).toContain('type="radio"');
    expect(picker).toContain('className="sr-only"');
    expect(picker).toContain('role="radiogroup"');
    expect(picker).not.toContain('role="radio"');
  });

  test("the search box is a named search box, and Escape stops at it while it holds text", () => {
    expect(picker).toContain('role="searchbox"');
    expect(picker).toContain(
      'if (event.key === "Escape" && search.length > 0) { event.preventDefault(); event.stopPropagation(); setSearch(""); return; }',
    );
  });

  test("it says a role is missing only on Add Role, never as focus moves on", () => {
    expect(picker).not.toContain("onBlur");
  });

  test.each([
    "Components/Permission/RoleCatalog.ts",
    "Components/Permission/RolePickerOptions.ts",
  ])(
    "%s stays React-free, so tests read it without rendering",
    (file: string) => {
      const source: string = readSource(file);

      expect(source).not.toContain('from "react"');
      expect(source).not.toContain('.tsx"');
      expect(source).not.toContain('from "./RolePicker"');
    },
  );
});
