import { describe, expect, it } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
} from "Common/Types/Probe/ProbeCapability";
import MonitorUrlInText from "Common/Utils/Monitor/MonitorUrlInText";
import { REQUEST_BODY_STEP_NOT_RUN_MESSAGE } from "../../../FeatureSet/Telemetry/Utils/RequestBodyProbeGate";
import { ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE } from "../../../FeatureSet/Telemetry/Utils/TotpProbeGate";

/*
 * What the docs say of a monitor secret in a check's URL (#10785) and of
 * the release a custom probe needs, held to the code in every docs
 * language:
 *
 *   - a failed check's error names the URL by its scheme, host and port,
 *     as MonitorUrlInText writes it, in the API Monitor, Website Monitor
 *     and Monitor Secrets pages;
 *   - the request body only a newer probe sends names no release - the
 *     first that sends one is the release after 17.2.0, not known until it
 *     is cut - and nor does the check's sentence; one-time codes name the
 *     release that first made them, 17.1.0, which shipped (17.0.1 never
 *     did).
 */

const EXAMPLE_URL: string = "`https://api.example.com`";

describe("a monitor secret in a check's URL is never shown in its error", () => {
  it("the URL is written as the code writes it", () => {
    expect(
      MonitorUrlInText.write(
        "https://api.example.com/v1/health?key=SECRET#token",
      ),
    ).toBe("https://api.example.com");
  });

  it.each(DOCS_LANGUAGES)(
    "%s: the API Monitor's URL and the Monitor Secrets page say so",
    (language: string) => {
      const api: string = readPage(language, "monitor/api-monitor");
      const urlParagraph: string =
        api.split("\n").find((line: string): boolean => {
          return line.includes("`https://api.example.com/v1/health`");
        }) || "";

      expect(urlParagraph).toContain("`{{monitorSecrets.NAME}}`");
      expect(urlParagraph).toContain(EXAMPLE_URL);

      expect(readPage(language, "monitor/monitor-secrets")).toContain(
        EXAMPLE_URL,
      );
    },
  );
});

describe("the release a custom probe needs", () => {
  it("the checks' sentences name no release", () => {
    for (const message of [
      REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
      ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
    ]) {
      expect(message).not.toMatch(/\d+\.\d+\.\d+/);
      expect(message).toContain(
        "Update the probe to the latest OneUptime release.",
      );
    }
  });

  it.each(DOCS_LANGUAGES)(
    "%s: the request body's too-old entry names no release, and one-time codes name the one that made them",
    (language: string) => {
      const api: string = readPage(language, "monitor/api-monitor");
      const secrets: string = readPage(language, "monitor/monitor-secrets");
      const customProbe: string = readPage(language, "probe/custom-probe");

      // 17.2.0 sends no such body, and its successor's number is not known.
      for (const page of [api, secrets, customProbe]) {
        expect(page).not.toContain("17.2.0");
        expect(page).not.toContain(FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY);
        // No 17.0.1 was ever released.
        expect(page).not.toContain("17.0.1");
      }

      expect(secrets).toContain(FIRST_PROBE_VERSION_WITH_TOTP_CODES);
      expect(customProbe).toContain(FIRST_PROBE_VERSION_WITH_TOTP_CODES);
      // The too-old entry links how to update a probe.
      expect(api).toContain("(/docs/probe/custom-probe#");
    },
  );
});
