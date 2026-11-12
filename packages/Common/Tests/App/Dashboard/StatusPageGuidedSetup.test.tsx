import {
  afterEach,
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
import { STATUS_PAGE_SETUP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import Project from "../../../Models/DatabaseModels/Project";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

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

  test("Set up another status page starts a new run, with the project's name again", async () => {
    await reachSummary();
    await press("guided-setup-start-over");

    expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    expect(stepState("pick")).toBe("open");
    expect(nameField().value).toBe("Acme Status");
    expect(screen.getByTestId("guided-setup-monitor-m-api")).not.toBeChecked();
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
