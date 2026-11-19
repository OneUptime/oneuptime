import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

/*
 * useScheduledMaintenanceReach (#9920): what the server says of the status
 * pages picked on a maintenance event's or a maintenance template's form,
 * for their Subscriber Notifications line and the notes under their boxes.
 * It asks as every form that picks its status pages asks
 * (PickedStatusPagesReachAsker, whose keeping and sharing
 * AnnouncementReachHook.test.tsx pins) - each kind of form through its own
 * API, with the record an Edit edits under that API's key, and an event's
 * answer never handed to a template's question.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import useScheduledMaintenanceReach, {
  ScheduledMaintenanceReachState,
  fetchScheduledMaintenanceReach,
  getKeptScheduledMaintenanceReach,
  getScheduledMaintenanceReachKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/useScheduledMaintenanceReach";
import {
  MaintenanceReachQuestion,
  MaintenanceReachRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceReach";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import PickedStatusPagesReach from "../../../Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import {
  MAINTENANCE_NOTIFIES,
  SCHEDULED_MAINTENANCE_REACH_ROUTE,
  SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE,
  ScheduledMaintenanceReachAnswer,
  ScheduledMaintenanceReachAsk,
  answerScheduledMaintenanceReach,
  maintenanceNothingSent,
} from "./ScheduledMaintenanceReachAnswers";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const TEMPLATE: string = "e0000000-0000-4000-8000-000000000001";

let answer: ScheduledMaintenanceReachAnswer = MAINTENANCE_NOTIFIES;
let asks: Array<ScheduledMaintenanceReachAsk> = [];

function question(
  record: MaintenanceReachRecord,
  statusPageIds: Array<string>,
  recordId: string | null = null,
): MaintenanceReachQuestion {
  return { record: record, statusPageIds: statusPageIds, recordId: recordId };
}

beforeEach(() => {
  answer = MAINTENANCE_NOTIFIES;
  asks = answerScheduledMaintenanceReach(
    (): ScheduledMaintenanceReachAnswer => {
      return answer;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("asking the server", () => {
  test("an event's pages go to the maintenance API's route, with the project's header", async () => {
    await fetchScheduledMaintenanceReach(
      question(MaintenanceReachRecord.Event, [SITE_1, SITE_2]),
    );

    expect(asks).toEqual([
      {
        route: SCHEDULED_MAINTENANCE_REACH_ROUTE,
        statusPageIds: [SITE_1, SITE_2],
        recordId: null,
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
    expect(SCHEDULED_MAINTENANCE_REACH_ROUTE).toBe(
      `/scheduled-maintenance${PickedStatusPagesReach.routePath}`,
    );
  });

  test("a template's go to the template API's route, naming the template an Edit edits", async () => {
    await fetchScheduledMaintenanceReach(
      question(MaintenanceReachRecord.Template, [SITE_1], TEMPLATE),
    );

    expect(asks[0]!.route).toBe(SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE);
    expect(asks[0]!.recordId).toBe(TEMPLATE);
    expect(SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE).toBe(
      `/scheduled-maintenance-template${PickedStatusPagesReach.routePath}`,
    );
  });

  test("reads the answer, and refuses one it cannot read or a refusal", async () => {
    answer = maintenanceNothingSent(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    await expect(
      fetchScheduledMaintenanceReach(
        question(MaintenanceReachRecord.Event, [SITE_1]),
      ),
    ).resolves.toEqual({
      nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
    });

    answer = new HTTPErrorResponse(403, { message: "No." }, {});

    await expect(
      fetchScheduledMaintenanceReach(
        question(MaintenanceReachRecord.Event, [SITE_1]),
      ),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("the question's key", () => {
  test("the pages in any order, each once; an event's apart from a template's, and an Edit's from a Create's", () => {
    expect(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Event, [SITE_2, SITE_1, SITE_2]),
      ),
    ).toBe(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Event, [SITE_1.toUpperCase(), SITE_2]),
      ),
    );
    expect(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Event, [SITE_1]),
      ),
    ).not.toBe(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Template, [SITE_1]),
      ),
    );
    expect(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Template, [SITE_1], TEMPLATE),
      ),
    ).not.toBe(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Template, [SITE_1]),
      ),
    );
  });

  test("nothing to ask: no key", () => {
    expect(
      getScheduledMaintenanceReachKey(
        question(MaintenanceReachRecord.Event, []),
      ),
    ).toBe("");
    expect(getScheduledMaintenanceReachKey(null)).toBe("");
  });
});

describe("the hook", () => {
  test("asks once, keeps the answer for the sentences beside the line, and says nothing while there is no page", async () => {
    const asked: MaintenanceReachQuestion = question(
      MaintenanceReachRecord.Event,
      [SITE_1],
    );

    const first: { result: { current: ScheduledMaintenanceReachState } } =
      renderHook(() => {
        return useScheduledMaintenanceReach(asked);
      });

    expect(first.result.current.isLoading).toBe(true);
    expect(first.result.current.reach).toBeNull();

    await waitFor(() => {
      expect(first.result.current.reach).toEqual(MAINTENANCE_NOTIFIES);
    });

    // The line's sentences read what the line was answered.
    expect(getKeptScheduledMaintenanceReach(asked)).toEqual(
      MAINTENANCE_NOTIFIES,
    );

    // A second place asking the same question is answered without asking.
    const second: { result: { current: ScheduledMaintenanceReachState } } =
      renderHook(() => {
        return useScheduledMaintenanceReach(asked);
      });

    await waitFor(() => {
      expect(second.result.current.reach).toEqual(MAINTENANCE_NOTIFIES);
    });
    expect(asks).toHaveLength(1);

    const none: { result: { current: ScheduledMaintenanceReachState } } =
      renderHook(() => {
        return useScheduledMaintenanceReach(null);
      });

    expect(none.result.current).toEqual({
      reach: null,
      isLoading: false,
      error: "",
    });
  });

  test("an event's answer is never handed to a template's question about the same pages", async () => {
    await fetchScheduledMaintenanceReach(
      question(MaintenanceReachRecord.Event, [SITE_1]),
    );

    const template: { result: { current: ScheduledMaintenanceReachState } } =
      renderHook(() => {
        return useScheduledMaintenanceReach(
          question(MaintenanceReachRecord.Template, [SITE_1]),
        );
      });

    expect(template.result.current.reach).toBeNull();

    await waitFor(() => {
      expect(template.result.current.reach).toEqual(MAINTENANCE_NOTIFIES);
    });
    expect(
      asks.map((ask: ScheduledMaintenanceReachAsk): string => {
        return ask.route;
      }),
    ).toEqual([
      SCHEDULED_MAINTENANCE_REACH_ROUTE,
      SCHEDULED_MAINTENANCE_TEMPLATE_REACH_ROUTE,
    ]);
  });

  test("not answered: no answer, and the reason why", async () => {
    answer = new HTTPErrorResponse(500, { message: "Down." }, {});

    const hook: { result: { current: ScheduledMaintenanceReachState } } =
      renderHook(() => {
        return useScheduledMaintenanceReach(
          question(MaintenanceReachRecord.Event, [SITE_2]),
        );
      });

    await waitFor(() => {
      expect(hook.result.current.isLoading).toBe(false);
    });
    expect(hook.result.current.reach).toBeNull();
    expect(hook.result.current.error).not.toBe("");
  });
});
