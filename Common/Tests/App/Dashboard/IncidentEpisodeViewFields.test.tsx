import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
 */

const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const loggerErrorMock: MockFunction = getJestMockFunction();

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
 * Episode Details card, which is where #3374 lives.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/ChangeState",
  () => {
    return {
      __esModule: true,
      default: () => {
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
      default: () => {
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
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
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

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  loggerErrorMock.mockReset();

  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
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

    expect(screen.getByText("Episode Title")).toBeInTheDocument();
    expect(fieldValue("Episode Title")).toEqual("episode without severity");
    expect(fieldValue("Episode Number")).toContain("#7");
    expect(fieldValue("Incident Count")).toEqual("0");
    // No createdByUser on an API-created episode.
    expect(fieldValue("Created By")).toEqual("System");
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
    expect(fieldValue("Episode Title")).toEqual("episode without severity");
    expectNoCrash();
  });
});
