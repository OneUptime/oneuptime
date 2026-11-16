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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      // As the real one builds them: no project, and the header that asks across projects.
      getCommonHeaders: (options?: { isMultiTenantRequest?: boolean }) => {
        return options?.isMultiTenantRequest
          ? { "is-multi-tenant-query": "true" }
          : { tenantid: "0d140000-0000-4000-8000-00000000ffff" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import MyOnCallPolicies from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/MyOnCallPolicies";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  groupOnCallPoliciesByProject,
  readOnDutyEscalationRules,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MyOnCallPolicies";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

/*
 * MY ON-CALL POLICIES: TWO REQUESTS, WHATEVER THE NUMBER OF PROJECTS
 * (#8124).
 *
 * The page listed the person's projects, then asked each one in turn
 * which policies they are on duty for there: someone in 100 projects
 * waited for 101 requests, one after another, and a project that failed
 * was dropped without a word - every project failing read as "Not
 * Currently On-Call". Now it asks two things side by side: the projects
 * (for their names) and what the person is on duty for in all of them, in
 * one answer across projects (the is-multi-tenant-query header). Each rule
 * names its project, and goes under it.
 */

const PROJECT_COUNT: number = 100;

function projectId(index: number): string {
  return `0d140000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function projectsList(count: number): Array<Project> {
  const projects: Array<Project> = [];

  for (let index: number = 1; index <= count; index++) {
    const project: Project = new Project();
    project._id = projectId(index);
    project.name = `Project ${index}`;
    projects.push(project);
  }

  return projects;
}

function ruleIn(data: {
  projectIndex: number;
  policyName: string;
  ruleName: string;
  extra?: JSONObject;
}): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    projectId: { _type: "ObjectID", value: projectId(data.projectIndex) },
    onCallDutyPolicy: {
      _id: ObjectID.generate().toString(),
      name: data.policyName,
    },
    onCallDutyPolicyEscalationRule: {
      _id: ObjectID.generate().toString(),
      name: data.ruleName,
    },
    ...(data.extra || {}),
  };
}

function onDutyAnswer(data: {
  byUser?: Array<JSONObject>;
  byTeam?: Array<JSONObject>;
  bySchedule?: Array<JSONObject>;
}): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      escalationRulesByUser: data.byUser || [],
      escalationRulesByTeam: data.byTeam || [],
      escalationRulesBySchedule: data.bySchedule || [],
    },
    {},
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;

  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });

  return { promise, resolve };
}

const pageProps: PageComponentProps = {
  pageRoute: new Route("/dashboard/my-on-call-policies"),
  currentProject: null,
  hasPaymentMethod: false,
};

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <MyOnCallPolicies {...pageProps} />
      </MemoryRouter>,
    );
  });
}

// What the page asked the server, request by request.
function requestsMade(): number {
  return getListMock.mock.calls.length + apiGetMock.mock.calls.length;
}

beforeEach(() => {
  standInForGlobalConfig();
  jest.clearAllMocks();

  getListMock.mockResolvedValue({
    data: projectsList(PROJECT_COUNT),
    count: PROJECT_COUNT,
    skip: 0,
    limit: 100,
  });
  apiGetMock.mockResolvedValue(onDutyAnswer({}));
});

afterEach(() => {
  cleanup();
});

describe("My On-Call Policies asks once, for every project", () => {
  test("a person in 100 projects: two requests in all, where there were 101", async () => {
    await renderPage();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(requestsMade()).toBe(2);
  });

  test("the on-duty request asks across projects, naming none", async () => {
    await renderPage();

    const request: {
      url: { toString: () => string };
      headers: Record<string, string>;
    } = apiGetMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      headers: Record<string, string>;
    };

    expect(request.url.toString()).toContain(
      "/on-call-duty-policy/current-on-duty-escalation-policies",
    );
    expect(request.headers["is-multi-tenant-query"]).toBe("true");
    expect(request.headers["tenantid"]).toBeUndefined();
  });

  test("the two requests go side by side: the on-duty one does not wait for the projects", async () => {
    const projects: Deferred<unknown> = deferred<unknown>();
    getListMock.mockReturnValue(projects.promise);

    await renderPage();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      projects.resolve({
        data: projectsList(2),
        count: 2,
        skip: 0,
        limit: 100,
      });
    });

    expect(requestsMade()).toBe(2);
  });

  test("each rule is shown under the project it names, and a project with none is not shown", async () => {
    apiGetMock.mockResolvedValue(
      onDutyAnswer({
        byUser: [
          ruleIn({
            projectIndex: 3,
            policyName: "Payments on-call",
            ruleName: "First line",
          }),
        ],
        byTeam: [
          ruleIn({
            projectIndex: 7,
            policyName: "Search on-call",
            ruleName: "Database team",
            extra: {
              team: { _id: ObjectID.generate().toString(), name: "DBA" },
            },
          }),
        ],
        bySchedule: [
          ruleIn({
            projectIndex: 3,
            policyName: "Payments weekend",
            ruleName: "Weekend rota",
            extra: {
              onCallDutyPolicySchedule: {
                _id: ObjectID.generate().toString(),
                name: "Weekend",
              },
            },
          }),
        ],
      }),
    );

    await renderPage();

    expect(screen.getByText("Payments on-call")).toBeInTheDocument();
    expect(screen.getByText("Payments weekend")).toBeInTheDocument();
    expect(screen.getByText("Search on-call")).toBeInTheDocument();
    expect(screen.getByText("Via team: DBA")).toBeInTheDocument();
    expect(screen.getByText("Via schedule: Weekend")).toBeInTheDocument();
    expect(screen.getByText("Project 3")).toBeInTheDocument();
    expect(screen.getByText("Project 7")).toBeInTheDocument();
    expect(screen.queryByText("Project 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Not Currently On-Call")).not.toBeInTheDocument();
  });

  test("on duty nowhere: says so", async () => {
    await renderPage();

    expect(screen.getByText("Not Currently On-Call")).toBeInTheDocument();
  });

  test("an answer that failed is said as a failure, never as not on call, and Try again asks again", async () => {
    apiGetMock.mockResolvedValueOnce(
      new HTTPErrorResponse(
        500,
        { message: "The database did not answer in time." },
        {},
      ),
    );

    await renderPage();

    expect(screen.queryByText("Not Currently On-Call")).not.toBeInTheDocument();
    expect(
      screen.getByText("The database did not answer in time.", {
        exact: false,
      }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Not Currently On-Call")).toBeInTheDocument();
  });

  test("Refresh asks the two again, and only the two", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });

    expect(requestsMade()).toBe(4);
  });
});

describe("groupOnCallPoliciesByProject", () => {
  test("in the projects' own order; a rule of a project not in the list goes nowhere", () => {
    const grouped: ReturnType<typeof groupOnCallPoliciesByProject> =
      groupOnCallPoliciesByProject({
        projects: projectsList(3),
        rules: readOnDutyEscalationRules({
          escalationRulesByUser: [
            ruleIn({ projectIndex: 3, policyName: "C", ruleName: "c" }),
            ruleIn({ projectIndex: 9, policyName: "Z", ruleName: "z" }),
          ],
          escalationRulesByTeam: [],
          escalationRulesBySchedule: [
            ruleIn({ projectIndex: 1, policyName: "A", ruleName: "a" }),
          ],
        }),
      });

    expect(
      grouped.map((projectData: (typeof grouped)[number]): string => {
        return projectData.project.name || "";
      }),
    ).toEqual(["Project 1", "Project 3"]);
    expect(grouped[1]!.escalationRulesByUser).toHaveLength(1);
    expect(grouped[0]!.escalationRulesBySchedule).toHaveLength(1);
  });

  test("an answer with no lists reads as no rules", () => {
    expect(readOnDutyEscalationRules({})).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
    expect(readOnDutyEscalationRules(null)).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
  });

  test("a project listed twice is shown once", () => {
    const projects: Array<Project> = [...projectsList(1), ...projectsList(1)];

    expect(
      groupOnCallPoliciesByProject({
        projects,
        rules: readOnDutyEscalationRules({
          escalationRulesByUser: [
            ruleIn({ projectIndex: 1, policyName: "A", ruleName: "a" }),
          ],
        }),
      }),
    ).toHaveLength(1);
  });
});
