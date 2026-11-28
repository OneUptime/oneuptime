import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import NotificationChannelReadiness, {
  ChannelReach,
  ChannelReadinessFacts,
  NotificationChannelKey,
  UNKNOWN_CHANNEL_READINESS,
  canChannelReach,
  fetchNotificationChannelReadiness,
  getChannelReach,
  getChannelSetUpRoute,
  getChannelSetUpTab,
  getChannelWord,
  isChannelColumnShown,
  useNotificationChannelReadiness,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationChannelReadiness";
import { NotificationMethodsTab } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodsTabQuery";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMattermost from "../../../Models/DatabaseModels/UserMattermost";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import ObjectID from "../../../Types/ObjectID";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";
import GlobalConfigUtil from "../../../UI/Utils/GlobalConfig";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * CAN THIS CHANNEL REACH YOU YET? (Notification Settings, #8887)
 *
 * A switch on a channel with nothing behind it - no verified phone for SMS,
 * no device for push - turned "on" and sent nothing. The page now asks,
 * channel by channel, whether it can reach the person: Ready, NotSetUp,
 * TurnedOff (the project's paid channels, or push on the server), or
 * Unknown when it could not ask - which is never read as "off". This holds
 * the answer to every combination, the reads it is made from, and where
 * "Set up" sends somebody.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111aa",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-2222222222bb");

const EVERY_PROJECT_CHANNEL_ON: Record<ProjectNotificationChannel, boolean> = {
  [ProjectNotificationChannel.SMS]: true,
  [ProjectNotificationChannel.Call]: true,
  [ProjectNotificationChannel.WhatsApp]: true,
  [ProjectNotificationChannel.Telegram]: true,
};

function facts(
  overrides: Partial<ChannelReadinessFacts> = {},
): ChannelReadinessFacts {
  return {
    verifiedMethodCounts: {},
    projectChannels: EVERY_PROJECT_CHANNEL_ON,
    isPushTurnedOff: false,
    ...overrides,
  };
}

const PAID_CHANNELS: Array<
  [NotificationChannelKey, ProjectNotificationChannel]
> = [
  ["alertBySMS", ProjectNotificationChannel.SMS],
  ["alertByCall", ProjectNotificationChannel.Call],
  ["alertByWhatsApp", ProjectNotificationChannel.WhatsApp],
  ["alertByTelegram", ProjectNotificationChannel.Telegram],
];

const FREE_CHANNELS: Array<NotificationChannelKey> = [
  "alertByEmail",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByMattermost",
  "alertByWebhook",
];

describe("getChannelReach", () => {
  test.each([
    ...FREE_CHANNELS,
    ...PAID_CHANNELS.map(
      ([key]: [
        NotificationChannelKey,
        ProjectNotificationChannel,
      ]): NotificationChannelKey => {
        return key;
      },
    ),
    "alertByPush",
  ] as Array<NotificationChannelKey>)(
    "%s: a verified method and nothing turned off is Ready; none is NotSetUp",
    (channel: NotificationChannelKey) => {
      expect(
        getChannelReach(
          channel,
          facts({ verifiedMethodCounts: { [channel]: 2 } }),
        ),
      ).toBe(ChannelReach.Ready);
      expect(
        getChannelReach(
          channel,
          facts({ verifiedMethodCounts: { [channel]: 0 } }),
        ),
      ).toBe(ChannelReach.NotSetUp);
    },
  );

  test.each(PAID_CHANNELS)(
    "%s: off in the project is TurnedOff, with or without a verified method",
    (
      channel: NotificationChannelKey,
      projectChannel: ProjectNotificationChannel,
    ) => {
      const projectChannels: Record<ProjectNotificationChannel, boolean> = {
        ...EVERY_PROJECT_CHANNEL_ON,
        [projectChannel]: false,
      };

      for (const count of [0, 1]) {
        expect(
          getChannelReach(
            channel,
            facts({
              projectChannels: projectChannels,
              verifiedMethodCounts: { [channel]: count },
            }),
          ),
        ).toBe(ChannelReach.TurnedOff);
      }
    },
  );

  test.each(PAID_CHANNELS)(
    "%s: a project whose switches could not be read leaves it to the methods",
    (channel: NotificationChannelKey) => {
      expect(
        getChannelReach(
          channel,
          facts({
            projectChannels: null,
            verifiedMethodCounts: { [channel]: 1 },
          }),
        ),
      ).toBe(ChannelReach.Ready);
      expect(
        getChannelReach(
          channel,
          facts({
            projectChannels: null,
            verifiedMethodCounts: { [channel]: 0 },
          }),
        ),
      ).toBe(ChannelReach.NotSetUp);
    },
  );

  test("another paid channel being off changes nothing for this one", () => {
    expect(
      getChannelReach(
        "alertBySMS",
        facts({
          projectChannels: {
            ...EVERY_PROJECT_CHANNEL_ON,
            [ProjectNotificationChannel.Call]: false,
          },
          verifiedMethodCounts: { alertBySMS: 1 },
        }),
      ),
    ).toBe(ChannelReach.Ready);
  });

  test("push turned off on the server is TurnedOff, whatever devices there are", () => {
    for (const count of [0, 3]) {
      expect(
        getChannelReach(
          "alertByPush",
          facts({
            isPushTurnedOff: true,
            verifiedMethodCounts: { alertByPush: count },
          }),
        ),
      ).toBe(ChannelReach.TurnedOff);
    }

    // Not known either way: the devices decide.
    expect(
      getChannelReach(
        "alertByPush",
        facts({
          isPushTurnedOff: null,
          verifiedMethodCounts: { alertByPush: 1 },
        }),
      ),
    ).toBe(ChannelReach.Ready);
  });

  test("push turned off never touches any other channel", () => {
    for (const channel of FREE_CHANNELS) {
      expect(
        getChannelReach(
          channel,
          facts({
            isPushTurnedOff: true,
            verifiedMethodCounts: { [channel]: 1 },
          }),
        ),
      ).toBe(ChannelReach.Ready);
    }
  });

  test("methods that could not be counted are Unknown, never NotSetUp", () => {
    for (const channel of [
      ...FREE_CHANNELS,
      "alertBySMS",
      "alertByPush",
    ] as Array<NotificationChannelKey>) {
      expect(
        getChannelReach(
          channel,
          facts({ verifiedMethodCounts: { [channel]: null } }),
        ),
      ).toBe(ChannelReach.Unknown);
      expect(getChannelReach(channel, facts())).toBe(ChannelReach.Unknown);
    }
  });

  test("custom channels are the server's: Ready, whatever is known", () => {
    for (const known of [
      facts(),
      UNKNOWN_CHANNEL_READINESS,
      facts({ isPushTurnedOff: true, projectChannels: null }),
    ]) {
      expect(getChannelReach("alertByCustomChannel", known)).toBe(
        ChannelReach.Ready,
      );
    }
  });

  test("nothing known at all reads every channel as Unknown, but custom channels", () => {
    for (const channel of [
      ...FREE_CHANNELS,
      ...PAID_CHANNELS.map(
        ([key]: [
          NotificationChannelKey,
          ProjectNotificationChannel,
        ]): NotificationChannelKey => {
          return key;
        },
      ),
      "alertByPush",
    ] as Array<NotificationChannelKey>) {
      expect(getChannelReach(channel, UNKNOWN_CHANNEL_READINESS)).toBe(
        ChannelReach.Unknown,
      );
    }
  });
});

describe("what a channel's reach lets the page do", () => {
  test("only Ready and Unknown take new switches", () => {
    expect(canChannelReach(ChannelReach.Ready)).toBe(true);
    expect(canChannelReach(ChannelReach.Unknown)).toBe(true);
    expect(canChannelReach(ChannelReach.NotSetUp)).toBe(false);
    expect(canChannelReach(ChannelReach.TurnedOff)).toBe(false);
  });

  test("a column is shown when its channel can reach the person, or when a switch on it is on", () => {
    for (const reach of Object.values(ChannelReach)) {
      expect(isChannelColumnShown({ reach, isOnForAnEvent: true })).toBe(true);
      expect(isChannelColumnShown({ reach, isOnForAnEvent: false })).toBe(
        canChannelReach(reach),
      );
    }
  });
});

describe("where a channel is set up", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["alertByEmail", NotificationMethodsTab.DirectContact],
    ["alertBySMS", NotificationMethodsTab.DirectContact],
    ["alertByCall", NotificationMethodsTab.DirectContact],
    ["alertByWhatsApp", NotificationMethodsTab.DirectContact],
    ["alertByTelegram", NotificationMethodsTab.DirectContact],
    ["alertBySlack", NotificationMethodsTab.WorkspaceApps],
    ["alertByMicrosoftTeams", NotificationMethodsTab.WorkspaceApps],
    ["alertByMattermost", NotificationMethodsTab.WorkspaceApps],
    ["alertByPush", NotificationMethodsTab.PushNotifications],
    ["alertByWebhook", NotificationMethodsTab.Webhooks],
  ] as Array<[NotificationChannelKey, NotificationMethodsTab]>)(
    "%s is set up on the %s tab of Notification Methods",
    (channel: NotificationChannelKey, tab: NotificationMethodsTab) => {
      expect(getChannelSetUpTab(channel)).toBe(tab);
    },
  );

  test("custom channels are nobody's to set up", () => {
    expect(getChannelSetUpTab("alertByCustomChannel")).toBeNull();
    expect(getChannelSetUpRoute("alertByCustomChannel")).toBeNull();
  });

  test("a Direct Contact channel's link is the page's bare address, with the real project", () => {
    const route: string = getChannelSetUpRoute("alertBySMS")!.toString();

    expect(route).toBe(
      `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-methods`,
    );
    expect(route).not.toContain(":projectId");
  });

  test.each([
    ["alertByPush", "push-notifications"],
    ["alertByWebhook", "webhooks"],
    ["alertBySlack", "workspace-apps"],
  ] as Array<[NotificationChannelKey, string]>)(
    "%s's link opens its tab: ?tab=%s",
    (channel: NotificationChannelKey, slug: string) => {
      expect(getChannelSetUpRoute(channel)!.toString()).toBe(
        `/dashboard/${PROJECT_ID.toString()}/user-settings/notification-methods?tab=${slug}`,
      );
    },
  );

  test("each link is its own: asking for one never changes the next", () => {
    getChannelSetUpRoute("alertByPush");

    expect(getChannelSetUpRoute("alertByEmail")!.toString()).not.toContain(
      "?tab=",
    );
  });
});

describe("a channel's name", () => {
  test("is its word where it has one, its label otherwise", () => {
    expect(getChannelWord({ label: "Call", word: "Call (phone call)" })).toBe(
      "Call (phone call)",
    );
    expect(getChannelWord({ label: "Email" })).toBe("Email");
  });
});

describe("the reads the answer is made from", () => {
  let counts: Map<string, number | Error>;
  let countSpy: SpyInstance<typeof ModelAPI.count>;
  let getItemSpy: SpyInstance<typeof ModelAPI.getItem>;
  let fetchVarsSpy: SpyInstance<typeof GlobalConfigUtil.fetchVars>;

  const MODELS: Array<[NotificationChannelKey, { new (): unknown }]> = [
    ["alertByEmail", UserEmail],
    ["alertBySMS", UserSMS],
    ["alertByCall", UserCall],
    ["alertByPush", UserPush],
    ["alertByWhatsApp", UserWhatsApp],
    ["alertByTelegram", UserTelegram],
    ["alertBySlack", UserSlack],
    ["alertByMicrosoftTeams", UserMicrosoftTeams],
    ["alertByMattermost", UserMattermost],
    ["alertByWebhook", UserWebhook],
  ];

  function modelName(modelType: { new (): unknown }): string {
    return (modelType as { name: string }).name;
  }

  beforeEach(() => {
    counts = new Map();
    countSpy = jest.spyOn(ModelAPI, "count").mockImplementation((async (data: {
      modelType: { new (): unknown };
    }): Promise<number> => {
      const answer: number | Error | undefined = counts.get(
        modelName(data.modelType),
      );

      if (answer instanceof Error) {
        throw answer;
      }

      return answer ?? 0;
    }) as never);
    getItemSpy = jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation((async (): Promise<Project> => {
        const project: Project = new Project();
        project.enableSmsNotifications = true;
        project.enableCallNotifications = false;
        project.enableWhatsAppNotifications = true;
        project.enableTelegramNotifications = false;
        return project;
      }) as never) as unknown as SpyInstance<typeof ModelAPI.getItem>;
    fetchVarsSpy = jest.spyOn(GlobalConfigUtil, "fetchVars").mockResolvedValue({
      disableUserProjectCreation: false,
      disablePushNotifications: true,
      canSendEmail: true,
      canProjectsChooseCallVoice: false,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts the person's verified methods of every channel, in this project", async () => {
    counts.set("UserEmail", 2);
    counts.set("UserSMS", 1);

    const answer: ChannelReadinessFacts =
      await fetchNotificationChannelReadiness({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(answer.verifiedMethodCounts).toEqual({
      alertByEmail: 2,
      alertBySMS: 1,
      alertByCall: 0,
      alertByPush: 0,
      alertByWhatsApp: 0,
      alertByTelegram: 0,
      alertBySlack: 0,
      alertByMicrosoftTeams: 0,
      alertByMattermost: 0,
      alertByWebhook: 0,
    });

    const asked: Array<string> = countSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        return modelName(
          (call[0] as { modelType: { new (): unknown } }).modelType,
        );
      },
    );

    expect(asked.sort()).toEqual(
      MODELS.map(
        ([, model]: [NotificationChannelKey, { new (): unknown }]): string => {
          return modelName(model);
        },
      ).sort(),
    );

    for (const call of countSpy.mock.calls) {
      const data: {
        modelType: { new (): unknown };
        query: Record<string, unknown>;
      } = call[0] as never;

      expect(data.query["projectId"]).toEqual(PROJECT_ID);
      expect(data.query["userId"]).toEqual(USER_ID);
      // A webhook has nothing to verify; every other method must be verified.
      if (modelName(data.modelType) === "UserWebhook") {
        expect(data.query["isVerified"]).toBeUndefined();
      } else {
        expect(data.query["isVerified"]).toBe(true);
      }
    }
  });

  test("reads the project's paid channels and whether the server has push off", async () => {
    const answer: ChannelReadinessFacts =
      await fetchNotificationChannelReadiness({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(answer.projectChannels).toEqual({
      [ProjectNotificationChannel.SMS]: true,
      [ProjectNotificationChannel.Call]: false,
      [ProjectNotificationChannel.WhatsApp]: true,
      [ProjectNotificationChannel.Telegram]: false,
    });
    expect(answer.isPushTurnedOff).toBe(true);
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(fetchVarsSpy).toHaveBeenCalledTimes(1);
  });

  test("a count that fails leaves that channel unknown and answers the others", async () => {
    counts.set("UserSMS", new Error("Permission denied"));
    counts.set("UserEmail", 1);

    const answer: ChannelReadinessFacts =
      await fetchNotificationChannelReadiness({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(answer.verifiedMethodCounts.alertBySMS).toBeNull();
    expect(answer.verifiedMethodCounts.alertByEmail).toBe(1);
    expect(getChannelReach("alertBySMS", answer)).toBe(ChannelReach.Unknown);
  });

  test("a project or a config that cannot be read is unknown, not off", async () => {
    getItemSpy.mockRejectedValue(new Error("Timed out"));
    fetchVarsSpy.mockRejectedValue(new Error("Timed out"));
    counts.set("UserSMS", 1);
    counts.set("UserPush", 1);

    const answer: ChannelReadinessFacts =
      await fetchNotificationChannelReadiness({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(answer.projectChannels).toBeNull();
    expect(answer.isPushTurnedOff).toBeNull();
    expect(getChannelReach("alertBySMS", answer)).toBe(ChannelReach.Ready);
    expect(getChannelReach("alertByPush", answer)).toBe(ChannelReach.Ready);
  });
});

describe("useNotificationChannelReadiness", () => {
  function Reader(props: {
    projectId: ObjectID | null;
    userId: ObjectID | null;
  }): ReactElement {
    const answer: ChannelReadinessFacts | null =
      useNotificationChannelReadiness({
        projectId: props.projectId,
        userId: props.userId,
      });

    return (
      <div data-testid="answer">
        {answer === null
          ? "loading"
          : answer === UNKNOWN_CHANNEL_READINESS
            ? "unknown"
            : JSON.stringify(answer.verifiedMethodCounts)}
      </div>
    );
  }

  afterEach(() => {
    cleanup();
    NotificationChannelReadiness.setFetcher(null);
  });

  test("is null while the answer is on its way, then the answer", async () => {
    let release: () => void = (): void => {
      return undefined;
    };
    const held: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        release = resolve;
      },
    );

    NotificationChannelReadiness.setFetcher(
      async (): Promise<ChannelReadinessFacts> => {
        await held;
        return facts({ verifiedMethodCounts: { alertByEmail: 1 } });
      },
    );

    render(<Reader projectId={PROJECT_ID} userId={USER_ID} />);

    expect(screen.getByTestId("answer")).toHaveTextContent("loading");

    await act(async (): Promise<void> => {
      release();
    });

    expect(screen.getByTestId("answer")).toHaveTextContent(
      '{"alertByEmail":1}',
    );
  });

  test("a read that fails answers that nothing is known, never that nothing is set up", async () => {
    NotificationChannelReadiness.setFetcher(
      async (): Promise<ChannelReadinessFacts> => {
        throw new Error("Network down");
      },
    );

    render(<Reader projectId={PROJECT_ID} userId={USER_ID} />);

    expect(await screen.findByText("unknown")).toBeInTheDocument();
  });

  test("with no project or person there is nothing to ask", async () => {
    const fetcher: Mock<() => Promise<ChannelReadinessFacts>> = jest.fn(
      async (): Promise<ChannelReadinessFacts> => {
        return facts();
      },
    );
    NotificationChannelReadiness.setFetcher(fetcher);

    render(<Reader projectId={null} userId={USER_ID} />);

    expect(await screen.findByText("unknown")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("asks again for another project", async () => {
    const asked: Array<string> = [];

    NotificationChannelReadiness.setFetcher(
      async (data: { projectId: ObjectID }): Promise<ChannelReadinessFacts> => {
        asked.push(data.projectId.toString());
        return facts();
      },
    );

    const { rerender } = render(
      <Reader projectId={PROJECT_ID} userId={USER_ID} />,
    );
    const other: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-3333333333cc",
    );

    await act(async (): Promise<void> => {
      rerender(<Reader projectId={other} userId={USER_ID} />);
    });

    expect(asked).toEqual([PROJECT_ID.toString(), other.toString()]);
  });
});
