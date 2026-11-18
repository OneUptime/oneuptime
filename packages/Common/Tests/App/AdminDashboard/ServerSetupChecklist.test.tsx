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
 *
 * Set up email opens the mail server's form (#7460); How to set up HTTPS
 * opens the Self-Hosting Guide's HTTPS step (#7073); How to back up opens
 * steps this install can run, both of them named while the server cannot
 * tell which install it is (#9378); a backup npm run backup reported is
 * measured (#7026); the choices are quiet beside the fix (#7030); and a
 * server whose push is on offers Send test push (#7028).
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
  getServerSetupGuideUrl,
  getServerSetupRows,
  isHttpsOnlyBeforeOneUptime,
  isOpenedOverHttpWhileSetToHttps,
  isServedOverHttps,
  SERVER_SETUP_COPY,
  SERVER_SETUP_QUIET_ACTION_CLASS_NAME,
  SERVER_SETUP_SET_UP_EMAIL_QUERY,
  ServerSetupAction,
  ServerSetupRow,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerSetupChecklist";
import { SERVER_TEST_CARD_COPY } from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestCard";
import { SERVER_TEST_PUSH_DESCRIPTION } from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestSendButton";
import { CHECK_GATEWAY_COPY } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallAndSmsGatewayCard";
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
  SERVER_SETUP_BACKUP_SCRIPT_WORDS,
  SERVER_SETUP_CHECKED_WORDS,
  SERVER_SETUP_CHECKS,
  SERVER_SETUP_GUIDES,
  SERVER_SETUP_STATUS_WORDS,
  ServerInstallKind,
  ServerSetupCheckDefinition,
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupChoices,
  ServerSetupFacts,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import {
  SERVER_TEST_PUSH_REASONS,
  SERVER_TEST_SEND_WORDS,
} from "../../../Types/ServerSetup/ServerTestSend";
import ServerSetUpProblem, {
  SERVER_EMAIL_SETTING_NAMES,
  SERVER_SET_UP_PROBLEMS,
  ServerSetUpProblemWords,
} from "../../../Types/ServerSending/ServerSetUpProblem";
import {
  fillTemplate,
  getTemplatePlaceholders,
  TemplateValues,
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

function words(sentence: { template: string; values: TemplateValues }): string {
  return fillTemplate(sentence.template, sentence.values);
}

/*
 * How an element is drawn, without its focus ring: every control has the
 * same indigo ring while the keyboard is on it.
 */
function drawnClasses(element: HTMLElement): string {
  return element.className
    .split(/\s+/)
    .filter((name: string) => {
      return !name.startsWith("focus");
    })
    .join(" ");
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
    // #7460: it lands in the mail server's form, not on the page around it.
    expect(actionsOf(email)).toEqual([
      "route | Set up email | /admin/settings/smtp?set-up=email",
    ]);
    expect(SERVER_SETUP_SET_UP_EMAIL_QUERY).toEqual({
      name: "set-up",
      value: "email",
    });
  });

  /*
   * #7073: How to set up HTTPS opened the Docker Compose page's HTTPS
   * section, which a Kubernetes install cannot follow. It opens the
   * Self-Hosting Guide's own HTTPS step, which has both installs' steps.
   */
  test("HTTPS: the Self-Hosting Guide's HTTPS step", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Https))).toEqual([
      "guide | How to set up HTTPS | /docs/installation/self-hosting-guide#turn-on-https",
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

  test("backups on the Community Edition, on an install the server cannot tell: both guides, each named, or confirm", () => {
    expect(actionsOf(row(rows, ServerSetupCheckId.Backups))).toEqual([
      `guide | How to back up with Docker Compose | ${SERVER_SETUP_GUIDES.backups}`,
      `guide | How to back up on Kubernetes | ${SERVER_SETUP_GUIDES.backupsOnKubernetes}`,
      "choose | This server is backed up | secondary",
    ]);
  });

  /*
   * #9378: How to back up opened npm run backup's steps on every install,
   * which a Kubernetes install cannot run. Each install gets steps it can.
   */
  test("backups on Docker Compose: npm run backup's steps; on Kubernetes: the Helm chart's production checklist", () => {
    expect(
      actionsOf(
        row(
          rowsFor(answerFor({ installKind: ServerInstallKind.DockerCompose })),
          ServerSetupCheckId.Backups,
        ),
      ),
    ).toEqual([
      "guide | How to back up | /docs/installation/docker-compose#back-up-and-restore",
      "choose | This server is backed up | secondary",
    ]);
    expect(
      actionsOf(
        row(
          rowsFor(answerFor({ installKind: ServerInstallKind.Kubernetes })),
          ServerSetupCheckId.Backups,
        ),
      ),
    ).toEqual([
      "guide | How to back up | /docs/installation/kubernetes#back-up-your-data",
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

  /*
   * #7028: once push is on, the row offers a test push to the admin's own
   * phones and browsers - while it is open, beside its guide, and once it
   * is done too: nothing yet tells the server how its pushes went (#6881).
   */
  test("browser push turned on: Send test push, beside the guide while it is open", () => {
    const pushOn: Partial<ServerSetupFacts> = {
      push: channel(ServerSendingChannel.Push, ServerSendingState.Untested),
    };

    expect(
      actionsOf(
        row(rowsFor(answerFor(pushOn)), ServerSetupCheckId.BrowserPush),
      ),
    ).toEqual([
      `guide | Read the guide | ${SERVER_SETUP_GUIDES.browserPush}`,
      "test | push",
    ]);
    expect(
      actionsOf(
        row(
          rowsFor(answerFor({ ...pushOn, isBrowserPushSetUp: true })),
          ServerSetupCheckId.BrowserPush,
        ),
      ),
    ).toEqual(["test | push"]);
    // Turned off under Settings > Push Notifications: nothing to test.
    expect(
      actionsOf(
        row(
          rowsFor(
            answerFor({
              push: channel(
                ServerSendingChannel.Push,
                ServerSendingState.NotSetUp,
              ),
            }),
          ),
          ServerSetupCheckId.BrowserPush,
        ),
      ),
    ).toEqual([`guide | Read the guide | ${SERVER_SETUP_GUIDES.browserPush}`]);
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

/*
 * #7026: npm run backup tells the server how each run went, so Backups is
 * measured on the Community Edition as the Enterprise Edition's scheduled
 * backups are: done when the last run backed up, failing when it did not,
 * and out of date once the last backup is more than a week old.
 */
describe("backups npm run backup reported", () => {
  const HOURS_AGO: string = new Date(
    Date.now() - 2 * 60 * 60 * 1000,
  ).toISOString();
  const WEEKS_AGO: string = new Date(
    Date.now() - 20 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const DOCKER_COMPOSE_STEPS: Array<string> = [
    "guide | How to back up | /docs/installation/docker-compose#back-up-and-restore",
    "choose | This server is backed up | secondary",
  ];

  test("a run that backed up: done, when it finished, nothing to do", () => {
    const backups: ServerSetupRow = row(
      rowsFor(
        answerFor({
          installKind: ServerInstallKind.DockerCompose,
          lastScriptBackup: {
            at: HOURS_AGO,
            succeeded: true,
            sizeInBytes: 52428800,
          },
        }),
      ),
      ServerSetupCheckId.Backups,
    );

    expect(backups.isFinished).toBe(true);
    expect(words(backups.status)).toBe("Backed up with npm run backup.");
    expect(backups.checked.map(words)).toEqual([
      `The last backup finished on [${HOURS_AGO}].`,
    ]);
    expect(backups.actions).toEqual([]);
  });

  test("a run whose dump failed: failing, what to do, the steps, or the operator's word", () => {
    const backups: ServerSetupRow = row(
      rowsFor(
        answerFor({
          installKind: ServerInstallKind.DockerCompose,
          lastScriptBackup: {
            at: HOURS_AGO,
            succeeded: false,
            sizeInBytes: null,
          },
        }),
      ),
      ServerSetupCheckId.Backups,
    );

    expect(backups.isFinished).toBe(false);
    expect(backups.isFailing).toBe(true);
    expect(words(backups.status)).toBe(
      `Failing: the last backup failed on [${HOURS_AGO}].`,
    );
    expect(backups.checked.map(words)).toEqual([
      SERVER_SETUP_BACKUP_SCRIPT_WORDS.failed,
    ]);
    expect(actionsOf(backups)).toEqual(DOCKER_COMPOSE_STEPS);
  });

  test("the last backup more than a week old: out of date, since when, the steps again", () => {
    const backups: ServerSetupRow = row(
      rowsFor(
        answerFor({
          installKind: ServerInstallKind.DockerCompose,
          lastScriptBackup: {
            at: WEEKS_AGO,
            succeeded: true,
            sizeInBytes: 52428800,
          },
        }),
      ),
      ServerSetupCheckId.Backups,
    );

    expect(backups.isFinished).toBe(false);
    expect(backups.isFailing).toBe(false);
    expect(words(backups.status)).toBe(
      `Out of date: the last backup finished on [${WEEKS_AGO}], more than a week ago.`,
    );
    expect(actionsOf(backups)).toEqual(DOCKER_COMPOSE_STEPS);
  });
});

describe("a guide's address", () => {
  /*
   * #9438: the Kubernetes backup steps are a docs page of this server too,
   * not the Helm chart's checklist on GitHub's main branch.
   */
  test("a docs page at this server, the Kubernetes backup steps too", () => {
    const origin: string = "https://oneuptime.example.com";

    expect(
      getServerSetupGuideUrl({ guide: SERVER_SETUP_GUIDES.backups, origin }),
    ).toBe(`${origin}/docs/installation/docker-compose#back-up-and-restore`);
    expect(
      getServerSetupGuideUrl({
        guide: SERVER_SETUP_GUIDES.backupsOnKubernetes,
        origin,
      }),
    ).toBe(`${origin}/docs/installation/kubernetes#back-up-your-data`);
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
      `${window.location.origin}/docs/installation/self-hosting-guide#turn-on-https`,
    );
    expect(guide).toHaveAttribute("target", "_blank");
    expect(
      within(guide).getByTestId("server-setup-https-guide-new-tab"),
    ).toBeInTheDocument();
    expect(guide).toHaveTextContent("Opens in a new tab");
  });

  // #7460: Set up email opens Settings > Emails asking for its form.
  test("Set up email links to Settings > Emails, opening its mail server's form", async () => {
    const checklist: HTMLElement = await renderIn("en", answerFor());

    expect(
      within(checklist).getByTestId("server-setup-email-route"),
    ).toHaveAttribute("href", "/admin/settings/smtp?set-up=email");
  });

  // #9378: while the server cannot tell its install, both, each named.
  test("How to back up: both installs' steps, each named, each in a new tab, while the install is not known", async () => {
    const checklist: HTMLElement = await renderIn("en", answerFor());

    const dockerCompose: HTMLElement = within(checklist).getByTestId(
      "server-setup-backups-guide-0",
    );
    const kubernetes: HTMLElement = within(checklist).getByTestId(
      "server-setup-backups-guide-1",
    );

    expect(dockerCompose).toHaveTextContent(
      "How to back up with Docker Compose",
    );
    expect(dockerCompose).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/installation/docker-compose#back-up-and-restore`,
    );
    expect(dockerCompose).toHaveAttribute("target", "_blank");
    expect(kubernetes).toHaveTextContent("How to back up on Kubernetes");
    expect(kubernetes).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/installation/kubernetes#back-up-your-data`,
    );
    expect(kubernetes).toHaveAttribute("target", "_blank");
    expect(
      within(checklist).queryByTestId("server-setup-backups-guide"),
    ).toBeNull();
  });

  test("How to back up on Kubernetes: only the Kubernetes steps, on this server's docs", async () => {
    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({ installKind: ServerInstallKind.Kubernetes }),
    );

    const guide: HTMLElement = within(checklist).getByTestId(
      "server-setup-backups-guide",
    );

    expect(guide).toHaveTextContent("How to back up");
    expect(guide).not.toHaveTextContent("Docker Compose");
    expect(guide).toHaveAttribute(
      "href",
      `${window.location.origin}/docs/installation/kubernetes#back-up-your-data`,
    );
    expect(
      within(checklist).queryByTestId("server-setup-backups-guide-0"),
    ).toBeNull();
  });

  /*
   * #7030: the admin's own choices - Keep sign-ups open, Use email and
   * push only, Not needed, This server is backed up - and their Undo are
   * quiet: muted, underlined words, as tall as a finger needs, beside a
   * fix drawn as a button. They were indigo links padded like buttons.
   */
  test("the choices are quiet beside the fix, and still buttons a finger can hit", async () => {
    const checklist: HTMLElement = await renderIn("en", answerFor());
    const quiet: Array<string> =
      SERVER_SETUP_QUIET_ACTION_CLASS_NAME.split(" ");

    for (const [id, title] of [
      ["signups", "Keep sign-ups open"],
      ["sms-and-calls", "Use email and push only"],
      ["probes", "Not needed"],
      ["backups", "This server is backed up"],
    ]) {
      const choice: HTMLElement = within(checklist).getByTestId(
        `server-setup-${id}-choose`,
      );

      expect(choice.tagName).toBe("BUTTON");
      expect(choice).toHaveTextContent(title!);
      expect(choice.className.split(/\s+/)).toEqual(
        expect.arrayContaining(quiet),
      );
      expect(choice.className).toContain("text-gray-600");
      expect(drawnClasses(choice)).not.toMatch(/indigo|shadow|ring-1|bg-/);
    }

    expect(quiet).toContain("[@media(pointer:coarse)]:min-h-11");

    // The fix beside a choice is the louder of the two: a button's frame.
    const fix: HTMLElement = within(checklist).getByTestId(
      "server-setup-signups-route",
    );

    expect(fix.className).toContain("ring-1");
    expect(fix.className).toContain("shadow-sm");
    expect(fix.className).not.toContain("underline");
  });

  test("an Undo and an Open settings are as quiet as a choice", async () => {
    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({
        email: channel(ServerSendingChannel.Email, ServerSendingState.Untested),
        choices: chose(
          ServerSetupCheckId.Backups,
          ServerSetupChoiceKind.Confirmed,
        ),
      }),
    );
    const quiet: Array<string> =
      SERVER_SETUP_QUIET_ACTION_CLASS_NAME.split(" ");

    for (const testId of [
      "server-setup-backups-undo",
      "server-setup-email-route",
    ]) {
      const action: HTMLElement = within(checklist).getByTestId(testId);

      expect(action.className.split(/\s+/)).toEqual(
        expect.arrayContaining(quiet),
      );
      expect(drawnClasses(action)).not.toMatch(/indigo|shadow|ring-1|bg-/);
    }

    expect(
      within(checklist).getByTestId("server-setup-email-route"),
    ).toHaveTextContent("Open settings");
  });

  // #7028: on the push row, once push is on.
  test("Send test push, on the push row once push is on", async () => {
    const checklist: HTMLElement = await renderIn(
      "en",
      answerFor({
        push: channel(ServerSendingChannel.Push, ServerSendingState.Untested),
      }),
    );

    fireEvent.click(
      within(checklist).getByTestId("server-setup-optional-toggle"),
    );
    await flush();

    expect(
      within(checklist).getByTestId("server-setup-browser-push-test-push"),
    ).toHaveTextContent("Send test push");
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

  /*
   * How far along a group is, in the digits its language writes, as the
   * page's dates are: "0 of 3" read in Latin digits in Persian.
   */
  test("in Persian, how far along each group is in Persian digits", async () => {
    const checklist: HTMLElement = await renderIn("fa", answerFor());
    const progress: string =
      within(checklist).getByTestId("server-setup-required-progress")
        .textContent || "";

    expect(progress).toContain("۰");
    expect(progress).toContain("۳");
    expect(progress).not.toMatch(/[0-9]/);
  });

  test("an action is never wider than its row: its words wrap", async () => {
    const checklist: HTMLElement = await renderIn("en", answerFor());

    for (const testId of [
      "server-setup-backups-guide-0",
      "server-setup-backups-guide-1",
      "server-setup-email-route",
      "server-setup-backups-choose",
    ]) {
      const classes: Array<string> = within(checklist)
        .getByTestId(testId)
        .className.split(/\s+/);

      expect({ testId, classes }).toEqual({
        testId,
        classes: expect.arrayContaining(["max-w-full"]),
      });
      expect(classes).not.toContain("flex-none");
    }
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
 * #6881: while the server's own pushes fail - the push relay out of reach,
 * its keys refused - the push row says so, since when and why, with the
 * test push that shows they work again.
 */
describe("the push row, while the server's pushes fail", () => {
  const RELAY_DOWN: string =
    "Request failed to https://oneuptime.com/api/notification/push-relay/send. Connection refused";

  test("says it is failing, since when, and what the push service or relay said", () => {
    const push: ServerSetupRow = row(
      rowsFor(
        answerFor({
          isBrowserPushSetUp: true,
          push: channel(ServerSendingChannel.Push, ServerSendingState.Failing, {
            lastFailure: RELAY_DOWN,
          }),
        }),
      ),
      ServerSetupCheckId.BrowserPush,
    );

    expect(push.isFailing).toBe(true);
    expect(push.isFinished).toBe(false);
    expect(words(push.status)).toBe(
      `Failing: push notifications have not gone out since [${EARLIER}].`,
    );
    expect(push.checked.map(words)).toEqual([
      `The provider said: ${RELAY_DOWN}`,
    ]);
    expect(actionsOf(push)).toEqual([
      `guide | Read the guide | ${SERVER_SETUP_GUIDES.browserPush}`,
      "test | push",
    ]);
  });

  test("in German, in the reader's words, the relay's own words as they came", async () => {
    const de: Locale = readLocale("de");
    const checklist: HTMLElement = await renderIn(
      "de",
      answerFor({
        push: channel(ServerSendingChannel.Push, ServerSendingState.Failing, {
          lastFailure: RELAY_DOWN,
        }),
      }),
    );

    within(checklist).getByTestId("server-setup-optional-toggle").click();
    await flush();

    const status: string = (
      within(checklist).getByTestId("server-setup-browser-push").textContent ||
      ""
    ).replace(/[⁦-⁩]/g, "");

    expect(status).toContain(
      (
        de[
          "Failing: push notifications have not gone out since {{time}}."
        ] as string
      ).split("{{time}}")[0]!,
    );
    expect(status).toContain(RELAY_DOWN);
  });
});

/*
 * #9437: the Email row says what its settings are missing in the reader's
 * language - the server sends it as words, a sentence of the Admin
 * Dashboard's locales and what fills it - with the provider as written and
 * the setting as the settings form names it. It read "Nothing is set up
 * under Settings > Emails yet." in English under a German title. From an
 * older server, which sends the sentence alone, the sentence as it came.
 */
describe("what Email's settings are missing, in the reader's language", () => {
  const withoutIsolates: (text: string) => string = (text: string): string => {
    return text.replace(/[⁦-⁩]/g, "");
  };

  const notSetUp: (problem: ServerSetUpProblemWords) => ServerChannelStatus = (
    problem: ServerSetUpProblemWords,
  ): ServerChannelStatus => {
    return channel(ServerSendingChannel.Email, ServerSendingState.NotSetUp, {
      setUpProblem: ServerSetUpProblem.toEnglish(problem),
      setUpProblemWords: problem,
    });
  };

  test.each(["de", "fa"])(
    "in %s, nothing set up: the reader's words, not English",
    async (language: string) => {
      const locale: Locale = readLocale(language);
      const checklist: HTMLElement = await renderIn(
        language,
        answerFor({
          email: notSetUp(
            ServerSetUpProblem.of(SERVER_SET_UP_PROBLEMS.emailNotSetUp),
          ),
        }),
      );

      const line: HTMLElement = within(checklist).getAllByTestId(
        "server-setup-email-checked",
      )[0]!;

      expect(withoutIsolates(line.textContent || "")).toBe(
        locale[SERVER_SET_UP_PROBLEMS.emailNotSetUp] as string,
      );
      expect(line.textContent).not.toContain("Nothing is set up");
    },
  );

  test.each(["de", "fa"])(
    "in %s, a setting left blank: the provider as written, the setting as the settings form names it",
    async (language: string) => {
      const locale: Locale = readLocale(language);
      const checklist: HTMLElement = await renderIn(
        language,
        answerFor({
          email: notSetUp(
            ServerSetUpProblem.emailSettingNotSet(
              "Mailgun",
              SERVER_EMAIL_SETTING_NAMES.mailgunDomain,
            ),
          ),
        }),
      );

      const line: string = withoutIsolates(
        within(checklist).getAllByTestId("server-setup-email-checked")[0]!
          .textContent || "",
      );

      expect(line).toBe(
        fillTemplate(
          locale[SERVER_SET_UP_PROBLEMS.emailSettingNotSet] as string,
          {
            provider: "Mailgun",
            field: locale[SERVER_EMAIL_SETTING_NAMES.mailgunDomain] as string,
          },
        ),
      );
      expect(line).toContain("mg.example.com");
      expect(line).not.toContain("is not set under");
    },
  );

  test("a sentence sent with no words - an environment variable's problem - as it came", async () => {
    const problem: string =
      "The email settings set by environment variables cannot send: GLOBAL_EMAIL_SMTP_HOST is not set.";
    const checklist: HTMLElement = await renderIn(
      "de",
      answerFor({
        email: channel(
          ServerSendingChannel.Email,
          ServerSendingState.NotSetUp,
          { setUpProblem: problem },
        ),
      }),
    );

    expect(
      within(checklist).getAllByTestId("server-setup-email-checked")[0],
    ).toHaveTextContent(problem);
  });

  test("an older server's sentence, which is one of the keys, still reads in the reader's language", async () => {
    const de: Locale = readLocale("de");
    const checklist: HTMLElement = await renderIn("de", answerFor());

    expect(
      withoutIsolates(
        within(checklist).getAllByTestId("server-setup-email-checked")[0]!
          .textContent || "",
      ),
    ).toBe(de[SERVER_SET_UP_PROBLEMS.emailNotSetUp] as string);
  });

  test("in English, the row says what the server said, word for word", () => {
    const email: ServerSetupRow = row(
      rowsFor(
        answerFor({
          email: notSetUp(
            ServerSetUpProblem.emailSettingNotSet(
              "Postmark",
              SERVER_EMAIL_SETTING_NAMES.serverApiToken,
            ),
          ),
        }),
      ),
      ServerSetupCheckId.Email,
    );

    expect(email.checked.map(words)).toEqual([
      "Postmark: the Server API Token is not set under Settings > Emails.",
    ]);
  });

  test("every setting a problem names is a word of every language the Admin Dashboard speaks", () => {
    for (const language of ["en", ...ADMIN_DASHBOARD_LANGUAGES]) {
      const locale: Locale = readLocale(language);

      for (const name of Object.values(SERVER_EMAIL_SETTING_NAMES)) {
        expect({ language, name, type: typeof locale[name] }).toEqual({
          language,
          name,
          type: "string",
        });
      }
    }
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
    ...Object.values(SERVER_SETUP_BACKUP_SCRIPT_WORDS),
    ...Object.values(SERVER_TEST_PUSH_REASONS),
    SERVER_TEST_PUSH_DESCRIPTION,
    // Settings > Call and SMS's check of its own gateway (#7029).
    ...Object.values(CHECK_GATEWAY_COPY),
    // What a channel's settings are missing (#9437), and the settings it names that no form drew before.
    ...Object.values(SERVER_SET_UP_PROBLEMS),
    SERVER_EMAIL_SETTING_NAMES.awsRegion,
    SERVER_EMAIL_SETTING_NAMES.mailgunDomain,
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
          "VAPID_PUBLIC_KEY",
          "VAPID_PRIVATE_KEY",
          "npm run backup",
          "OneUptime On-Call",
          "Docker Compose",
          "Kubernetes",
          "Twilio",
          "us-east-1",
          "mg.example.com",
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
