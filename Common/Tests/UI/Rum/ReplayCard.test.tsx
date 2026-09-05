import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Watch what the user saw" on the exception page.
 *
 * correlation-1: the card used to pair the LATEST occurrence's time with
 * the NEWEST session that ever hit the fingerprint and promise "10s before
 * the error" for it. Now a moment is promised only for the occurrence's
 * own session, the link carries ?at=&signal=exc:&rail=errors through the
 * shared builder, and the request pins the session and passes the time.
 * correlation-8: the other sessions are listed with links, and the
 * server's truncation flag is shown. correlation-15: permission and plan
 * refusals render as a hint instead of an empty page.
 */

const postMock: MockFunction = getJestMockFunction();
const friendlyMessageMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>) => {
        return friendlyMessageMock(...args);
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
    },
  };
});

/* Imported after the mocks are registered so the component sees them. */
import ReplayCard, {
  REPLAY_CARD_PERMISSION_COPY,
  REPLAY_CARD_PLAN_COPY,
  REPLAY_CARD_SESSIONS_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCard";
import { REPLAY_EXCEPTION_PRE_ROLL_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_SESSION_ID: string = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const INSTANCE_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const FINGERPRINT: string = "fp-0123456789abcdef";
const SESSION_START: Date = new Date("2026-08-14T10:00:00.000Z");
const SESSION_END: Date = new Date("2026-08-14T10:10:00.000Z");
const ERROR_UNIX_MS: number = SESSION_START.getTime() + 5 * 60 * 1000;

function sessionRow(overrides?: Partial<JSONObject>): JSONObject {
  return {
    sessionId: SESSION_ID,
    rumApplicationId: APP_ID,
    startTime: SESSION_START.toISOString(),
    endTime: SESSION_END.toISOString(),
    durationMs: 10 * 60 * 1000,
    entryUrl: "https://shop.example.com/checkout",
    browserName: "Chrome",
    osName: "macOS",
    maskingMode: "MaskAllInputs",
    rageClickCount: 2,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    ...overrides,
  };
}

function okResponse(
  sessions: Array<JSONObject>,
  isApplicationScopeTruncated: boolean = false,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { sessions: sessions, isApplicationScopeTruncated },
    {},
  );
}

function httpError(statusCode: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
}

function renderCard(
  props: Partial<React.ComponentProps<typeof ReplayCard>> = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ReplayCard
        fingerprint={FINGERPRINT}
        sessionId={SESSION_ID}
        exceptionInstanceId={INSTANCE_ID}
        errorTimeUnixMs={ERROR_UNIX_MS}
        {...props}
      />
    </MemoryRouter>,
  );
}

function hrefParams(anchor: HTMLElement): URLSearchParams {
  const href: string | null = anchor.getAttribute("href");

  expect(href).not.toBeNull();

  return new URL(`https://example.com${href}`).searchParams;
}

beforeEach(() => {
  postMock.mockReset();
  friendlyMessageMock.mockReset();
  friendlyMessageMock.mockImplementation((error: unknown): string => {
    return error instanceof HTTPErrorResponse ? error.message : String(error);
  });
});

describe("ReplayCard request", () => {
  it("pins the occurrence's session and passes the error time so the server derives the window", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard();

    await screen.findByTestId("replay-card");

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: { data: JSONObject } = postMock.mock.calls[0]![0] as {
      data: JSONObject;
    };

    expect(request.data).toEqual({
      fingerprint: FINGERPRINT,
      sessionId: SESSION_ID,
      errorTimeUnixMs: ERROR_UNIX_MS,
    });
  });

  it("stays quiet without a fingerprint and never calls the endpoint", async () => {
    const { container } = renderCard({ fingerprint: undefined });

    await waitFor(() => {
      expect(container.querySelector("[data-testid]")).toBeNull();
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});

describe("ReplayCard moment (correlation-1)", () => {
  it("links 10s before the occurrence with the exc: signal and the errors rail when the session is the occurrence's own", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard();

    const label: HTMLElement = await screen.findByTestId("replay-card-watch");

    expect(label).toHaveTextContent("Watch 10s before the error");

    const params: URLSearchParams = hrefParams(label.closest("a")!);

    expect(label.closest("a")!.getAttribute("href")).toContain(
      `/rum/${APP_ID}/session-replay/${SESSION_ID}`,
    );
    expect(params.get("at")).toBe(
      String(ERROR_UNIX_MS - REPLAY_EXCEPTION_PRE_ROLL_MS),
    );
    expect(params.get("signal")).toBe(`exc:${INSTANCE_ID}`);
    expect(params.get("rail")).toBe("errors");
    expect(params.get("t")).toBeNull();
    expect(screen.queryByTestId("replay-card-moment-note")).toBeNull();
  });

  it("never pairs the occurrence's time with a different session: no ?at=, no signal, and says why", async () => {
    postMock.mockResolvedValue(
      okResponse([sessionRow({ sessionId: OTHER_SESSION_ID })]),
    );

    renderCard();

    const label: HTMLElement = await screen.findByTestId("replay-card-watch");

    expect(label).toHaveTextContent("Watch session");

    const params: URLSearchParams = hrefParams(label.closest("a")!);

    expect(params.get("at")).toBeNull();
    expect(params.get("signal")).toBeNull();
    expect(params.get("rail")).toBe("errors");
    expect(screen.getByTestId("replay-card-moment-note")).toHaveTextContent(
      "not recorded",
    );
  });

  it("does not promise a moment when the occurrence falls outside its own recording", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard({ errorTimeUnixMs: SESSION_END.getTime() + 60 * 60 * 1000 });

    const label: HTMLElement = await screen.findByTestId("replay-card-watch");

    expect(label).toHaveTextContent("Watch session");
    expect(hrefParams(label.closest("a")!).get("at")).toBeNull();
    expect(screen.getByTestId("replay-card-moment-note")).toHaveTextContent(
      "outside this recording",
    );
  });

  it("falls back to an unpinned search when the occurrence's session was never recorded, and still promises no moment", async () => {
    /*
     * The pin is strict on the server: a session that was sampled out
     * answers with nothing. The card asks once more without the pin so a
     * recording of the same error is still offered - from the beginning.
     */
    postMock
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValueOnce(
        okResponse([sessionRow({ sessionId: OTHER_SESSION_ID })]),
      );

    renderCard();

    const label: HTMLElement = await screen.findByTestId("replay-card-watch");

    expect(postMock).toHaveBeenCalledTimes(2);

    const firstRequest: { data: JSONObject } = postMock.mock.calls[0]![0] as {
      data: JSONObject;
    };
    const secondRequest: { data: JSONObject } = postMock.mock.calls[1]![0] as {
      data: JSONObject;
    };

    expect(firstRequest.data["sessionId"]).toBe(SESSION_ID);
    expect(secondRequest.data["sessionId"]).toBeUndefined();
    expect(secondRequest.data["fingerprint"]).toBe(FINGERPRINT);

    expect(label).toHaveTextContent("Watch session");
    expect(hrefParams(label.closest("a")!).get("at")).toBeNull();
    expect(screen.getByTestId("replay-card-moment-note")).toHaveTextContent(
      "not recorded",
    );
  });

  it("with only a fingerprint (no occurrence session) links the session without a moment", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard({ sessionId: undefined, exceptionInstanceId: undefined });

    const label: HTMLElement = await screen.findByTestId("replay-card-watch");

    expect(label).toHaveTextContent("Watch session");
    expect(hrefParams(label.closest("a")!).get("at")).toBeNull();
    expect(screen.getByTestId("replay-card-moment-note")).toHaveTextContent(
      "carries no session id",
    );
  });

  it("states the masking mode and the frustration signals before the click", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard();

    await screen.findByTestId("replay-card");

    expect(
      screen.getByText(/Recorded with MaskAllInputs masking/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Before the error: 2 rage clicks/),
    ).toBeInTheDocument();
  });
});

describe("ReplayCard other sessions and truncation (correlation-8)", () => {
  it("lists the other sessions with a Watch link each, folding the rest behind Show all", async () => {
    const others: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < REPLAY_CARD_SESSIONS_SHOWN + 2;
      index++
    ) {
      others.push(
        sessionRow({
          sessionId: `c${String(index).padStart(31, "0")}`,
          startTime: new Date(
            SESSION_START.getTime() - (index + 1) * 60 * 60 * 1000,
          ).toISOString(),
        }),
      );
    }

    postMock.mockResolvedValue(okResponse([sessionRow(), ...others]));

    renderCard();

    const list: HTMLElement = await screen.findByTestId(
      "replay-card-more-sessions",
    );

    expect(list).toHaveTextContent(
      `${others.length} more recorded sessions hit this error`,
    );
    expect(screen.getAllByTestId("replay-card-session-row")).toHaveLength(
      REPLAY_CARD_SESSIONS_SHOWN,
    );

    const firstRowLink: HTMLElement = screen
      .getAllByTestId("replay-card-session-row")[0]!
      .querySelector("a")!;

    expect(firstRowLink.getAttribute("href")).toContain(
      `/session-replay/${others[0]!["sessionId"]}`,
    );
    expect(hrefParams(firstRowLink).get("rail")).toBe("errors");
    expect(hrefParams(firstRowLink).get("at")).toBeNull();

    fireEvent.click(screen.getByTestId("replay-card-show-all"));

    expect(screen.getAllByTestId("replay-card-session-row")).toHaveLength(
      others.length,
    );
    expect(screen.queryByTestId("replay-card-show-all")).toBeNull();
  });

  it("uses the singular for exactly one other session", async () => {
    postMock.mockResolvedValue(
      okResponse([sessionRow(), sessionRow({ sessionId: OTHER_SESSION_ID })]),
    );

    renderCard();

    expect(
      await screen.findByTestId("replay-card-more-sessions"),
    ).toHaveTextContent("1 more recorded session hit this error");
  });

  it("surfaces the server's application-scope truncation flag", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()], true));

    renderCard();

    expect(
      await screen.findByTestId("replay-card-truncated"),
    ).toHaveTextContent("may be missing");
  });

  it("shows neither the list nor the truncation note when there is one untruncated session", async () => {
    postMock.mockResolvedValue(okResponse([sessionRow()]));

    renderCard();

    await screen.findByTestId("replay-card");

    expect(screen.queryByTestId("replay-card-more-sessions")).toBeNull();
    expect(screen.queryByTestId("replay-card-truncated")).toBeNull();
  });
});

describe("ReplayCard failures (correlation-15)", () => {
  it("renders a permission hint on 403 instead of nothing", async () => {
    postMock.mockResolvedValue(httpError(403, "Forbidden"));

    renderCard();

    const hint: HTMLElement = await screen.findByTestId("replay-card-hint");

    expect(hint).toHaveAttribute("data-failure-kind", "permission");
    expect(hint).toHaveTextContent(REPLAY_CARD_PERMISSION_COPY);
    expect(screen.queryByTestId("replay-card-retry")).toBeNull();
  });

  it("renders a plan hint on 402", async () => {
    postMock.mockResolvedValue(
      httpError(
        402,
        "Please upgrade your plan to Growth to access session replay.",
      ),
    );

    renderCard();

    const hint: HTMLElement = await screen.findByTestId("replay-card-hint");

    expect(hint).toHaveAttribute("data-failure-kind", "plan");
    expect(hint).toHaveTextContent(REPLAY_CARD_PLAN_COPY);
  });

  it("renders the friendly message with a Retry that refetches for any other failure", async () => {
    postMock.mockResolvedValueOnce(httpError(500, "ClickHouse is unavailable"));

    renderCard();

    const hint: HTMLElement = await screen.findByTestId("replay-card-hint");

    expect(hint).toHaveAttribute("data-failure-kind", "error");
    expect(hint).toHaveTextContent(
      "Could not check for a recording: ClickHouse is unavailable",
    );

    postMock.mockResolvedValueOnce(okResponse([sessionRow()]));

    fireEvent.click(screen.getByTestId("replay-card-retry"));

    expect(await screen.findByTestId("replay-card")).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when both the pinned and the unpinned search find no sessions", async () => {
    postMock.mockResolvedValue(okResponse([]));

    const { container } = renderCard();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(container.textContent).toBe("");
    });
    expect(screen.queryByTestId("replay-card-hint")).toBeNull();
  });

  it("searches only once when there is no occurrence session to pin", async () => {
    postMock.mockResolvedValue(okResponse([]));

    const { container } = renderCard({ sessionId: undefined });

    await waitFor(() => {
      expect(container.textContent).toBe("");
    });
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
