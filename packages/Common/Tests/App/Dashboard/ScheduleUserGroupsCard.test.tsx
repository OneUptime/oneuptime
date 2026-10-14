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
import { Location, MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE SCHEDULE PAGE'S SLACK USER GROUPS AND MICROSOFT TEAMS TAGS CARD
 * (customer feedback #3: "We have a number of @teamname-oncall user group in
 * Slack that is always updated with the on-call person(s)").
 *
 * The real card, rows and Connect dialog, with the server's routes stood in
 * for: a card per connected chat workspace, Slack first; each group with
 * who is in it, the other schedules it follows, where it stands and why;
 * Try again and Disconnect, and who may press them; and Connect - a new
 * Slack group, or a workspace's group, or a Teams tag - sending what the
 * server reads. The words come from UserGroupsCopy, whose own suite pins
 * each sentence (App/Tests/Dashboard/OnCallUserGroupsCopy.test.ts).
 */

let permissionsForTest: Array<string> = [];

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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
      getFriendlyMessage: (error: unknown): string => {
        const data: unknown = (error as { data?: unknown } | null)?.data;

        if (data && typeof data === "object" && "message" in data) {
          return String((data as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
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
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
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

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupScheduleView,
  WorkspaceUserGroupView,
} from "../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Navigation from "../../../UI/Utils/Navigation";
import ScheduleUserGroupsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/ScheduleUserGroupsCard";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PRIMARY_ID: string = "7a000000-0000-4000-8000-000000000001";
const SECONDARY_ID: string = "7a000000-0000-4000-8000-000000000002";
const DATABASE_ID: string = "7a000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-10-14T09:30:00.000Z");

const ANA: { userId: string; name: string; email: string } = {
  userId: "9a000000-0000-4000-8000-0000000000a1",
  name: "Ana Silva",
  email: "ana@acme.test",
};
const BOB: { userId: string; name: string; email: string } = {
  userId: "9a000000-0000-4000-8000-0000000000b1",
  name: "Bob Lee",
  email: "bob@acme.test",
};

const PRIMARY: WorkspaceUserGroupScheduleView = {
  scheduleId: PRIMARY_ID,
  name: "Payments Primary",
  onCallNow: ANA,
};
const SECONDARY: WorkspaceUserGroupScheduleView = {
  scheduleId: SECONDARY_ID,
  name: "Payments Secondary",
  onCallNow: BOB,
};
const DATABASE: WorkspaceUserGroupScheduleView = {
  scheduleId: DATABASE_ID,
  name: "Database",
  onCallNow: null,
};

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60000).toISOString();
}

function viewOf(
  data: Partial<WorkspaceUserGroupView> & { workspaceUserGroupId: string },
): WorkspaceUserGroupView {
  return {
    workspaceType: WorkspaceType.Slack,
    name: "Payments on-call",
    handle: "payments-oncall",
    teamName: null,
    schedules: [PRIMARY],
    members: [ANA],
    leftOut: [],
    isTurnedOff: false,
    problem: null,
    problemDetail: null,
    syncedAt: minutesAgo(3),
    checkedAt: minutesAgo(3),
    ...data,
  };
}

const PAYMENTS: WorkspaceUserGroupView = viewOf({
  workspaceUserGroupId: "8a000000-0000-4000-8000-000000000001",
  schedules: [PRIMARY, SECONDARY],
  members: [ANA, BOB],
});

let views: Array<WorkspaceUserGroupView>;
let available: {
  groups: Array<WorkspaceAvailableUserGroup>;
  teams: Array<JSONObject>;
};
let connectAnswer: () => HTTPResponse<JSONObject> | HTTPErrorResponse;
let syncAnswer: () => HTTPResponse<JSONObject> | HTTPErrorResponse;

function ok(json: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, json, {});
}

function refused(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { message: message }, {});
}

function pathOf(call: Array<unknown>): string {
  return (call[0] as { url: { toString: () => string } }).url.toString();
}

function posted(route: string): Array<JSONObject> {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return pathOf(call).includes(route);
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });
}

async function renderCard(
  connected: Array<WorkspaceType> = [WorkspaceType.Slack],
): Promise<void> {
  ConnectedWorkspaces.setConnected(PROJECT_ID, connected);

  await act(async () => {
    render(
      <MemoryRouter>
        <ScheduleUserGroupsCard
          scheduleId={new ObjectID(PRIMARY_ID)}
          scheduleName="Payments Primary"
          now={NOW}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(
      document.querySelector("[data-testid^='user-groups-card-']"),
    ).not.toBeNull();
  });
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`user-group-${id}`);
}

function textOf(id: string, part: string): string {
  return (
    within(row(id)).queryByTestId(`user-group-${id}-${part}`)?.textContent || ""
  );
}

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${PRIMARY_ID}`,
  );
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${PRIMARY_ID}`,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  permissionsForTest = [Permission.ProjectOwner];
  views = [PAYMENTS];
  available = { groups: [], teams: [] };
  connectAnswer = () => {
    return ok({
      userGroup: viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-0000000000ff",
      }) as unknown as JSONObject,
    });
  };
  syncAnswer = () => {
    return ok({ userGroup: PAYMENTS as unknown as JSONObject });
  };

  getMock.mockReset();
  postMock.mockReset();

  getMock.mockImplementation((async (options: {
    url: { toString: () => string };
  }) => {
    const url: string = options.url.toString();

    if (url.includes("/workspace-user-group/schedule/")) {
      return ok({
        userGroups: views as unknown as Array<JSONObject>,
      } as JSONObject);
    }

    if (url.includes("/workspace-user-group/available")) {
      return ok(available as unknown as JSONObject);
    }

    return ok({});
  }) as never);

  postMock.mockImplementation((async (options: {
    url: { toString: () => string };
  }) => {
    const url: string = options.url.toString();

    if (url.includes("/workspace-user-group/connect")) {
      return connectAnswer();
    }

    if (url.includes("/workspace-user-group/sync/")) {
      return syncAnswer();
    }

    return ok({});
  }) as never);

  window.localStorage.clear();
  ConnectedWorkspaces.reset();
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.reset();
});

describe("a card per connected workspace", () => {
  test("Slack connected: the Slack user groups card, read for this schedule", async () => {
    await renderCard();

    expect(screen.getByText("Slack user groups")).toBeInTheDocument();
    expect(screen.queryByText("Microsoft Teams tags")).toBeNull();
    expect(pathOf(getMock.mock.calls[0]!)).toContain(
      `/workspace-user-group/schedule/${PRIMARY_ID}`,
    );
  });

  test("nothing connected: no card at all, and nothing asked", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);

    await act(async () => {
      render(
        <MemoryRouter>
          <ScheduleUserGroupsCard
            scheduleId={new ObjectID(PRIMARY_ID)}
            scheduleName="Payments Primary"
          />
        </MemoryRouter>,
      );
    });

    expect(
      document.querySelector("[data-testid^='user-groups-card-']"),
    ).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  test("both connected: Slack's card, then Microsoft Teams', each with its own groups", async () => {
    views = [
      PAYMENTS,
      viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-000000000021",
        workspaceType: WorkspaceType.MicrosoftTeams,
        name: "Payments on-call",
        handle: null,
        teamName: "Payments",
      }),
    ];

    await renderCard([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    const cards: Array<HTMLElement> =
      screen.getAllByTestId(/^user-groups-card-/);

    expect(
      cards.map((card: HTMLElement): string | null => {
        return card.getAttribute("data-testid");
      }),
    ).toEqual(["user-groups-card-Slack", "user-groups-card-MicrosoftTeams"]);
    expect(
      within(screen.getByTestId("user-groups-card-Slack")).getAllByRole(
        "listitem",
      ).length,
    ).toBeGreaterThan(0);
    expect(textOf("8a000000-0000-4000-8000-000000000021", "team")).toBe(
      "In the Payments team",
    );
    expect(textOf("8a000000-0000-4000-8000-000000000021", "mention")).toBe(
      "@Payments on-call",
    );
  });

  test("no group yet: says what one is for, with Connect user group as the one button", async () => {
    views = [];

    await renderCard();

    const empty: HTMLElement = screen.getByTestId("user-groups-empty-Slack");

    expect(within(empty).getByText("No user group yet")).toBeInTheDocument();
    expect(
      within(empty).getByText(
        "Connect one, such as @payments-oncall, and OneUptime keeps its people equal to whoever is on call here, at every hand-off and override.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("user-groups-empty-connect-Slack"),
    ).toBeInTheDocument();
  });

  test("the groups could not be read: said, with a way to try again", async () => {
    getMock.mockImplementation((async () => {
      return refused("You do not have permission to read this schedule.");
    }) as never);

    await renderCard();

    expect(
      screen.getByText("You do not have permission to read this schedule."),
    ).toBeInTheDocument();
  });
});

describe("a group's row", () => {
  test("in step: its mention, Up to date, who is in it, the other schedules it follows as links, and when it was checked", async () => {
    await renderCard();

    const id: string = PAYMENTS.workspaceUserGroupId;

    expect(textOf(id, "mention")).toBe("@payments-oncall");
    expect(textOf(id, "status")).toBe("Up to date");
    expect(textOf(id, "members")).toContain("Ana Silva");
    expect(textOf(id, "members")).toContain("Bob Lee");

    // This schedule is not listed: only the others, as links to them.
    const schedules: HTMLElement = within(row(id)).getByTestId(
      `user-group-${id}-schedules`,
    );

    expect(
      within(schedules)
        .getAllByRole("link")
        .map((link: HTMLElement) => {
          return link.textContent;
        }),
    ).toEqual(["Payments Secondary"]);
    expect(textOf(id, "time")).toBe("Checked 3 minutes ago");
  });

  test("following only this schedule: no Also follows", async () => {
    views = [
      viewOf({ workspaceUserGroupId: "8a000000-0000-4000-8000-000000000002" }),
    ];

    await renderCard();

    expect(
      within(row("8a000000-0000-4000-8000-000000000002")).queryByTestId(
        "user-group-8a000000-0000-4000-8000-000000000002-schedules",
      ),
    ).toBeNull();
  });

  test("nobody on call: Nobody on call, Nobody in it, and why the group is off", async () => {
    views = [
      viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-000000000003",
        members: [],
        isTurnedOff: true,
      }),
    ];

    await renderCard();

    const id: string = "8a000000-0000-4000-8000-000000000003";

    expect(textOf(id, "status")).toBe("Nobody on call");
    expect(textOf(id, "members")).toBe("Nobody");
    expect(textOf(id, "status-text")).toBe(
      "Nobody is on call now, so OneUptime turned @payments-oncall off in Slack: Slack can't keep a user group with nobody in it. It turns it back on when somebody is on call.",
    );
  });

  test("just connected, not looked at yet: Updating, and no one listed as in it", async () => {
    views = [
      viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-000000000004",
        members: [],
        syncedAt: null,
        checkedAt: null,
      }),
    ];

    await renderCard();

    const id: string = "8a000000-0000-4000-8000-000000000004";

    expect(textOf(id, "status")).toBe("Updating");
    expect(
      within(row(id)).queryByTestId(`user-group-${id}-members`),
    ).toBeNull();
    expect(textOf(id, "status-text")).toBe(
      "OneUptime is putting whoever is on call in it.",
    );
    // Never looked at: no time to give.
    expect(within(row(id)).queryByTestId(`user-group-${id}-time`)).toBeNull();
  });

  test("Slack refuses: Not up to date, what to do, when it was last in step - and Try again puts it right", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000005";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        problem: WorkspaceUserGroupProblem.AdminsOnly,
        syncedAt: minutesAgo(120),
        checkedAt: minutesAgo(2),
      }),
    ];
    syncAnswer = () => {
      return ok({
        userGroup: viewOf({
          workspaceUserGroupId: id,
        }) as unknown as JSONObject,
      });
    };

    await renderCard();

    expect(textOf(id, "status")).toBe("Not up to date");
    expect(textOf(id, "status-text")).toBe(
      "Slack lets only workspace owners and admins change user groups in your workspace, so OneUptime can't update @payments-oncall. A Slack admin can let everyone manage user groups in Slack's admin settings, under Permissions > User Groups.",
    );
    expect(textOf(id, "time")).toBe("Last up to date 2 hours ago");

    await act(async () => {
      fireEvent.click(
        within(row(id)).getByTestId(`user-group-${id}-try-again`),
      );
    });

    await waitFor(() => {
      expect(textOf(id, "status")).toBe("Up to date");
    });
    expect(posted(`/workspace-user-group/sync/${id}`)).toEqual([
      { onCallDutyPolicyScheduleId: PRIMARY_ID },
    ]);
  });

  test("Try again only where there is a problem", async () => {
    await renderCard();

    expect(
      within(row(PAYMENTS.workspaceUserGroupId)).queryByTestId(
        `user-group-${PAYMENTS.workspaceUserGroupId}-try-again`,
      ),
    ).toBeNull();
  });

  test("turned off in Slack by somebody: says so, and to turn it back on there", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000006";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        problem: WorkspaceUserGroupProblem.TurnedOffInWorkspace,
      }),
    ];

    await renderCard();

    expect(textOf(id, "status")).toBe("Turned off in Slack");
    expect(textOf(id, "status-text")).toBe(
      "Somebody turned @payments-oncall off in Slack, so nobody can mention it. OneUptime keeps its people up to date: turn it back on in Slack to use it.",
    );
  });

  test("somebody on call who cannot be in it is named, with why", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000007";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        leftOut: [{ ...BOB, reason: WorkspaceUserGroupLeftOutReason.Guest }],
      }),
    ];

    await renderCard();

    expect(textOf(id, "left-out")).toBe(
      "Bob Lee is on call but isn't in it: they are a guest in Slack, and Slack keeps guests out of user groups.",
    );
  });

  test("a Teams tag's member outside its team is named with the team", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000022";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        workspaceType: WorkspaceType.MicrosoftTeams,
        handle: null,
        teamName: "Payments",
        leftOut: [
          { ...BOB, reason: WorkspaceUserGroupLeftOutReason.NotInTeam },
        ],
      }),
    ];

    await renderCard([WorkspaceType.MicrosoftTeams]);

    expect(screen.getByText("Microsoft Teams tags")).toBeInTheDocument();
    expect(textOf(id, "left-out")).toBe(
      "Bob Lee is on call but isn't in it: they aren't in the Payments team in Microsoft Teams, and a tag holds only people in its team.",
    );
  });
});

describe("disconnecting", () => {
  test("from one of two schedules: says which it keeps following, then the row goes", async () => {
    const id: string = PAYMENTS.workspaceUserGroupId;

    await renderCard();

    await act(async () => {
      fireEvent.click(
        within(row(id)).getByTestId(`user-group-${id}-disconnect`),
      );
    });

    expect(
      screen.getByText("Disconnect @payments-oncall?"),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "@payments-oncall stops following this schedule. It keeps following Payments Secondary.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId(`user-group-${id}`)).toBeNull();
    });
    expect(posted("/workspace-user-group/disconnect")).toEqual([
      { workspaceUserGroupId: id, onCallDutyPolicyScheduleId: PRIMARY_ID },
    ]);
  });

  test("from its only schedule: OneUptime stops updating it, and the people in it stay", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000008";

    views = [viewOf({ workspaceUserGroupId: id })];

    await renderCard();

    await act(async () => {
      fireEvent.click(
        within(row(id)).getByTestId(`user-group-${id}-disconnect`),
      );
    });

    expect(document.body.textContent).toContain(
      "OneUptime stops updating @payments-oncall. The people in it now stay in it.",
    );
  });

  test("from one of several: how many others it keeps following", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000009";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        schedules: [PRIMARY, SECONDARY, DATABASE],
      }),
    ];

    await renderCard();

    await act(async () => {
      fireEvent.click(
        within(row(id)).getByTestId(`user-group-${id}-disconnect`),
      );
    });

    expect(document.body.textContent).toContain(
      "@payments-oncall stops following this schedule. It keeps following 2 other schedules.",
    );
  });
});

describe("who may change them", () => {
  test("somebody who may only read: no Connect, and Disconnect turned off with why", async () => {
    permissionsForTest = [Permission.Viewer];
    views = [
      viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-000000000010",
        problem: WorkspaceUserGroupProblem.Unavailable,
      }),
    ];

    await renderCard();

    const id: string = "8a000000-0000-4000-8000-000000000010";

    expect(
      within(row(id)).getByTestId(`user-group-${id}-disconnect`),
    ).toBeDisabled();
    expect(
      within(row(id)).getByTestId(`user-group-${id}-try-again`),
    ).toBeDisabled();
  });

  test("with nothing connected yet, somebody who may only read gets no Connect button", async () => {
    permissionsForTest = [Permission.Viewer];
    views = [];

    await renderCard();

    expect(screen.queryByTestId("user-groups-empty-connect-Slack")).toBeNull();
  });
});

describe("connecting", () => {
  function chooseGroup(label: string): void {
    const combobox: HTMLElement | null =
      document.querySelector<HTMLElement>("[role=combobox]");

    if (!combobox) {
      throw new Error("the Connect form has no user group list");
    }

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: 40, keyCode: 40 });
    fireEvent.click(screen.getByRole("option", { name: label }));
  }

  function offered(): Array<string> {
    const combobox: HTMLElement | null =
      document.querySelector<HTMLElement>("[role=combobox]");

    fireEvent.keyDown(combobox!, { key: "ArrowDown", code: 40, keyCode: 40 });

    return screen
      .queryAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });
  }

  async function openConnect(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId("user-groups-empty-connect-Slack"));
    });

    await waitFor(() => {
      expect(document.querySelector("[role=combobox]")).not.toBeNull();
    });
  }

  beforeEach(() => {
    views = [];
    available = {
      groups: [
        {
          workspaceGroupId: "S0SRE",
          name: "SRE",
          handle: "sre",
          userCount: 12,
          isTurnedOff: false,
          workspaceUserGroupId: null,
          followsScheduleNames: [],
        },
        {
          workspaceGroupId: "S0OLD",
          name: "Old pager",
          handle: "old-pager",
          userCount: 1,
          isTurnedOff: true,
          workspaceUserGroupId: null,
          followsScheduleNames: [],
        },
        {
          workspaceGroupId: "S0EVERY",
          name: "Everyone on call",
          handle: "oncall",
          userCount: 4,
          isTurnedOff: false,
          workspaceUserGroupId: "8a000000-0000-4000-8000-0000000000e1",
          followsScheduleNames: ["Database", "Payments Secondary"],
        },
      ],
      teams: [],
    };
  });

  test("the list: Create a new user group first, then the workspace's groups as people mention them", async () => {
    await renderCard();
    await openConnect();

    expect(offered()).toEqual([
      "Create a new user group",
      "@sre · SRE · 12 people",
      "@old-pager · Old pager · 1 person · turned off",
      "@oncall · Everyone on call · 4 people",
    ]);
  });

  test("a group picked says what connecting it does: who is replaced, a turned-off group turned on, the schedules it follows", async () => {
    await renderCard();
    await openConnect();

    chooseGroup("@sre · SRE · 12 people");
    expect(screen.getByTestId("connect-user-group-notes").textContent).toBe(
      "Its 12 people now are replaced with whoever is on call.",
    );

    chooseGroup("@old-pager · Old pager · 1 person · turned off");
    expect(
      Array.from(
        screen.getByTestId("connect-user-group-notes").querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "Its 1 person now is replaced with whoever is on call.",
      "It is turned off in Slack now. Connecting it turns it back on.",
    ]);

    chooseGroup("@oncall · Everyone on call · 4 people");
    expect(screen.getByTestId("connect-user-group-notes").textContent).toBe(
      "It follows 2 schedules already: it will hold the people on call in them and here.",
    );
  });

  test("a workspace's group: connected by its id, and its row appears", async () => {
    const id: string = "8a000000-0000-4000-8000-0000000000ff";

    connectAnswer = () => {
      return ok({
        userGroup: viewOf({
          workspaceUserGroupId: id,
          name: "SRE",
          handle: "sre",
        }) as unknown as JSONObject,
      });
    };

    await renderCard();
    await openConnect();
    chooseGroup("@sre · SRE · 12 people");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId(`user-group-${id}`)).toBeInTheDocument();
    });
    expect(posted("/workspace-user-group/connect")).toEqual([
      {
        onCallDutyPolicyScheduleId: PRIMARY_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceGroupId: "S0SRE",
      },
    ]);
    expect(textOf(id, "mention")).toBe("@sre");
  });

  test("a new group: named and handled from the schedule's name, sent as typed - '@' dropped", async () => {
    await renderCard();
    await openConnect();
    chooseGroup("Create a new user group");

    const name: HTMLInputElement = screen.getByDisplayValue(
      "Payments Primary on-call",
    ) as HTMLInputElement;
    const handle: HTMLInputElement = screen.getByDisplayValue(
      "payments-primary-oncall",
    ) as HTMLInputElement;

    expect(name).toBeInTheDocument();

    fireEvent.change(handle, { target: { value: "@payments-oncall" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(posted("/workspace-user-group/connect")).toHaveLength(1);
    });
    expect(posted("/workspace-user-group/connect")[0]).toEqual({
      onCallDutyPolicyScheduleId: PRIMARY_ID,
      workspaceType: WorkspaceType.Slack,
      newGroupName: "Payments Primary on-call",
      newGroupHandle: "payments-oncall",
    });
  });

  test("a handle Slack could not take is refused in the form, before the server is asked", async () => {
    await renderCard();
    await openConnect();
    chooseGroup("Create a new user group");

    fireEvent.change(screen.getByDisplayValue("payments-primary-oncall"), {
      target: { value: "Payments On Call!" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Use lower-case letters, numbers and hyphens, such as payments-oncall.",
        ),
      ).toBeInTheDocument();
    });
    expect(posted("/workspace-user-group/connect")).toEqual([]);
  });

  test("Slack refuses: its words in the dialog, which stays open with what was typed", async () => {
    connectAnswer = () => {
      return refused(
        "Slack already uses @payments-oncall for a person, a channel or another user group. Pick another handle.",
      );
    };

    await renderCard();
    await openConnect();
    chooseGroup("Create a new user group");

    fireEvent.change(screen.getByDisplayValue("payments-primary-oncall"), {
      target: { value: "payments-oncall" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Slack already uses @payments-oncall for a person, a channel or another user group. Pick another handle.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("payments-oncall")).toBeInTheDocument();
  });

  test("a group that follows this schedule already is not offered again", async () => {
    views = [
      viewOf({ workspaceUserGroupId: "8a000000-0000-4000-8000-0000000000e1" }),
    ];

    await renderCard();

    await act(async () => {
      fireEvent.click(screen.getByText("Connect user group"));
    });

    await waitFor(() => {
      expect(document.querySelector("[role=combobox]")).not.toBeNull();
    });

    expect(offered()).not.toContain("@oncall · Everyone on call · 4 people");
  });

  test("Microsoft Teams: the team the app is in and the tag's name, suggested from the schedule", async () => {
    available = {
      groups: [],
      teams: [{ teamId: "team-payments", name: "Payments" }],
    };

    await renderCard([WorkspaceType.MicrosoftTeams]);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("user-groups-empty-connect-MicrosoftTeams"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Payments Primary on-call"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(posted("/workspace-user-group/connect")).toHaveLength(1);
    });
    expect(posted("/workspace-user-group/connect")[0]).toEqual({
      onCallDutyPolicyScheduleId: PRIMARY_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceTeamId: "team-payments",
      tagName: "Payments Primary on-call",
    });
  });

  test("Microsoft Teams with the app in no team: says to add it, and offers nothing to send", async () => {
    available = { groups: [], teams: [] };

    await renderCard([WorkspaceType.MicrosoftTeams]);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("user-groups-empty-connect-MicrosoftTeams"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "OneUptime's app isn't in any team yet. Add it to a team in Microsoft Teams, then try again.",
        ),
      ).toBeInTheDocument();
    });
    expect(posted("/workspace-user-group/connect")).toEqual([]);
  });

  test("the list could not be read - a free Slack plan: said in the dialog", async () => {
    getMock.mockImplementation((async (options: {
      url: { toString: () => string };
    }) => {
      const url: string = options.url.toString();

      if (url.includes("/workspace-user-group/available")) {
        return refused(
          "User groups need a paid Slack plan. Upgrade your Slack workspace to use them.",
        );
      }

      return ok({ userGroups: [] });
    }) as never);

    await renderCard();

    await act(async () => {
      fireEvent.click(screen.getByTestId("user-groups-empty-connect-Slack"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "User groups need a paid Slack plan. Upgrade your Slack workspace to use them.",
        ),
      ).toBeInTheDocument();
    });
  });
});
