import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Labels no longer have a wizard step of their own on any form: the shared
 * Labels field folds under Advanced at the end of the step that holds the
 * record's name (Dashboard Utils/Form/LabelsFormField.ts). The docs walk
 * some of those wizards step by step - the SLO create wizard, the incident
 * template wizard, Create Queue - and markdown is not compiled, so nothing
 * else notices when a page keeps sending readers to a Labels step that is
 * gone. The English pages and their Persian translations (the corpus kept in
 * step with them) are held to the forms here; the forms are read from
 * source, since an App test must not import a React page.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");

const CONTENT_DIR: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Docs",
  "Content",
);

const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function readSource(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\s+/g, " ");
}

// The lines of a markdown section: from its heading to the next of its level or higher.
function sectionOf(markdown: string, heading: RegExp): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return heading.test(line);
  });

  expect({ heading: String(heading), found: start >= 0 }).toEqual({
    heading: String(heading),
    found: true,
  });

  const level: number = (lines[start]!.match(/^#+/)?.[0] || "").length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const hashes: string = lines[index]!.match(/^#+ /)?.[0].trim() || "";

    if (hashes.length > 0 && hashes.length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

// The step tables and lists, as each language counts them.
const SLO_STEP_COUNT: Record<string, string> = {
  en: "Work through the three steps:",
  fa: "سه گام را پیش ببرید:",
};

const TEMPLATE_WIZARD: Record<string, string> = {
  en: "four-step wizard",
  fa: "جادوگری چهارگامی",
};

const DECLARING_TEMPLATE_WIZARD: Record<string, string> = {
  en: "four-step wizard",
  fa: "جادوگر چهارگامی",
};

describe("the forms whose Labels step folded under Advanced", () => {
  test("have no Labels step in source", () => {
    const sloFields: string = readSource("Pages/Slo/SloFormFields.ts");
    const templates: string = readSource(
      "Pages/Incidents/Settings/IncidentTemplates.tsx",
    );
    const queues: string = readSource("Pages/MessageQueue/MessageQueues.tsx");

    for (const source of [sloFields, templates, queues]) {
      expect(source).not.toContain('id: "labels"');
      expect(source).toContain("getLabelsFormField<");
    }

    // The template's owners folded beside its labels.
    expect(templates).not.toContain('id: "owners"');
  });
});

describe.each(LANGUAGES)("the %s docs", (language: string) => {
  test("walk the SLO wizard's three steps, with the labels under Advanced on Basic Info", () => {
    const page: string = read(language, "slo/introduction");

    expect(page).toContain(SLO_STEP_COUNT[language]!);
    // No row of the steps table for a Labels step.
    expect(page).not.toMatch(/^\| \*\*Labels\*\* +\|/m);

    const basicInfo: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| **Basic Info** |");
      });

    expect(basicInfo).toBeDefined();
    expect(basicInfo).toContain("**Advanced**");
  });

  test("walk the incident template wizard's four steps, with owners and labels under Advanced", () => {
    const settings: string = read(language, "incidents/settings");
    const declaring: string = read(language, "incidents/declaring-incidents");

    expect(settings).toContain(TEMPLATE_WIZARD[language]!);
    expect(settings).not.toMatch(/^- \*\*Labels\*\* — \*\*Labels\*\*/m);
    expect(settings).toMatch(/^ {2}- \*\*Labels\*\* — /m);

    expect(declaring).toContain(DECLARING_TEMPLATE_WIZARD[language]!);
    expect(declaring).not.toContain("**Owners**، **Labels** —");
    expect(declaring).not.toContain("**Owners**, **Labels** —");
  });

  test("say what labels do on Declare Incident in the words the form uses", () => {
    const declaring: string = read(language, "incidents/declaring-incidents");
    const byHand: string = sectionOf(
      declaring,
      language === "en" ? /^## Declaring one by hand$/ : /^## اعلام دستی$/,
    );
    const labels: string | undefined = byHand
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **Labels** — ");
      });

    expect(labels).toBeDefined();
    // The old help, which said only who could reach the incident.
    expect(labels).not.toContain("team members with access to these labels");
    expect(labels).not.toContain("اعضای تیمی که به این برچسب‌ها دسترسی دارند");
  });
});

test("the queue docs put the labels under Advanced on Queue Info", () => {
  const page: string = read("en", "telemetry/queues");

  expect(page).toContain(
    "then for an optional name and description, with labels under **Advanced** (**Queue Info**)",
  );
  expect(page).not.toContain("and labels (**Labels**)");
});
