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
 * The Profiler's first steps, as the other telemetry products say them
 * ---------------------------------------------------------------------------
 *
 * The Profiler's Overview, for a project with no profile anywhere, and its
 * All profiles list, empty, said "No profiles yet" / "No profiles found."
 * over a six-line paragraph naming Grafana Alloy, zero-code eBPF profiling
 * and a Pyroscope SDK for eight languages, in boxes of their own design. They
 * now say what the empty Logs, Traces, Metrics and Exceptions explorers say
 * (Telemetry/TelemetryFirstSteps): what profiles show and when they come,
 * with the setup guide as the one way in. An All profiles list a deep-link
 * chip emptied says nothing matches instead, with the way to clear it.
 */

type CapturedTableProps = {
  noItemsMessage?: unknown;
  emptyState?:
    | {
        title?: string;
        description?: string;
        icon?: string;
        isFiltered?: boolean;
        onClearFilters?: () => void;
        actions?: Array<{
          title: string;
          dataTestId?: string;
          onClick: () => void;
        }>;
      }
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

import ProfilesDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfilesDashboard";
import ProfileTable from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable";
import {
  TELEMETRY_FIRST_STEPS_COPY,
  TelemetryFirstStepsCopy,
  TelemetryFirstStepsSignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryFirstSteps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

const COPY: TelemetryFirstStepsCopy =
  TELEMETRY_FIRST_STEPS_COPY[TelemetryFirstStepsSignal.Profiles];

const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let navigateSpy: ReturnType<typeof jest.spyOn>;
let setQueryStringSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  capturedTableProps = null;
  goTo(`/dashboard/${PROJECT_ID}/profiles`);
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return { data: { functions: [], activity: [], windowTotal: 0 } };
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      // Stay on the page.
    });
  setQueryStringSpy = jest
    .spyOn(Navigation, "setQueryString")
    .mockImplementation((): void => {
      // The URL is not what is under test.
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("the Profiler's first steps copy", () => {
  test("says what profiles show and when they come, in one short line", () => {
    expect(COPY.title).toBe("No profiles here yet");
    expect(COPY.description).toBe(
      "Profiles show where your code spends its time and memory. They appear here as soon as your apps or hosts send them.",
    );
    expect(COPY.setupAction).toBe("Set up profiling");
    // The Profiler's own icon, as the products menu draws it.
    expect(COPY.icon).toBe(IconProp.Fire);
    expect(COPY.description.length).toBeLessThanOrEqual(150);
    // The setup guide's job, not the empty page's.
    expect(COPY.description).not.toMatch(/Alloy|eBPF|Pyroscope/);
  });
});

describe("the Profiler's Overview with no profile anywhere", () => {
  test("shows the first steps, drawn like every other empty list", async () => {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <ProfilesDashboard />
        </MemoryRouter>,
      );
    });

    const state: HTMLElement = await screen.findByTestId(
      COPY.dataTestId,
      {},
      { timeout: 20000 },
    );

    expect(state).toHaveAttribute("data-empty-state-kind", "empty");
    expect(
      within(state).getByRole("heading", { name: "No profiles here yet" }),
    ).toBeInTheDocument();
    expect(within(state).getByText(COPY.description)).toBeInTheDocument();
    expect(
      within(state)
        .getByTestId(`${COPY.dataTestId}-illustration`)
        .querySelector(`[data-icon="${IconProp.Fire}"]`),
    ).not.toBeNull();

    // The old paragraph is gone.
    expect(screen.queryByText(/Grafana Alloy/)).toBeNull();
    expect(screen.queryByText("No profiles yet")).toBeNull();

    // No longer range to offer: nothing anywhere is not a window problem.
    expect(within(state).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(
      within(state).getByRole("button", { name: "Set up profiling" }),
    );

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      routeFor(PageMap.PROFILES_DOCUMENTATION),
    );
  });
});

describe("the All profiles list", () => {
  const renderTable: (
    props?: React.ComponentProps<typeof ProfileTable>,
  ) => Promise<void> = async (
    props?: React.ComponentProps<typeof ProfileTable>,
  ): Promise<void> => {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <ProfileTable {...(props || {})} />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(capturedTableProps).not.toBeNull();
    });
  };

  test("empty with nothing narrowing it: the same first steps, through the table's own empty state", async () => {
    await renderTable();

    const emptyState: CapturedTableProps["emptyState"] =
      capturedTableProps!.emptyState;

    expect(capturedTableProps!.noItemsMessage).toBeUndefined();
    expect(emptyState).toMatchObject({
      title: COPY.title,
      description: COPY.description,
      icon: IconProp.Fire,
    });
    expect(emptyState!.isFiltered).toBeUndefined();
    expect(
      emptyState!.actions!.map((action: { title: string }): string => {
        return action.title;
      }),
    ).toEqual(["Set up profiling"]);

    emptyState!.actions![0]!.onClick();

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      routeFor(PageMap.PROFILES_DOCUMENTATION),
    );
  });

  test("emptied by a deep-link chip: nothing matches, and the chips clear - never the setup guide", async () => {
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/profiles/list?serviceId=${SERVICE_ID}&profileType=cpu`,
    );

    await renderTable();

    const emptyState: CapturedTableProps["emptyState"] =
      capturedTableProps!.emptyState;

    expect(emptyState!.isFiltered).toBe(true);
    expect(emptyState!.title).toBeUndefined();
    expect(emptyState!.actions).toBeUndefined();

    await act(async (): Promise<void> => {
      emptyState!.onClearFilters!();
    });

    expect(setQueryStringSpy).toHaveBeenCalledWith({
      traceId: null,
      serviceId: null,
      profileType: null,
    });

    // Cleared, the list is unnarrowed again: the first steps are back.
    await waitFor(() => {
      expect(capturedTableProps!.emptyState!.isFiltered).toBeUndefined();
    });
    expect(capturedTableProps!.emptyState!.title).toBe(COPY.title);
  });

  test("an embed keeps the sentence it passes, with no first steps", async () => {
    await renderTable({
      noItemsMessage: "No profiles found for this service.",
    });

    expect(capturedTableProps!.noItemsMessage).toBe(
      "No profiles found for this service.",
    );
    expect(capturedTableProps!.emptyState).toBeUndefined();
  });
});
