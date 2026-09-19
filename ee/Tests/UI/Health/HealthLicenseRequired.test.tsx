import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Headers from "Common/Types/API/Headers";
import { JSONObject } from "Common/Types/JSON";
import HealthLicenseRequired, {
  HEALTH_LICENSE_REQUIRED_DESCRIPTION,
  HEALTH_LICENSE_REQUIRED_TITLE,
  HealthRequestError,
  isHealthLicenseRequiredError,
  toHealthRequestError,
} from "../../../AdminDashboard/Health/HealthLicenseRequired";
import HealthOverview from "../../../AdminDashboard/Health/Overview";
import HealthQueues from "../../../AdminDashboard/Health/Queues";
import BackgroundQueues from "../../../AdminDashboard/Health/BackgroundQueues";
import ClickhouseCluster from "../../../AdminDashboard/Health/ClickhouseCluster";
import DiagnosticLogs from "../../../AdminDashboard/Health/DiagnosticLogs";
import PostgresCluster from "../../../AdminDashboard/Health/PostgresCluster";
import QueryConsole from "../../../AdminDashboard/Health/QueryConsole";
import RedisHealth from "../../../AdminDashboard/Health/RedisHealth";
import TelemetryIngestionByProject from "../../../AdminDashboard/Health/TelemetryIngestionByProject";
import TelemetryIngestionBySignal from "../../../AdminDashboard/Health/TelemetryIngestionBySignal";

/*
 * What the OneUptime Health screens show when the Health API answers 402.
 *
 * On an Enterprise install whose license lapses (or never covered instance
 * health), every Health route answers 402 with the server's generic license
 * message, which talks about enterprise "configuration". The screens replace
 * it with their own license-required notice - what is locked, where to
 * activate the license, what keeps working - instead of showing the raw error
 * above empty cards. Any other failure still shows the server's message.
 *
 * On OneUptime Cloud (billing on) the license never locks these screens; the
 * only 402 there is the query console's Cloud refusal, which keeps its own
 * message.
 *
 * The Health API is answered per test. Billing is pinned in every test: CI's
 * config.env sets BILLING_ENABLED=true.
 */

let mockBillingEnabled: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

const mockApiGet: jest.Mock = jest.fn();
const mockApiPost: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  const ErrorResponse: typeof import("Common/Types/API/HTTPErrorResponse").default =
    (
      jest.requireActual("Common/Types/API/HTTPErrorResponse") as {
        default: typeof import("Common/Types/API/HTTPErrorResponse").default;
      }
    ).default;

  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockApiGet(...args);
      },
      post: (...args: Array<unknown>): unknown => {
        return mockApiPost(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof ErrorResponse ? err.message : String(err);
      },
    },
  };
});

// Monaco cannot run in jsdom: the console's editor becomes a plain textarea.
jest.mock("Common/UI/Components/CodeEditor/CodeEditor", () => {
  const react: typeof import("react") = jest.requireActual(
    "react",
  ) as typeof import("react");

  return {
    __esModule: true,
    default: (props: {
      value?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      return react.createElement("textarea", {
        "data-testid": "code-editor",
        value: props.value || "",
        onChange: (event: { target: { value: string } }): void => {
          props.onChange?.(event.target.value);
        },
      });
    },
  };
});

// The server's generic license message, which the screens must not show raw.
const SERVER_LICENSE_MESSAGE: string =
  "This OneUptime Enterprise feature needs a valid Enterprise license that includes it. Enterprise configuration you already have keeps working.";

const SERVER_ERROR_MESSAGE: string = "ClickHouse did not answer in time.";

const CLOUD_CONSOLE_MESSAGE: string =
  "The OneUptime Health query console is not available on OneUptime Cloud.";

const NOTICE_TEST_ID: string = "health-license-required";

const errorResponse: (
  statusCode: number,
  message: string,
) => HTTPErrorResponse = (
  statusCode: number,
  message: string,
): HTTPErrorResponse => {
  const body: JSONObject = { message };
  const headers: Headers = {};

  return new HTTPErrorResponse(statusCode, body, headers);
};

const answerEveryRequestWith: (response: HTTPErrorResponse) => void = (
  response: HTTPErrorResponse,
): void => {
  mockApiGet.mockResolvedValue(response);
  mockApiPost.mockResolvedValue(response);
};

const renderScreen: (Screen: FunctionComponent) => void = (
  Screen: FunctionComponent,
): void => {
  render(
    <MemoryRouter>
      <Screen />
    </MemoryRouter>,
  );
};

/*
 * The screens that ask the Health API as soon as they mount, and a piece of
 * their own content that must not render on a license error.
 */
const SCREENS_THAT_LOAD_ON_MOUNT: Array<{
  name: string;
  Screen: FunctionComponent;
  apiPath: string;
  content: string;
}> = [
  {
    name: "Overview",
    Screen: HealthOverview,
    apiPath: "/admin/health/overview",
    content: "Cluster health",
  },
  {
    name: "Queues",
    Screen: HealthQueues,
    apiPath: "/admin/health/queues",
    content: "Background queues",
  },
  {
    name: "ClickhouseCluster",
    Screen: ClickhouseCluster,
    apiPath: "/admin/health/clickhouse-cluster",
    content: "ClickHouse cluster",
  },
  {
    name: "PostgresCluster",
    Screen: PostgresCluster,
    apiPath: "/admin/health/postgres-cluster",
    content: "PostgreSQL cluster",
  },
  {
    name: "RedisHealth",
    Screen: RedisHealth,
    apiPath: "/admin/health/redis",
    content: "Valkey capacity",
  },
  {
    name: "TelemetryIngestionBySignal",
    Screen: TelemetryIngestionBySignal,
    apiPath: "/admin/health/clickhouse-telemetry-ingestion",
    content: "Telemetry ingestion rate",
  },
  {
    name: "TelemetryIngestionByProject",
    Screen: TelemetryIngestionByProject,
    apiPath: "/admin/health/clickhouse-telemetry-ingestion-by-project",
    content: "Ingestion by project",
  },
];

beforeEach(() => {
  mockBillingEnabled = false;
  mockApiGet.mockReset();
  mockApiPost.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("isHealthLicenseRequiredError", () => {
  test("a 402 from the Health API is the license", () => {
    expect(
      isHealthLicenseRequiredError(errorResponse(402, SERVER_LICENSE_MESSAGE)),
    ).toBe(true);
  });

  test.each([400, 401, 403, 404, 500, 502])(
    "a %s is not the license",
    (statusCode: number) => {
      expect(
        isHealthLicenseRequiredError(errorResponse(statusCode, "no")),
      ).toBe(false);
    },
  );

  test("an error that is not an HTTP response is not the license", () => {
    expect(isHealthLicenseRequiredError(new Error("402"))).toBe(false);
    expect(isHealthLicenseRequiredError("402")).toBe(false);
    expect(isHealthLicenseRequiredError(null)).toBe(false);
  });

  test("on OneUptime Cloud a 402 is never the license", () => {
    mockBillingEnabled = true;

    expect(
      isHealthLicenseRequiredError(errorResponse(402, CLOUD_CONSOLE_MESSAGE)),
    ).toBe(false);
  });
});

describe("toHealthRequestError", () => {
  test("keeps the server's message and flags the license", () => {
    const licenseError: HealthRequestError = toHealthRequestError(
      errorResponse(402, SERVER_LICENSE_MESSAGE),
    );
    const otherError: HealthRequestError = toHealthRequestError(
      errorResponse(500, SERVER_ERROR_MESSAGE),
    );

    expect(licenseError).toEqual({
      isLicenseRequired: true,
      message: SERVER_LICENSE_MESSAGE,
    });
    expect(otherError).toEqual({
      isLicenseRequired: false,
      message: SERVER_ERROR_MESSAGE,
    });
  });
});

describe("HealthLicenseRequired", () => {
  test("says the license is required, where to activate it and what keeps working", () => {
    render(<HealthLicenseRequired />);

    const notice: HTMLElement = screen.getByTestId(NOTICE_TEST_ID);

    expect(notice).toHaveTextContent(HEALTH_LICENSE_REQUIRED_TITLE);
    expect(notice).toHaveTextContent(HEALTH_LICENSE_REQUIRED_DESCRIPTION);
    expect(HEALTH_LICENSE_REQUIRED_TITLE).toContain(
      "Enterprise license required",
    );
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain("instance health");
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain(
      "Enterprise Edition badge",
    );
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain("keep working");
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain("Support Bundle");
  });

  /*
   * A missing or expired license stops more than these screens: single
   * sign-on, SCIM and audit logging stop with it. The admin looking at this
   * notice is the one who can fix that, so it says so - and "keep working"
   * above is only about the screens that need no license.
   */
  test("says that single sign-on, SCIM and audit logging are off too, and come back with a license", () => {
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain(
      "While the license is missing or expired, single sign-on, SCIM provisioning and audit logging are off too",
    );
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).toContain(
      "as soon as a license is activated",
    );
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).not.toMatch(
      /(?:SSO|single sign-on|SCIM|audit logging)[^.]*keeps? working/i,
    );
  });

  // The server's message is about enterprise configuration; this one is not.
  test("does not talk about configuration", () => {
    expect(HEALTH_LICENSE_REQUIRED_DESCRIPTION).not.toContain("configuration");
    expect(HEALTH_LICENSE_REQUIRED_TITLE).not.toContain("configuration");
  });
});

describe("the Health screens that load on mount", () => {
  test.each(SCREENS_THAT_LOAD_ON_MOUNT)(
    "$name shows the license notice, not the raw message or empty cards, on a 402",
    async (entry: {
      name: string;
      Screen: FunctionComponent;
      apiPath: string;
      content: string;
    }) => {
      answerEveryRequestWith(errorResponse(402, SERVER_LICENSE_MESSAGE));

      renderScreen(entry.Screen);

      expect(await screen.findByTestId(NOTICE_TEST_ID)).toBeInTheDocument();
      expect(
        screen.queryByText(SERVER_LICENSE_MESSAGE),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(entry.content)).not.toBeInTheDocument();
      expect(String(mockApiGet.mock.calls[0]?.[0]?.url)).toContain(
        entry.apiPath,
      );
    },
  );

  // Negative control: any other failure keeps the server's own message.
  test.each(SCREENS_THAT_LOAD_ON_MOUNT)(
    "$name still shows the server's message, and no license notice, on a 500",
    async (entry: {
      name: string;
      Screen: FunctionComponent;
      apiPath: string;
      content: string;
    }) => {
      answerEveryRequestWith(errorResponse(500, SERVER_ERROR_MESSAGE));

      renderScreen(entry.Screen);

      expect(
        (await screen.findAllByText(SERVER_ERROR_MESSAGE)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
    },
  );
});

describe("the Health screens that load on demand", () => {
  test("Diagnostic logs shows the license notice when loading answers 402", async () => {
    answerEveryRequestWith(errorResponse(402, SERVER_LICENSE_MESSAGE));

    renderScreen(DiagnosticLogs);
    fireEvent.click(screen.getByRole("button", { name: "Load logs" }));

    expect(await screen.findByTestId(NOTICE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByText(SERVER_LICENSE_MESSAGE)).not.toBeInTheDocument();
  });

  test("Diagnostic logs shows the server's message on a 500", async () => {
    answerEveryRequestWith(errorResponse(500, SERVER_ERROR_MESSAGE));

    renderScreen(DiagnosticLogs);
    fireEvent.click(screen.getByRole("button", { name: "Load logs" }));

    expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  const openFailedJobs: () => void = (): void => {
    render(
      <BackgroundQueues
        queues={[
          {
            name: "Worker",
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 2,
            delayed: 0,
            total: 2,
            error: false,
          },
        ]}
        isRefreshing={false}
        onRefresh={(): void => {
          return undefined;
        }}
      />,
    );
    fireEvent.click(screen.getByText("View failures"));
  };

  test("a queue's failed jobs show the license notice on a 402", async () => {
    answerEveryRequestWith(errorResponse(402, SERVER_LICENSE_MESSAGE));

    openFailedJobs();

    expect(await screen.findByTestId(NOTICE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByText(SERVER_LICENSE_MESSAGE)).not.toBeInTheDocument();
    expect(String(mockApiGet.mock.calls[0]?.[0]?.url)).toContain(
      "/admin/health/queues/Worker/failed-jobs",
    );
  });

  test("a queue's failed jobs show the server's message on a 500", async () => {
    answerEveryRequestWith(errorResponse(500, SERVER_ERROR_MESSAGE));

    openFailedJobs();

    expect(await screen.findByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
  });
});

describe("the query console", () => {
  const runQuery: () => void = (): void => {
    renderScreen(QueryConsole);
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "SELECT 1" },
    });
    fireEvent.click(screen.getByText("Run"));
  };

  test("shows the license notice when a self-hosted console answers 402", async () => {
    answerEveryRequestWith(errorResponse(402, SERVER_LICENSE_MESSAGE));

    runQuery();

    expect(await screen.findByTestId(NOTICE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByText("Query failed")).not.toBeInTheDocument();
    expect(screen.queryByText(SERVER_LICENSE_MESSAGE)).not.toBeInTheDocument();
    expect(String(mockApiPost.mock.calls[0]?.[0]?.url)).toContain(
      "/admin/health/query/postgres",
    );
  });

  test("keeps the Cloud refusal as its own message on OneUptime Cloud", async () => {
    mockBillingEnabled = true;
    answerEveryRequestWith(errorResponse(402, CLOUD_CONSOLE_MESSAGE));

    runQuery();

    expect(await screen.findByText(CLOUD_CONSOLE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText("Query failed")).toBeInTheDocument();
    expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  test("shows any other failure as a failed query", async () => {
    answerEveryRequestWith(errorResponse(500, SERVER_ERROR_MESSAGE));

    runQuery();

    await waitFor(() => {
      expect(screen.getByText(SERVER_ERROR_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(NOTICE_TEST_ID)).not.toBeInTheDocument();
  });
});
