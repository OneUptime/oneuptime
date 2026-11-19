import { describe, expect, it } from "@jest/globals";
import { readPage } from "./DocsContentSupport";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import { maskTotpCode } from "Common/Utils/Monitor/MonitorSecretTotp";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "Common/Types/Probe/ProbeCapability";
import { ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE } from "../../../FeatureSet/Telemetry/Utils/TotpProbeGate";
import { UPDATE_A_PROBE_DOCS_PATH } from "../../../FeatureSet/Dashboard/src/Components/Monitor/OneTimeCodeProbes";
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

/*
 * Issue #9759: a custom probe too old to make one-time codes. The docs name
 * the release that first makes them, what a check that needs a code does
 * on an older probe, where the product names such a probe, and how to
 * update one - held to the code that does each.
 */
describe("a probe too old to make one-time codes", () => {
  const CUSTOM_PROBE_PAGE: string = readPage("en", "probe/custom-probe");

  it("names the first release that makes them, as the probe and the server read it", () => {
    expect(FIRST_PROBE_VERSION_WITH_TOTP_CODES).toBe("17.0.1");
    expect(section()).toContain(
      "so a custom probe needs OneUptime 17.0.1 or later.",
    );
    expect(CUSTOM_PROBE_PAGE).toContain(
      "A probe older than 17.0.1 cannot make the codes of a [one-time code secret](/docs/monitor/monitor-secrets#signing-in-with-a-one-time-code)",
    );
  });

  it("says a check that needs a code does not run on an older probe, and fails saying to update it", () => {
    expect(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE).toBe(
      "This check needs a one-time code, and this probe is too old to make one, so the check did not run. Update the probe to OneUptime 17.0.1 or later.",
    );
    expect(section()).toContain(
      "On an older one, a check that needs a code does not run, and fails with a sentence saying to update the probe;",
    );
    expect(SECRETS_PAGE).toContain(
      ":::details The check says the probe is too old to make one-time codes\nThe probe runs a release older than OneUptime 17.0.1, which cannot make one-time codes, so the check did not run on it.",
    );
  });

  it("says where the product names such a probe: the monitor's form and the probe's page", () => {
    expect(section()).toContain(
      "the monitor's form and the probe's page name a probe that is too old",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx",
      ),
    ).toContain("<ProbeVersionElement probe={item} />");
    expect(
      readRepoFile("App/FeatureSet/Dashboard/src/Pages/Monitor/Create.tsx"),
    ).toContain("<OneTimeCodeProbesWarning");
    // Under Probe Status, as the page's card is titled.
    expect(CUSTOM_PROBE_PAGE).toContain(
      "The probe's page shows the release it runs, under **Probe Status**.",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx",
      ),
    ).toContain('title: "Probe Status",');
  });

  it("links the section the product links, which says how to update a probe", () => {
    expect(UPDATE_A_PROBE_DOCS_PATH).toBe("/probe/custom-probe#update-a-probe");
    expect(CUSTOM_PROBE_PAGE).toContain("\n## Update a probe\n");
    expect(section()).toContain(
      "[Update a probe](/docs/probe/custom-probe#update-a-probe)",
    );

    const update: string = CUSTOM_PROBE_PAGE.slice(
      CUSTOM_PROBE_PAGE.indexOf("\n## Update a probe\n"),
      CUSTOM_PROBE_PAGE.indexOf("\n## Connecting through a proxy\n"),
    );

    // From the image every install command runs.
    expect(update).toContain("`oneuptime/probe:release`");
    expect(CUSTOM_PROBE_PAGE).toContain("-d oneuptime/probe:release");
    expect(update).toContain("docker pull oneuptime/probe:release");
    expect(update).toContain("docker compose pull oneuptime-probe");
    expect(update).toContain(
      "kubectl set image deployment/oneuptime-probe oneuptime-probe=oneuptime/probe:<version>",
    );
    // The names the install commands give the container and the Deployment.
    expect(CUSTOM_PROBE_PAGE).toContain("docker run --name oneuptime-probe");
    expect(CUSTOM_PROBE_PAGE).toContain("  name: oneuptime-probe\n");
    expect(CUSTOM_PROBE_PAGE).toContain("        - name: oneuptime-probe\n");
  });
});

/*
 * Issue #9760: a secret's type changes together with a new value, in
 * Update Secret Value.
 */
describe("changing a secret's type", () => {
  it("is said where the docs say how to rotate a secret, as the dialog and the server do it", () => {
    expect(SECRETS_PAGE).toContain(
      "The same button changes what the secret holds, **Text** or **One-time code (TOTP)**, together with a new value, and monitors that use the secret take the new type at their next check.",
    );
    expect(MONITOR_SECRET_TYPE_TITLES[MonitorSecretType.Text]).toBe("Text");

    const dialog: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecrets.tsx",
    );

    expect(dialog).toContain('title={"Update Secret Value"}');
    expect(dialog).toContain(
      "description: MONITOR_SECRET_TYPE_UPDATE_DESCRIPTION,",
    );
    expect(
      readRepoFile("Common/Server/Services/MonitorSecretService.ts"),
    ).toContain("export const TYPE_CHANGE_NEEDS_VALUE_MESSAGE: string =");
  });
});
