/** @timezone UTC */
import "@testing-library/jest-dom";
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
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE SHORTCUTS THAT ADD A GLOBAL OVERRIDE SAY UP FRONT WHO MAY USE THEM
 * (issue #5617, after PR #5651; Dashboard/src/Components/OnCallPolicy/
 * UserOverrides/GlobalUserOverrideLock).
 *
 * "Skip until..." on a person in a schedule layer and "Get cover" on an
 * upcoming shift each open a form that saves a global override - one that
 * names no policy - and the server takes a permission to add overrides over
 * the whole project for one. Someone whose permission covers only some
 * policies (their team's label, or the policies their team owns) used to
 * fill in the form and be refused on save, or land on a page that said so.
 * On the real Layers page and the real Upcoming shifts card, with only the
 * network stubbed:
 *
 *   - for them, each shortcut stays where it was, locked: it opens nothing,
 *     says why on a press (and to a screen reader, as its description), in
 *     the words the Global User Overrides page uses;
 *   - someone who may not add overrides at all is told the permission it
 *     takes, as that page's Add says;
 *   - someone over the whole project, and a master admin, see no change;
 *   - nothing is locked before the permission snapshot lands;
 *   - Get cover reads each shift's own project - the card lists every
 *     project's shifts - and links as before for a project this browser has
 *     no snapshot of yet, where the page it opens decides;
 *   - cover for a shift that exists only inside one policy is that policy's
 *     own override, not a global one, and links to its page as before.
 */

const PROJECT_ID: string = "0d519000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "0d519000-0000-4000-8000-000000000002";
const UNOPENED_PROJECT_ID: string = "0d519000-0000-4000-8000-000000000003";

let rowsByProject: Record<string, Array<unknown>> = {};
let allPermissionsForTest: Array<string> = [];
let isMasterAdminForTest: boolean = false;

// The browser's permission snapshot: each project's rows apart, as Utils/Permission keeps them.
jest.mock("../../../UI/Utils/Permission", () => {
  const snapshotOf: (projectId?: unknown) => unknown = (
    projectId?: unknown,
  ): unknown => {
    const id: string = (
      projectId ? String(projectId) : "0d519000-0000-4000-8000-000000000001"
    ).toLowerCase();
    const rows: Array<unknown> | undefined = rowsByProject[id];

    return rows
      ? {
          _type: "UserTenantAccessPermission",
          projectId: id,
          permissions: rows,
        }
      : null;
  };

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (projectId?: unknown): unknown => {
        return snapshotOf(projectId);
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d519000-0000-4000-8000-0000000000a1";
          },
        };
      },
      getProfilePictureRoute: (): string => {
        return "/picture";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

// The Upcoming shifts card reads /my-shifts through the plain API.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d519000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

// The final schedule's calendar, as a list of its blocks.
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li key={index} data-testid="calendar-event">
                {event.title}
              </li>
            );
          })}
        </ul>
      );
    },
    DefaultCalendarView: {
      Month: "month",
      Week: "week",
      Day: "day",
      Agenda: "agenda",
    },
  };
});

import UpcomingShiftsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import Layers from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers";
import { getGlobalUserOverrideShortcutLock } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/GlobalUserOverrideLock";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_ADD_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, { UserPermission } from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";

jest.setTimeout(30000);

const SCHEDULE_ID: string = "0d519000-0000-4000-8000-000000000010";
const LAYER_ID: string = "0d519000-0000-4000-8000-000000000011";
const POLICY_ID: string = "0d519000-0000-4000-8000-000000000012";
const TEAM_A_LABEL: string = "0d519000-0000-4000-8000-0000000000e1";

const ALICE: string = "0d519000-0000-4000-8000-0000000000a1";
const BOB: string = "0d519000-0000-4000-8000-0000000000b1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALICE]: { name: "Alice Andersson", email: "alice@example.com" },
  [BOB]: { name: "Bob Berg", email: "bob@example.com" },
};

const ROTATION: Array<string> = [ALICE, BOB];

const NOW: Date = OneUptimeDate.fromString("2026-11-03T10:00:00.000Z");

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: Boolean(data?.isBlock),
  };
};

const ON_CALL_MEMBER_ON_TEAM_A_LABEL: UserPermission = row(
  Permission.OnCallMember,
  { scope: PermissionScope.Labels, labelIds: [TEAM_A_LABEL] },
);
const ON_CALL_MEMBER_ON_OWNED: UserPermission = row(Permission.OnCallMember, {
  scope: PermissionScope.Owned,
});
const ON_CALL_MEMBER_OVER_THE_PROJECT: UserPermission = row(
  Permission.OnCallMember,
);
const READS_EVERY_POLICY: UserPermission = row(Permission.Viewer);

// The reader holds `rows` in `projectId`, as the snapshot carries them.
function holding(
  rows: Array<UserPermission>,
  projectId: string = PROJECT_ID,
): void {
  rowsByProject[projectId] = rows;

  if (projectId === PROJECT_ID) {
    allPermissionsForTest = Array.from(
      new Set<string>(
        rows
          .filter((candidate: UserPermission): boolean => {
            return !candidate.isBlockPermission;
          })
          .map((candidate: UserPermission): string => {
            return candidate.permission;
          }),
      ),
    );
  }
}

// What a reader holding `rows` is told when they may not add overrides at all.
function missingPermissionReason(rows: Array<UserPermission>): string {
  return PermissionGate.check(
    new OnCallDutyPolicyUserOverride(),
    ModelAction.Create,
    { held: HeldPermissionsUtil.fromRows({ rows }) },
  ).disabledReason!;
}

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

function person(id: string): User {
  const result: User = new User();
  result._id = id;
  result.name = new Name(PEOPLE[id]!.name);
  result.email = new Email(PEOPLE[id]!.email);
  return result;
}

// Daily turns, Alice -> Bob, the first begun a month ago.
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const anchor: Date = OneUptimeDate.addRemoveDays(
    OneUptimeDate.getCurrentDate(),
    -30,
  );

  layer._id = LAYER_ID;
  layer.name = "Primary";
  layer.order = 1;
  layer.projectId = new ObjectID(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  layer.startsAt = anchor;
  layer.handOffTime = anchor;
  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as JSONObject);

  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  layer.restrictionTimes = restrictionTimes;

  return layer;
}

function layerUsers(): Array<OnCallDutyPolicyScheduleLayerUser> {
  return ROTATION.map((id: string, index: number) => {
    const layerUser: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    layerUser._id = `0d519000-0000-4000-8000-00000000010${index}`;
    layerUser.order = index + 1;
    layerUser.userId = new ObjectID(id);
    layerUser.user = person(id);
    layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(LAYER_ID);
    layerUser.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
    layerUser.projectId = new ObjectID(PROJECT_ID);
    return layerUser;
  });
}

function shift(
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson {
  return {
    contentHash: "hash",
    projectId: PROJECT_ID,
    scheduleId: SCHEDULE_ID,
    scheduleName: "Primary",
    scheduleTimezone: "UTC",
    userId: ALICE,
    userName: "Alice Andersson",
    start: "2026-11-03T12:00:00.000Z",
    end: "2026-11-03T20:00:00.000Z",
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    shiftConfigVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  rowsByProject = {};
  allPermissionsForTest = [];
  isMasterAdminForTest = false;
  PermissionGate.clearPermissionPropsCache();
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${SCHEDULE_ID}/layers`,
  );

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = SCHEDULE_ID;
      schedule.timezone = Timezone.UTC;
      return schedule;
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return makeLayer();
    }

    return null;
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return list([makeLayer()]);
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayerUser) {
      return list(layerUsers());
    }

    // Who is a member of the project, and the people pickers.
    if (params.modelType === TeamMember) {
      return list(
        ROTATION.map((id: string): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.userId = new ObjectID(id);
          member.user = person(id);
          member.hasAcceptedInvitation = true;
          return member;
        }),
      );
    }

    return list([]);
  });

  createOrUpdateMock.mockResolvedValue({ data: null } as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  apiGetMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

// The words a locked control is described by, for a screen reader.
function reasonOf(control: HTMLElement): string | null {
  const describedBy: string | null = control.getAttribute("aria-describedby");

  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
}

// Pressed, a locked control shows its reason: on a phone nothing hovers.
async function pressAndReadTooltip(control: HTMLElement): Promise<string> {
  fireEvent.click(control);

  const tooltip: HTMLElement = await screen.findByRole("tooltip");

  return tooltip.textContent || "";
}

describe("why a shortcut that adds a global override is locked", () => {
  const lockFor: (rows: Array<UserPermission>) => string | null = (
    rows: Array<UserPermission>,
  ): string | null => {
    return getGlobalUserOverrideShortcutLock({
      held: HeldPermissionsUtil.fromRows({ rows }),
    });
  };

  test("a reader limited to their team's label, or to what it owns, gets the global page's reason", () => {
    expect(lockFor([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY])).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(lockFor([ON_CALL_MEMBER_ON_OWNED])).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
  });

  test("a team's block on adding overrides for some labels locks it too: the override would reach those policies", () => {
    expect(
      lockFor([
        ON_CALL_MEMBER_OVER_THE_PROJECT,
        row(Permission.CreateOnCallDutyPolicyUserOverride, {
          isBlock: true,
          labelIds: [TEAM_A_LABEL],
        }),
      ]),
    ).toBe(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
  });

  test("a reader who may not add overrides at all is told the permission it takes", () => {
    const reason: string | null = lockFor([READS_EVERY_POLICY]);

    expect(reason).toBe(missingPermissionReason([READS_EVERY_POLICY]));
    expect(reason).toContain("User Override");
  });

  test("a reader over the whole project, whichever role, is never locked", () => {
    for (const permission of [
      Permission.OnCallMember,
      Permission.OnCallAdmin,
      Permission.ProjectMember,
      Permission.ProjectAdmin,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ]) {
      expect({ permission, lock: lockFor([row(permission)]) }).toEqual({
        permission,
        lock: null,
      });
    }
  });

  test("a master admin is never locked", () => {
    isMasterAdminForTest = true;

    expect(lockFor([ON_CALL_MEMBER_ON_TEAM_A_LABEL])).toBeNull();
    expect(lockFor([READS_EVERY_POLICY])).toBeNull();
  });

  test("before the snapshot lands nothing is locked: the server decides, as before", () => {
    expect(lockFor([])).toBeNull();
    expect(getGlobalUserOverrideShortcutLock()).toBeNull();
  });
});

describe("what the reader holds in one project", () => {
  test("is read from that project's own snapshot", () => {
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT]);
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL], OTHER_PROJECT_ID);

    const here: HeldPermissions | null =
      PermissionGate.getHeldPermissionsInProject(PROJECT_ID);
    const there: HeldPermissions | null =
      PermissionGate.getHeldPermissionsInProject(
        new ObjectID(OTHER_PROJECT_ID),
      );

    expect(here?.allowedProjectWide).toContain(Permission.OnCallMember);
    expect(there?.allowed).toContain(Permission.OnCallMember);
    expect(there?.allowedProjectWide).not.toContain(Permission.OnCallMember);
  });

  test("is nothing at all for a project this browser keeps no snapshot of, or for no project", () => {
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT]);

    expect(
      PermissionGate.getHeldPermissionsInProject(UNOPENED_PROJECT_ID),
    ).toBeNull();
    expect(PermissionGate.getHeldPermissionsInProject("")).toBeNull();
    expect(PermissionGate.getHeldPermissionsInProject(undefined)).toBeNull();
  });
});

describe("Skip until… on the Layers page", () => {
  async function renderLayers(): Promise<Array<HTMLElement>> {
    render(
      <MemoryRouter>
        <Layers
          onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
          projectId={new ObjectID(PROJECT_ID)}
        />
      </MemoryRouter>,
    );

    // The first layer opens by itself, with its people listed.
    await waitFor(
      () => {
        expect(screen.getAllByTestId("layer-user-skip-button")).toHaveLength(
          ROTATION.length,
        );
      },
      { timeout: 10000 },
    );

    return screen.getAllByTestId("layer-user-skip-button");
  }

  function skipButtonOf(id: string): HTMLElement {
    return screen.getByRole("button", {
      name: `Skip ${PEOPLE[id]!.name} until a date`,
    });
  }

  test("for a member limited to their team's label: every row's button is there, locked, says why, and opens nothing", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);

    const buttons: Array<HTMLElement> = await renderLayers();

    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      // Still reached with Tab, so its reason can be read.
      expect(button).not.toBeDisabled();
      expect(reasonOf(button)).toBe(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    }

    expect(await pressAndReadTooltip(skipButtonOf(ALICE))).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );

    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("for a member limited to what their team owns: locked the same way", async () => {
    holding([ON_CALL_MEMBER_ON_OWNED]);

    await renderLayers();

    expect(skipButtonOf(BOB)).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(skipButtonOf(BOB))).toBe(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);

    fireEvent.click(skipButtonOf(BOB));
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("for someone who may not add overrides at all: locked, naming the permission it takes", async () => {
    holding([READS_EVERY_POLICY]);

    await renderLayers();

    expect(skipButtonOf(ALICE)).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(skipButtonOf(ALICE))).toBe(
      missingPermissionReason([READS_EVERY_POLICY]),
    );

    fireEvent.click(skipButtonOf(ALICE));
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("for a member over the whole project: it opens the Skip dialog, as before", async () => {
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT]);

    await renderLayers();

    const button: HTMLElement = skipButtonOf(ALICE);

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-describedby");

    fireEvent.click(button);

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(
      await within(modal).findAllByText("Skip Alice Andersson"),
    ).not.toHaveLength(0);
    expect(await within(modal).findByText("Who covers?")).toBeInTheDocument();
  });

  test("for a master admin: never locked", async () => {
    isMasterAdminForTest = true;
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);

    await renderLayers();

    expect(skipButtonOf(ALICE)).not.toHaveAttribute("aria-disabled");

    fireEvent.click(skipButtonOf(ALICE));

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
  });

  test("before the permission snapshot lands: not locked, and the server decides, as before", async () => {
    await renderLayers();

    expect(skipButtonOf(ALICE)).not.toHaveAttribute("aria-disabled");

    fireEvent.click(skipButtonOf(ALICE));

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
  });
});

describe("Get cover on the Upcoming shifts card", () => {
  async function renderCard(
    shifts: Array<MaterializedShiftJson>,
  ): Promise<Array<HTMLElement>> {
    apiGetMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          shifts: shifts as unknown as JSONArray,
          truncated: false,
          generatedAt: NOW.toISOString(),
        },
        {},
      ) as never,
    );

    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/user-settings/calendar-feed`,
    );

    render(<UpcomingShiftsCard now={NOW} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("upcoming-shift-row")).toHaveLength(
        shifts.length,
      );
    });

    return screen.getAllByTestId("upcoming-shift-row");
  }

  // Where a row's Get cover link goes, or null when it is no link.
  function coverPath(shiftRow: HTMLElement): string | null {
    const link: HTMLAnchorElement | null = within(shiftRow)
      .queryByText("Get cover")
      ?.closest("a") as HTMLAnchorElement | null;

    return link ? link.getAttribute("href")!.split("?")[0]! : null;
  }

  function lockedCoverOf(shiftRow: HTMLElement): HTMLElement | null {
    return within(shiftRow).queryByTestId("upcoming-shift-cover-locked");
  }

  test("for a member limited to their team's label: Get cover is on the row, locked, says why, and goes nowhere", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);

    const [shiftRow] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    const locked: HTMLElement = lockedCoverOf(shiftRow)!;

    expect(locked).toBeInTheDocument();
    expect(locked.tagName).toBe("BUTTON");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveTextContent("Get cover");
    // Named, as the link is, with the shift it would cover.
    expect(
      within(locked).getByTestId("upcoming-shift-cover-context"),
    ).toHaveTextContent("(");
    expect(reasonOf(locked)).toBe(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    expect(coverPath(shiftRow)).toBeNull();

    expect(await pressAndReadTooltip(locked)).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(window.location.pathname).toBe(
      `/dashboard/${PROJECT_ID}/user-settings/calendar-feed`,
    );
  });

  test("for a member limited to what their team owns: locked the same way", async () => {
    holding([ON_CALL_MEMBER_ON_OWNED]);

    const [shiftRow] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    expect(reasonOf(lockedCoverOf(shiftRow)!)).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(coverPath(shiftRow)).toBeNull();
  });

  test("for someone who may not add overrides at all: locked, naming the permission it takes", async () => {
    holding([READS_EVERY_POLICY]);

    const [shiftRow] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    expect(reasonOf(lockedCoverOf(shiftRow)!)).toBe(
      missingPermissionReason([READS_EVERY_POLICY]),
    );
  });

  test("for a member over the whole project: it links to the global User Overrides page, as before", async () => {
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT]);

    const [shiftRow] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverPath(shiftRow)).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`,
    );
  });

  test("for a master admin: a link, as before", async () => {
    isMasterAdminForTest = true;
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);

    const [shiftRow] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverPath(shiftRow)).not.toBeNull();
  });

  test("each shift is read in its own project: locked where they are limited, a link where they are not", async () => {
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT]);
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL], OTHER_PROJECT_ID);

    const [here, there] = (await renderCard([
      shift({ shiftKey: "here" }),
      shift({
        shiftKey: "there",
        projectId: OTHER_PROJECT_ID,
        projectName: "Payments",
        start: "2026-11-04T12:00:00.000Z",
        end: "2026-11-04T20:00:00.000Z",
      }),
    ])) as [HTMLElement, HTMLElement];

    expect(coverPath(here)).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`,
    );
    expect(lockedCoverOf(here)).toBeNull();

    expect(coverPath(there)).toBeNull();
    expect(reasonOf(lockedCoverOf(there)!)).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
  });

  test("the other way round too: limited here, over the whole project there", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);
    holding([ON_CALL_MEMBER_OVER_THE_PROJECT], OTHER_PROJECT_ID);

    const [here, there] = (await renderCard([
      shift({ shiftKey: "here" }),
      shift({
        shiftKey: "there",
        projectId: OTHER_PROJECT_ID,
        projectName: "Payments",
        start: "2026-11-04T12:00:00.000Z",
        end: "2026-11-04T20:00:00.000Z",
      }),
    ])) as [HTMLElement, HTMLElement];

    expect(coverPath(here)).toBeNull();
    expect(coverPath(there)).toBe(
      `/dashboard/${OTHER_PROJECT_ID}/on-call-duty/user-overrides`,
    );
  });

  test("a project this browser has no permissions of yet: it links as before, and the page it opens decides", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "elsewhere",
        projectId: UNOPENED_PROJECT_ID,
        projectName: "Checkout",
      }),
    ])) as [HTMLElement];

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverPath(shiftRow)).toBe(
      `/dashboard/${UNOPENED_PROJECT_ID}/on-call-duty/user-overrides`,
    );
  });

  test("a shift that exists only inside one policy is covered on that policy's page, as before: not a global override", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "variant",
        policyVariantOf: {
          policyId: POLICY_ID,
          policyName: "Checkout",
          globalUserId: BOB,
        },
      }),
    ])) as [HTMLElement];

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverPath(shiftRow)).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/user-overrides`,
    );
  });

  test("a shift you cover for someone else still offers nothing, locked or not", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL]);

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "covering",
        override: {
          originalUserId: BOB,
          originalUserName: "Bob Berg",
          overrideStartsAt: "2026-11-03T12:00:00.000Z",
          overrideEndsAt: "2026-11-03T20:00:00.000Z",
        },
      }),
    ])) as [HTMLElement];

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverPath(shiftRow)).toBeNull();
  });
});
