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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The Profiler's overview, over a fake telemetry API
 * ---------------------------------------------------------------------------
 *
 * The page answers, in this order: what am I looking at (a service, a kind
 * of profile it has data for, a window, what to compare it with), where
 * does the time go - in words before any chart, naming the busiest function
 * and the application's own code that takes the most - and the functions
 * ranked by Self, Total or Your code, each opening a panel with its
 * callers, its callees, a monitor on its share and Fix with AI where the
 * server offers it. These pin what the page asks the server for and what it
 * draws from the answers. The flame graphs, which read on their own, are
 * recorders here.
 */

const postMock: MockFunction = getJestMockFunction();
const analyticsListMock: MockFunction = getJestMockFunction();
const flameMock: MockFunction = getJestMockFunction();
const diffMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "error";
      },
    },
  };
});

/*
 * The services' names, as the entity-name lookup reads them: checkout,
 * search and a kernel thread the eBPF profiler profiled.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (options: { modelType: { name?: string } }) => {
        const { default: ServiceModel } = jest.requireActual(
          "../../../Models/DatabaseModels/Service",
        ) as { default: new () => Record<string, unknown> };

        if (options.modelType !== ServiceModel) {
          return { data: [], count: 0 };
        }

        const services: Array<Record<string, unknown>> = [
          ["60000000-0000-4000-8000-0000000000a1", "checkout"],
          ["60000000-0000-4000-8000-0000000000a2", "search"],
          ["60000000-0000-4000-8000-0000000000a4", "kworker/0:1"],
        ].map(([id, name]: Array<string>) => {
          return Object.assign(new ServiceModel(), { _id: id, name });
        });

        return { data: services, count: services.length };
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/AggregatedFlamegraph",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        flameMock(props);
        return <div data-testid="flame-recorder" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraph",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        diffMock(props);
        return <div data-testid="diff-recorder" />;
      },
    };
  },
);

import ProfilesOverview from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfilesOverview";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { PROJECT_ID } from "./SideMenuHarness";

const SERVICE_ID: string = "60000000-0000-4000-8000-0000000000a1";
const SEARCH_ID: string = "60000000-0000-4000-8000-0000000000a2";
const KWORKER_ID: string = "60000000-0000-4000-8000-0000000000a4";
const TASK_ID: string = "70000000-0000-4000-8000-0000000000f1";

interface Posted {
  url: string;
  body: Record<string, any>;
}

let posted: Array<Posted> = [];
let setQueryStringSpy: ReturnType<typeof jest.spyOn>;
let aiOn: boolean = true;

// The scenario a test changes: what the fake server answers.
interface Scenario {
  types: Array<{ profileType: string; unit: string; sampleCount: number }>;
  everTypes: Array<{ profileType: string; unit: string; sampleCount: number }>;
  fixOffer: SuggestionOffer;
  fixFails: boolean;
}

let scenario: Scenario;

const FUNCTIONS: Array<Record<string, any>> = [
  {
    functionName: "JSON.parse",
    fileName: "node:internal/json",
    lineNumber: 1,
    frameType: "",
    selfValue: 420,
    totalValue: 420,
    sampleCount: 4200,
    ownValue: 0,
  },
  {
    functionName: "Socket.write",
    fileName: "node:net",
    lineNumber: 900,
    frameType: "",
    selfValue: 160,
    totalValue: 160,
    sampleCount: 1600,
    ownValue: 0,
  },
  {
    functionName: "validateCart",
    fileName: "src/cart/validate.ts",
    lineNumber: 31,
    frameType: "",
    selfValue: 100,
    totalValue: 100,
    sampleCount: 1000,
    ownValue: 100,
  },
  {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 88,
    frameType: "",
    selfValue: 0,
    totalValue: 560,
    sampleCount: 5600,
    ownValue: 420,
  },
  {
    functionName: "handleCheckout",
    fileName: "src/routes/checkout.ts",
    lineNumber: 40,
    frameType: "",
    selfValue: 0,
    totalValue: 950,
    sampleCount: 9500,
    ownValue: 160,
  },
];

function share(selfShare: number, ownShare: number): Record<string, number> {
  return {
    selfValue: selfShare * 10,
    totalValue: selfShare * 10,
    sampleCount: 100,
    selfShare,
    totalShare: selfShare,
    ownValue: ownShare * 10,
    ownShare,
  };
}

function answer(url: string, body: Record<string, any>): Record<string, any> {
  if (url.includes("/telemetry/profiles/profile-types")) {
    const isEverRead: boolean =
      new Date(body["endTime"]).getTime() -
        new Date(body["startTime"]).getTime() >
      8 * 24 * 60 * 60 * 1000;
    return { profileTypes: isEverRead ? scenario.everTypes : scenario.types };
  }

  if (url.includes("/telemetry/profiles/service-activity")) {
    return {
      activity: [
        {
          primaryEntityId: SERVICE_ID,
          primaryEntityType: "OpenTelemetry",
          sampleCount: 9000,
          profileCount: 360,
        },
        {
          primaryEntityId: SEARCH_ID,
          primaryEntityType: "OpenTelemetry",
          sampleCount: 1000,
          profileCount: 360,
        },
        {
          primaryEntityId: KWORKER_ID,
          primaryEntityType: "OpenTelemetry",
          sampleCount: 100,
          profileCount: 360,
        },
      ],
    };
  }

  if (url.includes("/telemetry/profiles/function-list")) {
    return {
      functions: FUNCTIONS,
      windowTotal: 1000,
      windowSampleCount: 10000,
      truncated: false,
    };
  }

  if (url.includes("/telemetry/profiles/function-comparison")) {
    return {
      changes: [
        {
          functionName: "JSON.parse",
          fileName: "node:internal/json",
          lineNumber: 1,
          frameType: "",
          before: share(21, 0),
          after: share(42, 0),
          selfShareChange: 21,
          totalShareChange: 21,
          ownShareChange: 0,
          direction: "slower",
        },
        {
          functionName: "parseOrder",
          fileName: "src/orders/parse.ts",
          lineNumber: 88,
          frameType: "",
          before: share(0, 21),
          after: share(0, 42),
          selfShareChange: 0,
          totalShareChange: 30,
          ownShareChange: 21,
          direction: "same",
        },
      ],
      before: { windowTotal: 1000, windowSampleCount: 9000, truncated: false },
      after: { windowTotal: 2000, windowSampleCount: 18000, truncated: false },
      isFooted: true,
    };
  }

  if (url.includes("/telemetry/profiles/function-focus")) {
    return {
      functionName: body["functionName"],
      fileName: body["fileName"],
      lineNumber: 88,
      selfValue: 0,
      totalValue: 560,
      sampleCount: 5600,
      windowTotal: 1000,
      windowSampleCount: 10000,
      callers: {
        functionName: body["functionName"],
        fileName: body["fileName"],
        selfValue: 0,
        totalValue: 560,
        children: [
          {
            functionName: "handleCheckout",
            fileName: "src/routes/checkout.ts",
            selfValue: 0,
            totalValue: 560,
            children: [],
          },
        ],
      },
      callees: {
        functionName: body["functionName"],
        fileName: body["fileName"],
        selfValue: 0,
        totalValue: 560,
        children: [
          {
            functionName: "JSON.parse",
            fileName: "node:internal/json",
            selfValue: 420,
            totalValue: 420,
            children: [],
          },
          {
            functionName: "normalizeLineItems",
            fileName: "src/orders/normalize.ts",
            selfValue: 140,
            totalValue: 140,
            children: [],
          },
        ],
      },
      truncated: false,
    };
  }

  if (url.includes("/code-task/source-links")) {
    return {
      links: (body["frames"] || []).map(
        (frame: { fileName: string; lineNumber: number }) => {
          return {
            fileName: frame.fileName,
            lineNumber: frame.lineNumber,
            repositoryName: "acme/checkout",
            path: frame.fileName,
            url: `https://github.com/acme/checkout/blob/main/${frame.fileName}#L${frame.lineNumber}`,
          };
        },
      ),
    };
  }

  if (url.includes("/ai-investigation/profile-fix-suggestion")) {
    if (scenario.fixOffer === SuggestionOffer.None) {
      return { offer: SuggestionOffer.None };
    }

    return {
      offer: scenario.fixOffer,
      reason: "Hot",
      blocker:
        scenario.fixOffer === SuggestionOffer.SetUp
          ? {
              type: "RepositoryNotConnected",
              message: "Connect the GitHub repository that holds this code.",
            }
          : null,
      evidence: {
        category: "cpu",
        isOwnCode: true,
        ownShare: 42,
        functionSampleCount: 5600,
        windowSampleCount: 10000,
      },
      repository:
        scenario.fixOffer === SuggestionOffer.Act
          ? {
              id: "90000000-0000-4000-8000-0000000000c1",
              name: "acme/checkout",
            }
          : null,
      repositories: [],
      taskId: scenario.fixOffer === SuggestionOffer.InProgress ? TASK_ID : null,
    };
  }

  if (url.includes("/ai-investigation/create-profile-fix-task")) {
    if (scenario.fixFails) {
      throw new Error(
        "That repository is not connected through the GitHub App.",
      );
    }
    return { taskId: TASK_ID };
  }

  return {};
}

function requests(route: string): Array<Posted> {
  return posted.filter((request: Posted): boolean => {
    return request.url.includes(route);
  });
}

function lastQuery(): Record<string, string | null> {
  const calls: Array<Array<unknown>> = setQueryStringSpy.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as Record<string, string | null>;
}

async function renderOverview(
  search: string = "",
  props: React.ComponentProps<typeof ProfilesOverview> = {},
): Promise<void> {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/profiles${search}`,
  );

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <ProfilesOverview {...props} />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  posted = [];
  aiOn = true;
  scenario = {
    types: [
      { profileType: "cpu", unit: "nanoseconds", sampleCount: 10000 },
      { profileType: "inuse_space", unit: "bytes", sampleCount: 3000 },
    ],
    everTypes: [{ profileType: "cpu", unit: "nanoseconds", sampleCount: 10 }],
    fixOffer: SuggestionOffer.Act,
    fixFails: false,
  };

  postMock.mockReset();
  postMock.mockImplementation(
    async (options: { url: { toString: () => string }; data: unknown }) => {
      const url: string = options.url.toString();
      const body: Record<string, any> = JSON.parse(
        JSON.stringify(options.data || {}),
      );
      posted.push({ url, body });
      return { data: answer(url, body) };
    },
  );
  analyticsListMock.mockReset();
  analyticsListMock.mockImplementation(async () => {
    return {
      data: [
        {
          time: new Date(Date.now() - 40 * 60 * 1000),
          title: "v2.4.0",
          eventType: "deployment",
        },
      ],
      count: 1,
    };
  });
  flameMock.mockReset();
  diffMock.mockReset();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ProjectUtil, "getCurrentProject").mockImplementation(() => {
    return Object.assign(new Project(), {
      _id: PROJECT_ID,
      enableAi: aiOn,
    }) as Project;
  });
  setQueryStringSpy = jest
    .spyOn(Navigation, "setQueryString")
    .mockImplementation((): void => {
      // The address is read from the calls.
    });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    // Stay on the page.
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("where the time goes, in words first", () => {
  test("the busiest function, the top three, and the application's own code to look at", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const headline: HTMLElement =
      await screen.findByTestId("profiles-headline");

    await waitFor(() => {
      expect(
        within(headline).getByTestId("profiles-headline-text"),
      ).toHaveTextContent("spent 42% of its CPU time in JSON.parse.");
    });
    expect(headline).toHaveTextContent("The top 3 functions take 68%.");
    expect(
      within(headline).getByTestId("profiles-headline-own"),
    ).toHaveTextContent(
      "In your own code, parseOrder takes the most: 42%, with the library and runtime code it calls.",
    );
    expect(
      within(headline).getByTestId("profiles-headline-window"),
    ).toHaveTextContent("The last hour");
  });

  test("it reads the scope's own kinds, each as its own raw types", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    await screen.findByTestId("profiles-kind-picker");
    expect(screen.getByTestId("profiles-kind-cpu")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Only kinds with data: no Locks button to lead to an empty page.
    expect(screen.queryByTestId("profiles-kind-locks")).toBeNull();

    await waitFor(() => {
      expect(requests("/function-list").length).toBeGreaterThan(0);
    });
    const list: Posted = requests("/function-list")[0]!;
    expect(list.body["profileTypes"]).toEqual(["cpu"]);
    expect(list.body["serviceIds"]).toEqual([SERVICE_ID]);

    // The flame graph reads the very same types and unit.
    expect(flameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileTypes: ["cpu"], unit: "nanoseconds" }),
    );

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-kind-memory"));
    });

    expect(lastQuery()["profileType"]).toBe("memory");
    await waitFor(() => {
      expect(
        requests("/function-list").some((request: Posted): boolean => {
          return (
            JSON.stringify(request.body["profileTypes"]) ===
            JSON.stringify(["inuse_space"])
          );
        }),
      ).toBe(true);
    });
  });
});

describe("the functions, ranked three ways", () => {
  test("Self is explained above the list, and the list keeps to functions that did work themselves", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const list: HTMLElement = await screen.findByTestId("profiles-functions");

    expect(
      screen.getByTestId("profiles-functions-explained"),
    ).toHaveTextContent(
      "Self is time spent in the function's own code. Total adds everything it calls.",
    );
    expect(
      within(list)
        .getAllByTestId("profiles-function-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["JSON.parse", "Socket.write", "validateCart"]);
    // Whose code each one is.
    expect(
      within(list).getAllByTestId("profiles-function-origin")[2],
    ).toHaveTextContent("Your code");
    // The application's own files link to their lines in the repository.
    await waitFor(() => {
      expect(
        within(list).getByTestId("profiles-function-source-link"),
      ).toHaveAttribute(
        "href",
        "https://github.com/acme/checkout/blob/main/src/cart/validate.ts#L31",
      );
    });
  });

  test("Your code lists the application's own functions by own-code time, read sorted that way", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);
    await screen.findByTestId("profiles-functions");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-functions-view-own"));
    });

    const list: HTMLElement = await screen.findByTestId("profiles-functions");

    await waitFor(() => {
      expect(list).toHaveAttribute("data-view", "own");
    });
    expect(
      requests("/function-list").some((request: Posted): boolean => {
        return request.body["sortBy"] === "ownValue";
      }),
    ).toBe(true);
    expect(
      within(screen.getByTestId("profiles-functions"))
        .getAllByTestId("profiles-function-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["parseOrder", "handleCheckout", "validateCart"]);
  });
});

describe("what changed", () => {
  test("compared with the period before: what grew, and the own code that grew", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}&compare=previous`);

    const headline: HTMLElement =
      await screen.findByTestId("profiles-headline");

    await waitFor(() => {
      expect(
        within(headline).getByTestId("profiles-headline-text"),
      ).toHaveTextContent(
        "JSON.parse went from 21% to 42% of the CPU time. Compared with the period before.",
      );
    });
    expect(
      within(headline).getByTestId("profiles-headline-own"),
    ).toHaveTextContent(
      "In your own code, parseOrder grew the most: from 21% to 42%, with the library and runtime code it calls.",
    );

    const comparison: Posted = requests("/function-comparison")[0]!;
    // The hour before, and this hour.
    expect(new Date(comparison.body["beforeEndTime"]).getTime()).toBe(
      new Date(comparison.body["afterStartTime"]).getTime(),
    );
    expect(diffMock).toHaveBeenCalled();
    expect(screen.getByTestId("profiles-compare-picker")).toBeInTheDocument();
  });

  test("a deploy minutes old has nothing to compare yet, and says so", async () => {
    const changeTime: string = new Date(
      Date.now() - 2 * 60 * 1000,
    ).toISOString();

    await renderOverview(
      `?serviceId=${SERVICE_ID}&compare=change&changeTime=${changeTime}`,
    );

    expect(
      await screen.findByTestId("profiles-change-too-recent"),
    ).toHaveTextContent("Give it 5 minutes of profiles before comparing.");
    expect(requests("/function-comparison")).toHaveLength(0);
  });
});

describe("one function, explained", () => {
  test("its shares, who calls it, what it calls, its source, and a monitor on its share", async () => {
    await renderOverview(
      `?serviceId=${SERVICE_ID}&function=parseOrder&file=src%2Forders%2Fparse.ts`,
    );

    const panel: HTMLElement = await screen.findByTestId("profiles-panel");

    await waitFor(() => {
      expect(
        within(panel).getByTestId("profiles-panel-total"),
      ).toHaveTextContent("56%");
    });
    expect(within(panel).getByTestId("profiles-panel-self")).toHaveTextContent(
      "0%",
    );
    expect(within(panel).getByTestId("profiles-panel-own")).toHaveTextContent(
      "42%",
    );
    expect(
      within(panel).getByTestId("profiles-panel-callers"),
    ).toHaveTextContent("handleCheckout");
    expect(
      within(panel).getByTestId("profiles-panel-callees"),
    ).toHaveTextContent("JSON.parse");
    await waitFor(() => {
      expect(
        within(panel).getByTestId("profiles-panel-source-link"),
      ).toHaveAttribute(
        "href",
        "https://github.com/acme/checkout/blob/main/src/orders/parse.ts#L88",
      );
    });

    const watch: HTMLElement = within(panel).getByTestId(
      "profiles-panel-watch",
    );
    expect(watch).toHaveTextContent("Alert me when its share passes 85%");
    expect(watch.getAttribute("href")).toContain("profileFunction=parseOrder");
    expect(watch.getAttribute("href")).toContain("profileThreshold=85");
  });

  test("a runtime's function points at the application's own code that calls it", async () => {
    await renderOverview(
      `?serviceId=${SERVICE_ID}&function=JSON.parse&file=node%3Ainternal%2Fjson`,
    );

    const hint: HTMLElement = await screen.findByTestId(
      "profiles-panel-not-yours",
    );

    expect(hint).toHaveTextContent(
      "This is not your code. To spend less time here, change how your code calls it, starting with handleCheckout.",
    );

    await act(async (): Promise<void> => {
      fireEvent.click(within(hint).getByTestId("profiles-panel-own-caller"));
    });

    expect(lastQuery()["function"]).toBe("handleCheckout");
  });
});

describe("Fix with AI", () => {
  const PARSE_ORDER: string = `?serviceId=${SERVICE_ID}&function=parseOrder&file=src%2Forders%2Fparse.ts`;

  test("offered: why, then a Code task started from the profile", async () => {
    await renderOverview(PARSE_ORDER);

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");

    expect(within(strip).getByTestId("profiles-fix-finding")).toHaveTextContent(
      "This is your code, and with the library code it calls it takes 42% of the CPU time.",
    );

    await act(async (): Promise<void> => {
      fireEvent.click(within(strip).getByTestId("profiles-fix-with-ai"));
    });

    const created: Posted = requests("/create-profile-fix-task")[0]!;
    expect(created.body).toMatchObject({
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      profileType: "cpu",
    });

    const link: HTMLElement = await within(
      screen.getByTestId("profiles-fix"),
    ).findByTestId("profiles-fix-task-link");
    expect(link.getAttribute("href")).toContain(`/code/tasks/${TASK_ID}`);
  });

  test("a refusal is said beside the button", async () => {
    scenario.fixFails = true;
    await renderOverview(PARSE_ORDER);

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");

    await act(async (): Promise<void> => {
      fireEvent.click(within(strip).getByTestId("profiles-fix-with-ai"));
    });

    expect(
      await within(screen.getByTestId("profiles-fix")).findByTestId(
        "profiles-fix-error",
      ),
    ).toHaveTextContent(
      "Could not start the fix: That repository is not connected through the GitHub App.",
    );
  });

  test("no repository connected: the way to connect GitHub, not a button", async () => {
    scenario.fixOffer = SuggestionOffer.SetUp;
    await renderOverview(PARSE_ORDER);

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");

    expect(within(strip).getByTestId("profiles-fix-connect")).toHaveTextContent(
      "Connect GitHub to fix this with AI",
    );
    expect(within(strip).queryByTestId("profiles-fix-with-ai")).toBeNull();
  });

  test("a fix already on its way: a link to it", async () => {
    scenario.fixOffer = SuggestionOffer.InProgress;
    await renderOverview(PARSE_ORDER);

    const link: HTMLElement = await screen.findByTestId(
      "profiles-fix-task-link",
    );
    expect(link.getAttribute("href")).toContain(`/code/tasks/${TASK_ID}`);
  });

  test("with AI off nothing is asked or drawn", async () => {
    aiOn = false;
    await renderOverview(PARSE_ORDER);

    await screen.findByTestId("profiles-panel-own");
    expect(requests("/profile-fix-suggestion")).toHaveLength(0);
    expect(screen.queryByTestId("profiles-fix")).toBeNull();
  });

  test("not offered: nothing at all", async () => {
    scenario.fixOffer = SuggestionOffer.None;
    await renderOverview(PARSE_ORDER);

    await waitFor(() => {
      expect(requests("/profile-fix-suggestion").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("profiles-fix")).toBeNull();
  });
});

describe("what is profiled", () => {
  test("every service busiest first, kernel threads folded away, a click narrowing the page", async () => {
    await renderOverview();

    await screen.findByTestId("profiles-services");

    // Named, busiest first; the kernel thread folded away.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("profiles-services"))
          .getAllByTestId("profiles-service-row")
          .map((row: HTMLElement): string => {
            return row.textContent || "";
          }),
      ).toEqual([
        expect.stringContaining("checkout"),
        expect.stringContaining("search"),
      ]);
    });
    expect(screen.getByTestId("profiles-services-kernel")).toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-services-kernel"));
    });
    expect(screen.getAllByTestId("profiles-service-row")).toHaveLength(3);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getAllByTestId("profiles-service-row")[0]!);
    });

    expect(lastQuery()["serviceId"]).toBe(SERVICE_ID);
  });

  test("a service's own tab is locked to it: no picker, no services card", async () => {
    await renderOverview("", { lockedEntityId: SERVICE_ID });

    await screen.findByTestId("profiles-headline");
    expect(screen.queryByTestId("profiles-service-picker")).toBeNull();
    expect(screen.queryByTestId("profiles-services")).toBeNull();
    // The address never carries the service the page is about.
    expect(lastQuery()["serviceId"]).toBeNull();
    expect(requests("/profile-types")[0]!.body["serviceIds"]).toEqual([
      SERVICE_ID,
    ]);
  });
});

describe("an empty window", () => {
  test("profiles came in lately but not in this window: a longer window, one click away", async () => {
    scenario.types = [];
    await renderOverview();

    const empty: HTMLElement = await screen.findByTestId(
      "profiles-empty-window",
    );

    expect(empty).toHaveTextContent("No profiles in this window");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(empty).getByRole("button", { name: "Show the past week" }),
      );
    });

    expect(lastQuery()["rangeMinutes"]).toBe("10080");
  });
});
