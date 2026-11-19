import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";

/*
 * useAnnouncementReach (#9775): what the server says of the status pages
 * picked on an announcement's form, for its Schedule line and its notify
 * boxes. The form asks from more than one place at once, and again on the
 * review step, so one answer serves them all - asked once, kept a short
 * while, handed out only for the pages it is for. Not known, or not
 * answered, it says nothing, and the form promises nothing.
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

import useAnnouncementReach, {
  ANNOUNCEMENT_REACH_KEPT_FOR_MS,
  AnnouncementReachState,
  fetchAnnouncementReach,
  getAnnouncementReachKey,
  getKeptAnnouncementReach,
  NO_ANNOUNCEMENT_REACH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/useAnnouncementReach";
import { AnnouncementReachQuestion } from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import OneUptimeDate from "../../../Types/Date";
import AnnouncementReach from "../../../Types/StatusPage/AnnouncementReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import {
  ANNOUNCEMENT_NOTIFIES,
  ANNOUNCEMENT_REACH_ROUTE,
  AnnouncementReachAnswer,
  AnnouncementReachAsk,
  announcementNothingSent,
  answerAnnouncementReach,
} from "./AnnouncementReachAnswers";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const ANNOUNCEMENT: string = "d0000000-0000-4000-8000-000000000001";

let now: number = new Date("2026-11-19T09:00:00.000Z").getTime();
let answer: AnnouncementReachAnswer = ANNOUNCEMENT_NOTIFIES;
let asks: Array<AnnouncementReachAsk> = [];

function question(
  statusPageIds: Array<string>,
  announcementId: string | null = null,
): AnnouncementReachQuestion {
  return { statusPageIds: statusPageIds, announcementId: announcementId };
}

beforeEach(() => {
  now = new Date("2026-11-19T09:00:00.000Z").getTime();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now);
  });

  answer = ANNOUNCEMENT_NOTIFIES;
  asks = answerAnnouncementReach((): AnnouncementReachAnswer => {
    return answer;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("asking the server", () => {
  test("posts the pages picked to the announcement's route, with the project's header", async () => {
    await fetchAnnouncementReach(question([SITE_1, SITE_2]));

    expect(asks).toEqual([
      {
        route: ANNOUNCEMENT_REACH_ROUTE,
        statusPageIds: [SITE_1, SITE_2],
        announcementId: null,
        headers: { tenantid: "10000000-0000-4000-8000-000000000001" },
      },
    ]);
    // The route the hook writes out is the one the server registers.
    expect(ANNOUNCEMENT_REACH_ROUTE).toBe(
      `/status-page-announcement${AnnouncementReach.routePath}`,
    );
  });

  test("on an Edit, names the announcement it edits", async () => {
    await fetchAnnouncementReach(question([SITE_1], ANNOUNCEMENT));

    expect(asks[0]!.announcementId).toBe(ANNOUNCEMENT);
  });

  test("reads the answer, and refuses one it cannot read", async () => {
    answer = announcementNothingSent(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    await expect(fetchAnnouncementReach(question([SITE_1]))).resolves.toEqual({
      nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
    });

    answer = {
      nothingSentReason: PublicNoteNothingSentReason.NoMonitors,
    } as never;

    await expect(fetchAnnouncementReach(question([SITE_1]))).rejects.toThrow(
      "The answer about where this announcement shows could not be read.",
    );
  });
});

describe("one question, whatever order the pages are picked in", () => {
  test("the same pages in any order, each once, are one question", () => {
    expect(getAnnouncementReachKey(question([SITE_2, SITE_1, SITE_2]))).toBe(
      getAnnouncementReachKey(question([SITE_1.toUpperCase(), SITE_2])),
    );
  });

  test("the same pages of another announcement are another question", () => {
    expect(getAnnouncementReachKey(question([SITE_1], ANNOUNCEMENT))).not.toBe(
      getAnnouncementReachKey(question([SITE_1])),
    );
  });

  test("no page is no question", () => {
    expect(getAnnouncementReachKey(question([]))).toBe("");
    expect(getAnnouncementReachKey(null)).toBe("");
  });
});

describe("the answer, for every place that asks", () => {
  test("no page picked: asks nothing, and says nothing", () => {
    const { result } = renderHook(() => {
      return useAnnouncementReach(null);
    });

    expect(result.current).toEqual(NO_ANNOUNCEMENT_REACH);
    expect(asks).toEqual([]);
  });

  test("not known while it is asked, then the answer", async () => {
    answer = announcementNothingSent(PublicNoteNothingSentReason.NoStatusPages);

    const { result } = renderHook(() => {
      return useAnnouncementReach(question([SITE_1]));
    });

    expect(result.current).toEqual({
      reach: null,
      isLoading: true,
      error: "",
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.reach).toEqual(
      announcementNothingSent(PublicNoteNothingSentReason.NoStatusPages),
    );
  });

  test("two places asking the same question at once ask the server once", async () => {
    const first: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_1, SITE_2]));
      },
    );
    const second: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_2, SITE_1]));
      },
    );

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(asks).toHaveLength(1);
  });

  test("a place drawn later reads the kept answer at once, without asking", async () => {
    const first: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_1]));
      },
    );

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });

    // The review step, drawn after the Status Pages step.
    const later: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_1]));
      },
    );

    expect(later.result.current).toEqual({
      reach: ANNOUNCEMENT_NOTIFIES,
      isLoading: false,
      error: "",
    });
    expect(getKeptAnnouncementReach(question([SITE_1]))).toEqual(
      ANNOUNCEMENT_NOTIFIES,
    );
    expect(asks).toHaveLength(1);
  });

  test("an answer is kept only a short while: the next form asks again", async () => {
    const first: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_1]));
      },
    );

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });

    now += ANNOUNCEMENT_REACH_KEPT_FOR_MS + 1;
    answer = announcementNothingSent(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    expect(getKeptAnnouncementReach(question([SITE_1]))).toBeNull();

    const next: { result: { current: AnnouncementReachState } } = renderHook(
      () => {
        return useAnnouncementReach(question([SITE_1]));
      },
    );

    expect(next.result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(next.result.current.reach).toEqual(
        announcementNothingSent(PublicNoteNothingSentReason.NotificationsOff),
      );
    });
    expect(asks).toHaveLength(2);

    // The place that kept its answer keeps showing it, however long it stays.
    expect(first.result.current.reach).toEqual(ANNOUNCEMENT_NOTIFIES);
  });

  test("other pages picked: the last answer is not handed out for them", async () => {
    let picked: Array<string> = [SITE_1];

    const { result, rerender } = renderHook(() => {
      return useAnnouncementReach(question(picked));
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    answer = announcementNothingSent(PublicNoteNothingSentReason.NoStatusPages);
    picked = [SITE_2];
    rerender();

    expect(result.current).toEqual({
      reach: null,
      isLoading: true,
      error: "",
    });

    await waitFor(() => {
      expect(result.current.reach).toEqual(
        announcementNothingSent(PublicNoteNothingSentReason.NoStatusPages),
      );
    });
  });

  test("not answered: says nothing, with why", async () => {
    answer = new HTTPErrorResponse(
      403,
      {
        message:
          "You do not have permissions to create Status Page Announcement.",
      },
      {},
    );

    const { result } = renderHook(() => {
      return useAnnouncementReach(question([SITE_1]));
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.reach).toBeNull();
    expect(result.current.error).toContain(
      "You do not have permissions to create Status Page Announcement.",
    );
  });

  test("an answer for pages the form has left is dropped", async () => {
    answer = "never";

    const { result, rerender, unmount } = renderHook(
      (props: { picked: Array<string> }) => {
        return useAnnouncementReach(question(props.picked));
      },
      { initialProps: { picked: [SITE_1] } },
    );

    answer = ANNOUNCEMENT_NOTIFIES;
    rerender({ picked: [SITE_2] });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.reach).toEqual(ANNOUNCEMENT_NOTIFIES);

    unmount();
    await act(async () => {});
  });
});
