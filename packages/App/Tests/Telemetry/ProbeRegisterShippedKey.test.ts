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
 *     matches is updated, and — because the deployment tool rotates a global
 *     probe's key where it shipped a placeholder — a probe of the same name
 *     is re-keyed in place (its id, and so its monitors, kept), while an
 *     ambiguous name mints a new probe.
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

  test("re-keys the one global probe of the same name, keeping its id", async () => {
    const existingId: ObjectID = ObjectID.generate();
    running!.probe.findOneBy.mockResolvedValue(null as never);
    running!.probe.findBy.mockResolvedValue([
      { _id: existingId, id: existingId },
    ] as never);

    const result: PostResult = await post(running!.origin, {
      registerProbeKey: OPERATOR_KEY,
      probeKey: "the-new-random-probe-key",
      probeName: "Probe-1",
    });

    expect(result.status).toBe(200);
    expect(result.body["message"]).toBe("Probe already registered");
    expect(result.body["_id"]).toBe(existingId.toString());

    // The existing probe is re-keyed in place; no new probe is created.
    expect(running!.probe.updateOneById).toHaveBeenCalledTimes(1);
    const update: JSONObject = running!.probe.updateOneById.mock
      .calls[0]![0] as JSONObject;
    expect((update["data"] as JSONObject)["key"]).toBe(
      "the-new-random-probe-key",
    );
    expect(running!.probe.create).not.toHaveBeenCalled();
  });

  test("mints a new probe when two global probes share the name", async () => {
    running!.probe.findOneBy.mockResolvedValue(null as never);
    running!.probe.findBy.mockResolvedValue([
      { _id: ObjectID.generate(), id: ObjectID.generate() },
      { _id: ObjectID.generate(), id: ObjectID.generate() },
    ] as never);
    const newId: ObjectID = ObjectID.generate();
    running!.probe.create.mockImplementation(async (data: JSONObject) => {
      const created: JSONObject = (data as { data: JSONObject }).data;
      created["_id"] = newId;
      created["id"] = newId;
      return created;
    });

    const result: PostResult = await post(running!.origin, {
      registerProbeKey: OPERATOR_KEY,
      probeKey: "the-new-random-probe-key",
      probeName: "Probe-1",
    });

    expect(result.status).toBe(200);
    expect(result.body["message"]).toBe("Probe registered successfully");
    expect(running!.probe.create).toHaveBeenCalledTimes(1);
    expect(running!.probe.updateOneById).not.toHaveBeenCalled();
  });
});
