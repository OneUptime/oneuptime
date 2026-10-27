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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Admin Dashboard's "Finish setting up this server" card (#5229's
 * follow-ups): on a self-hosted server whose email, HTTPS or sign-ups are
 * still open, at the top of the Admin Dashboard's first page (Users), with
 * each one's state and the place that changes it:
 *
 *   - Email: done when the mail server it sends through has its address and
 *     sender (Custom SMTP's host and From address, or SendGrid's From
 *     address); "Set up email" opens Settings > Emails;
 *   - HTTPS: done when HTTP_PROTOCOL=https and the page came over HTTPS;
 *     "How to set up HTTPS" opens the guide in a new tab, and says so. A
 *     page that came over HTTPS to a server still set to HTTP (a proxy in
 *     front) is told just that - not that passwords cross the network
 *     unencrypted (fu-platform's review);
 *   - Sign-ups: done once sign-ups are off; "Choose who can sign up" opens
 *     Settings > Authentication.
 *
 * It draws nothing on OneUptime Cloud, once all three are done, once its
 * admin hides it in this browser, or when the settings cannot be read. In
 * every language the Admin Dashboard speaks.
 */

const mockGetItem: MockFunction = getJestMockFunction();
let mockBillingEnabled: boolean = false;
let mockHttpProtocol: string = "http";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocol: typeof import("../../../Types/API/Protocol") =
    jest.requireActual(
      "../../../Types/API/Protocol",
    ) as typeof import("../../../Types/API/Protocol");
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });
  Object.defineProperty(mocked, "HTTP_PROTOCOL", {
    get: (): unknown => {
      return mockHttpProtocol === "https"
        ? protocol.default.HTTPS
        : protocol.default.HTTP;
    },
  });

  return mocked;
});

import ServerSetupChecklist, {
  SERVER_SETUP_COPY,
  SERVER_SETUP_HIDDEN_STORAGE_KEY,
  SERVER_SETUP_HTTPS_GUIDE,
  ServerSetupItem,
  ServerSetupItemName,
  getServerSetupItems,
  isEmailSetUp,
  isHttpsOnlyBeforeOneUptime,
  isServedOverHttps,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerSetupChecklist";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import Protocol from "../../../Types/API/Protocol";

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

const OTHER_LOCALES: Array<string> = [
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
];

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

const config: (values: Partial<GlobalConfig>) => GlobalConfig = (
  values: Partial<GlobalConfig>,
): GlobalConfig => {
  return Object.assign(new GlobalConfig(), values);
};

const NOTHING_SET_UP: GlobalConfig = config({ disableSignup: false });

async function renderIn(
  locale: string,
  pageProtocol: string = "http:",
): Promise<HTMLElement | null> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter>
        <ServerSetupChecklist pageProtocol={pageProtocol} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await flush();

  return screen.queryByTestId("server-setup-checklist");
}

// The copy's words as one list, in the order a locale must have them.
const COPY_WORDS: Array<string> = [
  SERVER_SETUP_COPY.title,
  SERVER_SETUP_COPY.description,
  SERVER_SETUP_COPY.hide,
  SERVER_SETUP_COPY.email.title,
  SERVER_SETUP_COPY.email.done,
  SERVER_SETUP_COPY.email.open,
  SERVER_SETUP_COPY.email.action,
  SERVER_SETUP_COPY.https.title,
  SERVER_SETUP_COPY.https.done,
  SERVER_SETUP_COPY.https.open,
  SERVER_SETUP_COPY.https.onlyBeforeOneUptime,
  SERVER_SETUP_COPY.https.action,
  SERVER_SETUP_COPY.signups.title,
  SERVER_SETUP_COPY.signups.done,
  SERVER_SETUP_COPY.signups.open,
  SERVER_SETUP_COPY.signups.action,
  SERVER_SETUP_COPY.doneLabel,
  SERVER_SETUP_COPY.openLabel,
  SERVER_SETUP_COPY.opensInNewTab,
];

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(async () => {
    return NOTHING_SET_UP;
  });
  mockBillingEnabled = false;
  mockHttpProtocol = "http";
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("isEmailSetUp", () => {
  test("Custom SMTP, also when nothing was picked: its host and its sender", () => {
    expect(isEmailSetUp({})).toBe(false);
    expect(isEmailSetUp({ smtpHost: "smtp.example.com" })).toBe(false);
    expect(isEmailSetUp({ smtpFromEmail: "ops@example.com" })).toBe(false);
    expect(
      isEmailSetUp({
        smtpHost: "smtp.example.com",
        smtpFromEmail: "ops@example.com",
      }),
    ).toBe(true);
    expect(
      isEmailSetUp({
        emailServerType: EmailServerType.CustomSMTP,
        smtpHost: " ",
        smtpFromEmail: "ops@example.com",
      }),
    ).toBe(false);
  });

  test("SendGrid: its sender, whatever the SMTP fields hold", () => {
    expect(
      isEmailSetUp({
        emailServerType: EmailServerType.Sendgrid,
        smtpHost: "smtp.example.com",
        smtpFromEmail: "ops@example.com",
      }),
    ).toBe(false);
    expect(
      isEmailSetUp({
        emailServerType: EmailServerType.Sendgrid,
        sendgridFromEmail: "ops@example.com",
      }),
    ).toBe(true);
  });
});

describe("isServedOverHttps", () => {
  test("only when OneUptime is told so and the page came over HTTPS", () => {
    expect(isServedOverHttps(Protocol.HTTPS, "https:")).toBe(true);
    expect(isServedOverHttps(Protocol.HTTP, "http:")).toBe(false);
    // A proxy in front serves HTTPS, but OneUptime still writes http:// links and plain cookies.
    expect(isServedOverHttps(Protocol.HTTP, "https:")).toBe(false);
    expect(isServedOverHttps(Protocol.HTTPS, "http:")).toBe(false);
  });
});

describe("isHttpsOnlyBeforeOneUptime", () => {
  test("only when the page came over HTTPS and OneUptime is still set to HTTP", () => {
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTP, "https:")).toBe(true);
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTPS, "https:")).toBe(false);
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTP, "http:")).toBe(false);
    expect(isHttpsOnlyBeforeOneUptime(Protocol.HTTPS, "http:")).toBe(false);
  });
});

describe("getServerSetupItems", () => {
  test("email, HTTPS and sign-ups, in that order, each with the place that changes it", () => {
    const items: Array<ServerSetupItem> = getServerSetupItems({
      emailIsSetUp: false,
      isServedOverHttps: false,
      signupsAreClosed: false,
    });

    expect(
      items.map((item: ServerSetupItem) => {
        return item.name;
      }),
    ).toEqual([
      ServerSetupItemName.Email,
      ServerSetupItemName.Https,
      ServerSetupItemName.Signups,
    ]);
    expect(items[0]!.route?.toString()).toBe(
      RouteMap[PageMap.SETTINGS_SMTP]!.toString(),
    );
    expect(items[1]!.guideUrl).toBe(SERVER_SETUP_HTTPS_GUIDE);
    expect(items[1]!.route).toBeUndefined();
    expect(items[2]!.route?.toString()).toBe(
      RouteMap[PageMap.SETTINGS_AUTHENTICATION]!.toString(),
    );
    expect(
      items.map((item: ServerSetupItem) => {
        return item.description;
      }),
    ).toEqual([
      SERVER_SETUP_COPY.email.open,
      SERVER_SETUP_COPY.https.open,
      SERVER_SETUP_COPY.signups.open,
    ]);
  });

  test("behind an HTTPS proxy, HTTPS is still to do, and says only HTTP_PROTOCOL is left", () => {
    const https: ServerSetupItem = getServerSetupItems({
      emailIsSetUp: false,
      isServedOverHttps: false,
      isHttpsOnlyBeforeOneUptime: true,
      signupsAreClosed: false,
    })[1]!;

    expect(https.isDone).toBe(false);
    expect(https.description).toBe(SERVER_SETUP_COPY.https.onlyBeforeOneUptime);
    expect(https.description).toContain("HTTP_PROTOCOL=https");
    // Not the line for a server nobody reaches over HTTPS.
    expect(https.description).not.toContain("unencrypted");
    expect(https.guideUrl).toBe(SERVER_SETUP_HTTPS_GUIDE);
  });

  test("a done item says what it means now", () => {
    const items: Array<ServerSetupItem> = getServerSetupItems({
      emailIsSetUp: true,
      isServedOverHttps: true,
      signupsAreClosed: true,
    });

    expect(
      items.map((item: ServerSetupItem) => {
        return [item.isDone, item.description];
      }),
    ).toEqual([
      [true, SERVER_SETUP_COPY.email.done],
      [true, SERVER_SETUP_COPY.https.done],
      [true, SERVER_SETUP_COPY.signups.done],
    ]);
  });

  test("the HTTPS guide is the Docker Compose guide's own section", () => {
    const guide: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
      ),
      "utf8",
    );

    expect(SERVER_SETUP_HTTPS_GUIDE).toBe(
      "/docs/installation/docker-compose#set-up-https",
    );
    expect(guide.split("\n")).toContain("## Set up HTTPS");
  });
});

describe("the card", () => {
  test("a new server: every item still to do, each with its button, at the top of the page", async () => {
    const card: HTMLElement | null = await renderIn("en");

    expect(card).not.toBeNull();
    expect(card!).toHaveTextContent(SERVER_SETUP_COPY.title);
    expect(card!).toHaveTextContent(SERVER_SETUP_COPY.description);

    for (const name of ["email", "https", "signups"]) {
      const row: HTMLElement = screen.getByTestId(`server-setup-${name}`);
      expect(row).toHaveAttribute("data-done", "false");
      expect(
        within(row).getByTestId(`server-setup-${name}-action`),
      ).toBeVisible();
      expect(row).toHaveTextContent(SERVER_SETUP_COPY.openLabel);
    }

    expect(screen.getByTestId("server-setup-email-action")).toHaveTextContent(
      SERVER_SETUP_COPY.email.action,
    );
    expect(
      screen.getByTestId("server-setup-email-action").getAttribute("href"),
    ).toBe(RouteMap[PageMap.SETTINGS_SMTP]!.toString());
    expect(
      screen.getByTestId("server-setup-signups-action").getAttribute("href"),
    ).toBe(RouteMap[PageMap.SETTINGS_AUTHENTICATION]!.toString());

    const https: HTMLElement = screen.getByTestId("server-setup-https-action");
    expect(new URL(https.getAttribute("href") || "").pathname).toBe(
      "/docs/installation/docker-compose",
    );
    expect(new URL(https.getAttribute("href") || "").hash).toBe(
      "#set-up-https",
    );
    expect(https).toHaveAttribute("target", "_blank");
    // The guide opens in a tab of its own, and the link says so.
    expect(
      within(https).getByTestId("server-setup-https-new-tab"),
    ).toBeInTheDocument();
    expect(https).toHaveTextContent(
      `${SERVER_SETUP_COPY.https.action} (${SERVER_SETUP_COPY.opensInNewTab})`,
    );
    // The pages of the Admin Dashboard open where the card is.
    for (const name of ["email", "signups"]) {
      const action: HTMLElement = screen.getByTestId(
        `server-setup-${name}-action`,
      );
      expect(action).not.toHaveAttribute("target", "_blank");
      expect(
        within(action).queryByTestId(`server-setup-${name}-new-tab`),
      ).toBeNull();
      expect(action).not.toHaveTextContent(SERVER_SETUP_COPY.opensInNewTab);
    }

    // It reads only the settings it needs, never a secret.
    const [request] = mockGetItem.mock.calls[0] as [
      { select: Record<string, boolean> },
    ];
    expect(Object.keys(request.select).sort()).toEqual([
      "_id",
      "disableSignup",
      "emailServerType",
      "sendgridFromEmail",
      "smtpFromEmail",
      "smtpHost",
    ]);
  });

  test("a done item shows its check and no button", async () => {
    mockGetItem.mockImplementation(async () => {
      return config({
        smtpHost: "smtp.example.com" as never,
        smtpFromEmail: "ops@example.com" as never,
        disableSignup: false,
      });
    });

    await renderIn("en");

    const email: HTMLElement = screen.getByTestId("server-setup-email");
    expect(email).toHaveAttribute("data-done", "true");
    expect(email).toHaveTextContent(SERVER_SETUP_COPY.email.done);
    expect(email).toHaveTextContent(SERVER_SETUP_COPY.doneLabel);
    expect(screen.queryByTestId("server-setup-email-action")).toBeNull();
    expect(screen.getByTestId("server-setup-https")).toHaveAttribute(
      "data-done",
      "false",
    );
  });

  test("a page that came over HTTPS to a server still set to HTTP: HTTPS says only HTTP_PROTOCOL is left", async () => {
    mockHttpProtocol = "http";

    await renderIn("en", "https:");

    const https: HTMLElement = screen.getByTestId("server-setup-https");
    expect(https).toHaveAttribute("data-done", "false");
    expect(https).toHaveTextContent(
      SERVER_SETUP_COPY.https.onlyBeforeOneUptime,
    );
    expect(https).not.toHaveTextContent(SERVER_SETUP_COPY.https.open);
    expect(
      within(https).getByTestId("server-setup-https-action"),
    ).toBeVisible();
  });

  test("a page that came over HTTP: HTTPS is not set up", async () => {
    await renderIn("en", "http:");

    expect(screen.getByTestId("server-setup-https")).toHaveTextContent(
      SERVER_SETUP_COPY.https.open,
    );
  });

  test("all three done: nothing is drawn", async () => {
    mockHttpProtocol = "https";
    mockGetItem.mockImplementation(async () => {
      return config({
        emailServerType: EmailServerType.Sendgrid,
        sendgridFromEmail: "ops@example.com" as never,
        disableSignup: true,
      });
    });

    expect(await renderIn("en", "https:")).toBeNull();
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  test("Hide: gone, and gone the next time this browser opens the page", async () => {
    await renderIn("en");

    fireEvent.click(
      screen.getByRole("button", { name: SERVER_SETUP_COPY.hide }),
    );
    await flush();

    expect(screen.queryByTestId("server-setup-checklist")).toBeNull();
    expect(window.localStorage.getItem(SERVER_SETUP_HIDDEN_STORAGE_KEY)).toBe(
      "true",
    );

    cleanup();
    mockGetItem.mockClear();

    expect(await renderIn("en")).toBeNull();
    // Hidden: not even the settings are read.
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  test("OneUptime Cloud draws nothing and reads nothing", async () => {
    mockBillingEnabled = true;

    expect(await renderIn("en")).toBeNull();
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  test("settings that cannot be read draw nothing", async () => {
    mockGetItem.mockImplementation(() => {
      throw new Error("forbidden");
    });
    expect(await renderIn("en")).toBeNull();

    cleanup();
    mockGetItem.mockImplementation(async () => {
      return null;
    });
    expect(await renderIn("en")).toBeNull();
  });

  test("in German", async () => {
    const card: HTMLElement | null = await renderIn("de");

    expect(card!).toHaveTextContent("Diesen Server fertig einrichten");
    expect(screen.getByTestId("server-setup-email-action")).toHaveTextContent(
      "E-Mail einrichten",
    );
    expect(
      screen.getByRole("button", { name: "Ausblenden" }),
    ).toBeInTheDocument();
  });
});

describe("its words, in every language the Admin Dashboard speaks", () => {
  const english: Locale = readLocale("en");

  test("English has every word as its own value", () => {
    for (const word of COPY_WORDS) {
      expect({ word, value: english[word] }).toEqual({ word, value: word });
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has every word, translated",
    (locale: string) => {
      const translated: Locale = readLocale(locale);

      for (const word of COPY_WORDS) {
        const value: unknown = translated[word];

        expect({ word, type: typeof value }).toEqual({ word, type: "string" });
        expect((value as string).trim().length).toBeGreaterThan(0);
        // Words a translation keeps as they are: product, protocol and "Email" in some.
        if (!["HTTPS", "Email", "Done"].includes(word)) {
          expect({ word, same: value === word }).toEqual({ word, same: false });
        }
        // OneUptime keeps its name in every language.
        if (word.includes("OneUptime")) {
          expect(value as string).toContain("OneUptime");
        }
        // A setting and an address are written as they are typed.
        for (const literal of ["HTTP_PROTOCOL=https", "http://"]) {
          if (word.includes(literal)) {
            expect({
              word,
              literal,
              kept: (value as string).includes(literal),
            }).toEqual({
              word,
              literal,
              kept: true,
            });
          }
        }
      }
    },
  );
});

describe("the Admin Dashboard's first page draws it", () => {
  test("the Users page, which the Admin Dashboard opens on, puts it above its table", () => {
    const usersPage: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx",
      ),
      "utf8",
    );
    const initPage: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Pages/Init/Init.tsx",
      ),
      "utf8",
    );

    expect(initPage).toContain("RouteMap[PageMap.USERS]");
    expect(usersPage.indexOf("<ServerSetupChecklist />")).toBeGreaterThan(-1);
    expect(usersPage.indexOf("<ServerSetupChecklist />")).toBeLessThan(
      usersPage.indexOf("<ModelTable<User>"),
    );
  });
});
