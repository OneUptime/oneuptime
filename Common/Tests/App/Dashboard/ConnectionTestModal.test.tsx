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
import ConnectionTestModal, {
  CONNECTION_TEST_PROGRESS_MESSAGE,
  InlineConnectionTest,
  runConnectionTestRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectionTestModal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID: string = "11111111-1111-4111-8111-111111111111";

function report(
  overrides: Partial<SecurityConnectorTestReport> = {},
): SecurityConnectorTestReport {
  return {
    provider: "elastic-security",
    status: "pass",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:01.000Z",
    durationMs: 1000,
    summary: "Elastic Security is reachable and OneUptime workers are running.",
    checks: [
      {
        key: "authentication",
        name: "Authenticate with Kibana",
        status: "pass",
        durationMs: 300,
        message: "The API key was accepted.",
      },
      {
        key: "worker-consumers",
        name: "Background workers",
        status: "pass",
        durationMs: 5,
        message: "1 process consuming the Worker queue.",
      },
    ],
    ...overrides,
  };
}

/*
 * A test that resolves only when the test says so, so the progress state
 * can be observed instead of raced.
 */
function deferred(): {
  promise: Promise<SecurityConnectorTestReport>;
  resolve: (value: SecurityConnectorTestReport) => void;
  reject: (reason: unknown) => void;
} {
  let resolve: (value: SecurityConnectorTestReport) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<SecurityConnectorTestReport> = new Promise(
    (
      innerResolve: (value: SecurityConnectorTestReport) => void,
      innerReject: (reason: unknown) => void,
    ): void => {
      resolve = innerResolve;
      reject = innerReject;
    },
  );
  return { promise, resolve, reject };
}

describe("ConnectionTestModal", () => {
  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("runs the test as soon as it opens, shows progress, then the report", async (): Promise<void> => {
    const pending: ReturnType<typeof deferred> = deferred();
    const runTest: ReturnType<
      typeof jest.fn<() => Promise<SecurityConnectorTestReport>>
    > = jest.fn<() => Promise<SecurityConnectorTestReport>>(() => {
      return pending.promise;
    });

    render(
      <ConnectionTestModal
        title="Test connection: Elastic"
        providerTitle="Elastic Security"
        runTest={runTest}
        onClose={(): void => {}}
      />,
    );

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Test connection: Elastic",
    });
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      CONNECTION_TEST_PROGRESS_MESSAGE,
    );
    expect(
      within(dialog).getByRole("button", { name: "Run again" }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("region", { name: "Connection test report" }),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      pending.resolve(report());
    });

    expect(
      within(dialog).getByRole("region", { name: "Connection test report" }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("All checks passed");
    expect(dialog).toHaveTextContent("Access to Elastic Security");
    expect(
      within(dialog).queryByText(CONNECTION_TEST_PROGRESS_MESSAGE),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Run again" }),
    ).toBeEnabled();
    expect(dialog).toHaveTextContent("Nothing is imported.");
  });

  test("Run again re-runs the supplied test and replaces the report", async (): Promise<void> => {
    const runTest: ReturnType<
      typeof jest.fn<() => Promise<SecurityConnectorTestReport>>
    > = jest
      .fn<() => Promise<SecurityConnectorTestReport>>()
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(
        report({
          status: "fail",
          summary: "The API key was rejected.",
          checks: [
            {
              key: "authentication",
              name: "Authenticate with Kibana",
              status: "fail",
              durationMs: 200,
              message: "Kibana answered HTTP 401.",
              remediation: "Create a new API key with read access to alerts.",
            },
          ],
        }),
      );

    render(
      <ConnectionTestModal
        title="Test connection"
        runTest={runTest}
        onClose={(): void => {}}
      />,
    );

    expect(await screen.findByText("All checks passed")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));

    expect(await screen.findByText("Some checks failed")).toBeVisible();
    expect(runTest).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("All checks passed")).not.toBeInTheDocument();
    expect(screen.getByText("Kibana answered HTTP 401.")).toBeVisible();
    // A failing check opens its remediation without another click.
    expect(
      screen.getByText("Create a new API key with read access to alerts."),
    ).toBeVisible();
  });

  test("a failed request shows the friendly message and keeps Run again available", async (): Promise<void> => {
    const runTest: ReturnType<
      typeof jest.fn<() => Promise<SecurityConnectorTestReport>>
    > = jest
      .fn<() => Promise<SecurityConnectorTestReport>>()
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          403,
          {
            message:
              "Project owners, project administrators, and security administrators can run connection diagnostics.",
          },
          {},
        ),
      )
      .mockResolvedValueOnce(report());

    render(
      <ConnectionTestModal
        title="Test connection"
        runTest={runTest}
        onClose={(): void => {}}
      />,
    );

    expect(
      await screen.findByText(
        /security administrators can run connection diagnostics/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Connection test report" }),
    ).not.toBeInTheDocument();

    const runAgain: HTMLElement = screen.getByRole("button", {
      name: "Run again",
    });
    expect(runAgain).toBeEnabled();
    fireEvent.click(runAgain);

    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(
      screen.queryByText(/can run connection diagnostics/),
    ).not.toBeInTheDocument();
  });

  test("Close calls onClose and a late result after unmount is ignored", async (): Promise<void> => {
    const pending: ReturnType<typeof deferred> = deferred();
    const onClose: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    const view: ReturnType<typeof render> = render(
      <ConnectionTestModal
        title="Test connection"
        runTest={(): Promise<SecurityConnectorTestReport> => {
          return pending.promise;
        }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async (): Promise<void> => {
      pending.resolve(report());
    });

    // No "state update on an unmounted component" complaint.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("InlineConnectionTest", () => {
  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("waits for the button, then renders the report with Run again inline", async (): Promise<void> => {
    const runTest: ReturnType<
      typeof jest.fn<() => Promise<SecurityConnectorTestReport>>
    > = jest
      .fn<() => Promise<SecurityConnectorTestReport>>()
      .mockResolvedValue(report());

    render(
      <InlineConnectionTest
        providerTitle="Elastic Security"
        runTest={runTest}
      />,
    );

    expect(runTest).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Test these settings" }),
    );
    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(runTest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor((): void => {
      expect(runTest).toHaveBeenCalledTimes(2);
    });
  });

  test("a disabled reason locks the button and says why", (): void => {
    const runTest: ReturnType<
      typeof jest.fn<() => Promise<SecurityConnectorTestReport>>
    > = jest.fn<() => Promise<SecurityConnectorTestReport>>();

    render(
      <InlineConnectionTest
        providerTitle="Google SecOps"
        runTest={runTest}
        disabledReason="Paste the Service Account JSON first."
      />,
    );

    expect(
      screen.getByRole("button", { name: "Test these settings" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Paste the Service Account JSON first."),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Test these settings" }),
    );
    expect(runTest).not.toHaveBeenCalled();
  });

  test("a synchronous throw from the body builder is shown, not swallowed", async (): Promise<void> => {
    render(
      <InlineConnectionTest
        providerTitle="Google SecOps"
        runTest={(): Promise<SecurityConnectorTestReport> => {
          throw new Error("Paste the Service Account JSON to test.");
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Test these settings" }),
    );
    expect(
      await screen.findByText("Paste the Service Account JSON to test."),
    ).toBeVisible();
  });
});

describe("runConnectionTestRequest", () => {
  beforeEach((): void => {
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ "project-id": PROJECT_ID });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("posts the body to the route under the API URL with the tenant headers", async (): Promise<void> => {
    const post: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(200, report() as unknown as JSONObject, {}),
      );

    const result: SecurityConnectorTestReport = await runConnectionTestRequest({
      route: "/security-event-connection/test",
      body: { connectionId: CONNECTION_ID },
    });

    expect(result.status).toBe("pass");
    expect(post).toHaveBeenCalledTimes(1);
    const call: JSONObject = post.mock.calls[0]?.[0] as JSONObject;
    expect(call["data"]).toEqual({ connectionId: CONNECTION_ID });
    expect(call["headers"]).toEqual({ "project-id": PROJECT_ID });
    const destination: globalThis.URL = new globalThis.URL(String(call["url"]));
    expect(destination.pathname).toMatch(/\/security-event-connection\/test$/);
    // Secrets and ids travel in the body, never in the query string.
    expect(Array.from(destination.searchParams.keys()).sort()).toEqual([]);
  });

  test("throws the HTTP error response so the caller can show its message", async (): Promise<void> => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "Configuration: orgUrl must be an https URL." },
      {},
    );
    jest.spyOn(API, "post").mockResolvedValue(failure);

    await expect(
      runConnectionTestRequest({
        route: "/security-event-connection/test",
        body: { provider: "okta", config: {}, secrets: {} },
      }),
    ).rejects.toBe(failure);
    expect(API.getFriendlyErrorMessage(failure)).toBe(
      "Configuration: orgUrl must be an https URL.",
    );
  });

  test.each([
    ["an empty body", {}],
    ["a body without checks", { status: "pass" }],
    ["a body without a status", { checks: [] }],
  ])(
    "rejects %s as a missing report",
    async (_label: string, body: JSONObject): Promise<void> => {
      jest
        .spyOn(API, "post")
        .mockResolvedValue(new HTTPResponse(200, body, {}));

      await expect(
        runConnectionTestRequest({
          route: "/google-secops-connection/test",
          body: { connectionId: CONNECTION_ID },
        }),
      ).rejects.toThrow("The server did not return a test report");
    },
  );
});
