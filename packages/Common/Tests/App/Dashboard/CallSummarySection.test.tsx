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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * WHAT ONEUPTIME AI READ IN AN INCIDENT CALL, on the AI Investigation card
 * (issue #4875).
 *
 * The root cause the call points at is a suggestion - marked "Not
 * confirmed", with whether somebody on the call said it or OneUptime AI
 * read it from the discussion - and rests on transcript lines, quoted with
 * their time and speaker in the order they were said. It reaches the
 * incident only when a person uses it: Use as root cause opens it in the
 * root cause's editor, and saving there is the person's own edit. Dismiss
 * sets it aside, Undo brings it back. A call that did not settle the cause
 * says so rather than guessing. Everything else the call said is folded
 * under the cause, confirmed findings told from hypotheses.
 */

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

// The root cause's editor as a textarea that takes `initialValue` once per mount.
jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      dataTestId?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-label="Root cause"
          data-testid={props.dataTestId}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value);
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <div data-testid="markdown-viewer">{props.text}</div>;
    },
  };
});

import CallSummarySection from "../../../../App/FeatureSet/Dashboard/src/Components/AI/CallSummary/CallSummarySection";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  CallSummaryBasis,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import CallSummaryMarkdown from "../../../Utils/VideoCall/CallSummaryMarkdown";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  CALL_ID,
  INCIDENT_ID,
  OTHER_CALL_ID,
  SUGGESTED_CAUSE,
  TRANSCRIPT_INFO,
  notEnoughSummary,
  storedTranscript,
  suggestedCall,
  suggestedSummary,
  transcriptCall,
} from "./CallTranscriptFixtures";

let canWorkOnCalls: boolean;
let canEditRootCause: boolean;
let post: ReturnType<typeof jest.spyOn>;
let postAnswer: () => HTTPResponse<JSONObject> | HTTPErrorResponse;
let currentRootCause: string;

interface SentRequest {
  url: { toString: () => string };
  data: JSONObject;
}

function sentRequests(): Array<SentRequest> {
  return post.mock.calls.map((args: Array<unknown>): SentRequest => {
    return args[0] as SentRequest;
  });
}

function renderSection(calls: Array<IncidentVideoCall>): {
  onChanged: MockFunction;
} {
  const onChanged: MockFunction = getJestMockFunction();

  render(
    <MemoryRouter>
      <CallSummarySection
        incidentId={new ObjectID(INCIDENT_ID)}
        calls={calls}
        onChanged={() => {
          onChanged();
        }}
      />
    </MemoryRouter>,
  );

  return { onChanged };
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`);

  canWorkOnCalls = true;
  canEditRootCause = true;
  currentRootCause = "Checkout API p95 above 2s for 5 minutes (monitor).";

  jest.spyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return canWorkOnCalls
        ? { isAllowed: true }
        : { isAllowed: false, disabledReason: "No permission." };
    },
  );
  jest.spyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return canEditRootCause
        ? { isAllowed: true }
        : { isAllowed: false, disabledReason: "No permission." };
    },
  );

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  } as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (request: {
    modelType: unknown;
  }) => {
    if (request.modelType === Incident) {
      const incident: Incident = new Incident();
      incident.id = new ObjectID(INCIDENT_ID);
      incident.rootCause = currentRootCause;
      return incident;
    }

    const call: IncidentVideoCall = new IncidentVideoCall();
    call.id = new ObjectID(CALL_ID);
    call.transcript = storedTranscript();
    return call;
  }) as never);

  postAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };
  post = jest.spyOn(API, "post").mockImplementation((async () => {
    return postAnswer();
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which calls it speaks of", () => {
  test("nothing at all while no call's transcript has been read", () => {
    renderSection([
      transcriptCall(),
      transcriptCall({
        id: OTHER_CALL_ID,
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Skipped,
      }),
    ]);

    expect(screen.queryByTestId("call-summaries")).toBeNull();
  });

  test("the incident's only call is the incident's call, with its transcript a click away", async () => {
    renderSection([suggestedCall()]);

    const section: HTMLElement = screen.getByTestId("call-summary");

    expect(section).toHaveAttribute("id", `call-summary-${CALL_ID}`);
    expect(within(section).getByText("From the incident's call")).toBeVisible();
    expect(
      within(section).getByText(
        /What OneUptime AI read in the transcript of the Zoom meeting\. 11 minutes · 3 speakers\./,
      ),
    ).toBeVisible();

    fireEvent.click(within(section).getByTestId("call-summary-view-transcript"));

    // The dialog starts on the quoted lines, highlighted.
    const lines: HTMLElement = await screen.findByTestId("call-transcript-lines");
    const highlighted: Array<string> = within(lines)
      .getAllByTestId("call-transcript-line")
      .filter((line: HTMLElement): boolean => {
        return line.getAttribute("data-highlighted") === "true";
      })
      .map((line: HTMLElement): string => {
        return line.getAttribute("data-line") || "";
      });

    expect(highlighted).toEqual(["6", "11"]);
    expect(
      screen.getByTestId("call-transcript-highlight-legend"),
    ).toHaveTextContent("Highlighted: the lines the suggested root cause quotes.");
  });

  test("with more than one call, each is named for its own", () => {
    renderSection([
      suggestedCall(),
      transcriptCall({
        id: OTHER_CALL_ID,
        provider: VideoCallProvider.MicrosoftTeams,
        createdMinutesAgo: 120,
      }),
    ]);

    expect(screen.getByText("From the Zoom meeting")).toBeVisible();
    expect(screen.queryByText("From the incident's call")).toBeNull();
  });
});

describe("a suggested root cause", () => {
  test("is marked Not confirmed, says it was said on the call, and quotes its lines in the order they were said", () => {
    renderSection([suggestedCall()]);

    const rootCause: HTMLElement = screen.getByTestId("call-summary-root-cause");

    expect(within(rootCause).getByTestId("call-summary-status")).toHaveTextContent(
      "Not confirmed",
    );
    expect(
      within(rootCause).getByTestId("call-summary-root-cause-text"),
    ).toHaveTextContent(SUGGESTED_CAUSE);
    expect(
      within(rootCause).getByText(
        "Said on the call: someone found or confirmed it.",
      ),
    ).toBeVisible();

    const quotes: Array<HTMLElement> =
      within(rootCause).getAllByTestId("call-summary-quote");

    // The model gave line 11 first; the call said line 6 first.
    expect(
      quotes.map((quote: HTMLElement): string | null => {
        return quote.getAttribute("data-line");
      }),
    ).toEqual(["6", "11"]);
    expect(quotes[0]).toHaveTextContent("00:04:03 · Sam Rivera");
    expect(quotes[0]).toHaveTextContent(
      "“The new release has DB_POOL_MAX=10, it was 40 before.”",
    );
  });

  test("one OneUptime AI read from the discussion says nobody confirmed it", () => {
    const summary: ReturnType<typeof suggestedSummary> = suggestedSummary();
    summary.rootCause.basis = CallSummaryBasis.Inferred;

    renderSection([suggestedCall({ summary })]);

    expect(
      screen.getByText(
        "OneUptime AI's reading of what was said: nobody on the call confirmed it.",
      ),
    ).toBeVisible();
  });

  test("Use as root cause opens it in the root cause's editor, quotes and all, and shows the root cause it replaces", async () => {
    renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-use"));

    const editor: HTMLTextAreaElement = screen.getByTestId(
      "use-call-root-cause-editor",
    ) as HTMLTextAreaElement;

    expect(editor.value).toBe(
      CallSummaryMarkdown.buildRootCause(suggestedSummary().rootCause),
    );
    expect(editor.value).toContain("`DB_POOL_MAX=10`");
    expect(editor.value).toContain(
      "> 00:04:03 · Sam Rivera: The new release has `DB_POOL_MAX=10`, it was 40 before.",
    );

    const current: HTMLElement = await screen.findByTestId(
      "use-call-root-cause-current",
    );

    expect(current).toHaveTextContent(
      "It replaces the incident's current root cause. Show it",
    );
    expect(within(current).getByTestId("markdown-viewer")).toHaveTextContent(
      currentRootCause,
    );
    // Nothing is written by opening it.
    expect(post).not.toHaveBeenCalled();
  });

  test("saving writes what the person kept, as their decision, and the page reads the calls again", async () => {
    const { onChanged } = renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-use"));
    fireEvent.change(screen.getByTestId("use-call-root-cause-editor"), {
      target: { value: "The pool size in release 2026.09.14-2." },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    const [request] = sentRequests();

    expect(request!.url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/root-cause-suggestion`,
    );
    expect(request!.data).toEqual({
      decision: RootCauseSuggestionStatus.Accepted,
      rootCause: "The pool size in release 2026.09.14-2.",
    });
    expect(screen.queryByTestId("use-call-root-cause")).toBeNull();
  });

  test("an empty root cause cannot be saved", () => {
    renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-use"));
    fireEvent.change(screen.getByTestId("use-call-root-cause-editor"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });

  test("a refused save stays open and says why", async () => {
    postAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        403,
        { message: "You do not have permission to edit this incident." },
        {},
      );
    };

    const { onChanged } = renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-use"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "You do not have permission to edit this incident.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("use-call-root-cause")).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("an incident with no root cause yet has nothing to replace", async () => {
    currentRootCause = "";

    renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-use"));

    await waitFor(() => {
      expect(ModelAPI.getItem).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("use-call-root-cause-current")).toBeNull();
  });

  test("Dismiss sets it aside as the person's decision", async () => {
    const { onChanged } = renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-dismiss"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(sentRequests()[0]!.data).toEqual({
      decision: RootCauseSuggestionStatus.Dismissed,
    });
  });

  test("a decision that could not be saved says so", async () => {
    postAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(500, { message: "The database is asleep." }, {});
    };

    renderSection([suggestedCall()]);

    fireEvent.click(screen.getByTestId("call-summary-dismiss"));

    const error: HTMLElement = await screen.findByTestId("call-summary-error");

    expect(error).toHaveTextContent("Could not save your decision");
    expect(error).toHaveTextContent("The database is asleep.");
  });

  test("without permission to edit the root cause there is no Use; without permission to work on calls, no Dismiss", () => {
    canEditRootCause = false;

    renderSection([suggestedCall()]);

    expect(screen.queryByTestId("call-summary-use")).toBeNull();
    expect(screen.getByTestId("call-summary-dismiss")).toBeVisible();

    cleanup();
    canEditRootCause = true;
    canWorkOnCalls = false;

    renderSection([suggestedCall()]);

    expect(screen.getByTestId("call-summary-use")).toBeVisible();
    expect(screen.queryByTestId("call-summary-dismiss")).toBeNull();
  });
});

describe("once a person decided", () => {
  test("used: says who used it and when, with the way to the root cause", () => {
    renderSection([
      suggestedCall({
        suggestion: RootCauseSuggestionStatus.Accepted,
        reviewedBy: "Jordan Patel",
      }),
    ]);

    expect(screen.getByTestId("call-summary-status")).toHaveTextContent(
      "Used as root cause",
    );
    expect(
      screen.getByText(/Jordan Patel used it as the incident's root cause/),
    ).toBeVisible();
    expect(
      screen.getByTestId("call-summary-root-cause-link").getAttribute("href"),
    ).toContain(`/incidents/${INCIDENT_ID}/root-cause`);
    expect(screen.queryByTestId("call-summary-use")).toBeNull();
    expect(screen.queryByTestId("call-summary-dismiss")).toBeNull();
  });

  test("dismissed: says so, and Undo puts the suggestion back", async () => {
    const { onChanged } = renderSection([
      suggestedCall({
        suggestion: RootCauseSuggestionStatus.Dismissed,
        reviewedBy: "Jordan Patel",
      }),
    ]);

    expect(screen.getByTestId("call-summary-status")).toHaveTextContent(
      "Dismissed",
    );
    expect(screen.getByText(/Jordan Patel dismissed it/)).toBeVisible();

    fireEvent.click(screen.getByTestId("call-summary-undo-dismiss"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(sentRequests()[0]!.data).toEqual({
      decision: RootCauseSuggestionStatus.Suggested,
    });
  });
});

describe("a call that did not settle the cause", () => {
  test("says not enough was said, suggests nothing, and opens what else the call said", () => {
    renderSection([suggestedCall({ summary: notEnoughSummary() })]);

    expect(screen.getByTestId("call-summary-not-enough")).toHaveTextContent(
      "Not enough was said on the call to suggest a root cause",
    );
    expect(screen.queryByTestId("call-summary-root-cause")).toBeNull();
    expect(screen.queryByTestId("call-summary-use")).toBeNull();

    const details: HTMLElement = screen.getByTestId("call-summary-details");

    expect(details).toHaveAttribute("open");
    expect(within(details).getByTestId("call-summary-questions")).toHaveTextContent(
      "What changed in checkout-api today?",
    );
  });
});

describe("everything else the call said", () => {
  test("is folded under the cause, findings marked confirmed on the call or a hypothesis", () => {
    renderSection([suggestedCall()]);

    const details: HTMLElement = screen.getByTestId("call-summary-details");

    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("5 more points from the call")).toBeVisible();

    const findings: HTMLElement = within(details).getByTestId(
      "call-summary-findings",
    );

    expect(findings).toHaveTextContent(
      "The orders database itself was healthy.Confirmed on the call00:00:31",
    );
    expect(findings).toHaveTextContent(
      "A cold cache may have added to the latency.Hypothesis",
    );
    expect(within(details).getByTestId("call-summary-actions")).toHaveTextContent(
      "Add an alert on pool usage. (Jordan Patel)",
    );
    expect(within(details).getByTestId("call-summary-steps")).toHaveTextContent(
      "Rolled checkout-api back to 2026.09.14-1.",
    );
    expect(within(details).getByTestId("call-summary-decisions")).toHaveTextContent(
      "Keep the rollback until the pool size is fixed.",
    );
    // An empty kind is left out.
    expect(within(details).queryByTestId("call-summary-questions")).toBeNull();
  });
});

describe("while it reads, and when it could not", () => {
  test("reading: says the suggestion appears here when it is done", () => {
    renderSection([
      transcriptCall({ info: TRANSCRIPT_INFO, status: CallSummaryStatus.Pending }),
    ]);

    expect(screen.getByTestId("call-summary-reading")).toHaveTextContent(
      "OneUptime AI is reading the transcript",
    );
  });

  test("failed: says why, and Try again reads it again", async () => {
    const { onChanged } = renderSection([
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Failed,
        statusMessage: "The AI provider refused the request.",
      }),
    ]);

    expect(screen.getByTestId("call-summary-failed")).toHaveTextContent(
      "OneUptime AI could not read the transcriptThe AI provider refused the request.",
    );

    fireEvent.click(screen.getByTestId("call-summary-read-again"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(sentRequests()[0]!.url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/call-summary`,
    );
  });

  test("stuck: says it took too long, with Try again", () => {
    renderSection([
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Pending,
        statusMinutesAgo: 30,
      }),
    ]);

    expect(screen.getByTestId("call-summary-failed")).toHaveTextContent(
      "Reading the transcript took too long",
    );
    expect(screen.getByTestId("call-summary-read-again")).toBeVisible();
  });

  test("a Try again that could not start says why", async () => {
    postAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "AI features are disabled for this project." },
        {},
      );
    };

    renderSection([
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Failed,
        statusMessage: "The AI provider refused the request.",
      }),
    ]);

    fireEvent.click(screen.getByTestId("call-summary-read-again"));

    const error: HTMLElement = await screen.findByTestId("call-summary-error");

    expect(error).toHaveTextContent("Could not start reading it again");
    expect(error).toHaveTextContent("AI features are disabled for this project.");
  });

  test("without permission to work on calls, there is no Try again", () => {
    canWorkOnCalls = false;

    renderSection([
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Failed,
        statusMessage: "The AI provider refused the request.",
      }),
    ]);

    expect(screen.getByTestId("call-summary-failed")).toBeVisible();
    expect(screen.queryByTestId("call-summary-read-again")).toBeNull();
  });
});
