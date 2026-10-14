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
 * Try again (on the problem itself) and Disconnect (in the row's ⋯), and
 * who may press them; and Connect - a new Slack group, or a workspace's
 * group, or a Teams tag - sending what the server reads. An empty card is
 * the schedule page's empty panel (FeedEmptyState), a list that could not
 * be read the red alert with Try again. The words come from
 * UserGroupsCopy, whose own suite pins each sentence
 * (App/Tests/Dashboard/OnCallUserGroupsCopy.test.ts).
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

// The words of a row's status note, without the Try again beside them.
function noteOf(id: string): string {
  const note: HTMLElement | null = within(row(id)).queryByTestId(
    `user-group-${id}-status-text`,
  );

  if (!note) {
    return "";
  }

  const message: Element | null = note.querySelector(".alert-message > div");

  return (message || note).textContent || "";
}

// Opens a row's ⋯ menu and hands back its Disconnect.
async function openRowMenu(id: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(within(row(id)).getByTestId("row-actions-more-button"));
  });

  return screen.getByRole("menuitem", { name: "Disconnect" });
}

async function disconnectRow(id: string): Promise<void> {
  const item: HTMLElement = await openRowMenu(id);

  await act(async () => {
    fireEvent.click(item);
  });
}

// The Try again a row's problem carries: the alert's own button.
function tryAgainOf(id: string): HTMLElement | null {
  const note: HTMLElement | null = within(row(id)).queryByTestId(
    `user-group-${id}-status-text`,
  );

  return note ? within(note).queryByRole("button") : null;
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

  test("no group yet: the schedule page's empty panel - what one is for, with Connect user group as its one button", async () => {
    views = [];

    await renderCard();

    // The same panel the calendar cards under it show (FeedEmptyState).
    const empty: HTMLElement = screen.getByTestId("user-groups-Slack-empty-state");

    expect(
      within(empty).getByTestId("user-groups-Slack-empty-title").textContent,
    ).toBe("No user groups yet");
    expect(
      within(empty).getByTestId("user-groups-Slack-empty-description")
        .textContent,
    ).toBe(
      "Connect one, such as @payments-oncall, and OneUptime updates its members at every hand-off and override.",
    );

    const connect: HTMLElement = within(empty).getByTestId(
      "user-groups-Slack-connect",
    );

    expect(connect).toHaveTextContent("Connect user group");
    expect(connect).toBeEnabled();

    // Its one button: none in the card's header.
    expect(
      within(screen.getByTestId("card-header")).queryByRole("button"),
    ).toBeNull();
  });

  test("Microsoft Teams with no tag yet: its own words", async () => {
    views = [];

    await renderCard([WorkspaceType.MicrosoftTeams]);

    expect(
      screen.getByTestId("user-groups-MicrosoftTeams-empty-title").textContent,
    ).toBe("No tags yet");
    expect(
      screen.getByTestId("user-groups-MicrosoftTeams-empty-description")
        .textContent,
    ).toBe(
      "Connect one, such as @Payments on-call, and OneUptime updates its members at every hand-off and override.",
    );
    expect(
      screen.getByTestId("user-groups-MicrosoftTeams-connect"),
    ).toHaveTextContent("Connect tag");
  });

  test("the groups could not be read: said in red, with the server's reason, and Try again reads them again", async () => {
    let isRefused: boolean = true;

    getMock.mockImplementation((async () => {
      if (isRefused) {
        return refused("You do not have permission to read this schedule.");
      }

      return ok({ userGroups: [PAYMENTS] as unknown as Array<JSONObject> });
    }) as never);

    await renderCard();

    const alert: HTMLElement = screen.getByTestId("user-groups-Slack-load-error");

    expect(alert).toHaveTextContent("Could not load the user groups.");
    expect(alert).toHaveTextContent(
      "You do not have permission to read this schedule.",
    );
    expect(alert).toHaveTextContent("Try again");

    isRefused = false;

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button"));
    });

    await waitFor(() => {
      expect(row(PAYMENTS.workspaceUserGroupId)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("user-groups-Slack-load-error")).toBeNull();
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
    expect(
      within(row(id)).getByTestId(`user-group-${id}-members`)
        .previousElementSibling?.textContent,
    ).toBe("Members");
    // Nothing to explain: no note, and no Try again.
    expect(within(row(id)).queryByTestId(`user-group-${id}-status-text`)).toBeNull();
    expect(within(row(id)).queryByText("Try again")).toBeNull();

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

  test("nobody on call: Nobody on call, and why the group is off - no member list to say it again", async () => {
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
    expect(
      within(row(id)).queryByTestId(`user-group-${id}-members`),
    ).toBeNull();
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
      "OneUptime is adding whoever is on call now.",
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
    expect(noteOf(id)).toBe(
      "Slack lets only workspace owners and admins change user groups in your workspace, so OneUptime can't update @payments-oncall. A Slack admin can let everyone manage user groups in Slack's admin settings, under Permissions > User Groups.",
    );
    // A problem is said in red, with Try again beside it.
    expect(
      within(row(id)).getByTestId(`user-group-${id}-status-text`),
    ).toHaveClass("bg-red-50");
    expect(textOf(id, "status-text")).toContain("Try again");
    expect(textOf(id, "time")).toBe("Last up to date 2 hours ago");

    await act(async () => {
      fireEvent.click(tryAgainOf(id)!);
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

    expect(tryAgainOf(PAYMENTS.workspaceUserGroupId)).toBeNull();
    expect(
      within(row(PAYMENTS.workspaceUserGroupId)).queryByText("Try again"),
    ).toBeNull();
  });

  test("Try again: the row keeps its place among the others while it is looked at again", async () => {
    const first: string = "8a000000-0000-4000-8000-000000000031";
    const second: string = "8a000000-0000-4000-8000-000000000032";

    views = [
      viewOf({
        workspaceUserGroupId: first,
        handle: "first-oncall",
        problem: WorkspaceUserGroupProblem.Unavailable,
      }),
      viewOf({ workspaceUserGroupId: second, handle: "second-oncall" }),
    ];
    syncAnswer = () => {
      return ok({
        userGroup: viewOf({
          workspaceUserGroupId: first,
          handle: "first-oncall",
        }) as unknown as JSONObject,
      });
    };

    await renderCard();

    await act(async () => {
      fireEvent.click(tryAgainOf(first)!);
    });

    await waitFor(() => {
      expect(textOf(first, "status")).toBe("Up to date");
    });

    expect(
      within(screen.getByTestId("user-groups-Slack"))
        .getAllByRole("listitem")
        .filter((item: HTMLElement): boolean => {
          return (item.getAttribute("data-testid") || "").startsWith(
            "user-group-",
          );
        })
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-testid");
        }),
    ).toEqual([`user-group-${first}`, `user-group-${second}`]);
  });

  test("Try again fails: said above the list, in red", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000033";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        problem: WorkspaceUserGroupProblem.Unavailable,
      }),
    ];
    syncAnswer = () => {
      return refused("Slack didn't answer. Try again in a minute.");
    };

    await renderCard();

    await act(async () => {
      fireEvent.click(tryAgainOf(id)!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("user-groups-Slack-error")).toHaveTextContent(
        "Slack didn't answer. Try again in a minute.",
      );
    });
  });

  test("refused before it was ever in step: no member list - OneUptime does not know who is in it", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000034";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        members: [],
        problem: WorkspaceUserGroupProblem.MissingScope,
        syncedAt: null,
        checkedAt: minutesAgo(1),
      }),
    ];

    await renderCard();

    expect(
      within(row(id)).queryByTestId(`user-group-${id}-members`),
    ).toBeNull();
    expect(noteOf(id)).toBe(
      "OneUptime's Slack app isn't allowed to change user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.",
    );
    expect(textOf(id, "time")).toBe("Checked 1 minute ago");
  });

  test("in step once, refused since, with nobody in it: None", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000035";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        members: [],
        problem: WorkspaceUserGroupProblem.Gone,
      }),
    ];

    await renderCard();

    expect(textOf(id, "members")).toBe("None");
  });

  test("a refusal Slack gave no words for: said without a dangling colon", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000036";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        problem: WorkspaceUserGroupProblem.Refused,
        problemDetail: null,
      }),
    ];

    await renderCard();

    expect(noteOf(id)).toBe("Slack refused the change.");
  });

  test("a long handle wraps where its hyphens are, never mid-word", async () => {
    const id: string = "8a000000-0000-4000-8000-000000000037";

    views = [
      viewOf({
        workspaceUserGroupId: id,
        handle:
          "payments-checkout-and-billing-platform-engineers-oncall-this-week",
      }),
    ];

    await renderCard();

    const mention: HTMLElement = within(row(id)).getByTestId(
      `user-group-${id}-mention`,
    );

    expect(mention).toHaveClass("break-words");
    expect(mention).not.toHaveClass("break-all");
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
    expect(
      within(row(id)).getByTestId(`user-group-${id}-status-text`),
    ).toHaveClass("bg-amber-50");
    expect(tryAgainOf(id)).toBeNull();
    expect(noteOf(id)).toBe(
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
      "Bob Lee is on call but isn't in the group: they are a guest in Slack, and Slack keeps guests out of user groups.",
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
      "Bob Lee is on call but isn't in the tag: a tag holds only people in its team, and they aren't in the Payments team. Add them to it in Microsoft Teams.",
    );
  });
});

describe("disconnecting", () => {
  test("from one of two schedules: says which it keeps following, then the row goes", async () => {
    const id: string = PAYMENTS.workspaceUserGroupId;

    await renderCard();

    // Rare and destructive: in the row's ⋯, named for the group.
    expect(
      within(row(id)).getByTestId("row-actions-more-button"),
    ).toHaveAttribute("aria-label", "More actions for @payments-oncall");

    await disconnectRow(id);

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

    await disconnectRow(id);

    expect(document.body.textContent).toContain(
      "OneUptime stops updating @payments-oncall. Its members stay as they are.",
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

    await disconnectRow(id);

    expect(document.body.textContent).toContain(
      "@payments-oncall stops following this schedule. It keeps following 2 other schedules.",
    );
  });
});

describe("who may change them", () => {
  test("somebody who may only read: the problem without Try again, and Disconnect locked in the menu, saying why", async () => {
    permissionsForTest = [Permission.Viewer];
    views = [
      viewOf({
        workspaceUserGroupId: "8a000000-0000-4000-8000-000000000010",
        problem: WorkspaceUserGroupProblem.Unavailable,
      }),
    ];

    await renderCard();

    const id: string = "8a000000-0000-4000-8000-000000000010";

    // The problem is said, with nothing to press.
    expect(noteOf(id)).toContain("Slack didn't answer");
    expect(tryAgainOf(id)).toBeNull();
    expect(textOf(id, "status-text")).not.toContain("Try again");

    const disconnect: HTMLElement = await openRowMenu(id);

    expect(disconnect).toHaveAttribute("aria-disabled", "true");
    expect(disconnect).toHaveAccessibleDescription(
      /You do not have permission to create this user group\./,
    );

    await act(async () => {
      fireEvent.click(disconnect);
    });

    expect(screen.queryByText("Disconnect @payments-oncall?")).toBeNull();
  });

  test("with nothing connected yet, somebody who may only read sees Connect locked, saying why", async () => {
    permissionsForTest = [Permission.Viewer];
    views = [];

    await renderCard();

    const connect: HTMLElement = screen.getByTestId("user-groups-Slack-connect");

    expect(connect).toBeDisabled();

    await act(async () => {
      fireEvent.click(connect);
    });

    expect(document.querySelector("[role=combobox]")).toBeNull();
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
      fireEvent.click(screen.getByTestId("user-groups-Slack-connect"));
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
      "OneUptime replaces its 12 members with whoever is on call.",
    );

    chooseGroup("@old-pager · Old pager · 1 person · turned off");
    expect(
      Array.from(
        screen.getByTestId("connect-user-group-notes").querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "OneUptime replaces its 1 member with whoever is on call.",
      "It is turned off in Slack now. Connecting it turns it back on.",
    ]);

    chooseGroup("@oncall · Everyone on call · 4 people");
    expect(screen.getByTestId("connect-user-group-notes").textContent).toBe(
      "It already follows 2 schedules, so it will hold whoever is on call in them and here.",
    );
  });

  test("a workspace with no user group to pick: the form opens on Create a new user group, its name and handle ready", async () => {
    available = { groups: [], teams: [] };

    await renderCard();
    await openConnect();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Payments Primary on-call"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByDisplayValue("payments-primary-oncall"),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain("Create a new user group");

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
      newGroupHandle: "payments-primary-oncall",
    });
  });

  test("a workspace with user groups: the form waits for a pick", async () => {
    await renderCard();
    await openConnect();

    expect(screen.queryByDisplayValue("payments-primary-oncall")).toBeNull();
    expect(document.body.textContent).toContain("Pick a user group");
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
      fireEvent.click(screen.getByTestId("user-groups-MicrosoftTeams-connect"));
    });

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Payments Primary on-call"),
      ).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain(
      "Only teams that have the OneUptime app are listed.",
    );
    expect(document.body.textContent).toContain(
      "OneUptime uses the team's tag with this name, or creates one.",
    );

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
      fireEvent.click(screen.getByTestId("user-groups-MicrosoftTeams-connect"));
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
      fireEvent.click(screen.getByTestId("user-groups-Slack-connect"));
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
