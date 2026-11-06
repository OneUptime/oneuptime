import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest as jestGlobal,
  test,
} from "@jest/globals";
import { useCoverPolicies, type CoverPoliciesState } from "./useCoverPolicies";
import * as overridesApi from "../api/onCallOverrides";
import type { CoverPolicy, OverrideAddAccess } from "../api/onCallOverrides";

/*
 * For someone whose permission to add user overrides covers only some
 * policies, the cover sheet offers the policies the server says they may
 * cover. The hook asks about the shift's policies when "Get cover" opened
 * the sheet, and about the project's otherwise; it never offers a policy
 * the answer does not name, and a server too old to answer (404) leaves the
 * sheet locked, as before.
 */

jest.mock("../api/onCallOverrides", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/onCallOverrides",
  ) as Record<string, unknown>;

  return {
    ...actual,
    fetchCoverPolicies: jest.fn(),
    fetchOverrideAddAccess: jest.fn(),
  };
});

const PAYMENTS: CoverPolicy = {
  policyId: "policy-payments",
  policyName: "Payments",
};
const CHECKOUT: CoverPolicy = {
  policyId: "policy-checkout",
  policyName: "Checkout",
};
const PLATFORM: CoverPolicy = {
  policyId: "policy-platform",
  policyName: "Platform",
};

function listSpy(): jest.Mock {
  return overridesApi.fetchCoverPolicies as unknown as jest.Mock;
}

function accessSpy(): jest.Mock {
  return overridesApi.fetchOverrideAddAccess as unknown as jest.Mock;
}

async function renderCoverPolicies(data: {
  projectId: string | null;
  enabled: boolean;
  shiftPolicies?: CoverPolicy[];
}): Promise<{ result: { current: CoverPoliciesState } }> {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return await renderHook(
    () => {
      return useCoverPolicies(data);
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => {
        return (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
      },
    },
  );
}

function answering(mayCover: string[]): void {
  accessSpy().mockImplementation(
    async (
      _projectId: string,
      ids: string[],
    ): Promise<OverrideAddAccess | null> => {
      return {
        global: false,
        onCallDutyPolicyIds: ids.filter((id: string): boolean => {
          return mayCover.includes(id);
        }),
      };
    },
  );
}

beforeEach(() => {
  listSpy().mockReset();
  accessSpy().mockReset();
  listSpy().mockResolvedValue([PAYMENTS, CHECKOUT, PLATFORM] as never);
});

afterEach(() => {
  cleanup();
  jestGlobal.restoreAllMocks();
});

describe("useCoverPolicies", () => {
  test("asks nothing while it is not enabled", async () => {
    const { result } = await renderCoverPolicies({
      projectId: "project-1",
      enabled: false,
    });

    expect(result.current).toEqual({ status: "not-asked" });
    expect(listSpy()).not.toHaveBeenCalled();
    expect(accessSpy()).not.toHaveBeenCalled();
  });

  test("checks, then offers the project's policies the server lets them cover, in the project's order", async () => {
    let answer: (access: OverrideAddAccess) => void = (): void => {};

    // Held until the hook has been seen checking.
    accessSpy().mockImplementation((): Promise<OverrideAddAccess | null> => {
      return new Promise<OverrideAddAccess | null>(
        (resolve: (access: OverrideAddAccess | null) => void) => {
          answer = resolve;
        },
      );
    });

    const { result } = await renderCoverPolicies({
      projectId: "project-1",
      enabled: true,
    });

    expect(result.current).toEqual({ status: "checking" });

    await waitFor(() => {
      expect(accessSpy()).toHaveBeenCalled();
    });

    answer({
      global: false,
      onCallDutyPolicyIds: [PLATFORM.policyId, PAYMENTS.policyId],
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        status: "offered",
        policies: [PAYMENTS, PLATFORM],
      });
    });

    expect(listSpy()).toHaveBeenCalledWith("project-1");
    expect(accessSpy()).toHaveBeenCalledWith("project-1", [
      PAYMENTS.policyId,
      CHECKOUT.policyId,
      PLATFORM.policyId,
    ]);
  });

  test("from Get cover, asks about the shift's own policies, each once, and lists none of the project's", async () => {
    answering([CHECKOUT.policyId]);

    const { result } = await renderCoverPolicies({
      projectId: "project-2",
      enabled: true,
      shiftPolicies: [PAYMENTS, CHECKOUT, PAYMENTS],
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        status: "offered",
        policies: [CHECKOUT],
      });
    });

    expect(listSpy()).not.toHaveBeenCalled();
    expect(accessSpy()).toHaveBeenCalledWith("project-2", [
      PAYMENTS.policyId,
      CHECKOUT.policyId,
    ]);
  });

  test("a shift no policy pages through offers nothing, and asks the server nothing", async () => {
    const { result } = await renderCoverPolicies({
      projectId: "project-2",
      enabled: true,
      shiftPolicies: [],
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: "offered", policies: [] });
    });

    expect(accessSpy()).not.toHaveBeenCalled();
  });

  test("an answer that names no policy offers none", async () => {
    answering([]);

    const { result } = await renderCoverPolicies({
      projectId: "project-1",
      enabled: true,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: "offered", policies: [] });
    });
  });

  test("a server older than the question (404) is unavailable: the sheet keeps its lock", async () => {
    accessSpy().mockResolvedValue(null as never);

    const { result } = await renderCoverPolicies({
      projectId: "project-1",
      enabled: true,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: "unavailable" });
    });
  });

  test("a failed answer is unavailable too: nothing is offered on a guess", async () => {
    accessSpy().mockRejectedValue(new Error("Network Error") as never);

    const { result } = await renderCoverPolicies({
      projectId: "project-1",
      enabled: true,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: "unavailable" });
    });
  });

  test("no project: nothing to ask", async () => {
    const { result } = await renderCoverPolicies({
      projectId: null,
      enabled: true,
    });

    expect(result.current).toEqual({ status: "not-asked" });
    expect(listSpy()).not.toHaveBeenCalled();
  });
});
