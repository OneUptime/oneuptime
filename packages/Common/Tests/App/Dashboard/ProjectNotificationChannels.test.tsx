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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A project's four notification channels - SMS, phone calls, WhatsApp and
 * Telegram - start off, and only a project owner (or someone who manages
 * billing) may turn them on. The server refuses a method on a channel that
 * is off, so the first phone number a responder added on a new project was
 * a refusal pointing at a settings page most of them may not change, where
 * the four switches sat behind an Edit button and a two-step dialog.
 *
 * This covers the shared pieces that fixed that:
 *   - which channels are on (ProjectNotificationChannels): one read shared
 *     by everything on screen, "could not check" never read as "off", and a
 *     switch saved anywhere on the screen heard at once;
 *   - the panel that replaces a list's Add button while its channel is off
 *     (NotificationChannelOffPanel): the switch itself for those who may
 *     change it, one sentence for everyone else;
 *   - the Notification Channels card on Project Settings: four switches that
 *     save in place, locked for anyone the server would refuse.
 *
 * Only the network and the plan are stubbed. The permission gate, the
 * switch row and the Toggle are the real ones, reading the signed-in
 * person's permissions from storage as the dashboard does.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __projectChannelsConfig: MutableConfig }
).__projectChannelsConfig = config;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __projectChannelsConfig: MutableConfig | undefined;
          }
        ).__projectChannelsConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

import NotificationChannelOffPanel, {
  getProjectChannelSwitchTestId,
  NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
  NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationChannelOffPanel";
import ProjectNotificationChannelsStore, {
  fetchProjectNotificationChannels,
  getProjectChannelState,
  getProjectNotificationChannelsSelect,
  isAddingOffered,
  isCodeResendOffered,
  ProjectChannelState,
  ProjectNotificationChannels,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import ProjectNotificationChannelsCard, {
  PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCard";
import ProjectNotificationChannelsCopy, {
  CHANNEL_GATED_METHOD_LISTS,
  ChannelGatedMethodList,
  ChannelGatedMethodListDefinition,
  EnabledProjectChannels,
  getChannelGatedMethodList,
  getDisabledProjectChannels,
  getProjectNotificationChannel,
  PROJECT_NOTIFICATION_CHANNELS,
  ProjectNotificationChannel,
  ProjectNotificationChannelDefinition,
  readEnabledProjectChannels,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID: string = "eeeeeeee-5555-4555-8555-555555555555";
const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";

const ALL_OFF: EnabledProjectChannels = {
  [ProjectNotificationChannel.SMS]: false,
  [ProjectNotificationChannel.Call]: false,
  [ProjectNotificationChannel.WhatsApp]: false,
  [ProjectNotificationChannel.Telegram]: false,
};

const ALL_ON: EnabledProjectChannels = {
  [ProjectNotificationChannel.SMS]: true,
  [ProjectNotificationChannel.Call]: true,
  [ProjectNotificationChannel.WhatsApp]: true,
  [ProjectNotificationChannel.Telegram]: true,
};

/*
 * The session the components read themselves out of: the signed-in person,
 * their permissions in the project, and the project this tab shows.
 */
interface Session {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}

const signIn: (session: Session) => void = (session: Session): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem(
    "is_master_admin",
    String(Boolean(session.isMasterAdmin)),
  );
  sessionStorage.setItem("current_project_id", PROJECT_ID);

  /*
   * Every signed-in person holds these: CurrentUser is what lets someone
   * add, read and delete their own methods.
   */
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
    "project_permissions",
    JSON.stringify({
      projectId: PROJECT_ID,
      permissions: session.permissions.map((permission: Permission) => {
        return { permission: permission };
      }),
    }),
  );
};

const signInAsOwner: () => void = (): void => {
  signIn({ permissions: [Permission.ProjectOwner] });
};

const projectWith: (enabled: EnabledProjectChannels) => Project = (
  enabled: EnabledProjectChannels,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  project.enableSmsNotifications = enabled[ProjectNotificationChannel.SMS];
  project.enableCallNotifications = enabled[ProjectNotificationChannel.Call];
  project.enableWhatsAppNotifications =
    enabled[ProjectNotificationChannel.WhatsApp];
  project.enableTelegramNotifications =
    enabled[ProjectNotificationChannel.Telegram];
  return project;
};

// A promise and the means to settle it from the test.
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const defer: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise: Promise<T> = new Promise<T>(
    (yes: (value: T) => void, no: (error: Error) => void): void => {
      resolve = yes;
      reject = no;
    },
  );

  return { promise, resolve, reject };
};

const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  config.billingEnabled = false;
  PermissionGate.clearPermissionPropsCache();

  ProjectNotificationChannelsStore.reset();
  ProjectNotificationChannelsStore.setFetcher(null);

  getItemMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  signInAsOwner();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectNotificationChannelsStore.setFetcher(null);
});

describe("the four channels", () => {
  test("are SMS, phone calls, WhatsApp and Telegram, each a boolean Project column that starts off", () => {
    const project: Project = new Project();

    expect(
      PROJECT_NOTIFICATION_CHANNELS.map(
        (definition: ProjectNotificationChannelDefinition) => {
          return [definition.channel, definition.column, definition.title];
        },
      ),
    ).toEqual([
      [ProjectNotificationChannel.SMS, "enableSmsNotifications", "SMS"],
      [
        ProjectNotificationChannel.Call,
        "enableCallNotifications",
        "Phone Calls",
      ],
      [
        ProjectNotificationChannel.WhatsApp,
        "enableWhatsAppNotifications",
        "WhatsApp",
      ],
      [
        ProjectNotificationChannel.Telegram,
        "enableTelegramNotifications",
        "Telegram",
      ],
    ]);

    for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
      expect([
        definition.column,
        project.getTableColumnMetadata(definition.column)?.defaultValue,
      ]).toEqual([definition.column, false]);
    }
  });

  test("only project owners and billing managers may change them, which is why most responders cannot", () => {
    const project: Project = new Project();

    for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
      expect([
        definition.column,
        [
          ...(project.getColumnAccessControlFor(definition.column)?.update ||
            []),
        ]
          .map((permission: Permission): string => {
            return permission;
          })
          .sort(),
      ]).toEqual([
        definition.column,
        [Permission.ProjectOwner, Permission.ManageProjectBilling].sort(),
      ]);
    }
  });

  test("their names are the readiness method types, so the checklist and readiness agree", () => {
    expect(Object.values(ProjectNotificationChannel)).toEqual([
      "SMS",
      "Call",
      "WhatsApp",
      "Telegram",
    ]);
  });

  test("a code is refused again only for SMS and calls while they are off, as the services do", () => {
    expect(
      PROJECT_NOTIFICATION_CHANNELS.filter(
        (definition: ProjectNotificationChannelDefinition): boolean => {
          return definition.isCodeResendRefusedWhileOff;
        },
      ).map((definition: ProjectNotificationChannelDefinition) => {
        return definition.channel;
      }),
    ).toEqual([
      ProjectNotificationChannel.SMS,
      ProjectNotificationChannel.Call,
    ]);
  });

  test("an unknown channel is refused loudly", () => {
    expect(() => {
      return getProjectNotificationChannel(
        "Carrier Pigeon" as ProjectNotificationChannel,
      );
    }).toThrow();

    expect(() => {
      return getChannelGatedMethodList(
        "Fax" as unknown as ChannelGatedMethodList,
      );
    }).toThrow();
  });
});

describe("reading which channels are on", () => {
  test("from a project row, only a true column is on and a missing one reads as its default, off", () => {
    expect(
      readEnabledProjectChannels({
        enableSmsNotifications: true,
        enableCallNotifications: false,
        enableWhatsAppNotifications: "true",
      }),
    ).toEqual({
      ...ALL_OFF,
      [ProjectNotificationChannel.SMS]: true,
    });

    expect(readEnabledProjectChannels({})).toEqual(ALL_OFF);
  });

  test("lists the channels that are off in order", () => {
    expect(getDisabledProjectChannels(ALL_ON)).toEqual([]);
    expect(getDisabledProjectChannels(ALL_OFF)).toEqual([
      ProjectNotificationChannel.SMS,
      ProjectNotificationChannel.Call,
      ProjectNotificationChannel.WhatsApp,
      ProjectNotificationChannel.Telegram,
    ]);
    expect(
      getDisabledProjectChannels({
        ...ALL_ON,
        [ProjectNotificationChannel.WhatsApp]: false,
      }),
    ).toEqual([ProjectNotificationChannel.WhatsApp]);
  });

  test.each([
    [{ enabled: ALL_ON, error: null }, ProjectChannelState.On],
    [{ enabled: ALL_OFF, error: null }, ProjectChannelState.Off],
    [{ enabled: null, error: null }, ProjectChannelState.Loading],
    [{ enabled: null, error: "Nope" }, ProjectChannelState.Unknown],
    // A failed re-read keeps what was known.
    [{ enabled: ALL_OFF, error: "Nope" }, ProjectChannelState.Off],
  ] as Array<[ProjectNotificationChannels, ProjectChannelState]>)(
    "%j reads as %s for SMS",
    (channels: ProjectNotificationChannels, expected: ProjectChannelState) => {
      expect(
        getProjectChannelState(channels, ProjectNotificationChannel.SMS),
      ).toBe(expected);
    },
  );

  test("Add is offered while a channel is on, and when its state could not be read; not while off or still loading", () => {
    expect(isAddingOffered(ProjectChannelState.On)).toBe(true);
    expect(isAddingOffered(ProjectChannelState.Unknown)).toBe(true);
    expect(isAddingOffered(ProjectChannelState.Off)).toBe(false);
    expect(isAddingOffered(ProjectChannelState.Loading)).toBe(false);
  });

  test("a code is offered again unless the server would refuse it", () => {
    for (const state of Object.values(ProjectChannelState)) {
      for (const channel of Object.values(ProjectNotificationChannel)) {
        const isRefused: boolean =
          state === ProjectChannelState.Off &&
          (channel === ProjectNotificationChannel.SMS ||
            channel === ProjectNotificationChannel.Call);

        expect([channel, state, isCodeResendOffered(channel, state)]).toEqual([
          channel,
          state,
          !isRefused,
        ]);
      }
    }
  });

  test("the read asks the current project for the four switches and nothing else", async () => {
    getItemMock.mockResolvedValue(
      projectWith({
        ...ALL_OFF,
        [ProjectNotificationChannel.Call]: true,
      }) as never,
    );

    await expect(
      fetchProjectNotificationChannels(new ObjectID(PROJECT_ID)),
    ).resolves.toEqual({ ...ALL_OFF, [ProjectNotificationChannel.Call]: true });

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Project);
    expect((request["id"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(request["select"]).toEqual({
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
    });
    expect(getProjectNotificationChannelsSelect()).toEqual(request["select"]);
  });

  test("no row is a read that told nothing, never 'every channel off'", async () => {
    getItemMock.mockResolvedValue(null as never);

    await expect(
      fetchProjectNotificationChannels(new ObjectID(PROJECT_ID)),
    ).rejects.toThrow("Could not read this project's notification channels.");
  });
});

describe("one answer for everything on screen", () => {
  test("asks once for every asker that arrives while a request is out", async () => {
    const answer: Deferred<EnabledProjectChannels> =
      defer<EnabledProjectChannels>();
    const fetcher: MockFunction = getJestMockFunction();
    fetcher.mockImplementation(() => {
      return answer.promise;
    });
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    const first: Promise<void> =
      ProjectNotificationChannelsStore.load(PROJECT_ID);
    const second: Promise<void> =
      ProjectNotificationChannelsStore.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toBeNull();

    answer.resolve(ALL_ON);
    await Promise.all([first, second]);

    expect(ProjectNotificationChannelsStore.getChannels(PROJECT_ID)).toEqual({
      enabled: ALL_ON,
      error: null,
    });
  });

  test("asks again for a later asker - an owner may have turned a channel on since - keeping what was known meanwhile", async () => {
    const fetcher: MockFunction = getJestMockFunction();
    fetcher.mockResolvedValueOnce(ALL_OFF as never);
    const second: Deferred<EnabledProjectChannels> =
      defer<EnabledProjectChannels>();
    fetcher.mockImplementationOnce(() => {
      return second.promise;
    });
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    await ProjectNotificationChannelsStore.load(PROJECT_ID);

    const again: Promise<void> =
      ProjectNotificationChannelsStore.load(PROJECT_ID);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual(ALL_OFF);

    second.resolve({ ...ALL_OFF, [ProjectNotificationChannel.SMS]: true });
    await again;

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual({ ...ALL_OFF, [ProjectNotificationChannel.SMS]: true });
  });

  test("a failed read keeps what was known and says why", async () => {
    const fetcher: MockFunction = getJestMockFunction();
    fetcher.mockResolvedValueOnce(ALL_ON as never);
    fetcher.mockRejectedValueOnce(new Error("Network down") as never);
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    await ProjectNotificationChannelsStore.load(PROJECT_ID);
    await ProjectNotificationChannelsStore.load(PROJECT_ID);

    expect(ProjectNotificationChannelsStore.getChannels(PROJECT_ID)).toEqual({
      enabled: ALL_ON,
      error: "Network down",
    });
  });

  test("a failed first read is Unknown, not Off", async () => {
    ProjectNotificationChannelsStore.setFetcher((async () => {
      throw new Error("Refused");
    }) as never);

    await ProjectNotificationChannelsStore.load(PROJECT_ID);

    expect(
      getProjectChannelState(
        ProjectNotificationChannelsStore.getChannels(PROJECT_ID),
        ProjectNotificationChannel.SMS,
      ),
    ).toBe(ProjectChannelState.Unknown);
  });

  test("outside a project nothing is asked and the server decides", async () => {
    const fetcher: MockFunction = getJestMockFunction();
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    await ProjectNotificationChannelsStore.load(null);

    expect(fetcher).not.toHaveBeenCalled();
    expect(
      getProjectChannelState(
        ProjectNotificationChannelsStore.getChannels(null),
        ProjectNotificationChannel.SMS,
      ),
    ).toBe(ProjectChannelState.Unknown);
  });

  test("a recorded answer wins over a read that was already out, so a saved switch is never put back", async () => {
    const stale: Deferred<EnabledProjectChannels> =
      defer<EnabledProjectChannels>();
    ProjectNotificationChannelsStore.setFetcher((() => {
      return stale.promise;
    }) as never);

    const read: Promise<void> =
      ProjectNotificationChannelsStore.load(PROJECT_ID);

    ProjectNotificationChannelsStore.record(PROJECT_ID, ALL_ON);

    stale.resolve(ALL_OFF);
    await read;

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual(ALL_ON);
  });

  test("a Project switch saved anywhere on the screen moves that project's channel, and nothing else", async () => {
    ProjectNotificationChannelsStore.setFetcher((async () => {
      return ALL_OFF;
    }) as never);

    const unsubscribe: () => void = ProjectNotificationChannelsStore.subscribe(
      (): void => {},
    );

    await ProjectNotificationChannelsStore.load(PROJECT_ID);

    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(PROJECT_ID),
      column: "enableWhatsAppNotifications",
      value: true,
    });

    // Not a channel column, another record, another table: ignored.
    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(PROJECT_ID),
      column: "requireSsoForLogin",
      value: true,
    });
    announceModelSwitchSaved({
      modelType: StatusPage,
      modelId: new ObjectID(PROJECT_ID),
      column: "enableSmsNotifications",
      value: true,
    });

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual({ ...ALL_OFF, [ProjectNotificationChannel.WhatsApp]: true });
    expect(
      ProjectNotificationChannelsStore.getChannels(OTHER_PROJECT_ID).enabled,
    ).toBeNull();

    unsubscribe();
  });

  test("a switch saved while nothing is known asks again instead of guessing the other three", async () => {
    const fetcher: MockFunction = getJestMockFunction();
    fetcher.mockRejectedValueOnce(new Error("Network down") as never);
    fetcher.mockResolvedValue(ALL_ON as never);
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    // The first read failed: nothing is known.
    await ProjectNotificationChannelsStore.load(PROJECT_ID);

    ProjectNotificationChannelsStore.recordChannel(
      PROJECT_ID,
      ProjectNotificationChannel.SMS,
      true,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);

    await flush();

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual(ALL_ON);
  });

  test("a switch saved for a project nothing on the page asked about is left alone", () => {
    const fetcher: MockFunction = getJestMockFunction();
    ProjectNotificationChannelsStore.setFetcher(fetcher as never);

    ProjectNotificationChannelsStore.recordChannel(
      OTHER_PROJECT_ID,
      ProjectNotificationChannel.SMS,
      true,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(
      ProjectNotificationChannelsStore.getChannels(OTHER_PROJECT_ID).enabled,
    ).toBeNull();
  });

  /*
   * The Notification Channels card reads the row itself and records it; no
   * list on its page subscribes. Its own switches must still move the store,
   * or the lists would open on the answer from before the flip.
   */
  test("a page that only records what it read hears its own switches, with nothing subscribed", () => {
    ProjectNotificationChannelsStore.record(PROJECT_ID, ALL_OFF);

    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(PROJECT_ID),
      column: "enableCallNotifications",
      value: true,
    });

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toEqual({ ...ALL_OFF, [ProjectNotificationChannel.Call]: true });
  });

  test("forgetting everything also stops listening, until the store is used again", () => {
    ProjectNotificationChannelsStore.record(PROJECT_ID, ALL_OFF);
    ProjectNotificationChannelsStore.reset();

    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(PROJECT_ID),
      column: "enableSmsNotifications",
      value: true,
    });

    expect(
      ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
    ).toBeNull();
  });
});

describe("the panel at the top of a list while its channel is off", () => {
  const renderPanel: (
    list: ChannelGatedMethodList,
    state: ProjectChannelState,
  ) => void = (
    list: ChannelGatedMethodList,
    state: ProjectChannelState,
  ): void => {
    render(<NotificationChannelOffPanel list={list} state={state} />);
  };

  const LISTS: Array<[string, ChannelGatedMethodListDefinition]> =
    CHANNEL_GATED_METHOD_LISTS.map(
      (
        definition: ChannelGatedMethodListDefinition,
      ): [string, ChannelGatedMethodListDefinition] => {
        return [definition.list, definition];
      },
    );

  test.each([
    ProjectChannelState.On,
    ProjectChannelState.Loading,
    ProjectChannelState.Unknown,
  ])("draws nothing while the channel is %s", (state: ProjectChannelState) => {
    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      renderPanel(definition.list, state);

      expect(
        screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();

      cleanup();
    }
  });

  test.each(LISTS)(
    "%s, for a project owner: the channel's own switch, off, saying what off means",
    (_list: string, definition: ChannelGatedMethodListDefinition) => {
      renderPanel(definition.list, ProjectChannelState.Off);

      const channel: ProjectNotificationChannelDefinition =
        getProjectNotificationChannel(definition.channel);

      const panel: HTMLElement = screen.getByTestId(
        NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
      );

      const theSwitch: HTMLElement = within(panel).getByRole("switch", {
        name: channel.title,
      });

      expect(theSwitch).toHaveAttribute("aria-checked", "false");
      expect(theSwitch).toHaveAttribute(
        "data-testid",
        getProjectChannelSwitchTestId(channel.column),
      );
      expect(panel).toHaveTextContent(definition.switchOffDescription);
      expect(
        screen.queryByTestId(NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("a quiet panel, not a red banner, and no pointer to another page", () => {
    renderPanel(ChannelGatedMethodList.SMS, ProjectChannelState.Off);

    const panel: HTMLElement = screen.getByTestId(
      NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(panel.className).toContain("bg-gray-50");
    expect(panel.className).toContain("border-gray-200");
    expect(panel.className).not.toMatch(/\bbg-red-|\bborder-red-|\bbg-yellow-/);
    expect(panel).not.toHaveTextContent("Project Settings");
    expect(panel).not.toHaveTextContent("disabled");
  });

  test.each(LISTS)(
    "%s: turning it on saves the project's column, then says it is on and stays",
    async (_list: string, definition: ChannelGatedMethodListDefinition) => {
      renderPanel(definition.list, ProjectChannelState.Off);

      const channel: ProjectNotificationChannelDefinition =
        getProjectNotificationChannel(definition.channel);

      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: channel.title }));
      });

      await waitFor(() => {
        expect(
          screen.getByRole("switch", { name: channel.title }),
        ).toHaveAttribute("aria-checked", "true");
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = updateByIdMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(Project);
      expect((request["id"] as ObjectID).toString()).toBe(PROJECT_ID);
      expect(request["data"]).toEqual({ [channel.column]: true });

      const panel: HTMLElement = screen.getByTestId(
        NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID,
      );

      expect(panel).toHaveTextContent(definition.switchOnDescription);
      expect(panel).not.toHaveTextContent(definition.switchOffDescription);
    },
  );

  test("stays on screen when the list learns the channel is on, saying Saved", async () => {
    const { rerender } = render(
      <NotificationChannelOffPanel
        list={ChannelGatedMethodList.SMS}
        state={ProjectChannelState.Off}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "SMS" }));
    });

    // The list hears the save (ModelSwitchEvents) and redraws with On.
    rerender(
      <NotificationChannelOffPanel
        list={ChannelGatedMethodList.SMS}
        state={ProjectChannelState.On}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${getProjectChannelSwitchTestId("enableSmsNotifications")}-status`,
        ),
      ).toHaveTextContent("Saved");
    });

    expect(screen.getByRole("switch", { name: "SMS" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a refused save moves the switch back and says why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to update this Project.");
    });

    renderPanel(ChannelGatedMethodList.Telegram, ProjectChannelState.Off);

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Telegram" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You do not have permission to update this Project.",
      );
    });

    expect(screen.getByRole("switch", { name: "Telegram" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toHaveTextContent(
      getChannelGatedMethodList(ChannelGatedMethodList.Telegram)
        .switchOffDescription,
    );
  });

  test.each([
    ["a project admin", [Permission.ProjectAdmin]],
    ["someone who may edit the project", [Permission.EditProject]],
    ["a project member", [Permission.ProjectMember]],
  ] as Array<[string, Array<Permission>]>)(
    "%s, whom the server would refuse, gets one sentence and no switch",
    (_who: string, permissions: Array<Permission>) => {
      signIn({ permissions: permissions });

      for (const definition of CHANNEL_GATED_METHOD_LISTS) {
        renderPanel(definition.list, ProjectChannelState.Off);

        expect(screen.queryByRole("switch")).not.toBeInTheDocument();
        expect(
          screen.getByTestId(NOTIFICATION_CHANNEL_OFF_SENTENCE_TEST_ID),
        ).toHaveTextContent(definition.offSentence);

        cleanup();
      }
    },
  );

  test("someone who manages billing may change it, so gets the switch", () => {
    signIn({ permissions: [Permission.ManageProjectBilling] });

    renderPanel(ChannelGatedMethodList.Call, ProjectChannelState.Off);

    expect(
      screen.getByRole("switch", { name: "Phone Calls" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a master admin, with no project permission at all, gets the switch", () => {
    signIn({ permissions: [], isMasterAdmin: true });

    renderPanel(ChannelGatedMethodList.WhatsApp, ProjectChannelState.Off);

    expect(
      screen.getByRole("switch", { name: "WhatsApp" }),
    ).toBeInTheDocument();
  });

  test("the sentence names who can turn it on", () => {
    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      expect(definition.offSentence).toMatch(
        /is off in this project\. A project owner can turn (it|them) on\.$|which is off in this project\. A project owner can turn it on\.$|are off in this project\. A project owner can turn them on\.$/,
      );
    }
  });

  test("incoming call numbers are verified by text, so their list carries the SMS switch with its own words", () => {
    const definition: ChannelGatedMethodListDefinition =
      getChannelGatedMethodList(ChannelGatedMethodList.IncomingCallNumber);

    expect(definition.channel).toBe(ProjectNotificationChannel.SMS);

    renderPanel(
      ChannelGatedMethodList.IncomingCallNumber,
      ProjectChannelState.Off,
    );

    expect(screen.getByRole("switch", { name: "SMS" })).toHaveAttribute(
      "data-testid",
      getProjectChannelSwitchTestId("enableSmsNotifications"),
    );
    expect(
      screen.getByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toHaveTextContent(definition.switchOffDescription);
    expect(definition.switchOffDescription).toContain("verified by SMS");
  });

  test("where OneUptime bills for messages, the switch says what the channel costs", () => {
    config.billingEnabled = true;

    renderPanel(ChannelGatedMethodList.SMS, ProjectChannelState.Off);

    expect(
      screen.getByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toHaveTextContent(
      getProjectNotificationChannel(ProjectNotificationChannel.SMS).balanceNote,
    );

    cleanup();

    renderPanel(ChannelGatedMethodList.Telegram, ProjectChannelState.Off);

    expect(
      screen.getByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
    ).toHaveTextContent("Paid from the project's balance.");
  });

  test("a self-hosted install bills nothing, so says nothing about a balance", () => {
    config.billingEnabled = false;

    for (const definition of CHANNEL_GATED_METHOD_LISTS) {
      renderPanel(definition.list, ProjectChannelState.Off);

      expect(
        screen.getByTestId(NOTIFICATION_CHANNEL_OFF_PANEL_TEST_ID),
      ).not.toHaveTextContent("balance");

      cleanup();
    }
  });
});

describe("the Notification Channels card on Project Settings", () => {
  const renderCard: () => Promise<void> = async (): Promise<void> => {
    render(<ProjectNotificationChannelsCard />);

    await waitFor(() => {
      expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    });
  };

  test("reads the current project's four switches and draws one row each, in order, as they are", async () => {
    getItemMock.mockResolvedValue(
      projectWith({
        ...ALL_OFF,
        [ProjectNotificationChannel.Call]: true,
      }) as never,
    );

    await renderCard();

    const card: HTMLElement = screen.getByTestId(
      PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID,
    );

    expect(
      within(card)
        .getAllByRole("switch")
        .map((element: HTMLElement): [string | null, string | null] => {
          return [
            element.getAttribute("data-testid"),
            element.getAttribute("aria-checked"),
          ];
        }),
    ).toEqual([
      [getProjectChannelSwitchTestId("enableSmsNotifications"), "false"],
      [getProjectChannelSwitchTestId("enableCallNotifications"), "true"],
      [getProjectChannelSwitchTestId("enableWhatsAppNotifications"), "false"],
      [getProjectChannelSwitchTestId("enableTelegramNotifications"), "false"],
    ]);

    for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
      expect(
        within(card).getByRole("switch", { name: definition.title }),
      ).toBeInTheDocument();
      expect(card).toHaveTextContent(definition.description);
    }

    expect(
      screen.getByText(ProjectNotificationChannelsCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ProjectNotificationChannelsCopy.cardDescription),
    ).toBeInTheDocument();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect((request["id"] as ObjectID).toString()).toBe(PROJECT_ID);
  });

  test("has no Edit button and no dialog: a switch saves its one column the moment it is flipped", async () => {
    getItemMock.mockResolvedValue(projectWith(ALL_OFF) as never);

    await renderCard();

    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "WhatsApp" }));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${getProjectChannelSwitchTestId("enableWhatsAppNotifications")}-status`,
        ),
      ).toHaveTextContent("Saved");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ enableWhatsAppNotifications: true });
  });

  test("what it read, and every save, is what the method lists on screen go by", async () => {
    getItemMock.mockResolvedValue(projectWith(ALL_OFF) as never);

    await renderCard();

    expect(ProjectNotificationChannelsStore.getChannels(PROJECT_ID)).toEqual({
      enabled: ALL_OFF,
      error: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "SMS" }));
    });

    await waitFor(() => {
      expect(
        ProjectNotificationChannelsStore.getChannels(PROJECT_ID).enabled,
      ).toEqual({ ...ALL_OFF, [ProjectNotificationChannel.SMS]: true });
    });
  });

  test.each([
    ["a project admin", [Permission.ProjectAdmin]],
    ["someone who may edit the project", [Permission.EditProject]],
  ] as Array<[string, Array<Permission>]>)(
    "%s - handed an Edit button by the old card, refused on save - sees every switch locked, with the permission it needs",
    async (_who: string, permissions: Array<Permission>) => {
      signIn({ permissions: permissions });
      getItemMock.mockResolvedValue(projectWith(ALL_OFF) as never);

      await renderCard();

      for (const element of screen.getAllByRole("switch")) {
        expect(element).toHaveAttribute("aria-disabled", "true");
      }

      expect(
        screen.getAllByText(/You need one of these permissions: Project Owner/)
          .length,
      ).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: "SMS" }));
      });

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(screen.getByRole("switch", { name: "SMS" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    },
  );

  test("a failed read says why, and Refresh reads again", async () => {
    getItemMock.mockRejectedValueOnce(new Error("Could not reach the server"));
    getItemMock.mockResolvedValueOnce(projectWith(ALL_ON) as never);

    await renderCard();

    expect(screen.getByText("Could not reach the server")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(screen.getAllByRole("switch")).toHaveLength(4);
    });

    for (const element of screen.getAllByRole("switch")) {
      expect(element).toHaveAttribute("aria-checked", "true");
    }
  });

  test("says what each channel costs only where OneUptime bills for it", async () => {
    getItemMock.mockResolvedValue(projectWith(ALL_OFF) as never);

    config.billingEnabled = true;
    await renderCard();

    const card: HTMLElement = screen.getByTestId(
      PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID,
    );

    expect(card).toHaveTextContent(
      "Paid from the project's balance, unless the project has its own Twilio Config.",
    );

    cleanup();

    config.billingEnabled = false;
    await renderCard();

    expect(
      screen.getByTestId(PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID),
    ).not.toHaveTextContent("balance");
  });
});
