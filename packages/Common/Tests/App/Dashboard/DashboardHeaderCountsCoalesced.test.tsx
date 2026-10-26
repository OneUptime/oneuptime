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
import Incident from "../../../Models/DatabaseModels/Incident";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import DashboardHeader, {
  HEADER_COUNT_REFRESH_INTERVAL_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";

/*
 * THE HEADER'S COUNTS, READ AGAIN AT MOST EVERY FIVE SECONDS WHILE RECORDS
 * KEEP CHANGING (issue #5299).
 *
 * The header reads its counts again whenever the realtime connection says a
 * record of their kind changed. A bulk Resolve of 4,594 alerts sent an event
 * per alert, and every one read the alert count again - thousands of count
 * requests while the action ran, competing with its writes. Now the first
 * change is counted at once and a burst of them once more five seconds
 * later.
 */

const getMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

interface Listener {
  modelName: string;
  eventType: ModelEventType;
  callback: () => void;
  isStopped: boolean;
}

const listeners: Array<Listener> = [];

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
        return { tenantid: "11111111-1111-1111-1111-111111111111" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-1111-1111-111111111111");
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
        },
        callback: () => void,
      ) => {
        const listener: Listener = {
          modelName: new options.modelType().tableName || "",
          eventType: options.eventType,
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
        return new ObjectID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: async () => {
          return [];
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: async () => {
        return [];
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

function header(): ReactElement {
  const project: Project = new Project();
  project.id = new ObjectID("11111111-1111-1111-1111-111111111111");
  project.name = "Example project";

  return (
    <DashboardHeader
      projects={[project]}
      onProjectSelected={() => {}}
      showProjectModal={false}
      onProjectModalClose={() => {}}
      selectedProject={project}
    />
  );
}

// The count requests the header made for a model, so far.
function countsOf(modelType: unknown): number {
  return countMock.mock.calls.filter((call: Array<unknown>) => {
    return (call[0] as { modelType: unknown }).modelType === modelType;
  }).length;
}

// Every live listener for a model and an event, told a record changed.
async function changed(
  modelName: string,
  eventType: ModelEventType,
): Promise<void> {
  await act(async () => {
    for (const listener of listeners) {
      if (
        !listener.isStopped &&
        listener.modelName === modelName &&
        listener.eventType === eventType
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

describe("the header's counts while records keep changing", () => {
  test("waits five seconds between reads", () => {
    expect(HEADER_COUNT_REFRESH_INTERVAL_IN_MS).toBe(5000);
  });

  test("a bulk action's thousand alert updates read the alert count twice, not a thousand times", async () => {
    render(header());
    await act(async () => {});

    // Read once as the header opened.
    expect(countsOf(Alert)).toBe(1);

    // The first change is counted at once.
    await changed("Alert", ModelEventType.Update);
    expect(countsOf(Alert)).toBe(2);

    // A thousand more, within a second.
    for (let i: number = 0; i < 1000; i++) {
      await changed("Alert", ModelEventType.Update);
    }

    expect(countsOf(Alert)).toBe(2);

    // Once the interval has passed: one more read counts them all.
    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS);
    expect(countsOf(Alert)).toBe(3);

    // And nothing after that, with nothing more changing.
    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS * 4);
    expect(countsOf(Alert)).toBe(3);
  });

  test("a single change later on is counted at once again", async () => {
    render(header());
    await act(async () => {});

    await changed("Alert", ModelEventType.Create);
    expect(countsOf(Alert)).toBe(2);

    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS + 1);
    await changed("Alert", ModelEventType.Delete);
    expect(countsOf(Alert)).toBe(3);
  });

  test("each count waits on its own: incidents changing does not hold the alert count back", async () => {
    render(header());
    await act(async () => {});

    expect(countsOf(Incident)).toBe(1);

    await changed("Incident", ModelEventType.Update);
    await changed("Alert", ModelEventType.Update);

    expect(countsOf(Incident)).toBe(2);
    expect(countsOf(Alert)).toBe(2);
  });

  test("a header that has gone reads no count it was waiting to read", async () => {
    const view: ReturnType<typeof render> = render(header());
    await act(async () => {});

    await changed("Alert", ModelEventType.Update);
    await changed("Alert", ModelEventType.Update);
    expect(countsOf(Alert)).toBe(2);

    view.unmount();
    await advance(HEADER_COUNT_REFRESH_INTERVAL_IN_MS * 2);

    expect(countsOf(Alert)).toBe(2);
    expect(
      listeners.every((listener: Listener) => {
        return listener.isStopped;
      }),
    ).toBe(true);
  });
});
