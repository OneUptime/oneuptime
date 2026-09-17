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
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #3374: an Incident Episode created without a severity - which the REST
 * API allows, since only `title` is required and incidentSeverityId is a
 * nullable column - listed fine but could not be opened. The severity field's
 * getElement threw BadDataException("Episode Severity not found") from inside
 * Detail's own render, so the whole route was replaced by the app level
 * "Something went wrong" boundary. The only recovery was deleting the episode,
 * which detached every member incident.
 *
 * These tests drive the real page against a fake server and assert what a
 * person actually sees: the Episode Severity row, holding a placeholder.
 *
 * The current state field had the identical shape. Its FK is NOT NULL, but the
 * relation is nullable with orphanedRowAction "nullify" and nothing stops an
 * in-use IncidentState from being soft deleted - so it is covered here too.
 *
 * Detail now also swallows a throwing field renderer as a last resort. That
 * guard must NOT be what makes these pass: every case asserts the page never
 * logged "threw and was ignored", which is how a regression at the page level
 * stays visible instead of being quietly absorbed by the framework.
 *
 * The overview itself was later redesigned (header, stat bar, member list,
 * compact details column), so the last describe blocks pin that layout's
 * behaviour against the same fake server.
 */

const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const ACK_STATE_ID: string = "66666666-6666-4666-8666-666666666666";
const RESOLVED_STATE_ID: string = "77777777-7777-4777-8777-777777777777";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const loggerErrorMock: MockFunction = getJestMockFunction();

// The last props the stubbed header was rendered with.
const changeStateProps: { current: Record<string, any> | null } = {
  current: null,
};

// Every set of props the stubbed header was rendered with, in order.
const changeStateHistory: Array<Record<string, any>> = [];

// The last props the stubbed roles card was rendered with.
const rolesProps: { current: Record<string, any> | null } = {
  current: null,
};

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock consts above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Logger", () => {
  return {
    __esModule: true,
    Logger: {
      error: (...args: Array<any>) => {
        return loggerErrorMock(...args);
      },
      warn: () => {
        return undefined;
      },
      log: () => {
        return undefined;
      },
      info: () => {
        return undefined;
      },
    },
  };
});

/*
 * The page's three heavy children each drive their own API traffic and none of
 * them renders a detail field. Stubbing them keeps this suite pointed at the
 * Episode Details card, which is where #3374 lives. The header stub records
 * its props so the layout tests can drive a state change.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, any>) => {
        changeStateProps.current = props;
        changeStateHistory.push(props);
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeMemberRoleAssignment",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, any>) => {
        rolesProps.current = props;
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import IncidentEpisodeView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/incidents"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface EpisodeSpec {
  severity?: IncidentSeverity | null | undefined;
  state?: IncidentState | null | undefined;
}

type BuildSeverityFunction = (
  name: string | null,
  color: Color | null,
) => IncidentSeverity;

const buildSeverity: BuildSeverityFunction = (
  name: string | null,
  color: Color | null,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = new ObjectID("33333333-3333-4333-8333-333333333333");

  if (name) {
    severity.name = name;
  }

  if (color) {
    severity.color = color;
  }

  return severity;
};

type BuildStateFunction = (
  name: string | null,
  color: Color | null,
) => IncidentState;

const buildState: BuildStateFunction = (
  name: string | null,
  color: Color | null,
): IncidentState => {
  const state: IncidentState = new IncidentState();
  state.id = new ObjectID("44444444-4444-4444-8444-444444444444");

  if (name) {
    state.name = name;
  }

  if (color) {
    state.color = color;
  }

  return state;
};

/*
 * A row shaped like what the API actually returns for an episode created with
 * `{"title": "..."}` and nothing else: a title, a number, a state assigned by
 * IncidentEpisodeService.onBeforeCreate, and no severity at all.
 */
type BuildEpisodeFunction = (spec: EpisodeSpec) => IncidentEpisode;

const buildEpisode: BuildEpisodeFunction = (
  spec: EpisodeSpec,
): IncidentEpisode => {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode.id = new ObjectID(EPISODE_ID);
  episode.projectId = new ObjectID(PROJECT_ID);
  episode.title = "episode without severity";
  episode.episodeNumber = 7;
  episode.episodeNumberWithPrefix = "#7";
  episode.incidentCount = 0;
  episode.createdAt = new Date("2026-01-01T00:00:00.000Z");

  if (spec.severity) {
    episode.incidentSeverity = spec.severity;
  }

  if (spec.state) {
    episode.currentIncidentState = spec.state;
  }

  return episode;
};

type EmptyListFunction = () => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const emptyList: EmptyListFunction = () => {
  return {
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  };
};

type RenderPageFunction = (spec: EpisodeSpec) => Promise<void>;

const renderPage: RenderPageFunction = async (
  spec: EpisodeSpec,
): Promise<void> => {
  getItemMock.mockResolvedValue(buildEpisode(spec) as never);

  render(<IncidentEpisodeView {...pageProps} />);

  await waitFor((): void => {
    expect(screen.getByText("Episode Severity")).toBeInTheDocument();
  });
};

/*
 * Detail renders each field as <container><FieldLabel/><value/></container>,
 * and FieldLabel's root is the only div.space-y-1 in that subtree. Walking up
 * from the label and taking the sibling is what a person reading the row does.
 * The compact style the overview uses keeps exactly that shape.
 */
type FieldValueFunction = (title: string) => string;

const fieldValue: FieldValueFunction = (title: string): string => {
  const label: HTMLElement = screen.getByText(title);
  const labelRoot: Element | null = label.closest("div.space-y-1");
  const container: HTMLElement | null | undefined = labelRoot?.parentElement;

  if (!container) {
    throw new Error(`Could not find the field container for "${title}"`);
  }

  const value: Element | undefined = container.children[1];

  if (!value) {
    throw new Error(`The field "${title}" rendered no value element`);
  }

  return (value.textContent || "").trim();
};

type PillForFunction = (title: string) => HTMLElement;

const pillFor: PillForFunction = (title: string): HTMLElement => {
  const label: HTMLElement = screen.getByText(title);
  const labelRoot: Element | null = label.closest("div.space-y-1");
  const pill: HTMLElement | null | undefined =
    labelRoot?.parentElement?.querySelector<HTMLElement>(
      '[data-testid="pill"]',
    );

  if (!pill) {
    throw new Error(`The field "${title}" rendered no pill`);
  }

  return pill;
};

// A stat bar cell: label span -> label row -> cell; the value is the 2nd child.
type StatValueFunction = (label: string) => string;

const statValue: StatValueFunction = (label: string): string => {
  const cell: HTMLElement | null | undefined =
    screen.getByText(label).parentElement?.parentElement;

  return (cell?.children[1]?.textContent || "").trim();
};

type ExpectNoCrashFunction = () => void;

/*
 * Two separate claims, and both matter:
 *  - the app level ErrorBoundary copy is nowhere on the page, and
 *  - Detail never had to swallow a throw, so the page itself is null safe
 *    rather than being rescued by the framework guard.
 */
const expectNoCrash: ExpectNoCrashFunction = (): void => {
  expect(screen.queryByText("Something went wrong")).toBeNull();
  expect(screen.queryByText(/An unexpected error has occurred/)).toBeNull();

  const swallowed: Array<unknown> = loggerErrorMock.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return String(call[0]).includes("threw and was ignored");
    },
  );

  expect(swallowed).toEqual([]);
};

type CallsForModelFunction = (modelType: unknown) => Array<Array<any>>;

const listCallsFor: CallsForModelFunction = (
  modelType: unknown,
): Array<Array<any>> => {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    return call[0]?.modelType === modelType;
  });
};

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  loggerErrorMock.mockReset();
  changeStateProps.current = null;
  changeStateHistory.length = 0;
  rolesProps.current = null;

  getListMock.mockResolvedValue(emptyList() as never);
  getCommonHeadersMock.mockReturnValue({} as never);

  const path: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}`;

  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Incident Episode detail page: severity (issue #3374)", () => {
  test("renders the page when the episode has no severity at all", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    expect(fieldValue("Episode Severity")).toEqual("-");
    expectNoCrash();
  });

  test("renders the page when the severity relation is explicitly null", async () => {
    getItemMock.mockResolvedValue(
      Object.assign(
        buildEpisode({ state: buildState("Created", new Color("#4b5563")) }),
        { incidentSeverity: null },
      ) as never,
    );

    render(<IncidentEpisodeView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    });

    expect(fieldValue("Episode Severity")).toEqual("-");
    expectNoCrash();
  });

  test("still renders the rest of the episode when severity is missing", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    expect(fieldValue("Episode Number")).toContain("#7");
    expect(fieldValue("Incident Count")).toEqual("0");
    // No createdByUser on an API-created episode.
    expect(fieldValue("Created By")).toEqual("System");
    // An episode with no grouping rule is a manual one, not a crash.
    expect(fieldValue("Grouping Rule")).toEqual("Manual Episode");
    expect(fieldValue("Episode ID")).toContain(EPISODE_ID);
    expectNoCrash();
  });

  test("renders the severity pill when the episode has one", async () => {
    await renderPage({
      severity: buildSeverity("Critical", new Color("#ef4444")),
      state: buildState("Created", new Color("#4b5563")),
    });

    const pill: HTMLElement = pillFor("Episode Severity");

    expect(pill.textContent).toContain("Critical");
    expect(pill.style.backgroundColor).toEqual("rgb(239, 68, 68)");
    expectNoCrash();
  });

  test("falls back to Unknown when the severity has no name", async () => {
    await renderPage({
      severity: buildSeverity(null, new Color("#ef4444")),
      state: buildState("Created", new Color("#4b5563")),
    });

    expect(pillFor("Episode Severity").textContent).toContain("Unknown");
    expectNoCrash();
  });

  test("renders a severity with no color instead of crashing", async () => {
    await renderPage({
      severity: buildSeverity("Critical", null),
      state: buildState("Created", new Color("#4b5563")),
    });

    const pill: HTMLElement = pillFor("Episode Severity");

    expect(pill.textContent).toContain("Critical");
    // Black is the declared fallback in the page.
    expect(pill.style.backgroundColor).toEqual("rgb(0, 0, 0)");
    expectNoCrash();
  });
});

describe("Incident Episode detail page: current state", () => {
  test("renders a placeholder when the state relation is absent", async () => {
    await renderPage({
      severity: buildSeverity("Critical", new Color("#ef4444")),
    });

    expect(screen.getByText("Current State")).toBeInTheDocument();
    expect(fieldValue("Current State")).toEqual("-");
    expectNoCrash();
  });

  test("renders the state pill when the episode has one", async () => {
    await renderPage({
      severity: buildSeverity("Critical", new Color("#ef4444")),
      state: buildState("Acknowledged", new Color("#f59e0b")),
    });

    const pill: HTMLElement = pillFor("Current State");

    expect(pill.textContent).toContain("Acknowledged");
    expect(pill.style.backgroundColor).toEqual("rgb(245, 158, 11)");
    expectNoCrash();
  });

  test("falls back to Unknown when the state has no name", async () => {
    await renderPage({
      severity: buildSeverity("Critical", new Color("#ef4444")),
      state: buildState(null, new Color("#f59e0b")),
    });

    expect(pillFor("Current State").textContent).toContain("Unknown");
    expectNoCrash();
  });

  test("renders a state with no color instead of crashing", async () => {
    await renderPage({
      severity: buildSeverity("Critical", new Color("#ef4444")),
      state: buildState("Created", null),
    });

    expect(pillFor("Current State").style.backgroundColor).toEqual(
      "rgb(0, 0, 0)",
    );
    expectNoCrash();
  });
});

describe("Incident Episode detail page: both relations missing", () => {
  test("renders both placeholders when state and severity are absent", async () => {
    await renderPage({});

    expect(fieldValue("Episode Severity")).toEqual("-");
    expect(fieldValue("Current State")).toEqual("-");
    expect(fieldValue("Episode Number")).toContain("#7");
    expectNoCrash();
  });
});

describe("Incident Episode overview: details column", () => {
  test("uses the compact single-column style with the episode ID last", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    const numberRow: HTMLElement | null | undefined = screen
      .getByText("Episode Number")
      .closest("div.space-y-1")?.parentElement;
    const grid: HTMLElement | null | undefined = numberRow?.parentElement;

    expect(grid).toHaveClass("grid", "grid-cols-1", "divide-y");
    expect(grid).toHaveClass("sm:grid-cols-1");
    expect(numberRow).toHaveClass("py-3");

    const rowTitles: Array<string> = Array.from(grid!.children).map(
      (row: Element): string => {
        return (row.querySelector("label")?.textContent || "").trim();
      },
    );

    expect(rowTitles).toEqual([
      "Episode Number",
      "Current State",
      "Episode Severity",
      "Incident Count",
      "Grouping Rule",
      "Created By",
      "On-Call Duty Policies",
      "Created At",
      "Labels",
      "Episode ID",
    ]);
    expectNoCrash();
  });

  test("no longer repeats the title the header already shows", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    expect(screen.queryByText("Episode Title")).toBeNull();
    expect(screen.queryByText("Last Incident Added At")).toBeNull();
    // The number is plain text now, not a hand-rolled SVG chip.
    const numberRow: HTMLElement | null | undefined = screen
      .getByText("Episode Number")
      .closest("div.space-y-1")?.parentElement;

    expect(numberRow?.querySelector("svg")).toBeNull();
  });
  /*
   * The details card sits in a ~300px column. Its old side-by-side header put
   * "Edit Incident Episode" beside the title and squeezed the title and description
   * into a column a word or two wide.
   */
  test("stacks the details card header and keeps a short, gated Edit button", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    const header: HTMLElement = await waitFor(() => {
      return screen.getByTestId("card-header");
    });

    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(within(header).getByText("Episode Details")).toBeInTheDocument();
    expect(
      within(header).getByText("Key facts about this episode."),
    ).toBeInTheDocument();

    const actions: HTMLElement = await waitFor(() => {
      return screen.getByTestId("card-header-actions");
    });
    const edit: HTMLElement = within(actions).getByRole("button", {
      name: "Edit",
    });

    expect(edit).not.toBeDisabled();
    expect(screen.queryByText("Edit Incident Episode")).toBeNull();
    expect(
      screen.queryByText("Here are more details for this episode."),
    ).toBeNull();
    // The roles card shares the column and stacks the same way.
    expect(rolesProps.current?.["headerLayout"]).toBe("stacked");
    expectNoCrash();
  });
});

describe("Incident Episode overview: loading and layout", () => {
  test("shows the overview skeleton and fires every page request at once", async () => {
    getListMock.mockReturnValue(new Promise<never>(() => {}) as never);
    getItemMock.mockReturnValue(new Promise<never>(() => {}) as never);

    render(<IncidentEpisodeView {...pageProps} />);

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toHaveTextContent("Loading episode");
    expect(
      screen
        .getByTestId("event-overview-skeleton-stats")
        .querySelectorAll(".bg-white"),
    ).toHaveLength(4);

    // Nothing below the skeleton mounts (and fetches) until the page is ready.
    expect(screen.queryByText("Episode Severity")).toBeNull();
    expect(changeStateProps.current).toBeNull();

    // All four requests are in flight together rather than one after another.
    expect(listCallsFor(Incident)).toHaveLength(1);
    expect(listCallsFor(IncidentEpisodeStateTimeline)).toHaveLength(1);
    expect(listCallsFor(IncidentState)).toHaveLength(1);
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("still reads the first member's telemetry snapshot, earliest declared", async () => {
    await renderPage({});

    const firstMemberCall: Array<any> = listCallsFor(Incident).find(
      (call: Array<any>): boolean => {
        return call[0].limit === 1;
      },
    )!;

    expect(firstMemberCall[0].query.incidentEpisodeId.toString()).toBe(
      EPISODE_ID,
    );
    expect(firstMemberCall[0].select).toEqual({
      _id: true,
      telemetryQuery: true,
      seriesLabels: true,
    });
    expect(firstMemberCall[0].sort).toEqual({
      declaredAt: SortOrder.Ascending,
    });
  });

  test("renders the header, a four-cell stat bar and the member list", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    expect(changeStateProps.current?.["episodeId"].toString()).toBe(EPISODE_ID);

    const statBar: HTMLElement = screen.getByRole("group", {
      name: "Episode timing",
    });

    expect(within(statBar).getByText("Acknowledged in")).toBeInTheDocument();
    expect(within(statBar).getByText("Resolved in")).toBeInTheDocument();
    expect(within(statBar).getByText("Duration")).toBeInTheDocument();
    expect(within(statBar).getByText("Incidents")).toBeInTheDocument();
    expect(statValue("Incidents")).toBe("0");

    await waitFor((): void => {
      expect(
        screen.getByText("No incidents in this episode yet"),
      ).toBeInTheDocument();
    });

    const memberCall: Array<any> = listCallsFor(Incident).find(
      (call: Array<any>): boolean => {
        return call[0].limit === 8;
      },
    )!;

    expect(memberCall[0].query.incidentEpisodeId.toString()).toBe(EPISODE_ID);
    expect(memberCall[0].sort).toEqual({ declaredAt: SortOrder.Descending });
    expectNoCrash();
  });

  test("measures the stat bar from declaredAt with the project's state names", async () => {
    const declaredAt: Date = new Date("2026-09-14T18:00:00.000Z");

    const ackState: IncidentState = new IncidentState();
    ackState.id = new ObjectID(ACK_STATE_ID);
    ackState.name = "Triaged";
    ackState.isAcknowledgedState = true;

    const resolvedState: IncidentState = new IncidentState();
    resolvedState.id = new ObjectID(RESOLVED_STATE_ID);
    resolvedState.name = "Fixed";
    resolvedState.isResolvedState = true;

    const ackTimeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    ackTimeline.incidentStateId = new ObjectID(ACK_STATE_ID);
    // Written long after creation, so a first-timeline start would be wrong.
    ackTimeline.startsAt = new Date(declaredAt.getTime() + 42 * 60 * 1000);

    const resolvedTimeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    resolvedTimeline.incidentStateId = new ObjectID(RESOLVED_STATE_ID);
    resolvedTimeline.startsAt = new Date(
      declaredAt.getTime() + 125 * 60 * 1000,
    );

    getListMock.mockImplementation((...args: Array<any>) => {
      const modelType: unknown = args[0]?.modelType;

      if (modelType === IncidentState) {
        return Promise.resolve({
          data: [ackState, resolvedState],
          count: 2,
          skip: 0,
          limit: 2,
        });
      }

      if (modelType === IncidentEpisodeStateTimeline) {
        return Promise.resolve({
          data: [resolvedTimeline, ackTimeline],
          count: 2,
          skip: 0,
          limit: 2,
        });
      }

      return Promise.resolve(emptyList());
    });

    const episode: IncidentEpisode = buildEpisode({});
    episode.declaredAt = declaredAt;
    episode.createdAt = new Date(declaredAt.getTime() - 3 * 24 * 3600 * 1000);
    episode.incidentCount = 3;

    getItemMock.mockResolvedValue(episode as never);

    render(<IncidentEpisodeView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("Triaged in")).toBeInTheDocument();
    });

    expect(statValue("Triaged in")).toBe("42 minutes");
    expect(statValue("Fixed in")).toBe("2 hours, 5 minutes");
    // Resolved now, so the duration is closed: declared -> resolved.
    expect(statValue("Duration")).toBe("2 hours, 5 minutes");
    expect(statValue("Incidents")).toBe("3");
  });

  test("a state change refreshes the page in place instead of unmounting it", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    await waitFor((): void => {
      expect(
        screen.getByText("No incidents in this episode yet"),
      ).toBeInTheDocument();
    });

    const timelineCallsBefore: number = listCallsFor(
      IncidentEpisodeStateTimeline,
    ).length;
    const memberCallsBefore: number = listCallsFor(Incident).filter(
      (call: Array<any>): boolean => {
        return call[0].limit === 8;
      },
    ).length;
    const detailFetchesBefore: number = getItemMock.mock.calls.length;

    let pending: Promise<void> | undefined;

    act(() => {
      pending = changeStateProps.current!["onActionComplete"]();
    });

    // No skeleton, no loader: the stat bar and header stay on screen.
    expect(screen.queryByText("Loading episode")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Episode timing" }),
    ).toBeInTheDocument();

    await act(async () => {
      await pending;
    });

    await waitFor((): void => {
      expect(listCallsFor(IncidentEpisodeStateTimeline).length).toBe(
        timelineCallsBefore + 1,
      );
      // The member list reloads too: member states moved with the episode.
      expect(
        listCallsFor(Incident).filter((call: Array<any>): boolean => {
          return call[0].limit === 8;
        }).length,
      ).toBe(memberCallsBefore + 1);
      // Page timing getItem plus the details card reload.
      expect(getItemMock.mock.calls.length).toBeGreaterThanOrEqual(
        detailFetchesBefore + 2,
      );
    });

    expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    expectNoCrash();
  });

  test("a failed first load offers a retry that recovers", async () => {
    getItemMock.mockResolvedValue(buildEpisode({}) as never);
    getListMock.mockRejectedValueOnce(new Error("Episode service down"));

    render(<IncidentEpisodeView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("Episode service down")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor((): void => {
      expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    });

    expect(screen.queryByText("Episode service down")).toBeNull();
  });

  test("a failed refresh keeps the page and says so inline", async () => {
    await renderPage({ state: buildState("Created", new Color("#4b5563")) });

    getListMock.mockRejectedValueOnce(new Error("Timeline unavailable"));

    await act(async () => {
      await changeStateProps.current!["onActionComplete"]();
    });

    await waitFor((): void => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't refresh episode timings: Timeline unavailable",
      );
    });

    expect(
      screen.getByRole("group", { name: "Episode timing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Episode Severity")).toBeInTheDocument();
  });
});

describe("Incident Episode overview: moving to another episode on the same route", () => {
  /*
   * The overview is an index route inside the episode layout, so moving to
   * another episode re-renders this page with a new id instead of remounting
   * it. The first render for the new id used to mount the header, the member
   * list and the details card for the new id over the previous episode's
   * numbers (each one fetching) before an effect flipped back to the skeleton.
   */
  const OTHER_EPISODE_ID: string = "99999999-9999-4999-8999-999999999999";

  type NavigateToFunction = (episodeId: string) => void;

  const navigateTo: NavigateToFunction = (episodeId: string): void => {
    const path: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${episodeId}`;

    window.history.pushState({}, "", path);
    Navigation.setLocation({
      pathname: path,
      search: "",
      hash: "",
      state: null,
      key: "other",
    } as Location);
  };

  // The page's own timing read asks for resolvedAt; the details card does not.
  type IsPageReadFunction = (call: Array<any>) => boolean;

  const isPageRead: IsPageReadFunction = (call: Array<any>): boolean => {
    return call[0]?.select?.resolvedAt === true;
  };

  type ReadsForFunction = (
    episodeId: string,
    predicate: IsPageReadFunction,
  ) => number;

  const readsFor: ReadsForFunction = (
    episodeId: string,
    predicate: IsPageReadFunction,
  ): number => {
    return getItemMock.mock.calls.filter((call: Array<any>): boolean => {
      return call[0]?.id?.toString() === episodeId && predicate(call);
    }).length;
  };

  type ServeEpisodesFunction = (
    otherPageRead: Promise<IncidentEpisode>,
  ) => void;

  const serveEpisodes: ServeEpisodesFunction = (
    otherPageRead: Promise<IncidentEpisode>,
  ): void => {
    getItemMock.mockImplementation((...args: Array<any>) => {
      const request: Record<string, any> = args[0];

      if (request["id"]?.toString() === OTHER_EPISODE_ID && isPageRead(args)) {
        return otherPageRead;
      }

      const episode: IncidentEpisode = buildEpisode({
        state: buildState("Created", new Color("#4b5563")),
      });

      if (request["id"]?.toString() === OTHER_EPISODE_ID) {
        episode.id = new ObjectID(OTHER_EPISODE_ID);
        episode.incidentCount = 5;
      }

      return Promise.resolve(episode);
    });
  };

  test("shows the skeleton first and renders nothing for the new id before its numbers land", async () => {
    let resolveOther: (episode: IncidentEpisode) => void = (): void => {};
    const otherPageRead: Promise<IncidentEpisode> =
      new Promise<IncidentEpisode>(
        (resolve: (episode: IncidentEpisode) => void) => {
          resolveOther = resolve;
        },
      );

    serveEpisodes(otherPageRead);

    const view: ReturnType<typeof render> = render(
      <IncidentEpisodeView {...pageProps} />,
    );

    await waitFor((): void => {
      expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    });

    const headerRendersBefore: number = changeStateHistory.length;

    navigateTo(OTHER_EPISODE_ID);
    view.rerender(<IncidentEpisodeView {...pageProps} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading episode");
    expect(screen.queryByText("Episode Severity")).toBeNull();

    await waitFor((): void => {
      expect(readsFor(OTHER_EPISODE_ID, isPageRead)).toBe(1);
    });

    // Neither the header nor the details card rendered for the new id yet.
    expect(
      changeStateHistory
        .slice(headerRendersBefore)
        .filter((props: Record<string, any>): boolean => {
          return props["episodeId"]?.toString() === OTHER_EPISODE_ID;
        }),
    ).toEqual([]);
    expect(
      readsFor(OTHER_EPISODE_ID, (call: Array<any>): boolean => {
        return !isPageRead(call);
      }),
    ).toBe(0);

    const otherEpisode: IncidentEpisode = buildEpisode({});
    otherEpisode.id = new ObjectID(OTHER_EPISODE_ID);
    otherEpisode.incidentCount = 5;

    await act(async () => {
      resolveOther(otherEpisode);
    });

    await waitFor((): void => {
      expect(statValue("Incidents")).toBe("5");
    });

    expect(changeStateProps.current?.["episodeId"].toString()).toBe(
      OTHER_EPISODE_ID,
    );

    await waitFor((): void => {
      expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    });

    // The details card mounted once for the new episode: one read, not two.
    expect(
      readsFor(OTHER_EPISODE_ID, (call: Array<any>): boolean => {
        return !isPageRead(call);
      }),
    ).toBe(1);
    expectNoCrash();
  });

  test("an action on the previous episode that finishes after the switch cannot cancel the next one's load", async () => {
    let resolveOther: (episode: IncidentEpisode) => void = (): void => {};
    const otherPageRead: Promise<IncidentEpisode> =
      new Promise<IncidentEpisode>(
        (resolve: (episode: IncidentEpisode) => void) => {
          resolveOther = resolve;
        },
      );

    serveEpisodes(otherPageRead);

    const view: ReturnType<typeof render> = render(
      <IncidentEpisodeView {...pageProps} />,
    );

    await waitFor((): void => {
      expect(screen.getByText("Episode Severity")).toBeInTheDocument();
    });

    // Handed to the previous episode's header, which can still call it.
    const previousOnActionComplete: () => Promise<void> =
      changeStateProps.current!["onActionComplete"];

    navigateTo(OTHER_EPISODE_ID);
    view.rerender(<IncidentEpisodeView {...pageProps} />);

    await waitFor((): void => {
      expect(readsFor(OTHER_EPISODE_ID, isPageRead)).toBe(1);
    });

    const timelineReadsBefore: number = listCallsFor(
      IncidentEpisodeStateTimeline,
    ).length;
    const previousPageReadsBefore: number = readsFor(EPISODE_ID, isPageRead);

    await act(async () => {
      await previousOnActionComplete();
    });

    // Nothing was read again for the episode the reader already left.
    expect(listCallsFor(IncidentEpisodeStateTimeline).length).toBe(
      timelineReadsBefore,
    );
    expect(readsFor(EPISODE_ID, isPageRead)).toBe(previousPageReadsBefore);

    const otherEpisode: IncidentEpisode = buildEpisode({});
    otherEpisode.id = new ObjectID(OTHER_EPISODE_ID);
    otherEpisode.incidentCount = 5;

    await act(async () => {
      resolveOther(otherEpisode);
    });

    await waitFor((): void => {
      expect(statValue("Incidents")).toBe("5");
    });
  });
});
