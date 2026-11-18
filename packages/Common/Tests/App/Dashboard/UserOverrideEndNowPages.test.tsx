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
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * END NOW (issue #7899), on the real pages with only the network stubbed.
 *
 * Coming back early took the Edit dialog and picking today's date and the
 * current minute by hand. Now an override in force has End Now:
 *
 *   - in each row's menu on a policy's User Overrides page and on the
 *     global one, beside Edit, which stays the row's button;
 *   - under Ends in its Edit dialog;
 *   - beside Edit on a schedule's user overrides card.
 *
 * Each asks one short question first - whose override, what happens to
 * the time left, who is paged from then on - then sends End Now for that
 * override (POST .../:id/end-now: the server ends it at its own now), says
 * so, and the list reads its overrides again. It is offered only where it
 * has something to end: never on an override that has not started, nor on
 * one that has ended. It is locked, saying why, where Edit is locked.
 *
 * And an override that overlapped another before the rule can be ended
 * early from its Edit dialog: shortened, it adds no time, so the dialog no
 * longer holds it back for the overlap.
 */

let allPermissionsForTest: Array<string> = [];
let projectRowsForTest: Array<unknown> = [];

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
          projectId: "7899b000-0000-4000-8000-000000000001",
          permissions: projectRowsForTest,
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
        return false;
      },
      // Alex is signed in.
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "7899b000-0000-4000-8000-0000000000a1";
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "7899b000-0000-4000-8000-000000000001" };
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
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
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
            return "7899b000-0000-4000-8000-000000000001";
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

import GlobalUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/UserOverrides";
import PolicyUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/UserOverrides";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ActiveOverridesCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard";
import { formatHandOffInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import {
  OverrideSummaryRow,
  OverrideUserDisplayInfo,
  buildOverrideSummaryRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import * as ScheduleOverrides from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverrides";
import {
  USER_OVERRIDE_END_NOW_COVERED,
  USER_OVERRIDE_END_NOW_SKIPPED,
  USER_OVERRIDE_END_NOW_TITLE,
  USER_OVERRIDE_ENDED_TOAST,
  canEndUserOverrideNow,
  getUserOverrideEndNowQuestion,
  getUserOverrideEndNowUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideEndNow";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_USER_OVERRIDE_EDIT_REFUSAL } from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import { USER_OVERRIDE_ENDED_REFUSAL } from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import Permission, { UserPermission } from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { Translator, fillTemplate } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Toast from "../../../UI/Utils/Toast";

jest.setTimeout(30000);

const PROJECT_ID: string = "7899b000-0000-4000-8000-000000000001";
const POLICY_ID: string = "7899b000-0000-4000-8000-000000000002";
const TEAM_A_LABEL: string = "7899b000-0000-4000-8000-0000000000e1";

const ALEX: string = "7899b000-0000-4000-8000-0000000000a1";
const SAM: string = "7899b000-0000-4000-8000-0000000000b1";
const PAT: string = "7899b000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [SAM]: { name: "Sam Rivera", email: "sam@example.com" },
  [PAT]: { name: "Pat Kim", email: "pat@example.com" },
};

// The pages open at noon on 13 November 2026, UTC.
const NOW: Date = OneUptimeDate.fromString("2026-11-13T12:00:00.000Z");

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

const pageProps: PageComponentProps = {
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

interface SavedOverride {
  id: string;
  away: string;
  cover: string | null;
  policyId: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt?: Date | undefined;
}

let saved: Array<SavedOverride> = [];
let endNowPost: SpyInstance<typeof API.post>;

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

function holding(rows: Array<UserPermission>): void {
  projectRowsForTest = rows;
  allPermissionsForTest = Array.from(
    new Set<string>(
      rows.map((candidate: UserPermission): string => {
        return candidate.permission;
      }),
    ),
  );
}

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
}

function toModel(override: SavedOverride): OnCallDutyPolicyUserOverride {
  const model: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  model._id = override.id;
  model.projectId = new ObjectID(PROJECT_ID);
  model.overrideUserId = new ObjectID(override.away);
  model.overrideUser = user(override.away);

  if (override.cover) {
    model.routeAlertsToUserId = new ObjectID(override.cover);
    model.routeAlertsToUser = user(override.cover);
  }

  if (override.policyId) {
    model.onCallDutyPolicyId = new ObjectID(override.policyId);
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = override.policyId;
    policy.name = "Primary On-Call";
    model.onCallDutyPolicy = policy;
  }

  model.startsAt = override.startsAt;
  model.endsAt = override.endsAt;
  model.createdAt = override.createdAt || at("2026-11-01T00:00:00.000Z");
  return model;
}

function answers(
  override: SavedOverride,
  query: Record<string, unknown>,
): boolean {
  const policy: unknown = query["onCallDutyPolicyId"];

  if (policy instanceof IsNull && override.policyId) {
    return false;
  }

  if (
    typeof policy === "string" &&
    policy.toLowerCase() !== (override.policyId || "").toLowerCase()
  ) {
    return false;
  }

  const away: unknown = query["overrideUserId"];

  if (away && String(away).toLowerCase() !== override.away.toLowerCase()) {
    return false;
  }

  const startsAt: unknown = query["startsAt"];

  if (
    startsAt instanceof LessThan &&
    !(override.startsAt.getTime() < new Date(startsAt.value as Date).getTime())
  ) {
    return false;
  }

  const endsAt: unknown = query["endsAt"];

  if (
    endsAt instanceof GreaterThan &&
    !(override.endsAt.getTime() > new Date(endsAt.value as Date).getTime())
  ) {
    return false;
  }

  return true;
}

function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate).toLowerCase() === id.toLowerCase();
    },
  );
}

// The overlap checks the dialog asked: a list read of one person's overrides.
function overlapChecks(): number {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    const params: any = call[0];

    return (
      params.modelType === OnCallDutyPolicyUserOverride &&
      Boolean(params.query?.overrideUserId)
    );
  }).length;
}

// The table's own reads of its rows (not the overlap checks, nor the marks).
function tableReads(): number {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    const params: any = call[0];

    return (
      params.modelType === OnCallDutyPolicyUserOverride &&
      !params.query?.overrideUserId &&
      !params.query?.endsAt
    );
  }).length;
}

// The End Now requests sent, by override id.
function endNowSentFor(): Array<string> {
  return endNowPost.mock.calls
    .map((call: Array<any>): string => {
      return String(call[0]?.url || "");
    })
    .filter((url: string): boolean => {
      return url.endsWith("/end-now");
    })
    .map((url: string): string => {
      const parts: Array<string> = url.split("/");
      return parts[parts.length - 2] || "";
    });
}

beforeEach(() => {
  holding([row(Permission.ProjectAdmin)]);
  saved = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(
        saved
          .filter((override: SavedOverride): boolean => {
            return answers(override, query);
          })
          .map(toModel),
      );
    }

    if (params.modelType === TeamMember) {
      return list(
        [ALEX, SAM, PAT]
          .filter((id: string): boolean => {
            return wanted(query["userId"], id);
          })
          .map((id: string): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.user = user(id);
            return member;
          }),
      );
    }

    return list([]);
  });

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    const found: SavedOverride | undefined = saved.find(
      (override: SavedOverride): boolean => {
        return override.id === params.id.toString();
      },
    );

    return found ? toModel(found) : null;
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });

  // End Now, as the server answers it: the override ends at its now.
  endNowPost = jest
    .spyOn(API, "post")
    .mockImplementation(async (options: any): Promise<any> => {
      const url: string = String(options.url);
      const parts: Array<string> = url.split("/");
      const id: string = parts[parts.length - 2] || "";

      // A copy: the overrides the suite starts from are shared by every test.
      saved = saved.map((candidate: SavedOverride): SavedOverride => {
        return candidate.id === id ? { ...candidate, endsAt: NOW } : candidate;
      });

      return new HTTPResponse(200, { _id: id, endsAt: NOW.toISOString() }, {});
    }) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

async function renderPage(page: "global" | "policy"): Promise<void> {
  const path: string =
    page === "global"
      ? `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`
      : `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/user-overrides`;

  window.history.replaceState(window.history.state, "", path);

  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as never);

  render(
    <MemoryRouter>
      {page === "global" ? (
        <GlobalUserOverridesPage {...pageProps} />
      ) : (
        <PolicyUserOverridesPage {...pageProps} />
      )}
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(tableReads()).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );
}

async function tableRowWith(...texts: Array<string>): Promise<HTMLElement> {
  return await waitFor(
    (): HTMLElement => {
      const found: HTMLElement | undefined = Array.from(
        document.querySelectorAll("tr"),
      ).find((candidate: HTMLElement): boolean => {
        return texts.every((text: string): boolean => {
          return (candidate.textContent || "").includes(text);
        });
      });

      if (!found) {
        throw new Error(`No row with ${texts.join(", ")}`);
      }

      return found;
    },
    { timeout: 5000 },
  );
}

// The row's ⋯ menu, opened: its items by their words.
async function openRowMenu(tableRow: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(tableRow).getByTestId("row-actions-more-button"));
  });
}

function menuItem(words: string): HTMLElement | null {
  return (
    screen.queryAllByRole("menuitem").find((item: HTMLElement): boolean => {
      return (item.textContent || "").trim() === words;
    }) || null
  );
}

// What a locked button says when pressed: the wrapper it is drawn in.
async function expectLockedSaying(
  button: HTMLElement,
  reason: string,
): Promise<void> {
  expect(button).toHaveAttribute("aria-disabled", "true");

  fireEvent.click(button);
  await act(async (): Promise<void> => {});

  expect(screen.queryByTestId("modal")).toBeNull();

  fireEvent.click(button.closest("span[tabindex]") as HTMLElement);

  await waitFor(() => {
    expect(document.body).toHaveTextContent(reason);
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

function chipIds(group: HTMLElement): Array<string | null> {
  return within(group)
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

// The Edit dialog, once its rows hold what they open on.
async function openEditDialog(): Promise<HTMLElement> {
  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByRole("heading", { name: "Edit User Override" });

  await waitFor(() => {
    expect(
      chipIds(within(modal).getByRole("group", { name: "Who is away?" })),
    ).toEqual([ALEX]);
  });

  return modal;
}

function setTime(modal: HTMLElement, title: string, value: Date): void {
  fireEvent.change(timeInput(modal, title), {
    target: { value: OneUptimeDate.toDateTimeLocalString(value) },
  });
}

function shown(date: Date): string {
  return formatHandOffInstant(date, undefined, NOW);
}

// Alex, covered by Sam on the policy, since this morning, until tomorrow morning.
const IN_FORCE: SavedOverride = {
  id: "7899b000-0000-4000-8000-0000000000f1",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-13T08:00:00.000Z"),
  endsAt: at("2026-11-14T08:00:00.000Z"),
};

// Alex, covered by Sam on the policy, next week.
const UPCOMING: SavedOverride = {
  id: "7899b000-0000-4000-8000-0000000000f2",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-20T09:00:00.000Z"),
  endsAt: at("2026-11-20T17:00:00.000Z"),
};

// Alex, covered by Sam on the policy, last week.
const ENDED: SavedOverride = {
  id: "7899b000-0000-4000-8000-0000000000f3",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-05T09:00:00.000Z"),
  endsAt: at("2026-11-06T09:00:00.000Z"),
};

// Pat, skipped on every policy since this morning, until tonight.
const GLOBAL_SKIP: SavedOverride = {
  id: "7899b000-0000-4000-8000-0000000000f4",
  away: PAT,
  cover: null,
  policyId: null,
  startsAt: at("2026-11-13T06:00:00.000Z"),
  endsAt: at("2026-11-13T22:00:00.000Z"),
};

describe("the question End Now asks", () => {
  const translator: Translator = {
    translateText: (text: string): string => {
      return text;
    },
    translateTemplate: (
      template: string,
      values: Record<string, unknown>,
    ): string => {
      return fillTemplate(template, values as never);
    },
  } as unknown as Translator;

  test("names whose override it ends, who stops covering, the time left, and who is paged again", () => {
    expect(
      getUserOverrideEndNowQuestion({
        translator: translator,
        target: {
          id: IN_FORCE.id,
          startsAt: IN_FORCE.startsAt,
          endsAt: IN_FORCE.endsAt,
          awayName: "Alex Chen",
          coverName: "Sam Rivera",
        },
      }),
    ).toEqual({
      title: "End the override for Alex Chen now?",
      description: `Sam Rivera stops covering for Alex Chen now instead of ${shown(IN_FORCE.endsAt)}. From then on, alerts page Alex Chen again.`,
    });
  });

  test("for a skip, that the person is back in the rotation", () => {
    expect(
      getUserOverrideEndNowQuestion({
        translator: translator,
        target: {
          id: GLOBAL_SKIP.id,
          startsAt: GLOBAL_SKIP.startsAt,
          endsAt: GLOBAL_SKIP.endsAt,
          awayName: "Pat Kim",
          coverName: null,
        },
      }).description,
    ).toBe(
      fillTemplate(USER_OVERRIDE_END_NOW_SKIPPED, {
        away: "Pat Kim",
        until: shown(GLOBAL_SKIP.endsAt),
      }),
    );
  });

  test("writes the end in the zone it is handed, as the schedule's card writes its times", () => {
    expect(
      getUserOverrideEndNowQuestion({
        translator: translator,
        target: {
          id: IN_FORCE.id,
          startsAt: IN_FORCE.startsAt,
          endsAt: IN_FORCE.endsAt,
          awayName: "Alex Chen",
          coverName: "Sam Rivera",
        },
        timezone: "Asia/Tokyo",
      }).description,
    ).toContain(formatHandOffInstant(IN_FORCE.endsAt, "Asia/Tokyo", NOW));
  });

  test("is offered only for an override under way", () => {
    expect(canEndUserOverrideNow(IN_FORCE, NOW)).toBe(true);
    expect(canEndUserOverrideNow(UPCOMING, NOW)).toBe(false);
    expect(canEndUserOverrideNow(ENDED, NOW)).toBe(false);
    expect(canEndUserOverrideNow(null, NOW)).toBe(false);
  });

  test("is sent to the override's own end-now route", () => {
    expect(getUserOverrideEndNowUrl(IN_FORCE.id).toString()).toContain(
      `/on-call-duty-policy-user-override/${IN_FORCE.id}/end-now`,
    );
  });
});

describe("End Now on a policy's User Overrides page", () => {
  test("an override in force: End Now in its menu, beside Edit, which stays the row's button", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");

    const tableRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");

    expect(
      within(tableRow).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();

    await openRowMenu(tableRow);

    expect(menuItem("End Now")).not.toBeNull();
  });

  test("asks first, saying what happens to the time left and who is paged again; then ends it, says so, and reads the list again", async () => {
    saved = [IN_FORCE];
    const toast: SpyInstance<typeof Toast.success> = jest.spyOn(
      Toast,
      "success",
    );

    await renderPage("policy");

    const tableRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");

    await openRowMenu(tableRow);
    await act(async (): Promise<void> => {
      fireEvent.click(menuItem("End Now")!);
    });

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    expect(
      within(dialog).getByRole("heading", {
        name: fillTemplate(USER_OVERRIDE_END_NOW_TITLE, { name: "Alex Chen" }),
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_END_NOW_COVERED, {
        cover: "Sam Rivera",
        away: "Alex Chen",
        until: shown(IN_FORCE.endsAt),
      }),
    );

    // Nothing is sent until it is confirmed.
    expect(endNowSentFor()).toEqual([]);

    const readsBefore: number = tableReads();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "End Now", exact: true }),
      );
    });

    await waitFor(() => {
      expect(endNowSentFor()).toEqual([IN_FORCE.id]);
    });

    // No time of the browser's is sent: the server ends it at its own now.
    expect(endNowPost.mock.calls[0]![0].data).toEqual({});
    expect(endNowPost.mock.calls[0]![0].headers).toEqual(
      expect.objectContaining({ tenantid: PROJECT_ID }),
    );

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        fillTemplate(USER_OVERRIDE_ENDED_TOAST, { name: "Alex Chen" }),
      );
    });
    await waitFor(() => {
      expect(tableReads()).toBeGreaterThan(readsBefore);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("row-actions-dialog")).toBeNull();
    });
  });

  test("Cancel sends nothing", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");

    await openRowMenu(await tableRowWith("Alex Chen", "Sam Rivera"));
    await act(async (): Promise<void> => {
      fireEvent.click(menuItem("End Now")!);
    });

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("row-actions-dialog")).toBeNull();
    });
    expect(endNowSentFor()).toEqual([]);
  });

  test("a refusal is said in the question, which stays open", async () => {
    saved = [IN_FORCE];
    endNowPost.mockImplementation(async (): Promise<any> => {
      return new HTTPErrorResponse(
        400,
        { message: USER_OVERRIDE_ENDED_REFUSAL },
        {},
      );
    });

    await renderPage("policy");

    await openRowMenu(await tableRowWith("Alex Chen", "Sam Rivera"));
    await act(async (): Promise<void> => {
      fireEvent.click(menuItem("End Now")!);
    });

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "End Now", exact: true }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-actions-dialog")).toHaveTextContent(
        USER_OVERRIDE_ENDED_REFUSAL,
      );
    });
  });

  test.each([
    ["one that has not started", UPCOMING],
    ["one that has ended", ENDED],
  ])("is not offered on %s", async (_name: string, override: SavedOverride) => {
    saved = [override];

    await renderPage("policy");

    const tableRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");

    // Edit and Delete only: the row's button and a menu without End Now.
    if (within(tableRow).queryByTestId("row-actions-more-button")) {
      await openRowMenu(tableRow);
    }

    expect(menuItem("End Now")).toBeNull();
    expect(within(tableRow).queryByText("End Now")).toBeNull();
  });

  test("a reader who may only read overrides finds End Now locked, and nothing opens", async () => {
    holding([row(Permission.Viewer)]);
    saved = [IN_FORCE];

    await renderPage("policy");

    await openRowMenu(await tableRowWith("Alex Chen", "Sam Rivera"));

    const item: HTMLElement | null = menuItem("End Now");

    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("aria-disabled", "true");

    await act(async (): Promise<void> => {
      fireEvent.click(item!);
    });

    expect(screen.queryByTestId("row-actions-dialog")).toBeNull();
    expect(endNowSentFor()).toEqual([]);
  });
});

describe("End Now on the global page", () => {
  test("ends a global skip under way, saying the person takes their turns again", async () => {
    holding([row(Permission.OnCallMember)]);
    saved = [GLOBAL_SKIP];

    await renderPage("global");

    await openRowMenu(await tableRowWith("Pat Kim"));
    await act(async (): Promise<void> => {
      fireEvent.click(menuItem("End Now")!);
    });

    const dialog: HTMLElement = await screen.findByTestId("row-actions-dialog");

    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_END_NOW_SKIPPED, {
        away: "Pat Kim",
        until: shown(GLOBAL_SKIP.endsAt),
      }),
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "End Now", exact: true }),
      );
    });

    await waitFor(() => {
      expect(endNowSentFor()).toEqual([GLOBAL_SKIP.id]);
    });
  });

  test("for a reader limited to their team's label, End Now is locked, saying why, as Edit is", async () => {
    holding([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      row(Permission.Viewer),
    ]);
    saved = [GLOBAL_SKIP];

    await renderPage("global");

    await openRowMenu(await tableRowWith("Pat Kim"));

    const item: HTMLElement | null = menuItem("End Now");

    expect(item).toHaveAttribute("aria-disabled", "true");

    await act(async (): Promise<void> => {
      fireEvent.click(item!);
    });

    expect(screen.queryByTestId("row-actions-dialog")).toBeNull();
    expect(document.body).toHaveTextContent(GLOBAL_USER_OVERRIDE_EDIT_REFUSAL);
  });
});

describe("End Now under Ends in the Edit dialog", () => {
  test("an override in force: End Now asks in the dialog's place; Cancel goes back to the override, and nothing is sent", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");
    fireEvent.click(
      within(await tableRowWith("Alex Chen", "Sam Rivera")).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const modal: HTMLElement = await openEditDialog();

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByTestId("user-override-end-now"));
    });

    const question: HTMLElement = await screen.findByTestId("modal");

    await within(question).findByRole("heading", {
      name: fillTemplate(USER_OVERRIDE_END_NOW_TITLE, { name: "Alex Chen" }),
    });
    expect(screen.getAllByTestId("modal")).toHaveLength(1);

    await act(async (): Promise<void> => {
      fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    });

    // Back to the override's Edit, as saved.
    const again: HTMLElement = await openEditDialog();

    expect(timeInput(again, "Ends").value).toBe(
      OneUptimeDate.toDateTimeLocalString(IN_FORCE.endsAt).slice(0, 16),
    );
    expect(endNowSentFor()).toEqual([]);
  });

  test("confirmed, it ends the override, closes, and the list reads its overrides again", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");
    fireEvent.click(
      within(await tableRowWith("Alex Chen", "Sam Rivera")).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const modal: HTMLElement = await openEditDialog();
    const readsBefore: number = tableReads();

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByTestId("user-override-end-now"));
    });

    const question: HTMLElement = await screen.findByTestId("modal");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(question).getByRole("button", { name: "End Now", exact: true }),
      );
    });

    await waitFor(() => {
      expect(endNowSentFor()).toEqual([IN_FORCE.id]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    await waitFor(() => {
      expect(tableReads()).toBeGreaterThan(readsBefore);
    });
    // Nothing else was saved: End Now is not the form's Save.
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("an override that has not started has no End Now", async () => {
    saved = [UPCOMING];

    await renderPage("policy");
    fireEvent.click(
      within(await tableRowWith("Alex Chen", "Sam Rivera")).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const modal: HTMLElement = await openEditDialog();

    expect(within(modal).queryByTestId("user-override-end-now")).toBeNull();
  });

  /*
   * Two overrides of Alex on the policy that overlapped before overlaps
   * were refused. Ending the one in force early still leaves it over the
   * other, but adds no time: the dialog no longer holds it back.
   */
  test("one that overlapped another before the rule: its end moved sooner is not held back, and is saved", async () => {
    const OVERLAPPING: SavedOverride = {
      id: "7899b000-0000-4000-8000-0000000000f5",
      away: ALEX,
      cover: PAT,
      policyId: POLICY_ID,
      startsAt: at("2026-11-13T10:00:00.000Z"),
      endsAt: at("2026-11-13T20:00:00.000Z"),
      createdAt: at("2026-11-02T00:00:00.000Z"),
    };

    saved = [IN_FORCE, OVERLAPPING];

    await renderPage("policy");
    fireEvent.click(
      within(await tableRowWith("Alex Chen", "Sam Rivera")).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const modal: HTMLElement = await openEditDialog();
    const checksBefore: number = overlapChecks();

    setTime(modal, "Ends", at("2026-11-13T15:00:00.000Z"));

    await waitFor(
      () => {
        expect(overlapChecks()).toBeGreaterThan(checksBefore);
      },
      { timeout: 3000 },
    );
    await act(async (): Promise<void> => {});

    expect(
      within(modal).queryByTestId("user-override-overlap-conflict"),
    ).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: "Save Changes",
          exact: true,
        }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = (
      createOrUpdateMock.mock.calls[0]![0] as any
    ).model;

    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      "2026-11-13T15:00:00.000Z",
    );
  });

  test("the same override's end moved later, over the other one, is still held back", async () => {
    const LATER: SavedOverride = {
      id: "7899b000-0000-4000-8000-0000000000f6",
      away: ALEX,
      cover: PAT,
      policyId: POLICY_ID,
      startsAt: at("2026-11-14T10:00:00.000Z"),
      endsAt: at("2026-11-14T20:00:00.000Z"),
    };

    saved = [IN_FORCE, LATER];

    await renderPage("policy");
    fireEvent.click(
      within(await tableRowWith("Alex Chen", "Sam Rivera")).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const modal: HTMLElement = await openEditDialog();

    setTime(modal, "Ends", at("2026-11-14T12:00:00.000Z"));

    await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );
  });
});

describe("End Now on a schedule's user overrides card", () => {
  const userById: Record<string, OverrideUserDisplayInfo> = {
    [ALEX]: PEOPLE[ALEX]!,
    [SAM]: PEOPLE[SAM]!,
    [PAT]: PEOPLE[PAT]!,
  };

  function renderCard(records: Array<SavedOverride>): void {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: records.map((override: SavedOverride) => {
        return {
          id: override.id,
          createdAt: override.createdAt || at("2026-11-01T00:00:00.000Z"),
          overrideUserId: override.away,
          routeAlertsToUserId: override.cover,
          onCallDutyPolicyId: override.policyId,
          startsAt: override.startsAt,
          endsAt: override.endsAt,
        };
      }),
      userInfoById: userById,
      policyNameById: { [POLICY_ID]: "Primary On-Call" },
      now: NOW,
    });

    render(
      <MemoryRouter>
        <ActiveOverridesCard
          rows={rows}
          userById={userById}
          timezone="Asia/Tokyo"
        />
      </MemoryRouter>,
    );
  }

  test("beside Edit on the override in force only; confirmed, it ends and the schedule reads its overrides again", async () => {
    const notified: SpyInstance<() => void> = jest.spyOn(
      ScheduleOverrides,
      "notifyScheduleUserOverridesChanged",
    );

    saved = [IN_FORCE, UPCOMING];
    renderCard([IN_FORCE, UPCOMING]);

    expect(screen.getAllByTestId("active-override-end-now")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "End the override for Alex Chen now",
      }),
    );

    const question: HTMLElement = await screen.findByTestId("modal");

    // The end in the schedule's zone, as the card's rows write it.
    expect(
      within(question).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      formatHandOffInstant(IN_FORCE.endsAt, "Asia/Tokyo", NOW),
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(question).getByRole("button", { name: "End Now", exact: true }),
      );
    });

    await waitFor(() => {
      expect(endNowSentFor()).toEqual([IN_FORCE.id]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(notified).toHaveBeenCalledTimes(1);
  });

  test("a global override's End Now is locked for a reader limited to a label, as its Edit is", async () => {
    holding([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      row(Permission.Viewer),
    ]);

    renderCard([GLOBAL_SKIP]);

    await expectLockedSaying(
      screen.getByRole("button", { name: "End the override for Pat Kim now" }),
      GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
    );
    expect(endNowSentFor()).toEqual([]);
  });
});
