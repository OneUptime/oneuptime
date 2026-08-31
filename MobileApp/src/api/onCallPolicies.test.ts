import apiClient from "./client";
import { fetchCurrentOnDutyEscalationPolicies } from "./onCallPolicies";
import type {
  CurrentOnDutyEscalationPoliciesResponse,
  OnCallDutyEscalationRuleScheduleItem,
  OnCallDutyEscalationRuleTeamItem,
  OnCallDutyEscalationRuleUserItem,
} from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * "Am I on call right now, in THIS project."
 *
 * Two things can go wrong here and neither is a type error.
 *
 * The first is the tenant. Unlike the project list, this is a per-project
 * question: the on-call screen asks it once for each project the responder
 * belongs to and files every answer under the project it asked about. A
 * request that forgot its tenantid - or that copied the project list's
 * `is-multi-tenant-query` header - would come back with rotations from
 * several projects at once and the screen would print them all under
 * whichever project's turn it was, telling a responder they are on call for
 * a service they have never touched.
 *
 * The second is the shape of the answer. The caller maps over all three
 * escalation arrays unconditionally, so a body that omits one - an older
 * server, a project with no schedules, an error page that happens to be JSON,
 * a 204 with nothing in it - has to arrive here as an empty array. Reaching
 * the screen as undefined is a crash on the on-call tab, which is the one
 * screen a responder opens to check whether they can stop watching their
 * phone.
 */

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
    },
  };
});

function getSpy(): jest.SpyInstance {
  return apiClient.get as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = getSpy().mock.calls;

  return calls[calls.length - 1]!;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

/**
 * The headers of the most recent call, read out of the config argument - which
 * for a GET is the SECOND argument, where a POST would put its body. A wrapper
 * that passed its config third would send no headers at all, and this reader
 * would come back empty rather than quietly finding them anyway.
 */
function headersOf(call: Array<unknown>): Record<string, string> {
  const config: { headers?: Record<string, string> } = call[1] as {
    headers?: Record<string, string>;
  };

  return config?.headers ?? {};
}

function lastHeaders(): Record<string, string> {
  return headersOf(lastCall());
}

function respondWith(data: unknown): void {
  getSpy().mockResolvedValue({ data } as never);
}

function makeUserRule(policyName: string): OnCallDutyEscalationRuleUserItem {
  return {
    onCallDutyPolicy: { _id: "policy-1", name: policyName },
    onCallDutyPolicyEscalationRule: { _id: "rule-1", name: "First responder" },
  };
}

function makeTeamRule(teamName: string): OnCallDutyEscalationRuleTeamItem {
  return {
    onCallDutyPolicy: { _id: "policy-2", name: "Database escalation" },
    onCallDutyPolicyEscalationRule: { _id: "rule-2", name: "Second line" },
    team: { _id: "team-1", name: teamName },
  };
}

function makeScheduleRule(
  scheduleName: string,
): OnCallDutyEscalationRuleScheduleItem {
  return {
    onCallDutyPolicy: { _id: "policy-3", name: "Weekend rotation" },
    onCallDutyPolicyEscalationRule: { _id: "rule-3", name: "Primary" },
    onCallDutyPolicySchedule: { _id: "schedule-1", name: scheduleName },
  };
}

describe("fetchCurrentOnDutyEscalationPolicies asks one project at a time", () => {
  beforeEach(() => {
    respondWith({});
  });

  test("reads the current-on-duty endpoint", async () => {
    await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(lastUrl()).toBe(
      "/api/on-call-duty-policy/current-on-duty-escalation-policies",
    );
  });

  test("names the project in a tenantid header", async () => {
    await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("does not ask across tenants, which would mix other projects in", async () => {
    /*
     * The multi-tenant header belongs to the project list request and nowhere
     * near this one: an answer spanning every project would be attributed to
     * the single project whose turn it was.
     */
    await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(lastHeaders()["is-multi-tenant-query"]).toBeUndefined();
  });

  test("gives each project its own tenantid as the screen walks the list", async () => {
    /*
     * The on-call screen fires one of these per project, concurrently. If the
     * header were ever hoisted into shared config - the sort of thing done to
     * "avoid rebuilding the object every call" - every request after the first
     * would carry the first project's tenant and the whole screen would report
     * one project's rotation several times over.
     */
    await fetchCurrentOnDutyEscalationPolicies("project-a");
    await fetchCurrentOnDutyEscalationPolicies("project-b");

    const tenants: Array<string> = getSpy().mock.calls.map(
      (call: Array<unknown>) => {
        return headersOf(call)["tenantid"] ?? "";
      },
    );

    expect(tenants).toEqual(["project-a", "project-b"]);
  });
});

describe("fetchCurrentOnDutyEscalationPolicies always returns three lists", () => {
  beforeEach(() => {
    respondWith({});
  });

  test("returns the user, team and schedule rules the server sent", async () => {
    respondWith({
      escalationRulesByUser: [makeUserRule("Payments paging")],
      escalationRulesByTeam: [makeTeamRule("Platform")],
      escalationRulesBySchedule: [makeScheduleRule("Weeknights")],
    });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser[0]?.onCallDutyPolicy?.name).toBe(
      "Payments paging",
    );
    expect(response.escalationRulesByTeam[0]?.team?.name).toBe("Platform");
    expect(
      response.escalationRulesBySchedule[0]?.onCallDutyPolicySchedule?.name,
    ).toBe("Weeknights");
  });

  test("keeps every rule in a list rather than only the first", async () => {
    /*
     * Being on call through two policies at once is ordinary - one for the
     * service, one for the weekend rota - and each is a separate row the
     * responder needs to see.
     */
    respondWith({
      escalationRulesByUser: [
        makeUserRule("Payments paging"),
        makeUserRule("Checkout paging"),
      ],
    });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(
      response.escalationRulesByUser.map(
        (rule: OnCallDutyEscalationRuleUserItem) => {
          return rule.onCallDutyPolicy?.name;
        },
      ),
    ).toEqual(["Payments paging", "Checkout paging"]);
  });

  test("fills in the lists the server left out", async () => {
    /*
     * The common real case: a responder is on call as an individual in a
     * project that has no teams and no schedules, and the server answers with
     * the one key it has something to say about.
     */
    respondWith({ escalationRulesByUser: [makeUserRule("Payments paging")] });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toHaveLength(1);
    expect(response.escalationRulesByTeam).toEqual([]);
    expect(response.escalationRulesBySchedule).toEqual([]);
  });

  test("turns a null list into an empty one", async () => {
    /*
     * A serialiser that writes nulls for empty collections is as likely as one
     * that omits the key, and null survives a `?.` untouched - only the `??`
     * catches it.
     */
    respondWith({
      escalationRulesByUser: null,
      escalationRulesByTeam: null,
      escalationRulesBySchedule: null,
    });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toEqual([]);
    expect(response.escalationRulesByTeam).toEqual([]);
    expect(response.escalationRulesBySchedule).toEqual([]);
  });

  test("an empty body means the responder is on call for nothing here", async () => {
    respondWith({});

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toEqual([]);
    expect(response.escalationRulesByTeam).toEqual([]);
    expect(response.escalationRulesBySchedule).toEqual([]);
  });

  test("a null body is read the same way, not as a crash", async () => {
    /*
     * What axios hands back for a 204 or an empty response body. The screen
     * that asked has no way to tell this apart from "nothing scheduled", and
     * it should not have to.
     */
    respondWith(null);

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toEqual([]);
    expect(response.escalationRulesByTeam).toEqual([]);
    expect(response.escalationRulesBySchedule).toEqual([]);
  });

  test("a body that never arrived is read the same way", async () => {
    respondWith(undefined);

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toEqual([]);
    expect(response.escalationRulesByTeam).toEqual([]);
    expect(response.escalationRulesBySchedule).toEqual([]);
  });

  test("an empty list stays empty rather than being confused for a missing one", async () => {
    respondWith({
      escalationRulesByUser: [],
      escalationRulesByTeam: [makeTeamRule("Platform")],
      escalationRulesBySchedule: [],
    });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(response.escalationRulesByUser).toEqual([]);
    expect(response.escalationRulesByTeam).toHaveLength(1);
  });

  test("ignores anything else the body carries", async () => {
    /*
     * The response is reduced to exactly the three lists, so an extra key -
     * a paging envelope, a deprecation notice - cannot reach the screen as a
     * fourth thing to render.
     */
    respondWith({
      escalationRulesByUser: [makeUserRule("Payments paging")],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
      count: 1,
    });

    const response: CurrentOnDutyEscalationPoliciesResponse =
      await fetchCurrentOnDutyEscalationPolicies("project-1");

    expect(Object.keys(response).sort()).toEqual([
      "escalationRulesBySchedule",
      "escalationRulesByTeam",
      "escalationRulesByUser",
    ]);
  });
});
