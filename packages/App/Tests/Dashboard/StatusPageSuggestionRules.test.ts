import {
  ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT,
  ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT,
  ADD_ALL_SUGGESTED_STATUS_PAGES,
  ADD_SUGGESTED_STATUS_PAGE_LABEL,
  STATUS_PAGE_SUGGESTIONS_LABEL,
  StatusPageSuggestionsQuestion,
  UNTITLED_STATUS_PAGE,
  addStatusPagesToFormValue,
  getMonitorIdsFromFormValue,
  getStatusPageSuggestionsQuestion,
  getStatusPageSuggestionsRequestBodies,
  getStatusPagesToSuggest,
  isStillShowingTheMonitors,
  mergeStatusPagesListingMonitors,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSuggestionRules";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
} from "Common/Types/StatusPage/StatusPagesListingMonitors";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Suggesting the status pages that show the affected monitors, under the
 * status page picker of a scheduled maintenance event or an announcement
 * (Components/StatusPage/StatusPageSuggestionRules): which monitors a form
 * value names, what is asked, what is suggested, what an add leaves in the
 * picker - and that every word of it is translated. The component is drawn
 * for real in Common's Tests/App/Dashboard/StatusPageSuggestions.test.tsx.
 */

const MONITOR_A: string = "c0000000-0000-4000-8000-000000000001";
const MONITOR_B: string = "c0000000-0000-4000-8000-000000000002";
const PAGE_A: string = "b0000000-0000-4000-8000-000000000001";
const PAGE_B: string = "b0000000-0000-4000-8000-000000000002";
const PAGE_C: string = "b0000000-0000-4000-8000-000000000003";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Languages without a "one" form never show a _one key: it may stay English.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LISTING: Array<StatusPageListingMonitors> = [
  { statusPageId: PAGE_A, name: "Acme Public" },
  { statusPageId: PAGE_B, name: "EU Status" },
  { statusPageId: PAGE_C, name: "Internal" },
];

describe("getMonitorIdsFromFormValue", () => {
  test("reads the monitors in every shape a form holds them", () => {
    // Bare ids (the affected resources picker).
    expect(getMonitorIdsFromFormValue([MONITOR_A, MONITOR_B])).toEqual([
      MONITOR_A,
      MONITOR_B,
    ]);
    // {_id, name} objects (a template's monitors, not yet touched).
    expect(
      getMonitorIdsFromFormValue([
        { _id: MONITOR_A, name: "API" },
        { _id: MONITOR_B, name: "Database" },
      ]),
    ).toEqual([MONITOR_A, MONITOR_B]);
    // ObjectIDs, and upper-case ids, once each.
    expect(
      getMonitorIdsFromFormValue([
        new ObjectID(MONITOR_A),
        MONITOR_A.toUpperCase(),
        MONITOR_B,
      ]),
    ).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("reads the affected resources picker's whole payload, for the moment before the form splits it", () => {
    expect(
      getMonitorIdsFromFormValue({
        __affectedResourcesPayload: true,
        monitors: [MONITOR_B],
        hosts: ["d0000000-0000-4000-8000-000000000001"],
      }),
    ).toEqual([MONITOR_B]);
    expect(
      getMonitorIdsFromFormValue({
        __affectedResourcesPayload: true,
        monitors: undefined,
      }),
    ).toEqual([]);
  });

  test("no monitors is none", () => {
    for (const value of [undefined, null, "", [], {}]) {
      expect(getMonitorIdsFromFormValue(value)).toEqual([]);
    }
  });
});

function question(
  monitorIds: Array<string>,
  eventType: StatusPageEventType = StatusPageEventType.ScheduledEvent,
): StatusPageSuggestionsQuestion {
  return getStatusPageSuggestionsQuestion({
    monitorIds: monitorIds,
    eventType: eventType,
  })!;
}

describe("getStatusPageSuggestionsQuestion", () => {
  test("asks nothing without a monitor", () => {
    expect(getStatusPageSuggestionsQuestion(null)).toBeNull();

    for (const monitorIds of [undefined, null, [], ""]) {
      expect(
        getStatusPageSuggestionsQuestion({
          monitorIds: monitorIds,
          eventType: StatusPageEventType.ScheduledEvent,
        }),
      ).toBeNull();
    }
  });

  test("names the monitors sorted, so the question is the request's key, and the kind of event", () => {
    const asked: StatusPageSuggestionsQuestion | null =
      getStatusPageSuggestionsQuestion({
        monitorIds: [{ _id: MONITOR_B }, MONITOR_A.toUpperCase()],
        eventType: StatusPageEventType.Announcement,
      });

    expect(asked).toEqual({
      monitorIds: [MONITOR_A, MONITOR_B],
      eventType: StatusPageEventType.Announcement,
    });
    expect(
      getStatusPageSuggestionsQuestion({
        monitorIds: [MONITOR_A, MONITOR_B],
        eventType: StatusPageEventType.Announcement,
      }),
    ).toEqual(asked);
  });
});

describe("getStatusPageSuggestionsRequestBodies", () => {
  test("one request names the monitors and the kind of event", () => {
    expect(
      getStatusPageSuggestionsRequestBodies(
        question([MONITOR_B, MONITOR_A], StatusPageEventType.Announcement),
      ),
    ).toEqual([
      {
        monitorIds: [MONITOR_A, MONITOR_B],
        eventType: StatusPageEventType.Announcement,
      },
    ]);
  });

  test("more monitors than one request may name are asked about in several, none left out", () => {
    const monitorIds: Array<string> = Array.from(
      { length: StatusPagesListingMonitors.maxIdsPerRequest * 2 + 25 },
      (_value: unknown, index: number): string => {
        return `c0000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    const bodies: Array<JSONObject> = getStatusPageSuggestionsRequestBodies(
      question(monitorIds),
    );

    expect(
      bodies.map((body: JSONObject): number => {
        return (body["monitorIds"] as Array<string>).length;
      }),
    ).toEqual([
      StatusPagesListingMonitors.maxIdsPerRequest,
      StatusPagesListingMonitors.maxIdsPerRequest,
      25,
    ]);
    expect(
      bodies.flatMap((body: JSONObject): Array<string> => {
        return body["monitorIds"] as Array<string>;
      }),
    ).toEqual([...monitorIds].sort());
    expect(
      bodies.every((body: JSONObject): boolean => {
        return body["eventType"] === StatusPageEventType.ScheduledEvent;
      }),
    ).toBe(true);
  });
});

describe("mergeStatusPagesListingMonitors", () => {
  test("names each page once, as the first answer named it", () => {
    expect(
      mergeStatusPagesListingMonitors([
        [LISTING[0]!, LISTING[1]!],
        [{ statusPageId: PAGE_B.toUpperCase(), name: "EU again" }, LISTING[2]!],
        [],
      ]),
    ).toEqual(LISTING);
  });
});

describe("isStillShowingTheMonitors", () => {
  test("monitors only added: the pages already named still show one of them", () => {
    expect(
      isStillShowingTheMonitors({
        before: question([MONITOR_A]),
        after: question([MONITOR_A, MONITOR_B]),
      }),
    ).toBe(true);
  });

  test("a monitor taken away, or another kind of event: the last answer is not kept", () => {
    expect(
      isStillShowingTheMonitors({
        before: question([MONITOR_A, MONITOR_B]),
        after: question([MONITOR_B]),
      }),
    ).toBe(false);
    expect(
      isStillShowingTheMonitors({
        before: question([MONITOR_A], StatusPageEventType.ScheduledEvent),
        after: question([MONITOR_A], StatusPageEventType.Announcement),
      }),
    ).toBe(false);
  });
});

describe("getStatusPagesToSuggest", () => {
  test("suggests every page that shows the monitors while none is picked", () => {
    expect(getStatusPagesToSuggest({ listing: LISTING, picked: [] })).toEqual(
      LISTING,
    );
    expect(
      getStatusPagesToSuggest({ listing: LISTING, picked: undefined }),
    ).toEqual(LISTING);
  });

  test("leaves out the pages already picked, in whatever shape the picker holds them", () => {
    expect(
      getStatusPagesToSuggest({
        listing: LISTING,
        picked: [PAGE_A.toUpperCase(), { _id: PAGE_C }],
      }),
    ).toEqual([{ statusPageId: PAGE_B, name: "EU Status" }]);
    expect(
      getStatusPagesToSuggest({
        listing: LISTING,
        picked: [{ value: PAGE_B, label: "EU Status" }],
      }),
    ).toEqual([
      { statusPageId: PAGE_A, name: "Acme Public" },
      { statusPageId: PAGE_C, name: "Internal" },
    ]);
  });

  test("with every page picked, there is nothing to suggest", () => {
    expect(
      getStatusPagesToSuggest({
        listing: LISTING,
        picked: [PAGE_C, PAGE_B, PAGE_A],
      }),
    ).toEqual([]);
  });

  test("orders the pages by name the reader's way, numbers as numbers, a page without a name last", () => {
    const listing: Array<StatusPageListingMonitors> = [
      { statusPageId: "1", name: "" },
      { statusPageId: "2", name: "Site 10" },
      { statusPageId: "3", name: "site 2" },
      { statusPageId: "4", name: "Öresund" },
      { statusPageId: "5", name: "Zürich" },
    ];

    const order: (language: string | undefined) => Array<string> = (
      language: string | undefined,
    ): Array<string> => {
      return getStatusPagesToSuggest({
        listing: listing,
        picked: [],
        language: language,
      }).map((statusPage: StatusPageListingMonitors): string => {
        return statusPage.name;
      });
    };

    // English and German read Ö as O.
    expect(order("en")).toEqual(["Öresund", "site 2", "Site 10", "Zürich", ""]);
    expect(order("de")).toEqual(["Öresund", "site 2", "Site 10", "Zürich", ""]);
    // Swedish puts Ö at the end of its alphabet.
    expect(order("sv")).toEqual(["site 2", "Site 10", "Zürich", "Öresund", ""]);
    // No language, or one the browser does not know, reads as English.
    expect(order(undefined)).toEqual(order("en"));
    expect(order("not a language")).toEqual(order("en"));
  });
});

describe("addStatusPagesToFormValue", () => {
  test("adds the pages after those already picked, as ids", () => {
    expect(
      addStatusPagesToFormValue({
        picked: [PAGE_C],
        statusPageIds: [PAGE_A, PAGE_B],
      }),
    ).toEqual([PAGE_C, PAGE_A, PAGE_B]);
  });

  test("keeps a page once, and reads the picker in whatever shape it is held", () => {
    expect(
      addStatusPagesToFormValue({
        picked: [{ _id: PAGE_A }, new ObjectID(PAGE_C)],
        statusPageIds: [PAGE_A.toUpperCase(), PAGE_B, PAGE_B],
      }),
    ).toEqual([PAGE_A, PAGE_C, PAGE_B]);
  });

  test("an empty picker gets just the added pages", () => {
    for (const picked of [undefined, null, [], ""]) {
      expect(
        addStatusPagesToFormValue({ picked: picked, statusPageIds: [PAGE_B] }),
      ).toEqual([PAGE_B]);
    }
  });
});

describe("the dashboard asks the route the server answers, with the tenant header", () => {
  test("the hook's route is StatusPagesListingMonitors.apiPath", () => {
    const hook: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "useStatusPagesListingMonitors.ts",
      ),
      "utf8",
    );

    expect(hook).toContain(
      `.addRoute(\n        "${StatusPagesListingMonitors.apiPath}",\n      )`,
    );
    expect(hook).toContain("headers: ModelAPI.getCommonHeaders(),");
  });
});

describe("the suggestions' words", () => {
  const SENTENCES: Array<string> = [
    UNTITLED_STATUS_PAGE,
    ADD_ALL_SUGGESTED_STATUS_PAGES,
    ADD_SUGGESTED_STATUS_PAGE_LABEL,
    ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT,
    ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT.other,
    STATUS_PAGE_SUGGESTIONS_LABEL.other,
  ];

  const PLURALS: Array<{ one: string; other: string }> = [
    ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT,
    STATUS_PAGE_SUGGESTIONS_LABEL,
  ];

  test("say what they mean in English", () => {
    expect(STATUS_PAGE_SUGGESTIONS_LABEL).toEqual({
      one: "Status pages that show the affected monitor:",
      other: "Status pages that show the affected monitors:",
    });
    expect(ADD_SUGGESTED_STATUS_PAGE_LABEL).toBe("Add {{statusPageName}}");
    expect(ADD_ALL_SUGGESTED_STATUS_PAGES).toBe("Add all");
    expect(ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT).toBe(
      "Added {{statusPageName}} to the status pages.",
    );
    expect(ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT).toEqual({
      one: "Added {{count}} status page.",
      other: "Added {{count}} status pages.",
    });
    expect(UNTITLED_STATUS_PAGE).toBe("Untitled status page");
  });

  test("are in en.json, each plural with its one form", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect(english[sentence]).toBe(sentence);
    }

    for (const plural of PLURALS) {
      expect(english[`${plural.other}_one`]).toBe(plural.one);
    }
  });

  test("are translated in every other locale, placeholders kept", () => {
    for (const locale of OTHER_LOCALES) {
      const translations: Record<string, string> = readLocale(locale);

      const keys: Array<string> = [
        ...SENTENCES,
        ...(NO_ONE_FORM.includes(locale)
          ? []
          : PLURALS.map((plural: { other: string }): string => {
              return `${plural.other}_one`;
            })),
      ];

      for (const key of keys) {
        const translation: string | undefined = translations[key];
        const english: string = key.endsWith("_one")
          ? PLURALS.find((plural: { other: string }): boolean => {
              return `${plural.other}_one` === key;
            })!.one
          : key;

        expect(`${locale} ${key}: ${Boolean(translation)}`).toBe(
          `${locale} ${key}: true`,
        );
        expect(`${locale} ${key}: ${translation !== english}`).toBe(
          `${locale} ${key}: true`,
        );

        for (const placeholder of english.match(/\{\{\w+\}\}/g) || []) {
          expect(
            `${locale} ${key}: ${translation!.includes(placeholder)}`,
          ).toBe(`${locale} ${key}: true`);
        }
      }
    }
  });
});
