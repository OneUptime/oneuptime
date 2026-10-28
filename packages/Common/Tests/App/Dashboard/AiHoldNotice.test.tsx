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
} from "@testing-library/react";
import * as React from "react";

/*
 * WHILE ONEUPTIME AI HOLDS THE PAGE: the AI Investigation card of an incident
 * or alert says AI is on it and when on-call paging starts unless AI
 * resolves it first, with Page now for anyone who wants a person at once.
 *
 * Driven through the real notice; only the reads of the held runs
 * (ModelAPI.getList) and Page now's request (API.post) are stubbed, and what
 * each asks for is asserted. The reader's permissions are stubbed where they
 * matter ("who it reads for"); elsewhere the snapshot has not landed, and the
 * notice asks, as it does then.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import AiHoldNotice, {
  AI_HOLD_NOTICE_REFRESH_MS,
  AI_HOLD_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiHoldNotice";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";

const INCIDENT_ID: ObjectID = new ObjectID(
  "a1a00000-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("a1a00000-0000-4000-8000-000000000002");
const COMMON_HEADERS: Record<string, string> = {
  tenantid: "a1a00000-0000-4000-8000-0000000000aa",
};

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface PostArgs {
  url: URL;
  data: JSONObject;
  headers: Record<string, string>;
}

// What each read answers, in turn; the last one stays.
let holds: Array<Array<Date> | Error> = [];
let lastHold: Array<Date> | Error = [];
let pageNowAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

let reads: Array<ListArgs> = [];
let posts: Array<PostArgs> = [];

function heldUntil(...moments: Array<Date>): Array<Date> {
  return moments;
}

beforeEach(() => {
  reads = [];
  posts = [];
  holds = [];
  lastHold = [];
  pageNowAnswer = new HTTPResponse<JSONObject>(200, { startedRuns: 1 }, {});

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue(COMMON_HEADERS);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    args: ListArgs,
  ) => {
    reads.push(args);
    const answer: Array<Date> | Error = holds.shift() || lastHold;

    if (answer instanceof Error) {
      throw answer;
    }

    return {
      data: answer.map((pagingStartsAt: Date) => {
        const run: OnCallDutyPolicyExecutionLog =
          new OnCallDutyPolicyExecutionLog();
        run.id = ObjectID.generate();
        run.pagingStartsAt = pagingStartsAt;
        return run;
      }),
      count: answer.length,
      skip: 0,
      limit: 1,
    };
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (args: PostArgs) => {
    posts.push(args);
    return pageNowAnswer;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function shownTime(at: Date): string {
  return OneUptimeDate.getLocalTimeString(at, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("with nothing held", () => {
  test("shows nothing, having asked for the incident's held pages", async () => {
    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    await settle();

    expect(screen.queryByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeNull();
    expect(reads[0]!.modelType).toBe(OnCallDutyPolicyExecutionLog);
    expect(reads[0]!.query).toEqual({
      triggeredByIncidentId: INCIDENT_ID,
      status: OnCallDutyPolicyStatus.Waiting,
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
    });
    // The first page to start is the one that says when paging starts.
    expect(reads[0]!.sort).toEqual({ pagingStartsAt: SortOrder.Ascending });
    expect(reads[0]!.limit).toBe(1);
    expect(reads[0]!.select).toEqual({ _id: true, pagingStartsAt: true });
  });

  test("an alert's card asks for that alert's held pages", async () => {
    render(<AiHoldNotice subjectType="alert" subjectId={ALERT_ID} />);

    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });

    expect(reads[0]!.query).toEqual({
      triggeredByAlertId: ALERT_ID,
      status: OnCallDutyPolicyStatus.Waiting,
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
    });
  });

  test("a reader who may not read on-call runs sees no notice", async () => {
    lastHold = new Error("You do not have permission to read.");

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    await settle();

    expect(screen.queryByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeNull();
  });

  test("reads nothing more while nothing is held", async () => {
    jest.useFakeTimers();

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);
    await settle();

    await act(async () => {
      jest.advanceTimersByTime(AI_HOLD_NOTICE_REFRESH_MS * 3);
    });

    expect(reads).toHaveLength(1);
  });
});

/*
 * Only a reader who certainly may not read on-call runs is spared the read:
 * the server would refuse it on every incident and alert they open.
 */
describe("who it reads for", () => {
  function signInWith(permissions: Array<Permission>): void {
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(permissions);
    // The rows PermissionGate reads the blocks from: none.
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
  }

  test("a reader who may not read on-call runs is spared the read, held page or not", async () => {
    // May work alerts, but not read on-call runs.
    signInWith([Permission.AlertMember]);
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));

    render(<AiHoldNotice subjectType="alert" subjectId={ALERT_ID} />);
    await settle();

    expect(reads).toHaveLength(0);
    expect(screen.queryByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeNull();
  });

  test("a reader who may read on-call runs is told", async () => {
    signInWith([Permission.OnCallViewer]);
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    expect(
      await screen.findByTestId(AI_HOLD_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    expect(reads).toHaveLength(1);
  });

  test("while the reader's permissions are still on their way, it asks: the server decides", async () => {
    signInWith([]);
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    expect(
      await screen.findByTestId(AI_HOLD_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    expect(reads).toHaveLength(1);
  });
});

describe("while OneUptime AI holds the page", () => {
  test("says AI is on it, and when paging starts unless AI resolves the incident", async () => {
    const pagingStartsAt: Date = new Date(Date.now() + 8 * 60 * 1000);
    lastHold = heldUntil(pagingStartsAt);

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    const notice: HTMLElement = await screen.findByTestId(
      AI_HOLD_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent("OneUptime AI is on it");
    expect(notice).toHaveTextContent(
      `On-call paging starts at ${shownTime(pagingStartsAt)} unless OneUptime AI resolves this incident first.`,
    );
    expect(screen.getByTestId("ai-hold-page-now")).toHaveTextContent(
      "Page now",
    );
    // Read out as it changes, without taking the reader's focus.
    expect(notice).toHaveAttribute("aria-live", "polite");
  });

  test("on an alert, says the alert", async () => {
    const pagingStartsAt: Date = new Date(Date.now() + 5 * 60 * 1000);
    lastHold = heldUntil(pagingStartsAt);

    render(<AiHoldNotice subjectType="alert" subjectId={ALERT_ID} />);

    expect(await screen.findByTestId(AI_HOLD_NOTICE_TEST_ID)).toHaveTextContent(
      `On-call paging starts at ${shownTime(pagingStartsAt)} unless OneUptime AI resolves this alert first.`,
    );
  });

  test("reads again every few seconds, and goes once AI resolves it", async () => {
    jest.useFakeTimers();
    holds = [heldUntil(new Date(Date.now() + 8 * 60 * 1000))];
    lastHold = [];

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);
    await settle();

    expect(screen.getByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(AI_HOLD_NOTICE_REFRESH_MS);
    });
    await settle();

    expect(reads).toHaveLength(2);
    expect(screen.queryByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeNull();

    // Nothing held: it stops reading.
    await act(async () => {
      jest.advanceTimersByTime(AI_HOLD_NOTICE_REFRESH_MS * 3);
    });

    expect(reads).toHaveLength(2);
  });

  test("keeps reading while AI still holds it", async () => {
    jest.useFakeTimers();
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);
    await settle();

    await act(async () => {
      jest.advanceTimersByTime(AI_HOLD_NOTICE_REFRESH_MS * 2);
    });
    await settle();

    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeInTheDocument();
  });
});

describe("Page now", () => {
  test("asks for the incident's pages to start, and the notice goes once they have", async () => {
    holds = [heldUntil(new Date(Date.now() + 8 * 60 * 1000))];
    lastHold = [];

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    fireEvent.click(await screen.findByTestId("ai-hold-page-now"));

    await waitFor(() => {
      expect(screen.queryByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeNull();
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.toString()).toMatch(/\/ai-first-responder\/page-now$/);
    expect(posts[0]!.data).toEqual({ incidentId: INCIDENT_ID.toString() });
    expect(posts[0]!.headers).toEqual(COMMON_HEADERS);
    // It read the hold again once the pages had started.
    expect(reads).toHaveLength(2);
  });

  test("for an alert, sends the alert", async () => {
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));

    render(<AiHoldNotice subjectType="alert" subjectId={ALERT_ID} />);

    fireEvent.click(await screen.findByTestId("ai-hold-page-now"));

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });

    expect(posts[0]!.data).toEqual({ alertId: ALERT_ID.toString() });
  });

  test("refused, says why and keeps the notice to try again", async () => {
    lastHold = heldUntil(new Date(Date.now() + 8 * 60 * 1000));
    pageNowAnswer = new HTTPErrorResponse(
      403,
      { message: "You need permission to page on-call policies to page now." },
      {},
    );

    render(<AiHoldNotice subjectType="incident" subjectId={INCIDENT_ID} />);

    fireEvent.click(await screen.findByTestId("ai-hold-page-now"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You need permission to page on-call policies to page now.",
    );
    expect(screen.getByTestId(AI_HOLD_NOTICE_TEST_ID)).toBeInTheDocument();
    expect(screen.getByTestId("ai-hold-page-now")).not.toBeDisabled();
  });
});
