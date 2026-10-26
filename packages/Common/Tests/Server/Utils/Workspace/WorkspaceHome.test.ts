import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceHome, {
  WORKSPACE_HOME_TEXT,
  WorkspaceHomeActions,
  WorkspaceHomeView,
} from "../../../../Server/Utils/Workspace/WorkspaceHome";
import { WorkspaceOpenRecordList } from "../../../../Server/Utils/Workspace/WorkspaceOpenRecords";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import Markdown from "../../../../Server/Types/Markdown";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceOpenRecordKind from "../../../../Types/Workspace/WorkspaceOpenRecordKind";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
  WorkspacePayloadMenu,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * THE HOME OF THE ONEUPTIME APP (WorkspaceHome), FOR SLACK AND TEAMS ALIKE.
 *
 * What concerns the person, right now, read with their own permissions:
 * their on-call shifts, the open incidents and alerts, and what they can do
 * from there. These pin its reads (the person's props, this project, their
 * roster), every line it can say, a part that cannot be read, and the same
 * blocks for both chats but for their own words for the commands.
 */

const DASHBOARD: string = "https://oneuptime.test/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000001",
);
const NITIN: ObjectID = new ObjectID("a0000000-0000-4000-8000-0000000000a1");
const PRIMARY_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-0000000000c1",
);
const READ_AT: Date = new Date("2026-10-08T17:15:00.000Z");
const HANDOFF: Date = new Date("2026-10-10T09:00:00.000Z");
const NEXT_START: Date = new Date("2026-10-12T09:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  userId: NITIN,
  tenantId: PROJECT_ID,
};

const ACTIONS: WorkspaceHomeActions = {
  declareIncident: "declare",
  pageSomeone: "page",
  scheduleMaintenance: "maintenance",
  whoIsOnCall: "oncall",
};

function schedule(name: string, at?: Date): OnCallDutyPolicySchedule {
  const row: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  row.id = name === "Primary" ? PRIMARY_ID : ObjectID.generate();
  row.name = name;

  if (at) {
    row.rosterHandoffAt = at;
    row.rosterNextStartAt = at;
  }

  return row;
}

let onCallFind: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy>;
let nowSchedules: Array<OnCallDutyPolicySchedule> = [];
let nextSchedules: Array<OnCallDutyPolicySchedule> = [];

beforeEach(() => {
  nowSchedules = [];
  nextSchedules = [];

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme Production";
    return project;
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.name = new Name("Nitin Kumar");
    return user;
  }) as never);
  onCallFind = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockImplementation((async (findBy: JSONObject) => {
      const query: JSONObject = findBy["query"] as JSONObject;
      return query["currentUserIdOnRoster"] ? nowSchedules : nextSchedules;
    }) as never);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([ObjectID.generate()]);
  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(): Promise<WorkspaceHomeView> {
  return await WorkspaceHome.read({
    projectId: PROJECT_ID,
    userId: NITIN,
    props: PROPS,
    now: READ_AT,
  });
}

function at(date: Date): string {
  return WorkspaceMessageTime.dateAndTime(date).toString();
}

const PRIMARY_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/schedules/${PRIMARY_ID.toString()}`;

// A sentence's end with a full stop right after it: "Acme Inc..".
const DOUBLED_FULL_STOP: RegExp = /[.!?]\./;

describe("what the Home reads, as the person", () => {
  test("their shifts now: the schedules whose roster has them on call, read with their props", async () => {
    nowSchedules = [schedule("Primary", HANDOFF)];

    const view: WorkspaceHomeView = await read();

    expect(onCallFind).toHaveBeenCalledTimes(1);
    const findBy: JSONObject = onCallFind.mock.calls[0]![0] as never;
    expect(findBy["props"]).toBe(PROPS);
    expect(findBy["query"]).toEqual({
      projectId: PROJECT_ID,
      currentUserIdOnRoster: NITIN,
    });
    expect(findBy["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(findBy["limit"]).toBe(WorkspaceHome.MAX_SHIFTS + 1);

    expect(view.onCall).toEqual({
      now: [
        { scheduleName: "Primary", scheduleLink: PRIMARY_LINK, at: HANDOFF },
      ],
      next: null,
      isNowCut: false,
    });
  });

  test("not on call now: the soonest schedule they are next in", async () => {
    nextSchedules = [schedule("Primary", NEXT_START)];

    const view: WorkspaceHomeView = await read();

    expect(onCallFind).toHaveBeenCalledTimes(2);
    const findBy: JSONObject = onCallFind.mock.calls[1]![0] as never;
    expect(findBy["query"]).toEqual({
      projectId: PROJECT_ID,
      nextUserIdOnRoster: NITIN,
    });
    expect(findBy["sort"]).toEqual({ rosterNextStartAt: SortOrder.Ascending });
    expect(findBy["limit"]).toBe(1);
    expect(view.onCall?.next).toEqual({
      scheduleName: "Primary",
      scheduleLink: PRIMARY_LINK,
      at: NEXT_START,
    });
  });

  test("on call in more schedules than the Home names: the first ones, and that there are more", async () => {
    nowSchedules = ["A", "B", "C", "D", "E", "F"].map(
      (name: string): OnCallDutyPolicySchedule => {
        return schedule(name, HANDOFF);
      },
    );

    const view: WorkspaceHomeView = await read();

    expect(view.onCall?.now).toHaveLength(WorkspaceHome.MAX_SHIFTS);
    expect(view.onCall?.isNowCut).toBe(true);
  });

  test("a role that may not read schedules: the shifts are marked refused, the rest still reads", async () => {
    onCallFind.mockRejectedValue(new NotAuthorizedException("no"));

    const view: WorkspaceHomeView = await read();

    expect(view.onCall).toEqual({ now: null, next: null, isNowCut: false });
    expect(view.incidents.list).not.toBeNull();
  });

  test("a read that fails: the shifts are unknown, and it is logged", async () => {
    onCallFind.mockRejectedValue(new Error("connection reset"));

    expect((await read()).onCall).toBeNull();
  });

  test("the lists: five records at most, read as the person", async () => {
    await read();

    const incidentRead: JSONObject = (
      IncidentService.findBy as unknown as SpyInstance<
        typeof IncidentService.findBy
      >
    ).mock.calls[0]![0] as never;

    expect(incidentRead["props"]).toBe(PROPS);
    expect(incidentRead["limit"]).toBe(WorkspaceHome.MAX_RECORDS + 1);
  });

  test("a list the person may not read is marked refused; one that fails, failed", async () => {
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no"));
    jest
      .spyOn(AlertService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    const view: WorkspaceHomeView = await read();

    expect(view.incidents).toEqual({
      kind: WorkspaceOpenRecordKind.Incidents,
      list: null,
      refused: true,
      failed: false,
    });
    expect(view.alerts).toEqual({
      kind: WorkspaceOpenRecordKind.Alerts,
      list: null,
      refused: false,
      failed: true,
    });
  });

  test("the project, the first name to greet, the link home, and when it was read", async () => {
    const view: WorkspaceHomeView = await read();

    expect(view.projectName).toBe("Acme Production");
    expect(view.firstName).toBe("Nitin");
    expect(view.dashboardLink).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/home/`,
    );
    expect(view.readAt).toBe(READ_AT);
  });
});

function emptyList(kind: WorkspaceOpenRecordKind): WorkspaceOpenRecordList {
  return { kind: kind, records: [], isCut: false, listLink: null };
}

function view(overrides: Partial<WorkspaceHomeView> = {}): WorkspaceHomeView {
  return {
    projectName: "Acme Production",
    firstName: "Nitin",
    onCall: {
      now: [
        { scheduleName: "Primary", scheduleLink: PRIMARY_LINK, at: HANDOFF },
      ],
      next: null,
      isNowCut: false,
    },
    incidents: {
      kind: WorkspaceOpenRecordKind.Incidents,
      list: emptyList(WorkspaceOpenRecordKind.Incidents),
      refused: false,
      failed: false,
    },
    alerts: {
      kind: WorkspaceOpenRecordKind.Alerts,
      list: emptyList(WorkspaceOpenRecordKind.Alerts),
      refused: false,
      failed: false,
    },
    dashboardLink: `${DASHBOARD}/p/home/`,
    readAt: READ_AT,
    ...overrides,
  };
}

function textOf(block: WorkspaceMessageBlock): string {
  return (
    block as
      | WorkspacePayloadMarkdown
      | WorkspacePayloadHeader
      | WorkspacePayloadContext
  ).text;
}

function typesOf(blocks: Array<WorkspaceMessageBlock>): Array<string> {
  return blocks.map((block: WorkspaceMessageBlock): string => {
    return block._type;
  });
}

describe("what the Home says", () => {
  test("in Slack: a greeting, the project, four buttons, the shifts and the lists under their titles, and when it was drawn", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view(),
      actions: ACTIONS,
    });

    /*
     * What you can do first, under the greeting: Slack draws the buttons
     * where they are, above lists that can run long. Then each part, its
     * title a block of its own, and the footer small and muted.
     */
    expect(typesOf(blocks)).toEqual([
      "WorkspacePayloadHeader",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadButtons",
      "WorkspacePayloadDivider",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadDivider",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadDivider",
      "WorkspacePayloadContext",
    ]);

    expect(textOf(blocks[0]!)).toBe("👋 Hi Nitin");
    expect(textOf(blocks[1]!)).toBe(
      "Here's what is happening in **Acme Production**.",
    );
    expect(textOf(blocks[4]!)).toBe("📟 **Your on-call**");
    expect(textOf(blocks[5]!)).toBe(
      `🟢 You're on call in [Primary](${PRIMARY_LINK}) until ${at(HANDOFF)}.`,
    );
    // Nothing open: one line each, no title above it.
    expect(textOf(blocks[7]!)).toBe("✅ **No open incidents.**");
    expect(textOf(blocks[8]!)).toBe("✅ **No open alerts.**");
    expect(
      (blocks[2] as WorkspacePayloadButtons).buttons.map(
        (button: {
          title: string;
          actionId: string;
          isPrimary?: boolean | undefined;
        }) => {
          return [button.title, button.actionId, Boolean(button.isPrimary)];
        },
      ),
    ).toEqual([
      [WORKSPACE_HOME_TEXT.declareIncident, "declare", true],
      [WORKSPACE_HOME_TEXT.pageSomeone, "page", false],
      [WORKSPACE_HOME_TEXT.scheduleMaintenance, "maintenance", false],
      [WORKSPACE_HOME_TEXT.whoIsOnCall, "oncall", false],
    ]);
    expect(textOf(blocks[10]!)).toBe(
      `Updated at ${WorkspaceMessageTime.time(READ_AT).toString()} · [Open OneUptime](${DASHBOARD}/p/home/) · Type \`/oneuptime help\` to see every command`,
    );
  });

  test("open records: the list's title, then its records and the way to the rest, as blocks of their own", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view({
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: {
            kind: WorkspaceOpenRecordKind.Incidents,
            records: [
              {
                number: "INC-12",
                title: "Checkout is down",
                link: null,
                severity: "Critical",
                state: "Identified",
                startsAt: null,
                endsAt: null,
              },
            ],
            isCut: true,
            listLink: `${DASHBOARD}/p/incidents/unresolved`,
          },
          refused: false,
          failed: false,
        },
      }),
      actions: ACTIONS,
    });

    expect(textOf(blocks[7]!)).toBe("🚨 **Open incidents**");
    expect(textOf(blocks[8]!)).toBe(
      [
        "- **INC-12** Checkout is down · Critical · Identified",
        "",
        `Showing the newest 1. [See every open incident in OneUptime](${DASHBOARD}/p/incidents/unresolved)`,
      ].join("\n"),
    );
    expect(textOf(blocks[9]!)).toBe("✅ **No open alerts.**");
  });

  test.each([
    [
      "on call in several schedules",
      [0, 1].map((i: number) => {
        return { scheduleName: `S${i}`, scheduleLink: null, at: HANDOFF };
      }),
    ],
    [
      "on call in one",
      [{ scheduleName: "Primary", scheduleLink: null, at: null }],
    ],
    ["not on call", []],
  ])(
    "%s: no Markdown block of the Home leans on a single line break, which Teams reads as a space",
    (
      _name: string,
      now: Array<{ scheduleName: string; scheduleLink: null; at: Date | null }>,
    ) => {
      const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
        workspaceType: WorkspaceType.MicrosoftTeams,
        view: view({
          onCall: { now: now, next: null, isNowCut: now.length > 1 },
          incidents: {
            kind: WorkspaceOpenRecordKind.Incidents,
            list: null,
            refused: true,
            failed: false,
          },
          alerts: {
            kind: WorkspaceOpenRecordKind.Alerts,
            list: null,
            refused: false,
            failed: true,
          },
        }),
        actions: ACTIONS,
      });

      for (const block of blocks) {
        if (
          block._type !== "WorkspacePayloadMarkdown" &&
          block._type !== "WorkspacePayloadContext"
        ) {
          continue;
        }

        // A paragraph's later lines are list items, or there are none.
        for (const paragraph of textOf(block).split("\n\n")) {
          for (const line of paragraph.split("\n").slice(1)) {
            expect({ line: line, isListItem: line.startsWith("- ") }).toEqual({
              line: line,
              isListItem: true,
            });
          }
        }
      }
    },
  );

  test("in Microsoft Teams: the same Home, Teams' word for the commands, and Refresh", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.MicrosoftTeams,
      view: view(),
      actions: {
        declareIncident: "d",
        pageSomeone: "p",
        whoIsOnCall: "o",
        refresh: "r",
      },
    });

    expect(blocks[blocks.length - 1]!._type).toBe("WorkspacePayloadContext");
    expect(textOf(blocks[blocks.length - 1]!)).toContain(
      "Type **help** to see every command",
    );
    expect(
      (blocks[2] as WorkspacePayloadButtons).buttons.map(
        (button: { title: string }): string => {
          return button.title;
        },
      ),
    ).toEqual([
      WORKSPACE_HOME_TEXT.declareIncident,
      WORKSPACE_HOME_TEXT.pageSomeone,
      WORKSPACE_HOME_TEXT.whoIsOnCall,
      WORKSPACE_HOME_TEXT.refresh,
    ]);
  });

  test("a person with no name, a project with none: a plain greeting, no project line", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view({ firstName: null, projectName: null }),
      actions: ACTIONS,
    });

    expect(textOf(blocks[0]!)).toBe("👋 Hi there");
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
    expect(textOf(blocks[3]!)).toBe("📟 **Your on-call**");
  });

  /*
   * Somebody in several of a Slack workspace's projects: the Switch project
   * menu sits beside the line that names the project (SlackHome), and
   * nothing else of the Home changes.
   */
  const MENU: WorkspacePayloadMenu = {
    actionId: "SwitchHomeProject",
    placeholder: "Switch project",
    options: [{ label: "Acme Staging", value: ObjectID.generate().toString() }],
    blockId: "SwitchHomeProject:p",
  };

  test("a project menu: beside the line that names the project, and on no other block", () => {
    const withMenu: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view(),
      actions: ACTIONS,
      projectMenu: MENU,
    });
    const without: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view(),
      actions: ACTIONS,
    });

    expect(textOf(withMenu[1]!)).toBe(
      "Here's what is happening in **Acme Production**.",
    );
    expect((withMenu[1] as WorkspacePayloadMarkdown).menu).toEqual(MENU);

    // Everything else, block for block, as without it.
    expect(
      withMenu.filter((_block: WorkspaceMessageBlock, index: number) => {
        return index !== 1;
      }),
    ).toEqual(
      without.filter((_block: WorkspaceMessageBlock, index: number) => {
        return index !== 1;
      }),
    );
    expect((without[1] as WorkspacePayloadMarkdown).menu).toBeUndefined();
    expect(Object.keys(without[1]!).sort()).toEqual(["_type", "text"]);
  });

  test("no project name read: no line that names it, and so no menu", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view({ projectName: null }),
      actions: ACTIONS,
      projectMenu: MENU,
    });

    for (const block of blocks) {
      expect((block as WorkspacePayloadMarkdown).menu).toBeUndefined();
    }
  });

  test("a notice: the first line under the greeting, before the project's", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view(),
      actions: ACTIONS,
      notice: mdText`⚠️ You can't switch to that project.`,
      projectMenu: MENU,
    });

    expect(typesOf(blocks).slice(0, 4)).toEqual([
      "WorkspacePayloadHeader",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadButtons",
    ]);
    expect(textOf(blocks[1]!)).toBe("⚠️ You can't switch to that project.");
    expect((blocks[1] as WorkspacePayloadMarkdown).menu).toBeUndefined();
    expect(textOf(blocks[2]!)).toBe(
      "Here's what is happening in **Acme Production**.",
    );
    expect((blocks[2] as WorkspacePayloadMarkdown).menu).toEqual(MENU);
  });

  test("no dashboard address: the footer has no Open link", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view({ dashboardLink: null }),
      actions: ACTIONS,
    });

    expect(textOf(blocks[blocks.length - 1]!)).toBe(
      `Updated at ${WorkspaceMessageTime.time(READ_AT).toString()} · Type \`/oneuptime help\` to see every command`,
    );
  });

  test("names are text: Markdown in a project's or a schedule's name is shown, not read", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
      workspaceType: WorkspaceType.Slack,
      view: view({ projectName: "[Prod](https://evil.example) *now*" }),
      actions: ACTIONS,
    });

    expect(textOf(blocks[1]!)).not.toContain("[Prod](");
    expect(textOf(blocks[1]!)).not.toContain(" *now*");
  });

  test.each([
    ["Acme Inc.", "Here's what is happening in **Acme Inc.**"],
    ["Yahoo!", "Here's what is happening in **Yahoo!**"],
    ["Who broke prod?", "Here's what is happening in **Who broke prod?**"],
    ["Acme Production", "Here's what is happening in **Acme Production**."],
  ])(
    "a project named %j: its line ends with one full stop, the name's own when it has one",
    (projectName: string, expected: string) => {
      const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
        workspaceType: WorkspaceType.Slack,
        view: view({ projectName: projectName }),
        actions: ACTIONS,
      });

      expect(textOf(blocks[1]!)).toBe(expected);
    },
  );

  test.each([
    [
      "on call in one schedule, no hand-off known",
      {
        now: [{ scheduleName: "Primary.", scheduleLink: null, at: null }],
        next: null,
        isNowCut: false,
      },
    ],
    [
      "on call in one schedule, its link",
      {
        now: [
          { scheduleName: "Primary.", scheduleLink: PRIMARY_LINK, at: null },
        ],
        next: null,
        isNowCut: false,
      },
    ],
    [
      "not on call, the next shift known",
      {
        now: [],
        next: {
          scheduleName: "Primary.",
          scheduleLink: PRIMARY_LINK,
          at: NEXT_START,
        },
        isNowCut: false,
      },
    ],
  ])(
    "%s, every name ending with a full stop: no sentence in Slack or Teams ends with a second",
    (_name: string, onCall: unknown) => {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getBlocks({
          workspaceType: workspaceType,
          view: view({
            projectName: "Acme Inc.",
            onCall: onCall as WorkspaceHomeView["onCall"],
          }),
          actions: ACTIONS,
        });

        for (const block of blocks) {
          if (
            block._type !== "WorkspacePayloadMarkdown" &&
            block._type !== "WorkspacePayloadContext"
          ) {
            continue;
          }

          // As a reader sees it: no bold markers, no link addresses.
          const text: string = Markdown.convertToPlainText(textOf(block));

          expect({
            text: text,
            isDoubled: DOUBLED_FULL_STOP.test(text),
          }).toEqual({ text: text, isDoubled: false });
        }
      }
    },
  );
});

describe("the person's shifts, said", () => {
  test.each([
    [
      "not on call, their next shift known",
      {
        now: [],
        next: { scheduleName: "Primary", scheduleLink: null, at: NEXT_START },
        isNowCut: false,
      },
      `⚪ You're not on call right now. Your next shift starts ${WorkspaceMessageTime.dateAndTime(NEXT_START).toString()}, in **Primary**.`,
    ],
    [
      "not on call, nothing coming up",
      { now: [], next: null, isNowCut: false },
      "⚪ You're not on call right now, and no shift of yours is coming up.",
    ],
    [
      "on call with no hand-off known",
      {
        now: [{ scheduleName: "Primary", scheduleLink: null, at: null }],
        next: null,
        isNowCut: false,
      },
      "🟢 You're on call in **Primary**.",
    ],
    [
      "on call in a schedule whose name ends with a full stop: none more after it",
      {
        now: [{ scheduleName: "Primary.", scheduleLink: null, at: null }],
        next: null,
        isNowCut: false,
      },
      "🟢 You're on call in **Primary.**",
    ],
    [
      "on call in a schedule whose name ends with a question mark, as a link",
      {
        now: [
          { scheduleName: "Who's up?", scheduleLink: PRIMARY_LINK, at: null },
        ],
        next: null,
        isNowCut: false,
      },
      `🟢 You're on call in [Who's up?](${PRIMARY_LINK})`,
    ],
    [
      "not on call, the next shift in a schedule whose name ends with a full stop",
      {
        now: [],
        next: { scheduleName: "Nights.", scheduleLink: null, at: NEXT_START },
        isNowCut: false,
      },
      `⚪ You're not on call right now. Your next shift starts ${WorkspaceMessageTime.dateAndTime(NEXT_START).toString()}, in **Nights.**`,
    ],
    [
      "on call in two schedules: a list",
      {
        now: [
          { scheduleName: "Primary", scheduleLink: null, at: HANDOFF },
          { scheduleName: "Database", scheduleLink: null, at: null },
        ],
        next: null,
        isNowCut: false,
      },
      `🟢 You're on call in 2 schedules:\n- **Primary** until ${WorkspaceMessageTime.dateAndTime(HANDOFF).toString()}\n- **Database**`,
    ],
    [
      "on call in more than the Home names",
      {
        now: [{ scheduleName: "A", scheduleLink: null, at: null }],
        next: null,
        isNowCut: true,
      },
      "🟢 You're on call in more than 1 schedule:\n- **A**",
    ],
    [
      "a role that may not read schedules",
      { now: null, next: null, isNowCut: false },
      "You do not have permission to see the on-call schedules in this project.",
    ],
  ])("%s", (_name: string, onCall: unknown, expected: string) => {
    expect(
      WorkspaceHome.getOnCallMarkdown(
        view({ onCall: onCall as WorkspaceHomeView["onCall"] }),
      ).toString(),
    ).toBe(expected);
  });

  test("shifts that could not be read", () => {
    expect(
      WorkspaceHome.getOnCallMarkdown(view({ onCall: null })).toString(),
    ).toBe("OneUptime couldn't read your on-call shifts just now.");
  });
});

describe("a list on the Home, said", () => {
  test("refused: under its title, that the person may not see it", () => {
    const home: WorkspaceHomeView["incidents"] = {
      kind: WorkspaceOpenRecordKind.Incidents,
      list: null,
      refused: true,
      failed: false,
    };

    expect(WorkspaceHome.getListBlocks(home).map(textOf)).toEqual([
      "🚨 **Open incidents**",
      "You do not have permission to see the incidents in this project.",
    ]);
  });

  test("failed: under its title, that it could not be read", () => {
    const home: WorkspaceHomeView["alerts"] = {
      kind: WorkspaceOpenRecordKind.Alerts,
      list: null,
      refused: false,
      failed: true,
    };

    expect(WorkspaceHome.getListBlocks(home).map(textOf)).toEqual([
      "⚠️ **Open alerts**",
      "OneUptime couldn't read the open alerts just now.",
    ]);
  });

  test("nothing open: one line, no title", () => {
    expect(
      WorkspaceHome.getListBlocks({
        kind: WorkspaceOpenRecordKind.Alerts,
        list: emptyList(WorkspaceOpenRecordKind.Alerts),
        refused: false,
        failed: false,
      }).map(textOf),
    ).toEqual(["✅ **No open alerts.**"]);
  });
});

describe("the Home of somebody not connected, or not a member", () => {
  test("Slack: what the Home would show, and one button that connects", () => {
    const blocks: Array<WorkspaceMessageBlock> =
      WorkspaceHome.getNotConnectedBlocks({
        workspaceType: WorkspaceType.Slack,
        connectUrl: `${DASHBOARD}/p/user-settings/slack-integration?connectAccount=true`,
      });

    expect(textOf(blocks[0]!)).toBe("👋 Welcome to OneUptime");
    expect(textOf(blocks[1]!)).toBe(
      "🔗 **Connect your Slack account** to see your on-call shifts and the open incidents and alerts here, and to declare incidents and page people from Slack. It takes one click.",
    );

    const button: WorkspacePayloadButtons =
      blocks[2] as WorkspacePayloadButtons;
    expect(button.buttons).toHaveLength(1);
    expect(button.buttons[0]!.title).toBe("Connect Slack account");
    expect(button.buttons[0]!.isPrimary).toBe(true);
    expect(button.buttons[0]!.url?.toString()).toBe(
      `${DASHBOARD}/p/user-settings/slack-integration?connectAccount=true`,
    );
  });

  test("Microsoft Teams, with no address to link to: where to connect, in words", () => {
    const blocks: Array<WorkspaceMessageBlock> =
      WorkspaceHome.getNotConnectedBlocks({
        workspaceType: WorkspaceType.MicrosoftTeams,
        connectUrl: null,
      });

    /*
     * No button, so no "one click": connecting is the steps below, in
     * OneUptime (a workspace connected to several projects, none of which
     * the person is connected in, is drawn this way too).
     */
    expect(textOf(blocks[1]!)).toBe(
      "🔗 **Connect your Microsoft Teams account** to see your on-call shifts and the open incidents and alerts here, and to declare incidents and page people from Microsoft Teams.",
    );
    expect(blocks).toHaveLength(3);
    // The path and the button the Dashboard draws, as the Connect prompts say them.
    expect(textOf(blocks[2]!)).toBe(
      "In OneUptime, go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**.",
    );
  });

  test("not a member: told so, and nothing else", () => {
    const blocks: Array<WorkspaceMessageBlock> =
      WorkspaceHome.getNotAMemberBlocks();

    expect(blocks).toHaveLength(2);
    expect(textOf(blocks[0]!)).toBe("👋 Hi there");
    expect(textOf(blocks[1]!)).toBe(
      "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    );
  });

  /*
   * Refused in the project it shows - blocked by an administrator, or left
   * a moment ago. Somebody in several of a workspace's projects is told
   * which one, on the line every Home names it on, with the Slack Home's
   * Switch project menu beside it (SlackHome): "this project" is never one
   * of several left unnamed, and they can always switch away from it.
   */
  const SWITCH_MENU: WorkspacePayloadMenu = {
    actionId: "SwitchHomeProject",
    placeholder: "Switch project",
    options: [{ label: "Acme Staging", value: ObjectID.generate().toString() }],
    blockId: "SwitchHomeProject:p:0a1b2c3d",
  };
  const BLOCKED: string =
    "This project has been blocked. Please contact your administrator.";

  test("refused, in one project: why, and nothing else - as not being a member is told", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getRefusedBlocks(
      { message: BLOCKED },
    );

    expect(typesOf(blocks)).toEqual([
      "WorkspacePayloadHeader",
      "WorkspacePayloadMarkdown",
    ]);
    expect(textOf(blocks[0]!)).toBe("👋 Hi there");
    expect(textOf(blocks[1]!)).toBe(BLOCKED);
    expect(Object.keys(blocks[1]!).sort()).toEqual(["_type", "text"]);

    // A name with no menu: nothing to switch to, so nothing new is said.
    expect(
      WorkspaceHome.getRefusedBlocks({
        message: BLOCKED,
        projectName: "Acme Production",
      }),
    ).toEqual(blocks);
  });

  test("refused, in several projects: which one, on the line that names it on every Home, the menu beside it - then why", () => {
    const blocks: Array<WorkspaceMessageBlock> = WorkspaceHome.getRefusedBlocks(
      {
        message: BLOCKED,
        projectName: "Acme Production",
        projectMenu: SWITCH_MENU,
      },
    );

    expect(typesOf(blocks)).toEqual([
      "WorkspacePayloadHeader",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadMarkdown",
    ]);
    expect(textOf(blocks[0]!)).toBe("👋 Hi there");
    expect(textOf(blocks[1]!)).toBe(
      "Here's what is happening in **Acme Production**.",
    );
    expect((blocks[1] as WorkspacePayloadMarkdown).menu).toEqual(SWITCH_MENU);
    expect(textOf(blocks[2]!)).toBe(BLOCKED);
    expect((blocks[2] as WorkspacePayloadMarkdown).menu).toBeUndefined();

    // The very line, and menu, the Home of a project that lets them in has.
    expect(blocks[1]).toEqual(
      WorkspaceHome.getBlocks({
        workspaceType: WorkspaceType.Slack,
        view: view(),
        actions: ACTIONS,
        projectMenu: SWITCH_MENU,
      })[1],
    );
  });

  test("refused with a notice: the notice first, under the greeting, as on any Home", () => {
    const notice: MarkdownText = mdText`⚠️ You can't switch to that project.`;

    expect(
      WorkspaceHome.getRefusedBlocks({
        message: BLOCKED,
        projectName: "Acme Production",
        projectMenu: SWITCH_MENU,
        notice: notice,
      }).map(textOf),
    ).toEqual([
      "👋 Hi there",
      "⚠️ You can't switch to that project.",
      "Here's what is happening in **Acme Production**.",
      BLOCKED,
    ]);

    // In one project, too: why it did not switch, then why it is refused.
    expect(
      WorkspaceHome.getRefusedBlocks({ message: BLOCKED, notice: notice }).map(
        textOf,
      ),
    ).toEqual(["👋 Hi there", "⚠️ You can't switch to that project.", BLOCKED]);
  });

  test("a menu with no name to put it beside: the menu beside why, never lost", () => {
    for (const projectName of [undefined, null, ""]) {
      const blocks: Array<WorkspaceMessageBlock> =
        WorkspaceHome.getRefusedBlocks({
          message: BLOCKED,
          projectName: projectName,
          projectMenu: SWITCH_MENU,
        });

      expect(blocks.map(textOf)).toEqual(["👋 Hi there", BLOCKED]);
      expect((blocks[1] as WorkspacePayloadMarkdown).menu).toEqual(SWITCH_MENU);
    }
  });

  test("a name that ends its own sentence takes no second full stop", () => {
    expect(
      textOf(
        WorkspaceHome.getRefusedBlocks({
          message: BLOCKED,
          projectName: "Acme Inc.",
          projectMenu: SWITCH_MENU,
        })[1]!,
      ),
    ).toBe("Here's what is happening in **Acme Inc.**");
  });

  test("the refusal is said as it is written: Markdown in it is text, never formatting or a link", () => {
    const written: string = "Ask *an admin* to [invite you](https://x.test).";
    const said: string = textOf(
      WorkspaceHome.getRefusedBlocks({ message: written })[1]!,
    );

    expect(said).toBe(mdText`${written}`.toString());
    expect(said).not.toBe(written);
  });
});

describe("what a notification of the Home says", () => {
  function list(
    count: number,
    isCut: boolean = false,
  ): WorkspaceOpenRecordList {
    return {
      kind: WorkspaceOpenRecordKind.Incidents,
      records: Array.from({ length: count }, (_v: unknown, index: number) => {
        return {
          number: `INC-${index}`,
          title: "x",
          link: null,
          severity: null,
          state: null,
          startsAt: null,
          endsAt: null,
        };
      }),
      isCut: isCut,
      listLink: null,
    };
  }

  test.each([
    [
      "on call, one incident open",
      view({
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: list(1),
          refused: false,
          failed: false,
        },
      }),
      "You're on call in Primary. 1 open incident",
    ],
    [
      "on call in a schedule whose name ends with a full stop: no second one",
      view({
        onCall: {
          now: [{ scheduleName: "Acme Inc.", scheduleLink: null, at: null }],
          next: null,
          isNowCut: false,
        },
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: list(1),
          refused: false,
          failed: false,
        },
      }),
      "You're on call in Acme Inc. 1 open incident",
    ],
    [
      "on call in a schedule whose name ends with an exclamation mark",
      view({
        onCall: {
          now: [{ scheduleName: "Nights!", scheduleLink: null, at: null }],
          next: null,
          isNowCut: false,
        },
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: list(2),
          refused: false,
          failed: false,
        },
      }),
      "You're on call in Nights! 2 open incidents",
    ],
    [
      "not on call, more open than the Home shows",
      view({
        onCall: { now: [], next: null, isNowCut: false },
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: list(5, true),
          refused: false,
          failed: false,
        },
        alerts: {
          kind: WorkspaceOpenRecordKind.Alerts,
          list: { ...list(2), kind: WorkspaceOpenRecordKind.Alerts },
          refused: false,
          failed: false,
        },
      }),
      "More than 5 open incidents, 2 open alerts",
    ],
    [
      "nothing at all",
      view({ onCall: { now: [], next: null, isNowCut: false } }),
      "Nothing is open, and you're not on call",
    ],
    [
      "on call in several schedules",
      view({
        onCall: {
          now: [
            { scheduleName: "Primary", scheduleLink: null, at: null },
            { scheduleName: "Database", scheduleLink: null, at: null },
          ],
          next: null,
          isNowCut: false,
        },
      }),
      "You're on call in 2 schedules",
    ],
    [
      "on call in more schedules than the Home names",
      view({
        onCall: {
          now: [{ scheduleName: "Primary", scheduleLink: null, at: null }],
          next: null,
          isNowCut: true,
        },
      }),
      "You're on call in more than 1 schedule",
    ],
    [
      "the lists not read: nothing said of what is open",
      view({
        onCall: { now: [], next: null, isNowCut: false },
        incidents: {
          kind: WorkspaceOpenRecordKind.Incidents,
          list: null,
          refused: true,
          failed: false,
        },
      }),
      "Your OneUptime Home",
    ],
    [
      "the shifts not read: nothing said of being on call",
      view({ onCall: null }),
      "Nothing is open",
    ],
  ])("%s", (_name: string, home: WorkspaceHomeView, expected: string) => {
    expect(WorkspaceHome.getNotificationText(home)).toBe(expected);
  });
});
