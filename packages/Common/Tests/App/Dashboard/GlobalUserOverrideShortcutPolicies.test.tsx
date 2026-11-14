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
 * SKIP UNTIL... AND GET COVER OFFER THE POLICIES A MEMBER MAY COVER
 * (after issue #5617, PR #5651 and PR #5661; Dashboard/src/Components/
 * OnCallPolicy/UserOverrides/UserOverridePolicies).
 *
 * Both shortcuts add a global override - on every on-call policy - which
 * takes a permission to add overrides over the whole project. A member
 * whose permission covers only some policies (their team's label, or the
 * policies their team owns) used to find them locked. Now each asks the
 * server which of the policies it would reach they may cover
 * (POST /on-call-duty-policy-user-override/add-access) and offers those,
 * one override on each. On the real Layers page and the real Upcoming
 * shifts card, with only the network stubbed:
 *
 *   - Skip until... asks about the policies that page through the
 *     schedule. One allowed: the dialog names it and the skip is added on
 *     it. Several: each is ticked under "On-call policies", and the skip is
 *     added on every one left ticked. None: locked, as before.
 *   - Get cover asks about the policies of the shift, in the shift's own
 *     project, once per project. One allowed: it links to that policy's
 *     User Overrides page. Several: a menu of them. None: locked.
 *   - A member over the whole project sees no change: no question asked,
 *     and the global override as before.
 */

const PROJECT_ID: string = "0d51a000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "0d51a000-0000-4000-8000-000000000002";

let rowsByProject: Record<string, Array<unknown>> = {};
let allPermissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  const snapshotOf: (projectId?: unknown) => unknown = (
    projectId?: unknown,
  ): unknown => {
    const id: string = (
      projectId ? String(projectId) : "0d51a000-0000-4000-8000-000000000001"
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
        return false;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d51a000-0000-4000-8000-0000000000a1";
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
const createMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "0d51a000-0000-4000-8000-000000000001" };
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
      create: (...args: Array<any>) => {
        return createMock(...args);
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

// /my-shifts is read with API.get, and where a member may cover asked with API.post.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return apiGetMock(...args);
      },
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as Error)?.message || "Something went wrong";
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
            return "0d51a000-0000-4000-8000-000000000001";
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
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_ADD_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import {
  MaterializedShiftJson,
  MaterializedShiftPolicy,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, { UserPermission } from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

jest.setTimeout(30000);

const SCHEDULE_ID: string = "0d51a000-0000-4000-8000-000000000010";
const LAYER_ID: string = "0d51a000-0000-4000-8000-000000000011";
const TEAM_A_LABEL: string = "0d51a000-0000-4000-8000-0000000000e1";

// The policies that page through the schedule.
const PAYMENTS: { id: string; name: string } = {
  id: "0d51a000-0000-4000-8000-0000000000c1",
  name: "Payments",
};
const CHECKOUT: { id: string; name: string } = {
  id: "0d51a000-0000-4000-8000-0000000000c2",
  name: "Checkout",
};
const PLATFORM: { id: string; name: string } = {
  id: "0d51a000-0000-4000-8000-0000000000c3",
  name: "Platform",
};

const ALICE: string = "0d51a000-0000-4000-8000-0000000000a1";
const BOB: string = "0d51a000-0000-4000-8000-0000000000b1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALICE]: { name: "Alice Andersson", email: "alice@example.com" },
  [BOB]: { name: "Bob Berg", email: "bob@example.com" },
};

const ROTATION: Array<string> = [ALICE, BOB];

const NOW: Date = OneUptimeDate.fromString("2026-11-03T10:00:00.000Z");

const row: (
  permission: Permission,
  data?: { scope?: PermissionScope; labelIds?: Array<string> },
) => UserPermission = (
  permission: Permission,
  data?: { scope?: PermissionScope; labelIds?: Array<string> },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: false,
  };
};

const LIMITED_TO_TEAM_A: Array<UserPermission> = [
  row(Permission.OnCallMember, {
    scope: PermissionScope.Labels,
    labelIds: [TEAM_A_LABEL],
  }),
  row(Permission.Viewer),
];
const OVER_THE_PROJECT: Array<UserPermission> = [row(Permission.OnCallMember)];

function holding(
  rows: Array<UserPermission>,
  projectId: string = PROJECT_ID,
): void {
  rowsByProject[projectId] = rows;

  if (projectId === PROJECT_ID) {
    allPermissionsForTest = Array.from(
      new Set<string>(
        rows.map((candidate: UserPermission): string => {
          return candidate.permission;
        }),
      ),
    );
  }
}

// The policies the schedule's escalation rules name, as the page reads them.
let attachedPolicies: Array<{ id: string; name: string }> = [];

// What the server answers, by project: the policies the member may cover there.
let mayCoverByProject: Record<string, Array<string>> = {};
let addAccessFails: boolean = false;

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
    layerUser._id = `0d51a000-0000-4000-8000-00000000010${index}`;
    layerUser.order = index + 1;
    layerUser.userId = new ObjectID(id);
    layerUser.user = person(id);
    layerUser.onCallDutyPolicyScheduleLayerId = new ObjectID(LAYER_ID);
    layerUser.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
    layerUser.projectId = new ObjectID(PROJECT_ID);
    return layerUser;
  });
}

// An escalation rule naming the schedule, once per rule: a policy may name it twice.
function rulesNamingSchedule(): Array<OnCallDutyPolicyEscalationRuleSchedule> {
  return attachedPolicies.map(
    (policy: { id: string; name: string }, index: number) => {
      const rule: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      rule._id = `0d51a000-0000-4000-8000-00000000020${index}`;
      rule.onCallDutyPolicyId = new ObjectID(policy.id);
      rule.onCallDutyPolicy = new OnCallDutyPolicy();
      rule.onCallDutyPolicy._id = policy.id;
      rule.onCallDutyPolicy.name = policy.name;
      return rule;
    },
  );
}

function policyOfShift(policy: {
  id: string;
  name: string;
}): MaterializedShiftPolicy {
  return {
    policyId: policy.id,
    policyName: policy.name,
    ruleId: `${policy.id}-rule`,
    ruleName: "Level 1",
    ruleOrder: 1,
  };
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

// The add-access questions the page asked: the project it named, and the policies.
function addAccessQuestions(): Array<{
  projectId: string;
  onCallDutyPolicyIds: Array<string>;
}> {
  return apiPostMock.mock.calls
    .filter((call: Array<any>): boolean => {
      return String(call[0].url).endsWith(
        "/on-call-duty-policy-user-override/add-access",
      );
    })
    .map((call: Array<any>) => {
      return {
        projectId: call[0].headers.tenantid,
        onCallDutyPolicyIds: [...call[0].data.onCallDutyPolicyIds].sort(),
      };
    });
}

beforeEach(() => {
  rowsByProject = {};
  allPermissionsForTest = [];
  attachedPolicies = [];
  mayCoverByProject = {};
  addAccessFails = false;
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
      return list(rulesNamingSchedule());
    }

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

  apiPostMock.mockImplementation(async (request: any): Promise<any> => {
    if (addAccessFails) {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }

    const projectId: string = String(request.headers.tenantid);
    const asked: Array<string> = request.data.onCallDutyPolicyIds;
    const mayCover: Array<string> = mayCoverByProject[projectId] || [];

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

  createMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  createOrUpdateMock.mockReset();
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

function reasonOf(control: HTMLElement): string | null {
  const describedBy: string | null = control.getAttribute("aria-describedby");

  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
}

describe("Skip until… for a member whose permission covers only some policies", () => {
  async function renderLayers(): Promise<void> {
    render(
      <MemoryRouter>
        <Layers
          onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
          projectId={new ObjectID(PROJECT_ID)}
        />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByTestId("layer-user-skip-button")).toHaveLength(
          ROTATION.length,
        );
      },
      { timeout: 10000 },
    );
  }

  function skipButtonOf(id: string): HTMLElement {
    return screen.getByRole("button", {
      name: `Skip ${PEOPLE[id]!.name} until a date`,
    });
  }

  function timeInput(modal: HTMLElement, title: string): HTMLInputElement {
    const label: HTMLLabelElement | undefined = Array.from(
      modal.querySelectorAll("label"),
    ).find((candidate: HTMLLabelElement): boolean => {
      return (candidate.textContent || "").trim().startsWith(title);
    });

    if (!label) {
      throw new Error(`No field ${title}`);
    }

    return modal.querySelector(
      `[id="${label.getAttribute("for")}"]`,
    ) as HTMLInputElement;
  }

  async function waitForSkipUnlocked(id: string): Promise<void> {
    await waitFor(() => {
      expect(skipButtonOf(id)).not.toHaveAttribute("aria-disabled");
    });
  }

  async function openSkipAndSetEnds(id: string): Promise<HTMLElement> {
    fireEvent.click(skipButtonOf(id));

    const modal: HTMLElement = await screen.findByTestId("modal");

    await waitFor(() => {
      expect(timeInput(modal, "Starts").value).not.toBe("");
    });

    const back: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      3,
    );
    back.setUTCSeconds(0, 0);

    fireEvent.change(timeInput(modal, "Ends"), {
      target: { value: OneUptimeDate.toDateTimeLocalString(back) },
    });

    return modal;
  }

  async function save(modal: HTMLElement, id: string): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: `Skip ${PEOPLE[id]!.name}`,
          exact: true,
        }),
      );
    });
  }

  // Every override the dialog sent, in order: those it added itself, then the form's.
  function sentPolicyIds(): Array<string | null> {
    return [...createMock.mock.calls, ...createOrUpdateMock.mock.calls].map(
      (call: Array<any>): string | null => {
        const sent: OnCallDutyPolicyUserOverride = call[0].model;
        return sent.onCallDutyPolicyId
          ? sent.onCallDutyPolicyId.toString()
          : null;
      },
    );
  }

  test("asks the server about the policies that page through the schedule, in this project", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, CHECKOUT, PAYMENTS];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id] };

    await renderLayers();
    await waitForSkipUnlocked(ALICE);

    expect(addAccessQuestions()).toEqual([
      {
        projectId: PROJECT_ID,
        onCallDutyPolicyIds: [PAYMENTS.id, CHECKOUT.id].sort(),
      },
    ]);
  });

  test("one policy allowed: the dialog names it, asks nothing more, and the skip is added on it", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, CHECKOUT];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id] };

    await renderLayers();
    await waitForSkipUnlocked(BOB);

    expect(reasonOf(skipButtonOf(BOB))).toBeNull();

    const modal: HTMLElement = await openSkipAndSetEnds(BOB);

    expect(
      within(modal).getByText(
        "This applies to the on-call policy Payments. To end it early, delete it on that policy's User Overrides page, under Advanced.",
      ),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("checkbox")).toBeNull();
    expect(
      within(modal).queryByText(/This applies to every on-call policy/),
    ).toBeNull();

    await save(modal, BOB);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(sentPolicyIds()).toEqual([PAYMENTS.id]);
    expect(
      String(
        (createOrUpdateMock.mock.calls[0]![0] as any).model.overrideUserId,
      ),
    ).toBe(BOB);
  });

  test("several allowed: each is ticked under On-call policies, and the skip is added on every one, an override each", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, CHECKOUT, PLATFORM];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id, PLATFORM.id] };

    await renderLayers();
    await waitForSkipUnlocked(ALICE);

    const modal: HTMLElement = await openSkipAndSetEnds(ALICE);

    expect(
      within(modal).getByText(
        "This applies to the on-call policies you tick. To end it early, delete it on each policy's User Overrides page, under Advanced.",
      ),
    ).toBeInTheDocument();

    expect(within(modal).getAllByRole("checkbox")).toHaveLength(2);

    for (const name of ["Payments", "Platform"]) {
      expect(within(modal).getByRole("checkbox", { name })).toBeChecked();
    }

    // Checkout is not one they may cover, so it is never offered.
    expect(within(modal).queryByText("Checkout")).toBeNull();

    await save(modal, ALICE);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(sentPolicyIds()).toEqual([PAYMENTS.id, PLATFORM.id]);
  });

  test("a policy unticked is left alone", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, PLATFORM];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id, PLATFORM.id] };

    await renderLayers();
    await waitForSkipUnlocked(ALICE);

    const modal: HTMLElement = await openSkipAndSetEnds(ALICE);

    fireEvent.click(within(modal).getByRole("checkbox", { name: "Payments" }));

    await save(modal, ALICE);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(sentPolicyIds()).toEqual([PLATFORM.id]);
  });

  test("with every policy unticked, nothing is saved and the dialog says what is missing", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, PLATFORM];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id, PLATFORM.id] };

    await renderLayers();
    await waitForSkipUnlocked(ALICE);

    const modal: HTMLElement = await openSkipAndSetEnds(ALICE);

    fireEvent.click(within(modal).getByRole("checkbox", { name: "Payments" }));
    fireEvent.click(within(modal).getByRole("checkbox", { name: "Platform" }));

    await save(modal, ALICE);

    expect(
      await within(modal).findByText("Tick at least one on-call policy."),
    ).toBeInTheDocument();
    expect(sentPolicyIds()).toEqual([]);
  });

  test("an override that fails part way says why, and closing the dialog shows the ones added", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS, PLATFORM];
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id, PLATFORM.id] };
    createOrUpdateMock.mockRejectedValue(new Error("The server is busy."));

    await renderLayers();
    await waitForSkipUnlocked(ALICE);

    const overrideReadsBefore: number = getListMock.mock.calls.filter(
      (call: Array<any>): boolean => {
        return call[0].modelType === OnCallDutyPolicyUserOverride;
      },
    ).length;

    const modal: HTMLElement = await openSkipAndSetEnds(ALICE);

    await save(modal, ALICE);

    expect(
      await within(modal).findAllByText("The server is busy."),
    ).not.toHaveLength(0);
    expect(sentPolicyIds()).toEqual([PAYMENTS.id, PLATFORM.id]);

    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    await waitFor(() => {
      expect(
        getListMock.mock.calls.filter((call: Array<any>): boolean => {
          return call[0].modelType === OnCallDutyPolicyUserOverride;
        }).length,
      ).toBeGreaterThan(overrideReadsBefore);
    });
  });

  test("none of the schedule's policies allowed: locked, with the global page's reason, as before", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [CHECKOUT];
    mayCoverByProject = { [PROJECT_ID]: [] };

    await renderLayers();

    await waitFor(() => {
      expect(addAccessQuestions()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    expect(skipButtonOf(ALICE)).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(skipButtonOf(ALICE))).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );

    fireEvent.click(skipButtonOf(ALICE));
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("a schedule no policy pages through: locked, and nothing is asked", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [];

    await renderLayers();
    await act(async (): Promise<void> => {});

    expect(skipButtonOf(ALICE)).toHaveAttribute("aria-disabled", "true");
    expect(addAccessQuestions()).toEqual([]);
  });

  test("the server failing to answer offers nothing: locked", async () => {
    holding(LIMITED_TO_TEAM_A);
    attachedPolicies = [PAYMENTS];
    addAccessFails = true;

    await renderLayers();

    await waitFor(() => {
      expect(addAccessQuestions()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    expect(skipButtonOf(ALICE)).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(skipButtonOf(ALICE))).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
  });

  test("a member over the whole project: no question, and the skip is a global override, as before", async () => {
    holding(OVER_THE_PROJECT);
    attachedPolicies = [PAYMENTS, CHECKOUT];

    await renderLayers();

    const modal: HTMLElement = await openSkipAndSetEnds(BOB);

    expect(
      within(modal).getByText(
        "This applies to every on-call policy. To end it early, delete it under On-Call > Advanced > User Overrides.",
      ),
    ).toBeInTheDocument();
    expect(within(modal).queryByRole("checkbox")).toBeNull();

    await save(modal, BOB);

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(sentPolicyIds()).toEqual([null]);
    expect(addAccessQuestions()).toEqual([]);
  });

  test("someone who may not add overrides at all: locked, and nothing is asked", async () => {
    holding([row(Permission.Viewer)]);
    attachedPolicies = [PAYMENTS];

    await renderLayers();
    await act(async (): Promise<void> => {});

    expect(skipButtonOf(ALICE)).toHaveAttribute("aria-disabled", "true");
    expect(addAccessQuestions()).toEqual([]);
  });
});

describe("Get cover for a member whose permission covers only some policies", () => {
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

  function coverLink(shiftRow: HTMLElement): HTMLAnchorElement | null {
    return within(shiftRow)
      .queryByText("Get cover")
      ?.closest("a") as HTMLAnchorElement | null;
  }

  function coverPath(shiftRow: HTMLElement): string | null {
    const link: HTMLAnchorElement | null = coverLink(shiftRow);

    return link ? link.getAttribute("href")!.split("?")[0]! : null;
  }

  function lockedCoverOf(shiftRow: HTMLElement): HTMLElement | null {
    return within(shiftRow).queryByTestId("upcoming-shift-cover-locked");
  }

  function policyPage(projectId: string, policyId: string): string {
    return `/dashboard/${projectId}/on-call-duty/policies/${policyId}/user-overrides`;
  }

  test("one policy allowed: Get cover links to that policy's User Overrides page, with the shift's window", async () => {
    holding(LIMITED_TO_TEAM_A);
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id] };

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "own",
        policies: [policyOfShift(PAYMENTS), policyOfShift(CHECKOUT)],
      }),
    ])) as [HTMLElement];

    await waitFor(() => {
      expect(coverPath(shiftRow)).toBe(policyPage(PROJECT_ID, PAYMENTS.id));
    });

    expect(lockedCoverOf(shiftRow)).toBeNull();
    expect(coverLink(shiftRow)!.getAttribute("href")).toContain(
      "coverStartsAt=",
    );
    expect(coverLink(shiftRow)!.getAttribute("href")).toContain("coverEndsAt=");
    expect(addAccessQuestions()).toEqual([
      {
        projectId: PROJECT_ID,
        onCallDutyPolicyIds: [PAYMENTS.id, CHECKOUT.id].sort(),
      },
    ]);
  });

  test("several allowed: Get cover is a menu of them, and each opens Add User Override on its own page", async () => {
    holding(LIMITED_TO_TEAM_A);
    mayCoverByProject = { [PROJECT_ID]: [PAYMENTS.id, PLATFORM.id] };

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "own",
        policies: [
          policyOfShift(PAYMENTS),
          policyOfShift(CHECKOUT),
          policyOfShift(PLATFORM),
        ],
      }),
    ])) as [HTMLElement];

    const trigger: HTMLElement = await within(shiftRow).findByTestId(
      "upcoming-shift-cover-policies",
    );

    expect(trigger).toHaveTextContent("Get cover");
    expect(coverLink(shiftRow)).toBeNull();
    expect(lockedCoverOf(shiftRow)).toBeNull();

    fireEvent.click(trigger);

    const items: Array<HTMLElement> = await screen.findAllByTestId(
      "upcoming-shift-cover-policy",
    );

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent?.trim() || "";
      }),
    ).toEqual(["Payments", "Platform"]);

    fireEvent.click(items[1]!);

    expect(navigate).toHaveBeenCalledTimes(1);

    const route: string = String(navigate.mock.calls[0]![0]);

    expect(route.split("?")[0]).toBe(policyPage(PROJECT_ID, PLATFORM.id));
    expect(route).toContain("coverStartsAt=");
  });

  test("none of the shift's policies allowed: locked, with the global page's reason, as before", async () => {
    holding(LIMITED_TO_TEAM_A);
    mayCoverByProject = { [PROJECT_ID]: [] };

    const [shiftRow] = (await renderCard([
      shift({ shiftKey: "own", policies: [policyOfShift(CHECKOUT)] }),
    ])) as [HTMLElement];

    await waitFor(() => {
      expect(addAccessQuestions()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    expect(reasonOf(lockedCoverOf(shiftRow)!)).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(coverPath(shiftRow)).toBeNull();
  });

  test("the server failing to answer offers nothing: locked", async () => {
    holding(LIMITED_TO_TEAM_A);
    addAccessFails = true;

    const [shiftRow] = (await renderCard([
      shift({ shiftKey: "own", policies: [policyOfShift(PAYMENTS)] }),
    ])) as [HTMLElement];

    await waitFor(() => {
      expect(addAccessQuestions()).toHaveLength(1);
    });
    await act(async (): Promise<void> => {});

    expect(lockedCoverOf(shiftRow)).not.toBeNull();
    expect(coverPath(shiftRow)).toBeNull();
  });

  test("each project is asked about its own shifts' policies, once, naming that project", async () => {
    holding(LIMITED_TO_TEAM_A);
    holding(LIMITED_TO_TEAM_A, OTHER_PROJECT_ID);
    mayCoverByProject = {
      [PROJECT_ID]: [PAYMENTS.id],
      [OTHER_PROJECT_ID]: [],
    };

    const [first, second, there] = (await renderCard([
      shift({ shiftKey: "first", policies: [policyOfShift(PAYMENTS)] }),
      shift({
        shiftKey: "second",
        start: "2026-11-04T12:00:00.000Z",
        end: "2026-11-04T20:00:00.000Z",
        policies: [policyOfShift(PAYMENTS), policyOfShift(CHECKOUT)],
      }),
      shift({
        shiftKey: "there",
        projectId: OTHER_PROJECT_ID,
        projectName: "Platform team",
        start: "2026-11-05T12:00:00.000Z",
        end: "2026-11-05T20:00:00.000Z",
        policies: [policyOfShift(PLATFORM)],
      }),
    ])) as [HTMLElement, HTMLElement, HTMLElement];

    await waitFor(() => {
      expect(coverPath(first)).toBe(policyPage(PROJECT_ID, PAYMENTS.id));
      expect(coverPath(second)).toBe(policyPage(PROJECT_ID, PAYMENTS.id));
    });
    await waitFor(() => {
      expect(lockedCoverOf(there)).not.toBeNull();
    });

    expect(
      addAccessQuestions().sort(
        (a: { projectId: string }, b: { projectId: string }): number => {
          return a.projectId.localeCompare(b.projectId);
        },
      ),
    ).toEqual([
      {
        projectId: PROJECT_ID,
        onCallDutyPolicyIds: [PAYMENTS.id, CHECKOUT.id].sort(),
      },
      { projectId: OTHER_PROJECT_ID, onCallDutyPolicyIds: [PLATFORM.id] },
    ]);
  });

  test("a member over the whole project: no question, and Get cover links to the global page, as before", async () => {
    holding(OVER_THE_PROJECT);

    const [shiftRow] = (await renderCard([
      shift({ shiftKey: "own", policies: [policyOfShift(PAYMENTS)] }),
    ])) as [HTMLElement];

    expect(coverPath(shiftRow)).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`,
    );
    expect(addAccessQuestions()).toEqual([]);
  });

  test("a shift that exists only inside one policy is covered on its page, as before, and asks nothing", async () => {
    holding(LIMITED_TO_TEAM_A);

    const [shiftRow] = (await renderCard([
      shift({
        shiftKey: "variant",
        policies: [policyOfShift(CHECKOUT)],
        policyVariantOf: {
          policyId: CHECKOUT.id,
          policyName: CHECKOUT.name,
          globalUserId: BOB,
        },
      }),
    ])) as [HTMLElement];

    expect(coverPath(shiftRow)).toBe(policyPage(PROJECT_ID, CHECKOUT.id));
    expect(addAccessQuestions()).toEqual([]);
  });
});
