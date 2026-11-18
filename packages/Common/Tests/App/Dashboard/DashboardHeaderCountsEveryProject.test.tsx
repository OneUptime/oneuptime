import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import DashboardHeader, {
  HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";
import { HEADER_COUNT_EVENT_TYPES } from "../../../../App/FeatureSet/Dashboard/src/Components/Header/HeaderLiveCounts";
import {
  MAX_LIVE_PROJECTS,
  getLiveProjectIds,
  getLiveProjectsKey,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LiveProjects";

/*
 * THE HEADER'S COUNTS HEAR EVERY PROJECT THEY COUNT (issue #6917).
 *
 * The bell counts active incidents, alerts and episodes across every project
 * the person belongs to, but heard only the open project's changes: an
 * alert raised in project B, with project A open, did not move the count
 * until a reload. And the subscriptions were made once, when the header was
 * first drawn - on the first page of a session, before the person's projects
 * (or the open project) were known, so a header drawn then heard nothing at
 * all until the next reload.
 *
 * The header now listens in each of the person's projects, the open one
 * first, and starts over when - and only when - those projects change.
 * However many projects and changes, each count is read again at most once
 * every HEADER_COUNT_REFRESH_INTERVAL_IN_MS.
 *
 * The live connection is faked where the header reaches it (Realtime):
 * every subscription is recorded with its project, and a test announces a
 * change by calling what the header handed it.
 */

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_C: string = "33333333-3333-4333-8333-333333333333";
const PROJECT_D: string = "44444444-4444-4444-8444-444444444444";

const getMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const currentProjectIdMock: MockFunction = getJestMockFunction();

interface Listener {
  modelName: string;
  eventType: ModelEventType;
  tenantId: string;
  callback: () => void;
  isStopped: boolean;
}

const listeners: Array<Listener> = [];

/*
 * The bell's "Finish setting up your notifications" reads the person's own
 * readiness through API.get as well; NotificationSetupBell covers it, so
 * here it asks nothing and shows nothing.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/useNotificationSetupNudge",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { reason: null, hide: () => {} };
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return { tenantid: currentProjectIdMock()?.toString() };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectIdMock();
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: (
        options: {
          eventType: ModelEventType;
          modelType: { new (): { tableName?: string | null } };
          tenantId: { toString: () => string };
        },
        callback: () => void,
      ) => {
        const listener: Listener = {
          modelName: new options.modelType().tableName || "",
          eventType: options.eventType,
          tenantId: options.tenantId.toString(),
          callback: callback,
          isStopped: false,
        };

        listeners.push(listener);

        return () => {
          listener.isStopped = true;
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker",
  () => {
    return () => {
      return null;
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/UserProfile",
  () => {
    return () => {
      return null;
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Logo",
  () => {
    return () => {
      return null;
    };
  },
);

function project(id: string): Project {
  const result: Project = new Project();
  result.id = new ObjectID(id);
  result.name = `Project ${id.slice(0, 4)}`;
  return result;
}

function header(projectIds: Array<string>): ReactElement {
  const projects: Array<Project> = projectIds.map(project);
  const current: string | undefined = currentProjectIdMock()?.toString();

  return (
    <DashboardHeader
      projects={projects}
      onProjectSelected={() => {}}
      showProjectModal={false}
      onProjectModalClose={() => {}}
      selectedProject={
        projects.find((item: Project) => {
          return item.id?.toString() === current;
        }) || null
      }
    />
  );
}

function selectCurrentProject(id: string | null): void {
  // The real getter constructs a new ObjectID on every call.
  currentProjectIdMock.mockImplementation(() => {
    return id ? new ObjectID(id) : null;
  });
}

function active(): Array<Listener> {
  return listeners.filter((listener: Listener) => {
    return !listener.isStopped;
  });
}

// Each live subscription as model:event:project, sorted.
function subscriptions(): Array<string> {
  return active()
    .map((listener: Listener): string => {
      return `${listener.modelName}:${listener.eventType}:${listener.tenantId}`;
    })
    .sort();
}

// The projects at least one live subscription is in.
function projectsHeard(): Array<string> {
  return Array.from(
    new Set(
      active().map((listener: Listener): string => {
        return listener.tenantId;
      }),
    ),
  ).sort();
}

// The count requests the header made for a model, so far.
function countsOf(modelType: unknown): number {
  return countMock.mock.calls.filter((call: Array<unknown>) => {
    return (call[0] as { modelType: unknown }).modelType === modelType;
  }).length;
}

// A record of `modelName` changed in `tenantId`: every listener there hears it.
async function changed(
  modelName: string,
  eventType: ModelEventType,
  tenantId: string,
): Promise<void> {
  await act(async () => {
    for (const listener of active()) {
      if (
        listener.modelName === modelName &&
        listener.eventType === eventType &&
        listener.tenantId === tenantId
      ) {
        listener.callback();
      }
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.length = 0;
  selectCurrentProject(PROJECT_A);
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        escalationRulesByUser: [],
        escalationRulesByTeam: [],
        escalationRulesBySchedule: [],
      },
      {},
    ),
  );
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("which projects the header's counts hear", () => {
  test("every project the person belongs to, for each kind it counts and each kind of change", async () => {
    render(header([PROJECT_A, PROJECT_B, PROJECT_C]));
    await act(async () => {});

    const expected: Array<string> = [];

    for (const modelName of [
      "Incident",
      "Alert",
      "AlertEpisode",
      "IncidentEpisode",
    ]) {
      for (const eventType of [
        ModelEventType.Create,
        ModelEventType.Update,
        ModelEventType.Delete,
      ]) {
        for (const tenantId of [PROJECT_A, PROJECT_B, PROJECT_C]) {
          expected.push(`${modelName}:${eventType}:${tenantId}`);
        }
      }
    }

    expect(subscriptions()).toEqual(expected.sort());
  });

  test("each project once, though the open one is in the list too", async () => {
    render(header([PROJECT_B, PROJECT_A, PROJECT_B]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A, PROJECT_B]);
    // 4 kinds x 3 kinds of change x 2 projects.
    expect(active()).toHaveLength(24);
  });

  test("the projects listed after the header was drawn - the first page of a session - are heard once they are", async () => {
    // No project yet: nothing to listen in.
    selectCurrentProject(null);
    const view: ReturnType<typeof render> = render(header([]));
    await act(async () => {});

    expect(active()).toHaveLength(0);

    // The project list arrives, and the open project is chosen from it.
    selectCurrentProject(PROJECT_A);
    view.rerender(header([PROJECT_A, PROJECT_B]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A, PROJECT_B]);

    // A change in either is counted.
    await changed("Alert", ModelEventType.Create, PROJECT_B);
    expect(countsOf(Alert)).toBe(2);
  });

  test("the open project is heard before the list arrives", async () => {
    const view: ReturnType<typeof render> = render(header([]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A]);

    view.rerender(header([PROJECT_A, PROJECT_C]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A, PROJECT_C]);
  });

  test("a project the person joins is heard from then on, and one they leave is not", async () => {
    const view: ReturnType<typeof render> = render(
      header([PROJECT_A, PROJECT_B, PROJECT_C]),
    );
    await act(async () => {});

    view.rerender(header([PROJECT_A, PROJECT_B, PROJECT_D]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A, PROJECT_B, PROJECT_D]);

    // Project C's changes no longer reach the count.
    const before: number = countsOf(Incident);
    await changed("Incident", ModelEventType.Create, PROJECT_C);
    expect(countsOf(Incident)).toBe(before);

    await changed("Incident", ModelEventType.Create, PROJECT_D);
    expect(countsOf(Incident)).toBe(before + 1);
  });

  test("the list read again with the same projects joins nothing again", async () => {
    const view: ReturnType<typeof render> = render(
      header([PROJECT_A, PROJECT_B]),
    );
    await act(async () => {});

    const made: number = listeners.length;

    // New Project objects, the same projects, in another order.
    view.rerender(header([PROJECT_B, PROJECT_A]));
    view.rerender(header([PROJECT_A, PROJECT_B]));
    await act(async () => {});

    expect(listeners.length).toBe(made);
    expect(
      listeners.every((listener: Listener) => {
        return !listener.isStopped;
      }),
    ).toBe(true);
  });

  test("the project opened without a reload is still heard, with every other", async () => {
    const view: ReturnType<typeof render> = render(
      header([PROJECT_A, PROJECT_B]),
    );
    await act(async () => {});

    selectCurrentProject(PROJECT_B);
    view.rerender(header([PROJECT_A, PROJECT_B]));
    await act(async () => {});

    expect(projectsHeard()).toEqual([PROJECT_A, PROJECT_B]);

    await changed("Alert", ModelEventType.Update, PROJECT_A);
    expect(countsOf(Alert)).toBe(2);
  });

  test("a header that has gone hears no project", async () => {
    const view: ReturnType<typeof render> = render(
      header([PROJECT_A, PROJECT_B, PROJECT_C]),
    );
    await act(async () => {});

    expect(active().length).toBeGreaterThan(0);

    view.unmount();

    expect(active()).toHaveLength(0);
  });
});

describe("a change in another project moves the count", () => {
  test("an alert raised in project B, with project A open, reads the alert count again at once", async () => {
    render(header([PROJECT_A, PROJECT_B]));
    await act(async () => {});

    expect(countsOf(Alert)).toBe(1);

    await changed("Alert", ModelEventType.Create, PROJECT_B);

    expect(countsOf(Alert)).toBe(2);
    // Only the count of that kind.
    expect(countsOf(Incident)).toBe(1);
    expect(countsOf(AlertEpisode)).toBe(1);
    expect(countsOf(IncidentEpisode)).toBe(1);
  });

  test.each([
    ["Incident", Incident, ModelEventType.Update],
    ["AlertEpisode", AlertEpisode, ModelEventType.Create],
    ["IncidentEpisode", IncidentEpisode, ModelEventType.Delete],
  ])(
    "%s changing in another project reads its count again",
    async (
      modelName: string,
      modelType: unknown,
      eventType: ModelEventType,
    ) => {
      render(header([PROJECT_A, PROJECT_C]));
      await act(async () => {});

      await changed(modelName, eventType, PROJECT_C);

      expect(countsOf(modelType)).toBe(2);
    },
  );

  test("a bulk action spread over three projects reads the count twice, not once per record or per project", async () => {
    render(header([PROJECT_A, PROJECT_B, PROJECT_C]));
    await act(async () => {});

    expect(countsOf(Alert)).toBe(1);

    for (let index: number = 0; index < 300; index++) {
      await changed(
        "Alert",
        ModelEventType.Update,
        [PROJECT_A, PROJECT_B, PROJECT_C][index % 3]!,
      );
    }

    // The first change at once...
    expect(countsOf(Alert)).toBe(2);

    // ...and every other one in a single read once the interval has passed.
    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS);
    expect(countsOf(Alert)).toBe(3);

    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS * 4);
    expect(countsOf(Alert)).toBe(3);
  });

  test("the projects changing mid-burst do not reset the pace", async () => {
    const view: ReturnType<typeof render> = render(
      header([PROJECT_A, PROJECT_B]),
    );
    await act(async () => {});

    await changed("Alert", ModelEventType.Update, PROJECT_B);
    expect(countsOf(Alert)).toBe(2);

    // A project joined: the subscriptions start over...
    view.rerender(header([PROJECT_A, PROJECT_B, PROJECT_C]));
    await act(async () => {});

    // ...but a change heard right after still waits for the interval.
    await changed("Alert", ModelEventType.Update, PROJECT_C);
    expect(countsOf(Alert)).toBe(2);

    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS);
    expect(countsOf(Alert)).toBe(3);
  });
});

/*
 * The episodes count what the bell's entry opens (Active Alert Episodes,
 * Active Incident Episodes): episodes nobody has acknowledged yet, from
 * every project - as the incidents and alerts counts do. They used to count
 * the open project's unresolved episodes, so the number beside the entry
 * and the page it opened disagreed.
 */
describe("the episode counts are the pages they open", () => {
  test.each([
    ["AlertEpisode", AlertEpisode, "currentAlertState"],
    ["IncidentEpisode", IncidentEpisode, "currentIncidentState"],
  ])(
    "%s: in the state new ones start in, from every project",
    async (_name: string, modelType: unknown, stateRelation: string) => {
      render(header([PROJECT_A, PROJECT_B]));
      await act(async () => {});

      const calls: Array<Array<unknown>> = countMock.mock.calls.filter(
        (call: Array<unknown>) => {
          return (call[0] as { modelType: unknown }).modelType === modelType;
        },
      );

      expect(calls).toHaveLength(1);

      const request: {
        query: JSONObject;
        requestOptions: { isMultiTenantRequest?: boolean };
      } = calls[0]![0] as {
        query: JSONObject;
        requestOptions: { isMultiTenantRequest?: boolean };
      };

      expect(request.query).toEqual({
        [stateRelation]: { isCreatedState: true },
      });
      expect(request.requestOptions.isMultiTenantRequest).toBe(true);
    },
  );

  test("as the incidents and alerts counts are", async () => {
    render(header([PROJECT_A]));
    await act(async () => {});

    const queryOf: (modelType: unknown) => JSONObject = (
      modelType: unknown,
    ): JSONObject => {
      return (
        countMock.mock.calls.find((call: Array<unknown>) => {
          return (call[0] as { modelType: unknown }).modelType === modelType;
        })![0] as { query: JSONObject }
      ).query;
    };

    expect(queryOf(Incident)).toEqual({
      currentIncidentState: { isCreatedState: true },
    });
    expect(queryOf(Alert)).toEqual({
      currentAlertState: { isCreatedState: true },
    });
  });

  test("they are counted without the open project: no project, still counted", async () => {
    selectCurrentProject(null);
    render(header([]));
    await act(async () => {});

    expect(countsOf(AlertEpisode)).toBe(1);
    expect(countsOf(IncidentEpisode)).toBe(1);
  });
});

describe("the projects heard (Utils/LiveProjects)", () => {
  test("the open project first, then the list's, each once and in lower case", () => {
    expect(
      getLiveProjectIds({
        projects: [
          project(PROJECT_B),
          project(PROJECT_A.toUpperCase()),
          project(PROJECT_C),
          project(PROJECT_B),
        ],
        currentProjectId: new ObjectID(PROJECT_C.toUpperCase()),
      }),
    ).toEqual([PROJECT_C, PROJECT_B, PROJECT_A]);
  });

  test("no project and no open project: nothing to hear", () => {
    expect(getLiveProjectIds({ projects: [], currentProjectId: null })).toEqual(
      [],
    );
    expect(
      getLiveProjectIds({
        projects: [new Project()],
        currentProjectId: undefined,
      }),
    ).toEqual([]);
  });

  test(`at most ${MAX_LIVE_PROJECTS} projects, the open one always among them`, () => {
    const many: Array<Project> = Array.from(
      { length: MAX_LIVE_PROJECTS + 10 },
      (_value: unknown, index: number): Project => {
        return project(
          `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
        );
      },
    );

    const open: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const heard: Array<string> = getLiveProjectIds({
      projects: many,
      currentProjectId: new ObjectID(open),
    });

    expect(MAX_LIVE_PROJECTS).toBe(50);
    expect(heard).toHaveLength(MAX_LIVE_PROJECTS);
    expect(heard[0]).toBe(open);
  });

  test("the same projects in any order are the same subscriptions", () => {
    expect(getLiveProjectsKey([PROJECT_B, PROJECT_A])).toBe(
      getLiveProjectsKey([PROJECT_A, PROJECT_B]),
    );
    expect(getLiveProjectsKey([PROJECT_A])).not.toBe(
      getLiveProjectsKey([PROJECT_A, PROJECT_B]),
    );
  });

  test("every kind of change moves a count", () => {
    expect(HEADER_COUNT_EVENT_TYPES).toEqual([
      ModelEventType.Create,
      ModelEventType.Update,
      ModelEventType.Delete,
    ]);
  });
});
