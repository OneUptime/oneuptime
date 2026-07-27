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
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
import Register from "../../Services/Register";
import {
  checkAliveAndReport,
  resetAliveCheckInProgress,
} from "../../Jobs/Alive";

/*
 * The alive heartbeat is what keeps a probe out of the Disconnected state:
 * the server stamps lastAlive on every POST /probe-ingest/alive, and a
 * worker flips any probe silent for 3 minutes to Disconnected. In the field
 * an unresponsive server hung this request forever (axios default timeout is
 * 0 = infinite) while node-cron stacked a brand-new hung request every
 * minute — the probe looked Disconnected on the dashboard while it was
 * perfectly healthy. These tests pin the two fixes: an explicit request
 * deadline, and a one-heartbeat-at-a-time overlap guard.
 */

// eslint-disable-next-line @typescript-eslint/typedef
let postSpy = jest.spyOn(API, "post");

function makeSuccessResponse(): unknown {
  return {
    isSuccess: (): boolean => {
      return true;
    },
  };
}

beforeEach(() => {
  // A wedged in-flight heartbeat from a previous test must never leak in.
  resetAliveCheckInProgress();
  postSpy = jest
    .spyOn(API, "post")
    .mockResolvedValue(makeSuccessResponse() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

type PostCall = {
  url: string;
  body: JSONObject;
  options: JSONObject;
};

function postCalls(): Array<PostCall> {
  return postSpy.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      url: String(arg["url"]),
      body: arg["data"] as JSONObject,
      options: arg["options"] as JSONObject,
    };
  });
}

/*
 * LocalCache has no delete, so once a test stamps PROBE.PROBE_ID it stays
 * set for the rest of this file. The unregistered case therefore MUST run
 * first; the registered describe below sets the cache key in its beforeEach.
 */
describe("checkAliveAndReport — before the probe is registered", () => {
  test("re-registers instead of posting a heartbeat", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });
    // eslint-disable-next-line @typescript-eslint/typedef
    const registerSpy = jest
      .spyOn(Register, "registerProbe")
      .mockResolvedValue(undefined as never);

    await checkAliveAndReport();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("checkAliveAndReport — registered probe", () => {
  beforeEach(() => {
    LocalCache.setString(
      "PROBE",
      "PROBE_ID",
      "11111111-2222-3333-4444-555555555555",
    );
  });

  test("posts one heartbeat to the alive endpoint, authenticated as this probe, with an explicit deadline", async () => {
    await checkAliveAndReport();

    const calls: Array<PostCall> = postCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/alive",
    );
    expect(calls[0]!.body["probeId"]).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(calls[0]!.body["probeKey"]).toBe("test-probe-key");

    /*
     * THE timeout pin: axios's default timeout is 0 — infinite — and this
     * heartbeat used to be sent with no options at all. A server that
     * accepted the TCP connection but never answered wedged the request
     * forever, the probe's lastAlive went stale, and the dashboard flagged a
     * healthy probe as Disconnected. Every heartbeat must carry a deadline.
     */
    expect(calls[0]!.options["timeout"]).toBe(45000);
  });

  test("a tick that arrives while the previous heartbeat is still in flight is skipped", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });

    postSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles — a heartbeat stuck on an unresponsive server.
      }) as never,
    );

    /*
     * First tick starts and hangs on the POST; the second tick must return
     * without posting instead of stacking another hung request (the old
     * behavior piled one on every minute until the process was restarted).
     */
    const firstTick: Promise<void> = checkAliveAndReport();
    await flushMicrotasks();

    await checkAliveAndReport();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Previous alive check is still in progress. Skipping this tick.",
    );

    // Never settles by design; the beforeEach guard reset un-wedges the file.
    void firstTick;
  });

  test("a failed heartbeat rejects but releases the guard — the next tick posts again", async () => {
    postSpy.mockRejectedValueOnce(new Error("ingest unreachable") as never);

    /*
     * The rejection propagates (BasicCron catches and logs it in
     * production); what matters is the finally releases the guard so one
     * failed heartbeat cannot permanently wedge the job.
     */
    await expect(checkAliveAndReport()).rejects.toThrow("ingest unreachable");

    await checkAliveAndReport();

    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  test("sequential heartbeats each post — the guard releases after success", async () => {
    await checkAliveAndReport();
    await checkAliveAndReport();

    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
