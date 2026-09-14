import HTTPResponse from "Common/Types/API/HTTPResponse";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { JSONObject } from "Common/Types/JSON";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";

/*
 * ---------------------------------------------------------------------------
 * The cluster Runner's code-fix liveness tick.
 *
 * It is one POST a minute, and the consequence of it not happening is
 * disproportionate: the AIAgent row's lastAlive is what the readiness check
 * and the orphaned-run sweeper read, so a Runner that stops ticking has its
 * queued code-fix runs failed as "no agent available" - while the process
 * itself is perfectly healthy and doing nothing wrong.
 *
 * Which makes the error handling the whole point. The control plane being
 * briefly unreachable is NORMAL, and the next tick recovers on its own. A
 * liveness tick that propagated its failure would take down the process whose
 * liveness it was reporting - the only failure mode worse than not ticking.
 *
 * runOnStartup is false on purpose: registration has to have assigned the
 * AIAgent row before anything claims to be alive on it.
 * ---------------------------------------------------------------------------
 */

interface CronRegistration {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: () => Promise<void>;
}

type PostImplementation = (
  options: Record<string, unknown>,
) => Promise<HTTPResponse<JSONObject>>;

interface Installed {
  job: CronRegistration;
  postCalls: Array<Record<string, unknown>>;
}

/*
 * BasicCron and API are both default-exported and both reached through the
 * job's own imports, so they are intercepted through the module registry
 * rather than by patching a method. The job has to be required INSIDE the
 * isolated registry for the mocks to be the copies it sees - a spy taken on
 * the outer import would be a different module instance and would never fire.
 */
type InstallFunction = (post?: PostImplementation) => Installed;

const install: InstallFunction = (post?: PostImplementation): Installed => {
  let captured: CronRegistration | null = null;
  const postCalls: Array<Record<string, unknown>> = [];

  const postImplementation: PostImplementation =
    post ??
    (async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, {}, {});
    });

  jest.isolateModules((): void => {
    jest.doMock(
      "Common/Server/Utils/BasicCron",
      (): {
        __esModule: boolean;
        default: (data: CronRegistration) => void;
      } => {
        return {
          __esModule: true,
          default: (data: CronRegistration): void => {
            captured = data;
          },
        };
      },
    );

    jest.doMock(
      "Common/Utils/API",
      (): { __esModule: boolean; default: Record<string, unknown> } => {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const actual: { default: Record<string, unknown> } = jest.requireActual(
          "Common/Utils/API",
        ) as { default: Record<string, unknown> };
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        /*
         * A proxy rather than a spread: API's methods are class statics and
         * are therefore non-enumerable, so copying the object would hand the
         * job an API with no methods on it at all.
         */
        return {
          __esModule: true,
          default: new Proxy(actual.default, {
            get: (
              target: Record<string, unknown>,
              property: string | symbol,
            ): unknown => {
              if (property === "post") {
                return async (
                  options: Record<string, unknown>,
                ): Promise<HTTPResponse<JSONObject>> => {
                  postCalls.push(options);
                  return postImplementation(options);
                };
              }

              return Reflect.get(target, property) as unknown;
            },
          }),
        };
      },
    );

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const job: { default: () => void } = require("../../Jobs/CodeFixAlive") as {
      default: () => void;
    };
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    job.default();
  });

  if (!captured) {
    throw new Error("CodeFixAlive did not register a cron job");
  }

  return { job: captured, postCalls: postCalls };
};

describe("the code-fix liveness job", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock("Common/Server/Utils/BasicCron");
    jest.dontMock("Common/Utils/API");
  });

  test("registers a named job so it is identifiable in the scheduler", () => {
    expect(install().job.jobName).toBe("Runner:CodeFixAlive");
  });

  test("ticks every minute", () => {
    expect(install().job.options.schedule).toBe(EVERY_MINUTE);
  });

  /*
   * Registration assigns the AIAgent row this job reports liveness on.
   * Ticking before that has happened would claim liveness for a row that
   * does not exist yet.
   */
  test("does not tick on startup, before registration has assigned a row", () => {
    expect(install().job.options.runOnStartup).toBe(false);
  });

  test("the scheduler is handed something it can await", () => {
    expect(typeof install().job.runFunction).toBe("function");
  });

  test("posts the runner's credentials to the alive route", async () => {
    const installed: Installed = install();

    await installed.job.runFunction();

    const call: Record<string, unknown> = installed.postCalls[0]!;
    const body: JSONObject = call["data"] as JSONObject;
    const credentials: JSONObject = RunnerAPIRequest.getDefaultRequestBody();

    expect(String(call["url"])).toContain("/api/ai-agent/alive");
    expect(body["aiAgentKey"]).toBe(credentials["aiAgentKey"]);
    expect(body["aiAgentId"]).toBe(credentials["aiAgentId"]);
  });

  test("a rejected tick does not escape - the next one recovers", async () => {
    const installed: Installed = install(async (): Promise<never> => {
      throw new Error("ECONNREFUSED");
    });

    await expect(installed.job.runFunction()).resolves.toBeUndefined();
  });

  test("a non-200 tick does not escape either", async () => {
    const installed: Installed = install(
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(503, {}, {});
      },
    );

    await expect(installed.job.runFunction()).resolves.toBeUndefined();
  });

  test("two consecutive failures still leave the job runnable", async () => {
    const installed: Installed = install(async (): Promise<never> => {
      throw new Error("down");
    });

    await expect(installed.job.runFunction()).resolves.toBeUndefined();
    await expect(installed.job.runFunction()).resolves.toBeUndefined();
  });

  test("recovers on the tick after a failure", async () => {
    let attempt: number = 0;

    const installed: Installed = install(
      async (): Promise<HTTPResponse<JSONObject>> => {
        attempt++;
        if (attempt === 1) {
          throw new Error("down");
        }
        return new HTTPResponse<JSONObject>(200, {}, {});
      },
    );

    await installed.job.runFunction();
    await installed.job.runFunction();

    expect(installed.postCalls.length).toBe(2);
  });
});
