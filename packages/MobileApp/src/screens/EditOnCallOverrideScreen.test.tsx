import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest as jestGlobal,
  test,
} from "@jest/globals";
import EditOnCallOverrideScreen, {
  AWAY_LOCKED_TEXT,
  NO_TEAMMATE_REFUSAL,
  START_LOCKED_TEXT,
  buildOverrideChange,
  hasAnyChange,
} from "./EditOnCallOverrideScreen";
import {
  OVERRIDE_ENDED_REFUSAL,
  OVERRIDE_CONFLICT_WHAT_TO_DO,
} from "../oncall/overrideEdit";
import {
  clearAllProjectPermissions,
  recordProjectPermissions,
} from "../api/projectPermissions";
import type { OverrideTeamPeopleState } from "../hooks/useOverrideTeamPeople";
import {
  OVERRIDE_TEAM_COVER_REFUSAL,
  OVERRIDE_TEAM_EDIT_REFUSAL,
  OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
} from "../oncall/overrideTeamAccess";
import type { OnCallOverrideChange } from "../api/onCallOverrides";
import type { OnCallOverrideItem, ProjectUserItem } from "../api/types";

/*
 * EDIT ONE OVERRIDE FROM THE PHONE (#7897), held to the dashboard's rules.
 *
 *   - Who is away is shown, never changed.
 *   - An upcoming override's times and who covers change, and only what
 *     changed is sent.
 *   - A running override's start is shown, locked, and never sent; its end
 *     counts from now; End now asks first, then ends it.
 *   - An override that has ended has no form, only why.
 *   - A refusal is the server's whole sentence; one for an overlap offers
 *     that override's edit, in this sheet's place.
 */

type HostElement = ReturnType<typeof screen.getByTestId>;

const ME: string = "user-me";
const PRIYA: string = "user-priya";
const PAT: string = "user-pat";

const USERS: ProjectUserItem[] = [
  { userId: ME, name: "Ada Lovelace", email: "ada@example.com" },
  { userId: PRIYA, name: "Priya Rao", email: "priya@example.com" },
  { userId: PAT, name: "Pat Kim", email: "pat@example.com" },
];

// Half a minute into noon, 13 November 2026.
const NOW: number = new Date("2026-11-13T12:00:30.000Z").getTime();
const HOUR: number = 60 * 60 * 1000;

const mockGoBack: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockReplace: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockUpdate: jest.Mock = jestGlobal.fn(async (): Promise<void> => {
  return undefined;
}) as unknown as jest.Mock;
const mockEndNow: jest.Mock = jestGlobal.fn(async (): Promise<void> => {
  return undefined;
}) as unknown as jest.Mock;
const mockFindConflict: jest.Mock = jestGlobal.fn(async (): Promise<null> => {
  return null;
}) as unknown as jest.Mock;
const mockOverride: { current: OnCallOverrideItem | null } = { current: null };
const mockUsers: { current: ProjectUserItem[] } = { current: [] };

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { goBack: mockGoBack, navigate: jest.fn(), replace: mockReplace };
    },
    useRoute: () => {
      return { params: { override: mockOverride.current } };
    },
  };
});

jest.mock("../hooks/useOnCallOverrides", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../hooks/useOnCallOverrides",
  );

  return {
    ...actual,
    useOnCallOverrides: () => {
      return {
        active: [],
        upcoming: [],
        past: [],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        createOverride: jest.fn(),
        isCreating: false,
        cancelOverride: jest.fn(),
        isCancelling: false,
        updateOverride: (...args: Array<unknown>) => {
          return mockUpdate(...args);
        },
        isUpdating: false,
        endOverrideNow: (...args: Array<unknown>) => {
          return mockEndNow(...args);
        },
        isEnding: false,
      };
    },
    findOverlapConflict: (...args: Array<unknown>) => {
      return mockFindConflict(...args);
    },
  };
});

jest.mock("../hooks/useProjectUsers", () => {
  return {
    useProjectUsers: () => {
      return {
        users: mockUsers.current,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      };
    },
  };
});

/*
 * The people of the teams the sheet is kept to (useOverrideTeamPeople):
 * what a test says, and what each render asked for. Asked with no teams,
 * nothing is known, as the hook answers.
 */
const mockTeamPeople: { current: OverrideTeamPeopleState | null } = {
  current: null,
};
const mockTeamPeopleAsked: Array<{
  projectId: string | null;
  teamIds: ReadonlyArray<string> | null;
}> = [];

jest.mock("../hooks/useOverrideTeamPeople", () => {
  return {
    useOverrideTeamPeople: (data: {
      projectId: string | null;
      teamIds: ReadonlyArray<string> | null;
    }): OverrideTeamPeopleState => {
      mockTeamPeopleAsked.push(data);

      if (data.teamIds && mockTeamPeople.current) {
        return mockTeamPeople.current;
      }

      return {
        users: [],
        membersByTeam: null,
        teamNames: null,
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      };
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date("2026-11-13T12:00:30.000Z").getTime();
    },
  };
});

jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return "user-me";
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        selectionFeedback: jest.fn(),
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
      };
    },
  };
});

function override(data: Partial<OnCallOverrideItem>): OnCallOverrideItem {
  return {
    _id: "override-1",
    projectId: "project-1",
    projectName: "Acme",
    overrideUser: { _id: ME, name: "Ada Lovelace" },
    routeAlertsToUser: { _id: PRIYA, name: "Priya Rao" },
    onCallDutyPolicy: null,
    onCallDutyPolicyId: null,
    startsAt: "2026-11-14T09:00:00.000Z",
    endsAt: "2026-11-14T17:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...data,
  };
}

// Ada, covered by Priya tomorrow, 9 to 5.
const UPCOMING: OnCallOverrideItem = override({});

// Ada, covered by Priya since this morning, until tonight.
const RUNNING: OnCallOverrideItem = override({
  _id: "override-running",
  startsAt: "2026-11-13T08:00:00.000Z",
  endsAt: "2026-11-13T20:00:00.000Z",
});

// Ada, covered by Priya last week.
const ENDED: OnCallOverrideItem = override({
  _id: "override-ended",
  startsAt: "2026-11-05T09:00:00.000Z",
  endsAt: "2026-11-06T09:00:00.000Z",
});

// As axios rejects a request the server answered with a 400 and a message.
function serverRefusal(message: string): Error {
  return Object.assign(new Error("Request failed with status code 400"), {
    isAxiosError: true,
    response: { status: 400, data: { message: message } },
  });
}

function lastChange(): OnCallOverrideChange {
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  return mockUpdate.mock.calls[0]![1] as OnCallOverrideChange;
}

let alertSpy: jest.SpyInstance;
let nowSpy: jest.SpyInstance;

beforeEach(() => {
  mockGoBack.mockClear();
  mockReplace.mockClear();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined as never);
  mockEndNow.mockReset();
  mockEndNow.mockResolvedValue(undefined as never);
  mockFindConflict.mockReset();
  mockFindConflict.mockResolvedValue(null as never);
  mockOverride.current = UPCOMING;
  mockUsers.current = USERS;
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
    return undefined;
  });
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  alertSpy.mockRestore();
  nowSpy.mockRestore();
});

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    await fireEvent.press(screen.getByTestId("save-override"));
  });
}

describe("what the sheet sends", () => {
  const saved: { startsAt: Date; endsAt: Date } = {
    startsAt: new Date("2026-11-14T09:00:00.000Z"),
    endsAt: new Date("2026-11-14T17:00:00.000Z"),
  };

  test("nothing chosen is nothing sent", () => {
    const change: OnCallOverrideChange = buildOverrideChange({
      saved,
      savedCoverId: PRIYA,
      coverChoice: "person",
      coverUserId: PRIYA,
      startChoice: "saved",
      endChoice: "saved",
      now: NOW,
    });

    expect(change).toEqual({});
    expect(hasAnyChange(change)).toBe(false);
  });

  test("the rotation covering is sent as no one; a skip given a teammate names them", () => {
    expect(
      buildOverrideChange({
        saved,
        savedCoverId: PRIYA,
        coverChoice: "rotation",
        coverUserId: PRIYA,
        startChoice: "saved",
        endChoice: "saved",
        now: NOW,
      }),
    ).toEqual({ routeAlertsToUserId: null });
    expect(
      buildOverrideChange({
        saved,
        savedCoverId: null,
        coverChoice: "person",
        coverUserId: PAT,
        startChoice: "saved",
        endChoice: "saved",
        now: NOW,
      }),
    ).toEqual({ routeAlertsToUserId: PAT });
  });

  test("a start of now is this minute, and an end of so many hours counts from the start", () => {
    const change: OnCallOverrideChange = buildOverrideChange({
      saved,
      savedCoverId: PRIYA,
      coverChoice: "person",
      coverUserId: PRIYA,
      startChoice: "now",
      endChoice: 4,
      now: NOW,
    });

    expect(change.startsAt?.toISOString()).toBe("2026-11-13T12:00:00.000Z");
    expect(change.endsAt?.toISOString()).toBe("2026-11-13T16:00:00.000Z");
  });

  test("under way, an end of so many hours counts from now", () => {
    const change: OnCallOverrideChange = buildOverrideChange({
      saved: {
        startsAt: new Date("2026-11-13T08:00:00.000Z"),
        endsAt: new Date("2026-11-13T20:00:00.000Z"),
      },
      savedCoverId: PRIYA,
      coverChoice: "person",
      coverUserId: PRIYA,
      startChoice: "saved",
      endChoice: 2,
      now: NOW,
    });

    expect(change.startsAt).toBeUndefined();
    expect(change.endsAt?.getTime()).toBe(NOW + 2 * HOUR);
  });
});

describe("editing an override that has not started", () => {
  test("opens as saved: who is away shown, never changed; who covers; nothing to save yet", async () => {
    await render(<EditOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("edit-override-away")).getByText("You"),
    ).toBeTruthy();
    expect(screen.getByText(AWAY_LOCKED_TEXT)).toBeTruthy();
    expect(
      within(screen.getByTestId("edit-override-cover")).getByText("Priya Rao"),
    ).toBeTruthy();
    expect(screen.getByTestId("edit-override-start-now")).toBeTruthy();
    expect(screen.queryByTestId("edit-override-start-locked")).toBeNull();
    // Nothing to end yet: it is called off with Cancel on its card.
    expect(screen.queryByTestId("edit-override-end-now")).toBeNull();
    expect(
      screen.getByTestId("save-override").props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }));
  });

  test("its cover and its times change, and only what changed is sent", async () => {
    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-cover"));
    await fireEvent.press(screen.getByTestId(`user-option-${PAT}`));
    await fireEvent.press(screen.getByTestId("edit-override-start-now"));
    await fireEvent.press(screen.getByTestId("edit-override-end-4"));

    expect(
      screen.getByTestId("edit-override-preview-times").props.children,
    ).toMatch(/^Starts Today .+, ends Today .+\.$/);

    await save();

    expect(mockUpdate.mock.calls[0]![0]).toBe(UPCOMING);

    const change: OnCallOverrideChange = lastChange();

    expect(change.routeAlertsToUserId).toBe(PAT);
    expect(change.startsAt?.toISOString()).toBe("2026-11-13T12:00:00.000Z");
    expect(change.endsAt?.toISOString()).toBe("2026-11-13T16:00:00.000Z");
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("who covers handed to the rotation is sent as no one", async () => {
    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByText("The rotation"));

    expect(screen.getByTestId("edit-override-rotation-covers")).toBeTruthy();

    await save();

    expect(lastChange()).toEqual({ routeAlertsToUserId: null });
  });

  test("the person away is never offered to cover for themselves", async () => {
    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-cover"));

    expect(screen.queryByTestId(`user-option-${ME}`)).toBeNull();
    expect(screen.getByTestId(`user-option-${PAT}`)).toBeTruthy();
  });

  test("a skip asked for a teammate with none chosen says so, and sends nothing", async () => {
    mockOverride.current = override({ routeAlertsToUser: null });

    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByText("A teammate"));
    await fireEvent.press(screen.getByTestId("edit-override-end-8"));
    await save();

    expect(
      within(screen.getByTestId("edit-override-error")).getByText(
        NO_TEAMMATE_REFUSAL,
      ),
    ).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("editing an override under way", () => {
  beforeEach(() => {
    mockOverride.current = RUNNING;
  });

  test("its start is shown, locked, saying why, and never sent; its end counts from now", async () => {
    await render(<EditOnCallOverrideScreen />);

    expect(screen.getByTestId("edit-override-start-locked")).toBeTruthy();
    expect(screen.getByText(START_LOCKED_TEXT)).toBeTruthy();
    expect(screen.queryByTestId("edit-override-start-now")).toBeNull();
    expect(screen.getByText("In 2 hours")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("edit-override-end-2"));
    await save();

    const change: OnCallOverrideChange = lastChange();

    expect(change.startsAt).toBeUndefined();
    expect(change.endsAt?.getTime()).toBe(NOW + 2 * HOUR);
    expect(change.routeAlertsToUserId).toBeUndefined();
  });

  test("End now asks first, saying who stops covering and who is paged again, then ends it", async () => {
    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-end-now"));

    expect(mockEndNow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "End this override now?",
      expect.stringMatching(
        /^Priya Rao stops covering for you now instead of Today .+\. From then on, your pages come to you again\.$/,
      ),
      expect.any(Array),
    );

    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];

    await act(async (): Promise<void> => {
      buttons
        .find((button: { style?: string }) => {
          return button.style === "destructive";
        })
        ?.onPress?.();
    });

    expect(mockEndNow).toHaveBeenCalledWith(RUNNING);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("an override that ends between opening the sheet and saving is refused before anything is sent", async () => {
    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-cover"));
    await fireEvent.press(screen.getByTestId(`user-option-${PAT}`));

    // Saved after it ended.
    nowSpy.mockReturnValue(new Date("2026-11-13T21:00:00.000Z").getTime());
    await save();

    expect(
      within(screen.getByTestId("edit-override-error")).getByText(
        OVERRIDE_ENDED_REFUSAL,
      ),
    ).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("an override that has ended", () => {
  test("has no form: only why it can't be changed", async () => {
    mockOverride.current = ENDED;

    await render(<EditOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("edit-override-locked")).getByText(
        OVERRIDE_ENDED_REFUSAL,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("save-override")).toBeNull();
    expect(screen.queryByTestId("edit-override-end-now")).toBeNull();
  });
});

describe("a refusal", () => {
  const REFUSAL: string = `Ada Lovelace is already covered by Pat Kim on every policy from Nov 14, 2026, 15:00 UTC to Nov 14, 2026, 20:00 UTC. ${OVERRIDE_CONFLICT_WHAT_TO_DO}`;

  test("for an overlap is said whole and offers that override's edit, in the sheet's place", async () => {
    const other: OnCallOverrideItem = override({
      _id: "override-other",
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
      startsAt: "2026-11-14T15:00:00.000Z",
      endsAt: "2026-11-14T20:00:00.000Z",
    });

    mockUpdate.mockRejectedValueOnce(serverRefusal(REFUSAL) as never);
    mockFindConflict.mockResolvedValueOnce(other as never);

    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-end-12"));
    await save();

    // The read for it: this override, the person away, the times it would have.
    const asked: {
      candidate: {
        id: string;
        overrideUserId: string;
        onCallDutyPolicyId: string | null;
        startsAt: Date;
        endsAt: Date;
      };
    } = mockFindConflict.mock.calls[0]![0] as never;

    expect(asked.candidate.id).toBe(UPCOMING._id);
    expect(asked.candidate.overrideUserId).toBe(ME);
    expect(asked.candidate.onCallDutyPolicyId).toBeNull();
    expect(asked.candidate.startsAt.toISOString()).toBe(UPCOMING.startsAt);
    expect(asked.candidate.endsAt.toISOString()).toBe(
      "2026-11-14T21:00:00.000Z",
    );

    const banner: HostElement = screen.getByTestId("edit-override-error");

    expect(within(banner).getByText(REFUSAL)).toBeTruthy();

    await fireEvent.press(within(banner).getByText("Edit that override"));

    expect(mockReplace).toHaveBeenCalledWith("EditOnCallOverride", {
      override: other,
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test("that is no overlap is said whole, with nothing else to open", async () => {
    mockUpdate.mockRejectedValueOnce(
      serverRefusal(
        "This override has already started, so when it starts can't be changed. You can still change when it ends, or who covers.",
      ) as never,
    );

    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("edit-override-start-now"));
    await save();

    expect(
      screen.getByText(
        "This override has already started, so when it starts can't be changed. You can still change when it ends, or who covers.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Edit that override")).toBeNull();
    expect(mockFindConflict).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

/*
 * #9883: for someone who manages the user overrides of their own teams'
 * people only (Manage On-Call Policy User Overrides for Own Team), an
 * override naming anybody outside those teams is not theirs to change: the
 * server refuses any edit of it, End now included, so the sheet says why in
 * place of the form, in the server's words. One of theirs offers only the
 * teams' people to cover, saying which teams - as the Dashboard's Edit does.
 */
describe("for someone who manages their own team's overrides", () => {
  const TEAM_PAYMENTS: string = "team-payments";
  const OUTSIDER: string = "user-outsider";

  const OUTSIDER_USER: ProjectUserItem = {
    userId: OUTSIDER,
    name: "Omar Okafor",
    email: "omar@example.com",
  };

  // Ada and Priya are in Payments; Pat and Omar in no team of Ada's.
  const PAYMENTS_PEOPLE: OverrideTeamPeopleState = {
    users: [USERS[0]!, USERS[1]!],
    membersByTeam: new Map<string, Set<string>>([
      [TEAM_PAYMENTS, new Set<string>([ME, PRIYA])],
    ]),
    teamNames: ["Payments"],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  };

  function holding(rows: Array<Record<string, unknown>>): void {
    recordProjectPermissions("project-1", {
      "project-permissions": JSON.stringify({
        _type: "UserTenantAccessPermission",
        projectId: { _type: "ObjectID", value: "project-1" },
        permissions: rows,
      }),
    });
  }

  function row(
    permission: string,
    data: { teamId?: string; scope?: string; labelIds?: Array<unknown> } = {},
  ): Record<string, unknown> {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: data.labelIds ?? [],
      scope: data.scope ?? "All",
      isBlockPermission: false,
      ...(data.teamId
        ? { teamId: { _type: "ObjectID", value: data.teamId } }
        : {}),
    };
  }

  const TEAM_SCOPED: Array<Record<string, unknown>> = [
    row("OnCallViewer"),
    row("ManageTeamOnCallDutyPolicyUserOverride", { teamId: TEAM_PAYMENTS }),
  ];

  function lastTeamPeopleAsked(): (typeof mockTeamPeopleAsked)[number] {
    return mockTeamPeopleAsked[mockTeamPeopleAsked.length - 1]!;
  }

  beforeEach(() => {
    clearAllProjectPermissions();
    mockTeamPeopleAsked.length = 0;
    mockTeamPeople.current = PAYMENTS_PEOPLE;
    // The whole project, an outsider among them: what the sheet must not offer.
    mockUsers.current = [...USERS, OUTSIDER_USER];
  });

  afterEach(() => {
    clearAllProjectPermissions();
    mockTeamPeople.current = null;
  });

  test("an override covered by somebody outside the teams: why, in place of the form, with nothing to save or end", async () => {
    holding(TEAM_SCOPED);
    mockOverride.current = override({
      _id: "override-running",
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
      startsAt: "2026-11-13T08:00:00.000Z",
      endsAt: "2026-11-13T20:00:00.000Z",
    });

    await render(<EditOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("edit-override-team-locked")).getByText(
        OVERRIDE_TEAM_EDIT_REFUSAL,
      ),
    ).toBeTruthy();
    // Which override it is: who is away, who covers, where.
    expect(
      within(screen.getByTestId("edit-override-away")).getByText("You"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("edit-override-locked-cover").props.children,
    ).toBe("Pat Kim");
    expect(screen.getByText("All on-call policies")).toBeTruthy();
    expect(screen.queryByTestId("save-override")).toBeNull();
    expect(screen.queryByTestId("edit-override-end-now")).toBeNull();
    expect(screen.queryByTestId("edit-override-cover")).toBeNull();
    expect(lastTeamPeopleAsked()).toEqual({
      projectId: "project-1",
      teamIds: [TEAM_PAYMENTS],
    });
  });

  test("one whose person away is outside the teams is locked the same way, a skip too", async () => {
    holding(TEAM_SCOPED);
    mockOverride.current = override({
      overrideUser: { _id: PAT, name: "Pat Kim" },
      routeAlertsToUser: null,
    });

    await render(<EditOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("edit-override-team-locked")).getByText(
        OVERRIDE_TEAM_EDIT_REFUSAL,
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId("edit-override-locked-cover").props.children,
    ).toBe("Next person in the rotation");
    expect(screen.queryByTestId("save-override")).toBeNull();
  });

  test("one of the team's people: the form, the picker offering only the team, and saying which", async () => {
    holding(TEAM_SCOPED);

    await render(<EditOnCallOverrideScreen />);

    expect(screen.queryByTestId("edit-override-team-locked")).toBeNull();

    await fireEvent.press(screen.getByTestId("edit-override-cover"));

    expect(screen.getByTestId(`user-option-${PRIYA}`)).toBeTruthy();
    expect(screen.queryByTestId(`user-option-${PAT}`)).toBeNull();
    expect(screen.queryByTestId(`user-option-${OUTSIDER}`)).toBeNull();
    expect(
      within(screen.getByTestId("user-picker-hint")).getByText(
        "Only people in Payments are listed: the teams that let you manage user overrides.",
      ),
    ).toBeTruthy();
  });

  test("handing a teammate's cover to the rotation saves, as before", async () => {
    holding(TEAM_SCOPED);

    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByText("The rotation"));
    await save();

    expect(lastChange()).toEqual({ routeAlertsToUserId: null });
  });

  test("nobody else in the teams to cover: the picker says so", async () => {
    holding(TEAM_SCOPED);
    // Ada away on her own: only Ada in the team.
    mockTeamPeople.current = {
      ...PAYMENTS_PEOPLE,
      users: [USERS[0]!],
      membersByTeam: new Map<string, Set<string>>([
        [TEAM_PAYMENTS, new Set<string>([ME])],
      ]),
    };
    mockOverride.current = override({ routeAlertsToUser: null });

    await render(<EditOnCallOverrideScreen />);

    await fireEvent.press(screen.getByText("A teammate"));
    await fireEvent.press(screen.getByTestId("edit-override-cover"));

    expect(
      within(screen.getByTestId("user-picker-empty")).getByText(
        OVERRIDE_TEAM_PICKER_EMPTY_TEXT,
      ),
    ).toBeTruthy();
  });

  test("somebody picked to cover before the server said whom they may name is refused before anything is sent", async () => {
    await render(<EditOnCallOverrideScreen />);

    // The whole project, until the rows arrive.
    await fireEvent.press(screen.getByTestId("edit-override-cover"));
    await fireEvent.press(screen.getByTestId(`user-option-${OUTSIDER}`));

    await act(async (): Promise<void> => {
      holding(TEAM_SCOPED);
    });

    await save();

    expect(
      within(screen.getByTestId("edit-override-error")).getByText(
        OVERRIDE_TEAM_COVER_REFUSAL,
      ),
    ).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("while who is in the teams is not known nothing is locked: the server decides", async () => {
    holding(TEAM_SCOPED);
    mockTeamPeople.current = { ...PAYMENTS_PEOPLE, membersByTeam: null };
    mockOverride.current = override({
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
    });

    await render(<EditOnCallOverrideScreen />);

    expect(screen.queryByTestId("edit-override-team-locked")).toBeNull();
    expect(screen.getByTestId("save-override")).toBeTruthy();
  });

  test("a policy's override, beside a role narrowed to a label, is the server's to weigh: the form, everyone offered", async () => {
    holding([
      ...TEAM_SCOPED,
      row("OnCallMember", {
        scope: "Labels",
        labelIds: [{ _type: "ObjectID", value: "label-team-a" }],
      }),
    ]);
    mockOverride.current = override({
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
      onCallDutyPolicyId: "policy-1",
      onCallDutyPolicy: { _id: "policy-1", name: "Payments Primary" },
    });

    await render(<EditOnCallOverrideScreen />);

    expect(lastTeamPeopleAsked().teamIds).toBeNull();
    expect(screen.queryByTestId("edit-override-team-locked")).toBeNull();

    await fireEvent.press(screen.getByTestId("edit-override-cover"));

    expect(screen.getByTestId(`user-option-${OUTSIDER}`)).toBeTruthy();
  });

  test("the same override held globally keeps to the team, as a narrower role cannot reach it", async () => {
    holding([
      ...TEAM_SCOPED,
      row("OnCallMember", {
        scope: "Labels",
        labelIds: [{ _type: "ObjectID", value: "label-team-a" }],
      }),
    ]);
    mockOverride.current = override({
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
    });

    await render(<EditOnCallOverrideScreen />);

    expect(lastTeamPeopleAsked().teamIds).toEqual([TEAM_PAYMENTS]);
    expect(screen.getByTestId("edit-override-team-locked")).toBeTruthy();
  });

  test("a permission that reaches everyone: the form and the whole project, as before", async () => {
    holding([row("OnCallMember"), ...TEAM_SCOPED]);
    mockOverride.current = override({
      routeAlertsToUser: { _id: PAT, name: "Pat Kim" },
    });

    await render(<EditOnCallOverrideScreen />);

    expect(lastTeamPeopleAsked().teamIds).toBeNull();
    expect(screen.queryByTestId("edit-override-team-locked")).toBeNull();

    await fireEvent.press(screen.getByTestId("edit-override-cover"));

    expect(screen.getByTestId(`user-option-${OUTSIDER}`)).toBeTruthy();
    expect(screen.queryByTestId("user-picker-hint")).toBeNull();
  });
});
