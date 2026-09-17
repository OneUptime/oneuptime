import { BASE_URL } from "../../../Config";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import { APIResponse, Cookie, Page, expect } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { ApiResult, sendWithRetry } from "./ApiRequest";

/*
 * Helpers for the monitor -> incident -> on-call -> user-alerted e2e spec
 * (MonitorIncidentOnCall.spec.ts).
 *
 * Everything here talks to the same REST API the dashboard uses, through
 * `page.request`, so the calls carry the browser session cookies created by
 * registerAndCreateProject(). That keeps the spec on the real
 * dashboard -> api -> probe -> incident -> on-call path instead of reaching
 * into the database.
 *
 * The helpers never sleep for a fixed duration: every wait is a poll with a
 * deadline, so a fast machine finishes in seconds and a loaded CI runner still
 * passes.
 */

// Generic JSON shapes returned by the CRUD API.
export type JSONish = Record<string, any>;

export interface ProjectDefaults {
  operationalMonitorStatusId: string;
  offlineMonitorStatusId: string;
  incidentSeverityId: string;
  resolvedIncidentStateId: string;
}

export interface SessionUser {
  userId: string;
  email: string;
}

/*
 * The session cookie the API accepts is a short-lived (15 minute) JWT with a
 * long-lived refresh-token cookie beside it. This flow polls for minutes
 * without the SPA in the loop to refresh it, so every request goes through
 * requestJson(), which transparently refreshes and retries once on 401.
 */
const REFRESH_TOKEN_PATH: string = "/api/identity/refresh-token";

type BuildUrlFunction = (path: string) => string;

export const buildUrl: BuildUrlFunction = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

type RefreshSessionFunction = (data: { page: Page }) => Promise<void>;

const refreshSession: RefreshSessionFunction = async (data: {
  page: Page;
}): Promise<void> => {
  await data.page.request.post(buildUrl(REFRESH_TOKEN_PATH), {
    headers: { "content-type": "application/json" },
    data: {},
  });
};

type RequestJsonFunction = (data: {
  page: Page;
  projectId: string;
  path: string;
  body: JSONish;
  method?: "post" | "put" | undefined;
}) => Promise<JSONish>;

/*
 * POST/PUT a JSON body to the OneUptime API and return the parsed response.
 * Throws with the server's message so a failure points at the real cause
 * instead of a generic assertion error.
 */
export const requestJson: RequestJsonFunction = async (data: {
  page: Page;
  projectId: string;
  path: string;
  body: JSONish;
  method?: "post" | "put" | undefined;
}): Promise<JSONish> => {
  const method: "post" | "put" = data.method || "post";

  type SendFunction = () => Promise<APIResponse>;

  const send: SendFunction = async (): Promise<APIResponse> => {
    return data.page.request[method](buildUrl(data.path), {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
        projectid: data.projectId,
      },
      data: data.body,
    });
  };

  let result: ApiResult = await sendWithRetry({ send });

  if (result.status === 401) {
    await refreshSession({ page: data.page });
    result = await sendWithRetry({ send });
  }

  expect(
    result.ok,
    `${method.toUpperCase()} ${data.path} failed: ${result.status} ${result.text}`,
  ).toBe(true);

  return result.text ? (JSON.parse(result.text) as JSONish) : {};
};

type CreateItemFunction = (data: {
  page: Page;
  projectId: string;
  path: string;
  item: JSONish;
}) => Promise<JSONish>;

// Creates a record through the CRUD API and returns the created row.
export const createItem: CreateItemFunction = async (data: {
  page: Page;
  projectId: string;
  path: string;
  item: JSONish;
}): Promise<JSONish> => {
  const response: JSONish = await requestJson({
    page: data.page,
    projectId: data.projectId,
    path: data.path,
    body: { data: data.item },
  });

  // The CRUD API returns the model either bare or wrapped in `data`.
  return (response["data"] as JSONish) || response;
};

type DeleteItemFunction = (data: {
  page: Page;
  projectId: string;
  path: string;
  id: string;
}) => Promise<void>;

// Deletes a record through the CRUD API (DELETE {path}/{id}).
export const deleteItem: DeleteItemFunction = async (data: {
  page: Page;
  projectId: string;
  path: string;
  id: string;
}): Promise<void> => {
  const url: string = buildUrl(`${data.path}/${data.id}`);

  type SendFunction = () => Promise<APIResponse>;

  const send: SendFunction = async (): Promise<APIResponse> => {
    return data.page.request.delete(url, {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
        projectid: data.projectId,
      },
    });
  };

  let result: ApiResult = await sendWithRetry({ send });

  if (result.status === 401) {
    await refreshSession({ page: data.page });
    result = await sendWithRetry({ send });
  }

  expect(
    result.ok,
    `DELETE ${data.path}/${data.id} failed: ${result.status} ${result.text}`,
  ).toBe(true);
};

type ListItemsFunction = (data: {
  page: Page;
  projectId: string;
  path: string;
  query?: JSONish | undefined;
  select: JSONish;
  limit?: number | undefined;
}) => Promise<Array<JSONish>>;

// Lists records through the CRUD API.
export const listItems: ListItemsFunction = async (data: {
  page: Page;
  projectId: string;
  path: string;
  query?: JSONish | undefined;
  select: JSONish;
  limit?: number | undefined;
}): Promise<Array<JSONish>> => {
  const response: JSONish = await requestJson({
    page: data.page,
    projectId: data.projectId,
    path: `${data.path}/get-list`,
    body: {
      query: data.query || {},
      select: data.select,
      limit: data.limit || 50,
      skip: 0,
    },
  });

  return (response["data"] as Array<JSONish>) || [];
};

type GetItemFunction = (data: {
  page: Page;
  projectId: string;
  path: string;
  id: string;
  select: JSONish;
}) => Promise<JSONish>;

// Reads a single record, which is the only way to select relations.
export const getItem: GetItemFunction = async (data: {
  page: Page;
  projectId: string;
  path: string;
  id: string;
  select: JSONish;
}): Promise<JSONish> => {
  const response: JSONish = await requestJson({
    page: data.page,
    projectId: data.projectId,
    path: `${data.path}/${data.id}/get-item`,
    body: { select: data.select },
  });

  return (response["data"] as JSONish) || response;
};

/*
 * Ids come back from the API either as a bare string or as
 * { _type: "ObjectID", value: "..." } depending on the column. Normalise both.
 */
type ToIdFunction = (value: unknown) => string;

export const toId: ToIdFunction = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return String((value as JSONish)["value"] || "");
};

export interface PollOptions<T> {
  page: Page;
  description: string;
  timeoutMs: number;
  check: () => Promise<T | null>;
  intervalMs?: number | undefined;
}

/*
 * Polls `check` until it returns a non-null value or the deadline passes.
 *
 * Transient errors are swallowed and retried: right after a project is created
 * some reads can briefly fail while permissions propagate, and a poll that
 * gives up on the first hiccup is exactly the kind of flake this spec must not
 * have. The last error is reported if the deadline is hit.
 */
export async function pollUntil<T>(options: PollOptions<T>): Promise<T> {
  const intervalMs: number = options.intervalMs || 2000;
  const deadline: number = Date.now() + options.timeoutMs;
  let lastError: string = "";

  while (Date.now() < deadline) {
    try {
      const result: T | null = await options.check();

      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (error) {
      lastError = (error as Error).message;
    }

    await options.page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `Timed out after ${options.timeoutMs}ms waiting for: ${options.description}.` +
      (lastError ? ` Last error: ${lastError}` : ""),
  );
}

type GetSessionUserFunction = (data: { page: Page }) => Promise<SessionUser>;

/*
 * Reads the signed-in user out of the session cookies that the register flow
 * set. Avoids changing registerAndCreateProject's return type, which other
 * specs depend on.
 */
export const getSessionUser: GetSessionUserFunction = async (data: {
  page: Page;
}): Promise<SessionUser> => {
  const cookies: Array<Cookie> = await data.page.context().cookies();

  type FindCookieFunction = (name: string) => string;

  const findCookie: FindCookieFunction = (name: string): string => {
    const cookie: Cookie | undefined = cookies.find((c: Cookie) => {
      return c.name === name;
    });
    return cookie ? decodeURIComponent(cookie.value) : "";
  };

  const userId: string = findCookie("user-id");
  const email: string = findCookie("user-email");

  expect(userId, "user-id cookie should exist after registration").not.toBe("");
  expect(email, "user-email cookie should exist after registration").not.toBe(
    "",
  );

  return { userId, email };
};

type AssertTargetRefusedUnderEveryProbePolicyFunction = (
  url: string,
) => Promise<string>;

/*
 * Assert that a probe is refused this target under EVERY probe policy, and
 * return the refusal in the guard's own words.
 *
 * Reachability and permission are different questions. A probe applies
 * DataSourceEgressGuard to the RESOLVED address before it opens a socket, and
 * the always-blocked tier (loopback, link-local, reserved, multicast) is
 * refused whatever blockPrivateAddresses is set to - so this checks both
 * values and requires both to throw. That tier-independence is the property
 * worth pinning: a target refused only under the strict policy would quietly
 * start being reachable on a deployment that opted into private networks.
 *
 * The REAL guard is called rather than a copy of its rules, so this answer
 * cannot drift from the one the probe will give. It is a pure function and
 * needs no stack.
 */
export const assertTargetRefusedUnderEveryProbePolicy: AssertTargetRefusedUnderEveryProbePolicyFunction =
  async (url: string): Promise<string> => {
    const messages: Array<string> = [];

    for (const blockPrivateAddresses of [true, false]) {
      let refusal: string | null = null;

      try {
        await DataSourceEgressGuard.assertUrlAllowed(url, {
          blockPrivateAddresses: blockPrivateAddresses,
          targetLabel: "Monitor target",
          includeResolvedAddressInError: false,
        });
      } catch (error) {
        refusal = (error as Error).message;
      }

      expect(
        refusal,
        `${url} must be refused with blockPrivateAddresses=${blockPrivateAddresses}. ` +
          `A target that is only refused under the strict policy is not in the ` +
          `always-blocked tier, and this assertion would stop meaning anything on a ` +
          `deployment that allows private networks.`,
      ).not.toBeNull();

      messages.push(refusal as string);
    }

    expect(
      messages[0],
      "The refusal must not depend on the private-network policy.",
    ).toBe(messages[1]);

    return messages[0] as string;
  };

type AssertMonitorHasProbesFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
  timeoutMs: number;
}) => Promise<void>;

/*
 * Nothing in this flow can happen without a probe assigned to the monitor.
 * Probe containers register at boot and retry for a few minutes, and the
 * stack's readiness check doesn't wait for them — so assert the assignment
 * exists rather than letting a missing probe surface as an unexplained
 * monitor-status timeout minutes later.
 *
 * This checks MonitorProbe rather than the probe list: the probes shipped with
 * a deployment are global, so they have no projectId and a tenant-scoped
 * /api/probe query never returns them. MonitorProbe rows are project-scoped
 * and are what the probe actually claims work from, so they are both visible
 * here and the thing that matters.
 */
export const assertMonitorHasProbes: AssertMonitorHasProbesFunction =
  async (data: {
    page: Page;
    projectId: string;
    monitorId: string;
    timeoutMs: number;
  }): Promise<void> => {
    await pollUntil<boolean>({
      page: data.page,
      description: `monitor ${data.monitorId} to have an enabled probe assigned to it`,
      timeoutMs: data.timeoutMs,
      check: async (): Promise<boolean | null> => {
        const monitorProbes: Array<JSONish> = await listItems({
          page: data.page,
          projectId: data.projectId,
          path: "/api/monitor-probe",
          query: { monitorId: data.monitorId },
          select: { _id: true, isEnabled: true, probeId: true },
        });

        const enabled: boolean = monitorProbes.some((monitorProbe: JSONish) => {
          return monitorProbe["isEnabled"] === true;
        });

        return enabled ? true : null;
      },
    });
  };

type GetProjectDefaultsFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<ProjectDefaults>;

/*
 * Every new project is seeded with the default monitor statuses
 * (Operational / Degraded / Offline), incident severities and incident states.
 * Seeding happens after the create response returns, so poll. Look the rows up
 * by their semantic flags rather than by name, so a rename in the seed data
 * doesn't silently break the spec.
 */
export const getProjectDefaults: GetProjectDefaultsFunction = async (data: {
  page: Page;
  projectId: string;
}): Promise<ProjectDefaults> => {
  const statuses: Array<JSONish> = await pollUntil<Array<JSONish>>({
    page: data.page,
    description: "default monitor statuses to be seeded",
    timeoutMs: 120000,
    check: async (): Promise<Array<JSONish> | null> => {
      const rows: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/monitor-status",
        select: {
          _id: true,
          name: true,
          isOperationalState: true,
          isOfflineState: true,
        },
      });

      const hasBoth: boolean =
        rows.some((row: JSONish) => {
          return row["isOperationalState"] === true;
        }) &&
        rows.some((row: JSONish) => {
          return row["isOfflineState"] === true;
        });

      return hasBoth ? rows : null;
    },
  });

  const severities: Array<JSONish> = await pollUntil<Array<JSONish>>({
    page: data.page,
    description: "default incident severities to be seeded",
    timeoutMs: 120000,
    check: async (): Promise<Array<JSONish> | null> => {
      const rows: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/incident-severity",
        select: { _id: true, name: true },
      });

      return rows.length > 0 ? rows : null;
    },
  });

  const resolvedState: JSONish = await pollUntil<JSONish>({
    page: data.page,
    description: "the resolved incident state to be seeded",
    timeoutMs: 120000,
    check: async (): Promise<JSONish | null> => {
      const rows: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/incident-state",
        select: { _id: true, name: true, isResolvedState: true },
      });

      return (
        rows.find((row: JSONish) => {
          return row["isResolvedState"] === true;
        }) || null
      );
    },
  });

  const operational: JSONish = statuses.find((row: JSONish) => {
    return row["isOperationalState"] === true;
  })!;
  const offline: JSONish = statuses.find((row: JSONish) => {
    return row["isOfflineState"] === true;
  })!;

  return {
    operationalMonitorStatusId: toId(operational["_id"]),
    offlineMonitorStatusId: toId(offline["_id"]),
    incidentSeverityId: toId(severities[0]!["_id"]),
    resolvedIncidentStateId: toId(resolvedState["_id"]),
  };
};

type EnsureUserCanBeNotifiedFunction = (data: {
  page: Page;
  projectId: string;
  user: SessionUser;
}) => Promise<void>;

/*
 * Makes sure the project owner has a verified notification method and the
 * default "notify me when an incident on-call policy is executed" rules.
 * Without them the policy would execute but never reach a human, and the
 * "user alerted" assertion would be vacuous.
 *
 * Self-hosted (billing disabled): signup marks the email verified, so
 * ProjectService seeds a verified UserEmail plus the default rules and this
 * helper only waits for them.
 *
 * SaaS (billing enabled): the email starts unverified and nothing is seeded,
 * so create the UserEmail and confirm it with the code the create response
 * returns — the same two calls the dashboard's "Notification Methods" page
 * makes. Confirming an email is what triggers the default rules to be seeded,
 * so both environments look identical afterwards.
 */
export const ensureUserCanBeNotified: EnsureUserCanBeNotifiedFunction =
  async (data: {
    page: Page;
    projectId: string;
    user: SessionUser;
  }): Promise<void> => {
    const existing: Array<JSONish> = await listItems({
      page: data.page,
      projectId: data.projectId,
      path: "/api/user-email",
      select: { _id: true, email: true, isVerified: true },
    });

    const verified: JSONish | undefined = existing.find((row: JSONish) => {
      return row["isVerified"] === true;
    });

    if (!verified) {
      const created: JSONish = await createItem({
        page: data.page,
        projectId: data.projectId,
        path: "/api/user-email",
        item: {
          projectId: data.projectId,
          userId: data.user.userId,
          email: { _type: "Email", value: data.user.email },
        },
      });

      expect(
        created["verificationCode"],
        "creating a UserEmail should return its verification code so the spec can confirm the address the way the dashboard does",
      ).toBeTruthy();

      await requestJson({
        page: data.page,
        projectId: data.projectId,
        path: "/api/user-email/verify",
        body: {
          itemId: toId(created["_id"]),
          code: created["verificationCode"],
        },
      });
    }

    await pollUntil<boolean>({
      page: data.page,
      description: "default on-call notification rules for the project owner",
      timeoutMs: 120000,
      check: async (): Promise<boolean | null> => {
        const rules: Array<JSONish> = await listItems({
          page: data.page,
          projectId: data.projectId,
          path: "/api/user-notification-rule",
          select: { _id: true, ruleType: true, userEmailId: true },
        });

        const hasIncidentRule: boolean = rules.some((rule: JSONish) => {
          return (
            String(rule["ruleType"] || "").includes(
              "incident on-call policy",
            ) && Boolean(rule["userEmailId"])
          );
        });

        return hasIncidentRule ? true : null;
      },
    });
  };

type CreateOnCallPolicyForUserFunction = (data: {
  page: Page;
  projectId: string;
  userId: string;
  policyName: string;
}) => Promise<string>;

/*
 * Creates an on-call duty policy with a single escalation rule containing the
 * given user.
 *
 * `order: 1` matters: the execution log looks up the rule with order 1 when it
 * starts, and a policy without one goes straight to Error with "No Escalation
 * Rules in Policy". `escalateAfterInMinutes: 30` keeps the every-minute
 * escalation cron from advancing to a second rule while the spec is asserting.
 */
export const createOnCallPolicyForUser: CreateOnCallPolicyForUserFunction =
  async (data: {
    page: Page;
    projectId: string;
    userId: string;
    policyName: string;
  }): Promise<string> => {
    const policy: JSONish = await createItem({
      page: data.page,
      projectId: data.projectId,
      path: "/api/on-call-duty-policy",
      item: { name: data.policyName, projectId: data.projectId },
    });
    const policyId: string = toId(policy["_id"]);

    const escalationRule: JSONish = await createItem({
      page: data.page,
      projectId: data.projectId,
      path: "/api/on-call-duty-policy-escalation-rule",
      item: {
        name: "E2E Escalation Rule 1",
        projectId: data.projectId,
        onCallDutyPolicyId: policyId,
        escalateAfterInMinutes: 30,
        order: 1,
      },
    });

    await createItem({
      page: data.page,
      projectId: data.projectId,
      path: "/api/on-call-duty-policy-escalation-rule-user",
      item: {
        projectId: data.projectId,
        onCallDutyPolicyId: policyId,
        onCallDutyPolicyEscalationRuleId: toId(escalationRule["_id"]),
        userId: data.userId,
      },
    });

    return policyId;
  };

/*
 * Ids for one monitor's step and criteria.
 *
 * These must stay stable for the lifetime of the monitor. When an incident is
 * declared, it records the criteria id and incident-template id that produced
 * it; auto-resolve later looks those ids up in the monitor's *current* steps.
 * Regenerating them on an update (e.g. when pointing the monitor back at a
 * healthy URL) orphans the open incident and it never resolves.
 */
export interface MonitorStepIds {
  stepId: string;
  onlineCriteriaId: string;
  offlineCriteriaId: string;
  incidentTemplateId: string;
}

type NewMonitorStepIdsFunction = () => MonitorStepIds;

export const newMonitorStepIds: NewMonitorStepIdsFunction =
  (): MonitorStepIds => {
    return {
      stepId: crypto.randomUUID(),
      onlineCriteriaId: crypto.randomUUID(),
      offlineCriteriaId: crypto.randomUUID(),
      incidentTemplateId: crypto.randomUUID(),
    };
  };

export type WaitForMonitorStatusFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
  expectedMonitorStatusId: string;
  description: string;
  timeoutMs: number;
}) => Promise<void>;

/*
 * Waits for a probe to evaluate the monitor and push its status to the
 * expected value. This is the "probe" hop: nothing else in the system writes
 * currentMonitorStatusId for a probeable monitor.
 */
export const waitForMonitorStatus: WaitForMonitorStatusFunction = async (data: {
  page: Page;
  projectId: string;
  monitorId: string;
  expectedMonitorStatusId: string;
  description: string;
  timeoutMs: number;
}): Promise<void> => {
  await pollUntil<boolean>({
    page: data.page,
    description: data.description,
    timeoutMs: data.timeoutMs,
    check: async (): Promise<boolean | null> => {
      const monitors: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/monitor",
        query: { _id: data.monitorId },
        select: { _id: true, currentMonitorStatusId: true },
        limit: 1,
      });

      if (monitors.length === 0) {
        return null;
      }

      const current: string = toId(monitors[0]!["currentMonitorStatusId"]);
      return current === data.expectedMonitorStatusId ? true : null;
    },
  });
};

type WaitForIncidentFunction = (data: {
  page: Page;
  projectId: string;
  incidentTitle: string;
  timeoutMs: number;
}) => Promise<JSONish>;

/*
 * Waits for the offline criteria to declare its incident.
 *
 * Matching on the title keeps the query a plain column filter, and the title
 * embeds the monitor's run-unique name so it cannot cross-match another
 * monitor or another run.
 */
export const waitForIncidentForMonitor: WaitForIncidentFunction = async (data: {
  page: Page;
  projectId: string;
  incidentTitle: string;
  timeoutMs: number;
}): Promise<JSONish> => {
  return pollUntil<JSONish>({
    page: data.page,
    description: `an incident titled "${data.incidentTitle}" to be created`,
    timeoutMs: data.timeoutMs,
    check: async (): Promise<JSONish | null> => {
      const incidents: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/incident",
        query: { title: data.incidentTitle },
        select: { _id: true, title: true },
      });

      return incidents.length > 0 ? incidents[0]! : null;
    },
  });
};

type WaitForOnCallExecutionFunction = (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyId: string;
  incidentId: string;
  timeoutMs: number;
}) => Promise<JSONish>;

/*
 * Waits for the incident to actually start the on-call duty policy. The
 * execution log is created when an incident carrying on-call policies is
 * created, so its presence proves the incident -> on-call hop rather than just
 * that a policy exists.
 */
export const waitForOnCallExecution: WaitForOnCallExecutionFunction =
  async (data: {
    page: Page;
    projectId: string;
    onCallDutyPolicyId: string;
    incidentId: string;
    timeoutMs: number;
  }): Promise<JSONish> => {
    return pollUntil<JSONish>({
      page: data.page,
      description: `on-call duty policy ${data.onCallDutyPolicyId} to be executed for incident ${data.incidentId}`,
      timeoutMs: data.timeoutMs,
      check: async (): Promise<JSONish | null> => {
        const logs: Array<JSONish> = await listItems({
          page: data.page,
          projectId: data.projectId,
          path: "/api/on-call-duty-policy-execution-log",
          query: {
            onCallDutyPolicyId: data.onCallDutyPolicyId,
            triggeredByIncidentId: data.incidentId,
          },
          select: { _id: true, status: true, statusMessage: true },
        });

        return logs.length > 0 ? logs[0]! : null;
      },
    });
  };

type WaitForOnCallUserPagedFunction = (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyExecutionLogId: string;
  userId: string;
  timeoutMs: number;
}) => Promise<JSONish>;

/*
 * Waits for the escalation rule to page the specific user.
 *
 * This is the strongest available proof that OneUptime alerted a human: the
 * row records which user the alert went to, and its "Notification Sent" status
 * is stamped once the user's notification rules have been dispatched. Unlike
 * the per-channel log below, it is completely insensitive to whether outbound
 * email actually works in the environment.
 */
export const waitForOnCallUserPaged: WaitForOnCallUserPagedFunction =
  async (data: {
    page: Page;
    projectId: string;
    onCallDutyPolicyExecutionLogId: string;
    userId: string;
    timeoutMs: number;
  }): Promise<JSONish> => {
    return pollUntil<JSONish>({
      page: data.page,
      description: `escalation rule to page user ${data.userId}`,
      timeoutMs: data.timeoutMs,
      check: async (): Promise<JSONish | null> => {
        const rows: Array<JSONish> = await listItems({
          page: data.page,
          projectId: data.projectId,
          path: "/api/on-call-duty-policy-execution-log-timeline",
          query: {
            onCallDutyPolicyExecutionLogId: data.onCallDutyPolicyExecutionLogId,
            alertSentToUserId: data.userId,
          },
          select: {
            _id: true,
            status: true,
            statusMessage: true,
            alertSentToUserId: true,
          },
        });

        return (
          rows.find((row: JSONish) => {
            return String(row["status"]) === "Notification Sent";
          }) || null
        );
      },
    });
  };

/*
 * Statuses on the per-channel notification log that mean "the platform
 * generated a notification for this user and handed it to the channel".
 *
 * `Error` is included on purpose. The CI docker-compose stack ships no SMTP
 * server and no global SMTP settings, so the email send fails with "Global
 * SMTP Config not found" *after* the notification row has been created and
 * addressed to the user. Asserting only on `Sent` would couple this spec to
 * outbound email being deliverable from a CI runner — exactly the kind of
 * environmental dependency that makes e2e tests flaky. `Skipped` is excluded
 * because it means the user was deliberately not notified.
 */
export const NOTIFIED_STATUSES: Array<string> = ["Sending", "Sent", "Error"];

type WaitForUserAlertedFunction = (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyId: string;
  incidentId: string;
  userId: string;
  timeoutMs: number;
}) => Promise<JSONish>;

/*
 * Waits for the per-channel notification log: one row per delivery attempt,
 * tagged with the user, the policy and the incident that triggered it.
 */
export const waitForUserAlerted: WaitForUserAlertedFunction = async (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyId: string;
  incidentId: string;
  userId: string;
  timeoutMs: number;
}): Promise<JSONish> => {
  return pollUntil<JSONish>({
    page: data.page,
    description: `user ${data.userId} to be notified for incident ${data.incidentId}`,
    timeoutMs: data.timeoutMs,
    check: async (): Promise<JSONish | null> => {
      const timelines: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/user-notification-log-timeline",
        query: {
          userId: data.userId,
          onCallDutyPolicyId: data.onCallDutyPolicyId,
          triggeredByIncidentId: data.incidentId,
        },
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          userId: true,
          userEmailId: true,
          onCallDutyPolicyId: true,
          triggeredByIncidentId: true,
        },
      });

      return (
        timelines.find((row: JSONish) => {
          return NOTIFIED_STATUSES.includes(String(row["status"] || ""));
        }) || null
      );
    },
  });
};

type WaitForAlertEmailFunction = (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyId: string;
  userEmail: string;
  timeoutMs: number;
}) => Promise<JSONish>;

/*
 * Waits for the alert email itself to be recorded against the on-call policy.
 *
 * The email log row is written whether or not the send succeeds, and it
 * carries the recipient address — so this asserts that a real email addressed
 * to the on-call user was produced, without depending on SMTP. The row's
 * status is deliberately not asserted for the same reason.
 */
export const waitForAlertEmail: WaitForAlertEmailFunction = async (data: {
  page: Page;
  projectId: string;
  onCallDutyPolicyId: string;
  userEmail: string;
  timeoutMs: number;
}): Promise<JSONish> => {
  return pollUntil<JSONish>({
    page: data.page,
    description: `an alert email addressed to ${data.userEmail}`,
    timeoutMs: data.timeoutMs,
    check: async (): Promise<JSONish | null> => {
      const logs: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/email-log",
        query: { onCallDutyPolicyId: data.onCallDutyPolicyId },
        select: {
          _id: true,
          toEmail: true,
          subject: true,
          status: true,
          statusMessage: true,
        },
      });

      return (
        logs.find((row: JSONish) => {
          const to: unknown = row["toEmail"];
          const address: string =
            typeof to === "string" ? to : String((to as JSONish)?.["value"]);
          return address === data.userEmail;
        }) || null
      );
    },
  });
};

type WaitForIncidentStateFunction = (data: {
  page: Page;
  projectId: string;
  incidentId: string;
  incidentStateId: string;
  description: string;
  timeoutMs: number;
}) => Promise<void>;

// Waits for an incident to reach a given state.
export const waitForIncidentState: WaitForIncidentStateFunction = async (data: {
  page: Page;
  projectId: string;
  incidentId: string;
  incidentStateId: string;
  description: string;
  timeoutMs: number;
}): Promise<void> => {
  await pollUntil<boolean>({
    page: data.page,
    description: data.description,
    timeoutMs: data.timeoutMs,
    check: async (): Promise<boolean | null> => {
      const incidents: Array<JSONish> = await listItems({
        page: data.page,
        projectId: data.projectId,
        path: "/api/incident",
        query: { _id: data.incidentId },
        select: { _id: true, currentIncidentStateId: true },
        limit: 1,
      });

      if (incidents.length === 0) {
        return null;
      }

      return toId(incidents[0]!["currentIncidentStateId"]) ===
        data.incidentStateId
        ? true
        : null;
    },
  });
};

/* ---- Incoming Request (heartbeat) monitors ---- */

/*
 * The elapsed-silence threshold, in minutes, and the floor rather than a
 * choice: NotRecievedInMinutes rejects 0 and getDifferenceInMinutes truncates,
 * so a heartbeat monitor cannot be declared offline in under 120 seconds.
 */
const HEARTBEAT_SILENCE_MINUTES: number = 1;

/*
 * The alerting spec drives its pipeline with a heartbeat monitor rather than
 * a probed one, and these are the pieces that make that work. Why a heartbeat:
 * since 78b19735bd every address that reaches this stack is loopback or
 * RFC1918, and a probe holding a REGISTER_PROBE_KEY refuses both - so a probed
 * monitor here can only ever report a refusal, which is indistinguishable from
 * an outage. Everything downstream of MonitorResourceUtil.monitorResource is
 * monitor-type agnostic, so a heartbeat exercises the identical incident ->
 * on-call -> escalation -> notification -> auto-resolve path with no egress at
 * all. The probe's own execution path is covered by ProbeExecution.spec.ts.
 */

interface HeartbeatMonitorStepsOptions {
  ids: MonitorStepIds;
  monitorName: string;
  defaults: ProjectDefaults;
  onCallPolicyIds: Array<string>;
}

type BuildHeartbeatMonitorStepsFunction = (
  options: HeartbeatMonitorStepsOptions,
) => JSONish;

/*
 * Two criteria over the arrival clock, offline first (criteria are evaluated
 * in array order and the first match wins):
 *
 *   - offline: heartbeat NOT received in 1 minute -> Offline, declare an
 *              incident, run the on-call policies. autoResolveIncident closes
 *              it again when the heartbeat comes back.
 *   - online:  heartbeat received in 1 minute -> Operational.
 *
 * The pair is exhaustive and mutually exclusive - RecievedInMinutes fires on
 * `diff <= value`, NotRecievedInMinutes on `diff > value` - so the
 * no-criteria-met default-status branch is unreachable and the monitor cannot
 * flap between them.
 *
 * The 1-minute value is the floor, not a choice: NotRecievedInMinutes rejects
 * 0, and getDifferenceInMinutes truncates, so the transition cannot fire
 * before 120s of silence. That number is what MONITOR_STATUS_TIMEOUT_MS is
 * sized from.
 *
 * Enum members, never string literals: the product spells these "Not Recieved
 * In Minutes" / "Recieved In Minutes", and a literal would turn a rename into
 * a 40-minute CI cycle instead of a compile error.
 */
export const buildHeartbeatMonitorSteps: BuildHeartbeatMonitorStepsFunction = (
  options: HeartbeatMonitorStepsOptions,
): JSONish => {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: options.ids.stepId,
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: options.ids.offlineCriteriaId,
                      monitorStatusId: options.defaults.offlineMonitorStatusId,
                      filterCondition: FilterCondition.All,
                      filters: [
                        {
                          checkOn: CheckOn.IncomingRequest,
                          filterType: FilterType.NotRecievedInMinutes,
                          value: HEARTBEAT_SILENCE_MINUTES,
                        },
                      ],
                      incidents: [
                        {
                          id: options.ids.incidentTemplateId,
                          title: `${options.monitorName} is offline`,
                          description: `${options.monitorName} is currently offline.`,
                          incidentSeverityId:
                            options.defaults.incidentSeverityId,
                          autoResolveIncident: true,
                          onCallPolicyIds: options.onCallPolicyIds,
                        },
                      ],
                      alerts: [],
                      createAlerts: false,
                      createIncidents: true,
                      changeMonitorStatus: true,
                      name: `Check if ${options.monitorName} is offline`,
                      description: `This criteria checks if ${options.monitorName} is offline`,
                    },
                  },
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: options.ids.onlineCriteriaId,
                      monitorStatusId:
                        options.defaults.operationalMonitorStatusId,
                      filterCondition: FilterCondition.All,
                      filters: [
                        {
                          checkOn: CheckOn.IncomingRequest,
                          filterType: FilterType.RecievedInMinutes,
                          value: HEARTBEAT_SILENCE_MINUTES,
                        },
                      ],
                      incidents: [],
                      alerts: [],
                      createAlerts: false,
                      createIncidents: false,
                      changeMonitorStatus: true,
                      name: `Check if ${options.monitorName} is online`,
                      description: `This criteria checks if ${options.monitorName} is online`,
                    },
                  },
                ],
              },
            },
          },
        },
      ],
      defaultMonitorStatusId: options.defaults.operationalMonitorStatusId,
    },
  };
};

interface InertIncomingRequestStepsOptions {
  ids: MonitorStepIds;
  monitorName: string;
  defaults: ProjectDefaults;
}

type BuildInertIncomingRequestStepsFunction = (
  options: InertIncomingRequestStepsOptions,
) => JSONish;

/*
 * A heartbeat monitor that cannot change state, used between "monitor
 * created" and "on-call policy attached".
 *
 * CheckHeartbeat.shouldProcessRequest only selects monitors carrying at least
 * one Incoming Request filter, so a monitor whose only criteria checks the
 * request BODY is skipped by the sweep entirely. That matters because the
 * elapsed-silence clock falls back to monitor.createdAt when no heartbeat has
 * arrived yet: created with the real criteria, a 120s fuse starts burning at
 * creation, and if create -> policy -> update overran it an incident would
 * open with no on-call policy attached and every downstream assertion would
 * fail for a non-reason.
 */
export const buildInertIncomingRequestSteps: BuildInertIncomingRequestStepsFunction =
  (options: InertIncomingRequestStepsOptions): JSONish => {
    return {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: {
              id: options.ids.stepId,
              monitorCriteria: {
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: [
                    {
                      _type: "MonitorCriteriaInstance",
                      value: {
                        id: options.ids.offlineCriteriaId,
                        monitorStatusId:
                          options.defaults.operationalMonitorStatusId,
                        filterCondition: FilterCondition.All,
                        filters: [
                          {
                            checkOn: CheckOn.RequestBody,
                            filterType: FilterType.Contains,
                            value: "__e2e_never_matches__",
                          },
                        ],
                        incidents: [],
                        alerts: [],
                        createAlerts: false,
                        createIncidents: false,
                        changeMonitorStatus: false,
                        name: `Placeholder criteria for ${options.monitorName}`,
                        description: `Holds ${options.monitorName} inert until the real criteria land`,
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        defaultMonitorStatusId: options.defaults.operationalMonitorStatusId,
      },
    };
  };

type HeartbeatUrlFunction = (secretKey: string) => string;

/*
 * /heartbeat/<secretKey> is its own nginx location that rewrites to
 * /incoming-request, inside the same vhost the host-networked e2e container
 * already reaches over http://localhost. Only `location /` carries the
 * billing redirect, so this path behaves identically in both compose modes.
 */
export const heartbeatUrl: HeartbeatUrlFunction = (
  secretKey: string,
): string => {
  return buildUrl(`/heartbeat/${secretKey}`);
};

type SendHeartbeatFunction = (data: {
  page: Page;
  secretKey: string;
  body?: JSONish | undefined;
  headers?: Record<string, string> | undefined;
}) => Promise<void>;

/*
 * One heartbeat.
 *
 * A 2xx proves nginx routed the request and NOTHING more: the ingest sends
 * its success response before enqueueing the job, and the arrival timestamp
 * is stamped later, in the worker. Liveness is proven by reading
 * incomingMonitorRequest.incomingRequestReceivedAt back - see
 * assertHeartbeatIngestIsLive - never by this status code.
 */
export const sendHeartbeat: SendHeartbeatFunction = async (data: {
  page: Page;
  secretKey: string;
  body?: JSONish | undefined;
  headers?: Record<string, string> | undefined;
}): Promise<void> => {
  const response: APIResponse = await data.page.request.post(
    heartbeatUrl(data.secretKey),
    {
      headers: { "content-type": "application/json", ...(data.headers || {}) },
      data: data.body ?? {},
    },
  );

  expect(
    response.ok(),
    `Heartbeat POST for secret key ${data.secretKey} was not accepted: ${response.status()}`,
  ).toBe(true);
};

type ReadHeartbeatReceivedAtFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
}) => Promise<string>;

/* The timestamp the WORKER stamped, which is the only real liveness signal. */
const readHeartbeatReceivedAt: ReadHeartbeatReceivedAtFunction = async (data: {
  page: Page;
  projectId: string;
  monitorId: string;
}): Promise<string> => {
  const monitors: Array<JSONish> = await listItems({
    page: data.page,
    projectId: data.projectId,
    path: "/api/monitor",
    query: { _id: data.monitorId },
    select: { _id: true, incomingMonitorRequest: true },
    limit: 1,
  });

  const request: JSONish | undefined = monitors[0]?.[
    "incomingMonitorRequest"
  ] as JSONish | undefined;

  const receivedAt: unknown = request
    ? (request as Record<string, unknown>)["incomingRequestReceivedAt"]
    : undefined;

  return receivedAt ? String(receivedAt) : "";
};

type AssertHeartbeatIngestIsLiveFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
  secretKey: string;
  timeoutMs: number;
}) => Promise<void>;

/*
 * The flow's fail-fast gate, and the thing that makes the elapsed-silence
 * clock meaningful.
 *
 * It proves nginx -> /incoming-request/:secretkey -> queue ->
 * processIncomingRequestFromQueue -> MonitorResourceUtil.monitorResource -> DB
 * in one bounded check, and it leaves the monitor with a real, fresh arrival
 * timestamp - so the silence that follows is measured from a heartbeat this
 * spec sent, not from monitor.createdAt.
 */
export const assertHeartbeatIngestIsLive: AssertHeartbeatIngestIsLiveFunction =
  async (data: {
    page: Page;
    projectId: string;
    monitorId: string;
    secretKey: string;
    timeoutMs: number;
  }): Promise<void> => {
    await pollUntil<boolean>({
      page: data.page,
      description: `the heartbeat ingest to record an arrival for monitor ${data.monitorId}`,
      timeoutMs: data.timeoutMs,
      intervalMs: 3000,
      check: async (): Promise<boolean | null> => {
        await sendHeartbeat({ page: data.page, secretKey: data.secretKey });

        const receivedAt: string = await readHeartbeatReceivedAt({
          page: data.page,
          projectId: data.projectId,
          monitorId: data.monitorId,
        });

        return receivedAt ? true : null;
      },
    });
  };

type WaitForMonitorStatusWhilePingingFunction = (data: {
  page: Page;
  projectId: string;
  monitorId: string;
  secretKey: string;
  expectedMonitorStatusId: string;
  description: string;
  timeoutMs: number;
}) => Promise<void>;

/*
 * waitForMonitorStatus, but sending a heartbeat before each read. Used only on
 * the recovery leg.
 *
 * A CheckHeartbeat tick landing between the recovery POST returning 200 and
 * the worker persisting its timestamp would re-assert Offline; pinging on
 * every poll makes the very next evaluation converge. The interval is
 * deliberately slower than the default - each heartbeat runs a full
 * monitorResource() pass (per-monitor Redis mutex, MonitorLog write, metric
 * write) on the shared telemetry queue, and hammering it would cost more than
 * it buys.
 */
export const waitForMonitorStatusWhilePinging: WaitForMonitorStatusWhilePingingFunction =
  async (data: {
    page: Page;
    projectId: string;
    monitorId: string;
    secretKey: string;
    expectedMonitorStatusId: string;
    description: string;
    timeoutMs: number;
  }): Promise<void> => {
    await pollUntil<boolean>({
      page: data.page,
      description: data.description,
      timeoutMs: data.timeoutMs,
      intervalMs: 5000,
      check: async (): Promise<boolean | null> => {
        await sendHeartbeat({ page: data.page, secretKey: data.secretKey });

        const monitors: Array<JSONish> = await listItems({
          page: data.page,
          projectId: data.projectId,
          path: "/api/monitor",
          query: { _id: data.monitorId },
          select: { _id: true, currentMonitorStatusId: true },
          limit: 1,
        });

        if (monitors.length === 0) {
          return null;
        }

        return toId(monitors[0]!["currentMonitorStatusId"]) ===
          data.expectedMonitorStatusId
          ? true
          : null;
      },
    });
  };
