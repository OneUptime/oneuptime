import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * FINISH SETTING UP THIS SERVER: THE ADMIN DASHBOARD'S SERVER SETUP PAGE
 * (#6824, after #5229's three-item card on Admin > Users).
 *
 * Every check the server answers, in three sections - required (email,
 * HTTPS, who can sign up), recommended (SMS and calls, probes, backups,
 * update checks) and, folded, optional (browser push, AI, single sign-on).
 * Each row says what it is for and where it stands, what that was checked
 * against ("smtp.example.com accepted an email on ...", "Chosen by Ada
 * Lovelace on ..."), and offers the one thing to do next: the page that
 * sets it up, a test send, a guide, or the admin's own choice ("Use email
 * and push only", "This server is backed up"), which can be undone.
 *
 * HTTPS is the one check this page knows more about than the server: a
 * proxy in front that OneUptime was not told about, and an http:// visit
 * to a server set to HTTPS, are each said as what they are. In every
 * language the Admin Dashboard speaks.
 */

let mockHttpProtocol: string = "http";
let mockHost: string = "oneuptime.example.com";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocol: typeof import("../../../Types/API/Protocol") =
    jest.requireActual(
      "../../../Types/API/Protocol",
    ) as typeof import("../../../Types/API/Protocol");
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "HTTP_PROTOCOL", {
    get: (): unknown => {
      return mockHttpProtocol === "https"
        ? protocol.default.HTTPS
        : protocol.default.HTTP;
    },
  });
  Object.defineProperty(mocked, "HOST", {
    get: (): string => {
      return mockHost;
    },
  });

  return mocked;
});

import ServerSetupChecklist, {
  formatServerSetupTime,
  getHttpsAddress,
  getServerSetupRows,
  isHttpsOnlyBeforeOneUptime,
  isOpenedOverHttpWhileSetToHttps,
  isServedOverHttps,
  SERVER_SETUP_COPY,
  ServerSetupAction,
  ServerSetupRow,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerSetupChecklist";
import { SERVER_TEST_CARD_COPY } from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestCard";
import {
  SERVER_SETUP_PAGE_LOAD_ERROR,
  SERVER_SETUP_PAGE_TITLE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Setup/Index";
import Protocol from "../../../Types/API/Protocol";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  SERVER_SETUP_CHECKED_WORDS,
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_GUIDES,
  SERVER_SETUP_STATUS_WORDS,
  ServerSetupCheckDefinition,
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupChoices,
  ServerSetupFacts,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { SERVER_TEST_SEND_WORDS } from "../../../Types/ServerSetup/ServerTestSend";
import {
  fillTemplate,
  getTemplatePlaceholders,
} from "../../../Types/Translator";
import ServerSetupChecklistLoader from "../../../UI/Utils/ServerSetupChecklist";
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
    keySeparator: false,
    nsSeparator: false,
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
  overrides: Partial<ServerChannelStatus> = {},
): ServerChannelStatus {
  return {
    channel: name,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: state === ServerSendingState.Working ? EARLIER : null,
    failingSince: state === ServerSendingState.Failing ? EARLIER : null,
    lastFailure:
      state === ServerSendingState.Failing ? "535 Authentication failed" : null,
    setUpProblem:
      state === ServerSendingState.NotSetUp
        ? "Nothing is set up under Settings > Emails yet."
        : null,
    ...overrides,
  };
}

function facts(overrides: Partial<ServerSetupFacts> = {}): ServerSetupFacts {
  return {
    isHttpsSetUp: false,
    areSignupsClosed: false,
    email: channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
    sms: channel(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
    call: channel(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
    emailSentThrough: "smtp.example.com",
    smsSentThrough: "Twilio",
    callSentThrough: "Twilio",
    globalProbes: { total: 1, reporting: 0 },
    updateChecks: {
      isDisabled: false,
      lastCheckedAt: EARLIER,
      lastFailure: null,
    },
    lastBackup: null,
    hasScheduledBackups: false,
    isBrowserPushSetUp: false,
    hasAiProvider: false,
    hasSingleSignOn: false,
    choices: { choices: {}, hiddenBy: {} },
    ...overrides,
  };
}

function answerFor(
  values: Partial<ServerSetupFacts> = {},
): ServerSetupChecklistAnswer {
  return ServerSetupChecklistUtil.getAnswer({
    facts: facts(values),
    readerUserId: null,
  });
}

function chose(
  check: ServerSetupCheckId,
  kind: ServerSetupChoiceKind,
): ServerSetupChoices {
  return {
    choices: { [check]: { kind: kind, at: EARLIER, byUserId: "ada" } },
    hiddenBy: {},
  };
}

const formatTime: (iso: string | null) => string = (
  iso: string | null,
): string => {
  return iso ? `[${iso}]` : "";
};

function rowsFor(
  answer: ServerSetupChecklistAnswer,
  page: { httpProtocol?: Protocol; pageProtocol?: string } = {},
): Array<ServerSetupRow> {
  return getServerSetupRows({
    answer: answer,
    page: {
      httpProtocol: page.httpProtocol || Protocol.HTTP,
      pageProtocol: page.pageProtocol || "http:",
      httpsAddress: "https://oneuptime.example.com/admin/setup",
    },
    formatTime: formatTime,
  });
}

function row(
  rows: Array<ServerSetupRow>,
  id: ServerSetupCheckId,
): ServerSetupRow {
  return rows.find((candidate: ServerSetupRow) => {
    return candidate.id === id;
  })!;
}

function words(sentence: {
  template: string;
  values: Record<string, string>;
}): string {
  return fillTemplate(sentence.template, sentence.values);
}

function actionsOf(target: ServerSetupRow): Array<string> {
  return target.actions.map((action: ServerSetupAction) => {
    return [
      action.kind,
      action.title,
      action.route?.toString() || action.url || action.channel || "",
      action.isSecondary ? "secondary" : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
}

async function renderIn(
  locale: string,
  answer: ServerSetupChecklistAnswer,
  pageProtocol: string = "http:",
  onAnswer: (answer: ServerSetupChecklistAnswer | null) => void = () => {},
): Promise<HTMLElement> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter>
        <ServerSetupChecklist
          answer={answer}
          onAnswer={onAnswer}
          pageProtocol={pageProtocol}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await flush();

  return screen.getByTestId("server-setup-checklist");
}

beforeEach(() => {
  mockHttpProtocol = "http";
  mockHost = "oneuptime.example.com";
  window.history.replaceState({}, "", "/admin/setup");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("HTTPS, as this page sees it", () => {
  test("done only when OneUptime is told so and the page came over HTTPS", () => {
    expect(isServedOverHttps(Protocol.HTTPS, "https:")).toBe(true);
    expect(isServedOverHttps(Protocol.HTTP, "http:")).toBe(false);
    expect(isServedOverHttps(Protocol.HTTP, "https:")).toBe(false);
    expect(isServedOverHttps(Protocol.HTTPS, "http:")).toBe(false);
  });

  test("a proxy in front, and an http:// visit to a server set to HTTPS, are each told apart", () => {
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTP, "https:")).toBe(true);
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTPS, "https:")).toBe(false);
    expect(isOpenedOverHttpWhileSetToHttps(Protocol.HTTPS, "http:")).toBe(true);
    expect(isOpenedOverHttpWhileSetToHttps(Protocol.HTTP, "http:")).toBe(false);

    for (const setting of [Protocol.HTTP, Protocol.HTTPS]) {
      for (const page of ["http:", "https:"]) {
        expect(
          [
            isServedOverHttps(setting, page),
            isHttpsOnlyBeforeOneUptime(setting, page),
            isOpenedOverHttpWhileSetToHttps(setting, page),
          ].filter(Boolean).length,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the HTTPS address is this page at HOST, its port kept; without a HOST, the page's own", () => {
    expect(
      getHttpsAddress({
        host: "oneuptime.example.com",
        location: {
          host: "203.0.113.7",
          pathname: "/admin/setup",
          search: "?a=1",
        },
      }),
    ).toBe("https://oneuptime.example.com/admin/setup?a=1");
    expect(
      getHttpsAddress({
        host: "oneuptime.example.com:8443",
        location: {
          host: "10.0.0.5:8080",
          pathname: "/admin/setup",
          search: "",
        },
      }),
    ).toBe("https://oneuptime.example.com:8443/admin/setup");
    expect(
      getHttpsAddress({
        host: " ",
        location: { host: "10.0.0.5", pathname: "/admin/setup", search: "" },
      }),
    ).toBe("https://10.0.0.5/admin/setup");
  });
});

describe("the rows of a server that has just started", () => {
  const rows: Array<ServerSetupRow> = rowsFor(answerFor());

  test("every check, in order, in its section", () => {
    expect(
      rows.map((target: ServerSetupRow) => {
        return [target.id, target.tier, target.isFinished];
      }),
    ).toEqual(
      SERVER_SETUP_CHECKS.map((definition: ServerSetupCheckDefinition) => {
        return [
          definition.id,
          definition.tier,
          definition.id === ServerSetupCheckId.UpdateChecks,
        ];
      }),
    );
  });

  test("email: what is missing, and Set up email", () => {
    const email: ServerSetupRow = row(rows, ServerSetupCheckId.Email);

    expect(words(email.status)).toBe(
      "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
    );
    expect(email.checked.map(words)).toEqual([
      "Nothing is set up under Settings > Emails yet.",
    ]);
    expect(actionsOf(email)).toEqual([
      "route | Set up email | /admin/settings/smtp",
    ]);
  });

  test("HTTPS: the guide, opened in a new tab", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Https))).toEqual([
      `guide | How to set up HTTPS | ${SERVER_SETUP_GUIDES.https}`,
    ]);
  });

  test("sign-ups: Choose who can sign up, or keep them open", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Signups))).toEqual([
      "route | Choose who can sign up | /admin/settings/authentication",
      "choose | Keep sign-ups open | secondary",
    ]);
  });

  test("SMS and calls: set them up, or use email and push only", () => {
    const sms: ServerSetupRow = row(rows, ServerSetupCheckId.SmsAndCalls);

    expect(words(sms.status)).toBe(
      "Not set up yet: on-call alerts can only go out by email and push.",
    );
    expect(actionsOf(sms)).toEqual([
      "route | Set up SMS and calls | /admin/settings/call-and-sms",
      "choose | Use email and push only | secondary",
    ]);
  });

  test("probes: see the global probes, or not needed", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Probes))).toEqual([
      "route | See global probes | /admin/settings/probes",
      "choose | Not needed | secondary",
    ]);
  });

  test("backups on the Community Edition: the guide, or confirm", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Backups))).toEqual([
      `guide | How to back up | ${SERVER_SETUP_GUIDES.backups}`,
      "choose | This server is backed up | secondary",
    ]);
  });

  test("backups on the Enterprise Edition: its scheduled backups page", () => {
    const backups: ServerSetupRow = row(
      rowsFor(answerFor({ hasScheduledBackups: true })),
      ServerSetupCheckId.Backups,
    );

    expect(actionsOf(backups)[0]).toBe(
      "route | Set up backups | /admin/settings/backups",
    );
  });

  test("update checks: on, and when they last checked", () => {
    const updates: ServerSetupRow = row(rows, ServerSetupCheckId.UpdateChecks);

    expect(updates.checked.map(words)).toEqual([
      `Last checked on [${EARLIER}].`,
    ]);
    expect(updates.actions).toEqual([]);
  });

  test("optional: a guide or a page each, never a choice", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.BrowserPush))).toEqual([
      `guide | Read the guide | ${SERVER_SETUP_GUIDES.browserPush}`,
    ]);
    expect(actionsOf(row(rows, ServerSetupCheckId.AiProvider))).toEqual([
      "route | Add an LLM provider | /admin/settings/llm-providers",
    ]);
    expect(actionsOf(row(rows, ServerSetupCheckId.SingleSignOn))).toEqual([
      "route | Set up single sign-on | /admin/settings/sso",
    ]);
  });
});

describe("what done was checked against", () => {
  test("email working: what accepted it and when, nothing to do", () => {
    const email: ServerSetupRow = row(
      rowsFor(
        answerFor({
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.Working,
          ),
        }),
      ),
      ServerSetupCheckId.Email,
    );

    expect(email.isFinished).toBe(true);
    expect(words(email.status)).toBe(
      "Set up: OneUptime sends invitations, password resets and alerts by email.",
    );
    expect(email.checked.map(words)).toEqual([
      `smtp.example.com accepted an email on [${EARLIER}].`,
    ]);
    expect(email.actions).toEqual([]);
  });

  test("email set up but untested: Send test email, and the settings", () => {
    const email: ServerSetupRow = row(
      rowsFor(
        answerFor({
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.Untested,
          ),
        }),
      ),
      ServerSetupCheckId.Email,
    );

    expect(email.isFinished).toBe(false);
    expect(words(email.status)).toBe(
      "Set up, but not tested yet: send a test email to make sure it arrives.",
    );
    expect(actionsOf(email)).toEqual([
      "test | email",
      "route | Open settings | /admin/settings/smtp | secondary",
    ]);
  });

  test("email failing: since when, and what the mail server said", () => {
    const email: ServerSetupRow = row(
      rowsFor(
        answerFor({
          email: channel(
            ServerSendingChannel.Email,
            ServerSendingState.Failing,
          ),
        }),
      ),
      ServerSetupCheckId.Email,
    );

    expect(email.isFailing).toBe(true);
    expect(words(email.status)).toBe(
      `Failing: emails have not gone out since [${EARLIER}].`,
    );
    expect(email.checked.map(words)).toEqual([
      "smtp.example.com said: 535 Authentication failed",
    ]);
    expect(actionsOf(email)[0]).toBe("test | email");
  });

  test("SMS and calls: what accepted each, and a test for each channel set up", () => {
    const working: ServerSetupRow = row(
      rowsFor(
        answerFor({
          sms: channel(ServerSendingChannel.SMS, ServerSendingState.Working),
          call: channel(ServerSendingChannel.Call, ServerSendingState.Working),
        }),
      ),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(working.checked.map(words)).toEqual([
      `Twilio accepted an SMS on [${EARLIER}].`,
      `Twilio accepted a call on [${EARLIER}].`,
    ]);

    const untested: ServerSetupRow = row(
      rowsFor(
        answerFor({
          sms: channel(ServerSendingChannel.SMS, ServerSendingState.Untested),
          call: channel(ServerSendingChannel.Call, ServerSendingState.Untested),
        }),
      ),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(actionsOf(untested)).toEqual([
      "test | sms",
      "test | call",
      "route | Open settings | /admin/settings/call-and-sms | secondary",
    ]);
  });

  test("a choice says who made it and when, and can be undone", () => {
    const answer: ServerSetupChecklistAnswer = answerFor({
      choices: chose(
        ServerSetupCheckId.SmsAndCalls,
        ServerSetupChoiceKind.Skipped,
      ),
    });
    ServerSetupChecklistUtil.getCheck(
      answer,
      ServerSetupCheckId.SmsAndCalls,
    )!.choice!.byName = "Ada Lovelace";

    const sms: ServerSetupRow = row(
      rowsFor(answer),
      ServerSetupCheckId.SmsAndCalls,
    );

    expect(sms.isFinished).toBe(true);
    expect(words(sms.status)).toBe(
      "Not used: on-call alerts go out by email and push.",
    );
    expect(sms.checked.map(words)).toEqual([
      `Chosen by Ada Lovelace on [${EARLIER}].`,
    ]);
    expect(actionsOf(sms)).toEqual(["undo | Undo | secondary"]);
  });

  test("a choice whose maker is not known says when", () => {
    const backups: ServerSetupRow = row(
      rowsFor(
        answerFor({
          choices: chose(
            ServerSetupCheckId.Backups,
            ServerSetupChoiceKind.Confirmed,
          ),
        }),
      ),
      ServerSetupCheckId.Backups,
    );

    expect(words(backups.status)).toBe("Backed up, as an admin confirmed.");
    expect(backups.checked.map(words)).toEqual([`Chosen on [${EARLIER}].`]);
  });

  test("a backup the server made: when it finished; one that failed: why", () => {
    expect(
      row(
        rowsFor(
          answerFor({
            lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
          }),
        ),
        ServerSetupCheckId.Backups,
      ).checked.map(words),
    ).toEqual([`The last backup finished on [${EARLIER}].`]);

    const failed: ServerSetupRow = row(
      rowsFor(
        answerFor({
          lastBackup: {
            succeeded: false,
            finishedAt: EARLIER,
            error: "The bucket refused the upload.",
          },
          hasScheduledBackups: true,
        }),
      ),
      ServerSetupCheckId.Backups,
    );

    expect(failed.checked.map(words)).toEqual([
      "The bucket refused the upload.",
    ]);
    expect(actionsOf(failed)[0]).toBe(
      "route | Set up backups | /admin/settings/backups",
    );
  });
});

describe("HTTPS rows, with what this page knows", () => {
  test("behind an HTTPS proxy: almost, only HTTP_PROTOCOL is left", () => {
    const https: ServerSetupRow = row(
      rowsFor(answerFor(), { pageProtocol: "https:" }),
      ServerSetupCheckId.Https,
    );

    expect(words(https.status)).toBe(
      SERVER_SETUP_COPY.https.onlyBeforeOneUptime,
    );
    expect(actionsOf(https)[0]).toContain("How to set up HTTPS");
  });

  test("set to HTTPS but opened over HTTP: only this visit is left, opened over HTTPS", () => {
    const https: ServerSetupRow = row(
      rowsFor(answerFor({ isHttpsSetUp: true }), {
        httpProtocol: Protocol.HTTPS,
        pageProtocol: "http:",
      }),
      ServerSetupCheckId.Https,
    );

    expect(https.isFinished).toBe(false);
    expect(words(https.status)).toBe(SERVER_SETUP_COPY.https.openedOverHttp);
    expect(actionsOf(https)).toEqual([
      "address | Open over HTTPS | https://oneuptime.example.com/admin/setup",
    ]);
  });

  test("set to HTTPS and opened over HTTPS: done", () => {
    const https: ServerSetupRow = row(
      rowsFor(answerFor({ isHttpsSetUp: true }), {
        httpProtocol: Protocol.HTTPS,
        pageProtocol: "https:",
      }),
      ServerSetupCheckId.Https,
    );

    expect(https.isFinished).toBe(true);
    expect(words(https.status)).toBe("People reach this server over HTTPS.");
    expect(https.actions).toEqual([]);
  });
});

describe("the page", () => {
  test("required and recommended open; optional folded until asked for", async () => {
    const checklist: HTMLElement = await renderIn("en", answerFor());

    expect(within(checklist).getByText(SERVER_SETUP_COPY.title)).toBeVisible();
    expect(within(checklist).getByTestId("server-setup-email")).toHaveAttribute(
      "data-done",
      "false",
    );
    expect(
      within(checklist).getByTestId("server-setup-required-progress"),
    ).toHaveTextContent("0 of 3 done");
    expect(
      within(checklist).getByTestId("server-setup-recommended-progress"),
    ).toHaveTextContent("1 of 4 done");
    expect(
      within(checklist).queryByTestId("server-setup-browser-push"),
    ).toBeNull();

    const toggle: HTMLElement = within(checklist).getByTestId(
      "server-setup-optional-toggle",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    await flush();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(checklist).getByTestId("server-setup-browser-push"),
    ).toBeVisible();
    expect(
      within(checklist).getByTestId("server-setup-ai-provider"),
    ).toBeVisible();
  });

  test("each action is the right control: a link to its page, a guide in a new tab, a test button", async () => {
    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Untested),
      }),
    );

    expect(
      within(checklist).getByTestId("server-setup-email-test-email"),
    ).toHaveTextContent("Send test email");
    expect(
      within(checklist).getByTestId("server-setup-signups-route"),
    ).toHaveAttribute("href", "/admin/settings/authentication");

    const guide: HTMLElement = within(checklist).getByTestId(
      "server-setup-https-guide",
    );

    expect(guide).toHaveAttribute(
      "href",
      `${window.location.origin}${SERVER_SETUP_GUIDES.https}`,
    );
    expect(guide).toHaveAttribute("target", "_blank");
    expect(
      within(guide).getByTestId("server-setup-https-guide-new-tab"),
    ).toBeInTheDocument();
    expect(guide).toHaveTextContent("Opens in a new tab");
  });

  test("a choice is made on the server, and the page shows what it answers", async () => {
    const answered: ServerSetupChecklistAnswer = answerFor({
      choices: chose(
        ServerSetupCheckId.SmsAndCalls,
        ServerSetupChoiceKind.Skipped,
      ),
    });
    const choose: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ServerSetupChecklistLoader, "choose")
      .mockResolvedValue(answered);
    const onAnswer: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor(),
      "http:",
      onAnswer as never,
    );

    await act(async () => {
      fireEvent.click(
        within(checklist).getByTestId("server-setup-sms-and-calls-choose"),
      );
    });
    await flush();

    expect(choose).toHaveBeenCalledWith(
      ServerSetupCheckId.SmsAndCalls,
      ServerSetupChoiceKind.Skipped,
    );
    expect(onAnswer).toHaveBeenCalledWith(answered);
  });

  test("undo makes the choice null", async () => {
    const choose: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ServerSetupChecklistLoader, "choose")
      .mockResolvedValue(answerFor());

    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({
        choices: chose(
          ServerSetupCheckId.Backups,
          ServerSetupChoiceKind.Confirmed,
        ),
      }),
    );

    await act(async () => {
      fireEvent.click(
        within(checklist).getByTestId("server-setup-backups-undo"),
      );
    });
    await flush();

    expect(choose).toHaveBeenCalledWith(ServerSetupCheckId.Backups, null);
  });

  test("a choice the server refuses says why, and changes nothing", async () => {
    jest
      .spyOn(ServerSetupChecklistLoader, "choose")
      .mockRejectedValue(new Error("Only master admins can do this."));
    const onAnswer: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor(),
      "http:",
      onAnswer as never,
    );

    await act(async () => {
      fireEvent.click(
        within(checklist).getByTestId("server-setup-probes-choose"),
      );
    });
    await flush();

    expect(within(checklist).getByTestId("server-setup-error")).toBeVisible();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  test("everything required and recommended finished: says so", async () => {
    mockHttpProtocol = "https";

    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({
        isHttpsSetUp: true,
        areSignupsClosed: true,
        email: channel(ServerSendingChannel.Email, ServerSendingState.Working),
        globalProbes: { total: 1, reporting: 1 },
        lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
        choices: chose(
          ServerSetupCheckId.SmsAndCalls,
          ServerSetupChoiceKind.Skipped,
        ),
      }),
      "https:",
    );

    expect(
      within(checklist).getByTestId("server-setup-all-done"),
    ).toHaveTextContent(SERVER_SETUP_COPY.allDone);
  });

  test("in German, the rows, the actions and the checked lines", async () => {
    const de: Locale = readLocale("de");

    const checklist: HTMLElement = await renderIn(
      "de",
      answerFor({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Working),
      }),
    );

    expect(
      within(checklist).getByText(de[SERVER_SETUP_COPY.title] as string),
    ).toBeVisible();
    expect(
      within(checklist).getByText(
        de[SERVER_SETUP_STATUS_WORDS.email.done!] as string,
      ),
    ).toBeVisible();
    expect(
      within(checklist).getAllByTestId("server-setup-email-checked")[0],
    ).toHaveTextContent(
      fillTemplate(de[SERVER_SETUP_CHECKED_WORDS.emailAccepted] as string, {
        sentThrough: "smtp.example.com",
        time: formatServerSetupTime(EARLIER),
      }).replace(/[⁦-⁩]/g, ""),
    );
    expect(
      within(checklist).getByTestId("server-setup-sms-and-calls-choose"),
    ).toHaveTextContent(
      de[SERVER_SETUP_COPY.actions.useEmailAndPushOnly] as string,
    );
  });
});

/*
 * Every word the Server setup page, its test sends and its cards say: the
 * catalogue's titles and status lines, what each was checked against, the
 * page's own words, the test dialogs' and the settings pages' cards'.
 */
const ALL_WORDS: Array<string> = Array.from(
  new Set<string>([
    SERVER_SETUP_PAGE_TITLE,
    SERVER_SETUP_PAGE_LOAD_ERROR,
    "Server Setup",
    "What this server still needs: email, HTTPS, sign-ups and more.",
    ...SERVER_SETUP_CHECKS.map((definition: ServerSetupCheckDefinition) => {
      return definition.title;
    }),
    ...Object.values(SERVER_SETUP_STATUS_WORDS).flatMap(
      (lines: Partial<Record<string, string>>) => {
        return Object.values(lines) as Array<string>;
      },
    ),
    ...Object.values(SERVER_SETUP_CHECKED_WORDS),
    SERVER_SETUP_COPY.title,
    SERVER_SETUP_COPY.description,
    SERVER_SETUP_COPY.allDone,
    SERVER_SETUP_COPY.required,
    SERVER_SETUP_COPY.recommended,
    SERVER_SETUP_COPY.optional,
    SERVER_SETUP_COPY.progress,
    SERVER_SETUP_COPY.doneLabel,
    SERVER_SETUP_COPY.openLabel,
    SERVER_SETUP_COPY.failingLabel,
    SERVER_SETUP_COPY.opensInNewTab,
    ...Object.values(SERVER_SETUP_COPY.https),
    ...Object.values(SERVER_SETUP_COPY.actions),
    ...Object.values(SERVER_TEST_SEND_WORDS),
    ...Object.values(SERVER_TEST_CARD_COPY),
  ]),
);

// Words a translation may keep as they are written in English.
const SAME_IN: Record<string, Array<string>> = {
  HTTPS: ["*"],
  Email: ["*"],
  Done: ["*"],
  Failing: ["*"],
  Required: ["*"],
  Optional: ["*"],
  Probes: ["*"],
  Backups: ["*"],
  "Single sign-on": ["it", "nl", "da"],
};

describe("its words, in every language the Admin Dashboard speaks", () => {
  test("English has every word as its own value", () => {
    const english: Locale = readLocale("en");

    for (const word of ALL_WORDS) {
      expect({ word, value: english[word] }).toEqual({ word, value: word });
    }
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s has every word, translated, with its placeholders and literals kept",
    (locale: string) => {
      const translated: Locale = readLocale(locale);

      for (const word of ALL_WORDS) {
        const value: unknown = translated[word];

        expect({ word, type: typeof value }).toEqual({ word, type: "string" });
        expect((value as string).trim().length).toBeGreaterThan(0);

        const same: Array<string> | undefined = SAME_IN[word];

        if (!same || (!same.includes("*") && !same.includes(locale))) {
          expect({ word, same: value === word }).toEqual({ word, same: false });
        }

        expect(getTemplatePlaceholders(value as string).sort()).toEqual(
          getTemplatePlaceholders(word).sort(),
        );

        for (const literal of [
          "OneUptime",
          "HTTP_PROTOCOL=https",
          "http://",
          "config.env",
          "VAPID",
          "GitHub",
          "HTTPS",
          "LLM",
        ]) {
          if (word.includes(literal)) {
            expect({
              word,
              literal,
              kept: (value as string).includes(literal),
            }).toEqual({ word, literal, kept: true });
          }
        }
      }
    },
  );
});

describe("where it is drawn", () => {
  test("its own page, Server setup, at /admin/setup - not on Admin > Users", () => {
    const users: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx",
      ),
      "utf8",
    );
    const app: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/App.tsx",
      ),
      "utf8",
    );
    const routes: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap.ts",
      ),
      "utf8",
    );

    expect(users).not.toContain("ServerSetupChecklist");
    expect(routes).toContain(
      "[PageMap.SERVER_SETUP]: new Route(`/admin/setup`)",
    );
    expect(app).toContain("RouteMap[PageMap.SERVER_SETUP]");
    expect(app).toContain("<ServerSetup />");
  });
});
