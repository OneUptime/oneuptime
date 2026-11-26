import { describe, expect, test } from "@jest/globals";
import { recognizeAsWritten } from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import { ModelRereads } from "../../../../../Server/Utils/DataSecurity/Model/ModelRereads";
import {
  ModelScanContext,
  recognizeTexts,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  ModelReading,
  readableForModel,
  readingForModel,
} from "../../../../../Utils/DataSecurity/Model/ModelTextReading";
import { ModelRecognitions } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../../../Utils/DataSecurity/TextScanner";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import FakeEntityRecognizer from "./FakeEntityRecognizer";

/*
 * THE MODEL READS A URL AS A URL IS READ (#11034).
 *
 * /profile?name=Jos%C3%A9%20Garc%C3%ADa is one token of escapes to the
 * model, as written. It reads a text with its percent-escapes read - a
 * character's UTF-8 bytes too - and a "+" between two letters as the space
 * a query string means by it, and each name it finds is placed on the
 * characters the text writes it with: what a scan hands it (ModelScan) and
 * what a read of a finding's records again hands it (ModelRereads) alike,
 * so the two find the same name in the same value.
 */

const PHRASES: Array<{ text: string; dataTypeId: "person-name" }> = [
  { text: "José García", dataTypeId: "person-name" },
  { text: "Lars Eriksson", dataTypeId: "person-name" },
  { text: "Maria Gonzalez", dataTypeId: "person-name" },
];

function fake(): FakeEntityRecognizer {
  return new FakeEntityRecognizer({ phrases: PHRASES, millisecondsPerText: 0 });
}

function budget(): ReturnType<ModelBudget["forStore"]> {
  return new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }).forStore(
    "urls",
  );
}

describe("a text as the model reads it", () => {
  test("its escapes read, a character's UTF-8 bytes too", () => {
    const reading: ModelReading = readingForModel(
      "/profile?name=Jos%C3%A9%20Garc%C3%ADa&tab=2",
    );

    expect(reading.text).toBe("/profile?name=José García&tab=2");
    expect(reading.toWritten(14)).toBe(14);
    expect(reading.toWritten(reading.text.length)).toBe(
      "/profile?name=Jos%C3%A9%20Garc%C3%ADa&tab=2".length,
    );
  });

  test("a + between two letters as a space, every position where it was", () => {
    const reading: ModelReading = readingForModel(
      "?full_name=Lars+Eriksson&n=1+2&lang=C++",
    );

    expect(reading.text).toBe("?full_name=Lars Eriksson&n=1+2&lang=C++");
    expect(reading.toWritten(15)).toBe(15);
  });

  test("a text with neither reads as it is written", () => {
    for (const text of [
      "Refund approved for Maria Gonzalez",
      "100% done",
      "",
    ]) {
      const reading: ModelReading = readingForModel(text);

      expect(reading.text).toBe(text);
      expect(reading.toWritten(3)).toBe(3);
    }
  });
});

describe("what the model finds, placed as written", () => {
  test("a name in an encoded URL is found whole, on its escapes", async () => {
    const text: string = "GET /profile?name=Jos%C3%A9%20Garc%C3%ADa&tab=2 200";
    const recognizer: FakeEntityRecognizer = fake();
    const found: Map<
      string,
      Array<{ start: number; end: number }>
    > = await recognizeAsWritten(recognizer, [text], budget());
    const [entity] = found.get(text)!;

    // The model was handed the text as it reads.
    expect(recognizer.given).toEqual([
      "GET /profile?name=José García&tab=2 200",
    ]);
    expect(text.slice(entity!.start, entity!.end)).toBe(
      "Jos%C3%A9%20Garc%C3%ADa",
    );
  });

  test("a name a + joins, and one written plainly, as before", async () => {
    const encoded: string = "POST /contacts?full_name=Lars+Eriksson 201";
    const plain: string = "Refund approved for Maria Gonzalez";
    const found: Map<
      string,
      Array<{ start: number; end: number }>
    > = await recognizeAsWritten(fake(), [encoded, plain], budget());

    expect(
      found.get(encoded)!.map((entity: { start: number; end: number }) => {
        return encoded.slice(entity.start, entity.end);
      }),
    ).toEqual(["Lars+Eriksson"]);
    expect(
      found.get(plain)!.map((entity: { start: number; end: number }) => {
        return plain.slice(entity.start, entity.end);
      }),
    ).toEqual(["Maria Gonzalez"]);
  });

  test("two texts that read alike are read once, each placed on its own characters", async () => {
    const first: string = "?to=Maria%20Gonzalez";
    const second: string = "?to=Maria%2520Gonzalez";
    const recognizer: FakeEntityRecognizer = fake();
    const found: Map<
      string,
      Array<{ start: number; end: number }>
    > = await recognizeAsWritten(recognizer, [first, second], budget());

    expect(recognizer.given).toEqual(["?to=Maria Gonzalez"]);
    expect(first.slice(found.get(first)![0]!.start)).toBe("Maria%20Gonzalez");
    expect(second.slice(found.get(second)![0]!.start)).toBe(
      "Maria%2520Gonzalez",
    );
  });

  test("a scan hands the model each value as it reads, and the classifier looks it up as written", async () => {
    const text: string = "GET /invite?to=Maria%20Gonzalez&role=editor 302";
    const recognizer: FakeEntityRecognizer = fake();
    const context: ModelScanContext = {
      recognizer,
      budget: new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }),
    };
    const recognitions: ModelRecognitions | undefined = await recognizeTexts(
      context,
      "store",
      [text],
    );
    const matches: Array<TextMatch> = findSensitiveValues(
      text,
      {},
      recognitions!.get(text),
    ).filter((match: TextMatch): boolean => {
      return match.dataTypeId === "person-name";
    });

    expect(recognizer.given).toEqual([
      "GET /invite?to=Maria Gonzalez&role=editor 302",
    ]);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(
      "Maria%20Gonzalez",
    );
    expect(matches[0]!.fromModel).toBe(true);
  });

  test("a read of a finding's records again finds the same name in the same value", async () => {
    const text: string = "GET /invite?to=Maria%20Gonzalez&role=editor 302";
    const read: ModelRereads = new ModelRereads({
      recognizer: fake(),
      budget: new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }),
    });

    await read.read([text]);

    expect(
      read.entitiesIn(text)!.map((entity: { start: number; end: number }) => {
        return text.slice(entity.start, entity.end);
      }),
    ).toEqual(["Maria%20Gonzalez"]);
  });

  test("a name the model found in a URL is judged as it reads: a placeholder, a value the project allows", () => {
    const placeholder: string = "GET /invite?to=Jane%20Doe&role=editor 302";
    const allowed: string = "GET /invite?to=Maria%20Gonzalez&role=editor 302";

    function entityOn(
      text: string,
      written: string,
    ): Array<{
      dataTypeId: "person-name";
      start: number;
      end: number;
      score: number;
    }> {
      const start: number = text.indexOf(written);

      return [
        {
          dataTypeId: "person-name",
          start,
          end: start + written.length,
          score: 0.95,
        },
      ];
    }

    const [placeholderName] = findSensitiveValues(
      placeholder,
      {},
      entityOn(placeholder, "Jane%20Doe"),
    );

    expect(placeholderName!.normalized).toBe("Jane Doe");
    expect(placeholderName!.isTestValue).toBe(true);
    expect(
      findSensitiveValues(
        allowed,
        { allowedValues: new Set(["maria gonzalez"]) },
        entityOn(allowed, "Maria%20Gonzalez"),
      ),
    ).toEqual([]);
    expect(readableForModel("Maria%20Gonzalez")).toBe("Maria Gonzalez");
    expect(readableForModel("Lars+Eriksson")).toBe("Lars Eriksson");
  });

  test("a text of escapes without end is read in time in line with its length", () => {
    const text: string = `${"%20%C3%A9+a".repeat(40_000)}`;
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return readingForModel(text).text.length;
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
