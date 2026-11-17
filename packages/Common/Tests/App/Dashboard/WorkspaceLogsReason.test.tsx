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
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * #7121: THE WORKSPACE LOGS TABLE SAYS WHY A POST FAILED, IN THE ROW.
 *
 * The Workspace Logs table listed Channel, User, Sent at, Status and
 * Workspace; a post's reason was only under its row's ⋯ > View Status
 * Message, one row at a time. Now a Reason column, after Status, shows an
 * Error row's reason - the workspace's refusal in OneUptime's words
 * (#7119) - two lines at most, the whole of it under the pointer. A row
 * that went out shows the quiet dash. A row written before the refusals
 * were worded ("Error from Slack is_archived") reads as a new one does.
 * (How it folds on a narrow table and a phone: WorkspaceLogsReasonFolds.)
 *
 * The real table, over a fake ModelAPI, in English, German and Arabic.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "71210000-0000-4000-8000-000000000301";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import WorkspaceRefusal, {
  MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL,
  SLACK_BOT_NOT_IN_CHANNEL_REFUSAL,
  SLACK_CHANNEL_ARCHIVED_REFUSAL,
} from "../../../Utils/Workspace/WorkspaceRefusal";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import {
  WORKSPACE_LOG_REASON_TEST_ID,
  getWorkspaceLogStatusText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogReason";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

// A post Slack refused, as the server words it now.
const ARCHIVED: WorkspaceNotificationLog = Object.assign(
  new WorkspaceNotificationLog(),
  {
    _id: "71210000-0000-4000-8000-000000000311",
    workspaceType: WorkspaceType.Slack,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Error,
    channelName: "old-incidents",
    statusMessage: WorkspaceRefusal.describeSlackRefusal("is_archived"),
    createdAt: new Date("2026-11-14T09:00:00Z"),
  },
);

// One written before the refusals were worded: Slack's code alone.
const OLD_ROW: WorkspaceNotificationLog = Object.assign(
  new WorkspaceNotificationLog(),
  {
    _id: "71210000-0000-4000-8000-000000000312",
    workspaceType: WorkspaceType.Slack,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Error,
    channelName: "private-ops",
    statusMessage: "Error from Slack not_in_channel",
    createdAt: new Date("2026-11-14T09:01:00Z"),
  },
);

// A post that went out.
const POSTED: WorkspaceNotificationLog = Object.assign(
  new WorkspaceNotificationLog(),
  {
    _id: "71210000-0000-4000-8000-000000000313",
    workspaceType: WorkspaceType.Slack,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Success,
    channelName: "incidents",
    statusMessage: "Message posted to workspace channel",
    createdAt: new Date("2026-11-14T09:02:00Z"),
  },
);

const LOGS: Array<WorkspaceNotificationLog> = [ARCHIVED, OLD_ROW, POSTED];

// The column's title, as each language words it.
const REASON_TITLES: Record<string, string> = {
  en: "Reason",
  de: "Grund",
  ar: "السبب",
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of Object.keys(REASON_TITLES)) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/settings/workspace-connection-logs`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          options.modelType === WorkspaceNotificationLog ? LOGS : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return options.modelType === WorkspaceNotificationLog ? LOGS.length : 0;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

async function openLogs(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  await act(async () => {
    render(
      <MemoryRouter>
        <WorkspaceLogsTable />
      </MemoryRouter>,
    );
  });

  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  expect(await screen.findByText("old-incidents")).toBeInTheDocument();
}

// The row a log's channel is drawn in.
function rowOf(channel: string): HTMLElement {
  return screen.getByText(channel).closest("tr") as HTMLElement;
}

// The cell of a row under the column of this title.
function cellUnder(row: HTMLElement, title: string): HTMLElement {
  const table: HTMLElement = row.closest("table") as HTMLElement;
  const headers: Array<HTMLElement> = Array.from(
    table.querySelectorAll("thead th"),
  ) as Array<HTMLElement>;
  const index: number = headers.findIndex((header: HTMLElement): boolean => {
    return (header.textContent || "").trim() === title;
  });

  expect(index).toBeGreaterThanOrEqual(0);

  return row.querySelectorAll("td")[index] as HTMLElement;
}

describe("the Workspace Logs table's Reason column", () => {
  test("an Error row says why, in the row, after its Status", async () => {
    await openLogs("en");

    const headerTitles: Array<string> = Array.from(
      document.querySelectorAll("thead th"),
    ).map((header: Element): string => {
      return (header.textContent || "").trim();
    });

    expect(headerTitles.indexOf("Reason")).toBe(
      headerTitles.indexOf("Status") + 1,
    );

    const reason: HTMLElement = cellUnder(rowOf("old-incidents"), "Reason");

    expect(
      within(reason).getByTestId(WORKSPACE_LOG_REASON_TEST_ID),
    ).toHaveTextContent(SLACK_CHANNEL_ARCHIVED_REFUSAL.reason);
    // Slack's code is support's, under the pointer: not in the row.
    expect(reason).not.toHaveTextContent("is_archived");
    expect(within(reason).getByTitle(/Slack said: is_archived\.$/)).toBe(
      within(reason).getByTestId(WORKSPACE_LOG_REASON_TEST_ID),
    );
  });

  test("REGRESSION: an old row's raw code reads in words, as a new row does", async () => {
    await openLogs("en");

    const reason: HTMLElement = cellUnder(rowOf("private-ops"), "Reason");

    expect(reason).toHaveTextContent(SLACK_BOT_NOT_IN_CHANNEL_REFUSAL.reason);
    expect(reason).not.toHaveTextContent("Error from Slack");
  });

  test("a row that went out has no reason: the quiet dash", async () => {
    await openLogs("en");

    const reason: HTMLElement = cellUnder(rowOf("incidents"), "Reason");

    expect(within(reason).getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeVisible();
    expect(reason).not.toHaveTextContent("Message posted");
  });

  test("the Status column says Error and Success as chips, and the reason only for an Error", async () => {
    await openLogs("en");

    expect(cellUnder(rowOf("old-incidents"), "Status")).toHaveTextContent(
      "Error",
    );
    expect(cellUnder(rowOf("incidents"), "Status")).toHaveTextContent(
      "Success",
    );
  });

  test.each(["de", "ar"])(
    "the column's title reads in the reader's language: %s",
    async (language: string) => {
      await openLogs(language);

      const titles: Array<string> = Array.from(
        document.querySelectorAll("thead th"),
      ).map((header: Element): string => {
        return (header.textContent || "").trim();
      });

      expect(titles).toContain(REASON_TITLES[language]);
      expect(titles).not.toContain("Reason");
    },
  );

  test("the table says it lists Mattermost's posts too", async () => {
    await openLogs("en");

    expect(
      screen.getByText(
        "Slack, Microsoft Teams and Mattermost messages sent for this project.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Messages sent to Slack / Teams.")).toBeNull();
  });

  test("View Status Message shows an old row's whole reason in words, with Slack's code", async () => {
    await openLogs("en");

    const row: HTMLElement = rowOf("private-ops");
    const more: HTMLElement | undefined = within(row)
      .queryAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return (
          (button.getAttribute("aria-label") || button.textContent || "")
            .toLowerCase()
            .includes("status message") ||
          (button.getAttribute("aria-label") || "")
            .toLowerCase()
            .includes("more")
        );
      });

    expect(more).toBeDefined();

    await act(async () => {
      fireEvent.click(more!);
    });

    const statusMessage: HTMLElement | null = screen.queryByText(
      "View Status Message",
    );

    if (statusMessage) {
      await act(async () => {
        fireEvent.click(statusMessage);
      });
    }

    expect(
      await screen.findByText(
        WorkspaceRefusal.describeSlackRefusal("not_in_channel"),
      ),
    ).toBeInTheDocument();
  });
});

describe("what a row's status message reads as", () => {
  test("a Teams refusal: OneUptime's words, Teams' answer after them", () => {
    const message: string = WorkspaceRefusal.describeMicrosoftTeamsRefusal({
      statusCode: 429,
      code: "Throttled",
    });

    expect(
      getWorkspaceLogStatusText({
        status: WorkspaceNotificationStatus.Error,
        statusMessage: message,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(message);
    expect(
      message.startsWith(MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL.reason),
    ).toBe(true);
  });

  test("a row that went out keeps its message as written", () => {
    expect(
      getWorkspaceLogStatusText({
        status: WorkspaceNotificationStatus.Success,
        statusMessage: "Message posted to workspace channel",
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Message posted to workspace channel");
  });
});

describe("every Dashboard language", () => {
  test("words the column's title and the table's description", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        "Reason",
        "Slack, Microsoft Teams and Mattermost messages sent for this project.",
        "Slack, Microsoft Teams and Mattermost messages sent for this {{itemName}}.",
      ]) {
        expect({
          language,
          key,
          worded: Boolean(words[key]) && words[key] !== key,
        }).toEqual({ language, key, worded: true });
      }
    }
  });
});
