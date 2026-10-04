import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE CREATE FORM FOR A TELEMETRY INGESTION KEY, BEHIND EVERY DOOR.
 *
 * A key is created from Settings > Telemetry Ingestion Keys and from the
 * "Choose an ingestion key" step of every setup guide. The two used to be
 * hand-copied forms that drifted apart: the guide's Key Type was a dropdown
 * with other help, its Allowed Origins skipped the origin checks the
 * Settings page ran (a bad origin was refused only by the server, after the
 * submit), and both made the user invent a name. Both now build their form
 * with Components/Telemetry/IngestionKeyForm - a name already filled in, the
 * type asked only where it is open, the rest under Advanced, the Free
 * plan's pricing as a step that has to be shown - and the rendered flows are
 * pinned in Common/Tests/App/Dashboard (TelemetryIngestionKeyForm,
 * IngestionKeySelectorCreate, IngestionKeyForm).
 *
 * What is pinned here, against the source (react does not resolve from
 * App's tests, so the pages cannot be imported): no door declares a key
 * field of its own, no third door appears, the builder keeps the pricing
 * gate, every guide names the keys it makes and says which type they are,
 * and a key made on Settings opens on its own page.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const FORM_FILE: string = "Components/Telemetry/IngestionKeyForm.ts";
const SETTINGS_PAGE: string = "Pages/Settings/TelemetryIngestionKeys.tsx";
const GUIDE_KEY_STEP: string = "Components/Telemetry/IngestionKeySelector.tsx";
const DOORS: Array<string> = [SETTINGS_PAGE, GUIDE_KEY_STEP];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

function collectSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

const SOURCES: Array<{ file: string; source: string }> = collectSourceFiles(
  DASHBOARD_SRC,
).map((file: string): { file: string; source: string } => {
  return { file: relative(file), source: fs.readFileSync(file, "utf8") };
});

/*
 * Every JSX use of a component, as the text from its tag to the end of the
 * tag (good enough for the attributes written on it).
 */
function findJsxUses(source: string, component: string): Array<string> {
  const uses: Array<string> = [];
  const opening: RegExp = new RegExp(`<${component}\\b`, "g");
  let match: RegExpExecArray | null = opening.exec(source);

  while (match) {
    let depth: number = 0;
    let end: number = match.index;

    // Up to the ">" that closes the tag, skipping "=>" and nested braces.
    for (let index: number = match.index; index < source.length; index++) {
      const character: string = source[index] as string;

      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      } else if (character === ">" && depth === 0) {
        end = index;
        break;
      }
    }

    uses.push(source.slice(match.index, end + 1));
    match = opening.exec(source);
  }

  return uses;
}

describe("Telemetry ingestion key create form", () => {
  test("the builder is where it is expected", () => {
    expect(fs.existsSync(path.join(DASHBOARD_SRC, FORM_FILE))).toBe(true);
  });

  describe.each(DOORS)("%s", (door: string) => {
    const source: string = read(door);

    test("takes its steps, fields and request from the shared form", () => {
      expect(source).toContain("getIngestionKeyFormSteps(");
      expect(source).toContain("getIngestionKeyFormFields(");
      expect(source).toContain("prepareIngestionKeyForCreate(");
      expect(source).toMatch(
        /from "(\.\.\/\.\.\/Components\/Telemetry|\.)\/IngestionKeyForm"/,
      );
    });

    test("declares no key field of its own", () => {
      /*
       * A form field needs a FormFieldSchemaType and a step; the table's
       * columns and filters, which stay on the page, need neither. Each of
       * these in a door is a second copy of the form starting to drift.
       */
      for (const marker of [
        "FormFieldSchemaType",
        "stepId:",
        "cardSelectOptions",
        "customValidation",
        "OriginAllowList",
        "getTelemetryPayAsYouGoFormFields",
        "formSummary",
        '"Ingestion Key Name"',
      ]) {
        expect({ door, marker, found: source.includes(marker) }).toEqual({
          door,
          marker,
          found: false,
        });
      }
    });
  });

  test("no third door: every create form for a key is one of the two, built by the shared form", () => {
    const creatingFiles: Array<string> = SOURCES.filter(
      (entry: { file: string; source: string }): boolean => {
        const source: string = entry.source;

        return (
          source.includes("<ModelFormModal<TelemetryIngestionKey>") ||
          (source.includes("<ModelForm<TelemetryIngestionKey>") &&
            source.includes("FormType.Create")) ||
          (source.includes("<ModelTable<TelemetryIngestionKey>") &&
            source.includes("isCreateable={true}"))
        );
      },
    ).map((entry: { file: string; source: string }): string => {
      return entry.file;
    });

    expect(creatingFiles.sort()).toEqual([...DOORS].sort());
  });

  test("the shared form keeps the Free plan's pricing as a step that has to be shown", () => {
    const source: string = read(FORM_FILE);

    // Decides both the Billing step and its notice field.
    expect(
      (source.match(/getTelemetryPayAsYouGoFormFields\(\)/g) || []).length,
    ).toBe(2);
    expect(source).toContain('{ id: "billing", title: "Billing" }');
    expect(source).toContain('return { ...field, stepId: "billing" };');
    /*
     * Billing is the last step, and a stepped form offers Create on its last
     * step only (SteppedFormFooter), so the notice is read before a key is
     * made.
     */
    expect(source).toMatch(
      /\.\.\.\(hasBillingStep \? \[\{ id: "billing", title: "Billing" \}\] : \[\]\),\s*\];/,
    );
  });

  test("the shared form has no Summary step and folds the description under Advanced", () => {
    const source: string = read(FORM_FILE);

    expect(source).not.toMatch(/isSummaryStep|title: "Summary"|formSummary/);
    expect(source).toContain("getAdvancedFormSection<TelemetryIngestionKey>()");
    expect(source).toMatch(
      /field: \{\s*description: true,\s*\},[\s\S]*?collapsibleSection: advanced,/,
    );
  });

  test("a key made on Settings opens on its own page, where its secret is", () => {
    const source: string = read(SETTINGS_PAGE);

    expect(source).toContain("onCreateSuccess=");
    expect(source).toContain("PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW");
    expect(source).toContain("Navigation.navigate(getIngestionKeyRoute(item))");
  });

  describe("every guide", () => {
    test("names the keys it makes after what it is for", () => {
      const cards: Array<{ file: string; use: string }> = SOURCES.flatMap(
        (entry: { file: string; source: string }) => {
          return findJsxUses(entry.source, "SetupGuideCard").map(
            (use: string) => {
              return { file: entry.file, use };
            },
          );
        },
      );

      // Every product's setup guide: a broken walk must not pass empty.
      expect(cards.length).toBeGreaterThanOrEqual(14);

      for (const card of cards) {
        const name: RegExpMatchArray | null = card.use.match(
          /newKeyName=\{translationKey\("([^"]+)"\)\}/,
        );

        expect({ file: card.file, names: Boolean(name) }).toEqual({
          file: card.file,
          names: true,
        });
        // "Kubernetes key": the product, then "key".
        expect(name?.[1]).toMatch(/^[A-Z][A-Za-z ]* key$/);
      }

      // No two products name their keys the same.
      const names: Array<string> = cards.map(
        (card: { file: string; use: string }): string => {
          return (card.use.match(
            /newKeyName=\{translationKey\("([^"]+)"\)\}/,
          ) || [])[1] as string;
        },
      );
      expect(new Set(names).size).toBe(names.length);
    });

    test("says which type of key its snippet works with", () => {
      const steps: Array<{ file: string; use: string }> = SOURCES.flatMap(
        (entry: { file: string; source: string }) => {
          return findJsxUses(entry.source, "IngestionKeySelector").map(
            (use: string) => {
              return { file: entry.file, use };
            },
          );
        },
      );

      expect(
        steps
          .map((step: { file: string; use: string }): string => {
            return step.file;
          })
          .sort(),
      ).toEqual(
        [
          "Components/SecurityEvents/SecurityEventsSetupGuide.tsx",
          "Components/SetupGuide/SetupGuideCard.tsx",
          "Components/Telemetry/Documentation.tsx",
        ].sort(),
      );

      for (const step of steps) {
        expect({
          file: step.file,
          keyType: step.use.includes("keyTypeFilter={"),
          name: step.use.includes("newKeyName={"),
        }).toEqual({ file: step.file, keyType: true, name: true });
      }
    });

    test("an agent's guide makes Server keys unless it says otherwise", () => {
      const card: string = read("Components/SetupGuide/SetupGuideCard.tsx");

      expect(card).toContain(
        "props.getKeyTypeFilter?.(option) || TelemetryIngestionKeyType.Server",
      );
      expect(
        read("Components/SecurityEvents/SecurityEventsSetupGuide.tsx"),
      ).toContain("keyTypeFilter={TelemetryIngestionKeyType.Server}");
      expect(read("Components/Telemetry/Documentation.tsx")).toMatch(
        /isBrowserSdkGuide\s*\?\s*TelemetryIngestionKeyType\.Browser\s*:\s*TelemetryIngestionKeyType\.Server/,
      );
    });
  });
});
