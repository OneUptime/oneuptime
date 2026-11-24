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

// Each line as the logger would write it, read when it is logged.
const mockLoggedLines: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const record: (...args: Array<unknown>) => void = (
    ...args: Array<unknown>
  ): void => {
    mockLoggedLines.push(JSON.stringify(args));
  };

  return {
    __esModule: true,
    default: {
      error: jest.fn(record),
      debug: jest.fn(record),
      info: jest.fn(record),
      warn: jest.fn(record),
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
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import { MonitorStepDatabaseMonitorUtil } from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import { MonitorStepDnsMonitorUtil } from "Common/Types/Monitor/MonitorStepDnsMonitor";
import { MonitorStepDomainMonitorUtil } from "Common/Types/Monitor/MonitorStepDomainMonitor";
import { MonitorStepDnssecMonitorUtil } from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import { MonitorStepExternalStatusPageMonitorUtil } from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

/*
 * THE SERVER HANDS A PROBE THE SECRET VALUES IT FILLED INTO EACH STEP, AND
 * NOTHING MORE (#10875).
 *
 * A probe cannot tell which text of a step was a monitor secret, so the
 * server hands it, beside each step, the values of the Text secrets it
 * filled into that step (MonitorStep.secretValuesToHide): the probe hides
 * them in every line it logs while it runs the step. Handing the values
 * over widens where they travel, so this holds the server to exactly the
 * values it filled in - of every field of every monitor type that takes a
 * secret, read the way the filling reads each placeholder - and to no
 * more: never a one-time code secret's seed, never a secret the monitor may
 * not use, never one named only in a field its type does not fill, never a
 * value too short to be hidden, never another step's, and nothing at all
 * unless the probe asked (a probe that declares it hides them). None is
 * ever logged, and the steps saved anyway hold none.
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
  "cccccccc-0000-4000-8000-00000000000c",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "c1c1c1c1-0000-4000-8000-0000000000c1",
);

const TOKEN: string = "tok-9d1e-header-value";
const API_KEY: string = "key/with?url=chars&more";
const PASSWORD: string = 'p"a\\ss wörd 😀';
const PASSPHRASE: string = "mtls-passphrase-77";
const HOST: string = "db-internal.example.net";
const DATABASE: string = "billing_prod";
const USER: string = "monitor_ro";
const COMMUNITY: string = "snmp-community-x1";
const DOTTED: string = "value-of-a-dotted-name";
// Never handed over: too short to be hidden, or never filled in.
const SHORT: string = "abc";
const UNUSED: string = "named-only-in-a-field-no-one-fills";
const NOT_ALLOWED: string = "a-secret-this-monitor-may-not-use";
const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

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
  secret.secretValue = `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;
  return secret;
}

// The secrets the monitor may use (NOT_ALLOWED is not among them).
const SECRETS: Array<MonitorSecret> = [
  textSecret("Token", TOKEN),
  textSecret("ApiKey", API_KEY),
  textSecret("Password", PASSWORD),
  textSecret("Passphrase", PASSPHRASE),
  textSecret("Host", HOST),
  textSecret("Database", DATABASE),
  textSecret("User", USER),
  textSecret("Community", COMMUNITY),
  textSecret("db.password", DOTTED),
  textSecret("Short", SHORT),
  textSecret("Unused", UNUSED),
  totpSecret("LoginCode"),
];

const EVERY_VALUE: ReadonlyArray<string> = [
  TOKEN,
  API_KEY,
  PASSWORD,
  PASSPHRASE,
  HOST,
  DATABASE,
  USER,
  COMMUNITY,
  DOTTED,
  UNUSED,
  NOT_ALLOWED,
  SEED,
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

function hostDestination(template: string): Hostname {
  const serialized: JSONObject = { _type: "Hostname", value: template };

  return {
    ...serialized,
    toJSON: (): JSONObject => {
      return serialized;
    },
    toString: (): string => {
      return template;
    },
  } as unknown as Hostname;
}

function steps(...items: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(items);
  return monitorSteps;
}

async function populate(data: {
  monitorType: MonitorType;
  steps: Array<MonitorStep>;
  hand?: boolean;
  secrets?: Array<MonitorSecret>;
}): Promise<Array<MonitorStep>> {
  const populated: MonitorSteps =
    await MonitorUtil.populateSecretsInMonitorSteps({
      monitorSteps: steps(...data.steps),
      monitorType: data.monitorType,
      preloadedSecrets: data.secrets || SECRETS,
      handSecretValuesToHide: data.hand ?? true,
    });

  return populated.data!.monitorStepsInstanceArray;
}

function handed(step: MonitorStep): Array<string> {
  return [...(step.data!.secretValuesToHide || [])].sort();
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

// Everything logged, as it was when logged: no value may be in it.
function everythingLogged(): string {
  return mockLoggedLines.join("\n");
}

describe("the secret values the server hands a probe beside each step", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoggedLines.length = 0;
  });

  test("an API step: the values filled into its URL, headers, body and mTLS passphrase", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(
      secretDestination(
        "https://api.example.com/v1?key={{monitorSecrets.ApiKey}}",
      ),
    );
    step.setRequestHeaders({
      Authorization: "Bearer {{monitorSecrets.Token}}",
      "X-One-Time": "{{monitorSecrets.LoginCode}}",
    });
    step.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');
    step.data!.tlsClientKeyPassphrase = "{{monitorSecrets.Passphrase}}";
    // A field an API step never fills: its reference is never a value handed over.
    step.data!.customCode = "{{monitorSecrets.Unused}}";

    const [filled] = await populate({
      monitorType: MonitorType.API,
      steps: [step],
    });

    expect(handed(filled!)).toEqual(
      sorted([API_KEY, TOKEN, PASSWORD, PASSPHRASE]),
    );
    // The values are in the step's fields, as the probe sends them...
    expect(filled!.data!.requestHeaders!["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
    // ...the one-time code secret's seed is in neither: it travels as its parameters.
    expect(Object.keys(filled!.data!.totpSecrets || {})).toEqual(["LoginCode"]);
    expect(JSON.stringify(filled!.data!.secretValuesToHide)).not.toContain(
      SEED,
    );
    expect(handed(filled!)).not.toContain(UNUSED);
  });

  test("a Synthetic or Custom Code step: the values filled into its script", async () => {
    for (const monitorType of [
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
    ]) {
      const step: MonitorStep = new MonitorStep();
      step.data!.customCode = [
        'await page.goto("https://app.example.com/login?token={{monitorSecrets.Token}}");',
        'await page.fill("#password", "{{monitorSecrets.Password}}");',
        'await page.fill("#otp", await oneuptime.getTotpCode("LoginCode"));',
      ].join("\n");

      const [filled] = await populate({ monitorType, steps: [step] });

      expect(handed(filled!)).toEqual(sorted([TOKEN, PASSWORD]));
      expect(filled!.data!.customCode).toContain(TOKEN);
    }
  });

  test("a SQL Query and a Database Health step: the values filled into their connection and query", async () => {
    const sql: MonitorStep = new MonitorStep();
    sql.data!.sqlMonitor = {
      ...MonitorStepSqlMonitorUtil.getDefault(),
      host: "{{monitorSecrets.Host}}",
      databaseName: "{{monitorSecrets.Database}}",
      username: "{{monitorSecrets.User}}",
      password: "{{monitorSecrets.Password}}",
      query:
        "SELECT count(*) FROM tokens WHERE value = '{{monitorSecrets.Token}}'",
    } as MonitorStepSqlMonitor;

    const [filledSql] = await populate({
      monitorType: MonitorType.SQLQuery,
      steps: [sql],
    });

    expect(handed(filledSql!)).toEqual(
      sorted([HOST, DATABASE, USER, PASSWORD, TOKEN]),
    );

    const database: MonitorStep = new MonitorStep();
    database.data!.databaseMonitor = {
      ...MonitorStepDatabaseMonitorUtil.getDefault(),
      host: "{{monitorSecrets.Host}}",
      databaseName: "{{monitorSecrets.Database}}",
      username: "{{monitorSecrets.User}}",
      password: "{{monitorSecrets.Password}}",
    };

    const [filledDatabase] = await populate({
      monitorType: MonitorType.Database,
      steps: [database],
    });

    expect(handed(filledDatabase!)).toEqual(
      sorted([HOST, DATABASE, USER, PASSWORD]),
    );
  });

  test("DNS, Domain, DNSSEC, External Status Page and Network Device steps, and a host to ping", async () => {
    const dns: MonitorStep = new MonitorStep();
    dns.data!.dnsMonitor = {
      ...MonitorStepDnsMonitorUtil.getDefault(),
      queryName: "{{monitorSecrets.Host}}",
      hostname: "{{monitorSecrets.Database}}",
    };
    expect(
      handed(
        (await populate({ monitorType: MonitorType.DNS, steps: [dns] }))[0]!,
      ),
    ).toEqual(sorted([HOST, DATABASE]));

    const domain: MonitorStep = new MonitorStep();
    domain.data!.domainMonitor = {
      ...MonitorStepDomainMonitorUtil.getDefault(),
      domainName: "{{monitorSecrets.Host}}",
    };
    expect(
      handed(
        (
          await populate({ monitorType: MonitorType.Domain, steps: [domain] })
        )[0]!,
      ),
    ).toEqual([HOST]);

    const dnssec: MonitorStep = new MonitorStep();
    dnssec.data!.dnssecMonitor = {
      ...MonitorStepDnssecMonitorUtil.getDefault(),
      domainName: "{{monitorSecrets.Host}}",
    };
    expect(
      handed(
        (
          await populate({ monitorType: MonitorType.DNSSEC, steps: [dnssec] })
        )[0]!,
      ),
    ).toEqual([HOST]);

    const statusPage: MonitorStep = new MonitorStep();
    statusPage.data!.externalStatusPageMonitor = {
      ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      statusPageUrl:
        "https://status.example.com/?key={{monitorSecrets.ApiKey}}",
    };
    expect(
      handed(
        (
          await populate({
            monitorType: MonitorType.ExternalStatusPage,
            steps: [statusPage],
          })
        )[0]!,
      ),
    ).toEqual([API_KEY]);

    const device: MonitorStep = new MonitorStep();
    device.data!.snmpMonitor = {
      snmpVersion: "v2c",
      hostname: "10.0.0.1",
      port: 161,
      communityString: "{{monitorSecrets.Community}}",
      oids: [],
      timeout: 5000,
    } as never;
    expect(
      handed(
        (
          await populate({
            monitorType: MonitorType.NetworkDevice,
            steps: [device],
          })
        )[0]!,
      ),
    ).toEqual([COMMUNITY]);

    const ping: MonitorStep = new MonitorStep();
    ping.setMonitorDestination(hostDestination("{{monitorSecrets.Host}}"));
    expect(
      handed(
        (await populate({ monitorType: MonitorType.Ping, steps: [ping] }))[0]!,
      ),
    ).toEqual([HOST]);
  });

  test("each step carries the values filled into it, and only those", async () => {
    const first: MonitorStep = new MonitorStep();
    first.setRequestHeaders({
      Authorization: "Bearer {{monitorSecrets.Token}}",
    });

    const second: MonitorStep = new MonitorStep();
    second.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');

    const third: MonitorStep = new MonitorStep();
    third.setRequestBody('{"plain": true}');

    const [one, two, three] = await populate({
      monitorType: MonitorType.API,
      steps: [first, second, third],
    });

    expect(handed(one!)).toEqual([TOKEN]);
    expect(handed(two!)).toEqual([PASSWORD]);
    expect(three!.data!.secretValuesToHide).toBeUndefined();
  });

  test("a placeholder is read as the filling reads it: a dotted name, and the whole map", async () => {
    const dotted: MonitorStep = new MonitorStep();
    dotted.setRequestHeaders({ "X-Db": "{{monitorSecrets.db.password}}" });

    expect(
      handed(
        (await populate({ monitorType: MonitorType.API, steps: [dotted] }))[0]!,
      ),
    ).toEqual([DOTTED]);

    /*
     * {{monitorSecrets}} beside a reference is written as the whole map:
     * every Text value the monitor may use is then in the step, and each
     * one long enough is handed over to be hidden.
     */
    const wholeMap: MonitorStep = new MonitorStep();
    wholeMap.setRequestHeaders({
      "X-Token": "{{monitorSecrets.Token}}",
      "X-All": "{{monitorSecrets}}",
    });

    const [filled] = await populate({
      monitorType: MonitorType.API,
      steps: [wholeMap],
    });

    for (const value of [TOKEN, API_KEY, PASSWORD, HOST, UNUSED, DOTTED]) {
      expect(handed(filled!)).toContain(value);
      // ...since the step does hold each.
      expect(filled!.data!.requestHeaders!["X-All"]).toContain(
        JSON.stringify(value).slice(1, -1),
      );
    }
    expect(handed(filled!)).not.toContain(SHORT);
    expect(JSON.stringify(handed(filled!))).not.toContain(SEED);

    // A body fills a reference by its name only: {{monitorSecrets}} stays as written there.
    const inBody: MonitorStep = new MonitorStep();
    inBody.setRequestBody(
      '{"token": "{{monitorSecrets.Token}}", "all": "{{monitorSecrets}}"}',
    );

    const [filledBody] = await populate({
      monitorType: MonitorType.API,
      steps: [inBody],
    });

    expect(filledBody!.data!.requestBody).toContain('"{{monitorSecrets}}"');
    expect(handed(filledBody!)).toEqual([TOKEN]);
  });

  test("never a secret the monitor may not use, a value too short to hide, or a seed", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setRequestHeaders({
      "X-Not-Allowed": "{{monitorSecrets.NotAllowed}}",
      "X-Short": "{{monitorSecrets.Short}}",
      "X-Code": "{{monitorSecrets.LoginCode}}",
      "X-Token": "{{monitorSecrets.Token}}",
    });

    const [filled] = await populate({
      monitorType: MonitorType.API,
      steps: [step],
    });

    // Filled in: the short value is sent, it is only not hidden.
    expect(filled!.data!.requestHeaders!["X-Short"]).toBe(SHORT);
    // Left as written: a secret the monitor may not use, and the code's reference.
    expect(filled!.data!.requestHeaders!["X-Not-Allowed"]).toBe(
      "{{monitorSecrets.NotAllowed}}",
    );
    expect(handed(filled!)).toEqual([TOKEN]);
  });

  test("nothing is handed over unless asked, and a step never carries values it was not filled with here", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setRequestHeaders({
      Authorization: "Bearer {{monitorSecrets.Token}}",
    });
    // As if a step had come in carrying values of its own.
    step.data!.secretValuesToHide = [NOT_ALLOWED];

    const [notAsked] = await populate({
      monitorType: MonitorType.API,
      steps: [step],
      hand: false,
    });

    expect(notAsked!.data!.secretValuesToHide).toBeUndefined();
    expect(notAsked!.data!.requestHeaders!["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );

    const again: MonitorStep = new MonitorStep();
    again.setRequestBody('{"plain": true}');
    again.data!.secretValuesToHide = [NOT_ALLOWED];

    const [asked] = await populate({
      monitorType: MonitorType.API,
      steps: [again],
    });

    expect(asked!.data!.secretValuesToHide).toBeUndefined();
  });

  test("a monitor's and a Test Monitor run's steps alike, as the routes hand them over", async () => {
    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.API;
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.setRequestHeaders({
      Authorization: "Bearer {{monitorSecrets.Token}}",
    });
    monitor.monitorSteps = steps(monitorStep);

    await MonitorUtil.populateSecrets(monitor, SECRETS, {
      handSecretValuesToHide: true,
    });

    expect(
      monitor.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
        .secretValuesToHide,
    ).toEqual([TOKEN]);

    monitorSecretService.getSecretsForMonitors.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([[MONITOR_ID.toString(), SECRETS]]),
    );

    const monitorTest: MonitorTest = new MonitorTest(ObjectID.generate());
    monitorTest.projectId = PROJECT_ID;
    monitorTest.monitorId = MONITOR_ID;
    monitorTest.monitorType = MonitorType.API;
    const testStep: MonitorStep = new MonitorStep();
    testStep.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');
    monitorTest.monitorSteps = steps(testStep);

    await MonitorUtil.populateSecretsOnMonitorTest(monitorTest, {
      handSecretValuesToHide: true,
    });

    expect(
      monitorTest.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
        .secretValuesToHide,
    ).toEqual([PASSWORD]);

    // A test of a probe that did not ask: none.
    const notAsked: MonitorTest = new MonitorTest(ObjectID.generate());
    notAsked.projectId = PROJECT_ID;
    notAsked.monitorId = MONITOR_ID;
    notAsked.monitorType = MonitorType.API;
    const notAskedStep: MonitorStep = new MonitorStep();
    notAskedStep.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');
    notAsked.monitorSteps = steps(notAskedStep);

    await MonitorUtil.populateSecretsOnMonitorTest(notAsked);

    expect(
      notAsked.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
        .secretValuesToHide,
    ).toBeUndefined();
  });

  test("the steps as handed over, saved anyway, hold no values beside them, and no value is logged", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setRequestHeaders({
      Authorization: "Bearer {{monitorSecrets.Token}}",
    });
    step.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');

    const populated: MonitorSteps =
      await MonitorUtil.populateSecretsInMonitorSteps({
        monitorSteps: steps(step),
        monitorType: MonitorType.API,
        preloadedSecrets: SECRETS,
        handSecretValuesToHide: true,
      });

    expect(
      populated.data!.monitorStepsInstanceArray[0]!.data!.secretValuesToHide,
    ).toHaveLength(2);

    const stored: JSONObject =
      MonitorSteps.getDatabaseTransformer().to(populated);

    expect(JSON.stringify(stored)).not.toContain('"secretValuesToHide"');

    for (const value of EVERY_VALUE) {
      expect(everythingLogged()).not.toContain(value);
      expect(everythingLogged()).not.toContain(
        JSON.stringify(value).slice(1, -1),
      );
    }
  });
});
