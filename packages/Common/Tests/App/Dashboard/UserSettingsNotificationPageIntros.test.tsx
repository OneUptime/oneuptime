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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

/*
 * THE FOUR PAGES OF ALERTS & NOTIFICATIONS SAY WHICH ONE THEY ARE (#8887).
 *
 * Notification Methods, How to Reach Me, Notification Settings and Email
 * Preferences sit together in User Settings and sound alike. Each answers
 * one question - where OneUptime can reach you, how you are paged on call,
 * which updates reach you, and how much email they add up to - and now
 * opens on a line that says it, links the pages it is mistaken for, and
 * links its docs. (How to Reach Me's card says it already: "How to reach
 * me when I am on call"; Notification Settings' line is held by
 * UserSettingsNotificationSettings.test.tsx.)
 */

function stub(testId: string): () => ReactElement {
  const Stub: () => ReactElement = (): ReactElement => {
    return <div data-testid={testId} />;
  };

  return Stub;
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodTabs",
  () => {
    return { __esModule: true, default: stub("notification-method-tabs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageCard",
  () => {
    return { __esModule: true, default: stub("test-page-card") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EmailPreferences/EmailNoiseCard",
  () => {
    return { __esModule: true, default: stub("email-noise-card") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EmailPreferences/EmailRollupCard",
  () => {
    return { __esModule: true, default: stub("email-rollup-card") };
  },
);

import NotificationMethodsPage, {
  NOTIFICATION_METHODS_INTRO,
  NOTIFICATION_METHODS_INTRO_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationMethods";
import EmailPreferencesPage, {
  EMAIL_PREFERENCES_INTRO,
  EMAIL_PREFERENCES_INTRO_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/EmailPreferences";
import UserSettingsPageIntro from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/UserSettingsPageIntro";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111f1",
);

const USER_SETTINGS: string = `/dashboard/${PROJECT_ID.toString()}/user-settings`;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/user-settings"),
  currentProject: null,
  hasPaymentMethod: true,
};

describe("Notification Methods' first line", () => {
  test("says where OneUptime can reach you, before anything else on the page", () => {
    render(<NotificationMethodsPage {...PAGE_PROPS} />);

    const intro: HTMLElement = screen.getByTestId(
      NOTIFICATION_METHODS_INTRO_TEST_ID,
    );

    expect(intro).toHaveTextContent(
      "Where OneUptime can reach you in this project: email addresses, phone numbers, chat accounts, devices and webhooks. How to Reach Me and Notification Settings decide when each is used.",
    );
    // First: before the test page card and the methods.
    expect(
      intro.compareDocumentPosition(screen.getByTestId("test-page-card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("notification-method-tabs")).toBeInTheDocument();
  });

  test("links the two pages that decide when a method is used, and its docs", () => {
    render(<NotificationMethodsPage {...PAGE_PROPS} />);

    const intro: HTMLElement = screen.getByTestId(
      NOTIFICATION_METHODS_INTRO_TEST_ID,
    );

    expect(
      within(intro).getByRole("link", { name: "How to Reach Me" }),
    ).toHaveAttribute("href", `${USER_SETTINGS}/on-call-rules`);
    expect(
      within(intro).getByRole("link", { name: "Notification Settings" }),
    ).toHaveAttribute("href", `${USER_SETTINGS}/notification-settings`);
    expect(
      within(intro).getByTestId(
        `${NOTIFICATION_METHODS_INTRO_TEST_ID}-learn-more`,
      ),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("notifications/notification-methods"),
    );
  });

  test("in German, with the page names as the German menu says them", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(<NotificationMethodsPage {...PAGE_PROPS} />);

    const intro: HTMLElement = screen.getByTestId(
      NOTIFICATION_METHODS_INTRO_TEST_ID,
    );
    const german: Record<string, string> = readLocale("de");

    expect(intro).toHaveTextContent(
      german[NOTIFICATION_METHODS_INTRO]!.replace(
        "{{howToReachMe}}",
        german["How to Reach Me"]!,
      ).replace("{{notificationSettings}}", german["Notification Settings"]!),
    );
  });
});

describe("Email Preferences' first line", () => {
  test("says it is how much email, and that which updates is Notification Settings'", () => {
    render(<EmailPreferencesPage {...PAGE_PROPS} />);

    const intro: HTMLElement = screen.getByTestId(
      EMAIL_PREFERENCES_INTRO_TEST_ID,
    );

    expect(intro).toHaveTextContent(
      "How much email your updates add up to in this project. Notification Settings decides which updates you get.",
    );
    expect(
      within(intro).getByRole("link", { name: "Notification Settings" }),
    ).toHaveAttribute("href", `${USER_SETTINGS}/notification-settings`);
    expect(
      within(intro).getByTestId(
        `${EMAIL_PREFERENCES_INTRO_TEST_ID}-learn-more`,
      ),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("emails/notification-rollup"),
    );
  });

  test("comes before both of its cards", () => {
    render(<EmailPreferencesPage {...PAGE_PROPS} />);

    const intro: HTMLElement = screen.getByTestId(
      EMAIL_PREFERENCES_INTRO_TEST_ID,
    );

    for (const card of ["email-noise-card", "email-rollup-card"]) {
      expect(
        intro.compareDocumentPosition(screen.getByTestId(card)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe("a first line", () => {
  test("is a line of the page, in its grey, with its docs after it - not a banner", () => {
    render(
      <UserSettingsPageIntro
        docsPath="/docs/notifications/index"
        dataTestId="intro"
      >
        <span>What this page is for.</span>
      </UserSettingsPageIntro>,
    );

    const intro: HTMLElement = screen.getByTestId("intro");

    expect(intro.className).toContain("text-gray-500");
    expect(intro.className).not.toMatch(/bg-(blue|sky|indigo|cyan)-50/);
    expect(intro).not.toHaveAttribute("role", "alert");
    expect(intro).toHaveTextContent("What this page is for. Learn more");
    expect(within(intro).getByTestId("intro-learn-more")).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});

describe("the two first lines, in every language", () => {
  test.each(LANGUAGES)(
    "%s words both, keeping the page names as slots",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const [english, slots] of [
        [
          NOTIFICATION_METHODS_INTRO,
          ["{{howToReachMe}}", "{{notificationSettings}}"],
        ],
        [EMAIL_PREFERENCES_INTRO, ["{{notificationSettings}}"]],
      ] as Array<[string, Array<string>]>) {
        const worded: string = locale[english] || "";

        expect({
          language,
          english,
          worded: worded !== english && worded.length > 0,
        }).toEqual({
          language,
          english,
          worded: true,
        });

        for (const slot of slots) {
          expect({ language, slot, kept: worded.includes(slot) }).toEqual({
            language,
            slot,
            kept: true,
          });
        }
      }
    },
  );
});
