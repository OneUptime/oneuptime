import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import WorkflowVariableTokenStatus, {
  RefreshAction,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariableTokenStatus";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  OAuth2GrantType,
  OAuth2TokenStatus,
  WorkflowVariableType,
} from "../../../Types/Workflow/WorkflowVariableOAuth";

/*
 * What an OAuth 2.0 variable's page says about its cached access token, and
 * the "Refresh now" button beside it.
 *
 * The access token itself is never readable, so the status is worked out from
 * the bookkeeping columns alone. These cases pin each status to the words a
 * person sees, because the words carry the meaning: "Expired" is the normal
 * resting state of an idle variable, not a failure, while "Refresh failed" is
 * the one state that needs somebody to act.
 *
 * Tooltips are tippy, portalled to document.body: hover the trigger and query
 * with `screen`, never the render container.
 */

const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const NOW: Date = new Date("2026-09-22T12:00:00.000Z");

const TOKEN_STATUS_TEST_ID: string = "workflow-variable-token-status";
const DETAIL_TEST_ID: string = "workflow-variable-token-status-detail";
const REFRESH_BUTTON_TEST_ID: string = "workflow-variable-refresh-token";

// Kept in step with MAX_ERROR_PREVIEW_LENGTH in the component.
const MAX_ERROR_PREVIEW_LENGTH: number = 160;

type OnClickMock = ReturnType<typeof jest.fn<() => void>>;

interface RenderedStatus {
  status: string | null;
  detail: string;
}

function oauthVariable(
  overrides?: Partial<Record<string, unknown>>,
): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = VARIABLE_ID.toString();
  variable.name = "API_TOKEN";
  variable.variableType = WorkflowVariableType.OAuth2;
  variable.oauthGrantType = OAuth2GrantType.ClientCredentials;

  for (const [key, value] of Object.entries(overrides || {})) {
    (variable as unknown as Record<string, unknown>)[key] = value;
  }

  return variable;
}

function formatDate(date: Date): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

function readStatus(): RenderedStatus {
  const element: HTMLElement = screen.getByTestId(TOKEN_STATUS_TEST_ID);
  const detail: HTMLElement | null = screen.queryByTestId(DETAIL_TEST_ID);

  return {
    status: element.getAttribute("data-status"),
    detail: detail?.textContent || "",
  };
}

function statusOf(values: Record<string, unknown>): RenderedStatus {
  render(
    <WorkflowVariableTokenStatus variable={oauthVariable(values)} now={NOW} />,
  );

  return readStatus();
}

// As the variable's page renders it: no `now`, so the current time.
function statusAtCurrentTime(values: Record<string, unknown>): RenderedStatus {
  render(<WorkflowVariableTokenStatus variable={oauthVariable(values)} />);

  return readStatus();
}

function renderWithRefresh(
  refreshAction: RefreshAction | undefined,
  values?: Record<string, unknown>,
): void {
  render(
    <WorkflowVariableTokenStatus
      variable={oauthVariable(values)}
      now={NOW}
      refreshAction={refreshAction}
    />,
  );
}

function refreshButton(): HTMLElement {
  return screen.getByTestId(REFRESH_BUTTON_TEST_ID);
}

function hoverPill(): void {
  fireEvent.mouseEnter(screen.getByTestId("pill"));
}

afterEach(() => {
  cleanup();
});

describe("WorkflowVariableTokenStatus", () => {
  test("a token nobody has fetched yet", () => {
    const result: RenderedStatus = statusOf({});

    expect(result.status).toBe(OAuth2TokenStatus.NotFetched);
    expect(result.detail).toBe("Fetched the first time a workflow uses it");
    expect(screen.getByText("Not fetched yet")).toBeInTheDocument();
  });

  test("a valid token says until when", () => {
    const expiresAt: Date = new Date("2026-09-22T12:30:00.000Z");

    const result: RenderedStatus = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
      oauthAccessTokenExpiresAt: expiresAt,
    });

    expect(result.status).toBe(OAuth2TokenStatus.Valid);
    expect(result.detail).toMatch(/^Valid until /);
    expect(result.detail).toBe(`Valid until ${formatDate(expiresAt)}`);
    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  // A variable fetched over the API keeps its dates as ISO strings.
  test("reads dates that arrive as strings", () => {
    const result: RenderedStatus = statusOf({
      oauthLastRefreshedAt: "2026-09-22T11:30:00.000Z",
      oauthAccessTokenExpiresAt: "2026-09-22T12:30:00.000Z",
    });

    expect(result.status).toBe(OAuth2TokenStatus.Valid);
    expect(result.detail).toBe(
      `Valid until ${formatDate(new Date("2026-09-22T12:30:00.000Z"))}`,
    );
  });

  // The normal resting state of an idle variable - not a failure.
  test("an expired token says it refreshes on its own", () => {
    const result: RenderedStatus = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T10:00:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T11:00:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.Expired);
    expect(result.detail).toBe(
      "Refreshes automatically the next time a workflow uses it",
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  test("a token that expires this very moment is expired", () => {
    const result: RenderedStatus = statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T11:00:00.000Z"),
      oauthAccessTokenExpiresAt: NOW,
    });

    expect(result.status).toBe(OAuth2TokenStatus.Expired);
  });

  test("a token with no reported expiry explains the per-run fetch", () => {
    const refreshedAt: Date = new Date("2026-09-22T11:59:00.000Z");

    const result: RenderedStatus = statusOf({
      oauthLastRefreshedAt: refreshedAt,
    });

    expect(result.status).toBe(OAuth2TokenStatus.NoExpiry);
    expect(result.detail).toContain("every run fetches a new one");
    expect(result.detail).toContain(`Fetched ${formatDate(refreshedAt)}.`);
    expect(result.detail).toContain("The provider did not say when it expires");
    expect(screen.getByText("No expiry reported")).toBeInTheDocument();
  });

  test("a failed refresh shows the reason, shortened, with the full text on hover", () => {
    const reason: string = `The token endpoint refused the request (HTTP 400): invalid_grant - ${"x".repeat(
      300,
    )}`;
    const failedAt: Date = new Date("2026-09-22T11:55:00.000Z");

    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: reason,
      oauthLastRefreshErrorAt: failedAt,
      oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(result.detail).toContain(
      "The token endpoint refused the request (HTTP 400): invalid_grant",
    );
    expect(result.detail.endsWith("…")).toBe(true);
    expect(result.detail.length).toBeLessThan(reason.length);
    expect(result.detail).toBe(
      `${formatDate(failedAt)}: ${reason.substring(
        0,
        MAX_ERROR_PREVIEW_LENGTH,
      )}…`,
    );
    expect(screen.getByText("Refresh failed")).toBeInTheDocument();

    // The shortened text is only a preview; hovering the pill shows it all.
    hoverPill();

    expect(screen.getByRole("tooltip")).toHaveTextContent(reason);
  });

  test("a short refresh error is shown whole, after when it happened", () => {
    const reason: string =
      "The token endpoint refused the request (HTTP 401): invalid_client.";
    const failedAt: Date = new Date("2026-09-22T11:55:00.000Z");

    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: reason,
      oauthLastRefreshErrorAt: failedAt,
    });

    expect(result.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(result.detail).toBe(`${formatDate(failedAt)}: ${reason}`);
    expect(result.detail.endsWith("…")).toBe(false);
  });

  test("an error exactly as long as the preview is not shortened", () => {
    const reason: string = "e".repeat(MAX_ERROR_PREVIEW_LENGTH);

    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: reason,
    });

    expect(result.detail).toBe(reason);
  });

  test("an error one character longer than the preview is shortened", () => {
    const reason: string = "e".repeat(MAX_ERROR_PREVIEW_LENGTH + 1);

    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: reason,
    });

    expect(result.detail).toBe(`${"e".repeat(MAX_ERROR_PREVIEW_LENGTH)}…`);
  });

  test("a refresh error with no time recorded is shown without one", () => {
    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: "invalid_client",
    });

    expect(result.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(result.detail).toBe("invalid_client");
  });

  /*
   * While the last attempt failed there is something to fix, even if an older
   * token has not expired yet.
   */
  test("a failed refresh wins over a still-valid token", () => {
    const result: RenderedStatus = statusOf({
      oauthLastRefreshError: "invalid_client",
      oauthLastRefreshErrorAt: new Date("2026-09-22T11:55:00.000Z"),
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T13:00:00.000Z"),
    });

    expect(result.status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(screen.queryByText("Valid")).not.toBeInTheDocument();
  });

  // Only a failure has more to say than the line under the pill.
  test("the pill has no tooltip unless a refresh failed", () => {
    statusOf({
      oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
      oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
    });

    hoverPill();

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // The page renders against the current time; `now` exists for tests.
  test("works against the current time when none is given", () => {
    const result: RenderedStatus = statusAtCurrentTime({
      oauthLastRefreshedAt: new Date(Date.now() - 60_000),
      oauthAccessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    });

    expect(result.status).toBe(OAuth2TokenStatus.Valid);

    cleanup();

    const expired: RenderedStatus = statusAtCurrentTime({
      oauthLastRefreshedAt: new Date(Date.now() - 7_200_000),
      oauthAccessTokenExpiresAt: new Date(Date.now() - 3_600_000),
    });

    expect(expired.status).toBe(OAuth2TokenStatus.Expired);
  });
});

describe("the Refresh now button", () => {
  // Absent when the viewer may not refresh, or that is not known yet.
  test("is not shown without a refresh action", () => {
    renderWithRefresh(undefined);

    expect(
      screen.queryByTestId(REFRESH_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh now")).not.toBeInTheDocument();
  });

  test("is not shown without a refresh action even after a failed refresh", () => {
    renderWithRefresh(undefined, {
      oauthLastRefreshError: "invalid_client",
    });

    expect(
      screen.queryByTestId(REFRESH_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test('is shown as "Refresh now" with a refresh action', () => {
    renderWithRefresh({
      onClick: (): void => {
        // not clicked here
      },
    });

    expect(refreshButton()).toBeInTheDocument();
    expect(refreshButton()).toHaveTextContent("Refresh now");
    expect(refreshButton()).toBeEnabled();
  });

  test("calls onClick when pressed", () => {
    const onClick: OnClickMock = jest.fn<() => void>();

    renderWithRefresh({ onClick });

    fireEvent.click(refreshButton());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("is offered whatever state the token is in", () => {
    const states: Array<Record<string, unknown>> = [
      {},
      {
        oauthLastRefreshedAt: new Date("2026-09-22T11:30:00.000Z"),
        oauthAccessTokenExpiresAt: new Date("2026-09-22T12:30:00.000Z"),
      },
      {
        oauthLastRefreshedAt: new Date("2026-09-22T10:00:00.000Z"),
        oauthAccessTokenExpiresAt: new Date("2026-09-22T11:00:00.000Z"),
      },
      { oauthLastRefreshedAt: new Date("2026-09-22T11:59:00.000Z") },
      { oauthLastRefreshError: "invalid_client" },
    ];

    for (const values of states) {
      const onClick: OnClickMock = jest.fn<() => void>();

      renderWithRefresh({ onClick }, values);

      fireEvent.click(refreshButton());

      expect(onClick).toHaveBeenCalledTimes(1);

      cleanup();
    }
  });

  /*
   * A viewer who may not update the variable sees the button locked, with the
   * reason on hover, rather than wondering where it went.
   */
  test("is disabled, with its tooltip, when the refresh action is disabled", () => {
    const onClick: OnClickMock = jest.fn<() => void>();

    renderWithRefresh({
      onClick,
      disabled: true,
      tooltip: "You do not have permission to update this Workflow Variable.",
    });

    expect(refreshButton()).toBeDisabled();
    expect(refreshButton()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(refreshButton());

    expect(onClick).not.toHaveBeenCalled();

    fireEvent.mouseEnter(
      screen.getByTestId(`${REFRESH_BUTTON_TEST_ID}-disabled-wrapper`),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to update this Workflow Variable.",
    );
  });

  test("is disabled without a tooltip when none is given", () => {
    renderWithRefresh({
      onClick: (): void => {
        // not reachable
      },
      disabled: true,
    });

    expect(refreshButton()).toBeDisabled();
    expect(
      screen.queryByTestId(`${REFRESH_BUTTON_TEST_ID}-disabled-wrapper`),
    ).not.toBeInTheDocument();
  });

  // A second press while the first request is in flight would send two.
  test("is disabled while the refresh is loading", () => {
    const onClick: OnClickMock = jest.fn<() => void>();

    renderWithRefresh({ onClick, isLoading: true });

    expect(refreshButton()).toBeDisabled();
    expect(refreshButton()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(refreshButton());

    expect(onClick).not.toHaveBeenCalled();
  });

  test("is enabled again once the refresh stops loading", () => {
    const onClick: OnClickMock = jest.fn<() => void>();
    const variable: WorkflowVariable = oauthVariable();

    const view: ReturnType<typeof render> = render(
      <WorkflowVariableTokenStatus
        variable={variable}
        now={NOW}
        refreshAction={{ onClick, isLoading: true }}
      />,
    );

    expect(refreshButton()).toBeDisabled();

    view.rerender(
      <WorkflowVariableTokenStatus
        variable={variable}
        now={NOW}
        refreshAction={{ onClick, isLoading: false }}
      />,
    );

    expect(refreshButton()).toBeEnabled();

    fireEvent.click(refreshButton());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("shows its tooltip on hover when enabled", () => {
    renderWithRefresh({
      onClick: (): void => {
        // not clicked here
      },
      tooltip: "Fetch a new access token now",
    });

    expect(refreshButton()).toBeEnabled();

    fireEvent.mouseEnter(refreshButton());

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Fetch a new access token now",
    );
  });

  // The button sits under the status, not in place of it.
  test("leaves the status and its detail on screen", () => {
    renderWithRefresh(
      {
        onClick: (): void => {
          // not clicked here
        },
      },
      { oauthLastRefreshError: "invalid_client" },
    );

    expect(readStatus().status).toBe(OAuth2TokenStatus.RefreshFailed);
    expect(readStatus().detail).toBe("invalid_client");
    expect(refreshButton()).toBeInTheDocument();
  });
});
