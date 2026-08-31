import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectOnCallPolicies } from "./useAllProjectOnCallPolicies";
import { fetchCurrentOnDutyEscalationPolicies } from "../api/onCallPolicies";
import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import type {
  CurrentOnDutyEscalationPoliciesResponse,
  ProjectItem,
} from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeProject,
} from "../__tests__/testSupport";

/*
 * This hook decides whether the app tells a responder "you are on call" or
 * "you are not", and it decides it by asking every project the responder
 * belongs to, in parallel, tolerating the ones that do not answer.
 *
 * That tolerance is the whole subject of this file. Dropping the rejected
 * requests and returning what is left is right for ONE project failing - the
 * others still hold real duty and the responder should see it. It is a lie for
 * ALL of them failing, because then the empty list is not an answer, it is the
 * absence of one, and the screen renders it as "Not currently on-call". A
 * lapsed SSO cookie or a train tunnel is enough to produce it, and a responder
 * who reads that sentence and stops watching their phone is the single worst
 * outcome this app has.
 *
 * So the three states asserted below are: on call, genuinely not on call, and
 * could not establish. The last one has to be distinguishable from the middle
 * one from OUTSIDE the hook.
 */

jest.mock("../api/onCallPolicies", () => {
  return {
    fetchCurrentOnDutyEscalationPolicies: jest.fn(),
  };
});

jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: jest.fn(),
    getGlobalSsoToken: jest.fn(),
  };
});

/*
 * The project list arrives from a context, not from a query, so it is faked
 * here rather than wrapped in a provider: what matters to this hook is only
 * the two fields it reads, and being able to set "the list is empty AND still
 * loading" - the state that used to render an empty answer - by hand.
 */
const mockProjectContext: {
  projectList: ProjectItem[];
  isLoadingProjects: boolean;
} = {
  projectList: [],
  isLoadingProjects: false,
};

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return mockProjectContext;
    },
  };
});

const fetchDutyMock: jest.MockedFunction<
  typeof fetchCurrentOnDutyEscalationPolicies
> = fetchCurrentOnDutyEscalationPolicies as jest.MockedFunction<
  typeof fetchCurrentOnDutyEscalationPolicies
>;

const getSsoTokensMock: jest.MockedFunction<typeof getSsoTokens> =
  getSsoTokens as jest.MockedFunction<typeof getSsoTokens>;

const getGlobalSsoTokenMock: jest.MockedFunction<typeof getGlobalSsoToken> =
  getGlobalSsoToken as jest.MockedFunction<typeof getGlobalSsoToken>;

const NO_DUTY: CurrentOnDutyEscalationPoliciesResponse = {
  escalationRulesByUser: [],
  escalationRulesByTeam: [],
  escalationRulesBySchedule: [],
};

function makeDutyResponse(
  policyName: string,
): CurrentOnDutyEscalationPoliciesResponse {
  return {
    escalationRulesByUser: [
      {
        onCallDutyPolicy: { _id: "policy-1", name: policyName },
        onCallDutyPolicyEscalationRule: {
          _id: "rule-1",
          name: "First responder",
        },
      },
    ],
    escalationRulesByTeam: [],
    escalationRulesBySchedule: [],
  } as CurrentOnDutyEscalationPoliciesResponse;
}

const PROJECT_A: ProjectItem = makeProject({
  _id: "project-a",
  name: "Acme Production",
});

const PROJECT_B: ProjectItem = makeProject({
  _id: "project-b",
  name: "Beta Staging",
});

/*
 * jest is configured with clearMocks, which forgets recorded calls but keeps
 * whatever implementation the last test installed - so these are reset rather
 * than cleared, and a test that forgets to arm the fetch fails loudly instead
 * of quietly reusing its neighbour's canned duty.
 */
beforeEach(() => {
  fetchDutyMock.mockReset();
  getSsoTokensMock.mockReset();
  getSsoTokensMock.mockResolvedValue({});
  getGlobalSsoTokenMock.mockReset();
  getGlobalSsoTokenMock.mockResolvedValue(null);
  mockProjectContext.projectList = [PROJECT_A, PROJECT_B];
  mockProjectContext.isLoadingProjects = false;
});

describe("useAllProjectOnCallPolicies when nothing answers", () => {
  test("reports an error instead of an empty duty list", async () => {
    /*
     * Every project rejected, so the hook knows nothing at all. The screen
     * renders isError as "Could not load on-call assignments / Retry" and an
     * empty `projects` as "Not currently on-call" - and only the first of
     * those is true here.
     */
    fetchDutyMock.mockRejectedValue(new Error("Network request failed"));

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });

    expect(result.current.projects).toEqual([]);
    expect(result.current.totalAssignments).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useAllProjectOnCallPolicies when one project of two answers", () => {
  beforeEach(() => {
    fetchDutyMock.mockImplementation(async (projectId: string) => {
      if (projectId === PROJECT_A._id) {
        return makeDutyResponse("Primary escalation");
      }

      throw new Error("Network request failed");
    });
  });

  test("still shows the duty it could read", async () => {
    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0]?.projectName).toBe("Acme Production");
    expect(result.current.totalAssignments).toBe(1);
  });

  test("says the answer is incomplete, and by how much", async () => {
    /*
     * The responder may well hold duty in the project that did not answer.
     * A count of one, presented as the whole picture, is the same false
     * reassurance as an empty list - just quieter.
     */
    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.failedProjectCount).toBe(1);
    expect(result.current.isPartialFailure).toBe(true);
  });
});

describe("useAllProjectOnCallPolicies when every project answers", () => {
  test("no duty anywhere is reported as not on call, not as a failure", async () => {
    fetchDutyMock.mockResolvedValue(NO_DUTY);

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.projects).toEqual([]);
    expect(result.current.failedProjectCount).toBe(0);
    expect(result.current.isPartialFailure).toBe(false);
  });

  test("duty in both projects is reported in full", async () => {
    fetchDutyMock.mockResolvedValue(makeDutyResponse("Primary escalation"));

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.totalAssignments).toBe(2);
    expect(result.current.failedProjectCount).toBe(0);
    expect(result.current.isPartialFailure).toBe(false);
  });
});

describe("useAllProjectOnCallPolicies while the project list is unsettled", () => {
  test("a responder with no projects is not left on a skeleton forever", async () => {
    /*
     * react-query v5's isPending means "there is no data yet", and a query
     * with enabled:false satisfies that for as long as the app is open. A
     * brand new account - or one whose project fetch just failed - has an
     * empty project list, so reporting isPending as loading pinned the
     * on-call screen to its skeleton with nothing to pull and nothing to
     * retry.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = false;

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchDutyMock).not.toHaveBeenCalled();
  });

  test("stays loading while the project list itself is still being fetched", async () => {
    /*
     * The mirror of the case above: no projects yet means no request yet,
     * which without this reads as "finished, and you are not on call" before
     * anyone has been asked anything.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = true;

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
  });
});

describe("useAllProjectOnCallPolicies with a project awaiting SSO", () => {
  test("skips it without calling it a failure", async () => {
    /*
     * A project the responder has not completed SSO for is a KNOWN state with
     * a known fix, offered elsewhere in the app. Folding it into the
     * could-not-establish signal would swap an actionable "sign in" prompt
     * for an error screen whose retry button cannot possibly clear it.
     */
    mockProjectContext.projectList = [
      PROJECT_A,
      makeProject({
        _id: "project-sso",
        name: "Locked Down",
        requireSsoForLogin: true,
      }),
    ];
    fetchDutyMock.mockResolvedValue(NO_DUTY);

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(fetchDutyMock).toHaveBeenCalledTimes(1);
    expect(fetchDutyMock).toHaveBeenCalledWith(PROJECT_A._id);
    expect(result.current.isError).toBe(false);
    expect(result.current.failedProjectCount).toBe(0);
  });

  test("a list of nothing but SSO-pending projects is not an error either", async () => {
    mockProjectContext.projectList = [
      makeProject({
        _id: "project-sso",
        name: "Locked Down",
        requireSsoForLogin: true,
      }),
    ];

    const client: QueryClient = createTestQueryClient();
    const { result } = await renderHook(
      () => {
        return useAllProjectOnCallPolicies();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });

    expect(fetchDutyMock).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(false);
    expect(result.current.failedProjectCount).toBe(0);
  });
});
