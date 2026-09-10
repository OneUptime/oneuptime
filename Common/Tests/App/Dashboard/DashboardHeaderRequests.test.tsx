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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import DashboardHeader from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";

const getMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const currentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../Utils/API", () => {
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
        return {
          tenantid: currentProjectIdMock()?.toString(),
        };
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
      listenToModelEvent: () => {
        return () => {};
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
        t: (key: string, options?: { count?: number }): string => {
          return options?.count === undefined ? key : `${key}:${options.count}`;
        },
      };
    },
  };
});

/*
 * Keep the real header, notification bell, and error modal. These unrelated
 * controls have their own effects and are covered by the header layout tests.
 */
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

const PROJECT_A: string = "11111111-1111-1111-1111-111111111111";
const PROJECT_B: string = "22222222-2222-2222-2222-222222222222";
const POLICY_A: string = "33333333-3333-3333-3333-333333333333";
const POLICY_B: string = "44444444-4444-4444-4444-444444444444";
const POLICY_C: string = "55555555-5555-5555-5555-555555555555";

interface DeferredResponse {
  promise: Promise<HTTPResponse<JSONObject>>;
  resolve: (response: HTTPResponse<JSONObject>) => void;
  reject: (error: Error) => void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: DeferredResponse["resolve"];
  let reject!: DeferredResponse["reject"];

  const promise: Promise<HTTPResponse<JSONObject>> = new Promise(
    (
      resolvePromise: DeferredResponse["resolve"],
      rejectPromise: DeferredResponse["reject"],
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );

  return { promise, resolve, reject };
}

function responseForPolicies(
  policyIds: Array<string> = [],
): HTTPResponse<JSONObject> {
  const rules: Array<JSONObject> = policyIds.map((id: string) => {
    return {
      onCallDutyPolicy: { _id: id, name: `Policy ${id}` },
    };
  });

  return new HTTPResponse<JSONObject>(
    200,
    {
      escalationRulesByUser: rules,
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    },
    {},
  );
}

function project(id: string): Project {
  const result: Project = new Project();
  result.id = new ObjectID(id);
  result.name = "Example project";
  return result;
}

function header(selectedProject: Project | null): ReactElement {
  return (
    <DashboardHeader
      projects={selectedProject ? [selectedProject] : []}
      onProjectSelected={() => {}}
      showProjectModal={false}
      onProjectModalClose={() => {}}
      selectedProject={selectedProject}
    />
  );
}

function selectCurrentProject(id: string | null): void {
  // The real getter constructs a new ObjectID on every call.
  currentProjectIdMock.mockImplementation(() => {
    return id ? new ObjectID(id) : null;
  });
}

function openNotifications(): void {
  fireEvent.click(screen.getByRole("button", { name: "View notifications" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  selectCurrentProject(PROJECT_A);
  getMock.mockResolvedValue(responseForPolicies());
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

describe("dashboard header on-call requests", () => {
  test("shares the cached-project boot lookup with subsequent project selection", async () => {
    const pending: DeferredResponse = deferredResponse();
    getMock.mockReturnValue(pending.promise);
    const view: ReturnType<typeof render> = render(header(null));

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]?.[0].headers.tenantid).toBe(PROJECT_A);

    view.rerender(header(project(PROJECT_A)));
    view.rerender(header(project(PROJECT_A)));

    expect(getMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(responseForPolicies([POLICY_A]));
    });

    openNotifications();
    expect(screen.getByText("header.onDutyOne:1")).toBeInTheDocument();
  });

  test("does not repeat a completed lookup when the project object is refreshed", async () => {
    getMock.mockResolvedValue(responseForPolicies([POLICY_A]));
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));

    await act(async () => {});

    view.rerender(header(project(PROJECT_A)));
    view.rerender(header(project(PROJECT_A)));
    await act(async () => {});

    expect(getMock).toHaveBeenCalledTimes(1);
    openNotifications();
    expect(screen.getByText("header.onDutyOne:1")).toBeInTheDocument();
  });

  test("skips the request until a project id is available", async () => {
    selectCurrentProject(null);
    const view: ReturnType<typeof render> = render(header(null));
    await act(async () => {});

    expect(getMock).not.toHaveBeenCalled();

    selectCurrentProject(PROJECT_A);
    view.rerender(header(project(PROJECT_A)));
    await act(async () => {});

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]?.[0].headers.tenantid).toBe(PROJECT_A);
  });

  test("fetches a different project and clears the previous notification while loading", async () => {
    getMock.mockResolvedValueOnce(responseForPolicies([POLICY_A]));
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));
    await act(async () => {});
    openNotifications();
    expect(screen.getByText("header.onDutyOne:1")).toBeInTheDocument();

    const pending: DeferredResponse = deferredResponse();
    getMock.mockReturnValueOnce(pending.promise);
    selectCurrentProject(PROJECT_B);
    view.rerender(header(project(PROJECT_B)));

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock.mock.calls[1]?.[0].headers.tenantid).toBe(PROJECT_B);
    expect(screen.queryByText("header.onDutyOne:1")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(responseForPolicies([POLICY_B, POLICY_C]));
    });

    expect(screen.getByText("header.onDutyOther:2")).toBeInTheDocument();
  });

  test("ignores a former project's late success after a newer lookup completes", async () => {
    const oldRequest: DeferredResponse = deferredResponse();
    getMock.mockReturnValueOnce(oldRequest.promise);
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));

    selectCurrentProject(PROJECT_B);
    getMock.mockResolvedValueOnce(responseForPolicies([POLICY_B, POLICY_C]));
    view.rerender(header(project(PROJECT_B)));
    await act(async () => {});

    await act(async () => {
      oldRequest.resolve(responseForPolicies([POLICY_A]));
    });

    openNotifications();
    expect(screen.getByText("header.onDutyOther:2")).toBeInTheDocument();
    expect(screen.queryByText("header.onDutyOne:1")).not.toBeInTheDocument();
  });

  test("ignores a former project's late failure", async () => {
    const oldRequest: DeferredResponse = deferredResponse();
    getMock.mockReturnValueOnce(oldRequest.promise);
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));

    selectCurrentProject(PROJECT_B);
    view.rerender(header(project(PROJECT_B)));
    await act(async () => {
      oldRequest.reject(new Error("Old project failed"));
    });

    expect(
      screen.queryByText("header.onCallPoliciesFetchError"),
    ).not.toBeInTheDocument();
  });

  test("discards an old lookup even when the user returns to the same project", async () => {
    const oldRequest: DeferredResponse = deferredResponse();
    getMock.mockReturnValueOnce(oldRequest.promise);
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));

    selectCurrentProject(PROJECT_B);
    view.rerender(header(project(PROJECT_B)));
    await act(async () => {});

    selectCurrentProject(PROJECT_A);
    getMock.mockResolvedValueOnce(responseForPolicies([POLICY_B, POLICY_C]));
    view.rerender(header(project(PROJECT_A)));
    await act(async () => {});

    await act(async () => {
      oldRequest.resolve(responseForPolicies([POLICY_A]));
    });

    expect(getMock).toHaveBeenCalledTimes(3);
    openNotifications();
    expect(screen.getByText("header.onDutyOther:2")).toBeInTheDocument();
  });

  test("clears project notifications when there is no longer a current project", async () => {
    getMock.mockResolvedValueOnce(responseForPolicies([POLICY_A]));
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));
    await act(async () => {});
    openNotifications();

    selectCurrentProject(null);
    view.rerender(header(null));
    await act(async () => {});

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("header.onDutyOne:1")).not.toBeInTheDocument();
  });

  test.each(["rejection", "http failure"])(
    "still shows errors for the current project's %s",
    async (failure: string) => {
      if (failure === "rejection") {
        getMock.mockRejectedValueOnce(new Error("Request failed"));
      } else {
        getMock.mockResolvedValueOnce(
          new HTTPErrorResponse(500, { message: "Request failed" }, {}),
        );
      }

      render(header(project(PROJECT_A)));
      await act(async () => {});

      expect(
        screen.getByText("header.onCallPoliciesFetchError"),
      ).toBeInTheDocument();
    },
  );

  test("continues to suppress the expected SSO authorization error", async () => {
    getMock.mockResolvedValueOnce(
      new HTTPErrorResponse(401, { message: "SSO Authorization Required" }, {}),
    );
    render(header(project(PROJECT_A)));
    await act(async () => {});

    expect(
      screen.queryByText("header.onCallPoliciesFetchError"),
    ).not.toBeInTheDocument();
  });

  test("starts a fresh lookup after unmounting and remounting the header", async () => {
    const oldRequest: DeferredResponse = deferredResponse();
    getMock.mockReturnValueOnce(oldRequest.promise);
    const view: ReturnType<typeof render> = render(header(project(PROJECT_A)));
    view.unmount();

    getMock.mockResolvedValueOnce(responseForPolicies([POLICY_B, POLICY_C]));
    render(header(project(PROJECT_A)));
    await act(async () => {
      oldRequest.resolve(responseForPolicies([POLICY_A]));
    });

    expect(getMock).toHaveBeenCalledTimes(2);
    openNotifications();
    expect(screen.getByText("header.onDutyOther:2")).toBeInTheDocument();
  });
});
