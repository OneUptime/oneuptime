/** @timezone UTC */
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
 * row with a "Get cover" link that opens Add User Override with you away for
 * the row's window (UserOverrideCoverRequest), in the row's own project:
 *
 *   - a row joins back-to-back turns into one stretch, and Get cover covers
 *     the stretch the row shows - Add User Override opens with it filled in
 *     and can be shortened there before saving;
 *   - a stretch that has started is covered from now;
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
import {
  UpcomingShiftSpan,
  buildUpcomingShiftSpans,
  getCoverWindowForSpan,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftSpans";
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
const SOMEONE_ELSE: string = "0d500000-0000-4000-8000-0000000000b2";

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
  expectedRows: number,
): Promise<Array<HTMLElement>> {
  serve(shifts);

  render(<UpcomingShiftsCard now={NOW} />);

  await waitFor(() => {
    expect(screen.getAllByTestId("upcoming-shift-row")).toHaveLength(
      expectedRows,
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

function coverFor(
  shifts: Array<MaterializedShiftJson>,
): UserOverrideCoverWindow | null {
  const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(shifts, NOW);

  return getCoverWindowForSpan(spans[0]!, NOW);
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
    const window: UserOverrideCoverWindow | null = coverFor([
      shift({ shiftKey: "own" }),
    ]);

    expect(window?.startsAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(window?.endsAt.toISOString()).toBe("2026-09-01T20:00:00.000Z");
  });

  test("is the whole stretch, for back-to-back turns read as one", () => {
    const window: UserOverrideCoverWindow | null = coverFor([
      shift({
        shiftKey: "first",
        start: "2026-09-02T09:00:00.000Z",
        end: "2026-09-03T09:00:00.000Z",
      }),
      shift({
        shiftKey: "second",
        start: "2026-09-03T09:00:00.000Z",
        end: "2026-09-04T09:00:00.000Z",
      }),
    ]);

    expect(window?.startsAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(window?.endsAt.toISOString()).toBe("2026-09-04T09:00:00.000Z");
  });

  test("starts now for one that has started", () => {
    expect(
      coverFor([
        shift({ shiftKey: "running", start: "2026-09-01T08:00:00.000Z" }),
      ])?.startsAt.toISOString(),
    ).toBe(NOW.toISOString());
  });

  test("is nothing for one that has ended by the time it is asked", () => {
    const span: UpcomingShiftSpan = buildUpcomingShiftSpans(
      [shift({ shiftKey: "today" })],
      NOW,
    )[0]!;

    expect(
      getCoverWindowForSpan(span, new Date("2026-09-01T21:00:00.000Z")),
    ).toBeNull();
  });

  test("is nothing for one you are covering for someone else", () => {
    expect(
      coverFor([
        shift({
          shiftKey: "covering",
          override: {
            originalUserId: SOMEONE_ELSE,
            originalUserName: "Bob",
            overrideStartsAt: "2026-09-01T12:00:00.000Z",
            overrideEndsAt: "2026-09-01T20:00:00.000Z",
          },
        }),
      ]),
    ).toBeNull();
  });

  test("is nothing for a shift without a project", () => {
    expect(coverFor([shift({ shiftKey: "orphan", projectId: "" })])).toBeNull();
  });
});

describe("the Upcoming shifts card's 'Get cover'", () => {
  test("opens Add User Override for the shift, on its project's overrides page", async () => {
    const [row] = (await renderCard([shift({ shiftKey: "own" })], 1)) as [
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

  test("covers a joined row's whole stretch: what the row shows", async () => {
    const [row] = (await renderCard(
      [
        shift({
          shiftKey: "day-1",
          start: "2026-09-02T09:00:00.000Z",
          end: "2026-09-03T09:00:00.000Z",
        }),
        shift({
          shiftKey: "day-2",
          start: "2026-09-03T09:00:00.000Z",
          end: "2026-09-04T09:00:00.000Z",
        }),
        shift({
          shiftKey: "day-3",
          start: "2026-09-04T09:00:00.000Z",
          end: "2026-09-05T09:00:00.000Z",
        }),
      ],
      1,
    )) as [HTMLElement];

    expect(within(row).getAllByText("Get cover")).toHaveLength(1);
    expect(readHref(coverHref(row)!)).toEqual({
      path: `/dashboard/${CURRENT_PROJECT}/on-call-duty/user-overrides`,
      startsAt: "2026-09-02T09:00:00.000Z",
      endsAt: "2026-09-05T09:00:00.000Z",
    });
  });

  test("covers a running shift from now", async () => {
    const [row] = (await renderCard(
      [shift({ shiftKey: "running", start: "2026-09-01T08:00:00.000Z" })],
      1,
    )) as [HTMLElement];

    expect(readHref(coverHref(row)!).startsAt).toBe(NOW.toISOString());
  });

  test("goes to the shift's own project, not the one the page is in", async () => {
    const [row] = (await renderCard(
      [
        shift({
          shiftKey: "elsewhere",
          projectId: OTHER_PROJECT,
          projectName: "Payments",
        }),
      ],
      1,
    )) as [HTMLElement];

    expect(readHref(coverHref(row)!).path).toBe(
      `/dashboard/${OTHER_PROJECT}/on-call-duty/user-overrides`,
    );
  });

  test("covers a shift that exists only inside one policy on that policy's page", async () => {
    const [row] = (await renderCard(
      [
        shift({
          shiftKey: "variant",
          policyVariantOf: {
            policyId: POLICY,
            policyName: "Checkout",
            globalUserId: SOMEONE_ELSE,
          },
        }),
      ],
      1,
    )) as [HTMLElement];

    expect(readHref(coverHref(row)!).path).toBe(
      `/dashboard/${CURRENT_PROJECT}/on-call-duty/policies/${POLICY}/user-overrides`,
    );
  });

  test("is not offered on a shift you are covering for someone else, even right after your own", async () => {
    const [own, covering] = (await renderCard(
      [
        shift({ shiftKey: "own" }),
        shift({
          shiftKey: "covering",
          start: "2026-09-01T20:00:00.000Z",
          end: "2026-09-02T04:00:00.000Z",
          override: {
            originalUserId: SOMEONE_ELSE,
            originalUserName: "Bob",
            overrideStartsAt: "2026-09-01T20:00:00.000Z",
            overrideEndsAt: "2026-09-02T04:00:00.000Z",
          },
        }),
      ],
      2,
    )) as [HTMLElement, HTMLElement];

    expect(coverHref(own)).not.toBeNull();
    expect(readHref(coverHref(own)!).endsAt).toBe("2026-09-01T20:00:00.000Z");
    expect(covering).toHaveTextContent("Covering for Bob");
    expect(coverHref(covering)).toBeNull();
  });
});
