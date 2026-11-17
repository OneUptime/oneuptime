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
import React from "react";
import NotificationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import { stubDashboardCustomNotificationChannels } from "./CustomNotificationChannelsStub";
import {
  StubbedNotificationChannelReadiness,
  resetNotificationChannelReadiness,
  stubNotificationChannelReadiness,
} from "./NotificationChannelReadinessStub";

/*
 * USER SETTINGS > NOTIFICATION SETTINGS, EASIER TO UNDERSTAND AND USE (#8887).
 *
 * The page was a grid of faint circles under a box that said what its
 * switches do not do. It now:
 *
 *   - offers a channel's switches only once the channel can reach you,
 *     and names the others above the tabs, each a link to set it up;
 *   - opens each card of several events on "All events", a switch per
 *     channel for every event of the card;
 *   - opens each tab on what it adds up to;
 *   - says "Saving…" and "Saved" beside a card's title.
 *
 * The real page, its writes answered here: every event has a row with
 * email on unless a test says otherwise.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111ee",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-2222222222ee");

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const E: typeof NotificationSettingEventType = NotificationSettingEventType;

// The Incidents tab: the Incidents card (seven events), then Incident Episodes (five).
const INCIDENTS_CARD: Array<NotificationSettingEventType> = [
  E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
  E.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION,
];

let rows: Array<UserNotificationSetting>;
let getList: SpyInstance<typeof ModelAPI.getList>;
let updateById: SpyInstance<typeof ModelAPI.updateById>;
let create: SpyInstance<typeof ModelAPI.create>;
let readiness: StubbedNotificationChannelReadiness;
let nextId: number;

function rowFor(
  eventType: NotificationSettingEventType,
): UserNotificationSetting {
  return rows.find((row: UserNotificationSetting): boolean => {
    return row.eventType === eventType;
  })!;
}

function withoutRow(eventType: NotificationSettingEventType): void {
  rows = rows.filter((row: UserNotificationSetting): boolean => {
    return row.eventType !== eventType;
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, unknown> }> =
    {};

  for (const language of ["en", "de", "fa"]) {
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
  nextId = 0;
  ConnectedWorkspaces.reset();
  ConnectedWorkspaces.setFetcher(async (): Promise<Array<WorkspaceType>> => {
    return [WorkspaceType.Slack];
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
  stubDashboardSecurityCaseValues();
  stubDashboardCustomNotificationChannels();
  readiness = stubNotificationChannelReadiness();
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: PROJECT_ID.toString() });
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return err instanceof Error || err instanceof HTTPErrorResponse
        ? err.message
        : "Request failed";
    });
  getList = jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    query: Query<UserNotificationSetting>;
  }): Promise<unknown> => {
    const eventTypes: Array<string> = (data.query.eventType as Includes)
      .values as Array<string>;
    const settings: Array<UserNotificationSetting> = rows.filter(
      (row: UserNotificationSetting): boolean => {
        return eventTypes.includes(row.eventType!);
      },
    );

    return { data: settings, count: settings.length };
  }) as never) as unknown as SpyInstance<typeof ModelAPI.getList>;
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never) as unknown as SpyInstance<
    typeof ModelAPI.updateById
  >;
  // The server answers a create with the new row's id.
  create = jest
    .spyOn(ModelAPI, "create")
    .mockImplementation((async (): Promise<unknown> => {
      nextId++;
      return new HTTPResponse<JSONObject>(
        200,
        { _id: `44444444-4444-4444-8444-${String(nextId).padStart(12, "0")}` },
        {},
      );
    }) as never) as unknown as SpyInstance<typeof ModelAPI.create>;
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
  resetNotificationChannelReadiness();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function renderPage(): Promise<void> {
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

async function openTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });

  await waitFor(() => {
    expect(screen.queryAllByTestId("detail-skeleton")).toHaveLength(0);
  });
}

async function findEventRow(label: string): Promise<HTMLElement> {
  return (await screen.findByText(label)).closest("tr")!;
}

// A card, by its title.
function cardTitled(title: string): HTMLElement {
  return screen
    .getAllByTestId("card-header")
    .find((header: HTMLElement): boolean => {
      return within(header).queryByText(title, { exact: true }) !== null;
    })!.parentElement!.parentElement as HTMLElement;
}

function headersOf(table: HTMLElement): Array<string> {
  return within(table)
    .getAllByRole("columnheader")
    .slice(1)
    .map((header: HTMLElement): string => {
      return (header.querySelector("span")?.textContent || "").trim();
    });
}

function tableOfCard(title: string): HTMLElement {
  return within(cardTitled(title)).getByRole("table");
}

function allEventsRow(title: string): HTMLElement {
  return within(cardTitled(title)).getByTestId(
    "notification-matrix-all-events",
  );
}

function summary(): HTMLElement {
  return screen.getByTestId("notification-tab-summary");
}

describe("a channel that cannot reach you yet", () => {
  test("is no column; it is named above the tabs, each a link to the tab that sets it up", async () => {
    readiness = stubNotificationChannelReadiness({
      notSetUp: [
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertBySlack",
        "alertByWebhook",
      ],
    });

    await renderPage();

    expect(headersOf(tableOfCard("Incidents"))).toEqual(["Email"]);

    const notSetUp: HTMLElement = screen.getByTestId("channels-not-set-up");

    expect(notSetUp).toHaveTextContent("Channels not set up yet");

    const links: Array<HTMLElement> = within(notSetUp).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent?.trim() || "";
      }),
    ).toEqual([
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Webhook",
    ]);

    const methods: string = `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-methods`;
    const hrefOf: (name: string) => string | null = (
      name: string,
    ): string | null => {
      return within(notSetUp)
        .getByRole("link", { name: `Set up ${name}` })
        .getAttribute("href");
    };

    expect(hrefOf("SMS")).toBe(methods);
    expect(hrefOf("Call")).toBe(methods);
    expect(hrefOf("Push")).toBe(`${methods}?tab=push-notifications`);
    expect(hrefOf("Slack")).toBe(`${methods}?tab=workspace-apps`);
    expect(hrefOf("Webhook")).toBe(`${methods}?tab=webhooks`);
  });

  test("with every channel set up, nothing is named", async () => {
    await renderPage();

    expect(screen.queryByTestId("channels-not-set-up")).not.toBeInTheDocument();
    expect(headersOf(tableOfCard("Incidents"))).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Webhook",
    ]);
  });

  test("a channel the project turned off is no column and is not offered to set up", async () => {
    readiness = stubNotificationChannelReadiness({
      projectChannelsOff: [ProjectNotificationChannel.SMS],
      notSetUp: ["alertByCall"],
    });

    await renderPage();

    expect(headersOf(tableOfCard("Incidents"))).not.toContain("SMS");
    expect(headersOf(tableOfCard("Incidents"))).not.toContain("Call");

    const notSetUp: HTMLElement = screen.getByTestId("channels-not-set-up");

    expect(
      within(notSetUp)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return link.textContent?.trim() || "";
        }),
    ).toEqual(["Call"]);
  });

  test("push turned off on the server is not offered to set up either", async () => {
    readiness = stubNotificationChannelReadiness({
      isPushTurnedOff: true,
      notSetUp: ["alertByPush"],
    });

    await renderPage();

    expect(headersOf(tableOfCard("Incidents"))).not.toContain("Push");
    expect(screen.queryByTestId("channels-not-set-up")).not.toBeInTheDocument();
  });

  test("if what can reach you cannot be read, every channel is offered as before and none is named", async () => {
    readiness = stubNotificationChannelReadiness({ fail: true });

    await renderPage();

    expect(headersOf(tableOfCard("Incidents"))).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Webhook",
    ]);
    expect(screen.queryByTestId("channels-not-set-up")).not.toBeInTheDocument();
  });

  test("a channel whose methods could not be counted is offered, not hidden", async () => {
    readiness = stubNotificationChannelReadiness({ unknown: ["alertBySMS"] });

    await renderPage();

    expect(headersOf(tableOfCard("Incidents"))).toContain("SMS");
    expect(screen.queryByTestId("channels-not-set-up")).not.toBeInTheDocument();
  });

  test("the cards keep their loaders until it is known, so no column comes and goes", async () => {
    readiness = stubNotificationChannelReadiness({
      hold: true,
      notSetUp: ["alertBySMS"],
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

    await waitFor(() => {
      expect(readiness.reads).toBeGreaterThan(0);
      expect(getList).toHaveBeenCalled();
    });

    expect(screen.getAllByTestId("detail-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByTestId("channels-not-set-up")).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      readiness.release();
    });

    await screen.findAllByRole("switch");
    expect(headersOf(tableOfCard("Incidents"))).not.toContain("SMS");
  });

  test("it is asked once for the whole page, not once a card", async () => {
    await renderPage();

    expect(screen.getAllByRole("table").length).toBeGreaterThan(1);
    expect(readiness.reads).toBe(1);
  });
});

/*
 * A new member starts with push on, beside email, for their shift
 * reminders - with no device registered, those switches send nothing.
 */
describe("a switch on a channel that cannot reach you", () => {
  beforeEach(() => {
    readiness = stubNotificationChannelReadiness({ notSetUp: ["alertByPush"] });
    rowFor(E.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS).alertByPush = true;
  });

  test("keeps its column on its card, which says why under the channel's name", async () => {
    await renderPage();
    await openTab("On-Call");

    const table: HTMLElement = tableOfCard("On-Call");

    expect(headersOf(table)).toContain("Push");

    const pushHeader: HTMLElement = within(table)
      .getAllByRole("columnheader")
      .find((header: HTMLElement): boolean => {
        return header.getAttribute("data-reach") === "NotSetUp";
      })!;

    expect(
      within(pushHeader).getByRole("link", { name: "Set up Push" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-methods?tab=push-notifications`,
    );
    expect(pushHeader).toHaveTextContent("Set up");

    // A card with no push switch on offers no Push column at all.
    expect(headersOf(tableOfCard("Incoming Call Policies"))).not.toContain(
      "Push",
    );
  });

  test("the switch that is on can be turned off", async () => {
    await renderPage();
    await openTab("On-Call");

    const reminder: HTMLElement = await findEventRow(
      "Before my on-call shift starts",
    );
    const pushSwitch: HTMLElement = within(reminder).getByRole("switch", {
      name: "Push for Before my on-call shift starts",
    });

    expect(pushSwitch).toHaveAttribute("aria-checked", "true");
    expect(pushSwitch).not.toHaveAttribute("aria-disabled");

    fireEvent.click(pushSwitch);

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect((updateById.mock.calls[0]![0] as { data: JSONObject }).data).toEqual(
      { alertByPush: false },
    );
  });

  test("and stays, so turning off its last switch does not take the column away under the pointer", async () => {
    await renderPage();
    await openTab("On-Call");

    fireEvent.click(
      within(await findEventRow("Before my on-call shift starts")).getByRole(
        "switch",
        { name: "Push for Before my on-call shift starts" },
      ),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(headersOf(tableOfCard("On-Call"))).toContain("Push");
  });

  test("its other switches are locked off: they would send nothing", async () => {
    await renderPage();
    await openTab("On-Call");

    const goOnCall: HTMLElement = await findEventRow("You go on-call");
    const locked: HTMLElement = within(goOnCall).getByRole("switch", {
      name: "Push for You go on-call",
    });

    expect(locked).toHaveAttribute("aria-checked", "false");
    expect(locked).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(locked);

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(updateById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(locked).toHaveAttribute("aria-checked", "false");
  });

  test("All events offers no switch for it", async () => {
    await renderPage();
    await openTab("On-Call");

    expect(
      within(allEventsRow("On-Call")).queryByRole("switch", {
        name: /^Push for every event/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(allEventsRow("On-Call")).getByRole("switch", {
        name: "Email for every event in On-Call",
      }),
    ).toBeInTheDocument();
  });

  test("a channel the project turned off says so instead of offering to set it up", async () => {
    readiness = stubNotificationChannelReadiness({
      projectChannelsOff: [ProjectNotificationChannel.SMS],
    });
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySMS = true;

    await renderPage();

    const smsHeader: HTMLElement = within(tableOfCard("Incidents"))
      .getAllByRole("columnheader")
      .find((header: HTMLElement): boolean => {
        return header.getAttribute("data-reach") === "TurnedOff";
      })!;

    expect(smsHeader).toHaveTextContent("SMS");
    expect(smsHeader).toHaveTextContent("Turned off");
    expect(within(smsHeader).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("All events", () => {
  test("opens every card of several events; a card of one event has none", async () => {
    await renderPage();

    expect(allEventsRow("Incidents")).toBeInTheDocument();
    expect(allEventsRow("Incident Episodes")).toBeInTheDocument();

    await openTab("Monitoring");

    expect(
      within(cardTitled("Exceptions")).queryByTestId(
        "notification-matrix-all-events",
      ),
    ).not.toBeInTheDocument();
    expect(allEventsRow("Monitors")).toBeInTheDocument();
  });

  test("is on for a channel every event of the card has on, and off for one some do not", async () => {
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySMS = true;

    await renderPage();

    const row: HTMLElement = allEventsRow("Incidents");

    expect(
      within(row).getByRole("switch", {
        name: "Email for every event in Incidents",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(row).getByRole("switch", {
        name: "SMS for every event in Incidents",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("switched on, it turns the channel on for every event of the card not on yet, in one click", async () => {
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySlack = true;
    withoutRow(E.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION);

    await renderPage();

    fireEvent.click(
      within(allEventsRow("Incidents")).getByRole("switch", {
        name: "Slack for every event in Incidents",
      }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(5);
      expect(create).toHaveBeenCalledTimes(1);
    });

    // Every event with a row but the one already on, one column each.
    const updated: Array<string> = updateById.mock.calls.map(
      (call: Array<unknown>): string => {
        const data: { id: ObjectID; data: JSONObject } = call[0] as never;

        expect(data.data).toEqual({ alertBySlack: true });

        return data.id.toString();
      },
    );

    expect(updated.sort()).toEqual(
      INCIDENTS_CARD.filter(
        (eventType: NotificationSettingEventType): boolean => {
          return (
            eventType !== E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION &&
            eventType !== E.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION
          );
        },
      )
        .map((eventType: NotificationSettingEventType): string => {
          return rowFor(eventType)._id!.toString();
        })
        .sort(),
    );

    // The event with no row gets one: Slack alone on, as a single switch makes it.
    const model: UserNotificationSetting = (
      create.mock.calls[0]![0] as { model: UserNotificationSetting }
    ).model;

    expect(model.eventType).toBe(E.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION);
    expect(model.alertBySlack).toBe(true);
    expect(model.alertByEmail).toBe(false);

    // Every switch of the column says so, and so does All events.
    await waitFor(() => {
      expect(
        within(allEventsRow("Incidents")).getByRole("switch", {
          name: "Slack for every event in Incidents",
        }),
      ).toHaveAttribute("aria-checked", "true");
    });
    expect(
      within(await findEventRow("Assigned to an incident")).getByRole(
        "switch",
        { name: "Slack for Assigned to an incident" },
      ),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("switched off, it turns the channel off for every event of the card", async () => {
    await renderPage();

    fireEvent.click(
      within(allEventsRow("Incidents")).getByRole("switch", {
        name: "Email for every event in Incidents",
      }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(INCIDENTS_CARD.length);
    });

    for (const call of updateById.mock.calls) {
      expect((call[0] as { data: JSONObject }).data).toEqual({
        alertByEmail: false,
      });
    }

    // The other card of the tab is left as it was.
    expect(
      within(allEventsRow("Incident Episodes")).getByRole("switch", {
        name: "Email for every event in Incident Episodes",
      }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a write the server refuses puts back that one switch, says why, and keeps the rest", async () => {
    const refused: string = rowFor(
      E.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
    )._id!.toString();

    updateById.mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<unknown> => {
      if (data.id.toString() === refused) {
        throw new Error("Reminder preference could not be saved");
      }

      return {};
    }) as never);

    await renderPage();

    fireEvent.click(
      within(allEventsRow("Incidents")).getByRole("switch", {
        name: "SMS for every event in Incidents",
      }),
    );

    expect(
      await within(cardTitled("Incidents")).findByText(
        "Reminder preference could not be saved",
      ),
    ).toBeVisible();

    await waitFor(() => {
      expect(
        within(screen.getByText("Incident reminder").closest("tr")!).getByRole(
          "switch",
          { name: "SMS for Incident reminder" },
        ),
      ).toHaveAttribute("aria-checked", "false");
    });
    expect(
      within(screen.getByText("Incident created").closest("tr")!).getByRole(
        "switch",
        { name: "SMS for Incident created" },
      ),
    ).toHaveAttribute("aria-checked", "true");
    // Not every event has SMS now, so All events says so.
    expect(
      within(allEventsRow("Incidents")).getByRole("switch", {
        name: "SMS for every event in Incidents",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });
});

describe("what a tab adds up to", () => {
  test("every event on by email: all of them, by email", async () => {
    await renderPage();

    expect(summary()).toHaveTextContent(
      "You hear about 12 of 12 events on this tab, by Email.",
    );
  });

  test("counts the events that reach you and names their channels, in the columns' order", async () => {
    for (const eventType of [
      E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
      E.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
      E.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION,
    ]) {
      rowFor(eventType).alertByEmail = false;
    }
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySlack = true;
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySMS = true;

    await renderPage();

    expect(summary()).toHaveTextContent(
      "You hear about 9 of 12 events on this tab, by Email, SMS and Slack.",
    );
    expect(summary()).toHaveAttribute("data-reaching", "9");
    expect(summary()).toHaveAttribute("data-total", "12");
  });

  test("none on says so", async () => {
    for (const row of rows) {
      row.alertByEmail = false;
    }

    await renderPage();

    expect(summary()).toHaveTextContent(
      "You hear about none of the events on this tab.",
    );
  });

  test("a switch on a channel that cannot reach you does not count", async () => {
    readiness = stubNotificationChannelReadiness({ notSetUp: ["alertBySMS"] });

    for (const row of rows) {
      row.alertByEmail = false;
    }
    rowFor(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION).alertBySMS = true;

    await renderPage();

    expect(summary()).toHaveTextContent(
      "You hear about none of the events on this tab.",
    );
  });

  test("follows each switch as it is flipped", async () => {
    await renderPage();

    fireEvent.click(
      within(await findEventRow("Incident created")).getByRole("switch", {
        name: "Slack for Incident created",
      }),
    );

    await waitFor(() => {
      expect(summary()).toHaveTextContent(
        "You hear about 12 of 12 events on this tab, by Email and Slack.",
      );
    });

    fireEvent.click(
      within(allEventsRow("Incidents")).getByRole("switch", {
        name: "Email for every event in Incidents",
      }),
    );

    // Email off for the seven incident events: Incident created still has Slack.
    await waitFor(() => {
      expect(summary()).toHaveTextContent(
        "You hear about 6 of 12 events on this tab, by Email and Slack.",
      );
    });
  });

  test("each tab adds up its own cards", async () => {
    await renderPage();
    await openTab("On-Call");

    // On-Call (seven events) and Incoming Call Policies (one).
    expect(summary()).toHaveTextContent(
      "You hear about 8 of 8 events on this tab, by Email.",
    );
  });

  test("in German, as a German sentence", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    await renderPage();

    expect(summary()).toHaveTextContent(
      "Sie werden über 12 von 12 Ereignissen auf diesem Tab benachrichtigt, per E-Mail.",
    );
  });

  test("in Persian, its counts in Persian digits", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fa");
    });

    await renderPage();

    expect(summary().textContent).toContain("۱۲");
    expect(summary().textContent).not.toMatch(/[0-9]/);
  });
});

describe("Saving… and Saved", () => {
  function statusOf(title: string): HTMLElement {
    return within(cardTitled(title)).getByTestId(
      "notification-matrix-save-status",
    );
  }

  test("a card says Saving… while its change is on its way, then Saved, beside its title", async () => {
    let finish: () => void = (): void => {
      return undefined;
    };
    updateById.mockImplementation((): Promise<never> => {
      return new Promise((resolve: (value: never) => void): void => {
        finish = (): void => {
          resolve({} as never);
        };
      });
    });

    await renderPage();

    expect(statusOf("Incidents")).toHaveTextContent("");

    fireEvent.click(
      within(await findEventRow("Incident created")).getByRole("switch", {
        name: "SMS for Incident created",
      }),
    );

    await waitFor(() => {
      expect(statusOf("Incidents")).toHaveTextContent("Saving…");
    });
    // The switch shows what was asked for at once.
    expect(
      within(screen.getByText("Incident created").closest("tr")!).getByRole(
        "switch",
        { name: "SMS for Incident created" },
      ),
    ).toHaveAttribute("aria-checked", "true");

    await act(async (): Promise<void> => {
      finish();
    });

    await waitFor(() => {
      expect(statusOf("Incidents")).toHaveTextContent("Saved");
    });
    // Only the card that changed says so.
    expect(statusOf("Incident Episodes")).toHaveTextContent("");
    expect(statusOf("Incidents")).toHaveAttribute("role", "status");
  });

  test("a refused change never says Saved: the switch goes back with the reason", async () => {
    updateById.mockRejectedValue(new Error("Preference could not be saved"));

    await renderPage();

    fireEvent.click(
      within(await findEventRow("Incident created")).getByRole("switch", {
        name: "SMS for Incident created",
      }),
    );

    expect(
      await within(cardTitled("Incidents")).findByText(
        "Preference could not be saved",
      ),
    ).toBeVisible();
    expect(statusOf("Incidents")).not.toHaveTextContent("Saved");
    await waitFor(() => {
      expect(
        within(screen.getByText("Incident created").closest("tr")!).getByRole(
          "switch",
          { name: "SMS for Incident created" },
        ),
      ).toHaveAttribute("aria-checked", "false");
    });
  });
});

/*
 * On a phone each event is drawn on its own, its channels under it as
 * switches that say their names: the same rules, said beside the switch.
 */
describe("on a phone", () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  function eventItem(label: string): HTMLElement {
    return screen
      .getByText(label)
      .closest("[data-testid='notification-matrix-event']") as HTMLElement;
  }

  test("a switch on a channel that cannot reach you says why beside it, and only the one that is on can be pressed", async () => {
    readiness = stubNotificationChannelReadiness({ notSetUp: ["alertByPush"] });
    rowFor(E.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS).alertByPush = true;

    await renderPage();
    await openTab("On-Call");

    expect(screen.queryAllByRole("table")).toHaveLength(0);

    const reminderPush: HTMLElement = within(
      eventItem("Before my on-call shift starts"),
    ).getByRole("switch", { name: "Push" });

    expect(reminderPush).toHaveAttribute("aria-checked", "true");
    expect(reminderPush).not.toHaveAttribute("aria-disabled");
    expect(reminderPush).toHaveAccessibleDescription("Not set up");

    const lockedPush: HTMLElement = within(
      eventItem("You go on-call"),
    ).getByRole("switch", { name: "Push" });

    expect(lockedPush).toHaveAttribute("aria-disabled", "true");

    // All events offers every channel that can reach you, never Push.
    const allEvents: HTMLElement = within(
      screen.getAllByTestId("notification-matrix-all-events")[0]!,
    ).getByRole("group", { name: "All events" });

    expect(
      within(allEvents)
        .getAllByRole("switch")
        .map((each: HTMLElement): string => {
          return (
            document.getElementById(each.getAttribute("aria-labelledby") || "")
              ?.textContent || ""
          );
        }),
    ).toEqual([
      "Email",
      "SMS",
      "Call",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Webhook",
    ]);
  });

  test("All events switches a channel for every event of the card, as on a laptop", async () => {
    await renderPage();

    const allEvents: HTMLElement = within(
      screen.getAllByTestId("notification-matrix-all-events")[0]!,
    ).getByRole("group", { name: "All events" });

    fireEvent.click(within(allEvents).getByRole("switch", { name: "Slack" }));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(INCIDENTS_CARD.length);
    });

    for (const call of updateById.mock.calls) {
      expect((call[0] as { data: JSONObject }).data).toEqual({
        alertBySlack: true,
      });
    }
  });
});

describe("writes to one event wait for each other", () => {
  test("a row the first switch creates is updated by the second, never created twice", async () => {
    withoutRow(E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION);

    let finishCreate: () => void = (): void => {
      return undefined;
    };
    create.mockImplementation((): Promise<never> => {
      return new Promise((resolve: (value: never) => void): void => {
        finishCreate = (): void => {
          resolve(
            new HTTPResponse<JSONObject>(
              200,
              { _id: "55555555-5555-4555-8555-555555555555" },
              {},
            ) as never,
          );
        };
      });
    });

    await renderPage();

    const row: HTMLElement = await findEventRow("Incident note posted");

    fireEvent.click(
      within(row).getByRole("switch", {
        name: "Email for Incident note posted",
      }),
    );
    fireEvent.click(
      within(row).getByRole("switch", {
        name: "Slack for Incident note posted",
      }),
    );

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    // The second waits for the first.
    expect(updateById).not.toHaveBeenCalled();

    await act(async (): Promise<void> => {
      finishCreate();
    });

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(create).toHaveBeenCalledTimes(1);

    const update: { id: ObjectID; data: JSONObject } = updateById.mock
      .calls[0]![0] as never;

    expect(update.id.toString()).toBe("55555555-5555-4555-8555-555555555555");
    expect(update.data).toEqual({ alertBySlack: true });

    const model: UserNotificationSetting = (
      create.mock.calls[0]![0] as { model: UserNotificationSetting }
    ).model;

    expect(model.alertByEmail).toBe(true);
    expect(model.alertBySlack).toBe(false);
  });

  test("a create the server answers without an id reads the event's row back for it", async () => {
    withoutRow(E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION);
    create.mockImplementation((async (data: {
      model: UserNotificationSetting;
    }): Promise<unknown> => {
      const saved: UserNotificationSetting = data.model;
      saved._id = "66666666-6666-4666-8666-666666666666";
      rows.push(saved);
      return {};
    }) as never);

    await renderPage();
    getList.mockClear();

    fireEvent.click(
      within(await findEventRow("Incident note posted")).getByRole("switch", {
        name: "Email for Incident note posted",
      }),
    );

    await waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(1);
    });

    const read: { query: Query<UserNotificationSetting> } = getList.mock
      .calls[0]![0] as never;

    expect((read.query.eventType as Includes).values).toEqual([
      E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
    ]);

    fireEvent.click(
      within(await findEventRow("Incident note posted")).getByRole("switch", {
        name: "SMS for Incident note posted",
      }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe("66666666-6666-4666-8666-666666666666");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("the page reads every event's row in one go", async () => {
    await renderPage();

    expect(getList).toHaveBeenCalledTimes(1);
    expect(
      (
        (getList.mock.calls[0]![0] as { query: Query<UserNotificationSetting> })
          .query.eventType as Includes
      ).values,
    ).toHaveLength(Object.values(NotificationSettingEventType).length);
  });

  test("rows that cannot be read leave the cards saying why, with no switches drawn as if all were off", async () => {
    getList.mockRejectedValue(new Error("Settings could not be read"));

    await act(async () => {
      render(
        <NotificationSettings
          pageRoute={new Route("/user-settings/notification-settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );
    });

    expect(
      (await screen.findAllByText("Settings could not be read")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(
      screen.queryByTestId("notification-tab-summary"),
    ).not.toBeInTheDocument();
  });
});
