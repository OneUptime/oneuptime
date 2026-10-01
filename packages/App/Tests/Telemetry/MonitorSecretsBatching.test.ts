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
 * Regression tests for the probe-ingest MonitorSecret batching: the batch path
 * resolves a whole probe cycle's secrets with a constant number of queries,
 * and a secret only reaches a monitor its grants cover. MonitorSecretService
 * and MonitorService are mocked to count queries; VMUtil is mocked with the
 * same {{monitorSecrets.<name>}} substitution so the values that were loaded
 * can still be asserted.
 */

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
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
import MonitorService from "Common/Server/Services/MonitorService";
import Label from "Common/Models/DatabaseModels/Label";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

interface MonitorSecretServiceMock {
  findBy: jest.Mock;
}

const monitorSecretService: MonitorSecretServiceMock =
  MonitorSecretService as unknown as MonitorSecretServiceMock;

interface MonitorServiceMock {
  findBy: jest.Mock;
}

const monitorService: MonitorServiceMock =
  MonitorService as unknown as MonitorServiceMock;

const PROJECT_ID: string = "project-1";

function makeMonitor(
  id: ObjectID,
  data: { projectId?: string | undefined; labelIds?: Array<ObjectID> } = {},
): Monitor {
  const monitor: Monitor = new Monitor(id);
  monitor.projectId = new ObjectID(data.projectId || PROJECT_ID);
  monitor.labels = (data.labelIds || []).map((labelId: ObjectID) => {
    return new Label(labelId);
  });
  return monitor;
}

const MONITOR_A_ID: ObjectID = new ObjectID("monitor-a");
const MONITOR_B_ID: ObjectID = new ObjectID("monitor-b");

interface FindByArgs {
  query: { monitors?: Array<ObjectID>; projectId?: unknown };
  select: JSONObject;
  limit: number;
  skip: number;
  props: { isRoot: boolean };
}

function makeSecret(data: {
  name: string;
  secretValue: string;
  projectId?: string | undefined;
  monitors?: Array<Monitor> | undefined;
  labels?: Array<Label> | undefined;
  isAvailableToAllMonitors?: boolean | undefined;
}): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret._id = data.name;
  secret.name = data.name;
  secret.secretValue = data.secretValue;
  secret.projectId = new ObjectID(data.projectId || PROJECT_ID);
  if (data.monitors) {
    secret.monitors = data.monitors;
  }
  if (data.labels) {
    secret.labels = data.labels;
  }
  if (data.isAvailableToAllMonitors) {
    secret.isAvailableToAllMonitors = true;
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
 * Hostname and Route validation reject "{" / "}", so a secret-bearing URL is
 * built in the serialized {_type, value} shape the util JSON-stringifies.
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
    monitorService.findBy.mockResolvedValue([makeMonitor(MONITOR_A_ID)]);
  });

  describe("loadMonitorSecretsForMonitors", () => {
    test("delivers a secret to a monitor covered by any of its grants (explicit, all-monitors, label)", async () => {
      const labelId: ObjectID = new ObjectID("label-beta");
      const explicitForA: MonitorSecret = makeSecret({
        name: "apiKey",
        secretValue: "secret-a-only",
        monitors: [new Monitor(MONITOR_A_ID)],
      });
      const allMonitors: MonitorSecret = makeSecret({
        name: "allMonitors",
        secretValue: "secret-all",
        isAvailableToAllMonitors: true,
      });
      const labelSecret: MonitorSecret = makeSecret({
        name: "labelSecret",
        secretValue: "secret-label",
        labels: [new Label(labelId)],
      });

      monitorSecretService.findBy.mockResolvedValue([
        explicitForA,
        allMonitors,
        labelSecret,
      ]);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        makeMonitor(MONITOR_A_ID, { labelIds: [labelId] }),
        makeMonitor(MONITOR_B_ID),
      ]);

      expect(result.get(MONITOR_A_ID.toString())).toEqual([
        explicitForA,
        allMonitors,
        labelSecret,
      ]);

      expect(result.get(MONITOR_B_ID.toString())).toEqual([allMonitors]);
    });

    test("a secret with no grant appears nowhere", async () => {
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
        makeMonitor(MONITOR_A_ID),
        makeMonitor(MONITOR_B_ID),
      ]);

      expect(result.size).toBe(1);
      expect(result.get(MONITOR_A_ID.toString())).toEqual([attached]);

      for (const secrets of result.values()) {
        expect(secrets).not.toContain(orphanUndefined);
        expect(secrets).not.toContain(orphanEmpty);
      }
    });

    test("an all-monitors secret from another project reaches no monitor", async () => {
      const foreignSecret: MonitorSecret = makeSecret({
        name: "foreignAllMonitors",
        secretValue: "must-not-leak",
        projectId: "project-2",
        isAvailableToAllMonitors: true,
      });

      monitorSecretService.findBy.mockResolvedValue([foreignSecret]);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        makeMonitor(MONITOR_A_ID),
      ]);

      expect(result.size).toBe(0);
    });

    test("a label-scoped secret does not cross projects even when the label id is shared", async () => {
      const sharedLabelId: ObjectID = new ObjectID("shared-label");
      const foreignSecret: MonitorSecret = makeSecret({
        name: "foreignLabel",
        secretValue: "must-not-leak",
        projectId: "project-2",
        labels: [new Label(sharedLabelId)],
      });

      monitorSecretService.findBy.mockResolvedValue([foreignSecret]);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        makeMonitor(MONITOR_A_ID, { labelIds: [sharedLabelId] }),
      ]);

      expect(result.size).toBe(0);
    });

    test("the explicit-grant query carries every requested id and the monitors' project", async () => {
      await MonitorUtil.loadMonitorSecretsForMonitors([
        makeMonitor(MONITOR_A_ID),
        makeMonitor(MONITOR_B_ID),
      ]);

      const args: FindByArgs = monitorSecretService.findBy.mock
        .calls[0]![0] as FindByArgs;

      expect(args.query.monitors).toEqual([MONITOR_A_ID, MONITOR_B_ID]);
      expect(args.query.projectId).toBeDefined();

      expect(args.select).toEqual({
        secretValue: true,
        name: true,
        isAvailableToAllMonitors: true,
        projectId: true,
        monitors: {
          _id: true,
        },
        labels: {
          _id: true,
        },
      });
      expect(args.limit).toBe(LIMIT_PER_PROJECT);
      expect(args.skip).toBe(0);
      expect(args.props).toEqual({ isRoot: true });
    });

    test("issues a constant number of MonitorSecret queries however many monitors are requested", async () => {
      for (const count of [1, 20, 200]) {
        jest.clearAllMocks();
        monitorSecretService.findBy.mockResolvedValue([]);

        const monitors: Array<Monitor> = [];
        for (let i: number = 0; i < count; i++) {
          monitors.push(makeMonitor(new ObjectID(`monitor-${i}`)));
        }

        await MonitorUtil.loadMonitorSecretsForMonitors(monitors);

        // explicit + all-monitors (these monitors carry no labels).
        expect(monitorSecretService.findBy).toHaveBeenCalledTimes(2);
      }
    });

    test("empty input returns an empty map without issuing any query", async () => {
      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([]);

      expect(result.size).toBe(0);
      expect(monitorSecretService.findBy).not.toHaveBeenCalled();
      expect(monitorService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("populateSecretsInMonitorSteps memoization", () => {
    test("a monitor referencing secrets in requestHeaders AND requestBody AND monitorDestination loads them once (was 3 before the memoized promise)", async () => {
      /*
       * requestHeaders and requestBody are checked if/else-if per step, so two
       * steps are needed to exercise both.
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
        makeSecret({
          name: "apiKey",
          secretValue: "key-123",
          monitors: [new Monitor(MONITOR_A_ID)],
        }),
        makeSecret({
          name: "host",
          secretValue: "internal.example.com",
          monitors: [new Monitor(MONITOR_A_ID)],
        }),
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

      // explicit + all-monitors, not one load per secret-bearing field.
      expect(monitorSecretService.findBy).toHaveBeenCalledTimes(2);

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
       * [] means the batch found no secret for this monitor; it must not fall
       * back to a query (that would resurrect the N+1).
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

    test("without preloadedSecrets the lazy path still runs the loader's query set once", async () => {
      monitorSecretService.findBy.mockResolvedValue([
        makeSecret({
          name: "apiKey",
          secretValue: "lazy-101",
          monitors: [new Monitor(MONITOR_A_ID)],
        }),
      ]);

      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;
      monitor.monitorSteps = makeSteps([
        makeApiStep({
          requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        }),
      ]);

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor);

      // explicit + all-monitors.
      expect(monitorSecretService.findBy).toHaveBeenCalledTimes(2);

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
