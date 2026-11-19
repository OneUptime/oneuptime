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

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import TotpCodeIssuer, {
  maskTotpCode,
} from "Common/Utils/Monitor/MonitorSecretTotp";
import { TotpAlgorithm } from "Common/Utils/Totp/TotpParameters";
import MonitorUtil from "../../FeatureSet/Telemetry/Utils/Monitor";

/*
 * A MONITOR SECRET THAT CHANGES ITS TYPE, AS THE NEXT CHECK SEES IT
 * (issue #9760).
 *
 * Update Secret Value changes a secret's type only together with a new
 * value, in one write (MonitorSecretService). The server fills a monitor's
 * secrets in again for every check, from the secret as it is then, so a
 * monitor that uses the secret takes the new type at its next check. And
 * the masking of codes holds across the change, both ways:
 *
 *   - a Text secret that becomes a one-time code secret is never filled in
 *     again: its reference stays as written, the probe makes the code, and
 *     every code a check makes is masked in what it reports - the old
 *     password is in nothing handed out;
 *   - a one-time code secret that becomes Text hands the probe no code
 *     parameters any more, and its setup key is in nothing handed out: the
 *     new text is filled in as any Text secret is, and is never taken for a
 *     code.
 *
 * The secret loading (which secrets a monitor may use) is
 * MonitorSecretService's, mocked here to give the secret as it is before
 * and after the change; the filling and the codes are the real ones.
 */

interface MonitorSecretServiceMock {
  getSecretsForMonitors: Mock<
    typeof MonitorSecretService.getSecretsForMonitors
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
const STORED_SEED: string = `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;
const OLD_PASSWORD: string = "the-old-password";
const NEW_PASSWORD: string = "a-new-password";

const REFERENCE: string = "{{monitorSecrets.Login}}";

// The secret as it is stored at one moment: its type and its value.
function login(secretType: MonitorSecretType, value: string): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = "Login";
  secret.secretType = secretType;
  secret.secretValue = value;
  return secret;
}

function useSecret(secret: MonitorSecret): void {
  monitorSecretService.getSecretsForMonitors.mockResolvedValue(
    new Map<string, Array<MonitorSecret>>([[MONITOR_ID.toString(), [secret]]]),
  );
}

// An API monitor that sends the secret in a header, as a sign-in does.
function apiMonitor(): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.id = new ObjectID("57e90000-0000-4000-8000-0000000000e1");
  step.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      monitorName: "Sign-in",
    } as never).data!,
    id: step.id.toString(),
    monitorDestination: URL.fromString("https://app.example.com/login"),
    requestHeaders: { "X-Login": REFERENCE },
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.API;
  monitor.monitorSteps = steps;
  return monitor;
}

// What the probe is handed for a check: the monitor, its secrets filled in.
async function handedOut(): Promise<MonitorStep> {
  const monitor: Monitor = await MonitorUtil.populateSecrets(apiMonitor());

  return monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
}

function asText(step: MonitorStep): string {
  return JSON.stringify(step.toJSON());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("a Text secret that becomes a one-time code secret", () => {
  test("the next check gets a code where the password went, never the password", async () => {
    useSecret(login(MonitorSecretType.Text, OLD_PASSWORD));

    const before: MonitorStep = await handedOut();

    expect(before.data!.requestHeaders).toEqual({ "X-Login": OLD_PASSWORD });
    expect(before.data!.totpSecrets).toBeUndefined();

    // The type and the new value, written together.
    useSecret(login(MonitorSecretType.TOTP, STORED_SEED));

    const after: MonitorStep = await handedOut();

    // Left as written for the probe, which makes the code when it sends it.
    expect(after.data!.requestHeaders).toEqual({ "X-Login": REFERENCE });
    expect(after.data!.totpSecrets).toEqual({
      Login: {
        secret: SEED,
        algorithm: TotpAlgorithm.SHA1,
        digits: 6,
        periodInSeconds: 30,
      },
    });
    // Neither the old password nor the seed is written into the step.
    expect(asText(after)).not.toContain(OLD_PASSWORD);
    expect(JSON.stringify(after.data!.requestHeaders)).not.toContain(SEED);
  });

  test("the code the probe makes from it is masked in what the check reports", async () => {
    useSecret(login(MonitorSecretType.TOTP, STORED_SEED));

    const step: MonitorStep = await handedOut();
    const codes: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: step.data!.totpSecrets!,
      now: (): number => {
        // Ten seconds into a period: nothing to wait for.
        return Date.UTC(2026, 10, 19, 12, 0, 10);
      },
    });

    const sent: Dictionary<string> = await codes.fill(
      step.data!.requestHeaders as Dictionary<string>,
    );
    const code: string = sent["X-Login"] as string;

    expect(code).toMatch(/^\d{6}$/);
    expect(codes.getIssuedCodes()).toEqual([code]);

    // What the site answered, echoing the code, as the check reports it.
    expect(codes.redact(`Signed in with ${code}.`)).toBe(
      `Signed in with ${maskTotpCode(code)}.`,
    );
    expect(maskTotpCode(code)).toBe("******");
  });
});

describe("a one-time code secret that becomes a Text secret", () => {
  test("the next check gets the new text, and no code parameters: the setup key is in nothing handed out", async () => {
    useSecret(login(MonitorSecretType.TOTP, STORED_SEED));

    const before: MonitorStep = await handedOut();

    expect(before.data!.requestHeaders).toEqual({ "X-Login": REFERENCE });
    expect(Object.keys(before.data!.totpSecrets || {})).toEqual(["Login"]);

    useSecret(login(MonitorSecretType.Text, NEW_PASSWORD));

    const after: MonitorStep = await handedOut();

    expect(after.data!.requestHeaders).toEqual({ "X-Login": NEW_PASSWORD });
    expect(after.data!.totpSecrets).toBeUndefined();
    expect(asText(after)).not.toContain(SEED);
  });

  test("the new text is never taken for a code: the probe makes none, and masks nothing of it", async () => {
    // A text of six digits, as a PIN is, is no code once the secret is Text.
    useSecret(login(MonitorSecretType.Text, "492039"));

    const step: MonitorStep = await handedOut();
    const codes: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: step.data!.totpSecrets || {},
    });

    expect(codes.hasSecrets()).toBe(false);
    expect(step.data!.requestHeaders).toEqual({ "X-Login": "492039" });
    expect(await codes.fill(step.data!.requestHeaders)).toEqual({
      "X-Login": "492039",
    });
    expect(codes.redact("PIN 492039 accepted.")).toBe("PIN 492039 accepted.");
  });
});

describe("a monitor that uses the secret", () => {
  test("takes the type the secret has at each check, whichever way it changed", async () => {
    const types: Array<MonitorSecretType | undefined> = [];

    for (const secret of [
      login(MonitorSecretType.Text, OLD_PASSWORD),
      login(MonitorSecretType.TOTP, STORED_SEED),
      login(MonitorSecretType.Text, NEW_PASSWORD),
    ]) {
      useSecret(secret);

      const step: MonitorStep = await handedOut();

      types.push(
        step.data!.totpSecrets
          ? MonitorSecretType.TOTP
          : step.data!.requestHeaders?.["X-Login"] === secret.secretValue
            ? MonitorSecretType.Text
            : undefined,
      );
    }

    expect(types).toEqual([
      MonitorSecretType.Text,
      MonitorSecretType.TOTP,
      MonitorSecretType.Text,
    ]);
    // Asked afresh at each check: nothing kept from the one before.
    expect(monitorSecretService.getSecretsForMonitors).toHaveBeenCalledTimes(3);
  });
});
