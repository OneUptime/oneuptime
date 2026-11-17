import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import NotificationSettings, {
  getShownChannelKeys,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildTestPriority,
  testPriorityId,
} from "../../Helpers/SecurityCaseValues";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import { stubDashboardCustomNotificationChannels } from "./CustomNotificationChannelsStub";
import {
  resetNotificationChannelReadiness,
  stubNotificationChannelReadiness,
} from "./NotificationChannelReadinessStub";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * User Settings > Notification Settings: the per-event, per-channel matrix,
 * and nothing else.
 *
 * The two email-VOLUME controls that used to sit above the tabs here - the
 * routine-email preset and the rollup switch - moved to User Settings > Email
 * Preferences, because neither is a per-event choice and both were being read
 * as settings for whichever tab happened to be open. They are covered by
 * UserSettingsEmailPreferences.test.tsx. What this file still has to prove is
 * that the move did not strand anybody: the matrix reads and writes the
 * signed-in member's own rows, and the page says out loud where the volume
 * controls went.
 *
 * Every channel can reach the person here (NotificationChannelReadinessStub
 * left alone), so every column is offered as before;
 * NotificationSettingsEasierToUse.test.tsx has the channels that cannot, the
 * "All events" switches, the tabs' summaries and "Saved".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("user settings > notification settings", () => {
  let rows: Array<UserNotificationSetting>;
  let getList: jest.SpyInstance;

  beforeEach(() => {
    /*
     * The Slack and Microsoft Teams columns are there only for the
     * workspaces the project has connected; both are, unless a test says
     * otherwise. The store is answered here rather than through
     * ModelAPI.getList, whose calls these tests read as the matrix's own.
     */
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
        row.alertBySMS = true;
        return row;
      },
    );
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(User, "getUserId").mockReturnValue(USER_ID);
    // The project's case priorities, which New security case picks from.
    stubDashboardSecurityCaseValues();
    /*
     * The server's custom channels: none, so there is no Custom Channels
     * column (NotificationSettingsCustomChannels.test.tsx has the column).
     */
    stubDashboardCustomNotificationChannels();
    // Every channel has a verified method: every column is offered.
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
    getList = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (data: Parameters<typeof ModelAPI.getList>[0]): Promise<any> => {
          const query: Query<UserNotificationSetting> = data.query;
          const eventTypes: Array<string> = (query.eventType as Includes)
            .values as Array<string>;
          const settings: Array<UserNotificationSetting> = rows.filter(
            (row: UserNotificationSetting): boolean => {
              return (
                eventTypes.includes(row.eventType!) &&
                row.projectId?.toString() ===
                  (query.projectId as ObjectID).toString() &&
                row.userId?.toString() === (query.userId as ObjectID).toString()
              );
            },
          );
          return {
            data: settings,
            count: settings.length,
          };
        },
      );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    ConnectedWorkspaces.setFetcher(null);
    ConnectedWorkspaces.reset();
    resetNotificationChannelReadiness();
  });

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

  /*
   * THE POINTER, which is the whole cost of splitting the pages.
   *
   * Somebody drowning in OneUptime mail opens this page, because the menu and
   * every owner-email footer call it the place your email choices live. The
   * two controls that actually reduce the VOLUME are no longer on it. Without
   * this line the matrix reads as the whole story, and the only remedy on
   * offer is switching twenty-one events off by hand.
   *
   * It is the page's first line now (#8887): what the page is for, then the
   * two pages it is mistaken for - How to Reach Me for on-call pages, Email
   * Preferences for how much email - each a link.
   */
  describe("the pointer to Email Preferences", () => {
    test("says what this page does, and links to the page that sets how much email", async () => {
      renderPage();
      await findEventRow("Incident created");

      const intro: HTMLElement = screen.getByTestId(
        "notification-settings-intro",
      );

      expect(intro).toHaveTextContent(
        "Choose which updates reach you, and on which channels. On-call pages follow How to Reach Me, and Email Preferences sets how much email you get.",
      );

      const link: HTMLElement = within(intro).getByRole("link", {
        name: "Email Preferences",
      });

      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/user-settings/email-preferences`,
      );
    });

    test("and to How to Reach Me, where on-call pages are set, and to its docs", async () => {
      renderPage();
      await findEventRow("Incident created");

      const intro: HTMLElement = screen.getByTestId(
        "notification-settings-intro",
      );

      expect(
        within(intro).getByRole("link", { name: "How to Reach Me" }),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/user-settings/on-call-rules`,
      );
      expect(
        within(intro).getByTestId("notification-settings-intro-learn-more"),
      ).toHaveAttribute(
        "href",
        expect.stringContaining("/notifications/notification-settings"),
      );
    });

    test("the links carry the real project id, not the :projectId template", async () => {
      renderPage();
      await findEventRow("Incident created");

      for (const name of ["Email Preferences", "How to Reach Me"]) {
        const href: string = within(
          screen.getByTestId("notification-settings-intro"),
        )
          .getByRole("link", { name })
          .getAttribute("href")!;

        expect(href).not.toContain(":projectId");
        expect(href).toContain(PROJECT_ID.toString());
      }
    });

    test("the grey box that said what the switches do not do is gone", async () => {
      renderPage();
      await findEventRow("Incident created");

      expect(
        screen.queryByText(
          "These switches decide which notifications reach you, not how much email they add up to.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Click any channel to switch it on or off. Changes save automatically.",
        ),
      ).not.toBeInTheDocument();
    });

    /*
     * The volume controls left; nothing of them may be left behind. A stray
     * "Reduce routine emails" button here would post to the bulk endpoint
     * with no card explaining what it does.
     */
    test("neither moved card is still rendered here", async () => {
      renderPage();
      await findEventRow("Incident created");

      expect(
        screen.queryByRole("button", { name: "Reduce routine emails" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Fewer routine emails"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Email Rollup")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("switch", { name: /^Roll up notification emails/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("the matrix", () => {
    test("every event has one reachable preference and reads are scoped to the current member", async () => {
      renderPage();
      await findEventRow("Assigned to an incident");
      for (const tabName of [
        "Alerts",
        "Monitoring",
        "Status Pages",
        "Scheduled Maintenance",
        "On-Call",
        "Security",
      ]) {
        fireEvent.click(screen.getByRole("tab", { name: tabName }));
        await waitFor(() => {
          expect(screen.getAllByRole("switch").length).toBeGreaterThan(1);
        });
        if (tabName === "Monitoring") {
          await screen.findByText("AI agent status changed");
          await screen.findByText("Added as AI agent owner");
        }
      }
      const eventReads: Array<any> = getList.mock.calls.map(
        (call: Array<any>): any => {
          return call[0];
        },
      );
      const queriedTypes: Array<string> = eventReads.flatMap(
        (call: any): Array<string> => {
          return call.query.eventType.values;
        },
      );
      expect(queriedTypes.sort()).toEqual(
        Object.values(NotificationSettingEventType).sort(),
      );
      for (const call of eventReads) {
        expect(call.query.projectId).toEqual(PROJECT_ID);
        expect(call.query.userId).toEqual(USER_ID);
      }
    });

    /*
     * Issue #4159: owners of an Incoming Call Policy are told about missed
     * calls, and this row is where each of them picks the channels or turns
     * it off. It sits on the On-Call tab, under its own card.
     */
    test("the On-Call tab has the missed call row for incoming call policy owners", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();
      await findEventRow("Assigned to an incident");
      fireEvent.click(screen.getByRole("tab", { name: "On-Call" }));

      expect(await screen.findByText("Incoming Call Policies")).toBeVisible();
      expect(
        screen.getByText(
          "Notify me about calls to incoming call policies I own.",
        ),
      ).toBeVisible();

      const row: HTMLElement = await findEventRow("Missed call");
      expect(
        within(row).getByText(
          "A call to an incoming call policy you own ends without reaching anyone.",
        ),
      ).toBeVisible();

      const emailSwitch: HTMLElement = within(row).getByRole("switch", {
        name: /^Email for /,
      });
      expect(emailSwitch).toHaveAttribute("aria-checked", "true");

      fireEvent.click(emailSwitch);

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      const missedCallRow: UserNotificationSetting | undefined = rows.find(
        (setting: UserNotificationSetting): boolean => {
          return (
            setting.eventType ===
            NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION
          );
        },
      );
      expect(updateById.mock.calls[0][0].id).toEqual(missedCallRow!.id);
      expect(updateById.mock.calls[0][0].data).toEqual({ alertByEmail: false });
    });

    /*
     * An exception assigned to the member, or to a team they are on, is told
     * through this row: on the Monitoring tab, under its own Exceptions
     * card, toggling its own setting alone.
     */
    test("the Monitoring tab has the exception assignment row, which toggles alone", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();
      await findEventRow("Assigned to an incident");
      fireEvent.click(screen.getByRole("tab", { name: "Monitoring" }));

      expect(await screen.findByText("Exceptions")).toBeVisible();
      expect(
        screen.getByText(
          "Notify me about exceptions assigned to me or to a team I am on.",
        ),
      ).toBeVisible();

      const row: HTMLElement = await findEventRow("Exception assigned to me");
      expect(
        within(row).getByText(
          "Someone assigns an exception to you, or to a team you are on.",
        ),
      ).toBeVisible();

      fireEvent.click(within(row).getByRole("switch", { name: /^Email for / }));

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      const exceptionRow: UserNotificationSetting | undefined = rows.find(
        (setting: UserNotificationSetting): boolean => {
          return (
            setting.eventType ===
            NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION
          );
        },
      );
      expect(updateById.mock.calls[0][0].id).toEqual(exceptionRow!.id);
      expect(Object.keys(updateById.mock.calls[0][0].data)).toEqual([
        "alertByEmail",
      ]);
    });

    /*
     * An SLA breach was sent under "Incident created" until it had an event
     * of its own, so switching that off silenced breaches too. Its row sits
     * on the Incidents card, right after the reminder, and turns breaches on
     * or off by itself.
     */
    test("the Incidents card has an SLA breached row of its own, which toggles alone", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();

      const row: HTMLElement = await findEventRow("Incident SLA breached");
      expect(
        within(row).getByText(
          "An incident you own misses its SLA response or resolution deadline.",
        ),
      ).toBeVisible();

      // In the Incidents card, after the reminder and before the notes.
      const labels: Array<string> = Array.from(
        row.closest("table")!.querySelectorAll("tr"),
      ).map((tableRow: Element): string => {
        return tableRow.textContent || "";
      });
      const at: (label: string) => number = (label: string): number => {
        return labels.findIndex((text: string): boolean => {
          return text.includes(label);
        });
      };
      expect(at("Incident SLA breached")).toBe(at("Incident reminder") + 1);
      expect(at("Incident SLA breached")).toBeLessThan(
        at("Incident note posted"),
      );

      fireEvent.click(
        within(row).getByRole("switch", {
          name: /^SMS for /,
        }),
      );

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      const slaRow: UserNotificationSetting | undefined = rows.find(
        (setting: UserNotificationSetting): boolean => {
          return (
            setting.eventType ===
            NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION
          );
        },
      );
      const createdRow: UserNotificationSetting | undefined = rows.find(
        (setting: UserNotificationSetting): boolean => {
          return (
            setting.eventType ===
            NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION
          );
        },
      );
      expect(updateById.mock.calls[0][0].id).toEqual(slaRow!.id);
      expect(updateById.mock.calls[0][0].id).not.toEqual(createdRow!.id);
      expect(updateById.mock.calls[0][0].data).toEqual({ alertBySMS: false });
    });

    /*
     * A single cell used to be blocked while the bulk preset ran, because
     * both lived on this page. That interlock is gone with the preset, so the
     * one thing left to prove is that an ordinary toggle still writes exactly
     * one column of exactly one row.
     */
    test("toggling a cell updates that row by id, one column only", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();
      const row: HTMLElement = await findEventRow("Incident note posted");
      const emailSwitch: HTMLElement = within(row).getByRole("switch", {
        name: /^Email for /,
      });

      expect(emailSwitch).toHaveAttribute("aria-checked", "true");
      fireEvent.click(emailSwitch);

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      expect(updateById.mock.calls[0][0].data).toEqual({ alertByEmail: false });
      expect(updateById.mock.calls[0][0].modelType).toBe(
        UserNotificationSetting,
      );
      await waitFor(() => {
        expect(
          within(
            screen.getByText("Incident note posted").closest("tr")!,
          ).getByRole("switch", { name: /^Email for / }),
        ).toHaveAttribute("aria-checked", "false");
      });
      /* The other channel on the same row is untouched. */
      expect(
        within(
          screen.getByText("Incident note posted").closest("tr")!,
        ).getByRole("switch", { name: /^SMS for / }),
      ).toHaveAttribute("aria-checked", "true");
    });

    test("a failed save puts the switch back and says why", async () => {
      jest
        .spyOn(ModelAPI, "updateById")
        .mockRejectedValue(new Error("Preference could not be saved"));

      renderPage();
      const row: HTMLElement = await findEventRow("Incident note posted");
      fireEvent.click(within(row).getByRole("switch", { name: /^Email for / }));

      expect(
        await screen.findByText("Preference could not be saved"),
      ).toBeVisible();
      await waitFor(() => {
        expect(
          within(
            screen.getByText("Incident note posted").closest("tr")!,
          ).getByRole("switch", { name: /^Email for / }),
        ).toHaveAttribute("aria-checked", "true");
      });
    });

    test("every channel has a column when both workspaces are connected", async () => {
      renderPage();
      const row: HTMLElement = await findEventRow("Incident created");

      for (const channel of [
        "Email",
        "SMS",
        "Call",
        "Push",
        "WhatsApp",
        "Telegram",
        "Slack",
        "Microsoft Teams",
        "Webhook",
      ]) {
        expect(
          within(row).getByRole("switch", {
            name: new RegExp(`^${channel} for `),
          }),
        ).toBeInTheDocument();
      }
    });

    /*
     * The column names the product, as every other list of channels does.
     * It was labelled "Teams", the key that means teams of people - and
     * most languages translate it that way (see
     * NotificationSettingsMicrosoftTeamsInEveryLanguage.test.tsx).
     */
    test("the Microsoft Teams column is labelled with the product's name, between Slack and Webhook", async () => {
      renderPage();
      await findEventRow("Incident created");

      const headers: Array<string> = within(screen.getAllByRole("table")[0]!)
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent?.trim() || "";
        });

      expect(headers).toEqual([
        "Event",
        "Email",
        "SMS",
        "Call",
        "Push",
        "WhatsApp",
        "Telegram",
        "Slack",
        "Microsoft Teams",
        "Webhook",
      ]);
      expect(headers).not.toContain("Teams");
    });

    /*
     * A switch's name is its channel and its event; whether it is on is
     * the switch's own state (aria-checked), which a screen reader says
     * after the name, so the name no longer repeats it ("On. Click to
     * disable." read as "On. Click to disable, switch, on").
     */
    test("its switches say Microsoft Teams, on and off, so a screen reader names the product", async () => {
      const created: UserNotificationSetting | undefined = rows.find(
        (row: UserNotificationSetting): boolean => {
          return (
            row.eventType ===
            NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION
          );
        },
      );
      created!.alertByMicrosoftTeams = true;

      renderPage();

      expect(
        within(await findEventRow("Incident created")).getByRole("switch", {
          name: "Microsoft Teams for Incident created",
        }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        within(await findEventRow("Incident note posted")).getByRole("switch", {
          name: "Microsoft Teams for Incident note posted",
        }),
      ).toHaveAttribute("aria-checked", "false");
    });

    test("a switch in the Microsoft Teams column writes the Microsoft Teams setting", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();
      const row: HTMLElement = await findEventRow("Incident note posted");
      fireEvent.click(
        within(row).getByRole("switch", { name: /^Microsoft Teams for / }),
      );

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      expect(updateById.mock.calls[0][0].data).toEqual({
        alertByMicrosoftTeams: true,
      });
    });

    /*
     * "Microsoft Teams" takes two lines in its column at most widths: the
     * headers are top-aligned so the icons stay in one row.
     */
    test("every channel header is top-aligned, so the icons stay level when a label wraps", async () => {
      renderPage();
      await findEventRow("Incident created");

      const channelHeaders: Array<HTMLElement> = within(
        screen.getAllByRole("table")[0]!,
      )
        .getAllByRole("columnheader")
        .slice(1);

      expect(channelHeaders).toHaveLength(9);

      for (const header of channelHeaders) {
        expect(header).toHaveClass("align-top");
      }
    });

    test.each([
      [[WorkspaceType.Slack], "Slack", "Microsoft Teams"],
      [[WorkspaceType.MicrosoftTeams], "Microsoft Teams", "Slack"],
    ])(
      "with only %j connected, the %s column is there and the %s one is not",
      async (
        connected: Array<WorkspaceType>,
        shown: string,
        hidden: string,
      ) => {
        ConnectedWorkspaces.setFetcher(
          async (): Promise<Array<WorkspaceType>> => {
            return connected;
          },
        );

        renderPage();
        const row: HTMLElement = await findEventRow("Incident created");

        expect(
          within(row).getByRole("switch", {
            name: new RegExp(`^${shown} for `),
          }),
        ).toBeInTheDocument();
        expect(
          within(row).queryByRole("switch", {
            name: new RegExp(`^${hidden} for `),
          }),
        ).not.toBeInTheDocument();
        expect(
          screen.getAllByRole("columnheader").map((header: HTMLElement) => {
            return header.textContent;
          }),
        ).not.toContain(hidden);
      },
    );

    test("with neither connected, the matrix offers the seven other channels", async () => {
      ConnectedWorkspaces.setFetcher(
        async (): Promise<Array<WorkspaceType>> => {
          return [];
        },
      );

      renderPage();
      const row: HTMLElement = await findEventRow("Incident created");

      expect(within(row).getAllByRole("switch")).toHaveLength(7);
      expect(
        within(row).queryByRole("switch", { name: /^Slack for / }),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByRole("switch", { name: /^Microsoft Teams for / }),
      ).not.toBeInTheDocument();
    });

    test("if asking which are connected fails, every workspace's column stays, so nothing is hidden on a guess", async () => {
      ConnectedWorkspaces.setFetcher(
        async (): Promise<Array<WorkspaceType>> => {
          throw new Error("Permission denied");
        },
      );

      renderPage();
      const row: HTMLElement = await findEventRow("Incident created");

      expect(within(row).getAllByRole("switch")).toHaveLength(10);
      expect(
        within(row).getByRole("switch", { name: /^Mattermost for / }),
      ).toBeInTheDocument();
    });

    test("on a first visit the matrix keeps its loader until it knows, rather than dropping columns under the reader", async () => {
      ConnectedWorkspaces.setFetcher((): Promise<Array<WorkspaceType>> => {
        return new Promise<Array<WorkspaceType>>((): void => {});
      });

      renderPage();

      await waitFor(() => {
        expect(getList).toHaveBeenCalled();
      });
      expect(screen.getAllByTestId("detail-skeleton").length).toBeGreaterThan(
        0,
      );
      expect(screen.queryAllByRole("switch")).toHaveLength(0);
    });

    test("a hidden column keeps what was saved: a toggle elsewhere writes only its own column", async () => {
      ConnectedWorkspaces.setFetcher(
        async (): Promise<Array<WorkspaceType>> => {
          return [];
        },
      );
      for (const row of rows) {
        row.alertBySlack = true;
      }
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      renderPage();
      const row: HTMLElement = await findEventRow("Incident note posted");
      fireEvent.click(within(row).getByRole("switch", { name: /^Email for / }));

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      expect(updateById.mock.calls[0][0].data).toEqual({ alertByEmail: false });
    });

    test("getShownChannelKeys drops only the workspaces that are not offered", () => {
      expect(getShownChannelKeys([])).toEqual([
        "alertByEmail",
        "alertBySMS",
        "alertByCall",
        "alertByPush",
        "alertByWhatsApp",
        "alertByTelegram",
        "alertByWebhook",
      ]);
      expect(getShownChannelKeys([WorkspaceType.MicrosoftTeams])).toContain(
        "alertByMicrosoftTeams",
      );
      expect(getShownChannelKeys([WorkspaceType.MicrosoftTeams])).not.toContain(
        "alertBySlack",
      );
      expect(
        getShownChannelKeys([
          WorkspaceType.Slack,
          WorkspaceType.MicrosoftTeams,
        ]),
      ).toHaveLength(9);
      expect(getShownChannelKeys([WorkspaceType.Mattermost])).toContain(
        "alertByMattermost",
      );
      expect(
        getShownChannelKeys([
          WorkspaceType.Slack,
          WorkspaceType.MicrosoftTeams,
        ]),
      ).not.toContain("alertByMattermost");
      expect(
        getShownChannelKeys([
          WorkspaceType.Slack,
          WorkspaceType.MicrosoftTeams,
          WorkspaceType.Mattermost,
        ]),
      ).toHaveLength(10);
    });

    test("switching projects re-reads every row against the new project", async () => {
      const { rerender } = render(
        <NotificationSettings
          pageRoute={new Route("/user-settings/notification-settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );
      await findEventRow("Incident created");

      const otherProjectId: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(otherProjectId);
      getList.mockClear();
      rerender(
        <NotificationSettings
          pageRoute={new Route("/user-settings/notification-settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );

      const row: HTMLElement = await findEventRow("Incident created");
      /* No rows exist for the other project, so every cell reads as off. */
      expect(
        within(row).getByRole("switch", { name: /^Email for / }),
      ).toHaveAttribute("aria-checked", "false");
      expect(getList.mock.calls.length).toBeGreaterThan(0);
      for (const call of getList.mock.calls) {
        expect(call[0].query.projectId).toEqual(otherProjectId);
        expect(call[0].query.userId).toEqual(USER_ID);
      }
    });
  });
  /*
   * The Security tab: the three security case events, and on New security
   * case the priority that notifies - one of the project's own, its high
   * priority and above for a member who never chose, which is what a
   * project that only turned Security on gets.
   */
  describe("the Security tab", () => {
    async function openSecurityTab(): Promise<void> {
      renderPage();
      await findEventRow("Incident created");
      fireEvent.click(screen.getByRole("tab", { name: "Security" }));
      await screen.findByText("Security Cases");
    }

    function openedRow(): UserNotificationSetting {
      return rows.find((row: UserNotificationSetting): boolean => {
        return (
          row.eventType ===
          NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION
        );
      })!;
    }

    test("lists the three security case events, each with its switches", async () => {
      await openSecurityTab();

      for (const label of [
        "New security case",
        "Security case assigned to me",
        "Playbook step waiting for my approval",
      ]) {
        const row: HTMLElement = await findEventRow(label);
        expect(within(row).getAllByRole("switch")).toHaveLength(9);
      }
    });

    /*
     * The picker is the shared Dropdown (#9194): its combobox is react-select's
     * input, the choice it shows is its single value, and its choices are
     * the options of the menu it opens, drawn over the page.
     */
    function pickerIn(row: HTMLElement): HTMLElement {
      return within(row).getByRole("combobox");
    }

    function shownPriority(row: HTMLElement): string | null {
      return row.querySelector(".ou-select__single-value")?.textContent || null;
    }

    function openPicker(row: HTMLElement): void {
      fireEvent.keyDown(pickerIn(row), { key: "ArrowDown", code: "ArrowDown" });
    }

    async function listedPriorities(row: HTMLElement): Promise<Array<string>> {
      openPicker(row);
      const options: Array<HTMLElement> = await screen.findAllByRole("option");
      const names: Array<string> = options.map(
        (option: HTMLElement): string => {
          return option.textContent || "";
        },
      );
      fireEvent.keyDown(pickerIn(row), { key: "Escape", code: "Escape" });
      return names;
    }

    async function choosePriority(
      row: HTMLElement,
      name: string,
    ): Promise<void> {
      openPicker(row);
      fireEvent.click(await screen.findByRole("option", { name }));
    }

    test("only New security case asks for a priority, and it reads High and above until chosen", async () => {
      await openSecurityTab();

      const row: HTMLElement = await findEventRow("New security case");

      expect(shownPriority(row)).toBe("High and above");
      expect(await listedPriorities(row)).toEqual([
        "Critical only",
        "High and above",
        "Medium and above",
        "Low and above",
        "Every case",
      ]);
      expect(
        within(await findEventRow("Security case assigned to me")).queryByRole(
          "combobox",
        ),
      ).not.toBeInTheDocument();
    });

    test("the picker is the shared Dropdown, named by the words beside it", async () => {
      await openSecurityTab();

      const row: HTMLElement = await findEventRow("New security case");

      // No hand-drawn select of its own: the shared Dropdown's control.
      expect(row.querySelector("select")).toBeNull();
      expect(row.querySelector(".ou-select__control")).not.toBeNull();
      expect(pickerIn(row)).toHaveAccessibleName("Notify me about");
      // A priority always notifies: nothing to clear it to.
      expect(row.querySelector(".ou-select__clear-indicator")).toBeNull();
    });

    test("shows the priority the member chose", async () => {
      openedRow().minimumSecurityCasePriorityId = testPriorityId(
        SecurityCasePriorityLevel.Critical,
      );

      await openSecurityTab();

      expect(shownPriority(await findEventRow("New security case"))).toBe(
        "Critical only",
      );
    });

    test("offers the project's own priorities by their names, an archived one only to whoever chose it", async () => {
      const priorities: Array<SecurityCasePriority> = [
        buildTestPriority({
          id: "c1000000-0000-4000-8000-0000000000e1",
          name: "Emergency",
          order: 0,
        }),
        ...buildDefaultTestPriorities(),
      ];
      priorities[1]!.name = "Sev 1";
      priorities[4]!.isArchived = true; // Low
      stubDashboardSecurityCaseValues({ priorities });

      await openSecurityTab();

      const row: HTMLElement = await findEventRow("New security case");
      await within(row).findByRole("combobox");

      expect(await listedPriorities(row)).toEqual([
        "Emergency only",
        "Sev 1 and above",
        "High and above",
        "Medium and above",
        "Every case",
      ]);
      cleanup();

      // A member who chose Low before it was archived keeps it, and sees it.
      openedRow().minimumSecurityCasePriorityId = testPriorityId(
        SecurityCasePriorityLevel.Low,
      );
      await openSecurityTab();

      const chosenRow: HTMLElement = await findEventRow("New security case");
      await within(chosenRow).findByRole("combobox");

      expect(shownPriority(chosenRow)).toBe("Low and above");
      expect(await listedPriorities(chosenRow)).toContain("Low and above");
    });

    test("a choice the project no longer has reads as the default", async () => {
      openedRow().minimumSecurityCasePriorityId = new ObjectID(
        "c1000000-0000-4000-8000-0000000000ff",
      );

      await openSecurityTab();

      expect(shownPriority(await findEventRow("New security case"))).toBe(
        "High and above",
      );
    });

    test("choosing a priority saves it on that row alone", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      await openSecurityTab();
      await choosePriority(
        await findEventRow("New security case"),
        "Medium and above",
      );

      await waitFor(() => {
        expect(updateById).toHaveBeenCalledTimes(1);
      });
      expect(updateById.mock.calls[0][0].id).toEqual(openedRow().id);
      expect(updateById.mock.calls[0][0].data).toEqual({
        minimumSecurityCasePriorityId:
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Medium],
      });
      await waitFor(() => {
        expect(
          shownPriority(screen.getByText("New security case").closest("tr")!),
        ).toBe("Medium and above");
      });
    });

    test("choosing the priority already chosen saves nothing", async () => {
      const updateById: jest.SpyInstance = jest
        .spyOn(ModelAPI, "updateById")
        .mockResolvedValue({} as any);

      await openSecurityTab();
      await choosePriority(
        await findEventRow("New security case"),
        "High and above",
      );

      expect(updateById).not.toHaveBeenCalled();
    });

    test("a failed save puts the choice back and says why", async () => {
      jest
        .spyOn(ModelAPI, "updateById")
        .mockRejectedValue(new Error("Priority could not be saved"));

      await openSecurityTab();
      await choosePriority(
        await findEventRow("New security case"),
        "Low and above",
      );

      expect(
        await screen.findByText("Priority could not be saved"),
      ).toBeVisible();
      await waitFor(() => {
        expect(
          shownPriority(screen.getByText("New security case").closest("tr")!),
        ).toBe("High and above");
      });
    });

    test("without a row yet, choosing makes one as the server would: email and push on, with the choice", async () => {
      rows = rows.filter((row: UserNotificationSetting): boolean => {
        return (
          row.eventType !==
          NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION
        );
      });
      const create: jest.SpyInstance = jest
        .spyOn(ModelAPI, "create")
        .mockResolvedValue({} as any);

      await openSecurityTab();
      await choosePriority(
        await findEventRow("New security case"),
        "Critical only",
      );

      await waitFor(() => {
        expect(create).toHaveBeenCalledTimes(1);
      });
      const model: UserNotificationSetting = create.mock.calls[0][0].model;
      expect(model.eventType).toBe(
        NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      );
      expect(model.minimumSecurityCasePriorityId?.toString()).toBe(
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
      );
      expect(model.alertByEmail).toBe(true);
      expect(model.alertByPush).toBe(true);
      expect(model.alertBySMS).toBe(false);
      expect(model.projectId).toEqual(PROJECT_ID);
      expect(model.userId).toEqual(USER_ID);
    });
  });
});
