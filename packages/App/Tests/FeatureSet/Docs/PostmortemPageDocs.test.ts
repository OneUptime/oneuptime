import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against the incident Postmortem page they describe.
 *
 * Apply Template is offered only once the project has a postmortem
 * template, and a template (or an AI draft) changes the note and nothing
 * else. The Edit form asks Publish on Status Page first, and Notify
 * Subscribers and Postmortem Published At only while it is on. The English
 * and Persian pages say so, every language's settings page says when Apply
 * Template appears, and the labels they quote are the ones the page draws.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DASHBOARD_SRC: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src",
);

// The path the old dialog gave: postmortem templates are not in Project Settings.
const WRONG_POSTMORTEM_TEMPLATES_PATH: RegExp =
  /Project Settings\s*(?:>|→)\s*Incident/;

function readDoc(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

const LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return (
      entry.isDirectory() &&
      fs.existsSync(path.join(CONTENT_DIR, entry.name, "incidents/settings.md"))
    );
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  });

// The label of the button or field each docs label names, as the source draws it.
const PAGE_SOURCES: Array<string> = [
  readSource("Pages/Incidents/View/Postmortem.tsx"),
  readSource("Components/Postmortem/IncidentPostmortemForm.ts"),
  readSource("Components/Postmortem/PostmortemCardButtons.ts"),
  readSource("Components/Postmortem/ApplyPostmortemTemplateModal.tsx"),
];

function isDrawnLabel(label: string): boolean {
  return PAGE_SOURCES.some((source: string): boolean => {
    return source.includes(`"${label}"`);
  });
}

describe("the Postmortem page's docs", () => {
  test("are written in every language that has incident settings", () => {
    expect(LANGUAGES).toEqual(expect.arrayContaining(["en", "fa", "de"]));
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test("the English settings page says when Apply Template appears and what it keeps", () => {
    const settings: string = readDoc("en", "incidents/settings.md");

    expect(settings).toContain(
      "**Apply Template** is shown only once the project has a postmortem template; with just one, it is already picked.",
    );
    expect(settings).toContain(
      "so whether it is on the status page, when it was published and its attachments stay as they were.",
    );
    expect(settings).toContain(
      "**Incidents → Settings → Postmortem Templates**",
    );
    expect(settings).not.toMatch(WRONG_POSTMORTEM_TEMPLATES_PATH);
  });

  /*
   * Each language's paragraph that applies a template names Apply Template
   * by its own label: once where it says to use it, and again in the
   * sentence that says it appears only once there is a template.
   */
  const APPLY_TEMPLATE_LABELS: Record<string, string> = {
    en: "**Apply Template**",
    fa: "**Apply Template**",
    de: "**Vorlage anwenden**",
    da: "**Anvend skabelon**",
    es: "**Aplicar plantilla**",
    fr: "**Appliquer le modèle**",
    hi: "**टेम्पलेट लागू करें**",
    it: "**Applica modello**",
    ja: "**テンプレートを適用**",
    ko: "**템플릿 적용**",
    pt: "**Aplicar modelo**",
    ru: "**Применить шаблон**",
    sv: "**Tillämpa mall**",
    "zh-CN": "**应用模板**",
    "zh-TW": "**套用範本**",
    no: "**Bruk mal**",
    nl: "**Sjabloon toepassen**",
  };

  test("every language has its Apply Template label listed here", () => {
    expect(Object.keys(APPLY_TEMPLATE_LABELS).sort()).toEqual(
      [...LANGUAGES].sort(),
    );
  });

  test.each(LANGUAGES)(
    "the %s settings page says when Apply Template appears",
    (language: string) => {
      const settings: string = readDoc(language, "incidents/settings.md");

      const applyParagraph: string | undefined = settings
        .split("\n")
        .find((line: string): boolean => {
          return line.includes(
            "/dashboard/{projectId}/incidents/{incidentId}/postmortem",
          );
        });

      expect(applyParagraph).toBeDefined();

      const label: string = APPLY_TEMPLATE_LABELS[language]!;

      expect(applyParagraph!.split(label).length - 1).toBe(2);
      expect(settings).not.toMatch(WRONG_POSTMORTEM_TEMPLATES_PATH);
    },
  );

  test("the English incident page names the publish options in the order the form asks them", () => {
    const index: string = readDoc("en", "incidents/index.md");
    const bullet: string = index.split("\n").find((line: string): boolean => {
      return line.startsWith("- **Postmortem** —");
    })!;

    expect(bullet).toBeDefined();

    const order: Array<number> = [
      "**Edit Postmortem Note**",
      "**Publish on Status Page**",
      "**Notify Subscribers**",
      "**Postmortem Published At**",
    ].map((label: string): number => {
      return bullet.indexOf(label);
    });

    expect(
      order.every((position: number): boolean => {
        return position > -1;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
    expect(bullet).toContain("only while that is on");
    expect(bullet).toContain(
      "**Apply Template** — shown once the project has a postmortem template",
    );
  });

  test("the Persian incident page says the same", () => {
    const index: string = readDoc("fa", "incidents/index.md");
    const bullet: string = index.split("\n").find((line: string): boolean => {
      return line.startsWith("- **Postmortem** —");
    })!;

    for (const label of [
      "**Edit Postmortem Note**",
      "**Publish on Status Page**",
      "**Notify Subscribers**",
      "**Postmortem Published At**",
      "**Generate with AI**",
      "**Apply Template**",
    ]) {
      expect(bullet).toContain(label);
    }
  });

  test.each([
    "Apply Template",
    "Apply Postmortem Template",
    "Select Template",
    "Generate with AI",
    "Edit Postmortem Note",
    "Publish on Status Page",
    "Notify Subscribers",
    "Postmortem Published At",
    "Postmortem Note",
  ])("quotes %s as the page draws it", (label: string) => {
    expect(isDrawnLabel(label)).toBe(true);

    const english: string =
      readDoc("en", "incidents/settings.md") +
      readDoc("en", "incidents/index.md");

    expect(english).toContain(`**${label}**`);
  });
});
