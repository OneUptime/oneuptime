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
import type { SpyInstance } from "jest-mock";
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
  doesNotificationMatrixTableFit,
  NOTIFICATION_MATRIX_CHANNEL_COLUMN_WIDTH_PX,
  NOTIFICATION_MATRIX_EVENT_COLUMN_MIN_WIDTH_PX,
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
 * NOTIFICATION SETTINGS ON A PHONE.
 *
 * The matrix gives each channel a column of its own and the event's name and
 * description what is left. On a 390px phone, beside eight to ten channels,
 * that left the event's column a word a line wide. Below the width the table
 * needs - 13rem for the event, 60px a channel - each event is drawn on its
 * own: its name and description across the card, and its channels under them
 * as switches that say their names (Email ✓). The switches save exactly what
 * the table's do, and the layout follows the matrix's own box, so a tablet
 * with the side menu open gets the list too.
 *
 * The real page, in English and in the Dashboard's other languages, read from
 * their locale files.
 */

type MethodOf<Method extends (...args: Array<never>) => unknown> = (
  ...args: Parameters<Method>
) => ReturnType<Method>;

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

function drawn(language: string, english: string): string {
  const value: unknown = readLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// Email, SMS, Call, Push, WhatsApp, Telegram, Slack, Microsoft Teams, Webhook.
const CHANNELS: Array<string> = [
  "Email",
  "SMS",
  "Call",
  "Push",
  "WhatsApp",
  "Telegram",
  "Slack",
  "Microsoft Teams",
  "Webhook",
];

const PHONE_WIDTH: number = 390;
const LAPTOP_WIDTH: number = 1280;

let rows: Array<UserNotificationSetting>;
let originalInnerWidth: number;

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

beforeAll(async () => {
  originalInnerWidth = window.innerWidth;

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
  setWindowWidth(originalInnerWidth);
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function renderPage(language: string = "en"): Promise<void> {
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

  await screen.findAllByRole("switch");
}

function chipsOf(event: HTMLElement): Array<HTMLElement> {
  return within(event).getAllByTestId("notification-channel-chip");
}

async function findEvent(label: string): Promise<HTMLElement> {
  return (await screen.findByText(label)).closest(
    "[data-testid='notification-matrix-event']",
  ) as HTMLElement;
}

describe("where the table fits", () => {
  test("the event's column takes 13rem and each channel 60px", () => {
    expect(NOTIFICATION_MATRIX_EVENT_COLUMN_MIN_WIDTH_PX).toBe(208);
    expect(NOTIFICATION_MATRIX_CHANNEL_COLUMN_WIDTH_PX).toBe(60);
  });

  test("a box exactly as wide as the table needs draws the table; a pixel less draws the list", () => {
    for (const channelCount of [1, 6, 9, 10, 12]) {
      const needed: number = 208 + channelCount * 60;

      expect(
        doesNotificationMatrixTableFit({
          width: needed,
          channelCount: channelCount,
        }),
      ).toBe(true);
      expect(
        doesNotificationMatrixTableFit({
          width: needed - 1,
          channelCount: channelCount,
        }),
      ).toBe(false);
    }
  });

  test("a phone never fits the matrix of a project's usual channels; a laptop always does", () => {
    for (const channelCount of [6, 8, 9, 10, 11]) {
      expect(
        doesNotificationMatrixTableFit({
          width: PHONE_WIDTH,
          channelCount: channelCount,
        }),
      ).toBe(false);
      expect(
        doesNotificationMatrixTableFit({
          width: LAPTOP_WIDTH,
          channelCount: channelCount,
        }),
      ).toBe(true);
    }
  });

  test("a tablet beside the side menu (a 700px box) draws the list for nine channels", () => {
    expect(
      doesNotificationMatrixTableFit({ width: 700, channelCount: 9 }),
    ).toBe(false);
    expect(
      doesNotificationMatrixTableFit({ width: 700, channelCount: 8 }),
    ).toBe(true);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    setWindowWidth(PHONE_WIDTH);
  });

  test("each event is drawn on its own, with no table", async () => {
    await renderPage();

    expect(screen.queryAllByRole("table")).toHaveLength(0);
    expect(
      screen.getAllByTestId("notification-matrix-list").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("notification-matrix-event").length,
    ).toBeGreaterThan(1);
  });

  test("an event names itself and says what it is, across the card", async () => {
    await renderPage();

    const event: HTMLElement = await findEvent("Incident note posted");
    const lines: Array<string> = Array.from(event.children)
      .slice(0, 2)
      .map((line: Element): string => {
        return line.textContent?.trim() || "";
      });

    expect(lines[0]).toBe("Incident note posted");
    expect(lines[1]?.length).toBeGreaterThan(0);
  });

  test("its channels are switches under it, a group named after the event, each saying its channel's name", async () => {
    await renderPage();

    const event: HTMLElement = await findEvent("Incident note posted");
    const group: HTMLElement = within(event).getByRole("group", {
      name: "Incident note posted",
    });
    const chips: Array<HTMLElement> = chipsOf(group);

    expect(
      chips.map((chip: HTMLElement): string => {
        return chip.textContent?.trim() || "";
      }),
    ).toEqual(CHANNELS);

    for (const chip of chips) {
      expect(chip).toHaveAttribute("role", "switch");
    }
  });

  test("a channel switched on says so with a check, and to a screen reader", async () => {
    await renderPage();

    const chips: Array<HTMLElement> = chipsOf(
      await findEvent("Incident note posted"),
    );
    const email: HTMLElement = chips[0]!;
    const sms: HTMLElement = chips[1]!;

    expect(email).toHaveAttribute("aria-checked", "true");
    expect(email).toHaveAccessibleName("Email: On. Click to disable.");
    expect(email.querySelector("svg")).not.toBeNull();
    expect(sms).toHaveAttribute("aria-checked", "false");
    expect(sms).toHaveAccessibleName("SMS: Off. Click to enable.");
    expect(sms.querySelector("svg")).toBeNull();
  });

  test("a channel's name is cut short rather than pushing the card wider", async () => {
    await renderPage();

    const chips: Array<HTMLElement> = chipsOf(
      await findEvent("Incident note posted"),
    );

    for (const chip of chips) {
      expect(chip.className).toContain("max-w-full");
      expect(chip.querySelector("span.truncate")).not.toBeNull();
    }

    expect(chips[0]!.parentElement!.className).toContain("flex-wrap");
  });

  test("a switch saves its channel and no other, as the table's does", async () => {
    const updateById: SpyInstance<MethodOf<typeof ModelAPI.updateById>> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderPage();

    const chips: Array<HTMLElement> = chipsOf(
      await findEvent("Incident note posted"),
    );

    fireEvent.click(chips[CHANNELS.indexOf("Slack")]!);

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      alertBySlack: true,
    });
  });

  test("switching one off writes false and shows it at once", async () => {
    const updateById: SpyInstance<MethodOf<typeof ModelAPI.updateById>> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderPage();

    const event: HTMLElement = await findEvent("Incident note posted");

    fireEvent.click(chipsOf(event)[0]!);

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      alertByEmail: false,
    });
    await waitFor(() => {
      expect(chipsOf(event)[0]).toHaveAttribute("aria-checked", "false");
    });
  });

  test.each(LANGUAGES)(
    "in %s, the switches say their channels as the table's headers do",
    async (language: string) => {
      await renderPage(language);

      const event: HTMLElement = screen.getAllByTestId(
        "notification-matrix-event",
      )[0]!;

      expect(
        chipsOf(event).map((chip: HTMLElement): string => {
          return chip.textContent?.trim() || "";
        }),
      ).toEqual(
        CHANNELS.map((channel: string): string => {
          return drawn(language, channel);
        }),
      );
    },
  );
});

describe("on a laptop", () => {
  beforeEach(() => {
    setWindowWidth(LAPTOP_WIDTH);
  });

  test("the matrix is a table, a column a channel, with no list", async () => {
    await renderPage();

    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId("notification-matrix-list")).toHaveLength(0);
    expect(screen.queryAllByTestId("notification-channel-chip")).toHaveLength(
      0,
    );
  });

  test("narrowing the window to a phone's draws the list; widening it again, the table", async () => {
    await renderPage();

    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);

    await act(async (): Promise<void> => {
      setWindowWidth(PHONE_WIDTH);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.queryAllByRole("table")).toHaveLength(0);
    });
    expect(
      screen.getAllByTestId("notification-matrix-list").length,
    ).toBeGreaterThan(0);

    await act(async (): Promise<void> => {
      setWindowWidth(LAPTOP_WIDTH);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    });
  });
});

describe("the matrix's own box decides, not the window", () => {
  test("a wide window whose matrix box is a tablet's beside the side menu draws the list", async () => {
    setWindowWidth(LAPTOP_WIDTH);

    const boxWidth: number = 700;
    const original: () => DOMRect = HTMLElement.prototype.getBoundingClientRect;

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.getAttribute("data-testid") === "notification-matrix") {
          return {
            width: boxWidth,
            height: 400,
            top: 0,
            left: 0,
            right: boxWidth,
            bottom: 400,
            x: 0,
            y: 0,
            toJSON: (): unknown => {
              return {};
            },
          } as DOMRect;
        }

        return original.call(this);
      });

    await renderPage();

    await waitFor(() => {
      expect(screen.queryAllByRole("table")).toHaveLength(0);
    });
    expect(
      screen.getAllByTestId("notification-matrix-list").length,
    ).toBeGreaterThan(0);
  });
});
