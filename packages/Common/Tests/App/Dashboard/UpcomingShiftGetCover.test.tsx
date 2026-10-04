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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "GET COVER" ON AN UPCOMING SHIFT OPENS ADD USER OVERRIDE FOR THAT SHIFT.
 *
 * User Settings > Calendar Feed lists your shifts for the next 30 days, each
 * with a "Get cover" link. It used to open the project's User Overrides page
 * and leave the rest to you - the docs said "pre-filled for that shift", and
 * it was not. Now it opens Add User Override with you away for the shift's
 * window (UserOverrideCoverRequest), in the shift's own project:
 *
 *   - a shift that has started is covered from now;
 *   - a shift that exists only inside one policy (a policy-scoped override
 *     made it) is covered on that policy's User Overrides page, so the cover
 *     applies to it;
 *   - a shift that has ended, or one you are covering for someone else,
 *     offers no "Get cover": overrides do not chain, so cover for cover
 *     would change nothing (as on mobile).
 */

const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
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

import UpcomingShiftsCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import { getCoverWindowForShift } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import {
  USER_OVERRIDE_COVER_ENDS_AT_PARAM,
  USER_OVERRIDE_COVER_STARTS_AT_PARAM,
  UserOverrideCoverWindow,
} from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";

const CURRENT_PROJECT: string = "0d500000-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "0d500000-0000-4000-8000-000000000002";
const POLICY: string = "0d500000-0000-4000-8000-000000000003";
const ME: string = "0d500000-0000-4000-8000-0000000000a1";

const NOW: Date = new Date("2026-09-01T10:00:00.000Z");

function shift(
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson {
  return {
    contentHash: "hash",
    projectId: CURRENT_PROJECT,
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: "UTC",
    userId: ME,
    userName: "Jane",
    start: "2026-09-01T12:00:00.000Z",
    end: "2026-09-01T20:00:00.000Z",
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-08-30T00:00:00.000Z",
    shiftConfigVersion: 1,
    ...overrides,
  };
}

function serve(shifts: Array<MaterializedShiftJson>): void {
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        shifts: shifts as unknown as JSONArray,
        truncated: false,
        generatedAt: NOW.toISOString(),
      },
      {},
    ),
  );
}

async function renderCard(
  shifts: Array<MaterializedShiftJson>,
): Promise<Array<HTMLElement>> {
  serve(shifts);

  render(<UpcomingShiftsCard now={NOW} />);

  await waitFor(() => {
    expect(screen.getAllByTestId("upcoming-shift-row")).toHaveLength(
      shifts.length,
    );
  });

  return screen.getAllByTestId("upcoming-shift-row");
}

function coverHref(row: HTMLElement): string | null {
  const link: HTMLElement | null = within(row).queryByText("Get cover");

  return link ? link.closest("a")!.getAttribute("href") : null;
}

// The page and the window a "Get cover" address asks for.
function readHref(href: string): {
  path: string;
  startsAt: string | null;
  endsAt: string | null;
} {
  const [path, query] = href.split("?") as [string, string | undefined];
  const params: URLSearchParams = new URLSearchParams(query || "");

  return {
    path: path,
    startsAt: params.get(USER_OVERRIDE_COVER_STARTS_AT_PARAM),
    endsAt: params.get(USER_OVERRIDE_COVER_ENDS_AT_PARAM),
  };
}

beforeEach(() => {
  getMock.mockReset();
  window.history.pushState(
    {},
    "",
    `/dashboard/${CURRENT_PROJECT}/user-settings/calendar-feed`,
  );
});

afterEach(() => {
  cleanup();
});

describe("the window 'Get cover' asks for", () => {
  test("is the shift, for one of your own still to come", () => {
    const window: UserOverrideCoverWindow | null = getCoverWindowForShift(
      shift({ shiftKey: "own" }),
      NOW,
    );

    expect(window?.startsAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(window?.endsAt.toISOString()).toBe("2026-09-01T20:00:00.000Z");
  });

  test("starts now for one that has started", () => {
    expect(
      getCoverWindowForShift(
        shift({ shiftKey: "running", start: "2026-09-01T08:00:00.000Z" }),
        NOW,
      )?.startsAt.toISOString(),
    ).toBe(NOW.toISOString());
  });

  test("is nothing for one that has ended", () => {
    expect(
      getCoverWindowForShift(
        shift({
          shiftKey: "ended",
          start: "2026-09-01T00:00:00.000Z",
          end: "2026-09-01T08:00:00.000Z",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  test("is nothing for one you are covering for someone else", () => {
    expect(
      getCoverWindowForShift(
        shift({
          shiftKey: "covering",
          override: {
            originalUserId: "someone-else",
            originalUserName: "Bob",
            overrideStartsAt: "2026-09-01T12:00:00.000Z",
            overrideEndsAt: "2026-09-01T20:00:00.000Z",
          },
        }),
        NOW,
      ),
    ).toBeNull();
  });

  test("is nothing for a shift without a project", () => {
    expect(
      getCoverWindowForShift(shift({ shiftKey: "orphan", projectId: "" }), NOW),
    ).toBeNull();
  });
});

describe("the Upcoming shifts card's 'Get cover'", () => {
  test("opens Add User Override for the shift, on its project's overrides page", async () => {
    const [row] = (await renderCard([shift({ shiftKey: "own" })])) as [
      HTMLElement,
    ];

    const target: {
      path: string;
      startsAt: string | null;
      endsAt: string | null;
    } = readHref(coverHref(row)!);

    expect(target.path).toBe(
      `/dashboard/${CURRENT_PROJECT}/on-call-duty/user-overrides`,
    );
    expect(target.startsAt).toBe("2026-09-01T12:00:00.000Z");
    expect(target.endsAt).toBe("2026-09-01T20:00:00.000Z");
  });

  test("covers a running shift from now", async () => {
    const [row] = (await renderCard([
      shift({ shiftKey: "running", start: "2026-09-01T08:00:00.000Z" }),
    ])) as [HTMLElement];

    expect(readHref(coverHref(row)!).startsAt).toBe(NOW.toISOString());
  });

  test("goes to the shift's own project, not the one the page is in", async () => {
    const [row] = (await renderCard([
      shift({
        shiftKey: "elsewhere",
        projectId: OTHER_PROJECT,
        projectName: "Payments",
      }),
    ])) as [HTMLElement];

    expect(readHref(coverHref(row)!).path).toBe(
      `/dashboard/${OTHER_PROJECT}/on-call-duty/user-overrides`,
    );
  });

  test("covers a shift that exists only inside one policy on that policy's page", async () => {
    const [row] = (await renderCard([
      shift({
        shiftKey: "variant",
        policyVariantOf: {
          policyId: POLICY,
          policyName: "Checkout",
          globalUserId: "someone-else",
        },
      }),
    ])) as [HTMLElement];

    expect(readHref(coverHref(row)!).path).toBe(
      `/dashboard/${CURRENT_PROJECT}/on-call-duty/policies/${POLICY}/user-overrides`,
    );
  });

  test("is not offered on a shift you are covering for someone else", async () => {
    const [own, covering] = (await renderCard([
      shift({ shiftKey: "own" }),
      shift({
        shiftKey: "covering",
        start: "2026-09-01T20:00:00.000Z",
        end: "2026-09-02T04:00:00.000Z",
        override: {
          originalUserId: "someone-else",
          originalUserName: "Bob",
          overrideStartsAt: "2026-09-01T20:00:00.000Z",
          overrideEndsAt: "2026-09-02T04:00:00.000Z",
        },
      }),
    ])) as [HTMLElement, HTMLElement];

    expect(coverHref(own)).not.toBeNull();
    expect(covering).toHaveTextContent("Covering for Bob");
    expect(coverHref(covering)).toBeNull();
  });
});
