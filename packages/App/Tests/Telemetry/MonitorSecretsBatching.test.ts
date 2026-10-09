import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * How probe ingest fills {{monitorSecrets.*}} placeholders before a monitor
 * or a monitor test goes out to a probe.
 *
 * Which secrets a monitor may use - all monitors, listed monitors, or
 * monitors with a label (#1467) - is MonitorSecretService's call, tested in
 * Common (MonitorSecretService.test.ts, and against Postgres in
 * MonitorSecretAccessPostgres.test.ts). What is pinned here is how this util
 * asks it:
 *
 *   1. loadMonitorSecretsForMonitors asks ONCE for a whole probe batch, and
 *      loadMonitorSecrets is the same question for one monitor;
 *   2. populateSecretsInMonitorSteps asks at most once per monitor however
 *      many fields reference a secret, and not at all when the caller
 *      preloaded the secrets - an empty preload included, which means "this
 *      monitor may use no secret", not "go and look";
 *   3. a monitor test asks with the TEST's project, so a test naming another
 *      project's monitor gets nothing, and a test of a monitor that is not
 *      saved yet asks for the secrets every monitor in its project may use.
 *
 * The service is mocked to count calls. VMUtil is mocked because the real
 * replaceValueInPlace lives next to the isolated-vm sandbox runner; the mock
 * performs the same {{monitorSecrets.<name>}} substitution from the
 * storageMap it receives, so substitution assertions still prove the secrets
 * that were loaded are the ones that got filled in.
 */

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
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
  getSecretsForMonitors: jest.Mock;
  getSecretsForUnsavedMonitor: jest.Mock;
}

const monitorSecretService: MonitorSecretServiceMock =
  MonitorSecretService as unknown as MonitorSecretServiceMock;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "a1a1a1a1-0000-4000-8000-0000000000a1",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "b1b1b1b1-0000-4000-8000-0000000000b1",
);

interface GetSecretsForMonitorsArgs {
  monitorIds: Array<ObjectID>;
  projectId?: ObjectID | undefined;
}

function makeSecret(data: {
  name: string;
  secretValue: string;
}): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = data.name;
  secret.secretValue = data.secretValue;
  return secret;
}

function secretsFor(
  entries: Array<[ObjectID, Array<MonitorSecret>]>,
): Map<string, Array<MonitorSecret>> {
  return new Map(
    entries.map(
      ([id, secrets]: [ObjectID, Array<MonitorSecret>]): [
        string,
        Array<MonitorSecret>,
      ] => {
        return [id.toString(), secrets];
      },
    ),
  );
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

function makeTest(data: {
  monitorId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  monitorType?: MonitorType | null | undefined;
  steps?: MonitorSteps | undefined;
}): MonitorTest {
  const monitorTest: MonitorTest = new MonitorTest();

  if (data.projectId) {
    monitorTest.projectId = data.projectId;
  }

  if (data.monitorId) {
    monitorTest.monitorId = data.monitorId;
  }

  // null leaves the test without a type.
  if (data.monitorType !== null) {
    monitorTest.monitorType = data.monitorType || MonitorType.API;
  }

  monitorTest.monitorSteps =
    data.steps ||
    makeSteps([
      makeApiStep({
        requestHeaders: {
          Authorization: "Bearer {{monitorSecrets.apiKey}}",
        },
      }),
    ]);
  return monitorTest;
}

function firstStep(steps: MonitorSteps | undefined): MonitorStep {
  return steps!.data!.monitorStepsInstanceArray[0]!;
}

describe("MonitorUtil secret loading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    monitorSecretService.getSecretsForMonitors.mockResolvedValue(new Map());
    monitorSecretService.getSecretsForUnsavedMonitor.mockResolvedValue([]);
  });

  describe("loadMonitorSecretsForMonitors", () => {
    test("asks the service once for the whole batch and hands back its answer", async () => {
      const answer: Map<string, Array<MonitorSecret>> = secretsFor([
        [MONITOR_A_ID, [makeSecret({ name: "apiKey", secretValue: "a" })]],
      ]);
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(answer);

      const result: Map<
        string,
        Array<MonitorSecret>
      > = await MonitorUtil.loadMonitorSecretsForMonitors([
        MONITOR_A_ID,
        MONITOR_B_ID,
      ]);

      expect(result).toBe(answer);
      expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(
        1,
      );
      expect(
        monitorSecretService.getSecretsForMonitors.mock.calls[0]![0],
      ).toEqual({
        monitorIds: [MONITOR_A_ID, MONITOR_B_ID],
      });
    });

    test("never narrows the batch to a project: probe batches span projects and each monitor brings its own", async () => {
      await MonitorUtil.loadMonitorSecretsForMonitors([MONITOR_A_ID]);

      const args: GetSecretsForMonitorsArgs = monitorSecretService
        .getSecretsForMonitors.mock.calls[0]![0] as GetSecretsForMonitorsArgs;

      expect(args.projectId).toBeUndefined();
    });
  });

  describe("loadMonitorSecrets", () => {
    test("is the batch question for one monitor", async () => {
      const secret: MonitorSecret = makeSecret({
        name: "apiKey",
        secretValue: "one",
      });
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([[MONITOR_A_ID, [secret]]]),
      );

      await expect(
        MonitorUtil.loadMonitorSecrets(MONITOR_A_ID),
      ).resolves.toEqual([secret]);
      expect(
        monitorSecretService.getSecretsForMonitors.mock.calls[0]![0],
      ).toEqual({
        monitorIds: [MONITOR_A_ID],
      });
    });

    test("a monitor with no entry may use no secret", async () => {
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [MONITOR_B_ID, [makeSecret({ name: "other", secretValue: "b" })]],
        ]),
      );

      await expect(
        MonitorUtil.loadMonitorSecrets(MONITOR_A_ID),
      ).resolves.toEqual([]);
    });
  });

  describe("populateSecretsInMonitorSteps", () => {
    test("a monitor referencing secrets in headers, body and destination loads them ONCE (was once per field)", async () => {
      const stepWithEverything: MonitorStep = makeApiStep({
        requestHeaders: {
          Authorization: "Bearer {{monitorSecrets.apiKey}}",
        },
        requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        monitorDestination: makeSecretDestination(
          "https://{{monitorSecrets.host}}/health",
        ),
      });
      const stepWithBody: MonitorStep = makeApiStep({
        requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        monitorDestination: URL.fromString("https://static.example.com/ping"),
      });

      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [
            MONITOR_A_ID,
            [
              makeSecret({ name: "apiKey", secretValue: "key-123" }),
              makeSecret({ name: "host", secretValue: "internal.example.com" }),
            ],
          ],
        ]),
      );

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([stepWithEverything, stepWithBody]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
        });

      expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(
        1,
      );

      const steps: Array<MonitorStep> =
        populated.data!.monitorStepsInstanceArray;

      expect(steps[0]!.data!.requestHeaders).toEqual({
        Authorization: "Bearer key-123",
      });
      expect(steps[0]!.data!.requestBody).toBe('{"token": "key-123"}');
      expect(steps[1]!.data!.requestBody).toBe('{"token": "key-123"}');

      const destination: JSONObject = steps[0]!.data!
        .monitorDestination as unknown as JSONObject;
      expect(destination["value"]).toBe("https://internal.example.com/health");
    });

    test("an NTP server kept in a secret is filled in before the step goes to a probe", async () => {
      const serialized: JSONObject = {
        _type: "Hostname",
        value: "{{monitorSecrets.ntpHost}}",
      };
      const step: MonitorStep = new MonitorStep();
      step.setMonitorDestination({
        ...serialized,
        toJSON: (): JSONObject => {
          return serialized;
        },
      } as unknown as URL);

      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [
            MONITOR_A_ID,
            [
              makeSecret({
                name: "ntpHost",
                secretValue: "time.internal.example.com",
              }),
            ],
          ],
        ]),
      );

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([step]),
          monitorType: MonitorType.NTP,
          monitorId: MONITOR_A_ID,
        });

      expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(
        1,
      );

      const destination: JSONObject = firstStep(populated).data!
        .monitorDestination as unknown as JSONObject;
      expect(destination["value"]).toBe("time.internal.example.com");
    });

    test("a step with a secret in its headers still gets the one in its body (it used to go out unfilled)", async () => {
      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestHeaders: {
                "X-Api-Key": "{{monitorSecrets.apiKey}}",
              },
              requestBody: '{"password": "{{monitorSecrets.password}}"}',
            }),
          ]),
          monitorType: MonitorType.API,
          preloadedSecrets: [
            makeSecret({ name: "apiKey", secretValue: "key-1" }),
            makeSecret({ name: "password", secretValue: "hunter2" }),
          ],
        });

      const step: MonitorStep = firstStep(populated);

      expect(step.data!.requestHeaders).toEqual({ "X-Api-Key": "key-1" });
      expect(step.data!.requestBody).toBe('{"password": "hunter2"}');
    });

    test("non-empty preloadedSecrets substitute placeholders with no lookup", async () => {
      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestHeaders: {
                Authorization: "Bearer {{monitorSecrets.apiKey}}",
              },
            }),
          ]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
          preloadedSecrets: [
            makeSecret({ name: "apiKey", secretValue: "preloaded-456" }),
          ],
        });

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated).data!.requestHeaders).toEqual({
        Authorization: "Bearer preloaded-456",
      });
    });

    test("EMPTY preloadedSecrets means 'this monitor may use no secret' - no lookup, placeholder left as-is", async () => {
      /*
       * The batch caller passes [] for a monitor whose steps reference
       * secrets but whose access covers none. Falling back to a lookup here
       * would resurrect the N+1; substituting nothing matches what loading
       * zero rows did.
       */
      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestHeaders: {
                Authorization: "Bearer {{monitorSecrets.apiKey}}",
              },
            }),
          ]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
          preloadedSecrets: [],
        });

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated).data!.requestHeaders).toEqual({
        Authorization: "Bearer {{monitorSecrets.apiKey}}",
      });
    });

    test("steps with no secret references cause no lookup and are returned untouched", async () => {
      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestHeaders: { Accept: "application/json" },
              requestBody: '{"plain": true}',
              monitorDestination: URL.fromString(
                "https://static.example.com/ping",
              ),
            }),
          ]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
        });

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();

      const step: MonitorStep = firstStep(populated);
      expect(step.data!.requestHeaders).toEqual({
        Accept: "application/json",
      });
      expect(step.data!.requestBody).toBe('{"plain": true}');
    });

    test("with neither a monitor nor preloaded secrets there is nothing to look up", async () => {
      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
            }),
          ]),
          monitorType: MonitorType.API,
        });

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated).data!.requestBody).toBe(
        '{"token": "{{monitorSecrets.apiKey}}"}',
      );
    });

    test("a secret the monitor may not use is left as its placeholder, never filled from elsewhere", async () => {
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [
            MONITOR_B_ID,
            [makeSecret({ name: "apiKey", secretValue: "b-only" })],
          ],
        ]),
      );

      const populated: MonitorSteps =
        await MonitorUtil.populateSecretsInMonitorSteps({
          monitorSteps: makeSteps([
            makeApiStep({
              requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
            }),
          ]),
          monitorType: MonitorType.API,
          monitorId: MONITOR_A_ID,
        });

      expect(firstStep(populated).data!.requestBody).toBe(
        '{"token": "{{monitorSecrets.apiKey}}"}',
      );
    });
  });

  describe("populateSecretsOnMonitorTest", () => {
    test("a test of a saved monitor asks for that monitor's secrets within the test's own project", async () => {
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [
            MONITOR_A_ID,
            [makeSecret({ name: "apiKey", secretValue: "test-1" })],
          ],
        ]),
      );

      const populated: MonitorTest =
        await MonitorUtil.populateSecretsOnMonitorTest(
          makeTest({ monitorId: MONITOR_A_ID, projectId: PROJECT_ID }),
        );

      expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(
        1,
      );
      expect(
        monitorSecretService.getSecretsForMonitors.mock.calls[0]![0],
      ).toEqual({
        monitorIds: [MONITOR_A_ID],
        projectId: PROJECT_ID,
      });
      expect(
        monitorSecretService.getSecretsForUnsavedMonitor,
      ).not.toHaveBeenCalled();
      expect(firstStep(populated.monitorSteps).data!.requestHeaders).toEqual({
        Authorization: "Bearer test-1",
      });
    });

    test("a test naming a monitor outside its project gets nothing (the service resolves no such monitor)", async () => {
      monitorSecretService.getSecretsForMonitors.mockImplementation(
        (args: GetSecretsForMonitorsArgs) => {
          // What the service answers when the monitor is in another project.
          return Promise.resolve(
            args.projectId?.toString() === PROJECT_ID.toString()
              ? new Map()
              : secretsFor([
                  [
                    MONITOR_B_ID,
                    [makeSecret({ name: "apiKey", secretValue: "stolen" })],
                  ],
                ]),
          );
        },
      );

      const populated: MonitorTest =
        await MonitorUtil.populateSecretsOnMonitorTest(
          makeTest({ monitorId: MONITOR_B_ID, projectId: PROJECT_ID }),
        );

      expect(firstStep(populated.monitorSteps).data!.requestHeaders).toEqual({
        Authorization: "Bearer {{monitorSecrets.apiKey}}",
      });
    });

    test("a test of a monitor that is not saved yet gets the secrets every monitor in its project may use", async () => {
      monitorSecretService.getSecretsForUnsavedMonitor.mockResolvedValue([
        makeSecret({ name: "apiKey", secretValue: "shared-2" }),
      ]);

      const populated: MonitorTest =
        await MonitorUtil.populateSecretsOnMonitorTest(
          makeTest({ monitorId: undefined, projectId: PROJECT_ID }),
        );

      expect(
        monitorSecretService.getSecretsForUnsavedMonitor,
      ).toHaveBeenCalledTimes(1);
      expect(
        monitorSecretService.getSecretsForUnsavedMonitor.mock.calls[0]![0],
      ).toEqual({ projectId: PROJECT_ID });
      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated.monitorSteps).data!.requestHeaders).toEqual({
        Authorization: "Bearer shared-2",
      });
    });

    test("a test whose steps reference no secret looks nothing up", async () => {
      const monitorTest: MonitorTest = makeTest({
        monitorId: MONITOR_A_ID,
        projectId: PROJECT_ID,
        steps: makeSteps([
          makeApiStep({ requestHeaders: { Accept: "application/json" } }),
        ]),
      });

      await MonitorUtil.populateSecretsOnMonitorTest(monitorTest);

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(
        monitorSecretService.getSecretsForUnsavedMonitor,
      ).not.toHaveBeenCalled();
    });

    test("a test without a project is returned untouched: there is no project to resolve secrets in", async () => {
      const monitorTest: MonitorTest = makeTest({
        monitorId: MONITOR_A_ID,
        projectId: undefined,
      });

      const populated: MonitorTest =
        await MonitorUtil.populateSecretsOnMonitorTest(monitorTest);

      expect(populated).toBe(monitorTest);
      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated.monitorSteps).data!.requestHeaders).toEqual({
        Authorization: "Bearer {{monitorSecrets.apiKey}}",
      });
    });

    test("a test without steps or a type is returned untouched", async () => {
      const withoutSteps: MonitorTest = new MonitorTest();
      withoutSteps.projectId = PROJECT_ID;
      withoutSteps.monitorType = MonitorType.API;

      const withoutType: MonitorTest = makeTest({
        projectId: PROJECT_ID,
        monitorType: null,
      });

      await expect(
        MonitorUtil.populateSecretsOnMonitorTest(withoutSteps),
      ).resolves.toBe(withoutSteps);
      await expect(
        MonitorUtil.populateSecretsOnMonitorTest(withoutType),
      ).resolves.toBe(withoutType);
      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(
        monitorSecretService.getSecretsForUnsavedMonitor,
      ).not.toHaveBeenCalled();
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
    test("threads preloadedSecrets through to the steps with no lookup", async () => {
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

      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
      expect(firstStep(populated.monitorSteps).data!.requestBody).toBe(
        '{"token": "threaded-789"}',
      );
    });

    test("without preloadedSecrets the lazy lookup runs once, for this monitor", async () => {
      monitorSecretService.getSecretsForMonitors.mockResolvedValue(
        secretsFor([
          [
            MONITOR_A_ID,
            [makeSecret({ name: "apiKey", secretValue: "lazy-101" })],
          ],
        ]),
      );

      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;
      monitor.monitorSteps = makeSteps([
        makeApiStep({
          requestBody: '{"token": "{{monitorSecrets.apiKey}}"}',
        }),
      ]);

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor);

      expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(
        1,
      );
      expect(
        monitorSecretService.getSecretsForMonitors.mock.calls[0]![0],
      ).toEqual({
        monitorIds: [MONITOR_A_ID],
      });
      expect(firstStep(populated.monitorSteps).data!.requestBody).toBe(
        '{"token": "lazy-101"}',
      );
    });

    test("a monitor without monitorSteps is returned as-is with no lookup", async () => {
      const monitor: Monitor = new Monitor(MONITOR_A_ID);
      monitor.monitorType = MonitorType.API;

      const populated: Monitor = await MonitorUtil.populateSecrets(monitor, [
        makeSecret({ name: "apiKey", secretValue: "unused" }),
      ]);

      expect(populated).toBe(monitor);
      expect(monitorSecretService.getSecretsForMonitors).not.toHaveBeenCalled();
    });
  });
});
