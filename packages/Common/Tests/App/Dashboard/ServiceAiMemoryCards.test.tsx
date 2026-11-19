/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterAll,
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
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import * as ServiceAiMemoryCopy from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceAiMemory/ServiceAiMemoryCopy";
import {
  KNOWLEDGE_CARD_TITLE,
  NOTHING_LEARNED_TITLE,
  SERVICE_AI_MEMORY_TEST_IDS,
  SEEN_TIMES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceAiMemory/ServiceAiMemoryCopy";
import ServiceKnowledgeApi, {
  ServiceKnowledgeApiError,
  getServiceKnowledgeUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceAiMemory/ServiceKnowledgeApi";
import ServiceKnowledgeCard, {
  getRecordRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceAiMemory/ServiceKnowledgeCard";
import { ServiceAiNoteCell } from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceAiMemory/ServiceAiNotesTable";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ServiceAINote from "../../../Models/DatabaseModels/ServiceAINote";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  ServiceKnowledgeFailure,
  ServiceKnowledgeSummary,
} from "../../../Types/AI/ServiceKnowledgeSummary";
import { JSONObject } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE, AND ITS NOTES FOR IT, ON THE
 * SERVICE'S OVERVIEW (#7672).
 *
 *  - The card asks once for the service (ServiceKnowledgeApi), draws a
 *    skeleton while it waits, says what failed with Try again, says "No
 *    failures learned yet." with how the learning happens, and lists each
 *    failure: its cause as written, how often (a plural), when last, a
 *    confirmed analysis said to be one, the fix that worked (a runbook, or
 *    the commands as code), and its incidents and alerts as links.
 *  - It reads again when the page refreshes.
 *  - A note's cell is the team's words as written, with who added it and
 *    when.
 *  - The overview draws both cards only while the project uses AI.
 *  - Every word is worded in every Dashboard language, and the card reads
 *    in German in German.
 */

const SERVICE: ObjectID = new ObjectID("76720000-0000-4000-8000-0000000000aa");
const INCIDENT: string = "76720000-0000-4000-8000-000000000001";
const ALERT: string = "76720000-0000-4000-8000-000000000002";
const DE: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

function failure(
  overrides: Partial<ServiceKnowledgeFailure> = {},
): ServiceKnowledgeFailure {
  return {
    count: 3,
    lastSeenAt: "2026-11-10T12:00:00.000Z",
    records: [
      {
        kind: "incident",
        id: INCIDENT,
        number: 42,
        title: "Checkout is down",
        happenedAt: "2026-11-10T12:00:00.000Z",
      },
      {
        kind: "alert",
        id: ALERT,
        number: 7,
        title: "Too many connections",
        happenedAt: "2026-11-01T12:00:00.000Z",
      },
    ],
    cause: "The connection pool was exhausted on the payments database.",
    isConfirmedAnalysis: false,
    fix: null,
    ...overrides,
  };
}

function summary(
  failures: Array<ServiceKnowledgeFailure>,
): ServiceKnowledgeSummary {
  return { serviceId: SERVICE.toString(), failures };
}

function renderCard(refreshToken?: number): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ServiceKnowledgeCard serviceId={SERVICE} refreshToken={refreshToken} />
    </MemoryRouter>,
  );
}

let getSummary: SpyInstance<typeof ServiceKnowledgeApi.getSummary>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { de: { translation: DE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  getSummary = jest.spyOn(ServiceKnowledgeApi, "getSummary");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("what OneUptime AI learned, on a service's overview", () => {
  test("asks once for the service, with a skeleton while it waits", async () => {
    let answer: (value: ServiceKnowledgeSummary) => void = (): void => {};
    getSummary.mockImplementation((): Promise<ServiceKnowledgeSummary> => {
      return new Promise<ServiceKnowledgeSummary>(
        (resolve: (value: ServiceKnowledgeSummary) => void) => {
          answer = resolve;
        },
      );
    });

    renderCard();

    expect(
      screen.getByTestId(SERVICE_AI_MEMORY_TEST_IDS.loading),
    ).toBeInTheDocument();
    expect(screen.getByText(KNOWLEDGE_CARD_TITLE)).toBeInTheDocument();

    await act(async (): Promise<void> => {
      answer(summary([]));
    });

    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary.mock.calls[0]![0].toString()).toBe(SERVICE.toString());
  });

  test("nothing learned says so, and how it is learned", async () => {
    getSummary.mockResolvedValue(summary([]));

    renderCard();

    expect(await screen.findByText(NOTHING_LEARNED_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(
        "OneUptime AI learns from this service's resolved incidents and alerts once their root cause is recorded, or once someone confirms its analysis.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SERVICE_AI_MEMORY_TEST_IDS.failure),
    ).not.toBeInTheDocument();
  });

  test("each failure: its cause as written, how often, when last, and its incidents and alerts as links", async () => {
    getSummary.mockResolvedValue(summary([failure()]));

    renderCard();

    const item: HTMLElement = await screen.findByTestId(
      SERVICE_AI_MEMORY_TEST_IDS.failure,
    );

    expect(
      within(item).getByText(
        "The connection pool was exhausted on the payments database.",
      ),
    ).toBeInTheDocument();
    expect(within(item).getByText("Seen 3 times")).toBeInTheDocument();
    expect(item.textContent).toContain("Last seen");

    const incident: HTMLElement = within(item).getByText("Incident #42");
    const alert: HTMLElement = within(item).getByText("Alert #7");

    expect(incident.closest("a")).toHaveAttribute(
      "href",
      getRecordRoute(failure().records[0]!).toString(),
    );
    expect(alert.closest("a")).toHaveAttribute(
      "href",
      getRecordRoute(failure().records[1]!).toString(),
    );
  });

  test("seen once is said in the one form", async () => {
    getSummary.mockResolvedValue(summary([failure({ count: 1 })]));

    renderCard();

    expect(await screen.findByText("Seen 1 time")).toBeInTheDocument();
    expect(SEEN_TIMES.one).toContain("{{count}}");
  });

  test("a confirmed analysis says it is one; a failure with no cause says what happened", async () => {
    getSummary.mockResolvedValue(
      summary([
        failure({ isConfirmedAnalysis: true }),
        failure({ cause: null, count: 2 }),
      ]),
    );

    renderCard();

    const items: Array<HTMLElement> = await screen.findAllByTestId(
      SERVICE_AI_MEMORY_TEST_IDS.failure,
    );

    expect(
      within(items[0]!).getByText("Confirmed AI analysis"),
    ).toBeInTheDocument();
    // No cause: the newest record's title says what happened.
    expect(within(items[1]!).getByText("Checkout is down")).toBeInTheDocument();
    expect(
      within(items[1]!).getByText("Cause not recorded"),
    ).toBeInTheDocument();
    expect(
      within(items[1]!).queryByText("Confirmed AI analysis"),
    ).not.toBeInTheDocument();
  });

  test("the fix that worked: a runbook by name, or the commands it ran as code", async () => {
    getSummary.mockResolvedValue(
      summary([
        failure({
          fix: { runbookName: "Recycle the connection pool", commands: [] },
        }),
        failure({
          fix: {
            runbookName: null,
            commands: ["kubectl rollout restart deploy/checkout"],
          },
        }),
      ]),
    );

    renderCard();

    const items: Array<HTMLElement> = await screen.findAllByTestId(
      SERVICE_AI_MEMORY_TEST_IDS.failure,
    );

    expect(items[0]!.textContent).toContain(
      "Fixed by running the runbook Recycle the connection pool",
    );

    const command: HTMLElement = within(items[1]!).getByText(
      "kubectl rollout restart deploy/checkout",
    );

    expect(command.tagName).toBe("CODE");
    expect(items[1]!.textContent).toContain("Fixed by running");
  });

  test("a failed read says what failed, and Try again asks again", async () => {
    getSummary
      .mockRejectedValueOnce(
        new ServiceKnowledgeApiError(
          "This service was not found, or you may not see it. Open it again from Services.",
          404,
        ),
      )
      .mockResolvedValueOnce(summary([failure()]));

    renderCard();

    const error: HTMLElement = await screen.findByTestId(
      SERVICE_AI_MEMORY_TEST_IDS.error,
    );

    expect(error.textContent).toContain(
      "What OneUptime AI learned could not be loaded.",
    );
    expect(error.textContent).toContain(
      "This service was not found, or you may not see it.",
    );

    fireEvent.click(screen.getByTestId(SERVICE_AI_MEMORY_TEST_IDS.tryAgain));

    expect(
      await screen.findByTestId(SERVICE_AI_MEMORY_TEST_IDS.failure),
    ).toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(2);
  });

  test("reads again when the page refreshes", async () => {
    getSummary.mockResolvedValue(summary([]));

    const view: ReturnType<typeof render> = renderCard(1);

    await screen.findByText(NOTHING_LEARNED_TITLE);

    view.rerender(
      <MemoryRouter>
        <ServiceKnowledgeCard serviceId={SERVICE} refreshToken={2} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getSummary).toHaveBeenCalledTimes(2);
    });
  });

  test("reads in the reader's language: German", async () => {
    getSummary.mockResolvedValue(summary([failure()]));

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    try {
      renderCard();

      const item: HTMLElement = await screen.findByTestId(
        SERVICE_AI_MEMORY_TEST_IDS.failure,
      );

      expect(screen.getByText(DE[KNOWLEDGE_CARD_TITLE]!)).toBeInTheDocument();
      expect(within(item).getByText("3-mal gesehen")).toBeInTheDocument();
      expect(within(item).getByText("Vorfall #42")).toBeInTheDocument();
    } finally {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage("en");
      });
    }
  });

  test("an incident opens its own page, an alert its own", () => {
    expect(getRecordRoute(failure().records[0]!).toString()).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: new ObjectID(INCIDENT),
      }).toString(),
    );
    expect(getRecordRoute(failure().records[1]!).toString()).toBe(
      RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW] as Route, {
        modelId: new ObjectID(ALERT),
      }).toString(),
    );
  });
});

describe("asking the server", () => {
  test("asks for the one service, with the project's headers", async () => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    const get: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          summary([]) as unknown as JSONObject,
          {},
        ) as never,
      );

    await expect(ServiceKnowledgeApi.getSummary(SERVICE)).resolves.toEqual(
      summary([]),
    );
    expect(String((get.mock.calls[0]![0] as { url: unknown }).url)).toBe(
      getServiceKnowledgeUrl(SERVICE).toString(),
    );
    expect(getServiceKnowledgeUrl(SERVICE).toString()).toContain(
      `/service-knowledge/${SERVICE.toString()}`,
    );
  });

  test("a refusal is said as the server said it", async () => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(API, "get").mockResolvedValue(
      new HTTPErrorResponse(
        404,
        {
          message:
            "This service was not found, or you may not see it. Open it again from Services.",
        },
        {},
      ) as never,
    );

    await expect(ServiceKnowledgeApi.getSummary(SERVICE)).rejects.toThrow(
      "This service was not found, or you may not see it.",
    );
  });

  test("an answer the card cannot draw is refused, saying what to do", async () => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { failures: "x" }, {}) as never,
      );

    await expect(ServiceKnowledgeApi.getSummary(SERVICE)).rejects.toThrow(
      ServiceAiMemoryCopy.COULD_NOT_READ_KNOWLEDGE,
    );
  });
});

describe("a note for OneUptime AI, in its list", () => {
  function note(withAuthor: boolean): ServiceAINote {
    const row: ServiceAINote = new ServiceAINote(ObjectID.generate());
    row.note = "Its database failover takes five minutes;\ndon't page for it.";
    row.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    if (withAuthor) {
      const user: User = new User();
      user.name = new Name("Maya Chen");
      user.email = new Email("maya@example.com");
      row.createdByUser = user;
    }

    return row;
  }

  test("is the team's words as written, with who added it and when", () => {
    render(<ServiceAiNoteCell note={note(true)} />);

    const cell: HTMLElement = screen.getByTestId(
      SERVICE_AI_MEMORY_TEST_IDS.noteCell,
    );

    expect(cell.textContent).toContain(
      "Its database failover takes five minutes;",
    );
    expect(cell.textContent).toContain("Added by Maya Chen");
  });

  test("one added through the API says so", () => {
    render(<ServiceAiNoteCell note={note(false)} />);

    expect(
      screen.getByTestId(SERVICE_AI_MEMORY_TEST_IDS.noteCell).textContent,
    ).toContain("Added through the API");
  });
});

describe("the service's overview", () => {
  const OVERVIEW: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index.tsx",
    ),
    "utf8",
  );

  test("draws both cards only while the project uses AI", () => {
    expect(OVERVIEW).toContain("const isAiOffered: boolean = useAiOffered();");
    expect(OVERVIEW).toMatch(
      /\{isAiOffered \? \(\s*<>\s*<ServiceKnowledgeCard[\s\S]*?<ServiceAiNotesTable serviceId=\{modelId\} \/>\s*<\/>\s*\) : \(\s*<><\/>\s*\)\}/,
    );
  });
});

describe("in every Dashboard language", () => {
  const WORDS: Array<string> = Object.entries(ServiceAiMemoryCopy)
    .filter(([name]: [string, unknown]): boolean => {
      return name !== "SERVICE_AI_MEMORY_TEST_IDS" && name !== "SEEN_TIMES";
    })
    .map(([, value]: [string, unknown]): string => {
      return value as string;
    });

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "%s words every sentence of the cards",
    (language: string) => {
      const missing: Array<string> = [
        ...WORDS,
        SEEN_TIMES.other,
        `${SEEN_TIMES.other}_one`,
      ].filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(missing).toEqual([]);
    },
  );
});
