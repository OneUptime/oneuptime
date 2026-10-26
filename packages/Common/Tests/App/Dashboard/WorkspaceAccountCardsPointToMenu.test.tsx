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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Mock, SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent } from "react";

/*
 * THE SLACK AND MICROSOFT TEAMS ACCOUNT CARDS SAY WHERE YOUR ACCOUNT IS
 * CONNECTED - AS THE MENU DRAWS IT, IN EVERY LANGUAGE.
 *
 * User Settings > Notification Methods > Workspace Apps holds a card per
 * connected workspace. Adding your account there points at the account you
 * linked on that workspace's own page, so an empty card says where that page
 * is. It said "User Settings > Slack Integration": User Settings has no such
 * entry. The page is the Slack entry of the Workspace section, which starts
 * folded, so the way there is User Settings > Workspace > Slack.
 *
 * Rendered for real - the cards and the User Settings side menu - so the
 * message is held to the menu a person actually sees: its Workspace section,
 * its entry and the page that entry opens (the page the card's error dialog
 * opens too), and the card's own button. Then the same in all sixteen other
 * languages, where each step must be named as that language's Dashboard
 * draws it.
 */

const mockGetList: Mock<(...args: Array<unknown>) => Promise<unknown>> =
  jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
const mockCreate: Mock<(...args: Array<unknown>) => Promise<unknown>> =
  jest.fn<(...args: Array<unknown>) => Promise<unknown>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): Promise<unknown> => {
        return mockGetList(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      create: (...args: Array<unknown>): Promise<unknown> => {
        return mockCreate(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

import SlackAccountCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack";
import MicrosoftTeamsAccountCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams";
import UserSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ConnectedWorkspaces, {
  ConnectedWorkspacesFetcher,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import {
  WORKSPACE_MENU_ENTRY_TITLES,
  WORKSPACE_SECTION_TITLE,
  WorkspaceMenuEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSideMenuSection";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  isExpanded,
  linksIn,
  routeFor,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
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

// What a language's Dashboard draws for an English label.
function drawn(language: string, english: string): string {
  const value: unknown = readLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// What the bar draws for User Settings, in a language.
function barEntry(language: string): string {
  const navbar: Record<string, unknown> = readLocale(language)[
    "navbar"
  ] as Record<string, unknown>;

  return navbar["userSettings"] as string;
}

interface AccountCard {
  name: string;
  Card: FunctionComponent;
  workspaceType: WorkspaceType;
  entry: WorkspaceMenuEntry;
  page: string;
  addButton: string;
  emptyTitle: string;
  emptyMessage: string;
  errorButton: string;
}

const CARDS: Array<AccountCard> = [
  {
    name: "Slack",
    Card: SlackAccountCard as FunctionComponent,
    workspaceType: WorkspaceType.Slack,
    entry: WorkspaceMenuEntry.Slack,
    page: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
    addButton: "Add Slack Account",
    emptyTitle: "No Slack account added",
    emptyMessage:
      "Connect your Slack account under User Settings > Workspace > Slack, then click 'Add Slack Account'.",
    errorButton: "Open Slack Settings",
  },
  {
    name: "Microsoft Teams",
    Card: MicrosoftTeamsAccountCard as FunctionComponent,
    workspaceType: WorkspaceType.MicrosoftTeams,
    entry: WorkspaceMenuEntry.MicrosoftTeams,
    page: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
    addButton: "Add Microsoft Teams Account",
    emptyTitle: "No Microsoft Teams account added",
    emptyMessage:
      "Connect yours under User Settings > Workspace > Microsoft Teams, then click 'Add Microsoft Teams Account'.",
    errorButton: "Open Microsoft Teams Settings",
  },
];

const CARD_CASES: Array<[string, AccountCard]> = CARDS.map(
  (card: AccountCard): [string, AccountCard] => {
    return [card.name, card];
  },
);

// Navigation.navigate spied on, as jest-mock's spyOn types it.
type NavigateSpy = SpyInstance<
  (
    ...args: Parameters<typeof Navigation.navigate>
  ) => ReturnType<typeof Navigation.navigate>
>;

let navigate: NavigateSpy;

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, unknown> }> =
    {};

  for (const language of ["en", ...LANGUAGES]) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  ConnectedWorkspaces.setFetcher(
    jest
      .fn<ConnectedWorkspacesFetcher>()
      .mockImplementation((): Promise<Array<WorkspaceType>> => {
        return new Promise<Array<WorkspaceType>>((): void => {});
      }),
  );
  ConnectedWorkspaces.setConnected(PROJECT_ID, [
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
  ]);
  setViewportWidth(DESKTOP_WIDTH);
  goTo(routeFor(PageMap.USER_SETTINGS_NOTIFICATION_METHODS));

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(User, "getUserId")
    .mockReturnValue(new ObjectID("22222222-2222-4222-8222-222222222222"));
  navigate = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });

  mockGetList.mockReset();
  mockGetList.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
  mockCreate.mockReset();
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function renderCard(card: AccountCard): Promise<void> {
  await act(async () => {
    render(<card.Card />);
  });
  await screen.findByTestId("table-empty-state-description");
}

function emptyDescription(): string {
  return (
    screen.getByTestId("table-empty-state-description").textContent || ""
  ).trim();
}

describe("an empty account card says where your account is connected", () => {
  test.each(CARD_CASES)(
    "%s: User Settings > Workspace > its entry, then the card's own button",
    async (_name: string, card: AccountCard) => {
      await renderCard(card);

      expect(
        screen.getByTestId("table-empty-state-title").textContent?.trim(),
      ).toBe(card.emptyTitle);
      expect(emptyDescription()).toBe(card.emptyMessage);
      expect(emptyDescription()).not.toContain("Integration");

      // The button it says to click is on the card.
      expect(
        screen.getAllByRole("button", { name: card.addButton }).length,
      ).toBeGreaterThan(0);
    },
  );

  test.each(CARD_CASES)(
    "%s: the path's steps are the Workspace section's title and its entry's",
    async (_name: string, card: AccountCard) => {
      await renderCard(card);

      expect(emptyDescription()).toContain(
        `User Settings > ${WORKSPACE_SECTION_TITLE} > ${WORKSPACE_MENU_ENTRY_TITLES[card.entry]},`,
      );
    },
  );
});

describe("the page the card names is in the User Settings menu", () => {
  test.each(CARD_CASES)(
    "%s: the folded Workspace section lists it, and its entry opens the account page",
    async (_name: string, card: AccountCard) => {
      await act(async () => {
        render(<UserSettingsSideMenu />);
      });

      // Folded until opened: the reason the path names the section.
      expect(isExpanded(WORKSPACE_SECTION_TITLE)).toBe(false);
      fireEvent.click(sectionToggle(WORKSPACE_SECTION_TITLE));
      expect(isExpanded(WORKSPACE_SECTION_TITLE)).toBe(true);

      expect(linksIn(WORKSPACE_SECTION_TITLE)).toContainEqual({
        title: WORKSPACE_MENU_ENTRY_TITLES[card.entry],
        href: routeFor(card.page),
      });
    },
  );

  test.each(CARD_CASES)(
    "%s: when adding fails, the dialog opens that same page",
    async (_name: string, card: AccountCard) => {
      mockCreate.mockImplementation(async (): Promise<unknown> => {
        throw new Error(
          `Your ${card.name} account is not connected to OneUptime in this project yet.`,
        );
      });
      await renderCard(card);

      await act(async () => {
        fireEvent.click(
          screen.getAllByRole("button", { name: card.addButton })[0]!,
        );
      });

      const dialog: HTMLElement = await screen.findByTestId("modal");

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole("button", { name: card.errorButton }),
        );
      });

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledTimes(1);
      });
      expect(String(navigate.mock.calls[0]?.[0])).toBe(routeFor(card.page));
    },
  );
});

describe("every language names the way there as its Dashboard draws it", () => {
  const LANGUAGE_CASES: Array<[string, string, AccountCard]> =
    LANGUAGES.flatMap(
      (language: string): Array<[string, string, AccountCard]> => {
        return CARDS.map((card: AccountCard): [string, string, AccountCard] => {
          return [language, card.name, card];
        });
      },
    );

  test.each(LANGUAGE_CASES)(
    "%s, %s: the bar's entry, the menu's section and entry, the card's button",
    async (language: string, _name: string, card: AccountCard) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      await act(async () => {
        render(<UserSettingsSideMenu />);
      });

      // The section and the entry, as the menu draws them in this language.
      const entry: HTMLAnchorElement | undefined = Array.from(
        document.querySelectorAll("a"),
      ).find((anchor: HTMLAnchorElement): boolean => {
        return anchor.getAttribute("href") === routeFor(card.page);
      });

      expect(entry).toBeDefined();

      const sectionHeading: string =
        entry?.closest("div.mb-2")?.querySelector("h6")?.textContent?.trim() ||
        "";
      const entryTitle: string = (
        entry?.querySelector('[data-testid="side-menu-item-title"]')
          ?.textContent ||
        entry?.textContent ||
        ""
      ).trim();

      expect(sectionHeading).toBe(drawn(language, WORKSPACE_SECTION_TITLE));
      expect(entryTitle).toBe(WORKSPACE_MENU_ENTRY_TITLES[card.entry]);

      cleanup();
      await renderCard(card);

      const button: string =
        screen
          .getAllByRole("button", { name: drawn(language, card.addButton) })[0]
          ?.textContent?.trim() || "";
      const message: string = emptyDescription();
      const steps: Array<string> = [
        barEntry(language),
        sectionHeading,
        entryTitle,
      ];

      // Translated: the reader is not shown the English sentence.
      expect(message).not.toBe(card.emptyMessage);
      expect(button).toBe(drawn(language, card.addButton));
      expect({
        language,
        path: steps.join(" > "),
        named: message.includes(steps.join(" > ")),
      }).toEqual({ language, path: steps.join(" > "), named: true });
      expect({ language, button, named: message.includes(button) }).toEqual({
        language,
        button,
        named: true,
      });
      // Never the page's old name.
      expect(message).not.toContain("Integration");
    },
  );
});
