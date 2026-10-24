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
  // What a SetUp answer says stands in the way.
  fixBlockerType: string;
  // Act with no repository found for certain: these to pick from.
  fixRepositories: Array<{ id: string; name: string }>;
  // Routes the fake server refuses, as a store that is down would.
  failRoutes: Array<string>;
  // The functions the function list answers with.
  functions: Array<Record<string, any>>;
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
      functions: scenario.functions,
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
    // JSON.parse calls nothing; main has no caller: it starts its stacks.
    const isLeaf: boolean = body["functionName"] === "JSON.parse";
    const isRoot: boolean = body["functionName"] === "main";

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
        children: isRoot
          ? []
          : [
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
        children: isLeaf
          ? []
          : [
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
              type: scenario.fixBlockerType,
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
        scenario.fixOffer === SuggestionOffer.Act &&
        scenario.fixRepositories.length === 0
          ? {
              id: "90000000-0000-4000-8000-0000000000c1",
              name: "acme/checkout",
            }
          : null,
      repositories: scenario.fixRepositories,
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
    fixBlockerType: "RepositoryNotConnected",
    fixRepositories: [],
    failRoutes: [],
    functions: FUNCTIONS,
  };

  postMock.mockReset();
  postMock.mockImplementation(
    async (options: { url: { toString: () => string }; data: unknown }) => {
      const url: string = options.url.toString();
      const body: Record<string, any> = JSON.parse(
        JSON.stringify(options.data || {}),
      );
      posted.push({ url, body });

      if (
        scenario.failRoutes.some((route: string): boolean => {
          return url.includes(route);
        })
      ) {
        throw new Error("The profile store is unavailable.");
      }

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
      ).toHaveTextContent("JSON.parse takes 42% of the CPU time in checkout.");
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
      "Self counts only the function's own code. Total adds everything it calls.",
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
      "This is not your code: change how your code calls it, starting with handleCheckout.",
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
      "Connect a repository to fix this with AI",
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

/*
 * ---------------------------------------------------------------------------
 * The UI review's rules
 * ---------------------------------------------------------------------------
 */

describe("the scope bar: what, then when", () => {
  test("the raw types a kind leaves out sit at the end of the kinds, behind More profile types", async () => {
    scenario.types = [
      { profileType: "cpu", unit: "nanoseconds", sampleCount: 10000 },
      { profileType: "samples", unit: "count", sampleCount: 500 },
    ];
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const kinds: HTMLElement = await screen.findByTestId(
      "profiles-kind-picker",
    );
    // The kinds wrap on a phone rather than scroll out of sight.
    expect(kinds.className).toContain("flex-wrap");
    expect(kinds.className).not.toContain("overflow-x-auto");

    const more: HTMLElement = within(kinds).getByTestId(
      "profiles-raw-type-picker",
    );
    expect(more).toHaveTextContent("More profile types");
    expect(more).toHaveAttribute("aria-haspopup", "menu");

    await act(async (): Promise<void> => {
      fireEvent.click(more);
    });

    const item: HTMLElement = await screen.findByTestId(
      "profiles-raw-type-samples",
    );
    expect(item).toHaveTextContent("samples (CPU time)");
    expect(item).toHaveAttribute("role", "menuitemradio");
    expect(item).toHaveAttribute("aria-checked", "false");

    await act(async (): Promise<void> => {
      fireEvent.click(item);
    });

    expect(lastQuery()["profileType"]).toBe("samples");
    await waitFor(() => {
      expect(
        within(screen.getByTestId("profiles-kind-picker")).getByTestId(
          "profiles-raw-type-picker",
        ),
      ).toHaveTextContent("samples (CPU time)");
    });
    expect(screen.getByTestId("profiles-kind-cpu")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => {
      const lists: Array<Posted> = requests("/function-list");
      expect(lists[lists.length - 1]!.body["profileTypes"]).toEqual([
        "samples",
      ]);
    });
  });

  test("a type of no known kind reads as Other in the menu, never as a word to translate", async () => {
    scenario.types = [
      { profileType: "cpu", unit: "nanoseconds", sampleCount: 10000 },
      { profileType: "custom_metric", unit: "count", sampleCount: 50 },
    ];
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const more: HTMLElement = await screen.findByTestId(
      "profiles-raw-type-picker",
    );

    await act(async (): Promise<void> => {
      fireEvent.click(more);
    });

    expect(
      await screen.findByTestId("profiles-raw-type-custom_metric"),
    ).toHaveTextContent("custom_metric (Other)");
  });

  test("no More profile types when every type has its kind", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    await screen.findByTestId("profiles-kind-picker");
    expect(screen.queryByTestId("profiles-raw-type-picker")).toBeNull();
  });

  test("a page about one resource with no kind to pick draws no first row, and no rule above the window", async () => {
    // Profiles in the last 30 days, none in this window.
    scenario.types = [];
    await renderOverview("", { lockedEntityId: SERVICE_ID });

    await screen.findByTestId("profiles-empty-window");
    expect(screen.getByTestId("profiles-scope-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("profiles-scope-what")).toBeNull();
    expect(screen.getByTestId("profiles-scope-when").className).not.toContain(
      "border-t",
    );
  });

  test("with a service picker or kinds, the window sits under a rule", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    await screen.findByTestId("profiles-kind-picker");
    expect(screen.getByTestId("profiles-scope-what")).toBeInTheDocument();
    expect(screen.getByTestId("profiles-scope-when").className).toContain(
      "border-t",
    );
  });
});

describe("a page about one resource, with nothing profiled", () => {
  test("the first steps alone - no bar to pick from - and the page is told there are none", async () => {
    scenario.types = [];
    scenario.everTypes = [];
    const told: MockFunction = getJestMockFunction();

    await renderOverview("", {
      lockedEntityId: SERVICE_ID,
      onHasProfiles: (hasProfiles: boolean): void => {
        told(hasProfiles);
      },
    });

    expect(
      await screen.findByTestId("profiles-first-steps"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("profiles-scope-bar")).toBeNull();
    await waitFor(() => {
      expect(told).toHaveBeenLastCalledWith(false);
    });
  });

  test("isEmptyHidden: nothing at all, for a page that says it itself", async () => {
    scenario.types = [];
    scenario.everTypes = [];

    await renderOverview("", {
      lockedEntityId: SERVICE_ID,
      isEmptyHidden: true,
    });

    await waitFor(() => {
      expect(requests("/profile-types")).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("profiles-headline")).toBeNull();
    });
    expect(screen.queryByTestId("profiles-first-steps")).toBeNull();
    expect(screen.queryByTestId("profiles-scope-bar")).toBeNull();
  });

  test("a resource with profiles tells the page so", async () => {
    const told: MockFunction = getJestMockFunction();

    await renderOverview("", {
      lockedEntityId: SERVICE_ID,
      onHasProfiles: (hasProfiles: boolean): void => {
        told(hasProfiles);
      },
    });

    await screen.findByTestId("profiles-headline");
    await waitFor(() => {
      expect(told).toHaveBeenLastCalledWith(true);
    });
  });

  test("a service picked in the Profiler with nothing profiled keeps the bar, to pick another", async () => {
    scenario.types = [];
    scenario.everTypes = [];

    await renderOverview(`?serviceId=${SERVICE_ID}`);

    expect(
      await screen.findByTestId("profiles-first-steps"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("profiles-scope-bar")).toBeInTheDocument();
    expect(screen.getByTestId("profiles-service-picker")).toBeInTheDocument();
  });
});

describe("compared across a change", () => {
  test("a change the menu lists is named in the headline, with when it happened", async () => {
    const changeTime: Date = new Date(Date.now() - 40 * 60 * 1000);
    analyticsListMock.mockImplementation(async () => {
      return {
        data: [{ time: changeTime, title: "v2.4.0", eventType: "deployment" }],
        count: 1,
      };
    });

    await renderOverview(
      `?serviceId=${SERVICE_ID}&compare=change&changeTime=${encodeURIComponent(
        changeTime.toISOString(),
      )}`,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
        "Compared with before the change 40 minutes ago (Deploy: v2.4.0).",
      );
    });
  });

  test("a change older than the menu's week is said by its time", async () => {
    const changeTime: Date = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);

    await renderOverview(
      `?serviceId=${SERVICE_ID}&compare=change&changeTime=${encodeURIComponent(
        changeTime.toISOString(),
      )}`,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
        "Compared with before the change at",
      );
    });
    expect(screen.getByTestId("profiles-headline-text")).not.toHaveTextContent(
      "Deploy:",
    );
  });
});

describe("the words fit every kind of profile", () => {
  test("Self and Total are explained without 'time', for memory as for CPU", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}&profileType=memory`);

    const explained: HTMLElement = await screen.findByTestId(
      "profiles-functions-explained",
    );

    expect(explained).toHaveTextContent(
      "Self counts only the function's own code. Total adds everything it calls.",
    );
    expect(explained.textContent).not.toContain("time");
  });

  test("Your code says what a change can win back, not the time", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);
    await screen.findByTestId("profiles-functions");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-functions-view-own"));
    });

    expect(
      await screen.findByTestId("profiles-functions-explained"),
    ).toHaveTextContent(
      "Your own functions, each with the library and runtime code it calls: what a change to it can win back.",
    );
  });
});

describe("the function list's rows", () => {
  test("Your code lists only the application's own code, so its rows leave out whose code each is", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const list: HTMLElement = await screen.findByTestId("profiles-functions");
    expect(
      within(list).getAllByTestId("profiles-function-origin").length,
    ).toBeGreaterThan(0);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-functions-view-own"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("profiles-functions")).toHaveAttribute(
        "data-view",
        "own",
      );
    });
    expect(
      within(screen.getByTestId("profiles-functions")).queryAllByTestId(
        "profiles-function-origin",
      ),
    ).toHaveLength(0);
  });

  test("a row's highlight button is quiet but visible, in both themes' grays", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const highlight: HTMLElement = (
      await screen.findAllByTestId("profiles-function-highlight")
    )[0]!;

    expect(highlight.className).toContain("text-gray-400");
    expect(highlight.className).not.toContain("text-gray-300");
    expect(highlight).toHaveAttribute("aria-label");
  });
});

describe("the function panel's figures and the fix strip", () => {
  const PARSE_ORDER: string = `?serviceId=${SERVICE_ID}&function=parseOrder&file=src%2Forders%2Fparse.ts`;

  test("each share sits at the bottom of its box, so long hints never push one figure lower than the others", async () => {
    await renderOverview(PARSE_ORDER);

    const panel: HTMLElement = await screen.findByTestId("profiles-panel");
    await within(panel).findByTestId("profiles-panel-own");

    for (const testId of [
      "profiles-panel-self",
      "profiles-panel-total",
      "profiles-panel-own",
    ]) {
      const figure: HTMLElement = within(panel).getByTestId(testId);
      const box: HTMLElement = within(panel).getByTestId(`${testId}-box`);

      // From sm, a column with the figure at its bottom.
      expect(figure.className.split(" ")).toContain("sm:mt-auto");
      expect(box.className.split(" ")).toContain("sm:flex-col");
      expect(figure.parentElement).toBe(box);
    }
  });

  /*
   * On a phone the three boxes stacked took about 500 pixels, and pushed
   * Fix with AI below the fold: each is one row there - what it counts on
   * the left, spanning both lines, and the figure over its value on the
   * right.
   */
  test("on a phone each figure is one row: what it counts on the left, the figure on the right", async () => {
    await renderOverview(PARSE_ORDER);

    const panel: HTMLElement = await screen.findByTestId("profiles-panel");
    await within(panel).findByTestId("profiles-panel-own");

    for (const testId of [
      "profiles-panel-self",
      "profiles-panel-total",
      "profiles-panel-own",
    ]) {
      const box: HTMLElement = within(panel).getByTestId(`${testId}-box`);
      const classes: Array<string> = box.className.split(" ");
      const label: HTMLElement = box.querySelector("dt") as HTMLElement;
      const figure: HTMLElement = within(panel).getByTestId(testId);

      expect(classes).toEqual(
        expect.arrayContaining([
          "grid",
          "grid-cols-[minmax(0,1fr)_auto]",
          "sm:flex",
        ]),
      );
      expect(label.className.split(" ")).toEqual(
        expect.arrayContaining(["row-span-2", "sm:row-span-1"]),
      );
      expect(figure.className.split(" ")).toEqual(
        expect.arrayContaining(["text-right", "sm:text-left"]),
      );
    }
  });

  test("what stands in the way is said in the strip's own amber, not in a box inside it", async () => {
    scenario.fixOffer = SuggestionOffer.SetUp;
    scenario.fixBlockerType = "NoAiCredits";
    await renderOverview(PARSE_ORDER);

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");
    const blocker: HTMLElement =
      await within(strip).findByTestId("code-blocker");

    expect(blocker).toHaveAttribute("data-blocker", "NoAiCredits");
    expect(blocker.className).not.toContain("rounded-lg");
    expect(blocker.className).not.toContain("px-4");
    expect(blocker.className).not.toContain("bg-amber-50");
  });

  test("waiting for a repository to be picked, Fix with AI looks it", async () => {
    scenario.fixRepositories = [
      { id: "90000000-0000-4000-8000-0000000000c1", name: "acme/checkout" },
      { id: "90000000-0000-4000-8000-0000000000c2", name: "acme/platform" },
    ];
    await renderOverview(PARSE_ORDER);

    const strip: HTMLElement = await screen.findByTestId("profiles-fix");
    const button: HTMLElement = await within(strip).findByTestId(
      "profiles-fix-with-ai",
    );

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:opacity-50");
    expect(button.className).toContain("disabled:cursor-not-allowed");
    expect(
      within(strip).getByTestId("profiles-fix-repository"),
    ).toHaveTextContent("Which repository holds this code?");
  });
});

describe("the flame graph cards", () => {
  test("comparing, the card is titled What changed and leaves the colours to the graph's legend", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}&compare=previous`);

    await screen.findByTestId("profiles-flame-compare");
    await waitFor(() => {
      expect(diffMock).toHaveBeenCalled();
    });

    expect(screen.getByText("What changed")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Red frames take");
  });
});

describe("a read that fails", () => {
  /*
   * The headline is read from the functions. When that read failed it said
   * "No CPU time profiles in this window." beside a flame graph full of
   * them: now it says nothing, and the functions card says what failed.
   */
  test("the functions failing: no headline claims there are no profiles, and the card offers a retry", async () => {
    scenario.failRoutes = ["/telemetry/profiles/function-list"];

    await renderOverview(`?serviceId=${SERVICE_ID}`);

    expect(
      await screen.findByText("The profile store is unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("profiles-headline")).toBeNull();
    expect(screen.queryByTestId("profiles-headline-loading")).toBeNull();
    expect(
      screen.queryByText("No CPU time profiles in this window."),
    ).toBeNull();
    // The flame graph reads on its own, and still draws.
    expect(screen.getByTestId("profiles-flame")).toBeInTheDocument();

    // The store answering again, a retry brings the answer back.
    scenario.failRoutes = [];
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
        "JSON.parse takes 42% of the CPU time in checkout.",
      );
    });
  });

  test("comparing, the comparison failing: the same - no headline, the card says it", async () => {
    scenario.failRoutes = ["/telemetry/profiles/function-comparison"];

    await renderOverview(`?serviceId=${SERVICE_ID}&compare=previous`);

    expect(
      await screen.findByText("The profile store is unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("profiles-headline")).toBeNull();
    expect(
      screen.queryByText("No CPU time profiles in this window."),
    ).toBeNull();
  });

  test("a window whose function list really is empty still says so, in words of its own", async () => {
    scenario.functions = [];

    await renderOverview(`?serviceId=${SERVICE_ID}`);

    expect(
      await screen.findByTestId("profiles-functions-empty"),
    ).toHaveTextContent("No functions were sampled in this window.");
    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "No CPU time profiles in this window.",
    );
  });
});

describe("the column the list is ranked by reads first", () => {
  test("Self: its share in bold over its value, Total quieter and alone", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);

    const row: HTMLElement = (
      await screen.findAllByTestId("profiles-function-row")
    )[0]!;
    const self: HTMLElement = within(row).getByTestId("profiles-function-self");
    const total: HTMLElement = within(row).getByTestId(
      "profiles-function-total",
    );

    expect(self).toHaveAttribute("data-ranked", "true");
    expect(self.className.split(" ")).toContain("font-semibold");
    expect(self.parentElement!.children).toHaveLength(2);
    expect(total).toHaveAttribute("data-ranked", "false");
    expect(total.className.split(" ")).not.toContain("font-semibold");
    expect(total.parentElement!.children).toHaveLength(1);
  });

  /*
   * Ranked by Total, the bold figure was still Self - 0% for every
   * function that does its work in what it calls.
   */
  test("Total: the bold figure and the value move to Total, on a laptop and on a phone", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}`);
    await screen.findByTestId("profiles-functions");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("profiles-functions-view-total"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("profiles-functions")).toHaveAttribute(
        "data-view",
        "total",
      );
    });

    const row: HTMLElement = screen.getAllByTestId("profiles-function-row")[0]!;
    // handleCheckout: 95% with what it calls, none of its own.
    expect(row).toHaveTextContent("handleCheckout");

    const total: HTMLElement = within(row).getByTestId(
      "profiles-function-total",
    );
    const self: HTMLElement = within(row).getByTestId("profiles-function-self");

    expect(total).toHaveAttribute("data-ranked", "true");
    expect(total).toHaveTextContent("95%");
    expect(total.parentElement!.children).toHaveLength(2);
    expect(self).toHaveAttribute("data-ranked", "false");
    expect(self).toHaveTextContent("0%");

    // A phone's line under the name leads with Total, and its value.
    expect(
      within(row).getByTestId("profiles-function-shares-compact"),
    ).toHaveTextContent("Total 95% · 950 nsSelf 0%");
  });
});

describe("what changed, on a phone", () => {
  /*
   * Beside the name, "21% → 42%" and its points left a phone's function
   * names cut to a few letters: below sm they go under the name.
   */
  test("each row's change sits under the name below sm, and beside it from sm", async () => {
    await renderOverview(`?serviceId=${SERVICE_ID}&compare=previous`);

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "profiles-function-row",
    );

    for (const row of rows) {
      const compact: HTMLElement = within(row).getByTestId(
        "profiles-function-change-compact",
      );
      const side: HTMLElement = within(row).getByTestId(
        "profiles-function-change",
      ).parentElement!;

      expect(compact.className.split(" ")).toContain("sm:hidden");
      expect(compact).toHaveTextContent("points");
      expect(side.className.split(" ")).toEqual(
        expect.arrayContaining(["max-sm:hidden", "sm:block"]),
      );
    }

    expect(rows[0]).toHaveTextContent("JSON.parse");
    expect(
      within(rows[0]!).getByTestId("profiles-function-change-compact"),
    ).toHaveTextContent("21% → 42%+21.0 points");
  });
});

describe("words that fit memory as well as time", () => {
  /*
   * "Nothing: all its time is its own." read wrong for memory, where no
   * time is counted at all; "To spend less time here" too.
   */
  test("a function that calls nothing says so without 'time', in memory as in CPU", async () => {
    await renderOverview(
      `?serviceId=${SERVICE_ID}&function=JSON.parse&file=node%3Ainternal%2Fjson&profileType=memory`,
    );

    const panel: HTMLElement = await screen.findByTestId("profiles-panel");

    await waitFor(() => {
      expect(
        within(panel).getByTestId("profiles-panel-callees"),
      ).toHaveTextContent("What it callsIt calls no other function.");
    });
    expect(
      within(panel).getByTestId("profiles-panel-not-yours"),
    ).toHaveTextContent(
      "This is not your code: change how your code calls it, starting with handleCheckout.",
    );
    expect(panel).not.toHaveTextContent("time is its own");
    expect(panel).not.toHaveTextContent("To spend less time here");
  });

  test("a function nothing calls says where its call stacks start, in plain words", async () => {
    await renderOverview(
      `?serviceId=${SERVICE_ID}&function=main&file=src%2Fserver.ts`,
    );

    const panel: HTMLElement = await screen.findByTestId("profiles-panel");

    await waitFor(() => {
      expect(
        within(panel).getByTestId("profiles-panel-callers"),
      ).toHaveTextContent(
        "Who calls itNothing calls it: its call stacks start here.",
      );
    });
  });
});
