import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { getShownChannelKeys } from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import {
  SetupSection,
  SetupStep,
  SetupStepStatus,
  WorkspaceProbe,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import useSetupChecklist, {
  NotificationSettingProbes,
  SETTING_CHANNELS,
  SettingChannel,
  SetupChecklistState,
  WorkspaceProbes,
  getNotificationSettingProbes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * THE SETUP CHECKLIST AND THE CHAT WORKSPACES' COLUMNS.
 *
 * Its Staying informed section read seven of Notification Settings' columns, and
 * Slack, Microsoft Teams and Mattermost were not among them. So a switch turned
 * on in one of those columns with no account behind it was never named, though
 * it sends nothing, and somebody who hears of their shift only in Slack was told
 * "No channel is switched on".
 *
 * The page shows those columns only while the project has the workspace
 * connected, and a hidden column keeps what was saved. So the checklist holds a
 * reader only to the columns they can see. When it could not ask, it leaves the
 * step out rather than claim anything about a column it could not place.
 */

type ChannelColumn = SettingChannel["column"];

const ROSTER_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER;
const OTHER_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

const ALL_WORKSPACES: Array<WorkspaceType> = [
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
  WorkspaceType.Mattermost,
];

const CONNECTED: WorkspaceProbe = {
  isKnown: true,
  isConnectedForProject: true,
  isConnectedForUser: true,
};
const NOT_CONNECTED: WorkspaceProbe = {
  isKnown: true,
  isConnectedForProject: false,
  isConnectedForUser: false,
};
const COULD_NOT_ASK: WorkspaceProbe = {
  isKnown: false,
  isConnectedForProject: false,
  isConnectedForUser: false,
};

// The same answer for all three workspaces.
function everyWorkspace(probe: WorkspaceProbe): WorkspaceProbes {
  return {
    [WorkspaceType.Slack]: probe,
    [WorkspaceType.MicrosoftTeams]: probe,
    [WorkspaceType.Mattermost]: probe,
  };
}

function setting(
  switchedOn: Array<ChannelColumn>,
  eventType: NotificationSettingEventType = OTHER_EVENT,
): UserNotificationSetting {
  const row: UserNotificationSetting = new UserNotificationSetting();
  row.eventType = eventType;

  for (const channel of SETTING_CHANNELS) {
    (row as unknown as Record<string, boolean>)[channel.column as string] =
      switchedOn.includes(channel.column);
  }

  return row;
}

function probes(data: {
  rows: Array<UserNotificationSetting>;
  usable?: Array<string>;
  workspaces: WorkspaceProbes;
}): NotificationSettingProbes {
  return getNotificationSettingProbes({
    rows: data.rows,
    usableMethodTypes: new Set<string>(data.usable || []),
    workspaces: data.workspaces,
  });
}

const WORKSPACE_CHANNELS: Array<[string, ChannelColumn, string]> = [
  ["Slack", "alertBySlack", "Slack"],
  ["Microsoft Teams", "alertByMicrosoftTeams", "Microsoft Teams"],
  ["Mattermost", "alertByMattermost", "Mattermost"],
];

describe("the channels the checklist reads", () => {
  test("are the page's columns, in its order, but for the custom channels'", () => {
    expect(
      SETTING_CHANNELS.map((channel: SettingChannel): string => {
        return channel.column as string;
      }),
    ).toEqual(getShownChannelKeys(ALL_WORKSPACES, false));
  });

  test.each(ALL_WORKSPACES)(
    "%s's channel is the column the page shows for that workspace",
    (workspaceType: WorkspaceType) => {
      const added: Array<string> = getShownChannelKeys([workspaceType]).filter(
        (key: string): boolean => {
          return !getShownChannelKeys([]).includes(key as never);
        },
      );

      expect(
        SETTING_CHANNELS.filter((channel: SettingChannel): boolean => {
          return channel.workspaceType === workspaceType;
        }).map((channel: SettingChannel): string => {
          return channel.column as string;
        }),
      ).toEqual(added);
    },
  );

  /*
   * Spelled as readiness reports it. A method type it never reports would read
   * as "no verified method" for everyone who has one: "Microsoft Teams", with
   * its space, is not the workspace type's own spelling.
   */
  test("name each method as the server's readiness does", () => {
    const service: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "OnCallReadinessService.ts",
      ),
      "utf8",
    );
    const start: number = service.indexOf("export enum ReadinessMethodType {");

    expect(start).toBeGreaterThan(-1);

    const reported: string = service.slice(start, service.indexOf("}", start));

    for (const channel of SETTING_CHANNELS) {
      expect({
        channel: channel.label,
        reported: reported.includes(`= "${channel.methodType}",`),
      }).toEqual({ channel: channel.label, reported: true });
    }
  });
});

describe.each(WORKSPACE_CHANNELS)(
  "a switch in the %s column",
  (label: string, column: ChannelColumn, methodType: string) => {
    test("with no account behind it, in a project that has it connected, is named", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting(["alertByEmail", column])],
        usable: ["Email"],
        workspaces: everyWorkspace(CONNECTED),
      });

      expect(answer.deliverableSettings).toEqual({
        isKnown: true,
        undeliverableChannels: [label],
      });
    });

    test("with a verified account behind it is not named", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column])],
        usable: [methodType],
        workspaces: everyWorkspace(CONNECTED),
      });

      expect(answer.deliverableSettings).toEqual({
        isKnown: true,
        undeliverableChannels: [],
      });
    });

    test("left on in a project that has not connected it is not named: the column is not there to see", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column])],
        workspaces: everyWorkspace(NOT_CONNECTED),
      });

      expect(answer.deliverableSettings).toEqual({
        isKnown: true,
        undeliverableChannels: [],
      });
    });

    test("when the project could not be asked, leaves the step out rather than judge it", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column])],
        workspaces: everyWorkspace(COULD_NOT_ASK),
      });

      expect(answer.deliverableSettings.isKnown).toBe(false);
    });

    test("with a verified account behind it, needs no asking", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column])],
        usable: [methodType],
        workspaces: everyWorkspace(COULD_NOT_ASK),
      });

      expect(answer.deliverableSettings).toEqual({
        isKnown: true,
        undeliverableChannels: [],
      });
    });

    test("on the roster row, in a project that has it connected, is a way to hear of a shift", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column], ROSTER_EVENT)],
        workspaces: everyWorkspace(CONNECTED),
      });

      expect(answer.onCallShiftAlerts).toEqual({
        isKnown: true,
        hasAnyChannelEnabled: true,
      });
    });

    test("on the roster row, in a project that has not connected it, is not", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column], ROSTER_EVENT)],
        workspaces: everyWorkspace(NOT_CONNECTED),
      });

      expect(answer.onCallShiftAlerts).toEqual({
        isKnown: true,
        hasAnyChannelEnabled: false,
      });
    });

    test("alone on the roster row, when the project could not be asked, leaves that step out too", () => {
      const answer: NotificationSettingProbes = probes({
        rows: [setting([column], ROSTER_EVENT)],
        workspaces: everyWorkspace(COULD_NOT_ASK),
      });

      expect(answer.onCallShiftAlerts.isKnown).toBe(false);
    });
  },
);

describe("the two answers together", () => {
  test("name the channels in the page's column order, the workspaces among them", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [
        setting(["alertByWebhook", "alertByMattermost"]),
        setting(["alertByMicrosoftTeams", "alertBySMS", "alertBySlack"]),
      ],
      workspaces: everyWorkspace(CONNECTED),
    });

    expect(answer.deliverableSettings.undeliverableChannels).toEqual([
      "SMS",
      "Slack",
      "Microsoft Teams",
      "Mattermost",
      "Webhook",
    ]);
  });

  test("each workspace is judged by its own connection", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [
        setting(["alertBySlack", "alertByMicrosoftTeams", "alertByMattermost"]),
      ],
      workspaces: {
        [WorkspaceType.Slack]: NOT_CONNECTED,
        [WorkspaceType.MicrosoftTeams]: CONNECTED,
        [WorkspaceType.Mattermost]: NOT_CONNECTED,
      },
    });

    expect(answer.deliverableSettings).toEqual({
      isKnown: true,
      undeliverableChannels: ["Microsoft Teams"],
    });
  });

  test("a channel known to send nothing is named even while another workspace could not be asked", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [setting(["alertBySlack", "alertByMattermost"])],
      workspaces: {
        [WorkspaceType.Slack]: COULD_NOT_ASK,
        [WorkspaceType.MicrosoftTeams]: CONNECTED,
        [WorkspaceType.Mattermost]: CONNECTED,
      },
    });

    expect(answer.deliverableSettings).toEqual({
      isKnown: true,
      undeliverableChannels: ["Mattermost"],
    });
  });

  test("a workspace that could not be asked changes nothing when its column is off", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [
        setting(["alertByEmail"]),
        setting(["alertByEmail"], ROSTER_EVENT),
      ],
      usable: ["Email"],
      workspaces: everyWorkspace(COULD_NOT_ASK),
    });

    expect(answer).toEqual({
      onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: true },
      deliverableSettings: { isKnown: true, undeliverableChannels: [] },
    });
  });

  test("email on the roster row answers for the shift, whatever a workspace could not say", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [setting(["alertByEmail", "alertBySlack"], ROSTER_EVENT)],
      usable: ["Email"],
      workspaces: everyWorkspace(COULD_NOT_ASK),
    });

    expect(answer.onCallShiftAlerts).toEqual({
      isKnown: true,
      hasAnyChannelEnabled: true,
    });
  });

  test("a workspace on for another event says nothing about the shift", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [setting([], ROSTER_EVENT), setting(["alertBySlack"])],
      workspaces: everyWorkspace(CONNECTED),
    });

    expect(answer.onCallShiftAlerts).toEqual({
      isKnown: true,
      hasAnyChannelEnabled: false,
    });
  });

  test("no roster setting at all is no way to hear of a shift", () => {
    const answer: NotificationSettingProbes = probes({
      rows: [setting(["alertBySlack"])],
      workspaces: everyWorkspace(COULD_NOT_ASK),
    });

    expect(answer.onCallShiftAlerts).toEqual({
      isKnown: true,
      hasAnyChannelEnabled: false,
    });
  });

  test("push alone is still named, and push beside a usable workspace account is not", () => {
    expect(
      probes({
        rows: [setting(["alertByPush"])],
        workspaces: everyWorkspace(CONNECTED),
      }).deliverableSettings.undeliverableChannels,
    ).toEqual(["Push"]);

    expect(
      probes({
        rows: [setting(["alertByPush", "alertByMattermost"])],
        usable: ["Mattermost"],
        workspaces: everyWorkspace(CONNECTED),
      }).deliverableSettings.undeliverableChannels,
    ).toEqual([]);
  });
});

/*
 * The whole load, through the hook: the settings read answers with the columns
 * it selects and no others, as the database does, so a column the read forgets
 * reads as off, and each workspace is asked about separately.
 */
describe("the checklist, as the page loads it", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const USER_ID: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );

  interface LoadedSetup {
    rows: Array<UserNotificationSetting>;
    verifiedMethods: Array<string>;
    connected: Array<WorkspaceType>;
    failing?: Array<WorkspaceType> | undefined;
  }

  let selects: Array<Record<string, boolean>>;

  function stubTheLoad(setup: LoadedSetup): void {
    jest.spyOn(API, "get").mockImplementation((async (data: {
      url: { toString(): string };
    }) => {
      if (data.url.toString().includes("/on-call-readiness/user/")) {
        return {
          data: {
            userId: USER_ID.toString(),
            status: "Ready",
            methods: setup.verifiedMethods.map(
              (methodType: string): JSONObject => {
                return { methodType: methodType, isVerified: true };
              },
            ),
            coverage: [],
            reasons: [],
            reachedVia: ["Schedule"],
          },
        };
      }

      // The calendar link: an API without it.
      return new HTTPErrorResponse(404, {}, {});
    }) as never);

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
      modelType: unknown;
      select: Record<string, boolean>;
    }) => {
      if (data.modelType !== UserNotificationSetting) {
        return { data: [], count: 0 };
      }

      selects.push(data.select);

      const answered: Array<UserNotificationSetting> = setup.rows.map(
        (row: UserNotificationSetting): UserNotificationSetting => {
          const read: UserNotificationSetting = new UserNotificationSetting();

          for (const column of Object.keys(data.select)) {
            (read as unknown as Record<string, unknown>)[column] = (
              row as unknown as Record<string, unknown>
            )[column];
          }

          return read;
        },
      );

      return { data: answered, count: answered.length };
    }) as never);

    jest.spyOn(ModelAPI, "count").mockImplementation((async (data: {
      modelType: unknown;
      query: { workspaceType?: WorkspaceType };
    }) => {
      if (data.modelType === WorkspaceProjectAuthToken) {
        const workspaceType: WorkspaceType = data.query.workspaceType!;

        if (setup.failing?.includes(workspaceType)) {
          throw new Error("Permission denied");
        }

        return setup.connected.includes(workspaceType) ? 1 : 0;
      }

      return data.modelType === WorkspaceUserAuthToken ? 1 : 0;
    }) as never);
  }

  async function load(setup: LoadedSetup): Promise<SetupChecklistState> {
    stubTheLoad(setup);

    const { result } = renderHook(() => {
      return useSetupChecklist({ userId: USER_ID, projectId: PROJECT_ID });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.checklist).not.toBeNull();
    });

    return result.current;
  }

  function step(
    state: SetupChecklistState,
    key: string,
  ): SetupStep | undefined {
    return state.checklist?.sections
      .flatMap((section: SetupSection): Array<SetupStep> => {
        return section.steps;
      })
      .find((candidate: SetupStep): boolean => {
        return candidate.key === key;
      });
  }

  beforeEach(() => {
    selects = [];
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a switch with no account behind it is named, and the step is to do", async () => {
    const state: SetupChecklistState = await load({
      rows: [setting(["alertByEmail", "alertByMattermost"])],
      verifiedMethods: ["Email"],
      connected: [WorkspaceType.Mattermost],
    });

    expect(step(state, "deliverable-settings")).toMatchObject({
      status: SetupStepStatus.Incomplete,
      detail:
        "You switched on Mattermost, but have no verified method there, so those updates are not sent.",
    });
  });

  test.each(WORKSPACE_CHANNELS)(
    "a verified %s account completes the step",
    async (_label: string, column: ChannelColumn, methodType: string) => {
      const state: SetupChecklistState = await load({
        rows: [setting([column])],
        verifiedMethods: [methodType],
        connected: ALL_WORKSPACES,
      });

      expect(step(state, "deliverable-settings")).toMatchObject({
        status: SetupStepStatus.Complete,
        detail: "",
      });
    },
  );

  test.each(WORKSPACE_CHANNELS)(
    "hearing of a shift only in %s is hearing of it",
    async (_label: string, column: ChannelColumn, methodType: string) => {
      const state: SetupChecklistState = await load({
        rows: [setting([column], ROSTER_EVENT)],
        verifiedMethods: [methodType],
        connected: ALL_WORKSPACES,
      });

      expect(step(state, "on-call-shift-alerts")).toMatchObject({
        status: SetupStepStatus.Complete,
      });
    },
  );

  test("a project that disconnected the workspace: nothing is named, and the shift's step is to do", async () => {
    const state: SetupChecklistState = await load({
      rows: [setting(["alertBySlack"], ROSTER_EVENT)],
      verifiedMethods: ["Email"],
      connected: [],
    });

    expect(step(state, "deliverable-settings")).toMatchObject({
      status: SetupStepStatus.Complete,
    });
    expect(step(state, "on-call-shift-alerts")).toMatchObject({
      status: SetupStepStatus.Incomplete,
    });
  });

  test("a workspace that could not be asked leaves out the steps that turn on it, and only those", async () => {
    const state: SetupChecklistState = await load({
      rows: [setting(["alertByMattermost"], ROSTER_EVENT)],
      verifiedMethods: ["Email"],
      connected: [],
      failing: [WorkspaceType.Mattermost],
    });

    expect(step(state, "deliverable-settings")).toBeUndefined();
    expect(step(state, "on-call-shift-alerts")).toBeUndefined();
    expect(step(state, "add-method")).toBeDefined();
  });

  test("the settings read asks for every channel it judges", async () => {
    await load({
      rows: [setting(["alertByEmail"])],
      verifiedMethods: ["Email"],
      connected: ALL_WORKSPACES,
    });

    expect(selects).toHaveLength(1);

    for (const channel of SETTING_CHANNELS) {
      expect({
        column: channel.column,
        selected: selects[0]![channel.column as string],
      }).toEqual({ column: channel.column, selected: true });
    }
  });
});
