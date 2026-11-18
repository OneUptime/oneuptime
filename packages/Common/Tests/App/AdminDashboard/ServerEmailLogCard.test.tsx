import "@testing-library/jest-dom";
import {
  afterEach,
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
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { getJestSpyOn } from "../../Spy";
import ServerEmailLogCard, {
  INVITATION_TEMPLATE_NAME,
  SERVER_EMAIL_LOG_CARD_TEST_ID,
  SERVER_EMAIL_LOG_COPY,
  SERVER_EMAIL_LOG_ENTRY_TEST_ID,
  SERVER_EMAIL_LOG_FAILED_ONLY_TEST_ID,
  SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID,
  SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID,
  getUnsentInvitation,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/ServerEmailLogCard";
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import {
  SERVER_EMAIL_LOG_FAILED_ONLY_QUERY,
  SERVER_EMAIL_LOG_ROUTE,
  SERVER_EMAIL_LOG_SKIP_QUERY,
  ServerEmailLogAnswer,
  ServerEmailLogEntry,
  ServerEmailLogStatus,
} from "../../../Types/Email/ServerEmailLog";
import { JSONObject } from "../../../Types/JSON";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "../../../Types/ServerSending/ServerSendingWords";
import API from "../../../UI/Utils/API/API";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE SERVER'S EMAIL LOG, ON SETTINGS > EMAILS (#6878).
 *
 * The card reads one page of the log, newest first, and draws each email:
 * whom it went to, when, whether it went, what it was (OneUptime's subject,
 * or a project's template) and for which project - or none - and, for one
 * that failed, the mail service's answer, or where to set email up when it
 * never was. "Failed emails only" asks for the failed ones, "Show more" for
 * the next page, and an email already shown is not shown twice. The card
 * says how long the log keeps an email, and every word is in the reader's
 * language.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, string>;

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

function entry(
  id: string,
  overrides: Partial<ServerEmailLogEntry> = {},
): ServerEmailLogEntry {
  return {
    id: id,
    at: "2026-11-17T09:30:00.000Z",
    toEmail: `${id}@example.test`,
    subject: "Password Reset Request for OneUptime",
    templateName: "ForgotPassword",
    status: ServerEmailLogStatus.Sent,
    statusMessage: null,
    projectId: null,
    projectName: null,
    ...overrides,
  };
}

interface Asked {
  method: HTTPMethod;
  url: string;
}

let asked: Array<Asked> = [];
// The pages the server answers, in turn; an Error answers a failed read.
let pages: Array<ServerEmailLogAnswer | Error> = [];

function page(
  entries: Array<ServerEmailLogEntry>,
  hasMore: boolean = false,
  retentionInDays: number = 30,
): ServerEmailLogAnswer {
  return { entries, hasMore, retentionInDays };
}

beforeEach(() => {
  asked = [];
  pages = [];

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const request: { method: HTTPMethod; url: URL } = options as {
        method: HTTPMethod;
        url: URL;
      };

      asked.push({ method: request.method, url: String(request.url) });

      const next: ServerEmailLogAnswer | Error | undefined = pages.shift();

      if (next instanceof Error || next === undefined) {
        return new HTTPErrorResponse(500, { message: "Not now." }, {});
      }

      return new HTTPResponse<JSONObject>(
        200,
        next as unknown as JSONObject,
        {},
      );
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderIn(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ServerEmailLogCard />
    </I18nextProvider>,
  );

  await flush();
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(SERVER_EMAIL_LOG_ENTRY_TEST_ID);
}

function queryOf(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1] || "");
}

describe("reading the log", () => {
  test("asks for the first page of every email, once, by a GET", async () => {
    pages = [page([entry("a")])];

    await renderIn();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe(HTTPMethod.GET);
    expect(asked[0]!.url.split("?")[0]!.endsWith(SERVER_EMAIL_LOG_ROUTE)).toBe(
      true,
    );
    expect(queryOf(asked[0]!.url).has(SERVER_EMAIL_LOG_FAILED_ONLY_QUERY)).toBe(
      false,
    );
    expect(queryOf(asked[0]!.url).has(SERVER_EMAIL_LOG_SKIP_QUERY)).toBe(false);
  });

  test("an email of no project: to whom, when, sent, its subject and no project", async () => {
    pages = [page([entry("alice")])];

    await renderIn();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("alice@example.test");
    expect(rows()[0]).toHaveTextContent("Sent");
    expect(rows()[0]).toHaveTextContent("Password Reset Request for OneUptime");
    expect(rows()[0]).toHaveTextContent("No project");
    expect(rows()[0]).toHaveTextContent("2026");
  });

  test("a project's email that failed: its template, its project and the mail service's answer", async () => {
    pages = [
      page([
        entry("bob", {
          subject: null,
          templateName: "IncidentCreated",
          status: ServerEmailLogStatus.Failed,
          statusMessage: "535 5.7.8 Authentication failed",
          projectId: "68780000-0000-4000-8000-000000000001",
          projectName: "Checkout",
        }),
      ]),
    ];

    await renderIn();

    expect(rows()[0]).toHaveTextContent("Failed");
    expect(rows()[0]).toHaveTextContent("Template: IncidentCreated");
    expect(rows()[0]).toHaveTextContent("Checkout");
    expect(rows()[0]).toHaveTextContent("535 5.7.8 Authentication failed");
    expect(rows()[0]).not.toHaveTextContent("No project");
  });

  test("a project that no longer exists is said to be deleted", async () => {
    pages = [
      page([
        entry("carol", {
          subject: null,
          status: ServerEmailLogStatus.Failed,
          statusMessage: "421 Try again later",
          projectId: "68780000-0000-4000-8000-000000000002",
          projectName: null,
        }),
      ]),
    ];

    await renderIn();

    expect(rows()[0]).toHaveTextContent("A deleted project");
  });

  test("an email that never went because email is not set up says where to set it up", async () => {
    pages = [
      page([
        entry("dave", {
          status: ServerEmailLogStatus.Failed,
          statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
        }),
      ]),
    ];

    await renderIn();

    expect(rows()[0]).toHaveTextContent(SERVER_EMAIL_LOG_COPY.notSetUp);
    expect(rows()[0]).not.toHaveTextContent("Ask your server's admin");
  });

  test("an email that went shows no status message", async () => {
    pages = [
      page([
        entry("erin", {
          statusMessage: "Email sent. OneUptime does not track delivery.",
        }),
      ]),
    ];

    await renderIn();

    expect(rows()[0]).not.toHaveTextContent("does not track delivery");
  });

  test("says how long an email is kept, as the server answers it", async () => {
    pages = [page([entry("a")], false, 3)];

    await renderIn();

    expect(screen.getByText(/kept for 3 days/)).toBeInTheDocument();
  });

  test("an empty log says so", async () => {
    pages = [page([])];

    await renderIn();

    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId(SERVER_EMAIL_LOG_CARD_TEST_ID)).toHaveTextContent(
      SERVER_EMAIL_LOG_COPY.noEmailsYet,
    );
  });

  test("a log that cannot be read says so, and can be read again", async () => {
    pages = [new Error("down"), page([entry("a")])];

    await renderIn();

    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId(SERVER_EMAIL_LOG_CARD_TEST_ID)).toHaveTextContent(
      "Not now.",
    );
  });
});

describe("the failed emails only", () => {
  test("ask the server for the failed emails, and say when there are none", async () => {
    pages = [page([entry("a")]), page([])];

    await renderIn();

    fireEvent.click(screen.getByTestId(SERVER_EMAIL_LOG_FAILED_ONLY_TEST_ID));
    await flush();

    expect(asked).toHaveLength(2);
    expect(queryOf(asked[1]!.url).get(SERVER_EMAIL_LOG_FAILED_ONLY_QUERY)).toBe(
      "true",
    );
    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId(SERVER_EMAIL_LOG_CARD_TEST_ID)).toHaveTextContent(
      SERVER_EMAIL_LOG_COPY.noFailedEmails,
    );
  });
});

describe("show more", () => {
  test("asks for the next page and adds it, without an email shown twice", async () => {
    const first: Array<ServerEmailLogEntry> = Array.from(Array(25).keys()).map(
      (index: number): ServerEmailLogEntry => {
        return entry(`first${index}`);
      },
    );

    pages = [
      page(first, true),
      // An email sent since pushed the last one of the first page down.
      page([entry("first24"), entry("older")], false),
    ];

    await renderIn();

    expect(rows()).toHaveLength(25);

    fireEvent.click(screen.getByTestId(SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID));
    await flush();

    expect(queryOf(asked[1]!.url).get(SERVER_EMAIL_LOG_SKIP_QUERY)).toBe("25");
    expect(rows()).toHaveLength(26);
    expect(rows()[25]).toHaveTextContent("older@example.test");
    expect(
      screen.queryByTestId(SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("is not offered when there is nothing older", async () => {
    pages = [page([entry("a")], false)];

    await renderIn();

    expect(
      screen.queryByTestId(SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  const WORDS: Array<string> = [
    SERVER_EMAIL_LOG_COPY.title,
    SERVER_EMAIL_LOG_COPY.description.other,
    `${SERVER_EMAIL_LOG_COPY.description.other}_one`,
    SERVER_EMAIL_LOG_COPY.failedOnly,
    SERVER_EMAIL_LOG_COPY.sent,
    SERVER_EMAIL_LOG_COPY.failed,
    SERVER_EMAIL_LOG_COPY.noProject,
    SERVER_EMAIL_LOG_COPY.deletedProject,
    SERVER_EMAIL_LOG_COPY.template,
    SERVER_EMAIL_LOG_COPY.notSetUp,
    SERVER_EMAIL_LOG_COPY.noEmailsYet,
    SERVER_EMAIL_LOG_COPY.noFailedEmails,
    SERVER_EMAIL_LOG_COPY.showMore,
    SERVER_EMAIL_LOG_COPY.couldNotLoad,
    SERVER_EMAIL_LOG_COPY.invitationStillJoins,
  ];

  test("English holds every word, and its one-day form", () => {
    const english: Locale = readLocale("en");

    for (const word of WORDS) {
      expect(english[word]).toBeTruthy();
    }

    expect(english[`${SERVER_EMAIL_LOG_COPY.description.other}_one`]).toBe(
      SERVER_EMAIL_LOG_COPY.description.one,
    );
  });

  test.each(
    ADMIN_DASHBOARD_LANGUAGES.map((code: string) => {
      return [code];
    }),
  )("%s words every one of them", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const word of WORDS) {
      expect(locale[word]).toBeTruthy();
      expect(locale[word]).not.toBe(word.replace(/_one$/, ""));
    }

    expect(locale[SERVER_EMAIL_LOG_COPY.description.other]).toContain(
      "{{count}}",
    );
    expect(locale[SERVER_EMAIL_LOG_COPY.template]).toContain("{{name}}");
  });

  test("a German reader reads the card in German", async () => {
    pages = [
      page([
        entry("frank", {
          status: ServerEmailLogStatus.Failed,
          statusMessage: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
        }),
      ]),
    ];

    await renderIn("de");

    const german: Locale = readLocale("de");
    const card: HTMLElement = screen.getByTestId(SERVER_EMAIL_LOG_CARD_TEST_ID);

    expect(screen.getByText(german[SERVER_EMAIL_LOG_COPY.title]!)).toBeTruthy();
    expect(card).toHaveTextContent(german[SERVER_EMAIL_LOG_COPY.failedOnly]!);
    expect(card).toHaveTextContent(german[SERVER_EMAIL_LOG_COPY.failed]!);
    expect(card).toHaveTextContent(german[SERVER_EMAIL_LOG_COPY.noProject]!);
    expect(card).toHaveTextContent(german[SERVER_EMAIL_LOG_COPY.notSetUp]!);
  });
});

/*
 * AN INVITATION EMAIL THE SERVER FAILED TO SEND (#7169).
 *
 * The person invited never heard of it, so its row says they can still
 * join, and offers Get Invitation Link: the dialog reads the link by the
 * project and the address the email went to (POST /team-member/
 * invitation-link), and says that this email was not sent - it may have
 * failed on a server that sends others.
 */
describe("an invitation email that was not sent", () => {
  const PROJECT_ID: string = "76100000-0000-4000-8000-000000000001";
  const LINK: string =
    "https://oneuptime.example.test/accounts/register?email=grace%40walk.example&token=76100000-0000-4000-8000-0000000000ff";

  function failedInvitation(
    overrides: Partial<ServerEmailLogEntry> = {},
  ): ServerEmailLogEntry {
    return entry("grace", {
      toEmail: "grace@walk.example",
      subject: null,
      templateName: INVITATION_TEMPLATE_NAME,
      status: ServerEmailLogStatus.Failed,
      statusMessage: "535 Authentication failed",
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      ...overrides,
    });
  }

  let linkAsks: Array<JSONObject> = [];

  beforeEach(() => {
    linkAsks = [];

    // The log's pages as before, and the invitation link's own answer.
    getJestSpyOn(API, "fetch").mockImplementation(
      async (options: unknown): Promise<unknown> => {
        const request: { method: HTTPMethod; url: URL; data?: JSONObject } =
          options as { method: HTTPMethod; url: URL; data?: JSONObject };

        if (String(request.url).endsWith(INVITATION_LINK_ROUTE)) {
          linkAsks.push(request.data || {});

          return new HTTPResponse<JSONObject>(
            200,
            {
              link: LINK,
              isRegistered: false,
              isAccepted: false,
              email: "grace@walk.example",
            },
            {},
          );
        }

        asked.push({ method: request.method, url: String(request.url) });

        const next: ServerEmailLogAnswer | Error | undefined = pages.shift();

        if (next instanceof Error || next === undefined) {
          return new HTTPErrorResponse(500, { message: "Not now." }, {});
        }

        return new HTTPResponse<JSONObject>(
          200,
          next as unknown as JSONObject,
          {},
        );
      },
    );
  });

  test("names the invitation's template as the log does", () => {
    expect(INVITATION_TEMPLATE_NAME).toBe("InviteMember");
    expect(getUnsentInvitation(failedInvitation())).toEqual({
      projectId: PROJECT_ID,
      email: "grace@walk.example",
    });
  });

  test("says they can still join, and offers their invitation link", async () => {
    pages = [page([failedInvitation()])];

    await renderIn();

    expect(rows()[0]).toHaveTextContent(
      "They can still join: send them their invitation link yourself.",
    );
    expect(
      screen.getByTestId(SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID),
    ).toHaveTextContent("Get Invitation Link");
  });

  test("reads the link by the project and the address, and says this email was not sent", async () => {
    pages = [page([failedInvitation()])];

    await renderIn();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID),
      );
    });
    await flush();

    expect(linkAsks).toEqual([
      { projectId: PROJECT_ID, email: "grace@walk.example" },
    ]);
    expect(
      await screen.findByTestId("invitation-link-value"),
    ).toHaveTextContent(LINK);
    expect(
      screen.getByText(
        "The invitation email to grace@walk.example was not sent. Copy this link and send it yourself. It works once, only for this address, for 7 days.",
      ),
    ).toBeTruthy();
  });

  test.each([
    ["an invitation that was sent", { status: ServerEmailLogStatus.Sent }],
    [
      "a failed email of another kind",
      { templateName: "ForgotPassword", projectId: null, projectName: null },
    ],
    [
      "a failed invitation that names no project",
      { projectId: null, projectName: null },
    ],
  ] as Array<[string, Partial<ServerEmailLogEntry>]>)(
    "%s offers no link",
    async (_case: string, overrides: Partial<ServerEmailLogEntry>) => {
      pages = [page([failedInvitation(overrides)])];

      await renderIn();

      expect(
        screen.queryByTestId(SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID),
      ).toBeNull();
      expect(getUnsentInvitation(failedInvitation(overrides))).toBeNull();
    },
  );

  test.each(
    ADMIN_DASHBOARD_LANGUAGES.map((code: string) => {
      return [code];
    }),
  )("%s words the line and the dialog's words for it", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const word of [
      SERVER_EMAIL_LOG_COPY.invitationStillJoins,
      INVITATION_LINK_COPY.notSentDescription,
      INVITATION_LINK_COPY.notSentRegisteredDescription,
      INVITATION_LINK_COPY.notSentMemberDescription,
      INVITATION_LINK_COPY.notSentFailed,
    ]) {
      expect(locale[word]).toBeTruthy();
      expect(locale[word]).not.toBe(word);

      if (word.includes("{{email}}")) {
        expect(locale[word]).toContain("{{email}}");
      }
    }
  });
});
