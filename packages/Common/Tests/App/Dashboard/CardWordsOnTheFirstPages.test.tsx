import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";

/*
 * WHAT THE FIRST PAGES SAY ABOUT A CARD, ON ONEUPTIME CLOUD (#8246).
 *
 * On Cloud's Free plan every monitor but a Manual one needs a payment
 * method (MonitorService.onBeforeCreate, PayAsYouGoBillingService), so the
 * first thing most people do - check a website - needs a card. The pages
 * before it said the other thing: Sign-up "No credit card required.", the
 * Welcome page the same, and Create New Project's Free plan "Active
 * monitors and telemetry are pay as you go", which a newcomer did not read
 * as their website check. Each was true on its own; together they said a
 * website check was free. Now:
 *
 *   - Sign-up says no card is needed to sign up;
 *   - Welcome says creating a project needs none, and that on the Free
 *     plan checking a website, an API or a server needs a payment method;
 *   - Create New Project's Free plan says the same in the reader's words;
 *   - each, in every language, worded anew;
 *   - a self-hosted server, which never asks for a card, says nothing of
 *     cards, as before.
 *
 * The real Welcome page, its invitations, settings and user stubbed, and
 * react-i18next answering from the real locale files.
 */

const FEATURE_SET: string = path.join(__dirname, "../../../../App/FeatureSet");
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SET,
  "Dashboard/src/Locales",
);
const ADMIN_LOCALES: string = path.join(
  FEATURE_SET,
  "AdminDashboard/src/Locales",
);
const ACCOUNTS_LOCALES: string = path.join(FEATURE_SET, "Accounts/src/Locales");

type LocaleData = Record<string, unknown>;

function readLocale(directory: string, code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${code}.json`), "utf8"),
  ) as LocaleData;
}

function languagesIn(directory: string): Array<string> {
  return fs
    .readdirSync(directory)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();
}

const EN: LocaleData = readLocale(DASHBOARD_LOCALES, "en");
const DE: LocaleData = readLocale(DASHBOARD_LOCALES, "de");

let activeLocale: LocaleData = EN;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: {
          language: activeLocale === DE ? "de" : "en",
        },
      };
    },
  };
});

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: true,
  };
});

jest.mock(
  "../../../UI/Components/ProjectInvitations/PendingProjectInvitations",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onInvitationsLoaded: (count: number) => void;
      }): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        ReactActual.useEffect(() => {
          props.onInvitationsLoaded(0);
        }, []);
        return ReactActual.createElement("div", {
          "data-testid": "pending-invitations",
        });
      },
    };
  },
);

jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: () => {
        return Promise.resolve({ disableUserProjectCreation: false });
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import Welcome, {
  WELCOME_CARD_LINE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/Welcome";
import { PlanPickerCopy } from "../../../UI/Components/Billing/PlanPicker/PlanPickerCopy";
import * as UIConfig from "../../../UI/Config";
import Route from "../../../Types/API/Route";

const SIGN_UP_LINE: string = "No credit card required to sign up.";
const OLD_LINE: string = "No credit card required.";
const OLD_FREE_USAGE: string =
  "Active monitors and telemetry are pay as you go, and need a payment method.";

function setBilling(isBillingEnabled: boolean): void {
  Object.defineProperty(UIConfig, "BILLING_ENABLED", {
    value: isBillingEnabled,
    configurable: true,
    writable: true,
  });
}

async function renderWelcome(): Promise<HTMLElement> {
  await act(async () => {
    render(
      <Welcome
        pageRoute={new Route("/dashboard/welcome")}
        currentProject={null}
        hasPaymentMethod={false}
        onClickShowProjectModal={(): void => {}}
      />,
    );
  });

  const element: HTMLElement | null = document.getElementById(
    "empty-state-no-projects",
  );
  expect(element).not.toBeNull();
  return element!;
}

beforeEach(() => {
  activeLocale = EN;
  setBilling(true);
});

afterEach(() => {
  cleanup();
  setBilling(true);
});

describe("the words", () => {
  test("Sign-up says no card is needed to sign up, and no more", () => {
    const accounts: LocaleData = readLocale(ACCOUNTS_LOCALES, "en");

    expect(
      (accounts["register"] as Record<string, string>)["noCreditCard"],
    ).toBe(SIGN_UP_LINE);
  });

  test("Welcome says a project needs no card, and where one is needed", () => {
    expect(WELCOME_CARD_LINE).toBe(
      "A project needs no card. On the Free plan, checking a website needs a payment method.",
    );
  });

  test("Create New Project's Free plan says what needs a card in the same words", () => {
    expect(PlanPickerCopy.freeUsage).toBe(
      "Checking a website, an API or a server, and sending telemetry, are billed as they are used and need a payment method.",
    );

    for (const sentence of [WELCOME_CARD_LINE, PlanPickerCopy.freeUsage]) {
      expect(sentence.toLowerCase()).toContain("checking a website");
      expect(sentence).toContain("need");
      expect(sentence).toContain("a payment method");
      expect(sentence).not.toMatch(/active monitor/i);
    }
  });

  /*
   * An empty state's description holds 150 characters
   * (ShortDescriptionsGuard), and Welcome's says what a project is first.
   */
  test("Welcome's description stays short", () => {
    expect(
      `A project holds your monitors, incidents, status pages and team. ${WELCOME_CARD_LINE}`
        .length,
    ).toBeLessThanOrEqual(150);
  });

  test("no first page says a card is never needed", () => {
    for (const sentence of [
      SIGN_UP_LINE,
      WELCOME_CARD_LINE,
      PlanPickerCopy.freeUsage,
    ]) {
      expect(sentence).not.toBe(OLD_LINE);
    }
  });
});

describe("the Welcome page, on OneUptime Cloud", () => {
  test("says what a project is, that it needs no card, and that a website check on Free does", async () => {
    const empty: HTMLElement = await renderWelcome();

    expect(empty).toHaveTextContent(
      "A project holds your monitors, incidents, status pages and team.",
    );
    expect(empty).toHaveTextContent(WELCOME_CARD_LINE);
  });

  test("no longer says only that no card is required", async () => {
    const empty: HTMLElement = await renderWelcome();
    const text: string = empty.textContent || "";

    expect(text.split(OLD_LINE).length - 1).toBe(0);
  });

  test("in German, in German", async () => {
    activeLocale = DE;

    const empty: HTMLElement = await renderWelcome();

    expect(empty).toHaveTextContent(String(DE[WELCOME_CARD_LINE]));
    expect(empty).not.toHaveTextContent(WELCOME_CARD_LINE);
  });
});

describe("the Welcome page, on a self-hosted server", () => {
  test("says nothing of cards: nothing there asks for one", async () => {
    setBilling(false);

    const empty: HTMLElement = await renderWelcome();

    expect(empty).toHaveTextContent(
      "A project holds your monitors, incidents, status pages and team.",
    );
    expect(empty.textContent || "").not.toMatch(/credit card|payment method/i);
  });
});

describe("in every language", () => {
  test.each([
    ["the Dashboard's Welcome line", DASHBOARD_LOCALES, WELCOME_CARD_LINE],
    [
      "the Dashboard's Free plan line",
      DASHBOARD_LOCALES,
      PlanPickerCopy.freeUsage,
    ],
    [
      "the Admin Dashboard's Free plan line",
      ADMIN_LOCALES,
      PlanPickerCopy.freeUsage,
    ],
  ] as Array<[string, string, string]>)(
    "%s is worded anew, and the old one is gone",
    (_what: string, directory: string, sentence: string) => {
      const english: LocaleData = readLocale(directory, "en");

      expect(english[sentence]).toBe(sentence);
      expect(english[OLD_FREE_USAGE]).toBeUndefined();

      const codes: Array<string> = languagesIn(directory);

      expect(codes).toHaveLength(17);

      for (const code of codes) {
        const locale: LocaleData = readLocale(directory, code);
        const translated: unknown = locale[sentence];

        expect({ code, isText: typeof translated === "string" }).toEqual({
          code,
          isText: true,
        });
        expect({ code, sameAsEnglish: translated === sentence }).toEqual({
          code,
          sameAsEnglish: false,
        });
        expect({ code, old: locale[OLD_FREE_USAGE] }).toEqual({
          code,
          old: undefined,
        });
      }
    },
  );

  test("the Dashboard no longer keeps the old Welcome line", () => {
    for (const code of ["en", ...languagesIn(DASHBOARD_LOCALES)]) {
      expect({
        code,
        old: readLocale(DASHBOARD_LOCALES, code)[OLD_LINE],
      }).toEqual({ code, old: undefined });
    }
  });

  test("the Welcome line names the Free plan as it is named: Free, in Latin letters", () => {
    for (const code of languagesIn(DASHBOARD_LOCALES)) {
      expect({
        code,
        namesFree: String(
          readLocale(DASHBOARD_LOCALES, code)[WELCOME_CARD_LINE],
        ).includes("Free"),
      }).toEqual({ code, namesFree: true });
    }
  });

  test("the two dashboards say the Free plan's line alike", () => {
    for (const code of languagesIn(ADMIN_LOCALES)) {
      expect({
        code,
        admin: readLocale(ADMIN_LOCALES, code)[PlanPickerCopy.freeUsage],
      }).toEqual({
        code,
        admin: readLocale(DASHBOARD_LOCALES, code)[PlanPickerCopy.freeUsage],
      });
    }
  });

  test("Sign-up's line is worded anew in every language", () => {
    const codes: Array<string> = languagesIn(ACCOUNTS_LOCALES);

    expect(codes).toHaveLength(17);

    const before: Record<string, string> = {
      de: "Keine Kreditkarte erforderlich.",
      fr: "Aucune carte de crédit requise.",
      es: "No se requiere tarjeta de crédito.",
      ja: "クレジットカードは不要です。",
      ar: "لا حاجة إلى بطاقة ائتمان.",
    };

    for (const code of codes) {
      const line: unknown = (
        readLocale(ACCOUNTS_LOCALES, code)["register"] as Record<
          string,
          unknown
        >
      )["noCreditCard"];

      expect({ code, isText: typeof line === "string" }).toEqual({
        code,
        isText: true,
      });
      expect({ code, sameAsEnglish: line === SIGN_UP_LINE }).toEqual({
        code,
        sameAsEnglish: false,
      });

      if (before[code]) {
        expect({ code, changed: line !== before[code] }).toEqual({
          code,
          changed: true,
        });
      }
    }
  });
});
