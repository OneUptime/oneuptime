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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

// The reader's repositories, answered by Code's routes as the server answers them.
const world: {
  repositories: Array<FakeCodeRepository>;
  reads: Array<CodeRepositoriesQuery>;
  telemetrySuggestion: unknown;
  profileSuggestion: unknown;
  telemetryFixes: Array<unknown>;
  profileFixes: Array<unknown>;
} = {
  repositories: [],
  reads: [],
  telemetrySuggestion: null,
  profileSuggestion: null,
  telemetryFixes: [],
  profileFixes: [],
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      default: {
        getRepositories: async (query: CodeRepositoriesQuery) => {
          world.reads.push(query);

          return answerRepositoriesQuery({
            repositories: world.repositories,
            query,
          });
        },
        getRepositoriesById: async (
          ids: Array<string>,
          scope?: CodeRepositoriesScope,
        ) => {
          return answerRepositoriesById({
            repositories: world.repositories,
            ids,
            scope,
          });
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: (): boolean => {
      return true;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiApi",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      fetchTelemetryAiFixSuggestion: async () => {
        return world.telemetrySuggestion;
      },
      createTelemetryAiFix: async (data: unknown) => {
        world.telemetryFixes.push(data);
        return "task-1";
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfilesApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfilesApi",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      fetchProfileFixSuggestion: async () => {
        return world.profileSuggestion;
      },
      createProfileFixTask: async (data: unknown) => {
        world.profileFixes.push(data);
        return "task-2";
      },
    };
  },
);

import TelemetryAiFixStrip from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixStrip";
import {
  TELEMETRY_AI_FIX_COPY,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import ProfileFixStrip, {
  PROFILE_FIX_REPOSITORY_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileFixStrip";
import TracePerformanceSuggestion, {
  TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID,
  TRACE_FIX_PERFORMANCE_REPOSITORY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TracePerformanceSuggestion";
import {
  CodeRepositoriesQuery,
  CodeRepositoriesScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import Route from "../../../Types/API/Route";
import { ProfileCategory } from "../../../Utils/Profiles/ProfileTypes";
import {
  ProfileFixReason,
  ProfileFixSuggestion,
} from "../../../Utils/Suggestions/ProfileFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { TelemetryAiFixSuggestion } from "../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import {
  MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES,
  TracePerformanceFixSuggestion,
} from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";

/*
 * FIX WITH AI'S STRIPS: THE REPOSITORY TO FIX IN, PAST A PROJECT'S FIRST
 * REPOSITORIES (#10921).
 *
 * When no repository was found to hold the code for certain, a finding's
 * strip, the Profiler's and the trace page's Fix performance with AI asked
 * for one from a fixed list: every repository the person may ask in (one
 * very long list in a project of thousands), or for the trace page the
 * first 200 connected ones by name, so one past them could not be picked.
 * Each strip searches the server now, held to exactly what its fix accepts:
 *
 *   - a finding's and a profile's fix: connected repositories whose code
 *     OneUptime reads, that the person may ask OneUptime AI to work in;
 *   - Fix performance with AI: connected repositories the person may read,
 *     as its route takes any connected one.
 */

configure({ asyncUtilTimeout: 15000 });

const WAREHOUSE_ID: string = "10921000-0000-4000-8000-00000000b0a1";
const WHARF_ID: string = "10921000-0000-4000-8000-00000000b0a2";
const WATCHTOWER_ID: string = "10921000-0000-4000-8000-00000000b0a3";
const WALRUS_ID: string = "10921000-0000-4000-8000-00000000b0a4";

function repository(data: {
  id: string;
  name: string;
  isConnected?: boolean;
  canAsk?: boolean;
  isCodeReadable?: boolean;
}): FakeCodeRepository {
  return {
    id: data.id,
    name: data.name,
    organizationName: "harbour",
    repositoryName: data.name,
    isConnected: data.isConnected !== false,
    provider: "GitHub",
    canAsk: data.canAsk,
    isCodeReadable: data.isCodeReadable,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  };
}

/*
 * More repositories than any list ever read, then four past them by name,
 * each kept from a different fix for a different reason.
 */
function manyRepositories(): Array<FakeCodeRepository> {
  return [
    ...repositoriesSortingFirst(10050),
    repository({ id: WAREHOUSE_ID, name: "warehouse-api" }),
    // Not connected: no fix works in it.
    repository({ id: WHARF_ID, name: "wharf-legacy", isConnected: false }),
    // Connected, but the person may only read it.
    repository({
      id: WATCHTOWER_ID,
      name: "watchtower-billing",
      canAsk: false,
    }),
    // Connected on a Git server OneUptime does not read the code of.
    repository({
      id: WALRUS_ID,
      name: "walrus-ledger",
      isCodeReadable: false,
    }),
  ];
}

function telemetrySuggestion(
  data: Partial<TelemetryAiFixSuggestion> = {},
): TelemetryAiFixSuggestion {
  return {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: null,
    // Several the person can ask in: a pick is asked for.
    repositories: [
      { id: "10921000-0000-4000-8000-00000000b001", name: "ap-000001" },
      { id: "10921000-0000-4000-8000-00000000b002", name: "ap-000002" },
    ],
    taskId: null,
    ...data,
  };
}

function profileSuggestion(
  data: Partial<ProfileFixSuggestion> = {},
): ProfileFixSuggestion {
  return {
    offer: SuggestionOffer.Act,
    reason: ProfileFixReason.Hot,
    blocker: null,
    evidence: {
      category: ProfileCategory.Cpu,
      isOwnCode: true,
      ownShare: 23,
      functionSampleCount: 400,
      windowSampleCount: 2000,
    },
    repository: null,
    repositories: [
      { id: "10921000-0000-4000-8000-00000000b001", name: "ap-000001" },
      { id: "10921000-0000-4000-8000-00000000b002", name: "ap-000002" },
    ],
    taskId: null,
    ...data,
  };
}

function finding(): PerformanceFinding {
  return {
    findingType: PerformanceFindingType.NPlusOneQuery,
    headline: "",
    evidence: "",
    spanCount: 14,
    combinedDurationMs: 840,
    traceDurationMs: 1600,
    percentOfTrace: 52.5,
    normalizedSpanName: "SELECT products WHERE id = {n}",
    parentSpanName: "POST /api/v1/checkout",
    normalizedDbStatement: "SELECT * FROM products WHERE id = ?",
    dbSystem: "postgresql",
    implicatedSpans: [
      { spanId: "q0", name: "SELECT products WHERE id = $1", durationMs: 60 },
    ],
  };
}

// The first 200 connected repositories by name: the suggestion's list.
function firstTwoHundred(): Array<{ id: string; name: string }> {
  return repositoriesSortingFirst(MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES).map(
    (item: FakeCodeRepository): { id: string; name: string } => {
      return { id: item.id, name: item.name };
    },
  );
}

beforeEach(() => {
  world.repositories = manyRepositories();
  world.reads = [];
  world.telemetrySuggestion = telemetrySuggestion();
  world.profileSuggestion = profileSuggestion();
  world.telemetryFixes = [];
  world.profileFixes = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function draw(element: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
}

async function search(testId: string, text: string): Promise<void> {
  const field: HTMLElement = await screen.findByTestId(testId);

  await act(async () => {
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: text } });
  });
}

function lastRead(): CodeRepositoriesQuery | undefined {
  return world.reads[world.reads.length - 1];
}

function optionTexts(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function hasOption(name: string): boolean {
  return optionTexts().some((text: string): boolean => {
    return text.includes(name);
  });
}

async function pick(name: RegExp): Promise<void> {
  const option: HTMLElement = await screen.findByRole("option", { name });

  await act(async () => {
    fireEvent.click(option);
  });
}

describe("a finding's Fix with AI", () => {
  const INSIGHT_ID: string = "10921000-0000-4000-8000-00000000a001";

  async function drawStrip(): Promise<void> {
    await draw(<TelemetryAiFixStrip insightId={INSIGHT_ID} />);
    await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.strip);
  }

  test("with no repository found for certain, the pick is searched on the server among the repositories the fix works in", async () => {
    await drawStrip();

    expect(
      screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.repository),
    ).toHaveTextContent(TELEMETRY_AI_FIX_COPY.pickRepository);
    expect(screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.button)).toBeDisabled();

    await search(TELEMETRY_AI_FIX_TEST_IDS.repositoryPicker, "w");
    await screen.findByRole("option", { name: /warehouse-api/ });

    expect(lastRead()).toMatchObject({
      search: "w",
      askableOnly: true,
      codeReadableOnly: true,
    });
    // Not connected, read only, or code OneUptime does not read: none offered.
    expect(hasOption("wharf-legacy")).toBe(false);
    expect(hasOption("watchtower-billing")).toBe(false);
    expect(hasOption("walrus-ledger")).toBe(false);
    expect(
      screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.repositoryPicker),
    ).toHaveAccessibleName(TELEMETRY_AI_FIX_COPY.pickRepository);
  });

  test("a repository past the project's first 10,000 is picked, and the fix is asked for in it", async () => {
    await drawStrip();
    await search(TELEMETRY_AI_FIX_TEST_IDS.repositoryPicker, "warehouse");
    await pick(/warehouse-api/);

    const button: HTMLElement = screen.getByTestId(
      TELEMETRY_AI_FIX_TEST_IDS.button,
    );

    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(world.telemetryFixes).toEqual([
        { insightId: INSIGHT_ID, repositoryId: WAREHOUSE_ID },
      ]);
    });
  });

  test("with nothing the person may ask in to offer, the list says so", async () => {
    world.repositories = [
      repository({ id: WHARF_ID, name: "wharf-legacy", isConnected: false }),
      repository({
        id: WATCHTOWER_ID,
        name: "watchtower-billing",
        canAsk: false,
      }),
    ];

    await drawStrip();

    await act(async () => {
      fireEvent.focus(
        screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.repositoryPicker),
      );
    });

    expect(
      await screen.findByTestId("entity-dropdown-empty-list"),
    ).toHaveTextContent(TELEMETRY_AI_FIX_COPY.noAskableRepository);
  });

  test("a repository found for certain: no picker, and the fix works in it", async () => {
    world.telemetrySuggestion = telemetrySuggestion({
      repository: { id: WAREHOUSE_ID, name: "warehouse-api" },
      repositories: [],
    });

    await drawStrip();

    expect(
      screen.queryByTestId(TELEMETRY_AI_FIX_TEST_IDS.repository),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId(TELEMETRY_AI_FIX_TEST_IDS.button));
    });

    await waitFor(() => {
      expect(world.telemetryFixes).toEqual([{ insightId: INSIGHT_ID }]);
    });
    expect(world.reads).toEqual([]);
  });
});

describe("the Profiler's Fix with AI", () => {
  const REQUEST: {
    serviceId: string;
    functionName: string;
    fileName: string;
    profileType: string;
    window: { startTime: Date; endTime: Date };
  } = {
    serviceId: "10921000-0000-4000-8000-00000000a002",
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    profileType: "cpu",
    window: {
      startTime: new Date("2026-11-24T10:00:00.000Z"),
      endTime: new Date("2026-11-24T11:00:00.000Z"),
    },
  };

  async function drawStrip(): Promise<void> {
    await draw(<ProfileFixStrip request={REQUEST} />);
    await screen.findByTestId("profiles-fix");
  }

  test("with no repository found for certain, the pick is searched on the server among the repositories the fix works in", async () => {
    await drawStrip();

    expect(screen.getByTestId("profiles-fix-with-ai")).toBeDisabled();

    await search(PROFILE_FIX_REPOSITORY_PICKER_TEST_ID, "w");
    await screen.findByRole("option", { name: /warehouse-api/ });

    expect(lastRead()).toMatchObject({
      search: "w",
      askableOnly: true,
      codeReadableOnly: true,
    });
    expect(hasOption("wharf-legacy")).toBe(false);
    expect(hasOption("watchtower-billing")).toBe(false);
    expect(hasOption("walrus-ledger")).toBe(false);
    expect(
      screen.getByTestId(PROFILE_FIX_REPOSITORY_PICKER_TEST_ID),
    ).toHaveAccessibleName("Which repository holds this code?");
  });

  test("a repository past the project's first 10,000 is picked, and the fix is asked for in it", async () => {
    await drawStrip();
    await search(PROFILE_FIX_REPOSITORY_PICKER_TEST_ID, "warehouse");
    await pick(/warehouse-api/);

    const button: HTMLElement = screen.getByTestId("profiles-fix-with-ai");

    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(world.profileFixes).toHaveLength(1);
    });
    expect(world.profileFixes[0]).toMatchObject({
      functionName: "parseOrder",
      repositoryId: WAREHOUSE_ID,
    });
  });

  test("a repository found for certain: no picker, and the fix works in it", async () => {
    world.profileSuggestion = profileSuggestion({
      repository: { id: WAREHOUSE_ID, name: "warehouse-api" },
      repositories: [],
    });

    await drawStrip();

    expect(screen.queryByTestId("profiles-fix-repository")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("profiles-fix-with-ai"));
    });

    await waitFor(() => {
      expect(world.profileFixes).toHaveLength(1);
    });
    expect(world.profileFixes[0]).not.toHaveProperty("repositoryId");
  });
});

describe("the trace page's Fix performance with AI", () => {
  function suggestion(
    data: Partial<TracePerformanceFixSuggestion> = {},
  ): TracePerformanceFixSuggestion {
    return {
      offer: SuggestionOffer.Act,
      finding: finding(),
      findingCount: 1,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      // The first 200 connected ones: more than one, so a pick is asked for.
      repositories: firstTwoHundred(),
      ...data,
    };
  }

  async function drawStrip(
    onFix: (repositoryId?: string | undefined) => void = () => {},
  ): Promise<void> {
    await draw(
      <TracePerformanceSuggestion
        suggestion={suggestion()}
        taskRoute={null}
        connectRepositoryRoute={new Route("/dashboard/p/code")}
        isCreating={false}
        error={null}
        onFix={onFix}
      />,
    );
  }

  /*
   * #11075: its route takes only a repository the person may read and ask
   * OneUptime AI to work in now, as every other Fix with AI does - so the
   * picker searches only those. It searched every connected one the person
   * could read, and offered one the route would then refuse.
   */
  test("the pick is searched on the server among the connected repositories the person may ask OneUptime AI to work in - the ones its route takes", async () => {
    await drawStrip();

    expect(screen.getByTestId("trace-fix-performance")).toBeDisabled();

    await search(TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID, "w");
    await screen.findByRole("option", { name: /warehouse-api/ });

    expect(lastRead()).toMatchObject({
      search: "w",
      group: "connected",
      askableOnly: true,
    });
    // The run reads no code to fix a trace: a repository it cannot read the code of is offered.
    expect(lastRead()).not.toHaveProperty("codeReadableOnly");
    expect(hasOption("walrus-ledger")).toBe(true);
    // Connected, but the person may only read it: never.
    expect(hasOption("watchtower-billing")).toBe(false);
    // Not connected: never.
    expect(hasOption("wharf-legacy")).toBe(false);
  });

  test("a repository past the first 200 - and the first 10,000 - is picked, and the fix starts in it", async () => {
    const asked: Array<string | undefined> = [];

    await drawStrip((repositoryId?: string | undefined) => {
      asked.push(repositoryId);
    });

    // Not among the 200 the suggestion listed.
    expect(
      firstTwoHundred().some((item: { id: string }): boolean => {
        return item.id === WAREHOUSE_ID;
      }),
    ).toBe(false);

    await search(TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID, "warehouse");
    await pick(/warehouse-api/);

    const button: HTMLElement = screen.getByTestId("trace-fix-performance");

    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(asked).toEqual([WAREHOUSE_ID]);
  });

  test("opened, it lists the server's first page of connected repositories by name, not the 200 the suggestion listed", async () => {
    await drawStrip();

    await act(async () => {
      fireEvent.focus(
        screen.getByTestId(TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID),
      );
    });

    await screen.findByRole("option", { name: /ap-000001/ });

    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(
      within(
        screen.getByTestId(TRACE_FIX_PERFORMANCE_REPOSITORY_TEST_ID),
      ).getByTestId(TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID),
    ).toHaveAttribute("placeholder", "Pick a repository");
  });

  test("with no connected repository the person may ask OneUptime AI to work in, the list says so", async () => {
    world.repositories = [
      repository({ id: WHARF_ID, name: "wharf-legacy", isConnected: false }),
      // Connected and readable, but not theirs to ask AI in.
      repository({
        id: WATCHTOWER_ID,
        name: "watchtower-billing",
        canAsk: false,
      }),
    ];

    await drawStrip();

    await act(async () => {
      fireEvent.focus(
        screen.getByTestId(TRACE_FIX_PERFORMANCE_REPOSITORY_PICKER_TEST_ID),
      );
    });

    expect(
      await screen.findByTestId("entity-dropdown-empty-list"),
    ).toHaveTextContent(TELEMETRY_AI_FIX_COPY.noAskableRepository);
    expect(TELEMETRY_AI_FIX_COPY.noAskableRepository).toBe(
      "No connected repository you may ask OneUptime AI to work in.",
    );
  });
});
