// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import {
  MeaningKeyBindings,
  MeaningKeyFallbackFinding,
  SourceText,
  findMeaningKeyFallbacks,
  findMeaningKeyFallbacksIn,
  formatMeaningKeyFallbackFindings,
  listMeaningKeyScanFiles,
  readMeaningKeyBindings,
} from "../MeaningKeyFallbacks";

/*
 * NO PAGE WRITES A MEANING KEY'S ENGLISH BY HAND (#8180).
 *
 * A key that names its meaning - "Open (status)", "Created (import
 * result)" - reads as its word, "Open" or "Created", wherever the reader's
 * language has no wording of its own: the translator knows the keys
 * (Common/Types/MeaningKeys). Data Security's issue status and the
 * imports' Created were written before it did, and each wrote that English
 * by hand: a hasTranslation check, a constant holding "Created", a lookup
 * falling back to it, and a filter's options translated up front only to
 * get the English right. This finds any such fallback in the front ends
 * and in Common, so the next page looks the key up as any key.
 */

const FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Example/Example.tsx";

function findingsIn(
  text: string,
  others: ReadonlyArray<SourceText> = [],
): Array<MeaningKeyFallbackFinding> {
  const source: SourceText = { file: FILE, text };
  const bindings: MeaningKeyBindings = readMeaningKeyBindings([
    source,
    ...others,
  ]);

  return findMeaningKeyFallbacks(source, bindings);
}

function kindsIn(
  text: string,
  others?: ReadonlyArray<SourceText>,
): Array<string> {
  return findingsIn(text, others).map(
    (finding: MeaningKeyFallbackFinding): string => {
      return `${finding.kind} ${finding.key}`;
    },
  );
}

// How Data Security's pills wrote "Open" by hand before #8180.
const DATA_SECURITY_PILLS_BEFORE: string = `
  import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
  export const OPEN_STATUS_TERM: string = translationKey("Open (status)");
  export function getIssueStatusLabel(translator: Translator, status: string): string {
    if (status === "Open") {
      return translator.hasTranslation(OPEN_STATUS_TERM)
        ? translator.translateText(OPEN_STATUS_TERM) || status
        : status;
    }
    return translator.translateText(status) || status;
  }
`;

// How the imports wrote "Created" by hand before #8180.
const IMPORT_RESULT_WORDS_BEFORE: string = `
  import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
  export const CREATED_IMPORT_RESULT: string = translationKey(
    "Created (import result)",
  );
  export const CREATED_IMPORT_RESULT_IN_ENGLISH: string = "Created";
  export function getCreatedImportResultLabel(translator: Translator): string {
    if (!translator.hasTranslation(CREATED_IMPORT_RESULT)) {
      return CREATED_IMPORT_RESULT_IN_ENGLISH;
    }
    return (
      translator.translateText(CREATED_IMPORT_RESULT) ||
      CREATED_IMPORT_RESULT_IN_ENGLISH
    );
  }
`;

describe("the reader of hand-written fallbacks", () => {
  test("finds Data Security's Open, as its pills wrote it before #8180", () => {
    expect(kindsIn(DATA_SECURITY_PILLS_BEFORE)).toEqual([
      "asks-for-a-wording Open (status)",
    ]);
  });

  test("finds the imports' Created, as ImportResultWords wrote it before #8180: the check, the word kept and the fallback", () => {
    expect(kindsIn(IMPORT_RESULT_WORDS_BEFORE).sort()).toEqual(
      [
        "keeps-the-word Created (import result)",
        "asks-for-a-wording Created (import result)",
        "falls-back-to-the-word Created (import result)",
      ].sort(),
    );
  });

  test("finds a check of the key written as a string or as translationKey()", () => {
    expect(
      kindsIn(
        'const has: boolean = translator.hasTranslation("View (database object)");',
      ),
    ).toEqual(["asks-for-a-wording View (database object)"]);
    expect(
      kindsIn(
        'const has: boolean = getGlobalTranslator().hasTranslation(translationKey("Open (invoice status)"));',
      ),
    ).toEqual(["asks-for-a-wording Open (invoice status)"]);
  });

  test("finds a check of a constant set to the key in another file, imported under its name", () => {
    const words: SourceText = {
      file: "packages/App/FeatureSet/Dashboard/src/Utils/Words.ts",
      text: 'export const ARRAY_TERM: string = translationKey("Array (storage array)");',
    };

    expect(
      kindsIn(
        'import { ARRAY_TERM } from "../Utils/Words";\nconst has: boolean = Words.hasTranslation(ARRAY_TERM);',
        [words],
      ),
    ).toEqual(["asks-for-a-wording Array (storage array)"]);
  });

  test("finds a lookup falling back to the word, by ||, by ?? and by a condition", () => {
    expect(
      kindsIn(
        'const a: string = translator.translateText("Change (schema change)") || "Change";',
      ),
    ).toEqual(["falls-back-to-the-word Change (schema change)"]);
    expect(kindsIn('const a: string = t("To (range end)") ?? "To";')).toEqual([
      "falls-back-to-the-word To (range end)",
    ]);
    expect(
      kindsIn(
        'const a: string = ready ? translateString("From (range start)") : "From";',
      ),
    ).toEqual(["falls-back-to-the-word From (range start)"]);
    expect(
      kindsIn(
        'const a: string = !ready ? "Test" : translator.translateTerm(translationKey("Test (dbt test)"));',
      ),
    ).toEqual(["falls-back-to-the-word Test (dbt test)"]);
  });

  test("finds the word kept in a constant beside the key", () => {
    expect(
      kindsIn(
        'const VIEW: string = translationKey("View (database object)");\nconst VIEW_IN_ENGLISH: string = "View";',
      ),
    ).toEqual(["keeps-the-word View (database object)"]);
  });

  test("says where each one is, and what it is", () => {
    const findings: Array<MeaningKeyFallbackFinding> = findingsIn(
      DATA_SECURITY_PILLS_BEFORE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: FILE,
      line: 6,
      key: "Open (status)",
      kind: "asks-for-a-wording",
    });
    expect(findings[0]!.code).toBe(
      "translator.hasTranslation(OPEN_STATUS_TERM)",
    );
    expect(formatMeaningKeyFallbackFindings(findings)).toBe(
      `${FILE}:6 (asks-for-a-wording, "Open (status)"): translator.hasTranslation(OPEN_STATUS_TERM)`,
    );
  });

  test("leaves the plain lookup alone, as the pages draw a key now", () => {
    expect(
      kindsIn(`
        export const OPEN_STATUS_TERM: string = translationKey("Open (status)");
        export const ISSUE_STATUS_LABELS = { Open: OPEN_STATUS_TERM, Resolved: translationKey("Resolved") };
        const a: string = translator.translateText(OPEN_STATUS_TERM) || "";
        const b: string = translator.translateText(CREATED) || status;
        const c = <Pill text={OPEN_STATUS_TERM} />;
      `),
    ).toEqual([]);
  });

  test("leaves the bare word alone where no key that names its meaning is near", () => {
    expect(
      kindsIn(`
        const OPEN: string = "Open";
        const has: boolean = translator.hasTranslation("Open");
        const a: string = translator.translateText("Open") || "Open";
        const b: boolean = translator.hasTranslation(SOMETHING_ELSE);
      `),
    ).toEqual([]);
  });

  test("leaves a look-alike key alone: it reads as its whole text", () => {
    expect(
      kindsIn(`
        const RETENTION: string = translationKey("Retention (days)");
        const RETENTION_IN_ENGLISH: string = "Retention";
        const has: boolean = translator.hasTranslation(RETENTION);
      `),
    ).toEqual([]);
  });
});

describe("the front ends and Common", () => {
  const FILES: Array<string> = listMeaningKeyScanFiles();

  test("are read: the Dashboard, Common's UI, types, utilities and server, the enterprise screens", () => {
    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityPills.tsx",
      "packages/App/FeatureSet/Dashboard/src/Utils/ImportResultWords.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Invoices.tsx",
      "packages/Common/UI/Components/Filters/RangeEnds.ts",
      "packages/Common/Types/AI/AIReadTableWords.ts",
      "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
    ]) {
      expect({ file, read: FILES.includes(file) }).toEqual({
        file,
        read: true,
      });
    }

    // The translator's own knowledge of the keys is not a page.
    expect(FILES).not.toContain("packages/Common/Types/MeaningKeys.ts");
    expect(FILES).not.toContain("packages/Common/Types/Translator.ts");
    expect(
      FILES.some((file: string): boolean => {
        return file.includes("/Tests/");
      }),
    ).toBe(false);
  });

  test("write no meaning key's English by hand", () => {
    const findings: Array<MeaningKeyFallbackFinding> =
      findMeaningKeyFallbacksIn(FILES);

    if (findings.length > 0) {
      throw new Error(
        `A key that names its meaning reads as its word by itself (Common/Types/MeaningKeys): look it up as any key, and drop the English written for it.\n${formatMeaningKeyFallbackFindings(findings)}`,
      );
    }

    expect(findings).toEqual([]);
  });
});
