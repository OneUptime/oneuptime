import PostgresErrorTranslator from "../../Server/Utils/Database/PostgresErrorTranslator";
import Text from "../../Types/Text";
import { isSensitiveSampleKey } from "../../Types/Workflow/StepSamples";
import { tableNameToWords } from "../../UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { splitCapitalRunsBeforeWords } from "../../Utils/CapitalRuns";
import { toTerraformSnakeCase } from "../../Utils/DeveloperDocs/TerraformSchema";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A RUN OF CAPITALS BEFORE A WORD IS SPLIT IN TIME IN LINE WITH THE TEXT'S
 * LENGTH, WHERE THE PATTERN SPLIT IT.
 *
 * "OIDCProvider" -> "OIDC Provider": the pattern /([A-Z]+)([A-Z][a-z])/g was
 * tried from every capital of a run that no lower-case letter follows, each
 * try reading on to the end of the run - a key in a workflow run's data, a
 * name shown in a list, held time that grows with the square of its run of
 * capitals. splitCapitalRunsBeforeWords takes each run whole, once, and puts
 * the separator exactly where the pattern's "$1 $2" (or "$1_$2") put it.
 * Every place that split names this way uses it.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

// The pattern as it was: the reference the helper must agree with.
const CAPITAL_RUN_BEFORE_WORD_BEFORE: RegExp = /([A-Z]+)([A-Z][a-z])/g;

const WORST_TEXTS: Array<[string, string]> = [
  [
    "a run of capitals no lower-case letter follows",
    repeat("A", LENGTH) + "\u0000AAa",
  ],
  ["capitals and digits", repeat("A1", LENGTH)],
  ["runs of capitals between words", repeat("AAAAAAAAAa", LENGTH)],
];

describe("a long run of capitals is split quickly", () => {
  test.each(WORST_TEXTS)("%s", (_label: string, text: string) => {
    for (const separator of [" ", "_"]) {
      expect(
        timeOf(() => {
          splitCapitalRunsBeforeWords(text, separator);
        }),
      ).toBeLessThan(2000);
    }
  });

  test.each(WORST_TEXTS)(
    "%s, through every reader that splits names",
    (_label: string, text: string) => {
      const readers: Array<[string, () => unknown]> = [
        [
          "Text.fromPascalCaseToReadable",
          (): unknown => {
            return Text.fromPascalCaseToReadable(text);
          },
        ],
        [
          "a workflow sample's key",
          (): unknown => {
            return isSensitiveSampleKey(text);
          },
        ],
        [
          "a Terraform attribute name",
          (): unknown => {
            return toTerraformSnakeCase(text);
          },
        ],
        [
          "a table's name in the workflow picker",
          (): unknown => {
            return tableNameToWords(text);
          },
        ],
        [
          "a database column named in an error",
          (): unknown => {
            return (
              PostgresErrorTranslator as unknown as {
                humanizeColumnName: (name: string) => string;
              }
            ).humanizeColumnName(text);
          },
        ],
      ];

      for (const [reader, run] of readers) {
        expect({ reader, fast: timeOf(run) < 2000 }).toEqual({
          reader,
          fast: true,
        });
      }
    },
  );
});

describe("the separator goes where the pattern put it", () => {
  test("on forty thousand drawn texts, with either separator", () => {
    const differences: Array<string> = [];
    let split: number = 0;

    for (const text of generatedTexts(
      40000,
      9973,
      [
        "A",
        "B",
        "Z",
        "a",
        "b",
        "z",
        "0",
        "_",
        "-",
        " ",
        "ID",
        "OIDC",
        "Provider",
        "é",
        "\u212a",
        "$1",
      ],
      12,
    )) {
      for (const separator of [" ", "_"]) {
        const expected: string = text.replace(
          new RegExp(CAPITAL_RUN_BEFORE_WORD_BEFORE.source, "g"),
          `$1${separator}$2`,
        );

        if (expected !== text) {
          split++;
        }

        if (splitCapitalRunsBeforeWords(text, separator) !== expected) {
          differences.push(JSON.stringify([text, separator]));
        }
      }
    }

    expect(differences).toEqual([]);
    expect(split).toBeGreaterThan(10000);
  });

  test("the names it is written for", () => {
    expect(splitCapitalRunsBeforeWords("OIDCProvider", " ")).toBe(
      "OIDC Provider",
    );
    expect(splitCapitalRunsBeforeWords("APIKey", "_")).toBe("API_Key");
    expect(splitCapitalRunsBeforeWords("IP", " ")).toBe("IP");
    expect(splitCapitalRunsBeforeWords("AaBC", " ")).toBe("AaBC");
    expect(Text.fromPascalCaseToReadable("twilioAccountSID")).toBe(
      "twilio Account SID",
    );
    expect(Text.fromPascalCaseToReadable("OIDCProviderName")).toBe(
      "OIDC Provider Name",
    );
    expect(toTerraformSnakeCase("APIKey")).toBe("api_key");
    expect(tableNameToWords("StatusPageSMTPConfig")).toBe(
      "Status Page SMTP Config",
    );
    expect(isSensitiveSampleKey("AWSSecretAccessKey")).toBe(true);
  });
});
