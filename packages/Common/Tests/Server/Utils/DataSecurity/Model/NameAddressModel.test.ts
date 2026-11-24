import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dgram from "dgram";
import dns from "dns";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import tls from "tls";
import { EntityRecognizer } from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  closeNameAddressRecognizer,
  getNameAddressRecognizer,
  isNameAddressModelRunning,
  RecognizerAvailability,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { fetchModelIntoCache } from "./ModelCache";
import {
  falseFindingsPerThousandNegatives,
  LanguageScores,
  loadBenchmarkSlice,
  loadTestSet,
  SCORED_TYPES,
  scoreFindings,
  TestCase,
} from "./NamesAndAddressesEvaluation";

/*
 * THE REAL MODEL, AS THE SCANNER RUNS IT.
 *
 * The model's files are fetched once into the test cache and checked against
 * the SHA-256 NameAddressModel.json pins (ModelCache.ts); then the scanner's
 * own recogniser runs them on ONNX Runtime's WebAssembly build in the model's
 * thread, exactly as a worker or a probe does, and:
 *
 *  - the issue's sentence is a person name and a street address;
 *  - on the written test set (seven languages) and on the public benchmark's
 *    slice, precision and recall per language are at least what was measured
 *    when the model was chosen (NamesAndAddressesBaseline.json, the numbers
 *    in the docs): a change that lowers them fails;
 *  - the bar the model was chosen by still holds on the written set;
 *  - nothing reaches for the network while the model loads and reads: this
 *    thread's network modules are watched, and the model's thread reports
 *    every attempt its lockdown refused.
 */

interface Baseline {
  falseFindingsPerThousandNegatives: number;
  languages: Record<
    string,
    Record<string, { precision: number; recall: number }>
  >;
}

const BASELINE: { written: Baseline; benchmark: Baseline } = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "NamesAndAddressesBaseline.json"),
    "utf8",
  ),
);

const SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

let recognizer: EntityRecognizer;
const networkAttempts: Array<string> = [];
const spies: Array<{
  mockRestore: () => void;
  mock: { calls: Array<unknown> };
}> = [];

async function recognize(
  cases: ReadonlyArray<{ text: string }>,
): Promise<Array<Array<RecognizedEntity>>> {
  const found: Map<
    string,
    Array<RecognizedEntity>
  > = await recognizer.recognize(
    cases.map((item: { text: string }): string => {
      return item.text;
    }),
    new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs: 1e9 }).forStore(
      "test",
    ),
  );

  return cases.map((item: { text: string }): Array<RecognizedEntity> => {
    return found.get(item.text) || [];
  });
}

function expectAtLeastBaseline(
  scores: LanguageScores,
  baseline: Baseline,
): void {
  for (const [language, byType] of Object.entries(baseline.languages)) {
    for (const dataTypeId of SCORED_TYPES) {
      const measured: { precision: number; recall: number } = {
        precision: round(scores[language]![dataTypeId].precision),
        recall: round(scores[language]![dataTypeId].recall),
      };
      const floor: { precision: number; recall: number } = byType[dataTypeId]!;

      expect({ language, dataTypeId, ...measured }).toEqual({
        language,
        dataTypeId,
        precision: Math.max(measured.precision, floor.precision),
        recall: Math.max(measured.recall, floor.recall),
      });
    }
  }
}

beforeAll(async () => {
  // Fetched before the network is watched: the cache is the tests', not the scanner's.
  const directory: string = await fetchModelIntoCache();

  await closeNameAddressRecognizer();

  // Common's test environment is jsdom, which has no fetch of its own.
  if (typeof globalThis.fetch === "function") {
    spies.push(jest.spyOn(globalThis, "fetch") as never);
  }

  spies.push(
    jest.spyOn(http, "request") as never,
    jest.spyOn(http, "get") as never,
    jest.spyOn(https, "request") as never,
    jest.spyOn(https, "get") as never,
    jest.spyOn(net, "connect") as never,
    jest.spyOn(net, "createConnection") as never,
    jest.spyOn(tls, "connect") as never,
    jest.spyOn(dns, "lookup") as never,
    jest.spyOn(dgram, "createSocket") as never,
  );

  const availability: RecognizerAvailability = await getNameAddressRecognizer({
    directory,
    thread: {
      onNetworkAttempt: (api: string): void => {
        networkAttempts.push(api);
      },
    },
  });

  if (!("recognizer" in availability)) {
    throw new Error(`The model did not load: ${availability.reason}`);
  }

  recognizer = availability.recognizer;
}, 600000);

afterAll(async () => {
  for (const spy of spies) {
    spy.mockRestore();
  }

  await closeNameAddressRecognizer();
});

describe("the names-and-addresses model", () => {
  test("loads once, in its thread", () => {
    expect(isNameAddressModelRunning()).toBe(true);
  });

  test("finds the issue's sentence's person name and street address, and not its city", async () => {
    const [found] = await recognize([{ text: SENTENCE }]);

    expect(
      (found || []).map((entity: RecognizedEntity): string => {
        return `${entity.dataTypeId}: ${SENTENCE.slice(entity.start, entity.end)}`;
      }),
    ).toEqual([
      "person-name: Maria Gonzalez",
      "postal-address: 14 Calle Mayor",
    ]);
  }, 120000);

  test("holds its precision and recall per language on the written test set", async () => {
    const cases: Array<TestCase> = loadTestSet();
    const findings: Array<Array<RecognizedEntity>> = await recognize(cases);
    const scores: LanguageScores = scoreFindings(cases, findings);

    expectAtLeastBaseline(scores, BASELINE.written);
    expect(
      Math.round(falseFindingsPerThousandNegatives(cases, findings)),
    ).toBeLessThanOrEqual(BASELINE.written.falseFindingsPerThousandNegatives);

    // The bar the model was chosen by (written down before any was measured).
    for (const dataTypeId of SCORED_TYPES) {
      expect(scores["all"]![dataTypeId].precision).toBeGreaterThanOrEqual(0.9);
      expect(scores["all"]![dataTypeId].recall).toBeGreaterThanOrEqual(0.7);

      for (const language of ["en", "es", "de", "fr", "it", "pt", "nl"]) {
        expect({
          language,
          dataTypeId,
          atLeast085: scores[language]![dataTypeId].precision >= 0.85,
        }).toEqual({ language, dataTypeId, atLeast085: true });
      }
    }

    expect(
      falseFindingsPerThousandNegatives(cases, findings),
    ).toBeLessThanOrEqual(20);
  }, 600000);

  test("holds its precision and recall per language on the public benchmark's slice", async () => {
    const cases: Array<TestCase> = loadBenchmarkSlice();
    const findings: Array<Array<RecognizedEntity>> = await recognize(cases);

    expectAtLeastBaseline(scoreFindings(cases, findings), BASELINE.benchmark);
  }, 900000);

  test("never reached for the network while it loaded and read", () => {
    expect(networkAttempts).toEqual([]);

    for (const spy of spies) {
      expect(spy.mock.calls).toEqual([]);
    }
  });
});
