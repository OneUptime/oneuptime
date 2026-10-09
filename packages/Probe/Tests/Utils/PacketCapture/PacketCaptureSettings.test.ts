import { describe, expect, test } from "@jest/globals";
import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import {
  describePacketCaptureSettings,
  PACKET_CAPTURE_ENABLED_ENV_VAR,
  PACKET_CAPTURE_MAX_DURATION_ENV_VAR,
  PACKET_CAPTURE_MAX_FILE_SIZE_ENV_VAR,
  PacketCaptureSettings,
  readPacketCaptureSettings,
} from "../../../Utils/PacketCapture/PacketCaptureSettings";
import fs from "fs";
import path from "path";

/*
 * Whether this probe may capture packets is its operator's call, made in
 * the probe's environment where the dashboard cannot change it. Off unless
 * it says exactly "true"; the operator's maximums can only lower the hard
 * ones; and the probe says at every start which it is.
 */

describe("the switch", () => {
  test("is named as the docs and the dashboard name it", () => {
    expect(PACKET_CAPTURE_ENABLED_ENV_VAR).toBe("PROBE_PACKET_CAPTURE_ENABLED");
    expect(PACKET_CAPTURE_MAX_DURATION_ENV_VAR).toBe(
      "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS",
    );
    expect(PACKET_CAPTURE_MAX_FILE_SIZE_ENV_VAR).toBe(
      "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB",
    );
  });

  test("captures are off unless it says true", () => {
    for (const value of [
      undefined,
      "",
      "false",
      "1",
      "yes",
      "on",
      "enabled",
      "truee",
      "t",
    ]) {
      expect(
        readPacketCaptureSettings({ PROBE_PACKET_CAPTURE_ENABLED: value })
          .isEnabled,
      ).toBe(false);
    }
  });

  test("true turns them on, whatever its case or spaces", () => {
    for (const value of ["true", "TRUE", " True "]) {
      expect(
        readPacketCaptureSettings({ PROBE_PACKET_CAPTURE_ENABLED: value })
          .isEnabled,
      ).toBe(true);
    }
  });
});

describe("the operator's maximums", () => {
  function settings(env: Record<string, string>): PacketCaptureSettings {
    return readPacketCaptureSettings({
      PROBE_PACKET_CAPTURE_ENABLED: "true",
      ...env,
    });
  }

  test("none set: the hard maximums, and nothing to warn about", () => {
    expect(settings({})).toEqual({
      isEnabled: true,
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
      warnings: [],
    });
  });

  test("a lower duration or file size is held to", () => {
    expect(
      settings({
        PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "600",
        PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: " 5 ",
      }),
    ).toEqual({
      isEnabled: true,
      limits: {
        maxDurationInSeconds: 600,
        maxPackets: HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets,
        maxFileSizeInMB: 5,
      },
      warnings: [],
    });
  });

  test("a value above the hard maximum can never raise it, and is logged", () => {
    const read: PacketCaptureSettings = settings({
      PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "7200",
      PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: "100",
    });

    expect(read.limits.maxDurationInSeconds).toBe(
      PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
    );
    expect(read.limits.maxFileSizeInMB).toBe(
      PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
    );
    expect(read.warnings).toEqual([
      "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS=7200 is above the maximum every probe holds to, so 1800 is used.",
      "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB=100 is above the maximum every probe holds to, so 25 is used.",
    ]);
  });

  test("a value below the minimum is raised to it, and is logged", () => {
    const read: PacketCaptureSettings = settings({
      PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "1",
      PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: "0",
    });

    expect(read.limits.maxDurationInSeconds).toBe(5);
    expect(read.limits.maxFileSizeInMB).toBe(1);
    expect(read.warnings).toEqual([
      "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS=1 is below the minimum, so 5 is used.",
      "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB=0 is below the minimum, so 1 is used.",
    ]);
  });

  test("a value that is not a whole number leaves the hard maximum, and is logged", () => {
    const read: PacketCaptureSettings = settings({
      PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "ten minutes",
      PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: "2.5",
    });

    expect(read.limits).toEqual(HARD_MAX_PACKET_CAPTURE_LIMITS);
    expect(read.warnings).toEqual([
      'PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS="ten minutes" is not a whole number, so the maximum of 1800 is used.',
      'PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB="2.5" is not a whole number, so the maximum of 25 is used.',
    ]);
  });

  test("with captures off, nothing about the maximums is worth logging", () => {
    expect(
      readPacketCaptureSettings({
        PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "nonsense",
      }).warnings,
    ).toEqual([]);
  });
});

describe("the line the probe logs at every start", () => {
  test("says captures are off, and how to turn them on", () => {
    expect(describePacketCaptureSettings(readPacketCaptureSettings({}))).toBe(
      "Packet capture is off. Set PROBE_PACKET_CAPTURE_ENABLED=true to let the dashboard start packet captures on this probe.",
    );
  });

  test("says captures are on, and how long and large they may be", () => {
    expect(
      describePacketCaptureSettings(
        readPacketCaptureSettings({ PROBE_PACKET_CAPTURE_ENABLED: "true" }),
      ),
    ).toBe(
      "Packet capture is on: captures of up to 30 minutes and 25 MB can be started on this probe from the dashboard.",
    );
    expect(
      describePacketCaptureSettings(
        readPacketCaptureSettings({
          PROBE_PACKET_CAPTURE_ENABLED: "true",
          PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "90",
          PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: "5",
        }),
      ),
    ).toBe(
      "Packet capture is on: captures of up to 1 minute 30 seconds and 5 MB can be started on this probe from the dashboard.",
    );
  });

  test("is the line every language's docs quote", () => {
    const line: string = describePacketCaptureSettings(
      readPacketCaptureSettings({ PROBE_PACKET_CAPTURE_ENABLED: "true" }),
    );
    const contentRoot: string = path.join(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content",
    );

    for (const language of fs.readdirSync(contentRoot)) {
      const page: string = path.join(
        contentRoot,
        language,
        "probe",
        "packet-capture.md",
      );

      expect({
        language: language,
        quotes: fs.readFileSync(page, "utf8").includes(`\`${line}\``),
      }).toEqual({ language: language, quotes: true });
    }
  });

  test("Config reads the settings from the probe's environment, and the probe logs them at start", () => {
    const probeRoot: string = path.join(__dirname, "../../..");
    const config: string = fs.readFileSync(
      path.join(probeRoot, "Config.ts"),
      "utf8",
    );
    const index: string = fs.readFileSync(
      path.join(probeRoot, "Index.ts"),
      "utf8",
    );

    expect(config).toContain(
      "export const PROBE_PACKET_CAPTURE_SETTINGS: PacketCaptureSettings =\n  readPacketCaptureSettings(process.env);",
    );
    expect(index).toContain(
      "logger.info(describePacketCaptureSettings(PROBE_PACKET_CAPTURE_SETTINGS));",
    );
    expect(index).toContain(
      "for (const warning of PROBE_PACKET_CAPTURE_SETTINGS.warnings) {",
    );
    expect(index).toContain("ReportPacketCaptureCapability();");
    expect(index).toContain("FetchPacketCaptures();");
  });
});
