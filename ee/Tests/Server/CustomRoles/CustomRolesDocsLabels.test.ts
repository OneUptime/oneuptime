import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The labels the docs' custom roles steps name (Users, Teams & Permissions >
 * Permissions > Custom roles), held to the Enterprise screens that draw them
 * (ee/Dashboard/CustomRoles) - so a renamed button fails here, not in a
 * reader's hands. Core's CustomRolesDocs.test.ts holds the labels core draws
 * (the Teams menu's Roles, Built-in Roles, Create Team's Access) and the
 * rest of the section; core CI runs without ee/, so these live here.
 *
 * Lives in the server jest project because it only reads files.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const AREA_DIR: string = path.join(EE_DIR, "Dashboard", "CustomRoles");
const DOCS_PAGE: string = path.join(
  EE_DIR,
  "..",
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "permissions",
  "index.md",
);

const readSource: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(AREA_DIR, file), "utf8");
};

// The English section, from its heading to the next heading of its level.
const englishSection: () => string = (): string => {
  const page: string = fs.readFileSync(DOCS_PAGE, "utf8");
  const start: number = page.indexOf("\n### Custom roles\n");

  expect(start).toBeGreaterThan(0);

  const end: number = page.indexOf("\n### ", start + 1);

  return page.slice(start, end);
};

describe("the labels the custom roles steps name, as the Enterprise screens draw them", () => {
  const DRAWN_BY: ReadonlyArray<{
    label: string;
    file: string;
    source: string;
  }> = [
    {
      // The Roles table's create button: "Create" and its singular name.
      label: "Create Custom Role",
      file: "RolesPage.tsx",
      source: 'singularName="Custom Role"',
    },
    {
      label: "Name",
      file: "CustomRoleCreateForm.ts",
      source: 'title: "Name"',
    },
    {
      label: "Permissions",
      file: "CustomRoleCreateForm.ts",
      source: 'title: "Permissions"',
    },
    {
      label: "Add Role",
      file: "CustomRolePermissionTable.tsx",
      source: 'title: "Add Role"',
    },
    {
      label: "Add Permission",
      file: "CustomRolePermissionTable.tsx",
      source: 'title: "Add Permission"',
    },
    {
      label: "Give to a Team",
      file: "CustomRoleTeamsTable.tsx",
      source: 'title: "Give to a Team"',
    },
    {
      label: "Teams with this Role",
      file: "CustomRoleTeamsTable.tsx",
      source: 'title: "Teams with this Role"',
    },
    {
      label: "Remove",
      file: "CustomRoleTeamsTable.tsx",
      source: 'deleteButtonText="Remove"',
    },
    {
      label: "Add Custom Role",
      file: "TeamCustomRoleTable.tsx",
      source: 'title: "Add Custom Role"',
    },
    {
      // An API key's page has it too.
      label: "Add Custom Role",
      file: "ApiKeyCustomRoleTable.tsx",
      source: 'title: "Add Custom Role"',
    },
    {
      label: "Give to an API Key",
      file: "CustomRoleApiKeysTable.tsx",
      source: 'title: "Give to an API Key"',
    },
    {
      label: "API Keys with this Role",
      file: "CustomRoleApiKeysTable.tsx",
      source: 'title: "API Keys with this Role"',
    },
  ];

  test.each(DRAWN_BY)(
    "$label is in the section, and drawn by $file",
    (entry: { label: string; file: string; source: string }) => {
      expect(englishSection()).toContain(`**${entry.label}**`);
      expect(readSource(entry.file)).toContain(entry.source);
    },
  );

  test("the description is folded under More fields, as the form folds it", () => {
    expect(readSource("CustomRoleCreateForm.ts")).toContain(
      "collapsibleSection: advanced",
    );
    expect(englishSection()).toContain(
      "The description is under **More fields**.",
    );
  });

  test("the section says custom roles are an Enterprise feature, and what keeps applying without one", () => {
    const section: string = englishSection();

    expect(section).toContain("Enterprise Edition");
    expect(section).toContain("Scale plan");
  });
});
