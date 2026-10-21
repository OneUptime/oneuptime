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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A shared calendar link's settings, edited from its card: one page, as the
 * personal link's are. It was three steps - Coverage Gaps, Time Range, and
 * Security for its one switch - so changing one setting meant finding its
 * step first. The minimum gap shows only while coverage gaps are shown.
 *
 * The real card, CardModelDetail, edit dialog and form are rendered; only
 * the network (the feed's status and the model API), the signed-in user and
 * the translations are stand-ins.
 */

jest.setTimeout(60000);

const WAIT_FOR_TIMEOUT: number = 20000;

const getMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return getMock(...args);
      },
      post: async (): Promise<unknown> => {
        return undefined;
      },
      getFriendlyMessage: (): string => {
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
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

// An editor of the schedule: a master admin may edit everything.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
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

import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { buildGoogleAddUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const FEED_ID: string = "55555555-5555-4555-8555-555555555555";
const SCHEDULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-08-31T12:00:00.000Z");

const HTTPS_URL: string = `https://oneuptime.example.com/api/on-call-calendar/schedule/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/schedule.ics`;

// The link's settings as the server holds them: its defaults.
let storedSettings: JSONObject = {};

function publishedJson(): JSONObject {
  return {
    exists: true,
    feedId: FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "t34m",
    rotatedAt: "2026-08-01T12:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: storedSettings,
    urls: {
      https: HTTPS_URL,
      webcal: HTTPS_URL.replace("https:", "webcals:"),
      googleAdd: buildGoogleAddUrl(HTTPS_URL),
    },
    hostWarning: null,
    protocolWarning: null,
  };
}

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

interface SaveCall {
  model: BaseModel;
  modelType: { new (): BaseModel };
  formType: FormType;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openSettingsDialog(): Promise<HTMLElement> {
  render(
    <SharedCalendarFeedCard
      kind={SharedCalendarFeedKind.Schedule}
      scheduleId={SCHEDULE_ID}
      scheduleTimezone="Europe/Stockholm"
      now={NOW}
    />,
  );

  await waitFor(
    () => {
      expect(
        screen.getByRole("button", { name: "Edit settings" }),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  fireEvent.click(screen.getByRole("button", { name: "Edit settings" }));

  await waitFor(
    () => {
      expect(
        within(screen.getByTestId("modal")).getByText("Days ahead"),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  await settle();

  return screen.getByTestId("modal");
}

function coverageGapsSwitch(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("switch", { name: "Show coverage gaps" });
}

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/on-call-duty/schedules/${SCHEDULE_ID.toString()}`,
  );

  storedSettings = {
    includeCoverageGaps: false,
    minimumGapMinutes: 60,
    pastDays: 2,
    futureDays: 90,
    rotateWhenMemberLeaves: false,
  };

  getMock.mockReset();
  getMock.mockImplementation(async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(200, publishedJson(), {});
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (options: unknown): Promise<unknown> => {
    const call: ItemCall = options as ItemCall;
    const item: BaseModel = new call.modelType();

    (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
    Object.assign(item, storedSettings);

    return item;
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as SaveCall).model };
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("a shared calendar link's settings dialog", () => {
  test("is one page: no steps, every setting in the order the card lists them", async () => {
    const dialog: HTMLElement = await openSettingsDialog();

    expect(
      within(dialog).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(dialog).queryByTestId("modal-footer-next-button")).toBeNull();
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");

    const titles: Array<string> = [
      "Show coverage gaps",
      "Days of past shifts",
      "Days ahead",
      "Regenerate when someone leaves the project",
    ];

    for (const title of titles) {
      expect(within(dialog).getByText(title)).toBeVisible();
    }

    // In that order on the page.
    const text: string = dialog.textContent || "";
    const positions: Array<number> = titles.map((title: string): number => {
      return text.indexOf(title);
    });

    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
  });

  test("shows the minimum gap only once coverage gaps are switched on", async () => {
    const dialog: HTMLElement = await openSettingsDialog();

    expect(coverageGapsSwitch(dialog)).toHaveAttribute("aria-checked", "false");
    expect(
      within(dialog).queryByText("Minimum gap to show (minutes)"),
    ).toBeNull();

    fireEvent.click(coverageGapsSwitch(dialog));
    await settle();

    expect(coverageGapsSwitch(dialog)).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog).getByText("Minimum gap to show (minutes)"),
    ).toBeVisible();
    // Right below the switch it belongs to.
    const text: string = dialog.textContent || "";

    expect(text.indexOf("Minimum gap to show (minutes)")).toBeGreaterThan(
      text.indexOf("Show coverage gaps"),
    );
    expect(text.indexOf("Minimum gap to show (minutes)")).toBeLessThan(
      text.indexOf("Days of past shifts"),
    );
  });

  test("a link that shows gaps opens with its minimum gap in view", async () => {
    storedSettings["includeCoverageGaps"] = true;
    storedSettings["minimumGapMinutes"] = 30;

    const dialog: HTMLElement = await openSettingsDialog();

    expect(coverageGapsSwitch(dialog)).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog).getByText("Minimum gap to show (minutes)"),
    ).toBeVisible();
    expect(within(dialog).getByDisplayValue("30")).toBeVisible();
  });

  test("saves a change from its one page", async () => {
    const dialog: HTMLElement = await openSettingsDialog();

    fireEvent.click(coverageGapsSwitch(dialog));
    await settle();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const request: SaveCall = createOrUpdateMock.mock.calls[0]![0] as SaveCall;

    expect(request.formType).toBe(FormType.Update);
    expect(request.modelType).toBe(OnCallDutyPolicyScheduleCalendarFeed);

    const saved: Record<string, unknown> = request.model as unknown as Record<
      string,
      unknown
    >;

    expect(saved["includeCoverageGaps"]).toBe(true);
    expect(Number(saved["minimumGapMinutes"])).toBe(60);
    expect(Number(saved["futureDays"])).toBe(90);
  });
});
