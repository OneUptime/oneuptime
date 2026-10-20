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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();
const friendlyMessageMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<any>) => {
        return friendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "33333333-3333-4333-8333-333333333333" };
      },
    },
  };
});

import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import { formatWaitUntil } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE AI INVESTIGATION CARD WHILE AN INVESTIGATION RULE WAITS (issue #5074).
 *
 * The card says when OneUptime AI investigates - "if this incident is still
 * open" - and why it waits, with a calm "Waiting" pill instead of "Not
 * investigated". Whoever may change the record gets Investigate now, which
 * starts it at once; everyone else is told who can. Once a run exists the
 * card shows it, in the same card.
 */

const SUBJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const WAIT_UNTIL: Date = new Date(Date.now() + 8 * 60 * 1000);

function waitingResponse(overrides: JSONObject = {}): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: null,
      notInvestigatedReason: null,
      waitingInvestigation: {
        waitUntil: WAIT_UNTIL.toISOString(),
        waitMinutes: 10,
        canStartNow: true,
        ...overrides,
      },
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
      evidence: [],
      references: [],
      clusterAccess: [],
    },
    {},
  );
}

function runResponse(status: AIRunStatus): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: { _id: "44444444-4444-4444-8444-444444444444", status },
      notInvestigatedReason: null,
      waitingInvestigation: null,
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
      evidence: [],
      references: [],
      clusterAccess: [],
    },
    {},
  );
}

function postsTo(path: string): Array<any> {
  return postMock.mock.calls
    .map((call: Array<any>) => {
      return call[0];
    })
    .filter((request: any) => {
      return request.url.toString().endsWith(path);
    });
}

beforeEach(() => {
  postMock.mockReset();
  friendlyMessageMock.mockReset();
  friendlyMessageMock.mockReturnValue(
    "This project has reached its own daily AI limit. It resets at midnight UTC.",
  );
});

afterEach(() => {
  cleanup();
});

describe("an incident whose investigation waits", () => {
  test("says when OneUptime AI investigates it, and why it waits", async () => {
    postMock.mockResolvedValue(waitingResponse());

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(
      await screen.findByText(
        `OneUptime AI investigates at ${formatWaitUntil(WAIT_UNTIL)} if this incident is still open`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "An investigation rule makes OneUptime AI wait 10 minutes, so incidents resolved by then are not investigated.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("investigation-waiting")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  test("its pill says Waiting, not Not investigated, and nothing explains a skip", async () => {
    postMock.mockResolvedValue(waitingResponse());

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(await screen.findByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByText("Not investigated")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("investigation-not-started"),
    ).not.toBeInTheDocument();
  });

  test("a one-minute wait reads in the singular", async () => {
    postMock.mockResolvedValue(waitingResponse({ waitMinutes: 1 }));

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(
      await screen.findByText(
        "An investigation rule makes OneUptime AI wait 1 minute, so incidents resolved by then are not investigated.",
      ),
    ).toBeInTheDocument();
  });

  test("whoever may change it gets Investigate now", async () => {
    postMock.mockResolvedValue(waitingResponse());

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(
      await screen.findByRole("button", { name: "Investigate now" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("investigate-now-who")).not.toBeInTheDocument();
  });

  test("everyone else is told who can, and has no button", async () => {
    postMock.mockResolvedValue(waitingResponse({ canStartNow: false }));

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(
      await screen.findByText(
        "Someone who can edit this incident can start the investigation now.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Investigate now" }),
    ).not.toBeInTheDocument();
  });

  test("Investigate now starts it, and the card then shows the run that started", async () => {
    let started: boolean = false;
    postMock.mockImplementation(async (request: any) => {
      const url: string = request.url.toString();

      if (url.endsWith("/ai-investigation/investigate-now")) {
        started = true;
        return new HTTPResponse<JSONObject>(
          200,
          { runId: "44444444-4444-4444-8444-444444444444" },
          {},
        );
      }

      return started ? runResponse(AIRunStatus.Queued) : waitingResponse();
    });

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Investigate now" }),
    );

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId("investigation-waiting"),
      ).not.toBeInTheDocument();
    });

    const startRequests: Array<any> = postsTo(
      "/ai-investigation/investigate-now",
    );
    expect(startRequests).toHaveLength(1);
    expect(startRequests[0].data).toEqual({
      subjectType: "incident",
      subjectId: SUBJECT_ID.toString(),
    });
    expect(startRequests[0].headers).toEqual({
      tenantid: "33333333-3333-4333-8333-333333333333",
    });
    // Read again after the start, on the card's own endpoint.
    expect(postsTo("/ai-investigation/incident").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  test("a refusal says why, in the server's words, and the button stays for another try", async () => {
    postMock.mockImplementation(async (request: any) => {
      if (
        request.url.toString().endsWith("/ai-investigation/investigate-now")
      ) {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "This project has reached its own daily AI limit. It resets at midnight UTC.",
          },
          {},
        );
      }

      return waitingResponse();
    });

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Investigate now" }),
    );

    expect(
      await screen.findByTestId("investigate-now-error"),
    ).toHaveTextContent(
      "This project has reached its own daily AI limit. It resets at midnight UTC.",
    );
    expect(screen.getByTestId("investigate-now-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Investigate now" }),
      ).toBeEnabled();
    });
    expect(screen.getByTestId("investigation-waiting")).toBeInTheDocument();
  });

  test("a malformed wait from an older server falls back to the not-started body", async () => {
    postMock.mockResolvedValue(waitingResponse({ waitUntil: "not a time" }));

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    expect(
      await screen.findByTestId("investigation-not-started"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("investigation-waiting"),
    ).not.toBeInTheDocument();
  });
});

describe("an alert whose investigation waits", () => {
  test("names the alert, and starts it on the alert's lane", async () => {
    postMock.mockImplementation(async (request: any) => {
      if (
        request.url.toString().endsWith("/ai-investigation/investigate-now")
      ) {
        return new HTTPResponse<JSONObject>(200, { runId: "x" }, {});
      }

      return waitingResponse({ waitMinutes: 5, canStartNow: true });
    });

    render(<InvestigationPanel subjectType="alert" subjectId={SUBJECT_ID} />);

    expect(
      await screen.findByText(
        `OneUptime AI investigates at ${formatWaitUntil(WAIT_UNTIL)} if this alert is still open`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "An investigation rule makes OneUptime AI wait 5 minutes, so alerts resolved by then are not investigated.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Investigate now" }));

    await waitFor(() => {
      expect(postsTo("/ai-investigation/investigate-now")).toHaveLength(1);
    });
    expect(postsTo("/ai-investigation/investigate-now")[0].data).toEqual({
      subjectType: "alert",
      subjectId: SUBJECT_ID.toString(),
    });
  });

  test("everyone else is told who can, for an alert", async () => {
    postMock.mockResolvedValue(waitingResponse({ canStartNow: false }));

    render(<InvestigationPanel subjectType="alert" subjectId={SUBJECT_ID} />);

    expect(
      await screen.findByText(
        "Someone who can edit this alert can start the investigation now.",
      ),
    ).toBeInTheDocument();
  });
});
