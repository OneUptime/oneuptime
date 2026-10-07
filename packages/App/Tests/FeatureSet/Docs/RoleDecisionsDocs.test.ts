import Workflow from "Common/Models/DatabaseModels/Workflow";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
} from "Common/Types/Workflow/WorkflowRunPermissions";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say what the workflow roles do the way the product does:
 *
 *   - Workflow Admin builds workflows - creates, changes, runs and deletes
 *     them, and their variables;
 *   - Workflow Member opens and runs them by hand, and changes none of
 *     them, nor runs one step on its own;
 *   - Workflow Viewer reads them.
 *
 * Every docs language says it, on the workflow Configuration page's
 * permissions section and on Users, Teams & Permissions. The role and
 * permission names stay in English there, as the permission picker shows
 * them, so the sections are found and held to the model by those names.
 */

const CONTENT_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readDoc(lang: string, relative: string): string {
  return fs.readFileSync(path.join(CONTENT_ROOT, lang, relative), "utf8");
}

// The section of a page (from its "## " heading to the next) holding `needle`.
function sectionHolding(page: string, needle: RegExp): string {
  const sections: Array<string> = page.split(/\n(?=## )/);
  const holding: Array<string> = sections.filter((section: string) => {
    return needle.test(section);
  });

  expect(holding).toHaveLength(1);

  return holding[0]!;
}

/*
 * The workflow roles' bullet list: "- **Workflow Admin** — ...", with the
 * dash each language writes (Chinese sets "——" with no space before it).
 */
const ROLE_BULLET: (title: string) => RegExp = (title: string): RegExp => {
  return new RegExp(`^- \\*\\*${title}\\*\\*\\s*[—–-]`, "m");
};

function permissionsSection(lang: string): string {
  return sectionHolding(
    readDoc(lang, "workflows/configuration.md"),
    ROLE_BULLET("Workflow Member"),
  );
}

function titleOf(permission: Permission): string {
  return PermissionHelper.getPermissionTitles([permission])[0]!;
}

describe("the English workflow permissions", () => {
  const section: string = permissionsSection("en");

  test("say what each workflow role does", () => {
    expect(section).toContain(
      "- **Workflow Admin** — builds workflows: creates, changes, runs and deletes them, and manages the variables they use.",
    );
    expect(section).toContain(
      "- **Workflow Member** — uses them: opens workflows and their runs, and runs a workflow by hand with **Run Workflow**. A member can't create, change or delete a workflow, or run one of its steps on its own.",
    );
    expect(section).toContain(
      "- **Workflow Viewer** — reads workflows and their runs.",
    );
  });

  test("say who runs a whole workflow, and who runs one step, by the lists the routes ask for", () => {
    const runners: Array<string> = WORKFLOW_RUN_PERMISSIONS.filter(
      (permission: Permission): boolean => {
        return (
          permission !== Permission.ProjectOwner &&
          permission !== Permission.ProjectAdmin
        );
      },
    ).map(titleOf);

    expect(runners).toEqual([
      "Edit Workflow",
      "Workflow Admin",
      "Workflow Member",
    ]);
    expect(section).toContain(
      "Running a whole workflow by hand takes **Edit Workflow**, **Workflow Admin** or **Workflow Member**.",
    );
    expect(section).toContain(
      "**Edit Workflow** — also what it takes to run one step on its own with **Run just this step**",
    );
    expect(WORKFLOW_EDIT_PERMISSIONS).not.toContain(Permission.WorkflowMember);
  });

  test("say what Project Member may do, as the workflow's own lists say it", () => {
    const workflow: Workflow = new Workflow();

    expect(workflow.getCreatePermissions()).toContain(Permission.ProjectMember);
    expect(workflow.getDeletePermissions()).toContain(Permission.ProjectMember);
    expect(workflow.getUpdatePermissions()).not.toContain(
      Permission.ProjectMember,
    );
    expect(WORKFLOW_RUN_PERMISSIONS).not.toContain(Permission.ProjectMember);

    expect(section).toContain(
      "**Project Member** can create and delete workflows, but not change or run them.",
    );
  });

  test("say a run follows the labels of the role that allows it, and what a locked button looks like", () => {
    expect(section).toContain(
      "a role limited to some labels, or to the workflows your team owns, runs only those.",
    );
    expect(section).toContain(
      "Someone who can't run a workflow sees **Run Workflow** greyed out, with the reason in its tooltip.",
    );
  });

  test("no longer give the Workflow Member create, edit or delete", () => {
    expect(section).not.toMatch(/\*\*Workflow Member\*\* [—–-] (can )?create/i);
  });
});

describe.each(LANGUAGES)("the %s docs", (lang: string) => {
  test("the workflow permissions name all three workflow roles, one bullet each", () => {
    const section: string = permissionsSection(lang);

    for (const title of [
      "Workflow Admin",
      "Workflow Member",
      "Workflow Viewer",
    ]) {
      expect([lang, title, ROLE_BULLET(title).test(section)]).toEqual([
        lang,
        title,
        true,
      ]);
    }
  });

  test("they say a whole workflow is run by Edit Workflow, Workflow Admin or Workflow Member, in one line", () => {
    const lines: Array<string> = permissionsSection(lang)
      .split("\n")
      .filter((line: string): boolean => {
        return (
          line.includes("**Edit Workflow**") &&
          line.includes("**Workflow Admin**") &&
          line.includes("**Workflow Member**")
        );
      });

    expect([lang, lines.length]).toEqual([lang, 1]);
  });

  test("they say Project Owner and Project Admin may do everything a Workflow Admin may", () => {
    const section: string = permissionsSection(lang);

    expect(section).toContain("**Project Owner**");
    expect(section).toContain("**Project Admin**");
  });

  test("Users, Teams & Permissions says the Workflow Member runs and the Workflow Admin builds, and links there", () => {
    const page: string = readDoc(lang, "permissions/index.md");
    const paragraphs: Array<string> = page
      .split(/\n\s*\n/)
      .filter((paragraph: string): boolean => {
        return (
          paragraph.includes("`WorkflowMember`") &&
          paragraph.includes("`WorkflowAdmin`")
        );
      });

    expect([lang, paragraphs.length]).toEqual([lang, 1]);
    expect(paragraphs[0]).toContain("/docs/workflows/configuration");
  });
});
