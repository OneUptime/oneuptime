import "@testing-library/jest-dom";
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
import NotificationSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import EmailNoiseCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/EmailNoiseCard";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserNotificationEmailRollupSetting from "../../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("notification email preferences", () => {
  let rows: Array<UserNotificationSetting>;
  let post: jest.SpyInstance;
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
          if (data.modelType === UserNotificationEmailRollupSetting) {
            return { data: [], count: 0 };
          }
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
    post = jest
      .spyOn(API, "post")
      .mockImplementation(async (): Promise<any> => {
        rows = rows.map(
          (row: UserNotificationSetting): UserNotificationSetting => {
            const copy: UserNotificationSetting = Object.assign(
              new UserNotificationSetting(),
              row,
            );
            if (ROUTINE_EMAIL_EVENT_TYPES.includes(copy.eventType!)) {
              copy.alertByEmail = false;
            }
            return copy;
          },
        );
        return new HTTPResponse(200, { success: true }, {});
      });
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

  test("offers reduction without changing preferences on page load", async () => {
    renderPage();
    await findEventRow("Incident created");
    expect(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    ).toBeEnabled();
    expect(screen.getByText(/Applies to you in this project/)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  test("reloads preferences and clears the old success message when switching projects", async () => {
    const { rerender } = render(
      <NotificationSettings
        pageRoute={new Route("/user-settings/notification-settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
    await findEventRow("Incident created");
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    await screen.findByRole("status");
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
    expect(
      within(row).getByRole("switch", { name: /^Email:/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.queryByText(
        "Routine emails turned off. Review or change individual preferences below.",
      ),
    ).not.toBeInTheDocument();
    expect(getList.mock.calls.length).toBeGreaterThan(0);
    for (const call of getList.mock.calls) {
      expect(call[0].query.projectId).toEqual(otherProjectId);
      expect(call[0].query.userId).toEqual(USER_ID);
    }
  });

  test("applies once, refreshes visible settings, and preserves urgent emails and SMS", async () => {
    renderPage();
    const before: HTMLElement = await findEventRow("Incident note posted");
    expect(
      within(before).getByRole("switch", { name: /^Email:/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    await screen.findByRole("status");
    await waitFor(() => {
      const after: HTMLElement = screen
        .getByText("Incident note posted")
        .closest("tr")!;
      expect(
        within(after).getByRole("switch", { name: /^Email:/ }),
      ).toHaveAttribute("aria-checked", "false");
      expect(
        within(after).getByRole("switch", { name: /^SMS:/ }),
      ).toHaveAttribute("aria-checked", "true");
    });
    const urgent: HTMLElement = await findEventRow("Incident created");
    expect(
      within(urgent).getByRole("switch", { name: /^Email:/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].url.toString()).toContain(
      "/user-notification-setting/reduce-routine-emails",
    );
    expect(post.mock.calls[0][0].data).toEqual({});
    expect(post.mock.calls[0][0].headers).toEqual({
      tenantid: PROJECT_ID.toString(),
    });
  });

  test("does not reenable an urgent email the user had already disabled", async () => {
    rows.find((row: UserNotificationSetting): boolean => {
      return (
        row.eventType ===
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION
      );
    })!.alertByEmail = false;
    renderPage();
    await findEventRow("Incident created");
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    await screen.findByRole("status");
    const urgent: HTMLElement = await findEventRow("Incident created");
    expect(
      within(urgent).getByRole("switch", { name: /^Email:/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("disables repeated submission and channel edits while the action is pending", async () => {
    let resolveRequest!: (response: HTTPResponse<any>) => void;
    post.mockReturnValue(
      new Promise<HTTPResponse<any>>(
        (resolve: (response: HTTPResponse<any>) => void): void => {
          resolveRequest = resolve;
        },
      ),
    );
    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    const saving: HTMLElement = screen.getByRole("button", {
      name: "Saving email preferences…",
    });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(within(row).getByRole("switch", { name: /^Email:/ })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      resolveRequest(new HTTPResponse(200, { success: true }, {}));
    });
    await screen.findByRole("status");
  });

  test("waits for an earlier individual save before allowing the routine preset", async () => {
    rows.find((row: UserNotificationSetting): boolean => {
      return (
        row.eventType ===
        NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION
      );
    })!.alertByEmail = false;
    let finishSave!: (response: HTTPResponse<any>) => void;
    const save: jest.SpyInstance = jest
      .spyOn(ModelAPI, "updateById")
      .mockReturnValue(
        new Promise<HTTPResponse<any>>(
          (resolve: (response: HTTPResponse<any>) => void): void => {
            finishSave = resolve;
          },
        ),
      );
    renderPage();
    const row: HTMLElement = await findEventRow("Incident note posted");
    fireEvent.click(within(row).getByRole("switch", { name: /^Email:/ }));
    expect(save).toHaveBeenCalledTimes(1);
    const reduce: HTMLElement = screen.getByRole("button", {
      name: "Reduce routine emails",
    });
    expect(reduce).toBeDisabled();
    fireEvent.click(reduce);
    expect(post).not.toHaveBeenCalled();
    await act(async () => {
      finishSave(new HTTPResponse(200, {}, {}));
    });
    await waitFor(() => {
      expect(reduce).toBeEnabled();
    });
    fireEvent.click(reduce);
    await screen.findByRole("status");
    const updated: HTMLElement = await findEventRow("Incident note posted");
    expect(
      within(updated).getByRole("switch", { name: /^Email:/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(post).toHaveBeenCalledTimes(1);
  });

  test.each(["resolved HTTP error", "network rejection"])(
    "shows %s, keeps settings, and allows retry",
    async (kind: string) => {
      if (kind === "resolved HTTP error") {
        post.mockResolvedValueOnce(
          new HTTPErrorResponse(
            503,
            { message: "Preferences could not be saved" },
            {},
          ),
        );
      } else {
        post.mockRejectedValueOnce(new Error("Preferences could not be saved"));
      }
      renderPage();
      await findEventRow("Incident note posted");
      const readsBefore: number = getList.mock.calls.length;
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Preferences could not be saved",
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(getList).toHaveBeenCalledTimes(readsBefore);
      const row: HTMLElement = await findEventRow("Incident note posted");
      expect(
        within(row).getByRole("switch", { name: /^Email:/ }),
      ).toHaveAttribute("aria-checked", "true");
      fireEvent.click(
        screen.getByRole("button", { name: "Reduce routine emails" }),
      );
      await screen.findByRole("status");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

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
    const eventReads: Array<any> = getList.mock.calls
      .map((call: Array<any>): any => {
        return call[0];
      })
      .filter((call: any): boolean => {
        return call.modelType === UserNotificationSetting;
      });
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

  test("the reduction card can be used again after an individual preference change", async () => {
    const apply: jest.Mock = jest.fn().mockResolvedValue(undefined);
    render(<EmailNoiseCard onApply={apply} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    await screen.findByRole("status");
    fireEvent.click(
      screen.getByRole("button", { name: "Reduce routine emails" }),
    );
    await waitFor(() => {
      expect(apply).toHaveBeenCalledTimes(2);
    });
  });
});
