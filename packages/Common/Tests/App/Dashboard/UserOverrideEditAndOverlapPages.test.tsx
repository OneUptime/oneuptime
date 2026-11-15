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
 * EDITING A USER OVERRIDE, AND OVERLAPS SAID AS SOON AS THE TIMES ARE PICKED
 * (issues #7631 and #7630), on the real pages with only the network stubbed:
 *
 *   - each row of a policy's User Overrides page, and of the global one, has
 *     Edit: the override's four rows as saved. Who is away is shown and
 *     locked; so is when it starts, once it has started. Who covers changes
 *     - cleared, the rotation covers - and so do the times. What is sent
 *     never names who is away, the policy or the project;
 *   - an override that has ended keeps its Edit, locked, saying why; on the
 *     global page, so does every override for a reader whose permission
 *     covers only some policies;
 *   - an end moved to the past is refused under Ends before anything is
 *     sent;
 *   - Add and Edit say under Ends what the times picked overlap: one of the
 *     same person in the same scope keeps the form from being sent, with
 *     "Edit that override" to change that one instead; one of the other
 *     scope is allowed, and said plainly; back to back is no overlap;
 *   - the server's refusal of an overlap the reader could not see is said
 *     under Ends too;
 *   - two overrides saved before the rule are both marked "Overlaps",
 *     saying which of the two is used;
 *   - a schedule's active overrides card has the same Edit and the same
 *     mark, and a save there reads the schedule's overrides again.
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
          projectId: "7631a000-0000-4000-8000-000000000001",
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
            return "7631a000-0000-4000-8000-0000000000a1";
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
            return "7631a000-0000-4000-8000-000000000001";
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
  USER_OVERRIDE_AWAY_LOCKED_TEXT,
  USER_OVERRIDE_END_NOW_TEXT,
  USER_OVERRIDE_ROTATION_COVERS_TEXT,
  USER_OVERRIDE_START_LOCKED_TEXT,
  USER_OVERRIDE_START_MOVABLE_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
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
import {
  USER_OVERRIDE_END_IN_PAST_REFUSAL,
  USER_OVERRIDE_ENDED_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideEdit";
import {
  USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY,
  USER_OVERRIDE_OVERLAPS_COVERED,
  USER_OVERRIDE_OVERLAPS_SKIPPED,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import Permission, { UserPermission } from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { fillTemplate } from "../../../Types/Translator";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "7631a000-0000-4000-8000-000000000001";
const POLICY_ID: string = "7631a000-0000-4000-8000-000000000002";
const TEAM_A_LABEL: string = "7631a000-0000-4000-8000-0000000000e1";

const ALEX: string = "7631a000-0000-4000-8000-0000000000a1";
const SAM: string = "7631a000-0000-4000-8000-0000000000b1";
const PAT: string = "7631a000-0000-4000-8000-0000000000c1";

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

// One saved override, as the project holds it.
interface SavedOverride {
  id: string;
  away: string;
  // Nobody: the rotation covers.
  cover: string | null;
  // Nobody: a global override.
  policyId: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt?: Date | undefined;
}

let saved: Array<SavedOverride> = [];

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

// The reader holds these rows, as the permission snapshot carries them.
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

// A fresh copy of a saved override, as the API answers with one.
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

// Whether a saved override answers a list's query, as the API filters.
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

// The ids an Includes query asks for, or every id when it asks for none.
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
function overlapChecks(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<any>): any => {
      return call[0];
    })
    .filter((params: any): boolean => {
      return (
        params.modelType === OnCallDutyPolicyUserOverride &&
        Boolean(params.query?.overrideUserId)
      );
    })
    .map((params: any): Record<string, unknown> => {
      return params.query;
    });
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

    // The people pickers' search lists, and their look-ups by id.
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

// The table row that says every one of `texts`: who is away, who covers.
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

// A time as a minute picker holds it: to the minute, in the reader's zone.
function localMinute(date: Date): string {
  return OneUptimeDate.toDateTimeLocalString(date).slice(0, 16);
}

// A row's Edit.
function editOf(tableRow: HTMLElement): HTMLElement {
  return within(tableRow).getByRole("button", { name: "Edit" });
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

// The dialog, once its rows hold what they open on.
async function openDialog(heading: string): Promise<HTMLElement> {
  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByRole("heading", { name: heading });
  await within(modal).findByText("Who covers?");

  await waitFor(() => {
    expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
    expect(
      within(picker(modal, "Who is away?")).queryByText("Loading..."),
    ).toBeNull();
  });

  return modal;
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

// The people picker under a question: its group is named by the label.
function picker(modal: HTMLElement, question: string): HTMLElement {
  return within(modal).getByRole("group", { name: question });
}

function chipIds(group: HTMLElement): Array<string | null> {
  return within(group)
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

function setTime(modal: HTMLElement, title: string, value: Date): void {
  fireEvent.change(timeInput(modal, title), {
    target: { value: OneUptimeDate.toDateTimeLocalString(value) },
  });
}

async function submit(modal: HTMLElement, buttonName: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: buttonName, exact: true }),
    );
  });
}

// The error said under a time field, or "".
function errorUnder(modal: HTMLElement, title: string): string {
  const input: HTMLInputElement = timeInput(modal, title);
  const ids: Array<string> = (input.getAttribute("aria-describedby") || "")
    .split(" ")
    .filter(Boolean);

  for (const id of ids) {
    const element: HTMLElement | null = document.getElementById(id);

    if (element?.getAttribute("data-testid") === "error-message") {
      return (element.textContent || "").trim();
    }
  }

  return "";
}

/*
 * A field's description says `text`, as the form draws it under the label
 * - a time's with the reader's time zone after it.
 */
function descriptionsOf(modal: HTMLElement): string {
  return Array.from(modal.querySelectorAll('[id$="-description"]'))
    .map((element: Element): string => {
      return element.textContent || "";
    })
    .join("\n");
}

function expectDescribed(modal: HTMLElement, text: string): void {
  expect(descriptionsOf(modal)).toContain(text);
}

function sentOverride(): OnCallDutyPolicyUserOverride {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (createOrUpdateMock.mock.calls[0]![0] as any)
    .model as OnCallDutyPolicyUserOverride;
}

function idOf(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

/*
 * A time as the overlap check and the marks write it: in the reader's zone,
 * which Starts and Ends say, so without it - and without the year while it
 * is this year.
 */
function shown(date: Date): string {
  return formatHandOffInstant(date, undefined, NOW);
}

// Alex, covered by Sam on the policy, a week from now.
const UPCOMING: SavedOverride = {
  id: "7631a000-0000-4000-8000-0000000000f1",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-20T09:00:00.000Z"),
  endsAt: at("2026-11-20T17:00:00.000Z"),
};

// Alex, covered by Sam on the policy, since this morning.
const IN_FORCE: SavedOverride = {
  id: "7631a000-0000-4000-8000-0000000000f2",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-13T08:00:00.000Z"),
  endsAt: at("2026-11-14T08:00:00.000Z"),
};

// Alex, covered by Sam on the policy, last week.
const ENDED: SavedOverride = {
  id: "7631a000-0000-4000-8000-0000000000f3",
  away: ALEX,
  cover: SAM,
  policyId: POLICY_ID,
  startsAt: at("2026-11-05T09:00:00.000Z"),
  endsAt: at("2026-11-06T09:00:00.000Z"),
};

describe("Edit on a policy's User Overrides page", () => {
  test("an upcoming override opens on its four rows as saved: who is away shown alone, the times free", async () => {
    saved = [UPCOMING];

    await renderPage("policy");
    fireEvent.click(editOf(await tableRowWith("Alex Chen", "Sam Rivera")));

    const modal: HTMLElement = await openDialog("Edit User Override");

    await waitFor(() => {
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([SAM]);
    });

    /*
     * Who is away: shown, never changed - the person alone, with no Change
     * button: a locked one offered what the description says is not made
     * here.
     */
    expectDescribed(modal, USER_OVERRIDE_AWAY_LOCKED_TEXT);
    expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
    expect(
      within(picker(modal, "Who is away?")).queryByTestId(
        "people-picker-add-button",
      ),
    ).toBeNull();
    expect(
      within(picker(modal, "Who is away?")).queryByRole("button", {
        name: "Remove Alex Chen",
      }),
    ).toBeNull();

    // It has not started: both times may change.
    expect(timeInput(modal, "Starts")).not.toHaveAttribute("readonly");
    expect(timeInput(modal, "Ends")).not.toHaveAttribute("readonly");
    /*
     * Starts says what it may be moved to. It said nothing of its own, so
     * its column's description stood in: "When the override starts sending
     * the Override User's alerts to the Route Alerts To User", in English
     * in every language.
     */
    expectDescribed(modal, USER_OVERRIDE_START_MOVABLE_TEXT);
    expect(modal.textContent).not.toMatch(/Override User|Route Alerts To User/);
    expect(timeInput(modal, "Starts").value).toBe(
      localMinute(UPCOMING.startsAt),
    );
    expect(timeInput(modal, "Ends").value).toBe(localMinute(UPCOMING.endsAt));
    expect(descriptionsOf(modal)).not.toContain(
      USER_OVERRIDE_START_LOCKED_TEXT,
    );
    expect(descriptionsOf(modal)).not.toContain(USER_OVERRIDE_END_NOW_TEXT);

    const readsBefore: number = tableReads();

    setTime(modal, "Ends", at("2026-11-20T19:00:00.000Z"));
    await submit(modal, "Save Changes");

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    expect((createOrUpdateMock.mock.calls[0]![0] as any).formType).toBe(
      FormType.Update,
    );
    expect(idOf(sent._id)).toBe(UPCOMING.id);
    // Never who is away, the policy or the project: their columns take no change.
    expect(sent.overrideUserId).toBeUndefined();
    expect(sent.onCallDutyPolicyId).toBeUndefined();
    expect(sent.projectId).toBeUndefined();
    expect(idOf(sent.routeAlertsToUserId)?.toLowerCase()).toBe(SAM);
    expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
      UPCOMING.startsAt.toISOString(),
    );
    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      "2026-11-20T19:00:00.000Z",
    );

    // Saved: the dialog closes, and the table reads its rows again.
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    await waitFor(() => {
      expect(tableReads()).toBeGreaterThan(readsBefore);
    });
  });

  test("an override in force: Starts is shown and locked, saying why; who covers can be cleared, and the edit sends no start", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");
    fireEvent.click(editOf(await tableRowWith("Alex Chen", "Sam Rivera")));

    const modal: HTMLElement = await openDialog("Edit User Override");

    await waitFor(() => {
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([SAM]);
      expect(
        within(picker(modal, "Who covers?")).getByRole("button", {
          name: "Remove Sam Rivera",
        }),
      ).toBeInTheDocument();
    });

    expect(timeInput(modal, "Starts")).toHaveAttribute("readonly");
    expectDescribed(modal, USER_OVERRIDE_START_LOCKED_TEXT);
    expectDescribed(modal, USER_OVERRIDE_END_NOW_TEXT);
    expect(timeInput(modal, "Ends")).not.toHaveAttribute("readonly");

    // Nobody covers: the rotation does.
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(picker(modal, "Who covers?")).getByRole("button", {
          name: "Remove Sam Rivera",
        }),
      );
    });

    await waitFor(() => {
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([]);
      expect(
        within(picker(modal, "Who covers?")).getByText(
          USER_OVERRIDE_ROTATION_COVERS_TEXT,
        ),
      ).toBeInTheDocument();
    });

    await submit(modal, "Save Changes");

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    // Sent as none - not left out - so the saved cover is cleared.
    expect(sent.routeAlertsToUserId).toBeNull();
    expect(sent.startsAt).toBeUndefined();
    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      IN_FORCE.endsAt.toISOString(),
    );
    expect(sent.overrideUserId).toBeUndefined();
  });

  test("ending it now: an end moved to the current minute is sent", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");
    fireEvent.click(editOf(await tableRowWith("Alex Chen", "Sam Rivera")));

    const modal: HTMLElement = await openDialog("Edit User Override");

    setTime(modal, "Ends", NOW);
    await submit(modal, "Save Changes");

    expect(OneUptimeDate.fromString(sentOverride().endsAt!).toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("an end moved to the past is refused under Ends, and nothing is sent", async () => {
    saved = [IN_FORCE];

    await renderPage("policy");
    fireEvent.click(editOf(await tableRowWith("Alex Chen", "Sam Rivera")));

    const modal: HTMLElement = await openDialog("Edit User Override");

    setTime(modal, "Ends", at("2026-11-13T11:00:00.000Z"));
    await submit(modal, "Save Changes");

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(USER_OVERRIDE_END_IN_PAST_REFUSAL);
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("an override that has ended keeps its Edit, locked, saying why - and opens nothing", async () => {
    saved = [ENDED];

    await renderPage("policy");

    await expectLockedSaying(
      editOf(await tableRowWith("Alex Chen", "Sam Rivera")),
      USER_OVERRIDE_ENDED_REFUSAL,
    );
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("a reader who may only read overrides finds Edit locked", async () => {
    holding([row(Permission.Viewer)]);
    saved = [UPCOMING];

    await renderPage("policy");

    const edit: HTMLElement = editOf(
      await tableRowWith("Alex Chen", "Sam Rivera"),
    );

    expect(edit).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(edit);
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("Edit on the global page", () => {
  const GLOBAL: SavedOverride = {
    id: "7631a000-0000-4000-8000-0000000000f4",
    away: ALEX,
    cover: SAM,
    policyId: null,
    startsAt: at("2026-11-20T09:00:00.000Z"),
    endsAt: at("2026-11-20T17:00:00.000Z"),
  };

  test("for a reader limited to their team's label, Edit is locked, saying why", async () => {
    holding([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      row(Permission.Viewer),
    ]);
    saved = [GLOBAL];

    await renderPage("global");

    await expectLockedSaying(
      editOf(await tableRowWith("Alex Chen", "Sam Rivera")),
      GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
    );
  });

  test("for a reader over the whole project, Edit opens it, and the save names no policy", async () => {
    holding([row(Permission.OnCallMember)]);
    saved = [GLOBAL];

    await renderPage("global");
    fireEvent.click(editOf(await tableRowWith("Alex Chen", "Sam Rivera")));

    const modal: HTMLElement = await openDialog("Edit User Override");

    setTime(modal, "Starts", at("2026-11-20T10:00:00.000Z"));
    await submit(modal, "Save Changes");

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    expect(sent.onCallDutyPolicyId).toBeUndefined();
    expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
      "2026-11-20T10:00:00.000Z",
    );
  });
});

describe("overlaps are said as soon as the times are picked", () => {
  async function openAdd(): Promise<HTMLElement> {
    const button: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | undefined = screen
        .getAllByTestId("card-button")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").trim() === "Add User Override";
        });

      if (!found) {
        throw new Error("No Add User Override button yet");
      }

      return found;
    });

    fireEvent.click(button);

    return await openDialog("Add New User Override");
  }

  test("one of the same person on the same policy: said under Ends with Edit that override, and Add sends nothing", async () => {
    saved = [UPCOMING];

    await renderPage("policy");

    const modal: HTMLElement = await openAdd();

    setTime(modal, "Starts", at("2026-11-20T12:00:00.000Z"));
    setTime(modal, "Ends", at("2026-11-20T20:00:00.000Z"));

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    expect(conflict).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY, {
        away: "Alex Chen",
        cover: "Sam Rivera",
        from: shown(UPCOMING.startsAt),
        until: shown(UPCOMING.endsAt),
      }),
    );
    expect(
      within(conflict).getByRole("button", { name: "Edit that override" }),
    ).toBeInTheDocument();

    // The check asked for Alex's overrides at those times, in every scope.
    const check: Record<string, unknown> = overlapChecks().pop()!;

    expect(String(check["overrideUserId"]).toLowerCase()).toBe(ALEX);
    expect(check["onCallDutyPolicyId"]).toBeUndefined();

    await submit(modal, "Add User Override");

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(USER_OVERRIDE_CONFLICT_WHAT_TO_DO);
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("Edit that override opens that one in the dialog's place", async () => {
    saved = [UPCOMING];

    await renderPage("policy");

    const modal: HTMLElement = await openAdd();

    setTime(modal, "Starts", at("2026-11-20T12:00:00.000Z"));
    setTime(modal, "Ends", at("2026-11-20T20:00:00.000Z"));

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    fireEvent.click(
      within(conflict).getByRole("button", { name: "Edit that override" }),
    );

    const editing: HTMLElement = await openDialog("Edit User Override");

    await waitFor(() => {
      expect(timeInput(editing, "Ends").value).toBe(
        localMinute(UPCOMING.endsAt),
      );
      expect(chipIds(picker(editing, "Who covers?"))).toEqual([SAM]);
    });
    expect(screen.getAllByTestId("modal")).toHaveLength(1);

    // Editing it, it never overlaps itself.
    await act(async (): Promise<void> => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 600);
      });
    });

    expect(
      within(editing).queryByTestId("user-override-overlap-conflict"),
    ).toBeNull();
  });

  test("back to back is no overlap: nothing is said, and the override is added", async () => {
    saved = [UPCOMING];

    await renderPage("policy");

    const modal: HTMLElement = await openAdd();
    const checksBefore: number = overlapChecks().length;

    // It starts as the other ends.
    setTime(modal, "Starts", UPCOMING.endsAt);
    setTime(modal, "Ends", at("2026-11-20T20:00:00.000Z"));

    await waitFor(
      () => {
        expect(overlapChecks().length).toBeGreaterThan(checksBefore);
      },
      { timeout: 3000 },
    );
    await act(async (): Promise<void> => {});

    expect(
      within(modal).queryByTestId("user-override-overlap-conflict"),
    ).toBeNull();
    expect(
      within(modal).queryByTestId("user-override-overlap-note"),
    ).toBeNull();

    await submit(modal, "Add User Override");

    const sent: OnCallDutyPolicyUserOverride = sentOverride();

    expect(idOf(sent.onCallDutyPolicyId)?.toLowerCase()).toBe(POLICY_ID);
    expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
      UPCOMING.endsAt.toISOString(),
    );
  });

  test("a global override of the same person is allowed, and said plainly", async () => {
    const globalSkip: SavedOverride = {
      id: "7631a000-0000-4000-8000-0000000000f5",
      away: ALEX,
      cover: null,
      policyId: null,
      startsAt: at("2026-11-20T00:00:00.000Z"),
      endsAt: at("2026-11-21T00:00:00.000Z"),
    };

    saved = [globalSkip];

    await renderPage("policy");

    const modal: HTMLElement = await openAdd();

    setTime(modal, "Starts", at("2026-11-20T09:00:00.000Z"));
    setTime(modal, "Ends", at("2026-11-20T17:00:00.000Z"));

    const note: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-note",
      {},
      { timeout: 3000 },
    );

    expect(note).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_NOTE_GLOBAL_UNDER_POLICY, {
        away: "Alex Chen",
        from: shown(globalSkip.startsAt),
        until: shown(globalSkip.endsAt),
      }),
    );
    expect(
      within(modal).queryByTestId("user-override-overlap-conflict"),
    ).toBeNull();

    await submit(modal, "Add User Override");

    expect(idOf(sentOverride().onCallDutyPolicyId)?.toLowerCase()).toBe(
      POLICY_ID,
    );
  });

  test("the server's refusal of an overlap the reader could not see is said under Ends", async () => {
    const refusal: string = `${fillTemplate(
      USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
      {
        away: "Alex Chen",
        cover: "Pat Kim",
        from: "Nov 20, 2026, 08:00 UTC",
        until: "Nov 20, 2026, 10:00 UTC",
      },
    )} ${USER_OVERRIDE_CONFLICT_WHAT_TO_DO}`;

    createOrUpdateMock.mockImplementation(async (): Promise<any> => {
      throw new HTTPErrorResponse(400, { message: refusal }, {});
    });

    await renderPage("policy");

    const modal: HTMLElement = await openAdd();

    setTime(modal, "Starts", at("2026-11-20T09:00:00.000Z"));
    setTime(modal, "Ends", at("2026-11-20T17:00:00.000Z"));

    await submit(modal, "Add User Override");

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(refusal);
    });
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    // Said under Ends, not above the form.
    expect(within(modal).getAllByText(refusal)).toHaveLength(1);
  });
});

describe("overlaps saved before the rule are marked on both rows", () => {
  // Alex skipped on the policy from noon, overlapping UPCOMING (added later).
  const SKIP_FROM_NOON: SavedOverride = {
    id: "7631a000-0000-4000-8000-0000000000f6",
    away: ALEX,
    cover: null,
    policyId: POLICY_ID,
    startsAt: at("2026-11-20T12:00:00.000Z"),
    endsAt: at("2026-11-20T20:00:00.000Z"),
    createdAt: at("2026-11-02T00:00:00.000Z"),
  };

  function markOf(tableRow: HTMLElement): HTMLElement | null {
    return within(tableRow).queryByTestId("user-override-overlaps");
  }

  test("each says what it overlaps, and which of the two is used there", async () => {
    saved = [UPCOMING, SKIP_FROM_NOON];

    await renderPage("policy");

    const coverRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");
    const skipRow: HTMLElement = await tableRowWith(
      "Alex Chen",
      USER_OVERRIDE_ROTATION_COVERS_TEXT,
    );

    await waitFor(() => {
      expect(markOf(coverRow)).not.toBeNull();
      expect(markOf(skipRow)).not.toBeNull();
    });

    // The one that names who covers is used, over the skip.
    expect(markOf(coverRow)).toHaveAttribute(
      "aria-label",
      `${fillTemplate(USER_OVERRIDE_OVERLAPS_SKIPPED, {
        away: "Alex Chen",
        from: shown(SKIP_FROM_NOON.startsAt),
        until: shown(SKIP_FROM_NOON.endsAt),
      })} Where they overlap, this one is used, as it names who covers.`,
    );
    expect(markOf(skipRow)).toHaveAttribute(
      "aria-label",
      `${fillTemplate(USER_OVERRIDE_OVERLAPS_COVERED, {
        away: "Alex Chen",
        cover: "Sam Rivera",
        from: shown(UPCOMING.startsAt),
        until: shown(UPCOMING.endsAt),
      })} Where they overlap, that one is used, as it names who covers.`,
    );

    // The row shows the word; a screen reader reads the whole of it, once.
    for (const mark of [markOf(coverRow)!, markOf(skipRow)!]) {
      expect(mark).toHaveTextContent(/^Overlaps$/);
      expect(mark).toHaveAttribute("role", "img");
      expect(mark).toHaveAttribute("tabindex", "0");
    }
  });

  test("an override of the policy over a global one is allowed, so neither is marked", async () => {
    saved = [UPCOMING, { ...SKIP_FROM_NOON, policyId: null }];

    await renderPage("policy");

    const coverRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");

    await waitFor(() => {
      expect(
        getListMock.mock.calls.some((call: Array<any>): boolean => {
          return Boolean(call[0].query?.endsAt);
        }),
      ).toBe(true);
    });
    await act(async (): Promise<void> => {});

    expect(markOf(coverRow)).toBeNull();
  });

  test("two that are back to back are not marked", async () => {
    saved = [
      UPCOMING,
      {
        ...SKIP_FROM_NOON,
        startsAt: UPCOMING.endsAt,
      },
    ];

    await renderPage("policy");

    const coverRow: HTMLElement = await tableRowWith("Alex Chen", "Sam Rivera");

    await waitFor(() => {
      expect(
        getListMock.mock.calls.some((call: Array<any>): boolean => {
          return Boolean(call[0].query?.endsAt);
        }),
      ).toBe(true);
    });
    await act(async (): Promise<void> => {});

    expect(markOf(coverRow)).toBeNull();
  });
});

describe("a schedule's active overrides card", () => {
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
        <ActiveOverridesCard rows={rows} userById={userById} timezone="UTC" />
      </MemoryRouter>,
    );
  }

  test("each row's Edit opens the override's dialog; saved, the schedule reads its overrides again", async () => {
    const notified: SpyInstance<() => void> = jest.spyOn(
      ScheduleOverrides,
      "notifyScheduleUserOverridesChanged",
    );

    saved = [IN_FORCE];
    renderCard([IN_FORCE]);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit the override for Alex Chen" }),
    );

    const modal: HTMLElement = await openDialog("Edit User Override");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(timeInput(modal, "Starts")).toHaveAttribute("readonly");

    setTime(modal, "Ends", at("2026-11-13T18:00:00.000Z"));
    await submit(modal, "Save Changes");

    expect(OneUptimeDate.fromString(sentOverride().endsAt!).toISOString()).toBe(
      "2026-11-13T18:00:00.000Z",
    );

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(notified).toHaveBeenCalledTimes(1);
  });

  test("a global override's Edit is locked for a reader limited to a label; the policy's is not", async () => {
    holding([
      row(Permission.OnCallMember, {
        scope: PermissionScope.Labels,
        labelIds: [TEAM_A_LABEL],
      }),
      row(Permission.Viewer),
    ]);

    renderCard([
      IN_FORCE,
      {
        ...UPCOMING,
        id: "7631a000-0000-4000-8000-0000000000f7",
        away: PAT,
        policyId: null,
      },
    ]);

    expect(
      screen.getByRole("button", { name: "Edit the override for Alex Chen" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    await expectLockedSaying(
      screen.getByRole("button", { name: "Edit the override for Pat Kim" }),
      GLOBAL_USER_OVERRIDE_EDIT_REFUSAL,
    );
  });

  test("two overlapping rows say Overlaps, each naming the other's times as the card writes times", async () => {
    const skip: SavedOverride = {
      ...UPCOMING,
      id: "7631a000-0000-4000-8000-0000000000f8",
      cover: null,
      startsAt: at("2026-11-20T12:00:00.000Z"),
      endsAt: at("2026-11-20T20:00:00.000Z"),
      createdAt: at("2026-11-02T00:00:00.000Z"),
    };

    renderCard([UPCOMING, skip]);

    const marks: Array<HTMLElement> = screen.getAllByTestId(
      "user-override-overlaps",
    );

    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveAttribute(
      "aria-label",
      `${fillTemplate(USER_OVERRIDE_OVERLAPS_SKIPPED, {
        away: "Alex Chen",
        from: formatHandOffInstant(skip.startsAt, "UTC", NOW),
        until: formatHandOffInstant(skip.endsAt, "UTC", NOW),
      })} Where they overlap, this one is used, as it names who covers.`,
    );
    expect(marks[1]).toHaveAttribute(
      "aria-label",
      `${fillTemplate(USER_OVERRIDE_OVERLAPS_COVERED, {
        away: "Alex Chen",
        cover: "Sam Rivera",
        from: formatHandOffInstant(UPCOMING.startsAt, "UTC", NOW),
        until: formatHandOffInstant(UPCOMING.endsAt, "UTC", NOW),
      })} Where they overlap, that one is used, as it names who covers.`,
    );
  });

  test("a row read without an id has no Edit", () => {
    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        {
          overrideUserId: ALEX,
          routeAlertsToUserId: SAM,
          onCallDutyPolicyId: POLICY_ID,
          startsAt: IN_FORCE.startsAt,
          endsAt: IN_FORCE.endsAt,
        },
      ],
      userInfoById: userById,
      policyNameById: { [POLICY_ID]: "Primary On-Call" },
      now: NOW,
    });

    render(
      <MemoryRouter>
        <ActiveOverridesCard rows={rows} userById={userById} timezone="UTC" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("active-override-row")).toBeInTheDocument();
    expect(screen.queryByTestId("active-override-edit")).toBeNull();
  });
});
