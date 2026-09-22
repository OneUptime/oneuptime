/*
 * ---------------------------------------------------------------------------
 * The heartbeat loop: what rides on it, and what it does when rejected.
 *
 * Two bugs are pinned here.
 *
 * Posture: the Kubernetes posture used to ride on the heartbeat of any Runner
 * that happened to run in a pod, which made the server treat an ordinary
 * project Runner as a cluster's in-cluster agent. Only the kubernetes-agent
 * Runner reports one.
 *
 * Re-registration: the third rejected heartbeat used to `await` a
 * retry-forever registration while setInterval kept firing ticks, each of
 * which could start another loop — unbounded concurrent loops, each rotating
 * the key against the others. Now at most one heartbeat is in flight, no
 * heartbeat is sent while a re-registration runs, at most one bounded
 * re-registration runs at a time, and only credential rejections count.
 *
 * HeartbeatLoop is driven directly (tick by tick) so no timer is involved.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: { heartbeat: jest.fn() },
  };
});

jest.mock("../../Services/RegisterRunner", () => {
  return {
    __esModule: true,
    default: { registerRunner: jest.fn(), tryRegisterRunner: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import {
  HeartbeatLoop,
  getHostInfo,
  REREGISTER_AFTER_REJECTED_HEARTBEATS,
  REREGISTER_MAX_ATTEMPTS,
} from "../../Jobs/Heartbeat";
import AgentClient, { HeartbeatResult } from "../../Services/RunnerClient";
import Register from "../../Services/RegisterRunner";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import { JSONObject } from "Common/Types/JSON";

const heartbeat: jest.Mock = AgentClient.heartbeat as jest.Mock;
const tryRegisterRunner: jest.Mock = Register.tryRegisterRunner as jest.Mock;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

function rejected(statusCode: number | undefined): HeartbeatResult {
  return statusCode === undefined ? { ok: false } : { ok: false, statusCode };
}

const OK: HeartbeatResult = { ok: true, statusCode: 200 };

async function tickTimes(loop: HeartbeatLoop, times: number): Promise<void> {
  for (let i: number = 0; i < times; i++) {
    await loop.tick();
  }
}

// Let the re-registration promise chain (.then/.finally) settle.
async function settle(loop: HeartbeatLoop): Promise<void> {
  const pending: Promise<void> | null = loop.getReregistration();
  if (pending) {
    await pending;
  }
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  heartbeat.mockReset();
  tryRegisterRunner.mockReset();
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
  jest.spyOn(KubernetesPosture, "build").mockResolvedValue({
    clusterIdentifier: "prod-us",
    inCluster: true,
    allowWrites: true,
    kubectlVersion: "v1.31.4",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what rides on the heartbeat", () => {
  test("the kubernetes-agent Runner reports its Kubernetes posture", async () => {
    const info: JSONObject = await getHostInfo();

    expect(info["kubernetes"]).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: true,
      kubectlVersion: "v1.31.4",
    });
    expect(info["hostname"]).toBeDefined();
  });

  /*
   * The scenario from the review: a project Runner deployed as a pod. It is
   * in a cluster — but not one it registered for — so it says nothing.
   */
  test("a project Runner that merely runs in a pod reports no posture at all", async () => {
    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);
    jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(true);

    const info: JSONObject = await getHostInfo();

    expect(info).not.toHaveProperty("kubernetes");
    expect(KubernetesPosture.build).not.toHaveBeenCalled();
  });

  test("the heartbeat carries the version and the host info", async () => {
    heartbeat.mockResolvedValue(OK);

    await new HeartbeatLoop().tick();

    expect(heartbeat).toHaveBeenCalledTimes(1);
    const sent: { agentVersion: string; hostInfo: JSONObject } = heartbeat.mock
      .calls[0]![0] as { agentVersion: string; hostInfo: JSONObject };
    expect(typeof sent.agentVersion).toBe("string");
    expect(sent.hostInfo["kubernetes"]).toBeDefined();
  });

  test("a successful heartbeat adopts the capabilities the dashboard granted", async () => {
    const setGranted: jest.SpyInstance = jest.spyOn(
      RunnerCapabilities,
      "setGrantedByServer",
    );
    heartbeat.mockResolvedValue({
      ok: true,
      statusCode: 200,
      capabilities: {
        canRunRunbooks: false,
        canRunCodeFixTasks: false,
        canRunAiCommands: true,
      },
    });

    await new HeartbeatLoop().tick();

    expect(setGranted).toHaveBeenCalledWith({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: true,
    });
  });

  test("a rejected heartbeat never touches capabilities", async () => {
    const setGranted: jest.SpyInstance = jest.spyOn(
      RunnerCapabilities,
      "setGrantedByServer",
    );
    heartbeat.mockResolvedValue({
      ok: false,
      statusCode: 401,
      capabilities: { canRunRunbooks: true, canRunCodeFixTasks: true },
    });

    await new HeartbeatLoop().tick();

    expect(setGranted).not.toHaveBeenCalled();
  });
});

describe("re-registration after rejected heartbeats", () => {
  test("credential rejections start exactly one bounded re-registration, and ticks wait for it", async () => {
    heartbeat.mockResolvedValue(rejected(401));
    const round: Deferred<boolean> = deferred<boolean>();
    tryRegisterRunner.mockReturnValue(round.promise);

    const loop: HeartbeatLoop = new HeartbeatLoop();

    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS - 1);
    expect(tryRegisterRunner).not.toHaveBeenCalled();
    expect(loop.getRejectedInARow()).toBe(
      REREGISTER_AFTER_REJECTED_HEARTBEATS - 1,
    );

    await loop.tick();
    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);
    expect(tryRegisterRunner).toHaveBeenCalledWith({
      maxAttempts: REREGISTER_MAX_ATTEMPTS,
    });
    expect(loop.isReregistering()).toBe(true);

    /*
     * The old bug: every further rejected tick while the registration was
     * pending started another loop. Now no heartbeat is even sent.
     */
    await tickTimes(loop, 20);
    expect(heartbeat).toHaveBeenCalledTimes(
      REREGISTER_AFTER_REJECTED_HEARTBEATS,
    );
    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);

    round.resolve(true);
    await settle(loop);

    expect(loop.isReregistering()).toBe(false);
    expect(loop.getRejectedInARow()).toBe(0);

    // Heartbeats resume with the new identity.
    heartbeat.mockResolvedValue(OK);
    await loop.tick();
    expect(heartbeat).toHaveBeenCalledTimes(
      REREGISTER_AFTER_REJECTED_HEARTBEATS + 1,
    );
  });

  test("a round that gives up needs a fresh run of rejections before the next one", async () => {
    heartbeat.mockResolvedValue(rejected(401));
    tryRegisterRunner.mockResolvedValue(false);

    const loop: HeartbeatLoop = new HeartbeatLoop();

    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS);
    await settle(loop);
    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);
    expect(loop.getRejectedInARow()).toBe(0);

    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS - 1);
    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);

    await loop.tick();
    await settle(loop);
    expect(tryRegisterRunner).toHaveBeenCalledTimes(2);
  });

  test("a re-registration that throws is contained and the loop recovers", async () => {
    heartbeat.mockResolvedValue(rejected(400));
    tryRegisterRunner.mockRejectedValue(new Error("boom"));

    const loop: HeartbeatLoop = new HeartbeatLoop();

    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS);
    await settle(loop);

    expect(loop.isReregistering()).toBe(false);
    expect(loop.getRejectedInARow()).toBe(0);

    heartbeat.mockResolvedValue(OK);
    await loop.tick();
    expect(loop.isHeartbeatInFlight()).toBe(false);
  });

  test.each([400, 401, 403])(
    "a %s counts as a credential rejection",
    async (statusCode: number) => {
      heartbeat.mockResolvedValue(rejected(statusCode));
      tryRegisterRunner.mockResolvedValue(true);

      const loop: HeartbeatLoop = new HeartbeatLoop();
      await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS);

      expect(tryRegisterRunner).toHaveBeenCalledTimes(1);
    },
  );

  /*
   * A server that is down or mid-deploy rejects with 5xx (or 404 from an
   * ingress that has not come back yet). Rotating the key in the middle of
   * that would add churn to an outage and, on the old code, start a loop per
   * three heartbeats for as long as the outage lasted.
   */
  test.each([404, 500, 502, 503, undefined])(
    "a %s rejection never triggers re-registration",
    async (statusCode: number | undefined) => {
      heartbeat.mockResolvedValue(rejected(statusCode));
      tryRegisterRunner.mockResolvedValue(true);

      const loop: HeartbeatLoop = new HeartbeatLoop();
      await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS * 4);

      expect(tryRegisterRunner).not.toHaveBeenCalled();
      expect(loop.getRejectedInARow()).toBe(0);
      expect(heartbeat).toHaveBeenCalledTimes(
        REREGISTER_AFTER_REJECTED_HEARTBEATS * 4,
      );
    },
  );

  test("network errors and timeouts never trigger re-registration, and never wedge the loop", async () => {
    heartbeat.mockRejectedValue(new Error("ECONNREFUSED"));
    tryRegisterRunner.mockResolvedValue(true);

    const loop: HeartbeatLoop = new HeartbeatLoop();
    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS * 4);

    expect(tryRegisterRunner).not.toHaveBeenCalled();
    expect(loop.isHeartbeatInFlight()).toBe(false);
    expect(heartbeat).toHaveBeenCalledTimes(
      REREGISTER_AFTER_REJECTED_HEARTBEATS * 4,
    );
  });

  test("a successful heartbeat resets the rejection count", async () => {
    tryRegisterRunner.mockResolvedValue(true);
    const loop: HeartbeatLoop = new HeartbeatLoop();

    heartbeat.mockResolvedValue(rejected(401));
    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS - 1);
    heartbeat.mockResolvedValue(OK);
    await loop.tick();
    expect(loop.getRejectedInARow()).toBe(0);

    heartbeat.mockResolvedValue(rejected(401));
    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS - 1);
    expect(tryRegisterRunner).not.toHaveBeenCalled();

    await loop.tick();
    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);
  });

  test("a project-scoped Runner never re-registers — its credentials are dashboard-issued", async () => {
    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);
    heartbeat.mockResolvedValue(rejected(401));
    tryRegisterRunner.mockResolvedValue(true);

    const loop: HeartbeatLoop = new HeartbeatLoop();
    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS * 3);

    expect(tryRegisterRunner).not.toHaveBeenCalled();
  });
});

describe("overlapping ticks", () => {
  /*
   * A slow server can hold a heartbeat open past the next interval. The
   * second tick must not send a second heartbeat: two in flight at once is
   * how two rejections could each conclude the key is bad.
   */
  test("a tick that finds a heartbeat in flight sends nothing", async () => {
    const slow: Deferred<HeartbeatResult> = deferred<HeartbeatResult>();
    heartbeat.mockReturnValue(slow.promise);

    const loop: HeartbeatLoop = new HeartbeatLoop();

    const first: Promise<void> = loop.tick();
    // Let the first tick reach the awaited heartbeat call.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
    expect(loop.isHeartbeatInFlight()).toBe(true);

    await loop.tick();
    await loop.tick();
    expect(heartbeat).toHaveBeenCalledTimes(1);

    slow.resolve(OK);
    await first;
    expect(loop.isHeartbeatInFlight()).toBe(false);

    heartbeat.mockResolvedValue(OK);
    await loop.tick();
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  test("overlapping rejections cannot start two re-registrations", async () => {
    heartbeat.mockResolvedValue(rejected(401));
    const round: Deferred<boolean> = deferred<boolean>();
    tryRegisterRunner.mockReturnValue(round.promise);

    const loop: HeartbeatLoop = new HeartbeatLoop();

    // Fire the ticks concurrently rather than one after another.
    await Promise.all([
      loop.tick(),
      loop.tick(),
      loop.tick(),
      loop.tick(),
      loop.tick(),
      loop.tick(),
    ]);
    await tickTimes(loop, REREGISTER_AFTER_REJECTED_HEARTBEATS);
    await Promise.all([loop.tick(), loop.tick(), loop.tick()]);

    expect(tryRegisterRunner).toHaveBeenCalledTimes(1);

    round.resolve(true);
    await settle(loop);
    expect(loop.isReregistering()).toBe(false);
  });
});
