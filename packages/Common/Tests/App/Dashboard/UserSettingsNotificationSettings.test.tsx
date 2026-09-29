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
import NotificationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
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
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("user settings > notification settings", () => {
  let rows: Array<UserNotificationSetting>;
  let getList: jest.SpyInstance;

  beforeEach(() => {
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
   */
  describe("the pointer to Email Preferences", () => {
    test("names what this page does not do, and links to the page that does", async () => {
      renderPage();
      await findEventRow("Incident created");

      expect(
        screen.getByText(
          "These switches decide which notifications reach you, not how much email they add up to.",
        ),
      ).toBeVisible();

      const link: HTMLElement = screen.getByRole("link", {
        name: "Reduce routine emails or change email rollup in Email Preferences",
      });

      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/user-settings/email-preferences`,
      );
    });

    test("the link carries the real project id, not the :projectId template", async () => {
      renderPage();
      await findEventRow("Incident created");

      const href: string = screen
        .getByRole("link", {
          name: "Reduce routine emails or change email rollup in Email Preferences",
        })
        .getAttribute("href")!;

      expect(href).not.toContain(":projectId");
      expect(href).toContain(PROJECT_ID.toString());
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
        screen.queryByRole("switch", { name: /^Roll up notification emails:/ }),
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
        name: /^Email:/,
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
          ).getByRole("switch", { name: /^Email:/ }),
        ).toHaveAttribute("aria-checked", "false");
      });
      /* The other channel on the same row is untouched. */
      expect(
        within(
          screen.getByText("Incident note posted").closest("tr")!,
        ).getByRole("switch", { name: /^SMS:/ }),
      ).toHaveAttribute("aria-checked", "true");
    });

    test("a failed save puts the switch back and says why", async () => {
      jest
        .spyOn(ModelAPI, "updateById")
        .mockRejectedValue(new Error("Preference could not be saved"));

      renderPage();
      const row: HTMLElement = await findEventRow("Incident note posted");
      fireEvent.click(within(row).getByRole("switch", { name: /^Email:/ }));

      expect(
        await screen.findByText("Preference could not be saved"),
      ).toBeVisible();
      await waitFor(() => {
        expect(
          within(
            screen.getByText("Incident note posted").closest("tr")!,
          ).getByRole("switch", { name: /^Email:/ }),
        ).toHaveAttribute("aria-checked", "true");
      });
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
        within(row).getByRole("switch", { name: /^Email:/ }),
      ).toHaveAttribute("aria-checked", "false");
      expect(getList.mock.calls.length).toBeGreaterThan(0);
      for (const call of getList.mock.calls) {
        expect(call[0].query.projectId).toEqual(otherProjectId);
        expect(call[0].query.userId).toEqual(USER_ID);
      }
    });
  });
});
