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
 * "SKIP UNTIL..." SAYS AN OVERLAP AS THE TIMES ARE PICKED (issue #7898).
 *
 * The Skip dialog on a schedule's Layers page adds the same kind of
 * override as Add User Override - the person away, nobody covering - but
 * said an overlap with another override of the same person only after
 * Save, with the server's sentence under Ends and no way to open the other
 * one. Now, as Add User Override does, with only the network stubbed:
 *
 *   - another override of the person in the same scope - global, or on the
 *     policy the skip is added on - is said under Ends as soon as the times
 *     are picked, with Edit that override, and the form sends nothing;
 *   - back to back is no overlap, and the skip is saved;
 *   - an override of the person on one policy, under a global skip, is
 *     allowed and said plainly;
 *   - Edit that override hands the page that override, for its Edit;
 *   - added on several policies, each ticked one is asked about, a
 *     conflict names the policy it is on, and unticking it lets the skip
 *     through on the others.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectAdmin"] };
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
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "7898a000-0000-4000-8000-0000000000b1";
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
const createOrUpdateMock: MockFunction = getJestMockFunction();

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
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      create: async (data: any): Promise<any> => {
        return { data: data.model };
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
            return "7898a000-0000-4000-8000-000000000001";
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

import SkipLayerUserModal from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal";
import { formatHandOffInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import { UserOverrideEditTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideFormModal";
import { UserOverridePolicy } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverridePolicies";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY,
  USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY,
  USER_OVERRIDE_CONFLICT_WHAT_TO_DO,
  USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideOverlap";
import Timezone from "../../../Types/Timezone";
import { fillTemplate } from "../../../Types/Translator";

jest.setTimeout(30000);

const PROJECT_ID: string = "7898a000-0000-4000-8000-000000000001";
const PAYMENTS: string = "7898a000-0000-4000-8000-0000000000d1";
const CHECKOUT: string = "7898a000-0000-4000-8000-0000000000d2";

const ALEX: string = "7898a000-0000-4000-8000-0000000000a1";
const SAM: string = "7898a000-0000-4000-8000-0000000000b1";
const PAT: string = "7898a000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [SAM]: { name: "Sam Rivera", email: "sam@example.com" },
  [PAT]: { name: "Pat Kim", email: "pat@example.com" },
};

const POLICY_NAMES: Record<string, string> = {
  [PAYMENTS]: "Payments",
  [CHECKOUT]: "Checkout",
};

// The dialog opens at 12:34 on 3 March 2026, UTC: the skip starts then.
const NOW: Date = OneUptimeDate.fromString("2026-03-03T12:34:00.000Z");
const BACK_ON: Date = OneUptimeDate.fromString("2026-03-10T09:00:00.000Z");

interface SavedOverride {
  id: string;
  away: string;
  cover: string | null;
  policyId: string | null;
  startsAt: Date;
  endsAt: Date;
}

let saved: Array<SavedOverride> = [];
let onEditOverride: MockFunction = getJestMockFunction();

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
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
    policy.name = POLICY_NAMES[override.policyId]!;
    model.onCallDutyPolicy = policy;
  }

  model.startsAt = override.startsAt;
  model.endsAt = override.endsAt;
  model.createdAt = OneUptimeDate.fromString("2026-02-01T00:00:00.000Z");
  return model;
}

beforeEach(() => {
  saved = [];
  onEditOverride = getJestMockFunction();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    // The overlap check: the person's overrides, in every scope.
    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(
        saved
          .filter((override: SavedOverride): boolean => {
            return (
              String(query["overrideUserId"] || "").toLowerCase() ===
              override.away.toLowerCase()
            );
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

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

async function renderSkip(
  policies?: Array<UserOverridePolicy> | undefined,
): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <SkipLayerUserModal
        userId={ALEX}
        name="Alex Chen"
        policies={policies}
        onClose={() => {}}
        onSkipped={() => {}}
        onEditOverride={(target: UserOverrideEditTarget) => {
          onEditOverride(target);
        }}
      />
    </MemoryRouter>,
  );

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByText("Who covers?");

  await waitFor(() => {
    expect(timeInput(modal, "Starts").value).not.toBe("");
    expect(
      within(modal)
        .getByRole("group", { name: "Who is away?" })
        .querySelector('[data-testid="people-chip"]')
        ?.getAttribute("data-id"),
    ).toBe(ALEX);
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

function setEnds(modal: HTMLElement, value: Date): void {
  fireEvent.change(timeInput(modal, "Ends"), {
    target: { value: OneUptimeDate.toDateTimeLocalString(value) },
  });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", {
        name: "Skip Alex Chen",
        exact: true,
      }),
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

// The overlap checks asked so far.
function overlapChecks(): number {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    return (
      call[0].modelType === OnCallDutyPolicyUserOverride &&
      Boolean(call[0].query?.overrideUserId)
    );
  }).length;
}

function shown(date: Date): string {
  return formatHandOffInstant(date, undefined, NOW);
}

// Alex away on every policy from tomorrow to the day after, the rotation covering.
const GLOBAL_SKIP: SavedOverride = {
  id: "7898a000-0000-4000-8000-0000000000f1",
  away: ALEX,
  cover: null,
  policyId: null,
  startsAt: OneUptimeDate.fromString("2026-03-04T09:00:00.000Z"),
  endsAt: OneUptimeDate.fromString("2026-03-05T09:00:00.000Z"),
};

// Alex covered by Pat on Checkout, the same days.
const ON_CHECKOUT: SavedOverride = {
  id: "7898a000-0000-4000-8000-0000000000f2",
  away: ALEX,
  cover: PAT,
  policyId: CHECKOUT,
  startsAt: OneUptimeDate.fromString("2026-03-04T09:00:00.000Z"),
  endsAt: OneUptimeDate.fromString("2026-03-05T09:00:00.000Z"),
};

describe("Skip until... says an overlap as the times are picked", () => {
  test("another global override of the person: said under Ends with Edit that override, and the skip sends nothing", async () => {
    saved = [GLOBAL_SKIP];

    const modal: HTMLElement = await renderSkip();

    setEnds(modal, BACK_ON);

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    expect(conflict).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_CONFLICT_SKIPPED_GLOBALLY, {
        away: "Alex Chen",
        from: shown(GLOBAL_SKIP.startsAt),
        until: shown(GLOBAL_SKIP.endsAt),
      }),
    );
    expect(
      within(conflict).getByRole("button", { name: "Edit that override" }),
    ).toBeInTheDocument();
    // Added on one scope, no policy is named before the sentence.
    expect(
      within(conflict).queryByTestId("user-override-overlap-conflict-policy"),
    ).toBeNull();

    await submit(modal);

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(USER_OVERRIDE_CONFLICT_WHAT_TO_DO);
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("back to back is no overlap: nothing is said, and the skip is saved", async () => {
    saved = [GLOBAL_SKIP];

    const modal: HTMLElement = await renderSkip();
    const checksBefore: number = overlapChecks();

    // Back as the other one starts.
    setEnds(modal, GLOBAL_SKIP.startsAt);

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

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = (
      createOrUpdateMock.mock.calls[0]![0] as any
    ).model;

    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      GLOBAL_SKIP.startsAt.toISOString(),
    );
    expect(sent.onCallDutyPolicyId).toBeFalsy();
  });

  test("the person's override on one policy, under a global skip, is allowed and said plainly", async () => {
    saved = [ON_CHECKOUT];

    const modal: HTMLElement = await renderSkip();

    setEnds(modal, BACK_ON);

    const note: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-note",
      {},
      { timeout: 3000 },
    );

    expect(note).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_NOTE_POLICY_OVER_GLOBAL, {
        away: "Alex Chen",
        policy: "Checkout",
        from: shown(ON_CHECKOUT.startsAt),
        until: shown(ON_CHECKOUT.endsAt),
      }),
    );
    expect(
      within(modal).queryByTestId("user-override-overlap-conflict"),
    ).toBeNull();

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
  });

  test("Edit that override hands the page that override, to open in the dialog's place", async () => {
    saved = [GLOBAL_SKIP];

    const modal: HTMLElement = await renderSkip();

    setEnds(modal, BACK_ON);

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    fireEvent.click(
      within(conflict).getByRole("button", { name: "Edit that override" }),
    );

    expect(onEditOverride).toHaveBeenCalledTimes(1);

    const target: UserOverrideEditTarget = onEditOverride.mock
      .calls[0]![0] as UserOverrideEditTarget;

    expect(target.id).toBe(GLOBAL_SKIP.id);
    expect(target.onCallDutyPolicyId).toBeNull();
    expect(target.startsAt.toISOString()).toBe(
      GLOBAL_SKIP.startsAt.toISOString(),
    );
    expect(target.endsAt.toISOString()).toBe(GLOBAL_SKIP.endsAt.toISOString());
    expect(target.awayName).toBe("Alex Chen");
    expect(target.coverName).toBeNull();
  });

  test("added on the one policy a reader may cover: an override of the person on it conflicts", async () => {
    saved = [{ ...ON_CHECKOUT }];

    const modal: HTMLElement = await renderSkip([
      { id: CHECKOUT, name: "Checkout" },
    ]);

    setEnds(modal, BACK_ON);

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    expect(conflict).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY, {
        away: "Alex Chen",
        cover: "Pat Kim",
        from: shown(ON_CHECKOUT.startsAt),
        until: shown(ON_CHECKOUT.endsAt),
      }),
    );

    await submit(modal);

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(USER_OVERRIDE_CONFLICT_WHAT_TO_DO);
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("added on several policies: a conflict names its policy, and unticking it lets the skip through on the others", async () => {
    saved = [{ ...ON_CHECKOUT }];

    const modal: HTMLElement = await renderSkip([
      { id: PAYMENTS, name: "Payments" },
      { id: CHECKOUT, name: "Checkout" },
    ]);

    setEnds(modal, BACK_ON);

    const conflict: HTMLElement = await within(modal).findByTestId(
      "user-override-overlap-conflict",
      {},
      { timeout: 3000 },
    );

    expect(
      within(conflict).getByTestId("user-override-overlap-conflict-policy"),
    ).toHaveTextContent("Checkout:");
    expect(conflict).toHaveTextContent(
      fillTemplate(USER_OVERRIDE_CONFLICT_COVERED_ON_POLICY, {
        away: "Alex Chen",
        cover: "Pat Kim",
        from: shown(ON_CHECKOUT.startsAt),
        until: shown(ON_CHECKOUT.endsAt),
      }),
    );

    await submit(modal);

    await waitFor(() => {
      expect(errorUnder(modal, "Ends")).toBe(USER_OVERRIDE_CONFLICT_WHAT_TO_DO);
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    // Checkout unticked: the skip goes on Payments alone.
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("checkbox", { name: "Checkout" }),
      );
    });

    await waitFor(
      () => {
        expect(
          within(modal).queryByTestId("user-override-overlap-conflict"),
        ).toBeNull();
      },
      { timeout: 3000 },
    );

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = (
      createOrUpdateMock.mock.calls[0]![0] as any
    ).model;

    expect(String(sent.onCallDutyPolicyId).toLowerCase()).toBe(PAYMENTS);
  });
});
