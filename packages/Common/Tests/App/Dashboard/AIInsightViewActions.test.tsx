import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";

/*
 * The human actions on the insight detail page, driven against a fake server
 * that implements the same rules AIInsightService does.
 *
 * Two bugs live here, and both are invisible to a source-text wiring test:
 *
 *  - The action bar was rendered only while the insight was open, so a
 *    dismissal — one click, terminal, and additionally a suppression of the
 *    same fingerprint for InsightStore's cooldown — could not be undone from
 *    the UI at all.
 *  - Confirm was disabled whenever a Confirmed verdict already existed. A
 *    disabled Button in this design keeps its enabled styling and the browser
 *    swallows the click, so "already confirmed" and "the button is broken"
 *    looked identical.
 *
 * Everything below therefore asserts what a person can actually see and press
 * after each action, not which props were passed.
 */

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";

const postMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("react-router-dom", () => {
  return {
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve(buildInsight());
      },
      // The fix task's pull requests, with what production showed.
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

const getListMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightHumanVerdict from "../../../Types/AI/AIInsightHumanVerdict";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The fake server's row. Kept deliberately close to the real columns: the
 * page reads status/humanVerdict back after every action, so a fake that did
 * not persist writes would hide exactly the class of bug being tested.
 */
interface FakeRow {
  status: AIInsightStatus;
  humanVerdict: AIInsightHumanVerdict | null;
  fixAiRunId: ObjectID | null;
}

let row: FakeRow;

type BuildInsightFunction = () => AIInsight;

const buildInsight: BuildInsightFunction = (): AIInsight => {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = "New exception: 401 in api";
  insight.insightType = AIInsightType.NewException;
  insight.severity = AIInsightSeverity.Medium;
  insight.detailMarkdown = "New exception detected";
  insight.occurrenceCount = 4;
  insight.status = row.status;
  if (row.humanVerdict) {
    insight.humanVerdict = row.humanVerdict;
  }
  if (row.fixAiRunId) {
    insight.fixAiRunId = row.fixAiRunId;
  }
  return insight;
};

// AIInsightService.getReopenStatus, mirrored.
type ReopenStatusFunction = () => AIInsightStatus;

const reopenStatus: ReopenStatusFunction = (): AIInsightStatus => {
  return row.fixAiRunId
    ? AIInsightStatus.FixOpened
    : AIInsightStatus.ActionRequired;
};

/*
 * AIInsightAPI's three write routes, implemented against `row` exactly as the
 * service does — including the two rules the page duplicates optimistically
 * (Confirmed reopens an insight closed AS Dismissed; reopen clears the
 * verdict), so a page that got either one wrong would disagree with the
 * refetch and fail here.
 */
type HandlePostFunction = (args: {
  url: { toString: () => string };
  data: JSONObject;
}) => Promise<HTTPResponse<JSONObject>>;

const handlePost: HandlePostFunction = async (args: {
  url: { toString: () => string };
  data: JSONObject;
}): Promise<HTTPResponse<JSONObject>> => {
  const url: string = args.url.toString();

  if (url.includes("/ai-insight/triage-run")) {
    return new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {});
  }

  if (url.includes("/ai-insight/verdict")) {
    const verdict: AIInsightHumanVerdict = args.data[
      "verdict"
    ] as AIInsightHumanVerdict;

    if (verdict === AIInsightHumanVerdict.Dismissed) {
      row.status = AIInsightStatus.Dismissed;
    } else if (row.status === AIInsightStatus.Dismissed) {
      row.status = reopenStatus();
    }
    row.humanVerdict = verdict;

    return new HTTPResponse<JSONObject>(
      200,
      { insightId: INSIGHT_ID, verdict: verdict, status: row.status },
      {},
    );
  }

  if (url.includes("/ai-insight/resolve")) {
    row.status = AIInsightStatus.Resolved;
    if (!row.humanVerdict) {
      row.humanVerdict = AIInsightHumanVerdict.Confirmed;
    }
    return new HTTPResponse<JSONObject>(
      200,
      { insightId: INSIGHT_ID, status: row.status },
      {},
    );
  }

  if (url.includes("/ai-insight/reopen")) {
    if (
      row.status === AIInsightStatus.Dismissed ||
      row.status === AIInsightStatus.Resolved
    ) {
      row.status = reopenStatus();
      row.humanVerdict = null;
    }
    return new HTTPResponse<JSONObject>(
      200,
      { insightId: INSIGHT_ID, status: row.status },
      {},
    );
  }

  return new HTTPResponse<JSONObject>(200, {}, {});
};

type RenderPageFunction = () => Promise<void>;

const renderPage: RenderPageFunction = async (): Promise<void> => {
  render(<AIInsightViewPage {...({} as any)} />);
  await waitFor(() => {
    return expect(
      screen.getByText("New exception: 401 in api"),
    ).toBeInTheDocument();
  });
};

type ClickFunction = (name: string) => Promise<void>;

const click: ClickFunction = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: name }));
  });
};

type PostedRoutesFunction = () => Array<string>;

const postedRoutes: PostedRoutesFunction = (): Array<string> => {
  return postMock.mock.calls.map((call: Array<any>) => {
    return String(call[0].url);
  });
};

describe("AI insight detail — human actions", () => {
  beforeEach(() => {
    row = {
      status: AIInsightStatus.ActionRequired,
      humanVerdict: null,
      fixAiRunId: null,
    };
    postMock.mockReset();
    postMock.mockImplementation((args: any) => {
      return handlePost(args);
    });
    getListMock.mockReset();
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 5 });
  });

  afterEach(() => {
    cleanup();
  });

  test("confirming an open insight records the verdict and shows it", async () => {
    await renderPage();

    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();

    await click("Confirm");

    await waitFor(() => {
      return expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });
    // The verdict survives the reconciling refetch, not just the optimism.
    expect(row.humanVerdict).toBe(AIInsightHumanVerdict.Confirmed);
    // Confirming does not close an open insight.
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
  });

  test("a dismissed insight keeps its actions — this is the undo path", async () => {
    await renderPage();

    await click("Dismiss");

    await waitFor(() => {
      // Both pills read Dismissed: the lifecycle status and the verdict.
      return expect(screen.getAllByText("Dismissed")).toHaveLength(2);
    });

    /*
     * The regression: the whole bar used to unmount here, leaving a closed
     * insight with no control on the page at all.
     */
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeEnabled();
    // Resolve gives way to Reopen — "close as handled" is meaningless now.
    expect(
      screen.queryByRole("button", { name: "Resolve" }),
    ).not.toBeInTheDocument();
    // And the footer no longer reads as a dead end.
    expect(screen.getByText(/you can reopen it here/)).toBeInTheDocument();
  });

  test("Reopen undoes a dismissal and clears the verdict", async () => {
    await renderPage();

    await click("Dismiss");
    await waitFor(() => {
      return expect(screen.getAllByText("Dismissed")).toHaveLength(2);
    });

    await click("Reopen");

    await waitFor(() => {
      return expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    });

    expect(screen.queryAllByText("Dismissed")).toHaveLength(0);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(row.status).toBe(AIInsightStatus.ActionRequired);
    /*
     * Cleared, not merely hidden: a verdict the human took back must stop
     * counting toward per-detector precision, and a stale humanVerdictAt
     * would otherwise keep anchoring InsightStore's dismissal cooldown.
     */
    expect(row.humanVerdict).toBeNull();
    expect(
      postedRoutes().some((url: string) => {
        return url.endsWith("/ai-insight/reopen");
      }),
    ).toBe(true);
    // Back to an open insight, so Resolve is available again.
    expect(screen.getByRole("button", { name: "Resolve" })).toBeEnabled();
  });

  test("Reopen restores FixOpened when a fix task is attached", async () => {
    row.fixAiRunId = new ObjectID("33333333-3333-4333-8333-333333333333");
    await renderPage();

    await click("Dismiss");
    await waitFor(() => {
      return expect(screen.getAllByText("Dismissed")).toHaveLength(2);
    });

    await click("Reopen");

    await waitFor(() => {
      return expect(screen.getByText("Fix Opened")).toBeInTheDocument();
    });
    expect(row.status).toBe(AIInsightStatus.FixOpened);
  });

  test("confirming a dismissed insight reopens it — Confirm is never a dead click", async () => {
    row.status = AIInsightStatus.Dismissed;
    row.humanVerdict = AIInsightHumanVerdict.Dismissed;
    await renderPage();

    /*
     * Confirm still has work to do here even though a verdict exists, so it
     * must be pressable — the old `disabled={isConfirmed}` rule is only
     * about the verdict and would have to be re-derived to get this wrong.
     */
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();

    await click("Confirm");

    await waitFor(() => {
      return expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });

    // "Closed as noise" cannot survive a Confirmed verdict.
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(row.status).toBe(AIInsightStatus.ActionRequired);
    expect(screen.queryAllByText("Dismissed")).toHaveLength(0);
  });

  test("a button is disabled only when pressing it would change nothing", async () => {
    row.humanVerdict = AIInsightHumanVerdict.Confirmed;
    await renderPage();

    // Already Confirmed and already open: confirming again is a genuine no-op.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    // ...and it now looks disabled, rather than swallowing the click silently.
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass(
      "opacity-50",
      "cursor-not-allowed",
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).not.toHaveClass(
      "opacity-50",
    );
    // Dismiss still changes something (the verdict and the status).
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  test("a resolved insight can still be reopened", async () => {
    await renderPage();

    await click("Resolve");

    await waitFor(() => {
      return expect(screen.getByText("Resolved")).toBeInTheDocument();
    });
    // Resolve implies the finding was real.
    expect(screen.getByText("Confirmed")).toBeInTheDocument();

    await click("Reopen");

    await waitFor(() => {
      return expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    });
    expect(row.humanVerdict).toBeNull();
  });

  /*
   * Merged is not fixed: the fix task's pull request says what production
   * showed once it shipped - which is what resolved the insight, or put it
   * back in front of people.
   */
  test("a fix production showed did not work says so beside its task", async () => {
    row.fixAiRunId = new ObjectID("33333333-3333-4333-8333-333333333333");
    getListMock.mockResolvedValue({
      data: [
        {
          productionStatus: "Regressed",
          productionCheck: "Performance",
          productionSummary:
            'The p99 of "GET /orders" is 2.5 s in the 26 hours since version 2.3.2 shipped the fix (900 spans), against 2.4 s in the 7 days before it merged, so the fix did not make it faster.',
        },
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderPage();

    const verdict: HTMLElement = await screen.findByTestId(
      "ai-insight-fix-production",
    );
    expect(verdict).toHaveTextContent("Still slow after the fix");
    expect(verdict).toHaveTextContent("so the fix did not make it faster");

    // Read once, for the fix task's run only.
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(String(getListMock.mock.calls[0]![0].query.aiRunId)).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  test("an insight with no fix task, or a fix with no verdict, shows none", async () => {
    await renderPage();

    expect(getListMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ai-insight-fix-production")).toBeNull();

    cleanup();
    row.fixAiRunId = new ObjectID("33333333-3333-4333-8333-333333333333");
    getListMock.mockRejectedValue(new Error("Not on this plan"));

    await renderPage();

    await waitFor(() => {
      return expect(getListMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("ai-insight-fix-production")).toBeNull();
    expect(
      screen.getByText("View the fix task and pull request"),
    ).toBeInTheDocument();
  });

  test("a failed action rolls back and says so instead of failing silently", async () => {
    await renderPage();

    postMock.mockImplementation((args: any) => {
      if (String(args.url).includes("/ai-insight/verdict")) {
        return Promise.resolve(
          new HTTPErrorResponse(500, { message: "nope" }, {}),
        );
      }
      return handlePost(args);
    });

    await click("Dismiss");

    /*
     * By role, not by text: Alert splices strongTitle and title into one
     * "<strong> - <message>" line, so an exact text match silently misses the
     * banner and the test would pass on a page that showed nothing.
     */
    const banner: HTMLElement = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Could not save your action");
    expect(banner).toHaveTextContent("Request failed");

    // Rolled back: the insight is still open and still has no verdict.
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.queryAllByText("Dismissed")).toHaveLength(0);
    expect(row.status).toBe(AIInsightStatus.ActionRequired);
  });
});
