import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

// Substitution only: the sandbox runner, the logger and tracing are not needed.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
    },
  };
});

import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import {
  TotpAlgorithm,
  TotpParameters,
} from "Common/Utils/Totp/TotpParameters";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

/*
 * How the server hands a probe a monitor that references a one-time code
 * (TOTP) secret (issue #9703).
 *
 * A TOTP secret's value is a seed, and the seed is never written into the
 * monitor: every {{monitorSecrets.NAME}} that names one is left as written,
 * Text secrets around it are filled in as before, and the step carries the
 * parameters the probe makes the code from (MonitorStep.totpSecrets) - only
 * for the fields the probe makes codes in (an API step's URL, headers and
 * body; a Synthetic or Custom JavaScript Code step's script) and only for
 * the secrets the monitor may use. A script that asks with
 * oneuptime.getTotpCode("NAME") gets the secrets it names in quotes.
 *
 * The secret loading itself (which secrets a monitor may use) is
 * MonitorSecretService's, mocked here; the substitution is the real
 * VMUtil's.
 */

interface MonitorSecretServiceMock {
  getSecretsForMonitors: Mock<
    typeof MonitorSecretService.getSecretsForMonitors
  >;
  getSecretsForUnsavedMonitor: Mock<
    typeof MonitorSecretService.getSecretsForUnsavedMonitor
  >;
}

const monitorSecretService: MonitorSecretServiceMock =
  MonitorSecretService as unknown as MonitorSecretServiceMock;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "a1a1a1a1-0000-4000-8000-0000000000a1",
);

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const OTHER_SEED: string = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const LOGIN_PARAMETERS: TotpParameters = {
  secret: SEED,
  algorithm: TotpAlgorithm.SHA256,
  digits: 8,
  periodInSeconds: 60,
};

function totpSecret(name: string, seed: string = SEED): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = name;
  secret.secretType = MonitorSecretType.TOTP;
  secret.secretValue =
    seed === SEED
      ? `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA256&digits=8&period=60`
      : `otpauth://totp/OneUptime?secret=${seed}&algorithm=SHA1&digits=6&period=30`;
  return secret;
}

function textSecret(name: string, value: string): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = name;
  secret.secretValue = value;
  // A secret read before the column existed has no type: it is Text.
  return secret;
}

const SECRETS: Array<MonitorSecret> = [
  totpSecret("LoginCode"),
  totpSecret("OtherCode", OTHER_SEED),
  textSecret("ApiKey", "sk_live_123"),
];

/*
 * Hostname and Route validation reject "{" / "}", so a secret-bearing URL is
 * built in the serialized {_type, value} shape the util JSON-stringifies.
 */
function secretDestination(urlTemplate: string): URL {
  const serialized: JSONObject = { _type: "URL", value: urlTemplate };

  return {
    ...serialized,
    toJSON: (): JSONObject => {
      return serialized;
    },
    toString: (): string => {
      return urlTemplate;
    },
  } as unknown as URL;
}

function apiStep(data: {
  headers?: Dictionary<string>;
  body?: string;
  url?: string;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  if (data.headers) {
    step.setRequestHeaders(data.headers);
  }

  if (data.body) {
    step.setRequestBody(data.body);
  }

  if (data.url) {
    step.setMonitorDestination(secretDestination(data.url));
  }

  return step;
}

function scriptStep(customCode: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setCustomCode(customCode);
  return step;
}

function steps(...items: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(items);
  return monitorSteps;
}

async function populate(
  monitorSteps: MonitorSteps,
  monitorType: MonitorType,
  secrets: Array<MonitorSecret> = SECRETS,
): Promise<MonitorStep> {
  const populated: MonitorSteps =
    await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps,
      monitorType,
      preloadedSecrets: secrets,
    });

  return populated.data!.monitorStepsInstanceArray[0]!;
}

/*
 * A step's URL as text. Filled in, the destination is the JSON form the
 * filling parsed back, {_type, value}, as it is handed to the probe.
 */
function destinationOf(step: MonitorStep): string {
  const destination: unknown = step.data!.monitorDestination;

  return (destination as { value?: string }).value ?? String(destination);
}

// The step as the probe gets it, without the parameters it carries.
function fieldsOf(step: MonitorStep): string {
  const json: JSONObject = step.toJSON();
  const value: JSONObject = { ...(json["value"] as JSONObject) };

  delete value["totpSecrets"];

  return JSON.stringify(value);
}

beforeEach(() => {
  jest.clearAllMocks();
  monitorSecretService.getSecretsForMonitors.mockResolvedValue(
    new Map([[MONITOR_ID.toString(), SECRETS]]),
  );
  monitorSecretService.getSecretsForUnsavedMonitor.mockResolvedValue(SECRETS);
});

describe("an API step that references a one-time code secret", () => {
  test("keeps the reference, fills the Text secrets beside it, and carries the parameters", async () => {
    const step: MonitorStep = await populate(
      steps(
        apiStep({
          url: "https://api.example.com/verify?otp={{monitorSecrets.LoginCode}}",
          headers: {
            "X-OTP": "{{monitorSecrets.LoginCode}}",
            Authorization: "Bearer {{monitorSecrets.ApiKey}}",
          },
          body: '{"otp":"{{monitorSecrets.LoginCode}}","key":"{{monitorSecrets.ApiKey}}"}',
        }),
      ),
      MonitorType.API,
    );

    expect(destinationOf(step)).toBe(
      "https://api.example.com/verify?otp={{monitorSecrets.LoginCode}}",
    );
    expect(step.data!.requestHeaders).toEqual({
      "X-OTP": "{{monitorSecrets.LoginCode}}",
      Authorization: "Bearer sk_live_123",
    });
    expect(step.data!.requestBody).toBe(
      '{"otp":"{{monitorSecrets.LoginCode}}","key":"sk_live_123"}',
    );
    expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN_PARAMETERS });
  });

  test("never writes a seed into a field", async () => {
    const step: MonitorStep = await populate(
      steps(
        apiStep({
          headers: { "X-OTP": "{{monitorSecrets.LoginCode}}" },
          body: '{"otp":"{{monitorSecrets.OtherCode}}"}',
        }),
      ),
      MonitorType.API,
    );

    expect(fieldsOf(step)).not.toContain(SEED);
    expect(fieldsOf(step)).not.toContain(OTHER_SEED);
    expect(fieldsOf(step)).not.toContain("otpauth");
    expect(Object.keys(step.data!.totpSecrets!).sort()).toEqual([
      "LoginCode",
      "OtherCode",
    ]);
  });

  test("carries only the one-time code secrets it references", async () => {
    const step: MonitorStep = await populate(
      steps(apiStep({ headers: { "X-OTP": "{{monitorSecrets.LoginCode}}" } })),
      MonitorType.API,
    );

    expect(Object.keys(step.data!.totpSecrets!)).toEqual(["LoginCode"]);
  });

  test("carries nothing for a one-time code secret the monitor may not use", async () => {
    const step: MonitorStep = await populate(
      steps(apiStep({ headers: { "X-OTP": "{{monitorSecrets.LoginCode}}" } })),
      MonitorType.API,
      [textSecret("ApiKey", "sk")],
    );

    expect(step.data!.requestHeaders).toEqual({
      "X-OTP": "{{monitorSecrets.LoginCode}}",
    });
    expect(step.data!.totpSecrets).toBeUndefined();
  });

  test("never takes text a Text secret's value carries for a reference", async () => {
    const step: MonitorStep = await populate(
      steps(apiStep({ headers: { "X-Note": "{{monitorSecrets.Note}}" } })),
      MonitorType.API,
      [textSecret("Note", "see {{monitorSecrets.LoginCode}}"), ...SECRETS],
    );

    expect(step.data!.requestHeaders).toEqual({
      "X-Note": "see {{monitorSecrets.LoginCode}}",
    });
    expect(step.data!.totpSecrets).toBeUndefined();
  });

  test("gives no code for a stored value that cannot be read", async () => {
    const broken: MonitorSecret = totpSecret("LoginCode");
    broken.secretValue = "not a seed!";

    const step: MonitorStep = await populate(
      steps(apiStep({ headers: { "X-OTP": "{{monitorSecrets.LoginCode}}" } })),
      MonitorType.API,
      [broken],
    );

    expect(step.data!.totpSecrets).toBeUndefined();
    expect(fieldsOf(step)).not.toContain("not a seed!");
  });

  test("clears parameters a step already carried, whoever put them there", async () => {
    const step: MonitorStep = apiStep({ headers: { Accept: "x" } });
    step.data!.totpSecrets = { Forged: LOGIN_PARAMETERS };

    const populated: MonitorStep = await populate(steps(step), MonitorType.API);

    expect(populated.data!.totpSecrets).toBeUndefined();
  });
});

describe.each([MonitorType.SyntheticMonitor, MonitorType.CustomJavaScriptCode])(
  "a %s script",
  (monitorType: MonitorType) => {
    test("keeps a reference to a one-time code secret for the probe to fill", async () => {
      const step: MonitorStep = await populate(
        steps(
          scriptStep(
            'await page.fill("#otp", "{{monitorSecrets.LoginCode}}");\nawait page.fill("#key", "{{monitorSecrets.ApiKey}}");',
          ),
        ),
        monitorType,
      );

      expect(step.data!.customCode).toBe(
        'await page.fill("#otp", "{{monitorSecrets.LoginCode}}");\nawait page.fill("#key", "sk_live_123");',
      );
      expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN_PARAMETERS });
    });

    test("that asks with oneuptime.getTotpCode gets the secrets it names in quotes", async () => {
      const step: MonitorStep = await populate(
        steps(
          scriptStep(
            'const code = await oneuptime.getTotpCode("LoginCode");\nawait page.fill("#otp", code);',
          ),
        ),
        monitorType,
      );

      expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN_PARAMETERS });
      expect(step.data!.customCode).not.toContain(SEED);
    });

    test("that names no secret in quotes gets none", async () => {
      const step: MonitorStep = await populate(
        steps(scriptStep("const code = await oneuptime.getTotpCode(name);")),
        monitorType,
      );

      expect(step.data!.totpSecrets).toBeUndefined();
    });
  },
);

describe("fields that take no one-time code", () => {
  test("keep the reference as written and carry nothing", async () => {
    const website: MonitorStep = await populate(
      steps(
        apiStep({
          url: "https://example.com/?otp={{monitorSecrets.LoginCode}}&k={{monitorSecrets.ApiKey}}",
        }),
      ),
      MonitorType.Website,
    );

    expect(destinationOf(website)).toBe(
      "https://example.com/?otp={{monitorSecrets.LoginCode}}&k=sk_live_123",
    );
    expect(website.data!.totpSecrets).toBeUndefined();
    expect(fieldsOf(website)).not.toContain(SEED);
  });
});

/*
 * Regression: a destination with a secret filled in came back as the JSON
 * the filling parsed, {_type, value}, which has no toJSON - so writing the
 * monitor for the probe threw, and the probe's whole batch went unchecked.
 */
describe("a destination with a secret filled in", () => {
  function monitorWith(
    monitorType: MonitorType,
    destination: URL | Hostname,
  ): Monitor {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(destination);

    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.monitorType = monitorType;
    monitor.monitorSteps = steps(step);

    return monitor;
  }

  function sentToProbe(monitor: Monitor): MonitorStep {
    const json: JSONObject = JSON.parse(
      JSON.stringify(BaseModel.toJSON(monitor, Monitor)),
    );
    const read: Monitor = BaseModel.fromJSON(json, Monitor) as Monitor;

    return read.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
  }

  test.each([MonitorType.API, MonitorType.Website, MonitorType.SSLCertificate])(
    "is still a URL, and a %s monitor can be written for the probe",
    async (monitorType: MonitorType) => {
      const monitor: Monitor = monitorWith(
        monitorType,
        URL.fromString(
          "https://example.com/health?key={{monitorSecrets.ApiKey}}",
        ),
      );

      await MonitorUtil.populateSecrets(monitor, SECRETS);

      const destination: unknown =
        monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
          .monitorDestination;

      expect(destination).toBeInstanceOf(URL);
      expect(sentToProbe(monitor).data!.monitorDestination!.toString()).toBe(
        "https://example.com/health?key=sk_live_123",
      );
    },
  );

  test("keeps a one-time code reference in a URL, and the monitor can still be written", async () => {
    const monitor: Monitor = monitorWith(
      MonitorType.API,
      URL.fromString(
        "https://api.example.com/verify?otp={{monitorSecrets.LoginCode}}",
      ),
    );

    await MonitorUtil.populateSecrets(monitor, SECRETS);

    const step: MonitorStep = sentToProbe(monitor);

    expect(step.data!.monitorDestination!.toString()).toBe(
      "https://api.example.com/verify?otp={{monitorSecrets.LoginCode}}",
    );
    expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN_PARAMETERS });
  });

  test("is still a Hostname for a host monitor", async () => {
    const monitor: Monitor = monitorWith(
      MonitorType.Ping,
      new Hostname("example.com"),
    );
    (
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data! as {
        monitorDestination: unknown;
      }
    ).monitorDestination = {
      _type: "Hostname",
      value: "{{monitorSecrets.Host}}",
      toJSON: (): JSONObject => {
        return { _type: "Hostname", value: "{{monitorSecrets.Host}}" };
      },
    };

    await MonitorUtil.populateSecrets(monitor, [
      textSecret("Host", "db.internal.example.com"),
    ]);

    expect(sentToProbe(monitor).data!.monitorDestination).toEqual(
      new Hostname("db.internal.example.com"),
    );
  });

  test("keeps the configured destination when the filled one is no host at all", async () => {
    const monitor: Monitor = monitorWith(
      MonitorType.Ping,
      new Hostname("example.com"),
    );
    const configured: JSONObject = {
      _type: "Hostname",
      value: "{{monitorSecrets.Host}}",
    };
    (
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data! as {
        monitorDestination: unknown;
      }
    ).monitorDestination = {
      ...configured,
      toJSON: (): JSONObject => {
        return configured;
      },
    };

    await MonitorUtil.populateSecrets(monitor, [
      textSecret("Host", "not a host name!"),
    ]);

    expect(() => {
      return BaseModel.toJSON(monitor, Monitor);
    }).not.toThrow();
  });
});

describe("loading the secrets a script asks for", () => {
  test("counts a script that only asks with oneuptime.getTotpCode as needing secrets", () => {
    expect(
      MonitorUtil.monitorStepsReferenceSecrets(
        steps(scriptStep('await oneuptime.getTotpCode("LoginCode");')),
      ),
    ).toBe(true);
    expect(
      MonitorUtil.monitorStepsReferenceSecrets(
        steps(scriptStep('await page.goto("https://example.com");')),
      ),
    ).toBe(false);
  });

  test("loads a monitor's secrets for a script that only asks with oneuptime.getTotpCode", async () => {
    const populated: MonitorSteps =
      await MonitorUtil.populateSecretsInMonitorSteps({
        monitorSteps: steps(
          scriptStep('const code = await oneuptime.getTotpCode("LoginCode");'),
        ),
        monitorType: MonitorType.SyntheticMonitor,
        monitorId: MONITOR_ID,
      });

    expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(1);
    expect(
      populated.data!.monitorStepsInstanceArray[0]!.data!.totpSecrets,
    ).toEqual({ LoginCode: LOGIN_PARAMETERS });
  });

  test("fills a monitor test whose script only asks with oneuptime.getTotpCode", async () => {
    const monitorTest: MonitorTest = new MonitorTest();
    monitorTest.projectId = PROJECT_ID;
    monitorTest.monitorType = MonitorType.SyntheticMonitor;
    monitorTest.monitorSteps = steps(
      scriptStep('await oneuptime.getTotpCode("LoginCode");'),
    );

    const populated: MonitorTest =
      await MonitorUtil.populateSecretsOnMonitorTest(monitorTest);

    expect(
      monitorSecretService.getSecretsForUnsavedMonitor,
    ).toHaveBeenCalledTimes(1);
    expect(
      populated.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
        .totpSecrets,
    ).toEqual({ LoginCode: LOGIN_PARAMETERS });
  });
});
