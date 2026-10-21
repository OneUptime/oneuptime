import {
  HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
  HOST_COLLECTOR_CONFIG_CREATED_NOTE,
  HOST_COLLECTOR_EXPORTER_ENDPOINT,
  HOST_COLLECTOR_INGESTION_KEY_ENV,
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
  HOST_COLLECTOR_INSTALLABLE_OS_TYPES,
  HOST_COLLECTOR_INSTALL_SCRIPT_PATH,
  HOST_COLLECTOR_OPAMP_PATH,
  HOST_COLLECTOR_OS_NAMES,
  HOST_COLLECTOR_URL_ENV,
  HOST_COLLECTOR_URL_REFERENCE,
  HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH,
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorConfigRestoredNote,
  getHostCollectorConfigRestoredVersion,
  getHostCollectorOsType,
  isHostCollectorConfigStatus,
  isHostCollectorOsType,
} from "../../../Types/HostCollector/HostCollector";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The plain values the Dashboard, the server, the installers and the docs
 * share about the hosts OneUptime installs and configures: the systems a
 * Collector Config can be for, how a host's os.type names them, where a
 * config refers to the host's own URL and key, and the note a version
 * leaves when it puts an older one back.
 */

describe("the systems a host can run", () => {
  test.each([
    ["linux", HostCollectorOsType.Linux],
    ["Linux", HostCollectorOsType.Linux],
    ["  linux  ", HostCollectorOsType.Linux],
    ["windows", HostCollectorOsType.Windows],
    ["WINDOWS", HostCollectorOsType.Windows],
    ["darwin", HostCollectorOsType.MacOS],
    ["macos", HostCollectorOsType.MacOS],
  ])("os.type %p is %p", (osType: string, expected: HostCollectorOsType) => {
    expect(getHostCollectorOsType(osType)).toBe(expected);
  });

  test.each([["freebsd"], ["aix"], ["solaris"], ["any"], [""], ["linux2"]])(
    "os.type %p is none of the three the installers run on",
    (osType: string) => {
      expect(getHostCollectorOsType(osType)).toBeNull();
    },
  );

  test("a host that reported no os.type has no system yet", () => {
    expect(getHostCollectorOsType(null)).toBeNull();
    expect(getHostCollectorOsType(undefined)).toBeNull();
  });

  test("a Collector Config is for one of the stored values only", () => {
    for (const value of Object.values(HostCollectorOsType)) {
      expect(isHostCollectorOsType(value)).toBe(true);
    }

    for (const value of ["Linux", "macos", "", "windows ", null, 3, {}]) {
      expect(isHostCollectorOsType(value)).toBe(false);
    }
  });

  test("the installers run on Linux, Windows and macOS, in the order the guide offers them", () => {
    expect([...HOST_COLLECTOR_INSTALLABLE_OS_TYPES]).toEqual([
      HostCollectorOsType.Linux,
      HostCollectorOsType.Windows,
      HostCollectorOsType.MacOS,
    ]);
  });

  test("every system has a name people know it by, and macOS is stored as OpenTelemetry's darwin", () => {
    expect(HostCollectorOsType.MacOS).toBe("darwin");
    expect(HOST_COLLECTOR_OS_NAMES[HostCollectorOsType.MacOS]).toBe("macOS");
    expect(HOST_COLLECTOR_OS_NAMES[HostCollectorOsType.Any]).toBe("Any system");
    expect(Object.keys(HOST_COLLECTOR_OS_NAMES).sort()).toEqual(
      Object.values(HostCollectorOsType).sort(),
    );
  });
});

describe("where a host's collector sends, as every config writes it", () => {
  test("a config refers to the host's URL and key through the environment the installer gives it", () => {
    expect(HOST_COLLECTOR_URL_ENV).toBe("ONEUPTIME_URL");
    expect(HOST_COLLECTOR_INGESTION_KEY_ENV).toBe("ONEUPTIME_INGESTION_KEY");
    expect(HOST_COLLECTOR_URL_REFERENCE).toBe("${env:ONEUPTIME_URL}");
    expect(HOST_COLLECTOR_INGESTION_KEY_REFERENCE).toBe(
      "${env:ONEUPTIME_INGESTION_KEY}",
    );
    expect(HOST_COLLECTOR_EXPORTER_ENDPOINT).toBe("${env:ONEUPTIME_URL}/otlp");
  });

  test("the supervisor posts to /opamp/v1, and every OneUptime serves the installers under /docs/static", () => {
    expect(HOST_COLLECTOR_OPAMP_PATH).toBe("/opamp/v1");
    expect(HOST_COLLECTOR_INSTALL_SCRIPT_PATH).toBe(
      "/docs/static/scripts/host-collector/install.sh",
    );
    expect(HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH).toBe(
      "/docs/static/scripts/host-collector/install.ps1",
    );
  });
});

describe("a host's config status", () => {
  test("is one of the four stored values", () => {
    expect(Object.values(HostCollectorConfigStatus).sort()).toEqual([
      "applied",
      "applying",
      "failed",
      "waiting",
    ]);

    for (const value of Object.values(HostCollectorConfigStatus)) {
      expect(isHostCollectorConfigStatus(value)).toBe(true);
    }

    for (const value of ["Applied", "unknown", "", null, undefined, 1]) {
      expect(isHostCollectorConfigStatus(value)).toBe(false);
    }
  });
});

describe("the note a version leaves", () => {
  test("a new config is Created, a changed one Changed", () => {
    expect(HOST_COLLECTOR_CONFIG_CREATED_NOTE).toBe("Created");
    expect(HOST_COLLECTOR_CONFIG_CHANGED_NOTE).toBe("Changed");
    expect(
      getHostCollectorConfigRestoredVersion(HOST_COLLECTOR_CONFIG_CREATED_NOTE),
    ).toBeNull();
    expect(
      getHostCollectorConfigRestoredVersion(HOST_COLLECTOR_CONFIG_CHANGED_NOTE),
    ).toBeNull();
  });

  test.each([[1], [3], [42], [123456789]])(
    "Put version %p back names the version it put back",
    (versionNumber: number) => {
      const note: string = getHostCollectorConfigRestoredNote(versionNumber);

      expect(note).toBe(`Put version ${versionNumber} back`);
      expect(getHostCollectorConfigRestoredVersion(note)).toBe(versionNumber);
    },
  );

  test.each([
    ["no number", "Put version  back"],
    ["version 0", "Put version 0 back"],
    ["a sign", "Put version -3 back"],
    ["a decimal", "Put version 1.5 back"],
    ["letters", "Put version three back"],
    ["a space inside", "Put version 1 2 back"],
    ["a longer number than any version", "Put version 1234567890 back"],
    ["another sentence", "Put version 3 back, then changed"],
    ["lower case", "put version 3 back"],
    ["empty", ""],
  ])(
    "%s is not a note that puts a version back",
    (_label: string, note: string) => {
      expect(getHostCollectorConfigRestoredVersion(note)).toBeNull();
    },
  );

  test("a missing note puts nothing back", () => {
    expect(getHostCollectorConfigRestoredVersion(null)).toBeNull();
    expect(getHostCollectorConfigRestoredVersion(undefined)).toBeNull();
  });

  test("a very long note is turned down at once, whatever it holds", () => {
    const note: string = `Put version ${"9".repeat(400000)} back`;

    const run: { inMs: number } = fastestRun({
      run: (): number | null => {
        return getHostCollectorConfigRestoredVersion(note);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(getHostCollectorConfigRestoredVersion(note)).toBeNull();
  });
});
