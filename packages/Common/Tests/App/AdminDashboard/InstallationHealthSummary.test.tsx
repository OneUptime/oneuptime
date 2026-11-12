import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT NEEDS ATTENTION, AT THE TOP OF ONEUPTIME HEALTH (#6826).
 *
 * The Admin Dashboard shows the findings `npm run doctor` prints, in every
 * edition: worst first, each with its fix, a step of the server setup
 * checklist sending the admin to /admin/setup, a finding with a page of its
 * own linking it, a guide opening in a new tab. A healthy server says so in
 * one line, and a read that fails says so rather than drawing nothing. In
 * every language the Admin Dashboard speaks.
 */

const mockGet: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockGet(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      },
    },
  };
});

import InstallationHealthSummary, {
  INSTALLATION_HEALTH_API_ROUTE,
  INSTALLATION_HEALTH_COPY,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/InstallationHealthSummary";
import HealthIndex from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Index";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import InstallationHealthUtil, {
  INSTALLATION_HEALTH_SETUP_FIX,
  INSTALLATION_HEALTH_WORDS,
  InstallationHealthAnswer,
  InstallationHealthFacts,
  InstallationHealthFindingId,
} from "../../../Types/InstallationHealth/InstallationHealth";
import { JSONObject } from "../../../Types/JSON";
import {
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_STATUS_WORDS,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

const EARLIER: string = "2026-11-10T09:30:00.000Z";

function channel(
  name: ServerSendingChannel,
  state: ServerSendingState,
): {
  channel: ServerSendingChannel;
  state: ServerSendingState;
  hasWorked: boolean;
  lastWorkedAt: string | null;
  failingSince: string | null;
  lastFailure: string | null;
  setUpProblem: string | null;
} {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: state === ServerSendingState.Working ? EARLIER : null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };
}

// A server with a lot wrong: Valkey down, a disk filling, no email, an update.
function busyFacts(): InstallationHealthFacts {
  return {
    isPostgresConnected: true,
    isClickhouseConnected: true,
    isValkeyConnected: false,
    migrations: { pending: 0, failure: null },
    clickhouseDisks: [
      { name: "clickhouse default", freeInBytes: 15, totalInBytes: 100 },
    ],
    queues: [],
    version: {
      current: "14.0.100",
      latest: "14.0.108",
      isUpdateAvailable: true,
      isUpdateCheckDisabled: false,
    },
    serverSetup: ServerSetupChecklistUtil.getAnswer({
      facts: {
        isHttpsSetUp: true,
        areSignupsClosed: true,
        email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
        sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
        call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
        emailSentThrough: null,
        smsSentThrough: "Twilio",
        callSentThrough: "Twilio",
        globalProbes: { total: 1, reporting: 1 },
        updateChecks: {
          isDisabled: false,
          lastCheckedAt: EARLIER,
          lastFailure: null,
        },
        lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
        hasScheduledBackups: true,
        isBrowserPushSetUp: true,
        hasAiProvider: true,
        hasSingleSignOn: true,
        choices: { choices: {}, hiddenBy: {} },
      },
      readerUserId: null,
    }),
  };
}

function answerOf(facts: InstallationHealthFacts): JSONObject {
  const answer: InstallationHealthAnswer = InstallationHealthUtil.getAnswer({
    facts: facts,
    addressProof: null,
    checkedAt: EARLIER,
  });

  return JSON.parse(JSON.stringify(answer)) as JSONObject;
}

const respond: (data: JSONObject) => void = (data: JSONObject): void => {
  mockGet.mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
};

async function renderIn(
  locale: string,
  element: React.ReactElement = <InstallationHealthSummary />,
): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );

  await flush();
}

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the card", () => {
  test("asks the doctor's route", async () => {
    respond(answerOf({ ...busyFacts(), isValkeyConnected: true }));

    await renderIn("en");

    const url: URL = (mockGet.mock.calls[0]?.[0] as { url: URL }).url;
    const pathname: string = new globalThis.URL(url.toString()).pathname;

    expect(pathname.slice(pathname.indexOf("/admin/health/"))).toBe(
      INSTALLATION_HEALTH_API_ROUTE,
    );
  });

  test("a healthy server says so in one line", async () => {
    respond({ findings: [], checked: [], version: {}, checkedAt: EARLIER });

    await renderIn("en");

    expect(screen.getByText(INSTALLATION_HEALTH_COPY.title)).toBeVisible();
    expect(
      screen.getByTestId("installation-health-all-right"),
    ).toHaveTextContent("Everything looks right.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  test("worst first, each with its words and its fix", async () => {
    respond(answerOf(busyFacts()));

    await renderIn("en");

    const rows: Array<HTMLElement> = screen.getAllByRole("listitem");

    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-testid");
      }),
    ).toEqual([
      `installation-health-${InstallationHealthFindingId.Valkey}`,
      "installation-health-setup-email",
      `installation-health-${InstallationHealthFindingId.ClickhouseDisk}`,
      `installation-health-${InstallationHealthFindingId.UpdateAvailable}`,
    ]);
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-level");
      }),
    ).toEqual(["fix", "fix", "warn", "warn"]);
    expect(rows[0]).toHaveTextContent(
      "Valkey Valkey does not answer, so background jobs and live updates stop.",
    );
    expect(rows[0]).toHaveTextContent(
      "Check that Valkey is running, and read its log for the reason.",
    );
  });

  test("a step of the server setup checklist, in its own words, sends the admin to Server setup", async () => {
    respond(answerOf(busyFacts()));

    await renderIn("en");

    const email: HTMLElement = screen.getByTestId(
      "installation-health-setup-email",
    );

    expect(email).toHaveTextContent(
      String(SERVER_SETUP_STATUS_WORDS.email["not-set-up"]),
    );
    expect(
      within(email).getByRole("link", { name: INSTALLATION_HEALTH_SETUP_FIX }),
    ).toHaveAttribute("href", "/admin/setup");
  });

  test("a finding with a page of its own links it; one with a guide opens it in a new tab", async () => {
    respond(answerOf(busyFacts()));

    await renderIn("en");

    expect(
      within(
        screen.getByTestId(
          `installation-health-${InstallationHealthFindingId.ClickhouseDisk}`,
        ),
      ).getByRole("link", { name: "ClickHouse disk" }),
    ).toHaveAttribute("href", "/admin/health/clickhouse");

    const guide: HTMLElement = within(
      screen.getByTestId(
        `installation-health-${InstallationHealthFindingId.UpdateAvailable}`,
      ),
    ).getByRole("link", { name: "Read the guide" });

    expect(guide).toHaveAttribute("href", "/docs/installation/upgrading");
    expect(guide).toHaveAttribute("target", "_blank");
  });

  test("a read that fails says so", async () => {
    mockGet.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}),
    );

    await renderIn("en");

    expect(screen.getByTestId("installation-health")).toHaveTextContent(
      INSTALLATION_HEALTH_COPY.loadError,
    );
  });

  test("an answer that is not one says so too", async () => {
    respond({ html: "<p>proxy error</p>" });

    await renderIn("en");

    expect(screen.getByTestId("installation-health")).toHaveTextContent(
      INSTALLATION_HEALTH_COPY.loadError,
    );
  });

  test("it opens the OneUptime Health page, above everything else", async () => {
    mockGet.mockImplementation(async (data: unknown): Promise<unknown> => {
      const url: string = String((data as { url: URL }).url);

      if (url.endsWith(INSTALLATION_HEALTH_API_ROUTE)) {
        return new HTTPResponse<JSONObject>(200, answerOf(busyFacts()), {});
      }

      return new HTTPErrorResponse(404, {}, {});
    });

    await renderIn("en", <HealthIndex />);

    const card: HTMLElement = screen.getByTestId("installation-health");
    const later: Array<HTMLElement> = screen.queryAllByText(
      "Available on every edition",
    );

    expect(card).toBeVisible();
    expect(later.length).toBeGreaterThan(0);
    expect(
      card.compareDocumentPosition(later[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/*
 * Every word the card can show: its own, each finding's title, words and
 * fix, and the checklist's titles and status words, which the card reuses.
 */
const CARD_WORDS: Array<string> = [
  INSTALLATION_HEALTH_COPY.title,
  INSTALLATION_HEALTH_COPY.description,
  INSTALLATION_HEALTH_COPY.allRight,
  INSTALLATION_HEALTH_COPY.loadError,
  INSTALLATION_HEALTH_COPY.readTheGuide,
  INSTALLATION_HEALTH_SETUP_FIX,
  ...Object.values(INSTALLATION_HEALTH_WORDS).flatMap(
    (words: { title: string; words: string; fix: string }): Array<string> => {
      return [words.title, words.words, words.fix];
    },
  ),
  ...SERVER_SETUP_CHECKS.map((check: { title: string }): string => {
    return check.title;
  }),
  ...Object.values(SERVER_SETUP_STATUS_WORDS).flatMap(
    (byStatus: Record<string, string | undefined>): Array<string> => {
      return Object.values(byStatus).filter(
        (words: string | undefined): words is string => {
          return Boolean(words);
        },
      );
    },
  ),
];

// Names that are the same in every language.
const SAME_EVERYWHERE: Array<string> = ["PostgreSQL", "ClickHouse", "Valkey"];

describe("in every language the Admin Dashboard speaks", () => {
  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s has every word, with its placeholders, in its own language",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const english: Locale = readLocale("en");

      for (const words of CARD_WORDS) {
        expect({ words, english: english[words] }).toEqual({
          words,
          english: words,
        });
        expect({ language, words, has: typeof locale[words] }).toEqual({
          language,
          words,
          has: "string",
        });
        expect(getTemplatePlaceholders(String(locale[words])).sort()).toEqual(
          getTemplatePlaceholders(words).sort(),
        );

        // A sentence is always the language's own; a title may be a loanword ("Version", "Backups").
        if (
          !SAME_EVERYWHERE.includes(words) &&
          words.includes(" ") &&
          words.endsWith(".")
        ) {
          expect({ language, words, same: locale[words] === words }).toEqual({
            language,
            words,
            same: false,
          });
        }
      }
    },
  );

  test.each(["de", "fa", "ja"])(
    "the card reads in %s",
    async (language: string) => {
      respond(answerOf(busyFacts()));

      await renderIn(language);

      const locale: Locale = readLocale(language);
      const card: HTMLElement = screen.getByTestId("installation-health");
      const text: string = withoutIsolateMarks(card.textContent || "");

      expect(text).toContain(
        String(
          locale[
            INSTALLATION_HEALTH_WORDS[InstallationHealthFindingId.Valkey].words
          ],
        ),
      );
      expect(text).toContain(String(locale[INSTALLATION_HEALTH_SETUP_FIX]));
      expect(text).toContain(
        String(
          locale[
            INSTALLATION_HEALTH_WORDS[
              InstallationHealthFindingId.UpdateAvailable
            ].words
          ],
        )
          .replace("{{current}}", "14.0.100")
          .replace("{{latest}}", "14.0.108"),
      );
      expect(text).not.toContain("does not answer");
    },
  );
});
