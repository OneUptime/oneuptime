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
import fs from "fs";
import path from "path";
import * as React from "react";
import NotificationSettings, {
  ChannelKey,
  getShownChannelKeys,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
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
 * THE MATTERMOST COLUMN OF NOTIFICATION SETTINGS.
 *
 * A member's connected Mattermost account gets the updates they switch on
 * here, as a Slack or Microsoft Teams account does. The column is there only
 * when the project has connected Mattermost: nothing can reach anybody
 * through a workspace the project never connected. It is the product's name in
 * every language, and a switch in it writes the Mattermost setting and no
 * other.
 *
 * The real page, in each of the Dashboard's languages, read from its own
 * locale files.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const READ_LOCALES: Map<string, Record<string, unknown>> = new Map();

function readLocale(language: string): Record<string, unknown> {
  const alreadyRead: Record<string, unknown> | undefined =
    READ_LOCALES.get(language);

  if (alreadyRead) {
    return alreadyRead;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  READ_LOCALES.set(language, locale);

  return locale;
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

const ALL_WORKSPACES: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
  WorkspaceType.Mattermost,
];

// The column's place: Email, SMS, Call, Push, WhatsApp, Telegram, Slack, Teams, here.
const MATTERMOST_COLUMN: number = 8;

// A read of the page's, as ModelAPI.getList is handed it.
interface SettingsRead {
  modelType: unknown;
  select: Record<string, boolean>;
}

let rows: Array<UserNotificationSetting>;

function connect(workspaces: Array<WorkspaceType>): void {
  ConnectedWorkspaces.setFetcher(async (): Promise<Array<WorkspaceType>> => {
    return workspaces;
  });
}

function settingFor(
  eventType: NotificationSettingEventType,
): UserNotificationSetting {
  return rows.find((row: UserNotificationSetting): boolean => {
    return row.eventType === eventType;
  })!;
}

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
  connect(ALL_WORKSPACES);

  rows = Object.values(NotificationSettingEventType).map(
    (
      eventType: NotificationSettingEventType,
      index: number,
    ): UserNotificationSetting => {
      const row: UserNotificationSetting = new UserNotificationSetting();
      row._id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      row.projectId = PROJECT_ID;
      row.userId = USER_ID;
      row.eventType = eventType;
      row.alertByEmail = true;
      return row;
    },
  );

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
        const settings: Array<UserNotificationSetting> = rows.filter(
          (row: UserNotificationSetting): boolean => {
            return eventTypes.includes(row.eventType!);
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

async function renderPage(language: string = "en"): Promise<HTMLElement> {
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

async function findEventRow(label: string): Promise<HTMLElement> {
  return (await screen.findByText(label)).closest("tr")!;
}

function switchOf(row: HTMLElement): HTMLElement {
  return within(row).getByRole("switch", { name: /^Mattermost:/ });
}

describe("which projects have the column", () => {
  test("it comes after Slack and Microsoft Teams, before Webhook, when all three are connected", async () => {
    const table: HTMLElement = await renderPage();

    expect(headers(table)).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Microsoft Teams",
      "Mattermost",
      "Webhook",
    ]);
  });

  test("with only Mattermost connected, it is the one workspace column", async () => {
    connect([WorkspaceType.Mattermost]);

    const table: HTMLElement = await renderPage();

    expect(headers(table)).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Mattermost",
      "Webhook",
    ]);
  });

  test.each([
    [[]],
    [[WorkspaceType.Slack]],
    [[WorkspaceType.MicrosoftTeams]],
    [[WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]],
  ])(
    "a project with %j connected has no Mattermost column",
    async (connected: Array<WorkspaceType>) => {
      connect(connected);

      const table: HTMLElement = await renderPage();

      expect(headers(table)).not.toContain("Mattermost");
      expect(
        screen.queryByRole("switch", { name: /^Mattermost:/ }),
      ).not.toBeInTheDocument();
    },
  );

  test("connecting Mattermost adds its one column and changes no other", () => {
    const shown: Array<ChannelKey> = getShownChannelKeys([
      WorkspaceType.Mattermost,
    ]);

    expect(shown).toContain("alertByMattermost");
    expect(
      shown.filter((key: ChannelKey): boolean => {
        return key !== "alertByMattermost";
      }),
    ).toEqual(getShownChannelKeys([]));
  });

  test("the matrix reads the Mattermost switch of every row it draws", async () => {
    await renderPage();

    const getList: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
    const reads: Array<SettingsRead> = getList.mock.calls
      .map((call: Array<unknown>): SettingsRead => {
        return call[0] as SettingsRead;
      })
      .filter((read: SettingsRead): boolean => {
        return read.modelType === UserNotificationSetting;
      });

    expect(reads.length).toBeGreaterThan(0);

    for (const read of reads) {
      expect(read.select["alertByMattermost"]).toBe(true);
    }
  });
});

describe("a switch in the column", () => {
  test("shows what was saved, and says so to a screen reader, on and off", async () => {
    settingFor(
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    ).alertByMattermost = true;

    await renderPage();

    expect(
      within(await findEventRow("Incident created")).getByRole("switch", {
        name: "Mattermost: On. Click to disable.",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(await findEventRow("Incident note posted")).getByRole("switch", {
        name: "Mattermost: Off. Click to enable.",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("on an event with a setting, writes the Mattermost setting and no other", async () => {
    const updateById: jest.SpiedFunction<typeof ModelAPI.updateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderPage();
    fireEvent.click(switchOf(await findEventRow("Incident note posted")));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      alertByMattermost: true,
    });
  });

  test("switching it off writes false, and shows it at once", async () => {
    settingFor(
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    ).alertByMattermost = true;
    const updateById: jest.SpiedFunction<typeof ModelAPI.updateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderPage();
    const row: HTMLElement = await findEventRow("Incident created");
    fireEvent.click(switchOf(row));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      alertByMattermost: false,
    });
    await waitFor(() => {
      expect(switchOf(row)).toHaveAttribute("aria-checked", "false");
    });
  });

  test("on an event with no setting yet, makes one with Mattermost alone on", async () => {
    rows = rows.filter((row: UserNotificationSetting): boolean => {
      return (
        row.eventType !==
        NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION
      );
    });
    const create: jest.SpiedFunction<typeof ModelAPI.create> = jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue({} as never);

    await renderPage();
    fireEvent.click(switchOf(await findEventRow("Incident note posted")));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });

    const model: UserNotificationSetting = (
      create.mock.calls[0]![0] as unknown as { model: UserNotificationSetting }
    ).model;

    expect(model.eventType).toBe(
      NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
    );
    expect(model.alertByMattermost).toBe(true);
    expect(model.alertByEmail).toBe(false);
    expect(model.alertBySlack).toBe(false);
    expect(model.alertByMicrosoftTeams).toBe(false);
    expect(model.alertByWebhook).toBe(false);
  });

  test("a hidden Mattermost column keeps what was saved: a toggle elsewhere writes only its own column", async () => {
    connect([]);
    settingFor(
      NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
    ).alertByMattermost = true;
    const updateById: jest.SpiedFunction<typeof ModelAPI.updateById> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(within(row).getByRole("switch", { name: /^Email:/ }));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      alertByEmail: false,
    });
  });
});

describe("the column, in every language", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: the column and each of its switches name Mattermost, among the language's own words",
    async (language: string) => {
      const table: HTMLElement = await renderPage(language);
      const columns: Array<string> = headers(table);

      expect({ language, column: columns[MATTERMOST_COLUMN] }).toEqual({
        language,
        column: "Mattermost",
      });
      expect({ language, columns: columns.length }).toEqual({
        language,
        columns: 10,
      });
      expect(columns[0]).toBe(drawn(language, "Email"));
      expect(columns[MATTERMOST_COLUMN - 1]).toBe("Microsoft Teams");

      const bodyRows: Array<HTMLElement> = within(table)
        .getAllByRole("row")
        .slice(1);

      expect(bodyRows.length).toBeGreaterThan(0);

      for (const row of bodyRows) {
        const name: string =
          within(row)
            .getAllByRole("switch")
            [MATTERMOST_COLUMN]!.getAttribute("aria-label") || "";

        expect({
          language,
          name,
          product: name.includes("Mattermost"),
        }).toEqual({ language, name, product: true });
      }
    },
  );

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s: the method card's sentence is worded in it", (language: string) => {
    const english: string =
      "Receive OneUptime notifications as Mattermost direct messages from this project's Mattermost bot.";
    const worded: string = drawn(language, english);

    expect({ language, worded: worded !== english }).toEqual({
      language,
      worded: true,
    });
    expect(worded).toContain("Mattermost");
    expect(worded).toContain("OneUptime");
  });
});
