/*
 * Wrong probe keys, and wrong probe registration keys, over HTTP.
 *
 * The real probe-ingest routers - the probe heartbeat (POST /alive, behind
 * ProbeAuthorization, as every authenticated probe route is) and the global
 * probe registration (POST /register) - mounted where the app mounts them,
 * behind the real JSON parser, with the real ProbeService and the real
 * EnvironmentConfig reading REGISTER_PROBE_KEY. Only the probe table (the
 * service's findOneBy and its writes) is stood in for, and Redis is a
 * stand-in that runs the counter's script as Valkey does. A request reaches
 * the app as it does through the bundled Nginx: X-Forwarded-For ends with
 * the client's address.
 *
 *   - a client may present ten different wrong keys for one probe; then its
 *     requests for that probe are refused (429, Retry-After) until the
 *     window ends, the probe's right key too - from that client alone, and
 *     for that probe alone;
 *   - a probe that still holds an old key, and a fleet of probes behind one
 *     address each holding an old key of its own, are never refused for it;
 *   - wrong keys for an id no probe has are never counted;
 *   - REGISTER_PROBE_KEY: ten different wrong ones from a client, then its
 *     registrations are refused, the right key too; probes that all hold one
 *     old registration key are never refused for it;
 *   - keys from a private network address, where OneUptime's own probes
 *     call from, are never counted, so no caller beside them can stop them;
 *   - Valkey away, keys are compared as they always were.
 */
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import {
  WRONG_COMPONENT_KEYS_PER_ADDRESS,
  WRONG_PROBE_KEYS_MESSAGE,
  WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

const mockRedisState: { client: FakeCounterRedis | null; connected: boolean } =
  { client: null, connected: false };

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return mockRedisState.client;
      },
      isConnected: (): boolean => {
        return mockRedisState.connected;
      },
    },
  };
});

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

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const REGISTER_PROBE_KEY: string = "operator-register-key-7c1e5a2d48f6b0e9c3a7";

// The probes the probe table holds: id -> key.
const PROBES: Record<string, string> = {
  "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b": "probe-one-key-3b9f1c7e5a2d48f6b0e9",
  "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f": "probe-two-key-d1f5b8e2c6a4d0f9e3b7",
};

const PROBE_ONE: string = Object.keys(PROBES)[0]!;
const PROBE_TWO: string = Object.keys(PROBES)[1]!;

const CLIENT: string = "203.0.113.40";
const OTHER_CLIENT: string = "198.51.100.41";

// The index-th probe of a fleet: a real id, the same every run.
function fleetProbeId(index: number): string {
  return `00000000-0000-4000-9000-${index.toString(16).padStart(12, "0")}`;
}

/*
 * The probe table as Postgres answers the service's lookups: a probe by its
 * id (in any spelling Postgres reads) and, when the lookup names one, its
 * key.
 */
function probeTable(query: JSONObject): JSONObject | null {
  const asRead: (id: string) => string = (id: string): string => {
    return id
      .toLowerCase()
      .split("-")
      .join("")
      .split("{")
      .join("")
      .split("}")
      .join("");
  };

  const id: string | undefined = Object.keys(PROBES).find(
    (candidate: string): boolean => {
      return asRead(candidate) === asRead(String(query["_id"]));
    },
  );

  if (!id) {
    return null;
  }

  if ("key" in query && query["key"] !== PROBES[id]) {
    return null;
  }

  return { _id: id };
}

interface RunningApp {
  server: http.Server;
  origin: string;
  probeService: AnyModule;
  created: Array<JSONObject>;
}

let running: RunningApp;
let redis: FakeCounterRedis;

const originalRegisterKey: string | undefined =
  process.env["REGISTER_PROBE_KEY"];

beforeAll(async () => {
  process.env["REGISTER_PROBE_KEY"] = REGISTER_PROBE_KEY;

  const created: Array<JSONObject> = [];
  let probeIngest: AnyModule;
  let registration: AnyModule;
  let probeService: AnyModule;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const ObjectIDModule: AnyModule = require("Common/Types/ObjectID");
    probeService = require("Common/Server/Services/ProbeService").default;

    probeService.findOneBy = jest.fn(async (findBy: unknown) => {
      const row: JSONObject | null = probeTable(
        (findBy as { query: JSONObject }).query,
      );

      if (!row) {
        return null;
      }

      const probe: AnyModule = { _id: row["_id"] };
      probe.id = new ObjectIDModule.default(row["_id"] as string);
      return probe;
    });
    probeService.findBy = jest.fn(async () => {
      return [];
    });
    probeService.updateLastAlive = jest.fn(async () => {});
    probeService.updateOneById = jest.fn(async () => {});
    probeService.create = jest.fn(async (createBy: unknown) => {
      const data: AnyModule = (createBy as { data: AnyModule }).data;
      created.push({ key: data.key, name: data.name });
      data._id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      return data;
    });

    probeIngest =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/Probe").default;
    registration =
      require("../../FeatureSet/Telemetry/API/ProbeIngest/Register").default;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/probe-ingest", registration);
  app.use("/probe-ingest", probeIngest);
  app.use(
    (
      err: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      (
        res as unknown as {
          status: (n: number) => { send: (b: unknown) => void };
        }
      )
        .status(500)
        .send({ message: err.message });
    },
  );

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  running = {
    server: server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    probeService: probeService!,
    created: created,
  };
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    running.server.close(() => {
      resolve();
    });
  });

  if (originalRegisterKey === undefined) {
    delete process.env["REGISTER_PROBE_KEY"];
  } else {
    process.env["REGISTER_PROBE_KEY"] = originalRegisterKey;
  }
});

beforeEach(() => {
  redis = new FakeCounterRedis();
  mockRedisState.client = redis;
  mockRedisState.connected = true;
  running.created.length = 0;
});

interface PostResult {
  status: number;
  body: JSONObject;
  retryAfter: string | undefined;
}

async function post(
  path: string,
  from: string,
  body: JSONObject,
): Promise<PostResult> {
  return await new Promise(
    (resolve: (r: PostResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(body);
      const url: URL = new URL(`${running.origin}${path}`);
      const request: http.ClientRequest = http.request(
        {
          host: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            // As the bundled Nginx forwards it: the client's address last.
            "x-forwarded-for": from,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            const retryAfter: string | string[] | undefined =
              response.headers["retry-after"];

            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
              retryAfter: Array.isArray(retryAfter)
                ? retryAfter[0]
                : retryAfter,
            });
          });
        },
      );
      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

async function heartbeat(
  from: string,
  probeId: string,
  probeKey: string,
): Promise<PostResult> {
  return await post("/probe-ingest/alive", from, {
    probeId: probeId,
    probeKey: probeKey,
  });
}

async function registerProbe(
  from: string,
  registerProbeKey: string,
): Promise<PostResult> {
  return await post("/probe-ingest/register", from, {
    registerProbeKey: registerProbeKey,
    probeKey: "a-new-global-probe-key-5d8a1f4c7e0b3d6a",
    probeName: "Probe",
    probeDescription: "A global probe",
  });
}

describe("a probe's key, over HTTP", () => {
  test("the right key: the heartbeat is answered, again and again, and nothing is counted", async () => {
    for (let call: number = 0; call < 25; call++) {
      expect(
        (await heartbeat(CLIENT, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
      ).toBe(200);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("ten different wrong keys for a probe, then that client is refused for that probe until the window ends, the right key too", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      const result: PostResult = await heartbeat(
        CLIENT,
        PROBE_ONE,
        `guess-${index}`,
      );

      expect(result.status).toBe(400);
      expect(result.body["message"]).toBe("Invalid Probe ID or Probe Key");
    }

    for (const key of ["guess-eleven", PROBES[PROBE_ONE]!]) {
      const result: PostResult = await heartbeat(CLIENT, PROBE_ONE, key);

      expect(result.status).toBe(429);
      expect(result.body["message"]).toBe(WRONG_PROBE_KEYS_MESSAGE);
      expect(Number(result.retryAfter)).toBeGreaterThanOrEqual(1);
    }

    // The probe itself, from its own address: answered.
    expect(
      (await heartbeat(OTHER_CLIENT, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
    ).toBe(200);

    // Another probe, from the same client: answered.
    expect(
      (await heartbeat(CLIENT, PROBE_TWO, PROBES[PROBE_TWO]!)).status,
    ).toBe(200);
  });

  test("the probe's id in any spelling Postgres reads as that id is the same probe: no new count", async () => {
    const spellings: Array<string> = [
      PROBE_TWO,
      PROBE_TWO.toUpperCase(),
      `{${PROBE_TWO}}`,
      PROBE_TWO.split("-").join(""),
    ];

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        (
          await heartbeat(
            CLIENT,
            spellings[index % spellings.length]!,
            `guess-${index}`,
          )
        ).status,
      ).toBe(400);
    }

    for (const spelling of spellings) {
      expect((await heartbeat(CLIENT, spelling, "guess-x")).status).toBe(429);
    }
  });

  test("a probe that still holds its key from before a reset is never refused for it", async () => {
    for (let call: number = 0; call < 60; call++) {
      expect(
        (await heartbeat(CLIENT, PROBE_ONE, "the-key-before-the-reset")).status,
      ).toBe(400);
    }

    expect(
      (await heartbeat(CLIENT, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
    ).toBe(200);
  });

  test("a fleet behind one address, every probe deleted or reset with its old key still in place, refuses none of the probes that work", async () => {
    // Ids no probe has any more: never counted.
    for (let index: number = 0; index < 40; index++) {
      expect(
        (await heartbeat(CLIENT, fleetProbeId(index), `old-key-${index}`))
          .status,
      ).toBe(400);
    }

    // Probes that are there, each with one old key of its own.
    for (let round: number = 0; round < 3; round++) {
      for (const probeId of [PROBE_ONE, PROBE_TWO]) {
        expect(
          (await heartbeat(CLIENT, probeId, `old-key-of-${probeId}`)).status,
        ).toBe(400);
      }
    }

    for (const probeId of [PROBE_ONE, PROBE_TWO]) {
      expect((await heartbeat(CLIENT, probeId, PROBES[probeId]!)).status).toBe(
        200,
      );
    }
  });

  test("wrong keys for an id no probe has are never counted: nothing to let in", async () => {
    for (let index: number = 0; index < 50; index++) {
      expect(
        (await heartbeat(CLIENT, fleetProbeId(1000 + index), `guess-${index}`))
          .status,
      ).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("a key the repository ships is refused as ever, and never counted", async () => {
    for (const shipped of [
      "secret",
      "please-change-this-to-random-value",
      "probe-1-please-change-this-to-random-value",
    ]) {
      expect((await heartbeat(CLIENT, PROBE_ONE, shipped)).status).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });

  test("with Valkey away, keys are compared as they always were", async () => {
    mockRedisState.connected = false;

    for (let index: number = 0; index < 30; index++) {
      expect(
        (await heartbeat(CLIENT, PROBE_ONE, `guess-${index}`)).status,
      ).toBe(400);
    }

    expect(
      (await heartbeat(CLIENT, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
    ).toBe(200);
  });
});

describe("REGISTER_PROBE_KEY, over HTTP", () => {
  test("ten different wrong registration keys, then that client's registrations are refused, the right key too; nothing registered", async () => {
    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect((await registerProbe(CLIENT, `guess-${index}`)).status).toBe(400);
    }

    for (const key of ["guess-eleven", REGISTER_PROBE_KEY]) {
      const result: PostResult = await registerProbe(CLIENT, key);

      expect(result.status).toBe(429);
      expect(result.body["message"]).toBe(
        WRONG_PROBE_REGISTRATION_KEYS_MESSAGE,
      );
      expect(Number(result.retryAfter)).toBeGreaterThanOrEqual(1);
    }

    expect(running.created).toStrictEqual([]);

    // A probe from another address registers.
    expect((await registerProbe(OTHER_CLIENT, REGISTER_PROBE_KEY)).status).toBe(
      200,
    );
    expect(running.created).toHaveLength(1);
  });

  test("the right registration key is never counted: probes that register again and again leave their address all ten of its wrong keys", async () => {
    for (let call: number = 0; call < 20; call++) {
      expect((await registerProbe(CLIENT, REGISTER_PROBE_KEY)).status).toBe(
        200,
      );
    }

    expect(redis.sets.size).toBe(0);

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect((await registerProbe(CLIENT, `guess-${index}`)).status).toBe(400);
    }

    // Ten wrong ones, and no more: the right key still registers.
    expect((await registerProbe(CLIENT, REGISTER_PROBE_KEY)).status).toBe(200);
  });

  test("probes that all hold one old registration key are never refused for it", async () => {
    for (let call: number = 0; call < 40; call++) {
      expect(
        (await registerProbe(CLIENT, "the-registration-key-before-it-changed"))
          .status,
      ).toBe(400);
    }

    expect((await registerProbe(CLIENT, REGISTER_PROBE_KEY)).status).toBe(200);
  });

  test("a shipped or missing registration key is refused before it is compared, and never counted", async () => {
    for (const key of ["secret", "please-change-this-to-random-value", ""]) {
      expect((await registerProbe(CLIENT, key)).status).toBe(400);
    }

    expect(redis.sets.size).toBe(0);
  });
});

/*
 * OneUptime's own probes call from a private network address - the bundled
 * Nginx sees the probes Docker Compose starts at their container network's
 * gateway, and the Helm chart's call from their pods' addresses - which a
 * proxy, a load balancer or a container network can show other callers as
 * too. A client over the limit is refused whichever key it carries, so keys
 * from such an address are never counted: no caller beside a probe can stop
 * it.
 */
describe("a private network address, where OneUptime's own probes call from", () => {
  test.each([
    ["a container network's gateway", "172.18.0.1"],
    ["a pod's address", "10.42.0.17"],
    ["an IPv6 unique local address", "fd00:12:34::8"],
  ])(
    "%s: wrong probe and registration keys from it are answered as wrong and never counted; the probe that holds its key keeps working, and probes keep registering",
    async (_label: string, address: string) => {
      for (
        let index: number = 0;
        index < WRONG_COMPONENT_KEYS_PER_ADDRESS * 3;
        index++
      ) {
        const wrongProbeKey: PostResult = await heartbeat(
          address,
          PROBE_ONE,
          `guess-${index}`,
        );

        expect(wrongProbeKey.status).toBe(400);
        expect(wrongProbeKey.body["message"]).toBe(
          "Invalid Probe ID or Probe Key",
        );
        expect((await registerProbe(address, `guess-${index}`)).status).toBe(
          400,
        );
      }

      expect(
        (await heartbeat(address, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
      ).toBe(200);
      expect((await registerProbe(address, REGISTER_PROBE_KEY)).status).toBe(
        200,
      );
      expect(running.created).toHaveLength(1);
      expect(redis.sets.size).toBe(0);
    },
  );

  test("a private address a caller writes in front of its own changes nothing: its own address is counted", async () => {
    const forged: string = `172.18.0.1, ${CLIENT}`;

    for (
      let index: number = 0;
      index < WRONG_COMPONENT_KEYS_PER_ADDRESS;
      index++
    ) {
      expect(
        (await heartbeat(forged, PROBE_ONE, `guess-${index}`)).status,
      ).toBe(400);
    }

    expect(
      (await heartbeat(forged, PROBE_ONE, PROBES[PROBE_ONE]!)).status,
    ).toBe(200);
    expect((await heartbeat(forged, PROBE_ONE, "guess-eleven")).status).toBe(
      429,
    );
    expect(
      (await heartbeat(`10.0.0.9, ${CLIENT}`, PROBE_ONE, PROBES[PROBE_ONE]!))
        .status,
    ).toBe(429);

    // The probe at its private address: answered.
    expect(
      (await heartbeat("172.18.0.1", PROBE_ONE, PROBES[PROBE_ONE]!)).status,
    ).toBe(200);
  });
});
