import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the probe-ingest MonitorSecret batching optimization.
 *
 * Every probe fetch cycle used to issue one MonitorSecret query PER monitor
 * (and — because populateSecretsInMonitorSteps lost its isSecretsLoaded flag
 * in 4 of its branches — up to one query PER SECRET-REFERENCING FIELD of a
 * single monitor). The fix:
 *   1. loadMonitorSecretsForMonitors: ONE findBy for a whole list of monitor
 *      ids, grouped into a Map STRICTLY by each secret's own `monitors`
 *      relation — a secret must never leak to a monitor it is not attached
 *      to, so the grouping (not the query) is the security boundary,
 *   2. populateSecretsInMonitorSteps memoizes the lazy secret load in a
 *      promise, so a monitor whose steps reference secrets in several fields
 *      issues EXACTLY ONE query (previously 3 for headers+body+destination),
 *   3. preloadedSecrets skips the query entirely — including the empty-array
 *      case, which must behave like "the DB returned zero secrets" (leave
 *      placeholders untouched), NOT fall back to a query,
 *   4. monitorStepsReferenceSecrets is the coarse pre-filter the batch path
 *      uses to decide which monitors need secrets at all.
 *
 * MonitorSecretService is mocked to count queries. VMUtil is mocked because
 * the real replaceValueInPlace lives next to the isolated-vm sandbox runner;
 * the mock performs the same {{monitorSecrets.<name>}} substitution from the
 * storageMap it receives, so substitution assertions still prove the secrets
 * that were loaded are the ones that got filled in.
 */

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
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
  };
});

/*
 * Mirrors the real VMUtil.replaceValueInPlace contract the util relies on:
 * objects are stringified before substitution and parsed back after, and
 * every {{monitorSecrets.<name>}} placeholder is replaced from the
 * storageMap. Placeholders whose name is not in the map are left as-is.
 */
jest.mock("Common/Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: {
      replaceValueInPlace: jest.fn(
        (
          storageMap: JSONObject,
          valueToReplaceInPlace: string,
          _isJSON: boolean | undefined,
        ): string | JSONObject => {
          let value: string = valueToReplaceInPlace;
          let didStringify: boolean = false;

          if (typeof value === "object") {
            value = JSON.stringify(value);
            didStringify = true;
          }

          const secrets: JSONObject =
            (storageMap["monitorSecrets"] as JSONObject) || {};

          for (const secretName of Object.keys(secrets)) {
            value = value
              .split(`{{monitorSecrets.${secretName}}}`)
              .join(String(secrets[secretName]));
          }

          return didStringify ? (JSON.parse(value) as JSONObject) : value;
        },
      ),
    },
  };
});

import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

interface MonitorSecretServiceMock {
  findBy: jest.Mock;
}

const monitorSecretService: MonitorSecretServiceMock =
  MonitorSecretService as unknown as MonitorSecretServiceMock;

const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");
const MONITOR_C_ID: ObjectID = new ObjectID("monitor-c");

interface FindByArgs {
  query: { monitors: Array<ObjectID> };
  select: JSONObject;
  limit: number;
  skip: number;
  props: { isRoot: boolean };
}

function makeSecret(data: {
  name: string;
  secretValue: string;
  monitors?: Array<Monitor> | undefined;
}): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = data.name;
  secret.secretValue = data.secretValue;
  if (data.monitors) {
    secret.monitors = data.monitors;
  }
  return secret;
}

function makeApiStep(data: {
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | undefined;
  monitorDestination?: URL | undefined;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  if (data.requestHeaders) {
    step.setRequestHeaders(data.requestHeaders);
  }

  if (data.requestBody) {
    step.setRequestBody(data.requestBody);
  }

  if (data.monitorDestination) {
    step.setMonitorDestination(data.monitorDestination);
  }

  return step;
}

/*
 * URL.fromString cannot carry a {{monitorSecrets.*}} placeholder — Hostname
 * and Route validation both reject "{" / "}" — so a secret-bearing
 * destination is built in its serialized {_type, value} shape, which is all
 * the util ever looks at (it JSON-stringifies the destination to detect and
 * substitute secrets).
 */
function makeSecretDestination(urlTemplate: string): URL {
  const serialized: JSONObject = { _type: "URL", value: urlTemplate };

  return {
    ...serialized,
    toJSON: (): JSONObject => {
      return serialized;
    },
  } as unknown as URL;
}

function makeSteps(steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  return monitorSteps;
}

describe("MonitorUtil secret batching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    monitorSecretService.findBy.mockResolvedValue([]);
  });

  describe("loadMonitorSecretsForMonitors", () => {
    test("groups secrets strictly by each secret's own monitors relation", async () => {
      const secretForAOnly: MonitorSecret = makeSecret({
        name: "apiKey",
        secretValue: "secret-a-only",
        monitors: [new Monitor(MONITOR_A_ID)],
      });
      const sharedSecret: MonitorSecret = makeSecret({
        name: "sharedToken",
        secretValue: "secret-shared",
        monitors: [new Monitor(MONITOR_A_ID), new Monitor(MONITOR_B_ID)],
      });

      monitorSecretService.findBy.mockResolvedValue([
        secretForAOnly,
        sharedSecret,
      ]);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        MONITOR_A_ID,
        MONITOR_B_ID,
        MONITOR_C_ID,
      ]);

      expect(result.get(MONITOR_A_ID.toString())).toEqual([
        secretForAOnly,
        sharedSecret,
      ]);
      expect(result.get(MONITOR_B_ID.toString())).toEqual([sharedSecret]);

      // monitor-c requested secrets but none are attached to it: no entry.
      expect(result.has(MONITOR_C_ID.toString())).toBe(false);
      expect(result.size).toBe(2);
    });

    test("a secret with an empty or missing monitors relation appears nowhere (never leaks to unattached monitors)", async () => {
      const orphanUndefined: MonitorSecret = makeSecret({
        name: "orphanUndefined",
        secretValue: "must-not-leak-1",
        monitors: undefined,
      });
      const orphanEmpty: MonitorSecret = makeSecret({
        name: "orphanEmpty",
        secretValue: "must-not-leak-2",
        monitors: [],
      });
      const attached: MonitorSecret = makeSecret({
        name: "attached",
        secretValue: "ok",
        monitors: [new Monitor(MONITOR_A_ID)],
      });

      monitorSecretService.findBy.mockResolvedValue([
        orphanUndefined,
        orphanEmpty,
        attached,
      ]);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        MONITOR_A_ID,
        MONITOR_B_ID,
      ]);

      expect(result.size).toBe(1);
      expect(result.get(MONITOR_A_ID.toString())).toEqual([attached]);

      // Security invariant: the orphan secrets are in NO bucket at all.
      for (const secrets of result.values()) {
        expect(secrets).not.toContain(orphanUndefined);
        expect(secrets).not.toContain(orphanEmpty);
      }
    });

    test("issues exactly ONE findBy for the whole id list, selecting monitors._id for grouping", async () => {
      await MonitorUtil.loadMonitorSecretsForMonitors([
        MONITOR_A_ID,
        MONITOR_B_ID,
      ]);

      expect(monitorSecretService.findBy).toHaveBeenCalledTimes(1);

      const args: FindByArgs = monitorSecretService.findBy.mock
        .calls[0]![0] as FindByArgs;

      // QueryHelper.inRelationArray of ALL requested ids in one query.
      expect(args.query.monitors).toEqual([MONITOR_A_ID, MONITOR_B_ID]);

      // The monitors relation _id is what the map is keyed by - it must be selected.
      expect(args.select).toEqual({
        secretValue: true,
        name: true,
        monitors: {
          _id: true,
        },
      });
      expect(args.limit).toBe(LIMIT_PER_PROJECT);
      expect(args.skip).toBe(0);
      expect(args.props).toEqual({ isRoot: true });
    });

    test("empty monitorIds input returns an empty map without issuing any query", async () => {
      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([]);

      expect(result.size).toBe(0);
      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("populateSecretsInMonitorSteps memoization", () => {
    test("a monitor referencing secrets in requestHeaders AND requestBody AND monitorDestination issues EXACTLY ONE query (was 3 before the memoized promise)", async () => {
      /*
       * requestHeaders/requestBody are checked in an if/else-if per step, so
       * two steps are used to exercise BOTH fields; the destination check is
       * a separate loop, so the pre-fix code issued one query per branch.
       */
      const stepWithHeadersAndDestination: MonitorStep = makeApiStep({
        requestHeaders: {
          Authorization: "Bearer {{monitorSecrets.apiKey}}",
        },
        monitorDestination: makeSecretDestination(
          "https://{{monitorSecrets.host}}/health",
        ),
      });
      const stepWithBody: MonitorStep = makeApiStep({
        requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        monitorDestination: URL.fromString("https://static.example.com/ping"),
      });

      monitorSecretService.findBy.mockResolvedValue([
        makeSecret({ name: "apiKey", secretValue: "key-123" }),
        makeSecret({ name: "host", secretValue: "internal.example.com" }),
      ]);

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            stepWithHeadersAndDestination,
            stepWithBody,
          ]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
        });

      // THE regression this change removed: one query per secret-bearing field.
      expect(monitorSecretService.findBy).toHaveBeenCalledTimes(1);

      const steps: Array<MonitorStep> =
        populated.data!.monitorStepsInstanceArray;

      expect(steps[0]!.data!.requestHeaders).toEqual({
        Authorization: "Bearer key-123",
      });
      expect(steps[1]!.data!.requestBody).toBe('{"token": "key-123"}');

      const destination: JSONObject = steps[0]!.data!
        .monitorDestination as unknown as JSONObject;
      expect(destination["value"]).toBe("https://internal.example.com/health");
    });

    test("non-empty preloadedSecrets substitute placeholders with ZERO queries", async () => {
      const step: MonitorStep = makeApiStep({
        requestHeaders: {
          Authorization: "Bearer {{monitorSecrets.apiKey}}",
        },
      });

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([step]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
          preloadedSecrets: [
            makeSecret({ name: "apiKey", secretValue: "preloaded-456" }),
          ],
        });

      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
      expect(
        populated.data!.monitorStepsInstanceArray[0]!.data!.requestHeaders,
      ).toEqual({
        Authorization: "Bearer preloaded-456",
      });
    });

    test("EMPTY preloadedSecrets array means 'zero secrets exist' - no query, placeholder left as-is", async () => {
      /*
       * The batch caller passes [] for a monitor whose steps reference
       * secrets but where no secret is attached. Falling back to a query
       * here would resurrect the N+1; substituting nothing matches what
       * loading zero rows from the DB did before.
       */
      const step: MonitorStep = makeApiStep({
        requestHeaders: {
          Authorization: "Bearer {{monitorSecrets.apiKey}}",
        },
      });

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([step]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
          preloadedSecrets: [],
        });

      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
      expect(
        populated.data!.monitorStepsInstanceArray[0]!.data!.requestHeaders,
      ).toEqual({
        Authorization: "Bearer {{monitorSecrets.apiKey}}",
      });
    });

    test("steps with no secret references issue zero queries and are returned untouched", async () => {
      const step: MonitorStep = makeApiStep({
        requestHeaders: { Accept: "application/json" },
        requestBody: '{"plain": true}',
        monitorDestination: URL.fromString("https://static.example.com/ping"),
      });

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([step]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
        });

      expect(monitorSecretService.findBy).not.toHaveBeenCalled();

      const populatedStep: MonitorStep =
        populated.data!.monitorStepsInstanceArray[0]!;
      expect(populatedStep.data!.requestHeaders).toEqual({
        Accept: "application/json",
      });
      expect(populatedStep.data!.requestBody).toBe('{"plain": true}');
    });
  });

  describe("monitorStepsReferenceSecrets", () => {
    test("true when any step field contains a monitorSecrets reference", () => {
      const stepsWithSecretInBody: MonitorSteps = makeSteps([
        makeApiStep({
          requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        }),
      ]);
      const stepsWithSecretInDestination: MonitorSteps = makeSteps([
        makeApiStep({
          monitorDestination: makeSecretDestination(
            "https://{{monitorSecrets.host}}/health",
          ),
        }),
      ]);

      expect(
        MonitorUtil.monitorStepsReferenceSecrets(stepsWithSecretInBody),
      ).toBe(true);
      expect(
        MonitorUtil.monitorStepsReferenceSecrets(stepsWithSecretInDestination),
      ).toBe(true);
    });

    test("false when no step field references a secret", () => {
      const plainSteps: MonitorSteps = makeSteps([
        makeApiStep({
          requestHeaders: { Accept: "application/json" },
          requestBody: '{"plain": true}',
          monitorDestination: URL.fromString("https://static.example.com"),
        }),
      ]);

      expect(MonitorUtil.monitorStepsReferenceSecrets(plainSteps)).toBe(false);
    });
  });

  describe("populateSecrets (monitor-level entry point)", () => {
    test("threads preloadedSecrets through to the steps with zero queries", async () => {
      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;
      monitor.monitorSteps = makeSteps([
        makeApiStep({
          requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        }),
      ]);

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor, [
        makeSecret({ name: "apiKey", secretValue: "threaded-789" }),
      ]);

      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
      expect(
        populated.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
          .requestBody,
      ).toBe('{"token": "threaded-789"}');
    });

    test("without preloadedSecrets the lazy per-monitor query still runs exactly once", async () => {
      monitorSecretService.findBy.mockResolvedValue([
        makeSecret({ name: "apiKey", secretValue: "lazy-101" }),
      ]);

      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;
      monitor.monitorSteps = makeSteps([
        makeApiStep({
          requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        }),
      ]);

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor);

      expect(monitorSecretService.findBy).toHaveBeenCalledTimes(1);

      const lazyArgs: FindByArgs = monitorSecretService.findBy.mock
        .calls[0]![0] as FindByArgs;
      expect(lazyArgs.query.monitors).toEqual([MONITOR_A_ID]);

      expect(
        populated.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
          .requestBody,
      ).toBe('{"token": "lazy-101"}');
    });

    test("a monitor without monitorSteps is returned as-is with no query", async () => {
      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor, [
        makeSecret({ name: "apiKey", secretValue: "unused" }),
      ]);

      expect(populated).toBe(monitor);
      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
    });
  });
});
