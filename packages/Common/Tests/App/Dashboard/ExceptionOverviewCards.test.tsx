import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ExceptionOccurrenceTrend from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceTrend";
import ExceptionLatestOccurrence from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionLatestOccurrence";
import ExceptionDetail from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionDetail";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";

type PostArgs = { url: { toString: () => string }; data: JSONObject };

const postMock: Mock<(args: PostArgs) => Promise<unknown>> =
  jest.fn<(args: PostArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: PostArgs): Promise<unknown> => {
        return postMock(args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? String((error.data as JSONObject)?.["message"])
          : "Failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const MINUTE: number = 60 * 1000;

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ExceptionOccurrenceTrend", () => {
  function bucketsFor(body: JSONObject): Array<JSONObject> {
    const start: number = new Date(body["startTime"] as string).getTime();
    return [
      {
        time: new Date(start + 60 * MINUTE).toISOString(),
        series: "unhandled",
        count: 7,
      },
      {
        time: new Date(start + 60 * MINUTE).toISOString(),
        series: "handled",
        count: 2,
      },
      {
        time: new Date(start + 180 * MINUTE).toISOString(),
        series: "unhandled",
        count: 3,
      },
    ];
  }

  test("requests this exception's histogram scoped to its service and totals it", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      return new HTTPResponse(200, { buckets: bucketsFor(args.data) }, {});
    });

    render(
      <ExceptionOccurrenceTrend
        fingerprint={FINGERPRINT}
        primaryEntityId={new ObjectID(SERVICE_ID)}
      />,
    );

    expect(
      await screen.findByText("12 occurrences in the last 24 hours"),
    ).toBeInTheDocument();

    const request: PostArgs = postMock.mock.calls[0]![0];
    expect(request.url.toString()).toContain("/telemetry/exceptions/histogram");
    expect(request.data).toMatchObject({
      fingerprints: [FINGERPRINT],
      serviceIds: [SERVICE_ID],
      bucketSizeInMinutes: 30,
    });

    const chart: HTMLElement = screen.getByTestId("exception-trend-chart");
    expect(chart).toHaveTextContent("Unhandled10");
    expect(chart).toHaveTextContent("Handled2");
    expect(chart).toHaveTextContent("Peak 9 at");
  });

  test("switching the window asks again with that window's bucket size", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      return new HTTPResponse(200, { buckets: bucketsFor(args.data) }, {});
    });

    render(<ExceptionOccurrenceTrend fingerprint={FINGERPRINT} />);
    await screen.findByText("12 occurrences in the last 24 hours");

    fireEvent.click(screen.getByTestId("exception-trend-window-7d"));

    expect(
      await screen.findByText("12 occurrences in the last 7 days"),
    ).toBeInTheDocument();
    expect(postMock.mock.calls[1]![0].data).toMatchObject({
      bucketSizeInMinutes: 240,
    });
    expect(postMock.mock.calls[1]![0].data).not.toHaveProperty("serviceIds");

    const firstWindowMs: number =
      new Date(postMock.mock.calls[1]![0].data["endTime"] as string).getTime() -
      new Date(
        postMock.mock.calls[1]![0].data["startTime"] as string,
      ).getTime();
    expect(firstWindowMs).toBe(7 * 24 * 60 * MINUTE);
    expect(screen.getByTestId("exception-trend-window-7d")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("an empty window says so and suggests a longer one", async () => {
    postMock.mockResolvedValue(new HTTPResponse(200, { buckets: [] }, {}));

    render(<ExceptionOccurrenceTrend fingerprint={FINGERPRINT} />);

    expect(
      await screen.findByTestId("exception-trend-empty"),
    ).toHaveTextContent("No occurrences in the last 24 hours");
  });

  test("a failed request shows an inline error instead of the chart", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "ClickHouse is down" }, {}),
    );

    render(<ExceptionOccurrenceTrend fingerprint={FINGERPRINT} />);

    expect(
      await screen.findByTestId("exception-trend-error"),
    ).toHaveTextContent("ClickHouse is down");
  });

  test("without a fingerprint it never queries an unscoped histogram", async () => {
    render(<ExceptionOccurrenceTrend fingerprint={undefined} />);

    expect(
      screen.getByText(
        "No fingerprint was recorded, so occurrences cannot be charted.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("exception-trend-window"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(postMock).not.toHaveBeenCalled();
    });
  });
});

describe("ExceptionLatestOccurrence", () => {
  function occurrence(values: Partial<ExceptionInstance>): ExceptionInstance {
    const instance: ExceptionInstance = new ExceptionInstance();
    Object.assign(instance, values);
    return instance;
  }

  test("summarizes the latest occurrence and links to its trace", () => {
    render(
      <MemoryRouter>
        <ExceptionLatestOccurrence
          isLoading={false}
          instance={occurrence({
            time: new Date(Date.now() - 4 * MINUTE),
            escaped: true,
            release: "checkout-api@2026.09.14",
            environment: "production",
            spanName: "POST /api/checkout",
            traceId: TRACE_ID,
            sessionId: "d".repeat(32),
          })}
          links={[
            {
              title: "View stack trace",
              to: new Route("/stack-trace"),
              icon: IconProp.Code,
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Captured 4 minutes ago.")).toBeInTheDocument();
    expect(
      screen.getByTestId("exception-latest-occurrence-handling"),
    ).toHaveTextContent("Unhandled");
    expect(
      screen.getByTestId("exception-latest-occurrence-release"),
    ).toHaveTextContent("checkout-api@2026.09.14");
    expect(
      screen.getByTestId("exception-latest-occurrence-environment"),
    ).toHaveTextContent("production");
    expect(
      screen.getByTestId("exception-latest-occurrence-span"),
    ).toHaveTextContent("POST /api/checkout");
    expect(
      within(screen.getByTestId("exception-latest-occurrence-trace")).getByRole(
        "link",
      ),
    ).toHaveAttribute("href", expect.stringContaining(TRACE_ID));
    expect(
      screen.getByTestId("exception-latest-occurrence-session"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View stack trace" }),
    ).toHaveAttribute("href", "/stack-trace");
  });

  test("says when an occurrence carried no trace and was handled", () => {
    render(
      <MemoryRouter>
        <ExceptionLatestOccurrence
          isLoading={false}
          instance={occurrence({ escaped: false, traceId: "" })}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("exception-latest-occurrence-handling"),
    ).toHaveTextContent("Handled");
    expect(
      screen.getByTestId("exception-latest-occurrence-trace"),
    ).toHaveTextContent("No trace was attached");
    expect(
      screen.queryByTestId("exception-latest-occurrence-session"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  test("shows an empty state when no occurrence is stored", () => {
    render(
      <MemoryRouter>
        <ExceptionLatestOccurrence isLoading={false} instance={undefined} />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("exception-latest-occurrence-empty"),
    ).toBeInTheDocument();
  });
});

describe("ExceptionDetail", () => {
  test("lists identity, service, releases and a copyable fingerprint", () => {
    const service: Service = new Service();
    service._id = SERVICE_ID;
    service.name = "checkout-api";
    service.serviceColor = new Color("#6366f1");

    render(
      <MemoryRouter>
        <ExceptionDetail
          exceptionType="InventoryReservationError"
          fingerprint={FINGERPRINT}
          firstSeenAt={new Date(Date.now() - 6 * 24 * 60 * MINUTE)}
          lastSeenAt={new Date(Date.now() - 4 * MINUTE)}
          firstSeenInRelease="checkout-api@2026.09.08"
          lastSeenInRelease="checkout-api@2026.09.14"
          environment="production"
          primaryEntityId={new ObjectID(SERVICE_ID)}
          primaryEntityType={ServiceType.OpenTelemetry}
          services={[service]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("exception-detail-type")).toHaveTextContent(
      "InventoryReservationError",
    );
    expect(screen.getByTestId("exception-detail-service")).toHaveTextContent(
      "checkout-api",
    );
    expect(screen.getByTestId("exception-detail-active-for")).toHaveTextContent(
      "6 days",
    );
    expect(screen.getByTestId("exception-detail-first-seen")).toHaveTextContent(
      "Introduced in checkout-api@2026.09.08",
    );
    expect(screen.getByTestId("exception-detail-last-seen")).toHaveTextContent(
      "Latest release checkout-api@2026.09.14",
    );
    expect(
      screen.getByTestId("exception-detail-fingerprint"),
    ).toHaveTextContent(FINGERPRINT);
    expect(
      screen.getByRole("button", { name: "Copy fingerprint" }),
    ).toBeInTheDocument();
  });

  test("marks every missing value as not recorded", () => {
    render(
      <MemoryRouter>
        <ExceptionDetail />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Not recorded")).toHaveLength(7);
    expect(
      screen.queryByRole("button", { name: "Copy fingerprint" }),
    ).not.toBeInTheDocument();
  });
});
