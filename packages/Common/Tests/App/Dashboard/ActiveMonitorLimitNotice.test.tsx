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
import { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ActiveMonitorLimitNotice, {
  ACTIVE_MONITOR_LIMIT_ROUTE,
  ActiveMonitorLimitNoticeCopy,
  ActiveMonitorLimitNoticeShowWhen,
  getActiveMonitorLimitNoticeCopy,
  joinSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ActiveMonitorLimitNotice";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
} from "../../../Types/Monitor/ActiveMonitorLimit";
import API from "../../../UI/Utils/API/API";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

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
 * has, that what it has keeps running, what to do, and what counts - with
 * a link to the plan. It says nothing while the status loads, when it
 * cannot be read, or when the project has no limit.
 */

const NOTICE: string = "active-monitor-limit-notice";

let getSpy: SpyInstance<typeof API.get>;

function answer(status: ActiveMonitorLimitStatus | JSONObject | null): void {
  getSpy.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      status === null
        ? ({} as JSONObject)
        : ("limit" in status
            ? {
                limit: status["limit"]
                  ? {
                      limit: (status["limit"] as { limit: number }).limit,
                      kind: (status["limit"] as { kind: string }).kind,
                    }
                  : null,
                activeMonitors: status["activeMonitors"] as number | null,
              }
            : status) as JSONObject,
      {},
    ) as never,
  );
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
  goTo(`/dashboard/${PROJECT_ID}/monitors/create`);
  getSpy = jest.spyOn(API, "get");
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
      `/api${ACTIVE_MONITOR_LIMIT_ROUTE}`,
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

    expect(notice).toHaveTextContent("You've reached your plan's monitor limit");
    expect(notice).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 500.",
    );
    expect(notice).toHaveTextContent(
      "To add more, delete monitors you no longer need or change your plan.",
    );
    expect(notice).toHaveTextContent(
      "Manual monitors don't count towards the limit. Monitors that are turned off or archived do.",
    );
    expect(notice).not.toHaveTextContent("keeps running");

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
    ).toHaveTextContent(
      "Manual monitors don't count towards the limit. Monitors that are turned off or archived do.",
    );

    const link: HTMLElement = screen.getByRole("link", { name: "View plan" });
    expect(link).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_BILLING),
    );
  });

  // The support report's project.
  test("past a plan's own limit: its monitors keep running, and when it can add again", async () => {
    answer({ limit: PLAN_500, activeMonitors: 2881 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent(
      "This project has more active monitors than its plan includes",
    );
    expect(notice).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 2,881.",
    );
    expect(notice).toHaveTextContent(
      "Every monitor it has keeps running, but no new one can be added until it has fewer than 500.",
    );
    expect(
      screen.getByTestId("active-monitor-limit-notice-state"),
    ).toHaveTextContent(
      "Your plan includes 500 active monitors, and this project has 2,881. Every monitor it has keeps running, but no new one can be added until it has fewer than 500.",
    );
  });

  test("at the Free plan's limit: upgrade", async () => {
    answer({ limit: FREE_10, activeMonitors: 10 });

    renderNotice(ActiveMonitorLimitNoticeShowWhen.AtOrOverLimit);

    const notice: HTMLElement = await screen.findByTestId(NOTICE);

    expect(notice).toHaveTextContent(
      "You've reached the Free plan's monitor limit",
    );
    expect(notice).toHaveTextContent(
      "The Free plan includes 10 active monitors, and this project has 10.",
    );
    expect(notice).toHaveTextContent("Upgrade your plan to add more.");
    expect(
      screen.getByRole("link", { name: "View plans" }),
    ).toHaveAttribute("href", routeFor(PageMap.SETTINGS_BILLING));
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
      "This project has more active monitors than its plan includes",
    );
  });
});

describe("when it cannot tell", () => {
  test("a request that fails draws nothing, and breaks nothing", async () => {
    getSpy.mockRejectedValue(new Error("Network down") as never);

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
      "Dieses Projekt hat mehr aktive Monitore, als sein Tarif umfasst",
    );
    expect(copy.state[0]).toBe(
      "Ihr Tarif umfasst 500 aktive Monitore, und dieses Projekt hat 2.881.",
    );
    expect(copy.linkText).toBe("Tarif anzeigen");
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
      copyFor("de", {
        limit: { limit: 1, kind: ActiveMonitorLimitKind.Plan },
        activeMonitors: 1,
      }).state[0],
    ).toBe("Ihr Tarif umfasst 1 aktiven Monitor, und dieses Projekt hat 1.");
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
    const english: Array<ActiveMonitorLimitNoticeCopy> = [
      copyFor("en", { limit: PLAN_500, activeMonitors: 2881 }),
      copyFor("en", { limit: FREE_10, activeMonitors: 10 }),
    ];
    const translated: Array<ActiveMonitorLimitNoticeCopy> = [
      copyFor(language, { limit: PLAN_500, activeMonitors: 2881 }),
      copyFor(language, { limit: FREE_10, activeMonitors: 10 }),
    ];

    translated.forEach(
      (copy: ActiveMonitorLimitNoticeCopy, index: number): void => {
        const englishCopy: ActiveMonitorLimitNoticeCopy = english[index]!;

        expect(copy.title).not.toBe(englishCopy.title);
        expect(copy.linkText).not.toBe(englishCopy.linkText);
        expect(copy.action).not.toBe(englishCopy.action);
        expect(copy.note).not.toBe(englishCopy.note);
        copy.state.forEach((sentence: string, at: number): void => {
          expect(sentence).not.toBe(englishCopy.state[at]);
          // Every value filled: no placeholder left for the reader to see.
          expect(sentence).not.toContain("{{");
        });
      },
    );
  });
});
