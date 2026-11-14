import { describe, expect, test } from "@jest/globals";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  getPluralCategory,
  PluralTemplate,
  TemplateValues,
} from "Common/Types/Translator";
import {
  CONVERSATION_CLIENT_COUNT,
  FLOW_COUNT,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";

/*
 * A COUNT'S "ONE" FORM, AT EVERY COUNT ITS LANGUAGE READS IT AT.
 *
 * A language reads a plural's one form for every count its plural rules
 * call "one": 0 and 1 in French, Portuguese, Hindi and Persian; 1, 21, 31
 * and 101 in Russian; 1 in the rest. Read here from the Dashboard's locale
 * files as its bundle ships them, with the mark of each one form a language
 * words as English does on purpose (Common/UI/esbuild-locales.js):
 *
 *   - such a one form is the language's own: French "0 signal" beside its
 *     "3 signaux", Russian "21 CPU" beside "CPU: 5" - not English's "0
 *     signals", "21 CPUs", as a one form left English reads (#7788);
 *   - the one forms that were left English are worded: "1 of 1 service" in
 *     eleven languages, German and Spanish "1 bug" and "1 fix shipped",
 *     Russian "Showing 12 of 21." (#7789);
 *   - and a one form a reader words apart from English reads so: French
 *     "flux", Persian's load balancers and file shares.
 */

const SIGNALS: PluralTemplate = {
  one: "{{count}} signal",
  other: "{{count}} signals",
};
const MONITORS: PluralTemplate = {
  one: "{{count}} monitor",
  other: "{{count}} monitors",
};
const ITEMS: PluralTemplate = {
  one: "{{count}} item, {{size}}",
  other: "{{count}} items, {{size}}",
};
const CPUS: PluralTemplate = { one: "{{count}} CPU", other: "{{count}} CPUs" };
const INCIDENTS: PluralTemplate = {
  one: "{{count}} incident",
  other: "{{count}} incidents",
};
const LOAD_BALANCERS: PluralTemplate = {
  one: "{{count}} load balancer",
  other: "{{count}} load balancers",
};
const SHARES: PluralTemplate = {
  one: "{{count}} share",
  other: "{{count}} shares",
};
// Logs and Metrics Insights: the services reporting, of those in scope.
const REPORTING: PluralTemplate = {
  one: "{{reporting}} of {{count}} service",
  other: "{{reporting}} of {{count}} services",
};
// Exceptions: under the unresolved and resolved counts.
const BUGS: PluralTemplate = { one: "bug", other: "bugs" };
const FIXES: PluralTemplate = { one: "fix shipped", other: "fixes shipped" };
// Ask AI's list of records, past the twelve it draws.
const SHOWING: PluralTemplate = {
  one: "Showing {{shown}} of {{count}}.",
  other: "Showing {{shown}} of {{count}}.",
};

const read: (
  language: string,
  template: PluralTemplate,
  count: number,
  values?: TemplateValues,
) => string = (
  language: string,
  template: PluralTemplate,
  count: number,
  values: TemplateValues = {},
): string => {
  return dashboardTranslator(language).translatePlural(template, count, values);
};

describe("the sentences read here", () => {
  test("are en.json's, each with its one form", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const template of [
      SIGNALS,
      MONITORS,
      ITEMS,
      CPUS,
      INCIDENTS,
      LOAD_BALANCERS,
      SHARES,
      REPORTING,
      BUGS,
      FIXES,
      SHOWING,
      FLOW_COUNT,
      CONVERSATION_CLIENT_COUNT,
    ]) {
      expect([template.other, english[template.other]]).toEqual([
        template.other,
        template.other,
      ]);
      expect([template.other, english[`${template.other}_one`]]).toEqual([
        template.other,
        template.one,
      ]);
    }
  });
});

describe("a one form a language words as English does, on purpose (#7788)", () => {
  test.each([
    ["fr", SIGNALS, 0, "0 signal"],
    ["fr", SIGNALS, 1, "1 signal"],
    ["fr", SIGNALS, 3, "3 signaux"],
    ["fr", CONVERSATION_CLIENT_COUNT, 0, "0 client"],
    ["fr", CONVERSATION_CLIENT_COUNT, 1, "1 client"],
    ["fr", CONVERSATION_CLIENT_COUNT, 3, "Jusqu'à 3 clients"],
    ["fr", INCIDENTS, 0, "0 incident"],
    ["pt", MONITORS, 0, "0 monitor"],
    ["pt", MONITORS, 1, "1 monitor"],
    ["pt", MONITORS, 2, "2 monitores"],
    ["ru", CPUS, 21, "21 CPU"],
    ["ru", CPUS, 101, "101 CPU"],
    ["ru", CPUS, 1, "1 CPU"],
    ["ru", CPUS, 5, "CPU: 5"],
  ])(
    "%s: %j at %d reads %s",
    (
      language: string,
      template: PluralTemplate,
      count: number,
      expected: string,
    ) => {
      expect(read(language, template, count)).toBe(expected);
    },
  );

  test("Portuguese counts 0 items, of a size, in its one form", () => {
    expect(getPluralCategory("pt", 0)).toBe("one");
    expect(read("pt", ITEMS, 0, { size: "2 GB" })).toBe("0 item, 2 GB");
    expect(read("pt", ITEMS, 4, { size: "2 GB" })).toBe("4 itens, 2 GB");
  });

  test("the counts read above are the ones each language calls one", () => {
    for (const [language, count] of [
      ["fr", 0],
      ["fr", 1],
      ["pt", 0],
      ["pt", 1],
      ["fa", 0],
      ["fa", 1],
      ["hi", 0],
      ["hi", 1],
      ["ru", 1],
      ["ru", 21],
      ["ru", 101],
    ] as Array<[string, number]>) {
      expect([language, count, getPluralCategory(language, count)]).toEqual([
        language,
        count,
        "one",
      ]);
    }
  });
});

describe("a one form a reader words apart from English", () => {
  test.each([
    [0, "0 flux"],
    [1, "1 flux"],
    [3, "3 flux"],
  ])("French says %d flows as %s", (count: number, expected: string) => {
    expect(read("fr", FLOW_COUNT, count)).toBe(expected);
  });

  /*
   * Persian words both as the general form does, the noun after the count
   * in the singular (the OpenStack glossary's words), in Persian digits.
   */
  test.each([
    [LOAD_BALANCERS, 0, "۰"],
    [LOAD_BALANCERS, 1, "۱"],
    [SHARES, 0, "۰"],
    [SHARES, 1, "۱"],
  ])(
    "Persian says %j at %d in its own words",
    (template: PluralTemplate, count: number, digits: string) => {
      const persian: Record<string, string> = readDashboardLocale("fa");
      const general: string = persian[template.other] as string;

      expect(general).not.toBe(template.other);
      expect(read("fa", template, count)).toBe(
        general.replace("{{count}}", digits),
      );
      expect(read("fa", template, count)).not.toMatch(/[A-Za-z]/);
    },
  );
});

describe("the one forms that were left in English (#7789)", () => {
  // Logs and Metrics draw the line once a scope has a service.
  test.each([
    ["da", 1, "1 af 1 tjeneste"],
    ["de", 1, "1 von 1 Dienst"],
    ["es", 1, "1 de 1 servicio"],
    ["fr", 1, "1 sur 1 service"],
    ["fr", 0, "0 sur 0 service"],
    ["hi", 1, "1 सेवा में से 1"],
    ["hi", 0, "0 सेवा में से 0"],
    ["it", 1, "1 su 1 servizio"],
    ["nl", 1, "1 van 1 service"],
    ["no", 1, "1 av 1 tjeneste"],
    ["pt", 1, "1 de 1 serviço"],
    ["pt", 0, "0 de 0 serviço"],
    ["ru", 1, "1 из 1 сервиса"],
    ["ru", 21, "21 из 21 сервиса"],
    ["sv", 1, "1 av 1 tjänst"],
  ])(
    "%s: services reporting, all %d of them, reads %s",
    (language: string, count: number, expected: string) => {
      expect(
        read(language, REPORTING, count, { reporting: String(count) }),
      ).toBe(expected);
    },
  );

  // "1 services sur 3" put the plural noun after the one that reported.
  test.each([
    ["fr", 3, "1 sur 3 services"],
    ["it", 3, "1 su 3 servizi"],
    ["de", 3, "1 von 3 Diensten"],
    ["ru", 22, "1 из 22 сервисов"],
  ])(
    "%s: one service reporting of %d reads %s",
    (language: string, count: number, expected: string) => {
      expect(read(language, REPORTING, count, { reporting: "1" })).toBe(
        expected,
      );
    },
  );

  test.each([
    ["de", BUGS, "Fehler"],
    ["de", FIXES, "Korrektur ausgeliefert"],
    ["es", BUGS, "error"],
    ["es", FIXES, "corrección publicada"],
  ])(
    "%s: under 1 on Exceptions, %j reads %s",
    (language: string, template: PluralTemplate, expected: string) => {
      expect(read(language, template, 1)).toBe(expected);
    },
  );

  test("Spanish and German keep their own general forms under 2", () => {
    expect(read("es", BUGS, 2)).toBe("errores");
    expect(read("es", FIXES, 2)).toBe("correcciones publicadas");
    expect(read("de", FIXES, 2)).toBe("Korrekturen ausgeliefert");
  });

  // The list draws twelve, and says so past them: shown is the count below 13.
  test.each([
    ["ru", 21, 12, "Показано 12 из 21."],
    ["ru", 1, 1, "Показано 1 из 1."],
    ["de", 1, 1, "1 von 1 wird angezeigt."],
    ["es", 1, 1, "Se muestra 1 de 1."],
    ["it", 1, 1, "Visualizzato 1 su 1."],
    ["fr", 1, 1, "1 affiché sur 1."],
    ["fr", 0, 0, "0 affiché sur 0."],
    ["pt", 0, 0, "Mostrando 0 de 0."],
    ["hi", 1, 1, "1 में से 1 दिखाया जा रहा है।"],
    ["nl", 1, 1, "1 van 1 weergegeven."],
    ["da", 1, 1, "Viser 1 af 1."],
    ["no", 1, 1, "Viser 1 av 1."],
    ["sv", 1, 1, "Visar 1 av 1."],
  ])(
    "%s: showing of %d reads, with %d shown, %s",
    (language: string, count: number, shown: number, expected: string) => {
      expect(read(language, SHOWING, count, { shown: String(shown) })).toBe(
        expected,
      );
    },
  );
});
