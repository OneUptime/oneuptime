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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getImpactMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextApi",
  () => {
    return {
      __esModule: true,
      default: {
        getStory: (): Promise<never> => {
          return new Promise<never>(() => {});
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
  SecurityCaseEdgeActivityJson,
  SecurityCaseEdgeAddressJson,
  SecurityCaseImpactJson,
  SecurityCaseInternetExposure,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import { PluralTemplate } from "../../../Types/Translator";
import ProjectUtil from "../../../UI/Utils/Project";
import { SECURITY_CASE_CONTEXT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextCopy";
import SecurityCaseEdgeSection, {
  EDGE_ABOUT_FIGURE,
  EDGE_FIGURE_LABELS,
  EDGE_LET_THROUGH,
  EDGE_LET_THROUGH_ABOUT,
  EDGE_NO_APP_REQUESTS,
  EDGE_SECTION_HEADING,
  EDGE_STOPPED,
  EDGE_STOPPED_ABOUT,
  SECURITY_CASE_EDGE_TEST_IDS,
  edgeFigures,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseEdgeSection";
import SecurityCaseImpactCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseImpactCard";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A CASE'S IMPACT, AT THE EDGE: what Cloudflare did with the case's
 * addresses' requests, beside how far the requests OneUptime saw in the app
 * got. A count from sampled events says "about"; an address none of whose
 * requests OneUptime saw in the app says it cannot tell, rather than "none
 * reached your app".
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6c";
const CASE_ID: string = "20000000-0000-4000-8000-000000000214";
const ATTACKER: string = "203.0.113.7";

const LANGUAGES: Record<string, Record<string, unknown>> = {
  en: englishLocale,
  de: germanLocale,
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
  getImpactMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function activity(
  overrides: Partial<SecurityCaseEdgeActivityJson> = {},
): SecurityCaseEdgeActivityJson {
  return {
    edge: "Cloudflare",
    blocked: 0,
    challenged: 0,
    passedChallenge: 0,
    logged: 0,
    letThrough: 0,
    other: 0,
    isEstimate: false,
    ...overrides,
  };
}

function address(
  overrides: Partial<SecurityCaseEdgeAddressJson> = {},
): SecurityCaseEdgeAddressJson {
  return {
    address: ATTACKER,
    edges: [activity({ blocked: 380, challenged: 20, isEstimate: true })],
    app: { rejected: 0, reachedApp: 7, errored: 0, reachedDatabase: 2 },
    ...overrides,
  };
}

function drawSection(
  addresses: Array<SecurityCaseEdgeAddressJson>,
  language: string = "en",
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <SecurityCaseEdgeSection edge={{ addresses }} />
    </I18nextProvider>,
  );
}

function headlines(): Array<string> {
  return screen
    .getAllByTestId(SECURITY_CASE_EDGE_TEST_IDS.headline)
    .map((line: HTMLElement): string => {
      return line.textContent || "";
    });
}

// Each figure as "label: value", in the order drawn.
function figures(): Array<string> {
  return Array.from(
    screen
      .getByTestId(SECURITY_CASE_EDGE_TEST_IDS.address)
      .querySelectorAll("dl > div"),
  ).map((figure: Element): string => {
    return `${figure.querySelector("dt")?.textContent}: ${figure.querySelector("dd")?.textContent}`;
  });
}

describe("SecurityCaseEdgeSection", () => {
  test("is drawn only when an edge acted on one of the case's addresses", () => {
    const { container } = render(
      <I18nextProvider i18n={instances["en"]!}>
        <SecurityCaseEdgeSection edge={null} />
        <SecurityCaseEdgeSection edge={undefined} />
        <SecurityCaseEdgeSection edge={{ addresses: [] }} />
      </I18nextProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("leads with what the edge stopped, about as many as its sampled events stand for, then the figures beside the app's", () => {
    drawSection([address()]);

    const section: HTMLElement = screen.getByTestId(
      SECURITY_CASE_EDGE_TEST_IDS.section,
    );

    expect(within(section).getByRole("heading")).toHaveTextContent(
      "At the edge",
    );
    expect(headlines()).toEqual([
      "Cloudflare stopped about 400 requests from 203.0.113.7.",
    ]);
    expect(figures()).toEqual([
      "Blocked: about 380",
      "Challenged: about 20",
      // Reaching the database is reaching the app: 7 + 2.
      "Reached your app: 9",
      "Reached the database: 2",
    ]);
    expect(
      screen.queryByTestId(SECURITY_CASE_EDGE_TEST_IDS.noAppRequests),
    ).not.toBeInTheDocument();
  });

  test("an exact count says the number, in the singular for one", () => {
    drawSection([
      address({
        edges: [activity({ blocked: 1 })],
        app: { rejected: 1, reachedApp: 0, errored: 0, reachedDatabase: 0 },
      }),
    ]);

    expect(headlines()).toEqual([
      "Cloudflare stopped 1 request from 203.0.113.7.",
    ]);
    expect(figures()).toEqual(["Blocked: 1", "Turned away by your app: 1"]);
  });

  test("when the edge stopped none, says what it let through", () => {
    drawSection([
      address({
        edges: [
          activity({
            passedChallenge: 2,
            logged: 3,
            letThrough: 1,
            isEstimate: true,
          }),
        ],
      }),
    ]);

    expect(headlines()).toEqual([
      "Cloudflare let about 6 requests from 203.0.113.7 through.",
    ]);
    expect(figures()).toEqual([
      "Passed a challenge: about 2",
      "Logged: about 3",
      "Let through by your rules: about 1",
      "Reached your app: 9",
      "Reached the database: 2",
    ]);
  });

  test("an address none of whose requests OneUptime saw in the app says it cannot tell", () => {
    drawSection([
      address({
        app: { rejected: 0, reachedApp: 0, errored: 0, reachedDatabase: 0 },
      }),
    ]);

    expect(
      screen.getByTestId(SECURITY_CASE_EDGE_TEST_IDS.noAppRequests),
    ).toHaveTextContent(
      "OneUptime saw none of this address's requests in your app's logs or traces, so it cannot tell whether any reached the app.",
    );
    expect(figures()).toEqual(["Blocked: about 380", "Challenged: about 20"]);
  });

  test("one line per edge and per address, in the order given", () => {
    drawSection([
      address({
        edges: [
          activity({ blocked: 5 }),
          activity({ edge: "Akamai", challenged: 2 }),
        ],
      }),
      address({ address: "198.51.100.23", edges: [activity({ logged: 1 })] }),
    ]);

    expect(headlines()).toEqual([
      "Cloudflare stopped 5 requests from 203.0.113.7.",
      "Akamai stopped 2 requests from 203.0.113.7.",
      "Cloudflare let 1 request from 198.51.100.23 through.",
    ]);
    expect(
      screen.getAllByTestId(SECURITY_CASE_EDGE_TEST_IDS.address),
    ).toHaveLength(2);
  });

  test("reads in German, the figures as German writes numbers", () => {
    drawSection(
      [
        address({
          edges: [
            activity({ blocked: 1200, challenged: 34, isEstimate: true }),
          ],
        }),
      ],
      "de",
    );

    const german: Record<string, string> = readDashboardLocale("de");
    const section: HTMLElement = screen.getByTestId(
      SECURITY_CASE_EDGE_TEST_IDS.section,
    );

    expect(within(section).getByRole("heading")).toHaveTextContent(
      german[EDGE_SECTION_HEADING]!,
    );
    expect(section).toHaveTextContent(german[EDGE_FIGURE_LABELS.blocked]!);
    // The figure as German writes it: 1.200, not 1,200.
    expect(section).toHaveTextContent("1.200");
    expect(section).not.toHaveTextContent("1,200");
    expect(section).not.toHaveTextContent("At the edge");
    expect(section).not.toHaveTextContent("stopped about");
  });

  test("its figures are those that are not zero, the edge's before the app's", () => {
    expect(
      edgeFigures(
        address({
          edges: [activity({ logged: 2 })],
          app: { rejected: 3, reachedApp: 0, errored: 1, reachedDatabase: 0 },
        }),
      ).map((figure: { label: string; value: number }): string => {
        return `${figure.label}=${figure.value}`;
      }),
    ).toEqual([
      "Logged=2",
      // An app error is a request that reached the app.
      "Reached your app=1",
      "Turned away by your app=3",
    ]);
  });
});

describe("the section's words", () => {
  const SENTENCES: Array<string> = [
    EDGE_SECTION_HEADING,
    EDGE_ABOUT_FIGURE,
    EDGE_NO_APP_REQUESTS,
    ...Object.values(EDGE_FIGURE_LABELS),
  ];
  const PLURALS: Array<PluralTemplate> = [
    EDGE_STOPPED,
    EDGE_STOPPED_ABOUT,
    EDGE_LET_THROUGH,
    EDGE_LET_THROUGH_ABOUT,
  ];

  test("are worded in every Dashboard language, each with its English values", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        expect({
          language,
          sentence,
          worded: isWordedInDashboardLocale(sentence, language),
          values: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          language,
          sentence,
          worded: true,
          values: placeholdersOf(sentence),
        });
      }

      for (const plural of PLURALS) {
        for (const [form, english] of [
          [plural.other, plural.other],
          [`${plural.other}_one`, plural.one],
        ] as Array<[string, string]>) {
          expect({
            language,
            form,
            worded: isWordedInDashboardLocale(form, language),
            values: placeholdersOf(words[form] || ""),
          }).toEqual({
            language,
            form,
            worded: true,
            values: placeholdersOf(english),
          });
        }
      }
    }
  });
});

describe("the Impact card, with only the edge to say", () => {
  function edgeOnlyImpact(): SecurityCaseImpactJson {
    return {
      windowStart: "2026-10-25T09:00:00.000Z",
      windowEnd: "2026-10-25T12:00:00.000Z",
      firstDetectedAt: "2026-10-25T09:05:00.000Z",
      records: [],
      hasMoreRecords: false,
      statusPages: [],
      flowPeers: [],
      internet: {
        exposure: SecurityCaseInternetExposure.Unknown,
        evidence: [],
      },
      dataAtRisk: null,
      edge: { addresses: [address()] },
      unreadableSources: [],
      failedSources: [],
    };
  }

  async function drawImpact(value: SecurityCaseImpactJson): Promise<void> {
    getImpactMock.mockResolvedValue(value as never);

    await act(async () => {
      render(
        <I18nextProvider i18n={instances["en"]!}>
          <MemoryRouter>
            <SecurityCaseImpactCard caseId={new ObjectID(CASE_ID)} />
          </MemoryRouter>
        </I18nextProvider>,
      );
    });
  }

  test("says what the edge did, rather than that there is nothing to say", async () => {
    await drawImpact(edgeOnlyImpact());

    expect(
      screen.queryByTestId(SECURITY_CASE_CONTEXT_TEST_IDS.impactEmpty),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(SECURITY_CASE_EDGE_TEST_IDS.section),
    ).toHaveTextContent(
      "Cloudflare stopped about 400 requests from 203.0.113.7.",
    );
  });

  test("with no edge either, is the empty state it was", async () => {
    await drawImpact({ ...edgeOnlyImpact(), edge: { addresses: [] } });

    expect(
      screen.getByTestId(SECURITY_CASE_CONTEXT_TEST_IDS.impactEmpty),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SECURITY_CASE_EDGE_TEST_IDS.section),
    ).not.toBeInTheDocument();
  });
});
