import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import NotificationSettings, {
  ChannelKey,
  getShownChannelKeys,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import {
  StubbedDashboardCustomNotificationChannels,
  stubDashboardCustomNotificationChannels,
} from "./CustomNotificationChannelsStub";

/*
 * User Settings > Notification Settings and custom channels: a "Custom
 * Channels" column, last, while the server has a custom channel on - and no
 * column at all while it has none, since nothing would go through one. The
 * matrix waits for the channels as it waits for the workspaces, so a column
 * never appears under the reader's cursor, and a read that fails offers no
 * column rather than one that sends nowhere. The column's switches read and
 * write UserNotificationSetting.alertByCustomChannel like any other.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111c1",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-2222222222c2");

const CORPO_APP: JSONObject = {
  _id: "6a1f1b4e-9f0c-4d8e-8b2a-3c4d5e6f7a8b",
  name: "CorpoApp",
  pageEveryoneByDefault: true,
};
const PAGER: JSONObject = {
  _id: "7b2a2c5f-0a1d-4e9f-9c3b-4d5e6f7a8b9c",
  name: "Pager",
  pageEveryoneByDefault: false,
};
const GATEWAY: JSONObject = {
  _id: "8c3b3d6a-1b2e-4fa0-8d4c-5e6f7a8b9cad",
  name: "Gateway",
};

const INCIDENT_CREATED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
const INCIDENT_NOTE_POSTED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION;

// The columns with both workspaces connected and no custom channel on.
const COLUMNS_WITHOUT_CUSTOM_CHANNELS: Array<string> = [
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

// Every channel but the custom channels', as a new setting is made.
const OTHER_CHANNEL_KEYS: Array<ChannelKey> = [
  "alertByEmail",
  "alertBySMS",
  "alertByCall",
  "alertByPush",
  "alertByWhatsApp",
  "alertByTelegram",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByWebhook",
];

describe("getShownChannelKeys and the custom channels' column", () => {
  test.each([
    [
      [],
      false,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertByWebhook",
      ],
    ],
    [
      [],
      true,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertByWebhook",
        "alertByCustomChannel",
      ],
    ],
    [
      [WorkspaceType.Slack],
      false,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertBySlack",
        "alertByWebhook",
      ],
    ],
    [
      [WorkspaceType.Slack],
      true,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertBySlack",
        "alertByWebhook",
        "alertByCustomChannel",
      ],
    ],
    [
      [WorkspaceType.MicrosoftTeams],
      false,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertByMicrosoftTeams",
        "alertByWebhook",
      ],
    ],
    [
      [WorkspaceType.MicrosoftTeams],
      true,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertByMicrosoftTeams",
        "alertByWebhook",
        "alertByCustomChannel",
      ],
    ],
    [
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      false,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertBySlack",
        "alertByMicrosoftTeams",
        "alertByWebhook",
      ],
    ],
    [
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      true,
      [
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertBySlack",
        "alertByMicrosoftTeams",
        "alertByWebhook",
        "alertByCustomChannel",
      ],
    ],
  ])(
    "with %j connected and custom channels %p",
    (
      offered: Array<WorkspaceType>,
      hasCustomChannels: boolean,
      expected: Array<string>,
    ) => {
      expect(getShownChannelKeys(offered, hasCustomChannels)).toEqual(expected);
    },
  );

  test("with no word on custom channels, there are none: the column is not shown", () => {
    for (const offered of [
      [],
      [WorkspaceType.Slack],
      [WorkspaceType.MicrosoftTeams],
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
    ]) {
      expect(getShownChannelKeys(offered)).not.toContain(
        "alertByCustomChannel",
      );
      expect(getShownChannelKeys(offered)).toEqual(
        getShownChannelKeys(offered, false),
      );
    }
  });

  test("custom channels add their one column and change no other", () => {
    for (const offered of [
      [],
      [WorkspaceType.Slack],
      [WorkspaceType.MicrosoftTeams],
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
    ]) {
      expect(getShownChannelKeys(offered, true)).toEqual([
        ...getShownChannelKeys(offered, false),
        "alertByCustomChannel",
      ]);
    }
  });

  test("custom channels never bring back a workspace the project has not connected", () => {
    const keys: Array<ChannelKey> = getShownChannelKeys([], true);

    expect(keys).not.toContain("alertBySlack");
    expect(keys).not.toContain("alertByMicrosoftTeams");
  });

  test("the order the workspaces are offered in changes nothing", () => {
    expect(
      getShownChannelKeys(
        [WorkspaceType.MicrosoftTeams, WorkspaceType.Slack],
        true,
      ),
    ).toEqual(
      getShownChannelKeys(
        [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
        true,
      ),
    );
  });

  test("a workspace with no column of its own adds none", () => {
    expect(getShownChannelKeys([WorkspaceType.Slack], true)).toEqual(
      getShownChannelKeys(
        [WorkspaceType.Slack, "Discord" as unknown as WorkspaceType],
        true,
      ),
    );
  });
});

describe("the notification settings matrix and custom channels", () => {
  let rows: Array<UserNotificationSetting>;
  let getList: jest.SpyInstance;
  let held: StubbedDashboardCustomNotificationChannels | null;

  beforeEach(() => {
    held = null;
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
    stubDashboardSecurityCaseValues();
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
    getList = jest
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

  afterEach(() => {
    // A read left held would keep every later matrix of this file waiting.
    held?.release();
    cleanup();
    jest.restoreAllMocks();
    ConnectedWorkspaces.setFetcher(null);
    ConnectedWorkspaces.reset();
  });

  function rowFor(
    eventType: NotificationSettingEventType,
  ): UserNotificationSetting {
    return rows.find((row: UserNotificationSetting): boolean => {
      return row.eventType === eventType;
    })!;
  }

  function renderPage(): void {
    render(
      <NotificationSettings
        pageRoute={new Route("/user-settings/notification-settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  }

  async function findEventRow(label: string): Promise<HTMLElement> {
    return (await screen.findByText(label)).closest("tr")!;
  }

  function headersOf(table: HTMLElement): Array<string> {
    return within(table)
      .getAllByRole("columnheader")
      .slice(1)
      .map((header: HTMLElement): string => {
        return header.textContent?.trim() || "";
      });
  }

  function firstTableHeaders(): Array<string> {
    return headersOf(screen.getAllByRole("table")[0]!);
  }

  // A few macrotasks, for whatever reads are still to settle.
  async function settle(): Promise<void> {
    await act(async (): Promise<void> => {
      for (let hop: number = 0; hop < 5; hop++) {
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });
      }
    });
  }

  test("with no custom channel on, there is no Custom Channels column", async () => {
    stubDashboardCustomNotificationChannels({ channels: [] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident created");

    expect(firstTableHeaders()).toEqual(COLUMNS_WITHOUT_CUSTOM_CHANNELS);
    expect(
      within(row).queryByRole("switch", { name: /^Custom Channels:/ }),
    ).not.toBeInTheDocument();
    expect(within(row).getAllByRole("switch")).toHaveLength(9);
  });

  test("with a custom channel on, every row has a Custom Channels switch, in the last column", async () => {
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    await findEventRow("Incident created");

    expect(firstTableHeaders()).toEqual([
      ...COLUMNS_WITHOUT_CUSTOM_CHANNELS,
      "Custom Channels",
    ]);

    const bodyRows: Array<HTMLElement> = within(
      screen.getAllByRole("table")[0]!,
    )
      .getAllByRole("row")
      .slice(1);

    expect(bodyRows.length).toBeGreaterThan(0);

    for (const bodyRow of bodyRows) {
      const switches: Array<HTMLElement> =
        within(bodyRow).getAllByRole("switch");

      expect(switches).toHaveLength(10);
      expect(switches[9]!.getAttribute("aria-label")).toMatch(
        /^Custom Channels: /,
      );
    }
  });

  test("several channels on are still one column, not one per channel", async () => {
    stubDashboardCustomNotificationChannels({
      channels: [CORPO_APP, PAGER, GATEWAY],
    });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident created");

    expect(
      firstTableHeaders().filter((header: string): boolean => {
        return header === "Custom Channels";
      }),
    ).toHaveLength(1);
    expect(firstTableHeaders()).not.toContain("CorpoApp");
    expect(within(row).getAllByRole("switch")).toHaveLength(10);
  });

  test("it is off until the person turns it on, and on where they did", async () => {
    rowFor(INCIDENT_CREATED).alertByCustomChannel = true;
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();

    expect(
      within(await findEventRow("Incident created")).getByRole("switch", {
        name: "Custom Channels: On. Click to disable.",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(await findEventRow("Incident note posted")).getByRole("switch", {
        name: "Custom Channels: Off. Click to enable.",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("the matrix reads the custom channel column with the others", async () => {
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    await findEventRow("Incident created");

    expect(getList).toHaveBeenCalled();

    for (const call of getList.mock.calls) {
      expect(call[0].select.alertByCustomChannel).toBe(true);
      expect(call[0].query.projectId).toEqual(PROJECT_ID);
      expect(call[0].query.userId).toEqual(USER_ID);
    }
  });

  test("a switch in the column writes the custom channel setting of that row, and nothing else", async () => {
    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as any);
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(
      within(row).getByRole("switch", { name: /^Custom Channels:/ }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(updateById.mock.calls[0][0].modelType).toBe(UserNotificationSetting);
    expect(updateById.mock.calls[0][0].id).toEqual(
      rowFor(INCIDENT_NOTE_POSTED).id,
    );
    expect(updateById.mock.calls[0][0].data).toEqual({
      alertByCustomChannel: true,
    });

    await waitFor(() => {
      expect(
        within(
          screen.getByText("Incident note posted").closest("tr")!,
        ).getByRole("switch", { name: /^Custom Channels:/ }),
      ).toHaveAttribute("aria-checked", "true");
    });
    // Email on the same row is untouched.
    expect(
      within(screen.getByText("Incident note posted").closest("tr")!).getByRole(
        "switch",
        { name: /^Email:/ },
      ),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("switching it off writes false", async () => {
    rowFor(INCIDENT_NOTE_POSTED).alertByCustomChannel = true;
    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as any);
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(
      within(row).getByRole("switch", { name: /^Custom Channels:/ }),
    );

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(updateById.mock.calls[0][0].data).toEqual({
      alertByCustomChannel: false,
    });
  });

  test("switched on for an event with no setting yet, it makes one with custom channels alone on", async () => {
    rows = rows.filter((row: UserNotificationSetting): boolean => {
      return row.eventType !== INCIDENT_NOTE_POSTED;
    });
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue({} as any);
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(
      within(row).getByRole("switch", { name: /^Custom Channels:/ }),
    );

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });

    const model: UserNotificationSetting = create.mock.calls[0][0].model;

    expect(model.eventType).toBe(INCIDENT_NOTE_POSTED);
    expect(model.projectId).toEqual(PROJECT_ID);
    expect(model.userId).toEqual(USER_ID);
    expect(model.alertByCustomChannel).toBe(true);

    for (const key of OTHER_CHANNEL_KEYS) {
      expect({ key, value: model[key] }).toEqual({ key, value: false });
    }
  });

  test("a failed save puts the switch back and says why", async () => {
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(new Error("Custom channel choice could not be saved"));
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(
      within(row).getByRole("switch", { name: /^Custom Channels:/ }),
    );

    expect(
      await screen.findByText("Custom channel choice could not be saved"),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        within(
          screen.getByText("Incident note posted").closest("tr")!,
        ).getByRole("switch", { name: /^Custom Channels:/ }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });

  test("a hidden column keeps what was saved: with no channel on, a toggle elsewhere writes only its own column", async () => {
    for (const row of rows) {
      row.alertByCustomChannel = true;
    }
    const updateById: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as any);
    stubDashboardCustomNotificationChannels({ channels: [] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(within(row).getByRole("switch", { name: /^Email:/ }));

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });
    expect(updateById.mock.calls[0][0].data).toEqual({ alertByEmail: false });
  });

  test("on a first visit the matrix keeps its loader until it knows the custom channels, then draws their column", async () => {
    const fetchWorkspaces: jest.Mock = jest.fn(
      async (): Promise<Array<WorkspaceType>> => {
        return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams];
      },
    );
    ConnectedWorkspaces.setFetcher(fetchWorkspaces);
    held = stubDashboardCustomNotificationChannels({
      channels: [CORPO_APP],
      hold: true,
    });

    renderPage();

    await waitFor(() => {
      expect(getList).toHaveBeenCalled();
      expect(fetchWorkspaces).toHaveBeenCalled();
      expect(held!.reads).toBeGreaterThan(0);
    });
    // The settings and the workspaces are in; only the channels are not.
    await settle();

    expect(screen.getAllByTestId("component-loader").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("table")).toHaveLength(0);

    await act(async (): Promise<void> => {
      held!.release();
    });

    const row: HTMLElement = await findEventRow("Incident created");

    expect(
      within(row).getByRole("switch", { name: /^Custom Channels:/ }),
    ).toBeInTheDocument();
    expect(firstTableHeaders()).toEqual([
      ...COLUMNS_WITHOUT_CUSTOM_CHANNELS,
      "Custom Channels",
    ]);
  });

  test("while the workspaces are not known, the custom channels being known draws nothing either", async () => {
    ConnectedWorkspaces.setFetcher((): Promise<Array<WorkspaceType>> => {
      return new Promise<Array<WorkspaceType>>((): void => {});
    });
    const stub: StubbedDashboardCustomNotificationChannels =
      stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();

    await waitFor(() => {
      expect(getList).toHaveBeenCalled();
      expect(stub.reads).toBeGreaterThan(0);
    });
    await settle();

    expect(screen.getAllByTestId("component-loader").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  test("if the custom channels cannot be read, no column is offered and the rest of the matrix is", async () => {
    stubDashboardCustomNotificationChannels({
      channels: [CORPO_APP],
      fail: true,
    });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident created");

    expect(firstTableHeaders()).toEqual(COLUMNS_WITHOUT_CUSTOM_CHANNELS);
    expect(
      within(row).queryByRole("switch", { name: /^Custom Channels:/ }),
    ).not.toBeInTheDocument();
    expect(within(row).getAllByRole("switch")).toHaveLength(9);
  });

  test("with neither workspace connected and a channel on, the matrix offers eight switches: the seven others and custom channels", async () => {
    ConnectedWorkspaces.setFetcher(async (): Promise<Array<WorkspaceType>> => {
      return [];
    });
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    const row: HTMLElement = await findEventRow("Incident created");

    expect(within(row).getAllByRole("switch")).toHaveLength(8);
    expect(firstTableHeaders()).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Webhook",
      "Custom Channels",
    ]);
  });

  test("every matrix of a tab shares one read of the custom channels", async () => {
    const stub: StubbedDashboardCustomNotificationChannels =
      stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    await findEventRow("Incident created");

    // The Incidents tab has two cards, Incidents and Incident Episodes.
    expect(screen.getAllByRole("table").length).toBeGreaterThan(1);
    expect(stub.reads).toBe(1);
  });

  test("every tab offers the column, on every card", async () => {
    stubDashboardCustomNotificationChannels({ channels: [CORPO_APP] });

    renderPage();
    await findEventRow("Incident created");

    for (const tabName of [
      "Incidents",
      "Alerts",
      "Monitoring",
      "Status Pages",
      "Scheduled Maintenance",
      "On-Call",
      "Security",
    ]) {
      fireEvent.click(screen.getByRole("tab", { name: tabName }));

      // Every card of the tab drawn: no loader left.
      await waitFor(() => {
        expect(screen.getAllByRole("switch").length).toBeGreaterThan(1);
        expect(screen.queryAllByTestId("component-loader")).toHaveLength(0);
      });

      for (const table of screen.getAllByRole("table")) {
        expect({ tabName, headers: headersOf(table) }).toEqual({
          tabName,
          headers: [...COLUMNS_WITHOUT_CUSTOM_CHANNELS, "Custom Channels"],
        });
      }
    }
  });
});
