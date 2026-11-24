jest.mock("../../../../Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
    },
  };
});

import MonitorSecretService from "../../../../Server/Services/MonitorSecretService";
import MonitorCheckSecretValues from "../../../../Server/Utils/Monitor/MonitorCheckSecretValues";
import { HIDDEN_SECRET_MARKER } from "../../../../Server/Utils/Monitor/MonitorSecretValueRedaction";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../../../Models/DatabaseModels/MonitorSecret";
import MonitorTest from "../../../../Models/DatabaseModels/MonitorTest";
import URL from "../../../../Types/API/URL";
import MonitorSecretType from "../../../../Types/Monitor/MonitorSecretType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE SECRETS A CHECK RAN WITH, AS THE SERVER LOADS THEM TO HIDE THEM
 * (#10825).
 *
 * The Text secrets a monitor's or a test's steps name as
 * {{monitorSecrets.NAME}}, of those it may use - read by the rule the
 * probe's fetch fills them in by. A one-time code secret's seed is never
 * filled in, a secret no step names was never sent, and a monitor whose
 * steps name none costs no query. Nothing of the monitor's configuration
 * is changed: its steps keep their placeholders and its secrets their
 * values, so the next check is sent the secret as before.
 */

type AnyMock = Mock<(...args: Array<any>) => any>;

const getSecretsForMonitors: AnyMock =
  MonitorSecretService.getSecretsForMonitors as unknown as AnyMock;
const getSecretsForUnsavedMonitor: AnyMock =
  MonitorSecretService.getSecretsForUnsavedMonitor as unknown as AnyMock;

const TOKEN: string = "tok_Q7r9-Live-Value";
const PASSWORD: string = 'Pa ss"w\\rd-é';
const SEED: string = "JBSWY3DPEHPK3PXP";

const PROJECT_ID: ObjectID = new ObjectID(
  "0e2a4c6e-8b3d-4f5a-9c7e-1d3f5b7d9f66",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "9d1f3b5d-7a2c-4c6e-8f0a-2b4d6f8a0c55",
);

function secret(
  name: string,
  value: string,
  secretType: MonitorSecretType = MonitorSecretType.Text,
): MonitorSecret {
  const monitorSecret: MonitorSecret = new MonitorSecret();
  monitorSecret.name = name;
  monitorSecret.secretValue = value;
  monitorSecret.secretType = secretType;
  monitorSecret.projectId = PROJECT_ID;

  return monitorSecret;
}

// Every secret the monitor may use: some its steps name, some not.
function projectSecrets(): Array<MonitorSecret> {
  return [
    secret("Token", TOKEN),
    secret("Password", PASSWORD),
    secret("Unused", "never-sent-Value-9"),
    secret("Authenticator", SEED, MonitorSecretType.TOTP),
  ];
}

const SCRIPT: string = [
  "await page.goto('https://app.example.invalid/login?token={{monitorSecrets.Token}}');",
  "await page.fill('#password', '{{monitorSecrets.Password}}');",
  "await page.fill('#code', '{{monitorSecrets.Authenticator}}');",
].join("\n");

function stepsWith(...steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };

  return monitorSteps;
}

function scriptStep(script: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setCustomCode(script);

  return step;
}

function syntheticMonitor(steps: MonitorSteps): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.SyntheticMonitor;
  monitor.monitorSteps = steps;

  return monitor;
}

// A Synthetic check whose script said the secrets back.
function scriptCheck(stepId: ObjectID): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: stepId,
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-11-23T10:00:00.000Z"),
    syntheticMonitorResponse: [
      {
        result: undefined,
        scriptError: `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${TOKEN}`,
        logMessages: [`typed ${PASSWORD}`, "code 123456"],
        capturedMetrics: [],
        executionTimeInMS: 1200,
        browserType: BrowserType.Chromium,
        screenSizeType: ScreenSizeType.Desktop,
      },
    ],
  };
}

beforeEach(() => {
  getSecretsForMonitors.mockReset();
  getSecretsForUnsavedMonitor.mockReset();
  getSecretsForMonitors.mockResolvedValue(
    new Map<string, Array<MonitorSecret>>([
      [MONITOR_ID.toString(), projectSecrets()],
    ]) as never,
  );
  getSecretsForUnsavedMonitor.mockResolvedValue(projectSecrets() as never);
});

describe("the secrets a monitor's steps name", () => {
  test("every {{monitorSecrets.NAME}} anywhere in the steps, read as the server reads a placeholder", () => {
    const steps: MonitorSteps = stepsWith(
      scriptStep(SCRIPT),
      scriptStep("console.log('{{ monitorSecrets.Spaced }} is no reference');"),
    );

    expect(
      Array.from(MonitorCheckSecretValues.getReferencedNames(steps)).sort(),
    ).toEqual(["Authenticator", "Password", "Token"]);
  });

  test("steps that name none, and no steps at all, name nothing", () => {
    expect(
      MonitorCheckSecretValues.getReferencedNames(
        stepsWith(scriptStep("await page.goto('https://example.com');")),
      ).size,
    ).toBe(0);
    expect(MonitorCheckSecretValues.getReferencedNames(undefined).size).toBe(0);
  });

  test("only the Text secrets the steps name, with a value, are hidden", () => {
    const values: Array<string> = MonitorCheckSecretValues.getValuesToHide({
      names: MonitorCheckSecretValues.getReferencedNames(
        stepsWith(scriptStep(SCRIPT)),
      ),
      secrets: [...projectSecrets(), secret("Token2", "")],
    });

    // Not the one-time code secret's seed, not the secret no step names.
    expect(values.sort()).toEqual([PASSWORD, TOKEN].sort());
  });

  test("a name with a quote in it, as the steps' JSON writes it", () => {
    const values: Array<string> = MonitorCheckSecretValues.getValuesToHide({
      names: MonitorCheckSecretValues.getReferencedNames(
        stepsWith(scriptStep('const key = `{{monitorSecrets.My"Key}}`;')),
      ),
      secrets: [secret('My"Key', "quoted-name-Value-1")],
    });

    expect(values).toEqual(["quoted-name-Value-1"]);
  });
});

describe("a monitor's check", () => {
  test("its secrets' values are hidden wherever the script said them back", async () => {
    const step: MonitorStep = scriptStep(SCRIPT);
    const monitor: Monitor = syntheticMonitor(stepsWith(step));

    const hidden: ProbeMonitorResponse =
      await MonitorCheckSecretValues.hideInMonitorCheck({
        check: scriptCheck(step.id),
        monitor: monitor,
      });

    expect(getSecretsForMonitors).toHaveBeenCalledTimes(1);
    expect(getSecretsForMonitors).toHaveBeenCalledWith({
      monitorIds: [MONITOR_ID],
    });

    const run: NonNullable<
      ProbeMonitorResponse["syntheticMonitorResponse"]
    >[number] = hidden.syntheticMonitorResponse![0]!;

    expect(run.scriptError).toBe(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${HIDDEN_SECRET_MARKER}`,
    );
    expect(run.logMessages).toEqual([
      `typed ${HIDDEN_SECRET_MARKER}`,
      // A one-time code is the probe's to hide, and is no Text secret.
      "code 123456",
    ]);
  });

  test("a monitor whose steps name no secret costs no query, and its check is the very object it was", async () => {
    const step: MonitorStep = scriptStep(
      "await page.goto('https://example.com');",
    );
    const check: ProbeMonitorResponse = scriptCheck(step.id);

    const hidden: ProbeMonitorResponse =
      await MonitorCheckSecretValues.hideInMonitorCheck({
        check: check,
        monitor: syntheticMonitor(stepsWith(step)),
      });

    expect(hidden).toBe(check);
    expect(getSecretsForMonitors).not.toHaveBeenCalled();
  });

  test("the destination the probe echoes, filled in, is the step's as configured", async () => {
    const step: MonitorStep = new MonitorStep();
    const configured: URL = URL.fromString(
      "https://api.example.com/v1/health?key={{monitorSecrets.Token}}",
    );
    step.setMonitorDestination(configured);

    const monitor: Monitor = syntheticMonitor(stepsWith(step));
    monitor.monitorType = MonitorType.API;

    const check: ProbeMonitorResponse = {
      ...scriptCheck(step.id),
      syntheticMonitorResponse: undefined,
      monitorDestination: URL.fromString(
        `https://api.example.com/v1/health?key=${TOKEN}`,
      ),
      responseBody: JSON.stringify({ args: { key: TOKEN } }),
    };

    const hidden: ProbeMonitorResponse =
      await MonitorCheckSecretValues.hideInMonitorCheck({
        check: check,
        monitor: monitor,
      });

    expect(hidden.monitorDestination).toBe(configured);
    expect(JSON.parse(hidden.responseBody as string)).toEqual({
      args: { key: HIDDEN_SECRET_MARKER },
    });
  });

  test("the monitor's configuration keeps the real secret: its steps their placeholders, its secrets their values", async () => {
    const step: MonitorStep = scriptStep(SCRIPT);
    const monitor: Monitor = syntheticMonitor(stepsWith(step));
    const secrets: Array<MonitorSecret> = projectSecrets();

    getSecretsForMonitors.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([
        [MONITOR_ID.toString(), secrets],
      ]) as never,
    );

    const stepsBefore: string = JSON.stringify(monitor.monitorSteps!.toJSON());

    await MonitorCheckSecretValues.hideInMonitorCheck({
      check: scriptCheck(step.id),
      monitor: monitor,
    });

    expect(JSON.stringify(monitor.monitorSteps!.toJSON())).toBe(stepsBefore);
    expect(step.data!.customCode).toBe(SCRIPT);
    expect(
      secrets.map((item: MonitorSecret): string | undefined => {
        return item.secretValue;
      }),
    ).toEqual([TOKEN, PASSWORD, "never-sent-Value-9", SEED]);
  });
});

describe("a Test Monitor run's check", () => {
  function monitorTest(monitorId: ObjectID | undefined): {
    test: MonitorTest;
    step: MonitorStep;
  } {
    const step: MonitorStep = scriptStep(SCRIPT);
    const test: MonitorTest = new MonitorTest();
    test.projectId = PROJECT_ID;
    test.monitorType = MonitorType.SyntheticMonitor;
    test.monitorSteps = stepsWith(step);

    if (monitorId) {
      test.monitorId = monitorId;
    }

    return { test, step };
  }

  test("of a monitor not saved yet: the secrets every monitor in the project may use", async () => {
    const { test, step } = monitorTest(undefined);

    const hidden: ProbeMonitorResponse =
      await MonitorCheckSecretValues.hideInMonitorTestCheck({
        check: scriptCheck(step.id),
        monitorTest: test,
      });

    expect(getSecretsForUnsavedMonitor).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
    expect(getSecretsForMonitors).not.toHaveBeenCalled();
    expect(JSON.stringify(hidden)).not.toContain(TOKEN);
    expect(hidden.syntheticMonitorResponse![0]!.logMessages[0]).toBe(
      `typed ${HIDDEN_SECRET_MARKER}`,
    );
  });

  test("of a saved monitor: its secrets, only while it is in the test's project", async () => {
    const { test, step } = monitorTest(MONITOR_ID);

    const hidden: ProbeMonitorResponse =
      await MonitorCheckSecretValues.hideInMonitorTestCheck({
        check: scriptCheck(step.id),
        monitorTest: test,
      });

    expect(getSecretsForMonitors).toHaveBeenCalledWith({
      monitorIds: [MONITOR_ID],
      projectId: PROJECT_ID,
    });
    expect(getSecretsForUnsavedMonitor).not.toHaveBeenCalled();
    expect(hidden.syntheticMonitorResponse![0]!.scriptError).not.toContain(
      TOKEN,
    );
  });

  test("a test whose steps name no secret costs no query", async () => {
    const { test, step } = monitorTest(MONITOR_ID);
    test.monitorSteps = stepsWith(scriptStep("return 1;"));

    const check: ProbeMonitorResponse = scriptCheck(step.id);

    expect(
      await MonitorCheckSecretValues.hideInMonitorTestCheck({
        check: check,
        monitorTest: test,
      }),
    ).toBe(check);
    expect(getSecretsForMonitors).not.toHaveBeenCalled();
    expect(getSecretsForUnsavedMonitor).not.toHaveBeenCalled();
  });

  test("a monitor in another project gives a test none of its secrets", async () => {
    const { test, step } = monitorTest(MONITOR_ID);

    // The monitor is not in the test's project: the lookup finds no entry.
    getSecretsForMonitors.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>() as never,
    );

    const check: ProbeMonitorResponse = scriptCheck(step.id);

    // Nothing was filled in, so nothing is hidden.
    expect(
      await MonitorCheckSecretValues.hideInMonitorTestCheck({
        check: check,
        monitorTest: test,
      }),
    ).toBe(check);
  });
});
