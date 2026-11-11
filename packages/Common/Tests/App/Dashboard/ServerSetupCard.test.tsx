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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";

/*
 * "THIS SERVER IS NOT FINISHED" WHERE A NEW SERVER'S FIRST ADMIN LANDS (#6824).
 *
 * The first account of a self-hosted server becomes its admin and lands in
 * the Dashboard - on "No projects", then Home - never in the Admin
 * Dashboard. So a master admin sees this card there while a required check
 * is open: how many things are left, Finish setup (the Admin Dashboard's
 * Server setup, /admin/setup) and Hide.
 *
 *   - nobody but a master admin sees it, and nobody else's page asks;
 *   - not on OneUptime Cloud;
 *   - not once every required check is done, nor while this admin has hidden
 *     it - which the server keeps, for every browser;
 *   - Hide asks the server to hide it, and hides it at once even when the
 *     request fails;
 *   - its words in every Dashboard language, the count in each one's plural.
 */

let mockBillingEnabled: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

import ServerSetupCard, {
  isServerSetupCardShown,
  SERVER_SETUP_CARD_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServerSetup/ServerSetupCard";
import {
  ADMIN_SERVER_SETUP_ROUTE,
  getAdminServerSetupUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ServerEmail";
import {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import ServerSetupChecklistLoader from "../../../UI/Utils/ServerSetupChecklist";
import UserUtil from "../../../UI/Utils/User";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
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

function answer(
  openRequired: Array<ServerSetupCheckId>,
  isHiddenForReader: boolean = false,
): ServerSetupChecklistAnswer {
  return {
    checks: [],
    openRequired: openRequired,
    isHiddenForReader: isHiddenForReader,
  };
}

const THREE_OPEN: ServerSetupChecklistAnswer = answer([
  ServerSetupCheckId.Email,
  ServerSetupCheckId.Https,
  ServerSetupCheckId.Signups,
]);

let load: ReturnType<typeof jest.spyOn>;

async function draw(locale: string = "en"): Promise<HTMLElement | null> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ServerSetupCard />
    </I18nextProvider>,
  );
  await flush();

  return screen.queryByTestId("server-setup-card");
}

beforeEach(() => {
  mockBillingEnabled = false;
  ServerSetupChecklistLoader.clear();
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  load = jest
    .spyOn(ServerSetupChecklistLoader, "load")
    .mockResolvedValue(THREE_OPEN);
});

afterEach(() => {
  cleanup();
  ServerSetupChecklistLoader.clear();
  jest.restoreAllMocks();
});

describe("who sees it", () => {
  test("a master admin, while required checks are open: how many, and the way to them", async () => {
    const card: HTMLElement | null = await draw();

    expect(card).toBeVisible();
    expect(screen.getByTestId("server-setup-card-title")).toHaveTextContent(
      "This server is not finished: 3 things to set up",
    );
    expect(card).toHaveTextContent(SERVER_SETUP_CARD_COPY.description);
    expect(screen.getByTestId("server-setup-card-finish")).toHaveAttribute(
      "href",
      getAdminServerSetupUrl().toString(),
    );
    expect(getAdminServerSetupUrl().toString()).toMatch(/\/admin\/setup$/);
    expect(ADMIN_SERVER_SETUP_ROUTE).toBe("/setup");
  });

  test("one thing left reads as one", async () => {
    load.mockResolvedValue(answer([ServerSetupCheckId.Https]));

    await draw();

    expect(screen.getByTestId("server-setup-card-title")).toHaveTextContent(
      "This server is not finished: 1 thing to set up",
    );
  });

  test("a project member who is not a master admin never sees it, and their page never asks", async () => {
    load.mockRestore();
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    const fetchSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServerSetupChecklistLoader as unknown as { fetch: () => unknown },
      "fetch",
    );

    expect(await draw()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("not on OneUptime Cloud", async () => {
    mockBillingEnabled = true;

    expect(await draw()).toBeNull();
    expect(isServerSetupCardShown(THREE_OPEN)).toBe(false);
  });

  test("not once every required check is done", async () => {
    load.mockResolvedValue(answer([]));

    expect(await draw()).toBeNull();
  });

  test("not while this admin has hidden it", async () => {
    load.mockResolvedValue(answer([ServerSetupCheckId.Email], true));

    expect(await draw()).toBeNull();
  });

  test("not when the checklist cannot be read", async () => {
    load.mockResolvedValue(null);

    expect(await draw()).toBeNull();
    expect(isServerSetupCardShown(null)).toBe(false);
  });
});

describe("Hide", () => {
  test("asks the server to hide it for this admin, and it goes", async () => {
    const hide: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ServerSetupChecklistLoader, "hide")
      .mockResolvedValue(answer([ServerSetupCheckId.Email], true));

    await draw();

    await act(async () => {
      fireEvent.click(screen.getByTestId("server-setup-card-hide"));
    });
    await flush();

    expect(hide).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("server-setup-card")).toBeNull();
  });

  test("a request that fails still hides it for this visit", async () => {
    jest
      .spyOn(ServerSetupChecklistLoader, "hide")
      .mockRejectedValue(new Error("offline"));

    await draw();

    await act(async () => {
      fireEvent.click(screen.getByTestId("server-setup-card-hide"));
    });
    await flush();

    expect(screen.queryByTestId("server-setup-card")).toBeNull();
  });
});

describe("in every language the Dashboard speaks", () => {
  const OTHER: string = SERVER_SETUP_CARD_COPY.title.other;
  const ONE_KEY: string = `${OTHER}_one`;

  test("English: the general sentence is the key, the one form beside it", () => {
    const english: Locale = readLocale("en");

    expect(english[OTHER]).toBe(OTHER);
    expect(english[ONE_KEY]).toBe(SERVER_SETUP_CARD_COPY.title.one);
    expect(english[SERVER_SETUP_CARD_COPY.description]).toBe(
      SERVER_SETUP_CARD_COPY.description,
    );
    expect(english[SERVER_SETUP_CARD_COPY.finishSetup]).toBe(
      SERVER_SETUP_CARD_COPY.finishSetup,
    );
    expect(english[SERVER_SETUP_CARD_COPY.hide]).toBe(
      SERVER_SETUP_CARD_COPY.hide,
    );
    // The first extract's stray key is gone.
    expect(english[SERVER_SETUP_CARD_COPY.title.one]).toBeUndefined();
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s has every word, translated, the count kept",
    (locale: string) => {
      const translated: Locale = readLocale(locale);

      for (const key of [
        OTHER,
        ONE_KEY,
        SERVER_SETUP_CARD_COPY.description,
        SERVER_SETUP_CARD_COPY.finishSetup,
        SERVER_SETUP_CARD_COPY.hide,
      ]) {
        const value: unknown = translated[key];

        expect({ key, type: typeof value }).toEqual({ key, type: "string" });
        expect({ key, same: value === key }).toEqual({ key, same: false });
      }

      for (const key of [OTHER, ONE_KEY]) {
        expect(translated[key] as string).toContain("{{count}}");
      }
    },
  );

  test("in German, with German's plural", async () => {
    const de: Locale = readLocale("de");

    await draw("de");

    expect(screen.getByTestId("server-setup-card-title")).toHaveTextContent(
      (de[OTHER] as string).replace("{{count}}", "3"),
    );
    expect(screen.getByTestId("server-setup-card-finish")).toHaveTextContent(
      de[SERVER_SETUP_CARD_COPY.finishSetup] as string,
    );
  });
});

describe("where it is drawn", () => {
  test("on No projects (Welcome) and on Home", () => {
    const welcome: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages/Onboarding/Welcome.tsx"),
      "utf8",
    );
    const home: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages/Home/Home.tsx"),
      "utf8",
    );

    expect(welcome).toContain("<ServerSetupCard");
    expect(home).toContain("<ServerSetupCard />");
    // On Home, before the project's own Getting Started.
    expect(home.indexOf("<ServerSetupCard />")).toBeLessThan(
      home.indexOf("<GettingStarted"),
    );
  });
});
