import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getJestSpyOn } from "../../Spy";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ActiveMonitorLimitNotice, {
  ACTIVE_MONITOR_LIMIT_ROUTE,
  ActiveMonitorLimitAlert,
  ActiveMonitorLimitNoticeCopy,
  ActiveMonitorLimitNoticeShowWhen,
  getActiveMonitorLimitNoticeCopy,
  joinSentences,
  readActiveMonitorLimitIfReached,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ActiveMonitorLimitNotice";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../Types/Monitor/ActiveMonitorLimit";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __activeMonitorLimitConfig: MutableConfig }
).__activeMonitorLimitConfig = config;

/*
 * BILLING_ENABLED is read when the module loads, so it is a getter here,
 * switchable per test: a self-hosted install has no plans, and the notice
 * asks nothing there.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __activeMonitorLimitConfig: MutableConfig | undefined;
          }
        ).__activeMonitorLimitConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

/*
 * THE PLAN'S LIMIT ON ACTIVE MONITORS, SAID BEFORE ANYONE IS REFUSED
 * (Components/Monitor/ActiveMonitorLimitNotice).
 *
 * The support report: a project with a plan of 500 active monitors had
 * 2,881. The server now refuses every new active monitor at the limit;
 * this is what the Create Monitor page (at the limit or past it) and the
 * monitor list (past it) say first - which limit, how many the project
 * has, that what it has keeps running, what to do, and what counts (Manual
 * monitors never do, so one can still be added) - with a link to the plan.
 * It says nothing while the status loads, when it cannot be read, or when
 * the project has no limit. An action that makes several monitors at once
 * says the same, as the reason it did not start.
 */

const NOTICE: string = "active-monitor-limit-notice";

const MANUAL_NOTE: string =
  "Manual monitors don't count towards the limit, so you can still add them. Monitors that are turned off or archived do count.";

let getSpy: ReturnType<typeof getJestSpyOn>;

function answer(status: ActiveMonitorLimitStatus | JSONObject | null): void {
  getSpy.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      status === null
        ? ({} as JSONObject)
        : (("limit" in status
            ? {
                limit: status["limit"]
                  ? {
                      limit: (status["limit"] as { limit: number }).limit,
                      kind: (status["limit"] as { kind: string }).kind,
                    }
                  : null,
                activeMonitors: status["activeMonitors"] as number | null,
              }
            : status) as JSONObject),
      {},
    ) as never,
  );
}

/*
 * The request fails. Thrown from an async function, so the rejection is a
 * native promise's that the code under test awaits - not one made ahead of
 * time that the zone.js shim reports as unhandled before it is awaited.
 */
function failRequests(): void {
  getSpy.mockImplementation((async (): Promise<never> => {
    throw new Error("Network down");
  }) as never);
}

function renderNotice(showWhen: ActiveMonitorLimitNoticeShowWhen): void {
  render(
    <MemoryRouter>
      <ActiveMonitorLimitNotice showWhen={showWhen} />
    </MemoryRouter>,
  );
}

async function settled(): Promise<void> {
  await waitFor(() => {
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
  // Let the answer land.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

const PLAN_500: ActiveMonitorLimitStatus["limit"] = {
  limit: 500,
  kind: ActiveMonitorLimitKind.Plan,
};

const FREE_10: ActiveMonitorLimitStatus["limit"] = {
  limit: 10,
  kind: ActiveMonitorLimitKind.FreePlan,
};

beforeEach(() => {
  config.billingEnabled = true;
  goTo(`/dashboard/${PROJECT_ID}/monitors/create`);
  getSpy = getJestSpyOn(API, "get");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what it asks", () => {
  test("the project's limit, once, from the monitor API", async () => {
    answer({ limit: null, activeMonitors: null });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await settled();

    const url: URL = (getSpy.mock.calls[0]![0] as { url: URL }).url;
    expect(new window.URL(url.toString()).pathname).toBe(
      new window.URL(
        URL.fromString(APP_API_URL.toString())
          .addRoute(ACTIVE_MONITOR_LIMIT_ROUTE)
          .toString(),
      ).pathname,
    );
  });
});

describe("on Create Monitor (at the limit or past it)", () => {
  test("a project with no limit is told nothing", async () => {
    answer({ limit: null, activeMonitors: null });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await settled();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  test("under the limit, nothing", async () => {
    answer({ limit: PLAN_500, activeMonitors: 499 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await settled();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  test("at a plan's own limit: which limit, how many, what to do, what counts, and the plan", async () => {
    answer({ limit: PLAN_500, activeMonitors: 500 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent(
      "You've reached your plan's monitor limit",
    );
    expect(notice).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 500.",
    );
    expect(notice).toHaveTextContent(
      "To add more, delete monitors you no longer need or change your plan.",
    );
    expect(notice).toHaveTextContent(MANUAL_NOTE);
    expect(notice).not.toHaveTextContent("keep running");

    // Where it stands, then what to do with the plan's link after it, then what counts.
    expect(
      screen.getByTestId("active-monitor-limit-notice-state"),
    ).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 500.",
    );
    expect(
      screen.getByTestId("active-monitor-limit-notice-action"),
    ).toHaveTextContent(
      "To add more, delete monitors you no longer need or change your plan. View plan",
    );
    expect(
      screen.getByTestId("active-monitor-limit-notice-note"),
    ).toHaveTextContent(MANUAL_NOTE);

    const link: HTMLElement = screen.getByRole("link", { name: "View plan" });
    expect(link).toHaveAttribute("href", routeFor(PageMap.SETTINGS_BILLING));
  });

  // The support report's project.
  test("past a plan's own limit: its monitors keep running, and when it can add again", async () => {
    answer({ limit: PLAN_500, activeMonitors: 2881 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent("You're over your plan's monitor limit");
    expect(notice).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 2,881.",
    );
    expect(notice).toHaveTextContent(
      "All of them keep running, but no more can be added until the project has fewer than 500.",
    );
    expect(
      screen.getByTestId("active-monitor-limit-notice-state"),
    ).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 2,881. All of them keep running, but no more can be added until the project has fewer than 500.",
    );
  });

  /*
   * The Free plan includes no active monitor - each one on it is paid as
   * you go, at the rate the pricing card beside the notice quotes - so it
   * allows its number rather than including it.
   */
  test("at the Free plan's limit: it allows, rather than includes, its monitors; upgrade", async () => {
    answer({ limit: FREE_10, activeMonitors: 10 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent(
      "You've reached the Free plan's monitor limit",
    );
    expect(notice).toHaveTextContent(
      "The Free plan allows up to 10 active monitors, and this project has 10.",
    );
    expect(notice).not.toHaveTextContent("includes");
    expect(notice).toHaveTextContent("Upgrade your plan to add more.");
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_BILLING),
    );
  });

  test("past the Free plan's limit: over it, in its own words", async () => {
    answer({ limit: FREE_10, activeMonitors: 14 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent(
      "You're over the Free plan's monitor limit",
    );
    expect(
      screen.getByTestId("active-monitor-limit-notice-state"),
    ).toHaveTextContent(
      "The Free plan allows up to 10 active monitors, and this project has 14. All of them keep running, but no more can be added until the project has fewer than 10.",
    );
    expect(notice).toHaveTextContent("Upgrade your plan to add more.");
  });

  test("the titles say which limit and where the project stands, each its own", () => {
    const translator: Translator = createTranslator(undefined, "en");

    const titles: Array<string> = [
      { limit: PLAN_500, activeMonitors: 500 },
      { limit: PLAN_500, activeMonitors: 501 },
      { limit: FREE_10, activeMonitors: 10 },
      { limit: FREE_10, activeMonitors: 11 },
    ].map((status: ActiveMonitorLimitStatus): string => {
      return getActiveMonitorLimitNoticeCopy({
        status: status,
        translator: translator,
      })!.title;
    });

    expect(titles).toEqual([
      "You've reached your plan's monitor limit",
      "You're over your plan's monitor limit",
      "You've reached the Free plan's monitor limit",
      "You're over the Free plan's monitor limit",
    ]);
  });
});

describe("on the monitor list (past the limit only)", () => {
  test("at the limit, nothing: there is nothing wrong yet", async () => {
    answer({ limit: PLAN_500, activeMonitors: 500 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.OverLimit);
    await settled();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  test("past it, the project is told", async () => {
    answer({ limit: PLAN_500, activeMonitors: 2881 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.OverLimit);

    expect(await screen.findByTestId(NOTICE)).toHaveTextContent(
      "You're over your plan's monitor limit",
    );
  });
});

/*
 * The notice itself, for a status already read: what an action that makes
 * several monitors at once shows as the reason it did not start.
 */
describe("the notice for a status already read", () => {
  function renderAlert(status: ActiveMonitorLimitStatus): void {
    render(
      <MemoryRouter>
        <ActiveMonitorLimitAlert status={status} />
      </MemoryRouter>,
    );
  }

  test("asks nothing itself, and says the same as the page", () => {
    renderAlert({ limit: PLAN_500, activeMonitors: 2881 });

    expect(getSpy).not.toHaveBeenCalled();

    const notice: HTMLElement = screen.getByTestId(NOTICE);
    expect(notice).toHaveTextContent("You're over your plan's monitor limit");
    expect(notice).toHaveTextContent(MANUAL_NOTE);
    expect(screen.getByRole("link", { name: "View plan" })).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_BILLING),
    );
  });

  test("a warning, so it reads as one wherever it is", () => {
    renderAlert({ limit: FREE_10, activeMonitors: 10 });

    expect(screen.getByTestId(NOTICE)).toHaveClass("bg-amber-50");
    expect(screen.getByRole("alert")).toBe(screen.getByTestId(NOTICE));
  });

  test("nothing for a project with no limit", () => {
    renderAlert(NO_ACTIVE_MONITOR_LIMIT);

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});

describe("for an action that makes several monitors at once", () => {
  test("the status, when the project has no room left", async () => {
    answer({ limit: PLAN_500, activeMonitors: 500 });

    await expect(readActiveMonitorLimitIfReached()).resolves.toEqual({
      limit: PLAN_500,
      activeMonitors: 500,
    });
  });

  test("past the limit too", async () => {
    answer({ limit: FREE_10, activeMonitors: 14 });

    await expect(readActiveMonitorLimitIfReached()).resolves.toEqual({
      limit: FREE_10,
      activeMonitors: 14,
    });
  });

  test("nothing with room left, with no limit, or when it cannot tell", async () => {
    answer({ limit: PLAN_500, activeMonitors: 499 });
    await expect(readActiveMonitorLimitIfReached()).resolves.toBeNull();

    answer({ limit: null, activeMonitors: null });
    await expect(readActiveMonitorLimitIfReached()).resolves.toBeNull();

    failRequests();
    await expect(readActiveMonitorLimitIfReached()).resolves.toBeNull();
  });

  test("nothing asked on a self-hosted install", async () => {
    config.billingEnabled = false;

    await expect(readActiveMonitorLimitIfReached()).resolves.toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("on a self-hosted install", () => {
  test("there are no plans: nothing is asked and nothing drawn", async () => {
    config.billingEnabled = false;
    answer({ limit: PLAN_500, activeMonitors: 2881 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(getSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});

describe("when it cannot tell", () => {
  test("a request that fails draws nothing, and breaks nothing", async () => {
    failRequests();

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await settled();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  test("an answer nobody can vouch for draws nothing", async () => {
    answer({
      limit: { limit: "500", kind: "Plan" },
      activeMonitors: 2881,
    } as unknown as JSONObject);

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);
    await settled();

    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});

/*
 * Where Create Monitor puts it: first, above the Free plan's pricing card
 * and the form. On a phone the pricing card fills the screen, so a notice
 * under it was a scroll away from the one thing the page had to say.
 */
describe("on the Create Monitor page", () => {
  const createSource: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create.tsx",
    ),
    "utf8",
  );

  test("comes first: before the pricing card and the form", () => {
    const notice: number = createSource.indexOf("<ActiveMonitorLimitNotice");
    const pricing: number = createSource.indexOf("<MonitorPayAsYouGoCard");
    const form: number = createSource.indexOf('title="Create New Monitor"');

    expect(notice).toBeGreaterThan(-1);
    expect(pricing).toBeGreaterThan(notice);
    expect(form).toBeGreaterThan(pricing);
  });

  test("at the limit or past it", () => {
    expect(createSource).toContain(
      "showWhen={ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit}",
    );
  });
});

/*
 * The notice's words, looked up in the locale files as the Dashboard looks
 * them up: every sentence is a key the locales hold, with the reader's own
 * plural forms.
 */
describe("in the reader's language", () => {
  const LOCALES: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function translatorFor(language: string): Translator {
    const table: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    return createTranslator((key: string): string => {
      return table[key] || key;
    }, language);
  }

  function copyFor(
    language: string,
    status: ActiveMonitorLimitStatus,
  ): ActiveMonitorLimitNoticeCopy {
    return getActiveMonitorLimitNoticeCopy({
      status: status,
      translator: translatorFor(language),
    })!;
  }

  test("German, past a plan's own limit", () => {
    const copy: ActiveMonitorLimitNoticeCopy = copyFor("de", {
      limit: PLAN_500,
      activeMonitors: 2881,
    });

    expect(copy.title).toBe(
      "Sie haben das Monitor-Limit Ihres Tarifs überschritten",
    );
    expect(copy.state[0]).toBe(
      "Ihr Tarif umfasst 500 aktive Monitore, und dieses Projekt hat 2.881.",
    );
    expect(copy.state[1]).toBe(
      "Alle laufen weiter, aber es können keine weiteren hinzugefügt werden, bis das Projekt weniger als 500 hat.",
    );
    expect(copy.linkText).toBe("Tarif anzeigen");
  });

  test("German, at the Free plan's limit", () => {
    const copy: ActiveMonitorLimitNoticeCopy = copyFor("de", {
      limit: FREE_10,
      activeMonitors: 10,
    });

    expect(copy.title).toBe(
      "Sie haben das Monitor-Limit des Free-Tarifs erreicht",
    );
    expect(copy.state[0]).toBe(
      "Der Free-Tarif erlaubt bis zu 10 aktive Monitore, und dieses Projekt hat 10.",
    );
    expect(copy.linkText).toBe("Tarife anzeigen");
  });

  test("whole sentences run on with a space, and without one after a full-width full stop", () => {
    expect(joinSentences(["One.", "Two."])).toBe("One. Two.");
    expect(joinSentences(["一。", "二。"])).toBe("一。二。");
    expect(joinSentences(["Only."])).toBe("Only.");
    expect(joinSentences([])).toBe("");
  });

  test("a plan of one monitor takes the language's singular", () => {
    expect(
      copyFor("en", {
        limit: { limit: 1, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 1,
      }).state[0],
    ).toBe("Your plan includes 1 active monitor, and this project has 1.");
    expect(
      copyFor("en", {
        limit: { limit: 1, kind: ActiveMonitorLimitKind.FreePlan },
        activeMonitors: 1,
      }).state[0],
    ).toBe(
      "The Free plan allows up to 1 active monitor, and this project has 1.",
    );
    expect(
      copyFor("de", {
        limit: { limit: 1, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 1,
      }).state[0],
    ).toBe("Ihr Tarif umfasst 1 aktiven Monitor, und dieses Projekt hat 1.");
    expect(
      copyFor("de", {
        limit: { limit: 1, kind: ActiveMonitorLimitKind.FreePlan },
        activeMonitors: 1,
      }).state[0],
    ).toBe(
      "Der Free-Tarif erlaubt bis zu 1 aktiven Monitor, und dieses Projekt hat 1.",
    );
  });

  test.each([
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
  ])("%s has its own words for every sentence", (language: string) => {
    const STATES: Array<ActiveMonitorLimitStatus> = [
      { limit: PLAN_500, activeMonitors: 500 },
      { limit: PLAN_500, activeMonitors: 2881 },
      { limit: FREE_10, activeMonitors: 10 },
      { limit: FREE_10, activeMonitors: 14 },
    ];

    STATES.forEach((status: ActiveMonitorLimitStatus): void => {
      const englishCopy: ActiveMonitorLimitNoticeCopy = copyFor("en", status);
      const copy: ActiveMonitorLimitNoticeCopy = copyFor(language, status);

      expect(copy.title).not.toBe(englishCopy.title);
      expect(copy.linkText).not.toBe(englishCopy.linkText);
      expect(copy.action).not.toBe(englishCopy.action);
      expect(copy.note).not.toBe(englishCopy.note);
      expect(copy.state).toHaveLength(englishCopy.state.length);
      copy.state.forEach((sentence: string, at: number): void => {
        expect(sentence).not.toBe(englishCopy.state[at]);
        // Every value filled: no placeholder left for the reader to see.
        expect(sentence).not.toContain("{{");
      });
    });
  });
});
