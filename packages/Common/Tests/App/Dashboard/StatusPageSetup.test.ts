import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  STATUS_PAGE_NAME_SENTENCE,
  STATUS_PAGE_SETUP,
  STATUS_PAGE_SETUP_COPY,
  STATUS_PAGE_SETUP_EXTRAS,
  STATUS_PAGE_SETUP_STEPS,
  NO_STATUS_PAGE_SETUP_FILTER,
  StatusPageSetupExtra,
  StatusPageSetupMonitor,
  StatusPageSetupMonitorGroup,
  StatusPageSetupStep,
  describeExtraPlan,
  describeShownMonitors,
  getDefaultStatusPageName,
  getExistingPagesLine,
  getLabelsOfList,
  getPickDoneLine,
  getPickedMonitorGroups,
  getPickedMonitors,
  getShownItems,
  getStartOverStatusPageName,
  getStatusPageNameIdentity,
  getStatusPageSetupProgress,
  isPickDone,
  isSameStatusPageName,
  isStatusPageNameValid,
  isStatusPageSetupFiltered,
  isStatusPageSetupFinished,
  matchesStatusPageSetupFilter,
  pickShownItems,
  togglePickedMonitor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import { WEBSITE_DOWN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { getFirstOpenStepKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { Translator, createTranslator } from "../../../Types/Translator";
import { getDefaultStatusPageName as getSharedDefaultStatusPageName } from "../../../Utils/GuidedSetup/StatusPageRecords";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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

  /*
   * #7247: Ask AI names a page the person did not name with the same
   * builder (Common/Utils/GuidedSetup/StatusPageRecords), with the server's
   * translator for the language the person reads the Dashboard in.
   */
  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "is the one name Ask AI starts a page with too, read in %s",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(
        getDefaultStatusPageName({
          translator: translator,
          projectName: "Acme",
        }),
      ).toBe(
        getSharedDefaultStatusPageName({
          translator: translator,
          projectName: "Acme",
        }),
      );
      expect(
        getDefaultStatusPageName({
          translator: translator,
          projectName: "Acme",
        }),
      ).toBe(
        translator.translateTemplate("{{project}} Status", { project: "Acme" }),
      );
    },
  );

  test("with no translator, the shared builder names it in English, and empty with no project's name", () => {
    expect(getSharedDefaultStatusPageName({ projectName: " Acme Corp " })).toBe(
      "Acme Corp Status",
    );
    expect(
      getSharedDefaultStatusPageName({
        translator: undefined,
        projectName: "Acme",
      }),
    ).toBe("Acme Status");
    expect(getSharedDefaultStatusPageName({ projectName: undefined })).toBe("");
    expect(getSharedDefaultStatusPageName({ projectName: "  " })).toBe("");
    expect(
      getSharedDefaultStatusPageName({
        translator: dashboardTranslator("de"),
        projectName: "Acme",
      }),
    ).toBe("Status von Acme");
  });

  test("needs two characters, as Create Status Page does, spaces not counted", () => {
    expect(isStatusPageNameValid("Ac")).toBe(true);
    expect(isStatusPageNameValid("A")).toBe(false);
    expect(isStatusPageNameValid(" A ")).toBe(false);
    expect(isStatusPageNameValid("")).toBe(false);
  });
});

/*
 * ONE NAME, HOWEVER IT IS TYPED (#7252): a run the browser lost - or a
 * second tab - that types a page's name again goes on with the page this
 * person made, so what counts as "the same name" decides whether a second
 * page appears.
 */
describe("one name, however it is typed (#7252)", () => {
  const ACUTE: string = String.fromCodePoint(0x0301);
  const NO_BREAK_SPACE: string = String.fromCodePoint(0x00a0);

  test.each([
    ["Acme Status", "Acme Status"],
    ["Acme Status", "acme status"],
    ["Acme Status", "ACME STATUS"],
    ["Acme Status", "  Acme Status  "],
    ["Acme Status", "Acme   Status"],
    ["Acme Status", "Acme\tStatus"],
    ["Acme Status", "\nAcme Status\n"],
    ["Acme Status", `Acme${NO_BREAK_SPACE}Status`],
    // An accent typed as one letter, or as a letter and a mark.
    ["Café Status", `Cafe${ACUTE} Status`],
    ["Statusseite Ärzte", "statusseite ärzte"],
    ["حالة أكمي", "  حالة   أكمي "],
    ["وضعیت اکمی", "وضعیت اکمی"],
  ])("%p and %p name one page", (first: string, second: string) => {
    expect(isSameStatusPageName(first, second)).toBe(true);
    expect(isSameStatusPageName(second, first)).toBe(true);
  });

  test.each([
    ["Acme Status", "Acme Status Page"],
    ["Acme Status", "Acme-Status"],
    ["Acme Status", "AcmeStatus"],
    ["Acme Status", "Acme Statuses"],
    ["Acme Status", "Status Acme"],
    ["Acme Status", "Acme Status."],
    ["Café Status", "Cafe Status"],
    ["حالة أكمي", "حالة اكمي"],
  ])("%p and %p are two pages", (first: string, second: string) => {
    expect(isSameStatusPageName(first, second)).toBe(false);
    expect(isSameStatusPageName(second, first)).toBe(false);
  });

  test("a name with no letters names no page, not even another empty one", () => {
    expect(isSameStatusPageName("", "")).toBe(false);
    expect(isSameStatusPageName("   ", "")).toBe(false);
    expect(isSameStatusPageName("\t", " ")).toBe(false);
    expect(isSameStatusPageName("", "Acme Status")).toBe(false);
  });

  test("the identity keeps the letters and their order, in small letters, one space between words", () => {
    expect(getStatusPageNameIdentity("  ACME \t Public   Status ")).toBe(
      "acme public status",
    );
    expect(getStatusPageNameIdentity("")).toBe("");
    expect(getStatusPageNameIdentity("   ")).toBe("");
  });

  test("a long run of spaces between two words is one space", () => {
    const name: string = `Acme${" ".repeat(200000)}Status`;

    expect(getStatusPageNameIdentity(name)).toBe("acme status");
    expect(isSameStatusPageName(name, "Acme Status")).toBe(true);
  });
});

describe("the name another status page starts with (#7252)", () => {
  test("is empty when the page just set up has the project's name: another page needs its own", () => {
    expect(
      getStartOverStatusPageName({
        defaultName: "Acme Status",
        finishedName: "Acme Status",
      }),
    ).toBe("");
    expect(
      getStartOverStatusPageName({
        defaultName: "Acme Status",
        finishedName: " acme  STATUS ",
      }),
    ).toBe("");
  });

  test("is the project's when the page just set up has a name of its own", () => {
    expect(
      getStartOverStatusPageName({
        defaultName: "Acme Status",
        finishedName: "Acme Public Status",
      }),
    ).toBe("Acme Status");
  });

  test("is the project's when no page was set up, and empty when the project's name is not known", () => {
    expect(
      getStartOverStatusPageName({
        defaultName: "Acme Status",
        finishedName: undefined,
      }),
    ).toBe("Acme Status");
    expect(
      getStartOverStatusPageName({ defaultName: "", finishedName: "" }),
    ).toBe("");
    expect(
      getStartOverStatusPageName({
        defaultName: "",
        finishedName: "Acme Status",
      }),
    ).toBe("");
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
    expect(pickShownItems({ picked: [], shown: MONITORS })).toEqual([
      "m-api",
      "m-web",
      "m-db",
    ]);
    expect(pickShownItems({ picked: [], shown: [] })).toEqual([]);
  });

  // #7147: what the list shows, after what was picked, never twice.
  test("Select all picks what is shown, keeping what was picked before and what the page shows already out", () => {
    expect(
      pickShownItems({
        picked: ["m-db"],
        shown: [MONITORS[0]!, MONITORS[2]!],
      }),
    ).toEqual(["m-db", "m-api"]);
    expect(
      pickShownItems({
        picked: [],
        shown: MONITORS,
        onThePage: ["m-web"],
      }),
    ).toEqual(["m-api", "m-db"]);
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

  // #7147: a monitor group is a row of the page, and no monitor.
  test("step 1's line says so once the page shows a monitor group", () => {
    expect(
      getPickDoneLine({
        translator: english,
        name: "Acme",
        monitorCount: 13,
        hasMonitorGroups: true,
      }),
    ).toBe('"Acme" shows 13 monitors and monitor groups.');
    expect(
      getPickDoneLine({
        translator: english,
        name: "Acme",
        monitorCount: 1,
        hasMonitorGroups: true,
      }),
    ).toBe('"Acme" shows 1 monitor group.');
    expect(
      getPickDoneLine({
        translator: english,
        name: "Acme",
        monitorCount: 2,
        hasMonitorGroups: false,
      }),
    ).toBe('"Acme" shows 2 monitors.');

    for (const language of ["ar", "fa", "de"]) {
      const line: string = getPickDoneLine({
        translator: dashboardTranslator(language),
        name: "Acme Status",
        monitorCount: 13,
        hasMonitorGroups: true,
      });

      expect({ language, english: line.includes("monitor groups") }).toEqual({
        language,
        english: false,
      });
      expect({
        language,
        setApart: line.includes(isolated("Acme Status")),
      }).toEqual({ language, setApart: language !== "de" });
    }
  });

  /*
   * In an Arabic or Persian sentence a name in Latin letters, and the count
   * after it, are set apart: without it the bidi algorithm pulled the 1 into
   * the name's run and drew it between the quotes and the name.
   */
  test("step 1's line sets the page's name apart in Arabic and Persian, and adds no marks in German", () => {
    for (const language of ["ar", "fa"]) {
      const line: string = getPickDoneLine({
        translator: dashboardTranslator(language),
        name: "Acme Status",
        monitorCount: 1,
      });

      expect({
        language,
        setApart: line.includes(isolated("Acme Status")),
      }).toEqual({ language, setApart: true });
    }

    // A sentence read from the left, as the name is, sets nothing apart.
    const german: string = getPickDoneLine({
      translator: dashboardTranslator("de"),
      name: "Acme Status",
      monitorCount: 2,
    });

    expect(german).toBe(withoutIsolateMarks(german));
    expect(german).toContain("Acme Status");
  });

  test("every sentence naming the page is filled setting its values apart, for the page and nothing else", () => {
    expect(STATUS_PAGE_NAME_SENTENCE).toEqual({ setsValuesApart: true });
    // A name that starts with a figure is set apart in a sentence read from the right.
    expect(
      dashboardTranslator("ar").translateTemplate(
        STATUS_PAGE_SETUP_COPY.summaryTitle,
        { name: "24/7 Status" },
        STATUS_PAGE_NAME_SENTENCE,
      ),
    ).toContain(isolated("24/7 Status"));
    // Negative control: without it, nothing is set apart.
    expect(
      dashboardTranslator("ar").translateTemplate(
        STATUS_PAGE_SETUP_COPY.summaryTitle,
        { name: "24/7 Status" },
      ),
    ).not.toContain(isolated("24/7 Status"));
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
    // A page that shows a monitor group (#7147).
    '"{{name}}" shows {{count}} monitors and monitor groups.',
    '"{{name}}" shows {{count}} monitors and monitor groups._one',
    // The project's pages, counted (#7517).
    "This project already has {{count}} status pages. The monitors you pick are added to the one you choose.",
    "This project already has {{count}} status pages. The monitors you pick are added to the one you choose._one",
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

/*
 * THE NOTE THAT A PAGE WAS FOUND (#7252), in every language: worded, the
 * page's name kept once, and quoted the way that language's website-down
 * note quotes a monitor's name - the two say the same kind of thing, a
 * step apart in the same product.
 */
describe("the note that the name is one of the reader's pages (#7252)", () => {
  const NOTE: string = STATUS_PAGE_SETUP_COPY.existingStatusPage;
  const SIBLING: string = WEBSITE_DOWN_COPY.existingMonitor;
  const NAME: string = "{{name}}";

  // The marks either side of the name, spaces aside: «» „“ 「」 "".
  const quotesAround: (text: string) => string = (text: string): string => {
    const at: number = text.indexOf(NAME);

    if (at === -1) {
      return "";
    }

    const before: string = text.slice(0, at).trimEnd();
    const after: string = text.slice(at + NAME.length).trimStart();

    return `${before.slice(-1)}${after.slice(0, 1)}`;
  };

  const problemsOf: (data: {
    language: string;
    note: string | undefined;
    sibling: string | undefined;
  }) => Array<string> = (data: {
    language: string;
    note: string | undefined;
    sibling: string | undefined;
  }): Array<string> => {
    const problems: Array<string> = [];

    if (!data.note || data.note === NOTE) {
      problems.push("not worded");
      return problems;
    }

    if (data.note.split(NAME).length !== 2) {
      problems.push("the name is not there exactly once");
    }

    if (quotesAround(data.note) !== quotesAround(data.sibling || "")) {
      problems.push(
        `quoted ${quotesAround(data.note)}, the monitor note ${quotesAround(
          data.sibling || "",
        )}`,
      );
    }

    return problems;
  };

  test("the English quotes the name and says no second page was made, in one sentence", () => {
    expect(NOTE).toBe(
      'You already have a status page named "{{name}}", so no new one was made.',
    );
    expect(quotesAround(NOTE)).toBe('""');
    expect(quotesAround(SIBLING)).toBe('""');
  });

  test("is worded in every Dashboard language, the name kept once and quoted as the monitor note quotes it", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const language of DASHBOARD_LANGUAGES) {
      const table: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        worded: isWordedInDashboardLocale(NOTE, language),
      }).toEqual({ language, worded: true });
      expect({
        language,
        problems: problemsOf({
          language,
          note: table[NOTE],
          sibling: table[SIBLING],
        }),
      }).toEqual({ language, problems: [] });
    }
  });

  test("reads, filled, with the page's name and none of the English", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const sentence: string = withoutIsolateMarks(
        dashboardTranslator(language).translateTemplate(NOTE, {
          name: "Acme Status",
        }),
      );

      expect({ language, named: sentence.includes("Acme Status") }).toEqual({
        language,
        named: true,
      });
      expect({
        language,
        english: sentence.includes("no new one was made"),
      }).toEqual({ language, english: false });
    }
  });

  test("negative control: the English left in, a name lost or quoted another way is caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(
      problemsOf({ language: "de", note: NOTE, sibling: german[SIBLING] }),
    ).toEqual(["not worded"]);
    expect(
      problemsOf({
        language: "de",
        note: german[NOTE]!.split(NAME).join("Acme"),
        sibling: german[SIBLING],
      }),
    ).toContain("the name is not there exactly once");
    expect(
      problemsOf({
        language: "de",
        note: `Sie haben bereits eine Statusseite namens "${NAME}".`,
        sibling: german[SIBLING],
      }),
    ).toEqual([expect.stringMatching(/^quoted ""/)]);
  });
});

/*
 * A BUSY PROJECT'S LIST (#7147): what the search and the label show, the
 * labels to pick from, and the monitor groups picked.
 */
describe("what the list shows (#7147)", () => {
  const PRODUCTION: { id: string; name: string } = {
    id: "label-prod",
    name: "production",
  };
  const STAGING: { id: string; name: string; color: string } = {
    id: "label-staging",
    name: "Staging",
    color: "#f59e0b",
  };
  const ITEMS: Array<StatusPageSetupMonitor> = [
    { id: "a", name: "Checkout API", labels: [PRODUCTION] },
    { id: "b", name: "checkout   web", labels: [STAGING] },
    { id: "c", name: "Café Status" },
  ];

  test("nothing typed and no label: everything, and nothing to say it is narrowed", () => {
    expect(
      getShownItems({ items: ITEMS, filter: NO_STATUS_PAGE_SETUP_FILTER }),
    ).toEqual(ITEMS);
    expect(isStatusPageSetupFiltered(NO_STATUS_PAGE_SETUP_FILTER)).toBe(false);
    expect(isStatusPageSetupFiltered({ search: "   ", labelId: null })).toBe(
      false,
    );
  });

  test("the search finds a name in any case, however its spaces run, and accents composed or not", () => {
    const names: (search: string) => Array<string> = (
      search: string,
    ): Array<string> => {
      return getShownItems({
        items: ITEMS,
        filter: { search: search, labelId: null },
      }).map((item: StatusPageSetupMonitor): string => {
        return item.id;
      });
    };

    expect(names("CHECKOUT")).toEqual(["a", "b"]);
    expect(names("  checkout web ")).toEqual(["b"]);
    // "é" typed decomposed finds the composed name.
    expect(names("café")).toEqual(["c"]);
    expect(names("payments")).toEqual([]);
    expect(isStatusPageSetupFiltered({ search: "x", labelId: null })).toBe(
      true,
    );
  });

  test("a label shows what carries it; with a search, what carries it and matches", () => {
    expect(
      getShownItems({
        items: ITEMS,
        filter: { search: "", labelId: STAGING.id },
      }),
    ).toEqual([ITEMS[1]]);
    expect(
      matchesStatusPageSetupFilter({
        item: ITEMS[0]!,
        filter: { search: "api", labelId: STAGING.id },
      }),
    ).toBe(false);
    expect(
      matchesStatusPageSetupFilter({
        item: ITEMS[2]!,
        filter: { search: "", labelId: PRODUCTION.id },
      }),
    ).toBe(false);
    expect(isStatusPageSetupFiltered({ search: "", labelId: "x" })).toBe(true);
  });

  test("the labels to pick from: each carried by a monitor or a group, once, by name", () => {
    const groups: Array<StatusPageSetupMonitorGroup> = [
      { id: "g", name: "Checkout", labels: [PRODUCTION, { id: "", name: "" }] },
    ];

    expect(getLabelsOfList({ monitors: ITEMS, monitorGroups: groups })).toEqual(
      [PRODUCTION, STAGING],
    );
    expect(
      getLabelsOfList({ monitors: [ITEMS[2]!], monitorGroups: [] }),
    ).toEqual([]);
  });

  test("the groups picked, in the list's order", () => {
    const groups: Array<StatusPageSetupMonitorGroup> = [
      { id: "g1", name: "Checkout" },
      { id: "g2", name: "Search" },
    ];

    expect(
      getPickedMonitorGroups({ monitorGroups: groups, picked: ["g2", "g1"] }),
    ).toEqual(groups);
    expect(
      getPickedMonitorGroups({ monitorGroups: groups, picked: ["gone"] }),
    ).toEqual([]);
  });
});

/*
 * THE PROJECT'S PAGES, OFFERED (#7517): one page named, set apart in its
 * sentence as every line naming a page is; several counted.
 */
describe("the project's pages, offered first (#7517)", () => {
  test("one page is named, set apart, in the reader's language", () => {
    expect(
      getExistingPagesLine({
        translator: english,
        pages: [{ id: "1", name: "Walk Co Status" }],
      }),
    ).toBe(
      'This project already has a status page, "Walk Co Status". The monitors you pick are added to it.',
    );

    for (const language of ["ar", "fa"]) {
      const line: string = getExistingPagesLine({
        translator: dashboardTranslator(language),
        pages: [{ id: "1", name: "24/7 Status" }],
      });

      expect({
        language,
        setApart: line.includes(isolated("24/7 Status")),
      }).toEqual({ language, setApart: true });
      expect(withoutIsolateMarks(line)).toBe(
        readDashboardLocale(language)[
          STATUS_PAGE_SETUP_COPY.existingPageOne
        ]!.replace("{{name}}", "24/7 Status"),
      );
    }
  });

  test("several are counted, in the reader's digits", () => {
    const pages: Array<{ id: string; name: string }> = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
      { id: "3", name: "C" },
    ];

    expect(getExistingPagesLine({ translator: english, pages })).toBe(
      "This project already has 3 status pages. The monitors you pick are added to the one you choose.",
    );
    expect(
      getExistingPagesLine({ translator: dashboardTranslator("fa"), pages }),
    ).toContain("۳");
    expect(
      getExistingPagesLine({ translator: dashboardTranslator("de"), pages }),
    ).not.toContain("status pages");
  });
});
