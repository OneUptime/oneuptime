import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Swedish says larm for an alert, and varning only for a warning: the
 * Dashboard does (Locales/sv.json: Larm, Skapa larm, Kritiskt larm), and so
 * do the docs that quote it. The two words were mixed on both, "Varningar" in
 * the menu beside "larm" in the pages (#5134, #5239).
 *
 * The docs are checked three ways:
 *   - a page whose lines line up with the English page: no line says varning
 *     where its English line names an alert and no warning;
 *   - every page, the upgrade guide included (its lines do not line up):
 *     an incident is never paired with a varning, the way the pages name the
 *     two things OneUptime opens;
 *   - the docs navigation names the Alerts section Larm.
 */

const DOCS: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT: string = path.join(DOCS, "Content");

const VARNING: RegExp = /varning/i;
const ALERT: RegExp = /\balerts?\b/i;
const WARN: RegExp = /warn/i;

/*
 * "incident, varning", "incidenter och varningar", "incident eller en
 * varning", "incident- eller varningsepisod": an incident named beside a
 * varning is OneUptime's alert, not a warning.
 */
const INCIDENT_BESIDE_VARNING: RegExp =
  /incident(?:er|en|erna)?-?(?:,| och| eller)(?: en| ett)? varning/i;

function swedishPages(): Array<string> {
  const pages: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(
          path
            .relative(path.join(CONTENT, "sv"), full)
            .split(path.sep)
            .join("/"),
        );
      }
    }
  };

  walk(path.join(CONTENT, "sv"));

  return pages.sort();
}

function linesOf(language: string, page: string): Array<string> {
  return fs
    .readFileSync(path.join(CONTENT, language, ...page.split("/")), "utf8")
    .split("\n");
}

const PAGES: Array<string> = swedishPages();

describe("Swedish docs say larm for an alert", () => {
  test("there are Swedish pages to read", () => {
    expect(PAGES.length).toBeGreaterThan(100);
    expect(PAGES).toContain("installation/upgrading.md");
    expect(PAGES).toContain("alerts/index.md");
  });

  test("a line that lines up with an English line about an alert never says varning", () => {
    const mixed: Array<string> = [];
    let checkedLines: number = 0;

    for (const page of PAGES) {
      if (!fs.existsSync(path.join(CONTENT, "en", ...page.split("/")))) {
        continue;
      }

      const swedish: Array<string> = linesOf("sv", page);
      const english: Array<string> = linesOf("en", page);

      if (swedish.length !== english.length) {
        continue;
      }

      for (let index: number = 0; index < swedish.length; index++) {
        const englishLine: string = english[index] as string;

        if (ALERT.test(englishLine) && !WARN.test(englishLine)) {
          checkedLines++;

          if (VARNING.test(swedish[index] as string)) {
            mixed.push(`${page}:${index + 1}`);
          }
        }
      }
    }

    // Diagrams included: a Mermaid label is a line like any other.
    expect(checkedLines).toBeGreaterThan(1000);
    expect(mixed).toEqual([]);
  });

  test("no page pairs an incident with a varning, the upgrade guide included", () => {
    const paired: Array<string> = [];

    for (const page of PAGES) {
      linesOf("sv", page).forEach((line: string, index: number): void => {
        if (INCIDENT_BESIDE_VARNING.test(line)) {
          paired.push(`${page}:${index + 1}`);
        }
      });
    }

    expect(paired).toEqual([]);
  });

  test("the pattern above catches the ways the pages used to say it", () => {
    for (const old of [
      "Övervakningar, incidenter, varningar",
      "incidenter och varningar",
      "En incident, varning eller episod",
      "En incident- eller varningsepisod",
      'incident["Incident eller varning"]',
      "Att uppdatera en incident eller en varning",
    ]) {
      expect({ old, caught: INCIDENT_BESIDE_VARNING.test(old) }).toEqual({
        old,
        caught: true,
      });
    }

    for (const now of [
      "incidenter och larm",
      "En incident, ett larm eller en episod",
      "En incident- eller larmepisod",
      // A warning stays a varning.
      "en loggad varning som säger åt dig att skapa en riktig Runner",
    ]) {
      expect({ now, caught: INCIDENT_BESIDE_VARNING.test(now) }).toEqual({
        now,
        caught: false,
      });
    }
  });

  test("the upgrade guide's section on fixing new incidents and alerts is linked by its Swedish heading", () => {
    const guide: string = linesOf("sv", "installation/upgrading.md").join("\n");

    expect(guide).toContain(
      "### Att åtgärda nya incidenter och larm har en egen växel",
    );
    expect(guide).toContain(
      "(#att-åtgärda-nya-incidenter-och-larm-har-en-egen-växel)",
    );
    expect(guide).not.toContain("incidenter-och-varningar");
  });

  test("the docs navigation names the Alerts section Larm", () => {
    const locale: {
      navGroups?: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(path.join(DOCS, "Locales", "sv.json"), "utf8"),
    ) as { navGroups?: Record<string, string> };

    expect(locale.navGroups?.["Alerts"]).toBe("Larm");
  });
});
