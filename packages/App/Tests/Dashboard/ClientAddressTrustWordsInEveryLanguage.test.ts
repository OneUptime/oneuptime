import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import { MAX_TRUSTED_PROXIES } from "Common/Utils/SecurityEvent/ClientAddressTrust";
import * as ClaimedCopy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ClaimedClientAddressCopy";
import * as ProxiesCopy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTrustedProxiesCopy";
import {
  UNCOUNTED_HIDDEN_BY_SCRUB_RULE,
  UNCOUNTED_NO_HOST,
  UNCOUNTED_NO_IP_ADDRESS,
  UNCOUNTED_NO_USER,
  UNCOUNTED_NO_VALUE,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";

/*
 * THE WORDS FOR WHERE A REQUEST CAME FROM (#10416) AND WHAT A RULE COULD
 * NOT COUNT (#10415), IN EVERY LANGUAGE THE DASHBOARD SHIPS - read from its
 * locale files as they ship.
 *
 * An address a request only claimed is never blamed, and the page says so
 * wherever it stands: an event's Claimed IP, What happened next, a case's
 * Response Plan. Trusted Proxies, under More settings on Connections, say
 * which proxies may name a client - and what is wrong with a list typed
 * there. Run on Past Events says how many matching events a rule that
 * counts per value could not count. A German, Japanese or Arabic reader
 * meets none of it in English.
 */

function sentencesOf(module: Record<string, unknown>): Array<string> {
  return Object.values(module).filter((value: unknown): value is string => {
    return typeof value === "string";
  });
}

const PLURALS: ReadonlyArray<PluralTemplate> = [
  UNCOUNTED_NO_IP_ADDRESS,
  UNCOUNTED_NO_USER,
  UNCOUNTED_NO_HOST,
  UNCOUNTED_NO_VALUE,
  UNCOUNTED_HIDDEN_BY_SCRUB_RULE,
];

const SENTENCES: ReadonlyArray<string> = [
  ...sentencesOf(ClaimedCopy),
  ...sentencesOf(ProxiesCopy),
];

// Every key: each sentence, and each plural's general form and its "one".
const KEYS: ReadonlyArray<string> = [
  ...SENTENCES,
  ...PLURALS.flatMap((plural: PluralTemplate): Array<string> => {
    return [plural.other, `${plural.other}_one`];
  }),
];

describe("the words for where a request came from, and what a rule could not count", () => {
  test("are each a key the Dashboard's English holds", () => {
    expect(sentencesOf(ClaimedCopy)).toHaveLength(3);
    expect(sentencesOf(ProxiesCopy)).toHaveLength(7);

    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }

    for (const plural of PLURALS) {
      expect({
        other: english[plural.other],
        one: english[`${plural.other}_one`],
      }).toEqual({ other: plural.other, one: plural.one });
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
          continue;
        }

        const english: string = key.endsWith("_one")
          ? key.slice(0, -"_one".length)
          : key;

        expect({
          language,
          key,
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("a claimed address is put in as the request wrote it", () => {
    const english: Translator = dashboardTranslator("en");

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const drawn: string = translator.translateTemplate(
        ClaimedCopy.CLAIMED_ADDRESS_NOT_VERIFIED,
        { address: "192.0.2.44" },
      );

      expect({
        language,
        named: drawn.includes("192.0.2.44"),
        english:
          drawn ===
          english.translateTemplate(ClaimedCopy.CLAIMED_ADDRESS_NOT_VERIFIED, {
            address: "192.0.2.44",
          }),
      }).toEqual({ language, named: true, english: false });
    }
  });

  test("what is wrong with a typed list is said in the reader's language, naming what was typed", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      ProxiesCopy.getTrustedProxiesProblemText("203.0.113.0/24", english),
    ).toBeNull();
    expect(
      ProxiesCopy.getTrustedProxiesProblemText("cloudflare", english),
    ).toBe(
      "cloudflare is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.",
    );

    const many: string = Array.from(
      { length: MAX_TRUSTED_PROXIES + 1 },
      (_value: unknown, index: number): string => {
        return `10.${Math.floor(index / 256)}.${index % 256}.1`;
      },
    ).join("\n");

    expect(ProxiesCopy.getTrustedProxiesProblemText(many, english)).toBe(
      "Trusted Proxies holds at most 500 addresses and ranges. Use ranges, such as 203.0.113.0/24, for a block of addresses.",
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const invalid: string | null = ProxiesCopy.getTrustedProxiesProblemText(
        "cloudflare",
        translator,
      );
      const tooMany: string | null = ProxiesCopy.getTrustedProxiesProblemText(
        many,
        translator,
      );

      expect({
        language,
        named: Boolean(invalid && invalid.includes("cloudflare")),
        english:
          invalid ===
          ProxiesCopy.getTrustedProxiesProblemText("cloudflare", english),
        counted: Boolean(
          tooMany &&
            tooMany.includes(translator.formatNumber(MAX_TRUSTED_PROXIES)),
        ),
      }).toEqual({ language, named: true, english: false, counted: true });
    }
  });

  test("what a rule could not count reads right at one and at many, in every language", () => {
    const english: Translator = dashboardTranslator("en");

    expect(english.translatePlural(UNCOUNTED_NO_IP_ADDRESS, 1)).toBe(
      "1 matching event had no IP address, so this rule couldn't count it.",
    );
    expect(english.translatePlural(UNCOUNTED_NO_IP_ADDRESS, 1204)).toBe(
      "1,204 matching events had no IP address, so this rule couldn't count them.",
    );
    expect(
      english.translatePlural(UNCOUNTED_NO_VALUE, 3, {
        field: "processName",
      }),
    ).toBe(
      "3 matching events had no processName, so this rule couldn't count them.",
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const plural of PLURALS) {
        for (const count of [1, 2, 21, 1204]) {
          const values: { field: string } = { field: "processName" };
          const drawn: string = translator.translatePlural(
            plural,
            count,
            values,
          );

          expect({
            language,
            plural: plural.other,
            count,
            counted: drawn.includes(translator.formatNumber(count)),
            english: drawn === english.translatePlural(plural, count, values),
            named:
              plural !== UNCOUNTED_NO_VALUE || drawn.includes("processName"),
          }).toEqual({
            language,
            plural: plural.other,
            count,
            counted: true,
            english: false,
            named: true,
          });
        }
      }
    }
  });
});
