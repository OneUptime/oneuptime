import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  test,
} from "@jest/globals";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ProductAnalyticsSavedViewType } from "../../../Types/Rum/ProductAnalyticsSavedViews";
import Route from "../../../Types/API/Route";
import { createTranslator, Translator } from "../../../Types/Translator";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsFunnelDto,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  PRODUCT_ANALYTICS_TEST_APP_ID,
  PRODUCT_ANALYTICS_TEST_PROJECT_ID,
  ProductAnalyticsTestAnswer,
  answerProductAnalyticsReads,
  chooseProductAnalyticsOption,
  lastProductAnalyticsRequestTo,
  openProductAnalyticsOptions,
  productAnalyticsRequestsTo,
  productAnalyticsTestNames,
} from "./ProductAnalyticsEventsPageKit";

/*
 * Product Analytics > Funnels (Pages/Rum/View/ProductAnalyticsFunnels.tsx),
 * rendered against mocked reads (issue #6444, part two): it opens on a
 * session's start then the application's most frequent event; each step
 * shows its people and their share of the first step's, and between two
 * steps who went on, who dropped off and how long it took; steps are
 * picked, added and removed, the window and the segment chosen, and every
 * choice is kept in the address.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
// The application's saved funnels (issue #6630): none, unless a test says.
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
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
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import RumApplicationProductAnalyticsFunnels, {
  pickDefaultProductAnalyticsFunnelSteps,
  pickNextProductAnalyticsFunnelStep,
  toProductAnalyticsPersonProperties,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsFunnels";
import {
  buildProductAnalyticsFunnelRows,
  describeProductAnalyticsFunnelCompletion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsFunnelChart";

const PAGE_PATH: string = `/dashboard/${PRODUCT_ANALYTICS_TEST_PROJECT_ID}/rum/${PRODUCT_ANALYTICS_TEST_APP_ID}/product-analytics-funnels`;
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const english: Translator = createTranslator(undefined, "en");

function funnel(data?: JSONObject): JSONObject {
  const steps: Array<JSONObject> = ((data?.["steps"] as Array<JSONObject>) || [
    { kind: "session", name: "" },
    { kind: "custom", name: "Signed up" },
  ]) as Array<JSONObject>;
  const people: Array<number> = [400, 100, 40, 20, 10, 5];

  return {
    windowMs: data?.["windowMs"] ?? DAY_MS,
    steps: steps.map((step: JSONObject, index: number): JSONObject => {
      const reached: number = people[index] ?? 1;
      const previous: number = index === 0 ? reached : people[index - 1]!;

      return {
        ...step,
        people: reached,
        conversionFromStart: reached / people[0]!,
        conversionFromPrevious: index === 0 ? 1 : reached / previous,
        droppedOff: index === 0 ? 0 : previous - reached,
        medianMsFromPrevious: index === 0 ? null : 90 * 1000 * index,
      };
    }),
  };
}

function mockReads(
  answers: Partial<
    Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >
  >,
): void {
  answerProductAnalyticsReads(postMock, {
    "event-names": productAnalyticsTestNames(),
    "event-properties": { propertyKeys: ["plan"], userPropertyKeys: ["role"] },
    funnel: funnel,
    ...(answers as Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >),
  });
}

function renderPage(search?: string): ReturnType<typeof render> {
  window.history.replaceState(null, "", `${PAGE_PATH}${search || ""}`);

  return render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsFunnels
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

/* An element's words, each text a word apart: "1 Session started 400 people 100%". */
function spacedText(element: HTMLElement): string {
  const walker: TreeWalker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const words: Array<string> = [];

  while (walker.nextNode()) {
    const text: string = (walker.currentNode.textContent || "").trim();

    if (text) {
      words.push(text);
    }
  }

  return words.join(" ");
}

function stepTexts(): Array<string> {
  return screen
    .getAllByTestId("product-analytics-funnel-chart-step")
    .map(spacedText);
}

async function waitForSteps(count: number): Promise<Array<string>> {
  await waitFor(() => {
    expect(
      screen.getAllByTestId("product-analytics-funnel-chart-step"),
    ).toHaveLength(count);
  });

  return stepTexts();
}

function lastFunnelRequest(): JSONObject {
  return lastProductAnalyticsRequestTo(postMock, "funnel");
}

function stepPicker(number: number): HTMLElement {
  return screen.getByRole("combobox", { name: `Step ${number}` });
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 100 });
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      isProductAnalyticsEnabled: true,
      isSessionReplayEnabled: true,
    });
  });
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the default funnel", () => {
  function event(
    kind: ProductAnalyticsEventKind,
    name: string,
  ): ProductAnalyticsEventNameDto {
    return { kind: kind, name: name, events: 1, users: 1, lastSeenAt: 1 };
  }

  test("a session's start, then the most frequent event of the application's own, else its most viewed page", () => {
    expect(
      pickDefaultProductAnalyticsFunnelSteps([
        event(ProductAnalyticsEventKind.Session, ""),
        event(ProductAnalyticsEventKind.Page, "/"),
        event(ProductAnalyticsEventKind.Custom, "Signed up"),
      ]),
    ).toEqual([
      { kind: ProductAnalyticsEventKind.Session, name: "" },
      { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
    ]);
    expect(
      pickDefaultProductAnalyticsFunnelSteps([
        event(ProductAnalyticsEventKind.Page, "/docs"),
      ]),
    ).toEqual([
      { kind: ProductAnalyticsEventKind.Session, name: "" },
      { kind: ProductAnalyticsEventKind.Page, name: "/docs" },
    ]);
    /* With neither: who came back for another session. */
    expect(pickDefaultProductAnalyticsFunnelSteps([])).toEqual([
      { kind: ProductAnalyticsEventKind.Session, name: "" },
      { kind: ProductAnalyticsEventKind.Session, name: "" },
    ]);
  });

  test("Add step adds the most frequent event of the application's own not yet a step, else its most viewed page not yet one, else a session's start", () => {
    const events: Array<ProductAnalyticsEventNameDto> = [
      event(ProductAnalyticsEventKind.Session, ""),
      event(ProductAnalyticsEventKind.Page, "/pricing"),
      event(ProductAnalyticsEventKind.Custom, "Signed up"),
      event(ProductAnalyticsEventKind.Custom, "Purchased"),
    ];
    const session: ProductAnalyticsEventRef = {
      kind: ProductAnalyticsEventKind.Session,
      name: "",
    };

    expect(
      pickNextProductAnalyticsFunnelStep(events, [
        session,
        { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
      ]),
    ).toEqual({ kind: ProductAnalyticsEventKind.Custom, name: "Purchased" });
    expect(
      pickNextProductAnalyticsFunnelStep(events, [
        session,
        { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
        { kind: ProductAnalyticsEventKind.Custom, name: "Purchased" },
      ]),
    ).toEqual({ kind: ProductAnalyticsEventKind.Page, name: "/pricing" });
    /* A page of the same name as an event is another event. */
    expect(
      pickNextProductAnalyticsFunnelStep(
        [
          event(ProductAnalyticsEventKind.Custom, "/pricing"),
          event(ProductAnalyticsEventKind.Page, "/pricing"),
        ],
        [session, { kind: ProductAnalyticsEventKind.Page, name: "/pricing" }],
      ),
    ).toEqual({ kind: ProductAnalyticsEventKind.Custom, name: "/pricing" });
    /* Every event a step already: a session's start, as before. */
    expect(
      pickNextProductAnalyticsFunnelStep(
        [event(ProductAnalyticsEventKind.Page, "/pricing")],
        [session, { kind: ProductAnalyticsEventKind.Page, name: "/pricing" }],
      ),
    ).toEqual(session);
    expect(pickNextProductAnalyticsFunnelStep([], [session, session])).toEqual(
      session,
    );
  });

  test("a funnel's segment offers the people's properties, never one event's own", () => {
    expect(
      toProductAnalyticsPersonProperties({
        propertyKeys: ["plan"],
        userPropertyKeys: ["role"],
      }),
    ).toEqual({ propertyKeys: [], userPropertyKeys: ["role"] });
    expect(toProductAnalyticsPersonProperties(null)).toBeNull();
  });
});

describe("a funnel's rows", () => {
  const dto: ProductAnalyticsFunnelDto = {
    windowMs: DAY_MS,
    steps: [
      {
        kind: ProductAnalyticsEventKind.Session,
        name: "",
        people: 1,
        conversionFromStart: 1,
        conversionFromPrevious: 1,
        droppedOff: 0,
        medianMsFromPrevious: null,
      },
      {
        kind: ProductAnalyticsEventKind.Page,
        name: "/pricing",
        people: 0,
        conversionFromStart: 0,
        conversionFromPrevious: 0,
        droppedOff: 1,
        medianMsFromPrevious: null,
      },
    ],
  };

  test("each step's people in the reader's words, its share and its bar; between steps, who went on and who dropped off", () => {
    const rows: ReturnType<typeof buildProductAnalyticsFunnelRows> =
      buildProductAnalyticsFunnelRows({ funnel: dto, translator: english });

    expect(rows[0]).toEqual(
      expect.objectContaining({
        number: "1",
        label: "Session started",
        people: "1 person",
        share: "100%",
        width: 100,
      }),
    );
    expect(rows[0]!.transition).toBeUndefined();
    expect(rows[1]).toEqual(
      expect.objectContaining({
        number: "2",
        label: "Viewed /pricing",
        people: "0 people",
        share: "0%",
        width: 0,
      }),
    );
    /* Nobody went on: no time to tell. */
    expect(rows[1]!.transition).toEqual({
      continued: "0% went on",
      droppedOff: "1 dropped off",
      median: null,
    });
  });

  test("the completion line needs two steps and somebody at the first", () => {
    expect(
      describeProductAnalyticsFunnelCompletion({
        funnel: dto,
        translator: english,
      }),
    ).toBe("0% did every step");
    expect(
      describeProductAnalyticsFunnelCompletion({
        funnel: { ...dto, steps: dto.steps.slice(0, 1) },
        translator: english,
      }),
    ).toBeNull();
    expect(
      describeProductAnalyticsFunnelCompletion({
        funnel: {
          ...dto,
          steps: dto.steps.map(
            (step: ProductAnalyticsFunnelDto["steps"][0]) => {
              return { ...step, people: 0 };
            },
          ),
        },
        translator: english,
      }),
    ).toBeNull();
  });
});

describe("ProductAnalyticsFunnels", () => {
  it("opens on a session's start then the application's most frequent event, within a day, for everyone", async () => {
    mockReads({});

    renderPage();

    expect(await waitForSteps(2)).toEqual([
      "1 Session started 400 people 100%",
      "25% went on 300 dropped off Median time 1m 30s 2 Signed up 100 people 25%",
    ]);

    const request: JSONObject = lastFunnelRequest();

    expect(request["steps"]).toEqual([
      { kind: "session", name: "" },
      { kind: "custom", name: "Signed up" },
    ]);
    expect(request["windowMs"]).toBe(DAY_MS);
    expect(request["filters"]).toEqual([]);
    expect(request["rumApplicationId"]).toBe(PRODUCT_ANALYTICS_TEST_APP_ID);
    expect(
      screen.getByTestId("product-analytics-funnel-completion"),
    ).toHaveTextContent("25% did every step");
    /* The bars run to each step's share of the first. */
    expect(
      screen
        .getAllByTestId("product-analytics-funnel-chart-bar")
        .map((bar: HTMLElement): string => {
          return bar.style.width;
        }),
    ).toEqual(["100%", "25%"]);
    /* Its segment reads the first step's people. */
    expect(
      lastProductAnalyticsRequestTo(postMock, "event-properties")["event"],
    ).toEqual({ kind: "session", name: "" });
    /* A default is never written into the address. */
    expect(window.location.search).toBe("");
  });

  it("a step picked, a step added and a step removed each read the funnel again, and the address keeps them", async () => {
    mockReads({});

    renderPage();

    await waitForSteps(2);
    await chooseProductAnalyticsOption(stepPicker(2), "/pricing");

    await waitFor(() => {
      expect(lastFunnelRequest()["steps"]).toEqual([
        { kind: "session", name: "" },
        { kind: "page", name: "/pricing" },
      ]);
    });

    fireEvent.click(screen.getByTestId("product-analytics-funnel-add-step"));

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-funnel-step"),
      ).toHaveLength(3);
    });
    /* The step added is the most frequent event of its own not yet a step. */
    await waitFor(() => {
      expect(lastFunnelRequest()["steps"]).toEqual([
        { kind: "session", name: "" },
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Signed up" },
      ]);
    });
    await chooseProductAnalyticsOption(stepPicker(3), "Purchased");

    await waitFor(() => {
      expect(lastFunnelRequest()["steps"]).toEqual([
        { kind: "session", name: "" },
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Purchased" },
      ]);
    });
    expect(new URLSearchParams(window.location.search).getAll("step")).toEqual([
      "session:",
      "page:/pricing",
      "custom:Purchased",
    ]);

    /* Two steps have no way out: a funnel needs two. */
    fireEvent.click(screen.getByRole("button", { name: "Remove Step 2" }));

    await waitFor(() => {
      expect(lastFunnelRequest()["steps"]).toEqual([
        { kind: "session", name: "" },
        { kind: "custom", name: "Purchased" },
      ]);
    });
    expect(
      screen.queryByTestId("product-analytics-funnel-step-remove"),
    ).not.toBeInTheDocument();
  });

  it("opens the steps, the window and the segment the address names", async () => {
    mockReads({});

    renderPage(
      `?step=${encodeURIComponent("page:/pricing")}&step=${encodeURIComponent(
        "custom:Signed up",
      )}&step=${encodeURIComponent("custom:Purchased")}&within=${7 * DAY_MS}&segment=${encodeURIComponent(
        JSON.stringify([
          { field: "userProperty", key: "role", value: "admin" },
        ]),
      )}`,
    );

    await waitForSteps(3);

    const request: JSONObject = lastFunnelRequest();

    expect(request["steps"]).toEqual([
      { kind: "page", name: "/pricing" },
      { kind: "custom", name: "Signed up" },
      { kind: "custom", name: "Purchased" },
    ]);
    expect(request["windowMs"]).toBe(7 * DAY_MS);
    expect(request["filters"]).toEqual([
      { field: "userProperty", key: "role", value: "admin" },
    ]);
    expect(
      screen.getByTestId("product-analytics-funnel-segment-filter"),
    ).toHaveTextContent("User property: role is admin");
    /* The window picked, as the picker shows it. */
    expect(screen.getByText("Within 7 days")).toBeInTheDocument();
  });

  it("the window to finish in is one of the server's, and changes the read", async () => {
    mockReads({});

    renderPage();

    await waitForSteps(2);

    const windowPicker: HTMLElement = screen.getByRole("combobox", {
      name: "Time to finish the funnel",
    });

    /* Named on the page too, under the steps it times. */
    expect(
      within(screen.getByTestId("product-analytics-funnel-steps")).getByText(
        "Time to finish the funnel",
      ),
    ).toBeInTheDocument();
    expect(openProductAnalyticsOptions(windowPicker)).toEqual([
      "Within 1 hour",
      "Within 1 day",
      "Within 7 days",
      "Within 14 days",
      "Within 30 days",
    ]);

    fireEvent.keyDown(windowPicker, { key: "Escape" });
    await chooseProductAnalyticsOption(windowPicker, "Within 1 hour");

    await waitFor(() => {
      expect(lastFunnelRequest()["windowMs"]).toBe(HOUR_MS);
    });
    expect(new URLSearchParams(window.location.search).get("within")).toBe(
      String(HOUR_MS),
    );
  });

  it("offers a step every event the application sent, a session's start first, then its own, then its pages", async () => {
    mockReads({});

    renderPage();

    await waitForSteps(2);

    expect(openProductAnalyticsOptions(stepPicker(1))).toEqual([
      "Session started",
      "Signed up",
      "Purchased",
      "/pricing",
    ]);
  });

  it("holds at most six steps", async () => {
    const steps: string = Array.from(
      { length: PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS },
      (): string => {
        return `step=${encodeURIComponent("custom:Signed up")}`;
      },
    ).join("&");

    mockReads({});

    renderPage(`?${steps}`);

    await waitForSteps(PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS);

    expect(
      screen.getByTestId("product-analytics-funnel-add-step"),
    ).toBeDisabled();
    expect(
      screen.getAllByTestId("product-analytics-funnel-step-remove"),
    ).toHaveLength(PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS);
  });

  it("says so when nobody did the first step", async () => {
    mockReads({
      funnel: {
        windowMs: DAY_MS,
        steps: [
          {
            kind: "session",
            name: "",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 1,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
          {
            kind: "custom",
            name: "Signed up",
            people: 0,
            conversionFromStart: 0,
            conversionFromPrevious: 0,
            droppedOff: 0,
            medianMsFromPrevious: null,
          },
        ],
      },
    });

    renderPage();

    expect(
      await screen.findByTestId("product-analytics-funnel-nobody"),
    ).toHaveTextContent("Nobody did the first step in this range and segment.");
    expect(
      screen.queryByTestId("product-analytics-funnel-completion"),
    ).not.toBeInTheDocument();
  });

  it("a refused funnel says why, and the steps stay to change", async () => {
    mockReads({
      funnel: new HTTPErrorResponse(
        400,
        { message: "A funnel has two to six steps." },
        {},
      ),
    });

    renderPage();

    expect(
      await screen.findByText("A funnel has two to six steps."),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("product-analytics-funnel-step")).toHaveLength(
      2,
    );
    expect(
      screen.queryByTestId("product-analytics-funnel-completion"),
    ).not.toBeInTheDocument();
  });

  it("before any event is kept: what turning events on does, and no funnel read", async () => {
    getItemMock.mockImplementation((): Promise<unknown> => {
      return Promise.resolve({
        isProductAnalyticsEnabled: false,
        isSessionReplayEnabled: true,
      });
    });
    mockReads({
      "event-names": productAnalyticsTestNames({
        events: [],
        dataStartedAt: null,
      }),
    });

    renderPage();

    const off: HTMLElement = await screen.findByTestId(
      "product-analytics-events-off",
    );

    expect(within(off).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(productAnalyticsRequestsTo(postMock, "funnel")).toHaveLength(0);
    expect(
      screen.queryByTestId("product-analytics-funnels-page"),
    ).not.toBeInTheDocument();
  });

  it("a funnel narrowed to a segment reads every step in it", async () => {
    mockReads({});

    renderPage();

    await waitForSteps(2);
    fireEvent.click(
      screen.getByTestId("product-analytics-funnel-segment-open"),
    );

    /* The fields every event carries, and the people's properties - no event's own. */
    expect(
      openProductAnalyticsOptions(
        screen.getByRole("combobox", { name: "Field" }),
      ),
    ).toEqual([
      "Device type",
      "Browser",
      "Operating system",
      "Country",
      "App version",
      "Page",
      "User property: role",
    ]);

    await chooseProductAnalyticsOption(
      screen.getByRole("combobox", { name: "Field" }),
      "Device type",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "Mobile" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("product-analytics-funnel-segment-add"),
      );
    });

    await waitFor(() => {
      expect(lastFunnelRequest()["filters"]).toEqual([
        { field: "deviceType", key: "", value: "mobile" },
      ]);
    });
  });
});

/*
 * Saved funnels (issue #6630): the toolbar's dropdown opens one, and a
 * page opened from a dashboard widget's link (`?view=<id>` and its range)
 * reads only the saved funnel - never the default first.
 */
describe("saved funnels", () => {
  const SAVED_ID: string = "6a303333-0000-4000-8000-000000000001";

  function savedFunnel(): RumProductAnalyticsSavedView {
    const row: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView(
      new ObjectID(SAVED_ID),
    );

    row.name = "Pricing to purchase";
    row.viewType = ProductAnalyticsSavedViewType.Funnel;
    row.rumApplicationId = new ObjectID(PRODUCT_ANALYTICS_TEST_APP_ID);
    row.definition = {
      steps: [
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Purchased" },
      ],
      windowMs: 7 * DAY_MS,
      filters: [{ field: "country", key: "", value: "DE" }],
    };

    return row;
  }

  function saved(): HTMLElement {
    return screen.getByTestId("product-analytics-funnels-saved");
  }

  beforeEach(() => {
    getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    getListMock.mockResolvedValue({
      data: [savedFunnel()],
      count: 1,
      skip: 0,
      limit: 100,
    });
  });

  it("a widget's link opens the saved funnel, and reads it alone", async () => {
    mockReads({});

    renderPage(`?range=Past+1+Week&view=${SAVED_ID}`);

    expect(await waitForSteps(2)).toHaveLength(2);

    const reads: Array<JSONObject> = productAnalyticsRequestsTo(
      postMock,
      "funnel",
    ).map((request: { data: JSONObject }): JSONObject => {
      return request.data;
    });

    expect(reads.length).toBeGreaterThan(0);

    for (const read of reads) {
      expect(read["steps"]).toEqual([
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Purchased" },
      ]);
      expect(read["windowMs"]).toBe(7 * DAY_MS);
      expect(read["filters"]).toEqual([
        { field: "country", key: "", value: "DE" },
      ]);
    }

    await waitFor(() => {
      expect(within(saved()).getAllByRole("button")[0]).toHaveTextContent(
        "Pricing to purchase",
      );
    });

    const address: URLSearchParams = new URLSearchParams(
      window.location.search,
    );

    expect(address.get("view")).toBe(SAVED_ID);
    expect(address.getAll("step")).toEqual([
      "page:/pricing",
      "custom:Purchased",
    ]);
    // The range the link came with stays the page's.
    expect(address.get("range")).toBe("Past 1 Week");
  });

  it("a shared link's own steps win, under the saved funnel it names, shown changed", async () => {
    mockReads({});

    renderPage(
      `?step=${encodeURIComponent("session:")}&step=${encodeURIComponent(
        "custom:Signed up",
      )}&view=${SAVED_ID}`,
    );

    await waitForSteps(2);

    expect(lastFunnelRequest()["steps"]).toEqual([
      { kind: "session", name: "" },
      { kind: "custom", name: "Signed up" },
    ]);
    await waitFor(() => {
      expect(within(saved()).getAllByRole("button")[0]).toHaveTextContent(
        "Pricing to purchase (changed)",
      );
    });
    expect(new URLSearchParams(window.location.search).get("view")).toBe(
      SAVED_ID,
    );
  });

  it("a link to a saved funnel this reader cannot open says so, and the page reads its default", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 100 });
    mockReads({});

    renderPage(`?view=${SAVED_ID}`);

    expect(
      await screen.findByTestId("product-analytics-saved-view-notice"),
    ).toHaveTextContent(
      "The saved funnel this link opens was deleted, or you cannot see it.",
    );
    await waitForSteps(2);
    expect(lastFunnelRequest()["steps"]).toEqual([
      { kind: "session", name: "" },
      { kind: "custom", name: "Signed up" },
    ]);
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has("view")).toBe(
        false,
      );
    });
  });

  it("picking a saved funnel puts its steps on the page and it in the address", async () => {
    mockReads({});

    renderPage();

    await waitForSteps(2);

    await act(async () => {
      fireEvent.click(within(saved()).getAllByRole("button")[0]!);
    });

    const panel: HTMLElement = screen.getByRole("dialog", {
      name: "Saved funnels",
    });

    await act(async () => {
      fireEvent.click(
        await within(panel).findByRole("button", {
          name: "Pricing to purchase",
        }),
      );
    });

    await waitFor(() => {
      expect(lastFunnelRequest()["steps"]).toEqual([
        { kind: "page", name: "/pricing" },
        { kind: "custom", name: "Purchased" },
      ]);
    });
    expect(lastFunnelRequest()["windowMs"]).toBe(7 * DAY_MS);
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("view")).toBe(
        SAVED_ID,
      );
    });

    // A step changed: still the open one, now changed.
    await chooseProductAnalyticsOption(stepPicker(2), "Signed up");

    await waitFor(() => {
      expect(within(saved()).getAllByRole("button")[0]).toHaveTextContent(
        "Pricing to purchase (changed)",
      );
    });
  });

  it("a role that may not read saved funnels sees no dropdown, and the funnel as before", async () => {
    getJestSpyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "No access.",
    });
    mockReads({});

    renderPage();

    await waitForSteps(2);
    expect(
      screen.queryByTestId("product-analytics-funnels-saved"),
    ).not.toBeInTheDocument();
  });
});
