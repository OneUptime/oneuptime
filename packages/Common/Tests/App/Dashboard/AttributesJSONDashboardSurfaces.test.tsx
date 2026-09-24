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
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Copy JSON" and the List / JSON switch where the dashboard shows
 * attributes outside the trace page: the traces explorer's span panel, an
 * exception's breadcrumb events, and the latest occurrence's attributes on
 * the exception's Context page (which were not shown anywhere before).
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

import SpanDetailsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel";
import BreadcrumbTimeline, {
  BreadcrumbEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/BreadcrumbTimeline";
import ExceptionOccurrenceAttributes from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceAttributes";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Span from "../../../Models/AnalyticsModels/Span";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ATTRIBUTES_VIEW_PREFERENCE,
  resetPreferencesForTesting,
} from "../../../UI/Components/AttributesJSON/AttributesJSONPreferences";
import Clipboard from "../../../UI/Utils/Clipboard";

const copyMock: Mock<(text: string) => Promise<boolean>> =
  jest.fn<(text: string) => Promise<boolean>>();

function copied(index: number = 0): unknown {
  return JSON.parse(copyMock.mock.calls[index]![0]);
}

async function clickCopyJSON(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(control).getByRole("button", { name: "Copy JSON" }));
  });
}

async function chooseNested(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(control).getByRole("button", { name: "Choose JSON format" }),
    );
  });
  await act(async () => {
    fireEvent.click(
      within(control).getByRole("menuitemradio", { name: /Nested/ }),
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesForTesting();
  analyticsGetListMock.mockReset();
  apiPostMock.mockReset();
  apiPostMock.mockResolvedValue({ data: {} });
  copyMock.mockReset();
  copyMock.mockResolvedValue(true);
  jest
    .spyOn(Clipboard, "copyToClipboard")
    .mockImplementation(
      copyMock as unknown as typeof Clipboard.copyToClipboard,
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SpanDetailsPanel (traces explorer)", () => {
  const SPAN_ATTRIBUTES: JSONObject = {
    "http.request.method": "GET",
    "http.response.status_code": 404,
    "http.route": "/api/orders/:id",
    "url.scheme": "https",
    "user_agent.synthetic": false,
  };

  async function renderSpanPanel(
    attributes: JSONObject | undefined,
  ): Promise<void> {
    analyticsGetListMock.mockImplementation(async () => {
      return {
        data: [Object.assign(new Span(), { attributes, events: [] })],
        count: 1,
      };
    });

    const span: Span = new Span();
    span.name = "GET /api/orders/:id";
    span.spanId = "a1b2c3d4e5f60718";
    span.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    span.primaryEntityId = new ObjectID("60000000-0000-4000-8000-000000000001");

    await act(async () => {
      render(<SpanDetailsPanel span={span} />);
    });
  }

  test("copies the span's attributes as typed JSON", async () => {
    await renderSpanPanel(SPAN_ATTRIBUTES);

    await clickCopyJSON(screen.getByTestId("span-attributes-copy-json"));

    expect(copied()).toEqual({
      "http.request.method": "GET",
      "http.response.status_code": 404,
      "http.route": "/api/orders/:id",
      "url.scheme": "https",
      "user_agent.synthetic": false,
    });
  });

  test("copies the nested shape from the format menu", async () => {
    await renderSpanPanel(SPAN_ATTRIBUTES);

    await chooseNested(screen.getByTestId("span-attributes-copy-json"));

    expect(copied()).toEqual({
      http: {
        request: { method: "GET" },
        response: { status_code: 404 },
        route: "/api/orders/:id",
      },
      url: { scheme: "https" },
      user_agent: { synthetic: false },
    });
  });

  test("switches the attributes between the list and JSON", async () => {
    await renderSpanPanel(SPAN_ATTRIBUTES);

    expect(screen.getByTitle("Copy http.route")).toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId(
      "span-attributes-view-toggle",
    );
    fireEvent.click(within(toggle).getByRole("button", { name: "JSON" }));

    expect(screen.getByTestId("span-attributes-json")).toHaveTextContent(
      '"http.response.status_code": 404',
    );
    expect(screen.queryByTitle("Copy http.route")).not.toBeInTheDocument();

    fireEvent.click(within(toggle).getByRole("button", { name: "List" }));
    expect(screen.getByTitle("Copy http.route")).toBeInTheDocument();
  });

  test("a span with no attributes shows the empty state and no JSON controls", async () => {
    await renderSpanPanel({});

    expect(screen.getByText("No attributes on this span.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("span-attributes-copy-json"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("span-attributes-view-toggle"),
    ).not.toBeInTheDocument();
  });
});

describe("BreadcrumbTimeline", () => {
  const EXCEPTION_TIME: Date = new Date(2026, 8, 14, 11, 56, 0, 0);

  function event(
    name: string,
    offsetMs: number,
    attributes: JSONObject,
  ): BreadcrumbEvent {
    const time: Date = new Date(EXCEPTION_TIME.getTime() + offsetMs);
    return { name, time, timeUnixNano: time.getTime() * 1000000, attributes };
  }

  const EVENTS: Array<BreadcrumbEvent> = [
    event("http.request", -880, {
      "http.method": "POST",
      "http.status_code": 500,
    }),
    event("exception", 0, {
      "exception.type": "InventoryReservationError",
      "exception.message": "Could not reserve stock",
      "exception.stacktrace": "at reserveInventory (inventory.ts:12:3)",
      "exception.escaped": true,
    }),
  ];

  function expand(index: number): HTMLElement {
    const row: HTMLElement = screen.getAllByTestId("breadcrumb-row")[index]!;
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    return row;
  }

  test("an expanded event copies its attributes as typed JSON", async () => {
    render(
      <BreadcrumbTimeline events={EVENTS} exceptionTime={EXCEPTION_TIME} />,
    );

    const row: HTMLElement = expand(0);
    await clickCopyJSON(
      within(row).getByTestId("breadcrumb-attributes-copy-json"),
    );

    expect(copied()).toEqual({
      "http.method": "POST",
      "http.status_code": 500,
    });
  });

  test("the copy carries the stack trace the list leaves out", async () => {
    render(
      <BreadcrumbTimeline events={EVENTS} exceptionTime={EXCEPTION_TIME} />,
    );

    const row: HTMLElement = expand(1);
    const list: HTMLElement = within(row).getByTestId("breadcrumb-attributes");
    expect(list).not.toHaveTextContent("exception.stacktrace");

    await clickCopyJSON(
      within(row).getByTestId("breadcrumb-attributes-copy-json"),
    );

    expect(copied()).toEqual({
      "exception.escaped": true,
      "exception.message": "Could not reserve stock",
      "exception.stacktrace": "at reserveInventory (inventory.ts:12:3)",
      "exception.type": "InventoryReservationError",
    });
  });

  test("copying does not fold the row", async () => {
    render(
      <BreadcrumbTimeline events={EVENTS} exceptionTime={EXCEPTION_TIME} />,
    );

    const row: HTMLElement = expand(0);
    const toggle: HTMLElement = within(row).getAllByRole("button")[0]!;

    await clickCopyJSON(
      within(row).getByTestId("breadcrumb-attributes-copy-json"),
    );

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).not.toContainElement(
      within(row).getByTestId("breadcrumb-attributes-copy-json"),
    );
  });
});

describe("ExceptionOccurrenceAttributes", () => {
  const OCCURRENCE_ATTRIBUTES: Record<string, unknown> = {
    "service.name": "inventory",
    "service.version": "2.14.0",
    "http.request.method": "POST",
    "http.response.status_code": 500,
    "process.pid": 4242,
    "feature_flag.new_checkout": true,
  };

  function occurrence(
    attributes: Record<string, unknown> | undefined,
  ): ExceptionInstance {
    const instance: ExceptionInstance = new ExceptionInstance();
    if (attributes) {
      instance.attributes = attributes;
    }
    return instance;
  }

  test("lists the latest occurrence's attributes", () => {
    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(OCCURRENCE_ATTRIBUTES)}
        isLoading={false}
      />,
    );

    const list: HTMLElement = screen.getByTestId(
      "exception-occurrence-attributes",
    );
    expect(within(list).getByText("service.version")).toBeInTheDocument();
    expect(within(list).getByText("2.14.0")).toBeInTheDocument();
    expect(
      within(list).getByText("feature_flag.new_checkout"),
    ).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(
      screen.getByText(
        "6 attributes recorded with the latest occurrence of this exception.",
      ),
    ).toBeInTheDocument();
  });

  test("copies them as typed JSON, flat or nested", async () => {
    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(OCCURRENCE_ATTRIBUTES)}
        isLoading={false}
      />,
    );

    const control: HTMLElement = screen.getByTestId(
      "exception-occurrence-attributes-copy-json",
    );
    await clickCopyJSON(control);
    await chooseNested(control);

    expect(copied(0)).toEqual({
      "feature_flag.new_checkout": true,
      "http.request.method": "POST",
      "http.response.status_code": 500,
      "process.pid": 4242,
      "service.name": "inventory",
      "service.version": "2.14.0",
    });
    expect(copied(1)).toEqual({
      feature_flag: { new_checkout: true },
      http: { request: { method: "POST" }, response: { status_code: 500 } },
      process: { pid: 4242 },
      service: { name: "inventory", version: "2.14.0" },
    });
  });

  test("shows them as JSON when asked, and remembers it", () => {
    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(OCCURRENCE_ATTRIBUTES)}
        isLoading={false}
      />,
    );

    fireEvent.click(
      within(
        screen.getByTestId("exception-occurrence-attributes-view-toggle"),
      ).getByRole("button", { name: "JSON" }),
    );

    expect(
      screen.getByTestId("exception-occurrence-attributes-json"),
    ).toHaveTextContent('"process.pid": 4242');
    expect(
      screen.queryByTestId("exception-occurrence-attributes"),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey),
    ).toBe("json");
  });

  test("filters a long list by key or value", () => {
    const attributes: Record<string, unknown> = {};
    for (let index: number = 0; index < 12; index++) {
      attributes[`app.setting${index}`] = `value-${index}`;
    }

    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(attributes)}
        isLoading={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter attributes"), {
      target: { value: "value-11" },
    });

    const list: HTMLElement = screen.getByTestId(
      "exception-occurrence-attributes",
    );
    expect(within(list).getAllByRole("term")).toHaveLength(1);
    expect(within(list).getByText("app.setting11")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter attributes"), {
      target: { value: "nothing-matches" },
    });
    expect(
      screen.getByText("No attributes match this filter."),
    ).toBeInTheDocument();
  });

  test("a short list needs no filter", () => {
    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(OCCURRENCE_ATTRIBUTES)}
        isLoading={false}
      />,
    );

    expect(
      screen.queryByLabelText("Filter attributes"),
    ).not.toBeInTheDocument();
  });

  test("says so when the occurrence carried no attributes, with nothing to copy", () => {
    render(
      <ExceptionOccurrenceAttributes
        instance={occurrence(undefined)}
        isLoading={false}
      />,
    );

    expect(
      screen.getByTestId("exception-occurrence-attributes-empty"),
    ).toHaveTextContent(
      "The latest occurrence was recorded without attributes.",
    );
    expect(
      screen.queryByTestId("exception-occurrence-attributes-copy-json"),
    ).not.toBeInTheDocument();
  });

  test("shows a loader while the occurrence is on its way", () => {
    render(
      <ExceptionOccurrenceAttributes instance={undefined} isLoading={true} />,
    );

    expect(
      screen.queryByTestId("exception-occurrence-attributes-empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("exception-occurrence-attributes"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });
});
