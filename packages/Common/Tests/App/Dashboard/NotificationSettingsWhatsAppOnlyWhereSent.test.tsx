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
import NotificationSettings, {
  NOTIFICATION_SETTINGS_CARDS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import {
  NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID,
  NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
  NotificationMatrixEvent,
  NotificationMatrixSection,
  getChannelsNotAvailableOnCard,
  getEventsChannelSends,
  getShownMatrixChannels,
  isOnForEveryEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationMatrix";
import {
  NotificationSettingsWords,
  OfferedChannel,
  TabSummaryFacts,
  getTabSummaryFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationSettingsWords";
import {
  ChannelReach,
  NotificationChannelKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationChannelReadiness";
import { RowsByEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/useNotificationSettingRows";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { Blue500, Green500 } from "../../../Types/BrandColors";
import Includes from "../../../Types/BaseDatabase/Includes";
import IconProp from "../../../Types/Icon/IconProp";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { hasWhatsAppTemplate } from "../../../Types/WhatsApp/WhatsAppEventTemplates";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import { stubDashboardCustomNotificationChannels } from "./CustomNotificationChannelsStub";
import {
  resetNotificationChannelReadiness,
  stubNotificationChannelReadiness,
} from "./NotificationChannelReadinessStub";

/*
 * USER SETTINGS > NOTIFICATION SETTINGS OFFERS WHATSAPP ONLY WHERE IT CAN
 * SEND (#9715).
 *
 * WhatsApp delivers only messages made from a template Meta has approved,
 * and 24 events had none: an SLO's status, a missed call, an assigned
 * exception, the security cases and hunts, public note approvals, a
 * reassigned shift, and being made an owner of a service, a dashboard, a
 * workflow, a runbook, an on-call policy, a table and the rest. The page
 * offered a WhatsApp switch for each all the same, and turning it on sent
 * nothing. Now, from the same map the server sends by
 * (Types/WhatsApp/WhatsAppEventTemplates):
 *
 *   - an event WhatsApp can send has its switch, as before;
 *   - a card none of whose events it can send has no WhatsApp column, and
 *     says so under its matrix;
 *   - on a card where it is a column, an event it cannot send has a dash
 *     where the switch was, and a line under it saying why;
 *   - "All events" switches WhatsApp for the events it can send, and is on
 *     when they all are;
 *   - a WhatsApp switch left on for such an event sends nothing, so it is
 *     neither drawn nor counted in the tab's summary.
 *
 * The real page, its writes answered here: every event has a row with
 * email on, and every channel can reach the person, unless a test says
 * otherwise.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111f1",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-2222222222f1");

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const E: typeof NotificationSettingEventType = NotificationSettingEventType;

const TABS: ReadonlyArray<string> = [
  "Incidents",
  "Alerts",
  "Monitoring",
  "Status Pages",
  "Scheduled Maintenance",
  "On-Call",
  "Security",
];

const NOT_AVAILABLE_FOR_EVENT: string =
  "WhatsApp is not available for this event.";
const NOT_AVAILABLE_FOR_EVENTS: string =
  "WhatsApp is not available for these events.";

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

let rows: Array<UserNotificationSetting>;
let updateById: SpyInstance<typeof ModelAPI.updateById>;

function rowFor(
  eventType: NotificationSettingEventType,
): UserNotificationSetting {
  return rows.find((row: UserNotificationSetting): boolean => {
    return row.eventType === eventType;
  })!;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, unknown> }> =
    {};

  for (const language of ["en", "de"]) {
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
  stubNotificationChannelReadiness();
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
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
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
  }) as never);
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never) as unknown as SpyInstance<
    typeof ModelAPI.updateById
  >;
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

// The cards of the open tab, by their titles.
function cardTitlesShown(): Array<string> {
  return screen
    .getAllByTestId("card-header")
    .map((header: HTMLElement): string => {
      return (
        NOTIFICATION_SETTINGS_CARDS.find(
          (section: NotificationMatrixSection): boolean => {
            return (
              within(header).queryByText(section.title, { exact: true }) !==
              null
            );
          },
        )?.title || ""
      );
    })
    .filter((title: string): boolean => {
      return Boolean(title);
    });
}

function cardTitled(title: string): HTMLElement {
  return screen
    .getAllByTestId("card-header")
    .find((header: HTMLElement): boolean => {
      return within(header).queryByText(title, { exact: true }) !== null;
    })!.parentElement!.parentElement as HTMLElement;
}

function sectionTitled(title: string): NotificationMatrixSection {
  return NOTIFICATION_SETTINGS_CARDS.find(
    (section: NotificationMatrixSection): boolean => {
      return section.title === title;
    },
  )!;
}

function eventRowIn(card: HTMLElement, label: string): HTMLElement {
  return within(card).getByText(label, { exact: true }).closest("tr")!;
}

function columnHeadersOf(card: HTMLElement): Array<string> {
  return within(within(card).getByRole("table"))
    .getAllByRole("columnheader")
    .slice(1)
    .map((header: HTMLElement): string => {
      return (header.querySelector("span")?.textContent || "").trim();
    });
}

describe("every event of every tab", () => {
  test("has a WhatsApp switch exactly when WhatsApp can send it, and says why where it cannot", async () => {
    await renderPage();

    const checked: Array<string> = [];

    for (const tab of TABS) {
      await openTab(tab);

      for (const title of cardTitlesShown()) {
        const section: NotificationMatrixSection = sectionTitled(title);
        const card: HTMLElement = cardTitled(title);
        const sentOnWhatsApp: Array<NotificationMatrixEvent> =
          section.events.filter((event: NotificationMatrixEvent): boolean => {
            return hasWhatsAppTemplate(event.type);
          });

        checked.push(title);

        if (sentOnWhatsApp.length === 0) {
          // No column, no switch, and the card says why, once.
          expect({ title, headers: columnHeadersOf(card) }).toEqual({
            title,
            headers: expect.not.arrayContaining(["WhatsApp"]),
          });
          expect(
            within(card).queryAllByRole("switch", { name: /^WhatsApp for / }),
          ).toHaveLength(0);
          expect(
            within(card).getByTestId(
              NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID,
            ),
          ).toHaveTextContent(
            section.events.length > 1
              ? NOT_AVAILABLE_FOR_EVENTS
              : NOT_AVAILABLE_FOR_EVENT,
          );
          expect(
            within(card).queryAllByTestId(
              NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
            ),
          ).toHaveLength(0);
          continue;
        }

        expect({ title, headers: columnHeadersOf(card) }).toEqual({
          title,
          headers: expect.arrayContaining(["WhatsApp"]),
        });
        expect(
          within(card).queryByTestId(
            NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID,
          ),
        ).not.toBeInTheDocument();

        for (const event of section.events) {
          const row: HTMLElement = eventRowIn(card, event.label);
          const whatsApp: HTMLElement | null = within(row).queryByRole(
            "switch",
            { name: `WhatsApp for ${event.label}` },
          );

          if (hasWhatsAppTemplate(event.type)) {
            expect({ event: event.label, offered: Boolean(whatsApp) }).toEqual({
              event: event.label,
              offered: true,
            });
            expect(
              within(row).queryByTestId(
                NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
              ),
            ).not.toBeInTheDocument();
          } else {
            expect({ event: event.label, offered: Boolean(whatsApp) }).toEqual({
              event: event.label,
              offered: false,
            });
            expect(
              within(row).getByTestId(
                NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
              ),
            ).toHaveTextContent(NOT_AVAILABLE_FOR_EVENT);
            // Every other channel is still offered for it.
            expect(
              within(row).getByRole("switch", {
                name: `Email for ${event.label}`,
              }),
            ).toBeInTheDocument();
          }
        }
      }
    }

    // Every card of the page was looked at.
    expect([...checked].sort()).toEqual(
      NOTIFICATION_SETTINGS_CARDS.map(
        (section: NotificationMatrixSection): string => {
          return section.title;
        },
      ).sort(),
    );
  });
});

describe("a card none of whose events WhatsApp can send", () => {
  test("brings no column for a WhatsApp switch left on there, and counts it for nothing", async () => {
    for (const row of rows) {
      row.alertByEmail = false;
    }

    rowFor(E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION).alertByWhatsApp = true;
    rowFor(E.SEND_SLO_OWNER_ADDED_NOTIFICATION).alertByWhatsApp = true;

    await renderPage();
    await openTab("Monitoring");

    const slos: HTMLElement = cardTitled("SLOs");

    expect(columnHeadersOf(slos)).not.toContain("WhatsApp");
    expect(
      within(slos).queryAllByRole("switch", { name: /^WhatsApp for / }),
    ).toHaveLength(0);
    expect(screen.getByTestId("notification-tab-summary")).toHaveTextContent(
      "You hear about none of the events on this tab.",
    );
  });

  test("says nothing of WhatsApp when WhatsApp cannot reach the person anyway", async () => {
    stubNotificationChannelReadiness({ notSetUp: ["alertByWhatsApp"] });

    await renderPage();
    await openTab("Security");

    expect(
      screen.queryAllByTestId(
        NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID,
      ),
    ).toHaveLength(0);
  });

  test("says so in the reader's language", async () => {
    const german: Record<string, string> = readLocale("de");

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    await renderPage();
    await openTab(german["Security"] || "Security");

    const expected: string = german[
      NotificationSettingsWords.notAvailableForEvents
    ]!.replace("{{channel}}", "WhatsApp");

    expect(expected).not.toBe(NOT_AVAILABLE_FOR_EVENTS);
    expect(
      screen
        .getAllByTestId(NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID)
        .map((note: HTMLElement): string => {
          return note.textContent || "";
        }),
    ).toContain(expected);
  });
});

describe("the On-Call card, where WhatsApp sends all but a reassigned shift", () => {
  test("a reassigned shift has a dash and a line where its WhatsApp switch was; a shift reminder keeps its switch", async () => {
    await renderPage();
    await openTab("On-Call");

    const onCall: HTMLElement = cardTitled("On-Call");
    const reassigned: HTMLElement = eventRowIn(
      onCall,
      "My upcoming on-call shift is reassigned",
    );

    expect(
      within(reassigned).queryByRole("switch", { name: /^WhatsApp for / }),
    ).not.toBeInTheDocument();
    expect(within(reassigned).getByText("—")).toHaveAttribute(
      "title",
      NOT_AVAILABLE_FOR_EVENT,
    );
    expect(
      within(reassigned).getByTestId(
        NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
      ),
    ).toHaveTextContent(NOT_AVAILABLE_FOR_EVENT);

    // The reminder goes out on the approved "you are next on-call" template.
    expect(
      within(eventRowIn(onCall, "Before my on-call shift starts")).getByRole(
        "switch",
        {
          name: "WhatsApp for Before my on-call shift starts",
        },
      ),
    ).toBeInTheDocument();
  });

  test("All events switches WhatsApp on for every event WhatsApp can send, and never the reassigned shift", async () => {
    await renderPage();
    await openTab("On-Call");

    const onCall: HTMLElement = cardTitled("On-Call");
    const sendable: Array<NotificationSettingEventType> = sectionTitled(
      "On-Call",
    )
      .events.map((event: NotificationMatrixEvent) => {
        return event.type;
      })
      .filter(hasWhatsAppTemplate);

    expect(sendable).toHaveLength(6);

    fireEvent.click(
      within(
        within(onCall).getByTestId("notification-matrix-all-events"),
      ).getByRole("switch", { name: "WhatsApp for every event in On-Call" }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(sendable.length);
    });

    const written: Array<string> = updateById.mock.calls.map(
      (call: Array<unknown>): string => {
        expect((call[0] as { data: JSONObject }).data).toEqual({
          alertByWhatsApp: true,
        });
        return (call[0] as { id: ObjectID }).id.toString();
      },
    );

    expect(written).not.toContain(
      rowFor(E.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED)._id!.toString(),
    );
    expect([...written].sort()).toEqual(
      sendable
        .map((eventType: NotificationSettingEventType): string => {
          return rowFor(eventType)._id!.toString();
        })
        .sort(),
    );
  });

  test("All events is on once every event WhatsApp can send is on, the reassigned shift aside", async () => {
    for (const event of sectionTitled("On-Call").events) {
      rowFor(event.type).alertByWhatsApp = hasWhatsAppTemplate(event.type);
    }

    await renderPage();
    await openTab("On-Call");

    expect(
      within(
        within(cardTitled("On-Call")).getByTestId(
          "notification-matrix-all-events",
        ),
      ).getByRole("switch", { name: "WhatsApp for every event in On-Call" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

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
      .getByText(label, { exact: true })
      .closest("[data-testid='notification-matrix-event']") as HTMLElement;
  }

  test("an event WhatsApp cannot send names no WhatsApp switch, and says why under it", async () => {
    await renderPage();
    await openTab("On-Call");

    expect(screen.queryAllByRole("table")).toHaveLength(0);

    const reassigned: HTMLElement = eventItem(
      "My upcoming on-call shift is reassigned",
    );

    expect(
      within(reassigned).queryByRole("switch", { name: "WhatsApp" }),
    ).not.toBeInTheDocument();
    expect(
      within(reassigned).getByRole("switch", { name: "Email" }),
    ).toBeInTheDocument();
    expect(
      within(reassigned).getByTestId(
        NOTIFICATION_CHANNEL_NOT_AVAILABLE_TEST_ID,
      ),
    ).toHaveTextContent(NOT_AVAILABLE_FOR_EVENT);

    expect(
      within(eventItem("You go on-call")).getByRole("switch", {
        name: "WhatsApp",
      }),
    ).toBeInTheDocument();
  });

  test("a card none of whose events WhatsApp can send offers it nowhere, and says so once", async () => {
    await renderPage();
    await openTab("Security");

    const cases: HTMLElement = cardTitled("Security Cases");

    expect(
      within(cases).queryAllByRole("switch", { name: "WhatsApp" }),
    ).toHaveLength(0);
    expect(
      within(cases).getAllByTestId(
        NOTIFICATION_CHANNEL_NOT_AVAILABLE_ON_CARD_TEST_ID,
      ),
    ).toHaveLength(1);
  });
});

describe("the rules, without a page", () => {
  const EMAIL: OfferedChannel = {
    definition: {
      key: "alertByEmail",
      label: "Email",
      icon: IconProp.Email,
      color: Blue500,
    },
    reach: ChannelReach.Ready,
  };

  function whatsApp(reach: ChannelReach = ChannelReach.Ready): OfferedChannel {
    return {
      definition: {
        key: "alertByWhatsApp",
        label: "WhatsApp",
        icon: IconProp.WhatsApp,
        color: Green500,
      },
      reach: reach,
    };
  }

  const SLO_CARD: Array<NotificationSettingEventType> = [
    E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
    E.SEND_SLO_OWNER_ADDED_NOTIFICATION,
  ];
  const MIXED_CARD: Array<NotificationSettingEventType> = [
    E.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
    E.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
  ];

  function rowsOf(
    entries: Array<
      [
        NotificationSettingEventType,
        Partial<Record<NotificationChannelKey, boolean>>,
      ]
    >,
  ): RowsByEvent {
    const map: Map<NotificationSettingEventType, UserNotificationSetting> =
      new Map();

    for (const [eventType, channels] of entries) {
      const row: UserNotificationSetting = new UserNotificationSetting();
      row.eventType = eventType;

      for (const [key, value] of Object.entries(channels)) {
        (row as unknown as Record<string, boolean>)[key] = Boolean(value);
      }

      map.set(eventType, row);
    }

    return map;
  }

  function labels(channels: Array<OfferedChannel>): Array<string> {
    return channels.map((channel: OfferedChannel): string => {
      return channel.definition.label;
    });
  }

  test("the events a channel sends: every one, but WhatsApp's only those with a template", () => {
    expect(
      getEventsChannelSends({
        eventTypes: MIXED_CARD,
        channel: "alertByEmail",
      }),
    ).toEqual(MIXED_CARD);
    expect(
      getEventsChannelSends({
        eventTypes: MIXED_CARD,
        channel: "alertByWhatsApp",
      }),
    ).toEqual([E.SEND_WHEN_USER_IS_ON_CALL_ROSTER]);
    expect(
      getEventsChannelSends({
        eventTypes: SLO_CARD,
        channel: "alertByWhatsApp",
      }),
    ).toEqual([]);
  });

  test("WhatsApp is no column of a card it can send nothing of, even with a switch left on", () => {
    expect(
      labels(
        getShownMatrixChannels({
          channels: [EMAIL, whatsApp()],
          eventTypes: SLO_CARD,
          rowsByEvent: rowsOf([
            [E.SEND_SLO_OWNER_ADDED_NOTIFICATION, { alertByWhatsApp: true }],
          ]),
          alreadyShown: new Set<NotificationChannelKey>(["alertByWhatsApp"]),
        }),
      ),
    ).toEqual(["Email"]);
    expect(
      labels(
        getShownMatrixChannels({
          channels: [EMAIL, whatsApp()],
          eventTypes: MIXED_CARD,
          rowsByEvent: new Map(),
        }),
      ),
    ).toEqual(["Email", "WhatsApp"]);
  });

  test("a switch left on for an event WhatsApp cannot send does not bring a column it cannot reach", () => {
    expect(
      labels(
        getShownMatrixChannels({
          channels: [EMAIL, whatsApp(ChannelReach.NotSetUp)],
          eventTypes: MIXED_CARD,
          rowsByEvent: rowsOf([
            [
              E.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
              { alertByWhatsApp: true },
            ],
          ]),
        }),
      ),
    ).toEqual(["Email"]);
  });

  test("All events asks only the events the channel can send", () => {
    expect(
      isOnForEveryEvent({
        eventTypes: MIXED_CARD,
        rowsByEvent: rowsOf([
          [E.SEND_WHEN_USER_IS_ON_CALL_ROSTER, { alertByWhatsApp: true }],
        ]),
        channel: "alertByWhatsApp",
      }),
    ).toBe(true);
    expect(
      isOnForEveryEvent({
        eventTypes: SLO_CARD,
        rowsByEvent: rowsOf([
          [
            E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
            { alertByWhatsApp: true },
          ],
          [E.SEND_SLO_OWNER_ADDED_NOTIFICATION, { alertByWhatsApp: true }],
        ]),
        channel: "alertByWhatsApp",
      }),
    ).toBe(false);
  });

  test("a card names WhatsApp as not available only when it could reach the person and sends none of its events", () => {
    expect(
      labels(
        getChannelsNotAvailableOnCard({
          channels: [EMAIL, whatsApp()],
          eventTypes: SLO_CARD,
        }),
      ),
    ).toEqual(["WhatsApp"]);
    expect(
      labels(
        getChannelsNotAvailableOnCard({
          channels: [EMAIL, whatsApp(ChannelReach.Unknown)],
          eventTypes: SLO_CARD,
        }),
      ),
    ).toEqual(["WhatsApp"]);
    expect(
      getChannelsNotAvailableOnCard({
        channels: [EMAIL, whatsApp(ChannelReach.NotSetUp)],
        eventTypes: SLO_CARD,
      }),
    ).toEqual([]);
    expect(
      getChannelsNotAvailableOnCard({
        channels: [EMAIL, whatsApp()],
        eventTypes: MIXED_CARD,
      }),
    ).toEqual([]);
    expect(
      getChannelsNotAvailableOnCard({
        channels: [EMAIL, whatsApp()],
        eventTypes: [],
      }),
    ).toEqual([]);
  });

  test("a tab's summary counts no WhatsApp switch on an event WhatsApp cannot send", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: [...SLO_CARD, ...MIXED_CARD],
      rowsByEvent: rowsOf([
        [
          E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
          { alertByWhatsApp: true },
        ],
        [
          E.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
          { alertByWhatsApp: true },
        ],
        [E.SEND_WHEN_USER_IS_ON_CALL_ROSTER, { alertByWhatsApp: true }],
      ]),
      channels: [EMAIL, whatsApp()],
    });

    expect(facts.reaching).toBe(1);
    expect(facts.total).toBe(4);
    expect(
      facts.channels.map((definition: { label: string }): string => {
        return definition.label;
      }),
    ).toEqual(["WhatsApp"]);
  });

  test("the words are keys every locale has", () => {
    for (const language of ["en", "de"]) {
      const locale: Record<string, string> = readLocale(language);

      expect(locale[NotificationSettingsWords.notAvailableForEvent]).toContain(
        "{{channel}}",
      );
      expect(locale[NotificationSettingsWords.notAvailableForEvents]).toContain(
        "{{channel}}",
      );
    }
  });
});
