import { describe, expect, test } from "@jest/globals";
import {
  DATA_CHECK_TYPES,
  DataCheckType,
} from "Common/Types/DataObservability/DataCheckType";
import {
  DATA_RECONCILIATION_MEASURES,
  DataReconciliationMeasure,
  getMeasureCheckType,
} from "Common/Types/DataObservability/DataReconciliation";
import { DATA_CHECK_TYPE_LABELS } from "../../../FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTypeWords";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";

/*
 * THE CHECKS PAGE NAMES EACH CHECK AS THE DASHBOARD DRAWS IT (#7223).
 *
 * What a check measures - Null Percent, Orphan Count, Row Count - read
 * English on every Dashboard page, so every translation of the Data
 * Observability Checks page quoted the names in English too. The Dashboard
 * now draws each in the reader's language (DataCheckTypeWords), and each
 * page names them as its language's Dashboard draws them: in the table of
 * checks, in the lists of checks that read a sample and that keep failing
 * rows, on the segmented Row Count, and among a reconciliation's measures.
 * The checks file keeps each type's value, which is what it is read by.
 */

const PAGE: string = "data-observability/checks";

const TRANSLATED: Array<string> = DOCS_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// The checks that read a rate, which Sample Percent reads a share of rows for.
const SAMPLED: Array<string> = [
  DataCheckType.NullPercent,
  DataCheckType.Average,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
];

// The checks whose failing rows Keep Failing Rows keeps.
const KEEPING_ROWS: Array<string> = [
  DataCheckType.FailingRows,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
  DataCheckType.OrphanCount,
];

// The names #7223 words, each still English in some language before it.
const NEWLY_WORDED: Array<string> = [
  DataCheckType.NullPercent,
  DataCheckType.DuplicatePercent,
  DataCheckType.DistinctCount,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
  DataCheckType.OrphanCount,
  DataCheckType.RowCount,
];

function lines(page: string): Array<string> {
  return page.split("\n");
}

// The page outside its code blocks: what a reader reads as prose.
function prose(page: string): string {
  let isFenced: boolean = false;

  return lines(page)
    .filter((line: string): boolean => {
      if (line.startsWith("```")) {
        isFenced = !isFenced;
        return false;
      }

      return !isFenced;
    })
    .join("\n");
}

// The code blocks alone.
function code(page: string): string {
  let isFenced: boolean = false;

  return lines(page)
    .filter((line: string): boolean => {
      if (line.startsWith("```")) {
        isFenced = !isFenced;
        return false;
      }

      return isFenced;
    })
    .join("\n");
}

// The table of checks' first cells: what each row names.
function tableNames(page: string): Array<string> {
  return lines(page)
    .filter((line: string): boolean => {
      return line.startsWith("| **");
    })
    .map((line: string): string => {
      return line.split(" | ")[0]!.slice(2);
    });
}

function namesInTable(page: string, name: string): boolean {
  return tableNames(page).some((cell: string): boolean => {
    return cell.includes(`**${name}**`);
  });
}

// The bullet that names a reconciliation's measure.
function namesAmongMeasures(page: string, name: string): boolean {
  return lines(page).some((line: string): boolean => {
    return line.startsWith("- ") && line.includes(`**${name}**`);
  });
}

/*
 * A translated page's line in the place of the English line that says
 * `english`: a translation keeps the English page's lines, one for one.
 */
function lineAt(language: string, english: string): string {
  const englishLines: Array<string> = lines(readPage("en", PAGE));
  const index: number = englishLines.findIndex((line: string): boolean => {
    return line.includes(english);
  });
  const own: Array<string> = lines(readPage(language, PAGE));

  expect(index).toBeGreaterThanOrEqual(0);
  expect(own).toHaveLength(englishLines.length);

  return own[index]!;
}

// The English lines that list checks by name, by what each says.
const SAMPLED_LINE: string =
  "Null Percent, Average, Invalid Percent and Format Mismatch Percent";
const KEEPING_ROWS_LINE: string =
  "Failing Rows, Invalid Percent, Format Mismatch Percent or Orphan Count";
const SEGMENTED_LINE: string = "A segmented Row Count alerts";

describe("the names the checks page quotes", () => {
  test("are each a Dashboard label, the type's own value", () => {
    for (const type of DATA_CHECK_TYPES) {
      expect({
        type,
        label: DATA_CHECK_TYPE_LABELS[type],
        isLabel: isDashboardLabel(DATA_CHECK_TYPE_LABELS[type]),
      }).toEqual({ type, label: type, isLabel: true });
    }

    for (const measure of DATA_RECONCILIATION_MEASURES) {
      expect(DATA_CHECK_TYPE_LABELS[getMeasureCheckType(measure)]).toBe(
        measure,
      );
    }
  });

  test("the English page names every check a person adds in its table, and the four measures a reconciliation compares", () => {
    const page: string = readPage("en", PAGE);

    for (const type of DATA_CHECK_TYPES) {
      expect({ type, named: namesInTable(page, type) }).toEqual({
        type,
        named: true,
      });
    }

    for (const measure of DATA_RECONCILIATION_MEASURES) {
      expect({ measure, named: namesAmongMeasures(page, measure) }).toEqual({
        measure,
        named: true,
      });
    }
  });

  test("the English page lists the sampled checks and the checks that keep rows on their settings' lines", () => {
    expect(lineAt("en", SAMPLED_LINE).startsWith("- **Sample Percent**")).toBe(
      true,
    );
    expect(lineAt("en", KEEPING_ROWS_LINE)).toContain("**Keep Failing Rows**");
    expect(lineAt("en", SEGMENTED_LINE).startsWith("**Segment By**")).toBe(
      true,
    );
  });

  test.each(TRANSLATED)(
    "the %s page names each check in its table as its Dashboard draws it",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      for (const type of DATA_CHECK_TYPES) {
        const drawn: string = drawnDashboardLabel(language, type);

        expect({ type, drawn, named: namesInTable(page, drawn) }).toEqual({
          type,
          drawn,
          named: true,
        });
      }

      // As many rows as the English table: none dropped, none doubled.
      expect(tableNames(page)).toHaveLength(
        tableNames(readPage("en", PAGE)).length,
      );
    },
  );

  test.each(TRANSLATED)(
    "the %s page names a reconciliation's measures as its Dashboard draws them",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      for (const measure of Object.values(DataReconciliationMeasure)) {
        const drawn: string = drawnDashboardLabel(language, measure);

        expect({
          measure,
          drawn,
          named: namesAmongMeasures(page, drawn),
        }).toEqual({ measure, drawn, named: true });
      }
    },
  );

  test.each(TRANSLATED)(
    "the %s page names the sampled checks, the checks that keep rows and the segmented Row Count in its Dashboard's words",
    (language: string) => {
      const sampled: string = lineAt(language, SAMPLED_LINE);
      const keeping: string = lineAt(language, KEEPING_ROWS_LINE);
      const segments: string = lineAt(language, SEGMENTED_LINE);

      // The lines in the English lines' places: each its setting's.
      expect(
        sampled.startsWith(
          `- **${drawnDashboardLabel(language, "Sample Percent")}**`,
        ),
      ).toBe(true);
      expect(keeping).toContain(
        `**${drawnDashboardLabel(language, "Keep Failing Rows")}**`,
      );
      expect(
        segments.startsWith(
          `**${drawnDashboardLabel(language, "Segment By")}**`,
        ),
      ).toBe(true);

      expect({
        language,
        sampled: SAMPLED.filter((type: string): boolean => {
          return !sampled.includes(drawnDashboardLabel(language, type));
        }),
        keeping: KEEPING_ROWS.filter((type: string): boolean => {
          return !keeping.includes(drawnDashboardLabel(language, type));
        }),
        // In the middle of a sentence, a name may take the sentence's case.
        segmented: segments
          .toLocaleLowerCase()
          .includes(
            drawnDashboardLabel(
              language,
              DataCheckType.RowCount,
            ).toLocaleLowerCase(),
          ),
      }).toEqual({ language, sampled: [], keeping: [], segmented: true });
    },
  );

  test.each(TRANSLATED)(
    "the %s page leaves none of the names it words in English, and its checks file keeps each type's value",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      expect({
        language,
        english: NEWLY_WORDED.filter((type: string): boolean => {
          return prose(page).includes(type);
        }),
      }).toEqual({ language, english: [] });

      for (const type of [
        DataCheckType.NullPercent,
        DataCheckType.FormatMismatchPercent,
        DataCheckType.OrphanCount,
        DataCheckType.FailingRows,
      ]) {
        expect(code(page)).toContain(`type: ${type}`);
      }

      expect(code(page)).toBe(code(readPage("en", PAGE)));
    },
  );

  test("the checks above catch a page that quotes the English name", () => {
    const german: string = readPage("de", PAGE);
    const asBefore: string = german
      .split(`**${drawnDashboardLabel("de", DataCheckType.NullPercent)}**`)
      .join(`**${DataCheckType.NullPercent}**`);

    expect(namesInTable(german, "Anteil NULL-Werte")).toBe(true);
    expect(namesInTable(asBefore, "Anteil NULL-Werte")).toBe(false);
    expect(prose(asBefore)).toContain(DataCheckType.NullPercent);
  });
});
