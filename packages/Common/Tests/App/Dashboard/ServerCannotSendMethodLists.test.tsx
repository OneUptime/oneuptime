import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NOTIFICATION METHODS SAY WHEN THIS SERVER CANNOT REACH THEM (#6880, #7151).
 *
 * On a self-hosted server that cannot send email, every email address in
 * User Settings > Notification Methods read as if a page would reach it,
 * and an on-call rule "email me" paged nobody. On one with no Twilio
 * account, a member typed a phone number and was refused only at Add -
 * after an owner had turned SMS on, and read "Saved".
 *
 * Any member now reads whether a page can reach these methods
 * (GET /project-can-send): three yes-or-noes, never why. These render the
 * real lists through the real ModelTable, the network stubbed, and pin what
 * a person sees:
 *
 *   - a channel the server cannot reach: one line at the top of the list,
 *     naming the server's admin - a master admin is sent to the Admin
 *     Dashboard instead - and no Add, before anything is typed; the line
 *     comes before the project's own switch, which would change nothing;
 *   - a channel it reaches, or an answer not known: the list as it was;
 *   - the project's Notification Channels card: a warning under the SMS and
 *     Phone Calls switches while no SMS or call can go anywhere.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const fetchMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      fetch: (...args: Array<any>) => {
        return fetchMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import EmailMethods, {
  NO_EMAIL_ADDRESSES_YET,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Email";
import SMSMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS";
import CallMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call";
import { NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationChannelOffPanel";
import ProjectNotificationChannelsCard, {
  SERVER_CANNOT_SEND_CHANNEL_WARNINGS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCard";
import ProjectNotificationChannelsStore from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import { ProjectNotificationChannel } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import ServerCannotSendPanel, {
  ADMIN_CALL_AND_SMS_SETTINGS_ROUTE,
  SERVER_CANNOT_SEND_COPY,
  SERVER_CANNOT_SEND_PANEL_TEST_ID,
  ServerCannotSendChannel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ServerCannotSendPanel";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Permission from "../../../Types/Permission";
import {
  PROJECT_CAN_SEND_API_PATH,
  ProjectCanSendAnswer,
} from "../../../Types/ServerSending/ProjectCanSend";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { getProjectPermissionsStorageKey } from "../../../UI/Utils/Permission";
import { ProjectCanSendLoader } from "../../../UI/Utils/ServerSending";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const signIn: (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean;
}) => void = (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean;
}): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem(
    "is_master_admin",
    data.isMasterAdmin ? "true" : "false",
  );
  sessionStorage.setItem("current_project_id", PROJECT_ID);

  localStorage.setItem(
    "global_permissions",
    JSON.stringify({
      _type: "UserGlobalAccessPermission",
      projectIds: [],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    }),
  );
  localStorage.setItem(
    getProjectPermissionsStorageKey(PROJECT_ID)!,
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: data.permissions.map((permission: Permission) => {
        return { permission: permission };
      }),
    }),
  );
};

// What GET /project-can-send answers this page.
const answerCanSend: (answer: ProjectCanSendAnswer | "refused") => void = (
  answer: ProjectCanSendAnswer | "refused",
): void => {
  fetchMock.mockImplementation(async (): Promise<unknown> => {
    return answer === "refused"
      ? new HTTPErrorResponse(404, { error: "Not found" }, {})
      : new HTTPResponse(200, { ...answer }, {});
  });
};

// Every channel on for the project, so only the server decides.
const respondWithChannels: (isOn: boolean) => void = (isOn: boolean): void => {
  getItemMock.mockImplementation((params: any): Promise<unknown> => {
    if (params.modelType !== Project) {
      return Promise.resolve(null);
    }

    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.enableSmsNotifications = isOn;
    project.enableCallNotifications = isOn;
    project.enableWhatsAppNotifications = isOn;
    project.enableTelegramNotifications = isOn;

    return Promise.resolve(project);
  });
};

const addButtons: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByRole("button").filter((button: HTMLElement) => {
    return (
      (button.textContent || "").trim().startsWith("Add ") ||
      button.getAttribute("data-testid") === "empty-table-create-button"
    );
  });
};

const waitForList: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(
      screen.queryAllByTestId("row-actions").length +
        screen.queryAllByTestId(/-no-items$/).length,
    ).toBeGreaterThan(0);
  });

  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
  });
};

const CAN_SEND_EVERYTHING: ProjectCanSendAnswer = {
  email: true,
  sms: true,
  call: true,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  ProjectNotificationChannelsStore.reset();
  ProjectNotificationChannelsStore.setFetcher(null);
  ProjectCanSendLoader.clear();

  for (const mock of [
    getMock,
    postMock,
    fetchMock,
    getListMock,
    getItemMock,
    updateByIdMock,
    getCommonHeadersMock,
  ]) {
    mock.mockReset();
  }

  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 50 };
  });
  respondWithChannels(true);
  answerCanSend(CAN_SEND_EVERYTHING);

  signIn({ permissions: [Permission.ProjectMember] });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectNotificationChannelsStore.setFetcher(null);
});

const LISTS: Array<{
  name: string;
  channel: ServerCannotSendChannel;
  Component: () => ReactElement;
  cannotSend: ProjectCanSendAnswer;
  isChannelGated: boolean;
}> = [
  {
    name: "SMS",
    channel: ServerCannotSendChannel.SMS,
    Component: SMSMethods,
    cannotSend: { email: true, sms: false, call: true },
    isChannelGated: true,
  },
  {
    name: "Call",
    channel: ServerCannotSendChannel.Call,
    Component: CallMethods,
    cannotSend: { email: true, sms: true, call: false },
    isChannelGated: true,
  },
  {
    name: "Email",
    channel: ServerCannotSendChannel.Email,
    Component: EmailMethods,
    cannotSend: { email: false, sms: true, call: true },
    isChannelGated: false,
  },
];

describe.each(LISTS)("the $name list", (list: (typeof LISTS)[number]) => {
  test("a channel this server cannot reach: the server's admin is named at the top, and no Add is offered", async () => {
    answerCanSend(list.cannotSend);

    render(<list.Component />);
    await waitForList();

    const panel: HTMLElement = screen.getByTestId(
      SERVER_CANNOT_SEND_PANEL_TEST_ID,
    );

    expect(panel).toHaveTextContent(
      SERVER_CANNOT_SEND_COPY[list.channel].member,
    );
    // Inside the list's own card, above the table.
    expect(screen.getByTestId("card")).toContainElement(panel);
    expect(addButtons()).toEqual([]);
    // A member is sent to nobody's Admin Dashboard.
    expect(
      screen.queryByTestId(`${SERVER_CANNOT_SEND_PANEL_TEST_ID}-fix`),
    ).toBeNull();
  });

  test("a channel it reaches: the list as it always was, with Add", async () => {
    render(<list.Component />);
    await waitForList();

    expect(screen.queryByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID)).toBeNull();
    expect(addButtons().length).toBeGreaterThan(0);
  });

  test("an answer that could not be read - an older server - says nothing, and Add is offered", async () => {
    answerCanSend("refused");

    render(<list.Component />);
    await waitForList();

    expect(screen.queryByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID)).toBeNull();
    expect(addButtons().length).toBeGreaterThan(0);
  });

  test("a master admin is sent to the Admin Dashboard, where they fix it", async () => {
    signIn({ permissions: [Permission.ProjectOwner], isMasterAdmin: true });
    answerCanSend(list.cannotSend);

    render(<list.Component />);
    await waitForList();

    expect(
      screen.getByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID),
    ).toHaveTextContent(SERVER_CANNOT_SEND_COPY[list.channel].admin);

    const fix: HTMLElement = screen.getByTestId(
      `${SERVER_CANNOT_SEND_PANEL_TEST_ID}-fix`,
    );

    expect(fix).toHaveAttribute(
      "href",
      expect.stringContaining(
        list.channel === ServerCannotSendChannel.Email
          ? "/settings/smtp"
          : ADMIN_CALL_AND_SMS_SETTINGS_ROUTE,
      ),
    );
    expect(fix).toHaveAttribute("target", "_blank");
  });
});

describe("the SMS list while the project has SMS off too", () => {
  test("the server comes first: the project's switch would change nothing", async () => {
    respondWithChannels(false);
    answerCanSend({ email: true, sms: false, call: false });

    render(<SMSMethods />);
    await waitForList();

    expect(
      screen.getByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toBeNull();
    expect(addButtons()).toEqual([]);
  });
});

describe("the email list while no email can be sent", () => {
  test("its empty state does not ask for an address that could never be verified", async () => {
    answerCanSend({ email: false, sms: true, call: true });

    render(<EmailMethods />);
    await waitForList();

    const empty: string = screen
      .queryAllByTestId(/-no-items$/)
      .map((element: HTMLElement) => {
        return element.textContent || "";
      })
      .join(" ");

    // The empty state draws the sentence as its heading, without its full stop.
    expect(empty).toContain(NO_EMAIL_ADDRESSES_YET.replace(/\.$/, ""));
    expect(empty).not.toContain("Add one to receive notifications");
  });
});

describe("the request", () => {
  test("asks for the project the tab shows, once for every list on the page", async () => {
    render(
      <>
        <EmailMethods />
        <SMSMethods />
        <CallMethods />
      </>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string }; headers: unknown } =
      fetchMock.mock.calls[0]![0] as never;

    expect(request.url.toString()).toContain(PROJECT_CAN_SEND_API_PATH);
    expect(request.headers).toEqual({ tenantid: PROJECT_ID });
  });
});

describe("the project's Notification Channels card", () => {
  test("warns under SMS and Phone Calls while no SMS or call can go anywhere, before the switch is flipped", async () => {
    signIn({ permissions: [Permission.ProjectOwner] });
    respondWithChannels(false);
    answerCanSend({ email: true, sms: false, call: false });

    render(<ProjectNotificationChannelsCard />);

    await waitFor(() => {
      expect(
        screen.getByText(SERVER_CANNOT_SEND_CHANNEL_WARNINGS.sms),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(SERVER_CANNOT_SEND_CHANNEL_WARNINGS.call),
    ).toBeInTheDocument();
  });

  test("says nothing of the server while SMS and calls go out, or it is not known", async () => {
    signIn({ permissions: [Permission.ProjectOwner] });
    answerCanSend({ email: true, sms: true, call: false });

    render(<ProjectNotificationChannelsCard />);

    await waitFor(() => {
      expect(
        screen.getByText(SERVER_CANNOT_SEND_CHANNEL_WARNINGS.call),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(SERVER_CANNOT_SEND_CHANNEL_WARNINGS.sms),
    ).toBeNull();
  });

  test("its warnings are the project's SMS and call switches' only", () => {
    expect(Object.keys(SERVER_CANNOT_SEND_CHANNEL_WARNINGS).sort()).toEqual([
      "call",
      "sms",
    ]);
    expect(ProjectNotificationChannel.SMS).toBeDefined();
  });
});

describe("in the reader's language", () => {
  async function renderIn(
    locale: string,
    channel: ServerCannotSendChannel,
  ): Promise<HTMLElement> {
    const words: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, `${locale}.json`), "utf8"),
    ) as Record<string, string>;
    const instance: i18n = createInstance();

    await instance.init({
      lng: locale,
      fallbackLng: "en",
      resources: { [locale]: { translation: words } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    render(
      <I18nextProvider i18n={instance}>
        <ServerCannotSendPanel channel={channel} canSend={false} />
      </I18nextProvider>,
    );

    return screen.getByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID);
  }

  test.each([
    ["de", ServerCannotSendChannel.SMS],
    ["fa", ServerCannotSendChannel.Email],
  ])(
    "in %s, the %s panel's words, never English",
    async (locale: string, channel: ServerCannotSendChannel) => {
      const words: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      const panel: HTMLElement = await renderIn(locale, channel);

      expect(panel).toHaveTextContent(
        words[SERVER_CANNOT_SEND_COPY[channel].member] as string,
      );
      expect(panel).not.toHaveTextContent("This server can't");
    },
  );

  test("draws nothing while the answer is not known, or the server reaches the channel", () => {
    for (const canSend of [true, null, undefined]) {
      const { container } = render(
        <ServerCannotSendPanel
          channel={ServerCannotSendChannel.Email}
          canSend={canSend}
        />,
      );

      expect(
        within(container).queryByTestId(SERVER_CANNOT_SEND_PANEL_TEST_ID),
      ).toBeNull();
      cleanup();
    }
  });
});
