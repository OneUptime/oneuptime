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
 *   - a role's Scope folds under More fields, and where it does, the picker
 *     keeps that line's room while it is not drawn - asked with the one
 *     question the Scope asks, so the dialog never moves as roles are
 *     picked;
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

/*
 * A custom role's Add Role (CustomRolePermissionTable) and its create form
 * are Enterprise screens in ee/Dashboard/CustomRoles, which core CI never
 * sees: ee/Tests/UI/CustomRoles/CustomRolesWiring.test.ts holds them to the
 * same wiring.
 */

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

  /*
   * The More fields line (Scope) is drawn under the picker only for a role
   * that takes a scope. The picker keeps its room the rest of the time, and
   * asks the very question the Scope field asks, so the room is there
   * exactly while the line is not: the first pick, and every move between a
   * role with a scope and one without, used to move the dialog by a line.
   */
  test.each([TEAM_TABLE])(
    "%s keeps the More fields room with the Scope's own question",
    (file: string) => {
      const table: string = readSource(file);

      expect(table).toContain("isMoreFieldsShownFor: isScopeShownFor,");
      expect(table).toContain('return isScopeShownFor(values["permission"]);');
      expect(table).toContain(
        'import { getPermissionScopeFields, isScopeShownFor, } from "../Permission/PermissionScopeChoice";',
      );
    },
  );

  test("an API key's Add Role folds nothing under the picker, so it keeps no room", () => {
    expect(readSource(KEY_TABLE)).not.toContain("isMoreFieldsShownFor");
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
    // The room is kept only while the form says its line is not drawn.
    expect(field).toContain(
      "keepsMoreFieldsRoom={ options?.isMoreFieldsShownFor ? !options.isMoreFieldsShownFor(picked) : false }",
    );
  });
});

describe("no Add Role draws a wall of cards again", () => {
  test.each([TEAM_TABLE, KEY_TABLE])(
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

    // And the custom role create form, in ee (CustomRolesWiring.test.ts).
    expect(readers).toEqual([
      path.join("Components", "CustomRole", "BuiltInRolesCard.tsx"),
    ]);
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

  /*
   * The dialog is centred on a desktop and rises from the bottom of a
   * phone, so whatever grows under a row or tile moves it from under the
   * pointer. What a pick changes keeps its room instead.
   */
  test("nothing a pick changes moves the dialog", () => {
    // Every row keeps its check's room, drawn or not.
    expect(picker).toContain(
      '<div className="h-5 w-5 flex-shrink-0" data-testid={isGhost ? undefined : "role-picker-role-check"} > {isChecked ? (',
    );
    // The panel's words sit in one grid cell with all it could say, unseen.
    expect(picker).toContain(
      'className="invisible col-start-1 row-start-1 min-w-0"',
    );
    expect(picker).toContain(
      "{[hintWords, ...areaRoles.map(getRoleWords)].map(",
    );
    expect(picker).not.toContain("min-h-[3.875rem]");
    /*
     * The body is one cell, the answer not on screen kept out of sight in
     * it, so switching answers moves nothing; no guessed minimum height.
     */
    expect(picker).toContain(
      '<div className="relative mt-4 grid" data-testid="role-picker-body">',
    );
    expect(picker).toContain("renderGhost(renderWholeProject(true))");
    expect(picker).toContain("renderGhost(renderOneArea(true))");
    expect(picker).not.toContain("min-h-[17.5rem]");
    // The More fields line's room, with a missing role said inside it.
    expect(picker).toContain(
      '<div className={MORE_FIELDS_ROOM} data-testid="role-picker-room"> {renderError()} </div>',
    );
  });

  /*
   * What keeps the room of an answer that is not on screen is never read
   * out, never reached by Tab and never found by a test id: it draws no
   * radio, no id and no test id of its own.
   */
  test("the room of an answer not on screen holds no radio, id or test id", () => {
    expect(picker).toContain(
      '{isGhost ? ( <></> ) : ( <input type="radio" className="sr-only" name={groupName} value={role.permission}',
    );
    expect(picker).toContain(
      '{isGhost ? ( <></> ) : ( <input type="radio" className="sr-only" name={groupName} value={entry.area.id}',
    );
    expect(picker).toContain(
      "const titleId: string | undefined = isGhost ? undefined",
    );
    expect(picker).toContain(
      '<div aria-hidden="true" className="invisible col-start-1 row-start-1 min-w-0" data-testid="role-picker-body-room" >',
    );
  });

  test("while the search lists matches, neither answer is pressed", () => {
    expect(picker).toContain("value={isSearching ? null : reach}");
  });

  /*
   * A centred dialog that grew and shrank with each letter typed moved the
   * search box from under the caret: from sm up the matches scroll inside
   * the answers' room, and a match the arrow keys reach is scrolled into
   * view whole (its radio is a pixel at the row's top).
   */
  test("a search never moves the search box, and every match it reaches is seen whole", () => {
    expect(picker).toContain(
      'const SEARCH_RESULTS_IN_ROOM: string = "sm:absolute sm:inset-0 sm:-m-1 sm:overflow-y-auto sm:overscroll-contain sm:p-1 sm:pb-6',
    );
    expect(picker).toContain('isSearching ? SEARCH_RESULTS_IN_ROOM : ""');
    expect(picker).toContain('row.scrollIntoView({ block: "nearest" });');
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
