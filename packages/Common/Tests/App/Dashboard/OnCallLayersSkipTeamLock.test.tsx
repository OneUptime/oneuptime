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
import fs from "fs";
import path from "path";
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
 * "SKIP UNTIL..." IS LOCKED BESIDE THE PEOPLE OUTSIDE THE READER'S TEAMS
 * (issue #9884, after #9733; Dashboard/src/Components/OnCallPolicy/
 * OnCallScheduleLayer/Layers and UserOverrides/UserOverrideTeamLimit).
 *
 * Someone who manages user overrides only through Manage On-Call Policy
 * User Overrides for Own Team may add time away only for the people of the
 * teams that give it to them; the server refuses a skip for anybody else.
 * The button beside each person on a schedule's layers used to be offered
 * beside everyone, so they learned it only once the form was open. On the
 * real Layers page, with only the network stubbed:
 *
 *   - beside somebody outside the reader's teams the button stays where it
 *     was, locked: it opens nothing, and says why on a press and to a
 *     screen reader, in the server's words, in the reader's language;
 *   - beside the reader's teammates it is as it was, and opens the dialog;
 *   - given by two teams, the people of either are teammates;
 *   - while the teams' members are not known - still being read, the read
 *     failed, or a team too big for one read - nothing is locked for it;
 *   - a reader whose permission reaches everyone, and a master admin, see
 *     no change, and the page does not read the teams' members for them;
 *   - the global lock (#5617) still locks every row, with its own words;
 *   - added on the policies offered (#5617's shortcut), the rule is the
 *     same, the policy's grants counting.
 *
 * Alex (signed in) and Sam are in Payments, which gives the permission;
 * Pat is in Mobile, which gives it in one test only; Erin is in no team
 * of the project that gives it.
 */

const PROJECT_ID: string = "0d988400-0000-4000-8000-000000000001";

let rowsForTest: Array<unknown> = [];
let allPermissionsForTest: Array<string> = [];
let isMasterAdminForTest: boolean = false;
// What the reader's language says for an English sentence, when it says something else.
let translationsForTest: Record<string, string> = {};

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          projectId: "0d988400-0000-4000-8000-000000000001",
          permissions: rowsForTest,
        };
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
            return "0d988400-0000-4000-8000-0000000000a1";
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
          return value ? translationsForTest[value] || value : value;
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
const apiPostMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the consts.
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

// Where a member may cover is asked with API.post.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async (): Promise<never> => {
        throw new Error("Not read here");
      },
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
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
            return "0d988400-0000-4000-8000-000000000001";
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

import Layers from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers";
import { getUserOverrideTeamAwayLock } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_ADD_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import {
  USER_OVERRIDE_TEAM_AWAY_REFUSAL,
  USER_OVERRIDE_TEAM_PERMISSION,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission, { UserPermission } from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import PermissionGate from "../../../UI/Utils/PermissionGate";

jest.setTimeout(30000);

const SCHEDULE_ID: string = "0d988400-0000-4000-8000-000000000010";
const LAYER_ID: string = "0d988400-0000-4000-8000-000000000011";
const POLICY_ID: string = "0d988400-0000-4000-8000-000000000012";
const TEAM_LABEL: string = "0d988400-0000-4000-8000-0000000000e1";

const PAYMENTS: string = "0d988400-0000-4000-8000-0000000000f1";
const MOBILE: string = "0d988400-0000-4000-8000-0000000000f2";

const ALEX: string = "0d988400-0000-4000-8000-0000000000a1";
const SAM: string = "0d988400-0000-4000-8000-0000000000b1";
const PAT: string = "0d988400-0000-4000-8000-0000000000c1";
const ERIN: string = "0d988400-0000-4000-8000-0000000000d1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Kim", email: "alex@example.com" },
  [SAM]: { name: "Sam Lee", email: "sam@example.com" },
  [PAT]: { name: "Pat Park", email: "pat@example.com" },
  [ERIN]: { name: "Erin Evans", email: "erin@example.com" },
};

const ROTATION: Array<string> = [ALEX, SAM, PAT, ERIN];

const TEAM_NAMES: Record<string, string> = {
  [PAYMENTS]: "Payments",
  [MOBILE]: "Mobile",
};

// Who has accepted their place in which team.
const MEMBERS: Array<{ teamId: string; userId: string }> = [
  { teamId: PAYMENTS, userId: ALEX },
  { teamId: PAYMENTS, userId: SAM },
  { teamId: MOBILE, userId: PAT },
];

// How the page's read of the teams' members goes in a test.
let teamMembersRead: "answers" | "hangs" | "fails" | "cut-short" = "answers";

// The policies that page through the schedule, and the ones the server says the reader may cover.
let attachedPolicies: Array<{ id: string; name: string }> = [];
let mayCover: Array<string> = [];

const row: (
  permission: Permission,
  data?: {
    teamId?: string;
    scope?: PermissionScope;
    labelIds?: Array<string>;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    teamId?: string;
    scope?: PermissionScope;
    labelIds?: Array<string>;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: false,
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

const READS: UserPermission = row(Permission.OnCallViewer);
const ON_PAYMENTS: UserPermission = row(USER_OVERRIDE_TEAM_PERMISSION, {
  teamId: PAYMENTS,
});
const ON_MOBILE: UserPermission = row(USER_OVERRIDE_TEAM_PERMISSION, {
  teamId: MOBILE,
});

// The reader holds `rows` in the project, as the snapshot carries them.
function holding(rows: Array<UserPermission>): void {
  rowsForTest = rows;
  allPermissionsForTest = Array.from(
    new Set<string>(
      rows.map((candidate: UserPermission): string => {
        return candidate.permission;
      }),
    ),
  );
}

function list(data: Array<unknown>, count?: number): JSONObject {
  return {
    data,
    count: count ?? data.length,
    skip: 0,
    limit: 50,
  } as unknown as JSONObject;
}

function person(id: string): User {
  const result: User = new User();
  result._id = id;
  result.name = new Name(PEOPLE[id]!.name);
  result.email = new Email(PEOPLE[id]!.email);
  return result;
}

// Daily turns through the rotation, the first begun a month ago.
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
    layerUser._id = `0d988400-0000-4000-8000-00000000010${index}`;
    layerUser.order = index + 1;
    layerUser.userId = new ObjectID(id);
    layerUser.user = person(id);
    layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(LAYER_ID);
    layerUser.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
    layerUser.projectId = new ObjectID(PROJECT_ID);
    return layerUser;
  });
}

// The ids a query's Includes names, lower-cased; null for a query without one.
function idsOf(value: unknown): Array<string> | null {
  if (value instanceof Includes) {
    return value.values.map((id: unknown): string => {
      return String(id).toLowerCase();
    });
  }

  return null;
}

// The reads of the teams' members the page made (useUserOverrideTeamPeople).
function teamMemberReads(): Array<Array<string>> {
  return getListMock.mock.calls
    .map((call: Array<any>) => {
      return call[0];
    })
    .filter((params: any): boolean => {
      return (
        params.modelType === TeamMember && idsOf(params.query?.teamId) !== null
      );
    })
    .map((params: any): Array<string> => {
      return [...idsOf(params.query.teamId)!].sort();
    });
}

beforeEach(() => {
  rowsForTest = [];
  allPermissionsForTest = [];
  isMasterAdminForTest = false;
  translationsForTest = {};
  teamMembersRead = "answers";
  attachedPolicies = [];
  mayCover = [];
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

    if (params.modelType === OnCallDutyPolicyEscalationRuleSchedule) {
      return list(
        attachedPolicies.map(
          (policy: { id: string; name: string }, index: number) => {
            const rule: OnCallDutyPolicyEscalationRuleSchedule =
              new OnCallDutyPolicyEscalationRuleSchedule();
            rule._id = `0d988400-0000-4000-8000-00000000020${index}`;
            rule.onCallDutyPolicyId = new ObjectID(policy.id);
            rule.onCallDutyPolicy = new OnCallDutyPolicy();
            rule.onCallDutyPolicy._id = policy.id;
            rule.onCallDutyPolicy.name = policy.name;
            return rule;
          },
        ),
      );
    }

    if (params.modelType === Team) {
      const teamIds: Array<string> = idsOf(params.query?._id) || [];

      return list(
        teamIds.map((teamId: string): Team => {
          const team: Team = new Team();
          team._id = teamId;
          team.name = TEAM_NAMES[teamId] || teamId;
          return team;
        }),
      );
    }

    if (params.modelType === TeamMember) {
      const teamIds: Array<string> | null = idsOf(params.query?.teamId);

      // The teams' members, for the locks (useUserOverrideTeamPeople).
      if (teamIds) {
        if (teamMembersRead === "hangs") {
          return new Promise<never>(() => {});
        }

        if (teamMembersRead === "fails") {
          throw new Error("The teams' members could not be read.");
        }

        const members: Array<TeamMember> = MEMBERS.filter(
          (member: { teamId: string }): boolean => {
            return teamIds.includes(member.teamId);
          },
        ).map((member: { teamId: string; userId: string }): TeamMember => {
          const found: TeamMember = new TeamMember();
          found._id = `${member.teamId.slice(0, -2)}${member.userId.slice(-2)}`;
          found.teamId = new ObjectID(member.teamId);
          found.userId = new ObjectID(member.userId);
          found.hasAcceptedInvitation = true;
          return found;
        });

        // A team too big for one read: more members than came back.
        return teamMembersRead === "cut-short"
          ? list(members.slice(0, 1), members.length)
          : list(members);
      }

      // Who is a member of the project, and the people pickers.
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

  apiPostMock.mockImplementation(async (request: any): Promise<any> => {
    const asked: Array<string> = request.data.onCallDutyPolicyIds || [];

    return new HTTPResponse<JSONObject>(
      200,
      {
        global: false,
        onCallDutyPolicyIds: asked.filter((id: string): boolean => {
          return mayCover.includes(id);
        }),
      },
      {},
    );
  });

  createOrUpdateMock.mockResolvedValue({ data: null } as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  apiPostMock.mockReset();
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

function skipButtonOf(id: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Skip ${PEOPLE[id]!.name} until a date`,
  });
}

async function renderLayers(): Promise<void> {
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
}

// Once the page has read the teams' members, a lock of the team rule shows.
async function waitForTeamLock(id: string): Promise<void> {
  await waitFor(
    () => {
      expect(skipButtonOf(id)).toHaveAttribute("aria-disabled", "true");
    },
    { timeout: 10000 },
  );
}

function isLocked(id: string): boolean {
  return skipButtonOf(id).getAttribute("aria-disabled") === "true";
}

describe("why Skip until… is locked beside a person, by the team rule", () => {
  const LIMIT: { teamIds: Array<string> } = { teamIds: [PAYMENTS] };
  const MEMBER_IDS: Set<string> = new Set<string>([ALEX, SAM]);

  test("somebody outside the reader's teams: the server's words for a skip of them", () => {
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: MEMBER_IDS,
        awayUserId: PAT,
      }),
    ).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
  });

  test("a teammate, ids in any case: not locked", () => {
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: MEMBER_IDS,
        awayUserId: SAM.toUpperCase(),
      }),
    ).toBeNull();
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: MEMBER_IDS,
        awayUserId: ` ${ALEX} `,
      }),
    ).toBeNull();
  });

  test("not limited, members not known yet, or nobody named: not locked", () => {
    expect(
      getUserOverrideTeamAwayLock({
        limit: null,
        memberIds: MEMBER_IDS,
        awayUserId: PAT,
      }),
    ).toBeNull();
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: null,
        awayUserId: PAT,
      }),
    ).toBeNull();
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: MEMBER_IDS,
        awayUserId: "",
      }),
    ).toBeNull();
  });

  test("a team that has no members left reaches nobody: everyone is outside it", () => {
    expect(
      getUserOverrideTeamAwayLock({
        limit: LIMIT,
        memberIds: new Set<string>(),
        awayUserId: ALEX,
      }),
    ).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
  });
});

describe("Skip until… on the Layers page, for a reader who manages their team's overrides", () => {
  test("beside the people outside Payments it is locked, says why, and opens nothing", async () => {
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitForTeamLock(PAT);

    for (const outsider of [PAT, ERIN]) {
      const button: HTMLElement = skipButtonOf(outsider);

      expect(button).toHaveAttribute("aria-disabled", "true");
      // Still reached with Tab, so its reason can be read.
      expect(button).not.toBeDisabled();
      expect(reasonOf(button)).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    }

    expect(await pressAndReadTooltip(skipButtonOf(PAT))).toBe(
      USER_OVERRIDE_TEAM_AWAY_REFUSAL,
    );

    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("beside the reader and their teammates it is as it was, and opens the Skip dialog", async () => {
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitForTeamLock(PAT);

    for (const teammate of [ALEX, SAM]) {
      expect(skipButtonOf(teammate)).not.toHaveAttribute("aria-disabled");
      expect(skipButtonOf(teammate)).not.toHaveAttribute("aria-describedby");
    }

    fireEvent.click(skipButtonOf(SAM));

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(await within(modal).findAllByText("Skip Sam Lee")).not.toHaveLength(
      0,
    );
  });

  test("the teams' members are read once, for the teams that give the permission", async () => {
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitForTeamLock(PAT);

    expect(teamMemberReads()).toEqual([[PAYMENTS]]);
  });

  test("every locked row is described by the one reason, said once to a screen reader", async () => {
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitForTeamLock(ERIN);

    expect(skipButtonOf(PAT).getAttribute("aria-describedby")).toBe(
      skipButtonOf(ERIN).getAttribute("aria-describedby"),
    );
    expect(
      screen.getAllByText(USER_OVERRIDE_TEAM_AWAY_REFUSAL, {
        ignore: "[role='tooltip'], [role='tooltip'] *",
      }),
    ).toHaveLength(1);
  });

  test("the reason is said in the reader's language", async () => {
    const german: string = (
      JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
          ),
          "utf8",
        ),
      ) as Record<string, string>
    )[USER_OVERRIDE_TEAM_AWAY_REFUSAL]!;

    expect(german).toBeTruthy();
    expect(german).not.toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);

    translationsForTest = { [USER_OVERRIDE_TEAM_AWAY_REFUSAL]: german };
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitForTeamLock(PAT);

    expect(reasonOf(skipButtonOf(PAT))).toBe(german);
    expect(await pressAndReadTooltip(skipButtonOf(PAT))).toBe(german);
  });

  test("given by two teams, the people of either are teammates: Pat of Mobile too", async () => {
    holding([READS, ON_PAYMENTS, ON_MOBILE]);

    await renderLayers();
    await waitForTeamLock(ERIN);

    expect(isLocked(PAT)).toBe(false);
    expect(isLocked(SAM)).toBe(false);
    expect(reasonOf(skipButtonOf(ERIN))).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(teamMemberReads()).toEqual([[MOBILE, PAYMENTS].sort()]);
  });
});

describe("while the teams' members are not known, nothing is locked for it", () => {
  test("while they are still being read", async () => {
    teamMembersRead = "hangs";
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await act(async (): Promise<void> => {});

    for (const id of ROTATION) {
      expect({ id, locked: isLocked(id) }).toEqual({ id, locked: false });
    }
  });

  test("when they could not be read: the server decides, and the dialog opens", async () => {
    teamMembersRead = "fails";
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitFor(() => {
      expect(teamMemberReads()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    expect(isLocked(PAT)).toBe(false);

    fireEvent.click(skipButtonOf(PAT));

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
  });

  test("when a team has more members than one read brings back", async () => {
    teamMembersRead = "cut-short";
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await waitFor(() => {
      expect(teamMemberReads()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    for (const id of ROTATION) {
      expect({ id, locked: isLocked(id) }).toEqual({ id, locked: false });
    }
  });
});

describe("Skip until… as before, for everyone the team rule does not narrow", () => {
  test("a reader whose permission reaches everyone: nobody locked, and no team is read", async () => {
    holding([row(Permission.OnCallMember), ON_PAYMENTS]);

    await renderLayers();
    await act(async (): Promise<void> => {});

    for (const id of ROTATION) {
      expect({ id, locked: isLocked(id) }).toEqual({ id, locked: false });
    }

    expect(teamMemberReads()).toEqual([]);

    fireEvent.click(skipButtonOf(PAT));

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
  });

  test("a master admin: nobody locked, and no team is read", async () => {
    isMasterAdminForTest = true;
    holding([READS, ON_PAYMENTS]);

    await renderLayers();
    await act(async (): Promise<void> => {});

    expect(isLocked(PAT)).toBe(false);
    expect(teamMemberReads()).toEqual([]);
  });

  test("before the permission snapshot lands: nobody locked, and the server decides", async () => {
    await renderLayers();
    await act(async (): Promise<void> => {});

    expect(isLocked(PAT)).toBe(false);
    expect(teamMemberReads()).toEqual([]);
  });
});

describe("beside the global lock and the policies offered (#5617)", () => {
  test("where the server allows none of the schedule's policies, every row keeps the global lock and its words", async () => {
    holding([
      READS,
      row(USER_OVERRIDE_TEAM_PERMISSION, {
        teamId: PAYMENTS,
        scope: PermissionScope.Labels,
        labelIds: [TEAM_LABEL],
      }),
    ]);
    attachedPolicies = [{ id: POLICY_ID, name: "Payments Primary" }];
    mayCover = [];

    await renderLayers();
    await waitForTeamLock(SAM);

    for (const id of ROTATION) {
      expect({ id, reason: reasonOf(skipButtonOf(id)) }).toEqual({
        id,
        reason: GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
      });
    }
  });

  test("added on the policy the server offers, the team rule still holds: Pat is locked, Sam opens the dialog on it", async () => {
    holding([
      READS,
      row(USER_OVERRIDE_TEAM_PERMISSION, {
        teamId: PAYMENTS,
        scope: PermissionScope.Labels,
        labelIds: [TEAM_LABEL],
      }),
    ]);
    attachedPolicies = [{ id: POLICY_ID, name: "Payments Primary" }];
    mayCover = [POLICY_ID];

    await renderLayers();
    await waitForTeamLock(PAT);

    expect(reasonOf(skipButtonOf(PAT))).toBe(USER_OVERRIDE_TEAM_AWAY_REFUSAL);
    expect(isLocked(SAM)).toBe(false);
    // A grant narrowed to a label reaches the policy's overrides, not a global one's.
    expect(teamMemberReads()).toContainEqual([PAYMENTS]);

    fireEvent.click(skipButtonOf(SAM));

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(
      await within(modal).findAllByText(/Payments Primary/),
    ).not.toHaveLength(0);
  });
});
