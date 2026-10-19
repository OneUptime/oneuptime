import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * A SCIM connection's OAuth 2.0 client credentials, in the dialog with its
 * SCIM URLs (Dashboard/Identity/Components/ScimOAuthClientCredentials).
 *
 * What the identity provider is configured with - the token endpoint, the
 * client ID, and a client secret the server makes and the screen shows once
 * - and the two requests behind it: make a secret, which keeps the one
 * before working until it expires or is deleted, and delete that previous
 * one. Requests go through API.fetch, answered per test.
 */

const mockFetch: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "You do not have permission to change this connection.";
      },
    },
  };
});

import ScimOAuthClientCredentials, {
  getScimTokenEndpoint,
} from "../../../Dashboard/Identity/Components/ScimOAuthClientCredentials";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { IDENTITY_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";

const CONNECTION_ID: string = "62000000-0000-4000-8000-000000000001";
const SECRET: string = "a".repeat(64);
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

interface FetchRequest {
  method: HTTPMethod;
  url: { toString: () => string };
  headers?: Record<string, string>;
}

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function requestAt(index: number): FetchRequest {
  return mockFetch.mock.calls[index]![0] as FetchRequest;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("what the identity provider is configured with", () => {
  test("the token endpoint, and the connection's id as the client ID", () => {
    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        canChange={true}
      />,
    );

    expect(getScimTokenEndpoint()).toBe(
      `${IDENTITY_URL.toString()}/scim/oauth/token`,
    );
    expect(screen.getByText(getScimTokenEndpoint())).toBeInTheDocument();
    expect(screen.getByText(CONNECTION_ID)).toBeInTheDocument();
    expect(screen.getByText("None yet.")).toBeInTheDocument();
  });

  test("a secret that is set is never shown, only when it stops working", () => {
    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        clientSecretExpiresAt={new Date(Date.now() + 100 * DAY_IN_MS)}
        canChange={true}
      />,
    );

    expect(screen.getByText(/^Set\. It works until /)).toBeInTheDocument();
    expect(screen.queryByRole("hidden-text")).not.toBeInTheDocument();
    expect(screen.getByText("Make New Client Secret")).toBeInTheDocument();
  });

  test("an expired secret says so", () => {
    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        clientSecretExpiresAt={new Date(Date.now() - DAY_IN_MS).toISOString()}
        canChange={true}
      />,
    );

    expect(screen.getByText(/^Expired on /)).toBeInTheDocument();
    expect(screen.getByText("Make Client Secret")).toBeInTheDocument();
  });
});

describe("making a secret", () => {
  test("asks the server for one, and shows it once", async () => {
    const expiresAt: string = new Date(
      Date.now() + 365 * DAY_IN_MS,
    ).toISOString();
    mockFetch.mockResolvedValue(
      answer({
        clientId: CONNECTION_ID,
        clientSecret: SECRET,
        clientSecretExpiresAt: expiresAt,
        previousClientSecretExpiresAt: null,
      }),
    );
    const onChange: jest.Mock = jest.fn();

    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        canChange={true}
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Make Client Secret"));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestAt(0).method).toBe(HTTPMethod.POST);
    expect(requestAt(0).url.toString()).toMatch(
      new RegExp(`/project-scim/${CONNECTION_ID}/oauth-client-secret$`),
    );
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("hidden-text"));

    expect(screen.getByRole("revealed-text")).toHaveTextContent(SECRET);
    expect(
      screen.getByText(/Copy it now: OneUptime keeps only a hash of it/),
    ).toBeInTheDocument();
    expect(screen.getByText("Make New Client Secret")).toBeInTheDocument();
  });

  test("a status page connection's goes to its own route", async () => {
    mockFetch.mockResolvedValue(
      answer({
        clientSecret: SECRET,
        clientSecretExpiresAt: new Date(
          Date.now() + 365 * DAY_IN_MS,
        ).toISOString(),
      }),
    );

    render(
      <ScimOAuthClientCredentials
        connectionType="status-page"
        connectionId={CONNECTION_ID}
        canChange={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Make Client Secret"));
    });

    expect(requestAt(0).url.toString()).toMatch(
      new RegExp(`/status-page-scim/${CONNECTION_ID}/oauth-client-secret$`),
    );
  });

  test("a refused request shows why, and no secret", async () => {
    mockFetch.mockResolvedValue(
      new HTTPErrorResponse(422, { message: "Refused" }, {}),
    );
    const onChange: jest.Mock = jest.fn();

    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        canChange={true}
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Make Client Secret"));
    });

    expect(
      screen.getByText("You do not have permission to change this connection."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("hidden-text")).not.toBeInTheDocument();
    expect(screen.getByText("None yet.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("rotation", () => {
  test("the secret replaced keeps working until it is deleted here", async () => {
    const previousExpiresAt: Date = new Date(Date.now() + 100 * DAY_IN_MS);
    mockFetch
      .mockResolvedValueOnce(
        answer({
          clientSecret: SECRET,
          clientSecretExpiresAt: new Date(
            Date.now() + 365 * DAY_IN_MS,
          ).toISOString(),
          previousClientSecretExpiresAt: previousExpiresAt.toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        answer({
          clientId: CONNECTION_ID,
          previousClientSecretExpiresAt: null,
        }),
      );

    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        clientSecretExpiresAt={previousExpiresAt}
        canChange={true}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Make New Client Secret"));
    });

    expect(
      screen.getByTestId("scim-oauth-previous-client-secret"),
    ).toHaveTextContent(/keeps working until/);

    await act(async () => {
      fireEvent.click(screen.getByText("Delete Previous Secret"));
    });

    expect(requestAt(1).method).toBe(HTTPMethod.DELETE);
    expect(requestAt(1).url.toString()).toMatch(
      new RegExp(
        `/project-scim/${CONNECTION_ID}/oauth-client-secret/previous$`,
      ),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("scim-oauth-previous-client-secret"),
      ).not.toBeInTheDocument();
    });
  });

  test("an expired previous secret is not offered for deletion", () => {
    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        clientSecretExpiresAt={new Date(Date.now() + 100 * DAY_IN_MS)}
        previousClientSecretExpiresAt={new Date(Date.now() - DAY_IN_MS)}
        canChange={true}
      />,
    );

    expect(
      screen.queryByTestId("scim-oauth-previous-client-secret"),
    ).not.toBeInTheDocument();
  });
});

describe("when the caller may not change the secrets, or the license makes them read-only", () => {
  test("they see what is set, and nothing to press", () => {
    render(
      <ScimOAuthClientCredentials
        connectionType="project"
        connectionId={CONNECTION_ID}
        clientSecretExpiresAt={new Date(Date.now() + 100 * DAY_IN_MS)}
        previousClientSecretExpiresAt={new Date(Date.now() + DAY_IN_MS)}
        canChange={false}
      />,
    );

    expect(screen.getByText(CONNECTION_ID)).toBeInTheDocument();
    expect(
      screen.getByTestId("scim-oauth-previous-client-secret"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
