import URL from "../../../Types/API/URL";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  StepTotpReferences,
  doStepsNeedOneTimeCodes,
  getStepTotpReferences,
  getTotpSecretNamesNeeded,
} from "../../../Utils/Monitor/MonitorSecretReferences";
import * as MonitorSecretTotp from "../../../Utils/Monitor/MonitorSecretTotp";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How a monitor step references its secrets, and which need a one-time
 * code (issues #9703 and #9759): one reading for the server, which hands a
 * probe the parameters of the codes a step needs, and for the monitor
 * forms, which warn of a probe too old to make them. The reading is free of
 * the library that makes codes, so a page that reads a monitor's steps does
 * not load it.
 */

function step(data: {
  monitorDestination?: string | undefined;
  requestHeaders?: Record<string, string> | undefined;
  requestBody?: string | undefined;
  customCode?: string | undefined;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      monitorName: "Sign-in",
    } as never).data!,
    monitorDestination: data.monitorDestination
      ? URL.fromString(data.monitorDestination)
      : undefined,
    requestHeaders: data.requestHeaders,
    requestBody: data.requestBody,
    customCode: data.customCode,
  };
  return monitorStep;
}

function steps(...items: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: items,
    defaultMonitorStatusId: undefined,
  };
  return monitorSteps;
}

const SIGN_IN_SCRIPT: string = [
  'await page.fill("#password", "{{monitorSecrets.Password}}");',
  'await page.fill("#otp", await oneuptime.getTotpCode("LoginCode"));',
].join("\n");

describe("getStepTotpReferences", () => {
  test("an API step: the references in its URL, headers and body", () => {
    expect(
      getStepTotpReferences(
        step({
          monitorDestination:
            "https://api.example.com/login?code={{monitorSecrets.UrlCode}}",
          requestHeaders: { "X-Code": "{{monitorSecrets.HeaderCode}}" },
          requestBody: '{"otp": "{{monitorSecrets.BodyCode}}"}',
        }),
        MonitorType.API,
      ),
    ).toEqual({
      names: ["UrlCode", "HeaderCode", "BodyCode"],
      script: undefined,
    });
  });

  test("a Synthetic or Custom Code step: the references in its script, and the script that asks for a code", () => {
    for (const monitorType of [
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
    ]) {
      expect(
        getStepTotpReferences(
          step({ customCode: SIGN_IN_SCRIPT }),
          monitorType,
        ),
      ).toEqual({ names: ["Password"], script: SIGN_IN_SCRIPT });
    }
  });

  test("a script that only references a secret carries no script to read names from", () => {
    expect(
      getStepTotpReferences(
        step({
          customCode: 'await page.fill("#otp", "{{monitorSecrets.Code}}");',
        }),
        MonitorType.SyntheticMonitor,
      ),
    ).toEqual({ names: ["Code"], script: undefined });
  });

  test("a field no code goes into is not read: a Website's URL, an API step's script", () => {
    expect(
      getStepTotpReferences(
        step({
          monitorDestination: "https://example.com/?c={{monitorSecrets.Code}}",
        }),
        MonitorType.Website,
      ),
    ).toBeNull();
    expect(
      getStepTotpReferences(
        step({ customCode: SIGN_IN_SCRIPT }),
        MonitorType.API,
      ),
    ).toBeNull();
  });

  test("a step that references nothing, or has no data, is null", () => {
    expect(
      getStepTotpReferences(
        step({ monitorDestination: "https://example.com" }),
        MonitorType.API,
      ),
    ).toBeNull();
    expect(
      getStepTotpReferences(new MonitorStep(), MonitorType.API),
    ).toBeNull();
  });

  test("{{ monitorSecrets.NAME }} with spaces is no reference, as the server fills none", () => {
    expect(
      getStepTotpReferences(
        step({ requestHeaders: { X: "{{ monitorSecrets.Code }}" } }),
        MonitorType.API,
      ),
    ).toBeNull();
  });
});

describe("getTotpSecretNamesNeeded", () => {
  const references: StepTotpReferences = {
    names: ["Password", "LoginCode", "Other"],
    script: 'await oneuptime.getTotpCode("ScriptCode"); "Password"',
  };

  test("the one-time code secrets referenced, then those the script asks for by name, each once", () => {
    expect(
      getTotpSecretNamesNeeded(references, [
        "ScriptCode",
        "LoginCode",
        "Unused",
      ]),
    ).toEqual(["LoginCode", "ScriptCode"]);
  });

  test("a Text secret is never one: only the names given as one-time code secrets count", () => {
    expect(getTotpSecretNamesNeeded(references, [])).toEqual([]);
    expect(
      getTotpSecretNamesNeeded({ names: ["Password"], script: undefined }, [
        "LoginCode",
      ]),
    ).toEqual([]);
  });
});

describe("doStepsNeedOneTimeCodes", () => {
  test("a step that references a one-time code secret where a code goes needs one", () => {
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: steps(
          step({ monitorDestination: "https://example.com" }),
          step({ requestHeaders: { "X-Code": "{{monitorSecrets.Code}}" } }),
        ),
        monitorType: MonitorType.API,
        totpSecretNames: ["Code"],
      }),
    ).toBe(true);
  });

  test("a reference to a Text secret needs none", () => {
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: steps(
          step({ requestHeaders: { Authorization: "{{monitorSecrets.Key}}" } }),
        ),
        monitorType: MonitorType.API,
        totpSecretNames: ["Code"],
      }),
    ).toBe(false);
  });

  test("a script that asks for a code needs one, even when the secrets' names cannot be read", () => {
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: steps(step({ customCode: SIGN_IN_SCRIPT })),
        monitorType: MonitorType.SyntheticMonitor,
        totpSecretNames: null,
      }),
    ).toBe(true);
  });

  test("a reference alone needs none when the secrets' names cannot be read: nothing says it is a code", () => {
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: steps(
          step({ requestHeaders: { "X-Code": "{{monitorSecrets.Code}}" } }),
        ),
        monitorType: MonitorType.API,
        totpSecretNames: null,
      }),
    ).toBe(false);
  });

  test("no steps, or a type no code goes into, need none", () => {
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: undefined,
        monitorType: MonitorType.API,
        totpSecretNames: ["Code"],
      }),
    ).toBe(false);
    expect(
      doStepsNeedOneTimeCodes({
        monitorSteps: steps(
          step({
            monitorDestination: "https://x.example/?c={{monitorSecrets.Code}}",
          }),
        ),
        monitorType: MonitorType.Ping,
        totpSecretNames: ["Code"],
      }),
    ).toBe(false);
  });
});

describe("one reading for the server and the forms", () => {
  test("MonitorSecretTotp still offers what it offered, from the shared reader", () => {
    expect(MonitorSecretTotp.MONITOR_SECRETS_REFERENCE_PREFIX).toBe(
      "monitorSecrets.",
    );
    expect(MonitorSecretTotp.TOTP_CODE_FUNCTION_NAME).toBe("getTotpCode");
    expect(
      MonitorSecretTotp.getReferencedSecretNames(
        "{{monitorSecrets.A}} {{monitorSecrets.B}} {{monitorSecrets.A}}",
      ),
    ).toEqual(["A", "B"]);
    expect(
      MonitorSecretTotp.callsTotpCodeFunction('oneuptime.getTotpCode ("A")'),
    ).toBe(true);
    expect(
      MonitorSecretTotp.getQuotedNames("`A` 'B'", ["A", "B", "C"]),
    ).toEqual(["A", "B"]);
  });

  test("the reader loads no code-making library: a page that reads steps stays light", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Utils/Monitor/MonitorSecretReferences.ts"),
      "utf8",
    );

    const importLine: RegExp = /^\s*import\b/;
    const fromLine: RegExp = / from "/;

    const imports: Array<string> = source
      .split("\n")
      .filter((line: string): boolean => {
        return importLine.test(line) || fromLine.test(line);
      });

    expect(imports.length).toBeGreaterThan(0);

    for (const line of imports) {
      expect(line).not.toMatch(/otpauth|Totp\/TotpSecret|MonitorSecretTotp/);
    }
  });
});
