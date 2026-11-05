// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackApiCheckJob,
  OpenStackApiCheckResult,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleRun,
} from "Common/Types/OpenStack/OpenStackCheck";
import API from "Common/Utils/API";
import {
  FetchOpenStackChecksDependencies,
  getRunningOpenStackChecks,
  resetOpenStackChecksState,
  runOpenStackChecksTick,
  waitForRunningOpenStackChecks,
} from "../../../Jobs/OpenStack/FetchOpenStackChecks";

/*
 * The probe's half of the conversation: what it asks, what it runs, and what it says back. A run
 * never starts while one is going: the server is told what is running, and a second handed out by
 * mistake is not started.
 */

const CHECK_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const WORK_URL: string = "/probe/openstack/checks/work";
const REPORT_URL: string = "/probe/openstack/checks/report";

function apiJob(): OpenStackApiCheckJob {
  return {
    openStackCloudCheckId: CHECK_ID,
    openStackCloudId: "cloud",
    cloudName: "Lab",
    authUrl: "https://keystone.example.com",
    regions: ["RegionOne"],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    settingsVersion: 7,
    credential: { kind: "applicationCredential", id: "id", secret: "secret" },
    intervalInMinutes: 1,
  };
}

function lifecycleJob(): OpenStackLifecycleCheckJob {
  return {
    ...apiJob(),
    intervalInMinutes: 30,
    checkKey: "0123456789ab",
    expectedProjectName: "oneuptime-checks",
    options: {},
  };
}

function apiResult(): OpenStackApiCheckResult {
  return {
    startedAt: "2026-11-05T10:00:00.000Z",
    durationInMs: 1,
    regionNames: ["RegionOne"],
    token: { status: "Passed", durationInMs: 1 },
    services: [],
    certificates: [],
    warnings: [],
  };
}

function runOf(): OpenStackLifecycleRun {
  return {
    runId: "r",
    regionName: "RegionOne",
    startedAt: "2026-11-05T10:00:00.000Z",
    finishedAt: "2026-11-05T10:01:00.000Z",
    status: "Succeeded",
    steps: [],
    phases: {},
    leftoverCount: 0,
    requestCount: 1,
    writeCount: 1,
    warnings: [],
  };
}

interface Posted {
  url: string;
  body: JSONObject;
}

describe("the probe's half of the checks", () => {
  let posted: Array<Posted>;
  let answers: Array<JSONObject | HTTPErrorResponse | Error>;

  function dependencies(
    overrides: Partial<FetchOpenStackChecksDependencies> = {},
  ): FetchOpenStackChecksDependencies {
    return {
      runApiCheck: async () => {
        return apiResult();
      },
      runLifecycleCheck: async () => {
        return [runOf()];
      },
      sleep: async () => {
        // Not waiting in a test.
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    resetOpenStackChecksState();
    posted = [];
    answers = [];

    jest.spyOn(API, "fetch").mockImplementation((async (options: {
      url: { toString: () => string };
      data: JSONObject;
    }) => {
      const url: string = options.url.toString();
      posted.push({ url: url, body: options.data });

      if (url.endsWith(WORK_URL)) {
        const answer: JSONObject | HTTPErrorResponse | Error | undefined =
          answers.shift();

        if (answer instanceof HTTPErrorResponse || answer instanceof Error) {
          if (
            answer instanceof Error &&
            !(answer instanceof HTTPErrorResponse)
          ) {
            throw answer;
          }

          return answer;
        }

        return new HTTPResponse(200, answer || {}, {});
      }

      const reportAnswer: JSONObject | HTTPErrorResponse | Error | undefined =
        answers.shift();

      if (reportAnswer instanceof HTTPErrorResponse) {
        return reportAnswer;
      }

      if (reportAnswer instanceof Error) {
        throw reportAnswer;
      }

      return new HTTPResponse(200, reportAnswer || { accepted: true }, {});
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function reports(): Array<JSONObject> {
    return posted
      .filter((one: Posted): boolean => {
        return one.url.endsWith(REPORT_URL);
      })
      .map((one: Posted): JSONObject => {
        return one.body;
      });
  }

  test("runs what is handed out, and reports each", async () => {
    answers = [
      {
        apiChecks: [apiJob()] as unknown as JSONObject["apiChecks"],
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
    ];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    const sent: Array<JSONObject> = reports();

    expect(sent).toHaveLength(2);
    expect(
      sent.map((report: JSONObject) => {
        return report["kind"];
      }),
    ).toEqual(expect.arrayContaining(["api", "lifecycle"]));
    expect(sent[0]?.["settingsVersion"]).toBe(7);
    expect(getRunningOpenStackChecks()).toEqual({ api: [], lifecycle: [] });
  });

  test("a report holds no secret", async () => {
    answers = [{ apiChecks: [apiJob()] as unknown as JSONObject["apiChecks"] }];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    expect(JSON.stringify(reports())).not.toContain('"secret"');
  });

  test("says what is running, so a run never starts while one is going", async () => {
    let finish: (runs: Array<OpenStackLifecycleRun>) => void = () => {
      /* Set below. */
    };

    const slow: FetchOpenStackChecksDependencies = dependencies({
      runLifecycleCheck: () => {
        return new Promise<Array<OpenStackLifecycleRun>>(
          (resolve: (runs: Array<OpenStackLifecycleRun>) => void) => {
            finish = resolve;
          },
        );
      },
    });

    let runs: number = 0;
    const counting: FetchOpenStackChecksDependencies = {
      ...slow,
      runLifecycleCheck: (job: OpenStackLifecycleCheckJob) => {
        runs += 1;
        return slow.runLifecycleCheck(job);
      },
    };

    answers = [
      {
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
      // Handed out again by mistake: it is still not started.
      {
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
    ];

    await runOpenStackChecksTick(counting);
    await runOpenStackChecksTick(counting);

    expect(runs).toBe(1);

    const works: Array<Posted> = posted.filter((one: Posted): boolean => {
      return one.url.endsWith(WORK_URL);
    });

    expect(works[0]?.body["runningLifecycleCheckIds"]).toEqual([]);
    expect(works[1]?.body["runningLifecycleCheckIds"]).toEqual([CHECK_ID]);

    finish([runOf()]);
    await waitForRunningOpenStackChecks();

    expect(getRunningOpenStackChecks().lifecycle).toEqual([]);
  });

  test("a check that throws is still reported, as a failure saying why", async () => {
    answers = [
      {
        apiChecks: [apiJob()] as unknown as JSONObject["apiChecks"],
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
    ];

    await runOpenStackChecksTick(
      dependencies({
        runApiCheck: async () => {
          throw new Error("A bug.");
        },
        runLifecycleCheck: async () => {
          throw new Error("A bug.");
        },
      }),
    );
    await waitForRunningOpenStackChecks();

    const text: string = JSON.stringify(reports());

    expect(reports()).toHaveLength(2);
    expect(text).toContain("The probe hit an unexpected error: A bug.");
    expect(text).toContain('"status":"Failed"');
  });

  test("a lifecycle run's report is tried again while the server is away, and an API check's is not", async () => {
    answers = [
      {
        apiChecks: [apiJob()] as unknown as JSONObject["apiChecks"],
      },
      new HTTPErrorResponse(503, {}, {}),
    ];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    expect(reports()).toHaveLength(1);

    posted = [];
    answers = [
      {
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
      new HTTPErrorResponse(503, {}, {}),
      new Error("Refused."),
      { accepted: true },
    ];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    expect(reports()).toHaveLength(3);
  });

  test("a report the server does not want is not repeated", async () => {
    answers = [
      {
        lifecycleChecks: [lifecycleJob()] as unknown as JSONObject["apiChecks"],
      },
      { accepted: false, reason: "Its settings have changed." },
    ];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    expect(reports()).toHaveLength(1);
  });

  test("a server older than these checks answers with a 404, and nothing happens", async () => {
    answers = [new HTTPErrorResponse(404, {}, {})];

    await runOpenStackChecksTick(dependencies());
    await waitForRunningOpenStackChecks();

    expect(reports()).toEqual([]);
  });
});
