import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

// Substitution only: the sandbox runner and tracing are not needed.
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

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import logger from "Common/Server/Utils/Logger";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorRequestBody, {
  MonitorRequestBodyReading,
} from "Common/Utils/Monitor/MonitorRequestBody";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

/*
 * THE SERVER FILLS A MONITOR SECRET INTO AN API MONITOR'S BODY AS ITS PLACE
 * NEEDS IT (#10735).
 *
 * MonitorUtil.populateSecretsInMonitorSteps filled {{monitorSecrets.NAME}}
 * into a body as plain text, so a password ab"c in {"password":
 * "{{monitorSecrets.Password}}"} became {"password": "ab"c"}: no JSON, and
 * since #9737 the probe fails such a check at once, sending nothing. A
 * secret inside a JSON string is now escaped for it; one on its own is
 * still written as it is. The headers and the URL take a secret's value as
 * it is, as they always did. A monitor's check and a Test Monitor run are
 * filled the same way, and no value is ever logged.
 *
 * The secret loading (which secrets a monitor may use) is
 * MonitorSecretService's, mocked here; the filling is the real one.
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
  "bbbbbbbb-0000-4000-8000-00000000000b",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "b1b1b1b1-0000-4000-8000-0000000000b1",
);

// Values that ended a string, or made one no JSON, written as they were.
const PASSWORD: string = 'p"a\\ss\nwörd 😀';
const TOKEN: string = 'tok"en\\';
const NOTE: string = "line one\nline two\t\u0007";

function textSecret(name: string, value: string): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = name;
  secret.secretValue = value;
  secret.secretType = MonitorSecretType.Text;
  return secret;
}

function totpSecret(name: string): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = name;
  secret.secretType = MonitorSecretType.TOTP;
  secret.secretValue =
    "otpauth://totp/OneUptime?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=6&period=30";
  return secret;
}

const SECRETS: Array<MonitorSecret> = [
  textSecret("Password", PASSWORD),
  textSecret("Token", TOKEN),
  textSecret("Note", NOTE),
  textSecret("Ids", "1,2,3"),
  textSecret("Count", "42"),
  textSecret("Filter", '{"region": "eu"}'),
  totpSecret("LoginCode"),
];

// Every value a test here fills in, which no log line may hold.
const VALUES: ReadonlyArray<string> = [PASSWORD, TOKEN, NOTE];

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
  body?: string;
  headers?: Dictionary<string>;
  url?: string;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  if (data.body !== undefined) {
    step.setRequestBody(data.body);
  }

  if (data.headers) {
    step.setRequestHeaders(data.headers);
  }

  if (data.url) {
    step.setMonitorDestination(secretDestination(data.url));
  }

  return step;
}

function steps(...items: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(items);
  return monitorSteps;
}

async function populate(
  step: MonitorStep,
  secrets: Array<MonitorSecret> = SECRETS,
): Promise<MonitorStep> {
  const populated: MonitorSteps =
    await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps: steps(step),
      monitorType: MonitorType.API,
      preloadedSecrets: secrets,
    });

  return populated.data!.monitorStepsInstanceArray[0]!;
}

// The value a step's filled body holds, as the probe sends it.
function sentValue(step: MonitorStep): unknown {
  const reading: MonitorRequestBodyReading = MonitorRequestBody.read(
    step.data!.requestBody as string,
  );

  expect(reading.isJson).toBe(true);

  return reading.isJson ? reading.value : undefined;
}

// Everything the logger was handed, as text.
function everythingLogged(): string {
  return [logger.error, logger.debug, logger.info, logger.warn]
    .map((method: unknown) => {
      return JSON.stringify((method as Mock<() => void>).mock.calls);
    })
    .join("\n");
}

beforeEach(() => {
  jest.clearAllMocks();
  monitorSecretService.getSecretsForMonitors.mockResolvedValue(
    new Map([[MONITOR_ID.toString(), SECRETS]]),
  );
  monitorSecretService.getSecretsForUnsavedMonitor.mockResolvedValue(SECRETS);
});

describe("a secret inside a string of a JSON body", () => {
  test("is escaped for the string: the issue's password reaches the API exactly", async () => {
    const step: MonitorStep = await populate(
      apiStep({ body: '{"password": "{{monitorSecrets.Password}}"}' }),
    );

    expect(step.data!.requestBody).toBe(
      `{"password": ${JSON.stringify(PASSWORD)}}`,
    );
    expect(sentValue(step)).toEqual({ password: PASSWORD });
  });

  test("so is every one of an array body, as a key and as a value", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        body: '[{"auth": "Bearer {{monitorSecrets.Token}}"}, {"{{monitorSecrets.Note}}": "{{monitorSecrets.Password}}"}]',
      }),
    );

    expect(sentValue(step)).toEqual([
      { auth: `Bearer ${TOKEN}` },
      { [NOTE]: PASSWORD },
    ]);
  });

  test("in a JSON5 body, in single quotes too", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        body: "{user: 'ops', password: '{{monitorSecrets.Password}}', note: \"{{monitorSecrets.Note}}\",}",
      }),
    );

    expect(sentValue(step)).toEqual({
      user: "ops",
      password: PASSWORD,
      note: NOTE,
    });
  });
});

describe("a secret on its own in a JSON body", () => {
  test("is written as it is: a fragment, a number, JSON of its own", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        body: '{"ids": [{{monitorSecrets.Ids}}], "count": {{monitorSecrets.Count}}, "filter": {{monitorSecrets.Filter}}, "password": "{{monitorSecrets.Password}}"}',
      }),
    );

    expect(sentValue(step)).toEqual({
      ids: [1, 2, 3],
      count: 42,
      filter: { region: "eu" },
      password: PASSWORD,
    });
  });

  test("the whole body", async () => {
    const step: MonitorStep = await populate(
      apiStep({ body: "{{monitorSecrets.Filter}}" }),
    );

    expect(step.data!.requestBody).toBe('{"region": "eu"}');
  });
});

describe("what is left for the probe, and what is left alone", () => {
  test("a one-time code secret's reference is left as written, its parameters beside the step", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        body: '{"otp": "{{monitorSecrets.LoginCode}}", "password": "{{monitorSecrets.Password}}"}',
      }),
    );

    expect(step.data!.requestBody).toBe(
      `{"otp": "{{monitorSecrets.LoginCode}}", "password": ${JSON.stringify(PASSWORD)}}`,
    );
    expect(Object.keys(step.data!.totpSecrets || {})).toEqual(["LoginCode"]);
  });

  test("a secret the monitor may not use is left as written", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        body: '{"password": "{{monitorSecrets.Password}}", "token": "{{monitorSecrets.Token}}"}',
      }),
      [textSecret("Token", TOKEN)],
    );

    expect(sentValue(step)).toEqual({
      password: "{{monitorSecrets.Password}}",
      token: TOKEN,
    });
  });

  test("a body with no secret is not touched", async () => {
    const body: string = '{"plain": "a\\"b"}';
    const step: MonitorStep = await populate(apiStep({ body }));

    expect(step.data!.requestBody).toBe(body);
  });

  test("a body that is not JSON takes each value as it is", async () => {
    const step: MonitorStep = await populate(
      apiStep({ body: "<pass>{{monitorSecrets.Token}}</pass>" }),
    );

    expect(step.data!.requestBody).toBe(`<pass>${TOKEN}</pass>`);
  });
});

describe("the headers and the URL take a secret's value as it is, as they always did", () => {
  test("a header's value holds the secret exactly", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        headers: {
          Authorization: "Bearer {{monitorSecrets.Token}}",
          "X-Tenant": "{{monitorSecrets.Password}}",
        },
        body: '{"password": "{{monitorSecrets.Password}}"}',
      }),
    );

    expect(step.data!.requestHeaders).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "X-Tenant": PASSWORD,
    });
    expect(sentValue(step)).toEqual({ password: PASSWORD });
  });

  test("the URL holds the secret exactly", async () => {
    const step: MonitorStep = await populate(
      apiStep({
        url: "https://api.example.com/v1/{{monitorSecrets.Count}}?key={{monitorSecrets.Token}}",
      }),
    );

    expect(step.data!.monitorDestination?.toString()).toBe(
      `https://api.example.com/v1/42?key=${TOKEN}`,
    );
  });
});

describe("a monitor's check and a Test Monitor run are filled alike", () => {
  const BODY: string =
    '[{"password": "{{monitorSecrets.Password}}", "ids": [{{monitorSecrets.Ids}}]}]';

  test("a monitor handed to its probe", async () => {
    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.API;
    monitor.monitorSteps = steps(apiStep({ body: BODY }));

    await MonitorUtil.populateSecrets(monitor);

    expect(
      sentValue(monitor.monitorSteps.data!.monitorStepsInstanceArray[0]!),
    ).toEqual([{ password: PASSWORD, ids: [1, 2, 3] }]);
  });

  test("a Test Monitor run of a monitor not saved yet", async () => {
    const monitorTest: MonitorTest = new MonitorTest();
    monitorTest.projectId = PROJECT_ID;
    monitorTest.monitorType = MonitorType.API;
    monitorTest.monitorSteps = steps(apiStep({ body: BODY }));

    await MonitorUtil.populateSecretsOnMonitorTest(monitorTest);

    expect(
      sentValue(monitorTest.monitorSteps!.data!.monitorStepsInstanceArray[0]!),
    ).toEqual([{ password: PASSWORD, ids: [1, 2, 3] }]);
    expect(
      monitorSecretService.getSecretsForUnsavedMonitor,
    ).toHaveBeenCalledTimes(1);
  });

  test("a Test Monitor run of a saved monitor", async () => {
    const monitorTest: MonitorTest = new MonitorTest();
    monitorTest.projectId = PROJECT_ID;
    monitorTest.monitorId = MONITOR_ID;
    monitorTest.monitorType = MonitorType.API;
    monitorTest.monitorSteps = steps(apiStep({ body: BODY }));

    await MonitorUtil.populateSecretsOnMonitorTest(monitorTest);

    expect(
      sentValue(monitorTest.monitorSteps!.data!.monitorStepsInstanceArray[0]!),
    ).toEqual([{ password: PASSWORD, ids: [1, 2, 3] }]);
  });
});

describe("a secret's value never reaches a log", () => {
  test("not while a body, its headers and its URL are filled", async () => {
    await populate(
      apiStep({
        body: '{"password": "{{monitorSecrets.Password}}", "note": "{{monitorSecrets.Note}}", "raw": {{monitorSecrets.Token}}}',
        headers: { "X-Token": "{{monitorSecrets.Token}}" },
        url: "https://api.example.com/?k={{monitorSecrets.Token}}",
      }),
    );

    const logged: string = everythingLogged();

    for (const value of VALUES) {
      expect(logged).not.toContain(JSON.stringify(value).slice(1, -1));
      expect(logged).not.toContain(value);
    }
  });
});
