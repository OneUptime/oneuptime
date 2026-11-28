/*
 * A BACKED-UP APP POD MOVES PROBE CONNECTIONS ELSEWHERE, OVER A REAL
 * CONNECTION (issue #11121).
 *
 * Probes keep their connections open, as does nginx in front of the App,
 * and kube-proxy sends a connection, not a request, to a pod: the pods KEDA
 * adds while probe requests wait for a scheduling slot got almost none of
 * them. So while a lane of the process has requests waiting, the answer to
 * a request it ran says "Connection: close" - at most one a lane every
 * PROBE_SCHEDULING_RECONNECT_EVERY_MS - and the probe's next request opens
 * a new connection, which may go to another pod.
 *
 * The real probe scheduling middleware on a real server, with a limiter of
 * its own, and a client on an http.Agent set as a probe's (keep-alive, the
 * most recently freed socket first): what each answer says, and which
 * connection each request goes on.
 */
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import ProbeSchedulingLimiterInstance, {
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import ProbeSchedulingReconnectInstance, {
  PROBE_SCHEDULING_RECONNECT_EVERY_MS,
  ProbeSchedulingReconnect,
} from "Common/Server/Utils/Probe/ProbeSchedulingReconnect";
import ProbeSchedulingLane from "Common/Server/Utils/Probe/ProbeSchedulingLane";
import ProbeSchedulingMetricsInstance, {
  ProbeSchedulingMetrics,
  ProbeSchedulingMetricsSnapshot,
} from "Common/Server/Utils/Probe/ProbeSchedulingMetrics";
import { KeyedConcurrencyLimits } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import Probe from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeSchedulingMiddleware, {
  beforeAnswerHeaders,
} from "../../FeatureSet/Telemetry/Middleware/ProbeScheduling";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import http from "http";
import { AddressInfo, Socket } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

const PROBE_ID: string = "8e8e8e8e-0000-4000-8000-00000000008e";

interface Served {
  origin: string;
  server: http.Server;
  // Connections the server accepted.
  accepted: () => number;
  // Requests that reached the scheduling limit, waiting or not.
  arrived: () => number;
  // The requests the handler holds until the test answers them, by label.
  release: (label: string) => void;
  reached: (label: string) => boolean;
}

interface Answer {
  status: number;
  // What the answer's Connection header said.
  connection: string | undefined;
  // Which of the client's connections it came on.
  socket: number;
  // Whether that connection was closed after it.
  socketClosed: Promise<boolean>;
}

let servers: Array<http.Server> = [];
let agents: Array<http.Agent> = [];

afterEach(async () => {
  for (const agent of agents) {
    agent.destroy();
  }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  }
  servers = [];
  agents = [];
  jest.restoreAllMocks();
});

// The probe's agent: Node's global agent's settings, which the probe sends on.
function probeAgent(): http.Agent {
  const agent: http.Agent = new http.Agent({
    keepAlive: true,
    scheduling: "lifo",
    timeout: 5000,
  });
  agents.push(agent);
  return agent;
}

async function serve(options: {
  limits?: Partial<KeyedConcurrencyLimits>;
  reconnect?: ProbeSchedulingReconnect;
  lane?: ProbeSchedulingLane;
  limiter?: ProbeSchedulingLimiter;
  metrics?: ProbeSchedulingMetrics;
}): Promise<Served> {
  const limiter: ProbeSchedulingLimiter =
    options.limiter ||
    new ProbeSchedulingLimiter(
      {
        ...probeSchedulingLimits(1),
        maxWaitMs: 10_000,
        ...(options.limits || {}),
      },
      {
        ...probeSchedulingLimits(1),
        maxWaitMs: 10_000,
        ...(options.limits || {}),
      },
    );
  const held: Map<string, () => void> = new Map<string, () => void>();
  const reached: Set<string> = new Set<string>();
  let accepted: number = 0;
  let arrived: number = 0;

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.post(
    "/work",
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void => {
      arrived++;
      // What ProbeAuthorization sets once a probe's key checks out.
      (req as unknown as { probe: Probe }).probe = new Probe(
        new ObjectID(PROBE_ID),
      );
      next();
    },
    ProbeSchedulingMiddleware.limit(
      (_req: ExpressRequest, res: ExpressResponse): void => {
        res.status(200).send([]);
      },
      {
        limiter: limiter,
        ...(options.reconnect ? { reconnect: options.reconnect } : {}),
        ...(options.lane ? { lane: options.lane } : {}),
        ...(options.metrics ? { metrics: options.metrics } : {}),
      },
    ),
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const label: string = String(req.body["label"]);
      reached.add(label);

      if (req.body["hold"]) {
        await new Promise<void>((resolve: () => void) => {
          held.set(label, resolve);
        });
      }

      res.status(200).send([]);
    },
  );

  const server: http.Server = http.createServer(app);
  // As the App's own server keeps a connection (Common/Server/Utils/Express).
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 76_000;
  server.on("connection", (): void => {
    accepted++;
  });
  servers.push(server);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server: server,
    accepted: (): number => {
      return accepted;
    },
    arrived: (): number => {
      return arrived;
    },
    release: (label: string): void => {
      held.get(label)?.();
    },
    reached: (label: string): boolean => {
      return reached.has(label);
    },
  };
}

// The client's connections, numbered as it opens them.
const socketNumbers: WeakMap<Socket, number> = new WeakMap<Socket, number>();
let nextSocketNumber: number = 1;

function send(
  served: Served,
  agent: http.Agent,
  body: { label: string; hold?: boolean },
): Promise<Answer> {
  const payload: string = JSON.stringify({
    ...body,
    probeId: PROBE_ID,
    probeCapabilities: [ProbeCapability.RetryWhenBusy],
  });
  const url: URL = new URL(`${served.origin}/work`);

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          agent: agent,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response: http.IncomingMessage): void => {
          const socket: Socket = response.socket as Socket;
          const socketClosed: Promise<boolean> = new Promise<boolean>(
            (settle: (closed: boolean) => void) => {
              if (socket.destroyed) {
                settle(true);
                return;
              }
              socket.once("close", (): void => {
                settle(true);
              });
              // A kept connection is still open once the answer is read.
              response.once("end", (): void => {
                setTimeout((): void => {
                  settle(socket.destroyed);
                }, 50);
              });
            },
          );

          response.resume();
          response.once("end", (): void => {
            resolve({
              status: response.statusCode || 0,
              connection: response.headers["connection"],
              socket: socketNumbers.get(socket) || 0,
              socketClosed: socketClosed,
            });
          });
        },
      );

      request.once("socket", (socket: Socket): void => {
        if (!socketNumbers.has(socket)) {
          socketNumbers.set(socket, nextSocketNumber++);
        }
      });
      request.on("error", reject);
      request.end(payload);
    },
  );
}

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 500 && !condition(); attempt++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
  expect(condition()).toBe(true);
}

// A reconnect whose clock stands still unless told.
function stillClock(): {
  reconnect: ProbeSchedulingReconnect;
  advance: (ms: number) => void;
} {
  let now: number = 1_000_000;
  return {
    reconnect: new ProbeSchedulingReconnect(
      PROBE_SCHEDULING_RECONNECT_EVERY_MS,
      (): number => {
        return now;
      },
    ),
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe("a probe's kept-alive connection while its App pod is backed up", () => {
  test("with nothing waiting, every answer keeps the connection: one connection carries every request", async () => {
    const served: Served = await serve({});
    const agent: http.Agent = probeAgent();
    const answers: Array<Answer> = [];

    for (let index: number = 0; index < 5; index++) {
      answers.push(await send(served, agent, { label: `quiet-${index}` }));
    }

    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(answer.connection).not.toBe("close");
      await expect(answer.socketClosed).resolves.toBe(false);
    }
    expect(
      new Set(
        answers.map((answer: Answer): number => {
          return answer.socket;
        }),
      ).size,
    ).toBe(1);
    expect(served.accepted()).toBe(1);
  });

  test("while a request waits for the lane's slot, the answer of the one running says Connection: close, and the probe's next request opens a new connection", async () => {
    const served: Served = await serve({});
    const agent: http.Agent = probeAgent();

    const first: Promise<Answer> = send(served, agent, {
      label: "running",
      hold: true,
    });
    await eventually((): boolean => {
      return served.reached("running");
    });

    // A second request, on a connection of its own, waits for the one slot.
    const second: Promise<Answer> = send(served, agent, {
      label: "waiting",
      hold: true,
    });
    await eventually((): boolean => {
      return served.accepted() === 2;
    });

    served.release("running");
    const running: Answer = await first;

    expect(running.status).toBe(200);
    expect(running.connection).toBe("close");
    await expect(running.socketClosed).resolves.toBe(true);

    // The waiting one runs now; with nothing behind it, its answer keeps its connection.
    await eventually((): boolean => {
      return served.reached("waiting");
    });
    served.release("waiting");
    const waited: Answer = await second;

    expect(waited.connection).not.toBe("close");
    await expect(waited.socketClosed).resolves.toBe(false);

    // The next request goes on the connection kept, never the closed one.
    const next: Answer = await send(served, agent, { label: "next" });
    expect(next.socket).toBe(waited.socket);
    expect(next.socket).not.toBe(running.socket);
    expect(served.accepted()).toBe(2);
  });

  test("a backed-up lane asks one answer per interval to reconnect, never every answer", async () => {
    const clock: {
      reconnect: ProbeSchedulingReconnect;
      advance: (ms: number) => void;
    } = stillClock();
    const served: Served = await serve({ reconnect: clock.reconnect });
    const agent: http.Agent = probeAgent();

    // One request runs, three wait behind it.
    const labels: Array<string> = ["a", "b", "c", "d"];
    const answers: Map<string, Promise<Answer>> = new Map<
      string,
      Promise<Answer>
    >();

    answers.set("a", send(served, agent, { label: "a", hold: true }));
    await eventually((): boolean => {
      return served.reached("a");
    });
    for (const label of labels.slice(1)) {
      answers.set(label, send(served, agent, { label, hold: true }));
    }
    await eventually((): boolean => {
      return served.accepted() === 4;
    });

    /*
     * Each answered as it gets the slot, the clock standing still: only the
     * first answer, with three waiting, asks.
     */
    const inTurn: Array<{ label: string; connection: string | undefined }> = [];
    const released: Set<string> = new Set<string>();

    for (let turn: number = 0; turn < labels.length; turn++) {
      let label: string | undefined;
      await eventually((): boolean => {
        label = labels.find((candidate: string): boolean => {
          return served.reached(candidate) && !released.has(candidate);
        });
        return Boolean(label);
      });

      if (turn === labels.length - 1) {
        // An interval later: the last, with nothing behind it, still keeps its connection.
        clock.advance(PROBE_SCHEDULING_RECONNECT_EVERY_MS);
      }

      released.add(label!);
      served.release(label!);
      inTurn.push({
        label: label!,
        connection: (await answers.get(label!)!).connection,
      });
    }

    expect(
      inTurn.map(
        (answer: {
          label: string;
          connection: string | undefined;
        }): boolean => {
          return answer.connection === "close";
        },
      ),
    ).toEqual([true, false, false, false]);
    expect(inTurn[0]!.label).toBe("a");
  });

  test("a request answered busy is not asked to reconnect: its probe waits out the Retry-After", async () => {
    const served: Served = await serve({
      limits: { maxWaiting: 0, maxWaitingPerKey: 0 },
    });
    const agent: http.Agent = probeAgent();

    const first: Promise<Answer> = send(served, agent, {
      label: "running",
      hold: true,
    });
    await eventually((): boolean => {
      return served.reached("running");
    });

    const refused: Answer = await send(served, agent, { label: "refused" });
    expect(refused.status).toBe(429);
    expect(refused.connection).not.toBe("close");

    served.release("running");
    expect((await first).connection).not.toBe("close");
  });

  test("the Test Monitor lane sheds on its own, while its own requests wait", async () => {
    const served: Served = await serve({
      lane: ProbeSchedulingLane.MonitorTests,
    });
    const agent: http.Agent = probeAgent();

    const first: Promise<Answer> = send(served, agent, {
      label: "test-running",
      hold: true,
    });
    await eventually((): boolean => {
      return served.reached("test-running");
    });
    const second: Promise<Answer> = send(served, agent, {
      label: "test-waiting",
      hold: true,
    });
    await eventually((): boolean => {
      return served.accepted() === 2;
    });

    served.release("test-running");
    expect((await first).connection).toBe("close");

    await eventually((): boolean => {
      return served.reached("test-waiting");
    });
    served.release("test-waiting");
    expect((await second).connection).not.toBe("close");
  });

  test("by default it asks through the process's own reconnect, with the request's lane and what waits in it", async () => {
    const asked: Array<{ lane: ProbeSchedulingLane; waiting: number }> = [];
    jest
      .spyOn(ProbeSchedulingReconnectInstance, "shouldAskToReconnect")
      .mockImplementation(
        (data: { lane: ProbeSchedulingLane; waiting: number }): boolean => {
          asked.push(data);
          return false;
        },
      );

    const served: Served = await serve({
      limiter: ProbeSchedulingLimiterInstance,
    });
    await send(served, probeAgent(), { label: "one" });

    expect(asked).toEqual([{ lane: ProbeSchedulingLane.Work, waiting: 0 }]);
  });
});

/*
 * #11392: each answer that asks its probe's connection to reconnect is
 * counted, in its lane, in the probe scheduling metrics that
 * /metrics/probe-scheduling adds up (reconnectsAskedPerMinute) - so an
 * operator who sees connections closed, or wants to know how long a pod
 * spent backed up, reads it there instead of inferring it from the queue.
 */
describe("how often a backed-up App pod asks its probes' connections to reconnect (#11392)", () => {
  // A view of the process's metrics of its own, so each test counts its own.
  function freshMetrics(): ProbeSchedulingMetrics {
    return new ProbeSchedulingMetrics({ replica: "app-under-test" });
  }

  /*
   * A reconnect of its own, so each test's lane asks as a lane that has not
   * asked yet. The process's remembers each lane's last ask for
   * PROBE_SCHEDULING_RECONNECT_EVERY_MS, and an earlier test's ask on the
   * same lane can be less than that before: on a fast runner the first
   * answer of a backed-up lane then keeps its connection, and nothing is
   * counted.
   */
  function freshReconnect(): ProbeSchedulingReconnect {
    return new ProbeSchedulingReconnect();
  }

  function reconnectsAsked(
    metrics: ProbeSchedulingMetrics,
    lane: ProbeSchedulingLane,
  ): number {
    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    return snapshot.lanes[lane]!.reconnectsAsked || 0;
  }

  // One request runs, `behind` wait behind it; then each runs in turn.
  async function backedUp(data: {
    served: Served;
    agent: http.Agent;
    behind: number;
    prefix: string;
  }): Promise<Array<Answer>> {
    const labels: Array<string> = Array.from(
      { length: data.behind + 1 },
      (_value: unknown, index: number): string => {
        return `${data.prefix}-${index}`;
      },
    );
    const answers: Map<string, Promise<Answer>> = new Map<
      string,
      Promise<Answer>
    >();
    const arrivedBefore: number = data.served.arrived();

    answers.set(
      labels[0]!,
      send(data.served, data.agent, { label: labels[0]!, hold: true }),
    );
    await eventually((): boolean => {
      return data.served.reached(labels[0]!);
    });
    for (const label of labels.slice(1)) {
      answers.set(label, send(data.served, data.agent, { label, hold: true }));
    }
    // Every one in, the rest waiting for the slot (kept connections, or new ones).
    await eventually((): boolean => {
      return data.served.arrived() >= arrivedBefore + labels.length;
    });

    const answered: Array<Answer> = [];
    const released: Set<string> = new Set<string>();

    for (let turn: number = 0; turn < labels.length; turn++) {
      let label: string | undefined;
      await eventually((): boolean => {
        label = labels.find((candidate: string): boolean => {
          return data.served.reached(candidate) && !released.has(candidate);
        });
        return Boolean(label);
      });

      released.add(label!);
      data.served.release(label!);
      answered.push(await answers.get(label!)!);
    }

    return answered;
  }

  function closes(answers: Array<Answer>): number {
    return answers.filter((answer: Answer): boolean => {
      return answer.connection === "close";
    }).length;
  }

  test("with nothing waiting nothing is asked, and nothing counted", async () => {
    const metrics: ProbeSchedulingMetrics = freshMetrics();
    const served: Served = await serve({ metrics });
    const agent: http.Agent = probeAgent();

    for (let index: number = 0; index < 5; index++) {
      expect(
        (await send(served, agent, { label: `quiet-${index}` })).connection,
      ).not.toBe("close");
    }

    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(0);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.MonitorTests)).toBe(0);
  });

  test("each answer that says Connection: close is counted once, in the work lane", async () => {
    const metrics: ProbeSchedulingMetrics = freshMetrics();
    const served: Served = await serve({
      metrics,
      reconnect: freshReconnect(),
    });

    const answers: Array<Answer> = await backedUp({
      served,
      agent: probeAgent(),
      behind: 1,
      prefix: "one-behind",
    });

    expect(closes(answers)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.MonitorTests)).toBe(0);
  });

  test("a backed-up lane asks once an interval, and is counted as often as it asks, never once an answer", async () => {
    const clock: {
      reconnect: ProbeSchedulingReconnect;
      advance: (ms: number) => void;
    } = stillClock();
    const metrics: ProbeSchedulingMetrics = freshMetrics();
    const served: Served = await serve({
      metrics,
      reconnect: clock.reconnect,
    });
    const agent: http.Agent = probeAgent();

    // Four answers with the clock standing still: one ask.
    const first: Array<Answer> = await backedUp({
      served,
      agent,
      behind: 3,
      prefix: "still",
    });
    expect(closes(first)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(1);

    // An interval later, backed up again: one more.
    clock.advance(PROBE_SCHEDULING_RECONNECT_EVERY_MS);
    const second: Array<Answer> = await backedUp({
      served,
      agent,
      behind: 2,
      prefix: "later",
    });
    expect(closes(second)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(2);

    // The count is the answers that asked, not the answers.
    expect(first.length + second.length).toBe(7);
  });

  test("the Test Monitor lane's are counted in its own lane", async () => {
    const metrics: ProbeSchedulingMetrics = freshMetrics();
    const served: Served = await serve({
      metrics,
      reconnect: freshReconnect(),
      lane: ProbeSchedulingLane.MonitorTests,
    });

    const answers: Array<Answer> = await backedUp({
      served,
      agent: probeAgent(),
      behind: 1,
      prefix: "tests",
    });

    expect(closes(answers)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.MonitorTests)).toBe(1);
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(0);
  });

  test("a request answered busy is neither asked to reconnect nor counted", async () => {
    const metrics: ProbeSchedulingMetrics = freshMetrics();
    const served: Served = await serve({
      metrics,
      limits: { maxWaiting: 0, maxWaitingPerKey: 0 },
    });
    const agent: http.Agent = probeAgent();

    const running: Promise<Answer> = send(served, agent, {
      label: "running",
      hold: true,
    });
    await eventually((): boolean => {
      return served.reached("running");
    });

    expect((await send(served, agent, { label: "refused" })).status).toBe(429);

    served.release("running");
    expect((await running).connection).not.toBe("close");
    expect(reconnectsAsked(metrics, ProbeSchedulingLane.Work)).toBe(0);
  });

  test("by default each is counted in the process's own probe scheduling metrics, which /metrics/probe-scheduling reads", async () => {
    const recorded: Array<ProbeSchedulingLane> = [];
    jest
      .spyOn(ProbeSchedulingMetricsInstance, "recordReconnectAsked")
      .mockImplementation((lane: ProbeSchedulingLane): void => {
        recorded.push(lane);
      });

    const served: Served = await serve({ reconnect: freshReconnect() });
    const answers: Array<Answer> = await backedUp({
      served,
      agent: probeAgent(),
      behind: 1,
      prefix: "process",
    });

    expect(closes(answers)).toBe(1);
    expect(recorded).toEqual([ProbeSchedulingLane.Work]);
  });
});

/*
 * beforeAnswerHeaders: the decision runs once, just before the answer's
 * headers go, however the handler sends the answer, and what it sets goes
 * out with them.
 */
describe("beforeAnswerHeaders", () => {
  type Send = (res: ExpressResponse) => void;

  async function answerWith(
    send: Send,
    decide: (res: ExpressResponse) => void,
  ): Promise<{
    headers: http.IncomingHttpHeaders;
    body: string;
    calls: number;
  }> {
    let calls: number = 0;
    const app: ExpressApplication = createExpressApp();

    app.get("/answer", (_req: ExpressRequest, res: ExpressResponse): void => {
      beforeAnswerHeaders(res, (): void => {
        calls++;
        decide(res);
      });
      send(res);
    });

    const server: http.Server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const response: globalThis.Response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/answer`,
    );
    const headers: http.IncomingHttpHeaders = {};
    response.headers.forEach((value: string, key: string): void => {
      headers[key] = value;
    });

    return { headers, body: await response.text(), calls };
  }

  for (const [how, send] of [
    [
      "res.send",
      (res: ExpressResponse): void => {
        res.status(200).send({ ok: true });
      },
    ],
    [
      "res.json",
      (res: ExpressResponse): void => {
        res.status(200).json({ ok: true });
      },
    ],
    [
      "writeHead and end",
      (res: ExpressResponse): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      },
    ],
  ] as Array<[string, Send]>) {
    test(`runs once before the headers go, and what it sets goes with them: ${how}`, async () => {
      const answer: {
        headers: http.IncomingHttpHeaders;
        body: string;
        calls: number;
      } = await answerWith(send, (res: ExpressResponse): void => {
        res.setHeader("x-decided", "yes");
      });

      expect(answer.calls).toBe(1);
      expect(answer.headers["x-decided"]).toBe("yes");
      expect(JSON.parse(answer.body)).toEqual({ ok: true });
    });
  }

  test("a decision that throws leaves the answer as it was", async () => {
    const answer: {
      headers: http.IncomingHttpHeaders;
      body: string;
      calls: number;
    } = await answerWith(
      (res: ExpressResponse): void => {
        res.status(200).send({ ok: true });
      },
      (): void => {
        throw new Error("could not decide");
      },
    );

    expect(answer.calls).toBe(1);
    expect(JSON.parse(answer.body)).toEqual({ ok: true });
  });

  test("an answer with nothing to write its headers with, or whose headers went already, is left alone", () => {
    let decided: number = 0;
    const decide: () => void = (): void => {
      decided++;
    };

    expect(() => {
      beforeAnswerHeaders({} as unknown as ExpressResponse, decide);
    }).not.toThrow();

    const sent: { headersSent: boolean; writeHead: () => void } = {
      headersSent: true,
      writeHead: (): void => {
        // Already written.
      },
    };
    const writeHead: () => void = sent.writeHead;
    beforeAnswerHeaders(sent as unknown as ExpressResponse, decide);

    expect(sent.writeHead).toBe(writeHead);
    expect(decided).toBe(0);
  });
});
