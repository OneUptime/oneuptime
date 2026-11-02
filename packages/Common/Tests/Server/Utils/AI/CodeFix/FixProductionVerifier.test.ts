import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import FixProductionTelemetry from "../../../../../Server/Utils/AI/CodeFix/FixProductionTelemetry";
import FixProductionVerifier, {
  MAX_GITHUB_COMPARES_PER_FIX,
  MAX_KNOWN_COMPARES,
  RUN_TIME_BUDGET_MS,
  VerifierRun,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubCommits from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommits";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import logger from "../../../../../Server/Utils/Logger";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * Fix verified in production. A merged fix of an exception is followed
 * until production decides it:
 *
 * - the deploy that ships it is a recorded deploy of the exception's
 *   service (or of the project) since the merge whose commit is the fix's,
 *   or later by GitHub's compare - another service's, another repository's,
 *   OneUptime's own and commit-less changes are not. GitHub's answers are
 *   remembered, so each deploy is compared with a fix once;
 * - in the deployed fix the exception is counted in the deploy's version
 *   when it has one, else after the rollout grace, and decided against its
 *   rate in the week before the merge;
 * - a verified fix resolves its exception, a regressed one reopens it, and
 *   a check that learns nothing new writes nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8e4b0f50-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "8e4b0f50-0000-4000-8000-000000000002";
const OTHER_SERVICE_ID: string = "8e4b0f50-0000-4000-8000-000000000003";
const EXCEPTION_ID: ObjectID = new ObjectID(
  "8e4b0f50-0000-4000-8000-000000000004",
);
const RUN_ID: ObjectID = new ObjectID("8e4b0f50-0000-4000-8000-000000000005");
const FIX_ID: ObjectID = new ObjectID("8e4b0f50-0000-4000-8000-000000000006");
const FINGERPRINT: string = "fp-checkout-total-typeerror";
const FIX_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const LATER_SHA: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
const OLDER_SHA: string = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b";
const MERGED_AT: Date = new Date("2026-10-18T10:00:00.000Z");
const NOW: Date = new Date("2026-10-20T10:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

function hoursAfterMerge(hours: number): Date {
  return new Date(MERGED_AT.getTime() + hours * HOUR);
}

function fix(overrides: JSONObject = {}): AIAgentTaskPullRequest {
  return {
    id: FIX_ID,
    _id: FIX_ID.toString(),
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    createdAt: hoursAfterMerge(-5),
    pullRequestState: PullRequestState.Merged,
    mergeCommitSha: FIX_SHA,
    mergedAt: MERGED_AT,
    productionStatus: FixProductionStatus.AwaitingDeploy,
    productionStatusAt: MERGED_AT,
    productionSummary:
      "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    repoOrganizationName: "acme",
    repoName: "checkout",
    codeRepository: {
      _id: "8e4b0f50-0000-4000-8000-000000000007",
      projectId: PROJECT_ID,
      organizationName: "acme",
      repositoryName: "checkout",
      gitHubAppInstallationId: "4242",
    },
    ...overrides,
  } as unknown as AIAgentTaskPullRequest;
}

interface Occurrence {
  time: Date;
  release?: string;
  fingerprint?: string;
}

let changes: Array<JSONObject>;
let occurrences: Array<Occurrence>;
let exceptionRow: JSONObject | null;
let updates: Array<JSONObject>;
let exceptionUpdates: Array<JSONObject>;
let compareStatus: Record<string, string>;
let compare: SpyInstance<typeof GitHubCommits.compare>;
let mintToken: SpyInstance<typeof GitHubUtil.getInstallationAccessToken>;
let reportsVersion: SpyInstance<typeof FixProductionTelemetry.reportsVersion>;
let isBound: boolean;

function change(overrides: {
  time: Date;
  commitSha?: string;
  version?: string;
  serviceId?: string | null;
  repositoryUrl?: string;
  source?: string;
}): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    time: overrides.time,
    primaryEntityId:
      overrides.serviceId === null
        ? undefined
        : new ObjectID(overrides.serviceId || SERVICE_ID),
    attributes: {
      ...(overrides.commitSha
        ? { "vcs.ref.head.revision": overrides.commitSha }
        : {}),
      ...(overrides.version ? { "service.version": overrides.version } : {}),
      ...(overrides.repositoryUrl
        ? { "vcs.repository.url.full": overrides.repositoryUrl }
        : {}),
      "oneuptime.change.source": overrides.source || "api",
    },
  };
}

function newRun(): VerifierRun {
  return {
    now: NOW,
    tokens: new Map<string, string | null>(),
    failedCompares: new Set<string>(),
  };
}

// A merge commit-like SHA for the n-th of many deploys.
function nthSha(index: number): string {
  return `${String(index).padStart(2, "0")}${"e".repeat(38)}`;
}

beforeEach(() => {
  changes = [];
  occurrences = [];
  updates = [];
  exceptionUpdates = [];
  compareStatus = {};
  isBound = true;
  exceptionRow = {
    _id: EXCEPTION_ID.toString(),
    id: EXCEPTION_ID,
    projectId: PROJECT_ID,
    fingerprint: FINGERPRINT,
    primaryEntityId: new ObjectID(SERVICE_ID),
    isResolved: true,
  };

  // A fresh worker: no compare answer remembered.
  FixProductionVerifier.forgetCompares();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue({
    _id: RUN_ID.toString(),
    triggeredByTelemetryExceptionId: EXCEPTION_ID,
  } as never);
  jest
    .spyOn(TelemetryExceptionService, "findOneBy")
    .mockImplementation((async () => {
      return exceptionRow;
    }) as never);
  jest
    .spyOn(TelemetryExceptionService, "updateOneById")
    .mockImplementation((async (data: JSONObject) => {
      exceptionUpdates.push(data);
    }) as never);
  jest
    .spyOn(AIAgentTaskPullRequestService, "updateOneById")
    .mockImplementation((async (data: JSONObject) => {
      updates.push(data);
    }) as never);
  // ClickHouse: the query's scope (a service, or none), oldest first, capped.
  jest.spyOn(ChangeEventService, "findBy").mockImplementation((async (data: {
    query: JSONObject;
    limit: number;
  }) => {
    const scope: unknown = data.query["primaryEntityId"];

    return changes
      .filter((row: JSONObject): boolean => {
        if (scope === undefined) {
          return true;
        }

        if (scope instanceof IsNull) {
          return !row["primaryEntityId"];
        }

        return String(row["primaryEntityId"] || "") === String(scope);
      })
      .sort((a: JSONObject, b: JSONObject): number => {
        return (a["time"] as Date).getTime() - (b["time"] as Date).getTime();
      })
      .slice(0, data.limit);
  }) as never);
  jest
    .spyOn(ExceptionInstanceService, "countBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      const query: JSONObject = data.query;
      const window: InBetween<Date> = query[
        "time"
      ] as unknown as InBetween<Date>;
      const count: number = occurrences.filter((occurrence: Occurrence) => {
        return (
          (occurrence.fingerprint || FINGERPRINT) === query["fingerprint"] &&
          occurrence.time.getTime() >= window.startValue.getTime() &&
          occurrence.time.getTime() <= window.endValue.getTime() &&
          (query["release"] === undefined ||
            occurrence.release === query["release"])
        );
      }).length;
      return new PositiveNumber(count);
    }) as never);
  compare = jest
    .spyOn(GitHubCommits, "compare")
    .mockImplementation((async (data: { head: string }) => {
      const status: string | undefined = compareStatus[data.head];
      if (status === undefined) {
        throw new HTTPErrorResponse(404, { message: "No common ancestor" }, {});
      }
      return {
        status,
        totalCommits: 1,
        commits: [],
        files: [],
        isTruncated: false,
      };
    }) as never);
  mintToken = jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue({ token: "tok", expiresAt: new Date() });
  // The service's telemetry names the deploy's version, unless a test says not.
  reportsVersion = jest
    .spyOn(FixProductionTelemetry, "reportsVersion")
    .mockResolvedValue(true);
  jest
    .spyOn(GitHubInstallationBinding, "isRepositoryInstallationBound")
    .mockImplementation(async () => {
      return isBound;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastUpdate(): JSONObject {
  expect(updates.length).toBeGreaterThan(0);
  return updates[updates.length - 1]!["data"] as JSONObject;
}

describe("FixProductionVerifier.verifyAll", () => {
  test("reads the merged fixes not decided yet, least recently changed first, as the system", async () => {
    const findFixes: SpyInstance<typeof AIAgentTaskPullRequestService.findBy> =
      jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    await FixProductionVerifier.verifyAll();

    const call: JSONObject = findFixes.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;

    expect(query["pullRequestState"]).toBe(PullRequestState.Merged);
    expect(JSON.stringify(query["productionStatus"])).toContain(
      FixProductionStatus.AwaitingDeploy,
    );
    expect(JSON.stringify(query["productionStatus"])).toContain(
      FixProductionStatus.Watching,
    );
    expect(JSON.stringify(query["productionStatus"])).not.toContain(
      FixProductionStatus.Verified,
    );
    expect(call["sort"]).toEqual({ productionStatusAt: "ASC" });
    expect(call["limit"]).toBe(LIMIT_MAX);
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("one fix that cannot be checked does not stop the others", async () => {
    const second: AIAgentTaskPullRequest = fix({
      id: ObjectID.generate(),
      aiRunId: ObjectID.generate(),
    });
    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([fix(), second]);
    (AIRunService.findOneById as jest.Mock)
      .mockRejectedValueOnce(new Error("Postgres is down"))
      .mockResolvedValueOnce({
        triggeredByTelemetryExceptionId: EXCEPTION_ID,
      } as never);
    changes = [change({ time: hoursAfterMerge(1), commitSha: FIX_SHA })];

    await FixProductionVerifier.verifyAll();

    expect(updates).toHaveLength(1);
    expect(String(updates[0]!["id"])).toBe(second.id!.toString());
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("is checked again next time"),
    );
  });

  test("a failure to read the fixes is logged, not thrown", async () => {
    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(FixProductionVerifier.verifyAll()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read the merged fixes"),
    );
  });

  test("a run out of time starts no more checks, and leaves the rest for the next", async () => {
    const second: AIAgentTaskPullRequest = fix({ id: ObjectID.generate() });
    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([fix(), second]);
    changes = [change({ time: hoursAfterMerge(1), commitSha: FIX_SHA })];
    (OneUptimeDate.getCurrentDate as jest.Mock)
      // The run starts.
      .mockReturnValueOnce(NOW)
      // Before the first check: a millisecond left.
      .mockReturnValueOnce(new Date(NOW.getTime() + RUN_TIME_BUDGET_MS - 1))
      // Before the second: none.
      .mockReturnValue(new Date(NOW.getTime() + RUN_TIME_BUDGET_MS));

    await FixProductionVerifier.verifyAll();

    expect(updates).toHaveLength(1);
    expect(String(updates[0]!["id"])).toBe(FIX_ID.toString());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "out of time with 1 fix pull request(s) not checked",
      ),
    );
  });

  test("the time budget fits inside the Workers' five-minute job timeout", () => {
    expect(RUN_TIME_BUDGET_MS).toBeLessThan(5 * 60 * 1000);
  });
});

describe("finding the deploy that ships the fix", () => {
  test("a deploy of the exception's service with the fix's own commit ships it", async () => {
    changes = [
      change({
        time: hoursAfterMerge(2),
        commitSha: FIX_SHA,
        version: "2.3.2",
      }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(updates).toHaveLength(1);
    expect(updates[0]!["props"]).toEqual({ isRoot: true });
    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Watching,
      productionSummary:
        "Version 2.3.2 shipped the fix, and the exception has not happened since; before the fix it happened 0 times in 7 days.",
      productionStatusAt: NOW,
      deployedAt: hoursAfterMerge(2),
      deployedVersion: "2.3.2",
      deployedCommitSha: FIX_SHA,
    });
    expect(compare).not.toHaveBeenCalled();
  });

  test("reads the changes since the merge of the exception's service, and of the whole project, apart and as the system", async () => {
    await FixProductionVerifier.verifyFix(fix(), newRun());

    const calls: Array<JSONObject> = (
      ChangeEventService.findBy as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return call[0] as JSONObject;
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const query: JSONObject = call["query"] as JSONObject;
      const window: InBetween<Date> = query[
        "time"
      ] as unknown as InBetween<Date>;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(window.startValue).toEqual(MERGED_AT);
      expect(window.endValue).toEqual(NOW);
      expect(call["sort"]).toEqual({ time: "ASC" });
      expect(call["props"]).toEqual({ isRoot: true });
    }
    expect(String((calls[0]!["query"] as JSONObject)["primaryEntityId"])).toBe(
      SERVICE_ID,
    );
    expect(
      (calls[1]!["query"] as JSONObject)["primaryEntityId"],
    ).toBeInstanceOf(IsNull);
  });

  test("a busy project's other services do not crowd the fix's deploy out of the read", async () => {
    changes = [
      ...Array.from({ length: 250 }, (_value: unknown, index: number) => {
        return change({
          time: new Date(hoursAfterMerge(1).getTime() + index * 60 * 1000),
          commitSha: OLDER_SHA,
          serviceId: OTHER_SERVICE_ID,
        });
      }),
      change({ time: hoursAfterMerge(9), commitSha: FIX_SHA }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(9));
    expect(compare).not.toHaveBeenCalled();
  });

  test("the earliest deploy of the service's and the project's ships it", async () => {
    changes = [
      change({ time: hoursAfterMerge(4), commitSha: FIX_SHA }),
      change({ time: hoursAfterMerge(2), commitSha: FIX_SHA, serviceId: null }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(2));
  });

  test("for an exception with no service, a deploy of any service may ship it", async () => {
    exceptionRow!["primaryEntityId"] = undefined;
    changes = [
      change({
        time: hoursAfterMerge(3),
        commitSha: FIX_SHA,
        serviceId: OTHER_SERVICE_ID,
      }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(ChangeEventService.findBy).toHaveBeenCalledTimes(1);
    expect(
      (
        (ChangeEventService.findBy as jest.Mock).mock.calls[0]![0] as JSONObject
      )["query"],
    ).not.toHaveProperty("primaryEntityId");
    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(3));
  });

  test("a later commit ships it when GitHub says it is ahead of the fix", async () => {
    compareStatus = { [OLDER_SHA]: "behind", [LATER_SHA]: "ahead" };
    changes = [
      change({ time: hoursAfterMerge(1), commitSha: OLDER_SHA }),
      change({
        time: hoursAfterMerge(3),
        commitSha: LATER_SHA,
        version: "2.4.0",
      }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(3));
    expect(lastUpdate()["deployedVersion"]).toBe("2.4.0");
    expect(lastUpdate()["deployedCommitSha"]).toBe(LATER_SHA);
    expect(compare).toHaveBeenCalledTimes(2);
    expect(compare.mock.calls[1]![0]).toEqual({
      token: "tok",
      owner: "acme",
      repository: "checkout",
      base: FIX_SHA,
      head: LATER_SHA,
    });
    // Read-only: commits for compares, pull requests for a fix's diff.
    expect(mintToken).toHaveBeenCalledWith("4242", {
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
    });
  });

  test("a commit GitHub cannot compare, or one that diverged, does not ship it", async () => {
    compareStatus = { [OLDER_SHA]: "diverged" };
    changes = [
      change({ time: hoursAfterMerge(1), commitSha: OLDER_SHA }),
      change({ time: hoursAfterMerge(2), commitSha: LATER_SHA }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(updates).toEqual([]);
  });

  test("another service's deploy, another repository's, OneUptime's own fixes and commit-less changes do not ship it", async () => {
    changes = [
      change({
        time: hoursAfterMerge(1),
        commitSha: FIX_SHA,
        serviceId: OTHER_SERVICE_ID,
      }),
      change({
        time: hoursAfterMerge(2),
        commitSha: FIX_SHA,
        repositoryUrl: "https://github.com/acme/payments",
      }),
      change({
        time: hoursAfterMerge(3),
        commitSha: FIX_SHA,
        source: "oneuptime-ai",
      }),
      change({ time: hoursAfterMerge(4), version: "2.3.2" }),
      change({ time: hoursAfterMerge(5), commitSha: "main" }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(updates).toEqual([]);
    expect(compare).not.toHaveBeenCalled();
  });

  test("a deploy of the whole project, or one naming the repository however written, may ship it", async () => {
    changes = [
      change({
        time: hoursAfterMerge(1),
        commitSha: FIX_SHA,
        serviceId: null,
        repositoryUrl: "git@github.com:ACME/Checkout.git",
      }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(1));
  });

  test(`at most ${MAX_GITHUB_COMPARES_PER_FIX} GitHub compares in one check, and the next carries on past them`, async () => {
    const shipping: number = MAX_GITHUB_COMPARES_PER_FIX + 2;
    changes = Array.from(
      { length: MAX_GITHUB_COMPARES_PER_FIX + 5 },
      (_value: unknown, index: number) => {
        compareStatus[nthSha(index)] = index === shipping ? "ahead" : "behind";
        return change({
          time: hoursAfterMerge(1 + index),
          commitSha: nthSha(index),
        });
      },
    );

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(compare).toHaveBeenCalledTimes(MAX_GITHUB_COMPARES_PER_FIX);
    expect(updates).toEqual([]);

    await FixProductionVerifier.verifyFix(fix(), newRun());

    // Only the deploys not compared before, up to the one that ships it.
    expect(compare).toHaveBeenCalledTimes(shipping + 1);
    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(1 + shipping));
    expect(lastUpdate()["deployedCommitSha"]).toBe(nthSha(shipping));
  });

  test("past the cap, a deploy of the fix's own commit still ships it", async () => {
    changes = [
      ...Array.from(
        { length: MAX_GITHUB_COMPARES_PER_FIX + 1 },
        (_value: unknown, index: number) => {
          compareStatus[nthSha(index)] = "behind";
          return change({
            time: hoursAfterMerge(1 + index),
            commitSha: nthSha(index),
          });
        },
      ),
      change({ time: hoursAfterMerge(30), commitSha: FIX_SHA }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(compare).toHaveBeenCalledTimes(MAX_GITHUB_COMPARES_PER_FIX);
    expect(lastUpdate()["deployedAt"]).toEqual(hoursAfterMerge(30));
  });

  test("a repository installation not bound to the project mints no token, so only the fix's own commit can match", async () => {
    isBound = false;
    compareStatus = { [LATER_SHA]: "ahead" };
    changes = [change({ time: hoursAfterMerge(1), commitSha: LATER_SHA })];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(mintToken).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  test("one token per installation a run, and a compare GitHub answered is not asked again, in this run or a later one", async () => {
    compareStatus = { [OLDER_SHA]: "behind", [LATER_SHA]: "diverged" };
    changes = [
      change({ time: hoursAfterMerge(1), commitSha: OLDER_SHA }),
      change({ time: hoursAfterMerge(2), commitSha: LATER_SHA }),
    ];
    const run: VerifierRun = newRun();

    await FixProductionVerifier.verifyFix(fix(), run);
    await FixProductionVerifier.verifyFix(fix(), run);
    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledTimes(2);
  });

  test("a commit GitHub does not know in the repository is never asked about again", async () => {
    changes = [change({ time: hoursAfterMerge(1), commitSha: LATER_SHA })];

    await FixProductionVerifier.verifyFix(fix(), newRun());
    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(compare).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  test("a compare GitHub could not answer is asked again next run, not again this run", async () => {
    for (const failure of [
      new HTTPErrorResponse(403, { message: "API rate limit exceeded" }, {}),
      new HTTPErrorResponse(502, { message: "Bad Gateway" }, {}),
      new Error("socket hang up"),
    ]) {
      FixProductionVerifier.forgetCompares();
      compare.mockReset();
      compare.mockRejectedValue(failure);
      changes = [change({ time: hoursAfterMerge(1), commitSha: LATER_SHA })];
      const run: VerifierRun = newRun();

      await FixProductionVerifier.verifyFix(fix(), run);
      await FixProductionVerifier.verifyFix(fix(), run);

      expect(compare).toHaveBeenCalledTimes(1);

      await FixProductionVerifier.verifyFix(fix(), newRun());

      expect(compare).toHaveBeenCalledTimes(2);
    }
  });

  test("an answer GitHub does not document is not taken as one", async () => {
    compareStatus = { [LATER_SHA]: "unknown" };
    changes = [change({ time: hoursAfterMerge(1), commitSha: LATER_SHA })];

    await FixProductionVerifier.verifyFix(fix(), newRun());
    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(compare).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([]);
  });

  test("answers are not shared between projects", async () => {
    const otherProjectId: ObjectID = new ObjectID(
      "8e4b0f50-0000-4000-8000-000000000009",
    );
    compareStatus = { [LATER_SHA]: "ahead" };
    changes = [change({ time: hoursAfterMerge(1), commitSha: LATER_SHA })];

    await FixProductionVerifier.verifyFix(fix(), newRun());
    await FixProductionVerifier.verifyFix(
      fix({
        projectId: otherProjectId,
        codeRepository: {
          _id: "8e4b0f50-0000-4000-8000-000000000010",
          projectId: otherProjectId,
          organizationName: "acme",
          repositoryName: "checkout",
          gitHubAppInstallationId: "4343",
        },
      }),
      newRun(),
    );

    expect(compare).toHaveBeenCalledTimes(2);
  });

  test(`at most ${MAX_KNOWN_COMPARES} answers are remembered, the oldest forgotten first`, () => {
    for (let index: number = 0; index <= MAX_KNOWN_COMPARES; index++) {
      FixProductionVerifier.rememberCompare(`key-${index}`, "behind");
    }

    expect(FixProductionVerifier.knownCompare("key-0")).toBeUndefined();
    expect(FixProductionVerifier.knownCompare("key-1")).toBe("behind");
    expect(
      FixProductionVerifier.knownCompare(`key-${MAX_KNOWN_COMPARES}`),
    ).toBe("behind");
  });

  test("no deploy yet is waited for, quietly", async () => {
    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(updates).toEqual([]);
  });

  test("no deploy in the 14 days after the merge cannot be verified", async () => {
    await FixProductionVerifier.verifyFix(
      fix({ mergedAt: hoursAfterMerge(-14 * 24) }),
      {
        ...newRun(),
        now: new Date(MERGED_AT.getTime() + 2 * HOUR),
      },
    );

    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Unverifiable,
      productionSummary: expect.stringContaining(
        "No recorded deploy of the service contained the fix in the 14 days after it merged.",
      ),
      productionStatusAt: new Date(MERGED_AT.getTime() + 2 * HOUR),
    });
  });

  test("a fix GitHub gave no merge commit for cannot be verified", async () => {
    await FixProductionVerifier.verifyFix(
      fix({ mergeCommitSha: null }),
      newRun(),
    );

    expect(lastUpdate()["productionStatus"]).toBe(
      FixProductionStatus.Unverifiable,
    );
    expect(lastUpdate()["productionSummary"]).toBe(
      "GitHub did not say which commit the pull request merged as, so no deploy can be matched to the fix.",
    );
  });

  test("a fix whose exception is gone cannot be verified", async () => {
    exceptionRow = null;

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(lastUpdate()["productionStatus"]).toBe(
      FixProductionStatus.Unverifiable,
    );
    expect(lastUpdate()["productionSummary"]).toBe(
      "The exception this fix was opened for no longer exists, so it cannot be watched.",
    );
  });

  test("the exception is read within the fix's own project", async () => {
    await FixProductionVerifier.verifyFix(fix(), newRun());

    const query: JSONObject = (
      (TelemetryExceptionService.findOneBy as jest.Mock).mock
        .calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["_id"]).toBe(EXCEPTION_ID.toString());
  });
});

describe("watching the deployed fix", () => {
  function watching(overrides: JSONObject = {}): AIAgentTaskPullRequest {
    return fix({
      productionStatus: FixProductionStatus.Watching,
      productionSummary:
        "Version 2.3.2 shipped the fix, and the exception has not happened since; before the fix it happened 21 times in 7 days.",
      deployedAt: hoursAfterMerge(2),
      deployedVersion: "2.3.2",
      ...overrides,
    });
  }

  function baseline(count: number): void {
    for (let index: number = 0; index < count; index++) {
      occurrences.push({ time: hoursAfterMerge(-1 - index), release: "2.3.1" });
    }
  }

  test("the exception in the deployed version is a regression, and reopens it as Regressed", async () => {
    baseline(21);
    occurrences.push({ time: hoursAfterMerge(5), release: "2.3.2" });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Regressed,
      productionSummary:
        "The exception happened once after version 2.3.2 shipped the fix, so the fix did not stop it.",
      productionStatusAt: NOW,
    });
    expect(exceptionUpdates).toEqual([
      {
        id: EXCEPTION_ID,
        data: { isResolved: false, regressedAt: NOW },
        props: { isRoot: true },
      },
    ]);
  });

  test("old pods of the version before do not count against the fix", async () => {
    baseline(21);
    occurrences.push({ time: hoursAfterMerge(3), release: "2.3.1" });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);
  });

  test("a version the service's telemetry never names is not read by: the exception counts from the rollout grace on", async () => {
    baseline(21);
    reportsVersion.mockResolvedValue(false);
    // The SDK reports another version, or none: by the deploy's, nothing.
    occurrences.push({ time: hoursAfterMerge(5), release: "v2.3.2" });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
    expect(reportsVersion).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      serviceId: new ObjectID(SERVICE_ID),
      version: "2.3.2",
      from: hoursAfterMerge(2),
      to: NOW,
    });
  });

  test("an exception with no service cannot be told to report a version: from the rollout grace on", async () => {
    baseline(21);
    exceptionRow!["primaryEntityId"] = undefined;
    occurrences.push({ time: hoursAfterMerge(5), release: "2.3.1" });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(reportsVersion).not.toHaveBeenCalled();
    expect(lastUpdate()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
  });

  test("without a version, the exception counts from the rollout grace on", async () => {
    baseline(21);
    // Five minutes after the deploy: an old pod draining.
    occurrences.push({
      time: new Date(hoursAfterMerge(2).getTime() + 5 * 60 * 1000),
    });

    await FixProductionVerifier.verifyFix(
      watching({ deployedVersion: null }),
      newRun(),
    );

    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);

    occurrences.push({ time: hoursAfterMerge(4) });
    updates = [];
    await FixProductionVerifier.verifyFix(
      watching({ deployedVersion: null }),
      newRun(),
    );

    expect(lastUpdate()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
  });

  test("a frequent exception quiet long enough is fixed, and resolves it", async () => {
    baseline(21);
    exceptionRow!["isResolved"] = false;

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Verified,
      productionSummary:
        "No occurrence in the 46 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
      productionStatusAt: NOW,
    });
    expect(exceptionUpdates).toEqual([
      {
        id: EXCEPTION_ID,
        data: { isResolved: true, markedAsResolvedAt: NOW },
        props: { isRoot: true },
      },
    ]);
  });

  test("an exception already resolved is not written again", async () => {
    baseline(21);

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);
    expect(exceptionUpdates).toEqual([]);
  });

  test("the baseline is the week before the merge, in any version", async () => {
    baseline(21);
    // Older than a week before the merge: not the baseline.
    occurrences.push({ time: hoursAfterMerge(-8 * 24) });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    const baselineQuery: JSONObject = (
      ExceptionInstanceService.countBy as jest.Mock
    ).mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as JSONObject)["query"] as JSONObject;
      })
      .find((query: JSONObject) => {
        return query["release"] === undefined;
      }) as JSONObject;
    const window: InBetween<Date> = baselineQuery[
      "time"
    ] as unknown as InBetween<Date>;

    expect(window.startValue).toEqual(hoursAfterMerge(-7 * 24));
    expect(window.endValue).toEqual(MERGED_AT);
    expect(baselineQuery["projectId"]).toBe(PROJECT_ID);
    expect(baselineQuery["fingerprint"]).toBe(FINGERPRINT);
  });

  test("still watching, with nothing new to say, writes nothing", async () => {
    baseline(21);

    await FixProductionVerifier.verifyFix(
      watching({ deployedAt: hoursAfterMerge(46) }),
      newRun(),
    );

    expect(updates).toEqual([]);
    expect(exceptionUpdates).toEqual([]);
  });

  test("a deploy without a version is named by its commit, from the check that finds it to the one that decides it", async () => {
    baseline(21);
    changes = [change({ time: hoursAfterMerge(40), commitSha: FIX_SHA })];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    const found: JSONObject = lastUpdate();
    expect(found).toEqual({
      productionStatus: FixProductionStatus.Watching,
      productionSummary:
        "Commit 1a2b3c4 shipped the fix, and the exception has not happened since; before the fix it happened 21 times in 7 days.",
      productionStatusAt: NOW,
      deployedAt: hoursAfterMerge(40),
      deployedCommitSha: FIX_SHA,
    });

    // The next check, from what this one stored, has nothing new to say.
    updates = [];
    await FixProductionVerifier.verifyFix(
      watching({
        productionSummary: found["productionSummary"],
        deployedAt: hoursAfterMerge(40),
        deployedVersion: null,
        deployedCommitSha: FIX_SHA,
      }),
      newRun(),
    );
    expect(updates).toEqual([]);

    // The verdict names the same commit.
    await FixProductionVerifier.verifyFix(
      watching({
        productionSummary: found["productionSummary"],
        deployedVersion: null,
        deployedCommitSha: FIX_SHA,
      }),
      newRun(),
    );
    expect(lastUpdate()["productionSummary"]).toBe(
      "No occurrence in the 46 hours since commit 1a2b3c4 shipped the fix; before the fix it happened 21 times in 7 days.",
    );
  });

  test("a deploy found long after it ran is decided in the same check", async () => {
    baseline(21);
    changes = [
      change({
        time: hoursAfterMerge(2),
        commitSha: FIX_SHA,
        version: "2.3.2",
      }),
    ];

    await FixProductionVerifier.verifyFix(fix(), newRun());

    expect(updates).toHaveLength(1);
    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);
    expect(lastUpdate()["deployedVersion"]).toBe("2.3.2");
    expect(lastUpdate()["deployedCommitSha"]).toBe(FIX_SHA);
  });
});

/*
 * An exception others were merged into counts their occurrences too
 * (TelemetryExceptionMerge): its fix is watched over its group's - its own
 * fingerprint and those merged into it (TelemetryExceptionService
 * .getGroupFingerprints) - so a duplicate the fix did not stop is not a fix.
 */
describe("watching the fix of an exception others were merged into", () => {
  const MERGED_FINGERPRINT: string = "fp-checkout-total-typeerror-v2";
  let merged: Array<string>;
  let memberReads: Array<Array<unknown>>;

  function watching(): AIAgentTaskPullRequest {
    return fix({
      productionStatus: FixProductionStatus.Watching,
      productionSummary:
        "Version 2.3.2 shipped the fix, and the exception has not happened since; before the fix it happened 21 times in 7 days.",
      deployedAt: hoursAfterMerge(2),
      deployedVersion: "2.3.2",
    });
  }

  function baseline(count: number, fingerprint: string = FINGERPRINT): void {
    for (let index: number = 0; index < count; index++) {
      occurrences.push({
        time: hoursAfterMerge(-1 - index),
        release: "2.3.1",
        fingerprint,
      });
    }
  }

  // A count's fingerprint: one, or any of an Includes.
  function matches(value: unknown, fingerprint: string): boolean {
    return value instanceof Includes
      ? (value.values as Array<unknown>).includes(fingerprint)
      : value === fingerprint;
  }

  function countedFingerprints(): Array<unknown> {
    return (ExceptionInstanceService.countBy as jest.Mock).mock.calls.map(
      (call: Array<unknown>) => {
        return ((call[0] as JSONObject)["query"] as JSONObject)["fingerprint"];
      },
    );
  }

  beforeEach(() => {
    merged = [MERGED_FINGERPRINT];
    memberReads = [];
    TelemetryExceptionService.clearGroupFingerprints();

    // What was merged into the exception, as Postgres answers the read.
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, params: Array<unknown>) => {
          if (!sql.includes("ROW_NUMBER()")) {
            return [];
          }

          memberReads.push(params);

          return merged.map((fingerprint: string) => {
            return { survivorId: EXCEPTION_ID.toString(), fingerprint };
          });
        },
      },
    } as never);

    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        const query: JSONObject = data.query;
        const window: InBetween<Date> = query[
          "time"
        ] as unknown as InBetween<Date>;

        return new PositiveNumber(
          occurrences.filter((occurrence: Occurrence) => {
            return (
              matches(
                query["fingerprint"],
                occurrence.fingerprint || FINGERPRINT,
              ) &&
              occurrence.time.getTime() >= window.startValue.getTime() &&
              occurrence.time.getTime() <= window.endValue.getTime() &&
              (query["release"] === undefined ||
                occurrence.release === query["release"])
            );
          }).length,
        );
      }) as never);
  });

  afterEach(() => {
    TelemetryExceptionService.clearGroupFingerprints();
  });

  test("a duplicate merged into it that the fix did not stop is a regression, and reopens it", async () => {
    baseline(21);
    // Its own fingerprint is quiet since the deploy; the merged one is not.
    occurrences.push({
      time: hoursAfterMerge(5),
      release: "2.3.2",
      fingerprint: MERGED_FINGERPRINT,
    });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Regressed,
      productionSummary:
        "The exception happened once after version 2.3.2 shipped the fix, so the fix did not stop it.",
      productionStatusAt: NOW,
    });
    expect(exceptionUpdates).toEqual([
      {
        id: EXCEPTION_ID,
        data: { isResolved: false, regressedAt: NOW },
        props: { isRoot: true },
      },
    ]);
  });

  test("the occurrences of the merged ones before the merge are its baseline too", async () => {
    baseline(9);
    baseline(12, MERGED_FINGERPRINT);
    exceptionRow!["isResolved"] = false;

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(lastUpdate()).toEqual({
      productionStatus: FixProductionStatus.Verified,
      productionSummary:
        "No occurrence in the 46 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
      productionStatusAt: NOW,
    });
  });

  test("its group is read once for both counts, by its id in its project, and both count it", async () => {
    baseline(21);

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(memberReads).toEqual([
      [PROJECT_ID.toString(), [EXCEPTION_ID.toString()], 100, 10000],
    ]);

    const counted: Array<unknown> = countedFingerprints();

    expect(counted).toHaveLength(2);
    for (const fingerprint of counted) {
      expect(fingerprint).toBeInstanceOf(Includes);
      expect((fingerprint as Includes).values).toEqual([
        FINGERPRINT,
        MERGED_FINGERPRINT,
      ]);
    }
  });

  test("nothing merged into it: both counts ask for its own fingerprint alone, exactly as before any merge", async () => {
    merged = [];
    baseline(21);

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(countedFingerprints()).toEqual([FINGERPRINT, FINGERPRINT]);
    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);
  });

  test("when what was merged cannot be read, its own fingerprint is watched, as before any merge", async () => {
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async () => {
          throw new Error("Postgres is down");
        },
      },
    } as never);
    baseline(21);
    occurrences.push({
      time: hoursAfterMerge(5),
      release: "2.3.2",
      fingerprint: MERGED_FINGERPRINT,
    });

    await FixProductionVerifier.verifyFix(watching(), newRun());

    expect(countedFingerprints()).toEqual([FINGERPRINT, FINGERPRINT]);
    expect(lastUpdate()["productionStatus"]).toBe(FixProductionStatus.Verified);
  });
});
