import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The status page guided setup, step by step (issue #6806): from a name and
 * the monitors it shows to a public page whose owner has seen what
 * customers see. Each step saves real records through the model API
 * (mocked here at StatusPageSetupApi); nothing is picked to start with; it
 * says the page is public before it creates it; it never finishes with an
 * empty page; leaving and coming back resumes at the first step not done
 * with nothing made twice; and the summary's optional settings say their
 * plans on Cloud.
 */

const api: Record<string, MockFunction> = {
  loadMonitors: getJestMockFunction(),
  loadMonitorGroups: getJestMockFunction(),
  loadEditableStatusPages: getJestMockFunction(),
  findOwnStatusPage: getJestMockFunction(),
  createStatusPage: getJestMockFunction(),
  addMonitors: getJestMockFunction(),
  loadStatusPage: getJestMockFunction(),
  loadShownMonitors: getJestMockFunction(),
};
let mayCreate: boolean = true;

/*
 * The server's guided setup runs (#7253), in memory: the store reads and
 * writes them as it would the server's (GuidedSetupRunServerMock).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupRunApi",
  () => {
    return (
      jest.requireActual("./GuidedSetupRunServerMock") as {
        guidedSetupRunApiModule: unknown;
      }
    ).guidedSetupRunApiModule;
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi",
  () => {
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadMonitors",
      "loadMonitorGroups",
      "loadEditableStatusPages",
      "findOwnStatusPage",
      "createStatusPage",
      "addMonitors",
      "loadStatusPage",
      "loadShownMonitors",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    return {
      __esModule: true,
      default: calls,
      mayCreateStatusPage: (): boolean => {
        return mayCreate;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        dataTestId?: string;
      }) => {
        return (
          <a href={props.to.toString()} data-testid={props.dataTestId}>
            {props.children}
          </a>
        );
      },
    };
  },
);

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import StatusPageGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import {
  STATUS_PAGE_SETUP_COPY,
  STATUS_PAGE_SETUP_MONITOR_QUERY,
  StatusPageSetupMonitor,
  getMonitorPickedOnOpen,
  isSameStatusPageName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  guidedSetupRunServer,
  readKeptRunValues,
} from "./GuidedSetupRunServerMock";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006806";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";
const PAGE_ID: string = "70000000-0000-4000-8000-000000000001";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "status_page",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const MONITORS: Array<Record<string, string>> = [
  {
    id: "m-api",
    name: "API",
    statusName: "Operational",
    statusColor: "#10b981",
  },
  { id: "m-web", name: "Website", statusName: "Operational" },
  { id: "m-db", name: "Database" },
];

let isBillingEnabled: boolean = false;

const storedRun: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return readKeptRunValues(window.localStorage.getItem(RUN_KEY)) as Record<
    string,
    unknown
  >;
};

const keepRun: (run: Record<string, unknown>) => void = (
  run: Record<string, unknown>,
): void => {
  window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
};

const renderSetup: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(<StatusPageGuidedSetup isBillingEnabled={isBillingEnabled} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByTestId("guided-setup") ||
        screen.queryByTestId("guided-setup-not-allowed"),
    ).toBeInTheDocument();
  });
};

const stepState: (key: string) => string | null = (
  key: string,
): string | null => {
  return screen
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
};

const press: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const sent: (name: ProductEventName) => Array<Record<string, unknown>> = (
  name: ProductEventName,
): Array<Record<string, unknown>> => {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    });
};

const nameField: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByTestId(
    "guided-setup-status-page-name",
  ) as HTMLInputElement;
};

beforeEach(() => {
  guidedSetupRunServer.reset();
  window.localStorage.clear();
  mayCreate = true;
  isBillingEnabled = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  const project: Project = new Project();
  project.name = "Acme";
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));

  api["loadMonitors"]!.mockResolvedValue(MONITORS);
  // A project with no monitor group and no status page yet.
  api["loadMonitorGroups"]!.mockResolvedValue([]);
  api["loadEditableStatusPages"]!.mockResolvedValue([]);
  api["findOwnStatusPage"]!.mockResolvedValue(null);
  api["createStatusPage"]!.mockResolvedValue(PAGE_ID);
  api["addMonitors"]!.mockResolvedValue({
    succeeded: [],
    skipped: [],
    failed: [],
  });
  api["loadStatusPage"]!.mockResolvedValue({
    id: PAGE_ID,
    name: "Acme Status",
  });
  api["loadShownMonitors"]!.mockResolvedValue({
    count: 2,
    names: ["API", "Database"],
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  sendMock.mockReset();
  window.localStorage.clear();
});

/*
 * What the setup sets up, beside the steps (#8897), in the order listed:
 * each step's outcome, whatever records the panel lists under it (#10276).
 */
const outcomesBeside: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen
      .getByTestId("guided-setup-aside")
      .querySelectorAll(
        '[data-testid^="guided-setup-outcome-"][data-testid$="-text"]',
      ),
  ).map((item: Element): string => {
    return item.textContent || "";
  });
};

describe("a brand-new run", () => {
  test("beside the steps, what it sets up, the first one open, and about how long", async () => {
    await renderSetup();

    expect(outcomesBeside()).toEqual([
      "A status page shows your monitors, with their status and uptime.",
      "Your customers see it at its own address.",
    ]);
    expect(screen.getByTestId("guided-setup-outcome-pick")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      /^About 3\sminutes$/,
    );
  });

  test("opens on step 1 with both steps in view, and makes nothing by opening", async () => {
    await renderSetup();

    expect(stepState("pick")).toBe("open");
    expect(stepState("review")).toBe("upcoming");
    expect(screen.getByTestId("guided-setup-progress")).toHaveTextContent(
      "0 of 2 steps done",
    );
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "status_page" },
    ]);
    expect(sent(ProductEventName.GuidedSetupStepReached)).toEqual([
      { setup: "status_page", step: "pick", step_number: 1 },
    ]);
  });

  test("the name starts as the project's", async () => {
    await renderSetup();

    expect(nameField().value).toBe("Acme Status");
  });

  test("lists every monitor, with none ticked: a public page shows only what someone chose", async () => {
    await renderSetup();

    for (const monitor of MONITORS) {
      expect(
        screen.getByTestId(`guided-setup-monitor-${monitor["id"]}`),
      ).not.toBeChecked();
    }
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 3 picked",
    );
  });

  test("says the page is public before it is created", async () => {
    await renderSetup();

    expect(screen.getByTestId("guided-setup-public-notice")).toHaveTextContent(
      STATUS_PAGE_SETUP_COPY.publicNotice,
    );
  });
});

/*
 * OPENED FOR ONE MONITOR (#7053): the website-down setup's summary offers
 * this setup for the monitor it set up, while the project has no status
 * page to add it to, and the person chose to show that monitor: it starts
 * ticked, and nothing else is.
 */
describe("opened for one monitor, from the website setup's summary (#7053)", () => {
  const openedFor: (search: string) => void = (search: string): void => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/status-pages/setup${search}`,
    );
  };

  afterEach(() => {
    openedFor("");
  });

  test("that monitor starts ticked, and nothing else", async () => {
    const chosen: string = MONITORS[1]!["id"] as string;

    openedFor(`?monitorId=${chosen}&from=website_down_summary`);
    await renderSetup();

    for (const monitor of MONITORS) {
      const box: HTMLElement = screen.getByTestId(
        `guided-setup-monitor-${monitor["id"]}`,
      );

      if (monitor["id"] === chosen) {
        expect(box).toBeChecked();
      } else {
        expect(box).not.toBeChecked();
      }
    }
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "1 of 3 picked",
    );
    // Opened from the website setup's summary, and started says so.
    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "status_page", from: "website_down_summary" },
    ]);
  });

  test("an id that names none of the project's monitors ticks nothing", async () => {
    openedFor("?monitorId=50000000-0000-4000-8000-00000000dead");
    await renderSetup();

    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 3 picked",
    );
  });

  test("Create the status page puts that monitor on it", async () => {
    const chosen: string = MONITORS[0]!["id"] as string;

    openedFor(`?monitorId=${chosen}`);
    await renderSetup();
    await press("guided-setup-create-status-page");

    expect(api["addMonitors"]).toHaveBeenCalledTimes(1);
    expect(
      (
        api["addMonitors"]!.mock.calls[0]![0] as {
          monitors: Array<{ id: string }>;
        }
      ).monitors.map((monitor: { id: string }): string => {
        return monitor.id;
      }),
    ).toEqual([chosen]);
  });

  test("the rule: the monitor named, among the project's, or nothing", () => {
    const monitors: Array<StatusPageSetupMonitor> = [
      { id: "a", name: "API" },
      { id: "b", name: "Database" },
    ];

    expect(getMonitorPickedOnOpen({ monitorId: "b", monitors })).toEqual(["b"]);
    expect(getMonitorPickedOnOpen({ monitorId: "z", monitors })).toEqual([]);
    expect(getMonitorPickedOnOpen({ monitorId: null, monitors })).toEqual([]);
    expect(getMonitorPickedOnOpen({ monitorId: "", monitors })).toEqual([]);
    expect(STATUS_PAGE_SETUP_MONITOR_QUERY).toBe("monitorId");
  });
});

/*
 * OPENED FROM AN ASK AI PLAN (#7245): its card's Open in guided setup
 * opens this setup with the page's name the plan names (?name=): a page of
 * the project's by that name is the one the monitors go on, and a new page
 * takes the name otherwise.
 */
describe("opened from an Ask AI setup plan (#7245)", () => {
  const openedFor: (search: string) => void = (search: string): void => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/status-pages/setup${search}`,
    );
  };

  afterEach(() => {
    openedFor("");
  });

  test("a new page takes the name the plan gives it, and started says it came from Ask AI", async () => {
    openedFor("?from=ask_ai&name=Acme%20Uptime");
    await renderSetup();

    expect(nameField().value).toBe("Acme Uptime");
    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "status_page", from: "ask_ai" },
    ]);
  });

  test("a page of the project's by that name is the one it goes on with", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([
      { id: "70000000-0000-4000-8000-000000007601", name: "Walk Co Status" },
      { id: "70000000-0000-4000-8000-000000007602", name: "Customer Status" },
    ]);
    api["loadShownMonitors"]!.mockResolvedValue({
      count: 0,
      names: [],
      monitorIds: [],
      monitorGroupIds: [],
    });

    openedFor("?from=ask_ai&name=customer%20status");
    await renderSetup();

    // An existing page is picked - the one the plan names - and no name is asked.
    expect(
      screen.queryByTestId("guided-setup-status-page-name"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("guided-setup-existing-page")).getByText(
        "Customer Status",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("guided-setup-existing-page")).queryByText(
        "Walk Co Status",
      ),
    ).not.toBeInTheDocument();
  });

  test("a name none of the project's pages has makes a new page by it, beside the pages it has", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([
      { id: "70000000-0000-4000-8000-000000007601", name: "Walk Co Status" },
    ]);
    api["loadShownMonitors"]!.mockResolvedValue({
      count: 0,
      names: [],
      monitorIds: [],
      monitorGroupIds: [],
    });

    openedFor("?from=ask_ai&name=Acme%20Uptime");
    await renderSetup();

    expect(nameField().value).toBe("Acme Uptime");
  });
});

describe("1. Name it, and pick what it shows", () => {
  test("Select all ticks every monitor, and Clear unticks them", async () => {
    await renderSetup();
    await press("guided-setup-select-all");

    for (const monitor of MONITORS) {
      expect(
        screen.getByTestId(`guided-setup-monitor-${monitor["id"]}`),
      ).toBeChecked();
    }
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "3 of 3 picked",
    );

    await press("guided-setup-clear-all");
    expect(screen.getByTestId("guided-setup-monitor-m-api")).not.toBeChecked();
  });

  test("nothing picked is said, and makes no page: it would be empty", async () => {
    await renderSetup();
    await press("guided-setup-create-status-page");

    expect(
      screen.getByText(STATUS_PAGE_SETUP_COPY.nothingPicked),
    ).toBeInTheDocument();
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(stepState("pick")).toBe("open");
  });

  test("a name too short is said, and makes nothing", async () => {
    await renderSetup();
    fireEvent.change(nameField(), { target: { value: "A" } });
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(
      screen.getByText(STATUS_PAGE_SETUP_COPY.nameError),
    ).toBeInTheDocument();
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
  });

  test("creates the page with the name, then puts the monitors picked on it in the list's order", async () => {
    await renderSetup();
    fireEvent.change(nameField(), { target: { value: "Acme Public Status" } });
    await press("guided-setup-monitor-m-db");
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).toHaveBeenCalledWith("Acme Public Status");
    expect(api["addMonitors"]).toHaveBeenCalledTimes(1);
    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: PAGE_ID,
      monitors: [MONITORS[0], MONITORS[2]],
    });
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
    // A page made, not found: nothing says otherwise.
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("looks for this person's own page with the name before it makes one (#7252)", async () => {
    await renderSetup();
    fireEvent.change(nameField(), { target: { value: "Acme Public Status" } });
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(api["findOwnStatusPage"]).toHaveBeenCalledTimes(1);
    expect(api["findOwnStatusPage"]).toHaveBeenCalledWith({
      name: "Acme Public Status",
      userId: USER_ID,
    });
    expect(api["findOwnStatusPage"]!.mock.invocationCallOrder[0]!).toBeLessThan(
      api["createStatusPage"]!.mock.invocationCallOrder[0]!,
    );
  });

  test("a run whose page is known adds to it and looks for nothing", async () => {
    keepRun({ statusPageId: PAGE_ID });
    api["loadShownMonitors"]!.mockResolvedValue({ count: 0, names: [] });
    await renderSetup();

    api["loadShownMonitors"]!.mockResolvedValue({ count: 1, names: ["API"] });
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(api["findOwnStatusPage"]).not.toHaveBeenCalled();
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("once the page shows them, step 1 folds to its line and the review opens", async () => {
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(stepState("pick")).toBe("done");
    expect(
      screen.getByTestId("guided-setup-step-pick-done-line"),
    ).toHaveTextContent('"Acme Status" shows 2 monitors.');
    expect(stepState("review")).toBe("open");
  });

  /*
   * #10276: the panel lists the page and what it shows as they are made,
   * each opening its page, and keeps how they got on with the run (#7253).
   */
  test("the panel shows the page being made, then made, and the monitors added, each with Open", async () => {
    let finishCreate: (id: string) => void = () => {};
    api["createStatusPage"]!.mockImplementation((() => {
      return new Promise<string>((resolve: (id: string) => void) => {
        finishCreate = resolve;
      });
    }) as unknown as (...args: Array<unknown>) => unknown);
    await renderSetup();

    const pageRow: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId("guided-setup-resource-status_page");
    };
    const shownRow: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId("guided-setup-resource-shown_monitors");
    };

    expect(pageRow()).toHaveAttribute("data-status", "waiting");
    expect(
      screen.getByTestId("guided-setup-resource-status_page-name"),
    ).toHaveTextContent("Acme Status");
    expect(shownRow()).toHaveAttribute("data-status", "waiting");

    await press("guided-setup-monitor-m-api");
    // What is picked names the row before it is added.
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-name"),
    ).toHaveTextContent("API");

    await press("guided-setup-create-status-page");
    expect(pageRow()).toHaveAttribute("data-status", "creating");

    await act(async () => {
      finishCreate(PAGE_ID);
    });

    expect(pageRow()).toHaveAttribute("data-status", "created");
    expect(
      screen.getByTestId("guided-setup-resource-status_page-open"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${PAGE_ID}`,
    );
    expect(shownRow()).toHaveAttribute("data-status", "created");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-status"),
    ).toHaveTextContent("Added");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-name"),
    ).toHaveTextContent("API, Database");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-open"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${PAGE_ID}/resources`,
    );

    // Kept with the run, so another device draws the same panel.
    await waitFor(() => {
      expect(
        guidedSetupRunServer.resourcesOf("status_page")?.["status_page"]
          ?.status,
      ).toBe("created");
    });
    expect(
      guidedSetupRunServer.resourcesOf("status_page")?.["shown_monitors"]
        ?.status,
    ).toBe("created");
  });

  test("a page the server refused says why, and Try again makes one page", async () => {
    api["createStatusPage"]!.mockRejectedValueOnce(
      new Error("OneUptime is busy and could not save this."),
    );
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(
      screen.getByTestId("guided-setup-resource-status_page"),
    ).toHaveAttribute("data-status", "failed");
    expect(
      screen.getByTestId("guided-setup-resource-status_page-error"),
    ).toHaveTextContent("OneUptime is busy and could not save this.");
    expect(stepState("pick")).toBe("open");

    await press("guided-setup-resource-status_page-retry");

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId("guided-setup-resource-status_page"),
    ).toHaveAttribute("data-status", "created");
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
    expect(stepState("review")).toBe("open");
  });

  test("a page of the project's is in use, never made, and the panel says so", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([
      { id: PAGE_ID, name: "Acme Partner Status" },
    ]);
    api["loadShownMonitors"]!.mockResolvedValue({
      count: 0,
      names: [],
      monitorIds: [],
      monitorGroupIds: [],
    });
    await renderSetup();

    // Picked for step 1: in use before anything is pressed.
    expect(
      screen.getByTestId("guided-setup-resource-status_page"),
    ).toHaveAttribute("data-status", "existing");
    expect(
      screen.getByTestId("guided-setup-resource-status_page-name"),
    ).toHaveTextContent("Acme Partner Status");

    api["loadShownMonitors"]!.mockResolvedValue({ count: 1, names: ["API"] });
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("guided-setup-resource-status_page"),
    ).toHaveAttribute("data-status", "existing");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors"),
    ).toHaveAttribute("data-status", "created");
  });

  test("monitors that could not be added keep step 1 open with the reason, and the page is kept", async () => {
    api["addMonitors"]!.mockRejectedValue(new Error("Plan limit reached"));
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(
      within(screen.getByTestId("guided-setup-step-pick")).getByText(
        "Plan limit reached",
      ),
    ).toBeInTheDocument();
    expect(stepState("pick")).toBe("open");
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
    // The panel (#10276): the page made, its monitors not added, and why.
    expect(
      screen.getByTestId("guided-setup-resource-status_page"),
    ).toHaveAttribute("data-status", "created");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors"),
    ).toHaveAttribute("data-status", "failed");
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-error"),
    ).toHaveTextContent("Plan limit reached");
  });

  test("a page the server says shows nothing does not move on", async () => {
    api["loadShownMonitors"]!.mockResolvedValue({ count: 0, names: [] });
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(stepState("pick")).toBe("open");
    expect(stepState("review")).toBe("upcoming");
  });

  test("a project with no monitor is offered the website setup first, and no page is made", async () => {
    api["loadMonitors"]!.mockResolvedValue([]);
    await renderSetup();

    expect(screen.getByTestId("guided-setup-no-monitors")).toHaveTextContent(
      STATUS_PAGE_SETUP_COPY.noMonitors,
    );
    expect(screen.getByTestId("guided-setup-set-up-monitor")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/setup`,
    );
    expect(
      screen.queryByTestId("guided-setup-create-status-page"),
    ).not.toBeInTheDocument();
  });

  test("someone who may not create a status page is told so, with the way to Status Pages", async () => {
    mayCreate = false;
    await renderSetup();

    expect(screen.getByTestId("guided-setup-not-allowed")).toHaveTextContent(
      STATUS_PAGE_SETUP_COPY.cannotCreate,
    );
    expect(screen.queryByTestId("guided-setup")).not.toBeInTheDocument();
  });
});

describe("2. This is what your customers see", () => {
  const reachReview: () => Promise<void> = async (): Promise<void> => {
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-monitor-m-db");
    await press("guided-setup-create-status-page");
  };

  test("shows the page as a visitor reads it: its name and each monitor with its status", async () => {
    await reachReview();

    const preview: HTMLElement = screen.getByTestId("guided-setup-preview");
    expect(preview).toHaveTextContent("Acme Status");
    expect(preview).toHaveTextContent("API");
    expect(preview).toHaveTextContent("Operational");
    expect(preview).toHaveTextContent("Database");
  });

  /*
   * #7467: the public page names itself by its Page Title, else its name,
   * and the preview says the same. A new page has no Page Title: its name.
   */
  test("names a new page by its name, as its public page's header and tab do", async () => {
    await reachReview();

    expect(screen.getByTestId("guided-setup-preview-name")).toHaveTextContent(
      /^Acme Status$/,
    );
  });

  test("names a page with a Page Title by it, as its visitors read it, never by its own name", async () => {
    api["loadStatusPage"]!.mockResolvedValue({
      id: PAGE_ID,
      name: "acme-prod",
      pageTitle: "Acme Status",
    });
    keepRun({ statusPageId: PAGE_ID });
    await renderSetup();

    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-preview-name")).toHaveTextContent(
        /^Acme Status$/,
      );
    });
    expect(screen.getByTestId("guided-setup-preview")).not.toHaveTextContent(
      "acme-prod",
    );
  });

  test("gives the public link, opening in a new tab", async () => {
    await reachReview();

    const link: HTMLElement = screen.getByTestId("guided-setup-public-link");
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/status-page/${PAGE_ID}$`),
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("says what appears by itself, what never does, and what is posted by hand", async () => {
    await reachReview();

    const appears: HTMLElement = screen.getByTestId(
      "guided-setup-what-appears",
    );
    expect(appears).toHaveTextContent(STATUS_PAGE_SETUP_COPY.incidentsAppear);
    expect(appears).toHaveTextContent(STATUS_PAGE_SETUP_COPY.alertsNever);
    expect(appears).toHaveTextContent(STATUS_PAGE_SETUP_COPY.postedByYou);
  });

  test("Looks good keeps the review in the run, shows the summary and finishes the setup", async () => {
    await reachReview();
    await press("guided-setup-review-continue");

    expect(storedRun()).toEqual({ statusPageId: PAGE_ID, reviewed: true });
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(stepState("review")).toBe("done");
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
    expect(sent(ProductEventName.GuidedSetupFinished)[0]).toMatchObject({
      setup: "status_page",
    });
  });

  test("the setup is not finished before the review", async () => {
    await reachReview();

    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(0);
  });
});

describe("the summary", () => {
  const reachSummary: () => Promise<void> = async (): Promise<void> => {
    keepRun({ statusPageId: PAGE_ID, reviewed: true });
    await renderSetup();
  };

  test("says the page is live, its address and what it shows, from the records", async () => {
    await reachSummary();

    const summary: HTMLElement = screen.getByTestId("guided-setup-summary");
    expect(summary).toHaveTextContent('"Acme Status" is live');
    expect(screen.getByTestId("guided-setup-summary-shows")).toHaveTextContent(
      "API, Database",
    );
    expect(
      screen.getByTestId("guided-setup-summary-address"),
    ).toHaveTextContent(`/status-page/${PAGE_ID}`);
  });

  test("offers the four optional settings, each opening this page's real setting", async () => {
    await reachSummary();

    expect(
      screen.getByTestId("guided-setup-extra-domain").querySelector("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${PAGE_ID}/domains`,
    );
    expect(
      screen
        .getByTestId("guided-setup-extra-private")
        .querySelector("a")
        ?.getAttribute("href"),
    ).toContain(`/status-pages/${PAGE_ID}/`);
    expect(
      screen.getByTestId("guided-setup-extra-branding"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-extra-subscribers"),
    ).toBeInTheDocument();
  });

  test("names no plan on a self-hosted server", async () => {
    await reachSummary();

    expect(
      screen.queryByTestId("guided-setup-extra-private-plan"),
    ).not.toBeInTheDocument();
  });

  test("on Cloud, says the plan each one needs", async () => {
    isBillingEnabled = true;
    await reachSummary();

    expect(
      screen.getByTestId("guided-setup-extra-private-plan"),
    ).toHaveTextContent("Growth plan and above");
    expect(
      screen.getByTestId("guided-setup-extra-domain-plan"),
    ).toHaveTextContent("Every plan");
  });

  test("says what is next: an announcement, a maintenance, the page's own settings", async () => {
    await reachSummary();

    expect(screen.getByText("Post a first announcement")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/announcements/create`,
    );
    expect(screen.getByText("Schedule a maintenance")).toBeInTheDocument();
    expect(screen.getByTestId("guided-setup-open-status-page")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${PAGE_ID}`,
    );
  });

  test("Set up another status page starts a new run, with an empty name when the page just set up has the project's (#7252)", async () => {
    await reachSummary();
    await press("guided-setup-start-over");

    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
    expect(stepState("pick")).toBe("open");
    // "Acme Status" is taken by the page just set up: another needs its own.
    expect(nameField().value).toBe("");
    expect(screen.getByTestId("guided-setup-monitor-m-api")).not.toBeChecked();

    // A name is still asked for, and nothing is looked up or made without one.
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(
      screen.getByText(STATUS_PAGE_SETUP_COPY.nameError),
    ).toBeInTheDocument();
    expect(api["findOwnStatusPage"]).not.toHaveBeenCalled();
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
  });

  test("Set up another status page starts with the project's name when the page just set up has a name of its own", async () => {
    api["loadStatusPage"]!.mockResolvedValue({
      id: PAGE_ID,
      name: "Acme Public Status",
    });
    await reachSummary();
    await press("guided-setup-start-over");

    expect(stepState("pick")).toBe("open");
    expect(nameField().value).toBe("Acme Status");
  });
});

describe("leaving and coming back", () => {
  test("a run only the server kept - another device's - opens at the step it was on (#7253)", async () => {
    guidedSetupRunServer.seed("status_page", { statusPageId: PAGE_ID });
    await renderSetup();

    expect(stepState("pick")).toBe("done");
    expect(stepState("review")).toBe("open");
    expect(api["loadStatusPage"]).toHaveBeenCalledWith(PAGE_ID);
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    // And this browser keeps a copy, for when OneUptime is out of reach.
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
  });

  test("a run an older Dashboard kept in this browser is sent to the server the first time it opens (#7253)", async () => {
    keepRun({ statusPageId: PAGE_ID, reviewed: true });
    await renderSetup();

    await waitFor(() => {
      expect(guidedSetupRunServer.valuesOf("status_page")).toEqual({
        statusPageId: PAGE_ID,
        reviewed: true,
      });
    });
  });

  test("a page that shows monitors opens the review, and nothing is made again", async () => {
    keepRun({ statusPageId: PAGE_ID });
    await renderSetup();

    expect(stepState("pick")).toBe("done");
    expect(stepState("review")).toBe("open");
    expect(api["loadStatusPage"]).toHaveBeenCalledWith(PAGE_ID);
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
  });

  test("a page that shows nothing opens step 1 to add to it, never to make a second page", async () => {
    keepRun({ statusPageId: PAGE_ID });
    api["loadShownMonitors"]!.mockResolvedValue({ count: 0, names: [] });
    await renderSetup();

    expect(stepState("pick")).toBe("open");
    expect(screen.getByTestId("guided-setup-empty-page")).toHaveTextContent(
      '"Acme Status" shows nothing yet.',
    );
    expect(
      screen.queryByTestId("guided-setup-status-page-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-public-notice"),
    ).not.toBeInTheDocument();

    api["loadShownMonitors"]!.mockResolvedValue({ count: 1, names: ["API"] });
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(api["addMonitors"]!.mock.calls[0]![0]).toMatchObject({
      statusPageId: PAGE_ID,
    });
    expect(stepState("review")).toBe("open");
  });

  test("a page deleted since starts the run again", async () => {
    keepRun({ statusPageId: PAGE_ID, reviewed: true });
    api["loadStatusPage"]!.mockResolvedValue(null);
    await renderSetup();

    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
    expect(stepState("pick")).toBe("open");
    expect(stepState("review")).toBe("upcoming");
  });

  test("a done step opened again says what the page shows, and where to change it", async () => {
    keepRun({ statusPageId: PAGE_ID, reviewed: true });
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("guided-setup-step-pick").querySelector("button")!,
      );
    });

    expect(stepState("pick")).toBe("open");
    expect(screen.getByText("Change what it shows")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${PAGE_ID}/resources`,
    );
    await press("guided-setup-pick-continue");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });
});

/*
 * A RUN THE BROWSER LOST, OR ANOTHER TAB (#7252): a private window that
 * keeps nothing, another device, storage cleared, or a second tab that
 * made the page while this one was open. What exists on the server
 * decides: a fake server here keeps the status pages - who made each, its
 * name, whether it is archived and the monitors it shows - read through
 * the same name rule the real look-up uses, and step 1 looks there before
 * it makes a page.
 */
describe("a run the browser lost, or another tab (#7252)", () => {
  interface ServerPage {
    id: string;
    name: string;
    createdByUserId: string;
    isArchived: boolean;
    monitorIds: Array<string>;
  }

  const TEAMMATE_ID: string = "40000000-0000-4000-8000-000000000002";

  // The project's status pages as the server keeps them, the oldest first.
  let serverPages: Array<ServerPage> = [];

  const pageOnServer: (id: string) => ServerPage | undefined = (
    id: string,
  ): ServerPage | undefined => {
    return serverPages.find((candidate: ServerPage): boolean => {
      return candidate.id === id;
    });
  };

  const madeOnServer: (data: {
    name: string;
    createdByUserId?: string;
    isArchived?: boolean;
    monitorIds?: Array<string>;
  }) => ServerPage = (data: {
    name: string;
    createdByUserId?: string;
    isArchived?: boolean;
    monitorIds?: Array<string>;
  }): ServerPage => {
    const record: ServerPage = {
      id: `70000000-0000-4000-8000-${String(serverPages.length + 1).padStart(12, "0")}`,
      name: data.name,
      createdByUserId: data.createdByUserId || USER_ID,
      isArchived: Boolean(data.isArchived),
      monitorIds: [...(data.monitorIds || [])],
    };
    serverPages.push(record);
    return record;
  };

  const NOTE: (name: string) => string = (name: string): string => {
    return `You already have a status page named "${name}", so no new one was made.`;
  };

  beforeEach(() => {
    serverPages = [];

    api["createStatusPage"]!.mockImplementation(
      async (name: string): Promise<string> => {
        return madeOnServer({ name: name.trim() }).id;
      },
    );
    api["findOwnStatusPage"]!.mockImplementation(
      async (data: {
        name: string;
        userId: string;
      }): Promise<{ id: string; name: string } | null> => {
        const found: ServerPage | undefined = [...serverPages]
          .reverse()
          .find((candidate: ServerPage): boolean => {
            return (
              candidate.createdByUserId === data.userId &&
              !candidate.isArchived &&
              isSameStatusPageName(candidate.name, data.name)
            );
          });

        return found ? { id: found.id, name: found.name } : null;
      },
    );
    // Add Multiple Monitors' rule: a monitor the page shows is not added twice.
    api["addMonitors"]!.mockImplementation(
      async (data: {
        statusPageId: string;
        monitors: Array<{ id: string }>;
      }): Promise<unknown> => {
        const record: ServerPage | undefined = pageOnServer(data.statusPageId);

        if (!record) {
          throw new Error("Status Page not found");
        }

        for (const monitor of data.monitors) {
          if (!record.monitorIds.includes(monitor.id)) {
            record.monitorIds.push(monitor.id);
          }
        }

        return { succeeded: data.monitors, skipped: [], failed: [] };
      },
    );
    api["loadStatusPage"]!.mockImplementation(
      async (id: string): Promise<{ id: string; name: string } | null> => {
        const record: ServerPage | undefined = pageOnServer(id);
        return record ? { id: record.id, name: record.name } : null;
      },
    );
    api["loadShownMonitors"]!.mockImplementation(
      async (id: string): Promise<{ count: number; names: Array<string> }> => {
        const names: Array<string> = (pageOnServer(id)?.monitorIds || []).map(
          (monitorId: string): string => {
            return (
              MONITORS.find((monitor: Record<string, string>): boolean => {
                return monitor["id"] === monitorId;
              })?.["name"] || ""
            );
          },
        );

        return { count: names.length, names: names };
      },
    );
  });

  const createWith: (data: {
    name: string;
    monitorIds: Array<string>;
  }) => Promise<void> = async (data: {
    name: string;
    monitorIds: Array<string>;
  }): Promise<void> => {
    fireEvent.change(nameField(), { target: { value: data.name } });

    for (const monitorId of data.monitorIds) {
      await press(`guided-setup-monitor-${monitorId}`);
    }

    await press("guided-setup-create-status-page");
  };

  // The browser forgets the run; the page stays on the server. Then the page opens again.
  /*
   * The run gone from the browser and the server both - an older
   * Dashboard's, kept in a browser since cleared: what the server keeps
   * now (#7253) never had it.
   */
  const loseTheRunAndOpenAgain: () => Promise<void> =
    async (): Promise<void> => {
      window.localStorage.clear();
      guidedSetupRunServer.reset();
      cleanup();
      await renderSetup();
    };

  test("the run lost, the same name typed again: no second page, the monitors go on the page made, and step 2 says so first", async () => {
    await renderSetup();
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    const made: ServerPage = serverPages[0]!;
    expect(storedRun()).toEqual({ statusPageId: made.id });
    expect(stepState("review")).toBe("open");

    await loseTheRunAndOpenAgain();

    expect(stepState("pick")).toBe("open");
    // Typed another way, the same name, and one more monitor picked.
    await createWith({
      name: "  acme STATUS ",
      monitorIds: ["m-api", "m-db"],
    });

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(serverPages).toHaveLength(1);
    expect(api["addMonitors"]!.mock.calls[1]![0]).toEqual({
      statusPageId: made.id,
      monitors: [MONITORS[0], MONITORS[2]],
    });
    // The monitor it showed already is not on it twice.
    expect(made.monitorIds).toEqual(["m-api", "m-db"]);
    expect(storedRun()).toEqual({ statusPageId: made.id });

    // Step 1 is done with the page found; step 2 opens, saying why first.
    expect(stepState("pick")).toBe("done");
    expect(
      screen.getByTestId("guided-setup-step-pick-done-line"),
    ).toHaveTextContent('"Acme Status" shows 2 monitors.');
    expect(stepState("review")).toBe("open");
    const note: HTMLElement = screen.getByTestId(
      "guided-setup-existing-status-page",
    );
    expect(note).toHaveTextContent(NOTE("Acme Status"));
    expect(
      note.compareDocumentPosition(
        screen.getByText(STATUS_PAGE_SETUP_COPY.reviewHelp),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(note).toHaveClass("break-words");
    expect(screen.queryByRole("alert")).toBeNull();

    // What the page shows, and its link: the page found.
    expect(screen.getByTestId("guided-setup-preview")).toHaveTextContent(
      "Acme Status",
    );
    expect(screen.getByTestId("guided-setup-preview")).toHaveTextContent(
      "Database",
    );
    expect(
      screen.getByTestId("guided-setup-public-link").getAttribute("href"),
    ).toMatch(new RegExp(`/status-page/${made.id}$`));

    // And the run goes on with it to the summary.
    await press("guided-setup-review-continue");
    expect(screen.getByTestId("guided-setup-summary")).toHaveTextContent(
      '"Acme Status" is live',
    );
    expect(storedRun()).toEqual({ statusPageId: made.id, reviewed: true });
    expect(serverPages).toHaveLength(1);
  });

  test("a page another tab made while this one was open: found at the save, not made again", async () => {
    await renderSetup();

    // Another tab of this person made the page meanwhile.
    const theirs: ServerPage = madeOnServer({
      name: "Acme Status",
      monitorIds: ["m-api"],
    });

    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(serverPages).toHaveLength(1);
    expect(theirs.monitorIds).toEqual(["m-api"]);
    expect(storedRun()).toEqual({ statusPageId: theirs.id });
    expect(
      screen.getByTestId("guided-setup-existing-status-page"),
    ).toHaveTextContent(NOTE("Acme Status"));
    expect(stepState("review")).toBe("open");
  });

  test("the note names the page as it is named, not as it was typed", async () => {
    madeOnServer({ name: "ACME Status Page" });
    await renderSetup();
    await createWith({ name: "acme status page", monitorIds: ["m-web"] });

    expect(
      screen.getByTestId("guided-setup-existing-status-page"),
    ).toHaveTextContent(NOTE("ACME Status Page"));
    expect(screen.getByTestId("guided-setup-preview")).toHaveTextContent(
      "ACME Status Page",
    );
  });

  test("another name makes its own page, with no note", async () => {
    madeOnServer({ name: "Acme Status", monitorIds: ["m-api"] });
    await renderSetup();
    await createWith({ name: "Acme Internal Status", monitorIds: ["m-web"] });

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(api["createStatusPage"]).toHaveBeenCalledWith(
      "Acme Internal Status",
    );
    expect(serverPages).toHaveLength(2);
    expect(serverPages[0]!.monitorIds).toEqual(["m-api"]);
    expect(serverPages[1]!.monitorIds).toEqual(["m-web"]);
    expect(storedRun()).toEqual({ statusPageId: serverPages[1]!.id });
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
    expect(stepState("review")).toBe("open");
  });

  test("a teammate's page with the name is never taken over: this person's own is made", async () => {
    const teammates: ServerPage = madeOnServer({
      name: "Acme Status",
      createdByUserId: TEAMMATE_ID,
      monitorIds: ["m-web"],
    });
    await renderSetup();
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(teammates.monitorIds).toEqual(["m-web"]);
    expect(serverPages[1]!.monitorIds).toEqual(["m-api"]);
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("an archived page of theirs with the name is offline: a new page is made", async () => {
    const archived: ServerPage = madeOnServer({
      name: "Acme Status",
      isArchived: true,
    });
    await renderSetup();
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(archived.monitorIds).toEqual([]);
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("a look-up that fails makes nothing and says why; trying again goes on", async () => {
    madeOnServer({ name: "Acme Status", monitorIds: ["m-api"] });
    await renderSetup();
    api["findOwnStatusPage"]!.mockRejectedValueOnce(
      new Error("The server could not be reached."),
    );
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server could not be reached.",
    );
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(api["addMonitors"]).not.toHaveBeenCalled();
    expect(serverPages).toHaveLength(1);
    expect(storedRun()).toEqual({});
    expect(stepState("pick")).toBe("open");
    // The form is as it was: the name and the monitors picked, to save again.
    expect(nameField().value).toBe("Acme Status");
    expect(screen.getByTestId("guided-setup-monitor-m-api")).toBeChecked();

    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(serverPages).toHaveLength(1);
    expect(
      screen.getByTestId("guided-setup-existing-status-page"),
    ).toHaveTextContent(NOTE("Acme Status"));
    expect(stepState("review")).toBe("open");
  });

  test("monitors that could not be added to the page found leave the step as it was, and the next try finds it again", async () => {
    const theirs: ServerPage = madeOnServer({ name: "Acme Status" });
    await renderSetup();
    api["addMonitors"]!.mockRejectedValueOnce(new Error("Plan limit reached"));
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });

    expect(
      within(screen.getByTestId("guided-setup-step-pick")).getByText(
        "Plan limit reached",
      ),
    ).toBeInTheDocument();
    // The panel says which record failed, and why (#10276).
    expect(
      screen.getByTestId("guided-setup-resource-shown_monitors-error"),
    ).toHaveTextContent("Plan limit reached");
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    // Nothing claims the page shows nothing, or that it was found.
    expect(storedRun()).toEqual({});
    expect(nameField().value).toBe("Acme Status");
    expect(
      screen.queryByTestId("guided-setup-empty-page"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
    expect(stepState("pick")).toBe("open");

    await press("guided-setup-create-status-page");

    expect(api["findOwnStatusPage"]).toHaveBeenCalledTimes(2);
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(theirs.monitorIds).toEqual(["m-api"]);
    expect(storedRun()).toEqual({ statusPageId: theirs.id });
    expect(stepState("review")).toBe("open");
  });

  test("the note is a moment, not a state: a reload, and Set up another status page, start without it", async () => {
    madeOnServer({ name: "Acme Status", monitorIds: ["m-api"] });
    await renderSetup();
    await createWith({ name: "Acme Status", monitorIds: ["m-api"] });
    expect(
      screen.getByTestId("guided-setup-existing-status-page"),
    ).toBeInTheDocument();

    // Opened again with the run kept: step 2, as it is, with no note.
    cleanup();
    await renderSetup();
    expect(stepState("review")).toBe("open");
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();

    // On to the summary, then another page with its own name.
    await press("guided-setup-review-continue");
    await press("guided-setup-start-over");
    expect(nameField().value).toBe("");
    await createWith({ name: "Acme Internal Status", monitorIds: ["m-db"] });

    expect(serverPages).toHaveLength(2);
    expect(stepState("review")).toBe("open");
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("Set up another status page right after a page was found: the next page, a new one, comes without the note", async () => {
    madeOnServer({ name: "Acme Status", monitorIds: ["m-api"] });
    await renderSetup();
    await createWith({ name: "acme status", monitorIds: ["m-api"] });
    expect(
      screen.getByTestId("guided-setup-existing-status-page"),
    ).toBeInTheDocument();

    // No reload: the summary, then another page with its own name.
    await press("guided-setup-review-continue");
    await press("guided-setup-start-over");
    await createWith({ name: "Acme Internal Status", monitorIds: ["m-db"] });

    expect(serverPages).toHaveLength(2);
    expect(stepState("review")).toBe("open");
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  test("a long name with no spaces wraps inside the step instead of running past it", async () => {
    const longName: string = `Acme${"Storefront".repeat(12)}Status`;
    madeOnServer({ name: longName });
    await renderSetup();
    await createWith({ name: longName.toUpperCase(), monitorIds: ["m-api"] });

    const note: HTMLElement = screen.getByTestId(
      "guided-setup-existing-status-page",
    );
    expect(note).toHaveTextContent(NOTE(longName));
    expect(note).toHaveClass("break-words");
  });
});

/*
 * THE NOTE, READ IN ANOTHER LANGUAGE (#7252): the sentence step 2 says
 * when the name typed is one of the reader's own pages is in their words,
 * with the page's name as it is named - in German, and on the right-to-left
 * pages, Arabic and Persian.
 */
describe("read in another language (#7252)", () => {
  const LANGUAGES: Array<string> = ["de", "ar", "fa"];

  const fill: (
    language: string,
    key: string,
    values: Record<string, string>,
  ) => string = (
    language: string,
    key: string,
    values: Record<string, string>,
  ): string => {
    let text: string = readDashboardLocale(language)[key]!;

    expect({ language, key, worded: Boolean(text) && text !== key }).toEqual({
      language,
      key,
      worded: true,
    });

    for (const name of Object.keys(values)) {
      text = text.split(`{{${name}}}`).join(values[name]!);
    }

    return text;
  };

  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = { translation: readDashboardLocale(language) };
    }

    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  describe.each(LANGUAGES)("in %s", (language: string) => {
    beforeEach(async () => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
    });

    /*
     * A monitor and a monitor group are named by the project: "Network" is
     * "Network" in every language, never the Dashboard's word for it
     * (German "Netzwerk"), in the list step 1 picks from (#7147).
     */
    test("the list's names are drawn as the project wrote them, never looked up", async () => {
      api["loadMonitors"]!.mockResolvedValue([
        { id: "m-network", name: "Network" },
        { id: "m-status", name: "Status" },
      ]);
      api["loadMonitorGroups"]!.mockResolvedValue([
        { id: "g-network", name: "Network" },
      ]);
      await renderSetup();

      const list: string = withoutIsolateMarks(
        screen.getByTestId("guided-setup-monitors").textContent || "",
      );

      expect(list).toContain("Network");
      expect(list).toContain("Status");
      expect(list).not.toContain(readDashboardLocale(language)["Network"]!);
    });

    test("the name is one of the reader's pages: step 2 says so in their words, naming the page", async () => {
      api["findOwnStatusPage"]!.mockResolvedValue({
        id: PAGE_ID,
        name: "Acme Status",
      });
      await renderSetup();
      fireEvent.change(nameField(), { target: { value: "acme status" } });
      await press("guided-setup-monitor-m-api");
      await press("guided-setup-create-status-page");

      await waitFor(() => {
        expect(
          screen.getByTestId("guided-setup-existing-status-page"),
        ).toBeInTheDocument();
      });

      const note: string = withoutIsolateMarks(
        screen.getByTestId("guided-setup-existing-status-page").textContent ||
          "",
      );

      expect(note).toBe(
        fill(language, STATUS_PAGE_SETUP_COPY.existingStatusPage, {
          name: "Acme Status",
        }),
      );
      expect(note).not.toContain("no new one was made");
      expect(note).not.toContain("acme status");
      expect(api["createStatusPage"]).not.toHaveBeenCalled();
    });

    /*
     * A name in Latin letters that starts with a figure: in a sentence read
     * from the right the bidi algorithm drew "24/7" after "Status" and the
     * count beside the quotes unless the name is set apart. Each line that
     * names the page - the note, step 1's line, the summary's title - sets it
     * apart there, and adds nothing to a German one.
     */
    test("every line naming the page keeps the name whole in the reader's reading direction", async () => {
      const name: string = "24/7 Status";
      const isRightToLeft: boolean = language === "ar" || language === "fa";

      api["findOwnStatusPage"]!.mockResolvedValue({ id: PAGE_ID, name });
      api["loadShownMonitors"]!.mockResolvedValue({ count: 1, names: ["API"] });
      await renderSetup();
      fireEvent.change(nameField(), { target: { value: "24/7 status" } });
      await press("guided-setup-monitor-m-api");
      await press("guided-setup-create-status-page");

      await waitFor(() => {
        expect(
          screen.getByTestId("guided-setup-existing-status-page"),
        ).toBeInTheDocument();
      });

      const lines: () => Record<string, boolean> = (): Record<
        string,
        boolean
      > => {
        const setApart: Record<string, boolean> = {};

        for (const testId of [
          "guided-setup-existing-status-page",
          "guided-setup-step-pick-done-line",
          "guided-setup-summary-title",
        ]) {
          const element: HTMLElement | null = screen.queryByTestId(testId);

          if (element) {
            setApart[testId] = (element.textContent || "").includes(
              isolated(name),
            );
          }
        }

        return setApart;
      };

      expect(lines()).toEqual({
        "guided-setup-existing-status-page": isRightToLeft,
        "guided-setup-step-pick-done-line": isRightToLeft,
      });

      await press("guided-setup-review-continue");

      expect(lines()).toEqual({
        "guided-setup-step-pick-done-line": isRightToLeft,
        "guided-setup-summary-title": isRightToLeft,
      });
      expect(
        withoutIsolateMarks(
          screen.getByTestId("guided-setup-summary-title").textContent || "",
        ),
      ).toBe(fill(language, STATUS_PAGE_SETUP_COPY.summaryTitle, { name }));
    });
  });
});

/*
 * A PROJECT THAT HAS A STATUS PAGE ALREADY (#7517): the 14.0.109 newcomer
 * made "Walk Co Status" by hand, then opened the setup from Search, and
 * it made a second page beside it. Step 1 now says so first and goes on
 * with the project's page - the newest, or the one picked of several -
 * adding only what it does not show yet. Making a new page stays one click
 * away, for whoever may make one. Which pages are offered - only those the
 * person may change - is StatusPageSetupApi's (loadEditableStatusPages);
 * here, what step 1 does with them.
 */
describe("a project that has a status page already (#7517)", () => {
  const WALK_CO: Record<string, string> = {
    id: "70000000-0000-4000-8000-000000007517",
    name: "Walk Co Status",
  };
  const OLDER: Record<string, string> = {
    id: "70000000-0000-4000-8000-000000007518",
    name: "Walk Co Internal",
  };

  const pressTitled: (testId: string) => Promise<void> = async (
    testId: string,
  ): Promise<void> => {
    await press(testId);
  };

  // What each page shows, as the server keeps it: Walk Co nothing yet, the older one the API monitor.
  let shownOn: Record<string, Array<string>> = {};

  beforeEach(() => {
    shownOn = { [WALK_CO["id"]!]: [], [OLDER["id"]!]: ["m-api"] };
    api["loadEditableStatusPages"]!.mockResolvedValue([WALK_CO]);
    api["loadShownMonitors"]!.mockImplementation(
      async (id: string): Promise<Record<string, unknown>> => {
        const monitorIds: Array<string> = shownOn[id] || [];

        return {
          count: monitorIds.length,
          names: monitorIds.map((monitorId: string): string => {
            return (
              MONITORS.find((monitor: Record<string, string>): boolean => {
                return monitor["id"] === monitorId;
              })?.["name"] || ""
            );
          }),
          monitorIds: monitorIds,
          monitorGroupIds: [],
        };
      },
    );
    // Add Multiple Monitors' rule: a monitor the page shows is not added twice.
    api["addMonitors"]!.mockImplementation(
      async (data: {
        statusPageId: string;
        monitors: Array<{ id: string }>;
      }): Promise<unknown> => {
        const onPage: Array<string> = shownOn[data.statusPageId] || [];

        for (const monitor of data.monitors) {
          if (!onPage.includes(monitor.id)) {
            onPage.push(monitor.id);
          }
        }

        shownOn[data.statusPageId] = onPage;
        return { succeeded: data.monitors, skipped: [], failed: [] };
      },
    );
  });

  // A page of several, picked from the list of their names.
  const pickPage: (name: string) => Promise<void> = async (
    name: string,
  ): Promise<void> => {
    const picker: HTMLElement = within(
      screen.getByTestId("guided-setup-existing-page"),
    ).getByRole("combobox");

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: name }));
    });
  };

  test("one page: step 1 names it first, asks no name, and says nothing about a new public page", async () => {
    await renderSetup();

    const line: HTMLElement = screen.getByTestId("guided-setup-existing-pages");
    expect(line).toHaveTextContent(
      'This project already has a status page, "Walk Co Status". The monitors you pick are added to it.',
    );
    expect(
      screen.queryByTestId("guided-setup-status-page-name"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-public-notice"),
    ).not.toBeInTheDocument();
    // One page: nothing to pick from.
    expect(
      screen.queryByTestId("guided-setup-existing-page"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-create-status-page"),
    ).toHaveTextContent("Add to the page");
    // A new page stays one click away.
    expect(screen.getByTestId("guided-setup-make-new-page")).toHaveTextContent(
      "Make a new status page instead",
    );
    // None ticked, as ever.
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 3 picked",
    );
  });

  test("Add to the page makes no page: the monitors picked go on the project's page, and step 2 opens on it", async () => {
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-monitor-m-db");
    await pressTitled("guided-setup-create-status-page");

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(api["findOwnStatusPage"]).not.toHaveBeenCalled();
    expect(api["addMonitors"]).toHaveBeenCalledTimes(1);
    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: WALK_CO["id"],
      monitors: [MONITORS[0], MONITORS[2]],
    });
    expect(storedRun()).toEqual({ statusPageId: WALK_CO["id"] });
    expect(stepState("pick")).toBe("done");
    expect(stepState("review")).toBe("open");
    expect(screen.getByTestId("guided-setup-preview-name")).toHaveTextContent(
      "Walk Co Status",
    );
    // Picked on purpose: no "no new one was made" note.
    expect(
      screen.queryByTestId("guided-setup-existing-status-page"),
    ).not.toBeInTheDocument();
  });

  /*
   * #7467: the preview names the page as its public page does, in its
   * header and its tab - its Page Title, else its name. A page of the
   * project's with a Page Title is previewed by it, never by the name its
   * team gave it.
   */
  test("a page of the project's with a Page Title is previewed by it, as its visitors read it", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([
      { ...WALK_CO, pageTitle: "Walk Co Public Status" },
    ]);

    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await pressTitled("guided-setup-create-status-page");

    const name: HTMLElement = screen.getByTestId("guided-setup-preview-name");
    expect(name).toHaveTextContent("Walk Co Public Status");
    expect(name).not.toHaveTextContent("Walk Co Status");
  });

  test("what the page shows already is ticked and locked, On the page, and only the rest is added", async () => {
    shownOn[WALK_CO["id"]!] = ["m-api"];
    await renderSetup();

    const onPage: HTMLElement = screen.getByTestId(
      "guided-setup-monitor-m-api",
    );
    expect(onPage).toBeChecked();
    expect(onPage).toBeDisabled();
    expect(onPage.closest("li")).toHaveTextContent("On the page");
    // What can be picked: the two the page does not show.
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 2 picked",
    );

    await press("guided-setup-select-all");
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "2 of 2 picked",
    );
    await press("guided-setup-create-status-page");

    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: WALK_CO["id"],
      monitors: [MONITORS[1], MONITORS[2]],
    });
  });

  test("a page that shows monitors already, and nothing more picked: Continue goes on with it as it is", async () => {
    shownOn[WALK_CO["id"]!] = ["m-api"];
    await renderSetup();

    const button: HTMLElement = screen.getByTestId(
      "guided-setup-create-status-page",
    );
    expect(button).toHaveTextContent("Continue");

    await press("guided-setup-create-status-page");

    expect(api["addMonitors"]).not.toHaveBeenCalled();
    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({ statusPageId: WALK_CO["id"] });
    expect(stepState("review")).toBe("open");
    expect(screen.getByTestId("guided-setup-preview")).toHaveTextContent("API");

    // A pick turns Continue back into the add.
    cleanup();
    window.localStorage.clear();
    await renderSetup();
    await press("guided-setup-monitor-m-web");
    expect(
      screen.getByTestId("guided-setup-create-status-page"),
    ).toHaveTextContent("Add to the page");
  });

  test("a page that shows nothing, and nothing picked: says so, and adds nothing", async () => {
    await renderSetup();
    await press("guided-setup-create-status-page");

    expect(
      screen.getByText(STATUS_PAGE_SETUP_COPY.nothingPicked),
    ).toBeInTheDocument();
    expect(api["addMonitors"]).not.toHaveBeenCalled();
    expect(storedRun()).toEqual({});
    expect(stepState("pick")).toBe("open");
  });

  test("Make a new status page instead: today's step 1, and one page made", async () => {
    await renderSetup();
    await press("guided-setup-make-new-page");

    expect(nameField().value).toBe("Acme Status");
    expect(screen.getByTestId("guided-setup-public-notice")).toBeVisible();
    expect(
      screen.queryByTestId("guided-setup-existing-pages"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-use-existing-page"),
    ).toHaveTextContent("Add to an existing status page instead");

    await press("guided-setup-monitor-m-web");
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(api["createStatusPage"]).toHaveBeenCalledWith("Acme Status");
    expect(api["addMonitors"]!.mock.calls[0]![0]).toMatchObject({
      statusPageId: PAGE_ID,
    });
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
  });

  test("a new page whose monitors cannot be read back counts what was added to it, never what the project's page shows", async () => {
    shownOn[WALK_CO["id"]!] = ["m-api", "m-db"];
    await renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-monitor-m-api")).toBeDisabled();
    });
    await press("guided-setup-make-new-page");
    await press("guided-setup-monitor-m-web");

    const read: (id: string) => Promise<unknown> = api[
      "loadShownMonitors"
    ]!.getMockImplementation() as (id: string) => Promise<unknown>;
    api["loadShownMonitors"]!.mockImplementation(
      (id: string): Promise<unknown> => {
        return id === PAGE_ID
          ? Promise.reject(new Error("The read failed."))
          : read(id);
      },
    );
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).toHaveBeenCalledWith("Acme Status");
    expect(
      screen.getByTestId("guided-setup-step-pick-done-line"),
    ).toHaveTextContent('"Acme Status" shows 1 monitor.');
    expect(screen.getByTestId("guided-setup-preview")).toHaveTextContent(
      "Website",
    );
    expect(screen.getByTestId("guided-setup-preview")).not.toHaveTextContent(
      "API",
    );
  });

  test("and back: Add to an existing status page instead goes on with the project's page again, the picks kept", async () => {
    await renderSetup();
    await press("guided-setup-monitor-m-db");
    await press("guided-setup-make-new-page");
    await press("guided-setup-use-existing-page");

    expect(screen.getByTestId("guided-setup-existing-pages")).toBeVisible();
    expect(screen.getByTestId("guided-setup-monitor-m-db")).toBeChecked();
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).not.toHaveBeenCalled();
    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: WALK_CO["id"],
      monitors: [MONITORS[2]],
    });
  });

  test("several pages: they are counted, picked from by name, newest first, and the one picked gets the monitors", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([WALK_CO, OLDER]);
    await renderSetup();

    expect(screen.getByTestId("guided-setup-existing-pages")).toHaveTextContent(
      "This project already has 2 status pages. The monitors you pick are added to the one you choose.",
    );
    // The newest is picked to start with.
    expect(screen.getByTestId("guided-setup-existing-page")).toHaveTextContent(
      "Walk Co Status",
    );
    expect(api["loadShownMonitors"]).toHaveBeenCalledWith(WALK_CO["id"]);

    // The older one, picked from the list of names.
    await pickPage("Walk Co Internal");
    await waitFor(() => {
      expect(api["loadShownMonitors"]).toHaveBeenCalledWith(OLDER["id"]);
    });
    // It shows the API monitor already.
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-monitor-m-api")).toBeDisabled();
    });

    await press("guided-setup-monitor-m-web");
    await press("guided-setup-create-status-page");

    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: OLDER["id"],
      monitors: [MONITORS[1]],
    });
    expect(storedRun()).toEqual({ statusPageId: OLDER["id"] });
  });

  test("a page picked before the one before it is read: the marks are the page picked, whatever arrives late", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([WALK_CO, OLDER]);
    shownOn[WALK_CO["id"]!] = ["m-db"];
    // Walk Co's read is slow: it arrives after the older page's.
    let arriveWalkCo: () => void = (): void => {};
    const fake: (id: string) => Promise<unknown> = api[
      "loadShownMonitors"
    ]!.getMockImplementation() as (id: string) => Promise<unknown>;
    api["loadShownMonitors"]!.mockImplementation(
      (id: string): Promise<unknown> => {
        if (id !== WALK_CO["id"]) {
          return fake(id);
        }

        return new Promise((resolve: (value: unknown) => void) => {
          arriveWalkCo = () => {
            resolve(fake(id));
          };
        });
      },
    );
    await renderSetup();
    await pickPage("Walk Co Internal");
    await waitFor(() => {
      expect(screen.getByTestId("guided-setup-monitor-m-api")).toBeDisabled();
    });

    await act(async () => {
      arriveWalkCo();
    });

    // The older page's marks stay: Walk Co's late read draws none.
    expect(screen.getByTestId("guided-setup-monitor-m-api")).toBeDisabled();
    expect(screen.getByTestId("guided-setup-monitor-m-db")).not.toBeDisabled();
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 2 picked",
    );
  });

  test("someone who may change the project's pages but not make one: the offer, and no way to a new page", async () => {
    mayCreate = false;
    await renderSetup();

    expect(screen.getByTestId("guided-setup-existing-pages")).toBeVisible();
    expect(
      screen.queryByTestId("guided-setup-make-new-page"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-not-allowed"),
    ).not.toBeInTheDocument();

    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");
    expect(api["addMonitors"]!.mock.calls[0]![0]).toMatchObject({
      statusPageId: WALK_CO["id"],
    });
  });

  test("someone who may neither change a page nor make one is told so, as before", async () => {
    mayCreate = false;
    api["loadEditableStatusPages"]!.mockResolvedValue([]);
    await renderSetup();

    expect(screen.getByTestId("guided-setup-not-allowed")).toBeVisible();
    expect(screen.queryByTestId("guided-setup")).not.toBeInTheDocument();
  });

  test("a project with no page this person may change: today's step 1, unchanged", async () => {
    api["loadEditableStatusPages"]!.mockResolvedValue([]);
    await renderSetup();

    expect(nameField().value).toBe("Acme Status");
    expect(screen.getByTestId("guided-setup-public-notice")).toBeVisible();
    expect(
      screen.queryByTestId("guided-setup-existing-pages"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-use-existing-page"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-create-status-page"),
    ).toHaveTextContent("Create the status page");
  });

  test("pages that cannot be read: today's step 1, rather than no step at all", async () => {
    api["loadEditableStatusPages"]!.mockRejectedValue(new Error("offline"));
    await renderSetup();

    expect(nameField()).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a run whose page is known never offers another", async () => {
    keepRun({ statusPageId: PAGE_ID });
    api["loadShownMonitors"]!.mockResolvedValue({ count: 0, names: [] });
    await renderSetup();

    expect(screen.getByTestId("guided-setup-empty-page")).toBeVisible();
    expect(
      screen.queryByTestId("guided-setup-existing-pages"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-make-new-page"),
    ).not.toBeInTheDocument();
  });

  test("Set up another status page asks for a new one, with the project's pages one click away", async () => {
    keepRun({ statusPageId: WALK_CO["id"], reviewed: true });
    shownOn[WALK_CO["id"]!] = ["m-api"];
    api["loadStatusPage"]!.mockResolvedValue({
      id: WALK_CO["id"],
      name: WALK_CO["name"],
    });
    await renderSetup();
    await press("guided-setup-start-over");

    expect(nameField()).toBeVisible();
    expect(
      screen.queryByTestId("guided-setup-existing-pages"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-use-existing-page"),
      ).toBeVisible();
    });
  });

  /*
   * THE MONITOR THE WEBSITE SETUP HANDED IN (#7053), now that step 1 may
   * offer a page: it is still the one thing ticked, and goes on the page
   * offered.
   */
  test("the monitor the website setup handed in stays ticked, and goes on the page offered", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/status-pages/setup?monitorId=m-web&from=website_down_summary`,
    );

    try {
      await renderSetup();

      expect(screen.getByTestId("guided-setup-monitor-m-web")).toBeChecked();
      expect(
        screen.getByTestId("guided-setup-monitor-m-api"),
      ).not.toBeChecked();
      await press("guided-setup-create-status-page");

      expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
        statusPageId: WALK_CO["id"],
        monitors: [MONITORS[1]],
      });
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});

/*
 * A BUSY PROJECT (#7147): two hundred monitors in one list was one long
 * scroll. The list gets a search by name and a label to narrow it by, its
 * monitor groups are listed - each added as one row of the page - and
 * "Select all" picks what the list shows. None is ticked to start with.
 */
describe("a busy project's list (#7147)", () => {
  const LABELS: Record<string, { id: string; name: string; color: string }> = {
    production: {
      id: "10000000-0000-4000-8000-000000000001",
      name: "production",
      color: "#ef4444",
    },
    staging: {
      id: "10000000-0000-4000-8000-000000000002",
      name: "staging",
      color: "#f59e0b",
    },
  };

  // Two hundred monitors: checkout-001 to checkout-100 in production, the rest in staging.
  const BUSY: Array<Record<string, unknown>> = Array.from(
    { length: 200 },
    (_unused: unknown, index: number): Record<string, unknown> => {
      const number: number = index + 1;
      const isProduction: boolean = number <= 100;

      return {
        id: `m-${String(number).padStart(3, "0")}`,
        name: `${isProduction ? "checkout" : "search"}-${String(
          number,
        ).padStart(3, "0")}`,
        statusName: "Operational",
        labels: [isProduction ? LABELS["production"] : LABELS["staging"]],
      };
    },
  );

  const GROUPS: Array<Record<string, unknown>> = [
    {
      id: "g-checkout",
      name: "Checkout",
      labels: [LABELS["production"]],
    },
    { id: "g-search", name: "Search" },
  ];

  const search: (text: string) => Promise<void> = async (
    text: string,
  ): Promise<void> => {
    await act(async () => {
      fireEvent.change(screen.getByTestId("guided-setup-search"), {
        target: { value: text },
      });
    });
  };

  const shownMonitorIds: () => Array<string> = (): Array<string> => {
    return Array.from(
      screen
        .getByTestId("guided-setup-monitors")
        .querySelectorAll('[data-testid^="guided-setup-monitor-m-"]'),
    ).map((element: Element): string => {
      return (element.getAttribute("data-testid") || "").replace(
        "guided-setup-monitor-",
        "",
      );
    });
  };

  const pickLabel: (name: string) => Promise<void> = async (
    name: string,
  ): Promise<void> => {
    const picker: HTMLElement = within(
      screen.getByTestId("guided-setup-label-filter"),
    ).getByRole("combobox", { name: "Filter by label" });

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: name }));
    });
  };

  beforeEach(() => {
    api["loadMonitors"]!.mockResolvedValue(BUSY);
    api["loadMonitorGroups"]!.mockResolvedValue(GROUPS);
  });

  test("lists the groups first, then every monitor, none ticked, with a search and the labels to narrow by", async () => {
    await renderSetup();

    expect(shownMonitorIds()).toHaveLength(200);
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 202 picked",
    );
    const groupRow: HTMLElement = screen.getByTestId(
      "guided-setup-monitor-group-row-g-checkout",
    );
    expect(groupRow).toHaveTextContent("Checkout");
    expect(groupRow).toHaveTextContent("Monitor Group");
    expect(
      groupRow.compareDocumentPosition(
        screen.getByTestId("guided-setup-monitor-m-001"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("guided-setup-search")).toBeVisible();
    expect(screen.getByTestId("guided-setup-label-filter")).toBeVisible();
    expect(
      screen.getByTestId("guided-setup-monitor-group-g-checkout"),
    ).not.toBeChecked();
  });

  test("finds and picks three by typing, and puts exactly those on the page", async () => {
    await renderSetup();

    await search("checkout-01");
    // checkout-010 to checkout-019.
    expect(shownMonitorIds()).toHaveLength(10);
    await press("guided-setup-monitor-m-012");

    await search("  SEARCH-150 ");
    expect(shownMonitorIds()).toEqual(["m-150"]);
    await press("guided-setup-monitor-m-150");

    await search("checkout-007");
    await press("guided-setup-monitor-m-007");

    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "3 of 202 picked",
    );
    await press("guided-setup-create-status-page");

    const added: { monitors: Array<{ id: string }> } = api["addMonitors"]!.mock
      .calls[0]![0] as { monitors: Array<{ id: string }> };
    // In the list's order, whatever order they were picked in.
    expect(
      added.monitors.map((monitor: { id: string }): string => {
        return monitor.id;
      }),
    ).toEqual(["m-007", "m-012", "m-150"]);
    expect(added).not.toHaveProperty("monitorGroups");
  });

  test("a search that finds nothing says so, and offers nothing to select", async () => {
    await renderSetup();
    await search("payments");

    expect(screen.getByTestId("guided-setup-no-match")).toHaveTextContent(
      "Nothing matches.",
    );
    expect(
      screen.queryByTestId("guided-setup-select-all"),
    ).not.toBeInTheDocument();
  });

  test("Select all picks what is shown, and what the search hides stays as it was", async () => {
    await renderSetup();
    await press("guided-setup-monitor-m-200");

    await search("checkout-00");
    await press("guided-setup-select-all");

    // checkout-001 to checkout-009, and the one picked before.
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "10 of 202 picked",
    );
    await search("");
    expect(screen.getByTestId("guided-setup-monitor-m-200")).toBeChecked();
    expect(screen.getByTestId("guided-setup-monitor-m-010")).not.toBeChecked();
    expect(
      screen.getByTestId("guided-setup-monitor-group-g-checkout"),
    ).not.toBeChecked();
  });

  test("picks by label: the label narrows the list to what carries it, and Select all picks those", async () => {
    await renderSetup();
    await pickLabel("staging");

    expect(shownMonitorIds()).toHaveLength(100);
    expect(shownMonitorIds()[0]).toBe("m-101");
    // The Checkout group carries production, not staging; Search carries none.
    expect(
      screen.queryByTestId("guided-setup-monitor-group-row-g-checkout"),
    ).not.toBeInTheDocument();

    await press("guided-setup-select-all");
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "100 of 202 picked",
    );
    await press("guided-setup-create-status-page");

    const added: { monitors: Array<{ id: string }> } = api["addMonitors"]!.mock
      .calls[0]![0] as { monitors: Array<{ id: string }> };
    expect(added.monitors).toHaveLength(100);
    expect(
      added.monitors.every((monitor: { id: string }): boolean => {
        return Number(monitor.id.slice(2)) > 100;
      }),
    ).toBe(true);
  });

  test("a label and a search together: what carries the label and matches the name", async () => {
    await renderSetup();
    await pickLabel("production");
    await search("checkout");

    // The production monitors, and the group that carries production.
    expect(shownMonitorIds()).toHaveLength(100);
    expect(
      screen.getByTestId("guided-setup-monitor-group-row-g-checkout"),
    ).toBeVisible();

    await search("checkout-09");
    expect(shownMonitorIds()).toHaveLength(10);
    expect(
      screen.queryByTestId("guided-setup-monitor-group-row-g-checkout"),
    ).not.toBeInTheDocument();

    // A name no monitor carrying the label has.
    await search("search-1");
    expect(screen.getByTestId("guided-setup-no-match")).toBeVisible();
  });

  test("a monitor group goes on the page as a group, before the monitors, through Add Multiple Monitor Groups' rule", async () => {
    await renderSetup();
    await press("guided-setup-monitor-group-g-checkout");
    await press("guided-setup-monitor-m-150");

    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "2 of 202 picked",
    );
    await press("guided-setup-create-status-page");

    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: PAGE_ID,
      monitors: [BUSY[149]],
      monitorGroups: [GROUPS[0]],
    });
  });

  test("once the page shows a group, step 1's line counts monitors and monitor groups, never all as monitors", async () => {
    api["loadShownMonitors"]!.mockResolvedValue({
      count: 2,
      names: ["Checkout", "search-150"],
      monitorIds: ["m-150"],
      monitorGroupIds: ["g-checkout"],
    });
    await renderSetup();
    await press("guided-setup-monitor-group-g-checkout");
    await press("guided-setup-monitor-m-150");
    await press("guided-setup-create-status-page");

    expect(
      screen.getByTestId("guided-setup-step-pick-done-line"),
    ).toHaveTextContent('"Acme Status" shows 2 monitors and monitor groups.');
  });

  test("a group alone is something to show: the page is made with it", async () => {
    await renderSetup();
    await press("guided-setup-monitor-group-g-search");
    await press("guided-setup-create-status-page");

    expect(api["createStatusPage"]).toHaveBeenCalledTimes(1);
    expect(api["addMonitors"]!.mock.calls[0]![0]).toEqual({
      statusPageId: PAGE_ID,
      monitors: [],
      monitorGroups: [GROUPS[1]],
    });
  });

  test("Clear unticks everything picked, monitors and groups", async () => {
    await renderSetup();
    await press("guided-setup-monitor-group-g-search");
    await press("guided-setup-monitor-m-002");
    await press("guided-setup-clear-all");

    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 202 picked",
    );
    expect(
      screen.getByTestId("guided-setup-monitor-group-g-search"),
    ).not.toBeChecked();
  });

  test("the monitor the website setup handed in stays picked while a search hides it, and goes on the page", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/status-pages/setup?monitorId=m-042`,
    );

    try {
      await renderSetup();
      expect(screen.getByTestId("guided-setup-monitor-m-042")).toBeChecked();
      expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
        "1 of 202 picked",
      );

      await search("search-");
      expect(
        screen.queryByTestId("guided-setup-monitor-m-042"),
      ).not.toBeInTheDocument();
      await press("guided-setup-monitor-m-199");
      await press("guided-setup-create-status-page");

      const added: { monitors: Array<{ id: string }> } = api["addMonitors"]!
        .mock.calls[0]![0] as { monitors: Array<{ id: string }> };
      expect(
        added.monitors.map((monitor: { id: string }): string => {
          return monitor.id;
        }),
      ).toEqual(["m-042", "m-199"]);
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  test("a short list keeps to its checkboxes: no search, no label to pick", async () => {
    api["loadMonitors"]!.mockResolvedValue(BUSY.slice(0, 3));
    api["loadMonitorGroups"]!.mockResolvedValue([]);
    await renderSetup();

    expect(screen.queryByTestId("guided-setup-search")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-label-filter"),
    ).not.toBeInTheDocument();
  });

  test("monitor groups that cannot be read leave the monitors to pick", async () => {
    api["loadMonitorGroups"]!.mockRejectedValue(new Error("Forbidden"));
    await renderSetup();

    expect(shownMonitorIds()).toHaveLength(200);
    expect(screen.getByTestId("guided-setup-picked-count")).toHaveTextContent(
      "0 of 200 picked",
    );
  });

  test("a monitor's name is drawn as the project wrote it, never looked up", async () => {
    api["loadMonitors"]!.mockResolvedValue([
      { id: "m-network", name: "Network" },
      { id: "m-delete", name: "Delete" },
    ]);
    api["loadMonitorGroups"]!.mockResolvedValue([]);
    await renderSetup();

    expect(
      screen.getByTestId("guided-setup-monitors").textContent || "",
    ).toContain("Network");
  });
});
