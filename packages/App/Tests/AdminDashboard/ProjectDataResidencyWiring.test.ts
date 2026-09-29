import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Admin Dashboard's Project page is where a master admin sets a project's
 * data residency. Everything that connects the card to Project.dataResidency
 * is hand-written and fails silently:
 *
 *  - the field names in the form and detail descriptors are plain object
 *    literals, so a misspelling compiles, renders an empty row and 400s on
 *    save;
 *  - reading through the tenant-scoped ModelAPI instead of AdminModelAPI
 *    would scope the request to a project the staff user belongs to, not the
 *    project being viewed;
 *  - the card is SaaS-only, and the server refuses a residency when billing is
 *    off, so offering it on a self-hosted install would be a form that always
 *    fails;
 *  - and a locale missing a key renders the raw key to staff.
 *
 * The admin dashboard has no React render harness (App's jest environment is
 * "node" and the package carries no react/testing-library), so this asserts
 * the wiring the way the sibling AdminDashboard suites do: against the source
 * text and the locale files.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

const COMMON_SRC: string = nodePath.join(__dirname, "../../../Common");

/*
 * Comments are stripped before any assertion so that prose explaining a
 * pattern cannot satisfy an assertion about the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const projectViewSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(ADMIN_DASHBOARD_SRC, "Pages/Projects/View/Index.tsx"),
    "utf8",
  ),
);

/* Not comment-stripped: the assertions below are about decorator metadata. */
const projectModelSource: string = fs.readFileSync(
  nodePath.join(COMMON_SRC, "Models/DatabaseModels/Project.ts"),
  "utf8",
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

function localeFileNames(): Array<string> {
  return fs.readdirSync(LOCALES_DIR).filter((file: string) => {
    return file.endsWith(".json");
  });
}

function readLocale(fileName: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

/*
 * The data residency card, from its opening tag to the end of the page's
 * content. Scoping assertions to it keeps the existing "Project" card - which
 * also uses AdminModelAPI, isEditable and FieldType.Text - from satisfying
 * them.
 */
const dataResidencyCard: string =
  projectViewSource.split('name="Project Data Residency"')[1] || "";

/* The existing name card, which must be left exactly as it was. */
const nameCard: string =
  projectViewSource.split('name="Project Data Residency"')[0] || "";

describe("Project > Data Residency card", () => {
  test("the card is where this test thinks it is", () => {
    // Guards the guard: a renamed card must fail loudly, not vacuously.
    expect(dataResidencyCard.trim()).not.toBe("");
    expect(dataResidencyCard).toContain(
      'id: "model-detail-project-data-residency"',
    );
  });

  test("the card edits the column the Project model actually declares", () => {
    expect(projectModelSource).toContain("public dataResidency?: string");
    expect(dataResidencyCard).toContain("dataResidency: true");
  });

  test("the column is both in the edit form and in the detail rows", () => {
    const formFields: string =
      dataResidencyCard
        .split("formFields={[")[1]
        ?.split("modelDetailProps")[0] || "";
    const detailFields: string =
      dataResidencyCard.split("modelDetailProps={{")[1] || "";

    expect(formFields).toContain("dataResidency: true");
    expect(detailFields).toContain("dataResidency: true");
  });

  test("it is a plain text field, as the feature asks", () => {
    expect(dataResidencyCard).toContain("FormFieldSchemaType.Text");
    expect(dataResidencyCard).toContain("FieldType.Text");
  });

  test("it is editable", () => {
    expect(dataResidencyCard).toContain("isEditable={true}");
  });

  /*
   * Clearing the field is how an admin removes a residency, so it cannot be
   * required - a required field would make "unset" unreachable from the UI.
   */
  test("it is optional, so an admin can clear it", () => {
    const formFields: string =
      dataResidencyCard
        .split("formFields={[")[1]
        ?.split("modelDetailProps")[0] || "";

    expect(formFields).toContain("required: false");
    expect(formFields).not.toContain("required: true");
  });

  test("the form caps the length at the column's width, via the shared constant", () => {
    expect(dataResidencyCard).toContain(
      "maxLength: DataResidencyUtil.MAX_LENGTH",
    );
    expect(projectViewSource).toContain(
      'import DataResidencyUtil from "Common/Utils/Project/DataResidency"',
    );
  });

  test("an unset residency reads as 'not set' rather than a blank row", () => {
    expect(dataResidencyCard).toContain(
      'placeholder: t("pages.projectView.dataResidencyNotSet")',
    );
  });

  test("the card reads and writes through the admin API", () => {
    expect(dataResidencyCard).toContain("modelAPI={AdminModelAPI}");
    expect(projectViewSource).toMatch(
      /import AdminModelAPI from "\.\.\/\.\.\/\.\.\/Utils\/ModelAPI"/,
    );
  });

  test("the card targets the project being viewed", () => {
    const detailFields: string =
      dataResidencyCard.split("modelDetailProps={{")[1] || "";

    expect(detailFields).toContain("modelId: modelId");
    expect(detailFields).toContain("modelType: Project");
  });

  test("its detail card id does not collide with the name card's", () => {
    const ids: Array<string> = [
      ...projectViewSource.matchAll(/id: "([^"]+)"/g),
    ].map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(ids).toContain("model-detail-project-data-residency");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the existing Project card", () => {
  test("still edits only the project name", () => {
    expect(nameCard).toContain('name="Project"');
    expect(nameCard).toContain("name: true");
    expect(nameCard).not.toContain("dataResidency");
  });
});

describe("SaaS gating", () => {
  test("the card only renders when billing is enabled", () => {
    const gateIndex: number = projectViewSource.indexOf("{BILLING_ENABLED ? (");
    const cardIndex: number = projectViewSource.indexOf(
      'name="Project Data Residency"',
    );

    expect(gateIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(cardIndex);

    // ...and nothing else opens between the gate and the card.
    expect(projectViewSource.slice(gateIndex, cardIndex)).toMatch(
      /^\{BILLING_ENABLED \? \(\s*<CardModelDetail<Project>\s*$/,
    );
  });

  test("the disabled branch renders nothing", () => {
    expect(dataResidencyCard).toMatch(/\)\s*:\s*\(\s*<><\/>\s*\)\s*\}/);
  });

  test("BILLING_ENABLED comes from the UI config", () => {
    expect(projectViewSource).toContain(
      'import { BILLING_ENABLED } from "Common/UI/Config"',
    );
  });

  test("the name card is not gated, so self-hosted admins can still rename projects", () => {
    const gateIndex: number = projectViewSource.indexOf("{BILLING_ENABLED ? (");
    const nameCardIndex: number = projectViewSource.indexOf('name="Project"');

    expect(nameCardIndex).toBeGreaterThan(-1);
    expect(nameCardIndex).toBeLessThan(gateIndex);
  });
});

describe("translations", () => {
  const usedKeys: Array<string> = Array.from(
    new Set(
      [
        ...dataResidencyCard.matchAll(
          /t\(\s*["']pages\.projectView\.([A-Za-z0-9_]+)["']/g,
        ),
      ].map((match: RegExpMatchArray) => {
        return match[1]!;
      }),
    ),
  );

  test("the card actually asks for the keys this block checks", () => {
    // Guards the guard: a typo'd regex above would otherwise assert nothing.
    expect(usedKeys.sort()).toEqual(
      [
        "dataResidencyCardDescription",
        "dataResidencyCardTitle",
        "dataResidencyEditButton",
        "dataResidencyFieldDescription",
        "dataResidencyFieldPlaceholder",
        "dataResidencyFieldTitle",
        "dataResidencyNotSet",
      ].sort(),
    );
  });

  test("there is a locale file for every language the dashboard ships", () => {
    expect(localeFileNames().length).toBeGreaterThanOrEqual(17);
    expect(localeFileNames()).toContain("en.json");
  });

  test.each(localeFileNames())(
    "%s defines every pages.projectView key the card asks for",
    (fileName: string) => {
      const block: Record<string, string> =
        readLocale(fileName)["pages"]?.["projectView"] || {};

      const missing: Array<string> = usedKeys.filter((key: string) => {
        return typeof block[key] !== "string" || block[key]!.trim() === "";
      });

      expect(missing).toEqual([]);
    },
  );

  test("every locale carries the same pages.projectView keys as English, in the same order", () => {
    const englishKeys: Array<string> = Object.keys(
      readLocale("en.json")["pages"]["projectView"],
    );

    const mismatched: Array<string> = [];

    for (const fileName of localeFileNames()) {
      const keys: Array<string> = Object.keys(
        readLocale(fileName)["pages"]?.["projectView"] || {},
      );

      if (JSON.stringify(keys) !== JSON.stringify(englishKeys)) {
        mismatched.push(fileName);
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("the existing projectView keys are still there", () => {
    for (const fileName of localeFileNames()) {
      const block: Record<string, string> =
        readLocale(fileName)["pages"]["projectView"];

      for (const key of [
        "title",
        "cardTitle",
        "cardDescription",
        "editButton",
      ]) {
        expect(typeof block[key]).toBe("string");
      }
    }
  });

  /*
   * The non-English locales were written for this change rather than copied
   * from English, and a key left in English is the easy thing to miss.
   */
  test("the translated locales do not just repeat the English card title", () => {
    const english: string =
      readLocale("en.json")["pages"]["projectView"]["dataResidencyCardTitle"];

    const untranslated: Array<string> = localeFileNames()
      .filter((fileName: string) => {
        return fileName !== "en.json";
      })
      .filter((fileName: string) => {
        return (
          readLocale(fileName)["pages"]["projectView"][
            "dataResidencyCardTitle"
          ] === english
        );
      });

    expect(untranslated).toEqual([]);
  });

  test("no data residency string smuggles in an interpolation the card never fills", () => {
    const offenders: Array<string> = [];
    const interpolation: RegExp = new RegExp("\\{\\{[^}]+\\}\\}");

    for (const fileName of localeFileNames()) {
      const block: Record<string, string> =
        readLocale(fileName)["pages"]?.["projectView"] || {};

      for (const key of usedKeys) {
        if (interpolation.test(block[key] || "")) {
          offenders.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
