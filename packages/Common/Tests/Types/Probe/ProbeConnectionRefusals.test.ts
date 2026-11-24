import {
  PROBE_CREDENTIALS_PLACE,
  ProbeConnectionRefusals,
  ProbeStartupMessages,
} from "../../../Types/Probe/ProbeConnectionRefusals";
import {
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A PROBE THAT CANNOT CONNECT IS TOLD WHAT TO FIX (#7273).
 *
 * "ProbeId or ProbeKey is missing", "Invalid Probe ID or Probe Key",
 * "Probe not found", "PROBE_KEY is not set" and "Register probe failed"
 * said that something was wrong and nothing about where the probe's ID and
 * key are, or which setting holds them. Every refusal a probe meets, and
 * every line it logs before it stops, now says what happened and what to
 * do next.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

const readSource: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(PACKAGES, relative), "utf8");
};

const EVERY_MESSAGE: Array<[string, string]> = [
  ...Object.entries(ProbeConnectionRefusals),
  ...Object.entries(ProbeStartupMessages),
];

describe("what a probe that cannot connect reads", () => {
  test.each(EVERY_MESSAGE)(
    "%s is a sentence that says what happened and what to do next",
    (_name: string, message: string) => {
      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(isEmptyErrorPhrase(message)).toBe(false);
      // What happened, then what to do: more than one sentence.
      expect(message.split(". ").length).toBeGreaterThanOrEqual(2);
      // Never the old words, which named fields and nothing to do.
      expect(message).not.toMatch(/\b(Invalid|ProbeId|ProbeKey)\b/);
      expect(message).not.toContain("not found");
    },
  );

  test.each([
    ["missingIdOrKey", ProbeConnectionRefusals.missingIdOrKey],
    ["wrongIdOrKey", ProbeConnectionRefusals.wrongIdOrKey],
    ["noProbeKey", ProbeStartupMessages.noProbeKey],
    ["noProbeId", ProbeStartupMessages.noProbeId],
  ])(
    "%s says where the ID and key are, and the settings they go in",
    (_name: string, message: string) => {
      expect(message).toContain(PROBE_CREDENTIALS_PLACE);
      expect(message).toContain("Probe ID");
      expect(message).toContain("Probe Key");
      expect(message).toContain("PROBE_ID");
      expect(message).toContain("PROBE_KEY");
    },
  );

  test("the probe's page names its ID and key as the messages do", () => {
    const page: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx",
    );

    expect(page).toContain('title: "Probe ID"');
    expect(page).toContain('title: "Probe Key"');
    expect(PROBE_CREDENTIALS_PLACE).toBe("Monitors > Settings > Probes");
  });

  test("a wrong ID and a wrong key are one answer, so it never says which", () => {
    expect(ProbeConnectionRefusals.wrongIdOrKey).toContain("this ID and key");
  });

  test("a report with a part missing says to update the probe", () => {
    for (const message of [
      ProbeConnectionRefusals.missingStatusReport,
      ProbeConnectionRefusals.missingMonitorResponse,
      ProbeConnectionRefusals.missingSnmpTrap,
      ProbeConnectionRefusals.missingTestId,
    ]) {
      expect(message).toContain(
        "Update the probe to the release this OneUptime server runs",
      );
    }
  });

  test("each startup line opens with the setting that is missing, as the docs quote it", () => {
    expect(
      ProbeStartupMessages.noProbeKey.startsWith("PROBE_KEY is not set,"),
    ).toBe(true);
    expect(
      ProbeStartupMessages.noServerAddress.startsWith(
        "Neither ONEUPTIME_URL nor PROBE_INGEST_URL is set,",
      ),
    ).toBe(true);
    expect(
      ProbeStartupMessages.noProbeId.startsWith("PROBE_ID is not set,"),
    ).toBe(true);
  });
});

describe("where they are said", () => {
  test("the server's key check refuses with them", () => {
    const authorization: string = readSource(
      "App/FeatureSet/Telemetry/Middleware/ProbeAuthorization.ts",
    );

    expect(authorization).toContain("ProbeConnectionRefusals.missingIdOrKey");
    expect(authorization).toContain("ProbeConnectionRefusals.wrongIdOrKey");
    expect(authorization).not.toContain('"Invalid Probe ID or Probe Key"');
    expect(authorization).not.toContain('"ProbeId or ProbeKey is missing"');
  });

  test("the probe's routes refuse with them", () => {
    const routes: string = readSource(
      "App/FeatureSet/Telemetry/API/ProbeIngest/Probe.ts",
    );

    expect(routes).not.toContain('"Probe not found"');
    expect(routes).not.toContain('"ProbeMonitorResponse not found"');
    expect(routes).toContain("ProbeConnectionRefusals.unknownProbe");
  });

  test("the probe logs them before it stops", () => {
    expect(readSource("Probe/Config.ts")).toContain(
      "logger.error(ProbeStartupMessages.noServerAddress);",
    );
    expect(readSource("Probe/Config.ts")).toContain(
      "logger.error(ProbeStartupMessages.noProbeKey);",
    );
    expect(readSource("Probe/Services/Register.ts")).toContain(
      "logger.error(ProbeStartupMessages.noProbeId);",
    );
    expect(readSource("Probe/Index.ts")).toContain(
      "logger.error(ProbeStartupMessages.couldNotConnect);",
    );
  });
});
