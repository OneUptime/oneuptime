import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getProbeAgreementRequiredCount,
  getProbeAgreementSentence,
} from "../../../Utils/Monitor/ProbeAgreementRule";
import { Translator, createTranslator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";

/*
 * THE PROBE AGREEMENT RULE, ONE COPY (#7410). The server changes a
 * probe-based monitor's status only when enough of its enabled, connected
 * probes agree; the monitor's probes card and the website-down guided
 * setup say what it decides. The website setup said "an incident opens"
 * whenever one probe of several got an error, though the server opened
 * none: each place worked the rule out its own way. Now all three read
 * this one.
 */

const english: Translator = createTranslator(undefined, "en");

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");

const source: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(REPOSITORY, file), "utf8");
};

describe("how many probes must agree", () => {
  test.each([
    // [minimum, active, required]
    [null, 0, 0],
    [null, 1, 1],
    [null, 3, 3],
    [undefined, 3, 3],
    [1, 3, 1],
    [2, 3, 2],
    [3, 3, 3],
    // Never more than take part: 3 required with one of three disconnected is 2 of 2.
    [3, 2, 2],
    [5, 1, 1],
    [0, 3, 0],
  ] as Array<[number | null | undefined, number, number]>)(
    "minimum %s of %i active: %i",
    (minimum: number | null | undefined, active: number, required: number) => {
      expect(
        getProbeAgreementRequiredCount({
          minimumProbeAgreement: minimum,
          activeProbeCount: active,
        }),
      ).toBe(required);
    },
  );

  test("a minimum read back as text is that number, as the server's Math.min took it", () => {
    expect(
      getProbeAgreementRequiredCount({
        minimumProbeAgreement: "2" as unknown as number,
        activeProbeCount: 3,
      }),
    ).toBe(2);
  });

  test("a minimum that is no number is all of them", () => {
    expect(
      getProbeAgreementRequiredCount({
        minimumProbeAgreement: Number.NaN,
        activeProbeCount: 3,
      }),
    ).toBe(3);
  });

  test("is what the server decides with", () => {
    const resource: string = source(
      "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
    );
    const check: string = resource.slice(
      resource.indexOf("private static async checkProbeAgreement("),
    );

    expect(check).toContain(
      "const effectiveThreshold: number = getProbeAgreementRequiredCount({",
    );
    expect(check).toContain(
      "minimumProbeAgreement: monitor.minimumProbeAgreement,",
    );
    expect(check).toContain("activeProbeCount: activeProbes.length,");
    // The rule's own copy is gone from the server.
    expect(resource).not.toContain(
      "monitor.minimumProbeAgreement ?? activeProbes.length",
    );
  });

  test("and what the pages say it with", () => {
    expect(
      source(
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx",
      ),
    ).toContain("return getProbeAgreementSentence({");
    expect(
      source(
        "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts",
      ),
    ).toContain("getProbeAgreementRequiredCount({");
  });
});

describe("the rule in a sentence", () => {
  const sentence: (
    minimum: number | null,
    active: number,
    translator?: Translator,
  ) => string | null = (
    minimum: number | null,
    active: number,
    translator?: Translator,
  ): string | null => {
    return getProbeAgreementSentence({
      minimumProbeAgreement: minimum,
      activeProbeCount: active,
      translator: translator || english,
    });
  };

  test("no agreement to speak of: one probe, or a minimum of one", () => {
    expect(sentence(null, 0)).toBeNull();
    expect(sentence(null, 1)).toBeNull();
    expect(sentence(1, 3)).toBeNull();
  });

  test("all of them", () => {
    expect(sentence(null, 2)).toBe(
      "A status change needs both connected probes to agree.",
    );
    expect(sentence(null, 3)).toBe(
      "A status change needs all 3 connected probes to agree.",
    );
    expect(sentence(5, 3)).toBe(
      "A status change needs all 3 connected probes to agree.",
    );
  });

  test("some of them", () => {
    expect(sentence(2, 3)).toBe(
      "A status change needs 2 of 3 connected probes to agree.",
    );
  });

  test("in every language, its counts in the reader's digits", () => {
    for (const language of [...DASHBOARD_LANGUAGES]) {
      const translator: Translator = dashboardTranslator(language);
      const some: string = sentence(2, 3, translator) || "";
      const all: string = sentence(null, 4, translator) || "";

      expect({ language, worded: some !== sentence(2, 3) }).toEqual({
        language,
        worded: true,
      });
      expect(some).toContain(translator.formatNumber(2));
      expect(some).toContain(translator.formatNumber(3));
      expect(all).toContain(translator.formatNumber(4));
    }
  });
});
