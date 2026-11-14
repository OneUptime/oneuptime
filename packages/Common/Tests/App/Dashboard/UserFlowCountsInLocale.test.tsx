/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import { analyzeUserFlow, UserFlowAnalysis } from "../../../Utils/Rum/UserFlow";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import DashboardI18n, {
  i18nReady,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/i18n";
import UserFlowJourneys from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys";
import RumApplicationUserFlows from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";

/*
 * #7881: THE PAGE PICKER AND SHOW MORE WRITE A COUNT THE READER'S WAY.
 *
 * The User Flows page writes its counts in the reader's digits and
 * grouping (formatUserFlowCount, given the reader's Translator), but two
 * places wrote theirs the English way in every language: the page
 * picker's "/home (1,234)" and the journeys' "Show more (1,224 left)". To
 * a German, French, Italian, Spanish or Dutch reader "1,234" is a decimal,
 * one point two three four; a Persian reader saw Latin digits beside the
 * page's Persian ones. Through the Dashboard's own i18next
 * (src/Utils/i18n.ts, its locale files as a reader picks a language).
 */

jest.setTimeout(120000);

const ORIGIN: string = "https://shop.example.com";
const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");

// 1,234 sessions, each landing on "/home" and going on to "/cart" or "/checkout".
const SESSION_COUNT: number = 1234;

function response(): UserFlowJourneysResponseDto {
  const pages: Array<string> = [
    `${ORIGIN}/home`,
    `${ORIGIN}/cart`,
    `${ORIGIN}/checkout`,
  ];
  const sessions: Array<UserFlowSessionDto> = Array.from(
    { length: SESSION_COUNT },
    (_unused: unknown, index: number): UserFlowSessionDto => {
      return {
        sessionId: `s${index}`,
        startUnixMs: 1_800_000_000_000 - index * 1000,
        durationMs: 60_000,
        deviceType: "desktop",
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: 0,
        frustrationCount: 0,
        pages: [0, index % 2 === 0 ? 1 : 2],
        pageSignals: [],
      };
    },
  );

  return {
    pages: pages,
    sessions: sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: 1_799_990_000_000,
    endUnixMs: 1_800_000_000_000,
    scope: null,
  };
}

// Each language's 1,234 and 1,224, as the reader writes them.
const COUNTS: Array<{ language: string; sessions: string; left: string }> = [
  { language: "de", sessions: "1.234", left: "1.224" },
  { language: "fa", sessions: "۱٬۲۳۴", left: "۱٬۲۲۴" },
  { language: "en", sessions: "1,234", left: "1,224" },
];

// The Dashboard's i18next, in a language, as its language menu sets it.
async function readIn(language: string): Promise<void> {
  await act(async () => {
    await DashboardI18n.changeLanguage(language);
  });

  expect(DashboardI18n.resolvedLanguage).toBe(language);
}

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID.toString()}/user-flows`;

// The User Flows page, its map anchored on "/home": the page picker shows.
async function renderPageAnchoredOnHome(): Promise<HTMLSelectElement> {
  window.history.replaceState(
    null,
    "",
    `${PAGE_PATH}?page=${encodeURIComponent("/home")}`,
  );

  render(
    <MemoryRouter>
      <RumApplicationUserFlows
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("user-flow-anchor-select")).toHaveValue("/home");
  });

  return screen.getByTestId("user-flow-anchor-select") as HTMLSelectElement;
}

beforeEach(async () => {
  window.localStorage.clear();
  await i18nReady;
  postMock.mockReset();
  postMock.mockImplementation(
    (request: { url: { toString: () => string } }) => {
      if (request.url.toString().includes("/session-replay/users")) {
        return Promise.resolve(
          new HTTPResponse(200, { users: [], nextCursor: null }, {}),
        );
      }

      return Promise.resolve(
        new HTTPResponse(200, response() as unknown as JSONObject, {}),
      );
    },
  );
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await DashboardI18n.changeLanguage("en");
});

describe.each(COUNTS)(
  "#7881: in $language, a count on the User Flows page is written the reader's way",
  (counts: { language: string; sessions: string; left: string }) => {
    test("the page picker counts a page's sessions as the page's tiles do", async () => {
      await readIn(counts.language);
      expect(dashboardTranslator(counts.language).formatNumber(1234)).toBe(
        counts.sessions,
      );

      const select: HTMLSelectElement = await renderPageAnchoredOnHome();
      const home: HTMLOptionElement | undefined = Array.from(
        select.options,
      ).find((option: HTMLOptionElement): boolean => {
        return option.value === "/home";
      });

      // "/home (1.234)" to a German reader, not "/home (1,234)".
      expect(home?.textContent).toBe(`/home (${counts.sessions})`);
      // Every session landed on "/home": the tile above counts the same sessions.
      expect(
        screen.getByTestId("user-flow-tile-sessions-value").textContent,
      ).toBe(counts.sessions);
    });

    test("Show more counts the journeys left", async () => {
      await readIn(counts.language);

      const analysis: UserFlowAnalysis = analyzeUserFlow(response());

      expect(analysis.journeys).toHaveLength(SESSION_COUNT);

      render(
        <MemoryRouter>
          <UserFlowJourneys
            journeys={analysis.journeys}
            rumApplicationId={APP_ID}
          />
        </MemoryRouter>,
      );

      // Ten are shown at first: 1,224 are left.
      expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(10);
      expect(screen.getByTestId("user-flow-journeys-more").textContent).toBe(
        dashboardTranslator(counts.language).translateTemplate(
          "Show more ({{left}} left)",
          { left: counts.left },
        ),
      );
      expect(
        screen.getByTestId("user-flow-journeys-more").textContent,
      ).toContain(counts.left);
    });
  },
);

test("#7881: English reads word for word as before", async () => {
  await readIn("en");

  render(
    <MemoryRouter>
      <UserFlowJourneys
        journeys={analyzeUserFlow(response()).journeys}
        rumApplicationId={APP_ID}
      />
    </MemoryRouter>,
  );

  expect(screen.getByTestId("user-flow-journeys-more").textContent).toBe(
    "Show more (1,224 left)",
  );
});
