/*
 * The global-probe registration route refuses a key the repository ships.
 *
 * A global probe runs every project's monitors, so becoming one is gated by
 * REGISTER_PROBE_KEY. That key — and the probe key the registration stores —
 * must be the installation's own, never a value public in the repository.
 * This drives the real route (FeatureSet/Telemetry/API/ProbeIngest/Register)
 * on a real Express app over HTTP, with the real EnvironmentConfig reading
 * REGISTER_PROBE_KEY and ProbeService stood in for, and checks:
 *
 *   - an installation whose REGISTER_PROBE_KEY is unset or a shipped value
 *     registers no global probe, and never touches the probe table;
 *   - a presented register key that is missing, shipped or wrong is refused
 *     (and the comparison is constant-time);
 *   - a probe key that is a shipped value is refused;
 *   - with a real register key: a new probe is created, a probe whose key
 *     matches is updated, and a probe coming back under a new key takes over
 *     the global probe of its name whose key is a shipped value (its id, and
 *     so its monitors, kept) - never one whose key is the installation's
 *     own.
 */
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  createExpressApp,
  ExpressJson,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

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

const OPERATOR_KEY: string = "operator-chosen-register-key-0123456789";
const PLACEHOLDER: string = "please-change-this-to-random-value";
const PROBE_PLACEHOLDER: string = "probe-1-please-change-this-to-random-value";

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface ProbeStub {
  findOneBy: jest.Mock;
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  create: jest.Mock;
}

interface RunningRoute {
  server: http.Server;
  origin: string;
  probe: ProbeStub;
}

interface PostResult {
  status: number;
  body: JSONObject;
}

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

async function startRoute(
  registerKey: string | undefined,
): Promise<RunningRoute> {
  if (registerKey === undefined) {
    delete process.env["REGISTER_PROBE_KEY"];
  } else {
    process.env["REGISTER_PROBE_KEY"] = registerKey;
  }

  jest.resetModules();

  const probe: ProbeStub = {
    findOneBy: jest.fn(),
    findBy: jest.fn(),
    updateOneById: jest.fn(),
    create: jest.fn(),
  };

  let router: AnyModule;

  jest.isolateModules(() => {
    const probeServiceModule: AnyModule = require_(
      "Common/Server/Services/ProbeService",
    );
    const probeService: AnyModule = probeServiceModule.default;
    probeService.findOneBy = probe.findOneBy;
    probeService.findBy = probe.findBy;
    probeService.updateOneById = probe.updateOneById;
    probeService.create = probe.create;

    router = require_(
      "../../FeatureSet/Telemetry/API/ProbeIngest/Register",
    ).default;
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/probe-ingest", router);
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

  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    probe,
  };
}

async function post(
  origin: string,
  body: JSONObject,
): Promise<{ status: number; body: JSONObject }> {
  return await new Promise(
    (
      resolve: (r: { status: number; body: JSONObject }) => void,
      reject: (e: Error) => void,
    ) => {
      const payload: string = JSON.stringify(body);
      const url: URL = new URL(`${origin}/probe-ingest/register`);
      const request: http.ClientRequest = http.request(
        {
          host: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: response.statusCode || 0,
              body: text ? (JSON.parse(text) as JSONObject) : {},
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

let running: RunningRoute | null = null;
const originalRegisterKey: string | undefined =
  process.env["REGISTER_PROBE_KEY"];

afterEach(async () => {
  if (running) {
    await new Promise<void>((resolve: () => void) => {
      running!.server.close(() => {
        resolve();
      });
    });
    running = null;
  }

  if (originalRegisterKey === undefined) {
    delete process.env["REGISTER_PROBE_KEY"];
  } else {
    process.env["REGISTER_PROBE_KEY"] = originalRegisterKey;
  }

  jest.clearAllMocks();
});

describe.each([
  ["unset", undefined],
  ["the old fallback", "secret"],
  ["the config.example.env placeholder", PLACEHOLDER],
  ["a partially edited placeholder", `${PLACEHOLDER}-2`],
])(
  "an installation whose REGISTER_PROBE_KEY is %s registers no global probe",
  (_label: string, value: string | undefined) => {
    test("every registration is refused, and the probe table is never touched", async () => {
      running = await startRoute(value);

      const result: PostResult = await post(running.origin, {
        registerProbeKey: value ?? "secret",
        probeKey: "an-operator-chosen-probe-key",
        probeName: "Probe-1",
      });

      expect(result.status).toBe(400);
      expect(result.body["message"]).toContain(
        "Global probe registration is turned off",
      );
      expect(running.probe.findOneBy).not.toHaveBeenCalled();
      expect(running.probe.findBy).not.toHaveBeenCalled();
      expect(running.probe.create).not.toHaveBeenCalled();
      expect(running.probe.updateOneById).not.toHaveBeenCalled();
    });
  },
);

describe("an installation whose operator set REGISTER_PROBE_KEY", () => {
  beforeEach(async () => {
    running = await startRoute(OPERATOR_KEY);
  });

  test.each([
    ["missing", undefined],
    ["wrong", "a-different-key"],
    ["the shipped placeholder", PLACEHOLDER],
    ["the old fallback", "secret"],
  ])(
    "refuses a presented register key that is %s, and never reads the probe table",
    async (_label: string, presented: string | undefined) => {
      const body: JSONObject = {
        probeKey: "an-operator-chosen-probe-key",
        probeName: "Probe-1",
      };

      if (presented !== undefined) {
        body["registerProbeKey"] = presented;
      }

      const result: PostResult = await post(running!.origin, body);

      expect(result.status).toBe(400);
      expect(result.body["message"]).toContain("Invalid or missing");
      expect(running!.probe.findOneBy).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["the config.example.env probe placeholder", PROBE_PLACEHOLDER],
    ["the bare placeholder", PLACEHOLDER],
    ["the old fallback", "secret"],
  ])(
    "refuses a probe key that is %s",
    async (_label: string, probeKey: string) => {
      const result: PostResult = await post(running!.origin, {
        registerProbeKey: OPERATOR_KEY,
        probeKey: probeKey,
        probeName: "Probe-1",
      });

      expect(result.status).toBe(400);
      expect(result.body["message"]).toContain(
        "value the OneUptime repository ships",
      );
      expect(running!.probe.findOneBy).not.toHaveBeenCalled();
    },
  );

  test("registers a new global probe when the key matches none", async () => {
    const newId: ObjectID = ObjectID.generate();
    running!.probe.findOneBy.mockResolvedValue(null as never);
    running!.probe.findBy.mockResolvedValue([] as never);
    running!.probe.create.mockImplementation(async (data: JSONObject) => {
      const created: JSONObject = (data as { data: JSONObject }).data;
      created["_id"] = newId;
      created["id"] = newId;
      return created;
    });

    const result: PostResult = await post(running!.origin, {
      registerProbeKey: OPERATOR_KEY,
      probeKey: "an-operator-chosen-probe-key",
      probeName: "Probe-1",
      probeDescription: "A new probe",
    });

    expect(result.status).toBe(200);
    expect(result.body["message"]).toBe("Probe registered successfully");
    expect(result.body["_id"]).toBe(newId.toString());

    const created: JSONObject = (
      running!.probe.create.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(created["isGlobalProbe"]).toBe(true);
    expect(created["key"]).toBe("an-operator-chosen-probe-key");
    expect(created["shouldAutoEnableProbeOnNewMonitors"]).toBe(true);
    expect(running!.probe.updateOneById).not.toHaveBeenCalled();
  });

  test("updates the probe whose key matches, without minting a second", async () => {
    const existingId: ObjectID = ObjectID.generate();
    running!.probe.findOneBy.mockResolvedValue({
      _id: existingId,
      id: existingId,
    } as never);

    const result: PostResult = await post(running!.origin, {
      registerProbeKey: OPERATOR_KEY,
      probeKey: "an-operator-chosen-probe-key",
      probeName: "Probe-1",
    });

    expect(result.status).toBe(200);
    expect(result.body["message"]).toBe("Probe already registered");
    expect(result.body["_id"]).toBe(existingId.toString());
    expect(running!.probe.updateOneById).toHaveBeenCalledTimes(1);
    expect(running!.probe.findBy).not.toHaveBeenCalled();
    expect(running!.probe.create).not.toHaveBeenCalled();
  });

  /*
   * A bundled probe that ran on the config.example.env key comes back under
   * the random key npm start gave it. It takes over the global probe of its
   * name whose key is a shipped value - the row it ran as, refused from then
   * on - so its id, and the monitors assigned to it, stay. A global probe
   * whose key is the installation's own is never taken over by its name.
   */
  describe("a probe coming back under a key no global probe holds", () => {
    const NEW_KEY: string = "the-new-random-probe-key-6b1f0c2d9e8a";

    function mintsWith(newId: ObjectID): void {
      running!.probe.create.mockImplementation(async (data: JSONObject) => {
        const created: JSONObject = (data as { data: JSONObject }).data;
        created["_id"] = newId;
        created["id"] = newId;
        return created;
      });
    }

    function sameNamed(
      ...rows: Array<{ key: string | null; lastAlive?: Date }>
    ): Array<ObjectID> {
      const ids: Array<ObjectID> = rows.map(() => {
        return ObjectID.generate();
      });

      running!.probe.findOneBy.mockResolvedValue(null as never);
      running!.probe.findBy.mockResolvedValue(
        rows.map(
          (each: { key: string | null; lastAlive?: Date }, index: number) => {
            return {
              _id: ids[index]!.toString(),
              id: ids[index],
              key: each.key,
              lastAlive: each.lastAlive,
            };
          },
        ) as never,
      );

      return ids;
    }

    async function register(probeName: unknown): Promise<PostResult> {
      return await post(running!.origin, {
        registerProbeKey: OPERATOR_KEY,
        probeKey: NEW_KEY,
        probeName: probeName as string,
      });
    }

    test("takes over the global probe of its name whose key is the shipped placeholder, keeping its id", async () => {
      const [existingId] = sameNamed({ key: PROBE_PLACEHOLDER });

      const result: PostResult = await register("Probe-1");

      expect(result.status).toBe(200);
      expect(result.body["message"]).toBe("Probe already registered");
      expect(result.body["_id"]).toBe(existingId!.toString());

      // The row is re-keyed in place; no second probe is created.
      expect(running!.probe.updateOneById).toHaveBeenCalledTimes(1);
      const update: JSONObject = running!.probe.updateOneById.mock
        .calls[0]![0] as JSONObject;
      expect((update["id"] as ObjectID).toString()).toBe(
        existingId!.toString(),
      );
      expect((update["data"] as JSONObject)["key"]).toBe(NEW_KEY);
      expect(running!.probe.create).not.toHaveBeenCalled();
    });

    test("looks only at the global probes of the name it presents, reading their keys", async () => {
      sameNamed({ key: PROBE_PLACEHOLDER });

      await register("Probe-2");

      expect(running!.probe.findBy).toHaveBeenCalledTimes(1);
      const findBy: JSONObject = running!.probe.findBy.mock
        .calls[0]![0] as JSONObject;
      expect(findBy["query"]).toEqual({
        name: "Probe-2",
        isGlobalProbe: true,
      });
      expect(findBy["select"]).toEqual({
        _id: true,
        key: true,
        lastAlive: true,
      });
    });

    test("never takes over a global probe of its name whose key is the installation's own: it registers a new probe", async () => {
      sameNamed({
        key: "an-operator-chosen-key-of-a-running-probe",
        lastAlive: new Date(),
      });
      const newId: ObjectID = ObjectID.generate();
      mintsWith(newId);

      const result: PostResult = await register("Probe-1");

      expect(result.status).toBe(200);
      expect(result.body["message"]).toBe("Probe registered successfully");
      expect(result.body["_id"]).toBe(newId.toString());
      expect(running!.probe.updateOneById).not.toHaveBeenCalled();
      expect(running!.probe.create).toHaveBeenCalledTimes(1);
    });

    test("of a live global probe and a dead one of its name, takes over only the dead one", async () => {
      const [, deadId] = sameNamed(
        {
          key: "an-operator-chosen-key-of-a-running-probe",
          lastAlive: new Date(),
        },
        { key: PROBE_PLACEHOLDER },
      );

      const result: PostResult = await register("Probe-1");

      expect(result.body["_id"]).toBe(deadId!.toString());
      const update: JSONObject = running!.probe.updateOneById.mock
        .calls[0]![0] as JSONObject;
      expect((update["id"] as ObjectID).toString()).toBe(deadId!.toString());
      expect(running!.probe.create).not.toHaveBeenCalled();
    });

    test("of two dead global probes of its name, takes over the one that reported in last", async () => {
      const [, newestId] = sameNamed(
        { key: "secret", lastAlive: new Date("2026-09-01T00:00:00Z") },
        { key: PROBE_PLACEHOLDER, lastAlive: new Date("2026-10-17T00:00:00Z") },
      );

      const result: PostResult = await register("Probe-1");

      expect(result.body["_id"]).toBe(newestId!.toString());
      expect(running!.probe.create).not.toHaveBeenCalled();
    });

    test("a global probe of its name that already holds the key is its own, taken over a moment ago by a replica", async () => {
      const [, ownId] = sameNamed(
        { key: PROBE_PLACEHOLDER },
        { key: NEW_KEY, lastAlive: new Date() },
      );

      const result: PostResult = await register("Probe-1");

      expect(result.body["_id"]).toBe(ownId!.toString());
      expect(running!.probe.create).not.toHaveBeenCalled();
    });

    test("registers a new probe when no global probe has its name", async () => {
      sameNamed();
      const newId: ObjectID = ObjectID.generate();
      mintsWith(newId);

      const result: PostResult = await register("Probe-1");

      expect(result.body["message"]).toBe("Probe registered successfully");
      expect(result.body["_id"]).toBe(newId.toString());
      expect(running!.probe.updateOneById).not.toHaveBeenCalled();
    });

    test.each([
      ["no name", undefined],
      ["a blank name", "   "],
      ["a name that is not text", { $ne: "" }],
      ["a list for a name", ["Probe-1"]],
    ])(
      "with %s, takes nothing over and never looks a probe up by it",
      async (_label: string, probeName: unknown) => {
        sameNamed({ key: PROBE_PLACEHOLDER });
        mintsWith(ObjectID.generate());

        await register(probeName);

        expect(running!.probe.findBy).not.toHaveBeenCalled();
        expect(running!.probe.updateOneById).not.toHaveBeenCalled();
      },
    );
  });

  test.each([
    ["an object", { $ne: "" }],
    ["a list", [OPERATOR_KEY]],
    ["a number", 12345],
    ["true", true],
  ])(
    "refuses a register key that is %s, and never reads the probe table",
    async (_label: string, presented: unknown) => {
      const result: PostResult = await post(running!.origin, {
        registerProbeKey: presented as string,
        probeKey: "an-operator-chosen-probe-key",
        probeName: "Probe-1",
      });

      expect(result.status).toBe(400);
      expect(result.body["message"]).toContain("Invalid or missing");
      expect(running!.probe.findOneBy).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an object", { $ne: "" }],
    ["a list", ["an-operator-chosen-probe-key"]],
    ["a number", 12345],
    ["true", true],
  ])(
    "refuses a probe key that is %s, and never reads the probe table",
    async (_label: string, probeKey: unknown) => {
      const result: PostResult = await post(running!.origin, {
        registerProbeKey: OPERATOR_KEY,
        probeKey: probeKey as string,
        probeName: "Probe-1",
      });

      expect(result.status).toBe(400);
      expect(running!.probe.findOneBy).not.toHaveBeenCalled();
      expect(running!.probe.create).not.toHaveBeenCalled();
    },
  );
});
