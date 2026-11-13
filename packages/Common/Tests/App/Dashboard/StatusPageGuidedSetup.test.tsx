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
  findOwnStatusPage: getJestMockFunction(),
  createStatusPage: getJestMockFunction(),
  addMonitors: getJestMockFunction(),
  loadStatusPage: getJestMockFunction(),
  loadShownMonitors: getJestMockFunction(),
};
let mayCreate: boolean = true;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi",
  () => {
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadMonitors",
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
  isSameStatusPageName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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
  return JSON.parse(window.localStorage.getItem(RUN_KEY) || "{}") as Record<
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

describe("a brand-new run", () => {
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

  test("monitors that could not be added keep step 1 open with the reason, and the page is kept", async () => {
    api["addMonitors"]!.mockRejectedValue(new Error("Plan limit reached"));
    await renderSetup();
    await press("guided-setup-monitor-m-api");
    await press("guided-setup-create-status-page");

    expect(screen.getByText("Plan limit reached")).toBeInTheDocument();
    expect(stepState("pick")).toBe("open");
    expect(storedRun()).toEqual({ statusPageId: PAGE_ID });
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

    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
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

    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
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
  const loseTheRunAndOpenAgain: () => Promise<void> =
    async (): Promise<void> => {
      window.localStorage.clear();
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

    expect(screen.getByText("Plan limit reached")).toBeInTheDocument();
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
