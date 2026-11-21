import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  getDeployLabel,
  readFixPullRequest,
  readServiceDeploy,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/FixChanges";
import {
  EMPTY_ROUTE_ATTACK_COUNTS,
  ROUTE_ATTACKS_MAX_TRACES,
  RouteAttacksReading,
  buildRouteAttacksStatement,
  readRouteAttacksRow,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/RouteAttacks";
import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { HTTP_ACTIVITY_CLASS_UID } from "../../../../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  RouteAttackScope,
  RouteMatchKind,
  getRouteMatch,
} from "../../../../../Utils/SecurityCase/RouteAttackScope";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../../../Utils/Telemetry/ChangeEventFields";
import { FIX_ROUTE } from "../../../../Helpers/SecurityCaseFixStepChecks";
import { PROJECT_ID, at } from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * How the Fix step's check (#10347) reads its evidence: the attack
 * requests to the case's route as ClickHouse is asked for them - one
 * bounded statement whose route, kinds, services and moments are
 * parameters, never SQL, and a read that runs out of time fails - the row
 * it answers read back, and what shipped to the service, as change events
 * and Fix With AI's pull requests are read.
 */

const SERVICE_ID: string = "7a3c1f0e-5b8d-4e2a-9c6f-1d2e3f4a5b6c";

const SCOPE: RouteAttackScope = {
  route: FIX_ROUTE,
  match: getRouteMatch(FIX_ROUTE),
  kinds: ["sql-injection"],
  serviceIds: [SERVICE_ID],
};

const WINDOW: {
  projectId: ObjectID;
  start: Date;
  end: Date;
  splitAt: Date | null;
  settledAt: Date | null;
} = {
  projectId: PROJECT_ID,
  start: at(-60),
  end: at(120),
  splitAt: at(30),
  settledAt: at(40),
};

function paramsOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the attack requests to a route, as ClickHouse is asked for them", () => {
  test("the route, the kinds of attack and the services are parameters, never SQL", () => {
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: SCOPE,
    });

    expect(statement.query).not.toContain(FIX_ROUTE);
    expect(statement.query).not.toContain("sql-injection");
    expect(statement.query).not.toContain(SERVICE_ID);
    expect(paramsOf(statement)).toContainEqual([FIX_ROUTE, `${FIX_ROUTE}/`]);
    expect(paramsOf(statement)).toContainEqual(["sql-injection"]);
    expect(paramsOf(statement)).toContainEqual([SERVICE_ID]);
    // What the edge stopped is read apart: it never reached the app.
    expect(paramsOf(statement)).toContainEqual(["blocked", "challenged"]);
  });

  test("one project, the window's web requests, and a read that runs out of time fails", () => {
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: SCOPE,
    });

    expect(statement.query).toContain(
      `FROM ${AnalyticsTableName.SecurityEvent} WHERE projectId = `,
    );
    expect(statement.query).toContain("AND time >= ");
    expect(statement.query).toContain("AND time <= ");
    expect(paramsOf(statement)).toContain(HTTP_ACTIVITY_CLASS_UID);
    // Never read as "no attacks" for having run out of time.
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("a request's events are one request, at the furthest any says it got", () => {
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: SCOPE,
    });

    expect(statement.query).toContain(
      "if(traceId != '', traceId, eventUid) AS requestKey",
    );
    expect(statement.query).toContain("GROUP BY requestKey");
    expect(statement.query).toContain("max(multiIf(requestOutcome = ");
    // A parametric aggregate's size is a constant of the statement.
    expect(statement.query).toContain(
      `groupUniqArrayIf(${ROUTE_ATTACKS_MAX_TRACES})(requestTraceId`,
    );
  });

  test("a route written to break out of its quotes stays a value", () => {
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: {
        ...SCOPE,
        route: "/api/search' OR 1=1 --",
        match: getRouteMatch("/api/search' OR 1=1 --"),
        kinds: ["sql-injection') OR 1=1 --"],
      },
    });

    expect(statement.query).not.toContain("OR 1=1");
  });

  test("a traversal is matched by the part of its path before the attack", () => {
    const route: string = "/static/../../etc/passwd";
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: { ...SCOPE, route, match: getRouteMatch(route) },
    });

    expect(getRouteMatch(route)).toEqual({
      kind: RouteMatchKind.Prefix,
      path: "/static/",
    });
    expect(statement.query).toContain("startsWith(");
    expect(statement.query).not.toContain("etc/passwd");
    expect(paramsOf(statement)).toContain("/static/");
  });

  test("a case whose requests named no kind or service reads every attack on the route", () => {
    const named: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: SCOPE,
    });
    const unnamed: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: { ...SCOPE, kinds: [], serviceIds: [] },
    });

    expect(named.query).toContain("lower(attributes[");
    expect(unnamed.query).not.toContain("lower(attributes[");
    expect(paramsOf(unnamed)).not.toContainEqual([SERVICE_ID]);
    expect(paramsOf(unnamed)).toContainEqual([FIX_ROUTE, `${FIX_ROUTE}/`]);
  });

  test("with no change asked about, the statement is still whole: every request is before it", () => {
    const statement: Statement = buildRouteAttacksStatement({
      ...WINDOW,
      scope: SCOPE,
      splitAt: null,
      settledAt: null,
    });

    expect(statement.query).toContain("AS beforeRequests");
    expect(statement.query).toContain("AS afterRequests");
    expect(statement.query).toContain("AS edgeStoppedAfter");
  });
});

describe("the row ClickHouse answers, read back", () => {
  function read(row: JSONObject | undefined): RouteAttacksReading {
    return readRouteAttacksRow({ ...WINDOW, scope: SCOPE, row });
  }

  test("no row is no attack: nothing on either side, no moment, no trace", () => {
    const reading: RouteAttacksReading = read(undefined);

    expect(reading.before).toEqual(EMPTY_ROUTE_ATTACK_COUNTS);
    expect(reading.after).toEqual(EMPTY_ROUTE_ATTACK_COUNTS);
    expect(reading.all).toEqual(EMPTY_ROUTE_ATTACK_COUNTS);
    expect(reading.lastHarmAt).toBeNull();
    expect(reading.throughAfterTraceIds).toEqual([]);
    expect(reading.edgeStoppedAfter).toBe(0);
    expect(reading.scope).toBe(SCOPE);
    expect(reading.splitAt).toEqual(WINDOW.splitAt);
  });

  test("the counts of each side, whole, and ClickHouse's epoch for no rows is no moment", () => {
    const reading: RouteAttacksReading = read({
      beforeRequests: "24",
      beforeRejected: "18",
      beforeReachedDatabase: "6",
      beforeFirst: "2026-11-17 18:10:00.000000000",
      beforeLast: "2026-11-17 19:20:00.000000000",
      afterRequests: 11,
      afterRejected: "11",
      afterFirst: "2026-11-17 20:15:00.000000000",
      afterLast: "2026-11-17 21:00:00.000000000",
      lastThrough: "2026-11-17 19:20:00.000000000",
      lastHarm: "2026-11-17 19:20:00.000000000",
      firstThroughAfter: "1970-01-01 00:00:00.000000000",
      firstHarmAfter: "1970-01-01 00:00:00.000000000",
      edgeStoppedAfter: "2.7",
    });

    expect(reading.before).toEqual({
      requests: 24,
      rejected: 18,
      reachedApp: 0,
      errored: 0,
      reachedDatabase: 6,
      unknown: 0,
      firstAt: new Date("2026-11-17T18:10:00.000Z"),
      lastAt: new Date("2026-11-17T19:20:00.000Z"),
    });
    expect(reading.after.requests).toBe(11);
    expect(reading.after.rejected).toBe(11);
    expect(reading.lastHarmAt).toEqual(new Date("2026-11-17T19:20:00.000Z"));
    expect(reading.firstThroughAfterAt).toBeNull();
    expect(reading.firstHarmAfterAt).toBeNull();
    expect(reading.edgeStoppedAfter).toBe(2);
  });

  test("a side with no request has no counts, whatever else the row holds", () => {
    const reading: RouteAttacksReading = read({
      afterRequests: "0",
      afterRejected: "3",
      afterFirst: "2026-11-17 20:15:00.000000000",
    });

    expect(reading.after).toEqual(EMPTY_ROUTE_ATTACK_COUNTS);
  });

  test("a count that is no count is none", () => {
    const reading: RouteAttacksReading = read({
      beforeRequests: "3",
      beforeRejected: "-2",
      beforeErrored: "many",
      edgeStoppedAfter: "-1",
    });

    expect(reading.before.rejected).toBe(0);
    expect(reading.before.errored).toBe(0);
    expect(reading.edgeStoppedAfter).toBe(0);
  });

  test("the traces of attacks that got through after the change: real ids, and no more than the card links", () => {
    const traceIds: Array<string> = Array.from(
      { length: ROUTE_ATTACKS_MAX_TRACES + 5 },
      (_: unknown, index: number): string => {
        return `trace-${index}`;
      },
    );

    expect(
      read({ throughAfterTraceIds: ["", "trace-a", 42, "trace-b"] })
        .throughAfterTraceIds,
    ).toEqual(["trace-a", "trace-b"]);
    expect(
      read({ throughAfterTraceIds: traceIds }).throughAfterTraceIds,
    ).toEqual(traceIds.slice(0, ROUTE_ATTACKS_MAX_TRACES));
    expect(
      read({ throughAfterTraceIds: "trace-a" }).throughAfterTraceIds,
    ).toEqual([]);
  });
});

describe("what shipped to the service, as the check reads it", () => {
  function changeEvent(data: {
    attributes: JSONObject;
    time?: Date | undefined;
    serviceId?: string | undefined;
  }): ChangeEvent {
    const row: ChangeEvent = new ChangeEvent();

    if (data.time !== undefined) {
      row.time = data.time;
    }

    if (data.serviceId !== undefined) {
      row.primaryEntityId = new ObjectID(data.serviceId);
    }

    row.attributes = data.attributes;

    return row;
  }

  test("a deploy is named by its version, else its revision, ReplicaSet or short commit", () => {
    expect(
      getDeployLabel({ version: "v2.4.1", commitSha: "a".repeat(40) }),
    ).toBe("v2.4.1");
    expect(getDeployLabel({ appPlatformRevision: "api-00042-xyz" })).toBe(
      "api-00042-xyz",
    );
    expect(getDeployLabel({ kubernetesReplicaSet: "api-7d9f8c6b5" })).toBe(
      "api-7d9f8c6b5",
    );
    expect(
      getDeployLabel({ commitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b" }),
    ).toBe("1a2b3c4");
    expect(getDeployLabel({})).toBe("");
  });

  test("a deploy of the service, with its moment and what names it", () => {
    expect(
      readServiceDeploy(
        changeEvent({
          time: at(30),
          serviceId: SERVICE_ID,
          attributes: {
            [ChangeEventAttribute.Source]: ChangeEventSource.Api,
            "service.version": "v2.4.1",
          },
        }),
      ),
    ).toMatchObject({
      time: at(30),
      serviceId: SERVICE_ID,
      label: "v2.4.1",
    });
  });

  test("not a deploy: a change OneUptime made itself, one that failed or was cancelled, one nothing names, one with no moment or service", () => {
    const shipped: {
      time: Date;
      serviceId: string;
    } = { time: at(30), serviceId: SERVICE_ID };

    for (const row of [
      changeEvent({
        ...shipped,
        attributes: {
          [ChangeEventAttribute.Source]: ChangeEventSource.OneUptimeAi,
          "service.version": "v2.4.1",
        },
      }),
      changeEvent({
        ...shipped,
        attributes: {
          [ChangeEventAttribute.Source]: ChangeEventSource.Runbook,
          "service.version": "v2.4.1",
        },
      }),
      changeEvent({
        ...shipped,
        attributes: {
          [ChangeEventAttribute.Status]: ChangeEventStatus.Failed,
          "service.version": "v2.4.1",
        },
      }),
      changeEvent({
        ...shipped,
        attributes: {
          [ChangeEventAttribute.Status]: "Cancelled",
          "service.version": "v2.4.1",
        },
      }),
      changeEvent({
        ...shipped,
        attributes: { [ChangeEventAttribute.Source]: ChangeEventSource.Api },
      }),
      changeEvent({
        serviceId: SERVICE_ID,
        attributes: { "service.version": "v2.4.1" },
      }),
      changeEvent({
        time: at(30),
        attributes: { "service.version": "v2.4.1" },
      }),
    ]) {
      expect(readServiceDeploy(row)).toBeNull();
    }
  });

  test("a pull request of OneUptime AI's: linked only when https, deployed only once merged", () => {
    const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();

    pullRequest.pullRequestNumber = 123;
    pullRequest.pullRequestUrl = "https://github.com/acme/api/pull/123";
    pullRequest.pullRequestState = PullRequestState.Merged;
    pullRequest.mergedAt = at(20);
    pullRequest.deployedAt = at(30);
    pullRequest.deployedVersion = " v2.4.1 ";
    pullRequest.codeRepository = new CodeRepository();
    pullRequest.codeRepository.repositoryHostedAt = CodeRepositoryType.GitLab;

    expect(readFixPullRequest(pullRequest)).toMatchObject({
      number: 123,
      url: "https://github.com/acme/api/pull/123",
      host: "GitLab",
      state: PullRequestState.Merged,
      mergedAt: at(20),
      deployedAt: at(30),
      deployedVersion: "v2.4.1",
    });

    pullRequest.pullRequestUrl = "javascript:alert(1)";
    pullRequest.pullRequestState = PullRequestState.Open;
    pullRequest.pullRequestNumber = undefined;

    expect(readFixPullRequest(pullRequest)).toMatchObject({
      number: null,
      url: "",
      state: PullRequestState.Open,
      // A deploy recorded against a pull request that is not merged is no deploy of it.
      deployedAt: null,
    });
  });
});
