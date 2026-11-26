import { describe, expect, test } from "@jest/globals";
import {
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { buildOccurrenceExcerpt } from "../../../Utils/DataSecurity/OccurrenceExcerpt";
import {
  RecognizedDataTypeId,
  RecognizedEntity,
} from "../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * A RECORD'S EXCERPT, FOR A FINDING THE NAMES-AND-ADDRESSES MODEL MADE
 * (#10926).
 *
 * A person's name or a street address the model found has no pattern of
 * its own to cut an excerpt around: without what the model found, the
 * whole value is the data, masked. With it, the excerpt is the line around
 * the name or the address, as the scan found it, and every other name and
 * address the model found in it is masked too - masked as the model's
 * samples are, its first character and four stars, never more of it.
 */

const Text: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Text;
const Match: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Match;
const Masked: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Masked;

const SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

// What the model found in a value: each phrase where it first appears.
function found(
  value: string,
  phrases: Array<[string, RecognizedDataTypeId, number?]>,
): Array<RecognizedEntity> {
  return phrases.map(
    ([phrase, dataTypeId, score]: [
      string,
      RecognizedDataTypeId,
      number?,
    ]): RecognizedEntity => {
      const start: number = value.indexOf(phrase);

      if (start < 0) {
        throw new Error(`${phrase} is not in the value`);
      }

      return {
        dataTypeId,
        start,
        end: start + phrase.length,
        score: score ?? 0.95,
      };
    },
  );
}

function asText(excerpt: DataSecurityOccurrenceExcerpt): string {
  return (
    (excerpt.isCutAtStart ? "…" : "") +
    excerpt.parts
      .map((part: DataSecurityOccurrenceExcerptPart): string => {
        return part.kind === Text
          ? part.text
          : part.kind === Match
            ? `[${part.text}]`
            : `{${part.text}}`;
      })
      .join("") +
    (excerpt.isCutAtEnd ? "…" : "")
  );
}

function shownText(excerpt: DataSecurityOccurrenceExcerpt): string {
  return excerpt.parts
    .map((part: DataSecurityOccurrenceExcerptPart): string => {
      return part.text;
    })
    .join("");
}

const ISSUE_FOUND: Array<RecognizedEntity> = found(SENTENCE, [
  ["Maria Gonzalez", "person-name"],
  ["14 Calle Mayor", "postal-address", 0.99],
]);

describe("a person's name the model found", () => {
  test("is marked where it is, masked, with the line around it, and the address beside it masked", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: SENTENCE,
      dataTypeId: "person-name",
      location: "body",
      recognized: ISSUE_FOUND,
    });

    expect(asText(excerpt)).toBe(
      "Refund approved for [M****], {1****}, Madrid",
    );
    expect(excerpt.isCutAtStart).toBe(false);
    expect(excerpt.isCutAtEnd).toBe(false);
  });

  test("never shows the name or the street address, in any part", () => {
    for (const dataTypeId of ["person-name", "postal-address"]) {
      const text: string = shownText(
        buildOccurrenceExcerpt({
          value: SENTENCE,
          dataTypeId,
          location: "body",
          recognized: ISSUE_FOUND,
        }),
      );

      for (const word of ["Maria", "Gonzalez", "Calle", "Mayor", "14 "]) {
        expect({ dataTypeId, word, shown: text.includes(word) }).toEqual({
          dataTypeId,
          word,
          shown: false,
        });
      }
    }
  });

  test("is cut around in a long line, never cutting another name in half", () => {
    const before: string = "step ".repeat(40);
    const after: string = " then ".repeat(40);
    const value: string = `${before}Refund approved for Maria Gonzalez${after}`;
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "person-name",
      location: "body",
      recognized: found(value, [["Maria Gonzalez", "person-name"]]),
    });

    expect(excerpt.isCutAtStart).toBe(true);
    expect(excerpt.isCutAtEnd).toBe(true);
    expect(asText(excerpt)).toContain("Refund approved for [M****]");
    expect(shownText(excerpt)).not.toContain("Maria");
  });

  test("a test name is no match: the whole value is the data, masked as the model's samples are", () => {
    const value: string = "Welcome email sent to Jane Doe";
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "person-name",
      location: "body",
      recognized: found(value, [["Jane Doe", "person-name"]]),
    });

    expect(excerpt.parts).toEqual([{ kind: Match, text: "W****" }]);
  });

  test("a name the project allows is no match either", () => {
    const value: string = "Ticket assigned to Maria Gonzalez";
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "person-name",
      location: "body",
      options: { allowedValues: new Set(["maria gonzalez"]) },
      recognized: found(value, [["Maria Gonzalez", "person-name"]]),
    });

    expect(excerpt.parts).toEqual([{ kind: Match, text: "T****" }]);
  });

  test("without what the model found, the whole value is the data, masked as before", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: SENTENCE,
      dataTypeId: "person-name",
      location: "body",
    });

    expect(excerpt.parts).toEqual([{ kind: Match, text: "R****" }]);
  });
});

describe("a street address the model found", () => {
  test("is marked and masked as the model's samples are, the name beside it masked", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: SENTENCE,
      dataTypeId: "postal-address",
      location: "body",
      recognized: ISSUE_FOUND,
    });

    expect(asText(excerpt)).toBe(
      "Refund approved for {M****}, [1****], Madrid",
    );
  });

  test("masked as a sample is, never its last characters as a pattern's address is", () => {
    const text: string = shownText(
      buildOccurrenceExcerpt({
        value: SENTENCE,
        dataTypeId: "postal-address",
        location: "body",
        recognized: ISSUE_FOUND,
      }),
    );

    expect(text).not.toContain("ayor");
    expect(text).toContain("1****");
  });

  test("an address the English pattern finds too is one match, masked once", () => {
    const value: string = "Ship to 221 Baker Street, London today";
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "postal-address",
      location: "body",
      recognized: found(value, [["221 Baker Street", "postal-address"]]),
    });
    const matches: Array<DataSecurityOccurrenceExcerptPart> =
      excerpt.parts.filter((part: DataSecurityOccurrenceExcerptPart) => {
        return part.kind === Match;
      });

    expect(matches.length).toBe(1);
    expect(shownText(excerpt)).not.toContain("Baker");
  });
});

describe("what else the excerpt masks", () => {
  test("every sensitive value a detector finds, beside what the model found", () => {
    const value: string =
      "Maria Gonzalez (maria.gonzalez@acme-corp.com) changed her card";
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "person-name",
      location: "body",
      recognized: found(value, [["Maria Gonzalez", "person-name"]]),
    });

    expect(shownText(excerpt)).not.toContain("maria.gonzalez");
    expect(
      excerpt.parts.some((part: DataSecurityOccurrenceExcerptPart) => {
        return part.kind === Masked && part.text.includes("@");
      }),
    ).toBe(true);
  });

  test("a name of a type the project turned off is still masked beside the finding", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: SENTENCE,
      dataTypeId: "postal-address",
      location: "body",
      options: { disabledDataTypeIds: new Set(["person-name"]) },
      recognized: ISSUE_FOUND,
    });

    expect(shownText(excerpt)).not.toContain("Maria");
  });

  test("entities outside the value, or empty, are passed over", () => {
    const value: string = "Refund approved for Maria Gonzalez";
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value,
      dataTypeId: "person-name",
      location: "body",
      recognized: [
        ...found(value, [["Maria Gonzalez", "person-name"]]),
        { dataTypeId: "person-name", start: 50, end: 70, score: 0.9 },
        { dataTypeId: "person-name", start: 3, end: 3, score: 0.9 },
        { dataTypeId: "postal-address", start: -2, end: 4, score: 0.9 },
      ],
    });

    expect(asText(excerpt)).toBe("Refund approved for [M****]");
  });
});
