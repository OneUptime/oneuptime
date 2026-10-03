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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NO METHOD LIST OFFERS ADD WHILE ITS PROJECT CHANNEL IS OFF.
 *
 * A person's SMS, call, WhatsApp and Telegram lists (User Settings ->
 * Notification Methods) and their incoming call numbers each need a project
 * switch on, and all four switches start off. The server refuses a method on
 * a channel that is off - "SMS notifications are disabled for this project.
 * Please enable them in Project Settings > Notification Settings." - so an
 * Add button there was an invitation to that refusal, on every new project.
 *
 * These render the real lists through the real ModelTable, with only the
 * network stubbed, and pin what a person sees in each state of the channel:
 *   - off: no Add button, anywhere; a quiet panel at the top of the list
 *     holding the channel's switch (for someone who may change it) or one
 *     sentence (for everyone else); rows already added stay listed, and a
 *     code the server would refuse to send again is not offered;
 *   - on: Add, and nothing else new;
 *   - still loading: neither Add nor the panel, so neither appears and then
 *     vanishes under the reader;
 *   - could not be read: Add, as before - the server has the last word.
 * And turning the channel on from the panel brings Add without a reload.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the consts above are still in their temporal dead
 * zone when the factory body runs.
 */
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import SMSMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS";
import CallMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call";
import WhatsAppMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/WhatsApp";
import TelegramMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram";
import IncomingCallNumberMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/IncomingCallNumber";
import {
  NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
  NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationChannelOffPanel";
import ProjectNotificationChannelsStore from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import {
  ChannelGatedMethodList,
  ChannelGatedMethodListDefinition,
  EnabledProjectChannels,
  getChannelGatedMethodList,
  getProjectNotificationChannel,
  ProjectNotificationChannel,
  ProjectNotificationChannelDefinition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const UNVERIFIED_ID: string = "11111111-7777-4777-8777-777777777777";

interface MethodList {
  name: string;
  list: ChannelGatedMethodList;
  Component: () => ReactElement;
  modelType: DatabaseBaseModelType;
  // The identifying columns of a row.
  columns: JSONObject;
  // The row action that sends a new code.
  codeActionTitle: string;
  // Whether the server refuses that action while the channel is off.
  isCodeActionRefusedWhileOff: boolean;
  // The empty list's heading while the channel is on.
  usualEmptyTitle: string;
}

const METHOD_LISTS: Array<MethodList> = [
  {
    name: "SMS",
    list: ChannelGatedMethodList.SMS,
    Component: SMSMethods,
    modelType: UserSMS,
    columns: { phone: new Phone("+15551230100") as never },
    codeActionTitle: "Resend Code",
    isCodeActionRefusedWhileOff: true,
    usualEmptyTitle: "No phone numbers found",
  },
  {
    name: "Call",
    list: ChannelGatedMethodList.Call,
    Component: CallMethods,
    modelType: UserCall,
    columns: { phone: new Phone("+15551230199") as never },
    codeActionTitle: "Resend Code",
    isCodeActionRefusedWhileOff: true,
    usualEmptyTitle: "No phone numbers found",
  },
  {
    name: "WhatsApp",
    list: ChannelGatedMethodList.WhatsApp,
    Component: WhatsAppMethods,
    modelType: UserWhatsApp,
    columns: { phone: new Phone("+15551230123") as never },
    codeActionTitle: "Resend Code",
    isCodeActionRefusedWhileOff: false,
    usualEmptyTitle: "No WhatsApp numbers found",
  },
  {
    name: "Telegram",
    list: ChannelGatedMethodList.Telegram,
    Component: TelegramMethods,
    modelType: UserTelegram,
    columns: { telegramUserHandle: "@alexchen" },
    codeActionTitle: "Rotate Code",
    isCodeActionRefusedWhileOff: false,
    usualEmptyTitle: "No Telegram accounts linked",
  },
  {
    name: "Incoming call numbers",
    list: ChannelGatedMethodList.IncomingCallNumber,
    Component: IncomingCallNumberMethods,
    modelType: UserIncomingCallNumber,
    columns: { phone: new Phone("+15551230177") as never },
    codeActionTitle: "Resend Code",
    isCodeActionRefusedWhileOff: true,
    usualEmptyTitle: "No phone numbers found",
  },
];

const ALL_ON: EnabledProjectChannels = {
  [ProjectNotificationChannel.SMS]: true,
  [ProjectNotificationChannel.Call]: true,
  [ProjectNotificationChannel.WhatsApp]: true,
  [ProjectNotificationChannel.Telegram]: true,
};

const ALL_OFF: EnabledProjectChannels = {
  [ProjectNotificationChannel.SMS]: false,
  [ProjectNotificationChannel.Call]: false,
  [ProjectNotificationChannel.WhatsApp]: false,
  [ProjectNotificationChannel.Telegram]: false,
};

const signIn: (permissions: Array<Permission>) => void = (
  permissions: Array<Permission>,
): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem("is_master_admin", "false");
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  localStorage.setItem(
    "project_permissions",
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission) => {
        return { permission: permission };
      }),
    }),
  );
};

type ListResultJSON = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

const unverifiedRow: (list: MethodList) => BaseModel = (
  list: MethodList,
): BaseModel => {
  const model: BaseModel = new list.modelType();
  model.id = new ObjectID(UNVERIFIED_ID);

  const columns: JSONObject = { ...list.columns, isVerified: false };

  for (const columnName of Object.keys(columns)) {
    (model as unknown as Record<string, unknown>)[columnName] =
      columns[columnName];
  }

  return model;
};

const respondWithRows: (list: MethodList, rows: Array<BaseModel>) => void = (
  list: MethodList,
  rows: Array<BaseModel>,
): void => {
  getListMock.mockImplementation((params: any): Promise<ListResultJSON> => {
    return Promise.resolve({
      data: params.modelType === list.modelType ? rows : [],
      count: params.modelType === list.modelType ? rows.length : 0,
      skip: 0,
      limit: 50,
    });
  });
};

const theChannel: (list: MethodList) => ProjectNotificationChannelDefinition = (
  list: MethodList,
): ProjectNotificationChannelDefinition => {
  return getProjectNotificationChannel(
    getChannelGatedMethodList(list.list).channel,
  );
};

const withChannel: (
  list: MethodList,
  isOn: boolean,
) => EnabledProjectChannels = (
  list: MethodList,
  isOn: boolean,
): EnabledProjectChannels => {
  return { ...(isOn ? ALL_OFF : ALL_ON), [theChannel(list).channel]: isOn };
};

/*
 * The project row the lists' shared read gets back. Every other channel is
 * set the other way, so a list reading the wrong switch shows it.
 */
const respondWithChannels: (enabled: EnabledProjectChannels) => void = (
  enabled: EnabledProjectChannels,
): void => {
  getItemMock.mockImplementation((params: any): Promise<unknown> => {
    if (params.modelType !== Project) {
      return Promise.resolve(null);
    }

    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.enableSmsNotifications = enabled[ProjectNotificationChannel.SMS];
    project.enableCallNotifications = enabled[ProjectNotificationChannel.Call];
    project.enableWhatsAppNotifications =
      enabled[ProjectNotificationChannel.WhatsApp];
    project.enableTelegramNotifications =
      enabled[ProjectNotificationChannel.Telegram];

    return Promise.resolve(project);
  });
};

// Every button that adds a method: the card's and the empty list's.
const addButtons: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByRole("button").filter((button: HTMLElement) => {
    return (
      (button.textContent || "").trim().startsWith("Add ") ||
      button.getAttribute("data-testid") === "empty-table-create-button"
    );
  });
};

// The list has drawn its rows, or said it has none.
const waitForList: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(
      screen.queryAllByTestId("row-actions").length +
        screen.queryAllByTestId(/-no-items$/).length,
    ).toBeGreaterThan(0);
  });

  // And the shared read has answered (or not), and every effect has run.
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

const menuLabelsOf: (rowActions: HTMLElement) => Array<string> = (
  rowActions: HTMLElement,
): Array<string> => {
  const trigger: HTMLElement | null = within(rowActions).queryByTestId(
    "row-actions-more-button",
  );

  if (!trigger) {
    return [];
  }

  fireEvent.click(trigger);

  const labels: Array<string> = within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });

  fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Escape" });

  return labels;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  ProjectNotificationChannelsStore.reset();
  ProjectNotificationChannelsStore.setFetcher(null);

  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  getCommonHeadersMock.mockReset();

  getCommonHeadersMock.mockReturnValue({});
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  signIn([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectNotificationChannelsStore.setFetcher(null);
});

describe.each(METHOD_LISTS)("$name", (list: MethodList) => {
  const definition: () => ChannelGatedMethodListDefinition =
    (): ChannelGatedMethodListDefinition => {
      return getChannelGatedMethodList(list.list);
    };

  test("while its channel is off it offers no Add button, anywhere, and says so at the top of the list", async () => {
    respondWithChannels(withChannel(list, false));
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons()).toEqual([]);

    const panel: HTMLElement = screen.getByTestId(
      NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
    );

    // Inside the list's own card, above the table.
    expect(screen.getByTestId("card")).toContainElement(panel);
    expect(panel).toHaveTextContent(definition().switchOffDescription);
    expect(
      within(panel).getByRole("switch", { name: theChannel(list).title }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("while its channel is off the empty list does not ask the reader to add one", async () => {
    respondWithChannels(withChannel(list, false));
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(
      screen.getByText(definition().noItemsWhileOff.replace(/\.$/, "")),
    ).toBeInTheDocument();
    expect(screen.queryByText(list.usualEmptyTitle)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Please add one");
  });

  test("someone who may not turn the channel on gets one sentence saying who can, and still no Add", async () => {
    signIn([Permission.ProjectMember]);
    respondWithChannels(withChannel(list, false));
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons()).toEqual([]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.getByTestId(NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID),
    ).toHaveTextContent(definition().offSentence);
  });

  test("while its channel is on it offers Add, and nothing new is drawn", async () => {
    respondWithChannels(withChannel(list, true));
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons().length).toBeGreaterThan(0);
    expect(
      screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByText(list.usualEmptyTitle)).toBeInTheDocument();
  });

  test("while the answer is on its way it offers neither Add nor the panel", async () => {
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((): void => {});
    });
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons()).toEqual([]);
    expect(
      screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("when the channel could not be read it offers Add as before, and the server decides", async () => {
    getItemMock.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("Could not read the project."));
    });
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons().length).toBeGreaterThan(0);
    expect(
      screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a method added before the channel went off stays listed, and can still be verified", async () => {
    respondWithChannels(withChannel(list, false));
    respondWithRows(list, [unverifiedRow(list)]);

    render(<list.Component />);
    await waitForList();

    const [row] = screen.getAllByTestId("row-actions");

    expect(
      within(row!).getByRole("button", { name: "Verify" }),
    ).toBeInTheDocument();

    const labels: Array<string> = menuLabelsOf(row!);

    if (list.isCodeActionRefusedWhileOff) {
      // The server refuses to send a code while the channel is off.
      expect(labels).not.toContain(list.codeActionTitle);
    } else {
      expect(labels).toContain(list.codeActionTitle);
    }
  });

  test("with the channel on, the unverified row offers its code action", async () => {
    respondWithChannels(withChannel(list, true));
    respondWithRows(list, [unverifiedRow(list)]);

    render(<list.Component />);
    await waitForList();

    const [row] = screen.getAllByTestId("row-actions");

    expect(menuLabelsOf(row!)).toContain(list.codeActionTitle);
  });

  test("turned on from the panel, Add appears at once and the panel stays, saying it is on", async () => {
    respondWithChannels(withChannel(list, false));
    respondWithRows(list, []);

    render(<list.Component />);
    await waitForList();

    expect(addButtons()).toEqual([]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", { name: theChannel(list).title }),
      );
    });

    await waitFor(() => {
      expect(addButtons().length).toBeGreaterThan(0);
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ [theChannel(list).column]: true });

    const panel: HTMLElement = screen.getByTestId(
      NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
    );

    expect(panel).toHaveTextContent(definition().switchOnDescription);
    expect(
      within(panel).getByRole("switch", { name: theChannel(list).title }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

test("the four Direct Contact lists share one read of the project", async () => {
  respondWithChannels(ALL_OFF);
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 50,
  } as never);

  render(
    <div>
      <SMSMethods />
      <CallMethods />
      <WhatsAppMethods />
      <TelegramMethods />
    </div>,
  );

  await waitFor(() => {
    expect(
      screen.getAllByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toHaveLength(4);
  });

  const projectReads: Array<unknown> = getItemMock.mock.calls.filter(
    (call: Array<any>): boolean => {
      return call[0].modelType === Project;
    },
  );

  expect(projectReads).toHaveLength(1);
  expect(addButtons()).toEqual([]);
});
