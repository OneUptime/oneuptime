import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  STATUS_PAGE_SETUP,
  STATUS_PAGE_SETUP_COPY,
  STATUS_PAGE_SETUP_EXTRAS,
  STATUS_PAGE_SETUP_STEPS,
  StatusPageSetupExtra,
  StatusPageSetupMonitor,
  StatusPageSetupStep,
  describeExtraPlan,
  describeShownMonitors,
  getDefaultStatusPageName,
  getPickDoneLine,
  getPickedMonitors,
  getStatusPageSetupProgress,
  isPickDone,
  isStatusPageNameValid,
  isStatusPageSetupFinished,
  pickAllMonitors,
  togglePickedMonitor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import { getFirstOpenStepKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * The status page guided setup's rules and words (issue #6806): the name
 * it starts with, which monitors are picked (none, until someone picks), a
 * page that is never done while it shows nothing, the summary's lines and
 * the plan each optional setting needs on Cloud.
 */

const english: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const MONITORS: Array<StatusPageSetupMonitor> = [
  { id: "m-api", name: "API" },
  { id: "m-web", name: "Website" },
  { id: "m-db", name: "Database" },
];

describe("the setup", () => {
  test("is named status_page in its events, with two steps: pick, then review", () => {
    expect(STATUS_PAGE_SETUP).toBe("status_page");
    expect(STATUS_PAGE_SETUP_STEPS).toEqual(["pick", "review"]);
  });
});

describe("the name", () => {
  test("starts as the project's, so a new project's owner can keep it", () => {
    expect(
      getDefaultStatusPageName({ translator: english, projectName: "Acme" }),
    ).toBe("Acme Status");
    expect(
      getDefaultStatusPageName({
        translator: english,
        projectName: "  Acme Corp  ",
      }),
    ).toBe("Acme Corp Status");
  });

  test("starts empty when the project's name is not known", () => {
    expect(
      getDefaultStatusPageName({ translator: english, projectName: undefined }),
    ).toBe("");
    expect(
      getDefaultStatusPageName({ translator: english, projectName: "   " }),
    ).toBe("");
  });

  test("needs two characters, as Create Status Page does, spaces not counted", () => {
    expect(isStatusPageNameValid("Ac")).toBe(true);
    expect(isStatusPageNameValid("A")).toBe(false);
    expect(isStatusPageNameValid(" A ")).toBe(false);
    expect(isStatusPageNameValid("")).toBe(false);
  });
});

describe("the monitors picked", () => {
  test("a tick adds a monitor, a second takes it away", () => {
    const once: Array<string> = togglePickedMonitor({
      picked: [],
      monitorId: "m-web",
    });
    expect(once).toEqual(["m-web"]);
    expect(togglePickedMonitor({ picked: once, monitorId: "m-web" })).toEqual(
      [],
    );
    expect(togglePickedMonitor({ picked: once, monitorId: "m-api" })).toEqual([
      "m-web",
      "m-api",
    ]);
  });

  test("Select all picks every monitor listed", () => {
    expect(pickAllMonitors(MONITORS)).toEqual(["m-api", "m-web", "m-db"]);
    expect(pickAllMonitors([])).toEqual([]);
  });

  test("are put on the page in the order the list shows them, whatever order they were ticked in", () => {
    expect(
      getPickedMonitors({ monitors: MONITORS, picked: ["m-db", "m-api"] }),
    ).toEqual([MONITORS[0], MONITORS[2]]);
  });

  test("a pick of a monitor no longer listed is dropped", () => {
    expect(
      getPickedMonitors({ monitors: MONITORS, picked: ["m-gone"] }),
    ).toEqual([]);
  });
});

describe("which step is done", () => {
  test("nothing is done before the page exists", () => {
    const facts: Parameters<typeof getStatusPageSetupProgress>[0] = {
      hasStatusPage: false,
      monitorCount: 0,
      isReviewed: false,
    };

    expect(getStatusPageSetupProgress(facts)).toEqual([
      { key: StatusPageSetupStep.Pick, isDone: false },
      { key: StatusPageSetupStep.Review, isDone: false },
    ]);
    expect(getFirstOpenStepKey(getStatusPageSetupProgress(facts))).toBe("pick");
  });

  test("a page that shows nothing is not done: the setup never finishes with an empty page", () => {
    const facts: Parameters<typeof getStatusPageSetupProgress>[0] = {
      hasStatusPage: true,
      monitorCount: 0,
      isReviewed: true,
    };

    expect(isPickDone(facts)).toBe(false);
    expect(getStatusPageSetupProgress(facts)[1]!.isDone).toBe(false);
    expect(isStatusPageSetupFinished(facts)).toBe(false);
    expect(getFirstOpenStepKey(getStatusPageSetupProgress(facts))).toBe("pick");
  });

  test("a page that shows a monitor opens the review next", () => {
    const facts: Parameters<typeof getStatusPageSetupProgress>[0] = {
      hasStatusPage: true,
      monitorCount: 2,
      isReviewed: false,
    };

    expect(isPickDone(facts)).toBe(true);
    expect(getFirstOpenStepKey(getStatusPageSetupProgress(facts))).toBe(
      "review",
    );
    expect(isStatusPageSetupFinished(facts)).toBe(false);
  });

  test("once reviewed, the summary is shown and the setup is finished", () => {
    const facts: Parameters<typeof getStatusPageSetupProgress>[0] = {
      hasStatusPage: true,
      monitorCount: 1,
      isReviewed: true,
    };

    expect(getFirstOpenStepKey(getStatusPageSetupProgress(facts))).toBeNull();
    expect(isStatusPageSetupFinished(facts)).toBe(true);
  });

  test("a review kept in the browser counts only with a page that exists", () => {
    expect(
      isStatusPageSetupFinished({
        hasStatusPage: false,
        monitorCount: 3,
        isReviewed: true,
      }),
    ).toBe(false);
  });
});

describe("the summary's lines", () => {
  test("step 1's line counts the monitors the page shows", () => {
    expect(
      getPickDoneLine({ translator: english, name: "Acme", monitorCount: 1 }),
    ).toBe('"Acme" shows 1 monitor.');
    expect(
      getPickDoneLine({ translator: english, name: "Acme", monitorCount: 3 }),
    ).toBe('"Acme" shows 3 monitors.');
  });

  test("what it shows lists up to five names, then how many more", () => {
    expect(
      describeShownMonitors({
        translator: english,
        names: ["API", "Website"],
        monitorCount: 2,
      }),
    ).toBe("API, Website");

    expect(
      describeShownMonitors({
        translator: english,
        names: ["A", "B", "C", "D", "E", "F", "G"],
        monitorCount: 7,
      }),
    ).toBe("A, B, C, D, E and 2 more");
  });

  test("a count the names do not reach is said as more, and no names as a count", () => {
    expect(
      describeShownMonitors({
        translator: english,
        names: ["API"],
        monitorCount: 3,
      }),
    ).toBe("API and 2 more");
    expect(
      describeShownMonitors({
        translator: english,
        names: [],
        monitorCount: 4,
      }),
    ).toBe("4 monitors");
  });
});

describe("the optional settings", () => {
  const extra: (key: string) => StatusPageSetupExtra = (
    key: string,
  ): StatusPageSetupExtra => {
    return STATUS_PAGE_SETUP_EXTRAS.find((candidate: StatusPageSetupExtra) => {
      return candidate.key === key;
    })!;
  };

  test("are the four the issue names, each opening the real setting of this page", () => {
    expect(
      STATUS_PAGE_SETUP_EXTRAS.map((candidate: StatusPageSetupExtra) => {
        return [candidate.key, candidate.page];
      }),
    ).toEqual([
      ["domain", PageMap.STATUS_PAGE_VIEW_DOMAINS],
      ["branding", PageMap.STATUS_PAGE_VIEW_BRANDING],
      ["subscribers", PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS],
      ["private", PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS],
    ]);
  });

  test("on Cloud, each says the plan it needs, as the columns' own plan gates say", () => {
    const plan: (key: string) => string | null = (key: string) => {
      return describeExtraPlan({
        translator: english,
        extra: extra(key),
        isBillingEnabled: true,
      });
    };

    expect(plan("domain")).toBe("Every plan");
    expect(plan("branding")).toBe("Every plan");
    expect(plan("subscribers")).toBe(
      "Email on every plan, SMS from Growth, the rest from Scale",
    );
    expect(plan("private")).toBe("Growth plan and above");
    expect(extra("private").plan).toBe(PlanType.Growth);
  });

  test("off Cloud, no plan is said: a self-hosted server has none", () => {
    for (const candidate of STATUS_PAGE_SETUP_EXTRAS) {
      expect(
        describeExtraPlan({
          translator: english,
          extra: candidate,
          isBillingEnabled: false,
        }),
      ).toBeNull();
    }
  });

  test("a plan named Free reads as every plan", () => {
    expect(
      describeExtraPlan({
        translator: english,
        extra: { ...extra("private"), plan: PlanType.Free },
        isBillingEnabled: true,
      }),
    ).toBe("Every plan");
  });

  test("the descriptions name no plan, so a self-hosted reader is not told about one", () => {
    for (const candidate of STATUS_PAGE_SETUP_EXTRAS) {
      expect(candidate.description).not.toMatch(/Growth|Scale|plan/);
    }
  });
});

describe("the words", () => {
  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string) => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string) => {
      return file.replace(/\.json$/, "");
    });

  const words: Array<string> = [
    ...Object.values(STATUS_PAGE_SETUP_COPY),
    ...STATUS_PAGE_SETUP_EXTRAS.flatMap((candidate: StatusPageSetupExtra) => {
      return [candidate.title, candidate.description, candidate.cloudNote];
    }),
    "{{project}} Status",
    "Every plan",
    "{{plan}} plan and above",
    '"{{name}}" shows {{count}} monitors.',
    '"{{name}}" shows {{count}} monitors._one',
    "{{count}} of {{total}} picked",
  ].filter((word: string | undefined): word is string => {
    return Boolean(word);
  });

  test("are in en.json", () => {
    const table: Record<string, string> = readLocale("en");

    for (const word of words) {
      expect({ word, isKnown: word in table }).toEqual({
        word,
        isKnown: true,
      });
    }
  });

  test("and are translated in every language, keeping their placeholders", () => {
    expect(languages.length).toBe(17);

    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);

      for (const word of words) {
        const value: string | undefined = table[word];
        expect({ language, word, hasValue: Boolean(value) }).toEqual({
          language,
          word,
          hasValue: true,
        });

        if (word !== STATUS_PAGE_SETUP_COPY.namePlaceholder) {
          expect({ language, word, isTranslated: value !== word }).toEqual({
            language,
            word,
            isTranslated: true,
          });
        }

        const english: string = word.replace(/_one$/, "");
        const placeholders: Array<string> = english.match(/{{\w+}}/g) || [];

        for (const placeholder of placeholders) {
          if (word.endsWith("_one") && placeholder === "{{count}}") {
            // A language's "one" form may say the number in words.
            continue;
          }

          expect({
            language,
            word,
            placeholder,
            kept: value!.includes(placeholder),
          }).toEqual({
            language,
            word,
            placeholder,
            kept: true,
          });
        }
      }
    }
  });
});
