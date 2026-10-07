import Permission from "Common/Types/Permission";
import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_RUN_PERMISSIONS,
} from "Common/Types/Runbook/RunbookRunPermissions";
import { PROJECT_BILLING_READ_ROLES } from "Common/Utils/Project/ProjectBilling";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say what the runbook and billing roles do the way the product
 * does (Common/Types/Runbook/RunbookRunPermissions, Common/Utils/Project
 * /ProjectBilling):
 *
 *   - Runbook Member opens runbooks and their runs and runs them, and builds
 *     none; Runbook Admin builds them; Runbook Viewer reads them. A role runs
 *     only the runbooks its scope reaches.
 *   - Billing Viewer reads the billing, Billing Member also downloads
 *     invoices and changes the contact details, Billing Admin also switches
 *     the paid channels; the plan, payment methods, balances and paying
 *     invoices stay with Project Owner and Manage Billing.
 *
 * Every docs language says it, on Users, Teams & Permissions and on the
 * runbook Configuration and Agents pages. The role and permission keys stay
 * in English there, as the permission picker and the API show them, so the
 * paragraphs are found and held to the product's lists by those keys.
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

function paragraphsWith(
  page: string,
  ...needles: Array<string>
): Array<string> {
  return page.split(/\n\s*\n/).filter((paragraph: string): boolean => {
    return needles.every((needle: string): boolean => {
      return paragraph.includes(needle);
    });
  });
}

// Every permission key a paragraph names, in backticks.
function keysIn(paragraph: string): Array<string> {
  return Array.from(paragraph.matchAll(/`([A-Za-z]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the English docs", () => {
  test("Users, Teams & Permissions says the Runbook Member runs and the Runbook Admin builds", () => {
    const page: string = readDoc("en", "permissions/index.md");

    expect(page).toContain(
      "`RunbookMember` opens runbooks and their runs and runs them: it starts a run, completes or skips its steps and cancels it. Neither creates, changes or deletes what it runs; `WorkflowAdmin` and `RunbookAdmin` build them.",
    );
    expect(page).toContain(
      "A role runs only the runbooks its scope reaches, so a `RunbookMember` limited to some labels runs the runbooks that carry them.",
    );
  });

  test("Users, Teams & Permissions says what each billing role does, and who changes the plan", () => {
    const page: string = readDoc("en", "permissions/index.md");

    expect(page).toContain(
      "`BillingViewer` reads the project's billing — the plan and subscription, invoices, usage, balances, AI credits, payment methods and the billing contact details — and changes nothing.",
    );
    expect(page).toContain(
      "`BillingMember` also downloads invoices and changes the billing contact details.",
    );
    expect(page).toContain(
      "Changing the plan, payment methods or balances, and paying invoices, takes `ProjectOwner` or **Manage Billing**",
    );
  });

  test("no longer says a project admin keeps someone from seeing billing", () => {
    const page: string = readDoc("en", "permissions/index.md");

    expect(page).not.toContain("`ProjectAdmin` already excludes billing.");
    expect(page).toContain(
      "**Someone who should not change billing or see invoices.** Give them `ProjectMember`, not `ProjectAdmin`",
    );
  });

  test("the runbook pages no longer call the Runbook Member day-to-day usage", () => {
    for (const relative of [
      "runbooks/configuration.md",
      "runbooks/agents.md",
    ]) {
      const page: string = readDoc("en", relative);

      expect([relative, page.includes("day-to-day usage")]).toEqual([
        relative,
        false,
      ]);
      expect(page).toContain(
        "but creates, changes and deletes no runbook or Runner.",
      );
    }
  });

  test("the upgrade guide says what changed for the Runbook Member and the billing roles", () => {
    const page: string = readDoc("en", "installation/upgrading.md");

    expect(page).toContain(
      "- **Runbook Member runs runbooks and builds none.**",
    );
    expect(page).toContain("- **The billing roles do what they say.**");
    expect(page).toContain("- **The owners' emails follow team blocks.**");
    expect(page).toContain(
      "- **Every role's description says what the role does.**",
    );
  });
});

describe.each(LANGUAGES)("the %s docs", (lang: string) => {
  test("Users, Teams & Permissions has one paragraph on the workflow and runbook roles, linking both pages", () => {
    const paragraphs: Array<string> = paragraphsWith(
      readDoc(lang, "permissions/index.md"),
      "`RunbookMember`",
      "`RunbookAdmin`",
    );

    expect([lang, paragraphs.length]).toEqual([lang, 1]);
    expect(paragraphs[0]).toContain("`WorkflowMember`");
    expect(paragraphs[0]).toContain("/docs/workflows/configuration");
    expect(paragraphs[0]).toContain("/docs/runbooks/configuration");
  });

  test("Users, Teams & Permissions has one paragraph on the three billing roles and who changes the plan", () => {
    const paragraphs: Array<string> = paragraphsWith(
      readDoc(lang, "permissions/index.md"),
      ...PROJECT_BILLING_READ_ROLES.map((role: Permission): string => {
        return `\`${role}\``;
      }),
    );

    expect([lang, paragraphs.length]).toEqual([lang, 1]);
    expect(paragraphs[0]).toContain("`ProjectOwner`");
    expect(paragraphs[0]).toContain("**Manage Billing**");
  });

  test("the recipe for keeping someone out of billing gives them Project Member and points to Billing Viewer", () => {
    const recipes: Array<string> = paragraphsWith(
      readDoc(lang, "permissions/index.md"),
      "`ProjectMember`",
      "`ProjectAdmin`",
      "`BillingViewer`",
    ).filter((paragraph: string): boolean => {
      return paragraph.startsWith("**");
    });

    expect([lang, recipes.length]).toEqual([lang, 1]);
  });

  test("the runbook roles bullet names all three roles on both runbook pages", () => {
    for (const relative of [
      "runbooks/configuration.md",
      "runbooks/agents.md",
    ]) {
      const bullets: Array<string> = readDoc(lang, relative)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("- `RunbookAdmin`");
        });

      expect([lang, relative, bullets.length]).toEqual([lang, relative, 1]);
      expect(keysIn(bullets[0]!)).toEqual(
        expect.arrayContaining([
          "RunbookAdmin",
          "RunbookMember",
          "RunbookViewer",
        ]),
      );
    }
  });

  test("the runbook Configuration page says the run permissions reach every runbook, and the roles their scope", () => {
    const paragraphs: Array<string> = paragraphsWith(
      readDoc(lang, "runbooks/configuration.md"),
      "`CreateRunbookExecution`",
      "`EditRunbookExecution`",
      "`RunbookMember`",
    ).filter((paragraph: string): boolean => {
      return !paragraph.startsWith("- ");
    });

    expect([lang, paragraphs.length]).toEqual([lang, 1]);
  });

  test("the Agents page names exactly who may start a run, and who else may move one along", () => {
    const paragraphs: Array<string> = paragraphsWith(
      readDoc(lang, "runbooks/agents.md"),
      "`CreateRunbookExecution`",
      "`EditRunbookExecution`",
    ).filter((paragraph: string): boolean => {
      return !paragraph.startsWith("- ");
    });

    expect([lang, paragraphs.length]).toEqual([lang, 1]);
    expect([...new Set(keysIn(paragraphs[0]!))].sort()).toEqual(
      [...new Set([...RUNBOOK_ADVANCE_PERMISSIONS])].sort(),
    );
    expect(RUNBOOK_RUN_PERMISSIONS).not.toContain(
      Permission.EditRunbookExecution,
    );
  });
});
