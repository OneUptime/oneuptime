import { describe, expect, it } from "@jest/globals";
import { readPage } from "./DocsContentSupport";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import { maskTotpCode } from "Common/Utils/Monitor/MonitorSecretTotp";
import {
  TOTP_ALGORITHMS,
  TOTP_DEFAULT_ALGORITHM,
  TOTP_DEFAULT_DIGITS,
  TOTP_DEFAULT_PERIOD_IN_SECONDS,
  TOTP_DIGIT_LENGTHS,
  TOTP_MINIMUM_VALIDITY_IN_MS,
  getTotpMinimumValidityInMs,
} from "Common/Utils/Totp/TotpSecret";
import {
  MONITOR_SECRET_TYPE_TITLES,
  TOTP_SECRET_VALUE_TITLE,
} from "../../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretTypeFormFields";
import fs from "fs";
import path from "path";

/*
 * What the English docs say about one-time code (TOTP) monitor secrets
 * (issue #9703), held to the code that makes it true: the words the form
 * draws, what a pasted key or link gives, when a code is made and how long
 * it must still be good for, how a code is shown in a check's report, the
 * fields a code goes into, and oneuptime.getTotpCode in both script
 * runtimes. MonitorChecksDocsTranslations and
 * ScriptAndInboundMonitorDocsTranslations hold every language to these
 * pages.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const SECRETS_PAGE: string = readPage("en", "monitor/monitor-secrets");
const SYNTHETIC_PAGE: string = readPage("en", "monitor/synthetic-monitor");
const CUSTOM_CODE_PAGE: string = readPage("en", "monitor/custom-code-monitor");

const HEADING: string = "## Signing in with a one-time code";

// The section, up to the next H2.
function section(): string {
  const start: number = SECRETS_PAGE.indexOf(`${HEADING}\n`);

  expect(start).toBeGreaterThan(0);

  const rest: string = SECRETS_PAGE.slice(start + HEADING.length);
  const next: number = rest.search(/^## /m);

  return next < 0 ? rest : rest.slice(0, next);
}

function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

describe("the one-time code section of Monitor Secrets", () => {
  it("is reached from the page's cards, its first section and the Adding steps", () => {
    const anchor: string = "(#signing-in-with-a-one-time-code)";

    expect(SECRETS_PAGE.split(anchor).length - 1).toBeGreaterThanOrEqual(3);
  });

  it("names the type and the field as the form draws them", () => {
    const form: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/MonitorSecret/TotpCodePreview.tsx",
    );

    expect(MONITOR_SECRET_TYPE_TITLES[MonitorSecretType.TOTP]).toBe(
      "One-time code (TOTP)",
    );
    expect(TOTP_SECRET_VALUE_TITLE).toBe("Setup Key");
    expect(form).toContain('translator.translateText("Current code")');

    for (const label of [
      "**One-time code (TOTP)**",
      "**Setup Key**",
      "**Current code**",
    ]) {
      expect(section()).toContain(label);
    }
  });

  it("says what a bare setup key gives: the defaults every app assumes", () => {
    expect([
      TOTP_DEFAULT_ALGORITHM,
      TOTP_DEFAULT_DIGITS,
      TOTP_DEFAULT_PERIOD_IN_SECONDS,
    ]).toEqual(["SHA1", 6, 30]);
    expect(section()).toContain(
      "| A setup key, such as `JBSW Y3DP EHPK 3PXP` | SHA1, 6 digits, and a new code every 30 seconds: what every authenticator app assumes |",
    );
  });

  it("names the algorithms, code lengths and default period a link may ask for", () => {
    expect([...TOTP_ALGORITHMS]).toEqual(["SHA1", "SHA256", "SHA512"]);
    expect([...TOTP_DIGIT_LENGTHS]).toEqual([6, 8]);
    expect(section()).toContain(
      "The link's `algorithm` (`SHA1`, `SHA256` or `SHA512`), `digits` (`6` or `8`) and `period` in seconds (`30` when the link has none)",
    );
  });

  it("says how long a code handed out is still good for", () => {
    expect(TOTP_MINIMUM_VALIDITY_IN_MS).toBe(5000);
    expect(getTotpMinimumValidityInMs(30)).toBe(5000);
    // A third of a period shorter than fifteen seconds.
    expect(getTotpMinimumValidityInMs(12)).toBe(4000);
    expect(section()).toContain(
      "The probe never hands out a code with less than five seconds left, or a third of the period when the period is shorter: it waits for the next code instead, at most five seconds,",
    );
  });

  it("shows a code in a check's report as it is masked", () => {
    expect(maskTotpCode("492039")).toBe("******");
    expect(section()).toContain(
      "Every code a check makes is shown as asterisks, such as `******`, in its log messages, its result, its error and the names of its screenshots.",
    );
  });

  it("names the fields codes go into, as the server reads references in them", () => {
    // The server reads a step's references with the shared reader (#9759).
    const server: string = sourceBetween(
      readRepoFile("App/FeatureSet/Telemetry/Utils/Monitor.ts"),
      "private static getTotpReferences(",
      "private static async attachTotpSecrets(",
    );

    expect(server).toContain("getStepTotpReferences(");

    const filling: string = sourceBetween(
      readRepoFile("Common/Utils/Monitor/MonitorSecretReferences.ts"),
      "export function getStepTotpReferences(",
      "export function getTotpSecretNamesNeeded(",
    );
    // The API block, to its own closing brace.
    const api: string = sourceBetween(
      filling,
      "if (monitorType === MonitorType.API) {",
      "\n  }",
    );

    for (const field of [
      "monitorDestination",
      "requestHeaders",
      "requestBody",
    ]) {
      expect(api).toContain(`monitorStep.data.${field}`);
    }

    expect(filling).toContain(
      "monitorType === MonitorType.SyntheticMonitor ||\n    monitorType === MonitorType.CustomJavaScriptCode",
    );
    expect(section()).toContain(
      "| API | `{{monitorSecrets.NAME}}` in the URL, a request header or the request body, just before each attempt is sent |",
    );
    expect(section()).toContain(
      '| Synthetic Monitor, Custom JavaScript Code | `{{monitorSecrets.NAME}}` in the script, when the script starts, and `await oneuptime.getTotpCode("NAME")`, when the script asks |',
    );
  });
});

describe("oneuptime.getTotpCode", () => {
  it("is in a synthetic script's sandbox and a custom code script's", () => {
    expect(
      readRepoFile("Probe/Utils/Monitors/SyntheticRuntime/WorkerBootstrap.ts"),
    ).toContain(
      'getTotpCode(name) {\n        return rpc(payload.capabilities.runtime, "getTotpCode"',
    );
    expect(readRepoFile("Common/Server/Utils/VM/VMRunner.ts")).toContain(
      "getTotpCode: async (name) => {",
    );
  });

  it("is listed with the script's modules on both monitor pages", () => {
    const row: string =
      '| `oneuptime.getTotpCode` | Makes the current code of a one-time code secret: `await oneuptime.getTotpCode("NAME")`. See [Using Monitor Secrets](#using-monitor-secrets). |';

    expect(SYNTHETIC_PAGE).toContain(row);
    expect(CUSTOM_CODE_PAGE).toContain(row);

    for (const page of [SYNTHETIC_PAGE, CUSTOM_CODE_PAGE]) {
      expect(page).toContain(
        "(/docs/monitor/monitor-secrets#signing-in-with-a-one-time-code)",
      );
    }
  });
});
