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
import * as React from "react";
import NotificationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { stubDashboardCustomNotificationChannels } from "./CustomNotificationChannelsStub";

/*
 * THE MICROSOFT TEAMS COLUMN IS MICROSOFT TEAMS IN EVERY LANGUAGE.
 *
 * The Notification Settings matrix labelled its Microsoft Teams column with
 * the "Teams" key, which means teams of people: the Persian and Korean
 * Dashboards drew a column of people's teams (and so did Spanish "Equipos",
 * French "Equipes", Russian, Japanese, Chinese ...) beside the Microsoft
 * Teams icon. The column now carries the product's name, which no language
 * translates, and its switches say it to a screen reader too.
 *
 * The real page in each of the sixteen other languages, read from the
 * Dashboard's own locale files.
 */

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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// The column's place: Email, SMS, Call, Push, WhatsApp, Telegram, Slack, here.
const MICROSOFT_TEAMS_COLUMN: number = 7;

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
  ConnectedWorkspaces.setFetcher(async (): Promise<Array<WorkspaceType>> => {
    return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams];
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(User, "getUserId").mockReturnValue(USER_ID);
  // No custom channel on: the columns stop at Webhook.
  stubDashboardCustomNotificationChannels();
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: PROJECT_ID.toString() });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: Parameters<typeof ModelAPI.getList>[0]): Promise<any> => {
        const query: Query<UserNotificationSetting> = data.query;
        const eventTypes: Array<string> = (query.eventType as Includes)
          .values as Array<string>;

        // Microsoft Teams on for every event, so each switch says "on".
        const settings: Array<UserNotificationSetting> = eventTypes.map(
          (eventType: string, index: number): UserNotificationSetting => {
            const row: UserNotificationSetting = new UserNotificationSetting();
            row._id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
            row.projectId = PROJECT_ID;
            row.userId = USER_ID;
            row.eventType = eventType as NotificationSettingEventType;
            row.alertByMicrosoftTeams = true;
            return row;
          },
        );

        return { data: settings, count: settings.length };
      },
    );
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

async function renderIn(language: string): Promise<HTMLElement> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });

  await act(async () => {
    render(
      <NotificationSettings
        pageRoute={new Route("/user-settings/notification-settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  // The first matrix, once its rows are in.
  await screen.findAllByRole("switch");

  return screen.getAllByRole("table")[0]!;
}

function headers(table: HTMLElement): Array<string> {
  return within(table)
    .getAllByRole("columnheader")
    .slice(1)
    .map((header: HTMLElement): string => {
      return header.textContent?.trim() || "";
    });
}

describe("the Microsoft Teams column, in every language", () => {
  test("English: the product's name, never the bare Teams", async () => {
    const table: HTMLElement = await renderIn("en");

    expect(headers(table)[MICROSOFT_TEAMS_COLUMN]).toBe("Microsoft Teams");
    expect(headers(table)).not.toContain("Teams");
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: the column names Microsoft Teams, not the language's word for teams of people",
    async (language: string) => {
      const table: HTMLElement = await renderIn(language);
      const columns: Array<string> = headers(table);

      expect({ language, column: columns[MICROSOFT_TEAMS_COLUMN] }).toEqual({
        language,
        column: "Microsoft Teams",
      });
      expect({ language, columns: columns.length }).toEqual({
        language,
        columns: 9,
      });

      // The language's own "Teams" (Equipos, 팀, ...) is no column here.
      const peopleTeams: string = drawn(language, "Teams");

      expect({
        language,
        peopleTeams,
        shown: columns.includes(peopleTeams),
      }).toEqual({ language, peopleTeams, shown: false });

      // Its neighbours are the language's own words, so the page is translated.
      expect(columns[0]).toBe(drawn(language, "Email"));
      expect(columns[MICROSOFT_TEAMS_COLUMN - 1]).toBe("Slack");
    },
  );

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: each switch in the column names Microsoft Teams to a screen reader",
    async (language: string) => {
      const table: HTMLElement = await renderIn(language);
      const peopleTeams: string = drawn(language, "Teams");
      const bodyRows: Array<HTMLElement> = within(table)
        .getAllByRole("row")
        .slice(1);

      expect(bodyRows.length).toBeGreaterThan(0);

      for (const row of bodyRows) {
        const teamsSwitch: HTMLElement =
          within(row).getAllByRole("switch")[MICROSOFT_TEAMS_COLUMN]!;
        const name: string = teamsSwitch.getAttribute("aria-label") || "";

        expect(teamsSwitch).toHaveAttribute("aria-checked", "true");
        expect({
          language,
          name,
          product: name.includes("Microsoft Teams"),
        }).toEqual({ language, name, product: true });

        // Italian, Norwegian and Swedish "Team" is inside the product's name.
        const besideProduct: string = name.split("Microsoft Teams").join("");

        if (peopleTeams !== "Teams") {
          expect({
            language,
            name,
            people: besideProduct.includes(peopleTeams),
          }).toEqual({ language, name, people: false });
        }
      }
    },
  );
});
