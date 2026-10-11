import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { drawnDashboardLabel } from "./DocsDashboardLabels";

/*
 * Labels no longer have a wizard step of their own on any form: the shared
 * Labels field folds under More fields at the end of the step that holds the
 * record's name (Dashboard Utils/Form/LabelsFormField.ts). The docs walk
 * some of those forms field by field - SLO create (one page since its steps
 * went), the incident template wizard, Create Queue - and markdown is not
 * compiled, so nothing
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

/*
 * What the SLO page introduces the table of the form's folded fields with -
 * the fields under More fields, labels among them. Both pages name the
 * Dashboard as their language's Dashboard draws it.
 */
const SLO_MORE_FIELDS_TABLE: Record<string, string> = {
  en: `The fields under **${drawnDashboardLabel("en", "More fields")}**:`,
  fa: `فیلدهای زیر **${drawnDashboardLabel("fa", "More fields")}**:`,
};

// What the SLO form's three steps used to be introduced with.
const SLO_OLD_STEP_COUNT: Record<string, string> = {
  en: "Work through the three steps:",
  fa: "سه گام را پیش ببرید:",
};

// The table that follows a lead line: its rows, up to the first line that is not one.
function tableAfter(markdown: string, lead: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(lead);

  expect({ lead, found: start >= 0 }).toEqual({ lead, found: true });

  const rows: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (line === "" && rows.length === 0) {
      continue;
    }

    if (!line.startsWith("|")) {
      break;
    }

    rows.push(line);
  }

  return rows;
}

// The headings of the steps in a page's first :::steps block.
function firstStepHeadings(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(":::steps");

  expect(start).toBeGreaterThan(-1);

  const headings: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (line === ":::") {
      break;
    }

    if (/^#{3,4} /.test(line)) {
      headings.push(line.replace(/^#+ /, ""));
    }
  }

  return headings;
}

const TEMPLATE_WIZARD: Record<string, string> = {
  en: "four-step wizard",
  fa: "جادوگری چهارگامی",
};

const DECLARING_TEMPLATE_WIZARD: Record<string, string> = {
  en: "four-step wizard",
  fa: "جادوگر چهارگامی",
};

describe("the forms whose Labels step folded under More fields", () => {
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
  test("describe the one-page SLO form, with the labels under More fields", () => {
    const page: string = read(language, "slo/introduction");

    const labels: string = drawnDashboardLabel(language, "Labels");
    const labelsRow: RegExp = new RegExp(`^\\| \\*\\*${labels}\\*\\* +\\|`);

    expect(page).not.toContain(SLO_OLD_STEP_COUNT[language]!);
    // No row for the steps the form had.
    expect(page).not.toMatch(/^\| \*\*Basic Info\*\* +\|/m);
    expect(page).not.toMatch(/^\| \*\*Period\*\* +\|/m);

    // The create steps never stop on a step of their own for the labels...
    for (const heading of firstStepHeadings(page)) {
      expect({ heading, namesLabels: heading.includes(labels) }).toEqual({
        heading,
        namesLabels: false,
      });
    }

    // ...which are one of the fields folded under More fields, and a row nowhere else.
    const moreFields: Array<string> = tableAfter(
      page,
      SLO_MORE_FIELDS_TABLE[language]!,
    );

    expect(
      moreFields.filter((row: string): boolean => {
        return labelsRow.test(row);
      }),
    ).toHaveLength(1);
    expect(
      page.split("\n").filter((line: string): boolean => {
        return labelsRow.test(line);
      }),
    ).toHaveLength(1);
  });

  test("walk the incident template wizard's four steps, with owners and labels under More fields", () => {
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

test("the queue docs put the labels under More fields on Queue Info", () => {
  const page: string = read("en", "telemetry/queues");

  expect(page).toContain(
    "then for an optional name and description, with labels under **More fields** (**Queue Info**)",
  );
  expect(page).not.toContain("and labels (**Labels**)");
});
