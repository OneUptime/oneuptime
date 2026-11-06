import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getStoryMock: MockFunction = getJestMockFunction();
const getImpactMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextApi",
  () => {
    return {
      __esModule: true,
      default: {
        getStory: (...args: Array<unknown>) => {
          return getStoryMock(...args);
        },
        getImpact: (...args: Array<unknown>) => {
          return getImpactMock(...args);
        },
      },
    };
  },
);

import ObjectID from "../../../Types/ObjectID";
import {
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactJson,
  SecurityCaseImpactSource,
  SecurityCaseInternetExposure,
  SecurityCaseStoryFilter,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "../../../Types/SecurityCase/SecurityConnection";
import { PluralTemplate } from "../../../Types/Translator";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import OneUptimeDate from "../../../Types/Date";
import ProjectUtil from "../../../UI/Utils/Project";
import { ChangeEventType } from "../../../Utils/Telemetry/ChangeEventFields";
import {
  CloudHealthSource,
  CloudHealthTitleFacts,
} from "../../../Utils/Telemetry/CloudChangeTitle";
import * as Copy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextCopy";
import SecurityCaseImpactCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseImpactCard";
import SecurityCaseStory, {
  getStoryItemStateLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseStory";
import { CHANGE_EVENT_MARKER_SUBTITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import russianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ru.json";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A SECURITY CASE'S STORY AND IMPACT IN THE READER'S LANGUAGE (#6149's
 * follow-up).
 *
 * The two cards had about fifty sentences that were English in fifteen
 * languages - "Last change" and the sentence under it among them - so a
 * health event's title #6149 worded in German sat inside an English
 * sentence. Every word the two cards draw is a key every language words
 * now. Two English labels changed to say one thing in every language: the
 * story's "Response" filter ("Response activity": "Response" alone is the
 * Dashboard's word for an HTTP response's answer) and a change's kind
 * label ("Change event": "Change" alone is the button verb "Ändern"). A
 * change's pill names its kind ("Config change"), not its stored code.
 *
 * Read right to left, a name, an address or a time in Latin letters is
 * set apart in its sentence, and the last change's title reads the
 * reader's way.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6c";
const CASE_ID: string = "20000000-0000-4000-8000-000000000214";
const RESOURCE_ID: string = "30000000-0000-4000-8000-000000000072";
const MONITOR_ID: string = "40000000-0000-4000-8000-000000000073";

const HEALTH_FACTS: CloudHealthTitleFacts = {
  source: CloudHealthSource.Aws,
  event: "EC2 operational issue",
  status: "open",
  awsEventTypeCode: "AWS_EC2_OPERATIONAL_ISSUE",
};

const GERMAN_HEALTH_TITLE: string = "AWS Health: EC2-Betriebsstörung (offen)";

const LANGUAGES: Record<string, Record<string, unknown>> = {
  en: englishLocale,
  de: germanLocale,
  fa: persianLocale,
  ru: russianLocale,
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of Object.entries(LANGUAGES)) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  getStoryMock.mockReset();
  getImpactMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

// ---------- The words ----------

// Every English sentence and plural the two cards' words module exports.
function copyKeys(): Array<{ name: string; key: string; one?: string }> {
  const keys: Array<{ name: string; key: string; one?: string }> = [];
  // Icons and test ids are not words.
  const notWords: Array<string> = [
    "STORY_KIND_ICONS",
    "SECURITY_CASE_CONTEXT_TEST_IDS",
  ];

  for (const [name, value] of Object.entries(Copy)) {
    if (notWords.includes(name)) {
      continue;
    }

    if (typeof value === "string") {
      keys.push({ name, key: value });
      continue;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    if (
      typeof record["one"] === "string" &&
      typeof record["other"] === "string"
    ) {
      const plural: PluralTemplate = value as PluralTemplate;

      keys.push({ name, key: plural.other, one: plural.one });
      continue;
    }

    for (const [member, sentence] of Object.entries(record)) {
      keys.push({ name: `${name}.${member}`, key: sentence as string });
    }
  }

  return keys;
}

describe("the words of a case's Story and Impact", () => {
  test("cover every sentence the two cards draw", () => {
    const names: Array<string> = copyKeys().map(
      (entry: { name: string }): string => {
        return entry.name;
      },
    );

    // The last change's sentence, its label and the story's notes among them.
    expect(names).toEqual(
      expect.arrayContaining([
        "IMPACT_LAST_CHANGE",
        "IMPACT_CHANGE_BEFORE",
        "IMPACT_CHANGE_AFTER",
        "IMPACT_NO_CHANGE",
        "STORY_DESCRIPTION",
        "STORY_TRUNCATED",
        "STORY_FIRED",
        "IMPACT_RECORDS",
      ]),
    );
    expect(names.length).toBeGreaterThan(100);
  });

  test("are keys of the Dashboard's English locale file", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const entry of copyKeys()) {
      expect({ name: entry.name, inEnglish: english[entry.key] }).toEqual({
        name: entry.name,
        inEnglish: entry.key,
      });

      if (entry.one !== undefined) {
        expect({
          name: entry.name,
          one: english[`${entry.key}_one`],
        }).toEqual({ name: entry.name, one: entry.one });
      }
    }
  });

  test("are worded in every language, each with its English values", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const entry of copyKeys()) {
        const forms: Array<string> = entry.one
          ? [entry.key, `${entry.key}_one`]
          : [entry.key];

        for (const form of forms) {
          expect({
            language,
            form,
            worded: isWordedInDashboardLocale(form, language),
            values: placeholdersOf(words[form] || ""),
          }).toEqual({
            language,
            form,
            worded: true,
            values: placeholdersOf(
              form.endsWith("_one") ? entry.one || "" : entry.key,
            ),
          });
        }
      }
    }
  });

  test("a change's kind is a noun and the response filter is not an HTTP answer, in every language", () => {
    expect(Copy.STORY_KIND_LABELS[SecurityCaseStoryItemKind.Change]).toBe(
      CHANGE_EVENT_MARKER_SUBTITLE,
    );
    expect(Copy.STORY_FILTER_LABELS[SecurityCaseStoryFilter.Response]).toBe(
      "Response activity",
    );

    // Where a language says the two apart, the story's word is not the button's.
    const german: Record<string, string> = readDashboardLocale("de");

    expect(german["Change event"]).toBe("Änderungsereignis");
    expect(german["Change"]).toBe("Ändern");
    expect(german["Response activity"]).toBe("Reaktion");
    expect(german["Response"]).toBe("Antwort");
    expect(readDashboardLocale("ru")["Response activity"]).toBe("Реагирование");
    expect(readDashboardLocale("ja")["Response activity"]).toBe("対応");
  });

  test("a detection that fired 31 times says 31 in Russian, whose 'one' form holds 31", () => {
    const russian: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("ru");

    expect(russian.translatePlural(Copy.STORY_FIRED, 1)).toBe(
      "Сработало один раз",
    );
    expect(russian.translatePlural(Copy.STORY_FIRED, 31)).toBe(
      "Срабатываний: 31",
    );
    expect(russian.translatePlural(Copy.STORY_EVENTS_IN_RUN, 21)).toBe(
      "21 подобное событие",
    );
  });

  test("the outcome tally writes the colon each language writes", () => {
    const tally: (language: string) => string = (language: string): string => {
      return dashboardTranslator(language).translateTemplate(
        Copy.STORY_OUTCOME_TALLY,
        { label: "X", count: "4" },
      );
    };

    expect(tally("en")).toBe("X: 4");
    expect(tally("de")).toBe("X: 4");
    expect(tally("fr")).toBe("X : 4");
    expect(tally("ja")).toBe("X：4");
    expect(tally("zh-CN")).toBe("X：4");
  });
});

// ---------- The Story ----------

function storyItem(
  item: Partial<SecurityCaseStoryItemJson> & {
    key: string;
    kind: SecurityCaseStoryItemKind;
    time: string;
  },
): SecurityCaseStoryItemJson {
  return { title: "", links: {}, ...item };
}

function story(
  overrides: Partial<SecurityCaseStoryJson> = {},
): SecurityCaseStoryJson {
  return {
    windowStart: "2026-10-25T09:00:00.000Z",
    windowEnd: "2026-10-25T12:00:00.000Z",
    items: [
      storyItem({
        key: "events:1",
        kind: SecurityCaseStoryItemKind.Events,
        time: "2026-10-25T09:02:00.000Z",
        endTime: "2026-10-25T09:40:00.000Z",
        title:
          "user.session.start FAILURE for j.wilson@acme-commerce.example from 203.0.113.47",
        count: 413,
        outcomes: { Rejected: 400, "Reached App": 13 },
      }),
      storyItem({
        key: "detection:1",
        kind: SecurityCaseStoryItemKind.Detection,
        time: "2026-10-25T09:05:00.000Z",
        title: "Okta password spray",
        count: 31,
      }),
      storyItem({
        key: "opened",
        kind: SecurityCaseStoryItemKind.CaseOpened,
        time: "2026-10-25T09:06:00.000Z",
      }),
      storyItem({
        key: "run:1",
        kind: SecurityCaseStoryItemKind.PlaybookRun,
        time: "2026-10-25T09:07:00.000Z",
        title: "Enrich New Cases",
        actorName: "Maya Chen",
      }),
      storyItem({
        key: "milestone:acknowledged",
        kind: SecurityCaseStoryItemKind.Milestone,
        milestone: SecurityCaseStoryMilestone.Acknowledged,
        time: "2026-10-25T09:10:00.000Z",
      }),
      storyItem({
        key: "change:1",
        kind: SecurityCaseStoryItemKind.Change,
        time: "2026-10-25T09:20:00.000Z",
        title: "Failed: DeleteLoadBalancer on web-alb",
        stateName: ChangeEventType.ConfigChange,
        cloudChange: {
          operation: "DeleteLoadBalancer",
          resource: "web-alb",
          failed: true,
        },
        links: {
          resource: {
            kind: SecurityConnectionKind.CloudResource,
            id: RESOURCE_ID,
            name: "web-alb",
          },
        },
      }),
      storyItem({
        key: "change:2",
        kind: SecurityCaseStoryItemKind.Change,
        time: "2026-10-25T09:22:00.000Z",
        title: "AWS Health: EC2 operational issue (open)",
        stateName: ChangeEventType.ProviderEvent,
        cloudHealth: HEALTH_FACTS,
      }),
      storyItem({
        key: "exception:1",
        kind: SecurityCaseStoryItemKind.Exception,
        time: "2026-10-25T09:25:00.000Z",
        title: "TypeError: Cannot read properties of undefined",
        count: 2,
      }),
      storyItem({
        key: "note:1",
        kind: SecurityCaseStoryItemKind.Note,
        time: "2026-10-25T09:30:00.000Z",
        title: "Spray started 09:02 UTC.",
        actorName: "Maya Chen",
      }),
    ],
    truncatedSources: [SecurityCaseStorySource.Events],
    unreadableSources: [SecurityCaseStorySource.Incidents],
    failedSources: [SecurityCaseStorySource.Alerts],
    ...overrides,
  };
}

async function drawStory(
  language: string,
  value: SecurityCaseStoryJson = story(),
): Promise<HTMLElement> {
  setDateDisplayLanguage(language);
  getStoryMock.mockResolvedValue(value as never);

  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MemoryRouter>
          <SecurityCaseStory caseId={new ObjectID(CASE_ID)} />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });

  return screen.getByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.story);
}

function storyItems(): Array<HTMLElement> {
  return screen.getAllByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.storyItem);
}

function itemOfKind(
  kind: SecurityCaseStoryItemKind,
  index: number = 0,
): HTMLElement {
  return storyItems().filter((item: HTMLElement): boolean => {
    return item.getAttribute("data-kind") === kind;
  })[index]!;
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

describe("the Story, in German", () => {
  test("its description, its filters and its window", async () => {
    const card: HTMLElement = await drawStory("de");

    expect(card).toHaveTextContent(
      "Was geschah, der Reihe nach, überall in OneUptime",
    );

    const filters: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.storyFilters,
    );

    expect(filters).toHaveAttribute(
      "aria-label",
      "Einen Teil des Hergangs zeigen",
    );
    expect(
      screen.getByTestId("security-case-story-filter-Attack"),
    ).toHaveTextContent(/^Angriff/);
    expect(
      screen.getByTestId("security-case-story-filter-Response"),
    ).toHaveTextContent(/^Reaktion/);
    expect(card).toHaveTextContent("Rund um die Erkennungen des Falls:");
  });

  test("each item says what it is, how often and by whom, in German", async () => {
    await drawStory("de");

    const events: HTMLElement = itemOfKind(SecurityCaseStoryItemKind.Events);

    expect(events).toHaveTextContent("413 solche Ereignisse");
    expect(events).toHaveTextContent("Abgelehnt: 400");
    expect(events).toHaveTextContent("App erreicht: 13");
    expect(itemOfKind(SecurityCaseStoryItemKind.Detection)).toHaveTextContent(
      "31-mal ausgelöst",
    );
    expect(itemOfKind(SecurityCaseStoryItemKind.Exception)).toHaveTextContent(
      "Von 2 Anfragen ausgelöst",
    );
    expect(itemOfKind(SecurityCaseStoryItemKind.CaseOpened)).toHaveTextContent(
      "Fall eröffnet",
    );
    expect(itemOfKind(SecurityCaseStoryItemKind.Milestone)).toHaveTextContent(
      "Fall bestätigt",
    );
    expect(itemOfKind(SecurityCaseStoryItemKind.Note)).toHaveTextContent(
      "Geschrieben von Maya Chen",
    );
    expect(itemOfKind(SecurityCaseStoryItemKind.PlaybookRun)).toHaveTextContent(
      "Gestartet von Maya Chen",
    );
  });

  test("a change is a change event, its pill its kind, its title in German", async () => {
    await drawStory("de");

    const change: HTMLElement = itemOfKind(SecurityCaseStoryItemKind.Change);

    expect(change).toHaveTextContent("Änderungsereignis");
    expect(change).not.toHaveTextContent("Ändern");
    // Its kind as the Changes lists name it, not its stored code.
    expect(change).toHaveTextContent(
      readDashboardLocale("de")["Config change"]!,
    );
    expect(change).not.toHaveTextContent("config-change");
    expect(change).toHaveTextContent(
      "Fehlgeschlagen: DeleteLoadBalancer für web-alb",
    );
    expect(change).toHaveTextContent("auf web-alb");

    const health: HTMLElement = itemOfKind(SecurityCaseStoryItemKind.Change, 1);

    expect(health).toHaveTextContent(GERMAN_HEALTH_TITLE);
    expect(health).toHaveTextContent(
      readDashboardLocale("de")["Cloud health"]!,
    );
  });

  test("what it leaves out, cannot read or could not read, in German", async () => {
    await drawStory("de");

    const notes: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.storyNotes,
    );

    expect(notes).toHaveTextContent(
      "Der Hergang lässt einige Sicherheitsereignisse aus: Es gab mehr, als er zeigt.",
    );
    expect(notes).toHaveTextContent(
      "Ihre Rolle kann Vorfälle nicht lesen, daher fehlen sie im Hergang.",
    );
    expect(notes).toHaveTextContent(
      "Die Warnungen konnten diesmal nicht gelesen werden.",
    );
    expect(within(notes).getByRole("button")).toHaveTextContent(
      "Erneut versuchen",
    );
  });

  test("no English sentence of the card is left", async () => {
    const card: HTMLElement = await drawStory("de");
    const text: string = textOf(card);

    for (const english of [
      "What happened",
      "events like this",
      "Fired",
      "Thrown by",
      "Written by",
      "Started by",
      "Case opened",
      "Case acknowledged",
      "Response activity",
      "Attack",
      "Incidents & alerts",
      "Around the case's detections",
      "The story leaves",
      "Your role can't",
      "couldn't be read",
      "Reached the app",
    ]) {
      expect({ english, inCard: text.includes(english) }).toEqual({
        english,
        inCard: false,
      });
    }
  });

  test("an empty story, and a part with nothing in it, in German", async () => {
    await drawStory("de", story({ items: [] }));

    expect(
      screen.getByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.storyEmpty),
    ).toHaveTextContent("Noch nichts zu erzählen");
    cleanup();

    await drawStory(
      "de",
      story({ truncatedSources: [], unreadableSources: [], failedSources: [] }),
    );
    fireEvent.click(screen.getByTestId("security-case-story-filter-Changes"));
    expect(storyItems()).toHaveLength(2);
    fireEvent.click(screen.getByTestId("security-case-story-filter-All"));
    expect(storyItems().length).toBeGreaterThan(2);
  });
});

describe("the Story, in Persian", () => {
  test("its words are Persian, a Latin name or count set apart in its sentence", async () => {
    const card: HTMLElement = await drawStory("fa");

    expect(
      screen.getByTestId("security-case-story-filter-Attack"),
    ).toHaveTextContent(/^حمله/);
    expect(itemOfKind(SecurityCaseStoryItemKind.Milestone)).toHaveTextContent(
      "پرونده تأیید شد",
    );

    const note: HTMLElement = itemOfKind(SecurityCaseStoryItemKind.Note);
    const written: HTMLElement = within(note).getByText(
      (_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "SPAN" &&
          withoutIsolateMarks(element.textContent || "") ===
            "نوشته‌شده توسط Maya Chen"
        );
      },
    );

    // Set apart, so "Maya Chen" keeps its place in the line read right to left.
    expect(written.textContent).not.toBe(
      withoutIsolateMarks(written.textContent || ""),
    );
    expect(textOf(card)).toContain("روی web-alb");
  });

  test("a change worded for the reader reads right to left, though it starts with AWS Health", async () => {
    await drawStory("fa");

    const health: HTMLElement = itemOfKind(SecurityCaseStoryItemKind.Change, 1);

    expect(health.querySelector("bdi")).toHaveAttribute("dir", "rtl");
  });
});

describe("a story item's pill", () => {
  test("names a change by its kind, and an incident's or a run's state as given", () => {
    expect(
      getStoryItemStateLabel({
        kind: SecurityCaseStoryItemKind.Change,
        stateName: ChangeEventType.Deployment,
      }),
    ).toBe("Deploy");
    expect(
      getStoryItemStateLabel({
        kind: SecurityCaseStoryItemKind.Change,
        stateName: "provider-event",
      }),
    ).toBe("Cloud health");
    expect(
      getStoryItemStateLabel({
        kind: SecurityCaseStoryItemKind.Incident,
        stateName: "Investigating",
      }),
    ).toBe("Investigating");
  });

  test("draws no pill for a change of a kind the lists do not name: its label says what it is", () => {
    expect(
      getStoryItemStateLabel({
        kind: SecurityCaseStoryItemKind.Change,
        stateName: "schema-migration",
      }),
    ).toBe("");
    expect(
      getStoryItemStateLabel({
        kind: SecurityCaseStoryItemKind.Change,
        stateName: undefined,
      }),
    ).toBe("");
  });
});

// ---------- The Impact ----------

function peer(name: string): {
  key: string;
  name: string;
  type: string;
  callCount: number | null;
  errorCount: number | null;
} {
  return { key: name, name, type: "Service", callCount: 10, errorCount: 0 };
}

function impact(
  overrides: Partial<SecurityCaseImpactJson> = {},
): SecurityCaseImpactJson {
  return {
    windowStart: "2026-10-25T09:00:00.000Z",
    windowEnd: "2026-10-25T12:00:00.000Z",
    firstDetectedAt: "2026-10-25T09:05:00.000Z",
    records: [
      {
        kind: SecurityConnectionKind.CloudResource,
        id: RESOURCE_ID,
        name: "web-alb",
        certainty: SecurityConnectionCertainty.Exact,
        calls: [peer("checkout"), peer("payments")],
        calledBy: [peer("edge")],
        runsOn: [peer("us-east-1a")],
        monitors: {
          count: 3,
          items: [
            {
              id: MONITOR_ID,
              title: "web-alb health",
              stateName: "Operational",
              stateColor: "#16a34a",
            },
          ],
        },
        owners: {
          teams: [{ id: "t1", name: "Platform" }],
          users: [{ id: "u1", name: "Maya Chen" }],
        },
        lastChange: {
          id: "change-2",
          time: "2026-10-25T09:00:00.000Z",
          title: "AWS Health: EC2 operational issue (open)",
          eventType: ChangeEventType.ProviderEvent,
          cloudHealth: HEALTH_FACTS,
          version: "2.3.1",
          isBeforeFirstDetection: true,
        },
      },
    ],
    hasMoreRecords: true,
    statusPages: [{ id: "s1", name: "Acme Status", monitorIds: [MONITOR_ID] }],
    flowPeers: [
      {
        caseAddress: "10.0.1.5",
        peerAddress: "203.0.113.47",
        direction: "out",
        bytes: 1200000,
        packets: 900,
        lastSeen: null,
      },
    ],
    internet: {
      exposure: SecurityCaseInternetExposure.Yes,
      evidence: [
        {
          kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
          address: "203.0.113.47",
          time: "2026-10-25T09:03:00.000Z",
          requestOutcome: "Reached App",
        },
        {
          kind: SecurityCaseExposureEvidenceKind.PublicAddress,
          address: "54.12.3.4",
          recordName: "web-alb",
        },
      ],
    },
    unreadableSources: [SecurityCaseImpactSource.Monitors],
    failedSources: [SecurityCaseImpactSource.NetworkFlows],
    ...overrides,
  };
}

async function drawImpact(
  language: string,
  value: SecurityCaseImpactJson = impact(),
): Promise<HTMLElement> {
  setDateDisplayLanguage(language);
  getImpactMock.mockResolvedValue(value as never);

  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <MemoryRouter>
          <SecurityCaseImpactCard caseId={new ObjectID(CASE_ID)} />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });

  return screen.getByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impact);
}

function lastChange(): HTMLElement {
  return screen.getByTestId(
    Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChange,
  );
}

describe("the Impact, in German", () => {
  test("its title, its figures and its exposure", async () => {
    const card: HTMLElement = await drawImpact("de");

    expect(card).toHaveTextContent(readDashboardLocale("de")["Impact"]!);
    expect(card).toHaveTextContent(
      "Was dieser Fall gefährdet, soweit der Rest von OneUptime es kennt.",
    );

    const summary: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactSummary,
    );

    expect(summary).toHaveTextContent("Aus dem Internet erreichbar");
    expect(summary).toHaveTextContent("Nennt 1 Datensatz");
    expect(summary).toHaveTextContent("Ruft 2 andere auf");
    expect(summary).toHaveTextContent("Aufgerufen von 1");
    expect(summary).toHaveTextContent("3 Monitore");
    expect(summary).toHaveTextContent("1 Statusseite");
    expect(card).toHaveTextContent(
      "Eine Anfrage von 203.0.113.47 kam durch (App erreicht)",
    );
    expect(card).toHaveTextContent(
      "web-alb hat eine öffentliche Adresse, 54.12.3.4.",
    );
  });

  test("its last change reads as one German sentence, the health title in German", async () => {
    await drawImpact("de");

    const line: HTMLElement = lastChange();

    expect(line).toHaveTextContent("Letzte Änderung");
    expect(
      screen.getByTestId(
        Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChangeTitle,
      ),
    ).toHaveTextContent(GERMAN_HEALTH_TITLE);
    expect(textOf(line)).toMatch(
      /AWS Health: EC2-Betriebsstörung \(offen\) auf web-alb, .+: vor der ersten Erkennung/,
    );
    expect(line).toHaveTextContent("Version 2.3.1");
    expect(textOf(line)).not.toContain("before the first detection");
  });

  test("what is at risk, under its fold, in German", async () => {
    await drawImpact("de");

    const toggle: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactToggle,
    );

    expect(toggle).toHaveTextContent("Gefährdete Datensätze anzeigen");
    fireEvent.click(toggle);

    const details: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactDetails,
    );

    expect(details).toHaveTextContent("Läuft auf");
    expect(details).toHaveTextContent("Überwacht von");
    expect(details).toHaveTextContent("+2 weitere");
    expect(details).toHaveTextContent("Netzwerk-Gegenstellen");
    expect(details).toHaveTextContent(
      /10\.0\.1\.5 sendete .+ an 203\.0\.113\.47/,
    );
  });

  test("what it cannot read or could not read, in German", async () => {
    await drawImpact("de");

    const notes: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactNotes,
    );

    expect(notes).toHaveTextContent(
      "Der Fall nennt mehr Datensätze, als hier angezeigt werden.",
    );
    expect(notes).toHaveTextContent(
      "Ihre Rolle kann die Monitore nicht lesen, daher fehlen sie in den Auswirkungen.",
    );
    expect(notes).toHaveTextContent(
      "Die Netzwerk-Flows konnten diesmal nicht gelesen werden.",
    );
  });

  test("no English sentence of the card is left", async () => {
    const card: HTMLElement = await drawImpact("de");

    fireEvent.click(
      screen.getByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactToggle),
    );

    const text: string = textOf(card);

    for (const english of [
      "What this case puts at risk",
      "Reachable from the internet",
      "Names 1 record",
      "Calls 2 others",
      "Called by",
      "monitors",
      "status page",
      "Last change",
      "before the first detection",
      "has a public address",
      "got through",
      "Network peers",
      "Watched by",
      "sent",
      "Hide details",
      "The case names more records",
      "Your role can't",
      "couldn't be read",
    ]) {
      expect({ english, inCard: text.includes(english) }).toEqual({
        english,
        inCard: false,
      });
    }
  });

  test("a case that names nothing, and records nothing changed on", async () => {
    await drawImpact(
      "de",
      impact({
        records: [],
        internet: {
          exposure: SecurityCaseInternetExposure.Unknown,
          evidence: [],
        },
        dataAtRisk: null,
        hasMoreRecords: false,
        unreadableSources: [],
        failedSources: [],
      }),
    );

    expect(
      screen.getByTestId(Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactEmpty),
    ).toHaveTextContent("Nichts, was OneUptime kennt, wird genannt");
    cleanup();

    const quiet: SecurityCaseImpactJson = impact({
      unreadableSources: [],
      failedSources: [],
    });

    quiet.records[0]!.lastChange = null;
    await drawImpact("de", quiet);
    expect(lastChange()).toHaveTextContent(
      "In der Woche vor dem Fall hat sich an diesen Datensätzen nichts geändert.",
    );
  });
});

describe("the Impact, in Persian", () => {
  test("the last change's title reads right to left, the record's name set apart", async () => {
    await drawImpact("fa");

    const title: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChangeTitle,
    );

    expect(title.tagName).toBe("BDI");
    expect(title).toHaveAttribute("dir", "rtl");
    expect(textOf(lastChange())).toContain("آخرین تغییر");
    expect(textOf(lastChange())).toContain("روی web-alb");
    expect(textOf(lastChange())).toContain("پیش از نخستین تشخیص");
    expect(
      within(lastChange())
        .getAllByText("web-alb")
        .some((element: HTMLElement): boolean => {
          return element.tagName === "BDI";
        }),
    ).toBe(true);
  });

  test("an address keeps its dots and digits in place: set apart in its sentence", async () => {
    const card: HTMLElement = await drawImpact("fa");
    const line: HTMLElement = within(card).getByText(
      (_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "LI" &&
          withoutIsolateMarks(element.textContent || "").startsWith(
            "درخواستی از 203.0.113.47",
          )
        );
      },
    );

    expect(line.textContent).toContain("⁨203.0.113.47⁩");
  });
});

describe("the Impact, in English", () => {
  test("its last change reads as it always did", async () => {
    await drawImpact("en");

    const time: string = OneUptimeDate.fromNow(
      new Date("2026-10-25T09:00:00.000Z"),
    );

    expect(textOf(lastChange())).toBe(
      `Last changeAWS Health: EC2 operational issue (open) on web-alb, ${time}: before the first detectionVersion 2.3.1`,
    );
    expect(
      screen.getByTestId(
        Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChangeTitle,
      ),
    ).toHaveAttribute("dir", "ltr");
  });

  test("a change worded by no one reads its own way", async () => {
    const deploy: SecurityCaseImpactJson = impact();

    deploy.records[0]!.lastChange = {
      id: "change-3",
      time: "2026-10-25T08:50:00.000Z",
      title: "Deploy checkout 2.3.1",
      eventType: ChangeEventType.Deployment,
      isBeforeFirstDetection: true,
    };
    await drawImpact("en", deploy);

    const title: HTMLElement = screen.getByTestId(
      Copy.SECURITY_CASE_CONTEXT_TEST_IDS.impactLastChangeTitle,
    );

    expect(title).toHaveTextContent("Deploy checkout 2.3.1");
    expect(title).toHaveAttribute("dir", "auto");
  });
});
